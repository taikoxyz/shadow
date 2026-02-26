# Proof File Schema (v2)

A proof file is produced by `shadowcli.mjs prove` for each note. It contains all data needed to submit an on-chain claim.

## File Naming Convention

By default, proof files are placed next to the deposit file:
```
deposits/
├── my-deposit.json
├── note-0.proof.json
├── note-1.proof.json
└── ...
```

## JSON Structure

```json
{
  "version": "v2",
  "depositFile": "relative/path/to/deposit.json",
  "blockNumber": "<decimal string>",
  "blockHash": "0x<64 hex>",
  "chainId": "<decimal string>",
  "noteIndex": "<decimal string>",
  "amount": "<decimal wei string>",
  "recipient": "0x<40 hex>",
  "nullifier": "0x<64 hex>",
  "publicInputs": ["<uint256 decimal string>", ...],
  "risc0": {
    "proof": "0x<hex ABI-encoded (seal, journal)>",
    "receipt": "<base64 RISC Zero receipt>"
  }
}
```

## Field Reference

| Field | Description |
|-------|-------------|
| `version` | Always `"v2"` |
| `depositFile` | Relative path to the source deposit file |
| `blockNumber` | L1 block number used as the proof anchor |
| `blockHash` | keccak256 of the L1 block header at `blockNumber` |
| `chainId` | Must match `deposit.chainId` |
| `noteIndex` | Which note (0-indexed) this proof covers |
| `amount` | Claim amount in wei (note amount minus fee is minted to recipient) |
| `recipient` | Recipient address from the note |
| `nullifier` | 32-byte nullifier; consumed on-chain to prevent replay |
| `publicInputs` | Array of 87 uint256 values (used by on-chain verifier) |
| `risc0.proof` | ABI-encoded `(bytes seal, bytes journal)` for the Shadow contract |
| `risc0.receipt` | Base64-encoded RISC Zero receipt (for off-chain verification) |

## Public Inputs Layout

The `publicInputs` array has 87 elements at fixed indices:

| Index | Field |
|-------|-------|
| 0 | `blockNumber` |
| 1–32 | `blockHash` (32 bytes as individual uint256) |
| 33 | `chainId` |
| 34 | `amount` |
| 35–54 | `recipient` (20 bytes padded to 32 uint256s) |
| 55–86 | `nullifier` (32 bytes as individual uint256s) |

## On-Chain Claim Input

The `Shadow.claim(proof, input)` call uses:

```solidity
struct PublicInput {
    uint48 blockNumber;
    uint256 chainId;
    uint256 amount;
    address recipient;
    bytes32 nullifier;
}
```

The `stateRoot` is NOT passed as calldata — it is fetched on-chain from `ICheckpointStore`.

## Checking if a Note is Already Claimed

```bash
# Using shadowcli (checks nullifier before claiming)
node packages/risc0-prover/scripts/shadowcli.mjs claim \
  --proof note-0.proof.json \
  --private-key $KEY

# Or using cast directly
cast call <SHADOW_CONTRACT> \
  "isConsumed(bytes32)(bool)" \
  <nullifier_hex> \
  --rpc-url https://rpc.hoodi.taiko.xyz
```
