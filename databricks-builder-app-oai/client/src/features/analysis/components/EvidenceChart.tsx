import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart as RechartsAreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RechartsScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec } from '@/features/analysis/types';
import { cellToString, coerceNumber, type RowOriented } from '@/features/analysis/evidenceData';
import { cn } from '@/lib/utils';
import { CHART_SERIES_COLORS, chartTheme } from './chartTheme';

const CHART_HEIGHT = 230;
const BAR_ROW_HEIGHT = 28;
const MAX_BAR_HEIGHT = 520;

type EvidenceChartProps = {
  tabular: RowOriented;
  spec: ChartSpec;
  activeRowIndex?: number | null;
  selectedRowIndex?: number | null;
  onActiveRowChange?: (rowIndex: number | null) => void;
  onSelectRow?: (rowIndex: number) => void;
};

type SeriesMark = 'bar' | 'line' | 'area' | 'point' | 'slice';

type SeriesConfig = {
  key: string;
  field: string;
  sourceField?: string;
  categoryLabel?: string;
  color: string;
  mark: SeriesMark;
  role: 'value' | 'percent';
};

type ChartRow = {
  __rowIndex: number;
  __rowIndices?: number[];
  __seriesRowIndices?: Record<string, number>;
  __label: string;
  __axisValue: unknown;
  __raw: Record<string, unknown>;
  __isAggregated?: boolean;
  [key: string]: unknown;
};

type ComboChartData = {
  rows: ChartRow[];
  series: SeriesConfig[];
};

type PieEntry = {
  __rowIndex: number;
  __raw: Record<string, unknown>;
  name: string;
  value: number;
};

type TooltipPayloadItem = {
  color?: string;
  dataKey?: string;
  name?: string;
  payload?: ChartRow | PieEntry;
  value?: unknown;
};

function seriesKey(index: number): string {
  return `series_${index}`;
}

function comboSeriesKey(metricIndex: number, categoryIndex: number): string {
  return `combo_${metricIndex}_${categoryIndex}`;
}

export function EvidenceChart({
  tabular,
  spec,
  activeRowIndex = null,
  selectedRowIndex = null,
  onActiveRowChange,
  onSelectRow,
}: EvidenceChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  const rows = useMemo(() => toChartRows(tabular, spec, spec.chartType === 'bar' ? 30 : 120), [spec, tabular]);
  const categoryData = useMemo(() => toCategoryChartData(tabular, spec, 120), [spec, tabular]);
  const comboData = useMemo(() => toComboData(tabular, spec, 120), [spec, tabular]);
  const baseSeries = useMemo(() => spec.yFields.map((field, index) => ({
    key: seriesKey(index),
    field,
    sourceField: field,
    color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
    mark: chartTypeToSeriesMark(spec.chartType),
    role: inferMetricRole(field, tabular),
  })), [spec.chartType, spec.yFields, tabular]);
  const shouldUseCombo = (spec.chartType === 'line' || spec.chartType === 'area' || spec.chartType === 'bar')
    && hasMixedMetricRoles(comboData.series)
    && comboData.rows.length >= 2;
  const shouldUseCategoryBreakdown = !shouldUseCombo
    && categoryData.rows.length >= 2
    && categoryData.series.length > baseSeries.length;
  const chartRows = shouldUseCategoryBreakdown ? categoryData.rows : rows;
  const legendSeries = shouldUseCombo
    ? comboData.series
    : shouldUseCategoryBreakdown
      ? categoryData.series
      : baseSeries;
  const visibleSeries = legendSeries.filter((item) => !hiddenSeries.includes(item.key));

  const toggleSeries = (key: string): void => {
    setHiddenSeries((current) => {
      const liveKeys = new Set(legendSeries.map((item) => item.key));
      const currentLive = current.filter((item) => liveKeys.has(item));
      if (currentLive.includes(key)) return currentLive.filter((item) => item !== key);
      if (legendSeries.length - currentLive.length <= 1) return currentLive;
      return [...currentLive, key];
    });
  };

  const setActiveFromPayload = (payload: TooltipPayloadItem | undefined): void => {
    const rowIndex = getPayloadRowIndex(payload?.payload, payload?.dataKey);
    onActiveRowChange?.(rowIndex);
  };

  const selectFromPayload = (payload: TooltipPayloadItem | undefined): void => {
    const rowIndex = getPayloadRowIndex(payload?.payload, payload?.dataKey);
    if (rowIndex !== null) onSelectRow?.(rowIndex);
  };

  const handleChartMove = (state: any): void => {
    setActiveFromPayload(getPrimaryTooltipPayload(state?.activePayload));
  };

  const handleChartClick = (state: any): void => {
    selectFromPayload(getPrimaryTooltipPayload(state?.activePayload));
  };

  const clearActive = (): void => onActiveRowChange?.(null);

  const content = useMemo(() => {
    if (spec.chartType === 'pie') {
      return (
        <PieEvidenceChart
          tabular={tabular}
          spec={spec}
          activeRowIndex={activeRowIndex}
          selectedRowIndex={selectedRowIndex}
          onActiveRowChange={onActiveRowChange}
          onSelectRow={onSelectRow}
        />
      );
    }
    if (shouldUseCombo) {
      return (
        <ComboEvidenceChart
          rows={comboData.rows}
          spec={spec}
          series={visibleSeries}
          activeRowIndex={activeRowIndex}
          selectedRowIndex={selectedRowIndex}
          onChartMove={handleChartMove}
          onChartClick={handleChartClick}
          onChartLeave={clearActive}
        />
      );
    }
    if (spec.chartType === 'line' || spec.chartType === 'area') {
      return (
        <LineEvidenceChart
          rows={chartRows}
          spec={spec}
          series={visibleSeries}
          activeRowIndex={activeRowIndex}
          selectedRowIndex={selectedRowIndex}
          onChartMove={handleChartMove}
          onChartClick={handleChartClick}
          onChartLeave={clearActive}
        />
      );
    }
    if (spec.chartType === 'scatter') {
      return (
        <ScatterEvidenceChart
          tabular={tabular}
          spec={spec}
          activeRowIndex={activeRowIndex}
          selectedRowIndex={selectedRowIndex}
          onChartMove={handleChartMove}
          onChartClick={handleChartClick}
          onChartLeave={clearActive}
        />
      );
    }
    return (
      <BarEvidenceChart
        rows={chartRows}
        spec={spec}
        series={visibleSeries}
        activeRowIndex={activeRowIndex}
        selectedRowIndex={selectedRowIndex}
        onChartMove={handleChartMove}
        onChartClick={handleChartClick}
        onChartLeave={clearActive}
      />
    );
  }, [
    activeRowIndex,
    clearActive,
    chartRows,
    comboData.rows,
    handleChartClick,
    handleChartMove,
    onActiveRowChange,
    onSelectRow,
    selectedRowIndex,
    spec,
    shouldUseCombo,
    tabular,
    visibleSeries,
  ]);

  if (!content) return null;

  return (
    <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2">
      {(spec.title || spec.insight) && (
        <div className="mb-2">
          {spec.title && (
            <div className="text-[11px] font-semibold text-[var(--color-text-heading)]">
              {spec.title}
            </div>
          )}
          {spec.insight && (
            <div className="text-[10px] text-[var(--color-text-muted)]">
              {spec.insight}
            </div>
          )}
        </div>
      )}
      {content}
      {legendSeries.length > 1 && (
        <SeriesLegend series={legendSeries} hiddenSeries={hiddenSeries} onToggle={toggleSeries} />
      )}
    </div>
  );
}

