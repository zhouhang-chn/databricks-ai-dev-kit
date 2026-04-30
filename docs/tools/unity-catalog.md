# `unity_catalog/` — Unity Catalog

Source: [`databricks_tools_core/unity_catalog/`](../../databricks-tools-core/databricks_tools_core/unity_catalog/)

The largest module. Each Unity Catalog domain is split into its own file; the package `__init__.py` re-exports the public surface. Most operations go through the SDK; a handful that the SDK does not expose directly (tags, security policies, foreign-catalog DDL, metric-view DDL) are issued as SQL via a SQL warehouse.

## Files

| File | Domain |
|------|--------|
| `catalogs.py` | Catalog CRUD |
| `schemas.py` | Schema CRUD |
| `tables.py` | Table CRUD (managed/external) |
| `volumes.py` | UC Volume CRUD |
| `volume_files.py` | File ops inside Volumes (list, upload, download, delete, mkdir, metadata) |
| `functions_uc.py` | UC SQL/Python functions |
| `grants.py` | `GRANT` / `REVOKE` and effective-privilege queries |
| `tags.py` | Object/column tags + comments via SQL |
| `monitors.py` | Lakehouse Monitoring lifecycle |
| `security_policies.py` | Row filters and column masks via SQL |
| `connections.py` | Foreign connections + `CREATE FOREIGN CATALOG` |
| `storage.py` | Storage credentials and external locations |
| `sharing.py` | Delta Sharing (shares, recipients, grants) |
| `metric_views.py` | UC metric views — YAML build, DDL, query |

## Highlights

### Catalogs / Schemas / Tables / Volumes

CRUD via the SDK. Names follow the natural hierarchy (`catalog.schema.table`, `catalog.schema.volume`):

```python
from databricks_tools_core.unity_catalog import (
    create_catalog, create_schema, create_volume, list_tables,
)

create_catalog("my_catalog", comment="...")
create_schema("my_catalog", "raw")
create_volume("my_catalog", "raw", "landing", volume_type="MANAGED")
list_tables("my_catalog", "raw")
```

`delete_catalog(name, force=False)` mirrors the SDK `force` flag for non-empty catalogs. Tables are read-only here (no DDL beyond create/delete); use `sql.execute_sql` for `ALTER TABLE` etc.

### Volume files (`volume_files.py`)

| Function | Notes |
|----------|-------|
| `list_volume_files(volume_path, max_results=None)` | |
| `upload_to_volume(local_path, volume_path, ...)` | Glob and folder-aware. Parallel upload up to `max_workers`. |
| `download_from_volume(volume_path, local_path, overwrite=True)` | |
| `delete_from_volume(volume_path, recursive=False, max_workers=4)` | |
| `create_volume_directory(volume_path)` | |
| `get_volume_file_metadata(volume_path)` | |

Returns small dataclasses: `VolumeFileInfo`, `VolumeUploadResult`, `VolumeFolderUploadResult`, `VolumeDownloadResult`, `VolumeDeleteResult`.

### Grants

| Function | Notes |
|----------|-------|
| `grant_privileges(securable_type, full_name, principal, privileges)` | |
| `revoke_privileges(securable_type, full_name, principal, privileges)` | |
| `get_grants(securable_type, full_name, ...)` | Direct grants. |
| `get_effective_grants(securable_type, full_name, ...)` | Inherited + direct. |

`securable_type` accepts both display strings (`"TABLE"`, `"SCHEMA"`) and SDK enum values; the helper normalises them.

### Tags & comments (`tags.py`)

Issued as SQL because the SDK doesn't expose tag DDL. Functions accept tag dicts and call out to a warehouse via `sql.execute_sql`.

| Function | Notes |
|----------|-------|
| `set_tags(object_type, full_name, tags, column=None)` | `column` provided → column-level tagging. |
| `unset_tags(object_type, full_name, keys, column=None)` | |
| `set_comment(object_type, full_name, comment, column=None)` | |
| `query_table_tags(catalog, schema, table=None)` | Reads `system.information_schema.table_tags`. |
| `query_column_tags(catalog, schema, table=None)` | |

### Monitors (`monitors.py`)

Lakehouse Monitoring CRUD plus refresh control:

`create_monitor`, `get_monitor`, `delete_monitor`, `run_monitor_refresh`, `list_monitor_refreshes`.

### Security policies (`security_policies.py`)

| Function | Notes |
|----------|-------|
| `create_security_function(...)` | UDF returning a boolean predicate or masked value. |
| `set_row_filter(table_name, function_name, columns)` / `drop_row_filter(table_name)` | |
| `set_column_mask(table_name, column_name, function_name, using_columns=None)` / `drop_column_mask(table_name, column_name)` | |

All four issue the corresponding `ALTER TABLE` statement.

### Storage credentials & external locations (`storage.py`)

`list_storage_credentials`, `get_storage_credential`, `create_storage_credential`, `update_storage_credential`, `delete_storage_credential`, `validate_storage_credential`, `list_external_locations`, `get_external_location`, `create_external_location`, …

### Connections & foreign catalogs (`connections.py`)

`list_connections`, `get_connection`, `create_connection`, `update_connection`, `delete_connection`, `create_foreign_catalog`. The last is SQL-issued because the SDK creates a "regular" catalog by default.

### Sharing (`sharing.py`)

`list_shares`, `get_share`, `create_share`, `add_table_to_share`, `remove_table_from_share`, `delete_share`, plus recipient and grant management. Returns SDK dicts.

### Metric views (`metric_views.py`)

UC metric views are YAML documents wrapped in DDL. The module builds the YAML for you:

`create_metric_view`, `alter_metric_view`, `drop_metric_view`, `describe_metric_view`, `query_metric_view`, `grant_metric_view`. The internal `_build_yaml_block(...)` is responsible for emitting the metric-view YAML block from Python dicts.

## Conventions

- **Identifiers passed to SQL paths are validated.** `_validate_identifier()` rejects characters that would allow SQL injection. Test with backtick-quoted identifiers when in doubt.
- **SDK-vs-SQL split.** SDK calls return SDK dataclasses converted to dicts; SQL-issued operations return `Dict[str, Any]` shaped to look like the SDK responses.
- **Error model.** SDK errors propagate. Functions that issue SQL raise the underlying `SQLExecutionError` from `sql/`.

## Related

- MCP wrappers: [`databricks_mcp_server/tools/unity_catalog.py`](../../databricks-mcp-server/databricks_mcp_server/tools/unity_catalog.py), [`volume_files.py`](../../databricks-mcp-server/databricks_mcp_server/tools/volume_files.py)
- Skills: [`databricks-unity-catalog`](../../databricks-skills/databricks-unity-catalog/), [`databricks-metric-views`](../../databricks-skills/databricks-metric-views/)
