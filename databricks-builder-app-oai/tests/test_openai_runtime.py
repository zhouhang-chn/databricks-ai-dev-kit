"""Unit tests for the OpenAI runtime support modules."""

import json
import logging
from dataclasses import dataclass

import pytest
from server.services.active_stream import ActiveStream
from server.services.agent_runtime.openai_events import normalize_openai_event
from server.services.agent_runtime.openai_models import load_model_settings
from server.services.agent_runtime.openai_runtime import (
  _extract_embedded_http_status,
  _resolve_enabled_skills,
  _retry_on_wrapped_real_503,
)
from server.services.logging_utils import ensure_logger_active
from server.services.project_operating_guide import (
  DEFAULT_PROJECT_OPERATING_GUIDE,
  LEGACY_DEFAULT_AGENTS_MD,
  ensure_project_operating_guide,
  load_project_operating_guide,
)
from server.services.skills_manager import filter_openai_tools_by_skills
from server.services.tools.databricks_openai import (
  _is_read_only_tool_name,
  create_databricks_tools,
)
from server.services.tools.project_files import (
  MAX_READ_BYTES,
  ProjectFileError,
  _resolve_project_path,
  create_project_file_tools,
)
from server.services.tools.run_state import AgentToolRunState


@dataclass
class Event:
  """Simple object with SDK-like attributes."""

  type: str
  data: object | None = None
  item: object | None = None
  new_agent: object | None = None


@dataclass
class RawData:
  """Simple raw response data object."""

  type: str
  delta: str = ''


@dataclass
class Item:
  """Simple run item object."""

  type: str
  raw_item: object
  output: object | None = None


@dataclass
class ContentPart:
  """Simple Responses content part object."""

  text: str = ''
  type: str = 'output_text'


@dataclass
class RetryNormalized:
  """Minimal normalized error stub for retry policy testing."""

  status_code: int | None = None
  error_code: str | None = None
  message: str | None = None


@dataclass
class RetryContext:
  """Minimal retry context stub for retry policy testing."""

  error: Exception
  normalized: RetryNormalized


def test_raw_text_delta_event_normalizes_to_text_delta():
  """Raw SDK text deltas stay frontend-compatible."""
  events = normalize_openai_event(
    Event(
      type='raw_response_event',
      data=RawData(type='response.output_text.delta', delta='hello'),
    )
  )

  assert events == [{'type': 'text_delta', 'text': 'hello'}]


def test_tool_call_event_normalizes_to_tool_use():
  """SDK tool calls map into the existing Builder App event vocabulary."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={'id': 'call_1', 'name': 'execute_sql', 'arguments': {'sql_query': 'SELECT 1'}},
      ),
    )
  )

  assert events == [{
    'type': 'tool_use',
    'tool_id': 'call_1',
    'tool_name': 'execute_sql',
    'tool_input': {'sql_query': 'SELECT 1'},
  }]


def test_empty_message_content_part_is_not_rendered_as_sdk_repr():
  """Empty SDK content parts should not leak ResponseOutputText reprs into chat text."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='message_output_item',
        raw_item={'content': [ContentPart(text='')]},
      ),
    )
  )

  assert events == []


def test_tool_call_event_prefers_call_id_and_parses_json_arguments():
  """Tool IDs must match later output call IDs for trace/evidence linking."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'id': '__fake_id__',
          'call_id': 'call_1',
          'name': 'execute_sql',
          'arguments': '{"sql_query": "SELECT 1"}',
        },
      ),
    )
  )

  assert events == [{
    'type': 'tool_use',
    'tool_id': 'call_1',
    'tool_name': 'execute_sql',
    'tool_input': {'sql_query': 'SELECT 1'},
  }]


def test_tool_output_event_normalizes_to_tool_result():
  """SDK tool outputs become Builder App evidence events, not fake tool calls."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_output_item',
        raw_item={'call_id': 'call_1'},
        output={'rows': [{'answer': 1}]},
      ),
    )
  )

  assert events == [{
    'type': 'tool_result',
    'tool_use_id': 'call_1',
    'content': '{"rows": [{"answer": 1}]}',
    'is_error': False,
  }]


