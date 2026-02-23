// Copyright 2025 RISC Zero, Inc.
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.9;

/// @notice Control IDs for RISC Zero v3.0.0
library ControlID {
    bytes32 public constant CONTROL_ROOT = hex"a54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56";
    // NOTE: This has the opposite byte order to the value in the risc0 repository.
    bytes32 public constant BN254_CONTROL_ID = hex"04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0";
}
