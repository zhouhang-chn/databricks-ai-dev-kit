# Context Engineering Gap Analysis（现状 / As-Is 基线）

日期: 2026-06-08

本文记录 `databricks-builder-app-oai` 当前的 Context Engineering 状态，作为后续 v0.3.6 版本澄清 prompting 和 workflow 的基线。这里描述的是已经落地的实现，不是目标设计。目标设计见 [`design.md`](./design.md)，落地任务见 [`action-plan.md`](./action-plan.md)。

## 0. 当前结论

当前系统已经有 Context Engineering 的雏形，但它分散在几个地方：

- `server/services/system_prompt.py` 负责生成一个大型 system prompt，并把项目上下文追加在 prompt 末尾。
- `server/project_config.py` 把项目 DB settings 归一化为每次 agent run 可见的 `Project Management Context`。
- `server/services/project_settings.py` 把用户编辑的 `project_setting.yaml` 同步成 DB settings。
- `server/services/skills_manager.py` 负责选择技能、过滤工具、渲染技能 Markdown 指南。
- `server/services/tools/plan_tools.py` 和 `server/services/tools/run_state.py` 用工具状态约束 workflow，而不仅仅依赖 prompt 文字。
- `projects/distribution/` 已有 v0.3.5 的场景 onboarding、Metric View context、requirements、gap analysis 和 readiness 文档。

但当前还没有一个独立的、显式的 Context Engine。系统主要采用“静态大 prompt + 项目上下文 suffix + skill guidance + AGENTS.md snapshot + SDK session memory”的方式，而不是按每一轮问题做 intent routing、schema retrieval、context budget allocation、history compression 的分层装配。

## 1. 单次对话运行链路

当前 agent run 的主链路如下：

1. 前端 `client/src/pages/ProjectPage.tsx` 调用 `POST /invoke_agent`，请求里包含 `project_id`、`conversation_id`、用户消息、资源 override、`run_role` 等。
2. 后端 `server/routers/agent.py` 读取当前用户、Databricks token、项目 DB 记录和项目 enabled skills。
3. `server/project_config.py` 根据项目 settings、release snapshot、run role 和本轮 override 生成 `project_context`。
4. `server/routers/agent.py` 创建 active stream 和 story id，并从最近 execution events 中抽取 schema history。
5. `server/services/agent.py` 封装 `AgentRunRequest`，交给 `OpenAIAgentRuntime`。
6. `server/services/agent_runtime/openai_runtime.py` 加载模型配置、解析 enabled skills、同步项目 skills、渲染 skill guidance、读取 AGENTS.md snapshot、创建工具列表、过滤工具、生成 system prompt。
7. OpenAI Agents SDK 用 `Runner.run_streamed(...)` 执行，输入是本轮用户消息，session 是项目和 conversation 维度的 SQLite session。
8. `server/services/agent_runtime/openai_events.py` 把 SDK events 转换成 Builder App events，比如 `plan.created`、`tool_use`、`tool_result`、`synthesis.appended`。
9. `server/routers/agent.py` 把事件写入 active stream，并在 run 完成后持久化 user message、assistant message、session id 和 execution events。
10. 前端 `client/src/features/analysis/storyTransforms.ts` 把事件转换成 story、plan step、evidence、conclusion、next step chips。

## 2. 当前上下文来源

