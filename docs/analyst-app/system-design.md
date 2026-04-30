# Databricks Analyst App System Design

## Purpose

This document resolves the phase 0 platform decisions for `databricks-analyst-app`. It is the implementation-facing companion to [`design.md`](design.md) and [`plan.md`](plan.md).

The first implementation should optimize for a local development loop, external deployment portability, and a narrow analyst runtime. It should not be deployed as a Databricks App, and it should not depend on Databricks-native analyst product surfaces.

## Decision Summary

| Decision | Phase 0 choice | Phase 3 revisit |
|----------|----------------|-----------------|
| Target deployment | Develop locally; package frontend and backend into a Docker image deployable to VM or AKS | Add production deployment hardening and multi-environment release automation |
| Authentication | Personal access token (PAT) provided by the user/developer | Replace with user OAuth/OBO or enterprise SSO-backed token flow |
| Databricks execution compute | General-purpose Databricks cluster | Move business-query execution to SQL warehouse if product requirements justify it |
| Canonical metrics | Unity Catalog metric views | Add supplemental documentation fields only if metric views do not cover required semantics |
| Semantic retrieval | App-managed PostgreSQL with pgvector | Revisit managed vector infrastructure only if the deployment environment provides it |
| Agent runtime | Claude Agent SDK through an application-owned adapter | Revisit model/runtime abstraction once evals identify gaps |
| Claude Code subprocess | Do not run a Claude Code instance as a subprocess in the request path | Reconsider only for isolated development tools, not production serving |

## Target Deployment

Phase 0 should support three operating modes:

1. **Local development.** Developers run the backend, frontend, local database, and optional worker locally.
2. **Single-image deployment.** Frontend static assets and FastAPI backend are packaged into one Docker image for simple VM deployment.
3. **AKS deployment.** The same image runs behind Kubernetes ingress, with configuration provided through environment variables and Kubernetes secrets.

The first Docker image should be intentionally simple:

```text
Docker image
  |- FastAPI backend
  |- built React/Vite static assets
  |- analyst agent runtime
  |- Databricks SDK client
  |- migration entrypoint or one-shot migration command
```

For local development, frontend and backend can run as separate processes for faster iteration:

```text
Developer machine
  |- backend: 127.0.0.1:8000
  |- frontend dev server: 127.0.0.1:3000 or 127.0.0.1:5173
  |- PostgreSQL database with pgvector enabled
  |- optional worker process
```

For VM and AKS deployment, the backend should serve the compiled frontend unless a customer explicitly chooses a separate CDN or static hosting path.

Local development should also include a `docker compose` profile or equivalent script that starts PostgreSQL with pgvector enabled. The app image should not bundle the database process.

## Runtime Topology

```text
Browser
  |
  | HTTPS
  v
FastAPI application
  |- static frontend assets
  |- session/message APIs
  |- run streaming APIs
  |- Claude Agent SDK adapter
  |- Databricks adapters
  |- context retrieval service
  |- metric view query service
  |
  | SQL / metadata / jobs / traces
  v
Databricks workspace
  |- Unity Catalog
  |- UC metric views
  |- general-purpose cluster
  |- MLflow
  |- Jobs for offline enrichment

Application database
  |- relational app state
  |- context documents
  |- pgvector embeddings
```

Long-running background work should be split into a worker process once it becomes operationally necessary. Phase 0 can keep the worker in-process or run it as a separate local command, as long as the code path is already separable.

## Configuration

Configuration should be environment-driven so the same image can run locally, on a VM, or in AKS.

