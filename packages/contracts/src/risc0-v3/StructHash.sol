// Copyright 2024 RISC Zero, Inc.
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.9;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {reverseByteOrderUint16} from "./Util.sol";

/// @notice Structural hashing routines used for RISC Zero data structures.
library StructHash {
    using SafeCast for uint256;

    // @notice Compute the struct digest with the given tag digest and digest fields down.
    function taggedStruct(bytes32 tagDigest, bytes32[] memory down) internal pure returns (bytes32) {
        bytes memory data = new bytes(0);
        return taggedStruct(tagDigest, down, data);
    }

    // @notice Compute the struct digest with the given tag digest, digest fields down, and data.
    function taggedStruct(bytes32 tagDigest, bytes32[] memory down, bytes memory data) internal pure returns (bytes32) {
        uint16 downLen = down.length.toUint16();
        // swap the byte order to encode as little-endian.
        bytes2 downLenLE = bytes2((downLen << 8) | (downLen >> 8));
        return sha256(abi.encodePacked(tagDigest, down, data, downLenLE));
    }

    // @notice Add an element (head) to the incremental hash of a list (tail).
    function taggedListCons(bytes32 tagDigest, bytes32 head, bytes32 tail) internal pure returns (bytes32) {
        bytes32[] memory down = new bytes32[](2);
        down[0] = head;
        down[1] = tail;
        return taggedStruct(tagDigest, down);
    }

    // @notice Hash the list by using taggedListCons to repeatedly add to the head of the list.
    function taggedList(bytes32 tagDigest, bytes32[] memory list) internal pure returns (bytes32) {
        bytes32 curr = bytes32(0x0000000000000000000000000000000000000000000000000000000000000000);
        for (uint256 i = 0; i < list.length; i++) {
            curr = taggedListCons(tagDigest, list[list.length - 1 - i], curr);
        }
        return curr;
    }
}
