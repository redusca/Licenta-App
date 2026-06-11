"""
Shared AI Gateway utilities used by all tools that call the remote AI server.
Import this module instead of reading agent_config.json directly in each tool.
"""
from __future__ import annotations

import json
import logging

import requests

from utils.paths import get_data_dir

logger = logging.getLogger(__name__)


def _load_cfg() -> dict:
    cfg_path = get_data_dir() / "agent_config.json"
    if not cfg_path.exists():
        return {}
    with open(cfg_path, encoding="utf-8") as f:
        return json.load(f)


def get_url() -> str:
    """Return the AI Gateway base URL from agent_config.json, stripped of trailing slash."""
    try:
        url = _load_cfg().get("server_url", "").rstrip("/")
        if not url:
            logger.warning("ai_gateway.get_url: server_url is empty in config")
        return url
    except Exception:
        logger.exception("ai_gateway.get_url: failed to read config")
        return ""


def get_api_key() -> str:
    """Return the API key from agent_config.json."""
    try:
        return _load_cfg().get("api_key", "")
    except Exception:
        logger.exception("ai_gateway.get_api_key: failed to read config")
        return ""


def auth_headers() -> dict:
    """Return the X-API-Key header dict for AI Gateway requests."""
    key = get_api_key()
    return {"X-API-Key": key} if key else {}


def health_check(timeout: int = 3) -> tuple[bool, str]:
    """
    Check server reachability AND API key validity.

    Uses GET /api/agent/chats — the lightest endpoint that actually validates
    X-API-Key against the database (returns 401/403 for bad/inactive keys).
    /api/ai/status has no auth, so it cannot be used for key validation.

    Returns (True, "") on success, (False, human-readable error) otherwise.
    """
    base = get_url()
    if not base:
        return False, "AI Gateway URL not configured. Go to Settings → Agent Connection."
    api_key = get_api_key()
    if not api_key:
        return False, "API key not configured. Go to Settings → Agent Connection."
    try:
        resp = requests.get(
            f"{base}/api/agent/chats",
            headers={"X-API-Key": api_key},
            timeout=timeout,
        )
        if resp.status_code in (401, 403):
            try:
                detail = resp.json().get("detail", "")
            except Exception:
                detail = ""
            logger.warning("ai_gateway.health_check: auth rejected (%s) at %s — %s", resp.status_code, base, detail)
            return False, f"Invalid API key — {detail or 'the server rejected authentication'}. Go to Settings → Agent Connection."
        return True, ""
    except requests.exceptions.ConnectionError:
        logger.warning("ai_gateway.health_check: connection refused at %s", base)
        return False, f"Cannot connect to AI Gateway at {base}. Check that the server is running."
    except requests.exceptions.Timeout:
        logger.warning("ai_gateway.health_check: timeout reaching %s", base)
        return False, f"AI Gateway at {base} did not respond within {timeout}s."
    except requests.exceptions.RequestException as exc:
        logger.warning("ai_gateway.health_check: error reaching %s — %s", base, exc)
        return False, f"Cannot reach AI Gateway at {base}: {exc}"
