# Gavin Circuit Review

## Scope
- `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs`
- `packages/risc0-prover/methods/guest/src/main.rs`
- `packages/risc0-prover/crates/shadow-prover-lib/src/lib.rs` (input conversion path)
- On-chain binding contract: `packages/contracts/src/impl/Risc0CircuitVerifier.sol`

## Validation Performed
- Static review of witness validation, MPT verification, journal packing, and on-chain binding logic
- Contract-side RISC0 binding tests passed in `pnpm contracts:test`
- `cargo test --manifest-path packages/risc0-prover/crates/shadow-proof-core/Cargo.toml` could not be completed in this environment (stalled at crates index update)

## Findings

### 1. `chain_id` is constrained to `u64` in circuit/journal, but on-chain API uses `uint256`
- Severity: **Medium**
- Location:
  - `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:23,44,91,106`
  - `packages/contracts/src/impl/Risc0CircuitVerifier.sol:109-110`
- Description:
  - Circuit input and journal encode `chain_id` as 8-byte LE (`u64`).
  - Contract API (`IShadow.PublicInput.chainId`) is `uint256`.
  - If a deployment ever uses `chainid > 2^64-1`, valid claims become unprovable/unverifiable due to width mismatch.
- Impact:
  - Hard liveness failure on chains with large chain IDs.
- Recommendation:
  - Either enforce/document `chainId <= type(uint64).max` at contract boundary, or migrate circuit/journal encoding to 256-bit chain ID.

### 2. Hex-prefix (compact nibble) decoding accepts non-canonical even-path encoding
- Severity: **Low**
- Location: `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:903-927`
- Description:
  - `decode_compact_nibbles` does not validate the low nibble of the first byte for even paths (should be zero by canonical hex-prefix encoding).
  - This is permissive and may accept malformed trie path encodings.
- Impact:
  - Likely low in current trust model (proof nodes are tied to canonical state root), but parser/spec mismatch increases long-term soundness risk.
- Recommendation:
  - Add strict canonical checks for hex-prefix encoding (including even-path padding nibble).

### 3. RLP quantity parsing is permissive (non-canonical integers accepted)
- Severity: **Low**
- Location:
  - `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:760-765`
  - `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs:958-1050`
- Description:
  - RLP decoding logic accepts non-minimal integer encodings (e.g., leading-zero quantities) because canonicality checks are not enforced.
  - `parse_u64_from_rlp_quantity` only checks bounds, not minimal form.
- Impact:
  - Low immediate exploitability given block hash/state root anchoring, but strict canonical validation is safer for consensus-adjacent parsers.
- Recommendation:
  - Enforce canonical RLP integer rules and reject leading-zero/non-minimal length encodings.

### 4. Legacy input conversion silently truncates proof node bytes to declared length
- Severity: **Info**
- Location: `packages/risc0-prover/crates/shadow-prover-lib/src/lib.rs:333-345`
- Description:
  - In `legacy_to_input`, each node is truncated using `.take(declared_len)` if source array is longer.
  - This is convenient for compatibility but can hide malformed legacy payloads.
- Impact:
  - Mostly tooling robustness issue; can complicate debugging and deterministic reproducibility.
- Recommendation:
  - Optionally require exact equality (`full_node.len() == declared_len`) in strict mode.

## Notes
- Core claim constraints are generally well-structured: note selection binding, total cap check, block-header hash binding, MPT traversal, and nullifier derivation are present.
- Highest practical risk identified here is format/width mismatch at boundaries rather than a direct break of the current cryptographic flow.
