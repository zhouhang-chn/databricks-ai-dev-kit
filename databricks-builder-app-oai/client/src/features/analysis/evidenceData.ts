export type JsonRecord = Record<string, unknown>;

export type RowOriented = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
};

export function tryParseJson(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function asRowTable(value: unknown): RowOriented | null {
  if (Array.isArray(value) && value.length > 0 && value.every(
    (item) => item && typeof item === 'object' && !Array.isArray(item)
  )) {
    const rows = value as Array<Record<string, unknown>>;
    const columns = inferColumns(rows);
    return { rows, columns };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as JsonRecord;
    const rowsField = obj.rows ?? obj.data ?? obj.results ?? obj.records;
    if (Array.isArray(rowsField)) {
      if (Array.isArray(rowsField[0]) && Array.isArray(obj.columns)) {
        const columns = (obj.columns as unknown[]).map(String);
        const rows = (rowsField as unknown[][]).map((arr) =>
          Object.fromEntries(columns.map((c, i) => [c, arr[i]]))
        );
        return { rows, columns };
      }
      if (rowsField.every(
        (item) => item && typeof item === 'object' && !Array.isArray(item)
      )) {
        const rows = rowsField as Array<Record<string, unknown>>;
        const columns = Array.isArray(obj.columns)
          ? (obj.columns as unknown[]).map(String)
          : inferColumns(rows);
        return { rows, columns };
      }
    }
    const output = obj.output;
    if (typeof output === 'string' && output.startsWith('[[')) {
      try {
        const jsonStr = output.replace(/'/g, '"');
        const rows = JSON.parse(jsonStr) as unknown[][];
        if (Array.isArray(rows) && rows.length > 0) {
          const columns = rows[0].map((_, i) => `Col ${i + 1}`);
          const normalizedRows = rows.map((row) =>
            Object.fromEntries(columns.map((c, i) => [c, row[i]]))
          );
          return { rows: normalizedRows, columns };
        }
      } catch {
        // ignore parse failure
      }
    }
  }
  return null;
}

export function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function rowsToCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
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

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'evidence';
}

export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

export function isLikelyDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(text)) return true;
  if (/^[A-Za-z]{3}\s+\d{4}$/.test(text)) return true;
  const ts = Date.parse(text);
  return Number.isFinite(ts);
}

function inferColumns(rows: Array<Record<string, unknown>>): string[] {
  return Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );
}
