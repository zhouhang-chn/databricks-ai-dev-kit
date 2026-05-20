# Databricks Metric View 设计 — Distribution 项目

## Context

基于 Distribution 项目的业务需求（MHA 达成、造假检测、售点排序、售点画像），设计 5 个 Unity Catalog Metric View，为 Data Agent 和 AI/BI Dashboard 提供统一、可复用的指标语义层。

本设计现在作为 Builder App OAI v0.3.5 Metric View Context Engineering
的 Distribution 种子语义层。v0.3.5 负责从业务输入、分析笔记、
Notebook/SQL、Unity Catalog 元数据和数据画像中提取指标语义，验证 Metric
View 输出，并将认证后的 Metric View 注册到 `distribution.yaml`。

### 设计原则

1. **月度对齐**：所有 Metric View 以 `yearmonth` 为核心时间维度，KPI 配置和达成定义按月变化
2. **双视角**：支持「售点级别」和「售点 × Group 级别」两个层级的达成评估
3. **渠道清洗**：在 Dimension 中统一处理 `IH → TT`、`NULL → KA`，排除 `T2WS`
4. **角色分层**：Org 维度覆盖 M1 → M2 → M3 → BU → Region 全部层级，支持各级下钻
5. **可复用**：每个 MV 独立服务于一组场景，可被 SQL、Genie、Dashboard、Agent 共同使用

### 场景覆盖

| Metric View | 场景 A 达成 | 场景 B 行动 | 场景 C 风控 | 场景 D 画像 | 场景 E 对标 | 场景 F 诊断 |
|:------------|:----------:|:----------:|:----------:|:----------:|:----------:|:----------:|
| MV1 达成明细 | ● | ◐ | | | ◐ | ● |
| MV2 售点达成 | ● | ● | | | ◐ | ● |
| MV3 KPI对标 | ◐ | | | | ● | ● |
| MV4 BEES覆盖 | | | ● | ● | | |
| MV5 KBD覆盖 | | | | ● | ◐ | |

● 主要数据源  ◐ 辅助数据源

---

## 1. Metric View 清单

| # | MV 名称 | Source Table | 粒度 | 角色 |
|---|---------|-------------|------|------|
| MV1 | `m1_achievement_detail_metrics` | `distribution_achievement_detail` + org join | POC × Group × SKU Key × Month | M2/M3 |
| MV2 | `m1_poc_achievement_metrics` | `distribution_achievement_summary` + POC master join | POC × Month | M1/M2 |
| MV3 | `m1_kpi725_benchmark_metrics` | `tsvc_base_sys_kpiachieverate` | Employee × Month | M2/M3 |
| MV4 | `m1_bees_coverage_metrics` | `bees_distribution_detail` | POC × SKU × Month | M1/M2 |
| MV5 | `m1_kbd_coverage_metrics` | `kbd_detail` | POC × SKU × Month | M2/M3 |

### 目标 Schema

所有 Metric View 创建在：

```
brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw
```

---

## 2. MV1: `m1_achievement_detail_metrics` — 达成明细指标

### 2.1 设计说明

基于 `distribution_achievement_detail`（POC × Group × SKU Key 粒度），Join `mha_sku_achievement_detail` 获取组织层级（M1 → M2 → M3 → BU → Region → Area），构建支持从一线业代下钻到大区分析的全层级达成明细视图。

### 2.2 E/R 关系

```
distribution_achievement_detail (FACT)
  ├── dim: yearmonth (分区键, string 'yyyyMM')
  ├── dim: m1_no, poc_middle_id, poc_self_defined_name
  ├── dim: channel (原始), format_name
  ├── dim: group_code, mha_sku_key_type, mha_sku_key
  └── measure: if_achieved (0/1)

  JOIN ── employee_relation_m1m2m3_monthly
  ON yearmonth = relation_month
  AND m1_no = employee_no

  ← dim: bu, region, area, territory
  ← dim: m2_employee_no, m2_employee_name
  ← dim: m3_employee_no, m3_employee_name
```

### 2.3 YAML Definition

