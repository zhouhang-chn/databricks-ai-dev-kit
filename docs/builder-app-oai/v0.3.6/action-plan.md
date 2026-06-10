# Context Engineering Action Plan（v0.3.6 落地任务）

日期: 2026-06-08

本文把 [`design.md`](./design.md) 的 §13 分阶段方案拆成可执行任务。现状基线见 [`gap-analysis.md`](./gap-analysis.md)，外部参照见 [`../../refer/nao-context-engineering.md`](../../refer/nao-context-engineering.md) / [`../../refer/dash-context-engineering.md`](../../refer/dash-context-engineering.md)。

## 阅读方式

- 任务 ID 形如 `P1-BE-1`：阶段 P1–P4 × 轨道（BE 后端 / FE 前端 / TEST 测试 / DOC 文档）× 序号。
- 每个任务给出：触及文件、验收标准（DoD）、依赖、对应 design 章节。
- 阶段顺序 **P1 → P2 → P3** 为 v0.3.6 主体，**P4** 可滑到 v0.3.7 / v0.4。
- 总原则：**P1 行为零变化（纯重构 + 可观测）**，从 P2 起才改变进 prompt 的内容。

## 阶段总览与依赖

```
P1 引擎骨架（零行为变化）
   └─> P2 瘦 prompt + 按需读取（开始改变 prompt 内容）
          └─> P3 清理 + 契约 + 评测
                 └─> P4 history 压缩 + 写回闭环（可 defer）
```

每个阶段结束的硬门槛（gate）：

- **P1 gate**：`ContextAssembler` 跑通，对固定输入产出的最终 prompt 与重构前**逐字节一致**（snapshot 对拍），CI 绿；**数据正确性评测基线（P1-TEST-3）在 Distribution 上跑通并产出 pass rate / token / tool_call_count 基线**——没有基线不得进入 P2。
- **P2 gate**：**首要判据：对照 P1-TEST-3 基线，pass rate 不退化、整会话总 token 与时延不上升**；常驻 prompt 体积下降只是手段指标。release-pinned 文件读取测试通过；指针未遵从率（P2-TEST-2）有数。
- **P3 gate**：十类 contract test + 数据正确性评测进 CI；next_moves 死代码清除且前端无引用。
- **P4 gate**：L5 压缩摘要可打印可测；写回闭环带只读校验。

---

## P1 — 引擎骨架（design §2 / §13-P1）

目标：把分散在四处的装配收敛进 `server/services/context/`，**对外行为零变化**。

