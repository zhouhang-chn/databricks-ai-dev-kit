# Distribution Golden Case Gap Analysis

Date: 2026-05-19

## Purpose And Scope

This document evaluates `databricks-builder-app-oai/projects/distribution`
against the current `databricks-builder-app-oai` implementation and
`docs/builder-app-oai` product direction. The goal is to decide how the
Distribution project should be supported in the v0.4 Golden Analysis Cases
track.

Scope:

- Source project:
  - `databricks-builder-app-oai/projects/distribution/README.md`
  - `databricks-builder-app-oai/projects/distribution/distribution.yaml`
  - `databricks-builder-app-oai/projects/distribution/data-agent-requirement-analysis.md`
  - `databricks-builder-app-oai/projects/distribution/data-agent-design.md`
  - `databricks-builder-app-oai/projects/distribution/metric-view-design.md`
  - `databricks-builder-app-oai/projects/distribution/data-agent-evals.md`
- Current app implementation:
  - project settings YAML and JSON settings
  - OpenAI runtime project context
  - read-only user-preview tools
  - structured analysis story, evidence, chart, and conclusion flow
- Current docs:
  - `docs/builder-app-oai/roadmap.md`
  - `docs/builder-app-oai/v0.2-business-analysis/design.md`
  - `docs/builder-app-oai/v0.3-visual-storytelling/design.md`
  - `docs/builder-app-oai/project-management/design.md`

Out of scope:

- Live Databricks validation.
- Creating Metric Views, dashboards, jobs, or app code.
- Implementing production roles, sharing, or row-level permissions.

## Executive Summary

Distribution is a strong v0.4 candidate, but it should not be implemented as
the full custom Data Agent described in the project artifacts yet. The right
v0.4 support shape is a Golden Analysis Case package: project settings,
manually curated role/identifier context, canonical question paths, canonical
SQL or Metric View queries, expected answer contracts, and eval cases.

The current OAI app already supports the necessary foundation: minimal
`project_setting.yaml`, analysis notes, preferred tables and metric views,
read-only user-preview runs, schema-before-SQL gates, structured plans,
evidence rendering, chart detection, and structured conclusions. The major gap
is that Metric Views must be promoted into a v0.3.5 semantic-layer milestone
before v0.4 golden cases are finalized. Distribution currently has rich design
docs, but no app-consumable Metric View context pack or golden-case artifact
that maps user questions to certified semantic paths.

User roles and identifiers should be handled manually for v0.4 through a small
project-setting extension. That extension should describe only the current
user persona: `role`, `employee_no`, and `display_name`. Org chart assumptions
should live in a separate `org_chart_notes` section, rendered below
`analysis_notes` in the prompt. This keeps business-analysis rules distinct
from org-scope derivation guidance without pretending that v0.4 has
authoritative role or row-level enforcement. Real role resolution, sharing, and
row-level data permission remain v0.5 work as the roadmap already states.

## Current App Fit

Implemented capabilities that fit Distribution:

- `project_setting.yaml` already captures business background, analysis notes,
  Databricks host, cluster, warehouse, workspace files, schemas, tables, metric
  views, and output locations.
- Saving project settings maps tables into `settings.semantics.preferred_tables`,
  metric views into `settings.semantics.metric_views`, and notes into
  `settings.semantics.known_caveats`; the runtime renders these into Project
  Management Context.
- Read-only roles (`user_preview`, `user`, `viewer`) get project-file read
  tools only and read-oriented Databricks tools.
- Configured project tables and metric views require schema inspection before
  analytical SQL, which helps prevent hallucinated column names.
- Structured `update_plan` and `submit_conclusion` support auditable analysis
  stories.
- The frontend already supports inline evidence, chart detection, model-guided
  visualization specs, confidence/caveat/recommended-next-step fields, and
  contradiction handling.

Current limitations:

- The app has a generic developer/user-preview role, not Distribution business
  roles such as M1, M2, M3, and HQ.
- Read-only mode prevents write tools, but it does not inject business data
  filters such as `m1_no = current_user_employee_no`.
- `distribution.yaml` contains no `input_metric_views`; the Distribution
  Metric View design is still a design document, not a registered semantic
  layer in the project setting.
- The app can store `semantics.sample_queries` and `eval_cases` in JSON
  settings, but the public YAML contract and UI do not expose golden cases as a
  first-class object yet.
