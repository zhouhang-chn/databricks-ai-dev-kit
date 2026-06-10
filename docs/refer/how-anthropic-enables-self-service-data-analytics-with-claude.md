# Anthropic 如何用 Claude 实现自助式数据分析

> 译自 Anthropic 官方博客：[How Anthropic enables self-service data analytics with Claude](https://claude.com/blog/how-anthropic-enables-self-service-data-analytics-with-claude)
> 分类：Enterprise AI ｜ 产品：Claude Code ｜ 日期：2026-06-03 ｜ 阅读时长：5 分钟
>
> （本文为中文翻译，供 `databricks-builder-app-oai` Context Engineering 设计参考。关键术语保留英文。）
>
> 📌 原文含若干配图，markdown 抓取时丢失。本文在对应位置补了「🖼 图示」中文描述，依据原文配图与上下文**重建**以便无图自足，非逐字图注。原文无数据表格（正文出现的 21%→95%、6%/32%/72%、95%→65% 等均为行内统计数字，非图表）。

---

正如许多数据科学和数据工程团队都能证实的：让业务自助分析变得可用，历来是一件苦差事。

为了让数据模型对技术较弱的同事更易用，常见做法是把表做宽、做反范式（denormalized）。但随着业务扩张，这往往会催生一堆定义不一致、相互重叠的视图（而且对那些根本不想学 SQL 的员工几乎毫无帮助）。另一种做法是为用户搭建更加"圈地式"（ringfenced）的环境，但这又常常覆盖不到业务问题的长尾，并随着各团队各自为政而导致指标与看板（dashboard）泛滥。

大语言模型（LLM）的兴起，为自助分析提供了一条能规避上述难题的新路径。然而，把 Claude 直接对准数仓、放任 agent 执行查询，会制造一种"看似精确"的假象。

从临时取数请求中被解放出来的最初狂喜，会很快变成隐忧——人们意识到：这套做法把利益相关者（stakeholder）与底层基础设施、文档和专业知识割裂开了，而正是这些东西此前一直在引导他们使用经过精心策划的数据集。

在 Anthropic，**95% 的业务分析查询由 Claude 自动完成，总体准确率约为 95%**。把这些往往机械、重复的工作交给 Claude 后，我们的数据科学团队得以专注于更具战略性的工作，比如因果建模、预测和机器学习。

在与数十位 Anthropic 顶级 Claude Code 用户交流、并见识了形形色色的分析 agent 设计模式之后，我们为其他使用 LLM 的数据团队总结出了一些最佳实践。本文将分享这些技巧与方法，帮助你最大化 Claude 驱动自助业务洞察的能力，包括：

* 为什么分析准确性是一个**上下文与验证**问题，而不是代码生成问题；
* 导致大多数错误的**三种失败模式**；
* 我们为应对这些错误而构建的 **agentic 分析技术栈**；
* 我们如何**衡量有效性**；以及
* 我们创建大多数 skill 所用的**基础模板**（见附录）。

## 数据不是软件

LLM 的生成能力是一把双刃剑：那套能为复杂问题创造性求解的机制，同样会产生错误的幻觉输出。要彻底理解分析 agent 的挑战，把它和编码 agent 做对比会很有帮助。

编码是一个开放式的解空间，奖励模型的创造力，同时文档和测试天然地构成了对抗幻觉的护栏。相比之下，在分析场景里，往往只有**一个正确答案**、对应**一个正确的来源**，而且没有确定性的方法去证明其正确性。

> **🖼 图示：编码 agent vs 分析 agent 对比**（依原文配图与上下文重建）
>
> | 维度 | 编码（Coding agent） | 分析（Analytics agent） |
> |---|---|---|
> | 解空间 | 开放式，奖励模型创造力 | 通常只有**一个正确答案 + 一个正确来源** |
> | 天然护栏 | 文档 + 测试，天然抑制幻觉 | 几乎没有——无确定性方法证明正确性 |
> | 核心难点 | 创造性求解 | 把用户问题映射到正确实体（数据歧义） |
>
> 要点：两者都用同一套生成式能力，但分析侧缺少编码侧那种"测试即护栏"的反馈，因此准确性必须靠**上下文 + 验证**来保证，而非靠代码生成本身。

对于自助式 agentic 业务分析，复杂性主要源于**数据的歧义**。核心问题归结为：我们**能否把用户的问题映射到数据模型中具体且最新的实体，并知道操作它们的正确方式**。如果能做到这一点，那么随后的执行和 SQL 就变得无足轻重。

我们识别出该问题的三个属性，它们占了绝大多数不准确回答的成因：

1. **概念 ↔ 实体歧义（Concept ↔ entity ambiguity）**：数据模型里有数百个可行选项（而潜在字段可能数以百万计），agent 无法选出最能回答用户问题的正确字段。例如，衡量活跃用户数时：哪些行为算"活跃"？是否包含欺诈用户？回看窗口（lookback window）取多长？

2. **数据陈旧（Data staleness）**：数据源、业务定义和 schema 在不断变化；资产和 agent 的知识会过时，并开始返回细微出错的答案。

3. **检索失败（Retrieval failure）**：正确信息其实可能就在数据模型里、并且标注得当，但由于搜索空间过于庞大，agent 根本找不到它。

## 我们的 agentic 分析技术栈

在 Anthropic，我们把这三类错误降到最低的主要手段，就是我们的 agentic 数据栈。每一层的存在主要都是为了攻克其中一个或多个问题：

1. **实体歧义**：数据基础（data foundations）与真相源（sources of truth）把可能的实体空间收缩，直到只剩一个受治理（governed）的答案。

2. **陈旧**：维护与验证流程让一切不随业务变化而腐烂。

3. **检索失败**：skill 确保 agent 可靠地找到并正确使用那个答案。

> **🖼 图示：agentic 分析技术栈（三层，自下而上）**（依原文配图与上下文重建）
>
> ```
> ┌──────────────────────────────────────────────────────────┐
> │ Skills（技能）  —— 顶层                  ▶ 主攻：检索失败    │
> │   • knowledge skill：轻量顶层路由，把百万字段收窄到         │
> │     几十个策划好的参考文件                                  │
> │   • unbook skill：编码资深分析师流程 + 可复用分析模式        │
> ├──────────────────────────────────────────────────────────┤
> │ Sources of truth（真相源）—— 中层        ▶ 主攻：概念↔实体歧义 │
> │   信任度从高到低：                                          │
> │   语义层 › 血缘/转换图 › 查询语料库 › 业务上下文             │
> ├──────────────────────────────────────────────────────────┤
> │ Data foundations（数据基础）—— 底层      ▶ 主攻：实体歧义 + 陈旧 │
> │   规范数据集 / transform / 测试 / 表 / 元数据（共置同一仓库） │
> └──────────────────────────────────────────────────────────┘
>     每一层主要攻克三种失败模式中的一个或多个：
>     实体歧义 ── 数据基础 + 真相源
>     陈旧     ── 维护与验证流程
>     检索失败 ── skills
> ```
>
> 要点：栈是按"先收缩歧义、再保证可发现、再标记陈旧"的逻辑自下而上叠起来的——底层把可能实体收敛到唯一受治理答案，中层把"周活跃用户"这类措辞解析成具体实体，顶层确保 agent 真能找到并正确使用它。

### 数据基础（Data foundations）

确保分析 agent 准确的最重要一环，是**强健的数据基础**——包括数仓中的数据模型、transform、测试和表，以及描述它们的元数据。标准的数据工程与数据质量实践（维度建模、shift-left 测试、对关键管道做新鲜度与完整性检查等）依然全部适用（这里不再赘述）。

> **🖼 图示**（原文此处配有一张支撑性插画，图注大意）：*"维度建模等标准数据工程实践，其重要性一如既往。"* —— 强调引入 LLM 后，经典数据工程纪律并未失效，反而是分析 agent 准确性的地基。

发生改变的是：你数据模型的最终用户不再是数据专家（如数据科学家），而是代表用户行事的 agent——这些用户的数据专业度、对底层基础设施的理解程度参差不齐。这种转变带来一个挑战：结果不能要求用户去验证底层正确性，**因为最终用户根本不懂**。

数据基础层主要针对**歧义**：举例来说，如果 _revenue_（营收）能解析到一个受治理的数据集，而不是四十个看似可行的候选，那么在 agent 还没开始检索之前，问题就基本消失了。这里也是抵御陈旧的第一道防线，因为定义规范模型的同一个仓库，正是强制它们保持最新的天然场所。

我们发现以下几条实践尤其有效：

**创建规范数据集（canonical datasets）**：最常见的失败，是 agent 无法把一个概念（"产品 X 的营收"）映射到唯一正确的表、列和指标定义——通常是因为存在多个看似可行、实现却有微妙差异的候选。解法是：更少、治理更重的逻辑模型——策划一小批规范的、单一真相源（single source-of-truth）的数据集，它们归属清晰、可直接消费、可被发现，然后**激进地废弃**那些近似重复者。物理 rollup 和缓存对成本与性能仍然重要，但它们应当从规范模型**机械地派生**出来，而不是作为替代品与之并存。目标是：当 agent 检索某个概念时，它找到的是一个受治理的唯一答案。

**强制执行你的标准**：我们发现，只有当规范模型和指标定义被以下三者**强制执行**时，基础才站得住：被 _工具_ 强制（agent 在结构上被优先路由到它们，详见下文）、被 _CI_ 强制（绕过它们的改动在评审中失败）、被 _授权机制（mandate）_ 强制（下游团队基于受治理层构建，否则要解释为什么不）。没有强制的治理，会迅速退化回"多候选"问题。

**让产物共置（colocate artifacts）**：我们对抗数据模型与业务逻辑不断变化的主要防线是共置（colocation）。几乎所有数据代码（建模、语义层、参考文档、规范看板定义）都放在**同一个仓库**里，并用 CI 检查保护跨层完整性。如果一个建模改动会破坏下游看板或令某个已记录的指标失效，CI 会标记出来，修复在同一个 PR 里一起合入。（我们会在下面的 **Skills** 一节回到这套机制。）

**把元数据当作一等产品对待**：编码 agent 表现好，部分原因在于代码库是 _可读的（legible）_：README、类型签名、docstring 等等。你的数仓也可以同样可读，但前提是：列和表的描述、规范指标定义、粒度（grain）文档、有效取值范围、血缘（lineage）、归属（ownership）和模型分层（tiering），都要以与 transform 本身同等的严谨度来维护。这虽不是什么新洞见，但良好的治理提供了关键上下文，帮助 agent 选对数据集。

### 真相源（Sources of truth）

如果说数据基础是数仓本身，那么真相源就是 agent 用来导航数仓的参考界面。这一层降低概念 ↔ 实体歧义，把一个 stakeholder 问题里的"周活跃用户（weekly active users）"变成数据模型里一个具体的、受治理的实体。大致按信任度从高到低排列：

**语义层（Semantic layer）**：编译好的指标与维度定义。如果一个问题能干净地映射到一个已定义的指标，agent 就调用一个函数，得到一个数字——和公司里其他所有界面产出的是同一个数字。我们的 agent 被（通过 skill 指令）**在结构上强制要求优先使用语义层**（见附录）。一个我们尝试过、但 _没有_ 奏效的想法：通过让 LLM 从原始表和查询日志自动生成指标定义来"引导"语义层。它产出的定义看似合理，却把我们正想消除的那些歧义编码了进去，在我们的评测上相比一个更小、人工策划的语义层是**净负面**。因此我们建议：用 Claude 生成 _文档_，但让人来负责 _定义_。

**血缘与转换图（Lineage and the transformation graph）**：当语义层覆盖不到某个问题时，血缘和表排名（基于被引用次数）让 agent 能够推理：哪些上游模型为某个概念供数、哪些已被废弃、哪些共享粒度。这把"我不知道这个指标"转化为"我知道该从哪个受治理模型去聚合"。它也是我们在下文 **在线验证** 中所暴露的新鲜度与来源（provenance）信号的支柱。

**查询语料库（Query corpus）**：来自看板、notebook 和过往分析的历史 SQL。直觉上这应该很有价值：它是每一个已被正确回答过的问题的记录。_但实践中我们发现，给 agent 对数千条历史查询的原始检索访问权，准确率提升还不到一个百分点_（我们会在后面一节走一遍这个消融实验）。无结构的检索无法把一个新问题映射到正确的先例。真正有效的，是把这个语料库**提炼**成结构化的、分领域的参考文档和可复用的分析模式，写进 **skill**。把查询历史当作用于策划的原材料，而不是 agent 直接读取的真相源。

**业务上下文（Business context）**：大多数团队跳过的一层，也是我们最久没有重视的一层。一个不理解你业务的 agent，会回答用户**问了什么**，而不是用户**想问什么**。它不会知道"Q2 发布"指的是某个特定产品、两个团队对同一术语定义不同、或某个问题之所以被问是因为周四要开董事会。我们接入了一个公司知识图谱，由被索引的文档、路线图、决策日志和我们的组织结构构成，让 agent 能解析这些隐含引用、并提出更好的澄清问题。

这四者共同的失败模式，与数据基础层是同一个：**文档差或文档陈旧**。Claude 在弥合这一差距上极其有用（起草列描述、从查询模式提出指标文档、在 CI 中标记未记录的模型），但策划与归属由人来管理。

在接下来两节，我们讨论如何把这种"归属"的成本降到足够低，以至于它真的会发生。

### Skills

如果说真相源是 agent 的 _陈述性（declarative）_ 知识（即一个指标意味着什么），那么 skill 就是它的 _程序性（procedural）_ 知识：按什么顺序查阅哪些来源、如何在含糊的数据中导航、一份完成的分析长什么样。

在 Claude Code 中，一个 skill 是一个 agent 按需读取的 markdown 文件夹。在 Anthropic，我们开发的 skill 带来了巨大的增值。没有 skill 时，Claude 在我们评测上准确回答分析问题的能力不超过 **21%**。加入 skill 后，这些数字在总体上稳定**超过 95%**，在某些领域经常达到 **99% 左右**。我们创建大多数 skill 所用的骨架见附录。

一些最佳实践：

**创建成对的 skill（pairwise skills）**：一个 **_knowledge_** skill 充当一个轻量的顶层路由器，让额外的领域细节按需加载。它说的是"先试语义层，但如果没有覆盖，这里有约 30 个该领域的参考文件，描述相关的表、列、join 和坑（gotcha）"。这个路由器实际上就是我们对**检索失败**的回答：与其让 agent 在一个百万字段的数仓里搜索，不如在写出任何查询之前，把空间收窄到几十个策划好的文件。**_unbook_** skill 编码了一位资深分析师会遵循的流程：澄清问题、找来源（通过 knowledge skill）、跑查询，然后把结果送进对抗式评审子 agent（adversarial review sub-agents）循环。它还打包了十几个可复用的分析模式（留存曲线、率分解、漏斗分析），让常见请求不必每次都重新发明。

**创建合适的参考文档（reference docs）**：为 LLM 检索而写。我们的参考文档描述：表（粒度、范围和排除项）、坑的机制（例如"排除已知的免费邮箱域名，但保留像 anthropic.com 这样的自定义域名"）、以及明确的路由触发条件（例如"IF 问题是关于实验提升（experiment lift）……DO NOT 用于原始事件计数"），而不写那些会过时的、规定死的菜谱。

**把 skill 维护当作一等公民**：skill 文档描述的是一个每天都在变的数据模型，所以没有主动维护，它们几周内就会出错。我们眼睁睁看着离线准确率从上线时的约 95% 在一个月内漂移到约 65%，之后才把这当成一个工程问题来对待。这意味着：把 skill markdown 文件**共置**在与 transform 模型相同的仓库里，于是改模型的那个 PR，就是更新描述它的那份文档的那个 PR。一个代码评审钩子（code-review hook）会标记任何"改了报表模型却没碰 skill 文件"的改动。如今我们约 **90%** 的数据模型 PR 在同一个 diff 里包含 skill 改动。我们也会随着模型变强、旧失败模式不再适用，定期修剪 skill 脚手架。

**在所有界面上创造一致且无缝的体验**：同一个 skill **必须**对 Slack、IDE、看板工具和独立 agent 会话里的问题，给出**同一个答案**。我们靠两点做到这一点：确保一个规范来源（数据仓库），以及 skill 改动被自动同步。合并时，skill 会同步到一个插件市场（给 IDE 用户）、到云存储 blob（给读取单一文件的托管应用）、并通过 MCP 直接作为资源（resources）提供。我们从一开始就为可移植性而设计：避免硬编码仓库路径和界面特定的命名空间。

### 验证（Validation）

最后，验证是你弄清楚三种失败模式中哪一种仍在漏过去的方式。

#### 离线评测（Offline evaluations）

我们常见到一种模式：数据团队搭建了精致的分析环境，却没有任何流程去理解自己分析 agent 的准确率。

弥补这一空白的一种方式是离线评测——简单的"问题/答案"对。你可以把离线评测类比为 ML 模型的离线测试：它们不告诉你线上 agent 的表现，但能让你很好地感知是否存在任何关键缺口。

在 Anthropic 我们部署两类离线评测。**基于看板的评测（Dashboard-based evals）**由 Claude 自动生成（再经人工校验），覆盖最常见的 stakeholder 问题。**长尾评测（Long tail evals）**则是我们把业务上下文（路线图、表文档）喂给 Claude，让它在领域其余部分生成看似合理的问题。我们还持续收割每一次 stakeholder 在某个 thread 里纠正 agent 的情形——那次纠正就是一个候选评测。

其他最佳实践包括：

* **锚定 ground truth，使其不会漂移**：针对实时数据写的评测，在底层数字一变的那一刻就过时了。把每个评测钉到一个快照日期、针对一个稳定的事实表来写、或让评分器去判断 agent 的 _查询_ 而不是它的 _数字_。把整套评测接进 CI，这样一个触及依赖的 PR 会重跑受影响的评测。

* **把结果像遥测（telemetry）一样存，而不是像测试日志一样存**：每次运行都落进一张数仓表，带上 skill 版本、git SHA、模型 ID、逐断言的通过/失败、token 数和墙钟时间。"那个改动有没有帮助？"就变成了一条查询，而且你能拿到时间序列，去捕捉单次 CI 跑发现不了的缓慢回退（slow regression）。

* **按领域设置上线门槛**：在某个领域所有者那一片评测集清过某个阈值（我们最初用约 90%）之前，他不能向自己的 stakeholder 宣布 agent 可用。这迫使参考文档的修复发生在用户看到失败 _之前_。

* **创建恰当数量的评测**：你应该有多少评测，取决于业务领域的复杂度和底层数据模型的复杂度。通过追踪"离线准确率对线上准确率的预测能力"来校准：我们发现每个主题（如"增长"）超过几十个之后就边际递减，而且这个上限随着每一代新模型而下降。

* **离线评测准确率应当约为 100%**；每一个正确答案也应该命中你的语义层（如果你有的话）。再强调一次，这个准确率水平并不告诉你系统不会产生错误答案，只是告诉你（在你有恰当评测覆盖的前提下）没有明显缺口。

#### 消融技术（Ablation techniques）

关于 skill 的每一个结构性决策（暴露哪些来源、某个子 agent 是否对得起它的延迟、是否把两个 skill 合并成一个）都是在保持离线评测集固定的前提下做出的。

我们恰好只改变一个组件，然后比较通过率。每次跑只需一个小时，却能取代大量的争论。**方法论比任何单个结果都重要**：

* **为零结果（null results）而设计**。我们最有用的一次消融是个负面结果。我们给了 agent 对我们全部看板、transform 和分析师 notebook SQL（数千个文件）的直接 grep 访问权。我们随后在转录（transcript）里核实它确实在每次回答前读了它们。准确率在任一方向上变化都不到一个百分点。我们接着检查了显而易见的混淆因素：对它答错的那些问题，答案是否真的在语料库里？大约 80% 的情况，是的。"答案存在"是否预示"现在答对了"？没有——翻转率是平的。信息就在那里，agent 也看到了，它就是没用。那一个实验告诉我们：我们的瓶颈不是对过往工作的 _访问_，而是 _结构_（即把问题映射到正确实体）。这个洞见改变了好几个月的路线图。

* **在 PR 粒度上做消融**。每一次有意义的 skill 编辑，都会在相关评测切片上做一次前/后对比跑，把 delta 写进 PR 描述。这让"我改进了文档"这句话保持诚实，并捕捉那种出人意料地常见的情况——一个善意的添加反而让事情变糟。

* **保留一份"什么没用"的短清单**。我们的两个例子：在某个点之后继续堆叠文档精炼的轮次（我们连续三次净负面迭代：文档变长了，而不是变好了），以及把对抗式评审者换成更便宜的模型以削减延迟（它丢掉了大部分准确率收益，却没换来真正的提速）。负面结果记录起来很便宜，而且能防止下一个人重跑同样的实验。

#### 在线验证（Online validation）

最后一步是确保实际的线上系统表现尽可能准确。我们采取的一些步骤包括：

* **对抗式评审（Adversarial review）**：我们发现，用一个 Claude skill 去激进地质疑某个潜在最终答案的所有底层假设，在我们评测集内把准确率提升了 6%，但代价是 token 多用 32%、延迟高 72%。

* **来源页脚（Provenance footer）**：每个回答都带一个页脚，包含：它来自哪一层来源（语义层 › 策划参考 › 原始表）、底层数据有多新、以及谁拥有该模型。它不会让答案更正确，但确实帮助消费者判断能多大程度上信任这个回答。一个"原始表、新鲜度未知"的页脚，是"在上报之前请先核实"的信号——也是我们针对静默失败为数不多的缓解手段之一。

* **数据质量检查（Data quality checks）**：有可能 agent 用对了字段、也用对了方式，但数据本身是错的。加上基本的数据质量检查，确保被引用的字段是最新的、完整的、没有异常，通常是良好的卫生习惯。

* **被动监控（Passive monitoring）**：我们持续追踪两个生产信号——通过语义层解析的 agent 查询占比，以及使用纠正性措辞（"用错表了"、"你漏了欺诈过滤"）的回答占比。两者都喂进一个每周与离线通过率一起评审的看板。

* **主动收割纠正（Active correction harvesting）**：闭环的那一部分。一个定时 agent 每隔几个小时扫描 stakeholder 频道，寻找类似的纠正性措辞，为相关参考文档起草一行修复，并开一个标记给领域所有者的 PR。修复路径被刻意做得"无聊"——编辑一个 markdown 文件、合并、自动同步到各处——这样领域所有者不必在这件事上花太多时间。同一批纠正也回流进离线评测集。

这一切都无法完全捕捉的失败模式，是**静默**的那种：答案是错的，但看起来合理，且在无人反对的情况下被使用了。我们的缓解手段是：来源页脚、对任何要送到领导层的东西做明确的人工签字（sign-off）、以及为每个领域的头部 KPI 设一个常驻评测，每天对照"加持过的（blessed）"看板做合理性核查——尽管我们还没有一个稳健的解决方案。

## 如何起步

如果你从零开始，少数几个规范数据集、几十个离线评测、和一个轻薄的 knowledge skill，就能拿下大部分上行收益；本文其余的一切，都是我们在这些建好之后才加上去的。

我们也分享了许多最佳实践，但并非每一条都适合每个数据团队。通过自问以下问题，与你的组织在几条会影响你做法的原则上对齐：

* **今天的正确答案有多重要，相对于未来？** AI 模型在飞速进步。我们常看到公司投入大量基础设施去弥补当前模型的不足，而一旦那些模型变强，这些投入就成了多余。知道模型在哪里不足、并等待模型改进来填补缺口，开销要小得多——但这可能不符合你公司的风险容忍度。

* **你预期你的业务复杂度会随时间如何变化？** 我们讨论的一些流程可能是过度设计——比如，如果你产出的数据不多、输出的消费者只有寥寥几个、或你的数据模型大概率会保持简单。

* **你的输出面向的受众有多技术？** 换个说法：如果你为能识别答案错误的数据科学家构建这套分析系统，相比受众对底层数据模型毫无了解的情形，你或许能更容忍错误。

* **你愿意为提升准确率花多少钱？** 我们发现像对抗式验证这样的某些流程能显著提升准确率，但往往以更高的成本和延迟为代价。

* **你对访问控制与内部数据隐私的接受度如何？** agent 往往上下文越多越高效；然而宽泛的数据访问与多数公司的治理姿态相悖。这决定了你是在构建一个 agent，还是多个限定范围（scoped）的 agent。

无论你走哪条路，我们最大的收益都来自应对那三种失败模式：把歧义收拢成一个受治理的唯一答案、让这个答案易于被发现、以及在其中任一者过时时发出标记。

_本文由数据科学与数据工程团队成员 Chen Chang、Clement Peng、Justin Leder、Johanne Jiao 和 Josh Cherry 撰写。作者感谢 Michael Segner 的贡献。_

## 附录

### Skill 文件骨架

以下是我们主数仓 skill 的骨架：真实文件的结构，内部细节用 `[方括号占位符]` 替换。它不是用来逐字复制的；它是用来展示"我们发现值得写下来的那些章节类型"的。

> 译注：以下骨架保留英文原文（它是 LLM 直接读取的文件内容，结构本身即信息）。

```
---
name: [warehouse-skill]
version: [x.y.z]
description: "IF the user asks to query [the company]'s data warehouse for any
  [list of business domains] question — THEN invoke this skill. DO NOT invoke
  for [adjacent engineering tasks] or questions with no data-warehouse component."
---

# [Warehouse] Skill Instructions

## Description
The single source of truth for safe and effective [warehouse] querying.
Referenced by other skills [listed] for query execution guidance.

Act as a Data Analyst, providing strategic insights and data-driven
recommendations but seek guidance along the way.

**Out-of-scope decisions**: [product areas, etc.] → surface data only,
state "decision is [owning team]'s call", do NOT take a position or author
code fixes.

## Executing queries
Priority:
1. **[Managed connection]** (if available): [query tool] / [schema tool]
2. **[CLI fallback]** (if installed): [default project, fallback project]
3. **Neither** — ask the user to authenticate, then stop

---

# Semantic Layer (REQUIRED first step)

The governed semantic layer is the **mandatory default path** for every data
question — same numbers as [the BI tool], joins/grain/filters baked in. Raw SQL
via the reference docs below is the **fallback**, used only after the
semantic-layer path is shown not to cover the ask.

## Required workflow
1. **Load** — [how to load the semantic layer in each runtime, with fallbacks]
2. **Discover** — search measures/dimensions by keyword; **always check
   segments** (the named canonical population filters — hand-rolled WHERE
   clauses for these are the dominant wrong-answer mode)
3. **Compile + run** — build the spec → compile to SQL → execute
4. **Fallback** — only if discovery finds no relevant metric or compile fails
   → raw SQL via `references/*.md` (PART 3 below)

> **Don't bail early.** Do NOT fall back to raw SQL on these grounds:
> - "[custom date filtering / cohorts]" → [covered by time-dimension specs]
> - "[needs a join]" → [the metric layer already encapsulates its joins]
> - [3–4 more pre-rebutted excuses agents use to skip the semantic layer]

### Date windows & timezone — decide before you query
- **As-of date vs trailing-N days**: [convention for each]
- **"Last week/month"** → the last *complete* calendar week/month, not trailing-7/30
- **Timezone default**: [TZ]; [exception for certain reporting rollups]
- **Freshness lag**: [some] tables settle late — anchor on MAX(date), not "yesterday"

---

# PART 1: MUST KNOW (Read First for Every Request)

## 🚀 Quick Start Workflow
1. **Check for red flags first**: [restricted/PII requests, gated domains,
   high-stakes asks that need extra validation]
2. **Out of scope — escalate, don't guess**: [access requests, pipeline
   troubleshooting, stale dashboards, root-cause assertions, product/pricing
   recommendations] → redirect to [the owning team], don't answer
3. **Clarify the request**: time period, segment, the business decision it informs
4. **Check for existing dashboards**: [per-domain dashboard catalogs]
5. **Identify the data source**: [navigation map below; prefer governed/aggregated tables]
6. **Execute the analysis**: [required filters + adversarial review]
7. **Deliver insights**: show methodology, differentiate observations from interpretations

## 🏢 Business Context

### Entity Disambiguation (MUST CLARIFY)
- **"[Term A]" can mean**: [entity 1] or [entity 2] — always clarify which
- **"[Term B]" can mean**: [entity 1] → [entity 2] → [entity 3] (one-to-many chain)
- **"Users"**: [which identifier gives accurate counts, and which ones inflate them]

### Business Terminology
- [Current product names vs deprecated aliases that still appear as frozen
  values in the data layer — write with the new names, filter with the old]
- [Key internal acronyms]
- **[Headline metric] calculations**: [monthly / default window / leading indicator]
- **Unfamiliar terms — search [internal docs], don't guess**

### Data Integrity Requirements ⚠️
- **NEVER**: make up data/columns; make speculative assertions beyond what data shows
- **ALWAYS**: use safe division; differentiate observations ("data shows X")
  from interpretations ("this suggests Y"); flag limitations

---

# PART 2: HOW TO DO (Follow During Execution)

## 🔧 Technical Execution Guide
- [Managed-connection tools and CLI invocation details]
- **PII protection**: for restricted data, return the SQL for the user to run
  themselves — do not return results

## 📊 Analysis Best Practices Guide
1. Clarify the ask before querying
2. Show your work (filters, inclusions/exclusions, freshness)
3. Clarify denominators
4. Consider sample bias
5. Connect to business impact
6. **Adversarial SQL review (MANDATORY)** — spawn the [sql-reviewer] sub-agent
   for every query before the final answer; blocking findings must be fixed
   and re-reviewed; do not self-certify
7. **Report with provenance** — every answer ends with a footer:
   > **Source:** [semantic layer | governed table | raw exploration] ·
   > **Confidence:** [tier] · **Reviewed:** [reviewer ✓, round N] ·
   > **Freshness:** [max date in the data] · **Owner:** [owning team]

---

# PART 3: DATA REFERENCES & RESOURCES

## 📚 Knowledge Base Navigation
### [Domain A] → `references/[domain_a].md`
- **Use for**: [kinds of questions]
- **Key tables**: [...]
- **Dashboards**: `references/[domain_a]_dashboards.json`

### [Domain B] → `references/[domain_b].md`
- **Use for**: [...]

[... one entry per business domain — a few dozen in total ...]

## ⚠️ Troubleshooting Guide

### When Information Is Missing
- [missing tables / access denied / outdated docs / unknown enum values → what to do]

### Field Naming Gotchas
- Use `[field_x_v2]` NOT `[field_x]`
- [Two similarly-named tables report the same metric at different grains — which to use]
- [Which of two plausible sources is canonical for the headline metric]
- [… a dozen more hard-won one-liners …]
```

---

**相关文章：**

- **2026-06-05：** The Claude Cowork product guide
- **2026-06-05：** How one Anthropic seller rebuilt his team's workflows with Claude Code
- **2026-06-03：** Best practices for getting started with Claude Cowork
- **2026-05-27：** Using LLMs to secure source code
