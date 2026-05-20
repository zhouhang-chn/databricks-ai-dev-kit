# v0.3.5 Metric View Context Engineering Action Plan

## Objective And Release Gates

Objective:

- Build and validate a Databricks Metric View semantic layer that the Analysis
  Agent can trust before v0.4 golden cases add canonical routing.

Release gates:

1. Semantic-layer gate: project settings register validated Metric Views, not
   only raw tables.
2. Context-engineering gate: Metric View candidates are derived from user input,
   code, metadata, and data profiling rather than hand-written names only.
3. Validation gate: Metric View outputs reconcile with direct SQL or documented
   tolerances.
4. Runtime gate: aggregate and KPI questions prefer Metric Views and disclose
   visible fallback when using base tables.
5. Handoff gate: v0.4 golden cases can reference certified Metric Views as
   their happy path.

## Workstreams

Workstream A: Metric Context Contract

- Define `metric_view_context` as the design contract.
- Keep `databricks_resources.input_metric_views` as the current app-compatible
  registration path.
- Define statuses: candidate, validated, certified, stale, missing.
- Define validation metadata: direct SQL reference, tolerance, checked timestamp,
  and known caveats.

Workstream B: Discovery And Candidate Generation

- Extract metrics, dimensions, grain, filters, joins, and synonyms from
  business background and analysis notes.
- Inspect workspace notebooks, SQL files, and project code for repeated
  aggregation logic.
- Inspect Unity Catalog schemas, tables, comments, existing views, and current
  Metric Views.
- Use table stats and sample rows to validate enum-like dimensions, nulls,
  date/month formats, and measure feasibility.

Workstream C: Metric View Validation

- Draft YAML definitions for reviewed candidates.
- Validate each source table and join path.
- Query Metric Views with `MEASURE()` and explicit dimensions.
- Reconcile Metric View results with direct SQL over source tables.
- Record validation results in project docs and later in app settings.

Workstream D: Runtime Preference

- Render Metric Views as the preferred semantic layer in prompt context.
- Update prompt policy so KPI and aggregate questions use Metric Views first.
- Keep base tables available for drill-down, validation, and unsupported grains.
- Add visible fallback language when the run cannot use the Metric View path.

Workstream E: Distribution Seed

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
2. Update v0.4 docs so Golden Analysis Cases depend on the metric-view layer.
3. Update Distribution docs so Metric Views are the primary semantic path.
4. Include official Databricks business semantics and Metric View references.

Acceptance:

- Roadmap shows v0.3.5 between v0.3 and v0.4.
- v0.4 no longer treats Metric Views as optional acceleration only.
- Distribution has a documented Metric View context-engineering path.

## Milestone 2: Discovery Prototype

Goal:

- Produce a candidate Metric View context pack from a project without manual
  copy-paste.

Scope:

1. Parse project settings, analysis notes, and registered resources.
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

## Milestone 3: Metric View Validation

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

## Milestone 4: Runtime Semantic Preference

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

## Milestone 5: v0.4 Handoff

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
