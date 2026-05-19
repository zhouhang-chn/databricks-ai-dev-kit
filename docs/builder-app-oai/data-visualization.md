# Data Visualization in Analysis Stories

## Why Visualize

An analysis story answers a business question. It moves through a
sequence — question → plan → evidence gathering → conclusion → next
moves. Every piece of the sequence exists to build the analyst's
conviction: "I understand what the data says, I trust the evidence, and I
know what to do next."

A table of numbers can be evidence. But for many analytical questions the
numbers only become evidence when their **shape** is visible — a trend,
a ranking, a distribution, a composition, an outlier. A bar chart does
not decorate a table; it is a different way of answering the same
question. It makes the answer faster to read, harder to misread, and
easier to act on.

The first principle of visualization in this system is therefore:

> **A chart exists to make the analysis story's conclusion more
> convincing, not to make the UI more colorful.**

This means the right question is never "should we chart this data?" but
rather "what is the story trying to say, and would a chart say it
better?"

## What the Analysis Story Looks Like Today

An `AnalysisStory` in `databricks-builder-app-oai` is structured as:

```
question          ← the user's analytical intent
status            ← planning → running → done | error
trace             ← ordered steps the agent took (tool calls)
evidence[]        ← ordered blocks: text, table, tool_result, error
conclusion        ← streamed Markdown answer
nextMoves[]       ← follow-up suggestions (drill, compare, validate...)
context           ← metrics, dimensions, filters, conversation
```

Evidence blocks carry the raw data behind the conclusion. The conclusion
interprets the evidence. Next moves extend the story. The inspect panel
shows trace details and evidence drilldowns. During live execution, evidence
and intermediate visualizations are inspect-panel only so the story card stays
focused on the running plan. Inline story-card evidence appears after the run
leaves the streaming states and the narrative can use it as final support.

Today, all evidence blocks render as:

- **Table** — when the tool result is row-oriented JSON.
- **JSON** — when the result is structured but not tabular.
- **Markdown** — when the result is plain text.
- **Error** — when the tool call failed.

The type system already declares `'chart'` in `EvidenceType`, but no
path produces or renders it.

## Analysis Goals That Need Visualization

Not every analysis story benefits from a chart. The decision depends on
what the analysis is trying to convey. Here are the common analytical
intents in the builder app and how visualization serves each:

### 1. Comparison — "How does A compare to B?"

The analyst wants to see relative magnitude across categories: revenue by
region, error counts by service, spend by department.

**What the visualization conveys:** Rank order and relative gap at a
glance. A horizontal bar chart sorted by value answers "which is biggest
and by how much" in under two seconds — something a 20-row table cannot.

**Chart type:** Bar (horizontal for long labels, vertical for short).
Sorted descending unless the categories have a natural order.

### 2. Trend — "How has X changed over time?"

The analyst is looking for direction, inflection, seasonality, or
anomaly in a time-ordered metric.

**What the visualization conveys:** Trajectory shape. A line chart shows
whether the metric is growing, flat, or declining, and where it
inflected. Area charts add volume perception for cumulative or stacked
time series.

**Chart type:** Line (single metric), area (stacked or cumulative),
multi-line (comparison across segments over time).

### 3. Composition — "What makes up the whole?"

The analyst wants to understand proportional contribution: channel mix,
cost breakdown, status distribution.

**What the visualization conveys:** Part-to-whole relationship. A pie or
donut chart answers "what share does each part hold" for ≤ 8 categories.
A stacked bar answers the same question when there are too many slices
or when comparison across groups matters.

**Chart type:** Pie (≤ 8 categories, single level), stacked bar (more
categories or cross-group comparison).

### 4. Distribution — "What does the spread look like?"

The analyst wants to understand concentration, variance, or outliers:
latency distribution, price range, score histogram.

**What the visualization conveys:** Shape of the data — normal,
skewed, bimodal, long-tailed. Scatter plots show joint distributions
between two numeric dimensions.

**Chart type:** Scatter (two numeric axes), histogram (binned frequency
— deferred to a later phase).

### 5. Correlation — "Are X and Y related?"

The analyst suspects a relationship between two measures and wants
visual confirmation before running a statistical test.

