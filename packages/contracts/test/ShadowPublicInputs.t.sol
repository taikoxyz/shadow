// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {ShadowPublicInputs} from "../src/lib/ShadowPublicInputs.sol";

contract ShadowPublicInputsTest is Test {
    function _toArray(IShadow.PublicInput calldata input) external pure returns (uint256[] memory) {
        return ShadowPublicInputs.toArray(input);
    }

    function test_toArray_layout() external {
        bytes32 stateRoot = hex"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
        bytes32 nullifier = hex"1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100";
        bytes32 powDigest = hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        address recipient = address(0x11223344556677889900aABbCcdDEeFF00112233);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: 42,
            stateRoot: stateRoot,
            chainId: 167,
            noteIndex: 3,
            amount: 5 ether,
            recipient: recipient,
            nullifier: nullifier,
            powDigest: powDigest
        });

        uint256[] memory inputs = this._toArray(input);
        assertEq(inputs.length, 120);
        assertEq(inputs[0], 42);
        assertEq(inputs[33], 167);
        assertEq(inputs[34], 3);
        assertEq(inputs[35], 5 ether);

        for (uint256 i = 0; i < 32; i++) {
            assertEq(inputs[1 + i], uint256(uint8(stateRoot[i])));
            assertEq(inputs[56 + i], uint256(uint8(nullifier[i])));
            assertEq(inputs[88 + i], uint256(uint8(powDigest[i])));
        }

        bytes20 recipientBytes = bytes20(recipient);
        for (uint256 i = 0; i < 20; i++) {
            assertEq(inputs[36 + i], uint256(uint8(recipientBytes[i])));
        }
    }
}
