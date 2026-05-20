# v0.4 Golden Analysis Cases Action Plan

## Objective And Release Gates

Objective:

- Turn recurring, high-value analysis question families into reviewed Golden
  Analysis Cases that route to certified Metric Views first, validate against
  direct SQL oracles, and produce repeatable answer stories with measurable
  quality gates.

Release gates:

1. Contract gate: `project_setting.yaml` supports `metric_view_context`,
   `org_chart_notes`, `user_context`, and `golden_cases` without breaking the
   existing v0.2/v0.3 project settings shape.
2. Semantic dependency gate: each metric-oriented golden case declares
   `metric_view_refs` with required Metric Views, dimensions, measures,
   readiness status, and fallback policy.
3. Certification gate: v0.3.5 has certified or explicitly accepted candidate
   status for the Metric Views referenced by the initial golden cases.
4. Routing gate: known question variants match the expected case or ask a
   targeted clarification when required context is missing.
5. Execution gate: golden paths inspect schema, query Metric Views with
   explicit dimensions and `MEASURE()`, and use direct SQL only for validation,
   drill-down, or declared fallback.
6. Answer-contract gate: completed runs include required fields, caveats,
   confidence, and recommended next step while avoiding forbidden claims.
7. Eval gate: each shipped case has routing, plan, query-fidelity,
   data-fidelity, response-quality, and read-only safety checks.
8. Distribution seed gate: at least five Distribution golden cases map to
   MV1-MV3 and direct SQL oracles before broader fraud, profile, and
   recommendation scenarios are promoted.

## Workstreams

Workstream A: Golden Case Contract

- Add the project-setting schema for:
  - `metric_view_context`
  - `org_chart_notes`
  - `user_context`
  - `golden_cases`
- Split golden-case queries into:
  - `metric_view_queries` for the canonical answer path
  - `validation_queries` for direct SQL or reconciliation oracles
- Define readiness states for case execution:
  - ready
  - ready_with_candidate_metric_view
  - blocked_missing_context
  - blocked_missing_metric_view
  - blocked_stale_metric_view
  - fallback_allowed
- Keep large SQL bodies in settings for the first version. Revisit external
  query files only if prompt size or editing ergonomics become a real problem.

Workstream B: Metric View Dependency And Readiness

- Resolve `metric_view_refs` against `metric_view_context.metric_views`.
- Verify required dimensions and measures are present before selecting a case.
- Enforce required status:
  - `certified` for production-quality happy paths
  - `validated` for checked but not fully released paths
  - `candidate` only when the case explicitly accepts candidate answers
- Ensure Metric View SQL uses `MEASURE()` and no `SELECT *`.
- Return readiness failures instead of silently falling back when a certified
  Metric View is required but unavailable.

Workstream C: Prompt Rendering And Routing

- Render Project Management Context in this order:
  - analysis notes
  - org chart notes
  - user context
  - Metric View context
  - bounded golden-case routing summary
- Keep full SQL out of the initial prompt. Retrieve case details after a case
  is selected.
- Classify questions using examples, keywords, intent labels, required
  entities, audience roles, configured resources, and Metric View readiness.
- Ask targeted clarifying questions when a near match lacks month, employee,
  POC, or role context.
- Fall back visibly to free-form planning only when no case matches or the case
  explicitly permits fallback.

Workstream D: Golden Path Runtime

- Add a canonical execution policy:
  - inspect Metric View schema first
  - run Metric View query
  - optionally run direct SQL oracle for eval or sampled validation
  - synthesize via `submit_conclusion`
- Use SQL over Metric Views until a dedicated `query_metric_view` tool exists.
- Keep direct SQL available for:
  - eval oracle
  - detail drill-down
  - source-data debugging
  - explicit fallback policy
- Mark every result with whether it used certified, validated, candidate, or
  fallback semantics.
- Preserve read-only user-preview behavior.

Workstream E: Settings UI

- Expose separate editable surfaces for:
  - `analysis_notes`
  - `org_chart_notes`
  - `user_context`
  - `metric_view_context`
  - `golden_cases`
- Start with YAML/text editing for `golden_cases`.
- Add validation feedback for missing Metric Views, missing measures, missing
  dimensions, undeclared parameters, and missing ground-truth queries.
- Show readiness status for each golden case.
- Keep structured editing for later once the schema stabilizes.

Workstream F: Evaluation Harness

- Convert golden cases into repeatable eval cases.
- Score at least these layers:
  - routing
  - planning
  - schema safety
  - semantic dependency
  - query fidelity
  - data fidelity
  - response quality
  - read-only safety