| 来源 | 加载时机 | 主要代码 | 当前进入 prompt/session 的方式 |
|---|---|---|---|
| 用户本轮消息 | 每次 run | `AgentRunRequest.message` | 作为 `Runner.run_streamed(input=...)` 输入，不拼进 system prompt |
| DB 项目 settings | 每次 run | `build_project_context` | 渲染到 system prompt 的 `Project Management Context` |
| `project_setting.yaml` | 创建、读取、保存项目设置时 | `project_settings.py` | 保存时同步为 DB settings；每次 agent run 不直接重读 YAML |
| 本轮资源 override | 每次 `/invoke_agent` | `server/routers/agent.py` | 合并成 `effective_resources` 和 `conversation_overrides` |
| release snapshot | `run_role` 是 user/user_preview/viewer 时 | `get_project_settings_for_run` | user preview 使用 `current_release_id` 对应的 settings snapshot |
| enabled skills | 每次 run | `_resolve_enabled_skills` | 优先级为 request、项目 `.agents/enabled_skills.json`、环境变量、全部 skills |
| skill guidance | 每次 run | `render_project_skill_guidance` | 从项目 `.agents/skills/*/SKILL.md` 渲染，最多 40,000 字符 |
| AGENTS.md | **每次 run** 从磁盘重读 | `load_project_operating_guide` | 作为 snapshot 注入，最多 8,000 字符。注意：prompt 文字声称「loaded at the start of the chat / 会话内不变」，与实际 per-run 重读不一致——同一会话内编辑 AGENTS.md 会在下一次 run 生效（v0.3.6 §9 对齐措辞或改为按 conversation 缓存） |
| schema history | 每次 run | `_schema_history_events_from_executions` | 从最近 10 次 execution（每次含多个 events）抽取成功的 schema tool results，用于 SQL schema gate |
| SDK session memory | 每次 run | `get_openai_session` | SQLiteSession，key 是 `builder:{project_id}:{conversation_id}` |
| Databricks auth | 每次 run | `set_databricks_auth` | 只给 Databricks tools 使用，不把 token 暴露给模型 |

## 3. Prompting 现状

System prompt 由 `get_system_prompt(...)` 一次性生成。当前设计把大部分稳定指令放在前面，把每个项目或每个 conversation 会变化的内容放在最后，以便最大化 prompt cache 的共享前缀。

当前 prompt 的主要结构是：

1. Agent 角色和能力说明。
2. Response format，要求少写自由文本，用 `update_plan` 和 `submit_conclusion` 驱动 UI。
3. Plan-driven execution 状态机，包括 `create -> start -> tools -> finish -> conclusion`。
4. `project_setting.yaml`、`Project Management Context`、AGENTS.md 的职责边界。
5. 工具使用规则，包括 schema-first SQL、Metric View first、长任务轮询、禁止 AskUserQuestion。
6. Selected skills 和 skill guidance。
7. 当工具集允许创建资源时，追加 resource link 和 permission grant 指南。
8. Workflow 指南。
9. Compute、SQL warehouse、workspace folder、catalog/schema、workspace URL 等项目资源上下文。
10. `Project Management Context` 和 AGENTS.md snapshot。

`Project Management Context` 当前会渲染这些内容：

- 项目名、类型、状态、release、run role、settings source。
- effective Databricks resources 和本轮 conversation overrides。
- `semantics.metric_views`。
- `semantics.metric_view_context.metric_views` 的有限字段：full name、status、grain、measures、dimensions，以及 `validation` 下的 direct SQL ref（`validation.direct_sql_ref`）和 checked_at（`validation.checked_at`）。
- input tables、deprecated tables、pinned resources、sample queries、glossary、known caveats。
- workflows、approved memory、agent policy、governance。

没有直接渲染的内容包括：

- `scenario_onboarding.analysis_requirements`。
- `scenario_onboarding.semantic_gap_analysis`。
- `scenario_onboarding.readiness_summary`。
- Metric View 的 `business_terms`、`source_objects`、`validation.known_caveats` 等更细粒度字段。

这意味着 Distribution v0.3.5 的 requirements 和 readiness 已经能被保存进 settings，但不一定会完整进入 agent prompt。

## 4. Workflow Engineering 现状

当前 workflow 不是纯 prompt 约束，而是 prompt 和工具状态共同约束。

`update_plan` 和 `submit_conclusion` 是每次 run 创建的新工具闭包。它们维护本 run 的状态：

- `update_plan(op="create")` 只能正常创建一次。
- 重复 create 会返回 `plan_already_exists`，提示模型改用 `start` 或 `revise`。
- `submit_conclusion` 只能提交一次，重复提交会返回 `conclusion_already_submitted`。
- `submit_conclusion` 被视为 terminal action，runtime 收到 `synthesis.appended` 后会取消后续 stream。

`AgentToolRunState` 还负责 Databricks tool gate：

