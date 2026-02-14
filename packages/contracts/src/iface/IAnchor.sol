// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @custom:security-contact security@taiko.xyz

interface IAnchor {
    function blockHashes(uint256 _blockNumber) external view returns (bytes32 _blockHash_);
}
