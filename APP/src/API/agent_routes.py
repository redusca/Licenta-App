"""
Agent proxy routes for the APP Flask backend.

Stores the user''s agent connection config in data/agent_config.json.
Proxies chat messages to the server agent pool or a self-hosted container.

  server_proxy  ->  POST {server_url}/api/agent/chat
                    X-API-Key: {api_key}

  direct        ->  POST {container_url}/api/agent/chat
                    X-API-Key: {api_key}

Session management is handled server-side (keyed by api_key).
No /init call is needed -- the first chat message creates the session.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import requests
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

agent_bp = Blueprint("agent", __name__)

_CONFIG_PATH = Path(__file__).parent.parent.parent / "data" / "agent_config.json"

_DEFAULT_CONFIG: dict = {
    "mode": "server_proxy",       # "server_proxy" | "direct"
    "server_url": "http://localhost:8000",
    "api_key": "",               # agent API key generated on the server
    "container_url": "",         # only used in direct mode
}


def _load_config() -> dict:
    if _CONFIG_PATH.exists():
        try:
            with open(_CONFIG_PATH) as f:
                data = json.load(f)
            # Migrate / clean up legacy fields
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


def _chat_url(cfg: dict) -> str:
    if cfg["mode"] == "server_proxy":
        return cfg["server_url"].rstrip("/") + "/api/agent/chat"
    else:
        return cfg["container_url"].rstrip("/") + "/api/agent/chat"


def _reset_url(cfg: dict) -> str:
    if cfg["mode"] == "server_proxy":
        return cfg["server_url"].rstrip("/") + "/api/agent/session"
    else:
        return cfg["container_url"].rstrip("/") + "/api/agent/session"


# -- Routes -------------------------------------------------------------------

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

    _save_config(cfg)
    return jsonify({"ok": True})


@agent_bp.post("/chat")
def chat():
    data = request.get_json(force=True) or {}
    message: str = data.get("message", "")
    tools: list = data.get("tools", [])
    if not message:
        return jsonify({"error": "message is required"}), 400

    cfg = _load_config()

    if not cfg.get("api_key"):
        return jsonify({"error": "API key not configured. Go to Settings -> Agent Connection."}), 400
    if cfg["mode"] == "server_proxy" and not cfg.get("server_url"):
        return jsonify({"error": "Server URL not configured. Go to Settings -> Agent Connection."}), 400
    if cfg["mode"] == "direct" and not cfg.get("container_url"):
        return jsonify({"error": "Container URL not configured. Go to Settings -> Agent Connection."}), 400

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
        logger.error("Agent chat HTTP error %s: %s", status, detail)
        return jsonify({"error": f"Agent request failed ({status}): {detail}"}), 502
    except requests.RequestException as exc:
        logger.error("Agent chat failed: %s", exc)
        return jsonify({"error": f"Agent request failed: {exc}"}), 502


@agent_bp.post("/reset")
def reset_session():
    """Reset the conversation history for the current API key."""
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
