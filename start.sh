#!/usr/bin/env sh
# Shadow — one-command launcher
#
# Usage (no clone needed):
#   curl -fsSL https://raw.githubusercontent.com/taikoxyz/shadow/main/start.sh | sh
#
# Usage (from repo):
#   ./start.sh [options] [port]
#
# Options:
#   --pull     Force pull the latest image from registry (skip local check)
#   --build    Force build the image from source (skip local check and registry)
#   --clean    Delete all local shadow images and containers, then exit
#   --verbose  Show detailed output (docker build/pull logs, config details)
#
# What it does:
#   1. Checks for Docker
#   2. Resolves the image (local → registry → build from source)
#   3. Selects an available port (default range: 3000-3099)
#   4. Creates ./workspace if missing
#   5. Starts the container and opens the browser

set -e

REGISTRY_IMAGE="ghcr.io/taikoxyz/shadow:latest"
EXPECTED_CIRCUIT_ID="0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8"
CONTAINER="shadow"
WORKSPACE="$PWD/workspace"
FORCE_PULL=false
FORCE_BUILD=false
VERBOSE=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --pull)  FORCE_PULL=true; shift ;;
    --build) FORCE_BUILD=true; shift ;;
    --clean)   FORCE_CLEAN=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    -*)      printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
    *)       PORT="$1"; shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '\033[1;34m  →  \033[0m%s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓  \033[0m%s\n' "$*"; }
err()   { printf '\033[1;31m  ✗  \033[0m%s\n' "$*" >&2; exit 1; }
debug() { [ "$VERBOSE" = true ] && printf '\033[0;90m     %s\033[0m\n' "$*"; return 0; }

open_browser() {
  local url="$1"
  case "$(uname -s)" in
    Darwin)                   open "$url" ;;
    Linux)                    xdg-open "$url" 2>/dev/null || true ;;
    MINGW*|MSYS*|CYGWIN*)     start "$url" ;;
    *)                        info "Open your browser at $url" ;;
  esac
}