| Variable | Purpose |
|----------|---------|
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_TOKEN` | PAT for phase 0 authentication |
| `DATABRICKS_CLUSTER_ID` | General-purpose cluster used for execution |
| `APP_DATABASE_URL` | PostgreSQL-compatible application database |
| `APP_ENV` | `local`, `vm`, `aks`, or `test` |
| `APP_SECRET_KEY` | Session/signing secret |
| `ANTHROPIC_API_KEY` | Claude Agent SDK provider credential |
| `CLAUDE_AGENT_MODEL` | Default model for the Claude Agent SDK adapter |
| `MLFLOW_TRACKING_URI` | MLflow tracking target |
| `CONTEXT_VECTOR_PROVIDER` | `pgvector` for phase 0 |
| `CONTEXT_EMBEDDING_MODEL` | Embedding model used for context indexing |

Secrets must not be committed to the repo or baked into images. Local development should use `.env` files ignored by git. VM and AKS deployments should use the host secret manager or Kubernetes secrets.

## Development Environment Setup

Phase 0 must produce a repeatable development environment before product features are built. The goal is to make every platform decision executable and debuggable on a developer machine.

Required local services:

- backend API on `127.0.0.1:8000`
- frontend dev server on `127.0.0.1:3000` or `127.0.0.1:5173`
- PostgreSQL with pgvector enabled
- configured Databricks workspace, PAT, and general-purpose cluster
- Claude Agent SDK credentials
- optional worker process for context indexing and eval jobs

Required setup artifacts:

- `.env.example` with all required variables and no secrets
- local setup script or `docker compose` profile for PostgreSQL + pgvector
- database migrations that enable and validate pgvector
- backend health endpoint
- environment preflight command for local debugging
- Docker build path that packages backend plus compiled frontend static assets

The preflight command should be safe to run repeatedly. It should not mutate production data or create broad Databricks resources. Any write checks must use local PostgreSQL or a clearly named scratch location.

## Environment and Infrastructure Evals

Phase 0 should include deterministic environment and infrastructure evals. These are not model-quality evals; they are feasibility checks for the architecture decisions. They should be runnable locally and in CI-like debugging environments.

Suggested test layout once the app is scaffolded:

```text
databricks-analyst-app/
  tests/
    env/
      test_config.py
      test_postgres_pgvector.py
      test_databricks_pat.py
      test_cluster_execution.py
      test_metric_views.py
      test_claude_agent_sdk.py
      test_docker_image.py
