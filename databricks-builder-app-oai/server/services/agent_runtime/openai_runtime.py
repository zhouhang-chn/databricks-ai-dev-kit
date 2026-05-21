"""OpenAI Agents SDK runtime implementation."""

import logging
import re
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from databricks_tools_core.auth import clear_databricks_auth, set_databricks_auth

from ..backup_manager import ensure_project_directory
from ..logging_utils import ensure_logger_active
from ..mlflow_setup import is_mlflow_tracing_configured
from ..project_operating_guide import load_project_operating_guide
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
from ..tools.plan_tools import create_plan_tools
from ..tools.project_files import create_project_file_tools
from ..tools.run_state import AgentToolRunState
from .base import AgentRunRequest
from .openai_events import normalize_openai_event
from .openai_models import build_agent_model, load_model_settings
from .openai_sessions import build_session_id, get_openai_session
from .openai_warning_filters import suppress_known_agents_dependency_warnings

logger = logging.getLogger(__name__)
ensure_logger_active(logger, set_propagate_false=True)

_EMBEDDED_HTTP_STATUS_PATTERNS = (
  re.compile(r'<\s*(?P<status>[1-5]\d{2})\s*>'),
  re.compile(r'\bstatus[_\s-]*code\s*[:=]\s*(?P<status>[1-5]\d{2})\b', re.IGNORECASE),
  re.compile(r'\bhttp\s*(?P<status>[1-5]\d{2})\b', re.IGNORECASE),
)


def _preview_value(value: object, max_chars: int = 2000) -> str:
  """Return a bounded single-line preview for runtime logs."""
  text = str(value)
  text = text.replace('\n', '\\n')
  return text if len(text) <= max_chars else f'{text[:max_chars]}...'


def _extract_embedded_http_status(message: str | None) -> int | None:
  """Parse embedded HTTP status from wrapped provider error messages."""
  if not message:
    return None
  for pattern in _EMBEDDED_HTTP_STATUS_PATTERNS:
    match = pattern.search(message)
    if not match:
      continue
    status_text = match.group('status')
    if not status_text:
      continue
    try:
      return int(status_text)
    except ValueError:
      continue
  return None


def _retry_on_wrapped_real_503(context: Any) -> bool:
  """Retry gateway-wrapped failures when the provider message indicates HTTP 503."""
  normalized = getattr(context, 'normalized', None)
  normalized_message = getattr(normalized, 'message', None) if normalized is not None else None
  if _extract_embedded_http_status(normalized_message) == 503:
    return True

  # Fallback: some wrappers keep the full provider payload only on context.error.
  error_text = str(getattr(context, 'error', '') or '')
  return _extract_embedded_http_status(error_text) == 503


def _with_run_metadata(event: dict, request: AgentRunRequest, trace_id: str | None) -> dict:
  """Attach run identity fields used by logs, SSE replay, and story inspection."""
  enriched = dict(event)
  enriched.setdefault('project_id', request.project_id)
  enriched.setdefault('conversation_id', request.conversation_id)
  if request.execution_id:
    enriched.setdefault('execution_id', request.execution_id)
  if request.story_id:
    enriched.setdefault('story_id', request.story_id)
  if trace_id:
    enriched.setdefault('trace_id', trace_id)
  return enriched


def _tool_name(tool: Any) -> str:
  """Best-effort tool name for OpenAI SDK tool objects."""
  return str(getattr(tool, 'name', None) or getattr(tool, '__name__', None) or type(tool).__name__)


# Tool names/prefixes that indicate a run can create or persist a resource.
# Plain query/read tools (execute_sql, get_table_schema, list_*) are excluded:
# a read-only / analysis run that only reads does not need the resource-link or
# permission-grant guidance, so it can be omitted from the system prompt.
_RESOURCE_CREATION_TOOL_PREFIXES = ('manage_', 'create_', 'deploy_')
_RESOURCE_CREATION_TOOL_NAMES = frozenset(
  {
    'execute_code',
    'generate_and_upload_pdf',
    'manage_workspace_files',
    'write_project_file',
    'edit_project_file',
  }
)


def _tools_can_create_resources(tools: list[Any]) -> bool:
  """Whether the (already skill-filtered) tool set can create/persist resources."""
  for tool in tools:
    name = _tool_name(tool).lower()
    if name in _RESOURCE_CREATION_TOOL_NAMES:
      return True
    if any(name.startswith(prefix) for prefix in _RESOURCE_CREATION_TOOL_PREFIXES):
      return True
  return False


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


