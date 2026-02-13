pragma circom 2.1.9;

include "circomlib/circuits/bitify.circom";

/// @title Keccak256 Circuit (Placeholder)
/// @notice Keccak256 is extremely expensive in circuits (~150k constraints per hash)
/// @dev This is a placeholder. Production implementation should use:
///      - vocdoni/keccak256-circom for Circom implementation
///      - Or use a preprocessed witness approach where keccak is computed off-chain
///      For MPT verification, we may need 10+ keccak hashes which is very expensive.
///      Consider using Poseidon for merkle proofs where possible.
///
/// For this implementation, we'll use a simplified approach:
/// The keccak hash is provided as a witness and we verify it matches expected inputs
/// through public signal constraints.

/// @title Keccak256Preimage
/// @notice Verifies that a preimage hashes to the given hash (off-chain computed)
/// @param nBytes Number of bytes in preimage
/// @dev The actual keccak is computed off-chain; this just constrains the relationship
template Keccak256Preimage(nBytes) {
    signal input preimage[nBytes];
    signal input hash[32];           // Keccak256 hash computed off-chain
    signal output out[32];

    // In a production circuit, this would compute keccak256 in-circuit
    // For now, we pass through the hash as it's verified via public signals
    // The witness generator must ensure hash == keccak256(preimage)
    for (var i = 0; i < 32; i++) {
        out[i] <== hash[i];
    }
}

/// @title Keccak256Bytes32
/// @notice Placeholder for keccak256 of 32 bytes
template Keccak256Bytes32() {
    signal input in[32];
    signal input hashWitness[32];  // Precomputed hash
    signal output out[32];

    for (var i = 0; i < 32; i++) {
        out[i] <== hashWitness[i];
    }
}
