# Context Engineering — Top-Level Design (databricks-builder-app-oai)

Date: 2026-06-10 ｜ 中文版: [`context-engineering-zh.md`](./context-engineering-zh.md)

This is the **top-level design** for Context Engineering (CE) in builder-app-oai. It answers: how do we systematically decide what enters the model's context, in what form, at what cost, and with what quality safeguards. It is version-agnostic — the versioned as-is baseline, target design, and implementation tasks live in the documents below.

## 0. Document map

| Document | Role |
|---|---|
| This document | Top-level philosophy, architecture, and roadmap; version-agnostic |
| [`v0.3.6/gap-analysis.md`](./v0.3.6/gap-analysis.md) | As-is baseline: context sources, prompting, workflow, history |
| [`v0.3.6/design.md`](./v0.3.6/design.md) | v0.3.6 target design: six-layer model, budgets, on-demand reads, contracts and evals |
| [`v0.3.6/action-plan.md`](./v0.3.6/action-plan.md) | P1–P4 implementation tasks and acceptance gates |
| [`v0.4-golden-analysis-cases/`](./v0.4-golden-analysis-cases/) | Canonical paths / answer contracts for high-frequency question families (next version) |
| [`../refer/`](../refer/) | External practice references: nao, dash, anthropic, openai (see §10 quick table) |

## 1. Problem definition: analytics accuracy is a context + verification problem

Unlike coding agents, a data-analysis question usually has **exactly one correct answer from exactly one correct source**, with no "tests as natural guardrails". Anthropic's conclusion matches our experience: **accuracy is not a SQL-generation problem — once the user's question is mapped to the correct entities, execution and SQL are trivial**. Nearly all errors fall into three failure modes, and every component of the CE system must be able to answer "which one am I defending against":

1. **Concept ↔ entity ambiguity**: one business term ("achievement rate") maps to several plausible tables/columns/definitions. Defense: Metric View semantic layer + MECE single canonical definitions + business-term mapping.
2. **Data staleness**: schemas, definitions, and docs drift with the business; answers start being subtly wrong. Defense: maintenance processes (colocation, evals-as-telemetry, correction harvesting).
3. **Retrieval failure**: the correct information exists but the agent can't find it. Defense: orchestration pointers + `read_project_file` on-demand reads (small scale) → embedding retrieval (the graduation path past the threshold).

Context that cannot be attributed to any failure mode is, by default, wasting budget.

## 2. How correctness and accuracy are ensured: defense in depth

CE's ultimate deliverable is "the answer is right". No single mechanism guarantees that on its own — Anthropic's measurement: the bare model scored ~21% on their evals, while the full stacked defenses hold steady at 95%+. Correctness comes from **five stacked defense lines**, each attacking one of §1's failure modes. This section is the overview; mechanism details live in the referenced sections.

| # | Defense line | Mechanisms | Primary target | Details |
|---|---|---|---|---|
| 1 | **Assets** (before the question) | Validated Metric View semantic layer; MECE single canonical definitions; metric definitions owned by humans (never LLM-generated); scope discipline ≤20/≤100 | Entity ambiguity — collapse "dozens of plausible candidates" into one governed answer | §3/§5/§9 |
| 2 | **Routing** (finding the answer) | Metric-view-first + pre-rebutted "don't bail early" list; orchestration pointers + compliance signal (`project_files_read`, proving the model actually read the canonical source) | Retrieval failure — the answer exists but the agent didn't find or use it | §5/§6 |
| 3 | **Execution** (writing the query) | Schema gate (inspect schema before SQL); date/period conventions (week boundaries, whether the current period counts — the top error source for time questions); suspicious-result self-correction (0 rows / null spike / 10× jump between adjacent periods / 1 row after aggregation → re-check before concluding) | Wrong operations on the right entities (join/filter/date-window errors) | §6 |
| 4 | **Disclosure** (delivering the answer) | Provenance footer (source tier · validation status · owner — always derived from trace/settings, never model self-assessed); fallbacks must disclose status and reason first; separate observation ("the data shows X") from interpretation ("this suggests Y") | Consumer-side mitigation of silent failure — give consumers a basis for judgment when the answer is wrong | §6/§8 |
| 5 | **Measurement** (system level) | Data-correctness evals (row-by-row diff against ground-truth SQL, not LLM-judge scoring); per-domain go-live gate (no availability announcement below ~90%); evals-as-telemetry (time series catching drift-type regressions); passive monitoring + correction harvesting feeding back into the eval set | Staleness + overall regression — knowing how accurate you actually are right now | §8 |

