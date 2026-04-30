# `compute/` — Clusters, serverless, code execution

Source: [`databricks_tools_core/compute/`](../../databricks-tools-core/databricks_tools_core/compute/)

Three concerns under one module:

- **`execution.py`** — list/select clusters and run code through the Command Execution API.
- **`serverless.py`** — run a code snippet on serverless via a temporary one-task notebook job.
- **`manage.py`** — cluster and SQL warehouse CRUD plus node-type / Spark version listings.

## Public API

### `execution.py`

| Function | Returns | Notes |
|----------|---------|-------|
| `list_clusters(running_only=False, accessible_only=True, ...)` | `List[Dict[str, Any]]` | Filters out clusters the current user cannot attach to. |
| `get_best_cluster()` | `Optional[str]` | Picks the most-suitable running, accessible cluster (user-owned > accessible > shared). |
| `start_cluster(cluster_id)` | `Dict[str, Any]` | Starts and waits up to a default timeout. |
| `get_cluster_status(cluster_id)` | `Dict[str, Any]` | |
| `create_context(cluster_id, language="python")` | `str` | Returns a context ID. |
| `destroy_context(cluster_id, context_id)` | `None` | |
| `execute_databricks_command(code, cluster_id=None, language="python", context_id=None, timeout=300)` | `ExecutionResult` | If `cluster_id` is omitted, picks a cluster via `get_best_cluster()`. Reuses `context_id` when provided; otherwise creates and tears down a context per call. |
| `run_file_on_databricks(local_path, cluster_id=None, language=None, ...)` | `ExecutionResult` | Uploads to the workspace, executes, returns output. |

`ExecutionResult` carries `success`, `stdout`, `stderr`, `result_value`, `error_summary`, `error_traceback`, `execution_time`, `cluster_id`, `context_id`. `NoRunningClusterError` is raised when no cluster is reachable and starting one would exceed the timeout.

### `serverless.py`

| Function | Returns | Notes |
|----------|---------|-------|
| `run_code_on_serverless(code, language="python", environment_dependencies=None, run_label=None, timeout=1200)` | `ServerlessRunResult` | Uploads a temp notebook (`.ipynb` if input is a notebook, otherwise raw source), runs it as a serverless one-task job, captures output, and removes the temp notebook. `environment_dependencies` is a list of pip specs. |

`ServerlessRunResult` carries success/failure, run output, error info, and run page URL.

### `manage.py`

Cluster lifecycle:

| Function | Notes |
|----------|-------|
| `create_cluster(name, num_workers=None, spark_version=None, node_type_id=None, autoscale=None, ...)` | Defaults to the latest LTS Spark version and a workspace-default node type when fields are omitted. |
| `modify_cluster(cluster_id, ...)` | Edit existing cluster. |
| `terminate_cluster(cluster_id)` / `delete_cluster(cluster_id)` | |
| `list_node_types()` / `list_spark_versions()` | |

SQL warehouse lifecycle:

| Function | Notes |
|----------|-------|
| `create_sql_warehouse(name, ..., warehouse_type="PRO", enable_serverless_compute=True, ...)` | |
| `modify_sql_warehouse(warehouse_id, ...)` | |
| `delete_sql_warehouse(warehouse_id)` | |

## Conventions

- **Best-effort selection.** `get_best_cluster()` and `get_best_warehouse()` (in `sql/`) prefer user-owned, running, accessible compute. They never start anything; if you want a cluster started, call `start_cluster()` explicitly.
- **Command vs. job execution.** Use the command-execution path (`execute_databricks_command`) for fast interactive snippets on a running cluster, and the serverless path (`run_code_on_serverless`) when you need pip dependencies or do not have a cluster.
- **Defaults from the workspace.** `create_cluster` queries the workspace for the latest LTS Spark version and a default node type at call time.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/compute.py`](../../databricks-mcp-server/databricks_mcp_server/tools/compute.py)
- Skill: [`databricks-skills/databricks-execution-compute/SKILL.md`](../../databricks-skills/databricks-execution-compute/SKILL.md)
