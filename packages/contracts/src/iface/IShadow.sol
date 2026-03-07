// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @custom:security-contact security@taiko.xyz

interface IShadow {
    struct PublicInput {
        uint64 blockNumber;
        uint64 chainId;
        uint256 amount;
        address recipient;
        bytes32 nullifier;
        address token; // address(0) = ETH
    }

    event Claimed(bytes32 indexed nullifier, address indexed recipient, address token);

    error ChainIdMismatch(uint64 expected, uint64 actual);
    error InvalidAmount(uint256 amount);
    error InvalidRecipient(address recipient);
    error NullifierAlreadyConsumed(bytes32 nullifier);
    error AmountExceedsMax(uint256 amount, uint256 max);

    /// @notice Submits a proof and public inputs to mint ETH via the configured minter hook.
    /// @dev The Shadow implementation applies a 0.1% claim fee (`amount / 1000`) to an immutable feeRecipient.
    function claim(bytes calldata _proof, PublicInput calldata _input) external;
}
