# Context Engineering - 基础设计（databricks-builder-app-oai）

日期: 2026-06-10 | English version: [`context-engineering.md`](./context-engineering.md)

本文定义 `databricks-builder-app-oai` 的基础 Context Engineering（CE）设计：产品如何决定有哪些上下文、上下文如何进入模型、如何被检查，以及如何随时间改进。

范围说明：本文适用于 `docs/builder-app-oai/` 下的 `databricks-builder-app-oai` 设计线。除非 implementation plan 明确说明，否则本文不代表 legacy `databricks-builder-app/` package 的当前状态。

本基础设计的非目标：

- 详细 context versioning；
- release-pinned reads 或 frozen release snapshots；
- production role/scope enforcement；
- deterministic golden-case execution paths。

这些属于 future-version topics。本文只保留构建和评估可靠自助分析 agent 所需的基础 CE 概念。

## 0. 文档地图

| 文档 | 角色 |
|---|---|
| 本文 | Context Engineering 的基础产品与架构决策记录 |
| [`v0.3.6/gap-analysis.md`](./v0.3.6/gap-analysis.md) | as-is 基线：上下文来源、prompting、workflow、history |
| [`v0.3.6/design.md`](./v0.3.6/design.md) | 下一 build slice 的实现级目标设计与任务 |
| [`v0.3.6/action-plan.md`](./v0.3.6/action-plan.md) | P1-P4 实施任务与验收 gate |
| [`v0.4-golden-analysis-cases/`](./v0.4-golden-analysis-cases/) | 未来 golden-case work |
| [`../refer/`](../refer/) | 外部实践参考：nao、dash、anthropic、openai |

## 1. 问题定义

分析正确性是上下文 + 验证问题。不同于 coding agents，数据分析问题通常有一个正确答案，并来自一个正确来源。Runtime 很少有天然测试，用户也常常无法从第一性原理验证答案。

Entity resolution 通常是主要失败点：一旦用户问题被映射到正确 table、metric、grain 和 business definition，SQL 生成较少是瓶颈。但 execution errors 仍然重要，尤其是 date windows、filters、denominators 和 joins。

本文关注四类主要失败模式：

1. **概念/实体歧义**：一个业务术语映射到多个看似合理的表、列、指标或定义。
2. **数据陈旧**：schema、定义和文档随业务变化漂移。
3. **检索失败**：正确信息存在，但 agent 没有找到或没有使用。
4. **正确实体上的执行错误**：选对了 table 或 metric，但操作做错。

每个有意义的 context item 都应有 `defense_claim`：它要降低的 failure mode 或 operating risk。不能说明 claim 的上下文，默认是在浪费注意力和预算。

## 2. 基础 Context Asset 模型

Context Assets 是 agent 用于 route、execute、validate 和 disclose 分析的受治理信息。它们不是偶然拼进 prompt 的文字。它们应该有 owners、source-of-truth locations、freshness expectations、loading behavior 和 observability。

基础设计使用每个 project 一个 **Context Asset Pack**。这个 pack 包含回答已发布 question families 所需的最小受治理资产，以及 agent 可按需读取的 long-tail assets 指针。

### 2.1 目标状态

对于任何已发布 domain，Context Asset Pack 必须回答五个问题：

1. **agent 能回答什么？**
   覆盖的 P0/P1 question families 及其 required `semantic_truth` assets。
2. **哪些实体是 canonical？**
   agent 应优先使用的 Metric Views、raw paths、measures、dimensions、grains 和 owner-approved definitions。
3. **agent 应如何操作？**
   防止常见分析错误的 workflow policies 和 conventions。
4. **什么证据证明 readiness？**
   Eval cases、validation SQL、launch tier、pass rule 和 trace requirements。
5. **本次 run 使用了什么上下文？**
   本次 run 加载或观测到的 project settings、project files、retrieved context、tool outputs 和 runtime evidence。

如果一个 domain 无法回答这些问题，它就不是 ready 的产品表面，即使 prompt 可以生成看似合理的答案。

### 2.2 Asset Contract