```sql
CREATE OR REPLACE VIEW brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "MHA分销达成明细指标 — POC×Group×SKU Key 粒度，含完整组织层级，支持售点级和Group级双视角达成评估"
  source: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_detail
  filter: CAST(yearmonth AS INT) >= 202501 AND channel != 'T2WS'

  joins:
    - name: org
      source: brewdat_uc_china_prod.org_datahub_dw.employee_relation_m1m2m3_monthly
      on: source.yearmonth = org.relation_month AND source.m1_no = org.employee_no

  dimensions:
    - name: Year Month
      expr: "CAST(yearmonth AS INT)"
      comment: "数据月份，格式 yyyyMM (如 202601)"

    - name: M1 No
      expr: "source.m1_no"
      comment: "一线业代工号"

    - name: POC ID
      expr: "source.poc_middle_id"
      comment: "售点唯一标识"

    - name: POC Name
      expr: "source.poc_self_defined_name"
      comment: "售点自定名称"

    - name: Channel
      expr: "CASE WHEN source.channel = 'IH' THEN 'TT' WHEN source.channel IS NULL THEN 'KA' ELSE source.channel END"
      comment: "渠道 (IH→TT, NULL→KA, 已排除T2WS)"

    - name: Format Name
      expr: "source.format_name"
      comment: "业态: 大卖场/普通超市/高端超市/现购自运/普通便利店/高端便利店/油站便利店"

    - name: Group Code
      expr: "source.group_code"
      comment: "KPI 组 (每个 (POC, group_code) = 一项 KPI 要求)"

    - name: SKU Key Type
      expr: "source.mha_sku_key_type"
      comment: "品项类型: Subbrand*PACK 或 CIO"

    - name: MHA SKU Key
      expr: "source.mha_sku_key"
      comment: "品项标识"

    - name: BU
      expr: "org.bu"
      comment: "事业部"

    - name: Region
      expr: "org.region"
      comment: "大区"

    - name: Area
      expr: "org.area"
      comment: "区域"

    - name: Territory
      expr: "org.territory"
      comment: "片区"

    - name: M2 Name
      expr: "org.m2_employee_name"
      comment: "M2 主管姓名"

    - name: M2 No
      expr: "org.m2_employee_no"
      comment: "M2 工号"

    - name: M3 Name
      expr: "org.m3_employee_name"
      comment: "M3 经理姓名"

    - name: M3 No
      expr: "org.m3_employee_no"
      comment: "M3 工号"

  measures:
    - name: Achieved SKU Count
      expr: "SUM(source.if_achieved)"
      comment: "当月达成 SKU Key 数量"

    - name: Total SKU Count
      expr: "COUNT(1)"
      comment: "当月全部 SKU Key 数量"

    - name: SKU Achievement Rate
      expr: "SUM(source.if_achieved) * 1.0 / COUNT(1)"
      comment: "SKU Key 级别达成率"

    - name: Distinct POC Count
      expr: "COUNT(DISTINCT source.poc_middle_id)"
      comment: "涉及售点数"

    - name: Distinct Group Count
      expr: "COUNT(DISTINCT source.group_code)"
      comment: "涉及 Group 数"

    - name: Achieved POC-Group Count
      expr: "COUNT(DISTINCT CASE WHEN source.if_achieved = 1 THEN CONCAT(source.poc_middle_id, '|', source.group_code) END)"
      comment: "达成的 (POC, Group) 组合数"

    - name: Total POC-Group Count
      expr: "COUNT(DISTINCT CONCAT(source.poc_middle_id, '|', source.group_code))"
      comment: "全部 (POC, Group) 组合数"
$$
```

### 2.4 查询示例

```sql
-- A1: M1 当月达成率概览
SELECT
  `M1 No`,
  MEASURE(`Achieved SKU Count`) AS achieved_sku,
  MEASURE(`Total SKU Count`) AS total_sku,
  MEASURE(`SKU Achievement Rate`) AS achieve_rate,
  MEASURE(`Distinct POC Count`) AS poc_count,
  MEASURE(`Distinct Group Count`) AS group_count
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics
WHERE `Year Month` = 202604 AND `M1 No` = '28036110'
GROUP BY ALL;

-- A5: 某 M1 未达成售点清单 (哪些店各差几个 Group)
SELECT
  `POC ID`,
  `POC Name`,
  `Channel`,
  `Format Name`,
  `Group Code`,
  MEASURE(`Achieved SKU Count`) AS achieved,
  MEASURE(`Total SKU Count`) AS required,
  MEASURE(`SKU Achievement Rate`) AS rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics
WHERE `Year Month` = 202604
  AND `M1 No` = '28036110'
GROUP BY `POC ID`, `POC Name`, `Channel`, `Format Name`, `Group Code`
HAVING MEASURE(`SKU Achievement Rate`) < 1.0
ORDER BY MEASURE(`SKU Achievement Rate`) ASC;

-- E1: 按大区对比达成率
SELECT
  `Region`,
  MEASURE(`SKU Achievement Rate`) AS achieve_rate,
  MEASURE(`Distinct POC Count`) AS poc_count
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics
WHERE `Year Month` = 202604
GROUP BY ALL
ORDER BY achieve_rate DESC;

-- A3: 过去三个月趋势 (按 M2 汇总)
SELECT
  `Year Month`,
  `M2 Name`,
  MEASURE(`SKU Achievement Rate`) AS achieve_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics
WHERE `Year Month` IN (202602, 202603, 202604)
  AND `Region` = '华东'
GROUP BY ALL
ORDER BY `Year Month`, achieve_rate DESC;
```

