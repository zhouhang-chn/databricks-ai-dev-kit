# Databricks Analyst App Design

## Summary

`databricks-analyst-app` is an externally hosted conversational analytics application for business-oriented analysis on Databricks data. It is designed for data scientists and business users who need trustworthy answers, repeatable analytical workflows, and clear evidence trails without manually finding tables, writing SQL, debugging joins, or building one-off charts.

The app is inspired by the design lessons in [`docs/refer/Inside OpenAI’s in-house data agent.md`](../refer/Inside%20OpenAI%E2%80%99s%20in-house%20data%20agent.md), the reverse analysis in [`docs/refer/openai_data_agent_reverse_analysis_zh.md`](../refer/openai_data_agent_reverse_analysis_zh.md), and the frontend architecture guidance in [`docs/refer/data_agent_frontend_design_architecture_v3.pdf`](../refer/data_agent_frontend_design_architecture_v3.pdf): high-quality data agents need rich context, discovery-first table selection, closed-loop self-correction, reusable workflows, continuous evaluation, pass-through security, and a frontend that treats each answer as an operable analysis object. The Databricks version should ground those ideas in Unity Catalog, metric views, general-purpose cluster execution for the first phases, app-managed semantic retrieval such as pgvector, a PostgreSQL-compatible application database, system tables, and governed enterprise data access.

## Goals

- Let business users ask natural-language questions and receive concise, decision-ready answers with charts, assumptions, caveats, and links to supporting queries.
- Let data scientists inspect and refine the analysis plan, SQL, intermediate results, and statistical methods.
- Reduce time spent on data discovery by retrieving governed context about tables, metrics, lineage, owners, usage, and prior analyses.
- Prefer canonical metrics and certified data assets over ad hoc table exploration.
- Support iterative analysis: follow-ups, drill-downs, cohort cuts, anomaly explanations, and comparisons should preserve context.
- Treat each agent answer as an Analysis Story with evidence, trace, context, next moves, and save/share affordances rather than as a disposable chat message.
- Package repeated analyses into reusable workflows such as weekly business reviews, launch readouts, churn diagnostics, and metric QA.
- Build trust through transparent evidence, query validation, evals, user feedback, and memory proposals that require approval.

## Non-goals

- Replacing notebooks or Databricks SQL. The app orchestrates governed data access and links users back to source artifacts.
- Becoming a general coding agent. It should be analysis-first and restrict tools to data discovery, SQL, visualization, reporting, and governed publishing.
- Bypassing Unity Catalog permissions or duplicating enterprise access control.
- Deploying the app as a Databricks App. The application runtime should run on external infrastructure such as VMs, Kubernetes, or AKS.
- Guaranteeing every answer is correct without user review. The product must expose enough evidence for users to verify high-stakes answers.

## Target Users

| Persona | Needs | Product behavior |
|---------|-------|------------------|
| Business user | Fast answers, plain-English explanations, charts, trusted metrics | Hides SQL by default, shows assumptions and source links, offers guided follow-ups |
| Data scientist | Deeper methods, SQL inspection, experiment/cohort analysis, repeatability | Shows plan, generated SQL, intermediate checks, export to notebook/report |
| Analytics engineer | Metric governance, table definitions, lineage, data quality, usage feedback | Surfaces certified assets, captures corrections, updates context and workflow templates |
| Executive/stakeholder | Business health and changes over time | Produces polished summaries, KPI cards, trend charts, and caveat-aware narratives |

## Core Product Principles

1. **Canonical first.** Prefer Unity Catalog metric views, certified tables, and curated metric documentation before exploratory raw tables.
2. **Discovery before SQL.** Spend effort choosing the right metric, table, grain, and business interpretation before generating the final query.
3. **Evidence over assertion.** Every answer should include source assets, executed query links, row counts, freshness, filters, and caveats.
4. **Closed-loop analysis.** The agent should detect empty results, suspicious joins, outliers, null explosions, unexpected metric shifts, and performance issues, then revise its approach.
5. **Ask when ambiguity matters.** If metric definition, date range, cohort, or business scope changes the answer materially, ask a clarifying question. Otherwise apply explicit defaults and label them.
6. **Reusable work.** Repeated analyses should become workflows with parameterized instructions and validation checks.
7. **Governed memory.** Corrections and business definitions can be saved only with user approval, scoped personally, to a team, or globally.