Four accompanying judgments:

- **Defenses must live on the system side; never count on the user.** Self-service users don't understand the underlying data and cannot verify answers for you — this is the essential difference from building tools for data scientists, and the reason defense line 4 exists.
- **Accuracy is the product of the stack, not of any single layer.** Line 1 collapses the entity space first; only then do the later lines matter. Skipping asset building and piling on prompt tricks or evals locks in a low accuracy ceiling (the flip side of "once entities are pinned, execution and SQL are trivial").
- **Accuracy has an explicit budget knob.** High-cost measures like the adversarial-review sub-agent (+6% accuracy / +32% tokens / +72% latency) are evidence-gated and enabled per domain — "how much are you willing to pay for accuracy" is a question that must be answered explicitly, not defaulted to all-on.
- **Be honest about the residual risk: silent failure** (an answer that is wrong but looks plausible and gets adopted without objection) has no perfect fix. Mitigations are defense line 4 + human sign-off for high-stakes outputs + standing evals for headline KPIs checked against blessed dashboards. Even ~100% offline-eval pass only proves "no obvious gaps", never that the system can't be wrong — claiming absolute accuracy is itself an error.

### 2.1 Readiness gates per defense line

"The defense exists" is not "the defense is ready". Each line has an explicit ready bar, an executable verification method, and a repair action when the bar isn't met (diagnosis and repair stay separate — the audit only diagnoses; every finding routes to a repair action):

**Line 1 — Assets**

- *Ready bar*: every target question family (requirements P0/P1) maps to required assets — a validated MV or an approved raw path, nothing dangling. MVs are verified on a validation slice (e.g., Distribution 202604); candidates/deferred have a fallback-disclosure policy. One canonical definition per metric, with an owner. Scope ≤20 tables/MVs (≤100 hard cap).
- *How to verify*: gap-analysis coverage check + readiness docs; the MECE two-level contract test (fail/warn); the context-audit rubric's scope and per-MV coverage items.
- *When not ready*: gaps go through onboarding to build assets (create/validate MVs, write definitions); oversized scope converges to the gold layer first — don't add more context.

**Line 2 — Routing**

