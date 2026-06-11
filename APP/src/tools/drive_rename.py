"""
Drive Rename — agent tool to rename the display name of an existing virtual drive.
Updates both the drive's internal config and the known-drives registry.
Requires user approval before applying.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import rename_drive_config
from utils.drives_registry import load_registry, save_registry, resolve_drive

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_rename",
    "description": (
        "Rename the display name of an existing virtual drive. "
        "Updates the drive config and the drives registry so the new name appears everywhere. "
        "The folder path does NOT change — only the display label."
    ),
    "requires_approval": True,
    "input_instructions": (
        "driveName: the current display name or absolute path of the drive to rename. "
        "newName: the new display name for the drive (string, no slashes)."
    ),
    "output_description": "JSON {success, oldName, newName, path}",
    "parameters": {
        "type": "object",
        "properties": {
            "driveName": {
                "type": "string",
                "description": "Current display name or absolute path of the drive to rename.",
            },
            "newName": {
                "type": "string",
                "description": "New display name for the drive.",
            },
        },
        "required": ["driveName", "newName"],
    },
}



def execute(input_data: dict) -> str:
    current_name = (input_data.get("driveName") or "").strip()
    new_name = (input_data.get("newName") or "").strip()

    if not current_name:
        return json.dumps({"success": False, "error": "driveName is required."})
    if not new_name:
        return json.dumps({"success": False, "error": "newName is required."})
    if any(c in new_name for c in r'\/:*?"<>|'):
        return json.dumps({"success": False, "error": "newName contains invalid characters."})

    drive_path = resolve_drive(current_name)
    if not drive_path:
        return json.dumps({"success": False, "error": f"Drive not found: '{current_name}'"})

    old_name = current_name
    try:
        drives = load_registry()
        for entry in drives:
            if os.path.normcase(entry.get("path", "")) == os.path.normcase(drive_path):
                old_name = entry.get("name", current_name)
                break
    except Exception:
        pass

    try:
        rename_drive_config(drive_path, new_name)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to update drive config: {exc}"})

    try:
        drives = load_registry()
        for entry in drives:
            if os.path.normcase(entry.get("path", "")) == os.path.normcase(drive_path):
                entry["name"] = new_name
        save_registry(drives)
    except Exception as exc:
        logger.warning("drive_rename: registry update failed: %s", exc)

    return json.dumps({
        "success": True,
        "oldName": old_name,
        "newName": new_name,
        "path": drive_path,
    })
