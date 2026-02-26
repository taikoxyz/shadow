# Shadow UI Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix bugs and add 16 features across UI and backend covering connection stability, URL routing, dual theme, form fixes, deposit state machine, file I/O, settings page, and active-job management.

**Architecture:** The backend is an Axum/Rust server with a broadcast WebSocket channel; the UI is vanilla JS + Vite with zero production dependencies. All new backend endpoints are pure REST; all UI navigation uses URL hash routing so browser refresh preserves view state. ETH amounts always display/accept ETH (not wei) in the UI; the server continues to store and transmit values in wei internally.

**Tech Stack:** Rust (Axum, Tokio, reqwest), vanilla JS (no frameworks), Vite, CSS custom properties for theming.

---

## Context

Key files:
- `packages/server/src/routes/deposits.rs` — deposit CRUD + mining + claim-tx
- `packages/server/src/routes/proofs.rs` — prove/cancel/queue
- `packages/server/src/routes/config_routes.rs` — config + note status
- `packages/server/src/routes/ws.rs` — WebSocket handler
- `packages/server/src/chain/shadow_contract.rs` — ChainClient (eth_call)
- `packages/server/src/workspace/scanner.rs` — DepositEntry, NoteEntry, scan_workspace
- `packages/server/src/mining.rs` — mine_deposit, write_deposit_file
- `packages/server/src/state.rs` — AppState
- `packages/ui/src/api.js` — REST + WebSocket client
- `packages/ui/src/main.js` — render loop, event handlers
- `packages/ui/src/style.css` — all styles
- `packages/ui/index.html` — entry point

Deposit file format (v2):
```json
{
  "version": "v2",
  "chainId": "167013",
  "secret": "0x...",
  "notes": [{"recipient": "0x...", "amount": "1000000000000000", "label": "..."}],
  "targetAddress": "0x..."
}
```

---

## Phase 1: Backend — deposit `comment` field + balance endpoint

### Task 1A: Add `comment` to deposit file format

**Files:**
- Modify: `packages/server/src/workspace/scanner.rs`
- Modify: `packages/server/src/mining.rs`
- Modify: `packages/server/src/routes/deposits.rs`

**Step 1: Add `comment` to DepositEntry and scanner**

In `scanner.rs`, add `comment` field to the inner `DepositJson` struct and to `DepositEntry`:

```rust
// In DepositJson (inside process_deposit):
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositJson {
    version: String,
    chain_id: String,
    secret: String,
    notes: Vec<NoteJson>,
    target_address: Option<String>,
    #[serde(default)]
    comment: Option<String>,   // ← add this
}

// In DepositEntry (top-level struct):
#[serde(skip_serializing_if = "Option::is_none")]
pub comment: Option<String>,   // ← add this
```

In `process_deposit`, pass it through:
```rust
Ok(DepositEntry {
    // ... existing fields ...
    comment: deposit.comment,   // ← add this
})
```

