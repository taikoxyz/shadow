/**
 * Shadow UI — workspace manager for deposit and proof files.
 *
 * This UI talks to the shadow-server backend via REST API and WebSocket.
 * All proof generation, workspace scanning, and on-chain queries are
 * handled server-side.
 */

import * as api from './api.js';
const { log } = api;
import './style.css';
import { createElement, Eye, Settings, Sun, Moon, FileKey, ArrowDownToLine, X, RefreshCcw } from 'lucide';

/** Create a Lucide icon element at 15x15 with stroke-width 1.5. */
function lucideIcon(iconNode, extraClass) {
  const el = createElement(iconNode, { width: 15, height: 15, 'stroke-width': 1.5 });
  el.setAttribute('aria-hidden', 'true');
  if (extraClass) el.classList.add(extraClass);
  return el;
}

// ---------------------------------------------------------------------------
// Network registry — chain ID → display name, explorer, default RPC
// ---------------------------------------------------------------------------
const NETWORKS = {
  '167000': { name: 'Taiko Mainnet', explorer: 'https://taikoscan.io', rpc: 'https://rpc.taiko.xyz' },
  '167013': { name: 'Taiko Hoodi',   explorer: 'https://hoodi.taikoscan.io', rpc: 'https://rpc.hoodi.taiko.xyz' },
};

function networkName(chainId) {
  return NETWORKS[chainId]?.name || `Chain ${chainId}`;
}

function explorerUrl(chainId) {
  return NETWORKS[chainId]?.explorer || '';
}

function defaultRpc(chainId) {
  return NETWORKS[chainId]?.rpc || '';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  view: 'list',       // 'list' | 'detail'
  deposits: [],       // DepositEntry[]
  selectedId: null,   // deposit ID for detail view
  config: null,       // server config
  queueJob: null,     // current proof job
  loading: true,
  error: null,
  // Wallet
  walletAddress: null,
  walletChainId: null,
  // Mining form
  showMiningForm: false,
  mining: false,
  miningNotes: null,    // persists across render() calls while form is open
  miningComment: '',
  miningErrors: {},     // { 'recipient-0': 'msg', 'amount-1': 'msg', 'total': 'msg' }
  // Deposit detail
  depositBalance: null,
  claimTxHashes: {},   // { 'depositId-noteIndex': txHash }
  wsConnected: false,
  // Proof log
  proofLog: [],         // {time, message} entries accumulated during proving
  bannerExpanded: false,
  proofStartTime: null,
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function getTheme() {
  return localStorage.getItem('shadow-theme') || 'dark';
}

function setTheme(t) {
  localStorage.setItem('shadow-theme', t);
  document.documentElement.setAttribute('data-theme', t);
  render();
}

// Apply theme immediately (before any render)
document.documentElement.setAttribute('data-theme', getTheme());

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function applyRoute() {
  const hash = location.hash;
  const detailMatch = hash.match(/^#\/deposit\/(.+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    if (state.view !== 'detail' || state.selectedId !== id) {
      state.depositBalance = null;
      loadDepositBalance(id);
      loadAllNoteStatuses(id);
    }
    state.view = 'detail';
    state.selectedId = id;
  } else if (hash === '#/settings') {
    state.view = 'settings';
    state.selectedId = null;
    state.depositBalance = null;
  } else {
    state.view = 'list';
    state.selectedId = null;
    state.depositBalance = null;
  }
  render();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const app = document.getElementById('app');

async function init() {
  // Apply current hash on load (before fetch so we know which view to show)
  applyRoute();

  // Listen for hash changes (back/forward navigation)
  window.addEventListener('hashchange', applyRoute);

  await refresh();

  // Subscribe to real-time events
  api.onServerEvent(handleServerEvent);

  // Poll queue status periodically (fallback for missed WS events)
  setInterval(pollQueue, 5000);

  // Check if wallet is already connected
  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        state.walletAddress = accounts[0];
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        state.walletChainId = chainId;
        render();
      }
    } catch { /* ignore */ }

    window.ethereum.on?.('accountsChanged', (accounts) => {
      state.walletAddress = accounts[0] || null;
      render();
    });
    window.ethereum.on?.('chainChanged', (chainId) => {
      state.walletChainId = chainId;
      render();
    });
  }
}

async function refresh() {
  state.loading = true;
  state.error = null;
  render();

  try {
    const [deposits, config, queueJob] = await Promise.all([
      api.getDeposits().catch(() => []),
      api.getConfig().catch(() => null),
      api.getQueueStatus().catch(() => null),
    ]);
    state.deposits = deposits;
    state.config = config;
    state.queueJob = queueJob;
    state.loading = false;
  } catch (err) {
    state.error = err.message;
    state.loading = false;
  }

  render();

  // Auto-refresh note statuses if viewing a deposit detail
  if (state.view === 'detail' && state.selectedId) {
    loadAllNoteStatuses(state.selectedId);
  }
}