| ID | 任务 | 触及文件 | 验收标准（DoD） | 依赖 | design |
|---|---|---|---|---|---|
| P1-BE-1 | 新建 `server/services/context/` 包：`assembler.py` / `layers.py` / `budget.py` 骨架 | 新文件 | 包可 import；`ContextAssembler.assemble(request)` 返回 `AssembledContext` | — | §2 |
| P1-BE-2 | 定义 `AssembledContext` 结构：每层 text、每层 char/token 占用、`dropped` 字段清单 | `context/assembler.py` | 结构体含 `layers`、`usage`、`dropped`；可 `to_prompt()` 还原成字符串 | P1-BE-1 | §2 |
| P1-BE-3 | 把现有装配搬进 `layers.py`：L0=`system_prompt` 固定段，L1=`build_project_context`+`_render_project_context`+skill guidance+AGENTS.md，L2/L3/L4/L5 包住现有逻辑 | `system_prompt.py`、`project_config.py`、`skills_manager.py`、`project_operating_guide.py`、`agent_runtime/openai_runtime.py` | 搬迁后调用点改为走 `ContextAssembler`；逻辑不变 | P1-BE-2 | §2/§3 |
| P1-BE-4 | `ContextBudget` + 截断器：把现有隐式上限（skill guidance 40,000、AGENTS.md 8,000）收敛为常量；超限走 `dropped` 留痕 | `context/budget.py`、`skills_manager.py:598`、`project_operating_guide.py:8` | 现有上限值不变，仅集中化；测试可注入小预算触发截断 | P1-BE-3 | §4 |
| P1-BE-5 | 工具 schema 成本测量：统计 base + 每个技能解锁工具的 schema char/token，输出基线报告 | `skills_manager.py`（`BASE_TOOL_NAMES`、`SKILL_TOOL_MAPPING`、`filter_openai_tools_by_skills`）、`tools/databricks_openai.py` | 产出「技能 → 工具 schema 占用」表，写入 `AssembledContext.usage` 或日志；**从实际发往模型的序列化请求载荷测量（model-request hook），不自行重序列化，否则基线会偏离 SDK 真实发送值** | P1-BE-1 | §4.5 |
| P1-BE-6 | 预览入口统一：`config.py::get_system_prompt_endpoint` 改走同一个 `ContextAssembler` | `server/routers/config.py:69` | 预览 prompt 与运行 prompt 同源 | P1-BE-3 | §5.4 |
| P1-TEST-1 | prompt shape snapshot：固定输入下最终 prompt 与重构前逐字节一致（对拍） | `tests/`（新） | CI 断言 snapshot 稳定；L0 前缀逐字稳定（保护 cache）；**prompt 内时间戳/动态 ID 可注入（固定 clock/ID），否则逐字节对拍不成立** | P1-BE-3 | §11.1 |
| P1-TEST-2 | budget 截断测试：注入小预算，断言超限字段被丢且记入 `dropped`，无静默截断 | `tests/` | 通过 | P1-BE-4 | §11.3 |
| P1-TEST-3 | **数据正确性评测基线（自原 P3-TEST-5 提前）**：接入 `.test/`（MLflow+GEPA），NL prompt → agent 答案抽结构化 → 跑 ground-truth SQL → 逐行 diff；采集 token / `tool_call_count` / 文件读取次数 | `.test/`、Distribution `readiness.md` 202604 slice | 在**重构前/P1 后的现网行为**上产出 pass rate / token / tool_call_count 基线，作为 P2 的对照组；不依赖 P2 | 无（与 P1-BE-* 并行） | §11.8/§11.9/§13-P1 |

P1 不动任何「进 prompt 的内容」，只动「装配的代码结构 + 可观测性 + 评测基线」。

---

## P2 — 瘦 prompt + 按需读取（design §3 / §7 / §13-P2）

目标：把细粒度上下文从「全量编译进 prompt」改为「下沉成项目文件 + orchestration 指针 + `read_project_file` 按需读取」。**这是第一阶段会改变 prompt 内容的工作。**

