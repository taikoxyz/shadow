// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";

import {Shadow} from "../src/impl/Shadow.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IShadowConfig {
    function owner() external view returns (address);
    function verifier() external view returns (address);
    function feeRecipient() external view returns (address);
    function etherMinter() external view returns (address);
}

/// @notice Deploys a new Shadow implementation using Taiko L2 Bridge as IEthMinter,
/// then upgrades the existing Shadow proxy in place.
/// @dev Keeps the proxy address unchanged for server/docker compatibility.
contract UpgradeShadowMinterToBridge is Script {
    address internal constant SHADOW_PROXY = 0x77cdA0575e66A5FC95404fdA856615AD507d8A07;
    address internal constant BRIDGE_PROXY = 0x1670130000000000000000000000000000000001;
    uint256 internal constant HOODI_CHAIN_ID = 167013;

    function run() external {
        require(block.chainid == HOODI_CHAIN_ID, UnsupportedChain(block.chainid));

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        IShadowConfig shadow = IShadowConfig(SHADOW_PROXY);
        address owner = shadow.owner();
        address verifier = shadow.verifier();
        address feeRecipient = shadow.feeRecipient();
        address oldEtherMinter = shadow.etherMinter();

        require(deployer == owner, NotShadowOwner(deployer, owner));

        console2.log("=== Upgrade Config ===");
        console2.log("chainId", block.chainid);
        console2.log("deployer", deployer);
        console2.log("shadow owner", owner);
        console2.log("shadow proxy", SHADOW_PROXY);
        console2.log("verifier", verifier);
        console2.log("feeRecipient", feeRecipient);
        console2.log("old etherMinter", oldEtherMinter);
        console2.log("new etherMinter", BRIDGE_PROXY);
        console2.log("======================");

        vm.startBroadcast(deployerPrivateKey);

        address newShadowImpl = address(new Shadow(verifier, BRIDGE_PROXY, feeRecipient));
        UUPSUpgradeable(SHADOW_PROXY).upgradeTo(newShadowImpl);

        vm.stopBroadcast();

        address upgradedEtherMinter = IShadowConfig(SHADOW_PROXY).etherMinter();
        require(upgradedEtherMinter == BRIDGE_PROXY, MinterNotUpdated(upgradedEtherMinter, BRIDGE_PROXY));

        console2.log("=== Upgrade Complete ===");
        console2.log("Shadow proxy (unchanged)", SHADOW_PROXY);
        console2.log("Shadow impl (new)", newShadowImpl);
        console2.log("Ether minter (new)", upgradedEtherMinter);
        console2.log("========================");
    }

    error UnsupportedChain(uint256 actualChainId);
    error NotShadowOwner(address caller, address owner);
    error MinterNotUpdated(address actual, address expected);
}