**Step 2: Add `comment` to CreateDepositRequest in deposits.rs**

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDepositRequest {
    chain_id: String,
    notes: Vec<CreateDepositNote>,
    #[serde(default)]
    comment: Option<String>,   // ← add this
}
```

Pass it through to `write_deposit_file` call:
```rust
let filename = mining::write_deposit_file(
    &workspace,
    chain_id,
    &mine_result.secret,
    &mine_result.target_address,
    &req.notes,
    comment.as_deref(),   // ← add this
)?;
```

**Step 3: Update `write_deposit_file` in mining.rs**

```rust
pub fn write_deposit_file(
    workspace: &Path,
    chain_id: u64,
    secret: &[u8; 32],
    target_address: &[u8; 20],
    notes: &[MineNote],
    comment: Option<&str>,   // ← add this
) -> Result<String> {
    // ...
    let mut deposit_json = serde_json::json!({
        "version": "v2",
        "chainId": chain_id.to_string(),
        "secret": format!("0x{}", hex::encode(secret)),
        "notes": notes_json,
        "targetAddress": format!("0x{}", hex::encode(target_address)),
    });
    if let Some(c) = comment {
        deposit_json["comment"] = serde_json::Value::String(c.to_string());
    }
    // ...
}
```

**Step 4: Build and confirm it compiles**
```bash
cargo build --manifest-path packages/server/Cargo.toml 2>&1 | tail -5
```
Expected: no errors.

**Step 5: Commit**
```bash
git add packages/server/src/workspace/scanner.rs packages/server/src/mining.rs packages/server/src/routes/deposits.rs
git commit -m "feat: add optional comment field to deposit file format"
```

---

### Task 1B: Add `eth_getBalance` to ChainClient + balance endpoint

**Files:**
- Modify: `packages/server/src/chain/shadow_contract.rs`
- Modify: `packages/server/src/routes/deposits.rs`

**Step 1: Add `get_balance` to ChainClient**

In `shadow_contract.rs`:
```rust
/// Query ETH balance of an address (returns wei as decimal string).
pub async fn get_balance(&self, address: &str) -> Result<String> {
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getBalance",
        "params": [address, "latest"]
    });

    let resp: serde_json::Value = self
        .http
        .post(&self.rpc_url)
        .json(&req)
        .send()
        .await?
        .json()
        .await?;

    if let Some(error) = resp.get("error") {
        bail!(
            "eth_getBalance error: {}",
            error.get("message").and_then(|v| v.as_str()).unwrap_or("unknown")
        );
    }

    let hex_balance = resp
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("eth_getBalance: no result"))?;

    // Convert hex balance to decimal string
    let stripped = hex_balance.strip_prefix("0x").unwrap_or(hex_balance);
    let value = u128::from_str_radix(stripped, 16)
        .context("invalid balance hex")?;
    Ok(value.to_string())
}
```

**Step 2: Add `GET /api/deposits/:id/balance` endpoint in deposits.rs**

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BalanceResponse {
    target_address: String,
    balance: String,         // wei as decimal string
    required: String,        // total_amount as decimal string
    due: String,             // max(0, required - balance) as decimal string
    is_funded: bool,         // balance >= required
}

async fn get_deposit_balance(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<BalanceResponse>, (StatusCode, String)> {
    let chain_client = state.chain_client.as_ref().ok_or((
        StatusCode::BAD_REQUEST,
        "RPC URL not configured".to_string(),
    ))?;

    let index = scan_workspace(&state.workspace);
    let deposit = index
        .deposits
        .iter()
        .find(|d| d.id == id)
        .ok_or((StatusCode::NOT_FOUND, format!("deposit {} not found", id)))?;

    let balance = chain_client
        .get_balance(&deposit.target_address)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let required: u128 = deposit.total_amount.parse().unwrap_or(0);
    let bal: u128 = balance.parse().unwrap_or(0);
    let due = if bal >= required { 0u128 } else { required - bal };

    Ok(Json(BalanceResponse {
        target_address: deposit.target_address.clone(),
        balance,
        required: deposit.total_amount.clone(),
        due: due.to_string(),
        is_funded: bal >= required,
    }))
}
```

Add to router in deposits.rs:
```rust
.route("/deposits/{id}/balance", get(get_deposit_balance))
```

Add necessary imports to `use` block:
```rust
use crate::{
    mining,
    state::AppState,
    workspace::scanner::{scan_workspace, DepositEntry},
};
```

**Step 3: Build**
```bash
cargo build --manifest-path packages/server/Cargo.toml 2>&1 | tail -5
```

**Step 4: Commit**
```bash
git add packages/server/src/chain/shadow_contract.rs packages/server/src/routes/deposits.rs
git commit -m "feat: add ETH balance endpoint for deposit target address"
```

---

### Task 1C: Allow proof regeneration (force flag on POST /prove)

**Files:**
- Modify: `packages/server/src/routes/proofs.rs`

The current code returns 409 if a job is already running for this deposit. Change behavior:
1. If a **different** deposit is being proved → still return 409 with a clear message
2. If the **same** deposit is being proved → return 409 with a message that says "proof already running for this deposit" so UI can show a sensible message with a kill option
3. Allow regeneration when `?force=true` is passed (deletes old proof file first)

**Step 1: Add `force` query param**

```rust
#[derive(Debug, Deserialize)]
struct ProveQuery {
    #[serde(default)]
    force: bool,
}

async fn start_proof(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ProveQuery>,
) -> Result<Json<ProofJob>, (StatusCode, String)> {
```

**Step 2: Handle force flag** — before enqueueing, if `force` is true, delete the existing proof file:

```rust
    // If force=true, delete existing proof file
    if query.force {
        if let Some(ref proof_name) = deposit.proof_file {
            let proof_path = state.workspace.join(proof_name);
            let _ = std::fs::remove_file(&proof_path);
        }
    }
```

**Step 3: Improve 409 error message** — the `enqueue` method returns a `String` error when already running. Pass through as-is; the UI will handle display. No Rust change needed — the error string is already descriptive.

**Step 4: Build**
```bash
cargo build --manifest-path packages/server/Cargo.toml 2>&1 | tail -5
```

**Step 5: Commit**
```bash
git add packages/server/src/routes/proofs.rs
git commit -m "feat: allow proof regeneration with ?force=true on POST /prove"
```

---

### Task 1D: File download endpoints

**Files:**
- Modify: `packages/server/src/routes/deposits.rs`

Add two download endpoints that return the raw file bytes:

```rust
use axum::http::header;
use axum::response::Response;
use axum::body::Body;

/// `GET /api/deposits/:id/download` — download raw deposit JSON file.
async fn download_deposit(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Response<Body>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    let entry = index.deposits.iter().find(|d| d.id == id).ok_or(StatusCode::NOT_FOUND)?;
    let path = state.workspace.join(&entry.filename);
    let bytes = std::fs::read(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", entry.filename))
        .body(Body::from(bytes))
        .unwrap())
}

/// `GET /api/deposits/:id/proof/download` — download raw proof JSON file.
async fn download_proof(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Response<Body>, StatusCode> {
    let index = scan_workspace(&state.workspace);
    let entry = index.deposits.iter().find(|d| d.id == id).ok_or(StatusCode::NOT_FOUND)?;
    let proof_name = entry.proof_file.as_ref().ok_or(StatusCode::NOT_FOUND)?;
    let path = state.workspace.join(proof_name);
    let bytes = std::fs::read(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", proof_name))
        .body(Body::from(bytes))
        .unwrap())
}
```

Add to router:
```rust
.route("/deposits/{id}/download", get(download_deposit))
.route("/deposits/{id}/proof/download", get(download_proof))
```

**Step 4: Build and commit**
```bash
cargo build --manifest-path packages/server/Cargo.toml 2>&1 | tail -5
git add packages/server/src/routes/deposits.rs
git commit -m "feat: add deposit and proof file download endpoints"
```

---

### Task 1E: Deposit file upload (import) endpoint

**Files:**
- Modify: `packages/server/src/routes/deposits.rs`

```rust
use axum::extract::Multipart;

/// `POST /api/deposits/import` — upload a deposit JSON file.
async fn import_deposit(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("multipart error: {}", e))
    })? {
        let filename = field.file_name()
            .unwrap_or("deposit.json")
            .to_string();
        if !filename.ends_with(".json") {
            return Err((StatusCode::BAD_REQUEST, "file must be JSON".to_string()));
        }
        let data = field.bytes().await.map_err(|e| {
            (StatusCode::BAD_REQUEST, format!("read error: {}", e))
        })?;
        // Validate it parses as deposit
        let _: serde_json::Value = serde_json::from_slice(&data).map_err(|e| {
            (StatusCode::BAD_REQUEST, format!("invalid JSON: {}", e))
        })?;
        let path = state.workspace.join(&filename);
        std::fs::write(&path, &data).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, format!("write failed: {}", e))
        })?;
        let _ = state.event_tx.send(
            serde_json::json!({"type": "workspace:changed"}).to_string()
        );
        return Ok(Json(serde_json::json!({"filename": filename})));
    }
    Err((StatusCode::BAD_REQUEST, "no file uploaded".to_string()))
}
```

Add to router:
```rust
.route("/deposits/import", post(import_deposit))
```

Note: Add `axum` feature `multipart` to Cargo.toml if not present:
```toml
axum = { version = "...", features = ["multipart"] }
```

**Step: Build and commit**
```bash
cargo build --manifest-path packages/server/Cargo.toml 2>&1 | tail -5
git add packages/server/src/routes/deposits.rs packages/server/Cargo.toml packages/server/Cargo.lock
git commit -m "feat: add deposit file import endpoint"
```

---

## Phase 2: UI — URL hash routing

### Task 2A: Implement hash-based routing in main.js

**Files:**
- Modify: `packages/ui/src/main.js`

Replace direct `navigateTo` state mutations with URL hash writes. The browser popstate/hashchange event then drives navigation.

**Step 1: Replace navigateTo to write to URL hash**

```js
function navigateTo(view, id = null) {
  if (view === 'detail' && id) {
    location.hash = `#/deposit/${encodeURIComponent(id)}`;
  } else {
    location.hash = '#/';
  }
}
```

**Step 2: Add hash parser and route handler**

```js
function applyRoute() {
  const hash = location.hash;
  const match = hash.match(/^#\/deposit\/(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    state.view = 'detail';
    state.selectedId = id;
  } else {
    state.view = 'list';
    state.selectedId = null;
  }
  render();
}
```

**Step 3: Wire up event listeners in init()**

```js
window.addEventListener('hashchange', applyRoute);
// On first load, apply current hash before fetch
applyRoute();
// After refresh, re-apply route in case detail is wanted
```

**Step 4: Make sure `Back` links and breadcrumbs use navigateTo (they already do — just confirm the links work after clicking refresh)**

**Step 5: Build and verify no errors**
```bash
cd packages/ui && npx vite build 2>&1 | tail -10
```

**Step 6: Commit**
```bash
cd /path/to/repo
git add packages/ui/src/main.js
git commit -m "feat: URL hash routing - deposit detail survives page refresh"
```

---

## Phase 3: UI — Dual light/dark theme

### Task 3A: CSS custom property theme system

**Files:**
- Modify: `packages/ui/src/style.css`
- Modify: `packages/ui/index.html`

**Step 1: Reorganize CSS variables into two theme blocks**

Replace the current `:root` block with:

```css
/* Dark theme (default) */
:root,
[data-theme="dark"] {
  --bg-base: #111113;
  --bg-raised: #18181c;
  --bg-surface: #1e1e24;
  --bg-hover: #26262e;
  --border: #2c2c38;
  --border-hover: #3c3c4c;
  --text-primary: #eaeaf0;
  --text-secondary: #9090a0;
  --text-muted: #606070;
  --accent: #34d399;
  --accent-bg: #0d2d22;
  --accent-border: #1a4a35;
  --amber: #fbbf24;
  --amber-bg: #2d2510;
  --amber-border: #4a3a1a;
  --blue: #60a5fa;
  --blue-bg: #0d1a2d;
  --red: #f87171;
  --red-bg: #2d1010;
  --red-border: #4a1a1a;
  color-scheme: dark;
}

