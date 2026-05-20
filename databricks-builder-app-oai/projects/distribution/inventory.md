# Distribution Asset Inventory

Date: 2026-05-20

This inventory records the configured assets for the v0.3.5 Distribution
onboarding slice. It intentionally separates registered assets from validation
status; candidate Metric Views are not certified until `readiness.md` records
direct SQL reconciliation.

## Project Setting Source

- `distribution.yaml`

## Workspace Code

| Asset | Purpose | Status |
|---|---|---|
| `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution` | Scenario workspace folder | Registered; access not validated in this artifact |
| `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/MHA_achievement_analysis` | Notebook/source for achievement logic and filters | Registered; access not validated in this artifact |

## Schemas

| Schema | Purpose | Status |
|---|---|---|
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw` | Distribution achievement, scan, BEES, and KBD source tables plus target Metric Views | Registered |
| `techsales_uc_china_prod.techsales_db` | Visit-base and related source references | Registered |
| `brewdat_uc_china_prod.bcc_dmdsrintegrationproject_ods` | SKU mapping source | Registered |

## Source Tables

| Table | Role In Scenario | Requirements |
|---|---|---|
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_detail` | POC x Group x SKU achievement detail | A5, A2, B3 |
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_distribution_achievement_summary` | POC-level achievement summary and MV2 oracle | A1, A5, A2, F3 |
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_scan_detail` | Scan-side detail for validation and later drill-down | F3, future fraud/profile |
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_bees_distribution_detail` | BEES coverage candidate source | Deferred MV4 |
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_scan_kbd_detail` | KBD coverage candidate source | Deferred MV5 |
| `brewdat_uc_china_prod.bcc_dmdsrintegrationproject_ods.report_import_mapping_sku` | SKU mapping and metadata | A5, deferred profile cases |
| `brewdat_uc_china_prod.md_exchange_brewdat_ods.tsvc_base_sys_kpiachieverate` | KPI725 target/actual source | F3 |
| `brewdat_uc_china_prod.org_datahub_dw.employee_relation_m1m2m3_monthly` | M1/M2/M3 org-scope derivation | A2 |
| `brewdat_uc_china_prod.poc_datahub_dw.poc_master_daily_fact` | POC metadata and geographic/format enrichment | A1, A5 |

## Metric Views

| Metric View | Status | Grain | Certification Target |
|---|---|---|---|
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_achievement_detail_metrics` | Candidate | POC x Group x SKU Key x Month | v0.3.5 MV1 |
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_poc_achievement_metrics` | Candidate | POC x Month | v0.3.5 MV2 |
| `brewdat_uc_china_prod.gld_apc_sales_m1_scan_dw.m1_kpi725_benchmark_metrics` | Candidate | Employee x Month | v0.3.5 MV3 |

## Volumes

No input volume paths are declared. Add volume paths only if onboarding finds
required file evidence, notebook exports, PDFs, CSVs, or image assets.

