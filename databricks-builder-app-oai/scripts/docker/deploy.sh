#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
CONFIG_FILE="${CONFIG_FILE:-$PROJECT_DIR/.deploy/docker.env}"
BUILD=false

usage() {
  cat <<'EOF'
Usage: databricks-builder-app-oai/scripts/docker/deploy.sh [options]

Deploy Builder App OAI with Docker Compose.

Options:
  --build              Build backend and frontend images before starting services
  --config PATH        Compose env file to use (default: databricks-builder-app-oai/.deploy/docker.env)
  -h, --help           Show this help

First-time setup:
  mkdir -p databricks-builder-app-oai/.deploy
  cp databricks-builder-app-oai/scripts/docker/docker.env.example databricks-builder-app-oai/.deploy/docker.env
  $EDITOR databricks-builder-app-oai/.deploy/docker.env
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      BUILD=true
      shift
      ;;
    --config)
      CONFIG_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Install Docker with the compose plugin." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing config file: $CONFIG_FILE" >&2
  echo "" >&2
  echo "Create it from the template and edit values:" >&2
  echo "  mkdir -p databricks-builder-app-oai/.deploy" >&2
  echo "  cp databricks-builder-app-oai/scripts/docker/docker.env.example databricks-builder-app-oai/.deploy/docker.env" >&2
  echo "  \$EDITOR databricks-builder-app-oai/.deploy/docker.env" >&2
  exit 1
fi

compose=(docker compose --env-file "$CONFIG_FILE" -f "$COMPOSE_FILE")

if [[ "$BUILD" == true ]]; then
  "$SCRIPT_DIR/build.sh" --config "$CONFIG_FILE"
fi

"${compose[@]}" pull backend frontend
"${compose[@]}" up -d --no-build

frontend_port="$(grep -E '^FRONTEND_HOST_PORT=' "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true)"
backend_port="$(grep -E '^BACKEND_HOST_PORT=' "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true)"
postgres_port="$(grep -E '^POSTGRES_HOST_PORT=' "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true)"

echo "Deployment complete"
echo "Frontend:   http://127.0.0.1:${frontend_port:-3001}"
echo "Backend:    http://127.0.0.1:${backend_port:-8008}/api/config/health"
echo "PostgreSQL: 127.0.0.1:${postgres_port:-5433}"
echo "Compose:    docker compose --env-file $CONFIG_FILE -f $COMPOSE_FILE ps"
