# Databricks skills

The 26 skills bundled in this repo under [`databricks-skills/`](../../databricks-skills/). Source for each skill's content is its own `SKILL.md` — what follows is a detailed reference for what's installed, what supporting files come with it, and which `databricks-tools-core` / MCP module it pairs with.

## At a glance

| Skill | Profile(s) | Pairs with MCP tool(s) | Pairs with core module |
|-------|-----------|------------------------|-------------------------|
| `databricks-config` | core | `manage_workspace` | `auth.py` |
| `databricks-docs` | core | — | — |
| `databricks-python-sdk` | core | — | (the SDK itself) |
| `databricks-unity-catalog` | core | (system tables via `execute_sql`), `manage_volume_files` | `unity_catalog/` |
| `databricks-spark-declarative-pipelines` | data-engineer | `manage_pipeline`, `manage_pipeline_run` | `spark_declarative_pipelines/` |
| `databricks-spark-structured-streaming` | data-engineer | (uses `execute_code`) | `compute/` |
| `databricks-jobs` | data-engineer, ai-ml-engineer, app-developer | `manage_jobs`, `manage_job_runs` | `jobs/` |
| `databricks-bundles` | data-engineer, app-developer | (CLI workflow, no MCP tool) | — |
| `databricks-dbsql` | data-engineer, analyst, app-developer | `execute_sql`, `execute_sql_multi`, `manage_warehouse` | `sql/` |
| `databricks-iceberg` | data-engineer | (DDL via `execute_sql`) | — |
| `databricks-zerobus-ingest` | data-engineer | (client SDK; outside MCP) | — |
| `spark-python-data-source` | data-engineer | (uses `execute_code`) | `compute/` |
| `databricks-metric-views` | data-engineer, analyst | `manage_metric_views` | `unity_catalog/metric_views.py` |
| `databricks-synthetic-data-gen` | data-engineer, ai-ml-engineer | (uses `execute_code`) | `compute/` |
| `databricks-aibi-dashboards` | analyst | `manage_dashboard` | `aibi_dashboards/` |
| `databricks-genie` | analyst, ai-ml-engineer | `manage_genie`, `ask_genie` | `agent_bricks/` (Genie part) |
| `databricks-agent-bricks` | ai-ml-engineer | `manage_ka`, `manage_mas` | `agent_bricks/` (KA/MAS) |
| `databricks-ai-functions` | ai-ml-engineer | (`execute_sql` for SQL paths) | — |
| `databricks-vector-search` | ai-ml-engineer | `manage_vs_endpoint`, `manage_vs_index`, `query_vs_index`, `manage_vs_data` | `vector_search/` |
| `databricks-model-serving` | ai-ml-engineer, app-developer | `manage_serving_endpoint` | `serving/` |
| `databricks-unstructured-pdf-generation` | ai-ml-engineer | `generate_and_upload_pdf` | `pdf/` |
| `databricks-mlflow-evaluation` | ai-ml-engineer | (use MLflow via `execute_code`) | — |
| `databricks-execution-compute` | (not in any profile) | `execute_code`, `manage_cluster`, `manage_sql_warehouse`, `list_compute` | `compute/` |
| `databricks-app-python` | app-developer | `manage_app` | `apps/` |
| `databricks-lakebase-autoscale` | app-developer | `manage_lakebase_database`, `manage_lakebase_branch`, `generate_lakebase_credential` | `lakebase_autoscale/` |
| `databricks-lakebase-provisioned` | app-developer | `manage_lakebase_database`, `manage_lakebase_sync`, `generate_lakebase_credential` | `lakebase/` |

> `databricks-execution-compute` is registered and shipped, but is not in any persona profile in `install.sh`. It is included by `--skills-profile all` and by explicit `--skills databricks-execution-compute`.

---

## Foundation / cross-cutting

### `databricks-config`

Workspace authentication and switching. Trigger phrases: *"switch workspace"*, *"which workspace am I on"*, *"add a profile"*, *"login to databricks"*.

