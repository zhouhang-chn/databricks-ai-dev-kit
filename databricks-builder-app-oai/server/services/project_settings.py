"""Project setting YAML helpers and Databricks validation."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import yaml
from databricks_tools_core.auth import get_workspace_client
from databricks_tools_core.compute.execution import execute_databricks_command
from databricks_tools_core.sql.sql_utils import SQLExecutor
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..project_config import parse_project_settings
from .backup_manager import ensure_project_directory

logger = logging.getLogger(__name__)

PROJECT_SETTING_FILENAME = 'project_setting.yaml'


def _coerce_optional_string(value: Any) -> str | None:
  if value is None:
    return None
  normalized = str(value).strip()
  return normalized or None


def _coerce_string_list(value: Any) -> list[str]:
  if value is None:
    return []
  if isinstance(value, str):
    return [item.strip() for item in value.splitlines() if item.strip()]
  if isinstance(value, Iterable):
    return [str(item).strip() for item in value if item is not None and str(item).strip()]
  normalized = str(value).strip()
  return [normalized] if normalized else []


class DatabricksResources(BaseModel):
  """Databricks resource hints stored in project_setting.yaml."""

  model_config = ConfigDict(extra='ignore')

  databricks_host: str | None = None
  cluster_id: str | None = None
  warehouse_id: str | None = None
  workspace_folders: list[str] = Field(default_factory=list)
  workspace_files: list[str] = Field(default_factory=list)
  workflows: list[str] = Field(default_factory=list)
  input_schemas: list[str] = Field(default_factory=list)
  input_tables: list[str] = Field(default_factory=list)
  input_metric_views: list[str] = Field(default_factory=list)
  input_volume_paths: list[str] = Field(default_factory=list)
  output_schema: str | None = None
  output_volume_folders: list[str] = Field(default_factory=list)

  @field_validator('databricks_host', 'cluster_id', 'warehouse_id', 'output_schema', mode='before')
  @classmethod
  def _normalize_optional_string(cls, value: Any) -> str | None:
    return _coerce_optional_string(value)

  @field_validator(
    'workspace_folders',
    'workspace_files',
    'workflows',
    'input_schemas',
    'input_tables',
    'input_metric_views',
    'input_volume_paths',
    'output_volume_folders',
    mode='before',
  )
  @classmethod
  def _normalize_string_list(cls, value: Any) -> list[str]:
    return _coerce_string_list(value)


class ProjectSetting(BaseModel):
  """Minimal user-authored v0.2 project setting."""

  model_config = ConfigDict(extra='ignore')

  business_background: str = ''
  analysis_notes: list[str] = Field(default_factory=list)
  databricks_resources: DatabricksResources = Field(default_factory=DatabricksResources)

  @field_validator('business_background', mode='before')
  @classmethod
  def _normalize_business_background(cls, value: Any) -> str:
    return '' if value is None else str(value).strip()

  @field_validator('analysis_notes', mode='before')
  @classmethod
  def _normalize_analysis_notes(cls, value: Any) -> list[str]:
    return _coerce_string_list(value)


class ValidationCheck(BaseModel):
  """One Databricks resource validation check."""

  name: str
  status: Literal['ok', 'warning', 'error']
  message: str
  detail: dict[str, Any] = Field(default_factory=dict)


class ProjectSettingValidationResult(BaseModel):
  """Validation result for project_setting.yaml Databricks resources."""

  valid: bool
  checked_at: str
  sql_execution_mode: Literal['warehouse', 'cluster', 'none']
  summary: str
  checks: list[ValidationCheck]


def _schema_name_for_project(user_email: str, project_name: str | None, project_id: str) -> str:
  local_part = user_email.split('@')[0] if user_email else 'project'
  raw = f'{local_part}_{project_name or project_id}'
  normalized = re.sub(r'[^a-zA-Z0-9]', '_', raw).strip('_').lower()
  return normalized or project_id.replace('-', '_').lower()


def _split_qualified_name(value: str | None, expected_parts: int) -> list[str] | None:
  if not value:
    return None
  parts = [part.strip() for part in value.split('.') if part.strip()]
  return parts if len(parts) == expected_parts else None


def _schema_from_table_name(table_name: str) -> str | None:
  parts = _split_qualified_name(table_name, 3)
  if not parts:
    return None
  return '.'.join(parts[:2])


def _unique_preserve_order(values: Iterable[str | None]) -> list[str]:
  seen: set[str] = set()
  result: list[str] = []
  for value in values:
    if not value:
      continue
    if value in seen:
      continue
    seen.add(value)
    result.append(value)
  return result


def default_project_setting(
  project: Any,
  *,
  user_email: str,
  databricks_host: str | None = None,
) -> ProjectSetting:
  """Build a default project setting from the persisted project metadata."""
  settings = parse_project_settings(getattr(project, 'settings_json', None))
  resources = settings.get('resources') or {}
  semantics = settings.get('semantics') or {}
  workflows = settings.get('workflows') or {}

  default_catalog = resources.get('default_catalog') or 'ai_dev_kit'
  default_schema = resources.get('default_schema') or _schema_name_for_project(
    user_email,
    getattr(project, 'name', None),
    getattr(project, 'id', 'project'),
  )
  output_schema = (
    f'{default_catalog}.{default_schema}' if default_catalog and default_schema else None
  )

  preferred_tables = _coerce_string_list(semantics.get('preferred_tables'))
  metric_views = _coerce_string_list(semantics.get('metric_views'))
  input_schemas = _unique_preserve_order(
    [
      *(_schema_from_table_name(table) for table in preferred_tables),
      *(_schema_from_table_name(view) for view in metric_views),
    ]
  )

  workspace_folder = _coerce_optional_string(resources.get('workspace_folder'))

  return ProjectSetting(
    business_background=getattr(project, 'description', None) or '',
    analysis_notes=_coerce_string_list(semantics.get('known_caveats')),
    databricks_resources=DatabricksResources(
      databricks_host=databricks_host,
      cluster_id=resources.get('cluster_id'),
      warehouse_id=resources.get('warehouse_id'),
      workspace_folders=[workspace_folder] if workspace_folder else [],
      workspace_files=[],
      workflows=_coerce_string_list(workflows.get('enabled')),
      input_schemas=input_schemas,
      input_tables=preferred_tables,
      input_metric_views=metric_views,
      input_volume_paths=[],
      output_schema=output_schema,
      output_volume_folders=[],
    ),
  )


def project_setting_path(project_id: str) -> Path:
  """Return the project_setting.yaml path for a project."""
  return ensure_project_directory(project_id) / PROJECT_SETTING_FILENAME


def _yaml_scalar(value: str | None) -> str:
  if value is None:
    return 'null'
  dumped = yaml.safe_dump(
    value,
    allow_unicode=True,
    default_flow_style=True,
    sort_keys=False,
    width=1000,
  ).strip()
  if dumped.endswith('\n...'):
    dumped = dumped[:-4].strip()
  return dumped


def _append_string_list(
  lines: list[str], key: str, values: list[str], *, indent: str = '  '
) -> None:
  if not values:
    lines.append(f'{indent}{key}: []')
    return

  lines.append(f'{indent}{key}:')
  for value in values:
    lines.append(f'{indent}  - {_yaml_scalar(value)}')


def render_project_setting_yaml(setting: ProjectSetting) -> str:
  """Render a project setting as a readable YAML document."""
  resources = setting.databricks_resources
  background = setting.business_background.strip()
  lines = [
    '# Minimal user-authored project setting.',
    '# The Builder Agent turns this input into structured business and data context.',
    '',
    'business_background: >-',
  ]

  if background:
    lines.extend(f'  {line}' if line else '' for line in background.splitlines())
  else:
    lines.append('  ')

  if setting.analysis_notes:
    lines.extend(['', 'analysis_notes:'])
    for note in setting.analysis_notes:
      lines.append(f'  - {_yaml_scalar(note)}')
  else:
    lines.extend(['', 'analysis_notes: []'])

  lines.extend(
    [
      '',
      'databricks_resources:',
      f'  databricks_host: {_yaml_scalar(resources.databricks_host)}',
      f'  cluster_id: {_yaml_scalar(resources.cluster_id)}',
      f'  warehouse_id: {_yaml_scalar(resources.warehouse_id)}',
    ]
  )
  _append_string_list(lines, 'workspace_folders', resources.workspace_folders)
  _append_string_list(lines, 'workspace_files', resources.workspace_files)
  _append_string_list(lines, 'workflows', resources.workflows)
  _append_string_list(lines, 'input_schemas', resources.input_schemas)
  _append_string_list(lines, 'input_tables', resources.input_tables)
  _append_string_list(lines, 'input_metric_views', resources.input_metric_views)
  _append_string_list(lines, 'input_volume_paths', resources.input_volume_paths)
  lines.append(f'  output_schema: {_yaml_scalar(resources.output_schema)}')
  _append_string_list(lines, 'output_volume_folders', resources.output_volume_folders)
  return '\n'.join(lines) + '\n'


def parse_project_setting_yaml(content: str) -> ProjectSetting:
  """Parse project_setting.yaml content."""
  try:
    parsed = yaml.safe_load(content) or {}
  except yaml.YAMLError as exc:
    raise ValueError(f'Invalid project_setting.yaml: {exc}') from exc

  try:
    return ProjectSetting.model_validate(parsed)
  except ValidationError as exc:
    raise ValueError(f'Invalid project_setting.yaml schema: {exc}') from exc


def ensure_project_setting_file(
  project_id: str,
  project: Any,
  *,
  user_email: str,
  databricks_host: str | None = None,
) -> Path:
  """Create project_setting.yaml if it does not exist and return its path."""
  path = project_setting_path(project_id)
  if not path.exists():
    setting = default_project_setting(
      project, user_email=user_email, databricks_host=databricks_host
    )
    path.write_text(render_project_setting_yaml(setting), encoding='utf-8')
  return path


def read_project_setting(
  project_id: str,
  project: Any,
  *,
  user_email: str,
  databricks_host: str | None = None,
) -> tuple[ProjectSetting, Path]:
  """Read project_setting.yaml, creating it from defaults if needed."""
  path = ensure_project_setting_file(
    project_id,
    project,
    user_email=user_email,
    databricks_host=databricks_host,
  )
  return parse_project_setting_yaml(path.read_text(encoding='utf-8')), path


def write_project_setting(project_id: str, setting: ProjectSetting) -> Path:
  """Write project_setting.yaml and return its path."""
  path = project_setting_path(project_id)
  path.write_text(render_project_setting_yaml(setting), encoding='utf-8')
  return path


def project_update_from_setting(setting: ProjectSetting) -> dict[str, Any]:
  """Convert project_setting.yaml into the app's persisted JSON settings patch."""
  resources = setting.databricks_resources
  output_parts = _split_qualified_name(resources.output_schema, 2)
  pinned = _unique_preserve_order(
    [
      *resources.workspace_folders,
      *resources.workspace_files,
      *resources.workflows,
      *resources.input_schemas,
      *resources.input_tables,
      *resources.input_metric_views,
      *resources.input_volume_paths,
      resources.output_schema,
      *resources.output_volume_folders,
    ]
  )
  return {
    'description': setting.business_background or None,
    'settings': {
      'resources': {
        'cluster_id': resources.cluster_id,
        'warehouse_id': resources.warehouse_id,
        'default_catalog': output_parts[0] if output_parts else None,
        'default_schema': output_parts[1] if output_parts else None,
        'workspace_folder': resources.workspace_folders[0] if resources.workspace_folders else None,
      },
      'resource_registry': {
        'pinned': pinned,
      },
      'semantics': {
        'metric_views': resources.input_metric_views,
        'preferred_tables': resources.input_tables,
        'known_caveats': setting.analysis_notes,
      },
      'workflows': {
        'enabled': resources.workflows,
      },
    },
  }


