import uuid

SCHEMA_VERSION = "1.0.0"

CHANGELOG = (
    "Initial versioned schema. "
    "Adds `serial` (UUIDv4), `schema_version`, and `app_version_created`."
)

COMPATIBLE_APP_VERSIONS: list[str] = [
    "1.0.0",
]


def upgrade(config: dict) -> dict:
    upgraded = dict(config)

    if not upgraded.get("serial"):
        upgraded["serial"] = str(uuid.uuid4())

    upgraded["schema_version"] = SCHEMA_VERSION

    if "app_version_created" not in upgraded:
        upgraded["app_version_created"] = "unknown"  # For legacy drives being migrated we mark it as "unknown".

    return upgraded


def downgrade(config: dict) -> dict:
    downgraded = dict(config)
    downgraded.pop("serial", None)
    downgraded.pop("schema_version", None)
    downgraded.pop("app_version_created", None)
    downgraded.pop("app_version_migrated", None)
    return downgraded
