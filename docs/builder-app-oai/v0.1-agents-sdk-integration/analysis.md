# OpenAI Agents SDK Builder App Analysis

## Purpose

This document analyzes what must change to create `databricks-builder-app-oai`,
a new sibling version of `databricks-builder-app` that uses the OpenAI Agents
SDK as the agent runtime instead of the Claude Agent SDK.

The goal is not a mechanical dependency swap. The current app relies on Claude
Code-specific process behavior, built-in file tools, skill loading, session IDs,
Anthropic-compatible model environment variables, and MLflow Anthropic tracing.
The OpenAI version should keep the useful Builder App product surface, but the
target implementation lives in `databricks-builder-app-oai` and owns the
runtime, tools, memory, and file access through app code and the OpenAI Agents
SDK.

## Target Folder

The target for this replacement is a new folder:

```text
databricks-builder-app-oai/
```

The existing `databricks-builder-app/` remains the Claude-based reference
implementation. Migration work should copy or port the reusable FastAPI, React,
database, project backup, skill-management, and Databricks helper code into
`databricks-builder-app-oai/`, then remove Claude-specific runtime dependencies
from that target folder.

## Current Builder App Shape

The existing app, used as the source/reference for `databricks-builder-app-oai`,
is a FastAPI and React application with these major pieces:

- React/Vite client under `databricks-builder-app/client`.
- FastAPI backend under `databricks-builder-app/server`.
- PostgreSQL or Lakebase persistence for projects, conversations, messages,
  executions, and project file backups.
- Project working directories under `PROJECTS_BASE_DIR`.
- Databricks tools loaded from `databricks-mcp-server`.
- Skill packages copied from `databricks-skills`.
- Optional Streamable HTTP MCP gateway under `/mcp`.
- Long-running execution state streamed to the browser through SSE windows.

Most of this should be ported into `databricks-builder-app-oai`. The
runtime-specific source parts that need replacement sit mostly in:

- `server/services/agent.py`
- `server/services/active_stream.py`
- `server/services/databricks_tools.py`
- `server/services/operation_tracker.py`
- `server/services/system_prompt.py`
- `server/services/title_generator.py`
- `server/services/skills_manager.py`
- `server/mcp_gateway.py`
- `server/db/models.py`
- docs and UI copy that name Claude Code or Claude Agent SDK

## Claude Coupling Inventory

