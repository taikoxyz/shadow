/**
 * Shadow UI — workspace manager for deposit and proof files.
 *
 * This UI talks to the shadow-server backend via REST API and WebSocket.
 * All proof generation, workspace scanning, and on-chain queries are
 * handled server-side.
 */

import * as api from './api.js';
import './style.css';
import { el } from './lib/dom.js';
import {
  eyeIcon,
  settingsIcon,
  sunIcon,
  moonIcon,
  depositFileIcon,
  downloadIcon,
  deleteIcon,
  refreshIcon,
} from './lib/icons.js';
import { networkName, defaultRpc, explorerEntityUrl, chainParams } from './lib/networks.js';
import {
  weiToEth,
  truncateDepositId,
  formatElapsed,
  formatLogTime,
  formatDate,
  timeAgo,
} from './lib/format.js';
import { isProvingJob, getDepositStatus, getCardStatus } from './lib/status.js';
import { confirmAction, viewFileModal } from './lib/dialogs.js';
import { renderMiningFormView } from './views/miningForm.js';

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
  depositBalances: {},  // { depositId: BalanceResponse } for list cards
  claimTxHashes: {},   // { 'depositId-noteIndex': txHash }
  // Proof log
  proofLog: [],         // {time, message} entries accumulated during proving
  bannerExpanded: false,
  proofStartTime: null,
  lastQueueLogSignature: null,
};

const PROOF_LOG_LIMIT = 300;
const PROOF_LOG_STORAGE_KEY = 'shadow-proof-log-v1';

function pushProofLog(entry) {
  state.proofLog.push(entry);
  if (state.proofLog.length > PROOF_LOG_LIMIT) {
    state.proofLog.splice(0, state.proofLog.length - PROOF_LOG_LIMIT);
  }
  persistProofLogState();
}

function persistProofLogState() {
  try {
    const serializableLog = state.proofLog.map((entry) => {
      const ts = entry.time instanceof Date ? entry.time : new Date(entry.time);
      return {
        ...entry,
        time: Number.isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
      };
    });
    sessionStorage.setItem(
      PROOF_LOG_STORAGE_KEY,
      JSON.stringify({
        proofLog: serializableLog,
        proofStartTime: state.proofStartTime,
        lastQueueLogSignature: state.lastQueueLogSignature,
        bannerExpanded: state.bannerExpanded,
      }),
    );
  } catch {
    // Best-effort persistence only.
  }
}

function restoreProofLogState() {
  try {
    const raw = sessionStorage.getItem(PROOF_LOG_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.proofLog)) {
      state.proofLog = parsed.proofLog
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const time = new Date(entry.time);
          if (Number.isNaN(time.getTime())) return null;
          return { ...entry, time };
        })
        .filter(Boolean)
        .slice(-PROOF_LOG_LIMIT);
    }
    if (typeof parsed.proofStartTime === 'number' && Number.isFinite(parsed.proofStartTime)) {
      state.proofStartTime = parsed.proofStartTime;
    }
    if (typeof parsed.lastQueueLogSignature === 'string') {
      state.lastQueueLogSignature = parsed.lastQueueLogSignature;
    }
    if (typeof parsed.bannerExpanded === 'boolean') {
      state.bannerExpanded = parsed.bannerExpanded;
    }
  } catch {
    // Ignore malformed stored state.
  }
}

function isActiveProofJob(job = state.queueJob) {
  return Boolean(job && ['queued', 'running'].includes(job.status));
}

