/**
 * Shadow Server API client.
 *
 * All workspace scanning, proof generation, and on-chain queries are handled
 * by the backend server. The UI is a thin client.
 */

const API_BASE = '/api';

// Debug logging — enable via localStorage.setItem('shadow-debug', '1') or ?debug URL param
function isDebugEnabled() {
  if (localStorage.getItem('shadow-debug') === '1') return true;
  if (new URLSearchParams(location.search).has('debug')) return true;
  return false;
}

export const log = {
  debug: (...args) => { if (isDebugEnabled()) console.debug('[shadow]', ...args); },
  info: (...args) => { if (isDebugEnabled()) console.log('[shadow]', ...args); },
  warn: (...args) => console.warn('[shadow]', ...args),
  error: (...args) => console.error('[shadow]', ...args),
};

let wsConnection = null;
let wsReconnectTimer = null;
const wsListeners = new Set();

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';
  log.debug(`API ${method} ${path}`);
  const start = performance.now();
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const elapsed = (performance.now() - start).toFixed(0);
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    log.error(`API ${method} ${path}: ${resp.status} (${elapsed}ms)`, text);
    throw new Error(`API ${method} ${path}: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  log.debug(`API ${method} ${path}: ${resp.status} (${elapsed}ms)`);
  return data;
}

/** GET /api/health */
export function getHealth() {
  return apiFetch('/health');
}

/** GET /api/config */
export function getConfig() {
  return apiFetch('/config');
}

/** GET /api/deposits */
export function getDeposits() {
  return apiFetch('/deposits');
}

/** GET /api/deposits/:id */
export function getDeposit(id) {
  return apiFetch(`/deposits/${encodeURIComponent(id)}`);
}

/** POST /api/deposits — mine a new deposit */
export function createDeposit(chainId, notes, comment) {
  return apiFetch('/deposits', {
    method: 'POST',
    body: JSON.stringify({ chainId, notes, ...(comment ? { comment } : {}) }),
  });
}

/** DELETE /api/deposits/:id */
export function deleteDeposit(id, includeProof = false) {
  return apiFetch(
    `/deposits/${encodeURIComponent(id)}?include_proof=${includeProof}`,
    { method: 'DELETE' },
  );
}

/** DELETE /api/deposits/:id/proof */
export function deleteProof(depositId) {
  return apiFetch(`/deposits/${encodeURIComponent(depositId)}/proof`, {
    method: 'DELETE',
  });
}

/** POST /api/deposits/:id/prove */
export function startProof(depositId, force = false) {
  const path = `/deposits/${encodeURIComponent(depositId)}/prove${force ? '?force=true' : ''}`;
  return apiFetch(path, { method: 'POST' });
}

/** GET /api/queue */
export function getQueueStatus() {
  return apiFetch('/queue');
}

/** DELETE /api/queue/current */
export function cancelProof() {
  return apiFetch('/queue/current', { method: 'DELETE' });
}

/** GET /api/deposits/:id/balance */
export function getDepositBalance(depositId) {
  return apiFetch(`/deposits/${encodeURIComponent(depositId)}/balance`);
}

/** GET /api/deposits/:id/notes/:noteIndex/status */
export function getNoteStatus(depositId, noteIndex) {
  return apiFetch(
    `/deposits/${encodeURIComponent(depositId)}/notes/${noteIndex}/status`,
  );
}

/** POST /api/deposits/:id/notes/:noteIndex/refresh */
export function refreshNoteStatus(depositId, noteIndex) {
  return apiFetch(
    `/deposits/${encodeURIComponent(depositId)}/notes/${noteIndex}/refresh`,
    { method: 'POST' },
  );
}

/** GET /api/deposits/:id/notes/:noteIndex/claim-tx — get claim tx calldata */
export function getClaimTx(depositId, noteIndex) {
  return apiFetch(
    `/deposits/${encodeURIComponent(depositId)}/notes/${noteIndex}/claim-tx`,
  );
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

let wsReconnectDelay = 1000;
const WS_MAX_DELAY = 30000;
let wsPingInterval = null;

/** Subscribe to real-time server events. Returns an unsubscribe function. */
export function onServerEvent(callback) {
  wsListeners.add(callback);
  ensureWebSocket();
  return () => wsListeners.delete(callback);
}

function notifyListeners(event) {
  for (const listener of wsListeners) {
    try { listener(event); } catch (err) { log.error('WS listener error:', err); }
  }
}

function ensureWebSocket() {
  if (wsConnection && wsConnection.readyState <= WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  try {
    wsConnection = new WebSocket(url);

    wsConnection.onopen = () => {
      log.info('WebSocket connected');
      wsReconnectDelay = 1000; // reset backoff on success
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

      // Heartbeat ping every 25s to keep the connection alive
      if (wsPingInterval) clearInterval(wsPingInterval);
      wsPingInterval = setInterval(() => {
        if (wsConnection?.readyState === WebSocket.OPEN) {
          wsConnection.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);

      notifyListeners({ type: 'ws:connected' });
    };

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;
        log.info(`WS ${data.type}`, data);
        notifyListeners(data);
      } catch {
        log.warn('WS non-JSON message:', event.data);
      }
    };

    wsConnection.onclose = () => {
      log.info(`WebSocket disconnected, reconnecting in ${wsReconnectDelay}ms`);
      if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
      notifyListeners({ type: 'ws:disconnected' });
      scheduleReconnect();
    };

    wsConnection.onerror = () => {
      wsConnection?.close();
    };
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_MAX_DELAY);
    ensureWebSocket();
  }, wsReconnectDelay);
}
