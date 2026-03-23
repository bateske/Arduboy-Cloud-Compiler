/**
 * Arduboy Web Tools — Application entry point.
 *
 * Wires up the UI shell: tab switching, file inputs, device connection,
 * action buttons, and progress overlay.
 */

// Styles are loaded via <link> tags in index.html

// UI helpers
import { TabController } from './ui/tabs.js';
import { ProgressController } from './ui/progress.js';
import { showToast } from './ui/toast.js';
import { showConfirm } from './ui/modal.js';
import { readFileAsArrayBuffer, readFileAsText, downloadBlob, wireFileInput } from './ui/files.js';
import { CartEditor } from './ui/cartEditor.js';
import { PackageEditor } from './ui/packageEditor.js';
import { ImageConverter } from './ui/imageConverter.js';
import { MusicEditor } from './ui/musicEditor.js';
import { FxDataEditor, entriesToSource, sourceToEntries } from './ui/fxdataEditor.js';
import { PixelEditor } from './ui/pixelEditor.js';
import { WelcomePage } from './ui/welcomePage.js';
import { CloudBuddy } from './ui/cloudBuddy.js';
import { showNewImageDialog, createBlankPNG } from './ui/newImageDialog.js';
import { openSerialModal, recordPort } from './ui/serialModal.js';

// FX data core logic (exposed to app.js via window.__fxBridge)
import { FxDataProject } from './core/fxdata/fxdataProject.js';
import { buildFxData } from './core/fxdata/fxdataBuild.js';
import { encodeFxImage, loadImageFromBytes, parseDimensionsFromFilename } from './core/fxdata/fxdataImageEncoder.js';

// Core library
import {
  USB_FILTERS,
  isBootloaderFilter,
  FX_BLOCKSIZE, FX_PAGESIZE, FX_MAX_PAGES,
  SerialTransport,
  ArduboyProtocol,
  DeviceManager,
  parseIntelHex,
  readArduboyFile,
  uploadSketch,
  backupSketch,
  generateIntelHex,
  eraseSketch,
  writeFx,
  writeFxDev,
  backupFx,
  scanFx,
  readEeprom,
  writeEeprom,
  eraseEeprom,
  patchSSD1309,
  unpatchSSD1309,
  patchCSPin,
  detectDeviceFromProgram,
  detectSSD1309Patch,
  DEVICE_TYPE,
  parseFxCart,
  padData,
  concat,
  scanFxCartHeaders,
} from './core/index.js';

// ---------------------------------------------------------------------------
// Feature detect
// ---------------------------------------------------------------------------

const webSerialSupported = 'serial' in navigator;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------------------------
// Easter egg — brand icon shuffles the background gradient
// ---------------------------------------------------------------------------

(function wireBrandIconEasterEgg() {
  // Original colour palette: same hues/saturations/lightness/alphas as the CSS,
  // just re-distributed randomly on each click.
  const palette = [
    { h: 265, s: 70, l: 60, a: 0.55 },
    { h: 175, s: 75, l: 45, a: 0.50 },
    { h: 230, s: 60, l: 50, a: 0.45 },
    { h: 280, s: 65, l: 55, a: 0.45 },
    { h: 190, s: 70, l: 45, a: 0.40 },
    { h: 250, s: 65, l: 55, a: 0.45 },
    { h: 270, s: 75, l: 60, a: 0.50 },
  ];

  const BG_STORAGE_KEY = 'bgGradientCSS';

  function applyGradientCSS(css) {
    let tag = document.getElementById('bg-easter-egg-style');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'bg-easter-egg-style';
      document.head.appendChild(tag);
    }
    tag.textContent = css;
  }

  function randomizeBg() {
    // Fisher-Yates shuffle of a copy so we don't mutate the palette
    const colors = palette.slice();
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colors[i], colors[j]] = [colors[j], colors[i]];
    }

    const gradients = colors.map(({ h, s, l, a }) => {
      const x = Math.round(Math.random() * 100);
      const y = Math.round(Math.random() * 100);
      const spread = Math.round(40 + Math.random() * 20); // 40–60 %
      return `radial-gradient(at ${x}% ${y}%, hsla(${h}, ${s}%, ${l}%, ${a}) 0px, transparent ${spread}%)`;
    });

    const css = `body::before { background-image: ${gradients.join(',\n')}; }`;
    applyGradientCSS(css);
    localStorage.setItem(BG_STORAGE_KEY, css);
  }

  document.querySelector('.brand-icon')?.addEventListener('click', randomizeBg);
})();

// ---------------------------------------------------------------------------
// Tab Controller
// ---------------------------------------------------------------------------

const tabs = new TabController(
  $$('.tab-btn'),
  $$('.panel'),
  'active',
  'panel',
  'activeMainTab',
);

// Wire the "Arduboy Cloud" brand as a clickable tab for the welcome page
const brandEl = $('.navbar-brand.brand-clickable');
const welcomePage = new WelcomePage();
const cloudBuddy = new CloudBuddy();

if (brandEl) {
  brandEl.addEventListener('click', () => {
    tabs.activate('welcome');
    brandEl.classList.add('active');
    welcomePage.show();
  });
  // Also support keyboard activation
  brandEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      brandEl.click();
    }
  });
}

// Patch tab activation to sync brand active state and welcome page lifecycle
const _origActivate = tabs.activate.bind(tabs);
tabs.activate = function(name) {
  _origActivate(name);
  if (brandEl) brandEl.classList.toggle('active', name === 'welcome');
  if (name === 'welcome') { welcomePage.show(); cloudBuddy.start(); }
  else { welcomePage.hide(); cloudBuddy.stop(); }
};

// Activate saved tab or default
tabs.activate(localStorage.getItem('activeMainTab') || 'welcome');

if (!webSerialSupported) {
  showToast('Use Chrome or Edge desktop for full functionality.', 'warning', 8000);
  showToast('Device features (upload, backup, etc.) are unavailable.', 'warning', 8000);
  showToast('Your browser does not support Web Serial', 'warning', 8000);
}

// ---------------------------------------------------------------------------
// Progress Controller
// ---------------------------------------------------------------------------

const progress = new ProgressController(
  $('#progress-overlay'),
  $('#progress-bar'),
  $('#progress-status'),
  $('#progress-percent'),
  $('#progress-title'),
);

// ---------------------------------------------------------------------------
// Device Manager
// ---------------------------------------------------------------------------

const device = new DeviceManager();

/** @type {ArduboyProtocol|null} */
let protocol = null;

/** @type {'bootloader'|'sketch'|null} Current connection mode */
let connectionMode = null;

function setConnectionStatus(state, text) {
  const dot = $('.status-dot');
  const label = $('.status-text');
  const resetBtn = $('#btn-reset');
  dot.className = `status-dot ${state}`;
  label.textContent = text;
  if (resetBtn) resetBtn.disabled = !state.startsWith('connected');
}

/** @type {SerialTransport|null} */
let transport = null;

/** True while a deliberate reset is in progress — suppresses auto-connect race conditions */
let resetInProgress = false;

/**
 * Check whether a SerialPort matches one of our known Arduboy USB filters.
 * @param {SerialPort} port
 * @returns {boolean}
 */
function isArduboyPort(port) {
  const info = port.getInfo();
  if (!info.usbVendorId) return false;
  return USB_FILTERS.some(
    (f) => f.usbVendorId === info.usbVendorId && f.usbProductId === info.usbProductId
  );
}

/**
 * Core connection logic — open a known port, set up protocol & disconnect handler.
 * Does NOT show the browser port picker. Used by both manual connect and auto-connect.
 * @param {SerialPort} port - An already-granted SerialPort
 * @returns {Promise<ArduboyProtocol|null>}
 */
