"""
Hello tool — connectivity test.

This is the APP-side implementation.  The agent container knows this tool
exists via its ToolDefinition (registered at /api/agent/init).  When the
LLM decides to call it, the container POSTs to the APP's
/api/tools/execute endpoint, which dispatches to this function.
"""
from __future__ import annotations


# ── Tool definition (sent to agent at init) ───────────────────────────────────

DEFINITION = {
    "name": "hello",
    "description": (
        "A connectivity test tool. "
        "When the user asks to test the connection or say hello, "
        "ALWAYS call this tool. It confirms the full APP ↔ agent pipeline "
        "is working. Greet the user warmly using the result."
    ),
    "input_instructions": (
        "Optionally provide 'name' (string) — the name to greet. "
        "Leave empty to greet 'world'."
    ),
    "output_description": "A greeting string confirming the pipeline is working.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Optional name to include in the greeting.",
            }
        },
        "required": [],
    },
}


# ── Tool executor (called by /api/tools/execute) ───────────────────────────────

def execute(input: dict) -> str:
    """Run the hello tool and return a greeting string."""
    name = input.get("name") or "world"
    return (
        f"Hello, {name}! "
        "The APP ↔ agent pipeline is working correctly. "
        "Tool executed on the local APP and result returned to the agent. ✓"
    )