def _check(
  checks: list[ValidationCheck],
  name: str,
  status: Literal['ok', 'warning', 'error'],
  message: str,
  **detail: Any,
) -> None:
  checks.append(
    ValidationCheck(
      name=name,
      status=status,
      message=message,
      detail={key: value for key, value in detail.items() if value is not None},
    )
  )


def _quote_table_name(full_name: str) -> str:
  return '.'.join(f'`{part.replace("`", "``")}`' for part in full_name.split('.'))


def _sql_execution_mode(resources: DatabricksResources) -> Literal['warehouse', 'cluster', 'none']:
  if resources.warehouse_id:
    return 'warehouse'
  if resources.cluster_id:
    return 'cluster'
  return 'none'


def _validate_current_user(checks: list[ValidationCheck]) -> None:
  client = get_workspace_client()
  try:
    user = client.current_user.me()
  except Exception as exc:
    _check(checks, 'workspace_auth', 'error', f'Could not authenticate to Databricks: {exc}')
    return
  _check(
    checks,
    'workspace_auth',
    'ok',
    f'Authenticated as {getattr(user, "user_name", None) or "current user"}',
  )


def _validate_cluster(checks: list[ValidationCheck], cluster_id: str | None) -> None:
  if not cluster_id:
    _check(checks, 'cluster', 'warning', 'No cluster_id configured.')
    return

  client = get_workspace_client()
  try:
    cluster = client.clusters.get(cluster_id)
  except Exception as exc:
    _check(checks, 'cluster', 'error', f'Cluster {cluster_id} is not accessible: {exc}')
    return

  state = getattr(getattr(cluster, 'state', None), 'value', None) or str(
    getattr(cluster, 'state', 'UNKNOWN')
  )
  name = getattr(cluster, 'cluster_name', None) or cluster_id
  status: Literal['ok', 'warning'] = 'ok' if state == 'RUNNING' else 'warning'
  _check(
    checks, 'cluster', status, f'Cluster {name} is {state}.', cluster_id=cluster_id, state=state
  )


