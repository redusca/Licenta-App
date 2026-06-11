"""
Drive List — agent tool that returns all registered virtual drives with file counts.
Read-only, no approval needed. Use this before any drive operation to orient the agent.
"""
from __future__ import annotations

import json
import logging
import os

from utils.drive_manager import CONFIG_FILENAME
from utils.drives_registry import load_registry

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "drive_list",
    "description": (
        "List all registered virtual drives with their paths, file counts, and types. "
        "Call this first when the user references a drive by name — it resolves names to paths "
        "and shows what drives are available before doing move/rename/delete operations."
    ),
    "input_instructions": (
        "No required inputs. Optionally pass includeFileCount=true (default) to count files per drive."
    ),
    "output_description": (
        "JSON {drives: [{name, path, fileCount, type, exists}], total}"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "includeFileCount": {
                "type": "boolean",
                "description": "Whether to count files in each drive (default true).",
            }
        },
        "required": [],
    },
}


def _count_files(drive_path: str) -> int:
    try:
        return sum(
            1 for e in os.scandir(drive_path)
            if e.name != CONFIG_FILENAME and e.is_file(follow_symlinks=False)
        )
    except Exception:
        return -1


def execute(input_data: dict) -> str:
    include_count = input_data.get("includeFileCount", True)

    try:
        registry = load_registry()
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Could not load drive registry: {exc}"})

    drives = []
    for entry in registry:
        path = entry.get("path", "")
        name = entry.get("name", "") or os.path.basename(path)
        exists = os.path.isdir(path)

        record: dict = {"name": name, "path": path, "exists": exists}

        if exists:
            if include_count:
                record["fileCount"] = _count_files(path)
            config_path = os.path.join(path, CONFIG_FILENAME)
            if os.path.exists(config_path):
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f)
                    record["type"] = cfg.get("type", "unknown")
                except Exception:
                    record["type"] = "unknown"
            else:
                record["type"] = "unknown"
        else:
            record["fileCount"] = 0
            record["type"] = "unknown"

        drives.append(record)

    return json.dumps({"success": True, "drives": drives, "total": len(drives)})
