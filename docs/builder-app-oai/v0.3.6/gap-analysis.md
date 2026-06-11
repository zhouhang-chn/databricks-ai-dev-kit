# Context Engineering Gap Analysis (v0.3.6 Routing)

日期: 2026-06-11

本文记录 `databricks-builder-app-oai` 在 **Routing / 找到正确实体** 这一层的现状差距。它承接上层设计 [`../context-engineering.md`](../context-engineering.md)，但把 v0.3.6 范围收敛为第一条防线和第二条防线：

- routing 相关 Context Assets 是否存在、是否可加载、是否可观测；
- Knowledge Router 如何把用户问题映射到 canonical metric / table / grain / required files；
- routing decision 如何成为后续 execution 的输入。

执行 SQL、分析 SOP、runtime validation、provenance footer 等执行阶段问题移到 [`../v0.3.7/`](../v0.3.7/)。

## 0. 当前结论

当前系统已经有若干 routing 的原材料，但还没有显式的 Knowledge Router 或 routing Context Asset Pack。

已存在的能力：

- `server/services/system_prompt.py` 渲染 Metric View first 规则，并把项目 settings 的一部分语义信息放入 prompt。
- `server/project_config.py` 把项目 DB settings、run role、resource overrides 归一成每次 agent run 可见的 `project_context`。
- `server/services/tools/project_files.py` 提供 `read_project_file` / `list_project_files` / `grep_project_files` 等按需读取能力，并限制在项目目录内。
- `server/services/skills_manager.py` 按 enabled skills 过滤工具，间接控制模型可见的工具 schema surface。
- `server/services/tools/run_state.py` 已有 `agents_md_read` 和 schema inspection state，可扩展为 routing file-read compliance。
- `projects/distribution/` 已有 `requirements.md`、`gap-analysis.md`、`readiness.md`、Metric View validation SQL 等 routing 需要的业务和语义资产。

缺口：

- 没有独立的 `routing_decision` 结构化记录，trace 里无法回答"为什么选了这张 MV/表/粒度"。
- 没有路由级 Context Asset manifest，项目里哪些文件是 `semantic_truth`、哪些是 `business_context`、哪些是 routing workflow，只能靠人工读文档推断。
- `metric_view_context` 只部分进入 prompt；`business_terms`、`source_objects`、`validation.known_caveats` 等长尾字段没有稳定的按需载体和 loading contract。
- `analysis_requirements`、`semantic_gap_analysis`、`readiness_summary` 可以进入 settings，但当前 run 不会稳定地把它们变成 routing pointers。
- `read_project_file` 会记录 AGENTS.md 是否被读，但不记录普通 routing files，无法衡量 orchestration pointer 是否被遵守。
- release snapshot 保护 DB settings，但 routing files 如果从 settings 下沉成项目文件，当前没有冻结文件读取路径的设计。
- 没有 routing eval：不能黑盒检查同一个问题是否稳定路由到同一个 canonical metric / source tier / required files。

## 1. 当前 Routing 链路

一次 agent run 的 routing 相关链路如下：

1. 前端调用 `POST /invoke_agent`，携带 `project_id`、`conversation_id`、用户消息和资源 override。
2. `server/routers/agent.py` 读取项目、settings、release snapshot 和最近 execution events。
3. `build_project_context` 生成 `project_context`，其中包含 `semantics.metric_views`、`semantics.input_tables`、`semantics.metric_view_context` 的部分字段。
4. `OpenAIAgentRuntime` 解析 enabled skills、同步 project skills、加载 skill guidance 和 AGENTS.md snapshot。
5. `get_system_prompt` 渲染通用 workflow、Metric View first 规则、Project Management Context 和 project operating guide。
6. OpenAI Agents SDK 执行时，模型自行决定是否读项目文件、是否查 schema、是否写 SQL。

这条链路没有 routing stage。模型可以在 prompt 规则影响下做出好的选择，但系统没有明确的 route object、route trace、route gate 或 route-specific asset load plan。

## 2. 当前 Routing Context Sources

| 来源 | 当前载体 | Routing 价值 | 当前限制 |
|---|---|---|---|
| `semantics.metric_views` | DB settings -> prompt | 提供可选 governed semantic sources | 只是列表，没有 measure / dimension / status 细节 |
| `semantics.metric_view_context.metric_views` | DB settings -> `_format_metric_view_context` | 提供 full name、status、grain、measures、dimensions、部分 validation ref | 不渲染 business terms、source objects、known caveats；最多 5 个 MV |
| `semantics.input_tables` / `preferred_tables` | DB settings -> prompt + schema gate | raw fallback 候选和 schema guardrail | 不能表达 approved raw path 的适用问题族和 fallback policy |
| glossary / known caveats / sample queries | DB settings -> prompt | business term 消歧和已知坑 | 体积增长后会污染常驻 prompt，缺少按需文件指针 |
| project files | `read_project_file` | 可承载 requirements/readiness/gap/long-tail context | prompt 没有稳定 router 指针；普通文件读取没有 compliance signal |
| enabled skills | `.agents/enabled_skills.json` / env / request | 控制工具 surface 和 skill guidance | skill selection 没有按 routing question family 度量效果 |
| schema history | execution events -> `AgentToolRunState` | 避免重复 schema inspection | 属于 execution evidence，不是 route decision |

