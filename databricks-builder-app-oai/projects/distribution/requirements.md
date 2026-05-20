# Distribution Scenario Requirements

Date: 2026-05-20

This matrix is the v0.3.5 scenario-onboarding contract for the first
Distribution semantic-layer slice. It is derived from `distribution.yaml`,
`README.md`, `metric-view-design.md`, and the `MHA_achievement_analysis`
workspace notebook reference. Live Databricks validation is tracked in
`readiness.md`.

| Requirement ID | Question Family | Grain | Measures | Dimensions / Filters | Required Assets | Priority |
|---|---|---|---|---|---|---|
| `distribution_a1_m1_achievement` | M1 monthly achievement summary: achievement rate, achieved POCs, remaining POCs | M1 x Month | Total POC Count, Achieved POC Count, Not Achieved POC Count, POC Achievement Rate | Year Month, M1 No; exclude T2WS; align KPI month and achievement month | MV2 `m1_poc_achievement_metrics`; summary table direct SQL oracle | P0 |
| `distribution_a5_m1_unachieved_pocs` | Unachieved POCs and group/SKU gaps for one M1 | POC x Group x Month | Achieved SKU Count, Total SKU Count, SKU Achievement Rate, Total POC-Group Count | Year Month, M1 No, POC ID, Group Code; exclude T2WS | MV2 for POC list, MV1 `m1_achievement_detail_metrics` for group drill-down; detail table oracle | P0 |
| `distribution_a2_m2_team_ranking` | M2 team ranking by achievement rate | M1 x Month within M2 scope | POC Achievement Rate, Total POC Count, Achieved POC Count | Year Month, M2 No or user_context employee scope; relation_month equals Year Month | MV1/MV2 plus `employee_relation_m1m2m3_monthly` | P0 |
| `distribution_b3_near_achievement` | POCs close to achievement, such as one group away | POC x Group x Month | Remaining group count, Achieved SKU Count, Total SKU Count, SKU Achievement Rate | Year Month, M1 or M2 scope, POC ID, Group Code | MV1 plus detail table oracle | P1 |
| `distribution_f3_kpi_scan_reconcile` | KPI725 actuals versus scan-side achieved POCs | Employee x Month | Total Target Value, Total Actual Value, KPI Achievement Rate, Scan Side Achieved POC Count, KPI-vs-Scan Difference | Year Month, Employee Code, KPI725 only; open-month NULL caveat | MV3 `m1_kpi725_benchmark_metrics`; KPI725 table and summary table oracle | P0 |

## Answer Contracts

| Requirement ID | Answer Contract |
|---|---|
| `distribution_a1_m1_achievement` | Return the month, M1 identifier, total POCs, achieved POCs, remaining POCs, achievement rate, caveats, and one action-oriented next step. |
| `distribution_a5_m1_unachieved_pocs` | Return a bounded POC list, group-level gaps for each POC when available, and a visible note when group detail falls back to direct SQL. |
| `distribution_a2_m2_team_ranking` | Return the lowest-performing M1s in scope, the scope derivation used, and a caveat that v0.4 user context is not production row-level security. |
| `distribution_b3_near_achievement` | Return POCs with the smallest remaining gaps, grouped by POC and group, sorted by action priority. |
| `distribution_f3_kpi_scan_reconcile` | Return KPI actual, scan-side achieved count, difference, affected employee/month, and likely data-quality caveats. |

