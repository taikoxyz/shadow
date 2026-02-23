# Taiko Hoodi Deployment / Proof Execution Report

Date: **February 20, 2026**

---

## 1. Deployment Summary

| Contract | Address | Tx Hash | Explorer |
| --- | --- | --- | --- |
| DummyEtherMinter | `0x721d6483f64A7850E07Ae2C3B3a40e1A291c004C` | `0x8101fa10b7ec8a24cc2a97d2b70d56c0478c1d7408c17f4dab09ce53838de173` | https://hoodi.taikoscan.io/address/0x721d6483f64A7850E07Ae2C3B3a40e1A291c004C |
| Risc0CircuitVerifier | `0xafaa2c933eafEd29C75F9AD4F8F7B506a7F338ec` | `0x44bdf17a8df591ede2901fd71b953a845a4f733b53869c3467deab3cf17b5750` | https://hoodi.taikoscan.io/address/0xafaa2c933eafEd29C75F9AD4F8F7B506a7F338ec |
| ShadowVerifier | `0x3416860D70121D46457528318743250CD350D139` | `0xc50bafa5d49b3ca7dde8cc2125cae8f95dd237015e65312ee68b5563a9450406` | https://hoodi.taikoscan.io/address/0x3416860D70121D46457528318743250CD350D139 |
| Shadow (implementation) | `0xcB0756170e180A07f6cF435254dc7734D4f4aCaF` | `0x903a9f5def3b8841c192d543d57752e542e70ca1b68225211b71af51e2f6f4ac` | https://hoodi.taikoscan.io/address/0xcB0756170e180A07f6cF435254dc7734D4f4aCaF |
| Shadow (ERC1967Proxy) | `0xf5330eAdB99301B849Ee34DBB21Bf6574723554F` | `0x40d29800b3806fec9710135842fb5763c6106f360298815389bd4101d831ac6a` | https://hoodi.taikoscan.io/address/0xf5330eAdB99301B849Ee34DBB21Bf6574723554F |

Command:

```bash
export DEPLOYER_PK=0x02ab7e6200c14d484b0ca567491370ff9d85f86ff51c41be2af4818658166ba9
cd packages/contracts
forge script script/DeployTaiko.s.sol:DeployTaiko \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --broadcast
```

Result: **Success** (owner/feeRecipient left at the deployer: `0x9F8Fb0cf0cfC9b88EB50FBcAf813a07767B10c43`).

---

## 2. Verification Status

| Contract | Status | Notes |
| --- | --- | --- |
| DummyEtherMinter | ⏳ Blocked | TaikoScan (Etherscan) verification requires an `ETHERSCAN_API_KEY`/TaikoScan API key; none is present in the current environment. |
| Risc0CircuitVerifier | ⏳ Blocked | Same API requirement as above. |
| ShadowVerifier | ⏳ Blocked | Same API requirement as above. |
| Shadow (implementation) | ⏳ Blocked | Same API requirement as above. |
| Shadow (proxy) | ⏳ Blocked | Same API requirement as above. |

> **Action needed:** provide a TaikoScan/Etherscan API key (export `ETHERSCAN_API_KEY=...`) so `forge verify-contract --chain 167013 ...` can be executed for each address.

---

## 3. Proof / Claim Run

| Step | Command | Result |
| --- | --- | --- |
| Deposit validation | `node packages/risc0-prover/scripts/shadowcli.mjs validate --deposit packages/docs/data/deposits/hoodi-two-notes.deposit.json --rpc https://rpc.hoodi.taiko.xyz --note-index 0` | ✅ success (derived target address `0x752097f77980128543c034750bdb8f35b803c627`, PoW digest valid). |
| Proof generation | `node packages/risc0-prover/scripts/shadowcli.mjs prove ...` | ⛔ blocked – target address balance on Taiko Hoodi is `0` so the CLI aborts with `insufficient balance: 0 < 2000000000000000`. |
| Claim submission | _not attempted_ | Depends on proof artifact. |

> The prover now queries the **Taiko Hoodi (L2)** balance of the deposit’s derived `targetAddress`. Please fund `0x752097f77980128543c034750bdb8f35b803c627` with at least `0.002` ETH on chain `167013` (plus gas headroom). The deployer wallet `0x9F8F…0c43` currently has `0` ETH on Hoodi, so it cannot supply the funding. After the transfer lands, re-run `shadowcli prove …` followed by `shadowcli claim … --shadow 0xf5330…554F --private-key <claimer key>`.

---

## 4. Open Tasks

1. **Provide TaikoScan API credentials** so each contract can be verified via `forge verify-contract`.
2. **Fund the deposit target** (`0x7520…3627`) on Taiko Hoodi L2 and re-run `shadowcli prove` / `shadowcli claim`.
3. Once proof + claim succeed, capture the proof file path, claim tx hash, and include them here for completeness.
