#!/usr/bin/env bash
set -euo pipefail

cd /workspace

if [[ -z "${RPC_URL:-}" ]]; then
  echo "RPC_URL environment variable is required." >&2
  exit 1
fi

if [[ -z "${DEPOSIT_FILE:-}" ]]; then
  echo "DEPOSIT_FILE environment variable is required." >&2
  exit 1
fi

NOTE_INDEX="${NOTE_INDEX:-0}"
RECEIPT_KIND="${RECEIPT_KIND:-groth16}"
OUTPUT_FILE="${OUTPUT_FILE:-/workspace/packages/docs/data/deposits/note-${NOTE_INDEX}.proof.json}"
ALLOW_INSUFFICIENT="${ALLOW_INSUFFICIENT:-false}"
VERBOSE="${VERBOSE:-false}"

output_dir="$(dirname "${OUTPUT_FILE}")"
mkdir -p "${output_dir}"

cmd=(node packages/risc0-prover/scripts/shadowcli.mjs prove
  --deposit "${DEPOSIT_FILE}"
  --rpc "${RPC_URL}"
  --note-index "${NOTE_INDEX}"
  --receipt-kind "${RECEIPT_KIND}"
  --proof-out "${OUTPUT_FILE}"
)

if [[ "${ALLOW_INSUFFICIENT}" == "true" ]]; then
  cmd+=(--allow-insufficient-balance)
fi

if [[ "${VERBOSE}" == "true" ]]; then
  cmd+=(--verbose)
fi

exec "${cmd[@]}"
