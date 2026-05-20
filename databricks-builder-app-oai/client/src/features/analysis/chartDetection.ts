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
const SUPPORTED_CHART_TYPES = new Set(['bar', 'line', 'area', 'pie', 'scatter']);

type ColumnProfile = {
  name: string;
  numericCount: number;
  dateLikeCount: number;
  distinctValues: number;
  nonNullCount: number;
  minNumeric?: number;
  maxNumeric?: number;
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
  const temporal = profiles.filter((p) => isMostlyTemporal(p));
  const numeric = profiles.filter((p) => isMostlyNumeric(p) && !temporal.includes(p));
  const categorical = profiles.filter((p) => !isMostlyNumeric(p) && !temporal.includes(p));

  if (numeric.length === 0) return undefined;

  const categoricalAxis = categorical.find((p) => p.distinctValues > 1 && p.distinctValues <= 60);
  const xProfile = chooseTemporalAxis(temporal) ?? categoricalAxis;
  const xField = xProfile?.name;

  if (!xField) return undefined;

  const yFields = numeric
    .map((p) => p.name)
    .filter((name) => name !== xField)
    .slice(0, 3);
  const breakdownField = findBreakdownField(profiles, xField)?.name;

  if (yFields.length === 0) return undefined;

  if (temporal.some((p) => p.name === xField)) {
    return {
      chartType: 'line',
      xField,
      yFields,
      title: `${yFields.join(', ')} trend`,
      insight: `Trend over ${xField}.`,
      sort: 'asc',
      colorField: breakdownField,
    };
  }

  if (shouldUseScatter(tabular, numeric, xField)) {
    return {
      chartType: 'scatter',
      xField: numeric[0].name,
      yFields: [numeric[1].name],
      title: `${numeric[1].name} vs ${numeric[0].name}`,
      insight: `Each point is one row. Check clustering and outliers.`,
    };
  }

  if (shouldUsePie(tabular, xField, yFields[0], categorical)) {
    return {
      chartType: 'pie',
      xField,
      yFields: [yFields[0]],
      title: `${yFields[0]} share by ${xField}`,
      insight: `Composition across ${tabular.rows.length} categories.`,
      showLabels: true,
    };
  }

  return {
    chartType: 'bar',
    xField,
    yFields,
    title: `${yFields.join(', ')} by ${xField}`,
    insight: `Compare categories by magnitude.`,
    sort: breakdownField ? 'natural' : 'desc',
    colorField: breakdownField,
  };
}

export function inferChartColorField(tabular: RowOriented, spec: ChartSpec): string | undefined {
  if (spec.colorField && tabular.columns.includes(spec.colorField)) return spec.colorField;
  if (!tabular.columns.includes(spec.xField)) return undefined;
  return findBreakdownField(profileColumns(tabular), spec.xField)?.name;
}

export function validateChartSpec(spec: ChartSpec, tabular: RowOriented): boolean {
  if (!spec || !spec.chartType || !spec.xField || !Array.isArray(spec.yFields)) return false;
  if (!SUPPORTED_CHART_TYPES.has(spec.chartType)) return false;
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
    let minNumeric: number | undefined;
    let maxNumeric: number | undefined;
    const distinct = new Set<string>();

    for (const row of tabular.rows) {
      const value = row[name];
      if (value == null || value === '') continue;
      nonNullCount += 1;
      distinct.add(String(value));
      const numeric = coerceNumber(value);
      if (numeric !== undefined) {
        numericCount += 1;
        minNumeric = minNumeric === undefined ? numeric : Math.min(minNumeric, numeric);
        maxNumeric = maxNumeric === undefined ? numeric : Math.max(maxNumeric, numeric);
      }
      if (isLikelyDateString(value)) dateLikeCount += 1;
    }

    return {
      name,
      numericCount,
      dateLikeCount,
      distinctValues: distinct.size,
      nonNullCount,
      minNumeric,
      maxNumeric,
    };
  });
}

function isMostlyNumeric(profile: ColumnProfile): boolean {
  if (profile.nonNullCount === 0) return false;
  return profile.numericCount / profile.nonNullCount >= 0.8;
}

function isMostlyTemporal(profile: ColumnProfile): boolean {
  if (profile.nonNullCount === 0) return false;
  if (isLikelyTemporalColumnName(profile.name) && hasTemporalValueShape(profile)) return true;
  return profile.dateLikeCount / profile.nonNullCount >= 0.8;
}

function chooseTemporalAxis(profiles: ColumnProfile[]): ColumnProfile | undefined {
  return [...profiles]
    .filter((profile) => profile.distinctValues > 1)
    .sort((left, right) => right.distinctValues - left.distinctValues)[0];
}

function findBreakdownField(profiles: ColumnProfile[], xField: string): ColumnProfile | undefined {
  const xProfile = profiles.find((profile) => profile.name === xField);
  const candidates = profiles.filter((profile) => (
    profile.name !== xField
    && profile.nonNullCount > 0
    && profile.distinctValues > 1
    && profile.distinctValues <= 20
  ));

  const temporalBreakdown = candidates.find((profile) => (
    isMostlyTemporal(profile)
    && (!xProfile || profile.distinctValues < xProfile.distinctValues || isCalendarPeriodColumn(profile.name))
  ));
  if (temporalBreakdown) return temporalBreakdown;

  return candidates.find((profile) => !isMostlyNumeric(profile) && !isMostlyTemporal(profile));
}

function isCalendarPeriodColumn(name: string): boolean {
  return /(^|_)(yearmonth|yyyymm|year_month|month|period|quarter|week)(_|$)/i.test(name);
}

function isLikelyTemporalColumnName(name: string): boolean {
  if (/(pct|percent|percentage|rate|ratio|amount|count|total|score|avg|average|sum)$/i.test(name)) {
    return false;
  }
  return /(^|_)(date|time|timestamp|month|yearmonth|yyyymm|year_month|week|quarter|period|day)(_|$)/i.test(name)
    || /(_at|_ts)$/i.test(name);
}

function hasTemporalValueShape(profile: ColumnProfile): boolean {
  if (profile.dateLikeCount > 0) return true;
  if (profile.numericCount / profile.nonNullCount < 0.8) return false;
  const min = profile.minNumeric;
  const max = profile.maxNumeric;
  if (min === undefined || max === undefined) return true;
  if (min >= 1900 && max <= 2200) return true;
  if (min >= 190001 && max <= 220012) return true;
  if (profile.distinctValues <= 60 && min >= 1 && max <= 366) return true;
  return false;
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

function shouldUsePie(
  tabular: RowOriented,
  xField: string,
  yField: string,
  categoricalColumns: ColumnProfile[]
): boolean {
  if (tabular.rows.length < 2 || tabular.rows.length > 12) return false;
  if (categoricalColumns.some((column) => column.name !== xField && column.distinctValues > 1)) return false;
  const xValues = tabular.rows.map((row) => String(row[xField] ?? ''));
  if (new Set(xValues).size !== xValues.length) return false;
  const total = tabular.rows.reduce((sum, row) => {
    const value = coerceNumber(row[yField]);
    return value !== undefined && value >= 0 ? sum + value : sum;
  }, 0);
  if (total <= 0) return false;
  if (tabular.rows.some((row) => coerceNumber(row[yField]) === undefined)) return false;
  if (tabular.rows.some((row) => isLikelyDateString(row[xField]))) return false;
  return true;
}
