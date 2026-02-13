# Shadow public input layout

`ShadowPublicInputs.toArray()` flattens the public inputs into a `uint256[]`
of length **120**. Each byte of `bytes32` and `address` values is written in
the same order as Solidity's `bytes` indexing (most-significant byte first).

## Layout (v1)

| Field | Offset | Length | Notes |
| --- | --- | --- | --- |
| blockNumber | 0 | 1 | `uint48` stored directly in `inputs[0]`. |
| stateRoot | 1 | 32 | Bytes 0..31 of `bytes32` (MSB → LSB). |
| chainId | 33 | 1 | `uint256` stored directly in `inputs[33]`. |
| noteIndex | 34 | 1 | `uint256` stored directly in `inputs[34]`. |
| amount | 35 | 1 | `uint256` stored directly in `inputs[35]`. |
| recipient | 36 | 20 | Bytes 0..19 of `address` (MSB → LSB). |
| nullifier | 56 | 32 | Bytes 0..31 of `bytes32` (MSB → LSB). |
| powDigest | 88 | 32 | Bytes 0..31 of `bytes32` (MSB → LSB). |

## Notes

- `inputs.length == 120` must hold for verifier calls.
- The byte ordering matches the circuit tooling and `ShadowPublicInputs` tests.
