# 从 nao 项目借鉴 Context Engineering

日期: 2026-06-08
来源: `/Users/zhouhang/vibe/agentic-arch/nao`（开源 analytics agent 框架，[getnao.io](https://getnao.io)）

本文拆解 nao 的 Context Engineering 方法论，提炼对 `databricks-builder-app-oai` v0.3.6 的借鉴点，并映射到 [`gap-analysis.md`](../builder-app-oai/v0.3.6/gap-analysis.md) / [`design.md`](../builder-app-oai/v0.3.6/design.md)。可与 [`dash-context-engineering.md`](./dash-context-engineering.md) 对照看：dash 给的是「实现样板」，nao 给的是「方法论 + 生命周期」。

## 0. nao 是什么，为什么值得看

nao 是一个「先做上下文、再部署聊天」的 analytics agent 框架：用 `nao-core` CLI 把数据/元数据/文档/规则建成一个**文件系统式的 context**，再部署 UI 给业务用户提问。它最大的价值是**把 Context Engineering 当成一门有原则、有 playbook、有评测、有生命周期工具的工程学科**——这正是 builder-app-oai v0.3.6 想补的「方法」层。

它的 CE 体系由四份文档 + 六个技能构成：

- `docs/.../context-engineering/{principles, playbook, evaluation, skills}.md` —— 原则、落地步骤、评测、技能。
- `docs/.../context-builder/*.md` —— 文件系统 context 的各类来源（databases / repos / rules / semantics）。
- `skills/{setup-context, write-context-rules, create-context-tests, audit-context, add-semantic-layer, deploy-context}` —— 把 CE 生命周期做成可被任意 agent CLI 调用的 `SKILL.md`。

## 1. 把 Context Engineering 当可度量的工程学科

nao 的 `principles.md` 开宗明义：context engineering 的目标是**优化 agent 性能**，沿用数据工程的 **Measure → Iterate → Optimize** 三步。性能用三维度量：

| 维度 | 指标 |
|---|---|
| Reliability | % 能回答的问题、% 回答正确 |
| Speed | 响应时延 |
| Cost | **token 成本 + 查询执行成本** |

「最优平衡」判据写得很准：

> 上下文太少 → 答不出 / 写错 SQL / **需要多次探索性查询（推高成本）**；太多 → token 贵、变慢、被无关信息干扰；最优 = 必要信息齐全、无探索性查询、排除无关 schema、模块化。

**对我们的启示（对应 to-be §4 预算）**：to-be 有 `ContextBudget`，但只盯着 token/char，**漏了「查询执行成本」这一维**——上下文不足时 agent 会跑探索性 schema 查询，既费 warehouse 钱又增延迟。我们的 schema gate（as-is §5）其实是同一原理的另一面：它**强制**先 `get_table_schema` 再写 SQL；但 nao 的主张更进一步——**与其运行时查 schema，不如把 schema 直接放进上下文**，从源头省掉那次查询。建议 to-be 把「reliability / speed / cost（含查询执行）」作为 context 质量的显式指标闭环，而不只是字符预算。

## 2. MECE 原则：每个指标只有一个规范定义

nao 把上下文质量量化成 **MECE**（principles.md「Concrete Rules #1」）：

- **Collectively Exhaustive**：用户可能问的所有指标/数据点都要在 context 里有定义。
- **Mutually Exclusive**：每个指标只有**一个**规范定义，跨表/跨文档不冲突；同名指标到处含义一致。

> 缺定义 → 答不全；定义冲突 → 答不一致。agent 需要每个指标的 single source of truth。

**对我们的启示（对应 as-is §3 glossary/metric_views / to-be §7）**：builder-app 有 glossary、metric_views、known_caveats，但**没有强制 MECE**——如果两个 Metric View 或 MV 与 raw table 对同一指标口径不一致，模型会静默给出不一致答案。建议把「MECE 一致性检查」纳入 to-be §11 的 contract test：扫描项目里同名指标的多处定义，冲突即失败。

## 3. 文件系统 context + orchestration（最值得抄的一条）

nao 的核心架构：**一份 lean 的 `RULES.md` 每条消息都发，细节放进按需读取的子文件**（rules-context.md）。

```
your-project/
├── RULES.md              # 精简核心规则，每条消息都带
└── agent/semantics/
    ├── marketing.md      # 营销域细节——仅在需要时读
    ├── finance.md
    └── product.md
```

`RULES.md` 里用 **Orchestration 段**显式指路：

```
## Orchestration - Domain-Specific Context
- Marketing questions: Read `agent/semantics/marketing.md`
- Finance questions:   Read `agent/semantics/finance.md`
```

> 文档原话：RULES.md 每条消息都发，**保持精简**；用 orchestration 把 agent 指向专门文件获取细节。per-table 细节属于 `databases/<table>.md`，不属于 RULES.md。

这本质就是 compile-vs-retrieve，但用**第三种实现**：不是向量检索（dash），而是**agent 自己用文件读取工具按需拉细节**。

**对我们的启示（最高价值，对应 to-be §3/§4.5/§7）**：builder-app-oai **已经有 `read_project_file` 作为 base tool**（as-is §7），且每个项目目录里已有 `requirements.md`、`gap-analysis.md`、`readiness.md`、`metric-view-context-engineering.md` 等文件（as-is §9）。这意味着 nao 的模式可以**几乎零改造地落地**：

1. 把当前全量塞进 system prompt 的 `metric_view_context` 细粒度字段、`requirements`、`sample_queries`、`known_caveats`**下沉成项目文件**，prompt 里只留精简指针 + orchestration 段（「KPI/口径类问题先读 `metric-view-context-engineering.md`」）。
2. 这一步同时压三笔成本：L1 guidance、L3 注入、**以及 to-be §4.5 的工具 schema 常驻成本**——因为 prompt 变瘦了。
3. 与 to-be §7「按需注入」相比，这是更轻的实现：不需要先建 requirement matcher，**靠 prompt 里的 orchestration 指针 + 模型已有的 `read_project_file` 就能 JIT 拉取**。requirement matching 可作为「自动决定读哪个文件」的增强，而非前置条件。

> 一句话：nao 证明了「瘦 prompt + orchestrated 文件读取」是可行且高效的 CE 模式，而我们恰好已具备落地它的全部零件（`read_project_file` + 项目文件目录）。

## 4. 六段式 RULES.md 模板（含 Date filtering 一等公民）

`write-context-rules` 技能定义了 analytics-agent 上下文的标准六段（skills.md）：

1. **Business overview** —— 产品 + 商业模式。
2. **Data architecture** —— 仓库、技术栈、分层、数据源。
3. **Core data models** —— `Most Used Tables`（一行指针）+ `Tables detail`（Purpose / Granularity / Key Columns ≤10 / Use For）。
4. **Key Metrics Reference** —— 按类别分组，`**指标** → 表.列, 公式`。
5. **Date filtering** —— 周边界（周一/周日）、当前周期是否计入、last X weeks/days/current month 的规范 SQL。
6. **Analysis Process** —— Understand → Select Table → Write Query → Validate → Context。

**对我们的启示（对应 as-is §3 Project Management Context 的字段清单）**：这是一份经过实战的「analytics agent 项目上下文应该包含什么」的 checklist。对照我们的 `_render_project_context`（渲染了 metric_views/glossary/caveats/sample_queries 等），**最明显缺的是 §5「Date filtering」这一等公民段**——周边界、当前期是否计入正是导致时间相关问题答错的高频歧义，而 Distribution 这类按月（202604）分析尤其吃这个。建议把「日期/周期约定」加入 build_project_context 的渲染清单。另外「Key Columns ≤10」「Tables detail 上限」是现成的 §4 预算常量参考。

## 5. 评测：比数据正确，而非让 judge 打分

`nao test`（evaluation.md）的评测远比「LLM judge」硬核：

- 测试就是 `{name, prompt, sql}` 三元组的 YAML。
- 运行：把 NL `prompt` 发给 agent → 抽取 agent 答案为结构化数据 → 同时执行测试里的期望 `sql` → **逐行 diff 两份数据**（归一化、按列排序、忽略行序、数值用 `allclose` 容差）。
- 每个测试还记录 **token 成本、时延、`tool_call_count`**。
- **test mode 去掉 clarification 工具**，强制 agent 做假设而非挂起，保证确定性。

两条防过拟合的作者规则很关键：

- **prompt 要像真实聊天**：短、模糊、不含表/列/方法提示（`"How's churn looking this quarter?"`，不是 `"churn rate from fct_subscriptions in Q1"`）。
- **输出列名编码格式/单位，不编码来源**（`churn_rate_float_0_1`，不是 `churn_rate_from_fct_subscriptions`）——防止 agent 靠 schema 名 pattern-match 作弊。

**对我们的启示（对应 to-be §11 contract tests）**：to-be §11 目前是 snapshot/契约测试（prompt shape、budget、schema gate），**守的是「上下文长什么样」，没守「答案对不对」**。nao 的 data-diff 评测补上了正确性这一层，且与我们已有的 MLflow + GEPA 评测框架（仓库 `.test/`）方向一致。两个可直接抄的点：(a) 用 **`tool_call_count` 作为上下文充分性的代理指标**——次数多 = 上下文不足、做了探索查询；(b) 测试 prompt 必须像真实聊天、列名编码单位而非来源，防止评测泄漏。

## 6. 把 CE 生命周期做成技能闭环

nao 把整个 CE 流程做成六个可被 Claude Code/Cursor 调用的技能，有清晰的状态机（skills.md）：

```
setup-context → write-context-rules → create-context-tests → audit-context（任意时刻，只诊断）
                                              │
                              tests 暴露 metric 可靠性缺口？
                                              ▼
                                       add-semantic-layer →（回到 write-context-rules）
ready to ship → deploy-context（CI/CD）
```

两条很有纪律的设计：

- **`audit-context` 只诊断、从不修复**：输出一段带优先级的计划，把每个发现**路由到负责修它的技能**（write-context-rules / add-semantic-layer / create-context-tests），还带工时估计。诊断与修复分离。
- **`add-semantic-layer` 只在 `nao test` 证明 metric 可靠性失败后才做**：文档明说「语义层会缩小可回答问题的范围，只有当可靠性是瓶颈时这笔交易才划算。schema 缺失或日期逻辑错误是规则修复，不是语义层修复。」

**对我们的启示（强力背书 to-be §7.3 的决定）**：to-be §7.3 决定「先不引入 `query_metric_view` 专用工具，依评测再定」。nao 给了同一判断的成熟版本——**语义层/专用查询通道是有代价的约束，只在评测证明 metric 不一致时才上**。这把我们的「defer」从直觉升级成了**证据门控的决策规则**。另外 `audit-context` 的「诊断-only + 路由到修复技能」模式，值得我们做一个 builder-app 项目的 context 审计清单（见下条）。

`audit-context` 的六项检查可直接改造成我们的 context 质量 rubric：

1. **同步状态 + 范围**：≤100 表硬顶、≤20 理想，**「范围过大是可靠性失败的头号预测因子」**。
2. RULES.md 六段：逐段标 present / missing / thin，揪 `TODO:` 和无 source-of-truth 指针的指标。
3. 逐表覆盖：每张表是否有 detail 块、dbt 文档、列说明。
4. **MECE 一致性**：两表同指标算法不同？问得到的指标没有表能答？同义不同名的列？
5. 测试覆盖：把每个失败归类（数据模型 / 日期 / 测试本身 / 解释 / 指标定义）。
6. token 优化：>40KB 文件、超 10 列的 detail 块、RULES.md 与 `databases/<table>.md` 的重复。

## 7. 范围纪律是头号可靠性杠杆

nao 的 playbook 和 audit 反复强调一条朴素但高杠杆的规则：**从 ≤20 张表起步，≤100 硬顶，优先 gold/mart 层，避开 raw staging**。oversized scope 被明确点名为「可靠性失败的最大预测因子」。

**对我们的启示**：builder-app 的项目通过 `input_tables` / `metric_views` 配范围，但没有「范围纪律」的显式指导或告警。可在项目 onboarding / audit 里加一条：超过 N 张表/MV 时显式警示，并建议收敛到 gold 层——这是零成本、高回报的可靠性手段。

## 8. takeaways 映射表

| nao 模式 | builder-app-oai 落地点 |
|---|---|
| CE = 可度量学科，三维指标含**查询执行成本**（§1） | to-be §4 预算扩成「reliability/speed/cost」指标闭环；度量探索查询成本 |
| MECE：指标单一规范定义（§2） | to-be §11 加 MECE 一致性 contract test |
| **瘦 prompt + orchestrated 文件读取**（§3） | **最高优先**：用已有的 `read_project_file` + 项目文件，把细粒度上下文下沉，prompt 留指针；同时压 §4.5 工具 schema 成本 |
| 六段式 RULES.md，Date filtering 一等公民（§4） | 给 `build_project_context` 渲染清单补「日期/周期约定」段 |
| 评测比数据正确 + `tool_call_count` 信号（§5） | to-be §11 从 snapshot 升级到 data-correctness；接入 `.test/` MLflow |
| CE 生命周期技能闭环 + audit-only（§6） | 背书 §7.3 证据门控；做 builder-app context 审计 rubric |
| 范围纪律 ≤20/≤100（§7） | onboarding/audit 加范围告警，建议收敛 gold 层 |

## 9. 不要照搬的地方

- **单租户 CLI 文件系统 vs 多租户 DB-settings**：nao 的 context 是本地文件 + git 版本化；我们是 DB settings + release snapshot（as-is §9）。nao 的「文件即上下文」可借鉴，但我们的 source-of-truth 是 DB（to-be §9），文件下沉要走项目目录 + `read_project_file`，并受多租户安全边界约束（不能让一个租户读另一个的文件）。
- **`read_project_file` 的安全前提**：nao 假设单用户本地可读全部文件；我们的文件读取必须限定在当前项目目录内（`run_state.project_dir` 已 resolve），下沉细节文件前要确认读取边界。
- **dbt/Looker 生态假设**：nao 的语义层、six-section 模板默认 dbt schema.yml、MetricFlow 等；我们是 Databricks Metric Views + UC，模板要换成 MV/UC 术语，不能逐字移植。
- **评测依赖期望 SQL**：nao test 要求每个测试写出 ground-truth SQL；Distribution 的 validation slice（readiness.md 的 202604）可充当这个 ground truth，但要注意 nao 强调的防泄漏规则（prompt 别含表名/列名）。

> 一句话总结：**nao 教我们的是「把 Context Engineering 当工程学科来度量、用 MECE 守一致性、用瘦 prompt + 按需文件读取控规模、用数据正确性评测守质量、用证据门控决定要不要上语义层」这套方法论与生命周期；其中『瘦 prompt + orchestrated `read_project_file`』因为我们已有现成零件，是 v0.3.6 最快能落地的一条。**