**What the visualization conveys:** Direction and strength of association.
A scatter plot with optional size encoding answers "do these two things
move together?"

**Chart type:** Scatter with optional size/color encoding.

### 6. Anomaly — "Is anything unusual?"

The analyst is scanning for outliers in an otherwise regular pattern:
a sudden spike, a missing period, a data quality gap.

**What the visualization conveys:** Deviation from the expected shape.
This is often a line chart with a clear baseline, or a bar chart where
one bar is visually disproportionate.

**Chart type:** Same as comparison or trend, but the chart's value is
highlighting the exception rather than the overall pattern.

### When NOT to Visualize

- **Metadata queries** (DESCRIBE, SHOW SCHEMAS, list catalogs) — the
  answer is a catalog listing, not an analytical finding.
- **Single-value results** — "total revenue is $4.2M" is better as a
  number in the conclusion text than as a bar chart with one bar.
- **Schema inspection** — column names and types are structural
  information, not analytical evidence.
- **Very few rows (< 2)** — no shape to see.
- **Very many categories (> 50)** — the chart becomes unreadable; a
  sorted table with conditional formatting would be better (future work).

## Design Principles

1. **Visualization serves the story.** A chart must make the conclusion
   easier to believe or the next move easier to choose. If neither, show
   a table.

2. **Data, not images.** Charts render client-side from structured data.
   The same data feeds the table view, the CSV export, and the chart.
   Nothing is lost by switching views.

3. **Every chart has a dual.** Every chart evidence block can toggle to
   its underlying data table, and every table block can toggle to a chart
   (when the data is chartable). The user chooses the lens.

4. **Graceful degradation.** If chart rendering fails — wrong column
   types, missing fields, rendering error — the block falls back to the
   table view silently.

5. **The agent gets smarter over time.** Phase 1 uses client-side
   heuristics to auto-detect chart opportunities. Phase 2 lets the model
   choose the visualization. Phase 3 gives the model a dedicated tool.
   Each phase improves chart quality without breaking the prior one.

## Current Renderer Gaps

The current frontend uses a hand-rolled SVG/HTML renderer in
`EvidenceChart.tsx`. It is useful as a proof of concept, but it is now the
main blocker for production-quality visual evidence:

1. **Coordinates are incomplete.** Line and scatter charts draw only the axis
   baselines and a small amount of text. They do not render y-axis ticks,
   x-axis tick series, gridlines, numeric domains, or responsive label
   collision handling. Bar charts are rendered as progress-bar rows, so users
   can compare relative magnitude but cannot read a real chart scale.
2. **Temporal fields can be misclassified.** Encoded time fields such as
   `yearmonth`, `yyyymm`, `month`, `week`, and `period` can be treated as
   numeric scatter axes instead of ordered time dimensions.
3. **Mixed units share one scale.** Results that combine volume fields
   (`total_records`, counts, amounts) with rate fields (`achieved_pct`,
   percentages, ratios) need dual-axis combo charts. A single y-axis makes the
   rate line unreadable beside large counts.
4. **Breakdown rows repeat the x-axis.** Time-series results that include an
   extra category dimension can produce repeated x ticks. For mixed-unit
   summaries, the chart should keep one x bucket per period while preserving
   the breakdown as separate count bars and rate lines. Aggregation is only
   allowed for duplicate rows at the exact `(xField, colorField)` grain.
5. **Charts are not interactive.** There is no tooltip, active mark state,
   keyboard focus state, legend toggle, point/bar/slice selection, or linked
   highlight between a chart mark and its backing table row.

The next visualization change should therefore replace the renderer layer with
Recharts while keeping the existing evidence data contract (`ChartSpec` +
`RowOriented`) stable.

## Chart Specification

The `ChartSpec` is the contract between detection (client heuristic or
model guidance) and rendering (Recharts component). It is a declarative,
column-oriented description of what to show.

