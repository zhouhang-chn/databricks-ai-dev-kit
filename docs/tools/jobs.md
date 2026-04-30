# `jobs/` — Lakeflow Jobs

Source: [`databricks_tools_core/jobs/`](../../databricks-tools-core/databricks_tools_core/jobs/)

Wraps the Databricks Jobs SDK with serverless-by-default opinionated defaults and a `wait_for_run` helper that blocks on terminal state and returns a structured `JobRunResult`.

## Public API

### Job CRUD

| Function | Returns | Notes |
|----------|---------|-------|
| `list_jobs(limit=25, name_filter=None, expand_tasks=False)` | `List[Dict[str, Any]]` | |
| `get_job(job_id)` | `Dict[str, Any]` | |
| `find_job_by_name(name)` | `Optional[int]` | Returns first matching job ID. |
| `create_job(name, tasks, job_clusters=None, environments=None, tags=None, timeout_seconds=None, max_concurrent_runs=1, ...)` | `Dict[str, Any]` | Auto-injects `client: "4"` into `environments[*].spec` so serverless tasks don't fail with the "Either base environment or version must be provided" error. Accepts `**extra_settings` for fields not in the explicit signature. |
| `update_job(job_id, ...)` | `Dict[str, Any]` | Same kwargs as `create_job`; performs an SDK `update`. |
| `delete_job(job_id)` | `None` | |

### Run lifecycle

| Function | Returns | Notes |
|----------|---------|-------|
| `run_job_now(job_id, parameters=None, ...)` | `int` | Returns the run ID. |
| `repair_run(run_id, rerun_tasks=None, ...)` | `Dict[str, Any]` | Repair-run for failed task subsets. |
| `get_run(run_id)` | `Dict[str, Any]` | |
| `get_run_output(run_id)` | `Dict[str, Any]` | Pulls task output (notebook return values, error text, etc.). |
| `cancel_run(run_id)` | `None` | |
| `list_runs(job_id=None, ...)` | `List[Dict[str, Any]]` | |
| `wait_for_run(run_id, timeout=3600, poll_interval=10)` | `JobRunResult` | Blocks until terminal state. Raises `TimeoutError` if not reached. Resolves `job_id` and `job_name` on the first poll for nicer logs. |

### Data classes & errors

- `JobRunResult` (dataclass): `success`, `lifecycle_state`, `result_state`, `duration_seconds`, `error_message`, `run_page_url`, `job_id`, `job_name`.
- `JobStatus`, `RunLifecycleState`, `RunResultState` — string enums mirroring the Jobs API.
- `JobError` — raised on API failures during create/run.

## Conventions

- **Serverless by default.** Tasks without `new_cluster` / `existing_cluster_id` / `job_cluster_key` run on serverless. To pin libraries on serverless, pass an `environments=[{"environment_key": "default", "spec": {"dependencies": [...]}}]` and reference it in the task with `environment_key`.
- **Task definitions are passed through as dicts** to `JobSettings.from_dict()` — there is no Python-side validation of task shape. Refer to the Jobs API reference for valid task fields.
- **Extra fields.** Anything not explicitly listed in `create_job`/`update_job` can go through `**extra_settings`, which is merged into the settings dict before SDK conversion.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/jobs.py`](../../databricks-mcp-server/databricks_mcp_server/tools/jobs.py)
- Skill: [`databricks-skills/databricks-jobs/SKILL.md`](../../databricks-skills/databricks-jobs/SKILL.md)
