"""Unit tests for the OpenAI runtime support modules."""

import logging
from dataclasses import dataclass

import pytest
from server.services.agent_runtime.openai_events import normalize_openai_event
from server.services.agent_runtime.openai_models import load_model_settings
from server.services.agent_runtime.openai_runtime import _resolve_enabled_skills
from server.services.logging_utils import ensure_logger_active
from server.services.tools.databricks_openai import _is_read_only_tool_name
from server.services.skills_manager import filter_openai_tools_by_skills
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
