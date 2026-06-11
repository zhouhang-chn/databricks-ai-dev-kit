# v0.4 Golden Analysis Cases Design

Date: 2026-06-11

v0.4 defines **Golden Analysis Cases** as eval-first Context Assets. A golden
case is a reviewed, project-owned contract that says how a high-value question
family should route, execute, validate, disclose, and be scored.

This design depends on:

- [`../v0.3.6/design.md`](../v0.3.6/design.md): routing assets and `routing_decision`;
- [`../v0.3.7/design.md`](../v0.3.7/design.md): execution assets and `execution_evidence`;
- [`../context-engineering.md`](../context-engineering.md): Context Asset model and eval principles.

## 0. Purpose

The purpose of v0.4 is not to hard-code every repeated question into a brittle
runtime recipe. The purpose is to create a durable **control-plane asset** that
can answer:

- which questions are covered;
- which route is expected;
- which semantic source is canonical;
- which execution evidence is required;
- which oracle or snapshot proves the answer;
- which answer fields and caveats are mandatory;
- which pass/fail thresholds govern launch and regression.

Golden cases may later power deterministic fast paths, but in v0.4 their first
job is evals and readiness.

## 1. Goals And Non-Goals

Goals:

1. Define a `golden_case` Context Asset schema.
2. Generate route, execution, data-fidelity, evidence, disclosure, and safety evals from each case.
3. Keep Metric Views as the semantic happy path for governed metrics.
4. Keep direct SQL as an eval oracle, drill-down source, or explicit fallback, not the default semantic truth.
5. Store eval results with enough metadata to detect model, prompt, context, and data regressions.
6. Support a Distribution seed package without baking Distribution-specific fields into the generic model.

Non-goals:

- No production role/scope enforcement.
- No template marketplace.
- No full asset-manifest service.
- No automatic Metric View definition generation.
- No mandatory dedicated `query_metric_view` tool.
- No mandatory deterministic fast path for ordinary runtime until evals justify it.

## 2. Golden Case As Context Asset

`golden_case` is a `control_plane` Context Asset. It references, but does not
replace, routing and execution assets.

| Asset Field | v0.4 Requirement |
|---|---|
| `id` | Stable case id, used in traces and telemetry |
| `asset_type` | `control_plane` |
| `defense_claim` | Which failure modes the case detects or prevents |
| `format` | YAML/JSON in project settings or project file |
| `storage` | DB settings, project file, or eval fixture |
| `source_of_truth` | Authored case file/settings plus linked oracle query owner |
| `owner` | Case/eval owner; oracle owner when different |
| `freshness_policy` | When prompts, oracles, Metric View refs, and expected answers must be reviewed |
| `validation_status` | candidate, active, stale, blocked, dark |
| `loading_behavior` | `eval_only` by default; compact launch summary may be `compiled_summary` |
| `scope` | project plus eval/control |
| `observability_signal` | case id, route id, execution evidence id, assertion results, telemetry row |

Golden cases should remain narrow. Prefer multiple small cases over one broad
"answer everything" case.

## 3. Relationship To Routing And Execution

Golden cases bind v0.3.6 and v0.3.7 outputs into one eval contract.

```text
natural-language prompt
  -> expected routing_decision
  -> expected execution_contract
  -> expected execution_evidence
  -> oracle / snapshot comparison
  -> answer contract and provenance assertions
  -> launch and regression telemetry
```

Runtime can still use the normal route/execute flow. The golden case evaluates
whether that flow behaved as expected. If a deterministic golden path is later
added, it should consume the same case asset and produce the same evidence.

## 4. Golden Case Schema

Recommended shape:

```yaml
golden_cases:
  - id: distribution_a1_m1_achievement
    title: M1 monthly POC achievement
    status: candidate | active | stale | blocked | dark
    owner: distribution_analytics
    defense_claims:
      - Detect wrong Metric View selection for POC achievement questions.
      - Detect incorrect month or M1 scope.
      - Detect answer drift against the direct SQL oracle.
    coverage:
      question_family: KPI
      stakes_tier: headline_kpi | exploratory | drill_down
      launch_tier: dark | preview | launched
      audience_roles: [M1]
      languages: [zh, en]
    prompts:
      - id: zh_default
        text: "我这个月达成率多少？还差几家店？"
        parameters:
          yearmonth: "202604"
          employee_no: "28036110"
      - id: en_default
        text: "What is my POC achievement rate this month?"
        parameters:
          yearmonth: "202604"
          employee_no: "28036110"
    required_context_assets:
      - type: semantic_truth
        ref: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
      - type: business_context
        ref: requirements.md
      - type: business_context
        ref: readiness.md
    route_expectation:
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
    execution_expectation:
      query_mode: metric_view_sql
      required_query_ref: poc_achievement_by_m1_month
      expected_grain: M1 x Month
      required_filters:
        - yearmonth
        - employee_no
      fallback_allowed: false
      suspicious_checks:
        - row_count_nonzero
        - denominator_nonzero
        - source_tier_matches_route
    metric_view_queries:
      poc_achievement_by_m1_month:
        metric_view: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
        dimensions: [M1 No, Year Month]
        measures:
          - Total POC Count
          - Achieved POC Count
          - Not Achieved POC Count
          - POC Achievement Rate
        parameters: [employee_no, yearmonth]
        expected_grain: M1 x Month
        sql: null
    oracle:
      type: direct_sql
      query_ref: poc_achievement_by_m1_month_direct_sql
      owner: distribution_analytics
      freshness_policy: review_after_metric_view_change
      expected_grain: M1 x Month
      sql: |
        SELECT ...
    answer_contract:
      must_include:
        - POC achievement rate
        - achieved POC count
        - total POC count
        - not achieved POC count
      must_not_include:
        - production row-level security claim
        - data outside the selected M1 scope
      required_caveats: []
      provenance_required: true
      visualization_optional: true
    assertions:
      routing:
        source_tier: exact
        selected_entity: exact
        required_file_recall: ">=1.0"
      execution:
        source_tier_compliance: true
        query_ref_required: true
        grain_required: true
        fallback_reason_required_when_raw: true
      data:
        count_fields: exact
        rate_tolerance: 0.01
      disclosure:
        footer_parseable: true
        footer_matches_trace: true
      safety:
        read_only_tools_only_for_preview: true
        no_security_overclaim: true
    launch_gate:
      min_cases: 2
      min_route_accuracy: 0.98
      min_data_accuracy: 0.98
      max_footer_mismatch_rate: 0
      max_read_only_safety_failures: 0
```

