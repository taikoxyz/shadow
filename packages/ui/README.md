# Shadow UI (Minimal)

## Run

```bash
pnpm install
pnpm ui:dev
```

## Build

```bash
pnpm ui:build
```

## What it does

- `Deposit`: create a `v2` DEPOSIT file (current schema) with multiple recipient notes and download it as:
  - `deposit-[first4]-[last4]-timestamp.json`
  - secret is auto-generated on click; it is never shown in the UI
  - deposit file `chainId` is fixed to Hoodi L2 (`167013`) in the Deposit flow
  - note set size is limited to 1..5 notes (protocol maximum)
  - after `Generate Deposit File`, the form is locked and a summary is shown (`target address`, `total amount`, `file path`), followed by a `Deposit Ether (L1)` action that sends the exact total amount on Hoodi L1 (`560048`)
  - once send tx is submitted, a tx status indicator is shown until confirmation
- `Prove`: drop a DEPOSIT file, check target (unspendable) address balance on RPC, list one selectable unclaimed note, and generate the terminal command for local proof generation with proof file name:
  - `deposit-[first4]-[last4]-timestamp-[note-index].proof.json`
- `Claim`: drop a proof file, connect wallet, and submit `claim(bytes, PublicInput)` tx to the Shadow contract.
  - `PublicInput` calldata is `(blockNumber, chainId, amount, recipient, nullifier)`; `stateRoot` is derived on-chain from the checkpoint store using `blockNumber`.
  - Shadow applies a 0.1% claim fee (`amount / 1000`); the UI shows gross, fee, and net amounts when a proof file is loaded.
- `Web3`: global wallet connect is available in the header, with buttons to switch to Hoodi L2 (`167013`) or Hoodi L1 (`560048`).
- Shadow contract address for Prove/Claim must be provided (it is deployment-dependent, especially when the RISC0 guest image ID changes).