| ID | 任务 | 触及文件 | 验收标准（DoD） | 依赖 | design |
|---|---|---|---|---|---|
| P2-BE-1 | metric_view_context 细字段下沉：`business_terms` / `source_objects` / `validation.known_caveats` 不再全量编译，改为写进项目文件（或指向已有 `metric-view-context-engineering.md`） | `system_prompt.py:50-92`（`_format_metric_view_context`）、`projects/<id>/*.md` | 常驻 prompt 只保留 full_name/status/grain/measures/dimensions + 指针；细字段在文件里 | P1 完成 | §7.1 |
| P2-BE-2 | requirements / readiness 下沉：不直接渲染 `analysis_requirements` / `semantic_gap_analysis` / `readiness_summary`，改为指针指向 `requirements.md` / `readiness.md` | `project_config.py`、`system_prompt.py::_render_project_context` | prompt 出现 orchestration 指针；模型可用 `read_project_file` 拉到 | P1 完成 | §3/§7 |
| P2-BE-3 | orchestration 段：在 prompt 写「何种问题先读哪个文件」的指路（KPI/口径/fallback → `metric-view-context-engineering.md`；requirement 命中 → 对应 MV 文件） | `system_prompt.py` | 指路清晰、可被模型执行；读取限定在 `run_state.project_dir` 内 | P2-BE-1/2 | §7 组织原则 |
| P2-BE-4 | 日期/周期约定段：给 `build_project_context` 渲染清单加「周边界、当前周期是否计入、last X 周/天/当月规范」段（小、稳定 → 编译进 L1） | `project_config.py`、`system_prompt.py::_render_project_context` | Distribution 按月（202604）问题能拿到日期约定 | P1 完成 | §7.1 |
| P2-BE-5 | requirement matcher **仅定义接口形状（证据门控，design §7.2）**：落地「命中对象」schema（requirement id + 读哪些文件 + 注入哪些 MV 细节）；匹配逻辑**默认不实现**，仅当 P2-TEST-2 量出指针未遵从率超阈值才立项（关键词匹配对多语言提问脆弱、误命中即「僵硬指令推向错路」） | 新增 `context/` 内类型定义 | 命中对象 schema 落地、可被 v0.4 扩展；无匹配逻辑代码 | P2-TEST-2 | §7.2/§16 |
| P2-BE-8 | 下沉文件纳入 source-of-truth 契约（design §9 第五行）：derived 文件从 settings 物化（保存设置时重新生成，唯一写路径、禁手改）；**release snapshot 覆盖项目文件，release-pinned run 的 `read_project_file` 解析到冻结版本**；指针指向缺失文件时降级为编译态渲染 | `project_settings.py`、release 流程、project file tools | release-pinned run 读不到 draft 文件；settings 保存后 derived 文件再生；缺省文件不报错 | P2-BE-1/2 | §9 |
| P2-TEST-2 | 指针遵从信号：`run_state` 跟踪 `project_files_read`（同 `agents_md_read` 机制）；评测断言「KPI/口径类 case ⇒ trace 含对应 `read_project_file`」，产出**指针未遵从率** | `run_state.py`、`.test/` | 未遵从率可量化；作为 P2-BE-5 的门控证据 | P2-BE-3、P1-TEST-3 | §11.15 |
| P2-BE-6 | 技能集收敛：按项目类型/requirement 收敛默认 enabled skills，减少常驻工具 schema | `openai_runtime.py::_resolve_enabled_skills`、`.agents/enabled_skills.json` | 分析型项目默认不开 UC/jobs/vector-search 等重 schema 技能 | P1-BE-5 | §4.5 / §7.2 |
| P2-BE-7 | pre-rebutted「别过早 fallback 到 raw SQL」清单：在 orchestration 段内联一组预先反驳（自定义日期窗/join/cohort 等），小而稳 → 编译进 L1（或随 `metric-view-context-engineering.md` 下沉） | `system_prompt.py`、`projects/<id>/metric-view-context-engineering.md` | metric-view-first 不被模型一句话绕过；清单可被 §11 read 测试断言存在 | P2-BE-3 | §7 组织原则（借鉴 anthropic） |
| P2-TEST-1 | context rendering 测试：给定 settings，断言 L1 渲染出/未渲染哪些字段（含下沉开关、日期段） | `tests/` | 通过 | P2-BE-1/2/4 | §11.2 |
| P2-DOC-1 | 项目文件约定文档：写明哪些内容下沉成文件（编译核心**不**下沉）、derived vs authored 的区分与写路径、文件命名、orchestration 指针写法、缺省降级行为 | `docs/builder-app-oai/v0.3.6/` | 团队可照此给新项目建文件 | P2-BE-3/8 | §3/§7/§9 |

**P2 验收锚点（按优先序）**：① 对照 P1-TEST-3 基线，Distribution 评测 pass rate 不退化、**整会话总 token / 时延不上升**（瘦 prompt 的收益是注意力不是省钱——cache 下编译内容近乎免费，JIT 读取反而全价计费，design §1 原则 6）；② release-pinned 文件读取测试通过（P2-BE-8）；③ 指针未遵从率有数（P2-TEST-2）；④ 常驻 prompt char/token 下降（手段指标）。

---

## P3 — 清理 + 契约 + 评测（design §6 / §9 / §10 / §11 / §13-P3）

目标：删死代码、把行为契约和数据正确性都纳入 CI。

