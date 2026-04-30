# Databricks Analyst App System Design

## Purpose

This document resolves the phase 0 agent-runtime decisions for `databricks-analyst-app`. It is the implementation-facing companion to [`design.md`](design.md) and [`plan.md`](plan.md).

Phase 0 should optimize for backend feasibility: Claude Agent SDK integration, Databricks tool integration strategy, and reusable skill guidance. UI, Docker packaging, VM/AKS deployment manifests, pgvector setup, and full persistence are later-phase concerns.

## Decision Summary

| Decision | Phase 0 choice | Phase 3 revisit |
|----------|----------------|-----------------|
| Runtime scope | Backend-only agent sandbox and feasibility harness | Add UI, packaging, and deployment hardening after phase 0 |
| Agent runtime | Claude Agent SDK through an application-owned adapter | Revisit model/runtime abstraction once evals identify gaps |
| Databricks tool integration | Compare direct `databricks-tools-core` adapter vs `databricks-mcp-server` adapter; choose for phase 1 using parity tests | Revisit hybrid or MCP-first model if external-agent compatibility becomes primary |
| Skill reuse | Load and render existing local Databricks skill markdown through an app-owned skill registry | Add richer retrieval, ranking, and versioning after phase 1 |
| Claude Code subprocess | Do not run a Claude Code instance as a subprocess in the request path | Reconsider only for isolated development tools, not production serving |
| Authentication | Personal access token (PAT) provided by the user/developer | Replace with user OAuth/OBO or enterprise SSO-backed token flow |
| Databricks execution compute | General-purpose Databricks cluster | Move business-query execution to SQL warehouse if product requirements justify it |
| Canonical metrics | Unity Catalog metric views | Add supplemental documentation fields only if metric views do not cover required semantics |

## Phase 0 Runtime Scope

Phase 0 should run as a backend-only local sandbox. It does not need a frontend server, Docker image, local PostgreSQL, pgvector, or deployment manifest.

The phase 0 process can be a Python test harness or small CLI that initializes:

- config and secret redaction
- Claude Agent SDK adapter
- app-owned tool registry
- direct `databricks-tools-core` adapter
- MCP adapter or parity harness
- skill registry and selector
- optional live Databricks smoke checks

## Runtime Topology

```text
Phase 0 test harness / backend sandbox
  |- Claude Agent SDK adapter
  |- app-owned agent runtime interface
  |- app-owned tool registry
  |- direct databricks-tools-core adapter
  |- MCP adapter / parity harness
  |- skill registry and renderer
  |- metric view query service
  |
  | SQL / metadata / jobs / traces
  v
Databricks workspace
  |- Unity Catalog
  |- UC metric views
  |- general-purpose cluster
  |- MLflow
```

Long-running background workers, UI event streams, Story Canvas persistence, and deployment packaging are not phase 0 requirements.

## Claude Agent SDK Integration

The first phase 0 concern is whether the analyst runtime can use the Claude Agent SDK through a narrow adapter owned by the application.

The adapter should expose:

- `run_analysis(input, context, tools, run_config)`
- streaming events for story creation, trace, tool call, tool result, evidence, validation, conclusion, and next moves
- tool registration for analyst-safe tools
- cancellation
- trace metadata hooks
- deterministic eval configuration

The application should not shell out to `claude`, spawn Claude Code as a child process, or depend on a long-running Claude Code subprocess for serving user requests.

Rationale:

- Subprocess orchestration makes cancellation, streaming, auth isolation, deployment, and observability harder.
- A library/SDK boundary is easier to test and mock.
- The application should own tool contracts, context selection, storage, and tracing rather than delegating those responsibilities to a CLI process.

If the SDK lacks a required capability without a subprocess, the phase 0 behavior should be to keep that capability out of scope and document the gap. Subprocess use can be considered later for offline developer tooling, but not for production request handling.

## Databricks Tool Integration Strategy

The second phase 0 concern is how Databricks capabilities should be exposed to the Claude Agent SDK adapter. Phase 0 must compare direct `databricks-tools-core` calls with `databricks-mcp-server` backed calls.

### Direct `databricks-tools-core` Adapter

Direct integration imports and calls `databricks-tools-core` functions in process.

Expected strengths:

- lower runtime overhead
- simpler unit testing and mocking
- direct control over auth, timeouts, cancellation, and output normalization
- easier enforcement of analyst-specific read-only guardrails
- no dependency on running a separate MCP server for the in-app runtime

Expected risks:

- the app may duplicate consolidation already present in MCP wrappers
- direct output shapes may differ from tool shapes used by existing agents
- external agents cannot automatically reuse the app's direct tool adapter

