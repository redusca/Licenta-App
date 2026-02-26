import os
import json
from dotenv import load_dotenv

# Load environment variables from .env file
# Expecting .env to be in the same directory as this file or parent
basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

# ---------------------------------------------------------------------------
# App version — read from package.json one level up (APP/package.json).
# This is the ground truth for versioning; bump it there to version the app.
# ---------------------------------------------------------------------------
def _read_app_version() -> str:
    try:
        pkg_path = os.path.join(basedir, '..', 'package.json')
        with open(pkg_path, 'r') as f:
            return json.load(f).get('version', '0.0.0')
    except Exception:
        return '0.0.0'

APP_VERSION: str = _read_app_version()

class Config:
    HOST = os.getenv('FLASK_HOST', '127.0.0.1')
    PORT = int(os.getenv('FLASK_PORT', 5000))
    DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')

config = Config()
