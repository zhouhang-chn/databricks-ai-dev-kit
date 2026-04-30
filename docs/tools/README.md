# databricks-tools-core

`databricks-tools-core` is the Python library underneath every higher-level deliverable in the kit:

- `databricks-mcp-server` wraps each module here as an MCP tool.
- `databricks-builder-app` imports the same modules in-process from its bundled `packages/`.
- Skills under `databricks-skills/` describe *when* and *how* an AI assistant should call these functions.

If you change a function signature here, update the matching MCP tool in `databricks-mcp-server/databricks_mcp_server/tools/` and any skill that documents it.

## Source layout

```
databricks-tools-core/databricks_tools_core/
├── auth.py            # Auth context (contextvars → env → ~/.databrickscfg)
├── client.py          # WorkspaceClient construction
├── identity.py        # PRODUCT_NAME / PRODUCT_VERSION tagging for audit
├── common/            # Cross-module helpers
│
├── sql/               # SQL execution + warehouses + table/volume stats
├── jobs/              # Lakeflow Jobs (CRUD + run lifecycle)
├── unity_catalog/     # Catalogs, schemas, tables, volumes, grants, monitors, tags, sharing, …
├── compute/           # All-purpose clusters, serverless code execution, warehouse mgmt
├── spark_declarative_pipelines/  # SDP / DLT pipeline lifecycle
├── serving/           # Model serving endpoints
├── vector_search/     # VS endpoints, indexes, query
├── lakebase/          # Lakebase Provisioned (managed Postgres) instances + UC catalogs + synced tables
├── lakebase_autoscale/ # Lakebase Autoscaling projects, branches, computes, credentials
├── agent_bricks/      # Knowledge Assistants, Multi-Agent Supervisors, Genie Spaces (single AgentBricksManager class)
├── aibi_dashboards/   # AI/BI (formerly Lakeview) dashboards
├── apps/              # Databricks Apps deploy/manage
├── file/              # Workspace file uploads (notebook detection)
├── pdf/               # HTML → PDF → UC volume
└── dabs/              # (Coming soon — placeholder)
```

## Module reference

Detailed docs per domain. Each page lists public functions and the data classes they return.

| Module | Doc | Notes |
|--------|-----|-------|
| `auth` | [auth.md](auth.md) | Authentication context — read this first |
| `sql/` | [sql.md](sql.md) | `execute_sql`, `execute_sql_multi`, warehouse selection, table stats |
| `jobs/` | [jobs.md](jobs.md) | Job CRUD + run lifecycle (`run_job_now`, `wait_for_run`) |
| `unity_catalog/` | [unity-catalog.md](unity-catalog.md) | The largest module — catalogs, schemas, tables, volumes, grants, monitors, tags, sharing, security policies, metric views, connections, storage credentials |
| `compute/` | [compute.md](compute.md) | Cluster management, serverless run, command-context execution |
| `spark_declarative_pipelines/` | [spark-declarative-pipelines.md](spark-declarative-pipelines.md) | SDP/DLT pipeline lifecycle, `create_or_update_pipeline` |
| `serving/` | [serving.md](serving.md) | Model serving endpoint status + query |
| `vector_search/` | [vector-search.md](vector-search.md) | VS endpoint + index lifecycle, similarity query |
| `lakebase/` | [lakebase.md](lakebase.md) | Lakebase Provisioned instances, UC catalogs, synced tables |
| `lakebase_autoscale/` | [lakebase-autoscale.md](lakebase-autoscale.md) | Lakebase Autoscaling projects/branches/computes |
| `agent_bricks/` | [agent-bricks.md](agent-bricks.md) | KAs, MAS, Genie Spaces via a single `AgentBricksManager` |
| `aibi_dashboards/` | [aibi-dashboards.md](aibi-dashboards.md) | AI/BI dashboard CRUD + deploy + publish |
| `apps/` | [apps.md](apps.md) | Databricks Apps lifecycle + logs |
| `file/` | [file.md](file.md) | Workspace file/folder uploads with notebook detection |
| `pdf/` | [pdf.md](pdf.md) | HTML → PDF → UC volume in one call |

## Cross-cutting conventions

**Authentication.** Every module obtains its `WorkspaceClient` via `auth.get_workspace_client()`. The resolution order is:

1. Module-level workspace override set by the MCP `manage_workspace` tool (single-user stdio assumption — see `auth.set_active_workspace`).
2. Per-request contextvars set by `set_databricks_auth(host, token)` (used by the Builder App; see `EVENT_LOOP_FIX.md` for why agent threads must copy these).
3. `DATABRICKS_HOST` + `DATABRICKS_TOKEN` env vars.
4. `DATABRICKS_CONFIG_PROFILE` or default `~/.databrickscfg` profile.

Clients are tagged with `PRODUCT_NAME` / `PRODUCT_VERSION` (see `identity.py`) so calls are attributable in `system.access.audit`.

**Return types.** Most functions return either an SDK object, a `Dict[str, Any]`, or a small `dataclass` / `pydantic` model defined alongside the function. Functions that wait for completion (`wait_for_run`, `wait_for_pipeline_update`, `ka_wait_*`) return success/failure state objects, not raise on terminal failure.

**Error model.** Module-specific exceptions live next to their functions (`SQLExecutionError`, `JobError`, `NoRunningClusterError`). SDK errors propagate unwrapped where no special handling is needed.

**Resource tracking.** Resources created via the MCP server are tracked in a project-local `.databricks-resources.json` (`databricks_mcp_server/manifest.py`). Core itself does not track resources; the manifest is purely an MCP-layer affordance.

**Naming for AI ergonomics.** Functions are named for the verb the model would emit (`create_pipeline`, `query_vs_index`, `wait_for_run`). High-level "do the right thing" entry points (`create_or_update_pipeline`, `create_or_update_dashboard`, `deploy_app`) wrap the lower-level CRUD primitives. Prefer documenting the high-level entry points first.

## Adding a new module

1. Create `databricks_tools_core/<module>/` with `__init__.py` re-exporting the public surface.
2. Add a domain entry in this README.
3. Add a corresponding doc file under `docs/tools/<module>.md` following the existing template (function table → data classes → notes).
4. Add an MCP wrapper in `databricks-mcp-server/databricks_mcp_server/tools/<module>.py`.
5. If there is a user-facing pattern, add or update a `databricks-skills/<skill>/SKILL.md` so the AI assistant knows when to call it.