async function pollQueue() {
  try {
    state.queueJob = await api.getQueueStatus();
    render();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleServerEvent(event) {
  switch (event.type) {
    case 'workspace:changed':
      // During active proving, skip full refresh to avoid page flicker —
      // the proof:completed/failed events will trigger refresh when done.
      if (isProving()) {
        render();
      } else {
        refresh();
      }
      break;
    case 'proof:started':
      // Only reset log if this is genuinely a new proof job (not a replayed
      // event after WS reconnect while the same job is still running).
      if (state.proofLog.length === 0 || state.proofLog[0]?.depositId !== event.depositId) {
        state.proofLog = [];
        state.proofStartTime = performance.now();
      }
      state.proofLog.push({ time: new Date(), message: `Started proving ${event.depositId}`, stage: 'started', depositId: event.depositId });
      pollQueue();
      break;
    case 'proof:note_progress': {
      const entry = {
        time: new Date(),
        message: event.message || `Note ${event.noteIndex + 1}/${event.totalNotes}`,
        stage: event.stage || 'proving',
      };
      if (event.elapsedSecs != null) entry.elapsed = event.elapsedSecs;
      if (event.noteElapsedSecs != null) entry.noteElapsed = event.noteElapsedSecs;
      if (event.blockNumber != null) entry.blockNumber = event.blockNumber;
      if (event.chainId != null) entry.chainId = event.chainId;
      state.proofLog.push(entry);
      pollQueue();
      break;
    }
    case 'proof:completed': {
      const totalElapsed = event.elapsedSecs
        ? formatElapsed(event.elapsedSecs)
        : state.proofStartTime
          ? formatElapsed((performance.now() - state.proofStartTime) / 1000)
          : '';
      state.proofLog.push({
        time: new Date(),
        message: `Proof complete${totalElapsed ? ` in ${totalElapsed}` : ''} \u2014 ${event.proofFile || ''}`,
        stage: 'completed',
      });
      state.proofStartTime = null;
      pollQueue();
      refresh();
      break;
    }
    case 'proof:failed':
      state.proofLog.push({
        time: new Date(),
        message: `Failed: ${event.error || 'unknown error'}`,
        stage: 'failed',
      });
      state.proofStartTime = null;
      pollQueue();
      refresh();
      break;
    case 'ws:connected':
      state.wsConnected = true;
      render();
      break;
    case 'ws:disconnected':
      state.wsConnected = false;
      render();
      break;
  }
}

function navigateTo(view, id = null) {
  state.fundingTxHash = null;
  if (view === 'detail' && id) {
    state.depositBalance = null; // reset while loading
    location.hash = `#/deposit/${encodeURIComponent(id)}`;
    // Load balance and note statuses async (will re-render when done)
    loadDepositBalance(id);
    loadAllNoteStatuses(id);
  } else if (view === 'settings') {
    state.depositBalance = null;
    location.hash = '#/settings';
  } else {
    state.depositBalance = null;
    location.hash = '#/';
  }
}

async function handleProve(depositId, force = false) {
  try {
    const job = await api.startProof(depositId, force);
    state.queueJob = job;
    render();
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('409') || msg.toLowerCase().includes('already running')) {
      showToast(
        'A proof job is already running. Use the Kill button in the banner above to stop it first.',
        'error',
      );
      // Refresh queue so banner appears
      pollQueue();
    } else {
      showToast(`Failed to start proof: ${msg}`, 'error');
    }
  }
}

async function loadDepositBalance(depositId) {
  try {
    const bal = await api.getDepositBalance(depositId);
    state.depositBalance = bal;
  } catch {
    state.depositBalance = { error: true };
  }
  render();
}

async function loadAllNoteStatuses(depositId) {
  const deposit = state.deposits.find((d) => d.id === depositId);
  if (!deposit) return;
  for (const note of deposit.notes) {
    if (note.claimStatus === 'unknown') {
      handleRefreshNote(depositId, note.index);
    }
  }
}

async function handleFundDeposit(deposit) {
  if (!state.walletAddress) {
    await handleConnectWallet();
    if (!state.walletAddress) return;
  }

  // Ensure wallet is on the deposit's chain
  const requiredChainHex = '0x' + parseInt(deposit.chainId, 10).toString(16);
  if (state.walletChainId !== requiredChainHex) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: requiredChainHex }],
      });
    } catch (switchErr) {
      showToast(`Please switch your wallet to ${networkName(deposit.chainId)} (chain ${deposit.chainId})`, 'error');
      return;
    }
  }

  const bal = state.depositBalance;
  if (!bal) { showToast('Balance not loaded yet', 'error'); return; }

  const dueWei = BigInt(bal.due);
  if (dueWei <= 0n) { showToast('Deposit already funded', 'info'); return; }

  try {
    showToast('Confirm the funding transaction in your wallet...', 'info');
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: state.walletAddress,
        to: deposit.targetAddress,
        value: '0x' + dueWei.toString(16),
      }],
    });
    state.fundingTxHash = txHash;
    showToast(`Funding tx submitted: ${txHash.slice(0, 18)}...`, 'success');
    render();
    // Re-check balance after 6s
    setTimeout(() => loadDepositBalance(deposit.id), 6000);
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('User denied') || msg.includes('rejected')) {
      showToast('Transaction rejected', 'error');
    } else {
      showToast(`Fund failed: ${msg}`, 'error');
    }
  }
}

async function handleCancelProof() {
  try {
    await api.cancelProof();
    await pollQueue();
  } catch (err) {
    showToast(`Failed to cancel: ${err.message}`, 'error');
  }
}

async function handleDeleteDeposit(id, includeProof) {
  try {
    await api.deleteDeposit(id, includeProof);
    if (state.view === 'detail' && state.selectedId === id) {
      navigateTo('list');
    }
    await refresh();
    showToast('Deposit deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

async function handleDeleteProof(id) {
  try {
    await api.deleteProof(id);
    await refresh();
    showToast('Proof deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete proof: ${err.message}`, 'error');
  }
}

async function handleRefreshNote(depositId, noteIndex) {
  try {
    const result = await api.refreshNoteStatus(depositId, noteIndex);
    const dep = state.deposits.find((d) => d.id === depositId);
    if (dep) {
      const note = dep.notes.find((n) => n.index === noteIndex);
      if (note) note.claimStatus = result.claimStatus;
    }
    render();
  } catch (err) {
    console.error('refresh note status failed:', err);
  }
}

async function handleConnectWallet() {
  if (!window.ethereum) {
    showToast('MetaMask not detected. Install it to claim on-chain.', 'error');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    state.walletAddress = accounts[0] || null;
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    state.walletChainId = chainId;
    render();
  } catch (err) {
    showToast(`Wallet connection failed: ${err.message}`, 'error');
  }
}

async function handleClaim(depositId, noteIndex) {
  if (!state.walletAddress) {
    await handleConnectWallet();
    if (!state.walletAddress) return;
  }

  try {
    showToast('Preparing claim transaction...', 'info');
    const txData = await api.getClaimTx(depositId, noteIndex);

    // Verify wallet is on the correct chain
    if (state.walletChainId && state.walletChainId !== txData.chainId) {
      showToast(`Switch MetaMask to chain ${parseInt(txData.chainId, 16)}`, 'error');
      return;
    }

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: state.walletAddress,
        to: txData.to,
        data: txData.data,
        value: '0x0',
      }],
    });

    state.claimTxHashes[`${depositId}-${noteIndex}`] = txHash;
    showToast(`Claim submitted! TX: ${txHash.slice(0, 18)}...`, 'success');
    render();

    // Refresh note status after a delay (wait for indexing)
    setTimeout(() => handleRefreshNote(depositId, noteIndex), 5000);
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('User denied') || msg.includes('rejected')) {
      showToast('Transaction rejected by user', 'error');
    } else {
      showToast(`Claim failed: ${msg}`, 'error');
    }
  }
}

async function handleImportDeposit(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file, file.name);
  try {
    const resp = await fetch('/api/deposits/import', { method: 'POST', body: formData });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(text);
    }
    showToast(`Imported ${file.name}`, 'success');
    await refresh();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  }
  e.target.value = ''; // Reset so same file can be re-imported
}