基础 asset contract 有意保持较小。它应由今天可用的 carriers 表示：DB settings、project files、traces 和 eval telemetry。完整 asset manifest 可以后续添加。

| Field | Meaning | Basic Carrier / Status |
|---|---|---|
| `id` | 用于引用和 traces 的稳定标识符 | 已有 ID 的资产要求提供：MV names、file paths、eval case IDs |
| `asset_type` | 该 Context Asset 执行的工作 | 作为组织字段要求提供；见 Section 2.3 |
| `defense_claim` | 该 asset 防御的 failure mode 或 operating risk | 对已有 carrier 的新建/变更 assets 要求提供 |
| `content` | 知识、证据、规则或控制记录 | 在 carrier 中要求提供，或由 referenced object 隐含 |
| `owner` | 对正确性和新鲜度负责的个人或团队 | metric definitions 和 launch readiness 要求提供 |
| `source_of_truth` | DB setting、authored file、derived file、trace 或 telemetry table | project-owned assets 要求提供 |
| `freshness_policy` | asset 何时必须 review 或 regenerate | 目标字段；可先从 notes 或 validation metadata 开始 |
| `validation_status` | Candidate、validated、certified、stale、missing 或 not applicable | `semantic_truth` assets 要求提供 |
| `loading_behavior` | asset 如何或何时进入 run | context assembly 和 tests 要求提供 |
| `scope` | Platform、project、run、turn、history 或 eval/control | access 和 observability decisions 要求提供 |
| `observability_signal` | Trace field、file-read record、footer field、eval result 或 audit warning | runtime/eval assets 要求提供；所有 assets 的目标字段 |

### 2.3 Asset Types

| `asset_type` | Content | Typical `loading_behavior` | Typical `scope` | Readiness Rule |
|---|---|---|---|---|
| `platform_mechanism` | System prompt core、tool schemas、plan state machine、read-only rules、response contract | `resident_platform`, `tool_schema` | Platform | mechanism 由 prompt/tool-shape tests 覆盖 |
| `data_foundation` | 受治理 source tables、transforms、tests、schema metadata、lineage、code-derived 和 LLM-optimized table docs | `warehouse_object`, `metadata_inspection`, `compiled_summary` | Project | data estate 足够可读，可以区分相似实体 |
| `semantic_truth` | Metric Views、canonical measures、dimensions、grains、approved raw paths、owners、validation status、fallback policy | `compiled_core`, `on_demand_file`, `warehouse_query` | Project | 每个已发布 KPI/aggregate family 都映射到 validated MV 或 approved raw path |
| `business_context` | Business terms、aliases、gotchas、caveats、launch/incident notes、interpretation guidance、decision context | `compiled_summary`, `on_demand_file`, `retrieved` | Project/turn | 歧义术语有一个 canonical interpretation，或有明确 fallback policy |
| `analyst_workflow` | Knowledge Router contract、senior-analyst SOP、analysis patterns、review rubric | `compiled_core`, `on_demand_file` | Platform/project/turn | 影响正确性的规则要么由 tool state 强制，要么由 tests 覆盖 |
| `turn_context_memory` | Matched project files、retrieved docs、saved corrections、project/personal memory | `on_demand_file`, `retrieved`, `history_memory` | Turn/history | retrieved 或 remembered context 有 scope、可审计，且不会静默覆盖 canonical definitions |
| `runtime_evidence` | Schema inspections、executed SQL or MV query、raw rows、result shape、validation checks、footer metadata | `runtime_observed`, `final_disclosure`, `telemetry` | Run/turn | runs 可复现到足以验证 source tier、validation status 和 file compliance |
| `control_plane` | Evals、readiness gates、telemetry、regression runbooks | `eval_only`, `telemetry` | Eval/control | readiness 和 regression decisions 可度量、可 replay |

### 2.4 Loading Behaviors

`loading_behavior` 是 assembly、traces 和 budget telemetry 的封闭词表。新增取值应谨慎，因为它影响可比较性。