The schema intentionally separates:

- route expectation from execution expectation;
- Metric View query intent from direct SQL oracle;
- answer contract from scoring assertions;
- launch gate from individual assertion rules.

## 5. Loading Behavior

Golden cases are mostly `eval_only`.

| Content | Loading |
|---|---|
| Full prompts, expected rows, direct SQL oracle, scoring assertions | `eval_only` |
| Case id, title, launch tier, covered question family | `compiled_summary` only when the product wants to advertise coverage |
| Route-required files and semantic refs | Referenced by v0.3.6 routing assets |
| Execution templates and query refs | Referenced by v0.3.7 execution assets |
| Eval result telemetry | `telemetry` |

Do not render full golden cases or oracle SQL into ordinary user-run prompts.
That leaks eval answers into the model and invalidates the eval.

## 6. Eval Layers

Each golden case should generate a layered eval suite.

| Layer | Assertion Examples |
|---|---|
| Routing | selected case id, question family, source tier, selected MV/table, required file recall, fallback reason |
| Execution | query mode, selected source used, `MEASURE(...)` usage, declared filters, expected grain, no raw fallback unless allowed |
| Data fidelity | row-by-row diff, exact counts, numeric tolerances, null and denominator checks |
| Evidence | `routing_decision` exists, `execution_evidence` exists, query refs captured, loaded files recorded |
| Disclosure | provenance footer parseable and trace-consistent, fallback disclosed, required caveats present |
| Safety | read-only tool set, no write SQL, no production permission overclaim |
| Regression | model id, git SHA, prompt/context version, case version, latency, tokens, tool/file counts |

## 7. Oracle Policy

Direct SQL oracles are `control_plane` assets, not normal runtime context.

Rules:

- Oracle SQL must be owned and reviewable.
- Oracle SQL should use fixed parameters or fixture windows for repeatability.
- If the oracle is also the trusted answer path, then it is not a hidden oracle;
  classify the case as raw-path or approved-raw instead of Metric View-backed.
- Oracle drift should block launch or mark the case stale.
- Oracle SQL should not be rendered in normal prompts.

## 8. Launch And Regression

Golden cases produce launch gates.

Initial statuses:

| Status | Meaning |
|---|---|
| `candidate` | Authored but not passing all required eval layers |
| `active` | Passing launch gate for a declared tier |
| `stale` | Source, Metric View, oracle, or answer contract needs review |
| `blocked` | Missing semantic truth, oracle, or required data |
| `dark` | Kept for regression but hidden from user-facing coverage |

Launch gates are per domain and stakes tier. A headline KPI case should require
stricter pass rates than exploratory/drill-down cases.

Regression telemetry should support:

- pass rate by case id and assertion layer;
- slow regressions by model id and git SHA;
- source-tier drift;
- oracle mismatch drift;
- pointer non-compliance;
- footer mismatch;
- cost and latency regressions.

## 9. Distribution Seed

Distribution remains the first v0.4 seed, but the generic design should only
depend on reusable fields.

Initial seed cases:

| Case | Primary Eval Purpose |
|---|---|
| `distribution_a1_m1_achievement` | KPI route and MV2 data fidelity |
| `distribution_a5_m1_unachieved_pocs` | POC drill-down plus MV2 -> MV1 handoff |
| `distribution_a2_m2_team_ranking` | Role-shaped scope and ranking |
| `distribution_b3_near_achievement` | Action-oriented threshold logic |
| `distribution_f3_kpi_scan_reconcile` | Reconciliation and data-quality explanation |

Distribution role/persona fields such as `user_context` and `org_chart_notes`
are eval/demo context only in v0.4. They are not production security.

## 10. Boundary With Runtime Fast Paths

v0.4 may optionally use a matched golden case to guide runtime routing or
execution, but that is not the core readiness claim. The core claim is:

> For covered prompts, the normal agent path is measurably correct against a
> reviewed golden-case eval contract.

Fast paths become safe only when they consume the same case asset, produce the
same `routing_decision` and `execution_evidence`, and pass the same eval layers.
