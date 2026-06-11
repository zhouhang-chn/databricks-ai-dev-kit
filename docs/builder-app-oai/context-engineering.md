# Context Engineering - Basic Design (databricks-builder-app-oai)

Date: 2026-06-10 | Chinese version: [`context-engineering-zh.md`](./context-engineering-zh.md)

This document defines the basic Context Engineering (CE) design for
`databricks-builder-app-oai`: how the product decides what context exists, how
it enters the model, how it is checked, and how it improves over time.

Scope note: this document applies to the `databricks-builder-app-oai` design
track under `docs/builder-app-oai/`. It is not a status claim about the legacy
`databricks-builder-app/` package unless an implementation plan explicitly says
so.

Non-goals for this basic design:

- detailed context versioning;
- release-pinned reads or frozen release snapshots;
- production role/scope enforcement;
- deterministic golden-case execution paths.

Those are future-version topics. This document keeps only the basic CE concepts
needed to build and evaluate a reliable self-service analytics agent.

## 0. Document Map

| Document | Role |
|---|---|
| This document | Basic product and architecture decision record for Context Engineering |
| [`v0.3.6/gap-analysis.md`](./v0.3.6/gap-analysis.md) | Routing-first as-is baseline: route assets, source selection, file pointers |
| [`v0.3.6/design.md`](./v0.3.6/design.md) | Routing Context Asset Pack, Knowledge Router contract, route handoff |
| [`v0.3.6/action-plan.md`](./v0.3.6/action-plan.md) | Routing implementation tasks and acceptance gates |
| [`v0.3.7/gap-analysis.md`](./v0.3.7/gap-analysis.md) | Execution-first as-is baseline: SOP, query execution, evidence, validation |
| [`v0.3.7/design.md`](./v0.3.7/design.md) | Execution Context Assets, runtime evidence, provenance, execution evals |
| [`v0.3.7/action-plan.md`](./v0.3.7/action-plan.md) | Execution implementation tasks and acceptance gates |
| [`v0.4-golden-analysis-cases/gap-analysis.md`](./v0.4-golden-analysis-cases/gap-analysis.md) | Eval-first baseline for golden-case Context Assets |
| [`v0.4-golden-analysis-cases/design.md`](./v0.4-golden-analysis-cases/design.md) | Golden cases as `control_plane` assets for route/execution/data/disclosure evals |
| [`v0.4-golden-analysis-cases/action-plan.md`](./v0.4-golden-analysis-cases/action-plan.md) | Golden-case eval implementation tasks and launch gates |
| [`v0.4.1/gap-analysis.md`](./v0.4.1/gap-analysis.md) | Gap analysis for using golden cases to assist routing and execution |
| [`v0.4.1/design.md`](./v0.4.1/design.md) | Runtime-safe golden-case assistance and paired eval variants |
| [`v0.4.1/action-plan.md`](./v0.4.1/action-plan.md) | Assisted-routing/execution implementation tasks and gates |
| [`../refer/`](../refer/) | External practice references: nao, dash, anthropic, openai |

## 1. Problem Definition

Analytics correctness is a context + verification problem. Unlike coding agents,
a data-analysis question usually has one correct answer from one correct source.
There are few natural tests at runtime, and users often cannot verify the answer
from first principles.

Entity resolution is usually the dominant failure point: once the user's question
is mapped to the correct table, metric, grain, and business definition, SQL
generation is less often the bottleneck. But execution errors still matter,
especially date windows, filters, denominators, and joins.

This design focuses on four primary failure modes:

1. **Concept/entity ambiguity**: one business term maps to several plausible
   tables, columns, metrics, or definitions.
2. **Data staleness**: schemas, definitions, and docs drift as the business
   changes.
3. **Retrieval failure**: the correct information exists but the agent does not
   find or use it.
4. **Execution errors on the right entities**: the selected table or metric is
   right, but the operation is wrong.

Every meaningful context item should have a `defense_claim`: the failure mode or
operating risk it is meant to reduce. Context that cannot state a claim is, by
default, wasting attention and budget.

## 2. Basic Context Asset Model

Context Assets are governed information the agent relies on to route, execute,
validate, and disclose an analysis. They are not incidental prompt text. They
should have owners, source-of-truth locations, format, storage, freshness
expectations, loading behavior, and observability.

The basic design uses a **Context Asset Pack** per project. The pack contains
the minimum governed assets needed to answer the launched question families, plus
pointers to long-tail assets the agent may read on demand.

### 2.1 Target State

For any launched domain, the Context Asset Pack must answer five questions:

1. **What can the agent answer?**
   The covered P0/P1 question families and their required `semantic_truth`
   assets.
2. **Which entities are canonical?**
   The Metric Views, raw paths, measures, dimensions, grains, and owner-approved
   definitions the agent should prefer.
3. **How should the agent operate?**
   The workflow policies and conventions that prevent common analytical errors.
4. **What evidence proves readiness?**
   Eval cases, validation SQL, launch tier, pass rule, and trace requirements.