| `loading_behavior` | Meaning | Budget / Telemetry Rule |
|---|---|---|
| `resident_platform` | project assembly 前已存在的 platform prompt 或 mechanism text | 从 actual request payload 度量；保护 stable prefix |
| `tool_schema` | SDK 序列化的 tool schema | 从 actual model requests 度量 schema tokens |
| `compiled_core` | 小、稳定、普遍相关的 project content，在 execution 前渲染 | 作为 prompt content 做 budget 和 cache-prefix test |
| `compiled_summary` | 紧凑 project summary，在 execution 前渲染 | 作为 prompt content 做 budget；跟踪 dropped fields |
| `on_demand_file` | routing 需要时在 execution 中读取的 project file | 度量 file-read count、tokens、latency、pointer compliance |
| `retrieved` | 来自 index 或外部知识面的 retrieval result | 度量 hit rate、tokens、latency、citation quality |
| `warehouse_object` | 作为 source 使用的受治理 warehouse table、view 或 Metric View | 度量 freshness/status 和 downstream query cost |
| `metadata_inspection` | Runtime schema、lineage 或 catalog inspection | 度量 tool calls、latency、avoided wrong-source failures |
| `warehouse_query` | Analytical SQL 或 Metric View query execution | 度量 query cost、result shape、row count、validation outcome |
| `history_memory` | 为本 turn 加载的 prior-turn、project 或 user memory | 度量 scope、freshness、token cost、correction value |
| `runtime_observed` | run 中 final response 前产生的 evidence | 记录用于 validation；不是 pre-run prompt budget |
| `final_disclosure` | answer 或 footer 中呈现的 evidence | 度量 output tokens 和 provenance completeness |
| `telemetry` | append-only trace、eval 或 monitoring record | 用于调优 budgets；默认不是 prompt content |
| `eval_only` | 仅用于 offline evals 或 scoring 的 asset | 在普通 user-run prompt budget 外度量 |

### 2.5 Compile Vs. On-Demand

Compiled core 是保护正确性 happy path 的一小组 `compiled_core` Context Assets：

- validated MVs 的 `full_name`、status、grain、measures、dimensions；
- metric-view-first policy；
- 预先反驳不要过早 fallback 到 raw SQL 的原因；
- date/period conventions。

Long tail 存在 project-file pointers 后面：

- full business terms；
- caveats 和 interpretation notes；
- gotchas、renamed products、internal abbreviations、required filters；
- sample queries；
- detailed requirements 和 readiness notes；
- detailed metric context。

Long-tail files 应组织成内聚 domain modules，例如 user growth、monetization、activation 或 support operations。Knowledge Router 选择 modules；execution 读取选中的 assets。一个 run 不应因为某个术语有歧义就加载整个 project knowledge graph。

### 2.6 Readiness Invariants

Context Asset Pack 只有满足以下 invariants 才 ready：

- 每个 launched question family 都映射到 required Context Assets；
- 每个 metric 都只有一个 canonical definition 和 owner；
- 每个 asset 都声明 `asset_type`、`loading_behavior` 和 `scope`；
- 新建或变更的 assets 携带 `defense_claim`；
- 每个 fallback path 都有明确 disclosure policy；
- 每个 on-demand pointer 都能 resolve，或以定义好的方式 degrade；
- 已发布 domains 有包含 known gotchas 和 business terminology 的 LLM-optimized reference docs；
- runtime traces 能展示使用了哪些 files、schemas、queries；
- 已发布 tier 有 eval coverage。

## 3. Workflow

Workflow 是 agent 产出正确答案的 operating model。它有四个阶段：route、execute、validate、disclose。

### 3.1 Routing: Find The Right Entity

Routing 是防御 concept/entity ambiguity 的主要手段。它回答：用户在问哪个 business concept，哪个 canonical metric/entity 表示它，以及应该使用哪个 source？

Routing 必须发生在 analytical execution 之前。当 target metric、entity、grain 或 source tier 仍有歧义时，agent 不应开始写 SQL。

基础 routing 机制是 **Knowledge Router**。它的工作是缩小搜索空间，而不是扫描每个 schema 或每个 project file。它把 intent 映射到少量 domain assets，例如 business context、table index、semantic definitions、known caveats 和 reusable analysis patterns。Execution 随后按需读取被选中的 assets。