function BarEvidenceChart({
  rows,
  spec,
  series,
  activeRowIndex,
  selectedRowIndex,
  onChartMove,
  onChartClick,
  onChartLeave,
}: {
  rows: ChartRow[];
  spec: ChartSpec;
  series: SeriesConfig[];
  activeRowIndex: number | null;
  selectedRowIndex: number | null;
  onChartMove: (state: any) => void;
  onChartClick: (state: any) => void;
  onChartLeave: () => void;
}) {
  if (rows.length === 0 || series.length === 0) return null;
  const height = Math.min(MAX_BAR_HEIGHT, Math.max(CHART_HEIGHT, rows.length * BAR_ROW_HEIGHT + 70));

  return (
    <div className="h-full min-h-[220px]">
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart
          data={rows}
          layout="vertical"
          margin={{ top: 8, right: 18, left: 8, bottom: 28 }}
          onMouseMove={onChartMove}
          onClick={onChartClick}
          onMouseLeave={onChartLeave}
        >
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" horizontal={false} opacity={0.45} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={formatNumber}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={{ stroke: chartTheme.grid }}
            label={{
              value: spec.xLabel || series.map((item) => item.field).join(', '),
              position: 'insideBottom',
              offset: -20,
              fontSize: 10,
              fill: chartTheme.axis,
            }}
          />
          <YAxis
            type="category"
            dataKey="__label"
            width={getCategoryAxisWidth(rows)}
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={truncateTick}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip spec={spec} series={series} />} cursor={{ fill: 'var(--color-bg-secondary)', opacity: 0.45 }} />
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.field}
              fill={item.color}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell
                  key={`${item.key}-${row.__rowIndex}`}
                  fill={item.color}
                  opacity={markOpacity(row.__rowIndex, activeRowIndex, selectedRowIndex)}
                  stroke={row.__rowIndex === selectedRowIndex ? chartTheme.activeStroke : undefined}
                  strokeWidth={row.__rowIndex === selectedRowIndex ? 1.5 : 0}
                />
              ))}
            </Bar>
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LineEvidenceChart({
  rows,
  spec,
  series,
  activeRowIndex,
  selectedRowIndex,
  onChartMove,
  onChartClick,
  onChartLeave,
}: {
  rows: ChartRow[];
  spec: ChartSpec;
  series: SeriesConfig[];
  activeRowIndex: number | null;
  selectedRowIndex: number | null;
  onChartMove: (state: any) => void;
  onChartClick: (state: any) => void;
  onChartLeave: () => void;
}) {
  if (rows.length < 2 || series.length === 0) return null;
  const Chart = spec.chartType === 'area' ? RechartsAreaChart : RechartsLineChart;
  const isArea = spec.chartType === 'area';

  return (
    <div className="h-[230px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <Chart
          data={rows}
          margin={{ top: 10, right: 18, left: 0, bottom: 28 }}
          onMouseMove={onChartMove}
          onClick={onChartClick}
          onMouseLeave={onChartLeave}
        >
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" opacity={0.45} />
          <XAxis
            dataKey="__label"
            minTickGap={22}
            interval="preserveStartEnd"
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={truncateTick}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={{ stroke: chartTheme.grid }}
            label={{
              value: spec.xLabel || spec.xField,
              position: 'insideBottom',
              offset: -20,
              fontSize: 10,
              fill: chartTheme.axis,
            }}
          />
          <YAxis
            width={56}
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={formatNumber}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={{ stroke: chartTheme.grid }}
          />
          <Tooltip content={<ChartTooltip spec={spec} series={series} />} />
          {series.map((item) => (
            isArea ? (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.field}
                stroke={item.color}
                fill={item.color}
                fillOpacity={0.14}
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props) => renderLineDot(props, item.color, activeRowIndex, selectedRowIndex, item.key)}
                activeDot={{ r: 4, strokeWidth: 1.5, stroke: chartTheme.activeStroke }}
                stackId={spec.stacked ? 'stack' : undefined}
              />
            ) : (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.field}
                stroke={item.color}
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props) => renderLineDot(props, item.color, activeRowIndex, selectedRowIndex, item.key)}
                activeDot={{ r: 4, strokeWidth: 1.5, stroke: chartTheme.activeStroke }}
                connectNulls={false}
              />
            )
          ))}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

