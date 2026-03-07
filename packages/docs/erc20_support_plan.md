# ERC20 Token Support — Phased Implementation Plan

## Context

Shadow currently supports ETH-only privacy transfers. This plan extends it to support ERC20 tokens using the mint model described in `erc20_support_research.md`. Tokens implement `IShadowCompatibleToken` (3 functions: `shadowMint`, `balanceStorageSlot`, `maxShadowMintAmount`). The ZK circuit adds a two-level MPT proof (state trie → storageRoot, storage trie → balance). The journal grows from 116→136 bytes. All existing ETH flows continue working — ERC20 is additive.

---

## Phase 1 — Token Standard & Test Token

**Goal:** Publish `IShadowCompatibleToken` interface and deploy a test token on Hoodi.

### Files to create
- `packages/contracts/src/iface/IShadowCompatibleToken.sol` — interface (3 functions + 1 error)
- `packages/contracts/src/impl/ShadowCompatibleERC20.sol` — abstract base implementation
- `packages/contracts/src/impl/TestShadowToken.sol` — concrete test token for Hoodi

### Files to modify
- `packages/contracts/test/Shadow.t.sol` — add tests for `IShadowCompatibleToken` compliance

### TODO
- [ ] Create `IShadowCompatibleToken.sol` with `shadowMint`, `balanceStorageSlot`, `maxShadowMintAmount` (copy from research doc §4)
- [ ] Create `ShadowCompatibleERC20.sol` abstract base (copy from research doc §4 reference implementation)
- [ ] Create `TestShadowToken.sol` — concrete ERC20 inheriting `ShadowCompatibleERC20`, sets `_BALANCE_SLOT = 0` (plain OZ ERC20)
- [ ] Write unit tests: `shadowMint` access control, `balanceStorageSlot` correctness, `maxShadowMintAmount` enforcement
- [ ] Verify `balanceStorageSlot` output matches `cast storage` for the test token
- [ ] Deploy test token to Hoodi, verify `balanceStorageSlot` works against live storage

### Verification
```bash
pnpm contracts:test  # new tests pass
forge script DeployTestShadowToken --broadcast  # deploys to Hoodi
cast call <testToken> "balanceStorageSlot(address)(bytes32)" <someAddress>
cast storage <testToken> <storageKey>  # must match balanceOf
```

---

## Phase 2 — ZK Circuit (two-level MPT proof)

**Goal:** Extend `shadow-proof-core` to prove ERC20 balance via two-level MPT walk. Produces new `imageId`.

### Files to modify
- `packages/risc0-prover/crates/shadow-proof-core/src/lib.rs`
  - Add `TokenClaimInput` struct (token_address, balance_storage_key, proof nodes)
  - Add `token: Option<TokenClaimInput>` to `ClaimInput`
  - Add `token: [u8; 20]` to `ClaimJournal`, update `PACKED_JOURNAL_LEN` 116→136
  - Add `verify_account_proof_and_get_storage_root()` — MPT walk reading field[2]
  - Add `verify_storage_proof_and_get_value()` — MPT walk on storage trie
  - Branch `evaluate_claim()`: ETH path (existing) vs ERC20 path (new two-level proof)
  - Write `[0u8; 20]` for token in journal when `token` is `None` (ETH)

### TODO
- [ ] Define `TokenClaimInput` struct with `token_address: [u8; 20]`, `balance_storage_key: [u8; 32]`, `token_account_proof_nodes: Vec<Vec<u8>>`, `balance_storage_proof_nodes: Vec<Vec<u8>>`
- [ ] Add `token: Option<TokenClaimInput>` field to `ClaimInput`
- [ ] Add `token: [u8; 20]` to `ClaimJournal`
- [ ] Update `PACKED_JOURNAL_LEN` from 116 to 136
- [ ] Update journal packing/unpacking to include token bytes at offset 116
- [ ] Refactor `verify_account_proof_and_get_balance` into a generic `verify_account_proof_and_get_field(root, addr, nodes, field_index)` that returns field[N] from account RLP
- [ ] Implement `verify_storage_proof_and_get_value(storage_root, storage_key, proof_nodes)` — MPT walk using `keccak256(storage_key)` as path, returns RLP-decoded uint256
- [ ] Branch in `evaluate_claim()`: if `token.is_some()` → ERC20 path (two-level), else → ETH path (existing)
- [ ] ERC20 path: Level 1 → get storageRoot via `verify_account_proof_and_get_field(..., 2)`, Level 2 → get balance via `verify_storage_proof_and_get_value`
- [ ] Commit token address to journal (20 bytes at offset 116)
- [ ] Add error variants: `StorageProofFailed`, `StorageRootMissing`, `InvalidStorageValue`
- [ ] Write unit tests with hardcoded MPT proof fixtures for ERC20 balance verification
- [ ] Build guest, record new `imageId`

