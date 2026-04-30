# `lakebase/` — Lakebase Provisioned

Source: [`databricks_tools_core/lakebase/`](../../databricks-tools-core/databricks_tools_core/lakebase/)

Lakebase Provisioned (managed Postgres) — the *legacy/v1* Lakebase shape. For the autoscaling product see [`lakebase-autoscale.md`](lakebase-autoscale.md).

Three files:

- `instances.py` — instance lifecycle + DB credential generation.
- `catalogs.py` — Unity Catalog registration of a Lakebase instance.
- `synced_tables.py` — Reverse-ETL synced tables (UC table → Lakebase).

## Public API

### Instances

| Function | Notes |
|----------|-------|
| `create_lakebase_instance(name, capacity=..., parent_instance=None, ...)` | |
| `get_lakebase_instance(name)` | |
| `list_lakebase_instances()` | |
| `update_lakebase_instance(name, ...)` | |
| `delete_lakebase_instance(name)` | |
| `generate_lakebase_credential(name, ...)` | Returns short-lived DB credentials usable from Postgres clients. |

### UC catalog registration

| Function | Notes |
|----------|-------|
| `create_lakebase_catalog(catalog_name, instance_name, database_name, ...)` | Registers a Lakebase database as a UC catalog. |
| `get_lakebase_catalog(name)` | |
| `delete_lakebase_catalog(name)` | |

### Synced tables (reverse ETL)

| Function | Notes |
|----------|-------|
| `create_synced_table(name, source_table, target_database, primary_key_columns, ...)` | Creates a reverse-ETL pipeline writing a UC table into Lakebase. |
| `get_synced_table(name)` | |
| `delete_synced_table(name)` | |

## Conventions

- **Two Lakebase shapes coexist.** This module is the v1 Provisioned API; `lakebase_autoscale/` is the autoscaling API. Do not cross-import or mix instance IDs.
- **Credentials are short-lived.** Re-call `generate_lakebase_credential` rather than caching the password long-term.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/lakebase.py`](../../databricks-mcp-server/databricks_mcp_server/tools/lakebase.py)
- Skill: [`databricks-skills/databricks-lakebase-provisioned/SKILL.md`](../../databricks-skills/databricks-lakebase-provisioned/SKILL.md)
