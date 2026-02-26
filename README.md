# Shadow Protocol

Privacy-preserving ETH claims on Taiko L2 using zero-knowledge proofs.

## Quick Start

```bash
./start.sh
```

Or run without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/taikoxyz/shadow/main/start.sh | sh
```

This will pull the Shadow Docker image (or build from source if unavailable), create a `./workspace` directory, start the server, and open **http://localhost:3000** in your browser.

Options:

| Flag | Description |
|------|-------------|
| `--pull` | Force pull the latest image from registry |
| `--build` | Force build the image from source |
| `--clean` | Delete all local shadow images and containers, then exit |
| `--verbose [level]` | Set verbosity level: `info` (default), `debug`, or `trace` |
| `[port]` | Pin to a specific port (default: auto-select from 3000-3099) |

```bash
./start.sh --pull              # force latest from registry
./start.sh --build             # build from source
./start.sh --build 3001        # build from source, use port 3001
./start.sh --clean             # remove all shadow images and containers
./start.sh --verbose           # info-level server logs + launcher details
./start.sh --verbose debug     # debug-level server logs
./start.sh --verbose trace     # trace-level server logs (full RPC payloads)
```

### Verbose & debugging

**`--verbose [level]`** enables detailed output at two layers:

**Launcher** (always shown when `--verbose` is used):
- Docker version, registry image, and expected circuit ID
- Circuit ID comparison during image validation
- Full `docker build` / `docker pull` output (normally suppressed)
- Image name, port mapping, and workspace mount before container start

**Server** (controlled by the level — sets `RUST_LOG` inside the container):

| Level | What it shows |
|-------|---------------|
| `info` (default) | Pipeline start/complete, block fetched, account proof fetched, note proving, queue events |
| `debug` | + RPC call timing, chain ID verification, ClaimInput details, proof sizes, queue progress |
| `trace` | + Full RPC request params and response payloads |

**Browser console** logging is separate and opt-in. Enable via `localStorage.setItem('shadow-debug', '1')` or add `?debug` to the URL. This logs API calls with timing and all WebSocket events.

The server provides:
- Web UI for managing deposits and proofs
- REST API + WebSocket for real-time updates
- In-process ZK proof generation (RISC Zero Groth16)

Place deposit files in `./workspace/` or create new deposits from the UI.

## Building the Docker Image

```bash
pnpm docker:build
```

This builds the image for `linux/amd64` (required by RISC Zero) and prints the circuit ID on success. On Apple Silicon, the build runs under emulation.

To run the built image:

```bash
pnpm docker:run
```

## Publishing Docker Image (Manual)

Docker publish is local-only. `pnpm docker:publish` does not use GitHub Actions.
It reuses a local image if present; otherwise it builds locally, then pushes to GHCR.

```bash
# publish using default tag "latest"
pnpm docker:publish
```

Optional args:

```bash
# publish with an explicit tag (pnpm forwards args after `--`)
pnpm docker:publish -- latest

# publish with a custom tag
pnpm docker:publish -- dev

# publish to a custom registry (default: ghcr.io)
REGISTRY=ghcr.io pnpm docker:publish -- dev

# force rebuilding by removing the cached local image
docker image rm shadow-local:latest
```

Prerequisites:
- `gh auth status` is authenticated for the target org/repo
- token has `read:packages` and `write:packages` scopes

## Local Development (without Docker)

### Prerequisites

- Rust toolchain (1.80+)
- Node.js 20+ with pnpm
- Foundry (for contract tests)
- RISC Zero toolchain (only for proving): `cargo install rzup --locked && rzup install`

### Option A: Without proving (UI/API dev only)

```bash
mkdir -p workspace

# Terminal 1 — server on :3000
cargo run --manifest-path packages/server/Cargo.toml -- \
  --workspace ./workspace \
  --port 3000

# Terminal 2 — UI dev server on :5173 (proxies API/WS to :3000)
pnpm ui:dev
```

Open **http://localhost:5173**.

### Option B: With ZK proving (full flow)

```bash
mkdir -p workspace

# Terminal 1 — server on :3000 with proving enabled
cargo run --release --manifest-path packages/server/Cargo.toml --features prove -- \
  --workspace ./workspace \
  --port 3000 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --shadow-address 0x77cdA0575e66A5FC95404fdA856615AD507d8A07

