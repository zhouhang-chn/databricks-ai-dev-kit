# v0.4 Golden Analysis Cases Design

## Purpose

v0.4 introduces Golden Analysis Cases for recurring, high-value questions where
the analyst already knows the correct analysis path. A golden case maps a set
of user question patterns to a canonical path: required context, resource
inspection, certified Metric View query, direct SQL validation, answer
contract, and evaluation checks.

The goal is not to rebuild the old multi-file scenario bundle. v0.4 keeps
`project_setting.yaml` as the project contract and adds a lightweight
golden-case section that the Analysis Agent can use before falling back to
free-form planning.

Related docs:

- `../roadmap.md`
- `../v0.2-business-analysis/design.md`
- `../v0.3.5-metric-view-context-engineering/design.md`
- `../project-management/design.md`
- `action-plan.md`
- `distribution-gap-analysis.md`

## Goals

- Define golden cases inside project settings or a project-setting-derived
  template.
- Preserve the v0.2 contract: business background, analysis notes, and
  Databricks resources remain the foundation.
- Add `user_context` for manual current-user persona setup in demos and evals.
- Add `org_chart_notes` as a separate context channel for hierarchy and
  scope-derivation guidance.
- Let the agent detect when a question matches a golden case and run the
  canonical path.
- Make v0.3.5-certified Metric Views the default happy path for governed
  metrics, while retaining direct SQL as the validation oracle.
- Require each metric-oriented golden case to declare its Metric View
  dependencies, required dimensions, required measures, readiness expectation,
  and fallback policy.
- Capture enough expected behavior to score answer quality and data fidelity.
- Keep v0.4 compatible with read-only user-preview runs.

## Non-Goals

- No business/data/analysis context YAML bundles.
- No template marketplace.
- No production project sharing or membership model.
- No authoritative role resolution from authenticated identity.
- No app-layer row-level permission enforcement.
- No Metric View authoring workflow inside v0.4. Metric View discovery,
  validation, and certification are v0.3.5 work.
- No custom standalone agent per project.

Production role and data-permission enforcement remain v0.5 work.

## Product Model

A Golden Analysis Case is a reviewed, project-owned path for answering one
well-known question family.

It contains:

- question triggers
- audience role hints
- required context
- certified semantic dependencies
- canonical Metric View data path
- required validation steps
- answer contract
- eval expectations
- optional visualization guidance

Metric View-first rule:

- KPI, aggregate, ranking, trend, comparison, and reconciliation cases should
  use certified Metric Views as their canonical answer path.
- Direct SQL is the oracle for data-fidelity evaluation, the tool for row-level
  drill-down, or a documented fallback when no certified Metric View covers the
  requirement.
- A metric-oriented case with no certified or explicitly accepted candidate
  Metric View is not ready for the golden path.

The fast path is:

```text
User question
-> Match golden case
-> Load project settings + notes + user context
-> Inspect configured schema
-> Query certified Metric View with explicit dimensions and MEASURE() calls
-> Optionally run direct SQL oracle for validation/eval
-> Produce structured story conclusion
-> Score against expected answer/eval contract
```

If no case matches with sufficient confidence, the Analysis Agent uses the
normal free-form planning path.

## Project Setting Contract

v0.4 consumes the v0.3.5 Metric View context when present and extends the
minimal v0.2 YAML shape with that structured semantic context plus three
optional top-level sections: `org_chart_notes`, `user_context`, and
`golden_cases`.