- Store trace IDs, selected case IDs, Metric View query refs, validation query
  refs, evidence blocks, and response scores.
- Require exact matches for count fields and configured tolerances for rates.

Workstream G: Distribution Seed

- Treat Distribution as the first end-to-end v0.4 seed.
- Use the v0.3.5 Distribution context pack as the semantic source:
  - MV1 `m1_achievement_detail_metrics`
  - MV2 `m1_poc_achievement_metrics`
  - MV3 `m1_kpi725_benchmark_metrics`
- Convert the first five cases into app-readable `golden_cases`:
  - `distribution_a1_m1_achievement`
  - `distribution_a5_m1_unachieved_pocs`
  - `distribution_a2_m2_team_ranking`
  - `distribution_b3_near_achievement`
  - `distribution_f3_kpi_scan_reconcile`
- Keep fraud, recommendation, profile, BEES coverage, and KBD coverage cases
  deferred until their source outputs and Metric Views are stable.

## Milestone 1: Contract And Docs

Goal:

- Finalize the v0.4 implementation contract before runtime changes.

Scope:

1. Add this action plan.
2. Keep `design.md` as the source of truth for the golden-case YAML shape.
3. Keep `distribution-gap-analysis.md` aligned with the v0.3.5 Distribution
   context pack.
4. Document that Metric Views are the default happy path and direct SQL is an
   oracle, drill-down, or declared fallback.
5. Define the v0.5 boundary for production role resolution and row filtering.

Acceptance:

- v0.4 docs include design, gap analysis, and action plan.
- The golden-case schema includes Metric View dependencies and separate
  validation queries.
- Distribution guidance no longer treats raw source SQL as the default
  canonical path for metric-oriented cases.

## Milestone 2: Project Setting Schema Extension

Goal:

- Persist the new v0.4 sections in project settings.

Scope:

1. Extend the project-setting parser/model for:
   - `metric_view_context`
   - `org_chart_notes`
   - `user_context`
   - `golden_cases`
2. Preserve unknown-field behavior only where it is intentional.
3. Add normalization for golden-case IDs, query refs, parameters, and readiness
   status.
4. Validate that every `metric_view_refs.full_name` exists in
   `databricks_resources.input_metric_views` or `metric_view_context`.
5. Validate that every `ground_truth_query_ref` points to a
   `validation_queries` entry.

Acceptance:

- Existing project settings still load.
- Distribution settings with `metric_view_context` load without losing fields.
- Invalid golden-case references produce actionable validation errors.
- Unit tests cover minimal, complete, and invalid golden-case payloads.

## Milestone 3: Prompt Rendering And Case Matching

Goal:

- Let the Analysis Agent identify when a user question should use a golden
  path.

Scope:

1. Render `org_chart_notes` below `analysis_notes`.
2. Render bounded `metric_view_context` before golden cases.
3. Render a compact golden-case routing summary with case ID, examples,
   required entities, Metric View refs, and readiness.
4. Add a matcher that considers examples, keywords, intent, audience role,
   required entities, configured resources, and Metric View readiness.
5. Ask targeted clarification when a near match misses required context.

Acceptance:

- Known question variants select the expected case.
- Missing `yearmonth`, `employee_no`, role, or POC context produces a targeted
  clarification instead of broad SQL.
- A stale or missing required Metric View prevents golden-path selection unless
  the case explicitly allows fallback.

## Milestone 4: Metric View-First Execution

Goal:

- Execute selected golden paths through Metric Views before source SQL.

Scope:

1. Add runtime policy for canonical path steps:
   - `inspect_schema`
   - `query_metric_view`
   - `validate_sql`
   - `execute_sql`
   - `conclude`
2. Implement `query_metric_view` as either:
   - a dedicated typed tool, or
   - generated SQL over Metric Views using `MEASURE()` and explicit dimensions.
3. Keep schema-before-query for both Metric Views and source tables.
4. Block `SELECT *` against Metric Views.
5. Record whether the answer used certified, validated, candidate, or fallback
   semantics.

Acceptance:

- Metric View SQL includes explicit dimensions and `MEASURE()` calls.
- Direct SQL is not used for the happy path when a required certified Metric
  View is available.
- Candidate Metric View runs disclose candidate status.
- Missing Metric View runs return readiness failure or documented fallback.

## Milestone 5: Golden Case Evaluation

Goal:

- Make golden-case quality measurable and repeatable.

Scope:

1. Generate eval cases from `golden_cases`.
2. Add routing evals for reviewed question variants.
3. Add plan evals that verify the canonical path was followed.
4. Add query evals that check resources, dimensions, measures, parameters, and
   `MEASURE()` usage.
