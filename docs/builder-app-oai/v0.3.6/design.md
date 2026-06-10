# Context Engineering Design（v0.3.6 目标设计）

日期: 2026-06-08

本文承接 [`gap-analysis.md`](./gap-analysis.md)（现状 / as-is 基线），定义 `databricks-builder-app-oai` 在 v0.3.6 想要达到的 Context Engineering 目标状态。gap-analysis 记录的是「已经落地的实现」；本文记录的是「我们决定要做成什么样」，并逐条回应 gap-analysis 第 10 节列出的待澄清问题。下文出现的「as-is §x」均指 [`gap-analysis.md`](./gap-analysis.md) 的对应章节；落地任务拆解见 [`action-plan.md`](./action-plan.md)。

设计参照 `projects/distribution/data-agent-design.md` 中的分层 Context Engine 愿景，但做了一个关键收敛：**builder-app-oai 是跑在 OpenAI Agents SDK 上的通用多项目 agent，不是某一个场景的定制 ReAct runtime**。因此本文把那套愿景拆成「通用引擎能力」与「项目侧资产」两部分，只把通用、可测试、对所有项目都成立的部分纳入 v0.3.6。

本版还吸收了四份外部 Context Engineering 实践（详见 [`../../refer/nao-context-engineering.md`](../../refer/nao-context-engineering.md)、[`../../refer/dash-context-engineering.md`](../../refer/dash-context-engineering.md)、[`../../refer/how-anthropic-enables-self-service-data-analytics-with-claude.md`](../../refer/how-anthropic-enables-self-service-data-analytics-with-claude.md) 与 [`Inside OpenAI’s in-house data agent`](<../../refer/Inside OpenAI’s in-house data agent.md>)）：

- **nao** 贡献了：「CE 作为可度量学科（reliability/speed/cost，含查询执行成本）」「**瘦 prompt + 按需读取项目文件（orchestration）**」「MECE 单一规范定义」「数据正确性评测 + `tool_call_count` 信号」「范围纪律 ≤20/≤100」「证据门控的语义层决策」。
- **dash** 贡献了：「编译 vs 检索二分」「curated knowledge / discovered learnings 双层记忆」「写回闭环（写回项目知识）」「角色/工具分区控上下文」「资源层强制边界 > prompt 文字」。
- **anthropic**（官方实践博客，95% 业务查询自动化 / ~95% 准确率）贡献了：「**三种失败模式分类法**（概念↔实体歧义 / 数据陈旧 / 检索失败），技术栈每层只攻一种」「两个**负面结果**：LLM 自动生成语义层定义是净负面（→ Claude 写文档、人写定义）、对查询语料库做 raw 检索仅 <1% 提升（→ distill 成参考文档而非直读）」「**skill 漂移量化 + colocation/CI hook 维护**（无维护离线准确率 95%→65%/月；现 ~90% 模型 PR 同 diff 改 skill）」「**pairwise skills**（knowledge 路由 + unbook 流程）= 本文 orchestration 指针的外部背书」「**在线验证套件**：对抗式评审（+6% 准确 / +32% token / +72% 延迟）、provenance footer、被动监控（% 经语义层解析）、纠正收割」「**评测即遥测**（结果落数仓表带 skill 版本/SHA/model id → 捕捉缓慢回退）」「**per-domain go-live gate**（~90% 阈值才宣布可用）」。
- **openai**（官方实践博客，70k 数据集 / 600PB / 3.5k 内部用户）贡献了：「**代码派生的表语义**——表的真正含义在产出它的 pipeline 代码里，用 Codex 爬代码自动导出 grain/主键/新鲜度/排除项/同义表，区分"看着一样实则不同"的表」「**过度规约会变差**——僵硬的分步指令把 agent 推向错路，应给高层 guardrail + 信任模型推理（与本文 pre-rebutted 清单需划清"护栏 vs 菜谱"边界）」「**RAG-at-scale**——offline 聚合 usage+标注+代码富化→embeddings→运行时只取最相关上下文，是文件编排在表数超阈值后的毕业路径」「**工具整合**——重叠工具让 agent 困惑，少而清的工具集更可靠」「**自纠错启发式**——0 行/异常结果触发自查 join/filter 而非直接上报」「memory 全局/个人分级 + 显式"保存这条学习吗"提示」「**workflows = 复用指令集**（周报/表校验）印证 v0.4 golden cases」。

下文相关章节用「（借鉴 nao §x / dash §x / anthropic / openai）」标注来源。

## 0. 目标与非目标

v0.3.6 要解决的核心问题：当前 context 装配分散在 `server/routers/agent.py`、`server/project_config.py`、`server/services/skills_manager.py`、`server/services/system_prompt.py` 四处，靠字符串拼接和隐式字符上限（40,000 / 8,000）控制规模，既不可观测也不可测试。

**目标（in scope）**

1. 引入一个显式的 `ContextAssembler`，把上述四处的装配逻辑收敛成一条可读、可测的装配链路。
2. 把上下文按 as-is §10 提出的六层显式化：immutable / project / run / turn / observation / history。
3. 把每层的 token / 字符预算和截断策略变成代码里的常量与函数（**含工具 schema 这块常驻成本**），并加 snapshot / contract 测试。
4. 让 Distribution v0.3.5 已经产出的 `analysis_requirements`、`semantic_gap_analysis`、`readiness_summary`、以及 metric view 的 `business_terms` / `source_objects` / `validation.known_caveats` 能进入 agent 上下文——优先**下沉成项目文件 + orchestration 指针，由 `read_project_file` 按需读取**，而非全量编译进 prompt（见 §3/§7）。
5. 明确 `project_setting.yaml`、DB settings、release snapshot、AGENTS.md 与 P2 下沉上下文文件五者的 source-of-truth 与同步规则。
6. 清理 `next_moves.py` 双轨歧义。

**非目标（defer 到 v0.4 或更后）**

- 不改写 OpenAI Agents SDK 的执行循环，不自建 ReAct loop。
- 不强制为每个项目实现 `data-agent-design.md` 里那套 role/permission session（那是 Distribution 场景资产，不是通用引擎能力）。
- 不在 v0.3.6 强上「每轮 LLM intent 分类」；确定性 requirement matching 也**证据门控**——默认只发 orchestration 指针，matcher 仅当评测量出指针未遵从率超阈值才实现（见 §7.2）。
- 不替换 SDK 的 `SQLiteSession` 历史存储；history 压缩先做最小可观测版本（见 §8）。
- **不实现 v0.4 Golden Analysis Cases**——快速路径路由、answer contract、golden-case schema 都是 v0.4 工作（见 [`../v0.4-golden-analysis-cases/design.md`](../v0.4-golden-analysis-cases/design.md)）。v0.3.6 只**预留接口**、不做实现，避免本版抽象把 v0.4 堵死（见 §16）。

## 1. 设计原则

