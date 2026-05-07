"""Unit tests for the OpenAI runtime support modules."""

import logging
from dataclasses import dataclass

import pytest
from server.services.active_stream import ActiveStream
from server.services.agent_runtime.openai_events import normalize_openai_event
from server.services.agent_runtime.openai_models import load_model_settings
from server.services.agent_runtime.openai_runtime import _resolve_enabled_skills
from server.services.logging_utils import ensure_logger_active
from server.services.skills_manager import filter_openai_tools_by_skills
from server.services.tools.databricks_openai import _is_read_only_tool_name
from server.services.tools.project_files import (
  MAX_READ_BYTES,
  ProjectFileError,
  _resolve_project_path,
  create_project_file_tools,
)


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
          'arguments': '{"op": "start", "step_id": "step-1", "narrative": "Looking at sales grain"}',
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


def test_update_plan_create_is_idempotent_per_run():
  """A second update_plan(op='create') in the same run returns guidance, not ack."""
  from server.services.tools.plan_tools import create_plan_tools

  tools = create_plan_tools()
  update_plan = next(t for t in tools if t.name == 'update_plan')
  args = '{"op":"create","objective":"x","steps":[{"id":"step-1","title":"t"}]}'

  first = _invoke_plan_tool(update_plan, args, 'call_1')
  second = _invoke_plan_tool(update_plan, args, 'call_2')

  assert first['ack'] == 'plan_created'
  assert second['ack'] == 'plan_already_exists'
  assert 'guidance' in second
  # Guidance must redirect to start/revise, not encourage another create
  assert 'op="start"' in second['guidance'] or "op='start'" in second['guidance']
  assert 'create' not in second['guidance'] or 'do not call' in second['guidance'].lower()


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
  assert duplicate_a['ack'] == 'plan_already_exists'

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

  # Now a stray create should be redirected, not freshly accepted
  follow_up = _invoke_plan_tool(
    update_plan,
    '{"op":"create","objective":"x","steps":[]}',
    'r2',
  )
  assert follow_up['ack'] == 'plan_already_exists'


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
  """Skill allowlist filtering also works for plain OpenAI tool names."""

  @dataclass
  class Tool:
    name: str

  tools = [Tool('manage_jobs'), Tool('manage_dashboard'), Tool('execute_sql')]

  allowed = filter_openai_tools_by_skills(
    tools,
    enabled_skills=['databricks-aibi-dashboards'],
  )

  assert [tool.name for tool in allowed] == ['manage_dashboard', 'execute_sql']


def test_user_preview_databricks_tool_filter_blocks_write_tools():
  """Generated Databricks tools in user preview should be read-oriented."""
  assert _is_read_only_tool_name('get_table_stats_and_schema') is True
  assert _is_read_only_tool_name('query_vs_index') is True
  assert _is_read_only_tool_name('manage_jobs') is False
  assert _is_read_only_tool_name('delete_tracked_resource') is False


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
