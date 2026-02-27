#!/usr/bin/env sh
# Shadow — one-command launcher
#
# See: ./start.sh --help

set -e

REGISTRY_IMAGE="ghcr.io/taikoxyz/shadow:latest"
EXPECTED_CIRCUIT_ID="0xac4b31fadeb0115a1e6019c8bccc0ddf900fe6e40a447409d9ce6b257913dcbc"
CONTAINER="shadow"
WORKSPACE="$PWD/workspace"
RISC0_WORK_DIR="$WORKSPACE/.risc0-work"
FORCE_PULL=false
FORCE_BUILD=false
VERBOSE=false
VERBOSE_LEVEL=""
BENCHMARK=false
CONTAINER_MEMORY=""
CONTAINER_CPUS=""
PROVE_FILE=""
OUTPUT_PATH=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '\033[1;34m  →  \033[0m%s\n' "$*"; }
ok()    { printf '\033[1;32m  ✓  \033[0m%s\n' "$*"; }
warn()  { printf '\033[1;33m  ⚠  \033[0m%s\n' "$*"; }
err()   { printf '\033[1;31m  ✗  \033[0m%s\n' "$*" >&2; exit 1; }
debug() { [ "$VERBOSE" = true ] && printf '\033[0;90m     %s\033[0m\n' "$*"; return 0; }

# Extract a JSON string field value: json_str "$json" "fieldName"
json_str() { printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | cut -d'"' -f4; }
# Extract a JSON integer field value: json_int "$json" "fieldName"
json_int() { printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | cut -d':' -f2; }

show_help() {
  cat <<EOF

Shadow — privacy-preserving ETH transfers on Taiko

USAGE
  ./start.sh [OPTIONS] [PORT]          Start the Shadow server and open the UI
  ./start.sh --prove <FILE> [OPTIONS]  Generate a ZK proof for a deposit file
  curl -fsSL https://raw.githubusercontent.com/taikoxyz/shadow/main/start.sh | sh

UI MODE OPTIONS
  PORT                Port to listen on (default: first free port in 3000-3099)
  --pull              Force pull the latest image from the registry
  --build             Force build the image from source (requires a clone)
  --clean             Delete all local shadow images and containers, then exit
  --clear-cache       Remove Docker BuildKit build cache, then exit
  --benchmark         Monitor CPU/memory during proving and write metrics to workspace
  --memory SIZE       Container memory limit (default: 8g, e.g. 4g, 512m)
  --cpus N            Container CPU limit (default: 4)
  --verbose [LEVEL]   Verbosity: info (default), debug, or trace
                      Also shows docker build/pull output and launcher details

PROVE MODE OPTIONS
  --prove FILE        Deposit JSON file to generate a proof for
  --output PATH       Where to write the proof file (default: current directory)
                      Can be a directory or a full file path
  --pull              Force pull the latest image before proving
  --build             Force build the image before proving
  --memory SIZE       Container memory limit
  --cpus N            Container CPU limit

WHAT IT DOES (UI MODE)
  1. Checks Docker and verifies available resources (CPU, memory, disk)
  2. Resolves the image: local match → registry pull → build from source
  3. Selects an available port (default range 3000-3099)
  4. Creates ./workspace if missing
  5. Starts the container and opens the browser

WHAT IT DOES (PROVE MODE)
  1. Validates the deposit file (must be a deposit-*.json file)
  2. Reuses an already-running Shadow server if one is healthy, otherwise starts one
  3. Copies the deposit file into the workspace if needed
  4. Calls POST /api/deposits/{id}/prove and streams progress
  5. Copies the resulting proof JSON to the output path

EXAMPLES
  ./start.sh                                    Start on first available port
  ./start.sh 3001                               Start on port 3001
  ./start.sh --pull                             Pull latest image and start
  ./start.sh --build                            Build from source and start
  ./start.sh --verbose debug                    Start with debug logging
  ./start.sh --prove deposit-abc-def-20260101T120000.json
  ./start.sh --prove my-deposit.json --output /tmp/proof.json
  ./start.sh --prove my-deposit.json --output ./proofs/

REQUIREMENTS
  Docker Desktop with at least 8 GB RAM and 4 CPUs allocated.
  ZK proof generation is CPU-intensive and may take 5-30 minutes.

EOF
}

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