function syncProofStartTimeWithJob(job = state.queueJob) {
  if (!job) {
    if (state.proofStartTime != null) {
      state.proofStartTime = null;
      persistProofLogState();
    }
    return;
  }

  if (isActiveProofJob(job)) {
    if (state.proofStartTime != null) return;
    const startedEntry = [...state.proofLog]
      .reverse()
      .find((entry) => entry.depositId === job.depositId && entry.stage === 'started');
    state.proofStartTime = startedEntry ? new Date(startedEntry.time).getTime() : Date.now();
    persistProofLogState();
    return;
  }

  if (state.proofStartTime != null) {
    state.proofStartTime = null;
    persistProofLogState();
  }
}

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
  restoreProofLogState();

  // Apply current hash on load (before fetch so we know which view to show)
  applyRoute();

  // Listen for hash changes (back/forward navigation)
  window.addEventListener('hashchange', applyRoute);

  await refresh();

  // Subscribe to real-time events
  api.onServerEvent(handleServerEvent);

  // Poll queue status periodically (fallback for missed WS events)
  setInterval(pollQueue, 5000);
  setInterval(() => {
    if (isActiveProofJob() && state.proofStartTime != null) {
      render();
    }
  }, 1000);

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
    syncProofStartTimeWithJob(state.queueJob);
    state.loading = false;
  } catch (err) {
    state.error = err.message;
    state.loading = false;
  }

  render();

  // Fetch on-chain balances for unproved deposits (drives list card status badges)
  loadDepositBalancesForList();

  // Auto-refresh note statuses if viewing a deposit detail
  if (state.view === 'detail' && state.selectedId) {
    loadAllNoteStatuses(state.selectedId);
  }
}

