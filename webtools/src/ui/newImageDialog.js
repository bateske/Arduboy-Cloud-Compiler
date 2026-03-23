/**
 * Dialog for creating a new blank image.
 * Returns { filename, width, height, pngBytes } or null on cancel.
 */

const DIALOG_HTML = `
<div class="new-image-dialog-overlay hidden">
  <div class="new-image-dialog">
    <h3>New Image</h3>
    <div class="new-image-field">
      <label>Name</label>
      <input type="text" class="new-image-input new-image-name" placeholder="sprite" spellcheck="false" autocomplete="off">
    </div>
    <div class="new-image-dims-row">
      <div class="new-image-field">
        <label>Width</label>
        <input type="number" class="new-image-input new-image-w" min="1" max="2048" value="16">
      </div>
      <span class="new-image-x">\u00D7</span>
      <div class="new-image-field">
        <label>Height</label>
        <input type="number" class="new-image-input new-image-h" min="1" max="2048" value="16">
      </div>
    </div>
    <div class="new-image-error hidden"></div>
    <div class="new-image-actions">
      <button class="btn btn-primary new-image-ok">Create</button>
      <button class="btn btn-secondary new-image-cancel">Cancel</button>
    </div>
  </div>
</div>`;

let overlayEl = null;

function ensureDOM() {
  if (overlayEl) return overlayEl;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = DIALOG_HTML.trim();
  overlayEl = wrapper.firstChild;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

/**
 * Generate a black PNG file as Uint8Array for the given dimensions.
 */
export async function createBlankPNG(width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Show a dialog prompting for filename and dimensions.
 * @param {Object} [opts]
 * @param {string} [opts.defaultName] - Pre-filled filename
 * @param {number} [opts.defaultWidth] - Pre-filled width (default 16)
 * @param {number} [opts.defaultHeight] - Pre-filled height (default 16)
 * @returns {Promise<{filename:string, width:number, height:number, pngBytes:Uint8Array}|null>}
 */
export function showNewImageDialog(opts = {}) {
  const overlay = ensureDOM();
  const nameInput = overlay.querySelector('.new-image-name');
  const wInput = overlay.querySelector('.new-image-w');
  const hInput = overlay.querySelector('.new-image-h');
  const errorEl = overlay.querySelector('.new-image-error');
  const okBtn = overlay.querySelector('.new-image-ok');
  const cancelBtn = overlay.querySelector('.new-image-cancel');

  nameInput.value = opts.defaultName || '';
  wInput.value = opts.defaultWidth || 16;
  hInput.value = opts.defaultHeight || 16;
  errorEl.textContent = '';
  errorEl.classList.add('hidden');

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  nameInput.focus();
  nameInput.select();

  return new Promise((resolve) => {
    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    async function submit() {
      const filename = nameInput.value.trim();
      const w = parseInt(wInput.value, 10);
      const h = parseInt(hInput.value, 10);

      if (!filename) { showError('Name is required.'); nameInput.focus(); return; }
      if (!w || w < 1 || w > 2048) { showError('Width must be 1\u20132048.'); wInput.focus(); return; }
      if (!h || h < 1 || h > 2048) { showError('Height must be 1\u20132048.'); hInput.focus(); return; }

      // Ensure .png extension
      const finalName = /\.png$/i.test(filename) ? filename : filename + '.png';

      const pngBytes = await createBlankPNG(w, h);
      close({ filename: finalName, width: w, height: h, pngBytes });
    }

    function close(result) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.classList.add('hidden'), 200);
      cleanup();
      resolve(result || null);
    }

    function onKey(e) {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') submit();
    }

    function onCancel() {
      close(null);
    }

    function onBackdrop(e) {
      if (e.target === overlay) close(null);
    }

    function cleanup() {
      okBtn.removeEventListener('click', submit);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    }

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}
