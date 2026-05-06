# Data Visualization in Analysis Stories

## Purpose

This document designs how `databricks-builder-app-oai` should integrate
data visualization into the existing analysis story pipeline. Today,
evidence blocks in a story can display text, tables, JSON, and errors.
The gap is **charts** — the `EvidenceType` already declares `'chart'` but
no rendering path exists. This design fills that gap so the agent can
produce visual evidence blocks that render inline within the analysis
story canvas.

## Current State

### Evidence Type System

```typescript
// features/analysis/types.ts
export type EvidenceType = 'text' | 'table' | 'chart' | 'tool_result' | 'error';
```

`'chart'` is declared but never produced by the transforms pipeline. The
`EvidenceContent` component (`features/analysis/components/EvidenceContent.tsx`)
does not handle evidence blocks with `type === 'chart'`. All tool results
currently flow through a single code path:

1. `storyEventsFromStreamEvent()` maps `tool_result` SSE events into
   `evidence.appended` analysis events.
2. `EvidenceContent` tries to parse JSON and render as a table if the
   data is row-oriented, or as pretty-printed JSON / Markdown otherwise.
3. The right inspect panel shows the same evidence blocks with collapsible
   tool input.

### Data Flow

```
Model → tool_result SSE event → storyEventsFromStreamEvent()
  → evidence.appended { type: 'tool_result' | 'error', rawContent }
  → EvidenceContent renders table / JSON / Markdown
```

### What Works Well

- The `asRowTable()` function in `EvidenceContent.tsx` already normalizes
  heterogeneous tabular JSON into `{ rows, columns }`.
- The `execute_sql` tool returns JSON arrays of row objects — the natural
  input for both tables and charts.
- The analysis story model (`AnalysisStory.evidence: EvidenceBlock[]`)
  is an ordered sequence that can interleave text, tables, and charts.
- The next-moves system can already detect metric contexts and suggest
  drill/compare/validate actions.

### What Is Missing

| Gap | Impact |
|-----|--------|
| No chart evidence detection | All numeric SQL results render as tables only |
| No chart rendering component | Even if detected, no React component can draw a chart |
| No chart spec in `EvidenceBlock` | The block has no field for chart type, axes, or config |
| No model-side guidance | The system prompt does not tell the agent how or when to request visualization |
| No interactivity | Tables and charts share no selection/highlight state |

## Design Principles

1. **Chart-as-evidence.** A chart is an evidence block, not a separate
   artifact. It lives in the story's `evidence[]` array alongside tables
   and text, preserving the narrative order.

2. **Data, not images.** Charts are rendered client-side from structured
   data, not from model-generated image URLs. This keeps the data
   auditable, downloadable, and interactive.

3. **Graceful degradation.** If chart rendering fails or the data shape
   is wrong, the evidence block falls back to the existing table view.
   No user-visible error; just a quieter visualization.

4. **Model-guided, rule-constrained.** The agent may suggest a chart type
   and column mapping, but the frontend validates the suggestion against
   the actual data shape before rendering.

5. **Incremental adoption.** The first version should work without any
   backend changes — chart detection and rendering are purely client-side
   transforms over existing `tool_result` evidence blocks.

## Chart Specification

### Extended `EvidenceBlock`

```typescript
export interface ChartSpec {
  /** Chart type. Start with a small set; expand later. */
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'heatmap';

  /** Column name or expression for the x-axis / category axis. */
  xField: string;

  /** One or more column names for y-axis / value series. */
  yFields: string[];

  /** Optional column for grouping / color encoding. */
  colorField?: string;

  /** Optional column for sizing (scatter, heatmap). */
  sizeField?: string;

  /** Axis labels. Defaults to column names. */
  xLabel?: string;
  yLabel?: string;

  /** Sort order for the category axis. */
  sort?: 'asc' | 'desc' | 'natural';

  /** Whether to stack bar/area series. */
  stacked?: boolean;

  /** Whether to show data labels on bars/points. */
  showLabels?: boolean;

  /** Optional title override. Defaults to evidence block title. */
  title?: string;
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

  // New — only present when type === 'chart'
  chartSpec?: ChartSpec;
}
```

### Why This Shape

- **Declarative.** The chart spec describes what to show, not how to draw
  it. The rendering library interprets the spec.
