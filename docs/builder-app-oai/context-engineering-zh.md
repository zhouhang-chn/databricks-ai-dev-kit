# Context Engineering 总体设计（databricks-builder-app-oai）

日期: 2026-06-10 ｜ English version: [`context-engineering.md`](./context-engineering.md)

本文是 builder-app-oai Context Engineering（CE）的**顶层设计**：它回答「我们如何系统性地决定什么进入模型上下文、以什么形态、付出什么成本、用什么守住质量」。它不绑定具体版本——版本化的现状基线、目标设计与落地任务见文档地图。

## 0. 文档地图

| 文档 | 角色 |
|---|---|
| 本文 | 顶层理念、架构与路线，版本无关 |
| [`v0.3.6/gap-analysis.md`](./v0.3.6/gap-analysis.md) | 现状基线（as-is）：上下文来源、prompting、workflow、历史 |
| [`v0.3.6/design.md`](./v0.3.6/design.md) | v0.3.6 目标设计：六层模型、预算、按需读取、契约与评测 |
| [`v0.3.6/action-plan.md`](./v0.3.6/action-plan.md) | P1–P4 落地任务与验收 gate |
| [`v0.4-golden-analysis-cases/`](./v0.4-golden-analysis-cases/) | 高频问题族的 canonical path / answer contract（下一版） |
| [`../refer/`](../refer/) | 外部实践参照：nao、dash、anthropic、openai（见 §10 速查表） |

## 1. 问题定义：分析准确性是上下文 + 验证问题

与编码 agent 不同，数据分析问题通常**只有一个正确答案、对应一个正确来源**，且没有「测试天然护栏」。anthropic 的结论与我们的经验一致：**准确性不是 SQL 生成问题——把用户问题映射到正确实体之后，执行与 SQL 无足轻重**。绝大多数错误归于三种失败模式，CE 体系的每个组件都应能回答「我在防御哪一种」：

1. **概念 ↔ 实体歧义**：同一个业务词（"达成率"）对应多个看似可行的表/列/口径。防御：Metric View 语义层 + MECE 单一规范定义 + 业务术语映射。
2. **数据陈旧**：schema、口径、文档随业务漂移，答案开始细微出错。防御：维护流程（colocation、评测即遥测、纠正收割）。
3. **检索失败**：正确信息存在但 agent 找不到。防御：orchestration 指针 + `read_project_file` 按需读取（小规模）→ embedding 检索（超阈值后的毕业路径）。

无法归入任何一种失败模式的上下文，默认在白占预算。

## 2. 正确性与准确率如何保障：纵深防线

CE 的最终交付物是「答案是对的」。没有任何单一机制能独立保证这一点——anthropic 的实测：裸模型在其评测上只有 ~21% 准确率，叠加全栈防线后稳定在 95%+。正确性靠**五道防线叠加**，每道主攻 §1 的一种失败模式；本节是总览，机制细节见对应章节。

| # | 防线 | 机制 | 主攻 | 详见 |
|---|---|---|---|---|
| 1 | **资产**（问之前） | validated Metric View 语义层；MECE 单一规范定义；口径由人定义（不让 LLM 生成）；范围纪律 ≤20/≤100 | 实体歧义——把"几十个看似可行的候选"收缩成一个受治理的唯一答案 | §3/§5/§9 |
| 2 | **路由**（找答案） | metric-view-first + pre-rebutted「别过早 fallback」清单；orchestration 指针 + 遵从信号（`project_files_read`，确保模型真的读了规范来源） | 检索失败——答案存在但 agent 没找到/没用 | §5/§6 |
| 3 | **执行**（写查询） | schema gate（先看 schema 再写 SQL）；日期/周期约定段（周边界、当前期是否计入——时间类问题的高频错因）；可疑中间结果自纠错（0 行 / null 暴增 / 相邻周期 10× / 聚合后行数=1 时先回查再下结论） | 正确实体上的错误操作（join/filter/日期窗错） | §6 |
| 4 | **披露**（给答案） | provenance footer（来源层级 · 验证状态 · owner，一律从 trace/settings 推导、禁模型自评）；fallback 必须先披露状态与理由；区分 observation（"数据显示 X"）与 interpretation（"这暗示 Y"） | 静默失败的消费侧缓解——答案错时让消费者有判断依据 | §6/§8 |
| 5 | **度量**（系统级） | 数据正确性评测（ground-truth SQL 逐行 diff，不是 LLM judge 打分）；per-domain go-live gate（~90% 前不宣布可用）；评测即遥测（时序捕捉漂移型回退）；被动监控 + 纠正收割回流评测集 | 陈旧 + 整体回归——知道自己现在到底多准 | §8 |

