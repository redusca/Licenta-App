"""
Tool executor API — called by the agent container to execute tools locally.

The agent container never runs tool code itself.  When the LLM decides to
call a tool, the container POSTs to this endpoint.  The APP executes the
tool and returns the result; the container feeds it back to the LLM.

Endpoints
---------
POST /api/tools/execute
    Body: { "tool": "<name>", "input": { ...args } }
    Response: { "result": "<string>" }

GET /api/tools
    Returns the list of available tool definitions to register with the agent.
    Each definition includes a `callback_url` pointing back to this endpoint.

GET /api/tools/catalog
    Returns the full UI-facing tool catalog (tools + categories).
    The frontend fetches this once on startup to build the Tools page.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from flask import Blueprint, jsonify, request

from tools import hello as hello_tool
from tools import image_converter as image_converter_tool
from tools.catalog import TOOLS as CATALOG_TOOLS, CATEGORIES as CATALOG_CATEGORIES

logger = logging.getLogger(__name__)

tools_bp = Blueprint("tools", __name__)

# Path to the tool-drives registry written by image_converter
_TOOL_DRIVES_PATH = Path(__file__).parent.parent.parent / "data" / "tool_drives.json"

# ── Tool registry ─────────────────────────────────────────────────────────────
# Maps tool name → executor module.  Add new tools here.

_TOOLS: dict[str, object] = {
    "hello": hello_tool,
    "image_converter": image_converter_tool,
}


# ── Routes ────────────────────────────────────────────────────────────────────

@tools_bp.post("/execute")
def execute():
    """
    Execute a tool on behalf of the agent container.

    The container calls this when the LLM decides to invoke a tool.
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    tool_name: str = data.get("tool", "")
    tool_input: dict = data.get("input", {})

    tool = _TOOLS.get(tool_name)
    if tool is None:
        logger.warning("Unknown tool requested: %s", tool_name)
        return jsonify({"error": f"Unknown tool: '{tool_name}'"}), 404

    try:
        result: str = tool.execute(tool_input)
        logger.info("Tool '%s' executed successfully", tool_name)
        return jsonify({"result": result})
    except Exception as exc:
        logger.exception("Tool '%s' raised an error", tool_name)
        return jsonify({"error": f"Tool '{tool_name}' failed: {exc}"}), 500


@tools_bp.get("")
def list_tools():
    """
    Return tool definitions to register with the agent at session init.

    The caller should append `callback_url` pointing to this APP's
    /api/tools/execute endpoint before sending the list to the agent.
    """
    definitions = []
    for name, mod in _TOOLS.items():
        defn = dict(mod.DEFINITION)          # shallow copy so we don't mutate
        defn.setdefault("callback_url", "")  # caller fills this in
        definitions.append(defn)
    return jsonify(definitions)


@tools_bp.get("/catalog")
def get_catalog():
    """
    Return the full UI-facing tool catalog.

    Called by the frontend on startup to populate the Tools page.
    The catalog is built from tools/catalog.py which is loaded once
    when the backend starts.
    """
    return jsonify({
        "tools": CATALOG_TOOLS,
        "categories": CATALOG_CATEGORIES,
    })


@tools_bp.post("/image-converter/run")
def image_converter_run():
    """
    Direct frontend endpoint for the Image Converter tool.
    Uses parallel execution when more than 1 file is provided.

    Body: {
        "files": [{"path": "...", "outputFormat": "png"}, ...],
        "outputMode": "replace" | "copy" | "virtual_drive",
        "outputPath": "C:/...",   # required for virtual_drive mode
        "quality": 85,
        "preserveMetadata": true
    }
    Response: JSON with success, total, succeeded, failed, results, virtualDrivePath?
    """
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    try:
        files = data.get("files", [])
        if len(files) > 1:
            raw = image_converter_tool.execute_parallel(data)
        else:
            raw = image_converter_tool.execute(data)
        result = json.loads(raw)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Image converter failed")
        return jsonify({"error": str(exc)}), 500


@tools_bp.get("/created-drives")
def get_created_drives():
    """
    Return the list of virtual drives created by tools (from tool_drives.json).
    Used by the Tool Drives page in the frontend.
    """
    if not _TOOL_DRIVES_PATH.exists():
        return jsonify({"drives": []})
    try:
        drives = json.loads(_TOOL_DRIVES_PATH.read_text(encoding="utf-8"))
        if not isinstance(drives, list):
            drives = []
        return jsonify({"drives": drives})
    except Exception as exc:
        logger.error("Failed to load tool drives: %s", exc)
        return jsonify({"drives": [], "error": str(exc)})
