# v0.2 Business Analysis Action Plan

## Purpose

This plan turns [`gap-analysis.md`](gap-analysis.md) and [`design.md`](design.md)
into an implementation sequence for reliable business-question answering in
`databricks-builder-app-oai`.

The v0.1 OpenAI Agents SDK runtime remains the baseline. v0.2 now follows a
human analysis lifecycle: business scenario, business requirement, data/context
assets, method selection, manual senior analyst execution, golden evals, and
only then agent benchmark/orchestration design.

## Execution Principles

- Keep existing API and SSE event shapes backward compatible where possible.
- Start with how the business asks questions and how human analysts solve them.
- Turn human analysis work into durable assets, context, playbooks, and evals.
- Let golden evals drive agent orchestration changes, not the other way around.
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
| Phase 2: Business Scenario and Requirement Modeling | In progress | Seed BDR scenario and first visit-coverage requirement fixture are drafted; more real questions and requirement variants are needed. |
| Phase 3: Data and Context Asset Preparation | In progress | First metric and data-asset profile fixtures are drafted; source-specific validation and owner confirmation are still needed. |
| Phase 4: Analysis Strategy and Method Selection | In progress | Diagnostic-decomposition playbook is drafted; broader method catalog still needs coverage. |
| Phase 5: Manual Senior Analyst Execution | Pending | A trace template exists, but it must be completed with a real senior analyst run. |
| Phase 6: Golden Eval Construction | In progress | First stage-level golden eval skeleton is drafted; scoring needs calibration against manual trace results. |
| Phase 7: Agent Benchmark and Orchestration Design | Pending | Run the agent against golden evals, then change prompts, tools, routing, SQL safety, visualization, and persistence contracts. |

## v0.2 Build Order

v0.2 should build the business-analysis operating system before optimizing the
agent:

1. Pick three high-value recurring business scenarios.
2. Collect about twenty real business questions from decision owners.
3. Classify each question by requirement type.
4. Manually solve five representative cases with senior analysts.
5. Extract metric definitions, joins, pitfalls, validation checks, and SQL
   patterns from the manual work.
6. Create golden evals from the manual traces.
7. Benchmark the current agent against those evals.
8. Improve context assets, tools, prompts, and orchestration based on measured
   failure modes.
9. Expand scenario coverage.

The flywheel is:

```text
real business question
-> manual senior analyst solution
-> context asset
-> golden eval
-> agent test
-> failure analysis
-> better context / tools / orchestration
```

## Requirement Type Coverage

Use this taxonomy to classify questions before selecting assets or writing SQL:

| Requirement type | Example | Early priority |
|---|---|---|
| Metric lookup | "What was sales last month?" | Low |
| Monitoring / variance | "Did coverage drop versus last month?" | High |
| Diagnostic decomposition | "Why did coverage drop?" | High |
| Segment discovery | "Where did it drop most?" | High |
| Driver analysis | "Was it fewer reps, fewer working days, productivity, or mix?" | High |
| Causal / experiment analysis | "Did the routing plan improve visit efficiency?" | Medium |
| Forecasting | "What will happen next month?" | Medium |
| Recommendation / optimization | "How should we reassign territories?" | Medium |

For a senior data agent, the first pass should emphasize metric explanation,
variance diagnosis, root-cause decomposition, segment comparison, experiment /
impact evaluation, and operational recommendation.

## Scenario-to-Eval Matrix

The first matrix should cover domains and analysis types before expanding
within any single domain.

| Scenario | Requirement type | Eval priority |
|---|---|---|
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

- Pick representative business scenarios with owners, decisions, audiences, and
  operating cadence.
- Use `BDR visit efficiency diagnosis` as the first seed scenario.
- Capture canonical questions and realistic variants users would ask.
- Classify requirements using the taxonomy in this plan.
- Define metrics, dimensions, filters, grain, time windows, ambiguity rules, and
  required caveats for each requirement.
