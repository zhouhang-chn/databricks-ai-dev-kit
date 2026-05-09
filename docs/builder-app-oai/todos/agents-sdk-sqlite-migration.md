# TODO: Migrate OpenAI Agents SDK Session Storage from SQLite to PostgreSQL

## Issue
The current implementation of the OpenAI Agents SDK runtime (`openai_runtime.py`) uses a local SQLite database (`.openai_agent_sessions.sqlite3`) to persist conversation sessions and rich model memory (including tool calls and raw outputs).

While the application *does* have a PostgreSQL database for general storage, it currently only stores a simplified version of the chat history (user and assistant text messages) for the UI. The specific, detailed execution state required by the SDK is locked in the local SQLite file.

**Problems with the current approach:**
1. **Statelessness**: Local files are ephemeral in containerized or serverless environments (like Databricks Apps). If the app restarts or scales, the agent loses its context/memory.
2. **Isolation**: Sessions are not shared across instances if multiple instances of the server are running.

## Current SQLite Schema
The SDK creates and manages two tables in the SQLite file:

```sql
CREATE TABLE agent_sessions (
    session_id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    message_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES agent_sessions (session_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_agent_messages_session_id
    ON agent_messages (session_id, id);
```

## Proposed Design for PostgreSQL Integration

To support stateless deployments and maintain multi-project support within a single schema, we propose replicating this structure in PostgreSQL using SQLAlchemy and Alembic.

### 1. Database Schema
We will create two new tables in the PostgreSQL schema (controlled by `LAKEBASE_SCHEMA_NAME`):

#### Table: `agent_sessions`
- `session_id`: `String(255)` (Primary Key) -> Format: `builder:{project_id}:{conversation_id}`
- `project_id`: `String(50)` (Indexed, Foreign Key to `projects.id`) -> Added for multi-project management and easy cleanup.
- `created_at`: `DateTime` (Default: UTC now)
- `updated_at`: `DateTime` (Default: UTC now, on update: UTC now)

#### Table: `agent_messages`
- `id`: `Integer` (Primary Key, Autoincrement)
- `session_id`: `String(255)` (Foreign Key to `agent_sessions.session_id` on delete CASCADE)
- `message_data`: `Text` or `JSON` -> To store the rich JSON payload from the SDK.
- `created_at`: `DateTime` (Default: UTC now)

### 2. Implementation Plan

#### Step 1: Define SQLAlchemy Models
- Add `AgentSession` and `AgentMessage` models to `server/db/models.py` (or a dedicated file).
- Ensure they use the existing `Base` class.

#### Step 2: Generate Alembic Migration
- Run the migration generation command:
  ```bash
  uv run alembic revision --autogenerate -m "create_agent_sessions_and_messages_tables"
  ```
- Review the generated migration to ensure it targets the correct schema.

#### Step 3: Implement Custom Session Wrapper
- Since the `agents` library does not have a built-in `SQLAlchemySession`, we need to implement a custom session class in `server/services/agent_runtime/openai_sessions.py`.
- This class must mimic the interface of `SQLiteSession` (e.g., having methods to get/set messages) but use `get_session_factory()` from `server/db/database.py` to perform async CRUD operations on the PostgreSQL tables.

#### Step 4: Update Factory Function
- Update `get_openai_session` in `openai_sessions.py` to return the new custom PostgreSQL session when `LAKEBASE_PG_URL` is configured, falling back to SQLite for local development without Postgres.

## Verification Checklist
- [x] Check if `agents` library has native SQLAlchemy support (Result: No, needs custom wrapper).
- [x] Check if schema supports multiple projects (Result: Yes, and we will add `project_id` to the session table to make it even more explicit).
- [ ] Implement Models.
- [ ] Run Migration.
- [ ] Implement Wrapper.
- [ ] Test end-to-end.