Pairs directly with the MCP `manage_workspace` tool — the skill teaches the agent when to switch and how to interpret `~/.databrickscfg` profiles. Must be installed *before* any other skill that calls workspace APIs makes sense.

### `databricks-docs`

Fallback documentation reference. The skill teaches the agent to consult `https://docs.databricks.com/llms.txt` when no other skill matches. Functionally a *router of last resort* — keep it installed even when shipping a narrow profile, otherwise off-the-path questions get a generic answer.

### `databricks-python-sdk`

Reference for `databricks-sdk-py`, Databricks Connect, the CLI, and the REST API.

Supporting files (5 examples + index):

- `doc-index.md` — section index
- `examples/1-authentication.py`
- `examples/2-clusters-and-jobs.py`
- `examples/3-sql-and-warehouses.py`
- `examples/4-unity-catalog.py`
- `examples/5-serving-and-vector-search.py`

Most other Databricks skills implicitly depend on this one — they show snippets in the same SDK style. Don't drop it from a profile lightly.

### `databricks-unity-catalog`

System-tables-focused. Use cases: lineage, audit, billing queries, plus volume file ops.

Supporting file: `5-system-tables.md`.

Pairs with `manage_volume_files` and `execute_sql` against `system.*`. Note that UC namespace operations (catalog/schema/table CRUD, grants, monitors, tags, sharing) are **not** the focus of this skill — they're covered implicitly by the matching MCP `manage_uc_*` tools whose docstrings are themselves substantial.

---

## Data engineering

### `databricks-spark-declarative-pipelines`

Lakeflow SDP / DLT. The single most-detailed skill in the kit; covers ingestion, streaming, CDC, SCD2, performance tuning, the Python API, DLT migration, and project initialisation.

Supporting files:

```
1-ingestion-patterns.md           5-python-api.md
2-streaming-patterns.md           6-dlt-migration.md
3-scd-patterns.md                 7-advanced-configuration.md
4-performance-tuning.md           8-project-initialization.md
```

Pairs with `manage_pipeline` / `manage_pipeline_run` and with `databricks_tools_core.spark_declarative_pipelines`.

### `databricks-spark-structured-streaming`

Streaming patterns for production: Kafka, Real-Time Mode, triggers, joins, checkpointing.

Supporting files:

```
checkpoint-best-practices.md      stateful-operations.md
kafka-streaming.md                stream-static-joins.md
merge-operations.md               stream-stream-joins.md
multi-sink-writes.md              streaming-best-practices.md
trigger-and-cost-optimization.md
```

No dedicated MCP tool — code runs via `execute_code` (serverless or cluster).

### `databricks-jobs`

Lakeflow Jobs orchestration. Aggressive trigger description: *"Use this skill proactively for ANY Databricks Jobs task"*.

Supporting files: `task-types.md`, `triggers-schedules.md`, `notifications-monitoring.md`, `examples.md`.

Pairs with `manage_jobs` / `manage_job_runs`. The MCP tool's docstring cross-references this skill for task configuration.

### `databricks-bundles`

Databricks Asset Bundles — the IaC/CI/CD path.

Supporting files: `alerts_guidance.md`, `SDP_guidance.md`.

No MCP tool — bundle deploys are CLI-driven (`databricks bundle deploy`). The agent runs `databricks` via `Bash`. Pair with `databricks-spark-declarative-pipelines` if shipping SDP via DABs.

### `databricks-dbsql`

Databricks SQL warehouse features: SQL scripting, stored procedures, materialized views, geospatial (`H3`, `ST_*`), collation, AI functions in SQL, `http_request` / `remote_query` / `read_files`, Lakehouse Federation.

Pairs with `execute_sql` / `execute_sql_multi` / `manage_warehouse`.

### `databricks-iceberg`

Apache Iceberg on Databricks. Covers managed Iceberg, External Iceberg Reads (formerly Uniform), Iceberg REST Catalog, Iceberg v3, Snowflake interop, PyIceberg, OSS Spark.

Supporting files:

```
1-managed-iceberg-tables.md       4-snowflake-interop.md
2-uniform-and-compatibility.md    5-external-engine-interop.md
3-iceberg-rest-catalog.md
```

Mostly DDL via `execute_sql`; no dedicated tool.

### `databricks-zerobus-ingest`

gRPC ingestion clients writing directly to UC tables.

Supporting files:

```
1-setup-and-authentication.md     4-protobuf-schema.md
2-python-client.md                5-operations-and-limits.md
3-multilanguage-clients.md
```

Outside the MCP tool surface — Zerobus clients are external SDKs.

### `spark-python-data-source`

Custom Spark Python data sources (`DataSourceReader`, `DataSourceWriter`) for batch + streaming. Trigger fires for *"read from X in Spark"* / *"write DataFrame to Y"* even when no native connector exists.

No supporting files. Code runs via `execute_code`.

### `databricks-metric-views`

UC metric views — governed business KPIs in YAML.

Supporting files: `yaml-reference.md`, `patterns.md`.

Pairs with `manage_metric_views` and `databricks_tools_core.unity_catalog.metric_views`.

### `databricks-synthetic-data-gen`

Spark + Faker for realistic synthetic data. Output formats: Parquet, JSON, CSV, Delta. Serverless-friendly.

Useful in two profiles (`data-engineer` for testing pipelines, `ai-ml-engineer` for evaluation datasets). No dedicated MCP tool.

---

## Analyst / NL exploration

### `databricks-aibi-dashboards`

AI/BI (formerly Lakeview) dashboards. Carries strict pre-flight rules in its description: the agent is told to test every dashboard SQL query via `execute_sql` before deploying.

Supporting files: `widget-reference.md`, `sql-patterns.md`.

Pairs with `manage_dashboard` and `databricks_tools_core.aibi_dashboards`. The MCP tool's docstring carries an additional "widget structure rules" section that mirrors `widget-reference.md`.

### `databricks-genie`

Genie Spaces lifecycle: create, curate, query via Conversation API, plus export/import for migration between workspaces.

Supporting files: `spaces.md`, `conversation.md`.

Pairs with `manage_genie` (CRUD + export/import) and `ask_genie` (the hot-path NL query tool).

---

## AI / ML / Agents

### `databricks-agent-bricks`

Knowledge Assistants (RAG over docs in a UC volume), Genie Spaces (overlap with the `databricks-genie` skill), and Multi-Agent Supervisors (orchestration over agents/endpoints/Genie/UC functions).

Supporting files: `1-knowledge-assistants.md`, `2-supervisor-agents.md`.

Pairs with `manage_ka` and `manage_mas`. Genie content overlaps with `databricks-genie` — both skills are profile-listed in `ai-ml-engineer`.

### `databricks-ai-functions`

Built-in AI functions in SQL: `ai_classify`, `ai_extract`, `ai_summarize`, `ai_mask`, `ai_translate`, `ai_fix_grammar`, `ai_gen`, `ai_analyze_sentiment`, `ai_similarity`, `ai_parse_document`, `ai_query`, `ai_forecast`, plus custom RAG (parse → chunk → index → query).

Supporting files:

```
1-task-functions.md
2-ai-query.md
3-ai-forecast.md
4-document-processing-pipeline.md
```

Calls happen via `execute_sql`.

### `databricks-vector-search`

VS endpoints, indexes (Delta-sync vs. direct-access), filters, embeddings, end-to-end RAG.

Supporting files: `index-types.md`, `end-to-end-rag.md`.

Pairs with `manage_vs_endpoint`, `manage_vs_index`, `query_vs_index`, `manage_vs_data`.

### `databricks-model-serving`

Deploying MLflow models and AI agents to Model Serving endpoints. Covers classical ML, custom pyfunc, GenAI agents, tools integration, dev/test, logging/registration, deployment, querying, package requirements.

Supporting files (one per topic):

```
1-classical-ml.md          5-development-testing.md
2-custom-pyfunc.md         6-logging-registration.md
3-genai-agents.md          7-deployment.md
4-tools-integration.md     8-querying-endpoints.md
                           9-package-requirements.md
```