async function connectToPort(port) {
  if (protocol) return protocol; // already connected
  try {
    setConnectionStatus('connecting', 'Connecting...');
    transport = new SerialTransport();
    transport.setPort(port);
    await transport.open(115200);

    protocol = new ArduboyProtocol(transport);

    // Detect unexpected disconnects (USB removal, port closure)
    transport.onDisconnect = (reason) => {
      if (resetInProgress) return; // deliberate reset — don't interfere
      console.warn('Device disconnected:', reason);
      protocol = null;
      transport = null;
      connectionMode = null;
      setConnectionStatus('disconnected', 'No device');
      showToast(`Device disconnected: ${reason}`, 'warning');
    };

    // Check USB PID to determine if we're in bootloader or sketch mode
    const portInfo = port.getInfo();
    const inBootloader = portInfo ? isBootloaderFilter(portInfo) : false;

    if (inBootloader) {
      // Bootloader mode — verify with protocol identifier
      const id = await protocol.getIdentifier();
      connectionMode = 'bootloader';
      recordPort(portInfo, 'bootloader');
      setConnectionStatus('connected', 'Connected');
      showToast('Device connected — Bootloader', 'success');
    } else {
      // Sketch/application mode — no bootloader protocol available
      connectionMode = 'sketch';
      recordPort(portInfo, 'sketch');
      setConnectionStatus('connected-sketch', 'Connected');
      showToast('Device connected — Sketch', 'purple');
    }
    return protocol;
  } catch (err) {
    setConnectionStatus('disconnected', 'No device');
    if (transport) {
      try { await transport.close(); } catch { /* ignore */ }
      transport = null;
    }
    protocol = null;
    connectionMode = null;
    // Don't spam toasts for auto-connect failures — only show for real errors
    if (err.name !== 'NotFoundError' && err.name !== 'InvalidStateError') {
      console.warn('Connection failed:', err.message);
    }
    return null;
  }
}

async function connectDevice() {
  if (!webSerialSupported) {
    showToast('Web Serial is not supported in this browser. Use Chrome or Edge desktop.', 'warning');
    return null;
  }
  try {
    const port = await navigator.serial.requestPort({ filters: USB_FILTERS });
    return connectToPort(port);
  } catch (err) {
    setConnectionStatus('disconnected', 'No device');
    if (err.name !== 'NotFoundError') {
      showToast(`Connection failed: ${err.message}`, 'error');
      console.error(err);
    }
    return null;
  }
}

async function ensureDevice() {
  if (protocol && connectionMode === 'bootloader') return protocol;
  if (protocol && connectionMode === 'sketch') {
    const autoReset = localStorage.getItem('autoReset') !== 'false';
    if (!autoReset) {
      showToast('Device is in sketch mode — enable Auto Reset or press Reset first', 'warning');
      return null;
    }
    // Connected in sketch mode — need to reset into bootloader first
    await resetAndReconnect();
    if (connectionMode === 'bootloader') return protocol;
    showToast('Could not enter bootloader mode', 'error');
    return null;
  }
  return connectDevice();
}

async function disconnectDevice() {
  protocol = null;
  connectionMode = null;
  if (transport) {
    try { await transport.close(); } catch { /* ignore */ }
    transport = null;
  }
  setConnectionStatus('disconnected', 'No device');
}

// Connect on status area click
$('#connection-status').addEventListener('click', async () => {
  if (protocol) {
    await disconnectDevice();
    showToast('Disconnected', 'error');
  } else {
    await connectDevice();
  }
});

// Serial settings hamburger menu
$('#btn-serial-menu')?.addEventListener('click', () => {
  openSerialModal({
    getState: () => ({ transport, connectionMode }),
    onDisconnect: disconnectDevice,
    showToast,
  });
});

// ---------------------------------------------------------------------------
// Auto-connect: previously-paired devices reconnect without the picker
// ---------------------------------------------------------------------------

if (webSerialSupported) {
  // When a known USB device is plugged in, auto-connect if we're idle
  navigator.serial.addEventListener('connect', async (event) => {
    if (protocol || resetInProgress) return; // already connected or mid-reset
    if (localStorage.getItem('autoConnect') === 'false') return;
    const port = event.target;
    if (isArduboyPort(port)) {
      console.log('Arduboy plugged in — auto-connecting...');
      await connectToPort(port);
    }
  });

  // On page load, check for an already-plugged-in device we've paired before
  (async () => {
    if (localStorage.getItem('autoConnect') === 'false') return;
    try {
      const ports = await navigator.serial.getPorts();
      const arduboyPort = ports.find(isArduboyPort);
      if (arduboyPort) {
        console.log('Previously paired Arduboy found — auto-connecting...');
        await connectToPort(arduboyPort);
      }
    } catch (err) {
      console.warn('Auto-connect check failed:', err.message);
    }
  })();
}

// Reset button — uses the active transport's port to do a 1200-baud reset,
// then waits for the bootloader port to reappear and reconnects automatically.
$('#btn-reset')?.addEventListener('click', async () => {
  if (!transport) {
    showToast('No device connected', 'warning');
    return;
  }
  await resetAndReconnect();
});

/**
 * Perform a 1200-baud reset and reconnect to the bootloader.
 * Used by the reset button and by ensureDevice() when in sketch mode.
 */
async function resetAndReconnect() {
  if (!transport) return;

  resetInProgress = true;
  try {
    showToast('Resetting device...', 'orange');
    setConnectionStatus('connecting', 'Resetting...');

    // Tear down the current connection cleanly
    protocol = null;
    connectionMode = null;
    await transport.triggerBootloaderReset();
    transport = null;

    // If auto-connect is disabled, just reset and go offline
    if (localStorage.getItem('autoConnect') === 'false') {
      setConnectionStatus('disconnected', 'No device');
      showToast('Device reset', 'info');
      return;
    }

    // Wait for the bootloader port to appear (device re-enumerates with new PID)
    setConnectionStatus('connecting', 'Waiting for bootloader...');
    const bootloaderPort = await waitForArduboyPort();

    if (bootloaderPort) {
      // Small delay to let the port settle after enumeration
      await new Promise((r) => setTimeout(r, 200));
      await connectToPort(bootloaderPort);
    } else {
      setConnectionStatus('disconnected', 'No device');
      showToast('Bootloader timed out', 'warning');
    }
  } catch (err) {
    setConnectionStatus('disconnected', 'No device');
    transport = null;
    protocol = null;
    connectionMode = null;
    showToast(`Reset failed: ${err.message}`, 'error');
    console.error(err);
  } finally {
    resetInProgress = false;
  }
}

/**
 * Poll for a previously-paired Arduboy bootloader port to appear.
 * Used after a 1200-baud reset when the device re-enumerates with a new PID.
 * Waits for a port that specifically matches a bootloader PID, ignoring
 * any stale sketch-mode port that may linger briefly after the reset.
 * @param {number} timeoutMs - Maximum time to wait
 * @returns {Promise<SerialPort|null>}
 */
