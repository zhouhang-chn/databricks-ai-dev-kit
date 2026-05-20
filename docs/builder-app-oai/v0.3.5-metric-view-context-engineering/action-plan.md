# v0.3.5 Scenario Onboarding And Metric View Context Engineering Action Plan

## Objective And Release Gates

Objective:

- Onboard an analysis scenario into a validated project setting, data-analysis
  requirements matrix, semantic-layer gap analysis, and Databricks Metric View
  layer that the Analysis Agent can trust before v0.4 golden cases add
  canonical routing.

Release gates:

1. Scenario contract gate: `project_setting.yaml` captures business
   background, analysis notes, Databricks resources, tables, Metric Views,
   volumes, and workspace code needed by the scenario.
2. Requirements gate: scenario input is converted into explicit analysis
   requirements with grain, measures, dimensions, filters, answer contract, and
   priority.
3. Gap-analysis gate: requirements are compared against existing tables,
   volumes, metadata, and Metric Views.
4. Semantic-layer gate: project settings register validated Metric Views, not
   only raw tables.
5. Context-engineering gate: Metric View candidates are derived from user input,
   code, metadata, and data profiling rather than hand-written names only.
6. Validation gate: Metric View outputs reconcile with direct SQL or documented
   tolerances.
7. Runtime gate: aggregate and KPI questions prefer Metric Views and disclose
   visible fallback when using base tables.
8. Handoff gate: v0.4 golden cases can reference certified Metric Views as
   their happy path.

## Workstreams

Workstream A: Scenario Onboarding Contract

- Define the scenario onboarding artifacts:
  - `project_setting.yaml`
  - analysis requirements matrix
  - asset inventory
  - semantic gap analysis
  - Metric View context
  - readiness summary
- Add a `databricks-scenario-onboarding` skill for Codex/Claude Code.
- Keep project payload in scenario artifacts, not `AGENTS.md`.

Workstream B: Metric Context Contract

- Define `metric_view_context` as the design contract.
- Keep `databricks_resources.input_metric_views` as the current app-compatible
  registration path.
- Define statuses: candidate, validated, certified, stale, missing.
- Define validation metadata: direct SQL reference, tolerance, checked timestamp,
  and known caveats.

Workstream C: Discovery And Candidate Generation

- Extract question families, metrics, dimensions, grain, filters, answer
  contracts, and priorities from business background and analysis notes.
- Extract metrics, dimensions, grain, filters, joins, and synonyms from
  the requirements matrix.
- Inspect workspace notebooks, SQL files, and project code for repeated
  aggregation logic.
- Inspect Unity Catalog schemas, tables, comments, volumes, existing views, and
  current Metric Views.
- Use table stats and sample rows to validate enum-like dimensions, nulls,
  date/month formats, and measure feasibility.
- Identify whether each requirement is covered, partially covered, missing, or
  blocked.

Workstream D: Metric View Validation

- Draft YAML definitions for reviewed candidates.
- Validate each source table and join path.
- Query Metric Views with `MEASURE()` and explicit dimensions.
- Reconcile Metric View results with direct SQL over source tables.
- Verify each Metric View against the scenario requirements it is supposed to
  satisfy.
- Record validation results in project docs and later in app settings.

Workstream E: Runtime Preference

- Render Metric Views as the preferred semantic layer in prompt context.
- Update prompt policy so KPI and aggregate questions use Metric Views first.
- Keep base tables available for drill-down, validation, and unsupported grains.
- Add visible fallback language when the run cannot use the Metric View path.

Workstream F: Distribution Seed

- Treat Distribution as a complete scenario onboarding seed, not only a Metric
  View design example.
- Promote Distribution MV1-MV3 from design to v0.3.5 certification targets.
- Register validated MV names in `distribution.yaml`.
- Map sample Distribution questions to the metric view, dimensions, measures,
  and direct SQL validation query.
- Defer MV4-MV5 certification until fraud/coverage/profile cases are stable.

## Milestone 1: Contract And Docs

Goal:

- Make v0.3.5 explicit in the roadmap and release docs.

Scope:

1. Add design, gap analysis, and action plan docs.
2. Add the reusable `databricks-scenario-onboarding` skill.
3. Update v0.4 docs so Golden Analysis Cases depend on the metric-view layer.
4. Update Distribution docs so Metric Views are the primary semantic path.
5. Include official Databricks business semantics and Metric View references.

Acceptance:

- Roadmap shows v0.3.5 between v0.3 and v0.4.
- The skill installer can install `databricks-scenario-onboarding`.
- v0.4 no longer treats Metric Views as optional acceleration only.
- Distribution has a documented Metric View context-engineering path.

