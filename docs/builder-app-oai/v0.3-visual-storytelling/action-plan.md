# v0.3 Visual Storytelling Action Plan

## Objective And Release Gates

Objective:

- Deliver decision-ready analysis stories where claim, evidence, caveat, and
  action are visible in the main story card.

Release gates:

1. Story-first gate: stakeholder can decide from story card in under 60s.
2. Evidence gate: chart/table evidence is inline for completed stories with
   reliable fallback; during execution, evidence remains in Inspect.
3. Trust gate: confidence and caveat policy is enforced.
4. Replay gate: persisted executions reproduce narrative visuals consistently.

## Workstreams

Workstream A: Narrative UX

- Narrative contract and reading order
- Claim/evidence/caveat/action presentation
- Confidence language policy
- Contradiction handling

Workstream B: Visualization Pipeline

- Shared evidence parsing
- Chart spec contract
- Heuristic chart detection
- Recharts rendering + complete coordinate axes
- Tooltip, legend, mark selection, and table-highlight interactions
- Chart/table fallback

Workstream C: Agent And Tooling

- Model-guided visualization specs
- `submit_conclusion` structured visualization path
- `visualize_data` tool and read-only gating
- Chart-driven continuation prompts

## Milestone 1: Storytelling Alpha

Goal:

- Establish narrative quality baseline before adding charts.

Scope:

1. Add inline evidence section in `StoryCard`.
2. Limit default story evidence to top 1-3 blocks.
3. Introduce narrative contract fields as optional metadata.
4. Add confidence wording policy in design and prompt guidance.
5. Define contradiction rule behavior.

Acceptance:

- Story card displays claim + evidence + recommended next step in a single flow.
- Running stories keep intermediate evidence and visualizations in the right
  Inspect panel instead of duplicating them in the story card.
- At least 5 golden runs score >= 6/12 on storytelling rubric.

## Milestone 2: Visual Evidence Beta

Goal:

- Deliver frontend-only Recharts evidence from existing SQL results, fixing
  missing coordinate axes and adding basic chart interaction.

Scope:

1. Extract shared parser utilities from `EvidenceContent.tsx`.
2. Add `ChartSpec` and `chartSpec?` in analysis types.
3. Add `recharts` with `pnpm add recharts`.
4. Refactor `EvidenceChart.tsx` from hand-rolled SVG/HTML to Recharts while
   keeping the existing component boundary.
5. Add full x/y axes, ticks, gridlines, labels, and responsive tick reduction
   for bar, line, and scatter charts.
6. Improve chart detection so `yearmonth`, `yyyymm`, `month`, `week`,
   `period`, and similar fields become ordered temporal/category dimensions
   instead of scatter axes.
7. Add dual-axis combo charts for mixed count/volume plus percentage/rate
   trend results, preserving `colorField` categories as separate bar/line
   series and aggregating only duplicate `(xField, colorField)` rows.
8. Add tooltip, legend toggle, active mark styling, keyboard focus labels, and
   chart-to-table row highlight.
9. Keep table/CSV fallback for all chart evidence.
10. Ensure inspect panel and story card stay consistent.

Acceptance:

- Bar, line, pie, and scatter render for valid shapes using Recharts.
- Cartesian charts show readable coordinates: x ticks, y ticks, gridlines, and
  formatted labels in both story card and Inspect panel.
- `yearmonth` trend fixtures render as line charts, not scatter plots.
- Mixed `total_records` + `achieved_pct` fixtures render as a dual-axis combo:
  bars for counts on the left axis and percentage lines on the right axis.
- Duplicate `yearmonth` rows collapse into one x-axis bucket while preserving
  each breakdown category as matching count-bar and percentage-line series.
- A fixture with `mha_sku_key_type` values `''`, `CIO`, and `Subbrand*PACK`
  renders three `total_records` bar series and three `achieved_pct` line
  series.
- A categorical fixture with `channel × mha_sku_key_type`, `total_records`,
  and `achieved_pct` renders as a grouped bar plus line combo, not a pie chart.
- Pie charts require a single categorical dimension with unique labels; repeated
  x labels or a second categorical breakdown fall back to bar/combo rendering.
- Legend and tooltip markers distinguish bar series from line series even when
  category colors are shared across metrics.
- Missing category-metric combinations are not backfilled in combo charts:
  absent bars stay absent, lines break at missing points, and tooltips omit
  missing values rather than borrowing another category's value.
