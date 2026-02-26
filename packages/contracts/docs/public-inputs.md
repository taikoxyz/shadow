# Shadow public input layout

`ShadowPublicInputs.toArray(IShadow.PublicInput input, bytes32 blockHash)` flattens the
public inputs into a `uint256[]` of length **87**. Each byte of `bytes32` and
`address` values is written in
the same order as Solidity's `bytes` indexing (most-significant byte first).

For the full, normative specification (including the RISC0 journal binding),
see `packages/docs/public-inputs-spec.md`.

## Layout (current)

| Field | Offset | Length | Notes |
| --- | --- | --- | --- |
| blockNumber | 0 | 1 | `uint64` stored directly in `inputs[0]`. |
| blockHash | 1 | 32 | Bytes 0..31 of `bytes32` (MSB → LSB). |
| chainId | 33 | 1 | `uint256` stored directly in `inputs[33]`. |
| amount | 34 | 1 | `uint256` stored directly in `inputs[34]`. |
| recipient | 35 | 20 | Bytes 0..19 of `address` (MSB → LSB). |
| nullifier | 55 | 32 | Bytes 0..31 of `bytes32` (MSB → LSB). |

## Notes

- `inputs.length == 87` must hold for verifier calls.
- `blockHash` is included in the circuit public inputs, but is fetched on-chain from `TaikoAnchor.blockHashes(blockNumber)` — it is not user-provided calldata.
- The byte ordering matches Solidity byte indexing (MSB -> LSB) and is enforced by `ShadowPublicInputs` tests.
