#![no_main]
#![no_std]

extern crate alloc;

use risc0_zkvm::guest::env;
use shadow_proof_core::{evaluate_claim, pack_journal, ClaimInput};

risc0_zkvm::guest::entry!(main);

fn main() {
    let input: ClaimInput = env::read();
    let journal = evaluate_claim(&input).unwrap_or_else(|err| panic!("{}", err.as_str()));
    let packed = pack_journal(&journal);
    env::commit_slice(&packed);
}
