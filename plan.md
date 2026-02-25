# Shadow Protocol — Containerized Local Architecture: Implementation & Testing Plan

## Overview

Re-architect Shadow Protocol into a single Docker image that provides:
- A local web UI for managing deposits, proofs, and claims
- A Rust backend server (Axum) with REST API + WebSocket
- In-process ZK proof generation (no Docker-in-Docker)
- Workspace-based file management via bind-mounted host directory

---

## Phase 0: Project Setup & Refactoring Foundation

### 0.1 Create new packages and Cargo workspace structure

**Files to create:**
```
packages/
├── server/                         # New: Rust backend server
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                 # Entrypoint
│       ├── config.rs               # Server configuration
│       ├── routes/                  # HTTP route handlers
│       │   ├── mod.rs
│       │   ├── health.rs
│       │   ├── config_routes.rs
│       │   ├── deposits.rs
│       │   ├── proofs.rs
│       │   └── queue.rs
│       ├── workspace/              # Workspace scanning & file management
│       │   ├── mod.rs
│       │   ├── scanner.rs
│       │   ├── deposit_file.rs
│       │   └── proof_file.rs
│       ├── prover/                 # Proof generation queue
│       │   ├── mod.rs
│       │   ├── queue.rs
│       │   ├── pipeline.rs
│       │   └── rpc.rs
│       ├── chain/                  # On-chain queries
│       │   ├── mod.rs
│       │   └── shadow_contract.rs
│       └── ws.rs                   # WebSocket handler
├── risc0-prover/
│   ├── crates/
│   │   ├── shadow-proof-core/      # Existing: shared core logic (no changes)
│   │   └── shadow-prover-lib/      # New: extracted prover library
│   │       ├── Cargo.toml
│   │       └── src/lib.rs
│   ├── host/                       # Existing: CLI binary (refactored to use shadow-prover-lib)
│   └── ...
└── ui/                             # Existing: redesigned UI
    ├── src/
    │   ├── main.js                 # Rewritten for new architecture
    │   ├── components/             # UI components
    │   ├── api.js                  # Backend API client
    │   └── style.css
    └── ...
```

### 0.2 Extract prover library from host binary

- [ ] Create `shadow-prover-lib` crate
- [ ] Move proving logic from `host/src/main.rs` into library functions:
  - `prove_claim(input: &ClaimInput, receipt_kind: &str) -> Result<Receipt>`
  - `verify_receipt(receipt: &Receipt) -> Result<ClaimJournal>`
  - `export_proof(receipt: &Receipt) -> Result<ExportedProof>`
  - `compress_receipt(receipt: &Receipt) -> Result<Receipt>`
- [ ] Refactor `shadow-risc0-host` CLI to call `shadow-prover-lib`
- [ ] Verify existing CLI tests still pass

### 0.3 Add deposit file utilities to Rust

- [ ] Create deposit file loader in `shadow-prover-lib` or `shadow-proof-core`:
  - `load_deposit(path: &Path) -> Result<DepositFile>`
  - `validate_deposit(deposit: &DepositFile) -> Result<()>`
  - `derive_deposit_info(deposit: &DepositFile) -> DerivedInfo` (target address, nullifiers for all notes, etc.)
- [ ] Port JSON schema validation from JS to Rust (or use `jsonschema` crate)
- [ ] Port RPC input construction logic (currently in `shadowcli.mjs`) to Rust:
  - `fetch_block_data(rpc_url, block_tag) -> Result<BlockData>`
  - `fetch_account_proof(rpc_url, address, block) -> Result<AccountProof>`
  - `build_claim_input(deposit, note_index, block_data, account_proof) -> Result<ClaimInput>`
- [ ] Implement deposit filename generation:
  - Format: `deposit-<first4hex>-<last4hex>-<YYYYMMDDTHHMMSS>.json`
  - `<first4hex>`, `<last4hex>` derived from target address
  - Timestamp is UTC creation time in compact ISO 8601

---

## Phase 1: Rust Backend Server

### 1.1 Server skeleton with Axum

- [ ] Create `packages/server/Cargo.toml` with dependencies:
  - `axum`, `tokio`, `tower-http`, `serde`, `serde_json`, `tracing`, `tracing-subscriber`
