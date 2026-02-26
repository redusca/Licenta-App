"""
Migration: legacy → 1.0.0
==========================

CHANGELOG
---------
- Added `schema_version` field (string).
- Added `serial`           field (UUIDv4 string) — unique identity per drive.
- Added `app_version_created` field (string) — app version that first created this drive.

COMPATIBLE_APP_VERSIONS
-----------------------
The following application versions all produce / consume schema 1.0.0.
If the next app release does NOT change the config format, add it here (no
new migration file needed).

  1.0.0
"""

import uuid

SCHEMA_VERSION = "1.0.0"

CHANGELOG = (
    "Initial versioned schema. "
    "Adds `serial` (UUIDv4), `schema_version`, and `app_version_created`."
)

# Every APP version whose drives conform to this schema.
# Used purely for documentation / introspection — the runner does not read this.
COMPATIBLE_APP_VERSIONS: list[str] = [
    "1.0.0",
]


def upgrade(config: dict) -> dict:
    """
    Upgrade from legacy (no schema_version) → 1.0.0.

    Legacy config fields:
        name, type, created_at

    New fields added by this migration:
        schema_version     → "1.0.0"
        serial             → fresh UUIDv4  (drives that already exist get one assigned now)
        app_version_created → "unknown"   (we can't know retroactively)
    """
    upgraded = dict(config)

    # Assign a serial if one doesn't exist yet
    if not upgraded.get("serial"):
        upgraded["serial"] = str(uuid.uuid4())

    # Record the schema version (the runner also sets this, but explicit is clear)
    upgraded["schema_version"] = SCHEMA_VERSION

    # Record the app version that created the drive.
    # For legacy drives being migrated we mark it as "unknown".
    if "app_version_created" not in upgraded:
        upgraded["app_version_created"] = "unknown"

    return upgraded


def downgrade(config: dict) -> dict:
    """
    Downgrade from 1.0.0 → legacy.

    Removes the fields that were added in upgrade().
    The serial is lost — acceptable since legacy format had no serial concept.
    """
    downgraded = dict(config)
    downgraded.pop("serial", None)
    downgraded.pop("schema_version", None)
    downgraded.pop("app_version_created", None)
    downgraded.pop("app_version_migrated", None)
    return downgraded
