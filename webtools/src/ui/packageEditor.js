/**
 * Package Editor — create and edit .arduboy game packages.
 *
 * Two-pane layout:
 *   Left  – Package Info (metadata fields, contributors, license)
 *   Right – Binaries list (each with hex, FX data, FX save, cart image, device)
 *
 * Modelled after arduboy_toolset's widget_package.py.
 */

import {
  readArduboyFile, writeArduboyFile,
  SCREEN_WIDTH, SCREEN_HEIGHT,
  parseIntelHex, generateIntelHex, detectDeviceFromProgram,
  patchCSPin,
  screenToImageData, imageDataToScreen,
} from '../core/index.js';
import { readFileAsArrayBuffer, downloadBlob } from './files.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';

const STORAGE_KEY = 'packageEditor-state';
const STORAGE_SAVE_DELAY = 500;

const ALLOWED_DEVICES = ['Arduboy', 'ArduboyFX', 'ArduboyMini'];
const PATCHABLE_DEVICES = new Set(['ArduboyFX', 'ArduboyMini']);
const DEVICE_LABELS = { Arduboy: 'Arduboy', ArduboyFX: 'Arduboy FX', ArduboyMini: 'Arduboy FX-C / Mini' };
const LICENSE_HELP_URL = 'https://choosealicense.com/';

// ── Base64 helpers for Uint8Array ↔ string conversion ────────────────────

