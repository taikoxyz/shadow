// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {INullifier} from "../iface/INullifier.sol";

/// @custom:security-contact security@taiko.xyz

contract Nullifier is INullifier {
    address public immutable shadow;
    mapping(bytes32 _nullifier => bool _consumed) private _consumed;

    constructor(address _shadow) {
        if (_shadow == address(0)) {
            revert ZeroAddress();
        }
        shadow = _shadow;
    }

    function isConsumed(bytes32 _nullifier) external view returns (bool) {
        return _consumed[_nullifier];
    }

    function consume(bytes32 _nullifier) external {
        if (msg.sender != shadow) {
            revert UnauthorizedCaller(msg.sender);
        }
        if (_consumed[_nullifier]) {
            revert NullifierAlreadyConsumed(_nullifier);
        }
        _consumed[_nullifier] = true;
        emit NullifierConsumed(_nullifier);
    }
}