四条配套判断：

- **防线必须在系统侧，不能指望用户**。自助分析的最终用户不懂底层数据，无法替你验证答案——这是与「给数据科学家做工具」的本质区别，也是防线 4 存在的理由。
- **准确率是叠加出来的，不是某一层给的**。第 1 道防线先把实体空间收敛，后面各道才有意义；跳过资产建设直接堆 prompt 技巧或评测，准确率上限就被锁死（"实体一旦定准，执行与 SQL 无足轻重"的另一面）。
- **准确率有显式的预算旋钮**。对抗式评审 sub-agent（+6% 准确 / +32% token / +72% 延迟）这类高成本手段证据门控、按领域启用——"愿意为准确率多花多少钱"是必须显式回答的问题，不是默认全开。
- **诚实对待残余风险：静默失败**（答案错但看起来合理、无异议地被采用）没有完美解。缓解是防线 4 + 高 stakes 输出人工 sign-off + 头部 KPI 常驻评测对照 blessed 看板；离线评测 ~100% 通过也只证明「无明显缺口」，不证明系统不会错——宣称绝对准确本身就是错误。

### 2.1 各防线的就绪判据（readiness gate）

「防线存在」不等于「防线就绪」。每道防线有明确的 ready bar、可执行的验证手段、以及未达标时的修复动作（诊断与修复分离——审计只诊断，每个发现路由到对应动作）：

**防线 1——资产**

- *就绪判据*：目标问题族（requirements P0/P1）逐条有 required assets 映射——validated MV 或批准的 raw path，无悬空；MV 在 validation slice 上验证过（如 Distribution 202604），candidate/deferred 有 fallback 披露策略；每指标单一规范定义且有 owner；范围 ≤20 表/MV（≤100 硬顶）。
- *如何验证*：gap-analysis 覆盖检查 + readiness 文档；MECE 两级判定 contract test（fail/warn）；context 审计 rubric 的范围与逐 MV 覆盖项。
- *未就绪时*：缺口走 onboarding 补资产（建/验证 MV、写口径）；超范围先收敛到 gold 层，不是先加上下文。

**防线 2——路由**

- *就绪判据*：编译核心确实在 L1（validated MV 的 grain/measures/dimensions、metric-view-first、pre-rebutted 清单、日期约定）；指针指向的文件全部存在或可降级，且受 release 冻结覆盖；`project_files_read` 跟踪上线，**指针未遵从率有数且低于阈值**；技能集按项目类型收敛、工具 schema 占用在冻结基线内。
- *如何验证*：context rendering 测试（断言渲染出/未渲染哪些段）；release-pinned 测试含文件路径；评测断言「KPI case ⇒ trace 含对应文件读取」。
- *未就绪时*：未遵从率超阈值 → 才立项 requirement matcher（证据门控）；文件缺失 → 降级编译态渲染并补文件。

**防线 3——执行**

- *就绪判据*：plan 状态机 / schema gate / read-only（含注释、大小写、前导空白等绕过尝试）contract tests 全绿；日期/周期约定段渲染进 L1；自纠错触发器（0 行 / null 暴增 / 10× / 行数=1）写入 workflow 指南。
- *如何验证*：contract tests 进 CI；评测里抽查含时间窗的 case 是否按约定取窗。
- *未就绪时*：gate 漏判 → 修 gate 常量/正则并补用例；日期类 case 失败 → 先修约定段再考虑语义层。

**防线 4——披露**

- *就绪判据*：footer 在每个结论答案上出现且**可解析、可从 trace 复核**（来源层级与已执行 SQL 一致、验证状态与 settings 一致）；fallback 时状态与理由先于答案披露；高 stakes 输出的人工 sign-off 流程有定义。
- *如何验证*：footer 解析测试 + trace 抽查比对；评测断言 fallback case 含披露语。
- *未就绪时*：footer 字段失实 → 当 bug 修——它是静默失败的最后缓解，失实比缺失更糟。

**防线 5——度量**

