# Gap Analysis: `databricks-builder-app-oai` vs Analyst-App Design

## Purpose

This document compares the in-tree `databricks-builder-app-oai/` reference implementation against the analyst-app design targets described in:

- [`design.md`](design.md) — analyst-app product design
- [`plan.md`](plan.md) — phased build plan
- [`system-design.md`](system-design.md) — phase 0 runtime decisions

It also uses the production qualities described in:

- [`docs/refer/Inside OpenAI's in-house data agent.md`](../refer/Inside%20OpenAI%E2%80%99s%20in-house%20data%20agent.md)
- [`docs/refer/openai_data_agent_reverse_analysis_zh.md`](../refer/openai_data_agent_reverse_analysis_zh.md)
- [`docs/refer/data_agent_frontend_design_architecture_v3.pdf`](../refer/data_agent_frontend_design_architecture_v3.pdf)

The goal is to map what the analyst-app design would have to add, replace, or rebuild — and what can be carried over wholesale — to reach the target bar.

## Resolved: Agent SDK Choice

The original docs debated Claude Agent SDK vs OpenAI Agents SDK. That question is now **resolved in favor of OpenAI Agents SDK + DeepSeek v4** based on working production evidence:

- `databricks-builder-app-oai` runs the **OpenAI Agents SDK** (`openai-agents[sqlalchemy]>=0.1.0`) with `Runner.run_streamed()`, normalized event streaming, retry policies, cancellation, and session persistence — all proven in production.
- The model layer uses **DeepSeek v4 Pro** (agent reasoning) and **DeepSeek v4 Flash** (title generation, lightweight tasks) via an AI Gateway OpenAI-compatible endpoint ([`openai_models.py`](../../databricks-builder-app-oai/server/services/agent_runtime/openai_models.py)).
- The `OpenAIChatCompletionsModel` wrapper means any OpenAI-compatible API (AI Gateway, Azure OpenAI, direct OpenAI) works without adapter changes.
- MLflow tracing integration is wired and works alongside the Agents SDK tracing ([`mlflow_setup.py`](../../databricks-builder-app-oai/server/services/mlflow_setup.py)).

**Decision:** The analyst app adopts the OpenAI Agents SDK + DeepSeek v4 Pro/Flash stack directly. No Claude Agent SDK adapter is needed. Phase 0 milestones M0.1 (Claude Agent SDK Adapter) and M0.7 (Claude vs OpenAI decision record) are retired.

## TL;DR — What Remains

`databricks-builder-app-oai` is a **builder agent**, not an analyst agent. It is well-shaped as a multi-tenant Databricks Apps host with an OpenAI Agents SDK runtime, normalized event streaming, project-scoped skills, a real next-moves service, and a Story Canvas / Story Card / Right Inspect Panel frontend.

With the SDK choice resolved, the analyst direction needs three things the current app does not have (reduced from four):

1. **A different tool surface** — read-first analyst tools (canonical metric query, asset describe, validation, profiling) instead of `manage_*` resource-creation MCP tools.
2. **A grounded context fabric** — offline-built, ranked, multi-layer context retrieval; not project-settings injection at prompt time.
3. **A closed validation loop and analysis-object persistence** — runtime probes, metric reconciliation, self-correction, golden-SQL evals as a release gate, and server-anchored Analysis Story objects instead of client-derived projections.

## What `databricks-builder-app-oai` Already Proves (Carry Over)

These are production-shaped and should be carried into the analyst app directly.

### Runtime Foundation (proven, carry over as-is)

