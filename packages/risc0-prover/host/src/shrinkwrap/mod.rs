// Vendored from `risc0-groth16` so we can generate Groth16 receipts without Docker.
// Upstream uses Docker (or CUDA) for shrink-wrap; Shadow runs a local snarkjs prover instead.

mod seal_format;
mod seal_to_json;

pub(crate) use seal_to_json::to_json;

