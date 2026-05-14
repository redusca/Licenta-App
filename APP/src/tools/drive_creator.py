"""
Drive Creator tool - group files from a folder into a Virtual Drive by category/extensions.
"""
from __future__ import annotations

import json
import os
import logging
from pathlib import Path

from utils.mft_scan import _ensure_cached
from utils.drive_manager import create_drive, add_file
from utils.drives_registry import load_registry, save_registry

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_creator",
    "description": "Scans a folder for specific extensions and creates a virtual drive containing them.",
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

def execute(input_data: dict) -> str:
    source_folder = input_data.get("sourceFolder", "")
    if source_folder:
        try:
            source_folder = os.path.realpath(source_folder)
        except Exception:
            pass
    extensions = input_data.get("extensions", [])
    drive_name = input_data.get("driveName", "New Drive")
    action = input_data.get("action", "shortcuts")
    output_path = input_data.get("outputPath", "")

    if not source_folder or not os.path.exists(source_folder):
        return json.dumps({"success": False, "error": "Source folder not found."})
    if not output_path or not os.path.isdir(output_path):
        return json.dumps({"success": False, "error": "Invalid Virtual Drives output path."})

    target_extensions = set(ext.lower() if ext.startswith('.') else f'.{ext}'.lower() for ext in extensions)

    # 1. Use MFT scan to get file list efficiently
    drive_letter = os.path.splitdrive(source_folder)[0].replace(":", "")
    if not drive_letter:
        drive_letter = "C"

    cached = None
    try:
        from utils.mft_scan import invalidate_cache
        invalidate_cache(drive_letter)  # Force fresh MFT read for accuracy
        cached = _ensure_cached(drive_letter)
    except Exception as exc:
        logger.error(f"MFT scan failed: {exc}")

    matched_files = []
    
    if cached:
        records = cached.get("records", [])
        if len(records) == 0:
            return json.dumps({"success": False, "error": "NTFS scan returned 0 records. Ensure your terminal is running as Administrator."})
            
        path_map = cached["path_map"]
        norm_source = os.path.normpath(source_folder).lower()
        if not norm_source.endswith("\\"):
            norm_source += "\\"

        for r in records:
            if r.get("is_dir"):
                continue
            rn = r.get("record_num")
            if rn not in path_map:
                continue
            
            full_path = path_map[rn]
            if not full_path.lower().startswith(norm_source):
                continue
                
            name = r.get("name", "")
            ext = os.path.splitext(name)[1].lower()
            if ext in target_extensions:
                matched_files.append(full_path)
    else:
        # Fallback to os.walk
        for root, dirs, files in os.walk(source_folder):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in target_extensions:
                    matched_files.append(os.path.join(root, file))

    if not matched_files:
        return json.dumps({"success": False, "error": "No files matched the selected extensions in the source folder."})

    # 2. Create the virtual drive folder
    drive_type = "move" if action == "move" else "shortcut"
    try:
        drive_path = create_drive(output_path, drive_name, drive_type)
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to create Virtual Drive: {exc}"})

    # Register in known_drives.json so it is visible immediately in drives UI
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

    # 3. Add files to drive
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
