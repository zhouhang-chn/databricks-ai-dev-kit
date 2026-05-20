---
name: databricks-scenario-onboarding
description: >-
  Prepare a Databricks analysis scenario before query-focused analysis. Use
  when onboarding a new business scenario, creating or refining
  project_setting.yaml, extracting data-analysis requirements from business
  background and Databricks resources, comparing requirements against existing
  tables, volumes, metadata, and Metric Views, building or proposing Metric
  Views as the semantic layer, and verifying semantic-layer completeness.
---

# Databricks Scenario Onboarding

Prepare a scenario before analysis runs. The goal is to turn unstructured
business context and Databricks resource hints into a validated project setting,
requirements matrix, semantic-layer gap analysis, and Metric View plan.

Use this before query-focused analysis. Do not answer the business question
directly until the scenario is ready enough to support reliable analysis.

## Relationship To `databricks-analysis`

This skill prepares the scenario. `databricks-analysis` executes the analysis.

- Use this skill to define the scenario contract, extract requirements,
  inventory Databricks assets, identify gaps, build/propose Metric Views, and
  verify readiness.
- When P0 readiness is reached, hand off to `databricks-analysis` for
  query-focused execution, profiling, evidence generation, and final reporting.
- If P0 readiness is blocked, do not hand off yet. Report the missing tables,
  volumes, metadata, Metric Views, permissions, or validations that block
  reliable analysis.

## Relationship To `databricks-metric-views`

This skill decides whether a scenario needs Metric Views and verifies whether
existing Metric Views cover the requirements. `databricks-metric-views` handles
Metric View implementation details.

- Use this skill to derive requirements, identify missing or incomplete Metric
  Views, define validation expectations, and decide readiness.
- Use `databricks-metric-views` when creating, altering, describing, querying,
  granting, or writing YAML definitions for Unity Catalog Metric Views.
- Return to this skill after Metric View work to verify coverage against the
  scenario requirements and update readiness.

## `project_setting.yaml` Contract

`project_setting.yaml` is the compact user-authored scenario contract. It
should describe the business problem and point to the Databricks assets the
agent may inspect. Keep it small; store large findings in separate scenario
artifacts.

Minimum shape:

```yaml
business_background: >-
  Natural-language scenario, decision context, users, goals, and expected
  analysis outcomes.

analysis_notes:
  - Metric definitions, caveats, required filters, rejected paths, validation
    rules, known data quality issues, and decision-owner expectations.

databricks_resources:
  databricks_host: string | null
  cluster_id: string | null
  warehouse_id: string | null
  workspace_folders: []
  workspace_files: []
  workflows: []
  input_schemas: []
  input_tables: []
  input_metric_views: []
  input_volume_paths: []
  output_schema: string | null
  output_volume_folders: []
```

Interpretation:

- `business_background` drives requirement extraction.
- `analysis_notes` adds metric rules, caveats, filters, and validations.
- `databricks_resources` bounds what to inspect: schemas, tables, Metric Views,
  volumes, workspace code, workflows, and output locations.

## MCP Tools

Use the smallest tool surface that can prove readiness.

| Tool | Use in onboarding | Notes |
|---|---|---|
| `get_table_stats_and_schema` | Inspect configured tables and Metric Views. | Start with `table_stat_level="NONE"`; escalate only when stats are needed. |
| `execute_sql` / `execute_sql_multi` | Query information schema, test direct SQL oracles, validate Metric View outputs. | Keep validation SQL read-oriented unless the user explicitly authorizes writes. |
| `manage_metric_views` | Describe, query, create, alter, drop, or grant Metric Views. | Write-capable. Create/alter/drop/grant only with explicit authorization. |
| `manage_volume_files` | List, inspect, upload, download, or delete volume files used by the scenario. | Write/delete operations require explicit authorization. |
| `manage_workspace_files` | Stage or update workspace files/artifacts when scenario setup requires it. | Write/delete operations require explicit authorization. |

## Workflow

### 1. Establish Project Setting

Create or refine `project_setting.yaml` using the contract above.

Capture:

- `business_background`: decision context, audience, objective, expected output
- `analysis_notes`: metric rules, caveats, filters, rejected paths, validations
- `databricks_resources`: host, warehouse/cluster, schemas, tables, Metric
  Views, volumes, workspace folders/files, output locations

Keep the setting concise. Put large investigation notes in separate project
artifacts, not in `project_setting.yaml`.

### 2. Extract Analysis Requirements