def _validate_warehouse(
  checks: list[ValidationCheck], warehouse_id: str | None, cluster_id: str | None
) -> None:
  if not warehouse_id:
    if cluster_id:
      _check(
        checks,
        'warehouse',
        'ok',
        'No warehouse_id configured; cluster_id will be used for SQL execution.',
      )
    else:
      _check(checks, 'warehouse', 'warning', 'No warehouse_id configured.')
    return

  client = get_workspace_client()
  try:
    warehouse = client.warehouses.get(warehouse_id)
  except Exception as exc:
    _check(checks, 'warehouse', 'error', f'Warehouse {warehouse_id} is not accessible: {exc}')
    return

  state = getattr(getattr(warehouse, 'state', None), 'value', None) or str(
    getattr(warehouse, 'state', 'UNKNOWN')
  )
  name = getattr(warehouse, 'name', None) or warehouse_id
  status: Literal['ok', 'warning'] = 'ok' if state in {'RUNNING', 'STARTING'} else 'warning'
  _check(
    checks,
    'warehouse',
    status,
    f'Warehouse {name} is {state}.',
    warehouse_id=warehouse_id,
    state=state,
  )


def _validate_workspace_paths(
  checks: list[ValidationCheck],
  paths: list[str],
  *,
  expected_directory: bool,
  name: str,
) -> None:
  client = get_workspace_client()
  for path in paths:
    try:
      status = client.workspace.get_status(path=path)
    except Exception as exc:
      _check(checks, name, 'error', f'Workspace path {path} is not accessible: {exc}', path=path)
      continue

    object_type = getattr(getattr(status, 'object_type', None), 'value', None) or str(
      getattr(status, 'object_type', 'UNKNOWN')
    )
    check_status: Literal['ok', 'warning'] = 'ok'
    if expected_directory and object_type != 'DIRECTORY':
      check_status = 'warning'
    if not expected_directory and object_type == 'DIRECTORY':
      check_status = 'warning'
    _check(checks, name, check_status, f'Workspace path {path} exists as {object_type}.', path=path)


