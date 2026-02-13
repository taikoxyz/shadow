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

- `Deposit`: create a `v1` DEPOSIT file (current schema) with multiple recipient notes and download it as:
  - `deposit-[first4]-[last4]-timestamp.json`
  - secret is auto-generated on click and mined until PoW-valid; it is never shown in the UI
  - chain id is fixed to Hoodi (`167013`) in the Deposit flow
  - after `Generate Deposit File`, the form is locked and a summary is shown (`target address`, `total amount`, `file path`), followed by a `Deposit Ether` action that sends the exact total amount
  - once send tx is submitted, a tx link + status indicator is shown until confirmation
- `Prove`: drop a DEPOSIT file, check target (unspendable) address balance on RPC, list one selectable unclaimed note, and generate the terminal command for local proof generation with proof file name:
  - `deposit-[first4]-[last4]-timestamp-[note-index].proof.json`
- `Claim`: drop a proof file, connect wallet, and submit `claim(bytes, PublicInput)` tx to the Shadow contract.
- `Web3`: global wallet connect is available in the header; if connected to a non-Hoodi chain, a `Switch to Hoodi (167013)` button is shown.
- default Shadow contract address used in Prove/Claim: `0x30AEf68b8A1784C5C553be9391b6c7cbd1f76ba3`
