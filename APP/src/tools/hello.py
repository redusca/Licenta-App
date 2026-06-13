from __future__ import annotations


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




def execute(input: dict) -> str:
    name = input.get("name") or "world"
    return (
        f"Hello, {name}! "
        "The APP ↔ agent pipeline is working correctly. "
        "Tool executed on the local APP and result returned to the agent. ✓"
    )