# Check if a local image matches the expected circuit ID
image_matches_circuit_id() {
  local image="$1"
  local cid
  cid=$(docker run --rm --entrypoint cat "$image" /tmp/circuit-id.txt 2>/dev/null | tr -d '[:space:]' || true)
  debug "Image '$image' circuit ID: ${cid:-<none>}"
  debug "Expected circuit ID: $EXPECTED_CIRCUIT_ID"
  [ "$cid" = "$EXPECTED_CIRCUIT_ID" ]
}

# Build image from source
build_from_source() {
  local dockerfile_dir
  dockerfile_dir="$(dirname "$0")"
  if [ ! -f "$dockerfile_dir/docker/Dockerfile" ]; then
    err "No Dockerfile found. Clone the repo and run from inside it:\n  git clone https://github.com/taikoxyz/shadow && cd shadow && ./start.sh"
  fi

  # Pre-pull base images in parallel (matches FROM lines in docker/Dockerfile)
  info "Pre-pulling base images..."
  docker pull node:20-bookworm > /dev/null 2>&1 &
  local pid1=$!
  docker pull rust:bookworm > /dev/null 2>&1 &
  local pid2=$!
  docker pull debian:bookworm-slim > /dev/null 2>&1 &
  local pid3=$!
  wait "$pid1" && debug "Cached node:20-bookworm" || debug "Failed to pull node:20-bookworm"
  wait "$pid2" && debug "Cached rust:bookworm" || debug "Failed to pull rust:bookworm"
  wait "$pid3" && debug "Cached debian:bookworm-slim" || debug "Failed to pull debian:bookworm-slim"

  local build_start
  build_start=$(date +%s)

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

  local build_end elapsed_s elapsed_min elapsed_sec
  build_end=$(date +%s)
  elapsed_s=$((build_end - build_start))
  elapsed_min=$((elapsed_s / 60))
  elapsed_sec=$((elapsed_s % 60))

  local built_id
  built_id=$(docker run --rm --entrypoint cat shadow-local /tmp/circuit-id.txt 2>/dev/null | tr -d '[:space:]' || true)

  local build_ts git_sha
  build_ts=$(date -u +"%Y%m%d-%H%M%S")
  git_sha=$(git -C "$dockerfile_dir" rev-parse --short HEAD 2>/dev/null || echo "")
  if [ -n "$built_id" ]; then
    docker tag shadow-local "shadow-local:${built_id}"
    debug "Tagged shadow-local:${built_id}"
  fi
  docker tag shadow-local "shadow-local:${build_ts}"
  debug "Tagged shadow-local:${build_ts}"
  if [ -n "$git_sha" ]; then
    docker tag shadow-local "shadow-local:${git_sha}"
    debug "Tagged shadow-local:${git_sha}"
  fi

  local image_size
  image_size=$(docker image inspect shadow-local --format '{{.Size}}' 2>/dev/null || echo "0")
  image_size_mb=$((image_size / 1048576))

  ok "Image built — circuit ID: ${built_id:-unknown}"
  info "Build time: ${elapsed_min}m ${elapsed_sec}s"
  info "Image size: ${image_size_mb}MB"
  info "Docker CPUs: ${docker_cpus:-?} | Memory: ${mem_gb:-?}GB"
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --pull)  FORCE_PULL=true; shift ;;
    --build) FORCE_BUILD=true; shift ;;
    --clean)       FORCE_CLEAN=true; shift ;;
    --clear-cache) CLEAR_CACHE=true; shift ;;
    --benchmark)   BENCHMARK=true; shift ;;
    --memory)  shift; CONTAINER_MEMORY="${1:?--memory requires a value (e.g. 8g)}"; shift ;;
    --cpus)    shift; CONTAINER_CPUS="${1:?--cpus requires a value (e.g. 4)}"; shift ;;
    --prove)   shift; PROVE_FILE="${1:?--prove requires a deposit file path}"; shift ;;
    --output)  shift; OUTPUT_PATH="${1:?--output requires a path}"; shift ;;
    --verbose)
      VERBOSE=true; shift
      case "${1:-}" in
        info|debug|trace) VERBOSE_LEVEL="$1"; shift ;;
        *)                VERBOSE_LEVEL="info" ;;
      esac
      ;;
    -*)      printf 'Unknown option: %s\nRun ./start.sh --help for usage.\n' "$1" >&2; exit 1 ;;
    *)       PORT="$1"; shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Prove mode: validate deposit file, check for an existing healthy server
