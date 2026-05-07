# v0.2 Business Analysis Action Plan

## Purpose

This plan turns [`gap-analysis.md`](gap-analysis.md) and [`design.md`](design.md)
into an implementation sequence for reliable business-question answering in
`databricks-builder-app-oai`.

The v0.1 OpenAI Agents SDK runtime remains the baseline. v0.2 focuses on answer
correctness, evidence durability, SQL safety, semantic scope, visualization, and
evaluation.

## Execution Principles

- Keep existing API and SSE event shapes backward compatible where possible.
- Make final answers durable before adding more analyst features.
- Store structured evidence in addition to user-visible prose.
- Enforce SQL safety in code, not only prompts.
- Prefer governed project assets before broad workspace scans.
- Keep Databricks auth and model auth separate.
- Use `pnpm` for client commands.
- Add tests/evals for each correctness-critical behavior.

## Progress Snapshot

Last updated: 2026-05-07.

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Docs and Baseline Alignment | In progress | v0.2 gap analysis, design, and action plan exist. Existing active docs still need occasional source-alignment updates as implementation changes. |
| Phase 1: Critical Persistence Fixes | Pending | Persist Project Management resources and structured conclusions. |
| Phase 2: Business Answer Manifest | Pending | Add structured sources, metrics, filters, grain, caveats, confidence, and replay metadata. |
| Phase 3: SQL Safety and Query Bounds | Pending | Replace prefix checks with parser-based classification and bounded query policy. |
| Phase 4: Semantic Answering Lane | Pending | Rank preferred assets and metric views before broad discovery or SQL. |
| Phase 5: Business-Question Evals | Pending | Add fixtures and scoring for answer correctness and latency. |
| Phase 6: Chart Evidence | Pending | Implement chart specs, detection/rendering, and table fallback. |
| Phase 7: Efficiency Hardening | Pending | Narrow tools by intent, persist operation state, and measure latency/tool budgets. |

## Phase 0: Docs and Baseline Alignment

Goal: make the documentation structure and current source state clear.

Tasks:

- Add `docs/builder-app-oai/README.md` as the OAI docs index.
- Keep v0.1 docs under `v0.1-agents-sdk-integration/`.
- Add v0.2 `gap-analysis.md`, `design.md`, and `action-plan.md`.
- Update active docs that still describe old static Next Moves or `npm`
  validation commands.
- Link v0.1 docs to the v0.2 business-analysis track.

Acceptance gates:

- `docs/README.md` points to `docs/builder-app-oai/`.
- v0.2 folder has `gap-analysis.md`, `design.md`, and `action-plan.md`.
- Active validation examples use `pnpm`.

## Phase 1: Critical Persistence Fixes

Goal: make the current UI/runtime save the answer context users see.

Tasks:

- Update Project Management save payload to include:
  - `settings.resources.default_catalog`
  - `settings.resources.default_schema`
  - `settings.resources.cluster_id`
  - `settings.resources.warehouse_id`
  - `settings.resources.workspace_folder`
  - `settings.resources.mlflow_experiment_name`
- Persist `synthesis.appended.summary` as assistant message content when the
  run produces no normal text output.
- Feed the same conclusion summary into Next Moves generation.
- Store highlights and structured next steps with execution/story metadata when
  available.
- Add tests for resource save and `submit_conclusion`-only runs.

Acceptance gates:

- Project Management resource edits survive reload and are used in later runs.
- A run that only calls `submit_conclusion` creates a useful assistant message.
- Next Moves receive the final conclusion text even when `final_text` is empty.

