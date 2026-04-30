# `apps/` — Databricks Apps

Source: [`databricks_tools_core/apps/`](../../databricks-tools-core/databricks_tools_core/apps/)

Lifecycle helpers for Databricks Apps. Single file (`apps.py`).

## Public API

| Function | Notes |
|----------|-------|
| `create_app(name, description=None, ...)` | Provisions an app shell. Source files must be uploaded separately (see `file/`). |
| `get_app(name)` | |
| `list_apps(limit=50, ...)` | Internal `_app_to_dict` flattens SDK objects to plain dicts. |
| `deploy_app(name, source_code_path, ...)` | Triggers a deployment of code already present in the workspace. Returns deployment metadata via `_deployment_to_dict`. |
| `delete_app(name)` | |
| `get_app_logs(name, ..., follow=False)` | Pulls log output. |

## Conventions

- **Two phases.** App lifecycle is "create the shell" (`create_app`), then "ship the code" (`deploy_app` against a source path). Source upload is the caller's responsibility — typically via `file.upload_to_workspace`.
- **Dict normalisation helpers** (`_app_to_dict`, `_deployment_to_dict`) are private but worth knowing about; they shape SDK responses for MCP/JSON consumers.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/apps.py`](../../databricks-mcp-server/databricks_mcp_server/tools/apps.py)
- Skill: [`databricks-skills/databricks-app-python/SKILL.md`](../../databricks-skills/databricks-app-python/SKILL.md)