```typescript
export interface ChartSpec {
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'heatmap';
  xField: string;                    // category or time axis column
  yFields: string[];                 // one or more value columns
  colorField?: string;               // grouping / color encoding column
  sizeField?: string;                // size encoding (scatter, heatmap)
  xLabel?: string;                   // axis label override
  yLabel?: string;
  sort?: 'asc' | 'desc' | 'natural';
  stacked?: boolean;                 // stack bar/area series
  showLabels?: boolean;              // data labels on bars/points
  title?: string;                    // chart title override

  // Annotation for the story: what should the reader see?
  insight?: string;                  // e.g. "APAC leads by 40% margin"
}

export interface EvidenceBlock {
  id: string;
  type: EvidenceType;
  title: string;
  content: string;
  rawContent?: string;
  isError?: boolean;
  createdAt: string;
  toolName?: string;
  toolInput?: string;
  chartSpec?: ChartSpec;             // present when type === 'chart'
}
```

The `insight` field is optional but important: it carries the analytical
message the chart is meant to convey. In Phase 1, the heuristic cannot
produce it. In Phase 2, the model writes it. In Phase 3, the
visualization tool generates it from the data and the question context.

---

## Phase 1: Client-Side Chart Rendering

**Goal:** Make existing SQL evidence blocks chartable without any
backend changes.

### What It Delivers to the Story

After Phase 1, a story that runs `execute_sql` and gets back a table of
revenue by region can automatically show a bar chart above the table
instead of requiring the analyst to eyeball the numbers. A time-series
query can show a line chart. While the run is still executing, those evidence
blocks and charts live in the right inspect panel. Once the run is no longer
streaming, the story card can surface the selected inline evidence as part of
the completed narrative. The analyst can always toggle to the table for exact
values.

The improvement is in the *evidence section* of the story: evidence
blocks that previously forced the analyst to read raw numbers now offer a
visual summary.

### How Detection Works

A new `chartDetection.ts` module examines every SQL tool result and
classifies its columns:

The shared parser must first normalize the supported SQL result envelopes into
row-oriented records. This includes direct arrays from `execute_sql` and
`execute_sql_multi` wrapper payloads shaped like
`{ "results": { "0": { "status": "success", "sample_results": [...] } } }`.
For multi-query wrappers, use the lowest `query_index` successful result with
non-empty `sample_results`; error-only wrappers remain raw JSON/error evidence.

```typescript
function detectChartSpec(
  toolName: string | undefined,
  rawContent: string,
  tabular: RowOriented | null
): ChartSpec | null {
  // Only SQL tool results with tabular data
  if (!tabular || tabular.rows.length < 2) return null;
  if (toolName !== 'execute_sql' && toolName !== 'execute_sql_multi') return null;

  const { columns, rows } = tabular;

  // Classify columns into numeric and categorical
  const numericCols = columns.filter((c) =>
    rows.every((r) => r[c] == null || typeof r[c] === 'number' || !isNaN(Number(r[c])))
  );
  const categoryCols = columns.filter((c) => !numericCols.includes(c));

  if (numericCols.length === 0) return null;

  // --- Analytical intent mapping ---

  // Trend: date-like category + numeric values → line or area
  const timeCols = categoryCols.filter(isLikelyDateColumn);
  if (timeCols.length > 0 && numericCols.length >= 1) {
    return {
      chartType: numericCols.length > 1 ? 'area' : 'line',
      xField: timeCols[0],
      yFields: numericCols.slice(0, 4),
      sort: 'asc',
    };
  }

  // Composition: 1 category + 1 numeric, very few unique categories → pie
  if (
    categoryCols.length === 1
    && numericCols.length === 1
    && rows.length <= 8
    && new Set(rows.map((r) => r[categoryCols[0]])).size === rows.length
  ) {
    return {
      chartType: 'pie',
      xField: categoryCols[0],
      yFields: [numericCols[0]],
    };
  }

  // Comparison: category + numeric, moderate row count → bar
  if (categoryCols.length >= 1 && numericCols.length >= 1 && rows.length <= 30) {
    return {
      chartType: 'bar',
      xField: categoryCols[0],
      yFields: numericCols.slice(0, 3),
      colorField: categoryCols[1],
      sort: rows.length > 10 ? 'desc' : 'natural',
    };
  }

  // Correlation: all numeric columns → scatter
  if (categoryCols.length === 0 && numericCols.length >= 2) {
    return {
      chartType: 'scatter',
      xField: numericCols[0],
      yFields: [numericCols[1]],
      sizeField: numericCols[2],
    };
  }

  return null;
}

function isLikelyDateColumn(col: string): boolean {
  const lowered = col.toLowerCase();
  return /date|time|month|year|quarter|week|day|period|_at$|_ts$/.test(lowered);
}
```

