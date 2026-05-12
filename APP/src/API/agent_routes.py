"""
Agent proxy routes for the APP Flask backend.

Stores the user's agent connection config in data/agent_config.json.

── Config & key management ────────────────────────────────────────────────────
  GET  /api/agent/config       — read current config
  POST /api/agent/config       — save config

── Planning Agent chat management ─────────────────────────────────────────────
  POST   /api/agent/chat/create  — create a new chat on the server
  GET    /api/agent/chat/info    — return active chat_id (or null)
  DELETE /api/agent/chat/delete  — delete active chat + reset local state
  POST   /api/agent/chat/stream  — SSE proxy: forward message to planning agent

── Legacy (kept for backward compat) ─────────────────────────────────────────
  POST   /api/agent/chat         — non-streaming legacy ReAct proxy
  POST   /api/agent/reset        — reset legacy session
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import requests
from flask import Blueprint, jsonify, request, Response, stream_with_context

logger = logging.getLogger(__name__)

agent_bp = Blueprint("agent", __name__)

_CONFIG_PATH = Path(__file__).parent.parent.parent / "data" / "agent_config.json"

_DEFAULT_CONFIG: dict = {
    "mode": "server_proxy",
    "server_url": "http://localhost:8000",
    "api_key": "",
    "container_url": "",
    "output_path": "",
}

# When the Server (Docker) calls back to the APP's tool executor,
# it must reach the host machine via host.docker.internal.
_TOOL_CALLBACK_URL = "http://host.docker.internal:5000/api/tools/execute"

# In-memory map: api_key → chat_id currently active on the server.
# Lost on Flask restart; user just creates a new chat automatically.
_ACTIVE_CHATS: dict[str, str] = {}


# ── Config helpers ─────────────────────────────────────────────────────────────

def _load_config() -> dict:
    if _CONFIG_PATH.exists():
        try:
            with open(_CONFIG_PATH) as f:
                data = json.load(f)
            data.pop("session_id", None)
            data.pop("jwt_token", None)
            if "api_key" not in data:
                data["api_key"] = data.pop("container_api_key", "") or ""
            return {**_DEFAULT_CONFIG, **data}
        except Exception:
            pass
    return dict(_DEFAULT_CONFIG)


def _save_config(cfg: dict) -> None:
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


def _agent_headers(cfg: dict) -> dict:
    return {"X-API-Key": cfg["api_key"], "Content-Type": "application/json"}


# ── Tool list builder ──────────────────────────────────────────────────────────

def _build_tool_list() -> list[dict]:
    """
    Build the tool definitions to send to the planning agent.
    Injects callback_url pointing to this APP's /execute endpoint
    (using host.docker.internal so the Server container can reach it).
    """
    try:
        from API.tools_routes import _TOOLS
        defs: list[dict] = []
        for _name, mod in _TOOLS.items():
            defn = dict(getattr(mod, "DEFINITION", {}))
            defn["callback_url"] = _TOOL_CALLBACK_URL
            defs.append(defn)
        return defs
    except Exception as exc:
        logger.error("Failed to build tool list: %s", exc)
        return []


# ── Config routes ──────────────────────────────────────────────────────────────

@agent_bp.get("/config")
def get_config():
    cfg = _load_config()
    safe = dict(cfg)
    safe["api_key_set"] = bool(safe.get("api_key"))
    return jsonify(safe)


@agent_bp.post("/config")
def save_config():
    data = request.get_json(force=True) or {}
    cfg = _load_config()
    cfg["mode"] = data.get("mode", cfg["mode"])
    cfg["server_url"] = data.get("server_url", cfg["server_url"])
    cfg["container_url"] = data.get("container_url", cfg["container_url"])
    if data.get("api_key"):
        cfg["api_key"] = data["api_key"]
    if "output_path" in data:
        cfg["output_path"] = data["output_path"]
    _save_config(cfg)
    return jsonify({"ok": True})


# ── Planning Agent — chat management ──────────────────────────────────────────

@agent_bp.post("/chat/create")
def create_chat():
    """
    Create a new planning-agent chat on the server.
    Stores the resulting chat_id in _ACTIVE_CHATS.
    Returns { chat_id, title }.
    """
    cfg = _load_config()
    api_key = cfg.get("api_key", "")
    server_url = cfg.get("server_url", "http://localhost:8000").rstrip("/")

    if not api_key:
        return jsonify({"error": "API key not configured. Go to Settings → Agent Connection."}), 400

    tools = _build_tool_list()
    try:
        resp = requests.post(
            f"{server_url}/api/agent/chats",
            headers=_agent_headers(cfg),
            json={"tools": tools, "title": ""},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.error("Failed to create chat: %s", exc)
        return jsonify({"error": f"Cannot reach server: {exc}"}), 502

    chat_id: str = data["chat_id"]
    _ACTIVE_CHATS[api_key] = chat_id
    logger.info("Created chat %s for api_key=...%s", chat_id, api_key[-6:])
    return jsonify({"chat_id": chat_id, "title": data.get("title", "")})


@agent_bp.get("/chat/info")
def chat_info():
    """Return the currently active chat_id (null if none)."""
    cfg = _load_config()
    api_key = cfg.get("api_key", "")
    chat_id = _ACTIVE_CHATS.get(api_key)
    return jsonify({"chat_id": chat_id})


@agent_bp.delete("/chat/delete")
def delete_chat():
    """Delete the active chat on the server and clear local state."""
    cfg = _load_config()
    api_key = cfg.get("api_key", "")
    server_url = cfg.get("server_url", "http://localhost:8000").rstrip("/")
    chat_id = _ACTIVE_CHATS.pop(api_key, None)
    if chat_id:
        try:
            requests.delete(
                f"{server_url}/api/agent/chats/{chat_id}",
                headers=_agent_headers(cfg),
                timeout=5,
            )
        except Exception:
            pass
        logger.info("Deleted chat %s for api_key=...%s", chat_id, api_key[-6:])
    return jsonify({"ok": True})


# ── Planning Agent — SSE streaming message ─────────────────────────────────────

@agent_bp.post("/chat/stream")
def stream_chat():
    """
    SSE proxy: forwards a chat message to the planning agent and
    streams the SSE response back to the React frontend.

    Body: { "message": "...", "chat_id": "..." (optional override) }

    The frontend connects with fetch() + ReadableStream, not EventSource,
    because EventSource doesn't support POST requests.

    Each forwarded chunk is raw bytes from the server's SSE stream,
    already formatted as  data: <json>\\n\\n  events.
    """
    body = request.get_json(force=True) or {}
    message: str = body.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    cfg = _load_config()
    api_key = cfg.get("api_key", "")
    server_url = cfg.get("server_url", "http://localhost:8000").rstrip("/")

    if not api_key:
        return jsonify({"error": "API key not configured"}), 400

    # Accept an explicit chat_id (e.g. after page reload) or use active one
    chat_id = body.get("chat_id") or _ACTIVE_CHATS.get(api_key)
    if not chat_id:
        return jsonify({"error": "No active chat. Call /api/agent/chat/create first."}), 400

    # Keep the active chat pointer current
    _ACTIVE_CHATS[api_key] = chat_id

    url = f"{server_url}/api/agent/chats/{chat_id}/message"
    tools = _build_tool_list()
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    payload = {"message": message, "tools": tools}

    def _generate():
        try:
            resp = requests.post(
                url,
                headers=headers,
                json=payload,
                stream=True,
                timeout=(10, 300),
            )
            resp.raise_for_status()
            for chunk in resp.iter_content(chunk_size=None):
                if chunk:
                    yield chunk
        except requests.exceptions.ConnectionError:
            err = json.dumps({
                "type": "error",
                "message": "Cannot reach server. Is Docker running?",
            })
            yield f"data: {err}\n\ndata: [DONE]\n\n".encode()
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else 502
            detail = exc.response.text[:200] if exc.response is not None else str(exc)
            err = json.dumps({
                "type": "error",
                "message": f"Server error {status}: {detail}",
            })
            yield f"data: {err}\n\ndata: [DONE]\n\n".encode()
        except Exception as exc:
            err = json.dumps({"type": "error", "message": str(exc)})
            yield f"data: {err}\n\ndata: [DONE]\n\n".encode()

    return Response(
        stream_with_context(_generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Legacy routes (non-streaming ReAct / Gemini pool) ─────────────────────────

def _chat_url(cfg: dict) -> str:
    if cfg["mode"] == "server_proxy":
        return cfg["server_url"].rstrip("/") + "/api/agent/chat"
    return cfg["container_url"].rstrip("/") + "/api/agent/chat"


def _reset_url(cfg: dict) -> str:
    if cfg["mode"] == "server_proxy":
        return cfg["server_url"].rstrip("/") + "/api/agent/session"
    return cfg["container_url"].rstrip("/") + "/api/agent/session"


@agent_bp.post("/chat")
def chat():
    data = request.get_json(force=True) or {}
    message: str = data.get("message", "")
    tools: list = data.get("tools", [])
    if not message:
        return jsonify({"error": "message is required"}), 400

    cfg = _load_config()
    if not cfg.get("api_key"):
        return jsonify({"error": "API key not configured."}), 400

    url = _chat_url(cfg)
    try:
        resp = requests.post(
            url,
            headers=_agent_headers(cfg),
            json={"message": message, "tools": tools},
            timeout=120,
        )
        resp.raise_for_status()
        return jsonify(resp.json())
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 502
        detail = exc.response.text[:300] if exc.response is not None else str(exc)
        return jsonify({"error": f"Agent request failed ({status}): {detail}"}), 502
    except requests.RequestException as exc:
        return jsonify({"error": f"Agent request failed: {exc}"}), 502


@agent_bp.post("/reset")
def reset_session():
    cfg = _load_config()
    if not cfg.get("api_key"):
        return jsonify({"error": "API key not configured"}), 400
    url = _reset_url(cfg)
    try:
        resp = requests.delete(url, headers=_agent_headers(cfg), timeout=10)
        if resp.status_code not in (204, 200, 404):
            resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Session reset failed: %s", exc)
    return jsonify({"ok": True})