1. **每个 token 都有目的**：沿用 `data-agent-design.md` 的 CE 哲学——上下文不是越多越好，过量浪费 token 并放大幻觉。
2. **cache 友好优先**：保持 as-is 已有的「稳定前缀在前、易变内容在后」结构（`system_prompt.py:519-520` 的 stable shared prefix）。分层不能破坏跨项目 prompt cache 命中。这条与 memory 中「mind cross-project prompt cache」一致。
3. **渐进式，不推倒重来**：`ContextAssembler` 先包住现有 `get_system_prompt` / `build_project_context` / `render_project_skill_guidance`，再逐层下沉，不一次性重写。
4. **预算显式且可测**：字符上限不再散落在调用点，统一成 `ContextBudget`，并能在测试里断言「某层超限会被截断且留下可观测标记」。
5. **工具状态优先于 prompt 文字**：延续 as-is §4 的判断——workflow 约束应由工具状态（plan / conclusion / schema gate）承载，prompt 只做说明。
6. **瘦 prompt + 按需读取（借鉴 nao §3），理由是注意力而非 token 费用**：常驻 prompt 只放精简核心 + 指路（orchestration），细粒度上下文下沉成项目文件，由模型用 `read_project_file` 按需拉取。账要算对：在 prompt cache 下，稳定的编译内容首跑之后近乎免费（cache 读约 0.1x），而每次 JIT 读取是一次额外 turn（延迟）+ 全价 input token，且读进来的内容会随 history 在后续每一轮重复计费——多轮会话里一次按需读取的总 token 很可能高于编译。**瘦 prompt 的真正收益是注意力质量与工具选择准确率（少无关内容、少选错），不是省钱**。因此「小 + 稳定 + 普遍相关」的内容（已验证 MV 的 measures/dimensions/grain、pre-rebutted 清单、日期约定）必须留在编译侧，不得为了「体积下降」这个手段指标而下沉（判据见 §3；P2 验收以 pass rate / 整会话总 token / 时延为首要判据，见 §13）。
7. **成本含查询执行成本（借鉴 nao §1）**：CE 的成本不止 token——上下文不足会让 agent 跑探索性 schema 查询，既费 warehouse 又增延迟。「把 schema/口径放进上下文」与「省掉一次探索查询」要一起算账。
8. **MECE 单一规范定义（借鉴 nao §2）**：每个指标只有一个规范定义，跨 MV / 跨 raw table 不冲突；冲突会让模型静默给出不一致答案，必须可检测。
9. **三种失败模式作为防御目标（借鉴 anthropic）**：anthropic 把分析不准确归到三类——**概念↔实体歧义**、**数据陈旧**、**检索失败**——并让技术栈每层只攻其一。本设计据此自检每层的存在理由：L0/L1 的 metric_view_context + MECE 一致性（§7.1）攻**实体歧义**，§11 的评测 + §15 的维护流程攻**陈旧**，§7 的 orchestration 指针 + `read_project_file`（≈ anthropic 的 knowledge 路由 skill）攻**检索失败**。任何无法归到某个失败模式的上下文，都要质疑它是否在白占预算。anthropic 的核心论断也与原则 1/6 同向——**准确性是「上下文 + 验证」问题，不是 SQL 生成问题；实体一旦定准，执行与 SQL 就无足轻重**。
10. **护栏而非菜谱（借鉴 openai + anthropic）**：openai 发现**过度规约的 prompt 会变差**——僵硬的分步指令把 agent 推向错路；高层 guardrail + 信任模型推理更稳健。anthropic 同向（参考文档写「明确路由触发 + gotcha」，而非「会过时的死菜谱」）。据此给 §7 的 metric-view-first 与 pre-rebutted「别过早 fallback」清单划一条线：**可规约"约束与事实"（别跳过语义层、这张是规范表、这个口径坑、实体消歧），不可规约"执行路径"（第一步做 X、第二步做 Y）**。pre-rebutted 清单是护栏（理由 R 不构成跳过 MV 的借口），不是分步菜谱——加内容时守住这条边界，否则会悄悄退化成脆的 recipe。这条同时约束 §7.2 的 orchestration 段与未来的 golden cases（§16）。

## 2. 目标架构：显式 Context Engine

在 `OpenAIAgentRuntime` 调用 `Runner.run_streamed(...)` 之前，插入一个装配阶段：

```
AgentRunRequest
      │
      ▼
┌───────────────────────────────────────────────┐
│ ContextAssembler.assemble(request)             │
│                                                │
│  L0 immutable   ← 静态指令 + 工具规则 + 状态机   │
│  L1 project     ← project settings / skills /   │
│                   AGENTS.md / metric view ctx   │
│  L2 run         ← run_role / read_only /        │
│                   resource override / overrides │
│  L3 turn        ← 用户消息 + requirement match   │
│                   + 按需读取/检索的 MV 细节       │
│  L4 observation ← schema history seed + 工具结果 │
│  L5 history     ← SDK session（+ 压缩摘要）      │
│                                                │
│  每层经过 ContextBudget 裁剪 → AssembledContext  │
└───────────────────────────────────────────────┘
      │
      ▼
get_system_prompt(...)  +  Runner.run_streamed(input=..., session=...)
```

`AssembledContext` 是一个结构化对象（而非裸字符串），携带：每层渲染后的文本、每层实际 token/char 占用、被截断的字段清单。后两者用于可观测性与测试断言。

落地建议：新增 `server/services/context/` 包，至少包含 `assembler.py`（编排）、`layers.py`（六层渲染函数，多数从现有代码搬迁）、`budget.py`（`ContextBudget` 与截断器）。现有的 `system_prompt.py` 退化为 L0 渲染器，`project_config.py::build_project_context` 与 `system_prompt.py::_render_project_context` 合并为 L1 渲染器。

## 3. 上下文分层模型

把 as-is §2 的上下文来源映射到六层。注意：builder-app 的 L1 是「项目维度」而非 data-agent-design 的「用户 session 维度」，因为通用引擎里身份/权限是 per-request 的 Databricks auth，不进 prompt。

| 层 | 命名 | 稳定性 | 来源（as-is） | 装配主体 |
|---|---|---|---|---|
| L0 | immutable | 跨项目稳定（cache 前缀） | 角色、response format、plan 状态机、工具规则、workflow | `system_prompt.py` 固定段 |
| L1 | project | 同项目/同 release 稳定 | DB settings、skills 选择与 guidance、AGENTS.md、metric_view_context | `build_project_context` + skills_manager + operating_guide |
| L2 | run | 每次 run | run_role、read_only、resource override、conversation overrides、can_create_resources | `project_config` + `openai_runtime` |
| L3 | turn | 每轮（提问时装配） | 用户消息、requirement match、按需读取/检索的 MV 细节 | `agent.py` + 新增 matcher/retriever |
| L4 | observation | 轮内随工具调用增长 | schema history seed、工具调用结果 | `run_state` + `agent.py` |
| L5 | history | 跨轮 | SDK `SQLiteSession` + 压缩摘要 | `openai_sessions` + 新增 compressor |

> 六层一句话区分：L0 永不变 → L1 按项目 → L2 按这次 run → **L3 turn**（提问时根据问题装配的上下文）→ **L4 observation**（轮内工具调用累积的观察）→ L5 跨轮历史。L3 与 L4 都「每轮」，区别在于 L3 是提问时装配、L4 是执行中累积。

关键变化相对 as-is：

- **L1 增容**：把当前「保存进 settings 但没进 prompt」的 `analysis_requirements` / `semantic_gap_analysis` / `readiness_summary` 和 metric view 细粒度字段纳入 L1 的可选渲染（受预算约束、按需注入，见 §7）。
- **L3/L4 真正成层**：当前只有 observation 侧的 schema history seed（`run_state.seed_schema_inspections_from_events`）。v0.3.6 把 **L3 turn** 做实——加 requirement matching 结果与按需读取/检索的 MV 细节——并让 **L4 observation** 显式化（工具结果归属可观测）。
- **L5 可观测**：当前完全依赖 SDK session（黑盒），v0.3.6 让压缩摘要成为引擎产出的、可打印可测的对象。

