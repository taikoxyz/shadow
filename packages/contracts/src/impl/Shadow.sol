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

    event NullifierConsumed(bytes32 indexed nullifier);

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
    /// @dev **Proof-of-Work (PoW) anti-spam rationale:**
    ///      Each deposit secret is required to satisfy a 24-bit PoW constraint: the last
    ///      3 bytes of SHA-256(notesHash || secret) must all be zero.  This corresponds
    ///      to ~16 million SHA-256 iterations on average (2^24 ≈ 16.7 M hashes, typically
    ///      found in < 1 second on modern hardware).
    ///
    ///      The primary cost barrier for spam is *ZK proof generation*: producing a valid
    ///      RISC Zero Groth16 receipt takes several minutes on consumer hardware and
    ///      significant cloud compute (~USD 0.10–1.00 per proof at current rates).
    ///      The PoW serves as a lightweight *secondary* deterrent that:
    ///        1. Forces the depositor to commit CPU work before publishing a target address,
    ///           making Sybil attacks marginally more expensive at zero on-chain gas cost.
    ///        2. Binds the secret to the note set (notesHash), preventing trivial reuse of
    ///           pre-mined secrets across different note configurations.
    ///        3. Is verified entirely inside the ZK circuit (not on-chain), so it adds no
    ///           marginal gas cost to the claim transaction.
    ///
    ///      24 bits is deliberately kept low because the ZK proof cost already dominates.
    ///      Raising the PoW to 32+ bits would only slow down legitimate users while
    ///      providing negligible additional protection against well-resourced adversaries
    ///      who can afford ZK proof generation anyway.
    ///
    ///      There is no on-chain EIP/ERC standard for PoW anti-spam deposits; this design
    ///      draws inspiration from the general Hashcash concept (Adam Back, 1997) applied
    ///      to commitment schemes.
    function claim(bytes calldata _proof, PublicInput calldata _input) external whenNotPaused nonReentrant {
        require(_input.chainId == block.chainid, ChainIdMismatch(_input.chainId, block.chainid));
        require(_input.amount > 0, InvalidAmount(_input.amount));
        require(_input.recipient != address(0), InvalidRecipient(_input.recipient));
        if (_consumed[_input.nullifier]) {
            revert NullifierAlreadyConsumed(_input.nullifier);
        }

        require(verifier.verifyProof(_proof, _input), ProofVerificationFailed());

        _consumed[_input.nullifier] = true;
        emit NullifierConsumed(_input.nullifier);

        uint256 fee = _input.amount / _FEE_DIVISOR;
        uint256 netAmount = _input.amount - fee;

        etherMinter.mintEth(_input.recipient, netAmount);
        if (fee > 0) {
            etherMinter.mintEth(feeRecipient, fee);
        }

        emit Claimed(_input.nullifier, _input.recipient, _input.amount);
    }
}