def test_tool_output_event_detects_error_status():
  """Tool output status is preserved for story error evidence."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_output_item',
        raw_item={'call_id': 'call_1', 'status': 'failed'},
        output='Timed out',
      ),
    )
  )

  assert events == [{
    'type': 'tool_result',
    'tool_use_id': 'call_1',
    'content': 'Timed out',
    'is_error': True,
  }]


def test_update_plan_create_emits_plan_created_and_suppresses_tool_use():
  """update_plan(op="create") becomes a plan.created event, not a tool_use."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'call_id': 'call_plan_1',
          'name': 'update_plan',
          'arguments': (
            '{"op": "create", "objective": "Find Q3 anomalies", '
            '"steps": [{"id": "step-1", "title": "Inspect schema"}]}'
          ),
        },
      ),
    )
  )

  assert events == [{
    'type': 'plan.created',
    'call_id': 'call_plan_1',
    'objective': 'Find Q3 anomalies',
    'steps': [{'id': 'step-1', 'title': 'Inspect schema'}],
  }]


def test_update_plan_start_finish_emit_step_events():
  """update_plan start/finish translate into typed step transitions."""
  start = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'call_id': 'call_start',
          'name': 'update_plan',
          'arguments': (
            '{"op": "start", "step_id": "step-1", '
            '"narrative": "Looking at sales grain"}'
          ),
        },
      ),
    )
  )
  finish = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'call_id': 'call_finish',
          'name': 'update_plan',
          'arguments': '{"op": "finish", "step_id": "step-1", "finding": "Daily grain"}',
        },
      ),
    )
  )

  assert start == [{
    'type': 'plan.step_started',
    'call_id': 'call_start',
    'step_id': 'step-1',
    'narrative': 'Looking at sales grain',
  }]
  assert finish == [{
    'type': 'plan.step_finished',
    'call_id': 'call_finish',
    'step_id': 'step-1',
    'finding': 'Daily grain',
    'status': 'done',
  }]


def test_submit_conclusion_emits_synthesis_event():
  """submit_conclusion becomes a synthesis.appended event with structured fields."""
  events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'call_id': 'call_concl',
          'name': 'submit_conclusion',
          'arguments': (
            '{"summary": "Wrapped it up", '
            '"highlights": [{"label": "Rows", "value": "3.2M"}], '
            '"next_steps": ["Drill into Region EU"]}'
          ),
        },
      ),
    )
  )

  assert events == [{
    'type': 'synthesis.appended',
    'call_id': 'call_concl',
    'summary': 'Wrapped it up',
    'highlights': [{'label': 'Rows', 'value': '3.2M'}],
    'next_steps': ['Drill into Region EU'],
  }]


def test_plan_tool_output_echo_is_suppressed():
  """The output of a plan tool call must not produce a generic tool_result."""
  # First the call: registers call_id as a plan call
  normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'call_id': 'call_suppress',
          'name': 'update_plan',
          'arguments': '{"op": "create", "objective": "x", "steps": []}',
        },
      ),
    )
  )
  # Then the output: should be dropped
  output_events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_output_item',
        raw_item={'call_id': 'call_suppress'},
        output={'op': 'create', 'ack': 'plan_created'},
      ),
    )
  )
  assert output_events == []


def test_duplicate_plan_create_output_is_suppressed_from_ui():
  """A duplicate create's output is a hard error to the model; the UI sees nothing."""
  normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_item',
        raw_item={
          'call_id': 'call_duplicate_create',
          'name': 'update_plan',
          'arguments': (
            '{"op": "create", "objective": "x", '
            '"steps": [{"id": "step-1", "title": "Inspect"}]}'
          ),
        },
      ),
    )
  )

  output_events = normalize_openai_event(
    Event(
      type='run_item_stream_event',
      item=Item(
        type='tool_call_output_item',
        raw_item={'call_id': 'call_duplicate_create'},
        output={
          'is_error': True,
          'error': 'plan_already_exists',
          'message': 'A plan was already created in this run...',
          'next_action_required': 'update_plan(op="start", step_id="step-1", ...)',
        },
      ),
    )
  )

  assert output_events == []