---

## 3. MV2: `m1_poc_achievement_metrics` — 售点达成汇总指标

### 3.1 设计说明

基于 `distribution_achievement_summary`（售点级别达成汇总），Join `poc_master_daily_fact` 获取售点地理和业态维度，加入业态分层阈值判定逻辑。

### 3.2 YAML Definition

```sql
CREATE OR REPLACE VIEW brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "售点级别MHA达成汇总 — 含业态分层阈值判定，支持售点整体达成评估和优先级排序"
  source: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
  filter: CAST(yearmonth AS INT) >= 202501 AND channel != 'T2WS'

  dimensions:
    - name: Year Month
      expr: "CAST(yearmonth AS INT)"
      comment: "数据月份"

    - name: M1 No
      expr: "m1_no"
      comment: "一线业代工号"

    - name: POC ID
      expr: "poc_middle_id"
      comment: "售点唯一标识"

    - name: POC Name
      expr: "poc_self_defined_name"
      comment: "售点自定名称"

    - name: Channel
      expr: "CASE WHEN channel = 'IH' THEN 'TT' WHEN channel IS NULL THEN 'KA' ELSE channel END"
      comment: "渠道 (IH→TT / NULL→KA)"

    - name: Format Name
      expr: "format_name"
      comment: "业态名称"

    - name: Format Category
      expr: "CASE
        WHEN format_name IN ('大卖场', '普通超市', '现购自运', '高端超市') THEN 'Large_Format'
        WHEN format_name IN ('普通便利店', '高端便利店', '油站便利店') THEN 'Convenience'
        ELSE 'Other'
        END"
      comment: "业态大类: Large_Format (需≥5 Group) / Convenience (需≥4 Group)"

    - name: Is Achieved
      expr: "CASE WHEN achievement_date IS NOT NULL THEN 'Achieved' ELSE 'Not Achieved' END"
      comment: "该售点是否整体达成"

  measures:
    - name: Achievement Num
      expr: "SUM(achievement_num)"
      comment: "达成的 MHA 品项数"

    - name: Total MHA SKU Count
      expr: "SUM(CAST(mha_sku_cnt AS DOUBLE))"
      comment: "MHA SKU 总数"

    - name: Total POC Count
      expr: "COUNT(DISTINCT poc_middle_id)"
      comment: "全部售点数"

    - name: Achieved POC Count
      expr: "COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END)"
      comment: "整体达成的售点数"

    - name: Not Achieved POC Count
      expr: "COUNT(DISTINCT CASE WHEN achievement_date IS NULL THEN poc_middle_id END)"
      comment: "未达成的售点数"

    - name: POC Achievement Rate
      expr: "COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL THEN poc_middle_id END) * 1.0 / COUNT(DISTINCT poc_middle_id)"
      comment: "售点级别达成率 (达成售点数 / 总售点数)"

    - name: Large Format Achieved POC Count
      expr: "COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL AND format_name IN ('大卖场', '普通超市', '现购自运', '高端超市') THEN poc_middle_id END)"
      comment: "大业态达成售点数"

    - name: Large Format Total POC Count
      expr: "COUNT(DISTINCT CASE WHEN format_name IN ('大卖场', '普通超市', '现购自运', '高端超市') THEN poc_middle_id END)"
      comment: "大业态总售点数"

    - name: Convenience Achieved POC Count
      expr: "COUNT(DISTINCT CASE WHEN achievement_date IS NOT NULL AND format_name IN ('普通便利店', '高端便利店', '油站便利店') THEN poc_middle_id END)"
      comment: "便利店达成售点数"

    - name: Convenience Total POC Count
      expr: "COUNT(DISTINCT CASE WHEN format_name IN ('普通便利店', '高端便利店', '油站便利店') THEN poc_middle_id END)"
      comment: "便利店总售点数"
$$
```

### 3.3 查询示例

