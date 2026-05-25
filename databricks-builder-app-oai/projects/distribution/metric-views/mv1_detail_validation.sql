-- MV1 validation: POC x Group x SKU achievement detail.
-- Replace :yearmonth and :m1_no before execution.
-- Live check 2026-05-25: validated for 202604 across 6990 M1s with zero
-- mismatches against direct SQL for achieved SKU, total SKU, rate, distinct
-- POC, distinct group, achieved POC-group, and total POC-group counts.

-- Metric View path.
SELECT
  `M1 No`,
  `POC ID`,
  `Group Code`,
  MEASURE(`Achieved SKU Count`) AS achieved_sku_count,
  MEASURE(`Total SKU Count`) AS total_sku_count,
  MEASURE(`SKU Achievement Rate`) AS sku_achievement_rate,
  MEASURE(`Total POC-Group Count`) AS total_poc_group_count,
  MEASURE(`Achieved POC-Group Count`) AS achieved_poc_group_count
FROM ds_uc_china_dev.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics
WHERE `Year Month` = :yearmonth
  AND `M1 No` = :m1_no
GROUP BY ALL;

-- Direct SQL oracle.
SELECT
  m1_no,
  poc_middle_id,
  group_code,
  SUM(if_achieved) AS achieved_sku_count,
  COUNT(1) AS total_sku_count,
  SUM(if_achieved) * 1.0 / NULLIF(COUNT(1), 0) AS sku_achievement_rate,
  COUNT(DISTINCT CONCAT(poc_middle_id, '|', group_code)) AS total_poc_group_count,
  COUNT(DISTINCT CASE WHEN if_achieved = 1 THEN CONCAT(poc_middle_id, '|', group_code) END)
    AS achieved_poc_group_count
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_detail
WHERE CAST(yearmonth AS INT) = :yearmonth
  AND m1_no = :m1_no
  AND COALESCE(channel, 'KA') != 'T2WS'
GROUP BY m1_no, poc_middle_id, group_code;
