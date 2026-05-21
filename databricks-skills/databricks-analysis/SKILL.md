---
name: databricks-analysis
description: >-
  Read-only Databricks data analysis and exploration. Use for data discovery
  (catalogs, schemas, tables), efficient SQL on SQL warehouses, system-table
  introspection (lineage, audit, billing, query history), metric-view-first
  consumption, federated and volume reads, statistical profiling, and
  well-cited Markdown reporting. Never writes, creates, or alters resources.
---

# Databricks Data Analysis & Exploration

Read-only data analysis on Databricks: **plan → semantic layer → profile → query → report**.

This skill is intended to be the only skill enabled for an analysis agent. It assumes a small read-only tool surface: `execute_sql`, `execute_sql_multi`, `get_table_schema`, `get_table_stats`, `list_compute`, and identity/warehouse discovery helpers when available. It does **not** assume access to skill-gated tools such as `manage_uc_objects`, `manage_dashboard`, `manage_pipeline`, `manage_jobs`, `execute_code`, or write-capable project-file tools. Do data discovery via SQL (`SHOW`, `DESCRIBE`, `system.information_schema.*`).

## Workflow

1. **Plan** — state the question, time window, candidate Metric Views, and candidate input tables before running SQL.
2. **Semantic layer first** — for KPI, aggregate, ranking, trend, comparison, and reusable business-metric questions, inspect configured Metric Views before raw input tables. Verify available dimensions/measures with `DESCRIBE EXTENDED` or `get_table_schema`.
3. **Profile only what is needed** — profile input tables only when the Metric View path is missing, insufficient, or needs validation/drill-down. Use row count, distincts, nulls, ranges, and top values; use `APPROX_COUNT_DISTINCT` / `APPROX_PERCENTILE` on large tables.
4. **Query** — query Metric Views with explicit dimensions and `MEASURE(...)` before using raw input tables when the Metric View covers the requested grain and filters. For raw-table exploration, write efficient SQL with explicit columns, filtered early, with `LIMIT` during exploration.
5. **Validate or drill down** *(optional)* — use input tables for validation, row-level details, source-data debugging, or unsupported grains. State the fallback reason visibly before relying on raw-table SQL for a KPI-style question.
6. **Report** — synthesize into a Markdown answer with sources, time window, caveats, assumptions, and whether the answer used a Metric View or an input-table fallback.

## Read-Only Constraints

This agent does **not** modify state. Refuse and explain when asked to run any of:

- DDL: `CREATE`, `DROP`, `ALTER`, `RENAME`, `TRUNCATE`, `REPLACE`
- DML: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY INTO`
- Maintenance: `OPTIMIZE`, `VACUUM`, `ANALYZE TABLE`, `REORG`, `RESTORE`
- Permissions: `GRANT`, `REVOKE`, `SET OWNER`
- Compute / catalog mutations: `manage_cluster` (start/create/delete), `manage_sql_warehouse` (create/delete), warehouse/cluster lifecycle changes

`CREATE OR REPLACE TEMPORARY VIEW` is also discouraged — prefer CTEs for readability. If you genuinely need a temp view for a multi-step session, ask the user first.

If a write is essential to answer the question, surface that in the conclusion as a recommendation for a separate writer/builder agent — do not perform it yourself.

## Essential MCP Tools

| Tool | Purpose |
|------|---------|
| `execute_sql` | Primary tool. Run a single SQL statement on a SQL warehouse. |
| `execute_sql_multi` | Multiple statements in one call (e.g. inspect + query). |
| `get_table_schema` | Schema-only inspection for configured tables and Metric Views. Use this first for column discovery and type validation. |
| `get_table_stats` | Selected-column profiling for one table. Requires an explicit non-empty `columns` list; use only after schema discovery and only for columns needed by the current decision. |
| `list_compute` | Discover available SQL warehouses and clusters; pick the running one. |
| `get_current_user` | Confirm the active workspace identity when a result looks unexpected. |

**Compute selection.** Prefer a configured SQL warehouse when one exists. In the Builder App runtime, `execute_sql`, `get_table_schema`, and `get_table_stats` can fall back to the configured cluster when no warehouse is configured. Never start, resize, or create compute — ask the user instead.

**Metric View tooling.** This read-only skill does not require `manage_metric_views`. Query Metric Views through `execute_sql` using `MEASURE(...)`. If a `manage_metric_views` tool is exposed by a broader runtime, use only read-oriented `describe` or `query` actions; do not create, alter, drop, grant, or otherwise mutate Metric Views.

### Progressive profiling rule

Separate schema discovery from statistics:

- Start with `get_table_schema` for schema discovery and column-name / type validation.
- Call `get_table_stats` only when the next decision needs actual statistics such as row counts, distincts, nulls, ranges, samples, or value frequencies.
- Always pass a narrow `columns` list to `get_table_stats`. Do not request every column unless the user explicitly asks for a full profile.

If the task needs only one or two simple aggregate checks, direct SQL with `COUNT`, `APPROX_COUNT_DISTINCT`, `APPROX_PERCENTILE`, or `APPROX_TOP_K` over explicit columns is also acceptable.

## Discovery Without `manage_uc_objects`

Since UC management tools are likely disabled for the analysis agent, use SQL:

```sql
-- Hierarchy
SHOW CATALOGS;
SHOW SCHEMAS IN main;
SHOW TABLES IN main.sales;
SHOW VIEWS IN main.sales;