| Capability | Where | Notes |
|------------|-------|-------|
| OpenAI Agents SDK runtime | [`openai_runtime.py`](../../databricks-builder-app-oai/server/services/agent_runtime/openai_runtime.py) | `Runner.run_streamed()` with normalized events, cancellation, retry policies (`ModelRetrySettings` with jittered backoff), session persistence, `max_turns=30`. This is the production runtime — no "feasibility proof" needed. |
| DeepSeek v4 Pro/Flash via AI Gateway | [`openai_models.py`](../../databricks-builder-app-oai/server/services/agent_runtime/openai_models.py) | `OpenAIChatCompletionsModel` wrapping `AsyncOpenAI(base_url=..., api_key=...)`. Default models: `deepseek-v4-pro` (agent), `deepseek-v4-flash` (titles). Works with any OpenAI-compatible endpoint. |
| `AgentRuntime` protocol | [`base.py`](../../databricks-builder-app-oai/server/services/agent_runtime/base.py) | Clean `Protocol` with `stream_response(AgentRunRequest) -> AsyncIterator[dict]`. `AgentRunRequest` dataclass carries project/conversation/cluster/catalog/schema/warehouse/skills context. Analyst app can extend this, not rebuild it. |
| Normalized event stream | [`openai_events.py`](../../databricks-builder-app-oai/server/services/agent_runtime/openai_events.py) | Maps SDK events → `{text_delta, text, tool_use, tool_result, system, agent_updated}`. Defensive parsing with fallback. |
| Run metadata enrichment | [`openai_runtime.py:41-52`](../../databricks-builder-app-oai/server/services/agent_runtime/openai_runtime.py) | Every event gets `project_id`, `conversation_id`, `execution_id`, `story_id`, `trace_id`. Story-aware from day one. |

### Infrastructure (proven, carry over with minor adaptation)

| Capability | Where | Notes |
|------------|-------|-------|
| Multi-user header-based auth | [`user.py`](../../databricks-builder-app-oai/server/services/user.py) | `X-Forwarded-Email` / `X-Forwarded-User` / Bearer token chain. Supports Databricks Apps multi-user + PAT fallback. |
| Lakebase persistence + Alembic | [`database.py`](../../databricks-builder-app-oai/server/db/database.py), [`alembic/`](../../databricks-builder-app-oai/alembic/) | Working PostgreSQL-on-Databricks pattern with async SQLAlchemy + migrations. Direct reuse for analyst-app tables. |
| Resumable SSE streaming | [`active_stream.py`](../../databricks-builder-app-oai/server/services/active_stream.py), [`Execution.events_json`](../../databricks-builder-app-oai/server/db/models.py) | 50-second SSE windows, `events_json` replay on reconnect. |
| Project + project settings model | [`storage.py`](../../databricks-builder-app-oai/server/services/storage.py), [`project_config.py`](../../databricks-builder-app-oai/server/project_config.py) | Project-scoped `semantics`, `workflows`, `governance`, `agent_policy`, `memory.approved`, `resource_registry` as JSON in `settings`. Analyst app promotes these to first-class tables. |
| Skills loader + per-project allowlist | [`skills_manager.py`](../../databricks-builder-app-oai/server/services/skills_manager.py) | Loads markdown, gates tools by enabled skill, injects guidance into system prompt. Same pattern the analyst-app skill registry calls for. |
| MLflow tracing | [`mlflow_setup.py`](../../databricks-builder-app-oai/server/services/mlflow_setup.py) | `mlflow.openai.autolog()`, gated by `MLFLOW_EXPERIMENT_NAME`. |
| Next-moves service | [`next_moves.py`](../../databricks-builder-app-oai/server/services/next_moves.py) (32KB) | Heuristic + model-based follow-up generation with read-only-role gating, confidence scoring, source attribution. |

### Frontend Primitives (proven shapes, need data-flow inversion)

| Capability | Where | Notes |
|------------|-------|-------|
| Story Canvas / Card / Inspector | [`StoryCanvas`](../../databricks-builder-app-oai/client/src/features/analysis/components/), [`types.ts`](../../databricks-builder-app-oai/client/src/features/analysis/types.ts) | `AnalysisStory`, `EvidenceBlock`, `AnalysisStep`, `NextMove` types and rendering exist. Need server-side anchoring + richer evidence types. |
| Story event types | [`types.ts`](../../databricks-builder-app-oai/client/src/features/analysis/types.ts) | `AnalysisEvent` union type with `story.created`, `conclusion.appended`, `trace.appended`, `evidence.appended`, `next_moves.updated`. Close to design.md streaming contract. |
| Story transforms | [`storyTransforms.ts`](../../databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts) | Client-side story derivation from messages — this logic moves server-side in the analyst app, but the transformation rules are reusable reference. |

