# v0.3 Visual Storytelling Action Plan

## Purpose

This plan turns the roadmap and visualization design into an implementation
sequence for `databricks-builder-app-oai`.

The build order is intentionally frontend-first. The app already persists SQL
tool results and renders tables in the inspect panel. v0.3 should first bring
that evidence into the story, then make chartable evidence visual, then add
model and tool support.

## Execution Principles

- Use `pnpm` for all frontend package commands.
- Do not introduce npm lockfiles.
- Keep existing SSE and persisted execution events backward compatible.
- Reuse the current evidence pipeline before adding new backend tools.
- Add chart behavior as optional metadata on evidence blocks.
- Keep table fallback available for every chart.
- Prefer focused tests around parsing, detection, and event transforms.

## Progress Snapshot

Last updated: 2026-05-09.

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Fact Check And Design Docs | Complete | Current docs identify the evidence/table foundation and the missing chart/story gaps. |
| Phase 1: In-Story Evidence Foundation | Not started | Required before charting satisfies the roadmap. |
| Phase 2: Client-Side Chart Detection | Not started | Frontend-only Phase 1 from `data-visualization.md`. |
| Phase 3: Model-Guided Visualization | Not started | Needs adjustment to the current `submit_conclusion` contract. |
| Phase 4: Visualization Tool And Interactions | Not started | Backend tool and chart-click continuation. |
| Phase 5: Export And Polish | Not started | Clipboard/PNG story sharing and visual QA. |

## v0.3 Build Order

1. Extract shared evidence parsing and table rendering.
2. Render evidence inside the main story card.
3. Add `ChartSpec` and Recharts chart rendering.
4. Add client-side chart detection for SQL results.
5. Add model-guided specs in a way that fits `submit_conclusion`.
6. Add `visualize_data` and chart-click next moves.
7. Add export and responsive visual QA.

## Phase 0: Fact Check And Design Docs

Goal: align v0.3 docs with the actual OAI app.

Tasks:

- Compare `data-visualization.md` and `roadmap.md` against the current app.
- Document implemented foundations and missing pieces.
- Reconcile `__chart_spec__` planning with the current `submit_conclusion`
  runtime contract.
- Create v0.3 `gap-analysis.md`, `design.md`, and `action-plan.md`.

Acceptance gates:

- Docs identify that evidence currently renders only in the right inspect
  panel.
- Docs identify that `EvidenceType` includes `'chart'` but no code produces or
  renders chart evidence.
- Docs recommend a frontend-first Phase 1.

## Phase 1: In-Story Evidence Foundation

Goal: make evidence part of the main story narrative before adding charts.

Tasks:

- Extract evidence parsing helpers from `EvidenceContent.tsx` into
  `client/src/features/analysis/evidenceData.ts`.
- Extract tabular rendering into `TableEvidence.tsx`.
- Keep JSON, markdown, error, and schema-stat rendering behavior compatible.
- Add an inline evidence section to `StoryCard.tsx`.
- Show the most relevant 1-3 evidence blocks in the story card.
- Keep the full evidence list in `RightInspectPanel.tsx`.
- Ensure evidence blocks can be selected/opened through the existing active
  story behavior.

Acceptance gates:

- A story with SQL evidence shows a compact table in the main story card.
- The right inspect panel still shows all evidence and tool inputs.
- CSV download still works for tabular evidence.
- Old persisted executions replay into the same visible evidence.

Suggested validation:

```bash
cd databricks-builder-app-oai/client
pnpm lint
pnpm build:typecheck
```

## Phase 2: Client-Side Chart Detection

Goal: deliver Phase 1 from `data-visualization.md`: existing SQL evidence can
become chart evidence without backend changes.

Tasks:

- Add Recharts with `pnpm`.
- Add `ChartSpec` to `client/src/features/analysis/types.ts`.
- Add optional `chartSpec?: ChartSpec` to `EvidenceBlock`.
- Create `client/src/features/analysis/chartDetection.ts`.
- Create `client/src/features/analysis/components/ChartEvidence.tsx`.
- Create `client/src/features/analysis/components/chartTheme.ts`.
- Update `EvidenceContent.tsx` to render chart evidence before table fallback.
- Update `storyTransforms.ts` to detect chart specs for successful SQL tool
  results.
- Normalize tool names before detection so both `execute_sql` and
  `mcp__databricks__execute_sql` are handled.
- Treat invalid chart specs as table evidence.

Detection acceptance gates:

- Date/time plus numeric data renders as a line chart.
- Category plus numeric data renders as a bar chart when row count is
  reasonable.
- One category plus one numeric value with no more than 8 rows can render as a
  pie chart.