async function pollQueue() {
  try {
    state.queueJob = await api.getQueueStatus();
    const job = state.queueJob;
    syncProofStartTimeWithJob(job);
    if (job && ['queued', 'running', 'failed'].includes(job.status)) {
      const sig = `${job.depositId}|${job.status}|${job.currentNote}|${job.message}`;
      if (state.lastQueueLogSignature !== sig) {
        const hasExact = state.proofLog.some(
          (entry) => entry.depositId === job.depositId && entry.message === job.message,
        );
        if (!hasExact) {
          pushProofLog({
            time: new Date(),
            message: job.message || 'Proving...',
            stage: job.status,
            depositId: job.depositId,
            currentNote: job.currentNote,
          });
        }
        state.lastQueueLogSignature = sig;
      }
    } else {
      state.lastQueueLogSignature = null;
    }
    persistProofLogState();
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
      state.proofStartTime = Date.now();
      pushProofLog({
        time: new Date(),
        message: `Started proving ${event.depositId}`,
        stage: 'started',
        depositId: event.depositId,
      });
      persistProofLogState();
      render();
      pollQueue();
      break;
    case 'proof:note_progress': {
      const entry = {
        time: new Date(),
        message: event.message || `Note ${event.noteIndex + 1}/${event.totalNotes}`,
        stage: event.stage || 'proving',
        depositId: event.depositId,
      };
      if (event.elapsedSecs != null) entry.elapsed = event.elapsedSecs;
      if (event.noteElapsedSecs != null) entry.noteElapsed = event.noteElapsedSecs;
      if (event.blockNumber != null) entry.blockNumber = event.blockNumber;
      if (event.chainId != null) entry.chainId = event.chainId;
      pushProofLog(entry);
      render();
      pollQueue();
      break;
    }
    case 'proof:completed': {
      const totalElapsed = event.elapsedSecs
        ? formatElapsed(event.elapsedSecs)
        : state.proofStartTime
          ? formatElapsed((Date.now() - state.proofStartTime) / 1000)
          : '';
      pushProofLog({
        time: new Date(),
        message: `Proof complete${totalElapsed ? ` in ${totalElapsed}` : ''} \u2014 ${event.proofFile || ''}`,
        stage: 'completed',
        depositId: event.depositId,
      });
      state.proofStartTime = null;
      persistProofLogState();
      render();
      pollQueue();
      refresh();
      break;
    }
    case 'proof:failed':
      pushProofLog({
        time: new Date(),
        message: `Failed: ${event.error || 'unknown error'}`,
        stage: 'failed',
        depositId: event.depositId,
      });
      state.proofStartTime = null;
      persistProofLogState();
      render();
      pollQueue();
      refresh();
      break;
    case 'ws:connected':
    case 'ws:disconnected':
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
  if (hasCircuitMismatch()) {
    showToast('Proof generation disabled: local circuit ID does not match on-chain verifier.', 'error');
    return;
  }
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

function loadDepositBalancesForList() {
  for (const deposit of state.deposits) {
    if (deposit.hasProof) continue;
    api.getDepositBalance(deposit.id)
      .then((bal) => {
        state.depositBalances[deposit.id] = bal;
        render();
      })
      .catch(() => {
        state.depositBalances[deposit.id] = { error: true };
      });
  }
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
  if (hasCircuitMismatch()) {
    showToast('Funding disabled: local circuit ID does not match on-chain verifier.', 'error');
    return;
  }
  if (!state.walletAddress) {
    await handleConnectWallet();
    if (!state.walletAddress) return;
  }

  // Ensure wallet is on the deposit's chain (adds network to wallet if needed)
  const requiredChainHex = '0x' + parseInt(deposit.chainId, 10).toString(16);
  if (!await ensureChain(requiredChainHex)) return;

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

function confirmCancelProof() {
  const depositId = state.queueJob?.depositId || 'this deposit';
  confirmAction(
    'Kill current proof job?',
    `This will stop proving for ${depositId}. You can start it again later.`,
    () => { handleCancelProof(); },
  );
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

/**
 * Ensure the connected wallet is on `chainIdHex` (e.g. "0x28bf5").
 * Tries wallet_switchEthereumChain; falls back to wallet_addEthereumChain
 * if the chain isn't in the wallet yet (error 4902).
 * Returns true if the wallet is now on the correct chain, false otherwise.
 */
async function ensureChain(chainIdHex) {
  if (state.walletChainId === chainIdHex) return true;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
    state.walletChainId = chainIdHex;
    return true;
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      const decimalId = parseInt(chainIdHex, 16).toString();
      const params = chainParams(decimalId);
      if (params) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [params],
          });
          state.walletChainId = chainIdHex;
          return true;
        } catch {
          // User rejected adding the chain — fall through to error toast
        }
      }
    }
    const decimalId = parseInt(chainIdHex, 16);
    showToast(`Switch MetaMask to ${networkName(decimalId.toString())} (chain ${decimalId})`, 'error');
    return false;
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

    // Ensure wallet is on the correct chain (adds network to wallet if needed)
    if (!await ensureChain(txData.chainId)) return;

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
    await api.createDeposit(chainId, formData.notes, formData.comment);
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

  const mismatchWarning = renderCircuitMismatchWarning();
  if (mismatchWarning) app.appendChild(mismatchWarning);

  // Global proof job banner
  const banner = renderProofJobBanner();
  if (banner) app.appendChild(banner);

  if (state.loading) {
    app.appendChild(el('div', { className: 'empty-state' }, [
      el('div', { className: 'spinner' }),
      el('p', { className: 'loading-copy' }, 'Loading workspace...'),
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

function hasCircuitMismatch() {
  return state.config?.circuitMismatch === true;
}

function renderCircuitMismatchWarning() {
  if (!hasCircuitMismatch()) return null;
  return el('div', { className: 'circuit-warning' }, [
    el('h2', {}, '⚠️ Circuit ID mismatch detected'),
    el('p', {}, 'This prover circuit does not match the deployed on-chain verifier.'),
    state.config?.circuitId
      ? el('p', {}, `On-chain: ${state.config.circuitId}`)
      : null,
    state.config?.localCircuitId
      ? el('p', {}, `Local: ${state.config.localCircuitId}`)
      : null,
  ].filter(Boolean));
}


function renderHeader() {
  const headerLeft = el('div', { className: 'header-left' }, [
    el('div', { className: 'header-title-group' }, [
      el('h1', { onclick: () => navigateTo('list') }, 'Shadow'),
    ]),
    el('span', { className: 'header-count' },
      `${state.deposits.length} deposit${state.deposits.length !== 1 ? 's' : ''}`),
  ]);

  const headerActions = el('div', { className: 'header-actions' }, [
    state.config?.chainId
      ? el('span', { className: 'header-count' }, networkName(state.config.chainId))
      : null,
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
  input.hidden = true;
  input.addEventListener('change', handleImportDeposit);

  const label = document.createElement('label');
  label.className = 'btn btn-small';
  label.title = 'Import an existing deposit JSON file';
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
    items.push(renderMiningFormView({
      state,
      chainId: state.config?.chainId,
      walletAddress: state.walletAddress,
      onSubmit: handleMineDeposit,
      onClose: () => {
        state.showMiningForm = false;
        state.miningNotes = null;
        state.miningComment = '';
        state.miningErrors = {};
        render();
      },
    }));
  }

  if (!state.showMiningForm) {
    items.push(el('div', { className: 'list-toolbar' }, [
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
  const cs = getCardStatus(deposit, state.queueJob, state.depositBalances[deposit.id]);
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
        className: 'btn btn-small',
        title: 'View file',
        onclick: () => viewFileModal(deposit.filename, downloadUrl),
      }, [eyeIcon()]),
      el('a', {
        href: downloadUrl,
        className: 'btn btn-small',
        download: true,
        title: 'Download deposit file',
      }, [downloadIcon()]),
      el('button', {
        className: 'btn btn-danger btn-small',
        title: 'Delete deposit',
        onclick: () => confirmAction(
          'Delete deposit?',
          `This will permanently delete ${deposit.filename}${deposit.hasProof ? ' and its proof file' : ''}.`,
          () => handleDeleteDeposit(deposit.id, true),
        ),
      }, [deleteIcon()]),
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
        ? el('span', { className: 'badge badge-no-proof badge-shrink' }, 'Invalid')
        : null,
      el('span', { className: 'detail-value file-name' }, deposit.proofFile || '\u2014'),
      el('button', {
        className: 'btn btn-small',
        title: 'View file',
        onclick: () => viewFileModal(deposit.proofFile || 'proof.json', downloadUrl),
      }, [eyeIcon()]),
      el('a', {
        href: downloadUrl,
        className: 'btn btn-small',
        download: true,
        title: 'Download proof file',
      }, [downloadIcon()]),
      status !== 'proving'
        ? el('button', {
            className: 'btn btn-danger btn-small',
            title: 'Delete proof',
            onclick: () => confirmAction(
              'Delete proof file?',
              `This will delete ${deposit.proofFile}. The deposit file will remain.`,
              () => handleDeleteProof(deposit.id),
            ),
          }, [deleteIcon()])
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
  const status = getDepositStatus(deposit, state.queueJob, state.depositBalance);
  const circuitMismatch = hasCircuitMismatch();
  const fundingStatusTag = (() => {
    if (state.depositBalance?.error) {
      return el('span', { className: 'badge badge-failed' }, 'Unavailable');
    }
    if (!state.depositBalance) {
      return el('span', { className: 'badge badge-unknown' }, 'Loading');
    }
    return el(
      'span',
      { className: `badge ${state.depositBalance.isFunded ? 'badge-funded' : 'badge-funding'}` },
      state.depositBalance.isFunded ? 'Funded' : 'Unfunded',
    );
  })();

  // Proof action button / hint (shown inside Proofs section)
  const proofAction = (() => {
    if (status === 'proving') {
      return el('span', { className: 'proof-action-hint' }, 'Proof generation in progress \u2014 see banner above');
    }
    if (deposit.hasProof) {
      return el('button', {
        className: 'btn',
        onclick: () => handleProve(deposit.id, true),
        disabled: isProving() || circuitMismatch,
        title: circuitMismatch
          ? 'Disabled: local circuit ID does not match on-chain verifier'
          : undefined,
      }, 'Regenerate Proof');
    }
    return el('button', {
      className: 'btn btn-primary',
      onclick: () => handleProve(deposit.id),
      disabled: isProving() || status === 'new' || status === 'funding' || circuitMismatch,
      title: circuitMismatch
        ? 'Disabled: local circuit ID does not match on-chain verifier'
        : (status === 'new' || status === 'funding')
          ? 'Fund the deposit first'
          : undefined,
    }, 'Generate Proof');
  })();

  // Fund button or submitted tx link
  const fundAction = (() => {
    if (status !== 'new' && status !== 'funding') return null;
    if (circuitMismatch) {
      return el(
        'p',
        { className: 'form-hint form-hint-top warning-text' },
        'Funding disabled: local circuit ID does not match on-chain verifier.',
      );
    }
    if (state.fundingTxHash) {
      return el('p', { className: 'tx-submitted' }, [
        'Funding tx submitted: ',
        el('a', {
          href: explorerEntityUrl(deposit.chainId, 'tx', state.fundingTxHash),
          target: '_blank',
          rel: 'noopener',
          className: 'link-accent',
        }, `${state.fundingTxHash.slice(0, 18)}...`),
      ]);
    }
    if (window.ethereum) {
      return el('div', { className: 'actions actions-right' }, [
        el('button', {
          className: 'btn btn-primary',
          onclick: () => handleFundDeposit(deposit),
          disabled: circuitMismatch,
          title: circuitMismatch
            ? 'Disabled: local circuit ID does not match on-chain verifier'
            : undefined,
        }, 'Fund Deposit'),
      ]);
    }
    return el('p', { className: 'form-hint form-hint-top' },
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
      detailRow('Status', fundingStatusTag),
    ].filter(Boolean)),

    // Funding
    state.depositBalance?.error
      ? el('div', { className: 'detail-section' }, [
          el('h2', {}, 'Funding'),
          el('p', { className: 'form-hint' }, 'Could not load balance \u2014 RPC may be unavailable.'),
        ])
      : state.depositBalance
        ? el('div', { className: 'detail-section' }, [
            el('h2', {}, 'Funding'),
            detailRow('Required', `${weiToEth(state.depositBalance.required)} ETH`),
            detailRow('On-chain Balance', `${weiToEth(state.depositBalance.balance)} ETH`),
            !state.depositBalance.isFunded
              ? detailRow('Balance Due', `${weiToEth(state.depositBalance.due)} ETH`)
              : null,
            fundAction,
          ].filter(Boolean))
        : el('div', { className: 'detail-section' }, [
            el('h2', {}, 'Funding'),
            el('p', { className: 'form-hint' }, 'Loading balance...'),
          ]),

    // Proofs (hidden until funded)
    status !== 'new' && status !== 'funding' ? el('div', { className: 'detail-section' }, [
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
        ? el('div', { className: 'actions actions-right' }, [proofAction])
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
        el('th', {}, 'Label'),
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
          el('td', { className: 'note-recipient-cell' }, [
            explorerLink(deposit.chainId, 'address', note.recipient),
          ]),
          el('td', {}, `${weiToEth(note.amount)} ETH`),
          el('td', { className: 'note-label-cell' }, note.label || '-'),
          el('td', {}, [
            el('span', { className: `badge badge-${note.claimStatus}` }, note.claimStatus),
          ]),
          el('td', {}, [
            (() => {
              const claimTx = state.claimTxHashes[`${deposit.id}-${note.index}`];
              if (claimTx) {
                return el('div', { className: 'note-tx' }, [
                  el('a', {
                    href: explorerEntityUrl(deposit.chainId, 'tx', claimTx),
                    target: '_blank',
                    rel: 'noopener',
                    className: 'link-accent',
                  }, `TX: ${claimTx.slice(0, 18)}...`),
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
                  [refreshIcon()],
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
  const logEntries = state.proofLog.filter(
    (entry) => entry.depositId == null || entry.depositId === job.depositId,
  );
  const fallbackEntry = job
    ? {
        time: new Date(),
        message: job.message || 'Proving...',
        currentNote: job.currentNote,
      }
    : null;

  const isFailed = job.status === 'failed';
  const elapsedStr = state.proofStartTime
    ? formatElapsed((Date.now() - state.proofStartTime) / 1000)
    : '';

  const expanded = state.bannerExpanded;

  return el('div', { className: `proof-banner${isFailed ? ' proof-banner-failed' : ''}` }, [
    el('div', { className: 'proof-banner-top' }, [
    el('div', { className: 'proof-banner-info' }, [
      isFailed
        ? el('span', {}, '\u26a0\ufe0f')
        : el('span', { className: 'spinner' }),
      el('div', { className: 'proof-banner-main' }, [
        isFailed
          ? el('span', {}, ` Proof failed \u2014 ${job.error || job.message || 'unknown error'}`)
          : el('span', {}, [
              ` ${job.message || 'Proving...'}`,
              elapsedStr ? el('span', { className: 'text-muted-60' }, ` (${elapsedStr})`) : null,
              ' in ',
              el('a', {
                href: `#/deposit/${encodeURIComponent(job.depositId)}`,
                className: 'detail-address-link',
              }, job.depositId),
            ].filter(Boolean)),
        isFailed ? null : el('span', { className: 'proof-banner-subtext' },
          'Your fan noise is the sound of privacy being forged. Hang tight 🔥'),
      ].filter(Boolean)),
    ]),
    el('div', { className: 'proof-banner-right' }, [
      !isFailed
        ? el('button', {
            className: 'btn btn-small proof-banner-toggle',
            onclick: () => { state.bannerExpanded = !state.bannerExpanded; persistProofLogState(); render(); },
          }, expanded ? 'Hide log' : 'Show log')
        : null,
      el('button', {
        className: 'btn btn-danger btn-small',
        onclick: isFailed
          ? () => { api.cancelProof().catch(() => {}); state.queueJob = null; render(); }
          : confirmCancelProof,
      }, isFailed ? 'Dismiss' : 'Kill Current Job'),
    ].filter(Boolean)),  // proof-banner-right
    ]),                  // proof-banner-top
    null,
    expanded
      ? el('div', { className: 'proof-banner-log' },
          logEntries.length > 0
            ? logEntries.map(entry =>
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
                el('span', { className: 'proof-log-time' }, fallbackEntry ? formatLogTime(fallbackEntry.time) : '—'),
                el('span', { className: 'text-muted-60' }, fallbackEntry ? fallbackEntry.message : 'Waiting for events...'),
                fallbackEntry?.currentNote != null
                  ? el('span', { className: 'proof-log-detail' }, `note #${fallbackEntry.currentNote + 1}`)
                  : null,
              ].filter(Boolean))]
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
      el('p', { className: 'form-hint form-hint-spaced' },
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
      el('div', { className: 'settings-theme-row' }, [
        el('span', { className: 'settings-theme-label' }, 'Theme:'),
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
            state.config.shadowAddress ? addressRow('Shadow Contract', state.config.shadowAddress, state.config.chainId) : null,
            state.config.circuitId ? detailRow('Circuit ID', state.config.circuitId) : null,
            state.config.rpcUrl ? detailRow('RPC URL', state.config.rpcUrl) : null,
          ].filter(Boolean))
        : el('p', { className: 'form-hint' }, 'Server not connected'),
    ]),

    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Debug Logging'),
      el('p', { className: 'form-hint form-hint-spaced' },
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
// Helpers
// ---------------------------------------------------------------------------

function isProving() {
  return isProvingJob(state.queueJob);
}

function detailRow(label, value) {
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, label),
    el('span', { className: 'detail-value' }, value || '\u2014'),
  ]);
}

function explorerLink(chainId, entity, value, text = value) {
  return el('a', {
    href: explorerEntityUrl(chainId, entity, value),
    target: '_blank',
    rel: 'noopener',
    className: 'detail-address-link',
  }, text);
}

function addressRow(label, address, chainId) {
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, label),
    el('span', { className: 'detail-value' }, [explorerLink(chainId, 'address', address)]),
  ]);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
