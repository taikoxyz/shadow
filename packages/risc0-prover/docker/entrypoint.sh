#!/usr/bin/env bash
# =============================================================================
# Taiko Shadow Prover - Docker Entrypoint
# =============================================================================
# Two-phase proof generation for Shadow Protocol deposits
#
# Phase 1 (prove): Generate succinct STARK proofs (no Docker-in-Docker)
# Phase 2 (compress): Convert to Groth16 for on-chain verification (needs Docker socket)
#
# Usage:
#   # Phase 1: Generate succinct proofs
#   docker run --rm -v $(pwd):/data ghcr.io/taikoxyz/taiko-shadow prove /data/deposit.json
#
#   # Phase 2: Compress to Groth16
#   docker run --rm -v $(pwd):/data -v /var/run/docker.sock:/var/run/docker.sock \
#     ghcr.io/taikoxyz/taiko-shadow compress /data/deposit-succinct.json
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

MODE="${1:-}"
INPUT_FILE="${2:-}"
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
Taiko Shadow Prover - Two-Phase Proof Generation

Usage:
  # Phase 1: Generate succinct STARK proofs (no Docker socket needed)
  docker run --rm -v \$(pwd):/data ghcr.io/taikoxyz/taiko-shadow prove /data/deposit.json

  # Phase 2: Compress to Groth16 (requires Docker socket)
  docker run --rm -v \$(pwd):/data -v /var/run/docker.sock:/var/run/docker.sock \\
    ghcr.io/taikoxyz/taiko-shadow compress /data/deposit-succinct.json

Commands:
  prove     Generate succinct STARK proofs for all notes in a deposit
  compress  Convert succinct proofs to Groth16 for on-chain verification

Environment Variables:
  RPC_URL   Override the default RPC endpoint
  VERBOSE   Enable verbose output (default: false)

Output:
  prove:    Creates <deposit>-succinct.json with STARK receipts
  compress: Creates <deposit>-proofs.json with Groth16 proofs ready for on-chain use
EOF
}

# -----------------------------------------------------------------------------
# Mode Selection
# -----------------------------------------------------------------------------

case "${MODE}" in
  prove)
    ;;
  compress)
    ;;
  -h|--help|help|"")
    show_usage
    exit 0
    ;;
  *)
    # Legacy mode: treat first arg as deposit file for backward compatibility
    if [[ -f "${MODE}" ]]; then
      INPUT_FILE="${MODE}"
      MODE="prove"
      log "Note: Running in legacy mode. Consider using 'prove' or 'compress' commands."
    else
      error "Unknown command: ${MODE}. Use 'prove' or 'compress'."
    fi
    ;;
esac

if [[ -z "${INPUT_FILE}" ]]; then
  show_usage
  exit 1
fi

if [[ ! -f "${INPUT_FILE}" ]]; then
  error "Input file not found: ${INPUT_FILE}"
fi

cd /workspace

# -----------------------------------------------------------------------------
# Phase 1: Prove (Generate Succinct STARK Proofs)
# -----------------------------------------------------------------------------

