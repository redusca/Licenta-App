"""
drives_registry.py
==================

Persists the list of known drives on the backend so localStorage loss doesn't
wipe the user's drive list.

Storage location: <src>/data/known_drives.json
The file is created automatically on first write.
"""

import os
import json
import shutil
import datetime

# Directory where the registry file lives — APP/src/data/
# __file__ is at APP/src/utils/drives_registry.py
# dirname x1 = APP/src/utils  →  dirname x2 = APP/src  →  join "data" = APP/src/data
_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_REGISTRY_FILE = os.path.join(_DATA_DIR, "known_drives.json")


def _ensure_data_dir() -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)


def load_registry() -> list[dict]:
    """
    Return the full list of known drives stored on the backend.
    Returns an empty list if the registry file doesn't exist yet.
    """
    if not os.path.exists(_REGISTRY_FILE):
        return []
    try:
        with open(_REGISTRY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return []
    except Exception as e:
        print(f"[drives_registry] Error reading registry: {e}")
        return []


def save_registry(drives: list[dict]) -> None:
    """
    Overwrite the registry with *drives*.
    Keeps a timestamped backup of the previous file before writing.
    """
    _ensure_data_dir()

    # Rotate backup
    if os.path.exists(_REGISTRY_FILE):
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup = _REGISTRY_FILE + f".bak_{ts}"
        try:
            shutil.copy2(_REGISTRY_FILE, backup)
        except Exception as e:
            print(f"[drives_registry] Warning: could not create backup: {e}")

    try:
        with open(_REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(drives, f, indent=2)
    except Exception as e:
        print(f"[drives_registry] Error writing registry: {e}")
        raise
