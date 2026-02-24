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
  - `derive_deposit_info(deposit: &DepositFile) -> DerivedInfo` (target address, nullifiers, etc.)
- [ ] Port JSON schema validation from JS to Rust (or use `jsonschema` crate)
- [ ] Port RPC input construction logic (currently in `shadowcli.mjs`) to Rust:
  - `fetch_block_data(rpc_url, block_tag) -> Result<BlockData>`
  - `fetch_account_proof(rpc_url, address, block) -> Result<AccountProof>`
  - `build_claim_input(deposit, note_index, block_data, account_proof) -> Result<ClaimInput>`

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
  - Scan directory for files matching `deposit-*.json`
  - Validate each file against deposit schema
  - For each valid deposit, find matching proof files: `<deposit-stem>.note-<N>.proof.json`
  - Also support legacy naming: `note-<N>.proof.json` (correlate via `depositFile` field in proof JSON)
  - Ignore proof files without corresponding deposit files
  - Return structured workspace index
- [ ] Implement `workspace::deposit_file`:
  - Parse deposit JSON
  - Extract metadata (chainId, notes count, target address, total amount)
  - Derive all note nullifiers
- [ ] Implement `workspace::proof_file`:
  - Parse proof JSON
  - Extract metadata (noteIndex, blockNumber, nullifier)
  - Validate proof structure

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
      "proofCount": 1,
      "claimStatus": "partial"
    }
  ]
  ```
- [ ] `GET /api/deposits/:id` — Full deposit details including derived info
- [ ] `DELETE /api/deposits/:id` — Delete deposit file and optionally its proofs
  - Query param `?include_proofs=true` to also delete associated proof files
- [ ] `DELETE /api/deposits/:id/proofs/:noteIndex` — Delete specific proof file

### 1.5 Proof generation pipeline

- [ ] Implement `prover::queue`:
  - Single-slot queue using `tokio::sync::mpsc` (capacity 1)
  - Job struct: `{ deposit_id, note_index, status, progress }`
  - States: `queued`, `running`, `completed`, `failed`, `cancelled`
  - Only one proof generates at a time
- [ ] Implement `prover::pipeline`:
  - Accept `(deposit_path, note_index, rpc_url)` as input
  - Load and validate deposit file
  - Derive target address, nullifier, amounts
  - Fetch latest block via RPC
  - Fetch `eth_getProof` for target address
  - Build `ClaimInput`
  - Call `shadow-prover-lib::prove_claim()` in a `tokio::task::spawn_blocking` (CPU-intensive)
  - Export proof
  - Save proof file as `<deposit-stem>.note-<noteIndex>.proof.json` in workspace
  - Report progress via WebSocket broadcast channel
- [ ] Implement `prover::rpc`:
  - JSON-RPC client using `reqwest` or `alloy`
  - `eth_getBlockByNumber`
  - `eth_getProof`
  - `eth_chainId`
  - Block header RLP encoding (port from `shadowcli.mjs`)
- [ ] API endpoints:
  - `POST /api/deposits/:id/prove/:noteIndex` — Queue proof generation
  - `GET /api/queue` — Get queue status (current job, pending)
  - `DELETE /api/queue/current` — Cancel running job (best-effort)

### 1.6 On-chain status queries

- [ ] Implement `chain::shadow_contract`:
  - Read `Risc0CircuitVerifier.imageId()` → `bytes32`
  - Read `Shadow.isConsumed(nullifier)` → `bool` for each note
  - Cache results with TTL (configurable, default 5 minutes)
- [ ] API endpoints:
  - `GET /api/config` — Returns image ID, chain config, server info
  - `POST /api/deposits/:id/notes/:noteIndex/refresh` — Force refresh nullifier status
  - `GET /api/deposits/:id/notes/:noteIndex/status` — Get cached claim status

### 1.7 WebSocket support

- [ ] Implement `ws.rs`:
  - `GET /ws` — WebSocket upgrade
  - Broadcast channel for proof generation events
  - Events:
    ```json
    { "type": "proof:started", "depositId": "...", "noteIndex": 0 }
    { "type": "proof:progress", "depositId": "...", "noteIndex": 0, "message": "Fetching block data..." }
    { "type": "proof:completed", "depositId": "...", "noteIndex": 0, "proofFile": "..." }
    { "type": "proof:failed", "depositId": "...", "noteIndex": 0, "error": "..." }
    { "type": "workspace:changed" }
    ```
  - Notify on workspace file changes (deposit/proof created/deleted)

---

## Phase 2: UI Redesign

### 2.1 UI architecture

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
    - `getDeposits()`, `getDeposit(id)`, `deleteDeposit(id, includeProofs)`
    - `deleteProof(depositId, noteIndex)`
    - `startProof(depositId, noteIndex)`
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
    - Chain ID
    - Total amount (formatted ETH)
    - Note count
    - Target address (truncated with copy button)
    - Status badges: "No proofs", "1/2 proved", "All proved", "Claimed"
  - Actions per row:
    - Delete deposit (with confirmation)
    - Delete all proofs for deposit
  - Auto-refresh when WebSocket sends `workspace:changed`

### 2.4 Detail view

- [ ] Implement `DepositDetail.js`:
  - Header: filename, chainId, target address (full, copyable)
  - Deposit metadata: version, total amount, creation date (from filename)
  - Notes table:

    | # | Recipient | Amount | Label | Proof | Claim Status | Actions |
    |---|-----------|--------|-------|-------|-------------|---------|
    | 0 | 0xabc...def | 0.001 ETH | note #0 | Ready | Unclaimed | [Generate] [Delete Proof] |
    | 1 | 0x123...789 | 0.002 ETH | note #1 | Missing | — | [Generate] |

  - Proof status: "Missing", "Generating...", "Ready"
  - Claim status: "Unclaimed", "Claimed", "Unknown" + [Refresh] button
  - Actions per note:
    - Generate proof (disabled if proof exists or generation in progress)
    - Delete proof (disabled if no proof)
    - Refresh claim status (force on-chain check)
  - Back button to return to list view

### 2.5 Proof generation progress

- [ ] Implement `ProofProgress.js`:
  - Shows when a proof is being generated
  - Real-time progress messages via WebSocket
  - Progress stages: "Fetching block data", "Building input", "Running prover", "Exporting proof"
  - Estimated progress (if measurable)
  - Cancel button

### 2.6 Header / status bar

- [ ] Implement `Header.js`:
  - Image ID display (from `GET /api/config`)
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

### 4.1 Proof file naming convention

- [ ] Implement new naming: `<deposit-stem>.note-<index>.proof.json`
  - Example: `deposit-ffe8-fde9-20260224T214613.note-0.proof.json`
- [ ] Backend scanner supports both new and legacy (`note-<index>.proof.json`) naming
- [ ] Proof generation always uses new naming
- [ ] Legacy proof files are still recognized via `depositFile` field in proof JSON

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
  - Scan with deposit + matching proofs → correct association
  - Scan with orphaned proofs → proofs ignored
  - Scan with invalid deposit JSON → file skipped
  - Scan with legacy proof naming → correct association via `depositFile` field
  - Scan with mixed naming conventions → all files found

- [ ] `workspace::deposit_file` tests:
  - Parse valid v2 deposit → correct fields
  - Parse deposit with missing fields → error
  - Parse deposit with invalid schema → error
  - Derive target address matches known test vector
  - Derive nullifiers match known test vectors

- [ ] `workspace::proof_file` tests:
  - Parse valid proof file → correct fields
  - Parse proof with missing fields → error
  - Extract noteIndex correctly
  - Extract nullifier correctly

- [ ] `prover::pipeline` tests:
  - Build claim input from deposit + block data → correct structure
  - Block header RLP encoding matches JS implementation (cross-validate)
  - Account proof parsing
  - (Integration: actual proof generation — see E2E tests)

- [ ] `prover::queue` tests:
  - Submit job → job becomes `running`
  - Submit second job while first running → second waits or returns "busy"
  - Complete job → status becomes `completed`
  - Cancel running job → status becomes `cancelled`
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
  - `getDeposits()` returns parsed deposit list
  - `startProof()` sends correct POST request
  - `deleteDeposit()` sends correct DELETE request
  - Error handling (network error, 404, 500)

- [ ] Component tests (if using Preact):
  - `DepositList` renders correct number of rows
  - `DepositDetail` shows all notes
  - Status badges show correct colors/text
  - Delete button shows confirmation dialog

### 5.3 Integration tests — Backend

- [ ] API integration tests (start real server, hit endpoints):
  - Create workspace with test fixtures (deposit files, proof files)
  - `GET /api/deposits` returns correct list
  - `GET /api/deposits/:id` returns correct detail
  - `DELETE /api/deposits/:id` removes file from disk
  - `DELETE /api/deposits/:id/proofs/:noteIndex` removes proof file
  - `GET /api/config` returns image ID
  - Static file serving returns UI HTML
  - WebSocket connection and event delivery

- [ ] Workspace watcher integration:
  - Create file in workspace → API reflects change
  - Delete file from workspace → API reflects change

### 5.4 E2E tests

#### E2E Test 1: Full lifecycle (mock prover)

- [ ] Start Docker container with test workspace
- [ ] Pre-seed workspace with a deposit file
- [ ] Open UI in headless browser (Playwright or similar)
- [ ] Verify deposit appears in list view
- [ ] Click deposit → detail view shows notes
- [ ] Trigger proof generation (mock prover for speed)
- [ ] Verify proof file appears in workspace
- [ ] Verify UI updates in real-time via WebSocket
- [ ] Delete proof file via UI
- [ ] Verify file removed from workspace
- [ ] Delete deposit via UI
- [ ] Verify all associated files removed

#### E2E Test 2: Proof generation pipeline (real prover, test mode)

- [ ] Use a pre-funded target address on Hoodi testnet
- [ ] Create deposit file with known target
- [ ] Start server with `--rpc-url https://rpc.hoodi.taiko.xyz`
- [ ] Trigger proof generation via API
- [ ] Wait for completion (may take minutes)
- [ ] Verify proof file is valid (can be verified off-chain)
- [ ] Verify proof file name matches convention

#### E2E Test 3: Docker container lifecycle

- [ ] Build Docker image
- [ ] Run container with bind-mounted workspace
- [ ] Verify UI is accessible at `http://localhost:3000`
- [ ] Verify API responds at `http://localhost:3000/api/health`
- [ ] Verify workspace files are visible from both host and container
- [ ] Stop container, restart → verify state persists (workspace files)
- [ ] Verify no Docker-in-Docker: container runs without Docker socket mount

#### E2E Test 4: Multi-deposit management

- [ ] Seed workspace with 3 deposit files, varying proof states
- [ ] Verify list view shows all 3 with correct statuses
- [ ] Generate proof for one note on first deposit
- [ ] Verify only that deposit's proof count changes
- [ ] Delete second deposit and its proofs
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

- [ ] Remove duplicated crypto code between `mine-deposit.mjs`, `shadowcli.mjs`, and UI `main.js`
  - Consolidate into shared JS module (for any remaining JS usage)
  - Or deprecate JS implementations in favor of Rust backend
- [ ] Clean up legacy proof file naming references in documentation
- [ ] Remove unused Docker entrypoint (`entrypoint.sh`) if replaced by new image
  - Or keep for backward-compatible prover-only image
- [ ] Review and remove dead code in UI after redesign
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