### `databricks-mcp-server` Adapter

MCP integration routes app-level tools through the existing MCP tool layer or a compatible in-process/test-client harness.

Expected strengths:

- reuses existing tool registration and consolidated wrappers
- keeps parity with external MCP clients
- can preserve existing MCP tool descriptions and conventions
- may reduce duplicate wrapper work if the MCP layer already shapes outputs well

Expected risks:

- extra protocol or process boundary if used as a running server
- harder cancellation and timeout behavior
- less direct control over app-specific tool schemas
- possible mismatch between Claude Agent SDK tool registration and MCP tool contracts

Phase 0 should not assume the answer. It should implement both behind the same app-owned tool interface, run parity tests, then record the phase 1 recommendation. The default hypothesis is direct `databricks-tools-core` for the in-app runtime, with MCP compatibility retained when parity or external-agent use matters.

## Skill Reuse Strategy

The third phase 0 concern is how to reuse existing Databricks skills as guidance for the analyst agent without depending on Claude Code's automatic skill loader. Phase 0 should implement an app-owned skill registry.

Skill registry responsibilities:

- load local `databricks-skills/<skill>/SKILL.md` files
- optionally load installed `.agents/skills` or `.claude/skills` paths
- parse skill name, description, trigger guidance, and source path
- allowlist the skills relevant to analyst workflows
- select skills from task type, active tool, and retrieved context
- trim skill content to a token budget
- render selected guidance into Claude Agent SDK instructions with source attribution

Initial allowlist:

- `databricks-python-sdk`
- `databricks-unity-catalog`
- `databricks-metric-views`
- `databricks-mlflow-evaluation`
- `instrumenting-with-mlflow-tracing`
- `databricks-config`

Skills that target excluded product surfaces should not be loaded by default for the analyst app. If a later workflow needs one, it should be added explicitly with an eval case.

## Configuration

Configuration should be environment-driven and safe to print in redacted diagnostics.

| Variable | Purpose |
|----------|---------|
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_TOKEN` | PAT for phase 0 authentication |
| `DATABRICKS_CLUSTER_ID` | General-purpose cluster used for execution |
| `ANTHROPIC_API_KEY` | Claude Agent SDK provider credential |
| `CLAUDE_AGENT_MODEL` | Default model for the Claude Agent SDK adapter |
| `ANALYST_TOOL_BACKING` | `tools_core`, `mcp`, or `hybrid` for adapter experiments |
| `ANALYST_SKILLS_ROOTS` | Optional colon-separated local skill roots |
| `ANALYST_SKILL_ALLOWLIST` | Optional comma-separated skill names for phase 0 |
| `MLFLOW_TRACKING_URI` | Optional MLflow tracking target for trace feasibility |

Secrets must not be committed to the repo. Local development should use `.env` files ignored by git.

## Development Environment Setup

Phase 0 must produce a repeatable backend-only feasibility environment. The goal is to make agent-runtime decisions executable and debuggable on a developer machine.

Required local capabilities:

- configured Databricks workspace, PAT, and general-purpose cluster
- Claude Agent SDK credentials
- local import path for `databricks-tools-core`
- local import path for `databricks-mcp-server`
- local access to Databricks skill markdown

Required setup artifacts:

- `.env.example` with all required variables and no secrets
- phase 0 test command for local debugging
- Claude Agent SDK adapter smoke test
- direct tools-core adapter smoke test
- MCP adapter/parity smoke test
- skill registry and selection smoke test
- Databricks PAT and cluster smoke test

The preflight command should be safe to run repeatedly. It should not mutate production data or create broad Databricks resources.

## Phase 0 Feasibility Evals

Phase 0 should include deterministic feasibility evals. These are not UI tests or model-quality evals; they test the runtime choices.

Suggested test layout once the app is scaffolded:

```text
databricks-analyst-app/
  server/
    tests/
      phase0/
        test_config.py
        test_claude_agent_sdk.py
        test_no_claude_code_subprocess.py
        test_tools_core_adapter.py
        test_mcp_adapter.py
        test_tool_adapter_parity.py
        test_skill_registry.py
        test_skill_selection.py
        test_databricks_smoke.py
        test_metric_views.py
