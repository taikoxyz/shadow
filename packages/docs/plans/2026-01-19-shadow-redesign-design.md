# Shadow Redesign Design Notes (2026-01-19)

Note: this document contains historical design notes and is not the source of truth.
For the current implementation, see `PRD.md` and `packages/contracts/docs/circuit-public-inputs-spec.md`.

## Goal

Redesign Shadow to remove burn-event provenance and instead authorize claims
by proving a derived target address holds enough ETH in a recent L1 block.

## Core Model

- Users define a fixed note set (1-5 notes). Each note has a non-zero wei
  `amount` and a recipient binding `recipientHash`.
- The note list is immutable and ordered (zero-based index). No notes can be
  added later.
- The target address is derived from `(secret, chainId, notes[])` and funded
  via normal transfers (no burn event).
- A claim is possible only if the target address balance is at least the sum
  of all notes.

## Proof Requirements

- Prove the block header hash equals the public `blockHash`, which the
  contract checks against `IBlockHashProvider.getBlockHash(blockNumber)`.
- Prove the Merkle-Patricia account proof under the header's `stateRoot` for
  the derived target address.
- Prove `sum(amounts) <= 32 ETH`, each `amount_i > 0`, and `noteCount` in
  `[1, 10]`.
- Prove the selected note index binds to the public `amount` and `recipient`
  via `recipientHash`.
- Prove `notesHash = sha256(concat(note_0..note_{n-1}))` where each note is
  `amount_i` (uint256, 32-byte big-endian) + `recipientHash_i` (32 bytes).
- Prove PoW: `sha256(notesHash || secret) mod 2^24 == 0`.
- Emit a per-note nullifier:
  `sha256(MAGIC_NULLIFIER || chainId || secret || index)`.

## Public Inputs

Circuit public inputs:

`blockNumber`, `stateRoot`, `chainId`, `amount`, `recipient`, `nullifier`.

Private witness (not public / not in journal): `noteIndex`, `powDigest`.

## Public Input Ordering (v1)

1. `blockNumber`
2. `blockHash`
3. `chainId`
4. `noteIndex`
5. `amount`
6. `recipient`
7. `nullifier`
8. `powDigest`

## On-Chain Behavior

- Verify `blockHash` via the provider and ensure `chainId == block.chainid`.
- Verify the proof via `ShadowVerifier`.
- Enforce PoW bits, consume the nullifier, and mint `amount` to `recipient`.

## Risks and Open Questions

- Trusted block hash provider is a core assumption.
- Secret leakage enables theft, but recipient binding prevents redirection.
- Underfunded target addresses are unclaimable until funded.