## What Needs to Change

### 1. Tool surface: builder → analyst

**Status: Rebuild surface, reuse adapter pattern**

Today's tool registration in [`databricks_openai.py`](../../databricks-builder-app-oai/server/services/tools/databricks_openai.py) exposes builder/CRUD tools: `manage_jobs`, `manage_pipeline`, `manage_dashboard`, `manage_uc_objects`, `manage_uc_grants`, etc., plus project file CRUD. The analyst-app tool set in [`design.md:322-338`](design.md) — `search_context`, `describe_asset`, `query_metric_view`, `execute_sql`, `validate_sql`, `profile_result`, `create_chart_spec`, `publish_report`, `manage_memory`, `run_workflow` — has almost no overlap.

Of the existing tools, only `execute_sql` (with stronger guardrails), `manage_metric_views` (read-only subset → `query_metric_view` + `describe_metric_view`), and `query_vs_index` survive. The `manage_*` resource-creation tools should be excluded from the analyst surface.

**Action:** New analyst tool registry wrapping `databricks-tools-core`. Reuse the `create_databricks_tools()` pattern and OpenAI function-tool adapter shape, but with an analyst-specific tool list. The MCP vs direct adapter question is a separate axis — the tool contracts are the same either way.

### 2. System prompt: build resources → analyze data

**Status: Rewrite**

[`system_prompt.py`](../../databricks-builder-app-oai/server/services/system_prompt.py) instructs the agent to propose plans before creating resources, maintain `AGENTS.md`, grant privileges, and use app tools. There is no instruction to discover before writing SQL, prefer canonical metric views, validate joins/freshness/null density, show evidence and caveats, or propose memory only on validated correction.

The analyst loop in [`design.md:307-321`](design.md) (Understand → Discover → Plan → Retrieve → Clarify → Generate → Validate → Execute → Analyze → Synthesize → Learn) requires a new system prompt module. Project-context rendering (`_render_project_context`) is reusable; the action-plan / resource-link / GRANT sections must be removed.

**Action:** New analyst system prompt module. Reuse `_render_project_context` and skill-guidance rendering.

### 3. Context: prompt-time settings → grounded fabric

**Status: Net-new (biggest gap)**

The current "context" is what `_render_project_context` puts in the prompt: project metadata, `metric_views`, `preferred_tables`, `deprecated_tables`, `sample_queries`, `glossary`, `caveats`, `pinned` resources. All hand-edited `settings_json`. No UC schema retrieval, no system-tables aggregation, no lineage walk, no embedding store, no ranked retrieval, no runtime probe.

**Action:** Net-new construction per [`design.md:266-305`](design.md). The OAI app contributes nothing beyond the pattern of "store project-level overrides in JSON" which can be a small per-project-config layer on top of the context fabric.

### 4. Validation and closed-loop

**Status: Net-new**

No SQL parse/lint/dry-run, no join/null/freshness detection, no metric reconciliation, no self-correction loop. `execute_sql` has a single read-only check and that is the entire validation surface.

**Action:** New `validate_sql` and `profile_result` tools plus agent-loop convention. The OpenAI Agents SDK runtime already supports tool→tool chaining within a single turn, so the runtime piece is in place.

### 5. Persistence: chat → analysis-object

**Status: Schema work**

Current schema: `Project + Conversation + Message + Execution(events_json)`. The frontend `AnalysisStory` is derived client-side from messages+events. Stories vanish on reload because there is no `analysis_stories` / `evidence_blocks` / `story_events` table.

