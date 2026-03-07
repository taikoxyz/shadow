# ERC20 Token Support for Shadow — Research Document

## Overview

Shadow currently proves ETH ownership only. This document analyses what is required to extend the system to support ERC20 tokens, covering every affected layer: the `IShadowCompatibleToken` standard, deposit file format, ZK circuit, journal encoding, smart contracts, server API, and UI.

---

## 1. Current Architecture (ETH-only)

```
Depositor sends ETH to targetAddress  ← plain ETH transfer, no Shadow interaction
         ↓
Server calls eth_getProof(targetAddress, [], blockNumber)
  → account MPT proof: stateRoot → account leaf [nonce, balance, storageRoot, codeHash]
         ↓
RISC Zero circuit verifies:
  1. blockHeader RLP hashes to blockHash
  2. stateRoot extracted from blockHeader
  3. MPT walk: keccak256(targetAddress) → account leaf → balance (field[1])
  4. balance >= sum(note amounts)
  5. Derives nullifier from (secret, chainId, noteIndex, notesHash)
         ↓
Journal (116 bytes): blockNumber | blockHash | chainId | amount | recipient | nullifier
         ↓
Shadow.sol.claim() verifies proof, marks nullifier consumed,
  calls IEthMinter.mintEth(recipient, amount - fee)
  ← ETH at targetAddress is abandoned forever (no key, economically dead)
```

**Key properties:**
- No on-chain Shadow interaction at deposit time — the transfer looks random
- `IEthMinter.mintEth` creates new ETH; the locked ETH economically offsets this
- The ZK proof guarantees every mint is backed by locked ETH

---

## 2. ERC20 Model — Direct Analogy to ETH

The ERC20 design mirrors the ETH design exactly:

```
Depositor sends tokens to targetAddress  ← plain ERC20 transfer, no Shadow interaction
         ↓
Server calls token.balanceStorageSlot(targetAddress) → bytes32 storageKey
Server calls eth_getProof(tokenAddress, [storageKey], blockNumber)
  → account proof (state trie → token contract → storageRoot)
  → storage proof (storage trie → _balances[targetAddress])
         ↓
RISC Zero circuit verifies:
  1. blockHeader RLP hashes to blockHash
  2. stateRoot → token account leaf → storageRoot (level 1 MPT walk)
  3. storageRoot → _balances[targetAddress] (level 2 MPT walk, using storageKey)
  4. balance >= sum(note amounts)
  5. Derives nullifier from (secret, chainId, noteIndex, notesHash)
         ↓
Journal (136 bytes): blockNumber | blockHash | chainId | amount | recipient | nullifier | token
         ↓
Shadow.sol.claim() verifies proof, marks nullifier consumed,
  calls token.shadowMint(recipient, amount - fee)
  ← mints new tokens to recipient; tokens at targetAddress remain locked forever
```

**Parallel to ETH:**
- `IEthMinter.mintEth(recipient, amount)` ↔ `IShadowCompatibleToken.shadowMint(recipient, amount)`
- Both create tokens from thin air; the locked ETH / locked ERC20 at `targetAddress` economically offsets the new issuance
- Bridge tokens have no hard supply cap, so fresh minting at claim time is the natural model

This is the simplest possible design. The deposit is a plain token transfer — no `shadowDeposit`, no commitment, no reserve.

---

## 3. The Two-Level MPT Proof

### Why ETH proof doesn't directly extend to ERC20

ETH balance lives in the **account state trie** — standardised, one level.
ERC20 balances live in the **token contract's storage trie** — requires a two-level proof.

### Level 1 — state trie (same mechanism as ETH balance proof)

```
stateRoot → keccak256(tokenContractAddress) → token account leaf
  → extract field[2]: storageRoot
```

### Level 2 — storage trie (new)

```
storageRoot → keccak256(storageKey) → storage leaf
  → extract balance value (RLP-encoded uint256)
```

### Storage key

The token contract computes and returns the exact storage key for any holder:

```
storageKey = token.balanceStorageSlot(targetAddress)   // bytes32, queried from contract
```

For a plain (non-upgradeable) OZ ERC20 this would be `keccak256(abi.encode(targetAddress, 0))`, but Taiko bridged tokens use `ERC20Upgradeable` behind a UUPS proxy with large gap arrays — `_balances` lands at **slot 251**, not slot 0. The storage key for all `BridgedERC20` / `BridgedERC20V2` tokens is `keccak256(abi.encode(targetAddress, 251))`. Callers never need to know this: the token contract handles it via `balanceStorageSlot(address)`.

```bash
# Server fetches the key, then calls eth_getProof with it:
storageKey = eth_call(tokenAddress, "balanceStorageSlot(address)", targetAddress)
eth_getProof(tokenContractAddress, [storageKey], blockNumber)
# Returns: accountProof[] AND storageProof[0].proof[]
```

---

## 4. `IShadowCompatibleToken` — Interface Design

The interface is intentionally minimal — three functions mirroring the relationship between `IEthMinter` and ETH.

### Why `symbol` and `decimals` are not needed

Correct — not needed in either the deposit file or the interface:
- The ZK circuit operates on raw `uint256` amounts with no concept of decimals
- `symbol()` and `decimals()` are standard ERC20 optional metadata, queryable directly from the token
- Deposit amounts are always in raw smallest units (e.g., `1000000` = 1 USDC with 6 decimals), same convention as ETH amounts being in wei

### Why `balanceStorageSlot(address)` returns `bytes32`

Takes the holder address and returns the exact Ethereum storage key (not just the mapping slot index). This means:
- Callers pass the result directly to `eth_getProof` — no derivation step
- The token handles its own storage layout, including non-standard schemes
- The interface works for any storage layout without the prover knowing the internals

### Full interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  IShadowCompatibleToken
 * @notice Minimal interface for ERC20 tokens on Taiko that support Shadow privacy transfers.
 *
 * DEPOSIT: Holder sends tokens to targetAddress via a plain ERC20 transfer.
 *          No interaction with this interface is required at deposit time.
 *
 * PROVE:   ZK circuit proves _balances[targetAddress] >= total_note_amounts
 *          using a two-level MPT proof anchored to a block hash.
 *          The server fetches the storage key via balanceStorageSlot(targetAddress).
 *
 * CLAIM:   Shadow.sol calls shadowMint(recipient, amount).
 *          New tokens are minted to recipient — no pre-minted reserve, no
 *          transfer from targetAddress. Direct analogy to IEthMinter.mintEth.
 *
 * GOVERNANCE: Because shadowMint calls _mint, ERC20Votes assigns voting units
 *          only if recipient has an active delegate — standard _mint behaviour.
 *          targetAddress never called delegate(), so its locked tokens carry
 *          no active voting weight.
 */
interface IShadowCompatibleToken {

    // ─── Errors ──────────────────────────────────────────────────────────────

    /// @notice Caller is not the authorised Shadow contract.
    error ShadowUnauthorised();

    // ─── Claim (called by Shadow.sol only) ───────────────────────────────────

    /**
     * @notice Mint tokens to a Shadow claim recipient.
     *
     * @dev    MUST:
     *         - Revert with ShadowUnauthorised if the caller is not authorised.
     *         - Mint `amount` new tokens to `to` via _mint or equivalent.
     *           The underlying _mint emits Transfer(address(0), to, amount).
     *
     *         Shadow.sol is responsible for:
     *         - Verifying the ZK proof that proves targetAddress balance >= amount
     *         - Consuming the nullifier to prevent double-claims
     *
     * @param  to      Claim recipient (from ZK proof journal).
     * @param  amount  Token amount in raw smallest units.
     */
    function shadowMint(address to, uint256 amount) external;

    // ─── Discovery ────────────────────────────────────────────────────────────