async function handleMineDeposit(formData) {
  state.mining = true;
  render();

  try {
    const chainId = formData.chainId || state.config?.chainId;
    if (!chainId) { showToast('Chain ID not available — check server RPC config', 'error'); state.mining = false; render(); return; }
    const result = await api.createDeposit(chainId, formData.notes, formData.comment);
    state.showMiningForm = false;
    state.mining = false;
    state.miningNotes = null;
    state.miningComment = '';
    state.miningErrors = {};
    showToast('Deposit created!', 'success');
    await refresh();
  } catch (err) {
    state.mining = false;
    showToast(`Create failed: ${err.message}`, 'error');
    render();
  }
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

function showToast(message, type = 'info') {
  // Remove existing toast
  document.querySelectorAll('.toast').forEach((t) => t.remove());

  const toast = el('div', { className: `toast toast-${type}` }, message);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  app.innerHTML = '';
  app.appendChild(renderHeader());

  // Global proof job banner
  const banner = renderProofJobBanner();
  if (banner) app.appendChild(banner);

  if (state.loading) {
    app.appendChild(el('div', { className: 'empty-state' }, [
      el('div', { className: 'spinner' }),
      el('p', { style: 'margin-top: 1rem' }, 'Loading workspace...'),
    ]));
    return;
  }

  if (state.error) {
    app.appendChild(
      el('div', { className: 'empty-state' }, [
        el('p', {}, `Error: ${state.error}`),
        el('button', { className: 'btn', onclick: refresh }, 'Retry'),
      ]),
    );
    return;
  }

  if (state.view === 'settings') {
    app.appendChild(renderSettingsView());
    requestAnimationFrame(() => {
      const inp = document.getElementById('settings-rpc');
      if (inp) inp.value = localStorage.getItem('shadow-rpc') || state.config?.rpcUrl || '';
    });
  } else if (state.view === 'detail' && state.selectedId) {
    app.appendChild(renderDetailView());
  } else {
    app.appendChild(renderListView());
  }

}


function renderHeader() {
  const headerLeft = el('div', { className: 'header-left' }, [
    el('div', { className: 'header-title-group' }, [
      el('h1', { onclick: () => navigateTo('list') }, 'Shadow'),
      el('span', { className: 'header-network' }, state.config?.chainId ? `on ${networkName(state.config.chainId)}` : ''),
    ]),
    el('span', { className: 'header-count' },
      `${state.deposits.length} deposit${state.deposits.length !== 1 ? 's' : ''}`),
  ]);

  const headerActions = el('div', { className: 'header-actions' }, [
    state.walletAddress
      ? el('span', { className: 'wallet-badge' }, [
          el('span', { className: 'wallet-dot' }),
          state.walletAddress,
        ])
      : window.ethereum
        ? el('button', {
            className: 'btn btn-small',
            onclick: handleConnectWallet,
          }, 'Connect Wallet')
        : null,
    el('button', {
      className: 'btn-icon',
      onclick: () => navigateTo('settings'),
      title: 'Settings',
    }, [settingsIcon()]),
    el('button', {
      className: 'btn-icon',
      onclick: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
      title: 'Toggle theme',
    }, [getTheme() === 'dark' ? sunIcon() : moonIcon()]),
  ].filter(Boolean));

  return el('div', { className: 'header' }, [headerLeft, headerActions]);
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function makeImportButton() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  input.addEventListener('change', handleImportDeposit);

  const label = document.createElement('label');
  label.className = 'btn btn-small';
  label.title = 'Import an existing deposit JSON file';
  label.style.cursor = 'pointer';
  label.textContent = 'Import Deposit';
  label.appendChild(input);
  return label;
}

function renderListView() {
  const items = [];

  // Tagline / hero description
  items.push(el('p', { className: 'list-tagline' }, [
    'Inspired by ',
    el('a', { href: 'https://eips.ethereum.org/EIPS/eip-7503', target: '_blank', rel: 'noopener' }, 'EIP-7503 Wormholes'),
    ', but adapted for Taiko: funding transfers are ordinary ETH sent to EOAs with no on-chain trace of privacy involvement — ZK proofs enable unlinkable claims to prespecified addresses. ',
    el('a', { href: 'https://github.com/taikoxyz/shadow', target: '_blank', rel: 'noopener' }, 'View more on GitHub'),
    '.',
  ]));

  // Mining form
  if (state.showMiningForm) {
    items.push(renderMiningForm());
  }

  if (!state.showMiningForm) {
    items.push(el('div', { style: 'margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: center' }, [
      el('button', {
        className: 'btn btn-primary',
        disabled: isProving(),
        title: isProving() ? 'Proof generation in progress' : undefined,
        onclick: () => { state.showMiningForm = true; render(); },
      }, '+ New Deposit'),
      makeImportButton(),
    ]));
  }

  items.push(
    el('div', { className: 'deposit-list' }, state.deposits.map(renderDepositCard)),
  );

  return el('div', {}, items);
}

function renderDepositCard(deposit) {
  const totalEth = weiToEth(deposit.totalAmount);
  const cs = cardStatus(deposit);
  const statusBadge = el('span', { className: `badge ${cs.cls}` }, cs.label);

  return el(
    'div',
    {
      className: 'deposit-card',
      onclick: () => navigateTo('detail', deposit.id),
    },
    [
      el('div', { className: 'deposit-card-header' }, [
        el('div', { className: 'deposit-card-title' }, [
          depositFileIcon(),
          el('span', { className: 'deposit-card-id' }, truncateDepositId(deposit.id)),
        ]),
        statusBadge,
      ]),
      el('div', { className: 'deposit-card-meta' }, [
        el('span', {}, `${deposit.noteCount} note${deposit.noteCount !== 1 ? 's' : ''}`),
        el('span', {}, `${totalEth} ETH`),
        el('span', {}, `Chain ${deposit.chainId}`),
        deposit.createdAt ? el('span', { title: formatDate(deposit.createdAt) }, timeAgo(deposit.createdAt)) : null,
      ].filter(Boolean)),
    ],
  );
}

// ---------------------------------------------------------------------------
// Mining Form
// ---------------------------------------------------------------------------

function renderMiningForm() {
  // Form state lives in state.miningNotes / state.miningComment so it
  // survives render() calls triggered by pollQueue / WebSocket events.
  if (!state.miningNotes) {
    state.miningNotes = [{ recipient: '', amount: '', label: '' }];
    state.miningComment = '';
  }

  const container = el('div', { className: 'mining-panel' });

  function saveNoteData() {
    state.miningNotes.forEach((note, i) => {
      const r = document.getElementById(`mine-recipient-${i}`);
      const a = document.getElementById(`mine-amount-${i}`);
      const l = document.getElementById(`mine-label-${i}`);
      if (r) note.recipient = r.value;
      if (a) note.amount = a.value;
      if (l) note.label = l.value;
    });
    const c = document.getElementById('mine-comment');
    if (c) state.miningComment = c.value;
  }

  function addNote() {
    saveNoteData();
    if (state.miningNotes.length < 5) state.miningNotes.push({ recipient: '', amount: '', label: '' });
    renderFormContent();
  }

  function removeNote(i) {
    saveNoteData();
    state.miningNotes.splice(i, 1);
    renderFormContent();
  }

  const MAX_TOTAL_WEI = BigInt('8000000000000000000'); // 8 ETH

  // Helper: set an error in state and update DOM if element exists.
  // key is e.g. 'recipient-0', 'amount-1', 'total'.
  // Error span IDs: mine-recipient-error-0, mine-amount-error-1, mine-total-error.
  // Input IDs: mine-recipient-0, mine-amount-1.
  function setFieldError(key, msg) {
    if (msg) {
      state.miningErrors[key] = msg;
    } else {
      delete state.miningErrors[key];
    }
    // Build DOM IDs: split key like 'recipient-0' into field + index
    const dash = key.lastIndexOf('-');
    const hasIndex = dash > 0 && !isNaN(key.slice(dash + 1));
    const errId = hasIndex
      ? `mine-${key.slice(0, dash)}-error-${key.slice(dash + 1)}`
      : `mine-${key}-error`;
    const inputId = hasIndex
      ? `mine-${key.slice(0, dash)}-${key.slice(dash + 1)}`
      : null;

    const errEl = document.getElementById(errId);
    if (errEl) errEl.textContent = msg || '';
    if (inputId) {
      const inputEl = document.getElementById(inputId);
      if (inputEl) {
        if (msg) inputEl.classList.add('form-input-invalid');
        else inputEl.classList.remove('form-input-invalid');
      }
    }
  }

  function validateAmountField(i, requireNonEmpty) {
    const val = state.miningNotes[i].amount.trim();
    const key = `amount-${i}`;

    if (!val && requireNonEmpty) {
      setFieldError(key, 'Amount is required.');
      return;
    }
    const weiStr = ethToWei(val);
    if (val && (!weiStr || weiStr === '0')) {
      setFieldError(key, 'Must be a positive number.');
      return;
    }
    if (val && weiStr) {
      const wei = BigInt(weiStr);
      if (wei < BigInt('1000000000000')) {
        setFieldError(key, 'Amount too small (min ~0.000001 ETH).');
        return;
      }
    }
    setFieldError(key, '');
    validateTotalCap();
  }

  function validateTotalCap() {
    saveNoteData();
    let total = BigInt(0);
    let allValid = true;
    for (const note of state.miningNotes) {
      const weiStr = ethToWei(note.amount.trim());
      if (!weiStr || weiStr === '0') { allValid = false; continue; }
      total += BigInt(weiStr);
    }
    const msg = (allValid && total > MAX_TOTAL_WEI)
      ? `Total ${weiToEth(total.toString())} ETH exceeds 8 ETH cap.`
      : '';
    setFieldError('total', msg);
  }

  function validateRecipientField(i, requireNonEmpty) {
    const val = state.miningNotes[i].recipient.trim();
    const key = `recipient-${i}`;

    if (val && !val.match(/^0x[0-9a-fA-F]{40}$/)) {
      setFieldError(key, 'Invalid address — must be 0x followed by 40 hex characters.');
    } else if (!val && requireNonEmpty) {
      setFieldError(key, 'Recipient address is required.');
    } else {
      setFieldError(key, '');
    }
    // Wallet warning
    const wallet = state.walletAddress?.toLowerCase();
    const warnEl = document.getElementById(`mine-recipient-warn-${i}`);
    if (warnEl) {
      warnEl.textContent = (wallet && val.toLowerCase() === wallet)
        ? 'Warning: using your connected wallet as recipient may reveal your identity on-chain.'
        : '';
    }
  }

  function renderFormContent() {
    container.innerHTML = '';

    const header = el('div', { className: 'mining-panel-header' }, [
      el('h3', {}, 'New Deposit'),
      el('button', {
        className: 'btn-icon',
        onclick: () => { state.showMiningForm = false; state.miningNotes = null; state.miningComment = ''; state.miningErrors = {}; render(); },
        title: 'Close',
      }, '\u2715'),
    ]);
    container.appendChild(header);

    // Chain ID (from server config)
    const chainId = state.config?.chainId;

    // Comment field
    container.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label' }, 'Comment (optional)'),
      el('textarea', {
        className: 'form-input',
        id: 'mine-comment',
        placeholder: 'Describe this deposit...',
        style: 'min-height: 56px; resize: vertical; font-family: inherit',
        oninput: (e) => { state.miningComment = e.target.value; },
      }),
    ]));
    // Restore comment value (textarea ignores value= prop, needs rAF)
    requestAnimationFrame(() => {
      const c = document.getElementById('mine-comment');
      if (c) c.value = state.miningComment;
    });

    // Notes section header
    container.appendChild(el('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem',
    }, [
      el('span', { className: 'form-label', style: 'margin-bottom:0' }, 'Notes (max 8 ETH total)'),
      state.miningNotes.length < 5
        ? el('button', {
            className: 'btn btn-small',
            onclick: addNote,
          }, '+ Add Note')
        : null,
    ].filter(Boolean)));

    // Note entries
    state.miningNotes.forEach((note, i) => {
      const noteEl = el('div', { className: 'note-entry' }, [
        el('div', { className: 'note-entry-header' }, [
          `Note #${i}`,
          i > 0
            ? el('button', {
                className: 'btn-icon',
                onclick: () => removeNote(i),
                title: 'Remove',
              }, '\u2715')
            : null,
        ].filter(Boolean)),

        el('div', { className: 'form-row' }, [
          el('div', { className: 'form-group', style: 'flex:2' }, [
            el('label', { className: 'form-label' }, 'Recipient'),
            el('input', {
              className: state.miningErrors[`recipient-${i}`] ? 'form-input form-input-invalid' : 'form-input',
              id: `mine-recipient-${i}`,
              placeholder: '0x...',
              value: note.recipient,
              oninput: (e) => { state.miningNotes[i].recipient = e.target.value; },
              onblur: (e) => {
                state.miningNotes[i].recipient = e.target.value;
                validateRecipientField(i, false);
              },
            }),
            el('span', { className: 'form-field-error', id: `mine-recipient-error-${i}` },
              state.miningErrors[`recipient-${i}`] || ''),
            el('span', { className: 'form-field-warn', id: `mine-recipient-warn-${i}` }, ''),
          ]),
          el('div', { className: 'form-group', style: 'flex:1' }, [
            el('label', { className: 'form-label' }, 'Amount (ETH)'),
            el('input', {
              className: state.miningErrors[`amount-${i}`] ? 'form-input form-input-invalid' : 'form-input',
              id: `mine-amount-${i}`,
              placeholder: '0.001',
              type: 'text',
              value: note.amount,
              oninput: (e) => { state.miningNotes[i].amount = e.target.value; },
              onblur: (e) => {
                state.miningNotes[i].amount = e.target.value;
                validateAmountField(i, false);
              },
            }),
            el('span', { className: 'form-field-error', id: `mine-amount-error-${i}` },
              state.miningErrors[`amount-${i}`] || ''),
          ]),
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label' }, 'Label (optional)'),
          el('input', {
            className: 'form-input',
            id: `mine-label-${i}`,
            placeholder: `note #${i}`,
            style: 'max-width: 300px',
            value: note.label,
            oninput: (e) => { state.miningNotes[i].label = e.target.value; },
          }),
        ]),
      ]);
      container.appendChild(noteEl);
    });

    // Total cap error (shown between notes and submit)
    container.appendChild(el('span', { className: 'form-field-error', id: 'mine-total-error' },
      state.miningErrors['total'] || ''));

    // Submit row
    const actions = el('div', { style: 'margin-top: 1rem; display:flex; gap:0.5rem; align-items:center' }, [
      el('button', {
        className: 'btn btn-primary',
        disabled: state.mining,
        onclick: () => {
          saveNoteData();

          // Run all field validations (shows errors below each input)
          state.miningNotes.forEach((_, idx) => {
            validateRecipientField(idx, true);
            validateAmountField(idx, true);
          });
          validateTotalCap();

          if (Object.keys(state.miningErrors).length > 0) return;

          const parsedNotes = state.miningNotes.map((note) => ({
            recipient: note.recipient.trim(),
            amount: ethToWei(note.amount.trim()) || '0',
            label: note.label.trim() || undefined,
          }));

          const commentEl = document.getElementById('mine-comment');
          const commentVal = commentEl?.value?.trim() || undefined;

          handleMineDeposit({ notes: parsedNotes, comment: commentVal, chainId });
        },
      }, state.mining ? 'Creating...' : 'Create Deposit'),
      state.mining ? el('span', { className: 'spinner' }) : null,
      state.mining
        ? el('span', { className: 'mining-status' }, 'Creating deposit...')
        : null,
    ].filter(Boolean));
    container.appendChild(actions);
  }

  renderFormContent();
  return container;
}