### Verification
```bash
pnpm prover:build  # compiles, new imageId printed
cargo test -p shadow-proof-core  # unit tests pass
# Generate a test proof against the Phase 1 test token on Hoodi
```

### Dependencies
- Phase 1 test token deployed (needed for integration test proofs)

---

## Phase 3 — Contract Upgrade

**Goal:** Update Shadow contracts to accept ERC20 claims and call `shadowMint`.

### Files to modify
- `packages/contracts/src/iface/IShadow.sol` — add `address token` to `PublicInput` struct
- `packages/contracts/src/lib/ShadowPublicInputs.sol` — `_PUBLIC_INPUTS_LEN` 87→107, add `_IDX_TOKEN = 87`, add `_writeAddress` for token
- `packages/contracts/src/impl/Risc0CircuitVerifier.sol` — `_JOURNAL_LEN` 116→136, `_OFFSET_TOKEN = 116`, add token binding check in `_requireJournalMatchesPublicInputs`
- `packages/contracts/src/impl/Shadow.sol` — branch `claim()` on `_input.token == address(0)`: ETH→`mintEth`, ERC20→`shadowMint`; add `maxShadowMintAmount` check for ERC20
- `packages/contracts/test/Shadow.t.sol` — ERC20 claim tests, mock token, fee splitting
- `packages/docs/public-inputs-spec.md` — update journal layout and public inputs spec

### TODO
- [ ] Add `address token` field to `PublicInput` in `IShadow.sol`
- [ ] Update `ShadowPublicInputs.sol`: `_PUBLIC_INPUTS_LEN = 107`, add `_IDX_TOKEN = 87`, encode token address
- [ ] Update `Risc0CircuitVerifier.sol`: `_JOURNAL_LEN = 136`, `_OFFSET_TOKEN = 116`, add `_readAddress` + token mismatch check
- [ ] Update `Shadow.sol` `claim()`: if `token == address(0)` → ETH path (unchanged), else → call `IShadowCompatibleToken(token).shadowMint(recipient, net)` and `shadowMint(feeRecipient, fee)`
- [ ] Add ERC20 `maxShadowMintAmount` check: `require(amount <= token_.maxShadowMintAmount())`
- [ ] Update `Claimed` event to include `token` address
- [ ] Update `imageId` constant in verifier to Phase 2 value
- [ ] Write tests: ERC20 claim happy path, ETH claim still works, token max exceeded revert, unauthorized shadowMint revert
- [ ] Update `public-inputs-spec.md` with new journal layout (136 bytes) and public inputs (107 bytes)
- [ ] Run `pnpm contracts:test` — all tests green
- [ ] Deploy upgraded contracts to Hoodi (UUPS upgrade for Shadow, new deploy for verifier)

### Verification
```bash
pnpm contracts:test  # all tests pass (ETH + ERC20)
pnpm contracts:fmt   # formatting clean
# Deploy: upgrade Shadow proxy, deploy new Risc0CircuitVerifier
# Verify: ETH claims still work after upgrade
```

### Dependencies
- Phase 2 new `imageId` (needed for verifier constant)

---

## Phase 4 — Server & UI

**Goal:** Server generates ERC20 proofs and encodes new ABI. UI supports token selection and ERC20 deposits.

### Files to modify (server)
- `packages/server/src/prover/rpc.rs` — add `Erc20BalanceProofData` struct, `eth_get_erc20_balance_proof()` function
- `packages/server/src/prover/pipeline.rs` — branch `build_claim_input()` for ERC20: call `balanceStorageSlot` via `eth_call`, fetch two-level proof, build `TokenClaimInput`
- `packages/risc0-prover/crates/shadow-prover-lib/src/deposit.rs` — add `token: Option<String>` to deposit schema v3, update `validate_deposit`, `derive_deposit_info`
- `packages/risc0-prover/crates/shadow-prover-lib/src/lib.rs` — update `prove_claim` and `export_proof` for new `ClaimInput`/`ClaimJournal`
- `packages/server/src/routes/deposits.rs` — update `encode_claim_calldata` for 6-field `PublicInput` ABI, update `CreateDepositRequest`