5. **What context was used for this run?**
   The project settings, project files, retrieved context, tool outputs, and
   runtime evidence loaded or observed during the run.

If a domain cannot answer these questions, it is not ready as a product surface,
even if a prompt can produce plausible answers.

### 2.2 Asset Contract

The basic asset contract is intentionally small. It should be represented by the
available carriers today: DB settings, project files, traces, and eval telemetry.
A full asset manifest can be added later.

| Field | Meaning | Basic Carrier / Status |
|---|---|---|
| `id` | Stable identifier for references and traces | Required where assets already have IDs: MV names, file paths, eval case IDs |
| `asset_type` | The job this Context Asset performs | Required as the organizing field; see Section 2.3 |
| `defense_claim` | Failure mode or operating risk this asset defends against | Required for new or changed assets where a carrier exists |
| `content` | Knowledge, evidence, rule, or control record | Required in the carrier or implied by the referenced object |
| `format` | Physical or logical representation: Metric View, Markdown, YAML/JSON, SQL, trace event, table row, etc. | Required by asset type where a carrier exists; see Section 2.3 |
| `storage` | Durable location or carrier the product reads from | Required for project-owned assets; distinct from `source_of_truth` when an asset is copied, indexed, or synchronized |
| `owner` | Person or team accountable for correctness and freshness | Required for metric definitions and launch readiness |
| `source_of_truth` | DB setting, authored file, derived file, trace, or telemetry table | Required for project-owned assets |
| `freshness_policy` | When the asset must be reviewed or regenerated | Target field; can start as notes or validation metadata |
| `validation_status` | Candidate, validated, certified, stale, missing, or not applicable | Required for `semantic_truth` assets |
| `loading_behavior` | How or when the asset enters the run | Required for context assembly and tests |
| `scope` | Platform, project, run, turn, history, or eval/control | Required for access and observability decisions |
| `observability_signal` | Trace field, file-read record, footer field, eval result, or audit warning | Required for runtime/eval assets; target for all assets |

### 2.3 Asset Types

These asset types map to the Anthropic agentic analytics stack: data
foundations reduce the candidate entity space; sources of truth turn business
terms into governed entities; skills encode the procedure for finding and using
those entities; validation assets detect drift and wrong answers.

| `asset_type` | Stack Layer | Content | Format | Storage | Loading | Readiness Rule |
|---|---|---|---|---|---|---|
| `platform_mechanism` | Product/runtime mechanism | System prompt core, tool schemas, plan state machine, read-only rules, response contract | Prompt text, tool-schema JSON, typed config, contract Markdown | Application code/config, prompt templates, tool registry, project DB settings when configurable | `resident_platform`, `tool_schema`; loaded before project assembly | Mechanism is covered by prompt/tool-shape tests |
| `data_foundation` | Data foundations | Governed source tables, transforms, tests, schema metadata, lineage, code-derived and LLM-optimized table docs | Unity Catalog objects, SQL/Python transforms, test definitions, schema/lineage metadata, generated Markdown | Databricks workspace/catalog, transform repository, project file store for generated docs | `warehouse_object` when queried, `metadata_inspection` during routing/validation, compact `compiled_summary` for launched domains | The data estate is legible enough to distinguish similar entities |
| `semantic_truth` | Sources of truth: semantic layer and approved raw paths | Metric Views, canonical measures, dimensions, grains, approved raw paths, owners, validation status, fallback policy | Metric View definition, measure/dimension manifest, YAML/JSON metadata, curated Markdown reference | Databricks Metric Views/catalog, project settings DB, governed reference files | `compiled_core` for launched metrics, `warehouse_query` for execution, `on_demand_file` for detailed references | Every launched KPI/aggregate family maps to a validated MV or approved raw path |
| `business_context` | Sources of truth: business context | Business terms, aliases, gotchas, caveats, launch/incident notes, interpretation guidance, decision context | Domain Markdown, glossary entries, indexed document snippets, decision/incident notes | Project files, curated knowledge base, retrieval index, linked planning/decision docs | `compiled_summary` for high-frequency terms, `on_demand_file` or `retrieved` when selected by the router | Ambiguous terms have one canonical interpretation or an explicit fallback policy |
| `analyst_workflow` | Skills: procedure and analysis patterns | Knowledge Router contract, senior-analyst SOP, analysis patterns, review rubric | Markdown skill/module files, workflow checklist, pattern templates, rubric config | Repository or project skill folder, app-managed project files, synchronized MCP/resource copies where supported | Core SOP as `compiled_core`; selected pattern/rubric as `on_demand_file` | Rules that affect correctness are either enforced by tool state or covered by tests |
| `turn_context_memory` | Cross-stack scoped memory | Matched project files, retrieved docs, saved corrections, project/personal memory | Retrieved snippets, file-read records, correction records, conversation summaries | App DB, retrieval index, trace history, project/user memory store | `on_demand_file`, `retrieved`, or `history_memory` only after scoping; never silently overrides canonical assets | Retrieved or remembered context is scoped, auditable, and does not silently override canonical definitions |
| `runtime_evidence` | Validation and online verification | Schema inspections, executed SQL or MV query, raw rows, result shape, validation checks, footer metadata | Tool-call result, SQL/MV spec, row set, validation event, provenance footer fields | Run trace store, telemetry table, result/artifact metadata, optional cache | `runtime_observed` during the run, `final_disclosure` in the answer, `telemetry` after the run | Runs are reproducible enough to verify source tier, validation status, and file compliance |
| `control_plane` | Validation, maintenance, and regression control | Evals, readiness gates, telemetry, regression runbooks | Eval cases, golden snapshots, scoring assertions, dashboard metrics, runbook Markdown | Repository eval files, CI results, telemetry tables, project settings, issue/PR queue | `eval_only` for scoring, `telemetry` for monitoring; not normal prompt content except summarized launch status | Readiness and regression decisions are measurable and replayable |