run_prove() {
  local DEPOSIT_FILE="$1"

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

  # Calculate output file path: deposit-x.json -> deposit-x-succinct.json
  DEPOSIT_DIR=$(dirname "${DEPOSIT_FILE}")
  DEPOSIT_BASENAME=$(basename "${DEPOSIT_FILE}" .json)
  OUTPUT_FILE="${DEPOSIT_DIR}/${DEPOSIT_BASENAME}-succinct.json"

  log "Phase 1: Generating succinct STARK proofs..."
  log "  Network: ${NETWORK_NAME} (chain ${CHAIN_ID})"
  log "  Notes: ${NOTE_COUNT}"
  log "  Input: ${DEPOSIT_FILE}"
  log "  Output: ${OUTPUT_FILE}"
  echo ""

  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "${TEMP_DIR}"' EXIT

  RECEIPTS_ARRAY="[]"
  GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  for i in $(seq 0 $((NOTE_COUNT - 1))); do
    log "Generating succinct proof for note $((i + 1))/${NOTE_COUNT}..."

    TEMP_RECEIPT="${TEMP_DIR}/note-${i}.receipt.bin"
    TEMP_JOURNAL="${TEMP_DIR}/note-${i}.journal.json"

    # Build command - use succinct receipt kind (no Docker needed)
    cmd=(node packages/risc0-prover/scripts/shadowcli.mjs prove
      --deposit "${DEPOSIT_FILE}"
      --rpc "${RPC_URL}"
      --note-index "${i}"
      --receipt-kind succinct
      --receipt-out "${TEMP_RECEIPT}"
      --journal-out "${TEMP_JOURNAL}"
    )

    if [[ "${VERBOSE}" == "true" ]]; then
      cmd+=(--verbose)
      "${cmd[@]}"
    else
      "${cmd[@]}"
    fi

    if [[ ! -f "${TEMP_RECEIPT}" ]]; then
      error "Failed to generate proof for note ${i}"
    fi

    # Read journal and encode receipt as base64
    JOURNAL_CONTENT=$(cat "${TEMP_JOURNAL}")
    RECEIPT_B64=$(base64 -w0 "${TEMP_RECEIPT}" 2>/dev/null || base64 "${TEMP_RECEIPT}")

    # Add to receipts array
    RECEIPTS_ARRAY=$(node -e "
      const receipts = ${RECEIPTS_ARRAY};
      const journal = ${JOURNAL_CONTENT};
      receipts.push({
        noteIndex: ${i},
        receiptKind: 'succinct',
        receiptBase64: '${RECEIPT_B64}',
        journal: journal
      });
      console.log(JSON.stringify(receipts));
    ")

    log "  Note $((i + 1)) complete (succinct)"
  done

  # Create consolidated output
  log ""
  log "Creating succinct receipts file..."

  node -e "
const output = {
  version: '1.0',
  phase: 'succinct',
  chainId: '${CHAIN_ID}',
  network: '${NETWORK_NAME}',
  generatedAt: '${GENERATED_AT}',
  noteCount: ${NOTE_COUNT},
  receipts: ${RECEIPTS_ARRAY}
};
require('fs').writeFileSync('${OUTPUT_FILE}', JSON.stringify(output, null, 2));
"

  log ""
  log "Phase 1 complete! Succinct receipts: ${OUTPUT_FILE}"
  log ""
  log "Next step: Run 'compress' to convert to Groth16 for on-chain verification."
  log ""
}

# -----------------------------------------------------------------------------
# Phase 2: Compress (Convert Succinct to Groth16)
# -----------------------------------------------------------------------------

run_compress() {
  local SUCCINCT_FILE="$1"

  # Validate input is a succinct receipts file
  PHASE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${SUCCINCT_FILE}', 'utf8')).phase || '')")
  if [[ "${PHASE}" != "succinct" ]]; then
    error "Input must be a succinct receipts file (from 'prove' command). Got phase: ${PHASE:-unknown}"
  fi

  # Check Docker socket
  if [[ ! -S /var/run/docker.sock ]]; then
    error "Docker socket not found. Mount it with: -v /var/run/docker.sock:/var/run/docker.sock"
  fi

  # Extract metadata
  CHAIN_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${SUCCINCT_FILE}', 'utf8')).chainId)")
  NETWORK_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${SUCCINCT_FILE}', 'utf8')).network)")
  NOTE_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${SUCCINCT_FILE}', 'utf8')).noteCount)")

  # Calculate output file path: deposit-x-succinct.json -> deposit-x-proofs.json
  SUCCINCT_DIR=$(dirname "${SUCCINCT_FILE}")
  SUCCINCT_BASENAME=$(basename "${SUCCINCT_FILE}" .json)
  # Remove -succinct suffix if present
  BASE_NAME="${SUCCINCT_BASENAME%-succinct}"
  OUTPUT_FILE="${SUCCINCT_DIR}/${BASE_NAME}-proofs.json"

  log "Phase 2: Compressing to Groth16..."
  log "  Network: ${NETWORK_NAME} (chain ${CHAIN_ID})"
  log "  Notes: ${NOTE_COUNT}"
  log "  Input: ${SUCCINCT_FILE}"
  log "  Output: ${OUTPUT_FILE}"
  log ""
  log "Note: Groth16 compression requires Docker and may take several minutes per note."
  echo ""

  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "${TEMP_DIR}"' EXIT

  PROOFS_ARRAY="[]"
  GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  for i in $(seq 0 $((NOTE_COUNT - 1))); do
    log "Compressing note $((i + 1))/${NOTE_COUNT} to Groth16..."

    # Extract receipt base64 and decode
    RECEIPT_B64=$(node -e "
      const data = JSON.parse(require('fs').readFileSync('${SUCCINCT_FILE}', 'utf8'));
      console.log(data.receipts[${i}].receiptBase64);
    ")
    TEMP_SUCCINCT="${TEMP_DIR}/note-${i}-succinct.bin"
    TEMP_GROTH16="${TEMP_DIR}/note-${i}-groth16.bin"
    TEMP_PROOF="${TEMP_DIR}/note-${i}.proof.json"

    echo "${RECEIPT_B64}" | base64 -d > "${TEMP_SUCCINCT}"

    # Run compression (this invokes Docker internally)
    HOST_BIN="packages/risc0-prover/target/release/shadow-risc0-host"
    if [[ "${VERBOSE}" == "true" ]]; then
      "${HOST_BIN}" compress --receipt "${TEMP_SUCCINCT}" --out "${TEMP_GROTH16}"
    else
      "${HOST_BIN}" compress --receipt "${TEMP_SUCCINCT}" --out "${TEMP_GROTH16}" 2>&1 | grep -v "^$" || true
    fi

    if [[ ! -f "${TEMP_GROTH16}" ]]; then
      error "Failed to compress note ${i} to Groth16"
    fi

    # Export proof payload
    "${HOST_BIN}" export-proof --receipt "${TEMP_GROTH16}" --out "${TEMP_PROOF}"

    if [[ ! -f "${TEMP_PROOF}" ]]; then
      error "Failed to export proof for note ${i}"
    fi

    # Get journal from succinct file
    JOURNAL=$(node -e "
      const data = JSON.parse(require('fs').readFileSync('${SUCCINCT_FILE}', 'utf8'));
      console.log(JSON.stringify(data.receipts[${i}].journal));
    ")

    # Add proof to array
    PROOF_CONTENT=$(cat "${TEMP_PROOF}")
    PROOFS_ARRAY=$(node -e "
      const proofs = ${PROOFS_ARRAY};
      const proof = ${PROOF_CONTENT};
      const journal = ${JOURNAL};
      proofs.push({
        noteIndex: ${i},
        ...proof,
        journal: journal
      });
      console.log(JSON.stringify(proofs));
    ")

    log "  Note $((i + 1)) complete (groth16)"
  done

  # Create consolidated output
  log ""
  log "Creating Groth16 proofs file..."

  node -e "
const output = {
  version: '1.0',
  phase: 'groth16',
  chainId: '${CHAIN_ID}',
  network: '${NETWORK_NAME}',
  generatedAt: '${GENERATED_AT}',
  noteCount: ${NOTE_COUNT},
  proofs: ${PROOFS_ARRAY}
};
require('fs').writeFileSync('${OUTPUT_FILE}', JSON.stringify(output, null, 2));
"

  log ""
  log "Phase 2 complete! Groth16 proofs: ${OUTPUT_FILE}"
  log ""
  log "Ready for on-chain claim submission!"
  log ""
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

case "${MODE}" in
  prove)
    run_prove "${INPUT_FILE}"
    ;;
  compress)
    run_compress "${INPUT_FILE}"
    ;;
esac
