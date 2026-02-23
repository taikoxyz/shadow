# Shadow — Privacy & Data Exposure

This document describes what Shadow does and does not keep private on Taiko.

Shadow is **not a mixer**. It does not provide a large anonymity set, and it does not hide recipients or claim amounts.

## What Shadow Hides (By Design)

- The **secret** in the deposit file is never published on-chain.
- The **full note set** (all recipients/amounts) is not published at deposit time.
- Deposits are normal ETH transfers to a derived address (no deposit contract and no deposit event).

## What Becomes Public

### Funding

Funding the derived `targetAddress` is a standard ETH transfer. Like any ETH transfer, observers can see:

- sender address
- `targetAddress`
- amount
- timestamp / block number

There is no protocol-level way to hide this on a public blockchain.

### Claim

Claims are public transactions. Observers can see:

- `recipient` and `amount` (also emitted in events)
- `blockNumber` (the L1 checkpoint used)
- `nullifier` (and when it is consumed)
- transaction sender (may be different from `recipient`)

In the current implementation, the claim proof payload also includes a **RISC Zero journal** that is sent on-chain and therefore public. This journal contains a packed copy of the claim inputs:

- `blockNumber`
- `blockHash`
- `chainId`
- `recipient`
- `amount`
- `nullifier`

The journal is used only to bind the proof to the already-public claim inputs and does **not** include:

- `targetAddress`
- total note-set sum (e.g. `totalAmount`)

## Linkability & Privacy Limitations

### Deposit-to-Claim Link

Shadow does not publish `targetAddress` as part of a claim. This reduces passive linkability between a funding address and a claim for third-party observers who do not already know the deposit address.

### Linking Multiple Claims From the Same Note Set

Shadow does not publish a per-deposit constant (for example `powDigest`) as a circuit output, so multiple claims from the same note set are not trivially linkable via the proof journal alone. Claims can still be correlated via public `recipient`/`amount` reuse and timing.

### Recipient/Amount Are Not Private

Each claim publicly reveals the note's `recipient` and `amount` in calldata and events. The contract applies a 0.1% claim fee (sent to a fixed `feeRecipient`), so the net amount minted to `recipient` is `amount - (amount / 1000)`.

### Timing Analysis

Even if you avoid reusing addresses, observers can correlate deposits and claims by timing (for example, claiming soon after funding).

### Secret Reuse Is Unsafe

Reusing the same `secret` across multiple deposit files is strongly discouraged because `nullifier` does not include the note set, so it can create nullifier collisions across deposits (claims may fail or be blocked).

## Operational Guidance (Non-Technical)

- Use a fresh funding account for deposits if you want to avoid linking the deposit to your identity or other on-chain activity.
- Separate deposit and claim in time if timing correlation is a concern.
- Consider using a relayer to submit the claim so the transaction sender is not the same as the recipient (recipient is still public).
- Treat the deposit file like a private key: do not upload it to third-party storage or share it.

## Legal / Compliance Notice

Shadow provides privacy features but does not guarantee anonymity. Users are responsible for complying with applicable laws and regulations in their jurisdiction. This document is not legal advice.