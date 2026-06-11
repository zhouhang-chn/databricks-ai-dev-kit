# v0.4.1 Golden-Case-Assisted Routing And Execution Design

Date: 2026-06-11

v0.4.1 turns active golden cases into **runtime-safe guidance** for routing and
execution. The design keeps v0.4's eval-first rule: full golden cases, oracle
SQL, and expected outputs remain eval-only. Runtime receives only a sanitized
assist projection.

## 0. Goal

Use reviewed golden cases to improve normal agent behavior:

- better route selection;
- better project-file pointer compliance;
- better Metric View/source-tier compliance;
- fewer wrong-grain and missing-filter execution errors;
- clearer fallback and provenance behavior;
- measurable improvement over the same agent without golden-case assistance.

## 1. Non-Goals

- Do not put oracle SQL or expected answer values into normal runtime prompt.
- Do not make deterministic golden-case fast path the default.
- Do not bypass v0.3.6 routing or v0.3.7 execution evidence.
- Do not bypass schema gate, read-only policy, or user Databricks permissions.
- Do not use golden cases to define new Metric View semantics.

## 2. Runtime-Safe Assist Projection

Add a derived Context Asset:

```yaml
golden_case_assist:
  case_id: distribution_a1_m1_achievement
  case_status: active
  assist_mode: route_and_execution
  confidence: 0.84
  source: golden_case_runtime_projection
  route_hints:
    question_family: KPI
    selected_source_tier: metric_view
    selected_entity:
      source: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
      measures:
        - Total POC Count
        - Achieved POC Count
        - Not Achieved POC Count
        - POC Achievement Rate
      dimensions:
        - M1 No
        - Year Month
    required_project_files:
      - requirements.md
      - readiness.md
  execution_hints:
    query_mode: metric_view_sql
    query_ref: poc_achievement_by_m1_month
    expected_grain: M1 x Month
    required_filters:
      - employee_no
      - yearmonth
    fallback_allowed: false
    suspicious_checks:
      - row_count_nonzero
      - denominator_nonzero
      - source_tier_matches_route
  disclosure_hints:
    required_caveats: []
    provenance_required: true
    forbidden_claims:
      - production row-level security claim
```

Excluded fields:

- oracle SQL;
- expected rows or values;
- hidden negative cases;
- scoring thresholds that reveal expected numeric answers;
- direct SQL validation refs unless they are already public approved raw paths.

`golden_case_assist` has `loading_behavior: compiled_summary` or
`on_demand_file` depending on size. It is never the source of metric truth; it
only points to `semantic_truth`, `business_context`, and `analyst_workflow`
assets.

## 3. Assist Modes

v0.4.1 should support explicit modes.

| Mode | Behavior |
|---|---|
| `disabled` | Ignore golden cases at runtime; use normal v0.3.6/v0.3.7 path |
| `route_only` | Use case hints only to shape `routing_decision` and required file reads |
| `route_and_execution` | Use route hints plus execution query/grain/filter/fallback hints |
| `shadow` | Select an assist case and log what would have happened, but do not expose hints to the agent |

Default rollout should start with `shadow`, then `route_only`, then
`route_and_execution` for cases that prove benefit in paired evals.

## 4. Routing Integration

Routing flow:

```text
user prompt
-> load compact active-case summaries
-> match candidate golden case
-> build sanitized golden_case_assist
-> emit routing_decision with assist metadata
-> continue normal execution
```

`routing_decision` gains optional fields:

```yaml
golden_case_assist:
  case_id: string | null
  mode: disabled | shadow | route_only | route_and_execution
  confidence: number | null
  accepted_hints:
    - selected_source_tier
    - selected_entity
    - required_project_files
  rejected_hints: []
  rejection_reason: null
```

Rules:

- Do not use stale, blocked, or dark cases for active assistance.
- If multiple cases match, prefer targeted clarification over silent choice.
- If case-required parameters are missing, ask targeted clarification or record
  the missing constraint.
- Assistance narrows the search space; it does not suppress route evidence.

## 5. Execution Integration

`execution_contract` gains optional fields:

```yaml
golden_case_assist:
  case_id: string | null
  mode: disabled | shadow | route_only | route_and_execution
  query_ref: string | null
  expected_grain: string | null
  required_filters: []
  fallback_allowed: boolean | null
```

Execution rules:

- A case-selected Metric View should be used first when route and readiness
  agree.
- If execution uses raw SQL instead, it must record fallback reason and whether
  the case allowed fallback.
- Query refs and templates are hints unless implemented by a safe query builder.
- Case assistance cannot bypass schema inspection.
- `execution_evidence` must record followed, ignored, and contradicted hints.

## 6. Evidence And Telemetry

`execution_evidence` should include:

```yaml
golden_case_assist:
  case_id: string | null
  mode: string
  confidence: number | null
  route_hints_followed: []
  execution_hints_followed: []
  hints_ignored: []
  hints_contradicted: []
  fallback_policy_result: followed | violated | not_applicable
```

Telemetry should report:

- assist case id and mode;
- route accuracy delta;
- data accuracy delta;
- source-tier compliance delta;
- pointer compliance delta;
- tool calls and file reads;
- latency and tokens;
- fallback rate;
- footer mismatch rate.

## 7. Paired Eval Configuration

Evals must support comparing the same case set with golden-case assistance off
and on.

Recommended config:

```yaml
eval_run:
  suite_id: distribution_golden_cases_v1
  agent_variants:
    - id: baseline_without_golden_cases
      golden_case_assistance:
        mode: disabled
    - id: with_golden_case_route_only
      golden_case_assistance:
        mode: route_only
        min_confidence: 0.75
    - id: with_golden_case_route_and_execution
      golden_case_assistance:
        mode: route_and_execution
        min_confidence: 0.75
  paired_comparison:
    enabled: true
    baseline_variant: baseline_without_golden_cases
    compare_metrics:
      - routing_accuracy
      - selected_source_tier_accuracy
      - required_file_recall
      - data_accuracy
      - source_tier_compliance
      - latency_ms
      - input_tokens
      - tool_call_count
      - file_read_count
```

This config item is required after v0.4.1. A golden-case assist change should
not be accepted unless paired evals show the tradeoff.

## 8. Safety Rules

- Assistance is disabled for stale, blocked, and dark cases.
- Assistance is disabled when the case's semantic dependencies are stale or
  missing.
- Assistance cannot introduce a source the user lacks Databricks permission to
  query.
- Assistance cannot claim production row-level security from `user_context`.
- Assistance cannot render oracle SQL or expected answer values.
- Shadow mode should be available for new domains before active hints.

## 9. Success Criteria

For a case set, golden-case assistance is useful only when paired evals show:

- route accuracy improves or stays equal;
- data accuracy improves or stays equal;
- source-tier compliance improves;
- pointer compliance improves;
- no safety regression;
- latency/token/tool cost increase is justified by accuracy gains.

If assistance only improves prompt following but hurts data accuracy or cost
without launch benefit, keep the cases eval-only.
