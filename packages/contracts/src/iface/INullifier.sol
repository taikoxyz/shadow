// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @custom:security-contact security@taiko.xyz

interface INullifier {
    error NullifierAlreadyConsumed(bytes32 nullifier);
    error UnauthorizedCaller(address caller);
    error ZeroAddress();

    event NullifierConsumed(bytes32 indexed nullifier);

    function shadow() external view returns (address);
    function isConsumed(bytes32 nullifier) external view returns (bool);
    function consume(bytes32 nullifier) external;
}
