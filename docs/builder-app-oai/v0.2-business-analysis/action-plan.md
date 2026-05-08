# v0.2 Builder Agent Action Plan

## Purpose

This plan turns the v0.2 gap analysis and design intent into an implementation
sequence for the Builder Agent in `databricks-builder-app-oai`.

The v0.1 OpenAI Agents SDK runtime remains the baseline. v0.2 focuses on the
preparation workflow: accept minimal structured project settings, generate and
refine a scenario bundle, enrich it with business and data context, capture
manual analyst execution, construct golden evals, and only then validate a
lightweight Analysis Agent consumer.

The scenario bundle is the product of v0.2. The Analysis Agent is a consumer of
reviewed bundles and may be used as a benchmark harness, but it is not the main
build target for this phase.

## Execution Principles

- Keep existing API and SSE event shapes backward compatible where possible.
- Treat `project_setting.yaml` as the minimal structured user-authored source
  of truth.
- Generate downstream bundle artifacts from project settings, source-code
  context, Databricks metadata, and analyst review.
- Make the Builder Agent responsible for preparation and draft bundle mutation.
- Make the Analysis Agent a read-only consumer of reviewed scenario bundles.
- Use YAML for business, data, analysis, and eval contexts; keep markdown only
  for the bundle README and human-facing docs.
- Build business context inputs and data/metadata context together; both affect
  analysis correctness and efficiency.
- Preserve reviewed content unless newer project settings or analyst feedback
  invalidate it.
- Prefer governed project assets before broad workspace scans.
- Keep Databricks auth and model auth separate.
- Use `pnpm` for client commands.
- Add tests/evals for each correctness-critical behavior.

## Progress Snapshot

Last updated: 2026-05-08.

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Docs and Baseline Alignment | Complete | OAI docs root, v0.1 migration track, and v0.2 gap/design/action-plan are aligned. |
| Phase 1: Critical Persistence Fixes | Complete | Project Management resources and structured conclusion fallback persistence are implemented with focused regression tests. |
| Phase 2: Project Setting and Bundle Contract | In progress | `project_setting.yaml` has replaced free-form user input as the source of truth; bundle schemas and review metadata still need implementation validation. |
| Phase 3: Builder Agent Bundle Generator | Pending | Implement create/update generation, staged prompt strategy, completeness gate, clarification loop, idempotency, and partial regeneration. |
| Phase 4: Business, Data, and Analysis Context Enrichment | In progress | `business_context.yaml`, `data_context.yaml`, and `analysis_context.yaml` are drafted; source-code and Databricks metadata enrichment remain implementation work. |
| Phase 5: Manual Analyst Review and Execution | Pending | Human analyst execution must validate the BDR pilot bundle and feed discovered gaps back into the generated artifacts. |
| Phase 6: Golden Eval Construction | In progress | First YAML eval skeleton exists; it needs calibration from manual execution and Builder Agent generation cases. |
| Phase 7: Lightweight Analysis Consumer Validation | Pending | Retrieve reviewed bundles, run consumer smoke tests, and route missing-context feedback back to Builder Agent refinement. |

## v0.2 Build Order

Build the preparation operating system before optimizing end-user analysis:

1. Capture `project_setting.yaml` for one high-value recurring business
   scenario.
2. Define the compact scenario bundle contract:
   `project_setting.yaml`, `README.md`, `business_context.yaml`,
   `data_context.yaml`, `analysis_context.yaml`, and `evals.yaml`.
3. Implement a file-only Builder Agent generator for create/update runs.
4. Add project-setting schema validation and artifact schema validation.
5. Add a completeness gate and targeted clarification loop.
6. Add partial-regeneration rules and review-state preservation.
7. Enrich business and data context from bounded source-code and Databricks
   metadata inspection.
8. Review the generated bundle with a senior analyst.
9. Manually solve representative cases and record evidence shapes, rejected
   paths, caveats, and context gaps.