**一个不在六层文本里、但同样吃 context 的表面：工具 schema。** OpenAI Agents SDK 会把每个启用工具的 name + description + JSON params schema 序列化进模型上下文，**每轮都在，无论是否被调用**。它不由 `ContextAssembler` 渲染，但它和 L0/L1 一样是「常驻前缀」的一部分，必须纳入预算与 cache 考量（见 §4.5）。技能 guidance（markdown）和技能带来的工具 schema 是**两笔独立成本**，as-is §7 只让我们看见前者。

**L1/L3 细节的交付方式：编译进 prompt vs 按需读取文件（借鉴 dash §1 + nao §3）。** 不是所有 L1/L3 内容都该编译进常驻 prompt。判据：**小 + 稳定 + 普遍相关 → 编译（compile）；大 + 条件相关 + 持续增长 → 按需取（retrieve）**。builder-app-oai 已具备「按需取」的全部零件——`read_project_file` 是 base tool（as-is §7），项目目录里已有 `requirements.md` / `gap-analysis.md` / `readiness.md` / `metric-view-context-engineering.md`（as-is §9）。因此 L1/L3 的细粒度部分（metric_view_context 细字段、requirements、sample_queries、known_caveats）应优先**下沉成项目文件 + 在 prompt 里留 orchestration 指针**，而非全量编译再靠预算截断。这条贯穿 §4 / §7。

## 4. Token 预算与截断策略

把 as-is 隐式的字符上限提升为显式预算。注意 builder-app 的 L0 远大于 `data-agent-design.md` 的 ~2000 token——它是通用 system prompt（约 600 行），所以**目标不是套用那张表的数值，而是先测量、再设上限、最后逐步压缩**。

```
ContextBudget（v0.3.6 初值，单位 char，后续切换为 token 计量）
  L0 immutable    : 测量后冻结为回归基线，禁止无意识增长
  L1 project      : skill guidance ≤ 40,000（沿用），AGENTS.md ≤ 8,000（沿用），
                    metric_view_context ≤ N，requirements/readiness ≤ M（新增）
  L2 run          : 小，基本不截断
  L3 turn         : 按需读取/检索结果 ≤ K
  L4 observation  : schema seed + 工具结果 ≤ K2
  L5 history      : v0.3.6 仅加可观测压缩摘要——SDK session 仍全量回放，
                    本版 L5 不减反增 token（见 §8）；滑动窗口 defer v0.4
```

截断规则：

- 每层有独立预算；超限时按字段优先级丢弃低优先字段，并在 `AssembledContext.dropped` 记录被丢字段名。
- **禁止静默截断**——任何因预算丢弃的内容必须在结构化输出里留痕，便于测试断言和线上排查（对应 as-is §10 Q3）。
- 预算用常量集中定义，测试可以注入小预算来验证截断行为。
- **优先下沉、再谈截断**：当某块内容触达预算上限，第一选择是按 §3 把它下沉成项目文件 + orchestration 指针（让模型按需 `read_project_file`），而不是直接截断丢弃。截断是兜底，不是常态。

**成本不止 token（借鉴 nao §1）。** nao 把 CE 成本量化为三维：reliability（% 答得出 / % 答对）、speed（时延）、cost（token + **查询执行成本**）。builder-app 当前只盯 token/char，漏了查询执行成本——上下文不足时模型会跑探索性 schema 查询（warehouse $ + 延迟）。我们的 schema gate（as-is §5）正是这一维的体现：它强制先查 schema 再写 SQL。nao 的进一步主张是「能放进上下文的 schema 就别让它运行时去查」。因此 `AssembledContext` 除了记录 token/char 占用，建议同时让评测侧采集 **`tool_call_count`** 作为「上下文是否充分」的代理信号（见 §11）。同理，§7 的 JIT `read_project_file` 也是一笔执行成本（一次额外 turn + 全价 token + 随 history 重复计费），评测侧应把**文件读取次数**与 `tool_call_count` 一起采集，验证「下沉的净收益为正」而非只看 prompt 体积。

### 4.5 工具与技能表面的上下文成本

这是 as-is 没有量化、但实际占用可观的一块。工具集由两部分组成（`databricks_openai.py`）：5 个 typed wrapper + 从 `databricks-mcp-server` 动态加载、再按技能过滤的 generated FastMCP 工具。SDK 把每个启用工具的 schema 常驻进上下文，**与技能数量正相关**：

- `BASE_TOOL_NAMES`（9 个，`skills_manager.py:21`）始终在；其余工具由 `SKILL_TOOL_MAPPING` 按启用技能解锁（`filter_openai_tools_by_skills`，`skills_manager.py:138`）。
- 多数 generated 工具是**多路复用的 `manage_*` 工具**（`manage_uc_objects` / `manage_jobs` / `manage_metric_views` …），单个工具的 description + JSON schema 往往很大，因为它在一个工具里塞了多种 operation。启用 `databricks-unity-catalog`（约 11 个工具）或 `databricks-scenario-onboarding`（约 13 个工具）会一次性把十几份 schema 压进每轮上下文。

由此得到三条 v0.3.6 的 context-engineering 决定：

1. **把工具 schema 纳入 `ContextBudget`**：测量「base + 每个技能解锁的工具」的 schema char/token 占用，作为冻结基线（同 L0 处理）。一个技能值不值得默认开，要连同它的工具 schema 成本一起看，而不只看 SKILL.md 长度。
2. **技能选择就是上下文工程**：`filter_openai_tools_by_skills` 不只是权限白名单，它直接决定常驻 schema 体积。少开一个技能 = 少十几份 schema = 更小上下文 + 更高工具选择准确率（工具越少越不容易选错）。因此「按 requirement / 项目类型收敛默认启用技能」本身是一项 CE 手段（呼应 as-is `Conditionally inject skill sections by project metadata` 的方向）。**openai 的 lessons 印证此点**：早期暴露全量工具导致"重叠功能让 agent 困惑"，他们靠整合/限制工具提升可靠性。但要注意方向——这里的杠杆是"减少进上下文的**不同**工具数"（技能收敛），**不是**把工具合并成更大的 `manage_*`：后者正是本节 schema 膨胀的来源，越合并单个 schema 越大。
3. **JIT 工具暴露（defer 评估）**：理想态是只暴露本轮可能用到的工具，但 SDK 的工具集在 run 开始即固定、且影响 prompt cache 前缀。v0.3.6 **不做**逐轮动态工具集；先做「按项目/release 收敛技能集」这一粗粒度版本，逐轮 JIT 暴露作为 v0.4 的待评估项（需权衡 cache 命中损失）。

排序约束：工具 schema 属于常驻前缀，必须和 L0 一样放在 cache 友好的位置；按项目变化的技能集应稳定到「同项目/同 release 内不抖动」，否则破坏跨轮 cache。

## 5. Prompting Contract

保持 as-is §3 的整体形状与 cache 前缀策略，只做四点收敛：

