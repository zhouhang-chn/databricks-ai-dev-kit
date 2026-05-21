# TODO: Tool Prompt Optimization (P2) — reduce Databricks tool-schema weight

## Context

Part of a static-context optimization effort on the OpenAI Builder App agent
(`openai_runtime.py`). The static context (system prompt + skill + tool
schemas) is sent on every LLM call.

- **P0 — prompt caching: DONE.** MLflow tracing confirms most input tokens are
  cache hits, so the *per-call* cost of large static context is largely
  absorbed. Remaining wins from trimming are: cache-write cost (paid ~once per
  conversation), first-turn cost, and — most importantly for tools —
  **tool-selection accuracy**.
- **P1 — gate resource-link/grant guidance: DONE** (commit on branch
  `optimize-static-context`). `get_system_prompt(can_create_resources=...)`;
  the runtime derives the flag from the skill-filtered tool set.
- **P2 — this doc.**
- P3 (conditional skill-section injection) and P4 (plan-rule compression) are
  separate.

## The finding (measured, not estimated)

Tool-schema size is **project-type dependent** and dominated by the Databricks
`manage_*` tools, not the analysis read-tools.

| Scope | Tools | Schema size (chars) | ~tokens |
|---|---:|---:|---:|
| Analysis project (skill-filtered) | 13 | ~7,100 | ~2,000 |
| Typical build project (subset of `manage_*`) | ~20–35 | ~25,000–45,000 | ~6,000–11,000 |
| Full unfiltered set | 57 | ~60,300 | ~15,000 |

Earlier estimates were wrong in both directions: a Gemini analysis put tool
schemas at ~5,700 tok (too high — likely counted pretty-printed JSON / the full
SDK agent repr; cited 23,153 chars ≈ 2.6× the real minified payload), and an
initial guess of ~3,800 tok was also high. The **measured** analysis-set
payload is ~2,000 tok. Skill filtering (`filter_openai_tools_by_skills`,
`openai_runtime.py:303`) is the only reason the analysis project escapes the
15K-token worst case.

### Where the weight is

Per-tool sizes (top of the unfiltered set), desc + params chars:

| Tool | desc | params | total |
|---|---:|---:|---:|
| `manage_metric_views` | 1,121 | 1,214 | 2,335 |
| `manage_dashboard` | 1,689 | 641 | 2,330 |
| `manage_jobs` | 693 | 1,549 | 2,242 |
| `manage_genie` | 1,240 | 906 | 2,146 |
| `manage_job_runs` | 530 | 1,587 | 2,117 |
| … 19 more `manage_*` … | ~800 avg | ~700 avg | ~1,500 avg |
| `submit_conclusion` | 445 | 1,285 | 1,730 |

- App-defined tool **descriptions are already lean** (`execute_sql` 60 chars,
  `execute_sql_multi` 71). The "strip how-to from descriptions" advice does
  **not** apply to them — there is nothing to strip.
- The bloat is the **`manage_*` MCP-tool descriptions** (total desc across all
  tools = 30,192 chars), and a chunk of each one **duplicates the injected
  skill**. Example, `manage_dashboard` (1,689 chars):
  - `"Review the databricks-aibi-dashboards skill ... follow the JSON structure
    detailed in the skill"` — points at the skill that is already in the prompt.
  - A full **"Widget structure rules"** block (queries placement, fieldName
    matching, version numbers, layout grid) — skill-level authoring detail,
    redundant when the skill is enabled.
  - The genuinely tool-specific part (summary + `Actions:` operation/param map)
    is only ~600 of 1,689 chars.

### Source of the descriptions

`_build_fastmcp_tools` (`server/services/tools/databricks_openai.py:1067`)
re-emits each MCP tool's docstring **verbatim** as the `FunctionTool`
description. Those docstrings live in the **shared** `databricks-mcp-server`
package (`databricks_mcp_server/tools/*`), so any source-level trim also affects
standalone MCP clients (which have no injected skill to fall back on).

## Hard constraint that shapes the solution

On the OpenAI-compatible chat/completions API (DeepSeek via the gateway), **the
model can only emit a `tool_call` for a tool whose full parameter schema is in
that request's `tools` array.** There is no "model knows the tool exists and
asks for params." So pure "descriptions always, params on demand" requires
either an extra model round-trip (a discovery turn) or a generic dispatcher that
sacrifices schema validation. (This is exactly the `ToolSearch` / deferred-tools
mechanism Claude Code's own harness uses — but that is Anthropic-API-native and
not available on DeepSeek.)

