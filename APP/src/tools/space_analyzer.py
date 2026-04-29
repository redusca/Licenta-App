"""
Space Analyzer tool - Analyze drive or folder space efficiently using MFT scan.
"""
from __future__ import annotations

import json
import logging
from utils.mft_scan import get_space_analyzer_data

logger = logging.getLogger(__name__)

DEFINITION = {
    "name": "space_analyzer",
    "description": "Scans a drive and returns nested folder sizes for visualizing space.",
    "parameters": {
        "type": "object",
        "properties": {
            "driveLetter": {
                "type": "string",
                "description": "Drive letter to scan (e.g. 'C')."
            },
            "targetDir": {
                "type": "string",
                "description": "Optional specific folder path to get children for."
            }
        },
        "required": ["driveLetter"]
    }
}

def execute(input_data: dict) -> str:
    """
    Executes the space analyzer tool logic.
    """
    drive_letter = input_data.get("driveLetter", "C")
    target_dir = input_data.get("targetDir", None)
    
    try:
        data = get_space_analyzer_data(drive_letter.replace(":", ""), target_dir)
        if "error" in data:
            return json.dumps({"success": False, "error": data["error"]})
            
        return json.dumps({"success": True, "data": data})
    except Exception as exc:
        logger.error(f"Space Analyzer error: {exc}")
        return json.dumps({"success": False, "error": str(exc)})
