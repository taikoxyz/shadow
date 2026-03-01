# Deployments

## Taiko Mainnet

*Not yet deployed.*

---

## Taiko Hoodi (Testnet)

**Chain ID:** 167013
**Date:** February 28, 2026

### Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` | [View](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) |
| Shadow (implementation) | `0x4869592261658752A06DbE291A735884132a51d3` | [View](https://hoodi.taikoscan.io/address/0x4869592261658752A06DbE291A735884132a51d3) |
| ShadowVerifier | `0x2A24265cA599A4a228647AdE0a26dA7dCc83354a` | [View](https://hoodi.taikoscan.io/address/0x2A24265cA599A4a228647AdE0a26dA7dCc83354a) |
| Risc0CircuitVerifier | `0x4C216c036777e7106560a05832982BCC42eb9c68` | [View](https://hoodi.taikoscan.io/address/0x4C216c036777e7106560a05832982BCC42eb9c68) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x08a05132ea1bfb9e7adbea32dd5bade4132986e9d23e8871d515f9a6a3e3d121` |

### Docker Image

```
ghcr.io/taikoxyz/taiko-shadow:dev
```

The Docker image generates proofs compatible with the deployed Image ID.
