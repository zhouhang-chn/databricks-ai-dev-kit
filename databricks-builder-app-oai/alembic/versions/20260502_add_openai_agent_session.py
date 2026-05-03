"""Add OpenAI agent runtime session metadata.

Revision ID: 20260502_openai_agent_session
Revises: 20260327_executions
Create Date: 2026-05-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '20260502_openai_agent_session'
down_revision: Union[str, None] = '20260327_executions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
  """Add runtime-neutral session metadata columns."""
  op.add_column(
    'conversations',
    sa.Column(
      'agent_runtime',
      sa.String(50),
      nullable=False,
      server_default='openai_agents',
    ),
  )
  op.add_column(
    'conversations',
    sa.Column('agent_session_id', sa.String(255), nullable=True),
  )


def downgrade() -> None:
  """Remove runtime-neutral session metadata columns."""
  op.drop_column('conversations', 'agent_session_id')
  op.drop_column('conversations', 'agent_runtime')