**Action:** New tables via Alembic migration. The Lakebase + Alembic plumbing is reusable. Migration path: add `analysis_stories` + `evidence_blocks` + `story_events` first, write into them alongside `events_json`, then switch the frontend to read from the server-anchored story.

### 6. Memory: rendered-but-empty → propose / approve / cite

**Status: Net-new**

`settings.memory.approved` is rendered in the prompt if present. Nothing writes to it. No proposal API, no approval UI, no citation.

**Action:** New `memories` table; `manage_memory` tool with `propose` + `approve` + `delete`; new evidence-block type for "memory cited"; UI affordance.

### 7. Workflows: list-in-settings → executable templates

**Status: Net-new**

`settings.workflows.enabled` is rendered as a list. No template, no parameter schema, no executor.

**Action:** New `workflow_templates` + `workflow_runs` tables and executor per [`plan.md:131-152`](plan.md).

### 8. Evals

**Status: Net-new**

No `eval_cases` table, no golden-question set, no result comparator.

**Action:** New module dependent on analysis-object-first schema and always-on MLflow tracing.

### 9. Frontend: client-derived stories → server-anchored stories

**Status: Components reusable, data flow inverts**

The `StoryCanvas` / `StoryCard` / `RightInspectPanel` exist. But:
- Story is rebuilt client-side; reload loses structure
- `EvidenceType` is `'text' | 'table' | 'chart' | 'tool_result' | 'error'` — no `kpi`, `caveat`, `query_link`, `metric_card`, `freshness_badge`
- No charting integration
- No "save / pin / fork / share" affordances

**Action:** Anchor frontend story to backend tables, extend `EvidenceType`, add charting. Component skeleton reusable, data flow inverts.

## Gap Matrix

| Dimension | OAI app today | Analyst-app target | Verdict |
|-----------|---------------|-------------------|---------|
| Agent runtime (SDK) | OpenAI Agents SDK + DeepSeek v4 Pro/Flash, proven | Same | **Carry over** |
| Runtime adapter | `AgentRuntime` protocol, `OpenAIAgentRuntime`, streaming, cancellation, retry | Extend with eval mode | **Carry over + extend** |
| Session management | SQLite-backed `openai-agents` sessions | Promote to Lakebase SQLAlchemy sessions | **Carry over + migrate** |
| Tools | Builder `manage_*` set, project file CRUD | `search_context`, `describe_asset`, `query_metric_view`, `validate_sql`, `profile_result`, `manage_memory`, `run_workflow` | **Rebuild surface** |
| System prompt | "Plan before creating resources" | Discovery → validate → evidence → propose memory | **Rewrite** |
| Context | Project-settings JSON | UC + system tables + annotations + metric views + pgvector + memory + runtime probes | **Net-new** |
| Validation | Read-only SQL gate only | Parse / dry-run / cardinality / freshness / nulls / metric reconciliation / re-plan | **Net-new** |
| Memory | Settings field rendered if non-empty; no propose / approve | `memories` table; propose / approve / cite | **Net-new** |
| Workflows | Settings list, no executor | `workflow_templates` + `workflow_runs`; YAML template | **Net-new** |
| Frontend | Story Canvas / Card / Inspector; client-derived; limited evidence types | Server-anchored stories; rich evidence types; trace inspector | **Components reusable, data flow inverts** |
| Persistence | `Project + Conversation + Message + Execution` | + `analysis_stories`, `evidence_blocks`, `story_events`, `memories`, etc. | **Schema work** |
| Evals | None | Golden questions, SQL comparator, MLflow regression tracking | **Net-new** |
| Observability | MLflow optional, off by default | Always-on MLflow trace | **Wiring exists, defaults flip** |
| Auth | Header-based multi-user for Databricks Apps + PAT fallback | Same for phase 0; OAuth/OBO by phase 3 | **Reusable** |
| Deployment | Databricks App | External (VM / k8s / AKS) or Databricks App | **Tension to resolve** |

## Strategic Recommendation

