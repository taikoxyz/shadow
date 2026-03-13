# Deployments

## Taiko Mainnet

*Not yet deployed.*

---

## Taiko Hoodi (Testnet)

**Chain ID:** 167013
**Last updated:** March 7, 2026

### Core Contracts

| Contract | Address | Explorer |
|----------|---------|----------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` | [View](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) |
| Shadow (implementation) | `0x18489ec302eAEFA7A7e2Efe4fA6247478cd5510d` | [View](https://hoodi.taikoscan.io/address/0x18489ec302eAEFA7A7e2Efe4fA6247478cd5510d) |
| ShadowVerifier | `0x203535A5c5EF778AECE6D72247e97f0dc342EC33` | [View](https://hoodi.taikoscan.io/address/0x203535A5c5EF778AECE6D72247e97f0dc342EC33) |
| Risc0CircuitVerifier | `0xC85dED07e1C5C29Bc1F4d2261510f4a7A2c920A9` | [View](https://hoodi.taikoscan.io/address/0xC85dED07e1C5C29Bc1F4d2261510f4a7A2c920A9) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### ERC20 Test Token

| Contract | Address | Explorer |
|----------|---------|----------|
| TestShadowToken (TST) | `0x0b44b090c31d69EDDE0a6De2066885dc4FaB08C9` | [View](https://hoodi.taikoscan.io/address/0x0b44b090c31d69EDDE0a6De2066885dc4FaB08C9) |

- **Name:** Test Shadow Token
- **Symbol:** TST
- **Decimals:** 18
- **Max Shadow Mint:** 100 ETH (in TST units) per claim
- **Balance Slot:** 0 (plain OpenZeppelin ERC20 layout)
- **shadowMint behaviour:** writes balance directly without changing `totalSupply`

Any ERC20 token that implements `IShadowCompatibleToken` can be used with Shadow.
See `packages/contracts/src/iface/IShadowCompatibleToken.sol` for the interface and
`packages/contracts/src/impl/ShadowCompatibleERC20.sol` for a reference implementation.

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0x7c0fdf9a31385943c3b5d62a4cafb20a8f797a649341b11d4bc16e360ecf3a99` |
| Max ETH Claim Amount | `8 ETH` |

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
