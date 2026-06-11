# Context Engineering Action Plan (v0.3.6 Routing)

日期: 2026-06-11

本文把 [`design.md`](./design.md) 拆成 routing-first implementation tasks。v0.3.6 的验收重点不是最终答案数字正确，而是：agent 能否稳定 route 到正确 source tier、canonical entity、required Context Assets，并把这个决定记录下来。

## 阶段总览

```
R1 Routing baseline and observability
  -> R2 Routing asset pack and file orchestration
      -> R3 Routing decision and eval gate
```

Gate:

- **R1 gate**: 当前 prompt/rendering/tool surface 有基线；普通 project file reads 可追踪。
- **R2 gate**: Distribution routing assets 有 compiled core + on-demand pointer；release-pinned file-read 设计落地。
- **R3 gate**: `routing_decision` trace 和 routing eval 可跑；v0.3.7 execution 可消费 route handoff。

## R1 - Routing Baseline And Observability

| ID | 任务 | 触及文件 | 验收标准 | 依赖 |
|---|---|---|---|---|
| R1-BE-1 | 定义 routing dataclasses/types：`RoutingDecision`、`RoutingAssetRef`、`RoutingContextUsage` | 新增 `server/services/context/routing.py` 或等价位置 | 类型可 import；字段覆盖 design §3 | - |
| R1-BE-2 | 测量当前 compiled project context 和 skill/tool schema surface | `system_prompt.py`、`skills_manager.py`、`openai_runtime.py` | 日志或 usage object 记录 prompt chars、skill guidance chars、tool count/schema size | - |
| R1-BE-3 | 扩展 `AgentToolRunState.mark_project_file_read`，记录普通 project files | `server/services/tools/run_state.py`、`project_files.py` | trace/debug state 能列出 `project_files_read`；AGENTS.md 行为保持不变 | - |
| R1-BE-4 | 记录 route 前置状态：project id、release id、role、enabled skills source、project asset roots | `openai_runtime.py` | routing eval 能关联到 release/settings/tool surface | R1-BE-1 |
| R1-TEST-1 | prompt rendering snapshot：现有 Metric View context 渲染行为有基线 | `databricks-builder-app-oai/tests/` | 固定 settings 下 prompt 片段稳定 | R1-BE-2 |
| R1-TEST-2 | project file read tracking test | `tests/test_openai_runtime.py` 或新测试 | `read_project_file("requirements.md")` 后 state 记录相对路径 | R1-BE-3 |
| R1-DOC-1 | 更新 docs map，声明 v0.3.6 routing、v0.3.7 execution 的边界 | `docs/builder-app-oai/context-engineering.md`、`README.md` | 链接可发现 | - |

## R2 - Routing Asset Pack And File Orchestration

| ID | 任务 | 触及文件 | 验收标准 | 依赖 |
|---|---|---|---|---|
| R2-BE-1 | 定义 Routing Context Asset Pack 读取规则：compiled core + on-demand files | `server/services/context/`、`project_config.py` | 能从 settings/project files 生成 asset refs | R1 |
| R2-BE-2 | 保留 compiled routing core：MV full_name/status/grain/measures/dimensions、Metric View first policy、fallback priority、日期/周期默认约定 | `system_prompt.py`、`project_config.py` | 常驻 prompt 仍包含 routing happy path 必需信息 | R2-BE-1 |
| R2-BE-3 | 下沉 long-tail routing context：business_terms、source_objects、known_caveats、requirements/readiness/gap 细节通过 project file pointers 读取 | `project_settings.py`、project files | prompt 只留 compact routing index/pointers；文件可被 `read_project_file` 读取 | R2-BE-1 |
| R2-BE-4 | 增加 compact routing index | settings 或 `routing-index.md` | question family / business terms 可映射到 required files | R2-BE-3 |
| R2-BE-5 | source-of-truth 和 release freeze：release-pinned run 的 file read 指向 frozen files | release/settings/project file tools | viewer/user_preview 不读 draft routing files；缺失文件有降级和 trace | R2-BE-3 |
| R2-BE-6 | 默认技能集收敛：分析项目不默认启用重工具 surface | `.agents/enabled_skills.json`、`openai_runtime.py`、`skills_manager.py` | Distribution 默认工具集足够分析且不暴露 UC/jobs/vector-search 等无关重工具 | R1-BE-2 |
| R2-TEST-1 | context rendering test：compiled core 存在、long-tail 字段不无条件编译 | `tests/` | settings 给定时，assert prompt fields and pointers | R2-BE-2/3 |
| R2-TEST-2 | release-pinned routing file read test | `tests/` | frozen settings 和 frozen files 均被使用 | R2-BE-5 |
| R2-DOC-1 | 项目 routing file convention：asset type、defense claim、loading behavior、derived/authored 区分、命名规则 | `docs/builder-app-oai/v0.3.6/` 或项目模板 docs | 新项目可照此创建 routing assets | R2-BE-3 |