| Area | Current behavior | Migration implication |
|------|------------------|-----------------------|
| Runtime package | Imports `ClaudeAgentOptions`, `ClaudeSDKClient`, SDK message classes, `HookMatcher`, and permission result types from `claude_agent_sdk` | Replace with `agents.Agent`, `agents.Runner`, `RunConfig`, function tools, MCP servers, sessions, and OpenAI streaming events |
| Process model | Runs `ClaudeSDKClient` in a fresh event loop thread to work around subprocess transport issues | OpenAI Agents SDK does not require a Claude Code subprocess; keep background execution for SSE but remove the workaround unless a chosen sandbox client requires isolation |
| Built-in tools | Uses Claude Code tools: `Read`, `Write`, `Edit`, `Glob`, `Grep`, and conditionally `Skill`; `Bash` is disabled | OpenAI runtime needs explicit file/search/edit tools or a SandboxAgent capability set |
| Tool integration | Wraps FastMCP tools with `claude_agent_sdk.tool` and `create_sdk_mcp_server` | Replace with OpenAI `@function_tool`, direct `FunctionTool`, or OpenAI MCP server integration |
| Tool filtering | Filters enabled Databricks MCP tools before registering an SDK MCP server because Claude `bypassPermissions` exposes registered tools | Preserve the security property by constructing the actual OpenAI tool list per run, not by filtering only in prompts |
| Permissions | Uses `permission_mode='bypassPermissions'` and a `can_use_tool` callback to handle `AskUserQuestion` | OpenAI version should avoid bypass semantics and implement explicit tool allowlists plus optional human-in-the-loop approval |
| Skills | Copies selected skills into project `.claude/skills` and relies on Claude Code's `Skill` tool | OpenAI version needs a runtime-neutral skill registry that injects selected skill guidance into instructions, or uses SandboxAgent Skills if that beta path is adopted |
| Sessions | Stores a Claude SDK `session_id` for resume in `conversations.claude_session_id` | Introduce runtime-neutral `agent_session_id` and `agent_runtime`; use OpenAI Agents SDK sessions keyed by conversation ID |
| Streaming | Converts Claude message block types into normalized app events such as `text_delta`, `tool_use`, `tool_result`, and `result` | Keep the app event contract, but map from OpenAI `stream_events()` event types |
| Model auth | Builds Anthropic-compatible env vars such as `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`, usually pointed at the current AI Gateway Anthropic-compatible route | Replace with AI Gateway OpenAI-compatible config: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL=deepseek-v4-pro`, and `OPENAI_TITLE_MODEL=deepseek-v4-flash`; direct OpenAI remains a fallback only when `OPENAI_BASE_URL` is unset |
| Tracing | Enables `mlflow.anthropic.autolog()` before creating `ClaudeSDKClient` | Use OpenAI Agents SDK built-in tracing and evaluate a custom trace processor or MLflow OpenAI tracing path separately |
| Title generation | Uses the Anthropic client and Anthropic-compatible endpoint | Replace with the OpenAI client directly, using `OPENAI_TITLE_MODEL=deepseek-v4-flash` |
| User-facing copy | Docs and UI pages say Claude Code, Claude Agent SDK, Anthropic, and `.claude/skills` | Update to OpenAI Agents SDK, agent runtime, and runtime-neutral skills paths |

## OpenAI Agents SDK Capability Fit

The OpenAI Agents SDK has the primitives needed for the Builder App runtime:

- `Agent` defines instructions, tools, model, handoffs, guardrails, and output
  behavior.
- `Runner` executes the agent loop and supports async, sync, and streamed runs.
- `Runner.run_streamed()` yields a streaming result whose `stream_events()` can be
  consumed by the backend and converted to the existing SSE event contract.
- Function tools can wrap Python functions, infer schemas from signatures and
  docstrings, and support sync or async functions.
- MCP integrations support hosted MCP, Streamable HTTP MCP, HTTP with SSE, and
  stdio transports.
- Sessions persist conversation history across runs without the app manually
  rebuilding input history.
- Built-in tracing records model calls, tools, handoffs, guardrails, and custom
  spans by default.
- Sandbox agents provide file, shell, skills, and persistent workspace
  capabilities, but they are documented as beta.

The closest first implementation is a plain `Agent` with app-owned file tools,
Databricks function tools, and an SDK session. Sandbox agents should be evaluated
after the non-beta runtime proves parity with the current UI and persistence
model.

## Runtime Choice Analysis

### Option A: Plain Agent With App-Owned Tools

This option uses `agents.Agent` and `Runner.run_streamed()` with explicit tools
owned by the Builder App.

Expected strengths:

- Stable core SDK path.
- No provider-specific subprocess.
- Clear path sandboxing for project file tools.
- Easy unit testing and mocking.
- Direct control over Databricks auth context, timeouts, tool output shape, and
  event normalization.
- Lower risk for Databricks Apps deployment.

Expected gaps:

- Must implement file tools that Claude Code currently provided.
- Must implement skill selection and rendering.
- Does not automatically provide a full coding-agent filesystem experience.
- Shell execution should stay out of MVP or be added behind a carefully scoped
  tool.

Recommendation: use this option for the first `databricks-builder-app-oai`
version.

### Option B: SandboxAgent

This option uses OpenAI Sandbox Agents for repo-like workspaces, manifest-staged
files, filesystem capabilities, shell capabilities, and sandbox-native skills.

Expected strengths:

- Closer to a coding-agent workflow.
- Built for persistent workspaces and resumable sandbox state.
- Can load skills from a host path into a sandbox workspace.
- Better long-term fit if the Builder App is primarily a code-and-artifact agent.

Expected risks:

- Sandbox agents are currently documented as beta.
- API defaults and supported capabilities may change.
- Deployment inside Databricks Apps needs validation for local Unix or Docker
  sandbox clients.
- It may add a second workspace abstraction on top of the existing
  `PROJECTS_BASE_DIR` and backup system.

Recommendation: evaluate after MVP, not as the first production dependency.

### Option C: Direct Responses API

This option uses the OpenAI Responses API directly and implements the agent loop
inside the app.

Expected strengths:

- Maximum control over state and tool dispatch.
- Minimal SDK abstraction.

Expected risks:

- Rebuilds tool loop, sessions, tracing, handoffs, and approvals that the Agents
  SDK already provides.
- More code to test.
- Less aligned with the user's explicit request to depend on the Agents SDK.

Recommendation: do not choose this for `databricks-builder-app-oai`.

## Tool Integration Analysis

### Databricks Tools

The current `databricks_tools.py` dynamically discovers FastMCP tools and wraps
them for Claude. The OpenAI version has two practical paths:

1. **Direct function tools.** Load the same underlying FastMCP registrations or
   `databricks-tools-core` functions, then create OpenAI `FunctionTool` or
   decorated `@function_tool` wrappers.
2. **MCP server tools.** Run or reuse the existing MCP server through OpenAI MCP
   integration, likely `MCPServerStreamableHttp` if using the Builder App's `/mcp`
   gateway or `MCPServerStdio` for a local process.

For the in-app runtime, typed direct function wrappers are the better default
for high-use and security-sensitive parity tools because the app already owns
auth context, skill-based tool filtering, long-running operation tracking, and
output normalization. A generated FastMCP-to-OpenAI adapter can fill coverage
gaps, but only behind schema-fidelity tests. The JSON Schema dialect differences
around `additionalProperties`, `default`, nullable fields, required fields, and
`oneOf`/`anyOf` are a concrete implementation risk, not a documentation detail.
The MCP gateway should remain for external clients and needs its own port.

The OpenAI version should keep these current behaviors:

- Build the registered tool list per run based on enabled skills.
- Call `set_databricks_auth()` and `clear_databricks_auth()` from
  `databricks_tools_core.auth` around each run.
- Copy the Databricks auth `contextvars` context into executor threads before
  running sync Databricks tools.
- Convert empty strings and JSON-like string arguments where needed.
- Execute blocking Databricks calls off the async event loop.
- Preserve the async operation handoff for long-running tools.
- Return structured JSON text to the model and normalized tool result events to
  the UI.

### Project File Tools

Claude Code's `Read`, `Write`, `Edit`, `Glob`, and `Grep` are not portable.
The OpenAI runtime should implement app-owned tools:

- `read_project_file(path)`
- `write_project_file(path, content, mode='replace')`
- `edit_project_file(path, old_text, new_text, expected_replacements=1)`
- `list_project_files(pattern=None)`
- `grep_project_files(pattern, file_glob=None)`
- `get_project_tree(max_files=...)`

All file tools must resolve paths against the project directory and reject
escapes through `..`, symlinks, absolute paths outside the project, and oversized
reads or writes.

Shell execution should stay disabled in MVP. If added later, it needs a separate
approval policy, timeout, output limit, denylist or allowlist, and explicit
runtime isolation.

### Skills

The existing Databricks skills are valuable, but `.claude/skills` is a Claude
host convention. The OpenAI Builder App should introduce a runtime-neutral skill
registry:

- Source skills from `databricks-skills`, deployed app cache, and optionally
  existing `.claude/skills` for backward compatibility.
- Copy enabled skills to `project/.agents/skills`.
- Parse `SKILL.md` frontmatter and content.
- Select skills from enabled project settings and user intent.
- Render selected skill guidance into the agent instructions with source names.
- Preserve the current enabled-skills UI and API contract where possible.

When multiple sources define the same skill name, precedence should be:
project `.agents/skills`, app-bundled `databricks-builder-app-oai/skills`,
repository `databricks-skills`, then legacy project `.claude/skills`.

For SandboxAgent experiments, the same registry can provide the host skill
source consumed by sandbox-native Skills capability.

## Persistence Analysis

The current persistence model can largely remain:

- `projects`
- `conversations`
- `messages`
- `executions`
- project backups

OpenAI Agents SDK sessions should be treated as runtime memory, not as the
product record. The product record remains the app's messages and execution
events.

Required schema changes:

- Add `conversations.agent_runtime`, defaulting to `openai_agents` for new
  conversations.
- Add `conversations.agent_session_id`, likely equal to a stable conversation
  key such as `conversation:{uuid}`.
- Keep `claude_session_id` during migration only if the copied source schema
  actually has that legacy column; the current source app may not, so the OpenAI
  migration should be purely additive.
- Optionally add a separate SDK session storage table if the built-in
  `SQLAlchemySession` should not create its own tables in the app database.

The OpenAI session should be keyed per conversation and scoped by user/project
at the application layer.

## Streaming Analysis

The frontend should not need to know which SDK produced an event. Preserve the
normalized event vocabulary:

- `text_delta`
- `text`
- `tool_use`
- `tool_result`
- `system`
- `result`
- `keepalive`
- `cancelled`
- `error`
- `stream.reconnect`
- `stream.completed`

The new runtime needs an event adapter from OpenAI stream events:

| OpenAI stream surface | Builder App event |
|-----------------------|-------------------|
| Raw response output text deltas | `text_delta` |
| Message output item | `text` |
| Tool call item | `tool_use` |
| Tool call output item | `tool_result` |
| Agent updated event or handoff event | `system` or future `agent_updated` |
| Final run result | `result` |
| SDK interruption or approval request | `system` first, future `approval_required` if UI support is added |

The current SSE windowing and `ActiveStreamManager` are runtime-neutral and
should remain. OpenAI `stream_events()` output is non-replayable, so the
existing ActiveStream window buffer is load-bearing for `stream.reconnect`.

## Authentication Analysis

Split authentication into two independent channels:

1. **Model auth.** Used only for model calls. The standard deployment path uses
   AI Gateway's OpenAI-compatible endpoint configured through `.env.local` or
   app secrets: `OPENAI_BASE_URL`, `OPENAI_API_KEY`,
   `OPENAI_AGENT_MODEL=deepseek-v4-pro`, and
   `OPENAI_TITLE_MODEL=deepseek-v4-flash`.
   Direct OpenAI is a fallback path when `OPENAI_BASE_URL` is unset.
2. **Databricks tool auth.** Continue using the existing user/workspace token
   resolution, contextvars, and cross-workspace mode for Databricks SDK calls.

Do not pass Databricks user tokens to OpenAI. Do not pass OpenAI API keys to
Databricks tools. Keep redaction for both credential types in logs, traces, and
execution records.

## Observability Analysis

OpenAI Agents SDK tracing is enabled by default. This gives a useful baseline
for model calls, tool calls, handoffs, guardrails, and custom spans.

The app should still persist its own execution events because they drive the UI,
conversation replay, and debugging without requiring access to a provider trace
dashboard.

Open questions:

- Whether to export OpenAI traces into MLflow through a custom trace processor.
- Whether MLflow OpenAI autologging provides enough parity for this app.
- Whether production deployments should disable provider tracing by default for
  privacy-sensitive workspaces and rely on app-local execution records.

## Compatibility and Migration Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude built-in file tools have no exact OpenAI plain-agent equivalent | Agent cannot modify project files with current prompts | Implement app-owned file tools before switching runtime |
| Skill loading changes from host-managed `.claude/skills` to app-managed instructions | Lower answer quality if too much or too little skill content is injected | Build skill registry with token budgets and evals |
| Existing conversations have Claude session IDs | Old conversations cannot be resumed by OpenAI session memory | Display history from app messages; start new OpenAI session on first post-migration turn |
| AI Gateway OpenAI-compatible endpoint diverges from SDK expectations | Model calls fail even with `OPENAI_BASE_URL` and `deepseek-v4-pro` configured | Gate Phase 0 on a live AI Gateway smoke test and keep direct OpenAI as a development fallback |
| Tool schemas differ between FastMCP, Claude wrappers, and OpenAI function tools | Model emits malformed tool inputs | Prefer typed wrappers for core tools; use generated schemas only after fidelity tests for defaults, nullable fields, `additionalProperties`, required fields, and `oneOf`/`anyOf` |
| Long-running Databricks tools may exceed model/tool loop timeouts | Streams stall or runs fail | Preserve async operation tracker and polling tools |
| Provider tracing may capture sensitive prompts or tool data | Data governance concern | Make tracing configurable and document data handling |
| Sandbox agents are beta | Runtime churn and deployment uncertainty | Keep sandbox out of MVP; evaluate in a separate post-MVP branch |

## Recommended Direction

Build `databricks-builder-app-oai` as an `openai_agents` runtime with:

- `agents.Agent` and `Runner.run_streamed()`.
- AI Gateway OpenAI-compatible model config from `.env.local` or app secrets,
  defaulting to `deepseek-v4-pro`.
- App-owned project file tools.
- Direct OpenAI function tools for Databricks operations.
- Runtime-neutral skill registry.
- OpenAI Agents SDK SQLAlchemy session keyed by conversation.
- FastAPI REST, SSE, storage, project backup, and frontend surfaces ported from
  the current Builder App.
- OpenAI tracing enabled in development, configurable in production.
- No Claude SDK, Anthropic client, Claude Code subprocess, or `.claude` runtime
  dependency in the new path.

Keep a short migration branch where both folders can be compared only if needed,
but `databricks-builder-app-oai` should ship with OpenAI Agents SDK as the only
agent runtime dependency.
