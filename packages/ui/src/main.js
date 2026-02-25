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
    state.view = 'detail';
    state.selectedId = decodeURIComponent(detailMatch[1]);
  } else if (hash === '#/settings') {
    state.view = 'settings';
    state.selectedId = null;
  } else {
    state.view = 'list';
    state.selectedId = null;
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
  }
}

function navigateTo(view, id = null) {
  if (view === 'detail' && id) {
    location.hash = `#/deposit/${encodeURIComponent(id)}`;
  } else if (view === 'settings') {
    location.hash = '#/settings';
  } else {
    location.hash = '#/';
  }
}

async function handleProve(depositId) {
  try {
    const job = await api.startProof(depositId);
    state.queueJob = job;
    render();
  } catch (err) {
    showToast(`Failed to start proof: ${err.message}`, 'error');
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

async function handleMineDeposit(formData) {
  state.mining = true;
  render();

  try {
    const chainId = state.config?.chainId || '167013';
    const result = await api.createDeposit(chainId, formData.notes);
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

  if (state.view === 'detail' && state.selectedId) {
    app.appendChild(renderDetailView());
  } else {
    app.appendChild(renderListView());
  }

  // Queue status (shown globally when a job is active)
  if (state.queueJob && ['queued', 'running'].includes(state.queueJob.status)) {
    app.appendChild(renderQueueStatus());
  }

  // Config footer
  if (state.config) {
    app.appendChild(renderConfigBar());
  }
}

function renderHeader() {
  const headerLeft = el('div', { className: 'header-left' }, [
    el('h1', { onclick: () => navigateTo('list') }, 'Shadow'),
    el('span', { className: 'header-count' },
      `${state.deposits.length} deposit${state.deposits.length !== 1 ? 's' : ''}`),
  ]);

  const headerActions = el('div', { className: 'header-actions' }, [
    state.config?.rpcUrl
      ? el('span', { className: 'header-status' }, [
          el('span', { className: 'rpc-dot' }),
          'RPC',
        ])
      : null,
    state.walletAddress
      ? el('span', { className: 'wallet-badge' }, [
          el('span', { className: 'wallet-dot' }),
          truncateAddr(state.walletAddress),
        ])
      : window.ethereum
        ? el('button', {
            className: 'btn btn-small',
            onclick: handleConnectWallet,
          }, 'Connect Wallet')
        : null,
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

function renderListView() {
  const items = [];

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
    items.push(el('div', { style: 'margin-bottom: 1rem' }, [
      el('button', {
        className: 'btn btn-primary',
        onclick: () => { state.showMiningForm = true; render(); },
      }, '+ New Deposit'),
    ]));
  }

  items.push(
    el('div', { className: 'deposit-list' }, state.deposits.map(renderDepositCard)),
  );

  return el('div', {}, items);
}

function renderDepositCard(deposit) {
  const totalEth = weiToEth(deposit.totalAmount);
  const proofBadge = deposit.hasProof
    ? el('span', { className: 'badge badge-proof' }, 'Proved')
    : el('span', { className: 'badge badge-no-proof' }, 'No proof');

  return el(
    'div',
    {
      className: 'deposit-card',
      onclick: () => navigateTo('detail', deposit.id),
    },
    [
      el('div', { className: 'deposit-card-header' }, [
        el('span', { className: 'deposit-card-id' }, truncateDepositId(deposit.id)),
        proofBadge,
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
  let noteCount = 1;

  const container = el('div', { className: 'mining-panel' });

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

    // Chain ID (auto-filled from config)
    const chainId = state.config?.chainId || '167013';
    const chainGroup = el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label' }, 'Chain ID'),
      el('input', {
        className: 'form-input',
        id: 'mine-chain-id',
        value: chainId,
        style: 'max-width: 200px',
      }),
    ]);
    container.appendChild(chainGroup);

    // Notes
    const notesLabel = el('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem',
    }, [
      el('span', { className: 'form-label', style: 'margin-bottom:0' }, 'Notes'),
      noteCount < 5
        ? el('button', {
            className: 'btn btn-small',
            onclick: () => { noteCount++; renderFormContent(); },
          }, '+ Add Note')
        : null,
    ].filter(Boolean));
    container.appendChild(notesLabel);

    for (let i = 0; i < noteCount; i++) {
      const noteEl = el('div', { className: 'note-entry' }, [
        el('div', { className: 'note-entry-header' }, [
          `Note #${i}`,
          i > 0
            ? el('button', {
                className: 'btn-icon',
                onclick: () => { noteCount--; renderFormContent(); },
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
              value: state.walletAddress || '',
            }),
          ]),
          el('div', { className: 'form-group', style: 'flex:1' }, [
            el('label', { className: 'form-label' }, 'Amount (wei)'),
            el('input', {
              className: 'form-input',
              id: `mine-amount-${i}`,
              placeholder: '1000000000000000',
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
    }

    // Submit
    const actions = el('div', { style: 'margin-top: 1rem; display:flex; gap:0.5rem; align-items:center' }, [
      el('button', {
        className: 'btn btn-primary',
        disabled: state.mining,
        onclick: () => {
          const notes = [];
          for (let i = 0; i < noteCount; i++) {
            const recipient = document.getElementById(`mine-recipient-${i}`)?.value?.trim();
            const amount = document.getElementById(`mine-amount-${i}`)?.value?.trim();
            const label = document.getElementById(`mine-label-${i}`)?.value?.trim();
            if (!recipient || !amount) {
              showToast(`Note #${i}: recipient and amount are required`, 'error');
              return;
            }
            const note = { recipient, amount };
            if (label) note.label = label;
            notes.push(note);
          }
          handleMineDeposit({ notes });
        },
      }, state.mining ? 'Mining...' : 'Mine Deposit'),
      state.mining ? el('span', { className: 'spinner' }) : null,
      state.mining
        ? el('span', { className: 'mining-status' }, 'Finding valid PoW secret...')
        : el('span', { className: 'form-hint' }, 'Mining typically takes 3-10 seconds'),
    ].filter(Boolean));
    container.appendChild(actions);
  }

  renderFormContent();
  return container;
}

// ---------------------------------------------------------------------------
// Detail View
// ---------------------------------------------------------------------------

function renderDetailView() {
  const deposit = state.deposits.find((d) => d.id === state.selectedId);
  if (!deposit) {
    return el('div', { className: 'empty-state' }, [
      el('p', {}, 'Deposit not found'),
      el('button', { className: 'btn', onclick: () => navigateTo('list') }, 'Back'),
    ]);
  }

  const totalEth = weiToEth(deposit.totalAmount);

  return el('div', {}, [
    // Breadcrumb
    el('div', { className: 'breadcrumb' }, [
      el('a', { onclick: () => navigateTo('list') }, 'Deposits'),
      ` / ${truncateDepositId(deposit.id)}`,
    ]),

    // Overview
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Overview'),
      detailRow('Filename', deposit.filename),
      detailRow('Chain ID', deposit.chainId),
      detailRow('Target Address', deposit.targetAddress),
      detailRow('Total Amount', `${totalEth} ETH (${deposit.totalAmount} wei)`),
      detailRow('Notes', String(deposit.noteCount)),
      deposit.createdAt ? detailRow('Created', formatDate(deposit.createdAt)) : null,
      detailRow('Proof', deposit.hasProof ? deposit.proofFile : 'None'),
    ].filter(Boolean)),

    // Notes
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Notes'),
      renderNotesTable(deposit),
    ]),

    // Actions
    el('div', { className: 'detail-section' }, [
      el('h2', {}, 'Actions'),
      el('div', { className: 'actions' }, [
        !deposit.hasProof
          ? el(
              'button',
              {
                className: 'btn btn-primary',
                onclick: () => handleProve(deposit.id),
                disabled: isProving(),
              },
              isProving() ? 'Proving...' : 'Generate Proof',
            )
          : null,
        deposit.hasProof
          ? el(
              'button',
              {
                className: 'btn btn-danger btn-small',
                onclick: () => confirmAction(
                  'Delete proof file?',
                  `This will delete ${deposit.proofFile}`,
                  () => handleDeleteProof(deposit.id),
                ),
              },
              'Delete Proof',
            )
          : null,
        el(
          'button',
          {
            className: 'btn btn-danger btn-small',
            onclick: () => confirmAction(
              'Delete deposit?',
              `This will delete ${deposit.filename}${deposit.hasProof ? ' and its proof file' : ''}.`,
              () => handleDeleteDeposit(deposit.id, true),
            ),
          },
          'Delete Deposit',
        ),
      ].filter(Boolean)),
    ]),
  ]);
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
            style: `font-family: var(--font-mono); font-size: 0.78rem`,
          }, truncateAddr(note.recipient)),
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
// Queue Status (proof in progress)
// ---------------------------------------------------------------------------

function renderQueueStatus() {
  const job = state.queueJob;
  if (!job) return el('div');

  const pct = job.totalNotes > 0 ? Math.round((job.currentNote / job.totalNotes) * 100) : 0;

  return el('div', { className: 'proof-status-box' }, [
    el('div', { className: 'proof-status-message' }, [
      el('strong', {}, `Proof: ${truncateDepositId(job.depositId)}`),
      ` \u2014 ${job.message}`,
    ]),
    el('div', { className: 'progress-bar' }, [
      el('div', { className: 'progress-fill', style: `width: ${pct}%` }),
    ]),
    el('div', { className: 'actions', style: 'margin-top: 0.5rem' }, [
      el(
        'button',
        { className: 'btn btn-danger btn-small', onclick: handleCancelProof },
        'Cancel',
      ),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Config Footer
// ---------------------------------------------------------------------------

function renderConfigBar() {
  const c = state.config;
  const items = [];
  if (c.version) items.push(`v${c.version}`);
  if (c.circuitId) items.push(`Circuit: ${c.circuitId.slice(0, 18)}...`);
  if (c.workspace) items.push(`WS: ${c.workspace}`);

  return el('div', { className: 'config-bar' }, items.map((t) => el('span', {}, t)));
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

function weiToEth(weiStr) {
  const wei = BigInt(weiStr || '0');
  const eth = Number(wei) / 1e18;
  if (eth === 0) return '0';
  if (eth < 0.001) return '<0.001';
  return eth.toFixed(6).replace(/\.?0+$/, '');
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