## Key User Journeys

### 1. Business Question to Answer

Example: "Why did enterprise ARR growth slow last month?"

1. App classifies intent as metric explanation and anomaly analysis.
2. Retrieves canonical ARR metric definition, certified finance tables, recent usage context, known incidents, and relevant prior memories.
3. Builds an analysis plan with date range, comparison baseline, segments, and validation checks.
4. Runs SQL against a configured general-purpose cluster using the active Databricks token.
5. Validates row counts, freshness, nulls, and segment totals against the canonical metric.
6. Returns an executive summary with drivers, charts, caveats, SQL/result links, and suggested follow-ups.

### 2. Data Scientist Deep Dive

Example: "Break retention by first-week activation behavior and test whether the change is statistically meaningful."

The app should expose:

- cohort definition and inclusion/exclusion criteria
- generated SQL and CTE structure
- intermediate result tables
- statistical test choice and limitations
- export to notebook for further refinement

### 3. Recurring Workflow

Example: "Run the weekly growth review for EMEA."

The app loads a workflow template with parameters:

- region
- reporting week
- canonical metrics
- required slices
- validation checks
- output format

The result is a report with standardized sections and reproducible queries.

### 4. Metric or Table Discovery

Example: "Which table should I use for daily active paid workspace users?"

The app should compare candidates by:

- certification status
- grain and primary keys
- inclusion/exclusion rules
- freshness and SLA
- downstream jobs and dependent data products
- common joins and caveats
- owner and documentation

## User Experience

The first screen should be an analysis workbench, not a chat-only page or a marketing page. The center of the product is a Story Canvas: a list or grid of Analysis Stories that can be inspected, continued, forked, pinned, saved, and shared.

Desktop shell:

- Top bar: workspace switcher, global ask box, time range, save, share, and account/status controls.
- Left rail: new analysis, recent threads, saved stories, dashboards/canvases, workflows, and memory.
- Main canvas: user question, streaming StoryCards, evidence blocks, next moves, and inline follow-up composer.
- Right inspect panel: filters, trace inspector, evidence details, metadata, context, artifacts, and actions for the active story.

Responsive behavior:

- Left and right panels are collapsible on desktop; the main canvas remains available.
- On mobile, the main view becomes a single-column Story Canvas, navigation moves to bottom navigation or a drawer, and inspect opens as a half-sheet.
- Closing a side panel should never remove the ability to continue the current analysis.

StoryCard layout:

1. **Question:** the normalized business question and active context.
2. **Conclusion:** current best answer in one short section.
3. **Evidence:** KPI, chart, table, narrative, caveat, and query/result evidence blocks.
4. **Trace:** visible but compact list of analysis actions already taken.
5. **Next moves:** a small set of explicit actions such as break down, compare, drill down, change metric, apply filter, validate hypothesis, or save story.
6. **Governance:** source assets, metric views, freshness, permissions, execution links, and memory/context used.

Advanced mode for data scientists:

- show analysis plan
- show all SQL
- show validation checks
- show intermediate result tables
- export to notebook
- save as workflow

### Analysis Story Object Model

Analysis Story is the frontend's first-class business object. Chat messages can exist for conversational continuity, but persistence, inspection, sharing, and follow-up should be anchored on stories.

```ts
type AnalysisStory = {
  id: string
  question: string
  status: 'planning' | 'running' | 'done' | 'error'
  summary?: string
  conclusion?: string
  evidence: EvidenceBlock[]
  trace: AnalysisStep[]
  nextMoves: NextMove[]
  context: AnalysisContext
  layout: StoryLayout
  persistedAs?: { type: 'dashboard' | 'saved_story'; id: string }
}

type AnalysisContext = {
  assetId?: string
  timeRange?: TimeRange
  filters: Filter[]
  metrics: string[]
  dimensions: string[]
  selection?: SelectionState
}
```

Important modeling rule: context must be explicit. The app should not depend on implicit chat history to know the active filters, time range, selected metric, evidence block, or semantic asset.

### Frontend Architecture

The frontend should use a layered architecture:

| Layer | Responsibility |
|-------|----------------|
| Host shell | Routing, auth boundary, workspace switching, theme, navigation, responsive shell |
| AI surface | Global ask, contextual ask buttons, suggested next moves, inline composer |
| Story/Canvas layer | StoryCard rendering, evidence blocks, canvas layout, saved story/dashboard composition |
| Application state | Workspace state, conversation state, UI state, active story and selected evidence |
| Event bus/controller | Standard analysis actions, streaming event reducer, user/agent action coordination |
| Runtime boundary | Backend API client; sends analysis intent and context rather than SQL or component-level instructions |

State should be split at minimum into:

- `WorkspaceStore`: stories, story order, active story, canvas layout.
- `ConversationStore`: user/assistant turns and branch history.
- `UIStore`: right panel tab, panel open state, selected evidence block, local loading state.

The same action vocabulary should drive both agent trace and user next moves. Initial actions should include `OBSERVE_TREND`, `BREAKDOWN`, `DRILL_DOWN`, `COMPARE`, `FORM_HYPOTHESIS`, `VALIDATE_HYPOTHESIS`, `PIVOT`, `CHANGE_METRIC`, and `APPLY_FILTER`.

### Streaming Strategy

Story streaming should fill the card progressively:

1. `story.created`
2. normalized question and context
3. first trace step
4. first evidence block
5. additional trace/evidence updates
6. conclusion update
7. next moves update
8. final governance and artifact links

This keeps the product from feeling like a blank waiting state and makes the analysis process inspectable.

## Architecture

```
React Analyst UI
  |
  | /api/*
  v
Externally hosted FastAPI Analyst Backend
  |
  | orchestration, auth, execution state, memory, workflow registry
  v
Analyst Agent Runtime
  |
  | planning, context retrieval, SQL generation, validation, synthesis
  v
Databricks Services
  |
  | Unity Catalog, metric views, general-purpose clusters, system tables,
  | Jobs, MLflow

Application Data Services
  |
  | PostgreSQL-compatible app database, pgvector context index, object storage
```

Recommended implementation shape:

- Use an external deployment pattern: React/Vite frontend, FastAPI backend, background workers, application database, object storage for artifacts, and SSE/WebSocket streaming.
- Support VM, Kubernetes, and AKS deployment targets with container images and environment-based configuration.
- Use Databricks APIs for governed access to Databricks data, with general-purpose cluster execution until phase 3.
- Start with a single main analyst agent loop rather than a premature multi-agent system; specialize through tools, context, workflows, and validation gates first.
- Narrow the agent tool surface to analyst-safe, orthogonal operations with minimal overlap.
- Use the Claude Agent SDK through an application-owned adapter; avoid running a Claude Code instance as a subprocess in the serving path.
- Keep frontend components behind a runtime boundary: UI emits analysis intent, context, and action events; backend owns planning, SQL generation, execution, and validation.
- Add a context retrieval service and a workflow registry.
- Store analysis sessions, query runs, feedback, approved memories, workflow definitions, context documents, and embeddings in a PostgreSQL-compatible application database with pgvector enabled.
- Use MLflow tracing and evaluations for quality measurement.

## Deployment Model

The app should run outside Databricks on customer-managed infrastructure:

| Layer | Recommended options |
|-------|---------------------|
| Frontend | Static assets served by CDN, ingress controller, or FastAPI |
| API | FastAPI container on VM, Kubernetes, or AKS |
| Worker | Separate container/process for long-running enrichment, evals, and report generation |
| Database | PostgreSQL-compatible application database with pgvector enabled |
| Cache/queue | Redis, managed queue, or database-backed job queue |
| Secrets | Cloud secret manager or Kubernetes secrets |
| Artifacts | Cloud object storage or Unity Catalog volumes |
| Observability | MLflow traces plus platform logs/metrics |

Databricks remains the governed data plane. The external app should never copy broad source datasets into its own database. It should store metadata, result previews, report artifacts, and links to Databricks query results.

Authentication model:

- Phase 0 uses PAT-based Databricks access for local development and controlled pilots.
- Phase 3 should replace PATs with user OAuth/OBO or an equivalent enterprise identity flow.
- Background enrichment can use a separately configured worker identity once the worker is split from the API.
- Fine-grained authorization is enforced through Unity Catalog permissions for the active token and app-level session ownership.

## Context System

The app should use layered context as a Databricks adaptation of the reverse-analysis context fabric. The first four layers should be supportable by Databricks platform services and metadata internally. Layers after that can be app-owned enrichment, enterprise knowledge integration, memory, and live runtime validation. The runtime should retrieve, rank, and normalize context before the agent sees it; raw logs and broad documentation should not be passed directly into prompts.

