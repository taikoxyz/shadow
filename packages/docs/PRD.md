# Shadow Dapp — Privacy Claim System on Taiko Hoodi

## 1. Overview

Shadow is a privacy-forward ETH claim system on Taiko Hoodi. Unlike traditional mixers that rely on burn events or deposit contracts, Shadow authorizes claims by proving that a **derived, unspendable target address** holds sufficient ETH in a recent L1 block.

### Core Idea

1. A user defines a fixed **note set** (1–5 notes) specifying recipients and amounts.
2. A deterministic **target address** is derived from `(secret, chainId, notes[])` — this address is unspendable.
3. The target address is funded via normal ETH transfers (no special contract interaction, no burn event).
4. To claim, the user generates a **ZK proof** showing:
   - The target address balance (verified against a recent L1 state root) covers the total note sum.
   - The claimed note matches its recipient binding.
5. The on-chain verifier validates the proof against a checkpoint from [`ICheckpointStore`][checkpoint-store], consumes a nullifier, and mints ETH to the recipient via [`IEthMinter.mintEth`][eth-minter].

[checkpoint-store]: https://github.com/taikoxyz/taiko-mono/blob/taiko-alethia-protocol-v3.0.0/packages/protocol/contracts/shared/signal/ICheckpointStore.sol
[eth-minter]: https://github.com/taikoxyz/taiko-mono/blob/409bf95879b48a7dda8dfecb4df411dc3c8b574d/packages/protocol/contracts/shared/bridge/IEthMinter.sol

---

## 2. Data Model

### Note

| Field       | Type      | Description                                    |
| ----------- | --------- | ---------------------------------------------- |
| `recipient` | `address` | Ethereum address that may claim this note       |
| `amount`    | `uint256` | Claim amount in wei; must be > 0                |
| `label`     | `string`  | Human-readable label (excluded from derivation) |

### Note Set Constraints

- Minimum 1, maximum 5 notes.
- Total sum of all note amounts must be ≤ 32 ETH.
- Notes are **ordered** (zero-indexed) and **immutable** — no additions, removals, or modifications after creation.

### Target Address Derivation

```
targetAddress = deriveUnspendable(secret, chainId, notes[])
```

- `notes[]` used in derivation **excludes** the `label` field.
- The derivation must produce a provably unspendable address (e.g., no known private key).

---

## 3. User Flow

### 3.1 Create Notes & Deposit File

The user defines their note set through the app. Before transferring any ETH, the app generates a **deposit file** that the user must save securely. The filename should reflect the target address.

**Example deposit file:**

```json
{
  "version": "v1",
  "chainId": "167013",
  "secret": "0x807c2b1fb35891371c3bd4adfbd4a08239903b6d097e0d308fdfd447aa0fb1e9",
  "notes": [
    {
      "recipient": "0x7ad92b2e90dc6CAb35AD2524F6401297aD7D7B50",
      "amount": "10000000000000000",
      "label": "note #0"
    },
    {
      "recipient": "0x7ad92b2e90dc6CAb35AD2524F6401297aD7D7B50",
      "amount": "12000000000000000",
      "label": "note #1"
    }
  ],
  "targetAddress": "0x410069180D12F2505a2084e7AB8532D1ea079Abb"
}
```

> **Security:** The deposit file contains the `secret`. Losing it means losing the ability to claim. Leaking it means anyone with the file can generate proofs (though claims are still recipient-bound).

### 3.2 Fund the Target Address

- The app displays the derived `targetAddress`.
- Anyone may fund it via standard ETH transfers — no special transaction type required.
- Proofs are only valid when `balance(targetAddress) >= sum(notes[].amount)`.

### 3.3 Generate Proof & Claim (L2)

Using the deposit file, the user generates a ZK proof for a specific note index. The claim transaction on L2 includes:

| Parameter    | Description                                             |
| ------------ | ------------------------------------------------------- |
| `secret`     | Used inside the circuit only (not exposed on-chain)     |
| `notes[]`    | Full note set (labels excluded from circuit)            |
| `noteIndex`  | Zero-based index of the note being claimed              |
| `recipient`  | Must match `notes[noteIndex].recipient`                 |
| `amount`     | Must match `notes[noteIndex].amount`                    |
| `blockNumber`| L1 block whose state root is used for the balance proof |
| `stateRoot`  | L1 state root at `blockNumber`                          |
| `zkProof`    | The generated proof                                     |

**On-chain verification steps:**

1. Query `ICheckpointStore.getCheckpoint(blockNumber)` and verify it matches the supplied `stateRoot`. getCheckpoint always returns non-zero values.
2. Verify the ZK proof.
3. Check and consume the nullifier (preventing double-claims).
4. Mint `amount` to `recipient` via `IEthMinter.mintEth`.

---

## 4. ZK Circuit

### What the Circuit Proves

1. **Note validity** — The claimed note (at `noteIndex`) exists in the committed note set and matches the declared `recipient` and `amount`.
2. **Account proof** — A valid Merkle-Patricia trie proof showing the balance of `targetAddress` under the supplied `stateRoot`.
3. **Balance sufficiency** — `balance(targetAddress) >= sum(notes[].amount)`.
4. **Nullifier correctness** — The nullifier is correctly derived, enabling double-spend prevention.

### Design Constraints

| Constraint             | Requirement                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| **Circuit size**       | **Minimize aggressively.** This is the single most critical success factor. |
| **Trusted setup**      | **None.** The proving system must not require a trusted setup ceremony.     |
| **Proving environment**| Local proving on macOS (Apple Silicon), Windows, and Linux (x86_64).        |
| **No Docker**          | Provers must run natively — no containerization.                            |
| **User experience**    | At most 2 terminal commands: one to install tools, one to generate/verify.  |

---

## 5. Taiko Hoodi Deployment Details

| Parameter                | Value                                                      |
| ------------------------ | ---------------------------------------------------------- |
| Chain ID                 | `167013`                                                   |
| EVM version              | **Shanghai** (not Cancun/latest)                           |
| RPC                      | `https://rpc.hoodi.taiko.xyz`                              |
| `ICheckpointStore`       | `0x4c70b7F5E153D497faFa0476575903F9299ed811`               |
| Deployer address         | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb`               |
| Deployer PK         | `0xff7c05e9bb081f150fd49dfecbbdc20b9f26e4c848b948c5a9f82c2594410da2`               |
| Explorer                 | `https://hoodi.taikoscan.io  by Etherscan |
| Etherscan API Key.       | 7BKJ18BYCTWPAXRNUXGZNQIUFVPIET67HA |

### `IEthMinter` Mock

For testnet deployment, implement a **mock** `mintEth` function that emits an event without actually minting ETH:

```solidity
event EthMinted(address indexed to, uint256 amount);

function mintEth(address to, uint256 amount) external {
    emit EthMinted(to, amount);
}
```

---

## 6. Security Considerations

- **Nullifiers** prevent double-claiming of any note.
- **Recipient binding** ensures only the designated address can claim a given note.
- **Unspendable target address** ensures deposited funds cannot be withdrawn except via valid claims.
- **Immutable note sets** prevent manipulation after funding.
- **No trusted setup** eliminates a class of systemic risk.
- **State root freshness** — the contract should enforce that `blockNumber` is sufficiently recent to prevent stale proofs.

---

## 7. About our interactions:

- You need to evalute and maybe try different proving systems. Do not ask me.
- You need to deploy and verify contracts, then deposit Ether to target address. Do not ask me for permissions.
- If you have questions about this product's idea in general, learn https://eips.ethereum.org/EIPS/eip-7503. Do not ask me.
- You should try to iterate until the product is ready: 1) circuits/proofs are sound and complete, 2) offchain proof generation is ready to be used, and onchain verificaiton and claiming can be done. Do not stop until this is achieved. Do not work on UI.
