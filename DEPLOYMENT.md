# Deployments

## Taiko Mainnet

*Not yet deployed.*

---

## Taiko Hoodi (Testnet)

**Chain ID:** 167013
**Date:** February 27, 2026

### Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` | [View](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) |
| Shadow (implementation) | `0xa98866f5427f1592Cf747024eA970bFDf67A2d2A` | [View](https://hoodi.taikoscan.io/address/0xa98866f5427f1592Cf747024eA970bFDf67A2d2A) |
| ShadowVerifier | `0xA3291dF14D09f71151a0a0b2E732DC26be21CDcD` | [View](https://hoodi.taikoscan.io/address/0xA3291dF14D09f71151a0a0b2E732DC26be21CDcD) |
| Risc0CircuitVerifier | `0x9A4D9720E9ec87b7C9E5f5F8Fb1b083B4D6e5b29` | [View](https://hoodi.taikoscan.io/address/0x9A4D9720E9ec87b7C9E5f5F8Fb1b083B4D6e5b29) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0xac4b31fadeb0115a1e6019c8bccc0ddf900fe6e40a447409d9ce6b257913dcbc` |

### Docker Image

```
ghcr.io/taikoxyz/taiko-shadow:dev
```

The Docker image generates proofs compatible with the deployed Image ID.