Build a requirements matrix before writing SQL:

| Field | Meaning |
|---|---|
| `requirement_id` | Stable ID for one question family or analysis need. |
| `question_examples` | User phrasings, including domain language. |
| `business_terms` | Metrics, dimensions, entities, and synonyms. |
| `grain` | Required answer grain such as customer x month or POC x group x month. |
| `measures` | Required aggregates and formulas. |
| `dimensions` | Grouping/filter fields. |
| `filters` | Scope, date windows, exclusions, permission-shaped predicates. |
| `evidence` | Tables, Metric Views, notebooks, code, metadata, or notes that support it. |
| `answer_contract` | Required fields, caveats, confidence, and visualization needs. |
| `priority` | P0 for required scenario readiness, P1/P2 for later. |

Source requirements from business background, analysis notes, sample questions,
workspace code/notebooks, existing dashboards, table comments, and prior
analyst feedback.

### 3. Inventory Existing Data And Metadata

Inspect only what is needed for the requirements matrix.

- Start with `get_table_stats_and_schema(..., table_stat_level="NONE")` for
  configured tables and Metric Views.
- Escalate to `SIMPLE` or `DETAILED` only when row counts, cardinality, ranges,
  nulls, or top values are needed for a decision.
- Use Unity Catalog metadata, table comments, information schema, and workspace
  code to understand source meaning.
- Include volumes when requirements depend on files, PDFs, images, CSVs, or
  notebook artifacts.
- Record missing metadata explicitly instead of guessing.

### 4. Compare Requirements To Assets

Produce a gap analysis table:

| Requirement | Existing coverage | Gap | Recommended asset | Status |
|---|---|---|---|---|
| KPI answer at scenario grain | Existing MV/table/volume if any | Missing measure, dimension, filter, grain, freshness, file, or metadata | Metric View, table, volume, notebook extraction, or project note | covered / partial / missing |

Decision rules:

- If a governed metric or aggregate can be expressed with reusable dimensions
  and measures, prefer a Metric View.
- If the requirement needs row-level details, keep source tables as drill-down
  assets and use Metric Views for summary measures.
- If the requirement depends on files or unstructured assets, register volumes
  and document parsing/availability gaps.
- If source tables are missing required columns or freshness, mark the scenario
  not ready instead of inventing a metric.

### 5. Build Or Propose Metric Views

When the gap calls for a Metric View, use the `databricks-metric-views` skill.

Minimum Metric View candidate:

- source table/view/query
- grain
- dimensions with business-friendly names and comments
- measures with aggregate expressions and comments
- joins for star/snowflake dimensions when needed
- global filters for stable exclusions
- synonyms/formats where supported
- validation SQL and tolerance

Do not create or alter production Metric Views silently. If write-capable tools
are available, create/update only when the user request or workflow clearly
authorizes it. Otherwise, produce reviewed YAML and a validation plan.

### 6. Verify Effectiveness And Completeness

A scenario is ready when P0 requirements are covered by validated assets.

For each P0 requirement:

1. Query the Metric View with explicit dimensions and `MEASURE()`.
2. Run direct SQL over source tables as the validation oracle.
3. Compare counts exactly unless the requirement defines tolerance.
4. Compare rates/ratios with documented tolerance.
5. Confirm caveats, filters, time windows, and grain match the requirement.
6. Record unresolved gaps and whether query-focused analysis may proceed.

### 7. Handoff For Analysis

When all P0 requirements are ready or explicitly accepted as partial:

- summarize the ready requirements, certified Metric Views, source-table
  oracles, caveats, and unsupported areas
- hand off to `databricks-analysis` for query execution and final analysis
- pass the readiness summary so the analysis agent uses certified Metric Views
  first and falls back only where the onboarding result allows it

## Deliverables

Return or write, depending on the user request:

- updated `project_setting.yaml`
- analysis requirements matrix
- asset and metadata inventory
- Metric View/table/volume gap analysis
- Metric View YAML or creation plan
- validation queries and results
- readiness summary: ready / partially ready / blocked

## Guardrails

- Keep project payload in `project_setting.yaml` and scenario artifacts, not in
  `AGENTS.md`.
- Do not treat prompt notes as proof of schema. Verify metadata before SQL.
- Do not conflate scenario-scope filters with production security.
- Prefer Metric Views for reusable governed metrics, not for one-off row-level
  debugging.
- If data or metadata is inaccessible, say what is missing and what decision it
  blocks.