async function waitForArduboyPort(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ports = await navigator.serial.getPorts();
      const match = ports.find((p) => {
        const info = p.getInfo();
        return info.usbVendorId && isBootloaderFilter(info);
      });
      if (match) return match;
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selected files cache
// ---------------------------------------------------------------------------

/** @type {Record<string, File>} */
const selectedFiles = {};

function onFileSelected(key) {
  return (file) => { selectedFiles[key] = file; };
}

// Wire file inputs
const sketchInput = $('#sketch-file');
const fxInput = $('#fx-file');
const eepromInput = $('#eeprom-file');

// .arduboy metadata state for sketch panel (wired to package editor later)
let _sketchArduboyPkg = null;

const _linkSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 8.5a3 3 0 004.2.4l2-2a3 3 0 00-4.2-4.3l-1.1 1.1"/><path d="M9.5 7.5a3 3 0 00-4.2-.4l-2 2a3 3 0 004.2 4.3l1.1-1.1"/></svg>`;
const _codeSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4.5 11.5 1.5 8 4.5 4.5"/><polyline points="11.5 4.5 14.5 8 11.5 11.5"/><line x1="10" y1="2.5" x2="6" y2="13.5"/></svg>`;

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showSketchArduboyMeta(pkg, bin) {
  const card = $('#sketch-arduboy-meta');
  if (!card) return;

  // Skip if the .arduboy file has no meaningful metadata
  const hasMeta = pkg.title || pkg.author || pkg.description || pkg.genre || pkg.url || pkg.sourceUrl || bin?.cartImageBlob;
  if (!hasMeta) {
    card.classList.add('hidden');
    return;
  }

  const titleEl = $('#sketch-meta-title');
  const versionEl = $('#sketch-meta-version');
  if (titleEl) titleEl.textContent = pkg.title || '(untitled)';
  if (versionEl) versionEl.textContent = pkg.version ? `v${pkg.version}` : '';

  const authorEl = $('#sketch-meta-author');
  if (authorEl) authorEl.textContent = pkg.author || '—';

  const genreEl = $('#sketch-meta-genre');
  const genreRow = $('#sketch-meta-genre-row');
  if (genreEl) genreEl.textContent = pkg.genre || '';
  if (genreRow) genreRow.classList.toggle('hidden', !pkg.genre);

  const descEl = $('#sketch-meta-desc');
  const descRow = $('#sketch-meta-desc-row');
  if (descEl) descEl.textContent = pkg.description || '';
  if (descRow) descRow.classList.toggle('hidden', !pkg.description);

  const imgEl = $('#sketch-meta-img');
  const imgWrap = card.querySelector('.sketch-meta-image-wrap');
  if (imgEl && bin?.cartImageBlob) {
    imgEl.src = URL.createObjectURL(bin.cartImageBlob);
    if (imgWrap) imgWrap.style.display = '';
  } else {
    if (imgEl) imgEl.src = '';
    if (imgWrap) imgWrap.style.display = 'none';
  }

  const linksEl = $('#sketch-meta-links');
  if (linksEl) {
    let linksHtml = '';
    if (pkg.url) {
      linksHtml += `<a href="${escHtml(pkg.url)}" target="_blank" rel="noopener" title="${escHtml(pkg.url)}">${_linkSvg} URL</a>`;
    }
    if (pkg.sourceUrl) {
      linksHtml += `<a href="${escHtml(pkg.sourceUrl)}" target="_blank" rel="noopener" title="${escHtml(pkg.sourceUrl)}">${_codeSvg} Source</a>`;
    }
    linksEl.innerHTML = linksHtml;
  }

  card.classList.remove('hidden');
  // Show the push button in the upload controls row
  $('#btn-sketch-push-pkg')?.classList.remove('hidden');
}

if (sketchInput) {
  sketchInput.addEventListener('change', async () => {
    const file = sketchInput.files?.[0];
    if (file) {
      selectedFiles['sketch'] = file;
      const label = $('label[for="sketch-file"]');
      if (label) { label.textContent = file.name; label.classList.add('has-file'); }
      // Show upload controls when file is selected
      const controls = $('#sketch-upload-controls');
      if (controls) { controls.classList.remove('hidden'); }

      // Hide metadata card and push button for non-.arduboy files
      if (!file.name.endsWith('.arduboy')) {
        $('#sketch-arduboy-meta')?.classList.add('hidden');
        $('#btn-sketch-push-pkg')?.classList.add('hidden');
        _sketchArduboyPkg = null;
      }

      // Detect device and display type, populate dropdowns
      try {
        const buffer = await readFileAsArrayBuffer(file);
        const data = new Uint8Array(buffer);
        let programData;

        if (file.name.endsWith('.arduboy')) {
          const pkg = await readArduboyFile(data, file.name);
          const bin = pkg.binaries?.[0];
          if (bin?.hexRaw) {
            const parsed = parseIntelHex(bin.hexRaw);
            programData = parsed.data;
          }
          // Populate .arduboy metadata card
          _sketchArduboyPkg = pkg;
          showSketchArduboyMeta(pkg, bin);
        } else if (file.name.endsWith('.hex')) {
          const text = new TextDecoder().decode(data);
          const parsed = parseIntelHex(text);
          programData = parsed.data;
        } else {
          programData = data; // raw .bin
        }

        if (programData && programData.length > 0) {
          // Detect device target
          const detected = detectDeviceFromProgram(programData);
          const targetSel = $('#sketch-target-device');
          if (targetSel && detected && detected !== DEVICE_TYPE.ARDUBOY) {
            targetSel.value = detected;
            // Store original detected value for patch warning
            targetSel.dataset.detected = detected;
          }
          // Detect display type
          const has1309 = detectSSD1309Patch(programData);
          const displaySel = $('#sketch-display-type');
          if (displaySel) {
            displaySel.value = has1309 ? 'SSD1309' : 'SSD1306';
            displaySel.dataset.detected = has1309 ? 'SSD1309' : 'SSD1306';
          }
          // Show patch settings
          $('#sketch-patch-settings')?.classList.remove('hidden');
        }
      } catch {
        // Detection failed — leave dropdowns at defaults, still show them
        $('#sketch-patch-settings')?.classList.remove('hidden');
      }
    }
  });
}

if (fxInput) {
  fxInput.addEventListener('change', async () => {
    const file = fxInput.files?.[0];
    if (file) {
      selectedFiles['fx'] = file;
      const label = $('label[for="fx-file"]');
      if (label) { label.textContent = file.name; label.classList.add('has-file'); }

      // Show write controls when file is selected
      const controls = $('#fx-write-controls');
      if (controls) { controls.classList.remove('hidden'); }

      // Scan the .bin file locally and show cart info
      try {
        const buffer = await readFileAsArrayBuffer(file);
        const data = new Uint8Array(buffer);
        const info = scanFxCartHeaders(data);

        if (info.count > 0) {
          $('#file-scan-slots').textContent = info.count;
          $('#file-scan-games').textContent = info.games;
          $('#file-scan-categories').textContent = info.categories;
          $('#file-scan-pages').textContent = info.totalPages.toLocaleString();
          const sizeKB = data.length / 1024;
          $('#file-scan-size').textContent = sizeKB >= 1024
            ? `${(sizeKB / 1024).toFixed(1)} MB`
            : `${sizeKB.toFixed(0)} KB`;
          $('#fx-file-info')?.classList.remove('hidden');
          // Show "Push to Cart Editor" button for valid carts
          $('#btn-fx-push-cart')?.classList.remove('hidden');
          // Valid cart — uncheck dev data option
          const devCheckbox = $('#fx-dev-data');
          if (devCheckbox) devCheckbox.checked = false;

          // Detect device targets and display types across all game slots
          try {
            const slots = parseFxCart(data);
            const deviceCounts = {};
            let has1309 = false;
            let has1306 = false;
            let fxGameCount = 0;
            for (const slot of slots) {
              if (slot.isCategory || !slot.programRaw || slot.programRaw.length === 0) continue;
              if (slot.dataRaw && slot.dataRaw.length > 0) fxGameCount++;
              const dev = detectDeviceFromProgram(slot.programRaw);
              if (dev && dev !== DEVICE_TYPE.ARDUBOY) {
                deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
              }
              if (detectSSD1309Patch(slot.programRaw)) has1309 = true;
              else has1306 = true;
            }

            // Find majority device
            let bestDevice = null;
            let bestCount = 0;
            for (const [dev, count] of Object.entries(deviceCounts)) {
              if (count > bestCount) { bestDevice = dev; bestCount = count; }
            }

            // Check for mixed cart (multiple different device types among FX games)
            const uniqueDevices = Object.keys(deviceCounts);
            // Normalize: FX-C and Mini are the same CS pin
            const normalizedUnique = new Set(uniqueDevices.map(d => d === 'ArduboyFXC' ? 'ArduboyMini' : d));
            if (normalizedUnique.size > 1) {
              showToast('Warning: This cart contains games compiled for different hardware targets', 'warning');
            }

            // Populate detection summary
            const DEVICE_LABELS = { ArduboyFX: 'Arduboy FX', ArduboyFXC: 'Arduboy FX-C', ArduboyMini: 'Arduboy Mini' };
            const detEl = $('#file-scan-detection');
            if (detEl) detEl.classList.remove('hidden');
            const fxGamesEl = $('#file-scan-fx-games');
            if (fxGamesEl) fxGamesEl.textContent = fxGameCount;
            const targetEl = $('#file-scan-target');
            if (targetEl) targetEl.textContent = bestDevice ? (DEVICE_LABELS[bestDevice] || bestDevice) : '—';
            const displayEl = $('#file-scan-display');
            if (displayEl) displayEl.textContent = has1309 && !has1306 ? 'SSD1309' : has1309 ? 'Mixed' : 'SSD1306';

            // Populate dropdowns
            const targetSel = $('#fx-target-device');
            if (targetSel && bestDevice) {
              targetSel.value = bestDevice;
              targetSel.dataset.detected = bestDevice;
            }
            const displaySel = $('#fx-display-type');
            if (displaySel) {
              const detDisplay = has1309 && !has1306 ? 'SSD1309' : 'SSD1306';
              displaySel.value = detDisplay;
              displaySel.dataset.detected = detDisplay;
            }
            // Show patch settings
            $('#fx-patch-settings')?.classList.remove('hidden');
          } catch {
            // Slot parsing failed — still show patch settings with defaults
            $('#fx-patch-settings')?.classList.remove('hidden');
          }
        } else {
          // Not a valid FX cart — treat as raw FX development data
          $('#fx-file-info')?.classList.add('hidden');
          $('#btn-fx-push-cart')?.classList.add('hidden');
          $('#fx-patch-settings')?.classList.add('hidden');
          const devCheckbox = $('#fx-dev-data');
          if (devCheckbox) devCheckbox.checked = true;
          showToast('File is not an FX cart image — selected "Flash as dev data"', 'info');
        }
      } catch {
        // Scan threw — not a valid cart, treat as dev data
        $('#fx-file-info')?.classList.add('hidden');
        $('#btn-fx-push-cart')?.classList.add('hidden');
        $('#fx-patch-settings')?.classList.add('hidden');
        const devCheckbox = $('#fx-dev-data');
        if (devCheckbox) devCheckbox.checked = true;
        showToast('File is not an FX cart image — selected "Flash as dev data"', 'info');
      }
    }
  });
}

if (eepromInput) {
  eepromInput.addEventListener('change', () => {
    const file = eepromInput.files?.[0];
    if (file) {
      selectedFiles['eeprom'] = file;
      const label = $('label[for="eeprom-file"]');
      if (label) { label.textContent = file.name; label.classList.add('has-file'); }
      // Show restore button when file is selected
      const btn = $('#btn-eeprom-restore');
      if (btn) { btn.classList.remove('hidden'); btn.style.display = ''; }
    }
  });
}

// ---------------------------------------------------------------------------
// Sketch actions
// ---------------------------------------------------------------------------

/**
 * Apply CS pin and display patches to a program binary based on dropdown settings.
 * @param {Uint8Array} programData - Program binary (modified in-place)
 * @param {string|null} detectedDevice - Original detected device (null = no CS patch needed)
 * @param {string} targetDevice - Target device from dropdown
 * @param {string} displayType - Target display type from dropdown
 * @param {string} detectedDisplay - Detected display type
 */
function applySketchPatches(programData, detectedDevice, targetDevice, displayType, detectedDisplay) {
  // CS pin patch
  if (detectedDevice) {
    const result = patchCSPin(programData, detectedDevice, targetDevice);
    if (result.success) {
      showToast(result.message, 'info');
    } else if (result.count === 0 && result.message) {
      showToast(result.message, 'warning');
    }
  }
  // Display patch
  if (displayType !== detectedDisplay) {
    if (displayType === 'SSD1309') {
      const result = patchSSD1309(programData);
      if (result.success) showToast(result.message, 'info');
    } else {
      const result = unpatchSSD1309(programData);
      if (result.success) showToast(result.message, 'info');
    }
  }
}

async function handleSketchUpload() {
  const file = selectedFiles['sketch'];
  if (!file) { showToast('Select a .hex or .arduboy file first', 'warning'); return; }

  // Read patch settings from dropdowns
  const targetSel = $('#sketch-target-device');
  const displaySel = $('#sketch-display-type');
  const targetDevice = targetSel?.value || 'ArduboyFXC';
  const displayType = displaySel?.value || 'SSD1306';
  const detectedDevice = targetSel?.dataset.detected || null;
  const detectedDisplay = displaySel?.dataset.detected || 'SSD1306';

  // Normalize FX-C and Mini to same CS pin group
  const normTarget = targetDevice === 'ArduboyFXC' ? 'ArduboyMini' : targetDevice;
  const normDetected = detectedDevice === 'ArduboyFXC' ? 'ArduboyMini' : detectedDevice;
  const needsCsPatch = detectedDevice && normDetected !== normTarget;
  const needsDisplayPatch = displayType !== detectedDisplay;

  // Warn about experimental CS pin patch
  if (needsCsPatch) {
    const ok = await showConfirm(
      'The CS pin patch is experimental and could theoretically produce false positives if the same byte pattern appears in game data.\n\nDo you want to continue?',
      { title: 'Experimental Patch', okLabel: 'Continue', danger: true }
    );
    if (!ok) return;
  }

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Uploading');
    const buffer = await readFileAsArrayBuffer(file);
    const data = new Uint8Array(buffer);
    const verify = $('#sketch-verify')?.checked ?? true;
    const onProgress = (frac) => progress.update(frac * 100);

    if (file.name.endsWith('.arduboy')) {
      // ---- .arduboy file: extract hex + FX data from ZIP, flash both ----
      await handleArduboyUpload(proto, data, file.name, verify, needsCsPatch ? detectedDevice : null, targetDevice, displayType, detectedDisplay, onProgress);
    } else if (file.name.endsWith('.hex')) {
      // ---- Plain .hex file ----
      const text = new TextDecoder().decode(data);
      const parsed = parseIntelHex(text);
      applySketchPatches(parsed.data, needsCsPatch ? detectedDevice : null, targetDevice, displayType, detectedDisplay);
      const result = await uploadSketch(proto, parsed.data, { verify, onProgress });
      await progress.finish();
      showToast(result.success ? result.message : result.message, result.success ? 'success' : 'error');
      if (result.success) await disconnectDevice();
      return;
    } else {
      // ---- Raw .bin treated as sketch binary ----
      const patched = new Uint8Array(data);
      applySketchPatches(patched, needsCsPatch ? detectedDevice : null, targetDevice, displayType, detectedDisplay);
      const result = await uploadSketch(proto, patched, { verify, onProgress });
      await progress.finish();
      showToast(result.success ? result.message : result.message, result.success ? 'success' : 'error');
      if (result.success) await disconnectDevice();
      return;
    }
  } catch (err) {
    progress.hide();
    showToast(`Upload failed: ${err.message}`, 'error');
    console.error(err);
  }
}

