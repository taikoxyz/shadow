/**
 * Shadow Server API client.
 *
 * All workspace scanning, proof generation, and on-chain queries are handled
 * by the backend server. The UI is a thin client.
 */

const API_BASE = '/api';
let wsConnection = null;
let wsReconnectTimer = null;
const wsListeners = new Set();

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

async function apiFetch(path, options = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API ${options.method || 'GET'} ${path}: ${resp.status} ${text}`);
  }
  return resp.json();
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
export function startProof(depositId) {
  return apiFetch(`/deposits/${encodeURIComponent(depositId)}/prove`, {
    method: 'POST',
  });
}

/** GET /api/queue */
export function getQueueStatus() {
  return apiFetch('/queue');
}

/** DELETE /api/queue/current */
export function cancelProof() {
  return apiFetch('/queue/current', { method: 'DELETE' });
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

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/** Subscribe to real-time server events. Returns an unsubscribe function. */
export function onServerEvent(callback) {
  wsListeners.add(callback);
  ensureWebSocket();
  return () => wsListeners.delete(callback);
}

function ensureWebSocket() {
  if (wsConnection && wsConnection.readyState <= WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  try {
    wsConnection = new WebSocket(url);

    wsConnection.onopen = () => {
      console.log('[ws] connected');
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const listener of wsListeners) {
          try {
            listener(data);
          } catch (err) {
            console.error('[ws] listener error:', err);
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    wsConnection.onclose = () => {
      console.log('[ws] disconnected, reconnecting in 3s...');
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
    ensureWebSocket();
  }, 3000);
}
