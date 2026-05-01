# OpenAI Agents SDK Builder App Design

## Summary

`databricks-builder-app-oai` should be a new sibling app that replaces the
Claude Agent SDK integration with an application-owned OpenAI Agents SDK runtime.
The FastAPI API, React UI, project model, conversation model, SSE streaming
pattern, Databricks auth context, skill-selection UI, and optional MCP gateway
should be ported from `databricks-builder-app` with minimal product-surface
changes.

The main design decision is to stop treating a hosted coding CLI as the runtime
in the new folder. Instead, `databricks-builder-app-oai` constructs an OpenAI
`Agent` for each execution, gives it an explicit set of app-owned tools, streams
`Runner.run_streamed()` events into the execution pipeline, and persists
conversation memory through an OpenAI Agents SDK session keyed by the app
conversation.

## Goals

- Create `databricks-builder-app-oai` as the OpenAI Agents SDK target folder.
- Remove `claude-agent-sdk` and `anthropic` from the target app runtime.
- Use `openai-agents` as the agent orchestration dependency.
- Preserve the current browser-facing API and SSE event contract where possible.
- Preserve project-scoped file workspaces and project backup behavior.
- Preserve Databricks tool coverage and skill-based tool filtering.
- Preserve cross-workspace Databricks tool auth.
- Make runtime behavior testable without launching a provider-specific
  subprocess.
- Keep the path open for SandboxAgent once beta risk and Databricks Apps
  deployment behavior are validated.

## Non-goals

- Rebuilding the React product surface.
- Mutating the existing `databricks-builder-app` in place.
- Removing Claude runtime support from the legacy `databricks-builder-app`.
- Replacing `databricks-tools-core` or the external MCP gateway.
- Enabling arbitrary shell execution in MVP.
- Guaranteeing resume compatibility with Claude SDK internal session state.
- Depending on OpenAI SandboxAgent in the first production version.
- Sending Databricks user tokens to OpenAI model calls.

## Target Architecture

```text
Browser
  |
  | /api/*, SSE windows
  v
FastAPI app
  |
  | routers, storage, auth, ActiveStreamManager
  v
OpenAI agent runtime adapter
  |
  | Agent + Runner.run_streamed + SDK session
  v
App-owned tools
  |-- project file tools
  |-- Databricks function tools
  |-- async operation polling tools
  |-- optional MCP client tools
  v
Project filesystem, Databricks workspace, app database
```

The runtime adapter is the key boundary. Routers and storage should call a
runtime-neutral interface rather than importing OpenAI SDK types directly.

## Proposed Backend Modules

```text
databricks-builder-app-oai/server/
  services/
    agent_runtime/
      __init__.py
      base.py                  # Runtime protocol and normalized event types
      openai_runtime.py        # OpenAI Agents SDK implementation
      openai_events.py         # SDK event to Builder event mapping
      openai_sessions.py       # SDK session factory
      openai_models.py         # Model/provider configuration
    tools/
      project_files.py         # read/write/edit/glob/grep project file tools
      databricks_openai.py     # OpenAI function tools for Databricks tools
      operation_tools.py       # check/list long-running operations
    skills_registry.py         # runtime-neutral skill loading/rendering
```

The exact module names can be adjusted to repo style during implementation, but
the separation should remain:

- runtime orchestration
- event normalization
- tool definitions
- session/memory
- skills
- model configuration

## Runtime Interface

Add a narrow protocol used by `server/routers/agent.py` and active stream code:

```python
from typing import AsyncIterator, Protocol


class AgentRuntime(Protocol):
  async def stream_response(
    self,
    request: AgentRunRequest,
  ) -> AsyncIterator[dict]:
    ...
```

`AgentRunRequest` should contain only app-level values:

- `project_id`
- `conversation_id`
- `message`
- `cluster_id`
- `warehouse_id`
- `default_catalog`
- `default_schema`
- `workspace_folder`
- `databricks_host`
- `databricks_token`
- `is_cross_workspace`
- `enabled_skills`
- `mlflow_experiment_name`
- `is_cancelled_fn`