Routing contract 有五步：

1. **Classify the question family.**
   KPI、aggregate、ranking、trend、comparison、reconciliation、drill-down、validation、exploratory 或 unsupported。
2. **Extract concepts and constraints.**
   Business terms、requested period、role/scope、dimensions、filters、comparison target、denominator、grain。
3. **Resolve concepts to canonical entities.**
   将 business terms 映射到 governed Metric View measures/dimensions 或 approved raw paths。如果存在多个非冲突候选，优先选择 owner-approved definition、grain、required dimensions 和 validation status 匹配问题的候选。
4. **Identify required Context Assets.**
   将 required `on_demand_file`、`business_context`、`semantic_truth` 或 `analyst_workflow` assets 加入 load plan。
5. **Emit a routing decision.**
   命名 selected source、metric/entity、grain、validation status、required assets、on-demand pointers、已知 analysis pattern，以及适用时的 fallback reason。

默认 source priority：

1. 覆盖该问题的 certified/validated Metric View；
2. 带 fallback disclosure 的 accepted candidate Metric View；
3. 对未被 Metric Views 覆盖的问题族使用 approved raw path；
4. exploratory raw SQL 仅在明确 fallback status 和 reason 时使用。

Raw tables 可用于 validation、row-level drill-down，以及 Metric Views 未覆盖的问题。它们不是绕过可用 governed Metric View 的捷径。

Routing decision 应可 trace。典型 decision record 如下：

```text
question_family: KPI | drill_down | validation | exploratory | ...
business_terms: [...]
selected_source_tier: metric_view | candidate_metric_view | approved_raw | exploratory_raw
selected_entity: <metric view / measure / dimension / raw path>
grain: <declared answer grain>
validation_status: certified | validated | candidate | stale | missing
required_assets: [...]
required_project_files: [...]
analysis_pattern: null | retention | funnel | cohort | rate_decomposition | reconciliation | ...
fallback_reason: null | <reason>
```

基础 observability 要求有 `routing_decision` trace record，并为 required on-demand assets 记录 file-read records。具体 event schemas 属于 implementation plans，不属于本文顶层设计。

### 3.2 Execution: Follow A Senior-Analyst SOP

Execution 回答：一旦选对实体，agent 如何执行分析以避免可避免的错误？

Senior-analyst SOP 是一组 `analyst_workflow` Context Assets。它应指导 agent：

1. 从 routing decision 开始；
2. 维护 visible plan；
3. 加载 required Context Assets；
4. 当没有 documented default 时澄清 missing constraints；
5. 获取 source 和 schema evidence；
6. 应用 analytical conventions；
7. 执行 query 或 Metric View path；
8. conclusion 前检查 suspicious outputs；
9. 为 validation 和 disclosure 准备 evidence package。

重要 execution conventions：

- validated Metric View 覆盖问题时使用 semantic path；
- SQL fallback paths 前先 inspect schema；
- 显式应用 date/period rules；
- 显式应用 denominator、safe division、filter、grain constraints；
- 对 0 rows、null spikes、unexpected grain changes 或 implausible adjacent-period jumps 等 suspicious results 重新检查。

Adversarial SQL review 不是基础 always-on workflow 的一部分。若 evals 显示其 correctness gain 足以抵消 token 和 latency cost，可在后续为 high-stakes domains 引入。

### 3.3 Validation: Check Before Returning

Runtime validation 应包括：

- schema inspection evidence；
- executed SQL 或 Metric View query；
- row counts 和 result shape；
- suspicious result patterns checks；
- settings 或 project metadata 中的 validation status；
- 足以 reproduce answer path 的 trace metadata。

Direct SQL oracles 是 eval assets，不是普通 runtime validators。Runtime validator 可检查 source tier、grain、row count、result shape、denominator sanity、freshness 或 limited invariants。如果某 validation query 是 trusted canonical calculation，它应成为 answer path，而不是 hidden oracle。

对 high-stakes paths，query 成功执行并不足够。Agent 必须验证 result 匹配 intended grain、filters、period window 和 source tier。

### 3.4 Disclosure

