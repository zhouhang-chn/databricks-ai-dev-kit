# v0.3.5 Scenario Onboarding And Metric View Context Engineering Gap Analysis

Date: 2026-05-20

## Purpose And Scope

This document evaluates the current Builder App OAI implementation and
Distribution project artifacts against the new v0.3.5 goal: onboard a scenario,
derive data-analysis requirements, compare them to existing Databricks assets,
and build a validated Metric View semantic layer before v0.4 golden analysis
cases.

Scope:

- `docs/builder-app-oai/roadmap.md`
- `docs/builder-app-oai/project-management/design.md`
- `docs/builder-app-oai/v0.4-golden-analysis-cases/design.md`
- `databricks-builder-app-oai/server/services/project_settings.py`
- `databricks-builder-app-oai/server/services/system_prompt.py`
- `databricks-builder-app-oai/projects/distribution/distribution.yaml`
- `databricks-builder-app-oai/projects/distribution/metric-view-design.md`

Out of scope:

- Live Databricks validation.
- Creating or altering production Metric Views.
- UI implementation for a full Metric View editor.
- Production row-level security.

## Executive Summary

The current app has the right foundation but does not yet have a dedicated
scenario-onboarding or Metric View context-engineering layer.

What exists:

- `project_setting.yaml` supports `databricks_resources.input_metric_views`.
- Saving project settings maps Metric Views into
  `settings.semantics.metric_views`.
- The system prompt renders Preferred Metric Views before Preferred Tables.
- Project settings can already pin source tables, schemas, workspace files, and
  analysis notes.
- Distribution has a detailed Metric View design with five candidate views.
- The skills catalog has Databricks analysis and Metric View skills, but no
  preparation skill that runs before query-focused analysis.

What is missing:

- No reusable skill tells Codex/Claude Code how to perform scenario onboarding
  before analysis.
- No requirements matrix translates `project_setting.yaml` background and
  Databricks resources into concrete analysis needs.
- No gap analysis compares requirements against existing Metric Views, tables,
  volumes, metadata, and workspace code.
- No release track treats Metric Views as the required semantic-layer step
  before golden cases.
- No app-readable contract stores Metric View grain, dimensions, measures,
  synonyms, validation queries, status, or source attribution.
- No runtime policy says KPI and aggregate questions must prefer Metric Views.
- No validation loop compares Metric View results with direct SQL.
- Distribution still registers no Metric Views in its seed YAML.

## Current Fit

Implemented app capabilities that support v0.3.5:

- Project settings can carry raw tables and Metric Views separately.
- Runtime prompt rendering gives Metric Views a separate section.
- Schema-before-SQL gates reduce hallucinated column use for configured
  resources.
- Analysis notes can already capture caveats, filters, and business rules.
- Distribution documentation already identifies candidate semantic assets.

Current limitations:

- `analysis_notes` is a catch-all list. It does not distinguish metric
  definitions, org-scope rules, validation rules, and rejected paths.
- `input_metric_views` is only a list of names. It has no status, validation
  metadata, or term mapping.
- The Analysis Agent can still choose base tables for metric questions even
  when a Metric View is registered.
- There is no dedicated `query_metric_view` tool. Metric Views must be queried
  through SQL with `MEASURE()`.
- The app does not read notebook/SQL code to extract candidate Metric View
  definitions.
- The current UI has no Metric View readiness state.

## Gap Matrix