- **Column-oriented.** The spec references column names from the tabular
  data in `rawContent`, so the same `asRowTable()` parser feeds both
  table and chart views.
- **Extensible.** New chart types can be added without breaking existing
  blocks. Unknown `chartType` values fall back to table.

## Detection Strategy

### Phase 1: Client-Side Heuristic Detection

The first phase does not require backend changes. Detection runs in
`storyTransforms.ts` or a new `chartDetection.ts` module.

```typescript
function detectChartSpec(
  toolName: string | undefined,
  rawContent: string,
  tabular: RowOriented | null
): ChartSpec | null {
  // Only attempt on SQL tool results with tabular data
  if (!tabular || tabular.rows.length < 2) return null;
  if (toolName !== 'execute_sql' && toolName !== 'execute_sql_multi') return null;

  const { columns, rows } = tabular;

  // Classify columns
  const numericCols = columns.filter((c) =>
    rows.every((r) => r[c] == null || typeof r[c] === 'number' || !isNaN(Number(r[c])))
  );
  const categoryCols = columns.filter((c) => !numericCols.includes(c));

  // No numeric columns → not chartable
  if (numericCols.length === 0) return null;

  // Time series detection: a date/time-like category column + 1+ numeric
  const timeCols = categoryCols.filter(isLikelyDateColumn);
  if (timeCols.length > 0 && numericCols.length >= 1) {
    return {
      chartType: numericCols.length > 1 ? 'area' : 'line',
      xField: timeCols[0],
      yFields: numericCols.slice(0, 4),
      sort: 'asc',
    };
  }

  // Categorical bar: 1 category column + 1-3 numeric columns, ≤ 30 rows
  if (categoryCols.length >= 1 && numericCols.length >= 1 && rows.length <= 30) {
    return {
      chartType: 'bar',
      xField: categoryCols[0],
      yFields: numericCols.slice(0, 3),
      sort: rows.length > 10 ? 'desc' : 'natural',
    };
  }

  // Scatter: 2+ numeric columns, no clear category
  if (categoryCols.length === 0 && numericCols.length >= 2) {
    return {
      chartType: 'scatter',
      xField: numericCols[0],
      yFields: [numericCols[1]],
      sizeField: numericCols[2],
    };
  }

  // Pie: 1 category + 1 numeric, ≤ 8 rows
  if (categoryCols.length === 1 && numericCols.length === 1 && rows.length <= 8) {
    return {
      chartType: 'pie',
      xField: categoryCols[0],
      yFields: [numericCols[0]],
    };
  }

  return null;
}

function isLikelyDateColumn(col: string): boolean {
  const lowered = col.toLowerCase();
  return (
    lowered.includes('date') ||
    lowered.includes('time') ||
    lowered.includes('month') ||
    lowered.includes('year') ||
    lowered.includes('quarter') ||
    lowered.includes('week') ||
    lowered.includes('day') ||
    lowered.includes('period') ||
    lowered.endsWith('_at') ||
    lowered.endsWith('_ts')
  );
}
```

### Phase 2: Model-Guided Chart Spec

In a later phase, the agent can emit chart specs directly. This requires
a system prompt addition and a new structured output convention.

**System prompt addition:**

```
## Data Visualization

When you execute SQL and the result is best understood visually, include
a `__chart_spec__` key in your next text response with a JSON object:

{
  "chartType": "bar",
  "xField": "region",
  "yFields": ["total_revenue", "order_count"],
  "sort": "desc",
  "title": "Revenue by Region"
}

Supported chart types: bar, line, area, pie, scatter, heatmap.
Only include __chart_spec__ when the data clearly benefits from
visualization. Do not include it for metadata queries, schema
inspections, or results with fewer than 2 rows.
```

The frontend would parse `__chart_spec__` from the conclusion text,
extract the JSON, attach it to the preceding SQL tool result evidence
block, and remove the raw spec from the rendered text.

### Phase 3: Dedicated Visualization Tool

The most powerful option: a backend tool that combines `execute_sql` with
chart generation.

```python
@function_tool
async def visualize_data(
    sql_query: str,
    chart_type: str = 'auto',
    x_field: str | None = None,
    y_fields: list[str] | None = None,
    color_field: str | None = None,
    title: str | None = None,
    warehouse_id: str | None = None,
) -> str:
    """Execute SQL and return results with a chart specification."""
    rows = await _execute_sql(...)
    spec = _build_chart_spec(rows, chart_type, x_field, y_fields, ...)
    return json.dumps({
        'data': rows,
        'chart_spec': spec,
        '__visualization__': True,
    })
```