    /**
     * @notice Returns the Ethereum storage key (bytes32) where `holder`'s token
     *         balance is stored in this contract's storage trie.
     *
     * @dev    The Shadow server calls this with targetAddress before proving:
     *           storageKey = token.balanceStorageSlot(targetAddress)
     *         The key is passed directly to eth_getProof and to the ZK circuit.
     *
     *         For Taiko BridgedERC20 / BridgedERC20V2 (slot 251):
     *           returns keccak256(abi.encode(holder, uint256(251)))
     *         For plain OZ ERC20 (slot 0):
     *           returns keccak256(abi.encode(holder, uint256(0)))
     *
     *         MUST be pure. Changing the derivation after deployment would cause
     *         the prover to use wrong storage keys and fail to generate valid proofs.
     *
     * @param  holder      The address whose balance storage key is requested.
     * @return storageKey  The bytes32 Ethereum storage key for holder's balance.
     */
    function balanceStorageSlot(address holder) external pure returns (bytes32 storageKey);

    /**
     * @notice Returns the maximum amount that may be minted in a single Shadow claim.
     *
     * @dev    Shadow.sol reads this value and rejects any claim where amount exceeds it,
     *         mirroring the ETH-side `maxClaimAmount` guard (8 ether).
     *         The client also reads this value to constrain note amounts in deposit files,
     *         so a deposit file will never produce an unprovable or unclaimable proof.
     *
     *         Set this to a value appropriate for the token's decimals and risk profile.
     *         Example: for a 6-decimal stablecoin, 10_000 * 1e6 (10 000 USDC) is reasonable.
     *
     * @return The maximum raw token amount (smallest units) per single claim.
     */
    function maxShadowMintAmount() external view returns (uint256);
}
```

### Reference implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IShadowCompatibleToken } from "./IShadowCompatibleToken.sol";

/**
 * @title  ShadowCompatibleERC20
 * @notice Abstract base for ERC20 tokens supporting Shadow privacy transfers.
 */
abstract contract ShadowCompatibleERC20 is ERC20, IShadowCompatibleToken {

    address private _shadowContract;

    // The _balances mapping slot. Depends entirely on inheritance chain:
    //   - Plain OZ ERC20 (non-upgradeable): slot 0
    //   - Taiko BridgedERC20 / BridgedERC20V2 (upgradeable, large gap arrays): slot 251
    // Override balanceStorageSlot() or change this constant to match your token's layout.
    uint256 private constant _BALANCE_SLOT = 0; // MUST be set correctly per token

    uint256 private immutable _maxShadowMintAmount;

    modifier onlyShadow() {
        if (msg.sender != _shadowContract) revert ShadowUnauthorised();
        _;
    }

    constructor(address shadowContract_, uint256 maxShadowMintAmount_) {
        _shadowContract = shadowContract_;
        _maxShadowMintAmount = maxShadowMintAmount_;
    }

    // ─── IShadowCompatibleToken ───────────────────────────────────────────────

    function shadowMint(address to, uint256 amount) external override onlyShadow {
        // _mint emits Transfer(address(0), to, amount) — no extra event needed.
        _mint(to, amount);
    }

    function maxShadowMintAmount() external view virtual override returns (uint256) {
        return _maxShadowMintAmount;
    }

    function balanceStorageSlot(address holder) external pure override returns (bytes32) {
        // keccak256(abi.encode(holder, _BALANCE_SLOT)) — standard Solidity mapping key.
        // Override if _balances is at a different slot or uses a non-standard derivation.
        bytes32 key;
        assembly {
            mstore(0x00, holder)
            mstore(0x20, _BALANCE_SLOT)
            key := keccak256(0x00, 0x40)
        }
        return key;
    }

    /// @dev Allow token governance to update the Shadow contract address.
    function _setShadowContract(address shadowContract_) internal {
        _shadowContract = shadowContract_;
    }
}
```

### Governance tokens (ERC20Votes) — no special handling needed

`shadowMint` calls `_mint(to, amount)`. ERC20Votes handles this correctly with no overrides:

- `targetAddress` never called `delegate()` (no key), so its locked tokens carry no active voting weight
- The recipient gains voting units only if they have an active delegate — standard `_mint` behaviour, correct for tokens they legitimately own

No `ShadowCompatibleERC20Votes` variant is needed.

---

## 5. Deposit File Schema (v3 — Simplified)

```json
{
  "version": "v3",
  "chainId": "167013",
  "token": "0xa8754b9Fa15fc18BB59458815510E40a12cD2014",
  "secret": "0x...",
  "notes": [
    { "recipient": "0x...", "amount": "1000000", "label": "one USDC" }
  ],
  "targetAddress": "0x..."
}
```

Changes from v2:
- `token` is a plain address string — absent or `null` means ETH (v2 backward compatible)
- `symbol`, `decimals`, and `storageSlot` are removed — not needed
- `targetAddress` is still present and used — derived the same way as for ETH deposits
- The server queries `balanceStorageSlot(targetAddress)` from the token contract before proving

---

## 6. ZK Circuit Changes

### New fields in `ClaimInput`

```rust
pub struct ClaimInput {
    // ... all existing ETH fields (unchanged) ...
    pub token: Option<TokenClaimInput>, // None = ETH
}

pub struct TokenClaimInput {
    pub token_address: [u8; 20],
    /// Exact storage key returned by token.balanceStorageSlot(targetAddress).
    /// Passed directly as the storage trie path — no recomputation in-circuit.
    pub balance_storage_key: [u8; 32],
    /// Level 1: state trie → token account leaf → storageRoot
    pub token_account_proof_nodes: Vec<Vec<u8>>,
    pub token_account_proof_depth: u32,
    /// Level 2: storage trie → _balances[targetAddress]
    pub balance_storage_proof_nodes: Vec<Vec<u8>>,
    pub balance_storage_proof_depth: u32,
}
```

### Circuit logic (ERC20 path)

```rust
let token = input.token.as_ref().unwrap();

// Level 1: state trie → token contract account leaf → storageRoot
let storage_root = verify_account_proof_and_get_storage_root(
    &state_root,
    &token.token_address,
    &token.token_account_proof_nodes,
)?;

// Level 2: storage trie → _balances[targetAddress]
// Storage key was returned by token.balanceStorageSlot(targetAddress) off-chain
// and is passed in directly — no recomputation needed in-circuit.
let token_balance = verify_storage_proof_and_get_value(
    &storage_root,
    &token.balance_storage_key,
    &token.balance_storage_proof_nodes,
)?;

// Verify the balance covers all note amounts
verify: u256_from_bytes(token_balance) >= total_note_amounts
```

### New functions in `shadow-proof-core`

**`verify_account_proof_and_get_storage_root`** — identical MPT walk to the existing `verify_account_proof_and_get_balance`, but reads field[2] (`storageRoot`) instead of field[1] (`balance`) from the account RLP tuple. Good candidate for refactoring into `verify_account_proof_and_get_field(root, addr, nodes, field_index)`.

**`verify_storage_proof_and_get_value`** — MPT walk rooted at `storageRoot`, using `keccak256(balance_storage_key)` as the trie path. The storage leaf value is a minimal RLP-encoded big-endian uint256.

### Journal Changes

`targetAddress` is used only as an internal circuit witness — it never needs to appear in the journal. Shadow.sol calls `shadowMint(to, amount)` with no `from`, so it never needs to know which `targetAddress` was proven.

```rust
pub struct ClaimJournal {
    pub block_number: u64,
    pub block_hash: [u8; 32],
    pub chain_id: u64,
    pub amount: u128,
    pub recipient: [u8; 20],
    pub nullifier: [u8; 32],
    pub token: [u8; 20],  // NEW: [0u8; 20] = ETH
}

pub const PACKED_JOURNAL_LEN: usize = 136; // was 116
```