- Two numeric fields with no category can render as a scatter chart.
- Metadata and schema inspection results do not chart.
- Single-row results do not chart.
- Very wide or high-cardinality results stay as tables.

UI acceptance gates:

- Chart evidence includes a table toggle.
- Table fallback is always available.
- Chart tooltips show exact values.
- CSV download still exports all rows, not only visible rows.
- Dark mode colors are readable.
- Mobile/narrow layouts do not overlap labels or controls.

Suggested validation:

```bash
cd databricks-builder-app-oai/client
pnpm install
pnpm lint
pnpm build:typecheck
```

If a frontend unit-test harness is added:

```bash
cd databricks-builder-app-oai/client
pnpm test
```

## Phase 3: Model-Guided Visualization

Goal: let the agent choose chart specs based on the analytical question, not
only data shape.

Tasks:

- Choose the structured contract:
  - preferred: add optional `visualizations` to `submit_conclusion`
  - fallback: parse `__chart_spec__` from conclusion markdown
- Add validation for model-supplied chart specs.
- Add a stream event for submitted visualization specs if using the structured
  contract.
- Attach specs to evidence by explicit id when possible.
- Fall back to the most recent successful SQL evidence only when unambiguous.
- Let model specs override heuristic specs only after validation.
- Strip raw `__chart_spec__` blocks from visible markdown when fallback parsing
  is used.
- Add prompt guidance for when to visualize and when not to visualize.

Acceptance gates:

- The model can request a chart title and insight annotation.
- Model-guided specs survive persisted execution replay.
- Bad model specs do not break evidence rendering.
- A run that follows the current plan-tool lifecycle can still submit a
  visualization spec without free-form response leakage.

Suggested validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_openai_runtime.py -q
cd client
pnpm lint
pnpm build:typecheck
```

## Phase 4: Visualization Tool And Interactions

Goal: make visualization intent explicit and let charts become story navigation
surfaces.

Tasks:

- Add a typed `visualize_data` function tool in
  `server/services/tools/databricks_openai.py`.
- Reuse `execute_sql` read-only SQL checks and default resource handling.
- Return JSON with rows, columns, `chart_spec`, and `__visualization__: true`.
- Add `visualize_data` to typed tool names and read-only skill filtering only
  after SQL safety gates are shared.
- Update `system_prompt.py` with `visualize_data` vs `execute_sql` guidance.
- Update `storyTransforms.ts` to convert `__visualization__` tool results into
  chart evidence.
- Add chart click handlers that create a proposed drill-down prompt.
- Wire chart-generated prompts through the existing next-move/input flow.
- Add optional hover state linking chart marks to table rows.

Acceptance gates:

- `visualize_data` works in read-only user-preview mode only for read-only SQL.
- The plan/trace clearly shows visualization intent.
- A chart click proposes a follow-up prompt but does not auto-run it.
- The underlying table remains available.

Suggested validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_openai_runtime.py tests/test_skills_manager.py -q
cd client
pnpm lint
pnpm build:typecheck
```

## Phase 5: Export, QA, And Release Hardening

Goal: make the visual story shareable and reliable enough for analyst pilot
use.

Tasks:

- Add "copy story as Markdown" for question, conclusion, evidence summaries,
  and next moves.
- Add PNG export for individual charts.
- Decide whether full-story PNG export is required for v0.3 or deferred.
- Add loading, empty, invalid-spec, and too-many-points states.
- Add chart data caps and truncation messaging.
- Test narrow desktop and mobile widths.
- Test light and dark theme readability.
- Run a local browser smoke test with both backend and frontend reachable.

Acceptance gates:

- Analyst can copy a story summary with visible evidence references.
- Chart PNG export works for bar and line charts.
- Large SQL results do not freeze the story panel.
- Browser smoke test confirms chart and table toggles render correctly.

Suggested validation:

```bash
cd databricks-builder-app-oai
./scripts/start_local.sh --profile <profile>
```

Before browser tests, confirm both services are reachable:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:3000
```

If the frontend under test is served on a different Vite port, for example
`4173` for `pnpm preview`, check that port instead of `3000`.

## v0.3 Exit Criteria

- SQL result evidence appears in the main Analysis Story Panel.
- At least bar, line, pie, and scatter chart evidence can render from existing
  SQL results.
- Every chart can switch to the underlying table.
- Chart rendering failure falls back to table rendering.
- Persisted executions replay chart evidence deterministically.
- The agent has guidance for when not to visualize.
- A shareable copy/export path exists for the story or chart.
- `pnpm lint` and `pnpm build:typecheck` pass.

## Deferred After v0.3

- Saved chart library.
- Dashboard composition.
- Full BI-style chart editing.
- Statistical insight verification.
- Auto-send chart interactions.
- Heatmap heuristics for pivoted data.
- Server-rendered chart images.