```

Required checks:

| Check | Purpose | Pass condition |
|-------|---------|----------------|
| Config validation | Prove required environment variables are present and parseable | Missing or malformed config fails with actionable errors |
| Secret redaction | Prevent secrets from leaking into logs and traces | PAT and provider keys are masked in emitted diagnostics |
| PostgreSQL connectivity | Prove the app database is reachable | Simple connection and migration status query succeeds |
| pgvector extension | Prove semantic retrieval infrastructure is available | `vector` extension exists, test embedding can be inserted and nearest-neighbor search returns it |
| Migration idempotency | Prove local setup is repeatable | Running migrations twice leaves the schema valid |
| Databricks PAT identity | Prove token auth works | Current-user or workspace identity lookup succeeds |
| Cluster availability | Prove configured compute exists | `DATABRICKS_CLUSTER_ID` resolves and is running or startable |
| Cluster SQL execution | Prove phase 0 execution path works | Bounded read-only `SELECT 1` succeeds on the configured cluster |
| Unity Catalog access | Prove metadata discovery works | Can list allowed catalogs/schemas or inspect a configured sample object |
| Metric views | Prove canonical metric decision is feasible | Can list or describe at least one configured UC metric view, or fail with a clear "no metric views configured" diagnostic |
| Claude Agent SDK | Prove SDK integration is viable | SDK imports, credentials validate, and a minimal non-tool request or mocked SDK run succeeds |
| No Claude subprocess | Enforce serving-path constraint | Agent adapter tests assert no `claude` CLI subprocess is invoked |
| MLflow tracing | Prove observability target is usable when configured | Test trace or no-op trace setup succeeds |
| Frontend/backend reachability | Prove local dev loop is healthy | Backend health and frontend dev server respond |
| Docker image | Prove deployment packaging path works | Image builds and serves backend health plus compiled frontend assets |

The preflight command should group checks into tiers:

1. **Local-only:** config parsing, PostgreSQL, pgvector, migrations, frontend/backend health.
2. **Databricks:** PAT identity, cluster availability, cluster SQL, UC metadata, metric views, MLflow.
3. **Agent:** Claude Agent SDK, no subprocess enforcement, minimal tool registration.
4. **Packaging:** Docker image build and container health.

Example command shape:

```bash
pnpm check:env
uv run pytest tests/env -v
```

The exact commands can change with the scaffold, but phase 0 is not complete until equivalent checks exist and are documented.

## Authentication and Identity

Phase 0 uses PAT authentication.

The PAT is the Databricks identity for:

- metadata lookup
- metric view discovery and query
- cluster-backed SQL execution
- MLflow trace logging

Implications:

- The app does not yet provide per-user pass-through identity.
- Phase 0 should be treated as a trusted developer or controlled pilot mode.
- Audit trails in Databricks will reflect the PAT owner.
- The UI must make the active workspace and token-backed identity visible to avoid confusion.

The backend should support one of two PAT input modes:

1. **Developer mode:** `DATABRICKS_TOKEN` is configured as an environment variable.
2. **Pilot mode:** a user provides a PAT through a secure session flow, and the app stores only an encrypted token reference or short-lived server-side session secret.

Phase 0 should prefer developer mode unless a pilot explicitly requires multiple users. Phase 3 should replace PATs with OAuth/OBO or an equivalent enterprise auth model.

## Databricks Execution

Phase 0 through phase 2 should execute analytical SQL on a general-purpose Databricks cluster, not a SQL warehouse.

Rationale:

- Clusters are easier to align with notebook-style data science workflows.
- Cluster execution leaves room for Python/Spark probes during discovery and validation.
- The app can avoid committing too early to warehouse-specific execution semantics while the agent loop is still evolving.

Execution adapter requirements:

- Use `DATABRICKS_CLUSTER_ID` as the default compute target.
- Execute read-only SQL and metadata probes through Databricks APIs.
- Enforce row limits, timeouts, cancellation, and result preview limits in the application layer.
- Block mutating SQL by default.
- Capture statement text, status, row count, result preview, latency, and error details.
- Return links to the relevant Databricks artifact when the platform provides one.

Phase 3 should revisit SQL warehouse execution after the discovery loop, validation checks, and eval harness are stable.

## Semantic Retrieval

Databricks Vector Search is not available in the target Databricks environment, so semantic retrieval is app-owned infrastructure.

Phase 0 should use PostgreSQL with pgvector for:

- context document embeddings
- semantic search over table, metric, annotation, code-enrichment, workflow, memory, and approved document chunks
- exact lookup and vector ranking in the same application database
- local development through a Postgres + pgvector container
- VM/AKS deployment through managed or self-managed PostgreSQL with pgvector enabled

If Lakebase is considered for the application database, it must first satisfy the pgvector requirements. Otherwise, use external PostgreSQL for the app database and vector index.

The context service should hide the concrete vector implementation behind an adapter:

```text
ContextService
  |- exact lookup repository
  |- pgvector repository
  |- ranking service
  |- ACL metadata filter