function ComboEvidenceChart({
  rows,
  spec,
  series,
  activeRowIndex,
  selectedRowIndex,
  onChartMove,
  onChartClick,
  onChartLeave,
}: {
  rows: ChartRow[];
  spec: ChartSpec;
  series: SeriesConfig[];
  activeRowIndex: number | null;
  selectedRowIndex: number | null;
  onChartMove: (state: any) => void;
  onChartClick: (state: any) => void;
  onChartLeave: () => void;
}) {
  const valueSeries = series.filter((item) => item.role === 'value');
  const percentSeries = series.filter((item) => item.role === 'percent');
  if (rows.length < 2 || series.length === 0) return null;

  return (
    <div className="h-[260px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 10, right: 12, left: 0, bottom: 28 }}
          onMouseMove={onChartMove}
          onClick={onChartClick}
          onMouseLeave={onChartLeave}
        >
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" opacity={0.45} />
          <XAxis
            dataKey="__label"
            minTickGap={22}
            interval="preserveStartEnd"
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={truncateTick}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={{ stroke: chartTheme.grid }}
            label={{
              value: spec.xLabel || spec.xField,
              position: 'insideBottom',
              offset: -20,
              fontSize: 10,
              fill: chartTheme.axis,
            }}
          />
          {valueSeries.length > 0 && (
            <YAxis
              yAxisId="value"
              width={56}
              tick={{ fontSize: 10, fill: chartTheme.axis }}
              tickFormatter={formatNumber}
              axisLine={{ stroke: chartTheme.grid }}
              tickLine={{ stroke: chartTheme.grid }}
              label={{
                value: seriesAxisLabel(valueSeries),
                angle: -90,
                position: 'insideLeft',
                style: { fill: chartTheme.axis, fontSize: 10 },
              }}
            />
          )}
          {percentSeries.length > 0 && (
            <YAxis
              yAxisId="percent"
              orientation="right"
              width={54}
              tick={{ fontSize: 10, fill: chartTheme.axis }}
              tickFormatter={(value) => `${formatNumber(value)}%`}
              axisLine={{ stroke: chartTheme.grid }}
              tickLine={{ stroke: chartTheme.grid }}
              domain={[0, 'auto']}
              label={{
                value: seriesAxisLabel(percentSeries),
                angle: 90,
                position: 'insideRight',
                style: { fill: chartTheme.axis, fontSize: 10 },
              }}
            />
          )}
          <Tooltip content={<ChartTooltip spec={spec} series={series} />} />
          {valueSeries.map((item) => (
            <Bar
              key={item.key}
              yAxisId="value"
              dataKey={item.key}
              name={item.field}
              fill={item.color}
              radius={[3, 3, 0, 0]}
              maxBarSize={34}
              isAnimationActive={false}
            >
              {rows.map((row) => {
                const rowIndex = getSeriesRowIndex(row, item.key);
                return (
                  <Cell
                    key={`${item.key}-${row.__label}`}
                    fill={item.color}
                    opacity={markOpacity(rowIndex, activeRowIndex, selectedRowIndex)}
                    stroke={rowIndex === selectedRowIndex ? chartTheme.activeStroke : undefined}
                    strokeWidth={rowIndex === selectedRowIndex ? 1.5 : 0}
                  />
                );
              })}
            </Bar>
          ))}
          {percentSeries.map((item) => (
            <Line
              key={item.key}
              yAxisId="percent"
              type="monotone"
              dataKey={item.key}
              name={item.field}
              stroke={item.color}
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props) => renderLineDot(props, item.color, activeRowIndex, selectedRowIndex, item.key)}
              activeDot={{ r: 4, strokeWidth: 1.5, stroke: chartTheme.activeStroke }}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScatterEvidenceChart({
  tabular,
  spec,
  activeRowIndex,
  selectedRowIndex,
  onChartMove,
  onChartClick,
  onChartLeave,
}: {
  tabular: RowOriented;
  spec: ChartSpec;
  activeRowIndex: number | null;
  selectedRowIndex: number | null;
  onChartMove: (state: any) => void;
  onChartClick: (state: any) => void;
  onChartLeave: () => void;
}) {
  const points = useMemo(() => toScatterRows(tabular, spec, 300), [spec, tabular]);
  if (points.length < 2) return null;
  const yField = spec.yFields[0];
  const series = [{
    key: '__y',
    field: yField,
    sourceField: yField,
    color: CHART_SERIES_COLORS[0],
    mark: 'point' as const,
    role: inferMetricRole(yField, tabular),
  }];

  return (
    <div className="h-[230px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsScatterChart
          margin={{ top: 10, right: 18, left: 0, bottom: 28 }}
          onMouseMove={onChartMove}
          onClick={onChartClick}
          onMouseLeave={onChartLeave}
        >
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" opacity={0.45} />
          <XAxis
            type="number"
            dataKey="__x"
            name={spec.xLabel || spec.xField}
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={formatNumber}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={{ stroke: chartTheme.grid }}
            label={{
              value: spec.xLabel || spec.xField,
              position: 'insideBottom',
              offset: -20,
              fontSize: 10,
              fill: chartTheme.axis,
            }}
          />
          <YAxis
            type="number"
            dataKey="__y"
            name={spec.yLabel || yField}
            width={56}
            tick={{ fontSize: 10, fill: chartTheme.axis }}
            tickFormatter={formatNumber}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={{ stroke: chartTheme.grid }}
          />
          <Tooltip content={<ChartTooltip spec={spec} series={series} />} />
          <Scatter
            data={points}
            name={`${yField} vs ${spec.xField}`}
            fill={CHART_SERIES_COLORS[0]}
            isAnimationActive={false}
            shape={(props: any) => renderScatterPoint(props, activeRowIndex, selectedRowIndex)}
          />
        </RechartsScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieEvidenceChart({
  tabular,
  spec,
  activeRowIndex = null,
  selectedRowIndex = null,
  onActiveRowChange,
  onSelectRow,
}: EvidenceChartProps) {
  const entries = useMemo(() => toPieEntries(tabular, spec, 12), [spec, tabular]);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (entries.length < 2 || total <= 0) return null;
  const series = [{
    key: 'value',
    field: spec.yFields[0],
    sourceField: spec.yFields[0],
    color: CHART_SERIES_COLORS[0],
    mark: 'slice' as const,
    role: inferMetricRole(spec.yFields[0], tabular),
  }];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="h-[220px] w-full min-w-0 sm:w-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsPieChart>
            <Tooltip content={<ChartTooltip spec={spec} series={series} />} />
            <Pie
              data={entries}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={82}
              innerRadius={0}
              isAnimationActive={false}
              onMouseEnter={(entry) => onActiveRowChange?.(getPayloadRowIndex(entry))}
              onMouseLeave={() => onActiveRowChange?.(null)}
              onClick={(entry) => {
                const rowIndex = getPayloadRowIndex(entry);
                if (rowIndex !== null) onSelectRow?.(rowIndex);
              }}
            >
              {entries.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]}
                  opacity={markOpacity(entry.__rowIndex, activeRowIndex, selectedRowIndex)}
                  stroke={entry.__rowIndex === selectedRowIndex ? chartTheme.activeStroke : '#fff'}
                  strokeWidth={entry.__rowIndex === selectedRowIndex ? 2 : 1}
                />
              ))}
            </Pie>
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-[10px] text-[var(--color-text-muted)]">
        {entries.map((entry, index) => (
          <button
            type="button"
            key={entry.name}
            onMouseEnter={() => onActiveRowChange?.(entry.__rowIndex)}
            onMouseLeave={() => onActiveRowChange?.(null)}
            onClick={() => onSelectRow?.(entry.__rowIndex)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-[var(--color-bg-secondary)]',
              selectedRowIndex === entry.__rowIndex && 'bg-[var(--color-bg-secondary)] text-[var(--color-text-heading)]'
            )}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] }}
            />
            <span className="truncate" title={entry.name}>{entry.name}</span>
            <span className="ml-auto tabular-nums">
              {((entry.value / total) * 100).toFixed(1)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  spec,
  series,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  spec?: ChartSpec;
  series?: SeriesConfig[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  const title = getTooltipTitle(row, label, spec);
  const items = getTooltipItems(payload, row, spec, series);

  return (
    <div
      className="max-w-[240px] rounded-md border px-2 py-1.5 text-[11px] shadow-lg"
      style={{
        backgroundColor: chartTheme.tooltipBackground,
        borderColor: chartTheme.tooltipBorder,
        color: chartTheme.tooltipText,
      }}
    >
      {title && <div className="mb-1 font-medium text-[var(--color-text-heading)]">{title}</div>}
      <div className="space-y-0.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <SeriesMarker color={item.color} mark={item.mark} />
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-muted)]">{item.label}</span>
            <span className="font-mono tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeriesLegend({
  series,
  hiddenSeries,
  onToggle,
}: {
  series: SeriesConfig[];
  hiddenSeries: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--color-text-muted)]">
      {series.map((item) => {
        const hidden = hiddenSeries.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            className={cn(
              'inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 transition-colors',
              hidden
                ? 'opacity-45 hover:border-[var(--color-border)]'
                : 'hover:border-[var(--color-accent-primary)]/40 hover:text-[var(--color-accent-primary)]'
            )}
            aria-pressed={!hidden}
            title={`${hidden ? 'Show' : 'Hide'} ${item.field}`}
          >
            <SeriesMarker color={item.color} mark={item.mark} />
            {item.field}
          </button>
        );
      })}
    </div>
  );
}

