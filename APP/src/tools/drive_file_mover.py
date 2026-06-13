"""
Drive File Mover — agent tool for moving or copying specific files into a
destination virtual drive or folder.

Use this when the user says things like:
  "move these files into DriveA"
  "copy the output file to drivefain3"
  "move the SVG into my party_test drive"
"""
from __future__ import annotations

import json
import logging

from utils.drive_manager import paste_items
from utils.drives_registry import resolve_drive

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_file_mover",
    "description": (
        "Move or copy specific files into a destination virtual drive or folder. "
        "Use this when the user asks to move/transfer/copy files to a drive or folder."
    ),
    "requires_approval": True,
    "input_instructions": (
        "files: list of file objects with 'path' keys for the files to move or copy. "
        "destinationDrive: the name or full path of the destination virtual drive or folder. "
        "Use ask_user(input_type='folder') if you need the user to pick the destination. "
        "action: 'move' to relocate the files (default) or 'copy' to duplicate them."
    ),
    "output_description": (
        "JSON {success, action, moved, failed, destinationPath, errors:[{path, error}]}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                },
                "description": "List of file objects (each with a 'path' key) to move or copy.",
            },
            "destinationDrive": {
                "type": "string",
                "description": "Name or absolute path of the destination virtual drive or folder.",
            },
            "action": {
                "type": "string",
                "enum": ["move", "copy"],
                "description": "'move' relocates the files (default); 'copy' duplicates them.",
            },
        },
        "required": ["files", "destinationDrive"],
    },
}


def execute(input_data: dict) -> str:
    files_raw = input_data.get("files") or []
    dest_raw = (input_data.get("destinationDrive") or "").strip()
    action = (input_data.get("action") or "move").lower()

    if not files_raw:
        return json.dumps({"success": False, "error": "files is required."})
    if not dest_raw:
        return json.dumps({"success": False, "error": "destinationDrive is required."})
    if action not in ("move", "copy"):
        action = "move"

    dest_path = resolve_drive(dest_raw)
    if not dest_path:
        return json.dumps({
            "success": False,
            "error": f"Destination not found: '{dest_raw}'. Check the drive name or provide the full path.",
        })

    file_paths = []
    for f in files_raw:
        p = (f.get("path", "") if isinstance(f, dict) else str(f)).strip()
        if p:
            file_paths.append(p)

    if not file_paths:
        return json.dumps({"success": False, "error": "No valid file paths provided."})

    errors: list[dict] = []
    try:
        paste_items(file_paths, dest_path, mode="cut" if action == "move" else "copy")
    except Exception as exc:
        logger.exception("drive_file_mover failed")
        return json.dumps({"success": False, "error": str(exc)})

    return json.dumps({
        "success": True,
        "action": action,
        "moved": len(file_paths),
        "failed": len(errors),
        "destinationPath": dest_path,
        "errors": errors,
    })