/* Light theme */
[data-theme="light"] {
  --bg-base: #f5f5f7;
  --bg-raised: #ffffff;
  --bg-surface: #f0f0f4;
  --bg-hover: #e8e8ef;
  --border: #d8d8e0;
  --border-hover: #c0c0cc;
  --text-primary: #111118;
  --text-secondary: #4a4a5a;
  --text-muted: #8a8a9a;
  --accent: #059669;
  --accent-bg: #ecfdf5;
  --accent-border: #a7f3d0;
  --amber: #d97706;
  --amber-bg: #fffbeb;
  --amber-border: #fde68a;
  --blue: #2563eb;
  --blue-bg: #eff6ff;
  --red: #dc2626;
  --red-bg: #fef2f2;
  --red-border: #fecaca;
  color-scheme: light;
}
```

Replace all hardcoded color uses in the rest of the CSS with the variables.

**Step 2: Persist theme choice and apply on load**

In `main.js`, add theme management:
```js
// Theme
function getTheme() { return localStorage.getItem('shadow-theme') || 'dark'; }
function setTheme(t) {
  localStorage.setItem('shadow-theme', t);
  document.documentElement.setAttribute('data-theme', t);
  render(); // re-render so toggle button updates
}
// Apply on load:
document.documentElement.setAttribute('data-theme', getTheme());
```

**Step 3: Add theme toggle button to header**

In `renderHeader()`, add a toggle button in the actions area:
```js
el('button', {
  className: 'btn btn-icon',
  onclick: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
  title: 'Toggle theme',
}, getTheme() === 'dark' ? '☀' : '☾')
```

**Step 4: Build and test visually**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
```

**Step 5: Commit**
```bash
git add packages/ui/src/style.css packages/ui/src/main.js
git commit -m "feat: dual light/dark theme with localStorage persistence"
```

---

## Phase 4: UI — Form bugs and validation

### Task 4A: Fix "Add Note" bug (second note disappears)

**Files:**
- Modify: `packages/ui/src/main.js`

**Root cause:** `renderMiningForm()` creates a closure over `noteCount` but `renderFormContent()` is called inline before the DOM is appended. Each call to `+ Add Note` calls `renderFormContent()` which sets `container.innerHTML = ''` — this destroys the existing inputs, including filled-in values, and `noteCount` increases but note data is lost.

**Fix:** Persist note data separately from DOM rendering:

```js
function renderMiningForm() {
  // Store note data in an array parallel to noteCount
  let notes = [{ recipient: '', amount: '', label: '' }];

  const container = el('div', { className: 'mining-panel' });

  function addNote() {
    notes.push({ recipient: '', amount: '', label: '' });
    renderFormContent();
  }

  function removeNote(i) {
    notes.splice(i, 1);
    renderFormContent();
  }

  function saveNoteData() {
    // Read current DOM values back into notes array before re-render
    notes.forEach((note, i) => {
      const r = document.getElementById(`mine-recipient-${i}`);
      const a = document.getElementById(`mine-amount-${i}`);
      const l = document.getElementById(`mine-label-${i}`);
      if (r) note.recipient = r.value;
      if (a) note.amount = a.value;
      if (l) note.label = l.value;
    });
  }

  function renderFormContent() {
    container.innerHTML = '';
    // ... render header, chain ID group as before ...
    // For each note in notes array:
    notes.forEach((note, i) => {
      const noteEl = el('div', { className: 'note-entry' }, [
        // ... header with remove button ...
        // ... form fields pre-filled from note.recipient, note.amount, note.label ...
      ]);
      container.appendChild(noteEl);
    });
    // Submit button reads from notes array via saveNoteData first
  }

  // Wire Add Note:
  // In the "Add Note" button onclick: saveNoteData(); addNote();
  // In the "Remove" button onclick: saveNoteData(); removeNote(i);

  renderFormContent();
  return container;
}
```

**Task 4B: No default recipient; warn if matches wallet**

In `renderFormContent`, for the recipient input:
```js
// No default value - leave blank
el('input', {
  className: `form-input${recipientError ? ' input-error' : ''}`,
  id: `mine-recipient-${i}`,
  placeholder: '0x...',
  value: note.recipient,   // starts empty for new notes
  onchange: (e) => {
    const val = e.target.value.trim().toLowerCase();
    const wallet = state.walletAddress?.toLowerCase();
    if (wallet && val === wallet) {
      showToast('Warning: using your connected wallet as recipient may reveal your identity', 'error');
    }
  },
}),
```