```sql
-- A1: M1 当月达成概览
SELECT
  `M1 No`,
  MEASURE(`Total POC Count`) AS total_poc,
  MEASURE(`Achieved POC Count`) AS achieved_poc,
  MEASURE(`Not Achieved POC Count`) AS not_achieved_poc,
  MEASURE(`POC Achievement Rate`) AS achieve_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WHERE `Year Month` = 202604 AND `M1 No` = '28036110'
GROUP BY ALL;

-- B3: 识别离达成只差 1 个 Group 的售点机会 (需要结合 detail 表)
-- 此查询在 Agent 中两步完成: (1) 从此 MV 获得未达成POC (2) 从 MV1 下钻 Group 差数

-- E2: 渠道维度达成对比
SELECT
  `Channel`,
  MEASURE(`Total POC Count`) AS total_poc,
  MEASURE(`Achieved POC Count`) AS achieved_poc,
  MEASURE(`POC Achievement Rate`) AS achieve_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WHERE `Year Month` = 202604
GROUP BY ALL
ORDER BY achieve_rate DESC;

-- E3: 业态维度达成对比
SELECT
  `Format Name`,
  `Format Category`,
  MEASURE(`Total POC Count`) AS total,
  MEASURE(`Achieved POC Count`) AS achieved,
  MEASURE(`POC Achievement Rate`) AS rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WHERE `Year Month` = 202604
GROUP BY ALL
ORDER BY rate DESC;

-- A3: 过去三个月达成率趋势
SELECT
  `Year Month`,
  MEASURE(`Total POC Count`) AS total_poc,
  MEASURE(`Achieved POC Count`) AS achieved_poc,
  MEASURE(`POC Achievement Rate`) AS achieve_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WHERE `Year Month` IN (202602, 202603, 202604)
GROUP BY ALL
ORDER BY `Year Month`;
```

---

## 4. MV3: `m1_kpi725_benchmark_metrics` — KPI725 对标指标

### 4.1 设计说明

基于 `tsvc_base_sys_kpiachieverate` (KPI 系统的达成上报表)，Filter 仅 `kpicode = 'KPI725'`（M1 MHA 达成售点数 KPI），支持与 scan 侧达成数据的交叉校验。

### 4.2 YAML Definition

```sql
CREATE OR REPLACE VIEW brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "KPI725 M1达成售点数对标 — KPI系统上报值 vs 目标值，支持与Scan侧达成数的交叉校验和异常诊断"
  source: brewdat_uc_china_prod.md_exchange_brewdat_ods.tsvc_base_sys_kpiachieverate
  filter: kpicode = 'KPI725'

  joins:
    - name: scan_summary
      source: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary
      on: "source.EmployeeCode = scan_summary.m1_no AND CAST(DATE_FORMAT(source.startdate, 'yyyyMM') AS STRING) = scan_summary.yearmonth"
      join_type: left
    - name: org
      source: brewdat_uc_china_prod.org_datahub_dw.employee_relation_m1m2m3_monthly
      on: "source.EmployeeCode = org.employee_no AND CAST(DATE_FORMAT(source.startdate, 'yyyyMM') AS STRING) = org.relation_month"
      join_type: left

  dimensions:
    - name: Year Month
      expr: "CAST(DATE_FORMAT(source.startdate, 'yyyyMM') AS INT)"
      comment: "KPI 周期月份"

    - name: Employee Code
      expr: "source.EmployeeCode"
      comment: "业代工号"

    - name: Username
      expr: "source.username"
      comment: "业代姓名"

    - name: Role
      expr: "source.userrolecode"
      comment: "角色: M1 / M2 / M3"

    - name: Post Code
      expr: "source.postcode"
      comment: "岗位代码"

    - name: BU
      expr: "org.bu"
      comment: "事业部 (来自组织关系表)"

    - name: Region
      expr: "org.region"
      comment: "大区 (来自组织关系表)"

    - name: Area
      expr: "org.area"
      comment: "区域 (来自组织关系表)"

    - name: Territory
      expr: "org.territory"
      comment: "片区 (来自组织关系表)"

    - name: Has Target
      expr: "CASE WHEN source.targetvalue IS NOT NULL AND source.targetvalue > 0 THEN 'Has Target' ELSE 'No Target' END"
      comment: "是否配置了KPI目标值"

    - name: Has Actual
      expr: "CASE WHEN source.actualvalue IS NOT NULL THEN 'Has Actual' ELSE 'No Actual' END"
      comment: "是否有实际上报值"

  measures:
    - name: Total Target Value
      expr: "SUM(source.targetvalue)"
      comment: "目标达成售点数合计"

    - name: Total Actual Value
      expr: "SUM(source.actualvalue)"
      comment: "实际达成售点数合计 (KPI系统上报)"

    - name: KPI Achievement Rate
      expr: "SUM(source.actualvalue) / NULLIF(SUM(source.targetvalue), 0)"
      comment: "KPI达成率 (actual/target)"

    - name: Target-Actual Gap
      expr: "SUM(source.targetvalue) - SUM(source.actualvalue)"
      comment: "目标达成差距 (正值=未达标, 负值=超标)"

    - name: Employee Count
      expr: "COUNT(DISTINCT source.EmployeeCode)"
      comment: "有KPI配置的业代人数"

    - name: Employee Count with Zero Actual
      expr: "COUNT(DISTINCT CASE WHEN source.actualvalue = 0 OR source.actualvalue IS NULL THEN source.EmployeeCode END)"
      comment: "实际达成=0或无数据的业代人数"

    - name: Employee Count with Fractional Actual
      expr: "COUNT(DISTINCT CASE WHEN source.actualvalue % 1 != 0 THEN source.EmployeeCode END)"
      comment: "实际达成值含小数的业代人数 (数据质量标记)"

    - name: Scan Side Achieved POC Count
      expr: "SUM(CASE WHEN scan_summary.achievement_date IS NOT NULL THEN 1 ELSE 0 END)"
      comment: "Scan侧达成的售点数 (用于交叉校验)"

    - name: KPI-vs-Scan Difference
      expr: "SUM(source.actualvalue) - SUM(CASE WHEN scan_summary.achievement_date IS NOT NULL THEN 1 ELSE 0 END)"
      comment: "KPI系统上报值 - Scan侧达成数的差异"

    - name: Max Actual Value
      expr: "MAX(source.actualvalue)"
      comment: "最大上报值 (极端值检测)"

    - name: Min Actual Value
      expr: "MIN(source.actualvalue)"
      comment: "最小上报值"

    - name: Median Actual Value
      expr: "PERCENTILE(source.actualvalue, 0.5)"
      comment: "上报值中位数"
$$
```

