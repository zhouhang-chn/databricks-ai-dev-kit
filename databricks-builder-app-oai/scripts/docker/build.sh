#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$PROJECT_DIR/.deploy/docker.env}"

NO_CACHE=false
PULL=false
SERVICES=(backend frontend)
USE_CONFIG=false

usage() {
  cat <<'EOF'
Usage: databricks-builder-app-oai/scripts/docker/build.sh [options]

Build and push Builder App OAI Docker images.

Options:
  --backend-only       Build and push only the backend image
  --frontend-only      Build and push only the frontend image
  --config PATH        Env file to use (default: databricks-builder-app-oai/.deploy/docker.env)
  --no-cache           Build without Docker layer cache
  --pull               Always pull newer base images
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)
      SERVICES=(backend)
      shift
      ;;
    --frontend-only)
      SERVICES=(frontend)
      shift
      ;;
    --config)
      CONFIG_FILE="$2"
      USE_CONFIG=true
      shift 2
      ;;
    --no-cache)
      NO_CACHE=true
      shift
      ;;
    --pull)
      PULL=true
      shift
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

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is required. Install Docker with the buildx plugin." >&2
  exit 1
fi

if [[ "$USE_CONFIG" == true || -f "$CONFIG_FILE" ]]; then
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Config file not found: $CONFIG_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

IMAGE_REGISTRY_PREFIX="${IMAGE_REGISTRY_PREFIX:-azrbrewdatnonprodce2acr.azurecr.cn/brewdat-ds-cn/}"
IMAGE_VERSION="${IMAGE_VERSION:-latest}"
BACKEND_IMAGE_NAME="${BACKEND_IMAGE_NAME:-builder-app-oai-backend}"
FRONTEND_IMAGE_NAME="${FRONTEND_IMAGE_NAME:-builder-app-oai-frontend}"

BUILD_ARGS=(--push)
if [[ "$NO_CACHE" == true ]]; then
  BUILD_ARGS+=(--no-cache)
fi
if [[ "$PULL" == true ]]; then
  BUILD_ARGS+=(--pull)
fi

build_service() {
  local service="$1"
  local image_name="$2"
  local dockerfile="$3"
  local tag="${IMAGE_REGISTRY_PREFIX}${image_name}:${IMAGE_VERSION}"

  echo "Building and pushing $service image: $tag"
  docker buildx build \
    "${BUILD_ARGS[@]}" \
    -t "$tag" \
    -f "$dockerfile" \
    "$REPO_ROOT"
}

for service in "${SERVICES[@]}"; do
  case "$service" in
    backend)
      build_service backend "$BACKEND_IMAGE_NAME" "$PROJECT_DIR/Dockerfile.backend"
      ;;
    frontend)
      build_service frontend "$FRONTEND_IMAGE_NAME" "$PROJECT_DIR/client/Dockerfile"
      ;;
  esac
done