def _invoke_plan_tool(tool, args_json: str, call_id: str = 'call_test'):
  """Run a FunctionTool's underlying handler with a synthetic ToolContext."""
  import asyncio

  from agents.tool_context import ToolContext

  ctx = ToolContext(
    context=None,
    tool_name=tool.name,
    tool_call_id=call_id,
    tool_arguments=args_json,
  )
  return asyncio.run(tool.on_invoke_tool(ctx, args_json))


def _invoke_tool(tool, args_json: str, call_id: str = 'call_test'):
  """Run a FunctionTool's handler and return its raw result."""
  return _invoke_plan_tool(tool, args_json, call_id)


def test_update_plan_duplicate_create_returns_hard_error():
  """A second update_plan(op='create') in the same run is rejected with is_error."""
  from server.services.tools.plan_tools import create_plan_tools

  run_state = AgentToolRunState(project_dir=None)
  tools = create_plan_tools(run_state=run_state)
  update_plan = next(t for t in tools if t.name == 'update_plan')
  args = '{"op":"create","objective":"x","steps":[{"id":"step-1","title":"t"}]}'

  first = _invoke_plan_tool(update_plan, args, 'call_1')
  second = _invoke_plan_tool(update_plan, args, 'call_2')

  assert first['ack'] == 'plan_created'
  assert second['is_error'] is True
  assert second['error'] == 'plan_already_exists'
  assert 'op="start"' in second['next_action_required']
  assert 'step-1' in second['next_action_required']
  # The duplicate must NOT auto-mutate run state — the model must call op="start"
  # explicitly so the gate opens through the documented path.
  assert run_state.active_step_id is None


def test_submit_conclusion_is_idempotent_per_run():
  """A second submit_conclusion in the same run returns terminal guidance."""
  from server.services.tools.plan_tools import create_plan_tools

  tools = create_plan_tools()
  submit_conclusion = next(t for t in tools if t.name == 'submit_conclusion')
  args = '{"summary":"done"}'

  first = _invoke_plan_tool(submit_conclusion, args, 'call_1')
  second = _invoke_plan_tool(submit_conclusion, args, 'call_2')

  assert first['ack'] == 'conclusion_submitted'
  assert second['ack'] == 'conclusion_already_submitted'
  assert 'guidance' in second


def test_plan_tool_state_is_isolated_between_runs():
  """create_plan_tools() must hand each run its own closure state."""
  from server.services.tools.plan_tools import create_plan_tools

  args = '{"op":"create","objective":"x","steps":[]}'

  run_a = create_plan_tools()
  run_b = create_plan_tools()
  update_a = next(t for t in run_a if t.name == 'update_plan')
  update_b = next(t for t in run_b if t.name == 'update_plan')

  # Exhaust run A's create
  _invoke_plan_tool(update_a, args, 'a1')
  duplicate_a = _invoke_plan_tool(update_a, args, 'a2')
  assert duplicate_a['is_error'] is True
  assert duplicate_a['error'] == 'plan_already_exists'

  # Run B (separate concurrent agent) is unaffected
  fresh_b = _invoke_plan_tool(update_b, args, 'b1')
  assert fresh_b['ack'] == 'plan_created'


def test_update_plan_revise_marks_plan_created():
  """Calling op='revise' implies a plan exists, so subsequent create redirects."""
  from server.services.tools.plan_tools import create_plan_tools

  tools = create_plan_tools()
  update_plan = next(t for t in tools if t.name == 'update_plan')

  revise = _invoke_plan_tool(
    update_plan,
    '{"op":"revise","steps":[],"reason":"changed"}',
    'r1',
  )
  assert revise['ack'] == 'plan_revised'

  # Now a stray create should be rejected as a duplicate, not freshly accepted
  follow_up = _invoke_plan_tool(
    update_plan,
    '{"op":"create","objective":"x","steps":[]}',
    'r2',
  )
  assert follow_up['is_error'] is True
  assert follow_up['error'] == 'plan_already_exists'
  assert 'step-1' in follow_up['next_action_required']


def test_extract_embedded_http_status_from_angle_brackets():
  """Wrapped provider payloads with <503> should be detected."""
  message = (
    "Error code: 500 - {'error': {'message': '<503> InternalError.Algo: Too many requests.'}}"
  )
  assert _extract_embedded_http_status(message) == 503