/**
 * Handle .arduboy file upload:
 * 1. Extract hex, FX data, FX save from the ZIP
 * 2. If FX data exists, pad and write it to the end of the external flash
 * 3. Flash the hex to internal flash
 *
 * Mirrors the ArduboyWebFlasher's loadFile() + flashArduboy() flow.
 */
async function handleArduboyUpload(proto, data, filename, verify, detectedDevice, targetDevice, displayType, detectedDisplay, onProgress) {
  progress.update(0, 'Extracting .arduboy package...');

  const pkg = await readArduboyFile(data, filename);
  if (!pkg.binaries || pkg.binaries.length === 0) {
    progress.hide();
    showToast('No binaries found in .arduboy file', 'error');
    return;
  }

  const bin = pkg.binaries[0];
  const hexRaw = bin.hexRaw;
  if (!hexRaw) {
    progress.hide();
    showToast('No hex data found in .arduboy file', 'error');
    return;
  }

  // Build combined FX dev data (data + save), same as WebFlasher's loadFile()
  let devData = null;
  if (bin.dataRaw && bin.dataRaw.length > 0) {
    let flashData = padData(bin.dataRaw, FX_PAGESIZE); // pad to 256-byte multiple
    devData = flashData;

    if (bin.saveRaw && bin.saveRaw.length > 0) {
      const saveData = padData(bin.saveRaw, 4096); // pad save to 4KB multiple
      devData = concat(flashData, saveData);
    }

    // Pad to block boundary from the front (so data aligns to end of flash)
    // Same as WebFlasher's padDataToBlockSize — prepend 0xFF padding
    const remainder = devData.length % FX_BLOCKSIZE;
    if (remainder !== 0) {
      const paddingSize = FX_BLOCKSIZE - remainder;
      const padded = new Uint8Array(paddingSize + devData.length).fill(0xFF);
      padded.set(devData, paddingSize);
      devData = padded;
    }
  }

  // Step 1: Write FX data (if present) to end of external flash
  if (devData) {
    const devBlocks = devData.length / FX_BLOCKSIZE;
    const FX_BLOCKS_TOTAL = 256; // 16MB / 64KB
    const blockStartAddr = FX_BLOCKS_TOTAL - devBlocks;

    progress.update(0, `Writing ${devBlocks} FX blocks...`);

    for (let block = 0; block < devBlocks; block++) {
      const writeBlock = blockStartAddr + block;
      const blockPage = writeBlock * (FX_BLOCKSIZE / FX_PAGESIZE);
      const blockData = devData.slice(block * FX_BLOCKSIZE, (block + 1) * FX_BLOCKSIZE);

      // Set address and write entire 64KB block (same as WebFlasher's flashBlock)
      await proto.setFxPage(blockPage);
      await proto.blockWrite(0x43, blockData); // 'C' = FX memory type

      const totalSteps = devBlocks + 10; // rough: FX blocks + hex pages placeholder
      onProgress?.((block + 1) / totalSteps);
    }
  }

  // Step 2: Flash the hex to internal flash
  progress.update(devData ? 80 : 0, 'Writing sketch...');
  const parsed = parseIntelHex(hexRaw);
  applySketchPatches(parsed.data, detectedDevice, targetDevice, displayType, detectedDisplay);
  const sketchInput = parsed.data;

  const result = await uploadSketch(proto, sketchInput, {
    verify,
    onProgress: (frac) => {
      const base = devData ? 80 : 0;
      progress.update(base + frac * (100 - base));
    },
  });

  await progress.finish();
  if (result.success) {
    showToast(`${pkg.title || filename} uploaded successfully!`, 'success');
    await disconnectDevice();
  } else {
    showToast(result.message, 'error');
  }
}

