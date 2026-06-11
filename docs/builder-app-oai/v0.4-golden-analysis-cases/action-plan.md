# v0.4 Golden Analysis Cases Action Plan

Date: 2026-06-11

Objective: implement Golden Analysis Cases as eval-first Context Assets that
bind v0.3.6 routing expectations and v0.3.7 execution evidence expectations into
repeatable launch and regression gates.

## Release Gates

1. **Contract gate**: `golden_case` schema supports route expectations,
   execution expectations, oracle references, answer contracts, assertions,
   ownership, freshness, and launch gates.
2. **Asset gate**: each case references required `semantic_truth`,
   `business_context`, and `control_plane` assets without duplicating metric
   definitions.
3. **Routing eval gate**: reviewed prompt variants produce expected
   `routing_decision` fields and required file reads.
4. **Execution eval gate**: selected source, query mode, grain, filters,
   fallback policy, and `execution_evidence` match the case contract.
5. **Data-fidelity gate**: Metric View result rows match oracle rows within
   configured tolerances.
6. **Disclosure gate**: provenance footer is parseable and trace-consistent.
7. **Safety gate**: user-preview traces expose read-only behavior and do not
   claim production row-level security.
8. **Telemetry gate**: each eval run stores case id, model id, git SHA, context
   version, assertion results, tokens, latency, tool calls, file reads, and
   query refs.

## Workstream A - Golden Case Contract

Tasks:

1. Define the `golden_case` schema in docs and fixtures.
2. Add fields for `status`, `owner`, `defense_claims`, `coverage`,
   `prompts`, `required_context_assets`, `route_expectation`,
   `execution_expectation`, `oracle`, `answer_contract`, `assertions`, and
   `launch_gate`.
3. Keep full oracle SQL and expected outputs out of normal prompt rendering.
4. Define status transitions: `candidate`, `active`, `stale`, `blocked`,
   `dark`.
5. Define ownership and freshness requirements for cases and oracle queries.

Acceptance:

- A complete case can be represented without Distribution-specific fields.
- Metric definitions remain in Metric View context or approved raw-path assets.
- Oracle assets have owners and freshness policy.

## Workstream B - Eval Asset Loading And Isolation

Tasks:

1. Treat full golden cases as `eval_only` assets by default.
2. Render only compact launch summaries into ordinary prompt context when
   needed: case id, title, launch tier, covered family.
3. Ensure eval prompts cannot leak oracle SQL or expected answers into the
   model input.
4. Add a fixture layout for project-level golden cases and oracle SQL.
5. Decide whether the initial carrier is DB settings, project files, or both.

Acceptance:

- Normal user runs do not include oracle SQL.
- Eval runs can load full case definitions and oracle SQL.
- Release-pinned runs use the frozen case version.

## Workstream C - Routing Evals

Tasks:

1. Generate routing eval cases from `golden_cases.prompts`.
2. Compare actual `routing_decision` with `route_expectation`.
3. Assert selected case id when case matching exists.
4. Assert required project-file recall and pointer compliance.
5. Capture source-tier drift, fallback reason, route latency, and file-read
   count.

Acceptance:

- Each active case has at least two reviewed prompt variants.
- Route evals fail when the selected source tier or entity is wrong.
- Pointer non-compliance is visible by case id.

## Workstream D - Execution And Evidence Evals

Tasks:

1. Generate execution eval cases from `execution_expectation`.
2. Compare executed query refs, source tier, query mode, grain, filters, and
   fallback policy against the case contract.
3. Assert `execution_evidence` exists and contains route id, source, query refs,
   row count, result shape, loaded files, validation status, and fallback
   fields.
4. Assert suspicious-result checks ran when configured.
5. Assert read-only safety for user-preview cases.

Acceptance:

- Metric View-backed cases fail if raw SQL is used without allowed fallback.
- Cases fail when expected query refs or evidence fields are missing.
- Read-only safety is evaluated per case, not only by generic unit tests.

## Workstream E - Data Fidelity And Oracle Runner

Tasks:

1. Normalize direct SQL or snapshot oracles as `control_plane` assets.
2. Execute or load oracle results with fixed parameters.
3. Extract agent output into structured rows.
4. Diff rows with normalized ordering and configured numeric tolerances.
5. Record exact-count, rate-tolerance, null, denominator, and grain assertions.

Acceptance:

- Count fields can require exact match.
- Rate fields can use per-field tolerances.
- Oracle failures mark cases stale or blocked, not silently passing.

## Workstream F - Disclosure And Answer Contract Evals

Tasks:

1. Validate `answer_contract.must_include` and `must_not_include`.
2. Parse provenance footer and compare it with trace/evidence.
3. Check required caveats and fallback disclosures.
4. Check visualization/table requirements when declared.
5. Check no security overclaim for demo/eval user context.

Acceptance:

- Footer mismatch is a hard failure.
- Missing required caveat is a failure for cases that declare one.
- Role/persona filters are described as eval/demo context unless v0.5 security
  is implemented.

