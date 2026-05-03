"""OpenAI Agents SDK runtime implementation."""

import logging
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from databricks_tools_core.auth import clear_databricks_auth, set_databricks_auth

from ..backup_manager import ensure_project_directory
from ..logging_utils import ensure_logger_active
from ..mlflow_setup import is_mlflow_tracing_configured
from ..skills_manager import (
  filter_openai_tools_by_skills,
  get_enabled_skills_from_env,
  get_project_enabled_skills,
  render_project_skill_guidance,
  sync_project_skills,
)
from ..system_prompt import get_system_prompt
from ..tools.databricks_openai import create_databricks_tools
from ..tools.operation_tools import create_operation_tools
from ..tools.project_files import create_project_file_tools
from .base import AgentRunRequest
from .openai_events import normalize_openai_event
from .openai_models import build_agent_model, load_model_settings
from .openai_sessions import build_session_id, get_openai_session

logger = logging.getLogger(__name__)
ensure_logger_active(logger, set_propagate_false=True)


def _preview_value(value: object, max_chars: int = 2000) -> str:
  """Return a bounded single-line preview for runtime logs."""
  text = str(value)
  text = text.replace('\n', '\\n')
  return text if len(text) <= max_chars else f'{text[:max_chars]}...'


def _tool_name(tool: Any) -> str:
  """Best-effort tool name for OpenAI SDK tool objects."""
  return str(
    getattr(tool, 'name', None)
    or getattr(tool, '__name__', None)
    or type(tool).__name__
  )


def _resolve_enabled_skills(
  request_enabled_skills: list[str] | None,
  project_dir: Path,
) -> tuple[list[str] | None, str]:
  """Resolve enabled skills using request, project, env, then all-skills fallback."""
  if request_enabled_skills is not None:
    return request_enabled_skills, 'request'

  project_enabled_skills = get_project_enabled_skills(project_dir)
  if project_enabled_skills is not None:
    return project_enabled_skills, 'project_config'

  env_enabled_skills = get_enabled_skills_from_env()
  if env_enabled_skills is not None:
    return env_enabled_skills, 'env'

  return None, 'all'