**Task 4C: Form validation improvements**

Add validation before submitting mining form:

```js
function validateNote(note, i) {
  const errors = [];
  if (!note.recipient.match(/^0x[0-9a-fA-F]{40}$/)) {
    errors.push(`Note #${i}: invalid recipient address`);
  }
  const ethVal = parseFloat(note.amount);
  if (isNaN(ethVal) || ethVal <= 0) {
    errors.push(`Note #${i}: amount must be a positive number`);
  }
  if (note.amount && ethVal < 0.000001) {
    errors.push(`Note #${i}: amount must be at least 0.000001 ETH`);
  }
  return errors;
}
```

Show per-field inline errors (add `.input-error` CSS class: red border) and a summary toast.

**Step: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/main.js packages/ui/src/style.css
git commit -m "fix: add-note bug, validation, no default recipient, wallet warning"
```

---

## Phase 5: UI — ETH amounts

### Task 5A: Accept and display amounts in ETH throughout

**Files:**
- Modify: `packages/ui/src/main.js`
- Modify: `packages/ui/src/api.js`

**Step 1: Mining form inputs accept ETH**

In the amount input for each note, change placeholder to `0.001` and label to "Amount (ETH)".

Before sending to API, convert ETH to wei:
```js
function ethToWei(ethStr) {
  // Use BigInt to avoid floating point errors
  const [int, frac = ''] = ethStr.split('.');
  const fracPadded = (frac + '000000000000000000').slice(0, 18);
  return (BigInt(int || '0') * BigInt('1000000000000000000') + BigInt(fracPadded)).toString();
}
```

**Step 2: Display amounts in ETH everywhere**

The `weiToEth` helper already exists. Replace all raw wei displays with ETH.

In `renderDepositCard`, show `${totalEth} ETH`.
In `renderNotesTable`, show `${weiToEth(note.amount)} ETH`.
In `renderDetailView`, show total amount in ETH.
In balance display, show required and balance in ETH.

**Step 3: Update API note format**

`createDeposit` already sends `amount` as string. No API change needed — just ensure the value is wei string by the time it's sent.

**Step 4: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/main.js
git commit -m "feat: all amounts displayed and accepted in ETH"
```

---

## Phase 6: UI — Deposit state machine

### Task 6A: Add UNFUNDED state + fund button + balance tracking

**Files:**
- Modify: `packages/ui/src/main.js`
- Modify: `packages/ui/src/api.js`

**State flow:**
```
UNFUNDED (balance < required)
  → user sends ETH to targetAddress
UNPROVED (balance >= required, no proof)
  → user clicks Generate Proof
PROVING (proof job running)
  → proof completes
PROVED (has proof, notes unclaimed/unknown)
  → user claims each note
PARTIAL (some notes claimed)
CLAIMED (all notes claimed)
```

**Step 1: Add balance API call to api.js**
```js
export function getDepositBalance(depositId) {
  return apiFetch(`/deposits/${encodeURIComponent(depositId)}/balance`);
}
```

**Step 2: Fetch balance when viewing deposit detail**

In `renderDetailView`, after loading the deposit, also fetch its balance:
```js
// At top of renderDetailView (or in init after selecting):
async function loadDepositBalance(depositId) {
  try {
    const bal = await api.getDepositBalance(depositId);
    state.depositBalance = bal;
    render();
  } catch { state.depositBalance = null; }
}
```

Store in `state.depositBalance = null` (reset when navigating away).

**Step 3: Compute effective deposit status**

```js
function depositStatus(deposit) {
  if (!state.depositBalance) return 'unknown';
  if (!state.depositBalance.is_funded) return 'unfunded';
  if (!deposit.hasProof) return 'unproved';
  const allClaimed = deposit.notes.every(n => n.claimStatus === 'claimed');
  const anyClaimed = deposit.notes.some(n => n.claimStatus === 'claimed');
  if (allClaimed) return 'claimed';
  if (anyClaimed) return 'partial';
  return 'proved';
}
```

**Step 4: Render status badge and conditional actions**

In the detail view actions section:
- `unfunded`: show "Fund Deposit" button + balance due display
- `unproved` or no proof: show "Generate Proof" button (enabled)
- `proving`: show spinner + "Cancel Proof" button
- `proved`: show "Generate Proof (regenerate)" button (secondary style) + claim buttons
- `claimed`: show "All claimed" badge

**Step 5: Fund button behavior**

The "Fund" button sends ETH via MetaMask:
```js
async function handleFundDeposit(deposit) {
  if (!state.walletAddress) { await handleConnectWallet(); if (!state.walletAddress) return; }
  const bal = state.depositBalance;
  if (!bal) return;
  const dueWei = BigInt(bal.due);
  if (dueWei <= 0n) { showToast('Already funded', 'info'); return; }
  try {
    showToast('Sending funding transaction...', 'info');
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: state.walletAddress, to: deposit.targetAddress, value: '0x' + dueWei.toString(16) }],
    });
    showToast(`Funding tx: ${txHash.slice(0, 18)}...`, 'success');
    // Poll balance after 5s
    setTimeout(() => loadDepositBalance(deposit.id), 5000);
  } catch (err) {
    showToast(`Fund failed: ${err.message}`, 'error');
  }
}
```

**Step 6: Show "Balance Due" in detail view**

```js
// In renderDetailView, after overview section:
if (state.depositBalance) {
  const bal = state.depositBalance;
  items.push(el('div', { className: 'detail-section' }, [
    el('h2', {}, 'Funding Status'),
    detailRow('Target Address', bal.targetAddress),
    detailRow('Required', `${weiToEth(bal.required)} ETH`),
    detailRow('Current Balance', `${weiToEth(bal.balance)} ETH`),
    !bal.isFunded ? detailRow('Balance Due', `${weiToEth(bal.due)} ETH`) : null,
    detailRow('Status', bal.isFunded ? 'Funded' : 'Unfunded'),
  ].filter(Boolean)));
}
```

**Step 7: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/main.js packages/ui/src/api.js
git commit -m "feat: deposit state machine (UNFUNDED/UNPROVED/PROVED/CLAIMED) with fund button"
```