### 2.4 Loading Behaviors

`loading_behavior` is a closed vocabulary for assembly, traces, and budget
telemetry. New values should be deliberate because they affect comparability.

| `loading_behavior` | Meaning | Budget / Telemetry Rule |
|---|---|---|
| `resident_platform` | Platform prompt or mechanism text present before project assembly | Measure from the actual request payload; protect stable prefix |
| `tool_schema` | Tool schema serialized by the SDK | Measure schema tokens from actual model requests |
| `compiled_core` | Small, stable, universally relevant project content rendered before execution | Budget and cache-prefix test as prompt content |
| `compiled_summary` | Compact project summary rendered before execution | Budget as prompt content; track dropped fields |
| `on_demand_file` | Project file read during execution when routing requires it | Measure file-read count, tokens, latency, and pointer compliance |
| `retrieved` | Retrieval result from an index or external knowledge surface | Measure hit rate, tokens, latency, and citation quality |
| `warehouse_object` | Governed warehouse table, view, or Metric View used as source | Measure freshness/status and downstream query cost |
| `metadata_inspection` | Runtime schema, lineage, or catalog inspection | Measure tool calls, latency, and avoided wrong-source failures |
| `warehouse_query` | Analytical SQL or Metric View query execution | Measure query cost, result shape, row count, and validation outcome |
| `history_memory` | Prior-turn, project, or user memory loaded for the turn | Measure scope, freshness, token cost, and correction value |
| `runtime_observed` | Evidence produced during the run, before final response | Record for validation; not a pre-run prompt budget |
| `final_disclosure` | Evidence surfaced in the answer or footer | Measure output tokens and provenance completeness |
| `telemetry` | Append-only trace, eval, or monitoring record | Used to tune budgets; not prompt content by default |
| `eval_only` | Asset used only by offline evals or scoring | Versioned later; measured outside normal user-run prompt budget |

### 2.5 Compile Vs. On-Demand

The compiled core is the small set of `compiled_core` Context Assets that
protect the correctness happy path:

- validated MVs' `full_name`, status, grain, measures, and dimensions;
- metric-view-first policy;
- pre-rebutted reasons not to bail early to raw SQL;
- date/period conventions.

The long tail is stored behind project-file pointers:

- full business terms;
- caveats and interpretation notes;
- gotchas, renamed products, internal abbreviations, and required filters;
- sample queries;
- detailed requirements and readiness notes;
- detailed metric context.

Long-tail files should be organized as cohesive domain modules such as user
growth, monetization, activation, or support operations. The Knowledge Router
selects modules; execution reads the selected assets. A run should not load the
whole project knowledge graph because a single term is ambiguous.

### 2.6 Readiness Invariants

A Context Asset Pack is ready only when these invariants hold:

- every launched question family maps to required Context Assets;
- every metric has exactly one canonical definition and owner;
- every asset has declared `asset_type`, `format`, `storage`,
  `loading_behavior`, and `scope`;
- new or changed assets carry a `defense_claim`;
- every fallback path has an explicit disclosure policy;
- every on-demand pointer resolves or degrades in a defined way;
- LLM-optimized reference docs exist for launched domains with known gotchas and
  business terminology;
- runtime traces can show which files, schemas, and queries were used;
- eval coverage exists for the launched tier.

## 3. Workflow

The workflow is the agent's operating model for producing a correct answer. It
has four stages: route, execute, validate, disclose.

### 3.1 Routing: Find The Right Entity

Routing is the primary defense against concept/entity ambiguity. It answers:
which business concept is the user asking about, which canonical metric/entity
represents it, and which source should be used?

Routing must happen before analytical execution. The agent should not start
writing SQL while the target metric, entity, grain, or source tier is still
ambiguous.

The basic routing mechanism is the **Knowledge Router**. Its job is to narrow
the search space, not scan every schema or every project file. It maps intent to
a small set of domain assets such as business context, table index, semantic
definitions, known caveats, and reusable analysis patterns. Execution then reads
the selected assets if needed.

The routing contract has five steps:

1. **Classify the question family.**
   KPI, aggregate, ranking, trend, comparison, reconciliation, drill-down,
   validation, exploratory, or unsupported.