- 没有创建 plan 前，Databricks tools 返回错误，要求先 `update_plan(op="create")`。
- plan 创建后但没有 started step 时，Databricks tools 返回错误，要求先 `update_plan(op="start")`。
- step started 后，工具结果会被前端归属到当前 plan step。

这套机制保证 UI 能看到稳定的 story stepper，也减少模型因为重复 create 或重复 conclusion 消耗 60-turn budget。

## 5. SQL 和 Metric View 上下文保护

当前 SQL guardrail 的重点是“先看 schema，再写分析 SQL”。

实现位置：

- `server/services/tools/run_state.py`
- `server/services/tools/databricks_openai.py`
- `server/routers/agent.py`

当前行为：

- `schema_required_tables` 来自项目 `semantics.input_tables`、`semantics.metric_views` 和 legacy `preferred_tables`。
- 如果 SQL 引用了这些配置表，且本 conversation 没有成功 schema inspection，`execute_sql` 和 `execute_sql_multi` 会返回错误，要求先调用 `get_table_schema`。
- `DESCRIBE`、`DESC`、`SHOW COLUMNS`、`SHOW CREATE TABLE` 本身被认为是 schema inspection，可直接通过 schema gate。
- 最近 execution events 中成功的 `get_table_schema`、`get_table_stats`、`DESCRIBE`、`SHOW COLUMNS` 会 seed 当前 run，避免同一 conversation 重复查 schema。
- `get_table_schema` 只做 schema discovery，不做 row count 或 column stats。
- `get_table_stats` 需要显式 `columns`，并要求先 schema discovery。

Metric View 的 current policy 主要在 system prompt 中表达：

- KPI、aggregate、ranking、trend、comparison 问题应优先使用配置的 Metric Views。
- 用 Metric View 时应显式选择 dimensions 和 `MEASURE(...)`。
- raw input tables 用于 validation、row-level drill-down、source-data debugging 或 Metric View 不覆盖的问题。
- candidate、stale、missing Metric View 需要先披露状态和 fallback reason。

目前没有单独的 `query_metric_view` 工具，Metric View 仍通过 SQL 工具查询。

## 6. Conversation 和 History 现状

当前有三层“历史”：

1. DB conversation messages：保存用户消息和 assistant answer。assistant answer 优先使用 `synthesis.appended.summary`，否则使用自由文本。
2. DB execution events：保存工具调用、工具结果、plan 和 synthesis 事件。schema history 会从这里抽取。
3. OpenAI Agents SDK SQLiteSession：保存 SDK 管理的 session 状态，用于多轮 conversation continuity。

当前 app 层没有显式实现一个可观测的 history compression 或 sliding window assembler。`projects/distribution/data-agent-design.md` 里的 Layer 4 History Context 是目标设计，但当前主要依赖 SDK session 和少量 schema history seed。

## 7. Skill 和 Tool 选择现状

工具集由两部分组成：

- typed wrappers：`execute_sql`、`execute_sql_multi`、`get_table_schema`、`get_table_stats`、`list_sql_warehouses`、`get_best_sql_warehouse`、`list_compute`。
- generated FastMCP tools：从 `databricks-mcp-server` 动态加载，再按技能过滤。

技能过滤由 `SKILL_TOOL_MAPPING` 控制。无论启用哪些 skill，base tools 都会保留，包括 `update_plan`、`submit_conclusion`、`read_project_file`、SQL 和 schema tools、operation status tools。

read-only user preview 的行为：

- `build_project_context` 会把 `agent_policy.write_policy` 改成 `read_only`。
- OpenAI runtime 会设置 `read_only_run=True`。
- project file tools 以 read-only 模式创建。
- Databricks generated tools 只保留 read-oriented 工具。
- SQL 只允许 `SELECT`、`WITH`、`SHOW`、`DESCRIBE`、`DESC`、`EXPLAIN`、`VALUES`。
- resource link 和 permission grant 这种创建资源相关 prompt section 会被省略。

## 8. 前端 Story 和 Follow-up 现状

前端分析体验围绕 `AnalysisStory` 展开：