# ---------------------------------------------------------------------------
PROVE_REUSE=false
if [ -n "$PROVE_FILE" ]; then
  [ -f "$PROVE_FILE" ] || err "Deposit file not found: $PROVE_FILE"

  DEPOSIT_BASENAME=$(basename "$PROVE_FILE")
  DEPOSIT_ID="${DEPOSIT_BASENAME%.json}"

  # Validate naming convention expected by the server scanner
  case "$DEPOSIT_BASENAME" in
    deposit-*.json) ;;
    *) warn "File '$DEPOSIT_BASENAME' does not follow the deposit-*.json naming convention." ;;
  esac

  # If the shadow container is already running and healthy, reuse it
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^shadow$"; then
    cport=$(docker port shadow 3000 2>/dev/null | awk -F: '{print $NF}' | tr -d ' ')
    if [ -n "$cport" ] && curl -sf "http://localhost:$cport/api/config" > /dev/null 2>&1; then
      PROVE_REUSE=true
      PORT="$cport"
      URL="http://localhost:$PORT"
      ok "Reusing existing Shadow server on port $PORT"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Full container startup (skipped in prove mode when a server is already up)
# ---------------------------------------------------------------------------
if [ "$PROVE_REUSE" = false ]; then

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
# 2. Check Docker resources
# ---------------------------------------------------------------------------
MIN_MEMORY_GB=8
MIN_CPUS=4
MIN_DISK_GB=10

resource_warning=false

# CPU check
docker_cpus=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo 0)
debug "Docker CPUs: $docker_cpus (minimum: $MIN_CPUS)"
if [ "$docker_cpus" -lt "$MIN_CPUS" ] 2>/dev/null; then
  warn "Docker has ${docker_cpus} CPUs (minimum: ${MIN_CPUS})"
  resource_warning=true
else
  ok "CPUs: $docker_cpus"
fi

# Memory check (MemTotal is in bytes)
mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
mem_gb=$(echo "$mem_bytes" | awk '{printf "%d", $1 / 1073741824}')
debug "Docker memory: ${mem_gb}GB (minimum: ${MIN_MEMORY_GB}GB)"
if [ "$mem_gb" -lt "$MIN_MEMORY_GB" ] 2>/dev/null; then
  warn "Docker has ${mem_gb}GB memory (minimum: ${MIN_MEMORY_GB}GB)"
  resource_warning=true
else
  ok "Memory: ${mem_gb}GB"
fi

# Disk check (available space on host)
disk_avail_kb=$(df -k / | awk 'NR==2 {print $4}')
disk_avail_gb=$((disk_avail_kb / 1048576))
debug "Available disk: ${disk_avail_gb}GB (minimum: ${MIN_DISK_GB}GB)"
if [ "$disk_avail_gb" -lt "$MIN_DISK_GB" ] 2>/dev/null; then
  warn "Only ${disk_avail_gb}GB disk space available (minimum: ${MIN_DISK_GB}GB)"
  resource_warning=true
else
  ok "Disk: ${disk_avail_gb}GB available"
fi

if [ "$resource_warning" = true ]; then
  warn "ZK proof generation needs adequate resources."
  warn "Increase limits in Docker Desktop → Settings → Resources."
fi

# Compute container resource limits
if [ -z "$CONTAINER_MEMORY" ]; then
  if [ "$mem_gb" -gt "$MIN_MEMORY_GB" ]; then
    CONTAINER_MEMORY="${mem_gb}g"
  else
    CONTAINER_MEMORY="${MIN_MEMORY_GB}g"
  fi