- *就绪判据*：数据正确性评测基线**先于任何 prompt 内容改动**存在；每个 P0 问题族有足够用例（几十条/领域即边际递减），ground truth 钉死快照日期不漂移；结果落遥测表（skill 版本 / git SHA / model id）可时序查询；该领域清过 ~90% go-live 阈值。
- *如何验证*：评测在 CI 可跑且有历史曲线；gate 可断言。
- *未就绪时*：阈值未过 → 不对 stakeholder 宣布可用，按失败归类（数据模型 / 日期 / 测试本身 / 指标定义）路由到防线 1–3 修复。

三条使用规则：

- **防线 5 是仪器，先于其余就绪**。没有评测基线，防线 1–4 的"就绪"无法判定——就绪检查的顺序是先立仪器（防线 5 的基线部分），再逐线达标，最后才过 go-live gate。
- **就绪是 per-domain / per-project 的**，不是系统全局开关：一个项目的 Distribution 域过了 gate，不代表新接入的域可用；新域从防线 1 的资产映射重新走一遍。
- **就绪会腐烂**。文档描述的是每天在变的数据模型（无维护时准确率 95%→65%/月），所以就绪判据要绑定维护机制（colocation、code-review hook、纠正收割，见 §9）持续重验，遥测曲线是「仍然就绪」的证据。

### 2.2 四个体系的关系与强制矩阵

本文有四套编号体系，它们不是平行清单，而是同一系统的**四个正交轴**：五道防线是**目标分解**（正确性从哪来），十条原则（§3）是**决策规则**（设计取舍怎么判），六层（§4）是**运行时结构**（上下文物理上怎么装配），五件物（§7）是**数据治理**（内容的权威来源与流向）。一句话串起来：**原则约束层的构建方式；层承载的内容由件物契约治理；三者共同支撑防线；防线 5（度量）是验证前三轴确实成立的仪器**。不要尝试逐项 1:1 对齐——映射天然是多对多。

两条辖域声明，避免误读：

- **防线只分解 reliability**。CE 的目标是三维（reliability / speed / cost，原则 5），五道防线全部属 reliability 的分解；原则 2（cache）、原则 4（注意力/成本账）同时治理 speed/cost——它们映射不满防线是设计使然，不是孤儿原则。
- **五件物只治理项目侧配置内容**（即 L1/L3 的来源）。L0 的事实源是代码、L2 是 request-scoped 参数、L4/L5 的权威存储是运行时产物（execution events / SDK session），均不在五件物之内（辖域细节见 §7）。

| 防线 | 主要原则 | 涉及的层 | 涉及的件物 | 链接的强制手段 |
|---|---|---|---|---|
| 1 资产 | P6 MECE、P10 口径人定 | 层之外（warehouse 资产），经 L1 编译核心进入 | DB settings、下沉文件（两处不得分叉） | ✅ MECE 两级判定测试；⚠️ 范围纪律 ≤20/≤100 为审计告警 |
| 2 路由 | P4 注意力、P3 可验证信号、P7 护栏、P2 cache | L1 指针 + L3 按需读取 + 工具 schema 面 | 下沉文件 + release 冻结 | ✅ `project_files_read` 遵从断言、release-pinned 文件路径测试、prompt shape snapshot；⚠️ P7「护栏而非菜谱」靠评审纪律 |
| 3 执行 | P3 工具状态 > prompt 文字 | 不在内容层——run_state 工具状态承载；L4 喂 schema gate | —（行为契约，非配置内容） | ✅ plan / schema gate / read-only（含绕过尝试）contract tests |
| 4 披露 | P3 的输出侧应用（信派生状态、不信模型自述） | 输出侧，不经装配层；从 trace 推导 | DB settings 的 validation 状态（footer 真实性依赖其新鲜度） | ✅ footer 解析 + trace 比对测试 |
| 5 度量 | P5 三维成本、P8 证据门控、P9 先测量 | 整体之上（消费 `AssembledContext` 可观测性 + trace） | 遥测表（「准确率状态」的事实源，见 §7 辖域说明） | ✅ 评测基线先行（gate 排序）、go-live gate、遥测时序曲线 |

图例：✅ = 有具名测试/信号机械强制；⚠️ = 只能靠评审纪律守住——「菜谱化」无法机械判定、范围线是建议值，这两条在评审 prompt/skill 改动与项目 onboarding 时必须人工把关。区分这两类是诚实的：声称「全部机械强制」会高估体系的自我保护能力。

## 3. 设计原则

