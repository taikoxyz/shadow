// Copyright 2025 RISC Zero, Inc.
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.9;

/// @notice Selectable interface for RISC Zero verifier.
interface IRiscZeroSelectable {
    /// @notice A short key attached to the seal to select the correct verifier implementation.
    function SELECTOR() external view returns (bytes4);
}
