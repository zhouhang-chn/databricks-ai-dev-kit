# Databricks Analyst App System Design

## Purpose

This document resolves the phase 0 agent-runtime decisions for `databricks-analyst-app`. It is the implementation-facing companion to [`design.md`](design.md) and [`plan.md`](plan.md).

The agent-runtime choice is now **resolved**: the analyst app uses the **OpenAI Agents SDK with DeepSeek v4 Pro/Flash** models, based on working production evidence in `databricks-builder-app-oai/`. See [`gap-analysis-vs-oai.md`](gap-analysis-vs-oai.md) for the full comparison of carry-over vs net-new components.

Phase 0 should optimize for validating the analyst-specific pieces — tool contracts, system prompt, skill selection, and Databricks smoke checks — not for reproving runtime feasibility that the builder app already demonstrates.

## Decision Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent runtime | OpenAI Agents SDK via `databricks-builder-app-oai` adapter | Proven in production with DeepSeek v4 Pro/Flash via AI Gateway |
| Agent model (reasoning) | DeepSeek v4 Pro via AI Gateway | Default in builder app; strong tool-calling and reasoning |
| Agent model (lightweight) | DeepSeek v4 Flash via AI Gateway | Title generation, quick follow-ups |
| Model integration | `OpenAIChatCompletionsModel` + `AsyncOpenAI` | Any OpenAI-compatible API works without adapter changes |
| Databricks tool integration | `databricks-tools-core` direct + MCP for selected tools | Builder app proves both paths; analyst app uses same backing |
| Skill reuse | App-owned skill registry from builder app's `skills_manager.py` | Load and render existing local Databricks skill markdown |
| Claude Code subprocess | Not used (confirmed by builder app design) | Builder app validates the "no subprocess" approach |
| Authentication | PAT for phase 0; OAuth/OBO by phase 3 | Same as builder app's current multi-user auth model |
| Execution compute | General-purpose Databricks cluster | Revisit SQL warehouse by phase 3 |
| Canonical metrics | Unity Catalog metric views | Supplemental docs only if metric views don't cover required semantics |
| Persistence | Lakebase PostgreSQL + Alembic migrations | Proven in builder app; extend schema for analyst objects |
| Session management | OpenAI Agents SDK sessions (SQLite local → SQLAlchemy Lakebase) | Builder app's `openai_sessions.py` pattern |

## Proven Runtime Stack

The following components from `databricks-builder-app-oai` are production-proven and should be carried over, not rebuilt:

### OpenAI Agents SDK Runtime

```text
databricks-builder-app-oai/server/services/agent_runtime/
  ├── base.py               # AgentRuntime protocol + AgentRunRequest dataclass
  ├── openai_runtime.py      # Runner.run_streamed() with retry, cancel, events
  ├── openai_models.py       # DeepSeek v4 Pro/Flash via AI Gateway
  ├── openai_events.py       # SDK event → normalized app event mapper
  └── openai_sessions.py     # SQLite session persistence (upgrade to Lakebase)
```

Key patterns:
- `Runner.run_streamed()` with `max_turns=30`, `RunConfig` for tracing, `ModelRetrySettings` with jittered backoff
- `ModelRetrySettings` with `retry_policies.any()` covering network errors, 429, 502-504, retry-after, and provider-suggested retries
- Cancellation via `result.cancel()` with graceful drain
- Every event enriched with `project_id`, `conversation_id`, `execution_id`, `story_id`, `trace_id`
- `OpenAIChatCompletionsModel(model='deepseek-v4-pro', openai_client=AsyncOpenAI(base_url=..., api_key=...))` for any OpenAI-compatible endpoint

### Model Configuration

```bash
# AI Gateway (current production shape)
OPENAI_BASE_URL=https://your-ai-gateway.example.com/openai/v1
OPENAI_API_KEY=<gateway-api-key>
OPENAI_AGENT_MODEL=deepseek-v4-pro      # reasoning + tool calling
OPENAI_TITLE_MODEL=deepseek-v4-flash    # lightweight tasks
BUILDER_AGENT_RUNTIME=openai_agents
OPENAI_AGENTS_DISABLE_TRACING=1         # disable OpenAI-hosted tracing for AI Gateway
```

The `build_agent_model()` function in `openai_models.py` handles the distinction:
- If `OPENAI_BASE_URL` is set → `OpenAIChatCompletionsModel` with custom `AsyncOpenAI` client (AI Gateway path)
- If unset → plain model string (direct OpenAI path)

### Infrastructure

```text
databricks-builder-app-oai/
  ├── server/db/database.py          # Async SQLAlchemy + Lakebase
  ├── server/db/models.py            # Project / Conversation / Message / Execution
  ├── alembic/                       # Working migration infrastructure
  ├── server/services/active_stream.py    # Resumable SSE with events_json replay
  ├── server/services/skills_manager.py   # Skill load / filter / render
  ├── server/services/next_moves.py       # Follow-up generation
  └── server/services/mlflow_setup.py     # MLflow tracing integration
```