# Terminal 2 — UI dev server on :5173 (proxies API/WS to :3000)
pnpm ui:dev
```

Open **http://localhost:5173**.

The server will warn on startup if the local circuit ID doesn't match the on-chain verifier — this is expected when building locally. You can still prove; just redeploy the verifier before submitting on-chain.

To check your local circuit ID:

```bash
cargo run --manifest-path packages/risc0-prover/Cargo.toml -p shadow-risc0-host -- circuit-id
```

### 2. Create a deposit

From the UI, click **+ New Deposit** and fill in:
- **Recipient**: the Ethereum address that will claim the ETH
- **Amount**: amount in wei (e.g. `1000000000000000` = 0.001 ETH)

Or via the API:
```bash
curl -X POST http://localhost:3000/api/deposits \
  -H 'Content-Type: application/json' \
  -d '{"chainId":"167013","notes":[{"recipient":"0xYourAddress","amount":"1000000000000000","label":"my note"}]}'
```

Deposit creation is instant (generates a random secret and derives a target address).

### 3. Fund the target address

Send ETH to the `targetAddress` shown in the deposit. The total amount must cover all notes plus a 0.1% claim fee.

```bash
cast send <targetAddress> \
  --value <totalAmount> \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0x...
```

### 4. Generate proof

From the UI, click **Generate Proof** on the deposit detail page.
Or via API: `POST /api/deposits/{id}/prove`

### 5. Claim on-chain

From the UI, click **Claim** next to each note (requires MetaMask connected to Taiko Hoodi).

## Server API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/config` | Server configuration |
| GET | `/api/deposits` | List all deposits |
| GET | `/api/deposits/:id` | Get deposit details |
| POST | `/api/deposits` | Create a new deposit |
| DELETE | `/api/deposits/:id` | Delete deposit file |
| POST | `/api/deposits/:id/prove` | Start proof generation |
| DELETE | `/api/deposits/:id/proof` | Delete proof file |
| GET | `/api/deposits/:id/notes/:idx/claim-tx` | Get claim tx calldata for MetaMask |
| POST | `/api/deposits/:id/notes/:idx/refresh` | Refresh on-chain claim status |
| GET | `/api/queue` | Proof generation queue status |
| DELETE | `/api/queue/current` | Cancel current proof job |
| WS | `/ws` | Real-time events (workspace changes, proof progress) |

## Deployed Contracts (Taiko Hoodi)

| Contract | Address |
|----------|---------|
| Shadow (proxy) | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` |
| ShadowVerifier | `0xA3291dF14D09f71151a0a0b2E732DC26be21CDcD` |
| Risc0CircuitVerifier | `0x9A4D9720E9ec87b7C9E5f5F8Fb1b083B4D6e5b29` |
| RiscZeroGroth16Verifier | `0xd1934807041B168f383870A0d8F565aDe2DF9D7D` |
| DummyEtherMinter | `0x6DC226aA43E86fE77735443fB50a0A90e5666AA4` |

Circuit ID (imageId): `0xac4b31fadeb0115a1e6019c8bccc0ddf900fe6e40a447409d9ce6b257913dcbc`
Chain ID: `167013` (Taiko Hoodi testnet)

## Architecture

```
                     +-----------+
                     |  Web UI   |
                     |  (Vite)   |
                     +-----+-----+
                           |
                     REST + WebSocket
                           |
                     +-----v-----+
                     |  Server   |  shadow-server (Axum)
                     |  (Rust)   |  - deposit creation
                     +-----+-----+  - proof generation (RISC Zero)
                           |        - workspace file management
                     +-----v-----+  - on-chain queries (RPC)
                     |  Shadow   |
                     | Contract  |  UUPS proxy on Taiko L2
                     +-----------+  - ZK proof verification
                                    - nullifier tracking
                                    - ETH claiming (0.1% fee)
```

## Project Structure

```
packages/
  contracts/     Solidity contracts (Foundry)
  server/        Rust backend (Axum)
  ui/            Web frontend (Vite, vanilla JS)
  risc0-prover/  ZK prover (RISC Zero)
    crates/
      shadow-proof-core/   Cryptographic primitives
      shadow-prover-lib/   Prover pipeline library
    guest/                 ZK circuit (runs inside zkVM)
    methods/               Compiled guest methods
docker/
  Dockerfile     Multi-stage build (UI + server + prover)
```

## Documentation

- [Protocol Specification](PRD.md)
- [Privacy Model](PRIVACY.md)
- [Deployments](DEPLOYMENT.md)
- [Contracts](packages/contracts/README.md)

## Testing

```bash
# Contract tests (54 tests including Groth16 verification)
cd packages/contracts && forge test -vvv

# Server tests (15 tests)
cd packages/server && cargo test

# Prover core tests
cd packages/risc0-prover && cargo test -p shadow-proof-core
```

## Security

For security concerns, contact security@taiko.xyz