def _validate_workflows(checks: list[ValidationCheck], workflows: list[str]) -> None:
  client = get_workspace_client()
  for workflow in workflows:
    try:
      jobs = list(client.jobs.list(name=workflow, limit=100))
    except Exception as exc:
      _check(
        checks,
        'workflow',
        'error',
        f'Workflow {workflow} is not accessible: {exc}',
        workflow=workflow,
      )
      continue

    exact_jobs = [
      job for job in jobs if getattr(getattr(job, 'settings', None), 'name', None) == workflow
    ]
    if exact_jobs:
      job_id = getattr(exact_jobs[0], 'job_id', None)
      _check(
        checks, 'workflow', 'ok', f'Workflow {workflow} exists.', workflow=workflow, job_id=job_id
      )
    elif jobs:
      _check(
        checks,
        'workflow',
        'warning',
        f'Workflow {workflow} had partial matches only.',
        workflow=workflow,
      )
    else:
      _check(checks, 'workflow', 'error', f'Workflow {workflow} was not found.', workflow=workflow)


def _validate_schemas(checks: list[ValidationCheck], schemas: list[str]) -> None:
  client = get_workspace_client()
  for schema_name in schemas:
    if not _split_qualified_name(schema_name, 2):
      _check(
        checks,
        'input_schema',
        'error',
        f'Input schema {schema_name} must use catalog.schema format.',
        schema=schema_name,
      )
      continue

    try:
      client.schemas.get(full_name=schema_name)
    except Exception as exc:
      _check(
        checks, 'input_schema', 'error', f'Input schema {schema_name} is not accessible: {exc}'
      )
      continue
    _check(
      checks, 'input_schema', 'ok', f'Input schema {schema_name} is accessible.', schema=schema_name
    )