// ---------------------------------------------------------------------------
// Detail View
// ---------------------------------------------------------------------------

/** Deposit filename row with view + download + delete buttons. */
function depositFileRow(deposit) {
  const downloadUrl = `/api/deposits/${encodeURIComponent(deposit.id)}/download`;
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, 'Filename'),
    el('div', { className: 'file-row-value' }, [
      el('span', { className: 'detail-value file-name' }, deposit.filename),
      el('button', {
        className: 'btn btn-small btn-icon-label',
        title: 'View file',
        onclick: () => viewFileModal(deposit.filename, downloadUrl),
      }, [eyeIcon()]),
      el('a', {
        href: downloadUrl,
        className: 'btn btn-small btn-icon-label',
        download: true,
        title: 'Download deposit file',
      }, [lucideIcon(ArrowDownToLine)]),
      el('button', {
        className: 'btn btn-danger btn-small btn-icon-label',
        title: 'Delete deposit',
        onclick: () => confirmAction(
          'Delete deposit?',
          `This will permanently delete ${deposit.filename}${deposit.hasProof ? ' and its proof file' : ''}.`,
          () => handleDeleteDeposit(deposit.id, true),
        ),
      }, [lucideIcon(X)]),
    ]),
  ]);
}

/** Proof file row with view + download + delete buttons (or "None" if no proof). */
function proofFileRow(deposit, status) {
  if (!deposit.hasProof) return isProving() ? null : detailRow('Proof', 'None');
  const downloadUrl = `/api/deposits/${encodeURIComponent(deposit.id)}/proof/download`;
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, 'Proof'),
    el('div', { className: 'file-row-value' }, [
      deposit.proofValid === false
        ? el('span', { className: 'badge badge-no-proof', style: 'flex-shrink:0' }, 'Invalid')
        : null,
      el('span', { className: 'detail-value file-name' }, deposit.proofFile || '\u2014'),
      el('button', {
        className: 'btn btn-small btn-icon-label',
        title: 'View file',
        onclick: () => viewFileModal(deposit.proofFile || 'proof.json', downloadUrl),
      }, [eyeIcon()]),
      el('a', {
        href: downloadUrl,
        className: 'btn btn-small btn-icon-label',
        download: true,
        title: 'Download proof file',
      }, [lucideIcon(ArrowDownToLine)]),
      status !== 'proving'
        ? el('button', {
            className: 'btn btn-danger btn-small',
            title: 'Delete proof',
            onclick: () => confirmAction(
              'Delete proof file?',
              `This will delete ${deposit.proofFile}. The deposit file will remain.`,
              () => handleDeleteProof(deposit.id),
            ),
          }, [lucideIcon(X)])
        : null,
    ].filter(Boolean)),
  ]);
}

