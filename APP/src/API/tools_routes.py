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

import logging
from flask import Blueprint, jsonify, request

from tools import hello as hello_tool
from tools.catalog import TOOLS as CATALOG_TOOLS, CATEGORIES as CATALOG_CATEGORIES

logger = logging.getLogger(__name__)

tools_bp = Blueprint("tools", __name__)

# ── Tool registry ─────────────────────────────────────────────────────────────
# Maps tool name → executor module.  Add new tools here.

_TOOLS: dict[str, object] = {
    "hello": hello_tool,
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
