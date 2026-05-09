"""Record v0.2 analyst pilot readiness evidence.

Usage:
  uv run python scripts/v02_pilot_readiness.py --project-id bdr-routing-pilot \
    --project-setting /path/to/project_setting.yaml --run-role user_preview \
    --validation-json /tmp/project-setting-validation.json --events-json /tmp/events.jsonl \
    --tool-manifest-json /tmp/exposed-tools.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml

READ_ONLY_EXACT_TOOL_NAMES = {
  'ask_genie',
  'execute_sql',
  'execute_sql_multi',
  'get_best_sql_warehouse',
  'get_table_stats_and_schema',
  'get_volume_folder_details',
  'list_compute',
  'list_project_files',
  'list_sql_warehouses',
  'list_tracked_resources',
  'query_vs_index',
  'read_project_file',
}

READ_ONLY_TOOL_PREFIXES = (
  'describe_',
  'get_',
  'grep_',
  'list_',
  'query_',
  'scan_',
)

WRITE_TOOL_PREFIXES = (
  'create',
  'delete',
  'download',
  'drop',
  'edit',
  'execute_code',
  'generate_and_upload',
  'grant',
  'manage',
  'revoke',
  'start',
  'stop',
  'update',
  'upload',
  'write',
)

PROJECT_FILE_MUTATION_TOOLS = {
  'edit_project_file',
  'write_project_file',
}

RESOURCE_KEYS = [
  'databricks_host',
  'cluster_id',
  'warehouse_id',
  'workspace_folders',
  'workspace_files',
  'workflows',
  'input_schemas',
  'input_tables',
  'input_metric_views',
  'input_volume_paths',
  'output_schema',
  'output_volume_folders',
]


def load_project_setting(path: Path) -> dict[str, Any]:
  """Load a project_setting.yaml file."""
  data = yaml.safe_load(path.read_text(encoding='utf-8')) or {}
  if not isinstance(data, dict):
    raise ValueError(f'{path} did not parse as a mapping')
  return data


def selected_resources(setting: dict[str, Any]) -> dict[str, Any]:
  """Return the Databricks resource hints recorded in project_setting.yaml."""
  resources = setting.get('databricks_resources') or {}
  if not isinstance(resources, dict):
    return {key: None for key in RESOURCE_KEYS}
  return {key: resources.get(key) for key in RESOURCE_KEYS}


def load_json_or_jsonl(path: Path | None) -> Any:
  """Load JSON, JSON arrays, or newline-delimited JSON."""
  if path is None:
    return None

  content = path.read_text(encoding='utf-8').strip()
  if not content:
    return []

  try:
    return json.loads(content)
  except json.JSONDecodeError:
    values: list[Any] = []
    for line in content.splitlines():
      stripped = line.strip()
      if stripped:
        values.append(json.loads(stripped))
    return values


def _as_event_list(payload: Any) -> list[Any]:
  if payload is None:
    return []
  if isinstance(payload, list):
    return payload
  if isinstance(payload, dict):
    for key in ('events', 'data', 'items'):
      value = payload.get(key)
      if isinstance(value, list):
        return value
    return [payload]
  return []


def _walk_tool_names(value: Any) -> list[str]:
  names: list[str] = []
  if isinstance(value, str):
    return [value]
  if isinstance(value, list):
    for item in value:
      names.extend(_walk_tool_names(item))
    return names
  if not isinstance(value, dict):
    return names

  direct = value.get('tool_name') or value.get('toolName')
  if isinstance(direct, str) and direct:
    names.append(direct)

  event_type = str(value.get('type') or value.get('event') or '').lower()
  if isinstance(value.get('name'), str) and any(
    marker in event_type for marker in ('tool', 'function', 'call')
  ):
    names.append(value['name'])

  function = value.get('function')
  if isinstance(function, dict) and isinstance(function.get('name'), str):
    names.append(function['name'])

  for key in ('tool', 'tools', 'item', 'items', 'data', 'payload', 'message'):
    if key in value:
      names.extend(_walk_tool_names(value[key]))

  return names


def extract_tool_names(payload: Any) -> list[str]:
  """Extract tool names from a manifest or event payload."""
  return sorted({name for name in _walk_tool_names(payload) if name})


def extract_trace_id(events: list[Any]) -> str | None:
  """Find a trace identifier in normalized runtime events."""
  for event in events:
    if not isinstance(event, dict):
      continue
    for key in ('trace_id', 'traceId', 'mlflow_trace_id'):
      value = event.get(key)
      if value:
        return str(value)
    data = event.get('data')
    if isinstance(data, dict):
      for key in ('trace_id', 'traceId', 'mlflow_trace_id'):
        value = data.get(key)
        if value:
          return str(value)
  return None


def is_write_tool_name(name: str) -> bool:
  """Mirror the user-preview write-tool blocklist for pilot evidence."""
  lowered = name.strip().lower()
  if not lowered:
    return False
  if lowered in PROJECT_FILE_MUTATION_TOOLS:
    return True
  if lowered in READ_ONLY_EXACT_TOOL_NAMES:
    return False
  if lowered.startswith(READ_ONLY_TOOL_PREFIXES):
    return False
  return lowered.startswith(WRITE_TOOL_PREFIXES)


def summarize_validation(payload: Any) -> dict[str, Any]:
  """Summarize a project-setting validation response."""
  if payload is None:
    return {
      'status': 'not_provided',
      'summary': 'No validation result was provided.',
      'valid': None,
    }
  if not isinstance(payload, dict):
    return {
      'status': 'unknown',
      'summary': 'Validation payload was not a mapping.',
      'valid': None,
    }

  valid = payload.get('valid')
  status = 'pass' if valid is True else 'fail' if valid is False else 'unknown'
  return {
    'status': status,
    'summary': payload.get('summary') or 'Validation summary was not provided.',
    'valid': valid,
    'sql_execution_mode': payload.get('sql_execution_mode'),
    'checked_at': payload.get('checked_at'),
  }


def build_report(
  *,
  project_id: str,
  project_setting_path: Path,
  run_role: str,
  validation_payload: Any = None,
  events_payload: Any = None,
  tool_manifest_payload: Any = None,
  trace_id: str | None = None,
) -> dict[str, Any]:
  """Build a serializable readiness report."""
  setting = load_project_setting(project_setting_path)
  events = _as_event_list(events_payload)
  event_tool_names = extract_tool_names(events)
  manifest_tool_names = extract_tool_names(tool_manifest_payload)
  write_tools_invoked = [name for name in event_tool_names if is_write_tool_name(name)]
  write_tools_exposed = [name for name in manifest_tool_names if is_write_tool_name(name)]

  return {
    'project_id': project_id,
    'project_setting_path': str(project_setting_path),
    'run_role': run_role,
    'trace_id': trace_id or extract_trace_id(events),
    'selected_resources': selected_resources(setting),
    'validation': summarize_validation(validation_payload),
    'tool_safety': {
      'tool_manifest_provided': tool_manifest_payload is not None,
      'events_provided': events_payload is not None,
      'write_tools_exposed': write_tools_exposed,
      'write_tools_invoked': write_tools_invoked,
    },
  }


def _format_value(value: Any) -> str:
  if value is None or value == []:
    return 'not set'
  if isinstance(value, list):
    return ', '.join(f'`{item}`' for item in value) if value else 'not set'
  return f'`{value}`'


def _check(done: bool, text: str) -> str:
  mark = 'x' if done else ' '
  return f'- [{mark}] {text}'


def render_markdown(report: dict[str, Any]) -> str:
  """Render the readiness report as a Markdown checklist."""
  validation = report['validation']
  safety = report['tool_safety']
  resources = report['selected_resources']
  write_tools_exposed = safety['write_tools_exposed']
  write_tools_invoked = safety['write_tools_invoked']

  lines = [
    '# v0.2 Pilot Readiness Report',
    '',
    f"- Project id: `{report['project_id']}`",
    f"- Project setting path: `{report['project_setting_path']}`",
    f"- Run role: `{report['run_role']}`",
    f"- Trace id: `{report['trace_id'] or 'not provided'}`",
    '',
    '## Selected Resources',
  ]
  lines.extend(f'- {key}: {_format_value(resources.get(key))}' for key in RESOURCE_KEYS)
  lines.extend([
    '',
    '## Validation Result',
    f"- Status: `{validation['status']}`",
    f"- Summary: {validation['summary']}",
  ])
  if validation.get('sql_execution_mode'):
    lines.append(f"- SQL execution mode: `{validation['sql_execution_mode']}`")
  if validation.get('checked_at'):
    lines.append(f"- Checked at: `{validation['checked_at']}`")

  lines.extend([
    '',
    '## Tool Safety',
    f"- Tool manifest provided: `{safety['tool_manifest_provided']}`",
    f"- Run events provided: `{safety['events_provided']}`",
    f'- Write tools exposed: {_format_value(write_tools_exposed)}',
    f'- Write tools invoked: {_format_value(write_tools_invoked)}',
    '',
    '## Checklist',
    _check(Path(report['project_setting_path']).exists(), 'project_setting.yaml path exists'),
    _check(any(resources.get(key) for key in RESOURCE_KEYS), 'selected resources are recorded'),
    _check(validation['valid'] is not None, 'validation result is attached'),
    _check(
      report['run_role'] in {'user', 'user_preview', 'viewer'},
      'run role is read-only/user-preview',
    ),
    _check(bool(report['trace_id']), 'trace id is recorded'),
    _check(
      safety['tool_manifest_provided'] and not write_tools_exposed,
      'no write tools were exposed',
    ),
    _check(safety['events_provided'] and not write_tools_invoked, 'no write tools were invoked'),
  ])
  return '\n'.join(lines) + '\n'


def parse_args() -> argparse.Namespace:
  """Parse CLI arguments."""
  parser = argparse.ArgumentParser(description='Record v0.2 pilot readiness evidence.')
  parser.add_argument('--project-id', required=True)
  parser.add_argument('--project-setting', required=True, type=Path)
  parser.add_argument('--run-role', default='user_preview')
  parser.add_argument('--validation-json', type=Path)
  parser.add_argument('--events-json', type=Path)
  parser.add_argument('--tool-manifest-json', type=Path)
  parser.add_argument('--trace-id')
  parser.add_argument('--output', type=Path)
  return parser.parse_args()


def main() -> None:
  """Run the CLI."""
  args = parse_args()
  report = build_report(
    project_id=args.project_id,
    project_setting_path=args.project_setting,
    run_role=args.run_role,
    validation_payload=load_json_or_jsonl(args.validation_json),
    events_payload=load_json_or_jsonl(args.events_json),
    tool_manifest_payload=load_json_or_jsonl(args.tool_manifest_json),
    trace_id=args.trace_id,
  )
  markdown = render_markdown(report)
  if args.output:
    args.output.write_text(markdown, encoding='utf-8')
  else:
    print(markdown, end='')


if __name__ == '__main__':
  main()