def _probe_table_with_warehouse(warehouse_id: str, table_name: str) -> None:
  executor = SQLExecutor(warehouse_id=warehouse_id)
  executor.execute(
    f'SELECT * FROM {_quote_table_name(table_name)} LIMIT 1', row_limit=1, timeout=60
  )


def _probe_table_with_cluster(cluster_id: str, table_name: str) -> None:
  result = execute_databricks_command(
    f'SELECT * FROM {_quote_table_name(table_name)} LIMIT 1',
    cluster_id=cluster_id,
    language='sql',
    timeout=60,
    destroy_context_on_completion=True,
  )
  if not result.success:
    raise RuntimeError(result.error or 'Cluster SQL probe failed')


def _validate_table_metadata(
  checks: list[ValidationCheck], table_name: str, *, check_name: str
) -> bool:
  if not _split_qualified_name(table_name, 3):
    _check(
      checks,
      check_name,
      'error',
      f'{table_name} must use catalog.schema.table format.',
      table=table_name,
    )
    return False

  client = get_workspace_client()
  try:
    client.tables.get(full_name=table_name)
  except Exception as exc:
    _check(
      checks,
      check_name,
      'error',
      f'{table_name} metadata is not accessible: {exc}',
      table=table_name,
    )
    return False

  _check(checks, check_name, 'ok', f'{table_name} metadata is accessible.', table=table_name)
  return True


def _validate_tables(
  checks: list[ValidationCheck],
  tables: list[str],
  resources: DatabricksResources,
) -> None:
  mode = _sql_execution_mode(resources)
  for table_name in tables:
    if not _validate_table_metadata(checks, table_name, check_name='input_table'):
      continue

    if mode == 'none':
      _check(
        checks,
        'input_table_read',
        'warning',
        f'Read probe skipped for {table_name}; no SQL compute configured.',
      )
      continue

    try:
      if mode == 'warehouse':
        _probe_table_with_warehouse(resources.warehouse_id or '', table_name)
      else:
        _probe_table_with_cluster(resources.cluster_id or '', table_name)
    except Exception as exc:
      _check(
        checks,
        'input_table_read',
        'error',
        f'Read probe failed for {table_name}: {exc}',
        table=table_name,
      )
      continue

    _check(
      checks,
      'input_table_read',
      'ok',
      f'Read probe succeeded for {table_name} using {mode}.',
      table=table_name,
      sql_execution_mode=mode,
    )


