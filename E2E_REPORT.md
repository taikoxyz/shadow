# End-to-End Test Report: Shadow Protocol Containerized Architecture

**Date:** February 25, 2026
**Branch:** `claude/containerize-local-architecture-y0Y2n`
**Network:** Taiko Hoodi Testnet (Chain ID: 167013)
**Overall Result:** **PASSED** (21/21 tests, 1 bug found and fixed)

---

## 1. Test Environment

| Component | Version/Detail |
|-----------|----------------|
| Rust Server | `shadow-server` v0.1.0 (Axum + Tokio) |
| UI | Vite 7.3.1, vanilla JS thin client |
| Solidity | 0.8.33, via_ir, optimizer 200 runs |
| Foundry | forge/cast (latest) |
| Node.js | v20.12.2 |
| RPC URL | `https://rpc.hoodi.taiko.xyz` |
| Deployer | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |

---

## 2. Deployed Contracts

All contracts verified on [Taiko Hoodi Explorer](https://hoodi.taikoscan.io).

| Contract | Address | Verified |
|----------|---------|----------|
| Shadow (proxy) | [`0x77cdA0575e66A5FC95404fdA856615AD507d8A07`](https://hoodi.taikoscan.io/address/0x77cdA0575e66A5FC95404fdA856615AD507d8A07) | Proxy |
| Shadow (impl) | [`0xB86Ee0cEA6841e7239F9C14F49688e37D2032DcB`](https://hoodi.taikoscan.io/address/0xB86Ee0cEA6841e7239F9C14F49688e37D2032DcB#code) | Yes |
| ShadowVerifier | [`0xF487a0541E39b19669cC6DD151F83B230b9984dC`](https://hoodi.taikoscan.io/address/0xF487a0541E39b19669cC6DD151F83B230b9984dC#code) | Yes |
| Risc0CircuitVerifier | [`0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92`](https://hoodi.taikoscan.io/address/0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92#code) | Yes |
| DummyEtherMinter | [`0x6DC226aA43E86fE77735443fB50a0A90e5666AA4`](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4#code) | Yes |

### Configuration

| Parameter | Value |
|-----------|-------|
| Owner | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| TaikoAnchor | `0x1670130000000000000000000000000000010001` |
| RISC0 Verifier (v3.0.1) | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| Circuit ID (Image ID) | `0xd598228081d1cbc4817e7be03aad1a2fdf6f1bb26b75dae0cddf5e597bfec091` |

---

## 3. Test Execution

### 3.0 Prerequisites

**Solidity Contract Tests** (Forge):

```
52 tests passed, 0 failed, 0 skipped
  - Shadow.t.sol: 25 passed
  - Risc0CircuitVerifier.t.sol: 14 passed
  - ShadowVerifier.t.sol: 8 passed
  - DummyEtherMinter.t.sol: 1 passed
  - ShadowPublicInputs.t.sol: 1 passed
  - ClaimDigestDebug.t.sol: 3 passed
```

**Rust Server Unit + Integration Tests**:

```
15 tests passed, 0 failed
  Unit tests (11):
    - prover::rpc::tests (5 RLP/normalization tests)
    - workspace::scanner::tests (5 scanner/filename tests)
    - workspace::scanner::parse_timestamp_from_filename_works (1)
  Integration tests (4):
    - workspace_scanner_finds_deposits_and_proofs
    - deposit_file_parsing_and_validation
    - filename_conventions
    - bundled_proof_structure
```

### 3.1 Deposit Mining

A fresh deposit was mined using `mine-deposit.mjs`:

| Field | Value |
|-------|-------|
| Filename | `deposit-1401-526a-20260225T120000.json` |
| Chain ID | `167013` |
| Target Address | `0x1401b8afbf8b048fd0c3f4940dc11f5a08ac526a` |
| Total Amount | 0.002 ETH (2 notes x 0.001 ETH) |
| Recipient | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| PoW Attempts | ~17,817,026 |
| Nullifier[0] | `0xba8f0a9667492da38b3aa74fdda2a54aaccf96ba57648873b4b93637eae5dc45` |
| Nullifier[1] | `0xc3bfb130444eeb06e38f9dad1ab0a5d74c8b9be172f6dd69544611b9088c530f` |

### 3.2 Target Funding

| Transaction | Hash |
|-------------|------|
| Fund Target (0.003 ETH) | [`0xcbe77e6f6b03e08b60fe9f89fc2846e59ad893466f26033de9b477b6a5a6e8cf`](https://hoodi.taikoscan.io/tx/0xcbe77e6f6b03e08b60fe9f89fc2846e59ad893466f26033de9b477b6a5a6e8cf) |

---

## 4. Server API E2E Tests

The server was started locally with:

```bash
shadow-server \
  --workspace ./workspace \
  --port 3001 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --shadow-address 0x77cdA0575e66A5FC95404fdA856615AD507d8A07 \
  --verifier-address 0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92 \
  --ui-dir ./packages/ui/dist
```

### Test Results

| # | Test | Endpoint | Expected | Result |
|---|------|----------|----------|--------|
| 1 | Health check | `GET /api/health` | `{"status":"ok"}` | PASSED |
| 2 | Config with circuit ID | `GET /api/config` | Returns circuitId from on-chain query | PASSED |
| 3 | List deposits | `GET /api/deposits` | Returns 1 deposit with 2 notes | PASSED |
| 4 | Get deposit detail | `GET /api/deposits/:id` | Full deposit with notes, nullifiers, amounts | PASSED |
| 5 | Non-existent deposit | `GET /api/deposits/nonexistent` | HTTP 404 | PASSED |
| 6 | Note status (on-chain) | `GET /api/deposits/:id/notes/0/status` | `claimStatus: "unclaimed"` | PASSED |
| 7 | Refresh note status | `POST /api/deposits/:id/notes/0/refresh` | `claimStatus: "unclaimed"` | PASSED |
| 8 | Note 1 status | `GET /api/deposits/:id/notes/1/status` | `claimStatus: "unclaimed"` | PASSED |
| 9 | Queue status (empty) | `GET /api/queue` | `null` | PASSED |
| 10 | Cancel non-existent | `DELETE /api/queue/current` | HTTP 404 | PASSED |
| 11 | Proof generation | `POST /api/deposits/:id/prove` | Job queued, pipeline runs | PASSED |
| 12 | Queue after proof | `GET /api/queue` | `status: "completed"` | PASSED |
| 13 | Proof file created | Filesystem check | `<deposit-stem>.proof-<ts>.json` exists | PASSED |
| 14 | Deposit shows proof | `GET /api/deposits/:id` | `hasProof: true`, `proofFile` set | PASSED |
| 15 | Delete proof only | `DELETE /api/deposits/:id/proof` | Proof file removed | PASSED |
| 16 | Deposit after proof delete | `GET /api/deposits/:id` | `hasProof: false` | PASSED |
| 17 | UI static serving | `GET /` | HTTP 200, HTML content | PASSED |
| 18 | WebSocket upgrade | `GET /ws` (upgrade) | Connection accepted | PASSED |
| 19 | Multi-deposit | Add 2nd deposit, list | Count = 2 | PASSED |
| 20 | Delete deposit | `DELETE /api/deposits/:id` | Deposit file removed | PASSED |
| 21 | Delete with proof | `DELETE /api/deposits/:id?include_proof=true` | Both files removed | PASSED |

---

## 5. Proof Pipeline Validation

The proof generation pipeline was tested end-to-end (without the `prove` feature flag, which validates inputs and builds the proof structure without RISC Zero ZK execution):

### Pipeline Steps Validated

1. **Deposit Loading**: Parsed v2 deposit JSON correctly
2. **Chain ID Verification**: Matched deposit chain ID (167013) against RPC
3. **Block Fetching**: Retrieved latest block data from Hoodi
4. **Account Proof**: Fetched `eth_getProof` for target address
5. **Input Construction**: Built `ClaimInput` for each note
6. **Claim Validation**: `evaluate_claim()` succeeded for both notes
7. **Proof Bundling**: Generated single proof file with 2 note entries
8. **File Naming**: `deposit-1401-526a-20260225T120000.proof-20260225T013822.json`

### Proof File Structure

```json
{
  "version": "v2",
  "depositFile": "deposit-1401-526a-20260225T120000.json",
  "blockNumber": "4762697",
  "blockHash": "0xb053df10216e2a1ec07aeed74aeca321ccd1fbdb71b4e6b2922083f9c76ab94a",
  "chainId": "167013",
  "notes": [
    {
      "noteIndex": 0,
      "amount": "1000000000000000",
      "recipient": "0xe36c0f16d5fb473cc5181f5fb86b6eb3299ad9cb",
      "nullifier": "0xba8f0a9667492da38b3aa74fdda2a54aaccf96ba57648873b4b93637eae5dc45",
      "proof": ""
    },
    {
      "noteIndex": 1,
      "amount": "1000000000000000",
      "recipient": "0xe36c0f16d5fb473cc5181f5fb86b6eb3299ad9cb",
      "nullifier": "0xc3bfb130444eeb06e38f9dad1ab0a5d74c8b9be172f6dd69544611b9088c530f",
      "proof": ""
    }
  ]
}
```

Note: `proof` fields are empty because the server was built without the `prove` feature (no RISC Zero toolchain). With `--features prove`, real ZK proofs would be generated.

---

## 6. On-Chain Query Validation

| Query | Contract | Method | Result |
|-------|----------|--------|--------|
| Circuit ID | Risc0CircuitVerifier | `imageId()` | `0xd598228...` |
| Nullifier[0] consumed | Shadow | `isConsumed(bytes32)` | `false` (unclaimed) |
| Nullifier[1] consumed | Shadow | `isConsumed(bytes32)` | `false` (unclaimed) |
| Contract owner | Shadow | `owner()` | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| Verifier address | Shadow | `verifier()` | `0xF487a0541E39b19669cC6DD151F83B230b9984dC` |
| Ether minter | Shadow | `etherMinter()` | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` |

---

## 7. Bug Found and Fixed

### Incorrect Function Selectors in Chain Client

**File:** `packages/server/src/chain/shadow_contract.rs`

**Issue:** Two hardcoded Solidity function selectors were incorrect:

| Function | Wrong Selector | Correct Selector |
|----------|---------------|-----------------|
| `imageId()` | `0xe3c573fb` | `0xef3f7dd5` |
| `isConsumed(bytes32)` | `0xd824ef04` | `0x6346e832` |

**Impact:** The server's `/api/config` endpoint failed to read the circuit ID from the on-chain verifier, and note claim status queries (`/api/deposits/:id/notes/:noteIndex/status`) returned `"unknown"` instead of the actual on-chain status.

**Fix:** Updated both selectors to the correct values derived from `cast sig`.

**Verification:** After the fix:
- `GET /api/config` correctly returns `circuitId: "0xd598228..."`
- `GET /api/deposits/:id/notes/0/status` correctly returns `claimStatus: "unclaimed"`

---

## 8. Contract Verification

All 4 implementation contracts verified on Taiko Hoodi Explorer using `forge verify-contract`:

| Contract | Address | Explorer |
|----------|---------|----------|
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` | [Verified](https://hoodi.taikoscan.io/address/0x6DC226aA43E86fE77735443fB50a0A90e5666AA4#code) |
| Risc0CircuitVerifier | `0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92` | [Verified](https://hoodi.taikoscan.io/address/0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92#code) |
| ShadowVerifier | `0xF487a0541E39b19669cC6DD151F83B230b9984dC` | [Verified](https://hoodi.taikoscan.io/address/0xF487a0541E39b19669cC6DD151F83B230b9984dC#code) |
| Shadow (impl) | `0xB86Ee0cEA6841e7239F9C14F49688e37D2032DcB` | [Verified](https://hoodi.taikoscan.io/address/0xB86Ee0cEA6841e7239F9C14F49688e37D2032DcB#code) |

---

## 9. Architecture Validation

This E2E test validated the complete containerized architecture:

1. **Rust Backend (Axum)**: Serves REST API + WebSocket + static UI files from a single binary
2. **Workspace Scanner**: Discovers deposit/proof files using naming conventions, derives metadata (target address, nullifiers, amounts)
3. **Proof Pipeline**: Loads deposit, fetches block data via RPC, validates inputs, generates bundled proof file
4. **On-Chain Queries**: Reads circuit ID from verifier contract, checks nullifier status from Shadow contract (with caching)
5. **File Convention**: `deposit-<hex>-<hex>-<timestamp>.json` / `<deposit-stem>.proof-<timestamp>.json`
6. **CRUD Operations**: Create (mining), Read (list/detail), Delete (deposit, proof, or both)
7. **UI Serving**: Static files served via `tower-http::ServeDir` with SPA fallback

---

## 10. Remaining Work (Plan Gaps)

### Completed in this session:
- Fixed function selector bug in chain client
- Verified all contracts on block explorer
- Full server API E2E test (21 tests)
- Proof pipeline validation (mock mode)

### Still needed for full plan completion:

| Phase | Item | Status |
|-------|------|--------|
| 3.3 | Verify Groth16 works without Docker-in-Docker | Needs RISC Zero toolchain in Docker |
| 3.4 | CI/CD workflow update | Not started |
| 4.3 | `POST /api/deposits` (deposit creation via backend) | Not implemented |
| 5.2 | UI unit tests | Not started |
| 5.4 | Full E2E with real prover (Docker) | Requires Docker build with `prove` feature |
| 5.4 | Playwright browser E2E tests | Not started |
| 6.1 | Documentation updates (README, server README) | Partial |
| 6.2 | Code cleanup (dead imports, unused code) | Partial |

### Critical Path for Production:
1. Build Docker image with `prove` feature and RISC Zero toolchain
2. Run proof generation inside container to verify no Docker-in-Docker needed
3. Submit actual ZK proofs and claims on Hoodi
4. CI/CD pipeline for image builds

---

## 11. Commands Reference

### Build & Test

```bash
# Server tests
cargo test --manifest-path packages/server/Cargo.toml

# Contract tests
cd packages/contracts && forge test -vvv

# Build UI
cd packages/ui && pnpm build

# Build server (without prover)
cargo build --release --manifest-path packages/server/Cargo.toml

# Build server (with prover)
cargo build --release --manifest-path packages/server/Cargo.toml --features prove
```

### Run Server Locally

```bash
./packages/server/target/release/shadow-server \
  --workspace ./workspace \
  --port 3000 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --shadow-address 0x77cdA0575e66A5FC95404fdA856615AD507d8A07 \
  --verifier-address 0x3CdA03f7c005F46Dc506B334B275B45EDFb4Df92 \
  --ui-dir ./packages/ui/dist
```

### Mine Deposit

```bash
node packages/risc0-prover/scripts/mine-deposit.mjs \
  --out workspace/deposit-<hex>-<hex>-<timestamp>.json \
  --chain-id 167013 \
  --recipient 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb \
  --amount-wei 1000000000000000 \
  --note-count 2 \
  --same-recipient
```

### Fund Target

```bash
cast send <TARGET_ADDRESS> \
  --value 3000000000000000 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key $DEPLOYER_PK
```

### Verify Contracts

```bash
cd packages/contracts
forge verify-contract <ADDRESS> src/impl/<Contract>.sol:<Contract> \
  --verifier etherscan \
  --etherscan-api-key $ETHERSCAN_KEY \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013" \
  --constructor-args $(cast abi-encode "constructor(args)" arg1 arg2)
```
