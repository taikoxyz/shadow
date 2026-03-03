// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";

import {Shadow} from "../src/impl/Shadow.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {Risc0CircuitVerifier} from "../src/impl/Risc0CircuitVerifier.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Upgrade Shadow on Taiko Mainnet with a new circuit ID (imageId).
/// @dev Only redeploys what's necessary: Risc0CircuitVerifier, ShadowVerifier,
/// and Shadow implementation. Reuses MAINNET_BRIDGE.
/// Requires RISC0_VERIFIER, SHADOW_PROXY, and IMAGE_ID env vars.
contract UpgradeMainnetImageId is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 167000;

    // Predefined Taiko Mainnet L2 system contracts (0x{chainId}...{suffix})
    address internal constant MAINNET_ANCHOR = 0x1670000000000000000000000000000000010001;
    address internal constant MAINNET_BRIDGE = 0x1670000000000000000000000000000000000001;

    // Proxy owner: Taiko L2 Delegate Controller (governance/timelock)
    address internal constant L2_DELEGATE_CONTROLLER = 0xfA06E15B8b4c5BF3FC5d9cfD083d45c53Cbe8C7C;
    // Fee recipient: Taiko Labs multisig
    address internal constant TAIKO_LABS = 0xB73b0FC4C0Cfc73cF6e034Af6f6b42Ebe6c8b49D;

    function run() external {
        require(block.chainid == MAINNET_CHAIN_ID, UnsupportedChain(block.chainid));

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("OWNER", L2_DELEGATE_CONTROLLER);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", TAIKO_LABS);
        address risc0Verifier = vm.envAddress("RISC0_VERIFIER");
        address shadowProxy = vm.envAddress("SHADOW_PROXY");
        bytes32 imageId = vm.envBytes32("IMAGE_ID");

        console2.log("=== Upgrade Config ===");
        console2.log("chainId", block.chainid);
        console2.log("deployer", deployer);
        console2.log("owner", owner);
        console2.log("feeRecipient", feeRecipient);
        console2.log("risc0Verifier", risc0Verifier);
        console2.log("shadowProxy", shadowProxy);
        console2.log("imageId:");
        console2.logBytes32(imageId);
        console2.log("======================");

        vm.startBroadcast(deployerPrivateKey);

        address newCircuitVerifier = address(new Risc0CircuitVerifier(risc0Verifier, imageId));
        address newShadowVerifier = address(new ShadowVerifier(MAINNET_ANCHOR, newCircuitVerifier));
        address newShadowImpl = address(new Shadow(newShadowVerifier, MAINNET_BRIDGE, feeRecipient, 8 ether));
        UUPSUpgradeable(shadowProxy).upgradeTo(newShadowImpl);

        vm.stopBroadcast();

        console2.log("=== Upgraded Contracts ===");
        console2.log("Risc0CircuitVerifier (new)", newCircuitVerifier);
        console2.log("ShadowVerifier (new)", newShadowVerifier);
        console2.log("Shadow impl (new)", newShadowImpl);
        console2.log("Shadow proxy (unchanged)", shadowProxy);
        console2.log("==========================");
    }

    error UnsupportedChain(uint256 actualChainId);
}