### How Rendering Works

**Library:** Recharts — React-native, declarative, CSS-variable-aware,
and already aligned with the documented chart direction.

| Factor | Recharts | D3 | Observable Plot | ECharts |
|--------|----------|----|-----------------|---------|
| React native | ✅ | ❌ | ❌ | ❌ |
| Bundle size | ~150 KB | ~70 KB | ~100 KB | ~800 KB |
| Declarative | ✅ | ❌ | ✅ | ✅ |
| Dark mode | CSS vars | Manual | CSS | Theme |

**Renderer responsibilities:**

- Render complete axes for Cartesian charts: x-axis ticks, y-axis ticks,
  axis labels, gridlines, numeric/date formatting, and responsive tick
  reduction for narrow evidence cards.
- Render mixed-unit trend results as dual-axis combo charts: count/volume
  measures as bars on the left axis, percentage/rate measures as lines on the
  right axis.
- For combo charts with a `colorField`, preserve category grain exactly:
  collapse repeated x values into axis buckets, then render one count/volume
  bar series and one percentage/rate line series per category. Sum or
  weighted-average values only when multiple rows share the same
  `(xField, colorField)` key.
- Encode chart mark type in legends and tooltips. Category color may be shared
  across count and rate series, but bars must use a bar marker and lines must
  use a line marker so users can distinguish mark type without inspecting the
  plot.
- Treat missing category-metric combinations as missing. Do not borrow values
  from another category in the same x bucket, do not interpolate lines through
  missing points, and do not show missing combinations as real tooltip values.
- Choose appropriate Recharts primitives from `ChartSpec`: `BarChart`,
  `LineChart`, `AreaChart`, `ScatterChart`, `PieChart`, and `ComposedChart`.
- Preserve table fallback and CSV download for every chart.
- Keep layout stable in both the main story card and right Inspect panel.
- Expose accessible hover/focus/click state for chart marks.

**Components:**

- `EvidenceChart.tsx` — refactor the existing component into the Recharts
  wrapper. Keep the public component name so `EvidenceContent.tsx` integration
  stays small.
- `chartTheme.ts` — maps design system CSS variables into Recharts
  colors, fonts, gridlines, axes, active marks, and tooltip styling.
- `chartScales.ts` or equivalent helpers — shared tick/formatting logic for
  numbers, dates, percentages, and compact large values.
- Optional later split: `ChartEvidence.tsx` can be introduced only if the
  wrapper becomes too large; it is not required for the first implementation.

**Integration into `EvidenceContent`:**

The existing component gains a chart-first branch. When the evidence
block has `type === 'chart'` and a valid `chartSpec`, the chart renders
above a collapsible "Show data table" toggle. If the spec is invalid
or Recharts throws, the component catches the error and renders the
existing table view.

### How the Transform Pipeline Changes

In `storyTransforms.ts`, the `tool_result` event handler adds chart
detection before creating the evidence block:

```typescript
// Inside storyEventsFromStreamEvent, in the tool_result branch:
const chartSpec = detectChartSpec(toolName, rawContent, tabular);
const evidenceType = chartSpec ? 'chart' : isError ? 'error' : 'tool_result';
// ... attach chartSpec to the evidence block
```

### Interactivity

Phase 1 charts are interactive evidence:

- **Tooltip** on hover shows exact values.
- **Legend click** toggles series visibility.
- **Mark hover/focus** highlights the active bar, point, line point, or pie
  slice and exposes the same values through `aria-label`.
- **Mark click** selects the backing row and can populate a user-confirmed
  drill-down prompt in a later milestone.
- **Linked table highlight** highlights the corresponding fallback table row
  when a chart mark is active.
- **View toggle** switches between chart and table within the same block.
- **CSV download** (existing) remains available.
- **PNG export** via Recharts SVG serialization (optional toolbar button).

### Files Changed

