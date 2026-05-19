# Databricks Builder App OAI

OpenAI Agents SDK port of the Databricks Builder App. The app provides a React chat UI, a FastAPI backend, Lakebase conversation storage, and project-scoped Databricks tools for building Databricks resources.

## Runtime

The primary model path is a Databricks AI Gateway OpenAI-compatible endpoint configured through environment variables:

```bash
OPENAI_BASE_URL=https://your-ai-gateway.example.com/openai/v1
OPENAI_API_KEY=your-ai-gateway-api-key
OPENAI_AGENT_MODEL=deepseek-v4-pro
OPENAI_TITLE_MODEL=deepseek-v4-flash
OPENAI_AGENTS_DISABLE_TRACING=1
```

`deepseek-v4-pro` is used for agent work. `deepseek-v4-flash` is used for cheaper metadata tasks such as title generation.

Follow-up suggestions come from the terminal `submit_conclusion.next_steps` payload and render as clickable chips under the answer. The app does not run a separate post-response Next Moves generator, which avoids an extra model call and keeps the visible follow-ups consistent with the final synthesis.

SQL schema checks are conversation-aware. The runtime still blocks analytical SQL over configured project tables when no schema is known, but a successful prior `get_table_stats_and_schema`, `DESCRIBE`, or `SHOW COLUMNS` event in the same conversation seeds the next run so repeated follow-up questions do not re-inspect the same table.

Analysis visualizations are model-directed when a conclusion includes `visualizations`. The middle story card prioritizes specs marked `display_in_story`, while the Inspect panel retains secondary evidence. Auto-detected charts are conservative fallbacks and avoid measure-only result sets where a calculated count/rate would become the x-axis.

## Local Development

```bash
cd databricks-builder-app-oai
./scripts/start_local.sh --profile <databricks-profile>
```

The script provisions Lakebase unless `--skip-lakebase` is passed, creates `.env.local`, installs backend dependencies with `uv`, installs frontend dependencies with `npm`, and starts:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`

Set `OPENAI_BASE_URL` and `OPENAI_API_KEY` in the shell before running the script, or edit `.env.local` after generation.

## Deploy

```bash
cd databricks-builder-app-oai
OPENAI_BASE_URL=<ai-gateway-url> \
OPENAI_API_KEY=<ai-gateway-key> \
./scripts/deploy.sh <app-name> --profile <databricks-profile>
```

The deploy script builds the frontend with `npm`, stages the FastAPI app, installs skills, generates `app.yaml`, deploys the Databricks App, and grants Lakebase permissions.

## Project Model

- Project files live under `projects/<project_id>/`.
- Skills are copied into `.agents/skills/`.
- Legacy `.claude/skills/` folders are read only as a migration fallback.
- Conversation history and stream events are stored in Lakebase/PostgreSQL.
- OpenAI Agents SDK session state is stored in a local SQLite database under the configured projects directory.

## Tooling

The app exposes a conservative OpenAI function-tool set first:

- project file tools with path traversal and symlink escape checks
- SQL execution helpers
- SQL warehouse listing and best-warehouse selection
- compute listing
- background operation status helpers

Model credentials and Databricks credentials are intentionally separate. Databricks tools use per-request Databricks auth context and do not receive model API keys.

## Optional MCP Gateway

Set `ENABLE_MCP_GATEWAY=true` to mount the MCP gateway at `/mcp` for external MCP clients. This is separate from the in-process OpenAI Agents SDK runtime.
