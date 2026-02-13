# Shadow Circuit Public Inputs (Specification)

This document defines the **canonical** public input encoding consumed by:

- `ICircuitVerifier.verifyProof(bytes proof, uint256[] publicInputs)`
- `ShadowVerifier.verifyProof(bytes proof, IShadow.PublicInput input)`

It also specifies how `Risc0CircuitVerifier` binds `publicInputs` to the committed RISC Zero **journal**.

## Public Input Struct

Shadow uses this logical input (see `IShadow.PublicInput`):

- `blockNumber`: L1 block number used for `stateRoot` and `eth_getProof`
- `stateRoot`: L1 state root at `blockNumber`
- `chainId`: L2 chain id (must equal `block.chainid` in `Shadow.claim`)
- `noteIndex`: claimed note index (0-based)
- `amount`: claimed amount (wei, gross note amount; `Shadow.claim` may apply a fee before minting)
- `recipient`: claim recipient
- `nullifier`: claim nullifier
- `powDigest`: anti-spam PoW digest

## Flattened Public Inputs (`uint256[120]`)

`ShadowPublicInputs.toArray()` flattens the struct into a `uint256[]` of length **120**.

Scalar values are stored directly in a single `uint256`. Multi-byte values are stored as **one byte per element**.

| Offset | Length | Field | Type | Encoding |
|---:|---:|---|---|---|
| 0 | 1 | `blockNumber` | `uint256` | Stored directly. |
| 1 | 32 | `stateRoot` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |
| 33 | 1 | `chainId` | `uint256` | Stored directly. |
| 34 | 1 | `noteIndex` | `uint256` | Stored directly. |
| 35 | 1 | `amount` | `uint256` | Stored directly. |
| 36 | 20 | `recipient` | `address` | One byte per element, Solidity byte order (MSB to LSB). |
| 56 | 32 | `nullifier` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |
| 88 | 32 | `powDigest` | `bytes32` | One byte per element, Solidity byte order (MSB to LSB). |

### Byte Element Constraints

For all byte-encoded fields (`stateRoot`, `recipient`, `nullifier`, `powDigest`):

- Each `publicInputs[i]` representing a byte **MUST** be in `[0, 255]`.

### Byte Order (Solidity Byte Indexing)

Multi-byte values are written in the same order as Solidity's byte indexing:

- Most-significant byte first
- Least-significant byte last

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
2. checking `journal.length == 152`
3. parsing fields from `journal` and comparing them to the expected values derived from `publicInputs`
4. calling the configured RISC0 verifier with `sha256(journal)`

### Journal Binary Layout (`bytes[152]`)

The journal is a fixed 152-byte binary blob with the following layout:

| Offset (bytes) | Size | Field | Type | Encoding |
|---:|---:|---|---|---|
| 0 | 8 | `blockNumber` | `uint64` | Little-endian integer. |
| 8 | 32 | `stateRoot` | `bytes32` | Raw bytes. |
| 40 | 8 | `chainId` | `uint64` | Little-endian integer. |
| 48 | 4 | `noteIndex` | `uint32` | Little-endian integer. |
| 52 | 16 | `amount` | `uint128` | Little-endian integer. |
| 68 | 20 | `recipient` | `bytes20` | Raw bytes. |
| 88 | 32 | `nullifier` | `bytes32` | Raw bytes. |
| 120 | 32 | `powDigest` | `bytes32` | Raw bytes. |

### Binding Rules

The binding checks are:

- `journal.blockNumber` (LE `uint64`) equals `publicInputs[0]`
- `journal.stateRoot` equals `bytes32(publicInputs[1..32])`
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
- `stateRoot = 0xabc...def` (32 bytes)
- `chainId = 167013`
- `noteIndex = 0`
- `amount = 1000000000000000000` (1 ETH)
- `recipient = 0xBEEF...0000` (20 bytes)
- `nullifier = 0x123...789` (32 bytes)
- `powDigest = 0xfff...000` (32 bytes, ending in 3 zero bytes)

Then the flattened array contains:

```text
publicInputs[0]   = 100               // blockNumber
publicInputs[1]   = stateRoot[0]      // MSB
...
publicInputs[32]  = stateRoot[31]     // LSB
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
publicInputs[117] = 0                // powDigest[29] must be 0
publicInputs[118] = 0                // powDigest[30] must be 0
publicInputs[119] = 0                // powDigest[31] must be 0
```

## Source Of Truth

The implementation must match this spec:

- Public input flattening: `src/lib/ShadowPublicInputs.sol`
- Journal binding: `src/impl/Risc0CircuitVerifier.sol`
