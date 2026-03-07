// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @custom:security-contact security@taiko.xyz
/// @title  IShadowCompatibleToken
/// @notice Minimal interface for ERC20 tokens on Taiko that support Shadow privacy transfers.
///
/// DEPOSIT: Holder sends tokens to targetAddress via a plain ERC20 transfer.
///          No interaction with this interface is required at deposit time.
///
/// PROVE:   ZK circuit proves _balances[targetAddress] >= total_note_amounts
///          using a two-level MPT proof anchored to a block hash.
///          The server fetches the storage key via balanceStorageSlot(targetAddress).
///
/// CLAIM:   Shadow.sol calls shadowMint(recipient, amount).
///          New tokens are minted to recipient — no pre-minted reserve, no
///          transfer from targetAddress. Direct analogy to IEthMinter.mintEth.
///
/// GOVERNANCE: Because shadowMint calls _mint, ERC20Votes assigns voting units
///          only if recipient has an active delegate — standard _mint behaviour.
///          targetAddress never called delegate(), so its locked tokens carry
///          no active voting weight.
interface IShadowCompatibleToken {
    /// @notice Caller is not the authorised Shadow contract.
    error ShadowUnauthorised();

    /// @notice Mint tokens to a Shadow claim recipient.
    /// @dev    MUST revert with ShadowUnauthorised if the caller is not authorised.
    ///         MUST mint `_amount` new tokens to `_to` via _mint or equivalent.
    /// @param  _to      Claim recipient (from ZK proof journal).
    /// @param  _amount  Token amount in raw smallest units.
    function shadowMint(address _to, uint256 _amount) external;

    /// @notice Returns the Ethereum storage key where `holder`'s token balance
    ///         is stored in this contract's storage trie.
    /// @dev    The Shadow server calls this with targetAddress before proving.
    ///         The key is passed directly to eth_getProof and to the ZK circuit.
    ///         MUST be pure — changing the derivation after deployment would cause
    ///         the prover to use wrong storage keys and fail.
    /// @param  _holder     The address whose balance storage key is requested.
    /// @return storageKey  The bytes32 Ethereum storage key for holder's balance.
    function balanceStorageSlot(address _holder) external pure returns (bytes32 storageKey);

    /// @notice Returns the raw ERC20 _balances mapping storage slot index.
    /// @dev    The ZK circuit uses this slot together with the holder address to
    ///         recompute the expected storage key inside the proof, preventing
    ///         a malicious prover from substituting an arbitrary storage key.
    /// @return The storage slot index (e.g. 0 for plain OZ ERC20).
    function balanceSlot() external pure returns (uint256);

    /// @notice Returns the maximum amount that may be minted in a single Shadow claim.
    /// @dev    Shadow.sol reads this value and rejects any claim where amount exceeds it.
    ///         The client also reads this value to constrain note amounts in deposit files.
    /// @return The maximum raw token amount (smallest units) per single claim.
    function maxShadowMintAmount() external view returns (uint256);
}