The OAI app is best treated as a **runtime + plumbing foundation**, not a feature reference.

### Carry over directly (no rebuild needed):
- OpenAI Agents SDK + DeepSeek v4 Pro/Flash runtime stack
- `AgentRuntime` protocol and `OpenAIAgentRuntime` implementation
- `openai_events` normalization
- `Execution`-backed resumable SSE
- Multi-tenant Lakebase persistence + Alembic
- Project + skills + project-config rendering
- `next_moves.py` (with read-only-role tightening)
- `mlflow_setup.py` wiring
- `AgentRunRequest` dataclass (extend, don't replace)

### Rebuild against analyst goals:
- Tool registry (new analyst-safe tools)
- System prompt (new analyst loop)
- Frontend evidence types and inspector (extend existing)
- Frontend → backend story anchoring (data flow inversion)

### Build new (no starting point in the app):
- Context fabric (offline + retrieval + pgvector)
- Validation tools and closed-loop convention
- Memory propose/approve/cite
- Workflow template + executor
- Eval harness with golden SQL

### Resolve before phase 1:
- Deployment target: Databricks App vs external vs both
- Whether the analyst app forks `databricks-builder-app-oai` or imports its modules

## Phase Mapping

How the gaps map onto the build plan ([`plan.md`](plan.md)):

| Plan phase | Impact from this analysis |
|------------|--------------------------|
| Phase 0 (runtime feasibility) | **Dramatically reduced scope.** Claude Agent SDK adapter (M0.1) is eliminated. Runtime is proven — no "feasibility" step needed. Remaining: tool contract definition (M0.5), skill allowlist (M0.6), Databricks smoke checks (M0.2). M0.3/M0.4 (MCP vs direct adapter comparison) can be simplified since the OAI app already uses MCP tools through `databricks-tools-core`. M0.7 (decision record) writes itself: "use what works." |
| Phase 1 (shortest analysis loop) | Persist `analysis_stories` / `evidence_blocks` / `story_events` from day one. Default MLflow tracing on. Reuse `OpenAIAgentRuntime` for agent runs. |
| Phase 2 (context foundation) | Unchanged — largest gap, no reusable starting point. |
| Phase 3 (discovery-first runtime) | Validation tools (`validate_sql`, `profile_result`) ship here. |
| Phase 4 (evals and gates) | Add deterministic eval mode to the runtime adapter. |
| Phase 5 (workflows) | Unchanged. |
| Phase 6 (memory) | Design propose/approve/cite UX before building. |
| Phase 7 (code enrichment) | Unchanged. |
| Phase 8 (production hardening) | Multi-surface deployment is plausible — keep the option open. |

## Open Questions (Updated)

- ~~Does the analyst app use Claude Agent SDK or OpenAI Agents SDK?~~ **Resolved: OpenAI Agents SDK + DeepSeek v4.**
- Is the analyst app a fork of `databricks-builder-app-oai` or a new project that imports its adapter / skills loader / Lakebase plumbing as libraries?
- Does the design.md "external deployment only" stance hold once a working Databricks Apps reference exists?
- For phase 2 context: is institutional knowledge in scope, or only the four Databricks-platform layers?
- Does the analyst app need a "save learning?" prompt at end-of-turn?

## Cross-Reference

- [`design.md`](design.md) — analyst-app product design
- [`frontend-design.md`](frontend-design.md) — frontend architecture, component tree, type extensions, carry-over inventory
- [`plan.md`](plan.md) — phased build plan
- [`system-design.md`](system-design.md) — phase 0 runtime decisions
- `databricks-builder-app-oai/` — in-tree reference implementation analyzed above
- [`docs/refer/Inside OpenAI's in-house data agent.md`](../refer/Inside%20OpenAI%E2%80%99s%20in-house%20data%20agent.md)
- [`docs/refer/openai_data_agent_reverse_analysis_zh.md`](../refer/openai_data_agent_reverse_analysis_zh.md)

