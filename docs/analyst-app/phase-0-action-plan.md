# Databricks Analyst App Phase 0 Action Plan

## Purpose

Phase 0 is an agent-runtime feasibility phase. It should answer the highest-risk backend questions before UI, Docker packaging, pgvector indexing, or full application scaffolding begin.

The main concerns, in order, are:

1. Can the app use Claude Agent SDK through an application-owned runtime adapter without running Claude Code as a subprocess?
2. Does the configured Databricks workspace, PAT, cluster, UC, and metric view setup work end to end before any tool integration depends on it?
3. Can the analyst runtime cleanly integrate with `databricks-mcp-server` for Databricks tool access, and where should a direct `databricks-tools-core` adapter complement it?
4. How can the app reuse existing Databricks skills as agent guidance without depending on Claude Code's runtime skill loader?

Phase 0 is complete when these decisions are proven by small runnable harnesses, deterministic tests, and a written decision record.

## Non-Goals

Phase 0 should not include:

- UI implementation
- StoryCard or Story Canvas implementation
- frontend build tooling
- Docker image packaging
- VM or AKS deployment manifests
- pgvector setup or semantic context indexing
- full application persistence schema
- production auth beyond PAT-based local feasibility checks
- full end-to-end business analysis workflows

Those items start in later phases after the agent runtime shape is clear.

## Phase 0 Outcomes

By the end of phase 0, the repo should contain:

- a minimal backend-only `databricks-analyst-app` sandbox or equivalent prototype area
- a Claude Agent SDK adapter interface and feasibility harness
- a subprocess guard proving the app does not invoke Claude Code in the serving path
- validated Databricks authentication and basic functionality: PAT identity, cluster execution, UC metadata, and metric view access
- an end-to-end `databricks-mcp-server` integration that exposes Databricks capabilities to the agent runtime
- a direct `databricks-tools-core` adapter for non-agent code paths, sharing the same tool schema as the MCP integration
- a curated analyst-safe tool set for phase 1
- a skill registry proof of concept that loads and selects existing skill markdown
- tests showing selected skills can be injected into an agent prompt/context
- a phase 0 decision record covering Claude SDK pattern, MCP integration shape, direct adapter scope, and skill reuse strategy
- a single phase 0 readiness command or test suite with actionable failures

## Recommended Directory Shape

```text
databricks-analyst-app/
  server/
    analyst_app/
      __init__.py
      config.py
      agent/
        runtime.py
        claude_sdk_adapter.py
        prompts.py
      tools/
        base.py
        databricks_tools_core_adapter.py
        databricks_mcp_adapter.py
        registry.py
      skills/
        registry.py
        selector.py
        renderer.py
      evals/
        phase0/
          cases.yaml
      tests/
        phase0/
          test_config.py
          test_claude_agent_sdk.py
          test_no_claude_code_subprocess.py
          test_databricks_auth.py
          test_metric_views.py
          test_mcp_adapter.py
          test_tools_core_adapter.py
          test_tool_contract.py
          test_skill_registry.py
          test_skill_selection.py
  docs/
    phase0-decision-record.md
```

This shape intentionally excludes `client/`, `Dockerfile`, and deployment manifests.

## Milestone 0.1: Claude Agent SDK Adapter

Goal: prove the selected agent runtime can be embedded as a library/SDK boundary controlled by the application.

Tasks:

1. Define an app-owned `AgentRuntime` interface with methods for:
   - starting a run
   - streaming events
   - registering tools
   - cancelling a run
   - passing trace metadata
   - running in deterministic eval mode
2. Implement a Claude Agent SDK adapter behind that interface.
3. Add a mocked SDK path that can run in CI without live LLM calls.
4. Add an optional live smoke test gated by an explicit environment flag.
5. Add a minimal tool-calling smoke test with a local fake tool.
6. Add cancellation and timeout behavior tests if the SDK exposes those controls.
7. Add a subprocess guard that fails if serving-path code invokes `claude`, `claude-code`, shell-based Claude Code execution, or a Claude Code child process.

Acceptance:

- The SDK adapter imports and initializes from app config.
- Mocked runs can execute without external LLM calls.
- Optional live run can be enabled locally for manual verification.
- Tool registration works with at least one fake local tool.
- No serving-path code shells out to Claude Code.
- Missing SDK credentials fail with clear diagnostics.