### 4.3 查询示例

```sql
-- E1/E4: 月度达成率趋势
SELECT
  `Year Month`,
  MEASURE(`Employee Count`) AS emp_count,
  MEASURE(`Total Target Value`) AS target,
  MEASURE(`Total Actual Value`) AS actual,
  MEASURE(`KPI Achievement Rate`) AS achieve_rate,
  MEASURE(`Target-Actual Gap`) AS gap
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WHERE `Year Month` BETWEEN 202601 AND 202604
GROUP BY ALL
ORDER BY `Year Month`;

-- F3: KPI vs Scan 差异诊断 (口径校准)
SELECT
  `Year Month`,
  `Employee Code`,
  `Username`,
  MEASURE(`Total Actual Value`) AS kpi_actual,
  MEASURE(`Scan Side Achieved POC Count`) AS scan_achieved,
  MEASURE(`KPI-vs-Scan Difference`) AS diff
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WHERE `Year Month` = 202604
GROUP BY ALL
HAVING MEASURE(`KPI-vs-Scan Difference`) != 0
ORDER BY ABS(MEASURE(`KPI-vs-Scan Difference`)) DESC
LIMIT 20;

-- F1: 小数异常检测
SELECT
  `Year Month`,
  `Employee Code`,
  `Username`,
  MEASURE(`Total Actual Value`) AS actual
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WHERE `Year Month` = 202604
  AND `Employee Code` IN (
    SELECT `Employee Code`
    FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
    WHERE `Year Month` = 202604
    GROUP BY `Employee Code`
    HAVING MEASURE(`Employee Count with Fractional Actual`) > 0
  )
GROUP BY ALL;

-- F4: 极端值检测 (达成超过 500 家)
SELECT
  `Year Month`,
  `Employee Code`,
  `Username`,
  MEASURE(`Total Actual Value`) AS actual,
  MEASURE(`Total Target Value`) AS target
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WHERE `Year Month` = 202604
GROUP BY ALL
HAVING MEASURE(`Total Actual Value`) > 500
ORDER BY MEASURE(`Total Actual Value`) DESC;

-- 按角色汇总
SELECT
  `Role`,
  `Year Month`,
  MEASURE(`Employee Count`) AS emp_count,
  MEASURE(`KPI Achievement Rate`) AS achieve_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics
WHERE `Year Month` = 202604
GROUP BY ALL;
```

---

## 5. MV4: `m1_bees_coverage_metrics` — BEES 订单分销覆盖指标

### 5.1 设计说明