- *Ready bar*: the compiled core is actually in L1 (validated MVs' grain/measures/dimensions, metric-view-first, pre-rebutted list, date conventions). All pointed-to files exist or degrade gracefully, and are covered by the release freeze. `project_files_read` tracking is live and the **pointer non-compliance rate is measured and below threshold**. The skill set is converged per project type, with the tool-schema footprint within the frozen baseline.
- *How to verify*: context rendering tests (assert which sections render / don't render); the release-pinned test including the file path; the eval assertion "KPI case ⇒ trace contains the corresponding file read".
- *When not ready*: non-compliance above threshold → only then build the requirement matcher (evidence-gated); missing files → degrade to compiled rendering and backfill the files.

**Line 3 — Execution**

- *Ready bar*: plan state machine / schema gate / read-only (including bypass attempts via comments, casing, leading whitespace) contract tests are all green. Date/period conventions are rendered into L1. Self-correction triggers (0 rows / null spike / 10× / 1 row) are written into the workflow guide.
- *How to verify*: contract tests in CI; spot-check time-windowed eval cases for convention-correct windows.
- *When not ready*: gate misses → fix gate constants/regex and add cases; date-case failures → fix the conventions section before considering semantic-layer work.

**Line 4 — Disclosure**

- *Ready bar*: the footer appears on every concluding answer and is **parseable and cross-checkable against the trace** (source tier consistent with executed SQL, validation status consistent with settings). On fallback, status and reason are disclosed before the answer. A human sign-off process for high-stakes outputs is defined.
- *How to verify*: footer parsing test + trace spot-check comparison; the eval assertion that fallback cases contain disclosure language.
- *When not ready*: a false footer is treated as a bug — it is the last mitigation for silent failure, and false is worse than missing.

**Line 5 — Measurement**

- *Ready bar*: the data-correctness eval baseline exists **before any prompt-content change**. Enough cases per P0 question family (a few dozen per domain — diminishing returns beyond that), with ground truth pinned to snapshot dates so it can't drift. Results land in a telemetry table (skill version / git SHA / model id) queryable as a time series. The domain has cleared the ~90% go-live threshold.
- *How to verify*: evals runnable in CI with a historical curve; the gate is assertable.
- *When not ready*: below threshold → don't announce availability to stakeholders; classify failures (data model / dates / the test itself / metric definition) and route to defense lines 1–3 for repair.

Three usage rules:

- **Line 5 is the instrument and must be ready first.** Without the eval baseline, "ready" for lines 1–4 cannot be judged — the order is: stand up the instrument (line 5's baseline part), bring each line up to bar, then pass the go-live gate.
- **Readiness is per-domain / per-project**, not a global system switch: one project's Distribution domain passing the gate says nothing about a newly onboarded domain, which restarts from line 1's asset mapping.
- **Readiness rots.** The docs describe a data model that changes daily (accuracy drifts 95%→65%/month without maintenance), so readiness must be bound to the maintenance loop (colocation, code-review hook, correction harvesting — see §9) and continuously re-verified; the telemetry curve is the evidence of "still ready".

### 2.2 How the four taxonomies relate, and the enforcement matrix

This document carries four numbered taxonomies. They are not parallel lists but **four orthogonal axes** of one system: the five defense lines are the **goal decomposition** (where correctness comes from), the ten principles (§3) are the **decision rules** (how design trade-offs are judged), the six layers (§4) are the **runtime structure** (how context is physically assembled), and the five artifacts (§7) are **data governance** (where content authoritatively comes from and how it flows). In one sentence: **principles govern how the layers are built; the content the layers carry is governed by the artifact contract; all three stand up the defense lines; and defense line 5 (measurement) is the instrument that verifies the other three axes actually hold**. Do not attempt a 1:1 item mapping — the mapping is many-to-many by design.

Two scoping declarations to prevent misreading:

- **The defense lines decompose reliability only.** CE's goals are three-dimensional (reliability / speed / cost, principle 5); all five lines belong to reliability. Principle 2 (cache) and principle 4 (attention/cost accounting) also govern speed/cost — that they don't map fully onto the defense lines is by design, not an orphan.
- **The five artifacts govern project-side configured content only** (i.e., the sources of L1/L3). L0's source of truth is code, L2 is request-scoped parameters, and L4/L5's authoritative stores are runtime products (execution events / SDK session) — none are among the five artifacts (scoping details in §7).

| Defense line | Main principles | Layers involved | Artifacts involved | Enforcement of the links |
|---|---|---|---|---|
| 1 Assets | P6 MECE, P10 human-owned definitions | Outside the layers (warehouse assets), entering via the L1 compiled core | DB settings, downsunk files (the two must not fork) | ✅ MECE two-level test; ⚠️ scope discipline ≤20/≤100 is an audit warning |
| 2 Routing | P4 attention, P3 verifiable signals, P7 guardrails, P2 cache | L1 pointers + L3 on-demand reads + the tool-schema surface | Downsunk files + release freeze | ✅ `project_files_read` compliance assertion, release-pinned file-path test, prompt shape snapshot; ⚠️ P7 "guardrails not recipes" relies on review discipline |
| 3 Execution | P3 tool state > prompt text | Not in the content layers — carried by run_state tool state; L4 feeds the schema gate | — (behavioral contract, not configured content) | ✅ plan / schema gate / read-only (incl. bypass attempts) contract tests |
| 4 Disclosure | P3 applied on the output side (trust derived state, not the model's self-report) | Output side, bypassing the assembly layers; derived from the trace | DB settings' validation status (footer truthfulness depends on its freshness) | ✅ footer parsing + trace comparison test |
| 5 Measurement | P5 three-dimensional cost, P8 evidence gating, P9 measure first | Above the whole (consumes `AssembledContext` observability + traces) | Telemetry table (the source of truth for "accuracy state", see §7 scoping note) | ✅ eval-baseline-first (gate ordering), go-live gate, telemetry time series |

Legend: ✅ = mechanically enforced by a named test/signal; ⚠️ = held only by review discipline — "recipe-ification" cannot be judged mechanically and the scope line is advisory, so these two must be guarded by humans when reviewing prompt/skill changes and during project onboarding. Distinguishing the two classes is a matter of honesty: claiming "everything is mechanically enforced" would overstate the system's capacity for self-protection.

## 3. Design principles

1. **Every token has a purpose.** More context is not better: excess wastes budget, dilutes attention, and amplifies hallucination.
2. **Cache-friendliness first.** Stable prefix up front (L0 static instructions + tool schemas), volatile content at the end; the prefix is shared across projects, and neither layering nor downsinking may break it.
3. **Tool state over prompt text.** Workflow constraints are carried by tool state (plan state machine, schema gate, read-only trimming); the prompt only explains. Any constraint that exists only as prompt text must be paired with a verifiable signal (e.g., the pointer compliance rate). Defense line 4's rule — "footers are always derived from trace/settings, never model self-assessed" — is the same logic applied on the output side.
4. **The case for a thin prompt is attention, not money.** Under prompt caching, stable compiled content is nearly free; a JIT read costs an extra turn + full-price tokens + repeated billing as it rides in history. The criterion for downsinking is accuracy/attention benefit, **not prompt size** — the "small + stable + universally relevant" compiled core is never downsunk.
5. **Cost is three-dimensional: reliability / speed / cost (including execution cost).** Beyond tokens, exploratory schema queries caused by insufficient context (warehouse $ + latency) and JIT file reads are costs too; evals collect them together (`tool_call_count`, file-read count).
6. **MECE: exactly one canonical definition per metric.** No conflicts across MVs, across raw tables, or between settings and downsunk files; conflicts must be detectable — never let the model silently pick one of two.
7. **Guardrails, not recipes.** You may prescribe "constraints and facts" (don't skip the semantic layer; this is the canonical table; this definition has a gotcha); you may not prescribe "execution paths" (step 1 do X, step 2 do Y) — over-prescription pushes the agent down wrong paths (OpenAI's finding).
8. **Evidence gating.** Every mechanism that adds constraints or complexity (a dedicated MV tool, the requirement matcher, adversarial review, embedding retrieval) is built only after evals quantify the benefit/gap — never imposed up front.
9. **Measure before changing.** Any work that changes "what goes into the prompt" must have a data-correctness eval baseline as its control group first; a "manual smoke test" is no substitute for a baseline.
10. **Humans own metric definitions.** Use LLMs to generate documentation/descriptions (business_terms, caveats, field notes — drafts can be derived from transform code), but measure/dimension definitions are never auto-generated — LLM-bootstrapping the semantic layer was net-negative on Anthropic's evals.

## 4. Architecture: an explicit Context Engine and the six-layer model

Context assembly converges into an explicit `ContextAssembler` (`server/services/context/`), completed before the SDK execution loop, producing a structured `AssembledContext` (per-layer text + usage + the list of truncated fields) rather than bare string concatenation.

| Layer | Name | Stability | Contents |
|---|---|---|---|
| L0 | immutable | Stable across projects (cache prefix) | Role, response format, plan state machine, tool rules |
| L1 | project | Stable within a project/release | Settings, skills guidance, AGENTS.md, metric-view compiled core, date conventions |
| L2 | run | Per run | run_role, read_only, resource overrides |
| L3 | turn | Assembled per question | User message, on-demand-read/retrieved fine-grained context (golden_case slot reserved) |
| L4 | observation | Accumulates within a turn | Schema-history seed, tool results |
| L5 | history | Across turns | SDK session + compression summary (observable) |

Two structural insights:

- **Tool schemas are a resident cost surface outside the six layers.** The SDK serializes every enabled tool's schema into context every turn, proportional to the number of enabled skills; skill selection is therefore itself a CE lever (one fewer heavy-schema skill = a dozen fewer schemas + more accurate tool selection). Note the direction of the lever: "fewer distinct tools in context", not "merge into bigger multiplexed tools" — the latter is precisely the source of schema bloat.
- **Budgets are explicit and silent truncation is forbidden.** Each layer's budget is a code constant; over-budget drops must leave a record in `AssembledContext.dropped`. When a section hits its cap, the first choice is downsinking to a file + pointer; truncation is only the fallback.

## 5. Content organization: compile vs. on-demand read

The criterion: **small + stable + universally relevant → compile into the resident prompt; large + conditionally relevant + ever-growing → downsink into project files, with orchestration pointers guiding the model to `read_project_file` on demand**.

- **Compiled core (never downsunk)**: validated MVs' full_name / status / grain / measures / dimensions, the metric-view-first policy with the pre-rebutted "don't bail early to raw SQL" list, and the date/period conventions section. This is the happy path; it should not cost a read round-trip.
- **On-demand long tail (downsunk)**: full business_terms, known_caveats, sample_queries, requirements / readiness details. The resident prompt keeps only a routing section: "for this kind of question, read this file first".
- **Pointer compliance must be verifiable**: pointers are prompt text (the very shape principle 3 warns about), so `run_state` tracks `project_files_read` and evals assert "KPI-class question ⇒ trace contains the corresponding file read". The non-compliance rate is the evidence for whether to upgrade to automatic routing (requirement matcher → LLM intent classification).
- **Graduation path**: scope discipline is **≤20 tables/MVs ideal, ≤100 hard cap** (oversized scope is the #1 predictor of reliability failure). File orchestration suffices within the cap; only past it do we upgrade to offline aggregation + embedding retrieval (OpenAI's approach at 70k-dataset scale). Scope discipline thus serves double duty: a reliability lever and the trigger line for switching retrieval mechanisms.

## 6. Workflow contract

Behavioral constraints are carried by tool state and written as testable contracts:

- **Plan state machine**: `create → start → tools → finish → conclusion`; repeated operations return structured errors instead of wasting turns.
- **Schema gate**: SQL referencing configured tables is rejected until the conversation has a schema inspection, enforcing schema-first; the gate-exempt prefixes (DESCRIBE etc.) are a single testable constant.
- **Metric-view-first**: KPI/aggregate/trend/comparison questions use the configured Metric Views (`MEASURE(...)`) first; raw tables are for validation, drill-down, and questions MVs don't cover; any fallback must disclose status and reason first. The pre-rebutted list is inlined in the compiled core so it can't be talked past in one sentence.
- **Read-only**: preview runs get tool trimming + a SQL allowlist; the regex guard is the soft layer — hard isolation requires evaluating credential-level options (SELECT-only UC grants / a low-privilege service principal) and squarely facing their conflict with the per-user pass-through model — pass-through itself already guarantees the agent never exceeds the user's own permissions.
- **Suspicious-result self-check**: when triggers fire (0 rows, null spike, 10× jump between adjacent periods, 1 row after aggregation), re-check schema/filters before concluding — moving iteration from the user into the agent.

## 7. Sources of truth: the five artifacts

| Artifact | Role | Key rules |
|---|---|---|
| `project_setting.yaml` | Human-edited source | Synced to DB on save; not re-read at run time |
| DB settings | Source of truth at run time | Read by `build_project_context` every run |
| Release snapshot | Frozen source seen by previewers | **Covers both settings and project files** |
| AGENTS.md | Mechanism-guide snapshot | Mechanisms only, no project payload; re-read from disk every run |
| Downsunk context files | On-demand carrier for fine-grained L1/L3 content | Derived class: materialized from settings (sole write path, no hand edits); authored class: human-edited; release-pinned runs' `read_project_file` resolves to the frozen version |

The fifth row is the precondition for the on-demand-read architecture: once fine-grained context is downsunk into files, release pinning leaks if the release freeze doesn't cover files; and if materialization isn't the sole write path, settings and files fork into MECE conflicts.

**Scoping declaration**: the five artifacts govern **project-side configured content** (i.e., the sources of L1/L3). The other layers have their own owners — L0's source of truth is **code** (its stability guarded by the prompt shape snapshot test); L2 is request-scoped parameters; L4/L5's authoritative stores are execution events and the SDK session (runtime products, not configuration); the eval telemetry table is the source of truth for "accuracy state" (§8). They are not in this table, but "who owns it, who may write it, when is it read" must be answerable for them all the same.

## 8. Validation system

**Offline (baseline first)**:

- **Data-correctness evals** are the foundation: NL prompt → extract the agent's answer into structured data → row-by-row diff against ground-truth SQL (normalized, order-insensitive, numeric tolerance), wired into `.test/` (MLflow + GEPA). Test prompts must read like real chat (no table/column names); output column names encode units, not provenance — anti-leakage.
- **Contract tests** guard "what the context looks like": prompt shape snapshot (protecting the cache prefix), budget-truncation records, schema gate, read-only bypass attempts, release-pinned (including file paths), MECE two-level check (fail = same measure name with differing expressions; warn = glossary/file divergence), pointer compliance.
- **Evals as telemetry**: every run lands in a warehouse table (skill version / git SHA / model id / tokens / wall clock), catching slow regressions a single CI run can't see (Anthropic measured 95%→65%/month accuracy decay without maintenance). **Per-domain go-live gate**: no availability announcement to stakeholders until the domain clears the ~90% threshold.
- **Ablation discipline**: every meaningful prompt/skill change gets a before/after comparison run; keep a "what didn't work" list (negative results prevent re-running the same experiment).

**Online (adopted per traffic and evidence)**:

- **Provenance footer**: source tier · validation status · owner, all fields derived from trace/settings, model-self-reported confidence forbidden — one of the few mitigations for silent failure.
- **Passive monitoring**: share of queries resolved via the semantic layer, share of replies containing corrective phrasing — contingent on sufficient traffic; low-traffic projects rely on offline evals + the compliance signal first.
- **Adversarial-review sub-agent**: Anthropic quantified +6% accuracy / +32% tokens / +72% latency — a tunable cost knob, enabled per domain after evidence gating.

## 9. Knowledge lifecycle

- **Two-tier knowledge**: curated (human-written facts: schemas, definitions, rules) and discovered (pitfalls hit at runtime, validated queries) are stored and evolved separately.
- **Write-back loop**: validated queries / definition corrections are written back into project knowledge, with read-only + single-statement validation; **distill over raw retrieval** — dumping raw queries for the model to read directly bought <1% improvement (the bottleneck is structure, not access), so write-backs must be distilled into structured reference fragments.
- **Global/personal scoping + explicit confirmation**: project-level canonical corrections and personal preferences are kept apart; saves require user confirmation, so personal definitions never pollute the project's canonical layer.
- **Red line**: write-backs may only contain validated queries and documentation descriptions — **never new measure/dimension definitions** (principle 10).
- **Maintenance as first-class engineering**: reference docs/skills are colocated in the same repo as the transform code (the PR that changes the model is the PR that updates its docs); a code-review hook flags diffs that "changed a reporting model without touching its skill/reference file"; correction harvesting periodically scans conversation phrasing and drafts fix PRs, with the repair path deliberately kept "boring".
- **Code-derived semantics**: a table's true meaning lives in the pipeline code that produces it — an offline process can crawl transform code (SDP/DLT, dbt, notebooks) to derive **draft docs** for grain/primary keys/freshness/sibling tables, then hand them to humans for verification.
- **Restraint**: don't over-build infrastructure to compensate for today's model weaknesses — those investments become redundant as models improve. The starter recipe: a few canonical datasets + a few dozen offline evals + one thin knowledge layer.

## 10. Evolution roadmap and external references

```
v0.3.5  Distribution scenario assets (requirements / gap / readiness / MV validation)
v0.3.6  Explicit ContextAssembler + six layers + testable budgets + downsinking/pointers
        + eval baseline + contract tests
v0.4    Golden Analysis Cases (canonical path / answer contract / fast-path routing)
        + evidence-gated additions: requirement matcher, query_metric_view, LLM intent fallback
v0.4+   Graduation items: embedding retrieval (triggered past the 100-table hard cap),
        JIT tool exposure, sliding-window history
```

The v0.3.6 abstractions reserve interface shapes for v0.4 (hit-object schema, golden_case slot, eval extension fields) but contain **no golden-case-specific logic**.

External reference quick table (details in [`../refer/`](../refer/)):

| Source | What we adopt |
|---|---|
| [nao](../refer/nao-context-engineering.md) | CE as a measurable discipline (incl. query-execution cost); thin prompt + orchestrated file reads; MECE; data-correctness evals + `tool_call_count`; scope discipline ≤20/≤100; evidence-gated semantic layer |
| [dash](../refer/dash-context-engineering.md) | Compile-vs-retrieve split; curated/discovered two-tier memory + write-back loop; resource-layer enforcement over prompt text; evals as contracts |
| [anthropic](../refer/how-anthropic-enables-self-service-data-analytics-with-claude.md) | The three-failure-mode taxonomy; two negative results (LLM-generated definitions net-negative, raw retrieval <1%); skill drift + colocation/hook maintenance; evals-as-telemetry + go-live gate; provenance footer; quantified adversarial-review cost |
| [openai](../refer/Inside%20OpenAI’s%20in-house%20data%20agent.md) | Code-derived table semantics; over-prescription degrades results (guardrails not recipes); RAG-at-scale graduation path; tool consolidation; self-correction triggers; global/personal memory scoping + explicit saves |

> One-sentence summary: **turn "what enters the context" into an engineered object with budgets, layers, and tests; let the compiled core guard the accuracy happy path while the long tail is read on demand with verified compliance; evidence-gate every incremental mechanism; and fight the three failure modes with data-correctness evals and maintenance processes.**
