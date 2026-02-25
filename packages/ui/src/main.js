/**
 * Shadow UI — workspace manager for deposit and proof files.
 *
 * This UI talks to the shadow-server backend via REST API and WebSocket.
 * All proof generation, workspace scanning, and on-chain queries are
 * handled server-side.
 */

import * as api from './api.js';
import './style.css';

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
  // Deposit detail
  depositBalance: null,
  wsConnected: false,
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
      refresh();
      break;
    case 'proof:started':
    case 'proof:note_progress':
    case 'proof:completed':
    case 'proof:failed':
      state.queueJob = event;
      render();
      if (event.type === 'proof:completed' || event.type === 'proof:failed') {
        refresh();
      }
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
    render();
  } catch {
    state.depositBalance = null;
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
  if (!state.walletAddress) {
    await handleConnectWallet();
    if (!state.walletAddress) return;
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
    showToast(`Funding tx submitted: ${txHash.slice(0, 18)}...`, 'success');
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

    showToast(`Claim submitted! TX: ${txHash.slice(0, 18)}...`, 'success');

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
    const chainId = formData.chainId || state.config?.chainId || '167013';
    const result = await api.createDeposit(chainId, formData.notes, formData.comment);
    state.showMiningForm = false;
    state.mining = false;
    showToast(`Deposit mined! ${result.iterations.toLocaleString()} iterations`, 'success');
    await refresh();
  } catch (err) {
    state.mining = false;
    showToast(`Mining failed: ${err.message}`, 'error');
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
    el('h1', { onclick: () => navigateTo('list') }, 'Shadow'),
    el('span', { className: 'header-count' },
      `${state.deposits.length} deposit${state.deposits.length !== 1 ? 's' : ''}`),
  ]);

  const headerActions = el('div', { className: 'header-actions' }, [
    el('span', { className: 'header-status' }, [
      el('span', { className: `rpc-dot${state.wsConnected === false ? ' rpc-dot-offline' : ''}` }),
      state.wsConnected === false ? 'Reconnecting...' : (state.config?.rpcUrl ? 'Live' : 'RPC'),
    ]),
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
    }, '\u2699'),
    el('button', {
      className: 'btn-icon',
      onclick: () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'),
      title: 'Toggle theme',
    }, getTheme() === 'dark' ? '☀' : '☾'),
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

  if (state.deposits.length === 0 && !state.showMiningForm) {
    items.push(el('div', { className: 'empty-state' }, [
      el('h2', {}, 'No deposits found'),
      el('p', {}, 'Create a new deposit or place deposit JSON files in the workspace directory.'),
      el('button', {
        className: 'btn btn-primary',
        style: 'margin-top: 1rem',
        onclick: () => { state.showMiningForm = true; render(); },
      }, '+ New Deposit'),
    ]));
    return el('div', {}, items);
  }

  if (!state.showMiningForm) {
    items.push(el('div', { style: 'margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: center' }, [
      el('button', {
        className: 'btn btn-primary',
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
        el('span', { className: 'deposit-card-id' }, truncateDepositId(deposit.id)),
        statusBadge,
      ]),
      el('div', { className: 'deposit-card-meta' }, [
        el('span', {}, `${deposit.noteCount} note${deposit.noteCount !== 1 ? 's' : ''}`),
        el('span', {}, `${totalEth} ETH`),
        el('span', {}, `Chain ${deposit.chainId}`),
        deposit.createdAt ? el('span', {}, formatDate(deposit.createdAt)) : null,
      ].filter(Boolean)),
    ],
  );
}

// ---------------------------------------------------------------------------
// Mining Form
// ---------------------------------------------------------------------------

function renderMiningForm() {
  // Store note data to survive re-renders
  const notes = [{ recipient: '', amount: '', label: '' }];
  let comment = '';

  const container = el('div', { className: 'mining-panel' });

  function saveNoteData() {
    notes.forEach((note, i) => {
      const r = document.getElementById(`mine-recipient-${i}`);
      const a = document.getElementById(`mine-amount-${i}`);
      const l = document.getElementById(`mine-label-${i}`);
      if (r) note.recipient = r.value;
      if (a) note.amount = a.value;
      if (l) note.label = l.value;
    });
    const c = document.getElementById('mine-comment');
    if (c) comment = c.value;
  }

  function addNote() {
    saveNoteData();
    if (notes.length < 5) notes.push({ recipient: '', amount: '', label: '' });
    renderFormContent();
  }

  function removeNote(i) {
    saveNoteData();
    notes.splice(i, 1);
    renderFormContent();
  }

  function renderFormContent() {
    container.innerHTML = '';

    const header = el('div', { className: 'mining-panel-header' }, [
      el('h3', {}, 'New Deposit'),
      el('button', {
        className: 'btn-icon',
        onclick: () => { state.showMiningForm = false; render(); },
        title: 'Close',
      }, '\u2715'),
    ]);
    container.appendChild(header);

    // Chain ID
    const chainId = state.config?.chainId || '167013';
    container.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label' }, 'Chain ID'),
      el('input', {
        className: 'form-input',
        id: 'mine-chain-id',
        value: chainId,
        style: 'max-width: 200px',
      }),
    ]));

    // Comment field
    container.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label' }, 'Comment (optional)'),
      el('textarea', {
        className: 'form-input',
        id: 'mine-comment',
        placeholder: 'Describe this deposit...',
        style: 'min-height: 56px; resize: vertical; font-family: inherit',
      }),
    ]));
    // Restore comment value after render
    requestAnimationFrame(() => {
      const c = document.getElementById('mine-comment');
      if (c) c.value = comment;
    });

    // Notes section header
    container.appendChild(el('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem',
    }, [
      el('span', { className: 'form-label', style: 'margin-bottom:0' }, 'Notes'),
      notes.length < 5
        ? el('button', {
            className: 'btn btn-small',
            onclick: addNote,
          }, '+ Add Note')
        : null,
    ].filter(Boolean)));

    // Note entries
    notes.forEach((note, i) => {
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
              className: 'form-input',
              id: `mine-recipient-${i}`,
              placeholder: '0x...',
              // No default value — user must enter explicitly
            }),
          ]),
          el('div', { className: 'form-group', style: 'flex:1' }, [
            el('label', { className: 'form-label' }, 'Amount (ETH)'),
            el('input', {
              className: 'form-input',
              id: `mine-amount-${i}`,
              placeholder: '0.001',
              type: 'text',
            }),
          ]),
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label' }, 'Label (optional)'),
          el('input', {
            className: 'form-input',
            id: `mine-label-${i}`,
            placeholder: `note #${i}`,
            style: 'max-width: 300px',
          }),
        ]),
      ]);
      container.appendChild(noteEl);
    });

    // Restore input values after render
    requestAnimationFrame(() => {
      notes.forEach((note, i) => {
        const r = document.getElementById(`mine-recipient-${i}`);
        const a = document.getElementById(`mine-amount-${i}`);
        const l = document.getElementById(`mine-label-${i}`);
        if (r) r.value = note.recipient;
        if (a) a.value = note.amount;
        if (l) l.value = note.label;
      });

      // Add wallet warning listeners after DOM is ready
      notes.forEach((_, i) => {
        const r = document.getElementById(`mine-recipient-${i}`);
        if (r) {
          r.addEventListener('blur', () => {
            const val = r.value.trim().toLowerCase();
            const wallet = state.walletAddress?.toLowerCase();
            if (wallet && val === wallet) {
              showToast('Warning: using your connected wallet address as recipient may reveal your identity on-chain.', 'error');
            }
          });
        }
      });
    });

    // Submit row
    const actions = el('div', { style: 'margin-top: 1rem; display:flex; gap:0.5rem; align-items:center' }, [
      el('button', {
        className: 'btn btn-primary',
        disabled: state.mining,
        onclick: () => {
          saveNoteData();

          // Validate
          const errors = [];
          const parsedNotes = notes.map((note, i) => {
            const recipient = note.recipient.trim();
            const amountEth = note.amount.trim();
            const label = note.label.trim();

            if (!recipient.match(/^0x[0-9a-fA-F]{40}$/)) {
              errors.push(`Note #${i}: invalid recipient address (must be 0x + 40 hex chars)`);
            }

            const weiStr = ethToWei(amountEth);
            if (!weiStr || weiStr === '0') {
              errors.push(`Note #${i}: amount must be a positive number in ETH`);
            } else {
              const wei = BigInt(weiStr);
              if (wei < BigInt('1000000000000')) { // minimum ~0.000001 ETH
                errors.push(`Note #${i}: amount too small (minimum ~0.000001 ETH)`);
              }
            }

            return {
              recipient,
              amount: weiStr || '0',
              label: label || undefined,
            };
          });

          if (errors.length > 0) {
            showToast(errors[0], 'error');
            return;
          }

          const chainIdEl = document.getElementById('mine-chain-id');
          const commentEl = document.getElementById('mine-comment');
          const chainIdVal = chainIdEl?.value?.trim() || '167013';
          const commentVal = commentEl?.value?.trim() || undefined;

          handleMineDeposit({ notes: parsedNotes, comment: commentVal, chainId: chainIdVal });
        },
      }, state.mining ? 'Mining...' : 'Mine Deposit'),
      state.mining ? el('span', { className: 'spinner' }) : null,
      state.mining
        ? el('span', { className: 'mining-status' }, 'Finding valid PoW secret...')
        : el('span', { className: 'form-hint' }, 'Mining typically takes 3\u201310 seconds'),
    ].filter(Boolean));
    container.appendChild(actions);
  }

  renderFormContent();
  return container;
}

