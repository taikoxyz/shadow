# Contract Architecture

## Directory Structure

```
packages/contracts/src/
├── iface/     # Interfaces (IShadow, IShadowVerifier, ICircuitVerifier, IEthMinter, IAnchor, IShadowCompatibleToken)
├── impl/      # Implementations (Shadow, ShadowVerifier, Risc0CircuitVerifier, DummyEtherMinter, ShadowCompatibleERC20, TestShadowToken)
└── lib/       # Libraries (ShadowPublicInputs, OwnableUpgradeable)
```

## Core Contracts

- **`Shadow`** (`src/impl/`): Main claim contract with UUPS upgradeability. Tracks consumed nullifiers internally via `mapping(bytes32 => bool) private _consumed`. Supports both ETH and ERC20 claims — when `token == address(0)` uses `IEthMinter`, otherwise calls `IShadowCompatibleToken.shadowMint()`
- **`ShadowVerifier`** (`src/impl/`): Fetches canonical block hash from TaikoAnchor and delegates to circuit verifier
- **`Risc0CircuitVerifier`** (`src/impl/`): Binds public inputs to RISC Zero journal. Journal is 136 bytes: `(blockNumber, blockHash, chainId, amount, recipient, nullifier, token)`
- **`DummyEtherMinter`** (`src/impl/`): Testnet mock that emits events instead of minting

## ERC20 Token Support

- **`IShadowCompatibleToken`** (`src/iface/`): Interface for ERC20 tokens that support Shadow privacy transfers. Requires: `shadowMint()`, `balanceStorageSlot()`, `balanceSlot()`, `maxShadowMintAmount()`
- **`ShadowCompatibleERC20`** (`src/impl/`): Abstract base implementing `IShadowCompatibleToken` on top of OpenZeppelin ERC20. Tokens inherit this and configure their `_BALANCE_SLOT`
- **`TestShadowToken`** (`src/impl/`): Concrete test ERC20 for Hoodi. Uses `_BALANCE_SLOT = 0` (plain OZ ERC20 layout). Has `devMint()` for testing

### ERC20 Claim Flow

1. Holder sends tokens to `targetAddress` via a plain ERC20 transfer (no special contract interaction)
2. Server calls `token.balanceStorageSlot(targetAddress)` to get the exact storage key, then `eth_getProof(tokenAddress, [storageKey], blockNumber)` for the two-level MPT proof data
3. ZK circuit proves `_balances[targetAddress] >= total_note_amounts` using a two-level MPT proof: state trie → token account `storageRoot` → storage trie → `_balances[targetAddress]`
4. The circuit uses `balanceSlot` (from `token.balanceSlot()`) to recompute the expected storage key inside the proof, preventing a malicious prover from substituting an arbitrary key
5. `Shadow.claim()` calls `token.shadowMint(recipient, amount)` to mint new tokens — net amount minus 0.1% fee

### Security: Balance Slot Binding

The `balanceSlot` is read on-chain from the token contract and passed to the ZK circuit. Inside the circuit, the expected storage key is recomputed from `(targetAddress, balanceSlot)` and compared against the provided key. This prevents a malicious prover from substituting an arbitrary storage key.

## Design Patterns

- UUPS upgradeable pattern (OpenZeppelin)
- Immutable dependencies (verifier, minter, feeRecipient) for trust minimization
- Storage gaps (`uint256[49] __gap`) for upgrade safety
- Interfaces define the API, implementations hold logic
