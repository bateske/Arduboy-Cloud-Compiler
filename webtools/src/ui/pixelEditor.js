// webtools/src/ui/pixelEditor.js
// Modal pixel image editor for Arduboy 1-bit images.
// Supports black/white/transparent, threshold integration, tools, undo/redo, import/export.

import { loadImageFileOriginal } from '../core/formats/image.js';
import { showConfirm } from './modal.js';
import { showToast } from './toast.js';
import { downloadBlob } from './files.js';
import { loadAllFonts, drawText, measureText, getTextPixels } from '../core/bitmapFont.js';

// ── Constants ────────────────────────────────────────────────────────────────

const COLOR_BLACK = 0;
const COLOR_WHITE = 1;
const COLOR_TRANSPARENT = 2;

const DISPLAY_COLORS = ['#000000', '#ffffff', '#34D399'];
const GRID_COLOR = 'rgba(255,255,255,0.15)';
const BG_COLOR = '#0d0d1a';
const SELECTION_COLOR = '#FBF157';

const ZOOM_LEVELS = [1, 2, 4, 8, 12, 16, 24, 32];
const MAX_UNDO = 50;

const FILL_PATTERNS = {
  solid: null,
  half: [[1, 0], [0, 1]],
  quarter: [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
  threeQuarter: [[0, 1, 1, 1], [1, 1, 1, 1], [1, 1, 0, 1], [1, 1, 1, 1]],
  crosshatch: [[1, 0, 1, 0], [0, 0, 0, 0], [1, 0, 1, 0], [0, 0, 0, 0]],
  hlines: [[1, 1], [0, 0]],
  vlines: [[1, 0], [1, 0]],
};

const PATTERN_LABELS = {
  solid: 'Solid',
  half: '50%',
  quarter: '25%',
  threeQuarter: '75%',
  crosshatch: 'Cross',
  hlines: 'H-Lines',
  vlines: 'V-Lines',
};

// SVG icons for tools (16x16 viewBox)
const TOOL_ICONS = {
  pencil: '<path d="M12.1 1.9a1.5 1.5 0 012.1 0l0 0a1.5 1.5 0 010 2.1L5.5 12.7l-3 .8.8-3L12.1 1.9z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  brush: '<path d="M10.099 2.5C11.599 1.5 13.599 3 12.599 5L8.099 10.5C7.599 11.5 6.099 13 4.599 13.5C2.599 14.2 1 12.532 1 11.032C1 10.032 3.915 9.729 4.521 8.662C4.841 8.099 7.28 10.296 7.665 10.05C7.945 9.872 4.599 8.421 4.599 8L10.099 2.5Z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  line: '<line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  rect: '<rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  circle: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  fill: '<path d="M6 1.5L1.5 6c-.7.7-.7 1.8 0 2.5l4 4c.7.7 1.8.7 2.5 0L12.5 8c.7-.7.7-1.8 0-2.5L8.7 1.7" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M13 11c0 0-2 2.5-2 3.5a2 2 0 004 0c0-1-2-3.5-2-3.5z" fill="currentColor" opacity="0.7"/>',
  select: '<rect x="2" y="2" width="12" height="12" rx="0" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/>',
  text: '<text x="3" y="13" font-size="13" font-weight="bold" font-family="monospace" fill="currentColor">A</text>',
  undo: '<path d="M4 8L1 5m0 0L4 2m-3 3h7c2.2 0 4 1.8 4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  redo: '<path d="M12 8l3-3m0 0l-3-3m3 3H8c-2.2 0-4 1.8-4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  masked: '<polygon points="3,3 13,3 13,13 3,13" fill="none" stroke="currentColor" stroke-width="1.2"/><polygon points="3,13 13,13 13,3" fill="currentColor" opacity="0.6"/><line x1="1" y1="15" x2="15" y2="1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};


// ── PixelEditor class ────────────────────────────────────────────────────────

export class PixelEditor {
  constructor() {
    this._overlay = null;
    this._open = false;
    this._dirty = false;

    // Image state
    this._width = 0;
    this._height = 0;
    this._pixels = null;       // Uint8Array: 0=black, 1=white, 2=transparent
    this._editedMask = null;   // Uint8Array: 1=manually edited (threshold-immune)
    this._sourceImageData = null;

    // Resize backing store (preserves clipped data during non-destructive resize)
    this._backingPixels = null;
    this._backingMask = null;
    this._backingSource = null;
    this._backingWidth = 0;
    this._backingHeight = 0;

    // Options / callbacks
    this._opts = null;
    this._threshold = 128;

    // Canvas / view
    this._canvas = null;
    this._ctx = null;
    this._zoom = 1;
    this._scrollX = 0;
    this._scrollY = 0;
    this._showGrid = true;
    this._topLeftOrigin = false;
    this._renderPending = false;
    this._scrollProxy = null;
    this._scrollSizer = null;
    this._ignoreProxyScroll = false;

    // Tool state
    this._activeTool = 'pencil';
    this._activeColor = COLOR_WHITE;
    this._fillPattern = 'solid';
    this._fillMasked = false;
    this._brushSize = 1;
    this._lineThickness = 1;
    this._shapeFilled = false;
    this._lastPixel = null;       // for Bresenham interpolation
    this._dragStart = null;       // for line/rect/circle
    this._previewPixels = null;   // Map<"x,y", color> for tool preview
    this._drawing = false;

    // Selection
    this._selection = null;       // {x, y, w, h} or null
    this._clipboard = null;       // {w, h, pixels: Uint8Array} or null
    this._floatingPaste = null;   // {x, y, w, h, pixels: Uint8Array} or null
    this._pasteDragging = false;
    this._pasteDragOffset = null;
    this._lastClientX = 0;
    this._lastClientY = 0;
    this._selectionAnimOffset = 0;
    this._selectionAnimId = null;

    // Undo / redo
    this._undoStack = [];
    this._redoStack = [];

    // Middle-mouse scroll
    this._midDragging = false;
    this._midDragStart = null;
    this._midScrollStart = null;

    // DOM refs (set in _buildDOM)
    this._modal = null;
    this._canvasWrap = null;
    this._thresholdSlider = null;
    this._thresholdLabel = null;
    this._coordsLabel = null;
    this._dimsLabel = null;
    this._zoomLabel = null;
    this._brushSizeDropdown = null;
    this._brushSizeDropdownSlider = null;
    this._lineThicknessDropdown = null;
    this._lineThicknessDropdownSlider = null;
    this._lineThicknessBtn = null;
    this._brushOutlinePreview = null;  // Map<"x,y", true> for brush outline preview
    this._toolButtons = {};
    this._colorSwatches = {};
    this._patternButtons = {};
    this._fillTriggerCanvas = null;
    this._shapeFilledBtn = null;
    this._optionsPanel = null;
    this._optionsBtn = null;
    this._fileInput = null;

    // Text tool state
    this._textFont = null;        // Currently selected font object
    this._textFonts = null;       // Map<id, Font> of all loaded fonts
    this._textCursorPos = null;   // {x, y} canvas pixel position for text cursor
    this._textBuffer = '';        // Characters typed so far
    this._textCursorVisible = true;
    this._textCursorInterval = null;
    this._fontsLoaded = false;
    this._fontPanel = null;
    this._fontPanelBtn = null;
    this._fontListEl = null;
    this._textDragging = false;
    this._textDragOffset = null;  // {x, y} offset from cursor pos to click point

    // Resize UI refs
    this._dimsDisplay = null;
    this._dimsEditArea = null;
    this._dimsEditBtn = null;
    this._widthInput = null;
    this._heightInput = null;

    // Bound handlers for cleanup
    this._boundKeyDown = this._onKeyDown.bind(this);
    this._boundPaste = this._onPaste.bind(this);
  }


  // ── Public API ─────────────────────────────────────────────────────────────

  open(imageData, opts = {}) {
    if (this._open) this.close(true);

    this._opts = opts;
    this._threshold = opts.threshold ?? 128;
    this._supportsTransparency = opts.supportsTransparency !== false;
    this._sourceImageData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height,
    );

    this._width = imageData.width;
    this._height = imageData.height;
    this._pixels = new Uint8Array(this._width * this._height);
    this._editedMask = new Uint8Array(this._width * this._height);
    this._dirty = false;

    // Reset resize backing store
    this._backingPixels = null;
    this._backingMask = null;
    this._backingSource = null;
    this._backingWidth = 0;
    this._backingHeight = 0;

    // Derive initial pixels from source + threshold
    this._derivePixelsFromSource(this._threshold);

    // Reset state
    this._undoStack = [];
    this._redoStack = [];
    this._selection = null;
    this._floatingPaste = null;
    this._previewPixels = null;
    this._activeColor = COLOR_WHITE;
    this._activeTool = 'pencil';
    this._fillPattern = 'solid';
    this._brushSize = 1;
    this._lineThickness = 1;
    this._shapeFilled = false;

    // Reset text tool state
    this._clearTextState();

    // Build DOM if needed
    if (!this._overlay) this._buildDOM();

    // Show/hide transparency-related UI
    this._applyTransparencyVisibility();

    // Update UI state
    this._thresholdSlider.value = this._threshold;
    this._thresholdLabel.textContent = this._threshold;
    if (this._updateThresholdPos) this._updateThresholdPos();
    this._dimsLabel.textContent = `${this._width} \u00D7 ${this._height}`;
    if (this._dimsEditArea) this._exitResizeMode();
    if (this._dimsEditBtn) this._dimsEditBtn.classList.toggle('hidden', !!opts.hideResize);
    this._updateToolUI();
    this._updateColorUI();
    this._updatePatternUI();
    this._updateShapeFilledUI();
    this._updateBrushSizeDropdownValue();
    this._toggleOptionsPanel(false);

    // Size canvas and auto-fit zoom
    this._resizeCanvas();
    this._autoFitZoom();
    this._updateScrollLayout();
    this._centerScroll();
    this._updateZoomLabel();

    // Show
    this._overlay.classList.remove('hidden');
    requestAnimationFrame(() => this._overlay.classList.add('visible'));

    // Re-size after transition completes (modal may still be scaling)
    setTimeout(() => {
      this._resizeCanvas();
      this._autoFitZoom();
      this._updateScrollLayout();
      this._centerScroll();
      this._updateZoomLabel();
      this._requestRender();
    }, 220);

    // Listeners
    document.addEventListener('keydown', this._boundKeyDown);
    document.addEventListener('paste', this._boundPaste);

    // Start selection animation
    this._startSelectionAnim();

    this._open = true;
    this._requestRender();
  }

  close(force = false) {
    if (!this._open) return;
    if (!force && this._dirty) {
      showConfirm('Discard unsaved changes?').then((ok) => {
        if (ok) this._doClose();
      });
      return;
    }
    this._doClose();
  }


  // ── DOM construction ───────────────────────────────────────────────────────

  _buildDOM() {
    const overlay = document.createElement('div');
    overlay.className = 'pixel-editor-overlay hidden';
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const modal = document.createElement('div');
    modal.className = 'pixel-editor-modal';
    overlay.appendChild(modal);

    // Header
    const header = document.createElement('div');
    header.className = 'pixel-editor-header';
    const title = document.createElement('span');
    title.className = 'pixel-editor-title';
    title.textContent = 'Pixel Editor';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pe-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.close());

    const maximizeBtn = document.createElement('button');
    maximizeBtn.className = 'pe-close-btn';
    maximizeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="1" width="12" height="12" rx="1.5"/></svg>';
    maximizeBtn.title = 'Maximize';
    this._maximizeBtn = maximizeBtn;
    maximizeBtn.addEventListener('click', () => this._toggleMaximize());

    const headerBtns = document.createElement('div');
    headerBtns.style.display = 'flex';
    headerBtns.style.alignItems = 'center';
    headerBtns.style.gap = '4px';
    headerBtns.appendChild(maximizeBtn);
    headerBtns.appendChild(closeBtn);
    header.appendChild(headerBtns);
    modal.appendChild(header);

    // Top toolbar (tools + shape toggle)
    modal.appendChild(this._buildTopToolbar());

    // Body (canvas fills the area)
    const body = document.createElement('div');
    body.className = 'pixel-editor-body';

    body.appendChild(this._buildCanvasArea());

    modal.appendChild(body);

    // Floating options panel (inside modal for containment)
    modal.appendChild(this._buildSidebar());

    // Floating font chooser panel (inside modal for containment)
    modal.appendChild(this._buildFontPanel());

    // Footer
    modal.appendChild(this._buildFooter());

    // Append fill dropdown menu to overlay so it escapes toolbar overflow
    if (this._fillMenu) overlay.appendChild(this._fillMenu);

    // Append brush size dropdown to overlay
    if (this._brushSizeDropdown) overlay.appendChild(this._brushSizeDropdown);

    // Append line thickness dropdown to overlay
    if (this._lineThicknessDropdown) overlay.appendChild(this._lineThicknessDropdown);

    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._modal = modal;
    this._maximized = false;

    // Close brush dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (this._activeTool === 'brush' && this._brushSizeDropdown && !this._brushSizeDropdown.contains(e.target) && !this._toolButtons['brush'].contains(e.target)) {
        this._brushSizeDropdown.classList.add('hidden');
        this._brushSizeDropdown.classList.remove('visible');
      }
      // Close line thickness dropdown when clicking outside
      if (this._lineThicknessDropdown && !this._lineThicknessDropdown.contains(e.target) && this._lineThicknessBtn && !this._lineThicknessBtn.contains(e.target)) {
        this._lineThicknessDropdown.classList.add('hidden');
        this._lineThicknessDropdown.classList.remove('visible');
      }
    });
    this._brushSizeDropdown.addEventListener('click', (e) => e.stopPropagation());
    this._lineThicknessDropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  _buildTopToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'pixel-editor-top-toolbar';

    // Tool buttons
    const toolNames = ['pencil', 'brush', 'line', 'rect', 'circle', 'fill', 'select', 'text'];
    const toolLabels = ['Pencil (P)', 'Brush (B)', 'Line (L)', 'Rectangle (R)', 'Circle (C)', 'Fill (F)', 'Select (S)', 'Text (T)'];

    for (let i = 0; i < toolNames.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'pe-tool-btn';
      btn.title = toolLabels[i];
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">${TOOL_ICONS[toolNames[i]]}</svg>`;
      btn.dataset.tool = toolNames[i];
      btn.addEventListener('click', () => this._setTool(toolNames[i]));
      toolbar.appendChild(btn);
      this._toolButtons[toolNames[i]] = btn;
    }

    // Shape filled toggle
    toolbar.appendChild(this._createSeparatorV());
    const filledBtn = document.createElement('button');
    filledBtn.className = 'pe-tool-btn pe-shape-toggle';
    filledBtn.title = 'Toggle fill/outline for shapes';
    filledBtn.textContent = '▨';
    filledBtn.addEventListener('click', () => {
      this._shapeFilled = !this._shapeFilled;
      this._updateShapeFilledUI();
    });
    toolbar.appendChild(filledBtn);
    this._shapeFilledBtn = filledBtn;

    // Line thickness toggle button (3 horizontal lines of different thicknesses)
    const lineThicknessBtn = document.createElement('button');
    lineThicknessBtn.className = 'pe-tool-btn pe-line-thickness-toggle';
    lineThicknessBtn.title = 'Line thickness';
    lineThicknessBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="3"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="2"/><line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1"/></svg>`;
    lineThicknessBtn.addEventListener('click', () => {
      this._toggleLineThicknessDropdown();
    });
    toolbar.appendChild(lineThicknessBtn);
    this._lineThicknessBtn = lineThicknessBtn;

    // Line thickness dropdown (floating, similar to brush size)
    const lineThicknessDropdown = document.createElement('div');
    lineThicknessDropdown.className = 'pe-brush-size-dropdown hidden';
    const lineThicknessSliderWrap = document.createElement('div');
    lineThicknessSliderWrap.className = 'pe-brush-size-slider-wrap';
    const lineThicknessLabel = document.createElement('span');
    lineThicknessLabel.className = 'pe-brush-size-label';
    lineThicknessLabel.textContent = 'Width';
    lineThicknessSliderWrap.appendChild(lineThicknessLabel);
    const lineThicknessSlider = document.createElement('input');
    lineThicknessSlider.type = 'range';
    lineThicknessSlider.min = '1';
    lineThicknessSlider.max = '8';
    lineThicknessSlider.value = '1';
    lineThicknessSlider.className = 'pe-brush-size-slider-dropdown';
    lineThicknessSlider.addEventListener('input', () => {
      this._lineThickness = parseInt(lineThicknessSlider.value, 10);
      this._updateLineThicknessDropdownValue();
    });
    lineThicknessSliderWrap.appendChild(lineThicknessSlider);
    const lineThicknessValue = document.createElement('span');
    lineThicknessValue.className = 'pe-brush-size-value';
    lineThicknessValue.textContent = '1';
    lineThicknessSliderWrap.appendChild(lineThicknessValue);
    lineThicknessDropdown.appendChild(lineThicknessSliderWrap);
    this._lineThicknessDropdown = lineThicknessDropdown;
    this._lineThicknessDropdownSlider = lineThicknessSlider;
    this._lineThicknessValue = lineThicknessValue;

    // Brush size slider removed - using floating dropdown instead

    // Brush size dropdown (floating, shown when brush tool is active)
    const brushSizeDropdown = document.createElement('div');
    brushSizeDropdown.className = 'pe-brush-size-dropdown hidden';
    const brushSizeSliderWrap = document.createElement('div');
    brushSizeSliderWrap.className = 'pe-brush-size-slider-wrap';
    const brushSizeDropdownLabel = document.createElement('span');
    brushSizeDropdownLabel.className = 'pe-brush-size-label';
    brushSizeDropdownLabel.textContent = 'Size';
    brushSizeSliderWrap.appendChild(brushSizeDropdownLabel);
    const brushSizeDropdownSlider = document.createElement('input');
    brushSizeDropdownSlider.type = 'range';
    brushSizeDropdownSlider.min = '1';
    brushSizeDropdownSlider.max = '8';
    brushSizeDropdownSlider.value = '1';
    brushSizeDropdownSlider.className = 'pe-brush-size-slider-dropdown';
    brushSizeDropdownSlider.addEventListener('input', () => {
      this._brushSize = parseInt(brushSizeDropdownSlider.value, 10);
      this._updateBrushSizeDropdownValue();
    });
    brushSizeSliderWrap.appendChild(brushSizeDropdownSlider);
    const brushSizeValue = document.createElement('span');
    brushSizeValue.className = 'pe-brush-size-value';
    brushSizeValue.textContent = '1';
    brushSizeSliderWrap.appendChild(brushSizeValue);
    brushSizeDropdown.appendChild(brushSizeSliderWrap);
    this._brushSizeDropdown = brushSizeDropdown;
    this._brushSizeDropdownSlider = brushSizeDropdownSlider;
    this._brushSizeValue = brushSizeValue;

    // Color swatches
    toolbar.appendChild(this._createSeparatorV());
    const colorLabel = document.createElement('span');
    colorLabel.className = 'pe-toolbar-label';
    colorLabel.textContent = 'Color';
    toolbar.appendChild(colorLabel);
    const colors = [
      { key: COLOR_WHITE, cls: 'white', label: 'White' },
      { key: COLOR_BLACK, cls: 'black', label: 'Black' },
      { key: COLOR_TRANSPARENT, cls: 'transparent', label: 'Transparent' },
    ];
    for (const c of colors) {
      const sw = document.createElement('button');
      sw.className = `pe-color-swatch ${c.cls}`;
      sw.title = c.label;
      sw.dataset.color = c.key;
      sw.addEventListener('click', () => {
        this._activeColor = c.key;
        this._updateColorUI();
      });
      toolbar.appendChild(sw);
      this._colorSwatches[c.key] = sw;
    }

    // Fill pattern dropdown
    toolbar.appendChild(this._createSeparatorV());
    const fillLabel = document.createElement('span');
    fillLabel.className = 'pe-toolbar-label';
    fillLabel.textContent = 'Fill';
    toolbar.appendChild(fillLabel);
    const fillWrap = document.createElement('div');
    fillWrap.className = 'pe-fill-dropdown-wrap';

    const fillTrigger = document.createElement('button');
    fillTrigger.className = 'pe-fill-trigger';
    fillTrigger.title = 'Fill pattern';
    // Preview canvas in the trigger
    const triggerCanvas = document.createElement('canvas');
    triggerCanvas.width = 16;
    triggerCanvas.height = 16;
    triggerCanvas.className = 'pe-fill-trigger-preview';
    fillTrigger.appendChild(triggerCanvas);
    const triggerArrow = document.createElement('span');
    triggerArrow.className = 'pe-fill-trigger-arrow';
    triggerArrow.textContent = '\u25BE';
    fillTrigger.appendChild(triggerArrow);
    this._fillTriggerCanvas = triggerCanvas;

    const fillMenu = document.createElement('div');
    fillMenu.className = 'pe-fill-menu';
    fillMenu.classList.add('hidden');

    for (const [key, label] of Object.entries(PATTERN_LABELS)) {
      const item = document.createElement('button');
      item.className = 'pe-fill-menu-item';
      item.dataset.pattern = key;
      // 4x scale preview canvas (draw at 8x8, CSS scales to 32x32 pixelated)
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const cx = c.getContext('2d');
      this._drawPatternPreview(cx, key, 8, 8);
      item.appendChild(c);
      const lbl = document.createElement('span');
      lbl.textContent = label;
      item.appendChild(lbl);
      item.addEventListener('click', () => {
        this._fillPattern = key;
        this._updatePatternUI();
        fillMenu.classList.add('hidden');
      });
      fillMenu.appendChild(item);
      this._patternButtons[key] = item;
    }

    fillTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = fillMenu.classList.toggle('hidden');
      if (!isHidden) {
        const rect = fillTrigger.getBoundingClientRect();
        fillMenu.style.left = rect.left + 'px';
        fillMenu.style.top = (rect.bottom + 4) + 'px';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      fillMenu.classList.add('hidden');
    });
    fillMenu.addEventListener('click', (e) => e.stopPropagation());

    fillWrap.appendChild(fillTrigger);
    // Append menu to overlay so it escapes toolbar overflow
    this._fillMenu = fillMenu;
    toolbar.appendChild(fillWrap);

    // Masked mode toggle
    const maskedBtn = document.createElement('button');
    maskedBtn.className = 'pe-tool-btn pe-masked-btn';
    maskedBtn.title = 'Masked: use opposite color instead of transparent in patterns';
    maskedBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">${TOOL_ICONS.masked}</svg>`;
    maskedBtn.addEventListener('click', () => {
      this._fillMasked = !this._fillMasked;
      maskedBtn.classList.toggle('active', this._fillMasked);
    });
    this._maskedBtn = maskedBtn;
    toolbar.appendChild(maskedBtn);

    // Undo / Redo buttons
    toolbar.appendChild(this._createSeparatorV());
    const undoBtn = document.createElement('button');
    undoBtn.className = 'pe-tool-btn';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">${TOOL_ICONS.undo}</svg>`;
    undoBtn.addEventListener('click', () => this._undo());
    toolbar.appendChild(undoBtn);
    this._undoBtn = undoBtn;

    const redoBtn = document.createElement('button');
    redoBtn.className = 'pe-tool-btn';
    redoBtn.title = 'Redo (Ctrl+Y)';
    redoBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16">${TOOL_ICONS.redo}</svg>`;
    redoBtn.addEventListener('click', () => this._redo());
    toolbar.appendChild(redoBtn);
    this._redoBtn = redoBtn;

    // Options button — toggles floating panel
    toolbar.appendChild(this._createSeparatorV());
    const optBtn = document.createElement('button');
    optBtn.className = 'pe-tool-btn pe-options-btn';
    optBtn.title = 'Options panel';
    optBtn.textContent = 'Options';
    optBtn.addEventListener('click', () => this._toggleOptionsPanel());
    toolbar.appendChild(optBtn);
    this._optionsBtn = optBtn;

    return toolbar;
  }

  _buildCanvasArea() {
    const wrap = document.createElement('div');
    wrap.className = 'pixel-editor-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.className = 'pe-canvas';
    wrap.appendChild(canvas);

    // Scroll proxy overlay for native scrollbars
    const scrollProxy = document.createElement('div');
    scrollProxy.className = 'pe-scroll-proxy';
    const scrollSizer = document.createElement('div');
    scrollSizer.className = 'pe-scroll-sizer';
    scrollProxy.appendChild(scrollSizer);
    wrap.appendChild(scrollProxy);

    this._canvasWrap = wrap;
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._scrollProxy = scrollProxy;
    this._scrollSizer = scrollSizer;

    // Pointer events on scroll proxy (sits on top)
    scrollProxy.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    scrollProxy.addEventListener('pointermove', (e) => this._onPointerMove(e));
    scrollProxy.addEventListener('pointerup', (e) => this._onPointerUp(e));
    scrollProxy.addEventListener('pointerleave', (e) => this._onPointerUp(e));
    scrollProxy.addEventListener('contextmenu', (e) => e.preventDefault());

    // Zoom via wheel
    scrollProxy.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // Sync native scroll to virtual scroll
    scrollProxy.addEventListener('scroll', () => this._onProxyScroll());

    return wrap;
  }

  _buildSidebar() {
    const panel = document.createElement('div');
    panel.className = 'pixel-editor-options-panel';

    // Draggable header
    const panelHeader = document.createElement('div');
    panelHeader.className = 'pe-panel-header';
    const panelTitle = document.createElement('span');
    panelTitle.className = 'pe-panel-title';
    panelTitle.textContent = 'Options';
    panelHeader.appendChild(panelTitle);
    const panelClose = document.createElement('button');
    panelClose.className = 'pe-panel-close';
    panelClose.innerHTML = '&times;';
    panelClose.title = 'Close panel';
    panelClose.addEventListener('click', () => this._toggleOptionsPanel(false));
    panelHeader.appendChild(panelClose);
    panel.appendChild(panelHeader);

    // Drag logic
    let dragging = false, dragX = 0, dragY = 0;
    panelHeader.addEventListener('pointerdown', (e) => {
      if (e.target === panelClose) return;
      dragging = true;
      dragX = e.clientX - panel.offsetLeft;
      dragY = e.clientY - panel.offsetTop;
      panelHeader.setPointerCapture(e.pointerId);
      panelHeader.style.cursor = 'grabbing';
    });
    panelHeader.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const parent = panel.parentElement;
      if (!parent) return;
      const maxX = parent.clientWidth - panel.offsetWidth;
      const maxY = parent.clientHeight - panel.offsetHeight;
      let nx = e.clientX - dragX;
      let ny = e.clientY - dragY;
      nx = Math.max(0, Math.min(nx, maxX));
      ny = Math.max(0, Math.min(ny, maxY));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
      panel.style.right = 'auto';
    });
    panelHeader.addEventListener('pointerup', () => {
      dragging = false;
      panelHeader.style.cursor = '';
    });

    // Panel body (scrollable content)
    const body = document.createElement('div');
    body.className = 'pe-panel-body';

    // Dimensions
    const dimsGroup = document.createElement('div');
    dimsGroup.className = 'pe-sidebar-group';

    const dimsHeader = document.createElement('div');
    dimsHeader.className = 'pe-dims-header';
    const dimsSectionLabel = document.createElement('span');
    dimsSectionLabel.className = 'pe-section-label';
    dimsSectionLabel.textContent = 'Dimensions';
    dimsHeader.appendChild(dimsSectionLabel);
    const dimsEditBtn = document.createElement('button');
    dimsEditBtn.className = 'pe-dims-edit-btn';
    dimsEditBtn.title = 'Resize canvas';
    dimsEditBtn.textContent = '\u270E';
    dimsEditBtn.addEventListener('click', () => this._enterResizeMode());
    dimsHeader.appendChild(dimsEditBtn);
    dimsGroup.appendChild(dimsHeader);

    // Display mode
    const dimsDisplay = document.createElement('span');
    dimsDisplay.className = 'pe-dims-value';
    dimsGroup.appendChild(dimsDisplay);
    this._dimsLabel = dimsDisplay;
    this._dimsDisplay = dimsDisplay;

    // Edit mode (hidden initially)
    const dimsEditArea = document.createElement('div');
    dimsEditArea.className = 'pe-dims-edit-area hidden';
    const dimsInputRow = document.createElement('div');
    dimsInputRow.className = 'pe-dims-input-row';
    const widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.className = 'pe-dims-input';
    widthInput.min = '1';
    widthInput.max = '2048';
    const dimsSep = document.createElement('span');
    dimsSep.className = 'pe-dims-sep';
    dimsSep.textContent = '\u00D7';
    const heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.className = 'pe-dims-input';
    heightInput.min = '1';
    heightInput.max = '2048';
    dimsInputRow.appendChild(widthInput);
    dimsInputRow.appendChild(dimsSep);
    dimsInputRow.appendChild(heightInput);
    dimsEditArea.appendChild(dimsInputRow);

    const dimsBtnRow = document.createElement('div');
    dimsBtnRow.className = 'pe-dims-btn-row';
    const dimsApplyBtn = document.createElement('button');
    dimsApplyBtn.className = 'pe-btn-sm pe-dims-apply';
    dimsApplyBtn.textContent = 'Resize';
    dimsApplyBtn.addEventListener('click', () => this._applyResize());
    const dimsCancelBtn = document.createElement('button');
    dimsCancelBtn.className = 'pe-btn-sm';
    dimsCancelBtn.textContent = 'Cancel';
    dimsCancelBtn.addEventListener('click', () => this._exitResizeMode());
    dimsBtnRow.appendChild(dimsApplyBtn);
    dimsBtnRow.appendChild(dimsCancelBtn);
    dimsEditArea.appendChild(dimsBtnRow);
    dimsGroup.appendChild(dimsEditArea);
    this._dimsEditArea = dimsEditArea;
    this._dimsEditBtn = dimsEditBtn;
    this._widthInput = widthInput;
    this._heightInput = heightInput;

    // Handle keyboard in resize inputs
    const handleResizeKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this._applyResize();
      if (e.key === 'Escape') this._exitResizeMode();
    };
    widthInput.addEventListener('keydown', handleResizeKey);
    heightInput.addEventListener('keydown', handleResizeKey);

    body.appendChild(dimsGroup);

    // Coordinates
    const coordsGroup = document.createElement('div');
    coordsGroup.className = 'pe-sidebar-group';
    coordsGroup.innerHTML = '<span class="pe-section-label">Cursor</span>';
    const coordsLabel = document.createElement('span');
    coordsLabel.className = 'pe-coords-value';
    coordsLabel.textContent = '—';
    coordsGroup.appendChild(coordsLabel);
    body.appendChild(coordsGroup);
    this._coordsLabel = coordsLabel;

    // Selection size
    const selGroup = document.createElement('div');
    selGroup.className = 'pe-sidebar-group';
    selGroup.innerHTML = '<span class="pe-section-label">Selection</span>';
    const selLabel = document.createElement('span');
    selLabel.className = 'pe-coords-value';
    selLabel.textContent = '\u2014';
    selGroup.appendChild(selLabel);
    body.appendChild(selGroup);
    this._selSizeLabel = selLabel;

    // Zoom
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'pe-sidebar-group';
    zoomGroup.innerHTML = '<span class="pe-section-label">Zoom</span>';
    const zoomRow = document.createElement('div');
    zoomRow.className = 'pe-zoom-row';
    const zoomMinus = document.createElement('button');
    zoomMinus.className = 'pe-zoom-btn';
    zoomMinus.textContent = '\u2212';
    zoomMinus.addEventListener('click', () => this._zoomStep(-1));
    const zoomPlus = document.createElement('button');
    zoomPlus.className = 'pe-zoom-btn';
    zoomPlus.textContent = '+';
    zoomPlus.addEventListener('click', () => this._zoomStep(1));
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'pe-zoom-value';
    this._zoomLabel = zoomLabel;
    zoomRow.appendChild(zoomMinus);
    zoomRow.appendChild(zoomLabel);
    zoomRow.appendChild(zoomPlus);
    zoomGroup.appendChild(zoomRow);

    const fitBtn = document.createElement('button');
    fitBtn.className = 'pe-btn-sm';
    fitBtn.textContent = 'Fit';
    fitBtn.addEventListener('click', () => {
      this._autoFitZoom();
      this._centerScroll();
      this._updateZoomLabel();
      this._requestRender();
    });
    zoomGroup.appendChild(fitBtn);

    const zoomHint = document.createElement('div');
    zoomHint.className = 'pe-zoom-hint';
    zoomHint.textContent = 'Ctrl + Mouse Wheel to Zoom';
    zoomGroup.appendChild(zoomHint);
    body.appendChild(zoomGroup);

    // Grid toggle
    const gridGroup = document.createElement('div');
    gridGroup.className = 'pe-sidebar-group';
    const gridLabel = document.createElement('label');
    gridLabel.className = 'pe-checkbox-label';
    const gridCb = document.createElement('input');
    gridCb.type = 'checkbox';
    gridCb.checked = true;
    gridCb.addEventListener('change', () => {
      this._showGrid = gridCb.checked;
      this._requestRender();
    });
    gridLabel.appendChild(gridCb);
    gridLabel.appendChild(document.createTextNode(' Pixel grid'));
    gridGroup.appendChild(gridLabel);
    body.appendChild(gridGroup);

    // Top Left Origin toggle
    const originGroup = document.createElement('div');
    originGroup.className = 'pe-sidebar-group';
    const originLabel = document.createElement('label');
    originLabel.className = 'pe-checkbox-label';
    const originCb = document.createElement('input');
    originCb.type = 'checkbox';
    originCb.checked = false;
    originCb.addEventListener('change', () => {
      this._topLeftOrigin = originCb.checked;
      this._updateScrollLayout();
      if (!this._topLeftOrigin) {
        this._centerScroll();
      }
      this._requestRender();
    });
    originLabel.appendChild(originCb);
    originLabel.appendChild(document.createTextNode(' Top Left Origin'));
    originGroup.appendChild(originLabel);
    body.appendChild(originGroup);

    // Threshold
    const thGroup = document.createElement('div');
    thGroup.className = 'pe-sidebar-group';
    thGroup.innerHTML = '<span class="pe-section-label">Threshold</span>';
    const thSliderWrap = document.createElement('div');
    thSliderWrap.className = 'pe-threshold-track';
    const thSlider = document.createElement('input');
    thSlider.type = 'range';
    thSlider.min = '0';
    thSlider.max = '255';
    thSlider.value = '128';
    thSlider.className = 'pe-threshold-slider';
    const thLabel = document.createElement('span');
    thLabel.className = 'pe-threshold-value';
    thLabel.textContent = '128';
    const updateThumbPos = () => {
      const val = parseInt(thSlider.value, 10);
      const pct = val / 255;
      thLabel.style.left = `calc(${pct * 100}% + ${(0.5 - pct) * 14}px)`;
    };
    thSlider.addEventListener('input', () => {
      const val = parseInt(thSlider.value, 10);
      this._threshold = val;
      thLabel.textContent = val;
      updateThumbPos();
      this._applyThreshold(val);
    });
    thSliderWrap.appendChild(thSlider);
    thSliderWrap.appendChild(thLabel);
    thGroup.appendChild(thSliderWrap);
    body.appendChild(thGroup);
    this._thresholdSlider = thSlider;
    this._thresholdLabel = thLabel;
    this._updateThresholdPos = updateThumbPos;

    panel.appendChild(body);
    this._optionsPanel = panel;
    return panel;
  }

  _buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'pixel-editor-footer';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'pe-footer-left';

    const importBtn = document.createElement('button');
    importBtn.className = 'btn btn-secondary btn-sm';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => this._importImage());
    leftGroup.appendChild(importBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-secondary btn-sm';
    exportBtn.textContent = 'Export PNG';
    exportBtn.addEventListener('click', () => this._exportPNG());
    leftGroup.appendChild(exportBtn);

    // Hidden file input for import
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this._handleImportFile(file);
      fileInput.value = '';
    });
    leftGroup.appendChild(fileInput);
    this._fileInput = fileInput;

    footer.appendChild(leftGroup);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'pe-footer-right';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());
    rightGroup.appendChild(cancelBtn);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary btn-sm';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => this._apply());
    rightGroup.appendChild(applyBtn);

    footer.appendChild(rightGroup);
    return footer;
  }

  _createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'pe-separator';
    return sep;
  }

  _createSeparatorV() {
    const sep = document.createElement('div');
    sep.className = 'pe-separator-v';
    return sep;
  }


  // ── Close / Apply ──────────────────────────────────────────────────────────

  _doClose() {
    this._open = false;
    this._overlay.classList.remove('visible');
    setTimeout(() => this._overlay.classList.add('hidden'), 200);
    document.removeEventListener('keydown', this._boundKeyDown);
    document.removeEventListener('paste', this._boundPaste);
    this._stopSelectionAnim();
    this._clearTextState();
    this._toggleFontPanel(false);
    this._opts?.onClose?.();
  }

  _apply() {
    const outImageData = this._buildOutputImageData();
    this._opts?.onSave?.(outImageData, { threshold: this._threshold });
    this._dirty = false;
    this._doClose();
  }


  // ── Canvas resize ─────────────────────────────────────────────────────────

  _enterResizeMode() {
    this._widthInput.value = this._width;
    this._heightInput.value = this._height;
    this._dimsDisplay.classList.add('hidden');
    this._dimsEditBtn.classList.add('hidden');
    this._dimsEditArea.classList.remove('hidden');
    this._widthInput.focus();
    this._widthInput.select();
  }

  _exitResizeMode() {
    if (!this._dimsEditArea) return;
    this._dimsDisplay.classList.remove('hidden');
    if (!this._opts || !this._opts.hideResize) this._dimsEditBtn.classList.remove('hidden');
    this._dimsEditArea.classList.add('hidden');
  }

  _applyResize() {
    const newW = parseInt(this._widthInput.value, 10);
    const newH = parseInt(this._heightInput.value, 10);
    if (!newW || !newH || newW < 1 || newH < 1 || newW > 2048 || newH > 2048) {
      showToast('Dimensions must be between 1 and 2048', 'error');
      return;
    }
    if (newW === this._width && newH === this._height) {
      this._exitResizeMode();
      return;
    }
    this._resizeTo(newW, newH);
    this._exitResizeMode();
    showToast(`Canvas resized to ${newW} \u00D7 ${newH}`, 'success');
  }

  _resizeTo(newW, newH) {
    if (newW === this._width && newH === this._height) return;
    this._pushUndo();

    // Initialize or update backing store
    if (!this._backingPixels) {
      this._backingWidth = this._width;
      this._backingHeight = this._height;
      this._backingPixels = new Uint8Array(this._pixels);
      this._backingMask = new Uint8Array(this._editedMask);
      this._backingSource = new ImageData(
        new Uint8ClampedArray(this._sourceImageData.data),
        this._sourceImageData.width,
        this._sourceImageData.height,
      );
    } else {
      this._syncToBacking();
    }

    // Expand backing if new dimensions exceed it
    const bw = Math.max(this._backingWidth, newW);
    const bh = Math.max(this._backingHeight, newH);
    if (bw > this._backingWidth || bh > this._backingHeight) {
      this._expandBacking(bw, bh);
    }

    // Build new pixel arrays from backing
    const newPixels = new Uint8Array(newW * newH);
    const newMask = new Uint8Array(newW * newH);
    const newSource = new ImageData(newW, newH);

    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const ni = y * newW + x;
        if (x < this._backingWidth && y < this._backingHeight) {
          const bi = y * this._backingWidth + x;
          newPixels[ni] = this._backingPixels[bi];
          newMask[ni] = this._backingMask[bi];
          const nsi = ni * 4;
          const bsi = bi * 4;
          newSource.data[nsi] = this._backingSource.data[bsi];
          newSource.data[nsi + 1] = this._backingSource.data[bsi + 1];
          newSource.data[nsi + 2] = this._backingSource.data[bsi + 2];
          newSource.data[nsi + 3] = this._backingSource.data[bsi + 3];
        } else {
          newPixels[ni] = COLOR_BLACK;
          newMask[ni] = 1;
          const nsi = ni * 4;
          newSource.data[nsi + 3] = 255;
        }
      }
    }

    this._width = newW;
    this._height = newH;
    this._pixels = newPixels;
    this._editedMask = newMask;
    this._sourceImageData = newSource;

    this._dimsLabel.textContent = `${newW} \u00D7 ${newH}`;
    this._resizeCanvas();
    this._autoFitZoom();
    this._updateScrollLayout();
    this._centerScroll();
    this._updateZoomLabel();
    this._dirty = true;
    this._requestRender();
  }

  _syncToBacking() {
    const overlapW = Math.min(this._width, this._backingWidth);
    const overlapH = Math.min(this._height, this._backingHeight);
    for (let y = 0; y < overlapH; y++) {
      for (let x = 0; x < overlapW; x++) {
        const ci = y * this._width + x;
        const bi = y * this._backingWidth + x;
        this._backingPixels[bi] = this._pixels[ci];
        this._backingMask[bi] = this._editedMask[ci];
        const csi = ci * 4;
        const bsi = bi * 4;
        this._backingSource.data[bsi] = this._sourceImageData.data[csi];
        this._backingSource.data[bsi + 1] = this._sourceImageData.data[csi + 1];
        this._backingSource.data[bsi + 2] = this._sourceImageData.data[csi + 2];
        this._backingSource.data[bsi + 3] = this._sourceImageData.data[csi + 3];
      }
    }
  }

  _expandBacking(newBW, newBH) {
    const newPx = new Uint8Array(newBW * newBH);
    const newMask = new Uint8Array(newBW * newBH);
    const newSrc = new ImageData(newBW, newBH);

    for (let y = 0; y < this._backingHeight; y++) {
      for (let x = 0; x < this._backingWidth; x++) {
        const oi = y * this._backingWidth + x;
        const ni = y * newBW + x;
        newPx[ni] = this._backingPixels[oi];
        newMask[ni] = this._backingMask[oi];
        const osi = oi * 4;
        const nsi = ni * 4;
        newSrc.data[nsi] = this._backingSource.data[osi];
        newSrc.data[nsi + 1] = this._backingSource.data[osi + 1];
        newSrc.data[nsi + 2] = this._backingSource.data[osi + 2];
        newSrc.data[nsi + 3] = this._backingSource.data[osi + 3];
      }
    }

    // New areas: opaque black
    for (let y = 0; y < newBH; y++) {
      for (let x = 0; x < newBW; x++) {
        if (x >= this._backingWidth || y >= this._backingHeight) {
          const ni = y * newBW + x;
          newPx[ni] = COLOR_BLACK;
          newMask[ni] = 1;
          const nsi = ni * 4;
          newSrc.data[nsi + 3] = 255;
        }
      }
    }

    this._backingPixels = newPx;
    this._backingMask = newMask;
    this._backingSource = newSrc;
    this._backingWidth = newBW;
    this._backingHeight = newBH;
  }


  // ── Image model ────────────────────────────────────────────────────────────

  _derivePixelsFromSource(threshold) {
    const src = this._sourceImageData.data;
    const len = this._width * this._height;
    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      if (src[idx + 3] < 128) {
        this._pixels[i] = this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK;
      } else {
        this._pixels[i] = src[idx + 1] > threshold ? COLOR_WHITE : COLOR_BLACK;
      }
    }
  }

  _applyThreshold(newThreshold) {
    this._threshold = newThreshold;
    const src = this._sourceImageData.data;
    const len = this._width * this._height;
    for (let i = 0; i < len; i++) {
      if (this._editedMask[i]) continue;
      const idx = i * 4;
      if (src[idx + 3] < 128) {
        this._pixels[i] = this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK;
      } else {
        this._pixels[i] = src[idx + 1] > newThreshold ? COLOR_WHITE : COLOR_BLACK;
      }
    }
    this._requestRender();
    this._opts?.onThresholdChange?.(newThreshold);
  }

  _buildOutputImageData() {
    const out = new ImageData(this._width, this._height);
    const dst = out.data;
    for (let i = 0; i < this._width * this._height; i++) {
      const idx = i * 4;
      const v = this._pixels[i];
      if (v === COLOR_WHITE) {
        dst[idx] = 255; dst[idx + 1] = 255; dst[idx + 2] = 255; dst[idx + 3] = 255;
      } else if (v === COLOR_TRANSPARENT) {
        dst[idx] = 0; dst[idx + 1] = 0; dst[idx + 2] = 0; dst[idx + 3] = 0;
      } else {
        dst[idx] = 0; dst[idx + 1] = 0; dst[idx + 2] = 0; dst[idx + 3] = 255;
      }
    }
    return out;
  }


  // ── Canvas rendering ───────────────────────────────────────────────────────

  _resizeCanvas() {
    if (!this._canvasWrap || !this._canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this._canvasWrap.getBoundingClientRect();
    const cw = Math.floor(rect.width);
    const ch = Math.floor(rect.height);
    this._canvas.width = cw * dpr;
    this._canvas.height = ch * dpr;
    this._canvas.style.width = cw + 'px';
    this._canvas.style.height = ch + 'px';
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _requestRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      this._render();
    });
  }

  _render() {
    // Update selection size label
    if (this._selSizeLabel) {
      this._selSizeLabel.textContent = this._selection
        ? `${this._selection.w} \u00D7 ${this._selection.h}`
        : '\u2014';
    }

    const ctx = this._ctx;
    const cw = this._scrollProxy ? this._scrollProxy.clientWidth : this._canvasWrap.clientWidth;
    const ch = this._scrollProxy ? this._scrollProxy.clientHeight : this._canvasWrap.clientHeight;
    const z = this._zoom;

    // Clear
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, cw, ch);

    // Apply centering offset
    const { x: offX, y: offY } = this._getCenterOffset();
    ctx.save();
    ctx.translate(offX, offY);

    // Visible pixel range
    const startX = Math.max(0, Math.floor(this._scrollX));
    const startY = Math.max(0, Math.floor(this._scrollY));
    const endX = Math.min(this._width, Math.ceil(this._scrollX + cw / z));
    const endY = Math.min(this._height, Math.ceil(this._scrollY + ch / z));

    // Draw pixels
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const pv = this._pixels[y * this._width + x];
        ctx.fillStyle = DISPLAY_COLORS[pv];
        const sx = Math.floor((x - this._scrollX) * z);
        const sy = Math.floor((y - this._scrollY) * z);
        const sw = Math.ceil(z);
        const sh = Math.ceil(z);
        ctx.fillRect(sx, sy, sw, sh);
      }
    }

    // Draw tool preview overlay
    if (this._previewPixels) {
      for (const [key, color] of this._previewPixels) {
        const [px, py] = key.split(',').map(Number);
        if (px < startX || px >= endX || py < startY || py >= endY) continue;
        ctx.fillStyle = DISPLAY_COLORS[color];
        ctx.fillRect(
          Math.floor((px - this._scrollX) * z),
          Math.floor((py - this._scrollY) * z),
          Math.ceil(z), Math.ceil(z),
        );
      }
    }

    // Draw brush outline preview (purple overlay)
    if (this._brushOutlinePreview) {
      ctx.fillStyle = '#A84DD4';
      ctx.globalAlpha = 0.35;
      for (const [key] of this._brushOutlinePreview) {
        const [px, py] = key.split(',').map(Number);
        if (px < startX || px >= endX || py < startY || py >= endY) continue;
        ctx.fillRect(
          Math.floor((px - this._scrollX) * z),
          Math.floor((py - this._scrollY) * z),
          Math.ceil(z), Math.ceil(z),
        );
      }
      ctx.globalAlpha = 1;
    }

    // Draw floating paste
    if (this._floatingPaste) {
      const fp = this._floatingPaste;
      for (let fy = 0; fy < fp.h; fy++) {
        for (let fx = 0; fx < fp.w; fx++) {
          const px = fp.x + fx;
          const py = fp.y + fy;
          if (px < startX || px >= endX || py < startY || py >= endY) continue;
          const pv = fp.pixels[fy * fp.w + fx];
          if (pv === COLOR_TRANSPARENT) continue; // transparent paste pixels don't overwrite
          ctx.fillStyle = DISPLAY_COLORS[pv];
          ctx.fillRect(
            Math.floor((px - this._scrollX) * z),
            Math.floor((py - this._scrollY) * z),
            Math.ceil(z), Math.ceil(z),
          );
        }
      }
      // Paste outline
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this._selectionAnimOffset;
      ctx.strokeRect(
        Math.floor((fp.x - this._scrollX) * z),
        Math.floor((fp.y - this._scrollY) * z),
        fp.w * z,
        fp.h * z,
      );
      ctx.setLineDash([]);
    }

    // Draw text tool preview
    if (this._activeTool === 'text' && this._textCursorPos && this._textFont) {
      const tp = this._textCursorPos;
      // Draw typed text as preview pixels
      if (this._textBuffer) {
        const textPixels = getTextPixels(this._textFont, this._textBuffer, tp.x, tp.y);
        ctx.fillStyle = DISPLAY_COLORS[this._activeColor] || DISPLAY_COLORS[COLOR_WHITE];
        for (const p of textPixels) {
          if (p.x < startX || p.x >= endX || p.y < startY || p.y >= endY) continue;
          ctx.fillRect(
            Math.floor((p.x - this._scrollX) * z),
            Math.floor((p.y - this._scrollY) * z),
            Math.ceil(z), Math.ceil(z),
          );
        }
      }
      // Draw blinking cursor
      if (this._textCursorVisible) {
        const measured = this._textBuffer ? measureText(this._textFont, this._textBuffer) : { width: 0, maxY: this._textFont.maxTop + 2, minY: 0 };
        const cursorX = tp.x + measured.width;
        const cursorHeight = Math.max(measured.maxY - measured.minY, this._textFont.maxTop + 2);
        ctx.fillStyle = DISPLAY_COLORS[this._activeColor] || DISPLAY_COLORS[COLOR_WHITE];
        ctx.globalAlpha = 0.8;
        ctx.fillRect(
          Math.floor((cursorX - this._scrollX) * z),
          Math.floor((tp.y - this._scrollY) * z),
          Math.max(Math.ceil(z / 4), 1),
          cursorHeight * Math.ceil(z),
        );
        ctx.globalAlpha = 1;
      }
    }

    // Draw grid
    if (this._showGrid && z >= 4) {
      const drawGridLines = () => {
        // Vertical lines
        for (let x = startX; x <= endX; x++) {
          const sx = Math.floor((x - this._scrollX) * z) + 0.5;
          ctx.beginPath();
          ctx.moveTo(sx, Math.floor((startY - this._scrollY) * z));
          ctx.lineTo(sx, Math.floor((endY - this._scrollY) * z));
          ctx.stroke();
        }
        // Horizontal lines
        for (let y = startY; y <= endY; y++) {
          const sy = Math.floor((y - this._scrollY) * z) + 0.5;
          ctx.beginPath();
          ctx.moveTo(Math.floor((startX - this._scrollX) * z), sy);
          ctx.lineTo(Math.floor((endX - this._scrollX) * z), sy);
          ctx.stroke();
        }
      };

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.24)';
      drawGridLines();
      ctx.strokeStyle = GRID_COLOR;
      drawGridLines();
    }

    // Draw selection marquee
    if (this._selection) {
      const s = this._selection;
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this._selectionAnimOffset;
      ctx.strokeRect(
        Math.floor((s.x - this._scrollX) * z),
        Math.floor((s.y - this._scrollY) * z),
        s.w * z,
        s.h * z,
      );
      ctx.setLineDash([]);
    }

    ctx.restore();
  }


  // ── Zoom / Scroll ──────────────────────────────────────────────────────────

  _autoFitZoom() {
    if (!this._canvasWrap) return;
    const cw = this._scrollProxy ? this._scrollProxy.clientWidth : this._canvasWrap.clientWidth;
    const ch = this._scrollProxy ? this._scrollProxy.clientHeight : this._canvasWrap.clientHeight;
    const fitZoom = Math.min(cw / this._width, ch / this._height);
    // Snap to nearest level that fits
    let best = ZOOM_LEVELS[0];
    for (const z of ZOOM_LEVELS) {
      if (z <= fitZoom) best = z;
    }
    this._zoom = best;
  }

  _centerScroll() {
    if (!this._canvasWrap) return;
    const cw = this._scrollProxy ? this._scrollProxy.clientWidth : this._canvasWrap.clientWidth;
    const ch = this._scrollProxy ? this._scrollProxy.clientHeight : this._canvasWrap.clientHeight;
    const imgW = this._width * this._zoom;
    const imgH = this._height * this._zoom;
    this._scrollX = imgW > cw ? (this._width / 2 - cw / (2 * this._zoom)) : 0;
    this._scrollY = imgH > ch ? (this._height / 2 - ch / (2 * this._zoom)) : 0;
    this._clampScroll();
  }

  _clampScroll() {
    if (!this._canvasWrap) return;
    const cw = this._scrollProxy ? this._scrollProxy.clientWidth : this._canvasWrap.clientWidth;
    const ch = this._scrollProxy ? this._scrollProxy.clientHeight : this._canvasWrap.clientHeight;
    const maxScrollX = Math.max(0, this._width - cw / this._zoom);
    const maxScrollY = Math.max(0, this._height - ch / this._zoom);
    this._scrollX = Math.max(0, Math.min(maxScrollX, this._scrollX));
    this._scrollY = Math.max(0, Math.min(maxScrollY, this._scrollY));
    this._syncScrollToProxy();
  }

  _zoomStep(dir) {
    const idx = ZOOM_LEVELS.indexOf(this._zoom);
    let newIdx = idx + dir;
    if (idx < 0) {
      // Not on a standard level, find closest
      newIdx = dir > 0
        ? ZOOM_LEVELS.findIndex((z) => z > this._zoom)
        : ZOOM_LEVELS.findLastIndex((z) => z < this._zoom);
      if (newIdx < 0) newIdx = dir > 0 ? ZOOM_LEVELS.length - 1 : 0;
    }
    newIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, newIdx));
    this._zoom = ZOOM_LEVELS[newIdx];
    this._updateScrollLayout();
    this._clampScroll();
    this._updateZoomLabel();
    this._requestRender();
  }

  _zoomAtPoint(dir, clientX, clientY) {
    const proxy = this._scrollProxy || this._canvasWrap;
    const rect = proxy.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const { x: offX, y: offY } = this._getCenterOffset();
    // Image coordinate under cursor before zoom
    const imgX = this._scrollX + (mx - offX) / this._zoom;
    const imgY = this._scrollY + (my - offY) / this._zoom;

    this._zoomStep(dir);

    // Adjust scroll so that imgX/imgY stays under cursor
    const newOff = this._getCenterOffset();
    this._scrollX = imgX - (mx - newOff.x) / this._zoom;
    this._scrollY = imgY - (my - newOff.y) / this._zoom;
    this._clampScroll();
    this._requestRender();
  }

  _updateZoomLabel() {
    if (this._zoomLabel) this._zoomLabel.textContent = `${this._zoom}x`;
  }


  // ── Pointer events ─────────────────────────────────────────────────────────

  _canvasToPixel(clientX, clientY) {
    const proxy = this._scrollProxy || this._canvasWrap;
    const rect = proxy.getBoundingClientRect();
    const { x: offX, y: offY } = this._getCenterOffset();
    const x = Math.floor((clientX - rect.left - offX) / this._zoom + this._scrollX);
    const y = Math.floor((clientY - rect.top - offY) / this._zoom + this._scrollY);
    return { x, y };
  }

  _inBounds(x, y) {
    return x >= 0 && x < this._width && y >= 0 && y < this._height;
  }

  _toggleMaximize() {
    this._maximized = !this._maximized;
    this._modal.classList.toggle('pe-maximized', this._maximized);
    if (this._maximized) {
      this._maximizeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="1" width="10" height="10" rx="1.5"/><path d="M3 3H1.5A.5.5 0 001 3.5V13a.5.5 0 00.5.5H11a.5.5 0 00.5-.5V11"/></svg>';
      this._maximizeBtn.title = 'Restore';
    } else {
      this._maximizeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="1" width="12" height="12" rx="1.5"/></svg>';
      this._maximizeBtn.title = 'Maximize';
    }
    this._resizeCanvas();
    this._requestRender();
  }

  _inDrawArea(x, y) {
    if (!this._inBounds(x, y)) return false;
    if (this._selection) {
      const s = this._selection;
      return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
    }
    return true;
  }

  _onPointerDown(e) {
    // Middle mouse for scroll
    if (e.button === 1) {
      e.preventDefault();
      this._midDragging = true;
      this._midDragStart = { x: e.clientX, y: e.clientY };
      const proxy = this._scrollProxy || this._canvasWrap;
      this._midScrollStart = { x: proxy.scrollLeft, y: proxy.scrollTop };
      proxy.setPointerCapture(e.pointerId);
      return;
    }

    // Right-click with pencil tool → invert pixel
    this._pencilInvert = false;
    if (e.button === 2 && this._activeTool === 'pencil') {
      // allow through
    } else if (e.button !== 0) return;

    const { x, y } = this._canvasToPixel(e.clientX, e.clientY);

    // If floating paste, click outside → commit
    if (this._floatingPaste && this._activeTool !== 'select') {
      this._commitFloatingPaste();
    }

    // If floating paste, check if clicking inside it for dragging
    if (this._floatingPaste) {
      const fp = this._floatingPaste;
      if (x >= fp.x && x < fp.x + fp.w && y >= fp.y && y < fp.y + fp.h) {
        this._pasteDragging = true;
        this._pasteDragOffset = { x: x - fp.x, y: y - fp.y };
        (this._scrollProxy || this._canvasWrap).setPointerCapture(e.pointerId);
        this._updateCursor(e.clientX, e.clientY);
        return;
      } else {
        this._commitFloatingPaste();
      }
    }

    this._drawing = true;
    (this._scrollProxy || this._canvasWrap).setPointerCapture(e.pointerId);

    const tool = this._activeTool;

    if (tool === 'pencil') {
      this._pencilInvert = e.button === 2;
      if (this._pencilInvert) {
        const cur = this._getPixel(x, y);
        if (cur === COLOR_TRANSPARENT || cur === -1) { this._drawing = false; return; }
        this._pencilInvertColor = cur === COLOR_BLACK ? COLOR_WHITE : COLOR_BLACK;
      }
      this._pushUndo();
      const color = this._pencilInvert ? this._pencilInvertColor : this._activeColor;
      this._setPixel(x, y, color);
      this._lastPixel = { x, y };
      this._requestRender();
    } else if (tool === 'brush') {
      this._pushUndo();
      this._stampBrush(x, y);
      this._lastPixel = { x, y };
      this._requestRender();
    } else if (tool === 'line' || tool === 'rect' || tool === 'circle') {
      this._pushUndo();
      this._dragStart = { x, y };
      this._previewPixels = new Map();
    } else if (tool === 'fill') {
      this._pushUndo();
      this._floodFill(x, y);
      this._requestRender();
      this._drawing = false;
    } else if (tool === 'select') {
      // If clicking inside existing selection, lift it into a floating paste for dragging
      if (this._selection) {
        const s = this._selection;
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
          this._pushUndo();
          const pixels = new Uint8Array(s.w * s.h);
          for (let sy = 0; sy < s.h; sy++) {
            for (let sx = 0; sx < s.w; sx++) {
              pixels[sy * s.w + sx] = this._getPixel(s.x + sx, s.y + sy);
            }
          }
          this._fillSelection(this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK);
          this._floatingPaste = { x: s.x, y: s.y, w: s.w, h: s.h, pixels };
          this._selection = null;
          this._pasteDragging = true;
          this._pasteDragOffset = { x: x - s.x, y: y - s.y };
          this._drawing = false;
          this._updateCursor(e.clientX, e.clientY);
          this._requestRender();
          return;
        }
      }
      this._selection = null;
      this._dragStart = { x, y };
      this._requestRender();
    } else if (tool === 'text') {
      // If text is already placed, check if clicking inside text bounding box to drag
      if (this._textCursorPos && this._textFont) {
        const tp = this._textCursorPos;
        const measured = this._textBuffer
          ? measureText(this._textFont, this._textBuffer)
          : { width: 1, maxY: this._textFont.maxTop + 2, minY: 0 };
        const textW = Math.max(measured.width, 1);
        const textH = Math.max(measured.maxY - measured.minY, this._textFont.maxTop + 2);
        if (x >= tp.x && x < tp.x + textW && y >= tp.y && y < tp.y + textH) {
          // Start dragging the text
          this._textDragging = true;
          this._textDragOffset = { x: x - tp.x, y: y - tp.y };
          (this._scrollProxy || this._canvasWrap).setPointerCapture(e.pointerId);
          this._drawing = false;
          return;
        }
        // Clicked outside text — commit existing text first
        if (this._textBuffer) {
          this._commitText();
        } else {
          this._clearTextState();
        }
      }
      // Place cursor at clicked pixel
      this._textCursorPos = { x, y };
      this._textBuffer = '';
      this._startTextCursorBlink();
      this._drawing = false;
      this._requestRender();
    }
  }

  _onPointerMove(e) {
    const { x, y } = this._canvasToPixel(e.clientX, e.clientY);

    // Update coords display
    if (this._inBounds(x, y)) {
      this._coordsLabel.textContent = `${x}, ${y}`;
    } else {
      this._coordsLabel.textContent = '\u2014';
    }

    // Track last pointer position and update cursor
    this._lastClientX = e.clientX;
    this._lastClientY = e.clientY;
    this._updateCursor(e.clientX, e.clientY);

    // Update brush outline preview (shown even when not drawing)
    if (this._activeTool === 'brush') {
      if (this._inBounds(x, y)) {
        this._updateBrushOutlinePreview(x, y);
        this._requestRender();
      } else {
        this._brushOutlinePreview = null;
        this._requestRender();
      }
    }

    // Update pencil outline preview (single pixel)
    if (this._activeTool === 'pencil' || this._activeTool === 'line' || this._activeTool === 'rect' || this._activeTool === 'circle' || this._activeTool === 'fill') {
      if (this._inBounds(x, y)) {
        this._brushOutlinePreview = new Map();
        this._brushOutlinePreview.set(`${x},${y}`, true);
        this._requestRender();
      } else {
        this._brushOutlinePreview = null;
        this._requestRender();
      }
    }

    // Middle-mouse drag scrolling
    if (this._midDragging) {
      const proxy = this._scrollProxy || this._canvasWrap;
      const dx = e.clientX - this._midDragStart.x;
      const dy = e.clientY - this._midDragStart.y;
      proxy.scrollLeft = this._midScrollStart.x - dx;
      proxy.scrollTop = this._midScrollStart.y - dy;
      return;
    }

    // Floating paste drag
    if (this._pasteDragging && this._floatingPaste) {
      this._floatingPaste.x = x - this._pasteDragOffset.x;
      this._floatingPaste.y = y - this._pasteDragOffset.y;
      this._requestRender();
      return;
    }

    // Text drag
    if (this._textDragging && this._textCursorPos) {
      this._textCursorPos.x = x - this._textDragOffset.x;
      this._textCursorPos.y = y - this._textDragOffset.y;
      this._requestRender();
      return;
    }

    if (!this._drawing) return;

    const tool = this._activeTool;

    if (tool === 'pencil') {
      if (this._lastPixel) {
        const color = this._pencilInvert ? this._pencilInvertColor : this._activeColor;
        this._bresenham(this._lastPixel.x, this._lastPixel.y, x, y, (px, py) => {
          this._setPixel(px, py, color);
        });
      }
      this._lastPixel = { x, y };
      this._requestRender();
    } else if (tool === 'brush') {
      if (this._lastPixel) {
        this._bresenham(this._lastPixel.x, this._lastPixel.y, x, y, (px, py) => {
          this._stampBrush(px, py);
        });
      }
      this._lastPixel = { x, y };
      this._requestRender();
    } else if (tool === 'line') {
      this._previewPixels = new Map();
      let lx = x, ly = y;
      if (e.shiftKey) {
        const dx = Math.abs(x - this._dragStart.x);
        const dy = Math.abs(y - this._dragStart.y);
        if (dx >= dy) {
          ly = this._dragStart.y; // horizontal
        } else {
          lx = this._dragStart.x; // vertical
        }
      }
      this._bresenhamPreviewThick(this._dragStart.x, this._dragStart.y, lx, ly, this._activeColor, this._lineThickness);
      this._requestRender();
    } else if (tool === 'rect') {
      this._previewPixels = new Map();
      const sx = this._dragStart.x, sy = this._dragStart.y;
      let x0 = sx, y0 = sy, x1 = x, y1 = y;
      if (e.shiftKey) {
        const dx = x - sx, dy = y - sy;
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = sx + side * Math.sign(dx || 1);
        y1 = sy + side * Math.sign(dy || 1);
      }
      if (e.altKey) {
        // Alt: expand from center
        const dx = x1 - sx, dy = y1 - sy;
        x0 = sx - dx;
        y0 = sy - dy;
        x1 = sx + dx;
        y1 = sy + dy;
      }
      this._previewRect(x0, y0, x1, y1, this._activeColor, this._shapeFilled);
      this._requestRender();
    } else if (tool === 'circle') {
      this._previewPixels = new Map();
      const sx = this._dragStart.x, sy = this._dragStart.y;
      let ctrX, ctrY, erx, ery;
      if (e.altKey) {
        // Alt: circle expanding from center (legacy behavior)
        erx = Math.max(Math.abs(x - sx), Math.abs(y - sy));
        ery = erx;
        ctrX = sx;
        ctrY = sy;
      } else if (e.shiftKey) {
        // Shift: circle from top-left corner
        const side = Math.max(Math.abs(x - sx), Math.abs(y - sy));
        const ex = sx + side * Math.sign((x - sx) || 1);
        const ey = sy + side * Math.sign((y - sy) || 1);
        ctrX = (sx + ex) / 2;
        ctrY = (sy + ey) / 2;
        erx = Math.abs(ex - sx) / 2;
        ery = erx;
      } else {
        // Default: ellipse from top-left corner
        ctrX = (sx + x) / 2;
        ctrY = (sy + y) / 2;
        erx = Math.abs(x - sx) / 2;
        ery = Math.abs(y - sy) / 2;
      }
      this._previewEllipse(ctrX, ctrY, erx, ery, this._activeColor, this._shapeFilled);
      this._requestRender();
    } else if (tool === 'select' && this._dragStart) {
      const sx = Math.min(this._dragStart.x, x);
      const sy = Math.min(this._dragStart.y, y);
      const ex = Math.max(this._dragStart.x, x);
      const ey = Math.max(this._dragStart.y, y);
      this._selection = {
        x: Math.max(0, sx),
        y: Math.max(0, sy),
        w: Math.min(this._width, ex + 1) - Math.max(0, sx),
        h: Math.min(this._height, ey + 1) - Math.max(0, sy),
      };
      this._requestRender();
    }
  }

  _onPointerUp(e) {
    if (this._midDragging) {
      this._midDragging = false;
      return;
    }

    if (this._pasteDragging) {
      this._pasteDragging = false;
      this._updateCursor(e.clientX, e.clientY);
      return;
    }

    if (this._textDragging) {
      this._textDragging = false;
      return;
    }

    if (!this._drawing) return;
    this._drawing = false;

    const tool = this._activeTool;

    if (tool === 'pencil' || tool === 'brush') {
      this._lastPixel = null;
      this._dirty = true;
    } else if (tool === 'line' || tool === 'rect' || tool === 'circle') {
      // Commit preview
      if (this._previewPixels) {
        for (const [key, color] of this._previewPixels) {
          const [px, py] = key.split(',').map(Number);
          this._setPixel(px, py, color);
        }
        this._previewPixels = null;
        this._dirty = true;
      }
      this._dragStart = null;
      this._requestRender();
    } else if (tool === 'select') {
      this._dragStart = null;
    }
  }

  _onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      // Zoom — prevent default browser zoom
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      this._zoomAtPoint(dir, e.clientX, e.clientY);
    }
    // Regular wheel scroll is handled natively by the scroll proxy
  }

  _updateCursor(clientX, clientY) {
    const proxy = this._scrollProxy || this._canvasWrap;
    if (!proxy) return;

    if (this._pasteDragging || this._textDragging) {
      proxy.style.cursor = 'grabbing';
      return;
    }

    const { x, y } = this._canvasToPixel(clientX, clientY);
    const overCanvas = this._inBounds(x, y);

    // Check if over floating paste (any tool)
    if (this._floatingPaste) {
      const fp = this._floatingPaste;
      if (x >= fp.x && x < fp.x + fp.w && y >= fp.y && y < fp.y + fp.h) {
        proxy.style.cursor = 'grab';
        return;
      }
    }

    // Check if over text being typed (text tool)
    if (this._activeTool === 'text' && this._textCursorPos && this._textFont) {
      const tp = this._textCursorPos;
      const measured = this._textBuffer
        ? measureText(this._textFont, this._textBuffer)
        : { width: 1, maxY: this._textFont.maxTop + 2, minY: 0 };
      const textW = Math.max(measured.width, 1);
      const textH = Math.max(measured.maxY - measured.minY, this._textFont.maxTop + 2);
      if (x >= tp.x && x < tp.x + textW && y >= tp.y && y < tp.y + textH) {
        proxy.style.cursor = 'grab';
        return;
      }
    }

    // Check if over selection (select tool only)
    if (this._activeTool === 'select' && this._selection) {
      const s = this._selection;
      if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) {
        proxy.style.cursor = 'grab';
        return;
      }
    }

    if (this._activeTool === 'select') {
      proxy.style.cursor = overCanvas ? 'crosshair' : '';
      return;
    }

    proxy.style.cursor = overCanvas ? 'crosshair' : '';
  }


  // ── Keyboard ───────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    // Don't intercept if focus is in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;

    // Undo / redo
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); return; }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this._redo(); return; }
    if (ctrl && e.key === 'Z') { e.preventDefault(); this._redo(); return; }

    // Copy / Cut / Paste
    if (ctrl && e.key === 'c') { e.preventDefault(); this._copy(); return; }
    if (ctrl && e.key === 'x') { e.preventDefault(); this._cut(); return; }
    // Paste handled via document paste event

    // Select all
    if (ctrl && e.key === 'a') {
      e.preventDefault();
      this._selection = { x: 0, y: 0, w: this._width, h: this._height };
      this._activeTool = 'select';
      this._previewPixels = null;
      this._brushOutlinePreview = null;
      this._updateToolUI();
      this._requestRender();
      return;
    }

    // Delete selection
    if (e.key === 'Delete' && this._selection) {
      e.preventDefault();
      this._pushUndo();
      this._fillSelection(this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK);
      this._dirty = true;
      this._requestRender();
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      if (this._activeTool === 'text' && this._textCursorPos) { this._cancelText(); return; }
      if (this._floatingPaste) { this._cancelFloatingPaste(); return; }
      if (this._selection) { this._selection = null; this._requestRender(); return; }
      this.close();
      return;
    }

    // Enter - commit text or paste
    if (e.key === 'Enter') {
      if (this._activeTool === 'text' && this._textCursorPos) { this._commitText(); return; }
      if (this._floatingPaste) { this._commitFloatingPaste(); return; }
    }

    // Text tool inline typing — intercept before tool shortcuts
    if (this._activeTool === 'text' && this._textCursorPos && this._textFont) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (this._textBuffer.length > 0) {
          this._textBuffer = this._textBuffer.slice(0, -1);
          this._requestRender();
        }
        return;
      }
      // Printable character (single char, no ctrl)
      if (!ctrl && e.key.length === 1) {
        e.preventDefault();
        this._textBuffer += e.key;
        // Reset cursor blink to visible on each keystroke
        this._textCursorVisible = true;
        this._startTextCursorBlink();
        this._requestRender();
        return;
      }
    }

    // Tool shortcuts
    const toolKeys = { p: 'pencil', b: 'brush', l: 'line', r: 'rect', c: 'circle', f: 'fill', s: 'select', t: 'text' };
    if (!ctrl && toolKeys[e.key]) {
      this._setTool(toolKeys[e.key]);
      return;
    }

    // Color shortcuts: 1=white, 2=black, 3=transparent
    if (!ctrl && e.key >= '1' && e.key <= '3') {
      if (e.key === '3' && !this._supportsTransparency) return;
      const keyToColor = {
        1: COLOR_WHITE,
        2: COLOR_BLACK,
        3: COLOR_TRANSPARENT,
      };
      this._activeColor = keyToColor[e.key];
      this._updateColorUI();
      return;
    }

    // Zoom +/-
    if (e.key === '=' || e.key === '+') { this._zoomStep(1); return; }
    if (e.key === '-') { this._zoomStep(-1); return; }
  }


  // ── Pixel manipulation ─────────────────────────────────────────────────────

  _setPixel(x, y, color) {
    if (!this._inDrawArea(x, y)) return;
    const idx = y * this._width + x;
    this._pixels[idx] = color;
    this._editedMask[idx] = 1;
  }

  _getPixel(x, y) {
    if (!this._inBounds(x, y)) return -1;
    return this._pixels[y * this._width + x];
  }

  _setPixelWithPattern(x, y, color, pattern) {
    if (!this._inDrawArea(x, y)) return;
    const pat = FILL_PATTERNS[pattern];
    if (pat === 'transparent') {
      this._setPixel(x, y, this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK);
    } else if (pat === null || pat === undefined) {
      this._setPixel(x, y, color);
    } else {
      const py = y % pat.length;
      const px = x % pat[0].length;
      if (pat[py][px]) {
        this._setPixel(x, y, color);
      } else if (this._fillMasked) {
        const opposite = color === COLOR_BLACK ? COLOR_WHITE : COLOR_BLACK;
        this._setPixel(x, y, opposite);
      }
    }
  }

  _stampBrush(cx, cy) {
    this._forEachBrushMaskPixel(cx, cy, (px, py) => {
      this._setPixelWithPattern(px, py, this._activeColor, this._fillPattern);
    });
  }

  _updateBrushOutlinePreview(cx, cy) {
    // Calculate brush outline pixels for yellow preview
    this._brushOutlinePreview = new Map();
    this._forEachBrushMaskPixel(cx, cy, (px, py) => {
      this._brushOutlinePreview.set(`${px},${py}`, true);
    });
  }

  _forEachBrushMaskPixel(cx, cy, callback) {
    const r = this._brushSize;
    if (r <= 0) {
      if (this._inBounds(cx, cy)) callback(cx, cy);
      return;
    }

    // Generate filled brush mask from midpoint-circle spans to match circle tool rasterization.
    const spans = new Map(); // py -> [minX, maxX]
    const addSpan = (py, x0, x1) => {
      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const existing = spans.get(py);
      if (existing) {
        existing[0] = Math.min(existing[0], minX);
        existing[1] = Math.max(existing[1], maxX);
      } else {
        spans.set(py, [minX, maxX]);
      }
    };

    let x = r;
    let y = 0;
    let err = 1 - r;

    while (x >= y) {
      addSpan(cy + y, cx - x, cx + x);
      addSpan(cy - y, cx - x, cx + x);
      addSpan(cy + x, cx - y, cx + y);
      addSpan(cy - x, cx - y, cx + y);

      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }

    for (const [py, [minX, maxX]] of spans) {
      for (let px = minX; px <= maxX; px++) {
        if (this._inDrawArea(px, py)) {
          callback(px, py);
        }
      }
    }
  }


  // ── Drawing algorithms ─────────────────────────────────────────────────────

  _bresenham(x0, y0, x1, y1, callback) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;

    while (true) {
      callback(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  _bresenhamPreview(x0, y0, x1, y1, color) {
    this._bresenham(x0, y0, x1, y1, (x, y) => {
      if (this._inDrawArea(x, y)) {
        this._previewPixels.set(`${x},${y}`, color);
      }
    });
  }

  _bresenhamPreviewThick(x0, y0, x1, y1, color, thickness) {
    if (thickness <= 1) {
      this._bresenhamPreview(x0, y0, x1, y1, color);
      return;
    }
    const half = (thickness - 1) / 2;
    this._bresenham(x0, y0, x1, y1, (x, y) => {
      for (let dy = -Math.floor(half); dy <= Math.ceil(half); dy++) {
        for (let dx = -Math.floor(half); dx <= Math.ceil(half); dx++) {
          const px = x + dx, py = y + dy;
          if (this._inDrawArea(px, py)) {
            this._previewPixels.set(`${px},${py}`, color);
          }
        }
      }
    });
  }

  _previewRect(x0, y0, x1, y1, color, filled) {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(this._width - 1, Math.max(x0, x1));
    const minY = Math.max(0, Math.min(y0, y1));
    const maxY = Math.min(this._height - 1, Math.max(y0, y1));

    if (filled) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (!this._inDrawArea(x, y)) continue;
          const pat = FILL_PATTERNS[this._fillPattern];
          let draw = true;
          if (pat && pat !== 'transparent') {
            draw = !!pat[y % pat.length][x % pat[0].length];
          }
          if (draw) {
            const c = (pat === 'transparent') ? (this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK) : color;
            this._previewPixels.set(`${x},${y}`, c);
          } else if (this._fillMasked && pat && pat !== 'transparent') {
            const opposite = color === COLOR_BLACK ? COLOR_WHITE : COLOR_BLACK;
            this._previewPixels.set(`${x},${y}`, opposite);
          }
        }
      }
    } else {
      // Outline with thickness
      const t = this._lineThickness;
      for (let i = 0; i < t; i++) {
        const yTop = minY + i;
        const yBot = maxY - i;
        const xLft = minX + i;
        const xRgt = maxX - i;
        if (xLft > xRgt || yTop > yBot) break;
        for (let x = xLft; x <= xRgt; x++) {
          if (this._inDrawArea(x, yTop)) this._previewPixels.set(`${x},${yTop}`, color);
          if (this._inDrawArea(x, yBot)) this._previewPixels.set(`${x},${yBot}`, color);
        }
        for (let y = yTop; y <= yBot; y++) {
          if (this._inDrawArea(xLft, y)) this._previewPixels.set(`${xLft},${y}`, color);
          if (this._inDrawArea(xRgt, y)) this._previewPixels.set(`${xRgt},${y}`, color);
        }
      }
    }
  }

  _previewEllipse(ctrX, ctrY, rx, ry, color, filled) {
    // Ellipse with float center and radii — supports both circle and ellipse modes
    const irx = Math.round(rx);
    const iry = Math.round(ry);
    if (irx === 0 && iry === 0) {
      const px = Math.round(ctrX), py = Math.round(ctrY);
      if (this._inDrawArea(px, py)) this._previewPixels.set(`${px},${py}`, color);
      return;
    }

    if (filled) {
      for (let y = -iry; y <= iry; y++) {
        for (let x = -irx; x <= irx; x++) {
          const nx = irx > 0 ? x / irx : 0;
          const ny = iry > 0 ? y / iry : 0;
          if (nx * nx + ny * ny <= 1) {
            const px = Math.round(ctrX) + x;
            const py = Math.round(ctrY) + y;
            if (this._inDrawArea(px, py)) {
              const pat = FILL_PATTERNS[this._fillPattern];
              let draw = true;
              if (pat && pat !== 'transparent') {
                draw = !!pat[py % pat.length][px % pat[0].length];
              }
              if (draw) {
                const c = (pat === 'transparent') ? (this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK) : color;
                this._previewPixels.set(`${px},${py}`, c);
              } else if (this._fillMasked && pat && pat !== 'transparent') {
                const opposite = color === COLOR_BLACK ? COLOR_WHITE : COLOR_BLACK;
                this._previewPixels.set(`${px},${py}`, opposite);
              }
            }
          }
        }
      }
    } else {
      // Ellipse outline with thickness support
      const t = this._lineThickness;
      const rcx = Math.round(ctrX), rcy = Math.round(ctrY);

      if (t <= 1) {
        // Use midpoint ellipse algorithm for clean 1-pixel outline
        const a = irx, b = iry;
        const plotted = new Set();
        const plot = (px, py) => {
          const key = `${px},${py}`;
          if (!plotted.has(key) && this._inDrawArea(px, py)) {
            this._previewPixels.set(key, color);
            plotted.add(key);
          }
        };

        if (a === 0) {
          for (let y = -b; y <= b; y++) plot(rcx, rcy + y);
        } else if (b === 0) {
          for (let x = -a; x <= a; x++) plot(rcx + x, rcy);
        } else {
          let x = 0, y = b;
          let d1 = b * b - a * a * b + 0.25 * a * a;
          let dx = 2 * b * b * x;
          let dy = 2 * a * a * y;
          while (dx < dy) {
            plot(rcx + x, rcy + y); plot(rcx - x, rcy + y);
            plot(rcx + x, rcy - y); plot(rcx - x, rcy - y);
            if (d1 < 0) {
              x++; dx += 2 * b * b;
              d1 += dx + b * b;
            } else {
              x++; y--; dx += 2 * b * b; dy -= 2 * a * a;
              d1 += dx - dy + b * b;
            }
          }
          let d2 = b * b * (x + 0.5) * (x + 0.5) + a * a * (y - 1) * (y - 1) - a * a * b * b;
          while (y >= 0) {
            plot(rcx + x, rcy + y); plot(rcx - x, rcy + y);
            plot(rcx + x, rcy - y); plot(rcx - x, rcy - y);
            if (d2 > 0) {
              y--; dy -= 2 * a * a;
              d2 += a * a - dy;
            } else {
              y--; x++; dx += 2 * b * b; dy -= 2 * a * a;
              d2 += dx - dy + a * a;
            }
          }
        }
      } else {
        // Thick outline: plot pixels inside outer ellipse but outside inner ellipse
        const outerRx = irx, outerRy = iry;
        const innerRx = Math.max(0, irx - t);
        const innerRy = Math.max(0, iry - t);

        // Collect ring pixel coordinates into a Set for cleanup
        const ringPixels = new Set();

        if (t >= Math.min(irx, iry)) {
          // Thickness exceeds one radius — fill the whole ellipse
          for (let y = -outerRy; y <= outerRy; y++) {
            for (let x = -outerRx; x <= outerRx; x++) {
              const nx = outerRx > 0 ? x / outerRx : 0;
              const ny = outerRy > 0 ? y / outerRy : 0;
              if (nx * nx + ny * ny <= 1) {
                ringPixels.add(`${x},${y}`);
              }
            }
          }
        } else {
          // Scan every pixel in the outer bounding box
          for (let y = -outerRy; y <= outerRy; y++) {
            for (let x = -outerRx; x <= outerRx; x++) {
              const nxO = outerRx > 0 ? x / outerRx : 0;
              const nyO = outerRy > 0 ? y / outerRy : 0;
              const dOuter = nxO * nxO + nyO * nyO;
              if (dOuter > 1) continue;
              const nxI = innerRx > 0 ? x / innerRx : 0;
              const nyI = innerRy > 0 ? y / innerRy : 0;
              const dInner = nxI * nxI + nyI * nyI;
              if (dInner <= 1) continue;
              ringPixels.add(`${x},${y}`);
            }
          }
        }

        // Morphological cleanup: remove outer protrusions and fill inner indentations
        // Pass 1: remove pixels with fewer than 2 orthogonal neighbors (outer artifacts)
        const cleaned = new Set(ringPixels);
        for (const key of ringPixels) {
          const [x, y] = key.split(',').map(Number);
          let neighbors = 0;
          if (ringPixels.has(`${x + 1},${y}`)) neighbors++;
          if (ringPixels.has(`${x - 1},${y}`)) neighbors++;
          if (ringPixels.has(`${x},${y + 1}`)) neighbors++;
          if (ringPixels.has(`${x},${y - 1}`)) neighbors++;
          if (neighbors < 2) cleaned.delete(key);
        }

        // Pass 2: fill single-pixel holes on inner boundary
        // Check non-ring pixels inside the outer ellipse that have 3+ ring neighbors
        if (innerRx > 0 && innerRy > 0) {
          for (let y = -(innerRy); y <= innerRy; y++) {
            for (let x = -(innerRx); x <= innerRx; x++) {
              const key = `${x},${y}`;
              if (cleaned.has(key)) continue;
              const nxI = x / innerRx;
              const nyI = y / innerRy;
              if (nxI * nxI + nyI * nyI > 1) continue; // only check pixels inside inner ellipse
              let neighbors = 0;
              if (cleaned.has(`${x + 1},${y}`)) neighbors++;
              if (cleaned.has(`${x - 1},${y}`)) neighbors++;
              if (cleaned.has(`${x},${y + 1}`)) neighbors++;
              if (cleaned.has(`${x},${y - 1}`)) neighbors++;
              if (neighbors >= 3) cleaned.add(key);
            }
          }
        }

        for (const key of cleaned) {
          const [x, y] = key.split(',').map(Number);
          const px = rcx + x, py = rcy + y;
          if (this._inDrawArea(px, py)) {
            this._previewPixels.set(`${px},${py}`, color);
          }
        }
      }
    }
  }


  // ── Flood fill ─────────────────────────────────────────────────────────────

  _floodFill(startX, startY) {
    if (!this._inDrawArea(startX, startY)) return;
    const targetColor = this._getPixel(startX, startY);
    const fillColor = this._activeColor;
    const pat = this._fillPattern;

    // Don't fill if target is same as fill (for solid pattern)
    if (pat === 'solid' && targetColor === fillColor) return;

    const w = this._width;
    const h = this._height;
    const visited = new Uint8Array(w * h);
    const stack = [startX + startY * w];

    while (stack.length > 0) {
      const idx = stack.pop();
      if (visited[idx]) continue;
      visited[idx] = 1;

      const x = idx % w;
      const y = (idx - x) / w;

      if (!this._inDrawArea(x, y)) continue;
      if (this._pixels[idx] !== targetColor) continue;

      this._setPixelWithPattern(x, y, fillColor, pat);

      if (x > 0) stack.push(idx - 1);
      if (x < w - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - w);
      if (y < h - 1) stack.push(idx + w);
    }
    this._dirty = true;
  }


  // ── Selection / Clipboard ──────────────────────────────────────────────────

  _copy() {
    if (!this._selection) return;
    const s = this._selection;
    const pixels = new Uint8Array(s.w * s.h);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        pixels[y * s.w + x] = this._getPixel(s.x + x, s.y + y);
      }
    }
    this._clipboard = { w: s.w, h: s.h, pixels };

    // Copy to system clipboard as PNG
    try {
      const canvas = new OffscreenCanvas(s.w, s.h);
      const ctx = canvas.getContext('2d');
      const imgData = new ImageData(s.w, s.h);
      for (let i = 0; i < s.w * s.h; i++) {
        const idx = i * 4;
        const v = pixels[i];
        if (v === COLOR_WHITE) {
          imgData.data[idx] = 255; imgData.data[idx + 1] = 255; imgData.data[idx + 2] = 255; imgData.data[idx + 3] = 255;
        } else if (v === COLOR_TRANSPARENT) {
          imgData.data[idx + 3] = 0;
        } else {
          imgData.data[idx] = 0; imgData.data[idx + 1] = 0; imgData.data[idx + 2] = 0; imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      canvas.convertToBlob({ type: 'image/png' }).then(blob => {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      });
    } catch {
      // System clipboard not available, internal clipboard still works
    }

    showToast('Copied selection', 'success');
  }

  _cut() {
    if (!this._selection) return;
    this._copy();
    this._pushUndo();
    this._fillSelection(this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK);
    this._dirty = true;
    this._requestRender();
  }

  _fillSelection(color) {
    if (!this._selection) return;
    const s = this._selection;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        this._setPixel(s.x + x, s.y + y, color);
      }
    }
  }

  _pasteInternal() {
    if (!this._clipboard) { showToast('Nothing to paste', 'info'); return; }
    this._commitFloatingPaste(); // commit any existing paste first
    this._selection = null;
    const cx = Math.round(this._width / 2 - this._clipboard.w / 2);
    const cy = Math.round(this._height / 2 - this._clipboard.h / 2);
    this._floatingPaste = {
      x: cx, y: cy,
      w: this._clipboard.w, h: this._clipboard.h,
      pixels: new Uint8Array(this._clipboard.pixels),
    };
    this._requestRender();
  }

  _pasteExternalImage(imageData) {
    this._commitFloatingPaste();
    this._selection = null;
    // Threshold the pasted image to 1-bit
    const w = imageData.width;
    const h = imageData.height;
    const pixels = new Uint8Array(w * h);
    const src = imageData.data;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      if (src[idx + 3] < 128) {
        pixels[i] = this._supportsTransparency ? COLOR_TRANSPARENT : COLOR_BLACK;
      } else {
        pixels[i] = src[idx + 1] > this._threshold ? COLOR_WHITE : COLOR_BLACK;
      }
    }
    const cx = Math.round(this._width / 2 - w / 2);
    const cy = Math.round(this._height / 2 - h / 2);
    this._floatingPaste = { x: cx, y: cy, w, h, pixels };
    this._requestRender();
  }

  _commitFloatingPaste() {
    if (!this._floatingPaste) return;
    this._pushUndo();
    const fp = this._floatingPaste;
    for (let fy = 0; fy < fp.h; fy++) {
      for (let fx = 0; fx < fp.w; fx++) {
        const pv = fp.pixels[fy * fp.w + fx];
        if (pv === COLOR_TRANSPARENT) continue;
        this._setPixel(fp.x + fx, fp.y + fy, pv);
      }
    }
    this._floatingPaste = null;
    this._dirty = true;
    this._requestRender();
  }

  _cancelFloatingPaste() {
    this._floatingPaste = null;
    this._requestRender();
  }

  _onPaste(e) {
    if (!this._open) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        createImageBitmap(blob).then((bmp) => {
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bmp, 0, 0);
          const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
          this._pasteExternalImage(imageData);
        });
        return;
      }
    }

    // If no image in clipboard, try internal paste
    if (this._clipboard) {
      e.preventDefault();
      this._pasteInternal();
    }
  }


  // ── Undo / Redo ────────────────────────────────────────────────────────────

  _pushUndo() {
    this._undoStack.push({
      width: this._width,
      height: this._height,
      pixels: new Uint8Array(this._pixels),
      edited: new Uint8Array(this._editedMask),
      source: new ImageData(
        new Uint8ClampedArray(this._sourceImageData.data),
        this._sourceImageData.width,
        this._sourceImageData.height,
      ),
    });
    this._redoStack.length = 0;
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
  }

  _undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push({
      width: this._width,
      height: this._height,
      pixels: new Uint8Array(this._pixels),
      edited: new Uint8Array(this._editedMask),
      source: new ImageData(
        new Uint8ClampedArray(this._sourceImageData.data),
        this._sourceImageData.width,
        this._sourceImageData.height,
      ),
    });
    const state = this._undoStack.pop();
    const dimsChanged = state.width !== this._width || state.height !== this._height;
    this._width = state.width;
    this._height = state.height;
    this._pixels = state.pixels;
    this._editedMask = state.edited;
    this._sourceImageData = state.source;
    if (dimsChanged) {
      this._exitResizeMode();
      this._dimsLabel.textContent = `${this._width} \u00D7 ${this._height}`;
      this._resizeCanvas();
      this._autoFitZoom();
      this._updateScrollLayout();
      this._updateZoomLabel();
    }
    this._requestRender();
  }

  _redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push({
      width: this._width,
      height: this._height,
      pixels: new Uint8Array(this._pixels),
      edited: new Uint8Array(this._editedMask),
      source: new ImageData(
        new Uint8ClampedArray(this._sourceImageData.data),
        this._sourceImageData.width,
        this._sourceImageData.height,
      ),
    });
    const state = this._redoStack.pop();
    const dimsChanged = state.width !== this._width || state.height !== this._height;
    this._width = state.width;
    this._height = state.height;
    this._pixels = state.pixels;
    this._editedMask = state.edited;
    this._sourceImageData = state.source;
    if (dimsChanged) {
      this._exitResizeMode();
      this._dimsLabel.textContent = `${this._width} \u00D7 ${this._height}`;
      this._resizeCanvas();
      this._autoFitZoom();
      this._updateScrollLayout();
      this._updateZoomLabel();
    }
    this._requestRender();
  }


  // ── Import / Export ────────────────────────────────────────────────────────

  _importImage() {
    this._fileInput?.click();
  }

  async _handleImportFile(file) {
    let imageData;
    try {
      imageData = await loadImageFileOriginal(file);
    } catch {
      showToast('Failed to load image', 'error');
      return;
    }

    if (imageData.width === this._width && imageData.height === this._height) {
      // Same dimensions: replace pixels
      this._pushUndo();
      this._sourceImageData = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height,
      );
      this._editedMask.fill(0);
      this._derivePixelsFromSource(this._threshold);
      this._dirty = true;
      this._requestRender();
      showToast('Image imported', 'success');
    } else {
      // Different dimensions — ask user
      const msg = `Imported image is ${imageData.width}\u00D7${imageData.height}, canvas is ${this._width}\u00D7${this._height}.\n\nResize canvas to match, or place as floating paste?`;

      // Use a custom 3-button dialog
      const result = await showConfirm(msg, {
        title: 'Dimension Mismatch',
        buttons: [
          { label: 'Resize Canvas', value: 'resize' },
          { label: 'Place as Paste', value: 'paste' },
          { label: 'Cancel', value: 'cancel' },
        ],
      });

      if (result === 'resize') {
        this._pushUndo();
        this._width = imageData.width;
        this._height = imageData.height;
        this._pixels = new Uint8Array(this._width * this._height);
        this._editedMask = new Uint8Array(this._width * this._height);
        this._sourceImageData = new ImageData(
          new Uint8ClampedArray(imageData.data),
          imageData.width,
          imageData.height,
        );
        this._derivePixelsFromSource(this._threshold);
        // Clear resize backing store (full image replacement)
        this._backingPixels = null;
        this._backingMask = null;
        this._backingSource = null;
        this._backingWidth = 0;
        this._backingHeight = 0;
        this._exitResizeMode();
        this._dimsLabel.textContent = `${this._width} \u00D7 ${this._height}`;
        this._resizeCanvas();
        this._autoFitZoom();
        this._updateScrollLayout();
        this._centerScroll();
        this._updateZoomLabel();
        this._dirty = true;
        this._requestRender();
        showToast('Canvas resized and image imported', 'success');
      } else if (result === 'paste') {
        this._pasteExternalImage(imageData);
        showToast('Image placed as floating paste \u2014 drag to position, Enter to commit', 'info');
      }
    }
  }

  async _exportPNG() {
    const outImageData = this._buildOutputImageData();
    const canvas = new OffscreenCanvas(this._width, this._height);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(outImageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const filename = (this._opts?.filename || 'image').replace(/\.[^.]+$/, '') + '_edited.png';
    downloadBlob(blob, filename, 'image/png');
    showToast('Exported as PNG', 'success');
  }


  // ── UI helpers ─────────────────────────────────────────────────────────────

  _setTool(name) {
    // If clicking text tool again when already active, toggle font panel
    if (name === 'text' && this._activeTool === 'text') {
      this._toggleFontPanel(); // toggle
      return;
    }

    // If switching away from text tool, commit any in-progress text and close font panel
    if (this._activeTool === 'text' && name !== 'text') {
      if (this._textCursorPos) {
        if (this._textBuffer) {
          this._commitText();
        } else {
          this._clearTextState();
        }
      }
      this._toggleFontPanel(false);
    }

    this._activeTool = name;
    this._updateToolUI();
    this._updateCursor(this._lastClientX, this._lastClientY);
    // Show/hide brush size dropdown
    this._updateBrushSizeDropdownVisibility();
    // Clear brush outline preview when changing tools
    if (name !== 'brush' && name !== 'pencil' && name !== 'line' && name !== 'rect' && name !== 'circle' && name !== 'fill') {
      this._brushOutlinePreview = null;
      this._requestRender();
    }
    // Text tool: load fonts and show font panel
    if (name === 'text') {
      this._loadFontsIfNeeded();
      this._toggleFontPanel(true);
    }
  }

  _updateToolUI() {
    for (const [key, btn] of Object.entries(this._toolButtons)) {
      btn.classList.toggle('active', key === this._activeTool);
    }
  }

  _updateBrushSizeDropdownVisibility() {
    if (this._activeTool === 'brush') {
      this._brushSizeDropdown.classList.add('visible');
      this._brushSizeDropdown.classList.remove('hidden');
      // Position dropdown aligned with brush tool button
      const brushBtn = this._toolButtons['brush'];
      if (brushBtn) {
        const rect = brushBtn.getBoundingClientRect();
        this._brushSizeDropdown.style.left = rect.left + 'px';
        this._brushSizeDropdown.style.top = (rect.bottom + 8) + 'px';
      }
    } else {
      this._brushSizeDropdown.classList.add('hidden');
      this._brushSizeDropdown.classList.remove('visible');
    }
  }

  _updateBrushSizeDropdownValue() {
    if (this._brushSizeDropdownSlider) {
      this._brushSizeDropdownSlider.value = this._brushSize;
      this._updateBrushSizeSliderFill();
    }
    if (this._brushSizeValue) {
      this._brushSizeValue.textContent = this._brushSize;
    }
    // Update preview with new brush size
    if (this._activeTool === 'brush') {
      this._requestRender();
    }
  }

  _updateBrushSizeSliderFill() {
    if (!this._brushSizeDropdownSlider) return;
    const slider = this._brushSizeDropdownSlider;
    const min = parseInt(slider.min || '1', 10);
    const max = parseInt(slider.max || '8', 10);
    const value = parseInt(slider.value || `${this._brushSize}`, 10);
    const range = Math.max(1, max - min);
    const pct = ((value - min) / range) * 100;
    slider.style.setProperty('--pe-brush-fill', `${pct}%`);
  }

  _toggleLineThicknessDropdown() {
    const dd = this._lineThicknessDropdown;
    if (!dd) return;
    const isVisible = dd.classList.contains('visible');
    if (isVisible) {
      dd.classList.add('hidden');
      dd.classList.remove('visible');
    } else {
      dd.classList.add('visible');
      dd.classList.remove('hidden');
      // Position dropdown aligned with the line thickness button
      const btn = this._lineThicknessBtn;
      if (btn) {
        const rect = btn.getBoundingClientRect();
        dd.style.left = rect.left + 'px';
        dd.style.top = (rect.bottom + 8) + 'px';
      }
      this._updateLineThicknessSliderFill();
    }
  }

  _updateLineThicknessDropdownValue() {
    if (this._lineThicknessDropdownSlider) {
      this._lineThicknessDropdownSlider.value = this._lineThickness;
      this._updateLineThicknessSliderFill();
    }
    if (this._lineThicknessValue) {
      this._lineThicknessValue.textContent = this._lineThickness;
    }
  }

  _updateLineThicknessSliderFill() {
    if (!this._lineThicknessDropdownSlider) return;
    const slider = this._lineThicknessDropdownSlider;
    const min = parseInt(slider.min || '1', 10);
    const max = parseInt(slider.max || '8', 10);
    const value = parseInt(slider.value || `${this._lineThickness}`, 10);
    const range = Math.max(1, max - min);
    const pct = ((value - min) / range) * 100;
    slider.style.setProperty('--pe-brush-fill', `${pct}%`);
  }

  _updateColorUI() {
    for (const [key, sw] of Object.entries(this._colorSwatches)) {
      sw.classList.toggle('active', parseInt(key, 10) === this._activeColor);
    }
  }

  _applyTransparencyVisibility() {
    const show = this._supportsTransparency;
    // Transparency color swatch
    if (this._colorSwatches[COLOR_TRANSPARENT]) {
      this._colorSwatches[COLOR_TRANSPARENT].classList.toggle('hidden', !show);
    }
    // Masked mode button (uses opposite color instead of transparent)
    if (this._maskedBtn) {
      this._maskedBtn.classList.toggle('hidden', !show);
    }
  }

  _updatePatternUI() {
    for (const [key, btn] of Object.entries(this._patternButtons)) {
      btn.classList.toggle('active', key === this._fillPattern);
    }
    // Update trigger preview
    if (this._fillTriggerCanvas) {
      const ctx = this._fillTriggerCanvas.getContext('2d');
      this._drawPatternPreview(ctx, this._fillPattern, 16, 16);
    }
  }

  _updateShapeFilledUI() {
    if (this._shapeFilledBtn) {
      this._shapeFilledBtn.classList.toggle('active', this._shapeFilled);
      this._shapeFilledBtn.textContent = this._shapeFilled ? '▣' : '▨';
      this._shapeFilledBtn.title = this._shapeFilled ? 'Filled shapes (click for outline)' : 'Outline shapes (click for filled)';
    }
  }

  _toggleOptionsPanel(forceState) {
    if (!this._optionsPanel) return;
    const show = forceState !== undefined ? forceState : this._optionsPanel.classList.contains('hidden');
    this._optionsPanel.classList.toggle('hidden', !show);
    if (this._optionsBtn) this._optionsBtn.classList.toggle('active', show);
  }


  // ── Font panel ─────────────────────────────────────────────────────────────

  _buildFontPanel() {
    const panel = document.createElement('div');
    panel.className = 'pe-font-panel hidden';

    // Draggable header
    const panelHeader = document.createElement('div');
    panelHeader.className = 'pe-panel-header';
    const panelTitle = document.createElement('span');
    panelTitle.className = 'pe-panel-title';
    panelTitle.textContent = 'Font';
    panelHeader.appendChild(panelTitle);
    const panelClose = document.createElement('button');
    panelClose.className = 'pe-panel-close';
    panelClose.innerHTML = '&times;';
    panelClose.title = 'Close panel';
    panelClose.addEventListener('click', () => this._toggleFontPanel(false));
    panelHeader.appendChild(panelClose);
    panel.appendChild(panelHeader);

    // Drag logic
    let dragging = false, dragX = 0, dragY = 0;
    panelHeader.addEventListener('pointerdown', (e) => {
      if (e.target === panelClose) return;
      dragging = true;
      dragX = e.clientX - panel.offsetLeft;
      dragY = e.clientY - panel.offsetTop;
      panelHeader.setPointerCapture(e.pointerId);
      panelHeader.style.cursor = 'grabbing';
    });
    panelHeader.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const parent = panel.parentElement;
      if (!parent) return;
      const maxX = parent.clientWidth - panel.offsetWidth;
      const maxY = parent.clientHeight - panel.offsetHeight;
      let nx = e.clientX - dragX;
      let ny = e.clientY - dragY;
      nx = Math.max(0, Math.min(nx, maxX));
      ny = Math.max(0, Math.min(ny, maxY));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
      panel.style.right = 'auto';
    });
    panelHeader.addEventListener('pointerup', () => {
      dragging = false;
      panelHeader.style.cursor = '';
    });

    // Font list body
    const body = document.createElement('div');
    body.className = 'pe-font-panel-body';

    const loadingLabel = document.createElement('div');
    loadingLabel.className = 'pe-font-loading';
    loadingLabel.textContent = 'Loading fonts\u2026';
    body.appendChild(loadingLabel);

    panel.appendChild(body);
    this._fontPanel = panel;
    this._fontListEl = body;
    return panel;
  }

  _toggleFontPanel(forceState) {
    if (!this._fontPanel) return;
    const show = forceState !== undefined ? forceState : this._fontPanel.classList.contains('hidden');
    this._fontPanel.classList.toggle('hidden', !show);
    if (this._toolButtons['text']) this._toolButtons['text'].classList.toggle('active', show || this._activeTool === 'text');
  }

  _populateFontList() {
    if (!this._fontListEl || !this._textFonts) return;
    this._fontListEl.innerHTML = '';

    const SCALE = 2;

    for (const [id, font] of this._textFonts) {
      const item = document.createElement('button');
      item.className = 'pe-font-item';
      if (this._textFont && this._textFont.id === id) item.classList.add('active');
      item.dataset.fontId = id;

      // Render font name preview using the font's own glyphs at 3x
      const previewText = font.family;
      const measured = measureText(font, previewText);
      const cWidth = Math.max(measured.width, 1);
      const cHeight = Math.max(measured.maxY - measured.minY, font.maxTop + 2);
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = cWidth * SCALE;
      previewCanvas.height = cHeight * SCALE;
      previewCanvas.className = 'pe-font-preview-canvas';
      previewCanvas.style.width = (cWidth * SCALE) + 'px';
      previewCanvas.style.height = (cHeight * SCALE) + 'px';
      const pctx = previewCanvas.getContext('2d');
      pctx.imageSmoothingEnabled = false;
      pctx.fillStyle = '#1a1a2e';
      pctx.fillRect(0, 0, cWidth * SCALE, cHeight * SCALE);
      // Draw font glyphs at 3x scale
      const offsetY = -measured.minY;
      drawText(
        (x, y, c) => {
          const py = y + offsetY;
          if (x >= 0 && x < cWidth && py >= 0 && py < cHeight) {
            pctx.fillStyle = '#ffffff';
            pctx.fillRect(x * SCALE, py * SCALE, SCALE, SCALE);
          }
        },
        font, previewText, 0, 0, 1
      );

      item.appendChild(previewCanvas);

      item.addEventListener('click', () => {
        this._textFont = font;
        // Update active state
        for (const btn of this._fontListEl.querySelectorAll('.pe-font-item')) {
          btn.classList.toggle('active', btn.dataset.fontId === id);
        }
        // Re-render text preview if currently typing
        if (this._textCursorPos) this._requestRender();
      });

      this._fontListEl.appendChild(item);
    }
  }

  async _loadFontsIfNeeded() {
    if (this._fontsLoaded) return;
    this._fontsLoaded = true; // prevent double-load
    try {
      this._textFonts = await loadAllFonts();
      if (this._textFonts.size > 0) {
        this._textFont = this._textFonts.values().next().value;
      }
      this._populateFontList();
    } catch (err) {
      this._fontsLoaded = false;
      showToast('Failed to load fonts', 'error');
    }
  }


  // ── Text tool ──────────────────────────────────────────────────────────────

  _startTextCursorBlink() {
    this._stopTextCursorBlink();
    this._textCursorVisible = true;
    this._textCursorInterval = setInterval(() => {
      this._textCursorVisible = !this._textCursorVisible;
      this._requestRender();
    }, 500);
  }

  _stopTextCursorBlink() {
    if (this._textCursorInterval) {
      clearInterval(this._textCursorInterval);
      this._textCursorInterval = null;
    }
  }

  _commitText() {
    if (!this._textCursorPos || !this._textBuffer || !this._textFont) {
      this._clearTextState();
      return;
    }
    this._pushUndo();
    drawText(
      (x, y) => this._setPixel(x, y, this._activeColor),
      this._textFont, this._textBuffer,
      this._textCursorPos.x, this._textCursorPos.y,
      this._activeColor
    );
    this._dirty = true;
    this._clearTextState();
    this._requestRender();
  }

  _cancelText() {
    this._clearTextState();
    this._requestRender();
  }

  _clearTextState() {
    this._textCursorPos = null;
    this._textBuffer = '';
    this._textDragging = false;
    this._textDragOffset = null;
    this._stopTextCursorBlink();
  }

  _drawPatternPreview(ctx, patternKey, w, h) {
    const pat = FILL_PATTERNS[patternKey];
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    if (pat === null || pat === undefined) {
      // Solid
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    } else if (pat === 'transparent') {
      // Checkerboard for transparent
      const sz = 3;
      for (let y = 0; y < h; y += sz) {
        for (let x = 0; x < w; x += sz) {
          ctx.fillStyle = ((x / sz + y / sz) % 2) ? '#2a2a4a' : '#1a1a2e';
          ctx.fillRect(x, y, sz, sz);
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const py = y % pat.length;
          const px = x % pat[0].length;
          ctx.fillStyle = pat[py][px] ? '#ffffff' : '#1a1a2e';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  _startSelectionAnim() {
    const animate = () => {
      this._selectionAnimOffset = (this._selectionAnimOffset + 0.5) % 8;
      if (this._selection || this._floatingPaste) {
        this._requestRender();
      }
      this._selectionAnimId = requestAnimationFrame(animate);
    };
    this._selectionAnimId = requestAnimationFrame(animate);
  }

  _stopSelectionAnim() {
    if (this._selectionAnimId) {
      cancelAnimationFrame(this._selectionAnimId);
      this._selectionAnimId = null;
    }
  }


  // ── Scroll proxy helpers ───────────────────────────────────────────────────

  _updateScrollLayout() {
    if (!this._scrollSizer) return;
    const imgW = this._width * this._zoom;
    const imgH = this._height * this._zoom;
    this._scrollSizer.style.width = imgW + 'px';
    this._scrollSizer.style.height = imgH + 'px';
  }

  _syncScrollToProxy() {
    if (!this._scrollProxy) return;
    this._ignoreProxyScroll = true;
    this._scrollProxy.scrollLeft = this._scrollX * this._zoom;
    this._scrollProxy.scrollTop = this._scrollY * this._zoom;
    this._ignoreProxyScroll = false;
  }

  _onProxyScroll() {
    if (this._ignoreProxyScroll) return;
    this._scrollX = this._scrollProxy.scrollLeft / this._zoom;
    this._scrollY = this._scrollProxy.scrollTop / this._zoom;
    this._requestRender();
  }

  _getCenterOffset() {
    if (this._topLeftOrigin || !this._scrollProxy) return { x: 0, y: 0 };
    const cw = this._scrollProxy.clientWidth;
    const ch = this._scrollProxy.clientHeight;
    const imgW = this._width * this._zoom;
    const imgH = this._height * this._zoom;
    return {
      x: imgW < cw ? (cw - imgW) / 2 : 0,
      y: imgH < ch ? (ch - imgH) / 2 : 0,
    };
  }
}
