"""
Drive Create Empty — agent tool that creates a blank virtual drive folder.

Use this when the user wants a new, empty virtual drive to move or copy files
into later. Unlike drive_creator, this does NOT scan for files — it just
creates the folder structure and registers the drive.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import create_drive
from utils.drives_registry import load_registry, save_registry

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_create_empty",
    "description": (
        "Create a new, empty virtual drive. "
        "Use this when the user wants a blank drive to move or copy files into, "
        "without scanning or selecting files. "
        "After creation the drive is immediately available in the registry."
    ),
    "requires_approval": True,
    "input_instructions": (
        "driveName: display name for the new drive (required, no slashes). "
        "location: the parent folder where the drive folder will be created. "
        "If omitted or unresolvable, the system will use the same parent folder "
        "as the most recently used virtual drive — so leave it empty when the "
        "user does not specify a location. "
        "type: 'move' (the drive will hold real files) or 'shortcut' (default, holds .lnk links)."
    ),
    "output_description": "JSON {success, drivePath, driveName, location}",
    "parameters": {
        "type": "object",
        "properties": {
            "driveName": {
                "type": "string",
                "description": "Display name for the new virtual drive.",
            },
            "location": {
                "type": "string",
                "description": (
                    "Parent folder where the drive will be created. "
                    "Leave empty to use the same location as the last used drive."
                ),
            },
            "type": {
                "type": "string",
                "enum": ["shortcut", "move"],
                "description": "'shortcut' (default) or 'move' drive type.",
            },
        },
        "required": ["driveName"],
    },
}


def execute(input_data: dict) -> str:
    drive_name = (input_data.get("driveName") or "").strip()
    location = (input_data.get("location") or "").strip()
    drive_type = (input_data.get("type") or "shortcut").strip()

    if not drive_name:
        return json.dumps({"success": False, "error": "driveName is required."})
    if any(c in drive_name for c in r'\/:*?"<>|'):
        return json.dumps({"success": False, "error": "driveName contains invalid characters."})
    if drive_type not in ("shortcut", "move"):
        drive_type = "shortcut"

    if not location or not os.path.isdir(location):
        return json.dumps({
            "success": False,
            "error": (
                f"location '{location}' is not a valid directory. "
                "Provide an absolute path or let the system inject the last used drive location."
            ),
        })

    try:
        drive_path = create_drive(location, drive_name, drive_type)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to create drive: {exc}"})

    # Register in known_drives.json
    try:
        norm_new = os.path.normcase(os.path.normpath(drive_path))
        drives = load_registry()
        exists = any(os.path.normcase(os.path.normpath(d.get("path", ""))) == norm_new for d in drives)
        if not exists:
            drives.append({"path": drive_path, "name": drive_name})
            save_registry(drives)
    except Exception as exc:
        logger.warning("drive_create_empty: registry update failed: %s", exc)

    return json.dumps({
        "success": True,
        "drivePath": drive_path,
        "driveName": drive_name,
        "location": location,
    })