1. **顺序契约固化**：L0 在前、L1/L2/L3/L4/L5 在后的顺序写成测试可断言的契约（snapshot test），防止有人无意中把易变内容挪到前缀里破坏 cache。
2. **L1 可选段显式开关**：`metric_view_context` 的细粒度字段、`requirements` / `readiness` 走「按需注入」开关，由 §7 的 requirement match 决定是否渲染，而不是无条件全量拼接。
3. **职责边界保留**：`project_setting.yaml` / `Project Management Context` / AGENTS.md 三者职责说明（`system_prompt.py:240-241`）保留并对齐 §9 的 source-of-truth 规则。
4. **读改 prompt 走同一入口**：`server/routers/config.py::get_system_prompt_endpoint` 与运行时走同一个 `ContextAssembler`，保证「预览的 prompt」与「实际跑的 prompt」一致。

## 6. Workflow Contract

不改 as-is §4 的核心结论：workflow 由工具状态约束，而非纯 prompt。v0.3.6 把它写成显式契约：

- `update_plan` 状态机：`create → start → tools → finish → conclusion`，重复 create 返回 `plan_already_exists`，重复 conclusion 返回 `conclusion_already_submitted`（`plan_tools.py:84,168`）——保留。
- Databricks tool gate：无 plan / 无 active step 时拒绝并给出 actionable error（`run_state.py:147-177`）——保留。
- SQL schema gate：引用 `schema_required_tables` 但本会话未做 schema inspection 时拒绝（`run_state.py:282-310`）——保留，并把 gate-exempt 前缀（`describe` / `desc` / `show columns` / `show create table`）写成单一可测常量。
- **read-only 应下沉到资源层（借鉴 dash §6）**：as-is §7 的 read-only preview 靠 `_is_read_only_sql` 正则前缀匹配（`databricks_openai.py`），属于「prompt + 字符串守卫」，理论上可被构造绕过。dash 把只读约束压到 Postgres 事务级（`default_transaction_read_only`），是更硬的保证。但 Databricks SQL warehouse **没有等价的语句级只读事务**，现实候选只有两个：① 给 preview run 配一套仅含 `SELECT` 的 UC grant；② 用单独的低权限 service principal 跑 preview。两者都需要第二份 scoped 凭据，与 builder-app 的 per-request 用户 token pass-through 模型直接冲突——这正是可行性评估（P3-BE-3）要回答的核心问题。同时承认 pass-through 本身已是一层缓解：agent 永远不可能越过当前用户自己的权限。v0.3.6 至少在 §11 加「绕过尝试」用例守住正则这一层。
- 新增契约测试：plan 状态机、schema gate、read-only allowlist（含绕过尝试）各加 contract test（对应 as-is §10 Q10）。

## 7. Metric View 上下文与按需装配

这是 v0.3.6 让 Distribution v0.3.5 资产真正发挥作用的关键。

**组织原则：瘦 prompt + orchestrated `read_project_file`（借鉴 nao §3 + dash §1）。** 本节所有「细粒度上下文」默认走 §3 的「按需取」路线，而非全量编译进常驻 prompt：

- 常驻 prompt 只保留**精简指针 + orchestration 段**——例如「KPI / 口径 / fallback 类问题，先 `read_project_file('metric-view-context-engineering.md')`；某 requirement 命中时读对应 MV 的细节文件」。
- 细粒度内容（metric_view_context 细字段、requirements、readiness、sample_queries、known_caveats）**下沉成项目文件**，模型按需用 `read_project_file` 拉取。
- 这比「先建 requirement matcher 再决定渲染开关」更轻：**orchestration 指针 + 模型已有的 `read_project_file` 就能完成 JIT 拉取**；requirement matching（§7.2）退化为「自动决定该读哪个文件」的增强，而非前置条件。
- 同时压三笔成本：L1 guidance、L3 注入、以及 §4.5 的工具 schema 常驻成本（prompt 瘦了，cache 更稳）。
- **编译核心不下沉**：已验证 MV 的 full_name / status / grain / measures / dimensions、pre-rebutted 清单、日期约定属「小 + 稳定 + 普遍相关」，**留在 L1 编译侧**——metric-view-first 的 happy path 不该花一次读取 round-trip（成本账见原则 6）。下沉的只是细粒度长尾：business_terms 全文、known_caveats、sample_queries、requirements / readiness 细节。
- **指针遵从必须可验证（原则 5 对本节的自洽要求）**：orchestration 指针是 prompt 文字，模型完全可能不读文件就作答——这正是原则 5「工具状态优先于 prompt 文字」警告的形态。因此 `run_state` 要像 `agents_md_read` 一样跟踪 **`project_files_read`**，评测加断言「KPI/口径类 case ⇒ trace 含对应文件的 `read_project_file`」并采集**指针未遵从率**（见 §11.15）。没有这个信号，无法区分「下沉有效」与「模型没读、评测碰巧通过」；它同时是 §7.2 matcher 的证据门控输入。
- **pre-rebutted「别过早 fallback」清单（借鉴 anthropic skill 骨架）**：metric-view-first 的 orchestration 段除了「先读哪个文件」，还应内联一小段「**不要以下列理由 fallback 到 raw SQL**」——anthropic 的 warehouse skill 把这组预先反驳列为独立段（"需要自定义日期窗 → 时间维度已覆盖"、"需要 join → 指标层已封装其 join"、"需要 cohort → segment 已定义" 等），它是「metric-view-first 真正被执行、而非被模型一句话绕过」的关键。这块小而稳，编译进 L1（不下沉），与 memory 中「metric-view-first 是核心准确率规则」一致。

下面 7.1–7.4 描述「下沉/注入哪些内容、按什么规则」。

**7.1 完整利用 metric_view_context（as-is §10 Q5）**

当前 `_format_metric_view_context`（`system_prompt.py:50-92`）只渲染 full_name / status / grain / measures / dimensions / `validation.direct_sql_ref` / `validation.checked_at`。v0.3.6 增加：

- `business_terms`：用于同义词/口径映射，帮助模型把用户口语映射到 measure/dimension。
- `source_objects`：fallback 到 raw table 时知道去哪张表。
- `validation.known_caveats`：让模型在回答里主动披露口径限制。

这些字段**默认下沉成文件、由 orchestration 指针引导按需读取**（见本节组织原则；matcher 落地后升级为自动路由，§7.2），常驻 prompt 只留指针。

此外补两类 nao 验证过的内容：

- **日期 / 周期约定段（借鉴 nao §4，Date filtering 一等公民）**：nao 的六段式 RULES.md 把「周边界（周一/周日）、当前周期是否计入、last X 周/天/当月的规范写法」作为独立一等段——这正是时间相关问题答错的高频歧义，而 Distribution 这类按月（202604）分析尤其吃它。当前 `_render_project_context` 没有这一段，建议加入 `build_project_context` 的渲染清单（小、稳定、普遍相关 → 编译进 L1）。
- **MECE 一致性（借鉴 nao §2）**：渲染 metric_views 时保证「每个指标只有一个规范定义」。若两个 MV 或 MV 与 raw table 对同一指标口径冲突，要在装配期可检测（见 §11 的 MECE test），而不是让模型静默二选一。
- **不让 LLM 自动生成 MV 定义（借鉴 anthropic 负面结果）**：anthropic 试过用 LLM 从 raw table + 查询日志自动 bootstrap 语义层定义，结果在评测上**净负面**——它把我们正要消除的歧义编码进了「看似合理」的定义里。结论：**用 Claude 生成 metric view 的文档/描述（business_terms、caveats、字段说明），但 measure/dimension 的口径定义由人负责**。这条约束 §7.4 的写回闭环（写回只能是验证过的查询/文档，不能是新口径定义）以及未来任何「自动建 MV」的设想。
- **代码派生的 MV/表语义（借鉴 openai）**：openai 的核心论断——表的真正含义在**产出它的代码**里：pipeline 逻辑携带 schema 与查询日志都看不到的假设、新鲜度保证、排除范围、业务意图，因此他们用 Codex 爬代码自动导出每张表的 purpose / grain / 主键 / 同义表 / freshness，专治"两张看着一样的表到底差在哪、该用哪张"。对 builder-app：上一条要的那批文档（`business_terms` / `source_objects` / grain / `known_caveats`）不必全靠人手写——可用一次 **offline Codex/Claude 过程爬产出该 MV 的 transform 代码（SDP/DLT pipeline、dbt 模型、notebook）自动导出草稿，再交人校验**（口径定义仍由人定，见上一条）。这把 anthropic 的"colocate（文档放在代码旁）"从被动升级为主动——不只是放在一起，而是**从代码反推语义**。落地属增强项（P2 之后），不阻塞主链路。

