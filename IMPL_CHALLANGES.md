# Implementation Challenges

## 1. L2 RPC block header drift
Taiko Hoodi RPC nodes (e.g. `https://rpc.hoodi.taiko.xyz`) are returning a `block.hash` that does **not** equal `keccak256(RLP(header))`. The prover now recomputes the hash locally as a workaround, but this drift makes it impossible to cross-verify headers (and raises the risk that the Anchor contract enforces a different canonical hash). Until the RPC reports canonical hashes or exposes `debug_getRawBlock`, every proof must rely on the recomputed value, and on-chain verification still needs a trusted Anchor source.

## 2. Anchor contract does not expose historical blockHashes
Calls to `blockHashes(uint256)` on the Hoodi Anchor (`0x1670130000000000000000000000000000000005`) revert for every inspected block number. Without Anchor data we cannot prove that the recomputed header hash matches what `ShadowVerifier` expects on-chain, so even a locally generated proof would fail to verify. We need either the Anchor implementation deployed on Hoodi or an alternative contract that can be queried for historical hashes.

## 3. Prover resource requirements
`shadow-risc0-host` is currently being SIGKILLed (exit code 137) inside the Dockerized prover, even when we mount the latest scripts. The container exhausts the default Docker-Desktop memory budget (~8 GB) long before the Groth16 shrinkwrap finishes. Until we grant the Docker VM ≥24 GB RAM (or run the prover directly on macOS with Metal), the proof command cannot complete.

## 4. End-to-end flow blocked
Because of (2) and (3), no proof artifact can be produced or validated today. We have the single-command Docker flow (`shadow-prover`) wired up and the inputs validated, but we are missing both the canonical block hash source and the memory headroom needed for `shadow-risc0-host`. Those two gaps must be closed before we can commit the generated proofs, verify them on Taikoscan, and finish the PR.