| File | Change |
|------|--------|
| `client/package.json` | Add `recharts` dependency using `pnpm add recharts` |
| `client/src/features/analysis/types.ts` | Reuse existing `ChartSpec`; add interaction metadata only if needed |
| `client/src/features/analysis/chartDetection.ts` | Improve temporal detection and scatter gating |
| `client/src/features/analysis/storyTransforms.ts` | Keep existing chart spec attachment path |
| `client/src/features/analysis/components/EvidenceChart.tsx` | Refactor from hand-rolled SVG/HTML into Recharts wrapper; add dual-axis combo rendering |
| `client/src/features/analysis/components/chartTheme.ts` | **NEW** — design token mapping |
| `client/src/features/analysis/components/EvidenceContent.tsx` | Add chart/table view toggle and linked highlight state |

Estimated scope: ~6 files, ~500-800 lines. No backend changes.

### What Phase 1 Cannot Do

- The heuristic has no understanding of the *question*. It cannot tell
  whether a bar chart or a pie chart better serves the analyst's intent.
  It only reads column types and row counts.
- No `insight` annotation — the chart shows data but does not highlight
  what matters.
- No auto-sent chart interactions. Clicks may select marks and prepare
  prompts, but the user must confirm before any agent run starts.

---

## Phase 2: Model-Guided Visualization

**Goal:** Let the agent choose and annotate charts based on the
analytical question, not just the data shape.

### What It Delivers to the Story

After Phase 2, the agent understands the analyst's question and decides
whether and how to visualize each SQL result. The story's evidence
blocks carry richer charts:

- The chart type matches the analytical intent (comparison → bar,
  trend → line), not just the column types.
- The `insight` field contains a one-line annotation: "APAC grew 37%
  QoQ, 3× the global average."
- The chart title reflects the question, not the tool name.
- The model can choose *not* to chart a result when a table is more
  appropriate, even if the heuristic would have triggered.

The improvement spans the *evidence section* and the *conclusion*: the
model can reference the chart in its conclusion text, creating a tighter
narrative loop between prose and visual evidence.

### How the Agent Guides Visualization

A new section in `system_prompt.py` teaches the agent when and how to
request charts:

```python
VISUALIZATION_GUIDANCE = """
## Data Visualization

When a SQL result answers the user's question and the answer is best
understood visually, include a chart specification in your response.

### When to Visualize

| Analytical intent | Chart type | When to use |
|-------------------|------------|-------------|
| Comparison | bar | Ranking or relative magnitude across categories |
| Trend | line / area | Change over time; seasonality; inflection |
| Composition | pie / stacked bar | Part-to-whole; channel mix; cost split |
| Correlation | scatter | Relationship between two numeric measures |
| Anomaly | line or bar | Highlighting an exception in a pattern |

### When NOT to Visualize

- Metadata queries (DESCRIBE, SHOW, catalog listings)
- Single-value results
- Schema inspection
- Results with < 2 rows

### Specification Format

After a SQL execution whose result should be visualized, include this
JSON block in your text response:

```json
{"__chart_spec__": {
  "chartType": "bar",
  "xField": "region",
  "yFields": ["total_revenue"],
  "sort": "desc",
  "title": "Revenue by Region",
  "insight": "APAC leads at $4.2M, 40% above EMEA"
}}
```

The frontend will render the chart and attach the insight as an
annotation. The spec is removed from the displayed text automatically.
"""
```

### How the Frontend Processes Model Specs

In `storyTransforms.ts`, the conclusion text handler parses
`__chart_spec__` JSON blocks:

1. Scan the incoming `text_delta` / `text` events for the pattern.
2. Extract the JSON and validate it against `ChartSpec`.
3. Attach the spec to the most recent SQL tool result evidence block.
4. Strip the raw `__chart_spec__` JSON from the rendered conclusion.

Model-provided specs override any heuristic detection from Phase 1. If
the model provides a spec, it wins. If the model does not, the Phase 1
heuristic still fires as a fallback.

### Insight Annotation Rendering

When `chartSpec.insight` is present, the `EvidenceChart` component
renders a subtle annotation below the chart:

```
┌─────────────────────────────────────────┐
│  Revenue by Region           (bar chart)│
│  █████████████  APAC   $4.2M            │
│  █████████      EMEA   $3.0M            │
│  ████████       AMER   $2.8M            │
│  ██             LATAM  $0.6M            │
│                                         │
│  💡 APAC leads at $4.2M, 40% above EMEA │
└─────────────────────────────────────────┘
```

