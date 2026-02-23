# Implementation Challenges

## 1. Block header hashing assumptions cleared
Initial mismatches came from hashing the wrong field set (post-Shanghai extras). Using the documented Shanghai encoding yields matching hashes for Hoodi blocks, so the prover can trust `eth_getHeaderByNumber`. This concern is closed.

## 2. Anchor contract does not expose historical blockHashes
Verified the Anchor at `0x1670130000000000000000000000000000010001` does return canonical block hashes (e.g., block 4,642,864 yields `0x02b5…5852`). Anchor availability is no longer a blocker.

## 3. Prover resource requirements
Docker Desktop has been reconfigured to provide 32 GB RAM (plus swap). The `shadow-prover` container can now run Groth16 shrinkwrap without getting SIGKILLed.

## 4. End-to-end flow
With (1)–(3) resolved, we can resume the standard one-command Docker flow and produce proofs for submission/testing.
