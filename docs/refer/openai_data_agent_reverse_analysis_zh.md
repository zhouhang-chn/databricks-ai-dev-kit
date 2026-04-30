# OpenAI Data Agent 逆向分析

## 1. 文档目的

本文将前面的讨论整理为一份统一的逆向分析，尝试还原 OpenAI 内部 data agent 的整体形态。综合材料包括：

- OpenAI 官方工程文章
- VentureBeat 对 Emma Tang 的专访
- Bonnie Xu 在 QCon AI New York 2025 的议题元信息
- The New Stack 关于 Kepler 的报道（仅作为较低置信度的辅助来源）
- 用户提供的时间线与架构分析

本文的目标不是假装掌握了 OpenAI 内部未公开的确定事实，而是把信息严格分层：

- **已确认**：由一手或近一手来源直接支持
- **高置信推断**：由多个来源共同强烈指向
- **低置信推断**：合理，但证据仍不完整

---

## 2. 执行摘要

OpenAI 的内部 data agent，最合理的理解方式是：它是一个构建在 **Responses API + GPT-5.x** 之上的**单主 agent 运行时**，连接一组**精简的企业工具**，并由一套**六层 context fabric** 提供语义支撑。

它真正的差异化，并不是“更强的 text-to-SQL prompt”，而是下面六点：

1. **Codex Enrichment**：通过读取 pipeline 代码，推导 schema 中不存在的数据集语义。
2. **分层 context 检索**：不是把所有资料全塞给模型，而是先做筛选、排序、归一化。
3. **运行时验证**：只有当离线 context 不足或已过期时，才触发实时仓库/平台检查。
4. **可编辑 memory**：把一次次踩坑得到的修正与隐性规则沉淀下来。
5. **Evals 作为生产闸门**：正确性依赖回归评估与 canary，而不是“相信模型”。
6. **Pass-through 权限模型**：agent 只是接口层，不是一个新的高权限身份。

最强的整体架构解读是：

> **离线 context 工厂 -> 检索/排序 -> 单 agent 推理循环 -> 运行时 probe -> 带证据的答案 -> feedback/memory/evals 回写**

---

## 3. 证据地图

### 3.1 由 OpenAI 官方文章直接确认的信息

OpenAI 官方明确说明，该系统：

- 面向 **600+ PB** 数据与 **70k 数据集**
- 服务 **3.5k+ 内部用户**
- 接入 **Slack、Web、IDE、Codex CLI via MCP、内部 ChatGPT**
- 使用 **GPT-5.x、Codex、Embeddings API、Evals API**
- 依赖 **六层 context**
- 对第 1-5 层执行 **每日离线聚合 + embedding + retrieval**
- 对第 6 层使用 **runtime live queries**
- 连接 **data warehouse、metadata service、Airflow、Spark**
- 支持 **discovering data、running SQL、publishing notebooks and reports**
- 使用 **memory**，并明确强调 institutional knowledge 与 code-derived table semantics 的价值

### 3.2 由 VentureBeat 专访补充确认的信息

VentureBeat 采访补充了以下内容：

- 系统由 **两位工程师在大约三个月内**完成
- 约 **70% 的代码**由 AI 协助编写
- runtime 使用 **Responses API**
- OpenAI 约有 **5,000 名员工**，其中 **4,000+ 使用 Emma Tang 团队提供的数据工具**
- 团队估计 **每个 query 节省 2-4 小时**
- 最大难点是 **找到正确的表**，而不是 SQL 语法本身
- historical query context 是**带排序和分层**的，canonical dashboards / executive reports 权重更高，探索性噪音查询权重更低
- 团队显式让 agent 在 **discovery 阶段停留更久**，避免过早锁定某张表
- 当前系统 **还不是 multi-agent 架构**，但未来可能演进过去
- 安全模型非常朴素：**personal token、私有使用 surface、只允许写入临时 test schema**

### 3.3 由 QCon 元信息确认的信息

QCon 页面可以确认：

