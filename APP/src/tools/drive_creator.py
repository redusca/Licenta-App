from __future__ import annotations

import json
import os
import logging
from pathlib import Path

from utils.mft_scan import _ensure_cached, invalidate_cache, resolve_dir_mft_prefix, is_admin as _mft_is_admin
from utils.drive_manager import create_drive, add_file
from utils.drives_registry import load_registry, save_registry

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_creator",
    "description": (
        "Scans a folder for specific extensions and creates a NEW virtual drive containing them. "
        "Use this only when the user wants to CREATE a new drive by grouping files. "
        "Do NOT use this to move files between two existing drives — use drive_file_mover for that."
    ),
    "input_instructions": (
        "sourceFolder: the folder to scan — use ask_user(input_type='folder') to pick from the app's virtual drives. "
        "extensions: list of extensions to include, e.g. ['.jpg', '.png', '.mp4']. "
        "driveName: name for the new virtual drive (string). "
        "action: 'shortcuts' to create shortcut links (non-destructive) or 'move' to relocate the actual files. "
        "outputPath: the base folder where the new virtual drive will be created — use ask_user(input_type='folder') to pick from the app's virtual drives."
    ),
    "output_description": (
        "JSON {success, total, succeeded, failed, virtualDrivePath, results:[{path, success, error?}]}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "sourceFolder": {
                "type": "string",
                "description": "Path to the folder to scan."
            },
            "extensions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of file extensions to include (e.g. ['.jpg', '.png'])."
            },
            "driveName": {
                "type": "string",
                "description": "Name of the virtual drive to create."
            },
            "action": {
                "type": "string",
                "enum": ["shortcuts", "move"],
                "description": "Whether to create shortcuts or move the original files."
            },
            "outputPath": {
                "type": "string",
                "description": "The base path where Virtual Drives are stored."
            }
        },
        "required": ["sourceFolder", "extensions", "driveName", "action", "outputPath"]
    }
}

def _walk_for_extensions(folder: str, target_extensions: set) -> list:
    result = []
    for root, _, files in os.walk(folder):
        for fname in files:
            if os.path.splitext(fname)[1].lower() in target_extensions:
                result.append(os.path.join(root, fname))
    return result


def execute(input_data: dict) -> str:
    source_folder = input_data.get("sourceFolder", "")
    extensions = input_data.get("extensions", [])
    drive_name = input_data.get("driveName", "New Drive")
    action = input_data.get("action", "shortcuts")
    output_path = input_data.get("outputPath", "")

    if not source_folder or not os.path.exists(source_folder):
        return json.dumps({"success": False, "error": "Source folder not found."})
    if not output_path or not os.path.isdir(output_path):
        return json.dumps({"success": False, "error": "Invalid Virtual Drives output path."})

    target_extensions = set(ext.lower() if ext.startswith('.') else f'.{ext}'.lower() for ext in extensions)

    drive_letter = os.path.splitdrive(source_folder)[0].replace(":", "") or "C"

    matched_files = []

    # Try MFT first (fast whole-drive scan). MFT can fail silently due to junction
    # path resolution issues (e.g. OneDrive Known Folder Move makes Desktop a
    # junction whose physical path differs from the user-visible path).
    # Rule: only trust the MFT result if it found at least one file. A zero-match
    # MFT result is treated as a potential false negative and os.walk takes over.
    mft_ok = False
    if _mft_is_admin():
        try:
            invalidate_cache(drive_letter)
            cached = _ensure_cached(drive_letter)
            if cached and len(cached.get("records", [])) >= 50:
                mft_prefix = resolve_dir_mft_prefix(cached["path_map"], source_folder)
                if mft_prefix:
                    prefix_lower = mft_prefix.lower()
                    for r in cached["records"]:
                        if r.get("is_dir"):
                            continue
                        rn = r.get("record_num")
                        if rn not in cached["path_map"]:
                            continue
                        full_path = cached["path_map"][rn]
                        if not full_path.lower().startswith(prefix_lower):
                            continue
                        if os.path.splitext(r.get("name", ""))[1].lower() in target_extensions:
                            matched_files.append(full_path)
                    mft_ok = bool(matched_files)
        except Exception as exc:
            logger.error(f"MFT scan failed: {exc}")

    if not mft_ok:
        # MFT unavailable, failed, or returned 0 matches (possible path resolution
        # bug). os.walk is always correct and handles junctions transparently.
        logger.info("Using os.walk for drive_creator (mft_ok=%s)", mft_ok)
        matched_files = _walk_for_extensions(source_folder, target_extensions)

    if not matched_files:
        return json.dumps({
            "success": False,
            "error": f"No files matched the selected extensions in '{source_folder}'.",
        })

    drive_type = "move" if action == "move" else "shortcut"
    try:
        drive_path = create_drive(output_path, drive_name, drive_type)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to create Virtual Drive: {exc}"})

    try:
        normalized_new = os.path.normcase(os.path.normpath(drive_path))
        drives = load_registry()
        exists = any(os.path.normcase(os.path.normpath(d.get("path",""))) == normalized_new for d in drives)
        if not exists:
            drives.append({
                "path": drive_path,
                "name": drive_name
            })
            save_registry(drives)
    except Exception as exc:
        logger.error(f"Failed to register drive in known_drives: {exc}")

    results = []
    for fpath in matched_files:
        try:
            add_file(drive_path, fpath, mode=drive_type)
            results.append({"path": fpath, "success": True})
        except Exception as exc:
            results.append({"path": fpath, "success": False, "error": str(exc)})

    succeeded = sum(1 for r in results if r["success"])
    return json.dumps({
        "success": succeeded > 0,
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "virtualDrivePath": drive_path,
        "results": results
    })
