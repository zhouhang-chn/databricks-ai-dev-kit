# Server architecture

How the process is wired up — entry point, FastMCP setup, and the platform-specific patches that have to run before any tool is registered.

Source: [`server.py`](../../databricks-mcp-server/databricks_mcp_server/server.py), [`run_server.py`](../../databricks-mcp-server/run_server.py)

## Process model

```
┌── MCP client (Claude Code / Cursor / IDE / Builder App gateway) ──┐
│                                                                    │
│   spawns ──► python run_server.py  (stdio transport)               │
│   stdin/stdout = JSON-RPC frames                                   │
│   stderr      = log output                                         │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌── databricks-mcp-server (single Python process) ───────────────────┐
│                                                                    │
│   server.py                                                        │
│     ├── _patch_subprocess_stdin()      (Windows only, runs first)  │
│     ├── FastMCP("Databricks MCP Server", tasks=False on Windows)   │
│     ├── add_middleware(TimeoutHandlingMiddleware())                │
│     ├── _patch_tool_decorator_for_async()                          │
│     └── from .tools import * (each module registers @mcp.tool)     │
│                                                                    │
│   run_server.py:                                                   │
│     mcp.run(transport="stdio")                                     │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌── databricks-tools-core (in-process Python imports) ───────────────┐
│   auth.get_workspace_client() → SDK call → Databricks workspace    │
└────────────────────────────────────────────────────────────────────┘
```

The server is a **single Python process** with no parallelism beyond `asyncio.to_thread`. There is no built-in worker pool, no IPC, and no shared state between MCP clients. If two clients each launch their own `run_server.py`, those are two independent processes with independent auth state.

## Bootstrap order matters

`server.py` does a careful sequence at import time. Re-ordering will break things:

1. **(Windows only) `_patch_subprocess_stdin()`** — must run *before* any Databricks SDK import. The Databricks SDK refreshes auth tokens via `subprocess.run(["databricks", "auth", "token"], shell=True)` without setting `stdin`. In stdio mode, stdin *is* the JSON-RPC pipe — the spawned `databricks.exe` blocks on a read of it and every tool call hangs. The patch sets `stdin=subprocess.DEVNULL` as the default for both `subprocess.run` and `subprocess.Popen`. See modelcontextprotocol/python-sdk#671.
2. **FastMCP init** with `tasks=False` on Windows. The default FastMCP "docket" worker uses `fakeredis XREADGROUP BLOCK`, which deadlocks the Windows `ProactorEventLoop`. The override of `mcp._docket_lifespan` to a no-op is belt-and-suspenders for cases where `tasks=False` is ignored.
3. **`add_middleware(TimeoutHandlingMiddleware())`** — see [middleware.md](middleware.md).
4. **`_patch_tool_decorator_for_async()`** — wraps every sync tool body in `asyncio.to_thread()`. This is applied on **all platforms** because:
   - On Windows, sync code on `ProactorEventLoop` blocks every other I/O task.
   - On all platforms, sync bodies don't yield, so `CancelledError` from the client cannot reach them. Without the wrapper you get "Request already responded to" assertions when clients cancel.

   The patch monkey-patches `mcp.tool` itself so that *both* `@mcp.tool` and `@mcp.tool("name", timeout=...)` paths run sync functions in a thread pool.

   > FastMCP 3.x is reported to do this automatically. There is a `TODO` to remove the patch after upgrading.
5. **Tool imports.** Each `tools/<module>.py` imports the shared `mcp` instance and uses `@mcp.tool` decorators. Importing the module is the registration. The `from .tools import (...)` block at the bottom of `server.py` is therefore *not* dead code — removing a name there unregisters that domain.

## Entry point

`run_server.py` is the single entry point:

```python
if os.environ.get("DATABRICKS_MCP_DEBUG"):
    logging.basicConfig(level=logging.DEBUG, stream=sys.stderr, ...)

from databricks_mcp_server.server import mcp
mcp.run(transport="stdio")
```

`stderr` is used for log output so it does not collide with the JSON-RPC frames on `stdout`. Set `DATABRICKS_MCP_DEBUG=1` to enable debug logging.

The HTTP variant of the MCP server is **not** started here — that path lives in the Builder App's [`mcp_gateway.py`](../../databricks-builder-app/server/mcp_gateway.py). It uses the same FastMCP instance but a different transport.

## Authentication

The server is single-user over stdio. There is no per-request auth; all tool calls share the same `WorkspaceClient` resolved at first use:

1. Module-level override (set by the `manage_workspace` tool — see [tools.md § `manage_workspace`](tools.md#manage_workspace)).
2. `DATABRICKS_HOST` + `DATABRICKS_TOKEN` env vars.
3. `DATABRICKS_CONFIG_PROFILE` or default `~/.databrickscfg`.

Resolution rules and the `set_active_workspace`/`set_databricks_auth` distinction are documented in [`../tools/auth.md`](../tools/auth.md). The MCP server uses `set_active_workspace` (module global), not `set_databricks_auth` (contextvars).

## Why every tool runs in a thread pool

Two reasons, both critical:

| Symptom | Cause | Fix |
|---------|-------|-----|
| All tools hang on Windows after the first call | Sync tool blocks `ProactorEventLoop`; stdio I/O tasks can't run | `asyncio.to_thread` wrapper releases the loop |
| Random crashes after client timeouts: `AssertionError: Request already responded to` | Client sent a `cancel`, MCP SDK responded; sync tool finally returned, SDK tried to respond again | `asyncio.to_thread` lets `anyio` cancel the task |

The wrapper preserves `functools.wraps` metadata so FastMCP's signature inspection (used to build the tool input schema) still sees the original parameter names and annotations.

## Related

- [`middleware.md`](middleware.md) — what happens to exceptions and timeouts
- [`manifest.md`](manifest.md) — cross-session resource tracking
- Builder App MCP gateway: [`databricks-builder-app/server/mcp_gateway.py`](../../databricks-builder-app/server/mcp_gateway.py)
