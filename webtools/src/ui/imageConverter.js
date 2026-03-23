/**
 * Arduboy Image Converter — UI Controller.
 *
 * Manages the Image tab: file loading, preview rendering, conversion
 * settings, code generation, and clipboard / download actions.
 */

import {
  loadImageFileOriginal,
  convertImageFormat,
  generateUsageSnippet,
  generateFullSketch,
  OUTPUT_FORMAT,
} from '../core/index.js';
import { parseDimensionsFromFilename } from '../core/fxdata/fxdataImageEncoder.js';
import { downloadBlob } from './files.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { showNewImageDialog } from './newImageDialog.js';
import { applyExampleLinks, installExampleLinkHandler } from './exampleLinks.js';

const $ = (sel) => document.querySelector(sel);

export class ImageConverter {
  /** @type {ImageData|null} */ _imageData = null;
  /** @type {ImageData|null} */ _originalImageData = null;
  /** @type {string} */ _fileName = '';
  /** @type {Object|null} */ _lastResult = null;

  constructor() {
    this._grabRefs();
    this._bindEvents();
    this._renderThresholdPreview = this._renderThresholdPreview.bind(this);
    this._restoreFromStorage();
    installExampleLinkHandler();
  }

  // ── DOM refs ────────────────────────────────────────────────────────────

  _grabRefs() {
    this._fileInput        = $('#img-file');
    this._fileLabel        = $('label[for="img-file"]');
    this._previewSection   = $('#img-preview-section');
    this._previewCanvas    = $('#img-preview-canvas');
    this._dimensionsEl     = $('#img-dimensions');

    this._spriteSettings   = $('#img-sprite-settings');
    this._accordionToggle  = $('#img-accordion-toggle');
    this._accordionContent = $('#img-accordion-content');
    this._frameWidthInput  = $('#img-frame-width');
    this._frameHeightInput = $('#img-frame-height');
    this._spacingInput     = $('#img-spacing');
    this._frameInfo        = $('#img-frame-info');
    this._frameStrip       = $('#img-frame-strip');
    this._frameMore        = $('#img-frame-more');
    this._formatSelect     = $('#img-format');
    this._varnameInput     = $('#img-varname');
    this._thresholdSlider  = $('#img-threshold');
    this._thresholdValue   = $('#img-threshold-value');
    this._outputGroup      = $('#img-output-group');
    this._outputInfo       = $('#img-output-info');
    this._codeOutput       = $('#img-code-output');
    this._usageGroup       = $('#img-usage-group');
    this._usageOutput      = $('#img-usage-output');
    this._fullSketchCb     = $('#img-full-sketch');
    this._btnCopy          = $('#btn-img-copy');
    this._btnDownload      = $('#btn-img-download');
    this._btnCopyUsage     = $('#btn-img-copy-usage');
    this._btnCopyIcon      = $('#btn-img-copy-icon');
    this._btnCopyUsageIcon = $('#btn-img-copy-usage-icon');
    this._btnPushSketch    = $('#btn-img-push-sketch');
    this._formatWarning    = $('#img-format-warning');
    this._formatWarningText = $('#img-format-warning-text');
    this._formatSwitchLink = $('#img-format-switch-link');
    this._manualOffsetRow  = $('#img-manual-offset-row');
    this._manualOffsetCb   = $('#img-manual-offset');
    this._firstFrameNotice = $('#img-first-frame-notice');
    this._btnCopyBytes     = $('#btn-img-copy-bytes');
    this._btnPushToCode    = $('#btn-img-push-code');
    this._btnEdit          = $('#btn-img-edit');
    this._btnRevert        = $('#btn-img-revert');
    this._btnNewImage      = $('#btn-img-new');
    this._btnClose         = $('#btn-img-close');
  }

  // ── Event binding ───────────────────────────────────────────────────────

