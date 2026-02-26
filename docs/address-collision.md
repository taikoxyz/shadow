# Address Collision: Ethereum vs Shadow

**Question**: Do two different deposits in Shadow risk producing the same target address? Is that the same risk as two Ethereum private keys producing the same address? And is the ~2^80 birthday bound truly identical for both?

---

## TL;DR

**Shadow is slightly weaker than Ethereum in practice, but it doesn't matter — and where it counts, Shadow is actually stronger.**

- **Math**: Same ~2^80 birthday bound for both (determined by 160-bit output space, not the hash function).
- **Practice**: SHA-256 is ~100–500× faster than secp256k1, so Shadow addresses can be generated more quickly per second. Ethereum's secp256k1 step makes brute-force more expensive.
- **Why it doesn't matter**: Both are stopped by storage before compute. A birthday attack requires ~24 yottabytes — ~200× all digital data ever created.
- **Where Shadow is stronger**: An Ethereum address collision gives full spending power (you have the private key). A Shadow target address collision gives nothing — the ZK proof requires the `secret`, not the address.

---

## Derivation Pipelines

### Ethereum

```
private_key (256-bit scalar k ∈ [1, n-1])
    │
    ▼  secp256k1 scalar multiplication
public_key (x ∥ y, 64 bytes, point on curve)
    │
    ▼  keccak256
256-bit hash
    │
    ▼  last 20 bytes
address (160 bits)
```

### Shadow

```
secret (32 random bytes)
chain_id (u64, padded to 32 bytes)
notes_hash (SHA-256 of note set, 32 bytes)
    │
    ▼  SHA-256
SHA-256("shadow.address.v1" ∥ chain_id ∥ secret ∥ notes_hash)
    │
    ▼  last 20 bytes (hash[12:32])
targetAddress (160 bits)
```

Both pipelines terminate in: take the last 20 bytes of a cryptographic hash over a large input. That shared terminal structure is why the birthday bound is the same.

---

## The Birthday Bound

### Why ~2^80 for both

The birthday bound for finding any two inputs that produce the same output depends on the **output space**, not the input space or intermediate steps:

```
P(collision after n attempts) ≈ 1 - e^(-n² / 2·|output_space|)

For P ≈ 0.5:
    n ≈ 1.17 · sqrt(|output_space|)
    n ≈ 1.17 · sqrt(2^160)
    n ≈ 1.17 · 2^80
    n ≈ 2^80.2
```

For this formula to hold, the only requirement is that the output distribution is computationally indistinguishable from uniform. Both keccak256 (Ethereum) and SHA-256 (Shadow) satisfy this — they are modeled as random oracles. No known distinguisher exists for either.

This is why the birthday bound is the same for both: both produce 160-bit outputs that appear uniformly random.

### Why the user's intuition is understandable

The intuition "secp256k1 should make it harder" conflates two distinct security problems:

| Problem | secp256k1 effect |
|---|---|
| **Birthday collision** (any two inputs → same output) | ✗ No effect on bound |
| **Preimage** (find input for a specific output) | ✓ Adds a second one-way layer |

secp256k1 adds security against finding the *private key* for a *known address*, but it does not change how many addresses you have to generate before two of them collide. The collision bound is a property of the output space alone.

---

## Where secp256k1 Actually Does Add Security

### 1. Per-attempt computation cost

Generating one address:

| System | Operations | Approximate cost |
|---|---|---|
| Ethereum | 1× secp256k1 scalar mult + 1× keccak256 | ~10–50 µs (CPU) |
| Shadow | 1× SHA-256 (128-byte input) | ~100 ns (CPU) |

Ethereum address generation is roughly **100–500× more expensive per attempt** than Shadow. The mathematical bound of ~2^80 is the same, but the wall-clock time per attempt differs significantly.

For a birthday attack with specialized hardware:
- SHA-256: Bitcoin ASICs currently compute ~600 EH/s ≈ 6×10^20 hashes/second globally
- secp256k1: No equivalent ASIC exists; GPU clusters achieve ~10^9 keys/second

At these rates:

```
Birthday attempts needed: ~2^80 ≈ 1.2×10^24

Shadow birthday attack (all Bitcoin ASICs redirected):
    1.2×10^24 / 6×10^20 ≈ 2,000 seconds ≈ 33 minutes (computation only)

Ethereum birthday attack (all secp256k1 GPUs, ~10^9/s):
    1.2×10^24 / 10^9 ≈ 1.2×10^15 seconds ≈ 38 million years
```

The computation cost difference is enormous in practice, even though the mathematical bound is the same.

### 2. Storage infeasibility (the real blocker for both)

A birthday attack requires storing intermediate results to detect duplicates. Storing 2^80 addresses at 20 bytes each:

```
2^80 × 20 bytes ≈ 2.4×10^25 bytes = 24 yottabytes
```

Total digital data ever created (2025 estimate): ~120 zettabytes = 1.2×10^23 bytes.

**The required storage is ~200× all digital data ever created.** This makes a full birthday attack physically infeasible for both systems regardless of hash speed. Parallel birthday algorithms (Floyd's cycle, Pollard's rho) reduce storage but don't eliminate it — and they still require ~2^80 hash evaluations.

### 3. Two-layer preimage security (Ethereum only)

For targeted attacks on Ethereum (find the private key for a specific address):

```
address → public_key: requires inverting keccak256
                       → full preimage: ~2^256
                       → partial (160-bit constraint): ~2^160

public_key → private_key: requires solving EC discrete log
                           → Pollard's rho on secp256k1: ~2^128
```

The effective attack: brute force private keys until one produces the target address (~2^160 operations). This *does* yield the private key, enabling theft.

