# Resource manifest

Source: [`manifest.py`](../../databricks-mcp-server/databricks_mcp_server/manifest.py), [`tools/manifest.py`](../../databricks-mcp-server/databricks_mcp_server/tools/manifest.py)

A small JSON file in the project root that records resources the agent has created. Without it, agents start every session blind to what the previous session built and frequently re-create duplicates.

## What it is

A single file: `<project_root>/.databricks-resources.json`. Schema:

```json
{
  "version": 1,
  "resources": [
    {
      "type": "pipeline",
      "name": "bronze_to_silver",
      "id": "1234-5678-...",
      "url": "https://workspace.cloud.databricks.com/pipelines/...",
      "created_at": "2026-04-30T10:15:00+00:00",
      "updated_at": "2026-04-30T10:20:00+00:00"
    },
    ...
  ]
}
```

- `version` — schema version constant (`MANIFEST_VERSION = 1`).
- `type` — resource kind. Used as a key into the deleter registry. See [§ Resource types](#resource-types).
- `name` — human-readable identifier. Within a `(type, name)` pair, the manifest treats the entry as the same resource even if the workspace ID changes (handles re-creation across sessions).
- `id` — Databricks resource ID. Whatever the relevant tool returns (`job_id`, `pipeline_id`, `space_id`, full UC name, etc.).
- `url` — optional deep link.
- timestamps — ISO 8601 UTC.

## Where it lives

The manifest path is `Path(os.getcwd()) / ".databricks-resources.json"`. The MCP server is launched from the project root by clients (Claude Code, Cursor) — that is where the file ends up. Switch projects → switch manifests. There is no global manifest.

`_get_manifest_path` literally calls `os.getcwd()`. If you run the server from a directory other than the project root the manifest will land in the wrong place. (This is intentional — there are no per-process search heuristics.)

## API surface

### Internal Python API (`manifest.py`)

| Function | Purpose |
|----------|---------|
| `track_resource(resource_type, name, resource_id, url=None)` | Upsert: match by `(type, id)` first, then by `(type, name)` (handles ID changes), else append. Best-effort — failures only log a warning. |
| `remove_resource(resource_type, resource_id) -> bool` | Returns `True` if a row was removed. Used after a successful delete. |
| `list_resources(resource_type=None) -> List[Dict]` | Returns all rows, optionally filtered by type. |
| `register_deleter(resource_type, fn)` | Each tool module calls this at import time so the manifest tool layer can delete by `(type, id)` without hard-coding every domain. The function takes a single string `resource_id`. |

### MCP tools (`tools/manifest.py`)

| Tool | Action |
|------|--------|
| `list_tracked_resources(type=None)` | Returns `{resources: [...], count}`. |
| `delete_tracked_resource(type, resource_id, delete_from_databricks=False)` | Removes from manifest; if `delete_from_databricks=True`, calls the registered deleter first. The manifest row is removed even if the workspace deletion failed (so a stale entry doesn't trap the agent). |

The delete tool returns:

```json
{
  "success": true,
  "removed_from_manifest": true,
  "deleted_from_databricks": true,
  "error": null
}
```

## Resource types

Each tool module that creates a resource calls `register_deleter(<type>, <fn>)` at import time, then `track_resource(...)` after a successful create. Current types:

| Type | Module | Deleter |
|------|--------|---------|
| `catalog`, `schema`, `volume` | `tools/unity_catalog.py` | `_delete_catalog_resource`, `_delete_schema_resource`, `_delete_volume_resource` |
| `job` | `tools/jobs.py` | `_delete_job_resource(int(resource_id))` |
| `pipeline` | `tools/pipelines.py` | direct `delete_pipeline` call |
| `dashboard` | `tools/aibi_dashboards.py` | `_delete_dashboard_resource` |
| `genie_space` | `tools/genie.py` | direct delete |
| `ka` (Knowledge Assistant) | `tools/agent_bricks.py` | `_delete_ka_resource` |
| `mas` (Multi-Agent Supervisor) | `tools/agent_bricks.py` | `_delete_mas_resource` |
| `vs_endpoint` | `tools/vector_search.py` | direct delete |

Adding a new resource type is two lines: a `register_deleter("<type>", <delete_fn>)` call at module level, and a `track_resource("<type>", name, id, url=...)` call after a successful create/update.

## Behavioural notes

- **Best-effort.** Manifest writes are wrapped in try/except and only emit `logger.warning` on failure. Tools never abort or retry because the manifest write failed — they always return the workspace result first.
- **Atomic writes.** `_write_manifest` writes to a sibling tempfile and `os.replace`s it. A crash during write leaves the previous manifest intact.
- **Schema migration.** There is no migrator yet. If `version` is missing or the file is malformed, `_read_manifest` returns an empty structure (logs a warning). Bumping `MANIFEST_VERSION` will need migration code.
- **Not a source of truth.** The manifest can drift if resources are deleted out-of-band (UI, Terraform, another agent). Tools should treat it as a hint, not a guarantee — that's why most `create_or_update` paths re-check existence in the workspace by name before deciding to create.