10. Regenerate affected bundle sections from analyst corrections.
11. Build golden evals from manual execution and generation behavior.
12. Run the lightweight Analysis Agent as a read-only consumer smoke test.
13. Feed consumer failures into Builder Agent refinement.
14. Expand scenario coverage after the seed bundle is generated, reviewed,
   evaluated, and consumed end to end.

The flywheel is:

```text
project_setting.yaml
-> Builder Agent bundle generation
-> scenario bundle review
-> manual senior analyst execution
-> context asset refinement
   - business context inputs
   - data / metadata context
-> golden eval
-> lightweight Analysis Agent consumer test
-> missing-context feedback
-> Builder Agent refinement
```

Context asset refinement is a first-class step. Business context inputs include
scenario facts, requirement type, metric priorities, ambiguity defaults, answer
rules, validation gates, and caveats. Data/metadata context includes metric
definitions, table and field profiles, approved joins, freshness, lineage,
known pitfalls, and canonical SQL patterns. Both must be refined from manual
analysis and eval failures to improve answer correctness and reduce unnecessary
discovery or SQL retries.

## Phase 0: Docs and Baseline Alignment

Goal: make the documentation structure and current source state clear.

Tasks:

- Add the OAI docs index.
- Keep v0.1 docs under the runtime migration track.
- Add v0.2 gap analysis, design, and action plan.
- Update active docs that still describe old static Next Moves or `npm`
  validation commands.
- Link v0.1 docs conceptually to the v0.2 business-analysis preparation track.

Acceptance gates:

- The docs root points readers to the OAI docs root.
- The v0.2 folder has gap analysis, design, and action plan.
- Active validation examples use `pnpm`.

## Phase 1: Critical Persistence Fixes

Goal: make the current UI/runtime save the answer context users see.

Tasks:

- Update Project Management save payload to include:
  - `settings.resources.default_catalog`
  - `settings.resources.default_schema`
  - `settings.resources.cluster_id`
  - `settings.resources.warehouse_id`
  - `settings.resources.workspace_folder`
  - `settings.resources.mlflow_experiment_name`
- Persist `synthesis.appended.summary` as assistant message content when the
  run produces no normal text output.
- Feed the same conclusion summary into Next Moves generation.
- Store highlights and structured next steps with execution/story metadata when
  available.
- Add tests for resource save and `submit_conclusion`-only runs.

Acceptance gates:

- Project Management resource edits survive reload and are used in later runs.
- A run that only calls `submit_conclusion` creates a useful assistant message.
- Next Moves receive the final conclusion text even when `final_text` is empty.

