"""
Smart Drive Builder — agent tool that creates a virtual drive from a list of
files selected by the agent after scanning and AI analysis.

Supports flat structure (all files in one folder) and hierarchical structure
(files organized into named sub-folders within the drive).

Requires user approval — the frontend renders a rich SmartDriveBuildApproval
card so the user can review, add, or remove files before the drive is built.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import create_drive, add_file
from utils.drives_registry import load_registry, save_registry

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "smart_drive_build",
    "description": (
        "Create a virtual drive from an agent-curated list of files. "
        "Shows a review modal to the user before building — the user can "
        "add or remove files and choose shortcuts vs. move. "
        "Supports flat drives and hierarchical folder structures inside the drive."
    ),
    "requires_approval": True,
    "input_instructions": (
        "driveName: name for the new virtual drive (string). "
        "outputPath: the folder where the drive will be created — use ask_user(input_type='folder') to pick it. "
        "action: 'shortcuts' (safe, non-destructive) or 'move' (relocate actual files). "
        "files: list of {path, folder?, ai_description?} — 'folder' is an optional sub-folder "
        "name inside the drive (omit for flat structure). "
        "The user will see all files in a review modal and can adjust before confirming."
    ),
    "output_description": (
        "JSON {success, drivePath, total, succeeded, failed, folders_created, results:[{path, folder, success, error?}]}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "driveName": {
                "type": "string",
                "description": "Display name for the new virtual drive.",
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory where the drive folder will be created.",
            },
            "action": {
                "type": "string",
                "enum": ["shortcuts", "move"],
                "description": "'shortcuts' creates .lnk shortcut files; 'move' relocates the originals.",
            },
            "files": {
                "type": "array",
                "description": (
                    "Files to include in the drive. Each item: "
                    "{path: str, folder?: str, ai_description?: str}. "
                    "'folder' is the sub-folder name inside the drive (optional)."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "path":           {"type": "string"},
                        "folder":         {"type": "string"},
                        "ai_description": {"type": "string"},
                    },
                    "required": ["path"],
                },
            },
        },
        "required": ["driveName", "outputPath", "action", "files"],
    },
}


def execute(input_data: dict) -> str:
    drive_name  = input_data.get("driveName", "Smart Drive")
    output_path = input_data.get("outputPath", "")
    action      = input_data.get("action", "shortcuts")
    files       = input_data.get("files", [])

    if not output_path or not os.path.isdir(output_path):
        return json.dumps({"success": False, "error": "Invalid outputPath — directory not found."})
    if not files:
        return json.dumps({"success": False, "error": "No files provided."})

    drive_type = "move" if action == "move" else "shortcut"

    # 1. Create the root virtual drive folder
    try:
        drive_path = create_drive(output_path, drive_name, drive_type)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to create virtual drive: {exc}"})

    # 2. Register in known_drives.json
    try:
        normalized_new = os.path.normcase(os.path.normpath(drive_path))
        drives = load_registry()
        if not any(os.path.normcase(os.path.normpath(d.get("path", ""))) == normalized_new for d in drives):
            drives.append({"path": drive_path, "name": drive_name})
            save_registry(drives)
    except Exception as exc:
        logger.error("Failed to register drive: %s", exc)

    # 3. Process each file — create sub-folders on demand
    created_folders: set[str] = set()
    results: list[dict] = []

    for item in files:
        fpath = item.get("path", "")
        subfolder = (item.get("folder") or "").strip()

        if not fpath or not os.path.isfile(fpath):
            results.append({"path": fpath, "folder": subfolder, "success": False, "error": "File not found"})
            continue

        # Determine target directory
        if subfolder:
            target_dir = os.path.join(drive_path, subfolder)
            if target_dir not in created_folders:
                os.makedirs(target_dir, exist_ok=True)
                created_folders.add(target_dir)
        else:
            target_dir = drive_path

        try:
            add_file(target_dir, fpath, mode=drive_type)
            results.append({"path": fpath, "folder": subfolder or None, "success": True})
        except Exception as exc:
            results.append({"path": fpath, "folder": subfolder or None, "success": False, "error": str(exc)})

    succeeded = sum(1 for r in results if r["success"])
    return json.dumps({
        "success": succeeded > 0,
        "drivePath": drive_path,
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "folders_created": list(created_folders),
        "results": results,
    }, ensure_ascii=False)