| Layer | Databricks source | Purpose |
|-------|-------------------|---------|
| Table metadata | Unity Catalog schemas, comments, tags, owners, stats | Ground SQL generation in actual assets |
| Usage and lineage | System tables, query history, lineage, jobs | Find commonly used tables and joins |
| Human annotations | UC comments/tags, metric documentation, curated markdown in volumes | Capture business meaning and caveats |
| Semantic metrics | UC metric views | Prefer governed business definitions |
| Code enrichment | Lakeflow pipelines, notebooks, job source, repo files | Explain how tables are produced and refreshed |
| Institutional knowledge | App-owned pgvector index over approved docs or app-owned document index | Bring in launches, incidents, policies, glossary |
| Memory | Application database personal/team/global memory tables | Reuse approved corrections and learned constraints |
| Runtime context | Live SQL probes, table samples, freshness checks | Validate the current state of data |

The ordering is intentional: table metadata, usage/lineage, human annotations, and semantic metrics map to platform-governed context. Code enrichment comes after those because it should be an enrichment pipeline that reads production logic and writes structured semantics back into the context layer, not an uncontrolled runtime code-reading step.

### Offline Enrichment Pipeline

A scheduled Databricks Job should build and refresh analyst context:

1. Inventory UC tables, views, metric views, jobs, and notebooks.
2. Pull table comments, column comments, tags, owners, lineage, row counts, freshness, and data quality signals.
3. Aggregate query history to infer popular assets, common joins, filters, and metric usage patterns; weight certified reports and recurring executive analyses above exploratory one-off queries.
4. Run code-enrichment tasks for high-usage assets to extract grain, primary keys, freshness, upstream logic, downstream consumers, and caveats.
5. Normalize context into chunked documents with ACL metadata.
6. Generate embeddings and index chunks in the app-managed pgvector store.
7. Write compact summaries to the application database for fast exact lookup.

### Runtime Retrieval

At query time:

1. Parse user intent, entities, metrics, date range, and business domain.
2. Retrieve exact matches for metric names, table names, report names, and workflow names.
3. Retrieve semantic matches from the app-managed pgvector index with permission filters.
4. Rank results by certification, usage quality, freshness, ownership, and relevance.
5. Pass only the top context into the agent.
6. Use runtime probes only when offline context is missing, stale, conflicting, or insufficiently specific.
7. Log retrieved context IDs and runtime probes for audit and evaluation.

## Agent Runtime

The agent should run an explicit loop:

1. **Understand:** classify task type and extract constraints.
2. **Discover:** compare candidate metrics, tables, joins, grains, caveats, and prior usage before committing to a data path.
3. **Plan:** produce an analysis plan with data assets, metrics, validation checks, and expected output.
4. **Retrieve context:** call context service and, if needed, live metadata tools.
5. **Clarify or default:** ask a question when ambiguity is material; otherwise set labeled defaults.
6. **Generate SQL:** prefer metric views and certified assets.
7. **Validate SQL:** parse, lint, dry run where possible, inspect join cardinality, freshness, nulls, row counts, and metric reconciliation.
8. **Execute:** run on the configured general-purpose cluster with row/time limits.
9. **Analyze:** compute summaries, charts, deltas, attribution, and statistical tests where appropriate.
10. **Synthesize:** produce answer with evidence and caveats.
11. **Learn:** propose memories or workflow updates for user approval.

## Tool Surface

Initial tools should be intentionally consolidated to avoid overlapping choices.

| Tool | Capability |
|------|------------|
| `search_context` | Search table, metric, report, workflow, memory, and document context |
| `describe_asset` | Return UC asset metadata, lineage, freshness, owners, comments, tags |
| `query_metric_view` | Query governed metric views with dimensions, filters, and time grain |
| `execute_sql` | Run bounded SQL on the configured general-purpose cluster |
| `validate_sql` | Parse/lint SQL, estimate risk, check joins and filters |
| `profile_result` | Summarize result shape, nulls, outliers, distributions |
| `create_chart_spec` | Produce chart configuration from result data |
| `publish_report` | Save report metadata, chart specs, narrative, and links to generated artifacts |
| `manage_memory` | Propose, approve, edit, delete personal/team/global memories |
| `run_workflow` | Execute a parameterized workflow template |

