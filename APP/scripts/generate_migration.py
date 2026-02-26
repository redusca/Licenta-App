#!/usr/bin/env python3
"""
generate_migration.py — Dev tool for the drive-config migration system
=======================================================================

USAGE
-----
New app version WITH a schema change (new migration file created):
    python scripts/generate_migration.py --to 1.1.0 --schema-changed

New app version WITHOUT a schema change (no new file needed):
    python scripts/generate_migration.py --to 1.0.1

In the second case the script just wires the new app version to the existing
latest schema version so the migration runner stays in sync.

WHAT IT DOES
------------
--schema-changed
    1. Creates  src/migrations/v{to_underscored}.py  with documented stubs.
    2. Inserts  "{to_version}"  into SCHEMA_VERSIONS in migrations/__init__.py.
    3. Adds     "{to_version}": "{to_version}" to APP_VERSION_TO_SCHEMA.
    4. Reminds you to fill in upgrade() / downgrade() and CHANGELOG.

(no --schema-changed)
    1. Adds  "{to_version}": "{latest_schema}"  to APP_VERSION_TO_SCHEMA.
    2. Appends the app version to COMPATIBLE_APP_VERSIONS in the latest migration file.
    3. No new migration file is created.
"""

import argparse
import os
import re
import sys
import textwrap

# ---------------------------------------------------------------------------
# Paths (relative to repo root APP/src)
# ---------------------------------------------------------------------------
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT    = os.path.dirname(SCRIPT_DIR)          # APP/
SRC_DIR      = os.path.join(REPO_ROOT, "src")
MIGRATION_DIR = os.path.join(SRC_DIR, "migrations")
INIT_PATH    = os.path.join(MIGRATION_DIR, "__init__.py")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _underscored(version: str) -> str:
    return version.replace(".", "_")


def _migration_path(version: str) -> str:
    return os.path.join(MIGRATION_DIR, f"v{_underscored(version)}.py")


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _get_latest_schema_from_init(init_src: str) -> str:
    """Parse the last non-'legacy' entry in SCHEMA_VERSIONS list."""
    m = re.search(r"SCHEMA_VERSIONS\s*:\s*list\[str\]\s*=\s*\[(.*?)\]", init_src, re.DOTALL)
    if not m:
        sys.exit("ERROR: Could not find SCHEMA_VERSIONS list in migrations/__init__.py")
    entries = re.findall(r'"([^"]+)"', m.group(1))
    non_legacy = [e for e in entries if e != "legacy"]
    if not non_legacy:
        sys.exit("ERROR: SCHEMA_VERSIONS has no versioned entries (only 'legacy').")
    return non_legacy[-1]


def _assert_version_not_registered(version: str, init_src: str) -> None:
    if f'"{version}"' in init_src:
        sys.exit(
            f"ERROR: Version '{version}' is already registered in migrations/__init__.py.\n"
            f"       Nothing to do — remove the entry first if you want to re-generate."
        )


# ---------------------------------------------------------------------------
# Case 1: schema changed — create new migration file + update __init__.py
# ---------------------------------------------------------------------------

MIGRATION_TEMPLATE = '''\
"""
Migration: {prev_schema} -> {new_schema}
{'=' * (len("Migration: ") + len("{prev_schema}") + 4 + len("{new_schema}"))}

CHANGELOG
---------
# TODO: describe what changed in this schema version.
#   e.g. "Added `tags` field (list of strings). Removed unused `legacy_flag`."

COMPATIBLE_APP_VERSIONS
-----------------------
The following application versions all produce / consume schema {new_schema}.
If the next app release does NOT change the config format, add it here (no
new migration file needed).

  {new_schema}
"""

SCHEMA_VERSION = "{new_schema}"

CHANGELOG = (
    "TODO: describe what changed."
)

COMPATIBLE_APP_VERSIONS: list[str] = [
    "{new_schema}",
]


def upgrade(config: dict) -> dict:
    """
    Upgrade from schema {prev_schema} → {new_schema}.

    TODO: implement field additions / removals / renames.

    Example:
        upgraded = dict(config)
        upgraded["new_field"] = "default_value"
        upgraded.pop("removed_field", None)
        return upgraded
    """
    upgraded = dict(config)
    # ---- YOUR UPGRADE LOGIC HERE ----
    raise NotImplementedError(
        "upgrade() not yet implemented for {new_schema}. "
        "Edit src/migrations/v{new_schema_u}.py"
    )
    return upgraded  # noqa: unreachable — remove after implementing


def downgrade(config: dict) -> dict:
    """
    Downgrade from schema {new_schema} → {prev_schema}.

    TODO: reverse what upgrade() does.
    """
    downgraded = dict(config)
    # ---- YOUR DOWNGRADE LOGIC HERE ----
    raise NotImplementedError(
        "downgrade() not yet implemented for {new_schema}. "
        "Edit src/migrations/v{new_schema_u}.py"
    )
    return downgraded  # noqa: unreachable — remove after implementing
'''


def create_migration_file(new_schema: str, prev_schema: str) -> None:
    path = _migration_path(new_schema)
    if os.path.exists(path):
        sys.exit(
            f"ERROR: Migration file already exists:\n  {path}\n"
            f"       Delete it first if you want to regenerate."
        )

    content = MIGRATION_TEMPLATE.format(
        prev_schema=prev_schema,
        new_schema=new_schema,
        new_schema_u=_underscored(new_schema),
    )
    _write(path, content)
    print(f"  [created] {os.path.relpath(path, REPO_ROOT)}")


