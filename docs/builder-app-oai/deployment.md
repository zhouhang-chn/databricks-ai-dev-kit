# Builder App OAI Docker Compose Deployment

This guide deploys `databricks-builder-app-oai` to a self-managed server with Docker Compose.

The Compose stack runs:

- `postgres`: PostgreSQL 17 with a persistent volume
- `backend`: FastAPI backend
- `frontend`: nginx serving the Vite build and proxying `/api` and `/mcp` to the backend

## Prerequisites

- Docker with Docker Compose v2
- A Databricks workspace URL and token, or OAuth M2M credentials
- An OpenAI-compatible endpoint for the OpenAI Agents SDK runtime

Run commands from the repository root:

```bash
cd /path/to/ai-dev-kit
```

## Configuration

Copy the template, then edit the copied file:

```bash
mkdir -p databricks-builder-app-oai/.deploy
cp databricks-builder-app-oai/scripts/docker/docker.env.example databricks-builder-app-oai/.deploy/docker.env
$EDITOR databricks-builder-app-oai/.deploy/docker.env
```

The copied file is intentionally small. It only controls the image registry/version, server ports, the PostgreSQL password, Databricks credentials, and AI Gateway credentials. It is ignored by git and should be treated as a secret.

Set the image registry prefix and version:

```dotenv
IMAGE_REGISTRY_PREFIX=azrbrewdatnonprodce2acr.azurecr.cn/brewdat-ds-cn/
IMAGE_VERSION=0.1.0
```

Images are tagged as:

```text
azrbrewdatnonprodce2acr.azurecr.cn/brewdat-ds-cn/builder-app-oai-backend:<image-version>
azrbrewdatnonprodce2acr.azurecr.cn/brewdat-ds-cn/builder-app-oai-frontend:<image-version>
```

For PAT-style Databricks auth, set:

```dotenv
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=replace_with_databricks_token
DATABRICKS_CLIENT_ID=
DATABRICKS_CLIENT_SECRET=
```

For OAuth M2M Databricks auth, leave `DATABRICKS_TOKEN` blank and set `DATABRICKS_CLIENT_ID` plus `DATABRICKS_CLIENT_SECRET`.

Set model credentials in the same file:

```dotenv
OPENAI_BASE_URL=https://your-ai-gateway.example.com/openai/v1
OPENAI_API_KEY=replace_with_ai_gateway_key
```

Keep `APP_DB_PASSWORD` URL-safe, for example letters and digits only. Compose uses it in both PostgreSQL initialization and the backend PostgreSQL URL.

## Build

Build and push both app images:

```bash
databricks-builder-app-oai/scripts/docker/build.sh
```

Build and push only one image:

```bash
databricks-builder-app-oai/scripts/docker/build.sh --backend-only
databricks-builder-app-oai/scripts/docker/build.sh --frontend-only
```

The build script uses `docker buildx build --push -t ...`. Make sure Docker is logged in to the configured registry before building:

```bash
docker login azrbrewdatnonprodce2acr.azurecr.cn
```

## Deploy

Build and start the full stack:

```bash
databricks-builder-app-oai/scripts/docker/deploy.sh --build
```

Start from already-pushed images:

```bash
databricks-builder-app-oai/scripts/docker/deploy.sh
```

To use a different config file:

```bash
databricks-builder-app-oai/scripts/docker/deploy.sh --config /path/to/docker.env --build
```

## Ports

Defaults:

| Service | Host bind | Host port | Container port |
|---------|-----------|-----------|----------------|
| Frontend | `0.0.0.0` | `3001` | `8080` |
| Backend | `127.0.0.1` | `8008` | `8000` |
| PostgreSQL | `127.0.0.1` | `5433` | `5432` |

Override ports in `docker.env` before deploy:

```dotenv
FRONTEND_HOST_PORT=8088
BACKEND_HOST_PORT=8008
POSTGRES_HOST_PORT=5433
```

Then deploy:

```bash
databricks-builder-app-oai/scripts/docker/deploy.sh --build
```

## Database

By default, Compose deploys PostgreSQL in Docker. The official PostgreSQL image creates the database/user, and [`10-builder-app.sh`](../../databricks-builder-app-oai/scripts/docker/postgres-init/10-builder-app.sh) creates the app schema during first database initialization.

Defaults:

```bash
APP_DB_NAME=builder_app
APP_DB_USER=builder_app
APP_DB_SCHEMA=builder_app
APP_DB_SSLMODE=disable
```

Set the database password in `docker.env` before the first deploy:

```dotenv
APP_DB_PASSWORD=replace_with_url_safe_password
```

Because PostgreSQL only runs init scripts when the data volume is first created, change `APP_DB_PASSWORD` before the first deploy, or recreate the PostgreSQL volume intentionally.

## Operations

Check status:

```bash
docker compose \
  --env-file databricks-builder-app-oai/.deploy/docker.env \
  -f databricks-builder-app-oai/docker-compose.yml \
  ps
```

Check health:

```bash
curl -fsS http://127.0.0.1:8008/api/config/health
curl -fsS http://127.0.0.1:3001/api/config/health
```

View logs:

```bash
docker compose \
  --env-file databricks-builder-app-oai/.deploy/docker.env \
  -f databricks-builder-app-oai/docker-compose.yml \
  logs -f backend
```

Stop the stack without deleting volumes:

```bash
docker compose \
  --env-file databricks-builder-app-oai/.deploy/docker.env \
  -f databricks-builder-app-oai/docker-compose.yml \
  down
```

Delete volumes only when you intend to delete PostgreSQL and project data:

```bash
docker compose \
  --env-file databricks-builder-app-oai/.deploy/docker.env \
  -f databricks-builder-app-oai/docker-compose.yml \
  down -v
```

## Notes

- The app still uses `LAKEBASE_PG_URL` internally for PostgreSQL, even though this deployment uses normal Docker PostgreSQL.
- `ENV=development` is intentional for PAT-style self-managed deployments because it lets the app resolve the configured Databricks user without Databricks Apps proxy headers.
- The existing `databricks-builder-app-oai/scripts/deploy.sh` remains the Databricks Apps deployment path.
