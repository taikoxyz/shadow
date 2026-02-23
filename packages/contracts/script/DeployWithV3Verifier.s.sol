// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Shadow} from "../src/impl/Shadow.sol";
import {DummyEtherMinter} from "../src/impl/DummyEtherMinter.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {Risc0CircuitVerifier} from "../src/impl/Risc0CircuitVerifier.sol";

// Import RISC0 v3.0.0 verifier
import {RiscZeroGroth16Verifier} from "../src/risc0-v3/RiscZeroGroth16Verifier.sol";
import {ControlID} from "../src/risc0-v3/ControlID.sol";

/// @notice Deploy Shadow with a fresh RISC0 v3.0.0 Groth16 verifier
contract DeployWithV3Verifier is Script {
    address internal constant HOODI_ANCHOR = 0x1670130000000000000000000000000000010001;

    // This is the imageId from the current prover build
    // Update this when rebuilding the prover
    bytes32 internal constant HOODI_SHADOW_CLAIM_GUEST_ID = 0x7b8be5005af6a6a78b6030fbb3015b8a8a99bff941eb2908eaed4b0289305ffa;

    struct Deployment {
        address risc0Groth16Verifier;
        address etherMinter;
        address risc0CircuitVerifier;
        address shadowVerifier;
        address shadowImplementation;
        address shadowProxy;
    }

    function run() external returns (Deployment memory deployed_) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPrivateKey);

        address owner = vm.envOr("OWNER", deployer);
        address anchor = vm.envOr("ANCHOR", HOODI_ANCHOR);
        bytes32 imageId = vm.envOr("IMAGE_ID", HOODI_SHADOW_CLAIM_GUEST_ID);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy RISC0 v3.0.0 Groth16 Verifier
        deployed_.risc0Groth16Verifier = address(
            new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID)
        );

        // Deploy DummyEtherMinter
        deployed_.etherMinter = address(new DummyEtherMinter());

        // Deploy Risc0CircuitVerifier (adapter that binds imageId)
        deployed_.risc0CircuitVerifier = address(
            new Risc0CircuitVerifier(deployed_.risc0Groth16Verifier, imageId)
        );

        // Deploy ShadowVerifier
        deployed_.shadowVerifier = address(
            new ShadowVerifier(anchor, deployed_.risc0CircuitVerifier)
        );

        // Deploy Shadow implementation and proxy
        deployed_.shadowImplementation = address(
            new Shadow(deployed_.shadowVerifier, deployed_.etherMinter, owner)
        );
        bytes memory initData = abi.encodeCall(Shadow.initialize, (owner));
        deployed_.shadowProxy = address(
            new ERC1967Proxy(deployed_.shadowImplementation, initData)
        );

        vm.stopBroadcast();

        _logConfig(deployer, owner, anchor, imageId);
        _logDeployment(deployed_);
    }

    function _logConfig(
        address deployer,
        address owner,
        address anchor,
        bytes32 imageId
    ) private view {
        console2.log("=== Deploy Config ===");
        console2.log("chainId", block.chainid);
        console2.log("deployer", deployer);
        console2.log("owner", owner);
        console2.log("anchor", anchor);
        console2.log("imageId:");
        console2.logBytes32(imageId);
        console2.log("=====================");
    }

    function _logDeployment(Deployment memory deployed_) private pure {
        console2.log("=== Deployed Contracts ===");
        console2.log("RiscZeroGroth16Verifier (v3.0.0)", deployed_.risc0Groth16Verifier);
        console2.log("DummyEtherMinter", deployed_.etherMinter);
        console2.log("Risc0CircuitVerifier", deployed_.risc0CircuitVerifier);
        console2.log("ShadowVerifier", deployed_.shadowVerifier);
        console2.log("Shadow implementation", deployed_.shadowImplementation);
        console2.log("Shadow proxy", deployed_.shadowProxy);
        console2.log("==========================");
    }
}
