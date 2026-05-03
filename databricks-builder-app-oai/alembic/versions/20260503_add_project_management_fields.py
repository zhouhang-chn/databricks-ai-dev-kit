"""Add project management metadata and settings.

Revision ID: 20260503_project_management
Revises: 20260502_openai_agent_session
Create Date: 2026-05-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '20260503_project_management'
down_revision: Union[str, None] = '20260502_openai_agent_session'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
  """Add additive project-management fields."""
  op.add_column('projects', sa.Column('description', sa.Text(), nullable=True))
  op.add_column(
    'projects',
    sa.Column(
      'project_type',
      sa.String(50),
      nullable=False,
      server_default='databricks_app_build',
    ),
  )
  op.add_column(
    'projects',
    sa.Column('status', sa.String(50), nullable=False, server_default='draft'),
  )
  op.add_column('projects', sa.Column('settings_json', sa.Text(), nullable=True))
  op.add_column(
    'projects',
    sa.Column(
      'current_release_id',
      sa.String(100),
      nullable=False,
      server_default='draft',
    ),
  )
  op.add_column(
    'projects',
    sa.Column(
      'updated_at',
      sa.DateTime(timezone=True),
      nullable=False,
      server_default=sa.func.now(),
    ),
  )


def downgrade() -> None:
  """Remove project-management fields."""
  op.drop_column('projects', 'updated_at')
  op.drop_column('projects', 'current_release_id')
  op.drop_column('projects', 'settings_json')
  op.drop_column('projects', 'status')
  op.drop_column('projects', 'project_type')
  op.drop_column('projects', 'description')