def test_extract_embedded_http_status_returns_none_without_match():
  """Messages without an embedded HTTP status should not trigger retries."""
  assert _extract_embedded_http_status('Error code: 500 - internal failure') is None


def test_retry_policy_retries_wrapped_503_from_normalized_message():
  """Retry should trigger when wrapper reports 500 but embedded status is 503."""
  context = RetryContext(
    error=RuntimeError('Error code: 500'),
    normalized=RetryNormalized(
      status_code=500,
      message=(
        "Error code: 500 - {'error': {'message': "
        "'<503> InternalError.Algo: Too many requests. throttled'}}"
      ),
    ),
  )

  assert _retry_on_wrapped_real_503(context) is True


def test_retry_policy_ignores_wrapped_429():
  """Only embedded 503 should be handled by this wrapper-specific policy."""
  context = RetryContext(
    error=RuntimeError('Error code: 500'),
    normalized=RetryNormalized(
      status_code=500,
      message="Error code: 500 - {'error': {'message': '<429> Too many requests'}}",
    ),
  )

  assert _retry_on_wrapped_real_503(context) is False


def test_model_settings_require_ai_gateway_env(monkeypatch):
  """Missing AI Gateway env vars fail clearly."""
  monkeypatch.delenv('OPENAI_API_KEY', raising=False)
  monkeypatch.delenv('OPENAI_BASE_URL', raising=False)

  with pytest.raises(RuntimeError, match='OPENAI_API_KEY.*OPENAI_BASE_URL'):
    load_model_settings(require=True)


def test_runtime_enabled_skills_missing_config_means_all_skills(tmp_path, monkeypatch):
  """Missing project/env skill config must not trigger len(None) failures."""
  monkeypatch.delenv('ENABLED_SKILLS', raising=False)

  enabled_skills, source = _resolve_enabled_skills(None, tmp_path)

  assert enabled_skills is None
  assert source == 'all'


def test_active_stream_metadata_and_error_completion_are_persisted():
  """Terminal stream events should keep run identity and error state."""
  stream = ActiveStream(
    execution_id='exec_1',
    conversation_id='conv_1',
    project_id='proj_1',
    event_metadata={'story_id': 'story_1', 'execution_id': 'exec_1'},
  )

  stream.mark_error('failed', emit_error_event=False)
  events, _ = stream.get_events_since()

  assert events == [{
    'type': 'stream.completed',
    'is_error': True,
    'story_id': 'story_1',
    'execution_id': 'exec_1',
    '_cursor': events[0]['_cursor'],
  }]
  assert stream.error == 'failed'


def test_project_path_escape_is_rejected(tmp_path):
  """Project file resolution rejects paths outside the project root."""
  with pytest.raises(ProjectFileError):
    _resolve_project_path(tmp_path, '../outside.txt')


def test_project_symlink_escape_is_rejected(tmp_path):
  """Symlinks that resolve outside the project are rejected."""
  outside = tmp_path.parent / 'outside.txt'
  outside.write_text('secret', encoding='utf-8')
  link = tmp_path / 'link.txt'
  link.symlink_to(outside)

  with pytest.raises(ProjectFileError):
    _resolve_project_path(tmp_path, 'link.txt')


def test_project_file_tools_expose_expected_names(tmp_path):
  """The MVP exposes explicit file tools and no shell execution tool."""
  tool_names = {tool.name for tool in create_project_file_tools(tmp_path)}

  assert {
    'read_project_file',
    'write_project_file',
    'edit_project_file',
    'list_project_files',
    'grep_project_files',
    'get_project_tree',
  } <= tool_names
  assert 'bash' not in {name.lower() for name in tool_names}


def test_project_file_tools_respect_read_only_mode(tmp_path):
  """User-preview runs should not expose project file mutation tools."""
  tool_names = {tool.name for tool in create_project_file_tools(tmp_path, read_only=True)}

  assert {
    'read_project_file',
    'list_project_files',
    'grep_project_files',
    'get_project_tree',
  } <= tool_names
  assert 'write_project_file' not in tool_names
  assert 'edit_project_file' not in tool_names


def test_project_file_read_size_cap_constant_is_bounded():
  """Guard against accidentally removing file read limits."""
  assert MAX_READ_BYTES <= 1_000_000


