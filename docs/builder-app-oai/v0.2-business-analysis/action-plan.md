# v0.2 Business Analysis Action Plan

## Purpose

This plan turns the v0.2 gap analysis and design intent into an implementation
sequence for reliable business-question answering in `databricks-builder-app-oai`.

The v0.1 OpenAI Agents SDK runtime remains the baseline. v0.2 now follows a
human analysis lifecycle: business scenario, business requirement, data/context
assets, method selection, manual senior analyst execution, golden evals, and
only then agent benchmark/orchestration design.

## Execution Principles

- Keep existing API and SSE event shapes backward compatible where possible.
- Start with how the business asks questions and how human analysts solve them.
- Turn human analysis work into durable assets, context, playbooks, and evals.
- Let golden evals drive agent orchestration changes, not the other way around.
- Treat `User_Input.md` as the only human-authored seed input; generate all
  downstream markdown and YAML artifacts from it plus source code, Databricks
  metadata, and analyst review.
- Use markdown for descriptive analyst context and YAML for machine-checkable
  assets, metadata, and evals.
- Store structured evidence in addition to user-visible prose once the human
  evidence contract is known.
- Enforce SQL safety in code, not only prompts.
- Prefer governed project assets before broad workspace scans.
- Keep Databricks auth and model auth separate.
- Use `pnpm` for client commands.
- Add tests/evals for each correctness-critical behavior.

## Progress Snapshot

Last updated: 2026-05-07.

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Docs and Baseline Alignment | Complete | OAI docs root, v0.1 migration track, and v0.2 gap/design/action-plan are aligned. |
| Phase 1: Critical Persistence Fixes | Complete | Project Management resources and structured conclusion fallback persistence are implemented with focused regression tests. |
| Phase 2: Business Scenario and Requirement Modeling | In progress | Scenario-bundled markdown artifacts are drafted from `User_Input.md`; bundle generator implementation and completeness validation still need implementation. |
| Phase 3: Data and Context Asset Preparation | In progress | Consolidated `Context_Assets.yaml` is drafted; retrieval stub, source binding, and owner confirmation are still needed. |
| Phase 4: Analysis Strategy and Method Selection | In progress | Playbook step ids and answer-shaping rules are now in `Business_Scenario.md`; runtime plan-step adherence still needs implementation. |
| Phase 5: Manual Senior Analyst Execution | Pending | Manual execution contract is implicit in scenario/context/evals; it must be completed against real or synthetic data. |
| Phase 6: Golden Eval Construction | In progress | First stage-level YAML eval skeleton has anchors and adversarial seed; scoring needs calibration against manual execution results. |
| Phase 7: Agent Benchmark and Orchestration Design | Pending | Run the agent against golden evals, then change prompts, tools, routing, SQL safety, visualization, and persistence contracts. |

## v0.2 Build Order

v0.2 should build the business-analysis operating system before optimizing the
agent:

1. Capture `User_Input.md` for one high-value recurring business scenario.
2. Implement the bundle generator contract for create/update runs.
3. Generate and validate `README.md`, `Business_Scenario.md`,
   `Context_Assets.yaml`, and `evals.yaml`.
4. Run the clarification loop for blocking business-input gaps.
5. Prototype `get_scenario_context(question, project)` so the runtime can
   retrieve the artifacts.
6. Bind `Context_Assets.yaml` to real or synthetic Databricks data.
7. Manually solve the representative case with a senior analyst.
8. Extract metric definitions, joins, pitfalls, validation checks, and SQL
   patterns from the manual work.
9. Create golden evals from manual execution results.
10. Benchmark the current agent against those evals.
11. Improve context assets, tools, prompts, and orchestration based on measured
   failure modes.
12. Expand scenario coverage.

The flywheel is:

```text
real business question
-> bundle generator
-> manual senior analyst solution
-> context asset
-> golden eval
-> agent test
-> failure analysis
-> better context / tools / orchestration
```

## Bundle Generator Workstream

The bundle generator is the first implementation workstream in v0.2 because it
turns raw business input into the artifacts that retrieval, manual execution,
and eval construction depend on.

Build it in four increments:

1. File-only generator: read user input, preserve existing generated artifacts,
   emit the four generated bundle artifacts, run markdown/YAML/schema checks,
   and return structured status, assumptions, warnings, and blocked reasons.
2. Clarification loop: classify missing information as blocking or
   non-blocking, ask targeted questions for blocking gaps, and regenerate after
   the user appends answers.
3. Metadata enrichment: add read-only source-code and Databricks metadata
   enrichment for candidate tables, fields, owners, freshness, and join keys
   without running broad scans or writing Databricks objects.
