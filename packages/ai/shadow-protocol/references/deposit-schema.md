# Deposit File Schema (v2)

The deposit file is the user's secret material. It must be kept private and backed up.

## JSON Structure

```json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0x<64 hex chars — 32 random bytes>",
  "notes": [
    {
      "recipient": "0x<40 hex chars — 20-byte address>",
      "amount": "<positive integer string, in wei>",
      "label": "optional human label (max 64 chars)"
    }
  ],
  "targetAddress": "0x<40 hex chars>"
}
```

## Field Constraints

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `version` | string | yes | Must be `"v2"` |
| `chainId` | string | yes | Decimal integer string, e.g. `"167013"` |
| `secret` | string | yes | `0x` + 64 hex characters (32 bytes) |
| `notes` | array | yes | 1–5 items |
| `notes[].recipient` | string | yes | `0x` + 40 hex characters (EIP-55 or lowercase) |
| `notes[].amount` | string | yes | Positive decimal integer string (wei), no leading zeros |
| `notes[].label` | string | no | Max 64 characters (excluded from ZK derivation) |
| `targetAddress` | string | no | `0x` + 40 hex characters; if present, CLI validates it matches derivation |

## Protocol Constraints

- Notes: 1–5 per deposit file
- Total amount: sum of all note amounts must be ≤ 8 ETH (8,000,000,000,000,000,000 wei)
- Each note amount must be > 0

## Target Address Derivation

```
notesHash     = SHA256(amounts[0..4 padded] || recipientHashes[0..4 padded])
recipientHash = SHA256("shadow.recipient.v1\0..." || \0\0...\0<address 20 bytes right-padded to 32>)
targetAddress = last20bytes(SHA256("shadow.address.v1\0..." || chainId_bytes32 || secret_bytes32 || notesHash))
```

The target address does not correspond to a known private key. ETH can only leave it via the claim mechanism.

## Nullifier Derivation (per note)

```
nullifier[i] = SHA256("shadow.nullifier.v1\0..." || chainId_bytes32 || secret_bytes32 || noteIndex_bytes32)
```

Nullifiers are published on-chain when a note is claimed, preventing double-claims.

## Example (Hoodi Testnet)

```json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "notes": [
    {
      "recipient": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      "amount": "500000000000000000",
      "label": "half ETH note"
    }
  ],
  "targetAddress": "0x..."
}
```