```

The app should not call Databricks Vector Search or require a Databricks vector endpoint. If a deployment later provides a managed vector service, it can be added behind the same context service interface after evals prove equivalent or better retrieval quality.

## Metric Views

Unity Catalog metric views are the canonical metric system for the app.

The system should:

- Prefer metric views over raw table queries when a requested metric is available.
- Retrieve metric view definitions during offline context ingestion.
- Expose a `query_metric_view` tool as a first-class agent capability.
- Use metric views for reconciliation checks when generated SQL uses lower-level tables.
- Store metric view IDs, dimensions, measures, filters, and freshness metadata in context storage.

A separate metric registry should not be introduced in phase 0. If later required, supplemental metadata should augment metric views rather than replace them.

## Claude Agent SDK Integration

The analyst runtime should use the Claude Agent SDK through a narrow adapter owned by the application.

The adapter should expose:

- `run_analysis(input, context, tools, run_config)`
- streaming events for plan, tool call, tool result, validation, and final answer
- tool registration for analyst-safe tools
- cancellation
- trace metadata hooks
- deterministic eval configuration

The application should not shell out to `claude`, spawn Claude Code as a child process, or depend on a long-running Claude Code subprocess for serving user requests.

Rationale:

- Subprocess orchestration makes cancellation, streaming, auth isolation, deployment, and observability harder.
- A library/SDK boundary is easier to test and mock.
- The application should own tool contracts, context selection, storage, and tracing rather than delegating those responsibilities to a CLI process.

If the SDK lacks a required capability without a subprocess, the phase 0 behavior should be to keep that capability out of scope and document the gap. Subprocess use can be considered later for offline developer tooling, but not for production request handling.

## Application Components

| Component | Responsibility |
|-----------|----------------|
| React workbench | Prompt input, sessions, answer cards, charts, evidence drawer, feedback |
| FastAPI API | Auth/session boundary, REST APIs, streaming, request validation |
| Agent runtime adapter | Claude Agent SDK integration, tool loop, cancellation, trace hooks |
| Databricks client adapter | Workspace, cluster, UC, metric views, MLflow APIs |
| SQL execution service | Read-only execution, limits, previews, status polling, errors |
| Context service | Exact lookup, pgvector retrieval, ranking, ACL metadata |
| Metric service | Metric view discovery, query construction, reconciliation support |
| Persistence layer | Sessions, messages, runs, query runs, artifacts, feedback, eval cases |
| Background worker | Offline context ingestion, evals, report generation |

## Core Request Flow

1. User submits a business question in the React workbench.
2. FastAPI creates an `analysis_run` and starts a streaming response.
3. Context service retrieves candidate metric views, tables, prior runs, docs, and memories.
4. Agent adapter starts a Claude Agent SDK run with bounded context and analyst-safe tools.
5. Agent performs discovery before SQL generation.
6. Metric service is used first when the question maps to a metric view.
7. SQL execution service runs bounded read-only SQL on the configured general-purpose cluster.
8. Validation checks inspect row counts, nulls, joins, freshness, and metric reconciliation.
9. Agent synthesizes answer, charts, caveats, and evidence.
10. Backend stores run metadata, trace IDs, SQL metadata, result previews, artifacts, and feedback hooks.

## Data Model Decisions

Phase 0 should create the application database schema even if some tables are lightly used initially.

Required tables:

- `analysis_sessions`
- `analysis_messages`
- `analysis_runs`
- `query_runs`
- `analysis_artifacts`
- `context_documents`
- `feedback`
- `eval_cases`

Tables that can be present but minimally used:

- `workflow_templates`
- `workflow_runs`
- `memories`

Do not store full source datasets in the application database. Store previews, summaries, metadata, artifact pointers, and trace/query identifiers.

## Phase 0 Non-Goals

- Multi-user enterprise auth beyond PAT-based pilot use.
- SQL warehouse execution as the default path.
- Separate metric registry.
- Team/global memory approval workflow.
- Full code enrichment over all production pipelines.
- Databricks Vector Search dependency.
- Claude Code subprocess serving.
- Multi-agent runtime.
- Broad production rollout.

## Phase 3 Revisit Checklist

Before leaving phase 3, revisit:

- Replace PAT with OAuth/OBO or enterprise SSO-backed identity.
- Decide whether SQL warehouse execution should replace or complement cluster execution.
- Confirm whether metric views fully cover canonical business metrics.
- Confirm whether pgvector retrieval quality and operations are sufficient for production scale.
- Decide whether the Claude Agent SDK adapter needs model/runtime abstraction.
- Decide whether any Claude Code subprocess use is acceptable for offline development tooling.
- Validate VM and AKS deployment patterns against security and operations requirements.