Avoid exposing low-level Databricks CRUD tools in the first version unless needed for a workflow. Business users should not be able to accidentally create infrastructure from the analyst UI.

## Data Model

Application database tables:

| Table | Purpose |
|-------|---------|
| `analysis_sessions` | Conversation/session metadata, user, title, domain, status |
| `analysis_messages` | User and assistant messages |
| `analysis_stories` | First-class story objects with question, status, conclusion, context, layout, and saved state |
| `analysis_runs` | One agent execution with plan, status, cost, latency |
| `query_runs` | SQL text, cluster ID, statement/run ID, row count, result preview, validation state |
| `evidence_blocks` | KPI, chart, table, narrative, caveat, and query/result blocks attached to stories |
| `story_events` | Streaming story lifecycle events and normalized analysis actions |
| `analysis_artifacts` | Charts, reports, exported files, notebook exports |
| `context_documents` | Compact indexed context metadata and ACL pointers |
| `memories` | Approved learned facts with scope, owner, TTL, source run, review state |
| `workflow_templates` | Parameterized recurring analyses |
| `workflow_runs` | Workflow execution state and outputs |
| `canvases` | Saved or active story layouts that can later become dashboard-like assets |
| `feedback` | User rating, corrections, comments, linked eval case |
| `eval_cases` | Golden prompts, expected SQL/results, tags, owner |

Result data should not be copied wholesale into the application database by default. Store previews, summaries, and links to Databricks execution results or governed output tables.

## API Sketch

| Endpoint | Purpose |
|----------|---------|
| `GET /api/me` | Current token-backed identity, workspace, feature flags |
| `GET /api/context/search` | Search context assets for UI previews |
| `GET /api/assets/{asset_id}` | Asset metadata and lineage |
| `POST /api/sessions` | Create analysis session |
| `GET /api/sessions` | List recent sessions |
| `GET /api/sessions/{id}` | Session details |
| `POST /api/sessions/{id}/stories` | Create an analysis story from a question and explicit context |
| `POST /api/stories/{id}/actions` | Continue, fork, filter, drill, compare, or validate from an existing story |
| `GET /api/runs/{id}/stream` | SSE stream of story, trace, evidence, conclusion, and next-move events |
| `POST /api/runs/{id}/cancel` | Cancel run |
| `POST /api/runs/{id}/feedback` | Capture feedback and corrections |
| `POST /api/canvases` | Save or update a story canvas |
| `POST /api/stories/{id}/pin` | Pin a story to the active canvas |
| `GET /api/workflows` | List workflow templates |
| `POST /api/workflows/{id}/run` | Run a workflow |
| `POST /api/memories/proposals/{id}/approve` | Approve proposed memory |
| `DELETE /api/memories/{id}` | Delete memory |

## Workflow Templates

Workflows should be versioned, parameterized, and reviewable.

Example template structure:

```yaml
name: weekly_business_review
description: Weekly executive KPI review by region and segment
parameters:
  - name: reporting_week
    type: date
    required: true
  - name: region
    type: string
    default: global
metrics:
  - revenue
  - active_customers
  - retention_rate
steps:
  - retrieve canonical metric context
  - compute KPI deltas versus prior week and prior year
  - identify top segment drivers
  - run freshness and reconciliation checks
  - produce summary, charts, caveats, and follow-up questions
validation:
  - totals reconcile to certified metric view or registry definition within tolerance
  - all metric queries use certified metric views when available
```

Workflow categories:

- weekly/monthly business review
- launch impact readout
- anomaly investigation
- customer segmentation
- churn or retention analysis
- funnel conversion analysis
- table and metric validation
- report explanation

## Trust, Safety, and Governance

### Access Control

- Phase 0 Databricks access uses the configured PAT; audit trails reflect the PAT owner.
- Phase 3 should move to pass-through access through the current user or app-approved OBO flow.
- The context retrieval service must filter documents by the user's UC permissions and document ACL metadata.
- If a user lacks permission, the app should explain the blocked asset and suggest authorized alternatives.
- Published artifacts inherit workspace/UC permissions.

### Transparency

Each answer should expose:

- tables, views, metric views, reports, and documents used
- query text and statement links
- row counts and time ranges
- freshness and validation checks
- assumptions and default values
- memory entries used