// ---------------------------------------------------------------------------
// Detail View
// ---------------------------------------------------------------------------

/** Deposit filename row with inline download + delete buttons. */
function depositFileRow(deposit) {
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, 'Filename'),
    el('div', { className: 'file-row-value' }, [
      el('span', { className: 'detail-value file-name' }, deposit.filename),
      el('a', {
        href: `/api/deposits/${encodeURIComponent(deposit.id)}/download`,
        className: 'btn btn-small',
        download: true,
        title: 'Download deposit file',
      }, '\u2193'),
      el('button', {
        className: 'btn btn-danger btn-small',
        title: 'Delete deposit',
        onclick: () => confirmAction(
          'Delete deposit?',
          `This will permanently delete ${deposit.filename}${deposit.hasProof ? ' and its proof file' : ''}.`,
          () => handleDeleteDeposit(deposit.id, true),
        ),
      }, '\u00d7'),
    ]),
  ]);
}

/** Proof file row with inline download + delete buttons (or "None" if no proof). */
function proofFileRow(deposit, status) {
  if (!deposit.hasProof) return detailRow('Proof', 'None');
  return el('div', { className: 'detail-row' }, [
    el('span', { className: 'detail-label' }, 'Proof'),
    el('div', { className: 'file-row-value' }, [
      deposit.proofValid === false
        ? el('span', { className: 'badge badge-no-proof', style: 'flex-shrink:0' }, 'Invalid')
        : null,
      el('span', { className: 'detail-value file-name' }, deposit.proofFile || '\u2014'),
      el('a', {
        href: `/api/deposits/${encodeURIComponent(deposit.id)}/proof/download`,
        className: 'btn btn-small',
        download: true,
        title: 'Download proof file',
      }, '\u2193'),
      status !== 'proving'
        ? el('button', {
            className: 'btn btn-danger btn-small',
            title: 'Delete proof',
            onclick: () => confirmAction(
              'Delete proof file?',
              `This will delete ${deposit.proofFile}. The deposit file will remain.`,
              () => handleDeleteProof(deposit.id),
            ),
          }, '\u00d7')
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
    if (status === 'unproved' || status === 'unfunded') {
      return el('button', {
        className: 'btn btn-primary',
        onclick: () => handleProve(deposit.id),
        disabled: isProving() || status === 'unfunded',
        title: status === 'unfunded' ? 'Fund the deposit first' : undefined,
      }, 'Generate Proof');
    }
    if (status === 'proving') {
      return el('span', { className: 'form-hint' }, 'Proof generation in progress \u2014 see banner above');
    }
    if (status === 'proved' || status === 'partial') {
      return el('button', {
        className: 'btn',
        onclick: () => handleProve(deposit.id, true),
      }, 'Regenerate Proof');
    }
    return null;
  })();

  // Fund button (shown inside Funding Status section when applicable)
  const fundAction = status === 'unfunded' && window.ethereum
    ? el('button', {
        className: 'btn btn-primary',
        style: 'margin-top: 0.5rem',
        onclick: () => handleFundDeposit(deposit),
      }, 'Fund Deposit')
    : status === 'unfunded'
      ? el('p', { className: 'form-hint', style: 'margin-top: 0.5rem' },
          `Send ${weiToEth(state.depositBalance?.due || '0')} ETH to ${deposit.targetAddress}`)
      : null;

  return el('div', {}, [
    // Breadcrumb
    el('div', { className: 'breadcrumb' }, [
      el('a', { onclick: () => navigateTo('list') }, 'Deposits'),
      ` / ${truncateDepositId(deposit.id)}`,
    ]),

    // Comment (if present)
    deposit.comment
      ? el('p', { className: 'deposit-comment' }, deposit.comment)
      : null,

    // Overview
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Overview'),
      depositFileRow(deposit),
      detailRow('Chain ID', deposit.chainId),
      detailRow('Target Address', deposit.targetAddress),
      detailRow('Total Amount', `${totalEth} ETH (${deposit.totalAmount} wei)`),
      detailRow('Notes', String(deposit.noteCount)),
      deposit.createdAt ? detailRow('Created', formatDate(deposit.createdAt)) : null,
    ].filter(Boolean)),

    // Funding Status
    state.depositBalance
      ? el('div', { className: 'detail-section' }, [
          el('h2', {}, 'Funding Status'),
          detailRow('Target Address', deposit.targetAddress),
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

    // Proofs
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Proofs'),
      proofFileRow(deposit, status),
      proofAction
        ? el('div', { className: 'actions', style: 'margin-top: 0.75rem' }, [proofAction])
        : null,
    ].filter(Boolean)),

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
          }, note.recipient),
          el('td', {}, `${weiToEth(note.amount)} ETH`),
          el('td', {}, [
            el('span', { className: `badge badge-${note.claimStatus}` }, note.claimStatus),
          ]),
          el('td', {}, [
            el('div', { className: 'note-actions' }, [
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
                '\u21bb',
              ),
            ].filter(Boolean)),
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

  return el('div', { className: `proof-banner${isFailed ? ' proof-banner-failed' : ''}` }, [
    el('div', { className: 'proof-banner-info' }, [
      isFailed
        ? el('span', {}, '\u26a0\ufe0f')
        : el('span', { className: 'spinner' }),
      el('span', {}, isFailed
        ? ` Proof failed for ${job.depositId} \u2014 ${job.error || job.message || 'unknown error'}`
        : ` Proving ${job.depositId} \u2014 ${job.message || 'in progress...'}`),
    ]),
    el('div', { className: 'proof-banner-right' }, [
      !isFailed
        ? el('div', { className: 'progress-bar', style: 'width: 120px' }, [
            el('div', { className: 'progress-fill', style: `width: ${pct}%` }),
          ])
        : null,
      el('button', {
        className: 'btn btn-danger btn-small',
        onclick: isFailed ? () => { state.queueJob = null; render(); } : handleCancelProof,
      }, isFailed ? 'Dismiss' : 'Kill'),
    ].filter(Boolean)),
  ]);
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
        `Used by the UI for balance checks. Proof generation uses the server\u2019s RPC. Clear to use default: ${state.config?.rpcUrl || 'https://rpc.hoodi.taiko.xyz'}`),
      el('div', { className: 'form-group' }, [
        el('label', { className: 'form-label' }, 'JSON-RPC URL'),
        el('input', {
          className: 'form-input',
          id: 'settings-rpc',
          placeholder: state.config?.rpcUrl || 'https://rpc.hoodi.taiko.xyz',
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
  // If proving is in progress for this deposit
  if (state.queueJob &&
      ['queued', 'running'].includes(state.queueJob.status) &&
      state.queueJob.depositId === deposit.id) {
    return 'proving';
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

function formatDate(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString();
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