def test_openai_tool_filter_blocks_disabled_skill_tools():
  """Skill whitelist filtering also works for plain OpenAI tool names."""

  @dataclass
  class Tool:
    name: str

  tools = [
    Tool('manage_jobs'),
    Tool('manage_dashboard'),
    Tool('execute_sql'),
    Tool('check_operation_status'),
  ]

  allowed = filter_openai_tools_by_skills(
    tools,
    enabled_skills=['databricks-aibi-dashboards'],
  )

  assert [tool.name for tool in allowed] == [
    'manage_dashboard',
    'execute_sql',
    'check_operation_status',
  ]


def test_analysis_skill_openai_filter_exposes_minimal_tools():
  """The analysis skill should expose only base read tools and analysis helpers."""

  @dataclass
  class Tool:
    name: str

  tools = [
    Tool('update_plan'),
    Tool('submit_conclusion'),
    Tool('read_project_file'),
    Tool('write_project_file'),
    Tool('execute_sql'),
    Tool('get_table_stats_and_schema'),
    Tool('list_compute'),
    Tool('get_current_user'),
    Tool('manage_cluster'),
    Tool('generate_and_upload_pdf'),
  ]

  allowed = filter_openai_tools_by_skills(
    tools,
    enabled_skills=['databricks-analysis'],
  )

  assert [tool.name for tool in allowed] == [
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'execute_sql',
    'get_table_stats_and_schema',
    'list_compute',
    'get_current_user',
  ]


def test_user_preview_databricks_tool_filter_blocks_write_tools():
  """Generated Databricks tools in user preview should be read-oriented."""
  assert _is_read_only_tool_name('get_table_stats_and_schema') is True
  assert _is_read_only_tool_name('query_vs_index') is True
  assert _is_read_only_tool_name('manage_jobs') is False
  assert _is_read_only_tool_name('delete_tracked_resource') is False


def test_databricks_tools_require_active_plan_not_agents_read(tmp_path):
  """Data tools should not require a model-issued AGENTS.md read."""
  (tmp_path / 'AGENTS.md').write_text('# Resources\n', encoding='utf-8')
  run_state = AgentToolRunState(project_dir=tmp_path)
  tools = create_databricks_tools(run_state=run_state)
  execute_sql = next(tool for tool in tools if tool.name == 'execute_sql')

  no_plan = json.loads(_invoke_tool(execute_sql, '{"sql_query":"SELECT 1"}'))
  assert no_plan['required_action'].startswith('update_plan(')
  assert 'AGENTS.md' not in json.dumps(no_plan)


def test_legacy_agents_md_placeholder_is_not_loaded(tmp_path):
  """The old resource-ledger placeholder is treated as empty guidance."""
  (tmp_path / 'AGENTS.md').write_text(LEGACY_DEFAULT_AGENTS_MD, encoding='utf-8')

  assert load_project_operating_guide(tmp_path) == ''


def test_ensure_project_operating_guide_migrates_legacy_placeholder(tmp_path):
  """Existing placeholder AGENTS.md files are replaced with mechanism guidance."""
  agents_path = tmp_path / 'AGENTS.md'
  agents_path.write_text(LEGACY_DEFAULT_AGENTS_MD, encoding='utf-8')

  path, changed = ensure_project_operating_guide(tmp_path)

  assert path == agents_path
  assert changed is True
  assert agents_path.read_text(encoding='utf-8') == DEFAULT_PROJECT_OPERATING_GUIDE
  assert load_project_operating_guide(tmp_path).startswith('# Project Operating Guide')


def test_execute_sql_requires_schema_for_configured_project_tables(tmp_path):
  """The first analytical SQL over a configured table must inspect schema."""
  run_state = AgentToolRunState(
    project_dir=tmp_path,
    schema_required_tables={'cat.sch.pilot_bdr_visit_record_seg'},
  )
  run_state.active_step_id = 'step-1'
  tools = create_databricks_tools(run_state=run_state)
  execute_sql = next(tool for tool in tools if tool.name == 'execute_sql')

  blocked = json.loads(_invoke_tool(
    execute_sql,
    '{"sql_query":"SELECT COUNT(DISTINCT bdr_id) FROM cat.sch.pilot_bdr_visit_record_seg"}',
  ))

  assert blocked['missing_schema_for_tables'] == ['cat.sch.pilot_bdr_visit_record_seg']
  assert 'Do not guess column names' in blocked['error']


