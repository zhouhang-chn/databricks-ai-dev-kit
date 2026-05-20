# v0.3.5 Scenario Onboarding And Metric View Context Engineering Design

## Purpose

v0.3.5 inserts a scenario-onboarding and semantic-layer release between v0.3
visual storytelling and v0.4 golden analysis cases.

The product thesis is simple: accurate data analysis should not depend on each
agent run rediscovering metric definitions from raw tables, notebooks, and
free-form notes. Databricks Unity Catalog business semantics and Metric Views
are the governed semantic layer. Builder App should engineer that layer from
project context, validate it, and make the Analysis Agent use it first.

The release also covers the preparation loop before query-focused analysis:
define the scenario in `project_setting.yaml`, derive concrete analysis
requirements, inspect existing Databricks data and metadata, identify semantic
asset gaps, build the needed Metric Views, and verify that the semantic layer
can answer the scenario requirements.

Related references:

- `../roadmap.md`
- `../v0.3-visual-storytelling/design.md`
- `../v0.4-golden-analysis-cases/design.md`
- `../../../databricks-skills/databricks-scenario-onboarding/SKILL.md`
- `../../../databricks-builder-app-oai/projects/distribution/metric-view-design.md`
- Databricks docs: [Unity Catalog business semantics](https://docs.databricks.com/aws/en/business-semantics/)
- Databricks docs: [Unity Catalog metric views](https://docs.databricks.com/gcp/en/business-semantics/metric-views)
- Databricks docs: [Agent metadata in metric views](https://docs.databricks.com/gcp/en/business-semantics/agent-metadata)

## Goals

- Make scenario onboarding a first-class preparation workflow before analysis
  execution.
- Define or refine `project_setting.yaml` from business background, analysis
  notes, Databricks resources, tables, Metric Views, volumes, workspace code,
  and output locations.
- Extract a data-analysis requirements matrix from unstructured scenario input
  and resource hints.
- Compare requirements against existing data, metadata, tables, volumes, and
  Metric Views.
- Treat Metric Views as the official semantic layer for reusable business
  metrics, dimensions, grain, synonyms, and formatting.
- Build metric-view candidates by reading project context from:
  - user non-structured business input
  - project analysis notes
  - user code, notebooks, and SQL
  - Unity Catalog schemas, comments, and table metadata
  - data profiling and sampled values
  - analyst feedback from prior runs
- Produce reviewed Metric View YAML definitions with dimensions, measures,
  joins, comments, display names, synonyms, and formats where supported.
- Validate Metric Views by comparing them with direct SQL over source tables.
- Verify Metric View effectiveness and completeness against the extracted
  scenario requirements.
- Register validated Metric Views in `databricks_resources.input_metric_views`
  and `settings.semantics.metric_views`.
- Provide a reusable `databricks-scenario-onboarding` skill for Codex/Claude
  Code preparation before query-focused analysis.
- Make the Analysis Agent prefer Metric Views for KPI and aggregate questions,
  falling back to base tables only for validation, unsupported details, or
  explicitly exploratory analysis.
- Provide v0.4 golden cases with a certified semantic path instead of raw SQL
  as the default happy path.

## Non-Goals

- No full BI modeling studio.
- No unreviewed automatic creation of production Metric Views.
- No production data-permission model. Row filtering and sharing remain v0.5.
- No precomputed metric-serving layer. Materialized or Postgres-served metrics
  remain v0.6.
- No requirement that every source table has a Metric View before exploratory
  analysis can run.
- No production workflow orchestration for onboarding. v0.3.5 defines the
  workflow, artifacts, skill, and validation gates first.

## Scenario Onboarding Workflow

```text
User scenario input
-> create/refine project_setting.yaml
-> extract data-analysis requirements
-> inventory Databricks resources, tables, volumes, metadata, and code
-> compare requirements to existing Metric Views and source assets
-> produce semantic-layer gap analysis
-> build or propose missing Metric Views
-> validate Metric Views against source SQL and requirements
-> mark scenario ready, partially ready, or blocked for query-focused analysis
```

Onboarding artifacts:

- `project_setting.yaml`: compact scenario contract.
- `analysis_requirements`: matrix of question families, metrics, dimensions,
  grain, filters, outputs, caveats, and priority.
- `asset_inventory`: tables, Metric Views, volumes, workspace code, metadata,
  freshness, and known limitations.
- `semantic_gap_analysis`: what is covered, partial, missing, or stale.
- `metric_view_context`: certified Metric Views, candidate Metric Views,
  validations, tolerances, and unresolved assumptions.
- `readiness_summary`: whether query-focused analysis can proceed.

## Context Engineering Inputs

| Input | What Builder extracts | Example |
|---|---|---|
| User non-structured input | Business terms, KPIs, grain, decision context, exclusions | "MHA achievement at POC x Group x Month" |
| Project notes | Caveats, filters, rejected paths, known definitions | "exclude T2WS", "align KPI and scan data by yearmonth" |
| User code and notebooks | Repeated joins, CTEs, filters, aliases, final aggregates | SQL that joins achievement detail to org hierarchy |
| UC metadata | Column names, comments, owners, table freshness, source object type | `m1_no`, `poc_middle_id`, `achievement_date` |
| Data profiling | Cardinality, null rates, min/max, enum-like values, sample rows | channel values `IH`, `KA`, `T2WS` |
| Analyst feedback | Corrections, accepted answers, missing dimensions | "report POC-level and POC x Group gaps" |

## Output Contract

v0.3.5 introduces scenario onboarding artifacts plus a project-level metric
context pack. They can be represented in docs first and later persisted in the
app settings schema.

```yaml
analysis_requirements:
  - requirement_id: distribution_a1_m1_achievement
    question_examples:
      - "我这个月达成率多少？"
      - "还差几家店达成？"
    business_terms:
      - POC achievement rate
      - remaining POCs
    grain:
      - M1
      - Month
    measures:
      - Total POC Count
      - Achieved POC Count
      - Not Achieved POC Count
      - POC Achievement Rate
    dimensions:
      - Year Month
      - M1 No
    filters:
      - exclude T2WS
      - align achievement and KPI configuration by yearmonth
    required_assets:
      metric_views:
        - brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
      tables:
        - brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
    priority: P0

semantic_gap_analysis:
  - requirement_id: distribution_a1_m1_achievement
    existing_coverage: partial
    gaps:
      - Metric View not yet validated against source SQL
    recommended_assets:
      - m1_poc_achievement_metrics
    readiness: blocked_until_validated

metric_view_context:
  discovery_sources:
    user_input: true
    analysis_notes: true
    workspace_code:
      - /Workspace/Users/.../Distribution/MHA_achievement_analysis
    databricks_metadata:
      schemas:
        - brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw
      tables:
        - brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
    data_profile: simple

  metric_views:
    - full_name: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
      status: validated
      source_objects:
        - brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
      grain:
        - POC
        - Month
      dimensions:
        - Year Month
        - M1 No
        - POC ID
        - Channel
      measures:
        - Total POC Count
        - Achieved POC Count
        - POC Achievement Rate
      business_terms:
        POC Achievement Rate:
          synonyms:
            - achievement rate
            - completion rate
            - 达成率
      validation:
        direct_sql_ref: poc_achievement_direct_sql
        tolerance:
          count_fields: exact
          rate_fields: 0.01
```

The stable app-facing registration still lives in:

```yaml
databricks_resources:
  input_metric_views:
    - catalog.schema.metric_view_name
```

## Agent Workflow

```text
Project setup or refinement
-> load or create project_setting.yaml
-> collect unstructured business input and analysis notes
-> extract analysis requirements and answer contracts
-> inspect workspace code and SQL patterns
-> inspect UC schemas, source tables, current Metric Views, and volumes
-> compare requirements to existing assets and metadata
-> document gaps for Metric Views, tables, volumes, and metadata
-> profile candidate dimensions and measures
-> draft Metric View YAML
-> validate with direct SQL, requirements, and sample user questions
-> register validated Metric Views in project settings
-> render Metric View context for analysis runs
```

During an analysis run:

1. Classify the user question against registered Metric Views and their
   dimensions, measures, synonyms, and comments.
2. If the question is KPI or aggregate-oriented and a validated Metric View
   covers the grain, query the Metric View first.
3. Use `MEASURE()` for measures and explicit dimensions. Do not use `SELECT *`
   against Metric Views.
4. Use source tables only when the question requires row-level detail,
   debugging a metric definition, or validating Metric View output.
5. If the registered Metric View is missing, inaccessible, or does not cover
   the requested grain, say so and fall back visibly to the base-table path.

## Metric View Design Standard

Each Metric View candidate should define:

- source table, view, or SQL query
- business grain and supported aggregation grain
- dimensions with comments and business-friendly display names
- measures with aggregate expressions and comments
- joins for star or snowflake dimensions when needed
- global filters for stable exclusions such as invalid channels
- synonyms for user-facing business terms when runtime support is available
- format metadata for percentages, counts, currency, and dates when runtime
  support is available
- validation queries that compare Metric View results with direct SQL

Feature target:

- Metric Views are available starting with Databricks Runtime 16.4.
- YAML spec 1.1 and agent metadata require a newer runtime. The design should
  prefer YAML 1.1 metadata when available and degrade to comments-only Metric
  Views when not.

## Distribution Seed

Distribution is the first target project for v0.3.5. The release should certify
at least the first three Distribution Metric Views before v0.4 golden cases:

| Metric View | Primary purpose | v0.4 dependency |
|---|---|---|
| `m1_achievement_detail_metrics` | POC x Group x SKU x Month achievement detail | unachieved POC and team-ranking cases |
| `m1_poc_achievement_metrics` | POC x Month achievement summary | M1 summary and near-achievement cases |
| `m1_kpi725_benchmark_metrics` | KPI725 target/actual benchmark and reconciliation | KPI-vs-scan reconciliation cases |

MV4 and MV5 can remain candidate views until fraud, BEES coverage, KBD coverage,
and POC profiling cases become release candidates.

## Runtime And UI Behavior

Minimum runtime behavior:

- Render registered Metric Views above preferred tables in Project Management
  Context.
- Tell the model that Metric Views are preferred for governed metrics and that
  base tables are validation or drill-down resources.
- Preserve schema-before-query behavior for source tables and Metric Views.
- Add answer caveats when a question used a base-table fallback instead of a
  certified Metric View.

Minimum UI behavior:

- Project settings should distinguish raw input tables from Metric Views.
- Metric Views should show a validation status: candidate, validated, certified,
  stale, or missing.
- The settings surface should expose source tables, business grain, dimensions,
  measures, and validation result summary.

## Validation Plan

v0.3.5 is ready when:

- A project can register validated Metric Views in `input_metric_views`.
- The prompt clearly prefers Metric Views for metric and KPI questions.
- At least three Distribution Metric Views are documented, validated, and mapped
  to user question patterns.
- Each certified Metric View has a direct SQL validation query and tolerance.
- A sample run can answer an achievement question through a Metric View with
  numbers matching the direct SQL oracle.
- A sample fallback run explains why no Metric View path was used.