function SeriesMarker({ color, mark }: { color: string; mark: SeriesMark }) {
  if (mark === 'bar' || mark === 'area') {
    return (
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color, opacity: mark === 'area' ? 0.65 : 1 }}
      />
    );
  }

  if (mark === 'line') {
    return (
      <span className="relative inline-flex h-3 w-4 shrink-0 items-center" aria-hidden="true">
        <span className="h-[2px] w-full rounded-full" style={{ backgroundColor: color }} />
        <span
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-background)]"
          style={{ backgroundColor: color }}
        />
      </span>
    );
  }

  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function seriesAxisLabel(series: SeriesConfig[]): string {
  return Array.from(new Set(series.map((item) => item.sourceField ?? item.field))).join(', ');
}

function chartTypeToSeriesMark(chartType: ChartSpec['chartType']): SeriesMark {
  if (chartType === 'bar') return 'bar';
  if (chartType === 'line') return 'line';
  if (chartType === 'area') return 'area';
  if (chartType === 'scatter') return 'point';
  if (chartType === 'pie') return 'slice';
  return 'point';
}

function toChartRows(tabular: RowOriented, spec: ChartSpec, limit: number): ChartRow[] {
  const rows = tabular.rows
    .map((row, rowIndex) => {
      const values = spec.yFields.map((field) => coerceNumber(row[field]));
      if (values.every((value) => value === undefined)) return null;
      const chartRow: ChartRow = {
        __rowIndex: rowIndex,
        __label: cellToString(row[spec.xField]) || '(empty)',
        __axisValue: row[spec.xField],
        __raw: row,
      };
      values.forEach((value, index) => {
        chartRow[seriesKey(index)] = value ?? null;
      });
      return chartRow;
    })
    .filter((row): row is ChartRow => row !== null);

  sortChartRows(rows, spec);
  return rows.slice(0, limit);
}

