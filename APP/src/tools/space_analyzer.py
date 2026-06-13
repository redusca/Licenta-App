from __future__ import annotations

import json
import logging
import os
import string

from utils.mft_scan import get_space_analyzer_data

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "space_analyzer",
    "description": (
        "Scan a drive or folder and return nested folder sizes so the user can see what is consuming disk space. "
        "Use this when the user asks: 'what is taking up space', 'show disk usage', 'which folders are largest', "
        "or 'analyze my drive'. The result is displayed as an interactive treemap in the UI. "
        "Provide either driveLetter (to scan an entire drive) OR folderPath (to scan a specific directory)."
    ),
    "input_instructions": (
        "Always ask the user what to scan before calling this tool — never guess or hard-code a path. "
        "To scan an entire drive: use ask_user(input_type='drive') and pass the result as driveLetter (e.g. 'C'). "
        "To scan a specific folder: use ask_user(input_type='folder') and pass the result as folderPath. "
        "Use targetDir only when the user wants to zoom into a subfolder of a drive scan."
    ),
    "output_description": (
        "JSON {success, data: {path, total_size, children: [{name, full_path, is_dir, size}]}} "
        "— nested folder size tree; sizes are in bytes."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "driveLetter": {
                "type": "string",
                "description": (
                    "Drive letter to scan the full drive (e.g. 'C'). "
                    "Mutually exclusive with folderPath."
                ),
            },
            "folderPath": {
                "type": "string",
                "description": (
                    "Full path of a specific folder to scan (e.g. 'C:\\Users\\redis'). "
                    "Use this instead of driveLetter when the user wants to scan a folder."
                ),
            },
            "targetDir": {
                "type": "string",
                "description": (
                    "Optional subfolder path to focus the scan on "
                    "(only used together with driveLetter)."
                ),
            },
        },
        "required": [],
    },
}


def _available_drives() -> list[str]:
    return [d for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]


def execute(input_data: dict) -> str:
    folder_path = (input_data.get("folderPath") or "").strip()
    drive_letter = (input_data.get("driveLetter") or "").strip().replace(":", "")
    target_dir = input_data.get("targetDir", None)

    try:
        if folder_path:
            if not os.path.exists(folder_path):
                return json.dumps({
                    "success": False,
                    "error": f"The path '{folder_path}' does not exist on this system.",
                })
            if not os.path.isdir(folder_path):
                return json.dumps({
                    "success": False,
                    "error": f"'{folder_path}' is not a directory.",
                })
            inferred_drive = os.path.splitdrive(folder_path)[0].replace(":", "").upper() or "C"
            data = get_space_analyzer_data(inferred_drive, folder_path)

        elif drive_letter:
            drive_root = f"{drive_letter.upper()}:\\"
            if not os.path.exists(drive_root):
                available = _available_drives()
                return json.dumps({
                    "success": False,
                    "error": (
                        f"Drive {drive_letter.upper()}: does not exist on this system. "
                        f"Available drives: {', '.join(available)}. "
                        "Please ask the user to pick one of the available drives."
                    ),
                })
            data = get_space_analyzer_data(drive_letter.upper(), target_dir)

        else:
            available = _available_drives()
            return json.dumps({
                "success": False,
                "error": (
                    "No drive or folder specified. "
                    "Use ask_user(input_type='drive') to let the user pick a drive, "
                    "or ask_user(input_type='folder') to pick a folder. "
                    f"Available drives on this system: {', '.join(available)}."
                ),
            })

        if "error" in data:
            return json.dumps({"success": False, "error": data["error"]})

        return json.dumps({"success": True, "data": data})

    except Exception as exc:
        logger.error("Space Analyzer error: %s", exc)
        return json.dumps({"success": False, "error": str(exc)})