def test_schema_history_events_unlock_configured_project_tables(tmp_path):
  """Prior successful schema tool results should satisfy the SQL schema gate."""
  run_state = AgentToolRunState(
    project_dir=tmp_path,
    schema_required_tables={'cat.sch.pilot_bdr_visit_record_seg'},
  )

  seeded = run_state.seed_schema_inspections_from_events([
    {
      'type': 'tool_result',
      'tool_name': 'get_table_stats_and_schema',
      'tool_input': {
        'catalog': 'cat',
        'schema': 'sch',
        'table_names': ['pilot_bdr_visit_record_seg'],
      },
      'content': json.dumps({
        'catalog': 'cat',
        'schema_name': 'sch',
        'tables': [{
          'name': 'pilot_bdr_visit_record_seg',
          'column_details': {'employee_no': {'data_type': 'string'}},
        }],
      }),
      'is_error': False,
    }
  ])

  assert seeded == 1
  assert run_state.sql_schema_gate_error(
    'SELECT COUNT(DISTINCT employee_no) FROM cat.sch.pilot_bdr_visit_record_seg'
  ) is None


def test_failed_schema_history_event_does_not_unlock_sql(tmp_path):
  """Failed or empty schema history must not bypass the SQL schema gate."""
  run_state = AgentToolRunState(
    project_dir=tmp_path,
    schema_required_tables={'cat.sch.pilot_bdr_visit_record_seg'},
  )

  seeded = run_state.seed_schema_inspections_from_events([
    {
      'type': 'tool_result',
      'tool_name': 'get_table_stats_and_schema',
      'tool_input': {
        'catalog': 'cat',
        'schema': 'sch',
        'table_names': ['pilot_bdr_visit_record_seg'],
      },
      'content': json.dumps({
        'catalog': 'cat',
        'schema_name': 'sch',
        'tables': [],
      }),
      'is_error': False,
    }
  ])

  assert seeded == 0
  assert run_state.sql_schema_gate_error(
    'SELECT COUNT(DISTINCT employee_no) FROM cat.sch.pilot_bdr_visit_record_seg'
  ) is not None


def test_execute_sql_uses_configured_cluster_when_warehouse_missing(monkeypatch, tmp_path):
  """A configured cluster is used for SQL when no warehouse is configured."""
  from databricks_tools_core.compute import ExecutionResult

  calls = []

  def fake_execute_databricks_command(**kwargs):
    calls.append(kwargs)
    return ExecutionResult(
      success=True,
      output='{"columns": ["answer"], "rows": [[1]]}',
      cluster_id=kwargs['cluster_id'],
      context_id='ctx-1',
      context_destroyed=True,
    )

  def fail_warehouse_sql(**_kwargs):
    raise AssertionError('SQL warehouse execution should not be used')

  monkeypatch.setattr(
    'databricks_tools_core.compute.execute_databricks_command',
    fake_execute_databricks_command,
  )
  monkeypatch.setattr('databricks_tools_core.sql.sql.execute_sql', fail_warehouse_sql)

  run_state = AgentToolRunState(project_dir=tmp_path)
  run_state.active_step_id = 'step-1'
  tools = create_databricks_tools(default_cluster_id='cluster-1', run_state=run_state)
  execute_sql = next(tool for tool in tools if tool.name == 'execute_sql')
  execute_sql_multi = next(tool for tool in tools if tool.name == 'execute_sql_multi')

  result = json.loads(_invoke_tool(execute_sql, '{"sql_query":"SELECT 1"}'))
  multi_result = json.loads(_invoke_tool(execute_sql_multi, '{"sql_content":"SELECT 2"}'))

  assert [call['cluster_id'] for call in calls] == ['cluster-1', 'cluster-1']
  assert [call['language'] for call in calls] == ['python', 'sql']
  assert all(call['destroy_context_on_completion'] is True for call in calls)
  assert result['compute'] == 'cluster'
  assert result['cluster_id'] == 'cluster-1'
  assert multi_result['compute'] == 'cluster'
  assert multi_result['cluster_id'] == 'cluster-1'