async function handleSketchBackup() {
  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Backing Up Sketch');
    const data = await backupSketch(proto, { onProgress: progress.callback() });
    progress.hide();
    const hexString = generateIntelHex(data);
    const blob = new Blob([hexString], { type: 'text/plain' });
    downloadBlob(blob, 'arduboy-sketch-backup.hex');
    showToast('Sketch backed up', 'success');
  } catch (err) {
    progress.hide();
    showToast(`Backup failed: ${err.message}`, 'error');
    console.error(err);
  }
}

async function handleSketchErase() {
  if (!await showConfirm('This will erase the game on your Arduboy. Continue?')) return;

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Erasing Sketch');
    await eraseSketch(proto, { onProgress: progress.callback() });
    progress.hide();
    showToast('Sketch erased', 'success');
  } catch (err) {
    progress.hide();
    showToast(`Erase failed: ${err.message}`, 'error');
    console.error(err);
  }
}

$('#btn-sketch-upload')?.addEventListener('click', handleSketchUpload);
$('#btn-sketch-backup')?.addEventListener('click', handleSketchBackup);
$('#btn-sketch-erase')?.addEventListener('click', handleSketchErase);

// ---------------------------------------------------------------------------
// FX actions
// ---------------------------------------------------------------------------

async function handleFxWrite() {
  const file = selectedFiles['fx'];
  if (!file) { showToast('Select a .bin flash image first', 'warning'); return; }

  const devMode = $('#fx-dev-data')?.checked ?? false;

  // Read patch settings from dropdowns
  const targetSel = $('#fx-target-device');
  const displaySel = $('#fx-display-type');
  const targetDevice = targetSel?.value || 'ArduboyFXC';
  const displayType = displaySel?.value || 'SSD1306';
  const detectedDevice = targetSel?.dataset.detected || null;
  const detectedDisplay = displaySel?.dataset.detected || 'SSD1306';

  // Normalize FX-C and Mini to same CS pin group
  const normTarget = targetDevice === 'ArduboyFXC' ? 'ArduboyMini' : targetDevice;
  const normDetected = detectedDevice === 'ArduboyFXC' ? 'ArduboyMini' : detectedDevice;
  const needsCsPatch = !devMode && detectedDevice && normDetected !== normTarget;
  const needsDisplayPatch = !devMode && displayType !== detectedDisplay;

  // Warn about experimental CS pin patch
  if (needsCsPatch) {
    const ok = await showConfirm(
      'The CS pin patch is experimental and will be applied to all games in this cart. It could theoretically produce false positives if the same byte pattern appears in game data.\n\nDo you want to continue?',
      { title: 'Experimental Patch', okLabel: 'Continue', danger: true }
    );
    if (!ok) return;
  }

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const data = new Uint8Array(buffer);
    const verify = $('#fx-verify')?.checked ?? false;

    if (devMode) {
      // Flash as development data to end of external flash
      progress.show('Writing FX Dev Data');
      const result = await writeFxDev(proto, data, null, {
        onProgress: (frac) => progress.update(frac * 100),
        onStatus: (msg) => progress.update(undefined, msg),
      });
      progress.hide();
      if (result.success) {
        showToast(`Dev data written to page ${result.dataPage}`, 'success');
      } else {
        showToast('Dev data write failed', 'error');
      }
    } else {
      // Flash as full cart image starting at page 0
      progress.show('Writing FX Flash');

      // Apply patches to all games in the cart binary
      if (needsCsPatch || needsDisplayPatch) {
        progress.update(0, 'Applying patches...');

        // CS pin patch on entire cart binary
        if (needsCsPatch) {
          const csResult = patchCSPin(data, detectedDevice, targetDevice);
          if (csResult.success) {
            showToast(csResult.message, 'info');
          }
        }

        // Display patch on entire cart binary
        if (needsDisplayPatch) {
          if (displayType === 'SSD1309') {
            const result = patchSSD1309(data);
            if (result.success) showToast(result.message, 'info');
          } else {
            const result = unpatchSSD1309(data);
            if (result.success) showToast(result.message, 'info');
          }
        }
      }

      await writeFx(proto, data, 0, {
        verify,
        onProgress: (frac) => progress.update(frac * 100),
        onStatus: (msg) => progress.update(undefined, msg),
      });
      progress.hide();
      showToast('FX Flash written successfully!', 'success');
    }
  } catch (err) {
    progress.hide();
    showToast(`FX write failed: ${err.message}`, 'error');
    console.error(err);
  }
}

async function handleFxBackup() {
  const proto = await ensureDevice();
  if (!proto) return;

  const cartOnly = $('#fx-cart-only')?.checked ?? false;

  try {
    progress.show('Backing Up FX Flash');

    // Always scan first to show cart info during download
    progress.update(0, 'Scanning cart headers...');
    const scan = await scanFx(proto, {
      onProgress: (frac) => progress.update(frac * 5, 'Scanning cart headers...'),
    });

    // Populate the scan results panel
    $('#scan-slots').textContent = scan.slotCount;
    $('#scan-games').textContent = scan.games;
    $('#scan-categories').textContent = scan.categories;
    $('#scan-pages').textContent = scan.totalPages.toLocaleString();
    const usedBytes = scan.totalPages * 256;
    const usedKB = usedBytes / 1024;
    $('#scan-size').textContent = usedKB >= 1024
      ? `${(usedKB / 1024).toFixed(1)} MB`
      : `${usedKB.toFixed(0)} KB`;
    $('#fx-scan-results')?.classList.remove('hidden');

    // Build status summary to show during download
    const cartInfo = `${scan.games} games, ${scan.categories} categories`;
    const downloadPages = cartOnly ? scan.totalPages : FX_MAX_PAGES;
    const downloadMB = (downloadPages * 256 / 1024 / 1024).toFixed(1);
    const modeLabel = cartOnly ? `cart data (${downloadMB}MB)` : `full flash (16MB)`;

    progress.update(5, `Downloading ${modeLabel} — ${cartInfo}`);

    const data = await backupFx(proto, {
      maxPages: cartOnly ? scan.totalPages : undefined,
      onProgress: (frac) => {
        const pct = 5 + frac * 95;
        progress.update(pct, `Downloading ${modeLabel} — ${cartInfo}`);
      },
      onStatus: () => {}, // we handle status ourselves
    });

    progress.hide();
    downloadBlob(data, 'arduboy-fx-backup.bin');
    showToast(`FX backup complete (${modeLabel})`, 'success');
  } catch (err) {
    progress.hide();
    showToast(`Backup failed: ${err.message}`, 'error');
    console.error(err);
  }
}

async function handleFxScan() {
  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Scanning Cart');
    const result = await scanFx(proto, {
      onProgress: (frac) => progress.update(frac * 100),
    });
    progress.hide();

    // Populate results
    $('#scan-slots').textContent = result.slotCount;
    $('#scan-games').textContent = result.games;
    $('#scan-categories').textContent = result.categories;
    $('#scan-pages').textContent = result.totalPages.toLocaleString();
    const usedBytes = result.totalPages * 256;
    const usedKB = usedBytes / 1024;
    $('#scan-size').textContent = usedKB >= 1024
      ? `${(usedKB / 1024).toFixed(1)} MB`
      : `${usedKB.toFixed(0)} KB`;

    $('#fx-scan-results')?.classList.remove('hidden');
    showToast(`Found ${result.games} games in ${result.categories} categories`, 'success');
  } catch (err) {
    progress.hide();
    showToast(`Scan failed: ${err.message}`, 'error');
    console.error(err);
  }
}

$('#btn-fx-write')?.addEventListener('click', handleFxWrite);
$('#btn-fx-backup')?.addEventListener('click', handleFxBackup);
$('#btn-fx-scan')?.addEventListener('click', handleFxScan);

// ---------------------------------------------------------------------------
// EEPROM actions
// ---------------------------------------------------------------------------

async function handleEepromRestore() {
  const file = selectedFiles['eeprom'];
  if (!file) { showToast('Select an EEPROM backup file first', 'warning'); return; }

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Restoring EEPROM');
    const buffer = await readFileAsArrayBuffer(file);
    const data = new Uint8Array(buffer);
    await writeEeprom(proto, data, { onProgress: (frac) => progress.update(frac * 100, 'Writing EEPROM...') });
    progress.hide();
    showToast('EEPROM restored!', 'success');
  } catch (err) {
    progress.hide();
    showToast(`Restore failed: ${err.message}`, 'error');
    console.error(err);
  }
}