For Shadow (find a secret for a specific target address):

```
Brute force secrets until SHA-256(magic ∥ chain_id ∥ secret ∥ notes_hash)[-20:] = target
→ ~2^160 operations
```

The structures are similar in operation count, but the secp256k1 constraint means that breaking an Ethereum address also implicitly solves the discrete log problem, making the private key available. In Shadow, finding a secret that maps to a target address only gives you a new deposit — not access to the victim's deposit (see below).

---

## What a Collision Actually Grants

This is the most important divergence between the two systems.

### Ethereum: collision = full spending power

If you find private keys k₁ ≠ k₂ such that addr(k₁) = addr(k₂) = A:
- Any funds at address A can be spent by whoever holds k₁ or k₂
- The collision directly translates to theft

### Shadow: collision = nothing useful

If you find (secret₁, notes_hash₁) ≠ (secret₂, notes_hash₂) such that both derive to the same targetAddress:

The contract (`Shadow.sol`) **never receives or verifies the target address**. It only verifies:
- The ZK proof (which checks that you know a secret deriving to an address with sufficient balance)
- That the nullifier has not been consumed

Each claim's nullifier is derived as:
```
nullifier = SHA-256("shadow.nullifier.v1" ∥ chain_id ∥ secret ∥ note_index)
```

Because `secret` is part of the nullifier, two different secrets produce different nullifiers even for the same note_index. So:

- Depositor 1 (secret₁) has nullifiers: `SHA-256(magic ∥ chain ∥ secret₁ ∥ 0)`, `SHA-256(magic ∥ chain ∥ secret₁ ∥ 1)`, ...
- Depositor 2 (secret₂) has nullifiers: `SHA-256(magic ∥ chain ∥ secret₂ ∥ 0)`, `SHA-256(magic ∥ chain ∥ secret₂ ∥ 1)`, ...

These are entirely disjoint. A collision on the target address does not grant access to the other depositor's funds. The `secret` is the actual credential — the target address is just a staging location for ETH.

---

## The "Existing Tools" Question

The question of whether "existing tools can generate two identical addresses with different private keys" applies to Ethereum but not Shadow.

**Ethereum vanity address tools** (profanity, cast wallet vanity) brute-force secp256k1 to find a prefix match, not a full collision. Finding a 4-hex-char prefix requires ~2^16 operations. Full address collision requires ~2^80.

**Shadow has no private key concept.** The target address is not an Ethereum account controlled by any private key — it is an address derived purely from a ZK secret and a note commitment. Even if you could generate an Ethereum private key whose corresponding address equals a Shadow target address (which is a second-preimage attack, ~2^160), that key would be useless: the ZK proof requires knowledge of the Shadow `secret`, not any Ethereum ECDSA key. The claim pipeline never touches ECDSA.

---

## Comparison Summary

| Property | Ethereum | Shadow |
|---|---|---|
| Address derivation | secp256k1(k) → keccak256[-20:] | SHA-256(magic ∥ chain ∥ secret ∥ notes_hash)[-20:] |
| Output space | 160 bits | 160 bits |
| Birthday bound (math) | ~2^80 | ~2^80 |
| Per-attempt cost | ~10–50 µs (secp256k1 + keccak256) | ~100 ns (SHA-256 only) |
| Practical birthday cost | ~38 million years (GPU) | ~33 min (all Bitcoin ASICs) |
| Storage required for birthday attack | 24 yottabytes | 24 yottabytes |
| Targeted attack bound | ~2^160 (brute force over keys) | ~2^160 (brute force over secrets) |
| Collision grants theft? | Yes — private key enables spending | No — secret still required for ZK proof |
| Second one-way layer | Yes (EC discrete log, ~2^128) | No |
| Vanity-address tools applicable? | Yes (prefix matching) | No (no private key concept) |

---

## Conclusions

1. **The ~2^80 birthday bound is mathematically identical for both.** It is determined by the 160-bit output space and the random-oracle behavior of the final hash, not by any intermediate step.

2. **The user's intuition has practical merit but not mathematical merit.** secp256k1 makes each address-generation attempt ~100–500× more expensive, making a practical birthday attack vastly harder in wall-clock time — but the mathematical collision probability per attempt is the same.

3. **The storage requirement makes both infeasible at 2^80.** Regardless of compute speed, storing 2^80 addresses requires ~200× all digital data ever created. Both systems are safe from birthday attacks for the same reason.

4. **secp256k1 adds a second preimage-security layer that SHA-256 alone does not provide.** For targeted attacks, Ethereum's pipeline requires breaking both keccak256 and secp256k1; Shadow only requires a SHA-256 partial preimage. In absolute terms, SHA-256 partial preimage (~2^160) and secp256k1 brute force (~2^160 over keys) are the same bound, but Ethereum's secp256k1 means that partial success (finding the public key) still leaves the EC discrete log unsolved.

5. **Shadow's collision risk is not the same as Ethereum's private key collision risk** — the consequences are completely different. An Ethereum private key collision gives full spending power. A Shadow target address collision gives nothing because the ZK proof requires the original secret, which is independent of the address.

6. **The 8 ETH per-deposit cap in Shadow.sol is the protocol-level acknowledgment of the 2^80 bound.** It is the economic backstop: even if the storage problem were solved and 2^80 SHA-256 hashes were computed, the maximum extractable value from a single successful collision is bounded.

7. **Verdict**: Shadow is not as secure as Ethereum in raw compute cost per birthday attempt (SHA-256 is faster than secp256k1). Both are equally infeasible due to storage. Shadow is more secure in consequence — a collision does not enable theft.
