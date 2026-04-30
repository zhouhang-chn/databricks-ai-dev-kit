# Frontend

The frontend is a React 18, TypeScript, Vite, and Tailwind application in `databricks-builder-app/client`.

## Routes

Routes are declared in `client/src/App.tsx`:

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `HomePage` | Project list, project creation, sorting, rename, delete |
| `/projects/:projectId` | `ProjectPage` | Chat UI, conversations, resource config, streaming, skills explorer |
| `/doc` | `DocPage` | In-app docs page |
| `*` | redirect to `/` | Fallback |

The production backend serves the Vite build as an SPA and falls back to `index.html` for non-API routes.

## API Client

`client/src/lib/api.ts` centralizes all backend calls.

Key behavior:

- `API_BASE` is `/api`.
- Requests include `Content-Type: application/json`.
- Requests use `credentials: 'include'`.
- Non-2xx responses attempt to parse JSON and throw an `Error`.
- `invokeAgent()` calls `/invoke_agent`, then streams `/stream_progress/{execution_id}` until done.
- `streamProgress()` automatically reconnects when it receives `stream.reconnect`.

Development proxy is configured in `client/vite.config.ts`:

```ts
server: {
  port: 3000,
  proxy: {
    "/api": {
      target: "http://127.0.0.1:8000",
      changeOrigin: true,
    },
  },
}
```

## Contexts

| Context | File | Responsibility |
|---------|------|----------------|
| `UserProvider` | `src/contexts/UserContext.tsx` | Loads `/api/config/me` once and exposes user, workspace URL, and Lakebase status |
| `ProjectsProvider` | `src/contexts/ProjectsContext.tsx` | Loads project list and provides create, delete, rename, and refresh helpers |

## Home Page

`HomePage` displays projects and lets users:

- Create a new project
- Sort by recency or conversation count
- Rename a project inline
- Delete a project
- Navigate into a project

Project cards use deterministic colors derived from project ID.

## Project Page

`ProjectPage` is the main chat workspace.

On load, it fetches in parallel:

- Project metadata
- Conversations
- Clusters
- Warehouses

If conversations exist, it loads the newest conversation and restores:

- selected cluster
- selected warehouse
- default catalog/schema
- workspace folder

If no persisted values exist, it chooses first available cluster/warehouse and derives defaults from the user email and project name.

## Resource Configuration

The settings panel controls:

- Default catalog and schema
- Databricks cluster
- SQL warehouse
- Workspace folder
- MLflow experiment name

These values are sent with `invokeAgent()` and persisted back to the conversation after the run completes.

## Streaming State

`ProjectPage` supports more than one conversation streaming at the same time. It tracks streams in `allStreamsRef`, keyed by conversation ID.

Each stream stores:

- accumulated assistant text
- activity items
- todos
- tools used
- execution ID
- abort controller
- reconnecting state
- optimistic pending messages

When an invocation starts without a conversation, the stream is temporarily keyed by an empty string. When `conversation.created` arrives, the client moves that stream to the real conversation ID.

## Reconnection

When a conversation loads, `ProjectPage` checks:

```text
GET /api/projects/{project_id}/conversations/{conversation_id}/executions
```

If an active execution exists:

1. Stored events are replayed into the UI.
2. The client reconnects to `/api/stream_progress/{execution_id}`.
3. The final conversation is fetched after completion.

This is why execution event persistence matters even though the active stream is also in memory.

## Skills Explorer

`SkillsExplorer` is a modal for:

- Viewing the generated system prompt
- Enabling/disabling skills for the project
- Reloading project skills from the app cache
- Browsing project `.claude/skills` files
- Viewing Markdown files rendered or raw

Skill enablement calls:

- `GET /projects/{project_id}/skills/available`
- `PUT /projects/{project_id}/skills/enabled`
- `POST /projects/{project_id}/skills/reload`
- `GET /config/system_prompt?...`

The UI prevents disabling all skills. `null` means all skills are enabled.

## Frontend Commands

```bash
cd databricks-builder-app/client
pnpm install
pnpm dev
pnpm lint
pnpm build:typecheck
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

Do not introduce npm lockfiles in this pnpm-based workflow.

## Browser Test Preflight

Before running browser or frontend tests, check both services:

```bash
curl -fsS http://127.0.0.1:8000/api/config/health
curl -fsS http://127.0.0.1:3000/
```

For preview tests:

```bash
curl -fsS http://127.0.0.1:8000/api/config/health
curl -fsS http://127.0.0.1:4173/
```

`pnpm preview` serves static files only. API-backed browser tests should either use Vite dev on port 3000, where `/api` is proxied to the backend, or run FastAPI with `client/out` present so the backend serves the production build.

## UI Error Handling

The client displays errors with `sonner` toasts. Known stream transport failures containing `Stream closed` are rewritten into clearer messages for tool results and top-level stream errors.

The optimistic streaming UI is cleared on completion, cancellation, or error. After normal completion, the persisted conversation is fetched again so titles, messages, and stored config match the backend.