-- Schema and properties
DESCRIBE EXTENDED main.sales.fact_orders;       -- columns + storage info + properties
SHOW COLUMNS IN main.sales.fact_orders;
SHOW PARTITIONS main.sales.fact_orders;          -- partitioned tables only
SHOW TBLPROPERTIES main.sales.fact_orders;

-- Cross-catalog metadata search via information_schema
SELECT table_catalog, table_schema, table_name
FROM main.information_schema.tables
WHERE table_name ILIKE '%order%';

SELECT table_schema, table_name, column_name, data_type, comment
FROM main.information_schema.columns
WHERE column_name ILIKE '%email%';
```

`information_schema` is **per-catalog** — query it inside the catalog you care about. For workspace-wide metadata, the system catalog (`system.access.*`, `system.query.history`) is usually a better source.

For schema-only discovery, use `get_table_schema(catalog, schema, table_names=[...])`. For profiling, use `get_table_stats(catalog, schema, table_name="...", columns=[...])` only for the explicit columns needed by the current decision.

When project context lists both `input_metric_views` and `input_tables`, treat the Metric Views as the governed semantic layer and input tables as source/fallback assets. Do not call input tables "preferred" tables, and do not inspect them first for KPI-style questions unless no Metric View is registered or the Metric View clearly lacks the requested grain, filters, or measures.

## SQL Patterns for Analysis

- **Always use fully-qualified names**: `catalog.schema.table`.
- **Metric View first for business metrics**: for KPI, aggregate, ranking, trend, and comparison questions, start from a registered Metric View when it covers the requested grain and filters. Do not re-implement certified measures from raw columns.
- **Filter early, aggregate late** — push `WHERE` close to the source.
- **Avoid `SELECT *`** — explicit columns reduce I/O and prevent breakage on schema drift.
- **`LIMIT` during exploration** (default 100–1000); remove only when small samples are insufficient.
- **Date math without `INTERVAL`** in serverless contexts:
  - Last 30 days: `WHERE order_date >= date_sub(current_date(), 30)`
  - Last 6 months: `WHERE order_date >= add_months(current_date(), -6)`
  - Truncate to month: `DATE_TRUNC('MONTH', order_date)`
- **Deterministic queries cache better.** Avoid `NOW()` / `RAND()` in cached lookups; use `current_date()` when day-precision is enough.
- **Approximate functions on large data**: `APPROX_COUNT_DISTINCT(col)`, `APPROX_PERCENTILE(col, 0.95)`, `APPROX_TOP_K(col, 10)`.
- **`QUALIFY`** filters window-function results without subqueries:

  ```sql
  SELECT customer_id, order_date, amount,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
  FROM main.sales.fact_orders
  QUALIFY rn = 1;        -- latest order per customer
  ```

- **Pipe syntax** (`|>`, DBR 16.1+) for readable multi-step transforms:

  ```sql
  FROM main.sales.fact_orders
    |> WHERE order_date >= date_sub(current_date(), 30)
    |> AGGREGATE SUM(amount) AS total, COUNT(*) AS cnt GROUP BY region
    |> WHERE total > 10000
    |> ORDER BY total DESC
    |> LIMIT 20;
  ```

- **Recursive CTEs** (DBR 17.0+) for hierarchies — always include a `depth` safety limit:

  ```sql
  WITH RECURSIVE org AS (
    SELECT employee_id, name, manager_id, 0 AS depth
    FROM main.hr.employees WHERE manager_id IS NULL
    UNION ALL
    SELECT e.employee_id, e.name, e.manager_id, o.depth + 1
    FROM main.hr.employees e JOIN org o ON e.manager_id = o.employee_id
    WHERE o.depth < 10
  )
  SELECT * FROM org;
  ```

## Profiling Patterns

```sql
-- Single-pass column health: row count, nulls, distincts, ranges, percentiles
SELECT
  COUNT(*)                                 AS row_count,
  COUNT(customer_id)                       AS non_null_customers,
  APPROX_COUNT_DISTINCT(customer_id)       AS distinct_customers,
  COUNT(*) - COUNT(amount)                 AS null_amount_rows,
  MIN(order_date)                          AS min_date,
  MAX(order_date)                          AS max_date,
  APPROX_PERCENTILE(amount, ARRAY(0.5, 0.9, 0.99)) AS amt_p50_p90_p99
