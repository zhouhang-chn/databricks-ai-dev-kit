# v0.4 Golden Analysis Cases Gap Analysis

Date: 2026-06-11

This document evaluates the gap between the current `databricks-builder-app-oai`
implementation and the v0.4 goal: **turn golden analysis cases into eval-first
Context Assets** that measure routing, execution, evidence, disclosure, and
launch readiness.

v0.3.6 defines routing assets and `routing_decision`. v0.3.7 defines execution
assets and `execution_evidence`. v0.4 uses those contracts to create replayable
golden cases: narrow, reviewed eval/control-plane assets for high-value
question families.

## 0. Current Conclusion

The repository has enough raw material for golden cases, especially in the
Distribution project, but it does not yet have a product-level golden-case eval
contract.

What exists:

- project settings can carry business background, notes, resources, input
  tables, and input Metric Views;
- v0.3.5 Distribution docs define requirements, Metric View readiness, gap
  analysis, and direct SQL validation assets;
- v0.3.6 routing docs define expected route outputs and route evals;
- v0.3.7 execution docs define expected evidence packages and data-correctness
  evals;
- current tests cover pieces of prompt rendering, project settings, runtime
  events, schema gate, read-only behavior, and skill filtering.

What is missing:

- no generic `golden_case` Context Asset schema;
- no place to declare natural-language prompts, route expectations, execution
  expectations, oracle queries, answer contracts, and launch gates together;
- no eval bundle that can be generated from project settings or project files;
- no telemetry schema for golden-case runs across model id, git SHA, case id,
  route id, query refs, tokens, latency, and pass/fail details;
- no release gate that says which question families are ready, dark, degraded,
  or stale;
- no clear ownership model for golden-case expected outputs and oracle quality.

## 1. Current Golden-Case Sources

| Source | Current Value | Gap |
|---|---|---|
| `docs/builder-app-oai/v0.3.6/` | Route decision and route eval contracts | No binding from golden case to expected route fields |
| `docs/builder-app-oai/v0.3.7/` | Execution contract and evidence eval contracts | No binding from golden case to expected execution evidence |
| `projects/distribution/requirements.md` | P0/P1 question families and answer expectations | Not app-readable as golden cases |
| `projects/distribution/readiness.md` | MV readiness and blockers | Not connected to launch gates |
| `projects/distribution/metric-views/*.sql` | Direct SQL validation queries | Not normalized as eval oracle refs |
| `distribution-gap-analysis.md` | Distribution-specific readiness/gap notes | Not a generic v0.4 control-plane contract |
| Current app tests | Unit/contract tests for runtime mechanics | No black-box golden-case eval harness |

## 2. Context Asset Gaps

| `asset_type` | Needed for v0.4 | Current gap |
|---|---|---|
| `control_plane` | Golden cases, eval cases, pass rules, launch gates, telemetry rows | No unified schema or owner fields |
| `semantic_truth` | References to validated Metric Views, required measures/dimensions, approved raw fallbacks | Existing MV context is not linked to case readiness |
| `business_context` | User-facing prompts, aliases, required defaults, caveats | Exists in docs/settings but not attached to eval cases |
| `analyst_workflow` | Expected routing and execution patterns for the case | Not represented as assertions over trace/evidence |
| `runtime_evidence` | Route id, query refs, result shape, footer fields, loaded files | v0.3.7 target, not yet consumed by golden cases |
| `platform_mechanism` | Eval runner, assertion adapters, telemetry writer | Not present as a golden-case subsystem |

## 3. Eval Coverage Gaps

v0.4 needs layered evals. Current docs mention these layers, but the product does
not yet have a case asset that binds them together.

| Eval Layer | Expected Question | Current Gap |
|---|---|---|
| Routing | Did the run select the expected case, source tier, entity, and required files? | v0.3.6 has the shape, but no golden-case fixture source |
| Execution | Did the run follow the expected source, query mode, grain, period, and fallback policy? | v0.3.7 has the shape, but no case-level assertions |
| Data fidelity | Do returned rows match an oracle within tolerance? | Direct SQL exists in Distribution but not normalized |
| Evidence | Are query refs, row counts, loaded files, validation status, and source tier preserved? | No case-level evidence diff |
| Disclosure | Is the provenance footer parseable and trace-consistent? | No golden-case footer assertion |
| Safety | Are read-only and scope claims respected? | Existing tests are generic, not per case |
| Regression | Did pass rates change by model/SHA/context asset version? | No telemetry table contract |

## 4. Golden Case Readiness Gaps

Before a question family is launchable, a golden case must answer:

1. Which user prompts are in scope?
2. Which routing decision is expected?
3. Which semantic source is canonical?
4. Which execution path is expected?
5. Which direct SQL or snapshot is the oracle?
6. Which answer fields and caveats are mandatory?
7. Which failures block launch?
8. Who owns the oracle and expected answer?
9. Which telemetry proves the case is still healthy?

Today these answers are distributed across project docs, settings, tests, and
human memory. That is the core v0.4 gap.

## 5. Distribution-Specific Gap

Distribution remains the first seed package, but v0.4 should not make its
project-specific assumptions the generic schema.

Distribution is useful because it has:

- validated/candidate Metric Views for MV1-MV3;
- P0/P1 question families;
- direct SQL validation slices;
- clear role-shaped prompts for M1/M2/M3;
- reconciliation and drill-down cases.

Distribution is not enough because:

- role/user context is demo/eval input, not production access control;
- some candidate scenarios still depend on unstable derived outputs;
- direct SQL oracles need ownership and freshness policy;
- case variants need multilingual/paraphrase coverage;
- eval data windows need explicit fixtures or stable parameter values.

The Distribution-specific details stay in
[`distribution-gap-analysis.md`](./distribution-gap-analysis.md). The generic
v0.4 docs should define the reusable eval asset model.

## 6. v0.4 Questions To Resolve

v0.4 should answer:

1. What is the `golden_case` asset contract?
2. How does a case reference v0.3.6 route expectations?
3. How does a case reference v0.3.7 execution evidence expectations?
4. Where do direct SQL oracles live, and who owns them?
5. What assertions are required before a case can launch?
6. How are eval results stored for model/SHA/context regression analysis?
7. How do launch gates degrade or go dark when telemetry regresses?
8. How do golden cases avoid becoming stale copies of Metric View definitions?

Out of scope:

- production row-level permission enforcement;
- deterministic runtime fast path as the default user experience;
- dedicated Metric View query tool;
- template marketplace;
- automated Metric View definition generation.

## 7. Follow-Up Docs

- [`design.md`](./design.md): target v0.4 golden-case eval asset design.
- [`action-plan.md`](./action-plan.md): implementation phases and gates.
- [`distribution-gap-analysis.md`](./distribution-gap-analysis.md): seed-package analysis for Distribution.
