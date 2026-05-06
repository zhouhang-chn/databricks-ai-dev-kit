# Databricks Analyst App Build Plan

## Purpose

This plan turns the design in [`design.md`](design.md) into an incremental build path. It follows the construction pattern inferred in [`docs/refer/openai_data_agent_reverse_analysis_zh.md`](../refer/openai_data_agent_reverse_analysis_zh.md): start with a short governed analysis loop, invest early in context quality and table selection, add eval gates before broad rollout, then add memory and workflow reuse.

The app is not a Databricks App and should not depend on Databricks-native analyst product surfaces. It runs on external infrastructure such as a VM, Kubernetes, or AKS while using Databricks as the governed data plane. (The Databricks App deployment option is retained as a secondary target since `databricks-builder-app-oai` proves it works.)

The phase ordering below is informed by [`gap-analysis-vs-oai.md`](gap-analysis-vs-oai.md), which compares the in-tree `databricks-builder-app-oai` reference implementation against the analyst-app design targets. Use that document to identify which pieces can be carried over from the OAI app and which require net-new construction.

## Agent Runtime: Resolved

The agent runtime is **resolved**: the analyst app uses the **OpenAI Agents SDK with DeepSeek v4 Pro/Flash** models via an AI Gateway OpenAI-compatible endpoint. This is the same stack proven in `databricks-builder-app-oai/`:

- `openai-agents[sqlalchemy]` — OpenAI Agents SDK with `Runner.run_streamed()`
- `deepseek-v4-pro` — agent reasoning and tool calling
- `deepseek-v4-flash` — title generation and lightweight tasks
- `OpenAIChatCompletionsModel` — wraps any OpenAI-compatible API
- `AgentRuntime` protocol — clean app-owned interface
- Retry, cancellation, session persistence, MLflow tracing — all proven

No Claude Agent SDK adapter is needed. See [`system-design.md`](system-design.md) for the full proven stack and carry-over component list.

## Build Strategy

1. **Leverage proven runtime.** Carry over the OpenAI Agents SDK adapter, event normalization, Lakebase persistence, skills manager, and MLflow wiring from `databricks-builder-app-oai` rather than rebuilding.
2. **Analyst tools and prompt first.** Define the analyst-safe tool surface and discovery-first system prompt before UI or packaging work.
3. **Shortest useful product loop next.** Deliver one web surface, one backend, one cluster execution path, and one evidence-backed Analysis Story flow.
4. **Discovery quality before feature breadth.** Treat table and metric selection as the primary correctness problem.
5. **Ranked context, not raw context.** Aggregate and score metadata, usage, annotations, metric semantics, and docs before retrieval.
6. **Runtime probes as validation.** Use live Databricks checks to resolve uncertainty, not as the primary knowledge store.
7. **Evals before scale.** Every new tool, prompt, workflow, and model change should be regression-tested against golden business questions.
8. **Memory only with approval.** Corrections become reusable knowledge through an explicit proposal and review path.

## Phase 0: Analyst Tool and Prompt Validation

Goal: validate the analyst-specific pieces — tool contracts, system prompt, skill selection — against the proven OpenAI Agents SDK runtime. Phase 0 is dramatically reduced from the original plan because the runtime is proven.

What phase 0 carries over from `databricks-builder-app-oai` (no work needed):

- OpenAI Agents SDK runtime adapter (`openai_runtime.py`)
- DeepSeek v4 Pro/Flash model configuration (`openai_models.py`)
- Normalized event stream (`openai_events.py`)
- `AgentRuntime` protocol and `AgentRunRequest` dataclass (`base.py`)
- Skills manager (`skills_manager.py`)
- MLflow tracing (`mlflow_setup.py`)

What phase 0 must prove:

- Analyst-safe tool contracts for identity, compute readiness, cluster execution, UC metadata, and metric views — wrapping `databricks-tools-core` in the same OpenAI function-tool shape the builder app uses.
- Analyst system prompt with discovery-first loop (Understand → Discover → Plan → Retrieve → Clarify → Generate → Validate → Execute → Analyze → Synthesize → Learn).
- Analyst skill allowlist: `databricks-python-sdk`, `databricks-unity-catalog`, `databricks-dbsql`, `instrumenting-with-mlflow-tracing`.
- Databricks smoke checks: PAT identity, cluster execution, UC metadata, metric view access.
- First business domain and seed metric set.
- Authentication: PAT until phase 3.
- Execution policy: general-purpose cluster until phase 3, with timeouts, row limits, and cost confirmation threshold.
- Decision on canonical metrics: UC metric views.

Deliverables:

- Backend-only test harness that validates analyst tool contracts against a configured Databricks workspace.
- Analyst system prompt module (new, reusing project-context rendering from builder app).
- Analyst tool registry (new, reusing `create_databricks_tools()` adapter pattern from builder app).
- Analyst skill allowlist configuration.
- Phase 0 readiness command: `uv run pytest tests/phase0 -v`.