4. Partial regeneration: detect changed scenario facts, preserve reviewed
   sections, invalidate only affected review state, keep stable ids, and avoid
   unchanged-file churn.

Acceptance gates:

- A create run from user input produces the complete five-file bundle with
  non-final status when facts are missing.
- A second run with unchanged input is idempotent.
- Appending a metric, population rule, or data-source hint regenerates only
  affected sections and dependent YAML fields.
- Blocking ambiguity produces targeted clarification questions instead of
  final-looking artifacts.
- Databricks enrichment is read-only, bounded, and records binding confidence
  instead of inventing certified sources.
- Generated artifacts do not require another document to be loaded in order to
  understand their own role, status, assumptions, and blocked items.

## Requirement Type Coverage

Use this taxonomy to classify questions before selecting assets or writing SQL:

| Requirement type | Example | Early priority |
|---|---|---|
| Metric lookup | "What was sales last month?" | Low |
| Monitoring / variance | "Did coverage drop versus last month?" | High |
| Diagnostic decomposition | "Why did coverage drop?" | High |
| Segment discovery | "Where did it drop most?" | High |
| Driver analysis | "Was it fewer reps, fewer working days, productivity, or mix?" | High |
| Causal / experiment analysis | "Did the routing plan improve visit efficiency?" | High |
| Forecasting | "What will happen next month?" | Medium |
| Recommendation / optimization | "How should we reassign territories?" | High |

For a senior data agent, the first pass should emphasize metric explanation,
variance diagnosis, root-cause decomposition, segment comparison, experiment /
impact evaluation, and operational recommendation.

## Scenario-to-Eval Matrix

The first matrix should cover domains and analysis types before expanding
within any single domain.

| Scenario | Requirement type | Eval priority |
|---|---|---|
| ML-based BDR routing pilot | Causal / experiment and rollout recommendation | High |
| Visit coverage drop | Diagnostic decomposition | High |
| Sales volume decline | Driver decomposition | High |
| Campaign performance | Causal / experiment | High |
| Territory overload | Optimization diagnosis | High |
| Customer churn increase | Cohort / driver analysis | Medium |
| Inventory shortage | Root cause | Medium |
| Price change impact | Causal / elasticity | Medium |
| Dashboard metric lookup | Metric retrieval | Low |

For each major scenario, create easy, medium, hard, adversarial, data-quality,
and causal-trap cases. This prevents the eval suite from overfitting to clean
questions and obvious data.

## Phase 0: Docs and Baseline Alignment

Goal: make the documentation structure and current source state clear.

Tasks:

- Add `docs/builder-app-oai/README.md` as the OAI docs index.
- Keep v0.1 docs under `v0.1-agents-sdk-integration/`.
- Add v0.2 `gap-analysis.md`, `design.md`, and `action-plan.md`.
- Update active docs that still describe old static Next Moves or `npm`
  validation commands.
- Link v0.1 docs to the v0.2 business-analysis track.

Acceptance gates:

- `docs/README.md` points to `docs/builder-app-oai/`.
- v0.2 folder has `gap-analysis.md`, `design.md`, and `action-plan.md`.
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

## Phase 2: Business Scenario and Requirement Modeling

Goal: understand how the business actually asks analytical questions before
designing more agent behavior.

Tasks:

- Treat the scenario bundle's user input file as the only human-authored seed
  input.
- Implement the bundle generator request/result contract for create and update
  runs.
- Generate `README.md`, `Business_Scenario.md`, `Context_Assets.yaml`, and
  `evals.yaml` from user input plus optional source-code context, Databricks
  metadata, and analyst review.
- Generate `Business_Scenario.md` using a locked markdown section template and
  completeness gate.
- Add staged prompt strategy for input normalization, scenario fingerprinting,
  scenario drafting, enrichment, context YAML generation, eval YAML generation,
  and validation.
- Add a clarification loop for blocking gaps such as missing decision,
  intervention, baseline, population, time window, or success threshold.
- Add partial-regeneration rules for appended or edited user input.
- Add metadata to generated descriptive artifacts: version, status, valid_from,
  supersedes, generated_by, last_reviewed_by.
- Use `ML-Based BDR Routing Optimization Pilot` as the first seed scenario.
- Capture canonical questions, realistic variants, requirement type, playbook
  steps, ambiguity policy, answer-shaping rules, and scenario defaults in
  `Business_Scenario.md`.