- Separate exploratory discovery questions from decision-support questions.
- Store scenarios and requirements as source-controlled fixtures first.

Acceptance gates:

- Each selected scenario has a written decision owner, decision context,
  business impact, actionability requirement, and success criteria.
- Each requirement has question variants and explicit semantic constraints.
- The first BDR coverage-drop requirement is linked to a metric, population,
  baseline, expected output, and ambiguity rules.
- Ambiguity and caveat rules are written before any agent benchmark is run.

## Phase 3: Data and Context Asset Preparation

Goal: turn requirements into reusable data and context assets the agent can
retrieve instead of rediscovering everything.

Tasks:

- Identify governed tables, metric views, joins, sample queries, and ownership.
- Capture glossary terms, business definitions, caveats, freshness
  expectations, and access constraints.
- Mark preferred, deprecated, blocked, and fallback assets.
- Build a minimum context library:
  - business glossary
  - metric catalog
  - entity model
  - join map
  - scenario playbooks
  - known pitfalls
  - canonical SQL examples
  - validation checklist
  - answer templates
  - golden eval cases
- Define a first `AnalysisAssetPack` fixture shape.
- Add a lightweight schema/profile cache shape only after the asset pack fields
  are clear.

Acceptance gates:

- Each requirement has an asset pack or an explicit "asset discovery needed"
  status.
- Asset packs explain why each source is relevant.
- Deprecated/blocked assets are visible to humans and future agent prompts.
- The first BDR asset pack includes `visit_coverage_rate`, visit fact profile,
  stable keys, required filters, known pitfalls, and validation queries.

## Phase 4: Analysis Strategy and Method Selection

Goal: define how a senior analyst would choose the method before writing SQL.

Tasks:

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
- Identify which playbook steps should become agent tools, prompt rules, or UI
  evidence requirements later.

Acceptance gates:

- Every requirement has an initial method selection.
- Playbooks say what evidence is sufficient and what caveats block a confident
  answer.
- Visualization needs are method-driven, not decorative.
- The BDR visit coverage requirement uses diagnostic decomposition with
  numerator/denominator, region/rep/tier, operational-driver, and data-quality
  checks.

## Phase 5: Manual Senior Analyst Execution

Goal: create the ground truth by having a human analyst solve representative
cases.

Tasks:

- Execute each selected requirement manually with a senior analyst workflow.
- Record SQL, intermediate checks, failed/rejected paths, assumptions, caveats,
  evidence tables, charts, and final narrative.
- Record why each source and method was chosen.
- Identify where the analyst needed context not present in the asset pack.
- Update scenario, requirement, asset pack, and playbook fixtures based on what
  the manual run reveals.

Acceptance gates:

- Each representative case has a manual analyst trace.
- The trace records both the answer and the reasoning path.
- Missing asset/context gaps are fed back into Phase 3 assets.
- The BDR trace records at least monthly coverage, regional contribution,
  numerator/denominator movement, BDR productivity, and data-quality validation.

## Phase 6: Golden Eval Construction

Goal: convert manual analyst traces into stable tests.

Tasks:

- Define `GoldenEvalCase` fixtures from the manual traces.
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
- Evals are traceable back to a scenario, requirement, asset pack, playbook, and
  manual analyst trace.
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
  - asset-pack retriever
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
2. Build scenarios and requirements before adding more agent behavior.
3. Build asset packs and playbooks before benchmarking the agent.
4. Use manual analyst traces to construct golden evals.
5. Let eval failures decide orchestration, SQL safety, manifest, and
   visualization priorities.
6. Use live Databricks warehouse tests only behind explicit environment gates.

## Definition of Done

- Project resources and structured conclusions persist correctly.
- Representative scenarios have requirements, assets, playbooks, manual traces,
  and golden evals.
- Agent orchestration changes are benchmarked against golden evals.
- Business answers include a durable evidence manifest when the lifecycle has
  defined what evidence is required.
- Read-only SQL safety is parser-based and tested.
- Active docs and validation commands match source code and repo policy.