class OpenAIAgentRuntime:
  """Agent runtime backed by OpenAI Agents SDK."""

  async def stream_response(
    self,
    request: AgentRunRequest,
  ) -> AsyncIterator[dict]:
    """Run the agent and yield normalized events."""
    ensure_logger_active(logger, set_propagate_false=True)
    settings = load_model_settings(require=True)
    project_dir = ensure_project_directory(request.project_id)
    conversation_id = request.conversation_id or request.session_id or request.project_id
    session_id = build_session_id(request.project_id, conversation_id)
    cancel_check = request.is_cancelled_fn or (lambda: False)
    mlflow_tracing = is_mlflow_tracing_configured()
    tracing_disabled = (
      not mlflow_tracing
      and (settings.tracing_disabled or bool(settings.base_url))
    )

    logger.info(
      'OpenAI runtime starting: project=%s conversation=%s model=%s base_url=%s',
      request.project_id,
      conversation_id,
      settings.agent_model,
      settings.base_url,
    )
    logger.info(
      'OpenAI runtime request context: session=%s project_dir=%s message_len=%s '
      'enabled_skills=%s tracing_disabled=%s mlflow_tracing=%s project_type=%s '
      'project_status=%s release=%s',
      session_id,
      project_dir,
      len(request.message),
      '<project-default>' if request.enabled_skills is None else len(request.enabled_skills),
      tracing_disabled,
      mlflow_tracing,
      (request.project_context or {}).get('project_type'),
      (request.project_context or {}).get('status'),
      (request.project_context or {}).get('release_id'),
    )

    set_databricks_auth(
      request.databricks_host,
      request.databricks_token,
      force_token=request.is_cross_workspace,
    )
    logger.info(
      'Databricks tool auth configured: host=%s token_len=%s cross_workspace=%s',
      request.databricks_host,
      len(request.databricks_token or ''),
      request.is_cross_workspace,
    )

    try:
      from agents import (
        Agent,
        ModelRetryBackoffSettings,
        ModelRetrySettings,
        ModelSettings,
        RunConfig,
        Runner,
        retry_policies,
      )

      # Resolve enabled skills with explicit precedence so the system prompt
      # and tool list only carry the skills the deployment opted into:
      #   1. Per-request override (request body)
      #   2. Per-project file (.agents/enabled_skills.json)
      #   3. ENABLED_SKILLS env var (deployment-wide gate)
      # Only when all three are unset do we fall back to "all skills".
      enabled_skills, enabled_skills_source = _resolve_enabled_skills(
        request.enabled_skills,
        project_dir,
      )
      logger.info(
        'Resolved enabled skills source=%s count=%s',
        enabled_skills_source,
        '<all>' if enabled_skills is None else len(enabled_skills),
      )
      sync_project_skills(project_dir, enabled_skills=enabled_skills)
      skill_guidance = render_project_skill_guidance(
        project_dir,
        enabled_skills=enabled_skills,
      )

      instructions = get_system_prompt(
        cluster_id=request.cluster_id,
        default_catalog=request.default_catalog,
        default_schema=request.default_schema,
        warehouse_id=request.warehouse_id,
        workspace_folder=request.workspace_folder,
        workspace_url=request.databricks_host,
        enabled_skills=enabled_skills,
        skill_guidance=skill_guidance,
        project_context=request.project_context,
      )

      tools = [
        *create_project_file_tools(project_dir),
        *create_databricks_tools(
          default_catalog=request.default_catalog,
          default_schema=request.default_schema,
          default_warehouse_id=request.warehouse_id,
        ),
        *create_operation_tools(),
      ]
      logger.info(
        'Constructed OpenAI tools before skill filtering: count=%s names=%s',
        len(tools),
        ','.join(_tool_name(tool) for tool in tools),
      )
      tools = filter_openai_tools_by_skills(tools, enabled_skills=enabled_skills)
      logger.info(
        'OpenAI tools after skill filtering: count=%s names=%s',
        len(tools),
        ','.join(_tool_name(tool) for tool in tools),
      )

      agent = Agent(
        name='Databricks Builder',
        instructions=instructions,
        model=build_agent_model(settings),
        tools=tools,
      )
      session = get_openai_session(request.project_id, conversation_id)

      # Runner-managed retry: retries connect/network/timeout failures and
      # transient 5xx with jittered backoff. Replay-safety inside the SDK
      # prevents retrying a streamed call once tokens have been emitted, so
      # mid-stream truncations are not duplicated.
      retry_settings = ModelRetrySettings(
        max_retries=2,
        backoff=ModelRetryBackoffSettings(
          initial_delay=1.0,
          max_delay=10.0,
          multiplier=2.0,
          jitter=True,
        ),
        policy=retry_policies.any(
          retry_policies.network_error(),
          retry_policies.http_status([429, 502, 503, 504]),
          retry_policies.retry_after(),
          retry_policies.provider_suggested(),
        ),
      )

      result = Runner.run_streamed(
        agent,
        input=request.message,
        session=session,
        run_config=RunConfig(
          workflow_name='Databricks Builder App',
          group_id=conversation_id,
          trace_include_sensitive_data=False,
          tracing_disabled=tracing_disabled,
          model_settings=ModelSettings(retry=retry_settings),
          trace_metadata={
            'project_id': request.project_id,
            'conversation_id': conversation_id,
            'workspace_url': request.databricks_host or '',
            'runtime': 'openai_agents',
            'project_type': str((request.project_context or {}).get('project_type') or ''),
            'project_status': str((request.project_context or {}).get('status') or ''),
            'project_release_id': str((request.project_context or {}).get('release_id') or ''),
          },
        ),
      )
      logger.info(
        'OpenAI streamed run created: conversation=%s session=%s model=%s',
        conversation_id,
        session_id,
        settings.agent_model,
      )

      started_at = time.time()
      cancelled = False
      emitted_text = False
      sdk_event_count = 0

      async for sdk_event in result.stream_events():
        sdk_event_count += 1
        sdk_event_type = getattr(sdk_event, 'type', type(sdk_event).__name__)
        logger.info(
          '[OPENAI_SDK] Event #%s: %s preview=%s',
          sdk_event_count,
          sdk_event_type,
          _preview_value(repr(sdk_event)),
        )
        if cancel_check() and not cancelled:
          cancelled = True
          logger.info('Cancelling OpenAI streamed run for conversation=%s', conversation_id)
          cancel = getattr(result, 'cancel', None)
          if callable(cancel):
            cancel()
          yield {'type': 'cancelled'}

        for event in normalize_openai_event(sdk_event):
          if cancelled and event.get('type') not in {'system', 'result'}:
            continue
          if event.get('type') in {'text', 'text_delta'}:
            emitted_text = True
          yield event

      if not cancelled:
        final_output = getattr(result, 'final_output', None)
        if final_output and not emitted_text:
          yield {'type': 'text', 'text': str(final_output)}

      duration_ms = int((time.time() - started_at) * 1000)
      result_event = {
        'type': 'result',
        'session_id': session_id,
        'duration_ms': duration_ms,
        'is_error': False,
        'num_turns': None,
      }
      logger.info(
        'OpenAI runtime completed: conversation=%s session=%s sdk_events=%s duration_ms=%s',
        conversation_id,
        session_id,
        sdk_event_count,
        duration_ms,
      )
      yield result_event

    except Exception as e:
      ensure_logger_active(logger, set_propagate_false=True)
      logger.exception('OpenAI agent runtime failed: %s', e)
      yield {'type': 'error', 'error': str(e)}
    finally:
      logger.info('Clearing Databricks auth context for conversation=%s', conversation_id)
      clear_databricks_auth()
