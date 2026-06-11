"""
Drive Inspector — agent tool that lists all files inside a specific virtual drive.
Read-only, no approval needed. Use before move/delete to confirm contents.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import CONFIG_FILENAME
from utils.drives_registry import load_registry, resolve_drive

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_inspector",
    "description": (
        "List all files inside a specific virtual drive (or folder), showing names, sizes, and extensions. "
        "Use this to confirm what's in a drive before moving, deleting, or processing its contents."
    ),
    "input_instructions": (
        "driveName: the display name or absolute path of the drive to inspect. "
        "Use drive_list first if unsure of the exact name."
    ),
    "output_description": (
        "JSON {success, drive: {name, path}, files: [{name, path, size, ext}], total, totalSizeBytes}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "driveName": {
                "type": "string",
                "description": "Display name or absolute path of the drive to inspect.",
            }
        },
        "required": ["driveName"],
    },
}



def _walk_files(drive_path: str) -> list[dict]:
    files = []
    for root, _dirs, filenames in os.walk(drive_path):
        for fname in filenames:
            if fname == CONFIG_FILENAME and root == drive_path:
                continue
            full = os.path.join(root, fname)
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            ext = os.path.splitext(fname)[1].lower()
            files.append({"name": fname, "path": full, "size": size, "ext": ext})
    return files


def execute(input_data: dict) -> str:
    name_or_path = (input_data.get("driveName") or "").strip()
    if not name_or_path:
        return json.dumps({"success": False, "error": "driveName is required."})

    drive_path = resolve_drive(name_or_path)
    if not drive_path:
        return json.dumps({"success": False, "error": f"Drive not found: '{name_or_path}'"})

    display_name = os.path.basename(drive_path)
    try:
        for entry in load_registry():
            if os.path.normcase(entry.get("path", "")) == os.path.normcase(drive_path):
                display_name = entry.get("name", display_name)
                break
    except Exception:
        pass

    files = _walk_files(drive_path)
    total_size = sum(f["size"] for f in files)

    return json.dumps({
        "success": True,
        "drive": {"name": display_name, "path": drive_path},
        "files": files,
        "total": len(files),
        "totalSizeBytes": total_size,
    })
