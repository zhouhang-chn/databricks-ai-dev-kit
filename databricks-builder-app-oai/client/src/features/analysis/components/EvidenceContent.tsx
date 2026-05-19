import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EvidenceBlock } from '@/features/analysis/types';
import { detectChartSpec, validateChartSpec } from '@/features/analysis/chartDetection';
import {
  asRowTable,
  cellToString,
  rowsToCsv,
  safeFilename,
  tryParseJson,
} from '@/features/analysis/evidenceData';
import { cn } from '@/lib/utils';
import { EvidenceChart } from './EvidenceChart';

const PREVIEW_ROWS = 50;

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function TableStatsRenderer({ data }: { data: any }) {
  const tables = data.tables || [];
  if (tables.length === 0) {
    return (
      <div className="mt-2 text-xs italic text-[var(--color-text-muted)]">
        No tables found in {data.catalog}.{data.schema_name}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-6">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)]/40 pb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
          Schema: {data.catalog}.{data.schema_name}
        </span>
      </div>

      {tables.map((table: any, idx: number) => (
        <div key={table.name || idx} className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h4 className="text-sm font-bold text-[var(--color-text-heading)]">
              {table.name}
            </h4>
            <div className="flex flex-wrap gap-2">
              {table.total_rows != null && (
                <span className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]">
                  {table.total_rows.toLocaleString()} rows
                </span>
              )}
              {table.total_files != null && (
                <span className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]">
                  {table.total_files.toLocaleString()} files
                </span>
              )}
              {table.total_size_bytes != null && (
                <span className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]">
                  {(table.total_size_bytes / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
              {table.format && (
                <span className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-primary)]">
                  {table.format.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {table.comment && (
            <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {table.comment}
            </p>
          )}

          {table.error && (
            <div className="rounded border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-2 py-1 text-[11px] text-[var(--color-error)]">
              {table.error}
            </div>
          )}

          {table.column_details && Object.keys(table.column_details).length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]/60">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[var(--color-bg-secondary)]/50">
                  <tr>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Column</th>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Type</th>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Distinct</th>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Min</th>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Max</th>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Nulls</th>
                    <th className="px-3 py-2 font-bold text-[var(--color-text-muted)]">Comment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]/40">
                  {Object.values(table.column_details).map((col: any) => (
                    <tr key={col.name} className="hover:bg-[var(--color-bg-secondary)]/30">
                      <td className="px-3 py-2 font-mono font-medium text-[var(--color-text-primary)]">{col.name}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">{col.data_type}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] tabular-nums">{col.cardinality?.toLocaleString() || '-'}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] truncate max-w-[80px]">{cellToString(col.min)}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] truncate max-w-[80px]">{cellToString(col.max)}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] tabular-nums">{col.null_count?.toLocaleString() || '-'}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] italic min-w-[100px]">{col.comment || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {table.sample_data && table.sample_data.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Sample Data
              </span>
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]/60 no-scrollbar">
                <table className="w-full text-left text-[10px]">
                  <thead className="bg-[var(--color-bg-secondary)]/30">
                    <tr>
                      {Object.keys(table.sample_data[0]).map((k) => (
                        <th key={k} className="px-2 py-1.5 font-bold text-[var(--color-text-muted)]">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]/20">
                    {table.sample_data.slice(0, 5).map((row: any, ridx: number) => (
                      <tr key={ridx}>
                        {Object.values(row).map((val: any, vidx: number) => (
                          <td key={vidx} className="px-2 py-1.5 text-[var(--color-text-primary)] whitespace-nowrap">
                            {cellToString(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function EvidenceContent({ block }: { block: EvidenceBlock }) {
  const raw = block.rawContent ?? block.content ?? '';
  const parsed = useMemo(() => tryParseJson(raw), [raw]);
  const tabular = useMemo(() => (parsed ? asRowTable(parsed) : null), [parsed]);
  const chartSpec = useMemo(() => {
    if (!tabular) return undefined;
    if (block.chartSpec && validateChartSpec(block.chartSpec, tabular)) return block.chartSpec;
    return detectChartSpec(tabular, { toolName: block.toolName });
  }, [block.chartSpec, block.toolName, tabular]);
  const [expanded, setExpanded] = useState(false);
  const [evidenceView, setEvidenceView] = useState<'both' | 'chart' | 'table'>('both');
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  if (block.toolName === 'get_table_stats_and_schema' || block.toolName === 'get_volume_folder_details') {
    if (parsed && typeof parsed === 'object') {
      return <TableStatsRenderer data={parsed} />;
    }
  }

  if (block.isError) {
    return (
      <pre className="evidence-error mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-tertiary)] p-2 text-[11px] leading-5 text-[var(--color-error)] no-scrollbar">
        {raw || block.content}
      </pre>
    );
  }

  if (tabular) {
    const total = tabular.rows.length;
    const visibleRows = expanded ? tabular.rows : tabular.rows.slice(0, PREVIEW_ROWS);
    const truncated = total > visibleRows.length;
    const baseName = safeFilename(block.toolName || block.title || 'evidence');
    const onDownload = (): void => downloadBlob(
      `${baseName}-${block.id.slice(-8)}.csv`,
      rowsToCsv(tabular.columns, tabular.rows),
      'text/csv',
    );
    return (
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
          <span>{total.toLocaleString()} rows × {tabular.columns.length} cols</span>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] hover:border-[var(--color-accent-primary)]/40 hover:text-[var(--color-accent-primary)]"
            title="Download all rows as CSV"
          >
            <Download className="h-3 w-3" />
            CSV
          </button>
        </div>
        {chartSpec && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-0.5 text-[10px]">
              {(['both', 'chart', 'table'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setEvidenceView(view)}
                  className={cn(
                    'rounded px-2 py-0.5 capitalize transition-colors',
                    evidenceView === view
                      ? 'bg-[var(--color-background)] text-[var(--color-text-heading)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
            {selectedRowIndex !== null && (
              <button
                type="button"
                onClick={() => setSelectedRowIndex(null)}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent-primary)]"
              >
                Clear selection
              </button>
            )}
          </div>
        )}
        {chartSpec && evidenceView !== 'table' && (
          <EvidenceChart
            tabular={tabular}
            spec={chartSpec}
            activeRowIndex={activeRowIndex}
            selectedRowIndex={selectedRowIndex}
            onActiveRowChange={setActiveRowIndex}
            onSelectRow={(rowIndex) => {
              setSelectedRowIndex((current) => (current === rowIndex ? null : rowIndex));
            }}
          />
        )}
        {chartSpec && evidenceView !== 'chart' && (
          <div className="mb-1 mt-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Table fallback
          </div>
        )}
        {evidenceView !== 'chart' && (
          <div className="evidence-markdown max-w-full overflow-x-auto rounded border border-[var(--color-border)] no-scrollbar">
            <table>
              <thead>
                <tr>{tabular.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {visibleRows.map((row, idx) => (
                  <tr
                    key={idx}
                    onMouseEnter={() => setActiveRowIndex(idx)}
                    onMouseLeave={() => setActiveRowIndex(null)}
                    onClick={() => setSelectedRowIndex((current) => (current === idx ? null : idx))}
                    className={cn(
                      'cursor-pointer transition-colors',
                      activeRowIndex === idx && 'bg-[var(--color-bg-secondary)]/70',
                      selectedRowIndex === idx && 'bg-[var(--color-accent-primary)]/10'
                    )}
                  >
                    {tabular.columns.map((c) => (
                      <td key={c}>{cellToString(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {truncated && evidenceView !== 'chart' && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 text-[10px] text-[var(--color-accent-primary)] hover:underline"
          >
            Show all {total.toLocaleString()} rows
          </button>
        )}
      </div>
    );
  }

  // Structured but non-tabular JSON: pretty-print + raw download.
  if (parsed && typeof parsed === 'object') {
    const baseName = safeFilename(block.toolName || block.title || 'evidence');
    const onDownload = (): void => downloadBlob(
      `${baseName}-${block.id.slice(-8)}.json`,
      JSON.stringify(parsed, null, 2),
      'application/json',
    );
    const previewLength = 4000;
    const pretty = JSON.stringify(parsed, null, 2);
    const truncated = pretty.length > previewLength;
    const visible = expanded || !truncated ? pretty : pretty.slice(0, previewLength);
    return (
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-end">
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-accent-primary)]/40 hover:text-[var(--color-accent-primary)]"
            title="Download raw JSON"
          >
            <Download className="h-3 w-3" />
            JSON
          </button>
        </div>
        <pre
          className={cn(
            'max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-tertiary)] p-2 text-[11px] leading-5 text-[var(--color-text-muted)] no-scrollbar'
          )}
        >
          {visible}
          {truncated && !expanded ? '\n…' : ''}
        </pre>
        {truncated && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-1 text-[10px] text-[var(--color-accent-primary)] hover:underline"
          >
            {expanded ? 'Collapse' : `Show full (${pretty.length.toLocaleString()} chars)`}
          </button>
        )}
      </div>
    );
  }

  // Plain string / markdown text.
  return (
    <div className="evidence-markdown mt-2 max-w-full overflow-x-auto break-words text-xs leading-5 text-[var(--color-text-muted)] no-scrollbar">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{raw || block.content}</ReactMarkdown>
    </div>
  );
}