function toComboData(tabular: RowOriented, spec: ChartSpec, limit: number): ComboChartData {
  if (spec.colorField && tabular.columns.includes(spec.colorField)) {
    const categoryData = toCategoryComboData(tabular, spec, spec.colorField, limit, 'metricRole');
    if (categoryData.rows.length > 0 && categoryData.series.length > 0) return categoryData;
  }

  return toAggregatedComboData(tabular, spec, limit);
}

function toCategoryChartData(tabular: RowOriented, spec: ChartSpec, limit: number): ComboChartData {
  if (!spec.colorField || !tabular.columns.includes(spec.colorField)) return { rows: [], series: [] };
  return toCategoryComboData(tabular, spec, spec.colorField, limit, 'chartType');
}

function toCategoryComboData(
  tabular: RowOriented,
  spec: ChartSpec,
  colorField: string,
  limit: number,
  markMode: 'metricRole' | 'chartType'
): ComboChartData {
  // Keep the table grain visible: one x-axis bucket per period, one series per category.
  const categories: Array<{ key: string; label: string }> = [];
  const categoryIndexByKey = new Map<string, number>();
  const groups = new Map<string, {
    axisValue: unknown;
    label: string;
    entries: Array<{ row: Record<string, unknown>; rowIndex: number; categoryIndex: number }>;
  }>();

  tabular.rows.forEach((row, rowIndex) => {
    const categoryKey = cellToString(row[colorField]);
    let categoryIndex = categoryIndexByKey.get(categoryKey);
    if (categoryIndex === undefined) {
      categoryIndex = categories.length;
      categoryIndexByKey.set(categoryKey, categoryIndex);
      categories.push({ key: categoryKey, label: formatCategoryLabel(categoryKey) });
    }

    const label = cellToString(row[spec.xField]) || '(empty)';
    const group = groups.get(label) ?? { axisValue: row[spec.xField], label, entries: [] };
    group.entries.push({ row, rowIndex, categoryIndex });
    groups.set(label, group);
  });

  if (categories.length < 2) return { rows: [], series: [] };

  const series = spec.yFields.flatMap((field, metricIndex) => categories.map((category, categoryIndex) => {
    const role = inferMetricRole(field, tabular);
    return {
      key: comboSeriesKey(metricIndex, categoryIndex),
      field: `${field} · ${category.label}`,
      sourceField: field,
      categoryLabel: category.label,
      color: CHART_SERIES_COLORS[categoryIndex % CHART_SERIES_COLORS.length],
      mark: markMode === 'chartType'
        ? chartTypeToSeriesMark(spec.chartType)
        : role === 'percent' ? 'line' as const : 'bar' as const,
      role,
    };
  }));
  const weightField = spec.yFields.find((field) => inferMetricRole(field, tabular) === 'value');

  const rows: ChartRow[] = Array.from(groups.values()).map((group) => {
    const first = group.entries[0];
    const chartRow: ChartRow = {
      __rowIndex: first.rowIndex,
      __rowIndices: group.entries.map((entry) => entry.rowIndex),
      __seriesRowIndices: {},
      __label: group.label,
      __axisValue: group.axisValue,
      __raw: first.row,
      __isAggregated: group.entries.length > categories.length,
    };

    spec.yFields.forEach((field, metricIndex) => {
      categories.forEach((_category, categoryIndex) => {
        const entries = group.entries.filter((entry) => entry.categoryIndex === categoryIndex);
        const key = comboSeriesKey(metricIndex, categoryIndex);
        chartRow[key] = aggregateMetricValue(entries, field, weightField, tabular);
        const firstEntryWithValue = entries.find((entry) => coerceNumber(entry.row[field]) !== undefined);
        if (firstEntryWithValue && chartRow.__seriesRowIndices) {
          chartRow.__seriesRowIndices[key] = firstEntryWithValue.rowIndex;
        }
      });
    });

    return chartRow;
  });

  rows.sort((a, b) => compareAxisValues(a.__axisValue, b.__axisValue));
  if (spec.sort === 'desc') rows.reverse();
  return { rows: rows.slice(0, limit), series };
}

