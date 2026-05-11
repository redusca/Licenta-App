"""Initial schema: users and containers tables

Revision ID: 0001
Revises: 
Create Date: 2026-03-03

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()

    if 'users' not in existing:
        op.create_table(
            'users',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('email', sa.String(255), nullable=False, unique=True),
            sa.Column('hashed_password', sa.String(255), nullable=False),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_users_email', 'users', ['email'])

    if 'containers' not in existing:
        op.create_table(
            'containers',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
            sa.Column('mode', sa.Enum('server_hosted', 'self_hosted', name='containermode'), nullable=False),
            sa.Column('internal_url', sa.String(512), nullable=True),
            sa.Column('docker_container_id', sa.String(128), nullable=True),
            sa.Column('status', sa.Enum('pending', 'running', 'stopped', name='containerstatus'), nullable=False),
            sa.Column('api_key', sa.String(128), nullable=False),
            sa.Column('google_api_key', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table('containers')
    op.drop_index('ix_users_email', 'users')
    op.drop_table('users')
    op.execute("DROP TYPE IF EXISTS containermode")
    op.execute("DROP TYPE IF EXISTS containerstatus")
