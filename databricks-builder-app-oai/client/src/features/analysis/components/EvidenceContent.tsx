import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EvidenceBlock } from '@/features/analysis/types';
import { cn } from '@/lib/utils';

const PREVIEW_ROWS = 50;

type RowOriented = { rows: Array<Record<string, unknown>>; columns: string[] };

function tryParseJson(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** If the parsed value is row-oriented tabular data, return it normalised. */
function asRowTable(value: unknown): RowOriented | null {
  if (Array.isArray(value) && value.length > 0 && value.every(
    (item) => item && typeof item === 'object' && !Array.isArray(item)
  )) {
    const rows = value as Array<Record<string, unknown>>;
    const columns = Array.from(
      rows.reduce<Set<string>>((set, row) => {
        Object.keys(row).forEach((k) => set.add(k));
        return set;
      }, new Set())
    );
    return { rows, columns };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const rowsField = obj.rows ?? obj.data ?? obj.results ?? obj.records;
    if (Array.isArray(rowsField)) {
      // {rows: [["a", 1], ["b", 2]], columns: ["name", "value"]}
      if (Array.isArray(rowsField[0]) && Array.isArray(obj.columns)) {
        const columns = (obj.columns as unknown[]).map(String);
        const rows = (rowsField as unknown[][]).map((arr) =>
          Object.fromEntries(columns.map((c, i) => [c, arr[i]]))
        );
        return { rows, columns };
      }
      // {rows: [{...}, {...}]}
      if (rowsField.every(
        (item) => item && typeof item === 'object' && !Array.isArray(item)
      )) {
        const rows = rowsField as Array<Record<string, unknown>>;
        const columns = Array.isArray(obj.columns)
          ? (obj.columns as unknown[]).map(String)
          : Array.from(
            rows.reduce<Set<string>>((set, row) => {
              Object.keys(row).forEach((k) => set.add(k));
              return set;
            }, new Set())
          );
        return { rows, columns };
      }
    }
  }
  return null;
}

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function rowsToCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const escape = (raw: string): string => {
    if (raw === '') return '';
    if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
    return raw;
  };
  const header = columns.map(escape).join(',');
  const body = rows
    .map((row) => columns.map((c) => escape(cellToString(row[c]))).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

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

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'evidence';
}

export function EvidenceContent({ block }: { block: EvidenceBlock }) {
  const raw = block.rawContent ?? block.content ?? '';
  const parsed = useMemo(() => tryParseJson(raw), [raw]);
  const tabular = useMemo(() => (parsed ? asRowTable(parsed) : null), [parsed]);
  const [expanded, setExpanded] = useState(false);

  if (block.isError) {
    return (
      <pre className="evidence-error mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-tertiary)] p-2 text-[11px] leading-5 text-[var(--color-error)]">
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
        <div className="evidence-markdown max-w-full overflow-x-auto rounded border border-[var(--color-border)]">
          <table>
            <thead>
              <tr>{tabular.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {visibleRows.map((row, idx) => (
                <tr key={idx}>
                  {tabular.columns.map((c) => (
                    <td key={c}>{cellToString(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated && (
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
            'max-h-72 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-tertiary)] p-2 text-[11px] leading-5 text-[var(--color-text-muted)]'
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
    <div className="evidence-markdown mt-2 max-w-full overflow-x-auto break-words text-xs leading-5 text-[var(--color-text-muted)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{raw || block.content}</ReactMarkdown>
    </div>
  );
}