基于 `bees_distribution_detail`（BEES 平台订单明细），追踪各售点的订单覆盖情况。用于与扫码数据交叉匹配（订单验证）、售点销量层级评估。

### 5.2 YAML Definition

```sql
CREATE OR REPLACE VIEW brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_bees_coverage_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "BEES订单分销覆盖 — 按售点×SKU追踪订单覆盖情况，支持售点画像(销量层级)和扫码-订单交叉验证"
  source: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_bees_distribution_detail
  filter: CAST(yearmonth AS INT) >= 202501

  dimensions:
    - name: Year Month
      expr: "CAST(yearmonth AS INT)"
      comment: "订单月份"

    - name: M1 No
      expr: "m1_no"
      comment: "业代工号"

    - name: POC ID
      expr: "poc_middle_id"
      comment: "售点标识"

    - name: Subbrand
      expr: "subbrand"
      comment: "子品牌"

    - name: Pack
      expr: "pack"
      comment: "包装规格"

    - name: CIO Code
      expr: "cio_code"
      comment: "CIO 条码"

    - name: MHA SKU Key
      expr: "mha_sku_key"
      comment: "对应 MHA 品项标识"

    - name: TSBF
      expr: "tsbf"
      comment: "TS/BF 分类"

  measures:
    - name: Order Count
      expr: "COUNT(DISTINCT order_id)"
      comment: "BEES 订单数"

    - name: Distinct POC Count
      expr: "COUNT(DISTINCT poc_middle_id)"
      comment: "有订单的售点数"

    - name: Distinct SKU Count
      expr: "COUNT(DISTINCT cio_code)"
      comment: "有订单的 SKU 数"

    - name: Distinct Subbrand Count
      expr: "COUNT(DISTINCT subbrand)"
      comment: "有订单的子品牌数"

    - name: SKU Coverage per POC
      expr: "COUNT(DISTINCT cio_code) * 1.0 / NULLIF(COUNT(DISTINCT poc_middle_id), 0)"
      comment: "每售点平均 SKU 覆盖数"
$$
```

### 5.3 查询示例

```sql
-- D3: 售点在同行中的销量层级 (按 Channel 内排名)
SELECT
  `POC ID`,
  `Channel`,
  `Year Month`,
  MEASURE(`Order Count`) AS order_cnt,
  MEASURE(`Distinct SKU Count`) AS sku_cnt,
  MEASURE(`SKU Coverage per POC`) AS sku_per_poc
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_bees_coverage_metrics
WHERE `Year Month` = 202604 AND `Channel` = 'TT'
GROUP BY ALL
ORDER BY order_cnt DESC;

-- C4: 某 M1 的 BEES 订单覆盖 vs MHA 要求
SELECT
  `M1 No`,
  `Year Month`,
  MEASURE(`Order Count`) AS total_orders,
  MEASURE(`Distinct POC Count`) AS covered_pocs,
  MEASURE(`Distinct SKU Count`) AS sku_variety
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_bees_coverage_metrics
WHERE `Year Month` = 202604
GROUP BY ALL
ORDER BY covered_pocs DESC;
```

---

## 6. MV5: `m1_kbd_coverage_metrics` — KBD KA 渠道铺货指标

### 6.1 设计说明

基于 `kbd_detail`（KA 渠道 Key Brand Distribution 铺货明细），追踪 KA 渠道的关键品牌铺货覆盖。仅适用于 KA 渠道（2026-02 起）。

### 6.2 YAML Definition

```sql
CREATE OR REPLACE VIEW brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kbd_coverage_metrics
WITH METRICS
LANGUAGE YAML
AS $$
  version: 1.1
  comment: "KA渠道KBD铺货覆盖 — 按售点×SKU追踪关键品牌铺货情况，用于KA渠道的MHA补充评估"
  source: brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_kbd_detail
  filter: CAST(yearmonth AS INT) >= 202602

  dimensions:
    - name: Year Month
      expr: "CAST(yearmonth AS INT)"
      comment: "数据月份"

    - name: M1 No
      expr: "m1_no"
      comment: "业代工号"

    - name: POC ID
      expr: "poc_middle_id"
      comment: "售点标识"

    - name: Subbrand
      expr: "subbrand"
      comment: "子品牌"

    - name: Pack
      expr: "pack"
      comment: "包装规格"

    - name: TSBF
      expr: "tsbf"
      comment: "TS/BF 分类"

    - name: MHA SKU Key
      expr: "mha_sku_key"
      comment: "对应 MHA 品项标识"

  measures:
    - name: KBD SKU Count
      expr: "COUNT(DISTINCT mha_sku_key)"
      comment: "铺货 SKU 数"

    - name: KBD POC Count
      expr: "COUNT(DISTINCT poc_middle_id)"
      comment: "铺货售点数"

    - name: KBD Subbrand Count
      expr: "COUNT(DISTINCT subbrand)"
      comment: "铺货子品牌数"

    - name: KBD Pack Count
      expr: "COUNT(DISTINCT pack)"
      comment: "包装规格数"

    - name: KBD TSBF Count
      expr: "COUNT(DISTINCT tsbf)"
      comment: "TSBF 分类数"
$$
```

