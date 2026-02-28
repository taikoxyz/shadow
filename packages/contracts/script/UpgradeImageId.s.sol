// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";

import {Shadow} from "../src/impl/Shadow.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {Risc0CircuitVerifier} from "../src/impl/Risc0CircuitVerifier.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Upgrade Shadow contracts with a new circuit ID (imageId).
/// @dev Only redeploys what's necessary: Risc0CircuitVerifier, ShadowVerifier,
/// and Shadow implementation. Reuses existing RiscZeroGroth16Verifier,
/// DummyEtherMinter, and TaikoAnchor. Upgrades the existing UUPS proxy.
contract UpgradeImageId is Script {
    // Existing contracts on Taiko Hoodi that don't need redeployment
    address internal constant TAIKO_ANCHOR = 0x1670130000000000000000000000000000010001;
    address internal constant RISC0_GROTH16_VERIFIER = 0xd1934807041B168f383870A0d8F565aDe2DF9D7D;
    address internal constant DUMMY_ETHER_MINTER = 0x6DC226aA43E86fE77735443fB50a0A90e5666AA4;
    address internal constant SHADOW_PROXY = 0x77cdA0575e66A5FC95404fdA856615AD507d8A07;
    // Image ID deployed: 0xac4b31fadeb0115a1e6019c8bccc0ddf900fe6e40a447409d9ce6b257913dcbc

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("OWNER", deployer);
        bytes32 imageId = vm.envBytes32("IMAGE_ID");

        console2.log("=== Upgrade Config ===");
        console2.log("chainId", block.chainid);
        console2.log("deployer", deployer);
        console2.log("owner/feeRecipient", owner);
        console2.log("imageId:");
        console2.logBytes32(imageId);
        console2.log("======================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new Risc0CircuitVerifier with updated imageId
        address newCircuitVerifier = address(new Risc0CircuitVerifier(RISC0_GROTH16_VERIFIER, imageId));

        // 2. Deploy new ShadowVerifier pointing to new circuit verifier
        address newShadowVerifier = address(new ShadowVerifier(TAIKO_ANCHOR, newCircuitVerifier));

        // 3. Deploy new Shadow implementation with new verifier
        address newShadowImpl = address(new Shadow(newShadowVerifier, DUMMY_ETHER_MINTER, owner));

        // 4. Upgrade the UUPS proxy to the new implementation (no reinit needed)
        UUPSUpgradeable(SHADOW_PROXY).upgradeTo(newShadowImpl);

        vm.stopBroadcast();

        console2.log("=== Upgraded Contracts ===");
        console2.log("Risc0CircuitVerifier (new)", newCircuitVerifier);
        console2.log("ShadowVerifier (new)", newShadowVerifier);
        console2.log("Shadow impl (new)", newShadowImpl);
        console2.log("Shadow proxy (unchanged)", SHADOW_PROXY);
        console2.log("==========================");
    }
}
