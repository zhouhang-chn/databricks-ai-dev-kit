# Tool reference

Every `@mcp.tool` registered by the server, grouped by source module. For each tool: registered name, what it does, the action set if dispatch-style, and where the actual work happens.

Most tools are dispatch-style (`manage_*(action="...")`) — the action set is summarised here; the docstring on the tool itself is the source of truth for parameter shapes and is what the agent reads at runtime.

For the underlying functions, see the matching pages under [`../tools/`](../tools/).

---

## SQL — `tools/sql.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `execute_sql` | 60s | (no dispatch) | Markdown output by default (`output_format="json"` to override). Auto-selects warehouse if `warehouse_id` omitted. |
| `execute_sql_multi` | 120s | (no dispatch) | Dependency-aware parallel execution. Sample rows in each query result are also markdown-formatted. |
| `manage_warehouse` | 30s | `list`, `get_best` | |
| `get_table_stats_and_schema` | 60s | (no dispatch) | `table_stat_level`: `NONE` / `SIMPLE` / `DETAILED`. |
| `get_volume_folder_details` | 60s | (no dispatch) | UC Volume folder listing with sizes. |

## Compute — `tools/compute.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `execute_code` | (per-mode) | (no dispatch) | `compute_type`: `auto` / `serverless` / `cluster`. Per-mode timeouts: serverless 1800s, cluster 120s, file 600s. Pass `context_id` to reuse cluster state. |
| `manage_cluster` | default | `create`, `modify`, `start`, `terminate`, `delete` | |
| `manage_sql_warehouse` | default | `create`, `modify`, `delete` | |
| `list_compute` | default | `clusters`, `node_types`, `spark_versions` | |

## Jobs — `tools/jobs.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_jobs` | 60s | `create`, `get`, `list`, `find_by_name`, `update`, `delete` | `create` is name-idempotent (returns existing if found). Auto-injects default tags. |
| `manage_job_runs` | 300s | `run_now`, `get`, `get_output`, `cancel`, `list`, `wait`, `repair` | `wait` blocks until terminal state. |

## Spark Declarative Pipelines — `tools/pipelines.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_pipeline` | 300s | `create`, `create_or_update`, `get`, `update`, `delete`, `find_by_name` | `create_or_update` can also kick off and wait on a run. Auto-tags. |
| `manage_pipeline_run` | 300s | `start`, `get`, `stop`, `get_events` | `get_events` defaults to `event_log_level="WARN"` and `max_results=5`. |

## Unity Catalog — `tools/unity_catalog.py`

Eight tools, each scoped to a UC subdomain. All forward to `databricks_tools_core.unity_catalog`.

| Tool | Timeout | Notes |
|------|---------|-------|
| `manage_uc_objects` | 60s | `object_type`: `catalog` / `schema` / `volume` / `function`. Tracks catalog/schema/volume in the manifest; auto-tags on create. |
| `manage_uc_grants` | 60s | `action`: `grant` / `revoke` / `get` / `get_effective`. |
| `manage_uc_storage` | 60s | `resource_type`: `credential` / `external_location`. Includes `validate` action for credentials. |
| `manage_uc_connections` | 60s | Foreign connections + `create_foreign_catalog` (Lakehouse Federation). |
| `manage_uc_tags` | 60s | `set_tags`, `unset_tags`, `set_comment`, `query_table_tags`, `query_column_tags`. SQL-issued (needs a warehouse). |
| `manage_uc_security_policies` | 60s | Row filters, column masks, security functions. |
| `manage_uc_monitors` | 60s | Lakehouse Monitoring CRUD + refresh. |
| `manage_uc_sharing` | 60s | Delta Sharing — shares, recipients, grants. |
| `manage_metric_views` | 60s | UC metric views (build YAML, DDL, query, grant). |

## Volume files — `tools/volume_files.py`

| Tool | Timeout | Actions |
|------|---------|---------|
| `manage_volume_files` | 300s | `list`, `upload`, `download`, `delete`, `mkdir`, `get_info` |

`list` caps at 1000 entries and sets `truncated: true` when more exist. Upload/download support globs and tilde-expansion in `local_path`.

## Workspace files — `tools/file.py`

| Tool | Timeout | Actions |
|------|---------|---------|
| `manage_workspace_files` | 120s | `upload`, `delete` |

For Workspace files (notebooks, scripts), not UC volumes. Notebook-language detection is handled by `databricks_tools_core.file`. Delete refuses protected paths.