- Classify requirements using the taxonomy in this plan.
- Use one primary requirement type plus explicit secondary sub-questions.
- Define metrics, dimensions, filters, grain, time windows, ambiguity rules,
  default assumptions, escalation rules, and required caveats for each
  requirement.
- Separate exploratory discovery questions from decision-support questions.
- Store descriptive scenario context in markdown; store runtime context and
  evals as YAML.

Acceptance gates:

- Each selected scenario has a written decision owner, decision context,
  business impact, actionability requirement, and success criteria.
- The bundle generator emits structured status, assumptions, warnings, blocked
  reasons, validation results, and targeted clarification questions.
- Generated artifacts include metadata and review state, and preserve reviewed
  content unless newer input invalidates it.
- Each requirement has question variants and explicit semantic constraints.
- `Business_Scenario.md` passes completeness checks before `Context_Assets.yaml`
  generation.
- `Context_Assets.yaml` and `evals.yaml` parse and pass top-level schema checks
  before a bundle is marked complete.
- Re-running the generator with unchanged input is idempotent.
- The first BDR routing pilot requirement is linked to the intervention,
  test/control population, previous/pilot month windows, six metrics, expected
  output, and ambiguity rules.
- Ambiguity defaults and escalation rules are written before any agent benchmark
  is run.

## Phase 3: Data and Context Asset Preparation

Goal: turn requirements into reusable data and context assets the agent can
retrieve instead of rediscovering everything.

Tasks:

- Identify governed tables, metric views, joins, sample queries, and ownership.
- Capture glossary terms, business definitions, caveats, freshness
  expectations, and access constraints.
- Mark preferred, deprecated, blocked, and fallback assets.
- Define `Context_Assets.yaml` ownership boundaries: retrieval index, metric
  catalog, field profiles, glossary, joins, lineage, freshness expectations,
  data-binding status, and validation checks.
- Build a minimum context library:
  - business glossary
  - metric catalog
  - entity model
  - join map
  - known pitfalls
  - canonical SQL examples
  - validation checklist
- Add `get_scenario_context(question, project)` as a deterministic file-index
  stub that returns scenario bundle, `Business_Scenario.md`,
  `Context_Assets.yaml`, `evals.yaml`, confidence, missing inputs, and fallback
  policy.
- Add a lightweight schema/profile cache shape only after
  `Context_Assets.yaml` fields are clear.
- Bind `Context_Assets.yaml` to a target environment:
  - real Databricks catalog/schema when available, or
  - synthetic Databricks dataset that CI and contributors can run.

Acceptance gates:

- Each scenario has `Context_Assets.yaml` or an explicit
  "asset discovery needed" status.
- `Context_Assets.yaml` explains why each source is relevant.
- Deprecated/blocked assets are visible to humans and future agent prompts.
- `get_scenario_context` can retrieve the BDR pilot bundle for realistic pilot
  rollout questions and returns a clear fallback for unrelated questions.
- The first BDR `Context_Assets.yaml` includes the six pilot metrics, pilot
  assignment, visit base, visit fact, travel fact, stable keys, required
  filters, known pitfalls, and validation queries.
- The first `Context_Assets.yaml` declares target environment, catalog/schema
  binding status, and whether a synthetic dataset exists.

## Phase 4: Analysis Strategy and Method Selection

Goal: define how a senior analyst would choose the method before writing SQL.

Tasks:

- Keep scenario-specific playbook steps, ambiguity policy, answer templates, and
  answer-shaping rules in `Business_Scenario.md`.
- Define playbooks for common methods:
  - metric lookup
  - monitoring / variance
  - trend
  - variance
  - segmentation
  - driver analysis
  - cohort
  - funnel
  - root cause
  - causal / experiment analysis
  - forecasting
  - recommendation / optimization
  - anomaly
  - data quality
- For each playbook, define required checks, expected evidence, stop
  conditions, and visualization needs.
- Map requirements to one or more playbooks.
- Add stable `playbook_step_id` values and require runtime plans to emit them.
- Identify which playbook steps should become agent tools, prompt rules, or UI
  evidence requirements later.

Acceptance gates:

- Every requirement has an initial method selection.
- `Business_Scenario.md` says what evidence is sufficient, which answer rules
  apply, and what caveats block a confident answer.
- Required and conditional playbook steps are explicit.
- Visualization needs are method-driven, not decorative.
- Playbook adherence can be scored from `playbook_step_id`, not only by LLM
  judge interpretation.
- The BDR routing pilot requirement uses impact evaluation with test pre/post,
  test/control delta comparison, BDR/BDR-day/BDR-POC-month grains,
  segment decomposition, control comparability, and data-quality checks.

## Phase 5: Manual Senior Analyst Execution