The OpenAI implementation can translate this into SDK-specific types internally.

## Agent Construction

For each run:

1. Resolve the project directory.
2. Set Databricks auth contextvars for tool calls.
3. Load enabled skills and render selected guidance.
4. Build the system instructions from:
   - existing `get_system_prompt()` output, updated to remove Claude wording
   - selected skill guidance
   - project file tool rules
   - Databricks context such as cluster, warehouse, catalog, schema, workspace
5. Build project file tools.
6. Build Databricks tools filtered by enabled skills.
7. Create the OpenAI `Agent`.
8. Create or load the SDK session for the conversation.
9. Run `Runner.run_streamed()`.
10. Map SDK stream events to Builder App events.
11. Clear Databricks auth contextvars.

Sketch:

```python
from agents import Agent, Runner
from agents.run import RunConfig


agent = Agent(
  name='Databricks Builder',
  instructions=instructions,
  model=settings.model,
  tools=project_file_tools + databricks_tools + operation_tools,
)

result = Runner.run_streamed(
  agent,
  input=request.message,
  session=session,
  run_config=RunConfig(
    workflow_name='Databricks Builder App',
    trace_metadata={
      'project_id': request.project_id,
      'conversation_id': request.conversation_id,
      'workspace_url': request.databricks_host,
    },
  ),
)

async for event in result.stream_events():
  yield normalize_openai_event(event)
```

The implementation must continue consuming the stream until it completes. The
OpenAI docs note that streamed runs are not complete until the async iterator
finishes because session persistence and post-processing can continue after the
last visible token.

## Model Configuration

Use explicit OpenAI runtime variables:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Model API credential |
| `OPENAI_AGENT_MODEL` | Default model for the Builder App agent |
| `OPENAI_TITLE_MODEL` | Optional cheaper model for title generation |
| `OPENAI_BASE_URL` | Optional only for validated OpenAI-compatible endpoints |
| `OPENAI_AGENTS_DISABLE_TRACING` | Provider-supported tracing disable switch |
| `BUILDER_AGENT_RUNTIME` | Optional migration flag; new version defaults to `openai_agents` |