每个 concluding answer 都应区分：

- **raw data**：实际使用的 rows、aggregates 或 chart-ready result；
- **metadata**：source tier、validation status、owner、freshness（若测量）、executed query reference、fallback status；
- **visualization**：有助于比较 values、trends 或 distributions 时使用 chart 或 table；
- **interpretation**：结果暗示什么，并与 data directly shows 什么分离。

每个 answer 都应在 footer 中包含 provenance signature。它应让 confidence tier 可读：semantic layer / Metric View、approved raw path 或 exploratory raw table；validation status；已知 freshness；owner；fallback reason。

Fallback answers 必须在答案前披露 status 和 reason。虚假的 footer 比没有 footer 更糟，应作为 product bug 处理。

### 3.5 Safety Boundaries

Safety 与 correctness 相关，但不是同一回事。数值正确的答案仍可能不安全：过度声称 authorization、隐藏 fallback status、泄露 draft content、mutate data，或诱发 overtrust。

Required boundaries：

- preview/read-only runs 需要 tool trimming 和 SQL allowlist guards；
- 通过 comments、casing、leading whitespace、multi-statement SQL 的 bypass attempts 需要 tests；
- pass-through auth 阻止 agent 超过用户的 Databricks permissions，但不会创建 product-level row-scope semantics；
- high-stakes tiers 需要 human sign-off path。

## 4. Evals And Measurement

Evals 是产品正确性的仪器。它决定 domain 何时可 launch，tier 何时必须 stay dark，以及已 launch tier 何时需要 repair。

### 4.1 Data-Correctness Evals

任何 prompt-content change 之前必须已有 eval baseline。

每个 eval case 应遵循如下形态：

1. natural-language user prompt，像真实 chat 一样书写，不泄漏 table/column；
2. agent answer 被抽取为 structured data；
3. ground-truth SQL 在 fixed eval dataset 上执行；
4. 使用 normalized ordering 和 numeric tolerance 做 row-by-row diff；
5. trace metadata：model id、tokens、latency、tool calls、file reads 和 source tier。

Suite 必须包含足够 cases 覆盖 P0/P1 question families，并包含足够长的 multi-turn slice 来测试 history 和 pointer compliance。

Offline evals 应为 material prompt、Context Asset、routing 或 workflow changes 运行。把 agent 当作 black-box model under regression test：fixed prompts、fixed data、fixed expected outputs、trace comparison。

### 4.2 Contract Tests

Contract tests 保护系统形态：

- prompt-shape regression test；
- context rendering；
- budget and truncation records；
- schema gate；
- read-only bypass attempts；
- MECE fail/warn behavior；
- pointer compliance；
- history/compaction survival；
- footer parsing and trace comparison。

### 4.3 Launch Readiness

Launch gates 按 domain 和 stakes tier 设置。初始目标：

| Tier | Example Use | Initial Target |
|---|---|---|
| Headline KPI | Executive 或 operational KPI answers | 在覆盖充分的 eval slice 上 >=98% data-correctness pass rate |
| Exploratory / drill-down | Analysis follow-up、diagnostic exploration | 在覆盖充分的 eval slice 上 >=90% data-correctness pass rate |

Gate 使用前，implementation plan 必须定义 denominator、allowed failures、required family coverage、decision window 和 owner。本文不规定完整 gate schema。

### 4.4 Regression And Going Dark

Go-live gates 双向生效。持续 telemetry breach 应触发 runbook：

1. notify the domain owner；
2. 按 failure mode 和 defense line 分类 failures；
3. 必要时冻结该 domain 的 risky prompt/skill changes；
4. 必要时 downgrade answer footer 中的 validation status；
5. 通过相关 Context Asset、workflow step 或 assembly mechanism 修复；
6. 若在约定窗口内未修复，则 de-announce affected tier。

Detection without response is not a defense.

## 5. Context Building Mechanism

Context-building mechanism 确保正确的上下文在正确时机、以正确形态、在可控成本和速度下进入 model。

### 5.1 Explicit Context Assembler

基础设计在 `server/services/context/` 下引入 `ContextAssembler`。

Responsibilities：