The `tool_result` handler in `storyEventsFromStreamEvent()` would check
for `__visualization__: true` in the parsed result and set
`type: 'chart'` on the evidence block.

## Rendering

### Library Choice: Recharts

Recharts is the recommended rendering library for Phase 1:

| Factor | Recharts | D3 | Observable Plot | ECharts |
|--------|----------|----|-----------------|---------|
| React native | ✅ | ❌ | ❌ | ❌ |
| Bundle size | ~150 KB | ~70 KB | ~100 KB | ~800 KB |
| Learning curve | Low | High | Medium | Medium |
| Declarative | ✅ | ❌ | ✅ | ✅ |
| Responsive | Built-in | Manual | Manual | Built-in |
| TypeScript | ✅ | ✅ | ✅ | ✅ |
| Dark mode | CSS vars | Manual | CSS | Theme |
| Active maintenance | ✅ | ✅ | ✅ | ✅ |

Recharts composes well with the existing React component model, supports
dark mode through CSS custom properties, and requires minimal wrapper
code for the chart types in scope.

### Chart Component

```
features/analysis/components/
  EvidenceContent.tsx          ← existing, add chart branch
  ChartEvidence.tsx            ← new, renders ChartSpec + tabular data
  chartTheme.ts                ← new, design token mapping
```

**`ChartEvidence.tsx`** — wraps Recharts components:

```tsx
import { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ChartSpec } from '@/features/analysis/types';
import { chartColors, chartTheme } from './chartTheme';

interface ChartEvidenceProps {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
  columns: string[];
}

export function ChartEvidence({ spec, rows, columns }: ChartEvidenceProps) {
  const data = useMemo(() => prepareData(spec, rows), [spec, rows]);

  const commonProps = {
    data,
    margin: { top: 8, right: 16, bottom: 24, left: 16 },
  };

  const chart = (() => {
    switch (spec.chartType) {
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={spec.xField} tick={chartTheme.axisTick} />
            <YAxis tick={chartTheme.axisTick} />
            <Tooltip contentStyle={chartTheme.tooltip} />
            <Legend />
            {spec.yFields.map((field, i) => (
              <Bar
                key={field}
                dataKey={field}
                fill={chartColors[i % chartColors.length]}
                stackId={spec.stacked ? 'stack' : undefined}
              />
            ))}
          </BarChart>
        );

      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey={spec.xField} tick={chartTheme.axisTick} />
            <YAxis tick={chartTheme.axisTick} />
            <Tooltip contentStyle={chartTheme.tooltip} />
            <Legend />
            {spec.yFields.map((field, i) => (
              <Line
                key={field}
                type="monotone"
                dataKey={field}
                stroke={chartColors[i % chartColors.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        );

      // ... area, pie, scatter, heatmap follow the same pattern

      default:
        return null; // fallback to table
    }
  })();

  if (!chart) return null;

  return (
    <div className="mt-2 w-full">
      {spec.title && (
        <div className="mb-2 text-xs font-semibold text-[var(--color-text-heading)]">
          {spec.title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={280}>
        {chart}
      </ResponsiveContainer>
    </div>
  );
}
```

**`chartTheme.ts`** — maps design tokens into Recharts props:

```typescript
export const chartColors = [
  'var(--color-accent-primary)',
  'var(--color-accent-secondary)',
  'var(--color-success)',
  'var(--color-warning)',
  '#a78bfa', // violet
  '#fb923c', // orange
  '#34d399', // emerald
  '#f87171', // rose
];

export const chartTheme = {
  axisTick: {
    fill: 'var(--color-text-muted)',
    fontSize: 11,
  },
  tooltip: {
    backgroundColor: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    color: 'var(--color-text-primary)',
    fontSize: '12px',
  },
};
```

### Integration into EvidenceContent

The existing `EvidenceContent` component gains one branch:

