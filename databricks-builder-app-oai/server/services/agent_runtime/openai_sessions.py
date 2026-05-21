"""OpenAI Agents SDK session helpers."""

import os
from pathlib import Path

from .openai_warning_filters import suppress_known_agents_dependency_warnings


def build_session_id(project_id: str, conversation_id: str) -> str:
  """Return a stable session key for SDK-managed model memory."""
  return f'builder:{project_id}:{conversation_id}'


def get_openai_session(project_id: str, conversation_id: str):
  """Create a persistent local SDK session.

  This is the local/MVP path. A later phase can swap this for
  SQLAlchemySession against the app database without changing callers.
  """
  suppress_known_agents_dependency_warnings()
  from agents import SQLiteSession

  session_id = build_session_id(project_id, conversation_id)
  db_path = os.environ.get('OPENAI_SESSION_DB_PATH')
  if not db_path:
    base_dir = Path(os.environ.get('PROJECTS_BASE_DIR', './projects'))
    db_path = str(base_dir / '.openai_agent_sessions.sqlite3')

  Path(db_path).parent.mkdir(parents=True, exist_ok=True)
  return SQLiteSession(session_id, db_path)