- [ ] Implement `main.rs`:
  - Parse CLI args: `--workspace <path>`, `--port <port>`, `--rpc-url <url>`
  - Initialize tracing/logging
  - Create shared application state (`Arc<AppState>`)
  - Build Axum router
  - Bind to `0.0.0.0:<port>` and serve
- [ ] Implement health check endpoint: `GET /api/health`

### 1.2 Static file serving

- [ ] Use `tower-http::services::ServeDir` to serve built UI from `/app/ui/` (or embedded)
- [ ] Fallback to `index.html` for SPA routing
- [ ] CORS configuration for local development

### 1.3 Workspace scanner

- [ ] Implement `workspace::scanner`:
  - Scan directory for files matching `deposit-*.json` (excluding `*.proof.json`)
  - Validate each file against deposit schema
  - For each valid deposit, check for matching proof file: `<deposit-stem>.proof.json`
  - Also support legacy naming: `note-<N>.proof.json` (correlate via `depositFile` field in proof JSON)
  - Ignore proof files without corresponding deposit files
  - Return structured workspace index
- [ ] Implement `workspace::deposit_file`:
  - Parse deposit JSON
  - Extract metadata (chainId, notes count, target address, total amount)
  - Parse creation timestamp from filename
  - Derive all note nullifiers
- [ ] Implement `workspace::proof_file`:
  - Parse bundled proof JSON (contains proofs for all notes)
  - Extract per-note metadata (noteIndex, blockNumber, nullifier, etc.)
  - Validate proof structure and note count matches deposit

### 1.4 Deposit REST API

- [ ] `GET /api/deposits` — List all deposits with summary info:
  ```json
  [
    {
      "id": "deposit-ffe8-fde9-20260224T214613",
      "filename": "deposit-ffe8-fde9-20260224T214613.json",
      "chainId": "167013",
      "targetAddress": "0x...",
      "totalAmount": "300000000000000",
      "noteCount": 2,
      "createdAt": "2026-02-24T21:46:13Z",
      "hasProof": true,
      "proofFile": "deposit-ffe8-fde9-20260224T214613.proof.json",
      "notes": [
        {
          "index": 0,
          "recipient": "0x...",
          "amount": "100000000000000",
          "label": "note #0",
          "hasProof": true,
          "claimStatus": "unclaimed|claimed|unknown"
        }
      ],
      "claimStatus": "partial"
    }
  ]
  ```
- [ ] `GET /api/deposits/:id` — Full deposit details including derived info
- [ ] `DELETE /api/deposits/:id` — Delete deposit file and optionally its proof
  - Query param `?include_proof=true` to also delete associated proof file
- [ ] `DELETE /api/deposits/:id/proof` — Delete the proof file for this deposit

### 1.5 Proof generation pipeline

- [ ] Implement `prover::queue`:
  - Single-slot queue using `tokio::sync::mpsc` (capacity 1)
  - Job struct: `{ deposit_id, status, current_note, total_notes, progress }`
  - States: `queued`, `running`, `completed`, `failed`, `cancelled`
  - Only one deposit proves at a time (all its notes sequentially)
- [ ] Implement `prover::pipeline`:
  - Accept `(deposit_path, rpc_url)` as input — proves ALL notes in the deposit
  - Load and validate deposit file
  - Derive target address, nullifiers, amounts for all notes
  - Fetch latest block via RPC
  - Fetch `eth_getProof` for target address
  - For each note (i = 0..note_count):
    - Build `ClaimInput` for note i
    - Call `shadow-prover-lib::prove_claim()` in `tokio::task::spawn_blocking`
    - Export proof for note i
    - Report per-note progress via WebSocket
  - Bundle all note proofs into single proof file
  - Save as `<deposit-stem>.proof-<YYYYMMDDTHHMMSS>.json` in workspace (timestamp = proof generation time)
  - Report completion via WebSocket
- [ ] Implement `prover::rpc`:
  - JSON-RPC client using `reqwest` or `alloy`
  - `eth_getBlockByNumber`
  - `eth_getProof`
  - `eth_chainId`
  - Block header RLP encoding (port from `shadowcli.mjs`)
