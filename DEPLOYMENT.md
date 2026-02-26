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
| Shadow (implementation) | `0xB0E0d26a304b00007e05a8694700Fa1D854D86Ab` | [View](https://hoodi.taikoscan.io/address/0xB0E0d26a304b00007e05a8694700Fa1D854D86Ab) |
| ShadowVerifier | `0x1c71DFbcD55e29844b48D744CD9ee47370111cC4` | [View](https://hoodi.taikoscan.io/address/0x1c71DFbcD55e29844b48D744CD9ee47370111cC4) |
| Risc0CircuitVerifier | `0xF28B5F2850eb776058566A2945589A6A1Fa98e28` | [View](https://hoodi.taikoscan.io/address/0xF28B5F2850eb776058566A2945589A6A1Fa98e28) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x90c445f6632e0b603305712aacf0ac4910a801b2c1aa73749d12c08319d96844` |

### Docker Image

```
ghcr.io/taikoxyz/taiko-shadow:dev
```

The Docker image generates proofs compatible with the deployed Image ID.