Suggested validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_project_config.py tests/test_openai_runtime.py tests/test_next_moves.py -q
cd client
pnpm lint
pnpm build:typecheck
```

## Phase 2: Project Setting and Bundle Contract

Goal: define the minimum user-authored project input and the generated bundle
shape.

Tasks:

- Treat `project_setting.yaml` as the only user-authored source of truth.
- Align project settings with Project Management concepts: identity,
  resources, semantics, workflows, agent policy, and seed business context.
- Keep user input minimal; generated artifacts should expand and structure the
  scenario, not ask users to author every detail manually.
- Define generated artifact responsibilities:
  - `README.md`: bundle overview, status, review notes, and blocked items.
  - `business_context.yaml`: structured business scenario, decision context,
    population, metrics, comparison design, caveats, and completeness gate.
  - `data_context.yaml`: structured data and metadata context only.
  - `analysis_context.yaml`: analysis principles, method contract, playbook,
    ambiguity policy, answer rules, validation policy, manual-trace
    requirements, and canonical golden cases.
  - `evals.yaml`: generated eval projection from `analysis_context.yaml`.
- Require metadata on generated artifacts: version, status, valid-from,
  supersedes, generated-by, last-reviewed-by, assumptions, and blocked items.
- Define review states for generated sections: draft, needs review, reviewed,
  rejected, and invalidated.
- Use the ML-based BDR routing optimization pilot as the seed scenario.

Acceptance gates:

- `project_setting.yaml` parses and contains the minimum project, settings, and
  business context fields required for generation.
- Each generated artifact has a clear role and can be understood without
  another document being loaded first.
- Scenario-specific business facts live in `business_context.yaml`.
- Data and metadata assets live in `data_context.yaml`.
- Analysis principles, policies, and golden cases live in
  `analysis_context.yaml`.
- Generated YAML files pass top-level schema checks.

## Phase 3: Builder Agent Bundle Generator

Goal: implement the Builder Agent capability that turns project settings into a
scenario bundle.

Tasks:

- Implement the bundle generator request/result contract for create and update
  runs.
- Build a staged prompt strategy:
  - project-setting validation
  - scenario fingerprinting
  - structured business context generation
  - completeness gate
  - structured analysis context generation
  - structured data context generation
  - eval projection generation
  - final consistency validation
- Add a targeted clarification loop for blocking gaps such as missing decision,
  intervention, baseline, population, time window, or success threshold.
- Add partial-regeneration rules for changed project-setting paths.
- Preserve reviewed sections unless newer settings or reviewer feedback
  invalidate them.
- Return structured status, assumptions, warnings, blocked reasons,
  clarification questions, and validation results.
- Make unchanged create/update runs idempotent.

Acceptance gates:

- A create run from `project_setting.yaml` produces the complete six-file
  bundle with non-final status when facts are missing.
- A second run with unchanged input is idempotent.
- Editing a metric, population rule, project resource, or data-source hint
  regenerates only affected sections and dependent YAML fields.
- Blocking ambiguity produces targeted clarification questions instead of
  final-looking artifacts.
- Generated artifacts preserve reviewed content unless invalidated.

## Phase 4: Business, Data, and Analysis Context Enrichment

Goal: enrich generated bundles with the business, metadata, and analysis
context needed for correct and efficient analysis.

Tasks:

- Use source-code context to discover existing app capabilities, project
  settings, runtime constraints, and workflow hints.
- Use Databricks metadata as read-only enrichment:
  - catalog, schema, table, view, and column names
  - table comments, owners, tags, and lineage when available
  - column types, nullability, and simple stats when available
  - partition/date coverage and freshness metadata
  - bounded row-count and null-rate profiling when explicitly enabled
- Capture glossary terms, metric definitions, caveats, freshness expectations,
  access constraints, and validation checks.
- Mark preferred, deprecated, blocked, and fallback assets.
- Bind `data_context.yaml` to a target environment when possible:
  - real Databricks catalog/schema, or
  - synthetic Databricks dataset that CI and contributors can run.
- Record binding status and confidence instead of inventing certified sources.

Acceptance gates:

- `data_context.yaml` explains why each source is relevant.
- The BDR pilot context includes six pilot metrics, pilot assignment, visit
  base, visit fact, travel facts, stable keys, required filters, known
  pitfalls, freshness checks, and validation queries.
- Data-bound assets include owner or unknown-owner state, freshness expectation,
  binding confidence, and safe fallback behavior.
- Databricks enrichment is read-only, bounded, and does not run broad scans by
  default.
- Missing data context is marked as blocked or asset-discovery-needed.

## Phase 5: Manual Analyst Review and Execution

Goal: create ground truth by having a senior analyst review and manually solve
representative cases.

Tasks:

- Review the generated BDR routing pilot business context, data context,
  analysis context, and eval projection.
- Execute representative cases manually with a senior analyst workflow.
- Record SQL, intermediate checks, failed/rejected paths, assumptions, caveats,
  evidence tables, charts, and final narrative.
- Record SQL step output shape: row count, columns, sample rows, query ID,
  runtime, and whether the result was used or rejected.
- Record why each source and method was chosen.
- Record unexpected findings, intermediate assertions, and context gaps
  discovered.
- Update generated bundle artifacts based on what the manual run reveals.

Acceptance gates:

- Manual execution records both the answer and the reasoning path.
- Missing business or data context gaps are fed back into Builder Agent
  refinement.
- Manual execution is detailed enough to create evals for analyst judgment,
  not just mechanical SQL correctness.
- The BDR manual execution records six-metric group-month summary, test delta,
  control delta, delta difference, BDR-level distribution, BDR-day
  productivity, BDR-POC-month adherence, segment decomposition, and
  data-quality validation.

## Phase 6: Golden Eval Construction

Goal: convert generation behavior and manual analyst traces into stable tests.

Tasks:

- Define Builder Agent generation evals:
  - project-setting schema handling
  - scenario completeness
  - ambiguity detection
  - context enrichment
  - artifact consistency
  - partial regeneration
  - review-state preservation
- Define business-analysis stage evals from manual execution results:
  - scoping
  - data/context discovery
  - planning
  - execution
  - validation
  - answer writing
- Anchor each scoring dimension with zero, partial, and full examples.
- Add adversarial, data-quality, and causal-trap cases before claiming eval
  coverage for a scenario.
- Add local non-network tests for fixture validation and SQL classification.
- Add optional live-gated evals for safe Databricks SQL warehouse smoke tests.

Acceptance gates:

- Builder Agent evals fail when generated artifacts are incomplete,
  inconsistent, overconfident, or non-idempotent.
- Business-analysis evals fail on wrong source choice, unsafe SQL, missing
  evidence, or missing required caveats.
- Every point-based rubric has scoring anchors.
- Evals are traceable to the generated scenario bundle.
- The first eval explicitly rewards avoiding premature SQL before metric,
  population, period, and ambiguity handling are scoped.

## Phase 7: Lightweight Analysis Consumer Validation

Goal: prove reviewed scenario bundles are actually consumable without turning
v0.2 into an Analysis Agent buildout.

Tasks:

- Prototype a deterministic scenario-bundle retrieval path for consumer runs.
- Run a lightweight Analysis Agent against reviewed bundles only.
- Require consumer runs to treat scenario bundles as read-only.
- Require consumer plans to use bundle method and playbook step ids.
- Require consumer runs to use `data_context.yaml` before broad discovery.
- Require consumer runs to load `analysis_context.yaml` principles and
  policies on every run.
- Return missing-context feedback to the Builder Agent refinement queue.
- Benchmark consumer behavior against golden evals after Builder Agent gates
  pass.
- Defer broader serving work such as chart evidence, durable answer manifests,
  parser-based SQL safety, and UI polish until eval failures justify it.

Acceptance gates:

- The consumer retrieves the BDR pilot bundle for realistic pilot rollout
  questions.
- The consumer returns a clear fallback for unrelated or low-confidence
  questions.
- The consumer does not mutate reviewed bundle artifacts during end-user runs.
- Missing context becomes Builder Agent feedback.
- Every later orchestration change maps to a measured eval failure.

## Rollout Plan

1. Keep Phase 1 persistence fixes complete.
2. Finalize `project_setting.yaml` and bundle artifact contracts.
3. Implement the file-only Builder Agent generator.
4. Add schema validation, completeness checks, clarification, and partial
   regeneration.
5. Add bounded source-code and Databricks metadata enrichment.
6. Review and manually execute the BDR routing pilot case.
7. Calibrate golden evals from generation behavior and manual execution.
8. Use lightweight Analysis Agent consumer tests only after bundle gates pass.
9. Feed consumer failures back into the Builder Agent workflow.
10. Expand scenario coverage after the seed bundle is end-to-end repeatable.

## Definition of Done

- Project resources and structured conclusions persist correctly.
- `project_setting.yaml` drives scenario-bundle generation.
- The BDR routing pilot bundle can be generated, validated, reviewed,
  regenerated, and consumed end to end.
- `business_context.yaml` owns structured business scenario and decision
  context.
- `data_context.yaml` owns data and metadata context.
- `analysis_context.yaml` owns analysis principles, policies, and canonical
  golden cases.
- `evals.yaml` is generated from analysis context and includes Builder Agent
  generation evals and business-analysis stage evals with scoring anchors.
- Manual analyst execution has filled in evidence expectations and context
  gaps.
- The lightweight Analysis Agent can retrieve reviewed bundles as read-only
  context and return missing-context feedback.
- Active docs and validation commands match source code and repo policy.
