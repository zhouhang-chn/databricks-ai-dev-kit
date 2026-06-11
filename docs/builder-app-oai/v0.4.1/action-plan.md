# v0.4.1 Golden-Case-Assisted Routing And Execution Action Plan

Date: 2026-06-11

Objective: use active Golden Analysis Cases as runtime-safe guidance for routing
and execution, and add paired eval configuration to compare agents with and
without golden-case assistance.

## Release Gates

1. **Projection gate**: runtime receives only sanitized
   `golden_case_assist`; oracle SQL and expected answers remain eval-only.
2. **Routing gate**: `routing_decision` records assist case id, mode,
   confidence, accepted hints, and rejected hints.
3. **Execution gate**: `execution_contract` and `execution_evidence` record
   case-derived query/grain/filter/fallback hints and whether they were
   followed.
4. **Safety gate**: stale, blocked, dark, or dependency-stale cases cannot
   provide active assistance.
5. **Paired eval gate**: eval config can run the same suite with
   `mode: disabled`, `route_only`, and `route_and_execution`.
6. **Benefit gate**: assistance is enabled only when paired evals show no
   accuracy or safety regression and an acceptable cost tradeoff.

## Workstream A - Assist Projection Contract

Tasks:

1. Define the `golden_case_assist` schema.
2. Whitelist runtime-safe fields from `golden_case`.
3. Explicitly exclude oracle SQL, expected values, hidden negatives, and
   answer-revealing scoring hints.
4. Add assist modes: `disabled`, `shadow`, `route_only`,
   `route_and_execution`.
5. Define status/readiness filters for active assistance.

Acceptance:

- A case can produce a sanitized assist packet.
- Excluded fields cannot be serialized into normal runtime prompt context.
- Stale/blocked/dark cases produce no active assist packet.

## Workstream B - Matching And Shadow Mode

Tasks:

1. Load compact active-case summaries.
2. Match user prompts against case prompts, intent labels, required entities,
   audience roles, and semantic dependencies.
3. Emit shadow-mode telemetry without exposing hints to the agent.
4. Handle multiple near matches with clarification or no active assist.
5. Log match confidence and rejection reasons.

Acceptance:

- Shadow mode can report would-have-assisted case ids.
- Multiple ambiguous matches do not silently force a case.
- Missing required parameters are surfaced as constraints.

## Workstream C - Routing Integration

Tasks:

1. Extend `routing_decision` with optional `golden_case_assist` metadata.
2. Use route hints to set question family, source tier, selected entity, and
   required project files when confidence passes threshold.
3. Record accepted, ignored, and rejected route hints.
4. Keep normal route evidence and file-read compliance.

Acceptance:

- Route-only assist improves pointer compliance in eval or stays neutral.
- Wrong case hints can be rejected and traced.
- Route evals can compare assisted vs unassisted runs.

## Workstream D - Execution Integration

Tasks:

1. Extend `execution_contract` with optional case assist metadata.
2. Use execution hints for query ref, expected grain, required filters,
   fallback policy, and suspicious checks.
3. Record followed, ignored, and contradicted execution hints in
   `execution_evidence`.
4. Preserve schema gate, read-only policy, and Metric View first checks.
5. Require fallback reason when execution contradicts a case-selected semantic
   path.

Acceptance:

- Assisted execution cannot use raw SQL silently when the case expects Metric
  View execution.
- Evidence shows whether case hints improved or hurt execution.
- No assist mode bypasses existing gates.

## Workstream E - Paired Eval Configuration

Tasks:

1. Add eval config field:
   `golden_case_assistance.mode`.
2. Support variants:
   - `baseline_without_golden_cases`;
   - `with_golden_case_route_only`;
   - `with_golden_case_route_and_execution`.
3. Add `paired_comparison.enabled`,
   `paired_comparison.baseline_variant`, and `compare_metrics`.
4. Store variant id, assist mode, case id, and confidence in eval results.
5. Report deltas by case id and assertion layer.

Acceptance:

- The same suite can run with assistance disabled and enabled.
- Reports show route, execution, data, safety, latency, token, tool-call, and
  file-read deltas.
- A failing assisted variant does not mask a passing baseline.

## Workstream F - Rollout And Guardrails

Tasks:

1. Start all domains in `shadow`.
2. Promote to `route_only` after route/pointer eval improvement.
3. Promote to `route_and_execution` after source-tier/data/evidence eval
   improvement.
4. Auto-disable assistance when case status becomes stale, blocked, or dark.
5. Add runbook for bad case hints.

Acceptance:

- Assistance can be rolled back per domain or case.
- Regression gates can demote a case to eval-only.
- Telemetry explains whether the issue was match, route hint, execution hint,
  or stale case content.

## Milestones

### Milestone 1 - Docs And Schema

Deliver:

- `golden_case_assist` schema;
- assist mode definitions;
- paired eval config schema.

Gate:

- runtime-safe and eval-only fields are clearly separated.

### Milestone 2 - Shadow Matching

Deliver:

- compact case summary loader;
- candidate matcher;
- shadow telemetry.

Gate:

- shadow reports can be compared with unassisted route outcomes.

### Milestone 3 - Route-Only Assistance

Deliver:

- route hint injection;
- route assist trace fields;
- route paired evals.

Gate:

- assisted route evals improve or stay neutral against baseline.

### Milestone 4 - Route And Execution Assistance

Deliver:

- execution hint injection;
- evidence hint-following fields;
- source-tier and fallback-policy checks.

Gate:

- assisted execution improves source-tier compliance or data accuracy without
  safety regression.

### Milestone 5 - Paired Eval Reporting

Deliver:

- multi-variant eval config;
- paired comparison report;
- per-case promotion/demotion guidance.

Gate:

- product owners can decide whether assistance is worth the cost from stored
  eval results.

## Validation Commands

Docs-only validation:

```bash
git diff -- docs/builder-app-oai/v0.4.1 docs/builder-app-oai/context-engineering.md
```

Markdown hygiene:

```bash
git diff --check -- docs/builder-app-oai/v0.4.1 docs/builder-app-oai/context-engineering.md docs/builder-app-oai/README.md
```

Runtime validation after implementation work:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_settings_yaml.py tests/test_project_config.py tests/test_openai_runtime.py -q
```

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Assist leaks oracle SQL | Evals become invalid | Use allowlist projection and tests that assert excluded fields are absent |
| Wrong case match narrows route incorrectly | Worse answers than baseline | Start in shadow, require paired eval gain, trace rejected hints |
| Case guidance becomes hidden fast path | Less observable execution | Still emit `routing_decision` and `execution_evidence` |
| Stale case hints override fresh semantic truth | Drift | Disable assistance for stale/dependency-stale cases |
| Assistance improves accuracy but doubles cost | Poor product tradeoff | Paired evals include latency, tokens, tool calls, and file reads |
| Baseline comparison is not stable | Misleading rollout decisions | Use paired variants over same prompts, data windows, model, and code SHA |