function renderDetailView() {
  const deposit = state.deposits.find((d) => d.id === state.selectedId);
  if (!deposit) {
    return el('div', { className: 'empty-state' }, [
      el('p', {}, 'Deposit not found'),
      el('button', { className: 'btn', onclick: () => navigateTo('list') }, 'Back'),
    ]);
  }

  const totalEth = weiToEth(deposit.totalAmount);
  const status = depositStatus(deposit);

  // Proof action button / hint (shown inside Proofs section)
  const proofAction = (() => {
    if (status === 'proving') {
      return el('span', { style: 'font-size: 0.78rem' }, 'Proof generation in progress \u2014 see banner above');
    }
    if (deposit.hasProof) {
      return el('button', {
        className: 'btn',
        onclick: () => handleProve(deposit.id, true),
        disabled: isProving(),
      }, 'Regenerate Proof');
    }
    return el('button', {
      className: 'btn btn-primary',
      onclick: () => handleProve(deposit.id),
      disabled: isProving() || status === 'unfunded',
      title: status === 'unfunded' ? 'Fund the deposit first' : undefined,
    }, 'Generate Proof');
  })();

  // Fund button or submitted tx link
  const fundAction = (() => {
    if (status !== 'unfunded') return null;
    if (state.fundingTxHash) {
      const explorer = explorerUrl(deposit.chainId);
      const txExplorerUrl = explorer ? `${explorer}/tx/${state.fundingTxHash}` : '';
      return el('p', { style: 'margin-top: 0.5rem; font-size: 0.82rem' }, [
        'Funding tx submitted: ',
        el('a', { href: txExplorerUrl, target: '_blank', rel: 'noopener', style: 'color: var(--accent-blue)' },
          `${state.fundingTxHash.slice(0, 18)}...`),
      ]);
    }
    if (window.ethereum) {
      return el('div', { className: 'actions', style: 'margin-top: 0.75rem; justify-content: flex-end' }, [
        el('button', {
          className: 'btn btn-primary',
          onclick: () => handleFundDeposit(deposit),
        }, 'Fund Deposit'),
      ]);
    }
    return el('p', { className: 'form-hint', style: 'margin-top: 0.5rem' },
      `Send ${weiToEth(state.depositBalance?.due || '0')} ETH to ${deposit.targetAddress}`);
  })();

  return el('div', {}, [
    // Breadcrumb
    el('div', { className: 'breadcrumb' }, [
      el('a', { onclick: () => navigateTo('list') }, 'Deposits'),
      ' / ',
      depositFileIcon(),
      el('span', {}, truncateDepositId(deposit.id)),
    ]),

    // Comment (if present)
    deposit.comment
      ? el('p', { className: 'deposit-comment' }, deposit.comment)
      : null,

    // Overview
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Overview'),
      depositFileRow(deposit),
      detailRow('Network', `${networkName(deposit.chainId)} (${deposit.chainId})`),
      addressRow('Target Address', deposit.targetAddress, deposit.chainId),
      detailRow('Total Amount', `${totalEth} ETH (${deposit.totalAmount} wei)`),
      detailRow('Notes', String(deposit.noteCount)),
      deposit.createdAt ? detailRow('Created', formatDate(deposit.createdAt)) : null,
    ].filter(Boolean)),

    // Funding Status
    state.depositBalance?.error
      ? el('div', { className: 'detail-section' }, [
          el('h2', {}, 'Funding Status'),
          el('p', { className: 'form-hint' }, 'Could not load balance \u2014 RPC may be unavailable.'),
        ])
      : state.depositBalance
        ? el('div', { className: 'detail-section' }, [
            el('h2', {}, 'Funding Status'),
            addressRow('Target Address', deposit.targetAddress, deposit.chainId),
            detailRow('Required', `${weiToEth(state.depositBalance.required)} ETH`),
            detailRow('On-chain Balance', `${weiToEth(state.depositBalance.balance)} ETH`),
            !state.depositBalance.isFunded
              ? detailRow('Balance Due', `${weiToEth(state.depositBalance.due)} ETH`)
              : null,
            detailRow('Status', state.depositBalance.isFunded ? 'Funded' : 'Unfunded \u2014 send ETH to target address'),
            fundAction,
          ].filter(Boolean))
        : el('div', { className: 'detail-section' }, [
            el('h2', {}, 'Funding Status'),
            el('p', { className: 'form-hint' }, 'Loading balance...'),
          ]),

    // Proofs (hidden until funded)
    status !== 'unfunded' ? el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Proofs'),
      proofFileRow(deposit, status),
      // Show failure details while the failed job is not yet dismissed
      status === 'failed' && state.queueJob?.error
        ? el('div', { className: 'proof-failure-detail' }, [
            el('span', { className: 'proof-failure-label' }, 'Error'),
            el('pre', { className: 'proof-failure-msg' }, state.queueJob.error),
          ])
        : null,
      proofAction
        ? el('div', { className: 'actions', style: 'margin-top: 0.75rem; justify-content: flex-end' }, [proofAction])
        : null,
    ].filter(Boolean)) : null,

    // Notes
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Notes'),
      renderNotesTable(deposit),
    ]),
  ].filter(Boolean));
}

