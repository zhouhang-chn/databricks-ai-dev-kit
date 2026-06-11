# Context Engineering Design (v0.3.6 Routing)

日期: 2026-06-11

本文定义 v0.3.6 的目标状态：先把 **Routing** 做成显式、可观测、可评测的 Context Engineering 层。它对应 [`../context-engineering.md`](../context-engineering.md) 的 3.1 Routing 和 Appendix 8.1 的前两条 defense lines：Context Assets 与 Routing。

v0.3.7 将在此基础上处理 execution：分析 SOP、SQL/MV query patterns、runtime evidence、validation、provenance disclosure。

## 0. 目标与非目标

**目标**

1. 建立项目级 Routing Context Asset Pack，让 canonical metrics、business context、requirements、readiness、fallback policy 有明确载体和 loading behavior。
2. 增加 Knowledge Router contract：对每轮分析问题输出结构化 `routing_decision`。
3. 把常驻 routing core 与长尾 routing files 分离：小而稳定的内容编译进 prompt，大而条件相关的内容通过 `read_project_file` 按需读取。
4. 记录 file-read compliance，能回答模型是否读取了 route 指定的 Context Assets。
5. 明确下沉文件的 source-of-truth 与 release freeze 规则。
6. 建立 routing eval，先评估选源、选指标、选粒度、required files 是否正确，不在本版评估最终数字答案。

**非目标**

- 不实现 execution SOP、query generation hardening、runtime validation 或 provenance footer。
- 不新增 dedicated `query_metric_view` tool。
- 不实现 deterministic golden-case fast path，只预留 route match object 的形状。
- 不替换 OpenAI Agents SDK session。
- 不把所有项目文件接入 embedding retrieval；文件 orchestration 先覆盖 <=100 assets 的项目。

## 1. Routing Context Asset Pack

每个项目应有一个 routing asset pack。v0.3.6 不要求引入完整 manifest 服务，但要求现有载体能表达下表字段。

| 字段 | v0.3.6 要求 | 载体 |
|---|---|---|
| `id` | 必须稳定，可被 route 和 trace 引用 | MV full name、project file path、requirement id |
| `asset_type` | 必须声明 routing 相关类型 | settings metadata 或 derived file header |
| `defense_claim` | 新增/变更资产必须说明防御什么失败 | file header 或 settings note |
| `source_of_truth` | 必须说明来自 DB settings、authored file、derived file、Databricks object 或 eval case | settings / file header |
| `loading_behavior` | `compiled_core`、`compiled_summary`、`on_demand_file`、`eval_only` | settings / route index |
| `scope` | project、turn、eval/control | settings / trace |
| `validation_status` | semantic truth assets 必须有 | Metric View context / readiness |
| `owner` | metric/source readiness 必须有或显式 unknown | settings / readiness |

### 1.1 Routing Asset Types

| `asset_type` | Routing 用法 | 例子 |
|---|---|---|
| `semantic_truth` | 把业务词映射到 canonical MV / measure / dimension / grain / approved raw path | Metric View definition、MV context、approved raw source |
| `business_context` | 解释术语、别名、边界、业务默认值、caveats | glossary、requirements、known caveats、decision notes |
| `analyst_workflow` | 定义如何 route，不定义如何执行 SQL | Knowledge Router contract、metric-view-first policy、fallback policy |
| `control_plane` | 用于 route eval 和 readiness gate | route eval cases、expected source tier、pointer compliance expectations |
| `platform_mechanism` | 支撑 route 可观测和预算 | `routing_decision` schema、tool schema budget、file-read tracking |

Execution 相关的 `runtime_evidence` 和 execution `analyst_workflow` 在 v0.3.7 处理。

## 2. Compile Vs. On-Demand

v0.3.6 的 routing 载入规则：

| 内容 | Loading | 原因 |
|---|---|---|
| validated/certified MV full name、status、grain、measures、dimensions | `compiled_core` | 小、稳定、所有 KPI/aggregate 路由都需要 |
| Metric View first policy、fallback source priority、pre-rebutted raw-SQL shortcuts | `compiled_core` | 路由约束必须常驻 |
| 日期/周期默认约定、常用 grain 规则 | `compiled_core` 或 `compiled_summary` | 时间窗口是高频实体消歧条件 |
| full requirements、gap analysis、readiness notes、business terms、source objects、known caveats | `on_demand_file` | 大、条件相关、会随项目增长 |
| route eval cases、direct SQL oracle | `eval_only` | 不进入普通 user run |

关键约束：瘦 prompt 是注意力策略，不是简单省 token。常驻 routing core 不能为了 prompt 体积下降而下沉，否则每个 KPI 路由都要多一次文件读取。

## 3. Knowledge Router Contract

v0.3.6 引入一个显式 routing stage。实现可以先是 model-followed contract + trace tool，不必独立 LLM classifier。

Router 必须输出：

```yaml
routing_decision:
  question_family: KPI | aggregate | ranking | trend | comparison | reconciliation | drill_down | validation | exploratory | unsupported
  business_terms: []
  constraints:
    period: null
    grain: null
    filters: []
    dimensions: []
    denominator: null
    comparison: null
  selected_source_tier: metric_view | candidate_metric_view | approved_raw | exploratory_raw | unsupported
  selected_entity:
    source: null
    measures: []
    dimensions: []
    raw_path: null
  validation_status: certified | validated | candidate | stale | missing | not_applicable
  required_assets: []
  required_project_files: []
  analysis_pattern: null
  fallback_reason: null
```