| Gap | Current state | Impact | Priority |
|---|---|---|---|
| Scenario onboarding skill | No `databricks-scenario-onboarding` skill exists. | Codex/Claude Code may jump into SQL before project settings, requirements, and semantic gaps are clear. | P0 |
| Analysis requirements matrix | Project setting captures background/resources but not derived requirements. | Metric View completeness cannot be evaluated against business needs. | P0 |
| Asset gap analysis | No structured comparison across Metric Views, tables, volumes, metadata, and code. | Missing semantic assets are discovered late during analysis. | P0 |
| Roadmap release slot | v0.4 mentions Metric Views but treats them as optional | Semantic layer work is squeezed into golden cases | P0 |
| Metric context contract | Only `input_metric_views: string[]` exists | Cannot store grain, measures, synonyms, validation, or status | P0 |
| Runtime preference | Prompt lists Metric Views but does not require Metric View-first analysis | Agent may rederive metrics from raw tables and drift | P0 |
| Validation loop | No direct SQL reconciliation contract | Wrong metric definitions can be accepted silently | P0 |
| Distribution registration | Candidate MVs documented but not registered in `distribution.yaml` | Seed project does not push the agent toward governed metrics | P0 |
| Code/metadata ingestion | No automatic extraction from notebooks, SQL, metadata, or profiles | Metric View design remains manual | P1 |
| Dedicated MV tool | No high-level query API for measures/dimensions/filters | Queries need SQL boilerplate and are easier to write incorrectly | P1 |
| UI readiness state | Settings page has no MV status or validation summary | Users cannot tell candidate from certified semantic assets | P1 |
| Agent metadata support | No explicit handling for synonyms, display names, and formats | Natural-language metric matching is less reliable | P1 |

## Recommended Support Shape

Use a three-layer contract:

1. Scenario setting:

```yaml
business_background: >-
  Natural-language scenario and decision context.

analysis_notes:
  - Metric definitions, caveats, filters, validation rules.

databricks_resources:
  input_tables: []
  input_metric_views: []
  input_volume_paths: []
```

2. Scenario onboarding artifacts:

```yaml
analysis_requirements:
  - requirement_id: string
    grain: []
    measures: []
    dimensions: []
    filters: []
    required_assets:
      metric_views: []
      tables: []
      volumes: []
    priority: P0

semantic_gap_analysis:
  - requirement_id: string
    existing_coverage: covered | partial | missing
    gaps: []
    readiness: ready | blocked | deferred
```

3. App-compatible Metric View registration:

```yaml
databricks_resources:
  input_metric_views:
    - catalog.schema.metric_view
```

4. v0.3.5 metric context pack for discovery, review, and validation:

```yaml
metric_view_context:
  metric_views:
    - full_name: catalog.schema.metric_view
      status: validated
      source_objects: []
      grain: []
      dimensions: []
      measures: []
      business_terms: {}
      validation:
        direct_sql_ref: string
        tolerance: {}
```

The setting and Metric View registration work with the current app. The
onboarding artifacts and context pack define the target for implementation and
give v0.4 golden cases enough context to route safely.

## Distribution-Specific Gaps

Distribution is an ideal seed because the docs already describe:

- the core grain: POC x Group x Month
- stable business terms: M1, POC, Group, MHA SKU, yearmonth
- stable filters: month alignment, channel cleaning, T2WS exclusion
- five candidate Metric Views
- user personas and canonical analysis scenarios

Distribution still needs:

- a `project_setting.yaml` to requirements-matrix pass
- gap analysis across Metric Views, source tables, volumes, metadata, and
  workspace code
- MV1-MV3 validation against live Databricks tables
- direct SQL oracles for each certified Metric View
- registration of MV names in `distribution.yaml`
- Metric View context pack mapping Chinese and English user terms to measures
  and dimensions
- answer-quality cases proving the agent uses Metric Views before raw tables

## Recommended Next Steps

1. Add the `databricks-scenario-onboarding` skill and register it in the skill
   installer.
2. Update v0.3.5 release docs and roadmap to include scenario onboarding.
3. Register Distribution MV1-MV3 in `distribution.yaml` as the first semantic
   layer targets.
4. Add a Distribution-specific context-engineering note that maps business
   terms, dimensions, measures, and validations.
5. Add a Distribution requirements matrix and semantic gap analysis artifact.
6. Update v0.4 docs so golden cases consume v0.3.5-certified Metric Views.
7. Implement the Metric View validation and runtime preference after the docs
   contract is accepted.
