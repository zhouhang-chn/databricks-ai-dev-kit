-- MV2 validation: POC achievement metrics.
-- Replace :yearmonth and :m1_no before execution.
-- Live check 2026-05-25: validated for 202604 across 6990 M1s with zero
-- mismatches against direct SQL for total POC, achieved POC, not achieved POC,
-- and POC achievement rate.

-- Metric View path.
SELECT
  `M1 No`,
  `Year Month`,
  MEASURE(`Total POC Count`) AS total_poc_count,
  MEASURE(`Achieved POC Count`) AS achieved_poc_count,
  MEASURE(`Not Achieved POC Count`) AS not_achieved_poc_count,
  MEASURE(`POC Achievement Rate`) AS poc_achievement_rate
FROM ds_uc_china_dev.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WHERE `Year Month` = :yearmonth
  AND `M1 No` = :m1_no
GROUP BY ALL;

-- Direct SQL oracle.
SELECT
  m1_no,
  CAST(yearmonth AS INT) AS year_month,
  COUNT(DISTINCT poc_middle_id) AS total_poc_count,
  COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END) AS achieved_poc_count,
  COUNT(DISTINCT CASE WHEN achievement_date IS NULL THEN poc_middle_id END) AS not_achieved_poc_count,
  COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END) * 1.0
    / NULLIF(COUNT(DISTINCT poc_middle_id), 0) AS poc_achievement_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
WHERE CAST(yearmonth AS INT) = :yearmonth
  AND m1_no = :m1_no
  AND COALESCE(channel, 'KA') != 'T2WS'
GROUP BY m1_no, CAST(yearmonth AS INT);