- There is no dedicated `query_metric_view` tool. Metric Views can be queried
  through SQL, but the Distribution design assumes a higher-level Metric View
  tool with measure/dimension/filter parameters and automatic permission
  injection.
- Some Distribution scenarios depend on notebook-derived intermediate outputs
  such as `poc_rank`, `final_poc_rank`, `poc_sku_df`, `m1_scan_bar_code`, and
  `gps_fraud`; these are not all declared as stable input tables.

## Distribution Project Fit

Distribution has enough material for a v0.4 golden case because it defines:

- Clear business grain: `POC x Group x Month`.
- Core entities: `m1_no`, `poc_middle_id`, `group_code`, `mha_sku_key`,
  `yearmonth`.
- Stable domain rules: month alignment, group-to-SKU one-to-many mapping,
  POC-level and POC x Group-level achievement views, channel cleaning, and
  format-specific thresholds.
- Candidate semantic layer: five Metric Views for achievement detail, POC
  achievement, KPI725 benchmark, BEES coverage, and KBD coverage.
- Candidate personas and query scenarios: M1, M2, M3, HQ across achievement,
  action recommendation, fraud, POC profiling, benchmarking, and data quality.
- Candidate eval dimensions: routing, planning, execution, data fidelity,
  response quality, guardrails, and multi-turn state.

The current Distribution artifacts are too broad for a first v0.4 slice. The
MVP should focus on achievement and KPI reconciliation before action
recommendation, fraud, or POC profiling.

## Gap Matrix

| Gap | Current state | Impact | Priority |
|---|---|---|---|
| Golden-case contract | Roadmap describes v0.4 conceptually; app settings do not define `golden_cases`. | Canonical Distribution paths cannot be selected deterministically. | P0 |
| User context | Current YAML has no current-user persona section. | Distribution questions like "my team" or "my stores" lack a stable identity anchor. | P0 |
| Permission enforcement | User-preview blocks writes but does not inject row filters. | v0.4 can evaluate role-shaped answers, but cannot guarantee data isolation. | P0 for documentation, v0.5 for enforcement |
| Metric View registration | `metric-view-design.md` proposes MVs; v0.3.5 must register and validate them. | Agent falls back to raw table SQL and may drift from governed metrics. | P0 |
| Canonical SQL paths | Project docs include examples, but not app-readable query paths with validation checks. | Free-form planning can miss month alignment, channel cleaning, or group grain. | P0 |
| Org chart notes contract | Org-scope guidance currently has nowhere distinct from general analysis notes. | Team-scope instructions can get mixed with metric caveats and become harder to render or validate. | P0 |
| Stable derived tables | Several use cases depend on notebook intermediate outputs not declared as inputs. | Action recommendation and fraud scenarios are not ready for reliable golden runs. | P1 |
| Eval harness alignment | `data-agent-evals.md` is rich but not converted into app `eval_cases`. | No repeatable release gate for Distribution behavior. | P1 |
| Metric View tool | App supports generic SQL and Databricks tools; no role-aware `query_metric_view`. | Metric View design cannot be exercised as intended without SQL boilerplate. | P1 |
| Role-specific UI | UI exposes Developer and User Preview only. | M1/M2/M3 behavior must be simulated through settings and prompts for now. | P2 |
| Production permissions | Roadmap v0.5 covers builder/consumer roles and row-level filters. | Must not be pulled into v0.4 or it will expand scope. | Defer |

## Recommended v0.4 Support Shape

For v0.4, Distribution should be represented as a project-setting-driven golden
case, not a custom standalone Data Agent. The v0.3.5 prerequisite is a
validated Metric View layer that those golden cases can use.

Recommended contract:

```yaml
business_background: >-
  Evaluate SKU distribution completion status at POC-Group-month level as M1
  performance.

analysis_notes:
  - All analysis must align KPI configuration and achievement by yearmonth.
  - m1_no is the M1 employee identifier.
  - poc_middle_id is the POC identifier.
  - group_code is the KPI group assigned to an employee and POC.
  - A group_code can map to multiple mha_sku_key values.
  - Report both POC-level achievement and POC x Group-level gaps when relevant.
  - Clean channel values with IH -> TT, NULL -> KA, and exclude T2WS.

org_chart_notes:
  - For M2 questions, resolve team scope from the monthly org chart by matching
    current user's employee_no to m2_employee_no.
  - For M3 questions, resolve managed M1 scope from the monthly org chart by
    matching current user's employee_no to m3_employee_no.
  - Use relation_month aligned to the requested yearmonth.
  - If the requested role cannot be resolved in the org chart for that month,
    ask for clarification instead of broadening to all employees.

user_context:
  role: M1
  employee_no: "28036110"
  display_name: "M1 demo user"

golden_cases:
  - id: distribution_a1_m1_achievement
    audience_roles: [M1]
    questions:
      - "我这个月达成率多少？"
      - "我还差几家店达成？"
    required_context: [user_context.role, user_context.employee_no, question.yearmonth]
    canonical_path:
      - inspect_schema: m1_poc_achievement_metrics
      - query_metric_view: poc_achievement_by_m1_month
      - conclude: concise_action_answer
    expected_answer:
      must_include:
        - POC achievement rate
        - achieved POC count
        - total POC count
        - not achieved POC count
```

