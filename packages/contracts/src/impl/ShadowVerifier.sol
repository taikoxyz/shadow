// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IAnchor} from "../iface/IAnchor.sol";
import {ICircuitVerifier} from "../iface/ICircuitVerifier.sol";
import {IShadow} from "../iface/IShadow.sol";
import {IShadowVerifier} from "../iface/IShadowVerifier.sol";
import {ShadowPublicInputs} from "../lib/ShadowPublicInputs.sol";

/// @custom:security-contact security@taiko.xyz

contract ShadowVerifier is IShadowVerifier {
    ICircuitVerifier public immutable circuitVerifier;
    IAnchor public immutable anchor;

    constructor(address _anchor, address _circuitVerifier) {
        require(_anchor != address(0), ZeroAddress());
        require(_circuitVerifier != address(0), ZeroAddress());
        anchor = IAnchor(_anchor);
        circuitVerifier = ICircuitVerifier(_circuitVerifier);
    }

    /// @notice Verifies a proof and its public inputs.
    function verifyProof(bytes calldata _proof, IShadow.PublicInput calldata _input)
        external
        view
        returns (bool _isValid_)
    {
        require(_input.blockNumber > 0, BlockHashNotFound(_input.blockNumber));

        bytes32 canonicalBlockHash = anchor.blockHashes(_input.blockNumber);
        require(canonicalBlockHash != bytes32(0), BlockHashNotFound(_input.blockNumber));
        require(canonicalBlockHash == _input.blockHash, BlockHashMismatch(canonicalBlockHash, _input.blockHash));

        uint256[] memory publicInputs = ShadowPublicInputs.toArray(_input);
        bool ok = circuitVerifier.verifyProof(_proof, publicInputs);
        require(ok, ProofVerificationFailed());
        _isValid_ = true;
    }
}