| ID | 任务 | 触及文件 | 验收标准（DoD） | 依赖 | design |
|---|---|---|---|---|---|
| P3-BE-1 | 删除 next_moves 死路径 | `server/services/next_moves.py` | 运行入口移除；无后端引用 | — | §10 |
| P3-FE-1 | 前端移除 `next_moves.updated` 处理，统一 `submit_conclusion.next_steps` | `client/src/features/analysis/storyTransforms.ts`、`types.ts`、`pages/ProjectPage.tsx` | 构建通过；follow-up chips 仍来自 conclusion next_steps | P3-BE-1 | §10 |
| P3-BE-2 | gate-exempt 前缀单一常量：`describe` / `desc` / `show columns` / `show create table` 抽成可测常量 | `run_state.py:282-310` | 常量唯一来源；schema gate 引用它 | P1 完成 | §6 |
| P3-BE-3 | read-only 下沉评估：Databricks SQL warehouse **无语句级只读事务**，评估两个现实候选——① SELECT-only UC grant 集 ② 低权限 service principal；两者都需第二份 scoped 凭据，**与 per-user pass-through 模型冲突，评估必须正面回答该冲突**；同时记录 pass-through 本身的缓解作用（agent 不越过用户权限） | `databricks_openai.py:182-192`、`openai_runtime.py` | 产出可行性结论（含与 pass-through 的取舍）；至少正则层加绕过守卫 | P1 完成 | §6（借鉴 dash §6） |
| P3-BE-4 | source-of-truth 规则写入 prompt 职责段，对齐 design §9 五件物（含下沉文件）；**顺带对齐 AGENTS.md 措辞**——prompt 声称「start of the chat」但实际 per-run 重读，改措辞或按 conversation 缓存（二选一） | `system_prompt.py:240-243`、`project_operating_guide.py` | prompt 明确 YAML/DB/snapshot/AGENTS.md/下沉文件角色；AGENTS.md 措辞与实际行为一致 | P1 完成、P2-BE-8 | §9 |
| P3-BE-5 | provenance footer：最终答案附「来源层级 · 验证状态 · owner（新鲜度可选）」页脚；**字段一律从 trace/settings 推导**（已执行 SQL 判定来源层级，`validation.status`/`checked_at` 给验证状态），**禁止模型自报「置信度」**；`MAX(date)` 需额外一次查询，做成可选项 | `submit_conclusion` 路径、`system_prompt.py` | 每个结论答案带可解析页脚，字段可从 trace 复核；可先于评测落地 | P2 完成 | §11.10（借鉴 anthropic） |
| P3-OPS-1 | 被动监控两信号：① 查询经语义层/MV 解析占比 ② 回答含纠正性措辞占比，进每周看板。**前提：项目有真实用户流量**——每周几十次提问的项目上这两个占比是噪声；流量不足时 defer，先依赖离线评测 + P2-TEST-2 遵从信号 | 监控/遥测侧（与 P3-TEST-6 同表） | 两信号可查询；与离线 pass rate 同看板；流量前提写入看板说明 | P3-TEST-6 | §11.11（借鉴 anthropic） |
| P3-TEST-1 | schema gate contract test：配置表被引用且无 inspection 时拒绝；gate-exempt 前缀放行 | `tests/` | 通过 | P3-BE-2 | §11.4 |
| P3-TEST-2 | read-only policy + 绕过尝试：allowlist 生效；注释/大小写/前导空白构造的写操作被拒 | `tests/` | 通过 | P3-BE-3 | §11.5 |
| P3-TEST-3 | release-pinned context：viewer/preview 走 snapshot 而非 draft；**必须覆盖文件读取路径**——release-pinned run 的 `read_project_file` 解析到冻结版本而非 draft 工作区（design §9 第五行） | `tests/` | settings 与文件两条路径均通过 | P2-BE-8 | §11.6/§9 |
| P3-TEST-4 | MECE 一致性测试（两级判定，design §11.7）：**fail** = 同名 measure 出现在多个 MV 且归一化后表达式不一致；**warn** = glossary 与 MV measure 同名但定义文本不一致、或同一指标在 settings 与下沉文件两处内容不一致 | `tests/`、读 `projects/<id>` settings + 下沉文件 | fail/warn 分级可检出；不退化成只查重名 | P2-BE-1/8 | §11.7 |
| P3-TEST-5 | 数据正确性评测**扩展**（基线已在 P1-TEST-3）：补充用例覆盖（含 P2 下沉后的回归对照）、接入 CI | `.test/`、Distribution `readiness.md` 202604 slice | CI 内可跑；对照 P1 基线产出 pass rate / token / tool_call_count / 文件读取次数趋势 | P1-TEST-3、P2 完成 | §11.8/§11.9 |
| P3-TEST-6 | 评测即遥测 + go-live gate：每次评测结果落数仓表（skill 版本/git SHA/model id/逐断言/token/墙钟）；某领域清过 ~90% 阈值前不宣布可用 | `.test/`、遥测表 | 结果可时序查询，捕捉 slow regression；gate 可断言 | P1-TEST-3、P3-TEST-5 | §11.12（借鉴 anthropic） |
| P3-DOC-1 | 范围纪律 + 审计 rubric 文档：≤20 理想/≤100 硬顶；audit 检查清单（诊断 only） | `docs/builder-app-oai/v0.3.6/` | 可用于项目 onboarding/审计 | — | §15 |
| P3-DOC-2 | skill/参考文档维护机制：与 transform 模型 colocate；code-review hook 标记「改报表模型却没碰对应 skill/参考文件」的 diff | `docs/builder-app-oai/v0.3.6/`、CI/hook 配置 | 写明 colocation 规则 + hook 触发条件（前置：§9 source-of-truth） | P3-BE-4 | §15（借鉴 anthropic） |
| P3-BE-7 | 代码派生 MV 文档（offline 增强）：一次性 Codex/Claude 过程爬产出 MV 的 transform 代码（SDP/DLT/dbt/notebook），自动导出 business_terms/source_objects/grain/known_caveats **草稿**，交人校验（口径定义仍人定，不写 measure/dimension） | 新增 offline 脚本、`projects/<id>/metric-view-*.md` | 产出可校验文档草稿；不写口径定义；不阻塞主链路 | P2-BE-1 | §7.1（借鉴 openai） |

