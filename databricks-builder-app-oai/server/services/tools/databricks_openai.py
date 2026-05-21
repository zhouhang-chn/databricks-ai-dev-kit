"""OpenAI function tools for Databricks.

Two layers feed the agent's tool list:

1. **Typed wrappers** (``execute_sql``, ``execute_sql_multi``,
   ``get_table_schema``, ``get_table_stats``, ``list_sql_warehouses``,
   ``get_best_sql_warehouse``, ``list_compute``) keep ergonomic,
   default-aware coverage for the most common operations. They use the project
   default catalog/schema/warehouse/cluster and are always available.

2. **Generated FastMCP tools** (``_load_fastmcp_tools``) walk the FastMCP tool
   registry from ``databricks-mcp-server`` and emit a ``FunctionTool`` per tool,
   reusing FastMCP's JSON Schema. Skill-based filtering in
   ``skills_manager.filter_openai_tools_by_skills`` later prunes the list.

Long-running tools are wrapped with the same async-handoff pattern the
Claude-based runtime used: when execution exceeds
``SAFE_EXECUTION_THRESHOLD`` seconds, the wrapper returns an operation ID
and continues in a background thread; the agent polls via
``check_operation_status``.
"""

import asyncio
import fnmatch
import inspect
import json
import logging
import re
import threading
import time
from contextvars import copy_context
from typing import Any

from ..operation_tracker import complete_operation, create_operation
from .run_state import AgentToolRunState

logger = logging.getLogger(__name__)

# Threshold (seconds) before a sync FastMCP tool hands off to background
# execution. Mirrors the Claude SDK runtime's safety value so model streams
# stay responsive on long-running Databricks operations.
SAFE_EXECUTION_THRESHOLD = 10

# Names already covered by typed wrappers; the FastMCP loader skips
# duplicates so the agent never sees two tools with the same name.
_TYPED_WRAPPER_NAMES: frozenset[str] = frozenset(
  {
    'execute_sql',
    'execute_sql_multi',
    'get_table_schema',
    'get_table_stats',
    # Deprecated combined tool. Keep it here so FastMCP does not expose it to
    # the model; the split wrappers below are the intended public surface.
    'get_table_stats_and_schema',
    'list_sql_warehouses',
    'get_best_sql_warehouse',
    'list_compute',
  }
)

