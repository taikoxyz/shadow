# Shadow × ERC20 — Research Report

## How the Current System Works (ETH-only)

The system has three layers that must all be understood before changing anything:

1. **Deposit**: User sends ETH to a derived "target address" on L1. The address is computed as
   `last20bytes(SHA256(domain_sep || chainId || secret || notesHash))` — it has no known private key.
2. **ZK Proof**: The RISC Zero guest circuit (`shadow-proof-core`) verifies that `targetAddress` held
   enough ETH at a specific L1 block by traversing the Ethereum **account trie** (state trie). It reads
   the `balance` field from the account RLP (`[nonce, balance, storageRoot, codeHash]`).
3. **Claim**: On Taiko L2, `Shadow.claim()` verifies the Groth16 proof, burns the nullifier, and calls
   `IEthMinter.mintEth(recipient, netAmount)`.

The key constraint: the ZK circuit only reads the ETH **account balance**, not ERC20 storage slots.

---

## The Core Problem with ERC20

ERC20 balances are **not** in the account trie. They live in the **storage trie** of the ERC20 contract,
under a storage key derived from the holder's address:

```
storageKey = keccak256(abi.encode(targetAddress, mappingSlot))
```

Where `mappingSlot` is the Solidity storage slot of the `balances` mapping (slot `0` for standard
OpenZeppelin ERC20s, varies for others like USDC).

To prove an ERC20 balance at block N you need a **two-level trie proof**:
1. Account proof for `erc20ContractAddress` in the state trie → extracts `storageRoot`
2. Storage proof for `storageKey` in the storage trie (rooted at `storageRoot`) → extracts the balance

Both proofs are available via `eth_getProof`:
```
eth_getProof(erc20ContractAddress, [storageKey], blockTag)
```
The response contains `accountProof` (for the ERC20 contract account) and
`storageProof[0].proof` (for the balance slot).

---

## Changes Required Across All Layers

### Layer 1 — ZK Circuit (`packages/risc0-prover/crates/shadow-proof-core`)

This is the most complex change. Currently `evaluate_claim` does one account proof traversal. For
ERC20 it needs two.

**New `ClaimInput` fields:**
```rust
pub token_address: [u8; 20],                     // address(0) = ETH, otherwise ERC20
pub mapping_slot: u64,                            // Solidity storage slot of balances mapping
pub token_account_proof_depth: u32,               // depth of ERC20 contract's account proof
pub token_account_proof_nodes: Vec<Vec<u8>>,
pub token_account_proof_node_lengths: Vec<u32>,
pub storage_proof_depth: u32,                     // depth of storage trie proof for balance slot
pub storage_proof_nodes: Vec<Vec<u8>>,
pub storage_proof_node_lengths: Vec<u32>,
```

**New logic in `evaluate_claim`:**
```
if token_address == [0u8; 20]:
    // ETH path (current implementation)
    account_balance = verify_account_proof_and_get_balance(state_root, target_address, ...)
    check account_balance >= total_amount
else:
    // ERC20 path
    storage_root = verify_account_proof_and_get_storage_root(state_root, token_address, ...)
    storage_key = keccak256(pad32(target_address) || pad32(mapping_slot))
    token_balance = verify_storage_proof_and_get_value(storage_root, storage_key, ...)
    check token_balance >= total_amount
```

**New functions needed in `shadow-proof-core`:**
- `verify_account_proof_and_get_storage_root` — same MPT traversal as the existing balance function,
  but returns `storageRoot` (field[2]) instead of `balance` (field[1]) from account RLP
- `verify_storage_proof_and_get_value` — MPT traversal with `storageRoot` as root; storage values are
  RLP-encoded big integers, not account RLPs
- `derive_storage_key` — `keccak256(left-pad-32(address) || left-pad-32(slot))`

Storage values in the storage trie are RLP-encoded as big-endian integers. The decoding is the same
mechanism as account RLP but the expected structure is a single scalar, not a 4-field list.

**New `ClaimJournal` field:**
```rust
pub token_address: [u8; 20],   // address(0) = ETH
```