```yaml
business_background: >-
  Natural-language scenario, objective, decision context, key questions, and
  expected outcome.

analysis_notes:
  # Business and metric rules.
  - string

org_chart_notes:
  # Org hierarchy lookup, role scope, and ambiguity handling rules.
  - string

user_context:
  role: string
  employee_no: string
  display_name: string

databricks_resources:
  databricks_host: string | null
  cluster_id: string | null
  warehouse_id: string | null
  workspace_folders: string[]
  workspace_files: string[]
  workflows: string[]
  input_schemas: string[]
  input_tables: string[]
  input_metric_views: string[]
  input_volume_paths: string[]
  output_schema: string | null
  output_volume_folders: string[]

metric_view_context:
  metric_views:
    - full_name: string
      status: candidate | validated | certified | stale | missing
      grain: string[]
      dimensions: string[]
      measures: string[]
      business_terms: object
      validation:
        direct_sql_ref: string | null
        tolerance: object
        checked_at: string | null

golden_cases:
  - id: string
    title: string
    description: string | null
    audience_roles: string[]
    questions: string[]
    match:
      intent: string | null
      keywords: string[]
      required_entities: string[]
      confidence_threshold: number
    required_context:
      - string
    metric_view_refs:
      - full_name: string
        purpose: primary | drill_down | comparison
        required_status: certified | validated | candidate
        required_dimensions: string[]
        required_measures: string[]
        fallback_policy: readiness_failure | direct_sql_allowed | exploratory_only
    canonical_path:
      - step: string
        action: inspect_schema | query_metric_view | execute_sql | validate_sql | conclude
        target: string | null
        query_ref: string | null
        notes: string | null
    metric_view_queries:
      query_ref:
        description: string
        metric_view: string
        dimensions: string[]
        measures: string[]
        parameters: string[]
        expected_grain: string | null
        sql: string | null
    validation_queries:
      query_ref:
        description: string
        validates_query_ref: string
        oracle_type: direct_sql | reconciliation_sql
        parameters: string[]
        expected_grain: string | null
        sql: string
    expected_answer:
      must_include: string[]
      must_not_include: string[]
      confidence: high | medium | low | null
      caveat_required: boolean
      recommended_next_step_required: boolean
    eval:
      ground_truth_query_ref: string | null
      data_tolerance: object
      response_rubric: string[]
```

### `metric_view_context`

`metric_view_context` is the v0.3.5 semantic asset pack. v0.4 should treat it
as the source of truth for metric-oriented golden cases instead of rediscovering
metric definitions from base-table SQL.

Golden cases may repeat only the subset needed for routing and readiness:
Metric View name, required dimensions, required measures, required status, and
fallback policy. Grain, comments, business terms, synonyms, source objects, and
validation metadata should remain in `metric_view_context` so those structured
assets keep accumulating independently of individual cases.

### `analysis_notes`

Use for metric definitions, business caveats, validation checks, required
filters, rejected analysis paths, and decision-owner expectations.

Examples:

```yaml
analysis_notes:
  - All achievement analysis must align KPI configuration and achievement by yearmonth.
  - Report both POC-level achievement and POC x Group-level gaps when relevant.
  - Clean channel values with IH -> TT, NULL -> KA, and exclude T2WS.
```

### `org_chart_notes`

Use for org hierarchy lookup rules, role-to-scope derivation, and ambiguity
handling. Keep these separate from `analysis_notes` so the prompt can label the
context correctly.

Examples:

```yaml
org_chart_notes:
  - For M2 questions, resolve team scope from employee_relation_m1m2m3_monthly
    where m2_employee_no equals user_context.employee_no.
  - For M3 questions, resolve managed M1 scope from employee_relation_m1m2m3_monthly
    where m3_employee_no equals user_context.employee_no.
  - Use relation_month equal to the requested yearmonth.
  - If no matching org rows are found for the requested month, ask the user to
    confirm employee_no or month instead of broadening to all employees.
```

### `user_context`

`user_context` is a v0.4 demo/eval bridge. It identifies the current persona
only:

```yaml
user_context:
  role: M2
  employee_no: "28012345"
  display_name: "M2 demo user"
```

It must not grant access, imply sharing, or replace Databricks permissions. It
is input context for canonical paths and expected answer shape. v0.5 will
replace this manual setup with authenticated role and data-scope resolution.

### `golden_cases`

Each case should be narrow. Prefer several small cases over one broad "answer
everything" case.

Metric-oriented cases should be Metric View-backed by default. A raw-table
`execute_sql` action can still appear in `canonical_path`, but only for direct
SQL validation, row-level drill-down, or an explicit fallback that the case
declares.

Minimum useful case:

```yaml
golden_cases:
  - id: distribution_a1_m1_achievement
    title: M1 monthly achievement summary
    description: Summarize current M1 POC achievement for one month.
    audience_roles: [M1]
    questions:
      - What is my achievement rate this month?
      - How many POCs have I achieved and how many remain?
    match:
      intent: achievement_summary
      keywords: [achievement, achieved, rate, remaining]
      required_entities: [yearmonth]
      confidence_threshold: 0.75
    required_context:
      - user_context.role
      - user_context.employee_no
      - question.yearmonth
    metric_view_refs:
      - full_name: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
        purpose: primary
        required_status: certified
        required_dimensions: [Year Month, M1 No]
        required_measures:
          - Total POC Count
          - Achieved POC Count
          - Not Achieved POC Count
          - POC Achievement Rate
        fallback_policy: readiness_failure
    canonical_path:
      - step: Inspect POC achievement Metric View
        action: inspect_schema
        target: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
        query_ref: null
        notes: Confirm dimensions and measures before querying the Metric View.
      - step: Query POC achievement
        action: query_metric_view
        target: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
        query_ref: poc_achievement_by_m1_month
        notes: Filter by user_context.employee_no and requested yearmonth.
      - step: Validate POC achievement numbers
        action: validate_sql
        target: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
        query_ref: poc_achievement_by_m1_month_direct_sql
        notes: Use only as eval oracle or sampled runtime validation.
      - step: Conclude
        action: conclude
        target: null
        query_ref: null
        notes: Return concise M1 action-oriented answer.
    metric_view_queries:
      poc_achievement_by_m1_month:
        description: Count achieved, total, and remaining POCs for one M1-month through MV2.
        metric_view: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
        dimensions: [M1 No, Year Month]
        measures:
          - Total POC Count
          - Achieved POC Count
          - Not Achieved POC Count
          - POC Achievement Rate
        parameters: [employee_no, yearmonth]
        expected_grain: M1 x Month
        sql: |
          SELECT
            `M1 No` AS m1_no,
            `Year Month` AS yearmonth,
            MEASURE(`Total POC Count`) AS total_poc_count,
            MEASURE(`Achieved POC Count`) AS achieved_poc_count,
            MEASURE(`Not Achieved POC Count`) AS not_achieved_poc_count,
            MEASURE(`POC Achievement Rate`) AS poc_achievement_rate
          FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
          WHERE `Year Month` = :yearmonth
            AND `M1 No` = :employee_no
          GROUP BY ALL
    validation_queries:
      poc_achievement_by_m1_month_direct_sql:
        description: Direct source-table oracle for the MV2 M1-month result.
        validates_query_ref: poc_achievement_by_m1_month
        oracle_type: direct_sql
        parameters: [employee_no, yearmonth]
        expected_grain: M1 x Month
        sql: |
          SELECT
            m1_no,
            CAST(yearmonth AS INT) AS yearmonth,
            COUNT(DISTINCT poc_middle_id) AS total_poc_count,
            COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END) AS achieved_poc_count,
            COUNT(DISTINCT CASE WHEN achievement_date IS NULL THEN poc_middle_id END) AS not_achieved_poc_count,
            COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END) * 1.0
              / NULLIF(COUNT(DISTINCT poc_middle_id), 0) AS poc_achievement_rate
          FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
          WHERE yearmonth = :yearmonth
            AND m1_no = :employee_no
            AND channel != 'T2WS'
          GROUP BY m1_no, yearmonth
    expected_answer:
      must_include:
        - POC achievement rate
        - achieved POC count
        - total POC count
        - not achieved POC count
      must_not_include:
        - data outside the current employee scope
      confidence: high
      caveat_required: false
      recommended_next_step_required: true
    eval:
      ground_truth_query_ref: poc_achievement_by_m1_month_direct_sql
      data_tolerance:
        poc_achievement_rate: 0.01
        count_fields: exact
      response_rubric:
        - Answer is concise and action-oriented for M1.
        - Numeric values match query output.
        - Answer does not claim production row-level security.
```

## Prompt Rendering

The Project Management Context should render the new sections in this order:

```text
### Analysis Notes
<analysis_notes rendered in order>

### Org Chart Notes
<org_chart_notes rendered in order>

### User Context
- Role: <role>
- Employee No: <employee_no>
- Display Name: <display_name>

### Metric View Context
<bounded list of registered Metric Views, status, grain, dimensions, measures, validation refs>

### Golden Analysis Cases
<bounded list of case IDs, titles, question examples, and canonical path summaries>
```

Rendering rules:

- Render `org_chart_notes` directly below `analysis_notes`.
- Keep labels separate. Do not merge org chart notes into known caveats.
- Render Metric View context before golden cases so routing sees the governed
  semantic layer before case-specific paths.
- Bound the number of rendered golden cases to avoid prompt bloat.
- For each rendered case, include only enough information for routing and
  planning: case ID, trigger examples, primary Metric Views, required
  dimensions/measures, readiness status, and canonical path summary. Full SQL
  can be retrieved from the project setting only after a match is selected.
- Never render secrets or tokens.

## Settings Page Contract

The project settings UI should expose these as separate fields:

| Field | User-facing purpose |
|---|---|
| `analysis_notes` | Metric definitions, caveats, filters, business rules, validation checks. |
| `org_chart_notes` | Hierarchy lookup rules, role scope derivation, ambiguity handling. |
| `user_context` | Current demo/eval persona: role, employee number, display name. |
| `metric_view_context` | Registered Metric Views, status, grain, dimensions, measures, and validation references from v0.3.5. |
| `golden_cases` | Metric View-backed question paths, validation queries, answer contracts, eval checks. |

The first UI version can use editable YAML/text blocks for `golden_cases`.
Structured editing can come later after the schema stabilizes.

## Runtime Behavior

### Case Matching

At the start of an analysis run:

1. Load project settings.
2. Render business context, analysis notes, org chart notes, user context, and
   a bounded golden-case routing summary.
3. Classify the user question against golden cases.
4. If one case passes its confidence threshold and required context exists,
   choose the golden path.
5. If no case matches, use normal free-form planning.
6. If a case almost matches but required context is missing, ask a targeted
   clarification.

Matching should consider:

- question examples
- keywords
- intent label
- requested role
- required entities, such as month or POC
- whether configured resources exist
- whether `metric_view_context` contains a Metric View with the required status,
  dimensions, and measures

### Golden Path Execution

When a golden case is selected, the agent should still use the visible plan
and evidence model:

```text
update_plan(create)
update_plan(start: inspect schema)
get_table_stats_and_schema(...)
update_plan(finish)
update_plan(start: run canonical query)
query_metric_view(...) or execute_sql(metric_view_sql_with_MEASURE)
update_plan(finish)
update_plan(start: validate against direct SQL oracle)
execute_sql(...)
update_plan(finish)
update_plan(start: synthesize)
submit_conclusion(...)
```

Rules:

- Inspect schema before running canonical Metric View SQL or validation SQL
  against configured resources.
- Execute certified Metric View references from the case as the happy path.
- Query Metric View measures with `MEASURE()` and explicit dimensions. Do not
  use `SELECT *` against Metric Views.
- Use direct SQL references only for validation, detail drill-down, and
  documented fallback paths.
- Substitute only declared parameters.
- Do not let the model invent columns that are not confirmed by schema
  inspection.
- If the case requires a certified Metric View and only a candidate, stale, or
  missing Metric View is available, return a readiness failure unless the case
  explicitly sets `required_status: candidate` or
  `fallback_policy: direct_sql_allowed`.
- If a canonical query fails because a resource is unavailable, return a clear
  case-readiness failure instead of silently using a broad fallback.
- Use `submit_conclusion` for the final answer.

### Fallback Behavior

Fallback is allowed when:

- no case matches
- required context is missing and the user cannot provide it
- a configured resource is inaccessible
- the case explicitly allows exploratory follow-up
- the case declares `direct_sql_allowed` and the Metric View path is unavailable

Fallback must be visible. The story should say that it did not use the golden
path and why.

## Metric View Positioning

Metric Views are the preferred happy path for governed metrics in v0.4. The
discovery, design, validation, and certification of those Metric Views belongs
to v0.3.5.