**P3 验收锚点**：十类 contract test + 数据正确性评测进 CI；next_moves 双轨歧义消除。

---

## P4 — history 压缩 + 写回闭环（design §7.4 / §8 / §13-P4，可 defer）

目标：让历史压缩可观测，开始 discovered-learnings 写回闭环。优先级最低，可滑到 v0.4。

| ID | 任务 | 触及文件 | 验收标准（DoD） | 依赖 | design |
|---|---|---|---|---|---|
| P4-BE-1 | L5 压缩摘要：历史超阈值（如 5 轮）时生成「问题摘要+关键数据+结论+active filters」，复用 `synthesis.appended.summary`，作为可打印对象进 `AssembledContext` | `agent_runtime/openai_sessions.py`、`context/assembler.py` | 不替换 SQLiteSession；摘要可打印可测 | P1 完成 | §8 |
| P4-BE-2 | curated / discovered 知识分层：渲染时区分人写（settings/文件）与运行时沉淀 | `context/layers.py`、`project_config.py` | 两类知识分别处理 | P2 完成 | §7.4 |
| P4-BE-3 | 写回闭环：验证通过的 MV 查询/口径修正写回项目知识（文件或 settings），带只读+单语句校验 | 新增写回工具、`run_state.py` | 校验拒绝非 select/with、多语句 | P4-BE-2 | §7.4 |
| P4-TEST-1 | L5 压缩 + 写回校验测试 | `tests/` | 通过 | P4-BE-1/3 | §11 |

---

## 跨阶段注意事项

