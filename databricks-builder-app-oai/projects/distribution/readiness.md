# Distribution Readiness Summary

Date: 2026-05-25

Status: partially ready.

The Distribution seed is ready for validated MV1/MV2/MV3 routing and v0.4
golden-case drafting for achievement and KPI-vs-scan reconciliation questions.
It remains partially ready because MV4-MV5 are deferred and broader
multi-month certification can still be expanded if required.

## Ready

- `distribution.yaml` registers MV1-MV3 in `databricks_resources.input_metric_views`.
- `distribution.yaml` includes a compact `metric_view_context` with status,
  grain, measures, dimensions, source objects, business terms, and validation
  references.
- MV1 `m1_achievement_detail_metrics` and MV2
  `m1_poc_achievement_metrics` were validated on 2026-05-25 for `202604`
  across 6,990 M1s with zero direct-SQL mismatches.
- MV3 `m1_kpi725_benchmark_metrics` was recreated on 2026-05-25 with an
  employee-month source grain and validated for `202604` across 7,254
  employees with zero direct-SQL mismatches. Monthly aggregates for
  `202601`-`202604` also matched direct SQL.
- `databricks_resources.warehouse_id` is set to `1af3859d87e5fce6`
  (`Starter Warehouse`) for DBSQL-aligned validation.
- `requirements.md` defines P0/P1 analysis requirements with grain, measures,
  dimensions, filters, required assets, and answer contracts.
- `inventory.md` lists source tables, workspace code, Metric Views, schemas,
  and volume status.
- `gap-analysis.md` identifies blockers and deferred areas.

## Blockers Before Certification

| Blocker | Blocks | Resolution |
|---|---|---|
| MV1/MV2 validated on one month only | Broader production certification | Expand validation to additional months if production certification requires multi-period coverage |
| MV3 employee-level validation currently covers 202604 | Broader production certification | Expand employee-level reconciliation to additional months if production certification requires multi-period coverage |
| MV4-MV5 remain candidate | Fraud, BEES coverage, and KBD coverage golden paths | Keep deferred until downstream scenarios and source outputs stabilize |

## Handoff Notes

- Achievement, aggregate, ranking, trend, and comparison questions covered by
  MV1/MV2 can use the validated Metric View path for the 202604 validation
  slice.
- KPI-vs-scan reconciliation questions covered by MV3 can use the validated
  Metric View path for 202601-202604 monthly aggregates and the 202604
  employee-level validation slice.
- Raw tables remain the approved path for validation, row-level drill-down,
  unsupported grains, and source-data debugging.
- v0.4 golden cases may reference MV1/MV2 for achievement paths and MV3 for
  KPI-vs-scan reconciliation paths, keeping direct SQL as the eval oracle.
