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
| [`v0.3.6/gap-analysis.md`](./v0.3.6/gap-analysis.md) | As-is baseline: context sources, prompting, workflow, history |
| [`v0.3.6/design.md`](./v0.3.6/design.md) | Implementation-level target design and tasks for the next build slice |
| [`v0.3.6/action-plan.md`](./v0.3.6/action-plan.md) | P1-P4 implementation tasks and acceptance gates |
| [`v0.4-golden-analysis-cases/`](./v0.4-golden-analysis-cases/) | Future golden-case work |
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
should have owners, source-of-truth locations, freshness expectations, loading
behavior, and observability.

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
| `owner` | Person or team accountable for correctness and freshness | Required for metric definitions and launch readiness |
| `source_of_truth` | DB setting, authored file, derived file, trace, or telemetry table | Required for project-owned assets |
| `freshness_policy` | When the asset must be reviewed or regenerated | Target field; can start as notes or validation metadata |
| `validation_status` | Candidate, validated, certified, stale, missing, or not applicable | Required for `semantic_truth` assets |
| `loading_behavior` | How or when the asset enters the run | Required for context assembly and tests |
| `scope` | Platform, project, run, turn, history, or eval/control | Required for access and observability decisions |
| `observability_signal` | Trace field, file-read record, footer field, eval result, or audit warning | Required for runtime/eval assets; target for all assets |

### 2.3 Asset Types

| `asset_type` | Content | Typical `loading_behavior` | Typical `scope` | Readiness Rule |
|---|---|---|---|---|
| `platform_mechanism` | System prompt core, tool schemas, plan state machine, read-only rules, response contract | `resident_platform`, `tool_schema` | Platform | Mechanism is covered by prompt/tool-shape tests |
| `data_foundation` | Governed source tables, transforms, tests, schema metadata, lineage, code-derived and LLM-optimized table docs | `warehouse_object`, `metadata_inspection`, `compiled_summary` | Project | The data estate is legible enough to distinguish similar entities |
| `semantic_truth` | Metric Views, canonical measures, dimensions, grains, approved raw paths, owners, validation status, fallback policy | `compiled_core`, `on_demand_file`, `warehouse_query` | Project | Every launched KPI/aggregate family maps to a validated MV or approved raw path |
| `business_context` | Business terms, aliases, gotchas, caveats, launch/incident notes, interpretation guidance, decision context | `compiled_summary`, `on_demand_file`, `retrieved` | Project/turn | Ambiguous terms have one canonical interpretation or an explicit fallback policy |
| `analyst_workflow` | Knowledge Router contract, senior-analyst SOP, analysis patterns, review rubric | `compiled_core`, `on_demand_file` | Platform/project/turn | Rules that affect correctness are either enforced by tool state or covered by tests |
| `turn_context_memory` | Matched project files, retrieved docs, saved corrections, project/personal memory | `on_demand_file`, `retrieved`, `history_memory` | Turn/history | Retrieved or remembered context is scoped, auditable, and does not silently override canonical definitions |
| `runtime_evidence` | Schema inspections, executed SQL or MV query, raw rows, result shape, validation checks, footer metadata | `runtime_observed`, `final_disclosure`, `telemetry` | Run/turn | Runs are reproducible enough to verify source tier, validation status, and file compliance |
| `control_plane` | Evals, readiness gates, telemetry, regression runbooks | `eval_only`, `telemetry` | Eval/control | Readiness and regression decisions are measurable and replayable |

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
- every asset has declared `asset_type`, `loading_behavior`, and `scope`;
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

The senior-analyst SOP is a family of `analyst_workflow` Context Assets. It
should guide the agent through:

1. start from the routing decision;
2. maintain a visible plan;
3. load required Context Assets;
4. clarify missing constraints when no documented default exists;
5. acquire source and schema evidence;
6. apply analytical conventions;
7. execute the query or Metric View path;
8. inspect suspicious outputs before concluding;
9. prepare the evidence package for validation and disclosure.

Important execution conventions:

- use the semantic path when a validated Metric View covers the question;
- inspect schema before SQL fallback paths;
- apply date/period rules explicitly;
- apply denominator, safe division, filter, and grain constraints explicitly;
- re-check suspicious results such as 0 rows, null spikes, unexpected grain
  changes, or implausible adjacent-period jumps.

Adversarial SQL review is not part of the basic always-on workflow. It can be
introduced later for high-stakes domains if evals show that the correctness gain
justifies the token and latency cost.

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

### 4.3 Launch Readiness

Launch gates are per domain and per stakes tier. Initial targets:

| Tier | Example Use | Initial Target |
|---|---|---|
| Headline KPI | Executive or operational KPI answers | >=98% data-correctness pass rate on a sufficiently covered eval slice |
| Exploratory / drill-down | Analysis follow-up, diagnostic exploration | >=90% data-correctness pass rate on a sufficiently covered eval slice |

Before a gate is used, the implementation plan must define the denominator,
allowed failures, required family coverage, decision window, and owner. This
top-level document does not prescribe a full gate schema.

### 4.4 Regression And Going Dark

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
- the current builder-app-oai implementation and the v0.3.6 target design.

Current implementation note: context is still spread across system prompt,
project settings rendering, skills guidance, operating guide, runtime state, and
SDK session history. The basic CE direction is to consolidate this into a
structured Context Asset assembly path.