| Offset | Size | Field | Encoding |
|--------|------|-------|----------|
| 0 | 8 | blockNumber | uint64 LE |
| 8 | 32 | blockHash | bytes32 |
| 40 | 8 | chainId | uint64 LE |
| 48 | 16 | amount | uint128 LE |
| 64 | 20 | recipient | bytes20 |
| 84 | 32 | nullifier | bytes32 |
| 116 | 20 | **token** | bytes20, all-zeros = ETH |

### Proving cost

The ERC20 circuit performs two MPT walks instead of one, roughly doubling the zkVM cycle count for the trie verification portion. Benchmarking is needed; the 256 MB stack thread and Groth16 compression timeout may need adjustment.

---

## 7. Smart Contract Changes

### IShadow.sol

```solidity
struct PublicInput {
    uint64 blockNumber;
    uint64 chainId;
    uint256 amount;
    address recipient;
    bytes32 nullifier;
    address token;  // address(0) = ETH
}
```

### ShadowPublicInputs.sol

```solidity
uint256 private constant _PUBLIC_INPUTS_LEN = 107; // 87 → 107 (+20 for token)
uint256 private constant _IDX_TOKEN = 87;
// toArray adds: _writeAddress(inputs_, _IDX_TOKEN, _input.token);
```

### Risc0CircuitVerifier.sol

```solidity
uint256 private constant _JOURNAL_LEN = 136;  // 116 → 136
uint256 private constant _OFFSET_TOKEN = 116;
uint256 private constant _IDX_TOKEN = 87;

// In _requireJournalMatchesPublicInputs, add:
address token = _readAddress(_journal, _OFFSET_TOKEN);
address expectedToken = address(uint160(uint256(_publicInputs[_IDX_TOKEN])));
if (token != expectedToken) revert JournalTokenMismatch(expectedToken, token);
```

### Shadow.sol

```solidity
function claim(bytes calldata _proof, PublicInput calldata _input)
    external whenNotPaused nonReentrant
{
    require(_input.chainId == block.chainid, ChainIdMismatch(...));
    require(_input.amount > 0, InvalidAmount(...));
    require(_input.amount <= maxClaimAmount, AmountExceedsMax(...));
    require(_input.recipient != address(0), InvalidRecipient(...));
    if (_consumed[_input.nullifier]) revert NullifierAlreadyConsumed(...);

    verifier.verifyProof(_proof, _input);
    _consumed[_input.nullifier] = true;

    uint256 fee = _input.amount / _FEE_DIVISOR;
    uint256 net = _input.amount - fee;

    if (_input.token == address(0)) {
        // ETH — unchanged; maxClaimAmount guard already applied above
        etherMinter.mintEth(_input.recipient, net);
        if (fee > 0) etherMinter.mintEth(feeRecipient, fee);
    } else {
        // ERC20 — each token declares its own max via maxShadowMintAmount()
        IShadowCompatibleToken token_ = IShadowCompatibleToken(_input.token);
        require(_input.amount <= token_.maxShadowMintAmount(), AmountExceedsMax(...));
        token_.shadowMint(_input.recipient, net);
        if (fee > 0) token_.shadowMint(feeRecipient, fee);
    }

    emit Claimed(_input.nullifier, _input.recipient, _input.amount, _input.token);
}
```

No per-token registry needed. Shadow.sol calls `shadowMint` directly. The token's internal access control enforces that only Shadow can call it. Token governance sets the authorised Shadow address.

**ABI change:**
```
claim(bytes,(uint64,uint64,uint256,address,bytes32,address))
```

---

## 8. Server Changes

### rpc.rs