- **先测量、再改动**：P1-TEST-3 评测基线必须先于任何 P2 prompt 内容改动存在——这是 nao / anthropic「Measure → Iterate」在本仓库的执行版；「人工 smoke」不可替代基线，P2 gate 不接受无基线对照的验收。
- **瘦 prompt 的账要算对**：cache 下稳定编译内容近乎免费，JIT `read_project_file` 是额外 turn + 全价 token + 随 history 重复计费；下沉的判据是注意力/准确率收益，不是 prompt 体积（design §1 原则 6）。「编译核心」（已验证 MV 的 measures/dimensions/grain、pre-rebutted 清单、日期约定）不下沉。
- **下沉文件受 release 冻结约束**：P2-BE-8 的契约（derived 物化唯一写路径 + release snapshot 覆盖文件）是 release pinning 不泄漏的前提；P3-TEST-3 必须覆盖文件读取路径（design §9 第五行）。
- **cache 不破坏**：P2 的下沉与技能收敛必须保证「同项目/同 release 内常驻前缀不抖动」，否则破坏跨轮/跨项目 prompt cache（design §1.2 / §4.5）。snapshot 测试（P1-TEST-1）是这条的守门人。
- **多租户文件边界**：`read_project_file` 下沉（P2）必须限定在当前 `run_state.project_dir` 内，不能跨租户读文件（design §3 安全前提）。
- **证据门控**：`query_metric_view` 专用工具不在本计划内；待评测（P1-TEST-3 基线起、P3-TEST-5 扩展）量出手写 SQL 的 metric 不一致率达阈值后再立项（design §7.3）。**requirement matcher** 同理——P2-TEST-2 的指针未遵从率是其唯一立项依据（design §7.2）。**对抗式评审 sub-agent**（anthropic 量化 +6% 准确 / +32% token / +72% 延迟）同样证据门控——按 P3-TEST-5/6 收益决定是否对某领域默认开，不预先强开（design §11.13）。
- **不自动生成 MV 定义（anthropic 负面结果）**：写回闭环 P4-BE-3 与任何「自动建 MV」想法只能写**验证过的查询 / 文档描述**，禁止写新的 measure/dimension 口径定义——口径由人负责（design §7.1）。
- **distill 优先于 raw 检索（anthropic 负面结果）**：P4-BE-2 的 discovered-learnings 必须 distill 成结构化参考片段再走按需读取，不可把原始查询堆给模型直读（提升 <1%，瓶颈是结构不是访问）（design §7.4）。
- **护栏而非菜谱（openai + anthropic）**：pre-rebutted 清单（P2-BE-7）与 orchestration 段（P2-BE-3）只写"约束 / 事实 / 路由触发器"，**不写分步执行菜谱**；评审任何 prompt/skill 改动时守住这条边界，防止悄悄退化成脆的 recipe（design §1 原则 10）。
- **RAG 毕业路径（openai）**：embedding-RAG 不在本计划——v0.3.6 维持文件编排（小项目足够）；仅当项目表数突破 §15 ≤100 硬顶时才立项（v0.4+）。范围纪律告警（P3-DOC-1）兼作"该换检索机制"的触发线（design §3/§15）。
- **代码派生增强可滑动（openai）**：P3-BE-7 是 offline 增强、非主链路；若 P2 文档下沉已由人写齐，可滑到 v0.4。它产出**文档草稿**，绝不产出口径定义（与"不自动生成 MV 定义"红线一致）。
- **回滚**：P1 因「零行为变化 + snapshot 对拍」可安全回滚到旧装配；P2 起的内容改动以项目为单位灰度（先 Distribution，再扩展）。
- **v0.4 golden cases 前向兼容（design §16）**：golden cases **不在本计划实现**，但以下 v0.3.6 任务是它的底座，必须做成 golden-case-ready 的形状，否则 v0.4 要返工：
  - **P2-BE-5（requirement matcher，证据门控）**：v0.3.6 只定义**结构化命中对象**的 schema（requirement id + 读哪些文件 + 注入哪些 MV 细节），数据驱动、非 bool、非硬编码；匹配逻辑待 P2-TEST-2 证据——v0.4 的 fast-path 路由在此延伸。
  - **P2-BE-3（orchestration）**：项目文件格式可扩展出 golden-case 段；复用同一套「指针 + `read_project_file`」。
  - **P1-BE-2（`AssembledContext`）**：L3 预留「golden_case」槽位，将来加入不重排层、不破 cache 前缀。
  - **P3-TEST-5（评测 schema）**：在 `{prompt, sql}` 外预留 canonical MV path / answer contract 扩展位，使 v0.4 golden cases 直接成为本评测主要用例来源。
  - **红线**：本计划不写任何 golden-case 专属逻辑（fast-path 路由 / golden-case schema / answer contract 执行均为 v0.4）。

## 建议排期

1. 先做 **P1 全量**（重构 + snapshot/budget 测试 + **评测基线 P1-TEST-3**），拿到「零行为变化」的安全网与回归对照组。
2. **P2 仅在 Distribution 上灰度**，用 **P1-TEST-3 基线**对照下沉前后 pass rate / 整会话总 token / 时延 / tool_call_count / 指针未遵从率。
3. P2 验证收益后再做 **P3 全量**（清理 + 契约 + 评测扩展进 CI）。
4. **P4** 视容量决定纳入 v0.3.6 尾部还是 v0.4。