5. Add data-fidelity evals comparing Metric View results to direct SQL oracles.
6. Add response rubrics for required fields, caveats, confidence, and forbidden
   claims.
7. Add read-only safety checks for user-preview runs.

Acceptance:

- Each shipped golden case has at least one successful trace.
- Count fields match direct SQL exactly.
- Rate fields match configured tolerances.
- No user-preview trace exposes write-capable tools.
- Answers do not claim v0.5 production row-level security.

## Milestone 6: Settings UI Slice

Goal:

- Make v0.4 sections editable and understandable in the app.

Scope:

1. Add separate settings fields for `org_chart_notes` and `user_context`.
2. Show Metric View context and validation status.
3. Add a YAML/text editor for `golden_cases`.
4. Add readiness diagnostics per case.
5. Surface errors for missing Metric Views, dimensions, measures, query refs,
   and required parameters.

Acceptance:

- A developer can add or edit a golden case without editing database rows.
- A project with invalid golden-case references clearly shows blockers.
- User-preview mode can run against the published or draft case set without
  exposing edit controls.

## Milestone 7: Distribution Seed

Goal:

- Prove v0.4 with the first Distribution golden-case package.

Scope:

1. Close or explicitly accept v0.3.5 certification status for MV1-MV3.
2. Add `user_context` and `org_chart_notes` to the Distribution project setting
   draft.
3. Add five Distribution golden cases with:
   - trigger questions
   - Metric View refs
   - Metric View query refs
   - direct SQL validation refs
   - answer contracts
   - response rubrics
4. Run one M1 case, one M2 case, and one KPI reconciliation case.
5. Capture trace IDs, query output, validation output, evidence blocks, and
   response scores.

Acceptance:

- `distribution_a1_m1_achievement` answers through MV2.
- `distribution_a5_m1_unachieved_pocs` uses MV2 for POC selection and MV1 for
  group drill-down.
- `distribution_a2_m2_team_ranking` uses org chart notes and discloses that
  v0.4 user context is not production security.
- `distribution_f3_kpi_scan_reconcile` uses MV3 and validates against KPI725
  and scan-side oracles.
- Deferred cases remain explicitly out of scope.

## Milestone 8: Release Hardening

Goal:

- Make golden cases stable enough for repeated demos and user-preview runs.

Scope:

1. Add release-readiness checks for golden-case validity.
2. Store selected case ID and query refs in trace metadata.
3. Add fallback language templates for readiness failures.
4. Add stale Metric View warnings based on validation timestamps.
5. Add docs for updating a case after Metric View changes.

Acceptance:

- A project release cannot be marked ready while P0 golden cases have missing
  Metric View dependencies.
- Trace review can answer which case, Metric View, query refs, and fallback
  status were used.
- Stale or candidate Metric View answers disclose status clearly.

## Validation Commands

Docs-only validation:

```bash
git diff -- docs/builder-app-oai/v0.4-golden-analysis-cases
```

Project-setting and runtime validation after implementation work:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_settings_yaml.py tests/test_project_config.py -q
```

OpenAI runtime validation after prompt or routing changes:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_openai_runtime.py -q
```

Frontend validation after settings UI changes:

```bash
cd databricks-builder-app-oai/client
pnpm install
pnpm lint
pnpm build:typecheck
```

Local app smoke setup:

```bash
cd databricks-builder-app-oai
./scripts/start_local.sh --profile <profile>
```

Before browser or frontend tests, confirm both services are reachable:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:3000
```

If testing `pnpm preview`, also check:

```bash
curl -fsS http://127.0.0.1:4173
```

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Golden cases duplicate Metric View semantics | Cases drift from governed definitions | Store full grain, business terms, validation, and caveats in `metric_view_context`; keep case refs minimal. |
| Candidate Metric Views are treated as certified | Answers appear more authoritative than validation supports | Require status checks and visible candidate caveats. |
| Direct SQL becomes the default path again | v0.4 repeats semantic discovery and loses Databricks-native context assets | Make direct SQL an oracle, drill-down, or declared fallback only. |
| Prompt bloat from full SQL and all cases | Routing becomes slower and less reliable | Render bounded summaries first; load full case details after selection. |
| Role-shaped Distribution answers imply security | Users may mistake demo context for row-level enforcement | Keep `user_context` as demo/eval only and disclose v0.5 security boundary. |
| Metric View names or measures change after certification | Golden paths fail or return stale definitions | Add validation timestamps, stale status, and release-readiness checks. |
| Eval overfits to one phrasing | Real users miss the golden path | Maintain multiple reviewed question variants per case and add ambiguous phrasing evals. |
