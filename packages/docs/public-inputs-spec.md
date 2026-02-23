# Shadow Public Inputs Specification

This document defines the **canonical** public input encoding consumed by the Shadow protocol:

- `ICircuitVerifier.verifyProof(bytes proof, uint256[] publicInputs)`
- `ShadowVerifier.verifyProof(bytes proof, IShadow.PublicInput input)`

It also specifies how `Risc0CircuitVerifier` binds `publicInputs` to the committed RISC Zero **journal**.

## Claim Call Data Struct (`IShadow.PublicInput`)

`Shadow.claim()` and `ShadowVerifier.verifyProof()` take the caller-provided claim input (see `IShadow.PublicInput`):

- `blockNumber`: checkpoint block number (used to query `ICheckpointStore.getCheckpoint(blockNumber)`)
- `chainId`: L2 chain id (must equal `block.chainid` in `Shadow.claim`)
- `amount`: claimed amount (wei, gross note amount; `Shadow.claim` may apply a fee before minting)
- `recipient`: claim recipient
- `nullifier`: claim nullifier

### Derived Public Value: `stateRoot`

`stateRoot` is part of the **circuit public inputs** and journal binding, but it is not provided as calldata.

On-chain, `ShadowVerifier` derives:

- `checkpoint = checkpointStore.getCheckpoint(blockNumber)`
- `stateRoot = checkpoint.stateRoot`

and uses the derived `stateRoot` when building `publicInputs`.

### Private Witness Values (Not Public Inputs / Not In Journal)

The zkVM guest enforces these values privately:

- `noteIndex`: claimed note index (0-based)
- `powDigest = sha256(notesHash || secret)` with 24 trailing zero bits

Neither value is committed in the RISC0 journal and neither is provided to contracts as calldata.

## Flattened Public Inputs (`uint256[87]`)

`ShadowPublicInputs.toArray(IShadow.PublicInput input, bytes32 stateRoot)` flattens the values into a `uint256[]` of length **87**.

Scalar values are stored directly in a single `uint256`. Multi-byte values are stored as **one byte per element**.

### Layout

| Offset | Length | Field | Type | Encoding |
|---:|---:|---|---|---|
| 0 | 1 | `blockNumber` | `uint256` | Stored directly. |
| 1 | 32 | `blockHash` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |
| 33 | 1 | `chainId` | `uint256` | Stored directly. |
| 34 | 1 | `amount` | `uint256` | Stored directly. |
| 35 | 20 | `recipient` | `address` | One byte per element, Solidity byte order (MSB to LSB). |
| 55 | 32 | `nullifier` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |

### Constraints

For all byte-encoded fields (`stateRoot`, `recipient`, `nullifier`):

- Each `publicInputs[i]` representing a byte **MUST** be in `[0, 255]`.

### Byte Order (Solidity Byte Indexing)

Multi-byte values are written in the same order as Solidity's `bytes` indexing (most-significant byte first, least-significant byte last).

#### `bytes32` Encoding

For a `bytes32 v`, at offset `o`:

```text
publicInputs[o + 0]  = uint8(v[0])   // MSB
publicInputs[o + 1]  = uint8(v[1])
...
publicInputs[o + 31] = uint8(v[31])  // LSB
```

#### `address` Encoding

For an `address a`, at offset `o`:

```text
publicInputs[o + 0]  = uint8(bytes20(a)[0])   // MSB
publicInputs[o + 1]  = uint8(bytes20(a)[1])
...
publicInputs[o + 19] = uint8(bytes20(a)[19])  // LSB
```

## RISC Zero Proof Payload + Journal Binding

`Risc0CircuitVerifier` expects `proof` to be:

- `abi.encode(bytes seal, bytes journal)`

The verifier binds `publicInputs` to the proof by:

1. decoding `(seal, journal)`
2. checking `journal.length == 116`
3. parsing fields from `journal` and comparing them to the expected values derived from `publicInputs`
4. calling the configured RISC0 verifier with `sha256(journal)`

### Journal Binary Layout (`bytes[116]`)

The journal is a fixed 116-byte binary blob with the following layout:

| Offset (bytes) | Size | Field | Type | Encoding |
|---:|---:|---|---|---|
| 0 | 8 | `blockNumber` | `uint64` | Little-endian integer. |
| 8 | 32 | `blockHash` | `bytes32` | Raw bytes. |
| 40 | 8 | `chainId` | `uint64` | Little-endian integer. |
| 48 | 16 | `amount` | `uint128` | Little-endian integer. |
| 64 | 20 | `recipient` | `bytes20` | Raw bytes. |
| 84 | 32 | `nullifier` | `bytes32` | Raw bytes. |

### Binding Rules

The binding checks are:

- `journal.blockNumber` (LE `uint64`) equals `publicInputs[0]`
- `journal.blockHash` equals `bytes32(publicInputs[1..32])`
- `journal.chainId` (LE `uint64`) equals `publicInputs[33]`
- `journal.amount` (LE `uint128`) equals `publicInputs[34]`
- `journal.recipient` equals `address(publicInputs[35..54])`
- `journal.nullifier` equals `bytes32(publicInputs[55..86])`

Finally:

- `journalDigest = sha256(journal)`
- `IRiscZeroVerifier.verify(seal, imageId, journalDigest)` must succeed

## Example (Flattened Array)

Given:

- `blockNumber = 100`
- `blockHash = 0xabc...def` (32 bytes)
- `chainId = 167013`
- `amount = 1000000000000000000` (1 ETH)
- `recipient = 0xBEEF...0000` (20 bytes)
- `nullifier = 0x123...789` (32 bytes)

Then the flattened array contains:

```text
publicInputs[0]   = 100               // blockNumber
publicInputs[1]   = blockHash[0]      // MSB
...
publicInputs[32]  = blockHash[31]     // LSB
publicInputs[33]  = 167013            // chainId
publicInputs[34]  = 1000000000000000000
publicInputs[35]  = recipient[0]      // MSB
...
publicInputs[54]  = recipient[19]     // LSB
publicInputs[55]  = nullifier[0]      // MSB
...
publicInputs[86]  = nullifier[31]     // LSB
```

## Private Inputs

The circuit also requires private inputs that are not exposed on-chain. These are provided by the prover and verified internally by the circuit.

### Block Header

The full Ethereum block header is provided as private input. The circuit verifies:

- The header RLP hashes to the public `blockHash`
- The header contains the correct `stateRoot` for the account proof verification

### Account Proof

Merkle-Patricia trie proof for the target address:

- `accountProofNodes[]`: RLP-encoded trie nodes from `eth_getProof`
- The circuit verifies the proof is valid under the block's `stateRoot`
- Extracts and validates the account balance

### Secret Material

- `secret`: User's secret from the deposit file
- `notes[]`: Full note set (1-5 notes with amount and recipient)

## Source of Truth

The implementation must match this spec:

- Public input flattening: `src/lib/ShadowPublicInputs.sol`
- Journal binding: `src/impl/Risc0CircuitVerifier.sol`
