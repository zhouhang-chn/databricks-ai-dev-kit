# Persistence

The Builder App persists metadata, chat history, execution state, and project file backups in PostgreSQL. Lakebase is the intended production database.

## Tables

SQLAlchemy models are defined in `server/db/models.py`.

| Table | Model | Purpose |
|-------|-------|---------|
| `projects` | `Project` | User-scoped project records |
| `conversations` | `Conversation` | Claude Code sessions within a project |
| `messages` | `Message` | User and assistant messages |
| `project_backup` | `ProjectBackup` | Zipped project filesystem backup |
| `executions` | `Execution` | Running and recent agent stream events |

## Project

Important fields:

| Field | Purpose |
|-------|---------|
| `id` | UUID string used as filesystem directory name |
| `name` | Display name |
| `user_email` | Ownership boundary for all project CRUD |
| `created_at` | Sort key |

Project queries always include `Project.user_email == current_user`.

## Conversation

Important fields:

| Field | Purpose |
|-------|---------|
| `session_id` | Claude Agent SDK session ID used for resume |
| `cluster_id` | Selected Databricks cluster for code execution |
| `default_catalog` / `default_schema` | Default Unity Catalog context injected into the system prompt |
| `warehouse_id` | Selected SQL warehouse for SQL tool calls |
| `workspace_folder` | Remote workspace folder for uploads |

The UI restores these fields when a conversation is selected.

## Message

Messages store:

- `role`: `user` or `assistant`
- `content`: Markdown/plain text
- `timestamp`
- `is_error`

Messages are saved after an agent stream completes unless the stream was cancelled. The frontend also renders optimistic local messages while streaming; the persisted conversation is fetched again when streaming finishes.

## Execution

Executions make long-running streams reconnectable.

| Field | Purpose |
|-------|---------|
| `id` | Execution ID returned by `/api/invoke_agent` |
| `conversation_id` / `project_id` | Ownership and lookup |
| `status` | `running`, `completed`, `cancelled`, or `error` |
| `events_json` | JSON array of streamed events |
| `error` | Final error text, if any |

`ActiveStreamManager` stores current events in memory and persists them when:

- at least 10 events are pending, or
- at least 5 seconds have elapsed since the last persistence pass, or
- the stream finishes.

Completed in-memory streams are cleaned after five minutes.

## Project Files

Each project has a filesystem directory:

```text
<PROJECTS_BASE_DIR>/<project_id>/
|-- CLAUDE.md
`-- .claude/
    |-- enabled_skills.json
    `-- skills/
```

`PROJECTS_BASE_DIR` defaults to `./projects`.

When a project directory is requested, `ensure_project_directory()`:

1. Attempts to restore a missing directory from `project_backup`.
2. Creates the directory if no backup exists.
3. Copies project skills if needed.
4. Creates a default `CLAUDE.md` if missing.

## Backups

`server/services/backup_manager.py` runs a background backup worker when the database initializes successfully.

Behavior:

- Agent completion calls `mark_for_backup(project_id)`.
- The worker wakes every 10 minutes.
- Pending project directories are zipped in memory.
- The zip is upserted into `project_backup`.

Backups are best-effort. If a project directory has no files, no backup row is written.

## Database Connection Modes

`server/db/database.py` supports three modes.

### Static URL

```bash
LAKEBASE_PG_URL=postgresql://user:password@host:5432/databricks_postgres?sslmode=require
```

The app rewrites `postgresql://` to `postgresql+psycopg://` for async SQLAlchemy.

### Lakebase Autoscale OAuth

```bash
LAKEBASE_ENDPOINT=projects/<project>/branches/production/endpoints/primary
LAKEBASE_DATABASE_NAME=databricks_postgres
```

The app uses `WorkspaceClient().postgres.generate_database_credential(endpoint=...)`.

### Provisioned Lakebase OAuth

```bash
LAKEBASE_INSTANCE_NAME=<instance-name>
LAKEBASE_DATABASE_NAME=databricks_postgres
```

The app uses `WorkspaceClient().database.generate_database_credential(instance_names=[...])`.

## Optional DB Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `LAKEBASE_SCHEMA_NAME` | `builder_app` | PostgreSQL search path schema |
| `LAKEBASE_USERNAME` | current user or instance name | DB username override |
| `LAKEBASE_HOST` | resolved from Lakebase metadata | DB host override |
| `DATABRICKS_DATABASE_PORT` | `5432` | DB port |
| `DB_POOL_SIZE` | `5` | SQLAlchemy pool size |
| `DB_MAX_OVERFLOW` | `10` | Extra pooled connections |
| `DB_POOL_RECYCLE_INTERVAL` | `3600` | Connection recycle seconds |
| `DB_POOL_TIMEOUT` | `10` | Pool checkout timeout seconds |
| `DB_SESSION_MAX_RETRIES` | `3` | Session retry attempts |
| `DB_SESSION_RETRY_DELAY` | `1.0` | Base retry delay seconds |

## Migrations

Migrations live in `databricks-builder-app/alembic/versions/`.

Startup calls `run_migrations()` in a background thread after DB initialization. For manual work:

```bash
cd databricks-builder-app
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

Before creating an autogenerated migration, make sure your local `.env.local` points at the intended development database.

## Operational Notes

- The app can start without a configured database, but project and conversation persistence require the database.
- Lakebase Autoscale can take time to resume from zero. Initial local startup may fail its connection check if compute is still waking.
- PostgreSQL grants must cover both existing and future tables/sequences in `builder_app`.
- `project_backup` stores zipped bytes in the database. Large generated project directories increase database storage.