FROM main.sales.fact_orders;

-- Cardinality check before charting (≤8 categories ideal for color/grouping)
SELECT region, COUNT(*) AS n
FROM main.sales.fact_orders
GROUP BY region ORDER BY n DESC LIMIT 20;

-- Detect skew / outliers via histograms
SELECT WIDTH_BUCKET(amount, 0, 1000, 10) AS bucket, COUNT(*) AS n
FROM main.sales.fact_orders
WHERE amount BETWEEN 0 AND 1000
GROUP BY bucket ORDER BY bucket;
```

## System Tables — Governance, Lineage, Audit, Billing

System tables can be huge — **always filter by date** (`event_date`, `usage_date`, `start_time`).

```sql
-- Upstream / downstream lineage
SELECT source_table_full_name, source_column_name, target_column_name
FROM system.access.table_lineage
WHERE target_table_full_name = 'main.sales.fact_orders'
  AND event_date >= date_sub(current_date(), 7);

-- Recent permission changes
SELECT event_time, user_identity.email, action_name, request_params
FROM system.access.audit
WHERE event_date >= date_sub(current_date(), 7)
  AND (action_name LIKE '%GRANT%' OR action_name LIKE '%REVOKE%')
ORDER BY event_time DESC LIMIT 200;

-- DBU usage by SKU last 30 days
SELECT sku_name, SUM(usage_quantity) AS dbus
FROM system.billing.usage
WHERE usage_date >= date_sub(current_date(), 30)
GROUP BY sku_name ORDER BY dbus DESC;

-- Slowest queries last 24h
SELECT statement_text, total_duration_ms, executed_by, statement_id
FROM system.query.history
WHERE start_time >= current_timestamp() - INTERVAL 24 HOURS
ORDER BY total_duration_ms DESC LIMIT 50;
```

Useful schemas to know: `system.access.*` (audit, lineage, column lineage), `system.billing.*` (usage, list_prices), `system.compute.*` (clusters, warehouses), `system.query.history`, `system.lakeflow.*` (jobs, pipelines).

## Metric Views — Query First, Don't Create

Metric views (Unity Catalog YAML metric definitions) are queried with `MEASURE()` and explicit columns — **`SELECT *` is not supported**.

Use Metric Views first for:

- KPI or achievement-rate questions
- Period trends, rankings, benchmarks, and comparisons
- Governed totals, ratios, rates, averages, and distinct-count metrics
- Questions that map to measures/dimensions listed in project context

Use input tables instead only for:

- row-level drill-down
- source-data debugging and validation
- freshness, null-density, or reconciliation checks
- questions whose grain, filters, or measures are not covered by a Metric View

If a relevant Metric View is `candidate`, `stale`, or not yet certified, still inspect/query it when it appears to cover the question, then disclose the status and validate or fall back as needed. Do not silently skip to raw input tables.

```sql
-- Inspect a metric view's dimensions/measures
DESCRIBE EXTENDED main.sales.orders_metrics;

-- Query measures by dimensions
SELECT `Order Month`,
       MEASURE(`Total Revenue`) AS revenue,
       MEASURE(`Order Count`) AS orders
