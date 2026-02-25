# Shadow Protocol — Containerized Local Architecture Research

## 1. Current Architecture Overview

### 1.1 Project Structure

The Shadow Protocol monorepo (`pnpm` workspace) contains four packages:

```
shadow/
├── packages/
│   ├── contracts/       # Solidity smart contracts (Foundry)
│   ├── risc0-prover/    # Rust RISC Zero prover + Node.js CLI
│   ├── ui/              # Vite SPA (vanilla JS + viem)
│   └── docs/            # Schemas, examples, deployment records
├── package.json         # Root workspace scripts
├── pnpm-workspace.yaml
└── (deposit files, proof files at workspace root)
```

### 1.2 Component Breakdown

#### Smart Contracts (`packages/contracts/`)
- **Shadow.sol** — Main claim contract. Verifies ZK proofs, consumes nullifiers, mints ETH (minus 0.1% fee) via `IEthMinter`.
- **ShadowVerifier.sol** — Fetches canonical `blockHash` from `TaikoAnchor` and delegates circuit verification.
- **Risc0CircuitVerifier.sol** — Decodes `(seal, journal)` from proof bytes, validates journal matches public inputs, calls deployed RISC Zero verifier with `(seal, imageId, sha256(journal))`.
- **DummyEtherMinter.sol** — Testnet mock that emits events instead of minting real ETH.
- **Deployed on Taiko Hoodi** (chainId 167013) with image ID `0xd598228...`.

#### RISC Zero Prover (`packages/risc0-prover/`)
- **Rust crates:**
  - `shadow-proof-core` (`#[no_std]`) — Core claim validation logic shared between host and guest. Includes MPT proof verification, cryptographic derivations (target address, nullifier, PoW), RLP decoding, and balance extraction.
  - `shadow-risc0-host` — CLI binary for proving, verifying, inspecting, exporting, and compressing receipts.
  - `methods/guest` — RISC Zero guest program (the zkVM circuit). Reads `ClaimInput`, calls `evaluate_claim()`, commits packed journal.
  - `methods/` — Build-time ELF generation for the guest, exposes `SHADOW_CLAIM_GUEST_ID` (the image ID).

- **Node.js CLI (`scripts/shadowcli.mjs`):**
  - Commands: `validate`, `prove`, `prove-all`, `verify`, `claim`, `claim-all`
  - Handles deposit loading/validation (via JSON Schema), RPC calls for block data and `eth_getProof`, input construction, invoking the Rust host binary, and on-chain claim submission.
  - Proof files are saved as `note-<index>.proof.json` alongside the deposit file.

- **Deposit Mining (`scripts/mine-deposit.mjs`):**
  - Generates a v2 deposit file with PoW-valid secret (24-bit trailing zeros).
  - Outputs JSON with `version`, `chainId`, `secret`, `notes[]`, `targetAddress`.

- **Docker (`docker/`):**
  - Existing Dockerfile builds a two-stage image: builder (Rust + Node.js + RISC Zero toolchain) → runtime (Node.js slim + Docker CLI).
  - Entrypoint supports two-phase proof generation: `prove` (succinct STARK, no Docker-in-Docker) → `compress` (Groth16, requires Docker socket).
  - Current Docker image is a **batch prover** — it takes a deposit file path, generates proofs, and exits. No persistent server, no UI.

#### Web UI (`packages/ui/`)
- **Vanilla JS SPA** built with Vite, uses `viem` for blockchain interactions and `@noble/hashes` for SHA-256.
- **Three tabs:** Deposit (create deposit files), Prove (load deposit + generate Docker commands), Claim (submit proofs on-chain via MetaMask).
- **Key features:**
  - Deposit file creation with PoW mining (in-browser, ~16M SHA-256 iterations)
  - Target address derivation and display
  - Wallet integration (MetaMask) for funding deposits and claiming
  - Docker command generation for proof generation
  - On-chain nullifier status checking
  - Image ID display (fetched from deployed `Risc0CircuitVerifier` contract)
  - Multi-proof file support (bundled proofs from Docker output)