1. **每个 token 都有目的**。上下文不是越多越好：过量浪费预算、稀释注意力、放大幻觉。
2. **cache 友好优先**。稳定前缀在前（L0 静态指令 + 工具 schema），易变内容在后；跨项目共享前缀，分层与下沉都不得破坏它。
3. **工具状态优先于 prompt 文字**。workflow 约束由工具状态承载（plan 状态机、schema gate、read-only 裁剪），prompt 只做说明；凡是只靠 prompt 文字的约束，都要补一个可验证信号（如指针遵从率）。防线 4 的「footer 一律从 trace/settings 推导、禁模型自评」是同一逻辑在输出侧的应用。
4. **瘦 prompt 的理由是注意力，不是省钱**。prompt cache 下稳定编译内容近乎免费；JIT 读取是额外 turn + 全价 token + 随 history 重复计费。下沉与否的判据是准确率/注意力收益，**不是 prompt 体积**——「小 + 稳定 + 普遍相关」的编译核心永不下沉。
5. **成本三维：reliability / speed / cost（含执行成本）**。token 之外，上下文不足引发的探索性 schema 查询（warehouse $ + 延迟）与 JIT 文件读取都是成本，评测一并采集（`tool_call_count`、文件读取次数）。
6. **MECE：每个指标只有一个规范定义**。跨 MV、跨 raw table、跨 settings 与下沉文件不冲突；冲突必须可检测，不能让模型静默二选一。
7. **护栏而非菜谱**。可规约「约束与事实」（别跳过语义层、这张是规范表、这个口径坑），不可规约「执行路径」（第一步做 X、第二步做 Y）——过度规约会把 agent 推向错路（openai 实测）。
8. **证据门控**。每一项会增加约束或复杂度的机制（专用 MV 工具、requirement matcher、对抗式评审、embedding 检索），都先用评测量出收益/缺口再立项，不预先强加。
9. **先测量、再改动**。任何改变「进 prompt 的内容」的工作，必须先有数据正确性评测基线作为对照组；「人工 smoke」不可替代基线。
10. **口径定义由人负责**。用 LLM 生成文档/描述（business_terms、caveats、字段说明，可从 transform 代码反推草稿），但 measure/dimension 的口径定义不自动生成——LLM bootstrap 语义层在 anthropic 的评测上是净负面。

## 4. 架构：显式 Context Engine 与六层模型

上下文装配收敛进一个显式的 `ContextAssembler`（`server/services/context/`），在 SDK 执行循环之前完成，产出结构化的 `AssembledContext`（每层文本 + 占用 + 被截断字段清单），而非裸字符串拼接。

| 层 | 命名 | 稳定性 | 内容 |
|---|---|---|---|
| L0 | immutable | 跨项目稳定（cache 前缀） | 角色、response format、plan 状态机、工具规则 |
| L1 | project | 同项目/同 release 稳定 | settings、skills guidance、AGENTS.md、metric view 编译核心、日期约定 |
| L2 | run | 每次 run | run_role、read_only、resource override |
| L3 | turn | 每轮提问时装配 | 用户消息、按需读取/检索的细粒度上下文（预留 golden_case 槽位） |
| L4 | observation | 轮内累积 | schema 历史 seed、工具结果 |
| L5 | history | 跨轮 | SDK session + 压缩摘要（可观测） |

两条结构性认识：

- **工具 schema 是六层之外的常驻成本面**。SDK 把每个启用工具的 schema 每轮序列化进上下文，与技能数量正相关；技能选择因此本身就是 CE 手段（少开一个重 schema 技能 = 少十几份 schema + 更准的工具选择）。注意杠杆方向是「减少不同工具数」，不是合并成更大的多路复用工具——后者正是 schema 膨胀来源。
- **预算显式且禁止静默截断**。每层预算是代码常量，超限丢弃必须在 `AssembledContext.dropped` 留痕；触达上限的第一选择是下沉为文件 + 指针，截断只是兜底。

## 5. 内容组织：编译 vs 按需读取

判据：**小 + 稳定 + 普遍相关 → 编译进常驻 prompt；大 + 条件相关 + 持续增长 → 下沉成项目文件，由 orchestration 指针引导模型 `read_project_file` 按需读取**。

