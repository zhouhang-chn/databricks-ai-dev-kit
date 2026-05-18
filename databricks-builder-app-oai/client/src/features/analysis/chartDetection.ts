import type { ChartSpec } from '@/features/analysis/types';
import { coerceNumber, isLikelyDateString, type RowOriented } from './evidenceData';

const NON_CHART_TOOLS = new Set([
  'get_table_stats_and_schema',
  'get_volume_folder_details',
  'list_compute',
  'list_sql_warehouses',
  'get_best_sql_warehouse',
]);

const MAX_RENDERABLE_ROWS = 500;

type ColumnProfile = {
  name: string;
  numericCount: number;
  dateLikeCount: number;
  distinctValues: number;
  nonNullCount: number;
};

export function detectChartSpec(
  tabular: RowOriented,
  options?: { toolName?: string }
): ChartSpec | undefined {
  const normalizedToolName = (options?.toolName || '').replace(/^mcp__databricks__/, '');
  if (NON_CHART_TOOLS.has(normalizedToolName)) return undefined;
  if (tabular.rows.length < 2 || tabular.rows.length > MAX_RENDERABLE_ROWS) return undefined;
  if (tabular.columns.length < 2) return undefined;

  const profiles = profileColumns(tabular);
  const numeric = profiles.filter((p) => isMostlyNumeric(p));
  const temporal = profiles.filter((p) => isMostlyTemporal(p));
  const categorical = profiles.filter((p) => !isMostlyNumeric(p));

  if (numeric.length === 0) return undefined;

  const xField =
    temporal[0]?.name
    ?? categorical.find((p) => p.distinctValues > 1 && p.distinctValues <= 60)?.name
    ?? tabular.columns[0];

  const yFields = numeric
    .map((p) => p.name)
    .filter((name) => name !== xField)
    .slice(0, 3);

  if (yFields.length === 0) return undefined;

  if (shouldUseScatter(tabular, numeric, xField)) {
    return {
      chartType: 'scatter',
      xField: numeric[0].name,
      yFields: [numeric[1].name],
      title: `${numeric[1].name} vs ${numeric[0].name}`,
      insight: `Each point is one row. Check clustering and outliers.`,
    };
  }

  if (shouldUsePie(tabular, xField, yFields[0])) {
    return {
      chartType: 'pie',
      xField,
      yFields: [yFields[0]],
      title: `${yFields[0]} share by ${xField}`,
      insight: `Composition across ${tabular.rows.length} categories.`,
      showLabels: true,
    };
  }

  if (temporal.some((p) => p.name === xField)) {
    return {
      chartType: 'line',
      xField,
      yFields,
      title: `${yFields.join(', ')} trend`,
      insight: `Trend over ${xField}.`,
    };
  }

  return {
    chartType: 'bar',
    xField,
    yFields,
    title: `${yFields.join(', ')} by ${xField}`,
    insight: `Compare categories by magnitude.`,
    sort: 'desc',
  };
}

export function validateChartSpec(spec: ChartSpec, tabular: RowOriented): boolean {
  if (!spec || !spec.chartType || !spec.xField || !Array.isArray(spec.yFields)) return false;
  if (!tabular.columns.includes(spec.xField)) return false;
  if (spec.yFields.length === 0) return false;
  if (!spec.yFields.every((field) => tabular.columns.includes(field))) return false;
  if (spec.chartType === 'scatter' && spec.yFields.length !== 1) return false;
  if (spec.chartType === 'pie' && spec.yFields.length !== 1) return false;
  return true;
}

function profileColumns(tabular: RowOriented): ColumnProfile[] {
  return tabular.columns.map((name) => {
    let numericCount = 0;
    let dateLikeCount = 0;
    let nonNullCount = 0;
    const distinct = new Set<string>();

    for (const row of tabular.rows) {
      const value = row[name];
      if (value == null || value === '') continue;
      nonNullCount += 1;
      distinct.add(String(value));
      if (coerceNumber(value) !== undefined) numericCount += 1;
      if (isLikelyDateString(value)) dateLikeCount += 1;
    }

    return {
      name,
      numericCount,
      dateLikeCount,
      distinctValues: distinct.size,
      nonNullCount,
    };
  });
}

function isMostlyNumeric(profile: ColumnProfile): boolean {
  if (profile.nonNullCount === 0) return false;
  return profile.numericCount / profile.nonNullCount >= 0.8;
}

function isMostlyTemporal(profile: ColumnProfile): boolean {
  if (profile.nonNullCount === 0) return false;
  return profile.dateLikeCount / profile.nonNullCount >= 0.8;
}

function shouldUseScatter(
  tabular: RowOriented,
  numericColumns: ColumnProfile[],
  xField: string
): boolean {
  if (tabular.rows.length < 6 || tabular.rows.length > 300) return false;
  if (numericColumns.length < 2) return false;
  if (numericColumns.some((p) => p.name === xField)) return true;
  return false;
}

function shouldUsePie(tabular: RowOriented, xField: string, yField: string): boolean {
  if (tabular.rows.length < 2 || tabular.rows.length > 12) return false;
  const total = tabular.rows.reduce((sum, row) => {
    const value = coerceNumber(row[yField]);
    return value !== undefined && value >= 0 ? sum + value : sum;
  }, 0);
  if (total <= 0) return false;
  if (tabular.rows.some((row) => coerceNumber(row[yField]) === undefined)) return false;
  if (tabular.rows.some((row) => isLikelyDateString(row[xField]))) return false;
  return true;
}
