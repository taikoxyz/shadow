# Gasless Claim — Research Notes

## The Core Problem

To submit `Shadow.claim()`, the claimer needs L2 ETH for gas. But the point of claiming is to *receive* ETH for the first time. A fresh address has no gas. This circular dependency breaks Shadow's privacy model: any method the claimer uses to acquire gas (centralized exchange, bridge) creates an on-chain trail that links their L2 wallet to their real identity.

## Shadow's Enabling Property

`Shadow.claim()` never reads `msg.sender`. The `recipient` address is committed inside the ZK proof's public inputs, not supplied by the transaction caller. This means **any address can submit a claim on behalf of the claimer today with zero contract changes**. The minted ETH always goes to the ZK-committed recipient.

## Approach 1: Simple Server-Side Relayer (Recommended for Now)

### How it works

1. Claimer generates their proof and sends it to the Shadow server via a new `POST /api/relay-claim` endpoint.
2. Server validates off-chain: checks nullifier not consumed, optionally calls `ShadowVerifier.verifyProof` as a view call.
3. Server submits `shadow.claim(proof, input)` from a funded relayer EOA.
4. Returns `{ txHash }`. ETH is minted to `_input.recipient` — the relayer is never the recipient.

**Zero new smart contracts. Zero new infrastructure beyond the existing server.**

### Gas cost

Two confirmed live Shadow claim transactions on Hoodi:
- `0x85451f...dcda`: **385,194 gas**
- `0x5e4994...6252`: **385,182 gas**

At Hoodi's ~0.015 gwei gas price: ~0.0000058 ETH per claim. A relayer wallet funded with 0.1 ETH can cover ~17,000 claims.

### Privacy effect

| Before relayer | After relayer |
|---|---|
| `tx.from` = claimer's wallet | `tx.from` = relayer address |
| Claimer needs pre-existing L2 ETH | Claimer needs no L2 ETH |
| `tx.from == recipient` link visible | Sender/recipient link broken |

What it does NOT hide: `recipient` and `amount` are always public (ZK proof public inputs + `Claimed` event). That is a design property of Shadow and unaffected by this change.

### Gas reimbursement options

- Option A: deduct gas cost from claim amount (tiny, negligible at current prices).
- Option B: absorb in the existing 0.1% protocol fee.
- Option C: run at cost as infrastructure (given negligible gas prices on Hoodi).

---

## Approach 2: EIP-4337 Verifying Paymaster (Better Decentralization)

### Infrastructure status on Taiko Hoodi (chainId 167013)

| Contract | Address | Deployed |
|---|---|---|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Yes ✓ |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Yes ✓ |
| Pimlico bundler | — | Not on Hoodi ✗ |
| Any 3rd-party bundler | — | Not on Hoodi ✗ |

Both EntryPoints are live. No third-party bundler serves Hoodi — Shadow would need to run its own.

### Gas budget for a Shadow UserOperation (v0.7)

```
preVerificationGas:               ~50,000   (calldata + EntryPoint overhead)
verificationGasLimit:            ~100,000   (smart account validateUserOp)
paymasterVerificationGasLimit:    ~50,000   (ECDSA sig check only — NOT Groth16)
callGasLimit:                    ~600,000   (Shadow.claim() with 25% buffer)
paymasterPostOpGasLimit:             0      (no postOp needed for pure sponsorship)
─────────────────────────────────────────
Total:                           ~800,000   gas
Hoodi block limit: 46,000,000 — UserOp is ~1.7% of a block, no constraint.
```

The Groth16 verification (~385K gas) runs entirely in the `callGasLimit` phase, not in the paymaster validation phase. The paymaster only runs an ECDSA signature check (~30–40K gas).

### How the Verifying Paymaster would work for Shadow

