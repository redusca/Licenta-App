"""
Drive Delete — agent tool to permanently delete a virtual drive folder and remove it
from the registry. This is destructive and irreversible — always requires approval.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import delete_drive
from utils.drives_registry import load_registry, save_registry, resolve_drive

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_delete",
    "description": (
        "Permanently delete a virtual drive folder and all its contents, "
        "and remove it from the drives registry. "
        "WARNING: this is irreversible. Always requires user approval. "
        "Use drive_inspector first to confirm what will be deleted."
    ),
    "requires_approval": True,
    "input_instructions": (
        "driveName: the display name or absolute path of the drive to delete. "
        "Use drive_list to confirm the exact name before calling this."
    ),
    "output_description": "JSON {success, name, path, filesDeleted}",
    "parameters": {
        "type": "object",
        "properties": {
            "driveName": {
                "type": "string",
                "description": "Display name or absolute path of the drive to delete.",
            }
        },
        "required": ["driveName"],
    },
}


def _resolve_with_name(name_or_path: str) -> tuple[str | None, str]:
    """Returns (resolved_path, display_name)."""
    path = resolve_drive(name_or_path)
    if not path:
        return None, name_or_path
    display = name_or_path
    try:
        for entry in load_registry():
            if os.path.normcase(entry.get("path", "")) == os.path.normcase(path):
                display = entry.get("name", "") or os.path.basename(path)
                break
    except Exception:
        display = os.path.basename(path)
    return path, display


def _count_all_files(path: str) -> int:
    count = 0
    try:
        for _root, _dirs, files in os.walk(path):
            count += len(files)
    except Exception:
        pass
    return count


def execute(input_data: dict) -> str:
    name_or_path = (input_data.get("driveName") or "").strip()
    if not name_or_path:
        return json.dumps({"success": False, "error": "driveName is required."})

    drive_path, display_name = _resolve_with_name(name_or_path)
    if not drive_path:
        return json.dumps({"success": False, "error": f"Drive not found: '{name_or_path}'"})

    files_deleted = _count_all_files(drive_path)

    try:
        removed = delete_drive(drive_path)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to delete drive: {exc}"})

    if not removed:
        return json.dumps({"success": False, "error": "Drive folder did not exist."})

    try:
        drives = load_registry()
        norm_path = os.path.normcase(drive_path)
        drives = [d for d in drives if os.path.normcase(d.get("path", "")) != norm_path]
        save_registry(drives)
    except Exception as exc:
        logger.warning("drive_delete: registry cleanup failed: %s", exc)

    return json.dumps({
        "success": True,
        "name": display_name,
        "path": drive_path,
        "filesDeleted": files_deleted,
    })