```tsx
// In EvidenceContent.tsx, after the tabular check
if (block.type === 'chart' && block.chartSpec && tabular) {
  return (
    <div className="mt-2">
      <ChartEvidence spec={block.chartSpec} rows={tabular.rows} columns={tabular.columns} />
      {/* Toggle to show underlying table */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-[var(--color-text-muted)]">
          Show data table
        </summary>
        {/* existing table rendering */}
      </details>
    </div>
  );
}
```

## Transform Pipeline Changes

### `storyTransforms.ts`

The `tool_result` handler in `storyEventsFromStreamEvent()` should try
chart detection before defaulting to `tool_result`:

```typescript
if (type === 'tool_result') {
  const rawContent = asText(event.content);
  const parsed = typeof event.content === 'string'
    ? tryParseJson(event.content)
    : event.content;
  const tabular = parsed ? asRowTable(parsed) : null;

  // Try chart detection
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : undefined;
  const chartSpec = detectChartSpec(toolName, rawContent, tabular);

  const evidenceType: EvidenceType = chartSpec
    ? 'chart'
    : isError ? 'error' : 'tool_result';

  return [{
    type: 'evidence.appended',
    storyId,
    block: {
      id: makeId('evidence-tool'),
      type: evidenceType,
      title: /* ... */,
      content: summary,
      rawContent,
      isError,
      createdAt: nowIso(),
      toolName,
      toolInput,
      chartSpec,     // new field
    },
  }];
}
```

### View Toggle

Each chart evidence block should allow toggling between chart and table
view. The toggle state is local to the component, not persisted.

```typescript
// In EvidenceContent or a wrapper
const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
```

## Interactivity

### Phase 1: Passive Charts

- Tooltip on hover showing exact values.
- Legend click to toggle series visibility.
- Responsive container fills available width.
- Download chart as PNG via a small toolbar button.
- Download data as CSV (existing behavior preserved).

### Phase 2: Selection → Next Moves

When a user clicks a bar, slice, or data point, the app can generate a
contextual next-move prompt:

```typescript
function onChartClick(dataPoint: Record<string, unknown>, spec: ChartSpec) {
  const category = dataPoint[spec.xField];
  const value = spec.yFields.map((f) => `${f}=${dataPoint[f]}`).join(', ');
  const prompt = `Drill into ${category} (${value}) — explain drivers and anomalies.`;
  // Dispatch as a next-move click
}
```

This connects chart interaction directly to the story-continuation flow,
making the chart a navigation surface rather than a static image.

### Phase 3: Linked Highlighting

When the user hovers a data point in a chart, highlight the corresponding
row in the table evidence block (if visible in the inspect panel). This
requires a shared selection context between `ChartEvidence` and
`EvidenceContent`.

## Backend Considerations

### No Backend Changes Required for Phase 1

Phase 1 is entirely client-side. The heuristic detection runs over
existing `tool_result` event payloads. No new tools, no schema changes,
no system prompt updates.

### Phase 2: System Prompt Update

Add a visualization guidance section to `system_prompt.py`:

```python
VISUALIZATION_GUIDANCE = """
## Data Visualization

When SQL results contain numeric data that benefits from visual comparison,
include a chart specification in your response. The frontend will render it
as an interactive chart alongside the data table.

To request a chart, include this JSON in your text response after the SQL
execution:

```json
{"__chart_spec__": {"chartType": "bar", "xField": "region", "yFields": ["revenue"], "sort": "desc"}}
```

Chart types: bar, line, area, pie, scatter, heatmap.
Only suggest charts for results with 2+ rows and at least one numeric column.
Do not suggest charts for metadata queries, DESCRIBE, SHOW, or schema inspection.
"""
```

### Phase 3: `visualize_data` Tool

Add a new tool to `databricks_openai.py` that wraps `execute_sql` and
returns data with a chart spec. The system prompt should guide the model
to use this tool instead of `execute_sql` when visualization is the goal.

## Dependency Impact

### New Dependencies

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `recharts` | ^2.15 | Chart rendering | ~150 KB gzipped |
| `recharts` peer: `react` | already present | — | — |

Install:

```bash
cd databricks-builder-app-oai/client
npm install recharts
```

No backend dependencies change in Phase 1.

### Build Impact

Recharts adds ~150 KB gzipped to the client bundle. This is acceptable
for a data-heavy analysis application. Tree-shaking removes unused chart
types if only a subset is imported.

## File Changes Summary

### Phase 1 (Client-Only)

