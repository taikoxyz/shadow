// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {DummyEtherMinter} from "../src/impl/DummyEtherMinter.sol";

contract DummyEtherMinterTest is Test {
    event EthMinted(address indexed recipient, uint256 amount);

    DummyEtherMinter internal minter;

    function setUp() public {
        minter = new DummyEtherMinter();
    }

    function test_mintEth_emitsEvent() external {
        vm.expectEmit(true, false, false, true, address(minter));
        emit EthMinted(address(0xBEEF), 123);
        minter.mintEth(address(0xBEEF), 123);
    }
}

