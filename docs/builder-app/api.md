# API Reference

All REST routes are mounted under `/api`. The Vite client talks to these routes through the dev proxy locally and through the same FastAPI host in production.

## Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config/me` | Current user, workspace URL, Lakebase config status, Lakebase error if any |
| `GET` | `/api/config/health` | Health check |
| `GET` | `/api/config/system_prompt` | Preview generated system prompt |
| `GET` | `/api/config/mlflow/status` | MLflow tracing status |

`GET /api/config/system_prompt` accepts optional query parameters:

- `cluster_id`
- `warehouse_id`
- `default_catalog`
- `default_schema`
- `workspace_folder`
- `project_id`

When `project_id` is provided, the endpoint reads the project's enabled skills before generating the prompt.

## Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List projects for current user |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/{project_id}` | Get one project |
| `PATCH` | `/api/projects/{project_id}` | Rename project |
| `DELETE` | `/api/projects/{project_id}` | Delete project and conversations |

Create/rename body:

```json
{
  "name": "My Project"
}
```

Project response:

```json
{
  "id": "uuid",
  "name": "My Project",
  "user_email": "user@example.com",
  "created_at": "2026-04-30T00:00:00+00:00",
  "conversation_count": 3
}
```

## Conversations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/{project_id}/conversations` | List conversation summaries |
| `POST` | `/api/projects/{project_id}/conversations` | Create conversation |
| `GET` | `/api/projects/{project_id}/conversations/{conversation_id}` | Get conversation with messages |
| `PATCH` | `/api/projects/{project_id}/conversations/{conversation_id}` | Rename conversation |
| `DELETE` | `/api/projects/{project_id}/conversations/{conversation_id}` | Delete conversation and messages |
| `GET` | `/api/projects/{project_id}/conversations/{conversation_id}/executions` | Get active and recent executions |

Create/rename body:

```json
{
  "title": "New Conversation"
}
```

Full conversation response includes `messages`. List responses include `message_count` instead.

## Databricks Resource Selectors

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/clusters` | List clusters sorted for UI selection |
| `GET` | `/api/warehouses` | List SQL warehouses sorted for UI selection |

Both endpoints validate the user, set the Databricks auth context for the request, call cached async service helpers, and clear the auth context before returning.

## Agent Invocation

`POST /api/invoke_agent` starts an agent run and returns immediately.

Request body:

```json
{
  "project_id": "uuid",
  "conversation_id": "uuid-or-null",
  "message": "Create a dashboard for my table",
  "cluster_id": "optional-cluster-id",
  "default_catalog": "ai_dev_kit",
  "default_schema": "user_project",
  "warehouse_id": "optional-warehouse-id",
  "workspace_folder": "/Workspace/Users/user@example.com/ai_dev_kit/project",
  "mlflow_experiment_name": "/Workspace/Users/user@example.com/builder_traces",
  "target_databricks_host": "https://target-workspace.cloud.databricks.com",
  "target_databricks_token": "optional-target-token"
}
```

Response:

```json
{
  "execution_id": "uuid",
  "conversation_id": "uuid"
}
```

If `conversation_id` is omitted, the backend creates a conversation and emits a `conversation.created` stream event.

## Streaming Progress

`POST /api/stream_progress/{execution_id}` returns Server-Sent Events.

Request body:

```json
{
  "last_event_timestamp": 1714435200.123
}
```

Set `last_event_timestamp` to `null` or omit it for the first request.

SSE payload format:

```text
data: {"type":"text_delta","text":"hello","_cursor":1714435200.123}

data: [DONE]
```

The endpoint streams for up to 50 seconds. If the execution is still running, it emits:

```json
{
  "type": "stream.reconnect",
  "execution_id": "uuid",
  "last_timestamp": 1714435250.456,
  "message": "Reconnect to continue streaming"
}
```

The client should call the same endpoint again with that cursor.

## Stop Execution

`POST /api/stop_stream/{execution_id}`

Response:

```json
{
  "success": true,
  "message": "Stream cancelled"
}
```

If the stream is already complete, `success` is `false`.

## Stream Events

| Type | Key fields | Client behavior |
|------|------------|-----------------|
| `conversation.created` | `conversation_id` | Move optimistic stream state to the real conversation |
| `text_delta` | `text` | Append token text |
| `text` | `text` | Append complete text block |
| `thinking` | `thinking` | Add activity item |
| `thinking_delta` | `thinking` | Append to current thinking item |
| `tool_use` | `tool_id`, `tool_name`, `tool_input` | Add active tool activity |
| `tool_result` | `tool_use_id`, `content`, `is_error` | Add tool result activity |
| `todos` | `todos` | Update loader todo display |
| `system` | `subtype`, `data` | Internal/session metadata |
| `result` | `session_id`, `duration_ms`, `total_cost_usd`, `num_turns`, `is_error` | Final SDK metadata |
| `keepalive` | `elapsed_since_last_event` | Keep UI connected during long work |
| `cancelled` | none | Notify user generation stopped |
| `error` | `error` | Show error toast |
| `stream.reconnect` | `execution_id`, `last_timestamp` | Reconnect SSE |
| `stream.completed` | `is_error`, `is_cancelled` | Finish stream |

## Project Files

`GET /api/projects/{project_id}/files` lists files under the project directory:

```json
{
  "project_id": "uuid",
  "files": [
    {
      "path": "CLAUDE.md",
      "name": "CLAUDE.md",
      "size": 1234,
      "modified": "2026-04-30T00:00:00"
    }
  ]
}
```

## Skills

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/{project_id}/skills/tree` | Project skills file tree |
| `GET` | `/api/projects/{project_id}/skills/file?path=...` | Read a skill file |
| `GET` | `/api/projects/{project_id}/skills/available` | Skills with enabled flags |
| `PUT` | `/api/projects/{project_id}/skills/enabled` | Update enabled skills |
| `POST` | `/api/projects/{project_id}/skills/reload` | Resync project skills |

Update enabled skills body:

```json
{
  "enabled_skills": ["databricks-python-sdk", "databricks-vector-search"]
}
```

`enabled_skills: null` means all skills are enabled. The UI prevents disabling every skill.

## Error Handling

The API raises `404` when user-scoped resources are missing. Unhandled exceptions are logged by the global exception handler and returned as:

```json
{
  "detail": "Internal Server Error",
  "error": "..."
}
```

Streaming errors are usually emitted as SSE `error` events so the client can display the failure without losing prior streamed content.