```rust
pub struct Erc20BalanceProofData {
    pub token_account_proof_nodes: Vec<Vec<u8>>,
    pub balance_storage_proof_nodes: Vec<Vec<u8>>,
    pub balance_storage_key: [u8; 32], // returned for use in ClaimInput
    pub balance_value: Vec<u8>,        // for pre-flight validation
}

pub async fn eth_get_erc20_balance_proof(
    client: &reqwest::Client,
    rpc_url: &str,
    token_address: &str,
    target_address: &str,
    block_number: u64,
) -> Result<Erc20BalanceProofData>
// 1. eth_call(tokenAddress, "balanceStorageSlot(address)", targetAddress) → bytes32 storage_key
// 2. eth_getProof(tokenAddress, [storage_key], blockNumber)
//    → accountProof[] and storageProof[0].proof[]
```

### pipeline.rs

For ERC20 deposits:
1. Load `token_address` from deposit file
2. Load `target_address` from deposit file (derived identically to ETH deposits)
3. Call `eth_get_erc20_balance_proof(token_address, target_address, block_number)`
4. Pre-flight: verify `balance_value >= total_amount` before spending zkVM cycles
5. Build `ClaimInput` with `token: Some(TokenClaimInput { balance_storage_key, ... })`

### deposits.rs

```rust
// CreateDepositRequest gains a simple optional token address:
#[serde(default)]
token: Option<String>, // ERC20 token contract address, absent = ETH
```

`encode_claim_calldata` updates to the 6-field `PublicInput` ABI.

---

## 9. Breaking Changes Summary

| Layer | Change | Notes |
|-------|--------|-------|
| Deposit file | v3: `token` as address string; `symbol`, `decimals`, `storageSlot` removed | v2 valid as ETH |
| `ClaimInput` | new `token: Option<TokenClaimInput>` | New `imageId` required |
| `ClaimJournal` | +`token`, 116 → 136 bytes | All consumers affected |
| `IShadow.PublicInput` | +`address token` | ABI change |
| `ShadowPublicInputs` | 87 → 107 elements | New verifier deployment |
| `Risc0CircuitVerifier` | journal/inputs length and offset constants | New deployment |
| `Shadow.sol` | new `claim()` ABI, ERC20 branch | UUPS upgrade |
| `encode_claim_calldata` | new function selector | Server rebuild |

---

## 10. Upgrade Path for Existing Tokens

Tokens already deployed on Taiko do not implement `IShadowCompatibleToken`:

1. **Proxy upgrade (preferred):** If behind a UUPS or transparent proxy (most bridged tokens are), token governance upgrades the implementation to inherit `ShadowCompatibleERC20`. Taiko Foundation controls bridge token governance.

2. **Wrapper contract (fallback):** A `ShadowWrapper` holds the original token and issues 1:1 shadow-compatible tokens. Adds a wrapping step but avoids governance coordination.

3. **New tokens:** Any new ERC20 on Taiko inherits `ShadowCompatibleERC20` from day one.

---

## 11. Recommended Phased Implementation

**Phase 1 — Standard definition**
- Publish `IShadowCompatibleToken.sol` + `ShadowCompatibleERC20.sol`
- Deploy a test token on Hoodi implementing the interface
- Verify end-to-end: deposit via plain ERC20 `transfer` → prove → `shadowMint` delivers tokens

**Phase 2 — ZK circuit**
- Extend `shadow-proof-core` with two-level ERC20 balance proof
- New `imageId` produced
- Test proving against the Phase 1 test token

**Phase 3 — Contract upgrade**
- Update `IShadow.PublicInput`, `Risc0CircuitVerifier`, `Shadow.sol`
- ETH claims continue working throughout

**Phase 4 — Server and UI**
- Update `rpc.rs`, `pipeline.rs`, `deposits.rs`
- UI: token selector; deposit UX (plain ERC20 transfer to targetAddress, same as ETH); balance display

**Phase 5 — Token governance coordination**
- Upgrade TKO and bridge tokens, or deploy wrappers

---

---

## 12. Privacy Analysis

### Public inputs at claim time

