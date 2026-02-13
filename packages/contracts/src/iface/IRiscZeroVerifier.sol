// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @custom:security-contact security@taiko.xyz

interface IRiscZeroVerifier {
    /// @notice Verify a RISC Zero receipt seal for an image ID and journal digest.
    function verify(bytes calldata _seal, bytes32 _imageId, bytes32 _journalDigest) external view;
}
