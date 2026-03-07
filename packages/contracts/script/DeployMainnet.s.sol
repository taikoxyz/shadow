// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Shadow} from "../src/impl/Shadow.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {Risc0CircuitVerifier} from "../src/impl/Risc0CircuitVerifier.sol";

/// @notice Deploy Shadow on Taiko Mainnet (chain ID 167000).
/// @dev Requires RISC0_VERIFIER and IMAGE_ID env vars — no defaults for production safety.
/// Deploy the RISC0 verifier first with DeployMainnetRisc0Verifier.s.sol, then pass its address here.
contract DeployMainnet is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 167000;

    // Predefined Taiko Mainnet L2 system contracts (0x{chainId}...{suffix})
    address internal constant MAINNET_ANCHOR = 0x1670000000000000000000000000000000010001;
    address internal constant MAINNET_BRIDGE = 0x1670000000000000000000000000000000000001;

    // Proxy owner: Taiko L2 Delegate Controller (governance/timelock)
    address internal constant L2_DELEGATE_CONTROLLER = 0xfA06E15B8b4c5BF3FC5d9cfD083d45c53Cbe8C7C;
    // Fee recipient: Taiko Labs multisig
    address internal constant TAIKO_LABS = 0xB73b0FC4C0Cfc73cF6e034Af6f6b42Ebe6c8b49D;

    struct Deployment {
        address risc0CircuitVerifier;
        address shadowVerifier;
        address shadowImplementation;
        address shadowProxy;
    }

    function run() external returns (Deployment memory deployed_) {
        require(block.chainid == MAINNET_CHAIN_ID, UnsupportedChain(block.chainid));

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("OWNER", L2_DELEGATE_CONTROLLER);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", TAIKO_LABS);

        // Both required — no defaults on mainnet
        address risc0Verifier = vm.envAddress("RISC0_VERIFIER");
        bytes32 imageId = vm.envBytes32("IMAGE_ID");

        vm.startBroadcast(deployerPrivateKey);

        deployed_.risc0CircuitVerifier = address(new Risc0CircuitVerifier(risc0Verifier, imageId));
        deployed_.shadowVerifier = address(new ShadowVerifier(MAINNET_ANCHOR, deployed_.risc0CircuitVerifier));
        deployed_.shadowImplementation =
            address(new Shadow(deployed_.shadowVerifier, MAINNET_BRIDGE, feeRecipient, 8 ether));
        bytes memory initData = abi.encodeCall(Shadow.initialize, (owner));
        deployed_.shadowProxy = address(new ERC1967Proxy(deployed_.shadowImplementation, initData));

        vm.stopBroadcast();

        _logConfig(deployer, owner, feeRecipient, risc0Verifier, imageId);
        _logDeployment(deployed_);
    }

    function _logConfig(address deployer, address owner, address feeRecipient, address risc0Verifier, bytes32 imageId)
        private
        view
    {
        console2.log("=== Deploy Config ===");
        console2.log("chainId", block.chainid);
        console2.log("deployer", deployer);
        console2.log("owner", owner);
        console2.log("feeRecipient", feeRecipient);
        console2.log("anchor", MAINNET_ANCHOR);
        console2.log("risc0Verifier", risc0Verifier);
        console2.log("etherMinter (bridge)", MAINNET_BRIDGE);
        console2.log("imageId:");
        console2.logBytes32(imageId);
        console2.log("=====================");
    }

    function _logDeployment(Deployment memory deployed_) private pure {
        console2.log("=== Deployed Contracts ===");
        console2.log("Risc0CircuitVerifier", deployed_.risc0CircuitVerifier);
        console2.log("ShadowVerifier", deployed_.shadowVerifier);
        console2.log("Shadow implementation", deployed_.shadowImplementation);
        console2.log("Shadow proxy", deployed_.shadowProxy);
        console2.log("==========================");
    }

    error UnsupportedChain(uint256 actualChainId);
}
