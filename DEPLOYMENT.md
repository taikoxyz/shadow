# Deployments

## Taiko Mainnet

*Not yet deployed.*

---

## Taiko Hoodi (Testnet)

**Chain ID:** 167013
**Date:** March 3, 2026

### Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` | [View](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) |
| Shadow (implementation) | `0x169d131Be58972c46Eb2009306b58f2867105Aa8` | [View](https://hoodi.taikoscan.io/address/0x169d131Be58972c46Eb2009306b58f2867105Aa8) |
| ShadowVerifier | `0xBbb3a162B14133042dC3cf5A4051b2bd96e76812` | [View](https://hoodi.taikoscan.io/address/0xBbb3a162B14133042dC3cf5A4051b2bd96e76812) |
| Risc0CircuitVerifier | `0x04a05507005C67c87e4dB4f0361F770FB49d9A10` | [View](https://hoodi.taikoscan.io/address/0x04a05507005C67c87e4dB4f0361F770FB49d9A10) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x249b9db744d4f4f9e1908f89367ebc45524ce4dd6794c97f8030ec5d7075fd90` |
| Max Claim Amount | `8 ETH` |

### Docker Image

```
ghcr.io/taikoxyz/taiko-shadow:dev
```

The Docker image generates proofs compatible with the deployed Image ID. Rebuild required after
any circuit changes that produce a new image ID.

---

## Trust Assumptions

### Groth16 Trusted Setup

The `Risc0CircuitVerifier` contract delegates final proof verification to the RISC Zero Groth16 verifier (`RiscZeroGroth16Verifier`). This verifier uses a Groth16 proof system that requires a one-time trusted setup ceremony. If the ceremony's toxic waste was retained or compromised by any participant, an attacker could forge proofs that pass on-chain verification without satisfying the circuit constraints. Shadow relies on RISC Zero's publicly conducted ceremony. See: https://www.risczero.com/blog/ceremony.

Operators and integrators should be aware of this assumption when evaluating the security guarantees of any Shadow deployment.