fi
if [ -z "$CONTAINER_CPUS" ]; then
  if [ "$docker_cpus" -gt "$MIN_CPUS" ]; then
    CONTAINER_CPUS="$docker_cpus"
  else
    CONTAINER_CPUS="$MIN_CPUS"
  fi
fi
debug "Container limits: --memory $CONTAINER_MEMORY --cpus $CONTAINER_CPUS"

# ---------------------------------------------------------------------------
# 3. Clean (if requested) and exit
# ---------------------------------------------------------------------------
if [ "${FORCE_CLEAN:-false}" = true ]; then
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    info "Removing container '$CONTAINER'..."
    docker rm -f "$CONTAINER" > /dev/null
  fi
  removed=0
  for image in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^shadow-local') "$REGISTRY_IMAGE"; do
    if docker image inspect "$image" > /dev/null 2>&1; then
      info "Removing image '$image'..."
      docker rmi "$image" > /dev/null 2>&1 || true
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
# 3b. Clear Docker build cache (if requested) and exit
# ---------------------------------------------------------------------------
if [ "${CLEAR_CACHE:-false}" = true ]; then
  info "Clearing Docker BuildKit build cache..."
  docker builder prune --all --force
  ok "Build cache cleared"
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Resolve image
# ---------------------------------------------------------------------------
if [ "$FORCE_BUILD" = true ]; then
  for img in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^shadow-local') "$REGISTRY_IMAGE"; do
    if docker image inspect "$img" > /dev/null 2>&1; then
      debug "Removing old image '$img'..."
      docker rmi "$img" > /dev/null 2>&1 || true
    fi
  done
  build_from_source
  USE_IMAGE="shadow-local"

elif [ "$FORCE_PULL" = true ]; then
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
# 5. Determine port
# ---------------------------------------------------------------------------
if [ -n "$PORT" ]; then
  if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    err "Port $PORT is already in use. Run without arguments to auto-select a free port."
  fi
else
  PORT="$(find_free_port 3000 3099)"
fi
URL="http://localhost:$PORT"
ok "Using port $PORT"

# ---------------------------------------------------------------------------
# 6. Stop any existing shadow container
# ---------------------------------------------------------------------------
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  info "Stopping existing '$CONTAINER' container..."
  docker stop "$CONTAINER" > /dev/null
fi
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker rm "$CONTAINER" > /dev/null
fi

# ---------------------------------------------------------------------------
# 7. Create workspace
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE"
mkdir -p "$RISC0_WORK_DIR"
ok "Workspace: $WORKSPACE"
debug "RISC0_WORK_DIR: $RISC0_WORK_DIR"

# ---------------------------------------------------------------------------
# 8. Start container
# ---------------------------------------------------------------------------
info "Starting Shadow at $URL ..."
debug "Image: $USE_IMAGE"
debug "Port mapping: ${PORT}:3000"
debug "Workspace: $WORKSPACE:/workspace"
debug "RUST_LOG: shadow_server=${VERBOSE_LEVEL:-info}"

RUST_LOG_ENV=""
if [ -n "$VERBOSE_LEVEL" ]; then
  RUST_LOG_ENV="shadow_server=$VERBOSE_LEVEL"
fi

docker run -d \
  --name "$CONTAINER" \
  --platform linux/amd64 \
  --memory "$CONTAINER_MEMORY" \
  --cpus "$CONTAINER_CPUS" \
  -p "${PORT}:3000" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WORKSPACE:/workspace" \
  -v "$WORKSPACE:$WORKSPACE" \
  -e RPC_URL=https://rpc.hoodi.taiko.xyz \
  -e SHADOW_ADDRESS=0x77cdA0575e66A5FC95404fdA856615AD507d8A07 \
  -e DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  -e RISC0_WORK_DIR="$RISC0_WORK_DIR" \
  -e RECEIPT_KIND=groth16 \
  ${RUST_LOG_ENV:+-e RUST_LOG="$RUST_LOG_ENV"} \
  "$USE_IMAGE" > /dev/null