def _is_user_preview_run(project_context: dict[str, Any] | None) -> bool:
  """Return true when the run should expose only read-oriented tools."""
  if not project_context:
    return False
  role = str(project_context.get('role') or '').lower()
  policy = (project_context.get('settings') or {}).get('agent_policy') or {}
  write_policy = str(policy.get('write_policy') or '').lower() if isinstance(policy, dict) else ''
  return role in {'user', 'user_preview', 'viewer'} or write_policy == 'read_only'


def _schema_required_tables_from_context(project_context: dict[str, Any] | None) -> set[str]:
  """Return project-configured tables that require schema inspection before SQL."""
  if not project_context:
    return set()
  settings = project_context.get('settings') or {}
  if not isinstance(settings, dict):
    return set()
  semantics = settings.get('semantics') or {}
  if not isinstance(semantics, dict):
    return set()

  tables: set[str] = set()
  for key in ('input_tables', 'metric_views', 'preferred_tables'):
    values = semantics.get(key)
    if not isinstance(values, list):
      continue
    tables.update(str(value) for value in values if value)
  return tables


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
    tracing_disabled = not mlflow_tracing and (settings.tracing_disabled or bool(settings.base_url))
    trace_id: str | None = None

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
      suppress_known_agents_dependency_warnings()
      from agents import (
        Agent,
        ModelRetryBackoffSettings,
        ModelRetrySettings,
        ModelSettings,
        RunConfig,
        Runner,
        gen_trace_id,
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
        project_context=request.project_context,
      )
      project_operating_guide = load_project_operating_guide(project_dir)
      logger.info(
        'Loaded project operating guide snapshot: present=%s chars=%s',
        bool(project_operating_guide),
        len(project_operating_guide),
      )
      read_only_run = _is_user_preview_run(request.project_context)
      logger.info('OpenAI runtime tool policy: read_only=%s', read_only_run)
      tool_run_state = AgentToolRunState(
        project_dir=project_dir,
        schema_required_tables=_schema_required_tables_from_context(request.project_context),
        default_catalog=request.default_catalog,
        default_schema=request.default_schema,
      )
      seeded_schema_inspections = tool_run_state.seed_schema_inspections_from_events(
        request.schema_history_events or []
      )
      if seeded_schema_inspections:
        logger.info(
          'Seeded schema inspections from conversation history: events=%s tables=%s schemas=%s',
          seeded_schema_inspections,
          len(tool_run_state.inspected_tables),
          len(tool_run_state.inspected_schemas),
        )

      tools = [
        *create_plan_tools(run_state=tool_run_state),
        *create_project_file_tools(
          project_dir,
          read_only=read_only_run,
          run_state=tool_run_state,
        ),
        *create_databricks_tools(
          default_catalog=request.default_catalog,
          default_schema=request.default_schema,
          default_cluster_id=request.cluster_id,
          default_warehouse_id=request.warehouse_id,
          read_only=read_only_run,
          run_state=tool_run_state,
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

      # Resource-link / permission-grant guidance is only useful when the run
      # can actually create resources; omit it for read-only runs and runs whose
      # filtered tool set has no resource-creating tools to keep the prompt lean.
      can_create_resources = not read_only_run and _tools_can_create_resources(tools)
      logger.info(
        'OpenAI runtime resource guidance: can_create_resources=%s read_only=%s',
        can_create_resources,
        read_only_run,
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
        project_operating_guide=project_operating_guide,
        can_create_resources=can_create_resources,
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
          _retry_on_wrapped_real_503,
          retry_policies.retry_after(),
          retry_policies.provider_suggested(),
        ),
      )

      trace_id = None if tracing_disabled else gen_trace_id()

      result = Runner.run_streamed(
        agent,
        input=request.message,
        session=session,
        # Plan-driven runs need headroom for: 1 create + N step-starts +
        # N step-tools + N step-finishes + 1 conclusion + optional file upkeep.
        # 60 covers ~5-step analyses comfortably while still bounding runaway.
        max_turns=60,
        run_config=RunConfig(
          workflow_name='Databricks Builder App',
          trace_id=trace_id,
          group_id=conversation_id,
          trace_include_sensitive_data=False,
          tracing_disabled=tracing_disabled,
          model_settings=ModelSettings(retry=retry_settings),
          trace_metadata={
            'project_id': request.project_id,
            'conversation_id': conversation_id,
            'execution_id': request.execution_id or '',
            'story_id': request.story_id or '',
            'workspace_url': request.databricks_host or '',
            'runtime': 'openai_agents',
            'project_type': str((request.project_context or {}).get('project_type') or ''),
            'project_status': str((request.project_context or {}).get('status') or ''),
            'project_release_id': str((request.project_context or {}).get('release_id') or ''),
          },
        ),
      )
      trace_obj = getattr(result, 'trace', None)
      trace_id = trace_id or getattr(trace_obj, 'trace_id', None)
      logger.info(
        'OpenAI streamed run created: conversation=%s execution=%s story=%s '
        'session=%s model=%s trace_id=%s mlflow_experiment=%s',
        conversation_id,
        request.execution_id,
        request.story_id,
        session_id,
        settings.agent_model,
        trace_id,
        request.mlflow_experiment_name,
      )
      yield _with_run_metadata(
        {
          'type': 'system',
          'subtype': 'trace_started',
          'data': {
            'trace_id': trace_id,
            'mlflow_experiment_name': request.mlflow_experiment_name,
          },
        },
        request,
        trace_id,
      )

      started_at = time.time()
      cancelled = False
      emitted_text = False
      sdk_event_count = 0
      # Per-run UI-event dedup. The model sometimes re-emits update_plan(create)
      # or submit_conclusion many times; the tool layer redirects duplicate
      # creates into the first step and returns terminal guidance for duplicate
      # conclusions. Until it corrects course, we must not let duplicate
      # semantic events reach the UI — otherwise a regressed plan from the model
      # would overwrite the original plan in the stepper. plan.revised is the
      # intentional channel for changing the plan.
      plan_created_emitted = False
      conclusion_emitted = False
      stop_after_conclusion = False

      async for sdk_event in result.stream_events():
        sdk_event_count += 1
        sdk_event_type = getattr(sdk_event, 'type', type(sdk_event).__name__)
        logger.debug(
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
          yield _with_run_metadata({'type': 'cancelled'}, request, trace_id)

        for event in normalize_openai_event(sdk_event):
          if cancelled and event.get('type') not in {'system', 'result'}:
            continue
          event_type = event.get('type')
          if event_type == 'plan.created':
            if plan_created_emitted:
              logger.info(
                'Suppressing duplicate plan.created (call_id=%s) — original plan preserved',
                event.get('call_id'),
              )
              continue
            plan_created_emitted = True
          elif event_type == 'plan.revised':
            # A revise is the legitimate way to change the plan. Reset so a
            # subsequent regression after revise still emits once and only once.
            plan_created_emitted = True
          elif event_type == 'synthesis.appended':
            if conclusion_emitted:
              logger.info(
                'Suppressing duplicate synthesis.appended (call_id=%s) - '
                'original conclusion preserved',
                event.get('call_id'),
              )
              continue
            conclusion_emitted = True
            stop_after_conclusion = True
          if event_type in {'text', 'text_delta'}:
            emitted_text = True
          yield _with_run_metadata(event, request, trace_id)
          if stop_after_conclusion:
            logger.info(
              'Terminal synthesis submitted; stopping streamed run for conversation=%s',
              conversation_id,
            )
            cancel = getattr(result, 'cancel', None)
            if callable(cancel):
              cancel()
            break
        if stop_after_conclusion:
          break

      if not cancelled and not conclusion_emitted:
        final_output = getattr(result, 'final_output', None)
        if final_output and not emitted_text:
          yield _with_run_metadata({'type': 'text', 'text': str(final_output)}, request, trace_id)

      duration_ms = int((time.time() - started_at) * 1000)
      result_event = {
        'type': 'result',
        'session_id': session_id,
        'duration_ms': duration_ms,
        'is_error': False,
        'num_turns': None,
      }
      logger.info(
        'OpenAI runtime completed: conversation=%s execution=%s story=%s session=%s '
        'trace_id=%s sdk_events=%s duration_ms=%s',
        conversation_id,
        request.execution_id,
        request.story_id,
        session_id,
        trace_id,
        sdk_event_count,
        duration_ms,
      )
      yield _with_run_metadata(result_event, request, trace_id)

    except Exception as e:
      ensure_logger_active(logger, set_propagate_false=True)
      logger.exception('OpenAI agent runtime failed: %s', e)
      yield _with_run_metadata({'type': 'error', 'error': str(e)}, request, trace_id)
    finally:
      logger.info('Clearing Databricks auth context for conversation=%s', conversation_id)
      clear_databricks_auth()
