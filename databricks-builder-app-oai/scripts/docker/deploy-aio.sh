#!/usr/bin/env bash
set -euo pipefail

# Copy this single file to a server, edit the values in this block, then run it.
IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX:-azrbrewdatnonprodce2acr.azurecr.cn/brewdat-ds-cn/}"
IMAGE_VERSION="${IMAGE_VERSION:-latest}"

FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT:-3001}"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-8008}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-5433}"

# Keep this URL-safe because it is used in the backend PostgreSQL URL.
APP_DB_PASSWORD="${APP_DB_PASSWORD:-replace_with_url_safe_password}"

# Use either DATABRICKS_TOKEN, or leave it blank and set OAuth M2M credentials.
DATABRICKS_HOST="${DATABRICKS_HOST:-https://your-workspace.cloud.databricks.com}"
DATABRICKS_TOKEN="${DATABRICKS_TOKEN:-replace_with_databricks_token}"
DATABRICKS_CLIENT_ID="${DATABRICKS_CLIENT_ID:-}"
DATABRICKS_CLIENT_SECRET="${DATABRICKS_CLIENT_SECRET:-}"

OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://your-ai-gateway.example.com/openai/v1}"
OPENAI_API_KEY="${OPENAI_API_KEY:-replace_with_ai_gateway_key}"

DEPLOY_DIR="${DEPLOY_DIR:-${HOME:-$PWD}/builder-app-oai}"

# Defaults below normally do not need to change.
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-builder-app-oai}"
BACKEND_IMAGE_NAME="${BACKEND_IMAGE_NAME:-builder-app-oai-backend}"
FRONTEND_IMAGE_NAME="${FRONTEND_IMAGE_NAME:-builder-app-oai-frontend}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
APP_DB_NAME="${APP_DB_NAME:-builder_app}"
APP_DB_USER="${APP_DB_USER:-builder_app}"
APP_DB_SCHEMA="${APP_DB_SCHEMA:-builder_app}"

ACTION=up
PULL_IMAGES=true

usage() {
  cat <<'EOF'
Usage: ./deploy-aio.sh [options] [up|pull|ps|logs|restart|down]

All-in-one Builder App OAI deployment script.
Copy this file to a server, edit the configuration block at the top, then run:

  chmod +x deploy-aio.sh
  ./deploy-aio.sh

Options:
  --dir PATH     Runtime directory for generated compose files and state
  --no-pull      Do not pull images before up/restart
  -h, --help     Show this help

Actions:
  up             Generate runtime files, pull images, and start services
  pull           Generate runtime files and pull images
  ps             Show service status
  logs           Follow service logs
  restart        Pull images and recreate services
  down           Stop services without deleting volumes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      DEPLOY_DIR="$2"
      shift 2
      ;;
    --no-pull)
      PULL_IMAGES=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    up|pull|ps|logs|restart|down)
      ACTION="$1"
      shift
      ;;
    *)
      echo "Unknown option or action: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$IMAGE_REGISTRY_PREFIX" && "$IMAGE_REGISTRY_PREFIX" != */ ]]; then
  IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX}/"
fi
if [[ "$DATABRICKS_TOKEN" == replace_with_* ]]; then
  DATABRICKS_TOKEN=""
fi

COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/docker.env"
INIT_DIR="$DEPLOY_DIR/postgres-init"
INIT_FILE="$INIT_DIR/10-builder-app.sh"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

validate_runtime() {
  require_command docker
  sudo docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
}

validate_port() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "$name must be a number"
  (( value >= 1 && value <= 65535 )) || fail "$name must be between 1 and 65535"
}