- Bonnie Xu 在 **2025 年 12 月**已经对外分享这一主题
- 她是 **Data Productivity 团队的 tech lead**
- 主题明确聚焦于让 agent 能在**极大规模、极复杂的数据环境中推理**

### 3.4 可用但置信度较低的辅助来源

这些来源可以提供方向性线索，但不应视为与一手材料同等级：

- The New Stack 报道中把该平台称为 **Kepler**
- 用户提供的时间线分析，它在工程推演上很强，但仍包含部分推断

---

## 4. 这个系统最可能是什么

## 4.1 核心架构命题

最可能的整体架构如下：

```text
用户入口
  -> Gateway / session 层
  -> Main agent runtime（单主循环）
  -> Context retrieval（第 1-5 层）
  -> Tool bus / MCP / enterprise connectors
  -> Runtime validation probes（第 6 层）
  -> 基于证据的答案综合
  -> Feedback / memory / eval 回写
```

它不是一个固定脚本式 workflow engine。
它更像一个**面向目标的推理循环**，可以：

- 检索 context
- 选择工具
- 检查中间失败
- 改变策略
- 直到有足够信心再输出答案

### 4.2 为什么“单 agent”是当前最合理的理解

OpenAI 并没有公开用“single-agent architecture”这个精确术语。
但当前最合理的判断仍是：

- 有一个**主 agent / Agent-API 编排层**
- 连接多个工具
- 运行在多个 context 层之上
- 目前还没有拆成多个 specialist agent 协同工作

这个结论主要来自三个信号：

1. OpenAI 官方文章始终以单数来描述当前系统。
2. VentureBeat 明确说未来可能演进为 multi-agent，反过来说明当前主形态仍不是。
3. 已公开的 failure modes 与修复手段，更符合单一推理循环，而不是 planner/executor 的显式分工。

---

## 5. 六层 context fabric

这是整个系统的核心。
六层 context 不是“更多资料”，而是一套**分层 grounding 机制**。

## 5.1 第一层：Table usage metadata / query patterns

目的：

- 帮助 agent 理解哪些表常被用于回答哪些问题
- 提供 query prior 与常见 join 路径
- 压制低价值、低信号的使用模式

最可能包含：

- schema metadata
- lineage links
- 常见 joins
- 常见 filters
- popularity/frequency signals
- 带排序的 historical queries
- 来自 canonical dashboards / executive reports 的 source-of-truth 信号

关键理解：

这一层不是“把原始 query log 全部塞进去”，而是**带排名的行为先验**。

## 5.2 第二层：Human annotations

目的：

- 提供领域专家视角下的业务含义、用途边界、caveat 与 exclusion

最可能包含：

- business meaning
- intended use / non-goals
- known caveats
- approved interpretation notes
- owner team
- review status

关键理解：

这是系统获得“人类写下来的业务语义修正”的地方，而这些语义是数据仓库 schema 无法表达的。

## 5.3 第三层：Codex Enrichment

目的：

- 从代码而不只是 metadata 中提取数据集的真实语义

最可能包含：

- 表的 purpose
- grain / primary keys
- freshness pattern
- derivation assumptions
- scope inclusions / exclusions
- alternate tables
- downstream usage patterns
- join keys 与 uniqueness expectations

关键理解：

这很可能是最有辨识度的一层。它把代码转成了可检索的数据语义资产。

## 5.4 第四层：Institutional knowledge

目的：

- 把数据分析与真实业务事件和组织背景联系起来

最可能包含：

- launches
- incidents
- internal codenames
- canonical metric definitions
- 来自 Slack / Docs / Notion 的操作背景信息
- permissions metadata

关键理解：

很多业务问题不是只靠表就能回答的。这一层负责解释“为什么指标发生了变化”。

## 5.5 第五层：Memory

目的：

- 保存真实使用过程中发现的修正与难以从其他层自动推断出的约束

最可能包含：

- global memory
- personal memory
- exact filter rules
- table-choice corrections
- user-validated caveats
- edit / review metadata

关键理解：

Memory 不只是便利功能，而是**正确性层**。

## 5.6 第六层：Runtime context

目的：