2. **Extract concepts and constraints.**
   Business terms, requested period, role/scope, dimensions, filters, comparison
   target, denominator, and grain.
3. **Resolve concepts to canonical entities.**
   Map business terms to governed Metric View measures/dimensions or approved
   raw paths. If several non-conflicting candidates exist, prefer the one whose
   owner-approved definition, grain, required dimensions, and validation status
   match the question.
4. **Identify required Context Assets.**
   Add required `on_demand_file`, `business_context`, `semantic_truth`, or
   `analyst_workflow` assets to the load plan.
5. **Emit a routing decision.**
   Name the selected source, metric/entity, grain, validation status, required
   assets, on-demand pointers, analysis pattern when known, and fallback reason
   if applicable.

Default source priority:

1. certified/validated Metric View that covers the question;
2. accepted candidate Metric View with fallback disclosure;
3. approved raw path for a question family not covered by Metric Views;
4. exploratory raw SQL only with explicit fallback status and reason.

Raw tables are valid for validation, row-level drill-down, and questions not
covered by Metric Views. They are not a shortcut around an available governed
Metric View.

The routing decision should be traceable. A typical decision record is:

```text
question_family: KPI | drill_down | validation | exploratory | ...
business_terms: [...]
selected_source_tier: metric_view | candidate_metric_view | approved_raw | exploratory_raw
selected_entity: <metric view / measure / dimension / raw path>
grain: <declared answer grain>
validation_status: certified | validated | candidate | stale | missing
required_assets: [...]
required_project_files: [...]
analysis_pattern: null | retention | funnel | cohort | rate_decomposition | reconciliation | ...
fallback_reason: null | <reason>
```

Basic observability requires a `routing_decision` trace record and file-read
records for required on-demand assets. Exact event schemas belong in
implementation plans, not this top-level design.

### 3.2 Execution: Follow A Senior-Analyst SOP

Execution answers: once the right entity is selected, how does the agent perform
the analysis without making avoidable mistakes?

The senior-analyst SOP is the procedural counterpart to the Knowledge Router.
The router narrows the search space; the SOP defines how to operate once the
space is narrowed. Following the Anthropic pattern, this should be represented
as `analyst_workflow` Context Assets rather than scattered prompt prose: a small
core workflow plus on-demand analysis patterns such as retention, funnel,
cohort, rate decomposition, reconciliation, and drill-down.

The SOP should guide the agent through:

1. **Start from the routing decision.**
   Use the selected source tier, metric/entity, grain, validation status,
   required files, and fallback reason as the execution contract. Do not reopen
   broad discovery unless validation later shows the routing decision was
   wrong.
2. **Check red flags and scope before querying.**
   Restricted data, PII, access-control gaps, stale dashboards, pipeline
   troubleshooting, causal/root-cause claims, or product/pricing
   recommendations may require escalation, narrower disclosure, or a refusal to
   answer beyond the data.
3. **Clarify missing constraints only when no documented default exists.**
   Required constraints include time period, segment, population, denominator,
   decision context, comparison baseline, and output grain. If a project file
   defines a default, use it and disclose it.
4. **Load only the required Context Assets.**
   Read the files selected by the router, plus the relevant analysis-pattern
   module if one was selected. Do not scan the whole project knowledge graph
   because a term is ambiguous.
5. **Use the semantic path first.**
   If a validated Metric View covers the ask, discover the measure/dimension,
   compile the MV query, and execute that path. Raw SQL is a fallback only after
   the semantic path is shown not to cover the ask or cannot compile/run.
6. **Pre-rebut common raw-SQL shortcuts.**
   Custom date filters, cohorts, joins, segments, and dimensions are not by
   themselves reasons to skip a Metric View if the semantic layer already
   supports them.
7. **Decide time, freshness, and grain before querying.**
   Resolve calendar vs trailing windows, timezone, freshness lag, max observed
   data date, population grain, and aggregation grain before generating SQL or
   a Metric View spec.
8. **Acquire source and schema evidence.**
   For MV paths, keep the compiled query/spec and relevant MV metadata. For raw
   fallback paths, inspect schema, owner, freshness, lineage when available,
   and documented joins/filters before writing SQL.
9. **Execute with analytical conventions.**
   Apply required filters, inclusions/exclusions, denominator rules, safe
   division, null handling, deduplication, and sample-bias checks explicitly.
10. **Inspect suspicious outputs before concluding.**
    Re-check 0 rows, null spikes, unexpected grain changes, duplicate-count
    risk, denominator collapse, impossible percentages, freshness gaps, or
    implausible adjacent-period jumps.
11. **Prepare the evidence package for validation and disclosure.**
    Preserve the query/spec, result shape, row count, source tier, validation
    status, freshness, owner, loaded files, applied defaults, caveats, and
    fallback reason.

Important execution conventions:

- separate observations from interpretations: "the data shows X" is different
  from "this suggests Y";
- do not invent tables, columns, joins, filters, or business definitions;
- prefer documented named segments and canonical filters over hand-written
  approximations;