The packed journal grows from 116 bytes to **136 bytes** (+ 20 bytes for `token_address`). This is a
breaking change.

**Nullifier derivation** must include `token_address` to prevent cross-token nullifier reuse:
```rust
nullifier = SHA256(domain_sep || chainId || secret || noteIndex || token_address)
```
Without this, the same nullifier could be consumed to claim one token, blocking claims for another
token type from the same deposit.

---

### Layer 2 — Public Inputs Spec (`packages/docs/public-inputs-spec.md` + `ShadowPublicInputs.sol`)

The flat `uint256[87]` array needs a `tokenAddress` field. The cleanest layout places it after `chainId`:

| Offset | Length | Field |
|-------:|-------:|-------|
| 0 | 1 | `blockNumber` |
| 1 | 32 | `blockHash` (one byte per element) |
| 33 | 1 | `chainId` |
| 34 | 20 | `tokenAddress` (one byte per element) |
| 54 | 1 | `amount` |
| 55 | 20 | `recipient` (one byte per element) |
| 75 | 32 | `nullifier` (one byte per element) |
| **107** | | **total** |

This is a breaking change from the current 87-element array. The `ShadowPublicInputs` library and
`Risc0CircuitVerifier` both encode/decode these offsets by constants — all must be updated together.

---

### Layer 3 — Contracts (`packages/contracts`)

**`IShadow.PublicInput`** — add `tokenAddress`:
```solidity
struct PublicInput {
    uint64 blockNumber;
    uint256 chainId;
    address tokenAddress;   // address(0) = ETH, otherwise L1 ERC20
    uint256 amount;
    address recipient;
    bytes32 nullifier;
}
```

**`Shadow.claim`** — dispatch on token type:
```solidity
if (_input.tokenAddress == address(0)) {
    etherMinter.mintEth(_input.recipient, netAmount);
    if (fee > 0) etherMinter.mintEth(feeRecipient, fee);
} else {
    tokenDistributor.distributeToken(_input.tokenAddress, _input.recipient, netAmount);
    if (fee > 0) tokenDistributor.distributeToken(_input.tokenAddress, feeRecipient, fee);
}
```

A new **`ITokenDistributor`** interface is needed. Its implementation depends on the chosen
distribution model (see Design Decisions below).

**`ShadowPublicInputs.sol`** — update all offset constants to the new 107-element layout, add a
`_writeAddress` call for `tokenAddress`.

---

### Layer 4 — Deposit File Schema

The v2 schema needs a `token` field. Recommended: one token per deposit, all notes use the same token.

```json
{
  "version": "v3",
  "chainId": "167013",
  "secret": "0x...",
  "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "notes": [{ "recipient": "0x...", "amount": "1000000" }]
}
```

Use `"token": "ETH"` or `"token": "0x0000000000000000000000000000000000000000"` for native ETH.

**`notesHash` must include the token** so deposits with different tokens get different target addresses:
```rust
// Per-note contribution now includes token_hash
for i in 0..note_count {
    buf[i * 96..] = [token_hash (32), amount_bytes32 (32), recipient_hash (32)]
}
notesHash = SHA256(buf)
```

This ensures the same `(secret, notes, chainId)` with a different token produces a different
`targetAddress`. Clean isolation, no cross-token collisions.

---

### Layer 5 — CLI/Prover Tooling

**`eth_getProof` call changes:**

For ETH (current):
```js
eth_getProof(targetAddress, [], blockTag)
// accountProof → yields balance
```

For ERC20:
```js
const slot = keccak256(
  ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256'],
    [targetAddress, mappingSlot]
  )
);
eth_getProof(tokenAddress, [slot], blockTag)
// accountProof → proof of tokenAddress in state trie (yields storageRoot)
// storageProof[0].proof → proof of slot in storage trie (yields balance)
```

The `ClaimInput` struct population in the prover lib must be split between ETH and ERC20 paths.

**Token metadata / `mappingSlot`:** For standard OpenZeppelin ERC20s this is always `0`. Notable
exceptions: USDC uses slot `9`, USDT uses slot `2`. The safest approach is to store `mappingSlot`
in the deposit file or in a well-known token registry rather than hardcoding it.

