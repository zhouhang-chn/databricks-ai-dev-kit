"""Tests for ``server.services.skills_manager``.

The module is loaded directly from its file path so we do not trigger
``server.services.__init__`` (which pulls in heavier services whose relative
imports only resolve when the full app is running).
"""

import importlib.util
from pathlib import Path


def _load_skills_manager():
  """Load skills_manager.py without importing the server.services package."""
  module_path = Path(__file__).resolve().parents[1] / 'server' / 'services' / 'skills_manager.py'
  spec = importlib.util.spec_from_file_location('skills_manager_under_test', module_path)
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


def _load_live_mcp_tool_names() -> set[str]:
  """Return the set of tool names currently registered with the MCP server.

  Uses the same import/enumeration pattern as ``databricks_tools.py`` so the
  test reflects the tools the running app actually exposes.
  """
  import asyncio

  from databricks_mcp_server.server import mcp
  from databricks_mcp_server.tools import (  # noqa: F401
    compute,
    file,
    pipelines,
    sql,
  )

  tool_manager = getattr(mcp, '_tool_manager', None)
  registered = getattr(tool_manager, '_tools', None)
  if registered:
    return set(registered.keys())

  tools_list = asyncio.run(mcp.list_tools())
  return {t.name for t in tools_list}


def test_skill_tool_mapping_matches_registered_mcp_tools():
  """Every mapped tool must be provided by MCP or the app runtime.

  Without this guard, the MCP server can rename/consolidate a tool while the
  allowlist keeps referring to the dead name. The tool then never becomes
  available even when the owning skill is enabled.
  """
  sm = _load_skills_manager()
  local_runtime_tools = {
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'write_project_file',
    'edit_project_file',
    'list_project_files',
    'grep_project_files',
    'get_project_tree',
    'list_sql_warehouses',
    'get_best_sql_warehouse',
    'check_operation_status',
    'list_operations',
  }
  live = _load_live_mcp_tool_names() | local_runtime_tools
  stale: dict[str, list[str]] = {}
  for skill, names in sm.SKILL_TOOL_MAPPING.items():
    missing = [n for n in names if n not in live]
    if missing:
      stale[skill] = missing

  assert not stale, (
    f'SKILL_TOOL_MAPPING references tools that do not exist in the MCP server: '
    f'{stale}. Update the mapping or rename the server tool.'
  )


def test_get_allowed_mcp_tools_uses_enabled_skill_whitelist():
  """Enabling one skill should expose only base tools plus that skill's tools."""
  sm = _load_skills_manager()
  all_tools = [
    'mcp__databricks__manage_jobs',
    'mcp__databricks__manage_job_runs',
    'mcp__databricks__manage_dashboard',
    'mcp__databricks__execute_sql',
    'mcp__databricks__check_operation_status',
  ]

  allowed = sm.get_allowed_mcp_tools(all_tools, enabled_skills=['databricks-aibi-dashboards'])

  assert 'mcp__databricks__manage_jobs' not in allowed
  assert 'mcp__databricks__manage_job_runs' not in allowed
  assert 'mcp__databricks__manage_dashboard' in allowed
  assert 'mcp__databricks__execute_sql' in allowed
  assert 'mcp__databricks__check_operation_status' in allowed


def test_databricks_analysis_gets_minimal_read_only_tools():
  """The analysis skill should not inherit unrelated write or lifecycle tools."""
  sm = _load_skills_manager()
  all_tools = [
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'write_project_file',
    'edit_project_file',
    'execute_sql',
    'execute_sql_multi',
    'get_table_schema',
    'get_table_stats',
    'list_compute',
    'get_current_user',
    'manage_cluster',
    'manage_sql_warehouse',
    'generate_and_upload_pdf',
    'delete_tracked_resource',
    'mcp__databricks__execute_sql',
    'mcp__databricks__manage_cluster',
  ]

  allowed = sm.get_allowed_mcp_tools(all_tools, enabled_skills=['databricks-analysis'])

  assert allowed == [
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'execute_sql',
    'execute_sql_multi',
    'get_table_schema',
    'get_table_stats',
    'list_compute',
    'get_current_user',
    'mcp__databricks__execute_sql',
  ]


def test_databricks_analysis_skill_documents_metric_view_first_routing():
  """The analysis skill should route governed KPI questions through Metric Views first."""
  skill_path = Path(__file__).resolve().parents[2] / 'databricks-skills' / 'databricks-analysis' / 'SKILL.md'
  skill = skill_path.read_text(encoding='utf-8')

  assert 'Semantic layer first' in skill
  assert 'Query Metric Views through `execute_sql` using `MEASURE(...)`' in skill
  assert 'Do not call input tables "preferred" tables' in skill
  assert 'Do not silently skip to raw input tables' in skill


def test_scenario_onboarding_skill_gets_artifact_and_semantic_tools():
  """Scenario onboarding needs project artifacts plus Metric View inventory tools."""
  sm = _load_skills_manager()
  all_tools = [
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'write_project_file',
    'edit_project_file',
    'list_project_files',
    'grep_project_files',
    'get_project_tree',
    'execute_sql',
    'get_table_schema',
    'get_table_stats',
    'manage_metric_views',
    'manage_volume_files',
    'get_volume_folder_details',
    'manage_workspace_files',
    'manage_jobs',
  ]

  allowed = sm.get_allowed_mcp_tools(
    all_tools,
    enabled_skills=['databricks-scenario-onboarding'],
  )

  assert allowed == [
    'update_plan',
    'submit_conclusion',
    'read_project_file',
    'write_project_file',
    'edit_project_file',
    'list_project_files',
    'grep_project_files',
    'get_project_tree',
    'execute_sql',
    'get_table_schema',
    'get_table_stats',
    'manage_metric_views',
    'manage_volume_files',
    'get_volume_folder_details',
    'manage_workspace_files',
  ]