Pairs with `manage_serving_endpoint`. Endpoint *creation* is intentionally not in the MCP tool — the skill walks the agent through the right `mlflow.deployments` calls executed via `execute_code`.

### `databricks-unstructured-pdf-generation`

Generate synthetic PDFs from HTML, drop them in a UC Volume, use them as a RAG corpus.

Pairs with `generate_and_upload_pdf` and `databricks_tools_core.pdf`.

### `databricks-mlflow-evaluation`

Databricks-flavoured wrapper around MLflow GenAI evaluation. Built-in scorers (Guidelines, Correctness, Safety, RetrievalGroundedness), `@scorer` functions, evaluation patterns, dataset patterns.

Supporting files (under `references/`):

```
references/CRITICAL-interfaces.md
references/GOTCHAS.md
references/patterns-context-optimization.md
references/patterns-datasets.md
references/patterns-evaluation.md
references/patterns-scorers.md
references/patterns-trace-analysis.md
references/user-journeys.md
```

Companion to the upstream MLflow `agent-evaluation` skill (see [mlflow-skills.md](mlflow-skills.md)). The Databricks-flavoured one focuses on evaluation; the MLflow one is the broader workflow.

---

## Code execution / compute

### `databricks-execution-compute`

Run code (serverless / cluster) and manage compute (clusters, SQL warehouses, node types, Spark versions). Trigger phrase set is large: *"run code"*, *"execute"*, *"run on databricks"*, *"serverless"*, *"create cluster"*, *"resize warehouse"*, etc.

Pairs with `execute_code`, `manage_cluster`, `manage_sql_warehouse`, `list_compute`.

> Not in any persona profile by default — included via `--skills-profile all` or explicit `--skills`. Likely an oversight; if you ship a narrow profile, install this one alongside whatever else you pick.

---

## App development

### `databricks-app-python`

Python-based Databricks Apps: Dash, Streamlit, Gradio, Flask, FastAPI, Reflex. OAuth (app and user), app resources, SQL warehouse + Lakebase connection patterns.

Supporting files (largest support set):

```
1-authorization.md            5-lakebase.md
2-app-resources.md            6-mcp-approach.md
3-frameworks.md               examples/llm_config.py
4-deployment.md               examples/fm-minimal-chat.py
                              examples/fm-parallel-calls.py
                              examples/fm-structured-outputs.py
```

Pairs with `manage_app` and `databricks_tools_core.apps`.

### `databricks-lakebase-autoscale`

Autoscaling managed Postgres — projects, branches (copy-on-write), compute endpoints, scale-to-zero, reverse ETL.

Supporting files:

```
projects.md                   connection-patterns.md
branches.md                   reverse-etl.md
computes.md
```

Pairs with `manage_lakebase_database(type="autoscale")`, `manage_lakebase_branch`, `generate_lakebase_credential(endpoint=...)`, plus `manage_lakebase_sync` for reverse ETL.

### `databricks-lakebase-provisioned`

Provisioned Lakebase — fixed-capacity Postgres + UC catalog registration + reverse ETL.

Supporting files: `connection-patterns.md`, `reverse-etl.md`.

Pairs with `manage_lakebase_database(type="provisioned")` and `manage_lakebase_sync`.

> Two distinct Lakebase shapes share one MCP tool family (`manage_lakebase_database` etc.) via the `type=` parameter. The two skills exist so the agent can carry the right mental model — switching between them changes the meaning of "branch", "capacity", and credentials.

---

## Where the skill list lives

- Skill identifiers appear in three places: directory name in `databricks-skills/`, the `DATABRICKS_SKILLS=` variable in `install_skills.sh`, and (for installer profiles) at least one `PROFILE_*` array in `install.sh`.
- The validator `python .github/scripts/validate_skills.py` enforces the first two. There is no validator for the third — keep `install.sh` profiles in sync by hand.
- Skill descriptions and supporting-file allowlists are also hand-maintained in `install_skills.sh` (`get_skill_description`, `get_skill_extra_files`).
