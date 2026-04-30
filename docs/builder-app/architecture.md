# Architecture

The Builder App is a single FastAPI application that serves REST APIs, the production React build, and optionally a Streamable HTTP MCP endpoint. The development setup runs the backend and Vite as separate processes.

## Process Model

```
Browser
  |
  | /api/*, /mcp*, static assets
  v
FastAPI app: server.app:app
  |
  | REST routers, static build, optional MCP ASGI wrapper
  v
Agent service
  |
  | ClaudeSDKClient in a fresh event loop thread
  v
Claude Code subprocess
  |
  | built-in tools + in-process MCP tools
  v
Databricks workspace and project filesystem
```

The backend deliberately separates the HTTP request loop from the Claude Agent SDK loop. `server/services/agent.py` starts a dedicated thread, creates a fresh asyncio event loop, copies `contextvars`, and runs `ClaudeSDKClient` there. This works around subprocess transport issues seen when the SDK runs directly in the FastAPI/uvicorn event loop.

## Startup Flow

`server/app.py` performs startup in the FastAPI lifespan handler:

1. Load `.env.local` if present. If it exists and `ENV` is not set, default to `development`; otherwise default to `production`.
2. Copy skills from the detected source directories into the app cache.
3. Initialize PostgreSQL/Lakebase if a supported database configuration is present.
4. Start Lakebase OAuth token refresh when using dynamic token mode.
5. Run Alembic migrations in a background thread.
6. Start the project backup worker.
7. If `ENABLE_MCP_GATEWAY=true`, start the MCP ASGI app's lifespan.

Shutdown stops the MCP lifespan task, Lakebase token refresh, and the backup worker.

## HTTP Surface

FastAPI mounts routers under `/api`:

- `/api/config/*` for user info, health, system prompt preview, and MLflow status
- `/api/projects*` for project CRUD
- `/api/projects/{project_id}/conversations*` for conversation CRUD and execution lookup
- `/api/invoke_agent`, `/api/stream_progress/{execution_id}`, and `/api/stop_stream/{execution_id}` for agent execution
- `/api/projects/{project_id}/skills/*` for skill management and inspection
- `/api/clusters` and `/api/warehouses` for Databricks resource selectors

When the React production build exists under `client/out`, FastAPI serves it as a static SPA. Non-API and non-MCP 404s fall back to `index.html`.

When `ENABLE_MCP_GATEWAY=true`, `server/app.py` replaces the exported ASGI callable with a wrapper that routes `/mcp*` to `server/mcp_gateway.py` and everything else to the FastAPI app.

## Agent Execution Flow

The backend uses a two-step API so browser connections can survive long-running work:

1. `POST /api/invoke_agent`
   - Validates the current user.
   - Verifies the project belongs to that user.
   - Creates a conversation if needed.
   - Reads enabled skills from the project filesystem.
   - Creates an `ActiveStream` and execution ID.
   - Starts the agent in the background.
   - Returns `{ execution_id, conversation_id }` immediately.

2. `POST /api/stream_progress/{execution_id}`
   - Streams accumulated events as Server-Sent Events.
   - Runs for up to 50 seconds.
   - Emits `stream.reconnect` with the latest cursor when the window expires.
   - Emits `[DONE]` when the execution is complete.

3. `POST /api/stop_stream/{execution_id}`
   - Marks the active stream as cancelled.
   - Cancels the background task when possible.
   - Emits stream cancellation/completion events.

The `ActiveStreamManager` keeps current execution state in memory and persists execution events to PostgreSQL in batches. The client can reconnect after navigation or refresh by loading `/api/projects/{project_id}/conversations/{conversation_id}/executions`.

## Claude Agent Options

`stream_agent_response()` builds `ClaudeAgentOptions` with:

- `cwd` set to the project directory under `PROJECTS_BASE_DIR`
- `allowed_tools` containing built-in tools and filtered Databricks MCP tools
- `permission_mode='bypassPermissions'`
- `mcp_servers={'databricks': databricks_server}`
- `system_prompt` generated from selected cluster, warehouse, catalog/schema, workspace folder, workspace URL, and enabled skills
- `setting_sources=['user', 'project']` so project skills are visible
- `include_partial_messages=True` for token-level streaming
- `env` populated with Databricks FMAPI/Anthropic-compatible settings and SDK attribution variables

The app currently allows these built-in Claude Code tools:

| Tool | Purpose |
|------|---------|
| `Read` | Read files in the project working directory |
| `Write` | Create or replace project files |
| `Edit` | Modify project files |
| `Glob` | Find files by glob pattern |
| `Grep` | Search text in project files |
| `Skill` | Load installed skills when at least one skill is enabled |

`Bash` is intentionally not in the active built-in tools list.

## Databricks Tool Loading

The app loads Databricks MCP tools in process:

- `server/services/databricks_tools.py` loads tools from `databricks-mcp-server`
- `server/services/agent.py` caches the server and tool names
- Skill settings are used to filter which MCP tools are registered for each run

Filtering is applied by creating a filtered MCP server, not only by changing `allowed_tools`. This matters because `bypassPermissions` exposes all tools registered on an MCP server.

## Skills Lifecycle

Skills exist at three levels:

1. Source skills from `databricks-builder-app/.claude/skills`, `../databricks-skills`, or deployed `databricks-builder-app/skills`
2. App cache at `databricks-builder-app/skills`
3. Project copy at `<PROJECTS_BASE_DIR>/<project_id>/.claude/skills`

Startup copies source skills to the app cache. Before each agent run, project skills are synced from the cache based on the project's enabled skill list. A project can store `enabled_skills.json`; `null` means all skills are enabled.

## Stream Event Types

The backend normalizes SDK and tool output into event dictionaries:

| Event type | Meaning |
|------------|---------|
| `conversation.created` | A new conversation was created for an invocation without `conversation_id` |
| `text_delta` | Token-level assistant text |
| `text` | Complete assistant text block |
| `thinking` / `thinking_delta` | Thinking content from the model |
| `tool_use` | Tool call started, including tool name and input |
| `tool_result` | Tool result or error content |
| `todos` | `TodoWrite` content extracted for the UI |
| `system` | SDK system message, including init/session data |
| `result` | Final SDK result metadata such as session ID and duration |
| `keepalive` | No activity for the keepalive interval while work continues |
| `cancelled` | Agent acknowledged cancellation |
| `error` | Backend, SDK, or tool error |
| `stream.reconnect` | The SSE window is ending; client should reconnect with cursor |
| `stream.completed` | Execution has ended |

## Failure Behavior

The app treats `Stream closed` as a known agent/tool transport failure mode and rewrites it into clearer user-facing messages. Long operations are kept alive with backend `keepalive` events and 50-second SSE windows, but subprocess or MCP transport failures can still require a new conversation.

If PostgreSQL is unavailable, startup logs a warning and the app can continue with reduced persistence. Project/conversation APIs that require storage will still fail when database sessions cannot be created.

