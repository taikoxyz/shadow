// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IAnchor} from "../../src/iface/IAnchor.sol";

contract MockAnchor is IAnchor {
    mapping(uint256 _blockNumber => bytes32 _blockHash) private _blockHashes;

    function setBlockHash(uint256 _blockNumber, bytes32 _blockHash) external {
        _blockHashes[_blockNumber] = _blockHash;
    }

    function blockHashes(uint256 _blockNumber) external view returns (bytes32 _blockHash_) {
        _blockHash_ = _blockHashes[_blockNumber];
    }
}