- **Current limitation:** The UI is a **static SPA** that runs in the browser. It has no backend server. Proof generation is done externally via CLI/Docker commands. File management is manual.

### 1.3 Data Flow

```
1. DEPOSIT CREATION (UI or CLI)
   User → mine-deposit.mjs or UI → deposit-<hash>.json

2. FUNDING
   User → MetaMask/cast → ETH transfer to targetAddress on L1

3. PROOF GENERATION (CLI or Docker)
   deposit.json → shadowcli.mjs prove-all → Rust host binary → RISC Zero zkVM
   → note-0.proof.json, note-1.proof.json, ...

4. CLAIM (UI or CLI)
   proof.json → shadowcli.mjs claim / UI claim tab → Shadow.claim() on L2
```

### 1.4 File Formats

**Deposit file** (`deposit-<hash>.json`):
```json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0x...",
  "notes": [
    { "recipient": "0x...", "amount": "100000000000000", "label": "note #0" }
  ],
  "targetAddress": "0x..."
}
```

**Proof file** (`note-<index>.proof.json`):
```json
{
  "version": "v2",
  "depositFile": "deposit-xxx.json",
  "blockNumber": "...",
  "blockHash": "0x...",
  "chainId": "167013",
  "noteIndex": "0",
  "amount": "...",
  "recipient": "0x...",
  "nullifier": "0x...",
  "publicInputs": ["..."],
  "risc0": { "proof": "0x...", "receipt": "<base64>" }
}
```

**Bundled proofs** (from Docker `prove` phase):
```json
{
  "version": "1.0",
  "phase": "succinct|groth16",
  "chainId": "167013",
  "noteCount": 2,
  "receipts|proofs": [...]
}
```

### 1.5 Key Constants & Configuration