---

## Phase 7: UI — Active proof job panel + better errors

### Task 7A: Global proof job banner with kill button

**Files:**
- Modify: `packages/ui/src/main.js`

**Step 1: Make the queue status visible at the top, always**

Move `renderQueueStatus()` to render at the top of the page (below header), not just at the bottom. When a job is active, show a prominent banner:

```js
// In render(), after renderHeader():
if (state.queueJob && ['queued', 'running'].includes(state.queueJob.status)) {
  app.appendChild(renderProofJobBanner());
}
```

**Step 2: Enhanced banner**

```js
function renderProofJobBanner() {
  const job = state.queueJob;
  const pct = job.totalNotes > 0 ? Math.round((job.currentNote / job.totalNotes) * 100) : 0;
  return el('div', { className: 'proof-banner' }, [
    el('div', { className: 'proof-banner-info' }, [
      el('span', { className: 'spinner' }),
      el('span', {}, `Proving ${job.depositId} — ${job.message || 'running...'}`),
    ]),
    el('div', { className: 'proof-banner-actions' }, [
      el('div', { className: 'progress-bar' }, [
        el('div', { className: 'progress-fill', style: `width: ${pct}%` }),
      ]),
      el('button', {
        className: 'btn btn-danger btn-small',
        onclick: handleCancelProof,
      }, 'Kill'),
    ]),
  ]);
}
```

Add `.proof-banner` CSS: sticky top bar below header, amber-tinted background.

**Step 3: Better 409 error display**

In `handleProve`:
```js
async function handleProve(depositId) {
  try {
    const job = await api.startProof(depositId);
    state.queueJob = job;
    render();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('409') || msg.includes('already running')) {
      showToast(
        'A proof job is already running. Kill it first or wait for it to complete.',
        'error',
        8000
      );
      // Also refresh queue status so banner shows
      pollQueue();
    } else {
      showToast(`Failed to start proof: ${msg}`, 'error');
    }
  }
}
```

Update `showToast` to accept optional duration:
```js
function showToast(message, type = 'info', duration = 4000) {
  // ...
  setTimeout(() => toast.remove(), duration);
}
```

**Step 4: Proof regeneration button in detail view**

In the detail actions section, when `deposit.hasProof` is true, also show a "Regenerate Proof" button:
```js
el('button', {
  className: 'btn btn-small',
  onclick: () => api.startProof(deposit.id + '?force=true').then(() => ...).catch(handleProveError),
}, 'Regenerate Proof'),
```

Wait — the force param must go on the URL: `POST /deposits/:id/prove?force=true`. Update `api.js`:
```js
export function startProof(depositId, force = false) {
  const url = `/deposits/${encodeURIComponent(depositId)}/prove${force ? '?force=true' : ''}`;
  return apiFetch(url, { method: 'POST' });
}
```

