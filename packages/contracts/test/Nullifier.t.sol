// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {Nullifier} from "../src/impl/Nullifier.sol";
import {INullifier} from "../src/iface/INullifier.sol";

contract NullifierTest is Test {
    event NullifierConsumed(bytes32 indexed nullifier);

    Nullifier internal nullifier;
    address internal shadow = address(0x1234);

    function setUp() public {
        nullifier = new Nullifier(shadow);
    }

    function test_constructor_revertsForZeroShadow() external {
        vm.expectRevert(INullifier.ZeroAddress.selector);
        new Nullifier(address(0));
    }

    function test_constructor_setsShadow() external view {
        assertEq(nullifier.shadow(), shadow);
    }

    function test_consume_requiresShadowCaller() external {
        bytes32 value = keccak256("nullifier");
        vm.expectRevert(abi.encodeWithSelector(INullifier.UnauthorizedCaller.selector, address(this)));
        nullifier.consume(value);
    }

    function test_consume_revertsOnReuse() external {
        bytes32 value = keccak256("nullifier");
        vm.prank(shadow);
        nullifier.consume(value);
        vm.prank(shadow);
        vm.expectRevert(abi.encodeWithSelector(INullifier.NullifierAlreadyConsumed.selector, value));
        nullifier.consume(value);
    }

    function test_consume_setsConsumedAndEmitsEvent() external {
        bytes32 value = keccak256("nullifier-event");

        vm.expectEmit(true, false, false, false, address(nullifier));
        emit NullifierConsumed(value);

        vm.prank(shadow);
        nullifier.consume(value);

        assertTrue(nullifier.isConsumed(value));
    }
}
