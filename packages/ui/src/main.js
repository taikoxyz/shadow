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
  selectedId: null,    // deposit ID for detail view
  config: null,        // server config
  queueJob: null,      // current proof job
  loading: true,
  error: null,
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const app = document.getElementById('app');

async function init() {
  render();
  await refresh();

  // Subscribe to real-time events
  api.onServerEvent(handleServerEvent);

  // Poll queue status periodically (fallback for missed WS events)
  setInterval(pollQueue, 5000);
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
  state.view = view;
  state.selectedId = id;
  render();
}

async function handleProve(depositId) {
  try {
    const job = await api.startProof(depositId);
    state.queueJob = job;
    render();
  } catch (err) {
    alert(`Failed to start proof: ${err.message}`);
  }
}

async function handleCancelProof() {
  try {
    await api.cancelProof();
    await pollQueue();
  } catch (err) {
    alert(`Failed to cancel: ${err.message}`);
  }
}

async function handleDeleteDeposit(id, includeProof) {
  try {
    await api.deleteDeposit(id, includeProof);
    if (state.view === 'detail' && state.selectedId === id) {
      navigateTo('list');
    }
    await refresh();
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
}

async function handleDeleteProof(id) {
  try {
    await api.deleteProof(id);
    await refresh();
  } catch (err) {
    alert(`Failed to delete proof: ${err.message}`);
  }
}

async function handleRefreshNote(depositId, noteIndex) {
  try {
    const result = await api.refreshNoteStatus(depositId, noteIndex);
    // Update in-memory state
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  app.innerHTML = '';
  app.appendChild(renderHeader());

  if (state.loading) {
    app.appendChild(el('div', { className: 'empty-state' }, [el('p', {}, 'Loading...')]));
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
  return el('div', { className: 'header' }, [
    el('h1', {
      style: 'cursor: pointer',
      onclick: () => navigateTo('list'),
    }, 'Shadow'),
    el('div', { className: 'header-status' }, [
      `${state.deposits.length} deposit${state.deposits.length !== 1 ? 's' : ''}`,
      state.config?.rpcUrl ? ' \u00b7 RPC connected' : '',
    ].join('')),
  ]);
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function renderListView() {
  if (state.deposits.length === 0) {
    return el('div', { className: 'empty-state' }, [
      el('h2', {}, 'No deposits found'),
      el('p', {}, 'Place deposit JSON files in the workspace directory to get started.'),
    ]);
  }

  return el('div', { className: 'deposit-list' }, state.deposits.map(renderDepositCard));
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
        el('span', { className: 'deposit-card-id' }, deposit.id),
        proofBadge,
      ]),
      el('div', { className: 'deposit-card-meta' }, [
        el('span', {}, `${deposit.noteCount} note${deposit.noteCount !== 1 ? 's' : ''}`),
        el('span', {}, `${totalEth} ETH`),
        el('span', {}, `Chain ${deposit.chainId}`),
        deposit.createdAt
          ? el('span', {}, formatDate(deposit.createdAt))
          : null,
      ].filter(Boolean)),
    ],
  );
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
      ` / ${deposit.id}`,
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
          el('td', { style: 'font-family: monospace; font-size: 0.8rem' }, truncateAddr(note.recipient)),
          el('td', {}, `${weiToEth(note.amount)} ETH`),
          el('td', {}, [
            el('span', { className: `badge badge-${note.claimStatus}` }, note.claimStatus),
          ]),
          el('td', {}, [
            el(
              'button',
              {
                className: 'btn btn-small',
                onclick: (e) => {
                  e.stopPropagation();
                  handleRefreshNote(deposit.id, note.index);
                },
                title: 'Refresh on-chain status',
              },
              '\u21bb',
            ),
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
      el('strong', {}, `Proof: ${job.depositId}`),
      ` \u2014 ${job.message}`,
    ]),
    el('div', { className: 'progress-bar' }, [
      el('div', { className: 'progress-fill', style: `width: ${pct}%` }),
    ]),
    el('div', { className: 'actions' }, [
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
  if (c.workspace) items.push(`Workspace: ${c.workspace}`);

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