## Workstream G - Telemetry And Launch Gates

Tasks:

1. Define eval result row schema:
   - case id;
   - prompt id;
   - case version;
   - model id;
   - git SHA;
   - context asset version or release id;
   - route id;
   - execution evidence id;
   - query refs;
   - assertion results;
   - tokens, latency, tool calls, file reads, warehouse query count.
2. Store results in a queryable table or durable artifact.
3. Implement launch-gate calculation by domain and stakes tier.
4. Add stale/dark regression runbook.

Acceptance:

- A reviewer can query pass rate by case id and assertion layer.
- A regression can be traced to model, code, prompt/context, or data/oracle
  changes.
- A sustained gate failure marks a case stale, blocked, or dark.

## Workstream H - Distribution Seed

Tasks:

1. Convert the first five Distribution cases into generic `golden_case` assets:
   - `distribution_a1_m1_achievement`;
   - `distribution_a5_m1_unachieved_pocs`;
   - `distribution_a2_m2_team_ranking`;
   - `distribution_b3_near_achievement`;
   - `distribution_f3_kpi_scan_reconcile`.
2. Link MV1-MV3 as semantic dependencies.
3. Link direct SQL validation refs as oracles.
4. Add Chinese and English prompt variants where useful.
5. Mark fraud, recommendation, profile, BEES coverage, and KBD coverage cases
   as blocked or deferred until source outputs and Metric Views are stable.

Acceptance:

- Distribution seed cases exercise routing, execution, data, evidence,
  disclosure, and safety eval layers.
- User/persona context is explicitly eval/demo only.
- Case readiness reflects MV status and oracle health.

## Milestones

### Milestone 1 - Contract And Fixtures

Deliver:

- generic `golden_case` schema;
- example Distribution case;
- fixture layout for prompts, oracles, and expected outputs;
- docs update linking v0.4 to v0.3.6 and v0.3.7.

Gate:

- schema can represent a case without embedding full metric definitions;
- full oracle SQL is eval-only.

### Milestone 2 - Routing Eval Harness

Deliver:

- prompt-variant runner;
- route expectation comparator;
- pointer-compliance assertions;
- selected-case assertion where matching exists.

Gate:

- route failures are reported by case id and assertion layer.

### Milestone 3 - Execution And Evidence Eval Harness

Deliver:

- execution expectation comparator;
- evidence object comparator;
- Metric View source-tier compliance assertions;
- read-only per-case safety assertions.

Gate:

- evidence omissions and wrong source tier fail the case.

### Milestone 4 - Oracle And Data Fidelity

Deliver:

- oracle runner or snapshot loader;
- structured answer extraction;
- row diff with exact/tolerant fields;
- oracle freshness status.

Gate:

- data-fidelity failures are reproducible and tied to case parameters.

### Milestone 5 - Launch Telemetry

Deliver:

- eval result schema;
- durable result storage;
- launch-gate calculation;
- stale/dark runbook.

Gate:

- launch decision can be made from stored eval results, not manual review only.

### Milestone 6 - Distribution Seed

Deliver:

- five Distribution seed cases;
- MV1-MV3 dependency refs;
- oracle refs and prompt variants;
- initial launch statuses.

Gate:

- at least one M1 KPI case, one M2 ranking case, and one reconciliation case run
  through all eval layers.

## Validation Commands

Docs-only validation:

```bash
git diff -- docs/builder-app-oai/v0.4-golden-analysis-cases
```

Markdown hygiene:

```bash
git diff --check -- docs/builder-app-oai/v0.4-golden-analysis-cases docs/builder-app-oai/context-engineering.md
```

Runtime validation after implementation work:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_settings_yaml.py tests/test_project_config.py tests/test_openai_runtime.py -q
```

Frontend validation after settings UI work:

```bash
cd databricks-builder-app-oai/client
pnpm install
pnpm lint
pnpm build:typecheck
```

Before browser or frontend tests, confirm both services are reachable:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:3000
```

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Golden cases leak oracle SQL into prompts | Evals become invalid | Keep full cases `eval_only`; render only compact summaries in normal runs |
| Golden cases duplicate Metric View definitions | Drift from semantic truth | Store only refs and required measures/dimensions; keep definitions in Metric View assets |
| Eval overfits to one phrasing | Real users miss covered paths | Require multiple prompt variants and paraphrase coverage |
| Direct SQL becomes the happy path | Semantic layer loses value | Classify direct SQL as oracle, drill-down, or explicit fallback |
| Oracle drift is mistaken for agent regression | Wrong repair path | Give oracles owners, freshness policy, and stale status |
| Role-shaped evals imply security | User overtrust | Mark `user_context` as eval/demo only until v0.5 |
| Telemetry is too sparse | Cannot debug regressions | Store case id, model id, SHA, context version, route/evidence ids, and assertion layer results |