ok "Container started (logs: docker logs -f $CONTAINER)"

# ---------------------------------------------------------------------------
# 9. Wait for server
# ---------------------------------------------------------------------------
if wait_for_server "$URL"; then
  ok "Shadow is running at $URL"
  # Open browser only in UI mode (not prove mode)
  [ -z "$PROVE_FILE" ] && open_browser "$URL"
else
  err "Server did not respond in time. Check: docker logs $CONTAINER"
fi

fi  # end: PROVE_REUSE = false

# ---------------------------------------------------------------------------
# Workspace: ensure it exists (needed in prove mode when reusing a container)
# ---------------------------------------------------------------------------
mkdir -p "$WORKSPACE"

# ---------------------------------------------------------------------------
# 10. Benchmark monitor (UI mode only) — blocks until container stops or Ctrl+C
# ---------------------------------------------------------------------------
if [ -z "$PROVE_FILE" ] && [ "$BENCHMARK" = true ]; then
  BENCH_FILE="$WORKSPACE/benchmark.csv"
  BENCH_SUMMARY="$WORKSPACE/benchmark-summary.txt"

  printf 'timestamp,cpu_pct,mem_usage,mem_limit,mem_pct,net_io,block_io,pids\n' > "$BENCH_FILE"

  info "Benchmark monitoring enabled — sampling every 2s"
  info "Metrics: $BENCH_FILE"
  info "Press Ctrl+C to stop monitoring and write summary"

  cleanup_benchmark() {
    if [ ! -f "$BENCH_FILE" ] || [ "$(wc -l < "$BENCH_FILE")" -le 1 ]; then
      info "No benchmark samples collected"
      exit 0
    fi

    peak_cpu=$(awk -F',' 'NR>1 {gsub(/%/,"",$2); if($2+0 > max) max=$2+0} END {printf "%.1f", max}' "$BENCH_FILE")
    peak_mem=$(awk -F',' 'NR>1 {if($3 > max) max=$3} END {print max}' "$BENCH_FILE")
    peak_mem_pct=$(awk -F',' 'NR>1 {gsub(/%/,"",$5); if($5+0 > max) max=$5+0} END {printf "%.1f", max}' "$BENCH_FILE")
    sample_count=$(awk 'END {print NR-1}' "$BENCH_FILE")
    duration_s=$((sample_count * 2))
    duration_min=$((duration_s / 60))
    duration_sec=$((duration_s % 60))

    {
      echo "Shadow Proving Benchmark"
      echo "========================"
      echo "Date:           $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      echo "Duration:       ${duration_min}m ${duration_sec}s (${sample_count} samples)"
      echo "Peak CPU:       ${peak_cpu}%"
      echo "Peak memory:    ${peak_mem} (${peak_mem_pct}% of limit)"
      echo "Docker CPUs:    ${docker_cpus:-?}"
      echo "Docker memory:  ${mem_gb:-?}GB"
      echo "Container:      --memory $CONTAINER_MEMORY --cpus $CONTAINER_CPUS"
      echo ""
      echo "Raw metrics:    $BENCH_FILE"
    } > "$BENCH_SUMMARY"

    echo ""
    ok "Benchmark summary written to $BENCH_SUMMARY"
    cat "$BENCH_SUMMARY"
    exit 0
  }

  trap cleanup_benchmark INT TERM

  while docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; do
    stats=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}' "$CONTAINER" 2>/dev/null || true)
    if [ -n "$stats" ]; then
      mem_usage=$(echo "$stats" | cut -d',' -f2 | cut -d'/' -f1 | tr -d ' ')
      mem_limit=$(echo "$stats" | cut -d',' -f2 | cut -d'/' -f2 | tr -d ' ')
      cpu=$(echo "$stats" | cut -d',' -f1)
      mem_pct=$(echo "$stats" | cut -d',' -f3)
      net_io=$(echo "$stats" | cut -d',' -f4)
      block_io=$(echo "$stats" | cut -d',' -f5)
      pids=$(echo "$stats" | cut -d',' -f6)
      printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$(date +%s)" "$cpu" "$mem_usage" "$mem_limit" "$mem_pct" "$net_io" "$block_io" "$pids" >> "$BENCH_FILE"
    fi
    sleep 2
  done

  cleanup_benchmark
