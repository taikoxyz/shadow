// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IAnchor} from "../iface/IAnchor.sol";
import {ICircuitVerifier} from "../iface/ICircuitVerifier.sol";
import {IShadow} from "../iface/IShadow.sol";
import {IShadowVerifier} from "../iface/IShadowVerifier.sol";
import {ShadowPublicInputs} from "../lib/ShadowPublicInputs.sol";

/// @title ShadowVerifier
/// @notice Verifies Shadow claim proofs using TaikoAnchor for block hash validation.
/// @dev The ZK proof commits to a blockHash. The stateRoot is derived in-circuit from
/// the RLP-encoded block header. We verify the blockHash is canonical via TaikoAnchor.
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
    /// @dev Fetches the canonical blockHash from TaikoAnchor and builds public inputs.
    /// The ZK proof verifies: keccak256(block_header_rlp) == blockHash, then derives
    /// stateRoot from the header and verifies the account balance against it.
    function verifyProof(bytes calldata _proof, IShadow.PublicInput calldata _input)
        external
        view
        returns (bool _isValid_)
    {
        require(_input.blockNumber > 0, BlockHashNotFound(_input.blockNumber));

        // Get canonical block hash from TaikoAnchor
        bytes32 blockHash = anchor.blockHashes(_input.blockNumber);
        require(blockHash != bytes32(0), BlockHashNotFound(_input.blockNumber));

        uint256[] memory publicInputs = ShadowPublicInputs.toArray(_input, blockHash);
        bool ok = circuitVerifier.verifyProof(_proof, publicInputs);
        require(ok, ProofVerificationFailed());
        _isValid_ = true;
    }
}