- 收集 `loading_behavior` 为 `resident_platform`、`compiled_core` 或 `compiled_summary` 的 pre-run Context Assets；
- 暴露 `on_demand_file` 和 `retrieved` assets 的 pointers 和 records，供 routing 或 execution 后续加载；
- 暴露 `runtime_observed`、`history_memory` 和 `telemetry` assets，同时不假装所有 runtime content 都是 pre-assembled；
- 产生结构化 `AssembledContext`；
- 按 `asset_type`、`loading_behavior` 和 `scope` 记录 usage 和 dropped fields；
- 让 prompt preview 和 runtime prompt 走同一条路径；
- 通过 prompt-shape regression tests 保护 stable prefixes。

这用一个可测试、可预算、可跨 run 比较的对象替代裸字符串拼接。

### 5.2 Compile Vs. Retrieve

Prompt-content loading rule：

| Content Shape | `loading_behavior` | Reason |
|---|---|---|
| 小 + 稳定 + 普遍相关 | `compiled_core` 或 `compiled_summary` | 保护 happy path 和 cache prefix |
| 大 + 条件相关 + 持续增长 | `on_demand_file` | 减少 attention dilution |
| 极大或跨 domain | `retrieved` | File orchestration 不再可扩展 |

将 long-tail content 移到 `on_demand_file` pointers 后面的理由是 correctness 和 attention，不只是 prompt size。在 prompt caching 下，stable compiled content 首次运行后可能很便宜。JIT reads 会带来额外 tool turns、full-price input tokens、latency 和 history repetition。

### 5.3 Token Economics

Cost 和 speed 是同一个 token-economics 问题的两面。产品应按以下单位评估 correctness：

- input 和 output tokens；
- wall-clock latency；
- `tool_call_count`；
- file-read count；
- schema exploration count；
- warehouse query cost（可用时）。

High tool-call count 往往说明 context 不足。High file-read count 可能说明 on-demand strategy 正在伤害 latency 或 repeated billing。这些 signals 应与 answer correctness 一起判断。

### 5.4 Tool Schema Surface

Tool schemas 是 assembled prompt text 之外的 `platform_mechanism` Context Assets。SDK 每一轮都会把所有 enabled tools 的 schema 序列化进 context，即使 tool 没有被调用。

因此 skill selection 是 CE lever：

- analysis projects 默认不应启用 heavy UC/jobs/vector-search tool surfaces；
- 目标是更少 distinct tools in context，而不是更大的 multiplexed tools；
- schema footprint 应从 actual model request payload 度量。

### 5.5 Budget Policies And Truncation

每个有意义的 `asset_type` / `loading_behavior` 组合都需要显式 budget policy 和 telemetry。初始 cap 是 hypothesis，不是猜出来的 contract。只有在 before/after evals 显示它在不制造新 failure modes 的前提下改善 correctness、latency 或 cost 后，它才应成为 gate。

Budget tuning 应遵循 measurement loop：

1. instrument actual tokens、tool calls、file reads、latency、query cost；
2. 在代表性 eval slices 上建立 baseline；
3. 针对特定组合提出 cap 或 loading change；
4. 重新运行固定 eval slice 并检查 failure-mode changes；
5. 只有 correctness/cost/speed tradeoff 更好时才保留 policy；
6. 对每个 capped run，在 `AssembledContext.dropped` 记录 dropped fields。

Silent truncation is forbidden.

当 content 触达 cap 时，优先 repair 顺序是：

1. reduce duplication；
2. 将 long-tail content 移到 `on_demand_file` pointer 后面；
3. improve retrieval/routing；
4. 仅作为 fallback 进行 truncate，并保留 observability。

### 5.6 Scope Graduation

Scope discipline 是 correctness 和 economics lever：

- <=20 tables/MVs 是理想 project shape；
- <=100 是 file orchestration 的 hard cap；
- 超过 cap 后，产品应转向 offline aggregation + embedding retrieval，而不是继续增加 `compiled_core` 或 `on_demand_file` assets。

## 6. Knowledge Lifecycle

Knowledge lifecycle 回答：我们如何创建、验证、发布、维护和退役 Context Assets？