```

Required checks:

| Check | Purpose | Pass condition |
|-------|---------|----------------|
| Config validation | Prove required environment variables are present and parseable | Missing or malformed config fails with actionable errors |
| Secret redaction | Prevent secrets from leaking into logs and traces | PAT and provider keys are masked in emitted diagnostics |
| Claude Agent SDK | Prove SDK integration is viable | SDK imports, mocked run succeeds, optional live run is gated |
| No Claude Code subprocess | Enforce serving-path constraint | Tests assert no `claude` or `claude-code` subprocess is invoked |
| Direct tools-core adapter | Prove in-process tool calls are viable | Selected tools can be called with normalized input/output |
| MCP adapter | Prove MCP-backed tool calls are viable | Selected MCP wrappers can be invoked through the app tool interface |
| Adapter parity | Compare direct and MCP behavior | Key tool outputs are equivalent or differences are documented |
| Skill registry | Prove local skill reuse | Allowlisted skills load with metadata and source paths |
| Skill selection | Prove relevant skill injection | Task cases select expected skills within token budget |
| Databricks PAT identity | Prove token auth works | Current-user or workspace identity lookup succeeds |
| Cluster availability | Prove configured compute exists | `DATABRICKS_CLUSTER_ID` resolves and is running or startable |
| Cluster SQL execution | Prove phase 0 execution path works | Bounded read-only `SELECT 1` succeeds on the configured cluster |
| Unity Catalog access | Prove metadata discovery works | Can list allowed catalogs/schemas or inspect a configured sample object |
| Metric views | Prove canonical metric decision is feasible | Can list or describe at least one configured UC metric view, or fail with a clear "no metric views configured" diagnostic |

The preflight command should group checks into tiers:

1. **Agent:** Claude Agent SDK, no subprocess enforcement, fake tool call.
2. **Tools:** direct tools-core adapter, MCP adapter, parity checks.
3. **Skills:** registry loading, allowlist filtering, selection, rendering.
4. **Databricks:** PAT identity, cluster availability, cluster SQL, UC metadata, metric views.

Example command shape:

```bash
uv run pytest databricks-analyst-app/server/tests/phase0 -v
```

The exact command can change with the scaffold, but phase 0 is not complete until equivalent checks exist and are documented.

## Authentication and Identity

Phase 0 uses PAT authentication.

The PAT is the Databricks identity for:

- metadata lookup
- metric view discovery and query
- cluster-backed SQL execution
- MLflow trace logging

Implications:

- The app does not yet provide per-user pass-through identity.
- Phase 0 should be treated as a trusted developer or controlled pilot mode.
- Audit trails in Databricks will reflect the PAT owner.
- Phase 0 diagnostics must show the active workspace and token-backed identity without exposing the token.

The backend should support one of two PAT input modes:

1. **Developer mode:** `DATABRICKS_TOKEN` is configured as an environment variable.
2. **Pilot mode:** a user provides a PAT through a secure session flow, and the app stores only an encrypted token reference or short-lived server-side session secret.

Phase 0 should prefer developer mode unless a pilot explicitly requires multiple users. Phase 3 should replace PATs with OAuth/OBO or an equivalent enterprise auth model.

## Databricks Execution

Phase 0 through phase 2 should execute analytical SQL on a general-purpose Databricks cluster, not a SQL warehouse.

Rationale:

- Clusters are easier to align with notebook-style data science workflows.
- Cluster execution leaves room for Python/Spark probes during discovery and validation.
- The app can avoid committing too early to warehouse-specific execution semantics while the agent loop is still evolving.

Execution adapter requirements:

- Use `DATABRICKS_CLUSTER_ID` as the default compute target.
- Execute read-only SQL and metadata probes through Databricks APIs.
- Enforce row limits, timeouts, cancellation, and result preview limits in the application layer.
- Block mutating SQL by default.
- Capture statement text, status, row count, result preview, latency, and error details.
- Return links to the relevant Databricks artifact when the platform provides one.

Phase 3 should revisit SQL warehouse execution after the discovery loop, validation checks, and eval harness are stable.

## Deferred Semantic Retrieval

Databricks Vector Search is not available in the target Databricks environment, so semantic retrieval is app-owned infrastructure. This is not a phase 0 concern; it starts when the context foundation work begins.

The planned context foundation should use PostgreSQL with pgvector for:

- context document embeddings
- semantic search over table, metric, annotation, code-enrichment, workflow, memory, and approved document chunks
- exact lookup and vector ranking in the same application database
- local development through a Postgres + pgvector container once semantic indexing starts
- VM/AKS deployment through managed or self-managed PostgreSQL with pgvector enabled

If Lakebase is considered for the application database, it must first satisfy the pgvector requirements. Otherwise, use external PostgreSQL for the app database and vector index.

The context service should hide the concrete vector implementation behind an adapter:

```text
ContextService
  |- exact lookup repository
  |- pgvector repository
  |- ranking service
  |- ACL metadata filter
