# Shadow UI

Workspace manager for Shadow deposit and proof files. Talks to the `shadow-server` backend via REST API and WebSocket — all proof generation, workspace scanning, and on-chain queries are handled server-side.

## Run

```bash
pnpm install
pnpm ui:dev       # dev server on :5173 (proxies API/WS to backend on :3000)
pnpm ui:build     # production build
pnpm ui:preview   # preview production build
```

## Architecture

Vanilla JS + Vite. No framework dependencies. CSS custom properties for light/dark theming (persisted in `localStorage`). URL hash routing (`#/deposit/:id`, `#/settings`) survives page refresh.

### Views

- **List view** (`#/`): shows all deposits as cards with status badges (New / Funding / Funded / Proving / Proved / Partial / Claimed). Toolbar with "New Deposit" form and "Import Deposit" file picker.
- **Detail view** (`#/deposit/:id`): deposit metadata, funding status with a "Fund Deposit" button (sends ETH via MetaMask), proof generation controls, and a notes table with per-note claim buttons and on-chain status refresh.
- **Settings** (`#/settings`): RPC endpoint override, light/dark theme toggle, server info (version, contract address, circuit ID), debug logging toggle.

### Real-time updates

WebSocket connection to the backend delivers proof progress events (`proof:started`, `proof:note_progress`, `proof:completed`, `proof:failed`) and workspace change notifications. A global proof banner shows live status with an expandable log, elapsed timer, and kill button. Fallback polling every 5 seconds.

### Key interactions

- **Create deposit**: inline form with 1-5 recipient notes (address, amount, optional label), comment field, client-side validation (address format, amount bounds, 8 ETH total cap).
- **Fund deposit**: checks on-chain balance via backend RPC, shows required/balance/due amounts, sends exact funding amount through MetaMask with automatic chain switching.
- **Generate proof**: triggers server-side RISC Zero proof generation. Circuit ID mismatch between local prover and on-chain verifier is detected and blocks proof/fund actions.
- **Claim note**: fetches calldata from backend, submits `claim` tx via MetaMask, refreshes on-chain status after confirmation.
- **File management**: view, download, and delete deposit/proof JSON files. Import existing deposit files.

## Tech stack

- **Vanilla JS** — no React/Vue/Angular; DOM built with a lightweight `el()` helper
- **Vite** — dev server with proxy, production bundler
- **CSS custom properties** — `data-theme` attribute on `<html>` for light/dark
- **MetaMask** — wallet connect, chain switching, tx signing (EIP-1193)
- **Rust backend (Axum)** — REST API + WebSocket on `:3000`
