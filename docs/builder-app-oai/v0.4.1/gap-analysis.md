# v0.4.1 Golden-Case-Assisted Routing And Execution Gap Analysis

Date: 2026-06-11

This document evaluates the next gap after v0.4: how to use Golden Analysis
Cases to improve normal agent routing and execution without turning them into
opaque hard-coded answers.

v0.4 makes golden cases eval-first `control_plane` Context Assets. v0.4.1 asks:
when a user's question resembles an active golden case, can the agent safely use
that case as runtime guidance for source selection, required files, query shape,
answer structure, and fallback disclosure?

## 0. Current Conclusion

The current design has the right ingredients but not the runtime assist layer.

Available after v0.4:

- golden cases define prompts, route expectations, execution expectations,
  oracle policy, answer contracts, assertions, and launch gates;
- v0.3.6 defines `routing_decision` and pointer compliance;
- v0.3.7 defines `execution_contract` and `execution_evidence`;
- v0.4 evals can tell whether the agent performs well against reviewed cases.

Missing for v0.4.1:

- no runtime-safe golden-case assist payload that excludes oracle SQL and
  expected answer values;
- no matcher that can select a likely golden case as guidance without forcing a
  hidden fast path;
- no trace fields showing whether routing/execution used golden-case
  assistance;
- no policy for when case guidance may override or narrow default routing;
- no paired eval mode that compares the same agent with golden-case assistance
  disabled and enabled.

## 1. Current Runtime Gap

Today the normal agent path is:

```text
user prompt
-> route with compiled semantic context and project-file pointers
-> execute with SOP/query/evidence rules
-> validate and disclose
```

Golden cases are used as eval assets, not as runtime context. That is safe but
leaves value unused:

- route expectations could narrow entity selection;
- required files could improve pointer compliance;
- execution expectations could reduce wrong source, wrong grain, and raw-SQL
  fallback errors;
- answer contracts could improve consistent disclosure;
- case readiness could prevent the agent from over-claiming a covered path.

The risk is equally clear: if the full golden case enters runtime prompt, the
agent may see oracle SQL, expected outputs, or scoring hints. That invalidates
evals and can make answers look correct for the wrong reason.

## 2. Context Asset Gaps

| Asset | Current v0.4 Role | v0.4.1 Gap |
|---|---|---|
| `golden_case` | `control_plane`, mostly `eval_only` | Need a runtime-safe projection |
| `routing_decision` | Traceable route result | Need `assist_case_id`, `assist_mode`, and case-derived hints |
| `execution_contract` | Route-derived execution input | Need case-derived query/ref/grain/fallback hints |
| `execution_evidence` | Trace evidence for eval/disclosure | Need fields showing which hints were accepted, ignored, or contradicted |
| eval config | Scores golden cases | Need paired with/without golden-case-assist variants |

## 3. Golden Case Runtime Safety Gap

Golden cases contain both runtime-safe guidance and eval-only material.

Runtime-safe:

- case id, title, status, launch tier;
- trigger examples and intent labels;
- expected question family;
- selected source tier and selected semantic source;
- required project files and required context assets;
- required measures, dimensions, grain, filters, and fallback policy;
- answer contract shape and required caveats;
- readiness status.

Eval-only:

- oracle SQL;
- expected rows or values;
- scoring rubrics that reveal expected numeric answer;
- direct pass/fail thresholds tied to known outputs;
- hidden negative cases.

v0.4.1 needs a projection that includes only runtime-safe guidance.

## 4. Routing Enhancement Gap

Golden cases can help routing, but current routing does not consume them.

Expected improvements:

- choose the right question family faster;
- prefer the reviewed Metric View/source tier;
- load the right business context files;
- avoid broad schema scans;
- ask targeted clarification when case-required parameters are missing.

Missing controls:

- confidence threshold for using a golden case as route guidance;
- behavior when multiple cases match;
- behavior when a case is stale or blocked;
- trace record for accepted/rejected case hints;
- eval comparison against baseline routing without case guidance.

## 5. Execution Enhancement Gap

Golden cases can help execution after routing by supplying query shape and
evidence expectations.

Expected improvements:

- use the route-selected Metric View instead of drifting to raw SQL;
- apply required grain, period, and filters;
- use declared measures/dimensions and query refs;
- run suspicious-result checks that matter for the case;
- disclose fallback and caveats consistently.

Missing controls:

- execution must not see direct SQL oracle as a hidden answer;
- case guidance should not bypass schema gate or read-only policy;
- case query templates must remain hints unless implemented as safe builders;
- execution evidence must show whether case hints were followed.

## 6. Eval Configuration Gap

After v0.4.1, evals need a configuration item to compare:

- the same agent with golden-case assistance disabled;
- the same agent with golden-case assistance enabled.

This is necessary because golden cases should earn their runtime complexity.
The product should be able to answer whether assistance improves route
accuracy, data correctness, source-tier compliance, pointer compliance, latency,
tokens, and tool/file counts.

## 7. v0.4.1 Questions To Resolve

1. What fields are allowed in `golden_case_assist` runtime context?
2. How does case matching feed `routing_decision` without forcing a hidden path?
3. How do case hints feed `execution_contract` and `execution_evidence`?
4. How are stale/blocked cases excluded from runtime assistance?
5. What eval config compares with and without golden-case assistance?
6. What telemetry shows that case assistance helped or hurt?

Out of scope:

- production permission enforcement;
- leaking oracle SQL into runtime prompt;
- replacing routing/execution with a deterministic fast path by default;
- adding a mandatory `query_metric_view` tool.

## 8. Follow-Up Docs

- [`design.md`](./design.md): target v0.4.1 assisted routing/execution design.
- [`action-plan.md`](./action-plan.md): implementation phases and gates.
