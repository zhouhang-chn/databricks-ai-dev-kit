# v0.3 Visual Storytelling Gap Analysis

Date: 2026-05-09

Scope: local source and docs under `databricks-builder-app-oai/` and
`docs/builder-app-oai/`. This review does not include browser rendering,
Databricks workspace validation, or live agent runs.

## Source Baseline

This analysis fact-checks the v0.3 visualization plan against the current OAI
Builder App implementation.

Primary planning sources:

- [`../data-visualization.md`](../data-visualization.md)
- [`../roadmap.md`](../roadmap.md)

Primary app sources checked:

- [`../../../databricks-builder-app-oai/client/src/features/analysis/types.ts`](../../../databricks-builder-app-oai/client/src/features/analysis/types.ts)
- [`../../../databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts`](../../../databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts)
- [`../../../databricks-builder-app-oai/client/src/features/analysis/components/StoryCard.tsx`](../../../databricks-builder-app-oai/client/src/features/analysis/components/StoryCard.tsx)
- [`../../../databricks-builder-app-oai/client/src/features/analysis/components/EvidenceContent.tsx`](../../../databricks-builder-app-oai/client/src/features/analysis/components/EvidenceContent.tsx)
- [`../../../databricks-builder-app-oai/client/src/features/analysis/components/RightInspectPanel.tsx`](../../../databricks-builder-app-oai/client/src/features/analysis/components/RightInspectPanel.tsx)
- [`../../../databricks-builder-app-oai/server/services/tools/databricks_openai.py`](../../../databricks-builder-app-oai/server/services/tools/databricks_openai.py)
- [`../../../databricks-builder-app-oai/server/services/system_prompt.py`](../../../databricks-builder-app-oai/server/services/system_prompt.py)
- [`../../../databricks-builder-app-oai/server/services/tools/plan_tools.py`](../../../databricks-builder-app-oai/server/services/tools/plan_tools.py)

## Roadmap Interpretation

The root roadmap defines v0.3 as "Visualization for Storytelling": charts
should move into the core Analysis Story Panel and make conclusions more
convincing. It explicitly scopes v0.3 to in-conversation visuals, not
dashboarding or BI-tool parity.

The `data-visualization.md` plan expands that into three implementation phases:

- Phase 1: client-side chart detection on existing SQL results.
- Phase 2: model-guided chart specs using `__chart_spec__` blocks.
- Phase 3: a dedicated `visualize_data` tool and chart-driven story
  continuation.

That product direction is compatible with the current app, but the app is
earlier than the planning docs imply. The current app has a usable evidence
pipeline and table rendering foundation, but no chart rendering, no chart
spec contract, and no evidence surface inside the main story card.

## Current Foundation

Implemented or mostly implemented in the OAI app:

- `AnalysisStory` exists with status, plan, context loads, conclusion,
  conclusion text fallback, evidence, trace, next moves, and context.
- `EvidenceType` already includes `'chart'`, but this is only a declared union
  member.
- Tool results are normalized into `tool_result` stream events and then into
  `EvidenceBlock` objects with `content`, `rawContent`, `toolName`, and
  `toolInput`.
- SQL inputs are summarized and SQL comments can become evidence titles.
- `EvidenceContent` parses row-oriented JSON from arrays, `{rows, columns}`,
  `{rows: [{...}]}`, `{data}`, `{results}`, and `{records}` shapes.
- Tabular evidence renders as a compact table in the right inspect panel, with
  preview truncation and CSV download.
- Structured non-tabular JSON renders with pretty-print preview and JSON
  download.
- `get_table_stats_and_schema` and `get_volume_folder_details` have a custom
  schema/table renderer.
- Stream events are persisted in `executions.events_json` and replayed when a
  conversation is reloaded.
- The app already has a plan/conclusion tool contract via `update_plan` and
  `submit_conclusion`.
- Next Moves already accepts model or heuristic suggestions, which gives
  chart-click follow-up prompts a place to land later.

## Fact-Check Findings