This proposed shape is intentionally lightweight. `user_context` is a temporary
v0.4 bridge for evaluation and demos. It identifies the current persona only.
It should not grant access, filter SQL by itself, or become the final
permissions model.

Prompt rendering rule:

```text
### Analysis Notes
<analysis_notes rendered in order>

### Org Chart Notes
<org_chart_notes rendered in order>
```

`org_chart_notes` should be merged into the prompt immediately below
`analysis_notes`, not mixed into the same list. The runtime may still treat
both as inherited project context, but the labels should remain separate so
the model can distinguish metric/business rules from org-scope derivation
rules.

Settings page rule:

- Show `analysis_notes` and `org_chart_notes` as separate editable fields.
- Label `analysis_notes` for metric definitions, caveats, validation checks,
  and business rules.
- Label `org_chart_notes` for hierarchy lookup rules, scope derivation, and
  ambiguity handling for M1/M2/M3/HQ personas.
- In preview/read-only runs, render both sections into prompt context, with
  `org_chart_notes` directly below `analysis_notes`.

Setup example for an M2 golden run:

```yaml
analysis_notes:
  - All analysis must align KPI configuration and achievement by yearmonth.
  - Report both POC-level achievement and POC x Group-level gaps when relevant.
  - Clean channel values with IH -> TT, NULL -> KA, and exclude T2WS.

org_chart_notes:
  - Current user role M2 means the user's team is the set of rows in
    employee_relation_m1m2m3_monthly where m2_employee_no equals
    user_context.employee_no.
  - Use relation_month equal to the requested yearmonth.
  - The M2 team filter should apply to M1-level facts through m1_no IN the
    resolved employee_no list.
  - If no matching M1 rows are found for the requested month, ask the user to
    confirm the employee_no or month.

user_context:
  role: M2
  employee_no: "28012345"
  display_name: "M2 demo user"
```

## Initial Golden Cases

Start with five golden cases that use the first three certified Metric Views and
retain direct SQL as their eval oracle.

| ID | User question shape | Role | Data path | Why first |
|---|---|---|---|---|
| `distribution_a1_m1_achievement` | "我这个月达成率多少？还差几家店？" | M1 | MV2, summary table as SQL oracle | Simplest role-scoped fact answer. |
| `distribution_a5_m1_unachieved_pocs` | "我哪些店还没达成？各差几个 Group？" | M1 | MV2 -> MV1, summary/detail tables as SQL oracle | Tests POC-level plus POC x Group dual view. |
| `distribution_a2_m2_team_ranking` | "我们片区谁达成率最低？" | M2 | MV1/MV2 with current user context plus `org_chart_notes` | Tests role-shaped behavior without production RBAC. |
| `distribution_b3_near_achievement` | "哪些店差 1 个 Group 就达成？" | M1/M2 | detail grouped by POC and Group | Good action-oriented golden case, still achievement-only. |
| `distribution_f3_kpi_scan_reconcile` | "为什么达成数和 KPI 系统不一致？" | M2/M3 | MV3, KPI725 and scan summary as SQL oracle | Tests data quality and reconciliation behavior. |

Defer these until their derived tables are stable:

- Fraud detection questions using `m1_scan_bar_code`, GPS fraud, QR image
  predictions, and box-code sharing networks.
- SKU recommendation and POC ranking questions using `poc_rank`,
  `final_poc_rank`, or `poc_sku_df`.
- POC profiling questions using lifecycle, volume tier, and collaborative
  filtering outputs.

## Metric View Positioning

The Metric View design is now the v0.3.5 prerequisite. v0.4 should not
rediscover these metric definitions through raw-table SQL unless a certified
Metric View is unavailable or the case explicitly needs row-level drill-down.

