import os
import sys
from pathlib import Path


def get_data_dir() -> Path:
    """
    Returns the persistent data directory.

    When launched via Electron, APP_DATA_DIR is set explicitly by main.ts so
    both dev mode (python src/main.py) and packaged mode (backend.exe) write
    to the same known location.  Falls back to exe-relative or source-relative
    paths when running standalone (e.g. pytest, direct python invocation).
    """
    env = os.environ.get("APP_DATA_DIR", "").strip()
    if env:
        p = Path(env)
        p.mkdir(parents=True, exist_ok=True)
        return p
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent / "data"
    # Dev standalone: APP/src/utils/paths.py → .parent x3 → APP/ → APP/data/
    return Path(__file__).parent.parent.parent / "data"