function renderNotesTable(deposit) {
  return el('table', { className: 'notes-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, '#'),
        el('th', {}, 'Recipient'),
        el('th', {}, 'Amount'),
        el('th', {}, 'Status'),
        el('th', {}, ''),
      ]),
    ]),
    el(
      'tbody',
      {},
      deposit.notes.map((note) =>
        el('tr', {}, [
          el('td', {}, String(note.index)),
          el('td', {
            style: `font-family: var(--font-mono); font-size: 0.78rem; word-break: break-all`,
          }, [
            (() => {
              const a = document.createElement('a');
              const explorer = explorerUrl(deposit.chainId);
              a.href = explorer ? `${explorer}/address/${note.recipient}` : '#';
              a.target = '_blank';
              a.rel = 'noopener';
              a.textContent = note.recipient;
              a.className = 'detail-address-link';
              return a;
            })(),
          ]),
          el('td', {}, `${weiToEth(note.amount)} ETH`),
          el('td', {}, [
            el('span', { className: `badge badge-${note.claimStatus}` }, note.claimStatus),
          ]),
          el('td', {}, [
            (() => {
              const claimTx = state.claimTxHashes[`${deposit.id}-${note.index}`];
              if (claimTx) {
                const url = `${explorerUrl(deposit.chainId)}/tx/${claimTx}`;
                return el('div', { style: 'font-size: 0.78rem' }, [
                  el('a', { href: url, target: '_blank', rel: 'noopener', style: 'color: var(--accent-blue)' },
                    `TX: ${claimTx.slice(0, 18)}...`),
                ]);
              }
              return el('div', { className: 'note-actions' }, [
                // Claim button (only if deposit has proof and note is unclaimed)
                deposit.hasProof && note.claimStatus !== 'claimed'
                  ? el(
                      'button',
                      {
                        className: 'btn btn-accent btn-small',
                        onclick: (e) => {
                          e.stopPropagation();
                          handleClaim(deposit.id, note.index);
                        },
                        title: 'Claim on-chain via MetaMask',
                      },
                      'Claim',
                    )
                  : null,
                el(
                  'button',
                  {
                    className: 'btn-icon',
                    onclick: (e) => {
                      e.stopPropagation();
                      handleRefreshNote(deposit.id, note.index);
                    },
                    title: 'Refresh on-chain status',
                  },
                  [lucideIcon(RefreshCcw)],
                ),
              ].filter(Boolean));
            })(),
          ]),
        ]),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Proof Job Banner (shown globally when a job is active)
// ---------------------------------------------------------------------------

function renderProofJobBanner() {
  const job = state.queueJob;
  if (!job || !['queued', 'running', 'failed'].includes(job.status)) return null;

  const isFailed = job.status === 'failed';
  const pct = job.totalNotes > 0 ? Math.round((job.currentNote / job.totalNotes) * 100) : 0;
  const elapsedStr = state.proofStartTime
    ? formatElapsed((performance.now() - state.proofStartTime) / 1000)
    : '';

  const expanded = state.bannerExpanded;

  return el('div', { className: `proof-banner${isFailed ? ' proof-banner-failed' : ''}` }, [
    el('div', { className: 'proof-banner-top' }, [
    el('div', { className: 'proof-banner-info' }, [
      isFailed
        ? el('span', {}, '\u26a0\ufe0f')
        : el('span', { className: 'spinner' }),
      el('div', { style: 'display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0' }, [
        isFailed
          ? el('span', {}, ` Proof failed \u2014 ${job.error || job.message || 'unknown error'}`)
          : el('span', {}, [
              ` ${job.message || 'Proving...'}`,
              elapsedStr ? el('span', { style: 'opacity: 0.6' }, ` (${elapsedStr})`) : null,
              ' in ',
              el('a', {
                href: `#/deposit/${encodeURIComponent(job.depositId)}`,
                className: 'detail-address-link',
              }, job.depositId),
            ].filter(Boolean)),
        isFailed ? null : el('span', { style: 'font-size: 0.75rem; opacity: 0.7' },
          'Your fan noise is the sound of privacy being forged. Hang tight \u2615'),
      ].filter(Boolean)),
    ]),
    el('div', { className: 'proof-banner-right' }, [
      !isFailed
        ? el('button', {
            className: 'btn btn-small',
            style: 'font-size: 0.72rem;',
            onclick: () => { state.bannerExpanded = !state.bannerExpanded; render(); },
          }, expanded ? 'Hide log' : 'Show log')
        : null,
      el('button', {
        className: 'btn btn-danger btn-small',
        onclick: isFailed ? () => { api.cancelProof().catch(() => {}); state.queueJob = null; render(); } : handleCancelProof,
      }, isFailed ? 'Dismiss' : 'Kill Current Job'),
    ].filter(Boolean)),  // proof-banner-right
    ]),                  // proof-banner-top
    null,
    expanded
      ? el('div', { className: 'proof-banner-log' },
          state.proofLog.length > 0
            ? state.proofLog.map(entry =>
                el('div', { className: 'proof-log-entry' }, [
                  el('span', { className: 'proof-log-time' }, formatLogTime(entry.time)),
                  el('span', {}, entry.message),
                  entry.noteElapsed
                    ? el('span', { className: 'proof-log-timing' }, `${entry.noteElapsed.toFixed(1)}s`)
                    : null,
                  entry.blockNumber
                    ? el('span', { className: 'proof-log-detail' }, `blk #${entry.blockNumber}`)
                    : null,
                ].filter(Boolean))
              )
            : [el('div', { className: 'proof-log-entry' }, [
                el('span', { className: 'proof-log-time' }, '—'),
                el('span', { style: 'opacity: 0.6' }, 'Waiting for events...'),
              ])]
        )
      : null,
  ].filter(Boolean));
}

// ---------------------------------------------------------------------------
// Settings View
// ---------------------------------------------------------------------------

function renderSettingsView() {
  return el('div', {}, [
    el('div', { className: 'breadcrumb' }, [
      el('a', { onclick: () => navigateTo('list') }, 'Home'),
      ' / Settings',
    ]),

    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'RPC Endpoint'),
      el('p', { className: 'form-hint', style: 'margin-bottom: 0.75rem' },
        `Used by the UI for balance checks. Proof generation uses the server\u2019s RPC. Clear to use default: ${state.config?.rpcUrl || defaultRpc(state.config?.chainId) || ''}`),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label' }, 'JSON-RPC URL'),
        el('input', {
          className: 'form-input',
          id: 'settings-rpc',
          placeholder: state.config?.rpcUrl || defaultRpc(state.config?.chainId) || '',
        }),
      ]),
      el('button', {
        className: 'btn btn-primary',
        onclick: () => {
          const val = document.getElementById('settings-rpc')?.value?.trim();
          if (val) {
            localStorage.setItem('shadow-rpc', val);
          } else {
            localStorage.removeItem('shadow-rpc');
          }
          showToast('Settings saved', 'success');
        },
      }, 'Save'),
    ]),

    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Appearance'),
      el('div', { style: 'display: flex; align-items: center; gap: 0.75rem' }, [
        el('span', { style: 'font-size: 0.82rem; color: var(--text-secondary)' }, 'Theme:'),
        el('button', {
          className: `btn btn-small${getTheme() === 'dark' ? ' btn-accent' : ''}`,
          onclick: () => setTheme('dark'),
        }, `${getTheme() === 'dark' ? '\u2713 ' : ''}Dark`),
        el('button', {
          className: `btn btn-small${getTheme() === 'light' ? ' btn-accent' : ''}`,
          onclick: () => setTheme('light'),
        }, `${getTheme() === 'light' ? '\u2713 ' : ''}Light`),
      ]),
    ]),

    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Server Info'),
      state.config
        ? el('div', {}, [
            detailRow('Version', `v${state.config.version}`),
            state.config.shadowAddress ? detailRow('Shadow Contract', state.config.shadowAddress) : null,
            state.config.circuitId ? detailRow('Circuit ID', state.config.circuitId) : null,
            state.config.verifierAddress ? detailRow('Verifier', state.config.verifierAddress) : null,
            state.config.rpcUrl ? detailRow('RPC URL', state.config.rpcUrl) : null,
          ].filter(Boolean))
        : el('p', { className: 'form-hint' }, 'Server not connected'),
    ]),

    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Debug Logging'),
      el('p', { className: 'form-hint', style: 'margin-bottom: 0.75rem' },
        'Enable verbose console logging for debugging WebSocket events, API calls, and proof progress.'),
      el('button', {
        className: `btn btn-small${localStorage.getItem('shadow-debug') === '1' ? ' btn-accent' : ''}`,
        onclick: () => {
          const current = localStorage.getItem('shadow-debug') === '1';
          if (current) localStorage.removeItem('shadow-debug');
          else localStorage.setItem('shadow-debug', '1');
          render();
        },
      }, localStorage.getItem('shadow-debug') === '1' ? 'Disable Debug Logging' : 'Enable Debug Logging'),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Confirm Dialog