| Parameter | Value |
|-----------|-------|
| Chain ID (Hoodi) | `167013` |
| RPC URL | `https://rpc.hoodi.taiko.xyz` |
| Shadow contract (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` |
| Image ID | `0xd598228081d1cbc4817e7be03aad1a2fdf6f1bb26b75dae0cddf5e597bfec091` |
| Max notes per deposit | 5 |
| Max total amount | 32 ETH |
| Claim fee | 0.1% |
| PoW difficulty | 24 trailing zero bits (3 bytes) |
| Docker image | `ghcr.io/taikoxyz/taiko-shadow` |

---

## 2. Gap Analysis: Current vs. Desired Architecture

### 2.1 Current State

| Aspect | Current |
|--------|---------|
| **Deployment** | CLI tools + separate static UI + separate Docker prover |
| **UI** | Static SPA (Vite), browser-only, no backend |
| **Proof generation** | CLI or Docker batch mode, exits after completion |
| **File management** | Manual (user manages deposit/proof files on disk) |
| **Workspace** | Not formalized; files scattered in project root |
| **Note status** | Checked on-demand via UI (nullifier lookup) |
| **Docker** | Prover-only image, no UI, no persistent service |

### 2.2 Desired State

| Aspect | Desired |
|--------|---------|
| **Deployment** | Single Docker image with everything |
| **UI** | Local web UI served from Docker container |
| **Proof generation** | In-container pipeline, one proof at a time, saves to workspace |
| **File management** | Backend scans and manages deposit/proof files in workspace |
| **Workspace** | Host directory mounted into Docker container |
| **Note status** | Annotated with on-chain claim status, refreshable |
| **Docker** | All-in-one image: backend server + UI + prover |
| **Cross-platform** | Works on any OS (Linux, macOS, Windows) and CPU architectures |

### 2.3 Key Gaps

1. **No backend server** — The current architecture has no HTTP server. Need a new backend service that:
   - Serves the UI
   - Provides REST API for file management
   - Manages proof generation queue
   - Queries on-chain state

2. **No workspace abstraction** — Files are scattered. Need a defined workspace directory structure and file discovery logic.

3. **No file scanning/indexing** — Need automatic discovery and correlation of deposit files and their associated proof files.

4. **No proof queue** — Current Docker image runs proofs as a batch and exits. Need a persistent service that can queue and process proof generation requests one at a time.

5. **No claim status tracking** — Need on-chain nullifier status checking and annotation/caching.

6. **Docker image needs redesign** — Current image is prover-only. Need to add Node.js backend server + built UI assets while keeping the Rust prover toolchain.

7. **UI needs redesign** — Current UI is a separate SPA focused on deposit creation and claim submission. Need a file-system-like view with list and detail views, integrated proof generation, and file management.

---

## 3. Technical Research: Architecture Design

### 3.1 Backend Server

**Technology choice: Rust (Axum)**

Rationale:
- The RISC Zero prover is already Rust — the backend can directly call the prover library in-process instead of shelling out to a binary. This eliminates inter-process communication overhead and simplifies error handling.
- Rust's `axum` is a production-grade, async HTTP framework built on `tokio` and `tower`.
- The backend can share types (`ClaimInput`, `ClaimJournal`, etc.) with `shadow-proof-core` directly.
- Rust provides native performance for file system operations, RPC calls, and proof queue management.
- The existing `shadow-risc0-host` binary's logic can be refactored into a library crate and called directly from the backend.

**Backend responsibilities:**
1. **Static file serving** — Serve the built UI (Vite output, embedded or from disk)
2. **Workspace API** — Scan, list, read, delete deposit/proof files
3. **Proof generation API** — Queue-based proof generation (one at a time), in-process
4. **On-chain queries** — Nullifier status, image ID, contract state (via `alloy` or `ethers-rs`)
5. **WebSocket** — Real-time proof generation progress updates (via `axum`'s WebSocket support)

**Key advantage of Rust backend:** The prover runs **in the same process** as the backend server. No need to spawn a child process or shell out to a binary. This means:
- No serialization/deserialization overhead between processes
- Direct access to proof generation progress
- Simpler error handling and cancellation
- The Rust binary `shadow-risc0-host` logic is refactored into a library crate (`shadow-prover-lib`) that both the CLI binary and the backend server use.

### 3.2 Workspace Design

The workspace is the host directory where the Docker container is started with a bind mount:

```bash
docker run -v $(pwd):/workspace -p 3000:3000 ghcr.io/taikoxyz/taiko-shadow:local
```

**Workspace structure:**
```
workspace/                                                         # Mounted host directory
├── deposit-ffe8-fde9-20260224T214613.json                         # Deposit file
├── deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json   # Proof file (1:1 with deposit)
├── deposit-a1b2-c3d4-20260225T091500.json                         # Another deposit
└── deposit-a1b2-c3d4-20260225T091500.proof-20260225T120000.json   # Its proof
```

**File naming convention:**
- Deposit files: `deposit-<first4hex>-<last4hex>-<ISO8601timestamp>.json`
  - Example: `deposit-ffe8-fde9-20260224T214613.json`
  - The timestamp is when the deposit was created (UTC, compact ISO 8601)
  - `<first4hex>` and `<last4hex>` are derived from the target address for quick identification
- Proof files: `<deposit-stem>.proof-<YYYYMMDDTHHMMSS>.json` (deposit stem + proof generation timestamp)
  - Example: `deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json`
  - The first timestamp (in the deposit stem) is the deposit creation time
  - The second timestamp (after `.proof-`) is when the proof was generated
  - **One proof file per deposit** — contains proofs for ALL notes in the deposit
  - This simplifies the 1:1 deposit↔proof relationship and eliminates per-note file management
  - Having two timestamps lets users see both when the deposit was created and when it was proved

**File discovery logic:**
1. Scan workspace for `deposit-*.json` files (excluding `*.proof.json`)
2. Validate each against the deposit JSON schema
3. For each valid deposit, check for matching `<deposit-stem>.proof-<timestamp>.json`
4. Proof files without a corresponding deposit file are ignored (per requirement)

### 3.3 Proof Generation Pipeline

**Queue design:**
- Single-threaded queue (one proof generation job at a time, per requirement)
- Jobs are `(depositFilePath)` — one job proves ALL notes in the deposit
- Progress reported via WebSocket (per-note progress within the job)
- Output: `<deposit-stem>.proof.json` saved to workspace (single file containing all note proofs)

**Pipeline steps per deposit (reusing existing code):**
1. Load and validate deposit file
2. Derive target address, nullifiers, amounts for all notes
3. Fetch latest block from RPC
4. Fetch `eth_getProof` for target address
5. For each note (sequentially):
   a. Build `ClaimInput` for this note
   b. Call prover library in-process (`shadow-prover-lib::prove_claim()`)
   c. Export proof
   d. Report per-note progress via WebSocket
6. Bundle all note proofs into a single proof file
7. Save `<deposit-stem>.proof.json` to workspace

**Proof file format (bundled):**
```json
{
  "version": "2.0",
  "depositFile": "deposit-ffe8-fde9-20260224T214613.json",
  "depositCreatedAt": "2026-02-24T21:46:13Z",
  "chainId": "167013",
  "generatedAt": "2026-02-25T10:30:00Z",
  "noteCount": 2,
  "proofs": [
    {
      "noteIndex": 0,
      "blockNumber": "...",
      "blockHash": "0x...",
      "amount": "100000000000000",
      "recipient": "0x...",
      "nullifier": "0x...",
      "publicInputs": ["..."],
      "risc0": { "proof": "0x...", "receipt": "<base64>" }
    },
    {
      "noteIndex": 1,
      "blockNumber": "...",
      "blockHash": "0x...",
      "amount": "200000000000000",
      "recipient": "0x...",
      "nullifier": "0x...",
      "publicInputs": ["..."],
      "risc0": { "proof": "0x...", "receipt": "<base64>" }
    }
  ]
}
```

**Receipt kind:** Default to `groth16` for on-chain verifiable proofs. With no Docker-in-Docker, the RISC Zero toolchain runs natively inside the container.

### 3.4 UI Architecture

**Technology: Keep Vite + vanilla JS (or consider a lightweight framework)**

The current UI uses vanilla JS with inline HTML. For the expanded feature set (file browser, detail views, real-time updates), a lightweight framework would improve maintainability. Options:
- **Preact** — 3KB, React-compatible, minimal overhead
- **Vanilla JS** — Continue current approach, no new dependencies
- **Lit** — Web components, small footprint

Recommendation: **Preact** for its component model and small size, but vanilla JS is acceptable if team prefers no framework dependencies.

**UI views:**

1. **List View (Dashboard)** — File-system-like list of deposit files
   - Each row shows: filename, creation timestamp, total amount, note count, target address (truncated), proof status, claim status
   - Status badges: "No proof", "Proved", "All claimed", "Partially claimed", etc.
   - Actions: Delete deposit (and its proof), Delete proof only

2. **Detail View** — Clicking a deposit shows full details
   - Deposit metadata: version, chainId, secret (masked), targetAddress, totalAmount, creation timestamp
   - Notes table: index, recipient, amount, claim status
   - Proof generation: single "Generate Proofs" button that proves all notes at once
   - Proof status: "No proof file", "Generating...", "Ready" (applies to entire deposit)
   - Actions: Generate proofs (all notes), Delete proof file, Check claim status per note
   - Proof generation progress (real-time via WebSocket, shows per-note progress within the job)

3. **Header/Status Bar**
   - Expected Image ID (from contract or compiled into Docker image)
   - Docker instance status
   - Backend server status

4. **Settings** — RPC URL, Shadow contract address

### 3.5 Docker Image Redesign

**No Docker-in-Docker (DinD):**

The current Docker image uses DinD for Groth16 compression (the RISC Zero `risc0-groth16` crate spawns a Docker container internally). This is problematic:
- Requires mounting the Docker socket (`/var/run/docker.sock`)
- Requires `RISC0_WORK_DIR` for path translation
- Adds complexity and security concerns
- Performance overhead from nested containers

**Solution: All-in-one image with native Groth16 support**

Instead of DinD, the Docker image will include all RISC Zero dependencies directly — including the Groth16 prover components that RISC Zero normally delegates to a Docker container. By building the image with the full RISC Zero toolchain and the `r0vm` binary installed, Groth16 proving can happen natively inside the container without spawning nested containers.

The key is setting `RISC0_PROVER=local` and ensuring the `r0vm` binary and snark artifacts are present in the image. The RISC Zero SDK supports local Groth16 proving when the necessary binaries are available — no Docker-in-Docker required.

**Performance considerations:**
- **No DinD overhead** — Proof generation runs natively in the container
- **In-process prover** — The Rust backend calls the RISC Zero prover library directly, avoiding process spawn overhead
- **x86_64 requirement** — RISC Zero's proving requires x86_64. On ARM hosts, Docker's QEMU emulation adds ~2-5x overhead for compute-heavy operations. This is inherent to ZK proof generation on non-x86 hardware and cannot be avoided without native ARM support from RISC Zero.
- **Memory** — RISC Zero proof generation is memory-intensive (16GB+ recommended). The Docker container should have adequate memory limits.

**Multi-stage build:**

```
Stage 1: UI Builder
  - Node.js + pnpm
  - Build UI (vite build)
  - Output: dist/ folder with static assets

Stage 2: Rust Builder
  - Rust toolchain + RISC Zero toolchain (rzup install)
  - Build shadow-server binary (backend + prover)
  - Build shadow-risc0-host binary (CLI, kept for compatibility)

Stage 3: Runtime
  - Minimal base (debian-slim)
  - RISC Zero toolchain binaries (r0vm, snark artifacts)
  - Rust server binary (from builder)
  - Built UI assets (from UI builder)
  - No Node.js needed at runtime (UI is pre-built static files)
  - No Docker CLI needed (no DinD)
  - Entrypoint: shadow-server binary
```

**Entrypoint:**
```bash
# The Rust backend binary serves UI and API
/app/shadow-server --workspace /workspace --port 3000
```

**Docker run:**
```bash
docker run --rm \
  -v $(pwd):/workspace \
  -p 3000:3000 \
  ghcr.io/taikoxyz/taiko-shadow:local
```

**Cross-platform considerations:**
- Docker image built for `linux/amd64` only (RISC Zero requirement)
- On ARM hosts (Apple Silicon), Docker Desktop uses Rosetta 2 or QEMU emulation
- Users should enable "Use Rosetta for x86_64/amd64 emulation" in Docker Desktop settings for better performance on Apple Silicon
- The backend server and UI work fine under emulation; proof generation is the bottleneck

### 3.6 On-Chain Integration

**Nullifier status checking:**
- Call `Shadow.isConsumed(nullifier)` for each note
- Cache results with TTL (e.g., 5 minutes)
- Allow manual refresh ("force check on-chain")

**Circuit ID (formerly "image ID"):**
- Read `Risc0CircuitVerifier.imageId()` from the deployed contract — we call this the **circuit ID** to avoid confusion with Docker image digests
- Display in UI header
- This should match the guest program compiled into the Docker image's Rust binary
- The circuit ID is embedded at compile time via `SHADOW_CLAIM_GUEST_ID`

### 3.6.1 Terminology: Circuit ID vs Docker Image Digest

To avoid confusion between two different "image" concepts:

| Term | What it refers to | Example |
|------|-------------------|---------|
| **Circuit ID** | RISC Zero guest program hash, stored on-chain in `Risc0CircuitVerifier`. Determines which ZK circuit is accepted for proof verification. | `0xd598228081d1cbc4...` |
| **Docker image digest** | SHA-256 digest of the Docker container image published to GHCR. Identifies which Docker image to pull. | `sha256:fc1c022e2af5...` |

These are related but different:
- A given **Docker image** is built with a specific **circuit ID** baked in at compile time.
- The on-chain verifier only accepts proofs generated by the matching circuit ID.
- When publishing a Docker image, we should include the circuit ID in the image's metadata/labels so users can verify compatibility.

**Docker image metadata (published with each image):**
```json
{
  "circuitId": "0xd598228081d1cbc4817e7be03aad1a2fdf6f1bb26b75dae0cddf5e597bfec091",
  "chainId": "167013",
  "shadowContract": "0x77cdA0575e66A5FC95404fdA856615AD507d8A07",
  "risc0Version": "3.0.1"
}
```

This metadata should be:
1. Embedded as Docker labels (`LABEL circuitId=...`)
2. Available via `GET /api/config` from the running backend
3. Displayed in the UI header

### 3.7 Technology Decisions Summary

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Backend | Rust + Axum | In-process prover, shared types with `shadow-proof-core`, native performance |
| RPC client | `alloy` (Rust) | Modern Rust Ethereum library, replaces `ethers-rs`, actively maintained |
| UI framework | Preact or Vanilla JS | Lightweight, current team familiarity |
| UI build | Vite | Already in use |
| API format | REST + WebSocket | Simple, real-time progress |
| Proof queue | In-process `tokio::sync::mpsc` | Single proof at a time, no external deps |
| Docker | Multi-stage, linux/amd64, no DinD | RISC Zero x86_64 requirement, native Groth16 |
| Workspace | Bind-mounted host directory | Simple, files accessible on host |
| File discovery | Glob pattern matching | `deposit-*.json` convention |

---

## 4. Risk Analysis

### 4.1 Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| RISC Zero only on x86_64 | Medium | Document requirement, use Docker platform emulation on ARM |
| Groth16 proving without DinD | Medium | Include RISC Zero toolchain and r0vm binary directly in image. Set `RISC0_PROVER=local`. If native Groth16 proves difficult without DinD, fall back to succinct proofs with a separate compress step. |
| Large proof files (~750KB each) | Low | Workspace scanning should be efficient; avoid loading full proof content for list view |
| Long proof generation time | Medium | WebSocket progress updates, queue management, cancellation support |
| File system permissions in Docker | Medium | Run as non-root user, configure proper UID/GID mapping |
| Concurrent file access | Low | Single proof queue prevents concurrent writes; reads are safe |

### 4.2 UX Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Users unfamiliar with Docker | Medium | Clear documentation, simple `docker run` command |
| Port conflicts (3000) | Low | Allow configurable port via env variable |
| Workspace directory confusion | Medium | Clear documentation, validate workspace on startup |
| Proof generation appears stuck | Medium | Real-time progress via WebSocket, timeout handling |

---

## 5. Existing Code Reuse Opportunities

### 5.1 From `shadowcli.mjs`

The following functions can be extracted into shared backend modules:
- `loadDeposit()` — deposit loading and schema validation
- `deriveFromDeposit()` — cryptographic derivations
- `buildLegacyClaimInput()` — input construction for Rust host
- `buildPublicInputs()` — public inputs array
- `rpcCall()` — generic JSON-RPC client
- `runHost()` — Rust binary invocation
- `extractVerificationPayload()` — proof file parsing
- All crypto functions: `computeRecipientHash`, `computeNotesHash`, `deriveTargetAddress`, `deriveNullifier`, `computePowDigest`

### 5.2 From `mine-deposit.mjs`

- PoW mining logic (already duplicated in UI)
- Deposit file construction

### 5.3 From UI `main.js`

- Wallet integration patterns
- On-chain query patterns (nullifier status, image ID)
- Docker command generation logic
- Deposit creation UI flow

### 5.4 From Docker `entrypoint.sh`

- Two-phase proof generation logic
- Network detection and RPC resolution
- Proof bundling

---

## 6. Dependencies to Add

### Backend (Rust crate: `shadow-server`)
- `axum` — HTTP framework (async, WebSocket support built-in)
- `tokio` — Async runtime (already used by RISC Zero)
- `tower-http` — Static file serving, CORS, compression
- `serde` / `serde_json` — Serialization (already in use)
- `alloy` — Ethereum RPC client (modern replacement for ethers-rs)
- `glob` — File pattern matching for workspace scanning
- `notify` — File system watcher (optional, for auto-refresh)
- `tracing` — Structured logging
- Existing: `risc0-zkvm`, `shadow-proof-core`, `shadow-risc0-methods`

### UI (if using Preact)
- `preact` — UI framework
- `preact-router` (or simple hash routing) — client-side routing
- Existing: `viem`, `@noble/hashes`

### Docker
- No Docker CLI needed (no DinD)
- No Node.js needed at runtime (UI is pre-built)
- Smaller runtime image compared to current

---

## 7. File Naming Convention Change

### Deposit files

**Current:** `deposit-<first4hex>-<last4hex>-<timestamp>.json` (e.g. `deposit-ffe8-fde9-20260224T214613.json`)
- The current convention already includes a timestamp. We formalize this as the standard.
- Timestamp format: compact ISO 8601 UTC (`YYYYMMDDTHHMMSS`)

### Proof files

**Current:** Multiple per-note files (`note-<index>.proof.json`) in the same directory as the deposit file. This doesn't include the deposit file identifier, making it ambiguous when multiple deposit files exist in the same directory. Also produces many small files.

**Proposed:** One proof file per deposit: `<deposit-stem>.proof-<YYYYMMDDTHHMMSS>.json`

Example:
- Deposit: `deposit-ffe8-fde9-20260224T214613.json`
- Proof: `deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json`

The proof filename carries **two timestamps**:
- First timestamp (in the deposit stem): when the deposit was created
- Second timestamp (after `.proof-`): when the proof was generated

This provides:
- **1:1 deposit↔proof mapping** — simple to understand and manage
- **Unambiguous correlation** — proof filename starts with deposit stem, matched by glob `<deposit-stem>.proof-*.json`
- **Fewer files** — one proof file contains all note proofs instead of N separate files
- **Atomic generation** — proof file is written once after all notes are proved
- **Temporal context** — both creation and proof generation times are visible in the filename

### Migration

The backend should also recognize the legacy naming pattern (`note-<index>.proof.json`) for backward compatibility, using the `depositFile` field inside the proof JSON to correlate with its deposit.

---

## 8. API Design (Draft)

### REST Endpoints

```
GET  /api/health                         — Server health check
GET  /api/config                         — Image ID, chain config, server version
GET  /api/deposits                       — List all deposit files with status
GET  /api/deposits/:id                   — Get deposit details + notes + proof status
DELETE /api/deposits/:id                 — Delete deposit file (and optionally its proof)
DELETE /api/deposits/:id/proof           — Delete the proof file for this deposit
POST /api/deposits/:id/prove             — Queue proof generation for ALL notes in deposit
GET  /api/deposits/:id/notes/:noteIndex/status — Check on-chain claim status for a note
POST /api/deposits/:id/notes/:noteIndex/refresh — Force refresh claim status for a note
GET  /api/queue                          — Get proof generation queue status
DELETE /api/queue/current                — Cancel current proof job
```

### WebSocket

```
ws://localhost:3000/ws

Events:
  { type: "proof:started", depositId }
  { type: "proof:note_progress", depositId, noteIndex, totalNotes, message }
  { type: "proof:completed", depositId, proofFile: "deposit-xxx.proof-20260225T103000.json" }
  { type: "proof:failed", depositId, noteIndex, error }
  { type: "workspace:changed" }
```