## Model serving — `tools/serving.py`

| Tool | Timeout | Actions |
|------|---------|---------|
| `manage_serving_endpoint` | 120s | `get`, `list`, `query` |

`query` accepts exactly one of `messages` (chat), `inputs` (pyfunc), or `dataframe_records` (ML). `max_tokens` / `temperature` for chat endpoints.

## Vector Search — `tools/vector_search.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_vs_endpoint` | 120s | `create_or_update`, `get`, `list`, `delete` | `endpoint_type`: `STANDARD` or `STORAGE_OPTIMIZED`. Tracks in manifest. |
| `manage_vs_index` | 120s | `create_or_update`, `get`, `list`, `delete` | Auto-triggers initial sync for `DELTA_SYNC` indexes. `direct_access_index_spec` for self-managed embeddings. |
| `query_vs_index` | 60s | (no dispatch) | Similarity query. |
| `manage_vs_data` | 120s | `upsert`, `delete`, `scan` | Direct-access indexes only. |

## Lakebase — `tools/lakebase.py`

One tool module spans both Lakebase shapes (provisioned and autoscale). The `type` parameter selects.

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_lakebase_database` | 120s | `create_or_update`, `get`, `list`, `delete` | `type`: `provisioned` (capacity `CU_1/2/4/8`) or `autoscale` (with branches). |
| `manage_lakebase_branch` | 120s | `create_or_update`, `delete` | Autoscale only. Copy-on-write branches with their own compute endpoints. |
| `manage_lakebase_sync` | 120s | `create_or_update`, `delete` | Reverse-ETL: Delta table → Lakebase Postgres table. `scheduling_policy`: `TRIGGERED` / `SNAPSHOT` / `CONTINUOUS`. |
| `generate_lakebase_credential` | 30s | (no dispatch) | OAuth token (~1h) for Postgres clients. Provide `instance_names` (provisioned) **or** `endpoint` (autoscale). |

## AI/BI Dashboards — `tools/aibi_dashboards.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_dashboard` | 120s | `create_or_update`, `get`, `list`, `delete`, `publish`, `unpublish` | Re-stringifies `serialized_dashboard` if the client deserialised it to a dict. Tracks in manifest. The docstring carries strict widget JSON rules — read it before generating dashboard JSON. |

## Agent Bricks — `tools/agent_bricks.py`, `tools/genie.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_ka` | 180s | `create_or_update`, `get`, `find_by_name`, `delete` | Knowledge Assistant. Optionally scans the source UC volume for example JSON files and attaches them. |
| `manage_mas` | 180s | `create_or_update`, `get`, `find_by_name`, `delete` | Multi-Agent Supervisor. `agents` array routes to endpoint / Genie / KA / UC function / connection. |
| `manage_genie` | 60s | `create_or_update`, `get`, `list`, `delete`, `export`, `import` | Genie Spaces. `serialized_space` round-trips full config (instructions, SQL examples) for migration. |
| `ask_genie` | 120s | (no dispatch — hot path) | Sends a NL question to a Genie space. Pass `conversation_id` for follow-ups. |

## Apps — `tools/apps.py`

| Tool | Timeout | Actions |
|------|---------|---------|
| `manage_app` | 180s | `create_or_update`, `get`, `list`, `delete` |

`create_or_update` deploys when `source_code_path` is provided.

## PDF — `tools/pdf.py`

| Tool | Timeout | Notes |
|------|---------|-------|
| `generate_and_upload_pdf` | default | Self-contained HTML + CSS → PDF → UC volume. Returns `{success, volume_path, error}`. |

## User — `tools/user.py`

| Tool | Timeout | Notes |
|------|---------|-------|
| `get_current_user` | 30s | Returns `{username, home_path}`. Cached in-process after the first call. |

## Workspace switching — `tools/workspace.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `manage_workspace` | 60s | `status`, `list`, `switch`, `login` | Session-scoped. Sets a module-level workspace override (`set_active_workspace`) — single-user assumption. `login` runs `databricks auth login` via subprocess. |

## Resource manifest — `tools/manifest.py`

| Tool | Timeout | Actions | Notes |
|------|---------|---------|-------|
| `list_tracked_resources` | 30s | (no dispatch) | Optional `type` filter. |
| `delete_tracked_resource` | 60s | (no dispatch) | `delete_from_databricks=True` calls the type's registered deleter first. Removes from manifest even if workspace deletion fails. |

See [manifest.md](manifest.md) for the resource-tracking model.
