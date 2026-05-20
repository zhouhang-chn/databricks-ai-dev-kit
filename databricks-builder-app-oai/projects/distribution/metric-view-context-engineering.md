# Distribution Metric View Context Engineering

## Purpose

This file applies the v0.3.5 Metric View Context Engineering release to the
Distribution seed project.

Distribution analysis should prefer Databricks Metric Views for governed
metrics. Raw tables remain available for validation, drill-down, and cases not
yet covered by the semantic layer.

## Context Inputs

| Source | Context to extract |
|---|---|
| `distribution.yaml` | business background, analysis notes, source schemas, source tables, registered Metric Views |
| `README.md` | entity definitions, grains, channel cleaning, analysis scenarios |
| `metric-view-design.md` | MV1-MV5 definitions, dimensions, measures, example queries |
| Workspace notebook `MHA_achievement_analysis` | repeated joins, filters, month alignment rules, final aggregates |
| Unity Catalog metadata | table schemas, column comments, source table freshness, Metric View existence |
| Data profiling | `yearmonth` range, channel values, null rates, enum dimensions, POC/M1 cardinality |

## Metric View Certification Targets

| Status | Metric View | Grain | Primary questions |
|---|---|---|---|
| Target | `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics` | POC x Group x SKU Key x Month | unachieved POC groups, M2/M3 team ranking, gap drill-down |
| Target | `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics` | POC x Month | M1 monthly achievement, remaining POCs, near-achievement POCs |
| Target | `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics` | Employee x Month | KPI725 benchmark, scan-vs-KPI reconciliation |
| Candidate | `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_bees_coverage_metrics` | POC x SKU x Month | BEES coverage and later fraud/profile cases |
| Candidate | `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kbd_coverage_metrics` | POC x SKU x Month | KBD coverage and later profile cases |

The first v0.3.5 slice should certify MV1-MV3. MV4-MV5 can stay candidate until
their downstream scenarios become stable release candidates.

## Business Terms

| User term | Metric View term | Notes |
|---|---|---|
| 达成率 / achievement rate / completion rate | `POC Achievement Rate`, `SKU Achievement Rate`, `KPI Achievement Rate` | Choose the measure by grain: POC summary, SKU detail, or KPI benchmark. |
| 还差几家店 / remaining POCs | `Not Achieved POC Count` | Prefer MV2 for POC-level answer. |
| 哪些店没达成 / unachieved POCs | `Is Achieved`, `POC ID`, `POC Name`, `Group Code` | Use MV2 to find POCs, then MV1 for group detail. |
| 片区 / team / M2 scope | `M2 No`, `M2 Name`, `Territory` | Requires org hierarchy join and user context. |
| KPI 系统不一致 / KPI mismatch | `KPI-vs-Scan Difference` | Prefer MV3 and keep direct SQL as validation oracle. |

## Validation Requirements

Each certified Metric View needs:

- source table schema inspection
- representative Metric View query using `MEASURE()`
- direct SQL query over source tables
- exact tolerance for count fields
- rate tolerance of `0.01` unless the analyst specifies stricter rounding
- validation note for channel cleaning and `yearmonth` alignment

Example MV2 validation shape:

```sql
SELECT
  `M1 No`,
  MEASURE(`Total POC Count`) AS total_poc,
  MEASURE(`Achieved POC Count`) AS achieved_poc,
  MEASURE(`Not Achieved POC Count`) AS not_achieved_poc,
  MEASURE(`POC Achievement Rate`) AS achievement_rate
FROM brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics
WHERE `Year Month` = 202604
  AND `M1 No` = '28036110'
GROUP BY ALL
```

Direct SQL should compute the same fields from
`m1_scan_distribution_achievement_summary` with the same `yearmonth`, `m1_no`,
channel cleaning, and `T2WS` exclusion assumptions.

## Analysis Runtime Policy

For Distribution:

1. Use Metric Views first for aggregate, KPI, ranking, trend, and comparison
   questions.
2. Use raw tables for row-level evidence, source-data debugging, and validation.
3. If a registered Metric View is missing or stale, state that the certified
   semantic layer was unavailable and use the direct SQL path visibly.
4. Never use a raw-table query to redefine a metric differently from the
   Metric View without calling that out as a metric-definition conflict.
5. Treat user context and org chart filters as analysis scope for v0.4 demos,
   not as production security. Production permission enforcement remains v0.5.

## v0.4 Handoff

Golden Analysis Cases should reference these Metric Views for their happy path:

| Golden case | Metric View path | Direct SQL oracle |
|---|---|---|
| `distribution_a1_m1_achievement` | MV2 by `Year Month`, `M1 No` | summary table aggregation |
| `distribution_a5_m1_unachieved_pocs` | MV2 for POC list, MV1 for Group detail | summary/detail table aggregation |
| `distribution_a2_m2_team_ranking` | MV1/MV2 with M2 dimensions | org join plus direct aggregation |
| `distribution_b3_near_achievement` | MV1 grouped by POC and Group | detail table gap query |
| `distribution_f3_kpi_scan_reconcile` | MV3 | KPI725 table plus scan summary |