Exit criteria:

- A developer can run the phase 0 test suite and get actionable pass/fail results for tool contracts, Databricks connectivity, and skill loading.
- The analyst system prompt can drive a simple tool-calling flow through the proven `OpenAIAgentRuntime`.
- The analyst tool set is small, orthogonal, and read-only by default.
- Skills load and render into agent instructions.

## Phase 1: Shortest Governed Analysis Loop

Goal: answer a simple business question using the current user's Databricks permissions and show evidence.

Scope:

- React/Vite workbench with global ask, left rail, Story Canvas, StoryCard, right inspect panel, and evidence drawer. (Extend builder app's existing frontend components.)
- FastAPI backend with session/story/action/run APIs. (Extend builder app's API layer.)
- Databricks SQL execution on a configured general-purpose cluster.
- Read-only SQL guardrails, row limits, timeouts, cancellation, and statement links.
- Streaming run events over SSE (reuse builder app's resumable SSE).
- Minimal analyst loop: understand, plan, generate SQL, execute, summarize, cite evidence.
- **Server-anchored persistence** for sessions, messages, stories, story events, evidence blocks, runs, query runs, and artifacts — from day one, not client-derived.
- Always-on MLflow tracing (not optional).

Exit criteria:

- User can ask one approved domain question and receive summary, SQL, result preview, row count, table list, and caveats.
- Query execution respects the active PAT owner's UC permissions and fails closed when access is denied.
- Every run has an MLflow trace with plan, tool calls, SQL, latency, and output metadata.
- Stories survive page reload (server-anchored, not client-projected).

## Phase 2: Context Foundation

Goal: improve table and metric selection before adding more product surfaces.

Scope:

- Offline context job for the first four Databricks-supported layers:
  - table metadata from Unity Catalog
  - usage and lineage from system tables/query history/jobs
  - human annotations from comments, tags, and curated markdown
  - semantic metrics from UC metric views
- Context storage in a PostgreSQL-compatible application database with ACL metadata.
- App-managed pgvector index for semantic retrieval plus exact lookup for tables, metrics, and workflows.
- Ranking features: certification, usage quality, freshness, owner, domain, metric match, and prior successful analyses.
- UI context preview for candidate assets.

Exit criteria:

- For golden questions, context retrieval returns the expected metric/table candidate in the top results.
- The agent explains why it chose one asset over alternatives.
- Retrieval logs capture context IDs and ranking signals for later evals.

## Phase 3: Discovery-First Agent Runtime

Goal: make the agent stay in discovery long enough to avoid confident wrong table selection.

Scope:

- Add explicit discover step before final plan.
- Candidate comparison for table, grain, metric definition, join keys, freshness, and caveats.
- Clarification policy for material ambiguity.
- SQL validation:
  - missing date filters
  - many-to-many joins
  - null-heavy join keys
  - stale source data
  - suspicious empty results
  - metric reconciliation failures
- Runtime probes for schema, freshness, samples, row counts, and query dry runs.
- Self-correction loop for failed probes or suspicious intermediate results.
- `validate_sql` and `profile_result` tools (new).

Exit criteria:

- Agent can reject a plausible but wrong table when context indicates a better certified asset.
- Empty or suspicious results trigger investigation before final answer.
- Final answers include assumptions, validation checks, and caveats.

## Phase 4: Evals and Release Gates

Goal: make correctness measurable before expanding users and workflows.

Scope:

- Golden question set for the first business domain.
- Expected SQL/result-frame comparison with tolerances.
- Graders for table choice, metric definition, filters, joins, caveats, chart choice, and narrative quality.
- MLflow eval tracking by domain, workflow, model, prompt version, and tool version.
- Canary workflow for prompt/tool/model changes.
- Feedback taxonomy in the UI: wrong metric, wrong table, wrong filter, stale data, bad chart, unclear answer.
- Deterministic eval mode in the `OpenAIAgentRuntime` adapter.

Exit criteria:

- CI or scheduled eval run produces pass/fail results and regression diff.
- New agent prompt/tool changes require eval review before production rollout.
- High-signal negative feedback can be converted into an eval candidate.

## Phase 5: Workflow Templates

Goal: turn repeated business analyses into reusable, parameterized plans.

MVP workflows:

- Weekly business review
- Anomaly investigation
- Metric/table discovery

Workflow capabilities:

- Versioned YAML or database-backed workflow definitions.
- Parameter schema, defaults, validation, and required metrics.
- Standard analysis sections, SQL checks, chart specs, and report outputs.
- Workflow run history and reusable evidence links.

Exit criteria:

- User can run a workflow with parameters and receive a repeatable report.
- Workflow output is reproducible from stored parameters, context IDs, SQL, and artifact metadata.
- Data scientists can inspect and edit workflow templates through code or an admin surface.

## Phase 6: Memory and Learning Loop

Goal: turn reviewed corrections into reusable context without silently changing behavior.

Scope:

- Personal memory proposal and approval flow ("Data agent wants to save 2 learnings to memory" — OAI pattern).
- Memory schema with scope, owner, TTL, confidence, source run, and review state.
- Memory retrieval with citation when used.
- Edit and delete path.
- Team/global memory review design, deferred until personal memory is reliable.

Exit criteria:

- Agent proposes memory only when it has explicit user correction or repeated validated evidence.
- Approved memory affects future answers and is cited in evidence.
- User can inspect, edit, or delete their memories.

## Phase 7: Code Enrichment

Goal: extract semantics that schema and query history cannot represent.

Scope:

- Select high-value assets based on certification, usage, workflow coverage, and eval failures.
- Locate production logic in Lakeflow pipelines, notebooks, jobs, and repository files.
- Extract structured table profiles:
  - purpose
  - grain
  - primary keys
  - freshness pattern
  - scope inclusions and exclusions
  - upstream derivation assumptions
  - downstream consumers
  - common joins and uniqueness expectations
- Write summaries back into context storage with evidence and confidence.

Exit criteria:

- Code-derived context improves retrieval or SQL correctness on tracked eval cases.
- Enrichment output includes source pointers and confidence, not just free-form summaries.
- Runtime agent consumes enriched semantics through the same context retrieval path.

## Phase 8: Production Hardening

Goal: prepare for broader enterprise usage.

Scope:

- Background worker scaling, retries, checkpointing, and resume.
- Tenant/workspace configuration model.
- Rate limits, concurrency controls, and compute cost controls.
- Disaster recovery for app database and artifacts.
- Security review for auth, secrets, logging, prompt injection, and data retention.
- Admin surfaces for domains, metrics, workflows, eval cases, and memory review.
- Multi-surface deployment (Slack / IDE / MCP) — plausible since the builder app already runs as both a web app and an MCP gateway.

Exit criteria:

- Load test covers concurrent sessions and long-running workflows.
- Security review findings are resolved or explicitly accepted.
- Operational dashboards cover latency, failures, cost, eval pass rate, feedback, and workflow reuse.

## Workstream Ownership

| Workstream | Primary responsibility |
|------------|------------------------|
| Application shell | React workbench, FastAPI API, auth, sessions, streaming |
| Databricks execution | SQL execution, cluster policy, UC permission behavior, query links |
| Context platform | offline jobs, context schema, ranking, pgvector retrieval, ACL filtering |
| Agent runtime | prompts, tool contracts, planning, discovery, validation, synthesis |
| Evals | golden sets, result comparison, graders, regression gates |
| Workflows | template format, run engine, reports, versioning |
| Memory | proposal/review UX, memory schema, retrieval and citation |
| Operations | deployment, observability, cost controls, security, disaster recovery |

## MVP Cut

The first shippable MVP should include phases 0-4 plus the first workflow from phase 5. Memory and code enrichment are important but should not block the initial governed analysis loop unless the first domain cannot meet eval thresholds without them.

MVP acceptance:

- 20-50 golden questions in one business domain.
- At least one canonical metric path.
- Pass-through Databricks permissions.
- Evidence-backed Analysis Stories with SQL, result preview, row counts, caveats, trace, next moves, and validation checks.
- MLflow traces and eval report for every release candidate.
- Stories survive page reload (server-anchored).

## Major Risks

| Risk | Mitigation |
|------|------------|
| Wrong table or metric selection | Discovery-first loop, ranked context, canonical metric preference, evals |
| Overuse of stale offline context | Freshness metadata and runtime probes for stale/conflicting context |
| Permission leakage through context retrieval | ACL metadata, UC permission filters, no broad source data copy |
| Tool confusion | Small orthogonal tool surface and explicit tool contracts |
| User distrust | Evidence drawer, caveats, query links, validation results |
| Cost spikes | Row/time limits, cluster policy, confirmation thresholds, caching |
| Memory corruption | Approval workflow, scopes, TTL, source evidence, delete/edit path |
| DeepSeek v4 model regression | Eval gates, golden question regression tests, model version pinning via AI Gateway |

## Near-Term Backlog

1. Create analyst tool registry wrapping `databricks-tools-core` in OpenAI function-tool shape.
2. Write analyst system prompt with discovery-first loop.
3. Configure analyst skill allowlist: `databricks-python-sdk`, `databricks-unity-catalog`, `databricks-dbsql`, `instrumenting-with-mlflow-tracing`.
4. Add Databricks smoke tests for PAT identity, cluster execution, UC metadata, and metric views.
5. Define first business domain and seed metric set.
6. Write phase 0 readiness test suite.
7. Plan schema migration for `analysis_stories`, `evidence_blocks`, `story_events` tables (phase 1 prep).
8. Move UI, Docker packaging, pgvector setup, and full persistence to phase 1+ implementation tasks.
