# Context Engineering Gap Analysis (v0.3.7 Execution)

日期: 2026-06-11

本文记录 `databricks-builder-app-oai` 在 **Execution / 对正确实体执行正确分析** 这一层的现状差距。它以 [`../v0.3.6/design.md`](../v0.3.6/design.md) 的 `routing_decision` 为前置输入，并对照 [`../context-engineering.md`](../context-engineering.md) 的 3.2 Execution、3.3 Validation、3.4 Disclosure。

v0.3.7 不重新解决 routing。它假设 v0.3.6 已能给出 selected source tier、selected entity、grain、required files、fallback reason 和 validation status。本文关注 route 之后发生什么。

## 0. 当前结论

当前系统已经有执行保护的基础，但这些保护分散在 prompt、tool state 和 SQL guardrail 中，还没有显式的 Execution Context Asset Pack。

已存在的能力：

- `update_plan` / `submit_conclusion` 工具形成可见 story workflow，并用 `AgentToolRunState` 防止 Databricks tools 在 plan 创建前运行。
- `execute_sql` / `execute_sql_multi` 在 configured project tables 上触发 schema gate，要求先 inspect schema。
- read-only preview 会裁剪写工具，并用 SQL allowlist 限制非只读 SQL。
- Metric View first policy 写在 prompt 中，当前通过 `execute_sql` 手写 `MEASURE(...)` 查询。
- tool events、plan events、synthesis events 已经持久化，可作为 execution evidence 的原材料。
- schema history 会从最近 execution events seed 当前 run，减少重复 schema inspection。

主要缺口：

- 没有显式 Execution Contract。执行阶段不消费结构化 route，只从 prompt/plan 文本里隐式延续。
- 没有 execution-specific Context Assets。senior-analyst SOP、analysis patterns、query templates、validation checks 没有作为可加载资产管理。
- Metric View execution 仍完全依赖模型手写 SQL；没有 route-aware MV query template 或 compile check。
- schema gate 只防"猜列名"，不防错 grain、错 denominator、错 period、错 fallback source。
- suspicious output 自查没有结构化触发器，0 行、null spike、异常跳变可能直接进入结论。
- runtime evidence 没有统一 package，最终答案无法稳定披露 source tier、query/spec、row count、validation status、freshness、owner、loaded files。
- read-only SQL allowlist 是字符串前缀判断，已有测试但仍需要 execution-layer bypass coverage。
- 没有 execution eval：不能判断 route 正确后，执行是否得出正确数字或正确表格。

## 1. 当前 Execution 链路

当前一次 analysis execution 大致如下：

1. 模型按 prompt 调用 `update_plan(op="create")`，再 `update_plan(op="start")`。
2. 若调用 Databricks tool 时没有 active step，`run_state.databricks_gate_error` 返回 actionable error。
3. 对 configured tables/MVs 写 SQL 时，`sql_schema_gate_error` 检查是否已有 schema inspection。
4. `execute_sql` 或 `execute_sql_multi` 在 warehouse 或 cluster fallback 上执行 SQL。
5. 工具结果转成 `tool_result` / evidence events，前端 story 展示中间证据。
6. 模型调用 `submit_conclusion`，后端转成 `synthesis.appended` 并持久化 assistant answer。

这条链路能保证"有计划、有步骤、有 schema inspection"，但不能保证"遵守 route、使用正确 execution assets、检查结果可疑点、披露 provenance"。

## 2. Execution Context Sources

| 来源 | 当前用途 | Execution 缺口 |
|---|---|---|
| `routing_decision` | 当前不存在；v0.3.6 目标输出 | v0.3.7 需要把它作为 execution contract，而不是重新发现实体 |
| `update_plan` state | 约束 UI story 和 Databricks tool sequencing | 不表达 source tier、grain、query mode、validation status |
| SQL schema gate | 防止 configured tables/MVs 在无 schema evidence 下被查询 | 不检查 semantic route、approved raw path、denominator、period、grain |
| `metric_view_context` | prompt 中提示 MV status/grain/measures/dimensions | 不生成 route-aware MV query template，也不检查 `MEASURE(...)` 使用 |
| project files | 可读，但执行阶段没有 required execution files 概念 | analysis patterns、SOP、validation checks 无统一文件规范 |
| tool events | 记录 SQL/tool output | 没有聚合为 runtime evidence package |
| `submit_conclusion` | 结构化 conclusion、highlights、next steps | 不强制 provenance footer，也不从 trace 推导 metadata |

## 3. Execution Asset 分类缺口

