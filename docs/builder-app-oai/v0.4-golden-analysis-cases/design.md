# v0.4 Golden Analysis Cases Design

## Purpose

v0.4 introduces Golden Analysis Cases for recurring, high-value questions where
the analyst already knows the correct analysis path. A golden case maps a set
of user question patterns to a canonical path: required context, resource
inspection, SQL or Metric View query, answer contract, and evaluation checks.

The goal is not to rebuild the old multi-file scenario bundle. v0.4 keeps
`project_setting.yaml` as the project contract and adds a lightweight
golden-case section that the Analysis Agent can use before falling back to
free-form planning.

Related docs:

- `../roadmap.md`
- `../v0.2-business-analysis/design.md`
- `../project-management/design.md`
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
- Capture enough expected behavior to score answer quality and data fidelity.
- Keep v0.4 compatible with read-only user-preview runs.

## Non-Goals

- No business/data/analysis context YAML bundles.
- No template marketplace.
- No production project sharing or membership model.
- No authoritative role resolution from authenticated identity.
- No app-layer row-level permission enforcement.
- No requirement to create Metric Views before a golden case can exist.
- No custom standalone agent per project.

Production role and data-permission enforcement remain v0.5 work.

## Product Model

A Golden Analysis Case is a reviewed, project-owned path for answering one
well-known question family.

It contains:

- question triggers
- audience role hints
- required context
- canonical data path
- required validation steps
- answer contract
- eval expectations
- optional visualization guidance

The fast path is:

```text
User question
-> Match golden case
-> Load project settings + notes + user context
-> Inspect configured schema
-> Execute canonical SQL or Metric View query
-> Produce structured story conclusion
-> Score against expected answer/eval contract
```

If no case matches with sufficient confidence, the Analysis Agent uses the
normal free-form planning path.

## Project Setting Contract

v0.4 extends the minimal v0.2 YAML shape with three optional top-level sections:

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
    canonical_path:
      - step: string
        action: inspect_schema | execute_sql | query_metric_view | conclude
        target: string | null
        query_ref: string | null
        notes: string | null
    queries:
      query_ref:
        description: string
        sql: string
        parameters: string[]
        expected_grain: string | null
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
    canonical_path:
      - step: Inspect POC achievement schema
        action: inspect_schema
        target: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
        query_ref: null
        notes: Confirm columns before analytical SQL.
      - step: Query POC achievement
        action: execute_sql
        target: null
        query_ref: poc_achievement_by_m1_month
        notes: Filter by user_context.employee_no and requested yearmonth.
      - step: Conclude
        action: conclude
        target: null
        query_ref: null
        notes: Return concise M1 action-oriented answer.
    queries:
      poc_achievement_by_m1_month:
        description: Count achieved, total, and remaining POCs for one M1-month.
        parameters: [employee_no, yearmonth]
        expected_grain: M1 x Month
        sql: |
          SELECT
            m1_no,
            yearmonth,
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
      ground_truth_query_ref: poc_achievement_by_m1_month
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

### Golden Analysis Cases
<bounded list of case IDs, titles, question examples, and canonical path summaries>
```

Rendering rules:

- Render `org_chart_notes` directly below `analysis_notes`.
- Keep labels separate. Do not merge org chart notes into known caveats.
- Bound the number of rendered golden cases to avoid prompt bloat.
- For each rendered case, include only enough information for routing and
  planning. Full SQL can be retrieved from the project setting only after a
  match is selected.
- Never render secrets or tokens.

## Settings Page Contract

The project settings UI should expose these as separate fields:

| Field | User-facing purpose |
|---|---|
| `analysis_notes` | Metric definitions, caveats, filters, business rules, validation checks. |
| `org_chart_notes` | Hierarchy lookup rules, role scope derivation, ambiguity handling. |
| `user_context` | Current demo/eval persona: role, employee number, display name. |
| `golden_cases` | Canonical question paths, queries, answer contracts, eval checks. |

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

### Golden Path Execution

When a golden case is selected, the agent should still use the visible plan
and evidence model:

```text
update_plan(create)
update_plan(start: inspect schema)
get_table_stats_and_schema(...)
update_plan(finish)
update_plan(start: run canonical query)
execute_sql(...)
update_plan(finish)
update_plan(start: synthesize)
submit_conclusion(...)
```

Rules:

- Inspect schema before running canonical SQL against configured resources.
- Use canonical SQL or Metric View references from the case.
- Substitute only declared parameters.
- Do not let the model invent columns that are not confirmed by schema
  inspection.
- If a canonical query fails because a resource is unavailable, return a clear
  case-readiness failure instead of silently using a broad fallback.
- Use `submit_conclusion` for the final answer.

### Fallback Behavior

Fallback is allowed when:

- no case matches
- required context is missing and the user cannot provide it
- a configured resource is inaccessible
- the case explicitly allows exploratory follow-up

Fallback must be visible. The story should say that it did not use the golden
path and why.

## Metric View Positioning

Metric Views are preferred for governed metrics, but they are not required for
v0.4.

Recommended path:

1. Start with canonical SQL over declared base tables.
2. Add direct SQL ground-truth queries for evals.
3. When a Metric View is created and validated, register it in
   `databricks_resources.input_metric_views`.
4. Allow golden cases to reference the Metric View for the happy path while
   keeping direct SQL as the eval oracle.

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
| Query fidelity | SQL uses declared resources and parameters. |
| Data fidelity | Returned numbers match ground-truth query within tolerance. |
| Response quality | Answer includes required fields and avoids forbidden claims. |
| Read-only safety | User-preview run exposes no write-capable project or Databricks tools. |

Case ship bar:

- Routing accuracy passes for reviewed question variants.
- Data fidelity passes for all exact/count fields and configured tolerances.
- No read-only safety failure.
- No answer includes out-of-scope data claims.
- At least one completed trace ID is captured for the case.

## Distribution Seed Scope

Distribution is the first documented non-BDR candidate for this design. Its
initial v0.4 slice should focus on achievement and KPI reconciliation:

| Case | Role | Path |
|---|---|---|
| M1 achievement summary | M1 | POC achievement summary table or MV2. |
| M1 unachieved POCs | M1 | POC summary -> POC x Group detail. |
| M2 team ranking | M2 | User context + org chart notes -> team-scoped achievement. |
| Near-achievement POCs | M1/M2 | Detail grouped by POC and Group. |
| KPI vs scan reconciliation | M2/M3 | KPI725 table joined or compared to scan summary. |

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