def test_table_stats_marks_schema_inspected_before_sql(monkeypatch, tmp_path):
  """Schema inspection unlocks later SQL against configured project tables."""
  run_state = AgentToolRunState(
    project_dir=tmp_path,
    schema_required_tables={'cat.sch.pilot_bdr_visit_record_seg'},
  )
  run_state.active_step_id = 'step-1'

  captured_table_stats_kwargs = {}

  def fake_table_stats(**kwargs):
    captured_table_stats_kwargs.update(kwargs)
    return {
      'catalog': 'cat',
      'schema_name': 'sch',
      'tables': [{
        'name': 'pilot_bdr_visit_record_seg',
        'column_details': {'employee_no': {'name': 'employee_no', 'data_type': 'string'}},
      }],
    }

  def fake_execute_sql(**_kwargs):
    return [{'total_bdrs': 43}]

  monkeypatch.setattr(
    'databricks_tools_core.sql.table_stats.get_table_stats_and_schema',
    fake_table_stats,
  )
  monkeypatch.setattr('databricks_tools_core.sql.sql.execute_sql', fake_execute_sql)

  tools = create_databricks_tools(
    default_warehouse_id='warehouse-1',
    run_state=run_state,
  )
  stats = next(tool for tool in tools if tool.name == 'get_table_stats_and_schema')
  execute_sql = next(tool for tool in tools if tool.name == 'execute_sql')

  _invoke_tool(
    stats,
    json.dumps({
      'catalog': 'cat',
      'schema': 'sch',
      'table_names': '["pilot_bdr_visit_record_seg"]',
      'table_stat_level': 'NONE',
    }),
  )
  result = json.loads(_invoke_tool(
    execute_sql,
    (
      '{"sql_query":"SELECT COUNT(DISTINCT employee_no) AS total_bdrs '
      'FROM cat.sch.pilot_bdr_visit_record_seg"}'
    ),
  ))

  assert captured_table_stats_kwargs['table_names'] == ['pilot_bdr_visit_record_seg']
  assert result == [{'total_bdrs': 43}]


def test_table_stats_defaults_to_none_when_level_is_omitted(monkeypatch, tmp_path):
  """Schema inspection should be cheap unless the caller requests real stats."""
  run_state = AgentToolRunState(project_dir=tmp_path)
  run_state.active_step_id = 'step-1'
  captured_table_stats_kwargs = {}

  def fake_table_stats(**kwargs):
    captured_table_stats_kwargs.update(kwargs)
    return {
      'catalog': 'cat',
      'schema_name': 'sch',
      'tables': [],
    }

  monkeypatch.setattr(
    'databricks_tools_core.sql.table_stats.get_table_stats_and_schema',
    fake_table_stats,
  )

  tools = create_databricks_tools(
    default_warehouse_id='warehouse-1',
    run_state=run_state,
  )
  stats = next(tool for tool in tools if tool.name == 'get_table_stats_and_schema')

  _invoke_tool(
    stats,
    json.dumps({
      'catalog': 'cat',
      'schema': 'sch',
      'table_names': ['pilot_bdr_visit_record_seg'],
    }),
  )

  assert captured_table_stats_kwargs['table_stat_level'].value == 'none'


def test_agent_logger_guard_writes_to_configured_file(tmp_path, monkeypatch):
  """Disabled module loggers are re-enabled and write to the app log file."""
  log_file = tmp_path / 'server.log'
  monkeypatch.setenv('BUILDER_APP_LOG_FILE', str(log_file))
  target_logger = logging.getLogger('tests.oai.agent.logger_guard')

  for handler in list(target_logger.handlers):
    target_logger.removeHandler(handler)
    handler.close()

  target_logger.disabled = True
  target_logger.propagate = True
  target_logger.setLevel(logging.ERROR)

  try:
    ensure_logger_active(target_logger, set_propagate_false=True)
    target_logger.info('guarded agent log line')
    for handler in target_logger.handlers:
      handler.flush()

    assert target_logger.disabled is False
    assert target_logger.propagate is False
    assert 'guarded agent log line' in log_file.read_text(encoding='utf-8')
  finally:
    for handler in list(target_logger.handlers):
      target_logger.removeHandler(handler)
      handler.close()
