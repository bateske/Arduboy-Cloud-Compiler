/**
 * Tool Options Modal.
 *
 * Shows known ports, connection state, port history, and lets the user
 * unpair devices or clear tool localStorage.
 */

import { USB_FILTERS, isBootloaderFilter } from '../core/constants.js';

/** @type {HTMLDivElement|null} */
let overlayEl = null;

/** @type {HTMLDivElement|null} */
let bodyEl = null;

/** @type {(() => void)|null} */
let cleanupFn = null;

// ── localStorage key for port history ──────────────────────────────────────
const PORT_HISTORY_KEY = 'serial-port-history';

/**
 * @typedef {Object} PortHistoryEntry
 * @property {number} vid - USB vendor ID
 * @property {number} pid - USB product ID
 * @property {'bootloader'|'sketch'} mode - Last-seen connection mode
 * @property {number} lastSeen - Timestamp (ms)
 */

/**
 * Load port history from localStorage.
 * @returns {PortHistoryEntry[]}
 */
export function loadPortHistory() {
  try {
    return JSON.parse(localStorage.getItem(PORT_HISTORY_KEY) || '[]');
  } catch { return []; }
}

/**
 * Save a port sighting to history.
 * @param {{usbVendorId?: number, usbProductId?: number}} info - From port.getInfo()
 * @param {'bootloader'|'sketch'} mode
 */
export function recordPort(info, mode) {
  if (!info?.usbVendorId) return;
  const history = loadPortHistory();
  const existing = history.find(
    (e) => e.vid === info.usbVendorId && e.pid === info.usbProductId
  );
  if (existing) {
    existing.mode = mode;
    existing.lastSeen = Date.now();
  } else {
    history.push({
      vid: info.usbVendorId,
      pid: info.usbProductId,
      mode,
      lastSeen: Date.now(),
    });
  }
  localStorage.setItem(PORT_HISTORY_KEY, JSON.stringify(history));
}

/** Clear the port history. */
export function clearPortHistory() {
  localStorage.removeItem(PORT_HISTORY_KEY);
}

// ── Known webtools localStorage keys (excluding Monaco) ──────────────────
const WEBTOOLS_STORAGE_KEYS = [
  'activeMainTab',
  'fxdata-overwriteByDefault',
  'fxdata-activeTab',
  'fxdata-project',
  'imageConverter-state',
  'arduboy-music-state',
  'cartEditor-state',
  'packageEditor-state',
  'autoReset',
  'autoConnect',
  PORT_HISTORY_KEY,
];

const WEBTOOLS_STORAGE_PREFIXES = [
  'MusicEditor.',
];

/**
 * Clear all webtools-related localStorage (not Monaco).
 * @returns {number} Number of keys removed
 */
function clearWebtoolsStorage() {
  let count = 0;
  for (const key of WEBTOOLS_STORAGE_KEYS) {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      count++;
    }
  }
  // Also clear prefix-matched keys
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (WEBTOOLS_STORAGE_PREFIXES.some((p) => key.startsWith(p))) {
      localStorage.removeItem(key);
      count++;
    }
  }
  return count;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function vidPidLabel(vid, pid) {
  return `${vid.toString(16).toUpperCase().padStart(4, '0')}:${pid.toString(16).toUpperCase().padStart(4, '0')}`;
}