### Files Changed

| File | Change |
|------|--------|
| `server/services/system_prompt.py` | Add visualization guidance section |
| `client/src/features/analysis/storyTransforms.ts` | Parse `__chart_spec__` from conclusion text, attach to evidence |
| `client/src/features/analysis/components/EvidenceChart.tsx` | Render `insight` annotation |

### What Phase 2 Cannot Do

- The model must embed the spec in free text, which is fragile.
- The model cannot see the chart — it cannot refine axis ranges, color
  choices, or label formatting based on rendering feedback.
- Chart interaction still does not feed back into the story.

---

## Phase 3: Visualization Tool and Interactive Stories

**Goal:** Make visualization a first-class tool the agent calls
deliberately, and connect chart interactions to story continuation.

### What It Delivers to the Story

After Phase 3, the story has a richer feedback loop:

1. The agent calls `visualize_data` instead of `execute_sql` when it
   plans to visualize. This makes the intent explicit in the trace.
2. The tool returns data + chart spec + auto-generated insight, all in
   one structured response.
3. When the analyst clicks a bar or data point in a chart, the click
   generates a contextual follow-up prompt (e.g., "Drill into APAC
   revenue — explain the top drivers") that appears as a next-move
   suggestion or populates the input box.
4. Hovering a chart element highlights the corresponding row in the
   data table in the inspect panel — linking visual evidence to raw
   evidence.

The improvement spans the entire story arc: the **plan** mentions
visualization intent, the **evidence** is richer, the **conclusion**
references specific chart elements, and the **next moves** emerge from
chart interaction.

### The `visualize_data` Tool

A new backend tool in `databricks_openai.py`:

```python
@function_tool
async def visualize_data(
    sql_query: str,
    chart_type: str = 'auto',
    x_field: str | None = None,
    y_fields: list[str] | None = None,
    color_field: str | None = None,
    title: str | None = None,
    insight: str | None = None,
    warehouse_id: str | None = None,
) -> str:
    """Execute SQL and return results with a chart specification.

    Use this instead of execute_sql when the result should be visualized
    as a chart. The frontend renders the chart inline in the analysis
    story. Provide chart_type, x_field, and y_fields to control the
    visualization. Set chart_type='auto' to let the system detect the
    best chart type from the data.
    """
    rows = await _execute_sql(sql_query, warehouse_id=warehouse_id, ...)
    spec = _build_chart_spec(rows, chart_type, x_field, y_fields, ...)
    return json.dumps({
        'data': rows,
        'chart_spec': spec,
        '__visualization__': True,
    })
```

The `tool_result` handler in `storyEventsFromStreamEvent()` checks for
`__visualization__: true` and sets `type: 'chart'` on the evidence block.

### Chart → Story Continuation

When a user clicks a chart element, the app generates a contextual
follow-up:

```typescript
function onChartClick(
  dataPoint: Record<string, unknown>,
  spec: ChartSpec,
  story: AnalysisStory
) {
  const category = dataPoint[spec.xField];
  const values = spec.yFields.map((f) => `${f}=${dataPoint[f]}`).join(', ');
  const prompt = `Drill into ${category} (${values}) — ` +
    `explain the top drivers and any anomalies.`;
  // Populate the input box for user confirmation, then send as next move
}
```

This turns the chart into a **navigation surface** for the analysis
story. Instead of the analyst typing a follow-up question, they click
the segment they care about and the system proposes the question.

The click does NOT auto-invoke the agent. It populates the input box so
the analyst can review and refine the question before sending. This
preserves the analyst's agency.

### Linked Highlighting

When hovering a chart element, the inspect panel's evidence table
highlights the corresponding row. This requires a lightweight shared
selection context:

```typescript
// Shared between EvidenceChart and EvidenceContent via React context
interface EvidenceSelectionContext {
  hoveredRowIndex: number | null;
  setHoveredRowIndex: (index: number | null) => void;
}
```

### Updated System Prompt Guidance

The system prompt in Phase 3 adds tool-selection guidance:

```
### When to Use visualize_data vs execute_sql

| Situation | Tool |
|-----------|------|
| The user asked a question that benefits from visual comparison | `visualize_data` |
| The result will be used as a chart in the analysis story | `visualize_data` |
| The query is for metadata, schema, or configuration | `execute_sql` |
| The result is a single value or status check | `execute_sql` |
| You are writing data (INSERT, CREATE, GRANT) | `execute_sql` |
```

### Files Changed

| File | Change |
|------|--------|
| `server/services/tools/databricks_openai.py` | Add `visualize_data` function tool |
| `server/services/system_prompt.py` | Add tool-selection guidance |
| `client/src/features/analysis/storyTransforms.ts` | Handle `__visualization__` in tool results |
| `client/src/features/analysis/components/EvidenceChart.tsx` | Add click handler, hover events |
| `client/src/features/analysis/components/EvidenceContent.tsx` | Linked highlight via selection context |
| `client/src/features/analysis/components/RightInspectPanel.tsx` | Receive and display hover state |

---

## How Visualization Fits the Story Arc

The following table maps each stage of an analysis story to the
visualization capabilities added in each phase:

| Story Stage | Today | Phase 1 | Phase 2 | Phase 3 |
|-------------|-------|---------|---------|---------|
| **Question** | Text only | Unchanged | Unchanged | Unchanged |
| **Plan** | Agent states tool steps | Unchanged | Agent states "I'll visualize X" | Agent plans `visualize_data` call in trace |
| **Evidence** | Table / JSON / error | Auto-detected chart for SQL results | Model-guided chart with insight annotation | Dedicated viz tool with structured spec |
| **Conclusion** | Markdown text | Unchanged | References chart insights in prose | References interactive chart elements |
| **Next Moves** | Heuristic or model suggestions | Unchanged | Unchanged | Chart-click generates contextual next moves |
| **Inspect Panel** | Trace + evidence + context | Chart/table toggle in evidence | Insight annotation visible | Linked highlight between chart and table |

## Compatibility and Migration

- **Existing stories:** Unaffected. `chartSpec` is an optional field
  absent from all existing evidence blocks.
- **Phase transitions:** Each phase is additive. Phase 2 does not break
  Phase 1 heuristics — it overrides them when the model provides a spec.
  Phase 3 does not break Phase 2 — it adds a dedicated tool alongside
  the text-embedded spec path.
- **View toggle:** Always available. The analyst is never forced to view
  a chart; the table is one click away.
- **Error boundary:** If Recharts fails to render, the block silently
  falls back to the existing table view.

## Open Questions

1. **Maximum data points.** Should the chart renderer cap rows (e.g.,
   50 bars, 500 scatter points) to prevent slow rendering, or rely on
   the SQL query's LIMIT clause?

2. **Chart persistence.** Should `chartSpec` be persisted in
   `executions.events_json` so replayed stories show charts? (Likely
   yes — the spec is small and the replay path already re-processes
   stored events via `replayStoredEventsForStory`.)

3. **Insight quality.** In Phase 2, the model writes the `insight`
   annotation. Should the frontend validate it against the data (e.g.,
   check that claimed percentages match the actual values)?

4. **Chart-click safety.** In Phase 3, chart clicks populate the input
   box for user confirmation. Should there be an option for advanced
   users to auto-send without confirmation?

5. **Heatmap data shape.** The Phase 1 heuristic does not detect pivot-
   table-shaped data for heatmaps. Defer to Phase 2 where the model can
   explicitly request heatmap with the right column mapping.

## References

- Current analysis types: [`types.ts`](../../databricks-builder-app-oai/client/src/features/analysis/types.ts)
- Current evidence renderer: [`EvidenceContent.tsx`](../../databricks-builder-app-oai/client/src/features/analysis/components/EvidenceContent.tsx)
- Current story transforms: [`storyTransforms.ts`](../../databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts)
- Current system prompt: [`system_prompt.py`](../../databricks-builder-app-oai/server/services/system_prompt.py)
- Current Databricks tools: [`databricks_openai.py`](../../databricks-builder-app-oai/server/services/tools/databricks_openai.py)
- Recharts documentation: [recharts.org](https://recharts.org/)
