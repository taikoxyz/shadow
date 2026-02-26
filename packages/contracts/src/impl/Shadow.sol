// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEthMinter} from "../iface/IEthMinter.sol";
import {IShadow} from "../iface/IShadow.sol";
import {IShadowVerifier} from "../iface/IShadowVerifier.sol";
import {OwnableUpgradeable} from "../lib/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from
    "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/// @custom:security-contact security@taiko.xyz

contract Shadow is IShadow, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IShadowVerifier public immutable verifier;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IEthMinter public immutable etherMinter;
    /// @notice Address that receives the claim fee (0.1%).
    /// @dev Immutable at implementation-deploy time.
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable feeRecipient;

    /// @dev Consumed nullifiers to prevent replayed claims.
    mapping(bytes32 _nullifier => bool _consumed) private _consumed;

    /// @dev Reserved storage gap for future upgrades.
    uint256[49] private __gap;

    uint256 internal constant _FEE_DIVISOR = 1000; // 0.1%

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _verifier, address _etherMinter, address _feeRecipient) {
        require(_verifier != address(0), ZeroAddress());
        require(_etherMinter != address(0), ZeroAddress());
        require(_feeRecipient != address(0), ZeroAddress());
        verifier = IShadowVerifier(_verifier);
        etherMinter = IEthMinter(_etherMinter);
        feeRecipient = _feeRecipient;
    }

    /// @notice Initializes the contract.
    function initialize(address _owner) external initializer {
        __OwnableUpgradeable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();
    }

    /// @notice Returns whether the nullifier has been consumed.
    function isConsumed(bytes32 _nullifier) external view returns (bool _isConsumed_) {
        _isConsumed_ = _consumed[_nullifier];
    }

    /// @notice Pauses the contract, disabling new claims.
    /// @dev Only callable by the contract owner. Use in emergencies to halt ETH minting.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract, re-enabling claims.
    /// @dev Only callable by the contract owner.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Submits a proof and public inputs to mint ETH via the configured minter hook.
    /// @dev Applies a 0.1% claim fee (`amount / 1000`) to feeRecipient.
    /// @dev Protected by `whenNotPaused`: the owner can halt all new claims in an emergency
    ///      (e.g., if a critical vulnerability is discovered in the verifier or minter).
    ///
    /// @dev **Deposit cap rationale:**
    ///      The ZK circuit enforces a maximum total of 8 ETH per deposit.  This bounds the
    ///      extractable value from any hypothetical birthday collision attack on the 160-bit
    ///      target address space (~2^80 hash operations), ensuring such an attack remains
    ///      economically infeasible.
    function claim(bytes calldata _proof, PublicInput calldata _input) external whenNotPaused nonReentrant {
        require(_input.chainId == block.chainid, ChainIdMismatch(_input.chainId, block.chainid));
        require(_input.amount > 0, InvalidAmount(_input.amount));
        require(_input.recipient != address(0), InvalidRecipient(_input.recipient));
        if (_consumed[_input.nullifier]) {
            revert NullifierAlreadyConsumed(_input.nullifier);
        }

        require(verifier.verifyProof(_proof, _input), ProofVerificationFailed());

        _consumed[_input.nullifier] = true;

        uint256 fee = _input.amount / _FEE_DIVISOR;
        uint256 netAmount = _input.amount - fee;

        etherMinter.mintEth(_input.recipient, netAmount);
        if (fee > 0) {
            etherMinter.mintEth(feeRecipient, fee);
        }

        emit Claimed(_input.nullifier, _input.recipient, _input.amount);
    }
}