async function handleEepromBackup() {
  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Backing Up EEPROM');
    const data = await readEeprom(proto, { onProgress: (frac) => progress.update(frac * 100, 'Reading EEPROM...') });
    progress.hide();
    downloadBlob(data, 'arduboy-eeprom-backup.eep');
    showToast('EEPROM backed up', 'success');
  } catch (err) {
    progress.hide();
    showToast(`Backup failed: ${err.message}`, 'error');
    console.error(err);
  }
}

async function handleEepromErase() {
  if (!await showConfirm('This will erase all game save data (EEPROM → 0xFF). Continue?')) return;

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Erasing EEPROM');
    await eraseEeprom(proto, { onProgress: (frac) => progress.update(frac * 100, 'Erasing EEPROM...') });
    progress.hide();
    showToast('EEPROM erased', 'success');
  } catch (err) {
    progress.hide();
    showToast(`Erase failed: ${err.message}`, 'error');
    console.error(err);
  }
}

$('#btn-eeprom-restore')?.addEventListener('click', handleEepromRestore);
$('#btn-eeprom-backup')?.addEventListener('click', handleEepromBackup);
$('#btn-eeprom-erase')?.addEventListener('click', handleEepromErase);

// ---------------------------------------------------------------------------
// Global Drag-and-Drop
// ---------------------------------------------------------------------------

// Extension → which tabs accept it and what the default is
const DROP_ROUTES = {
  '.hex':     { tabs: ['sketch', 'cart'], defaultTab: 'sketch' },
  '.arduboy': { tabs: ['sketch', 'package', 'cart'], defaultTab: 'package' },
  '.bin':     { tabs: ['fx', 'cart', 'eeprom'], defaultTab: 'fx' },
  '.eep':     { tabs: ['eeprom'], defaultTab: 'eeprom' },
  '.png':     { tabs: ['image', 'fxdata'], defaultTab: 'image' },
  '.jpg':     { tabs: ['image', 'fxdata'], defaultTab: 'image' },
  '.jpeg':    { tabs: ['image', 'fxdata'], defaultTab: 'image' },
  '.gif':     { tabs: ['image', 'fxdata'], defaultTab: 'image' },
  '.bmp':     { tabs: ['image', 'fxdata'], defaultTab: 'image' },
  '.webp':    { tabs: ['image', 'fxdata'], defaultTab: 'image' },
  '.mid':     { tabs: ['music'], defaultTab: 'music' },
  '.midi':    { tabs: ['music'], defaultTab: 'music' },
  '.txt':     { tabs: ['fxdata'], defaultTab: 'fxdata' },
  '.zip':     { tabs: ['fxdata'], defaultTab: 'fxdata' },
};

const TAB_LABELS = {
  sketch: 'Sketch Manager',
  fx: 'FX Flash',
  eeprom: 'EEPROM',
  cart: 'Cart Editor',
  image: 'Image Converter',
  package: 'Package Editor',
  music: 'Music Editor',
  fxdata: 'FX Data Editor',
};

// Build full-page drop overlay
const dropOverlay = document.createElement('div');
dropOverlay.className = 'page-drop-overlay';
const fileTypes = ['.hex', '.bin', '.arduboy', '.mid', 'Image'];
const fileTypesHTML = fileTypes.map(ext => `
  <div class="file-type-card">
    <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" class="file-svg">
      <!-- Paper body with rounded corners and clean 45-degree fold -->
      <path d="M 5,12 L 5,110 Q 5,118 12,118 L 88,118 Q 95,118 95,110 L 95,21 L 76,5 L 12,5 Q 5,5 5,12 Z" fill="rgba(139,45,180,0.12)" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
      <!-- Fold flap with minimal fill -->
      <path d="M 76,5 L 95,21 L 76,21 Z" fill="rgba(255,255,255,0.12)" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
      <!-- Extension label -->
      <text x="50" y="70" text-anchor="middle" dominant-baseline="middle" fill="white" class="file-text">${ext}</text>
    </svg>
  </div>
`).join('');
dropOverlay.innerHTML = `
  <div class="drop-overlay-border"></div>
  <div class="drop-overlay-content">
    <span class="drop-overlay-icon">&#x1F4E5;</span>
    <span class="drop-overlay-label">Drop file here</span>
    <div class="drop-overlay-file-types">
      ${fileTypesHTML}
    </div>
  </div>`;
document.getElementById('app').appendChild(dropOverlay);

// Build cart-specific drop overlay — just a backdrop + .bin hint banner.
// The real slot list and detail panel float ABOVE this and serve as their own drop targets.
const cartDropOverlay = document.createElement('div');
cartDropOverlay.className = 'cart-drop-overlay';
cartDropOverlay.innerHTML = `
  <div class="cart-drop-backdrop"></div>
  <div class="cart-drop-bin-banner">
    <span>&#x1F4BE; Drop <strong>.bin</strong> here to load entire cart</span>
  </div>`;
document.getElementById('app').appendChild(cartDropOverlay);

function resolveDropTarget(fileName) {
  const name = fileName.toLowerCase();
  for (const [ext, route] of Object.entries(DROP_ROUTES)) {
    if (name.endsWith(ext)) {
      const target = route.tabs.includes(tabs.current) ? tabs.current : route.defaultTab;
      return { ext, target };
    }
  }
  return null;
}

/** Populate a file-input label and cache the file, matching the manual-pick flow. */
function loadFileIntoInput(file, labelSel, cacheKey) {
  selectedFiles[cacheKey] = file;
  const label = $(labelSel);
  if (label) { label.textContent = file.name; label.classList.add('has-file'); }
}