Recommended sequence:

1. Create or validate MV1, MV2, and MV3 in v0.3.5.
2. Add the validated MV names to `databricks_resources.input_metric_views`.
3. Map user terms and golden-case questions to Metric View dimensions and
   measures.
4. Keep direct-table SQL as eval references and fallback paths.
5. Move B/D/F extended cases to MV4, MV5, and future fraud/profile MVs only
   after source outputs are materialized.

If the app later adds a `query_metric_view` tool, Distribution should use it
for the happy path. Until then, SQL over Metric Views is acceptable.

## Role And Identifier Bridge

The Distribution docs assume the client supplies validated user identity:
`role`, `employee_no`, `display_name`, org hierarchy, and data scope. The
current app only knows the workspace user email plus a run role such as
`developer` or `user_preview`.

For v0.4:

- Add a `user_context` section to the project setting with only
  `role`, `employee_no`, and `display_name`.
- Add an `org_chart_notes` section for scope derivation guidance, such as how
  M2/M3 scopes should be derived from `employee_relation_m1m2m3_monthly`.
- Render `org_chart_notes` immediately below `analysis_notes` in the prompt
  template.
- Use `user_context` to parameterize canonical queries and expected answers.
- Make the answer disclose the simulated persona context when needed.
- Treat any org-derived scope filter as part of the canonical query, not as
  security.

For v0.5:

- Resolve role from project membership and authenticated Databricks identity.
- Resolve `employee_no` and org scope from authoritative tables such as
  `employee_relation_m1m2m3_monthly`.
- Enforce app-level role gates for builder and consumer surfaces.
- Inject row-level filters at SQL execution time and fail closed when a mapped
  predicate is missing.
- Audit user, role, table, and applied predicate for every filtered query.

This split keeps v0.4 focused on answer quality and repeatability while
preserving the roadmap's security boundary.

## Suggested Project Setting Updates

The current `distribution.yaml` should stay the seed project setting, but a
v0.4-ready version should add:

- `databricks_resources.warehouse_id` if a SQL warehouse is available.
- `databricks_resources.input_metric_views` once MV1-MV3 exist.
- More input tables for KPI725 and org/POC master if the first golden cases
  include team ranking or reconciliation:
  - `brewdat_uc_china_prod.md_exchange_brewdat_ods.tsvc_base_sys_kpiachieverate`
  - `brewdat_uc_china_prod.org_datahub_dw.employee_relation_m1m2m3_monthly`
  - `brewdat_uc_china_prod.poc_datahub_dw.poc_master_daily_fact`
- A `user_context` section for the current demo/eval persona.
- An `org_chart_notes` section for org-scope setup guidance.
- A golden-case section with canonical paths and answer contracts.

Implementation caveat: the current `ProjectSetting` Pydantic model ignores
unknown top-level fields. The app will need a schema extension before
`user_context`, `org_chart_notes`, and `golden_cases` can be saved, rendered,
and injected through the official project-setting flow.

## Validation Plan

Before calling Distribution v0.4-ready, gather this evidence:

1. Project setting validates all declared schemas, tables, workspace paths, and
   at least MV1-MV3 if used.
2. Each P0 golden case has:
   - natural-language trigger questions
   - current user context
   - org chart notes when the role needs team or hierarchy scope
   - canonical SQL or Metric View path
   - expected output contract
   - direct SQL ground-truth query
   - role-specific response rubric
3. User-preview runs expose read-oriented tools only.
4. Every analytical SQL path inspects schema before query execution.
5. Result evidence appears inline in the story with table or chart fallback.
6. Conclusions include claim, evidence, caveat/confidence, and recommended next
   step where appropriate.
7. Eval results cover at least one M1 case, one M2 case, and one data-quality
   reconciliation case.

## Recommended Next Steps

1. Finish the v0.3.5 Metric View context contract and Distribution context
   pack before changing golden-case runtime behavior.
2. Create or validate MV1-MV3 and register them in `input_metric_views`.
3. Validate Distribution Metric View outputs against live base-table SQL.
4. Define the v0.4 `golden_cases`, `user_context`, and `org_chart_notes` schema
   extension in docs before changing implementation.
5. Convert the five initial Distribution cases above into a project-setting
   draft and app `eval_cases`.
6. Run user-preview golden traces and capture trace IDs, SQL, evidence blocks,
   and answer scores.
7. Defer production role resolution, project sharing, and row-level SQL filter
   enforcement to v0.5.