- **编译核心（不下沉）**：已验证 MV 的 full_name / status / grain / measures / dimensions、metric-view-first 策略与 pre-rebutted「别过早 fallback 到 raw SQL」清单、日期/周期约定段。这是 happy path，不该花读取 round-trip。
- **按需长尾（下沉）**：business_terms 全文、known_caveats、sample_queries、requirements / readiness 细节。常驻 prompt 只留「何种问题先读哪个文件」的指路段。
- **指针遵从必须可验证**：指针是 prompt 文字（原则 3 的警告形态），`run_state` 跟踪 `project_files_read`，评测断言「KPI 类问题 ⇒ trace 含对应文件读取」。未遵从率是是否升级为自动路由（requirement matcher → LLM intent 分类）的证据。
- **毕业路径**：项目范围纪律为 **≤20 表/MV 理想、≤100 硬顶**（范围过大是可靠性失败的头号预测因子）。文件编排在硬顶内足够；突破硬顶才升级为 offline 聚合 + embedding 检索（openai 在 70k 数据集规模的做法）。范围纪律一身两用：既是可靠性手段，也是换检索机制的触发线。

## 6. Workflow 契约

行为约束由工具状态承载，写成可测试的契约：

- **plan 状态机**：`create → start → tools → finish → conclusion`，重复操作返回结构化错误而非浪费 turn。
- **schema gate**：引用配置表但本会话无 schema inspection 时拒绝 SQL，强制 schema-first；gate-exempt 前缀（DESCRIBE 等）是单一可测常量。
- **metric-view-first**：KPI/聚合/趋势/对比问题优先用配置的 Metric View（`MEASURE(...)`）；raw table 仅用于 validation、drill-down、MV 不覆盖的问题；fallback 必须先披露状态与理由。pre-rebutted 清单内联在编译核心里，防止被一句话绕过。
- **read-only**：preview run 工具裁剪 + SQL allowlist；正则守卫是软层，硬隔离需评估凭据层方案（SELECT-only UC grant / 低权限 SP），并正视其与 per-user pass-through 模型的冲突——pass-through 本身已保证 agent 不越过用户权限。
- **可疑中间结果自查**：0 行、null 暴增、相邻周期 10×、聚合后行数=1 等触发器命中时，先回查 schema/过滤再给结论，把迭代从用户移进 agent。

## 7. Source of Truth：五件物

| 物件 | 角色 | 关键规则 |
|---|---|---|
| `project_setting.yaml` | 人编辑的源 | 保存时同步到 DB，run 时不直接重读 |
| DB settings | run 时的事实源 | 每次 run 由 `build_project_context` 读取 |
| release snapshot | 预览者看到的冻结源 | **覆盖 settings 与项目文件两者** |
| AGENTS.md | 机制指南 snapshot | 只讲机制不放项目数据；每次 run 重读 |
| 下沉上下文文件 | L1/L3 细粒度按需载体 | derived 类从 settings 物化（唯一写路径，禁手改）；authored 类人工编辑；release-pinned run 的 `read_project_file` 解析到冻结版本 |

第五行是按需读取架构成立的前提：细粒度上下文下沉成文件后，若 release 冻结不覆盖文件，release pinning 就泄漏；若物化不是唯一写路径，settings 与文件会分叉出 MECE 冲突。

**辖域声明**：五件物治理的是**项目侧配置内容**（即 L1/L3 的来源）。其余层另有归属——L0 的事实源是**代码**（prompt shape snapshot 测试守护其稳定）；L2 是 request-scoped 参数；L4/L5 的权威存储是 execution events 与 SDK session（运行时产物，不是配置）；评测遥测表是「准确率状态」的事实源（§8）。它们不进本表，但「归谁所有、谁能写、何时读」对它们同样必须可回答。

## 8. 验证体系

**离线（基线先行）**：

- **数据正确性评测**是地基：NL prompt → agent 答案抽结构化 → 对照 ground-truth SQL 逐行 diff（归一化、忽略行序、数值容差），接入 `.test/`（MLflow + GEPA）。测试 prompt 要像真实聊天（不含表名/列名），输出列名编码单位而非来源，防泄漏。
- **contract tests** 守「上下文长什么样」：prompt shape snapshot（保护 cache 前缀）、budget 截断留痕、schema gate、read-only 绕过尝试、release-pinned（含文件路径）、MECE 两级判定（fail = 同名 measure 表达式不一致；warn = glossary/文件分叉）、指针遵从。
- **评测即遥测**：每次结果落数仓表（skill 版本 / git SHA / model id / token / 墙钟），捕捉单次 CI 看不见的 slow regression（anthropic 实测无维护时准确率 95%→65%/月）。**per-domain go-live gate**：清过 ~90% 阈值前不对 stakeholder 宣布可用。
- **消融纪律**：每次有意义的 prompt/skill 改动做前后对照跑；保留「什么没用」清单（负面结果防止重跑同样的实验）。