### 6.1 Asset Creation

New-domain onboarding 创建初始 asset set：

1. map P0/P1 question families；
2. identify candidate tables and Metric Views；
3. validate 或 create `semantic_truth` assets；
4. assign owners for metrics and data sources；
5. write business terms、caveats、date conventions、fallback policy；
6. author eval cases with ground-truth SQL；
7. 将 settings 和 on-demand reference files 发布到 project asset pack。

Track onboarding cost：

- 从 request 到 first launchable tier 的 elapsed time；
- human hours by role；
- 覆盖的 P0/P1 question families 数量；
- unresolved asset gaps；
- authored 和 maintained eval cases 数量。

### 6.2 Human Ownership

每个 launched domain 需要 named owners：

- data owner：负责 source 和 freshness questions；
- metric owner：负责 canonical definitions；
- product owner：负责 launch tier、threshold 和 user-facing availability；
- evaluation owner：负责 ground-truth case quality 和 telemetry review。

Metric definitions、validation status 和 go-live decisions 不应 anonymous。

### 6.3 Code-Derived Draft Docs

主要 cost-reduction lever 是 code-derived draft documentation。Offline process 可以 crawl 产出某张表的 transform code，并起草：

- grain；
- primary keys；
- freshness；
- source objects；
- sibling tables；
- caveats；
- example filters。

人类验证 draft。该 process 只起草 documentation；不生成 metric definitions。

### 6.4 Curated And Discovered Knowledge

Knowledge 分成两类：

- **Curated knowledge**：human-written schemas、definitions、caveats、policies，以及 validated Context Assets。
- **Discovered knowledge**：runtime learnings，例如 validated queries、recurring pitfalls、user corrections。

Write-backs 必须 distill 成 structured reference fragments，而不是 raw query logs。Project-level canonical corrections 和 personal preferences 必须分开保存，saves 需要 explicit confirmation。

### 6.5 Maintenance Loop

Reference docs、skills 和 `on_demand_file` Context Assets 应与它们描述的 transform code 和 dbt/Spark models colocated。Prompt 和 skill assets 是 code：需要 review、tests、owners 和 change history。

CI 应标记任何改动 reporting model、Metric View 或 governed table 但没有在同一个 PR 中触碰对应 agent reference asset 的 change。默认动作是 block launch，或要求 domain owner 显式 waiver。这样 agent knowledge 会在 underlying data contract 变化的同一时点保持新鲜。

Correction harvesting 应从重复 user corrections 中起草 PR，并把相同 cases 回流进 evals。

Readiness rots. Telemetry curve 是 domain 仍然 ready 的证据。

## 7. Iteration Model

系统应通过 measured iterations 演进，而不是通过累积 prompt complexity 演进。

### 7.1 Measure Before Changing

任何影响 what enters context 的变更都需要 data-correctness baseline。Manual smoke tests 对 debugging 有用，但不能替代 baseline。

需要 before/after comparison 的 changes：

- prompt content changes；
- new 或 removed `on_demand_file` assets；
- budget、truncation 或 loading-policy changes；
- routing/matcher changes；
- tool-surface changes；
- new retrieval mechanism；
- adversarial-review sub-agent；
- golden-case execution changes。

### 7.2 Evidence-Gated Mechanisms

只有 evals 显示 gap 或 benefit 后才增加 complexity。

| Mechanism | Build When |
|---|---|
| Dedicated Knowledge Router matcher | model-reasoning router 的 pointer non-compliance 超过 threshold |
| LLM intent fallback for golden-case matching | deterministic trigger matching 漏掉 covered question families 的真实 paraphrases |
| Dedicated `query_metric_view` tool | eval 时 hand-written MV SQL errors 达到 material 水平 |
| Adversarial SQL review | 某 domain misses 主要由 reasoning/verification failures 主导，且 cost 可接受 |
| Budget cap 或 truncation rule | Telemetry 显示某组合昂贵或 attention-diluting，且 ablation 改善 correctness/cost/speed |
| Embedding retrieval | Project scope 超过 file-orchestration hard cap |
| Sliding-window history | Multi-turn evals 显示 history 或 memory compression 导致 regressions |

