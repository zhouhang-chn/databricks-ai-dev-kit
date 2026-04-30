# Databricks Builder App

The Builder App is the local and Databricks Apps web UI for running a Claude Code agent with the AI Dev Kit's Databricks tools and skills. It combines:

- A React/Vite client in `databricks-builder-app/client/`
- A FastAPI backend in `databricks-builder-app/server/`
- In-process MCP tools loaded from `databricks-mcp-server`
- Skill packages copied from `databricks-skills/`
- PostgreSQL/Lakebase storage for projects, conversations, messages, executions, and project file backups
- Optional Streamable HTTP MCP gateway at `/mcp`

This docs section is for engineers maintaining the app. The app-level README remains the user-facing quick start.

## Contents

| Page | Topic |
|------|-------|
| [architecture.md](architecture.md) | Runtime model, startup flow, agent execution, streaming, skills, and tool filtering |
| [local-development.md](local-development.md) | Local setup, manual commands, environment variables, service checks, and debugging |
| [deployment.md](deployment.md) | Databricks Apps deployment, Lakebase provisioning, packaging, redeploys, and cleanup |
| [authentication.md](authentication.md) | User identity, Databricks tokens, FMAPI tokens, tool auth context, and cross-workspace mode |
| [persistence.md](persistence.md) | Database models, Lakebase connection modes, migrations, project directories, and backups |
| [api.md](api.md) | REST and SSE endpoints, request bodies, response shapes, and stream events |
| [frontend.md](frontend.md) | React routes, client state, API client behavior, streaming UI, and frontend commands |
| [mcp-gateway.md](mcp-gateway.md) | Optional HTTP MCP gateway, diagnostic routes, auth middleware, and client setup |

## Source Layout

```
databricks-builder-app/
|-- server/
|   |-- app.py                  # FastAPI app, startup/shutdown, router mount, static files, MCP gateway switch
|   |-- db/                     # SQLAlchemy models, async engine, Lakebase token refresh, migrations helper
|   |-- routers/                # REST API endpoints
|   |-- services/               # Agent, auth, storage, skills, backup, Databricks resource helpers
|   `-- mcp_gateway.py          # Optional Streamable HTTP MCP gateway at /mcp
|-- client/
|   |-- src/pages/              # HomePage, ProjectPage, DocPage
|   |-- src/components/         # Layout, skills explorer, loaders, UI primitives
|   |-- src/contexts/           # User and projects context
|   `-- src/lib/                # API client and shared TypeScript types
|-- alembic/                    # PostgreSQL migrations
|-- scripts/
|   |-- start_local.sh          # End-to-end local bootstrap and dev server launcher
|   `-- deploy.sh               # End-to-end Databricks Apps deployment
|-- databricks.yml              # Lakebase Autoscale Asset Bundle
|-- app.yaml.example            # Manual Databricks Apps config template
|-- pyproject.toml              # Python package metadata and dev dependencies
`-- requirements.txt            # Locked deployment dependencies
```

## Runtime Summary

1. The React client calls `/api/*` through Vite's dev proxy locally, or through the same FastAPI app in production.
2. FastAPI resolves the caller identity, Databricks workspace URL, and tokens from headers or local environment.
3. Project and conversation state are loaded from PostgreSQL, scoped by user email.
4. `/api/invoke_agent` creates an execution record and starts the Claude agent in a background task.
5. The agent runs in a fresh event loop in a separate thread, with copied contextvars for Databricks auth.
6. Agent text, thinking, tool use, tool results, keepalives, and completion events are accumulated in memory and persisted to the `executions` table.
7. The browser calls `/api/stream_progress/{execution_id}` repeatedly. Each response is an SSE window of up to 50 seconds.
8. Completed conversations are persisted to the `messages` table, and project files are queued for background backup.

## Security Boundary

The app scopes projects and conversations by authenticated user, but it does not strongly isolate Claude Code processes between users with container or microVM boundaries. Treat a deployed Builder App as a trusted-user tool. Grant app access only to users who should be allowed to run code and Databricks tools in the configured workspace context.
