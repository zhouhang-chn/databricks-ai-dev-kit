# Databricks Analyst App Phase 0 Action Plan

## Purpose

Phase 0 validates the analyst-specific pieces — tool contracts, system prompt, skill selection, and Databricks connectivity — against the proven OpenAI Agents SDK + DeepSeek v4 runtime from `databricks-builder-app-oai`.

Phase 0 is **not** a runtime feasibility phase. The agent runtime is proven. The original milestones for Claude Agent SDK adapter (M0.1), MCP vs direct adapter comparison (M0.3/M0.4), and SDK decision record (M0.7) are retired or collapsed. See [`gap-analysis-vs-oai.md`](gap-analysis-vs-oai.md) for the rationale.

## Proven Runtime (Carry Over)

These components are inherited from `databricks-builder-app-oai` and require no phase 0 work:

| Component | Source | Notes |
|-----------|--------|-------|
| OpenAI Agents SDK runtime | `server/services/agent_runtime/openai_runtime.py` | `Runner.run_streamed()`, retry, cancel, session persistence |
| DeepSeek v4 Pro/Flash config | `server/services/agent_runtime/openai_models.py` | `OpenAIChatCompletionsModel` + `AsyncOpenAI` for AI Gateway |
| `AgentRuntime` protocol | `server/services/agent_runtime/base.py` | Clean protocol + `AgentRunRequest` dataclass |
| Event normalization | `server/services/agent_runtime/openai_events.py` | SDK events → app events |
| Skills manager | `server/services/skills_manager.py` | Load, filter, render skills into prompt |
| MLflow tracing | `server/services/mlflow_setup.py` | `mlflow.openai.autolog()` |
| Lakebase + Alembic | `server/db/database.py`, `alembic/` | PostgreSQL persistence + migrations |
| Resumable SSE | `server/services/active_stream.py` | 50-second windows + `events_json` replay |

## Non-Goals

Phase 0 should not include:

- UI implementation
- StoryCard or Story Canvas implementation
- Frontend build tooling
- Docker image packaging
- VM or AKS deployment manifests
- pgvector setup or semantic context indexing
- Full application persistence schema
- Production auth beyond PAT-based local feasibility checks
- Full end-to-end business analysis workflows
- ~~Claude Agent SDK adapter~~ (eliminated)
- ~~Claude vs OpenAI SDK comparison~~ (resolved)
- ~~Claude Code subprocess guard~~ (confirmed by builder app design)

## Phase 0 Outcomes

By the end of phase 0, the repo should contain:

- An analyst tool registry wrapping `databricks-tools-core` in OpenAI function-tool shape
- An analyst system prompt module with discovery-first loop
- An analyst skill allowlist configuration
- Validated Databricks authentication: PAT identity, cluster execution, UC metadata, metric view access
- A phase 0 readiness test suite with actionable failures
- A brief decision record confirming carry-over components and analyst-specific choices

## Recommended Directory Shape

```text
databricks-analyst-app/
  server/
    analyst_app/
      __init__.py
      config.py
      agent/
        runtime.py          # Thin wrapper delegating to builder app's OpenAIAgentRuntime
        prompts.py           # Analyst system prompt (new)
      tools/
        base.py
        analyst_tools.py     # Analyst-safe tool registry wrapping databricks-tools-core
        registry.py
      skills/
        config.py            # Analyst skill allowlist
    tests/
      phase0/
        test_config.py
        test_analyst_tools.py
        test_analyst_prompt.py
        test_databricks_auth.py
        test_databricks_execution.py
        test_metric_views.py
        test_skill_registry.py
  docs/
    phase0-decision-record.md
```

This shape intentionally excludes `client/`, `Dockerfile`, and deployment manifests.

## Milestone 0.1: Analyst Tool Contracts

Goal: define the analyst-safe tool set and implement it against `databricks-tools-core`.

Tasks:

1. Define app-level JSON schemas for each analyst tool:
   - `get_current_identity` — resolve active Databricks identity/workspace
   - `describe_compute` — inspect configured cluster and execution readiness
   - `execute_sql` — run bounded read-only SQL on general-purpose cluster
   - `describe_uc_asset` — inspect UC table/view/schema metadata
   - `describe_metric_view` — inspect UC metric view definition
   - `query_metric_view` — query governed metric views
2. Wrap each tool in the OpenAI function-tool shape used by `create_databricks_tools()` in the builder app.
3. Make tool names distinct and non-overlapping.
4. Define read-only defaults and disallowed operations.
5. Define output shapes optimized for agent reasoning, not raw SDK objects.
6. Add tests that validate tool schemas and example outputs.
7. Ensure the `manage_*` resource-creation tools from the builder app are NOT registered.

Acceptance:

- The OpenAI Agents SDK sees a small, analyst-safe, orthogonal tool set.
- Tool outputs are JSON-serializable and agent-readable.
- No builder/CRUD tools are exposed to the analyst agent.

## Milestone 0.2: Databricks Authentication and Smoke Checks

Goal: validate that the configured Databricks workspace, PAT, and cluster work end to end.

Tasks:

