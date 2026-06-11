# Context Engineering Design (v0.3.7 Execution)

日期: 2026-06-11

本文定义 v0.3.7 的目标状态：在 v0.3.6 routing 产出的 `routing_decision` 之上，建立显式 Execution Context Assets、Execution Contract、Runtime Evidence 和 execution eval。

一句话目标：**route 找到正确实体，execution 负责在该实体上做正确操作，并留下可复核证据。**

## 0. 目标与非目标

**目标**

1. 让 execution 从 `routing_decision` 开始，而不是重新做 broad discovery。
2. 定义 execution Context Assets：senior-analyst SOP、analysis patterns、Metric View query templates、validation checks、runtime evidence。
3. 增加 route-aware execution checks：selected source tier、selected entity、grain、period、fallback reason。
4. 聚合 `execution_evidence`，用于 final disclosure、eval 和 debugging。
5. 增加 suspicious result self-check triggers。
6. 增加 provenance signature，由 trace/settings 推导字段。
7. 建立 data-correctness eval，验证 route 正确后的执行结果。

**非目标**

- 不改变 v0.3.6 routing contract。
- 不新增 dedicated `query_metric_view` tool，除非 eval 证明手写 MV SQL 错误率不可接受。
- 不实现 v0.4 golden-case fast path。
- 不做 production row-level permission system。
- 不替换 SDK session history。

## 1. Execution Contract

Execution 必须消费 v0.3.6 的 route handoff：

```yaml
execution_contract:
  route_id: null
  question_family: KPI | aggregate | ranking | trend | comparison | reconciliation | drill_down | validation | exploratory | unsupported
  selected_source_tier: metric_view | candidate_metric_view | approved_raw | exploratory_raw | unsupported
  selected_entity:
    source: null
    measures: []
    dimensions: []
    raw_path: null
  validation_status: certified | validated | candidate | stale | missing | not_applicable
  constraints:
    period: null
    grain: null
    filters: []
    denominator: null
    comparison: null
  required_project_files: []
  loaded_project_files: []
  fallback_reason: null
  analysis_pattern: null
```

Rules:

- If `selected_source_tier` is `metric_view`, the first analytical query must target the selected MV unless a documented compile/run failure occurs.
- If execution falls back to raw SQL, it must record `fallback_reason` and source tier downgrade.
- If required constraints are missing and no documented default exists, execution should ask a clarification before querying.
- If route is missing, execution may use current behavior but must emit `routing_decision_missing`.

## 2. Execution Context Asset Pack

v0.3.7 adds execution-focused assets on top of routing assets.

| `asset_type` | Execution content | Loading |
|---|---|---|
| `analyst_workflow` | senior-analyst SOP core, suspicious-result checklist, analysis pattern modules | SOP core as `compiled_core`; patterns as `on_demand_file` |
| `semantic_truth` | MV query templates, approved raw path query conventions, grain/time/freshness constraints | templates in `compiled_summary` or route-selected `on_demand_file` |
| `runtime_evidence` | executed SQL/MV spec, result shape, row count, loaded files, validation checks, fallback reason | `runtime_observed` and `final_disclosure` |
| `platform_mechanism` | route-aware gates, schema gate, read-only allowlist, evidence builder | code/tool state |
| `control_plane` | data-correctness eval cases, ground-truth SQL, footer parser tests | `eval_only` |

## 3. Senior-Analyst SOP Asset

The SOP should be an `analyst_workflow` Context Asset, not scattered prompt prose. It should stay compact and guardrail-oriented.

Core compiled SOP:

1. Start from `routing_decision`; do not reopen broad discovery by default.
2. Confirm source tier, entity, period, grain, filters, denominator, and fallback status before querying.
3. Load route-required files and selected analysis pattern files only.
4. Use semantic path first when validated/certified MV covers the ask.
5. Resolve time, freshness, and grain before query generation.
6. Capture query/spec and result evidence.
7. Check suspicious results before conclusion.
8. Disclose source tier, validation status, fallback reason, and caveats.

Pattern modules should be on-demand files, for example:

- `patterns/reconciliation.md`;
- `patterns/rate-decomposition.md`;
- `patterns/drill-down.md`;
- `patterns/cohort.md`;
- `patterns/funnel.md`.

These modules define analytical conventions, not rigid step recipes.

## 4. Metric View Execution Without A New Tool

v0.3.7 should first improve MV execution through templates and checks.

Template responsibilities:

- render a query skeleton using selected MV, measures, dimensions, filters, and period;
- remind use of `MEASURE(...)`;
- require explicit dimensions instead of `SELECT *`;
- include safe handling for period windows and grouping grain;
- keep direct SQL oracle as eval/control asset, not hidden runtime validator.

Example skeleton shape:

```sql
SELECT
  <dimension_columns>,
  MEASURE(`<measure_name>`) AS <metric_alias>
FROM <metric_view_full_name>
WHERE <period_filter>
GROUP BY <dimension_columns>
```

Checks:

- selected MV name appears in the executed SQL or query spec;
- selected measures appear as `MEASURE(...)` or documented equivalent;
- raw fallback includes `fallback_reason`;
- grain and period match the execution contract.

Dedicated `query_metric_view` remains evidence-gated. Add it only if execution evals show material MV SQL compile or semantic errors.

## 5. Runtime Evidence Package

Execution should produce a normalized evidence object:

```yaml
execution_evidence:
  route_id: null
  source_tier: metric_view
  selected_source: null
  executed_queries:
    - query_id: null
      sql_ref: null
      query_mode: metric_view_sql | raw_sql | schema_inspection
      row_count: null
      columns: []
      result_shape: null
  loaded_project_files: []
  validation:
    status: validated
    checks:
      - name: row_count_nonzero
        result: pass | fail | warn | not_applicable
  suspicious_result_checks: []
  fallback_reason: null
  owner: null
  freshness: null
```

This object can be built from tool events and route metadata. It should not rely on the model inventing provenance.

## 6. Suspicious Result Self-Checks

Suspicious outputs should trigger self-check before final answer:

| Trigger | Required action |
|---|---|
| 0 rows where non-empty result is expected | inspect filters, period, source tier, join/grain assumptions |
| all/null-heavy measure | inspect denominator, null handling, source freshness |
| impossible percentage or ratio | inspect numerator/denominator and safe division |
| unexpected grain collapse | inspect GROUP BY dimensions and dedupe |
| adjacent-period jump above configured threshold | inspect period window, filters, source freshness |
| selected MV route but raw SQL used | require fallback reason and disclosure |

Implementation can start as prompt+trace self-check, then graduate to tool-state checks for high-confidence cases.

## 7. Validation And Disclosure

Runtime validation is not the same as eval oracle.

Runtime validation may check:

- route/source tier consistency;
- schema evidence;
- query result shape;
- row count;
- grain and period;
- denominator sanity;
- freshness if cheap and configured;
- fallback reason.

Direct SQL ground truth belongs to eval unless it is the actual answer path.

Final answers should include a provenance signature derived from trace/settings:

```text
Source: Metric View <name> | Validation: validated | Owner: <owner or unknown> | Freshness: <if measured> | Fallback: none
```

Rules:

- Do not ask the model to self-report confidence.
- If source tier is fallback/raw, disclose status before the answer.
- A false footer is a product bug; fields must be parseable and trace-checkable.

## 8. Read-Only And Schema Gates

v0.3.7 strengthens existing execution gates:

- keep plan-before-Databricks gate;
- keep schema inspection gate for configured tables/MVs;
- extract gate-exempt SQL prefixes to a single constant;
- test read-only bypass attempts: comments, casing, leading whitespace, multi-statement SQL;
- keep pass-through auth assumption explicit: the agent cannot exceed the user's Databricks permissions, but app-level read-only still needs tests.

Harder resource-level read-only enforcement, such as dedicated low-privilege credentials or SELECT-only grants, remains a feasibility study unless the product has scoped credentials.

## 9. Execution Evals

Execution evals run after routing evals. They should fix or inspect route, then compare actual output to ground truth.

Case shape:

```yaml
id: distribution.execution.kpi.001
prompt: "What was April POC achievement?"
route_expectation:
  selected_source_tier: metric_view
  selected_entity:
    source: <metric view>
ground_truth_sql: <direct SQL oracle>
assertions:
  - row_by_row_match
  - source_tier_is_metric_view
  - provenance_footer_parseable
  - no_missing_required_files
```

Metrics:

- data correctness pass rate;
- source tier compliance;
- MV query compile/run error rate;
- suspicious check hit rate and repair rate;
- tool call count;
- file-read count;
- latency;
- provenance footer parse rate.

## 10. Handoff To v0.4

v0.3.7 prepares execution for v0.4 Golden Analysis Cases by making these interfaces stable:

- `routing_decision` -> `execution_contract`;
- route-selected query template;
- `execution_evidence`;
- data-correctness eval schema with room for canonical MV path and answer contract.

v0.4 can then add deterministic fast paths without rewriting routing or execution evidence.
