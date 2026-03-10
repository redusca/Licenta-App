"""Replace containers table with agent_keys table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("containers")
    op.execute("DROP TYPE IF EXISTS containermode")
    op.execute("DROP TYPE IF EXISTS containerstatus")

    op.create_table(
        "agent_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("api_key", sa.String(128), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_agent_keys_api_key", "agent_keys", ["api_key"])


def downgrade() -> None:
    op.drop_index("ix_agent_keys_api_key", "agent_keys")
    op.drop_table("agent_keys")

    op.create_table(
        "containers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "mode",
            sa.Enum("server_hosted", "self_hosted", name="containermode"),
            nullable=False,
        ),
        sa.Column("internal_url", sa.String(512), nullable=True),
        sa.Column("docker_container_id", sa.String(128), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "stopped", name="containerstatus"),
            nullable=False,
        ),
        sa.Column("api_key", sa.String(128), nullable=False),
        sa.Column("google_api_key", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
