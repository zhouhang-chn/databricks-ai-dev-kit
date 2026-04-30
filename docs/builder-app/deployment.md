# Deployment

The Builder App deploys to Databricks Apps with `databricks-builder-app/scripts/deploy.sh`. The script provisions Lakebase, builds the React client, stages backend code and skills, creates the Databricks App if needed, grants Lakebase permissions, uploads source to the workspace, and deploys the app.

## Prerequisites

- Databricks CLI 0.287.0+
- Authenticated Databricks CLI profile
- Node.js 18+
- `uv`
- `pnpm` for manual frontend commands
- Lakebase Autoscale enabled in the target workspace
- Permission to create Databricks Apps and Lakebase resources

## Basic Deploy

```bash
cd databricks-builder-app
./scripts/deploy.sh <app-name> --profile <profile>
```

Common variants:

```bash
./scripts/deploy.sh <app-name> --profile <profile> --skip-lakebase
./scripts/deploy.sh <app-name> --profile <profile> --skip-lakebase --skip-build --skip-skills
./scripts/deploy.sh <app-name> --profile <profile> --lakebase-id my-builder-db
./scripts/deploy.sh mcp-builder-app --profile <profile> --enable-mcp
```

Use an app name that starts with `mcp-` when deploying for Genie Code MCP discovery.

## What Gets Created

| Resource | Created by | Details |
|----------|------------|---------|
| Lakebase Autoscale project | `databricks bundle deploy` using `databricks.yml` | PostgreSQL 17, 0.5-2 CU, scale-to-zero after 300 seconds |
| Databricks App | `databricks apps create` | Created if missing |
| App source upload | `databricks workspace import-dir` | Uploads staged files to `/Workspace/Users/<user>/apps/<app-name>` |
| Lakebase OAuth role | `databricks postgres create-role` | Role name is the app service principal client ID |
| PostgreSQL schema | Scripted `psycopg` grants | `builder_app` schema with table and sequence privileges |
| App deployment | `databricks apps deploy` | Runs `uvicorn server.app:app` inside Databricks Apps |

## Deployment Package

The staging directory contains:

```
server/
alembic/
alembic.ini
requirements.txt
client/out/
packages/
  databricks_tools_core/
  databricks_mcp_server/
skills/
app.yaml
```

The deployment package vendors the sibling Python packages into `packages/` and sets:

```yaml
- name: PYTHONPATH
  value: "/app/python/source_code/packages"
```

This keeps the deployed app self-contained and avoids requiring the monorepo layout in Databricks Apps.

## Generated app.yaml

`deploy.sh` generates `app.yaml` in the staging directory instead of patching `app.yaml.example`.

Important generated settings:

| Variable | Value |
|----------|-------|
| `ENV` | `production` |
| `PROJECTS_BASE_DIR` | `./projects` |
| `LAKEBASE_ENDPOINT` | `projects/<lakebase-id>/branches/production/endpoints/primary` |
| `LAKEBASE_DATABASE_NAME` | `databricks_postgres` |
| `ENABLED_SKILLS` | Comma-separated list of staged skills |
| `LLM_PROVIDER` | `DATABRICKS` |
| `DATABRICKS_MODEL` | Generated Databricks model setting for app configuration compatibility |
| `DATABRICKS_MODEL_MINI` | Generated small-model setting for app configuration compatibility |
| `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` | `3600000` |
| `MLFLOW_TRACKING_URI` | `databricks` |
| `MLFLOW_EXPERIMENT_NAME` | `/Workspace/Shared/builder_app_ml_trace` |
| `AUTO_GRANT_PERMISSIONS_TO` | `account users` |

The Claude Agent SDK path currently reads `ANTHROPIC_MODEL` and `ANTHROPIC_MODEL_MINI` when those are set, otherwise it falls back to code defaults while still routing requests through the Databricks FMAPI Anthropic-compatible endpoint.

With `--enable-mcp`, the script also adds:

```yaml
- name: ENABLE_MCP_GATEWAY
  value: "true"
- name: FASTMCP_STATELESS_HTTP
  value: "true"
```

## Manual Frontend Build

If you need to build the frontend outside the deploy script:

```bash
cd databricks-builder-app/client
pnpm install
pnpm build
```

The app expects the build at `client/out`.

## Lakebase Infrastructure

`databricks.yml` declares a Lakebase Autoscale project:

```yaml
resources:
  postgres_projects:
    builder_db:
      project_id: ${var.lakebase_project_id}
      pg_version: 17
      default_endpoint_settings:
        autoscaling_limit_min_cu: 0.5
        autoscaling_limit_max_cu: 2
        suspend_timeout_duration: "300s"
```

Deploy or update Lakebase only:

```bash
cd databricks-builder-app
databricks bundle deploy --profile <profile> --var lakebase_project_id=<id>
```

Destroy Lakebase only:

```bash
cd databricks-builder-app
databricks bundle destroy --profile <profile> --var lakebase_project_id=<id>
```

Destroying the bundle deletes the Lakebase project and database data. It does not delete the Databricks App.

## Permissions

The deploy script grants the app service principal:

- `CREATE` on database `databricks_postgres`
- `USAGE` on schema `builder_app`
- all privileges on schema `builder_app`
- all privileges on existing tables and sequences in `builder_app`
- default privileges for future tables and sequences

The app connects to Lakebase with dynamic OAuth credentials in production. `server/db/database.py` refreshes tokens before expiry and injects the current token into SQLAlchemy connections.

## Redeploys

Full redeploy:

```bash
./scripts/deploy.sh <app-name> --profile <profile>
```

Fast server-only redeploy when Lakebase, frontend build, and skills are unchanged:

```bash
./scripts/deploy.sh <app-name> --profile <profile> --skip-lakebase --skip-build --skip-skills
```

After a successful deploy, the script removes old source directories under the app service principal's workspace source path when it can identify the active deployment.

## MCP Gateway Deploy

```bash
./scripts/deploy.sh mcp-builder-app --profile <profile> --enable-mcp
```

The deployed app serves:

- Builder UI at `/`
- REST API at `/api/*`
- MCP protocol at `/mcp`
- MCP diagnostics at `/mcp/health`, `/mcp/tools`, `/mcp/skills`, and `/mcp/info`

See [mcp-gateway.md](mcp-gateway.md) for protocol details.

## Cleanup

Delete the Databricks App:

```bash
databricks apps delete <app-name> --profile <profile>
```

Delete the Lakebase project:

```bash
cd databricks-builder-app
databricks bundle destroy --profile <profile> --var lakebase_project_id=<id>
```

## Deployment Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| CLI version error | Databricks CLI older than 0.287.0 | Upgrade the CLI |
| App deploy succeeds but page is blank | Frontend build missing or dependency install failed | Check `databricks apps logs <app-name>` |
| `relation does not exist` | Migrations did not complete | Restart/redeploy the app and inspect startup logs |
| `permission denied for schema builder_app` | Lakebase grants missing or target SP changed | Rerun deploy step 6 by rerunning `deploy.sh` |
| `password authentication failed` | OAuth role missing or token generation failed | Rerun deploy and check Lakebase role creation output |
| MCP app missing in Genie Code | App name does not start with `mcp-` | Redeploy with an `mcp-` prefixed name |
