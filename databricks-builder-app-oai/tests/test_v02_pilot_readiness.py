"""Tests for the v0.2 pilot readiness recorder."""

import importlib.util
import json
from pathlib import Path


def _load_script():
  script_path = Path(__file__).parents[1] / 'scripts' / 'v02_pilot_readiness.py'
  spec = importlib.util.spec_from_file_location('v02_pilot_readiness', script_path)
  assert spec and spec.loader
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


def test_pilot_readiness_report_records_resources_and_tool_safety(tmp_path):
  """The smoke artifact records v0.2 resource, validation, trace, and tool evidence."""
  script = _load_script()
  setting_path = tmp_path / 'project_setting.yaml'
  setting_path.write_text(
    """
business_background: >-
  BDR pilot.
analysis_notes:
  - Use validated visit-base denominator.
databricks_resources:
  warehouse_id: wh-1
  input_tables:
    - cat.sch.pilot_bdr_visit_record_seg
  input_metric_views:
    - cat.sch.bdr_metric_view
  output_schema: out.schema
""".strip(),
    encoding='utf-8',
  )
  events_payload = [
    {'type': 'tool_use', 'tool_name': 'get_table_stats_and_schema', 'trace_id': 'tr-1'},
    {'type': 'tool_use', 'tool_name': 'execute_sql'},
  ]
  tool_manifest_payload = [
    {'type': 'function_tool', 'name': 'read_project_file'},
    {'type': 'function_tool', 'name': 'execute_sql'},
  ]

  report = script.build_report(
    project_id='bdr-routing-pilot',
    project_setting_path=setting_path,
    run_role='user_preview',
    validation_payload={
      'valid': True,
      'summary': '3 checks passed',
      'sql_execution_mode': 'warehouse',
    },
    events_payload=events_payload,
    tool_manifest_payload=tool_manifest_payload,
  )
  markdown = script.render_markdown(report)

  assert report['selected_resources']['warehouse_id'] == 'wh-1'
  assert report['selected_resources']['input_tables'] == ['cat.sch.pilot_bdr_visit_record_seg']
  assert report['selected_resources']['input_metric_views'] == ['cat.sch.bdr_metric_view']
  assert report['trace_id'] == 'tr-1'
  assert report['validation']['status'] == 'pass'
  assert report['tool_safety']['write_tools_exposed'] == []
  assert report['tool_safety']['write_tools_invoked'] == []
  assert '- [x] no write tools were exposed' in markdown
  assert '- [x] no write tools were invoked' in markdown


def test_pilot_readiness_report_flags_write_tool_evidence(tmp_path):
  """Write exposure and invocation evidence should stay visible in the checklist."""
  script = _load_script()
  setting_path = tmp_path / 'project_setting.yaml'
  setting_path.write_text(
    """
business_background: >-
  BDR pilot.
databricks_resources:
  input_tables:
    - cat.sch.table
""".strip(),
    encoding='utf-8',
  )
  events_path = tmp_path / 'events.jsonl'
  events_path.write_text(
    '\n'.join([
      json.dumps({'type': 'tool_use', 'tool_name': 'write_project_file'}),
      json.dumps({'type': 'tool_use', 'tool_name': 'manage_jobs'}),
    ]),
    encoding='utf-8',
  )

  report = script.build_report(
    project_id='bdr-routing-pilot',
    project_setting_path=setting_path,
    run_role='user_preview',
    events_payload=script.load_json_or_jsonl(events_path),
    tool_manifest_payload=[{'type': 'function_tool', 'name': 'manage_jobs'}],
  )
  markdown = script.render_markdown(report)

  assert report['tool_safety']['write_tools_exposed'] == ['manage_jobs']
  assert report['tool_safety']['write_tools_invoked'] == ['manage_jobs', 'write_project_file']
  assert '- [ ] no write tools were exposed' in markdown
  assert '- [ ] no write tools were invoked' in markdown
