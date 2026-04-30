# AI Dev Kit Documentation

Internal reference documentation for the AI Dev Kit monorepo. Top-level guidance for users lives in the repo [`README.md`](../README.md); this directory is for engineers working on the kit itself.

## Contents

| Section | Description |
|---------|-------------|
| [`tools/`](tools/) | Reference for `databricks-tools-core` — the Python library that backs the MCP server and the Builder App |
| [`mcp/`](mcp/) | Reference for `databricks-mcp-server` — the FastMCP wrapper, middleware, manifest, and tool conventions |
| [`skills/`](skills/) | Reference for every skill the kit installs — Databricks (this repo), MLflow (`mlflow/skills`), and APX (`databricks-solutions/apx`) — plus authoring, installation, and persona profiles |
| [`builder-app/`](builder-app/) | Engineering reference for the Builder App - FastAPI backend, React client, agent streaming, Lakebase persistence, deployment, auth, and MCP gateway |
| [`analyst-app/design.md`](analyst-app/design.md) | Design proposal for a business-oriented Databricks Analyst App for data scientists and business users |
| [`analyst-app/system-design.md`](analyst-app/system-design.md) | Phase 0 system design decisions for the externally hosted Databricks Analyst App |
| [`analyst-app/plan.md`](analyst-app/plan.md) | Build plan for the externally hosted Databricks Analyst App |
| [`analyst-app/phase-0-action-plan.md`](analyst-app/phase-0-action-plan.md) | Detailed phase 0 action plan for agent runtime feasibility |