### Query Guardrails

- Default to read-only SQL.
- Enforce row limits for previews.
- Require explicit confirmation for expensive, long-running, or broad queries.
- Detect and warn about many-to-many joins, missing date filters, null-heavy keys, ambiguous metric names, and stale tables.
- Use the configured general-purpose cluster for phase 0 through phase 2, and revisit SQL warehouse execution in phase 3.

### Memory Governance

Memory write path:

1. Agent proposes a memory with source evidence and scope.
2. User approves or edits it.
3. Team/global memory can require reviewer approval.
4. Memory gets owner, TTL, confidence, and source run ID.
5. Future answers cite memory when used.

## Evaluation Plan

Evaluation should be a first-class product surface, not an afterthought.

Eval case types:

- metric definition correctness
- SQL result equivalence against golden SQL
- table selection correctness
- join/filter correctness
- chart appropriateness
- narrative correctness
- caveat and assumption coverage
- permission handling
- memory usage correctness

Pipeline:

1. Curate golden natural-language questions by business domain.
2. Store expected SQL or expected result frames.
3. Run the agent in deterministic eval mode.
4. Execute generated SQL and golden SQL.
5. Compare result data with tolerances.
6. Grade SQL shape, reasoning, and final narrative.
7. Track regressions in MLflow.
8. Promote user corrections into eval candidates.

Production feedback:

- thumbs up/down
- "wrong metric", "wrong table", "wrong filter", "stale data", "bad chart", "unclear answer"
- attach corrected SQL or corrected interpretation
- convert high-signal feedback into memory or eval cases

## Observability

Use MLflow tracing for every run:

- prompt and normalized intent
- retrieved context IDs
- generated plan
- tool calls
- SQL text
- validation results
- output artifacts
- user feedback
- memory proposals

Operational metrics:

- answer latency
- SQL latency and compute cost
- context retrieval latency
- clarification rate
- query retry rate
- validation failure rate
- user feedback score
- workflow reuse rate
- eval pass rate by domain

## MVP Scope

MVP should focus on reliable read-only business analysis over governed Databricks assets.

Included:

- Externally hosted React/FastAPI application deployable to VM, Kubernetes, or AKS
- PAT-backed Databricks access for phase 0, with UC permissions enforced for the active token
- conversational analysis sessions
- context retrieval over UC metadata, comments, tags, query history summaries, metric views, and curated docs
- SQL generation and bounded execution
- validation checks for date filters, row counts, nulls, join cardinality, freshness, and metric reconciliation
- StoryCards with charts, SQL evidence, trace, next moves, and caveats
- personal memory proposals
- workflow templates for business review, anomaly investigation, and metric/table discovery
- MLflow traces and offline eval harness

Deferred:

- Slack/Teams bot
- notebook export
- team/global memory approval workflows
- code-enrichment over notebooks/jobs at large scale
- multi-workspace analysis
- writeback actions beyond publishing reports

## Open Questions

- Should the first version use only an app-owned semantic context index, or should it also call Databricks-native metadata/search services where available?
- Are Unity Catalog metric views sufficient for the first business domain, or do they need supplemental documentation fields?
- How should result previews be retained, and when should the app persist derived output tables?
- What approval process is required for team/global memories?
- Which business domains should seed the initial eval set?
- What query cost threshold should trigger user confirmation?
- Should data scientists be allowed to switch into a notebook-backed execution mode?

## Initial Build Plan

1. Scaffold `databricks-analyst-app` as an externally hosted FastAPI/React application with local development scripts and containerized deployment.
2. Add phase 0 preflight checks for config, PostgreSQL + pgvector, PAT auth, cluster execution, metric views, Claude Agent SDK, MLflow, and Docker packaging.
3. Implement user/session persistence in the PostgreSQL-compatible application database.
4. Add PAT-based Databricks auth, cluster selection, and read-only SQL execution.
5. Build context index tables and a pgvector-backed retrieval service.
6. Implement analyst agent loop with plan, SQL, validation, execution, synthesis, and streaming.
7. Build UI for StoryCards, Story Canvas, charts, right inspect panel, advanced SQL inspection, and feedback.
8. Add workflow registry and three MVP workflows.
9. Add memory proposal/approval for personal memories.
10. Instrument MLflow traces.
11. Build offline eval cases for the first business domain.