def register_new_schema(init_src: str, new_schema: str) -> str:
    """Insert new_schema into SCHEMA_VERSIONS and APP_VERSION_TO_SCHEMA."""

    # 1. Insert into SCHEMA_VERSIONS (append before closing bracket)
    updated = re.sub(
        r'(SCHEMA_VERSIONS\s*:\s*list\[str\]\s*=\s*\[)(.*?)(\])',
        lambda m: m.group(1) + m.group(2).rstrip() + f'\n    "{new_schema}",    # ← added by generate_migration.py\n' + m.group(3),
        init_src,
        flags=re.DOTALL,
    )

    # 2. Insert into APP_VERSION_TO_SCHEMA (append before closing brace)
    entry = f'    "{new_schema}"   :  "{new_schema}",\n'
    updated = re.sub(
        r'(APP_VERSION_TO_SCHEMA\s*:\s*dict\[str,\s*str\]\s*=\s*\{)(.*?)(\})',
        lambda m: m.group(1) + m.group(2).rstrip('\n') + '\n' + entry + m.group(3),
        updated,
        flags=re.DOTALL,
    )

    return updated


# ---------------------------------------------------------------------------
# Case 2: no schema change — just wire up the new app version
# ---------------------------------------------------------------------------

def register_alias_app_version(init_src: str, app_version: str, target_schema: str) -> str:
    """Add app_version → target_schema to APP_VERSION_TO_SCHEMA."""
    entry = f'    # "{app_version}"   :  "{target_schema}",   ← no schema change\n    "{app_version}"   :  "{target_schema}",\n'
    updated = re.sub(
        r'(APP_VERSION_TO_SCHEMA\s*:\s*dict\[str,\s*str\]\s*=\s*\{)(.*?)(\})',
        lambda m: m.group(1) + m.group(2).rstrip('\n') + '\n' + entry + m.group(3),
        init_src,
        flags=re.DOTALL,
    )
    return updated


def append_to_compatible_versions(migration_path: str, app_version: str) -> None:
    """Add app_version to COMPATIBLE_APP_VERSIONS in the latest migration file."""
    src = _read(migration_path)
    updated = re.sub(
        r'(COMPATIBLE_APP_VERSIONS\s*:\s*list\[str\]\s*=\s*\[)(.*?)(\])',
        lambda m: m.group(1) + m.group(2).rstrip() + f'\n    "{app_version}",\n' + m.group(3),
        src,
        flags=re.DOTALL,
    )
    if updated == src:
        print(f"  [warn] Could not auto-patch COMPATIBLE_APP_VERSIONS in {os.path.basename(migration_path)}.")
        print(f"         Add \"{app_version}\" manually.")
    else:
        _write(migration_path, updated)
        print(f"  [updated] Added '{app_version}' to COMPATIBLE_APP_VERSIONS in {os.path.basename(migration_path)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scaffold a new migration or register a no-change app version.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            examples:
              python scripts/generate_migration.py --to 1.1.0 --schema-changed
              python scripts/generate_migration.py --to 1.0.1
        """),
    )
    parser.add_argument("--to", required=True, metavar="VERSION",
                        help="The new app/schema version being released (e.g. 1.1.0)")
    parser.add_argument("--schema-changed", action="store_true",
                        help="Pass this flag when the drive config JSON format changed.")
    args = parser.parse_args()

    new_version = args.to.strip()
    schema_changed = args.schema_changed

    print(f"\n=== generate_migration  --to {new_version}  schema-changed={schema_changed} ===\n")

    init_src = _read(INIT_PATH)
    _assert_version_not_registered(new_version, init_src)
    latest_schema = _get_latest_schema_from_init(init_src)

    if schema_changed:
        # ---- New schema version ----
        print(f"  Creating migration file:  {new_version}  (from {latest_schema})")
        create_migration_file(new_version, latest_schema)
        updated_init = register_new_schema(init_src, new_version)
        _write(INIT_PATH, updated_init)
        print(f"  [updated] migrations/__init__.py")
        print()
        print("  NEXT STEPS:")
        print(f"    1. Open  src/migrations/v{_underscored(new_version)}.py")
        print(f"    2. Fill in  upgrade()  and  downgrade()  functions.")
        print(f"    3. Update the CHANGELOG string.")
        print(f"    4. Bump \"version\" in APP/package.json to {new_version}.")
    else:
        # ---- Alias — same schema, new app version ----
        print(f"  No schema change. Aliasing app version '{new_version}' → schema '{latest_schema}'")
        updated_init = register_alias_app_version(init_src, new_version, latest_schema)
        _write(INIT_PATH, updated_init)
        print(f"  [updated] migrations/__init__.py  (APP_VERSION_TO_SCHEMA)")

        latest_migration_path = _migration_path(latest_schema)
        if os.path.exists(latest_migration_path):
            append_to_compatible_versions(latest_migration_path, new_version)
        else:
            print(f"  [warn] Migration file not found: {latest_migration_path}")

        print()
        print("  NEXT STEPS:")
        print(f"    1. Bump \"version\" in APP/package.json to {new_version}.")
        print(f"    2. (Optional) Add a note to CHANGELOG in v{_underscored(latest_schema)}.py")

    print()
    print("Done.\n")


if __name__ == "__main__":
    main()
