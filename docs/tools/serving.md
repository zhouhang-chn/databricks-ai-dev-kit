# `serving/` — Model Serving endpoints

Source: [`databricks_tools_core/serving/`](../../databricks-tools-core/databricks_tools_core/serving/)

Thin layer over the Model Serving SDK — inspecting and querying endpoints. Endpoint creation/update is intentionally not in scope here; use the SDK directly or the MCP tool that orchestrates `mlflow.deployments` for that.

## Public API

| Function | Returns | Notes |
|----------|---------|-------|
| `get_serving_endpoint_status(name)` | `Dict[str, Any]` | Includes ready state, served entity versions, traffic config, last update timestamp. |
| `query_serving_endpoint(name, inputs=None, messages=None, dataframe_split=None, timeout=180, **extra)` | `Dict[str, Any]` | Polymorphic dispatch: chooses between chat (`messages`), tabular (`inputs` / `dataframe_split`), or raw payload depending on which kwarg is set. Returns the raw response body. |
| `list_serving_endpoints(limit=50)` | `List[Dict[str, Any]]` | |

## Conventions

- **Auth.** Calls flow through the same `WorkspaceClient` used elsewhere — no separate token plumbing.
- **Payload shape detection** is best-effort; pass exactly one of `messages`, `inputs`, or `dataframe_split` to keep behaviour unambiguous.

## Related

- MCP wrapper: [`databricks_mcp_server/tools/serving.py`](../../databricks-mcp-server/databricks_mcp_server/tools/serving.py)
- Skill: [`databricks-skills/databricks-model-serving/SKILL.md`](../../databricks-skills/databricks-model-serving/SKILL.md)
