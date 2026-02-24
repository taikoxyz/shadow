# Deployments

## Taiko Mainnet

*Not yet deployed.*

---

## Taiko Hoodi (Testnet)

**Chain ID:** 167013
**Date:** February 24, 2026

### Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` | [View](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) |
| Shadow (implementation) | `0xB86Ee0cEA6841e7239F9C14F49688e37D2032DcB` | [View](https://hoodi.taikoscan.io/address/0xB86Ee0cEA6841e7239F9C14F49688e37D2032DcB) |
| ShadowVerifier | `0xF487a0541E39b19669cC6DD151F83B230b9984dC` | [View](https://hoodi.taikoscan.io/address/0xF487a0541E39b19669cC6DD151F83B230b9984dC) |
| Risc0CircuitVerifier | `0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92` | [View](https://hoodi.taikoscan.io/address/0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0xd598228081d1cbc4817e7be03aad1a2fdf6f1bb26b75dae0cddf5e597bfec091` |

### Docker Image

```
ghcr.io/taikoxyz/taiko-shadow:dev
```

The Docker image generates proofs compatible with the deployed Image ID.