## Phase 0 Runtime Scope (Revised)

Phase 0 is **dramatically reduced** from the original plan because the agent runtime is proven. It is now focused on analyst-specific validation:

### What phase 0 still needs to prove:

1. **Analyst tool contracts** — Define the analyst-safe tool set (`search_context`, `describe_asset`, `query_metric_view`, `execute_sql`, `validate_sql`, `profile_result`) against `databricks-tools-core`.
2. **Analyst system prompt** — Write the discovery-first analyst prompt (Understand → Discover → Plan → Retrieve → Clarify → Generate → Validate → Execute → Analyze → Synthesize → Learn).
3. **Analyst skill allowlist** — Configure the skill registry for analyst workflows.
4. **Databricks smoke checks** — PAT identity, cluster execution, UC metadata, metric view access (same as original M0.2).

### What phase 0 no longer needs to prove:

- ~~Claude Agent SDK adapter feasibility~~ (eliminated — using OpenAI Agents SDK)
- ~~Claude Agent SDK mocked smoke test~~ (eliminated)
- ~~No Claude Code subprocess guard~~ (confirmed by builder app design)
- ~~MCP vs direct adapter comparison~~ (builder app proves both; use the same pattern)
- ~~Claude vs OpenAI SDK decision record~~ (resolved: OpenAI Agents SDK + DeepSeek v4)

## Runtime Topology

```text
Phase 0 test harness / backend sandbox
  ├── OpenAI Agents SDK runtime (from builder app)
  │   ├── OpenAIAgentRuntime.stream_response()
  │   ├── DeepSeek v4 Pro via AI Gateway
  │   └── Normalized event stream
  ├── App-owned analyst tool registry
  │   ├── execute_sql (read-only, bounded)
  │   ├── describe_uc_asset
  │   ├── describe_metric_view / query_metric_view
  │   └── get_current_identity / describe_compute
  ├── Skill registry (from builder app's skills_manager.py)
  │   └── Analyst skill allowlist
  └── Analyst system prompt

  | SQL / metadata / jobs / traces
  v
Databricks workspace
  ├── Unity Catalog
  ├── UC metric views
  ├── General-purpose cluster
  └── MLflow
```

## Configuration

Configuration follows the builder app's proven pattern:

| Variable | Purpose |
|----------|---------|
| `OPENAI_BASE_URL` | AI Gateway endpoint (OpenAI-compatible) |
| `OPENAI_API_KEY` | AI Gateway API key |
| `OPENAI_AGENT_MODEL` | Default: `deepseek-v4-pro` |
| `OPENAI_TITLE_MODEL` | Default: `deepseek-v4-flash` |
| `BUILDER_AGENT_RUNTIME` | `openai_agents` |
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_TOKEN` | PAT for phase 0 authentication |
| `DATABRICKS_CLUSTER_ID` | General-purpose cluster for execution |
| `ENABLED_SKILLS` | Comma-separated skill names for analyst workflows |
| `MLFLOW_TRACKING_URI` | `databricks` for Databricks-hosted MLflow |
| `MLFLOW_EXPERIMENT_NAME` | Experiment path for traces |
| `LAKEBASE_PG_URL` | PostgreSQL connection for persistence |

Secrets must not be committed to the repo. Local development should use `.env.local` (gitignored).

## Analyst Tool Contract

The analyst tool set is intentionally smaller and read-first compared to the builder app's CRUD surface.

| App tool | Purpose | Backing |
|----------|---------|---------|
| `get_current_identity` | Resolve active Databricks identity/workspace | `databricks-tools-core` identity |
| `describe_compute` | Inspect configured cluster and execution readiness | `databricks-tools-core` compute |
| `execute_sql` | Run bounded read-only SQL on general-purpose cluster | `databricks-tools-core` compute execution |
| `describe_uc_asset` | Inspect UC table/view/schema metadata | `databricks-tools-core` UC |
| `describe_metric_view` | Inspect UC metric view definition | `databricks-tools-core` metric views |
| `query_metric_view` | Query governed metric views | `databricks-tools-core` metric views |

Later phases add:
- `search_context` — semantic + exact context retrieval (phase 2)
- `validate_sql` — SQL parse/lint/dry-run/cardinality checks (phase 3)
- `profile_result` — result shape, nulls, outliers, distributions (phase 3)
- `create_chart_spec` — chart configuration from result data (phase 1)
- `manage_memory` — propose/approve/cite (phase 6)
- `run_workflow` — parameterized workflow execution (phase 5)
- `publish_report` — save report artifacts (phase 5)

## Skill Reuse Strategy

The builder app's `skills_manager.py` (22KB) provides a working skill registry that:

- Loads local `databricks-skills/<skill>/SKILL.md` files
- Parses skill name, description, trigger guidance
- Filters tools by enabled skills (`filter_openai_tools_by_skills`)
- Renders selected guidance into system prompt
- Supports per-project allowlist, env-var allowlist, and all-skills fallback

Analyst-specific skill allowlist:

- `databricks-python-sdk`
- `databricks-unity-catalog`
- `databricks-dbsql`
- `databricks-metric-views` (when available)
- `instrumenting-with-mlflow-tracing`

Skills that target excluded product surfaces (agent bricks, synthetic data gen, PDF generation) should not be loaded by default.

## Authentication and Identity

Phase 0 uses PAT authentication (same as builder app).

The builder app's multi-user auth chain (`X-Forwarded-Email` → `X-Forwarded-User` → Bearer token → PAT fallback) supports both Databricks Apps multi-user and local development. This carries over directly.

Phase 3 should replace PATs with OAuth/OBO.

## Databricks Execution

Phase 0 through phase 2: general-purpose Databricks cluster, not SQL warehouse.

Execution adapter requirements:
- Use `DATABRICKS_CLUSTER_ID` as the default compute target
- Execute read-only SQL through Databricks APIs
- Enforce row limits, timeouts, cancellation, and result preview limits
- Block mutating SQL by default (builder app's `_is_read_only_sql` check is a starting point)
- Capture statement text, status, row count, result preview, latency, and error details

## Deferred Semantic Retrieval

Same position as before: pgvector for app-owned semantic retrieval, not Databricks Vector Search. Not a phase 0 concern.

## Metric Views

Unity Catalog metric views are the canonical metric system. The builder app already has `manage_metric_views` tool — the analyst app needs the read-only subset: `describe_metric_view` and `query_metric_view`.

## Later Application Components

| Component | Responsibility | Source |
|-----------|---------------|--------|
| React workbench | Story Canvas, StoryCards, inspect panel | Extend builder app frontend |
| FastAPI API | Auth, REST APIs, streaming | Extend builder app server |
| Agent runtime adapter | OpenAI Agents SDK integration | **Carry over from builder app** |
| Databricks client adapter | Workspace, cluster, UC, metric views, MLflow | `databricks-tools-core` |
| SQL execution service | Read-only execution, limits, previews | Extend builder app's `execute_sql` |
| Context service | pgvector retrieval, ranking, ACL metadata | **Net-new** |
| Metric service | Metric view discovery, query, reconciliation | Extend builder app's metric view tools |
| Persistence layer | Analysis stories, evidence, feedback, evals | Extend builder app's Lakebase + Alembic |
| Background worker | Offline context ingestion, evals, reports | **Net-new** |

## Core Request Flow

1. User submits a business question from the global ask box.
2. Frontend creates an optimistic StoryCard in `planning` state, sends question + context to FastAPI.
3. FastAPI creates `analysis_story` and `analysis_run`, starts SSE stream.
4. Context service retrieves candidate metric views, tables, prior runs, docs, memories.
5. `OpenAIAgentRuntime.stream_response()` starts a DeepSeek v4 Pro run with analyst tools.
6. Agent performs discovery before SQL generation, streams trace updates via normalized events.
7. Metric service used first when question maps to a metric view.
8. SQL execution runs bounded read-only SQL on configured cluster.
9. Validation checks inspect row counts, nulls, joins, freshness, metric reconciliation.
10. Agent streams evidence blocks, conclusion, next moves.
11. Backend stores run metadata, story events, trace IDs, SQL metadata, result previews.

## Deferred Data Model Decisions

Phase 0 does not create the full application database schema. The builder app's existing `Project + Conversation + Message + Execution` tables remain. New tables added in later phases:

Phase 1: `analysis_stories`, `story_events`, `evidence_blocks`, `analysis_runs`, `query_runs`
Phase 4: `eval_cases`, `feedback`
Phase 5: `workflow_templates`, `workflow_runs`
Phase 6: `memories`
Phase 7: `context_documents`

## Phase 0 Non-Goals

- UI implementation, frontend dev server, Story Canvas, or StoryCard work
- Docker image packaging, VM deployment, AKS manifests
- PostgreSQL or pgvector setup
- Semantic retrieval, embeddings, or context indexing
- Full application persistence schema
- Multi-user enterprise auth beyond PAT-based pilot
- SQL warehouse execution as the default path
- Separate metric registry
- Team/global memory approval workflow
- ~~Claude Agent SDK feasibility proof~~ (resolved: OpenAI Agents SDK)
- ~~Claude vs OpenAI SDK comparison~~ (resolved)
- ~~No Claude Code subprocess guard~~ (confirmed by builder app)

## Phase 3 Revisit Checklist

Before leaving phase 3, revisit:

- Replace PAT with OAuth/OBO or enterprise SSO-backed identity
- Decide whether SQL warehouse execution should replace or complement cluster execution
- Confirm whether metric views fully cover canonical business metrics
- Confirm whether pgvector retrieval quality is sufficient for production scale
- Decide whether to support additional model providers beyond DeepSeek v4 via AI Gateway
- Validate deployment patterns against security and operations requirements