## 3. Context Asset 分类缺口

对照 [`../context-engineering.md`](../context-engineering.md) 的 asset model，v0.3.6 routing 相关缺口如下。

| `asset_type` | As-is 状态 | Routing 缺口 |
|---|---|---|
| `platform_mechanism` | Prompt 规则、tool schemas、plan gate 已存在 | 没有 Knowledge Router contract，也没有 route record tool/schema |
| `semantic_truth` | Metric View 列表和部分 MV context 已进入 prompt | 缺 canonical metric/entity manifest；缺 owner、fallback policy、business terms 的稳定 loading contract |
| `business_context` | glossary、caveats、sample queries、Distribution docs 存在 | 缺 question-family -> required files 的 routing index |
| `analyst_workflow` | skills 和 prompt workflow 存在 | routing workflow 仍是 prose，没有"route before execution"的结构化 decision |
| `turn_context_memory` | SDK session 和 DB messages 存在 | 不能区分历史里的 user correction 是否可参与 routing，且不能覆盖 canonical assets |
| `runtime_evidence` | SQL/schema events 存在 | 没有 route evidence：selected source tier、selected entity、required files、fallback reason |
| `control_plane` | 部分 tests 和 Distribution validation SQL 存在 | 缺 routing precision eval、pointer compliance eval、MECE routing conflict checks |

## 4. 对照 Knowledge Router Contract 的差距

上层 CE 设计定义 routing 五步：classify question family、extract concepts、resolve canonical entities、identify required Context Assets、emit routing decision。当前差距如下：

1. **Classify question family**
   当前没有持久化 question family。模型可能在 plan step 里写出意图，但系统无法统计 KPI / trend / reconciliation / exploratory 等类型的 route 成功率。

2. **Extract concepts and constraints**
   用户消息直接交给 SDK session；系统不记录 business terms、period、grain、filters、denominator、comparison baseline 等 routing inputs。

3. **Resolve concepts to canonical entities**
   Metric View first 规则存在，但没有 route object 强制说明 selected MV / measure / dimension / raw path，也没有 owner-approved definition 和 validation status 的完整判断。

4. **Identify required Context Assets**
   `read_project_file` 可以按需读文件，但 prompt 没有固定的 routing pointer map，也没有 trace 断言"这类问题必须读哪些文件"。

5. **Emit routing decision**
   当前没有 `routing_decision` event。后续 execution 无法消费一个稳定 contract，只能从 prompt、plan 文本和工具调用里反推。

## 5. Distribution Routing Assets 的现状

`projects/distribution/` 是当前最接近 Context Asset Pack 的项目，但资产仍没有进入通用 routing contract。

已有资产：

- `requirements.md`: P0/P1 question families、answer contracts、required assets。
- `gap-analysis.md`: requirements 与 Metric Views / source tables 的 coverage gap。
- `readiness.md`: MV1/MV2/MV3 validation status 和 blockers。
- `inventory.md`: source tables、schemas、workspace code、Metric Views、volumes。
- `metric-views/*.sql`: validation SQL。

Routing 角度的缺口：

- 这些文件没有登记为 `semantic_truth` / `business_context` / `control_plane` assets。
- prompt 不知道 question family 与文件路径的映射，只能依靠模型自行发现。
- release-pinned run 尚未说明读到的是 draft 文件还是 frozen file。
- eval 只验证 SQL/MV 输出，不验证 route 是否选中正确 source tier 和 required context。

## 6. v0.3.6 需要解决的问题

v0.3.6 应只回答 routing 层的问题：

1. 如何定义项目级 Routing Context Asset Pack，包括 asset id、type、defense claim、source of truth、loading behavior、scope。
2. 哪些 routing 信息进入 `compiled_core`，哪些下沉为 `on_demand_file`。
3. 如何把 `requirements.md`、`readiness.md`、`gap-analysis.md`、Metric View long-tail context 变成可追踪 routing pointers。
4. 如何输出可测试的 `routing_decision`，并让 v0.3.7 execution 只消费该 contract。
5. 如何记录 `project_files_read`，衡量 pointer compliance。
6. 如何让 release-pinned run 读取 frozen routing assets，而不是 draft files。
7. 如何建立 routing eval：NL prompt -> expected question family / source tier / entity / required assets。
8. 如何把 tool schema surface 和 enabled skills 纳入 routing budget。

不在 v0.3.6 解决：

- 执行 SOP、SQL 模板、suspicious result self-check；
- runtime validation 和 provenance footer；
- dedicated `query_metric_view` tool；
- adversarial reviewer；
- sliding-window history；
- deterministic golden-case fast path。

## 7. 后续文档

- [`design.md`](./design.md): v0.3.6 routing-first target design。
- [`action-plan.md`](./action-plan.md): routing Context Assets、routing decision、pointer compliance 和 eval 的实施计划。
- [`../v0.3.7/gap-analysis.md`](../v0.3.7/gap-analysis.md): execution 层 as-is baseline。
