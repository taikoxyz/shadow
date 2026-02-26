# Shadow — PRD

## Goal

Shadow is a privacy-forward ETH claim system on **Taiko** where claims are authorized by proving that a **deterministically derived target address** held enough ETH at a recent block hash verified by the prover.

Key property: deposits are normal ETH transfers to the target address (no deposit contract, no burn event).

## Privacy

Shadow provides privacy properties but does not guarantee anonymity. See `PRIVACY.md` for user-facing data exposure and linkability limitations.

## Users

- Depositor: creates a note set, derives a target address, funds it.
- Recipient: claims a specific note by submitting a ZK proof.

## Core Concepts

### Note Set

- Notes: **1..5**, ordered, immutable after creation.
- Each note contains:
  - `recipient` (address)
  - `amount` (wei, > 0)
  - `label` (optional; excluded from derivation and proving)
- Total note sum: **<= 8 ETH**.

### Deposit File (User Secret Material)

A JSON file containing `secret` and the fixed note set.

- Losing the file means losing the ability to claim.
- Leaking the file means anyone can generate proofs, but **claims still mint to the note's bound `recipient`** (net of the claim fee).

Schema: `packages/docs/data/schema/deposit.schema.json`.
Current deposit format version: `v2`.

### Target Address (Derived, "Unspendable")

The target address is derived from `(secret, chainId, notes[])` in a way that does not correspond to a known private key.

Current implementation:
- Compute a note commitment `notesHash` from `amounts[]` + `recipient_hashes[]`.
- Derive `targetAddress = last20bytes(SHA256(domain_sep || chainId || secret || notesHash))`.

Deposits are made to `targetAddress` using standard ETH transfers.

### Nullifier (Double-Claim Prevention)

A per-note nullifier is derived inside the circuit and published as part of the proof’s public outputs. `Shadow` tracks and consumes nullifiers on-chain to prevent replays.

Current implementation:
- `nullifier = SHA256(domain_sep || chainId || secret || noteIndex)`

## System Flow

1. User creates a deposit file (note set + secret).
2. App/CLI derives `targetAddress` and displays it.
3. Anyone funds `targetAddress` with ETH.
4. Claimer generates a ZK proof for a single `noteIndex` using:
   - A canonical L1 `blockHash` at some `blockNumber` (fetched from `TaikoAnchor.blockHashes(blockNumber)` on Hoodi L2)
   - An Ethereum account trie proof (`eth_getProof`) for `targetAddress` at that block
5. Claimer submits an L2 transaction calling `Shadow.claim(proof, input)`.

## ZK Proof Statement (What Must Be Proven)

Given private inputs `(secret, noteIndex, full note set, accountProofNodes...)` and public inputs `(blockNumber, blockHash, chainId, recipient, amount, nullifier)` the proof must show:

1. Note validity
   - `noteIndex` is within note set bounds.
   - Selected note matches the public `recipient` and `amount` (recipient is bound via a hash inside the circuit).
2. Target address derivation
   - `targetAddress` is derived deterministically from `(secret, chainId, notesHash)`.
3. Balance authorization (account proof)
   - The circuit verifies `keccak256(block_header_rlp) == blockHash`, then extracts `stateRoot` from the block header (stateRoot is never a public input — it is derived privately inside the circuit).
   - The provided Merkle-Patricia trie proof authenticates the account record for `targetAddress` under that `stateRoot`.
   - The extracted account balance satisfies `balance(targetAddress) >= sum(noteAmounts)`.
4. Nullifier correctness
   - `nullifier` is derived correctly for `(secret, chainId, noteIndex)`.

Proof system (current): **RISC Zero zkVM**, with **Groth16 receipts** for on-chain verification (trusted setup is provided by RISC0 tooling; no new ceremony required).

## On-Chain Components

- `Shadow`:
  - Checks `chainId == block.chainid`, `amount > 0`, and `recipient != 0`.
  - Calls `ShadowVerifier.verifyProof`.
  - Consumes the nullifier (tracked internally in `Shadow` storage).
  - Applies claim fee: `fee = amount / 1000` (0.1%).
  - Mints `amount - fee` to the note `recipient` and (if `fee > 0`) mints `fee` to an immutable `feeRecipient` (currently set to the initial owner at deployment).

- `ShadowVerifier`:
  - Fetches the canonical `blockHash` from `TaikoAnchor.blockHashes(blockNumber)`.
  - Uses the `blockHash` as a public input to the circuit (it is not user-provided calldata).
  - Trust model: `TaikoAnchor` is a Taiko **system-level** contract whose block hashes are guaranteed by the rollup protocol; Shadow trusts their correctness and finality.
  - Calls `ICircuitVerifier.verifyProof(proof, publicInputsArray)`.
  - Note: no freshness constraint is enforced (old blocks are acceptable).

- `Risc0CircuitVerifier`:
  - ABI-decodes `(seal, journal)` from `proof`.
  - Ensures selected fields in `journal` match the provided public inputs.
  - Calls Taiko's deployed RISC0 verifier with `(seal, imageId, SHA256(journal))`.

- `IEthMinter`:
  - Testnet: `DummyEtherMinter` emits `EthMinted(to, amount)` (no real mint).
  - Production: integrate Taiko protocol's real `IEthMinter`.

## Chain Parameters

- ChainId: `167013` (Hoodi)
- RPC: `https://rpc.hoodi.taiko.xyz`
- Anchor contract: `0x1670130000000000000000000000000000010001`

## UX

### Web UI (primary)

A single Docker image bundles the Rust backend server and the Vite frontend. Run `./start.sh` (or `curl ... | sh`) to start the container, then open the browser at the printed URL. The UI supports: creating deposits, funding via MetaMask, generating proofs (server-side), and submitting claims.

### CLI

- Install prerequisites + build host binary:
  - `node packages/risc0-prover/scripts/install-cli.mjs`
- Groth16 receipts require Docker (used by upstream `risc0-groth16` shrinkwrap).
- Deposit validation / proof / verify / claim:
  - `node packages/risc0-prover/scripts/shadowcli.mjs --help`

## Non-Goals

- Mixer-like deposit contracts.
- Enforcing block recency.

## Production Readiness Gate

Shadow is "production-ready" only when:

- End-to-end: prove -> on-chain verify -> claim works on target network with the real `IEthMinter`.
- Guest program and on-chain bindings are tested against adversarial/edge-case trie proofs and amounts.
- Contracts and proving pipeline are audited and threat-modeled.