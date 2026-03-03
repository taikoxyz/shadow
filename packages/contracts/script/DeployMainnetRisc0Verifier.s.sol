// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";

import {RiscZeroGroth16Verifier} from "risc0-ethereum/groth16/RiscZeroGroth16Verifier.sol";
import {ControlID} from "risc0-ethereum/groth16/ControlID.sol";

/// @notice Deploy the official RISC Zero Groth16 Verifier on Taiko Mainnet.
/// @dev Run this once and record the deployed address as RISC0_VERIFIER for DeployMainnet.
/// Uses ControlID constants from risc0-ethereum/groth16/ControlID.sol (v3.0.x).
contract DeployMainnetRisc0Verifier is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 167000;

    function run() external returns (address verifier_) {
        require(block.chainid == MAINNET_CHAIN_ID, UnsupportedChain(block.chainid));

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");

        console2.log("=== RISC0 Verifier Deploy Config ===");
        console2.log("chainId", block.chainid);
        console2.log("deployer", vm.addr(deployerPrivateKey));
        console2.log("CONTROL_ROOT:");
        console2.logBytes32(ControlID.CONTROL_ROOT);
        console2.log("BN254_CONTROL_ID:");
        console2.logBytes32(ControlID.BN254_CONTROL_ID);
        console2.log("=====================================");

        vm.startBroadcast(deployerPrivateKey);
        verifier_ = address(new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID));
        vm.stopBroadcast();

        console2.log("=== Deployed ===");
        console2.log("RiscZeroGroth16Verifier", verifier_);
        console2.log("Set RISC0_VERIFIER=", verifier_);
        console2.log("================");
    }

    error UnsupportedChain(uint256 actualChainId);
}