  _bindEvents() {
    // File input
    this._fileInput?.addEventListener('change', () => {
      const file = this._fileInput.files?.[0];
      if (file) this._handleFileLoaded(file);
    });

    // New blank image
    this._btnNewImage?.addEventListener('click', () => this._createNewImage());

    // Accordion toggle
    this._accordionToggle?.addEventListener('click', () => {
      this._toggleAccordion();
    });

    // Settings changes -> re-convert
    const reConvert = () => this._updateConversion();
    this._frameWidthInput?.addEventListener('input', reConvert);
    this._frameHeightInput?.addEventListener('input', reConvert);
    this._spacingInput?.addEventListener('input', reConvert);
    this._varnameInput?.addEventListener('input', reConvert);

    // Format change also updates previews (for transparency color display)
    this._formatSelect?.addEventListener('change', () => {
      this._updateConversion();
      this._renderPreview();
      this._renderThresholdPreview();

      // Warn if switching to a non-masking format with transparency present
      const format = this._formatSelect?.value;
      const supportsMasking = format === OUTPUT_FORMAT.SPRITES_EXT_MASK 
        || format === OUTPUT_FORMAT.SPRITES_PLUS_MASK;
      
      if (!supportsMasking && this._imageData && this._detectTransparency(this._imageData)) {
        showToast('This format does not support transparency. Transparency information will be omitted.', 'warning');
      }
    });

    // Threshold slider
    this._thresholdSlider?.addEventListener('input', () => {
      if (this._thresholdValue) {
        this._thresholdValue.textContent = this._thresholdSlider.value;
      }
      this._updateConversion();
      this._renderThresholdPreview();
    });

    // Full sketch toggle
    this._fullSketchCb?.addEventListener('change', () => this._updateUsageDisplay());

    // Push to Code
    this._btnPushToCode?.addEventListener('click', () => this._pushToCode());

    // Push sketch to Code
    this._btnPushSketch?.addEventListener('click', () => this._pushSketchToCode());

    // Copy code
    this._btnCopy?.addEventListener('click', () => {
      const text = this._codeOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Code copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Copy code icon
    this._btnCopyIcon?.addEventListener('click', () => {
      const text = this._codeOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Code copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Download .h
    this._btnDownload?.addEventListener('click', () => {
      const text = this._codeOutput?.textContent;
      if (!text) return;
      const name = this._sanitizeName(this._varnameInput?.value || 'image');
      const blob = new Blob([text], { type: 'text/plain' });
      downloadBlob(blob, `${name}.h`);
    });

    // Copy usage
    this._btnCopyUsage?.addEventListener('click', () => {
      const text = this._usageOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Example copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Copy usage icon
    this._btnCopyUsageIcon?.addEventListener('click', () => {
      const text = this._usageOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Example copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Format switch link (in the sprite sheet warning)
    this._formatSwitchLink?.addEventListener('click', (e) => {
      e.preventDefault();
      const target = this._formatSwitchLink.dataset.targetFormat;
      if (target && this._formatSelect) {
        this._formatSelect.value = target;
        this._updateConversion();
        this._formatSelect.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Manual pointer offset toggle
    this._manualOffsetCb?.addEventListener('change', () => this._updateConversion());

    // Preview scale dropdown
    this._scaleSelect = document.getElementById('img-preview-scale');
    this._scaleSelect?.addEventListener('change', () => this._applyPreviewScale());

    // Frame strip scale chooser
    document.querySelectorAll('input[name="img-strip-scale"]').forEach(r => {
      r.addEventListener('change', () => this._renderFrameStrip());
    });

    // Custom number spinner buttons
    document.querySelectorAll('.img-num-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;

        const currentVal = parseInt(input.value, 10) || 0;
        const step = 1;
        const min = parseInt(input.min, 10) || 0;
        const max = parseInt(input.max, 10) || Infinity;

        let newVal = currentVal;
        if (btn.classList.contains('img-num-btn-up')) {
          newVal = Math.min(currentVal + step, max);
        } else if (btn.classList.contains('img-num-btn-down')) {
          newVal = Math.max(currentVal - step, min);
        }

        input.value = newVal;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    // Copy bytes only
    this._btnCopyBytes?.addEventListener('click', () => {
      const code = this._codeOutput?.textContent;
      if (!code) return;
      const bytes = this._extractBytesOnly(code);
      navigator.clipboard.writeText(bytes).then(
        () => showToast('Bytes copied to clipboard', 'success'),
        () => showToast('Failed to copy', 'error'),
      );
    });

    // Open pixel editor
    this._btnEdit?.addEventListener('click', () => this._openPixelEditor());
    this._previewCanvas?.addEventListener('dblclick', () => this._openPixelEditor());

    // Revert to original image
    this._btnRevert?.addEventListener('click', () => this._revertImage());

    // Close / reset image converter
    this._btnClose?.addEventListener('click', () => this._resetConverter());
  }

  // ── Public API (called from main.js on drag-drop) ──────────────────────

  async loadFile(file) {
    await this._handleFileLoaded(file);
  }

  // ── File loading ────────────────────────────────────────────────────────

  async _handleFileLoaded(file) {
    try {
      this._imageData = await loadImageFileOriginal(file);
      this._fileName = file.name;
    } catch {
      showToast('Failed to load image', 'error');
      return;
    }

    // Stash original for revert
    this._originalImageData = new ImageData(
      new Uint8ClampedArray(this._imageData.data),
      this._imageData.width,
      this._imageData.height,
    );

    // Reset edited state
    this._fileLabel?.classList.remove('has-file-edited');
    this._btnRevert?.classList.add('hidden');

    showToast(`Image loaded: ${file.name}`, 'success');

    // Detect transparency and auto-switch format if needed
    const hasTransparency = this._detectTransparency(this._imageData);
    if (hasTransparency) {
      if (this._formatSelect) {
        this._formatSelect.value = OUTPUT_FORMAT.SPRITES_EXT_MASK;
      }
      showToast('Transparency detected. Switched to sprites + external mask format.', 'info');
    }

    // Update label
    if (this._fileLabel) {
      this._fileLabel.textContent = file.name;
      this._fileLabel.classList.add('has-file');
    }

    // Render preview
    this._renderPreview();
    this._renderThresholdPreview();

    // Show dimensions
    const w = this._imageData.width;
    const h = this._imageData.height;
    if (this._dimensionsEl) {
      this._dimensionsEl.textContent = `${w} \u00d7 ${h} px`;
    }
    this._previewSection?.classList.remove('hidden');
    this._btnEdit?.classList.remove('hidden');

    // Pick an intelligent default zoom now that the container is visible
    this._selectBestScale();
    this._applyPreviewScale();

    // Parse frame dimensions from filename (e.g. ball_16x16.png → 16×16)
    const parsed = parseDimensionsFromFilename(file.name);
    if (this._frameWidthInput) this._frameWidthInput.value = parsed.width || w;
    if (this._frameHeightInput) this._frameHeightInput.value = parsed.height || h;
    if (this._spacingInput) this._spacingInput.value = parsed.spacing || 0;
    this._spriteSettings?.classList.remove('hidden');
    
    // Show settings group but keep accordion collapsed
    const settingsGroup = document.getElementById('img-settings-group');
    settingsGroup?.classList.remove('hidden');

    // Derive a default variable name from filename
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    if (this._varnameInput && baseName) {
      this._varnameInput.value = baseName;
    }

    // Run initial conversion
    this._updateConversion();
    this._saveToStorage();
  }

  // ── Helper functions ────────────────────────────────────────────────────

  /**
   * Detect if an image has any transparent pixels (alpha < 255).
   * @param {ImageData} imageData - The image to check
   * @returns {boolean} True if any pixel has alpha < 255
   */
  _detectTransparency(imageData) {
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if the current format supports transparency masking.
   * @returns {boolean} True if the selected format supports masks
   */
  _currentFormatSupportsMasking() {
    const format = this._formatSelect?.value;
    return format === OUTPUT_FORMAT.SPRITES_EXT_MASK
      || format === OUTPUT_FORMAT.SPRITES_PLUS_MASK;
  }

  /**
   * Create a new blank image via dialog and load it into the converter.
   */
  async _createNewImage() {
    const result = await showNewImageDialog();
    if (!result) return;

    const { filename, width, height } = result;
    const imageData = new ImageData(width, height);
    // Fill with opaque black
    for (let i = 0; i < width * height; i++) {
      imageData.data[i * 4 + 3] = 255;
    }

    this._imageData = imageData;
    this._fileName = filename;
    this._originalImageData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      width,
      height,
    );

    // Reset edited state
    this._fileLabel?.classList.remove('has-file-edited');
    this._btnRevert?.classList.add('hidden');

    showToast(`Created new image: ${filename}`, 'success');

    // Update label
    if (this._fileLabel) {
      this._fileLabel.textContent = filename;
      this._fileLabel.classList.add('has-file');
    }

    // Render preview
    this._renderPreview();
    this._renderThresholdPreview();

    // Show dimensions
    if (this._dimensionsEl) {
      this._dimensionsEl.textContent = `${width} \u00d7 ${height} px`;
    }
    this._previewSection?.classList.remove('hidden');
    this._btnEdit?.classList.remove('hidden');

    // Default frame size to full image
    if (this._frameWidthInput) this._frameWidthInput.value = width;
    if (this._frameHeightInput) this._frameHeightInput.value = height;
    if (this._spacingInput) this._spacingInput.value = 0;
    this._spriteSettings?.classList.remove('hidden');

    const settingsGroup = document.getElementById('img-settings-group');
    settingsGroup?.classList.remove('hidden');

    // Variable name from filename
    const baseName = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    if (this._varnameInput && baseName) {
      this._varnameInput.value = baseName;
    }

    this._updateConversion();
    this._saveToStorage();
  }

  /**
   * Open the pixel editor modal with the currently loaded image.
   */
  _openPixelEditor() {
    if (!this._imageData || !window.__pixelEditor) return;
    const threshold = parseInt(this._thresholdSlider?.value, 10) || 128;
    window.__pixelEditor.open(this._imageData, {
      filename: this._fileName,
      threshold,
      onSave: (editedImageData, meta) => {
        this._imageData = editedImageData;

        // Update threshold from editor
        if (this._thresholdSlider) this._thresholdSlider.value = meta.threshold;
        if (this._thresholdValue) this._thresholdValue.textContent = meta.threshold;

        // Update dimensions display if image was resized
        if (this._dimensionsEl) {
          this._dimensionsEl.textContent = `${editedImageData.width} \u00D7 ${editedImageData.height} px`;
        }

        // Check for transparency and auto-switch format if needed
        const hasTransparency = this._detectTransparency(editedImageData);
        if (hasTransparency && !this._currentFormatSupportsMasking()) {
          if (this._formatSelect) this._formatSelect.value = OUTPUT_FORMAT.SPRITES_EXT_MASK;
          showToast('Transparency detected. Switched to sprites + external mask format.', 'info');
        }

        // Re-render previews and conversion
        this._renderPreview();
        this._renderThresholdPreview();
        this._updateConversion();

        // Mark file label as edited and add asterisk
        this._fileLabel?.classList.add('has-file-edited');
        if (this._fileLabel && this._fileName && !this._fileLabel.textContent.endsWith('*')) {
          this._fileLabel.textContent = this._fileName + ' *';
        }
        this._btnRevert?.classList.remove('hidden');

        showToast('Image updated from editor', 'success');
        this._saveToStorage();
      },
      onThresholdChange: (val) => {
        if (this._thresholdSlider) this._thresholdSlider.value = val;
        if (this._thresholdValue) this._thresholdValue.textContent = val;
      },
    });
  }

  /**
   * Revert the image data to the originally imported file.
   */
  async _revertImage() {
    if (!this._originalImageData) return;
    const ok = await showConfirm('Revert this image to the original? Your edits will be lost and this cannot be undone.', {
      title: 'Revert Image',
      okLabel: 'Revert',
      danger: true,
    });
    if (!ok) return;
    this._imageData = new ImageData(
      new Uint8ClampedArray(this._originalImageData.data),
      this._originalImageData.width,
      this._originalImageData.height,
    );
    this._renderPreview();
    this._renderThresholdPreview();
    this._updateConversion();
    this._fileLabel?.classList.remove('has-file-edited');
    if (this._fileLabel && this._fileName) {
      this._fileLabel.textContent = this._fileName;
    }
    this._btnRevert?.classList.add('hidden');
    this._saveToStorage();
    showToast('Reverted to original image', 'success');
  }

  /**
   * Confirm and fully reset the image converter, clearing storage and UI.
   */
  async _resetConverter() {
    const ok = await showConfirm('Reset the image converter? All changes will be lost.', {
      title: 'Reset Image Converter',
      okLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;

    localStorage.removeItem('imageConverter-state');

    this._imageData = null;
    this._originalImageData = null;
    this._fileName = '';

    // Reset file input
    if (this._fileInput) this._fileInput.value = '';
    if (this._fileLabel) {
      this._fileLabel.textContent = 'Choose image file (.png, .jpg, .gif, .bmp, .webp)';
      this._fileLabel.classList.remove('has-file', 'has-file-edited');
    }

    // Hide all sections
    this._previewSection?.classList.add('hidden');
    this._btnEdit?.classList.add('hidden');
    this._btnRevert?.classList.add('hidden');
    this._spriteSettings?.classList.add('hidden');
    document.getElementById('img-settings-group')?.classList.add('hidden');
    this._outputGroup?.classList.add('hidden');
    this._usageGroup?.classList.add('hidden');

    // Reset form values
    if (this._varnameInput) this._varnameInput.value = 'image';
    if (this._thresholdSlider) this._thresholdSlider.value = 128;
    if (this._thresholdValue) this._thresholdValue.textContent = '128';
    if (this._scaleSelect) this._scaleSelect.value = '4x';

    showToast('Image converter reset', 'success');
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  /** Convert ImageData to a PNG data-URL (synchronous via canvas). */
  _imageDataToDataURL(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    return c.toDataURL('image/png');
  }

  /** Load a PNG data-URL back into an ImageData (async). */
  _dataURLToImageData(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, c.width, c.height));
      };
      img.onerror = reject;
      img.src = dataURL;
    });
  }

  /** Save current image state to localStorage. */
  _saveToStorage() {
    try {
      if (!this._imageData) {
        localStorage.removeItem('imageConverter-state');
        return;
      }
      const data = {
        image: this._imageDataToDataURL(this._imageData),
        fileName: this._fileName,
        edited: this._fileLabel?.classList.contains('has-file-edited') ?? false,
        format: this._formatSelect?.value || '',
        threshold: this._thresholdSlider?.value || '128',
        frameWidth: this._frameWidthInput?.value || '',
        frameHeight: this._frameHeightInput?.value || '',
        spacing: this._spacingInput?.value || '0',
      };
      if (this._originalImageData) {
        data.original = this._imageDataToDataURL(this._originalImageData);
      }
      localStorage.setItem('imageConverter-state', JSON.stringify(data));
    } catch {
      // Storage full or other error — silently ignore
    }
  }

  /** Restore image state from localStorage on page load. */
  async _restoreFromStorage() {
    try {
      const raw = localStorage.getItem('imageConverter-state');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data.image) return;

      this._imageData = await this._dataURLToImageData(data.image);
      this._fileName = data.fileName || '';

      if (data.original) {
        this._originalImageData = await this._dataURLToImageData(data.original);
      }

      // Restore settings
      if (data.format && this._formatSelect) {
        this._formatSelect.value = data.format;
      }
      if (data.threshold) {
        if (this._thresholdSlider) this._thresholdSlider.value = data.threshold;
        if (this._thresholdValue) this._thresholdValue.textContent = data.threshold;
      }
      if (data.frameWidth && this._frameWidthInput) {
        this._frameWidthInput.value = data.frameWidth;
      }
      if (data.frameHeight && this._frameHeightInput) {
        this._frameHeightInput.value = data.frameHeight;
      }
      if (data.spacing && this._spacingInput) {
        this._spacingInput.value = data.spacing;
      }

      // Restore UI
      if (this._fileLabel && this._fileName) {
        this._fileLabel.textContent = this._fileName;
        this._fileLabel.classList.add('has-file');
      }
      if (data.edited) {
        this._fileLabel?.classList.add('has-file-edited');
        if (this._fileLabel && this._fileName) {
          this._fileLabel.textContent = this._fileName + ' *';
        }
        this._btnRevert?.classList.remove('hidden');
      }
      const w = this._imageData.width;
      const h = this._imageData.height;
      if (this._dimensionsEl) {
        this._dimensionsEl.textContent = `${w} \u00d7 ${h} px`;
      }
      this._previewSection?.classList.remove('hidden');
      this._btnEdit?.classList.remove('hidden');
      this._spriteSettings?.classList.remove('hidden');
      const settingsGroup = document.getElementById('img-settings-group');
      settingsGroup?.classList.remove('hidden');

      if (this._varnameInput && this._fileName) {
        const baseName = this._fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        if (baseName && !this._varnameInput.value) {
          this._varnameInput.value = baseName;
        }
      }

      this._selectBestScale();
      this._renderPreview();
      this._renderThresholdPreview();
      this._updateConversion();
    } catch {
      // Corrupted storage — silently ignore
    }
  }

  // ── Preview rendering ───────────────────────────────────────────────────

  _renderPreview() {
    if (!this._imageData || !this._previewCanvas) return;
    const w = this._imageData.width;
    const h = this._imageData.height;

    this._previewCanvas.title = 'Double-click to open pixel editor';

    // Set canvas to native image size (CSS will scale it)
    this._previewCanvas.width = w;
    this._previewCanvas.height = h;
    const ctx = this._previewCanvas.getContext('2d');
    
    // Fill with appropriate color for transparent areas
    // Green if format supports masking, black otherwise
    ctx.fillStyle = this._currentFormatSupportsMasking() ? '#34D399' : '#000000';
    ctx.fillRect(0, 0, w, h);
    
    ctx.putImageData(this._imageData, 0, 0);
    this._applyPreviewScale();
  }

  // Render thresholded preview
  _renderThresholdPreview() {
    if (!this._imageData || !this._previewCanvas) return;
    const w = this._imageData.width;
    const h = this._imageData.height;
    const threshold = parseInt(this._thresholdSlider?.value, 10) ?? 128;
    const supportsMasking = this._currentFormatSupportsMasking();
    // Create a new ImageData for preview
    const src = this._imageData.data;
    const preview = new ImageData(w, h);
    const dst = preview.data;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      // Check if pixel is transparent in original image
      const alpha = src[idx + 3];
      if (alpha < 255) {
        // Transparent pixel: show as green if masking supported, black otherwise
        if (supportsMasking) {
          dst[idx] = 0x34;      // #34D399 red
          dst[idx + 1] = 0xD3;  // #34D399 green
          dst[idx + 2] = 0x99;  // #34D399 blue
        } else {
          dst[idx] = 0;         // Black
          dst[idx + 1] = 0;
          dst[idx + 2] = 0;
        }
        dst[idx + 3] = 255;
      } else {
        // Opaque pixel: apply threshold
        const brightness = src[idx + 1];
        const value = brightness > threshold ? 255 : 0;
        dst[idx] = value;
        dst[idx + 1] = value;
        dst[idx + 2] = value;
        dst[idx + 3] = 255;
      }
    }
    this._previewCanvas.width = w;
    this._previewCanvas.height = h;
    const ctx = this._previewCanvas.getContext('2d');
    ctx.putImageData(preview, 0, 0);
    this._applyPreviewScale();
  }

  _applyPreviewScale() {
    const canvas = this._previewCanvas;
    if (!canvas || !this._imageData) return;
    const scale = this._scaleSelect?.value ?? '4x';
    const w = this._imageData.width;
    const h = this._imageData.height;

    // Reset
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
    canvas.classList.remove('fill-view');

    if (scale === 'fill') {
      canvas.classList.add('fill-view');
    } else {
      const factor = parseInt(scale, 10) || 1;
      if (factor > 1) {
        canvas.style.width = `${w * factor}px`;
        canvas.style.height = `${h * factor}px`;
        canvas.style.maxWidth = 'none';
        canvas.style.maxHeight = 'none';
      }
    }
    // '1x' — default CSS handles it (max-width: 100%, max-height: 256px)
  }

  /**
   * Pick the best initial zoom so the preview doesn't overflow its container
   * or get unreasonably tall. Prefers 4x, falls back to the largest zoom that
   * fits within both the container width and a reasonable max height (512px).
   */
  _selectBestScale() {
    if (!this._imageData || !this._scaleSelect) return;
    const w = this._imageData.width;
    const h = this._imageData.height;
    const wrap = this._previewCanvas?.parentElement;
    const containerW = wrap ? wrap.clientWidth : 600;
    const maxH = 512;
    const levels = [32, 24, 16, 12, 8, 4, 2, 1];
    for (const z of levels) {
      if (w * z <= containerW && h * z <= maxH) {
        this._scaleSelect.value = `${z}x`;
        return;
      }
    }
    // Even 1x overflows — use fill
    this._scaleSelect.value = 'fill';
  }

  // ── Conversion ──────────────────────────────────────────────────────────

  _toggleAccordion() {
    if (!this._accordionToggle || !this._accordionContent) return;
    
    const isCollapsed = this._accordionContent.classList.contains('collapsed');
    
    if (isCollapsed) {
      // Expand
      this._accordionContent.classList.remove('collapsed');
      this._accordionToggle.setAttribute('aria-expanded', 'true');
    } else {
      // Collapse
      this._accordionContent.classList.add('collapsed');
      this._accordionToggle.setAttribute('aria-expanded', 'false');
    }
  }

  _updateConversion() {
    if (!this._imageData) return;

    const format = this._formatSelect?.value || OUTPUT_FORMAT.SPRITES_OVERWRITE;
    const name = this._sanitizeName(this._varnameInput?.value || 'image');
    const fw = parseInt(this._frameWidthInput?.value, 10) || 0;
    const fh = parseInt(this._frameHeightInput?.value, 10) || 0;
    const spacing = parseInt(this._spacingInput?.value, 10) || 0;
    const threshold = parseInt(this._thresholdSlider?.value, 10) ?? 128;

    const isLegacy = format === OUTPUT_FORMAT.DRAW_BITMAP || format === OUTPUT_FORMAT.DRAW_SLOW_XY;
    const manualOffset = this._manualOffsetCb?.checked ?? true;

    // Compute natural (unlimited) frame count for warning/notice display
    const imgW = this._imageData.width;
    const imgH = this._imageData.height;
    const eFw = fw || imgW;
    const eFh = fh || imgH;
    this._naturalFrameCount = Math.max(1, Math.floor((imgW + spacing) / (eFw + spacing)))
      * Math.max(1, Math.floor((imgH + spacing) / (eFh + spacing)));

    const config = {
      format, width: fw, height: fh, spacing, threshold,
      ...(isLegacy && !manualOffset ? { maxFrames: 1 } : {}),
    };

    try {
      this._lastResult = convertImageFormat(this._imageData, name, config);
    } catch (err) {
      showToast(`Conversion error: ${err.message}`, 'error');
      return;
    }

    this._renderOutput();
    this._renderFrameStrip();
  }

  // ── Output rendering ───────────────────────────────────────────────────

  _renderOutput() {
    const r = this._lastResult;
    if (!r) return;

    // Show output groups
    this._outputGroup?.classList.remove('hidden');
    this._usageGroup?.classList.remove('hidden');

    // Code
    if (this._codeOutput) {
      this._codeOutput.textContent = r.code;
      applyExampleLinks(this._codeOutput);
    }

    // Info bar
    const format = this._formatSelect?.value;
    const isVertical = format !== OUTPUT_FORMAT.DRAW_SLOW_XY;
    const displayHeight = isVertical ? r.paddedHeight : r.frameHeight;
    const paddedNote = (isVertical && r.paddedHeight !== r.frameHeight)
      ? ` (padded from ${r.frameHeight})`
      : '';

    if (this._outputInfo) {
      this._outputInfo.innerHTML = [
        `<span class="img-info-item">Size: <span class="img-info-value">${r.frameWidth}\u00d7${displayHeight}${paddedNote}</span></span>`,
        `<span class="img-info-item">Frames: <span class="img-info-value">${r.frameCount}</span></span>`,
        `<span class="img-info-item">Bytes: <span class="img-info-value">${r.byteCount.toLocaleString()}</span></span>`,
      ].join('');
    }

    // Frame info text
    if (this._frameInfo) {
      this._frameInfo.textContent = r.frameCount > 1
        ? `${r.frameCount} frames detected (${r.frameWidth}\u00d7${r.frameHeight} each)`
        : `Single frame (${r.frameWidth}\u00d7${r.frameHeight})`;
    }

    // Usage + format compatibility warning
    this._updateUsageDisplay();
    this._updateFormatWarning();
  }

  _updateUsageDisplay() {
    const r = this._lastResult;
    if (!r) return;

    const format = this._formatSelect?.value;
    const name = this._sanitizeName(this._varnameInput?.value || 'image');
    const isVertical = format !== OUTPUT_FORMAT.DRAW_SLOW_XY;
    const displayHeight = isVertical ? r.paddedHeight : r.frameHeight;

    const snippet = generateUsageSnippet(name, format, r.frameWidth, displayHeight, r.frameCount);

    if (this._fullSketchCb?.checked) {
      const fullSketch = generateFullSketch(name, format, r.frameWidth, displayHeight, r.code, snippet, r.frameCount);
      if (this._usageOutput) this._usageOutput.textContent = fullSketch;
      this._btnPushSketch?.classList.remove('hidden');
      applyExampleLinks(this._usageOutput);
    } else {
      if (this._usageOutput) this._usageOutput.textContent = snippet;
      this._btnPushSketch?.classList.add('hidden');
    }
  }

  // ── Format compatibility warning ────────────────────────────────────────

  _updateFormatWarning() {
    if (!this._formatWarning) return;
    const format = this._formatSelect?.value;

    const isLegacyFormat = format === OUTPUT_FORMAT.DRAW_BITMAP
      || format === OUTPUT_FORMAT.DRAW_SLOW_XY;
    const naturalMultiFrame = (this._naturalFrameCount ?? 1) > 1;
    const manualOffset = this._manualOffsetCb?.checked ?? true;

      // Show/hide manual offset row only for legacy formats with multiple frames
      this._manualOffsetRow?.classList.toggle('hidden', !(isLegacyFormat && naturalMultiFrame));

    // Show/hide first-frame notice in output section
    if (this._firstFrameNotice) {
      const showNotice = isLegacyFormat && !manualOffset && naturalMultiFrame;
      this._firstFrameNotice.classList.toggle('hidden', !showNotice);
    }

    // Format compatibility warning
    if (isLegacyFormat && naturalMultiFrame) {
      const fname = format === OUTPUT_FORMAT.DRAW_BITMAP ? 'drawBitmap()' : 'drawSlowXYBitmap()';
      if (this._formatWarningText) {
        this._formatWarningText.textContent = `${fname} has no built-in frame index. Switch to\u00a0`;
      }
      if (this._formatSwitchLink) {
        this._formatSwitchLink.textContent = 'Sprites (drawOverwrite)';
        this._formatSwitchLink.dataset.targetFormat = OUTPUT_FORMAT.SPRITES_OVERWRITE;
      }
      this._formatWarning.classList.remove('hidden');
    } else {
      this._formatWarning.classList.add('hidden');
    }
  }

  // ── Frame strip ─────────────────────────────────────────────────────────

  _renderFrameStrip() {
    if (!this._frameStrip || !this._imageData || !this._lastResult) return;
    this._frameStrip.innerHTML = '';

    const r = this._lastResult;
    const imgData = this._imageData;
    const fw = r.frameWidth;
    const fh = r.frameHeight;
    const spacing = parseInt(this._spacingInput?.value, 10) || 0;
    const cols = Math.max(1, Math.floor((imgData.width + spacing) / (fw + spacing)));
    const maxDisplay = Math.min(r.frameCount, 50);

    const stripScale = parseInt(document.querySelector('input[name="img-strip-scale"]:checked')?.value ?? '1', 10);

    for (let i = 0; i < maxDisplay; i++) {
      const frameCol = i % cols;
      const frameRow = Math.floor(i / cols);
      const sx = frameCol * (fw + spacing);
      const sy = frameRow * (fh + spacing);

      const canvas = document.createElement('canvas');
      canvas.width = fw * stripScale;
      canvas.height = fh * stripScale;
      canvas.title = `Frame ${i}`;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      // Fill with appropriate color for transparent areas
      // Green if format supports masking, black otherwise
      ctx.fillStyle = this._currentFormatSupportsMasking() ? '#34D399' : '#000000';
      ctx.fillRect(0, 0, fw * stripScale, fh * stripScale);

      // Draw the frame region from the source image
      const tempCanvas = new OffscreenCanvas(fw, fh);
      const tempCtx = tempCanvas.getContext('2d');

      // Copy pixel region from imageData
      const frameData = new ImageData(fw, fh);
      const src = imgData.data;
      const dst = frameData.data;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const srcIdx = ((sy + y) * imgData.width + (sx + x)) * 4;
          const dstIdx = (y * fw + x) * 4;
          if (sx + x < imgData.width && sy + y < imgData.height) {
            dst[dstIdx] = src[srcIdx];
            dst[dstIdx + 1] = src[srcIdx + 1];
            dst[dstIdx + 2] = src[srcIdx + 2];
            dst[dstIdx + 3] = src[srcIdx + 3];
          }
        }
      }
      tempCtx.putImageData(frameData, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, fw * stripScale, fh * stripScale);

      this._frameStrip.appendChild(canvas);
    }

    if (this._frameMore) {
      if (r.frameCount > maxDisplay) {
        this._frameMore.textContent = `\u2026 and ${r.frameCount - maxDisplay} more frames`;
        this._frameMore.classList.remove('hidden');
      } else {
        this._frameMore.textContent = '';
        this._frameMore.classList.add('hidden');
      }
    }
  }

  // ── Push to Code Editor ──────────────────────────────────────────────

  /** Ensure the code editor scripts are loaded; returns the API or null. */
  async _ensureCodeEditor() {
    if (window.__codeEditor) return window.__codeEditor;

    if (typeof window.__loadCompilerScripts === 'function') {
      window.__loadCompilerScripts();
      // Wait for __codeEditor to become available (scripts load sequentially)
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (window.__codeEditor) return window.__codeEditor;
      }
    }

    showToast('Code editor failed to load', 'error');
    return null;
  }

  async _pushToCode() {
    const code = this._codeOutput?.textContent;
    if (!code) {
      showToast('No generated code to push', 'error');
      return;
    }

    const api = await this._ensureCodeEditor();
    if (!api) return;

    const varName = this._sanitizeName(this._varnameInput?.value || 'image');

    // Search for existing image.h across all tabs (including subfolders)
    let imageTab = api.findTabByBasename('image.h');

    if (imageTab) {
      // image.h exists — check if variable already present
      const existing = imageTab.model.getValue();
      const varPattern = new RegExp('\\b' + varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

      if (varPattern.test(existing)) {
        // Variable exists — ask user to replace
        const replace = await showConfirm(
          `"${varName}" already exists in ${imageTab.filename}. Replace it?`,
          { title: 'Replace Variable', okLabel: 'Replace', cancelLabel: 'Cancel' },
        );
        if (!replace) return;

        // Find and replace the entire variable block(s)
        const newContent = this._replaceVariableBlock(existing, varName, code);
        imageTab.model.setValue(newContent);
        showToast(`Replaced "${varName}" in ${imageTab.filename}`, 'success');
      } else {
        // Variable doesn't exist — append
        const sep = existing.endsWith('\n') ? '\n' : '\n\n';
        imageTab.model.setValue(existing + sep + code + '\n');
        showToast(`Added "${varName}" to ${imageTab.filename}`, 'success');
      }

      // Navigate to the image.h tab
      api.switchToTab(imageTab.id);
    } else {
      // No image.h found — create it
      imageTab = api.createTab('image.h', code + '\n');
      api.sortTabs();

      // Add #include "image.h" to the .ino file
      const inoTab = api.findInoTab();
      if (inoTab) {
        const inoSrc = inoTab.model.getValue();
        if (!/#\s*include\s+["']image\.h["']/.test(inoSrc)) {
          const lines = inoSrc.split('\n');
          // Insert after the last existing #include
          let lastInclude = -1;
          for (let i = 0; i < lines.length; i++) {
            if (/^\s*#\s*include\s/.test(lines[i])) lastInclude = i;
          }
          if (lastInclude >= 0) {
            lines.splice(lastInclude + 1, 0, '#include "image.h"');
          } else {
            // No includes found — add at the top
            lines.unshift('#include "image.h"');
          }
          inoTab.model.setValue(lines.join('\n'));
        }
      }

      showToast('Created image.h and added include to sketch', 'success');

      // Navigate to the image.h tab
      api.switchToTab(imageTab.id);
    }

    // Switch the main panel to the Code tab
    const codeTabBtn = document.querySelector('[data-panel="code"]');
    codeTabBtn?.click();
  }

  async _pushSketchToCode() {
    const code = this._usageOutput?.textContent;
    if (!code) {
      showToast('No sketch code to push', 'error');
      return;
    }

    const api = await this._ensureCodeEditor();
    if (!api) return;

    const name = this._sanitizeName(this._varnameInput?.value || 'image');
    const filename = name.charAt(0).toUpperCase() + name.slice(1) + '.ino';

    // Switch to the Code tab first so the confirm modal is visible
    const codeTabBtn = document.querySelector('[data-panel="code"]');
    codeTabBtn?.click();

    const imported = await api.importSketch(filename, code);
    if (imported) {
      showToast(`Imported sketch as ${filename}`, 'success');
    }
  }

  /**
   * Replace a variable's PROGMEM block(s) in existing source code.
   * Handles: constexpr width/height, const uint8_t PROGMEM name[], and mask arrays.
   */
  _replaceVariableBlock(source, varName, newCode) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match constexpr lines for this variable (e.g. constexpr uint8_t imageWidth = ...)
    const constexprRe = new RegExp(
      '^[ \\t]*constexpr\\s+\\w+\\s+' + escaped + '(?:Width|Height)\\s*=.*$', 'gm',
    );

    // Match PROGMEM array declarations (spans multiple lines until closing };)
    const progmemRe = new RegExp(
      '^[ \\t]*const\\s+uint8_t\\s+PROGMEM\\s+' + escaped + '(?:Mask)?\\s*\\[\\][\\s\\S]*?^[ \\t]*\\};',
      'gm',
    );

    // Collect all match ranges
    const ranges = [];
    let m;
    while ((m = constexprRe.exec(source)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }
    while ((m = progmemRe.exec(source)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }

    if (ranges.length === 0) {
      // Fallback: just append
      return source + '\n\n' + newCode + '\n';
    }

    // Sort ranges by position and merge overlapping
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1] + 1) {
        last[1] = Math.max(last[1], ranges[i][1]);
      } else {
        merged.push(ranges[i]);
      }
    }

    // Replace first occurrence with new code, remove the rest
    let result = '';
    let pos = 0;
    for (let i = 0; i < merged.length; i++) {
      result += source.slice(pos, merged[i][0]);
      if (i === 0) {
        result += newCode;
      }
      pos = merged[i][1];
      // Skip trailing newlines after removed blocks
      while (pos < source.length && source[pos] === '\n') pos++;
    }
    result += source.slice(pos);

    return result;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _extractBytesOnly(code) {
    // Extract all 0xNN hex values from the code string, formatted 12 per line
    const hex = [];
    const re = /0x[0-9a-fA-F]{2}/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      hex.push(m[0]);
    }
    const lines = [];
    for (let i = 0; i < hex.length; i += 12) {
      lines.push(hex.slice(i, i + 12).join(', '));
    }
    return lines.join(',\n');
  }

  _sanitizeName(raw) {
    let name = raw.replace(/[^a-zA-Z0-9_]/g, '_');
    // Ensure starts with letter or underscore
    if (name && /^[0-9]/.test(name)) name = '_' + name;
    return name || 'image';
  }
}