fi

# ---------------------------------------------------------------------------
# 11. Prove workflow
# ---------------------------------------------------------------------------
if [ -n "$PROVE_FILE" ]; then

  # Copy deposit file into workspace if it isn't already there
  dest_deposit="$WORKSPACE/$DEPOSIT_BASENAME"
  prove_abs=$(cd "$(dirname "$PROVE_FILE")" && pwd)/$(basename "$PROVE_FILE")
  if [ "$prove_abs" = "$dest_deposit" ]; then
    debug "Deposit file is already in workspace"
  else
    cp "$PROVE_FILE" "$dest_deposit"
    debug "Copied deposit file to workspace: $dest_deposit"
  fi

  # Trigger proof generation
  info "Starting proof for: $DEPOSIT_ID"
  prove_resp=$(curl -sf -X POST "$URL/api/deposits/$DEPOSIT_ID/prove" 2>&1) || {
    err "Failed to start prove job (is '$DEPOSIT_BASENAME' a valid deposit file?):\n  $prove_resp"
  }
  debug "Prove response: $prove_resp"

  # Poll the queue until done
  i=0
  last_msg=""
  while true; do
    q=$(curl -sf "$URL/api/queue" 2>/dev/null || echo "null")
    status=$(json_str "$q" "status")
    cur=$(json_int "$q" "currentNote")
    tot=$(json_int "$q" "totalNotes")
    msg=$(json_str "$q" "message")

    case "$status" in
      completed)
        printf '\n'
        ok "Proof generation complete"
        break
        ;;
      failed|cancelled)
        printf '\n'
        err_detail=$(json_str "$q" "error")
        err "Proving ${status}: ${err_detail:-$msg}"
        ;;
      running|queued)
        if [ "$msg" != "$last_msg" ]; then
          note_info=""
          [ -n "$tot" ] && [ "$tot" != "0" ] && note_info=" (note $((cur + 1))/$tot)"
          printf '\r\033[0;90m  →  %s%s\033[0m\033[K' "$msg" "$note_info"
          last_msg="$msg"
        fi
        ;;
      *)
        # Queue is null/empty — job may not have registered yet or already finished
        if [ "$i" -gt 3 ]; then
          dep=$(curl -sf "$URL/api/deposits/$DEPOSIT_ID" 2>/dev/null || echo "{}")
          if [ -n "$(json_str "$dep" "proofFile")" ]; then
            printf '\n'
            ok "Proof found in workspace"
            break
          fi
          printf '\n'
          err "Prove queue is empty but no proof file found. Check: docker logs $CONTAINER"
        fi
        ;;
    esac

    sleep 3
    i=$((i + 1))
    [ "$i" -gt 600 ] && printf '\n' && err "Prove timed out after 30 minutes"
  done

  # Locate the proof file
  dep=$(curl -sf "$URL/api/deposits/$DEPOSIT_ID" 2>/dev/null || echo "{}")
  proof_file=$(json_str "$dep" "proofFile")
  [ -n "$proof_file" ] || err "Could not locate proof file for deposit $DEPOSIT_ID"

  src="$WORKSPACE/$proof_file"
  [ -f "$src" ] || err "Proof file missing from workspace: $src"

  # Determine output destination
  if [ -n "$OUTPUT_PATH" ]; then
    if [ -d "$OUTPUT_PATH" ]; then
      dst="$OUTPUT_PATH/$proof_file"
    else
      mkdir -p "$(dirname "$OUTPUT_PATH")" 2>/dev/null || true
      dst="$OUTPUT_PATH"
    fi
  else
    dst="./$proof_file"
  fi

  cp "$src" "$dst"
  ok "Proof saved: $dst"
  info "Shadow server still running at $URL — use it to claim via the UI."

fi