### 6.3 查询示例

```sql
-- E2: KA 渠道 KBD 覆盖 vs MHA 要求
SELECT
  `Year Month`,
  MEASURE(`KBD POC Count`) AS kbd_pocs,
  MEASURE(`KBD SKU Count`) AS kbd_skus,
  MEASURE(`KBD Subbrand Count`) AS kbd_subbrands
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kbd_coverage_metrics
WHERE `Year Month` = 202604
GROUP BY ALL;

-- D1: 某售点的 KBD 情况
SELECT
  `POC ID`,
  `Subbrand`,
  `Pack`,
  MEASURE(`KBD SKU Count`) AS sku_count
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kbd_coverage_metrics
WHERE `Year Month` = 202604 AND `POC ID` = '1234567'
GROUP BY ALL
ORDER BY `Subbrand`;
```

---

## 7. Metric View 与 Data Agent 场景映射

### 7.1 场景 → MV 路由表

| 场景 | 子场景 | 主 MV | 查询模式 |
|------|--------|-------|---------|
| **A1 个人达成** | "我达成率多少？" | MV1 + MV2 | MV2 获取 POC 级达成 → MV1 下钻 Group 明细 |
| **A2 团队排名** | "谁的达成率最低？" | MV1 | 按 M2 No 分组 → M1 No 排序 |
| **A3 趋势分析** | "过去三个月趋势" | MV1 + MV2 | 跨月聚合 |
| **A4 差异下钻** | "KPI vs Scan 不一致" | MV3 | KPI-vs-Scan Difference |
| **A5 未达成分析** | "哪些店差几个 Group" | MV1 | 过滤 SKU Achievement Rate < 1 |
| **B1 优先级排序** | "最该去哪些店" | MV2 | Not Achieved POC Count + POC Achievement Rate 排序 |
| **B3 机会识别** | "差 1 个 Group 的店" | MV1 | 先得未达成 POC → MV1 看 Group 差数 |
| **C4 订单匹配** | "扫码无对应订单" | MV4 | BEES order count vs scan count |
| **D1 售点概览** | "这家店基本情况" | MV2 + MV4 + MV5 | 多维数据聚合 |
| **D3 销量层级** | "同行中销量水平" | MV4 | Channel 内 Order Count percentile |
| **E1 区域对比** | "大区达成率对比" | MV1 + MV3 | 按 Region 分组 |
| **E2 渠道对比** | "TT vs KA 达成" | MV2 | 按 Channel 分组 |
| **E3 业态对比** | "大卖场 vs 便利店" | MV2 | 按 Format Category 分组 |
| **E4 同期对比** | "同比变化" | MV3 | 跨年同月对比 |
| **F1 指标异常** | "达成数有小数" | MV3 | Employee Count with Fractional Actual > 0 |
| **F3 口径校准** | "系统 vs KPI 差异" | MV3 | KPI-vs-Scan Difference 排查 |
| **F4 极端值** | "达成9000合理吗" | MV3 | Max Actual Value 检测 |

### 7.2 Agent 多 MV 组合查询模式

```
用户: "我们大区这个月达成率怎么样？哪个渠道拖后腿？"

Agent 查询计划:
1. 意图识别: 场景E1+E2 (达成率 + 下钻渠道), Region=用户所属大区, 时间=当月
2. 查询 MV2 (POC Achievement):
   SELECT Region, Channel, MEASURE(POC Achievement Rate), MEASURE(Achieved POC Count)
   WHERE Year Month = 当月 AND Region = '华东'
   GROUP BY Region, Channel
3. 如果发现某渠道达成低, 追问 MV1 (Detail):
   SELECT Channel, Format Name, GROUP Code, MEASURE(SKU Achievement Rate)
   WHERE Year Month = 当月 AND Region = '华东' AND Channel = 'TT'
   GROUP BY Channel, Format Name, Group Code
4. 回答: "华东大区当月达成率 78%, 其中 TT 渠道偏低(65%), 主要拖累的 Group 是..."
```

---

