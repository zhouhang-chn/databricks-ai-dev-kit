# Databricks Analyst App Build Plan

## Purpose

This plan turns the design in [`design.md`](design.md) into an incremental build path. It follows the construction pattern inferred in [`docs/refer/openai_data_agent_reverse_analysis_zh.md`](../refer/openai_data_agent_reverse_analysis_zh.md): start with a short governed analysis loop, invest early in context quality and table selection, add eval gates before broad rollout, then add memory and workflow reuse.

The app is not a Databricks App and should not depend on Databricks-native analyst product surfaces. It runs on external infrastructure such as a VM, Kubernetes, or AKS while using Databricks as the governed data plane.

## Build Strategy

1. **Shortest useful loop first.** Deliver one web surface, one backend, one cluster execution path, and one evidence-backed answer flow.
2. **Discovery quality before feature breadth.** Treat table and metric selection as the primary correctness problem.
3. **Ranked context, not raw context.** Aggregate and score metadata, usage, annotations, metric semantics, and docs before retrieval.
4. **Runtime probes as validation.** Use live Databricks checks to resolve uncertainty, not as the primary knowledge store.
5. **Evals before scale.** Every new tool, prompt, workflow, and model change should be regression-tested against golden business questions.
6. **Memory only with approval.** Corrections become reusable knowledge through an explicit proposal and review path.

## Phase 0: Development Environment and Feasibility

Goal: lock the first deployable shape, set up the local development environment, and prove the key architecture decisions are feasible. Phase 0 decisions and environment checks are resolved in [`system-design.md`](system-design.md).

Deliverables:

- Target deployment: local development, with frontend/backend packaged into a Docker image deployable to VM or AKS.
- Authentication approach: PAT until phase 3.
- Application database choice: PostgreSQL-compatible database with pgvector enabled.
- Local database setup: Docker Compose or equivalent local service for PostgreSQL with pgvector, plus migrations that enable and validate the extension.
- First business domain and seed metric set.
- Initial execution policy: general-purpose cluster until phase 3, with timeouts, row limits, and cost confirmation threshold.
- Decision on canonical metrics: UC metric views.
- Agent runtime approach: Claude Agent SDK through an application-owned adapter, without a Claude Code subprocess in the request path.
- Development environment setup: `.env.example`, local PostgreSQL + pgvector, backend health endpoint, frontend dev server, migrations, and Docker build path.
- Environment and infrastructure evals: repeatable checks for config, PAT auth, cluster execution, UC metric views, pgvector retrieval, Claude Agent SDK integration, no Claude subprocess usage, MLflow tracing, and Docker packaging.

Exit criteria:

- A developer can run frontend, backend, database migrations, and a cluster-backed Databricks SQL smoke test locally.
- A developer can index and retrieve at least one context document through pgvector locally.
- A developer can run a single preflight command or test suite that reports environment readiness with actionable failure messages.
- The preflight suite verifies PAT identity, configured cluster availability, read-only cluster SQL execution, metric view access or an explicit "not configured" diagnostic, pgvector extension health, Claude Agent SDK viability, and Docker image build health.
- Security model is documented with separate app, user, and worker identities.

## Phase 1: Shortest Governed Analysis Loop

Goal: answer a simple business question using the current user's Databricks permissions and show evidence.

Scope:

- React/Vite workbench with prompt bar, session list, answer view, and evidence drawer.
- FastAPI backend with session/message/run APIs.
- Databricks SQL execution on a configured general-purpose cluster.
- Read-only SQL guardrails, row limits, timeouts, cancellation, and statement links.
- Streaming run events over SSE or WebSocket.
- Minimal analyst loop: understand, plan, generate SQL, execute, summarize, cite evidence.
- Persistence for sessions, messages, runs, query runs, and artifacts.

Exit criteria:

- User can ask one approved domain question and receive summary, SQL, result preview, row count, table list, and caveats.
- Query execution respects the active PAT owner's UC permissions and fails closed when access is denied.
- Every run has an MLflow trace with plan, tool calls, SQL, latency, and output metadata.

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

- Personal memory proposal and approval flow.
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
- Evidence-backed answers with SQL, result preview, row counts, caveats, and validation checks.
- MLflow traces and eval report for every release candidate.

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

## Near-Term Backlog

1. Create `.env.example` and local setup scripts for backend, frontend, PostgreSQL, and pgvector.
2. Define database schema and migrations for sessions, runs, query runs, context documents, artifacts, feedback, eval cases, workflows, and memories.
3. Add local PostgreSQL + pgvector setup and migrations for context embeddings.
4. Add environment and infrastructure preflight tests for config, PAT auth, cluster execution, metric views, pgvector, Claude Agent SDK, MLflow, and Docker packaging.
5. Implement Databricks SQL execution adapter with read-only guardrails and statement links.
6. Build the first context ingestion job for UC metadata and metric views.
7. Create initial `search_context`, `describe_asset`, `execute_sql`, and `validate_sql` tool contracts.
8. Build a deterministic eval runner with 20 seed questions.
9. Implement the workbench answer layout and evidence drawer.
10. Add MLflow tracing around every agent run.
11. Package containers and deployment manifests for the chosen external runtime.
