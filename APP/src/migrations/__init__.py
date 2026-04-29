"""
Drive Config Migration System
==============================

CONCEPTS
--------
schema_version  — version of the .drive_config.json *file format* (not the app).
                  Stored inside every drive config.  Only bumps when the JSON
                  structure changes.

app_version     — the application release version from package.json.
                  Recorded inside the config as `app_version_created` /
                  `app_version_migrated`.  Multiple app versions can share the
                  same schema version if nothing changed.

APP_VERSION_TO_SCHEMA  — maps every app version that has ever been released to
                          the schema version it uses.  When two consecutive app
                          versions share the same schema, they both point at the
                          same schema string and NO migration file is needed for
                          the second one.

Migration files — one per *schema* version, named v{major}_{minor}_{patch}.py.
                  Each file must expose:
                    SCHEMA_VERSION: str
                    CHANGELOG: str
                    upgrade(config: dict) -> dict
                    downgrade(config: dict) -> dict

HOW TO ADD A NEW APP VERSION
-----------------------------
  1. Bump "version" in APP/package.json.
  2. If the JSON config format changed:
       python scripts/generate_migration.py --to 1.1.0
     Then fill in the generated upgrade / downgrade stubs.
  3. If *nothing* changed in the config format, just add a line to
     APP_VERSION_TO_SCHEMA below pointing to the existing schema version.
     Done — no migration file needed.
"""

import importlib
import shutil
import os
import json
import datetime
from typing import Optional

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

# Ordered list of ALL schema versions that have ever existed.
# The first entry is ALWAYS "legacy" (drives with no schema_version field).
SCHEMA_VERSIONS: list[str] = [
    "legacy",   # pre-1.0.0 drives — no schema_version, no serial
    "1.0.0",    # first versioned schema — adds serial + schema_version
]

# Every app version ever released → the schema version it uses.
# Multiple app versions can map to the same schema version.
APP_VERSION_TO_SCHEMA: dict[str, str] = {
    # app ver  :  schema ver
    "1.0.0"   :  "1.0.0",
    # "1.0.1" :  "1.0.0",   ← example: next app version, schema unchanged
    # "1.1.0" :  "1.1.0",   ← example: schema bumped → create v1_1_0.py
}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _module_name(schema_version: str) -> str:
    """'1.0.0' → 'migrations.v1_0_0'"""
    return "migrations.v" + schema_version.replace(".", "_")


def _load_migration(schema_version: str):
    """Dynamically import the migration module for a schema version."""
    if schema_version == "legacy":
        return None
    mod_name = _module_name(schema_version)
    try:
        return importlib.import_module(mod_name)
    except ModuleNotFoundError:
        raise RuntimeError(
            f"Migration module '{mod_name}' not found. "
            f"Run: python scripts/generate_migration.py --to {schema_version}"
        )


def _schema_index(version: str) -> int:
    try:
        return SCHEMA_VERSIONS.index(version)
    except ValueError:
        raise ValueError(
            f"Unknown schema version '{version}'. "
            f"Known versions: {SCHEMA_VERSIONS}"
        )


def get_latest_schema_version() -> str:
    return SCHEMA_VERSIONS[-1]


def get_schema_for_app_version(app_version: str) -> Optional[str]:
    return APP_VERSION_TO_SCHEMA.get(app_version)


# ---------------------------------------------------------------------------
# Migration runner
# ---------------------------------------------------------------------------

def migrate_config(config: dict, target_schema: Optional[str] = None) -> tuple[dict, bool]:
    """
    Migrate *config* to *target_schema* (default: latest).

    Returns (migrated_config, was_changed).
    Applies upgrades or downgrades in sequence.
    Each step calls upgrade() / downgrade() from the matching migration module.
    """
    if target_schema is None:
        target_schema = get_latest_schema_version()

    current = config.get("schema_version", "legacy")

    if current == target_schema:
        return config, False

    cur_idx = _schema_index(current)
    tgt_idx = _schema_index(target_schema)

    cfg = dict(config)

    if tgt_idx > cur_idx:
        # Upgrade path — walk forward
        for idx in range(cur_idx + 1, tgt_idx + 1):
            schema_ver = SCHEMA_VERSIONS[idx]
            mod = _load_migration(schema_ver)
            cfg = mod.upgrade(cfg)
            cfg["schema_version"] = schema_ver
    else:
        # Downgrade path — walk backward
        for idx in range(cur_idx, tgt_idx, -1):
            schema_ver = SCHEMA_VERSIONS[idx]
            mod = _load_migration(schema_ver)
            cfg = mod.downgrade(cfg)
            cfg["schema_version"] = SCHEMA_VERSIONS[idx - 1] if idx - 1 >= 0 else "legacy"

    cfg["schema_version"] = target_schema
    return cfg, True