- use reusable analysis patterns when the question matches one, rather than
  reconstructing the method ad hoc;
- when the answer is intended for leadership, financial, customer-impacting, or
  other high-stakes use, require a stronger review tier before finalizing.

Adversarial review should be a tiered control, not an unmeasured default. The
basic workflow should always include self-checks against the SOP and suspicious
result checks. A separate reviewer/sub-agent loop can be enabled for high-stakes
domains or question families when evals show that the correctness gain justifies
the token and latency cost. The trace should record whether review ran, which
review tier was used, and any blocking findings that changed the query or
answer.

### 3.3 Validation: Check Before Returning

Runtime validation should include:

- schema inspection evidence;
- executed SQL or Metric View query;
- row counts and result shape;
- checks for suspicious result patterns;
- validation status from settings or project metadata;
- trace metadata sufficient to reproduce the answer path.

Direct SQL oracles are eval assets, not ordinary runtime validators. A runtime
validator may check source tier, grain, row count, result shape, denominator
sanity, freshness, or limited invariants. If a validation query is the trusted
canonical calculation, it should become the answer path rather than remain a
hidden oracle.

For high-stakes paths, successful query execution is not enough. The agent must
verify that the result matches the intended grain, filters, period window, and
source tier.

### 3.4 Disclosure

Every concluding answer should separate:

- **raw data**: the actual rows, aggregates, or chart-ready result used;
- **metadata**: source tier, validation status, owner, freshness if measured,
  executed query reference, and fallback status;
- **visualization**: chart or table when it helps compare values, trends, or
  distributions;
- **interpretation**: what the result suggests, separated from what the data
  directly shows.

Every answer should include a provenance signature in the footer. It should make
the confidence tier legible: semantic layer / Metric View, approved raw path, or
exploratory raw table; validation status; freshness where known; owner; and
fallback reason.

Fallback answers must disclose status and reason before the answer. A false
footer is worse than a missing footer and should be treated as a product bug.

### 3.5 Safety Boundaries

Safety is related to correctness but not the same thing. A numerically correct
answer can still be unsafe if it overclaims authorization, hides fallback status,
leaks draft content, mutates data, or invites overtrust.

Required boundaries:

- preview/read-only runs need tool trimming and SQL allowlist guards;
- bypass attempts via comments, casing, leading whitespace, and multi-statement
  SQL need tests;
- pass-through auth prevents the agent from exceeding the user's Databricks
  permissions, but does not create product-level row-scope semantics;
- high-stakes tiers need a human sign-off path.

## 4. Evals And Measurement

Evals are the product's correctness instrument. They decide when a domain can
launch, when a tier must stay dark, and when a launched tier needs repair.

### 4.1 Data-Correctness Evals

The eval baseline must exist before any prompt-content change.

Each eval case should follow this shape:

1. natural-language user prompt, written like real chat and without table/column leakage;
2. agent answer extracted into structured data;
3. ground-truth SQL executed on a fixed eval dataset;
4. row-by-row diff with normalized ordering and numeric tolerance;
5. trace metadata: model id, tokens, latency, tool calls, file reads, and source
   tier.

The suite must include enough cases to cover P0/P1 question families and a
multi-turn slice long enough to exercise history and pointer compliance.

Offline evals should run for material prompt, Context Asset, routing, or
workflow changes. Treat the agent as a black-box model under regression test:
fixed prompts, fixed data, fixed expected outputs, and trace comparison.

### 4.2 Contract Tests

Contract tests guard the system shape:

- prompt-shape regression test;
- context rendering;
- budget and truncation records;
- schema gate;
- read-only bypass attempts;
- MECE fail/warn behavior;
- pointer compliance;
- history/compaction survival;
- footer parsing and trace comparison.

### 4.3 Golden Analysis Cases

Golden Analysis Cases are `control_plane` Context Assets for high-value,
recurring question families. They bind routing expectations, execution
expectations, oracle queries or snapshots, answer contracts, disclosure checks,
safety checks, and launch gates into one reviewed eval asset.

They are eval-first by default:

- full prompts, oracle SQL, expected rows, scoring rules, and answer contracts
  use `eval_only` loading behavior;
- normal user runs should not receive oracle SQL or expected answers in prompt
  context;
- compact launch summaries may use `compiled_summary` when the product needs to
  advertise covered question families;
- every run against a golden case should emit trace metadata that can be joined
  to eval results: case id, prompt id, route id, execution evidence id, query
  refs, model id, git SHA, context asset version, tokens, latency, tool calls,
  and file reads.

Golden cases consume earlier defense lines:

1. v0.3.6 routing evals compare actual `routing_decision` with the golden
   case's route expectation.
2. v0.3.7 execution evals compare `execution_evidence` with the golden case's
   execution expectation.
3. v0.4 data-fidelity evals compare structured outputs with reviewed oracles
   under exact or tolerant assertions.
4. Disclosure and safety evals verify provenance footer consistency, fallback
   status, required caveats, read-only behavior, and absence of security
   overclaims.

