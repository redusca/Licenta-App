"""
Drive File Mover — agent tool for moving all files from one existing virtual
drive (or folder) into another existing virtual drive (or folder).

Use this when the user says things like:
  "move all files from DriveA to DriveB"
  "transfer everything from SVGVectorResults into drivefain3"
  "copy files from folder X to drive Y"

Do NOT use drive_creator for this — that tool scans for files by extension and
creates a brand-new drive. This tool moves content between two existing drives.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import move_drive_contents, paste_items
from utils.drives_registry import load_registry, resolve_drive

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_file_mover",
    "description": (
        "Move or copy all files from one existing virtual drive (or folder) into another existing virtual drive (or folder). "
        "Use this when the user asks to move/transfer/copy files FROM one drive TO another. "
        "Do NOT use drive_creator for this task — drive_creator scans a folder by extension and builds a brand-new drive. "
        "This tool works on drives that already exist."
    ),
    "requires_approval": True,
    "input_instructions": (
        "sourceDrive: the name or full path of the source virtual drive to move files FROM. "
        "Use ask_user(input_type='folder') if you need the user to pick the source. "
        "destinationDrive: the name or full path of the destination virtual drive to move files INTO. "
        "Use ask_user(input_type='folder') if you need the user to pick the destination. "
        "action: 'move' to relocate the files (default) or 'copy' to duplicate them. "
        "Both sourceDrive and destinationDrive accept either a display name (e.g. 'drivefain3') "
        "or an absolute path. Names are resolved via the known-drives registry."
    ),
    "output_description": (
        "JSON {success, moved, failed, sourcePath, destinationPath, errors:[{path, error}]}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sourceDrive": {
                "type": "string",
                "description": "Name or absolute path of the source virtual drive to move files from.",
            },
            "destinationDrive": {
                "type": "string",
                "description": "Name or absolute path of the destination virtual drive to move files into.",
            },
            "action": {
                "type": "string",
                "enum": ["move", "copy"],
                "description": "'move' relocates the files (default); 'copy' duplicates them.",
            },
        },
        "required": ["sourceDrive", "destinationDrive"],
    },
}




def execute(input_data: dict) -> str:
    source_raw = (input_data.get("sourceDrive") or "").strip()
    dest_raw = (input_data.get("destinationDrive") or "").strip()
    action = (input_data.get("action") or "move").lower()

    if not source_raw:
        return json.dumps({"success": False, "error": "sourceDrive is required."})
    if not dest_raw:
        return json.dumps({"success": False, "error": "destinationDrive is required."})
    if action not in ("move", "copy"):
        action = "move"

    source_path = resolve_drive(source_raw)
    if not source_path:
        return json.dumps({
            "success": False,
            "error": f"Source drive not found: '{source_raw}'. Check the drive name or provide the full path.",
        })

    dest_path = resolve_drive(dest_raw)
    if not dest_path:
        return json.dumps({
            "success": False,
            "error": f"Destination drive not found: '{dest_raw}'. Check the drive name or provide the full path.",
        })

    if os.path.normcase(source_path) == os.path.normcase(dest_path):
        return json.dumps({"success": False, "error": "Source and destination are the same drive."})

    try:
        if action == "move":
            summary = move_drive_contents(source_path, dest_path)
            moved_count = len(summary.get("moved", []))
            errors = summary.get("errors", [])
        else:
            # copy: enumerate source, skip config, use paste_items
            from utils.drive_manager import CONFIG_FILENAME
            items = [
                e.path for e in os.scandir(source_path)
                if e.name != CONFIG_FILENAME
            ]
            paste_items(items, dest_path, mode="copy")
            moved_count = len(items)
            errors = []
    except Exception as exc:
        logger.exception("drive_file_mover failed")
        return json.dumps({"success": False, "error": str(exc)})

    return json.dumps({
        "success": True,
        "action": action,
        "moved": moved_count,
        "failed": len(errors),
        "sourcePath": source_path,
        "destinationPath": dest_path,
        "errors": errors,
    })
