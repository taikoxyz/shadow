# Shadow (Taiko Hoodi) — PRD

## Goal

Shadow is a privacy-forward ETH claim system on **Taiko Hoodi** where claims are authorized by proving that a **deterministically derived target address** held enough ETH on **Hoodi L1** at a `stateRoot` checkpointed on Hoodi L2 by Taiko's system `ICheckpointStore` (protocol-guaranteed; finality is trusted).

Key property: deposits are normal ETH transfers to the target address (no deposit contract, no burn event).

## Privacy

Shadow provides privacy properties but does not guarantee anonymity. See `PRIVACY.md` for user-facing data exposure and linkability limitations.

## Users

- Depositor: creates a note set, derives a target address, funds it on Hoodi L1.
- Recipient: claims a specific note on Hoodi L2 by submitting a ZK proof.

## Core Concepts

### Note Set

- Notes: **1..5**, ordered, immutable after creation.
- Each note contains:
  - `recipient` (address)
  - `amount` (wei, > 0)
  - `label` (optional; excluded from derivation and proving)
- Total note sum: **<= 32 ETH**.

### Deposit File (User Secret Material)

A JSON file containing `secret` and the fixed note set.

- Losing the file means losing the ability to claim.
- Leaking the file means anyone can generate proofs, but **claims still mint to the note’s bound `recipient`** (net of the claim fee).

Schema: `packages/docs/data/schema/deposit.schema.json`.
Current deposit format version: `v2`.

### Target Address (Derived, “Unspendable”)

The target address is derived from `(secret, chainId, notes[])` in a way that does not correspond to a known private key.

Current implementation:
- Compute a note commitment `notesHash` from `amounts[]` + `recipient_hashes[]`.
- Derive `targetAddress = last20bytes(SHA256(domain_sep || chainId || secret || notesHash))`.

Deposits are made to `targetAddress` on **Hoodi L1** using standard ETH transfers.

### Nullifier (Double-Claim Prevention)

A per-note nullifier is derived inside the circuit and published as part of the proof’s public outputs. The on-chain nullifier store consumes it to prevent replays.

Current implementation:
- `nullifier = SHA256(domain_sep || chainId || secret || noteIndex)`

## System Flow

1. User creates a deposit file (note set + secret).
2. App/CLI derives `targetAddress` and displays it.
3. Anyone funds `targetAddress` on **Hoodi L1** with ETH.
4. Claimer generates a ZK proof for a single `noteIndex` using:
   - An L1 `stateRoot` at some `blockNumber`
   - An Ethereum account trie proof (`eth_getProof`) for `targetAddress` at that block
5. Claimer submits an L2 transaction calling `Shadow.claim(proof, publicInput)`.

## ZK Proof Statement (What Must Be Proven)

Given private inputs `(secret, full note set, accountProofNodes...)` and public inputs `(blockNumber, stateRoot, chainId, noteIndex, recipient, amount, nullifier, powDigest)` the proof must show:

1. Note validity
   - `noteIndex` is within note set bounds.
   - Selected note matches the public `recipient` and `amount` (recipient is bound via a hash inside the circuit).
2. Target address derivation
   - `targetAddress` is derived deterministically from `(secret, chainId, notesHash)`.
3. L1 balance authorization (account proof)
   - The provided Merkle-Patricia trie proof is valid under the supplied `stateRoot`.
   - It authenticates the account record for `targetAddress` in the L1 state trie.
   - The extracted account balance satisfies `balance(targetAddress) >= sum(noteAmounts)`.
4. Nullifier correctness
   - `nullifier` is derived correctly for `(secret, chainId, noteIndex)`.
5. Anti-spam PoW (currently enforced)
   - `powDigest = SHA256(notesHash || secret)` has **24 trailing zero bits** (bound to the note set).

Proof system (current): **RISC Zero zkVM**, with **Groth16 receipts** for on-chain verification (trusted setup is provided by RISC0 tooling; no new ceremony required).

## On-Chain Components (Hoodi L2)

- `Shadow`:
  - Checks `chainId == block.chainid`, `amount > 0`, `recipient != 0`, and PoW predicate.
  - Calls `ShadowVerifier.verifyProof`.
  - Consumes the nullifier.
  - Applies claim fee: `fee = amount / 1000` (0.1%).
  - Mints `amount - fee` to the note `recipient` and (if `fee > 0`) mints `fee` to an immutable `feeRecipient` (currently set to the initial owner at deployment).

- `ShadowVerifier`:
  - Loads a checkpoint from `ICheckpointStore.getCheckpoint(blockNumber)`.
  - Requires checkpoint `stateRoot == publicInput.stateRoot`.
  - Trust model: the checkpoint is provided by a Taiko **system-level** contract and is guaranteed by the Taiko rollup protocol; Shadow trusts checkpoint correctness and finality.
  - Calls `ICircuitVerifier.verifyProof(proof, publicInputsArray)`.
  - Note: no freshness constraint is enforced (old checkpoints are acceptable).

- `Risc0CircuitVerifier`:
  - ABI-decodes `(seal, journal)` from `proof`.
  - Ensures selected fields in `journal` match the provided public inputs.
  - Calls Taiko’s deployed RISC0 verifier with `(seal, imageId, SHA256(journal))`.

- `Nullifier`:
  - Tracks consumed nullifiers and prevents reuse.

- `IEthMinter`:
  - Testnet: `DummyEtherMinter` emits `EthMinted(to, amount)` (no real mint).
  - Production: integrate Taiko protocol’s real `IEthMinter`.

## Taiko Hoodi Parameters

- Hoodi L2 chainId: `167013`
- Hoodi L2 RPC: `https://rpc.hoodi.taiko.xyz`
- Hoodi L1 RPC (used for `eth_getProof`): `https://ethereum-hoodi-rpc.publicnode.com`
- `ICheckpointStore` (Hoodi L2): `0x1670130000000000000000000000000000000005`

## CLI / Proving UX

- Install prerequisites + build host binary:
  - `node packages/risc0-prover/scripts/install-cli.mjs`
- Groth16 receipts require Docker (used by upstream `risc0-groth16` shrinkwrap).
- Deposit validation / proof / verify / claim:
  - `node packages/risc0-prover/scripts/shadowcli.mjs --help`

## Non-Goals

- UI / web app implementation.
- Mixer-like deposit contracts.
- Enforcing checkpoint recency.

## Production Readiness Gate

Shadow is “production-ready” only when:

- End-to-end: prove -> on-chain verify -> claim works on target network with the real `IEthMinter`.
- Guest program and on-chain bindings are tested against adversarial/edge-case trie proofs and amounts.
- Contracts and proving pipeline are audited and threat-modeled.