Goal: create the ground truth by having a human analyst solve representative
cases.

Tasks:

- Execute each selected requirement manually with a senior analyst workflow.
- Record SQL, intermediate checks, failed/rejected paths, assumptions, caveats,
  evidence tables, charts, and final narrative.
- Record SQL step output shape: row count, columns, sample rows, query ID,
  runtime, and whether the result was used or rejected.
- Record why each source and method was chosen.
- Record rejected paths, unexpected findings, intermediate assertions, and
  context gaps discovered.
- Identify where the analyst needed scenario policy or data/context assets not
  present in the bundle.
- Update `Business_Scenario.md`, `Context_Assets.yaml`, and `evals.yaml` based
  on what the manual run reveals.

Acceptance gates:

- Each representative case has recorded manual execution results.
- Manual execution records both the answer and the reasoning path.
- Missing asset/context gaps are fed back into Phase 3 assets.
- Manual execution is detailed enough to create evals for analyst judgment, not
  just mechanical SQL correctness.
- The BDR manual execution records at least six-metric group-month summary,
  test delta, control delta, delta difference, BDR-level distribution, BDR-day
  productivity, BDR-POC-month adherence, segment decomposition, and
  data-quality validation.

## Phase 6: Golden Eval Construction

Goal: convert manual analyst traces into stable tests.

Tasks:

- Define `GoldenEvalCase` fixtures from manual execution results.
- Anchor each scoring dimension with zero, partial, and full examples.
- Add adversarial, data-quality, and causal-trap cases before claiming eval
  coverage for a scenario.
- Score every lifecycle stage:
  - scoping
  - data/context discovery
  - planning
  - execution
  - validation
  - analysis and answer writing
- Include scoring dimensions for:
  - source/table/metric choice
  - SQL safety and query properties
  - evidence sufficiency
  - caveat and ambiguity handling
  - method/playbook adherence
  - final answer usefulness
  - latency and tool-call budget
- Add local non-network tests for fixture validation and SQL classification.
- Add optional live-gated evals for safe Databricks SQL warehouse smoke tests.

Acceptance gates:

- Evals fail on wrong source choice, unsafe SQL, missing evidence, or missing
  required caveats.
- Each eval has a clear answer rubric and expected evidence contract.
- Every point-based rubric has scoring anchors.
- Evals are traceable back to `Business_Scenario.md` and
  `Context_Assets.yaml`.
- The first eval explicitly rewards avoiding premature SQL before metric,
  population, period, and ambiguity handling are scoped.

## Phase 7: Agent Benchmark and Orchestration Design

Goal: benchmark the agent against golden evals, then design orchestration
changes based on measured gaps.

Tasks:

- Run the current agent against golden evals.
- Classify failures by lifecycle stage:
  - scenario/requirement understanding
  - asset retrieval
  - method selection
  - SQL safety/query construction
  - evidence sufficiency
  - synthesis/caveats
  - visualization
  - efficiency
- Design orchestration changes only after failure classification:
  - scenario/requirement matcher
  - `Context_Assets.yaml` retriever
  - playbook selector
  - parser-based SQL safety gate
  - evidence manifest and replay contract
  - chart evidence generation
  - tool narrowing and durable operation state
- Re-run evals and compare benchmark reports.

Acceptance gates:

- Every orchestration change maps to a measured eval failure.
- Benchmark reports show quality and latency before/after changes.
- The agent improves on golden evals without regressing completed cases.

## Rollout Plan

1. Ship Phase 1 first because it fixes what users see versus what the product
   persists.
2. Generate scenario and requirement markdown from `User_Input.md`.
3. Prototype retrieval before building more agent behavior.
4. Build `Context_Assets.yaml` before benchmarking the agent.
5. Bind the first scenario to real or synthetic data.
6. Use manual analyst execution results to construct golden evals.
7. Let eval failures decide orchestration, SQL safety, manifest, and
   visualization priorities.
8. Use live Databricks warehouse tests only behind explicit environment gates.

## Definition of Done

- Project resources and structured conclusions persist correctly.
- Representative scenarios have `Business_Scenario.md`, `Context_Assets.yaml`,
  and `evals.yaml`.
- Scenario bundles are retrievable through `get_scenario_context`.
- Descriptive artifacts are markdown; machine-checkable assets and evals are
  YAML.
- Agent orchestration changes are benchmarked against golden evals.
- Business answers include a durable evidence manifest when the lifecycle has
  defined what evidence is required.
- Read-only SQL safety is parser-based and tested.
- Active docs and validation commands match source code and repo policy.
