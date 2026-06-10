# Context Engineering 总体设计（databricks-builder-app-oai）

日期: 2026-06-10

本文是 builder-app-oai Context Engineering（CE）的**顶层设计**：它回答「我们如何系统性地决定什么进入模型上下文、以什么形态、付出什么成本、用什么守住质量」。它不绑定具体版本——版本化的现状基线、目标设计与落地任务见文档地图。

## 0. 文档地图

| 文档 | 角色 |
|---|---|
| 本文 | 顶层理念、架构与路线，版本无关 |
| [`v0.3.6/gap-analysis.md`](./v0.3.6/gap-analysis.md) | 现状基线（as-is）：上下文来源、prompting、workflow、历史 |
| [`v0.3.6/design.md`](./v0.3.6/design.md) | v0.3.6 目标设计：六层模型、预算、按需读取、契约与评测 |
| [`v0.3.6/action-plan.md`](./v0.3.6/action-plan.md) | P1–P4 落地任务与验收 gate |
| [`v0.4-golden-analysis-cases/`](./v0.4-golden-analysis-cases/) | 高频问题族的 canonical path / answer contract（下一版） |
| [`../refer/`](../refer/) | 外部实践参照：nao、dash、anthropic、openai（见 §9 速查表） |

## 1. 问题定义：分析准确性是上下文 + 验证问题

与编码 agent 不同，数据分析问题通常**只有一个正确答案、对应一个正确来源**，且没有「测试天然护栏」。anthropic 的结论与我们的经验一致：**准确性不是 SQL 生成问题——把用户问题映射到正确实体之后，执行与 SQL 无足轻重**。绝大多数错误归于三种失败模式，CE 体系的每个组件都应能回答「我在防御哪一种」：

1. **概念 ↔ 实体歧义**：同一个业务词（"达成率"）对应多个看似可行的表/列/口径。防御：Metric View 语义层 + MECE 单一规范定义 + 业务术语映射。
2. **数据陈旧**：schema、口径、文档随业务漂移，答案开始细微出错。防御：维护流程（colocation、评测即遥测、纠正收割）。
3. **检索失败**：正确信息存在但 agent 找不到。防御：orchestration 指针 + `read_project_file` 按需读取（小规模）→ embedding 检索（超阈值后的毕业路径）。

无法归入任何一种失败模式的上下文，默认在白占预算。

## 2. 设计原则

1. **每个 token 都有目的**。上下文不是越多越好：过量浪费预算、稀释注意力、放大幻觉。
2. **cache 友好优先**。稳定前缀在前（L0 静态指令 + 工具 schema），易变内容在后；跨项目共享前缀，分层与下沉都不得破坏它。
3. **工具状态优先于 prompt 文字**。workflow 约束由工具状态承载（plan 状态机、schema gate、read-only 裁剪），prompt 只做说明；凡是只靠 prompt 文字的约束，都要补一个可验证信号（如指针遵从率）。
4. **瘦 prompt 的理由是注意力，不是省钱**。prompt cache 下稳定编译内容近乎免费；JIT 读取是额外 turn + 全价 token + 随 history 重复计费。下沉与否的判据是准确率/注意力收益，**不是 prompt 体积**——「小 + 稳定 + 普遍相关」的编译核心永不下沉。
5. **成本三维：reliability / speed / cost（含执行成本）**。token 之外，上下文不足引发的探索性 schema 查询（warehouse $ + 延迟）与 JIT 文件读取都是成本，评测一并采集（`tool_call_count`、文件读取次数）。
6. **MECE：每个指标只有一个规范定义**。跨 MV、跨 raw table、跨 settings 与下沉文件不冲突；冲突必须可检测，不能让模型静默二选一。
7. **护栏而非菜谱**。可规约「约束与事实」（别跳过语义层、这张是规范表、这个口径坑），不可规约「执行路径」（第一步做 X、第二步做 Y）——过度规约会把 agent 推向错路（openai 实测）。
8. **证据门控**。每一项会增加约束或复杂度的机制（专用 MV 工具、requirement matcher、对抗式评审、embedding 检索），都先用评测量出收益/缺口再立项，不预先强加。
9. **先测量、再改动**。任何改变「进 prompt 的内容」的工作，必须先有数据正确性评测基线作为对照组；「人工 smoke」不可替代基线。
10. **口径定义由人负责**。用 LLM 生成文档/描述（business_terms、caveats、字段说明，可从 transform 代码反推草稿），但 measure/dimension 的口径定义不自动生成——LLM bootstrap 语义层在 anthropic 的评测上是净负面。

## 3. 架构：显式 Context Engine 与六层模型

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

## 4. 内容组织：编译 vs 按需读取

判据：**小 + 稳定 + 普遍相关 → 编译进常驻 prompt；大 + 条件相关 + 持续增长 → 下沉成项目文件，由 orchestration 指针引导模型 `read_project_file` 按需读取**。

- **编译核心（不下沉）**：已验证 MV 的 full_name / status / grain / measures / dimensions、metric-view-first 策略与 pre-rebutted「别过早 fallback 到 raw SQL」清单、日期/周期约定段。这是 happy path，不该花读取 round-trip。
- **按需长尾（下沉）**：business_terms 全文、known_caveats、sample_queries、requirements / readiness 细节。常驻 prompt 只留「何种问题先读哪个文件」的指路段。
- **指针遵从必须可验证**：指针是 prompt 文字（原则 3 的警告形态），`run_state` 跟踪 `project_files_read`，评测断言「KPI 类问题 ⇒ trace 含对应文件读取」。未遵从率是是否升级为自动路由（requirement matcher → LLM intent 分类）的证据。
- **毕业路径**：项目范围纪律为 **≤20 表/MV 理想、≤100 硬顶**（范围过大是可靠性失败的头号预测因子）。文件编排在硬顶内足够；突破硬顶才升级为 offline 聚合 + embedding 检索（openai 在 70k 数据集规模的做法）。范围纪律一身两用：既是可靠性手段，也是换检索机制的触发线。