**7.2 Requirement matching：证据门控的增强，不是 P2 前置（as-is §10 Q6）**

§7 组织原则已承认：orchestration 指针 + `read_project_file` 不依赖 matcher 就能完成 JIT 拉取，matcher 只是「自动决定读哪个文件」的增强。把 §7.3 对 `query_metric_view` 的证据门控纪律**用到 matcher 自己身上**：

- **v0.3.6 默认只发 orchestration 指针**（P2），用 §11.15 采集**指针未遵从率**（KPI 类 case 中 trace 缺对应 `read_project_file` 的比例）与 `tool_call_count`。
- **仅当证据显示模型确实漏读**（未遵从率超阈值）才实现确定性 matcher：关键词 + 配置映射，利用 `requirements.md` 的 P0/P1 问题族（A1/A5/A2/F3 等）与其 required assets / measures / dimensions，命中后把相关 MV 细粒度上下文注入 L3。
- 要求门控的原因不只是省工——matcher 有两个固有风险：关键词匹配对**多语言提问**（Distribution 的问题可能以中/日/英文及任意改述到达）天然脆弱；**误命中注入错误 MV 细节**正是 openai 警告的「僵硬指令把 agent 推向错路」（原则 10）。
- 每轮 LLM intent 分类 defer 到 v0.4（对齐 `data-agent-design.md` §6.1 的「快速路径 + LLM 兜底」）。

注意**技能集收敛与 matcher 无关、P2 即做**：一个分析型 Distribution 项目通常只需 `databricks-analysis` 这类少量技能，不必默认开 UC / jobs / vector-search 等重 schema 技能（§4.5 第 2 点）。按项目类型选技能 = 同时控住 L1 guidance、L3 注入、和工具 schema 三笔成本。

**为 v0.4 golden cases 预留（见 §16）**：v0.3.6 只**定义命中对象的接口形状**、不实现匹配逻辑——matcher 若落地，输出必须是结构化的「命中对象」（命中的 requirement id + 该读哪些文件 + 注入哪些 MV 细节）而非 bool，命中规则**数据驱动**（来自项目配置/文件），不硬编码进代码。这样 v0.4 的「match golden case → 跑 canonical Metric View path」只需在「命中对象」上挂 canonical path / answer contract，而不必重写匹配层。

**7.3 是否引入 `query_metric_view` 工具（as-is §10 Q7）**

as-is §5 指出当前没有专门工具，MV 仍靠模型手写 SQL。`data-agent-design.md` §4.1 设想了 `query_metric_view`。

v0.3.6 **决定：先不引入新工具**，原因——schema gate + Metric View first 的 prompt policy 已能约束行为，新工具会增加跨项目复杂度。改为：在 L3 注入「MV 查询模式模板」（`data-agent-design.md` §6.3 的思路）作为上下文，让模型基于模板写 `MEASURE(...)` SQL。是否落地专用工具 deferred 到 v0.4，依据 Distribution 评测里手写 SQL 的错误率再定。

**这条决定有外部背书（借鉴 nao §6）**：nao 的 `add-semantic-layer` 技能明确——语义层 / 专用查询通道是「会缩小可回答问题范围」的约束，**只在 `nao test` 证明 metric 可靠性失败后才上**，schema 缺失或日期逻辑错误属于规则修复、不是语义层修复。即「是否引入专用 MV 通道」应是**证据门控**的：先用评测（§11）量出手写 SQL 的 metric 不一致率，达到阈值再引入，而非预先加约束。

**7.4 双层知识与写回闭环（借鉴 dash §2/§3，v0.3.6 设计、落地可滑到 v0.4）**

dash 把记忆分成两层：**curated knowledge**（人写的事实：schema、口径、规则）和 **discovered learnings**（agent 跑数据踩到的坑：类型、口径偏差、修复），并用 `update_knowledge` / `save_validated_query` 形成写回闭环——Engineer 建视图后写回，Analyst 下次检索命中并优先复用。

对照我们：builder-app 当前只有 curated 一侧——`known_caveats` / `approved_memory` / `sample_queries` 都是人写进 settings 的（as-is §3），**缺「发现侧」沉淀**。v0.3.6 的设计方向：

- 区分 curated（项目 settings / 文件）与 discovered（运行时沉淀）两类知识，渲染时分别处理。
- 让「验证通过的 MV 查询 / 口径修正」能写回项目知识（文件或 settings），喂养 §7 的按需读取——这比引入 `query_metric_view` 更轻，且与 as-is 的 `approved_memory` 衔接。
- 写回需带校验（只读、单语句），与 §6 read-only 思路一致（dash 的 `save_validated_query` 即只允许 `select`/`with`、禁多语句）。
- **distill 优先于 raw 检索（借鉴 anthropic 负面结果）**：anthropic 给 agent 对数千历史查询的 raw grep 权限，准确率提升 **<1%**——信息在、agent 也确实读了，但无结构的检索无法把新问题映射到正确先例（瓶颈是**结构**不是**访问**）。因此 discovered-learnings 的写回**不是把原始查询堆给模型直读**，而要 distill 成结构化、分领域的参考片段（与 curated 同构），再走 §7 的按需读取。这把「写回闭环」从「攒数据」校正为「攒结构」。
- **纠正收割 +「无聊」修复路径（借鉴 anthropic）**：闭环的输入端可学 anthropic——一个定时任务扫描会话里的纠正性措辞（"用错表了"、"漏了欺诈过滤"），为对应参考文档起草一行修复并开 PR；修复路径刻意做「无聊」（改 markdown → 合并 → 自动同步到各界面），降低领域所有者的维护成本；同一批纠正同时回流进 §11 的离线评测集。
- **memory 全局/个人分级 + 显式保存提示（借鉴 openai）**：openai 的写回是交互式的——发现纠正/学习时**提示用户"保存这 N 条学习吗"**，且 memory 分**全局**（跨用户的规范修正，如某指标的 top-level 口径）与**个人**两级、均可手工编辑。对照我们：discovered-learnings 写回须区分"该回流成项目级规范知识（全局）"与"仅本人偏好（个人）"，避免把个人口径污染项目规范层；保存动作带用户确认而非静默写入。openai 点名 memory 的目标——**保留那些对数据正确性关键、却从其他层难以推断的"非显然"修正/过滤/约束**（其例子正是 anthropic 的实验门 string-match 同款），与 §7.4 的 discovered 侧定位一致。