### Files to modify (UI)
- `packages/ui/src/views/miningForm.js` — add token selector dropdown, load `maxShadowMintAmount` per token, validate note amounts against token max
- `packages/ui/src/views/depositForm.js` (or equivalent) — ERC20 deposit flow: plain `transfer` to `targetAddress`

### TODO (server)
- [ ] Add `Erc20BalanceProofData` struct to `rpc.rs` with `token_account_proof_nodes`, `balance_storage_proof_nodes`, `balance_storage_key`, `balance_value`
- [ ] Implement `eth_get_erc20_balance_proof()`: (1) `eth_call` to `balanceStorageSlot(targetAddress)` → storage key, (2) `eth_getProof(tokenAddress, [storageKey], blockNumber)` → account + storage proofs
- [ ] Update deposit schema v3 in `deposit.rs`: add `token: Option<String>`, absent/null = ETH
- [ ] Update `validate_deposit` to accept v3 format, validate token address if present
- [ ] Update `build_claim_input` in `pipeline.rs`: if deposit has token → call `eth_get_erc20_balance_proof`, build `TokenClaimInput`; else → existing ETH path
- [ ] Pre-flight check: verify `balance_value >= total_amount` before spending zkVM cycles
- [ ] Update `encode_claim_calldata` in `deposits.rs` for new 6-field `PublicInput` ABI: `claim(bytes,(uint64,uint64,uint256,address,bytes32,address))`
- [ ] Update journal extraction in `export_proof` to handle 136-byte journal
- [ ] Add integration test: generate ERC20 proof against Phase 1 test token on Hoodi

### TODO (UI)
- [ ] Add token selector (dropdown or address input) to deposit creation form
- [ ] For ERC20: show `maxShadowMintAmount` as max note amount (fetched via `eth_call`)
- [ ] For ETH: keep existing `MAX_TOTAL_WEI = 8 ETH` behavior
- [ ] ERC20 deposit instruction: "Send X tokens to targetAddress" (plain ERC20 `transfer`, same UX as ETH)
- [ ] Display token symbol/decimals in claim status (fetched from token contract)
- [ ] Update balance display to show token balance at `targetAddress` for ERC20 deposits

### Verification
```bash
pnpm server:dev  # server starts, accepts ERC20 deposit files
# Create ERC20 deposit file → mine → prove → claim on Hoodi
# Verify ETH flow still works end-to-end
```

### Dependencies
- Phase 3 contracts deployed (needed for `encode_claim_calldata` ABI and on-chain claiming)

---

## Phase 5 — Token Governance Coordination

**Goal:** Upgrade existing Taiko bridge tokens to implement `IShadowCompatibleToken`, or deploy wrappers.

### TODO
- [ ] Coordinate with Taiko Foundation to upgrade `BridgedERC20V2` implementation to inherit `ShadowCompatibleERC20` with `_BALANCE_SLOT = 251`
- [ ] Verify `balanceStorageSlot` output for upgraded bridged tokens: `cast call <bridgedToken> "balanceStorageSlot(address)(bytes32)" <holder>` must match `cast storage`
- [ ] Identify initial token set: bridged WETH, bridged USDC, TKO (verify TKO's `_balances` slot separately)
- [ ] For tokens that cannot be upgraded: design and deploy `ShadowWrapper` ERC20 (1:1 wrap/unwrap + `IShadowCompatibleToken`)
- [ ] End-to-end test: deposit real bridged token → prove → claim on Hoodi
- [ ] Document supported tokens list with verified storage slots

### Dependencies
- All of Phases 1–4 complete
- Taiko Foundation governance approval for bridge token upgrades

---

## Cross-cutting Concerns

### New `imageId`
Phase 2 changes the circuit, producing a new `imageId`. This must be:
- Set in `Risc0CircuitVerifier.sol` (Phase 3)
- Recorded in `MEMORY.md` for operational reference
- The old `imageId` stops working — all pending proofs must be claimed before upgrade

### ETH backward compatibility
- v2 deposit files (no `token` field) continue working as ETH deposits
- `token = None` in `ClaimInput` → existing single-level ETH proof path
- `token = [0u8; 20]` in journal → `address(0)` in contract → ETH `mintEth` path
- All existing nullifiers remain consumed; no double-claim risk

### Privacy invariant
- `targetAddress` remains circuit-internal witness only — never in journal, public inputs, calldata, or events
- ERC20 adds `token` address to journal — this is intentional (Shadow.sol must know which token to mint)
- Anonymity set narrows per-token vs ETH; high-volume tokens recommended for stronger privacy
