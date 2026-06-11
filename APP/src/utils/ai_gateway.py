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


def get_url() -> str:
    """Return the AI Gateway base URL from agent_config.json, stripped of trailing slash."""
    try:
        cfg_path = get_data_dir() / "agent_config.json"
        if not cfg_path.exists():
            logger.warning("ai_gateway.get_url: config not found at %s", cfg_path)
            return ""
        with open(cfg_path, encoding="utf-8") as f:
            cfg = json.load(f)
        url = cfg.get("server_url", "").rstrip("/")
        if not url:
            logger.warning("ai_gateway.get_url: server_url is empty in config")
        return url
    except Exception:
        logger.exception("ai_gateway.get_url: failed to read config")
        return ""


def health_check(timeout: int = 3) -> tuple[bool, str]:
    """
    Check if the AI Gateway host is reachable.
    Any HTTP response (even 404) means the server is up.
    Only a connection error or timeout means it is offline.
    Returns (True, "") when reachable, (False, human-readable error) otherwise.
    """
    base = get_url()
    if not base:
        return False, "AI Gateway URL not configured. Go to Settings → Agent Connection."
    try:
        requests.get(f"{base}/api/ai/status", timeout=timeout)
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