1. Add a typed config loader and secret-redaction utilities for `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, and `DATABRICKS_CLUSTER_ID`.
2. Add an identity check that resolves the active workspace identity through the PAT.
3. Add a cluster readiness check:
   - configured cluster exists
   - cluster state is running or startable
   - cluster is compatible with SQL execution requirements
4. Add a bounded read-only SQL smoke test: execute `SELECT 1`, capture status, latency, row count, and result preview.
5. Add a UC metadata smoke check: list allowed catalogs/schemas or inspect a configured sample object.
6. Add a metric view smoke check: describe at least one configured UC metric view, or emit a clear "no metric views configured" diagnostic.
7. Add failure diagnostics for invalid PAT, unreachable workspace, missing cluster, terminated cluster, and SQL permission errors.

Acceptance:

- Required env values are parsed, validated, and redacted in diagnostics.
- Active Databricks identity resolves through the configured PAT.
- Configured cluster is reachable and runnable.
- Read-only `SELECT 1` succeeds on the configured cluster.
- UC metadata can be inspected at the configured scope.
- Metric view check passes or reports a clear "not configured" diagnostic.

## Milestone 0.3: Analyst System Prompt

Goal: write the discovery-first analyst system prompt and validate it against the proven runtime.

Tasks:

1. Write the analyst system prompt with the analysis loop: Understand → Discover → Plan → Retrieve → Clarify → Generate → Validate → Execute → Analyze → Synthesize → Learn.
2. Include instructions for:
   - Prefer canonical metric views over raw table queries
   - Discover before writing SQL
   - Validate joins, freshness, null density before answering
   - Show evidence and caveats in every answer
   - Label explicit defaults and assumptions
   - Ask clarifying questions only when ambiguity is material
3. Reuse project-context rendering (`_render_project_context`) from the builder app for project metadata, metric views, preferred tables, glossary, and caveats.
4. Reuse skill-guidance rendering from the builder app's skills manager.
5. Remove builder-specific instructions (resource creation, `AGENTS.md`, GRANT statements, clickable links to created resources).
6. Add a smoke test showing the system prompt can drive a simple tool-calling flow through `OpenAIAgentRuntime`.

Acceptance:

- The analyst system prompt instructs the agent to discover before generating SQL.
- Project context and skill guidance render correctly.
- No builder-specific instructions remain.

## Milestone 0.4: Analyst Skill Allowlist

Goal: configure the skill registry for analyst workflows.

Tasks:

1. Define the analyst skill allowlist:
   - `databricks-python-sdk`
   - `databricks-unity-catalog`
   - `databricks-dbsql`
   - `instrumenting-with-mlflow-tracing`
2. Configure the builder app's skills manager to load only allowlisted skills.
3. Verify that skill filtering correctly removes non-analyst skills (agent bricks, synthetic data gen, PDF generation, etc.).
4. Test that selected skills render into agent instructions within token budget.
5. Define how skill guidance and analyst tool schemas combine in the agent prompt.

Acceptance:

- Only analyst-relevant skills load.
- Skill guidance renders alongside analyst tools in the system prompt.
- Non-analyst skills are excluded.

## Milestone 0.5: Decision Record

Goal: document phase 0 decisions before phase 1 begins.

The decision record should confirm:

1. Agent runtime: OpenAI Agents SDK + DeepSeek v4 Pro/Flash via AI Gateway (carry over from builder app).
2. Initial analyst-safe tool set and backing.
3. Analyst system prompt design.
4. Analyst skill allowlist.
5. Which builder app components are carried over vs rebuilt.
6. First business domain and seed metric set.
7. What preflight checks must pass for local debugging.

Acceptance:

- Decision record is reviewed before phase 1 starts.
- All carry-over components are confirmed working.
- Known gaps have phase assignments.

## Suggested Command Contract

Phase 0 should be runnable without UI or Docker:

```bash
uv run pytest databricks-analyst-app/server/tests/phase0 -v
```

Optional live Databricks checks:

```bash
DATABRICKS_HOST=... \
DATABRICKS_TOKEN=... \
DATABRICKS_CLUSTER_ID=... \
uv run pytest databricks-analyst-app/server/tests/phase0 -m databricks -v
```

## Completion Checklist

- [ ] Analyst tool contracts defined and tested.
- [ ] Analyst tools wrap `databricks-tools-core` in OpenAI function-tool shape.
- [ ] No builder/CRUD tools exposed to analyst agent.
- [ ] PAT identity smoke check exists.
- [ ] Configured cluster execution smoke check exists.
- [ ] UC metadata and metric view smoke checks exist.
- [ ] Secret redaction verified for diagnostics, logs, and traces.
- [ ] Analyst system prompt written with discovery-first loop.
- [ ] Project-context and skill-guidance rendering reused from builder app.
- [ ] Analyst skill allowlist configured and tested.
- [ ] Phase 0 decision record written.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| DeepSeek v4 Pro tool-calling quality insufficient for analyst loop | Eval cases; model switch via `OPENAI_AGENT_MODEL` env var without code changes |
| Databricks environment lacks expected resources | M0.2 smoke checks emit clear diagnostics and distinguish required vs optional capabilities |
| Analyst tool outputs don't fit agent reasoning well | Iterate output shapes with eval cases; keep outputs agent-readable, not raw SDK dumps |
| Skill content too broad for prompts | Allowlist, chunking, task-based selection, token budget trimming (builder app's skills_manager handles this) |
| Builder app patterns don't cleanly separate for analyst reuse | Phase 0 identifies separation issues early; worst case is a fork with targeted cleanup |

## Phase 1 Handoff

Phase 1 can start when:

- Analyst tool contracts are defined and tested
- Databricks PAT, cluster execution, UC metadata, and metric view feasibility are validated (M0.2)
- Analyst system prompt is written and can drive tool-calling through the proven runtime
- Analyst skill allowlist is configured
- Decision record is reviewed
- UI, Docker, pgvector, and full persistence work are explicitly scheduled for phase 1+