def _validate_metric_views(checks: list[ValidationCheck], metric_views: list[str]) -> None:
  for metric_view in metric_views:
    _validate_table_metadata(checks, metric_view, check_name='input_metric_view')


def _volume_name_from_path(path: str) -> str | None:
  parts = [part for part in path.split('/') if part]
  if len(parts) < 4 or parts[0] != 'Volumes':
    return None
  return '.'.join(parts[1:4])


def _validate_volume_paths(
  checks: list[ValidationCheck],
  paths: list[str],
  *,
  check_name: str,
  missing_status: Literal['warning', 'error'],
) -> None:
  client = get_workspace_client()
  for path in paths:
    volume_name = _volume_name_from_path(path)
    if not volume_name:
      _check(
        checks,
        check_name,
        'error',
        f'Volume path {path} must start with /Volumes/catalog/schema/volume.',
      )
      continue

    try:
      client.volumes.read(name=volume_name)
    except Exception as exc:
      _check(
        checks, check_name, 'error', f'Volume {volume_name} is not accessible: {exc}', path=path
      )
      continue

    try:
      client.files.get_metadata(path)
    except Exception as exc:
      _check(
        checks,
        check_name,
        missing_status,
        f'Volume path {path} is missing or not accessible: {exc}',
        path=path,
      )
      continue

    _check(checks, check_name, 'ok', f'Volume path {path} is accessible.', path=path)


def _validate_output_schema(checks: list[ValidationCheck], output_schema: str | None) -> None:
  if not output_schema:
    _check(checks, 'output_schema', 'warning', 'No output_schema configured.')
    return
  if not _split_qualified_name(output_schema, 2):
    _check(
      checks,
      'output_schema',
      'error',
      f'Output schema {output_schema} must use catalog.schema format.',
      schema=output_schema,
    )
    return

  client = get_workspace_client()
  try:
    client.schemas.get(full_name=output_schema)
  except Exception as exc:
    _check(
      checks,
      'output_schema',
      'warning',
      f'Output schema {output_schema} does not exist or is not accessible: {exc}',
      schema=output_schema,
    )
    return
  _check(
    checks,
    'output_schema',
    'ok',
    f'Output schema {output_schema} is accessible.',
    schema=output_schema,
  )


def validate_project_setting(setting: ProjectSetting) -> ProjectSettingValidationResult:
  """Validate the Databricks resources referenced by a project setting."""
  resources = setting.databricks_resources
  checks: list[ValidationCheck] = []
  _validate_current_user(checks)
  _validate_cluster(checks, resources.cluster_id)
  _validate_warehouse(checks, resources.warehouse_id, resources.cluster_id)
  _validate_workspace_paths(
    checks, resources.workspace_folders, expected_directory=True, name='workspace_folder'
  )
  _validate_workspace_paths(
    checks, resources.workspace_files, expected_directory=False, name='workspace_file'
  )
  _validate_workflows(checks, resources.workflows)
  _validate_schemas(checks, resources.input_schemas)
  _validate_tables(checks, resources.input_tables, resources)
  _validate_metric_views(checks, resources.input_metric_views)
  _validate_volume_paths(
    checks,
    resources.input_volume_paths,
    check_name='input_volume_path',
    missing_status='error',
  )
  _validate_output_schema(checks, resources.output_schema)
  _validate_volume_paths(
    checks,
    resources.output_volume_folders,
    check_name='output_volume_folder',
    missing_status='warning',
  )

  counts = {
    status: sum(1 for check in checks if check.status == status)
    for status in ('ok', 'warning', 'error')
  }
  return ProjectSettingValidationResult(
    valid=counts['error'] == 0,
    checked_at=datetime.now(UTC).isoformat(),
    sql_execution_mode=_sql_execution_mode(resources),
    summary=f'{counts["ok"]} ok, {counts["warning"]} warning, {counts["error"]} error',
    checks=checks,
  )