**在线（按流量与证据采纳）**：

- **provenance footer**：来源层级 · 验证状态 · owner，字段一律从 trace/settings 推导，禁止模型自报置信度——这是静默失败为数不多的缓解。
- **被动监控**：语义层解析占比、纠正性措辞占比——前提是有足够流量，小流量项目先靠离线评测 + 遵从信号。
- **对抗式评审 sub-agent**：anthropic 量化 +6% 准确 / +32% token / +72% 延迟，是可调的成本旋钮，证据门控后按领域决定。

## 9. 知识生命周期

- **双层知识**：curated（人写的事实：schema、口径、规则）与 discovered（运行时踩到的坑、验证过的查询）分开存、分开演进。
- **写回闭环**：验证通过的查询/口径修正写回项目知识，带只读 + 单语句校验；**distill 优先于 raw 检索**——原始查询堆给模型直读只换来 <1% 提升（瓶颈是结构不是访问），写回必须提炼成结构化参考片段。
- **全局/个人分级 + 显式确认**：项目级规范修正与个人偏好分开，保存动作带用户确认，避免个人口径污染项目规范层。
- **红线**：写回只能是验证过的查询与文档描述，**不写新的 measure/dimension 口径定义**（原则 10）。
- **维护当一等工程**：参考文档/skill 与 transform 代码 colocate 同仓库（改模型的 PR 就是改文档的 PR），code-review hook 标记「改了模型没碰文档」的 diff；纠正收割定时扫描会话措辞、起草修复 PR，修复路径刻意「无聊」。
- **代码派生语义**：表的真正含义在产出它的 pipeline 代码里——可用 offline 过程爬 transform 代码（SDP/DLT、dbt、notebook）反推 grain/主键/新鲜度/同义表的**文档草稿**，再交人校验。
- **克制原则**：不要为弥补当前模型的不足过度堆基础设施——模型变强后这些投入会变多余。起步配方：少数规范数据集 + 几十条离线评测 + 一个薄 knowledge 层。

## 10. 演进路线与外部参照

```
v0.3.5  Distribution 场景资产（requirements / gap / readiness / MV 验证）
v0.3.6  显式 ContextAssembler + 六层 + 预算可测 + 下沉/指针 + 评测基线 + 契约测试
v0.4    Golden Analysis Cases（canonical path / answer contract / fast-path 路由）
        + 证据到位后的增项：requirement matcher、query_metric_view、LLM intent 兜底
v0.4+   毕业项：embedding 检索（>100 表硬顶触发）、JIT 工具暴露、sliding-window 历史
```

v0.3.6 的抽象为 v0.4 预留接口形状（命中对象 schema、golden_case 槽位、评测扩展位），但**不写任何 golden-case 专属逻辑**。

外部参照速查（详见 [`../refer/`](../refer/)）：

| 来源 | 我们采纳的核心 |
|---|---|
| [nao](../refer/nao-context-engineering.md) | CE 是可度量学科（含查询执行成本）；瘦 prompt + orchestrated 文件读取；MECE；数据正确性评测 + `tool_call_count`；范围纪律 ≤20/≤100；语义层证据门控 |
| [dash](../refer/dash-context-engineering.md) | 编译 vs 检索二分；curated/discovered 双层记忆 + 写回闭环；资源层强制边界 > prompt 文字；eval 即契约 |
| [anthropic](../refer/how-anthropic-enables-self-service-data-analytics-with-claude.md) | 三种失败模式分类法；两个负面结果（LLM 生成口径净负面、raw 检索 <1%）；skill 漂移 + colocation/hook 维护；评测即遥测 + go-live gate；provenance footer；对抗式评审成本量化 |
| [openai](../refer/Inside%20OpenAI’s%20in-house%20data%20agent.md) | 代码派生表语义；过度规约会变差（护栏而非菜谱）；RAG-at-scale 毕业路径；工具整合；自纠错触发器；memory 全局/个人分级 + 显式保存 |

> 一句话总结：**把「什么进上下文」做成有预算、有层次、可测试的工程对象；编译核心守准确率的 happy path，长尾按需读取并验证遵从；一切增量机制证据门控；用数据正确性评测和维护流程对抗三种失败模式。**