## R3 - Routing Decision And Eval Gate

| ID | 任务 | 触及文件 | 验收标准 | 依赖 |
|---|---|---|---|---|
| R3-BE-1 | 增加 `record_routing_decision` tool 或等价 typed event | `server/services/tools/`、`openai_events.py`、`openai_runtime.py` | route fields 进入 trace；不破坏现有 plan/conclusion flow | R1-BE-1 |
| R3-BE-2 | 在 prompt 中加入 Knowledge Router contract，要求 Databricks analysis 前记录 route | `system_prompt.py` | KPI/aggregate/trend/comparison 问题有明确 route-before-execution instruction | R3-BE-1 |
| R3-BE-3 | v0.3.7 handoff: execution request/state 可读取最近 route | `agent.py`、`openai_runtime.py`、`run_state.py` | route object 对后续 SQL/tool calls 可见 | R3-BE-1 |
| R3-BE-4 | pointer compliance summary：比较 `required_project_files` 与 `project_files_read` | `run_state.py`、event persistence | trace 有 missing required files | R1-BE-3/R3-BE-1 |
| R3-TEST-1 | routing decision schema test | `tests/` | valid/invalid route payload 可校验 | R3-BE-1 |
| R3-TEST-2 | routing eval seed for Distribution | `.test/` 或 `tests/fixtures/` | 至少覆盖 KPI、trend、reconciliation、drill-down、unsupported | R2 |
| R3-TEST-3 | pointer compliance eval | `.test/` | 对 required files 计算 recall / missing files / non-compliance rate | R3-BE-4 |
| R3-TEST-4 | route source-tier accuracy eval | `.test/` | expected vs actual `selected_source_tier` 和 `selected_entity.source` 可 diff | R3-BE-1 |
| R3-DOC-1 | v0.3.7 execution handoff contract 文档化 | `docs/builder-app-oai/v0.3.7/design.md` | execution docs 引用 route handoff fields | R3-BE-3 |

## Cross-Cutting Rules

- **Measure before changing prompt content**: R1 baseline 先存在，再做 R2 下沉。
- **Compiled core 不下沉**: MV full_name/status/grain/measures/dimensions、Metric View first policy、fallback priority、日期/周期约定必须保留在 compiled routing core。
- **Long-tail 用文件，不用大 prompt**: requirements/readiness/gap/business terms/source objects/known caveats 默认走 `on_demand_file`。
- **Route trace 不等于 final answer correctness**: v0.3.6 eval 只判断 route 是否正确；最终数字答案和 runtime validation 在 v0.3.7 处理。
- **Matcher evidence-gated**: 先用 model-followed routing pointers 和 compliance signal；只有 non-compliance 高于阈值才实现 deterministic matcher。
- **Release freeze is mandatory**: routing files 一旦参与 user/viewer run，必须随 release snapshot 冻结。
- **No golden-case fast path in v0.3.6**: 只预留 route match object 形状，v0.4 再实现 canonical execution path。

## Suggested Sequence

1. 完成 R1，得到当前 routing prompt、tool surface、file-read baseline。
2. 在 Distribution 项目上完成 R2，先把 `requirements.md` / `readiness.md` / `gap-analysis.md` / Metric View details 作为 routing assets 接入。
3. 完成 R3，用 routing eval 验证 route decision 和 pointer compliance。
4. 将 R3 的 route handoff 交给 v0.3.7 execution plan。