Suggested validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_config.py tests/test_openai_runtime.py tests/test_next_moves.py -q
cd client
pnpm lint
pnpm build:typecheck
```

## Phase 2: Business Answer Manifest

Goal: make each answer auditable and replayable.

Tasks:

- Define a `BusinessAnswerManifest` schema in backend and frontend types.
- Attach manifest metadata to execution/story persistence.
- Capture:
  - sources and source rationale
  - SQL queries and query IDs when available
  - metrics and definitions used
  - filters, grain, row/time bounds, freshness, assumptions, caveats
  - confidence and replay IDs
- Render a compact sources/caveats section in the story and full details in the
  inspector.
- Add migration or JSON storage path for manifests.

Acceptance gates:

- Every completed business answer has a manifest, even if partial.
- The inspector can show sources and caveats without parsing prose.
- Replay can reconstruct answer context from persisted data.

## Phase 3: SQL Safety and Query Bounds

Goal: prevent unsafe or unbounded queries from reaching the warehouse.

Tasks:

- Choose and validate a Databricks SQL parser/classifier.
- Replace prefix-based read-only checks with parsed statement classification.
- Reject write/DDL/grant/external/multi-statement mutation in read-only mode.
- Add default row limits for exploratory queries.
- Capture warehouse/catalog/schema/timeout/row counts in evidence metadata.
- Add tests for CTE plus write statements, comments, multi-statements, and
  allowed metadata statements.

Acceptance gates:

- Unsafe CTE and multi-statement write patterns are blocked.
- Allowed read-only queries still execute.
- Unbounded exploratory SQL is limited or requires explicit user intent.

## Phase 4: Semantic Answering Lane

Goal: choose the right governed assets before writing SQL.

Tasks:

- Rank candidate assets from preferred tables, metric views, sample queries,
  glossary, deprecated tables, project memory, and recent turns.
- Add metric-view helper prompts/tools for governed metrics.
- Add a lightweight schema/profile cache shape.
- Record source-selection rationale in the manifest.
- Avoid deprecated/blocked assets unless the user explicitly requests them.

Acceptance gates:

- Metric questions prefer metric views or preferred tables when configured.
- Deprecated assets are avoided and noted.
- Broad catalog scans happen only when project context is insufficient.

## Phase 5: Business-Question Evals

Goal: make answer quality measurable.

Tasks:

- Add offline eval fixtures for common business questions:
  - metric lookup
  - trend over time
  - segment/ranking
  - data discovery
  - ambiguous business term
  - read-only/user-preview
  - query error or missing table
- Score table/metric choice, SQL safety, evidence sufficiency, caveats,
  answer usefulness, and latency/tool budgets.
- Add a local eval command that does not require a live workspace for parser and
  manifest checks.
- Add optional live gated evals for safe SQL warehouse smoke tests.

Acceptance gates:

- Evals fail on wrong table/metric choice in fixture cases.
- SQL safety regressions are caught without network access.
- Reports include latency/tool-call metrics.

## Phase 6: Chart Evidence

Goal: make analytical shape visible when a table is hard to read.

Tasks:

- Implement `ChartSpec` in frontend types.
- Add client-side chart detection for SQL result tables.
- Render bar, line, area, pie, and scatter charts with table fallback.
- Link chart evidence to source/query entries in the manifest.
- Add tests or browser checks for chartable and non-chartable evidence.

Acceptance gates:

- Trend/ranking/composition SQL results render chart evidence.
- Users can toggle from chart to table.
- Metadata and single-row answers do not produce misleading charts.

## Phase 7: Efficiency Hardening

Goal: keep analyst questions fast enough for repeated use.

Tasks:

- Narrow tool surface by run role, enabled skill, and inferred intent.
- Fail loudly on invalid generated tool schemas and malformed args.
- Persist long-running operation state outside process memory.
- Compress or normalize execution-event storage for long streams.
- Add latency/tool-call logging for first plan, first evidence, total answer,
  row counts, and next-move generation.

Acceptance gates:

- Common scoped questions meet the v0.2 latency/tool budgets from
  [`design.md`](design.md).
- Long operations can be inspected after process restart.
- Tool schema failures are visible in tests/logs instead of silent retries.

## Rollout Plan

1. Ship Phase 1 first because it fixes what users see versus what the product
   persists.
2. Add manifest storage before deeper SQL/semantic changes so later work has a
   stable evidence target.
3. Land SQL safety before broadening business-question evals.
4. Add semantic ranking and evals together so quality changes are measurable.
5. Add chart evidence after manifest/source links exist.
6. Use live Databricks warehouse tests only behind explicit environment gates.

## Definition of Done

- Project resources and structured conclusions persist correctly.
- Business answers include a durable evidence manifest.
- Read-only SQL safety is parser-based and tested.
- Common business-question fixtures produce governed, source-backed answers.
- Story replay does not depend on in-memory stream state.
- Active docs and validation commands match source code and repo policy.