# Find the first free TCP port in the given range (default 3000-3099)
find_free_port() {
  local start="${1:-3000}"
  local end="${2:-3099}"
  local port="$start"
  while [ "$port" -le "$end" ]; do
    # Try opening a connection — if it fails the port is free
    if ! (exec 3<>/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done
  err "No free port found in range $start-$end"
}

wait_for_server() {
  local url="$1"
  info "Waiting for server to be ready..."
  i=0
  while [ "$i" -lt 30 ]; do
    if curl -sf "$url/api/config" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# Check if a local image matches the expected circuit ID label
image_matches_circuit_id() {
  local image="$1"
  local label
  label=$(docker inspect --format '{{ index .Config.Labels "org.taikoxyz.shadow.circuit-id" }}' "$image" 2>/dev/null || true)
  debug "Image '$image' circuit ID: ${label:-<none>}"
  debug "Expected circuit ID: $EXPECTED_CIRCUIT_ID"
  [ "$label" = "$EXPECTED_CIRCUIT_ID" ]
}

# Build image from source
build_from_source() {
  local dockerfile_dir
  dockerfile_dir="$(dirname "$0")"
  if [ ! -f "$dockerfile_dir/docker/Dockerfile" ]; then
    err "No Dockerfile found. Clone the repo and run from inside it:\n  git clone https://github.com/taikoxyz/shadow && cd shadow && ./start.sh"
  fi
  info "Building from source (this takes a while the first time)..."
  debug "Dockerfile: $dockerfile_dir/docker/Dockerfile"
  debug "Build context: $dockerfile_dir"
  if [ "$VERBOSE" = true ]; then
    docker build \
      --platform linux/amd64 \
      -f "$dockerfile_dir/docker/Dockerfile" \
      -t shadow-local \
      "$dockerfile_dir"
  else
    docker build \
      --platform linux/amd64 \
      -f "$dockerfile_dir/docker/Dockerfile" \
      -t shadow-local \
      "$dockerfile_dir" > /dev/null 2>&1
  fi
  ok "Image built"
}

# ---------------------------------------------------------------------------
# 1. Check Docker
# ---------------------------------------------------------------------------
if ! command -v docker > /dev/null 2>&1; then
  err "Docker is not installed. Get it at https://docs.docker.com/get-docker/"
fi
ok "Docker found"
debug "Docker version: $(docker --version)"
debug "Registry image: $REGISTRY_IMAGE"
debug "Expected circuit ID: $EXPECTED_CIRCUIT_ID"

# ---------------------------------------------------------------------------
# 2. Clean (if requested) and exit
# ---------------------------------------------------------------------------
if [ "${FORCE_CLEAN:-false}" = true ]; then
  # Stop and remove shadow containers
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    info "Removing container '$CONTAINER'..."
    docker rm -f "$CONTAINER" > /dev/null
  fi
  # Remove local shadow images
  removed=0
  for image in shadow-local "$REGISTRY_IMAGE"; do
    if docker image inspect "$image" > /dev/null 2>&1; then
      info "Removing image '$image'..."
      docker rmi "$image" > /dev/null
      removed=$((removed + 1))
    fi
  done
  if [ "$removed" -eq 0 ]; then
    ok "No shadow images found"
  else
    ok "Removed $removed image(s)"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Resolve image (before port selection — builds can take a while)
# ---------------------------------------------------------------------------
if [ "$FORCE_BUILD" = true ]; then
  # --build: always build from source
  build_from_source
  USE_IMAGE="shadow-local"

elif [ "$FORCE_PULL" = true ]; then
  # --pull: always pull from registry
  info "Pulling $REGISTRY_IMAGE ..."
  if [ "$VERBOSE" = true ]; then
    if docker pull --platform linux/amd64 "$REGISTRY_IMAGE"; then
      ok "Image pulled"
      USE_IMAGE="$REGISTRY_IMAGE"
    else
      err "Failed to pull $REGISTRY_IMAGE"
    fi
  else
    if docker pull --platform linux/amd64 "$REGISTRY_IMAGE" > /dev/null 2>&1; then
      ok "Image pulled"
      USE_IMAGE="$REGISTRY_IMAGE"
    else
      err "Failed to pull $REGISTRY_IMAGE"
    fi
  fi

else
  # Default: check local image → pull from registry → build from source
  if docker image inspect shadow-local > /dev/null 2>&1 && image_matches_circuit_id shadow-local; then
    ok "Using local image 'shadow-local' (circuit ID matches)"
    USE_IMAGE="shadow-local"
  else
    if docker image inspect shadow-local > /dev/null 2>&1; then
      info "Local image exists but circuit ID doesn't match — pulling from registry"
    fi
    info "Pulling $REGISTRY_IMAGE ..."
    if [ "$VERBOSE" = true ]; then
      docker pull --platform linux/amd64 "$REGISTRY_IMAGE" && pull_ok=true || pull_ok=false
    else
      docker pull --platform linux/amd64 "$REGISTRY_IMAGE" > /dev/null 2>&1 && pull_ok=true || pull_ok=false
    fi
    if [ "$pull_ok" = true ]; then
      ok "Image pulled"
      USE_IMAGE="$REGISTRY_IMAGE"
    else
      build_from_source
      USE_IMAGE="shadow-local"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 4. Determine port (after image is ready so long builds don't stale the port)
# ---------------------------------------------------------------------------
if [ -n "$PORT" ]; then
  # Verify the requested port is actually free
  if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    err "Port $PORT is already in use. Run without arguments to auto-select a free port."
  fi
else
  PORT="$(find_free_port 3000 3099)"
fi
URL="http://localhost:$PORT"
ok "Using port $PORT"

# ---------------------------------------------------------------------------
# 5. Stop any existing shadow container
# ---------------------------------------------------------------------------
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  info "Stopping existing '$CONTAINER' container..."
  docker stop "$CONTAINER" > /dev/null
fi
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker rm "$CONTAINER" > /dev/null
fi

# ---------------------------------------------------------------------------
# 6. Create workspace
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE"
ok "Workspace: $WORKSPACE"

# ---------------------------------------------------------------------------
# 7. Start container
# ---------------------------------------------------------------------------
info "Starting Shadow at $URL ..."
debug "Image: $USE_IMAGE"
debug "Port mapping: ${PORT}:3000"
debug "Workspace: $WORKSPACE:/workspace"
docker run -d \
  --name "$CONTAINER" \
  --platform linux/amd64 \
  -p "${PORT}:3000" \
  -v "$WORKSPACE:/workspace" \
  -e RPC_URL=https://rpc.hoodi.taiko.xyz \
  -e SHADOW_ADDRESS=0x77cdA0575e66A5FC95404fdA856615AD507d8A07 \
  -e VERIFIER_ADDRESS=0x38b6e672eD9577258e1339bA9263cD034C147014 \
  -e RECEIPT_KIND=groth16 \
  "$USE_IMAGE" > /dev/null

ok "Container started (logs: docker logs -f $CONTAINER)"

# ---------------------------------------------------------------------------
# 8. Wait and open browser
# ---------------------------------------------------------------------------
if wait_for_server "$URL"; then
  ok "Shadow is running at $URL"
  open_browser "$URL"
else
  err "Server did not respond in time. Check: docker logs $CONTAINER"
fi