```

The app should not call Databricks Vector Search or require a Databricks vector endpoint. If a deployment later provides a managed vector service, it can be added behind the same context service interface after evals prove equivalent or better retrieval quality.

## Metric Views

Unity Catalog metric views are the canonical metric system for the app.

The system should:

- Prefer metric views over raw table queries when a requested metric is available.
- Retrieve metric view definitions during offline context ingestion.
- Expose a `query_metric_view` tool as a first-class agent capability.
- Use metric views for reconciliation checks when generated SQL uses lower-level tables.
- Store metric view IDs, dimensions, measures, filters, and freshness metadata in context storage.

A separate metric registry should not be introduced in phase 0. If later required, supplemental metadata should augment metric views rather than replace them.

## Later Application Components

The following components are the expected full application shape after phase 0. They are not all phase 0 deliverables.

| Component | Responsibility |
|-----------|----------------|
| React workbench | Host shell, global ask, Story Canvas, StoryCards, right inspect panel, contextual actions |
| FastAPI API | Auth/session boundary, REST APIs, streaming, request validation |
| Agent runtime adapter | Claude Agent SDK integration, tool loop, cancellation, trace hooks |
| Databricks client adapter | Workspace, cluster, UC, metric views, MLflow APIs |
| SQL execution service | Read-only execution, limits, previews, status polling, errors |
| Context service | Exact lookup, pgvector retrieval, ranking, ACL metadata |
| Metric service | Metric view discovery, query construction, reconciliation support |
| Persistence layer | Sessions, messages, stories, story events, evidence blocks, runs, query runs, artifacts, feedback, eval cases |
| Background worker | Offline context ingestion, evals, report generation |

## Core Request Flow

1. User submits a business question from the global ask box or a contextual AI entry point.
2. Frontend creates an optimistic StoryCard in `planning` state and sends question plus explicit context to FastAPI.
3. FastAPI creates `analysis_story` and `analysis_run`, then starts a streaming response.
4. Context service retrieves candidate metric views, tables, prior runs, docs, and memories.
5. Agent adapter starts a Claude Agent SDK run with bounded context and analyst-safe tools.
6. Agent performs discovery before SQL generation and streams trace updates.
7. Metric service is used first when the question maps to a metric view.
8. SQL execution service runs bounded read-only SQL on the configured general-purpose cluster.
9. Validation checks inspect row counts, nulls, joins, freshness, and metric reconciliation.
10. Agent streams evidence blocks, conclusion updates, and next moves.
11. Backend stores run metadata, story events, trace IDs, SQL metadata, result previews, artifacts, and feedback hooks.

## Deferred Data Model Decisions

Phase 0 should not create the full application database schema. The following tables are planned for later phases once story persistence, context indexing, workflows, and memory are implemented.

Required tables:

- `analysis_sessions`
- `analysis_messages`
- `analysis_stories`
- `story_events`
- `evidence_blocks`
- `analysis_runs`
- `query_runs`
- `analysis_artifacts`
- `context_documents`
- `feedback`
- `eval_cases`

Tables that can be present but minimally used:

- `workflow_templates`
- `workflow_runs`
- `memories`
- `canvases`

Do not store full source datasets in the application database. Store previews, summaries, metadata, artifact pointers, and trace/query identifiers.

## Phase 0 Non-Goals

- UI implementation, frontend dev server, Story Canvas, or StoryCard work.
- Docker image packaging, VM deployment, AKS manifests, or release automation.
- PostgreSQL or pgvector setup.
- Semantic retrieval, embeddings, or context indexing.
- Full application persistence schema.
- Multi-user enterprise auth beyond PAT-based pilot use.
- SQL warehouse execution as the default path.
- Separate metric registry.
- Team/global memory approval workflow.
- Full code enrichment over all production pipelines.
- Databricks Vector Search dependency.
- Claude Code subprocess serving.
- Multi-agent runtime.
- Broad production rollout.

## Phase 3 Revisit Checklist

Before leaving phase 3, revisit:

- Replace PAT with OAuth/OBO or enterprise SSO-backed identity.
- Decide whether SQL warehouse execution should replace or complement cluster execution.
- Confirm whether metric views fully cover canonical business metrics.
- Confirm whether pgvector retrieval quality and operations are sufficient for production scale.
- Decide whether the Claude Agent SDK adapter needs model/runtime abstraction.
- Decide whether any Claude Code subprocess use is acceptable for offline development tooling.
- Validate VM and AKS deployment patterns against security and operations requirements.