## Milestone 0.2: Databricks Authentication and Basic Functionality

Goal: validate that the configured Databricks workspace, PAT, and cluster work end to end before any tool integration depends on them. M0.3 (MCP integration) and M0.4 (direct tools-core) both require this milestone to pass first.

Tasks:

1. Add a typed config loader and secret-redaction utilities for `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, and `DATABRICKS_CLUSTER_ID`.
2. Add a thin Databricks client that authenticates with the configured PAT and never logs the token.
3. Add an identity check that resolves the active workspace identity through the PAT.
4. Add a cluster readiness check:
   - configured cluster exists
   - cluster state is running or startable
   - cluster is compatible with SQL execution requirements
5. Add a bounded read-only SQL smoke test on the configured cluster:
   - execute `SELECT 1`
   - capture status, latency, row count, and result preview
6. Add a UC metadata smoke check: list allowed catalogs/schemas or inspect a configured sample object.
7. Add a metric view smoke check: describe at least one configured UC metric view, or emit a clear "no metric views configured" diagnostic without failing the suite.
8. Add failure diagnostics for invalid PAT, unreachable workspace, missing cluster, terminated cluster, and SQL permission errors.

Acceptance:

- Required env values are parsed, validated, and redacted in diagnostics.
- Active Databricks identity resolves through the configured PAT.
- Configured general-purpose cluster is reachable and runnable.
- Read-only `SELECT 1` succeeds on the configured cluster.
- UC metadata can be inspected at the configured scope.
- Metric view check passes or reports a clear "not configured" diagnostic.
- M0.3 and M0.4 can assume a working Databricks environment from this point forward.

## Milestone 0.3: `databricks-mcp-server` Integration

Goal: integrate the analyst agent runtime with `databricks-mcp-server` as the tool layer for Databricks capabilities. Phase 0 commits to MCP for the in-app runtime; this milestone proves the integration end to end against the workspace validated in M0.2.

Tasks:

1. Stand up `databricks-mcp-server` for the phase 0 sandbox. Prefer the in-process FastMCP test client; a stdio subprocess harness can be added if cancellation, latency, or auth-propagation behavior needs to be measured against the production deployment shape.
2. Identify the MCP tools required for the initial analyst-safe set:
   - identity / current user
   - compute readiness / cluster status
   - cluster-backed read-only SQL execution
   - UC table/schema metadata
   - UC metric view describe and query
3. Wrap the selected MCP tools behind the app-owned `AgentRuntime` tool interface so Claude Agent SDK sees a stable schema independent of MCP transport details.
4. Propagate PAT auth from app config into the MCP client; verify the MCP server uses the same identity validated in M0.2.
5. Normalize MCP tool inputs and outputs into agent-readable JSON shapes; record cases where MCP wrappers consolidate behavior the app should preserve.
6. Add timeouts, cancellation, and read-only enforcement at the app tool boundary, independent of the MCP server's own guardrails.
7. Add unit tests with a fake MCP transport, plus optional live smoke tests gated by Databricks credentials.
8. Document any MCP capability gaps so phase 1 can decide whether to land changes upstream in `databricks-mcp-server` or wrap them locally.

Acceptance:

- The Claude Agent SDK adapter can execute a tool call routed through `databricks-mcp-server` end to end.
- At least three capabilities work through the integration: identity lookup, cluster execution, and metric view describe/query.
- Tool outputs are JSON-serializable and stable across runs.
- Mutating SQL is rejected at the app tool boundary regardless of MCP server behavior.
- Errors from MCP are normalized into agent-readable messages with source context.
- Auth propagation and read-only guardrails work without leaking the PAT into logs or traces.

## Milestone 0.4: Direct `databricks-tools-core` Adapter

Goal: provide a direct in-process tool path against `databricks-tools-core` for code paths that should not go through MCP, such as background context indexing, eval harnesses, or future analyst tools where the MCP shape is a poor fit. The agent runtime uses MCP (M0.3) by default; this milestone keeps the direct path narrow and aligned with the MCP tool schema. Depends on M0.2.

Tasks:

1. Create a direct adapter that wraps selected `databricks-tools-core` functions behind the same app-owned tool interface used in M0.3.
2. Cover the same minimum tool set used by M0.3 to allow side-by-side validation:
   - current identity lookup
   - cluster status/listing
   - cluster-backed SQL execution
   - UC table/schema metadata
   - UC metric view describe/query
3. Normalize tool inputs and outputs into the same schema MCP exposes, so consumers can switch backings if needed.
4. Add read-only/mutation guardrails before execution.
5. Add timeout and error normalization.
6. Add unit tests with mocked Databricks clients.
7. Add optional workspace smoke tests gated on the M0.2 environment.

Acceptance:

- Direct adapter can call the selected core functions in process.
- Tool outputs match the MCP-backed schema for the overlapping tool set.
- Guardrails reject obvious mutation requests before Databricks execution.
- Errors are normalized into agent-readable messages.
- A bounded cluster-backed `SELECT 1` or equivalent smoke query succeeds when run through the direct adapter.

## Milestone 0.5: Analyst Tool Contract

Goal: define the stable tool surface the Claude Agent SDK adapter will expose, regardless of whether the implementation uses MCP (M0.3) or direct `databricks-tools-core` (M0.4).

Initial tool candidates:

| App tool | Purpose | Candidate backing |
|----------|---------|-------------------|
| `get_current_identity` | Resolve active Databricks identity/workspace | tools-core identity or MCP user tool |
| `describe_compute` | Inspect configured cluster and execution readiness | tools-core compute or MCP compute |
| `execute_cluster_sql` | Run bounded read-only SQL on general-purpose cluster | tools-core compute execution |
| `describe_uc_asset` | Inspect UC table/view/schema metadata | tools-core UC or MCP UC |
| `describe_metric_view` | Inspect UC metric view definition | tools-core metric views or MCP UC |
| `query_metric_view` | Query governed metric views | tools-core metric views or MCP UC |

Tasks:

1. Define app-level JSON schemas for each tool.
2. Make tool names distinct and non-overlapping.
3. Define read-only defaults and disallowed operations.
4. Define output shapes optimized for agent reasoning, not raw SDK objects.
5. Add tests that validate tool schemas and example outputs.

Acceptance:

- Claude Agent SDK sees a small, analyst-safe, orthogonal tool set.
- Tool contracts are independent of MCP vs direct backing.
- Adding a new backing implementation does not change agent prompts.

## Milestone 0.6: Skill Reuse Strategy

Goal: reuse existing Databricks skills as guidance for the analyst agent without relying on Claude Code's skill runtime.

Tasks:

1. Build a skill registry that can load local skill markdown from:
   - `databricks-skills/<skill>/SKILL.md`
   - relevant extra references inside each skill directory when explicitly selected
   - optional installed `.agents/skills` or `.claude/skills` locations if present
2. Parse skill metadata:
   - name
   - description
   - trigger guidance
   - primary content path
   - related reference files
3. Define a small initial skill allowlist for analyst phase 1:
   - `databricks-python-sdk`
   - `databricks-unity-catalog`
   - `databricks-metric-views`
   - ~~`databricks-mlflow-evaluation`~~
   - `instrumenting-with-mlflow-tracing`
   - ~~`databricks-config`~~
4. Exclude product surfaces that are not part of this app direction, such as Databricks-native analyst product surfaces.
5. Implement skill selection based on task type, tool being used, and retrieved context.
6. Render selected skill snippets into Claude Agent SDK instructions with source paths and version metadata.
7. Add tests for:
   - metadata parsing
   - allowlist filtering
   - relevant skill selection
   - token budget trimming
   - source attribution
8. Define how skill guidance and tool schemas are combined in the agent prompt.

Acceptance:

- The app can select relevant skills without Claude Code.
- Selected skill content is traceable to local files.
- Skills are constrained by allowlist and token budget.
- Skill selection is deterministic enough for evals.
- The agent can receive skill guidance and use app-level tools in the same run.

## Milestone 0.7: Phase 0 Decision Record

Goal: make the phase 0 output explicit before phase 1 implementation begins.

The decision record should answer:

1. What Claude Agent SDK integration pattern will phase 1 use?
2. What MCP integration shape did phase 0 prove, and which Databricks capabilities are wired through `databricks-mcp-server`?
3. Where does the direct `databricks-tools-core` adapter apply, and which code paths stay on it?
4. What is the initial analyst-safe app tool set?
5. How are Databricks skills loaded, selected, and injected?
6. Which skills are allowlisted for phase 1?
7. Which capabilities are deferred to later phases?
8. What preflight checks must pass for local debugging?

Acceptance:

- Decision record is reviewed before phase 1 starts.
- MCP integration is proven against the validated Databricks workspace (M0.2) for at least identity, cluster execution, and metric view describe/query.
- Direct `databricks-tools-core` adapter scope is documented and limited to non-agent code paths.
- Skill reuse strategy has at least one working prompt assembly example.
- Known gaps have owners or later-phase assignments.

## Suggested Command Contract

Phase 0 should be runnable without UI or Docker:

```bash
uv run pytest databricks-analyst-app/server/tests/phase0 -v
```

Optional live Databricks checks:

```bash
DATABRICKS_HOST=... \
DATABRICKS_TOKEN=... \
DATABRICKS_CLUSTER_ID=... \
uv run pytest databricks-analyst-app/server/tests/phase0 -m databricks -v
```

Optional live Claude SDK check:

```bash
ANTHROPIC_API_KEY=... \
RUN_LIVE_CLAUDE_SDK_SMOKE=1 \
uv run pytest databricks-analyst-app/server/tests/phase0/test_claude_agent_sdk.py -v
```

## Completion Checklist

- [ ] `AgentRuntime` interface exists.
- [ ] Claude Agent SDK adapter imports and initializes.
- [ ] Mocked Claude SDK run succeeds.
- [ ] Optional live Claude SDK smoke test is documented and gated.
- [ ] No Claude Code subprocess guard is implemented.
- [ ] PAT identity smoke check exists.
- [ ] Configured cluster execution smoke check exists.
- [ ] UC metadata and metric view smoke checks exist.
- [ ] Secret redaction is verified for diagnostics, logs, and traces.
- [ ] `databricks-mcp-server` integration runs end to end against the validated workspace.
- [ ] MCP-backed identity, cluster execution, and metric view describe/query work through the agent tool interface.
- [ ] Direct `databricks-tools-core` adapter exists for non-agent code paths and shares the MCP tool schema.
- [ ] Initial analyst-safe app tool contracts are defined.
- [ ] Tool output schemas are stable and JSON-serializable.
- [ ] Skill registry loads local skill markdown.
- [ ] Skill allowlist and selector are implemented.
- [ ] Skill rendering into Claude Agent SDK instructions is tested.
- [ ] Phase 0 decision record is written.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Claude Agent SDK capabilities do not match assumptions | Hide SDK behind app-owned adapter; keep live checks gated and mocked tests default |
| Databricks environment lacks expected resources | M0.2 smoke checks emit clear diagnostics and distinguish required vs optional capabilities |
| MCP-backed and direct adapter outputs drift | Shared app-owned tool schema; cross-check overlapping tools against the same Databricks fixtures |
| MCP capabilities don't fit analyst needs | Document gaps in M0.3; decide per-gap whether to land changes upstream in `databricks-mcp-server` or wrap them locally |
| Auth or guardrails behave differently across MCP transports | Enforce read-only and redaction at the app tool boundary, independent of MCP server behavior |
| Skill content is too broad for prompts | Allowlist, chunking, task-based selection, token budget trimming |
| Skills assume Claude Code behavior | Render skills as guidance only; do not depend on Claude Code auto-loading or subprocess execution |

## Phase 1 Handoff

Phase 1 can start when:

- Claude Agent SDK adapter choice is proven
- Databricks PAT, cluster execution, UC metadata, and metric view feasibility are validated (M0.2)
- `databricks-mcp-server` integration is proven through the agent tool interface (M0.3)
- the direct `databricks-tools-core` adapter exists for non-agent code paths and shares the MCP tool schema (M0.4)
- initial app-level tool contracts are stable
- skill reuse strategy is implemented enough for prompt assembly
- no Claude Code subprocess serving path exists
- UI, Docker, pgvector, and full persistence work are explicitly scheduled for later phases