_OPTIONAL_STRING_SCHEMA = {'anyOf': [{'type': 'string'}, {'type': 'null'}]}
_TABLE_SCHEMA_PARAMS_JSON_SCHEMA: dict[str, Any] = {
  'type': 'object',
  'properties': {
    'catalog': {
      **_OPTIONAL_STRING_SCHEMA,
      'description': 'Unity Catalog catalog name. Uses the project default when omitted.',
    },
    'schema': {
      **_OPTIONAL_STRING_SCHEMA,
      'description': 'Unity Catalog schema name. Uses the project default when omitted.',
    },
    'table_names': {
      'anyOf': [
        {'type': 'array', 'items': {'type': 'string'}},
        {'type': 'string'},
        {'type': 'null'},
      ],
      'description': 'Optional table name, wildcard pattern, JSON list string, or list.',
    },
    'warehouse_id': {
      **_OPTIONAL_STRING_SCHEMA,
      'description': 'SQL warehouse ID. Uses the project default when omitted.',
    },
    'timeout': {
      'type': 'integer',
      'default': 180,
      'minimum': 1,
      'description': 'Timeout in seconds for cluster fallback execution.',
    },
  },
  'additionalProperties': True,
}
_TABLE_STATS_PARAMS_JSON_SCHEMA: dict[str, Any] = {
  'type': 'object',
  'properties': {
    'catalog': {
      **_OPTIONAL_STRING_SCHEMA,
      'description': 'Unity Catalog catalog name. Uses the project default when omitted.',
    },
    'schema': {
      **_OPTIONAL_STRING_SCHEMA,
      'description': 'Unity Catalog schema name. Uses the project default when omitted.',
    },
    'table_name': {
      'type': 'string',
      'description': 'Single table name to profile. Use get_table_schema first to discover columns.',
    },
    'columns': {
      'anyOf': [
        {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
        {'type': 'string'},
      ],
      'description': 'Required explicit columns to profile. Do not request every column unless the user asks.',
    },
    'warehouse_id': {
      **_OPTIONAL_STRING_SCHEMA,
      'description': 'SQL warehouse ID. Uses the project default when omitted.',
    },
    'timeout': {
      'type': 'integer',
      'default': 180,
      'minimum': 1,
      'description': 'Timeout in seconds for cluster fallback execution.',
    },
  },
  'required': ['table_name', 'columns'],
  'additionalProperties': True,
}


def _jsonable(value: Any) -> Any:
  try:
    json.dumps(value)
    return value
  except TypeError:
    if hasattr(value, 'model_dump'):
      return value.model_dump(exclude_none=True)
    if hasattr(value, 'as_dict'):
      return value.as_dict()
    if hasattr(value, '__dict__'):
      return value.__dict__
    return str(value)


async def _to_thread_with_context(fn, *args, **kwargs):
  ctx = copy_context()
  return await asyncio.to_thread(lambda: ctx.run(fn, *args, **kwargs))


def _optional_str(value: Any) -> str | None:
  """Return a non-empty string, or None for omitted JSON tool arguments."""
  if value is None:
    return None
  text = str(value).strip()
  return text or None


def _optional_int(value: Any, *, default: int) -> int:
  """Return a positive integer from JSON tool arguments, or a default."""
  if value is None:
    return default
  try:
    parsed = int(value)
  except (TypeError, ValueError):
    return default
  return parsed if parsed > 0 else default


def create_databricks_tools(
  *,
  default_catalog: str | None = None,
  default_schema: str | None = None,
  default_cluster_id: str | None = None,
  default_warehouse_id: str | None = None,
  read_only: bool = False,
  run_state: AgentToolRunState | None = None,
) -> list:
  """Create the full Databricks tool set: typed wrappers + generated FastMCP."""
  from agents import FunctionTool, function_tool

  def _is_read_only_sql(sql_query: str) -> bool:
    normalized = sql_query.strip().lower()
    return normalized.startswith((
      'select ',
      'with ',
      'show ',
      'describe ',
      'desc ',
      'explain ',
      'values ',
    ))

  def _gate_databricks_tool(tool_name: str) -> str | None:
    if not run_state:
      return None
    gate_error = run_state.databricks_gate_error(tool_name)
    return json.dumps(gate_error) if gate_error else None

  @function_tool(strict_mode=False)
  async def execute_sql(
    sql_query: str,
    warehouse_id: str | None = None,
    catalog: str | None = None,
    database_schema: str | None = None,
    timeout: int = 180,
  ) -> str:
    """Execute SQL on the configured warehouse or cluster fallback."""
    from databricks_tools_core.sql.sql import execute_sql as _execute_sql

    gate_error = _gate_databricks_tool('execute_sql')
    if gate_error:
      return gate_error
    if run_state:
      schema_error = run_state.sql_schema_gate_error(sql_query)
      if schema_error:
        return json.dumps(schema_error)

    if read_only and not _is_read_only_sql(sql_query):
      return json.dumps({
        'error': (
          'This project run is in read-only user preview mode. '
          'Only SELECT, WITH, SHOW, DESCRIBE, EXPLAIN, and VALUES SQL is allowed.'
        )
      })

    effective_warehouse_id = warehouse_id or default_warehouse_id
    if effective_warehouse_id or not default_cluster_id:
      rows = await _to_thread_with_context(
        _execute_sql,
        sql_query=sql_query,
        warehouse_id=effective_warehouse_id,
        catalog=catalog or default_catalog,
        schema=database_schema or default_schema,
        timeout=timeout,
        query_tags='app:databricks-builder-app-oai',
      )
      if run_state:
        run_state.mark_sql_schema_inspection(sql_query)
      return json.dumps(_jsonable(rows), default=str)

    from databricks_tools_core.compute import execute_databricks_command

    logger.info(
      'Executing SQL through configured cluster fallback: cluster_id=%s',
      default_cluster_id,
    )
    python_code = f"""
import json
import datetime

def serialize(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    return v

df = spark.sql({repr(sql_query)})
columns = df.columns
rows = [[serialize(cell) for cell in row] for row in df.limit(1000).collect()]
print(json.dumps({{"columns": columns, "rows": rows}}))
"""
    result = await _to_thread_with_context(
      execute_databricks_command,
      code=python_code,
      cluster_id=default_cluster_id,
      language='python',
      timeout=timeout,
      destroy_context_on_completion=True,
    )
    if run_state and getattr(result, 'success', False):
      run_state.mark_sql_schema_inspection(sql_query)
    payload = _jsonable(result)
    if isinstance(payload, dict) and getattr(result, 'success', False):
      output_str = payload.get('output', '')
      try:
        parsed_output = json.loads(output_str)
        payload['rows'] = parsed_output.get('rows')
        payload['columns'] = parsed_output.get('columns')
      except Exception:
        pass
    if isinstance(payload, dict):
      payload.setdefault('compute', 'cluster')
      payload.setdefault('cluster_id', default_cluster_id)
    return json.dumps(payload, default=str)

  @function_tool(strict_mode=False)
  async def execute_sql_multi(
    sql_content: str,
    warehouse_id: str | None = None,
    catalog: str | None = None,
    database_schema: str | None = None,
    timeout: int = 180,
    max_workers: int = 4,
  ) -> str:
    """Execute SQL statements on the configured warehouse or cluster fallback."""
    from databricks_tools_core.sql.sql import execute_sql_multi as _execute_sql_multi

    gate_error = _gate_databricks_tool('execute_sql_multi')
    if gate_error:
      return gate_error
    if run_state:
      schema_error = run_state.sql_schema_gate_error(sql_content)
      if schema_error:
        return json.dumps(schema_error)

    if read_only and not _is_read_only_sql(sql_content):
      return json.dumps({
        'error': (
          'This project run is in read-only user preview mode. '
          'Only SELECT, WITH, SHOW, DESCRIBE, EXPLAIN, and VALUES SQL is allowed.'
        )
      })

    effective_warehouse_id = warehouse_id or default_warehouse_id
    if effective_warehouse_id or not default_cluster_id:
      result = await _to_thread_with_context(
        _execute_sql_multi,
        sql_content=sql_content,
        warehouse_id=effective_warehouse_id,
        catalog=catalog or default_catalog,
        schema=database_schema or default_schema,
        timeout=timeout,
        max_workers=max_workers,
        query_tags='app:databricks-builder-app-oai',
      )
      if run_state:
        run_state.mark_sql_schema_inspection(sql_content)
      return json.dumps(_jsonable(result), default=str)

    from databricks_tools_core.compute import execute_databricks_command

    logger.info(
      'Executing multi-statement SQL through configured cluster fallback: cluster_id=%s',
      default_cluster_id,
    )
    result = await _to_thread_with_context(
      execute_databricks_command,
      code=sql_content,
      cluster_id=default_cluster_id,
      language='sql',
      timeout=timeout,
      destroy_context_on_completion=True,
    )
    if run_state and getattr(result, 'success', False):
      run_state.mark_sql_schema_inspection(sql_content)
    payload = _jsonable(result)
    if isinstance(payload, dict):
      payload.setdefault('compute', 'cluster')
      payload.setdefault('cluster_id', default_cluster_id)
    return json.dumps(payload, default=str)

  async def _invoke_get_table_schema(
    catalog: str | None = None,
    schema: str | None = None,
    table_names: list[str] | str | None = None,
    warehouse_id: str | None = None,
    timeout: int = 180,
  ) -> str:
    """Get table schema on the configured warehouse or cluster fallback."""
    gate_error = _gate_databricks_tool('get_table_schema')
    if gate_error:
      return gate_error

    effective_catalog = catalog or default_catalog
    effective_schema = schema or default_schema
    if not effective_catalog or not effective_schema:
      return json.dumps({
        'error': (
          'catalog and schema are required. Provide them explicitly or configure '
          'default catalog/schema in project settings.'
        )
      })

    normalized_table_names = _coerce_table_names(table_names)
    effective_warehouse_id = warehouse_id or default_warehouse_id
    if effective_warehouse_id or not default_cluster_id:
      from databricks_tools_core.sql.table_stats import (
        get_table_schema as _get_table_schema,
      )

      result = await _to_thread_with_context(
        _get_table_schema,
        catalog=effective_catalog,
        schema=effective_schema,
        table_names=normalized_table_names,
        warehouse_id=effective_warehouse_id,
      )
    else:
      logger.info(
        'Inspecting table schema through configured cluster fallback: cluster_id=%s',
        default_cluster_id,
      )
      result = await _to_thread_with_context(
        _get_table_stats_with_cluster_fallback,
        catalog=effective_catalog,
        schema=effective_schema,
        table_names=normalized_table_names,
        include_row_counts=False,
        cluster_id=default_cluster_id,
        timeout=timeout,
      )

    if run_state:
      run_state.mark_schema_inspected(
        catalog=effective_catalog,
        schema=effective_schema,
        table_names=normalized_table_names,
      )
    return json.dumps(_jsonable(result), default=str)

  async def _invoke_get_table_stats(
    catalog: str | None = None,
    schema: str | None = None,
    table_name: str | None = None,
    columns: list[str] | str | None = None,
    warehouse_id: str | None = None,
    timeout: int = 180,
  ) -> str:
    """Get selected-column table stats on the configured warehouse or cluster fallback."""
    gate_error = _gate_databricks_tool('get_table_stats')
    if gate_error:
      return gate_error

    effective_catalog = catalog or default_catalog
    effective_schema = schema or default_schema
    if not effective_catalog or not effective_schema:
      return json.dumps({
        'error': (
          'catalog and schema are required. Provide them explicitly or configure '
          'default catalog/schema in project settings.'
        )
      })

    normalized_table_name = _optional_str(table_name)
    normalized_columns = _coerce_columns(columns)
    if not normalized_table_name:
      return json.dumps({'error': 'table_name is required.'})
    normalized_table_name = _table_name_from_configured_context(
      effective_catalog,
      effective_schema,
      normalized_table_name,
    )
    if not normalized_columns:
      return json.dumps({
        'error': (
          'columns is required. Call get_table_schema first, then request stats '
          'only for the specific columns needed.'
        )
      })

    effective_warehouse_id = warehouse_id or default_warehouse_id
    if effective_warehouse_id or not default_cluster_id:
      from databricks_tools_core.sql.table_stats import get_table_stats as _get_table_stats

      result = await _to_thread_with_context(
        _get_table_stats,
        catalog=effective_catalog,
        schema=effective_schema,
        table_name=normalized_table_name,
        columns=normalized_columns,
        warehouse_id=effective_warehouse_id,
      )
    else:
      logger.info(
        'Profiling selected table columns through configured cluster fallback: cluster_id=%s',
        default_cluster_id,
      )
      result = await _to_thread_with_context(
        _get_selected_table_stats_with_cluster_fallback,
        catalog=effective_catalog,
        schema=effective_schema,
        table_name=normalized_table_name,
        columns=normalized_columns,
        cluster_id=default_cluster_id,
        timeout=timeout,
      )

    if run_state:
      run_state.mark_schema_inspected(
        catalog=effective_catalog,
        schema=effective_schema,
        table_names=[normalized_table_name],
      )
    return json.dumps(_jsonable(result), default=str)

  async def _get_table_schema_on_invoke(_ctx, raw_args: str) -> str:
    args = _coerce_args(raw_args)
    return await _invoke_get_table_schema(
      catalog=_optional_str(args.get('catalog')),
      schema=_optional_str(
        args.get('schema') or args.get('schema_name') or args.get('database_schema')
      ),
      table_names=args.get('table_names'),
      warehouse_id=_optional_str(args.get('warehouse_id')),
      timeout=_optional_int(args.get('timeout'), default=180),
    )

  async def _get_table_stats_on_invoke(_ctx, raw_args: str) -> str:
    args = _coerce_args(raw_args)
    return await _invoke_get_table_stats(
      catalog=_optional_str(args.get('catalog')),
      schema=_optional_str(
        args.get('schema') or args.get('schema_name') or args.get('database_schema')
      ),
      table_name=_optional_str(args.get('table_name') or args.get('table')),
      columns=args.get('columns'),
      warehouse_id=_optional_str(args.get('warehouse_id')),
      timeout=_optional_int(args.get('timeout'), default=180),
    )

  get_table_schema_tool = FunctionTool(
    name='get_table_schema',
    description=(
      'Get Databricks table schemas only. Use for column discovery before SQL; '
      'does not compute row counts or column statistics.'
    ),
    params_json_schema=_TABLE_SCHEMA_PARAMS_JSON_SCHEMA,
    on_invoke_tool=_get_table_schema_on_invoke,
    strict_json_schema=False,
  )

  get_table_stats_tool = FunctionTool(
    name='get_table_stats',
    description=(
      'Get selected-column Databricks table statistics. Requires columns; use '
      'get_table_schema first and profile only columns needed for the analysis.'
    ),
    params_json_schema=_TABLE_STATS_PARAMS_JSON_SCHEMA,
    on_invoke_tool=_get_table_stats_on_invoke,
    strict_json_schema=False,
  )

  @function_tool(strict_mode=False)
  async def list_sql_warehouses(limit: int = 20) -> str:
    """List SQL warehouses visible to the current Databricks identity."""
    from databricks_tools_core.sql.warehouse import list_warehouses

    gate_error = _gate_databricks_tool('list_sql_warehouses')
    if gate_error:
      return gate_error

    warehouses = await _to_thread_with_context(list_warehouses, limit=limit)
    return json.dumps(_jsonable(warehouses), default=str)

  @function_tool(strict_mode=False)
  async def get_best_sql_warehouse() -> str:
    """Return the preferred SQL warehouse ID for the current workspace."""
    from databricks_tools_core.sql.warehouse import get_best_warehouse

    gate_error = _gate_databricks_tool('get_best_sql_warehouse')
    if gate_error:
      return gate_error

    warehouse_id = await _to_thread_with_context(get_best_warehouse)
    return json.dumps({'warehouse_id': warehouse_id}, default=str)

  @function_tool(strict_mode=False)
  async def list_compute(resource: str = 'clusters') -> str:
    """List compute resources: clusters, node_types, or spark_versions."""
    from databricks_tools_core.auth import get_workspace_client

    gate_error = _gate_databricks_tool('list_compute')
    if gate_error:
      return gate_error

    def _list() -> dict:
      client = get_workspace_client()
      normalized = (resource or 'clusters').strip().lower()
      if normalized == 'clusters':
        return {'clusters': [c.as_dict() for c in client.clusters.list()]}
      if normalized == 'node_types':
        return {'node_types': [n.as_dict() for n in client.clusters.list_node_types().node_types]}
      if normalized == 'spark_versions':
        return {'spark_versions': [v.as_dict() for v in client.clusters.spark_versions().versions]}
      return {'error': f'Unknown resource: {resource!r}'}

    result = await _to_thread_with_context(_list)
    return json.dumps(_jsonable(result), default=str)

  typed = [
    execute_sql,
    execute_sql_multi,
    get_table_schema_tool,
    get_table_stats_tool,
    list_sql_warehouses,
    get_best_sql_warehouse,
    list_compute,
  ]
  generated = _load_fastmcp_tools(
    skip_names=_TYPED_WRAPPER_NAMES,
    run_state=run_state,
  )
  if read_only:
    generated = [
      tool for tool in generated
      if _is_read_only_tool_name(getattr(tool, 'name', ''))
    ]
  return typed + generated


def _is_read_only_tool_name(name: str) -> bool:
  """Return true when a generated Databricks tool is safe for user preview."""
  exact = {
    'ask_genie',
    'execute_sql',
    'execute_sql_multi',
    'get_table_schema',
    'get_table_stats',
    'get_volume_folder_details',
    'list_compute',
    'list_tracked_resources',
    'list_sql_warehouses',
    'get_best_sql_warehouse',
    'query_vs_index',
  }
  prefixes = (
    'get_',
    'list_',
    'query_',
    'describe_',
    'scan_',
  )
  blocked_prefixes = (
    'create',
    'update',
    'delete',
    'drop',
    'grant',
    'revoke',
    'manage',
    'start',
    'stop',
    'upload',
    'download',
    'execute_code',
  )
  lowered = name.lower()
  if lowered in exact:
    return True
  if lowered.startswith(blocked_prefixes):
    return False
  return lowered.startswith(prefixes)


def _coerce_table_names(value: list[str] | str | None) -> list[str] | None:
  """Accept table_names as a real list or a JSON-encoded list string."""
  if value is None:
    return None
  if isinstance(value, list):
    return [str(item) for item in value if item]
  stripped = value.strip()
  if not stripped:
    return None
  if stripped.startswith('['):
    try:
      parsed = json.loads(stripped)
    except json.JSONDecodeError:
      parsed = None
    if isinstance(parsed, list):
      return [str(item) for item in parsed if item]
  return [stripped]


def _coerce_columns(value: list[str] | str | None) -> list[str]:
  """Accept columns as a real list, JSON list string, or comma/newline string."""
  if value is None:
    return []
  raw_items: list[Any]
  if isinstance(value, list):
    raw_items = value
  else:
    stripped = str(value).strip()
    if not stripped:
      return []
    parsed: Any = None
    if stripped.startswith('['):
      try:
        parsed = json.loads(stripped)
      except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
      raw_items = parsed
    else:
      raw_items = re.split(r'[\n,]+', stripped)

  seen: set[str] = set()
  columns: list[str] = []
  for item in raw_items:
    column = str(item).strip().strip('`')
    if not column:
      continue
    key = column.lower()
    if key in seen:
      continue
    seen.add(key)
    columns.append(column)
  return columns


def _quote_sql_identifier(value: str) -> str:
  return f'`{value.replace("`", "``")}`'


def _qualified_sql_table(catalog: str, schema: str, table: str) -> str:
  return '.'.join(_quote_sql_identifier(part) for part in (catalog, schema, table))


def _table_name_from_configured_context(catalog: str, schema: str, table_name: str) -> str:
  parts = [part.strip('`') for part in table_name.split('.') if part.strip()]
  if len(parts) >= 3:
    return parts[-1]
  if len(parts) == 2 and parts[0] == schema:
    return parts[1]
  if len(parts) == 2 and parts[0] != schema:
    return parts[1]
  return parts[0] if parts else table_name


def _resolve_table_names(
  client,
  catalog: str,
  schema: str,
  table_names: list[str] | None,
) -> list[str]:
  requested = [name for name in (table_names or []) if name]
  needs_listing = not requested or any(any(ch in name for ch in '*?[]') for name in requested)

  if needs_listing:
    listed = [
      getattr(table, 'name', None)
      for table in client.tables.list(catalog_name=catalog, schema_name=schema)
    ]
    listed = sorted(name for name in listed if name)
    if not requested:
      return listed
    resolved: list[str] = []
    for pattern in requested:
      bare_pattern = _table_name_from_configured_context(catalog, schema, pattern)
      resolved.extend(name for name in listed if fnmatch.fnmatchcase(name, bare_pattern))
    return sorted(set(resolved))

  return [
    _table_name_from_configured_context(catalog, schema, table_name)
    for table_name in requested
  ]


def _column_type_text(column: Any) -> str:
  for attr in ('type_text', 'type_name', 'type_json'):
    value = getattr(column, attr, None)
    if value:
      return str(value)
  return 'unknown'


def _extract_single_count(output: str | None) -> int | None:
  if not output:
    return None
  matches = [int(match) for match in re.findall(r'\b\d+\b', str(output))]
  return matches[-1] if matches else None


def _sql_literal(value: str) -> str:
  return "'" + value.replace("'", "''") + "'"


def _get_table_stats_with_cluster_fallback(
  *,
  catalog: str,
  schema: str,
  table_names: list[str] | None,
  include_row_counts: bool,
  cluster_id: str,
  timeout: int,
) -> dict[str, Any]:
  """Collect table schema via UC metadata and row counts via cluster SQL."""
  from databricks_tools_core.auth import get_workspace_client
  from databricks_tools_core.compute import execute_databricks_command

  client = get_workspace_client()
  resolved_names = _resolve_table_names(client, catalog, schema, table_names)
  tables: list[dict[str, Any]] = []

  for table_name in resolved_names:
    full_name = f'{catalog}.{schema}.{table_name}'
    table_payload: dict[str, Any] = {'name': table_name}
    try:
      table = client.tables.get(full_name=full_name)
      comment = getattr(table, 'comment', None)
      if comment:
        table_payload['comment'] = comment
      columns = getattr(table, 'columns', None) or []
      column_details = {}
      for column in columns:
        name = getattr(column, 'name', None)
        if not name:
          continue
        column_details[name] = {
          'name': name,
          'data_type': _column_type_text(column),
        }
      if column_details:
        table_payload['column_details'] = column_details
    except Exception as exc:
      table_payload['error'] = f'Failed to fetch table metadata: {exc}'

    if include_row_counts:
      count_sql = (
        'SELECT COUNT(*) AS total_rows '
        f'FROM {_qualified_sql_table(catalog, schema, table_name)}'
      )
      count_result = execute_databricks_command(
        code=count_sql,
        cluster_id=cluster_id,
        language='sql',
        timeout=timeout,
        destroy_context_on_completion=True,
      )
      if getattr(count_result, 'success', False):
        row_count = _extract_single_count(getattr(count_result, 'output', None))
        if row_count is not None:
          table_payload['total_rows'] = row_count
        else:
          table_payload['row_count_output'] = getattr(count_result, 'output', None)
      else:
        table_payload['row_count_error'] = getattr(count_result, 'error', 'Failed to count rows.')

    tables.append(table_payload)

  return {
    'catalog': catalog,
    'schema_name': schema,
    'tables': tables,
    'table_count': len(tables),
    'compute': 'cluster',
    'cluster_id': cluster_id,
    'stats_note': (
      'Schema was read from Unity Catalog metadata. Row counts, when requested, '
      'were executed on the configured cluster because no SQL warehouse is configured.'
    ),
  }


def _build_column_stats_sql(catalog: str, schema: str, table_name: str, columns: dict[str, str]) -> str:
  table_ref = _qualified_sql_table(catalog, schema, table_name)
  statements: list[str] = []
  for column_name, data_type in columns.items():
    escaped_col = _quote_sql_identifier(column_name)
    lowered_type = data_type.lower()
    is_complex = any(t in lowered_type for t in ('array', 'struct', 'map', 'variant'))
    is_numeric = any(t in lowered_type for t in ('int', 'bigint', 'float', 'double', 'decimal', 'numeric'))
    is_temporal = 'date' in lowered_type or 'timestamp' in lowered_type
    if is_complex:
      min_expr = 'NULL'
      max_expr = 'NULL'
      avg_expr = 'NULL'
      unique_expr = 'NULL'
    elif is_numeric:
      min_expr = f'CAST(MIN({escaped_col}) AS STRING)'
      max_expr = f'CAST(MAX({escaped_col}) AS STRING)'
      avg_expr = f'CAST(AVG({escaped_col}) AS DOUBLE)'
      unique_expr = f'approx_count_distinct({escaped_col})'
    elif is_temporal:
      min_expr = f'CAST(MIN({escaped_col}) AS STRING)'
      max_expr = f'CAST(MAX({escaped_col}) AS STRING)'
      avg_expr = 'NULL'
      unique_expr = f'approx_count_distinct({escaped_col})'
    else:
      min_expr = 'NULL'
      max_expr = 'NULL'
      avg_expr = 'NULL'
      unique_expr = f'approx_count_distinct({escaped_col})'

    statements.append(f"""
      SELECT
        {_sql_literal(column_name)} AS column_name,
        {_sql_literal(data_type)} AS data_type,
        COUNT(*) AS total_count,
        SUM(CASE WHEN {escaped_col} IS NULL THEN 1 ELSE 0 END) AS null_count,
        {unique_expr} AS unique_count,
        {min_expr} AS min_val,
        {max_expr} AS max_val,
        {avg_expr} AS avg_val
      FROM {table_ref}
    """)
  return '\nUNION ALL\n'.join(statements)


def _get_selected_table_stats_with_cluster_fallback(
  *,
  catalog: str,
  schema: str,
  table_name: str,
  columns: list[str],
  cluster_id: str,
  timeout: int,
) -> dict[str, Any]:
  """Collect selected column stats on a configured cluster."""
  from databricks_tools_core.auth import get_workspace_client
  from databricks_tools_core.compute import execute_databricks_command

  client = get_workspace_client()
  resolved_table_name = _table_name_from_configured_context(catalog, schema, table_name)
  full_name = f'{catalog}.{schema}.{resolved_table_name}'
  table_payload: dict[str, Any] = {'name': full_name}

  try:
    table = client.tables.get(full_name=full_name)
    comment = getattr(table, 'comment', None)
    if comment:
      table_payload['comment'] = comment
    table_columns = getattr(table, 'columns', None) or []
  except Exception as exc:
    return {
      'catalog': catalog,
      'schema_name': schema,
      'tables': [{'name': full_name, 'error': f'Failed to fetch table metadata: {exc}'}],
      'table_count': 1,
      'compute': 'cluster',
      'cluster_id': cluster_id,
    }

  requested = {column.lower(): column for column in columns}
  selected_columns: dict[str, str] = {}
  for column in table_columns:
    name = getattr(column, 'name', None)
    if not name or name.lower() not in requested:
      continue
    selected_columns[name] = _column_type_text(column)

  missing = sorted(set(requested) - {name.lower() for name in selected_columns})
  if missing:
    table_payload['missing_columns'] = [requested[name] for name in missing]
  if not selected_columns:
    table_payload['error'] = 'None of the requested columns exist on this table.'
    return {
      'catalog': catalog,
      'schema_name': schema,
      'tables': [table_payload],
      'table_count': 1,
      'compute': 'cluster',
      'cluster_id': cluster_id,
    }

  stats_sql = _build_column_stats_sql(catalog, schema, resolved_table_name, selected_columns)
  python_code = f"""
import json

stats_sql = {json.dumps(stats_sql)}
rows = [json.loads(row) for row in spark.sql(stats_sql).toJSON().collect()]
print(json.dumps({{"rows": rows}}, default=str))
"""
  result = execute_databricks_command(
    code=python_code,
    cluster_id=cluster_id,
    language='python',
    timeout=timeout,
    destroy_context_on_completion=True,
  )
  if not getattr(result, 'success', False):
    table_payload['error'] = getattr(result, 'error', 'Failed to collect selected column stats.')
    return {
      'catalog': catalog,
      'schema_name': schema,
      'tables': [table_payload],
      'table_count': 1,
      'compute': 'cluster',
      'cluster_id': cluster_id,
    }

  try:
    payload = json.loads(getattr(result, 'output', '') or '{}')
    rows = payload.get('rows') or []
  except json.JSONDecodeError:
    table_payload['raw_output'] = getattr(result, 'output', None)
    rows = []

  column_details: dict[str, dict[str, Any]] = {}
  total_rows = None
  for row in rows:
    column_name = row.get('column_name')
    if not column_name:
      continue
    total_rows = row.get('total_count') if total_rows is None else total_rows
    detail = {
      'name': column_name,
      'data_type': row.get('data_type') or selected_columns.get(column_name) or 'unknown',
      'total_count': row.get('total_count'),
      'null_count': row.get('null_count'),
      'unique_count': row.get('unique_count'),
    }
    if row.get('min_val') is not None:
      detail['min'] = row.get('min_val')
    if row.get('max_val') is not None:
      detail['max'] = row.get('max_val')
    if row.get('avg_val') is not None:
      detail['avg'] = row.get('avg_val')
    column_details[column_name] = detail

  table_payload['column_details'] = column_details
  if total_rows is not None:
    table_payload['total_rows'] = total_rows

  return {
    'catalog': catalog,
    'schema_name': schema,
    'tables': [table_payload],
    'table_count': 1,
    'compute': 'cluster',
    'cluster_id': cluster_id,
    'stats_note': 'Stats were computed only for explicitly requested columns.',
  }


# ---------------------------------------------------------------------------
# FastMCP-generated tools
# ---------------------------------------------------------------------------

# Cached so we only walk the FastMCP registry once per process.
_cached_fastmcp_registry: dict[str, Any] | None = None


def _load_fastmcp_tools(
  *,
  skip_names: frozenset[str] = frozenset(),
  run_state: AgentToolRunState | None = None,
) -> list:
  """Walk the FastMCP tool registry and emit OpenAI ``FunctionTool`` objects.

  Returns an empty list (with a logged warning) if the registry can't be
  imported or enumerated; the typed wrappers above remain functional.
  """
  global _cached_fastmcp_registry
  if _cached_fastmcp_registry is None:
    try:
      _cached_fastmcp_registry = _enumerate_fastmcp_registry()
    except Exception:
      logger.exception('Failed to load FastMCP-derived Databricks tools')
      _cached_fastmcp_registry = {}
  return _build_fastmcp_tools(_cached_fastmcp_registry, skip_names, run_state)


def _build_fastmcp_tools(
  registered: dict[str, Any],
  skip_names: frozenset[str],
  run_state: AgentToolRunState | None,
) -> list:
  from agents import FunctionTool

  tools: list = []
  for name in sorted(registered):
    if name in skip_names:
      continue
    mcp_tool = registered[name]
    description = (getattr(mcp_tool, 'description', '') or '').strip()
    raw_schema = getattr(mcp_tool, 'parameters', None) or getattr(
      mcp_tool, 'inputSchema', None
    ) or {}
    schema = _normalize_schema(raw_schema)
    fn = getattr(mcp_tool, 'fn', None) or getattr(mcp_tool, 'function', None)
    if fn is None:
      logger.warning('FastMCP tool %s has no callable fn; skipping', name)
      continue
    tools.append(
      FunctionTool(
        name=name,
        description=description or f'Databricks {name} tool.',
        params_json_schema=schema,
        on_invoke_tool=_make_on_invoke(name, fn, run_state=run_state),
        strict_json_schema=False,
      )
    )
  logger.info('Loaded %s FastMCP-derived Databricks tools', len(tools))
  return tools


def _enumerate_fastmcp_registry() -> dict[str, Any]:
  """Import the FastMCP server and return its registered tool map."""
  # Importing these registers the @mcp.tool decorators on the singleton.
  import databricks_mcp_server.tools.agent_bricks  # noqa: F401
  import databricks_mcp_server.tools.aibi_dashboards  # noqa: F401
  import databricks_mcp_server.tools.apps  # noqa: F401
  import databricks_mcp_server.tools.compute  # noqa: F401
  import databricks_mcp_server.tools.file  # noqa: F401
  import databricks_mcp_server.tools.genie  # noqa: F401
  import databricks_mcp_server.tools.jobs  # noqa: F401
  import databricks_mcp_server.tools.lakebase  # noqa: F401
  import databricks_mcp_server.tools.manifest  # noqa: F401
  import databricks_mcp_server.tools.pdf  # noqa: F401
  import databricks_mcp_server.tools.pipelines  # noqa: F401
  import databricks_mcp_server.tools.serving  # noqa: F401
  import databricks_mcp_server.tools.sql  # noqa: F401
  import databricks_mcp_server.tools.unity_catalog  # noqa: F401
  import databricks_mcp_server.tools.user  # noqa: F401
  import databricks_mcp_server.tools.vector_search  # noqa: F401
  import databricks_mcp_server.tools.volume_files  # noqa: F401
  import databricks_mcp_server.tools.workspace  # noqa: F401
  from databricks_mcp_server import tools as _tools_pkg  # noqa: F401
  from databricks_mcp_server.server import mcp  # noqa: F401

  manager = getattr(mcp, '_tool_manager', None)
  registry = getattr(manager, '_tools', None) if manager else None
  if isinstance(registry, dict) and registry:
    return dict(registry)

  # Fallback: async list_tools() (deployed FastMCP versions).
  if hasattr(mcp, 'list_tools'):
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
      tools_list = executor.submit(lambda: asyncio.run(mcp.list_tools())).result()
    return {t.name: t for t in tools_list}

  return {}


def _normalize_schema(json_schema: Any) -> dict[str, Any]:
  """Return a JSON Schema suitable for ``FunctionTool.params_json_schema``.

  We deep-copy via JSON so later mutations cannot affect FastMCP's cached
  schema objects, and ensure the top-level shape is an object schema.
  """
  if not isinstance(json_schema, dict):
    return {'type': 'object', 'properties': {}}
  cloned = json.loads(json.dumps(json_schema))
  if cloned.get('type') != 'object':
    cloned = {'type': 'object', 'properties': cloned.get('properties') or {}}
  cloned.setdefault('properties', {})
  return cloned


def _coerce_args(raw_args: Any) -> dict[str, Any]:
  """Parse the JSON args string the SDK passes to ``on_invoke_tool``.

  Mirrors the Claude-SDK wrapper: list/dict-shaped strings are parsed as JSON
  so callers can pass nested values either inline or as encoded strings.
  """
  if isinstance(raw_args, dict):
    args = raw_args
  elif isinstance(raw_args, str) and raw_args.strip():
    try:
      args = json.loads(raw_args)
    except json.JSONDecodeError:
      args = {}
  else:
    args = {}
  if not isinstance(args, dict):
    return {}

  parsed: dict[str, Any] = {}
  for key, value in args.items():
    if isinstance(value, str):
      stripped = value.strip()
      if stripped.startswith(('[', '{')):
        try:
          parsed[key] = json.loads(stripped)
          continue
        except json.JSONDecodeError:
          pass
    parsed[key] = value
  return parsed


def _make_on_invoke(
  name: str,
  fn,
  *,
  run_state: AgentToolRunState | None = None,
):
  """Build the ``on_invoke_tool`` callback for a FastMCP tool.

  The callback runs the FastMCP function (sync or coroutine) inside a copied
  context so ``set_databricks_auth`` contextvars propagate. If sync execution
  exceeds ``SAFE_EXECUTION_THRESHOLD`` seconds, it hands off to a background
  thread and returns an operation ID for ``check_operation_status`` polling.
  """

  async def on_invoke_tool(_ctx, raw_args):
    parsed_args = _coerce_args(raw_args)
    if run_state:
      gate_error = run_state.databricks_gate_error(name)
      if gate_error:
        return json.dumps(gate_error)
      if name == 'execute_code' and str(parsed_args.get('language') or '').lower() == 'sql':
        schema_error = run_state.sql_schema_gate_error(str(parsed_args.get('code') or ''))
        if schema_error:
          return json.dumps(schema_error)

    started = time.time()
    args_preview = json.dumps(parsed_args, default=str)[:1000]
    logger.debug('[MCP] %s called args=%s', name, args_preview)

    try:
      if inspect.iscoroutinefunction(fn):
        # Async FastMCP tool: run inline in this loop.
        result = await fn(**parsed_args)
      else:
        # Sync FastMCP tool: run in a worker thread with copied context so
        # we can keep watching the clock and hand off to the background if
        # it overruns SAFE_EXECUTION_THRESHOLD.
        result = await _run_sync_with_handoff(name, fn, parsed_args)

      if inspect.isawaitable(result):
        result = await result
      elapsed = time.time() - started
      payload = json.dumps(_jsonable(result), default=str)
      logger.info(
        '[MCP] %s completed in %.2fs (result_len=%s)', name, elapsed, len(payload)
      )
      return payload
    except asyncio.CancelledError:
      raise
    except Exception as e:
      elapsed = time.time() - started
      logger.exception('[MCP] %s failed after %.2fs: %s', name, elapsed, e)
      return json.dumps(
        {'error': f'{type(e).__name__}: {e}', 'tool': name, 'elapsed_seconds': elapsed}
      )

  on_invoke_tool.__name__ = f'{name}_on_invoke'
  return on_invoke_tool


async def _run_sync_with_handoff(name: str, fn, parsed_args: dict[str, Any]):
  """Run a sync FastMCP tool with optional async handoff after the threshold."""
  import concurrent.futures

  ctx = copy_context()
  loop = asyncio.get_event_loop()
  executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
  cf_future = executor.submit(lambda: ctx.run(fn, **parsed_args))
  af_future = asyncio.wrap_future(cf_future, loop=loop)
  started = time.time()

  try:
    while True:
      try:
        return await asyncio.wait_for(asyncio.shield(af_future), timeout=1.0)
      except asyncio.TimeoutError:
        elapsed = time.time() - started
        if elapsed < SAFE_EXECUTION_THRESHOLD:
          continue
        op_id = create_operation(name, parsed_args)
        logger.info(
          '[MCP] %s exceeded %ss; handed off as operation %s',
          name,
          SAFE_EXECUTION_THRESHOLD,
          op_id,
        )
        threading.Thread(
          target=_complete_in_background,
          args=(op_id, cf_future, executor),
          daemon=True,
        ).start()
        executor = None  # ownership transferred to the background thread
        return {
          'status': 'async',
          'operation_id': op_id,
          'tool_name': name,
          'message': (
            f'Operation is taking longer than {SAFE_EXECUTION_THRESHOLD}s and was '
            f'moved to background execution. Use check_operation_status("{op_id}") '
            f'to poll for the result.'
          ),
          'elapsed_seconds': round(elapsed, 1),
        }
  finally:
    if executor is not None:
      executor.shutdown(wait=False)


def _complete_in_background(op_id: str, cf_future, executor) -> None:
  try:
    result = cf_future.result()
    if inspect.isawaitable(result):
      result = asyncio.run(result)
    complete_operation(op_id, result=_jsonable(result))
  except Exception as e:
    logger.exception('Background operation %s failed: %s', op_id, e)
    complete_operation(op_id, error=f'{type(e).__name__}: {e}')
  finally:
    try:
      executor.shutdown(wait=False)
    except Exception:
      pass
