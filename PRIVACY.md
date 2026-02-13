# Shadow — Privacy & Data Exposure

This document describes what Shadow does and does not keep private on Taiko Hoodi.

Shadow is **not a mixer**. It does not provide a large anonymity set, and it does not hide recipients or claim amounts.

## What Shadow Hides (By Design)

- The **secret** in the deposit file is never published on-chain.
- The **full note set** (all recipients/amounts) is not published at deposit time.
- Deposits are normal ETH transfers to a derived address (no deposit contract and no deposit event).

## What Becomes Public

### L1 Funding (Hoodi L1)

Funding the derived `targetAddress` is a standard ETH transfer. Like any ETH transfer, observers can see:

- sender address
- `targetAddress`
- amount
- timestamp / block number

There is no protocol-level way to hide this on a public blockchain.

### L2 Claim (Hoodi L2)

Claims are public transactions. Observers can see:

- `recipient` and `amount` (also emitted in events)
- `noteIndex`
- `blockNumber` and `stateRoot` (the L1 checkpoint used)
- `nullifier` (and when it is consumed)
- transaction sender (may be different from `recipient`)

In the current implementation, the claim proof payload also includes a **RISC Zero journal** that is sent on-chain and therefore public. This journal contains additional fields including:

- `targetAddress` (the derived/funded address on L1)
- `totalAmount` (sum of all note amounts in the note set)
- commitments (e.g. `notesHash`, proof commitment)

## Linkability & Privacy Limitations

### Deposit-to-Claim Link (After a Claim)

Because the claim publishes `targetAddress` (via the proof journal), an observer can link:

1. the L2 claim
2. to the L1 funding history of that `targetAddress`

This can reveal funding source patterns and timing once a claim occurs.

### Linking Multiple Claims From the Same Note Set

Claims from the same deposit file/note set are linkable (for example via the published `targetAddress` and/or note-set commitments).

### Recipient/Amount Are Not Private

Each claim mints ETH to the note’s `recipient` for the note’s `amount`. Both are public in calldata and events.

### Timing Analysis

Even if you avoid reusing addresses, observers can correlate deposits and claims by timing (for example, claiming soon after funding).

### Secret Reuse Is Unsafe

Reusing the same `secret` across multiple deposit files is strongly discouraged:

- it reduces privacy (correlations via derived values)
- it can create nullifier collisions (claims may fail or be blocked)

## Operational Guidance (Non-Technical)

- Use a fresh funding account for L1 deposits if you want to avoid linking the deposit to your identity or other on-chain activity.
- Separate deposit and claim in time if timing correlation is a concern.
- Consider using a relayer to submit the L2 claim so the transaction sender is not the same as the recipient (recipient is still public).
- Treat the deposit file like a private key: do not upload it to third-party storage or share it.

## Legal / Compliance Notice

Shadow provides privacy features but does not guarantee anonymity. Users are responsible for complying with applicable laws and regulations in their jurisdiction. This document is not legal advice.

