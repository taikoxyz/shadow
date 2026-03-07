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
| Shadow (implementation) | `0xcB5A4069a869c7c5F5d01658e65C8Ee0b949bcA7` | [View](https://hoodi.taikoscan.io/address/0xcB5A4069a869c7c5F5d01658e65C8Ee0b949bcA7) |
| ShadowVerifier | `0x91aa12Ba1A1c5AD3D7215ad0ac075c0b86e1C75B` | [View](https://hoodi.taikoscan.io/address/0x91aa12Ba1A1c5AD3D7215ad0ac075c0b86e1C75B) |
| Risc0CircuitVerifier | `0xDA3D906d59C5969062E5811b18B69798934D12B6` | [View](https://hoodi.taikoscan.io/address/0xDA3D906d59C5969062E5811b18B69798934D12B6) |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [View](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4) |

### ERC20 Test Token

| Contract | Address | Explorer |
|----------|---------|----------|
| TestShadowToken (TST) | `0x25a8012b7A97a00Bed854B960D9335d010fAc6a3` | [View](https://hoodi.taikoscan.io/address/0x25a8012b7A97a00Bed854B960D9335d010fAc6a3) |

- **Name:** Test Shadow Token
- **Symbol:** TST
- **Decimals:** 18
- **Max Shadow Mint:** 100 TST per claim
- **Balance Slot:** 0 (plain OpenZeppelin ERC20 layout)
- **Initial Supply:** 100,000,000 TST minted to deployer (`0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb`)

Any ERC20 token that implements `IShadowCompatibleToken` can be used with Shadow.
See `packages/contracts/src/iface/IShadowCompatibleToken.sol` for the interface and
`packages/contracts/src/impl/ShadowCompatibleERC20.sol` for a reference implementation.

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Image ID | `0xaf4308af319ff3e33d9b28eeca70b77a970c175b1563af52eaee3d41a04b217a` |
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
