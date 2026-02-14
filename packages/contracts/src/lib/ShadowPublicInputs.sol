// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IShadow} from "../iface/IShadow.sol";

/// @custom:security-contact security@taiko.xyz

library ShadowPublicInputs {
    uint256 private constant _PUBLIC_INPUTS_LEN = 87;
    uint256 private constant _IDX_BLOCK_NUMBER = 0;
    uint256 private constant _IDX_STATE_ROOT = 1;
    uint256 private constant _IDX_CHAIN_ID = 33;
    uint256 private constant _IDX_AMOUNT = 34;
    uint256 private constant _IDX_RECIPIENT = 35;
    uint256 private constant _IDX_NULLIFIER = 55;

    /// @notice Converts a PublicInput struct to a uint256 array for circuit verification.
    /// @dev stateRoot is part of the circuit public inputs but is fetched on-chain
    /// from the checkpoint store, so it is not part of `IShadow.PublicInput` calldata.
    function toArray(IShadow.PublicInput calldata _input, bytes32 _stateRoot)
        internal
        pure
        returns (uint256[] memory inputs_)
    {
        inputs_ = new uint256[](_PUBLIC_INPUTS_LEN);

        inputs_[_IDX_BLOCK_NUMBER] = _input.blockNumber;

        _writeBytes32(inputs_, _IDX_STATE_ROOT, _stateRoot);

        inputs_[_IDX_CHAIN_ID] = _input.chainId;
        inputs_[_IDX_AMOUNT] = _input.amount;

        _writeAddress(inputs_, _IDX_RECIPIENT, _input.recipient);
        _writeBytes32(inputs_, _IDX_NULLIFIER, _input.nullifier);
    }

    function _writeBytes32(uint256[] memory _inputs, uint256 _offset, bytes32 _value) private pure {
        for (uint256 i = 0; i < 32;) {
            _inputs[_offset + i] = uint256(uint8(_value[i]));
            unchecked {
                ++i;
            }
        }
    }

    function _writeAddress(uint256[] memory _inputs, uint256 _offset, address _value) private pure {
        for (uint256 i = 0; i < 20;) {
            _inputs[_offset + i] = uint256(uint8(bytes20(_value)[i]));
            unchecked {
                ++i;
            }
        }
    }
}