落地优先级低于 7.1–7.3，可作为 P4 / v0.4 项。

## 8. History / 压缩层

当前完全依赖 SDK `SQLiteSession`（as-is §6），app 层没有可观测的压缩或滑动窗口。

v0.3.6 最小可观测版本：

- 保留 SDK session 作为原始历史存储，不替换。
- 在 `ContextAssembler` 里新增 L5 渲染：当历史轮数超过阈值（如 5 轮，对齐 `data-agent-design.md` §2.6），生成「问题摘要 + 关键数据 + 结论 + active filters」的压缩摘要，作为可打印对象进入 `AssembledContext`。
- 压缩摘要优先复用已有的 `synthesis.appended.summary`（as-is §6 已用于 DB assistant answer），避免再起一次 LLM 调用。

**明确预期：本版 L5 是纯可观测性投入，不省 token——反而略增**。SDK session 仍全量回放历史，压缩摘要叠加其上；token 削减要等 v0.4 的 sliding-window assembler 真正替代全量回放后才发生。§4 预算表的 L5 行已按此口径标注，避免误读成「本版已有压缩收益」。

完整的 sliding-window assembler（替代 SDK 黑盒历史）defer 到 v0.4。

## 9. Source of Truth 与同步规则（as-is §10 Q8）

明确五者关系（含 P2 引入的下沉上下文文件），写进 prompt 职责段并加测试：

| 物件 | 角色 | 写入时机 | 读取时机 |
|---|---|---|---|
| `project_setting.yaml` | 用户可读的**编辑源** | 用户保存设置时 | 保存时同步到 DB；**run 时不直接重读**（as-is §2） |
| DB settings | run 时的**事实源** | `project_settings.py` 从 YAML 同步 | 每次 run 由 `build_project_context` 读取 |
| release snapshot | user/preview/viewer 的**冻结源** | 发 release 时 | `run_role` 命中时用 `current_release_id` 的 snapshot |
| AGENTS.md | **机制指南** snapshot | 编辑时 | **每次 run 生成 prompt 时从磁盘重读**（`load_project_operating_guide`），≤8,000 char；prompt 契约让模型会话内不主动重读（`system_prompt.py:242-243`）。注意：prompt 措辞「start of the chat」与实际 per-run 重读不一致，本版对齐（改措辞或按 conversation 缓存，二选一） |
| **下沉上下文文件（P2 新增，§7）** | L1/L3 细粒度上下文的**按需载体** | **derived 类**（MV 细字段等）：保存设置时从 DB settings 物化，物化是**唯一写路径**，禁止手改；**authored 类**（`requirements.md` / `readiness.md` 等）：人工编辑 | run 时经 `read_project_file`；**release-pinned run 必须解析到 release 冻结版本，不得读 draft 工作区** |

规则一句话：YAML 是人编辑的源，DB 是 run 的源，release snapshot 是被预览者看到的冻结源，AGENTS.md 只讲机制不放项目数据，下沉文件是 settings 的按需载体、随 release 冻结。

**第五行是 P2 的前提，不补会让 release pinning 泄漏**：细粒度上下文一旦从 settings 下沉成文件，就逃出了 settings snapshot 机制——viewer 钉在 release N 上，`read_project_file` 却读到 draft 工作区的文件，被下沉的恰恰是最关键的口径/caveat 内容。三条约束：

1. **derived 文件单一写路径**：从 settings 物化生成（保存设置时重新生成），禁止手改，避免文件与 settings 分叉——否则 §11.7 要防的 MECE 冲突会在「settings vs 文件」之间重演。
2. **release 冻结覆盖文件**：发 release 时把项目文件（derived + authored）一并 snapshot；release-pinned run 的 `read_project_file` 解析到冻结版本。§11.6 的 release-pinned 测试必须覆盖**文件读取路径**，不只覆盖 settings。
3. **新项目的文件来源**：Distribution 的 authored 文件是手写的；通用引擎要么由 onboarding 流程生成初稿（参照 §7.1 代码派生），要么允许缺省——指针指向不存在的文件时**降级为编译态渲染**，不报错。

## 10. next_moves 决策（as-is §10 Q9）

as-is §8 确认：`server/services/next_moves.py` 仍在仓库，前端仍引用 `next_moves.updated`，但 `server/routers/agent.py` 已不再发起独立的 post-response Next Moves 调用，follow-up 实际来自 `submit_conclusion.next_steps`。

v0.3.6 **决定：删除死代码路径**——移除 `next_moves.py` 的运行入口与前端对 `next_moves.updated` 的处理，统一到 `submit_conclusion.next_steps`。若未来要恢复独立 Next Moves，再以显式 feature 重新接入，避免双轨歧义。

## 11. 可测试性与 Contract Tests（as-is §10 Q10）

新增测试，全部基于 `AssembledContext` 这一可观测对象：

1. **prompt shape snapshot**：固定输入下 L0 前缀逐字稳定（保护 cache）。
2. **context rendering**：给定 settings，断言 L1 渲染出/未渲染哪些字段（含 §7 的按需注入开关）。
3. **budget / 截断**：注入小预算，断言超限字段被丢且记入 `dropped`，无静默截断。
4. **schema gate**：配置表被引用且无 inspection 时拒绝；gate-exempt 前缀放行。
5. **read-only policy**：preview run 下 SQL allowlist（`select/with/show/describe/desc/explain/values`）与工具裁剪生效；**新增「绕过尝试」用例**（如注释/大小写/前导空白构造的写操作）应被拒（借鉴 dash §6）。
6. **release-pinned context**：viewer/preview 走 snapshot 而非 draft。
7. **MECE 一致性（借鉴 nao §2）**：守住「每指标单一规范定义」，但**判定器要谦逊**——SQL 语义等价判定不可行，泛化的「冲突检测」会悄悄退化成只查重名而无人察觉。明确两级判定：**fail** = 同名 measure 出现在多个 MV 且表达式（归一化空白/大小写后）不一致；**warn** = glossary 词条与 MV measure 同名但定义文本不一致、或同一指标在 settings 与下沉文件（§9 第五行）两处内容不一致。
8. **数据正确性评测（借鉴 nao §5）**：除上述「上下文长什么样」的 snapshot/contract test 外，补一层「答案对不对」的评测——参照 `nao test`：NL prompt → agent 答案抽成结构化数据 → 同时执行 ground-truth SQL → **逐行 diff**（归一化、忽略行序、数值容差）。Distribution 的 validation slice（`readiness.md` 的 202604）可充当 ground truth。接入仓库已有的 `.test/` MLflow + GEPA 框架，不另起炉灶。注意 nao 的防泄漏规则：测试 prompt 要像真实聊天（别含表名/列名），输出列名编码单位而非来源。**评测 schema 设计成 golden-case 友好（见 §16）**：在 `{prompt, sql}` 之外预留 canonical MV path / answer contract 的扩展位，使 v0.4 golden cases 能直接成为本评测的主要用例来源，而不必另建一套评测。
9. **`tool_call_count` 作为上下文充分性信号（借鉴 nao §1/§5）**：评测时采集每个 case 的工具调用次数；次数偏高 = 上下文不足、做了探索查询，是「该把哪些 schema/口径下沉进上下文」的定位信号。

