# Distribution Readiness Summary

Date: 2026-05-20

Status: partially ready.

The Distribution seed is ready for candidate Metric View routing and v0.4
golden-case drafting. It is not ready to certify answers as governed semantic
answers until MV1-MV3 are queried and reconciled with direct SQL.

## Ready

- `distribution.yaml` registers MV1-MV3 in `databricks_resources.input_metric_views`.
- `distribution.yaml` includes a compact `metric_view_context` with status,
  grain, measures, dimensions, source objects, business terms, and validation
  references.
- `requirements.md` defines P0/P1 analysis requirements with grain, measures,
  dimensions, filters, required assets, and answer contracts.
- `inventory.md` lists source tables, workspace code, Metric Views, schemas,
  and volume status.
- `gap-analysis.md` identifies blockers and deferred areas.

## Blockers Before Certification

| Blocker | Blocks | Resolution |
|---|---|---|
| MV1-MV3 have candidate status | Certified semantic-layer runtime path | Query each Metric View with explicit dimensions and `MEASURE()` |
| Direct SQL reconciliation not recorded | Validation gate and v0.4 golden-case data fidelity | Run source-table oracle SQL and compare counts exactly, rates within 0.01 |
| No checked timestamp in validation metadata | Staleness assessment | Update `metric_view_context.metric_views[].validation.checked_at` after validation |
| Warehouse ID is null | DBSQL-aligned validation | Add `databricks_resources.warehouse_id` when a SQL warehouse is available |

## Handoff Notes

- KPI, aggregate, ranking, trend, and comparison questions should attempt the
  registered Metric View path first.
- Because status is `candidate`, runtime answers should disclose that the
  Metric View is not yet certified when direct validation has not been run.
- Raw tables remain the approved path for validation, row-level drill-down,
  unsupported grains, and source-data debugging.
- v0.4 golden cases may reference MV1-MV3 for the happy path only after the
  certification blockers are closed or explicitly accepted as partial.

