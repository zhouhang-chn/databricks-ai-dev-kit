# OpenAI Agents SDK Builder App Action Plan

## Purpose

This action plan turns the OpenAI Agents SDK Builder App analysis and design into
an implementation sequence for `databricks-builder-app-oai`.

The target is a new sibling app, not an in-place rewrite:

```text
databricks-builder-app-oai/
```

The existing `databricks-builder-app/` remains the Claude-based reference
implementation until the OpenAI version is complete and separately validated.

## Source Documents

- Existing analysis: [`analysis.md`](analysis.md)
- Existing design: [`design.md`](design.md)
- Current Builder App docs: [`../builder-app/README.md`](../builder-app/README.md)
- OpenAI Agents SDK docs:
  - [Intro](https://openai.github.io/openai-agents-python/)
  - [Running agents](https://openai.github.io/openai-agents-python/running_agents/)
  - [Streaming](https://openai.github.io/openai-agents-python/streaming/)
  - [Tools](https://openai.github.io/openai-agents-python/tools/)
  - [Sessions](https://openai.github.io/openai-agents-python/sessions/)
  - [MCP](https://openai.github.io/openai-agents-python/mcp/)
  - [Tracing](https://openai.github.io/openai-agents-python/tracing/)
  - [Sandbox agents](https://openai.github.io/openai-agents-python/sandbox_agents/)

## Execution Principles

- Keep `databricks-builder-app/` intact while building
  `databricks-builder-app-oai/`.
- Preserve the current browser API and SSE event contract unless an additive
  change is required.
- Use AI Gateway's OpenAI-compatible endpoint as the standard model path,
  configured through `.env.local` or app secrets with `OPENAI_BASE_URL`,
  `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL=deepseek-v4-pro`, and
  `OPENAI_TITLE_MODEL=deepseek-v4-flash`.
- Enforce tool access by constructing the actual OpenAI tool list per run, not
  by prompt instruction only.
- Keep OpenAI model credentials separate from Databricks tool credentials.
- Do not enable shell execution in MVP.
- Use `pnpm` for `databricks-builder-app-oai` frontend commands.
- Do not introduce new npm lockfiles.
- Before browser or frontend tests, confirm both `127.0.0.1:8000` and the
  frontend server under test are reachable.

## Progress Snapshot

Last updated: 2026-05-07.

This v0.1 plan is retained as migration history. Business-question correctness
work is tracked in [`../v0.2-business-analysis/`](../v0.2-business-analysis/).

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Repository and Docs Setup | Complete | Canonical OAI docs now live under `docs/builder-app-oai/`; this folder tracks v0.1 migration history. |
| Phase 1: Scaffold `databricks-builder-app-oai` | Complete | New sibling app exists with server, client, Alembic, scripts, app config, and package metadata updated. Generated/runtime directories remain ignored. |
| Phase 2: Dependency and Configuration Cutover | Complete | `claude-agent-sdk` and `anthropic` were removed from the new app dependency set; `openai-agents` and AI Gateway/OpenAI env vars were added. |
| Phase 3: Runtime Adapter | Implemented, live run pending | OpenAI runtime adapter, model settings, event normalization, cancellation hook, and SDK session helper are in place. A live AI Gateway run still needs credentials. |
| Phase 4: Project File Tools | Implemented MVP | Explicit project-confined file tools exist with path escape, symlink escape, and size-cap tests. No shell tool is exposed. |
| Phase 5: Runtime-Neutral Skill Registry | Implemented MVP | Existing `skills_manager.py` now writes `.agents/skills`, reads legacy `.claude/skills` only as fallback, renders selected skill guidance, and filters OpenAI/MCP tools by enabled skills. |
| Phase 6: Databricks Tool Adapter | Partial | Core wrappers exist for SQL, SQL warehouses, compute listing, and operation polling. Full Databricks parity and generated schema conversion remain follow-up work. |
| Phase 7: Sessions, Persistence, and Migrations | Partial | Migration/model fields and stable SDK session key exist. The MVP uses `SQLiteSession`; deployed SQL-backed session strategy and live restart validation remain open. |
| Phase 8: Title Generation and Observability | Partial | Title generation now uses OpenAI-compatible chat completions with `OPENAI_TITLE_MODEL=deepseek-v4-flash`. OpenAI tracing disable handling exists; MLflow export policy remains follow-up. |
| Phase 9: Optional MCP Gateway Port | Partial | Gateway starts without Claude SDK imports and applies skill filtering to the MCP tool surface. Gateway tests and external MCP client smoke remain open. |
| Phase 10: Frontend and Documentation Cutover | Mostly complete | In-app docs/copy were updated, `/api/config/runtime` was added, and frontend lint plus build/typecheck pass. Browser workflow tests remain open. |
| Phase 11: Deployment and Release Readiness | Partial | `app.yaml.example`, bundle name, deploy script, local script, and README were updated. Deployed app smoke tests still need a configured workspace and AI Gateway credentials. |

Current verified checks:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests -q
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run python -c "import agents; import server.app; print('openai agents and server import ok')"
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run ruff check server/services/agent.py server/services/agent_runtime server/services/tools server/services/title_generator.py server/routers/config.py server/routers/agent.py server/mcp_gateway.py --select F,E9
cd client
pnpm lint
pnpm build:typecheck
```

Known validation gaps:

- Live AI Gateway invocation is blocked until `OPENAI_BASE_URL` and
  `OPENAI_API_KEY` are available in the environment.
- Live Databricks tool smoke tests are blocked until Databricks auth and a safe
  target warehouse/workspace are configured.
- Browser workflow testing has not been run because backend/frontend servers
  were not started for this docs update.

## Phase 0: Repository and Docs Setup

Goal: make the target path and documentation structure unambiguous.

Tasks:

- Create `databricks-builder-app-oai/` as a sibling of `databricks-builder-app/`.
- Use `docs/builder-app-oai/` as the canonical OAI app docs path.
- Update all links in `docs/README.md`, `docs/builder-app-oai/README.md`, and this
  action plan.
- Add a tracking issue or checklist entry for every open question in
  `design.md`.

Acceptance gates:

- `find docs -maxdepth 2 -type d | sort` shows the intended canonical docs path.
- A repository-wide search for the misspelled docs path returns no results.
- `git status --short` shows only planned files staged for the setup change.

## Phase 1: Scaffold `databricks-builder-app-oai`

Goal: copy the reusable app shell without carrying Claude-specific runtime state.

Tasks:

- Copy reusable app structure from `databricks-builder-app/`:
  - `server/`
  - `client/`
  - `alembic/`
  - `scripts/`
  - `databricks.yml`
  - `app.yaml.example`
  - `pyproject.toml`
  - deployment and local-development support files
- Exclude generated or environment-specific directories:
  - `.venv/`
  - `node_modules/`
  - `client/out/`
  - build caches
  - local `.env*` files containing secrets
- Use `pnpm` for frontend package commands.
- Do not add new npm lockfiles.
- Update package metadata and app labels:
  - Python project name: `databricks-builder-app-oai`
  - FastAPI title and description
  - Databricks Apps name examples
  - frontend visible labels that mention Claude
- Keep the existing REST route shapes and frontend routes for the first pass.

Suggested checks:

```bash
rg -n "Claude|claude|Anthropic|anthropic|ANTHROPIC|claude_agent_sdk" databricks-builder-app-oai
```

Acceptance gates:

- `databricks-builder-app-oai/` imports as a separate app tree.
- Frontend commands documented for the OAI app use `pnpm`.
- No new npm lockfile is introduced by this work.
- Remaining Claude references are documented migration targets, not active
  runtime dependencies.

## Phase 2: Dependency and Configuration Cutover

Goal: make the new app installable with OpenAI Agents SDK dependencies and no
Claude runtime dependency.

Tasks:

- In `databricks-builder-app-oai/pyproject.toml`:
  - remove `claude-agent-sdk`
  - remove `anthropic`
  - add `openai-agents`
  - keep `mcp` and `fastmcp`
  - keep `mlflow` until the tracing path is decided
- Regenerate `requirements.txt` for the new app.
- Add OpenAI-specific environment variables to examples and config docs:
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`
  - `OPENAI_AGENT_MODEL=deepseek-v4-pro`
  - `OPENAI_TITLE_MODEL=deepseek-v4-flash`
  - `OPENAI_AGENTS_DISABLE_TRACING`
  - `BUILDER_AGENT_RUNTIME=openai_agents`
- Remove active use of:
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_MODEL`
  - `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`
  - `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`

Suggested checks:

```bash
cd databricks-builder-app-oai
uv run python -c "import agents; print('openai agents ok')"
uv run python -c "import server.app; print('server import ok')"
```

Acceptance gates:

- Backend imports without `claude_agent_sdk`.
- Backend imports without `anthropic`.
- Config validation fails clearly when the standard AI Gateway profile lacks
  `OPENAI_BASE_URL`, `OPENAI_API_KEY`, or the selected model.
- Secrets are redacted in config diagnostics.

## Phase 3: Runtime Adapter

Goal: introduce an OpenAI runtime behind an app-owned interface.

Tasks:

- Add `server/services/agent_runtime/base.py` with:
  - `AgentRuntime` protocol
  - `AgentRunRequest`
  - normalized event type aliases or typed dictionaries
- Add `server/services/agent_runtime/openai_runtime.py` with:
  - `OpenAIAgentRuntime`
  - OpenAI `Agent` construction
  - `Runner.run_streamed()` execution
  - Databricks auth context setup and cleanup through
    `set_databricks_auth()` and `clear_databricks_auth()` from
    `databricks_tools_core.auth`
  - cancellation checks that call `result.cancel()` on active streamed runs
- Add `server/services/agent_runtime/openai_events.py` to map SDK events into
  current Builder App events:
  - `text_delta`
  - `text`
  - `tool_use`
  - `tool_result`
  - `system`
  - `result`
  - `cancelled`
  - `error`
- Add `server/services/agent_runtime/openai_models.py` for model/provider
  settings.
- Route `/api/invoke_agent` through the runtime interface.
- Keep `ActiveStreamManager` and SSE windowing unchanged unless tests prove an
  SDK-specific issue.
- Treat OpenAI `stream_events()` as non-replayable; the existing
  `ActiveStreamManager` window buffer remains required for stream reconnects.

Unit tests:

- Runtime interface can be exercised with a fake runtime.
- Mocked OpenAI stream events normalize to the existing event vocabulary.
- Cancellation produces one `cancelled` event and clears Databricks auth context.
- Runtime setup does not import `claude_agent_sdk` or `anthropic`.

Acceptance gates:

- A mocked run through `/api/invoke_agent` and `/api/stream_progress/{id}`
  produces text and result events.
- No SDK-specific event leaks to the frontend.

## Phase 4: Project File Tools

Goal: replace Claude Code built-in file tools with explicit OpenAI function
tools.

Tasks:

- Add `server/services/tools/project_files.py`.
- Implement:
  - `read_project_file`
  - `write_project_file`
  - `edit_project_file`
  - `list_project_files`
  - `grep_project_files`
  - `get_project_tree`
- Enforce project-root confinement:
  - reject absolute paths outside the project
  - reject `..` escapes after resolution
  - reject symlinks that resolve outside the project
  - cap file read size
  - cap write size
  - cap grep and tree result counts
- Return structured errors that the model can act on.
- Ensure file writes still trigger existing project backup behavior.

Unit tests:

- Each tool succeeds on valid project-relative paths.
- Path traversal attempts fail.
- Symlink escape attempts fail.
- Oversized reads and writes fail with actionable errors.
- Edit tool validates expected replacement count.

Acceptance gates:

- An OpenAI agent can read, edit, and write a project file in a test project.
- No shell execution tool is exposed.

## Phase 5: Runtime-Neutral Skill Registry

Goal: replace Claude host-managed skill loading with app-owned skill rendering.

Tasks:

- Add or port `server/services/skills_registry.py`.
- Load skills from:
  - `databricks-builder-app-oai/skills`
  - `databricks-skills`
  - optional project `.agents/skills`
  - optional legacy project `.claude/skills` for migration only
- Enforce skill source precedence on name collision:
  project `.agents/skills` > app-bundled `databricks-builder-app-oai/skills` >
  repository `databricks-skills` > legacy project `.claude/skills`.
- Parse `SKILL.md` frontmatter and Markdown content.
- Sync enabled skills into `project/.agents/skills`.
- Render selected skill guidance into the agent instructions.
- Preserve the enabled-skills API and UI behavior.
- Preserve skill-to-tool allowlist behavior.

Unit tests:

- Skill registry loads source skills.
- Disabled skills are omitted from rendered instructions.
- Tool allowlist changes when skills are disabled.
- Rendered guidance stays within configured token or character budget.

Acceptance gates:

- No generic `Skill` tool is exposed in MVP.
- Agent instructions include selected Databricks skill guidance with source
  names.
- Disabled skills remove their tools from the constructed OpenAI tool list.

## Phase 6: Databricks Tool Adapter

Goal: expose Databricks capabilities as OpenAI function tools with parity to the
current app.

Tasks:

- Add `server/services/tools/databricks_openai.py`.
- Implement typed direct `@function_tool` wrappers for core parity tools.
- Use generated FastMCP-derived OpenAI schemas only for coverage gaps after
  schema-fidelity tests pass.
- Preserve existing behavior:
  - copy the `set_databricks_auth()` context into worker threads before running
    sync Databricks tools
  - parse JSON-like string arguments for list/dict fields
  - normalize empty strings to `None`
  - run sync tools in an executor
  - return JSON text or structured output to the model
- Port operation tracking tools:
  - `check_operation_status`
  - `list_operations`
- Preserve async handoff for long-running tools.

Unit tests:

- Tool names match the current Builder App allowlist where expected.
- Typed wrappers expose valid OpenAI function tool schemas.
- FastMCP-derived schema conversion covers `required`, optional/default values,
  `additionalProperties`, nullable fields, and `oneOf`/`anyOf`.
- Disabled skills remove Databricks tools before agent construction.
- Long-running tool handoff returns an operation ID.
- Operation status polling returns completed and failed results.

Optional live smoke tests:

- `execute_sql` against a configured warehouse.
- volume file list against a safe test volume.
- compute list against the configured workspace.

Acceptance gates:

- OpenAI runtime completes at least one Databricks-backed task through the
  existing API and SSE flow.
- Cross-workspace auth still forces target workspace credentials for tools.

## Phase 7: Sessions, Persistence, and Migrations

Goal: persist product history in app tables and model-visible memory through the
OpenAI Agents SDK session layer.

Tasks:

- Add migration columns:
  - `conversations.agent_runtime`
  - `conversations.agent_session_id`
- Do not assume `conversations.claude_session_id` exists in the current source
  app; keep it only if a copied schema already has the legacy column.
- Add `server/services/agent_runtime/openai_sessions.py`.
- Use a stable session key:

```text
builder:{project_id}:{conversation_id}
```

- Choose one deployed session strategy:
  - OpenAI SDK `SQLAlchemySession`, or
  - custom session adapter over app-managed SQLAlchemy models
- Keep `messages` and `executions` as the product record for replay and
  debugging.
- Use OpenAI Agents SDK sessions as the single model-memory lane. The app
  `conversation_id` only derives the SDK session key; do not use
  `previous_response_id` or OpenAI server-managed conversation IDs in MVP.

Tests:

- New conversations get `agent_runtime=openai_agents`.
- New conversations get a stable `agent_session_id`.
- Multi-turn runs retain model-visible context.
- Reloading the browser shows app-persisted messages and execution events.

Acceptance gates:

- A multi-turn conversation works after backend restart.
- Existing app execution replay remains frontend-compatible.

## Phase 8: Title Generation and Observability

Goal: replace Anthropic title generation and establish tracing policy.

Tasks:

- Replace `server/services/title_generator.py` with OpenAI-backed title
  generation.
- Use `OPENAI_TITLE_MODEL=deepseek-v4-flash` for title generation and similar
  cheap auxiliary generations.
- Call the OpenAI client directly for title generation; do not use a separate
  Agents SDK run unless titles later need tool or tracing parity.
- Keep existing title length and fallback behavior.
- Do not include Databricks tokens in title-generation input.
- Keep app execution records as the UI/debug source of truth.
- Configure OpenAI Agents SDK tracing with:
  - workflow name
  - conversation/project metadata
  - no raw secrets
- Add `OPENAI_AGENTS_DISABLE_TRACING` handling.
- Decide whether MLflow export is MVP or follow-up.

Tests:

- Title generation succeeds with mocked OpenAI client.
- Title generation failure falls back without failing the conversation.
- Trace metadata redacts secrets.
- Tracing can be disabled.

Acceptance gates:

- No `mlflow.anthropic.autolog()` remains in the target app.
- No Anthropic client is imported by title generation.

## Phase 9: Optional MCP Gateway Port

Goal: preserve the Builder App's optional `/mcp` product surface without relying
on Claude Agent SDK plumbing.

Tasks:

- Port `server/mcp_gateway.py` into `databricks-builder-app-oai`.
- Ensure the gateway uses the same Databricks tool registry, skill allowlist
  rules, and auth separation as the in-app OpenAI runtime.
- Remove any Claude-specific tool exposure or `claude-agent-sdk` assumptions.
- Preserve the existing `--enable-mcp` or environment-controlled startup path.
- Add gateway tests for:
  - tool listing
  - a simple tool call with mocked Databricks auth
  - disabled skill/tool filtering
  - startup disabled by default when the flag is absent

Acceptance gates:

- The app starts normally with the MCP gateway disabled.
- The app starts with the MCP gateway enabled and no Claude SDK imports.
- External MCP clients can list the expected Databricks tools and call a mocked
  tool.

## Phase 10: Frontend and Documentation Cutover

Goal: make the new app read like an OpenAI Agents SDK app without changing the
core user workflow.

Tasks:

- Replace Claude-specific UI copy with "OpenAI Agents SDK" or "agent runtime".
- Update docs pages rendered inside the app.
- Add `/api/config/runtime` if the UI needs runtime metadata.
- Update local development docs for:
  - AI Gateway OpenAI-compatible env vars
  - frontend package-manager commands
  - backend/frontend service checks
- Update deployment docs for `databricks-builder-app-oai`.
- Update app examples and screenshots only after the runtime works.

Frontend checks:

```bash
cd databricks-builder-app-oai/client
pnpm install
pnpm lint
pnpm build:typecheck
```

Browser test prerequisites:

- Confirm backend API server is reachable at `127.0.0.1:8000`.
- Confirm the frontend server under test is reachable.

Acceptance gates:

- No active UI copy implies the runtime is Claude Code.
- Project creation, conversation streaming, tool event display, and file changes
  work in browser tests.

## Phase 11: Deployment and Release Readiness

Goal: prove the new sibling app is deployable and supportable.

Tasks:

- Update `app.yaml.example` for OpenAI runtime env vars.
- Update Databricks Bundle or deployment scripts to target
  `databricks-builder-app-oai`.
- Verify Lakebase/PostgreSQL migrations run on startup.
- Verify project backup worker runs.
- Add smoke test script for deployed app health.
- Document rollback: continue using legacy `databricks-builder-app`.

Acceptance gates:

- Local app can run backend and frontend.
- Deployed app can:
  - create a project
  - create a conversation
  - stream an OpenAI agent response
  - call a Databricks tool
  - write a project file
  - reload persisted history
- Legacy `databricks-builder-app` remains runnable.

## Work Breakdown by Owner Area

| Area | Primary files | Main risk |
|------|---------------|-----------|
| Scaffold/config | `databricks-builder-app-oai/pyproject.toml`, scripts, app yaml | accidentally carrying Claude or package-manager artifacts |
| Runtime | `server/services/agent_runtime/*` | SDK event and session semantics |
| File tools | `server/services/tools/project_files.py` | path escape or oversized file handling |
| Databricks tools | `server/services/tools/databricks_openai.py` | schema parity and long-running operations |
| Skills | `server/services/skills_registry.py` | degraded agent quality from poor context selection |
| MCP gateway | `server/mcp_gateway.py` | preserving external tool surface without Claude-specific wrappers |
| Persistence | `server/db/models.py`, `alembic/versions/*` | mixing product history with SDK session memory |
| Frontend | `client/src/*` | UI coupled to Claude-specific event assumptions |
| Deployment | `scripts/*`, `databricks.yml`, `app.yaml.example` | wrong env vars or missing OpenAI secrets |

## Minimum Viable Milestone

The first useful milestone is not full feature parity. It is:

- [x] `databricks-builder-app-oai` exists and imports.
- [x] OpenAI Agents SDK is the only agent runtime dependency.
- [x] AI Gateway config is represented by `OPENAI_BASE_URL`,
  `OPENAI_API_KEY`, and `OPENAI_AGENT_MODEL=deepseek-v4-pro`.
- [x] Config validation fails clearly when required AI Gateway values are
  missing.
- [ ] `/api/invoke_agent` starts a mocked or live OpenAI run.
- [x] SDK event normalization emits frontend-compatible `text_delta`,
  `tool_use`, `tool_result`, and `result`-compatible events.
- [x] Project file tools can read and edit files safely.
- [ ] At least one Databricks tool works through the OpenAI runtime in a live
  workspace smoke test.
- [x] Conversation history has app-table persistence support with
  `agent_runtime` and `agent_session_id` fields.

After this milestone, broaden Databricks tool parity, frontend polish, and
deployment automation. Treat any SandboxAgent exploration as a separate
post-MVP branch.

## Final Validation Checklist

- [x] `rg -n "claude_agent_sdk|anthropic|ANTHROPIC|ClaudeSDKClient" databricks-builder-app-oai`
  returns no active runtime dependency. Remaining `.claude` references are
  legacy skill-migration fallback paths only.
- [x] Frontend command examples were updated to `pnpm`.
  returns no new package-management violations.
- [x] Backend unit tests pass.
- [x] Frontend `pnpm lint` passes.
- [x] Frontend `pnpm build:typecheck` passes.
- [ ] API integration tests pass.
- [ ] Browser tests pass after confirming both backend and frontend servers are
  reachable.
- [ ] Live Databricks smoke tests pass when credentials are present.
- [x] OpenAI tracing can be disabled through `OPENAI_AGENTS_DISABLE_TRACING`;
  live trace export still needs policy validation.
- [ ] Secrets are redacted from logs, traces, and execution records.
- [x] Optional MCP gateway imports/constructs without Claude SDK imports and
  applies enabled-skill filtering.
- [ ] Legacy `databricks-builder-app` remains untouched and runnable.
