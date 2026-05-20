# Distribution Semantic Gap Analysis

Date: 2026-05-20

This gap analysis compares the v0.3.5 Distribution requirements against the
registered source tables, workspace notebook, and candidate Metric Views.

| Requirement ID | Existing Coverage | Gaps | Recommended Asset | Readiness |
|---|---|---|---|---|
| `distribution_a1_m1_achievement` | Partial | MV2 is registered but not reconciled with direct SQL; validation timestamp missing | Certify MV2 against `m1_scan_distribution_achievement_summary` | Blocked until validated |
| `distribution_a5_m1_unachieved_pocs` | Partial | MV1 and MV2 handoff is documented but not validated end to end; group-level gap formula needs direct SQL oracle | Certify MV1 and MV2; keep detail table as drill-down oracle | Blocked until validated |
| `distribution_a2_m2_team_ranking` | Partial | Org join availability and month alignment need schema inspection; v0.4 user_context is not production security | Certify MV1/MV2 with org dimensions; document org-scope caveat | Partial |
| `distribution_b3_near_achievement` | Missing | Remaining-group formula and action-priority sort need review; no certified Metric View result yet | Use MV1 candidate and validate direct SQL for remaining groups | Deferred to P1 |
| `distribution_f3_kpi_scan_reconcile` | Partial | MV3 is registered but not reconciled against KPI725 and scan summary oracles; open-month NULL caveat needs runtime handling | Certify MV3 against KPI725 direct SQL and scan-side aggregation | Blocked until validated |

## Cross-Cutting Gaps

| Gap | Impact | Next Action |
|---|---|---|
| Candidate Metric Views are registered but not certified | Runtime can prefer semantic paths, but answers must disclose candidate status if direct validation is absent | Run `get_table_stats_and_schema` for MV1-MV3 and source tables, then query with `MEASURE()` |
| Direct SQL oracles are not stored as separate files yet | Reconciliation is harder to repeat | Keep validation query templates under `metric-views/` and update with final SQL after live validation |
| No SQL warehouse is configured | Validation may rely on cluster SQL execution, which is slower and less aligned with DBSQL Metric View usage | Add `warehouse_id` when available |
| MV4-MV5 are design-only | Fraud, coverage, and profile questions should not be treated as ready | Keep MV4-MV5 candidate/deferred until source outputs stabilize |
| No input volumes are declared | File-based evidence cannot be used | Add only when a requirement depends on files |

