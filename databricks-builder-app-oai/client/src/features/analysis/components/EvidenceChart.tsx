import { useMemo } from 'react';
import type { ChartSpec } from '@/features/analysis/types';
import { cellToString, coerceNumber, type RowOriented } from '@/features/analysis/evidenceData';

const SERIES_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];

type EvidenceChartProps = {
  tabular: RowOriented;
  spec: ChartSpec;
};

export function EvidenceChart({ tabular, spec }: EvidenceChartProps) {
  const content = useMemo(() => {
    if (spec.chartType === 'pie') return <PieChart tabular={tabular} spec={spec} />;
    if (spec.chartType === 'line') return <LineChart tabular={tabular} spec={spec} />;
    if (spec.chartType === 'scatter') return <ScatterChart tabular={tabular} spec={spec} />;
    return <BarChart tabular={tabular} spec={spec} />;
  }, [spec, tabular]);

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
      {spec.yFields.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]">
          {spec.yFields.map((field, index) => (
            <span key={field} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              />
              {field}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BarChart({ tabular, spec }: EvidenceChartProps) {
  const rows = toSeriesRows(tabular, spec, 24);
  if (rows.length === 0) return null;

  const max = Math.max(...rows.flatMap((row) => row.values), 0);
  if (max <= 0) return null;

  return (
    <div className="space-y-2">
      {rows.map((row, rowIndex) => (
        <div key={`${row.label}-${rowIndex}`} className="space-y-1">
          <div className="truncate text-[10px] text-[var(--color-text-muted)]" title={row.label}>
            {row.label}
          </div>
          <div className="space-y-1">
            {row.values.map((value, valueIndex) => (
              <div key={`${row.label}-${spec.yFields[valueIndex]}`} className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded bg-[var(--color-bg-tertiary)]">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.max(2, (value / max) * 100)}%`,
                      backgroundColor: SERIES_COLORS[valueIndex % SERIES_COLORS.length],
                    }}
                  />
                </div>
                <span className="w-12 text-right text-[10px] tabular-nums text-[var(--color-text-muted)]">
                  {formatNumber(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LineChart({ tabular, spec }: EvidenceChartProps) {
  const rows = toSeriesRows(tabular, spec, 80);
  if (rows.length < 2) return null;

  const width = 640;
  const height = 220;
  const padding = 24;
  const values = rows.flatMap((row) => row.values);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const span = maxY - minY || 1;
  const xStep = (width - padding * 2) / Math.max(1, rows.length - 1);

  const scaleY = (value: number): number => {
    const normalized = (value - minY) / span;
    return height - padding - normalized * (height - padding * 2);
  };

  return (
    <div className="overflow-x-auto no-scrollbar">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px] min-w-[280px] w-full">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" opacity="0.25" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="currentColor" opacity="0.25" />

        {spec.yFields.map((_, seriesIndex) => {
          const points = rows
            .map((row, index) => `${padding + index * xStep},${scaleY(row.values[seriesIndex])}`)
            .join(' ');
          return (
            <polyline
              key={`series-${seriesIndex}`}
              fill="none"
              stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
              strokeWidth="2"
              points={points}
            />
          );
        })}

        <text x={padding} y={height - 6} fontSize="10" fill="currentColor" opacity="0.6">
          {rows[0]?.label || ''}
        </text>
        <text x={width - padding} y={height - 6} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">
          {rows[rows.length - 1]?.label || ''}
        </text>
      </svg>
    </div>
  );
}

function ScatterChart({ tabular, spec }: EvidenceChartProps) {
  const xField = spec.xField;
  const yField = spec.yFields[0];
  const points = tabular.rows
    .map((row) => {
      const x = coerceNumber(row[xField]);
      const y = coerceNumber(row[yField]);
      return x !== undefined && y !== undefined ? { x, y } : null;
    })
    .filter((point): point is { x: number; y: number } => point !== null)
    .slice(0, 300);

  if (points.length < 2) return null;

  const width = 640;
  const height = 220;
  const padding = 24;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  return (
    <div className="overflow-x-auto no-scrollbar">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px] min-w-[280px] w-full">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" opacity="0.25" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="currentColor" opacity="0.25" />

        {points.map((point, index) => {
          const cx = padding + ((point.x - minX) / spanX) * (width - padding * 2);
          const cy = height - padding - ((point.y - minY) / spanY) * (height - padding * 2);
          return <circle key={index} cx={cx} cy={cy} r={3} fill={SERIES_COLORS[0]} opacity="0.8" />;
        })}

        <text x={padding} y={height - 6} fontSize="10" fill="currentColor" opacity="0.6">
          {spec.xLabel || spec.xField}
        </text>
        <text x={padding + 2} y={padding - 6} fontSize="10" fill="currentColor" opacity="0.6">
          {spec.yLabel || yField}
        </text>
      </svg>
    </div>
  );
}

function PieChart({ tabular, spec }: EvidenceChartProps) {
  const valueField = spec.yFields[0];
  const entries = tabular.rows
    .map((row) => {
      const label = cellToString(row[spec.xField]) || '(empty)';
      const value = coerceNumber(row[valueField]);
      return value !== undefined && value >= 0 ? { label, value } : null;
    })
    .filter((entry): entry is { label: string; value: number } => entry !== null)
    .slice(0, 12);

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (entries.length < 2 || total <= 0) return null;

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 84;
  let angle = -Math.PI / 2;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[180px] w-[180px] shrink-0">
        {entries.map((entry, index) => {
          const slice = (entry.value / total) * Math.PI * 2;
          const startAngle = angle;
          const endAngle = angle + slice;
          angle = endAngle;
          const largeArc = slice > Math.PI ? 1 : 0;
          const x1 = cx + radius * Math.cos(startAngle);
          const y1 = cy + radius * Math.sin(startAngle);
          const x2 = cx + radius * Math.cos(endAngle);
          const y2 = cy + radius * Math.sin(endAngle);
          const path = [
            `M ${cx} ${cy}`,
            `L ${x1} ${y1}`,
            `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
            'Z',
          ].join(' ');
          return (
            <path key={entry.label} d={path} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
          );
        })}
      </svg>
      <div className="min-w-0 space-y-1 text-[10px] text-[var(--color-text-muted)]">
        {entries.map((entry, index) => (
          <div key={entry.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
            />
            <span className="truncate" title={entry.label}>{entry.label}</span>
            <span className="ml-auto tabular-nums">
              {((entry.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type SeriesRow = {
  label: string;
  values: number[];
};

function toSeriesRows(tabular: RowOriented, spec: ChartSpec, limit: number): SeriesRow[] {
  const rows = tabular.rows
    .map((row) => {
      const label = cellToString(row[spec.xField]) || '(empty)';
      const values = spec.yFields.map((field) => coerceNumber(row[field]) ?? NaN);
      if (values.every((value) => Number.isNaN(value))) return null;
      return { label, values: values.map((value) => (Number.isNaN(value) ? 0 : value)) };
    })
    .filter((row): row is SeriesRow => row !== null);

  const sortMode = spec.sort || 'natural';
  if (sortMode !== 'natural') {
    rows.sort((a, b) => {
      const av = a.values[0] ?? 0;
      const bv = b.values[0] ?? 0;
      return sortMode === 'asc' ? av - bv : bv - av;
    });
  }
  return rows.slice(0, limit);
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 100) return value.toFixed(1);
  return value.toFixed(2);
}