validate_required_config() {
  validate_port FRONTEND_HOST_PORT "$FRONTEND_HOST_PORT"
  validate_port BACKEND_HOST_PORT "$BACKEND_HOST_PORT"
  validate_port POSTGRES_HOST_PORT "$POSTGRES_HOST_PORT"

  [[ -n "$APP_DB_PASSWORD" && "$APP_DB_PASSWORD" != "replace_with_url_safe_password" ]] \
    || fail "Set APP_DB_PASSWORD in this script before deploying"
  [[ "$APP_DB_PASSWORD" != *$'\n'* ]] || fail "APP_DB_PASSWORD must not contain newlines"
  [[ "$APP_DB_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]] \
    || fail "APP_DB_PASSWORD must be URL-safe; use letters, digits, '.', '_', '~', or '-'"

  [[ -n "$DATABRICKS_HOST" && "$DATABRICKS_HOST" != *"your-workspace"* ]] \
    || fail "Set DATABRICKS_HOST in this script before deploying"

  if [[ -z "$DATABRICKS_TOKEN" || "$DATABRICKS_TOKEN" == replace_with_* ]]; then
    [[ -n "$DATABRICKS_CLIENT_ID" && "$DATABRICKS_CLIENT_ID" != replace_with_* ]] \
      || fail "Set DATABRICKS_TOKEN, or set DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET"
    [[ -n "$DATABRICKS_CLIENT_SECRET" && "$DATABRICKS_CLIENT_SECRET" != replace_with_* ]] \
      || fail "Set DATABRICKS_TOKEN, or set DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET"
  fi

  [[ -n "$OPENAI_BASE_URL" && "$OPENAI_BASE_URL" != *"your-ai-gateway"* ]] \
    || fail "Set OPENAI_BASE_URL in this script before deploying"
  [[ -n "$OPENAI_API_KEY" && "$OPENAI_API_KEY" != replace_with_* ]] \
    || fail "Set OPENAI_API_KEY in this script before deploying"
}

write_env_value() {
  local name="$1"
  local value="$2"
  [[ "$value" != *$'\n'* ]] || fail "$name must not contain newlines"
  printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
}

write_runtime_files() {
  mkdir -p "$INIT_DIR"
  umask 077

  : > "$ENV_FILE"
  write_env_value COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
  write_env_value IMAGE_REGISTRY_PREFIX "$IMAGE_REGISTRY_PREFIX"
  write_env_value IMAGE_VERSION "$IMAGE_VERSION"
  write_env_value BACKEND_IMAGE_NAME "$BACKEND_IMAGE_NAME"
  write_env_value FRONTEND_IMAGE_NAME "$FRONTEND_IMAGE_NAME"
  write_env_value POSTGRES_IMAGE "$POSTGRES_IMAGE"
  write_env_value FRONTEND_HOST_PORT "$FRONTEND_HOST_PORT"
  write_env_value BACKEND_HOST_PORT "$BACKEND_HOST_PORT"
  write_env_value POSTGRES_HOST_PORT "$POSTGRES_HOST_PORT"
  write_env_value APP_DB_NAME "$APP_DB_NAME"
  write_env_value APP_DB_USER "$APP_DB_USER"
  write_env_value APP_DB_SCHEMA "$APP_DB_SCHEMA"
  write_env_value APP_DB_PASSWORD "$APP_DB_PASSWORD"
  write_env_value DATABRICKS_HOST "$DATABRICKS_HOST"
  write_env_value DATABRICKS_TOKEN "$DATABRICKS_TOKEN"
  write_env_value DATABRICKS_CLIENT_ID "$DATABRICKS_CLIENT_ID"
  write_env_value DATABRICKS_CLIENT_SECRET "$DATABRICKS_CLIENT_SECRET"
  write_env_value OPENAI_BASE_URL "$OPENAI_BASE_URL"
  write_env_value OPENAI_API_KEY "$OPENAI_API_KEY"

  cat > "$COMPOSE_FILE" <<'YAML'
name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}

services:
  postgres:
    image: ${POSTGRES_IMAGE:-postgres:17-alpine}
    container_name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${APP_DB_NAME:-builder_app}
      POSTGRES_USER: ${APP_DB_USER:-builder_app}
      POSTGRES_PASSWORD: ${APP_DB_PASSWORD}
      APP_DB_SCHEMA: ${APP_DB_SCHEMA:-builder_app}
    command: ["postgres", "-c", "port=5432"]
    ports:
      - "127.0.0.1:${POSTGRES_HOST_PORT:-5433}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${APP_DB_USER:-builder_app} -d ${APP_DB_NAME:-builder_app} -p 5432"]
      interval: 5s
      timeout: 5s
      retries: 20

  backend:
    image: ${IMAGE_REGISTRY_PREFIX}${BACKEND_IMAGE_NAME:-builder-app-oai-backend}:${IMAGE_VERSION:-latest}
    container_name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}-backend
    restart: unless-stopped
    environment:
      ENV: development
      BACKEND_PORT: 8000
      PROJECTS_BASE_DIR: /app/databricks-builder-app-oai/projects
      LAKEBASE_PG_URL: postgresql://${APP_DB_USER:-builder_app}:${APP_DB_PASSWORD}@postgres:5432/${APP_DB_NAME:-builder_app}?sslmode=disable
      LAKEBASE_DATABASE_NAME: ${APP_DB_NAME:-builder_app}
      LAKEBASE_SCHEMA_NAME: ${APP_DB_SCHEMA:-builder_app}
      BUILDER_AGENT_RUNTIME: openai_agents
      OPENAI_AGENTS_DISABLE_TRACING: "1"
      SKILLS_ONLY_MODE: "false"
      ENABLED_SKILLS: ""
      DATABRICKS_HOST: ${DATABRICKS_HOST}
      DATABRICKS_TOKEN: ${DATABRICKS_TOKEN:-}
      DATABRICKS_CLIENT_ID: ${DATABRICKS_CLIENT_ID:-}
      DATABRICKS_CLIENT_SECRET: ${DATABRICKS_CLIENT_SECRET:-}
      OPENAI_BASE_URL: ${OPENAI_BASE_URL}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      OPENAI_AGENT_MODEL: deepseek-v4-pro
      OPENAI_TITLE_MODEL: deepseek-v4-flash
      MLFLOW_TRACKING_URI: databricks
      MLFLOW_EXPERIMENT_NAME: ""
      ENABLE_MCP_GATEWAY: "false"
      FASTMCP_STATELESS_HTTP: "true"
    ports:
      - "127.0.0.1:${BACKEND_HOST_PORT:-8008}:8000"
    volumes:
      - projects:/app/databricks-builder-app-oai/projects
      - logs:/app/databricks-builder-app-oai/logs
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8000/api/config/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s

  frontend:
    image: ${IMAGE_REGISTRY_PREFIX}${FRONTEND_IMAGE_NAME:-builder-app-oai-frontend}:${IMAGE_VERSION:-latest}
    container_name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}-frontend
    restart: unless-stopped
    environment:
      FRONTEND_PORT: 8080
      BACKEND_URL: http://${COMPOSE_PROJECT_NAME:-builder-app-oai}-backend:8000
    ports:
      - "0.0.0.0:${FRONTEND_HOST_PORT:-3001}:8080"
    depends_on:
      backend:
        condition: service_started