### 7.3 Future Versions

以下主题有意排除在基础 CE 设计之外，属于 future versioned designs 或 action plans：

- full asset manifests；
- context versioning 和 release-pinned reads；
- frozen project file snapshots；
- deterministic golden-case execution paths；
- production role/scope enforcement；
- richer launch-gate schemas；
- dedicated Metric View query tools；
- 超过 file-orchestration cap 后的 embedding retrieval；
- sliding-window history 和 advanced memory compaction。

## 8. Appendix

### 8.1 Defense Lines

正确性来自五道叠加防线：

| # | Defense Line | Mechanisms | Primary Target |
|---|---|---|---|
| 1 | Context Assets | Data foundations、validated Metric Views、MECE definitions、human-owned metric definitions、business context、scope discipline | 降低 ambiguity、freshness 和 retrieval 的知识前提 |
| 2 | Routing | Entity resolution、metric-view-first source selection、knowledge-router/on-demand pointers、`project_files_read` compliance | Concept/entity ambiguity 和 retrieval failure |
| 3 | Execution | Schema gate、date/period conventions、suspicious-result self-checks | Wrong operation on right entities |
| 4 | Disclosure | Provenance footer、fallback reason、source tier、validation status、owner | Silent failure mitigation |
| 5 | Measurement | Data-correctness evals、per-stakes launch gates、telemetry、regression runbook | Staleness 和 system regression |

### 8.2 Cross-Cutting Principles

1. **每个 token 都有目的。** 更多上下文并不更好；irrelevant context 会浪费预算并稀释注意力。
2. **Cache-friendliness first.** Stable prefix 在前，volatile content 在后。
3. **Tool state over prompt text.** Constraints 应由 state、gates、tools 强制；prompt text 负责解释。
4. **Thin prompt 是 attention strategy，不是 cost strategy。** Prompt caching 会改变经济账；JIT reads 在一个 session 中可能更贵。
5. **Cost 是三维的。** Reliability、latency、token/query cost 必须一起评估。
6. **MECE definitions.** 每个 metric 只有一个 canonical definition；冲突必须可检测。
7. **Guardrails, not recipes.** 编码 constraints 和 facts；避免在 prompt rendering 中写脆弱 step lists。
8. **Evidence gating.** 只有 evals 量化 gap 或 benefit 后才增加 complexity。
9. **Measure before changing.** Prompt-content changes 需要先有 correctness baseline。
10. **Humans own metric definitions.** LLM 可以起草 documentation，但不能拥有 metric truth。

### 8.3 External Reference Summary

| Source | What We Adopt |
|---|---|
| [nao](../refer/nao-context-engineering.md) | CE as measurable discipline、token/query cost、thin prompt + orchestrated reads、MECE、data-correctness evals、scope discipline |
| [dash](../refer/dash-context-engineering.md) | Compile-vs-retrieve split、curated/discovered memory、write-back loop、resource enforcement、evals as contracts |
| [anthropic](../refer/how-anthropic-enables-self-service-data-analytics-with-claude.md) | Data-foundation/source-of-truth/skill/validation stack、failure-mode taxonomy、knowledge/unbook skill pattern、maintenance loop、evals-as-telemetry、provenance footer、adversarial review cost |
| [openai](../refer/Inside%20OpenAI’s%20in-house%20data%20agent.md) | Multi-source data context、table usage、human annotations、code enrichment、institutional knowledge、memory、runtime evidence、RAG-at-scale graduation path、tool consolidation、self-correction triggers |

### 8.4 Design Provenance

目标 Context Asset model 结合三类输入：

- OpenAI-style data-agent design 的 multi-source context model；
- Anthropic-style analytics deployments 的 data-foundation/source-of-truth/skill discipline；
- 当前 builder-app-oai implementation 和 v0.3.6 target design。

当前实现说明：context 仍然分散在 system prompt、project settings rendering、skills guidance、operating guide、runtime state 和 SDK session history 中。基础 CE 方向是将其收敛为 structured Context Asset assembly path。
