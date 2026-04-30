# databricks-mcp-server

`databricks-mcp-server` is the [FastMCP](https://github.com/jlowin/fastmcp) server that exposes `databricks-tools-core` to AI assistants over the Model Context Protocol. It runs over stdio for local clients (Claude Code, Cursor, …) and can also be served over HTTP via the Builder App's MCP gateway when deployed with `--enable-mcp`.

The server is intentionally thin: each tool module forwards to the corresponding domain in `databricks-tools-core`. The work the server *does* is in three places:

1. **Server bootstrap and event-loop patches** (`server.py`) — Windows subprocess fixes and the `asyncio.to_thread` wrapper that prevents stdio deadlocks.
2. **Cross-cutting middleware** (`middleware.py`) — converts timeouts and exceptions into actionable JSON for the agent, and patches up FastMCP's `structured_content` field.
3. **Resource manifest** (`manifest.py`) — a project-local JSON file (`.databricks-resources.json`) that lets agents see what was created in earlier sessions.

> If you need to add or change a tool, look at its sibling page under `../tools/` first — most logic belongs in `databricks-tools-core`. The MCP module should be a thin shape-shift that consolidates several core functions into a single agent-friendly tool.

## Contents

| Page | Topic |
|------|-------|
| [architecture.md](architecture.md) | Process model, transport, FastMCP wiring, Windows/event-loop patches |
| [middleware.md](middleware.md) | Timeout, error, cancellation, and `structured_content` handling |
| [manifest.md](manifest.md) | The `.databricks-resources.json` resource tracking system |
| [tools.md](tools.md) | Reference for every `@mcp.tool` exposed by the server |
| [conventions.md](conventions.md) | Tool design patterns: action dispatch, idempotency, output shapes |
| [client-setup.md](client-setup.md) | Wiring the server into Claude Code, Cursor, the Builder App, and the MCP gateway |
| [development.md](development.md) | Adding a new tool, testing, debugging |

## Source layout

```
databricks-mcp-server/
├── run_server.py            # Entry point: stdio transport bootstrap
├── setup.sh                 # Local install (editable core + server into .venv)
└── databricks_mcp_server/
    ├── __init__.py
    ├── server.py            # FastMCP init, subprocess patch (Windows), to_thread wrapper
    ├── middleware.py        # TimeoutHandlingMiddleware
    ├── manifest.py          # .databricks-resources.json read/write + deleter registry
    └── tools/               # @mcp.tool registrations (one module per domain)
        ├── sql.py            unity_catalog.py     vector_search.py
        ├── jobs.py           volume_files.py      lakebase.py
        ├── compute.py        file.py              workspace.py
        ├── pipelines.py      apps.py              user.py
        ├── serving.py        agent_bricks.py      manifest.py
        ├── pdf.py            aibi_dashboards.py   genie.py
```

## Where things forward to

| MCP tool module | Backed by |
|-----------------|-----------|
| `tools/sql.py` | `databricks_tools_core.sql` |
| `tools/jobs.py` | `databricks_tools_core.jobs` |
| `tools/compute.py` | `databricks_tools_core.compute` |
| `tools/pipelines.py` | `databricks_tools_core.spark_declarative_pipelines` |
| `tools/unity_catalog.py` | `databricks_tools_core.unity_catalog` (catalogs/schemas/tables/volumes/grants/storage/connections/tags/security policies/monitors/sharing/metric views) |
| `tools/volume_files.py` | `databricks_tools_core.unity_catalog.volume_files` |
| `tools/file.py` | `databricks_tools_core.file` |
| `tools/serving.py` | `databricks_tools_core.serving` |
| `tools/vector_search.py` | `databricks_tools_core.vector_search` |
| `tools/lakebase.py` | `databricks_tools_core.lakebase` + `lakebase_autoscale` (one tool spans both) |
| `tools/aibi_dashboards.py` | `databricks_tools_core.aibi_dashboards` |
| `tools/agent_bricks.py` | `databricks_tools_core.agent_bricks` (KA + MAS) |
| `tools/genie.py` | `databricks_tools_core.agent_bricks` (Genie spaces) plus a hot-path `ask_genie` |
| `tools/apps.py` | `databricks_tools_core.apps` |
| `tools/pdf.py` | `databricks_tools_core.pdf` |
| `tools/user.py` | `databricks_tools_core.auth.get_current_username` |
| `tools/workspace.py` | `databricks_tools_core.auth.set_active_workspace` + local `~/.databrickscfg` |
| `tools/manifest.py` | local `.databricks-resources.json` |

See [tools.md](tools.md) for per-tool documentation including action sets and parameter shapes.