Remove runtime dependency on:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`

Databricks tool auth remains separate and should continue using the existing
workspace token resolution path.

## Project File Tools

MVP file tools should be plain OpenAI function tools. They replace Claude Code's
built-in file tools.

Required tools:

| Tool | Behavior |
|------|----------|
| `read_project_file` | Read UTF-8 text from a project-relative path with size limits |
| `write_project_file` | Create or replace a project-relative text file |
| `edit_project_file` | Replace exact text in a project file with an expected replacement count |
| `list_project_files` | List files matching a glob under the project root |
| `grep_project_files` | Search text or regex patterns under the project root |
| `get_project_tree` | Return a bounded project tree for orientation |

Path rules:

- Resolve every path against the project root.
- Reject absolute paths outside the project.
- Reject `..` escapes after resolution.
- Reject symlinks that resolve outside the project.
- Cap file read size, search result count, and write size.
- Return structured errors that the model can act on.

MVP should not expose shell execution. If shell is added later, it should be a
separate tool with explicit user approval, timeouts, output caps, and deployment
isolation.

## Databricks Tool Strategy

Create OpenAI function tools from the same Databricks capabilities currently
exposed through the MCP server.

Implementation options:

1. Load registered FastMCP tools and generate `FunctionTool` objects with
   `params_json_schema` and an async `on_invoke_tool`.
2. Wrap selected `databricks-tools-core` functions directly with typed
   `@function_tool` wrappers.

The first pass should prefer option 1 for coverage parity with the current app,
then move hot or sensitive tools to typed direct wrappers if schema quality,
latency, or auth control requires it.

Tool wrapper requirements:

- Copy Databricks auth context into worker threads.
- Parse JSON strings for list/dict inputs where legacy tool behavior requires it.
- Normalize empty strings to `None` where Databricks APIs expect null.
- Run sync tools in an executor.
- Preserve the current async operation tracker for long-running tools.
- Return JSON text or structured tool output that the model can reason about.
- Emit app events with tool name, input, status, result, and error text.

Skill-based tool filtering must happen before constructing the OpenAI agent's
tool list. Disabled tools should not be present in `agent.tools`.

## Skill Registry

Replace Claude host-managed skills with an app-owned registry.

Inputs:

- `databricks-builder-app-oai/skills`
- `databricks-skills`
- optional project `.agents/skills`
- optional legacy project `.claude/skills` during migration

Outputs:

- selected skill metadata for the UI
- selected guidance text for agent instructions
- allowlist of Databricks tools enabled by selected skills

Runtime behavior:

1. Sync enabled skills into `project/.agents/skills`.
2. Parse each `SKILL.md` frontmatter and Markdown body.
3. Select skills based on project enabled skills and the request.
4. Render a bounded "Relevant Databricks Skills" section into instructions.
5. Include source skill names and paths for traceability.

Do not expose a generic `Skill` tool in MVP. The app should decide what guidance
is in context instead of asking the model to browse an implementation-specific
skills directory.

## Sessions and Memory

Use OpenAI Agents SDK sessions for model-visible conversation memory. Keep the
app's existing `messages` and `executions` tables as product persistence.

Recommended session key:

```text
builder:{project_id}:{conversation_id}
```

Recommended schema changes:

| Table | Column | Purpose |
|-------|--------|---------|
| `conversations` | `agent_runtime` | `openai_agents` for new conversations |
| `conversations` | `agent_session_id` | SDK session key |
| `conversations` | `claude_session_id` | Legacy only during migration |

For local development, `SQLiteSession` is acceptable. For deployed Builder App,
use `SQLAlchemySession` against the existing async database URL or implement a
custom session adapter over the app's SQLAlchemy models.

Do not combine OpenAI Agents SDK sessions with server-managed `conversation_id`
or `previous_response_id` in the same run unless a specific runtime path is
chosen and tested. The SDK docs call out these as separate state strategies.

## Streaming Event Mapping

The frontend should continue to consume Builder App events, not OpenAI SDK
events directly.

| Builder event | OpenAI source |
|---------------|---------------|
| `text_delta` | Raw response event with output text delta |
| `text` | Message output item text |
| `tool_use` | Run item event with tool call item |
| `tool_result` | Run item event with tool call output item |
| `system` | Agent updated, handoff, interruption, tracing metadata, or session info |
| `result` | Final run result and usage metadata where available |
| `keepalive` | Backend timer while no SDK events arrive |
| `cancelled` | Runtime cancellation path |
| `error` | SDK, model, or tool exception |

Add new event types only when the UI needs them. Candidate future additions:

- `approval_required`
- `approval_resolved`
- `agent_updated`
- `handoff`

## Cancellation

The current `ActiveStream` cancellation flag should remain. The OpenAI runtime
should check it while consuming `stream_events()`.

When cancelled:

- Prefer the SDK streaming result cancellation API if the run is active.
- Stop emitting model-visible events after cancellation.
- Persist a `cancelled` event.
- Clear Databricks auth context.
- Allow already-backgrounded Databricks operations to finish and be visible
  through operation status tools.

## Title Generation

Replace `server/services/title_generator.py` with OpenAI-backed title generation.

Recommended behavior:

- Use `OPENAI_TITLE_MODEL` if set, otherwise a cheaper configured fallback.
- Call the OpenAI client directly for a single short generation, or use a small
  `Agent` with no tools.
- Keep the existing title length and fallback behavior.
- Do not include Databricks tokens in title-generation input.

## Tracing and Observability

Use three layers:

1. **App execution records.** Existing `executions` table remains the source for
   UI replay and operational debugging.
2. **OpenAI Agents SDK tracing.** Enabled in development by default, configured
   with workflow name, group ID, and metadata.
3. **Optional MLflow export.** Evaluate a custom trace processor or MLflow
   OpenAI integration as a follow-up.

Production tracing should be configurable:

| Variable | Behavior |
|----------|----------|
| `OPENAI_AGENTS_DISABLE_TRACING=1` | Disable provider tracing |
| `BUILDER_TRACE_TO_MLFLOW=true` | Enable future MLflow trace export |
| `MLFLOW_EXPERIMENT_NAME` | Existing experiment target if MLflow export is implemented |

All trace metadata must avoid raw tokens and secrets.

## API Impact

Keep these endpoints stable:

- `POST /api/invoke_agent`
- `POST /api/stream_progress/{execution_id}`
- `POST /api/stop_stream/{execution_id}`
- project and conversation CRUD endpoints
- skills endpoints
- config endpoints

Response shape changes should be additive only.

Potential additions:

- `/api/config/runtime` returns `openai_agents`, model name, tracing status, and
  whether sandbox mode is enabled.
- `/api/projects/{project_id}/skills/preview-instructions` shows rendered skill
  instructions for debugging.

## Frontend Impact

Minimal MVP frontend changes:

- Replace Claude-specific labels with "OpenAI Agents SDK" or "agent runtime".
- Remove Claude Code wording from docs page and loading copy.
- Preserve event reducer behavior for existing event types.
- Add display handling for future `approval_required` only if approvals enter
  scope.

The frontend should not display provider credentials, raw SDK session IDs, or
trace URLs unless explicitly added as an admin/debug feature.

## Dependency Changes

`databricks-builder-app-oai/pyproject.toml`:

- Remove `claude-agent-sdk`.
- Remove `anthropic`.
- Add `openai-agents`.
- Keep `mcp` and `fastmcp` for the external gateway and possible MCP adapter.
- Keep `mlflow` until tracing/export decisions are settled.

`requirements.txt` should be regenerated from the chosen package manager after
the implementation changes. Do not introduce npm lockfiles or npm commands for
client work; this repository's instructions require pnpm.

## Migration Plan

### Phase 0: Runtime Spike

- Scaffold `databricks-builder-app-oai` from the reusable parts of
  `databricks-builder-app`.
- Add `openai-agents` dependency.
- Build `OpenAIAgentRuntime` behind the runtime protocol.
- Implement a mocked smoke test with one simple function tool.
- Implement event normalization tests from captured synthetic OpenAI SDK events.
- Add config validation and secret redaction tests.

Exit criteria:

- `databricks-builder-app-oai` backend imports without Claude SDK.
- A mocked OpenAI run produces `text_delta`, `tool_use`, `tool_result`, and
  `result` app events.

### Phase 1: File Tools and Skill Registry

- Implement project file tools.
- Add path escape and symlink tests.
- Add runtime-neutral skill registry.
- Render selected skills into instructions.
- Preserve enabled skills API behavior.

Exit criteria:

- Agent can read, edit, and write project files in a test project.
- Disabled skills remove their Databricks tools from the agent tool list.

### Phase 2: Databricks Tool Parity

- Generate OpenAI function tools from existing Databricks tool registrations.
- Preserve async operation tracker.
- Add parity tests for tool names, schemas, and basic outputs.
- Run live gated smoke tests for `execute_sql`, volume file listing, and compute
  listing if credentials are present.

Exit criteria:

- OpenAI runtime can complete a Databricks-backed task through the existing
  `/api/invoke_agent` and SSE path.

### Phase 3: Persistence and Deployment

- Add `agent_runtime` and `agent_session_id` columns.
- Wire SQLAlchemy-backed SDK sessions.
- Replace title generator.
- Update env examples, deployment docs, and UI copy.
- Remove Claude runtime dependency from the `databricks-builder-app-oai`
  production install path.

Exit criteria:

- Deployed app can create a project, run a multi-turn conversation, call
  Databricks tools, persist execution events, and reload conversation history.

### Phase 4: Hardening

- Add cancellation tests.
- Add long-running tool tests.
- Add OpenAI tracing configuration tests.
- Evaluate SandboxAgent behind a feature flag for richer coding workflows.
- Add browser regression tests after confirming backend `127.0.0.1:8000` and the
  frontend server under test are reachable.

## Test Plan

Unit tests:

- OpenAI config parsing and missing-key errors.
- Secret redaction.
- Project path validation for file tools.
- File tool read/write/edit/glob/grep behavior.
- Databricks tool schema generation.
- Disabled skill tool filtering.
- OpenAI event normalization.
- Session key generation.
- No imports from `claude_agent_sdk` or `anthropic` in
  `databricks-builder-app-oai`.

Integration tests:

- `/api/invoke_agent` starts an OpenAI runtime execution.
- `/api/stream_progress/{execution_id}` streams normalized events.
- `/api/stop_stream/{execution_id}` cancels active runs.
- Conversation messages and execution events persist.
- Project backups still run after file writes.
- Live Databricks tool smoke tests gated by workspace credentials.

Browser tests:

- Use pnpm commands for the client.
- Confirm backend `127.0.0.1:8000` is reachable.
- Confirm the frontend server under test is reachable.
- Verify conversation creation, streaming text, tool event display, and project
  file changes.

## Security Requirements

- Tool allowlists must be enforced by construction, not by prompt only.
- File tools must be project-root confined.
- Shell execution is disabled in MVP.
- Databricks tokens stay in Databricks auth context only.
- OpenAI API keys stay in model client configuration only.
- Trace metadata and execution records must redact secrets.
- Cross-workspace mode must continue forcing target Databricks credentials for
  Databricks tool calls.
- Provider tracing must be configurable for privacy-sensitive deployments.

## Open Questions

- Should the production app use the OpenAI trace dashboard, MLflow export, or
  app-local execution records only?
- Should SDK session storage use built-in `SQLAlchemySession` tables or a custom
  adapter over existing app tables?
- Which model should be the default for Builder App coding and Databricks tasks?
- Should `databricks-builder-app-oai` eventually replace
  `databricks-builder-app` in docs and deployment scripts, or remain a parallel
  app indefinitely?
- Can any Databricks-hosted OpenAI-compatible endpoint support the exact SDK
  model provider path required by the Agents SDK?
- When should SandboxAgent graduate from experiment to supported runtime mode?

## Implementation Checklist

- [ ] Add runtime protocol.
- [ ] Scaffold `databricks-builder-app-oai`.
- [ ] Add OpenAI runtime adapter.
- [ ] Add OpenAI event normalization.
- [ ] Add project file function tools.
- [ ] Add runtime-neutral skill registry.
- [ ] Add Databricks OpenAI function tool adapter.
- [ ] Add OpenAI session factory.
- [ ] Add OpenAI title generator.
- [ ] Add migrations for runtime/session columns.
- [ ] Update environment templates and deployment docs.
- [ ] Update frontend and docs copy.
- [ ] Remove Claude dependencies from the `databricks-builder-app-oai`
  production path.
- [ ] Add unit, integration, and browser tests.

## References

- [OpenAI Agents SDK intro](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [OpenAI Agents SDK streaming](https://openai.github.io/openai-agents-python/streaming/)
- [OpenAI Agents SDK tools](https://openai.github.io/openai-agents-python/tools/)
- [OpenAI Agents SDK MCP](https://openai.github.io/openai-agents-python/mcp/)
- [OpenAI Agents SDK sessions](https://openai.github.io/openai-agents-python/sessions/)
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK sandbox agents](https://openai.github.io/openai-agents-python/sandbox_agents/)