- [ ] API endpoints:
  - `POST /api/deposits/:id/prove` — Queue proof generation for all notes in deposit
  - `GET /api/queue` — Get queue status (current job, progress)
  - `DELETE /api/queue/current` — Cancel running job (best-effort)

### 1.6 On-chain status queries

- [ ] Implement `chain::shadow_contract`:
  - Read `Risc0CircuitVerifier.imageId()` → `bytes32` (we call this "circuit ID" — see terminology note below)
  - Read `Shadow.isConsumed(nullifier)` → `bool` for each note
  - Cache results with TTL (configurable, default 5 minutes)
- [ ] API endpoints:
  - `GET /api/config` — Returns circuit ID, chain config, Docker image info, server version
  - `POST /api/deposits/:id/notes/:noteIndex/refresh` — Force refresh nullifier status
  - `GET /api/deposits/:id/notes/:noteIndex/status` — Get cached claim status
- [ ] **Terminology:** Use "circuit ID" (not "image ID") for the RISC Zero guest program hash to avoid confusion with Docker image digests. The `GET /api/config` response should clearly separate:
  - `circuitId`: RISC Zero guest program hash (on-chain verifier parameter)
  - `dockerImageDigest`: Docker image digest (if available from build metadata)

### 1.7 WebSocket support

- [ ] Implement `ws.rs`:
  - `GET /ws` — WebSocket upgrade
  - Broadcast channel for proof generation events
  - Events:
    ```json
    { "type": "proof:started", "depositId": "..." }
    { "type": "proof:note_progress", "depositId": "...", "noteIndex": 0, "totalNotes": 2, "message": "Proving note 1/2..." }
    { "type": "proof:completed", "depositId": "...", "proofFile": "deposit-xxx.proof-20260225T103000.json" }
    { "type": "proof:failed", "depositId": "...", "noteIndex": 0, "error": "..." }
    { "type": "workspace:changed" }
    ```
  - Notify on workspace file changes (deposit/proof created/deleted)

---

## Phase 2: UI Redesign

### 2.1 UI architecture

