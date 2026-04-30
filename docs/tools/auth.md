# `auth` — Workspace authentication context

Source: [`databricks_tools_core/auth.py`](../../databricks-tools-core/databricks_tools_core/auth.py)

Every other module obtains a `WorkspaceClient` from `auth.get_workspace_client()`. There is no parallel "client builder" — if you need a client, go through `auth`.

## Resolution order

`get_workspace_client()` walks these in order, returning the first that succeeds:

1. **Module-level workspace override.** Set by `set_active_workspace(profile=..., host=...)` and used exclusively by the MCP `manage_workspace` tool. The MCP server is single-user over stdio, so module globals are safe — do not call this from multi-user contexts.
2. **Per-request contextvars.** Set by `set_databricks_auth(host, token, force_token=False)` and cleared by `clear_databricks_auth()`. Used by the Builder App for per-request user credentials. Pass `force_token=True` to override an env-based OAuth flow when crossing workspaces.
3. **Environment variables.** `DATABRICKS_HOST` + `DATABRICKS_TOKEN`.
4. **Config profile.** `DATABRICKS_CONFIG_PROFILE` or default `~/.databrickscfg`.

The returned client is tagged via `identity.tag_client()` with `PRODUCT_NAME` / `PRODUCT_VERSION` and an auto-detected project name so calls show up attributable in `system.access.audit`.

## Public API

| Function | Purpose |
|----------|---------|
| `get_workspace_client() -> WorkspaceClient` | Resolve credentials and return a tagged client. Always use this — never construct `WorkspaceClient` directly. |
| `set_databricks_auth(host, token, force_token=False)` | Push per-request credentials onto contextvars. Call from a request handler / middleware. |
| `clear_databricks_auth()` | Clear the per-request contextvars. Always call in a `finally` block. |
| `set_active_workspace(profile=None, host=None)` | Module-level override for the MCP `manage_workspace` tool. Single-user only. |
| `get_active_workspace() -> dict` | Inspect the current module-level override. |
| `get_current_username() -> Optional[str]` | Cached lookup of the current authenticated user (one network call per process). |

## Multi-user pattern (Builder App)

```python
from databricks_tools_core.auth import set_databricks_auth, clear_databricks_auth

async def handle_request(user_host: str, user_token: str):
    set_databricks_auth(user_host, user_token)
    try:
        # All downstream calls use this user's credentials
        result = execute_sql("SELECT current_user()")
    finally:
        clear_databricks_auth()
```

> **Async caveat.** Contextvars do not propagate across `asyncio.run_in_executor` or threads created with `threading.Thread`. The Builder App copies contextvars when spawning the agent thread — see [`EVENT_LOOP_FIX.md`](../../databricks-builder-app/EVENT_LOOP_FIX.md). New code that crosses thread boundaries must do the same.

## Single-user pattern (CLI / MCP server)

Just set env vars or a profile and call functions directly. The first `get_workspace_client()` call resolves them and is cached for the process.

```bash
export DATABRICKS_HOST="https://workspace.cloud.databricks.com"
export DATABRICKS_TOKEN="..."
# or:
export DATABRICKS_CONFIG_PROFILE="my-profile"
```