Recommended path:

1. Build and validate Metric Views in v0.3.5.
2. Register certified Metric Views in `databricks_resources.input_metric_views`.
3. In v0.4, require metric-oriented golden cases to reference those Metric Views
   for the happy path.
4. Keep direct SQL ground-truth queries as eval oracles.
5. If a case requires a metric that is not covered by a certified Metric View,
   mark the case as not ready or define an explicit fallback path.

Until a dedicated `query_metric_view` tool exists, golden cases can query Metric
Views through `execute_sql`.

## Evaluation Contract

Each golden case should be evaluable without relying only on subjective review.

Minimum eval layers:

| Layer | Requirement |
|---|---|
| Routing | Correct case is selected for known question variants. |
| Planning | Plan follows the canonical path. |
| Schema safety | Schema inspection happens before analytical SQL. |
| Semantic dependency | Metric-oriented cases reference registered Metric Views with required dimensions and measures. |
| Query fidelity | Metric View SQL uses `MEASURE()`, declared dimensions, declared resources, and declared parameters. |
| Data fidelity | Returned numbers match ground-truth query within tolerance. |
| Response quality | Answer includes required fields and avoids forbidden claims. |
| Read-only safety | User-preview run exposes no write-capable project or Databricks tools. |

Case ship bar:

- Routing accuracy passes for reviewed question variants.
- Metric-oriented cases run through a registered Metric View or return an
  explicit readiness/fallback reason.
- Data fidelity passes for all exact/count fields and configured tolerances.
- No read-only safety failure.
- No answer includes out-of-scope data claims.
- At least one completed trace ID is captured for the case.

## Distribution Seed Scope

Distribution is the first documented non-BDR candidate for this design. Its
initial v0.4 slice should focus on achievement and KPI reconciliation:

| Case | Role | Path |
|---|---|---|
| M1 achievement summary | M1 | MV2, with summary-table direct SQL as eval oracle. |
| M1 unachieved POCs | M1 | MV2 -> MV1, with direct SQL used only for detail validation or explicit drill-down. |
| M2 team ranking | M2 | MV1/MV2 with user context and org chart notes for team-scoped achievement. |
| Near-achievement POCs | M1/M2 | MV1 grouped by POC and Group, with detail table as oracle. |
| KPI vs scan reconciliation | M2/M3 | MV3, with KPI725 table joined or compared to scan summary as eval oracle. |

Defer fraud, SKU recommendation, POC ranking, and POC profiling until their
derived tables are stable and declared in project settings.

## v0.5 Boundary

v0.4 can simulate role-shaped behavior for golden cases, but it must not imply
production access control.

The v0.5 boundary is:

- authenticated user -> project role resolution
- project sharing and consumer access
- user -> employee identifier mapping
- org-scope resolution from authoritative tables
- SQL-time row-filter injection
- fail-closed behavior when a predicate is missing
- audit of user, role, table, and applied predicate

In v0.4, any filter derived from `user_context` or `org_chart_notes` is part of
the canonical query path and eval setup, not a security layer.

## Validation Plan

v0.4 is ready when:

- `project_setting.yaml` schema supports `org_chart_notes`, `user_context`, and
  `golden_cases`.
- v0.3.5 has certified or explicitly rejected the Metric Views referenced by
  the initial golden cases.
- The settings page exposes those sections separately.
- Prompt rendering places `org_chart_notes` immediately below `analysis_notes`.
- At least one project has five reviewed golden cases.
- User-preview golden runs use read-only tools only.
- Each case has a trace ID, canonical query, ground-truth query, and response
  score.
- Fallback behavior is explicit when a case cannot run.

## Open Questions

- Should golden cases live directly in `project_setting.yaml`, or should large
  SQL bodies move to a separate project file referenced by ID?
- Should matching be implemented as deterministic keyword matching first, with
  LLM fallback only for ambiguous questions?
- Should project releases snapshot golden cases independently from draft
  settings once user-facing sessions rely on them?
- How much of the eval contract should live in project settings versus a
  dedicated eval file?
