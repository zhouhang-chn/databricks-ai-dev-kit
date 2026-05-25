-- MV3 validation: KPI725 benchmark and scan reconciliation.
-- Replace :yearmonth before execution.
-- Live check 2026-05-25: MV3 was recreated with an employee-month source
-- query that pre-aggregates KPI725 and scan summary before Metric View
-- measures are applied.
-- Validation passed for 202604 across 7254 employees with zero mismatches
-- for target, actual, KPI achievement rate, scan-side achieved POC count, and
-- KPI-vs-Scan Difference. Monthly aggregates for 202601-202604 also matched
-- direct SQL.

-- Metric View path.
SELECT
  `Year Month`,
  `Employee Code`,
  MEASURE(`Total Target Value`) AS total_target_value,
  MEASURE(`Total Actual Value`) AS total_actual_value,
  MEASURE(`KPI Achievement Rate`) AS kpi_achievement_rate,
  MEASURE(`Scan Side Achieved POC Count`) AS scan_side_achieved_poc_count,
  MEASURE(`KPI-vs-Scan Difference`) AS kpi_vs_scan_difference
FROM ds_uc_china_dev.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WHERE `Year Month` = :yearmonth
GROUP BY ALL;

-- Direct SQL oracle.
WITH kpi725 AS (
  SELECT
    CAST(DATE_FORMAT(startdate, 'yyyyMM') AS INT) AS year_month,
    EmployeeCode AS employee_code,
    SUM(targetvalue) AS total_target_value,
    SUM(actualvalue) AS total_actual_value
  FROM brewdat_uc_china_prod.md_exchange_brewdat_ods.tsvc_base_sys_kpiachieverate
  WHERE kpicode = 'KPI725'
    AND CAST(DATE_FORMAT(startdate, 'yyyyMM') AS INT) = :yearmonth
  GROUP BY CAST(DATE_FORMAT(startdate, 'yyyyMM') AS INT), EmployeeCode
),
scan_summary AS (
  SELECT
    CAST(yearmonth AS INT) AS year_month,
    m1_no AS employee_code,
    COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END)
      AS scan_side_achieved_poc_count
  FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
  WHERE CAST(yearmonth AS INT) = :yearmonth
    AND COALESCE(channel, 'KA') != 'T2WS'
  GROUP BY CAST(yearmonth AS INT), m1_no
)
SELECT
  kpi725.year_month,
  kpi725.employee_code,
  kpi725.total_target_value,
  kpi725.total_actual_value,
  kpi725.total_actual_value / NULLIF(kpi725.total_target_value, 0) AS kpi_achievement_rate,
  COALESCE(scan_summary.scan_side_achieved_poc_count, 0) AS scan_side_achieved_poc_count,
  kpi725.total_actual_value - COALESCE(scan_summary.scan_side_achieved_poc_count, 0)
    AS kpi_vs_scan_difference
FROM kpi725
LEFT JOIN scan_summary
  ON kpi725.year_month = scan_summary.year_month
  AND kpi725.employee_code = scan_summary.employee_code;
