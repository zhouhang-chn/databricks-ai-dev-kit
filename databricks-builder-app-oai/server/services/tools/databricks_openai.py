"""OpenAI function tools for Databricks.

Two layers feed the agent's tool list:

1. **Typed wrappers** (``execute_sql``, ``list_sql_warehouses``,
   ``get_best_sql_warehouse``, ``list_compute``) keep ergonomic, default-aware
   coverage for the most common operations. They use the project default
   catalog/schema/warehouse and are always available.

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
import inspect
import json
import logging
import threading
import time
from contextvars import copy_context
from typing import Any

from ..operation_tracker import complete_operation, create_operation

logger = logging.getLogger(__name__)

# Threshold (seconds) before a sync FastMCP tool hands off to background
# execution. Mirrors the Claude SDK runtime's safety value so model streams
# stay responsive on long-running Databricks operations.
SAFE_EXECUTION_THRESHOLD = 10

# Names already covered by typed wrappers; the FastMCP loader skips
# duplicates so the agent never sees two tools with the same name.
_TYPED_WRAPPER_NAMES: frozenset[str] = frozenset(
  {'execute_sql', 'list_sql_warehouses', 'get_best_sql_warehouse', 'list_compute'}
)


def _jsonable(value: Any) -> Any:
  try:
    json.dumps(value)
    return value
  except TypeError:
    if hasattr(value, 'as_dict'):
      return value.as_dict()
    if hasattr(value, '__dict__'):
      return value.__dict__
    return str(value)


async def _to_thread_with_context(fn, *args, **kwargs):
  ctx = copy_context()
  return await asyncio.to_thread(lambda: ctx.run(fn, *args, **kwargs))


def create_databricks_tools(
  *,
  default_catalog: str | None = None,
  default_schema: str | None = None,
  default_warehouse_id: str | None = None,
) -> list:
  """Create the full Databricks tool set: typed wrappers + generated FastMCP."""
  from agents import function_tool

  @function_tool
  async def execute_sql(
    sql_query: str,
    warehouse_id: str | None = None,
    catalog: str | None = None,
    database_schema: str | None = None,
    timeout: int = 180,
  ) -> str:
    """Execute SQL on a Databricks SQL warehouse and return result rows as JSON."""
    from databricks_tools_core.sql.sql import execute_sql as _execute_sql

    rows = await _to_thread_with_context(
      _execute_sql,
      sql_query=sql_query,
      warehouse_id=warehouse_id or default_warehouse_id,
      catalog=catalog or default_catalog,
      schema=database_schema or default_schema,
      timeout=timeout,
      query_tags='app:databricks-builder-app-oai',
    )
    return json.dumps(_jsonable(rows), default=str)

  @function_tool
  async def list_sql_warehouses(limit: int = 20) -> str:
    """List SQL warehouses visible to the current Databricks identity."""
    from databricks_tools_core.sql.warehouse import list_warehouses

    warehouses = await _to_thread_with_context(list_warehouses, limit=limit)
    return json.dumps(_jsonable(warehouses), default=str)

  @function_tool
  async def get_best_sql_warehouse() -> str:
    """Return the preferred SQL warehouse ID for the current workspace."""
    from databricks_tools_core.sql.warehouse import get_best_warehouse

    warehouse_id = await _to_thread_with_context(get_best_warehouse)
    return json.dumps({'warehouse_id': warehouse_id}, default=str)

  @function_tool
  async def list_compute(resource: str = 'clusters') -> str:
    """List compute resources: clusters, node_types, or spark_versions."""
    from databricks_tools_core.auth import get_workspace_client

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

  typed = [execute_sql, list_sql_warehouses, get_best_sql_warehouse, list_compute]
  generated = _load_fastmcp_tools(skip_names=_TYPED_WRAPPER_NAMES)
  return typed + generated


# ---------------------------------------------------------------------------
# FastMCP-generated tools
# ---------------------------------------------------------------------------

# Cached so we only walk the FastMCP registry once per process.
_cached_fastmcp_tools: list | None = None


def _load_fastmcp_tools(*, skip_names: frozenset[str] = frozenset()) -> list:
  """Walk the FastMCP tool registry and emit OpenAI ``FunctionTool`` objects.

  Returns an empty list (with a logged warning) if the registry can't be
  imported or enumerated; the typed wrappers above remain functional.
  """
  global _cached_fastmcp_tools
  if _cached_fastmcp_tools is None:
    try:
      _cached_fastmcp_tools = _build_fastmcp_tools()
    except Exception:
      logger.exception('Failed to load FastMCP-derived Databricks tools')
      _cached_fastmcp_tools = []
  return [t for t in _cached_fastmcp_tools if t.name not in skip_names]


def _build_fastmcp_tools() -> list:
  from agents import FunctionTool

  registered = _enumerate_fastmcp_registry()
  tools: list = []
  for name in sorted(registered):
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
        on_invoke_tool=_make_on_invoke(name, fn),
        strict_json_schema=False,
      )
    )
  logger.info('Loaded %s FastMCP-derived Databricks tools', len(tools))
  return tools


def _enumerate_fastmcp_registry() -> dict[str, Any]:
  """Import the FastMCP server and return its registered tool map."""
  # Importing these registers the @mcp.tool decorators on the singleton.
  from databricks_mcp_server import tools as _tools_pkg  # noqa: F401
  from databricks_mcp_server.server import mcp  # noqa: F401
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


def _make_on_invoke(name: str, fn):
  """Build the ``on_invoke_tool`` callback for a FastMCP tool.

  The callback runs the FastMCP function (sync or coroutine) inside a copied
  context so ``set_databricks_auth`` contextvars propagate. If sync execution
  exceeds ``SAFE_EXECUTION_THRESHOLD`` seconds, it hands off to a background
  thread and returns an operation ID for ``check_operation_status`` polling.
  """

  async def on_invoke_tool(_ctx, raw_args):
    parsed_args = _coerce_args(raw_args)
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
