# Tool design conventions

The MCP server follows a small set of patterns that diverge from the underlying core library. Knowing them makes it easier to read existing tools and add new ones.

## Action dispatch

Almost every tool is a single `manage_<thing>(action, ...)` function with an `action` string parameter and a flat list of optional keyword arguments. Each branch validates the kwargs it cares about, then forwards to a private helper or directly to a `databricks-tools-core` function.

```python
@mcp.tool(timeout=60)
def manage_jobs(action: str, job_id: int = None, name: str = None, ...):
    act = action.lower()
    if act == "create": ...
    elif act == "get": ...
    elif act == "list": ...
    elif act == "find_by_name": ...
    elif act == "update": ...
    elif act == "delete": ...
    return {"error": f"Invalid action '{action}'. Valid actions: ..."}
```

Why a single tool with `action`, instead of one tool per verb?

- **Tool-list size pressure.** Each tool is text in the system prompt. Consolidating from "create_job, get_job, list_jobs, run_job_now, …" to `manage_jobs` + `manage_job_runs` keeps the model's context budget reasonable.
- **Cohesion.** Verbs over the same noun share most arguments. Branches read more like the underlying API.
- **Skill-discovered options.** The model is expected to read the docstring (or skill) for the action set; an unknown action returns an error message that lists the valid options.

A handful of tools are *not* consolidated — they are kept separate when they are hot paths or carry very different argument shapes:

- `execute_sql`, `execute_sql_multi` — the model calls these constantly; consolidating with `manage_warehouse` would add noise.
- `execute_code` — different payload shapes for serverless / cluster / file mode that don't fit a single dispatch table.
- `query_vs_index`, `manage_vs_data` — split from `manage_vs_index` because they take very different arguments.
- `ask_genie` — explicitly noted in `tools/genie.py` as "HOT PATH - kept separate for performance."
- `query_serving_endpoint`, `generate_lakebase_credential`, `generate_and_upload_pdf`, `get_current_user` — small, self-contained, no useful sibling actions.

## Idempotency by name

Every `create_or_update` action looks up the resource by name first. If found, it updates instead of creating; if not found, it creates. Dedicated `find_by_name` actions exist on most consolidated tools so the model can probe before acting.

```python
existing_job_id = _find_job_by_name(name=name)
if existing_job_id is not None:
    return {
        "job_id": existing_job_id,
        "already_exists": True,
        "message": f"Job '{name}' already exists with job_id={existing_job_id}. ..."
    }
```

The pattern matters because **timeouts are common** and the agent's natural recovery is to retry. Without name-based idempotency, a retried `create` would create a duplicate. The middleware also hard-blocks naïve retry by returning an `action_required` message on timeout (see [middleware.md](middleware.md)) — but defence in depth is cheap.

## Output shapes

- Most tools return a `Dict[str, Any]`. Bare strings are rare and reserved for human-readable formatted output (`execute_sql` returns a markdown table when `output_format="markdown"`).
- On success: the relevant resource fields, plus a hint at what changed (`created`, `already_exists`, `operation`, `success`).
- On client error (bad arguments): `{"error": "...", "hint": "..."}`. **Returned as a successful tool result** — the middleware does not turn it into a `ToolError` because it is not an exception.
- On server / SDK error: the underlying exception bubbles up and is converted by the middleware into `{"error": true, "error_type": "...", ...}` with `isError=True`.
- `list` actions return `{"items": [...]}` or `{"<plural>": [...]}` with `count` where useful.

## Default tags

Tools that create persistent resources auto-inject `databricks_tools_core.identity.get_default_tags()`:

```python
merged_tags = {**get_default_tags(), **(tags or {})}
```

User-supplied tags win on key conflict. The default tags include the AI Dev Kit product name and project name so workspace administrators can attribute usage in `system.access.audit`.

Currently applied in: `tools/jobs.py`, `tools/pipelines.py`. Other create paths should follow.

## Output format flags

Some tools accept `output_format="markdown"|"json"`:

- `execute_sql` and `execute_sql_multi` default to `"markdown"` because rendered tables are about 50% smaller in tokens than equivalent JSON arrays of dicts.
- The model can override to `"json"` when it needs to post-process programmatically.

This is purely a token-budget optimisation; the underlying core function always returns `List[Dict[str, Any]]`.

## `manifest` integration

Create paths track the resource on success; delete paths remove the row. Failures during manifest writes are swallowed (logged as warnings) — manifest correctness is best-effort, never blocking.

```python
result = _create_pipeline(...)
try:
    if result.pipeline_id:
        from ..manifest import track_resource
        track_resource(resource_type="pipeline", name=name, resource_id=result.pipeline_id)
except Exception:
    pass
return {"pipeline_id": result.pipeline_id}
```

See [manifest.md](manifest.md) for the full pattern.

## Argument hygiene

A few quirks worth knowing:

- **`_none_if_empty`** — Claude sometimes passes `""` instead of `null`. The compute tool normalises to `None` before branching. New tools that accept long-form free-text arguments should probably do the same.
- **JSON-deserialisation drift** — MCP clients sometimes deserialise stringified JSON to a dict before sending it to the server. `manage_dashboard` re-serialises `serialized_dashboard` if it arrives as a `dict` so downstream code can treat it as a string uniformly.
- **Cap list responses.** `manage_volume_files(action="list")` caps at 1000 results and sets a `truncated` flag; large list responses can blow past the 1MB JSON-RPC frame limit and disconnect the client.

## Timeouts

`@mcp.tool(timeout=<seconds>)` is set per tool to a value that covers the long tail of legitimate calls without letting a stuck operation hold up the agent forever. Rough categories:

| Range | Examples |
|-------|----------|
| 30s | `manage_workspace`, `get_current_user`, `manage_warehouse`, `generate_lakebase_credential`, `list_tracked_resources` |
| 60s | most CRUD tools (`manage_jobs`, `manage_uc_*`, `manage_genie`, `query_vs_index`, file uploads) |
| 120s | bulk SQL / dashboard / serving / vs operations |
| 180s | KA / MAS / app deploy (provisioning) |
| 300s | `manage_pipeline`, `manage_pipeline_run`, `manage_job_runs`, `manage_volume_files` |

A timeout doesn't mean the workspace operation failed — see [middleware.md § Timeouts](middleware.md#2-timeouts--do-not-retry-responses).