// ---------------------------------------------------------------------------

function confirmAction(title, message, onConfirm) {
  const overlay = el('div', { className: 'dialog-overlay' }, [
    el('div', { className: 'dialog-box' }, [
      el('h3', {}, title),
      el('p', {}, message),
      el('div', { className: 'dialog-actions' }, [
        el('button', {
          className: 'btn',
          onclick: () => overlay.remove(),
        }, 'Cancel'),
        el('button', {
          className: 'btn btn-danger',
          onclick: () => { overlay.remove(); onConfirm(); },
        }, 'Confirm'),
      ]),
    ]),
  ]);
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isProving() {
  return state.queueJob && ['queued', 'running'].includes(state.queueJob.status);
}

function depositStatus(deposit) {
  // If a proof job is active or failed for this deposit
  if (state.queueJob && state.queueJob.depositId === deposit.id) {
    if (['queued', 'running'].includes(state.queueJob.status)) return 'proving';
    if (state.queueJob.status === 'failed') return 'failed';
  }
  // Check funding state
  if (state.depositBalance && !state.depositBalance.isFunded) return 'unfunded';
  // Check proof state
  if (!deposit.hasProof) return 'unproved';
  // Check claim state
  const notes = deposit.notes || [];
  const allClaimed = notes.length > 0 && notes.every(n => n.claimStatus === 'claimed');
  const anyClaimed = notes.some(n => n.claimStatus === 'claimed');
  if (allClaimed) return 'claimed';
  if (anyClaimed) return 'partial';
  return 'proved';
}

function cardStatus(deposit) {
  // Show proving/failed state if a queue job targets this deposit
  const job = state.queueJob;
  if (job && job.depositId === deposit.id) {
    if (job.status === 'running' || job.status === 'queued')
      return { label: 'Proving…', cls: 'badge-proving' };
    if (job.status === 'failed')
      return { label: 'Proof Failed', cls: 'badge-failed' };
  }
  if (!deposit.hasProof) return { label: 'Unproved', cls: 'badge-no-proof' };
  const notes = deposit.notes || [];
  const allClaimed = notes.length > 0 && notes.every(n => n.claimStatus === 'claimed');
  const anyClaimed = notes.some(n => n.claimStatus === 'claimed');
  if (allClaimed) return { label: 'Claimed', cls: 'badge-claimed' };
  if (anyClaimed) return { label: 'Partial', cls: 'badge-claimed' };
  return { label: 'Proved', cls: 'badge-proof' };
}

function weiToEth(weiStr) {
  try {
    const wei = BigInt(weiStr || '0');
    if (wei === 0n) return '0';
    // Use string math to avoid floating point errors
    const str = wei.toString().padStart(19, '0');
    const intPart = str.slice(0, -18) || '0';
    const fracPart = str.slice(-18).replace(/0+$/, '');
    if (!fracPart) return intPart;
    // Trim to max 6 significant decimal places for display
    const trimmed = fracPart.slice(0, 6).replace(/0+$/, '');
    return `${intPart}.${trimmed}`;
  } catch {
    return '0';
  }
}

function ethToWei(ethStr) {
  // Convert ETH string to wei BigInt, returns null on parse error
  try {
    const s = ethStr.trim();
    if (!s || isNaN(parseFloat(s))) return null;
    const [intPart = '0', fracPart = ''] = s.split('.');
    const fracPadded = (fracPart + '000000000000000000').slice(0, 18);
    return (BigInt(intPart) * BigInt('1000000000000000000') + BigInt(fracPadded)).toString();
  } catch {
    return null;
  }
}

function truncateAddr(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function truncateDepositId(id) {
  if (!id) return '';
  // "deposit-ffe8-fde9-20260224T214613" → show as-is (already compact enough)
  return id;
}

function formatElapsed(secs) {
  if (secs < 60) return `${Math.round(secs)}s`;
  const min = Math.floor(secs / 60);
  const sec = Math.round(secs % 60);
  return `${min}m ${sec}s`;
}

function formatLogTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString();
  } catch {
    return isoStr;
  }
}