FROM main.sales.orders_metrics
WHERE `Order Month` >= add_months(current_date(), -12)
GROUP BY ALL ORDER BY ALL;
```

Dimension/measure names with spaces require backticks. Metric Views are the canonical place to read business KPIs — use them before raw-table SQL when one exists.

For a Metric View query, the pattern is:

1. Select explicit dimensions.
2. Select measures with `MEASURE(\`Measure Name\`)`.
3. Apply filters to dimensions, not to measure aliases.
4. Use `GROUP BY ALL` or group by every selected dimension.
5. Order and limit after aggregation.

If the Metric View query fails or does not support the requested question, report the failure/fallback reason and then use input tables.

## File and Federated Reads

```sql
-- Read raw files from a Volume directly — no table needed
SELECT *
FROM read_files(
  '/Volumes/main/landing/events/',
  format => 'json',
  schemaHints => 'event_id STRING, ts TIMESTAMP, payload MAP<STRING,STRING>',
  pathGlobFilter => '*.json',
  recursiveFileLookup => true
)
LIMIT 100;

-- Federated query into Postgres / MySQL / Snowflake via Lakehouse Federation
SELECT *
FROM remote_query(
  'my_postgres_connection',
  database => 'analytics',
  query    => 'SELECT customer_id, email, created_at FROM customers WHERE active = true'
)
LIMIT 100;
```

`read_files` requires no ingestion plan — perfect for ad-hoc exploration of new data drops in volumes. `remote_query` lets you cross-check Databricks data against an OLTP source without copying it.

## Reporting Conventions

A good analysis answer always:

1. **Leads with the result** — one or two sentences before any table.
2. **Uses Markdown tables** for ranked lists, distributions, period comparisons; right-align numeric columns with `---:`.
3. **Cites sources** — fully-qualified table names and the time window analyzed.
4. **States the metric path** — Metric View used, or why an input-table fallback was necessary.
5. **Lists assumptions and caveats** — nulls excluded, definition of the metric, sample vs. full, time zone, refresh recency.
6. **Flags data-quality issues** observed (high null rate, suspicious outliers, partition drift) instead of silently filtering them.
7. **Distinguishes measured results from recommendations** — keep a "What this means" or "Suggested next steps" section if helpful.

Skeleton:

```markdown
## Top regions by revenue (last 30 days)

| Region | Revenue (USD) | Orders | Avg Order |
|---|---:|---:|---:|
| NA-East | 12.4M | 84,201 | 147.20 |
| EMEA    | 8.1M  | 56,440 | 143.50 |

**Source:** `main.sales.fact_orders` joined with `main.sales.dim_region`, filtered to `order_date >= 2026-04-08`.
**Caveats:** 312 orders excluded (NULL `region`); 2 orders >$10M flagged `status='refund_pending'` and excluded.
**Notes:** Revenue is `SUM(amount)` in posted currency, not deflated.
```

## Common Anti-Patterns

- ❌ Querying without `LIMIT` on first inspection → unbounded result sets, wasted DBUs.
- ❌ `SELECT *` on wide / large tables → unnecessary I/O.
- ❌ `WHERE date_col >= NOW() - INTERVAL ...` for cached dashboards → not cacheable; prefer `date_sub(current_date(), N)`.
- ❌ Filtering on `ARRAY` / `MAP` columns → no data skipping; explode or extract scalar columns first.
- ❌ Self-joins to compute "previous row" → use `LAG()` / `LEAD()` + `QUALIFY`.
- ❌ Reading `system.access.*` / `system.billing.*` / `system.query.history` without a date filter → scans years.
- ❌ Inferring column names from business language → run `DESCRIBE` first.
- ❌ Re-implementing a governed KPI from raw input tables before checking registered Metric Views → inspect/query the Metric View first.
- ❌ Calling input tables "preferred" tables → they are source/fallback assets unless the project explicitly says no Metric View covers the question.
- ❌ Running any DDL / DML / maintenance / permission statement → out of scope; refuse and escalate.
- ❌ Calling `manage_cluster` / `manage_sql_warehouse` lifecycle actions to "speed things up" → costly, irreversible from the user's perspective; ask first.

## Resources

- [Databricks SQL](https://docs.databricks.com/aws/en/sql/)
- [System Tables](https://docs.databricks.com/administration-guide/system-tables/)
- [Metric Views](https://docs.databricks.com/en/metric-views/)
- [`read_files`](https://docs.databricks.com/aws/en/sql/language-manual/functions/read_files), [`remote_query`](https://docs.databricks.com/aws/en/query-federation/)