async function handleDroppedFile(file, tab) {
  const name = file.name.toLowerCase();

  switch (tab) {
    case 'sketch':
      loadFileIntoInput(file, 'label[for="sketch-file"]', 'sketch');
      { const controls = $('#sketch-upload-controls'); if (controls) controls.classList.remove('hidden'); }
      // Parse .arduboy metadata and detect device/display for the info card & patch settings
      if (name.endsWith('.arduboy')) {
        try {
          const buffer = await readFileAsArrayBuffer(file);
          const data = new Uint8Array(buffer);
          const pkg = await readArduboyFile(data, file.name);
          _sketchArduboyPkg = pkg;
          showSketchArduboyMeta(pkg, pkg.binaries?.[0] || null);
          // Detect device target and display type from the first binary
          const bin = pkg.binaries?.[0];
          if (bin?.hexRaw) {
            const parsed = parseIntelHex(bin.hexRaw);
            const programData = parsed.data;
            if (programData && programData.length > 0) {
              const detected = detectDeviceFromProgram(programData);
              const targetSel = $('#sketch-target-device');
              if (targetSel && detected && detected !== DEVICE_TYPE.ARDUBOY) {
                targetSel.value = detected;
                targetSel.dataset.detected = detected;
              }
              const has1309 = detectSSD1309Patch(programData);
              const displaySel = $('#sketch-display-type');
              if (displaySel) {
                displaySel.value = has1309 ? 'SSD1309' : 'SSD1306';
                displaySel.dataset.detected = has1309 ? 'SSD1309' : 'SSD1306';
              }
              $('#sketch-patch-settings')?.classList.remove('hidden');
            }
          }
        } catch {
          $('#sketch-patch-settings')?.classList.remove('hidden');
        }
      } else {
        $('#sketch-arduboy-meta')?.classList.add('hidden');
        $('#btn-sketch-push-pkg')?.classList.add('hidden');
        _sketchArduboyPkg = null;
        // Detect device/display for plain .hex drops
        try {
          const buffer = await readFileAsArrayBuffer(file);
          const data = new Uint8Array(buffer);
          const text = new TextDecoder().decode(data);
          const parsed = parseIntelHex(text);
          if (parsed.data && parsed.data.length > 0) {
            const detected = detectDeviceFromProgram(parsed.data);
            const targetSel = $('#sketch-target-device');
            if (targetSel && detected && detected !== DEVICE_TYPE.ARDUBOY) {
              targetSel.value = detected;
              targetSel.dataset.detected = detected;
            }
            const has1309 = detectSSD1309Patch(parsed.data);
            const displaySel = $('#sketch-display-type');
            if (displaySel) {
              displaySel.value = has1309 ? 'SSD1309' : 'SSD1306';
              displaySel.dataset.detected = has1309 ? 'SSD1309' : 'SSD1306';
            }
            $('#sketch-patch-settings')?.classList.remove('hidden');
          }
        } catch {
          $('#sketch-patch-settings')?.classList.remove('hidden');
        }
      }
      showToast(`Loaded: ${file.name}`, 'info');
      break;

    case 'fx':
      loadFileIntoInput(file, 'label[for="fx-file"]', 'fx');
      { const controls = $('#fx-write-controls'); if (controls) controls.classList.remove('hidden'); }
      showToast(`Loaded: ${file.name}`, 'info');
      // Auto-scan cart info
      try {
        const buffer = await readFileAsArrayBuffer(file);
        const data = new Uint8Array(buffer);
        const info = scanFxCartHeaders(data);
        if (info.count > 0) {
          $('#file-scan-slots').textContent = info.count;
          $('#file-scan-games').textContent = info.games;
          $('#file-scan-categories').textContent = info.categories;
          $('#file-scan-pages').textContent = info.totalPages.toLocaleString();
          const sizeKB = data.length / 1024;
          $('#file-scan-size').textContent = sizeKB >= 1024
            ? `${(sizeKB / 1024).toFixed(1)} MB`
            : `${sizeKB.toFixed(0)} KB`;
          $('#fx-file-info')?.classList.remove('hidden');
          const devCheckbox = $('#fx-dev-data');
          if (devCheckbox) devCheckbox.checked = false;

          // Detect device targets and display types for dropped FX file
          try {
            const slots = parseFxCart(data);
            const deviceCounts = {};
            let has1309 = false;
            let has1306 = false;
            let fxGameCount = 0;
            for (const slot of slots) {
              if (slot.isCategory || !slot.programRaw || slot.programRaw.length === 0) continue;
              if (slot.dataRaw && slot.dataRaw.length > 0) fxGameCount++;
              const dev = detectDeviceFromProgram(slot.programRaw);
              if (dev && dev !== DEVICE_TYPE.ARDUBOY) {
                deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
              }
              if (detectSSD1309Patch(slot.programRaw)) has1309 = true;
              else has1306 = true;
            }
            let bestDevice = null;
            let bestCount = 0;
            for (const [dev, count] of Object.entries(deviceCounts)) {
              if (count > bestCount) { bestDevice = dev; bestCount = count; }
            }
            const DEVICE_LABELS = { ArduboyFX: 'Arduboy FX', ArduboyFXC: 'Arduboy FX-C', ArduboyMini: 'Arduboy Mini' };
            const detEl = $('#file-scan-detection');
            if (detEl) detEl.classList.remove('hidden');
            const fxGamesEl = $('#file-scan-fx-games');
            if (fxGamesEl) fxGamesEl.textContent = fxGameCount;
            const targetEl = $('#file-scan-target');
            if (targetEl) targetEl.textContent = bestDevice ? (DEVICE_LABELS[bestDevice] || bestDevice) : '—';
            const displayEl = $('#file-scan-display');
            if (displayEl) displayEl.textContent = has1309 && !has1306 ? 'SSD1309' : has1309 ? 'Mixed' : 'SSD1306';
          } catch {
            // Detection failed — hide detection column
            $('#file-scan-detection')?.classList.add('hidden');
          }
        } else {
          $('#fx-file-info')?.classList.add('hidden');
          const devCheckbox = $('#fx-dev-data');
          if (devCheckbox) devCheckbox.checked = true;
          showToast('File is not an FX cart image — selected "Flash as dev data"', 'info');
        }
      } catch {
        $('#fx-file-info')?.classList.add('hidden');
        const devCheckbox = $('#fx-dev-data');
        if (devCheckbox) devCheckbox.checked = true;
        showToast('File is not an FX cart image — selected "Flash as dev data"', 'info');
      }
      break;

    case 'eeprom':
      loadFileIntoInput(file, 'label[for="eeprom-file"]', 'eeprom');
      { const btn = $('#btn-eeprom-restore'); if (btn) { btn.classList.remove('hidden'); btn.style.display = ''; } }
      showToast(`Loaded: ${file.name}`, 'info');
      break;

    case 'cart':
      if (name.endsWith('.bin')) {
        await cartEditor.openBinFile(file);
      } else {
        await cartEditor.addGameFromFile(file);
      }
      break;

    case 'package':
      await packageEditor._doLoad(file);
      break;

    case 'image':
      await imageConverter.loadFile(file);
      showToast(`Loaded: ${file.name}`, 'info');
      break;

    case 'music':
      await musicEditor.loadFile(file);
      showToast(`Loaded: ${file.name}`, 'info');
      break;

    case 'fxdata':
      await fxdataEditor.handleDrop(file);
      break;
  }
}

// --- Global drag/drop listeners ---

let _pageDragCounter = 0;

// Capture phase: always clean up overlay & prevent browser default on any drop
document.addEventListener('drop', (e) => {
  if (e.target.closest('#compiler-root')) return; // let compiler handle its own drops
  e.preventDefault();
  _pageDragCounter = 0;
  dropOverlay.classList.remove('active');
  cartDropOverlay.classList.remove('active');
  cartEditor.setDragHover(false);
}, true);

// Also block default on dragover so the drop event fires
document.addEventListener('dragover', (e) => {
  if (e.target.closest('#compiler-root')) return; // let compiler handle its own drags
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}, true);

document.addEventListener('dragenter', (e) => {
  if (e.target.closest('#compiler-root')) return; // let compiler handle its own drags
  if (!e.dataTransfer?.types?.includes('Files')) return;
  _pageDragCounter++;
  if (tabs.current === 'cart') {
    cartDropOverlay.classList.add('active');
    cartEditor.setDragHover(true);
  } else {
    dropOverlay.classList.add('active');
  }
});

document.addEventListener('dragleave', () => {
  _pageDragCounter--;
  if (_pageDragCounter <= 0) {
    _pageDragCounter = 0;
    dropOverlay.classList.remove('active');
    cartDropOverlay.classList.remove('active');
    cartEditor.setDragHover(false);
  }
});

// Bubble phase: route the file (won't fire if a child called stopPropagation)
document.addEventListener('drop', async (e) => {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  const route = resolveDropTarget(file.name);
  if (!route) {
    showToast(`Unsupported file type: ${file.name}`, 'warning');
    return;
  }

  // Switch to the target tab, then handle the file
  tabs.activate(route.target);
  await handleDroppedFile(file, route.target);
});

// ---------------------------------------------------------------------------
// Cart Editor
// ---------------------------------------------------------------------------

const cartEditor = new CartEditor({
  ensureDevice,
  progress,
  disconnectDevice,
});

// ---------------------------------------------------------------------------
// Package Editor
// ---------------------------------------------------------------------------

const packageEditor = new PackageEditor();

// Wire "Push to Package Editor" button (sketch → package editor bridge)
$('#btn-sketch-push-pkg')?.addEventListener('click', async () => {
  if (!_sketchArduboyPkg) {
    showToast('No .arduboy file loaded', 'warning');
    return;
  }
  if (packageEditor.hasData()) {
    const ok = await showConfirm(
      'The Package Editor has unsaved data that will be replaced. Continue?',
      { title: 'Overwrite Package Editor', okLabel: 'Replace', danger: true }
    );
    if (!ok) return;
  }
  packageEditor.loadFromPackage(_sketchArduboyPkg);
  tabs.activate('package');
  showToast(`Loaded "${_sketchArduboyPkg.title || 'package'}" in Package Editor`, 'success');
});

// Wire compiler "Push to Package Editor" button (compiler build → package editor bridge)
document.addEventListener('compiler-push-to-package', async (e) => {
  const data = e.detail;
  if (!data || !data.hexText) return;
  if (packageEditor.hasData()) {
    const ok = await showConfirm(
      'The Package Editor has unsaved data that will be replaced. Continue?',
      { title: 'Overwrite Package Editor', okLabel: 'Replace', danger: true }
    );
    if (!ok) return;
  }
  // Build a package object matching what loadFromPackage expects
  const bin = {
    title: data.projectName || 'firmware',
    device: data.device || 'Arduboy',
    hexRaw: data.hexText,
    hexFilename: (data.projectName || 'firmware') + '.hex',
    dataRaw: data.fxData ? new Uint8Array(data.fxData) : new Uint8Array(0),
    saveRaw: data.fxSave ? new Uint8Array(data.fxSave) : new Uint8Array(0),
    cartImage: null,
    cartImageBlob: null,
    cartImageFilename: '',
  };
  const pkg = {
    title: data.projectName || 'firmware',
    version: '',
    author: '',
    description: '',
    genre: '',
    url: '',
    sourceUrl: '',
    email: '',
    license: '',
    contributors: [],
    binaries: [bin],
  };
  packageEditor.loadFromPackage(pkg);
  tabs.activate('package');
  showToast(`Loaded "${pkg.title}" in Package Editor`, 'success');
});

