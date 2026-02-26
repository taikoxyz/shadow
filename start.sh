#!/usr/bin/env sh
# Shadow — one-command launcher
#
# Usage (no clone needed):
#   curl -fsSL https://raw.githubusercontent.com/taikoxyz/shadow/main/start.sh | sh
#
# Usage (from repo):
#   ./start.sh [port]          # optional: pin to a specific port
#
# What it does:
#   1. Checks for Docker
#   2. Uses local 'shadow-local' image, or pulls from registry, or builds
#   3. Creates ./workspace
#   4. Starts the container on an available port (default range: 3000-3099)
#   5. Opens the browser automatically

set -e

REGISTRY_IMAGE="ghcr.io/taikoxyz/shadow:latest"
CONTAINER="shadow"
WORKSPACE="$PWD/workspace"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '\033[1;34m  →  \033[0m%s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓  \033[0m%s\n' "$*"; }
err()   { printf '\033[1;31m  ✗  \033[0m%s\n' "$*" >&2; exit 1; }

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

# ---------------------------------------------------------------------------
# 1. Check Docker
# ---------------------------------------------------------------------------
if ! command -v docker > /dev/null 2>&1; then
  err "Docker is not installed. Get it at https://docs.docker.com/get-docker/"
fi
ok "Docker found"

# ---------------------------------------------------------------------------
# 2. Determine port
# ---------------------------------------------------------------------------
if [ -n "$1" ]; then
  PORT="$1"
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
# 3. Stop any existing shadow container
# ---------------------------------------------------------------------------
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  info "Stopping existing '$CONTAINER' container..."
  docker stop "$CONTAINER" > /dev/null
fi
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker rm "$CONTAINER" > /dev/null
fi

# ---------------------------------------------------------------------------
# 4. Resolve image
# ---------------------------------------------------------------------------
if docker image inspect shadow-local > /dev/null 2>&1; then
  ok "Using local image 'shadow-local'"
  USE_IMAGE="shadow-local"
else
  info "Pulling $REGISTRY_IMAGE ..."
  if docker pull --platform linux/amd64 "$REGISTRY_IMAGE" 2>/dev/null; then
    ok "Image pulled"
    USE_IMAGE="$REGISTRY_IMAGE"
  elif [ -f "$(dirname "$0")/docker/Dockerfile" ]; then
    info "Pull failed — building from source (this takes a while the first time)..."
    docker build \
      --platform linux/amd64 \
      -f "$(dirname "$0")/docker/Dockerfile" \
      -t shadow-local \
      "$(dirname "$0")"
    ok "Image built"
    USE_IMAGE="shadow-local"
  else
    err "Could not pull image and no Dockerfile found.\nClone the repo and run from inside it:\n  git clone https://github.com/taikoxyz/shadow && cd shadow && ./start.sh"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Create workspace
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE"
ok "Workspace: $WORKSPACE"

# ---------------------------------------------------------------------------
# 6. Start container
# ---------------------------------------------------------------------------
info "Starting Shadow at $URL ..."
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
# 7. Wait and open browser
# ---------------------------------------------------------------------------
if wait_for_server "$URL"; then
  ok "Shadow is running at $URL"
  open_browser "$URL"
else
  err "Server did not respond in time. Check: docker logs $CONTAINER"
fi