| `asset_type` | As-is 状态 | Execution 缺口 |
|---|---|---|
| `platform_mechanism` | plan gate、schema gate、read-only filter 存在 | 缺 route-aware execution gate 和 evidence package builder |
| `semantic_truth` | MV context 可见 | 缺 query template、source tier check、grain compatibility check |
| `analyst_workflow` | prompt workflow 和 skills 存在 | 缺 senior-analyst SOP asset、analysis pattern modules、suspicious-result checklist |
| `runtime_evidence` | 原始 tool events 存在 | 缺 normalized query/spec/result/evidence package |
| `control_plane` | unit tests 存在 | 缺 data-correctness eval、execution contract tests、provenance parse tests |
| `turn_context_memory` | SDK session 存在 | 历史里的 prior filters/defaults 没有受 route/execution contract 约束 |

## 4. 对照 Senior-Analyst SOP 的差距

上层 CE design 的 execution SOP 要求 route 之后完成若干动作。当前差距如下：

1. **Start from the routing decision**
   当前没有 route input，因此 execution 可能重新 broad discovery 或直接写 raw SQL。

2. **Check red flags and scope**
   read-only 有工具层保护，但 PII、restricted data、high-stakes、causal/root-cause overclaim 没有 execution preflight asset。

3. **Clarify missing constraints only when no default exists**
   period、segment、population、denominator、output grain 的默认值没有统一来源，也不会进入 execution trace。

4. **Load only required Context Assets**
   `read_project_file` 可用，但 execution 没有 required files list，也不区分 routing files 和 execution pattern files。

5. **Use semantic path first**
   prompt 有 Metric View first，但工具层不检查 route selected MV 是否真的被查询。

6. **Pre-rebut raw-SQL shortcuts**
   prompt 中有部分 policy，但执行阶段没有记录"为什么 fallback 到 raw"。

7. **Decide time, freshness, and grain before querying**
   schema gate 不覆盖时间窗口、freshness lag 或 grain mismatch。

8. **Acquire source and schema evidence**
   schema evidence 有，source tier / owner / validation status / query mode evidence 没有统一 package。

9. **Execute with analytical conventions**
   safe division、dedupe、null handling、denominator rules 依赖模型推理和项目 notes。

10. **Inspect suspicious outputs**
    当前没有自动或半自动 suspicious result checks。

11. **Prepare evidence package**
    最终 conclusion 没有标准 provenance signature。

## 5. Metric View Execution 现状

Metric View currently runs through ordinary SQL tools.

已存在：

- prompt 要求 KPI/aggregate/ranking/trend/comparison 优先使用 Metric Views；
- prompt 提醒使用 `MEASURE(...)`；
- schema gate 把 configured `semantics.metric_views` 纳入 required inspection tables。

缺口：

- 没有 route-aware MV query template，例如 selected measure/dimensions/period 自动转成 query skeleton。
- 没有检查 `selected_source_tier=metric_view` 时 SQL 是否引用 selected MV。
- 没有判断 raw fallback 是否有 documented reason。
- 没有记录 compiled MV query/spec 与 result shape 的统一 evidence。

## 6. Runtime Evidence 现状

当前 evidence 是事件流，不是 answer-ready package。

已有事件：

- `plan.created` / `plan.step_started` / `plan.step_finished`;
- tool call and tool result events;
- `synthesis.appended`;
- operation status events。

缺口：

- 没有把 route、loaded files、query/spec、result rows/shape、row count、validation checks、fallback reason 汇总成一个 `execution_evidence` object。
- 没有最终答案 footer 可被 parse 和 trace 复核。
- 没有 eval-friendly normalized result extraction path。

## 7. v0.3.7 需要解决的问题

v0.3.7 应回答 execution 层问题：

1. execution 如何消费 v0.3.6 的 `routing_decision`。
2. 哪些 execution Context Assets 常驻，哪些按需读取：senior-analyst SOP、query templates、pattern modules、validation checklist。
3. 如何为 Metric View path 提供 route-aware SQL skeleton，而不急于新增 dedicated `query_metric_view` tool。
4. 如何把 tool events 聚合为 `execution_evidence`。
5. 如何检查 source tier、grain、period、row count、result shape 和 suspicious outputs。
6. 如何从 trace/settings 推导 provenance footer，而不是让模型自报 confidence。
7. 如何扩展 read-only / schema gate contract tests。
8. 如何建立 data-correctness eval：route fixed -> execute -> compare with ground-truth SQL。

不在 v0.3.7 解决：

- routing asset pack 设计本身；
- deterministic golden-case fast path；
- full manifest/versioning system；
- production row-scope permission enforcement；
- embedding retrieval；
- sliding-window history replacement。

## 8. 后续文档

- [`design.md`](./design.md): v0.3.7 execution-first target design。
- [`action-plan.md`](./action-plan.md): execution assets、runtime evidence、validation 和 eval 的实施计划。