**Step 5: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/main.js packages/ui/src/api.js packages/ui/src/style.css
git commit -m "feat: global proof job banner, kill button, better 409 errors, proof regeneration"
```

---

## Phase 8: UI — File open/save + comment

### Task 8A: Deposit comment display and edit

**Files:**
- Modify: `packages/ui/src/main.js`

**Step 1: Show comment in detail view**

In `renderDetailView`, after breadcrumb:
```js
deposit.comment ? el('p', { className: 'deposit-comment' }, deposit.comment) : null,
```

Add `.deposit-comment` CSS: italic, muted text, margin below breadcrumb.

**Step 2: Add comment field to mining form**

In `renderMiningForm`, add a comment textarea:
```js
el('div', { className: 'form-group' }, [
  el('label', { className: 'form-label' }, 'Comment (optional)'),
  el('textarea', {
    className: 'form-input',
    id: 'mine-comment',
    placeholder: 'Describe this deposit...',
    style: 'min-height: 60px; resize: vertical',
  }),
]),
```

Read and pass comment when submitting:
```js
const comment = document.getElementById('mine-comment')?.value?.trim() || undefined;
handleMineDeposit({ notes, comment });
```

In `handleMineDeposit`, pass `comment` to `api.createDeposit`:
```js
const result = await api.createDeposit(chainId, formData.notes, formData.comment);
```

Update `api.js`:
```js
export function createDeposit(chainId, notes, comment) {
  return apiFetch('/deposits', {
    method: 'POST',
    body: JSON.stringify({ chainId, notes, comment }),
  });
}
```

**Task 8B: Download buttons for deposit and proof files**

**Step 1: Add download links to detail view**

In the Actions section:
```js
// Download deposit file
el('a', {
  href: `/api/deposits/${deposit.id}/download`,
  download: deposit.filename,
  className: 'btn btn-small',
}, 'Download Deposit'),

// Download proof file (only if has proof)
deposit.hasProof ? el('a', {
  href: `/api/deposits/${deposit.id}/proof/download`,
  download: deposit.proofFile,
  className: 'btn btn-small',
}, 'Download Proof') : null,
```

Note: `<a>` with `href` and `download` attribute works as a download button with no JS needed.

**Task 8C: Upload / import deposit file**

**Step 1: Add file input to list view**

Below the "+ New Deposit" button, add:
```js
el('label', { className: 'btn btn-small', title: 'Import an existing deposit file' }, [
  'Import Deposit',
  el('input', {
    type: 'file',
    accept: '.json',
    style: 'display: none',
    onchange: handleImportDeposit,
  }),
]),
```

**Step 2: Handle import**
```js
async function handleImportDeposit(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file, file.name);
  try {
    await fetch('/api/deposits/import', { method: 'POST', body: formData });
    showToast('Deposit imported', 'success');
    await refresh();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  }
  e.target.value = '';
}
```

**Step 3: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/main.js packages/ui/src/api.js packages/ui/src/style.css
git commit -m "feat: comment field, deposit/proof file download, deposit import"
```

---

## Phase 9: UI — Settings page + config bar

### Task 9A: Settings page

**Files:**
- Modify: `packages/ui/src/main.js`
- Modify: `packages/ui/src/style.css`

**Step 1: Add 'settings' view to state**

```js
let state = {
  view: 'list',   // 'list' | 'detail' | 'settings'
  // ...
}
```

**Step 2: Add settings navigation**

In `renderHeader`, add a settings link/button in the actions area:
```js
el('button', {
  className: 'btn-icon',
  onclick: () => navigateTo('settings'),
  title: 'Settings',
}, '⚙')
```

**Step 3: renderSettingsView()**

```js
function renderSettingsView() {
  return el('div', { className: 'settings-view' }, [
    el('div', { className: 'breadcrumb' }, [
      el('a', { onclick: () => navigateTo('list') }, 'Home'),
      ' / Settings',
    ]),
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'RPC Endpoint'),
      el('p', { className: 'form-hint', style: 'margin-bottom: 0.75rem' },
        'Override is stored locally and used only by the UI for balance checks. Proof generation uses the server-configured RPC URL.'),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label' }, 'JSON-RPC URL'),
        el('input', {
          className: 'form-input',
          id: 'settings-rpc',
          value: localStorage.getItem('shadow-rpc') || state.config?.rpcUrl || '',
          placeholder: 'https://rpc.hoodi.taiko.xyz',
        }),
      ]),
      el('button', {
        className: 'btn btn-primary',
        onclick: () => {
          const val = document.getElementById('settings-rpc')?.value?.trim();
          if (val) localStorage.setItem('shadow-rpc', val);
          else localStorage.removeItem('shadow-rpc');
          showToast('Settings saved', 'success');
        },
      }, 'Save'),
    ]),
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Appearance'),
      el('div', { style: 'display: flex; align-items: center; gap: 1rem' }, [
        el('span', {}, 'Theme:'),
        el('button', {
          className: 'btn',
          onclick: () => setTheme('dark'),
          style: getTheme() === 'dark' ? 'border-color: var(--accent)' : '',
        }, 'Dark'),
        el('button', {
          className: 'btn',
          onclick: () => setTheme('light'),
          style: getTheme() === 'light' ? 'border-color: var(--accent)' : '',
        }, 'Light'),
      ]),
    ]),
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Server Info'),
      state.config ? el('div', {}, [
        detailRow('Version', `v${state.config.version}`),
        detailRow('Shadow Contract', state.config.shadowAddress || '—'),
        detailRow('Circuit ID', state.config.circuitId || '—'),
        detailRow('Verifier', state.config.verifierAddress || '—'),
      ]) : el('p', { className: 'form-hint' }, 'Not connected'),
    ]),
  ]);
}
```

**Step 4: Wire settings into render()**

