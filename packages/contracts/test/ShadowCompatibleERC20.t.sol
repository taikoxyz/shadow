// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ShadowCompatibleERC20} from "../src/impl/ShadowCompatibleERC20.sol";
import {TestShadowToken} from "../src/impl/TestShadowToken.sol";

contract ShadowCompatibleERC20Test is Test {
    TestShadowToken internal token;
    address internal shadow = address(0x5AD);
    uint256 internal constant MAX_MINT = 8 ether;

    function setUp() public {
        token = new TestShadowToken(shadow, MAX_MINT);
    }

    function test_shadowMint_succeeds() external {
        address recipient = address(0xBEEF);
        uint256 amount = 1 ether;

        vm.prank(shadow);
        token.shadowMint(recipient, amount);

        assertEq(token.balanceOf(recipient), amount);
        assertEq(token.totalSupply(), amount);
    }

    function test_shadowMint_RevertWhen_CallerIsNotShadow() external {
        vm.prank(address(0xBAD));
        vm.expectRevert(ShadowCompatibleERC20.ShadowUnauthorised.selector);
        token.shadowMint(address(0xBEEF), 1 ether);
    }

    function test_shadowMint_RevertWhen_CallerIsOwner() external {
        vm.expectRevert(ShadowCompatibleERC20.ShadowUnauthorised.selector);
        token.shadowMint(address(0xBEEF), 1 ether);
    }

    function test_shadowMint_multipleMints() external {
        address r1 = address(0xBEEF);
        address r2 = address(0xCAFE);

        vm.startPrank(shadow);
        token.shadowMint(r1, 1 ether);
        token.shadowMint(r2, 2 ether);
        token.shadowMint(r1, 0.5 ether);
        vm.stopPrank();

        assertEq(token.balanceOf(r1), 1.5 ether);
        assertEq(token.balanceOf(r2), 2 ether);
        assertEq(token.totalSupply(), 3.5 ether);
    }

    function test_maxShadowMintAmount_returnsConstructorValue() external view {
        assertEq(token.maxShadowMintAmount(), MAX_MINT);
    }

    function test_balanceStorageSlot_returnsCorrectKey() external view {
        address holder = address(0xBEEF);
        bytes32 expected = keccak256(abi.encode(holder, uint256(0)));
        assertEq(token.balanceStorageSlot(holder), expected);
    }

    function test_balanceStorageSlot_differentHolders_differentKeys() external view {
        address h1 = address(0xBEEF);
        address h2 = address(0xCAFE);
        assertTrue(token.balanceStorageSlot(h1) != token.balanceStorageSlot(h2));
    }

    function test_balanceStorageSlot_matchesActualStorage() external {
        address holder = address(0xBEEF);
        uint256 amount = 42 ether;

        vm.prank(shadow);
        token.shadowMint(holder, amount);

        bytes32 storageKey = token.balanceStorageSlot(holder);
        bytes32 rawValue = vm.load(address(token), storageKey);
        assertEq(uint256(rawValue), amount);
    }

    function test_balanceStorageSlot_zeroBalance() external view {
        address holder = address(0xDEAD);
        bytes32 storageKey = token.balanceStorageSlot(holder);
        bytes32 rawValue = vm.load(address(token), storageKey);
        assertEq(uint256(rawValue), 0);
    }

    function test_name_and_symbol() external view {
        assertEq(token.name(), "Test Shadow Token");
        assertEq(token.symbol(), "TST");
    }
}
