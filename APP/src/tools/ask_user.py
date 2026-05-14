"""
ask_user — lets the planning agent request information directly from the user.

The agent calls this tool whenever it needs input that the user must supply:
a folder path, a file path, a drive letter, a yes/no decision, or any text.

The APP shows a modal with the question and an appropriate input control.
The user fills in their answer, approves, and the tool returns it as a string.
The agent then uses that answer in subsequent steps.

input_type values:
  "text"    - free-text input
  "folder"  - folder path picker (filesystem browser — includes PC drives)
  "file"    - file path picker (filesystem browser — includes PC drives)
  "drive"   - drive letter dropdown (C, D, ...)
  "yesno"   - Yes / No decision buttons
  "output"  - 3-button picker: Copy / Folder / Drive
  "options" - list of choice buttons + a final free-text 'Other' field;
              supply choices via the 'options' parameter
"""
from __future__ import annotations

DEFINITION = {
    "name": "ask_user",
    "description": (
        "Ask the user a question and collect their response. "
        "Use this whenever you need input that only the user can provide: "
        "a target folder, a source file, a drive letter, a yes/no decision, "
        "a choice from a list, or any other value. "
        "Set input_type to match the kind of input expected. "
        "Leave the 'answer' field blank — the user will fill it in."
    ),
    "requires_approval": True,
    "input_instructions": "Read the question above and provide your answer.",
    "output_description": "The user's answer returned as a string to the agent.",
    "parameters": {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The question shown to the user.",
            },
            "input_type": {
                "type": "string",
                "enum": ["text", "folder", "file", "drive", "yesno", "output", "options"],
                "description": (
                    "Controls what input UI appears: "
                    "text, folder, file, drive, yesno, output, or options. "
                    "Use 'output' when asking where to save results — the user "
                    "will see three options: Copy (same folder as input), "
                    "Folder (pick a folder), Drive (pick a virtual drive). "
                    "Use 'options' when presenting a fixed set of choices — "
                    "supply the choices via the 'options' field; a free-text "
                    "'Other' field is always appended at the end."
                ),
            },
            "options": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Used with input_type='options'. "
                    "List of choice strings to show the user as selectable buttons. "
                    "A free-text 'Other…' option is always added automatically."
                ),
            },
            "answer": {
                "type": "string",
                "description": "Leave empty — the user fills this in via the modal.",
            },
        },
        "required": ["question", "input_type", "answer"],
    },
}


def execute(input_data: dict) -> str:
    """Return the user's answer directly to the agent."""
    answer = str(input_data.get("answer", "")).strip()
    return answer if answer else "(no answer provided)"
