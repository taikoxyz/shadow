// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";
import {TestShadowToken} from "../src/impl/TestShadowToken.sol";

/// @notice Deploy a TestShadowToken on Taiko Hoodi for ERC20 E2E testing.
contract DeployTestShadowToken is Script {
    address internal constant SHADOW_PROXY = 0x77cdA0575e66A5FC95404fdA856615AD507d8A07;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== Deploy TestShadowToken ===");
        console2.log("deployer", deployer);
        console2.log("shadowProxy", SHADOW_PROXY);

        vm.startBroadcast(deployerPrivateKey);

        TestShadowToken token = new TestShadowToken(SHADOW_PROXY, 100 ether);

        vm.stopBroadcast();

        console2.log("=== Deployed ===");
        console2.log("TestShadowToken", address(token));
    }
}