// Wire compiler "Upload to Arduboy" button (compiler build → device upload bridge)
document.addEventListener('compiler-upload-to-device', async (e) => {
  const data = e.detail;
  if (!data || !data.hexText) return;

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Uploading');
    const onProgress = (frac) => progress.update(frac * 100);

    if (data.hasFxData && (data.fxData || data.fxSave)) {
      // Build combined FX dev data (data + save), same as handleArduboyUpload
      let devData = null;
      if (data.fxData && data.fxData.byteLength > 0) {
        const fxDataArr = new Uint8Array(data.fxData);
        let flashData = padData(fxDataArr, FX_PAGESIZE);
        devData = flashData;

        if (data.fxSave && data.fxSave.byteLength > 0) {
          const saveData = padData(new Uint8Array(data.fxSave), 4096);
          devData = concat(flashData, saveData);
        }

        // Pad to block boundary from the front (data aligns to end of flash)
        const remainder = devData.length % FX_BLOCKSIZE;
        if (remainder !== 0) {
          const paddingSize = FX_BLOCKSIZE - remainder;
          const padded = new Uint8Array(paddingSize + devData.length).fill(0xFF);
          padded.set(devData, paddingSize);
          devData = padded;
        }
      }

      // Write FX data to end of external flash
      if (devData) {
        const devBlocks = devData.length / FX_BLOCKSIZE;
        const FX_BLOCKS_TOTAL = 256;
        const blockStartAddr = FX_BLOCKS_TOTAL - devBlocks;

        progress.update(0, `Writing ${devBlocks} FX blocks...`);

        for (let block = 0; block < devBlocks; block++) {
          const writeBlock = blockStartAddr + block;
          const blockPage = writeBlock * (FX_BLOCKSIZE / FX_PAGESIZE);
          const blockData = devData.slice(block * FX_BLOCKSIZE, (block + 1) * FX_BLOCKSIZE);

          await proto.setFxPage(blockPage);
          await proto.blockWrite(0x43, blockData);

          const totalSteps = devBlocks + 10;
          onProgress?.((block + 1) / totalSteps);
        }
      }

      // Flash the hex
      progress.update(devData ? 80 : 0, 'Writing sketch...');
      const parsed = parseIntelHex(data.hexText);
      const result = await uploadSketch(proto, parsed.data, {
        verify: true,
        onProgress: (frac) => {
          const base = devData ? 80 : 0;
          progress.update(base + frac * (100 - base));
        },
      });

      await progress.finish();
      if (result.success) {
        showToast(`${data.projectName || 'Sketch'} uploaded successfully!`, 'success');
        await disconnectDevice();
      } else {
        showToast(result.message, 'error');
      }
    } else {
      // Plain hex upload — no FX data
      const parsed = parseIntelHex(data.hexText);
      const result = await uploadSketch(proto, parsed.data, { verify: true, onProgress });
      await progress.finish();
      showToast(result.success ? `${data.projectName || 'Sketch'} uploaded successfully!` : result.message, result.success ? 'success' : 'error');
      if (result.success) await disconnectDevice();
    }
  } catch (err) {
    progress.hide();
    showToast(`Upload failed: ${err.message}`, 'error');
    console.error(err);
  }
});

// Wire "Push to Cart Editor" button (package → cart editor bridge)
$('#btn-pkg-push-cart')?.addEventListener('click', async () => {
  try {
    const pkg = packageEditor.buildPackage();
    await cartEditor.addGameFromPackage(pkg);
    tabs.activate('cart');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Wire "Push to Cart Editor" button (FX flash → cart editor bridge)
$('#btn-fx-push-cart')?.addEventListener('click', async () => {
  const file = selectedFiles['fx'];
  if (!file) {
    showToast('No .bin file loaded', 'warning');
    return;
  }
  if (cartEditor.slots.length > 0) {
    const ok = await showConfirm(
      'The Cart Editor has existing data that will be replaced. Continue?',
      { title: 'Overwrite Cart Editor', okLabel: 'Replace', danger: true }
    );
    if (!ok) return;
  }
  // Bypass the dirty-check inside openBinFile since we already confirmed
  cartEditor.dirty = false;
  await cartEditor.openBinFile(file);
  tabs.activate('cart');
});

// Wire "Upload to Device" button (package → device flash, selected binary)
$('#btn-pkg-upload')?.addEventListener('click', async () => {
  let pkg;
  try {
    pkg = packageEditor.buildPackage();
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  const idx = packageEditor.selectedBinaryIndex;
  if (idx < 0 || !pkg.binaries || idx >= pkg.binaries.length) {
    showToast('No binary selected', 'warning');
    return;
  }

  const bin = pkg.binaries[idx];
  if (!bin.hexRaw) {
    showToast('Selected binary has no .hex data', 'error');
    return;
  }

  const proto = await ensureDevice();
  if (!proto) return;

  try {
    progress.show('Uploading');

    // Build combined FX dev data (data + save)
    let devData = null;
    if (bin.dataRaw && bin.dataRaw.length > 0) {
      let flashData = padData(bin.dataRaw, FX_PAGESIZE);
      devData = flashData;

      if (bin.saveRaw && bin.saveRaw.length > 0) {
        const saveData = padData(bin.saveRaw, 4096);
        devData = concat(flashData, saveData);
      }

      const remainder = devData.length % FX_BLOCKSIZE;
      if (remainder !== 0) {
        const paddingSize = FX_BLOCKSIZE - remainder;
        const padded = new Uint8Array(paddingSize + devData.length).fill(0xFF);
        padded.set(devData, paddingSize);
        devData = padded;
      }
    }

    // Step 1: Write FX data to end of external flash
    if (devData) {
      const devBlocks = devData.length / FX_BLOCKSIZE;
      const FX_BLOCKS_TOTAL = 256; // 16MB / 64KB
      const blockStartAddr = FX_BLOCKS_TOTAL - devBlocks;

      progress.update(0, `Writing ${devBlocks} FX blocks...`);

      for (let block = 0; block < devBlocks; block++) {
        const writeBlock = blockStartAddr + block;
        const blockPage = writeBlock * (FX_BLOCKSIZE / FX_PAGESIZE);
        const blockData = devData.slice(block * FX_BLOCKSIZE, (block + 1) * FX_BLOCKSIZE);

        await proto.setFxPage(blockPage);
        await proto.blockWrite(0x43, blockData);

        const totalSteps = devBlocks + 10;
        progress.update(((block + 1) / totalSteps) * 100);
      }
    }

    // Step 2: Flash the hex as-is
    progress.update(devData ? 80 : 0, 'Writing sketch...');
    const parsed = parseIntelHex(bin.hexRaw);

    const result = await uploadSketch(proto, parsed.data, {
      verify: true,
      onProgress: (frac) => {
        const base = devData ? 80 : 0;
        progress.update(base + frac * (100 - base));
      },
    });

    await progress.finish();
    if (result.success) {
      showToast(`${bin.title || pkg.title || 'package'} uploaded successfully!`, 'success');
      await disconnectDevice();
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    progress.hide();
    showToast(`Upload failed: ${err.message}`, 'error');
    console.error(err);
  }
});

// ---------------------------------------------------------------------------
// Image Converter
// ---------------------------------------------------------------------------

const imageConverter = new ImageConverter();

// ---------------------------------------------------------------------------
// Music Editor
// ---------------------------------------------------------------------------

const musicEditor = new MusicEditor();

// ---------------------------------------------------------------------------
// FX Data Editor
// ---------------------------------------------------------------------------

const fxdataEditor = new FxDataEditor();

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

console.log('%c🎮 Arduboy Web Tools loaded', 'color: #8B2DB4; font-weight: bold; font-size: 14px;');

// ---------------------------------------------------------------------------
// Bridge: expose FX data core functions for the code editor (app.js)
// ---------------------------------------------------------------------------
window.__fxBridge = {
  FxDataProject,
  buildFxData,
  encodeFxImage,
  loadImageFromBytes,
  parseDimensionsFromFilename,
  entriesToSource,
  sourceToEntries,
};

// ---------------------------------------------------------------------------
// Pixel Editor singleton (accessible from both webtools and compiler IIFE)
// ---------------------------------------------------------------------------
window.__pixelEditor = new PixelEditor();
window.__newImageDialog = showNewImageDialog;
window.__createBlankPNG = createBlankPNG;
