# 从 Dash 项目借鉴 Context Engineering

日期: 2026-06-08
来源: `/Users/zhouhang/vibe/agentic-arch/dash`（基于 [Agno](https://docs.agno.com) 的自学习 data agent）

本文拆解 Dash 这个数据 agent 的 Context Engineering 做法，提炼对 `databricks-builder-app-oai` v0.3.6 有借鉴价值的模式，并逐条映射到 [`gap-analysis.md`](../builder-app-oai/v0.3.6/gap-analysis.md) / [`design.md`](../builder-app-oai/v0.3.6/design.md) 的对应章节。

## 0. Dash 是什么，为什么值得看

Dash 是一个跑在 Postgres 上的 SaaS 指标分析 agent：一个 Leader 协调 Analyst（只读 SQL）和 Engineer（写 `dash` schema）两个专家。它规模小（6 张表、单数据集、单一业务域），但**把 Context Engineering 做成了显式、分文件、可测试的模块**——正是 builder-app-oai v0.3.6 想达到的形态。它的价值不在功能，而在**结构选择**：哪些上下文编译进 prompt、哪些运行时检索、哪些写回、哪些用 eval 守住。

架构速览：

```
dash/
  team.py            # Leader（仅 learnings）+ Analyst + Engineer
  instructions.py    # 角色指令 + 语义模型 + 业务上下文 的动态拼装
  context/           # 运行时 prompt builder（读 knowledge/）
    semantic_model.py    # 表元数据 → prompt 段（带截断）
    business_rules.py    # 指标/规则/gotcha → prompt 段
  tools/build.py     # 按角色装配工具（schema 边界）
knowledge/           # 1:1 映射进向量库的数据文件
  tables/*.json      # 表元数据（含 use_cases、data_quality_notes）
  queries/*.sql      # 验证过的查询模式
  business/*.json    # 指标、业务规则、gotcha
evals/cases/         # accuracy/routing/security/governance/boundaries
```

## 1. 编译 vs 检索：上下文按数据特性二分

Dash 最值得学的一点：它**不是把所有上下文都塞进 prompt**，而是按数据特性分两条路：

- **编译进 prompt（compile-time）**：语义模型（6 张表的元数据）和业务规则。数据小、稳定、几乎每个问题都相关 → `instructions.py::build_analyst_instructions` 在构建时把它们格式化进 system prompt（`format_semantic_model` / `build_business_context`），每轮都在。
- **运行时检索（retrieval-time）**：验证过的查询（`knowledge/queries`）、Engineer 建的 `dash.*` 视图、错误经验（learnings）。数据大、条件相关、会增长 → 存进 PgVector，Analyst 在 workflow 第 1-2 步**主动 search knowledge / search learnings**，命中才进上下文。

> 判据：**小 + 稳定 + 普遍相关 → 编译；大 + 条件相关 + 持续增长 → 检索。**

**对我们的启示（对应 to-be §4 预算 / §7 按需注入）**：as-is 目前是「静态大 prompt + 全量 suffix」，靠字符上限截断。Dash 提示我们：与其把 `metric_view_context` 细粒度字段、`requirements`、`sample_queries`、`known_caveats` 全量塞进 prompt 再截断，不如把这部分**改成检索**——按问题命中再注入。这给了 to-be §7「按需注入」一个更彻底的实现方向：从「确定性 requirement matching 决定渲染开关」升级到「向量检索项目知识」（可作为 v0.4 选项）。

## 2. 双层记忆：curated knowledge vs discovered learnings

Dash 把「记忆」拆成两个语义不同的系统（CLAUDE.md「Dual knowledge」）：

| 系统 | 存什么 | 怎么演进 | 谁能看 |
|---|---|---|---|
| **Knowledge** | 表 schema、验证查询、业务规则、**Engineer 建的 dash 对象** | 人工 curated 文件 + Engineer 的 `update_knowledge` 写回 | 专家（Analyst/Engineer） |
| **Learnings** | 错误模式、类型坑、发现的修复 | LearningMachine 自动管理（AGENTIC） | 仅 Leader（`add_learnings_to_context=True`） |

关键设计：**「数据是什么」（knowledge，事实）和「我们踩过什么坑」（learnings，经验）分开存、分开给**。Leader 只需要经验来做路由，不需要 schema 细节；专家需要 schema 不需要全局经验。

**对我们的启示**：builder-app-oai 目前只有 curated 一侧——`known_caveats`、`approved_memory`、`sample_queries` 都是人写进 settings 的（as-is §3）。缺一条**「发现侧」**：agent 跑数据时踩到的口径坑、列类型问题没有沉淀回路。可考虑在 to-be 里加一个 discovered-learnings 存储，与 curated 的 `known_caveats` 区分开。

## 3. 自学习写回闭环

Dash 的「self-learning」不是噱头，是两个写回工具构成的闭环：

- `save_validated_query`（`tools/save_query.py`）：查询成功且用户确认后，把 SQL 连同 question/tables_used/data_quality_notes 存进 knowledge。带校验——只允许 `select`/`with`、禁止多语句。
- `update_knowledge`（`tools/update_knowledge.py`）：Engineer 每次建视图后，把视图名、join、列类型、use case、示例查询写回 knowledge。

闭环：**Engineer 建 `dash.monthly_mrr` → `update_knowledge` 记录 → Analyst 下次 search knowledge 命中 → 优先用视图而非 raw table**。指令里明确写「if you don't record it, it won't be used」。

**对我们的启示（对应 to-be §7.3 是否引入 MV 工具 / §8 history）**：我们的 `sample_queries` 是静态 curated 的。Dash 提示一条增量路径——让验证通过的 MV 查询/口径**写回项目知识**，下一轮检索复用。这比「引入 query_metric_view 工具」更轻，且直接喂养 §7 的按需注入。注意 Dash 的写回带强校验（只读、单语句），与我们 read-only allowlist 思路一致。

## 4. 文件源 → 格式化 builder → 指令拼装：清晰三段式

Dash 的上下文装配链路非常干净，三层职责分离：

1. **数据文件**（`knowledge/tables/customers.json`）：结构化、人可读、版本可控。每张表含 `description`、`columns`（name/type/desc）、`use_cases`、`data_quality_notes`。
2. **context builder**（`dash/context/semantic_model.py`、`business_rules.py`）：读文件 → 格式化成 prompt 段，**内建截断**（`MAX_QUALITY_NOTES = 5`）。
3. **指令拼装**（`dash/instructions.py`）：`角色指令 + 语义模型 + 业务上下文` 用 `\n\n---\n\n` 拼接；按 role 选不同段（Engineer 拿 SOURCE TABLES，Analyst 拿 SEMANTIC MODEL + 业务上下文），按 config 切 Slack 段。

**对我们的启示（对应 to-be §2 ContextAssembler / §4 budget）**：这正是 to-be §2 提的 `ContextAssembler` 的样板——把散在 `router/project_config/skills_manager/system_prompt` 的拼装收敛成「源 → builder（带预算截断）→ 拼装」。Dash 的 `MAX_QUALITY_NOTES=5` 就是我们 `ContextBudget` 的最小形态。另外它的 `use_cases` 字段值得抄：既能驱动检索相关性，也能驱动 §7 的 requirement matching。

## 5. 角色/工具分区 = 上下文体积控制

Dash 不是「一个 agent 带所有工具」，而是按角色拆分，每个 agent 只拿自己需要的工具和上下文（`tools/build.py`）：

- Leader：无 SQL 工具，只有可选的 Slack 工具 + learnings。
- Analyst：只读 SQLTools（只读引擎）+ introspect + save_query + Reasoning。
- Engineer：dash schema 的 SQLTools + introspect + update_knowledge + Reasoning。

这天然避免了「所有工具 schema 挤进一个上下文」的问题。

**对我们的启示（直接对应 to-be §4.5 工具 schema 成本）**：to-be §4.5 指出 builder-app 的痛点——启用一个技能就把十几个 `manage_*` 工具的 schema 常驻进每轮上下文。Dash 用**角色分区**解决了这个我们用**技能过滤**在缓解的同一问题。借鉴：(a) 强化按项目类型收敛默认技能集；(b) 评估是否值得引入「子 agent / 工具分组」让重 schema 工具（UC、jobs）只在相关子任务里暴露——这也呼应 §4.5 第 3 点的 JIT 工具暴露（v0.4 待评估）。

## 6. 边界强制在资源层，而非 prompt 文字

Dash 的安全边界**不靠 prompt 说**，靠底层强制（CLAUDE.md「Schema enforcement」）：

- Analyst 只读：Postgres `default_transaction_read_only` 在事务级强制，任何 DML/DDL 被数据库拒绝。
- Engineer 不能写 public：SQLAlchemy `before_cursor_execute` 事件监听 + 正则守卫。

prompt 里也写了边界，但**真正的 guard 在引擎层**。这与我们 as-is §4「工具状态优先于 prompt 文字」同源，但 Dash 把它推得更深——到 DB 引擎。

**对我们的启示（对应 as-is §7 read-only / to-be §11 测试）**：我们的 read-only preview 用的是 `_is_read_only_sql` 正则前缀匹配（`databricks_openai.py`），属于「prompt+字符串守卫」层，理论上可被绕过。Dash 提示：对真正需要硬隔离的 read-only 场景，应考虑在 **SQL warehouse / 凭据层** 下沉只读约束，而不只靠 allowlist 字符串。至少在 to-be §11 的 read-only contract test 里覆盖「绕过尝试」。

## 7. 历史/会话用框架原语显式配置

Dash 的多轮历史不是黑盒——Agno 给了一组显式旋钮（`team.py`）：

```python
search_past_sessions=True, num_past_sessions_to_search=5,
read_chat_history=True, add_history_to_context=True, num_history_runs=5,
enable_agentic_memory=True,      # 跨会话 per-user 记忆
share_member_interactions=True,  # 成员间共享中间结果
add_datetime_to_context=True,
```

历史窗口（5 轮）、跨会话检索（5 个）、per-user 记忆都是可读可调的配置。

**对我们的启示（对应 to-be §8 history）**：as-is §6 指出我们完全依赖 SDK `SQLiteSession` 黑盒，没有可观测的窗口/压缩。Dash 展示了「框架级显式历史配置」长什么样，给 to-be §8 的 L4 一个目标形态参考：把窗口大小、是否跨会话、压缩阈值变成显式可测参数，而不是 SDK 默认行为。

## 8. Eval 即上下文行为的可执行契约

Dash 用 5 类 eval 把「上下文/行为契约」变成 CI 可跑的测试（CLAUDE.md「Evaluation System」）：

| 类别 | Eval 类型 | 守的是什么 |
|---|---|---|
| accuracy | AccuracyEval (1-10) | 数据正确 + 有洞察 |
| routing | ReliabilityEval | 路由到对的 agent/工具 |
| security | AgentAsJudgeEval（二元） | 不泄露凭据 |
| governance | AgentAsJudgeEval（二元） | 拒绝破坏性 SQL |
| boundaries | AgentAsJudgeEval（二元） | schema 访问边界 |

`evals/cases/boundaries.py` 直接用一组越权 SQL（`INSERT/DELETE/CREATE`、改 public schema）断言 agent 会拒绝。

**对我们的启示（对应 to-be §11 contract tests）**：这正是 to-be §11 提的 contract test 的成熟样板。可直接抄它的分类法：我们的 read-only policy → 对应 boundaries/governance；schema gate → 对应一类 reliability；prompt shape/budget → 我们独有。Dash 证明这套 eval 是可落地、可 CI 化的，不是纸面理想。

## 9. 一句话 takeaways（按 to-be 章节落地）

| Dash 模式 | builder-app-oai 落地点 |
|---|---|
| 编译 vs 检索二分（§1） | to-be §7 按需注入升级为「项目知识向量检索」（v0.4 选项） |
| 双层记忆 curated/discovered（§2） | 在 curated `known_caveats` 外加 discovered-learnings 存储 |
| 写回闭环 `update_knowledge`（§3） | 验证过的 MV 查询/口径写回项目知识，喂养按需注入 |
| 文件源→builder→拼装三段式（§4） | to-be §2 `ContextAssembler` 的样板；抄 `use_cases` 字段 + 截断常量 |
| 角色/工具分区（§5） | to-be §4.5：强化技能收敛；评估子 agent / 工具分组 |
| 资源层强制只读（§6） | read-only 下沉到 warehouse/凭据层；§11 加「绕过尝试」用例 |
| 框架级历史旋钮（§7） | to-be §8 L4：把窗口/压缩/跨会话变成显式可测参数 |
| Eval 五分类契约（§8） | to-be §11 直接采用 accuracy/routing/security/governance/boundaries 分类 |

## 10. 不要照搬的地方

Dash 与 builder-app-oai 的差异决定了哪些不能直接抄：

- **单数据集 vs 多项目多租户**：Dash 6 张表可以全量编译进 prompt；我们每个项目 schema 不同、且跨租户，编译必须受预算约束并偏向检索。
- **Agno vs OpenAI Agents SDK**：Dash 的历史/记忆旋钮来自 Agno；我们在 OpenAI Agents SDK 上没有等价开箱配置（as-is §6），L4 要自建（to-be §8）。
- **多 agent team vs 单 agent 多技能**：Dash 用 Leader+专家分区控制上下文；我们是单 agent + plan/conclusion 工作流，工具分区要在「技能过滤」框架内做，不能简单照搬 team 拆分。
- **Postgres 单库 vs Databricks 多资源**：Dash 的 DB 级只读强制（`default_transaction_read_only`）在 Databricks 多 warehouse/UC 权限模型下需要换成对应机制，不能逐字移植。

> 一句话总结：**Dash 教我们的是「上下文该编译还是检索、该 curated 还是 discovered、该 prompt 守还是资源层守、该如何用 eval 守住」这套结构判断；它的具体实现因规模和框架不同不可照搬，但它的分层与契约思路正是 v0.3.6 要补的。**