Direct SQL oracles are control-plane assets, not hidden runtime validators. If
the direct SQL path is the trusted answer path, the case should be classified as
approved raw rather than Metric View-backed. Otherwise, direct SQL remains an
eval oracle, drill-down source, or explicit fallback.

### 4.4 Golden-Case-Assisted Routing And Execution

After a golden case is active as an eval asset, a runtime-safe projection may be
used to assist routing and execution. This projection is not the full golden
case. It may include case id, launch status, selected source tier, selected
semantic source, required files, expected grain, required filters, fallback
policy, required caveats, and forbidden claims. It must not include oracle SQL,
expected answer values, hidden negative cases, or answer-revealing scoring
rules.

Assistance is explicit and measurable:

- `disabled`: ignore golden cases at runtime;
- `shadow`: match and log would-have-assisted cases without exposing hints;
- `route_only`: use case hints to shape `routing_decision` and file pointers;
- `route_and_execution`: also use query/grain/filter/fallback hints in the
  `execution_contract`.

Every assisted run should record assist metadata in `routing_decision` and
`execution_evidence`: case id, assist mode, confidence, accepted hints, ignored
hints, contradicted hints, and fallback-policy result.

Evals must support paired variants so the same suite can run against the same
agent with golden-case assistance disabled and enabled:

```yaml
eval_run:
  agent_variants:
    - id: baseline_without_golden_cases
      golden_case_assistance:
        mode: disabled
    - id: with_golden_case_route_only
      golden_case_assistance:
        mode: route_only
    - id: with_golden_case_route_and_execution
      golden_case_assistance:
        mode: route_and_execution
  paired_comparison:
    enabled: true
    baseline_variant: baseline_without_golden_cases
    compare_metrics:
      - routing_accuracy
      - data_accuracy
      - source_tier_compliance
      - required_file_recall
      - latency_ms
      - input_tokens
      - tool_call_count
      - file_read_count
```

Golden-case assistance should be promoted from `shadow` to active modes only
when paired evals show no accuracy or safety regression and an acceptable
latency/token/tool-cost tradeoff.

### 4.5 Launch Readiness

Launch gates are per domain and per stakes tier. Initial targets:

| Tier | Example Use | Initial Target |
|---|---|---|
| Headline KPI | Executive or operational KPI answers | >=98% data-correctness pass rate on a sufficiently covered eval slice |
| Exploratory / drill-down | Analysis follow-up, diagnostic exploration | >=90% data-correctness pass rate on a sufficiently covered eval slice |

Before a gate is used, the implementation plan must define the denominator,
allowed failures, required family coverage, decision window, and owner. Golden
cases provide the first concrete carrier for those launch-gate details. If
golden-case assistance is enabled, launch readiness must include paired eval
results for assisted and unassisted variants.

### 4.6 Regression And Going Dark

Go-live gates work in both directions. A sustained telemetry breach should
trigger a runbook:

1. notify the domain owner;
2. classify failures by failure mode and defense line;
3. pause risky prompt/skill changes for that domain if needed;
4. downgrade validation status in the answer footer if needed;
5. repair through the relevant Context Asset, workflow step, or assembly
   mechanism;
6. de-announce the affected tier if not repaired within the agreed window.

Detection without response is not a defense.

## 5. Context Building Mechanism

The context-building mechanism ensures the right context enters the model at the
right time, in the right form, with controlled cost and speed.

### 5.1 Explicit Context Assembler

The basic design introduces `ContextAssembler` under `server/services/context/`.

Responsibilities:

- collect pre-run Context Assets whose `loading_behavior` is
  `resident_platform`, `compiled_core`, or `compiled_summary`;
- expose pointers and records for `on_demand_file` and `retrieved` assets that
  routing or execution may load later;
- expose `runtime_observed`, `history_memory`, and `telemetry` assets without
  pretending all runtime content is pre-assembled;
- produce structured `AssembledContext`;
- record usage and dropped fields by `asset_type`, `loading_behavior`, and
  `scope`;
- keep prompt preview and runtime prompt on the same path;
- protect stable prefixes through prompt-shape regression tests.

This replaces bare string concatenation with an object that can be tested,
budgeted, and compared across runs.

### 5.2 Compile Vs. Retrieve

Prompt-content loading rule:

| Content Shape | `loading_behavior` | Reason |
|---|---|---|
| Small + stable + universally relevant | `compiled_core` or `compiled_summary` | Protects the happy path and cache prefix |
| Large + conditional + growing | `on_demand_file` | Reduces attention dilution |
| Very large or cross-domain | `retrieved` | File orchestration no longer scales |

Moving long-tail content behind `on_demand_file` pointers is justified by
correctness and attention, not by prompt size alone. Under prompt caching, stable
compiled content can be cheap after the first run. JIT reads cost extra tool
turns, full-price input tokens, latency, and history repetition.

### 5.3 Token Economics

Cost and speed are two sides of the same token-economics problem. The product
should evaluate correctness per unit of:

- input and output tokens;
- wall-clock latency;
- `tool_call_count`;
- file-read count;
- schema exploration count;
- warehouse query cost where available.

High tool-call count often means the context was insufficient. High file-read
count may mean the on-demand strategy is hurting latency or repeated billing.
These signals should be judged alongside answer correctness.

### 5.4 Tool Schema Surface

Tool schemas are `platform_mechanism` Context Assets outside assembled prompt
text. The SDK serializes every enabled tool's schema into context every turn,
even when the tool is not called.

Skill selection is therefore a CE lever:

- analysis projects should not enable heavy UC/jobs/vector-search tool surfaces
  by default;
- the target is fewer distinct tools in context, not larger multiplexed tools;
- schema footprint should be measured from the actual model request payload.

### 5.5 Budget Policies And Truncation

Every meaningful `asset_type` / `loading_behavior` combination needs an explicit
budget policy and telemetry. The initial cap is a hypothesis, not a guessed
contract. It should become a gate only after before/after evals show that it
improves correctness, latency, or cost without creating new failure modes.

Budget tuning should follow a measurement loop:

1. instrument actual tokens, tool calls, file reads, latency, and query cost;
2. establish a baseline on representative eval slices;
3. propose a cap or loading change for a specific combination;
4. rerun the fixed eval slice and inspect failure-mode changes;
5. keep the policy only when the correctness/cost/speed tradeoff is better;
6. record dropped fields in `AssembledContext.dropped` for every capped run.

Silent truncation is forbidden.

When content hits a cap, the preferred repair is:

1. reduce duplication;
2. move long-tail content behind an `on_demand_file` pointer;
3. improve retrieval/routing;
4. truncate only as a fallback, with observability.

### 5.6 Scope Graduation

Scope discipline is a correctness and economics lever:

- <=20 tables/MVs is the ideal project shape;
- <=100 is the hard cap for file orchestration;
- beyond the cap, the product should move to offline aggregation + embedding
  retrieval instead of adding more `compiled_core` or `on_demand_file` assets.

## 6. Knowledge Lifecycle

Knowledge lifecycle answers: how do we create, validate, publish, maintain, and
retire Context Assets?

### 6.1 Asset Creation

New-domain onboarding creates the initial asset set:

1. map P0/P1 question families;
2. identify candidate tables and Metric Views;
3. validate or create `semantic_truth` assets;
4. assign owners for metrics and data sources;
5. write business terms, caveats, date conventions, and fallback policy;
6. author eval cases with ground-truth SQL;
7. publish settings and on-demand reference files into the project asset pack.

Track onboarding cost:

- elapsed time from request to first launchable tier;
- human hours by role;
- number of P0/P1 question families covered;
- unresolved asset gaps;
- eval cases authored and maintained.

### 6.2 Human Ownership

Each launched domain needs named owners:

- data owner for source and freshness questions;
- metric owner for canonical definitions;
- product owner for launch tier, threshold, and user-facing availability;
- evaluation owner for ground-truth case quality and telemetry review.

Metric definitions, validation status, and go-live decisions should not be
anonymous.

### 6.3 Code-Derived Draft Docs

The primary cost-reduction lever is code-derived draft documentation. An offline
process can crawl the transform code that produces a table and draft:

- grain;
- primary keys;
- freshness;
- source objects;
- sibling tables;
- caveats;
- example filters.

Humans verify the draft. The process drafts documentation only; it does not
generate metric definitions.

### 6.4 Curated And Discovered Knowledge

Knowledge is split into two categories:

- **Curated knowledge**: human-written schemas, definitions, caveats, policies,
  and validated Context Assets.
- **Discovered knowledge**: runtime learnings such as validated queries,
  recurring pitfalls, and user corrections.

Write-backs must be distilled into structured reference fragments, not raw query
logs. Project-level canonical corrections and personal preferences must be kept
separate, and saves require explicit confirmation.

### 6.5 Maintenance Loop

Reference docs, skills, and `on_demand_file` Context Assets should be colocated
with the transform code and dbt/Spark models they describe. Prompt and skill
assets are code: they need review, tests, owners, and change history.

CI should flag any change to a reporting model, Metric View, or governed table
that does not touch the corresponding agent reference asset in the same PR. The
default action is to block the launch or require an explicit waiver from the
domain owner. This keeps agent knowledge fresh at the same point the underlying
data contract changes.

Correction harvesting should draft PRs from repeated user corrections and feed
the same cases back into evals.

Readiness rots. The telemetry curve is the evidence that a domain is still
ready.

## 7. Iteration Model

The system should evolve through measured iterations, not through accumulated
prompt complexity.

### 7.1 Measure Before Changing

Any change that affects what enters context needs a data-correctness baseline
first. Manual smoke tests are useful for debugging, but they do not replace the
baseline.

Changes that require before/after comparison:

- prompt content changes;
- new or removed `on_demand_file` assets;
- budget, truncation, or loading-policy changes;
- routing/matcher changes;
- tool-surface changes;
- new retrieval mechanism;
- adversarial-review sub-agent;
- golden-case execution changes.