Route semantics:

1. Classify question family before writing SQL or choosing raw tables.
2. Extract business terms and constraints from the user message and documented defaults.
3. Resolve concepts to canonical entities using the compiled routing core first.
4. If long-tail context is needed, add project-file pointers to `required_project_files` and read them before execution.
5. Emit `routing_decision` into trace so execution can consume it.

Source priority:

1. certified/validated Metric View that covers the ask;
2. candidate Metric View with visible status and fallback policy;
3. approved raw path for unsupported Metric View coverage;
4. exploratory raw SQL only with explicit fallback reason.

## 4. Routing Decision Mechanism

Recommended implementation shape:

- Add a base tool or typed event such as `record_routing_decision`.
- Keep it available to all analysis projects, like `update_plan` and `submit_conclusion`.
- Initially make it non-blocking: record the decision but do not reject SQL if absent.
- After evals stabilize, add a soft gate for analytical Databricks tools: if no route exists for KPI/aggregate/trend/comparison questions, return actionable guidance.

Why a tool/event instead of free-form plan text:

- route fields become parsable;
- v0.3.7 execution can consume a stable input;
- route evals can compare expected and actual selected source tier/entity/files;
- telemetry can track fallback rates and pointer compliance.

## 5. Project File Orchestration

v0.3.6 should standardize routing file names and pointers. A project may use authored files, derived files, or both.

Recommended file roles:

| File role | Loading | Source |
|---|---|---|
| `requirements.md` | `on_demand_file` | authored or onboarding generated |
| `readiness.md` | `on_demand_file` | authored, derived from validation status |
| `gap-analysis.md` | `on_demand_file` | authored or onboarding generated |
| `metric-view-<name>.md` | `on_demand_file` | derived from settings plus human-reviewed notes |
| `routing-index.md` or settings equivalent | `compiled_summary` | generated pointer map |

`routing-index` should stay compact. It maps question families and common business terms to project files, not to long prose.

Example:

```yaml
routing_index:
  KPI:
    files:
      - requirements.md
      - readiness.md
      - metric-view-m1_poc_achievement_metrics.md
  reconciliation:
    files:
      - gap-analysis.md
      - readiness.md
```

## 6. File-Read Compliance

`AgentToolRunState` currently records whether AGENTS.md was read. v0.3.6 should generalize this to:

```python
project_files_read: set[str]
required_project_files: set[str]
```

Trace and eval should compute:

- `required_files_count`;
- `files_read_count`;
- `missing_required_files`;
- pointer non-compliance rate by question family.

This signal is the gate for whether a deterministic matcher is needed. If model-followed pointers work, do not add brittle keyword matching. If missing required files becomes a recurring failure, add matcher logic later.

## 7. Source Of Truth And Release Freeze

Routing files become product-critical once long-tail context moves out of prompt. v0.3.6 therefore needs a source-of-truth rule.

| Asset | Role | Write path | Run-time read path |
|---|---|---|---|
| `project_setting.yaml` | user-readable editing source | user save | not directly reread during run |
| DB settings | run-time source for compiled routing core | synced from YAML/API | every run |
| derived routing files | on-demand carrier for settings-derived long-tail context | generated from settings on save/release | via `read_project_file` |
| authored routing files | human-authored domain references | edited in project workspace | via `read_project_file` |
| release snapshot | frozen source for user/viewer runs | release publish | settings plus frozen file snapshot |

Required rule: release-pinned runs must read frozen routing files, not draft workspace files. If a pointer targets a missing file, the route should degrade by compiling the minimal relevant settings fields and recording the missing asset in trace.

## 8. Routing Budget And Tool Surface

Routing correctness is affected by both prompt content and tool schema surface.

v0.3.6 should measure:

- compiled routing core char/token size;
- per-skill guidance size;
- actual tool schema size after skill filtering;
- number of route-required file reads;
- route latency before first Databricks query.

Skill selection is a routing CE lever. Analysis projects should default to a small tool surface: plan/conclusion, project file reads, SQL/schema tools, operation status, and a minimal analysis skill set. Heavy UC/jobs/vector-search tools should not be enabled unless the project needs them.

## 9. Routing Evals

Routing eval cases should not require final numeric answer correctness. They assert route correctness.

Each case should contain:

```yaml
id: distribution.kpi.poc_achievement.001
prompt: "How did POC achievement look in April?"
expected:
  question_family: KPI
  selected_source_tier: metric_view
  selected_entity:
    source: <metric view full name>
    measures: [...]
  required_project_files:
    - requirements.md
    - readiness.md
```

Metrics:

- source tier accuracy;
- selected entity accuracy;
- required file recall;
- fallback reason correctness;
- pointer non-compliance rate;
- route latency and file-read count.

This routing eval becomes the input gate for v0.3.7 execution evals.

## 10. v0.3.7 Handoff Contract

v0.3.7 execution must start from `routing_decision`; it should not reopen broad discovery unless validation proves the route is wrong.

Handoff fields:

- selected source tier and entity;
- validation status and owner when available;
- required project files already read or still missing;
- grain, period, filters, denominator, comparison baseline;
- fallback reason;
- analysis pattern hint.

If this contract is missing, v0.3.7 may fall back to current behavior, but must record `routing_decision_missing` as a measurable gap.