- [ ] **Remove existing UI styles entirely** — `packages/ui/src/style.css` and all inline styles will be deleted
- [ ] Use [taste-skill](https://github.com/Leonxlnx/taste-skill) for UI re-styling and re-design
  - Install and configure taste-skill for the project
  - Apply taste-skill to generate a cohesive design system for the new UI
- [ ] Decide framework: Preact (recommended for component model) or vanilla JS
- [ ] Set up project structure:
  ```
  packages/ui/src/
  ├── main.js              # Entry point, router
  ├── api.js               # Backend API client (fetch + WebSocket)
  ├── components/
  │   ├── App.js           # Root component
  │   ├── Header.js        # Status bar with image ID
  │   ├── DepositList.js   # List view of all deposits
  │   ├── DepositCard.js   # Summary card for each deposit
  │   ├── DepositDetail.js # Detail view for a deposit
  │   ├── NoteRow.js       # Note row in detail view
  │   ├── ProofStatus.js   # Proof/claim status badges
  │   ├── ProofProgress.js # Real-time proof generation progress
  │   ├── Settings.js      # Settings dialog
  │   └── ConfirmDialog.js # Delete confirmation
  └── style.css            # Styles
  ```

### 2.2 API client

- [ ] Implement `api.js`:
  - REST client with `fetch()`:
    - `getDeposits()`, `getDeposit(id)`, `deleteDeposit(id, includeProof)`
    - `deleteProof(depositId)` — deletes the single proof file for this deposit
    - `startProof(depositId)` — queues proof generation for all notes in deposit
    - `getQueueStatus()`
    - `getConfig()`
    - `refreshNoteStatus(depositId, noteIndex)`
  - WebSocket client:
    - Auto-connect/reconnect
    - Event listeners for proof progress and workspace changes
    - Update UI state on events

### 2.3 List view (Dashboard)

- [ ] Implement `DepositList.js`:
  - Fetch deposits from `GET /api/deposits`
  - Display as a sortable list/table:
    - Filename (clickable → detail view)
    - Creation timestamp (parsed from filename)
    - Chain ID
    - Total amount (formatted ETH)
    - Note count
    - Target address (truncated with copy button)
    - Status badges: "No proof", "Proved", "All claimed", "Partially claimed"
  - Actions per row:
    - Delete deposit and its proof (with confirmation)
    - Delete proof only
  - Auto-refresh when WebSocket sends `workspace:changed`

### 2.4 Detail view

- [ ] Implement `DepositDetail.js`:
  - Header: filename, chainId, target address (full, copyable), creation timestamp
  - Deposit metadata: version, total amount
  - Proof status banner: "No proof file", "Generating... (note 1/3)", "Proof ready"
  - Single "Generate Proofs" button — proves ALL notes in the deposit at once
  - "Delete Proof" button — removes the single proof file
  - Notes table:

    | # | Recipient | Amount | Label | Claim Status | Actions |
    |---|-----------|--------|-------|-------------|---------|
    | 0 | 0xabc...def | 0.001 ETH | note #0 | Unclaimed | [Claim] [Refresh] |
    | 1 | 0x123...789 | 0.002 ETH | note #1 | Claimed | [Refresh] |

  - Claim status per note: "Unclaimed", "Claimed", "Unknown" + [Refresh] button
  - [Claim] button per note (uses wallet/MetaMask, enabled when proof exists + unclaimed)
  - Back button to return to list view

### 2.5 Proof generation progress

- [ ] Implement `ProofProgress.js`:
  - Shows when proofs are being generated for a deposit
  - Per-note progress: "Proving note 1/3...", "Proving note 2/3...", etc.
  - Real-time progress messages via WebSocket
  - Progress stages per note: "Fetching block data", "Building input", "Running prover", "Exporting proof"
  - Overall progress bar (noteIndex / totalNotes)
  - Cancel button

### 2.6 Header / status bar

- [ ] Implement `Header.js`:
  - Circuit ID display (from `GET /api/config`) — clearly labeled as "Circuit ID" (not "Image ID")
  - Server status indicator (green/red)
  - Settings button

### 2.7 Settings

- [ ] Implement `Settings.js`:
  - RPC URL (with validation)
  - Shadow contract address
  - Save to localStorage and/or backend

### 2.8 Preserve existing features

- [ ] Keep deposit creation capability in UI (mine-deposit in browser)
  - Port existing Deposit tab functionality
  - Save created deposits to workspace via backend API (new endpoint: `POST /api/deposits`)
- [ ] Keep claim submission via MetaMask (existing Claim tab)
  - Integrate with detail view: "Claim" button per note that has a proof
  - Use wallet connection from current UI

---

## Phase 3: Docker Image

### 3.1 New Dockerfile

- [ ] Create `docker/Dockerfile` at repo root (or update existing):
  ```dockerfile
  # Stage 1: UI Builder
  FROM node:20-bookworm AS ui-builder
  WORKDIR /build
  COPY packages/ui/package.json packages/ui/pnpm-lock.yaml ./
  RUN npm install -g pnpm && pnpm install
  COPY packages/ui/ .
  RUN pnpm build

  # Stage 2: Rust Builder
  FROM rust:bookworm AS rust-builder
  # Install RISC Zero toolchain
  RUN cargo install rzup --locked && rzup install
  WORKDIR /build
  COPY packages/risc0-prover/ ./packages/risc0-prover/
  COPY packages/server/ ./packages/server/
  # Build server binary (includes prover)
  RUN cargo build --release --manifest-path packages/server/Cargo.toml

  # Stage 3: Runtime
  FROM debian:bookworm-slim
  RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
  # Copy RISC Zero toolchain (for local Groth16)
  COPY --from=rust-builder /root/.risc0 /root/.risc0
  # Copy server binary
  COPY --from=rust-builder /build/target/release/shadow-server /app/shadow-server
  # Copy UI assets
  COPY --from=ui-builder /build/dist /app/ui

  # Publish circuit ID and chain metadata as Docker labels
  LABEL org.taikoxyz.shadow.circuit-id="0xd598228081d1cbc4817e7be03aad1a2fdf6f1bb26b75dae0cddf5e597bfec091"
  LABEL org.taikoxyz.shadow.chain-id="167013"
  LABEL org.taikoxyz.shadow.risc0-version="3.0.1"

  ENV RISC0_PROVER=local
  EXPOSE 3000
  ENTRYPOINT ["/app/shadow-server"]
  CMD ["--workspace", "/workspace", "--port", "3000", "--ui-dir", "/app/ui"]
  ```

### 3.2 Docker Compose for development

- [ ] Create `docker-compose.yml` for development:
  ```yaml
  services:
    shadow:
      build: .
      ports:
        - "3000:3000"
      volumes:
        - ./workspace:/workspace
      environment:
        - RPC_URL=https://rpc.hoodi.taiko.xyz
        - RUST_LOG=info
  ```

### 3.3 Verify no Docker-in-Docker

- [ ] Confirm RISC Zero Groth16 works with `RISC0_PROVER=local` and pre-installed `r0vm`
- [ ] If native Groth16 fails without DinD, implement two-phase approach:
  - Default to `succinct` receipt kind
  - Provide `compress` CLI command for users who have Docker available on host
  - Document the limitation
- [ ] Test proof generation inside container on:
  - x86_64 Linux
  - Apple Silicon (via Docker Desktop emulation)

### 3.4 CI/CD

- [ ] Update `.github/workflows/docker-publish.yml`:
  - Build new all-in-one image
  - Tag as `ghcr.io/taikoxyz/taiko-shadow:local`
  - Keep existing prover-only image build as separate workflow/tag if needed
  - Multi-platform build considerations

---

## Phase 4: Integration & File Convention

### 4.1 File naming conventions

- [ ] Deposit files: `deposit-<first4hex>-<last4hex>-<YYYYMMDDTHHMMSS>.json`
  - Example: `deposit-ffe8-fde9-20260224T214613.json`
  - Timestamp is UTC creation time
- [ ] Proof files: `<deposit-stem>.proof-<YYYYMMDDTHHMMSS>.json` (two timestamps: deposit creation + proof generation)
  - Example: `deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json`
  - Contains proofs for ALL notes in the deposit (single bundled file)
- [ ] Backend scanner matches proof to deposit via `<deposit-stem>.proof-*.json` glob pattern
- [ ] Backend also supports legacy naming (`note-<index>.proof.json`) via `depositFile` field in proof JSON
- [ ] Proof generation always uses new naming convention

### 4.2 Workspace validation on startup

- [ ] On server start:
  - Validate workspace directory exists and is writable
  - Scan and index all deposit/proof files
  - Log summary: "Found N deposit files, M proof files"
  - Warn about orphaned proof files (no matching deposit)
- [ ] Periodic re-scan (configurable interval, or triggered by file watcher)

### 4.3 Deposit creation via backend

- [ ] `POST /api/deposits` — Create new deposit via backend:
  - Accept `{ chainId, notes: [{recipient, amount, label}] }` in body
  - Mine PoW-valid secret (in Rust — port from `mine-deposit.mjs`)
  - Save deposit file to workspace
  - Return created deposit details

---

## Phase 5: Testing

### 5.1 Unit tests — Rust backend

- [ ] `workspace::scanner` tests:
  - Scan empty directory → empty list
  - Scan with valid deposit files → correct count
  - Scan with deposit + matching proof file → correct 1:1 association
  - Scan with orphaned proof files → proofs ignored
  - Scan with invalid deposit JSON → file skipped
  - Scan with legacy per-note proof naming → correct association via `depositFile` field
  - Scan with mixed naming conventions → all files found
  - Deposit files with timestamps parsed correctly from filenames

- [ ] `workspace::deposit_file` tests:
  - Parse valid v2 deposit → correct fields
  - Parse deposit with missing fields → error
  - Parse deposit with invalid schema → error
  - Derive target address matches known test vector
  - Derive nullifiers for all notes match known test vectors
  - Filename generation includes correct timestamp and hex identifiers

- [ ] `workspace::proof_file` tests:
  - Parse valid bundled proof file → correct fields for all notes
  - Parse proof with missing notes → error
  - Note count in proof matches deposit note count
  - Extract per-note nullifiers correctly
  - Proof file references correct deposit filename

- [ ] `prover::pipeline` tests:
  - Build claim input from deposit + block data → correct structure
  - Block header RLP encoding matches JS implementation (cross-validate)
  - Account proof parsing
  - Pipeline produces bundled proof with all notes
  - (Integration: actual proof generation — see E2E tests)

- [ ] `prover::queue` tests:
  - Submit job → job becomes `running`
  - Submit second job while first running → second waits or returns "busy"
  - Complete job → status becomes `completed`, proof file written
  - Cancel running job → status becomes `cancelled`, no partial proof file
  - Queue empty after completion

- [ ] `chain::shadow_contract` tests:
  - Parse image ID from contract call result
  - Parse nullifier consumed status
  - Cache respects TTL
  - Force refresh bypasses cache

- [ ] `routes::*` tests:
  - Each endpoint returns correct status codes
  - Invalid deposit ID → 404
  - Delete non-existent file → 404
  - Proof generation for non-existent deposit → 400
  - Health check → 200

### 5.2 Unit tests — UI

- [ ] API client tests (mock fetch):
  - `getDeposits()` returns parsed deposit list with timestamps
  - `startProof(depositId)` sends correct POST (proves all notes)
  - `deleteDeposit()` sends correct DELETE request
  - `deleteProof(depositId)` deletes single proof file
  - Error handling (network error, 404, 500)

- [ ] Component tests (if using Preact):
  - `DepositList` renders correct number of rows
  - `DepositDetail` shows all notes
  - Status badges show correct colors/text
  - Delete button shows confirmation dialog

### 5.3 Integration tests — Backend

- [ ] API integration tests (start real server, hit endpoints):
  - Create workspace with test fixtures (deposit files, proof files)
  - `GET /api/deposits` returns correct list with timestamps and proof status
  - `GET /api/deposits/:id` returns correct detail with all notes
  - `DELETE /api/deposits/:id` removes deposit file from disk
  - `DELETE /api/deposits/:id?include_proof=true` removes deposit and its proof file
  - `DELETE /api/deposits/:id/proof` removes the proof file only
  - `GET /api/config` returns circuit ID and chain config
  - Static file serving returns UI HTML
  - WebSocket connection and event delivery

- [ ] Workspace watcher integration:
  - Create file in workspace → API reflects change
  - Delete file from workspace → API reflects change

### 5.4 E2E tests

#### E2E Test 1: Full lifecycle (mock prover)

- [ ] Start Docker container with test workspace
- [ ] Pre-seed workspace with a deposit file (with timestamp in filename)
- [ ] Open UI in headless browser (Playwright or similar)
- [ ] Verify deposit appears in list view with correct timestamp
- [ ] Click deposit → detail view shows all notes
- [ ] Trigger proof generation (mock prover for speed) — proves all notes at once
- [ ] Verify single proof file appears in workspace (`<deposit-stem>.proof.json`)
- [ ] Verify UI updates in real-time via WebSocket (per-note progress)
- [ ] Delete proof file via UI
- [ ] Verify proof file removed from workspace, deposit still present
- [ ] Delete deposit via UI
- [ ] Verify deposit file and any associated proof removed

#### E2E Test 2: Proof generation pipeline (real prover, test mode)

- [ ] Use a pre-funded target address on Hoodi testnet
- [ ] Create deposit file with known target and timestamp in name
- [ ] Start server with `--rpc-url https://rpc.hoodi.taiko.xyz`
- [ ] Trigger proof generation via API — all notes proved in one job
- [ ] Wait for completion (may take minutes)
- [ ] Verify single proof file contains proofs for all notes
- [ ] Verify each note's proof is valid (can be verified off-chain)
- [ ] Verify proof file name is `<deposit-stem>.proof.json`

#### E2E Test 3: Docker container lifecycle

- [ ] Build Docker image
- [ ] Run container with bind-mounted workspace
- [ ] Verify UI is accessible at `http://localhost:3000`
- [ ] Verify API responds at `http://localhost:3000/api/health`
- [ ] Verify workspace files are visible from both host and container
- [ ] Stop container, restart → verify state persists (workspace files)
- [ ] Verify no Docker-in-Docker: container runs without Docker socket mount

#### E2E Test 4: Multi-deposit management

- [ ] Seed workspace with 3 deposit files (timestamped names), varying proof states
- [ ] Verify list view shows all 3 with correct statuses and timestamps
- [ ] Generate proofs for first deposit (all notes)
- [ ] Verify only that deposit gets a proof file
- [ ] Delete second deposit and its proof
- [ ] Verify second deposit removed, first and third unaffected
- [ ] Verify orphaned proof files (if any) are ignored

#### E2E Test 5: On-chain status checking

- [ ] Use deposit with known claimed nullifier on Hoodi
- [ ] Start server, open detail view
- [ ] Verify claim status shows "Claimed" for consumed nullifier
- [ ] Verify claim status shows "Unclaimed" for unused nullifier
- [ ] Click "Refresh" → verify fresh on-chain query is made
- [ ] Verify cache behavior (second check within TTL returns cached result)

#### E2E Test 6: Cross-platform Docker

- [ ] Build and test on x86_64 Linux
- [ ] Build and test on Apple Silicon macOS (via Docker Desktop emulation)
- [ ] Verify UI loads and API works on both
- [ ] Verify proof generation works (with emulation perf penalty on ARM)

---

## Phase 6: Documentation & Cleanup

### 6.1 Documentation updates

- [ ] Update `README.md`:
  - New "Quick Start" section for Docker-based usage
  - `docker run` command for local mode
  - Screenshot of new UI
  - Keep CLI usage for advanced users
- [ ] Update `DEPLOYMENT.md`:
  - Add Docker image tags for local mode
- [ ] Create `packages/server/README.md`:
  - Server architecture
  - API reference
  - Configuration options
  - Development setup
- [ ] Update `packages/ui/README.md`:
  - New UI architecture
  - Component overview
  - Development workflow
- [ ] Update `packages/risc0-prover/docker/README.md`:
  - Document old (prover-only) vs. new (all-in-one) Docker images
  - Migration guide
- [ ] Update `PRODUCT_INTRO.md`:
  - Simplified getting started with Docker
  - Updated screenshots/diagrams

### 6.2 Code cleanup

- [ ] **Remove existing UI styles entirely** — delete `packages/ui/src/style.css` and all inline styles from old `main.js`
- [ ] Remove duplicated crypto code between `mine-deposit.mjs`, `shadowcli.mjs`, and UI `main.js`
  - Consolidate into shared JS module (for any remaining JS usage)
  - Or deprecate JS implementations in favor of Rust backend
- [ ] Clean up legacy proof file naming references in documentation
- [ ] Remove unused Docker entrypoint (`entrypoint.sh`) if replaced by new image
  - Or keep for backward-compatible prover-only image
- [ ] Review and remove dead code in UI after redesign
- [ ] Replace all references to "image ID" with "circuit ID" in code, docs, and UI (where referring to the RISC Zero guest hash)
- [ ] Add `CLAUDE.md` to `packages/server/` with coding conventions
- [ ] Update root `package.json` scripts:
  - Add `server:build`, `server:dev` commands
  - Add `docker:build`, `docker:run` convenience commands

### 6.3 Backward compatibility

- [ ] Keep existing CLI tools (`shadowcli.mjs`, `mine-deposit.mjs`) working
- [ ] Keep existing `shadow-risc0-host` binary working
- [ ] Keep existing Docker prover image as a separate build target
- [ ] Document migration path from CLI workflow to Docker local mode

---

## Implementation Order & Dependencies

```
Phase 0 ──────────────────────────────────────────────────────
  0.2 Extract prover lib ─────────────┐
  0.3 Rust deposit utilities ─────────┤
                                      │
Phase 1 ──────────────────────────────┤───────────────────────
  1.1 Server skeleton ────────────────┤
  1.2 Static serving ─────────────────┤
  1.3 Workspace scanner ──────────────┤
  1.4 Deposit API ────────────────────┤
  1.5 Proof pipeline ─────────────────┤  (depends on 0.2, 0.3)
  1.6 On-chain queries ───────────────┤
  1.7 WebSocket ──────────────────────┘
                                      │
Phase 2 ──────────────────────────────┤───────────────────────
  2.1-2.8 UI Redesign ───────────────┘  (depends on Phase 1 APIs)
                                      │
Phase 3 ──────────────────────────────┤───────────────────────
  3.1-3.4 Docker image ──────────────┘  (depends on Phase 1 & 2)
                                      │
Phase 4 ──────────────────────────────┤───────────────────────
  4.1-4.3 Integration ───────────────┘  (depends on Phase 1)
                                      │
Phase 5 ──────────────────────────────┤───────────────────────
  5.1-5.4 Testing ───────────────────┘  (continuous, formal after Phase 3)
                                      │
Phase 6 ──────────────────────────────┘───────────────────────
  6.1-6.3 Documentation & Cleanup       (final)
```

### Parallelizable work:
- Phase 2 (UI) can proceed in parallel with Phase 1.5-1.7 (prover pipeline, on-chain, WebSocket) once Phase 1.1-1.4 (server skeleton, workspace, deposit API) are done.
- Phase 5 unit tests should be written alongside each phase.
- Phase 3 (Docker) can start once Phase 1 and Phase 2 are feature-complete.

---

## Risk Mitigation Checkpoints

### Checkpoint 1 (after Phase 0)
- [ ] Verify `shadow-prover-lib` works correctly by running existing tests
- [ ] Verify host CLI still works after refactoring

### Checkpoint 2 (after Phase 1.1-1.4)
- [ ] Verify server starts, serves health check, lists deposits from a test workspace
- [ ] Verify CRUD operations on deposit/proof files work correctly

### Checkpoint 3 (after Phase 1.5)
- [ ] Verify proof generation works in-process from the backend
- [ ] Verify no Docker-in-Docker is needed for at least `succinct` receipt kind
- [ ] Measure proof generation performance vs. current CLI

### Checkpoint 4 (after Phase 2)
- [ ] Verify UI renders deposit list and detail views
- [ ] Verify WebSocket updates work end-to-end
- [ ] Verify delete operations work through UI → backend → filesystem

### Checkpoint 5 (after Phase 3)
- [ ] Verify Docker image builds successfully
- [ ] Verify container starts and serves UI + API
- [ ] Verify proof generation works inside container
- [ ] Verify workspace bind mount works correctly

---

## Open Questions / Decisions Needed

1. **Groth16 without DinD:** Can we include RISC Zero's Groth16 prover dependencies directly in the Docker image? If not, should we default to succinct proofs and document a separate compression step?

2. **UI framework:** Preact vs. vanilla JS? Preact adds ~3KB but provides a much better component model for the expanded UI. Recommend Preact.

3. **File watcher:** Should the backend actively watch the workspace with `notify` crate, or just re-scan on API requests? Active watching is more responsive but adds complexity.

4. **Deposit creation:** Should the backend support creating new deposit files (mining PoW), or should that remain a UI/CLI-only feature? Including it in the backend enables a fully self-contained Docker experience.

5. **Claim submission:** Should the backend support submitting claim transactions (requires private key), or should claims remain a UI-only feature via MetaMask? Recommend keeping claims as UI-only (wallet-based) for security.

6. **Multiple receipt kinds:** Should the UI expose receipt kind selection (composite/succinct/groth16), or should the backend default to groth16 and hide the complexity?

---

## Terminology Reference

| Term | Meaning | Where used |
|------|---------|-----------|
| **Circuit ID** | RISC Zero guest program hash (`bytes32`). The on-chain verifier checks proofs against this. | On-chain (`Risc0CircuitVerifier.imageId()`), backend config, UI header |
| **Docker image digest** | SHA-256 digest of the published Docker container image. | GHCR, Docker pull commands |
| **Deposit file** | JSON file containing secret, notes, and target address. | Workspace filesystem |
| **Proof file** | JSON file containing bundled ZK proofs for all notes in a deposit. | Workspace filesystem |
| **Workspace** | Host directory bind-mounted into the Docker container. | Docker `-v` mount |
