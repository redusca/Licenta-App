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
from utils.paths import get_data_dir

_DATA_DIR = str(get_data_dir())
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


def resolve_drive(name_or_path: str) -> str | None:
    """
    Resolve a drive name or path string to an absolute directory path.

    Resolution order:
      1. Already an absolute path that exists on disk → return as-is.
      2. Exact case-insensitive match on registry display name.
      3. Exact case-insensitive match on the folder's basename.
      4. Fuzzy: query is a substring of a name, OR a name is a substring of
         the query — only when exactly one registry entry matches.
      5. Fallback: relative/bare path that is a real directory.

    Returns None if nothing matches.
    """
    if not name_or_path:
        return None
    value = name_or_path.strip()

    # 1 — absolute path
    if os.path.isabs(value) and os.path.isdir(value):
        return value

    norm = value.lower()

    try:
        registry = load_registry()
    except Exception:
        registry = []

    # 2 & 3 — exact matches
    for entry in registry:
        ep: str = entry.get("path", "")
        en: str = entry.get("name", "")
        if not os.path.isdir(ep):
            continue
        if en.lower() == norm or os.path.basename(ep).lower() == norm:
            return ep

    # 4 — fuzzy substring match (unique hit only)
    candidates: list[str] = []
    for entry in registry:
        ep = entry.get("path", "")
        en = entry.get("name", "")
        if not os.path.isdir(ep):
            continue
        en_l = en.lower()
        base_l = os.path.basename(ep).lower()
        if norm in en_l or en_l in norm or norm in base_l or base_l in norm:
            if ep not in candidates:
                candidates.append(ep)

    if len(candidates) == 1:
        return candidates[0]

    # 5 — bare relative path
    if os.path.isdir(value):
        return os.path.abspath(value)

    return None


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
