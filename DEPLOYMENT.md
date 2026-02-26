# Deployments

## Taiko Mainnet

*Not yet deployed.*

---

## Taiko Hoodi (Testnet)

**Chain ID:** 167013
**Date:** February 26, 2026

### Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` | [View](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) |
| Shadow (implementation) | `0xea27D218266766ABaE7B24b508b684FfaFf4f8ef` | [View](https://hoodi.taikoscan.io/address/0xea27D218266766ABaE7B24b508b684FfaFf4f8ef) |
| ShadowVerifier | `0x41B15F5Ed8339122231f16eF4f260B08CCB9C726` | [View](https://hoodi.taikoscan.io/address/0x41B15F5Ed8339122231f16eF4f260B08CCB9C726) |
| Risc0CircuitVerifier | `0x6E84a9749B9887C3e80b40a1fBB976888dD1f00D` | [View](https://hoodi.taikoscan.io/address/0x6E84a9749B9887C3e80b40a1fBB976888dD1f00D) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x6ca03c648024c754d607fdb67ed03e60f426b1286e6f2f64141a4841fccd5d7a` |

### Docker Image

```
ghcr.io/taikoxyz/taiko-shadow:dev
```

The Docker image generates proofs compatible with the deployed Image ID.