| Planning claim | Current app fact | Gap |
|---|---|---|
| Evidence blocks render as table, JSON, markdown, or error. | Correct in practice, but all non-error tool outputs are stored as `type: 'tool_result'`; table/JSON/markdown behavior is inferred inside `EvidenceContent`. | Chart detection should not rely only on `EvidenceType`; it must parse `rawContent`. |
| `EvidenceType` declares `'chart'`, but no path produces or renders it. | Correct. Search found no `ChartSpec`, `chartSpec`, `recharts`, `__chart_spec__`, `__visualization__`, or `visualize_data` implementation outside planning docs. | v0.3 needs the full chart contract and rendering path. |
| v0.3 should focus charts in the Analysis Story Panel. | The main `StoryCard` renders question, plan, conclusion, and next moves. Evidence is only shown in `RightInspectPanel`. | P0 gap: add in-story evidence before charts can satisfy the roadmap theme. |
| Existing SQL evidence is enough for client-side charting. | Mostly true. `execute_sql` returns JSON and cluster fallback normalizes to `{columns, rows}`. Some warehouse paths may return list-of-dicts or nested result objects, which `EvidenceContent` already handles. | Extract shared tabular parsing so chart detection and table rendering use the same interpretation. |
| Phase 1 requires no backend changes. | True if chart specs are derived client-side from persisted `tool_result` events. | Frontend-only Phase 1 is feasible. |
| Phase 2 can parse `__chart_spec__` from agent responses. | Partly mismatched. The current prompt tells the model to end analysis with `submit_conclusion`, not free-form text. The conclusion summary is structured tool input, not ordinary prose. | Phase 2 should either extend `submit_conclusion` with optional chart specs or parse specs from its `summary` as a fallback. |
| Phase 3 adds `visualize_data` as a dedicated backend tool. | No such tool exists. Current Databricks typed wrappers are `execute_sql`, `execute_sql_multi`, `get_table_stats_and_schema`, warehouse helpers, and compute listing. | Add typed tool, read-only gating, skill filtering, prompt guidance, and frontend event handling. |
| Charts can toggle to their underlying table. | Table rendering exists, but no chart/table toggle exists. | Chart evidence should reuse the existing table renderer and CSV export. |
| Conclusion view stitches text + table + chart into a shareable narrative. | Current conclusion is separate from evidence; evidence is not inside the main story. No PNG or clipboard export exists. | Needs a story export design after in-story evidence lands. |
| Chart click interactions become next moves. | Next Moves exist and `onNextMove` can populate/send prompts, but there is no chart selection context or chart click handler. | Feasible after `ChartEvidence` exists. |

## Priority Gaps

| Priority | Gap | Why it matters |
|---|---|---|
| P0 | Main story cards do not render evidence. | The roadmap asks for visual storytelling in the story flow, not only inspect-panel diagnostics. |
| P0 | No `ChartSpec` type or `chartSpec` field on `EvidenceBlock`. | Chart detection and rendering need a stable data contract. |
| P0 | No chart renderer or Recharts dependency. | `type: 'chart'` cannot produce visible UI. |
| P0 | No shared tabular parsing module. | The current table parser is private to `EvidenceContent`; duplicating it would create inconsistent table/chart behavior. |
| P1 | `storyTransforms.ts` always emits non-error tool results as `tool_result`. | Chart evidence cannot be produced until the transform pipeline calls detection or handles visualization markers. |
| P1 | Phase 2 conflicts with required `submit_conclusion` flow. | Free-form `__chart_spec__` blocks are fragile under the current plan-tool contract. |
| P1 | No frontend unit-test harness for chart detection. | Heuristic detection will be hard to harden without focused tests. |
| P1 | No story export path. | Shareable visual narrative is explicitly in roadmap scope. |
| P2 | No linked hover state between chart and table/inspect panel. | Useful for Phase 3, but not required for first chart value. |
| P2 | No validation of model-written chart insights. | Insight annotations can be wrong unless later checked against data. |

## Reframed v0.3 Target

v0.3 should be tagged when an analyst can run a read-only analysis that returns
SQL evidence, see the most relevant evidence inline in the Analysis Story Panel
as a chart or table, switch to the underlying data, and export or copy the
story result.

The practical v0.3 contract is:

```text
execute_sql tool_result
-> persisted raw evidence
-> shared tabular parser
-> chart detection or explicit chart spec
-> inline story evidence
-> table fallback and CSV export
-> conclusion that references visible evidence
-> next moves that can continue from evidence
```

Phase 1 can deliver most user-visible value without backend changes. Phase 2
should adapt the model-guided spec mechanism to the app's `submit_conclusion`
contract. Phase 3 should add `visualize_data` only after chart rendering and
in-story evidence are already stable.

## Recommended Direction

1. Treat in-story evidence rendering as the first v0.3 task. Without it, charts
   would still live in the inspect panel and miss the roadmap goal.
2. Extract row-table parsing, CSV export, and cell formatting into reusable
   analysis evidence utilities.
3. Add `ChartSpec` and `chartSpec?` as optional fields so existing stories and
   persisted events remain compatible.
4. Implement Phase 1 chart detection for `execute_sql` first; handle
   `execute_sql_multi` conservatively only when one clear row table is present.
5. Add Recharts through `pnpm` and do not introduce npm lockfiles.
6. Make charts fail closed to table rendering.
7. For Phase 2, prefer a structured extension to `submit_conclusion` over
   hidden JSON in normal prose. Keep `__chart_spec__` parsing as a compatibility
   or fallback path if needed.
8. Defer chart-click next moves until chart/table rendering and replay are
   reliable.

## Validation Still Needed

- Confirm chart detection against representative real `execute_sql` payloads
  from warehouse and cluster fallback paths.
- Confirm stored execution replay reconstructs chart evidence from old
  `tool_result` events.
- Confirm dark mode chart colors resolve from CSS variables.
- Confirm table fallback works when chart detection produces an invalid spec.
- Confirm story cards remain readable on narrow screens with inline evidence.
- Confirm `pnpm lint` and `pnpm build:typecheck` stay green after adding
  Recharts and chart components.