## 5. Workflow 契约

行为约束由工具状态承载，写成可测试的契约：

- **plan 状态机**：`create → start → tools → finish → conclusion`，重复操作返回结构化错误而非浪费 turn。
- **schema gate**：引用配置表但本会话无 schema inspection 时拒绝 SQL，强制 schema-first；gate-exempt 前缀（DESCRIBE 等）是单一可测常量。
- **metric-view-first**：KPI/聚合/趋势/对比问题优先用配置的 Metric View（`MEASURE(...)`）；raw table 仅用于 validation、drill-down、MV 不覆盖的问题；fallback 必须先披露状态与理由。pre-rebutted 清单内联在编译核心里，防止被一句话绕过。
- **read-only**：preview run 工具裁剪 + SQL allowlist；正则守卫是软层，硬隔离需评估凭据层方案（SELECT-only UC grant / 低权限 SP），并正视其与 per-user pass-through 模型的冲突——pass-through 本身已保证 agent 不越过用户权限。
- **可疑中间结果自查**：0 行、null 暴增、相邻周期 10×、聚合后行数=1 等触发器命中时，先回查 schema/过滤再给结论，把迭代从用户移进 agent。

## 6. Source of Truth：五件物

| 物件 | 角色 | 关键规则 |
|---|---|---|
| `project_setting.yaml` | 人编辑的源 | 保存时同步到 DB，run 时不直接重读 |
| DB settings | run 时的事实源 | 每次 run 由 `build_project_context` 读取 |
| release snapshot | 预览者看到的冻结源 | **覆盖 settings 与项目文件两者** |
| AGENTS.md | 机制指南 snapshot | 只讲机制不放项目数据；每次 run 重读 |
| 下沉上下文文件 | L1/L3 细粒度按需载体 | derived 类从 settings 物化（唯一写路径，禁手改）；authored 类人工编辑；release-pinned run 的 `read_project_file` 解析到冻结版本 |

第五行是按需读取架构成立的前提：细粒度上下文下沉成文件后，若 release 冻结不覆盖文件，release pinning 就泄漏；若物化不是唯一写路径，settings 与文件会分叉出 MECE 冲突。

## 7. 验证体系

**离线（基线先行）**：

- **数据正确性评测**是地基：NL prompt → agent 答案抽结构化 → 对照 ground-truth SQL 逐行 diff（归一化、忽略行序、数值容差），接入 `.test/`（MLflow + GEPA）。测试 prompt 要像真实聊天（不含表名/列名），输出列名编码单位而非来源，防泄漏。
- **contract tests** 守「上下文长什么样」：prompt shape snapshot（保护 cache 前缀）、budget 截断留痕、schema gate、read-only 绕过尝试、release-pinned（含文件路径）、MECE 两级判定（fail = 同名 measure 表达式不一致；warn = glossary/文件分叉）、指针遵从。
- **评测即遥测**：每次结果落数仓表（skill 版本 / git SHA / model id / token / 墙钟），捕捉单次 CI 看不见的 slow regression（anthropic 实测无维护时准确率 95%→65%/月）。**per-domain go-live gate**：清过 ~90% 阈值前不对 stakeholder 宣布可用。
- **消融纪律**：每次有意义的 prompt/skill 改动做前后对照跑；保留「什么没用」清单（负面结果防止重跑同样的实验）。

**在线（按流量与证据采纳）**：

- **provenance footer**：来源层级 · 验证状态 · owner，字段一律从 trace/settings 推导，禁止模型自报置信度——这是静默失败为数不多的缓解。
- **被动监控**：语义层解析占比、纠正性措辞占比——前提是有足够流量，小流量项目先靠离线评测 + 遵从信号。
- **对抗式评审 sub-agent**：anthropic 量化 +6% 准确 / +32% token / +72% 延迟，是可调的成本旋钮，证据门控后按领域决定。

## 8. 知识生命周期

- **双层知识**：curated（人写的事实：schema、口径、规则）与 discovered（运行时踩到的坑、验证过的查询）分开存、分开演进。
- **写回闭环**：验证通过的查询/口径修正写回项目知识，带只读 + 单语句校验；**distill 优先于 raw 检索**——原始查询堆给模型直读只换来 <1% 提升（瓶颈是结构不是访问），写回必须提炼成结构化参考片段。
- **全局/个人分级 + 显式确认**：项目级规范修正与个人偏好分开，保存动作带用户确认，避免个人口径污染项目规范层。
- **红线**：写回只能是验证过的查询与文档描述，**不写新的 measure/dimension 口径定义**（原则 10）。
- **维护当一等工程**：参考文档/skill 与 transform 代码 colocate 同仓库（改模型的 PR 就是改文档的 PR），code-review hook 标记「改了模型没碰文档」的 diff；纠正收割定时扫描会话措辞、起草修复 PR，修复路径刻意「无聊」。
- **代码派生语义**：表的真正含义在产出它的 pipeline 代码里——可用 offline 过程爬 transform 代码（SDP/DLT、dbt、notebook）反推 grain/主键/新鲜度/同义表的**文档草稿**，再交人校验。
- **克制原则**：不要为弥补当前模型的不足过度堆基础设施——模型变强后这些投入会变多余。起步配方：少数规范数据集 + 几十条离线评测 + 一个薄 knowledge 层。

## 9. 演进路线与外部参照

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
