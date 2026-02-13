# Shadow Circuit Public Inputs Specification

This document specifies the public input format for the Shadow ZK circuit verifier.

## Overview

The Shadow circuit uses 120 field elements as public inputs. Each element is a `uint256` value representing either a single field element or one byte of a multi-byte value.

## Layout

| Index | Field | Type | Description |
|-------|-------|------|-------------|
| 0 | blockNumber | uint256 | L1 block number (single field element) |
| 1-32 | stateRoot | bytes32 | L1 state root (32 bytes, big-endian) |
| 33 | chainId | uint256 | Chain ID (single field element) |
| 34 | noteIndex | uint256 | Index of note being claimed (single field element) |
| 35 | amount | uint256 | Amount being claimed in wei (single field element) |
| 36-55 | recipient | address | Recipient address (20 bytes, big-endian) |
| 56-87 | nullifier | bytes32 | Computed nullifier (32 bytes, big-endian) |
| 88-119 | powDigest | bytes32 | PoW digest for verification (32 bytes, big-endian) |

**Total: 120 elements**

## Byte Encoding

Multi-byte values (`bytes32`, `address`) are encoded as individual bytes in **big-endian** order (most significant byte first). Each byte is stored as a separate field element in the range [0, 255].

### bytes32 Encoding

For a `bytes32` value `v`, the encoding at offset `o` is:
```
inputs[o + 0] = uint256(uint8(v[0]))   // MSB
inputs[o + 1] = uint256(uint8(v[1]))
...
inputs[o + 31] = uint256(uint8(v[31])) // LSB
```

### address Encoding

For an `address` value `a`, the encoding at offset `o` is:
```
inputs[o + 0] = uint256(uint8(bytes20(a)[0]))   // MSB
inputs[o + 1] = uint256(uint8(bytes20(a)[1]))
...
inputs[o + 19] = uint256(uint8(bytes20(a)[19])) // LSB
```

## PoW Validation

The PoW digest must have its trailing 24 bits (lowest 3 bytes) equal to zero:
```
sha256(MAGIC_POW || secret) mod 2^24 == 0
```

In the encoded form, this means `powDigest[29]`, `powDigest[30]`, and `powDigest[31]` (indices 117, 118, 119 in the public inputs array) must all be zero.

The Solidity validation uses:
```solidity
(uint256(powDigest) & 0xFFFFFF) == 0
```

## Example Serialization

Given:
- blockNumber: 100
- stateRoot: 0xabc...def (32 bytes)
- chainId: 1
- noteIndex: 0
- amount: 1000000000000000000 (1 ETH)
- recipient: 0xBEEF...0000 (20 bytes)
- nullifier: 0x123...789 (32 bytes)
- powDigest: 0xfff...000 (32 bytes, ending in 3 zero bytes)

The serialized array would be:
```
[0]:   100                    // blockNumber
[1]:   0xab                   // stateRoot[0] (MSB)
[2]:   0xc...                 // stateRoot[1]
...
[32]:  0xef                   // stateRoot[31] (LSB)
[33]:  1                      // chainId
[34]:  0                      // noteIndex
[35]:  1000000000000000000    // amount
[36]:  0xBE                   // recipient[0] (MSB)
[37]:  0xEF                   // recipient[1]
...
[55]:  0x00                   // recipient[19] (LSB)
[56]:  0x12                   // nullifier[0] (MSB)
...
[87]:  0x89                   // nullifier[31] (LSB)
[88]:  0xff                   // powDigest[0] (MSB)
...
[117]: 0x00                   // powDigest[29] - must be 0
[118]: 0x00                   // powDigest[30] - must be 0
[119]: 0x00                   // powDigest[31] - must be 0
```

## Circuit Correspondence

The proof program defines public signals in the same order:
```text
signal input blockNumber;           // Index 0
signal input stateRoot[32];         // Index 1-32
signal input chainId;               // Index 33
signal input noteIndex;             // Index 34
signal input amount;                // Index 35
signal input recipient[20];         // Index 36-55
signal output nullifier[32];        // Index 56-87
signal output powDigest[32];        // Index 88-119
```

Note: `nullifier` and `powDigest` are circuit outputs that become part of the public inputs for verification.
