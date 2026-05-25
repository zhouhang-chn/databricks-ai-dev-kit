# Distribution Semantic Gap Analysis

Date: 2026-05-25

This gap analysis compares the v0.3.5 Distribution requirements against the
registered source tables, workspace notebook, and Distribution Metric Views.

| Requirement ID | Existing Coverage | Gaps | Recommended Asset | Readiness |
|---|---|---|---|---|
| `distribution_a1_m1_achievement` | Covered for 202604 validation slice | MV2 reconciled for 202604 across 6,990 M1s; broader month certification is optional follow-up | Use validated MV2 against `m1_scan_distribution_achievement_summary`; keep direct SQL oracle for regression checks | Ready for MV2-backed drafting |
| `distribution_a5_m1_unachieved_pocs` | Covered for 202604 validation slice | MV1 and MV2 reconciled at M1/month aggregate level; POC/group drill-down remains direct-SQL oracle-backed | Use validated MV1/MV2; keep detail table as drill-down oracle | Ready for MV1/MV2-backed drafting |
| `distribution_a2_m2_team_ranking` | Partial | MV1/MV2 measures validate for 202604, but org-scope behavior and v0.4 user_context are not production security | Use MV1/MV2 with org dimensions only with explicit demo/eval caveat | Partial |
| `distribution_b3_near_achievement` | Missing | Remaining-group formula and action-priority sort need review; no certified Metric View result yet | Use MV1 candidate and validate direct SQL for remaining groups | Deferred to P1 |
| `distribution_f3_kpi_scan_reconcile` | Covered for 202604 validation slice | MV3 was recreated with an employee-month source grain and reconciled for 202604 across 7,254 employees; broader employee-level month certification is optional follow-up | Use validated MV3 against KPI725 and scan summary oracles; keep direct SQL oracle for regression checks | Ready for MV3-backed drafting |

## Cross-Cutting Gaps

| Gap | Impact | Next Action |
|---|---|---|
| MV1/MV2 validation scope is one month | Broader production certification may need more periods | Expand the reconciliation query to additional months if required by release gate |
| MV3 employee-level validation scope is one month | Broader production certification may need more periods | Expand employee-level reconciliation beyond 202604 if required by release gate |
| Direct SQL oracles exist but need regression harness integration | Reconciliation is manual | Convert `metric-views/*_validation.sql` into automated eval fixtures when v0.4 eval harness starts |
| SQL warehouse is configured but may auto-stop | First validation query can incur startup delay | Use `warehouse_id: 1af3859d87e5fce6` and allow warm-up time |
| MV4-MV5 are design-only | Fraud, coverage, and profile questions should not be treated as ready | Keep MV4-MV5 candidate/deferred until source outputs stabilize |
| No input volumes are declared | File-based evidence cannot be used | Add only when a requirement depends on files |
