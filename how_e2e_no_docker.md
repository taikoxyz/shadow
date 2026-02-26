# Shadow E2E Testing — No Docker

Run the Rust backend and Vite dev server directly on your machine. No Docker build required.
Hot-reloading UI, fast Rust incremental builds.

## Prerequisites

- Rust toolchain (`rustup`) — https://rustup.rs
- Node.js 18+ and pnpm (`npm install -g pnpm`)
- A funded wallet on Taiko Hoodi (chain ID 167013) for on-chain steps
- `cast` CLI (from Foundry) — optional, for sending transactions without MetaMask

> **Proof generation without Docker** requires the RISC Zero toolchain (see Step 5b). For testing everything else (mining, balance checks, UI, MetaMask claim) you can skip it and use the `--no-prove` mode.

---

## 1. Build the Rust server (no proof feature = fast)

```bash
cd /Users/d/Projects/taiko/shadow

cargo build --manifest-path packages/server/Cargo.toml
```

This takes 1-2 minutes the first time. Incremental rebuilds are a few seconds.

This build does **not** include real ZK proof generation (`--features prove` is omitted). You can still:
- Mine deposits
- Check ETH balances
- Download/upload deposit files
- Track on-chain claim status
- Test all UI flows

---

## 2. Create a workspace directory

```bash
mkdir -p workspace
```

---

## 3. Start the Rust backend

```bash
RPC_URL=https://rpc.hoodi.taiko.xyz \
SHADOW_ADDRESS=0x77cdA0575e66A5FC95404fdA856615AD507d8A07 \
VERIFIER_ADDRESS=0xF28B5F2850eb776058566A2945589A6A1Fa98e28 \
RUST_LOG=shadow_server=info \
cargo run --manifest-path packages/server/Cargo.toml -- \
  --workspace ./workspace \
  --port 3000 \
  --ui-dir packages/ui/dist
```

The server starts on **http://localhost:3000**.

> `--ui-dir packages/ui/dist` is for the built UI. When using the Vite dev server (step 4) you don't need the built UI — the Vite proxy handles it.

Leave this terminal running.

---

## 4. Start the UI dev server (in a second terminal)

```bash
cd /Users/d/Projects/taiko/shadow/packages/ui
pnpm install   # first time only
pnpm dev
```

Open **http://localhost:5173** in your browser.

The Vite dev server proxies `/api` and `/ws` to the Rust backend on port 3000, so the UI and backend are fully connected. Changes to `src/` files hot-reload instantly.

---

## 5. E2E walkthrough

### 5a. Mine a deposit

**UI:** Click "+ New Deposit", fill in:
- Recipient: any Hoodi address (yours or a test address)
- Amount: e.g. `0.001` (ETH)
- Comment: optional description

Click "Mine Deposit". Takes 3–10 seconds server-side.

**curl:**
```bash
curl -X POST http://localhost:3000/api/deposits \
  -H 'Content-Type: application/json' \
  -d '{
    "chainId": "167013",
    "notes": [{"recipient": "0xYOUR_ADDRESS", "amount": "1000000000000000"}],
    "comment": "test deposit"
  }'
```

### 5b. Fund the deposit

The deposit detail page shows "Funding Status" with the required amount and current balance.

**UI:** Click "Fund Deposit" (requires MetaMask on Taiko Hoodi, chain 167013).

**cast:**
```bash
cast send <targetAddress> \
  --value <requiredWei> \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0xYOUR_PRIVATE_KEY
```

The balance section updates automatically after ~6 seconds.

### 5c. Generate a proof

> **Real proof generation** requires `--features prove` build and the RISC Zero toolchain.
> Skip to 5d to test claim if you already have a proof file from Docker.

To build with proof support:

```bash
# Install RISC Zero toolchain (one-time, ~5 min)
cargo install rzup --locked
rzup install

# Build with proof generation
cargo build \
  --manifest-path packages/server/Cargo.toml \
  --features prove

# Restart the server (same command as step 3, but now it proves)
```

Then click "Generate Proof" in the UI. Watch server logs for progress.

### 5d. Import an existing proof (no re-prove needed)

If you already have a proof file from Docker or a previous run, import it:

**UI:** On the deposit detail page, click "Download Proof" / "Download Deposit" to grab files.

Or, copy proof files directly into `./workspace/`:
```bash
cp path/to/deposit-*.proof-*.json ./workspace/
```

The UI auto-detects new files via WebSocket events.

### 5e. Claim on-chain

**UI:** Connect MetaMask (Taiko Hoodi, chain 167013), click "Claim" next to a note.

**curl + cast:**
```bash
# Get claim calldata
curl http://localhost:3000/api/deposits/<DEPOSIT_ID>/notes/0/claim-tx

# Submit
cast send <to> --data <data> \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0xYOUR_PRIVATE_KEY
```

---

## Useful commands

| Command | Purpose |
|---------|---------|
| `curl localhost:3000/api/health` | Health check |
| `curl localhost:3000/api/config` | Server config (RPC, circuit ID, addresses) |
| `curl localhost:3000/api/deposits` | List all deposits |
| `curl localhost:3000/api/deposits/<id>/balance` | Check funding status |
| `curl localhost:3000/api/queue` | Current proof job status |

## Troubleshooting

- **"Module not found" on pnpm dev**: Run `pnpm install` first.
- **UI shows "Reconnecting..."**: Backend isn't running. Start it (step 3) first, then refresh.
- **Balance shows 0**: Wait for the RPC call to complete, or click refresh on the balance section.
- **Proof fails with "prove feature not enabled"**: You need the `--features prove` build (step 5c).
- **Port 3000 already in use**: Kill the existing process with `lsof -ti:3000 | xargs kill`.
