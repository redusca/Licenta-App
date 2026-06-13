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
    if not name_or_path:
        return None
    value = name_or_path.strip()

    if os.path.isabs(value) and os.path.isdir(value):
        return value

    norm = value.lower()

    try:
        registry = load_registry()
    except Exception:
        registry = []

    for entry in registry:
        ep: str = entry.get("path", "")
        en: str = entry.get("name", "")
        if not os.path.isdir(ep):
            continue
        if en.lower() == norm or os.path.basename(ep).lower() == norm:
            return ep

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

    if os.path.isdir(value):
        return os.path.abspath(value)

    return None


def save_registry(drives: list[dict]) -> None:
    _ensure_data_dir()

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