---

### Layer 6 — Frontend/UI

- Token selection (ETH vs. ERC20 address input)
- Balance display in token units, not always wei-denominated
- **Amount cap**: the circuit's `MAX_TOTAL_WEI` constant (`8e18`) applies to token base units.
  For USDC (6 decimals) this equals 8,000,000 USDC — reasonable. For WBTC (8 decimals) this equals
  80 BTC — very large. The cap likely needs to be configurable per token or redesigned as a USD-equivalent
  limit.

---

## Critical Design Decision: ERC20 Distribution on L2

This is the hardest architectural question. Currently the system *mints* ETH — Taiko's protocol has
a native mechanism for this. For ERC20 tokens there is no equivalent native minting capability.

### Option A — Shadow holds L2 ERC20 reserves (simplest to build)

- Deploy ERC20 tokens on L2 Taiko via Taiko's canonical bridge
- Shadow contract holds a pool of each supported token
- On claim: `IERC20(l2TokenAddress).transfer(recipient, netAmount)`
- **Pro**: minimal new infrastructure
- **Con**: Shadow must hold significant token reserves; pool is depletable by valid claims

### Option B — Shadow is granted minting rights on wrapped tokens

- Deploy a `ShadowWrappedToken` for each supported L1 token
- Shadow contract holds `MINTER_ROLE`
- On claim: `IShadowWrappedToken(token).mint(recipient, netAmount)`
- **Pro**: no pre-funding needed
- **Con**: users receive a "Shadow-wrapped" token, not the canonical L2 token

### Option C — Integration with Taiko's canonical bridge

- Taiko's bridge already handles L1→L2 token transfers; a Shadow-specific adapter could tap into bridge
  escrow to release canonical tokens on claim
- **Pro**: users receive canonical bridged tokens; cleanest long-term architecture
- **Con**: highest external dependency; requires Taiko protocol cooperation

**Recommendation**: Option B for initial testnet/development work. Option C is the production-grade
path but requires Taiko coordination.

---

## Summary of What Must Change

| Component | Change Type | Complexity |
|---|---|---|
| ZK circuit (`shadow-proof-core`) | Two-level trie proof; storage key derivation; new journal field | High |
| `ClaimInput` / `ClaimJournal` structs | New fields; journal grows 116→136 bytes | Medium |
| `shadow-prover-lib` (deposit + prover) | `eth_getProof` ERC20 storage path; deposit schema v3 | Medium |
| `ShadowPublicInputs.sol` | New 107-element layout with `tokenAddress` | Medium |
| `IShadow.PublicInput` | Add `tokenAddress` field | Low |
| `Shadow.sol` | Token dispatch in `claim()`; new `ITokenDistributor` dependency | Medium |
| New `ITokenDistributor` interface | Define and implement | Medium–High |
| Nullifier derivation | Include `token_address` | Low (breaking) |
| `notesHash` derivation | Include token in per-note hash | Low (breaking) |
| Deposit file schema | Version v3 with `token` field | Low |
| CLI/tooling | Storage proof construction; ERC20 input paths | Medium |
| Amount cap handling | Per-token limits or configurable cap | Medium |

---

## Recommended Implementation Sequencing

There are no components that can be changed in isolation — the journal format, public inputs layout,
and on-chain verifier form a tightly coupled spec. Any change to token handling must be designed
end-to-end before any code is written.

1. **Spec first**: Finalize the new journal layout (136 bytes) and public inputs layout (107 elements).
   Update `packages/docs/public-inputs-spec.md` before touching any code.
2. **ZK guest**: Update `shadow-proof-core`; regenerate `imageId`. All existing Groth16 proofs become
   invalid at this point.
3. **Contracts**: Update `ShadowPublicInputs`, `Risc0CircuitVerifier`, `IShadow`, and `Shadow` in one
   coordinated change. Redeploy.
4. **Token distribution**: Implement `ITokenDistributor` and chosen distribution mechanism.
5. **CLI/prover tooling**: Update deposit schema v3; implement ERC20 `eth_getProof` path.
6. **Frontend**: Token selection UI, amount display, cap handling.