volumes:
  postgres-data:
    name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}-postgres-data
  projects:
    name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}-projects
  logs:
    name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}-logs

networks:
  default:
    name: ${COMPOSE_PROJECT_NAME:-builder-app-oai}
YAML

  cat > "$INIT_FILE" <<'SH'
#!/bin/sh
set -eu

schema="${APP_DB_SCHEMA:-builder_app}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_db="$POSTGRES_DB" \
  -v app_user="$POSTGRES_USER" \
  -v app_schema="$schema" <<'SQL'
CREATE SCHEMA IF NOT EXISTS :"app_schema" AUTHORIZATION :"app_user";
GRANT USAGE, CREATE ON SCHEMA :"app_schema" TO :"app_user";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA :"app_schema" TO :"app_user";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA :"app_schema" TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"app_schema" GRANT ALL ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"app_schema" GRANT ALL ON SEQUENCES TO :"app_user";
ALTER ROLE :"app_user" IN DATABASE :"app_db" SET search_path = :"app_schema", public;
SQL
SH
  chmod 755 "$INIT_DIR" "$INIT_FILE"
}

compose() {
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

print_endpoints() {
  cat <<EOF
Deployment directory: $DEPLOY_DIR
Frontend:   http://127.0.0.1:$FRONTEND_HOST_PORT
Backend:    http://127.0.0.1:$BACKEND_HOST_PORT/api/config/health
PostgreSQL: 127.0.0.1:$POSTGRES_HOST_PORT
Status:     docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
EOF
}

validate_runtime
write_runtime_files

case "$ACTION" in
  up)
    validate_required_config
    if [[ "$PULL_IMAGES" == true ]]; then
      compose pull
    fi
    compose up -d --no-build
    print_endpoints
    ;;
  pull)
    compose pull
    ;;
  ps)
    compose ps
    ;;
  logs)
    compose logs -f
    ;;
  restart)
    validate_required_config
    if [[ "$PULL_IMAGES" == true ]]; then
      compose pull
    fi
    compose up -d --no-build --force-recreate
    print_endpoints
    ;;
  down)
    compose down
    ;;
  *)
    fail "Unsupported action: $ACTION"
    ;;
esac