function deviceName(vid, pid) {
  const names = {
    '2341:0036': 'Leonardo',
    '2341:8036': 'Leonardo',
    '2A03:0036': 'Leonardo Alt',
    '2A03:8036': 'Leonardo Alt',
    '2341:0037': 'Micro',
    '2341:8037': 'Micro',
    '2A03:0037': 'Micro Alt',
    '2A03:8037': 'Micro Alt',
    '2341:0237': 'Genuino Micro',
    '2341:8237': 'Genuino Micro',
    '1B4F:9205': 'Pro Micro',
    '1B4F:9206': 'Pro Micro',
    '239A:000E': 'ItsyBitsy',
    '239A:800E': 'ItsyBitsy',
  };
  return names[vidPidLabel(vid, pid)] || 'Unknown';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Modal DOM ──────────────────────────────────────────────────────────────

function ensureOverlay() {
  if (overlayEl) return overlayEl;

  overlayEl = document.createElement('div');
  overlayEl.className = 'serial-modal-overlay hidden';
  overlayEl.innerHTML = `
    <div class="serial-modal-card">
      <div class="serial-modal-header">
        <h3 class="serial-modal-title">Tool Options</h3>
        <button class="serial-modal-close" title="Close">&times;</button>
      </div>
      <div class="serial-modal-body"></div>
      <div class="serial-modal-footer">
        <button class="btn btn-danger btn-sm hidden" id="serial-revoke-all">🔌 Revoke Port Permissions</button>
        <button class="btn btn-danger btn-sm" id="serial-clear-storage">🧰 Clear Tool Storage</button>
      </div>
    </div>`;
  document.body.appendChild(overlayEl);

  bodyEl = overlayEl.querySelector('.serial-modal-body');
  return overlayEl;
}

/**
 * Build the modal body content.
 * @param {Object} state
 * @param {SerialPort[]|null} state.grantedPorts - From navigator.serial.getPorts()
 * @param {SerialTransport|null} state.transport - Current transport
 * @param {'bootloader'|'sketch'|null} state.connectionMode
 */
function renderBody(state) {
  const { grantedPorts, transport, connectionMode } = state;
  const activeInfo = transport?.getPortInfo?.() || null;

  let html = '';

  // ── Current connection ──────────────────────────────────────────────────
  html += `<div class="serial-section">`;
  html += `<div class="serial-section-label">Current Connection</div>`;
  if (activeInfo?.usbVendorId) {
    const label = vidPidLabel(activeInfo.usbVendorId, activeInfo.usbProductId);
    const name = deviceName(activeInfo.usbVendorId, activeInfo.usbProductId);
    const modeTag = connectionMode === 'bootloader'
      ? '<span class="serial-tag serial-tag-bootloader">BOOTLOADER</span>'
      : '<span class="serial-tag serial-tag-sketch">SKETCH</span>';
    html += `<table class="serial-device-table"><tbody>
      <tr class="serial-port-active">
        <td class="serial-col-name">${name}</td>
        <td class="serial-col-vid">${label}</td>
        <td class="serial-col-mode">${modeTag}</td>
        <td class="serial-col-status"><span class="serial-tag serial-tag-active">CONNECTED</span></td>
      </tr>
    </tbody></table>`;
  } else {
    html += `<div class="serial-port-row serial-port-empty">No device connected</div>`;
  }
  html += `</div>`;

  // ── Web Serial info ─────────────────────────────────────────────────────
  html += `<div class="serial-section serial-section-info">`;
  html += `<div class="serial-section-label">Info</div>`;
  html += `<div class="serial-info-text">Web Serial API: ${'serial' in navigator ? '✓ Supported' : '✗ Not supported'}</div>`;
  html += `<div class="serial-info-text">Granted ports: ${grantedPorts?.length ?? '?'}</div>`;
  html += `</div>`;

  // ── Settings ────────────────────────────────────────────────────────────
  const autoResetChecked = localStorage.getItem('autoReset') !== 'false';
  html += `<div class="serial-section">`;
  html += `<div class="serial-section-label">Settings</div>`;
  html += `<label class="serial-toggle-row">`;
  html += `<span class="serial-toggle-label">Auto Reset</span>`;
  html += `<input type="checkbox" id="serial-auto-reset" class="serial-toggle-input" ${autoResetChecked ? 'checked' : ''}>`;
  html += `<span class="serial-toggle-track"><span class="serial-toggle-thumb"></span></span>`;
  html += `</label>`;
  html += `<div class="serial-info-text">Automatically reset from sketch mode to bootloader when an action requires it</div>`;
  const autoConnectChecked = localStorage.getItem('autoConnect') !== 'false';
  html += `<label class="serial-toggle-row">`;
  html += `<span class="serial-toggle-label">Auto Connect</span>`;
  html += `<input type="checkbox" id="serial-auto-connect" class="serial-toggle-input" ${autoConnectChecked ? 'checked' : ''}>`;
  html += `<span class="serial-toggle-track"><span class="serial-toggle-thumb"></span></span>`;
  html += `</label>`;
  html += `<div class="serial-info-text">Automatically connect when a paired device is plugged in or found on page load</div>`;
  html += `</div>`;

  bodyEl.innerHTML = html;

  // Wire up Auto Reset toggle
  const autoResetInput = bodyEl.querySelector('#serial-auto-reset');
  if (autoResetInput) {
    autoResetInput.addEventListener('change', () => {
      localStorage.setItem('autoReset', autoResetInput.checked);
    });
  }
  // Wire up Auto Connect toggle
  const autoConnectInput = bodyEl.querySelector('#serial-auto-connect');
  if (autoConnectInput) {
    autoConnectInput.addEventListener('change', () => {
      localStorage.setItem('autoConnect', autoConnectInput.checked);
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Open the serial settings modal.
 * @param {Object} opts
 * @param {() => {transport: SerialTransport|null, connectionMode: string|null}} opts.getState
 * @param {() => void} opts.onDisconnect - Callback to disconnect current device
 * @param {(msg: string, type: string) => void} opts.showToast
 */
export async function openSerialModal(opts) {
  const { getState, onDisconnect, showToast } = opts;
  const overlay = ensureOverlay();
  const card = overlay.querySelector('.serial-modal-card');

  const freshState = () => {
    const { transport, connectionMode } = getState();
    return { transport, connectionMode, onDisconnect, showToast };
  };

  // Gather granted ports
  let grantedPorts = [];
  try {
    grantedPorts = await navigator.serial.getPorts();
  } catch { /* ignore */ }

  renderBody({ ...freshState(), grantedPorts });

  // Show/hide Revoke button based on granted ports
  const revokeBtn = overlay.querySelector('#serial-revoke-all');
  revokeBtn.classList.toggle('hidden', grantedPorts.length === 0);

  // Show
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    card.classList.add('visible');
  });

  // Cleanup previous listeners
  if (cleanupFn) cleanupFn();

  // ── Live refresh polling ───────────────────────────────────────────────
  let refreshTimer = null;
  const startLiveRefresh = () => {
    refreshTimer = setInterval(async () => {
      try {
        const ports = await navigator.serial.getPorts();
        currentPorts = ports;
        revokeBtn.classList.toggle('hidden', ports.length === 0);
        renderBody({ ...freshState(), grantedPorts: ports });
      } catch { /* ignore */ }
    }, 1500);
  };
  const stopLiveRefresh = () => {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  };
  startLiveRefresh();

  const close = () => {
    stopLiveRefresh();
    overlay.classList.remove('visible');
    card.classList.remove('visible');
    setTimeout(() => overlay.classList.add('hidden'), 200);
    if (cleanupFn) { cleanupFn(); cleanupFn = null; }
  };

  // Event handlers
  const onBackdrop = (e) => { if (e.target === overlay) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onCloseBtn = () => close();

  const closeBtn = overlay.querySelector('.serial-modal-close');
  closeBtn.addEventListener('click', onCloseBtn);
  overlay.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);

  let currentPorts = grantedPorts;

  // Revoke Port Permissions — show standalone confirmation dialog
  const onRevokeAll = () => {
    const confirmOverlay = document.createElement('div');
    confirmOverlay.className = 'serial-confirm-overlay';
    confirmOverlay.innerHTML = `
      <div class="serial-confirm-card">
        <p>Revoking Port Permissions will remove pairing from all connected devices.</p>
        <p>Any active connection will be closed. You will need to re-pair your device to use it again.</p>
        <div class="serial-confirm-actions">
          <button class="btn btn-danger btn-sm" id="serial-revoke-confirm">Confirm Revoke</button>
          <button class="btn btn-secondary btn-sm" id="serial-revoke-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(confirmOverlay);
    requestAnimationFrame(() => confirmOverlay.classList.add('visible'));

    const dismissConfirm = () => {
      confirmOverlay.classList.remove('visible');
      setTimeout(() => confirmOverlay.remove(), 200);
    };

    confirmOverlay.querySelector('#serial-revoke-cancel').addEventListener('click', dismissConfirm);
    confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) dismissConfirm(); });

    confirmOverlay.querySelector('#serial-revoke-confirm').addEventListener('click', async () => {
      // Disconnect cleanly before revoking so the port isn't held open
      const { transport } = getState();
      if (transport) {
        try { await onDisconnect(); } catch { /* ignore */ }
      }

      let revoked = 0;
      try {
        const ports = await navigator.serial.getPorts();
        for (const port of ports) {
          try { await port.forget(); revoked++; } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      clearPortHistory();
      showToast(
        revoked > 0
          ? `Revoked ${revoked} port${revoked !== 1 ? 's' : ''} and cleared history`
          : 'Cleared device history (no connected ports to revoke)',
        'info'
      );
      dismissConfirm();
      try { currentPorts = await navigator.serial.getPorts(); } catch { currentPorts = []; }
      revokeBtn.classList.toggle('hidden', currentPorts.length === 0);
      renderBody({ ...freshState(), grantedPorts: currentPorts });
    });
  };
  revokeBtn.addEventListener('click', onRevokeAll);

  // Clear storage button
  const clearBtn = overlay.querySelector('#serial-clear-storage');
  const onClearStorage = () => {
    const confirmOverlay = document.createElement('div');
    confirmOverlay.className = 'serial-confirm-overlay';
    confirmOverlay.innerHTML = `
      <div class="serial-confirm-card">
        <p style="font-size:1.1em;font-weight:600;">Clear Tool Storage</p>
        <p>This will erase all saved data from the tools. The page will automatically refresh.</p>
        <p style="color:var(--color-danger,#ef4444);">All unsaved work will be lost.</p>
        <div class="serial-confirm-actions">
          <button class="btn btn-danger btn-sm" id="clear-storage-confirm">Confirm Clear</button>
          <button class="btn btn-secondary btn-sm" id="clear-storage-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(confirmOverlay);
    requestAnimationFrame(() => confirmOverlay.classList.add('visible'));

    const dismissConfirm = () => {
      confirmOverlay.classList.remove('visible');
      setTimeout(() => confirmOverlay.remove(), 200);
    };

    confirmOverlay.querySelector('#clear-storage-cancel').addEventListener('click', dismissConfirm);
    confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) dismissConfirm(); });

    confirmOverlay.querySelector('#clear-storage-confirm').addEventListener('click', () => {
      clearWebtoolsStorage();
      location.reload();
    });
  };
  clearBtn.addEventListener('click', onClearStorage);

  cleanupFn = () => {
    stopLiveRefresh();
    closeBtn.removeEventListener('click', onCloseBtn);
    overlay.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
    revokeBtn.removeEventListener('click', onRevokeAll);
    clearBtn.removeEventListener('click', onClearStorage);
  };
}
