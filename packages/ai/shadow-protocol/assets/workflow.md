# Shadow Protocol Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SHADOW PROTOCOL FLOW                         │
└─────────────────────────────────────────────────────────────────────┘

  DEPOSITOR (off-chain)              L1 ETHEREUM            TAIKO L2
  ─────────────────────              ───────────            ────────

  1. Create deposit file
     mine-deposit.mjs
     → secret (random 32 bytes)
     → notes[]: {recipient, amount}
     → targetAddress (derived)
          │
          │ 2. Fund targetAddress
          └──────────────────────► ETH transfer
                                   to targetAddress
                                        │
                                        │ (L1 state root checkpointed on L2)
                                        ▼
  3. Prove (off-chain)
     shadowcli.mjs prove
     ← eth_getBlockByNumber    ◄─────────────────
     ← eth_getProof            ◄─────────────────
     → runs RISC Zero circuit
     → note-N.proof.json
          │
          │ 4. Claim
          └───────────────────────────────────────► Shadow.claim(proof, input)
                                                    ├ verifies ZK proof
                                                    ├ checks nullifier unused
                                                    ├ marks nullifier consumed
                                                    └ mints ETH to recipient
```

## Key Privacy Property

The depositor (who funds targetAddress) and the claimer (who submits the proof)
can be different parties using different keys, breaking the on-chain link between
sender and receiver.

## Fee Structure

- Protocol fee: 0.1% of claim amount
- Fee recipient: immutable address set at deployment
- Net claim: `amount - floor(amount / 1000)`

## Contract Addresses (Hoodi Testnet)

| Contract | Address |
|----------|---------|
| Shadow | `0xCd45084D91bC488239184EEF39dd20bCb710e7C2` |
| CheckpointStore | `0x1670130000000000000000000000000000010001` (Taiko anchor) |