- 当离线 context 不完整、已过期或彼此冲突时，执行实时验证

最可能的 runtime probes：

- describe schema
- inspect freshness
- sample rows
- compare counts across sources
- inspect pipeline/job status
- query metadata service

关键理解：

Runtime context 是**验证器和兜底层**，而不是主知识库。

---

## 6. 六层 context 在运行时最可能如何被使用

最可能的运行时流程如下：

1. 用户提出问题。
2. 主 agent 对问题做分类。
3. 系统从第 1-5 层检索最相关的 context objects。
4. agent 比较候选表、指标、caveat 与业务事实。
5. agent 形成一个临时分析计划。
6. 如果信心不足，或怀疑信息已过期，则调用第 6 层 runtime probes。
7. 执行 SQL / 分析步骤。
8. 检查中间结果，并在必要时修正路线。
9. 产出包含 assumptions、evidence 和 results 的答案。
10. 如果发现了新知识，可能建议写回 memory。

最重要的性质是：

> **离线 context 用于缩小搜索空间；runtime context 用于验证剩余不确定性。**

---

## 7. Codex Enrichment：最重要的逆向子系统

## 7.1 它最可能在做什么

Codex Enrichment 最适合被理解为一条**每日离线的 code-to-semantics 流水线**。

最可能的过程是：

1. 选出重要表 / 重要数据资产
2. 定位其产出代码与相关 pipeline logic
3. 用 Codex 在 Spark / Python / SQL / pipeline code 上运行分析任务
4. 抽取结构化语义字段
5. 合并 evidence 与 confidence
6. 把归一化后的 table profile 写回 metadata storage
7. 做 embedding 与索引，供检索使用

## 7.2 为什么这很重要

Schema 和 lineage 只能描述表的形状和依赖关系。
它们**不能稳定告诉 agent**：

- 表真正表示什么
- 哪些范围是被有意排除的
- 某个问题该优先选择哪张替代表
- 真实 freshness guarantee 是什么
- 某张表是否只覆盖例如 first-party traffic 这类子范围

Codex Enrichment 很可能就是用来补上这部分语义空白的。

## 7.3 为什么它比普通的 RAG-over-DDL 更强

常见 text-to-SQL 栈通常依赖：

- DDL
- 少量 example queries
- 人工写的表说明

OpenAI 这套系统看起来更进一步：把代码本身作为语义真相源。这个 enrichment 等级已经和普通 DDL RAG 不在一个层次。

---

## 8. 真正的瓶颈：选表，而不是 SQL 生成

OpenAI 官方文与 Emma Tang 的采访都在指向同一个核心：

> 最难的问题不是把 SQL 写对，而是先选对数据集、选对解释口径。

这解释了多项设计选择：

- 为什么是六层 context，而不是简单 schema lookup
- 为什么要对 historical queries 做质量分层，而不是直接喂原始日志
- 为什么需要 Codex Enrichment，而不是只靠 metadata
- 为什么要用 discovery-first prompting 来减缓过度自信的选表行为
- 为什么 memory 要保存很多“非显然的负向规则”

最有用的心智模型是：

> **Kepler / OpenAI Data Agent 的本质，是一个选表与语义 grounding 系统，只是它顺便也会生成 SQL。**

---

## 9. Prompting 哲学与 agent loop

公开材料暗示了一个很重要的 prompting 转向：

- **Guide the goal, not the path**
- 不要把模型过度脚本化
- 只在具体 failure mode 上做约束

这意味着 runtime 很可能是一个**带 reflection / self-correction 的 ReAct 风格循环**，但并没有被硬拆成 planner/executor 两个代理。

最可能出现的行为包括：

- 当出现 zero rows 或可疑中间结果时，主动调查原因
- 尝试不同的 join 或 filter 重新执行
- 在真正提交答案前继续探索候选表
- 不只返回 final SQL，而是同时总结证据与假设

这更像一个单一但强大的推理循环，而不是由静态步骤拼成的脆弱 orchestration 链。

---

## 10. 工具层与 MCP 的角色

## 10.1 最可能存在的工具类别

