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
- Enforce tool access by constructing the actual OpenAI tool list per run, not
  by prompt instruction only.
- Keep OpenAI model credentials separate from Databricks tool credentials.
- Do not enable shell execution in MVP.
- Use `pnpm` for frontend commands and do not introduce npm lockfiles.
- Before browser or frontend tests, confirm both `127.0.0.1:8000` and the
  frontend server under test are reachable.

## Phase 0: Repository and Docs Setup

Goal: make the target path and documentation structure unambiguous.

Tasks:

- Create `databricks-builder-app-oai/` as a sibling of `databricks-builder-app/`.
- Use `docs/agents-sdk/` as the canonical OpenAI Agents SDK docs path.
- Update all links in `docs/README.md`, `docs/agents-sdk/README.md`, and this
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
- Remove copied `client/package-lock.json` from the new app if present.
- Update package metadata and app labels:
  - Python project name: `databricks-builder-app-oai`
  - FastAPI title and description
  - Databricks Apps name examples
  - frontend visible labels that mention Claude
- Keep the existing REST route shapes and frontend routes for the first pass.

Suggested checks:

```bash
rg -n "Claude|claude|Anthropic|anthropic|ANTHROPIC|claude_agent_sdk" databricks-builder-app-oai
rg -n "npm|npx|package-lock" databricks-builder-app-oai/client databricks-builder-app-oai/scripts
```

Acceptance gates:

- `databricks-builder-app-oai/` imports as a separate app tree.
- No copied npm lockfile exists in `databricks-builder-app-oai/client/`.
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
  - `OPENAI_API_KEY`
  - `OPENAI_AGENT_MODEL`
  - `OPENAI_TITLE_MODEL`
  - `OPENAI_BASE_URL`
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
- Config validation fails clearly when `OPENAI_API_KEY` or the selected model is
  missing.
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
  - Databricks auth context setup and cleanup
  - cancellation checks
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
- Load existing FastMCP registrations or direct `databricks-tools-core`
  functions.
- Generate OpenAI function tool schemas from validated metadata.
- Preserve existing behavior:
  - copy Databricks auth context into worker threads
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
- Generated schemas are valid OpenAI function tool schemas.
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
- Keep `conversations.claude_session_id` only for legacy compatibility if copied
  from the current app.
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
- Do not mix SDK sessions with server-managed `conversation_id` or
  `previous_response_id` unless that path is deliberately selected and tested.

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
- Use `OPENAI_TITLE_MODEL` when set.
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

## Phase 9: Frontend and Documentation Cutover

Goal: make the new app read like an OpenAI Agents SDK app without changing the
core user workflow.

Tasks:

- Replace Claude-specific UI copy with "OpenAI Agents SDK" or "agent runtime".
- Update docs pages rendered inside the app.
- Add `/api/config/runtime` if the UI needs runtime metadata.
- Update local development docs for:
  - OpenAI env vars
  - pnpm commands
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

## Phase 10: Deployment and Release Readiness

Goal: prove the new sibling app is deployable and supportable.

Tasks:

- Update `app.yaml.example` for OpenAI runtime env vars.
- Update Databricks Bundle or deployment scripts to target
  `databricks-builder-app-oai`.
- Verify Lakebase/PostgreSQL migrations run on startup.
- Verify project backup worker runs.
- Verify optional MCP gateway still starts if enabled.
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
| Scaffold/config | `databricks-builder-app-oai/pyproject.toml`, scripts, app yaml | accidentally carrying Claude or npm artifacts |
| Runtime | `server/services/agent_runtime/*` | SDK event and session semantics |
| File tools | `server/services/tools/project_files.py` | path escape or oversized file handling |
| Databricks tools | `server/services/tools/databricks_openai.py` | schema parity and long-running operations |
| Skills | `server/services/skills_registry.py` | degraded agent quality from poor context selection |
| Persistence | `server/db/models.py`, `alembic/versions/*` | mixing product history with SDK session memory |
| Frontend | `client/src/*` | UI coupled to Claude-specific event assumptions |
| Deployment | `scripts/*`, `databricks.yml`, `app.yaml.example` | wrong env vars or missing OpenAI secrets |

## Minimum Viable Milestone

The first useful milestone is not full feature parity. It is:

- `databricks-builder-app-oai` exists and imports.
- OpenAI Agents SDK is the only agent runtime dependency.
- `/api/invoke_agent` starts a mocked or live OpenAI run.
- SSE emits normalized `text_delta`, `tool_use`, `tool_result`, and `result`
  events.
- Project file tools can read and edit files safely.
- At least one Databricks tool works through the OpenAI runtime.
- Conversation history persists in app tables.

After this milestone, broaden Databricks tool parity, frontend polish,
deployment automation, and optional SandboxAgent experiments.

## Final Validation Checklist

- [ ] `rg -n "claude_agent_sdk|anthropic|ANTHROPIC|ClaudeSDKClient" databricks-builder-app-oai`
  returns no active runtime dependency.
- [ ] `rg -n "npm|npx|package-lock" databricks-builder-app-oai/client databricks-builder-app-oai/scripts`
  returns no new package-management violations.
- [ ] Backend unit tests pass.
- [ ] Frontend `pnpm lint` passes.
- [ ] Frontend `pnpm build:typecheck` passes.
- [ ] API integration tests pass.
- [ ] Browser tests pass after confirming both backend and frontend servers are
  reachable.
- [ ] Live Databricks smoke tests pass when credentials are present.
- [ ] OpenAI tracing can be disabled.
- [ ] Secrets are redacted from logs, traces, and execution records.
- [ ] Legacy `databricks-builder-app` remains untouched and runnable.