function _u8ToBase64(u8) {
  if (!u8 || u8.length === 0) return '';
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

function _base64ToU8(str) {
  if (!str) return new Uint8Array(0);
  const binary = atob(str);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return u8;
}

/** Convert an ImageBitmap to a 1024-byte screen buffer (1-bit monochrome). */
function _imageBitmapToRaw(bitmap) {
  const canvas = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  const imgData = ctx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  return imageDataToScreen(imgData);
}

/** Detect device type from hex string, returns null if unavailable. */
function _detectDeviceFromHex(hexRaw) {
  if (!hexRaw) return null;
  try {
    const parsed = parseIntelHex(hexRaw);
    return detectDeviceFromProgram(parsed.data);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PackageEditor
// ─────────────────────────────────────────────────────────────────────────────

export class PackageEditor {
  /** @type {Object[]} Binary entries */
  _binaries = [];

  /** @type {number} Selected binary index */
  _selectedBinary = -1;



  /** @type {number|null} Debounced save timer */
  _saveTimer = null;

  constructor() {
    this._bindToolbar();
    this._bindFields();
    this._bindResizeHandle();
    if (!this._restoreFromStorage()) {
      this._addBinary(); // Start with one empty binary
    }
    this._renderBinaryList();
    this._renderBinaryDetail();
    this._updateContributorsVisibility();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar
  // ═══════════════════════════════════════════════════════════════════════════

  _bindToolbar() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    on('btn-pkg-load', () => this._loadPackage());
    on('btn-pkg-save', () => this._savePackage());
    on('btn-pkg-reset', () => this._resetPackage());

    // Binary controls
    on('btn-pkg-add-binary', () => {
      this._addBinary();
      this._renderBinaryList();
      this._renderBinaryDetail();
    });
    on('btn-pkg-remove-binary', () => {
      this._removeBinary();
    });

    // Contributor controls
    on('btn-pkg-add-contributor', () => this._addContributorRow());
    on('btn-pkg-remove-contributor', () => this._removeContributorRow());

    // Load file input
    document.getElementById('pkg-load-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await this._doLoad(file);
      e.target.value = '';
    });
  }

  _bindFields() {
    // Listen for metadata field changes to persist state
    const fields = ['pkg-title', 'pkg-version', 'pkg-author', 'pkg-description',
      'pkg-genre', 'pkg-url', 'pkg-sourceurl', 'pkg-email'];
    for (const id of fields) {
      document.getElementById(id)?.addEventListener('input', () => this._scheduleSave());
    }
    document.getElementById('pkg-license')?.addEventListener('change', () => this._scheduleSave());
  }

  _bindResizeHandle() {
    const handle = document.getElementById('pkg-resize-handle');
    const container = document.querySelector('.pkg-content');
    const rightPane = document.getElementById('pkg-right-pane');
    if (!handle || !container || !rightPane) return;

    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const rightWidth = rect.right - e.clientX - 5;
      const clamped = Math.max(250, Math.min(rightWidth, rect.width - 250));
      rightPane.style.flex = `0 0 ${clamped}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Load / Save / Reset
  // ═══════════════════════════════════════════════════════════════════════════

  _loadPackage() {
    document.getElementById('pkg-load-file')?.click();
  }

  async _doLoad(file) {
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const pkg = await readArduboyFile(new Uint8Array(buffer), file.name);
      this._fillFromPackage(pkg);
      showToast(`Loaded: ${pkg.title || file.name}`, 'success');
    } catch (err) {
      showToast(`Failed to load: ${err.message}`, 'error');
      console.error(err);
    }
  }

  async _savePackage() {
    try {
      // Check for device/detection mismatches before saving
      const mismatched = this._binaries.filter((b) => b.detectedDevice && b.detectedDevice !== b.device);
      if (mismatched.length > 0) {
        const lines = [];
        for (const b of mismatched) {
          const name = b.title || '(untitled)';
          lines.push('  ' + name + ' (selected ' + b.device + ', detected ' + b.detectedDevice + ')');
        }
        const canPatch = mismatched.some((b) => PATCHABLE_DEVICES.has(b.detectedDevice) && PATCHABLE_DEVICES.has(b.device));
        const buttons = [
          { label: 'Save Anyway', value: 'save', className: 'btn btn-primary' },
        ];
        if (canPatch) {
          buttons.push({ label: '\u26a0\ufe0f Experimental: Patch CS Pin', value: 'patch', className: 'btn btn-warning' });
        }
        buttons.push({ label: 'Cancel', value: false, className: 'btn btn-secondary' });
        const result = await showConfirm(
          mismatched.length + ' binary(ies) have a device mismatch:\n\n' + lines.join('\n'),
          { title: 'Device Mismatch', buttons }
        );
        if (!result) return;
        if (result === 'patch') {
          this._patchMismatchedCSPins(mismatched);
        }
      }

      const pkg = this._buildPackage();
      const blob = await writeArduboyFile(pkg);
      const filename = (pkg.title || 'package').replace(/[^a-zA-Z0-9_-]/g, '_') + '.arduboy';
      downloadBlob(blob, filename, 'application/zip');
      showToast(`Saved: ${filename}`, 'success');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
      console.error(err);
    }
  }

  _patchMismatchedCSPins(mismatched) {
    let totalPatched = 0;
    let binariesPatched = 0;

    for (const bin of mismatched) {
      if (!bin.hexRaw || !PATCHABLE_DEVICES.has(bin.detectedDevice) || !PATCHABLE_DEVICES.has(bin.device)) continue;
      try {
        const parsed = parseIntelHex(bin.hexRaw);
        const result = patchCSPin(parsed.data, bin.detectedDevice, bin.device);
        if (result.success) {
          bin.hexRaw = generateIntelHex(parsed.data);
          bin.detectedDevice = _detectDeviceFromHex(bin.hexRaw);
          totalPatched += result.count;
          binariesPatched++;
        }
      } catch { /* skip */ }
    }

    if (binariesPatched > 0) {
      showToast('Patched CS pin in ' + binariesPatched + ' binary(ies) (' + totalPatched + ' instruction(s))', 'info');
      this._renderBinaryList();
      this._renderBinaryDetail();
    } else {
      showToast('No CS pin patterns found to patch', 'warning');
    }
  }

  async _resetPackage() {
    if (!await showConfirm('Reset all package editor fields?')) return;

    // Clear metadata fields
    const fields = ['pkg-title', 'pkg-version', 'pkg-author', 'pkg-description',
      'pkg-genre', 'pkg-url', 'pkg-sourceurl', 'pkg-email'];
    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Clear license
    const licenseEl = document.getElementById('pkg-license');
    if (licenseEl) licenseEl.value = '';

    // Clear contributors
    const tbody = document.querySelector('#pkg-contributors-table tbody');
    if (tbody) tbody.innerHTML = '';
    this._updateContributorsVisibility();

    // Reset binaries
    this._binaries = [];
    this._selectedBinary = -1;
    this._addBinary();
    this._renderBinaryList();
    this._renderBinaryDetail();

    localStorage.removeItem(STORAGE_KEY);
    showToast('Package editor reset', 'info');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fill / Build Package
  // ═══════════════════════════════════════════════════════════════════════════

  _fillFromPackage(pkg) {
    // Metadata
    this._setField('pkg-title', pkg.title);
    this._setField('pkg-version', pkg.version);
    this._setField('pkg-author', pkg.author);
    this._setField('pkg-description', pkg.description);
    this._setField('pkg-genre', pkg.genre);
    this._setField('pkg-url', pkg.url);
    this._setField('pkg-sourceurl', pkg.sourceUrl);
    this._setField('pkg-email', pkg.email);

    // License
    const licenseEl = document.getElementById('pkg-license');
    if (licenseEl) licenseEl.value = pkg.license || '';

    // Contributors
    const tbody = document.querySelector('#pkg-contributors-table tbody');
    if (tbody) tbody.innerHTML = '';
    (pkg.contributors || []).forEach((c) => {
      this._addContributorRow(c.name, (c.roles || []).join(', '), (c.urls || []).join(', '));
    });
    this._updateContributorsVisibility();

    // Binaries
    this._binaries = [];
    this._selectedBinary = -1;

    for (const bin of (pkg.binaries || [])) {
      // Create a blob URL from the image blob for display
      let cartImageUrl = null;
      const blob = bin.cartImageBlob || null;
      if (blob) {
        cartImageUrl = URL.createObjectURL(blob);
      }

      this._binaries.push({
        title: bin.title || '',
        device: bin.device || 'Arduboy',
        detectedDevice: _detectDeviceFromHex(bin.hexRaw),
        hexRaw: bin.hexRaw || '',
        hexFilename: bin.hexFilename || '',
        dataRaw: bin.dataRaw || new Uint8Array(0),
        saveRaw: bin.saveRaw || new Uint8Array(0),
        cartImage: bin.cartImage || null,
        cartImageFilename: bin.cartImageFilename || '',
        cartImageBlob: blob,
        cartImageUrl,
        imageRaw: bin.cartImage ? _imageBitmapToRaw(bin.cartImage) : null,
        _originalImageRaw: null,
      });
    }

    if (this._binaries.length === 0) {
      this._addBinary();
    } else {
      this._selectedBinary = 0;
    }

    this._renderBinaryList();
    this._renderBinaryDetail();
  }

  _buildPackage() {
    const title = this._getField('pkg-title');
    const version = this._getField('pkg-version');
    const author = this._getField('pkg-author');

    if (!title) throw new Error('Title is required!');
    if (!version) throw new Error('Version is required! (e.g. 1.0)');
    if (!author) throw new Error('Author is required!');

    // Read contributors from table
    const contributors = [];
    const rows = document.querySelectorAll('#pkg-contributors-table tbody tr');
    rows.forEach((row) => {
      const cells = row.querySelectorAll('input');
      const name = cells[0]?.value?.trim() || '';
      const roles = (cells[1]?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
      const urls = (cells[2]?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (name) contributors.push({ name, roles, urls });
    });

    // Build binaries
    if (this._binaries.length === 0) throw new Error('At least one binary is required!');

    const binaries = this._binaries.map((b) => {
      if (!b.hexRaw) throw new Error(`Binary "${b.title || '(untitled)'}" is missing a .hex file!`);

      const safeName = (b.title || title || 'game').replace(/[^a-zA-Z0-9_-]/g, '_');
      const hexFilename = b.hexFilename || `${safeName}.hex`;

      if ((b.dataRaw?.length > 0 || b.saveRaw?.length > 0) && b.device === 'Arduboy') {
        throw new Error(`Binary "${b.title}" has FX data but device is set to "Arduboy". Use "ArduboyFX" or "ArduboyMini".`);
      }

      return {
        device: b.device,
        title: b.title || title,
        hexFilename,
        hexRaw: b.hexRaw,
        dataRaw: b.dataRaw || new Uint8Array(0),
        saveRaw: b.saveRaw || new Uint8Array(0),
        cartImage: b.cartImage,
        cartImageFilename: b.cartImageFilename || '',
        cartImageBlob: b.cartImageBlob || null,
        imageRaw: b.imageRaw || null,
      };
    });

    return {
      originalFilename: title,
      schemaVersion: 4,
      title,
      version,
      author,
      description: this._getField('pkg-description'),
      license: document.getElementById('pkg-license')?.value || '',
      date: new Date().toISOString().slice(0, 10),
      genre: this._getField('pkg-genre'),
      url: this._getField('pkg-url'),
      sourceUrl: this._getField('pkg-sourceurl'),
      email: this._getField('pkg-email'),
      companion: '',
      contributors,
      binaries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Contributors
  // ═══════════════════════════════════════════════════════════════════════════

  _addContributorRow(name = '', roles = '', urls = '') {
    const tbody = document.querySelector('#pkg-contributors-table tbody');
    if (!tbody) return;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="text" class="pkg-contrib-input" value="${this._escAttr(name)}" placeholder="Name"></td>
      <td><input type="text" class="pkg-contrib-input" value="${this._escAttr(roles)}" placeholder="Code, Art, Sound..."></td>
      <td><input type="text" class="pkg-contrib-input" value="${this._escAttr(urls)}" placeholder="https://..."></td>`;
    tbody.appendChild(row);
    this._updateContributorsVisibility();
    // Save on contributor text changes
    row.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => this._scheduleSave()));
    this._scheduleSave();
  }

  _removeContributorRow() {
    const tbody = document.querySelector('#pkg-contributors-table tbody');
    if (!tbody) return;
    const lastRow = tbody.querySelector('tr:last-child');
    if (lastRow) lastRow.remove();
    this._updateContributorsVisibility();
    this._scheduleSave();
  }

  _updateContributorsVisibility() {
    const wrap = document.querySelector('.pkg-contributors-wrap');
    const tbody = document.querySelector('#pkg-contributors-table tbody');
    if (!wrap || !tbody) return;
    
    const hasRows = tbody.querySelectorAll('tr').length > 0;
    wrap.classList.toggle('hidden', !hasRows);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Binaries
  // ═══════════════════════════════════════════════════════════════════════════

  _addBinary(data = null) {
    this._binaries.push(data || {
      title: '',
      device: 'Arduboy',
      detectedDevice: null,
      hexRaw: '',
      hexFilename: '',
      dataRaw: new Uint8Array(0),
      saveRaw: new Uint8Array(0),
      cartImage: null,
      cartImageFilename: '',
      cartImageBlob: null,
      cartImageUrl: null,
      imageRaw: null,
      _originalImageRaw: null,
    });
    this._selectedBinary = this._binaries.length - 1;
  }

  _removeBinary() {
    if (this._selectedBinary < 0 || this._binaries.length === 0) return;
    this._binaries.splice(this._selectedBinary, 1);
    if (this._selectedBinary >= this._binaries.length) {
      this._selectedBinary = this._binaries.length - 1;
    }
    this._renderBinaryList();
    this._renderBinaryDetail();
  }

  _renderBinaryList() {
    const list = document.getElementById('pkg-binary-list');
    if (!list) return;
    list.innerHTML = '';
    this._scheduleSave();

    this._binaries.forEach((bin, i) => {
      const el = document.createElement('div');
      el.className = 'pkg-binary-item' + (i === this._selectedBinary ? ' selected' : '');
      const label = bin.title || `Binary ${i + 1}`;
      const device = bin.device || 'Arduboy';
      const deviceLabel = DEVICE_LABELS[device] || device;
      const hasHex = bin.hexRaw ? '✓' : '✗';
      const hasData = bin.dataRaw?.length > 0 ? '✓' : '—';
      const hasSave = bin.saveRaw?.length > 0 ? '✓' : '—';
      el.innerHTML = `
        <span class="pkg-binary-name">${this._esc(label)}</span>
        <span class="pkg-binary-device">${deviceLabel}</span>
        <span class="pkg-binary-flags">hex:${hasHex} data:${hasData} save:${hasSave}</span>`;
      el.addEventListener('click', () => {
        this._selectedBinary = i;
        this._renderBinaryList();
        this._renderBinaryDetail();
      });
      list.appendChild(el);
    });
  }

  _renderBinaryDetail() {
    const panel = document.getElementById('pkg-binary-detail');
    if (!panel) return;

    if (this._selectedBinary < 0 || this._selectedBinary >= this._binaries.length) {
      panel.innerHTML = '<p class="pkg-binary-empty">No binary selected</p>';
      return;
    }

    const bin = this._binaries[this._selectedBinary];
    const hexSize = bin.hexRaw ? new TextEncoder().encode(bin.hexRaw).length : 0;
    const dataSize = bin.dataRaw?.length || 0;
    const saveSize = bin.saveRaw?.length || 0;

    panel.innerHTML = `
      <div class="pkg-binary-form">
        <input type="text" id="pkg-binary-title" class="pkg-field-input" value="${this._escAttr(bin.title)}" placeholder="Binary title (optional)">

        <div class="pkg-binary-image-section">
          <canvas id="pkg-binary-canvas" class="pkg-binary-canvas" width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}"></canvas>
          <div class="pkg-binary-image-actions">
            <button class="btn btn-sm btn-secondary" id="btn-pkg-binary-image" title="Import image"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10V1m0 0L5 4m3-3 3 3M2 12v2h12v-2"/></svg></button>
            <input type="file" id="pkg-binary-image-file" accept="image/*" class="file-input">
            <button class="btn btn-sm btn-outline" id="btn-pkg-binary-save-image" title="Export as PNG"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v9m0 0L5 7m3 3 3-3M2 12v2h12v-2"/></svg></button>
            <span class="pkg-binary-image-sep"></span>
            <button class="btn btn-sm btn-secondary" id="btn-pkg-binary-edit-image" title="Open pixel editor">Edit</button>
            <button class="btn btn-sm btn-danger" id="btn-pkg-binary-revert-image" title="Revert to original image" style="display:none">Revert</button>
            <button class="btn btn-sm btn-danger" id="btn-pkg-binary-clear-image">Clear</button>
          </div>
        </div>

        <div class="pkg-binary-detected-row${bin.detectedDevice ? '' : ' hidden'}">
          <span class="pkg-binary-device-label">Detected:</span>
          <span id="pkg-binary-detected" class="pkg-binary-detected-value${bin.detectedDevice && bin.detectedDevice !== bin.device ? ' pkg-device-mismatch' : ''}">${DEVICE_LABELS[bin.detectedDevice] || bin.detectedDevice || '—'}</span>
          ${bin.detectedDevice && bin.detectedDevice !== bin.device && PATCHABLE_DEVICES.has(bin.detectedDevice) && PATCHABLE_DEVICES.has(bin.device) ? '<button class="btn btn-sm btn-warning pkg-patch-cspin-btn" id="btn-pkg-patch-cspin">⚠️ Patch CS Pin</button>' : ''}
        </div>
        <div class="pkg-binary-device-row">
          <span class="pkg-binary-device-label">Device:</span>
          <select id="pkg-binary-device" class="pkg-field-select${bin.detectedDevice && bin.detectedDevice !== bin.device ? ' pkg-device-mismatch' : ''}">
            ${ALLOWED_DEVICES.map((d) => `<option value="${d}" ${d === bin.device ? 'selected' : ''}>${DEVICE_LABELS[d] || d}</option>`).join('')}
          </select>
        </div>

        <div class="pkg-binary-files">
          <div class="pkg-binary-file-row">
            <span class="pkg-binary-file-label">Program</span>
            <span class="pkg-binary-file-size">${hexSize ? this._formatBytes(hexSize) : 'None'}</span>
            <button class="btn btn-sm btn-secondary" id="btn-pkg-binary-hex">Set .hex</button>
            <input type="file" id="pkg-binary-hex-file" accept=".hex" class="file-input">
            <button class="btn btn-sm btn-outline" id="btn-pkg-binary-clear-hex" ${!hexSize ? 'disabled' : ''}>Clear</button>
          </div>
          <div class="pkg-binary-file-row">
            <span class="pkg-binary-file-label">FX Data</span>
            <span class="pkg-binary-file-size">${dataSize ? this._formatBytes(dataSize) : 'None'}</span>
            <button class="btn btn-sm btn-secondary" id="btn-pkg-binary-data">Set .bin</button>
            <input type="file" id="pkg-binary-data-file" accept=".bin" class="file-input">
            <button class="btn btn-sm btn-outline" id="btn-pkg-binary-clear-data" ${!dataSize ? 'disabled' : ''}>Clear</button>
          </div>
          <div class="pkg-binary-file-row">
            <span class="pkg-binary-file-label">FX Save</span>
            <span class="pkg-binary-file-size">${saveSize ? this._formatBytes(saveSize) : 'None'}</span>
            <button class="btn btn-sm btn-secondary" id="btn-pkg-binary-save">Set .bin</button>
            <input type="file" id="pkg-binary-save-file" accept=".bin" class="file-input">
            <button class="btn btn-sm btn-outline" id="btn-pkg-binary-clear-save" ${!saveSize ? 'disabled' : ''}>Clear</button>
          </div>
        </div>
      </div>`;

    this._bindBinaryDetailEvents(panel, bin);
  }

  _bindBinaryDetailEvents(panel, bin) {
    // Title
    panel.querySelector('#pkg-binary-title')?.addEventListener('input', (e) => {
      bin.title = e.target.value;
      this._renderBinaryList();
    });

    // Device
    panel.querySelector('#pkg-binary-device')?.addEventListener('change', (e) => {
      bin.device = e.target.value;
      this._renderBinaryDetail();
      this._renderBinaryList();
    });

    // Patch CS Pin
    panel.querySelector('#btn-pkg-patch-cspin')?.addEventListener('click', async () => {
      if (!bin.hexRaw || !bin.detectedDevice) return;
      const ok = await showConfirm(
        'The CS pin patch is experimental and could theoretically produce false positives. '
        + 'The hex binary will be modified in-place to target the selected device.\n\n'
        + 'Patch from ' + bin.detectedDevice + ' \u2192 ' + bin.device + '?',
        { title: 'Experimental: Patch CS Pin', okLabel: 'Patch', danger: true }
      );
      if (!ok) return;
      try {
        const parsed = parseIntelHex(bin.hexRaw);
        const result = patchCSPin(parsed.data, bin.detectedDevice, bin.device);
        if (result.success) {
          bin.hexRaw = generateIntelHex(parsed.data);
          bin.detectedDevice = _detectDeviceFromHex(bin.hexRaw);
          showToast(result.message, 'success');
        } else {
          showToast(result.message || 'Patch failed.', 'warning');
        }
      } catch (err) {
        showToast('Patch error: ' + err.message, 'error');
      }
      this._renderBinaryDetail();
      this._renderBinaryList();
    });

    // Cart image — draw canvas
    const canvas = panel.querySelector('#pkg-binary-canvas');
    if (canvas) this._drawThumbnail(canvas, bin.imageRaw);

    // Import image
    panel.querySelector('#btn-pkg-binary-image')?.addEventListener('click', () => {
      panel.querySelector('#pkg-binary-image-file')?.click();
    });
    panel.querySelector('#pkg-binary-image-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        bin.imageRaw = _imageBitmapToRaw(bitmap);
        // Generate 1-bit-quantized PNG blob for .arduboy saving
        const imgData = screenToImageData(bin.imageRaw);
        const offscreen = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
        offscreen.getContext('2d').putImageData(imgData, 0, 0);
        if (bin.cartImageUrl) URL.revokeObjectURL(bin.cartImageUrl);
        bin.cartImageBlob = await offscreen.convertToBlob({ type: 'image/png' });
        bin.cartImageUrl = null;
        bin.cartImage = null;
        bin.cartImageFilename = (bin.title || 'cart').replace(/[^a-zA-Z0-9_-]/g, '_') + '_cartimage.png';
        bin._originalImageRaw = null;
        this._renderBinaryDetail();
      } catch (err) {
        showToast(`Image load failed: ${err.message}`, 'error');
      }
    });

    // Export as PNG
    panel.querySelector('#btn-pkg-binary-save-image')?.addEventListener('click', async () => {
      const hasImage = bin.imageRaw && bin.imageRaw.some((b) => b !== 0);
      if (!hasImage) {
        showToast('No image to save', 'warning');
        return;
      }
      const imgData = screenToImageData(bin.imageRaw);
      const offscreen = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
      offscreen.getContext('2d').putImageData(imgData, 0, 0);
      const blob = await offscreen.convertToBlob({ type: 'image/png' });
      const safeName = (bin.title || 'image').replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadBlob(blob, `${safeName}.png`, 'image/png');
    });

    // Pixel editor (Edit button)
    const editImageBtn = panel.querySelector('#btn-pkg-binary-edit-image');
    const revertImageBtn = panel.querySelector('#btn-pkg-binary-revert-image');
    if (revertImageBtn && bin._originalImageRaw) {
      revertImageBtn.style.display = '';
    }
    editImageBtn?.addEventListener('click', () => {
      if (!window.__pixelEditor) return;
      const hasImage = bin.imageRaw && bin.imageRaw.some((b) => b !== 0);
      let imgData;
      if (hasImage) {
        imgData = screenToImageData(bin.imageRaw);
      } else {
        imgData = new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        for (let i = 3; i < imgData.data.length; i += 4) imgData.data[i] = 255;
      }
      if (!bin._originalImageRaw) {
        bin._originalImageRaw = bin.imageRaw ? new Uint8Array(bin.imageRaw) : null;
      }
      window.__pixelEditor.open(imgData, {
        filename: bin.title || 'cart-image',
        threshold: 128,
        onSave: async (editedImageData) => {
          bin.imageRaw = imageDataToScreen(editedImageData);
          // Regenerate blob for .arduboy saving
          const offscreen = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
          offscreen.getContext('2d').putImageData(editedImageData, 0, 0);
          bin.cartImageBlob = await offscreen.convertToBlob({ type: 'image/png' });
          bin.cartImageFilename = (bin.title || 'cart').replace(/[^a-zA-Z0-9_-]/g, '_') + '_cartimage.png';
          this._renderBinaryDetail();
        },
      });
    });
    canvas?.addEventListener('dblclick', () => {
      editImageBtn?.click();
    });

    // Revert image
    revertImageBtn?.addEventListener('click', async () => {
      if (!bin._originalImageRaw) return;
      const ok = await showConfirm('Revert image to original?');
      if (!ok) return;
      bin.imageRaw = new Uint8Array(bin._originalImageRaw);
      bin._originalImageRaw = null;
      // Regenerate blob
      const imgData = screenToImageData(bin.imageRaw);
      const offscreen = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
      offscreen.getContext('2d').putImageData(imgData, 0, 0);
      bin.cartImageBlob = await offscreen.convertToBlob({ type: 'image/png' });
      this._renderBinaryDetail();
    });

    // Clear image
    panel.querySelector('#btn-pkg-binary-clear-image')?.addEventListener('click', () => {
      if (bin.cartImageUrl) URL.revokeObjectURL(bin.cartImageUrl);
      bin.cartImage = null;
      bin.cartImageFilename = '';
      bin.cartImageBlob = null;
      bin.cartImageUrl = null;
      bin.imageRaw = null;
      bin._originalImageRaw = null;
      this._renderBinaryDetail();
    });

    // Hex
    panel.querySelector('#btn-pkg-binary-hex')?.addEventListener('click', () => {
      panel.querySelector('#pkg-binary-hex-file')?.click();
    });
    panel.querySelector('#pkg-binary-hex-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const buffer = await readFileAsArrayBuffer(file);
      bin.hexRaw = new TextDecoder().decode(buffer);
      bin.hexFilename = file.name;
      bin.detectedDevice = _detectDeviceFromHex(bin.hexRaw);
      this._renderBinaryDetail();
      this._renderBinaryList();
    });
    panel.querySelector('#btn-pkg-binary-clear-hex')?.addEventListener('click', () => {
      bin.hexRaw = '';
      bin.hexFilename = '';
      bin.detectedDevice = null;
      this._renderBinaryDetail();
      this._renderBinaryList();
    });

    // FX Data
    panel.querySelector('#btn-pkg-binary-data')?.addEventListener('click', () => {
      panel.querySelector('#pkg-binary-data-file')?.click();
    });
    panel.querySelector('#pkg-binary-data-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const buffer = await readFileAsArrayBuffer(file);
      bin.dataRaw = new Uint8Array(buffer);
      this._renderBinaryDetail();
      this._renderBinaryList();
    });
    panel.querySelector('#btn-pkg-binary-clear-data')?.addEventListener('click', () => {
      bin.dataRaw = new Uint8Array(0);
      this._renderBinaryDetail();
      this._renderBinaryList();
    });

    // FX Save
    panel.querySelector('#btn-pkg-binary-save')?.addEventListener('click', () => {
      panel.querySelector('#pkg-binary-save-file')?.click();
    });
    panel.querySelector('#pkg-binary-save-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const buffer = await readFileAsArrayBuffer(file);
      bin.saveRaw = new Uint8Array(buffer);
      this._renderBinaryDetail();
      this._renderBinaryList();
    });
    panel.querySelector('#btn-pkg-binary-clear-save')?.addEventListener('click', () => {
      bin.saveRaw = new Uint8Array(0);
      this._renderBinaryDetail();
      this._renderBinaryList();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  _setField(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || '';
  }

  _getField(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${(bytes / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
  }

  _drawThumbnail(canvas, imageRaw) {
    const ctx = canvas.getContext('2d');
    if (!imageRaw || imageRaw.length < SCREEN_WIDTH * SCREEN_HEIGHT / 8) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const imgData = screenToImageData(imageRaw);
    if (canvas.width === SCREEN_WIDTH && canvas.height === SCREEN_HEIGHT) {
      ctx.putImageData(imgData, 0, 0);
    } else {
      const temp = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
      temp.getContext('2d').putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Persistence (localStorage)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Schedule a debounced save to localStorage. */
  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveToStorage(), STORAGE_SAVE_DELAY);
  }

  /** Serialise the current package state to localStorage. */
  _saveToStorage() {
    clearTimeout(this._saveTimer);
    try {
      const hasBinaries = this._binaries.some((b) => b.hexRaw);
      const hasMetadata = this._getField('pkg-title') || this._getField('pkg-author');
      if (!hasBinaries && !hasMetadata) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      // Read contributors from DOM
      const contributors = [];
      const rows = document.querySelectorAll('#pkg-contributors-table tbody tr');
      rows.forEach((row) => {
        const cells = row.querySelectorAll('input');
        contributors.push({
          name: cells[0]?.value || '',
          roles: cells[1]?.value || '',
          urls: cells[2]?.value || '',
        });
      });

      const data = {
        metadata: {
          title: this._getField('pkg-title'),
          version: this._getField('pkg-version'),
          author: this._getField('pkg-author'),
          description: this._getField('pkg-description'),
          genre: this._getField('pkg-genre'),
          url: this._getField('pkg-url'),
          sourceUrl: this._getField('pkg-sourceurl'),
          email: this._getField('pkg-email'),
          license: document.getElementById('pkg-license')?.value || '',
        },
        contributors,
        binaries: this._binaries.map((b) => ({
          title: b.title,
          device: b.device,
          hexRaw: b.hexRaw,
          hexFilename: b.hexFilename,
          dataRaw: _u8ToBase64(b.dataRaw),
          saveRaw: _u8ToBase64(b.saveRaw),
          imageRaw: _u8ToBase64(b.imageRaw),
          cartImageFilename: b.cartImageFilename,
        })),
        selectedBinary: this._selectedBinary,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or other error — silently ignore
    }
  }

  /**
   * Restore package state from localStorage on startup.
   * @returns {boolean} true if state was restored
   */
  _restoreFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data?.metadata) return false;

      // Restore metadata fields
      const m = data.metadata;
      this._setField('pkg-title', m.title);
      this._setField('pkg-version', m.version);
      this._setField('pkg-author', m.author);
      this._setField('pkg-description', m.description);
      this._setField('pkg-genre', m.genre);
      this._setField('pkg-url', m.url);
      this._setField('pkg-sourceurl', m.sourceUrl);
      this._setField('pkg-email', m.email);
      const licenseEl = document.getElementById('pkg-license');
      if (licenseEl) licenseEl.value = m.license || '';

      // Restore contributors
      const tbody = document.querySelector('#pkg-contributors-table tbody');
      if (tbody) tbody.innerHTML = '';
      if (Array.isArray(data.contributors)) {
        for (const c of data.contributors) {
          this._addContributorRow(c.name || '', c.roles || '', c.urls || '');
        }
      }

      // Restore binaries
      this._binaries = [];
      this._selectedBinary = -1;
      if (Array.isArray(data.binaries)) {
        for (const b of data.binaries) {
          const imageRaw = _base64ToU8(b.imageRaw);
          this._binaries.push({
            title: b.title || '',
            device: b.device || 'Arduboy',
            detectedDevice: _detectDeviceFromHex(b.hexRaw),
            hexRaw: b.hexRaw || '',
            hexFilename: b.hexFilename || '',
            dataRaw: _base64ToU8(b.dataRaw),
            saveRaw: _base64ToU8(b.saveRaw),
            cartImage: null,
            cartImageFilename: b.cartImageFilename || '',
            cartImageBlob: null,
            cartImageUrl: null,
            imageRaw,
            _originalImageRaw: null,
          });
        }
      }
      if (this._binaries.length === 0) return false;
      this._selectedBinary = typeof data.selectedBinary === 'number'
        ? Math.min(data.selectedBinary, this._binaries.length - 1)
        : 0;
      return true;
    } catch {
      // Corrupted data — ignore and start fresh
      return false;
    }
  }

  /**
   * Check whether the package editor has any meaningful data entered.
   * Used to warn before overwriting with a Push from Sketch Manager.
   * @returns {boolean}
   */
  hasData() {
    const title = this._getField('pkg-title');
    const author = this._getField('pkg-author');
    if (title || author) return true;
    // Check if any binary has a hex file loaded
    return this._binaries.some((b) => b.hexRaw);
  }

  /**
   * Load an ArduboyPackage into the editor, replacing current state.
   * @param {ArduboyPackage} pkg
   */
  loadFromPackage(pkg) {
    this._fillFromPackage(pkg);
  }

  /**
   * Build and return the current package data.
   * Throws if required fields are missing.
   * @returns {ArduboyPackage}
   */
  buildPackage() {
    return this._buildPackage();
  }

  /** Index of the currently selected binary in the binaries list (-1 if none). */
  get selectedBinaryIndex() {
    return this._selectedBinary;
  }
}