这个 agent 最可能使用一组精简过的工具，例如：

- warehouse read/query tool
- metadata lookup tool
- lineage / catalog tool
- Airflow/pipeline status tool
- Spark/job inspection tool
- context search/fetch tools
- report/notebook publishing tool
- web search for external information

## 10.2 为什么 tool consolidation 很重要

OpenAI 明确说过：暴露过多功能重叠的工具会出问题。
最可能的工程经验是：

- 工具语义必须清晰区分
- 重叠工具会显著增加 agent 困惑
- 少而正交的工具，效果优于大而重叠的工具箱

这不是一个实现小细节，而是一个核心工程经验。

---

## 11. 安全模型

当前最强的解读是：这套系统采用的是一种**pass-through security model**。

也就是说：

- agent 使用的是用户自己的 access scope / token
- agent 不会变成一个新的高权限身份
- agent 被限制在私有 surface，而不是公共频道
- 如果允许写入，也只写入临时或 scratch 类目的地

这很重要，因为它意味着 agent 是：

> **建立在现有治理之上的接口层，而不是现有治理的替代品**

这个设计简单、可扩展，并且非常符合企业现实。

---

## 12. Memory 模型

公开证据表明，Memory 不是一个轻量的聊天历史功能。
它更接近一个带用户控制的规则系统。

最可能的特征包括：

- global 与 personal 两层 scope
- 用户可编辑
- 来自纠错或重复发现
- 专注于难以自动推断的规则
- 很可能带 review / curation 机制

最有意思的推论是，memory 里保存的不只是正向事实，也可能保存**避坑规则**：

- 不要用表 X 回答问题类型 Y
- 如果问指标 M 在日期范围 Z 的值，应使用 source S 而不是 source T
- 回答实验问题 E 时，必须施加 exact filter value V

这也解释了为什么 memory 同时提升**速度**与**正确率**。

---

## 13. Evals 与可信度

OpenAI 明确强调了 Evals。
最合理的理解是：评估不是只用于模型 benchmarking，而是产品循环的一部分。

最可能的评估模式包括：

- golden question -> SQL / answer pairs
- 基于执行结果的比较，而不是只做字符串比较
- 检查结果是否与期望输出一致
- 使用 model-based graders 评估答案质量 / 解释质量
- 当 prompt、tools、models 发生变化时，执行 regression/canary

这很重要，因为企业 data agent 不能依靠“感觉上还行”，而必须有可重复的正确性纪律。

---

## 14. 产品 surface 与用户体验

OpenAI 的选择体现出一种很强的产品哲学：

- 除非必要，不要创造一个全新的工作目的地
- 应该把 agent 放进用户本来就在工作的地方

已知或高置信支持的 surface 包括：

- Slack
- Web
- IDE
- Codex CLI via MCP
- internal ChatGPT via MCP connector

最可能的 UX 特征包括：

- 自然语言入口
- 可见的中间推理摘要
- 解释为什么选了某张表，以及有哪些 assumptions
- 可点击查看底层 query results
- 支持中断、改向
- 在需要时输出长报告、图表和 notebook

这是一种务实、低摩擦的部署策略。

---

## 15. 逆向推断出的构建顺序

从工程视角看，这个系统最可能是按下面的顺序长出来的：

### 阶段 1：最短闭环

- 一个 surface
- 一个或极少数工具
- 基础 warehouse 问答能力

### 阶段 2：正确率底座

- metadata
- query-pattern priors
- human annotations
- 第一版 code-aware enrichment

### 阶段 3：更广的组织 grounding

- Slack / Docs / Notion context
- 带权限的 retrieval

### 阶段 4：可信闸门

- 第一版认真可用的 eval harness
- 基于证据的输出
- feedback loop

### 阶段 5：学习闭环

- memory
- correction writeback
- 更稳的 discovery 行为

### 阶段 6：生产化

- async / background execution
- checkpointing / resume
- 更广 rollout
- 更多 surface

这个成长路径，比“两个工程师靠 prompt 把模型调神了”更符合现有公开材料。

---