## Milestone 2: Scenario Onboarding Prototype

Goal:

- Turn a project setting and unstructured scenario input into analysis
  requirements, inventory, gaps, and readiness status.

Scope:

1. Parse or draft `project_setting.yaml`.
2. Extract requirements from background, analysis notes, and sample questions.
3. Inventory configured schemas, tables, Metric Views, volumes, and workspace
   files.
4. Compare requirements to existing assets.
5. Produce readiness summary: ready, partially ready, or blocked.

Acceptance:

- Each P0 requirement has required grain, measures, dimensions, filters, and
  answer contract.
- Each P0 requirement has an asset-coverage status.
- Missing tables, volumes, metadata, or Metric Views are explicit blockers.

## Milestone 3: Discovery Prototype

Goal:

- Produce a candidate Metric View context pack from a project without manual
  copy-paste.

Scope:

1. Use scenario requirements and registered resources as inputs.
2. Extract SQL patterns from referenced workspace notebooks or files when
   accessible.
3. Call schema/stat inspection for source tables and existing Metric Views.
4. Generate a candidate list of dimensions, measures, joins, synonyms, filters,
   and caveats.
5. Store the candidate pack as a project artifact or design file.

Acceptance:

- Candidate pack explains which source produced each proposed metric or
  dimension.
- Candidate pack marks unresolved assumptions instead of silently certifying
  them.

## Milestone 4: Metric View Validation

Goal:

- Validate candidate Metric Views against Databricks data.

Scope:

1. Test source-table schema and join availability.
2. Create or update reviewed Metric Views when the user approves.
3. Query each Metric View with representative dimensions and measures.
4. Run direct SQL validation queries.
5. Record validation status and tolerance.

Acceptance:

- Each certified Metric View has:
  - source objects
  - grain
  - supported dimensions and measures
  - direct SQL validation query
  - tolerance and status
- Invalid candidates remain candidate or missing, never certified.

## Milestone 5: Runtime Semantic Preference

Goal:

- Make analysis runs use certified Metric Views before raw-table SQL.

Scope:

1. Update prompt policy for Metric View first analysis.
2. Add tests or golden traces for Metric View path selection.
3. Ensure schema-before-query gates apply to configured Metric Views.
4. Add visible fallback behavior for missing or unsupported Metric Views.

Acceptance:

- KPI-style questions select a registered Metric View when one covers the
  requested grain.
- Direct table SQL is still available for row-level drill-down and validation.
- Answers disclose fallback when Metric View use was expected but impossible.

## Milestone 6: v0.4 Handoff

Goal:

- Give Golden Analysis Cases certified semantic paths.

Scope:

1. Update golden-case schema examples to prefer `query_metric_view` or SQL over
   Metric Views.
2. Keep direct SQL as the eval oracle.
3. Map initial Distribution golden cases to MV1-MV3.
4. Define readiness failures for stale or missing Metric Views.

Acceptance:

- At least five Distribution golden-case candidates reference Metric Views for
  the happy path.
- Each case still includes a direct SQL validation path.
- v0.4 can focus on routing, canonical execution, and evals instead of
  rediscovering metric semantics.

## Validation Commands

Docs-only validation:

```bash
git diff -- docs/builder-app-oai databricks-builder-app-oai/projects/distribution
```

Runtime validation after implementation work:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_settings_yaml.py tests/test_project_config.py -q
```

Skill validation after skill changes:

```bash
python .github/scripts/validate_skills.py
```

Frontend validation only when UI changes are made:

```bash
cd databricks-builder-app-oai/client
pnpm install
pnpm lint
pnpm build:typecheck
```

Before browser tests, confirm services:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:3000
```

If testing `pnpm preview`, check `127.0.0.1:4173`.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Metric View candidates encode wrong grain | Answers become confidently wrong | Require source attribution, direct SQL validation, and analyst review before certification. |
| Runtime uses Metric Views too broadly | Detail questions lose required row-level evidence | Restrict Metric View-first policy to KPI, aggregate, ranking, and trend questions. |
| Missing Metric Views block exploratory work | Analysts cannot proceed during setup | Keep visible base-table fallback for unsupported grains and candidate-phase projects. |
| Metadata support varies by runtime | Synonyms/formats may not be available everywhere | Prefer YAML 1.1 metadata when available; degrade to comments and prompt-rendered glossary. |
| v0.4 repeats semantic work | Scope expands and golden cases drift | Make v0.3.5 certification a v0.4 dependency and keep direct SQL as eval-only fallback. |