| Field | On-chain source | Reveals deposit info? |
|-------|----------------|-----------------------|
| `blockNumber` | journal | No depositor/address; narrows timing window (same as ETH) |
| `blockHash` | journal | Authenticates state root only |
| `chainId` | journal | No |
| `amount` | journal | Claim size — same as ETH |
| `recipient` | journal | Intended; recipient wants tokens |
| `nullifier` | journal | Derived from secret; looks random |
| `token` | journal | Token type only — see §Anonymity set below |
| `Transfer(0x0, recipient, amount)` | `shadowMint` event | Same as ETH `mintEth` — no source address |

### `targetAddress` — the critical hidden field

`targetAddress` is used **only as a circuit witness**. It never appears in the journal, the public inputs, the `claim()` calldata, or any contract event. An observer who sees a claim on-chain cannot determine which address held the tokens, because:

- The ZK proof proves "there exists an address with balance ≥ amount at blockNumber consistent with this nullifier" — it does not commit to which address
- The nullifier is derived from the depositor's secret; without the secret, the nullifier cannot be linked to a `targetAddress`
- `balanceStorageSlot` is a `pure` function — calling it on-chain or off-chain leaves no trace

### Anonymity set for ERC20 vs ETH

For ETH, the anonymity set is all ETH transfers to any address before `blockNumber`. For ERC20, the set is all transfers of the **specific token** to any address before `blockNumber`. This is smaller. The practical impact depends on the token's transaction volume:

- High-volume tokens (bridged USDC, WETH): large anonymity set, strong privacy
- Low-volume tokens: small set, weaker privacy — users should wait longer before claiming

This is inherent — Shadow.sol must know which token to call. Users who require maximum anonymity should use high-volume tokens and delay claiming.

### RPC node operational concern

The Shadow server calls:
```
eth_call(token, "balanceStorageSlot(address)", targetAddress)
eth_getProof(token, [storageKey], blockNumber)
```

These are off-chain RPC calls with no on-chain trace, but the RPC node sees `targetAddress` in plaintext. This is the same risk as the existing ETH flow (`eth_getProof(targetAddress, [], blockNumber)`). Mitigation: use a private RPC endpoint or a local node. This is an operational concern, not a protocol-level leak.

### What is never revealed on-chain

- The depositor's address
- `targetAddress` (the intermediary holding the tokens)
- The deposit transaction hash or block
- The secret or any derivative that enables linkage

---

## Appendix: Verifying `balanceStorageSlot`

Once a token implements `IShadowCompatibleToken`:

```bash
# Get the storage key for a given holder:
cast call <tokenAddress> "balanceStorageSlot(address)(bytes32)" <targetAddress>

# Verify it maps to the correct balance in raw storage:
cast storage <tokenAddress> \
  $(cast call <tokenAddress> "balanceStorageSlot(address)(bytes32)" <targetAddress>)
# Must equal:
cast call <tokenAddress> "balanceOf(address)(uint256)" <targetAddress>
```

For tokens not yet implementing the interface, find the mapping slot manually:

```bash
# Try slot 0 (OZ ERC20 default):
cast storage <tokenAddress> \
  $(cast keccak "$(cast abi-encode 'f(address,uint256)' <holder> 0)")
# Compare to balanceOf — if they match, slot = 0. Otherwise try 1, 2, etc.
```

Expected for Taiko Hoodi tokens (verify empirically after upgrade):

| Token | Contract | `_balances` slot | Storage Key |
|-------|----------|-----------------|-------------|
| Bridged WETH | `BridgedERC20` / `BridgedERC20V2` | **251** | `keccak256(abi.encode(holder, 251))` |
| Bridged USDC | `BridgedERC20` / `BridgedERC20V2` | **251** | `keccak256(abi.encode(holder, 251))` |
| TKO | to be verified | to be verified | verify empirically |

The slot 251 value comes from the auto-generated `BridgedERC20V2_Layout.sol` — the large gap arrays in `EssentialContract` / `Ownable2StepUpgradeable` / `UUPSUpgradeable` push `_balances` far from slot 0. Always cross-check the layout file for any token before deploying.

Storage layouts shift with proxy upgrades — always verify with `cast storage`, never assume.