### 7.2 Evidence-Gated Mechanisms

Complexity is added only after evals show the gap or benefit.

| Mechanism | Build When |
|---|---|
| Dedicated Knowledge Router matcher | Pointer non-compliance exceeds the threshold for the model-reasoning router |
| Golden-case routing assistance | Eval-first golden cases are active and shadow-mode paired evals show route/pointer benefit |
| Golden-case execution assistance | Route-only assistance is stable and paired evals show source-tier or data-accuracy benefit |
| LLM intent fallback for golden-case matching | Deterministic trigger matching misses real paraphrases of covered question families |
| Dedicated `query_metric_view` tool | Hand-written MV SQL errors are material at eval time |
| Adversarial SQL review | Reasoning/verification failures dominate a domain's misses and cost is acceptable |
| Budget cap or truncation rule | Telemetry shows a combination is expensive or attention-diluting, and ablation improves correctness/cost/speed |
| Embedding retrieval | Project scope exceeds the file-orchestration hard cap |
| Sliding-window history | Multi-turn evals show history or memory compression causes regressions |

### 7.3 Future Versions

The following topics are intentionally out of scope for the basic CE design and
belong in future versioned designs or action plans:

- full asset manifests;
- context versioning and release-pinned reads;
- frozen project file snapshots;
- deterministic golden-case execution paths;
- production role/scope enforcement;
- richer launch-gate schemas;
- dedicated Metric View query tools;
- embedding retrieval beyond the file-orchestration cap;
- sliding-window history and advanced memory compaction.

## 8. Appendix

### 8.1 Defense Lines

Correctness comes from five stacked defense lines:

| # | Defense Line | Mechanisms | Primary Target |
|---|---|---|---|
| 1 | Context Assets | Data foundations, validated Metric Views, MECE definitions, human-owned metric definitions, business context, scope discipline | Knowledge precondition for ambiguity reduction, freshness, and retrieval |
| 2 | Routing | Entity resolution, metric-view-first source selection, knowledge-router/on-demand pointers, `project_files_read` compliance | Concept/entity ambiguity and retrieval failure |
| 3 | Execution | Schema gate, date/period conventions, suspicious-result self-checks | Wrong operation on right entities |
| 4 | Disclosure | Provenance footer, fallback reason, source tier, validation status, owner | Silent failure mitigation |
| 5 | Measurement | Data-correctness evals, per-stakes launch gates, telemetry, regression runbook | Staleness and system regression |

### 8.2 Cross-Cutting Principles

1. **Every token has a purpose.** More context is not better; irrelevant context
   wastes budget and dilutes attention.
2. **Cache-friendliness first.** Stable prefix up front, volatile content late.
3. **Tool state over prompt text.** Constraints should be enforced by state,
   gates, and tools; prompt text explains them.
4. **Thin prompt is an attention strategy, not a cost strategy.** Prompt caching
   changes the economics; JIT reads can cost more over a session.
5. **Cost is three-dimensional.** Reliability, latency, and token/query cost
   must be evaluated together.
6. **MECE definitions.** One canonical definition per metric; conflicts must be
   detectable.
7. **Guardrails, not recipes.** Encode constraints and facts; avoid brittle
   step lists in prompt rendering.
8. **Evidence gating.** Add complexity only after evals quantify the gap or
   benefit.
9. **Measure before changing.** Prompt-content changes need a correctness
   baseline first.
10. **Humans own metric definitions.** LLMs may draft documentation, not metric
    truth.

### 8.3 External Reference Summary

| Source | What We Adopt |
|---|---|
| [nao](../refer/nao-context-engineering.md) | CE as measurable discipline, token/query cost, thin prompt + orchestrated reads, MECE, data-correctness evals, scope discipline |
| [dash](../refer/dash-context-engineering.md) | Compile-vs-retrieve split, curated/discovered memory, write-back loop, resource enforcement, evals as contracts |
| [anthropic](../refer/how-anthropic-enables-self-service-data-analytics-with-claude.md) | Data-foundation/source-of-truth/skill/validation stack, failure-mode taxonomy, knowledge/unbook skill pattern, maintenance loop, evals-as-telemetry, provenance footer, adversarial review cost |
| [openai](../refer/Inside%20OpenAI’s%20in-house%20data%20agent.md) | Multi-source data context, table usage, human annotations, code enrichment, institutional knowledge, memory, runtime evidence, RAG-at-scale graduation path, tool consolidation, self-correction triggers |

### 8.4 Design Provenance

The target Context Asset model combines three inputs:

- the multi-source context model from OpenAI-style data-agent design;
- the data-foundation/source-of-truth/skill discipline from Anthropic-style
  analytics deployments;
- the current builder-app-oai implementation and the v0.3.6/v0.3.7 target designs.

Current implementation note: context is still spread across system prompt,
project settings rendering, skills guidance, operating guide, runtime state, and
SDK session history. The basic CE direction is to consolidate this into a
structured Context Asset assembly path.