- Hover/focus shows exact values; legend toggles series; active marks highlight
  matching table rows.
- Metadata/schema/single-value outputs remain non-chart.
- Replayed executions render same chart decisions deterministically.

## Milestone 3: Model-Guided Narrative

Goal:

- Improve chart intent and insight quality with model context.

Scope:

1. Add structured visualization argument path for `submit_conclusion`.
2. Emit/consume visualization spec events in stream transforms.
3. Support `__chart_spec__` parsing only as compatibility fallback.
4. Add spec validation and safe fallback behavior.
5. Add contradiction detection between insight and evidence values.

Acceptance:

- Model can provide title + insight on primary chart evidence.
- Invalid model spec never breaks story rendering.
- Confidence downgrades when contradiction is detected.

## Milestone 4: Interactive Continuation

Goal:

- Turn evidence interactions into controlled next steps.

Scope:

1. Add `visualize_data` typed tool with read-only SQL safety parity.
2. Add prompt policy for `visualize_data` vs `execute_sql`.
3. Convert visualization tool payloads into chart evidence directly.
4. Add chart-click generated drill prompts (user-confirmed send).
5. Add optional hover-link between chart mark and table row.

Acceptance:

- Trace shows explicit visualization intent.
- Chart click proposes follow-up prompt without auto-send.
- Read-only mode blocks non-read SQL through visualization path.

## Milestone 5: Shareability And Hardening

Goal:

- Ship shareable, reliable narrative output.

Scope:

1. Copy story as Markdown with narrative fields.
2. Export primary chart as PNG.
3. Add large-result guards and rendering caps.
4. Validate mobile and narrow desktop readability.
5. Validate light/dark theme readability.

Acceptance:

- Story markdown export includes claim/evidence/caveat/action.
- Chart PNG export works for primary chart types.
- Large evidence payloads do not freeze story panel.

## Acceptance Criteria: Story-First + Technical

Story-first criteria:

1. Clear decision claim exists in every completed story.
2. Primary evidence is visible inline in story card after execution completes.
3. Caveat and confidence are explicit when uncertainty exists.
4. Recommended next step is concrete, not generic.
5. Story quality rubric score >= 8/12 with no zero in core dimensions.

Technical criteria:

1. Chart rendering is backward compatible with old execution events.
2. Invalid chart specs fallback to table.
3. Parser behavior is shared between chart and table paths.
4. Recharts tooltips, axes, legends, and active marks work in both story-card
   inline evidence and right Inspect evidence.
5. `pnpm lint` and `pnpm build:typecheck` pass for client.
6. Python test suite additions pass for runtime/tooling changes.

## Golden Conversation Review Loop

Use 10 representative conversations:

1. Trend deterioration
2. Segment outlier
3. Composition shift
4. Correlation suspicion
5. Metadata-only query
6. Single-value KPI query
7. High-cardinality ranking
8. Partial data period query
9. Contradictory evidence scenario
10. Cross-check follow-up scenario

Review process:

1. Score each run with storytelling rubric.
2. Track contradictions and confidence misuse.
3. Feed defects into next milestone backlog.

## Validation Commands And Environments

Frontend validation:

```bash
cd databricks-builder-app-oai/client
pnpm install
pnpm lint
pnpm build:typecheck
```

Backend/runtime validation:

```bash
cd databricks-builder-app-oai
UV_CACHE_DIR=/tmp/uv-cache-ai-dev-kit uv run pytest tests/test_openai_runtime.py tests/test_skills_manager.py -q
```

Local app smoke setup:

```bash
cd databricks-builder-app-oai
./scripts/start_local.sh --profile <profile>
```

Before browser tests, confirm services:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:3000
```

If testing `pnpm preview`, check `127.0.0.1:4173`.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Charts improve visuals but not decisions | v0.3 misses product goal | Enforce narrative contract and rubric gates |
| Overfitting heuristics to synthetic examples | Poor real-query behavior | Use golden conversation suite with mixed query shapes |
| Model specs conflict with runtime contract | Broken or ignored specs | Prefer structured `submit_conclusion` extension |
| Performance degradation on large results | Poor UX and trust loss | Add row caps and fallback behavior early |

## Exit Criteria

v0.3 is complete when:

1. Narrative and visual gates both pass.
2. Golden conversation loop meets score threshold.
3. No critical contradiction/trust defects remain open.
4. Story output is shareable without leaving the app.