上述 1–9 偏「离线 / contract」。anthropic / openai 进一步把验证分到**在线**一侧，以下 10–14 是 v0.3.6 可低成本采纳的在线验证手段（15 回到离线侧）：

10. **provenance footer（借鉴 anthropic，字段从 trace 推导、禁止模型自评）**：每个最终答案带页脚——来源层级（语义层/MV › 治理表 › raw 探索）· 验证状态 · owner。**所有字段从 trace / settings 推导**：来源层级由已执行 SQL 判定（含 `MEASURE(` / MV 名 → 语义层，否则 raw），验证状态用 `metric_view_context.validation.status` + `checked_at`。**不让模型自报「置信度」**——那是误导性精确；新鲜度 `MAX(date)` 需每答案多跑一次查询，做成可选项。它不让答案更对，但让消费者判断可信度，是**静默失败**（答案错但看起来合理、无人反对地被采用）为数不多的缓解。小改动、可先于评测落地（呼应 anthropic skill 骨架的 "Report with provenance"）。
11. **被动监控信号（借鉴 anthropic，注意流量前提）**：上线后持续追两个生产指标——① agent 查询经语义层/MV 解析的占比，② 回答里出现纠正性措辞的占比——与离线 pass rate 一起每周评审。这两个信号是 §11.9 `tool_call_count` 之外的「线上是否在退化」探针，且喂养 §7.4 的纠正收割。**前提是有足够生产流量**：anthropic 的信号建立在数千查询/周之上；一个 builder-app 项目若每周只有几十次提问，「纠正性措辞占比」就是噪声。该项在项目有真实用户流量前 defer，先依赖离线评测 + §11.15 的遵从信号。
12. **评测即遥测 + per-domain go-live gate（借鉴 anthropic）**：§11.8 的每次评测结果落进一张数仓表（带 skill 版本 / git SHA / model id / 逐断言通过失败 / token / 墙钟），让「那个改动有没有帮助」成为一条查询，并捕捉单次 CI 看不见的 **slow regression**（对照 anthropic 的 95%→65% 漂移）。某领域评测清过阈值（初始 ~90%）前，不对该领域 stakeholder 宣布 agent 可用（**go-live gate**），迫使参考文档修复发生在用户看到失败之前。
13. **对抗式评审作为可调成本旋钮（借鉴 anthropic + nao 证据门控）**：anthropic 量化出「激进质疑最终答案的全部底层假设」的 sub-agent 在其评测内 **+6% 准确**，代价 **+32% token / +72% 延迟**。是否对某领域默认开，按 §7.3 的证据门控——先用 §11.8 量出收益再决定，而非预先强开；anthropic skill 骨架把它列为 MANDATORY，但那是其高 stakes 场景的取舍。这条与 anthropic「如何起步」一节的风险问句「你愿意为提升准确率花多少钱」一致。
14. **可疑中间结果自查（借鉴 openai）**：openai 的 agent 遇到 0 行/异常结果会**自查 join/filter 再重试**，而非直接上报错误数字（把迭代从用户移进 agent）。把这组"可疑信号"显式化为在线自纠错触发器——**0 行、null 暴增、相邻周期突然 10×、聚合后行数=1**——命中时先回查 schema/过滤再给结论。多数由 SDK 执行循环承载，但触发器值得写进 unbook 式 workflow 并与 §6 schema gate 配合；它也是 §11.11 被动监控"纠正性措辞"信号的运行时前置。

补一条离线侧（与 1–9 同属评测/contract）：

15. **orchestration 指针遵从信号（§7 组织原则的自洽要求）**：`run_state` 跟踪 **`project_files_read`**（机制同 `agents_md_read`）；评测断言「KPI/口径类 case ⇒ trace 含对应文件的 `read_project_file`」，并采集**指针未遵从率**与文件读取次数。它区分「下沉有效」与「模型没读、评测碰巧通过」，同时是 §7.2 matcher 是否立项的证据门控输入。

## 12. 对 as-is §10 十个问题的逐条结论

| # | 问题 | v0.3.6 决定 |
|---|---|---|
| 1 | 是否引入独立 Context Engine | **是**，`ContextAssembler` + `server/services/context/`（§2） |
| 2 | 是否分层显式化 | **是**，六层 immutable/project/run/turn/observation/history（§3） |
| 3 | 预算与截断是否可测可观测 | **是**，`ContextBudget` + `AssembledContext.dropped`，禁止静默截断；并把工具 schema 纳入预算（§4 / §4.5） |
| 4 | 是否注入 requirements/gap/readiness | **是，但下沉成文件 + orchestration 按需读取**（`read_project_file`），requirement match 决定读哪个（§3/§7.2） |
| 5 | 是否完整利用 metric_view_context | **是**，新增 business_terms/source_objects/known_caveats，**并补日期约定段 + MECE 一致性**（§7.1） |
| 6 | 是否每轮 intent routing | **先只发 orchestration 指针**；确定性 matcher 证据门控（指针未遵从率超阈值才实现，接口形状先定义），LLM 分类 defer v0.4（§7.2） |
| 7 | 是否引入 MV 专用工具 | **先不引入**，改注入查询模板；**证据门控**，依评测 metric 不一致率再定（§7.3） |
| 8 | source-of-truth 与同步规则 | **明确**五件物（含 P2 下沉文件：derived 物化唯一写路径 + release 冻结覆盖文件）的角色与时机（§9） |
| 9 | next_moves 去留 | **删除死代码**，统一 conclusion next_steps（§10） |
| 10 | 是否加 contract tests | **是**，十类测试（含 MECE 两级判定、数据正确性、read-only 绕过、指针遵从）（§11）；**数据正确性评测基线提前到 P1，先于任何 prompt 内容改动**（§13） |

## 13. 分阶段落地

- **P1（引擎骨架 + 评测基线）**：建 `ContextAssembler` + `AssembledContext` + `ContextBudget`，把现有四处装配搬进来但行为不变；**测量 base + 各技能解锁工具的 schema 占用并冻结为基线**；补 prompt shape snapshot 与 budget 测试。**并行接入 `.test/` 数据正确性评测基线（§11.8，原 P3 项提前）——它不依赖 P2，只需 Distribution 202604 ground truth；必须先于 P2 存在，否则 P2 没有回归对照组（Measure → Iterate 不能只引用不执行）**。这一阶段对外行为零变化，纯重构 + 可观测。
- **P2（瘦 prompt + 按需读取）**：把 metric_view_context 细字段 / requirements / readiness **下沉成项目文件**，prompt 改为精简指针 + orchestration 段（依赖已有 `read_project_file`）；下沉文件纳入 §9 第五行契约（derived 物化唯一写路径 + release 冻结覆盖文件）；`project_files_read` 遵从跟踪（§11.15）；补**日期约定段**进 `build_project_context`；requirement matcher 只定义命中对象接口形状（实现证据门控，§7.2）。**验收以 P1 评测基线对照的 pass rate / 整会话总 token / 时延为首要判据，prompt 体积下降只是手段指标**。
- **P3（清理与契约 + 评测扩展）**：删除 next_moves 死路径；schema gate / read-only（含绕过尝试）/ release-pinned（**含文件读取路径**）/ **MECE 两级判定** contract tests；扩展 P1 评测基线（遥测表 + go-live gate）并持续采集 `tool_call_count` + 文件读取次数；source-of-truth 规则写入 prompt 职责段。
- **P4（history 压缩 + 写回闭环）**：L5 压缩摘要复用 `synthesis.appended.summary` 进入 `AssembledContext`；discovered-learnings 写回闭环（§7.4，可滑到 v0.4）。

