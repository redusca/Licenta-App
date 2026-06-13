import os
import sys
from pathlib import Path


def get_data_dir() -> Path:
    env = os.environ.get("APP_DATA_DIR", "").strip()
    if env:
        p = Path(env)
        p.mkdir(parents=True, exist_ok=True)
        return p
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent / "data"
    return Path(__file__).parent.parent.parent / "data"