**Off-chain signer service (runs in the Shadow server):**
1. Receives claim request (proof + public inputs).
2. Validates: nullifier not consumed, chainId correct, amount/recipient non-zero.
3. Simulates the claim execution (`eth_estimateUserOperationGas`).
4. Issues a time-bounded ECDSA signature: `sign(keccak256(sender, nonce, callDataHash, gasFields, chainId, paymaster, validUntil, validAfter))`.
5. Sets `validUntil = now + 5 minutes`.

**On-chain ShadowVerifyingPaymaster:**
- `validatePaymasterUserOp`: recovers signer from ECDSA signature, checks it matches `verifyingSigner` address.
- Returns `SIG_VALIDATION_FAILED` (not a revert) on bad sigs.
- Does NOT re-verify Groth16 on-chain (wrong phase, unnecessary double-checking).
- No `postOp` needed for pure gas sponsorship.

**paymasterAndData layout (v0.7):**
```
[0:20]    paymaster contract address
[20:36]   paymasterVerificationGasLimit = 50000
[36:52]   paymasterPostOpGasLimit = 0
[52:116]  abi.encode(validUntil uint48, validAfter uint48)
[116:181] ECDSA signature (65 bytes)
Total: 181 bytes
```

### What the claimer signs

The claimer needs a smart account (or the Shadow server generates a per-session ephemeral account for them). The `userOpHash` covers the complete UserOp including `keccak256(paymasterAndData)`. The claimer's account calls `Shadow.claim(proof, input)` as its execution calldata.

### Security notes

- Time-bounded sigs (`validUntil`) limit replay window.
- EntryPoint nonce prevents reuse of the same UserOp.
- Paymaster only pays gas, not ETH transfers — deposit drain risk is bounded by claim volume.
- Check `isConsumed` off-chain before signing — don't validate nullifiers inside `validatePaymasterUserOp` (reading external storage requires the paymaster to be staked in the EntryPoint).
- Monitor deposit balance.

### Why not use Approach 2 immediately

Requires deploying `ShadowVerifyingPaymaster.sol`, running a self-hosted bundler, and building UserOp construction into the client. Significant operational overhead for testnet. The simple relayer achieves the same privacy improvement with ~50 lines of Rust in the existing server.

---

## Approach 3: EIP-2771 Meta-Transactions

**Not applicable.** EIP-2771 solves the problem of contracts needing to know the original signer via `_msgSender()`. Shadow's `claim()` never reads `msg.sender`. There is no forwarder infrastructure on Hoodi anyway. A simple relayer strictly dominates this approach.

---

## Approach 4: EIP-3074 / EIP-7702

**Not available on Taiko Hoodi.** Block header inspection confirms Hoodi is pre-Prague (no `requestsHash` field). EIP-7702 requires the Pectra hardfork, which has not been ported to Taiko Hoodi as of February 2026.

---

## Residual Privacy Leaks (After Any Gasless Approach)

All approaches eliminate the `tx.from = claimer` link. What remains:

1. **Recipient address is always public** — committed in ZK proof, emitted in `Claimed` event. This is by design.
2. **Amount is always public** — same reason.
3. **Timing correlation** — claiming shortly after funding the target address is correlatable.
4. **Relayer operator visibility** — if the Shadow server is the only relayer, it sees all proof submissions. It cannot prevent a claim from going through (the proof is self-contained), but it observes IP addresses and timing.
5. **Single relayer = uniform anonymity set** — all claims look like they come from the same address. This is actually better for privacy than a multi-relayer setup with few participants.

---

## Recommendation

**For Hoodi testnet now:** Implement the simple relayer endpoint in the existing server. No contract changes. Matches what `PRIVACY.md` already recommends ("Consider using a relayer to submit the claim").

**For mainnet:** Evaluate EIP-4337 + Verifying Paymaster. By mainnet, third-party bundlers (Pimlico, Alchemy) may serve Taiko mainnet (167000), removing the need to self-operate a bundler. This allows permissionless claim submission without requiring trust in the Shadow server.
