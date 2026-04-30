# `sql/` — SQL execution and warehouse selection

Source: [`databricks_tools_core/sql/`](../../databricks-tools-core/databricks_tools_core/sql/)

Wraps the SQL Warehouse Statement Execution API for query execution and adds opinionated helpers on top of it: best-warehouse selection, dependency-aware multi-statement execution, and table/volume statistics gathering.

## Public API

### Execution

| Function | Returns | Notes |
|----------|---------|-------|
| `execute_sql(sql_query, warehouse_id=None, catalog=None, schema=None, timeout=180, query_tags=None)` | `List[Dict[str, Any]]` | Single statement. Auto-selects a warehouse via `get_best_warehouse()` if `warehouse_id` is omitted. `query_tags` use `"k:v,k2:v2"` format and surface in `system.query.history`. |
| `execute_sql_multi(sql_content, warehouse_id=None, catalog=None, schema=None, timeout=180, max_workers=4, query_tags=None)` | `Dict[str, Any]` | Parses multi-statement SQL, builds a dependency DAG (table-create vs. table-reference), and runs independent statements in parallel up to `max_workers`. Returns per-query status, group assignment, sample rows, and an aggregate summary. Stops execution at the first failed group. |

### Warehouse selection

| Function | Returns | Notes |
|----------|---------|-------|
| `list_warehouses(limit=20)` | `List[Dict[str, Any]]` | Paginated list of warehouses with state and accessibility flags. |
| `get_best_warehouse()` | `Optional[str]` | Picks a warehouse using a tier order: running serverless → running classic → user-owned stopped → others. Returns `None` if there are no usable warehouses. |

### Table & volume statistics

| Function | Returns | Notes |
|----------|---------|-------|
| `get_table_stats_and_schema(table_name, level=TableStatLevel.SCHEMA, warehouse_id=None)` | `TableSchemaResult` | Pulls schema, partitioning, row counts, sample rows. Stat depth controlled by `TableStatLevel`. Accepts glob patterns for batch summaries. |
| `get_volume_folder_details(volume_path, recursive=False, warehouse_id=None)` | `VolumeFolderResult` | Lists files under a UC Volume path with sizes / counts. |

### Errors and types

- `SQLExecutionError` — raised when execution fails or no warehouse is available; messages are written for AI ergonomics (the model sees them and recovers).
- `TableStatLevel` — enum: `BASIC`, `SCHEMA`, `STATS`, `FULL`.
- `TableSchemaResult`, `DataSourceInfo` (alias `TableInfo`), `ColumnDetail`, `VolumeFileInfo`, `VolumeFolderResult` — small dataclasses returned by the stat functions.

## Behavioural notes

- **Warehouse auto-selection.** `execute_sql(...)` without `warehouse_id` calls `get_best_warehouse()` once per call. There is no caching; a long script that calls `execute_sql` many times should pass an explicit `warehouse_id`.
- **Catalog/schema context.** When `catalog`/`schema` are provided they are set on the statement; otherwise statements must use fully qualified names.
- **Tagging.** `query_tags` flow through to the SQL execution API and are visible in Query History; use them whenever cost attribution matters.
- **Multi-statement parsing** is done with `sqlglot`; if it cannot parse the input you get a `SQLExecutionError` before any execution.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/sql.py`](../../databricks-mcp-server/databricks_mcp_server/tools/sql.py)
- Skill: [`databricks-skills/databricks-dbsql/SKILL.md`](../../databricks-skills/databricks-dbsql/SKILL.md)