function toAggregatedComboData(tabular: RowOriented, spec: ChartSpec, limit: number): ComboChartData {
  const groups = new Map<string, Array<{ row: Record<string, unknown>; rowIndex: number }>>();

  tabular.rows.forEach((row, rowIndex) => {
    const label = cellToString(row[spec.xField]) || '(empty)';
    const current = groups.get(label) ?? [];
    current.push({ row, rowIndex });
    groups.set(label, current);
  });

  const weightField = spec.yFields.find((field) => inferMetricRole(field, tabular) === 'value');
  const series = spec.yFields.map((field, index) => ({
    key: seriesKey(index),
    field,
    sourceField: field,
    color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
    mark: inferMetricRole(field, tabular) === 'percent' ? 'line' as const : 'bar' as const,
    role: inferMetricRole(field, tabular),
  }));
  const rows: ChartRow[] = Array.from(groups.entries()).map(([label, entries]) => {
    const first = entries[0];
    const chartRow: ChartRow = {
      __rowIndex: first.rowIndex,
      __rowIndices: entries.map((entry) => entry.rowIndex),
      __label: label,
      __axisValue: first.row[spec.xField],
      __raw: first.row,
      __isAggregated: entries.length > 1,
    };

    spec.yFields.forEach((field, index) => {
      chartRow[seriesKey(index)] = aggregateMetricValue(entries, field, weightField, tabular);
    });

    return chartRow;
  });

  rows.sort((a, b) => compareAxisValues(a.__axisValue, b.__axisValue));
  if (spec.sort === 'desc') rows.reverse();
  return { rows: rows.slice(0, limit), series };
}

function aggregateMetricValue(
  entries: Array<{ row: Record<string, unknown>; rowIndex: number }>,
  field: string,
  weightField: string | undefined,
  tabular: RowOriented
): number | null {
  const values: Array<{ value: number; weight?: number }> = entries
    .map((entry) => ({
      value: coerceNumber(entry.row[field]),
      weight: weightField ? coerceNumber(entry.row[weightField]) : undefined,
    }))
    .flatMap((entry) => (entry.value === undefined ? [] : [{ value: entry.value, weight: entry.weight }]));

  if (values.length === 0) return null;

  if (inferMetricRole(field, tabular) === 'percent') {
    const weightedTotal = values.reduce((sum, entry) => sum + entry.value * Math.max(entry.weight ?? 1, 0), 0);
    const weightTotal = values.reduce((sum, entry) => sum + Math.max(entry.weight ?? 1, 0), 0);
    return weightTotal > 0
      ? weightedTotal / weightTotal
      : values.reduce((sum, entry) => sum + entry.value, 0) / values.length;
  }

  return shouldAverageField(field)
    ? values.reduce((sum, entry) => sum + entry.value, 0) / values.length
    : values.reduce((sum, entry) => sum + entry.value, 0);
}