| File | Change |
|------|--------|
| `client/src/features/analysis/types.ts` | Add `ChartSpec` interface, add `chartSpec?` to `EvidenceBlock` |
| `client/src/features/analysis/chartDetection.ts` | **NEW** — heuristic detection from tabular data |
| `client/src/features/analysis/storyTransforms.ts` | Import detection, apply in `storyEventsFromStreamEvent` |
| `client/src/features/analysis/components/ChartEvidence.tsx` | **NEW** — Recharts wrapper component |
| `client/src/features/analysis/components/chartTheme.ts` | **NEW** — design token mapping |
| `client/src/features/analysis/components/EvidenceContent.tsx` | Add `chart` branch before tabular fallback |
| `client/package.json` | Add `recharts` dependency |

### Phase 2 (System Prompt)

| File | Change |
|------|--------|
| `server/services/system_prompt.py` | Add visualization guidance section |
| `client/src/features/analysis/storyTransforms.ts` | Parse `__chart_spec__` from conclusion text |

### Phase 3 (Backend Tool)

| File | Change |
|------|--------|
| `server/services/tools/databricks_openai.py` | Add `visualize_data` function tool |
| `server/services/system_prompt.py` | Guide model to use `visualize_data` |

## Migration and Compatibility

- Existing stories and evidence blocks are unaffected. The `chartSpec`
  field is optional and absent on all existing blocks.
- Chart detection is opt-in — it only fires for SQL tool results with
  numeric tabular data. Non-SQL evidence and metadata results are
  unchanged.
- The view toggle defaults to `'chart'` when a spec is present, but users
  can always switch to table view.
- If Recharts fails to render (bad data, missing columns), the component
  catches the error and falls back to the existing table rendering
  without user-visible breakage.

## Open Questions

1. **Chart export format.** Should chart PNG export use `html2canvas` or
   Recharts' built-in SVG serialization? SVG is sharper but may not
   include the tooltip state.

2. **Maximum data points.** Should the chart renderer limit rows to
   prevent performance issues (e.g., 500 points for scatter, 50 bars)?
   Or should it rely on the SQL query to limit results?

3. **Heatmap data shape.** The heuristic detector does not yet handle
   pivot-table-shaped data for heatmaps. Should this be deferred to
   Phase 2 where the model can explicitly request heatmap?

4. **Chart persistence.** Currently, chart specs live only in the
   client-side story state derived from SSE events. Should `chartSpec`
   be persisted in `executions.events_json` so replayed stories show
   charts? (Likely yes — the spec is small and the replay path already
   re-processes stored events.)

5. **Next-move integration depth.** Should chart clicks produce
   immediate agent invocations, or populate the input box for user
   review before sending? The "populate and let user confirm" pattern is
   safer for the first version.

## Implementation Phases

### Phase 1: Client-Side Chart Rendering (Recommended First)

- Add `recharts` dependency.
- Implement `ChartSpec` type and `chartDetection.ts`.
- Build `ChartEvidence.tsx` and `chartTheme.ts`.
- Wire detection into `storyTransforms.ts`.
- Add chart branch to `EvidenceContent.tsx`.
- Add chart/table view toggle.
- Test with representative SQL results.

Estimated scope: ~6 files, ~600 lines.

### Phase 2: Model-Guided Specs

- Add visualization guidance to system prompt.
- Parse `__chart_spec__` from conclusion text.
- Allow model to override heuristic detection.

### Phase 3: Visualization Tool + Interactivity

- Add `visualize_data` backend tool.
- Implement chart click → next-move integration.
- Add linked highlighting between chart and table.

## References

- Current analysis types: [`types.ts`](../../databricks-builder-app-oai/client/src/features/analysis/types.ts)
- Current evidence renderer: [`EvidenceContent.tsx`](../../databricks-builder-app-oai/client/src/features/analysis/components/EvidenceContent.tsx)
- Current story transforms: [`storyTransforms.ts`](../../databricks-builder-app-oai/client/src/features/analysis/storyTransforms.ts)
- Current system prompt: [`system_prompt.py`](../../databricks-builder-app-oai/server/services/system_prompt.py)
- Current Databricks tools: [`databricks_openai.py`](../../databricks-builder-app-oai/server/services/tools/databricks_openai.py)
- Recharts documentation: [recharts.org](https://recharts.org/)