function timeAgo(isoStr) {
  try {
    const sec = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
    const yr = Math.floor(mo / 12);
    return `${yr} year${yr === 1 ? '' : 's'} ago`;
  } catch {
    return isoStr;
  }
}

function detailRow(label, value) {
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, label),
    el('span', { className: 'detail-value' }, value || '\u2014'),
  ]);
}

function addressRow(label, address, chainId) {
  const link = document.createElement('a');
  const explorer = explorerUrl(chainId);
  link.href = explorer ? `${explorer}/address/${address}` : '#';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = address;
  link.className = 'detail-address-link';
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, label),
    el('span', { className: 'detail-value' }, [link]),
  ]);
}

/** Returns a <span> containing an eye SVG icon (used on View buttons). */
const eyeIcon        = () => lucideIcon(Eye);
const settingsIcon   = () => lucideIcon(Settings);
const sunIcon        = () => lucideIcon(Sun);
const moonIcon       = () => lucideIcon(Moon);
const depositFileIcon = () => lucideIcon(FileKey, 'deposit-file-icon');

/** Pretty-prints and syntax-highlights a JSON string as safe HTML. */
function highlightJson(str) {
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+\.?\d*(?:[eE][+-]?\d+)?(?!\w))|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
    (_m, str, colon, num, bool, nil) => {
      if (str !== undefined)
        return colon
          ? `<span class="jk">${str}</span>${colon}`
          : `<span class="jv-s">${str}</span>`;
      if (num !== undefined) return `<span class="jv-n">${num}</span>`;
      if (bool !== undefined) return `<span class="jv-b">${bool}</span>`;
      if (nil !== undefined) return `<span class="jv-null">${nil}</span>`;
      return _m;
    },
  );
}

/** Opens a modal showing the JSON file at fetchUrl with a Copy button. */
async function viewFileModal(filename, fetchUrl) {
  const pre = document.createElement('pre');
  pre.className = 'json-viewer-pre';
  pre.textContent = 'Loading…';

  const copyBtn = el('button', { className: 'btn btn-small' }, 'Copy');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(pre.textContent).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });

  const closeBtn = el('button', { className: 'btn-icon', title: 'Close' }, '\u00d7');

  const box = el('div', { className: 'json-viewer-box' }, [
    el('div', { className: 'json-viewer-header' }, [
      el('span', { className: 'json-viewer-title' }, filename),
      el('div', { className: 'json-viewer-actions' }, [copyBtn, closeBtn]),
    ]),
    pre,
  ]);

  const overlay = el('div', { className: 'dialog-overlay' }, [box]);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  try {
    const resp = await fetch(fetchUrl);
    const text = await resp.text();
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    pre.innerHTML = highlightJson(pretty);
    // update copy to use the pretty-printed text
    copyBtn.addEventListener('click', () => {}, { once: true }); // handled above via pre.textContent
    pre._rawJson = pretty;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(pretty).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    };
  } catch (e) {
    pre.textContent = `Failed to load: ${e.message}`;
  }
}

/** Tiny DOM helper — creates an element with props and children. */
function el(tag, props = {}, children = []) {
  const elem = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (key === 'className') {
      elem.className = val;
    } else if (key === 'style' && typeof val === 'string') {
      elem.setAttribute('style', val);
    } else if (key.startsWith('on') && typeof val === 'function') {
      elem.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'disabled' && val) {
      elem.setAttribute('disabled', '');
    } else if (key === 'title') {
      elem.title = val;
    } else if (key === 'id') {
      elem.id = val;
    } else if (key === 'placeholder') {
      elem.placeholder = val;
    } else if (key === 'value') {
      elem.value = val;
    } else if (key === 'type') {
      elem.type = val;
    } else if (key === 'href') {
      elem.href = val;
    } else if (key === 'download') {
      elem.setAttribute('download', val === true ? '' : val);
    } else if (key === 'target') {
      elem.target = val;
    } else if (key === 'rel') {
      elem.rel = val;
    }
  }

  if (typeof children === 'string') {
    elem.textContent = children;
  } else if (Array.isArray(children)) {
    for (const child of children) {
      if (!child) continue;
      if (typeof child === 'string') {
        elem.appendChild(document.createTextNode(child));
      } else {
        elem.appendChild(child);
      }
    }
  }

  return elem;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