function toScatterRows(tabular: RowOriented, spec: ChartSpec, limit: number): ChartRow[] {
  const yField = spec.yFields[0];
  return tabular.rows
    .map<ChartRow | null>((row, rowIndex) => {
      const x = coerceNumber(row[spec.xField]);
      const y = coerceNumber(row[yField]);
      if (x === undefined || y === undefined) return null;
      return {
        __rowIndex: rowIndex,
        __label: cellToString(row[spec.xField]) || `Row ${rowIndex + 1}`,
        __axisValue: row[spec.xField],
        __raw: row,
        __x: x,
        __y: y,
        [seriesKey(0)]: y,
      };
    })
    .filter((row): row is ChartRow => row !== null)
    .slice(0, limit);
}

function toPieEntries(tabular: RowOriented, spec: ChartSpec, limit: number): PieEntry[] {
  const valueField = spec.yFields[0];
  return tabular.rows
    .map((row, rowIndex) => {
      const value = coerceNumber(row[valueField]);
      if (value === undefined || value < 0) return null;
      return {
        __rowIndex: rowIndex,
        __raw: row,
        name: cellToString(row[spec.xField]) || '(empty)',
        value,
      };
    })
    .filter((entry): entry is PieEntry => entry !== null)
    .slice(0, limit);
}

function sortChartRows(rows: ChartRow[], spec: ChartSpec): void {
  const sortMode = spec.sort || 'natural';
  if (sortMode === 'natural') return;

  if (spec.chartType === 'line' || spec.chartType === 'area') {
    rows.sort((a, b) => compareAxisValues(a.__axisValue, b.__axisValue));
    if (sortMode === 'desc') rows.reverse();
    return;
  }

  rows.sort((a, b) => {
    const av = Number(a[seriesKey(0)] ?? 0);
    const bv = Number(b[seriesKey(0)] ?? 0);
    return sortMode === 'asc' ? av - bv : bv - av;
  });
}

function compareAxisValues(a: unknown, b: unknown): number {
  const left = axisSortValue(a);
  const right = axisSortValue(b);
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function axisSortValue(value: unknown): number | string {
  const numeric = coerceNumber(value);
  if (numeric !== undefined) return numeric;
  const text = cellToString(value);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  return text;
}

function getPrimaryTooltipPayload(payload?: TooltipPayloadItem[]): TooltipPayloadItem | undefined {
  return payload?.find((item) => item.value !== undefined && item.value !== null) ?? payload?.[0];
}

function getSeriesRowIndex(row: ChartRow, key: string): number {
  return row.__seriesRowIndices?.[key] ?? row.__rowIndex;
}

function getPayloadRowIndex(payload: unknown, dataKey?: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof dataKey === 'string') {
    const seriesRowIndex = (payload as ChartRow).__seriesRowIndices?.[dataKey];
    if (typeof seriesRowIndex === 'number') return seriesRowIndex;
  }
  const rowIndex = (payload as { __rowIndex?: unknown }).__rowIndex;
  if (typeof rowIndex === 'number') return rowIndex;
  const nested = (payload as { payload?: unknown }).payload;
  if (!nested || typeof nested !== 'object') return null;
  if (typeof dataKey === 'string') {
    const nestedSeriesRowIndex = (nested as ChartRow).__seriesRowIndices?.[dataKey];
    if (typeof nestedSeriesRowIndex === 'number') return nestedSeriesRowIndex;
  }
  const nestedRowIndex = (nested as { __rowIndex?: unknown }).__rowIndex;
  return typeof nestedRowIndex === 'number' ? nestedRowIndex : null;
}

function getTooltipTitle(row: ChartRow | PieEntry | undefined, label?: string, spec?: ChartSpec): string {
  if (!row) return label || '';
  if (isPieEntry(row)) return row.name;
  const rawLabel = spec ? cellToString(row.__raw[spec.xField]) : row.__label;
  return rawLabel || row.__label || label || '';
}

function isPieEntry(row: ChartRow | PieEntry): row is PieEntry {
  return typeof (row as PieEntry).name === 'string' && typeof (row as PieEntry).value === 'number';
}

