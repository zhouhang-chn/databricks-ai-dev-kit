"""Storage services for Projects, Conversations, and Messages.

Provides user-scoped CRUD operations using async SQLAlchemy.
"""

import json
from typing import Any, Optional

from server.db import Conversation, Execution, Message, Project, session_scope
from server.project_config import (
  DEFAULT_PROJECT_STATUS,
  DEFAULT_PROJECT_TYPE,
  DEFAULT_RELEASE_ID,
  merge_project_settings,
  serialize_project_settings,
)
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload


class ProjectStorage:
  """User-scoped project storage operations."""

  def __init__(self, user_email: str):
    self.user_email = user_email

  async def get_all(self) -> list[Project]:
    """Get all projects for the user, newest first."""
    async with session_scope() as session:
      result = await session.execute(
        select(Project)
        .options(selectinload(Project.conversations))
        .where(Project.user_email == self.user_email)
        .order_by(Project.created_at.desc())
      )
      return list(result.scalars().all())

  async def get(self, project_id: str) -> Optional[Project]:
    """Get a specific project with conversations."""
    async with session_scope() as session:
      result = await session.execute(
        select(Project)
        .options(selectinload(Project.conversations))
        .where(
          Project.id == project_id,
          Project.user_email == self.user_email,
        )
      )
      return result.scalar_one_or_none()

  async def create(
    self,
    name: str,
    description: str | None = None,
    project_type: str | None = None,
    settings: dict[str, Any] | None = None,
  ) -> Project:
    """Create a new project."""
    async with session_scope() as session:
      project = Project(
        name=name,
        description=description,
        project_type=project_type or DEFAULT_PROJECT_TYPE,
        status=DEFAULT_PROJECT_STATUS,
        settings_json=serialize_project_settings(settings),
        current_release_id=DEFAULT_RELEASE_ID,
        user_email=self.user_email,
      )
      session.add(project)
      await session.flush()
      await session.refresh(
        project,
        [
          'id',
          'name',
          'description',
          'project_type',
          'status',
          'settings_json',
          'current_release_id',
          'user_email',
          'created_at',
          'updated_at',
        ],
      )
      # Initialize conversations as empty list for to_dict()
      # (don't use ORM attribute assignment which triggers lazy load)
      project.__dict__['conversations'] = []
      return project

  async def update_name(self, project_id: str, name: str) -> bool:
    """Update project name."""
    project = await self.update(project_id, {'name': name})
    return project is not None

  async def update(self, project_id: str, updates: dict[str, Any]) -> Project | None:
    """Patch project metadata and settings."""
    async with session_scope() as session:
      result = await session.execute(
        select(Project)
        .options(selectinload(Project.conversations))
        .where(
          Project.id == project_id,
          Project.user_email == self.user_email,
        )
      )
      project = result.scalar_one_or_none()
      if not project:
        return None

      for field in (
        'name',
        'description',
        'project_type',
        'status',
        'current_release_id',
      ):
        if field in updates:
          setattr(project, field, updates[field])

      if 'settings' in updates:
        project.settings_json = merge_project_settings(
          project.settings_json,
          updates.get('settings'),
        )

      conversations = list(project.conversations or [])
      await session.flush()
      await session.refresh(
        project,
        [
          'id',
          'name',
          'description',
          'project_type',
          'status',
          'settings_json',
          'current_release_id',
          'user_email',
          'created_at',
          'updated_at',
        ],
      )
      project.__dict__['conversations'] = conversations
      return project

  async def delete(self, project_id: str) -> bool:
    """Delete a project and all its conversations."""
    async with session_scope() as session:
      result = await session.execute(
        delete(Project).where(
          Project.id == project_id,
          Project.user_email == self.user_email,
        )
      )
      return result.rowcount > 0


