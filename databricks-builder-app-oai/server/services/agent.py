"""OpenAI Agents SDK runtime facade for Builder App agent sessions."""

import logging
from pathlib import Path
from typing import Any, AsyncIterator

from .agent_runtime import AgentRunRequest, OpenAIAgentRuntime
from .backup_manager import ensure_project_directory as _ensure_project_directory
from .logging_utils import ensure_logger_active

logger = logging.getLogger(__name__)
ensure_logger_active(logger, set_propagate_false=True)


def _preview_value(value: object, max_chars: int | None = 1000) -> str:
  """Return a bounded single-line preview for log records."""
  text = str(value)
  text = text.replace('\n', '\\n')
  if max_chars is None:
    return text
  return text if len(text) <= max_chars else f'{text[:max_chars]}...'


def _is_error_like_text(text: str) -> bool:
  normalized = text.lower()
  return (
    'error' in normalized
    or 'fail' in normalized
    or normalized.startswith('failed')
  )


def _event_preview(event: dict) -> str:
  event_type = event.get('type')
  if event_type == 'text_delta':
    return f'text={_preview_value(event.get("text", ""), 500)}'
  if event_type == 'text':
    return f'text={_preview_value(event.get("text", ""), None)}'
  if event_type == 'tool_use':
    return (
      f'tool_name={event.get("tool_name")} '
      f'tool_id={event.get("tool_id")} '
      f'input={_preview_value(event.get("tool_input", {}), None)}'
    )
  if event_type == 'tool_result':
    return (
      f'tool_use_id={event.get("tool_use_id")} '
      f'is_error={event.get("is_error")} '
      f'duration_ms={event.get("duration_ms")} '
      f'content={_preview_value(event.get("content", ""), None)}'
    )
  if event_type == 'system':
    return (
      f'subtype={event.get("subtype")} '
      f'data={_preview_value(event.get("data", {}), None)}'
    )
  if event_type == 'result':
    return (
      f'session_id={event.get("session_id")} '
      f'duration_ms={event.get("duration_ms")} '
      f'is_error={event.get("is_error")} '
      f'num_turns={event.get("num_turns")}'
    )
  if event_type == 'error':
    return f'error={_preview_value(event.get("error", ""), None)}'
  return _preview_value(event, None)


def _log_agent_event(event_number: int, event: dict) -> None:
  event_type = event.get('type', '<unknown>')
  context = (
    f'conversation={event.get("conversation_id", "<unknown>")} '
    f'execution={event.get("execution_id", "<unknown>")} '
    f'story={event.get("story_id", "<unknown>")} '
    f'trace={event.get("trace_id", "<none>")}'
  )
  preview = _event_preview(event)
  if event_type in {'text', 'text_delta'} and _is_error_like_text(str(event.get('text', ''))):
    logger.error('[AGENT] Event #%s: %s %s %s', event_number, event_type, context, preview)
  elif event_type == 'error' or event.get('is_error') is True:
    logger.error('[AGENT] Event #%s: %s %s %s', event_number, event_type, context, preview)
  elif event_type == 'text_delta':
    logger.debug('[AGENT] Event #%s: %s %s %s', event_number, event_type, context, preview)
  else:
    logger.info('[AGENT] Event #%s: %s %s %s', event_number, event_type, context, preview)


def get_project_directory(project_id: str) -> Path:
  """Get the directory path for a project, restoring from backup if needed."""
  return _ensure_project_directory(project_id)


async def stream_agent_response(
  project_id: str,
  message: str,
  conversation_id: str | None = None,
  session_id: str | None = None,
  execution_id: str | None = None,
  story_id: str | None = None,
  cluster_id: str | None = None,
  default_catalog: str | None = None,
  default_schema: str | None = None,
  warehouse_id: str | None = None,
  workspace_folder: str | None = None,
  databricks_host: str | None = None,
  databricks_token: str | None = None,
  is_cross_workspace: bool = False,
  is_cancelled_fn: callable = None,
  enabled_skills: list[str] | None = None,
  mlflow_experiment_name: str | None = None,
  project_context: dict[str, Any] | None = None,
) -> AsyncIterator[dict]:
  """Stream OpenAI Agents SDK events normalized for the Builder App UI."""
  ensure_logger_active(logger, set_propagate_false=True)
  logger.info(
    'Starting OpenAI agent runtime for project=%s conversation=%s execution=%s '
    'story=%s session=%s message_len=%s message_preview=%s',
    project_id,
    conversation_id or '<new>',
    execution_id or '<unknown>',
    story_id or '<unknown>',
    session_id or '<new>',
    len(message),
    _preview_value(message, 300),
  )

  request = AgentRunRequest(
    project_id=project_id,
    conversation_id=conversation_id or session_id or project_id,
    session_id=session_id,
    message=message,
    execution_id=execution_id,
    story_id=story_id,
    cluster_id=cluster_id,
    default_catalog=default_catalog,
    default_schema=default_schema,
    warehouse_id=warehouse_id,
    workspace_folder=workspace_folder,
    databricks_host=databricks_host,
    databricks_token=databricks_token,
    is_cross_workspace=is_cross_workspace,
    enabled_skills=enabled_skills,
    mlflow_experiment_name=mlflow_experiment_name,
    project_context=project_context,
    is_cancelled_fn=is_cancelled_fn or (lambda: False),
  )

  runtime = OpenAIAgentRuntime()
  event_count = 0
  async for event in runtime.stream_response(request):
    event_count += 1
    _log_agent_event(event_count, event)
    yield event