function getTooltipItems(
  payload: TooltipPayloadItem[],
  row: ChartRow | PieEntry | undefined,
  spec?: ChartSpec,
  series: SeriesConfig[] = []
): Array<{ label: string; value: string; color: string; mark: SeriesMark }> {
  if (row && isPieEntry(row)) {
    return [{
      label: spec?.yFields[0] || 'value',
      value: formatNumber(row.value),
      color: payload[0]?.color || CHART_SERIES_COLORS[0],
      mark: 'slice',
    }];
  }

  const raw = row && '__raw' in row ? row.__raw : undefined;
  const tooltipSeries: SeriesConfig[] = series.length > 0 ? series : payload.map((item, index) => {
    const field = String(item.name ?? item.dataKey ?? `Series ${index + 1}`);
    return {
      key: String(item.dataKey ?? index),
      field,
      sourceField: field,
      color: item.color || CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
      mark: 'point',
      role: inferMetricRole(field, undefined),
    };
  });

  return tooltipSeries.flatMap((item, index) => {
    const sourceField = item.sourceField ?? item.field;
    const hasRowValue = row && !isPieEntry(row) && hasOwnValue(row, item.key);
    const rowValue = hasRowValue && row && !isPieEntry(row) ? row[item.key] : undefined;
    const payloadValue = payload.find((entry) => entry.dataKey === item.key)?.value;
    const rawValue = hasRowValue ? rowValue : payloadValue ?? (raw ? raw[sourceField] : undefined);
    if (rawValue == null || rawValue === '') return [];
    const value = coerceNumber(rawValue);
    return [{
      label: item.field,
      value: value === undefined ? cellToString(rawValue) : formatMetricValue(value, sourceField),
      color: item.color || CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
      mark: item.mark,
    }];
  });
}

function hasOwnValue(row: ChartRow, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function hasMixedMetricRoles(series: SeriesConfig[]): boolean {
  return series.some((item) => item.role === 'value') && series.some((item) => item.role === 'percent');
}

function inferMetricRole(field: string, tabular?: RowOriented): 'value' | 'percent' {
  if (isPercentField(field)) return 'percent';
  if (!tabular) return 'value';
  const values = tabular.rows
    .map((row) => coerceNumber(row[field]))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return 'value';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min >= 0 && max <= 1 && /(rate|ratio|share)/i.test(field)) return 'percent';
  return 'value';
}

function isPercentField(field: string): boolean {
  return /(^|_)(pct|percent|percentage|rate|ratio|share)(_|$)/i.test(field)
    || /(pct|percent|percentage|rate|ratio|share)$/i.test(field);
}

function shouldAverageField(field: string): boolean {
  return /(^|_)(avg|average|mean|median)(_|$)/i.test(field)
    || /(avg|average|mean|median)$/i.test(field);
}

function formatMetricValue(value: unknown, field: string): string {
  const numeric = typeof value === 'number' ? value : coerceNumber(value);
  if (numeric === undefined) return cellToString(value);
  if (inferMetricRole(field) === 'percent') return `${formatNumber(numeric)}%`;
  return formatNumber(numeric);
}

function renderLineDot(
  props: any,
  color: string,
  activeRowIndex: number | null,
  selectedRowIndex: number | null,
  seriesKey?: string
) {
  if (props.cx == null || props.cy == null || props.value == null) return null;
  const rowIndex = getPayloadRowIndex(props.payload, seriesKey);
  const active = rowIndex !== null && (rowIndex === activeRowIndex || rowIndex === selectedRowIndex);
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={active ? 4 : 2.5}
      fill={color}
      stroke={active ? chartTheme.activeStroke : color}
      strokeWidth={active ? 1.5 : 0}
      opacity={markOpacity(rowIndex, activeRowIndex, selectedRowIndex)}
      tabIndex={0}
      aria-label={`${props.name || 'Value'} ${formatNumber(Number(props.value ?? 0))}`}
    />
  );
}

function renderScatterPoint(props: any, activeRowIndex: number | null, selectedRowIndex: number | null) {
  const rowIndex = getPayloadRowIndex(props.payload);
  const active = rowIndex !== null && (rowIndex === activeRowIndex || rowIndex === selectedRowIndex);
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={active ? 5 : 3.5}
      fill={CHART_SERIES_COLORS[0]}
      stroke={active ? chartTheme.activeStroke : CHART_SERIES_COLORS[0]}
      strokeWidth={active ? 1.5 : 0}
      opacity={markOpacity(rowIndex, activeRowIndex, selectedRowIndex)}
      tabIndex={0}
      aria-label={`Point ${rowIndex === null ? '' : rowIndex + 1}`}
    />
  );
}

function markOpacity(rowIndex: number | null, activeRowIndex: number | null, selectedRowIndex: number | null): number {
  if (rowIndex === null || (activeRowIndex === null && selectedRowIndex === null)) return 0.88;
  if (rowIndex === activeRowIndex || rowIndex === selectedRowIndex) return 1;
  return 0.38;
}

function getCategoryAxisWidth(rows: ChartRow[]): number {
  const longest = rows.reduce((max, row) => Math.max(max, row.__label.length), 0);
  return Math.min(120, Math.max(54, longest * 5.5));
}

function truncateTick(value: unknown): string {
  const text = cellToString(value);
  return text.length > 14 ? `${text.slice(0, 13)}...` : text;
}

function formatCategoryLabel(value: unknown): string {
  return cellToString(value) || '(empty)';
}

function formatNumber(value: unknown): string {
  const numeric = typeof value === 'number' ? value : coerceNumber(value);
  if (numeric === undefined) return cellToString(value);
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(numeric / 1_000).toFixed(1)}K`;
  if (abs >= 100) return numeric.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 10) return numeric.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
