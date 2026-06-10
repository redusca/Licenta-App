import sys
from pathlib import Path


def get_data_dir() -> Path:
    """
    Returns the persistent data directory.

    PyInstaller --onefile unpacks to a fresh sys._MEIPASS temp dir on every
    launch, so __file__-relative paths are ephemeral.  When frozen we use the
    directory that contains backend.exe instead — it is stable across restarts.
    """
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent / "data"
    # Dev: APP/src/utils/paths.py  →  .parent x3  →  APP/  →  APP/data/
    return Path(__file__).parent.parent.parent / "data"