class ConversationStorage:
  """Project-scoped conversation storage operations."""

  def __init__(self, user_email: str, project_id: str):
    self.user_email = user_email
    self.project_id = project_id

  async def get_all(self) -> list[Conversation]:
    """Get all conversations for the project, newest first."""
    async with session_scope() as session:
      message_counts = (
        select(
          Message.conversation_id,
          func.count(Message.id).label('message_count'),
        )
        .group_by(Message.conversation_id)
        .subquery()
      )
      result = await session.execute(
        select(
          Conversation,
          func.coalesce(message_counts.c.message_count, 0).label('message_count'),
        )
        .join(Project, Conversation.project_id == Project.id)
        .outerjoin(message_counts, Conversation.id == message_counts.c.conversation_id)
        .where(
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
        .order_by(Conversation.created_at.desc())
      )
      conversations: list[Conversation] = []
      for conversation, message_count in result.all():
        conversation.__dict__['_message_count'] = int(message_count or 0)
        conversations.append(conversation)
      return conversations

  async def get(self, conversation_id: str) -> Optional[Conversation]:
    """Get a specific conversation with messages."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .options(selectinload(Conversation.messages))
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      return result.scalar_one_or_none()

  async def create(self, title: str = 'New Conversation') -> Conversation:
    """Create a new conversation."""
    async with session_scope() as session:
      # Verify project ownership in a single query
      project = await session.execute(
        select(Project).where(
          Project.id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      if not project.scalar_one_or_none():
        raise ValueError('Project not found or access denied')

      conversation = Conversation(
        project_id=self.project_id,
        title=title,
        agent_runtime='openai_agents',
      )
      session.add(conversation)
      await session.flush()
      await session.refresh(
        conversation,
        ['id', 'project_id', 'title', 'created_at', 'session_id', 'agent_runtime', 'agent_session_id'],
      )
      # Initialize messages as empty list for to_dict()
      # (don't use ORM attribute assignment which triggers lazy load)
      conversation.__dict__['messages'] = []
      return conversation

  async def update_title(self, conversation_id: str, title: str) -> bool:
    """Update conversation title."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if conversation:
        conversation.title = title
        return True
      return False

  async def update_session_id(self, conversation_id: str, session_id: str) -> bool:
    """Update agent session ID for resuming conversations."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if conversation:
        conversation.session_id = session_id
        conversation.agent_session_id = session_id
        conversation.agent_runtime = 'openai_agents'
        return True
      return False

  async def update_cluster_id(self, conversation_id: str, cluster_id: str | None) -> bool:
    """Update Databricks cluster ID for code execution."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if conversation:
        conversation.cluster_id = cluster_id
        return True
      return False

  async def update_catalog_schema(
    self,
    conversation_id: str,
    default_catalog: str | None,
    default_schema: str | None,
  ) -> bool:
    """Update default Unity Catalog context for the conversation."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if conversation:
        conversation.default_catalog = default_catalog
        conversation.default_schema = default_schema
        return True
      return False

  async def update_warehouse_id(self, conversation_id: str, warehouse_id: str | None) -> bool:
    """Update Databricks SQL warehouse ID for SQL queries."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if conversation:
        conversation.warehouse_id = warehouse_id
        return True
      return False

  async def update_workspace_folder(self, conversation_id: str, workspace_folder: str | None) -> bool:
    """Update workspace folder for uploading files."""
    async with session_scope() as session:
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if conversation:
        conversation.workspace_folder = workspace_folder
        return True
      return False

  async def delete(self, conversation_id: str) -> bool:
    """Delete a conversation and all its messages."""
    async with session_scope() as session:
      # First verify ownership via join, then delete
      result = await session.execute(
        select(Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      if not result.scalar_one_or_none():
        return False

      await session.execute(
        delete(Conversation).where(Conversation.id == conversation_id)
      )
      return True

  async def add_message(
    self,
    conversation_id: str,
    role: str,
    content: str,
    is_error: bool = False,
  ) -> Optional[Message]:
    """Add a message to a conversation.

    Also auto-generates conversation title from first user message.
    """
    async with session_scope() as session:
      # Verify conversation exists and user owns the project
      result = await session.execute(
        select(Conversation)
        .join(Project, Conversation.project_id == Project.id)
        .options(selectinload(Conversation.messages))
        .where(
          Conversation.id == conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      conversation = result.scalar_one_or_none()
      if not conversation:
        return None

      # Create message
      message = Message(
        conversation_id=conversation_id,
        role=role,
        content=content,
        is_error=is_error,
      )
      session.add(message)

      # Auto-generate title from first user message
      if (
        role == 'user'
        and conversation.title in ('New Conversation', 'New Chat', '')
        and len(conversation.messages) == 0
      ):
        # Use first 50 chars of message as title
        new_title = content[:50].strip()
        if len(content) > 50:
          new_title += '...'
        conversation.title = new_title

      await session.flush()
      await session.refresh(message)
      return message


class ExecutionStorage:
  """Execution state storage for session independence."""

  def __init__(self, user_email: str, project_id: str, conversation_id: str):
    self.user_email = user_email
    self.project_id = project_id
    self.conversation_id = conversation_id

  async def create(self, execution_id: str) -> Execution:
    """Create a new execution record."""
    async with session_scope() as session:
      # Verify conversation ownership via join
      result = await session.execute(
        select(Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Conversation.id == self.conversation_id,
          Conversation.project_id == self.project_id,
          Project.user_email == self.user_email,
        )
      )
      if not result.scalar_one_or_none():
        raise ValueError('Conversation not found or access denied')

      execution = Execution(
        id=execution_id,
        conversation_id=self.conversation_id,
        project_id=self.project_id,
        status='running',
        events_json='[]',
      )
      session.add(execution)
      await session.flush()
      await session.refresh(execution)
      return execution

  async def get(self, execution_id: str) -> Optional[Execution]:
    """Get an execution by ID."""
    async with session_scope() as session:
      result = await session.execute(
        select(Execution)
        .join(Conversation, Execution.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Execution.id == execution_id,
          Execution.conversation_id == self.conversation_id,
          Project.user_email == self.user_email,
        )
      )
      return result.scalar_one_or_none()

  async def get_active(self) -> Optional[Execution]:
    """Get the active (running) execution for this conversation, if any."""
    async with session_scope() as session:
      result = await session.execute(
        select(Execution)
        .join(Conversation, Execution.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Execution.conversation_id == self.conversation_id,
          Execution.status == 'running',
          Project.user_email == self.user_email,
        )
        .order_by(Execution.created_at.desc())
        .limit(1)
      )
      return result.scalar_one_or_none()

  async def get_recent(self, limit: int = 10) -> list[Execution]:
    """Get recent executions for this conversation."""
    async with session_scope() as session:
      result = await session.execute(
        select(Execution)
        .join(Conversation, Execution.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Execution.conversation_id == self.conversation_id,
          Project.user_email == self.user_email,
        )
        .order_by(Execution.created_at.desc())
        .limit(limit)
      )
      return list(result.scalars().all())

  async def add_events(self, execution_id: str, events: list[dict]) -> bool:
    """Append events to an execution's event list."""
    async with session_scope() as session:
      result = await session.execute(
        select(Execution)
        .join(Conversation, Execution.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Execution.id == execution_id,
          Project.user_email == self.user_email,
        )
      )
      execution = result.scalar_one_or_none()
      if not execution:
        return False

      # Load existing events and append new ones
      existing_events = json.loads(execution.events_json) if execution.events_json else []
      existing_events.extend(events)
      execution.events_json = json.dumps(existing_events)
      return True

  async def update_status(
    self,
    execution_id: str,
    status: str,
    error: Optional[str] = None,
  ) -> bool:
    """Update execution status."""
    async with session_scope() as session:
      result = await session.execute(
        select(Execution)
        .join(Conversation, Execution.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
          Execution.id == execution_id,
          Project.user_email == self.user_email,
        )
      )
      execution = result.scalar_one_or_none()
      if not execution:
        return False

      execution.status = status
      if error:
        execution.error = error
      return True


def get_project_storage(user_email: str) -> ProjectStorage:
  """Get project storage for a user."""
  return ProjectStorage(user_email)


def get_conversation_storage(user_email: str, project_id: str) -> ConversationStorage:
  """Get conversation storage for a project."""
  return ConversationStorage(user_email, project_id)


def get_execution_storage(user_email: str, project_id: str, conversation_id: str) -> ExecutionStorage:
  """Get execution storage for a conversation."""
  return ExecutionStorage(user_email, project_id, conversation_id)