# ---------------------------------------------------------------------------
# Public API used by drive_manager
# ---------------------------------------------------------------------------

CONFIG_FILENAME = ".drive_config.json"


def load_and_migrate(drive_path: str, current_app_version: str) -> Optional[dict]:
    """
    Read the drive config, auto-migrate to the latest schema, write back if
    changed.  Returns the up-to-date config dict, or None if not found.
    """
    config_path = os.path.join(drive_path, CONFIG_FILENAME)
    if not os.path.exists(config_path):
        return None

    try:
        # Unhide the file temporarily on Windows so we can write it back
        import subprocess
        subprocess.call(["attrib", "-h", config_path], shell=True)

        with open(config_path, "r") as f:
            config = json.load(f)

        migrated, changed = migrate_config(config)

        if changed:
            # Keep a backup with timestamp before overwriting
            ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            backup_path = config_path + f".bak_{ts}"
            shutil.copy2(config_path, backup_path)
            subprocess.call(["attrib", "+h", backup_path], shell=True)

            migrated["app_version_migrated"] = current_app_version
            with open(config_path, "w") as f:
                json.dump(migrated, f, indent=2)

        subprocess.call(["attrib", "+h", config_path], shell=True)
        return migrated

    except Exception as e:
        print(f"[migrations] Error loading/migrating drive at '{drive_path}': {e}")
        return None


def list_available_migrations() -> list[dict]:
    """Return info about every known migration (useful for a debug/status UI)."""
    result = []
    for ver in SCHEMA_VERSIONS:
        if ver == "legacy":
            result.append({"schema_version": ver, "changelog": "Original format — no versioning."})
            continue
        try:
            mod = _load_migration(ver)
            result.append({
                "schema_version": ver,
                "changelog": getattr(mod, "CHANGELOG", ""),
                "compatible_app_versions": getattr(mod, "COMPATIBLE_APP_VERSIONS", []),
            })
        except RuntimeError as e:
            result.append({"schema_version": ver, "error": str(e)})
    return result


def migrate_all_known_drives(drive_paths: list[str], current_app_version: str) -> list[dict]:
    """
    Called ONCE on app startup.

    Iterates over every drive path the frontend knows about and runs
    load_and_migrate() on each.  Drives that are already at the latest
    schema are skipped instantly (no I/O except reading the config).
    Drives whose config file is missing (e.g. USB not inserted) are skipped
    gracefully — they will be migrated the next time they are accessed.

    Returns a list of per-drive result dicts:
        { path, status, previous_schema, current_schema, error }
    where status is one of: "migrated", "already_current", "skipped", "error".
    """
    import subprocess

    latest = get_latest_schema_version()
    results = []

    for drive_path in drive_paths:
        config_path = os.path.join(drive_path, CONFIG_FILENAME)

        if not os.path.exists(config_path):
            results.append({
                "path": drive_path,
                "status": "skipped",
                "reason": "config file not found (drive may be disconnected)",
            })
            continue

        try:
            subprocess.call(["attrib", "-h", config_path], shell=True)

            with open(config_path, "r") as f:
                raw = json.load(f)

            previous_schema = raw.get("schema_version", "legacy")

            if previous_schema == latest:
                subprocess.call(["attrib", "+h", config_path], shell=True)
                results.append({
                    "path": drive_path,
                    "status": "already_current",
                    "schema": latest,
                })
                continue

            migrated, changed = migrate_config(raw)

            if changed:
                ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
                backup_path = config_path + f".bak_{ts}"
                shutil.copy2(config_path, backup_path)
                subprocess.call(["attrib", "+h", backup_path], shell=True)

                migrated["app_version_migrated"] = current_app_version
                with open(config_path, "w") as f:
                    json.dump(migrated, f, indent=2)

                print(
                    f"[startup-migrate] {drive_path}: "
                    f"{previous_schema} → {migrated.get('schema_version', latest)}"
                )

            subprocess.call(["attrib", "+h", config_path], shell=True)

            results.append({
                "path": drive_path,
                "status": "migrated" if changed else "already_current",
                "previous_schema": previous_schema,
                "current_schema": migrated.get("schema_version", latest),
            })

        except Exception as e:
            print(f"[startup-migrate] ERROR on '{drive_path}': {e}")
            results.append({
                "path": drive_path,
                "status": "error",
                "error": str(e),
            })

    migrated_count = sum(1 for r in results if r.get("status") == "migrated")
    print(f"[startup-migrate] Done — {migrated_count}/{len(drive_paths)} drives migrated.")
    return results
