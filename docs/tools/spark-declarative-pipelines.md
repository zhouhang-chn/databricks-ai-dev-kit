# `spark_declarative_pipelines/` — SDP / DLT pipelines

Source: [`databricks_tools_core/spark_declarative_pipelines/`](../../databricks-tools-core/databricks_tools_core/spark_declarative_pipelines/)

Lifecycle helpers for Spark Declarative Pipelines (formerly Delta Live Tables). Two files:

- `pipelines.py` — pipeline CRUD + update lifecycle + event log readout.
- `workspace_files.py` — upload/list/delete pipeline source files in the workspace.

## Public API (`pipelines.py`)

| Function | Returns | Notes |
|----------|---------|-------|
| `find_pipeline_by_name(name)` | `Optional[str]` | First matching pipeline ID. |
| `create_pipeline(name, libraries=None, target=None, channel="CURRENT", continuous=False, **extra_settings)` | `Dict[str, Any]` | `libraries` accepts workspace-file paths; the helper builds `PipelineLibrary` entries. |
| `get_pipeline(pipeline_id)` | `GetPipelineResponse` | SDK object. |
| `update_pipeline(pipeline_id, ...)` | `Dict[str, Any]` | Replaces pipeline settings. Same kwargs as create. |
| `delete_pipeline(pipeline_id)` | `None` | |
| `start_update(pipeline_id, full_refresh=False, refresh_selection=None, ...)` | `Dict[str, Any]` | Returns `update_id`. |
| `get_update(pipeline_id, update_id)` | `Dict[str, Any]` | |
| `stop_pipeline(pipeline_id)` | `None` | |
| `get_pipeline_events(pipeline_id, update_id=None, max_results=100, ...)` | `List[PipelineEvent]` | Used internally by `wait_for_pipeline_update` to extract error summaries. |
| `wait_for_pipeline_update(pipeline_id, update_id, timeout=3600, poll_interval=15)` | `PipelineRunResult` | Blocks until the update reaches a terminal state. Pulls error events on failure for actionable messages. |
| `create_or_update_pipeline(name, ...)` | `Dict[str, Any]` | Idempotent: looks up by name, creates if missing, updates if present. The recommended entry point for AI-driven flows. |

`PipelineRunResult` (dataclass): `success`, `update_id`, `state`, `duration_seconds`, `pipeline_id`, `pipeline_url`, `error_summary` (list of one-line summaries pulled from events), `error_details` (full event details).

## Public API (`workspace_files.py`)

Helpers for managing the source files that pipelines reference. Used by the MCP server to upload SDP source code from the project working directory before creating a pipeline.

## Conventions

- **Errors as events, not exceptions.** When an update fails, `wait_for_pipeline_update` returns a `PipelineRunResult` with `success=False` plus an extracted error summary — it does not raise. Callers should branch on `result.success`.
- **Path of least surprise.** Always go through `create_or_update_pipeline` from agent / MCP flows; keep the lower-level `create_pipeline`/`update_pipeline` for cases where you genuinely need the split.
- **Channel default.** `channel="CURRENT"`. Pass `"PREVIEW"` to opt into pre-release runtimes.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/pipelines.py`](../../databricks-mcp-server/databricks_mcp_server/tools/pipelines.py)
- Skill: [`databricks-skills/databricks-spark-declarative-pipelines/SKILL.md`](../../databricks-skills/databricks-spark-declarative-pipelines/SKILL.md)