## 8. 创建与维护

### 8.1 创建顺序

由于 MV3 引用了 `m1_scan_distribution_achievement_summary` 作为 join，需先创建 MV1 和 MV2，再创建 MV3。

```
MV2 (POC Achievement) → MV1 (Detail + Org) → MV3 (KPI Benchmark)
MV4 (BEES) 和 MV5 (KBD) 无依赖，可并行创建
```

### 8.2 MCP 创建命令

所有 MV 通过 `manage_metric_views` MCP tool 创建，使用 `or_replace=True` 确保幂等。

### 8.3 权限管理

```sql
-- 授予 Data Agent 服务账号查询权限
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics TO `data-agent@company.com`;
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics TO `data-agent@company.com`;
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics TO `data-agent@company.com`;
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_bees_coverage_metrics TO `data-agent@company.com`;
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kbd_coverage_metrics TO `data-agent@company.com`;

-- 授予 M2/M3 用户组查询权限
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics TO `m2_managers`;
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics TO `m2_managers`;

-- 授予 M1 用户组查询权限 (仅限自己数据—由 Agent 层实现行级过滤)
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics TO `m1_sales`;
GRANT SELECT ON brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_bees_coverage_metrics TO `m1_sales`;
```

### 8.4 维护注意事项

1. **月度新增分区**：`filter` 表达式使用 `>= 202501`，新月份数据自动包含
2. **渠道映射变更**：如 `channel_name` 新增渠道类别，需更新 `Channel` Dimension 的 CASE 逻辑
3. **业态阈值调整**：如达成判定阈值变化（≥5 / ≥4），需更新 MV2 的 `Format Category` 和相关 Measure
4. **组织层级变更**：`employee_relation_m1m2m3_monthly` 的 org 字段如新增层级，MV1 和 MV3 需新增对应 Dimension
5. **T2WS 排除**：所有 MV 的 filter 已排除 `channel = 'T2WS'`，如业务不再需要此排除逻辑，移除 filter 中的 `AND channel != 'T2WS'`

### 8.5 数据验证记录 (2026-05-19)

基于实际数据验证 MV 设计的可行性：

| 验证项 | 结果 | 影响 |
|--------|------|------|
| MV1 org join | `employee_relation_m1m2m3_monthly` 按月对齐，字段完整 (bu/region/area/territory/m2/m3) | 采用此表替代 `mha_sku_achievement_detail` |
| MV2 数据规模 | 202604: 6,988 M1, 952K POC, 490K achieved, 5 channels, 29 formats | MV 可用 |
| MV3 KPI vs Scan 匹配 | 7,254 KPI employees vs 6,869 Scan employees (385 无 Scan 侧数据) | LEFT JOIN 必需 |
| MV3 小数异常 | 202601: 4,427/6,869 records 含小数 actualvalue | F1 场景可检测 |
| MV3 空值 | 202605: 7,141 records 全部 actualvalue=NULL (当月未结束) | 查询时需过滤 |
| BEES subbrand | 202601 subbrand_count=0 (数据质量问题), 其他月份正常 | 使用 `subbrand` 维度时需注意空值 |
| Channels | KA, TT, CR, NL, T2WS 五种渠道 | 已排除 T2WS |

---

## 9. 扩展规划

### Phase 2 建议

- **MV6: `m1_fraud_detection_metrics`** — 基于 `m1_scan_bar_code` 宽表 (需先通过 Notebook 构建)，添加:
  - Dimensions: Year Month, M1 No, POC ID, BU, Channel
  - Measures: Cross-Store Duplicate Count, GPS Anomaly Count, Unmatched Order Count, ML Fraud Count
- **MV7: `m1_poc_profile_metrics`** — 基于售点画像数据，添加 SKU 生命周期标签 (stable/unstable/churn) 和销量层级 (5%/5-20%/20-50%/50-100%)，需要先构建 `poc_distribution_combine` 中间表
- **MV1 增强**：利用 `poc_master_daily_fact` 的 `amap_provice_name` 和 `amap_city_name` 添加地理下钻维度
- **Materialization**：为 MV2 和 MV3 添加 `materialization` 配置，预计算高频查询组合 (按月×大区×渠道)

### Phase 3 建议

- **Window Measures**：为 MV1/MV3 添加 Month-over-Month 达成率变化（需要 version 0.1 实验特性）
- **AI/BI Dashboard 集成**：所有 MV 可直接作为 Dashboard Dataset 使用
- **Genie Space 集成**：将 MV 添加到 Genie Space 的 `table_identifiers`，支持自然语言查询
