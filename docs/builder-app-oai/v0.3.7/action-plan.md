# Context Engineering Action Plan (v0.3.7 Execution)

日期: 2026-06-11

本文把 [`design.md`](./design.md) 拆成 execution-first implementation tasks。v0.3.7 的验收重点是：给定 v0.3.6 的 route，agent 是否使用正确 source、正确 grain/period、正确 query convention，并留下可复核 evidence。

## 阶段总览

```
E1 Consume route and load execution assets
  -> E2 Execute with route-aware checks
      -> E3 Evidence, disclosure, and data-correctness eval
```

Gate:

- **E1 gate**: execution 能读取 `routing_decision`，并加载 SOP/pattern/query-template assets。
- **E2 gate**: Metric View first、schema gate、read-only gate、suspicious checks 有 contract tests。
- **E3 gate**: `execution_evidence`、provenance signature 和 data-correctness eval 可跑。

## E1 - Consume Route And Load Execution Assets

| ID | 任务 | 触及文件 | 验收标准 | 依赖 |
|---|---|---|---|---|
| E1-BE-1 | 定义 `ExecutionContract`，由 v0.3.6 `RoutingDecision` 生成 | `server/services/context/` 或 `server/services/tools/` | 包含 source tier、entity、constraints、required/loaded files、fallback reason | v0.3.6 R3 |
| E1-BE-2 | 将最近 `routing_decision` 注入 run state | `openai_runtime.py`、`run_state.py`、event persistence | Databricks tool wrappers 可访问 route metadata | E1-BE-1 |
| E1-BE-3 | 建立 execution asset loader：SOP core compiled，pattern modules on-demand | `system_prompt.py`、`project_files.py`、project template files | prompt 只包含 SOP core；pattern files 由 route/pattern 指针读取 | E1-BE-1 |
| E1-BE-4 | 增加 route-missing fallback marker | `run_state.py`、events | 无 route 时不阻断旧路径，但记录 `routing_decision_missing` | E1-BE-2 |
| E1-TEST-1 | ExecutionContract schema test | `tests/` | route -> execution contract 转换可校验 | E1-BE-1 |
| E1-TEST-2 | SOP/pattern loading test | `tests/` | selected pattern 文件被读取并计入 loaded files | E1-BE-3 |
| E1-DOC-1 | execution asset file convention | `docs/builder-app-oai/v0.3.7/` 或 project template docs | SOP/pattern/template/evidence 文件职责清晰 | E1-BE-3 |

## E2 - Execute With Route-Aware Checks

| ID | 任务 | 触及文件 | 验收标准 | 依赖 |
|---|---|---|---|---|
| E2-BE-1 | Metric View query template helper：从 route selected MV/measures/dimensions/period 生成 SQL skeleton | `server/services/context/` 或 `tools/databricks_openai.py` helper | 生成 `MEASURE(...)` skeleton；不执行；可被 prompt/tool guidance 使用 | E1 |
| E2-BE-2 | route-source compliance check：selected MV route 下执行 SQL 应引用 selected MV | `run_state.py`、`databricks_openai.py` | 不合规时先 warning/trace，后续可变 soft gate | E1-BE-2 |
| E2-BE-3 | raw fallback reason check | `run_state.py`、events | metric_view route -> raw SQL 时记录/要求 fallback reason | E2-BE-2 |
| E2-BE-4 | grain/period preflight fields | `ExecutionContract`、prompt/context renderer | 缺 period/grain 且无 default 时可触发 clarification or trace warning | E1-BE-1 |
| E2-BE-5 | suspicious result check collector | `databricks_openai.py`、event processor | SQL result 后记录 0 rows/null-heavy/shape anomalies 的 pass/warn/fail | E1-BE-2 |
| E2-BE-6 | gate constants cleanup：schema gate exempt prefixes 单一常量 | `run_state.py` | tests 引用同一常量；行为不变 | - |
| E2-TEST-1 | MV first compliance test | `tests/` | selected MV route 下 wrong source 被 warning/gated | E2-BE-2 |
| E2-TEST-2 | raw fallback reason test | `tests/` | fallback 无 reason 可检出 | E2-BE-3 |
| E2-TEST-3 | suspicious result trigger tests | `tests/` | 0 rows、null-heavy、grain collapse case 可触发 warning | E2-BE-5 |
| E2-TEST-4 | read-only bypass tests | `tests/` | 注释/大小写/前导空白/多语句构造被拒 | E2-BE-6 |
| E2-TEST-5 | schema gate contract tests | `tests/` | configured table 无 schema inspection 被拒；DESCRIBE/SHOW COLUMNS 放行 | E2-BE-6 |

## E3 - Evidence, Disclosure, And Data-Correctness Eval

| ID | 任务 | 触及文件 | 验收标准 | 依赖 |
|---|---|---|---|---|
| E3-BE-1 | 构建 `execution_evidence` aggregator | event persistence、`openai_events.py`、new context/evidence module | 汇总 route、queries、row count、columns、loaded files、checks、fallback | E1/E2 |
| E3-BE-2 | provenance signature builder | `submit_conclusion` path、event processor | footer 字段从 trace/settings 推导；禁止模型自报 confidence | E3-BE-1 |
| E3-BE-3 | final answer contract update | `system_prompt.py`、`plan_tools.py` | prompt/tool schema 要求 conclusion 引用 evidence id 或 footer fields | E3-BE-2 |
| E3-TEST-1 | execution evidence unit tests | `tests/` | tool events -> normalized evidence object | E3-BE-1 |
| E3-TEST-2 | provenance footer parse/trace compare test | `tests/` | footer 可 parse，且 source tier/status 与 trace 一致 | E3-BE-2 |
| E3-TEST-3 | data-correctness eval seed for Distribution | `.test/` | route-fixed prompt -> executed output -> ground-truth SQL row diff | E2 |
| E3-TEST-4 | eval telemetry | `.test/` or telemetry table | 记录 model id、git SHA、route id、tokens、latency、tool/file counts、pass/fail | E3-TEST-3 |
| E3-DOC-1 | v0.4 handoff note | `docs/builder-app-oai/v0.4-golden-analysis-cases/` or this folder | golden cases 可复用 execution contract/evidence/eval schema | E3-BE-1 |

## Cross-Cutting Rules

- **Do not reopen routing by default**: execution starts from `routing_decision`; broad discovery is a fallback after route evidence fails。
- **Metric View first remains semantic truth**: if route selected validated/certified MV, raw SQL must have a recorded fallback reason。
- **Templates before new tools**: use route-aware SQL skeletons first; only build `query_metric_view` after eval proves material hand-written SQL failures。
- **Runtime validation is not hidden oracle**: direct SQL oracles belong to eval unless they are the actual answer path。
- **Suspicious checks are guardrails, not recipes**: they should detect implausible outputs and ask for self-check, not force brittle step sequences。
- **Footer fields come from trace/settings**: no model confidence scores。
- **Read-only is tested at execution boundary**: string allowlist remains imperfect; cover bypass attempts until stronger credentials/UC grants exist。

## Suggested Sequence

1. Finish v0.3.6 R3, then implement E1 route consumption and execution asset loading.
2. Add E2 route-aware checks in warning mode first so existing analyses are observable before becoming blocked.
3. Build E3 evidence and footer from trace, then wire Distribution data-correctness eval.
4. Use eval results to decide whether `query_metric_view` or stronger review loops are worth the added context/tool cost.
