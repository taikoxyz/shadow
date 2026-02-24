#!/usr/bin/env bash
# =============================================================================
# Taiko Shadow Prover - Docker Entrypoint
# =============================================================================
# Generates ZK proofs for all notes in a deposit file
# Usage: docker run -v $(pwd):/data ghcr.io/aspect-build/taiko-shadow /data/deposit.json
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

DEPOSIT_FILE="${1:-}"
RPC_URL="${RPC_URL:-}"
VERBOSE="${VERBOSE:-false}"

# Network defaults
declare -A DEFAULT_RPCS=(
  ["167000"]="https://rpc.taiko.xyz"
  ["167013"]="https://rpc.hoodi.taiko.xyz"
)

declare -A NETWORK_NAMES=(
  ["167000"]="taiko-mainnet"
  ["167013"]="taiko-hoodi"
)

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log() {
  echo "[shadow] $*"
}

error() {
  echo "[shadow] ERROR: $*" >&2
  exit 1
}

show_usage() {
  cat <<EOF
Taiko Shadow Prover

Usage:
  docker run -v \$(pwd):/data ghcr.io/aspect-build/taiko-shadow /data/deposit.json

Options:
  RPC_URL     Override the default RPC endpoint (env var)
  VERBOSE     Enable verbose output (env var, default: false)

Examples:
  # Generate proofs using default RPC
  docker run --rm -v \$(pwd):/data ghcr.io/aspect-build/taiko-shadow /data/my-deposit.json

  # Generate proofs with custom RPC
  docker run --rm -v \$(pwd):/data -e RPC_URL=https://custom-rpc.example.com \\
    ghcr.io/aspect-build/taiko-shadow /data/my-deposit.json

Output:
  Creates <deposit-name>-proofs.json in the same directory as the input file.
EOF
}

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [[ -z "${DEPOSIT_FILE}" ]]; then
  show_usage
  exit 1
fi

if [[ ! -f "${DEPOSIT_FILE}" ]]; then
  error "Deposit file not found: ${DEPOSIT_FILE}"
fi

# -----------------------------------------------------------------------------
# Parse Deposit File
# -----------------------------------------------------------------------------

cd /workspace

# Extract chain ID from deposit file
CHAIN_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${DEPOSIT_FILE}', 'utf8')).chainId)")

if [[ -z "${CHAIN_ID}" ]]; then
  error "Could not read chainId from deposit file"
fi

# Determine RPC URL
if [[ -z "${RPC_URL}" ]]; then
  RPC_URL="${DEFAULT_RPCS[${CHAIN_ID}]:-}"
  if [[ -z "${RPC_URL}" ]]; then
    error "No default RPC for chainId ${CHAIN_ID}. Set RPC_URL environment variable."
  fi
fi

# Get network name for display
NETWORK_NAME="${NETWORK_NAMES[${CHAIN_ID}]:-unknown}"

# Count notes
NOTE_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${DEPOSIT_FILE}', 'utf8')).notes.length)")

# Calculate output file path: deposit-x.json -> deposit-x-proofs.json
DEPOSIT_DIR=$(dirname "${DEPOSIT_FILE}")
DEPOSIT_BASENAME=$(basename "${DEPOSIT_FILE}" .json)
OUTPUT_FILE="${DEPOSIT_DIR}/${DEPOSIT_BASENAME}-proofs.json"

# -----------------------------------------------------------------------------
# Display Configuration
# -----------------------------------------------------------------------------

log "Starting proof generation..."
log "  Network: ${NETWORK_NAME} (chain ${CHAIN_ID})"
log "  Notes: ${NOTE_COUNT}"
log "  Input: ${DEPOSIT_FILE}"
log "  Output: ${OUTPUT_FILE}"
echo ""

# -----------------------------------------------------------------------------
# Generate Proofs
# -----------------------------------------------------------------------------

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "${TEMP_DIR}"' EXIT

PROOFS_ARRAY="[]"
GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

for i in $(seq 0 $((NOTE_COUNT - 1))); do
  log "Generating proof for note $((i + 1))/${NOTE_COUNT}..."

  TEMP_PROOF="${TEMP_DIR}/note-${i}.proof.json"

  # Build command
  cmd=(node packages/risc0-prover/scripts/shadowcli.mjs prove
    --deposit "${DEPOSIT_FILE}"
    --rpc "${RPC_URL}"
    --note-index "${i}"
    --receipt-kind groth16
    --proof-out "${TEMP_PROOF}"
  )

  if [[ "${VERBOSE}" == "true" ]]; then
    cmd+=(--verbose)
    "${cmd[@]}"
  else
    "${cmd[@]}" > /dev/null 2>&1
  fi

  if [[ ! -f "${TEMP_PROOF}" ]]; then
    error "Failed to generate proof for note ${i}"
  fi

  # Add proof to array
  PROOF_CONTENT=$(cat "${TEMP_PROOF}")
  PROOFS_ARRAY=$(node -e "
    const proofs = ${PROOFS_ARRAY};
    proofs.push(${PROOF_CONTENT});
    console.log(JSON.stringify(proofs));
  ")

  log "  Note $((i + 1)) complete"
done

# -----------------------------------------------------------------------------
# Create Consolidated Output
# -----------------------------------------------------------------------------

log ""
log "Creating consolidated proof file..."

node -e "
const output = {
  version: '1.0',
  chainId: '${CHAIN_ID}',
  network: '${NETWORK_NAME}',
  generatedAt: '${GENERATED_AT}',
  noteCount: ${NOTE_COUNT},
  proofs: ${PROOFS_ARRAY}
};
require('fs').writeFileSync('${OUTPUT_FILE}', JSON.stringify(output, null, 2));
"

log ""
log "Done! Proof file created: ${OUTPUT_FILE}"
log ""