- `story.created` 建立一个 story。
- `plan.created`、`plan.step_started`、`plan.step_finished` 驱动 stepper。
- 普通工具调用形成 trace 和 evidence。
- `synthesis.appended` 形成最终 conclusion、highlights、next steps 和可选 visualization specs。
- `submit_conclusion.next_steps` 会渲染成 answer 下方的 clickable chips。

仓库里仍有 `server/services/next_moves.py` 和前端对 `next_moves.updated` 的支持，但 README 和当前 `server/routers/agent.py` 表明系统不再运行单独的 post-response Next Moves 模型调用。as-is 状态下，follow-up 建议应来自 `submit_conclusion.next_steps`。

## 9. Distribution v0.3.5 现状

`projects/distribution/` 是当前最完整的 context engineering seed。

已有文档和资产：

- `distribution.yaml`：用户可读的项目 setting 源，包含 business background、analysis notes、Databricks resources、input tables、input metric views、metric_view_context、readiness summary。
- `requirements.md`：v0.3.5 scenario-onboarding contract，定义 P0/P1 问题族、grain、measures、dimensions、required assets 和 answer contracts。
- `inventory.md`：source tables、schemas、workspace code、Metric Views 和 volume 状态。
- `gap-analysis.md`：requirements 与 Metric Views/source tables 的覆盖差距。
- `readiness.md`：MV1/MV2/MV3 的 readiness 状态和 certification blockers。
- `metric-view-context-engineering.md`：Distribution 场景的 Metric View first runtime policy 和 v0.4 handoff。
- `data-agent-design.md`：中文的目标设计文档，描述 Agentic Design 和分层 Context Engineering。

当前 Distribution ready 状态：

- MV1 `m1_achievement_detail_metrics`：202604 validation slice 已验证。
- MV2 `m1_poc_achievement_metrics`：202604 validation slice 已验证。
- MV3 `m1_kpi725_benchmark_metrics`：202604 employee-level 和 202601-202604 monthly aggregate 已验证。
- MV4/MV5 仍是 candidate/deferred。
- raw tables 仍是 validation、row-level drill-down、unsupported grain 和 source-data debugging 的批准路径。

需要注意的是，`data-agent-design.md` 里的分层 Context Engine 是设计目标，不等同于当前 `databricks-builder-app-oai` runtime 已经实现的通用能力。

## 10. v0.3.6 需要澄清的问题

从 as-is 看，v0.3.6 如果目标是“讲清楚 Context Engineering，包括 prompting 和 workflow”，至少需要处理以下问题：

1. 是否要引入独立的 Context Engine 模块，而不是继续把 context assembly 分散在 router、project_config、skills_manager 和 system_prompt。
2. 是否要把 context 分层显式化，例如 immutable prompt、project context、run context、turn context、observation context、history context。
3. 是否要把每层上下文的 token budget 和截断策略变成可测试、可观测的代码，而不是隐含在字符串拼接和字符上限里。
4. 是否要把 `scenario_onboarding.analysis_requirements`、`semantic_gap_analysis`、`readiness_summary` 注入 prompt，或按需检索注入。
5. 是否要完整利用 `metric_view_context` 中的 `business_terms`、`source_objects`、`validation.known_caveats`，帮助模型做同义词映射和 fallback 判断。
6. 是否要实现每轮 intent routing 或 requirement matching，把 Distribution A1/A5/A2/F3 这类 requirement 显式选出来。
7. 是否要为 Metric View 查询提供专门工具或 query builder，避免完全依赖模型手写 SQL。
8. 是否要明确 `project_setting.yaml`、DB settings、release snapshot、AGENTS.md 的 source-of-truth 和同步规则。
9. 是否要删除或重新接入 `next_moves.py`，避免存在“代码里有 Next Moves，但产品路径使用 conclusion next_steps”的双轨歧义。
10. 是否要为 prompt shape、context rendering、schema gate、read-only tool policy、release-pinned context 增加 snapshot 或 contract tests。

## 11. 后续文档

在这个 as-is 基线之后，v0.3.6 文档链路为：

- [`design.md`](./design.md)：定义目标架构、context layers、prompt contract、workflow contract 和 Distribution 对齐方式。
- [`action-plan.md`](./action-plan.md)：把设计拆成可实现的后端、前端、测试、文档任务。