P1–P3 为 v0.3.6 主体，P4 可视进度滑到 v0.3.7 / v0.4。范围纪律与上下文质量基线见 §15。

## 14. 与 Distribution 的对齐

- Distribution v0.3.5 的 `requirements.md` / `gap-analysis.md` / `readiness.md` 是 §7 requirement matching 与 §4 按需注入的**数据源**，无需重做。
- MV1/MV2/MV3 已 validated（`readiness.md`），是 §7 注入 metric_view_context 的首批受益对象；MV4/MV5 仍 candidate/deferred，按 status 渲染 fallback 提示。
- `metric-view-context-engineering.md` 的 Metric View first runtime policy 与本文 §6/§7 一致，作为 prompt policy 来源。
- 提醒：`data-agent-design.md` 的 role/permission session、`resolve_entity`、`get_user_scope` 等是 **Distribution 场景资产**，不纳入 v0.3.6 通用引擎；通用引擎只保证「能把项目侧资产按层、按预算、按需装配进 prompt」。

## 15. 上下文质量基线与范围纪律（借鉴 nao §6/§7）

nao 把「上下文质量」做成可审计的 rubric，并反复强调一条高杠杆规则：**范围过大是可靠性失败的头号预测因子**（playbook / audit-context）。两条可直接采纳：

- **范围纪律**：单项目 input_tables + metric_views 控制在 **≤20 理想 / ≤100 硬顶**，优先 gold / mart 层。onboarding 与项目审计在超限时显式告警并建议收敛。这是零成本、高回报的可靠性手段，builder-app 当前没有这层约束。
- **超阈值的毕业路径（借鉴 openai）**：硬顶之上，§3 的文件编排（`read_project_file` 指针）不再够用——openai 在 70k 数据集规模上用 **offline 聚合（usage + 人工标注 + 代码富化）→ embeddings → 运行时 RAG 只取最相关上下文**，而非扫描原始 metadata。因此 §3「编译 vs 检索」的"检索"侧在项目表数突破硬顶时应从"文件指针 JIT 读取"升级为"embedding 检索"。v0.3.6 仍只做文件编排（小项目足够），把 embedding-RAG 标为**表数超 ≤100 硬顶才启用**的明确毕业项（v0.4+）；范围纪律因此一身两用——既是可靠性手段，也是"何时该换检索机制"的触发线。
- **上下文审计 rubric（诊断与修复分离，借鉴 nao `audit-context`）**：提供一个对单个项目 context 的检查清单——同步状态与范围、Project Management Context 各段 present/missing/thin、逐 MV/表覆盖、**MECE 一致性**、测试覆盖与失败归类、token 优化（>40KB 文件、重复内容）。审计只诊断、不直接改，每个发现路由到对应修复动作。这套 rubric 也是 §11 评测的补充。
- **skill/参考文档维护当一等工程（借鉴 anthropic）**：anthropic 观察到无主动维护时离线准确率 **95%→65%/月**——描述「每天都在变的数据模型」的文档会迅速腐烂。机制有二：① 把 skill / 参考文件**与 transform 模型 colocate 在同一仓库**，让「改模型的那个 PR 就是改描述它的文档的那个 PR」；② 加一个 **code-review hook，标记「改了报表模型却没碰对应 skill/参考文件」的 diff**（anthropic 现已做到 ~90% 模型 PR 同 diff 带 skill 改动）。对 builder-app 的落点：当项目侧资产（`requirements.md`/`readiness.md`/MV 文件）与 Distribution transform 同库时套用此 hook；§9 的 source-of-truth 同步规则是其前置，§7.4 的纠正收割是其运行时补给。这也呼应 anthropic「如何起步」的克制原则——**不要为弥补当前模型的不足而过度堆基础设施**，模型变强后这些投入会变多余；优先做少数规范数据集 + 几十条评测 + 一个薄 knowledge skill。

## 16. 为 v0.4 Golden Analysis Cases 预留的设计接口

v0.4 的 **Golden Analysis Cases**（见 [`../v0.4-golden-analysis-cases/design.md`](../v0.4-golden-analysis-cases/design.md)）把高频问题族映射到一条 canonical path：question triggers → 已认证 Metric View 数据路径 → direct SQL 校验 oracle → answer contract → eval expectations，并在匹配命中时走「快速路径」而非自由规划。

**外部背书（借鉴 openai）**：openai 上线后观察到用户反复跑同一批分析，于是把高频重复分析**打包成可复用指令集（workflows）**（如周业务报表、表校验），"把上下文与最佳实践编码一次"以保证跨用户一致——这正是 golden cases 的同构物，印证本方向。注意它也要受原则 10 约束：workflow/golden case 编码的是"约束 + 认证数据路径 + 期望"，不是会过时的分步死菜谱。

**为什么现在就要考虑**：v0.3.6 引入的几个抽象**正好是 golden cases 将来要坐的底座**。如果现在不留接口，v0.4 会被迫重写匹配层、orchestration 和评测。所以本版的原则是——**预留接口、不做实现**，golden cases 本体（fast-path 路由、answer contract、golden-case schema）仍在 v0.4 落地。

五个对接点（v0.3.6 负责把抽象做成 golden-case-ready，v0.4 负责填实现）：

| v0.3.6 抽象 | v0.4 golden cases 怎么用 | v0.3.6 需保证的接口形状 |
|---|---|---|
| requirement matcher（§7.2，证据门控） | match golden case → 跑 canonical path | v0.3.6 只定义**结构化命中对象**的 schema（requirement id + 读哪些文件 + 注入哪些 MV 细节），数据驱动、非 bool、非硬编码；匹配逻辑待证据 |
| orchestration + `read_project_file`（§3/§7） | golden case = 一个结构化项目文件，承载 required context / canonical MV path / answer contract | 复用同一套「指针 + 按需读取」，文件格式可扩展出 golden-case 段 |
| `AssembledContext` L3（§2/§3） | 把命中的 golden case 作为一类 turn-context 输入 | L3 预留一个「golden_case」槽位，将来加入不重排层、不破 cache 前缀 |
| 数据正确性评测（§11.8） | golden case 的 eval expectations / direct SQL oracle | 评测 schema 在 `{prompt, sql}` 外预留 canonical MV path / answer contract 扩展位 |
| Metric-View-first + fallback（§6/§7） | golden case 的「认证 MV 为 happy path，direct SQL 为 oracle/fallback」 | 已对齐，无需改动 |

**红线**：v0.3.6 **不**写任何 golden-case 专属逻辑（不写 fast-path 路由、不定义 golden-case schema、不做 answer contract 执行）；只确保上述抽象的**输出形状**能被 v0.4 扩展。对应约束已落到 action-plan 的「跨阶段注意事项」。

## 17. 下一步文档

- [`action-plan.md`](./action-plan.md)：把 §13 的 P1–P4 拆成后端（context 包、budget、assembler、**项目文件下沉 + orchestration + §9 第五行文件契约**）、前端（删 next_moves.updated、保留 conclusion next_steps）、测试（§11 十类 contract test + `.test/` 数据正确性评测，**基线在 P1**）、文档（prompt 职责段、source-of-truth、范围纪律与审计 rubric）四类可执行任务。
