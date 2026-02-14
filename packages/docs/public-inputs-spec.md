# Shadow Public Inputs Specification

This document defines the **canonical** public input encoding consumed by the Shadow protocol:

- `ICircuitVerifier.verifyProof(bytes proof, uint256[] publicInputs)`
- `ShadowVerifier.verifyProof(bytes proof, IShadow.PublicInput input)`

It also specifies how `Risc0CircuitVerifier` binds `publicInputs` to the committed RISC Zero **journal**.

## Public Input Struct

Shadow uses this logical input (see `IShadow.PublicInput`):

| Field | Description |
|-------|-------------|
| `blockNumber` | Block number used for `blockHash` and `eth_getProof` |
| `blockHash` | Block hash at `blockNumber` (verified by prover against header RLP) |
| `chainId` | Chain id (must equal `block.chainid` in `Shadow.claim`) |
| `noteIndex` | Claimed note index (0-based) |
| `amount` | Claimed amount (wei, gross note amount; `Shadow.claim` applies a 0.1% fee) |
| `recipient` | Claim recipient |
| `nullifier` | Claim nullifier |
| `powDigest` | Anti-spam PoW digest |

## Flattened Public Inputs (`uint256[120]`)

`ShadowPublicInputs.toArray()` flattens the struct into a `uint256[]` of length **120**.

Scalar values are stored directly in a single `uint256`. Multi-byte values are stored as **one byte per element**.

### Layout

| Offset | Length | Field | Type | Encoding |
|---:|---:|---|---|---|
| 0 | 1 | `blockNumber` | `uint256` | Stored directly. |
| 1 | 32 | `blockHash` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |
| 33 | 1 | `chainId` | `uint256` | Stored directly. |
| 34 | 1 | `noteIndex` | `uint256` | Stored directly. |
| 35 | 1 | `amount` | `uint256` | Stored directly. |
| 36 | 20 | `recipient` | `address` | One byte per element, Solidity byte order (MSB to LSB). |
| 56 | 32 | `nullifier` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |
| 88 | 32 | `powDigest` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |

### Constraints

- `inputs.length == 120` must hold for verifier calls.
- For all byte-encoded fields (`blockHash`, `recipient`, `nullifier`, `powDigest`): each `publicInputs[i]` representing a byte **MUST** be in `[0, 255]`.

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

1. Decoding `(seal, journal)` from the proof
2. Checking `journal.length == 152`
3. Parsing fields from `journal` and comparing them to the expected values derived from `publicInputs`
4. Calling the configured RISC0 verifier with `sha256(journal)`

### Journal Binary Layout (`bytes[152]`)

The journal is a fixed 152-byte binary blob with the following layout:

| Offset (bytes) | Size | Field | Type | Encoding |
|---:|---:|---|---|---|
| 0 | 8 | `blockNumber` | `uint64` | Little-endian integer. |
| 8 | 32 | `blockHash` | `bytes32` | Raw bytes. |
| 40 | 8 | `chainId` | `uint64` | Little-endian integer. |
| 48 | 4 | `noteIndex` | `uint32` | Little-endian integer. |
| 52 | 16 | `amount` | `uint128` | Little-endian integer. |
| 68 | 20 | `recipient` | `bytes20` | Raw bytes. |
| 88 | 32 | `nullifier` | `bytes32` | Raw bytes. |
| 120 | 32 | `powDigest` | `bytes32` | Raw bytes. |

### Binding Rules

The binding checks are:

- `journal.blockNumber` (LE `uint64`) equals `publicInputs[0]`
- `journal.blockHash` equals `bytes32(publicInputs[1..32])`
- `journal.chainId` (LE `uint64`) equals `publicInputs[33]`
- `journal.noteIndex` (LE `uint32`) equals `publicInputs[34]`
- `journal.amount` (LE `uint128`) equals `publicInputs[35]`
- `journal.recipient` equals `address(publicInputs[36..55])`
- `journal.nullifier` equals `bytes32(publicInputs[56..87])`
- `journal.powDigest` equals `bytes32(publicInputs[88..119])`

Finally:

- `journalDigest = sha256(journal)`
- `IRiscZeroVerifier.verify(seal, imageId, journalDigest)` must succeed

## PoW Digest (`powDigest`)

The PoW digest is defined as:

- `powDigest = sha256(notesHash || secret)`

The digest is valid iff it has **24 trailing zero bits**:

- `uint256(powDigest) & ((1 << 24) - 1) == 0`

Equivalently, the last 3 bytes of `powDigest` must be zero. In the flattened public input array, that corresponds to:

- `publicInputs[117] == 0`
- `publicInputs[118] == 0`
- `publicInputs[119] == 0`

## Example (Flattened Array)

Given:

- `blockNumber = 100`
- `blockHash = 0xabc...def` (32 bytes)
- `chainId = 167013`
- `noteIndex = 0`
- `amount = 1000000000000000000` (1 ETH)
- `recipient = 0xBEEF...0000` (20 bytes)
- `nullifier = 0x123...789` (32 bytes)
- `powDigest = 0xfff...000` (32 bytes, ending in 3 zero bytes)

Then the flattened array contains:

```text
publicInputs[0]   = 100               // blockNumber
publicInputs[1]   = blockHash[0]      // MSB
...
publicInputs[32]  = blockHash[31]     // LSB
publicInputs[33]  = 167013            // chainId
publicInputs[34]  = 0                 // noteIndex
publicInputs[35]  = 1000000000000000000
publicInputs[36]  = recipient[0]      // MSB
...
publicInputs[55]  = recipient[19]     // LSB
publicInputs[56]  = nullifier[0]      // MSB
...
publicInputs[87]  = nullifier[31]     // LSB
publicInputs[88]  = powDigest[0]      // MSB
...
publicInputs[117] = 0                 // powDigest[29] must be 0
publicInputs[118] = 0                 // powDigest[30] must be 0
publicInputs[119] = 0                 // powDigest[31] must be 0
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