```js
if (state.view === 'settings') {
  app.appendChild(renderSettingsView());
} else if (state.view === 'detail' && state.selectedId) {
  app.appendChild(renderDetailView());
} else {
  app.appendChild(renderListView());
}
```

**Task 9B: Fix config bar — full circuit ID, Shadow address, no workspace path**

In `renderConfigBar()`:
```js
function renderConfigBar() {
  const c = state.config;
  const items = [];
  if (c.version) items.push(`v${c.version}`);
  if (c.shadowAddress) items.push(`Shadow: ${c.shadowAddress}`);
  if (c.circuitId) items.push(`Circuit: ${c.circuitId}`);  // full ID, no truncation
  // Removed: workspace path
  return el('div', { className: 'config-bar' }, items.map((t) => el('span', {}, t)));
}
```

**Step 5: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/main.js packages/ui/src/style.css
git commit -m "feat: settings page with RPC override and theme, fix config bar"
```

---

## Phase 10: UI — WebSocket stability improvements

### Task 10A: Exponential backoff reconnect + connection indicator

**Files:**
- Modify: `packages/ui/src/api.js`

**Step 1: Replace fixed 3s reconnect with exponential backoff**

```js
let wsReconnectDelay = 1000;
const WS_MAX_DELAY = 30000;

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_DELAY);
    ensureWebSocket();
  }, wsReconnectDelay);
}

// Reset delay on successful connect:
wsConnection.onopen = () => {
  wsReconnectDelay = 1000;  // reset on success
  // notify listeners of connection state
  for (const listener of wsListeners) {
    try { listener({ type: 'ws:connected' }); } catch {}
  }
  // ...
};
```

**Step 2: Broadcast disconnect event so UI can show indicator**

```js
wsConnection.onclose = () => {
  for (const listener of wsListeners) {
    try { listener({ type: 'ws:disconnected' }); } catch {}
  }
  scheduleReconnect();
};
```

**Step 3: Track WS state in app state and show indicator in header**

In `main.js`, in `handleServerEvent`:
```js
case 'ws:connected':
  state.wsConnected = true;
  render();
  break;
case 'ws:disconnected':
  state.wsConnected = false;
  render();
  break;
```

In `renderHeader`, update the RPC dot to also reflect WS connection:
```js
el('span', { className: 'header-status' }, [
  el('span', { className: `rpc-dot ${state.wsConnected ? '' : 'rpc-dot-offline'}` }),
  state.wsConnected ? 'Live' : 'Reconnecting...',
]),
```

Add `.rpc-dot-offline { background: var(--amber); }` CSS.

**Step 4: Heartbeat ping every 25s to keep connection alive**

```js
wsConnection.onopen = () => {
  // ...
  if (wsPingInterval) clearInterval(wsPingInterval);
  wsPingInterval = setInterval(() => {
    if (wsConnection?.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);
};
wsConnection.onclose = () => {
  if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
  // ...
};
```

**Step 5: Build and commit**
```bash
cd packages/ui && npx vite build 2>&1 | tail -5
git add packages/ui/src/api.js packages/ui/src/main.js packages/ui/src/style.css
git commit -m "feat: WebSocket exponential backoff, connection indicator, heartbeat ping"
```

---

## Phase 11: Final integration test + server build

### Task 11A: Full server build with all backend changes

```bash
cargo build --manifest-path packages/server/Cargo.toml 2>&1 | tail -20
cargo test --manifest-path packages/server/Cargo.toml 2>&1 | tail -20
```

Expected: all existing 15 tests pass.

### Task 11B: UI build

```bash
cd packages/ui && npx vite build 2>&1
```

Expected: no errors, output in `dist/`.

### Task 11C: Final commit

```bash
git add -A
git commit -m "chore: all UI/backend improvements - state machine, themes, settings, routing"
```

---

## Summary of new API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/deposits/:id/balance` | ETH balance of target address |
| `GET` | `/api/deposits/:id/download` | Download deposit JSON |
| `GET` | `/api/deposits/:id/proof/download` | Download proof JSON |
| `POST` | `/api/deposits/import` | Upload/import deposit file |
| `POST` | `/api/deposits/:id/prove?force=true` | Regenerate proof (delete old first) |

## Summary of new UI features

- Hash routing: `#/deposit/:id` survives refresh
- Light/dark theme toggle (persisted in localStorage)
- Settings page: RPC override, theme, server info
- UNFUNDED → UNPROVED → PROVED → CLAIMED state badges
- Fund button with MetaMask for unfunded deposits
- Balance due display (required - current)
- "Add note" bug fixed
- No default recipient in new notes; warns if matches wallet
- Amounts in ETH (not wei) everywhere
- File download buttons for deposit + proof
- File import (drag or button) for existing deposits
- Comment field on deposits
- Active proof job banner (sticky, shows progress + kill button)
- Better 409 error with kill suggestion
- WS exponential backoff, connection indicator, heartbeat ping
- Config bar: full circuit ID, Shadow contract address, no workspace path