## Options

| Pattern | How | Extra model turns | Validation | Notes |
|---|---|---|---|---|
| **A. Query-time tool retrieval** (recommended) | Server-side: before the run, score candidate tools against the user message and load only top-K + a fixed always-on core. Makes the existing per-run filter finer. | **No** | Full | Zero added latency; fits existing `filter_openai_tools_by_skills` scaffolding |
| **B. Runtime meta-tool discovery** | Always-on `search_tools(query)`; runtime injects chosen tool schema for the next turn | **Yes (≥1)** | Full after load | Adds latency turns (~5–25s each) — works against the latency goal |
| **C. Generic dispatcher** | One `call_databricks_tool(name, args_json)`; sub-tool descriptions in a list | No | **Lost** (more tool errors) | Quick hack, not production |
| **D. Description compression** | Trim `manage_*` descriptions (keep summary + `Actions:`, drop skill-duplicated prose) in the emit path | No | Full | Smaller, contained win; complements A |

## Recommendation

**Primary: Option A (query-time tool retrieval).** It captures most of the
benefit with no added model latency, because selection happens server-side. The
scaffolding already exists — today the per-run tool list is filtered coarsely by
*enabled skills*; make that filter finer:

1. Keep a generous **always-on core**: plan tools (`update_plan`,
   `submit_conclusion`), project-file read tools, `execute_sql` /
   `execute_sql_multi` / `get_table_schema` / `get_table_stats`.
2. Score the remaining (mostly `manage_*`) candidates against the user message
   (embedding or keyword/BM25 over name + summary), keep top-K (~15–20 total).
3. Add one `request_tools(intent)` escape hatch (an Option-B fallback) used
   **only** when retrieval missed something — not on every run.

**Secondary / complementary: Option D** in `_build_fastmcp_tools` only (not the
shared MCP source), so standalone MCP clients keep full docstrings: keep summary
+ `Actions:` block, drop the embedded `CRITICAL:` workflow and authoring-rule
tails that the injected skill already covers.

**Why not B as primary:** the original motivation included latency (~14
sequential turns, a 24.6s synthesis). A runtime discovery meta-tool *adds* turns
before the first real tool call, making latency worse.

## Is it worth it? (given P0 caching is done)

Benefits, in priority order:
1. **Tool-selection accuracy** — a 30+ tool list with overlapping `manage_*`
   descriptions degrades which tool the model picks. Strongest argument;
   unaffected by caching.
2. **Cache-write + first-turn cost** — paid once per conversation.
3. **Marginal per-turn cost** — small now, thanks to caching.

If build-project accuracy is the pain, Option A is worth it. If it is purely
token cost, caching already handled most of it and Option D is the cheaper play.

Note: `manage_*` tools are **already consolidated super-tools** (each has an
`operation`/`action` enum), so the problem is the **count of ~24 manage tools**,
not granularity.

## Implementation touchpoints

- `server/services/tools/databricks_openai.py` — `_build_fastmcp_tools`
  (Option D description trim); tool construction entry points.
- `server/services/skills_manager.py` — `filter_openai_tools_by_skills`
  (extend into query-time retrieval / Option A).
- `server/services/agent_runtime/openai_runtime.py:281–308` — per-run tool
  assembly + filtering; pass the user message into the retrieval step.

## Open questions / measure first

Before building, **measure on a real build project** (not the 57-tool worst
case):
- How many tools does a real build project's enabled skills actually load?
- How often is the wrong tool picked today (tool-selection accuracy baseline)?

This tells us whether P2 is an *accuracy* fix (justifies Option A + escape
hatch) or just a *cache-write* trim (Option D suffices).

## Verification checklist

- [x] Measure analysis-set tool-schema size (13 tools ≈ 7,100 chars / ~2,000 tok).
- [x] Measure full unfiltered set (57 tools ≈ 60,300 chars / ~15,000 tok).
- [x] Confirm `manage_*` descriptions are MCP-sourced and re-emitted verbatim.
- [x] Confirm description prose duplicates injected skills (e.g. `manage_dashboard`).
- [ ] Measure a real build project's filtered tool count.
- [ ] Establish a tool-selection accuracy baseline (eval set).
- [ ] Decide A vs D (or both) based on the above.
- [ ] Implement always-on core + query-time retrieval (Option A), if chosen.
- [ ] Implement emit-path description compression (Option D), if chosen.
- [ ] Re-measure tokens + re-run accuracy eval; confirm no regression in tool calls.
