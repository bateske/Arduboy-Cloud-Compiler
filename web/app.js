/* Arduboy Cloud Compiler — Monaco IDE frontend */
(function () {
  'use strict';

  var POLL_INTERVAL_MS = 3000;
  var DEV_LOG = false;
  var MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

  var DEFAULT_SKETCH =
    '#include <Arduboy2.h>\n\n' +
    'Arduboy2 arduboy;\n\n' +
    'void setup() {\n' +
    '  arduboy.begin();\n' +
    '  arduboy.setFrameRate(60);\n' +
    '}\n\n' +
    'void loop() {\n' +
    '  if (!arduboy.nextFrame()) return;\n\n' +
    '  arduboy.pollButtons();\n' +
    '  arduboy.clear();\n\n' +
    '  // Your code here\n\n' +
    '  arduboy.display();\n' +
    '}\n';

  var VALID_EXTENSIONS = ['.ino', '.h', '.hpp', '.cpp', '.c'];

  /* ══════════════════════════════════════════════════════════════════════
   *  ANSI colour → HTML
   * ══════════════════════════════════════════════════════════════════════ */
  var ANSI_SPAN = {
    '90': '<span style="color:#666699">',
    '91': '<span style="color:#ff6b6b">',
    '92': '<span style="color:#58d6ff">',
    '93': '<span style="color:#ffd166">',
    '94': '<span style="color:#6bcaff">',
    '95': '<span style="color:#cc99ff">',
    '96': '<span style="color:#58ffcc">',
    '97': '<span style="color:#ffffff">',
    '1':  '<span style="font-weight:bold">',
  };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ansiToHtml(raw) {
    return escapeHtml(raw).replace(/\x1b\[(\d+)m/g, function (_, code) {
      if (code === '0') return '</span>';
      return ANSI_SPAN[code] || '';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Memory meter helpers
   * ══════════════════════════════════════════════════════════════════════ */
  function parseMemoryUsage(log) {
    var flash = log.match(
      /Sketch uses (\d+) bytes \((\d+)%\) of program storage space\. Maximum is (\d+) bytes/
    );
    var ram = log.match(
      /Global variables use (\d+) bytes \((\d+)%\) of dynamic memory.*?Maximum is (\d+) bytes/
    );
    return {
      flash: flash ? { used: +flash[1], pct: +flash[2], max: +flash[3] } : null,
      ram:   ram   ? { used: +ram[1],   pct: +ram[2],   max: +ram[3]   } : null,
    };
  }

  function pctClass(pct) {
    if (pct >= 90) return 'meter-bar meter-bar--danger';
    if (pct >= 70) return 'meter-bar meter-bar--warn';
    return 'meter-bar meter-bar--ok';
  }

  function updateMemoryMeters(log) {
    var mem = parseMemoryUsage(log);
    if (!mem.flash && !mem.ram) {
      memorySection.classList.add('hidden');
      return;
    }
    memorySection.classList.remove('hidden');
    if (mem.flash) {
      flashBar.style.width  = mem.flash.pct + '%';
      flashBar.className    = pctClass(mem.flash.pct);
      flashInfo.textContent =
        mem.flash.used.toLocaleString() + ' / ' + mem.flash.max.toLocaleString() +
        ' bytes  (' + mem.flash.pct + '%)';
    }
    if (mem.ram) {
      ramBar.style.width  = mem.ram.pct + '%';
      ramBar.className    = pctClass(mem.ram.pct);
      ramInfo.textContent =
        mem.ram.used.toLocaleString() + ' / ' + mem.ram.max.toLocaleString() +
        ' bytes  (' + mem.ram.pct + '%)';
    }

    // FX Data meter — driven by the selected .bin file, not the build log
    var FX_MAX_BYTES = 16 * 1024 * 1024;  // 16 MB
    var fxData = loadDevDataCheckbox.checked ? getSelectedFxDataBinary() : null;
    if (fxData) {
      var fxUsed = fxData.length;
      var fxPct = Math.min(Math.round((fxUsed / FX_MAX_BYTES) * 100), 100);
      fxDataBar.style.width  = Math.max(fxPct, 1) + '%';
      fxDataBar.className    = pctClass(fxPct);
      fxDataInfo.textContent =
        formatFileSize(fxUsed) + ' / ' + formatFileSize(FX_MAX_BYTES) +
        '  (' + fxPct + '%)';
      fxDataMeterGroup.classList.remove('hidden');
    } else {
      fxDataMeterGroup.classList.add('hidden');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Board capabilities and FQBN
   * ══════════════════════════════════════════════════════════════════════ */
  var BOARD_CAPS = {
    'arduboy':           { contrast: false, display: false, flashselect: false, based_on: false },
    'arduboy-fx':        { contrast: false, display: false, flashselect: false, based_on: false },
    'arduboy-fxc':       { contrast: false, display: false, flashselect: false, based_on: false },
    'arduboy-mini':      { contrast: false, display: false, flashselect: false, based_on: false },
    'arduboy-devkit':    { contrast: true,  display: false, flashselect: false, based_on: false },
    'arduboy-fx-devkit': { contrast: true,  display: false, flashselect: false, based_on: false },
    'arduboy-homemade':  { contrast: true,  display: true,  flashselect: true,  based_on: true  },
    'microcade':         { contrast: true,  display: false, flashselect: false, based_on: false },
  };

  /* Mapping from build target to default simulator display/fxport settings */
  var SIM_DEFAULTS = {
    'arduboy':           { display: 'ssd1306', fxport: 'fx' },
    'arduboy-fx':        { display: 'ssd1306', fxport: 'fx' },
    'arduboy-fxc':       { display: 'ssd1306', fxport: 'mini' },
    'arduboy-mini':      { display: 'ssd1306', fxport: 'mini' },
    'arduboy-devkit':    { display: 'ssd1306', fxport: 'fxdevkit' },
    'arduboy-fx-devkit': { display: 'ssd1306', fxport: 'fx' },
    'arduboy-homemade':  { display: 'ssd1306', fxport: 'fx' },
    'microcade':         { display: 'ssd1306', fxport: 'fx' },
  };

  /* ══════════════════════════════════════════════════════════════════════
   *  DOM refs
   * ══════════════════════════════════════════════════════════════════════ */
  var targetSelect    = document.getElementById('target');
  var compilerRoot    = document.getElementById('compiler-root');
  var coreSelect      = document.getElementById('core');
  var contrastGroup   = document.getElementById('contrastGroup');
  var contrastSelect  = document.getElementById('contrast');
  var homemadeGroup   = document.getElementById('homemadeGroup');
  var basedOnSelect   = document.getElementById('basedOn');
  var displaySelect   = document.getElementById('display');
  var flashSelSelect  = document.getElementById('flashSelect');
  var fqbnDisplay     = document.getElementById('fqbnDisplay');
  var buildBtn        = document.getElementById('buildBtn');
  var downloadHexBtn      = document.getElementById('downloadHexBtn');
  var uploadToDeviceBtn   = document.getElementById('uploadToDeviceBtn');
  var pushToPkgBtn        = document.getElementById('pushToPkgBtn');
  var logPre          = document.getElementById('logPre');
  var memorySection   = document.getElementById('memorySection');
  var flashBar        = document.getElementById('flashBar');
  var flashInfo       = document.getElementById('flashInfo');
  var ramBar          = document.getElementById('ramBar');
  var ramInfo         = document.getElementById('ramInfo');
  var fxDataMeterGroup = document.getElementById('fxDataMeterGroup');
  var fxDataBar       = document.getElementById('fxDataBar');
  var fxDataInfo      = document.getElementById('fxDataInfo');
  var outputPanel       = document.getElementById('outputPanel');
  // ══════════════════════════════════════════════════════════════════════
  //  Output panel resizing
  // ══════════════════════════════════════════════════════════════════════
  let isResizingOutputPanel = false;
  let didDragOutputPanel = false;
  let startY = 0;
  let startHeight = 0;
  var outputHeader      = document.getElementById('outputHeader');
  var outputErrorCount  = document.getElementById('outputErrorCount');
  var copyRawOutputBtn  = document.getElementById('copyRawOutputBtn');
  var toggleOutputBtn   = document.getElementById('toggleOutputBtn');
  var autoShowOutputCheckbox = document.getElementById('autoShowOutputCheckbox');
  var tabBar          = document.getElementById('tabBar');
  var addTabBtn       = document.getElementById('addTabBtn');
  var importZipBtn    = document.getElementById('importZipBtn');
  var exportZipBtn    = document.getElementById('exportZipBtn');
  var zipFileInput    = document.getElementById('zipFileInput');
  var editorContainer = document.getElementById('editorContainer');
  var editorLoading   = document.getElementById('editorLoading');
  var binaryFileInfo  = document.getElementById('binaryFileInfo');
  var binariesList    = document.getElementById('binariesList');
  var BINARIES_TAB_ID = -999;
  var _loadingWorkspace = false;
  var fxdataRibbon      = document.getElementById('fxdataRibbon');
  var fxdataPlaceholder = document.getElementById('fxdataPlaceholder');
  var fxdataViewToggle  = document.getElementById('fxdataViewToggle');
  var fxdataShowPlaceholder = true;

  fxdataViewToggle.addEventListener('change', function () {
    var checkbox = fxdataViewToggle.querySelector('input');
    fxdataShowPlaceholder = checkbox.checked;
    if (fxdataShowPlaceholder) {
      fxdataPlaceholder.classList.add('visible');
      if (editor) {
        var dn = editor.getDomNode();
        if (dn) dn.style.visibility = 'hidden';
      }
      fxInitViewFromSource();
    } else {
      fxdataPlaceholder.classList.remove('visible');
      if (editor) {
        var dn = editor.getDomNode();
        if (dn) dn.style.visibility = 'visible';
        editor.focus();
      }
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  FX Data View — embedded visual editor
   * ══════════════════════════════════════════════════════════════════════ */

  // DOM refs — FX Data View
  var fxdataEntriesList      = document.getElementById('fxdataEntriesList');
  var fxdataAddEntryBtn      = document.getElementById('fxdataAddEntryBtn');
  var fxdataAddChips         = document.getElementById('fxdataAddChips');
  var fxdataPreviewContent   = document.getElementById('fxdataPreviewContent');
  var fxdataPreviewRibbon    = document.getElementById('fxdataPreviewRibbon');
  var fxdataPreviewPanel     = document.getElementById('fxdataPreviewPanel');
  var fxdataPreviewCollapseBtn = document.getElementById('fxdataPreviewCollapseBtn');
  var fxdataImageControls    = document.getElementById('fxdataImageControls');
  var fxdataThresholdSlider  = document.getElementById('fxdataThresholdSlider');
  var fxdataThresholdVal     = document.getElementById('fxdataThresholdVal');
  var fxdataSpriteOverride   = document.getElementById('fxdataSpriteOverride');
  var fxdataSpriteFields     = document.getElementById('fxdataSpriteFields');
  var fxdataSpriteWVal       = document.getElementById('fxdataSpriteWVal');
  var fxdataSpriteHVal       = document.getElementById('fxdataSpriteHVal');
  var fxdataSpriteSpacingVal = document.getElementById('fxdataSpriteSpacingVal');
  var fxdataSpriteFramesVal  = document.getElementById('fxdataSpriteFramesVal');
  var fxdataFramesView       = document.getElementById('fxdataFramesView');
  var fxdataHexAccordion     = document.getElementById('fxdataHexAccordion');
  var fxdataHexToggle        = document.getElementById('fxdataHexToggle');
  var fxdataHexBody          = document.getElementById('fxdataHexBody');
  var fxdataResizeHandle     = document.getElementById('fxdataResizeHandle');

  // DOM refs — FX menu new items
  var fxBuildDataMenuBtn      = document.getElementById('fxBuildDataMenuBtn');
  var fxConfirmOverwriteCheckbox = document.getElementById('fxConfirmOverwriteCheckbox');
  var fxAutoBuildCheckbox     = document.getElementById('fxAutoBuildCheckbox');

  // DOM refs — FX memory map in build output
  var fxMemoryMapSection     = document.getElementById('fxMemoryMapSection');
  var fxMemoryMapBar         = document.getElementById('fxMemoryMapBar');
  var fxMemoryMapList        = document.getElementById('fxMemoryMapList');
  var fxMemoryMapSummary     = document.getElementById('fxMemoryMapSummary');

  // ── Type classification ────────────────────────────────────────────
  var FX_NUMERIC_TYPES = [
    'uint8_t', 'uint16_t', 'uint24_t', 'uint32_t',
    'int8_t', 'int16_t', 'int24_t', 'int32_t'
  ];
  var FX_ASSET_TYPES = ['image_t', 'raw_t'];
  var FX_DIRECTIVE_TYPES = ['align', 'savesection', 'datasection', 'namespace', 'namespace_end'];

  var FX_CATEGORY_DEFAULT = {
    number: 'uint8_t', string: 'string', image: 'image_t',
    raw: 'raw_t', directive: 'savesection'
  };

  // ── State ──────────────────────────────────────────────────────────
  var fxViewEntries = [];
  var fxViewLastBuild = null;
  var fxBuildSourceSnapshot = null;
  var fxViewActiveEntryId = null;
  var fxViewSyncTimer = null;
  var fxSourceSyncing = false;
  var fxViewSpriteOverrides = {};
  try {
    var _savedOvr = localStorage.getItem('fxViewSpriteOverrides');
    if (_savedOvr) fxViewSpriteOverrides = JSON.parse(_savedOvr);
  } catch (e) { /* ignore */ }
  var fxViewThreshold = parseInt(localStorage.getItem('fxViewThreshold') || '128', 10);
  var fxViewPreviewScale = '4x';
  var fxViewCurrentPreviewPath = null;
  var fxDraggedId = null;
  var fxViewRestoringState = false;

  // ── Persist / restore active entry index ──────────────────────────
  function fxPersistActiveEntry() {
    if (fxViewRestoringState) return;
    if (fxViewActiveEntryId) {
      for (var i = 0; i < fxViewEntries.length; i++) {
        if (fxViewEntries[i].id === fxViewActiveEntryId) {
          localStorage.setItem('fxViewActiveEntryIndex', String(i));
          return;
        }
      }
    }
    localStorage.removeItem('fxViewActiveEntryIndex');
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function fxMakeEntry(type) {
    return {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'entry-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
      type: type || 'uint8_t',
      name: '',
      value: '',
      comment: ''
    };
  }

  function fxGetEntryCategory(type) {
    if (FX_DIRECTIVE_TYPES.indexOf(type) !== -1) return 'directive';
    if (FX_ASSET_TYPES.indexOf(type) !== -1) return 'asset';
    return 'data';
  }

  function fxTypeHasName(type) {
    return ['savesection', 'datasection', 'namespace_end'].indexOf(type) === -1;
  }

  function fxTypeHasValue(type) {
    return ['savesection', 'datasection', 'namespace_end', 'namespace'].indexOf(type) === -1;
  }

  function fxGetBinaryFilesForType(entryType) {
    var imgExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
    var rawExts = ['.bin', '.dat', '.raw'];
    var exts = (entryType === 'image_t') ? imgExts : rawExts;
    var result = [];
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary) {
        var ext = getExtension(tabs[i].filename).toLowerCase();
        if (exts.indexOf(ext) !== -1) result.push(tabs[i].filename);
      }
    }
    return result.sort();
  }

  function fxGetBinaryData(filename) {
    // Normalize backslashes to forward slashes
    var normalized = filename.replace(/\\/g, '/');
    // Try exact match first
    var tab = findTabByFilename(normalized);
    if (tab && tab.isBinary && tab.binaryData) return tab.binaryData;
    // Try basename match (fxdata.txt may reference 'logo.png' but tab is 'sprites/logo.png')
    var base = normalized.replace(/.*\//, '');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary && tabs[i].binaryData) {
        if (tabs[i].filename.replace(/.*\//, '') === base) return tabs[i].binaryData;
      }
    }
    return null;
  }

  /** Resolve a filename (possibly basename-only) to the actual tab filename. */
  function fxResolveBinaryPath(filename) {
    var normalized = filename.replace(/\\/g, '/');
    var tab = findTabByFilename(normalized);
    if (tab && tab.isBinary) return tab.filename;
    var base = normalized.replace(/.*\//, '');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary) {
        if (tabs[i].filename.replace(/.*\//, '') === base) return tabs[i].filename;
      }
    }
    return filename; // fallback to original
  }

  /**
   * Check if an entry value (path with possible quotes) matches a tab filename.
   * Handles: backslash normalization, exact match, and basename fallback.
   */
  function fxPathMatchesFile(entryValue, tabFilename) {
    var clean = (entryValue || '').replace(/^["']|["']$/g, '').replace(/\\/g, '/');
    if (!clean) return false;
    // Exact match
    if (tabFilename === clean) return true;
    // Basename match (entry references 'logo.png', tab is 'sprites/logo.png' or vice versa)
    var entryBase = clean.replace(/.*\//, '');
    var tabBase = tabFilename.replace(/.*\//, '');
    return entryBase === tabBase;
  }

  /** Find the fxdata.txt tab using basename matching (consistent with ribbon/watcher logic). */
  function findFxdataTab() {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].filename.replace(/.*\//, '').toLowerCase() === 'fxdata.txt') {
        return tabs[i];
      }
    }
    return null;
  }

  // ── Initialize view from source ────────────────────────────────────
  function fxInitViewFromSource() {
    var bridge = window.__fxBridge;
    if (!bridge) {
      // Bridge not yet loaded — retry after a short delay
      setTimeout(function () {
        if (fxdataShowPlaceholder) fxInitViewFromSource();
      }, 200);
      return;
    }
    var fxTab = findFxdataTab();
    if (fxTab && fxTab.model) {
      fxViewEntries = bridge.sourceToEntries(fxTab.model.getValue());
    } else {
      fxViewEntries = [];
    }
    fxRenderEntriesPanel();

    // Restore persisted entry selection
    var savedIdx = parseInt(localStorage.getItem('fxViewActiveEntryIndex'), 10);
    if (!isNaN(savedIdx) && savedIdx >= 0 && savedIdx < fxViewEntries.length) {
      fxViewRestoringState = true;
      fxViewActiveEntryId = fxViewEntries[savedIdx].id;
      fxRenderEntriesPanel();
      fxShowPreview(fxViewEntries[savedIdx]);
      var activeCard = fxdataEntriesList.querySelector('.fxdata-view-entry-card.active');
      if (activeCard) activeCard.scrollIntoView({ block: 'nearest' });
      // Re-open pixel editor if it was open before refresh
      if (localStorage.getItem('fxViewPixelEditorOpen') === 'true') {
        setTimeout(function () {
          var editBtn = fxdataPreviewContent ? fxdataPreviewContent.querySelector('.fxdata-view-edit-btn') : null;
          if (editBtn) editBtn.click();
          fxViewRestoringState = false;
        }, 150);
      } else {
        fxViewRestoringState = false;
      }
    }
  }

  // ── Debounced source sync (entries → Monaco model) ─────────────────
  function fxSyncEntriesToSource() {
    if (fxViewSyncTimer) clearTimeout(fxViewSyncTimer);
    fxViewSyncTimer = setTimeout(function () {
      fxViewSyncTimer = null;
      var bridge = window.__fxBridge;
      if (!bridge) return;
      var source = bridge.entriesToSource(fxViewEntries);
      var fxTab = findFxdataTab();
      if (fxTab && fxTab.model) {
        var current = fxTab.model.getValue();
        if (current !== source) {
          fxSourceSyncing = true;
          fxTab.model.setValue(source);
          fxSourceSyncing = false;
        }
      }
    }, 300);
  }

  // ── Watch fxdata.txt model for external edits ──────────────────────
  function fxAttachModelWatcher(tab) {
    if (!tab || !tab.model) return;
    tab.model._fxViewWatcher = tab.model.onDidChangeContent(function () {
      if (fxSourceSyncing) return;
      if (!fxdataShowPlaceholder) return;
      var bridge = window.__fxBridge;
      if (!bridge) return;
      if (fxViewSyncTimer) { clearTimeout(fxViewSyncTimer); fxViewSyncTimer = null; }
      fxViewEntries = bridge.sourceToEntries(tab.model.getValue());
      fxRenderEntriesPanel();
    });
  }

  // ── Entries panel rendering ────────────────────────────────────────
  function fxRenderEntriesPanel() {
    if (!fxdataEntriesList) return;

    // Detach add-row before clearing to prevent its destruction
    var addRow = document.getElementById('fxdataAddRow');
    if (addRow && addRow.parentNode) {
      addRow.parentNode.removeChild(addRow);
    }

    fxdataEntriesList.innerHTML = '';

    if (fxViewEntries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'fxdata-view-empty-entries';
      empty.innerHTML = '<p>No entries yet.</p><p>Click + to add, or edit fxdata.txt directly.</p>';
      fxdataEntriesList.appendChild(empty);
    } else {
      for (var i = 0; i < fxViewEntries.length; i++) {
        fxdataEntriesList.appendChild(fxCreateEntryCard(fxViewEntries[i]));
      }
    }

    // Re-attach add-row at the end
    if (addRow) fxdataEntriesList.appendChild(addRow);
  }

  // ── Entry card creation ────────────────────────────────────────────
  function fxCreateEntryCard(entry) {
    var card = document.createElement('div');
    card.className = 'fxdata-view-entry-card';
    card.dataset.id = entry.id;
    if (entry.id === fxViewActiveEntryId) card.classList.add('active');

    // Drag handle
    var dragHandle = document.createElement('span');
    dragHandle.className = 'fxdata-view-entry-drag';
    dragHandle.textContent = '';
    card.appendChild(dragHandle);

    // Drag events
    card.draggable = true;
    card.addEventListener('dragstart', function (e) {
      fxDraggedId = entry.id;
      e.dataTransfer.setData('text/plain', entry.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function () {
      fxDraggedId = null;
      card.classList.remove('dragging');
      // Clear all drag-over indicators
      fxdataEntriesList.querySelectorAll('.drag-over').forEach(function (el) {
        el.classList.remove('drag-over');
      });
    });
    card.addEventListener('dragover', function (e) {
      if (!fxDraggedId || fxDraggedId === entry.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', function () {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!fxDraggedId || fxDraggedId === entry.id) return;
      fxReorderEntries(fxDraggedId, entry.id);
    });

    // Body container
    var body = document.createElement('div');
    body.className = 'fxdata-view-entry-body';

    var category = fxGetEntryCategory(entry.type);
    var hasName = fxTypeHasName(entry.type) && entry.type !== 'align';
    var hasValue = fxTypeHasValue(entry.type);
    if (hasName && hasValue) body.classList.add('has-name-value');
    else if (hasName) body.classList.add('has-name-only');
    else if (hasValue) body.classList.add('has-value-only');
    else body.classList.add('has-type-only');

    // Type selector / badge
    if (FX_NUMERIC_TYPES.indexOf(entry.type) !== -1) {
      var typeSelect = document.createElement('select');
      typeSelect.className = 'fxdata-view-type-select fxdata-view-type-data';
      for (var n = 0; n < FX_NUMERIC_TYPES.length; n++) {
        var opt = document.createElement('option');
        opt.value = FX_NUMERIC_TYPES[n];
        opt.textContent = FX_NUMERIC_TYPES[n];
        if (FX_NUMERIC_TYPES[n] === entry.type) opt.selected = true;
        typeSelect.appendChild(opt);
      }
      typeSelect.addEventListener('change', function () {
        entry.type = typeSelect.value;
        fxSyncEntriesToSource();
      });
      typeSelect.addEventListener('focus', function () {
        fxViewActiveEntryId = entry.id;
        fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === entry.id);
        });
        fxShowPreview(entry);
      });
      body.appendChild(typeSelect);
    } else if (FX_DIRECTIVE_TYPES.indexOf(entry.type) !== -1) {
      var dirSelect = document.createElement('select');
      dirSelect.className = 'fxdata-view-type-select fxdata-view-type-directive';
      for (var d = 0; d < FX_DIRECTIVE_TYPES.length; d++) {
        var dopt = document.createElement('option');
        dopt.value = FX_DIRECTIVE_TYPES[d];
        dopt.textContent = FX_DIRECTIVE_TYPES[d];
        if (FX_DIRECTIVE_TYPES[d] === entry.type) dopt.selected = true;
        dirSelect.appendChild(dopt);
      }
      dirSelect.addEventListener('change', function () {
        entry.type = dirSelect.value;
        fxRenderEntriesPanel();
        fxSyncEntriesToSource();
      });
      dirSelect.addEventListener('focus', function () {
        fxViewActiveEntryId = entry.id;
        fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === entry.id);
        });
        fxShowPreview(entry);
      });
      body.appendChild(dirSelect);
    } else {
      var badge = document.createElement('span');
      badge.className = 'fxdata-view-type-badge fxdata-view-type-' + category;
      badge.textContent = entry.type;
      body.appendChild(badge);
    }

    // Name input
    if (fxTypeHasName(entry.type) && entry.type !== 'align') {
      var nameInput = document.createElement('input');
      nameInput.className = 'fxdata-view-entry-name';
      nameInput.type = 'text';
      nameInput.placeholder = 'name';
      nameInput.value = entry.name || '';
      nameInput.addEventListener('input', function () {
        entry.name = nameInput.value;
        fxSyncEntriesToSource();
      });
      nameInput.addEventListener('focus', function () {
        fxViewActiveEntryId = entry.id;
        fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card').forEach(function (c) {
          c.classList.toggle('active', c.dataset.id === entry.id);
        });
        fxShowPreview(entry);
      });
      body.appendChild(nameInput);
    }

    // = separator + value
    if (fxTypeHasValue(entry.type)) {
      if (fxTypeHasName(entry.type) && entry.type !== 'align') {
        var sep = document.createElement('span');
        sep.className = 'fxdata-view-entry-sep';
        sep.textContent = '=';
        body.appendChild(sep);
      }

      if (entry.type === 'image_t' || entry.type === 'raw_t') {
        var assetSelect = document.createElement('select');
        assetSelect.className = 'fxdata-view-asset-select';

        // If this entry's file has a sprite override, mark the select
        var entryFilePath = (entry.value || '').replace(/^["']|["']$/g, '');
        if (fxHasSpriteOverride(entryFilePath)) {
          assetSelect.classList.add('fxdata-view-sprite-overridden');
        }

        var placeholderOpt = document.createElement('option');
        placeholderOpt.value = '';
        placeholderOpt.textContent = 'Select image...';
        placeholderOpt.disabled = true;
        placeholderOpt.hidden = true;
        assetSelect.appendChild(placeholderOpt);

        var files = fxGetBinaryFilesForType(entry.type);
        var hasSelection = false;
        for (var f = 0; f < files.length; f++) {
          var fopt = document.createElement('option');
          fopt.value = '"' + files[f] + '"';
          fopt.textContent = files[f];
          if (fxPathMatchesFile(entry.value, files[f])) { fopt.selected = true; hasSelection = true; }
          assetSelect.appendChild(fopt);
        }
        if (!hasSelection) {
          placeholderOpt.selected = true;
        }
        assetSelect.addEventListener('change', function () {
          entry.value = assetSelect.value;
          fxSyncEntriesToSource();
          fxShowPreview(entry);
        });
        assetSelect.addEventListener('focus', function () {
          fxViewActiveEntryId = entry.id;
          fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card').forEach(function (c) {
            c.classList.toggle('active', c.dataset.id === entry.id);
          });
          fxShowPreview(entry);
        });
        body.appendChild(assetSelect);
      } else {
        var valueInput = document.createElement('input');
        valueInput.className = 'fxdata-view-entry-value';
        valueInput.type = 'text';
        valueInput.placeholder = entry.type === 'align' ? '256' : 'value';
        valueInput.value = entry.value || '';
        valueInput.addEventListener('input', function () {
          entry.value = valueInput.value;
          fxSyncEntriesToSource();
        });
        valueInput.addEventListener('focus', function () {
          fxViewActiveEntryId = entry.id;
          fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card').forEach(function (c) {
            c.classList.toggle('active', c.dataset.id === entry.id);
          });
          fxShowPreview(entry);
        });
        body.appendChild(valueInput);
      }
    }

    card.appendChild(body);

    // Delete button
    var delBtn = document.createElement('button');
    delBtn.className = 'fxdata-view-entry-delete';
    delBtn.textContent = '\u00D7';
    delBtn.title = 'Remove entry';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      for (var r = 0; r < fxViewEntries.length; r++) {
        if (fxViewEntries[r].id === entry.id) {
          fxViewEntries.splice(r, 1);
          break;
        }
      }
      if (fxViewActiveEntryId === entry.id) {
        fxViewActiveEntryId = null;
        fxPersistActiveEntry();
        fxClearPreview();
      }
      fxRenderEntriesPanel();
      fxSyncEntriesToSource();
    });
    card.appendChild(delBtn);

    // Click to preview
    card.addEventListener('click', function (e) {
      if (e.target === delBtn) return;
      fxViewActiveEntryId = entry.id;
      fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card').forEach(function (c) {
        c.classList.toggle('active', c.dataset.id === entry.id);
      });
      fxShowPreview(entry);
    });

    return card;
  }

  // ── Reorder entries ────────────────────────────────────────────────
  function fxReorderEntries(draggedId, targetId) {
    var fromIdx = -1, toIdx = -1;
    for (var i = 0; i < fxViewEntries.length; i++) {
      if (fxViewEntries[i].id === draggedId) fromIdx = i;
      if (fxViewEntries[i].id === targetId) toIdx = i;
    }
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    var moved = fxViewEntries.splice(fromIdx, 1)[0];
    fxViewEntries.splice(toIdx, 0, moved);
    fxRenderEntriesPanel();
    fxSyncEntriesToSource();
  }

  // ── Add entry flyout ───────────────────────────────────────────────
  if (fxdataAddEntryBtn) {
    fxdataAddEntryBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (fxdataAddChips) fxdataAddChips.classList.toggle('hidden');
    });
  }

  if (fxdataAddChips) {
    fxdataAddChips.querySelectorAll('.fxdata-view-chip').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        var cat = chip.dataset.category;
        var type = FX_CATEGORY_DEFAULT[cat] || 'uint8_t';
        fxViewEntries.push(fxMakeEntry(type));
        fxdataAddChips.classList.add('hidden');
        fxRenderEntriesPanel();
        fxSyncEntriesToSource();
        // Scroll to bottom
        if (fxdataEntriesList) fxdataEntriesList.scrollTop = fxdataEntriesList.scrollHeight;
      });
    });
  }

  // Close flyout on outside click
  document.addEventListener('click', function (e) {
    if (fxdataAddChips && !fxdataAddChips.classList.contains('hidden')) {
      var hub = document.getElementById('fxdataAddHub');
      if (hub && !hub.contains(e.target)) {
        fxdataAddChips.classList.add('hidden');
      }
    }
  }, true);

  // ── Preview panel ──────────────────────────────────────────────────
  function fxClearPreview() {
    if (fxdataPreviewContent) {
      fxdataPreviewContent.innerHTML = '<div class="fxdata-view-empty-preview">Select an entry to preview.</div>';
    }
    if (fxdataPreviewRibbon) { fxdataPreviewRibbon.innerHTML = ''; fxdataPreviewRibbon.classList.add('hidden'); }
    if (fxdataImageControls) fxdataImageControls.classList.add('hidden');
    if (fxdataHexAccordion) fxdataHexAccordion.classList.add('hidden');
    fxViewCurrentPreviewPath = null;
  }

  function fxShowPreview(entry) {
    if (!fxdataPreviewContent) return;
    fxViewActiveEntryId = entry.id;
    fxPersistActiveEntry();

    if (entry.type === 'image_t') {
      var path = (entry.value || '').replace(/^["']|["']$/g, '').replace(/\\/g, '/');
      if (!path) {
        fxClearPreview();
        return;
      }
      fxViewCurrentPreviewPath = fxResolveBinaryPath(path);
      var data = fxGetBinaryData(path);
      if (!data) {
        fxdataPreviewContent.innerHTML = '<div class="fxdata-view-empty-preview">File not found: ' + escapeHtml(path) + '</div>';
        if (fxdataImageControls) fxdataImageControls.classList.add('hidden');
        if (fxdataHexAccordion) fxdataHexAccordion.classList.add('hidden');
        return;
      }
      fxRenderImagePreview(data, fxViewCurrentPreviewPath);
    } else if (entry.type === 'raw_t') {
      var rpath = (entry.value || '').replace(/^["']|["']$/g, '').replace(/\\/g, '/');
      if (!rpath) { fxClearPreview(); return; }
      fxViewCurrentPreviewPath = fxResolveBinaryPath(rpath);
      var rdata = fxGetBinaryData(rpath);
      if (!rdata) {
        fxdataPreviewContent.innerHTML = '<div class="fxdata-view-empty-preview">File not found: ' + escapeHtml(rpath) + '</div>';
        if (fxdataImageControls) fxdataImageControls.classList.add('hidden');
        if (fxdataHexAccordion) fxdataHexAccordion.classList.add('hidden');
        return;
      }
      fxRenderRawPreview(rdata, fxViewCurrentPreviewPath);
    } else {
      fxRenderDataPreview(entry);
    }
  }

  function fxRenderImagePreview(data, path) {
    var blob = new Blob([data]);
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      fxdataPreviewContent.innerHTML = '';

      // Draw to offscreen canvas to get raw pixel data
      var offCanvas = document.createElement('canvas');
      offCanvas.width = img.width;
      offCanvas.height = img.height;
      var offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(img, 0, 0);
      var rawData = offCtx.getImageData(0, 0, img.width, img.height);
      var pixels = rawData.data;

      // Cache raw pixels for threshold-only redraws
      fxViewCachedRawPixels = pixels;
      fxViewCachedImgWidth = img.width;
      fxViewCachedImgHeight = img.height;

      // Determine if image has been edited (used below for badge + revert)
      var pvTab = findTabByFilename(fxViewCurrentPreviewPath);
      if (!pvTab) {
        var pvBase = fxViewCurrentPreviewPath.replace(/.*\//, '');
        for (var pvi = 0; pvi < tabs.length; pvi++) {
          if (tabs[pvi].isBinary && tabs[pvi].filename.replace(/.*\//, '') === pvBase) {
            pvTab = tabs[pvi]; break;
          }
        }
      }
      var isEdited = pvTab && pvTab.imageEdited;

      // Populate the ribbon toolbar (sits between header and content)
      if (fxdataPreviewRibbon) {
        fxdataPreviewRibbon.innerHTML = '';
        fxdataPreviewRibbon.classList.remove('hidden');

        var zoomLabel = document.createElement('span');
        zoomLabel.className = 'fxdata-view-label';
        zoomLabel.textContent = 'Zoom';
        fxdataPreviewRibbon.appendChild(zoomLabel);

        var scaleSelect = document.createElement('select');
        scaleSelect.className = 'fxdata-view-scale-select';
        scaleSelect.setAttribute('aria-label', 'Preview scale');
        var scaleOptions = [
          { value: '1x', label: '1\u00D7' }, { value: '2x', label: '2\u00D7' },
          { value: '4x', label: '4\u00D7' }, { value: '8x', label: '8\u00D7' },
          { value: '12x', label: '12\u00D7' }, { value: '16x', label: '16\u00D7' },
          { value: '24x', label: '24\u00D7' }, { value: '32x', label: '32\u00D7' },
          { value: 'fill', label: 'Fill' }
        ];
        var currentScale = fxViewPreviewScale || '4x';
        for (var si = 0; si < scaleOptions.length; si++) {
          var opt = document.createElement('option');
          opt.value = scaleOptions[si].value;
          opt.textContent = scaleOptions[si].label;
          if (scaleOptions[si].value === currentScale) opt.selected = true;
          scaleSelect.appendChild(opt);
        }
        scaleSelect.addEventListener('change', function () { fxApplyPreviewScale(); });
        fxdataPreviewRibbon.appendChild(scaleSelect);

        // Threshold button with dropdown
        if (fxdataThresholdSlider) {
          var sepTh = document.createElement('span');
          sepTh.className = 'fxdata-view-ribbon-sep';
          fxdataPreviewRibbon.appendChild(sepTh);

          var thWrap = document.createElement('span');
          thWrap.className = 'fxdata-threshold-dropdown-wrap';

          var thBtn = document.createElement('button');
          thBtn.className = 'fxdata-threshold-btn';
          thBtn.title = 'Adjust brightness threshold';
          thBtn.textContent = 'Threshold';
          thWrap.appendChild(thBtn);

          var thPanel = document.createElement('div');
          thPanel.className = 'fxdata-threshold-panel';
          fxdataThresholdSlider.className = 'fxdata-ribbon-threshold-slider';
          fxdataThresholdSlider.removeAttribute('style');
          thPanel.appendChild(fxdataThresholdSlider);
          var thValRow = document.createElement('div');
          thValRow.className = 'fxdata-threshold-panel-val';
          if (fxdataThresholdVal) {
            fxdataThresholdVal.className = 'fxdata-threshold-panel-val-inner';
            fxdataThresholdVal.removeAttribute('style');
            thValRow.appendChild(fxdataThresholdVal);
          }
          thPanel.appendChild(thValRow);
          thWrap.appendChild(thPanel);

          // Position the value label under the slider thumb
          function fxUpdateThresholdValPos() {
            if (!fxdataThresholdVal) return;
            var min = parseFloat(fxdataThresholdSlider.min) || 0;
            var max = parseFloat(fxdataThresholdSlider.max) || 255;
            var val = parseFloat(fxdataThresholdSlider.value) || 0;
            var pct = (val - min) / (max - min);
            // Account for thumb width (~14px) so edges align properly
            var sliderWidth = fxdataThresholdSlider.offsetWidth || 140;
            var thumbHalf = 7;
            var usable = sliderWidth - thumbHalf * 2;
            var px = thumbHalf + pct * usable;
            fxdataThresholdVal.style.left = px + 'px';
          }
          fxdataThresholdSlider.addEventListener('input', fxUpdateThresholdValPos);
          // Initial position after panel is first shown
          var thPanelObserver = new MutationObserver(function () {
            if (thWrap.classList.contains('open')) fxUpdateThresholdValPos();
          });
          thPanelObserver.observe(thWrap, { attributes: true, attributeFilter: ['class'] });

          thBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = thWrap.classList.toggle('open');
            if (isOpen) {
              fxUpdateThresholdValPos();
            }
          });
          // Close when clicking outside the entire wrapper
          document.addEventListener('pointerdown', function (ev) {
            if (!thWrap.classList.contains('open')) return;
            if (thWrap.contains(ev.target)) return;
            thWrap.classList.remove('open');
          });
          // Prevent pointer events inside panel from bubbling
          thPanel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
          thPanel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          thPanel.addEventListener('click', function (e) { e.stopPropagation(); });

          fxdataPreviewRibbon.appendChild(thWrap);
        }

        // Edit/Revert buttons in the ribbon
        {
          var sep2 = document.createElement('span');
          sep2.className = 'fxdata-view-ribbon-sep';
          fxdataPreviewRibbon.appendChild(sep2);

          var editBtn = document.createElement('button');
          editBtn.className = 'fxdata-view-edit-btn';
          editBtn.textContent = 'Edit';
          editBtn.title = 'Open pixel editor';
          editBtn.addEventListener('click', function () {
          if (!window.__pixelEditor) return;
          localStorage.setItem('fxViewPixelEditorOpen', 'true');
          // Stash original data before first edit
          var curTab = findTabByFilename(fxViewCurrentPreviewPath);
          if (!curTab) {
            var curBase = fxViewCurrentPreviewPath.replace(/.*\//, '');
            for (var ti = 0; ti < tabs.length; ti++) {
              if (tabs[ti].isBinary && tabs[ti].filename.replace(/.*\//, '') === curBase) {
                curTab = tabs[ti]; break;
              }
            }
          }
          if (curTab && curTab.isBinary && !curTab.originalBinaryData) {
            curTab.originalBinaryData = new Uint8Array(curTab.binaryData);
          }

          window.__pixelEditor.open(rawData, {
            filename: path,
            threshold: fxViewThreshold,
            onSave: function (editedImageData, meta) {
              // Convert back to PNG
              var c = new OffscreenCanvas(editedImageData.width, editedImageData.height);
              var cx = c.getContext('2d');
              cx.putImageData(editedImageData, 0, 0);
              c.convertToBlob({ type: 'image/png' }).then(function (blob) {
                return blob.arrayBuffer();
              }).then(function (buf) {
                var bytes = new Uint8Array(buf);
                // Update binary tab data
                var tab = findTabByFilename(fxViewCurrentPreviewPath);
                if (!tab) {
                  // Try basename match
                  var base = fxViewCurrentPreviewPath.replace(/.*\//, '');
                  for (var i = 0; i < tabs.length; i++) {
                    if (tabs[i].isBinary && tabs[i].filename.replace(/.*\//, '') === base) {
                      tab = tabs[i];
                      break;
                    }
                  }
                }
                if (tab && tab.isBinary) {
                  tab.binaryData = bytes;
                  tab.binarySize = bytes.length;
                  tab.imageEdited = true;
                  renderBinariesList();
                  saveWorkspaceToLocalStorage();
                }
                // Update threshold
                fxViewThreshold = meta.threshold;
                if (fxdataThresholdSlider) fxdataThresholdSlider.value = fxViewThreshold;
                if (fxdataThresholdVal) fxdataThresholdVal.textContent = fxViewThreshold;
                localStorage.setItem('fxViewThreshold', fxViewThreshold);
                // Re-render preview
                fxRenderImagePreview(bytes, fxViewCurrentPreviewPath);
              });
            },
            onThresholdChange: function (val) {
              fxViewThreshold = val;
              if (fxdataThresholdSlider) fxdataThresholdSlider.value = fxViewThreshold;
              if (fxdataThresholdVal) fxdataThresholdVal.textContent = fxViewThreshold;
            },
            onClose: function () {
              localStorage.removeItem('fxViewPixelEditorOpen');
            },
          });
        });
        fxdataPreviewRibbon.appendChild(editBtn);

        // Revert button — only shown if image has been edited
        var previewTab = findTabByFilename(fxViewCurrentPreviewPath);
        if (!previewTab) {
          var pBase = fxViewCurrentPreviewPath.replace(/.*\//, '');
          for (var pi = 0; pi < tabs.length; pi++) {
            if (tabs[pi].isBinary && tabs[pi].filename.replace(/.*\//, '') === pBase) {
              previewTab = tabs[pi]; break;
            }
          }
        }
        if (previewTab && previewTab.imageEdited && previewTab.originalBinaryData) {
          var spacer = document.createElement('span');
          spacer.className = 'fxdata-view-ribbon-spacer';
          fxdataPreviewRibbon.appendChild(spacer);

          var revertBtn = document.createElement('button');
          revertBtn.className = 'fxdata-view-revert-btn';
          revertBtn.textContent = 'Revert';
          revertBtn.title = 'Revert to original image';
          revertBtn.addEventListener('click', function () {
            showConfirmModal('Revert Image', 'Revert this image to the original? Your edits will be lost and this cannot be undone.', 'Revert').then(function (ok) {
              if (!ok) return;
              var tab = findTabByFilename(fxViewCurrentPreviewPath);
              if (!tab) {
                var rBase = fxViewCurrentPreviewPath.replace(/.*\//, '');
                for (var ri = 0; ri < tabs.length; ri++) {
                  if (tabs[ri].isBinary && tabs[ri].filename.replace(/.*\//, '') === rBase) {
                    tab = tabs[ri]; break;
                  }
                }
              }
              if (tab && tab.originalBinaryData) {
                tab.binaryData = new Uint8Array(tab.originalBinaryData);
                tab.binarySize = tab.binaryData.length;
                tab.imageEdited = false;
                tab.originalBinaryData = null;
                renderBinariesList();
                saveWorkspaceToLocalStorage();
                fxRenderImagePreview(tab.binaryData, fxViewCurrentPreviewPath);
              }
            });
          });
          fxdataPreviewRibbon.appendChild(revertBtn);
        }
        } // end pixelEditor
      } // end ribbon

      // 1-bit threshold preview canvas
      var threshCanvas = document.createElement('canvas');
      threshCanvas.width = img.width;
      threshCanvas.height = img.height;
      threshCanvas.className = 'fxdata-view-preview-canvas';
      var tctx = threshCanvas.getContext('2d');
      var out = tctx.createImageData(img.width, img.height);
      for (var p = 0; p < pixels.length; p += 4) {
        var alpha = pixels[p + 3];
        var green = pixels[p + 1]; // green channel, matching FX encoder
        if (alpha < 128) {
          // Transparent → app green matte (#34d399)
          out.data[p] = 52; out.data[p + 1] = 211; out.data[p + 2] = 153; out.data[p + 3] = 255;
        } else if (green > fxViewThreshold) {
          out.data[p] = out.data[p + 1] = out.data[p + 2] = 255;
          out.data[p + 3] = 255;
        } else {
          out.data[p] = out.data[p + 1] = out.data[p + 2] = 0;
          out.data[p + 3] = 255;
        }
      }
      tctx.putImageData(out, 0, 0);
      threshCanvas.title = 'Double-click to open pixel editor';
      threshCanvas.addEventListener('dblclick', function () {
        if (editBtn) editBtn.click();
      });
      fxdataPreviewContent.appendChild(threshCanvas);

      // Filename row (with edited badge)
      var filenameRow = document.createElement('div');
      filenameRow.className = 'fxdata-view-file-name';
      filenameRow.appendChild(document.createTextNode(escapeHtml(path)));
      if (isEdited) {
        var editedBadge = document.createElement('span');
        editedBadge.className = 'fxdata-view-edited-badge';
        editedBadge.textContent = 'EDITED';
        filenameRow.appendChild(editedBadge);
      }
      fxdataPreviewContent.appendChild(filenameRow);

      // Dimensions row
      var dimRow = document.createElement('div');
      dimRow.className = 'fxdata-view-file-size';
      dimRow.textContent = img.width + ' \u00D7 ' + img.height + ' px';
      fxdataPreviewContent.appendChild(dimRow);

      // File size row
      var sizeRow = document.createElement('div');
      sizeRow.className = 'fxdata-view-file-size';
      sizeRow.textContent = data.length + ' bytes';
      fxdataPreviewContent.appendChild(sizeRow);

      // Show image controls and populate sprite override state for this file
      if (fxdataImageControls) fxdataImageControls.classList.remove('hidden');
      if (fxdataThresholdSlider) fxdataThresholdSlider.value = fxViewThreshold;
      if (fxdataThresholdVal) fxdataThresholdVal.textContent = fxViewThreshold;
      fxPopulateSpriteOverrideUI(path, img.width, img.height);

      // Apply current scale setting to the new canvas
      fxApplyPreviewScale();

      // Render frames view
      fxRenderFramesView(img, path);

      // Hex data
      fxRenderHexData(data);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      fxdataPreviewContent.innerHTML = '<div class="fxdata-view-empty-preview">Could not load image: ' + escapeHtml(path) + '</div>';
      if (fxdataImageControls) fxdataImageControls.classList.add('hidden');
    };
    img.src = url;
  }

  function fxCalcFrameCount(imgW, imgH, sprW, sprH, spacing) {
    if (!sprW || !sprH) return 1;
    if (sprW >= imgW && sprH >= imgH) return 1;
    var s = spacing || 0;
    var hframes = Math.max(1, Math.floor((imgW - s) / (sprW + s)));
    var vframes = Math.max(1, Math.floor((imgH - s) / (sprH + s)));
    return hframes * vframes;
  }

  function fxUpdateSpriteFrameCount() {
    if (!fxdataSpriteFramesVal) return;
    var imgW = fxViewCachedImgWidth;
    var imgH = fxViewCachedImgHeight;
    var sprW = parseInt(fxdataSpriteWVal ? fxdataSpriteWVal.textContent : 0, 10) || 0;
    var sprH = parseInt(fxdataSpriteHVal ? fxdataSpriteHVal.textContent : 0, 10) || 0;
    var spacing = parseInt(fxdataSpriteSpacingVal ? fxdataSpriteSpacingVal.textContent : 0, 10) || 0;
    // If override is active, read from inputs instead
    var overrideActive = fxdataSpriteOverride && fxdataSpriteOverride.checked;
    if (overrideActive) {
      var wInput = fxdataSpriteFields ? fxdataSpriteFields.querySelector('#fxdataSpriteW') : null;
      var hInput = fxdataSpriteFields ? fxdataSpriteFields.querySelector('#fxdataSpriteH') : null;
      var sInput = fxdataSpriteFields ? fxdataSpriteFields.querySelector('#fxdataSpriteS') : null;
      if (wInput) sprW = parseInt(wInput.value, 10) || 0;
      if (hInput) sprH = parseInt(hInput.value, 10) || 0;
      if (sInput) spacing = parseInt(sInput.value, 10) || 0;
    }
    var count = fxCalcFrameCount(imgW, imgH, sprW, sprH, spacing);
    fxdataSpriteFramesVal.textContent = count;
  }

  function fxRenderFramesView(img, path) {
    if (!fxdataFramesView) return;
    fxdataFramesView.innerHTML = '';
    fxdataFramesView.classList.add('hidden');

    var bridge = window.__fxBridge;
    var dims = null;

    var ovr = fxViewSpriteOverrides[path];
    if (ovr && ovr.active && ovr.width > 0 && ovr.height > 0) {
      dims = { width: ovr.width, height: ovr.height, spacing: ovr.spacing || 0 };
    } else if (bridge && bridge.parseDimensionsFromFilename) {
      dims = bridge.parseDimensionsFromFilename(path.split('/').pop());
    }

    if (!dims || !dims.width || !dims.height) return;
    if (dims.width >= img.width && dims.height >= img.height) return;

    var spacing = dims.spacing || 0;
    var hframes = Math.max(1, Math.floor((img.width - spacing) / (dims.width + spacing)));
    var vframes = Math.max(1, Math.floor((img.height - spacing) / (dims.height + spacing)));
    var total = hframes * vframes;

    if (total <= 1 || total > 256) return;

    fxdataFramesView.classList.remove('hidden');

    var offCanvas = document.createElement('canvas');
    offCanvas.width = img.width;
    offCanvas.height = img.height;
    var offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(img, 0, 0);
    var rawPixels = offCtx.getImageData(0, 0, img.width, img.height).data;

    var maxCellSize = 48;
    var scale = Math.max(1, Math.min(Math.floor(maxCellSize / Math.max(dims.width, dims.height)), 4));

    for (var v = 0; v < vframes; v++) {
      for (var h = 0; h < hframes; h++) {
        var fi = v * hframes + h;
        if (fi >= 64) break;
        var fx = spacing + h * (dims.width + spacing);
        var fy = spacing + v * (dims.height + spacing);

        var fc = document.createElement('canvas');
        fc.width = dims.width * scale;
        fc.height = dims.height * scale;
        fc.className = 'fxdata-view-frame-cell';
        fc.title = 'Frame ' + fi;
        var fctx = fc.getContext('2d');

        for (var y = 0; y < dims.height; y++) {
          for (var x = 0; x < dims.width; x++) {
            var srcX = fx + x;
            var srcY = fy + y;
            if (srcX >= img.width || srcY >= img.height) continue;
            var idx = (srcY * img.width + srcX) * 4;
            var alpha = rawPixels[idx + 3];
            var green = rawPixels[idx + 1];
            if (alpha < 128) {
              fctx.fillStyle = '#34d399';
            } else if (green > fxViewThreshold) {
              fctx.fillStyle = '#ffffff';
            } else {
              fctx.fillStyle = '#000000';
            }
            fctx.fillRect(x * scale, y * scale, scale, scale);
          }
        }

        fxdataFramesView.appendChild(fc);
      }
      if (v * hframes + hframes > 64) break;
    }

    if (total > 64) {
      var more = document.createElement('div');
      more.className = 'fxdata-view-frame-label';
      more.textContent = '... and ' + (total - 64) + ' more';
      fxdataFramesView.appendChild(more);
    }
  }

  function fxRenderRawPreview(data, path) {
    if (fxdataImageControls) fxdataImageControls.classList.add('hidden');
    fxdataPreviewContent.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'fxdata-view-data-preview';
    card.innerHTML =
      '<div class="fxdata-view-data-field"><span class="label">File</span><span class="value">' + escapeHtml(path) + '</span></div>' +
      '<div class="fxdata-view-data-field"><span class="label">Size</span><span class="value">' + data.length + ' bytes</span></div>' +
      '<div class="fxdata-view-data-field"><span class="label">Type</span><span class="value">raw_t</span></div>';
    fxdataPreviewContent.appendChild(card);

    fxRenderHexData(data);
  }

  function fxRenderDataPreview(entry) {
    if (fxdataImageControls) fxdataImageControls.classList.add('hidden');
    if (fxdataHexAccordion) fxdataHexAccordion.classList.add('hidden');
    fxdataPreviewContent.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'fxdata-view-data-preview';
    var html =
      '<div class="fxdata-view-data-field"><span class="label">Type</span><span class="value">' + escapeHtml(entry.type) + '</span></div>';
    if (entry.name) {
      html += '<div class="fxdata-view-data-field"><span class="label">Name</span><span class="value">' + escapeHtml(entry.name) + '</span></div>';
    }
    if (entry.value) {
      html += '<div class="fxdata-view-data-field"><span class="label">Value</span><span class="value">' + escapeHtml(entry.value) + '</span></div>';
    }
    card.innerHTML = html;
    fxdataPreviewContent.appendChild(card);
  }

  function fxRenderHexData(data) {
    if (!fxdataHexAccordion || !fxdataHexBody) return;
    fxdataHexAccordion.classList.remove('hidden');
    var maxBytes = 256;
    var hex = [];
    var len = Math.min(data.length, maxBytes);
    for (var h = 0; h < len; h++) {
      hex.push(data[h].toString(16).padStart(2, '0'));
    }
    fxdataHexBody.textContent = hex.join(' ') + (data.length > maxBytes ? ' ...' : '');
  }

  // ── Preview scale buttons ─────────────────────────────────────────
  function fxApplyPreviewScale() {
    var canvas = fxdataPreviewContent ? fxdataPreviewContent.querySelector('.fxdata-view-preview-canvas') : null;
    if (!canvas) return;
    var sel = fxdataPreviewRibbon ? fxdataPreviewRibbon.querySelector('.fxdata-view-scale-select') : null;
    var scale = sel ? sel.value : '4x';
    fxViewPreviewScale = scale;
    var w = canvas.width;
    var h = canvas.height;

    // Reset
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
    canvas.classList.remove('fxdata-view-fill');

    if (scale === 'fill') {
      canvas.classList.add('fxdata-view-fill');
    } else {
      var m = parseInt(scale, 10);
      if (m > 1) {
        canvas.style.width = (w * m) + 'px';
        canvas.style.height = (h * m) + 'px';
        canvas.style.maxWidth = 'none';
        canvas.style.maxHeight = 'none';
      }
    }
    // '1x' — default CSS handles it (max-width: 100%)
  }

  // ── Threshold slider ───────────────────────────────────────────────
  var fxViewCachedRawPixels = null;
  var fxViewCachedImgWidth = 0;
  var fxViewCachedImgHeight = 0;

  function fxRedrawThresholdCanvas() {
    if (!fxViewCachedRawPixels || !fxdataPreviewContent) return;
    var canvas = fxdataPreviewContent.querySelector('.fxdata-view-preview-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = fxViewCachedImgWidth;
    var h = fxViewCachedImgHeight;
    var out = ctx.createImageData(w, h);
    var pixels = fxViewCachedRawPixels;
    for (var p = 0; p < pixels.length; p += 4) {
      var alpha = pixels[p + 3];
      var green = pixels[p + 1];
      if (alpha < 128) {
        out.data[p] = 52; out.data[p + 1] = 211; out.data[p + 2] = 153; out.data[p + 3] = 255;
      } else if (green > fxViewThreshold) {
        out.data[p] = out.data[p + 1] = out.data[p + 2] = 255;
        out.data[p + 3] = 255;
      } else {
        out.data[p] = out.data[p + 1] = out.data[p + 2] = 0;
        out.data[p + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  if (fxdataThresholdSlider) {
    fxdataThresholdSlider.value = fxViewThreshold;
    if (fxdataThresholdVal) fxdataThresholdVal.textContent = fxViewThreshold;
    fxdataThresholdSlider.addEventListener('input', function () {
      fxViewThreshold = parseInt(fxdataThresholdSlider.value, 10);
      if (fxdataThresholdVal) fxdataThresholdVal.textContent = fxViewThreshold;
      localStorage.setItem('fxViewThreshold', fxViewThreshold);
      fxRedrawThresholdCanvas();
    });
  }

  function fxRefreshCurrentPreview() {
    if (!fxViewCurrentPreviewPath) return;
    var data = fxGetBinaryData(fxViewCurrentPreviewPath);
    if (data) fxRenderImagePreview(data, fxViewCurrentPreviewPath);
  }

  // ── Populate sprite override UI for the current file ─────────────
  // Helper: swap a span for an input or vice-versa
  function fxSpriteFieldToInput(span, id, min, max) {
    var input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'fxdata-view-sprite-input';
    input.min = min; input.max = max;
    input.value = span.textContent;
    span.parentNode.replaceChild(input, span);
    return input;
  }
  function fxSpriteFieldToSpan(input, id) {
    var span = document.createElement('span');
    span.id = id;
    span.className = 'fxdata-view-sprite-val';
    span.textContent = input.value;
    input.parentNode.replaceChild(span, input);
    return span;
  }

  function fxSetSpriteOverrideMode(active) {
    if (!fxdataSpriteFields) return;
    if (active) {
      fxdataSpriteFields.classList.add('fxdata-view-sprite-editing');
      // Swap spans → inputs for W, H, Spacing
      var wSpan = fxdataSpriteFields.querySelector('#fxdataSpriteWVal');
      var hSpan = fxdataSpriteFields.querySelector('#fxdataSpriteHVal');
      var sSpan = fxdataSpriteFields.querySelector('#fxdataSpriteSpacingVal');
      if (wSpan) { var inp = fxSpriteFieldToInput(wSpan, 'fxdataSpriteW', 1, 1024); fxBindSpriteInput(inp, 'width'); }
      if (hSpan) { var inp2 = fxSpriteFieldToInput(hSpan, 'fxdataSpriteH', 1, 1024); fxBindSpriteInput(inp2, 'height'); }
      if (sSpan) { var inp3 = fxSpriteFieldToInput(sSpan, 'fxdataSpriteS', 0, 256); fxBindSpriteInput(inp3, 'spacing'); }
    } else {
      fxdataSpriteFields.classList.remove('fxdata-view-sprite-editing');
      // Swap inputs → spans
      var wInput = fxdataSpriteFields.querySelector('#fxdataSpriteW');
      var hInput = fxdataSpriteFields.querySelector('#fxdataSpriteH');
      var sInput = fxdataSpriteFields.querySelector('#fxdataSpriteS');
      if (wInput) fxdataSpriteWVal = fxSpriteFieldToSpan(wInput, 'fxdataSpriteWVal');
      if (hInput) fxdataSpriteHVal = fxSpriteFieldToSpan(hInput, 'fxdataSpriteHVal');
      if (sInput) fxdataSpriteSpacingVal = fxSpriteFieldToSpan(sInput, 'fxdataSpriteSpacingVal');
    }
  }

  function fxPopulateSpriteOverrideUI(path, imgW, imgH) {
    var bridge = window.__fxBridge;
    var ovr = fxViewSpriteOverrides[path];
    var parsed = bridge && bridge.parseDimensionsFromFilename
      ? bridge.parseDimensionsFromFilename(path.split('/').pop())
      : { width: 0, height: 0, spacing: 0 };

    // Ensure we're in span mode first (reset from any previous override edit state)
    fxSetSpriteOverrideMode(false);

    var w, h, s;
    if (ovr && ovr.active) {
      w = ovr.width; h = ovr.height; s = ovr.spacing;
      if (fxdataSpriteOverride) fxdataSpriteOverride.checked = true;
    } else {
      w = parsed.width || imgW || 0;
      h = parsed.height || imgH || 0;
      s = parsed.spacing || 0;
      if (fxdataSpriteOverride) fxdataSpriteOverride.checked = false;
    }

    // Populate values in spans
    if (fxdataSpriteWVal) fxdataSpriteWVal.textContent = w;
    if (fxdataSpriteHVal) fxdataSpriteHVal.textContent = h;
    if (fxdataSpriteSpacingVal) fxdataSpriteSpacingVal.textContent = s;

    // If override active, switch to input mode
    if (ovr && ovr.active) {
      fxSetSpriteOverrideMode(true);
    }

    fxUpdateSpriteFrameCount();
  }

  // ── Sprite override controls ───────────────────────────────────────
  if (fxdataSpriteOverride) {
    fxdataSpriteOverride.addEventListener('change', function () {
      var path = fxViewCurrentPreviewPath;
      if (!path) return;

      if (fxdataSpriteOverride.checked) {
        // Read current displayed values before switching to inputs
        var w = parseInt(fxdataSpriteWVal ? fxdataSpriteWVal.textContent : 0, 10) || 0;
        var h = parseInt(fxdataSpriteHVal ? fxdataSpriteHVal.textContent : 0, 10) || 0;
        var s = parseInt(fxdataSpriteSpacingVal ? fxdataSpriteSpacingVal.textContent : 0, 10) || 0;
        var filename = path.split('/').pop();
        fxViewSpriteOverrides[path] = {
          active: true,
          width: w,
          height: h,
          spacing: s,
          originalFilename: filename
        };
        fxSetSpriteOverrideMode(true);
        fxApplySpriteOverrideToFilename(path);
      } else {
        fxSetSpriteOverrideMode(false);
        fxRevertSpriteOverride(path);
        // If revert was blocked, restore UI
        var currentOvr = fxViewSpriteOverrides[fxViewCurrentPreviewPath];
        if (currentOvr && currentOvr.active) {
          fxdataSpriteOverride.checked = true;
          fxSetSpriteOverrideMode(true);
        } else {
          // Restore parsed default values
          var bridge = window.__fxBridge;
          var parsed = bridge && bridge.parseDimensionsFromFilename
            ? bridge.parseDimensionsFromFilename(path.split('/').pop())
            : { width: 0, height: 0, spacing: 0 };
          if (fxdataSpriteWVal) fxdataSpriteWVal.textContent = parsed.width || fxViewCachedImgWidth || 0;
          if (fxdataSpriteHVal) fxdataSpriteHVal.textContent = parsed.height || fxViewCachedImgHeight || 0;
          if (fxdataSpriteSpacingVal) fxdataSpriteSpacingVal.textContent = parsed.spacing || 0;
        }
      }
      fxUpdateSpriteFrameCount();
      try { localStorage.setItem('fxViewSpriteOverrides', JSON.stringify(fxViewSpriteOverrides)); } catch (e) { /* ignore */ }
    });
  }

  function fxBindSpriteInput(inputEl, prop) {
    if (!inputEl) return;
    inputEl.addEventListener('change', function () {
      var path = fxViewCurrentPreviewPath;
      if (!path) return;
      var ovr = fxViewSpriteOverrides[path];
      if (!ovr || !ovr.active) return;
      ovr[prop] = parseInt(inputEl.value, 10) || 0;
      fxApplySpriteOverrideToFilename(path);
      fxUpdateSpriteFrameCount();
      try { localStorage.setItem('fxViewSpriteOverrides', JSON.stringify(fxViewSpriteOverrides)); } catch (e) { /* ignore */ }
    });
  }

  // ── Apply sprite override by renaming the file ─────────────────────
  function fxApplySpriteOverrideToFilename(originalPath) {
    var ovr = fxViewSpriteOverrides[originalPath];
    if (!ovr) return;

    var width = ovr.width;
    var height = ovr.height;
    var spacing = ovr.spacing;
    var origFilename = ovr.originalFilename;

    // Build new filename: strip old dimensions, add new ones
    var ext = origFilename.slice(origFilename.lastIndexOf('.'));
    var nameOnly = origFilename.slice(0, origFilename.lastIndexOf('.'));
    var elements = nameOnly.split('_');
    var cleaned = [];
    var foundDims = false;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!foundDims && i > 0) {
        var parts = el.split('x').filter(function (s) { return s.length > 0; });
        if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
          foundDims = true;
          if (i + 1 < elements.length && /^\d+$/.test(elements[i + 1])) {
            i++; // skip spacing too
          }
          continue;
        }
      }
      cleaned.push(el);
    }

    var baseName = cleaned.join('_') || 'sprite';
    var newFilename;
    if (width > 0 && height > 0) {
      newFilename = baseName + '_' + width + 'x' + height;
      if (spacing > 0) newFilename += '_' + spacing;
      newFilename += ext;
    } else {
      newFilename = baseName + ext;
    }

    // Compute full new path
    var folder = originalPath.indexOf('/') !== -1 ? originalPath.slice(0, originalPath.lastIndexOf('/')) : '';
    var newPath = folder ? folder + '/' + newFilename : newFilename;

    if (newPath !== originalPath) {
      // Check for collision
      if (findTabByFilename(newPath)) {
        setStatus('Cannot apply sprite override — "' + newFilename + '" already exists');
        return;
      }

      // Rename the tab
      var tab = findTabByFilename(originalPath);
      if (tab) {
        if (tab.filename === selectedFxDataFilename) {
          selectedFxDataFilename = newPath;
          localStorage.setItem('selectedFxDataFile', newPath);
        }
        tab.filename = newPath;
      }

      // Update FX data entries referencing the old path
      for (var ei = 0; ei < fxViewEntries.length; ei++) {
        var entry = fxViewEntries[ei];
        if (entry.type === 'image_t' || entry.type === 'raw_t') {
          var val = (entry.value || '').replace(/^["']|["']$/g, '');
          if (fxPathMatchesFile(val, originalPath)) {
            // Preserve original prefix (e.g. '../') by replacing only the basename
            var oldBase = originalPath.replace(/.*\//, '');
            entry.value = '"' + val.replace(oldBase, newFilename) + '"';
          }
        }
      }

      // Move the override to the new path key
      delete fxViewSpriteOverrides[originalPath];
      fxViewSpriteOverrides[newPath] = ovr;

      fxViewCurrentPreviewPath = newPath;
      fxSyncEntriesToSource();
      fxRenderEntriesPanel();
      renderBinariesList();
      renderTabBar();
      saveWorkspaceToLocalStorage();

      // Re-render preview with new path
      var data = fxGetBinaryData(newPath);
      if (data) fxRenderImagePreview(data, newPath);
    } else {
      // Path didn't change, just re-render frames
      fxRefreshCurrentPreview();
    }
  }

  // ── Revert sprite override: rename file back to original ───────────
  function fxRevertSpriteOverride(currentPath) {
    var ovr = fxViewSpriteOverrides[currentPath];
    if (!ovr) return;

    var origFilename = ovr.originalFilename;
    var folder = currentPath.indexOf('/') !== -1 ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
    var originalPath = folder ? folder + '/' + origFilename : origFilename;

    ovr.active = false;

    if (currentPath !== originalPath) {
      // Check for collision
      if (findTabByFilename(originalPath)) {
        setStatus('Cannot revert sprite override — "' + origFilename + '" already exists');
        ovr.active = true;
        return;
      }

      // Rename back
      var tab = findTabByFilename(currentPath);
      if (tab) {
        if (tab.filename === selectedFxDataFilename) {
          selectedFxDataFilename = originalPath;
          localStorage.setItem('selectedFxDataFile', originalPath);
        }
        tab.filename = originalPath;
      }

      // Update entries
      for (var ei = 0; ei < fxViewEntries.length; ei++) {
        var entry = fxViewEntries[ei];
        if (entry.type === 'image_t' || entry.type === 'raw_t') {
          var val = (entry.value || '').replace(/^["']|["']$/g, '');
          if (fxPathMatchesFile(val, currentPath)) {
            // Preserve original prefix by replacing only the basename
            var curBase = currentPath.replace(/.*\//, '');
            entry.value = '"' + val.replace(curBase, origFilename) + '"';
          }
        }
      }

      // Move override key back
      delete fxViewSpriteOverrides[currentPath];
      fxViewSpriteOverrides[originalPath] = ovr;

      fxViewCurrentPreviewPath = originalPath;
      fxSyncEntriesToSource();
      fxRenderEntriesPanel();
      renderBinariesList();
      renderTabBar();
      saveWorkspaceToLocalStorage();

      // Re-render preview
      var data = fxGetBinaryData(originalPath);
      if (data) fxRenderImagePreview(data, originalPath);
    } else {
      // Path unchanged — still refresh lists to update override styling
      fxRenderEntriesPanel();
      renderBinariesList();
      fxRefreshCurrentPreview();
    }
  }

  // ── Check if a file has an active sprite override ──────────────────
  function fxHasSpriteOverride(path) {
    // Direct key lookup
    var ovr = fxViewSpriteOverrides[path];
    if (ovr && ovr.active) return true;
    // Basename fallback (entry may reference '../assets/foo.png' while key is 'assets/foo.png')
    if (path) {
      var base = path.replace(/.*\//, '');
      for (var key in fxViewSpriteOverrides) {
        if (fxViewSpriteOverrides[key].active && key.replace(/.*\//, '') === base) return true;
      }
    }
    return false;
  }

  // ── Hex accordion toggle ───────────────────────────────────────────
  if (fxdataHexToggle) {
    fxdataHexToggle.addEventListener('click', function () {
      if (fxdataHexAccordion) fxdataHexAccordion.classList.toggle('open');
    });
  }

  // ── Preview collapse/expand ────────────────────────────────────────
  var fxPreviewSavedFlex = null; // remember entries panel flex before collapse
  var fxPreviewSavedPreviewFlex = null;

  function fxCollapsePreview() {
    if (!fxdataPreviewPanel) return;
    var entriesPanel = document.getElementById('fxdataEntriesPanel');
    // Save current flex values before collapsing
    if (entriesPanel) fxPreviewSavedFlex = entriesPanel.style.flex || '';
    fxPreviewSavedPreviewFlex = fxdataPreviewPanel.style.flex || '';
    // Clear inline flex so CSS .collapsed rules take effect
    fxdataPreviewPanel.style.flex = '';
    if (entriesPanel) entriesPanel.style.flex = '1';
    fxdataPreviewPanel.classList.add('collapsed');
  }

  function fxExpandPreview() {
    if (!fxdataPreviewPanel) return;
    var entriesPanel = document.getElementById('fxdataEntriesPanel');
    fxdataPreviewPanel.classList.remove('collapsed');
    // Restore saved flex values
    if (entriesPanel) entriesPanel.style.flex = fxPreviewSavedFlex || '';
    fxdataPreviewPanel.style.flex = fxPreviewSavedPreviewFlex || '';
  }

  // Allow clicking anywhere on the preview header to toggle collapse
  var fxPreviewHeader = fxdataPreviewPanel && fxdataPreviewPanel.querySelector('.fxdata-view-panel-header');
  if (fxPreviewHeader) {
    fxPreviewHeader.style.cursor = 'pointer';
    fxPreviewHeader.addEventListener('click', function (e) {
      e.stopPropagation();
      if (fxdataPreviewPanel.classList.contains('collapsed')) {
        fxExpandPreview();
      } else {
        fxCollapsePreview();
      }
    });
  }
  // Allow clicking the collapsed panel itself to expand
  if (fxdataPreviewPanel) {
    fxdataPreviewPanel.addEventListener('click', function () {
      if (fxdataPreviewPanel.classList.contains('collapsed')) {
        fxExpandPreview();
      }
    });
  }

  // ── Column resize ──────────────────────────────────────────────────
  (function initFxViewResize() {
    if (!fxdataResizeHandle) return;
    var dragging = false;
    var entriesPanel = document.getElementById('fxdataEntriesPanel');
    var previewPanel = document.getElementById('fxdataPreviewPanel');
    var layout = document.getElementById('fxdataViewLayout');

    fxdataResizeHandle.addEventListener('mousedown', function (e) {
      if (previewPanel && previewPanel.classList.contains('collapsed')) return;
      dragging = true;
      fxdataResizeHandle.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging || !layout) return;
      var rect = layout.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var pct = Math.max(20, Math.min(80, (x / rect.width) * 100));
      entriesPanel.style.flex = '0 0 ' + pct + '%';
      previewPanel.style.flex = '1';
    });

    document.addEventListener('mouseup', function () {
      if (dragging) {
        dragging = false;
        fxdataResizeHandle.classList.remove('dragging');
      }
    });
  })();

  // ── Build FX Data ──────────────────────────────────────────────────
  function fxBuildData() {
    var bridge = window.__fxBridge;
    if (!bridge) {
      setStatus('FX build functions not loaded');
      return Promise.resolve();
    }

    var fxTab = findFxdataTab();
    if (!fxTab || !fxTab.model) {
      setStatus('No fxdata.txt file in project');
      return Promise.resolve();
    }

    // Create virtual project from tabs
    var project = new bridge.FxDataProject();

    // On first build, normalize fxdata.txt through parse/regenerate to clean up
    // malformed comments and relative paths from imported examples
    var rawSource = fxTab.model.getValue();

    // Check if fxdata.txt has any entries before attempting build
    var parsedEntries = bridge.sourceToEntries(rawSource);
    if (!parsedEntries || parsedEntries.length === 0) {
      setStatus('No entries in fxdata.txt — add some entries before building', 'warning');
      return Promise.resolve();
    }

    if (!fxViewLastBuild) {
      var entries = parsedEntries;
      if (entries && entries.length > 0) {
        var cleanSource = bridge.entriesToSource(entries);
        fxTab.model.setValue(cleanSource);
        rawSource = cleanSource;
      }
    }

    fxBuildSourceSnapshot = rawSource;
    project.addFile('fxdata.txt', rawSource);

    // Add all binary files (by full path and basename alias for flexible resolution)
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary && tabs[i].binaryData) {
        project.addFile(tabs[i].filename, tabs[i].binaryData);
        // Also add by basename so fxdata.txt can reference "logo.png"
        // even if the tab is "sprites/logo.png"
        var base = tabs[i].filename.replace(/.*\//, '');
        if (base !== tabs[i].filename && !project.hasFile(base)) {
          project.addFile(base, tabs[i].binaryData);
        }
      }
    }

    // Also add relevant text files (might be included)
    for (var j = 0; j < tabs.length; j++) {
      if (!tabs[j].isBinary && tabs[j].model && tabs[j].filename !== 'fxdata.txt') {
        var ext = getExtension(tabs[j].filename).toLowerCase();
        if (ext === '.txt' || ext === '.h') {
          project.addFile(tabs[j].filename, tabs[j].model.getValue());
        }
      }
    }

    setStatus('Building FX data...');

    return bridge.buildFxData(project, 'fxdata.txt', { threshold: fxViewThreshold })
      .then(function (result) {
        fxViewLastBuild = result;

        if (!result.success) {
          var diagMsg = result.diagnostics.map(function (d) {
            return d.severity + ': ' + d.message + (d.file ? ' (' + d.file + ':' + d.line + ')' : '');
          }).join('\n');
          setStatus('FX Build failed');
          fxAppendBuildLog(diagMsg, true);
          fxRenderMemoryMap(result);
          return;
        }

        // Helper: find an existing tab by basename (searches subfolders)
        function findExistingByBasename(basename) {
          var lower = basename.toLowerCase();
          for (var fi = 0; fi < tabs.length; fi++) {
            if (tabs[fi].filename.replace(/.*\//, '').toLowerCase() === lower) {
              return tabs[fi];
            }
          }
          return null;
        }

        // Resolve output filenames — prefer existing paths in subfolders
        var hFilename = (findExistingByBasename('fxdata.h') || {}).filename || 'fxdata.h';
        var devBinFilename = (findExistingByBasename('fxdata.bin') || {}).filename || 'fxdata.bin';
        // Keep data/save bins alongside fxdata.bin unless the user moved them elsewhere
        var devBinDir = devBinFilename.replace(/[^/]*$/, ''); // e.g. "fxdata/" or ""
        var dataBinFilename = (findExistingByBasename('fxdata-data.bin') || {}).filename || (devBinDir + 'fxdata-data.bin');
        var saveBinFilename = (findExistingByBasename('fxdata-save.bin') || {}).filename || (devBinDir + 'fxdata-save.bin');

        // Determine output files
        var outputs = [
          { filename: hFilename, content: result.header, isBinary: false },
          { filename: devBinFilename, data: result.devBin, isBinary: true },
          { filename: dataBinFilename, data: result.dataBin, isBinary: true }
        ];
        if (result.saveBin) {
          outputs.push({ filename: saveBinFilename, data: result.saveBin, isBinary: true });
        }

        // Check for collisions
        var collisions = [];
        for (var k = 0; k < outputs.length; k++) {
          if (findTabByFilename(outputs[k].filename)) {
            collisions.push(outputs[k].filename);
          }
        }

        var proceed;
        if (collisions.length > 0 && fxConfirmOverwriteCheckbox && fxConfirmOverwriteCheckbox.checked) {
          proceed = showConfirmModal(
            'Overwrite FX Build Output',
            'The following files already exist and will be overwritten:<br><br><b>' +
              collisions.map(escapeHtml).join('<br>') + '</b>',
            'Overwrite'
          );
        } else {
          proceed = Promise.resolve(true);
        }

        return proceed.then(function (ok) {
          if (!ok) {
            setStatus('FX Build cancelled');
            return;
          }

          // Create/update fxdata.h (source tab) — leave baseline unchanged
          // so the tab shows as modified until the project is built/exported
          var hTab = findTabByFilename(hFilename);
          if (hTab && hTab.model) {
            hTab.model.setValue(result.header);
          } else {
            var newHTab = createTab(hFilename, result.header, false);
            newHTab.baselineContent = '';  // mark as modified immediately
          }
          sortTabs();

          // Create/update fxdata.bin (dev binary — used with Ardens)
          createBinaryTab(devBinFilename, result.devBin.length, result.devBin);

          // Create/update fxdata-data.bin (raw data section for distribution)
          createBinaryTab(dataBinFilename, result.dataBin.length, result.dataBin);

          // Create/update fxdata-save.bin (raw save section for distribution)
          if (result.saveBin) {
            createBinaryTab(saveBinFilename, result.saveBin.length, result.saveBin);
          }

          // Auto-select fxdata.bin (dev binary) as FX data for Ardens
          selectedFxDataFilename = devBinFilename;
          localStorage.setItem('selectedFxDataFile', devBinFilename);

          // Render memory map in output panel
          fxRenderMemoryMap(result);

          // Expand output panel so memory map is visible
          var outputPanel = document.getElementById('outputPanel');
          if (outputPanel && outputPanel.classList.contains('collapsed')) {
            outputPanel.classList.remove('collapsed');
          }

          setStatus('FX Build succeeded \u2014 ' + result.dataSize + ' bytes data');

          // Update FX data meter bar in output panel
          var fxDataMeterGroup = document.getElementById('fxDataMeterGroup');
          var fxDataBar = document.getElementById('fxDataBar');
          var fxDataInfo = document.getElementById('fxDataInfo');
          if (fxDataMeterGroup && fxDataBar && fxDataInfo) {
            fxDataMeterGroup.classList.remove('hidden');
            var maxFx = 16 * 1024 * 1024; // 16MB
            var pct = Math.min(Math.round((result.devBin.length / maxFx) * 100), 100);
            fxDataBar.style.width = Math.max(pct, 1) + '%';
            fxDataBar.className = pctClass(pct);
            fxDataInfo.textContent =
              formatFileSize(result.devBin.length) + ' / ' + formatFileSize(maxFx) +
              '  (' + pct + '%)';
          }

          renderTabBar();
          saveWorkspaceToLocalStorage();
          updateLoadDevDataState();

          // Post-build: offer to patch .ino for ArduboyFX integration
          return fxPatchInoAfterBuild(hFilename);
        });
      })
      .catch(function (err) {
        setStatus('FX Build error: ' + err.message);
        fxAppendBuildLog('Build failed: ' + err.message, true);
        console.error('FX Build error:', err);
      });
  }

  // ── Post-build: scan and patch .ino for ArduboyFX integration ──────
  function fxPatchInoAfterBuild(hFilename) {
    // Find the .ino tab
    var inoTab = null;
    for (var i = 0; i < tabs.length; i++) {
      if (getExtension(tabs[i].filename) === '.ino' && tabs[i].model) {
        inoTab = tabs[i];
        break;
      }
    }
    if (!inoTab) return Promise.resolve();

    var src = inoTab.model.getValue();
    var lines = src.split('\n');

    // --- Scan the .ino for FX integration state ---
    var hasArduboyFxInclude = false;
    var hasFxDataInclude = false;
    var hasFxBegin = false;
    var clearCallCount = 0;
    var displayCallCount = 0;

    // Determine the right include path for fxdata.h relative to the .ino
    // hFilename may be a subdirectory path like "src/fxdata.h"
    var fxdataIncludePath = hFilename;

    // Build a regex that matches #include "fxdata.h" OR #include "src/fxdata.h" etc.
    var escapedPath = fxdataIncludePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var fxdataIncludeRe = new RegExp('^\\s*#\\s*include\\s+["\'](fxdata\\.h|' + escapedPath + ')["\']', 'i');

    for (var li = 0; li < lines.length; li++) {
      var trimmed = lines[li].replace(/\/\/.*$/, '').trim();
      if (/^\s*#\s*include\s+[<"]ArduboyFX\.h[>"]/.test(lines[li])) hasArduboyFxInclude = true;
      if (fxdataIncludeRe.test(lines[li])) hasFxDataInclude = true;
      if (/FX\s*::\s*begin\s*\(\s*FX_DATA_PAGE\s*\)/.test(trimmed)) hasFxBegin = true;
      // Count calls outside of comments
      var noStr = trimmed.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/'(?:[^'\\]|\\.)*'/g, '');
      if (/arduboy\s*\.\s*clear\s*\(/.test(noStr)) clearCallCount++;
      if (/arduboy\s*\.\s*display\s*\(/.test(noStr)) displayCallCount++;
    }

    // Nothing to do?
    var needsIncludes = !hasArduboyFxInclude || !hasFxDataInclude;
    var needsFxBegin = !hasFxBegin;
    var needsClearRemoval = clearCallCount > 0;
    var needsDisplayConversion = displayCallCount > 0;

    if (!needsIncludes && !needsFxBegin && !needsClearRemoval && !needsDisplayConversion) {
      return Promise.resolve();
    }

    // Build a description of proposed changes
    var changes = [];
    if (!hasArduboyFxInclude) changes.push('Add <b>#include &lt;ArduboyFX.h&gt;</b>');
    if (!hasFxDataInclude) changes.push('Add <b>#include "' + escapeHtml(fxdataIncludePath) + '"</b>');
    if (needsFxBegin) changes.push('Add <b>FX::begin(FX_DATA_PAGE);</b> in setup()');
    if (needsClearRemoval) changes.push('Remove <b>arduboy.clear()</b> calls (' + clearCallCount + ')');
    if (needsDisplayConversion) changes.push('Replace <b>arduboy.display()</b> with <b>FX::display(CLEAR_BUFFER);</b> (' + displayCallCount + ')');

    return showConfirmModal(
      'Update Sketch for ArduboyFX',
      'The following changes are suggested for <b>' + escapeHtml(inoTab.filename) + '</b>:<br><br>' +
        changes.join('<br>') +
        '<br><br><em>Warning: these automatic changes may have unintended side effects on existing codebases.</em>',
      'Update Sketch'
    ).then(function (accepted) {
      if (!accepted) return;

      var src = inoTab.model.getValue();
      var lines = src.split('\n');
      var modified = false;
      var warnings = [];

      // 1. Add missing #include lines after the last existing #include
      if (needsIncludes) {
        var lastIncludeIdx = -1;
        for (var ii = 0; ii < lines.length; ii++) {
          if (/^\s*#\s*include\s/.test(lines[ii])) lastIncludeIdx = ii;
        }
        if (lastIncludeIdx >= 0) {
          var newIncludes = [];
          if (!hasArduboyFxInclude) newIncludes.push('#include <ArduboyFX.h>');
          if (!hasFxDataInclude) newIncludes.push('#include "' + fxdataIncludePath + '"');
          lines.splice(lastIncludeIdx + 1, 0, newIncludes.join('\n'));
          modified = true;
        } else {
          warnings.push('Could not find any #include lines to add FX includes');
        }
      }

      // 2. Add FX::begin(FX_DATA_PAGE); in setup() after arduboy.begin()
      if (needsFxBegin) {
        var fxBeginInserted = false;
        // Find setup() function
        var inSetup = false;
        var braceDepth = 0;
        for (var si = 0; si < lines.length; si++) {
          if (!inSetup && /\bvoid\s+setup\s*\(/.test(lines[si])) {
            inSetup = true;
            braceDepth = 0;
          }
          if (inSetup) {
            for (var ci = 0; ci < lines[si].length; ci++) {
              if (lines[si][ci] === '{') braceDepth++;
              if (lines[si][ci] === '}') { braceDepth--; if (braceDepth <= 0) { inSetup = false; break; } }
            }
            // Look for arduboy.begin() to place FX::begin right after
            if (inSetup && /arduboy\s*\.\s*begin\s*\(/.test(lines[si])) {
              // Detect indentation from this line
              var indent = lines[si].match(/^(\s*)/)[1];
              lines.splice(si + 1, 0, indent + 'FX::begin(FX_DATA_PAGE);');
              fxBeginInserted = true;
              modified = true;
              break;
            }
          }
        }
        // Fallback: insert after the opening brace of setup() if arduboy.begin() not found
        if (!fxBeginInserted) {
          inSetup = false;
          for (var sf = 0; sf < lines.length; sf++) {
            if (!inSetup && /\bvoid\s+setup\s*\(/.test(lines[sf])) {
              inSetup = true;
            }
            if (inSetup && lines[sf].indexOf('{') >= 0) {
              var indent2 = lines[sf].match(/^(\s*)/)[1] + '  ';
              lines.splice(sf + 1, 0, indent2 + 'FX::begin(FX_DATA_PAGE);');
              fxBeginInserted = true;
              modified = true;
              break;
            }
          }
        }
        if (!fxBeginInserted) {
          warnings.push('Could not find setup() function to add FX::begin(FX_DATA_PAGE)');
        }
      }

      // 3. Remove arduboy.clear() calls (erase the entire line if it's standalone)
      if (needsClearRemoval) {
        for (var ri = lines.length - 1; ri >= 0; ri--) {
          var rTrimmed = lines[ri].replace(/\/\/.*$/, '');
          var rNoStr = rTrimmed.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/'(?:[^'\\]|\\.)*'/g, '');
          if (/arduboy\s*\.\s*clear\s*\(\s*\)\s*;/.test(rNoStr)) {
            // If the line is just the call (possibly with whitespace), remove it entirely
            if (/^\s*arduboy\s*\.\s*clear\s*\(\s*\)\s*;\s*(\/\/.*)?$/.test(lines[ri])) {
              lines.splice(ri, 1);
            } else {
              // Inline within other code — replace just the call
              lines[ri] = lines[ri].replace(/arduboy\s*\.\s*clear\s*\(\s*\)\s*;?\s*/, '');
            }
            modified = true;
          }
        }
      }

      // 4. Convert arduboy.display() to FX::display(CLEAR_BUFFER)
      if (needsDisplayConversion) {
        for (var di = 0; di < lines.length; di++) {
          var dTrimmed = lines[di].replace(/\/\/.*$/, '');
          var dNoStr = dTrimmed.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/'(?:[^'\\]|\\.)*'/g, '');
          if (/arduboy\s*\.\s*display\s*\(/.test(dNoStr)) {
            lines[di] = lines[di].replace(/arduboy\s*\.\s*display\s*\(\s*\)/, 'FX::display(CLEAR_BUFFER)');
            modified = true;
          }
        }
      }

      if (modified) {
        inoTab.model.setValue(lines.join('\n'));
        renderTabBar();
        saveWorkspaceToLocalStorage();
        setStatus('Sketch updated for ArduboyFX', 'success');
      }

      if (warnings.length > 0) {
        setStatus('FX sketch update: ' + warnings.join('; '), 'warning');
      }
    });
  }

  // ── Append to build output log ─────────────────────────────────────
  function fxAppendBuildLog(text, isError) {
    var logPre = document.getElementById('logPre');
    if (!logPre) return;
    var span = document.createElement('span');
    span.style.color = isError ? '#ff6b6b' : '#60a5fa';
    span.textContent = '\n' + text;
    logPre.appendChild(span);
    logPre.scrollTop = logPre.scrollHeight;

    // Expand output panel if collapsed
    var outputPanel = document.getElementById('outputPanel');
    if (outputPanel && outputPanel.classList.contains('collapsed')) {
      outputPanel.classList.remove('collapsed');
    }
  }

  // ── Navigate to FX variable in fxdata.txt ──────────────────────────
  function fxNavigateToVariable(name) {
    var fxTab = findFxdataTab();
    if (!fxTab || !fxTab.model) {
      setStatus('No fxdata.txt file in project', 'error');
      return;
    }
    if (fxBuildSourceSnapshot && fxTab.model.getValue() !== fxBuildSourceSnapshot) {
      setStatus('fxdata.txt has been modified since the last build \u2014 entries may have changed', 'warning');
    }

    if (fxdataShowPlaceholder) {
      // FX Data View is active — select the entry card
      var matchEntry = null;
      for (var i = 0; i < fxViewEntries.length; i++) {
        if (fxViewEntries[i].name === name) {
          matchEntry = fxViewEntries[i];
          break;
        }
      }
      if (!matchEntry) {
        setStatus('Variable \u201c' + name + '\u201d not found in FX Data entries', 'error');
        return;
      }
      if (activeTabId !== fxTab.id) {
        switchToTab(fxTab.id);
      }
      fxViewActiveEntryId = matchEntry.id;
      var cards = fxdataEntriesList.querySelectorAll('.fxdata-view-entry-card');
      for (var j = 0; j < cards.length; j++) {
        var isMatch = cards[j].dataset.id === matchEntry.id;
        cards[j].classList.toggle('active', isMatch);
        if (isMatch) {
          cards[j].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      fxShowPreview(matchEntry);
    } else {
      // Raw text view — select the variable name in the editor
      var currentSource = fxTab.model.getValue();
      var lines = currentSource.split('\n');
      var pattern = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      var targetLine = -1;
      var targetCol = -1;
      var matchLen = name.length;
      for (var li = 0; li < lines.length; li++) {
        var m = pattern.exec(lines[li]);
        if (m) {
          targetLine = li + 1;
          targetCol = m.index + 1;
          break;
        }
      }
      if (targetLine === -1) {
        setStatus('Variable \u201c' + name + '\u201d not found in fxdata.txt', 'error');
        return;
      }
      if (activeTabId !== fxTab.id) {
        switchToTab(fxTab.id);
      }
      if (editor) {
        editor.revealLineInCenter(targetLine);
        editor.setSelection(new monaco.Selection(targetLine, targetCol, targetLine, targetCol + matchLen));
        editor.focus();
      }
    }
  }

  // ── Memory map rendering in build output ───────────────────────────
  function fxRenderMemoryMap(result) {
    if (!fxMemoryMapSection || !result.memoryMap || result.memoryMap.length === 0) {
      if (fxMemoryMapSection) fxMemoryMapSection.classList.add('hidden');
      return;
    }

    fxMemoryMapSection.classList.remove('hidden');
    var totalSize = result.dataSize + result.saveSize;

    // Bar segments with labels inside
    var barHtml = '';
    var listHtml = '';
    var nonZero = result.memoryMap.filter(function (e) { return e.size > 0; });
    for (var i = 0; i < nonZero.length; i++) {
      var entry = nonZero[i];
      var pct = totalSize > 0 ? (entry.size / totalSize * 100).toFixed(1) : 0;
      barHtml += '<div class="fxdata-output-map-segment type-' + escapeHtml(entry.type) + '"' +
        ' style="width:' + pct + '%"' +
        ' title="' + escapeHtml(entry.name) + ' \u2014 ' + entry.size + ' B"' +
        ' data-name="' + escapeHtml(entry.name) + '">' +
        '<span class="fxdata-output-map-label">' + escapeHtml(entry.name) + '</span>' +
        '</div>';
      listHtml += '<div class="fxdata-output-map-entry" data-name="' + escapeHtml(entry.name) + '">' +
        '<span class="name type-' + escapeHtml(entry.type) + '">' + escapeHtml(entry.name) + '</span>' +
        '<span class="offset">0x' + entry.offset.toString(16).padStart(6, '0') + '</span>' +
        '<span class="size">' + entry.size + ' B</span>' +
        '<span class="type">' + escapeHtml(entry.type) + '</span>' +
        '</div>';
    }

    if (fxMemoryMapBar) fxMemoryMapBar.innerHTML = barHtml;
    if (fxMemoryMapList) fxMemoryMapList.innerHTML = listHtml;

    // Hover highlight: segment <-> list entry
    function addHoverLink(sourceSelector, targetSelector) {
      var sources = fxMemoryMapSection.querySelectorAll(sourceSelector);
      for (var j = 0; j < sources.length; j++) {
        (function (el) {
          el.addEventListener('mouseenter', function () {
            var name = el.getAttribute('data-name');
            el.classList.add('active');
            var targets = fxMemoryMapSection.querySelectorAll(targetSelector + '[data-name="' + name + '"]');
            for (var k = 0; k < targets.length; k++) targets[k].classList.add('hover');
          });
          el.addEventListener('mouseleave', function () {
            var name = el.getAttribute('data-name');
            el.classList.remove('active');
            var targets = fxMemoryMapSection.querySelectorAll(targetSelector + '[data-name="' + name + '"]');
            for (var k = 0; k < targets.length; k++) targets[k].classList.remove('hover');
          });
        })(sources[j]);
      }
    }
    addHoverLink('.fxdata-output-map-segment', '.fxdata-output-map-entry');
    addHoverLink('.fxdata-output-map-entry', '.fxdata-output-map-segment');

    // Click to navigate to variable in fxdata.txt
    var clickables = fxMemoryMapSection.querySelectorAll('.fxdata-output-map-segment, .fxdata-output-map-entry');
    for (var ci = 0; ci < clickables.length; ci++) {
      (function (el) {
        el.addEventListener('click', function () {
          var name = el.getAttribute('data-name');
          if (!name) return;
          fxNavigateToVariable(name);
        });
      })(clickables[ci]);
    }

    // Summary
    if (fxMemoryMapSummary) {
      fxMemoryMapSummary.innerHTML =
        '<dl>' +
        '<dt>Data</dt><dd>' + result.dataSize + ' B (' + result.dataPages + ' pages)</dd>' +
        (result.saveSize > 0 ? '<dt>Save</dt><dd>' + result.saveSize + ' B (' + result.savePages + ' pages)</dd>' : '') +
        '<dt>Dev binary</dt><dd>' + result.devBin.length + ' B</dd>' +
        '<dt>FX_DATA_PAGE</dt><dd>0x' + result.fxDataPage.toString(16).padStart(4, '0') + '</dd>' +
        (result.fxSavePage !== null ? '<dt>FX_SAVE_PAGE</dt><dd>0x' + result.fxSavePage.toString(16).padStart(4, '0') + '</dd>' : '') +
        '</dl>';
    }
  }

  // ── FX menu new items ──────────────────────────────────────────────
  // Build FX Data from menu
  if (fxBuildDataMenuBtn) {
    fxBuildDataMenuBtn.addEventListener('click', function () {
      closeAllMenus();
      fxBuildData();
    });
  }

  // Settings persistence
  var savedFxConfirmOverwrite = localStorage.getItem('fxConfirmOverwrite');
  if (savedFxConfirmOverwrite !== null && fxConfirmOverwriteCheckbox) {
    fxConfirmOverwriteCheckbox.checked = (savedFxConfirmOverwrite === 'true');
  }
  if (fxConfirmOverwriteCheckbox) {
    fxConfirmOverwriteCheckbox.addEventListener('change', function () {
      localStorage.setItem('fxConfirmOverwrite', fxConfirmOverwriteCheckbox.checked);
    });
  }

  var savedFxAutoBuild = localStorage.getItem('fxAutoBuild');
  if (savedFxAutoBuild !== null && fxAutoBuildCheckbox) {
    fxAutoBuildCheckbox.checked = (savedFxAutoBuild === 'true');
  }
  if (fxAutoBuildCheckbox) {
    fxAutoBuildCheckbox.addEventListener('change', function () {
      localStorage.setItem('fxAutoBuild', fxAutoBuildCheckbox.checked);
    });
  }

  var advancedToggle  = document.getElementById('advancedToggle');
  var advancedDropdown = document.getElementById('advancedDropdown');
  var themeToggleBtn  = document.getElementById('themeToggleBtn');
  var highlightToggleBtn = document.getElementById('highlightToggleBtn');
  if (localStorage.getItem('highlightEnabled') === 'false') {
    highlightToggleBtn.className = highlightToggleBtn.className.replace('highlight-btn--on', 'highlight-btn--off');
    highlightToggleBtn.title = 'Toggle inline error/warning highlighting (currently OFF)';
  }
  var hamburgerBtn    = document.getElementById('hamburgerBtn');
  var hamburgerMenu   = document.getElementById('hamburgerMenu');
  var fxMenuBtn       = document.getElementById('fxMenuBtn');
  var fxMenu          = document.getElementById('fxMenu');
  var fileMenuBtn     = document.getElementById('fileMenuBtn');
  var fileMenu        = document.getElementById('fileMenu');
  var fxCreateDataBtn = document.getElementById('fxCreateDataBtn');
  var fxLoadDataBtn   = document.getElementById('fxLoadDataBtn');
  var loadDevDataLabel = document.getElementById('loadDevDataLabel');
  var confirmChangesCheckbox = document.getElementById('confirmChangesCheckbox');
  var buildAnimCheckbox = document.getElementById('buildAnimCheckbox');
  var clearStorageBtn = document.getElementById('clearStorageBtn');
  var newProjectBtn   = document.getElementById('newProjectBtn');
  var confirmModal    = document.getElementById('confirmModal');
  var confirmModalTitle = document.getElementById('confirmModalTitle');
  var confirmModalMessage = document.getElementById('confirmModalMessage');
  var confirmModalCancel = document.getElementById('confirmModalCancel');
  var confirmModalOk  = document.getElementById('confirmModalOk');
  var promptModal     = document.getElementById('promptModal');
  var promptModalTitle = document.getElementById('promptModalTitle');
  var promptModalMessage = document.getElementById('promptModalMessage');
  var promptModalInput = document.getElementById('promptModalInput');
  var promptModalError = document.getElementById('promptModalError');
  var promptModalCancel = document.getElementById('promptModalCancel');
  var promptModalOk   = document.getElementById('promptModalOk');
  var conflictModal   = document.getElementById('conflictModal');
  var conflictMessage = document.getElementById('conflictMessage');
  var conflictApplyAll = document.getElementById('conflictApplyAll');
  var conflictDontAsk = document.getElementById('conflictDontAsk');
  var conflictSkipBtn = document.getElementById('conflictSkipBtn');
  var conflictOverwriteBtn = document.getElementById('conflictOverwriteBtn');
  var dropOverlay     = document.getElementById('dropOverlay');
  var syncFolderBtn   = document.getElementById('syncFolderBtn');
  var checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
  var autoSyncCheckbox = document.getElementById('autoSyncCheckbox');
  var syncModal       = document.getElementById('syncModal');
  var syncModalTitle  = document.getElementById('syncModalTitle');
  var syncChangesList = document.getElementById('syncChangesList');
  var syncApplyBtn    = document.getElementById('syncApplyBtn');
  var syncDismissBtn  = document.getElementById('syncDismissBtn');
  var syncAlwaysAsk   = document.getElementById('syncAlwaysAsk');
  var confirmSyncCheckbox = confirmChangesCheckbox;
  var loadDevDataCheckbox = document.getElementById('loadDevDataCheckbox');
  var selectedFxDataFilename = null;  // which .bin file is currently selected as FX dev data

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — DOM refs
   * ══════════════════════════════════════════════════════════════════════ */
  var simulatorPanel     = document.getElementById('simulatorPanel');
  var simCanvas          = document.getElementById('canvas');
  var simPlaceholder     = document.getElementById('simPlaceholder');
  var simCloseBtn        = document.getElementById('simCloseBtn');
  var simToggleBtn       = document.getElementById('simToggleBtn');
  var simSettingsToggle  = document.getElementById('simSettingsToggle');
  var simSettingsDropdown = document.getElementById('simSettingsDropdown');
  var autoSimCheckbox    = document.getElementById('autoSimCheckbox');
  var simDevToolsBtn     = document.getElementById('simDevToolsBtn');
  var simPopoutBtn       = document.getElementById('simPopoutBtn');
  var simPopoutPlaceholder = document.getElementById('simPopoutPlaceholder');
  var simCanvasWrap      = document.getElementById('simCanvasWrap');
  var devtoolsModal      = document.getElementById('devtoolsModal');
  var devtoolsCloseBtn   = document.getElementById('devtoolsCloseBtn');

  var simPalette     = document.getElementById('simPalette');
  var simGrid        = document.getElementById('simGrid');
  var simFilter      = document.getElementById('simFilter');
  var simOrientation = document.getElementById('simOrientation');
  var simVolume      = document.getElementById('simVolume');
  var simVolumeLabel = document.getElementById('simVolumeLabel');
  var simAutoFilter  = document.getElementById('simAutoFilter');
  var simIntScale    = document.getElementById('simIntScale');
  var simDisplayType = document.getElementById('simDisplayType');
  var simFxPort      = document.getElementById('simFxPort');
  var simCurrent     = document.getElementById('simCurrent');
  var simClearStorageBtn = document.getElementById('simClearStorageBtn');

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — state
   * ══════════════════════════════════════════════════════════════════════ */
  var ardensModule = null;
  var ardensLoading = false;
  var ardensReady = false;
  var ardensScriptLoaded = false;
  var lastHexText = null;
  var simDevToolsActive = false;
  var simPopoutWindow = null;

  /* ══════════════════════════════════════════════════════════════════════
   *  FQBN construction
   * ══════════════════════════════════════════════════════════════════════ */
  function buildFqbn() {
    var board = targetSelect.value;
    var caps  = BOARD_CAPS[board] || {};
    var menus = [];

    menus.push('core=' + coreSelect.value);

    if (caps.contrast && contrastSelect.value !== 'normal') {
      menus.push('contrast=' + contrastSelect.value);
    }
    if (caps.based_on) {
      menus.push('based_on=' + basedOnSelect.value);
    }
    if (caps.display) {
      menus.push('display=' + displaySelect.value);
    }
    if (caps.flashselect) {
      menus.push('flashselect=' + flashSelSelect.value);
    }

    var fqbn = 'arduboy-homemade:avr:' + board;
    if (menus.length > 0) {
      fqbn += ':' + menus.join(',');
    }
    return fqbn;
  }

  function updateFqbnDisplay() {
    fqbnDisplay.textContent = buildFqbn();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Conditional UI visibility
   * ══════════════════════════════════════════════════════════════════════ */
  function onTargetChange() {
    var caps = BOARD_CAPS[targetSelect.value] || {};

    if (caps.contrast) {
      contrastGroup.classList.remove('hidden');
    } else {
      contrastGroup.classList.add('hidden');
      contrastSelect.value = 'normal';
    }

    if (caps.based_on || caps.display || caps.flashselect) {
      homemadeGroup.classList.remove('hidden');
    } else {
      homemadeGroup.classList.add('hidden');
    }

    updateFqbnDisplay();
    syncSimFromTarget();
  }

  /**
   * Update the simulator display type and FX port dropdowns (and the
   * live simulator settings if it is already running) to match the
   * currently selected build-target hardware.
   */
  function syncSimFromTarget() {
    var defaults = SIM_DEFAULTS[targetSelect.value];
    if (!defaults) return;

    simDisplayType.value = defaults.display;
    simFxPort.value      = defaults.fxport;

    setSimParam('display', defaults.display);
    setSimParam('fxport', defaults.fxport);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Event listeners — board settings
   * ══════════════════════════════════════════════════════════════════════ */
  targetSelect.addEventListener('change', onTargetChange);
  coreSelect.addEventListener('change', updateFqbnDisplay);
  contrastSelect.addEventListener('change', updateFqbnDisplay);
  basedOnSelect.addEventListener('change', updateFqbnDisplay);
  displaySelect.addEventListener('change', updateFqbnDisplay);
  flashSelSelect.addEventListener('change', updateFqbnDisplay);

  onTargetChange();

  /* ══════════════════════════════════════════════════════════════════════
   *  Unified dropdown menu system (Advanced, File, FX, Options)
   *  — Mutual close: opening one closes all others
   *  — Hover-to-switch: when any menu is open, hovering another button opens it
   * ══════════════════════════════════════════════════════════════════════ */
  var menuBarAnyOpen = false; // tracks whether any dropdown is open

  function closeAllMenus() {
    advancedDropdown.classList.add('hidden');
    fileMenu.classList.add('hidden');
    fileMenuBtn.setAttribute('aria-expanded', 'false');
    fxMenu.classList.add('hidden');
    fxMenuBtn.setAttribute('aria-expanded', 'false');
    hamburgerMenu.classList.add('hidden');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    menuBarAnyOpen = false;
  }

  function openMenu(menu, btn) {
    closeAllMenus();
    menu.classList.remove('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    menuBarAnyOpen = true;
  }

  /* Hover-to-switch: when any dropdown is open, hovering another button opens it */
  advancedToggle.addEventListener('mouseenter', function () {
    if (!menuBarAnyOpen) return;
    closeAllMenus();
    advancedDropdown.classList.remove('hidden');
    menuBarAnyOpen = true;
  });
  fileMenuBtn.addEventListener('mouseenter', function () {
    if (!menuBarAnyOpen) return;
    openMenu(fileMenu, fileMenuBtn);
  });
  fxMenuBtn.addEventListener('mouseenter', function () {
    if (!menuBarAnyOpen) return;
    updateLoadDevDataState();
    openMenu(fxMenu, fxMenuBtn);
  });
  hamburgerBtn.addEventListener('mouseenter', function () {
    if (!menuBarAnyOpen) return;
    openMenu(hamburgerMenu, hamburgerBtn);
  });

  advancedToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!advancedDropdown.classList.contains('hidden')) {
      closeAllMenus();
    } else {
      closeAllMenus();
      advancedDropdown.classList.remove('hidden');
      menuBarAnyOpen = true;
    }
  });

  document.addEventListener('click', function (e) {
    if (!advancedDropdown.classList.contains('hidden') &&
        !advancedDropdown.contains(e.target) &&
        e.target !== advancedToggle) {
      advancedDropdown.classList.add('hidden');
      menuBarAnyOpen = false;
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Output panel toggle
   * ══════════════════════════════════════════════════════════════════════ */
  function toggleOutput() {
    outputPanel.classList.toggle('collapsed');
    if (editor) editor.layout();
  }

  outputHeader.addEventListener('mousedown', function(e) {
    if (outputPanel.classList.contains('collapsed')) return;
    if (e.target.closest('#outputHeaderRight')) return;
    isResizingOutputPanel = true;
    didDragOutputPanel = false;
    startY = e.clientY;
    startHeight = outputPanel.offsetHeight;
    compilerRoot.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', function(e) {
    if (!isResizingOutputPanel) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 3) didDragOutputPanel = true;
    let newHeight = startHeight - dy;
    newHeight = Math.max(100, newHeight);
    outputPanel.style.height = newHeight + 'px';
  });

  window.addEventListener('mouseup', function() {
    if (isResizingOutputPanel) {
      isResizingOutputPanel = false;
      compilerRoot.style.cursor = '';
    }
  });

  outputHeader.addEventListener('click', function(e) {
    if (e.target.closest('#outputHeaderRight')) return;
    if (didDragOutputPanel) return;
    // Only open when collapsed; do nothing if already visible
    if (outputPanel.classList.contains('collapsed')) {
      toggleOutput();
    }
  });

  outputHeader.addEventListener('dblclick', function(e) {
    if (e.target.closest('#outputHeaderRight')) return;
    if (!outputPanel.classList.contains('collapsed')) {
      outputPanel.style.height = '250px';
    }
  });

  toggleOutputBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleOutput();
  });

  autoShowOutputCheckbox.addEventListener('change', function() {
    localStorage.setItem('autoShowBuildOutput', autoShowOutputCheckbox.checked);
  });

  // Load autoShowBuildOutput preference from localStorage
  var savedAutoShow = localStorage.getItem('autoShowBuildOutput');
  if (savedAutoShow === null) {
    autoShowOutputCheckbox.checked = true;
    localStorage.setItem('autoShowBuildOutput', 'true');
  } else {
    autoShowOutputCheckbox.checked = (savedAutoShow === 'true');
  }

  // Confirm changes toggle
  confirmChangesCheckbox.addEventListener('change', function () {
    localStorage.setItem('confirmChanges', confirmChangesCheckbox.checked);
  });

  var savedConfirmChanges = localStorage.getItem('confirmChanges');
  if (savedConfirmChanges === null) {
    confirmChangesCheckbox.checked = true;
  } else {
    confirmChangesCheckbox.checked = (savedConfirmChanges === 'true');
  }

  // Build animation checkbox
  buildAnimCheckbox.addEventListener('change', function () {
    localStorage.setItem('buildAnim', buildAnimCheckbox.checked);
  });
  var savedBuildAnim = localStorage.getItem('buildAnim');
  if (savedBuildAnim === null) {
    buildAnimCheckbox.checked = true;
  } else {
    buildAnimCheckbox.checked = (savedBuildAnim === 'true');
  }

  // Pixel Editor CodeLens checkbox
  var pixelEditorCodeLensCheckbox = document.getElementById('pixelEditorCodeLensCheckbox');
  pixelEditorCodeLensCheckbox.addEventListener('change', function () {
    localStorage.setItem('pixelEditorCodeLens', pixelEditorCodeLensCheckbox.checked);
    // Refresh inline decorations and clear hover highlights when toggled
    if (window._bitmapUpdateInlineDecos) window._bitmapUpdateInlineDecos();
    if (window._bitmapClearHovers) window._bitmapClearHovers();
  });
  var savedPixelEditorCodeLens = localStorage.getItem('pixelEditorCodeLens');
  if (savedPixelEditorCodeLens === null) {
    pixelEditorCodeLensCheckbox.checked = true;
  } else {
    pixelEditorCodeLensCheckbox.checked = (savedPixelEditorCodeLens === 'true');
  }

  // Example Links checkbox
  var exampleLinksCheckbox = document.getElementById('exampleLinksCheckbox');
  exampleLinksCheckbox.addEventListener('change', function () {
    localStorage.setItem('exampleLinks', exampleLinksCheckbox.checked);
    if (window._updateExampleLinkDecos) window._updateExampleLinkDecos();
  });
  var savedExampleLinks = localStorage.getItem('exampleLinks');
  if (savedExampleLinks === null) {
    exampleLinksCheckbox.checked = true;
  } else {
    exampleLinksCheckbox.checked = (savedExampleLinks === 'true');
  }

  // Combine Image Masks checkbox (default ON = combined green view)
  var combineImageMasksCheckbox = document.getElementById('combineImageMasksCheckbox');
  combineImageMasksCheckbox.addEventListener('change', function () {
    localStorage.setItem('combineImageMasks', combineImageMasksCheckbox.checked);
    // Refresh inline decorations and CodeLens when toggled
    if (window._bitmapUpdateInlineDecos) window._bitmapUpdateInlineDecos();
    if (window._bitmapClearHovers) window._bitmapClearHovers();
    // Re-trigger CodeLens refresh
    if (typeof monaco !== 'undefined') {
      var m = editor.getModel();
      if (m) {
        // Force CodeLens provider to re-evaluate by toggling model version
        m.setValue(m.getValue());
      }
    }
  });
  var savedCombineMasks = localStorage.getItem('combineImageMasks');
  if (savedCombineMasks === null) {
    combineImageMasksCheckbox.checked = true;
  } else {
    combineImageMasksCheckbox.checked = (savedCombineMasks !== 'false');
  }

  // Auto sim checkbox
  autoSimCheckbox.addEventListener('change', function () {
    localStorage.setItem('autoSim', autoSimCheckbox.checked);
  });
  var savedAutoSim = localStorage.getItem('autoSim');
  if (savedAutoSim !== null) {
    autoSimCheckbox.checked = (savedAutoSim === 'true');
  }

  // Load dev data checkbox
  loadDevDataCheckbox.addEventListener('change', function () {
    localStorage.setItem('loadDevData', loadDevDataCheckbox.checked);
  });
  var savedLoadDevData = localStorage.getItem('loadDevData');
  if (savedLoadDevData !== null) {
    loadDevDataCheckbox.checked = (savedLoadDevData === 'true');
  }

  // Restore selected FX data filename
  var savedFxDataFile = localStorage.getItem('selectedFxDataFile');
  if (savedFxDataFile) {
    selectedFxDataFilename = savedFxDataFile;
  }

  copyRawOutputBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!lastRawLog) return;
    navigator.clipboard.writeText(lastRawLog).then(function () {
      var originalSvg = copyRawOutputBtn.innerHTML;
      copyRawOutputBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
      setTimeout(function () {
        copyRawOutputBtn.innerHTML = originalSvg;
      }, 1500);
    }).catch(function (err) {
      console.error('Failed to copy raw output:', err);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Hide / Show Tools (navbar toggle)
   * ══════════════════════════════════════════════════════════════════════ */
  var hideToolsBtn = document.getElementById('hideToolsBtn');
  var navbar = document.getElementById('navbar');
  if (hideToolsBtn && navbar) {
    hideToolsBtn.addEventListener('click', function () {
      var hiding = !navbar.classList.contains('navbar-hidden');
      navbar.classList.toggle('navbar-hidden', hiding);
      hideToolsBtn.textContent = hiding ? 'Show Tools' : 'Hide Tools';
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Available Libraries list (fetched once from /libraries)
   * ══════════════════════════════════════════════════════════════════════ */
  var libraryList = document.getElementById('libraryList');
  var librariesLoaded = false;

  var librariesData = []; // cached library objects from /libraries

  function loadLibraries() {
    if (librariesLoaded) return;
    librariesLoaded = true;

    fetch('/libraries')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok || !data.libraries || !data.libraries.length) {
          libraryList.innerHTML = '<span class="library-list-loading">No libraries found</span>';
          return;
        }
        librariesData = data.libraries;
        var html = '';
        data.libraries.forEach(function (lib, idx) {
          var title = lib.sentence ? escapeHtml(lib.sentence).replace(/"/g, '&quot;') : '';
          var header = (lib.includes && lib.includes.length) ? lib.includes[0] : '';
          html += '<div class="library-item" data-idx="' + idx + '"'
               + (title ? ' title="' + title + '"' : '')
               + (header ? ' data-header="' + escapeHtml(header).replace(/"/g, '&quot;') + '"' : '')
               + '>';
          html += '<span class="library-item-name">' + escapeHtml(lib.name) + '</span>';
          if (lib.version) {
            html += '<span class="library-item-version">v' + escapeHtml(lib.version) + '</span>';
          }
          html += '</div>';
        });
        libraryList.innerHTML = html;
      })
      .catch(function () {
        libraryList.innerHTML = '<span class="library-list-loading">Failed to load</span>';
      });
  }

  // Click handler — insert #include for the clicked library into the active .ino
  libraryList.addEventListener('click', function (e) {
    var item = e.target.closest('.library-item');
    if (!item) return;
    var header = item.getAttribute('data-header');
    if (!header) return;

    var libName = item.querySelector('.library-item-name');
    var displayName = libName ? libName.textContent : header;

    // Find the active .ino tab
    var tab = findTab(activeTabId);
    if (!tab || !tab.filename.endsWith('.ino')) {
      // Try to find any .ino tab
      tab = null;
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].filename.endsWith('.ino')) { tab = tabs[i]; break; }
      }
      if (!tab) {
        setStatus('No .ino file open to add include', 'warn');
        return;
      }
      switchToTab(tab.id);
    }

    var model = tab.model;
    var includeLine = '#include <' + header + '>';
    var content = model.getValue();

    // Check if this include already exists
    var lines = content.split('\n');
    for (var j = 0; j < lines.length; j++) {
      var trimmed = lines[j].replace(/\s/g, '');
      if (trimmed === includeLine.replace(/\s/g, '')) {
        setStatus(displayName + ' is already included', 'warn');
        return;
      }
    }

    // Find the last #include line to insert after it
    var lastIncludeLine = -1;
    for (var k = 0; k < lines.length; k++) {
      if (/^\s*#\s*include\b/.test(lines[k])) {
        lastIncludeLine = k;
      }
    }

    var insertLineNum; // 1-based line number to insert before
    if (lastIncludeLine >= 0) {
      // Insert after the last #include
      insertLineNum = lastIncludeLine + 2; // +1 for 1-based, +1 for after
    } else {
      // No includes found — insert at line 1
      insertLineNum = 1;
    }

    // Use Monaco edit operation (supports undo)
    editor.executeEdits('add-library-include', [{
      range: new monaco.Range(insertLineNum, 1, insertLineNum, 1),
      text: includeLine + '\n'
    }]);

    // Flash the inserted line in the editor
    var decorations = editor.deltaDecorations([], [{
      range: new monaco.Range(insertLineNum, 1, insertLineNum, 1),
      options: { isWholeLine: true, className: 'line-flash-highlight' }
    }]);
    setTimeout(function () { editor.deltaDecorations(decorations, []); }, 1200);

    setStatus('Added ' + includeLine, 'success');

    // Brief visual feedback on the list item
    item.classList.add('library-item-added');
    setTimeout(function () { item.classList.remove('library-item-added'); }, 800);
  });

  // Lazy-load: fetch libraries when the Advanced dropdown is first opened
  advancedToggle.addEventListener('click', loadLibraries);

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — focus guard
   *
   *  Emscripten's runtime (via sokol_app) registers keyboard and clipboard
   *  event listeners on `window` / `document` globally, which means they
   *  intercept ALL keyboard input even when the canvas is not focused.
   *  It also calls canvas.focus() internally during init / load_file /
   *  rendering, which steals DOM focus from the editor.
   *
   *  We fix both problems:
   *   1. Override canvas.focus() so it only works on explicit user click.
   *   2. Monkey-patch addEventListener on window & document so that any
   *      keyboard / clipboard handlers registered by Emscripten or
   *      sokol_app are wrapped in a guard that only fires when the
   *      simulator canvas actually has DOM focus.
   * ══════════════════════════════════════════════════════════════════════ */
  var _simUserClicked = false;
  var _origCanvasFocus = simCanvas.focus.bind(simCanvas);

  simCanvas.focus = function () {
    if (_simUserClicked) {
      _origCanvasFocus();
    }
    // else silently ignore — prevents WASM from stealing focus
  };

  /* ── Intercept global keyboard / clipboard listeners from Emscripten ── */
  var _guardedEventTypes = [
    'keydown', 'keyup', 'keypress',   // keyboard
    'paste', 'copy', 'cut'            // clipboard
  ];

  function _isSimFocused() {
    return document.activeElement === simCanvas;
  }

  /**
   * Wraps a handler so it only runs when the simulator canvas is focused.
   * For keyboard events we also stop propagation so nothing downstream
   * (e.g. the Monaco editor) sees a double event.
   */
  function _wrapHandlerWithFocusGuard(originalHandler, eventType) {
    return function _focusGuardedHandler(event) {
      if (!_isSimFocused()) return;        // canvas not focused → ignore
      return originalHandler.call(this, event);
    };
  }

  /**
   * Patches addEventListener on a target (window or document) so that
   * keyboard/clipboard handlers added by Emscripten are focus-guarded.
   * Returns a cleanup function that restores the original method.
   */
  function _patchAddEventListener(target) {
    var _origAdd = target.addEventListener.bind(target);
    var _origRemove = target.removeEventListener.bind(target);
    // Map original handler → wrapped handler so removeEventListener works
    var _handlerMap = new WeakMap();

    target.addEventListener = function (type, handler, options) {
      if (_guardedEventTypes.indexOf(type) !== -1 && typeof handler === 'function') {
        var wrapped = _wrapHandlerWithFocusGuard(handler, type);
        _handlerMap.set(handler, wrapped);
        return _origAdd(type, wrapped, options);
      }
      return _origAdd(type, handler, options);
    };

    target.removeEventListener = function (type, handler, options) {
      if (_guardedEventTypes.indexOf(type) !== -1 && typeof handler === 'function') {
        var wrapped = _handlerMap.get(handler);
        if (wrapped) {
          _handlerMap.delete(handler);
          return _origRemove(type, wrapped, options);
        }
      }
      return _origRemove(type, handler, options);
    };

    return function restore() {
      target.addEventListener = _origAdd;
      target.removeEventListener = _origRemove;
    };
  }

  // Patches deferred to initArdens() — not applied globally at startup
  // to avoid breaking keyboard handlers in the host Webtools app.
  var _restoreWindowListeners  = null;
  var _restoreDocumentListeners = null;

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — WASM lazy loading
   * ══════════════════════════════════════════════════════════════════════ */
  function initArdens() {
    if (ardensReady) {
      return Promise.resolve(ardensModule);
    }
    if (ardensLoading) {
      return new Promise(function (resolve) {
        var check = setInterval(function () {
          if (ardensReady) {
            clearInterval(check);
            resolve(ardensModule);
          }
        }, 100);
      });
    }

    ardensLoading = true;

    // Apply focus-guard patches only during WASM initialization
    // to prevent Emscripten from hijacking keyboard events globally
    _restoreWindowListeners = _patchAddEventListener(window);
    _restoreDocumentListeners = _patchAddEventListener(document);

    return new Promise(function (resolve, reject) {
      // Ardens.js uses the old-style Emscripten Module global pattern.
      // window.Module must be pre-set with canvas + onRuntimeInitialized
      // BEFORE the script is loaded so the module picks up our settings.
      window.Module = {
        canvas: simCanvas,
        onRuntimeInitialized: function () {
          ardensModule = window.Module;
          ardensReady = true;
          ardensLoading = false;
          ardensScriptLoaded = true;

          // Restore original addEventListener AFTER callMain() has finished.
          // Emscripten calls onRuntimeInitialized first, then callMain()
          // synchronously — sokol_app registers keyboard/clipboard handlers
          // on window/document during callMain(). Using setTimeout(fn, 0)
          // defers the restore to after the current call stack completes,
          // ensuring those handlers are wrapped with the focus guard.
          setTimeout(function () {
            if (_restoreWindowListeners) _restoreWindowListeners();
            if (_restoreDocumentListeners) _restoreDocumentListeners();
          }, 0);

          setSimParam('z', '1');
          setSimParam('af', '1');
          syncSimFromTarget();

          simPlaceholder.classList.add('hidden');
          resolve(ardensModule);
        },
      };

      var script = document.createElement('script');
      script.src = '/compiler/ardens/Ardens.js';
      script.onerror = function () {
        ardensLoading = false;
        // Restore even on error
        if (_restoreWindowListeners) _restoreWindowListeners();
        if (_restoreDocumentListeners) _restoreDocumentListeners();
        reject(new Error('Failed to load Ardens.js'));
      };
      document.head.appendChild(script);
    }).catch(function (err) {
      ardensLoading = false;
      console.error('[Simulator] Init failed:', err);
      setStatus('Simulator error: ' + err.message);
      throw err;
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — helpers
   * ══════════════════════════════════════════════════════════════════════ */
  function setSimParam(name, value) {
    if (!ardensReady || !ardensModule) return;
    try {
      ardensModule.ccall('setparam', null, ['string', 'string'], [name, value]);
    } catch (e) {
      console.warn('[Simulator] setparam error:', e);
    }
    // Also sync to popout if active
    if (isPopoutActive()) {
      postToPopout({ type: 'set-param', name: name, value: value });
    }
  }

  function loadHexIntoSimulator(hexText) {
    if (!ardensReady || !ardensModule) return;

    var encoder = new TextEncoder();
    var fdata = encoder.encode(hexText);
    var ptr = ardensModule._malloc(fdata.length);

    ardensModule.HEAPU8.set(fdata, ptr);
    ardensModule.ccall(
      'load_file', 'number',
      ['string', 'string', 'number', 'number'],
      ['file', 'firmware.hex', ptr, fdata.length]
    );
    ardensModule._free(ptr);
  }

  /**
   * Build an .arduboy ZIP package containing the hex + FX data and load it
   * into Ardens as a single atomic operation. The .arduboy format uses an
   * info.json that points to the hex and flashdata files inside the ZIP.
   * Ardens loads hex, fxdata, and fxsave together in one pass, avoiding the
   * intermediate reset/reload_fx() issues of separate load_file calls.
   */
  function loadArduboyPackage(hexText, fxBinData) {
    if (!ardensReady || !ardensModule) return Promise.resolve();

    var info = {
      title: 'Cloud Build',
      binaries: [{
        title: 'Cloud Build',
        filename: 'firmware.hex',
        flashdata: 'fxdata.bin',
      }],
    };

    var zip = new JSZip();
    zip.file('info.json', JSON.stringify(info));
    zip.file('firmware.hex', hexText);
    zip.file('fxdata.bin', fxBinData);

    return zip.generateAsync({ type: 'uint8array' }).then(function (zipData) {
      var ptr = ardensModule._malloc(zipData.length);
      ardensModule.HEAPU8.set(zipData, ptr);
      ardensModule.ccall(
        'load_file', 'number',
        ['string', 'string', 'number', 'number'],
        ['file', 'project.arduboy', ptr, zipData.length]
      );
      ardensModule._free(ptr);
    });
  }

  /**
   * Load hex (and optionally FX data) into the simulator.
   * Uses .arduboy package when FX data is present for atomic loading.
   */
  function loadIntoSimulator(hexText) {
    var fxData = null;
    if (loadDevDataCheckbox.checked) {
      fxData = getSelectedFxDataBinary();
    }

    if (fxData) {
      return loadArduboyPackage(hexText, fxData).then(function () {
        syncSimFromTarget();
      });
    } else {
      loadHexIntoSimulator(hexText);
      syncSimFromTarget();
      return Promise.resolve();
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — panel open / close
   * ══════════════════════════════════════════════════════════════════════ */
  function openSimulatorPanel() {
    simulatorPanel.classList.remove('sim-hidden');
    setTimeout(function () {
      if (editor) editor.layout();
      // Let Ardens know the canvas has a real size now
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }

  function closeSimulatorPanel() {
    simulatorPanel.classList.add('sim-hidden');
    // Reset dev tools mode when closing the panel
    if (simDevToolsActive) {
      closeDevTools();
    }
    if (editor) {
      setTimeout(function () { editor.layout(); }, 300);
    }
  }

  function toggleSimulatorPanel() {
    if (simulatorPanel.classList.contains('sim-hidden')) {
      openSimulatorPanel();
      // Don't load into main Ardens if popout is handling it
      if (lastHexText && !isPopoutActive()) {
        initArdens().then(function () {
          return loadIntoSimulator(lastHexText);
        }).catch(function () { /* logged in initArdens */ });
      }
    } else {
      closeSimulatorPanel();
    }
  }

  function showSimulatorWithHex(hexText) {
    lastHexText = hexText;
    updateLoadDevDataState();

    // If popout is active, send data there instead
    if (isPopoutActive()) {
      var fxData = null;
      if (loadDevDataCheckbox.checked) {
        var fxBin = getSelectedFxDataBinary();
        if (fxBin) fxData = Array.from(fxBin);
      }
      if (fxData) {
        postToPopout({ type: 'load-arduboy', hex: hexText, fxData: fxData });
      } else {
        postToPopout({ type: 'load-hex', hex: hexText });
      }
      return;
    }

    openSimulatorPanel();
    initArdens().then(function () {
      return loadIntoSimulator(hexText);
    }).catch(function () { /* logged in initArdens */ });
  }

  simulatorPanel.addEventListener('transitionend', function () {
    if (editor) editor.layout();
    window.dispatchEvent(new Event('resize'));
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — event listeners
   * ══════════════════════════════════════════════════════════════════════ */
  simCloseBtn.addEventListener('click', closeSimulatorPanel);
  simToggleBtn.addEventListener('click', toggleSimulatorPanel);

  simSettingsToggle.addEventListener('click', function () {
    var open = simSettingsDropdown.classList.toggle('hidden') === false;
    simSettingsToggle.classList.toggle('open', open);
  });

  function openDevTools() {
    simDevToolsActive = true;
    setSimParam('z', '0');
    devtoolsModal.classList.remove('hidden');
    compilerRoot.classList.add('devtools-active');
    simDevToolsBtn.classList.add('active');
    // Notify Ardens of the new canvas dimensions after the layout change
    setTimeout(function () {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  function closeDevTools() {
    simDevToolsActive = false;
    setSimParam('z', '1');
    devtoolsModal.classList.add('hidden');
    compilerRoot.classList.remove('devtools-active');
    simDevToolsBtn.classList.remove('active');
    // Restore Ardens to the normal panel canvas size
    setTimeout(function () {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  simDevToolsBtn.addEventListener('click', function () {
    // When popout is active, focus the popout window instead
    if (isPopoutActive()) {
      simPopoutWindow.focus();
      return;
    }
    if (simDevToolsActive) {
      closeDevTools();
    } else {
      openDevTools();
    }
  });

  devtoolsCloseBtn.addEventListener('click', function () {
    closeDevTools();
  });

  simCanvas.addEventListener('click', function () {
    _simUserClicked = true;
    _origCanvasFocus();
    _simUserClicked = false;
  });

  simCanvas.addEventListener('focus', function () {
    simCanvasWrap.classList.add('sim-focused');
  });

  simCanvas.addEventListener('blur', function () {
    simCanvasWrap.classList.remove('sim-focused');
  });

  simCanvas.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) !== -1) {
      e.preventDefault();
    }
  });

  /* ── Simulator settings change handlers ─────────────────────────────── */
  simPalette.addEventListener('change', function () {
    setSimParam('p', this.value);
  });
  simGrid.addEventListener('change', function () {
    setSimParam('g', this.value);
  });
  simFilter.addEventListener('change', function () {
    setSimParam('f', this.value);
  });
  simOrientation.addEventListener('change', function () {
    setSimParam('ori', this.value);
  });
  simVolume.addEventListener('input', function () {
    simVolumeLabel.textContent = this.value + '%';
    setSimParam('v', this.value);
  });
  simAutoFilter.addEventListener('change', function () {
    setSimParam('af', this.checked ? '1' : '0');
  });
  simIntScale.addEventListener('change', function () {
    setSimParam('i', this.checked ? '1' : '0');
  });
  simDisplayType.addEventListener('change', function () {
    setSimParam('display', this.value);
  });
  simFxPort.addEventListener('change', function () {
    setSimParam('fxport', this.value);
  });
  simCurrent.addEventListener('change', function () {
    setSimParam('c', this.value);
  });

  simClearStorageBtn.addEventListener('click', function () {
    showConfirmModal(
      'Clear Sim Settings',
      'Clear all Ardens simulator layout and preferences? Page must be refreshed for changes to take effect.',
      'Clear'
    ).then(function (ok) {
      if (!ok) return;
      try {
        var req = indexedDB.deleteDatabase('/offline');
        req.onsuccess = function () {
          console.log('[Simulator] Ardens IDBFS database cleared.');
          if (ardensReady && lastHexText) {
            loadIntoSimulator(lastHexText);
          }
        };
        req.onerror = function () {
          console.warn('[Simulator] Failed to clear Ardens IDBFS database.');
        };
      } catch (e) {
        console.warn('[Simulator] Error clearing Ardens storage:', e);
      }
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Simulator — Popout Window
   * ══════════════════════════════════════════════════════════════════════ */
  function isPopoutActive() {
    return simPopoutWindow && !simPopoutWindow.closed;
  }

  /** Gather the current simulator settings to sync to the popout */
  function gatherSimSettings() {
    return {
      p: simPalette.value,
      g: simGrid.value,
      f: simFilter.value,
      ori: simOrientation.value,
      v: simVolume.value,
      af: simAutoFilter.checked ? '1' : '0',
      i: simIntScale.checked ? '1' : '0',
      display: simDisplayType.value,
      fxport: simFxPort.value,
      c: simCurrent.value,
    };
  }

  /** Send a message to the popout window if it's open */
  function postToPopout(msg) {
    if (isPopoutActive()) {
      simPopoutWindow.postMessage(msg, '*');
    }
  }

  /** Open the simulator in a popup window */
  function openSimPopout() {
    if (isPopoutActive()) {
      simPopoutWindow.focus();
      return;
    }

    // Determine initial data to send
    var fxData = null;
    if (loadDevDataCheckbox.checked && lastHexText) {
      var fxBin = getSelectedFxDataBinary();
      if (fxBin) fxData = Array.from(fxBin);
    }

    var theme = compilerRoot.classList.contains('light-theme') ? 'light' : 'dark';

    // Open the popup
    var w = 500;
    var h = 400;
    var left = window.screenX + Math.round((window.outerWidth - w) / 2);
    var top = window.screenY + Math.round((window.outerHeight - h) / 2);
    simPopoutWindow = window.open(
      '/compiler/sim-popout.html', 'ardensPopout',
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
      ',resizable=yes,scrollbars=no,menubar=no,toolbar=no,status=no'
    );

    if (!simPopoutWindow) {
      setStatus('Popup blocked — please allow popups for this site');
      return;
    }

    // Send init data once the popup is loaded
    simPopoutWindow.addEventListener('load', function () {
      simPopoutWindow.postMessage({
        type: 'init',
        theme: theme,
        settings: gatherSimSettings(),
        hex: lastHexText || null,
        fxData: fxData,
      }, '*');
    });

    // Show placeholder and hide canvas in the main panel
    simPopoutPlaceholder.classList.remove('hidden');
    simCanvas.style.visibility = 'hidden';

    // Minimize the SimulatorPanel
    closeSimulatorPanel();

    // Poll for popup close (backup for beforeunload)
    var closePoll = setInterval(function () {
      if (!simPopoutWindow || simPopoutWindow.closed) {
        clearInterval(closePoll);
        onPopoutClosed();
      }
    }, 500);
  }

  /** Handle popout window closing — restore main simulator */
  function onPopoutClosed() {
    if (!simPopoutWindow && simPopoutPlaceholder.classList.contains('hidden')) return; // already handled
    simPopoutWindow = null;

    // Restore canvas visibility and hide placeholder
    simPopoutPlaceholder.classList.add('hidden');
    simCanvas.style.visibility = '';

    // If there was hex data, reinitialize ardens in main window
    if (lastHexText) {
      openSimulatorPanel();
      initArdens().then(function () {
        return loadIntoSimulator(lastHexText);
      }).catch(function () { /* logged in initArdens */ });
    }
  }

  /** Listen for messages from the popout */
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || !data.type) return;

    if (data.type === 'popout-closed') {
      onPopoutClosed();
    }
  });

  simPopoutBtn.addEventListener('click', function () {
    openSimPopout();
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  File menu
   * ══════════════════════════════════════════════════════════════════════ */
  fileMenuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!fileMenu.classList.contains('hidden')) { closeAllMenus(); return; }
    openMenu(fileMenu, fileMenuBtn);
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Hamburger / Options menu
   * ══════════════════════════════════════════════════════════════════════ */
  hamburgerBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!hamburgerMenu.classList.contains('hidden')) { closeAllMenus(); return; }
    openMenu(hamburgerMenu, hamburgerBtn);
  });

  document.addEventListener('click', function (e) {
    if (!hamburgerMenu.classList.contains('hidden') &&
        !hamburgerMenu.contains(e.target) &&
        !hamburgerBtn.contains(e.target)) {
      hamburgerMenu.classList.add('hidden');
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      menuBarAnyOpen = false;
    }
    if (!fxMenu.classList.contains('hidden') &&
        !fxMenu.contains(e.target) &&
        !fxMenuBtn.contains(e.target)) {
      fxMenu.classList.add('hidden');
      fxMenuBtn.setAttribute('aria-expanded', 'false');
      menuBarAnyOpen = false;
    }
    if (!fileMenu.classList.contains('hidden') &&
        !fileMenu.contains(e.target) &&
        !fileMenuBtn.contains(e.target)) {
      fileMenu.classList.add('hidden');
      fileMenuBtn.setAttribute('aria-expanded', 'false');
      menuBarAnyOpen = false;
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  FX menu
   * ══════════════════════════════════════════════════════════════════════ */
  fxMenuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!fxMenu.classList.contains('hidden')) { closeAllMenus(); return; }
    // Update Load Dev Data enabled state
    updateLoadDevDataState();
    openMenu(fxMenu, fxMenuBtn);
  });

  function updateLoadDevDataState() {
    var hasSelectedBin = !!getResolvedFxDataFilename();
    if (hasSelectedBin) {
      loadDevDataLabel.classList.remove('hmenu-row--disabled');
      loadDevDataCheckbox.disabled = false;
    } else {
      loadDevDataLabel.classList.add('hmenu-row--disabled');
      loadDevDataCheckbox.disabled = true;
    }
    // Load FX Data button requires both a previous compile and a .bin file
    if (lastHexText && hasSelectedBin) {
      fxLoadDataBtn.classList.remove('hmenu-row--disabled');
    } else {
      fxLoadDataBtn.classList.add('hmenu-row--disabled');
    }
    // Mirror state to the ribbon button
    var ribbonLoadBtn = document.getElementById('fxLoadDataBtnRibbon');
    if (ribbonLoadBtn) {
      if (lastHexText && hasSelectedBin) {
        ribbonLoadBtn.classList.remove('hmenu-row--disabled');
      } else {
        ribbonLoadBtn.classList.add('hmenu-row--disabled');
      }
    }
  }

  fxLoadDataBtn.addEventListener('click', function () {
    closeAllMenus();
    if (!lastHexText) {
      setStatus('No previous build available — compile first');
      return;
    }
    var fxData = getSelectedFxDataBinary();
    if (!fxData) {
      setStatus('No FX data .bin file selected');
      return;
    }
    setStatus('Loading FX data into simulator...');

    // Route to popout if active
    if (isPopoutActive()) {
      postToPopout({ type: 'load-arduboy', hex: lastHexText, fxData: Array.from(fxData) });
      setStatus('FX data loaded into simulator');
      return;
    }

    openSimulatorPanel();
    initArdens().then(function () {
      return loadArduboyPackage(lastHexText, fxData);
    }).then(function () {
      syncSimFromTarget();
      setStatus('FX data loaded into simulator');
    }).catch(function () {
      setStatus('Failed to load FX data');
    });
  });

  var FXDATA_TEMPLATE =
    '// FX Data resource file\n' +
    '//\n' +
    '// Data types:\n' +
    '//   image_t   — a .png or .bmp image file  (e.g. image_t logo = "logo.png")\n' +
    '//   raw_t     — include a raw binary file  (e.g. raw_t level = "level.bin")\n' +
    '//   uint8_t   — 8-bit byte values\n' +
    '//   int16_t / uint16_t — 16-bit values\n' +
    '//   int24_t / uint24_t — 24-bit FX data addresses\n' +
    '//   int32_t / uint32_t — 32-bit values\n' +
    '//   string    — a quoted string constant  (e.g. string msg = "Hello!")\n' +
    '//\n' +
    '// Examples:\n' +
    '//   image_t playerSprite = "assets/player.png"\n' +
    '//   image_t tileSheet    = "assets/tiles.png"\n' +
    '//\n' +
    '//   uint8_t levelData[] = {\n' +
    '//     1, 2, 3, 4, 5\n' +
    '//   };\n' +
    '//\n' +
    '// Upload binary files (.png, .bin, etc.) using the Import button or\n' +
    '// drag and drop. Reference them here by filename.\n' +
    '//\n' +
    '// See: https://github.com/MrBlinky/Arduboy-homemade-package\n' +
    '\n';

  fxCreateDataBtn.addEventListener('click', function () {
    closeAllMenus();

    // Check if fxdata.txt already exists (in any subdirectory)
    var existing = null;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].filename.replace(/.*\//, '').toLowerCase() === 'fxdata.txt') {
        existing = tabs[i];
        break;
      }
    }
    if (existing) {
      switchToTab(existing.id);
      setStatus('fxdata.txt already exists');
      return;
    }

    if (typeof monaco !== 'undefined') {
      createTab('fxdata.txt', FXDATA_TEMPLATE, false);
      setStatus('Created fxdata.txt');
    }
  });

  // Build FX Data — ribbon button
  var fxBuildDataBtnRibbon = document.getElementById('fxBuildDataBtn');
  if (fxBuildDataBtnRibbon) {
    fxBuildDataBtnRibbon.addEventListener('click', function () {
      fxBuildData();
    });
  }

  // Load FX Data — ribbon button (mirrors the FX dropdown Load FX Data)
  var fxLoadDataBtnRibbon = document.getElementById('fxLoadDataBtnRibbon');
  if (fxLoadDataBtnRibbon) {
    fxLoadDataBtnRibbon.addEventListener('click', function () {
      if (fxLoadDataBtnRibbon.classList.contains('hmenu-row--disabled')) return;
      if (!lastHexText) {
        setStatus('No previous build available \u2014 compile first');
        return;
      }
      var fxData = getSelectedFxDataBinary();
      if (!fxData) {
        setStatus('No FX data .bin file selected');
        return;
      }
      setStatus('Loading FX data into simulator...');

      if (isPopoutActive()) {
        postToPopout({ type: 'load-arduboy', hex: lastHexText, fxData: Array.from(fxData) });
        setStatus('FX data loaded into simulator');
        return;
      }

      openSimulatorPanel();
      initArdens().then(function () {
        return loadArduboyPackage(lastHexText, fxData);
      }).then(function () {
        syncSimFromTarget();
        setStatus('FX data loaded into simulator');
      }).catch(function () {
        setStatus('Failed to load FX data');
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Theme toggle
   * ══════════════════════════════════════════════════════════════════════ */
  var currentTheme = localStorage.getItem('theme') || 'arduboy-dark';
  if (currentTheme === 'arduboy-light') {
    compilerRoot.classList.add('light-theme');
  }

  themeToggleBtn.addEventListener('click', function () {
    if (currentTheme === 'arduboy-dark') {
      currentTheme = 'arduboy-light';
      compilerRoot.classList.add('light-theme');
    } else {
      currentTheme = 'arduboy-dark';
      compilerRoot.classList.remove('light-theme');
    }
    if (typeof monaco !== 'undefined') {
      monaco.editor.setTheme(currentTheme);
    }
    localStorage.setItem('theme', currentTheme);
    // Sync theme to popout
    if (isPopoutActive()) {
      postToPopout({ type: 'theme', theme: currentTheme === 'arduboy-light' ? 'light' : 'dark' });
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Status / log helpers
   * ══════════════════════════════════════════════════════════════════════ */
  function setStatus(msg, explicitType) {
    var container = document.getElementById('toastContainer');
    if (!container) return;

    // Determine visual type from message content (or use explicit override)
    var type = explicitType || 'info';
    if (!explicitType) {
    if (/^(error|build failed|network error|simulator error)/i.test(msg)) {
      type = 'error';
    } else if (/^build succeeded/i.test(msg)) {
      type = 'success';
    } else if (/^(submitting|queued|building)/i.test(msg)) {
      type = 'info';
    }
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.textContent = msg;

    container.appendChild(toast);

    // Trigger slide-in on next paint
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add('toast--visible');
      });
    });

    function dismiss() {
      if (toast._dismissed) return;
      toast._dismissed = true;
      toast.classList.remove('toast--visible');
      toast.classList.add('toast--hiding');
      toast.addEventListener('transitionend', function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, { once: true });
    }

    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, type === 'error' ? 7000 : 4500);
  }

  /**
   * Clean and streamline raw arduino-cli build output for display.
   *
   * Strategy:
   *   - Keep each original line (with ANSI formatting from arduino-cli).
   *   - Use an ANSI-stripped copy of each line purely for regex detection.
   *   - Lines we rewrite (diagnostics, errors) use clean text + our colours.
   *   - Lines we keep (library tables, etc.) use the original ANSI text
   *     with only the path portion surgically removed.
   */
  function formatBuildOutput(raw) {
    if (!raw) return '';

    var rawLines = raw.split('\n');

    // ── GCC diagnostic patterns ────────────────────────────────────────
    // Diagnostic: /abs/path/file:line:col: severity: message
    //         or  /abs/path/file:line: severity: message
    var reDiag = /^(\/[^:\n]+):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.*)$/;

    // Linker error: /path/file.ext:line: message  (no severity keyword)
    // Only match source-file extensions to avoid object/archive files.
    var reLinkerDiag = /^(\/[^:\n]+\.(?:ino|cpp|c|h|hpp)):(\d+):\s+(.{3,})$/;

    // Tool error: collect2: error: …  / ld: error: …  etc.
    var reToolError = /^(collect2|avr-ld|ld(?:\.exe)?):\s*(error|warning|fatal error):\s*(.+)$/i;

    // Function-context preamble: /path/file: In function 'foo():
    //   also matches: At global scope, In member function, In instantiation of …
    var reFuncCtx = /^\/[^:\n]+(?::\d+(?::\d+)?)?:\s+((?:In |At )\S.*|required from here.*)$/;

    // "In file included from /abs/path/file:line:col:" preamble
    var reIncludedFrom = /^In file included from (\/[^:\n]+):(\d+)(?::(\d+))?:$/;

    // A snippet / caret line starts with at least one space
    var reIndented = /^\s/;

    // ── State ──────────────────────────────────────────────────────────
    var htmlParts = [];
    var pendingFuncCtx   = null;   // extracted function name string
    var pendingIncludeCtx = null;  // truncated "In file included from ..." text
    var pendingDiag      = null;   // {file, lineNum, col, severity, message}
    var pendingSnippet   = [];     // raw (clean) lines: source + caret
    var pendingRawLine   = null;   // original raw error line before parsing
    var inSnippetMode    = false;

    // ── Helpers ────────────────────────────────────────────────────────
    function diagBasename(filepath) {
      return filepath.replace(/.*\//, '');
    }

    function diagSevClass(sev) {
      return (sev === 'error' || sev === 'fatal error') ? 'error'
           : (sev === 'warning')                        ? 'warning'
           :                                              'note';
    }

    function buildDiagHtml(funcCtx, includeCtx, diag, snippetLines, rawLine) {
      var sc       = diagSevClass(diag.severity);
      var sevLabel = diag.severity === 'fatal error' ? 'fatal' : diag.severity;
      var file     = diagBasename(diag.file);
      var rawText  = rawLine ? rawLine.replace(/\x1b\[[\d;]*m/g, '') : '';

      /* ── Snippet: highlight the characters under the caret ── */
      var snippetHtml = '';
      var firstSourceLineText = '';
      if (snippetLines.length > 0) {
        // Build an array of {raw, html, isCaret} objects so we can back-patch
        // the source line once we know the caret position.
        var rendered = [];
        for (var k = 0; k < snippetLines.length; k++) {
          var sl = snippetLines[k];
          var caretM = sl.match(/^(\s*)(\^[\^~]*)(.*)$/);
          if (caretM && /^\s*\^/.test(sl)) {
            // Caret line — back-patch the most recent non-caret source line
            var indent   = caretM[1].length;
            var caretLen = caretM[2].length;
            for (var m = rendered.length - 1; m >= 0; m--) {
              if (!rendered[m].isCaret) {
                var src = rendered[m].raw;
                rendered[m].html =
                  escapeHtml(src.slice(0, indent)) +
                  '<span class="diag-hl">' +
                  escapeHtml(src.slice(indent, indent + caretLen)) +
                  '</span>' +
                  escapeHtml(src.slice(indent + caretLen));
                break;
              }
            }
            rendered.push({ raw: sl, html: escapeHtml(sl), isCaret: true });
          } else {
            rendered.push({ raw: sl, html: escapeHtml(sl), isCaret: false });
          }
        }
        // Only include the first source line (non-caret), skip caret lines
        var firstSourceLine = rendered.find(function (r) { return !r.isCaret; });
        snippetHtml = firstSourceLine
          ? '<pre class="diag-snippet">' + firstSourceLine.html + '</pre>'
          : '';
        firstSourceLineText = firstSourceLine ? firstSourceLine.raw : '';
      }

      var colMeta = diag.col
        ? '<span class="diag-meta-row">' +
            '<span class="diag-meta-label">Char</span>' +
            '<span class="diag-meta-col">' + diag.col + '</span>' +
          '</span>'
        : '';

      var funcHtml = funcCtx
        ? '<span class="diag-meta-func">' + escapeHtml(funcCtx) + '</span>'
        : '';

      var includeHtml = includeCtx
        ? '<span class="diag-meta-include">' + escapeHtml(includeCtx) + '</span>'
        : '';

      // Build complete error text for copy button
      var completeErrorText = rawText;
      if (diag.message) {
        completeErrorText += '\n' + diag.message;
      }
      if (funcCtx) {
        completeErrorText += '\nin ' + funcCtx;
      }
      if (includeCtx) {
        completeErrorText += '\n' + includeCtx;
      }
      if (firstSourceLineText) {
        completeErrorText += '\n' + firstSourceLineText;
      }

      return '<span class="diag-block diag-block--' + sc + '"' +
               ' data-file="' + escapeHtml(file) + '"' +
               ' data-line="' + (diag.lineNum || '') + '"' +
               ' data-raw="' + escapeHtml(rawText) + '"' +
               ' data-full-error="' + escapeHtml(completeErrorText) + '"' +
               '>'  +
               '<span class="diag-cols">' +
                 '<span class="diag-col-label">' +
                   '<span class="diag-badge diag-badge--' + sc + '">' + sevLabel + '</span>' +
                 '</span>' +
                 '<span class="diag-col-left">' +
                   '<span class="diag-meta-file">' + escapeHtml(file) + '</span>' +
                   (diag.lineNum
                     ? '<span class="diag-meta-row">' +
                         '<span class="diag-meta-label">Line</span>' +
                         '<span class="diag-meta-line">' + diag.lineNum + '</span>' +
                       '</span>'
                     : '') +
                   colMeta +
                 '</span>' +
                 '<span class="diag-col-right">' +
                   '<span class="diag-message-func">' +
                     '<span class="diag-message">' + escapeHtml(diag.message) + '</span>' +
                     funcHtml +
                   '</span>' +
                   includeHtml +
                   snippetHtml +
                 '</span>' +
                 '<button class="diag-copy-btn" title="Copy full error" aria-label="Copy full error"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="13" height="13" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M9 9h10v10h-10z" fill="currentColor" opacity="0.2"/><path d="M20 9v10a1 1 0 0 1-1 1H9" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></button>' +
               '</span>' +
             '</span>';
    }

    function flushDiag() {
      if (!pendingDiag) return;
      htmlParts.push(buildDiagHtml(pendingFuncCtx, pendingIncludeCtx, pendingDiag, pendingSnippet, pendingRawLine));
      pendingDiag      = null;
      pendingFuncCtx   = null;
      pendingIncludeCtx = null;
      pendingSnippet   = [];
      pendingRawLine   = null;
      inSnippetMode    = false;
    }

    // ── Main loop ──────────────────────────────────────────────────────
    for (var i = 0; i < rawLines.length; i++) {
      var orig  = rawLines[i].replace(/\r$/, '');
      var clean = orig.replace(/\x1b\[[\d;]*m/g, '');

      // ── Always-skip lines ──────────────────────────────────────────
      if (/^\$ /.test(clean))                              continue;
      if (/Sketch uses \d+ bytes/.test(clean))             continue;
      if (/Global variables use \d+ bytes/.test(clean))    continue;
      if (/^Error during build: exit status \d+/.test(clean)) continue;
      if (/^\[error\]/.test(clean))                        continue;
      // collect2/ld "ld returned N exit status" — redundant, real error already shown
      if (/^collect2:.*ld returned \d+ exit status/.test(clean)) continue;
      if (/^(?:avr-ld|ld(?:\.exe)?):\s.*returned \d+ exit status/.test(clean)) continue;

      // ── Snippet / caret continuation ──────────────────────────────
      if (inSnippetMode && pendingDiag && reIndented.test(clean)) {
        pendingSnippet.push(clean);
        continue;
      }

      // Blank line ends snippet collection but keeps the diag open
      // (a note may still follow on the next non-blank line)
      if (inSnippetMode && clean.trim() === '') {
        inSnippetMode = false;
        continue;
      }

      // ── GCC diagnostic line ────────────────────────────────────────
      var diagMatch = reDiag.exec(clean);
      if (diagMatch) {
        // Always flush any previous diag before starting a new one
        flushDiag();
        pendingDiag = {
          file:    diagMatch[1],
          lineNum: diagMatch[2],
          col:     diagMatch[3] || null,
          severity: diagMatch[4],
          message:  diagMatch[5]
        };
        pendingRawLine = orig;
        inSnippetMode = true;
        continue;
      }

      // ── Linker diagnostic (no severity keyword) ────────────────────
      var linkerMatch = !diagMatch && reLinkerDiag.exec(clean);
      if (linkerMatch) {
        flushDiag();
        pendingDiag = {
          file:     linkerMatch[1],
          lineNum:  linkerMatch[2],
          col:      null,
          severity: 'error',
          message:  linkerMatch[3]
        };
        pendingRawLine = orig;
        inSnippetMode = false;   // linker errors have no source snippet
        continue;
      }

      // ── Tool error (collect2, ld, …) ──────────────────────────────────
      var toolMatch = !diagMatch && reToolError.exec(clean);
      if (toolMatch) {
        flushDiag();
        pendingDiag = {
          file:     toolMatch[1],   // e.g. "collect2"
          lineNum:  null,
          col:      null,
          severity: toolMatch[2],
          message:  toolMatch[3]
        };
        pendingRawLine = orig;
        inSnippetMode = false;
        continue;
      }

      // ── "In file included from …" preamble ──────────────────────
      var includeMatch = reIncludedFrom.exec(clean);
      if (includeMatch) {
        flushDiag();
        var incFile = diagBasename(includeMatch[1]);
        var incLine = includeMatch[2];
        var incCol  = includeMatch[3];
        pendingIncludeCtx = 'included from ' + incFile + ':' + incLine + (incCol ? ':' + incCol : '');
        continue;
      }

      // ── GCC function-context preamble ──────────────────────────────
      var ctxMatch = reFuncCtx.exec(clean);
      if (ctxMatch) {
        // Flush any current diag — this context belongs to the NEXT one
        flushDiag();
        // Extract just the function signature if possible
        var ctxRaw  = ctxMatch[1];
        var fnMatch = ctxRaw.match(/In (?:function|member function|static member function|constructor|destructor) '([^']*)'/);
        pendingFuncCtx = fnMatch ? fnMatch[1] : ctxRaw.replace(/:$/, '').trim();
        continue;
      }

      // ── Everything else — flush pending diag, then emit normally ──
      flushDiag();
      inSnippetMode = false;

      // Simplify "Using library …" lines
      var libMatch = clean.match(/^Using library (.+?) at version ([\d.]+)/);
      if (libMatch) {
        htmlParts.push(ansiToHtml('Using library ' + libMatch[1] + ' v' + libMatch[2]) + '\n');
        continue;
      }

      // "Used library / platform" table: strip path column
      if (/^Used library\s+Version\s+Path/.test(clean)) {
        var hs = orig.replace(/(\s+)(\x1b\[[\d;]*m)*Path.*$/, '');
        htmlParts.push(ansiToHtml(hs) + '\n');
        continue;
      }
      if (/^Used platform\s+Version\s+Path/.test(clean)) {
        var ps = orig.replace(/(\s+)(\x1b\[[\d;]*m)*Path.*$/, '');
        htmlParts.push(ansiToHtml(ps) + '\n');
        continue;
      }
      if (/^\S.*\s+[\d.]+\s+\//.test(clean) && !/:\d+:/.test(clean)) {
        var rs = orig.replace(/\s+(\x1b\[[\d;]*m)*\/[^\x1b\n]*(\x1b\[[\d;]*m)*\s*$/, '');
        if (/\x1b\[0m\s*$/.test(orig) && !/\x1b\[0m\s*$/.test(rs)) rs += '\x1b[0m';
        htmlParts.push(ansiToHtml(rs) + '\n');
        continue;
      }

      htmlParts.push(ansiToHtml(orig) + '\n');
    }

    // Flush any remaining diagnostic
    flushDiag();

    // Trim trailing blank lines
    while (htmlParts.length > 0 && htmlParts[htmlParts.length - 1].trim() === '') {
      htmlParts.pop();
    }

    return htmlParts.join('');
  }


  var lastRawLog = '';

  function showLog(text) {
    lastRawLog = text || '';
    // formatBuildOutput now returns HTML directly (not ANSI)
    var html = formatBuildOutput(text);
    logPre.innerHTML = html;
    logPre.scrollTop = logPre.scrollHeight;

    // Count error-severity diagnostics and update header
    var errorMatches = html.match(/diag-block--error/g);
    var errorCount = errorMatches ? errorMatches.length : 0;
    if (errorCount > 0) {
      outputErrorCount.textContent = '| ERRORS: ' + errorCount;
      outputErrorCount.classList.remove('hidden');
    } else {
      outputErrorCount.classList.add('hidden');
    }

    // Show copy-raw button now that there is output
    if (lastRawLog) {
      copyRawOutputBtn.classList.remove('hidden');
    }
  }

  /* ── Click a diag-block → jump to file + line in editor ─────────── */
  logPre.addEventListener('click', function (e) {
    // Check if copy button was clicked
    var copyBtn = e.target.closest('.diag-copy-btn');
    if (copyBtn) {
      var block = copyBtn.closest('.diag-block');
      if (block && block.dataset.fullError) {
        navigator.clipboard.writeText(block.dataset.fullError).then(function () {
          // Show visual feedback
          var originalSvg = copyBtn.innerHTML;
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
          setTimeout(function () {
            copyBtn.innerHTML = originalSvg;
          }, 1500);
        }).catch(function (err) {
          console.error('Failed to copy text:', err);
        });
      }
      return;
    }

    var block = e.target.closest('.diag-block');
    if (!block) return;

    var file    = block.dataset.file;
    var lineNum = parseInt(block.dataset.line, 10);
    if (!file) return;

    var tab = findTabForBasename(file);
    if (!tab) return;

    // Switch to the right editor tab
    switchToTab(tab.id);

    if (!editor) return;

    var targetLine = isNaN(lineNum) ? 1 : lineNum;

    // Navigate to the line
    editor.revealLineInCenter(targetLine);
    editor.setPosition({ lineNumber: targetLine, column: 1 });
    editor.focus();

    // Flash the line once using a temporary decoration
    var flashIds = editor.deltaDecorations([], [{
      range: new monaco.Range(targetLine, 1, targetLine, 1),
      options: { isWholeLine: true, className: 'diag-flash-line' }
    }]);
    setTimeout(function () {
      editor.deltaDecorations(flashIds, []);
    }, 900);
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Diagnostic parser  (Arduino CLI → structured diagnostics)
   * ══════════════════════════════════════════════════════════════════════ */

  /**
   * Parse Arduino CLI compile output into structured diagnostics.
   *
   * Arduino CLI emits lines like:
   *   /tmp/job-xxx/Sketch/Sketch.ino:15:5: error: 'foo' was not declared
   *   /tmp/job-xxx/Sketch/helper.h:10:1: warning: unused variable 'x'
   *   /tmp/job-xxx/Sketch/Sketch.ino:8: error: expected ';'
   *
   * Returns an array of { basename, line, col, severity, message }.
   */
  function parseCompileDiagnostics(log) {
    var diagnostics = [];
    // Arduino CLI emits:  /abs/path/file.ext:line:col: severity: message
    //                 or  /abs/path/file.ext:line: severity: message
    // Paths are absolute Linux paths (server runs in Docker).
    var re = /^(\/[^:\n]+):(\d+)(?::(\d+))?:\s*(error|warning|note|fatal error):\s*(.+)$/gm;
    var m;
    while ((m = re.exec(log)) !== null) {
      var filepath = m[1];
      var lineNum  = parseInt(m[2], 10);
      var colNum   = m[3] ? parseInt(m[3], 10) : 1;
      var severity = m[4];
      var message  = m[5].trim();
      var basename = filepath.replace(/.*\//, '');
      if (!basename) continue;
      diagnostics.push({ basename: basename, line: lineNum, col: colNum, severity: severity, message: message });
    }

    // Linker errors emitted by ld/collect2 reference source files without a
    // severity keyword, e.g.:
    //   /tmp/.../Sketch.ino:8: undefined reference to `foo'
    // Match source-file paths (not .o object files) that have a line number
    // but no severity keyword so we don't double-count normal compiler errors.
    var reLinker = /^(\/[^:\n]+\.(?:ino|cpp|c|h|hpp)):(\d+):\s+(?!error:|warning:|note:|fatal error:)(.+)$/gm;
    while ((m = reLinker.exec(log)) !== null) {
      var filepath = m[1];
      var lineNum  = parseInt(m[2], 10);
      var message  = m[3].trim();
      var basename = filepath.replace(/.*\//, '');
      if (!basename) continue;
      diagnostics.push({ basename: basename, line: lineNum, col: 1, severity: 'error', message: message });
    }

    return diagnostics;
  }

  /**
   * Find which tab owns a given filename basename produced by the compiler.
   * Server always writes the .ino file as "Sketch.ino", so we map that
   * back to whichever tab has the .ino extension.
   */
  function findTabForBasename(basename) {
    if (basename === 'Sketch.ino') {
      for (var i = 0; i < tabs.length; i++) {
        if (getExtension(tabs[i].filename) === '.ino') return tabs[i];
      }
      return null;
    }
    return findTabByFilename(basename);
  }

  /**
   * Compute Monaco decoration specs (range + options) for a given tabId
   * from the current allDiagnostics array.
   */
  function buildDecorationSpecs(tabId) {
    var specs = [];
    allDiagnostics.forEach(function (diag) {
      var t = findTabForBasename(diag.basename);
      if (!t || t.id !== tabId) return;

      var lineClass, glyphClass;
      var sev = diag.severity;
      if (sev === 'error' || sev === 'fatal error') {
        lineClass  = 'diag-error-line';
        glyphClass = 'diag-error-glyph';
      } else if (sev === 'warning') {
        lineClass  = 'diag-warning-line';
        glyphClass = 'diag-warning-glyph';
      } else {
        lineClass  = 'diag-info-line';
        glyphClass = 'diag-info-glyph';
      }
      specs.push({
        range: new monaco.Range(diag.line, 1, diag.line, 1),
        options: {
          isWholeLine:          true,
          className:            lineClass,
          glyphMarginClassName: glyphClass,
        },
      });
    });
    return specs;
  }

  /**
   * Re-apply decorations to the editor for the currently active tab.
   * Uses per-tab IDs so repeated tab switches don't stack duplicates.
   */
  function applyEditorDecorations() {
    if (!editor || activeTabId === null) return;
    var specs   = diagnosticHighlightingEnabled
      ? (tabDecorationData[activeTabId] || [])
      : [];
    var oldIds  = tabDecorationIds[activeTabId] || [];
    tabDecorationIds[activeTabId] = editor.deltaDecorations(oldIds, specs);
  }

  /**
   * Build markers array for monaco.editor.setModelMarkers from diagnostics
   * belonging to a given tab.
   */
  function buildMarkers(tabId) {
    var markers = [];
    allDiagnostics.forEach(function (diag) {
      var t = findTabForBasename(diag.basename);
      if (!t || t.id !== tabId) return;

      var severity;
      var sev = diag.severity;
      if (sev === 'error' || sev === 'fatal error') {
        severity = monaco.MarkerSeverity.Error;
      } else if (sev === 'warning') {
        severity = monaco.MarkerSeverity.Warning;
      } else {
        severity = monaco.MarkerSeverity.Info;
      }
      markers.push({
        startLineNumber: diag.line,
        startColumn:     diag.col,
        endLineNumber:   diag.line,
        endColumn:       Math.max(diag.col + 1, diag.col),
        message:         diag.message,
        severity:        severity,
        source:          'arduino-cli',
      });
    });
    return markers;
  }

  /**
   * Apply diagnostics: set model markers (squiggles) + build decoration data
   * for all tabs, then render decorations in the currently visible editor.
   */
  function applyDiagnostics(diagnostics) {
    allDiagnostics = diagnostics;

    if (!diagnosticHighlightingEnabled) return;

    tabs.forEach(function (tab) {
      if (tab.isBinary) return;
      // Squiggly underlines via model markers
      monaco.editor.setModelMarkers(tab.model, 'arduboy-compile', buildMarkers(tab.id));
      // Store decoration specs for this tab
      tabDecorationData[tab.id] = buildDecorationSpecs(tab.id);
    });

    // Render decorations for the tab currently visible in the editor
    // Reset per-tab IDs for all tabs since markers were just rebuilt
    tabs.forEach(function (tab) { tabDecorationIds[tab.id] = []; });
    applyEditorDecorations();
  }

  /**
   * Clear all diagnostics: remove markers from all models and wipe decorations.
   */
  function clearAllDiagnostics() {
    allDiagnostics = [];
    tabs.forEach(function (tab) {
      if (tab.isBinary) return;
      monaco.editor.setModelMarkers(tab.model, 'arduboy-compile', []);
      tabDecorationData[tab.id] = [];
      if (editor && tab.id === activeTabId) {
        tabDecorationIds[tab.id] = editor.deltaDecorations(
          tabDecorationIds[tab.id] || [], []
        );
      } else {
        tabDecorationIds[tab.id] = [];
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Tab Manager
   * ══════════════════════════════════════════════════════════════════════ */
  var tabs = [];
  var activeTabId = null;
  var nextTabId = 1;
  var editor = null;

  /* diagnostic state */
  var diagnosticHighlightingEnabled = localStorage.getItem('highlightEnabled') !== 'false';
  var allDiagnostics         = [];   // last parsed diagnostics array
  var tabDecorationData      = {};   // tabId -> [{range, options}] specs
  var tabDecorationIds       = {};   // tabId -> active decoration IDs on that model

  function findTab(id) {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === id) return tabs[i];
    }
    return null;
  }

  function findTabByFilename(name) {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].filename === name) return tabs[i];
    }
    return null;
  }

  function getExtension(name) {
    var dot = name.lastIndexOf('.');
    return dot >= 0 ? name.substring(dot) : '';
  }

  function isValidFilename(name) {
    if (!/^[a-zA-Z0-9_.\-]+$/.test(name)) return false;
    var ext = getExtension(name);
    return VALID_EXTENSIONS.indexOf(ext) !== -1;
  }

  function countInoFiles() {
    var count = 0;
    for (var i = 0; i < tabs.length; i++) {
      if (getExtension(tabs[i].filename) === '.ino') count++;
    }
    return count;
  }

  function getLanguageForFile(filename) {
    var ext = getExtension(filename);
    if (ext === '.h' || ext === '.hpp') return 'cpp';
    if (ext === '.c') return 'c';
    if (ext === '.json') return 'json';
    if (ext === '.xml') return 'xml';
    if (ext === '.md') return 'markdown';
    if (ext === '.py') return 'python';
    if (ext === '.js') return 'javascript';
    if (ext === '.css') return 'css';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (ext === '.yaml' || ext === '.yml') return 'yaml';
    if (ext === '.sh' || ext === '.bash') return 'shell';
    return 'cpp';
  }

  /* ── Detect if data is likely text ─────────────────────────────────── */
  var TEXT_EXTENSIONS = [
    '.ino', '.h', '.hpp', '.cpp', '.c', '.txt', '.md', '.json', '.xml',
    '.csv', '.cfg', '.ini', '.yaml', '.yml', '.toml', '.py', '.js',
    '.ts', '.css', '.html', '.htm', '.sh', '.bash', '.bat', '.log',
    '.properties', '.gitignore', '.env', '.mk', '.cmake', '.s', '.asm',
    '.ld', '.map', '.lst', '.pde', '.java', '.rb', '.pl', '.lua',
    '.rs', '.go', '.swift', '.kt', '.gradle', '.makefile', '.license',
    '.patch', '.diff'
  ];

  function isTextFile(filename, data) {
    var ext = getExtension(filename).toLowerCase();
    if (TEXT_EXTENSIONS.indexOf(ext) !== -1) return true;
    // Check for known binary extensions
    var binaryExts = [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
      '.zip', '.gz', '.tar', '.rar', '.7z', '.bin', '.hex', '.elf',
      '.o', '.a', '.so', '.dll', '.exe', '.pdf', '.doc', '.docx',
      '.xls', '.xlsx', '.mp3', '.wav', '.ogg', '.mp4', '.avi', '.mov',
      '.ttf', '.otf', '.woff', '.woff2', '.eot', '.class', '.pyc'
    ];
    if (binaryExts.indexOf(ext) !== -1) return false;
    // Heuristic: check first 8KB for null bytes
    var checkLen = Math.min(data.length, 8192);
    for (var i = 0; i < checkLen; i++) {
      if (data[i] === 0) return false;
    }
    return true;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /** Sort tabs: .ino first, then paired .h/.cpp, then fxdata files, then the rest. */
  function sortTabs() {
    var fxdataOrder = { 'fxdata.h': 0, 'fxdata.txt': 1, 'fxdata.bin': 2 };

    function tabSortKey(tab) {
      if (tab.isBinary) return [99, tab.filename.toLowerCase(), 0]; // binaries at end

      var ext = getExtension(tab.filename).toLowerCase();
      var base = tab.filename.replace(/\.[^.]+$/, '').toLowerCase();
      // basename without path for fxdata matching
      var basename = tab.filename.replace(/.*\//, '').toLowerCase();

      // Group 0: .ino files
      if (ext === '.ino') return [0, base, 0];
      // Group 1: .h/.cpp files (excluding fxdata.h)
      if ((ext === '.h' || ext === '.cpp') && !(basename in fxdataOrder))
        return [1, base, ext === '.h' ? 0 : 1];
      // Group 2: fxdata files
      if (basename in fxdataOrder) return [2, '', fxdataOrder[basename]];
      // Group 3: everything else
      return [3, base, 0];
    }

    tabs.sort(function (a, b) {
      var ka = tabSortKey(a);
      var kb = tabSortKey(b);
      for (var i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
    renderTabBar();
  }

  /* ── Create a new tab ──────────────────────────────────────────────── */
  function createTab(filename, content, isDefault) {
    var id = nextTabId++;
    var uri = monaco.Uri.parse('file:///' + filename);
    var model = monaco.editor.createModel(content || '', getLanguageForFile(filename), uri);

    var tab = {
      id: id,
      filename: filename,
      model: model,
      viewState: null,
      isDefault: !!isDefault,
      isBinary: false,
      baselineContent: model.getValue(),
    };

    model.onDidChangeContent(function () {
      saveWorkspaceToLocalStorage();
      renderTabBar();
    });

    tabs.push(tab);
    if (!_loadingWorkspace) {
      renderTabBar();
      switchToTab(id);
      saveWorkspaceToLocalStorage();
    }

    // Attach FX Data View watcher for fxdata.txt
    if (filename.replace(/.*\//, '').toLowerCase() === 'fxdata.txt') {
      fxAttachModelWatcher(tab);
    }

    return tab;
  }

  /* ── Create a binary file tab ──────────────────────────────────────── */
  function createBinaryTab(filename, sizeBytes, binaryData) {
    // Check for existing binary entry
    var existing = findTabByFilename(filename);
    if (existing && existing.isBinary) {
      existing.binarySize = sizeBytes;
      if (binaryData) existing.binaryData = binaryData;
      renderBinariesList();
      return existing;
    }

    var id = nextTabId++;
    var tab = {
      id: id,
      filename: filename,
      model: null,
      viewState: null,
      isDefault: false,
      isBinary: true,
      binarySize: sizeBytes,
      binaryData: binaryData || null,
    };

    tabs.push(tab);
    renderTabBar();
    if (activeTabId === BINARIES_TAB_ID) renderBinariesList();
    saveWorkspaceToLocalStorage();
    return tab;
  }

  /* ── Switch to a tab ───────────────────────────────────────────────── */
  function switchToTab(id) {
    if (activeTabId === id) return;

    var prevTab = findTab(activeTabId);
    if (prevTab && editor && !prevTab.isBinary) {
      prevTab.viewState = editor.saveViewState();
    }

    activeTabId = id;

    // Always hide fxdata UI when switching tabs
    fxdataRibbon.classList.remove('visible');
    fxdataPlaceholder.classList.remove('visible');

    if (id === BINARIES_TAB_ID) {
      // Show binaries list, hide editor
      binaryFileInfo.classList.add('visible');
      renderBinariesList();
      if (editor) {
        var dn = editor.getDomNode();
        if (dn) dn.style.visibility = 'hidden';
      }
      renderTabBar();
      localStorage.setItem('activeTabFilename', '__binaries__');
      saveWorkspaceToLocalStorage();
      return;
    }

    var tab = findTab(id);
    // Show editor, hide binary info
    binaryFileInfo.classList.remove('visible');
    if (editor) {
      var dn = editor.getDomNode();
      if (dn) dn.style.visibility = 'visible';
      if (tab) {
        editor.setModel(tab.model);
        if (tab.viewState) {
          editor.restoreViewState(tab.viewState);
        }
        editor.focus();
        applyEditorDecorations();
      }
    }

    // Show fxdata ribbon when switching to fxdata.txt
    if (tab && tab.filename.replace(/.*\//, '').toLowerCase() === 'fxdata.txt') {
      fxdataRibbon.classList.add('visible');
      // If the placeholder was toggled on, restore it
      if (fxdataShowPlaceholder) {
        fxdataPlaceholder.classList.add('visible');
        if (editor) {
          var dn2 = editor.getDomNode();
          if (dn2) dn2.style.visibility = 'hidden';
        }
        fxInitViewFromSource();
      }
    }

    renderTabBar();
    localStorage.setItem('activeTabFilename', tab ? tab.filename : '');
    saveWorkspaceToLocalStorage();
  }

  /* ── Close a tab ───────────────────────────────────────────────────── */
  function closeTab(id) {
    var tab = findTab(id);
    if (!tab || getExtension(tab.filename) === '.ino') return;

    if (tab.model) {
      tab.model.dispose();
    }

    var idx = tabs.indexOf(tab);
    tabs.splice(idx, 1);

    if (tab.isBinary) {
      // If on the Binaries panel and no binaries left, switch away
      if (activeTabId === BINARIES_TAB_ID && !hasBinaryFiles()) {
        binaryFileInfo.classList.remove('visible');
        if (editor) {
          var edn = editor.getDomNode();
          if (edn) edn.style.visibility = 'visible';
        }
        var first = null;
        for (var ft = 0; ft < tabs.length; ft++) { if (!tabs[ft].isBinary) { first = tabs[ft]; break; } }
        if (first) { activeTabId = null; switchToTab(first.id); return; }
      }
    } else if (activeTabId === id) {
      // Find next non-binary tab
      var nextIdx = Math.max(0, idx - 1);
      var nextId = null;
      for (var ni = nextIdx; ni < tabs.length; ni++) { if (!tabs[ni].isBinary) { nextId = tabs[ni].id; break; } }
      if (!nextId) { for (var nj = nextIdx - 1; nj >= 0; nj--) { if (!tabs[nj].isBinary) { nextId = tabs[nj].id; break; } } }
      if (nextId) {
        activeTabId = null;
        switchToTab(nextId);
      }
    }

    renderTabBar();
    saveWorkspaceToLocalStorage();
  }

  /* ── Rename a tab ──────────────────────────────────────────────────── */
  function renameTab(id, newName) {
    var tab = findTab(id);
    if (!tab) return 'Tab not found';

    if (!isValidFilename(newName)) {
      return 'Invalid filename. Use only a-z, A-Z, 0-9, _, -, . with extension: ' + VALID_EXTENSIONS.join(', ');
    }

    if (findTabByFilename(newName) && findTabByFilename(newName).id !== id) {
      return 'A file named "' + newName + '" already exists.';
    }

    var oldExt = getExtension(tab.filename);
    var newExt = getExtension(newName);
    if (oldExt === '.ino' && newExt !== '.ino') {
      return 'Cannot change the .ino file to another extension.';
    }
    if (newExt === '.ino' && oldExt !== '.ino' && countInoFiles() >= 1) {
      return 'Only one .ino file is allowed.';
    }

    var content = tab.model.getValue();
    var viewState = editor && activeTabId === id ? editor.saveViewState() : tab.viewState;

    tab.model.dispose();

    tab.filename = newName;
    var uri = monaco.Uri.parse('file:///' + newName);
    tab.model = monaco.editor.createModel(content, getLanguageForFile(newName), uri);
    tab.viewState = viewState;

    if (activeTabId === id && editor) {
      editor.setModel(tab.model);
      tabDecorationIds[id] = [];   // old model's IDs are now invalid
      if (tab.viewState) editor.restoreViewState(tab.viewState);
      applyEditorDecorations();
    } else {
      tabDecorationIds[id] = [];   // reset so next switch starts clean
    }

    renderTabBar();
    saveWorkspaceToLocalStorage();

    // Update fxdata ribbon visibility if the active tab was renamed
    if (activeTabId === id) {
      if (newName.replace(/.*\//, '').toLowerCase() === 'fxdata.txt') {
        fxdataRibbon.classList.add('visible');
        if (fxdataShowPlaceholder) {
          fxdataPlaceholder.classList.add('visible');
          if (editor) {
            var dn = editor.getDomNode();
            if (dn) dn.style.visibility = 'hidden';
          }
        }
      } else {
        fxdataRibbon.classList.remove('visible');
        fxdataPlaceholder.classList.remove('visible');
        if (editor) {
          var dn = editor.getDomNode();
          if (dn) dn.style.visibility = 'visible';
        }
      }
    }

    return null;
  }

  /* ── Render tab bar ────────────────────────────────────────────────── */
  function hasBinaryFiles() {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary) return true;
    }
    return false;
  }

  function renderTabBar() {
    var existingTabs = tabBar.querySelectorAll('.tab');
    for (var i = 0; i < existingTabs.length; i++) {
      existingTabs[i].remove();
    }

    // Render text tabs only
    tabs.forEach(function (tab) {
      if (tab.isBinary) return; // skip binary — they go in the Binaries tab

      var el = document.createElement('div');
      var cls = 'tab';
      if (tab.filename.replace(/.*\//, '').toLowerCase() === 'fxdata.txt') cls += ' tab--fxdata';
      if (tab.id === activeTabId) cls += ' active';
      el.className = cls;
      el.setAttribute('data-tab-id', tab.id);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      var displayName = tab.filename;
      if (!tab.isBinary && tab.model && tab.model.getValue() !== tab.baselineContent) {
        displayName += '*';
      }
      nameSpan.textContent = displayName;
      el.appendChild(nameSpan);

      if (getExtension(tab.filename) !== '.ino') {
        var closeSpan = document.createElement('span');
        closeSpan.className = 'tab-close';
        closeSpan.textContent = '\u00d7';
        closeSpan.title = 'Close';
        closeSpan.addEventListener('click', function (e) {
          e.stopPropagation();
          showConfirmModal('Close File', 'Closing this tab will remove <b>' + escapeHtml(tab.filename) + '</b> from the project. This cannot be undone.', 'Close').then(function (ok) {
            if (ok) closeTab(tab.id);
          });
        });
        el.appendChild(closeSpan);
      }

      el.addEventListener('click', function () {
        switchToTab(tab.id);
      });

      el.addEventListener('dblclick', function (e) {
        e.preventDefault();
        startRename(tab.id, el);
      });

      tabBar.insertBefore(el, addTabBtn);
    });

    // Add single "Binaries" tab if there are binary files
    if (hasBinaryFiles()) {
      var binaryCount = 0;
      for (var b = 0; b < tabs.length; b++) { if (tabs[b].isBinary) binaryCount++; }
      var binEl = document.createElement('div');
      binEl.className = 'tab tab--binaries' + (activeTabId === BINARIES_TAB_ID ? ' active' : '');
      binEl.setAttribute('data-tab-id', BINARIES_TAB_ID);
      var binName = document.createElement('span');
      binName.className = 'tab-name';
      binName.textContent = 'Binaries (' + binaryCount + ')';
      binEl.appendChild(binName);
      binEl.addEventListener('click', function () {
        switchToTab(BINARIES_TAB_ID);
      });
      tabBar.insertBefore(binEl, addTabBtn);
    } else if (activeTabId === BINARIES_TAB_ID) {
      // No more binary files — switch away
      var firstTab = null;
      for (var ft = 0; ft < tabs.length; ft++) { if (!tabs[ft].isBinary) { firstTab = tabs[ft]; break; } }
      if (firstTab) { activeTabId = null; switchToTab(firstTab.id); }
    }
  }

  /* ── Render binaries list panel ────────────────────────────────────── */
  var IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg'];

  /** Return the resolved FX data filename: the explicit selection, or fxdata.bin if present, or the first .bin. */
  function getResolvedFxDataFilename() {
    var binFiles = [];
    var hasFxdata = false;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary && getExtension(tabs[i].filename).toLowerCase() === '.bin') {
        binFiles.push(tabs[i].filename);
        if (tabs[i].filename.replace(/.*\//, '').toLowerCase() === 'fxdata.bin') hasFxdata = true;
      }
    }
    if (binFiles.length === 0) return null;

    // If explicit selection exists and is still present, use it
    if (selectedFxDataFilename) {
      for (var j = 0; j < binFiles.length; j++) {
        if (binFiles[j] === selectedFxDataFilename) return selectedFxDataFilename;
      }
    }

    // Default: fxdata.bin if present, otherwise first .bin
    if (hasFxdata) {
      for (var k = 0; k < binFiles.length; k++) {
        if (binFiles[k].replace(/.*\//, '').toLowerCase() === 'fxdata.bin') return binFiles[k];
      }
    }
    return binFiles[0];
  }

  /** Return the binary Uint8Array data of the resolved FX data file, or null. */
  function getSelectedFxDataBinary() {
    var fname = getResolvedFxDataFilename();
    if (!fname) return null;
    var tab = findTabByFilename(fname);
    if (tab && tab.isBinary && tab.binaryData) return tab.binaryData;
    return null;
  }

  function binaryDataToUrl(tab) {
    if (!tab.binaryData) return null;
    var ext = getExtension(tab.filename).toLowerCase();
    var mimeMap = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
      '.webp': 'image/webp', '.svg': 'image/svg+xml'
    };
    var mime = mimeMap[ext] || 'application/octet-stream';
    var binary = '';
    var data = tab.binaryData;
    for (var i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    return 'data:' + mime + ';base64,' + btoa(binary);
  }

  /* ── Virtual folders for the binaries tree ──────────────────────────
     virtualFolders stores paths like "assets/sprites" that exist as
     user-created folders even when empty.                              */
  var virtualFolders = JSON.parse(localStorage.getItem('binaryVirtualFolders') || '[]');
  var collapsedFolders = JSON.parse(localStorage.getItem('binaryCollapsedFolders') || '{}');

  function saveVirtualFolders() {
    localStorage.setItem('binaryVirtualFolders', JSON.stringify(virtualFolders));
  }
  function saveCollapsedFolders() {
    localStorage.setItem('binaryCollapsedFolders', JSON.stringify(collapsedFolders));
  }

  /** Build a tree structure from binary tabs and virtual folders. */
  function buildBinaryTree() {
    var root = { name: '', path: '', children: {}, files: [] };

    function ensureFolder(pathStr) {
      if (!pathStr) return root;
      var parts = pathStr.split('/');
      var node = root;
      var built = '';
      for (var i = 0; i < parts.length; i++) {
        built = built ? built + '/' + parts[i] : parts[i];
        if (!node.children[parts[i]]) {
          node.children[parts[i]] = { name: parts[i], path: built, children: {}, files: [] };
        }
        node = node.children[parts[i]];
      }
      return node;
    }

    // Add virtual folders
    for (var v = 0; v < virtualFolders.length; v++) {
      ensureFolder(virtualFolders[v]);
    }

    // Add binary files
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].isBinary) continue;
      var parts = tabs[i].filename.split('/');
      var fileName = parts.pop();
      var dirPath = parts.join('/');
      var folder = ensureFolder(dirPath);
      folder.files.push({ tab: tabs[i], name: fileName });
    }

    return root;
  }

  /** Sort children: folders first (alpha), then files (FX data first, .bin next, then alpha). */
  function sortedChildren(node) {
    var folderKeys = Object.keys(node.children).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    return folderKeys;
  }

  function sortedFiles(node) {
    var resolvedFxData = getResolvedFxDataFilename();
    var files = node.files.slice();
    files.sort(function (a, b) {
      var aExt = getExtension(a.name).toLowerCase();
      var bExt = getExtension(b.name).toLowerCase();
      var aSelected = (a.tab.filename === resolvedFxData) ? 0 : 1;
      var bSelected = (b.tab.filename === resolvedFxData) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      var aIsBin = aExt === '.bin' ? 0 : 1;
      var bIsBin = bExt === '.bin' ? 0 : 1;
      if (aIsBin !== bIsBin) return aIsBin - bIsBin;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return files;
  }

  /* ── Drag-and-drop state ──────────────────────────────────────────── */
  var binDragData = null; // { type: 'file'|'folder', path: string }

  function renderBinariesList() {
    binariesList.innerHTML = '';
    var binTabs = [];
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].isBinary) binTabs.push(tabs[i]);
    }

    if (binTabs.length === 0 && virtualFolders.length === 0) {
      binariesList.innerHTML = '<div class="binaries-empty">No binary files in project</div>';
      return;
    }

    var tree = buildBinaryTree();
    renderTreeNode(tree, binariesList, 0);
  }

  function renderTreeNode(node, container, depth) {
    var folderKeys = sortedChildren(node);
    var files = sortedFiles(node);
    var resolvedFxData = getResolvedFxDataFilename();

    // Render sub-folders
    for (var f = 0; f < folderKeys.length; f++) {
      (function (key) {
        var child = node.children[key];
        var isCollapsed = !!collapsedFolders[child.path];

        var folderRow = document.createElement('div');
        folderRow.className = 'btree-folder-row';
        folderRow.style.paddingLeft = (12 + depth * 18) + 'px';
        folderRow.setAttribute('data-folder-path', child.path);
        folderRow.setAttribute('draggable', 'true');

        // Drag source
        folderRow.addEventListener('dragstart', function (e) {
          binDragData = { type: 'folder', path: child.path };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', child.path);
          folderRow.classList.add('btree-dragging');
        });
        folderRow.addEventListener('dragend', function () {
          binDragData = null;
          folderRow.classList.remove('btree-dragging');
          clearDropIndicators();
        });

        // Drop target
        folderRow.addEventListener('dragover', function (e) {
          if (!binDragData) return;
          // Prevent dropping a folder into itself or its descendants
          if (binDragData.type === 'folder' && (child.path === binDragData.path || child.path.indexOf(binDragData.path + '/') === 0)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          clearDropIndicators();
          folderRow.classList.add('btree-drop-target');
        });
        folderRow.addEventListener('dragleave', function () {
          folderRow.classList.remove('btree-drop-target');
        });
        folderRow.addEventListener('drop', function (e) {
          e.preventDefault();
          folderRow.classList.remove('btree-drop-target');
          if (!binDragData) return;
          handleTreeDrop(binDragData, child.path);
          binDragData = null;
        });

        var chevron = document.createElement('span');
        chevron.className = 'btree-chevron' + (isCollapsed ? ' btree-chevron--collapsed' : '');
        chevron.textContent = isCollapsed ? '\u25B6' : '\u25BC';
        chevron.addEventListener('click', function (e) {
          e.stopPropagation();
          if (collapsedFolders[child.path]) {
            delete collapsedFolders[child.path];
          } else {
            collapsedFolders[child.path] = true;
          }
          saveCollapsedFolders();
          renderBinariesList();
        });
        folderRow.appendChild(chevron);

        var folderIcon = document.createElement('span');
        folderIcon.className = 'btree-folder-icon';
        folderIcon.textContent = isCollapsed ? '\uD83D\uDCC1' : '\uD83D\uDCC2';
        folderRow.appendChild(folderIcon);

        var folderName = document.createElement('span');
        folderName.className = 'btree-folder-name';
        folderName.textContent = child.name;
        folderRow.appendChild(folderName);

        // Count items in folder
        var itemCount = countTreeItems(child);
        var countSpan = document.createElement('span');
        countSpan.className = 'btree-folder-count';
        countSpan.textContent = '(' + itemCount + ')';
        folderRow.appendChild(countSpan);

        // Folder actions
        var folderActions = document.createElement('div');
        folderActions.className = 'btree-folder-actions';

        var renFolderBtn = document.createElement('button');
        renFolderBtn.className = 'binaries-action-btn';
        renFolderBtn.textContent = 'Rename';
        renFolderBtn.title = 'Rename folder';
        renFolderBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          startInlineRenameFolder(child.path, folderName);
        });
        folderActions.appendChild(renFolderBtn);

        var delFolderBtn = document.createElement('button');
        delFolderBtn.className = 'binaries-action-btn binaries-action-btn--delete';
        delFolderBtn.textContent = 'Delete';
        delFolderBtn.title = 'Delete folder and all contents';
        delFolderBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var fc = countTreeItems(child);
          showConfirmModal('Delete Folder', 'Delete folder <b>' + escapeHtml(child.name) + '</b>' + (fc > 0 ? ' and its ' + fc + ' item(s)' : '') + '? This cannot be undone.', 'Delete').then(function (ok) {
            if (!ok) return;
            deleteFolder(child.path);
          });
        });
        folderActions.appendChild(delFolderBtn);

        folderRow.appendChild(folderActions);

        // Click to toggle
        folderRow.addEventListener('click', function () {
          if (collapsedFolders[child.path]) {
            delete collapsedFolders[child.path];
          } else {
            collapsedFolders[child.path] = true;
          }
          saveCollapsedFolders();
          renderBinariesList();
        });

        container.appendChild(folderRow);

        // Render children if not collapsed
        if (!isCollapsed) {
          var childContainer = document.createElement('div');
          childContainer.className = 'btree-children';
          renderTreeNode(child, childContainer, depth + 1);
          container.appendChild(childContainer);
        }
      })(folderKeys[f]);
    }

    // Render files
    for (var fi = 0; fi < files.length; fi++) {
      (function (fileEntry) {
        var tab = fileEntry.tab;
        var ext = getExtension(tab.filename).toLowerCase();
        var isBinFile = ext === '.bin';
        var isSelectedFxData = (tab.filename === resolvedFxData);

        var row = document.createElement('div');
        row.className = 'btree-file-row' + (isSelectedFxData ? ' btree-file-row--fxdata' : '');
        row.style.paddingLeft = (12 + depth * 18) + 'px';
        row.setAttribute('data-file-path', tab.filename);
        row.setAttribute('draggable', 'true');

        // Drag source
        row.addEventListener('dragstart', function (e) {
          binDragData = { type: 'file', path: tab.filename };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.filename);
          row.classList.add('btree-dragging');
        });
        row.addEventListener('dragend', function () {
          binDragData = null;
          row.classList.remove('btree-dragging');
          clearDropIndicators();
        });

        // Drop target (files accept drops to move into their parent folder)
        row.addEventListener('dragover', function (e) {
          if (!binDragData) return;
          if (binDragData.type === 'file' && binDragData.path === tab.filename) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        });

        // Image preview
        var isImage = IMAGE_EXTENSIONS.indexOf(ext) !== -1;
        var previewDiv = document.createElement('div');
        previewDiv.className = 'binaries-preview btree-preview';
        if (isImage && tab.binaryData) {
          var img = document.createElement('img');
          img.src = binaryDataToUrl(tab);
          img.alt = escapeHtml(fileEntry.name);
          img.title = 'Double-click to open pixel editor';
          previewDiv.appendChild(img);
        } else {
          previewDiv.innerHTML = '<span class="binaries-file-icon">&#128196;</span>';
        }
        row.appendChild(previewDiv);

        // Info
        var infoDiv = document.createElement('div');
        infoDiv.className = 'binaries-info';
        var nameDiv = document.createElement('div');
        nameDiv.className = 'binaries-name btree-file-name';
        if (fxHasSpriteOverride(tab.filename)) {
          nameDiv.classList.add('btree-file-name--sprite-override');
        }
        nameDiv.textContent = fileEntry.name;
        if (tab.imageEdited) {
          var editedDot = document.createElement('span');
          editedDot.className = 'pe-edited-badge';
          editedDot.textContent = 'edited';
          editedDot.style.marginLeft = '6px';
          nameDiv.appendChild(editedDot);
        }
        infoDiv.appendChild(nameDiv);
        var statsDiv = document.createElement('div');
        statsDiv.className = 'binaries-stats';
        var statsText = formatFileSize(tab.binarySize) + ' \u2022 ' + (ext || '(no ext)');
        if (isSelectedFxData) statsText += ' \u2022 FX Dev Data';
        if (fxHasSpriteOverride(tab.filename)) statsText += ' \u2022 sprite override';
        statsDiv.textContent = statsText;
        infoDiv.appendChild(statsDiv);
        row.appendChild(infoDiv);

        // Actions
        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'binaries-actions';

        if (isBinFile) {
          var fxBtn = document.createElement('button');
          fxBtn.className = 'binaries-fxdata-btn' + (isSelectedFxData ? ' binaries-fxdata-btn--active' : '');
          fxBtn.textContent = isSelectedFxData ? 'FX Data \u2713' : 'FX Data';
          fxBtn.title = isSelectedFxData
            ? 'This file will be loaded as FX development data'
            : 'Designate as FX development data';
          fxBtn.addEventListener('click', (function (fname) {
            return function (e) {
              e.stopPropagation();
              selectedFxDataFilename = fname;
              localStorage.setItem('selectedFxDataFile', fname);
              renderBinariesList();
            };
          })(tab.filename));
          actionsDiv.appendChild(fxBtn);
        }

        if (isImage) {
          var peEditBtn = document.createElement('button');
          peEditBtn.className = 'fxdata-view-edit-btn';
          peEditBtn.textContent = 'Edit';
          peEditBtn.title = 'Open pixel editor';
          previewDiv.addEventListener('dblclick', (function (btn) {
            return function (e) {
              e.stopPropagation();
              btn.click();
            };
          })(peEditBtn));
          peEditBtn.addEventListener('click', (function (t) {
            return function (e) {
              e.stopPropagation();
              if (!t.binaryData || !window.__pixelEditor) return;
              // Stash original before first edit
              if (!t.originalBinaryData) {
                t.originalBinaryData = new Uint8Array(t.binaryData);
              }
              // Load image from binary data
              var blobEdit = new Blob([t.binaryData]);
              var urlEdit = URL.createObjectURL(blobEdit);
              var imgEdit = new Image();
              imgEdit.onload = function () {
                URL.revokeObjectURL(urlEdit);
                var c = document.createElement('canvas');
                c.width = imgEdit.width;
                c.height = imgEdit.height;
                var ctx = c.getContext('2d');
                ctx.drawImage(imgEdit, 0, 0);
                var imageData = ctx.getImageData(0, 0, imgEdit.width, imgEdit.height);
                window.__pixelEditor.open(imageData, {
                  filename: t.filename,
                  threshold: fxViewThreshold,
                  onSave: function (editedImageData, meta) {
                    var oc = new OffscreenCanvas(editedImageData.width, editedImageData.height);
                    var ocx = oc.getContext('2d');
                    ocx.putImageData(editedImageData, 0, 0);
                    oc.convertToBlob({ type: 'image/png' }).then(function (blob) {
                      return blob.arrayBuffer();
                    }).then(function (buf) {
                      var bytes = new Uint8Array(buf);
                      t.binaryData = bytes;
                      t.binarySize = bytes.length;
                      t.imageEdited = true;
                      renderBinariesList();
                      saveWorkspaceToLocalStorage();
                      // If this image is currently previewed in FX Data View, refresh it
                      if (fxViewCurrentPreviewPath === t.filename ||
                          fxViewCurrentPreviewPath && fxViewCurrentPreviewPath.replace(/.*\//, '') === t.filename.replace(/.*\//, '')) {
                        fxRenderImagePreview(bytes, fxViewCurrentPreviewPath);
                      }
                    });
                  },
                  onThresholdChange: function (val) {
                    fxViewThreshold = val;
                    if (fxdataThresholdSlider) fxdataThresholdSlider.value = fxViewThreshold;
                    if (fxdataThresholdVal) fxdataThresholdVal.textContent = fxViewThreshold;
                  },
                });
              };
              imgEdit.src = urlEdit;
            };
          })(tab));
          actionsDiv.appendChild(peEditBtn);

          if (tab.imageEdited && tab.originalBinaryData) {
            var peRevertBtn = document.createElement('button');
            peRevertBtn.className = 'fxdata-view-revert-btn';
            peRevertBtn.textContent = 'Revert';
            peRevertBtn.title = 'Revert to original image';
            peRevertBtn.addEventListener('click', (function (t) {
              return function (e) {
                e.stopPropagation();
                showConfirmModal('Revert Image', 'Revert this image to the original? Your edits will be lost and this cannot be undone.', 'Revert').then(function (ok) {
                  if (!ok) return;
                  if (t.originalBinaryData) {
                    t.binaryData = new Uint8Array(t.originalBinaryData);
                    t.binarySize = t.binaryData.length;
                    t.imageEdited = false;
                    t.originalBinaryData = null;
                    renderBinariesList();
                    saveWorkspaceToLocalStorage();
                    // Refresh FX Data View preview if showing this image
                    if (fxViewCurrentPreviewPath === t.filename ||
                        fxViewCurrentPreviewPath && fxViewCurrentPreviewPath.replace(/.*\//, '') === t.filename.replace(/.*\//, '')) {
                      fxRenderImagePreview(t.binaryData, fxViewCurrentPreviewPath);
                    }
                  }
                });
              };
            })(tab));
            actionsDiv.appendChild(peRevertBtn);
          }
        }

        var renameBtn = document.createElement('button');
        renameBtn.className = 'binaries-action-btn';
        renameBtn.textContent = 'Rename';
        renameBtn.title = 'Rename file';
        renameBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          startInlineRenameFile(tab, nameDiv);
        });
        actionsDiv.appendChild(renameBtn);

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'binaries-action-btn binaries-action-btn--delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.title = 'Remove file';
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          showConfirmModal('Delete File', 'Deleting <b>' + escapeHtml(tab.filename) + '</b> will permanently remove this binary file from the project. This cannot be undone.', 'Delete').then(function (ok) {
            if (!ok) return;
            if (tab.filename === selectedFxDataFilename) {
              selectedFxDataFilename = null;
              localStorage.removeItem('selectedFxDataFile');
            }
            closeTab(tab.id);
            renderBinariesList();
          });
        });
        actionsDiv.appendChild(deleteBtn);

        row.appendChild(actionsDiv);
        container.appendChild(row);
      })(files[fi]);
    }

    // Root-level drop zone (drop onto binariesList background → move to root)
    if (depth === 0) {
      container.addEventListener('dragover', function (e) {
        if (!binDragData) return;
        // Only trigger if dropping on the container itself, not a child
        if (e.target === container || e.target === binariesList) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          container.classList.add('btree-drop-root');
        }
      });
      container.addEventListener('dragleave', function (e) {
        if (e.target === container || e.target === binariesList) {
          container.classList.remove('btree-drop-root');
        }
      });
      container.addEventListener('drop', function (e) {
        container.classList.remove('btree-drop-root');
        if (!binDragData) return;
        if (e.target !== container && e.target !== binariesList) return;
        e.preventDefault();
        handleTreeDrop(binDragData, ''); // move to root
        binDragData = null;
      });
    }
  }

  function countTreeItems(node) {
    var count = node.files.length;
    var keys = Object.keys(node.children);
    for (var i = 0; i < keys.length; i++) {
      count += countTreeItems(node.children[keys[i]]);
    }
    return count;
  }

  function clearDropIndicators() {
    var els = binariesList.querySelectorAll('.btree-drop-target');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('btree-drop-target');
    binariesList.classList.remove('btree-drop-root');
  }

  /* ── Tree operations: move, rename, create, delete ─────────────── */

  function handleTreeDrop(dragData, targetFolderPath) {
    if (dragData.type === 'file') {
      moveFileToFolder(dragData.path, targetFolderPath);
    } else if (dragData.type === 'folder') {
      moveFolderToFolder(dragData.path, targetFolderPath);
    }
  }

  function moveFileToFolder(filePath, targetFolder) {
    var tab = findTabByFilename(filePath);
    if (!tab) return;
    var baseName = filePath.split('/').pop();
    var newPath = targetFolder ? targetFolder + '/' + baseName : baseName;
    if (newPath === filePath) return;

    // Check conflict
    if (findTabByFilename(newPath)) {
      alert('A file named "' + newPath + '" already exists.');
      return;
    }

    // Update FX data selection
    if (tab.filename === selectedFxDataFilename) {
      selectedFxDataFilename = newPath;
      localStorage.setItem('selectedFxDataFile', newPath);
    }

    tab.filename = newPath;
    saveWorkspaceToLocalStorage();
    renderBinariesList();
    renderTabBar();
  }

  function moveFolderToFolder(folderPath, targetFolder) {
    var folderName = folderPath.split('/').pop();
    var newFolderPath = targetFolder ? targetFolder + '/' + folderName : folderName;
    if (newFolderPath === folderPath) return;
    // Prevent moving into itself
    if (newFolderPath.indexOf(folderPath + '/') === 0) return;

    var prefix = folderPath + '/';
    var newPrefix = newFolderPath + '/';

    // Rename all files under this folder
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].isBinary) continue;
      if (tabs[i].filename === folderPath || tabs[i].filename.indexOf(prefix) === 0) {
        var oldName = tabs[i].filename;
        var newName = newFolderPath + oldName.substring(folderPath.length);
        if (findTabByFilename(newName) && findTabByFilename(newName).id !== tabs[i].id) {
          alert('Conflict: "' + newName + '" already exists. Move aborted.');
          return;
        }
      }
    }

    // Perform move
    for (var j = 0; j < tabs.length; j++) {
      if (!tabs[j].isBinary) continue;
      if (tabs[j].filename.indexOf(prefix) === 0) {
        var old = tabs[j].filename;
        tabs[j].filename = newPrefix + old.substring(prefix.length);
        if (old === selectedFxDataFilename) {
          selectedFxDataFilename = tabs[j].filename;
          localStorage.setItem('selectedFxDataFile', tabs[j].filename);
        }
      }
    }

    // Update virtual folders
    for (var vf = 0; vf < virtualFolders.length; vf++) {
      if (virtualFolders[vf] === folderPath) {
        virtualFolders[vf] = newFolderPath;
      } else if (virtualFolders[vf].indexOf(prefix) === 0) {
        virtualFolders[vf] = newPrefix + virtualFolders[vf].substring(prefix.length);
      }
    }

    // Update collapsed state
    var newCollapsed = {};
    var cKeys = Object.keys(collapsedFolders);
    for (var ck = 0; ck < cKeys.length; ck++) {
      var k = cKeys[ck];
      if (k === folderPath) {
        newCollapsed[newFolderPath] = true;
      } else if (k.indexOf(prefix) === 0) {
        newCollapsed[newPrefix + k.substring(prefix.length)] = true;
      } else {
        newCollapsed[k] = collapsedFolders[k];
      }
    }
    collapsedFolders = newCollapsed;

    saveVirtualFolders();
    saveCollapsedFolders();
    saveWorkspaceToLocalStorage();
    renderBinariesList();
    renderTabBar();
  }

  function startInlineRenameFile(tab, nameEl) {
    var currentName = tab.filename.split('/').pop();
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'btree-rename-input';
    input.value = currentName;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    // Select name without extension
    var dotIdx = currentName.lastIndexOf('.');
    if (dotIdx > 0) {
      input.setSelectionRange(0, dotIdx);
    } else {
      input.select();
    }

    function finish() {
      var newBaseName = input.value.trim();
      if (input.parentNode) {
        input.remove();
      }
      if (!newBaseName || newBaseName === currentName) {
        nameEl.textContent = currentName;
        return;
      }
      var parts = tab.filename.split('/');
      parts[parts.length - 1] = newBaseName;
      var newPath = parts.join('/');
      if (findTabByFilename(newPath) && findTabByFilename(newPath).id !== tab.id) {
        alert('A file named "' + newPath + '" already exists.');
        nameEl.textContent = currentName;
        return;
      }
      if (tab.filename === selectedFxDataFilename) {
        selectedFxDataFilename = newPath;
        localStorage.setItem('selectedFxDataFile', newPath);
      }
      tab.filename = newPath;
      saveWorkspaceToLocalStorage();
      renderBinariesList();
      renderTabBar();
    }

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { finish(); }
      else if (e.key === 'Escape') { input.remove(); nameEl.textContent = currentName; }
    });
    input.addEventListener('blur', function () { setTimeout(finish, 100); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function startInlineRenameFolder(folderPath, nameEl) {
    var currentName = folderPath.split('/').pop();
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'btree-rename-input';
    input.value = currentName;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    function finish() {
      var newName = input.value.trim();
      if (input.parentNode) {
        input.remove();
      }
      if (!newName || newName === currentName || newName.indexOf('/') !== -1) {
        nameEl.textContent = currentName;
        return;
      }
      var parentParts = folderPath.split('/');
      parentParts.pop();
      var parentPath = parentParts.join('/');
      var newFolderPath = parentPath ? parentPath + '/' + newName : newName;

      // Check if new folder path conflicts
      var prefix = folderPath + '/';
      var newPrefix = newFolderPath + '/';

      // Rename all files
      for (var i = 0; i < tabs.length; i++) {
        if (!tabs[i].isBinary) continue;
        if (tabs[i].filename.indexOf(prefix) === 0) {
          var oldFn = tabs[i].filename;
          var renamedFn = newPrefix + oldFn.substring(prefix.length);
          if (findTabByFilename(renamedFn) && findTabByFilename(renamedFn).id !== tabs[i].id) {
            alert('Conflict: "' + renamedFn + '" already exists. Rename aborted.');
            nameEl.textContent = currentName;
            return;
          }
        }
      }

      for (var j = 0; j < tabs.length; j++) {
        if (!tabs[j].isBinary) continue;
        if (tabs[j].filename.indexOf(prefix) === 0) {
          var old = tabs[j].filename;
          tabs[j].filename = newPrefix + old.substring(prefix.length);
          if (old === selectedFxDataFilename) {
            selectedFxDataFilename = tabs[j].filename;
            localStorage.setItem('selectedFxDataFile', tabs[j].filename);
          }
        }
      }

      // Update virtual folders
      for (var vf = 0; vf < virtualFolders.length; vf++) {
        if (virtualFolders[vf] === folderPath) {
          virtualFolders[vf] = newFolderPath;
        } else if (virtualFolders[vf].indexOf(prefix) === 0) {
          virtualFolders[vf] = newPrefix + virtualFolders[vf].substring(prefix.length);
        }
      }

      // Update collapsed
      var nc = {};
      var ck = Object.keys(collapsedFolders);
      for (var ci = 0; ci < ck.length; ci++) {
        var k = ck[ci];
        if (k === folderPath) nc[newFolderPath] = true;
        else if (k.indexOf(prefix) === 0) nc[newPrefix + k.substring(prefix.length)] = true;
        else nc[k] = collapsedFolders[k];
      }
      collapsedFolders = nc;

      saveVirtualFolders();
      saveCollapsedFolders();
      saveWorkspaceToLocalStorage();
      renderBinariesList();
      renderTabBar();
    }

    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { finish(); }
      else if (e.key === 'Escape') { input.remove(); nameEl.textContent = currentName; }
    });
    input.addEventListener('blur', function () { setTimeout(finish, 100); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function createNewFolder() {
    showPromptModal('New Folder', '', {
      placeholder: 'Folder name',
      okLabel: 'Create',
      validate: function (name) {
        name = name.replace(/^\/+|\/+$/g, '');
        if (!name) return 'Please enter a folder name.';
        if (virtualFolders.indexOf(name) !== -1) {
          return 'Folder "' + name + '" already exists.';
        }
        return null;
      },
    }).then(function (name) {
      if (!name) return;
      name = name.replace(/^\/+|\/+$/g, '');

      // Check if any file already creates this path
      var tree = buildBinaryTree();
      var parts = name.split('/');
      var node = tree;
      var exists = true;
      for (var i = 0; i < parts.length; i++) {
        if (node.children[parts[i]]) {
          node = node.children[parts[i]];
        } else {
          exists = false;
          break;
        }
      }
      if (exists && Object.keys(node.children).length === 0 && node.files.length === 0) {
        // Path exists as implicit folder from files, add to virtual to make it explicit
      }

      virtualFolders.push(name);
      saveVirtualFolders();
      // Ensure parent folders are expanded
      var expandParts = name.split('/');
      var expandPath = '';
      for (var ep = 0; ep < expandParts.length; ep++) {
        expandPath = expandPath ? expandPath + '/' + expandParts[ep] : expandParts[ep];
        delete collapsedFolders[expandPath];
      }
      saveCollapsedFolders();
      renderBinariesList();
    });
  }

  function deleteFolder(folderPath) {
    var prefix = folderPath + '/';

    // Delete all files in this folder
    var toRemove = [];
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].isBinary) continue;
      if (tabs[i].filename.indexOf(prefix) === 0) {
        toRemove.push(tabs[i]);
      }
    }
    for (var r = 0; r < toRemove.length; r++) {
      if (toRemove[r].filename === selectedFxDataFilename) {
        selectedFxDataFilename = null;
        localStorage.removeItem('selectedFxDataFile');
      }
      closeTab(toRemove[r].id);
    }

    // Remove virtual folders under this path
    virtualFolders = virtualFolders.filter(function (vf) {
      return vf !== folderPath && vf.indexOf(prefix) !== 0;
    });

    // Clean collapsed state
    var newCollapsed = {};
    var cKeys = Object.keys(collapsedFolders);
    for (var ck = 0; ck < cKeys.length; ck++) {
      if (cKeys[ck] !== folderPath && cKeys[ck].indexOf(prefix) !== 0) {
        newCollapsed[cKeys[ck]] = collapsedFolders[cKeys[ck]];
      }
    }
    collapsedFolders = newCollapsed;

    saveVirtualFolders();
    saveCollapsedFolders();
    saveWorkspaceToLocalStorage();
    renderBinariesList();
    renderTabBar();
  }

  // Wire up "New Folder" button
  var binNewFolderBtn = document.getElementById('binNewFolderBtn');
  if (binNewFolderBtn) {
    binNewFolderBtn.addEventListener('click', function () {
      createNewFolder();
    });
  }

  // Wire up "New Image" button
  var binNewImageBtn = document.getElementById('binNewImageBtn');
  if (binNewImageBtn) {
    binNewImageBtn.addEventListener('click', function () {
      if (!window.__newImageDialog) return;
      window.__newImageDialog().then(function (result) {
        if (!result) return;
        createBinaryTab(result.filename, result.pngBytes.length, result.pngBytes);
        renderBinariesList();
        saveWorkspaceToLocalStorage();
        setStatus('Created ' + result.filename + ' (' + result.width + '\u00D7' + result.height + ')');
      });
    });
  }

  /* ── Inline rename ─────────────────────────────────────────────────── */
  function startRename(id, tabEl) {
    var tab = findTab(id);
    if (!tab) return;

    var nameSpan = tabEl.querySelector('.tab-name');
    if (!nameSpan) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-name-input';
    input.value = tab.filename;

    nameSpan.style.display = 'none';
    tabEl.insertBefore(input, nameSpan);
    input.focus();
    input.select();

    function finishRename() {
      var newName = input.value.trim();
      if (newName && newName !== tab.filename) {
        var err = renameTab(id, newName);
        if (err) {
          alert(err);
          input.focus();
          return;
        }
      }
      if (input.parentNode) {
        input.remove();
      }
      nameSpan.style.display = '';
      nameSpan.textContent = tab.filename;
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        input.remove();
        nameSpan.style.display = '';
      }
    });

    input.addEventListener('blur', function () {
      setTimeout(finishRename, 100);
    });
  }

  /* ── Add tab dialog ────────────────────────────────────────────────── */
  addTabBtn.addEventListener('click', function () {
    showPromptModal('New File', '', {
      placeholder: 'e.g., player.h, utils.cpp',
      okLabel: 'Create',
      validate: function (name) {
        if (!isValidFilename(name)) {
          return 'Invalid filename. Use only a-z, A-Z, 0-9, _, -, . with extension: ' + VALID_EXTENSIONS.join(', ');
        }
        if (findTabByFilename(name)) {
          return 'A file named "' + name + '" already exists.';
        }
        if (getExtension(name) === '.ino' && countInoFiles() >= 1) {
          return 'Only one .ino file is allowed.';
        }
        return null;
      },
    }).then(function (name) {
      if (!name) return;

      var ext = getExtension(name);

      createTab(name, '', false);

      // Auto-add #include to the .ino file for header files
      if (ext === '.h' || ext === '.hpp') {
        var inoTab = null;
        for (var i = 0; i < tabs.length; i++) {
          if (getExtension(tabs[i].filename) === '.ino') { inoTab = tabs[i]; break; }
        }
        if (inoTab && inoTab.model) {
          var includeLine = '#include "' + name + '"';
          var src = inoTab.model.getValue();
          var lines = src.split('\n');

          // Check if already included
          var alreadyIncluded = false;
          var lastIncludeIdx = -1;
          for (var li = 0; li < lines.length; li++) {
            if (/^\s*#\s*include\b/.test(lines[li])) {
              lastIncludeIdx = li;
              if (lines[li].replace(/\s/g, '') === includeLine.replace(/\s/g, '')) {
                alreadyIncluded = true;
              }
            }
          }

          if (!alreadyIncluded) {
            var insertAt = lastIncludeIdx >= 0 ? lastIncludeIdx + 2 : 1;
            inoTab.model.pushEditOperations([], [{
              range: new monaco.Range(insertAt, 1, insertAt, 1),
              text: includeLine + '\n',
            }], function () { return null; });
            setStatus('Added ' + includeLine + ' to ' + inoTab.filename, 'success');
          }
        }
      }
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  ZIP Export
   * ══════════════════════════════════════════════════════════════════════ */
  exportZipBtn.addEventListener('click', function () {
    closeAllMenus();
    if (tabs.length === 0) {
      setStatus('Nothing to export');
      return;
    }

    // Derive zip filename from the .ino file, falling back to "project"
    var projectName = 'project';
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].isBinary && getExtension(tabs[i].filename) === '.ino') {
        projectName = tabs[i].filename.replace(/\.ino$/, '').replace(/.*\//, '');
        break;
      }
    }

    var zip = new JSZip();
    for (var j = 0; j < tabs.length; j++) {
      var tab = tabs[j];
      if (tab.isBinary) {
        if (tab.binaryData) {
          zip.file(tab.filename, tab.binaryData);
        }
      } else if (tab.model) {
        zip.file(tab.filename, tab.model.getValue());
      }
    }

    zip.generateAsync({ type: 'blob' }).then(function (blob) {
      if (window.showSaveFilePicker) {
        window.showSaveFilePicker({
          suggestedName: projectName + '.zip',
          types: [{
            description: 'ZIP Archive',
            accept: { 'application/zip': ['.zip'] }
          }]
        }).then(function (handle) {
          return handle.createWritable().then(function (writable) {
            return writable.write(blob).then(function () {
              return writable.close();
            });
          });
        }).then(function () {
          setStatus('Exported ' + projectName + '.zip');
        }).catch(function (err) {
          if (err.name !== 'AbortError') {
            setStatus('Export failed: ' + err.message);
          }
        });
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = projectName + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        setStatus('Exported ' + projectName + '.zip');
      }
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  ZIP Import — conflict-aware
   * ══════════════════════════════════════════════════════════════════════ */
  importZipBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    zipFileInput.click();
  });

  /**
   * Show the conflict modal for a single file and return a promise that
   * resolves with { overwrite: bool, applyAll: bool, dontAsk: bool }.
   */
  function showConflictPrompt(filename) {
    return new Promise(function (resolve) {
      conflictMessage.textContent = '"' + filename + '" already exists. Overwrite?';
      conflictApplyAll.checked = false;
      conflictDontAsk.checked = false;
      conflictModal.classList.remove('hidden');

      function cleanup() {
        conflictModal.classList.add('hidden');
        conflictOverwriteBtn.removeEventListener('click', onOverwrite);
        conflictSkipBtn.removeEventListener('click', onSkip);
      }

      function onOverwrite() {
        cleanup();
        resolve({ overwrite: true, applyAll: conflictApplyAll.checked, dontAsk: conflictDontAsk.checked });
      }

      function onSkip() {
        cleanup();
        resolve({ overwrite: false, applyAll: conflictApplyAll.checked, dontAsk: conflictDontAsk.checked });
      }

      conflictOverwriteBtn.addEventListener('click', onOverwrite);
      conflictSkipBtn.addEventListener('click', onSkip);
    });
  }

  /**
   * Compute the display name for a ZIP entry, disambiguating on collision.
   */
  /**
   * Find the common directory prefix shared by all ZIP entries.
   * e.g. ["proj/a.ino","proj/lib/b.h"] → "proj/"
   */
  function findCommonZipPrefix(names) {
    if (names.length === 0) return '';
    var parts0 = names[0].split('/');
    var commonLen = parts0.length - 1; // exclude filename segment
    for (var i = 1; i < names.length; i++) {
      var parts = names[i].split('/');
      var max = Math.min(commonLen, parts.length - 1);
      var j = 0;
      while (j < max && parts0[j] === parts[j]) j++;
      commonLen = j;
    }
    if (commonLen === 0) return '';
    return parts0.slice(0, commonLen).join('/') + '/';
  }

  function resolveZipEntryName(displayName, commonPrefix) {
    var stripped = displayName;
    if (commonPrefix && stripped.indexOf(commonPrefix) === 0) {
      stripped = stripped.substring(commonPrefix.length);
    }
    return stripped || displayName;
  }

  /**
   * Reset the workspace state before importing a full project (.ino present).
   */
  function resetWorkspaceForProjectImport() {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].model) tabs[i].model.dispose();
    }
    tabs.length = 0;
    activeTabId = null;
    nextTabId = 1;

    selectedFxDataFilename = null;
    localStorage.removeItem('selectedFxDataFile');
    localStorage.removeItem('fxViewActiveEntryIndex');
    localStorage.removeItem('fxViewPixelEditorOpen');

    if (binaryFileInfo) binaryFileInfo.classList.remove('visible');
    if (editor) {
      var dn = editor.getDomNode();
      if (dn) dn.style.visibility = 'visible';
    }

    fxViewActiveEntryId = null;
    fxClearPreview();
    renderTabBar();
    renderBinariesList();
  }

  /**
   * Import a single extracted ZIP file entry, handling .ino replacement.
   * Returns the tab id of the created/updated tab (or null for skipped binary).
   */
  function importSingleFile(finalName, data) {
    var baseName = finalName.replace(/.*\//, '') || finalName;
    if (isTextFile(baseName, data)) {
      var decoder = new TextDecoder('utf-8', { fatal: false });
      var text = decoder.decode(data);
      var ext = getExtension(finalName).toLowerCase();

      if (ext === '.ino') {
        var existingIno = null;
        for (var i = 0; i < tabs.length; i++) {
          if (getExtension(tabs[i].filename).toLowerCase() === '.ino') {
            existingIno = tabs[i];
            break;
          }
        }
        if (existingIno) {
          if (existingIno.filename !== finalName) {
            renameTab(existingIno.id, finalName);
          }
          existingIno.baselineContent = text;
          existingIno.model.setValue(text);
          return existingIno.id;
        }
      }

      // Overwrite if tab exists
      var existingTab = findTabByFilename(finalName);
      if (existingTab && !existingTab.isBinary) {
        existingTab.baselineContent = text;
        existingTab.model.setValue(text);
        return existingTab.id;
      } else if (existingTab && existingTab.isBinary) {
        closeTab(existingTab.id);
      }

      return createTab(finalName, text, false).id;
    } else {
      var existingTab = findTabByFilename(finalName);
      if (existingTab && !existingTab.isBinary) closeTab(existingTab.id);
      createBinaryTab(finalName, data.length, data);
      return null;
    }
  }

  /**
   * Core import pipeline: extract all entries, resolve conflicts, import.
   */
  function processZipImport(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      setStatus('Error: JSZip library not loaded');
      return;
    }

    JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var entries = [];
      zip.forEach(function (relativePath, zipEntry) {
        if (!zipEntry.dir) entries.push(zipEntry);
      });

      if (entries.length === 0) {
        setStatus('Error: ZIP file is empty');
        return;
      }

      // First, extract all files in parallel
      var extractPromises = entries.map(function (zipEntry) {
        return zipEntry.async('uint8array').then(function (data) {
          var displayName = zipEntry.name.replace(/\\/g, '/');
          return { displayName: displayName, data: data };
        });
      });

      Promise.all(extractPromises).then(function (extractedFiles) {
        // Strip common root folder so subfolders are preserved
        var allNames = extractedFiles.map(function (f) { return f.displayName; });
        var commonPrefix = findCommonZipPrefix(allNames);

        // Check if any .ino file exists in the ZIP
        var hasIno = false;
        for (var hi = 0; hi < extractedFiles.length; hi++) {
          var resolvedName = resolveZipEntryName(extractedFiles[hi].displayName, commonPrefix);
          if (getExtension(resolvedName).toLowerCase() === '.ino') { hasIno = true; break; }
        }

        function doImport(clearFirst) {
          if (clearFirst) {
            resetWorkspaceForProjectImport();
          }

          // Now process sequentially so conflict prompts work
          var confirmConflicts = confirmChangesCheckbox.checked;
          var batchOverwrite = null;  // null = ask, true = overwrite all, false = skip all
          var dontAskLater = false;
          var firstTextTabId = null;
          var inoTabId = null;
          var importedCount = 0;

          function processNext(index) {
            if (index >= extractedFiles.length) {
              if (dontAskLater) {
                confirmChangesCheckbox.checked = false;
                localStorage.setItem('confirmChanges', 'false');
              }
              var preferredTab = inoTabId !== null ? inoTabId : firstTextTabId;
              if (preferredTab !== null) {
                switchToTab(preferredTab);
              }
              saveWorkspaceToLocalStorage();
              sortTabs();
              setStatus('Imported ' + importedCount + ' file' + (importedCount !== 1 ? 's' : '') + ' from ZIP');
              return;
            }

            var entry = extractedFiles[index];
            var finalName = resolveZipEntryName(entry.displayName, commonPrefix);
            var existing = findTabByFilename(finalName);

            if (existing && confirmConflicts && batchOverwrite === null) {
              showConflictPrompt(finalName).then(function (result) {
                if (result.dontAsk) dontAskLater = true;
                if (result.applyAll) batchOverwrite = result.overwrite;
                if (result.overwrite) {
                  var tabId = importSingleFile(finalName, entry.data);
                  if (tabId !== null && firstTextTabId === null) firstTextTabId = tabId;
                  if (tabId !== null && getExtension(finalName).toLowerCase() === '.ino') inoTabId = tabId;
                  importedCount++;
                }
                processNext(index + 1);
              });
              return;
            }

            if (existing && confirmConflicts && batchOverwrite === false) {
              processNext(index + 1);
              return;
            }

            var tabId = importSingleFile(finalName, entry.data);
            if (tabId !== null && firstTextTabId === null) firstTextTabId = tabId;
            if (tabId !== null && getExtension(finalName).toLowerCase() === '.ino') inoTabId = tabId;
            importedCount++;
            processNext(index + 1);
          }

          processNext(0);
        }

        if (hasIno) {
          // Skip confirmation if workspace is just the unmodified default sketch
          var textTabs = [];
          for (var ti = 0; ti < tabs.length; ti++) {
            if (!tabs[ti].isBinary) textTabs.push(tabs[ti]);
          }
          var isUnmodifiedDefault = textTabs.length === 1
            && textTabs[0].isDefault
            && getExtension(textTabs[0].filename).toLowerCase() === '.ino'
            && textTabs[0].model.getValue() === DEFAULT_SKETCH;

          if (isUnmodifiedDefault) {
            doImport(true);
          } else {
            // Project import — confirm with user first
            showConfirmModal(
              'Import Project',
              '.ino file detected &mdash; do you wish to import this project?<br><br><small>Current files will not be saved.</small>',
              'Ok'
            ).then(function (ok) {
              if (!ok) return;
              doImport(true);
            });
          }
        } else {
          // No .ino — just add files to existing project
          doImport(false);
        }
      });
    }).catch(function (err) {
      setStatus('Error: Failed to read ZIP — ' + err.message);
    });
  }

  /**
   * Import individual (non-ZIP) files with conflict handling.
   */
  function importIndividualFiles(fileList) {
    var readPromises = [];
    for (var i = 0; i < fileList.length; i++) {
      (function (file) {
        readPromises.push(new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function (ev) {
            resolve({ name: file.name, data: new Uint8Array(ev.target.result) });
          };
          reader.readAsArrayBuffer(file);
        }));
      })(fileList[i]);
    }

    Promise.all(readPromises).then(function (entries) {
      var confirmConflicts = confirmChangesCheckbox.checked;
      var batchOverwrite = null;
      var dontAskLater = false;
      var firstTextTabId = null;
      var importedCount = 0;

      function processNext(index) {
        if (index >= entries.length) {
          if (dontAskLater) {
            confirmChangesCheckbox.checked = false;
            localStorage.setItem('confirmChanges', 'false');
          }
          if (firstTextTabId !== null) {
            switchToTab(firstTextTabId);
          }
          saveWorkspaceToLocalStorage();
          sortTabs();
          setStatus('Imported ' + importedCount + ' file' + (importedCount !== 1 ? 's' : ''));
          return;
        }

        var entry = entries[index];
        var existing = findTabByFilename(entry.name);

        if (existing && confirmConflicts && batchOverwrite === null) {
          showConflictPrompt(entry.name).then(function (result) {
            if (result.dontAsk) dontAskLater = true;
            if (result.applyAll) batchOverwrite = result.overwrite;
            if (result.overwrite) {
              var tabId = importSingleFile(entry.name, entry.data);
              if (tabId !== null && firstTextTabId === null) firstTextTabId = tabId;
              importedCount++;
            }
            processNext(index + 1);
          });
          return;
        }

        if (existing && confirmConflicts && batchOverwrite === false) {
          processNext(index + 1);
          return;
        }

        var tabId = importSingleFile(entry.name, entry.data);
        if (tabId !== null && firstTextTabId === null) firstTextTabId = tabId;
        importedCount++;
        processNext(index + 1);
      }

      processNext(0);
    });
  }

  zipFileInput.addEventListener('change', function () {
    closeAllMenus();
    var rawFiles = zipFileInput.files;
    if (!rawFiles || rawFiles.length === 0) return;
    // Snapshot into a plain array before clearing the input,
    // because FileList is live and .value='' empties it.
    var files = [];
    for (var i = 0; i < rawFiles.length; i++) files.push(rawFiles[i]);
    zipFileInput.value = '';

    // Separate zip files from individual files
    var zipFiles = [];
    var individualFiles = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].name.toLowerCase().endsWith('.zip')) {
        zipFiles.push(files[i]);
      } else {
        individualFiles.push(files[i]);
      }
    }

    // Process zip files first, then individual files
    function processZips(idx) {
      if (idx >= zipFiles.length) {
        if (individualFiles.length > 0) {
          importIndividualFiles(individualFiles);
        }
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        processZipImport(e.target.result);
        processZips(idx + 1);
      };
      reader.readAsArrayBuffer(zipFiles[idx]);
    }

    processZips(0);
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Drag-and-drop ZIP import
   * ══════════════════════════════════════════════════════════════════════ */
  var dragCounter = 0;

  compilerRoot.addEventListener('dragenter', function (e) {
    e.preventDefault();
    e.stopPropagation();
    // Only show overlay for external file drags, not internal reorder drags
    if (!e.dataTransfer || !e.dataTransfer.types || e.dataTransfer.types.indexOf('Files') === -1) return;
    dragCounter++;
    if (dragCounter === 1) {
      dropOverlay.classList.remove('hidden');
    }
  });

  compilerRoot.addEventListener('dragleave', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer || !e.dataTransfer.types || e.dataTransfer.types.indexOf('Files') === -1) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.add('hidden');
    }
  });

  compilerRoot.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  compilerRoot.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');

    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;

    var zipFiles = [];
    var individualFiles = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].name.toLowerCase().endsWith('.zip')) {
        zipFiles.push(files[i]);
      } else {
        individualFiles.push(files[i]);
      }
    }

    function processZips(idx) {
      if (idx >= zipFiles.length) {
        if (individualFiles.length > 0) {
          importIndividualFiles(individualFiles);
        }
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        processZipImport(ev.target.result);
        processZips(idx + 1);
      };
      reader.readAsArrayBuffer(zipFiles[idx]);
    }

    processZips(0);
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Build submit
   * ══════════════════════════════════════════════════════════════════════ */
  function onBuild() {
    buildBtn.disabled = true;
    downloadHexBtn.disabled = true;
    if (uploadToDeviceBtn) uploadToDeviceBtn.disabled = true;
    if (pushToPkgBtn) pushToPkgBtn.disabled = true;
    memorySection.classList.add('hidden');
    if (fxMemoryMapSection) fxMemoryMapSection.classList.add('hidden');
    if (fxDataMeterGroup) fxDataMeterGroup.classList.add('hidden');
    logPre.innerHTML = '';
    lastRawLog = '';
    outputErrorCount.classList.add('hidden');
    copyRawOutputBtn.classList.add('hidden');
    setStatus('Submitting...');

    // Start cloud overlay animation during build
    if (window.__sentientCloud && buildAnimCheckbox.checked) {
      window.__sentientCloud.start();
    }

    // Clear previous diagnostic highlights before each new build
    if (typeof monaco !== 'undefined') {
      clearAllDiagnostics();
    }

    if (editor) {
      editor.layout();
      editor.focus();
    }

    var files = {};
    var inoCount = 0;

    tabs.forEach(function (tab) {
      if (tab.isBinary) return;  // skip binary files in build
      files[tab.filename] = tab.model.getValue();
      if (getExtension(tab.filename) === '.ino') inoCount++;
    });

    if (inoCount === 0) {
      setStatus('Error: No .ino file found');
      if (window.__sentientCloud) { window.__sentientCloud.fail(); }
      buildBtn.disabled = false;
      return;
    }
    if (inoCount > 1) {
      setStatus('Error: Only one .ino file is allowed');
      if (window.__sentientCloud) { window.__sentientCloud.fail(); }
      buildBtn.disabled = false;
      return;
    }

    var payload = {
      files: files,
      fqbn: buildFqbn(),
    };

    fetch('/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          setStatus('Error: ' + data.error);
          if (window.__sentientCloud) { window.__sentientCloud.fail(); }
          buildBtn.disabled = false;
          return;
        }
        if (DEV_LOG) console.log('[DEV] Build queued — id:', data.id);
        setStatus('Queued...');
        schedulePoll(data.id);
      })
      .catch(function (err) {
        setStatus('Network error: ' + err.message);
        if (window.__sentientCloud) { window.__sentientCloud.fail(); }
        buildBtn.disabled = false;
      });
  }

  buildBtn.addEventListener('click', onBuild);

  downloadHexBtn.addEventListener('click', function () {
    if (!downloadHexBtn._blobUrl) return;
    var filename = downloadHexBtn._filename;
    if (window.showSaveFilePicker) {
      fetch(downloadHexBtn._blobUrl).then(function (r) { return r.blob(); }).then(function (blob) {
        var ext = filename.indexOf('.') !== -1 ? filename.substring(filename.lastIndexOf('.')) : '';
        var opts = { suggestedName: filename };
        if (ext) {
          opts.types = [{ description: filename, accept: { 'application/octet-stream': [ext] } }];
        }
        return window.showSaveFilePicker(opts).then(function (handle) {
          return handle.createWritable().then(function (writable) {
            return writable.write(blob).then(function () { return writable.close(); });
          });
        });
      }).catch(function (err) {
        if (err.name === 'AbortError') return;
        // Fallback to direct download
        var a = document.createElement('a');
        a.href = downloadHexBtn._blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    } else {
      var a = document.createElement('a');
      a.href = downloadHexBtn._blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });

  // ── Push to Package Editor button ─────────────────────────────────
  if (pushToPkgBtn) {
    pushToPkgBtn.addEventListener('click', function () {
      var data = pushToPkgBtn._buildData;
      if (!data) return;
      document.dispatchEvent(new CustomEvent('compiler-push-to-package', { detail: data }));
    });
  }

  // ── Upload to Device button ───────────────────────────────────────
  if (uploadToDeviceBtn) {
    uploadToDeviceBtn.addEventListener('click', function () {
      var data = uploadToDeviceBtn._buildData;
      if (!data) return;
      document.dispatchEvent(new CustomEvent('compiler-upload-to-device', { detail: data }));
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Polling
   * ══════════════════════════════════════════════════════════════════════ */
  function schedulePoll(id) {
    setTimeout(function () { pollOnce(id); }, POLL_INTERVAL_MS);
  }

  function pollOnce(id) {
    fetch('/poll?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.log) showLog(data.log);

        switch (data.status) {
          case 'done':
            if (window.__sentientCloud) { window.__sentientCloud.succeed(); }
            setStatus('Build succeeded!');
            buildBtn.disabled = false;
            if (autoShowOutputCheckbox.checked) {
              outputPanel.classList.remove('collapsed');
            }
            if (data.log) {
              updateMemoryMeters(data.log);
              applyDiagnostics(parseCompileDiagnostics(data.log));
            }
            offerDownload(id, data.hex);

            // Snapshot all tab contents as new baselines after successful build
            tabs.forEach(function (t) {
              if (!t.isBinary && t.model) {
                t.baselineContent = t.model.getValue();
              }
            });
            renderTabBar();
            saveWorkspaceToLocalStorage();

            // Auto-load simulator on successful build
            if (autoSimCheckbox.checked && data.hex) {
              showSimulatorWithHex(data.hex);
            } else {
              lastHexText = data.hex || null;
              // Still push data to popout even if auto-sim is off
              if (isPopoutActive() && data.hex) {
                showSimulatorWithHex(data.hex);
              }
            }

            // Auto-build FX data if enabled
            if (fxAutoBuildCheckbox && fxAutoBuildCheckbox.checked && findFxdataTab()) {
              fxBuildData().then(function () {
                // If auto-load FX data is also enabled, reload the simulator with fresh FX data
                if (loadDevDataCheckbox.checked) {
                  var fxBin = getSelectedFxDataBinary();
                  if (fxBin && (data.hex || lastHexText)) {
                    var hex = data.hex || lastHexText;
                    if (isPopoutActive()) {
                      postToPopout({ type: 'load-arduboy', hex: hex, fxData: Array.from(fxBin) });
                    } else if (!simulatorPanel.classList.contains('sim-hidden')) {
                      initArdens().then(function () { loadArduboyPackage(hex, fxBin).then(function () { syncSimFromTarget(); }); });
                    }
                  }
                }
              });
            } else if (fxViewLastBuild && fxViewLastBuild.success && getSelectedFxDataBinary()) {
              // Restore FX memory map & meter from previous build if FX data is still loaded
              fxRenderMemoryMap(fxViewLastBuild);
              if (fxDataMeterGroup) fxDataMeterGroup.classList.remove('hidden');
            }
            break;

          case 'error':
            if (window.__sentientCloud) { window.__sentientCloud.fail(); }
            setStatus('Build failed: ' + (data.error || ''));
            buildBtn.disabled = false;
            if (autoShowOutputCheckbox.checked) {
              outputPanel.classList.remove('collapsed');
            }
            if (data.log) {
              applyDiagnostics(parseCompileDiagnostics(data.log));
            }
            // Hide FX memory map on hex build failure
            if (fxMemoryMapSection) fxMemoryMapSection.classList.add('hidden');
            // Hide FX data meter bar on hex build failure
            if (fxDataMeterGroup) fxDataMeterGroup.classList.add('hidden');
            break;

          default:
            setStatus('Building... (' + data.status + ')');
            schedulePoll(id);
        }
      })
      .catch(function (err) {
        setStatus('Poll error: ' + err.message + ' — retrying');
        schedulePoll(id);
      });
  }

  function offerDownload(id, hexText) {
    // Derive project name from .ino file
    var projectName = 'firmware';
    for (var j = 0; j < tabs.length; j++) {
      if (!tabs[j].isBinary && getExtension(tabs[j].filename) === '.ino') {
        projectName = tabs[j].filename.replace(/\.ino$/, '').replace(/.*\//, '');
        break;
      }
    }

    // Find FX data binary: prefer fxdata-data.bin (distribution), fall back to fxdata.bin
    var fxDataTab = null;
    var fxSaveTab = null;
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].isBinary || !tabs[i].binaryData) continue;
      var basename = tabs[i].filename.replace(/.*\//, '').toLowerCase();
      if (!fxDataTab && basename === 'fxdata-data.bin') {
        fxDataTab = tabs[i];
      } else if (!fxSaveTab && basename === 'fxdata-save.bin') {
        fxSaveTab = tabs[i];
      }
    }
    // Fall back to fxdata.bin if no fxdata-data.bin found
    if (!fxDataTab) {
      for (var m = 0; m < tabs.length; m++) {
        if (!tabs[m].isBinary || !tabs[m].binaryData) continue;
        if (tabs[m].filename.replace(/.*\//, '').toLowerCase() === 'fxdata.bin') {
          fxDataTab = tabs[m];
          break;
        }
      }
    }

    var hasFxData = !!(fxDataTab || fxSaveTab);

    if (!hasFxData) {
      // Simple hex download — no FX binaries present
      var blob = new Blob([hexText], { type: 'text/plain' });
      downloadHexBtn._blobUrl  = URL.createObjectURL(blob);
      downloadHexBtn._filename = projectName + '.hex';
      downloadHexBtn.disabled  = false;
      if (uploadToDeviceBtn) {
        uploadToDeviceBtn._buildData = { hexText: hexText, projectName: projectName, device: 'Arduboy', hasFxData: false };
        uploadToDeviceBtn.disabled = false;
      }
      if (pushToPkgBtn) {
        pushToPkgBtn._buildData = { hexText: hexText, projectName: projectName, device: 'Arduboy', hasFxData: false };
        pushToPkgBtn.disabled = false;
      }
    } else {
      // Build a proper .arduboy package (ZIP with info.json)
      var hexFilename = projectName + '.hex';

      // Map compile target to .arduboy device string
      var targetToDevice = {
        'arduboy': 'Arduboy',
        'arduboy-fx': 'ArduboyFX',
        'arduboy-fxc': 'ArduboyMini',
        'arduboy-mini': 'ArduboyMini',
        'arduboy-devkit': 'Arduboy',
        'arduboy-homemade': 'ArduboyFX'
      };
      var device = targetToDevice[targetSelect.value] || 'ArduboyFX';

      // Build binary entry for info.json
      var binaryEntry = {
        title: projectName,
        filename: hexFilename,
        device: device
      };

      // Use actual tab filenames (basename only) for the bin files in the ZIP
      var dataZipName = fxDataTab ? fxDataTab.filename.replace(/.*\//, '') : null;
      var saveZipName = fxSaveTab ? fxSaveTab.filename.replace(/.*\//, '') : null;

      if (dataZipName) binaryEntry.flashdata = dataZipName;
      if (saveZipName) binaryEntry.flashsave = saveZipName;

      var info = {
        schemaVersion: 4,
        title: projectName,
        author: '',
        version: '',
        binaries: [binaryEntry]
      };

      var zip = new JSZip();
      zip.file('info.json', JSON.stringify(info, null, 2));
      zip.file(hexFilename, hexText);
      if (fxDataTab) {
        zip.file(dataZipName, fxDataTab.binaryData);
      }
      if (fxSaveTab) {
        zip.file(saveZipName, fxSaveTab.binaryData);
      }

      zip.generateAsync({ type: 'blob' }).then(function (zipBlob) {
        downloadHexBtn._blobUrl  = URL.createObjectURL(zipBlob);
        downloadHexBtn._filename = projectName + '.arduboy';
        downloadHexBtn.disabled  = false;
        if (uploadToDeviceBtn) {
          uploadToDeviceBtn._buildData = {
            hexText: hexText,
            projectName: projectName,
            device: device,
            hasFxData: true,
            fxData: fxDataTab ? fxDataTab.binaryData : null,
            fxSave: fxSaveTab ? fxSaveTab.binaryData : null
          };
          uploadToDeviceBtn.disabled = false;
        }
        if (pushToPkgBtn) {
          pushToPkgBtn._buildData = {
            hexText: hexText,
            projectName: projectName,
            device: device,
            hasFxData: true,
            fxData: fxDataTab ? fxDataTab.binaryData : null,
            fxSave: fxSaveTab ? fxSaveTab.binaryData : null
          };
          pushToPkgBtn.disabled = false;
        }
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Local Storage — workspace persistence
   * ══════════════════════════════════════════════════════════════════════ */
  var _saveDebounceTimer = null;

  function saveWorkspaceToLocalStorage() {
    // Debounce: don't save more than once every 500ms
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(function () {
      _saveDebounceTimer = null;
      try {
        var workspace = {
          activeFilename: null,
          tabs: [],
        };

        // Save active tab filename
        var activeTab = findTab(activeTabId);
        if (activeTab) workspace.activeFilename = activeTab.filename;
        else if (activeTabId === BINARIES_TAB_ID) workspace.activeFilename = '__binaries__';

        tabs.forEach(function (tab) {
          var entry = {
            filename: tab.filename,
            isDefault: tab.isDefault,
            isBinary: tab.isBinary,
          };
          if (tab.isBinary) {
            entry.binarySize = tab.binarySize;
            if (tab.binaryData) {
              var bin = '';
              for (var bi = 0; bi < tab.binaryData.length; bi++) bin += String.fromCharCode(tab.binaryData[bi]);
              entry.binaryBase64 = btoa(bin);
            }
            if (tab.imageEdited && tab.originalBinaryData) {
              entry.imageEdited = true;
              var origBin = '';
              for (var oi = 0; oi < tab.originalBinaryData.length; oi++) origBin += String.fromCharCode(tab.originalBinaryData[oi]);
              entry.originalBinaryBase64 = btoa(origBin);
            }
          } else {
            entry.content = tab.model.getValue();
            entry.baselineContent = tab.baselineContent;
          }
          workspace.tabs.push(entry);
        });

        localStorage.setItem('workspace', JSON.stringify(workspace));
      } catch (e) {
        console.warn('Failed to save workspace:', e);
      }
    }, 500);
  }

  /**
   * Restore tabs from localStorage. Returns true if workspace was loaded.
   * Must be called AFTER Monaco editor is created.
   */
  function loadWorkspaceFromLocalStorage() {
    try {
      var raw = localStorage.getItem('workspace');
      if (!raw) return false;
      var workspace = JSON.parse(raw);
      if (!workspace.tabs || workspace.tabs.length === 0) return false;

      _loadingWorkspace = true;
      workspace.tabs.forEach(function (entry) {
        if (entry.isBinary) {
          var bData = null;
          if (entry.binaryBase64) {
            var raw = atob(entry.binaryBase64);
            bData = new Uint8Array(raw.length);
            for (var bi = 0; bi < raw.length; bi++) bData[bi] = raw.charCodeAt(bi);
          }
          var bTab = createBinaryTab(entry.filename, entry.binarySize || 0, bData);
          if (entry.imageEdited && entry.originalBinaryBase64) {
            bTab.imageEdited = true;
            var origRaw = atob(entry.originalBinaryBase64);
            bTab.originalBinaryData = new Uint8Array(origRaw.length);
            for (var oi = 0; oi < origRaw.length; oi++) bTab.originalBinaryData[oi] = origRaw.charCodeAt(oi);
          }
        } else {
          var newTab = createTab(entry.filename, entry.content || '', !!entry.isDefault);
          if (entry.baselineContent !== undefined) {
            newTab.baselineContent = entry.baselineContent;
          }
        }
      });
      _loadingWorkspace = false;
      renderTabBar();

      // Switch to the previously active tab
      if (workspace.activeFilename === '__binaries__' && hasBinaryFiles()) {
        switchToTab(BINARIES_TAB_ID);
      } else if (workspace.activeFilename) {
        var target = findTabByFilename(workspace.activeFilename);
        if (target && !target.isBinary) switchToTab(target.id);
      } else if (tabs.length > 0) {
        switchToTab(tabs[0].id);
      }

      return true;
    } catch (e) {
      console.warn('Failed to load workspace:', e);
      return false;
    }
  }

  /* ── Generic confirm modal ─────────────────────────────────────────── */
  function showConfirmModal(title, message, okLabel) {
    return new Promise(function (resolve) {
      confirmModalTitle.textContent = title;
      confirmModalMessage.innerHTML = message;
      confirmModalOk.textContent = okLabel || 'Confirm';
      confirmModal.classList.remove('hidden');

      function cleanup() {
        confirmModal.classList.add('hidden');
        confirmModalOk.removeEventListener('click', onOk);
        confirmModalCancel.removeEventListener('click', onCancel);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      confirmModalOk.addEventListener('click', onOk);
      confirmModalCancel.addEventListener('click', onCancel);
    });
  }

  /* ── Generic prompt modal ──────────────────────────────────────────── */
  function showPromptModal(title, message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      promptModalTitle.textContent = title;
      promptModalMessage.textContent = message || '';
      promptModalMessage.style.display = message ? '' : 'none';
      promptModalInput.value = opts.defaultValue || '';
      promptModalInput.placeholder = opts.placeholder || '';
      promptModalOk.textContent = opts.okLabel || 'OK';
      promptModalError.textContent = '';
      promptModalError.classList.add('hidden');
      promptModal.classList.remove('hidden');
      promptModalInput.focus();

      function setError(msg) {
        promptModalError.textContent = msg;
        promptModalError.classList.remove('hidden');
      }

      function cleanup() {
        promptModal.classList.add('hidden');
        promptModalOk.removeEventListener('click', onOk);
        promptModalCancel.removeEventListener('click', onCancel);
        promptModalInput.removeEventListener('keydown', onKey);
      }

      function submit() {
        var val = promptModalInput.value.trim();
        if (!val) { setError('Please enter a value.'); return; }
        if (opts.validate) {
          var err = opts.validate(val);
          if (err) { setError(err); return; }
        }
        cleanup();
        resolve(val);
      }

      function onOk() { submit(); }
      function onCancel() { cleanup(); resolve(null); }
      function onKey(e) {
        e.stopPropagation();
        if (e.key === 'Enter') submit();
        else if (e.key === 'Escape') onCancel();
        // Clear error on typing
        if (promptModalError.textContent) {
          promptModalError.textContent = '';
          promptModalError.classList.add('hidden');
        }
      }

      promptModalOk.addEventListener('click', onOk);
      promptModalCancel.addEventListener('click', onCancel);
      promptModalInput.addEventListener('keydown', onKey);
    });
  }

  /* ── New project button ────────────────────────────────────────────── */
  newProjectBtn.addEventListener('click', function () {
    closeAllMenus();
    showConfirmModal('New Project', 'This will close all files and start a new blank sketch. Continue?', 'New Project').then(function (ok) {
      if (!ok) return;
      if (syncDirHandle) unsync();

      // Dispose every Monaco model (covers default tab, renamed tabs, and any orphaned models)
      if (typeof monaco !== 'undefined') {
        var allModels = monaco.editor.getModels();
        for (var m = 0; m < allModels.length; m++) {
          allModels[m].dispose();
        }
      }

      tabs.length = 0;
      activeTabId = null;
      nextTabId = 1;

      // Reset UI panels
      binaryFileInfo.classList.remove('visible');
      fxdataRibbon.classList.remove('visible');
      fxdataPlaceholder.classList.remove('visible');
      if (editor) {
        var dn = editor.getDomNode();
        if (dn) dn.style.visibility = 'visible';
      }

      if (typeof monaco !== 'undefined') {
        createTab('Sketch.ino', DEFAULT_SKETCH, true);
      }
      saveWorkspaceToLocalStorage();
      setStatus('New project created');
    });
  });

  /* ── Clear local storage button ───────────────────────────────────── */
  clearStorageBtn.addEventListener('click', function () {
    showConfirmModal('Reset All', 'Clear all saved data and reset to defaults? This cannot be undone.', 'Reset').then(function (ok) {
      if (!ok) return;
      if (syncDirHandle) unsync();
      try { indexedDB.deleteDatabase('ArduboySync'); } catch (e) { /* ignore */ }
      // Only clear compiler-specific keys (preserve Webtools data)
      ['workspace','theme','activeTabFilename','selectedFxDataFile',
       'autoShowBuildOutput','confirmChanges','autoSim','loadDevData',
       'highlightEnabled','syncFolderName','autoSync',
       'fxConfirmOverwrite','fxAutoBuild','fxViewThreshold',
       'binaryVirtualFolders','binaryCollapsedFolders','buildAnim','pixelEditorCodeLens',
       'fxViewActiveEntryIndex','fxViewPixelEditorOpen',
       'fxViewSpriteOverrides','bgGradientCSS'].forEach(function(k) {
        localStorage.removeItem(k);
      });
      location.reload();
    });
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  File System Access — Folder Sync (Chrome-based browsers)
   * ══════════════════════════════════════════════════════════════════════ */
  var isFileSystemAccessSupported = typeof window.showDirectoryPicker === 'function';
  var syncDirHandle = null;
  var syncFolderName = '';
  var syncCheckInProgress = false;

  if (isFileSystemAccessSupported) {
    syncFolderBtn.classList.remove('hidden');
  }

  var SYNC_SKIP_DIRS = ['node_modules', '__pycache__'];

  /** Collect all entries from an async iterator into an array. */
  function collectDirEntries(dirHandle) {
    var entries = [];
    var iter = dirHandle.values();
    function step() {
      return iter.next().then(function (r) {
        if (r.done) return entries;
        entries.push(r.value);
        return step();
      });
    }
    return step();
  }

  /** Recursively read all files from a directory handle. */
  function readDirectoryRecursive(dirHandle, basePath) {
    return collectDirEntries(dirHandle).then(function (entries) {
      var promises = [];
      for (var i = 0; i < entries.length; i++) {
        (function (entry) {
          var p = basePath ? basePath + '/' + entry.name : entry.name;
          if (entry.kind === 'directory') {
            if (entry.name.charAt(0) !== '.' && SYNC_SKIP_DIRS.indexOf(entry.name) === -1) {
              promises.push(readDirectoryRecursive(entry, p));
            }
          } else {
            promises.push(Promise.resolve([{ relativePath: p, fileHandle: entry }]));
          }
        })(entries[i]);
      }
      return Promise.all(promises).then(function (arrays) {
        var flat = [];
        for (var j = 0; j < arrays.length; j++) flat = flat.concat(arrays[j]);
        return flat;
      });
    });
  }

  /** Read file content from a FileSystemFileHandle. */
  function readSyncFile(fileHandle) {
    return fileHandle.getFile().then(function (file) {
      return file.arrayBuffer().then(function (buf) {
        return { data: new Uint8Array(buf), size: file.size };
      });
    });
  }

  /** Read all files from the synced directory. */
  function readAllSyncFiles() {
    if (!syncDirHandle) return Promise.resolve([]);
    return readDirectoryRecursive(syncDirHandle, '').then(function (entries) {
      return Promise.all(entries.map(function (e) {
        return readSyncFile(e.fileHandle).then(function (f) {
          return { relativePath: e.relativePath, data: f.data, size: f.size };
        });
      }));
    });
  }

  /** Count newlines in a Uint8Array. */
  function countLinesInData(data) {
    var n = 1;
    for (var i = 0; i < data.length; i++) { if (data[i] === 10) n++; }
    return n;
  }

  /** Build a lightweight change report comparing disk files with open tabs. */
  function buildChangeReport(diskFiles) {
    var changes = [];
    var diskMap = {};

    for (var i = 0; i < diskFiles.length; i++) {
      var df = diskFiles[i];
      diskMap[df.relativePath] = true;

      var tab = findTabByFilename(df.relativePath);
      if (!tab) {
        var textFile = isTextFile(df.relativePath, df.data);
        changes.push({ filename: df.relativePath, type: 'added', newSize: df.size,
          isText: textFile, newLineCount: textFile ? countLinesInData(df.data) : null });
      } else if (!tab.isBinary && tab.model) {
        var dec = new TextDecoder('utf-8', { fatal: false });
        var diskText = dec.decode(df.data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var tabText = tab.model.getValue().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (diskText !== tabText) {
          changes.push({ filename: df.relativePath, type: 'modified',
            oldSize: new TextEncoder().encode(tabText).length, newSize: df.size, isText: true,
            oldLineCount: tabText.split('\n').length, newLineCount: diskText.split('\n').length });
        }
      } else if (tab.isBinary && df.size !== tab.binarySize) {
        changes.push({ filename: df.relativePath, type: 'modified',
          oldSize: tab.binarySize, newSize: df.size, isText: false });
      }
    }

    for (var j = 0; j < tabs.length; j++) {
      if (!diskMap[tabs[j].filename]) {
        var t = tabs[j];
        changes.push({ filename: t.filename, type: 'removed',
          oldSize: t.isBinary ? t.binarySize : new TextEncoder().encode(t.model.getValue()).length,
          isText: !t.isBinary });
      }
    }

    return changes;
  }

  /** Show the sync changes modal. Returns a Promise<boolean>. */
  function showSyncChangesModal(changes) {
    return new Promise(function (resolve) {
      var html = '';
      for (var i = 0; i < changes.length; i++) {
        var c = changes[i];
        var icon = c.type === 'added' ? '&#128196;' : c.type === 'removed' ? '&#128465;' : '&#128221;';
        var detail = '';
        if (c.type === 'modified') {
          detail = formatFileSize(c.oldSize) + ' &rarr; ' + formatFileSize(c.newSize);
          if (c.isText && c.oldLineCount != null) {
            var ld = c.newLineCount - c.oldLineCount;
            detail += ' &middot; ' + c.oldLineCount + ' &rarr; ' + c.newLineCount + ' lines (' + (ld > 0 ? '+' : '') + ld + ')';
          }
        } else if (c.type === 'added') {
          detail = formatFileSize(c.newSize);
          if (c.isText && c.newLineCount != null) detail += ' &middot; ' + c.newLineCount + ' lines';
        } else {
          detail = 'was ' + formatFileSize(c.oldSize);
        }
        html += '<div class="sync-change-item">' +
          '<span class="sync-change-icon">' + icon + '</span>' +
          '<span class="sync-change-name">' + escapeHtml(c.filename) + '</span>' +
          '<span class="sync-change-badge sync-change--' + c.type + '">' +
            c.type.charAt(0).toUpperCase() + c.type.slice(1) + '</span>' +
          '<span class="sync-change-detail">' + detail + '</span></div>';
      }
      syncChangesList.innerHTML = html;
      syncModalTitle.textContent = changes.length + ' file' + (changes.length !== 1 ? 's' : '') + ' changed';
      syncAlwaysAsk.checked = confirmChangesCheckbox.checked;
      syncModal.classList.remove('hidden');

      function cleanup() {
        syncModal.classList.add('hidden');
        syncApplyBtn.removeEventListener('click', onApply);
        syncDismissBtn.removeEventListener('click', onDismiss);
      }
      function onApply() {
        var keepAsking = syncAlwaysAsk.checked;
        cleanup();
        if (!keepAsking) {
          confirmChangesCheckbox.checked = false;
          localStorage.setItem('confirmChanges', 'false');
        } else {
          confirmChangesCheckbox.checked = true;
          localStorage.setItem('confirmChanges', 'true');
        }
        resolve(true);
      }
      function onDismiss() { cleanup(); resolve(false); }
      syncApplyBtn.addEventListener('click', onApply);
      syncDismissBtn.addEventListener('click', onDismiss);
    });
  }

  /** Apply only the changed files from disk to the workspace. */
  function applySyncChanges(diskFiles, changes) {
    if (typeof monaco === 'undefined') return;
    var changed = {};
    for (var i = 0; i < changes.length; i++) changed[changes[i].filename] = changes[i];
    for (var j = 0; j < diskFiles.length; j++) {
      if (changed[diskFiles[j].relativePath]) {
        importSingleFile(diskFiles[j].relativePath, diskFiles[j].data);
      }
    }
    for (var k = 0; k < changes.length; k++) {
      if (changes[k].type === 'removed') {
        var tab = findTabByFilename(changes[k].filename);
        if (tab && !tab.isDefault) closeTab(tab.id);
      }
    }
    saveWorkspaceToLocalStorage();
    sortTabs();
  }

  /** Initial full import from a synced folder. */
  function doInitialSync(diskFiles) {
    if (typeof monaco === 'undefined') { setStatus('Error: Editor not ready yet'); return; }
    var diskMap = {};
    for (var i = 0; i < diskFiles.length; i++) diskMap[diskFiles[i].relativePath] = true;
    var toRemove = [];
    for (var j = 0; j < tabs.length; j++) {
      if (!diskMap[tabs[j].filename] && !tabs[j].isDefault) toRemove.push(tabs[j].id);
    }
    for (var k = 0; k < toRemove.length; k++) closeTab(toRemove[k]);

    var firstIno = null;
    for (var m = 0; m < diskFiles.length; m++) {
      var tid = importSingleFile(diskFiles[m].relativePath, diskFiles[m].data);
      if (tid !== null && firstIno === null && getExtension(diskFiles[m].relativePath) === '.ino') firstIno = tid;
    }
    if (firstIno !== null) switchToTab(firstIno);
    saveWorkspaceToLocalStorage();
    sortTabs();
  }

  /** Check for changes and prompt or auto-apply. */
  function performSyncCheck(manual) {
    if (!syncDirHandle || syncCheckInProgress) return;
    if (!syncModal.classList.contains('hidden')) return;
    syncCheckInProgress = true;

    readAllSyncFiles().then(function (diskFiles) {
      var changes = buildChangeReport(diskFiles);
      syncCheckInProgress = false;

      if (changes.length === 0) {
        if (manual) setStatus('No changes detected');
        return;
      }

      if (!confirmChangesCheckbox.checked) {
        applySyncChanges(diskFiles, changes);
        setStatus('Auto-synced ' + changes.length + ' file' + (changes.length !== 1 ? 's' : ''));
      } else {
        showSyncChangesModal(changes).then(function (apply) {
          if (apply) {
            applySyncChanges(diskFiles, changes);
            setStatus('Synced ' + changes.length + ' file' + (changes.length !== 1 ? 's' : ''));
          }
        });
      }
    }).catch(function (err) {
      syncCheckInProgress = false;
      if (manual) setStatus('Sync check failed: ' + err.message);
    });
  }

  /** Update sync-related UI to reflect connected/disconnected state. */
  function updateSyncUI(synced) {
    if (synced) {
      syncFolderBtn.innerHTML = '&#128279; ' + escapeHtml(syncFolderName);
      syncFolderBtn.classList.add('sync-btn--active');
      syncFolderBtn.title = 'Disconnect from ' + syncFolderName;
      checkUpdatesBtn.classList.remove('hidden');
      var rows = document.querySelectorAll('.hmenu-sync-row');
      for (var i = 0; i < rows.length; i++) rows[i].classList.remove('hidden');
    } else {
      syncFolderBtn.innerHTML = '&#128193; Sync';
      syncFolderBtn.classList.remove('sync-btn--active');
      syncFolderBtn.title = 'Sync with local folder';
      checkUpdatesBtn.classList.add('hidden');
      var rows = document.querySelectorAll('.hmenu-sync-row');
      for (var i = 0; i < rows.length; i++) rows[i].classList.add('hidden');
    }
  }

  /** Start focus-based sync monitoring. */
  function startSyncMonitoring() {
    stopSyncMonitoring();
    document.addEventListener('visibilitychange', onSyncVisibility);
    window.addEventListener('focus', onSyncWindowFocus);
  }

  function stopSyncMonitoring() {
    document.removeEventListener('visibilitychange', onSyncVisibility);
    window.removeEventListener('focus', onSyncWindowFocus);
  }

  var _syncFocusTimer = null;
  function onSyncVisibility() {
    if (document.visibilityState === 'visible' && syncDirHandle && autoSyncCheckbox.checked) {
      clearTimeout(_syncFocusTimer);
      _syncFocusTimer = setTimeout(function () { performSyncCheck(false); }, 50);
    }
  }
  function onSyncWindowFocus() {
    if (!syncDirHandle || !autoSyncCheckbox.checked) return;
    clearTimeout(_syncFocusTimer);
    _syncFocusTimer = setTimeout(function () { performSyncCheck(false); }, 50);
  }

  /** Disconnect from synced folder. */
  function unsync() {
    syncDirHandle = null;
    syncFolderName = '';
    stopSyncMonitoring();
    updateSyncUI(false);
    removeSyncHandleFromIDB();
    localStorage.removeItem('syncFolderName');
  }

  /* ── IndexedDB persistence for directory handle ────────────────────── */
  function saveSyncHandleToIDB(handle) {
    try {
      var r = indexedDB.open('ArduboySync', 1);
      r.onupgradeneeded = function (e) { e.target.result.createObjectStore('handles'); };
      r.onsuccess = function (e) {
        e.target.result.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'syncDir');
      };
    } catch (e) { /* ignore */ }
  }

  function removeSyncHandleFromIDB() {
    try {
      var r = indexedDB.open('ArduboySync', 1);
      r.onupgradeneeded = function (e) { e.target.result.createObjectStore('handles'); };
      r.onsuccess = function (e) {
        e.target.result.transaction('handles', 'readwrite').objectStore('handles').delete('syncDir');
      };
    } catch (e) { /* ignore */ }
  }

  function loadSyncHandleFromIDB(cb) {
    try {
      var r = indexedDB.open('ArduboySync', 1);
      r.onupgradeneeded = function (e) { e.target.result.createObjectStore('handles'); };
      r.onsuccess = function (e) {
        var g = e.target.result.transaction('handles', 'readonly').objectStore('handles').get('syncDir');
        g.onsuccess = function () { cb(g.result || null); };
        g.onerror = function () { cb(null); };
      };
      r.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }

  /* ── Sync button: pick folder or disconnect ────────────────────────── */
  syncFolderBtn.addEventListener('click', function () {
    closeAllMenus();
    if (syncDirHandle) {
      if (!confirm('Disconnect from synced folder "' + syncFolderName + '"?')) return;
      unsync();
      setStatus('Disconnected from folder sync');
      return;
    }

    window.showDirectoryPicker({ mode: 'read' }).then(function (handle) {
      syncDirHandle = handle;
      syncFolderName = handle.name;
      localStorage.setItem('syncFolderName', syncFolderName);
      saveSyncHandleToIDB(handle);
      updateSyncUI(true);
      setStatus('Reading folder: ' + syncFolderName + '\u2026');

      readAllSyncFiles().then(function (diskFiles) {
        if (diskFiles.length === 0) {
          setStatus('Folder is empty \u2014 no files to sync');
          return;
        }
        doInitialSync(diskFiles);
        setStatus('Synced ' + diskFiles.length + ' file' + (diskFiles.length !== 1 ? 's' : '') + ' from ' + syncFolderName);
        startSyncMonitoring();
      }).catch(function (err) {
        setStatus('Error reading folder: ' + err.message);
        unsync();
      });
    }).catch(function (err) {
      if (err.name !== 'AbortError') setStatus('Error: ' + err.message);
    });
  });

  /* ── Check for Updates button ──────────────────────────────────────── */
  checkUpdatesBtn.addEventListener('click', function () {
    closeAllMenus();
    if (!syncDirHandle) return;
    setStatus('Checking for changes\u2026');
    syncCheckInProgress = false;
    performSyncCheck(true);
  });

  /* ── Sync settings persistence ──────────────────────────────────────── */
  autoSyncCheckbox.addEventListener('change', function () {
    localStorage.setItem('autoSync', autoSyncCheckbox.checked);
  });
  (function () {
    var s = localStorage.getItem('autoSync');
    if (s !== null) autoSyncCheckbox.checked = (s === 'true');
  })();

  /* ══════════════════════════════════════════════════════════════════════
   *  Monaco initialization
   * ══════════════════════════════════════════════════════════════════════ */
  require.config({ paths: { vs: MONACO_CDN } });

  window.MonacoEnvironment = {
    getWorkerUrl: function () {
      // baseUrl must point to the directory *containing* the "vs" folder so that
      // Monaco's AMD loader resolves "vs/base/..." without doubling the "vs" segment.
      var monacoBase = MONACO_CDN.replace(/\/vs$/, '/');
      return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
        'self.MonacoEnvironment = { baseUrl: "' + monacoBase + '" };' +
        'importScripts("' + MONACO_CDN + '/base/worker/workerMain.js");'
      );
    }
  };

  require(['vs/editor/editor.main'], function () {
    /* ── Define custom themes ────────────────────────────────────────── */
    monaco.editor.defineTheme('arduboy-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment',    foreground: '666699' },
        { token: 'keyword',    foreground: '58d6ff' },
        { token: 'string',     foreground: '88ffaa' },
        { token: 'number',     foreground: 'ffd166' },
        { token: 'type',       foreground: 'cc99ff' },
        { token: 'delimiter',  foreground: 'd0d0e8' },
        { token: 'identifier', foreground: 'd0d0e8' },
      ],
      colors: {
        'editor.background':                   '#0f0f1a',
        'editor.foreground':                   '#d0d0e8',
        'editor.lineHighlightBackground':      '#1a1a2e',
        'editor.selectionBackground':          '#2a2a5a',
        'editorCursor.foreground':             '#58d6ff',
        'editorLineNumber.foreground':         '#4a4a6a',
        'editorLineNumber.activeForeground':   '#58d6ff',
        'editor.selectionHighlightBackground': '#2a2a4a',
        'editorWidget.background':             '#1a1a2e',
        'editorWidget.border':                 '#2a2a4a',
        'editorSuggestWidget.background':      '#1a1a2e',
        'editorSuggestWidget.border':          '#2a2a4a',
        'editorSuggestWidget.selectedBackground': '#2a2a5a',
        'editorHoverWidget.background':        '#1a1a2e',
        'editorHoverWidget.border':            '#2a2a4a',
        'input.background':                    '#0a0a14',
        'input.border':                        '#2a2a4a',
        'input.foreground':                    '#d0d0e8',
        'list.hoverBackground':                '#1a1a3e',
        'list.activeSelectionBackground':      '#2a2a5a',
        'editorGutter.background':             '#0f0f1a',
        'scrollbar.shadow':                    '#000000',
        'scrollbarSlider.background':          '#2a2a4a80',
        'scrollbarSlider.hoverBackground':     '#3a3a5a',
        'scrollbarSlider.activeBackground':    '#58d6ff40',
      }
    });

    monaco.editor.defineTheme('arduboy-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment',    foreground: '808080' },
        { token: 'keyword',    foreground: '1a6baa' },
        { token: 'string',     foreground: '2a8850' },
        { token: 'number',     foreground: 'b38600' },
        { token: 'type',       foreground: '7a3eaa' },
      ],
      colors: {
        'editor.background':              '#f5f5f5',
        'editor.foreground':              '#1a1a2e',
        'editor.lineHighlightBackground': '#e8e8f0',
        'editor.selectionBackground':     '#c0d0e8',
        'editorCursor.foreground':        '#1a6baa',
        'editorWidget.background':        '#e0e0e8',
        'editorWidget.border':            '#c0c0d0',
      }
    });

    /* ── Create editor ───────────────────────────────────────────────── */
    editor = monaco.editor.create(editorContainer, {
      model: null,
      language: 'cpp',
      theme: currentTheme,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      glyphMargin: true,
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      tabSize: 2,
      insertSpaces: true,
      folding: true,
      bracketPairColorization: { enabled: true },
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      parameterHints: { enabled: true },
      matchBrackets: 'always',
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoIndent: 'full',
      formatOnPaste: false,
      formatOnType: false,
    });

    /* ── Remove loading indicator ────────────────────────────────────── */
    if (editorLoading) {
      editorLoading.remove();
    }

    /* ── Register autocomplete ───────────────────────────────────────── */
    if (window.ArduboyCompletions) {
      window.ArduboyCompletions.register(monaco);
    }

    /* ── Register bitmap detector CodeLens ────────────────────────────── */
    if (window.BitmapDetector) {
      BitmapDetector.registerCommands(editor);
      monaco.languages.registerCodeLensProvider('cpp', {
        provideCodeLenses: function (model) {
          // Run detection (populates cache for inline icons) but don't show CodeLens lines
          BitmapDetector.provideCodeLenses(model);
          return { lenses: [], dispose: function () {} };
        },
        resolveCodeLens: function (model, lens) { return lens; }
      });

      BitmapDetector._onEditBitmap = function (args) {
        var arrayInfo = args.arrayInfo;
        var detection = args.detection;
        var sourceTabId = args._sourceTabId;
        var imageOnly = !!args._imageOnly;
        var maskOnly = !!args._maskOnly;

        // Find the source model — may be in a different tab than the current one
        var sourceModel = null;
        if (sourceTabId) {
          var sourceTab = findTab(sourceTabId);
          if (sourceTab && sourceTab.model) {
            sourceModel = sourceTab.model;
          }
        }
        if (!sourceModel) {
          sourceModel = editor.getModel();
        }

        // Find the external mask array if referenced
        if (detection.maskArrayName && !detection.maskArrayInfo) {
          if (sourceModel) {
            var allArrays = BitmapDetector.Parser.parseArrays(sourceModel.getValue());
            for (var mi = 0; mi < allArrays.length; mi++) {
              if (allArrays[mi].name === detection.maskArrayName) {
                detection.maskArrayInfo = allArrays[mi];
                break;
              }
            }
          }
        }

        var fmt = detection.format;
        var imgData;

        if (imageOnly || maskOnly) {
          // Split mode: decode image or mask channel independently as a 1-bit B&W bitmap
          imgData = _decodeSplitChannel(arrayInfo, detection, maskOnly);
        } else {
          imgData = BitmapDetector.Codec.decode(arrayInfo, detection);
        }
        if (!imgData) return;

        var supportsTransparency = (!imageOnly && !maskOnly) &&
          (fmt === BitmapDetector.FORMAT.SPRITES_EXT_MASK || fmt === BitmapDetector.FORMAT.SPRITES_PLUS_MASK);

        var editorTitle = maskOnly ? (detection.maskArrayName || arrayInfo.name) : arrayInfo.name;

        window.__pixelEditor.open(imgData, {
          filename: editorTitle,
          threshold: 128,
          hideResize: true,
          supportsTransparency: supportsTransparency,
          onSave: function (editedImageData, meta) {
            if (imageOnly || maskOnly) {
              _saveSplitChannel(editedImageData, args, maskOnly, sourceTabId);
            } else {
              _saveNormalBitmap(editedImageData, arrayInfo, detection, sourceTabId);
            }
            renderTabBar();
          }
        });
      };

      // Decode a single channel (image or mask) from a masked bitmap as a standalone 1-bit image
      function _decodeSplitChannel(arrayInfo, detection, isMask) {
        var format = detection.format;
        var w = detection.width;
        var h = detection.height;
        var frameCount = detection.frameCount || 1;
        var paddedH = Math.ceil(h / 8) * 8;
        var bytes = arrayInfo.bytes;

        if (format === BitmapDetector.FORMAT.SPRITES_EXT_MASK) {
          if (isMask) {
            // Mask array is a standalone byte array (no header)
            var maskAI = detection.maskArrayInfo;
            if (!maskAI) return null;
            var maskBytes = maskAI.bytes;
            var bytesPerFrame = w * (paddedH / 8);
            var totalW = w * frameCount;
            var imgData = new ImageData(totalW, paddedH);
            for (var f = 0; f < frameCount; f++) {
              var fb = maskBytes.slice(f * bytesPerFrame, (f + 1) * bytesPerFrame);
              var fi = BitmapDetector.Codec.unpackVertical(fb, w, paddedH);
              BitmapDetector.Codec._blitFrame(imgData, fi, f * w, 0);
            }
            return imgData;
          } else {
            // Image array with [w,h] header, decode without mask
            var imgBytes = bytes.slice(2);
            var bytesPerFrame2 = w * (paddedH / 8);
            var totalW2 = w * frameCount;
            var imgData2 = new ImageData(totalW2, paddedH);
            for (var f2 = 0; f2 < frameCount; f2++) {
              var fb2 = imgBytes.slice(f2 * bytesPerFrame2, (f2 + 1) * bytesPerFrame2);
              var fi2 = BitmapDetector.Codec.unpackVertical(fb2, w, paddedH);
              BitmapDetector.Codec._blitFrame(imgData2, fi2, f2 * w, 0);
            }
            return imgData2;
          }
        } else if (format === BitmapDetector.FORMAT.SPRITES_PLUS_MASK) {
          // Interleaved: deinterleave then decode the chosen channel
          var interleavedBytes = bytes.slice(2);
          var bytesPerFrame3 = w * (paddedH / 8);
          var totalW3 = w * frameCount;
          var imgData3 = new ImageData(totalW3, paddedH);
          for (var f3 = 0; f3 < frameCount; f3++) {
            var chunk = interleavedBytes.slice(f3 * bytesPerFrame3 * 2, (f3 + 1) * bytesPerFrame3 * 2);
            var separated = BitmapDetector.Codec.deinterleavePlusMask(chunk);
            var channelBytes = isMask ? separated.maskBytes : separated.imageBytes;
            var fi3 = BitmapDetector.Codec.unpackVertical(channelBytes, w, paddedH);
            BitmapDetector.Codec._blitFrame(imgData3, fi3, f3 * w, 0);
          }
          return imgData3;
        }
        return null;
      }

      // Save a single channel (image or mask) back to the source code
      function _saveSplitChannel(editedImageData, args, isMask, sourceTabId) {
        var arrayInfo = args.arrayInfo;
        var detection = args.detection;
        var format = detection.format;
        var w = detection.width;
        var h = detection.height;
        var frameCount = detection.frameCount || 1;
        var paddedH = Math.ceil(h / 8) * 8;

        // Encode the edited image back to bytes (image channel only, mask comes back as all-opaque)
        var encoded = BitmapDetector.Codec.encode(editedImageData, arrayInfo, detection);
        // For a B&W-only edit, imageBytes is what matters
        var channelBytes = encoded.imageBytes;

        if (sourceTabId && sourceTabId !== activeTabId) {
          switchToTab(sourceTabId);
        }
        var model = editor.getModel();

        if (format === BitmapDetector.FORMAT.SPRITES_EXT_MASK) {
          if (isMask) {
            // Replace only the mask array bytes
            var maskInfo = detection.maskArrayInfo;
            if (!maskInfo) return;
            var maskStyle = {
              hexStyle: maskInfo.hexStyle,
              valuesPerLine: maskInfo.valuesPerLine,
              indent: maskInfo.indent,
              qualifiers: maskInfo.qualifiers,
            };
            var maskLines = [];
            maskLines.push(maskStyle.qualifiers + ' {');
            maskLines.push.apply(maskLines, BitmapDetector.Codec._formatHexLines(channelBytes, maskStyle));
            maskLines.push('};');
            var maskCode = maskLines.join('\n');
            var mEndText = model.getLineContent(maskInfo.endLine);
            editor.executeEdits('bitmap-editor', [{
              range: new monaco.Range(maskInfo.startLine, 1, maskInfo.endLine, mEndText.length + 1),
              text: maskCode
            }]);
          } else {
            // Replace only the image array bytes (with header)
            var style = {
              hexStyle: arrayInfo.hexStyle,
              valuesPerLine: arrayInfo.valuesPerLine,
              indent: arrayInfo.indent,
              qualifiers: arrayInfo.qualifiers,
            };
            var imgLines = [];
            imgLines.push('// ' + w + 'x' + paddedH + ', ' + frameCount + ' frame(s)');
            imgLines.push('// Image: ' + (channelBytes.length + 2) + ' bytes');
            imgLines.push(style.qualifiers + ' {');
            imgLines.push(style.indent + w + ', ' + paddedH + ',');
            imgLines.push.apply(imgLines, BitmapDetector.Codec._formatHexLines(channelBytes, style));
            imgLines.push('};');
            var imgCode = imgLines.join('\n');
            var iEndText = model.getLineContent(arrayInfo.endLine);
            editor.executeEdits('bitmap-editor', [{
              range: new monaco.Range(arrayInfo.startLine, 1, arrayInfo.endLine, iEndText.length + 1),
              text: imgCode
            }]);
          }
        } else if (format === BitmapDetector.FORMAT.SPRITES_PLUS_MASK) {
          // Re-read the original interleaved data, replace only the edited channel, re-interleave
          var bytes = arrayInfo.bytes;
          var interleavedBytes = bytes.slice(2);
          var bytesPerFrame = w * (paddedH / 8);
          var newInterleaved = [];
          for (var f = 0; f < frameCount; f++) {
            var chunk = interleavedBytes.slice(f * bytesPerFrame * 2, (f + 1) * bytesPerFrame * 2);
            var separated = BitmapDetector.Codec.deinterleavePlusMask(chunk);
            var editedFrame = channelBytes.slice(f * bytesPerFrame, (f + 1) * bytesPerFrame);
            var newImg, newMask;
            if (isMask) {
              newImg = separated.imageBytes;
              newMask = editedFrame;
            } else {
              newImg = editedFrame;
              newMask = separated.maskBytes;
            }
            var reinterleaved = BitmapDetector.Codec.interleavePlusMask(newImg, newMask);
            newInterleaved = newInterleaved.concat(reinterleaved);
          }
          // Reconstruct the full array output
          var style2 = {
            hexStyle: arrayInfo.hexStyle,
            valuesPerLine: arrayInfo.valuesPerLine,
            indent: arrayInfo.indent,
            qualifiers: arrayInfo.qualifiers,
          };
          var name = arrayInfo.name;
          var pmLines = [];
          pmLines.push('// ' + w + 'x' + paddedH + ', ' + frameCount + ' frame(s), ' + (newInterleaved.length + 2) + ' bytes');
          pmLines.push('// Example: Sprites::drawPlusMask(x, y, ' + name + ', frame);');
          pmLines.push(style2.qualifiers + ' {');
          pmLines.push(style2.indent + w + ', ' + paddedH + ',');
          pmLines.push.apply(pmLines, BitmapDetector.Codec._formatHexLines(newInterleaved, style2));
          pmLines.push('};');
          var pmCode = pmLines.join('\n');
          var pmEndText = model.getLineContent(arrayInfo.endLine);
          editor.executeEdits('bitmap-editor', [{
            range: new monaco.Range(arrayInfo.startLine, 1, arrayInfo.endLine, pmEndText.length + 1),
            text: pmCode
          }]);
        }
      }

      // Normal (combined) save for non-split mode
      function _saveNormalBitmap(editedImageData, arrayInfo, detection, sourceTabId) {
        var encoded = BitmapDetector.Codec.encode(editedImageData, arrayInfo, detection);
        var newCode = BitmapDetector.Codec.generateReplacementCode(
          arrayInfo, detection, encoded.imageBytes, encoded.maskBytes
        );

        if (sourceTabId && sourceTabId !== activeTabId) {
          switchToTab(sourceTabId);
        }

        var startLine = arrayInfo.startLine;
        var endLine = arrayInfo.endLine;
        var model = editor.getModel();

        if (detection.format === BitmapDetector.FORMAT.SPRITES_EXT_MASK && detection.maskArrayInfo) {
          var codeParts = newCode.split('\n\n');
          var imageCode = codeParts[0];
          var maskCode = codeParts.length > 1 ? codeParts.slice(1).join('\n\n') : '';

          var maskInfo = detection.maskArrayInfo;
          var maskStartLine = maskInfo.startLine;
          var maskEndLine = maskInfo.endLine;

          var edits = [];
          if (maskCode && maskStartLine > endLine) {
            var maskEndText = model.getLineContent(maskEndLine);
            edits.push({
              range: new monaco.Range(maskStartLine, 1, maskEndLine, maskEndText.length + 1),
              text: maskCode
            });
            var imgEndText = model.getLineContent(endLine);
            edits.push({
              range: new monaco.Range(startLine, 1, endLine, imgEndText.length + 1),
              text: imageCode
            });
          } else {
            var fEndLine = Math.max(endLine, maskEndLine);
            var fEndText = model.getLineContent(fEndLine);
            edits.push({
              range: new monaco.Range(startLine, 1, fEndLine, fEndText.length + 1),
              text: newCode
            });
          }

          editor.executeEdits('bitmap-editor', edits);
        } else {
          var endLineText = model.getLineContent(endLine);
          editor.executeEdits('bitmap-editor', [{
            range: new monaco.Range(startLine, 1, endLine, endLineText.length + 1),
            text: newCode
          }]);
        }
      }

      /* ── Bitmap decoration styles ────────────────────────────────────── */
      var bitmapStyleEl = document.createElement('style');
      bitmapStyleEl.textContent = [
        /* Purple background on CodeLens content widget only — [widgetid] excludes the line overlay div */
        '.monaco-editor .codelens-decoration[widgetid] {',       
        '  border-radius: 3px;',
        '  color: #a855f7 !important;',
        '}',
        '.monaco-editor .codelens-decoration[widgetid] a {',
        '  color: #a855f7 !important;',
        '}',
        '.monaco-editor .codelens-decoration[widgetid]:hover {',
        '  background: rgba(168, 85, 247, 0.15) !important;',
        '}',
        '.monaco-editor .codelens-decoration[widgetid].bitmap-hover-active {',
        '  background: rgba(168, 85, 247, 0.15) !important;',
        '}',
        /* Data body highlight */
        '.bitmap-data-hover { background: rgba(168, 85, 247, 0.04) !important; }',
        /* Decl line highlight (stronger shade) */
        '.bitmap-decl-hover { background: rgba(168, 85, 247, 0.10) !important; }',
        /* Inline bitmap icon (::before pseudo-element on variable name) */
        '.bitmap-inline-icon::before {',
        '  content: "\\1F5BC\\FE0F";',
        '  cursor: pointer;',
        '  opacity: 0.8;',
        '  padding-right: 3px;',
        '}',
        '.bitmap-inline-icon:hover::before {',
        '  opacity: 1;',
        '  background: rgba(139, 45, 180, 0.25);',
        '  border-radius: 3px;',
        '}',
        '.bitmap-mask-icon::before {',
        '  content: "\\1F3AD";',
        '  cursor: pointer;',
        '  opacity: 0.8;',
        '  padding-right: 3px;',
        '}',
        '.bitmap-mask-icon:hover::before {',
        '  opacity: 1;',
        '  background: rgba(139, 45, 180, 0.25);',
        '  border-radius: 3px;',
        '}',
      ].join('\n');
      document.head.appendChild(bitmapStyleEl);

      /* Match CodeLens font to editor font so view zone is exactly one line — no blank gap */
      editor.updateOptions({ codeLensFontSize: 14 });

      /* ── Inline bitmap icon decorations (🖼️ before variable name) ──── */
      var bitmapInlineDecoIds = [];
      var _inlineDetectionMap = {}; // lineNumber → [{ col, endCol, args }]

      // Expose a helper so the completions hover provider can suppress itself
      // when hovering near a bitmap icon (avoids keyword tooltip over the emoji)
      BitmapDetector._hasBitmapIconNear = function (lineNumber, column) {
        var entries = _inlineDetectionMap[lineNumber];
        if (!entries) return false;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (column >= (e.col - 1) && column <= e.endCol) return true;
        }
        return false;
      };

      function _addEntry(line, col, endCol, args) {
        if (!_inlineDetectionMap[line]) _inlineDetectionMap[line] = [];
        _inlineDetectionMap[line].push({ col: col, endCol: endCol, args: args });
      }

      function _findEntryAt(line, column) {
        var entries = _inlineDetectionMap[line];
        if (!entries) return null;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (column >= (e.col - 1) && column <= e.endCol) return e;
        }
        return null;
      }

      function updateBitmapInlineDecorations() {
        var model = editor.getModel();
        if (!model) {
          bitmapInlineDecoIds = editor.deltaDecorations(bitmapInlineDecoIds, []);
          return;
        }
        if (!pixelEditorCodeLensCheckbox.checked) {
          bitmapInlineDecoIds = editor.deltaDecorations(bitmapInlineDecoIds, []);
          _inlineDetectionMap = {};
          return;
        }

        var uri = model.uri.toString();
        var lenses = BitmapDetector.getFullDetections(uri);
        var specs = [];
        _inlineDetectionMap = {};
        var declLineSeen = {};  // track which declLines we've handled
        var bitmapNames = [];   // collect {name, args} for reference scanning

        // First pass: declaration lines (only if current tab has arrays)
        for (var i = 0; i < lenses.length; i++) {
          var lens = lenses[i];
          if (!lens.command || !lens.command.arguments || !lens.command.arguments[0]) continue;

          var args = lens.command.arguments[0];
          var declLine = lens.range.startLineNumber;
          if (declLineSeen[declLine]) continue;
          declLineSeen[declLine] = true;

          args._sourceTabId = activeTabId;
          var name = args.arrayInfo.name;
          var lineContent = model.getLineContent(declLine);
          var escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          var nameRegex = new RegExp('\\b' + escapedName + '\\s*\\[');
          var nameMatch = lineContent.match(nameRegex);
          if (!nameMatch) continue;

          var nameCol = lineContent.indexOf(nameMatch[0]) + 1;
          var nameEnd = nameCol + name.length;

          var editMasks = !combineImageMasksCheckbox.checked;
          var fmt = args.detection.format;
          var isMasked = (fmt === BitmapDetector.FORMAT.SPRITES_EXT_MASK || fmt === BitmapDetector.FORMAT.SPRITES_PLUS_MASK);

          // When Edit Image Masks is on and format is masked, tag image-only
          if (editMasks && isMasked) {
            args._imageOnly = true;
          } else {
            args._imageOnly = false;
          }
          args._maskOnly = false;

          _addEntry(declLine, nameCol, nameEnd, args);

          specs.push({
            range: new monaco.Range(declLine, nameCol, declLine, nameEnd),
            options: {
              beforeContentClassName: 'bitmap-inline-icon',
              stickiness: 1
            }
          });

          bitmapNames.push({ name: name, args: args, bodyStart: args.arrayInfo.arrayBodyStart, bodyEnd: args.arrayInfo.arrayBodyEnd });

          // When Edit Image Masks is on, add a mask entry
          if (editMasks && isMasked) {
            if (fmt === BitmapDetector.FORMAT.SPRITES_EXT_MASK) {
              // EXT_MASK: mask is a separate array — resolve and locate it
              var maskName = args.detection.maskArrayName;
              if (maskName) {
                // Resolve maskArrayInfo if not yet done
                if (!args.detection.maskArrayInfo) {
                  var allArrs = BitmapDetector.Parser.parseArrays(model.getValue());
                  for (var mai = 0; mai < allArrs.length; mai++) {
                    if (allArrs[mai].name === maskName) {
                      args.detection.maskArrayInfo = allArrs[mai];
                      break;
                    }
                  }
                }
                if (args.detection.maskArrayInfo) {
                  var maskInfo = args.detection.maskArrayInfo;
                  var maskDeclLine = maskInfo.declLine;
                  var maskLC = model.getLineContent(maskDeclLine);
                  var escapedMask = maskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  var maskRegex = new RegExp('\\b' + escapedMask + '\\s*\\[');
                  var maskMatch = maskLC.match(maskRegex);
                  if (maskMatch) {
                    var maskCol = maskLC.indexOf(maskMatch[0]) + 1;
                    var maskEnd = maskCol + maskName.length;
                    // Create mask args — references the parent detection but flagged as mask-only
                    var maskArgs = {
                      arrayInfo: maskInfo,
                      detection: args.detection,
                      _sourceTabId: activeTabId,
                      _maskOnly: true,
                      _imageOnly: false,
                      _parentArgs: args,
                    };
                    _addEntry(maskDeclLine, maskCol, maskEnd, maskArgs);
                    declLineSeen[maskDeclLine] = true;
                    specs.push({
                      range: new monaco.Range(maskDeclLine, maskCol, maskDeclLine, maskEnd),
                      options: {
                        beforeContentClassName: 'bitmap-mask-icon',
                        stickiness: 1
                      }
                    });
                    bitmapNames.push({ name: maskName, args: maskArgs, bodyStart: maskInfo.arrayBodyStart, bodyEnd: maskInfo.arrayBodyEnd });
                  }
                }
              }
            } else if (fmt === BitmapDetector.FORMAT.SPRITES_PLUS_MASK) {
              // PLUS_MASK: mask is interleaved in same array — add second icon on same line
              var maskArgsPM = {
                arrayInfo: args.arrayInfo,
                detection: args.detection,
                _sourceTabId: activeTabId,
                _maskOnly: true,
                _imageOnly: false,
                _parentArgs: args,
              };
              // Place mask icon right after the image icon (at end of name)
              _addEntry(declLine, nameEnd, nameEnd + 1, maskArgsPM);
              specs.push({
                range: new monaco.Range(declLine, nameEnd, declLine, nameEnd + 1),
                options: {
                  beforeContentClassName: 'bitmap-mask-icon',
                  stickiness: 1
                }
              });
            }
          }
        }

        // Also gather bitmap names from ALL other tabs' detection caches
        // so references in .ino files can see bitmaps defined in .h files
        var seenNames = {};
        for (var bn = 0; bn < bitmapNames.length; bn++) {
          seenNames[bitmapNames[bn].name] = true;
        }
        var editMasksX = !combineImageMasksCheckbox.checked;
        if (typeof tabs !== 'undefined') {
          for (var ti = 0; ti < tabs.length; ti++) {
            var otherTab = tabs[ti];
            if (!otherTab.model || otherTab.isBinary) continue;
            var otherUri = otherTab.model.uri.toString();
            if (otherUri === uri) continue; // skip current tab, already handled
            var otherLenses = BitmapDetector.getFullDetections(otherUri);
            for (var ol = 0; ol < otherLenses.length; ol++) {
              var oLens = otherLenses[ol];
              if (!oLens.command || !oLens.command.arguments || !oLens.command.arguments[0]) continue;
              var oArgs = oLens.command.arguments[0];
              oArgs._sourceTabId = otherTab.id;
              var oName = oArgs.arrayInfo.name;
              var oFmt = oArgs.detection.format;
              var oIsMasked = (oFmt === BitmapDetector.FORMAT.SPRITES_EXT_MASK || oFmt === BitmapDetector.FORMAT.SPRITES_PLUS_MASK);

              // Set split-mode flags for cross-file references
              if (editMasksX && oIsMasked) {
                oArgs._imageOnly = true;
              } else {
                oArgs._imageOnly = false;
              }
              oArgs._maskOnly = false;

              if (!seenNames[oName]) {
                seenNames[oName] = true;
                bitmapNames.push({ name: oName, args: oArgs, bodyStart: -1, bodyEnd: -1 });
              }

              // When Edit Image Masks is on and format is EXT_MASK, also add mask variable name
              if (editMasksX && oFmt === BitmapDetector.FORMAT.SPRITES_EXT_MASK) {
                var oMaskName = oArgs.detection.maskArrayName;
                if (oMaskName && !seenNames[oMaskName]) {
                  // Resolve maskArrayInfo from the other tab's model if needed
                  if (!oArgs.detection.maskArrayInfo) {
                    var oAllArrs = BitmapDetector.Parser.parseArrays(otherTab.model.getValue());
                    for (var omai = 0; omai < oAllArrs.length; omai++) {
                      if (oAllArrs[omai].name === oMaskName) {
                        oArgs.detection.maskArrayInfo = oAllArrs[omai];
                        break;
                      }
                    }
                  }
                  if (oArgs.detection.maskArrayInfo) {
                    var oMaskArgs = {
                      arrayInfo: oArgs.detection.maskArrayInfo,
                      detection: oArgs.detection,
                      _sourceTabId: otherTab.id,
                      _maskOnly: true,
                      _imageOnly: false,
                      _parentArgs: oArgs,
                    };
                    seenNames[oMaskName] = true;
                    bitmapNames.push({ name: oMaskName, args: oMaskArgs, bodyStart: -1, bodyEnd: -1 });
                  }
                }
              }
            }
          }
        }

        // Second pass: scan for references throughout the current file
        if (bitmapNames.length > 0) {
          var lineCount = model.getLineCount();
          var namePatterns = [];
          for (var bn2 = 0; bn2 < bitmapNames.length; bn2++) {
            namePatterns.push(bitmapNames[bn2].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          }
          var refRegex = new RegExp('\\b(' + namePatterns.join('|') + ')\\b', 'g');
          var nameToArgs = {};
          var nameToBody = {};
          for (var bn3 = 0; bn3 < bitmapNames.length; bn3++) {
            nameToArgs[bitmapNames[bn3].name] = bitmapNames[bn3].args;
            nameToBody[bitmapNames[bn3].name] = { start: bitmapNames[bn3].bodyStart, end: bitmapNames[bn3].bodyEnd };
          }

          for (var ln = 1; ln <= lineCount; ln++) {
            var lc = model.getLineContent(ln);
            // Determine if this line is inside a block comment or where a line comment starts
            var lineCommentStart = -1;
            var inStr = false;
            var strCh = '';
            for (var ci = 0; ci < lc.length; ci++) {
              var ch = lc[ci];
              if (inStr) {
                if (ch === '\\') { ci++; continue; }
                if (ch === strCh) inStr = false;
                continue;
              }
              if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
              if (ch === '/' && ci + 1 < lc.length) {
                if (lc[ci + 1] === '/') { lineCommentStart = ci; break; }
                if (lc[ci + 1] === '*') { lineCommentStart = ci; break; }
              }
            }
            refRegex.lastIndex = 0;
            var rm;
            while ((rm = refRegex.exec(lc)) !== null) {
              var refName = rm[1];
              var refCol = rm.index + 1;
              var refEnd = refCol + refName.length;
              var refArgs = nameToArgs[refName];
              var body = nameToBody[refName];
              // Skip references inside comments
              if (lineCommentStart >= 0 && rm.index >= lineCommentStart) continue;
              // Skip #include lines (e.g. library name matches variable name)
              if (/^\s*#\s*include\b/.test(lc)) continue;
              // Skip the declaration line itself
              if (declLineSeen[ln] && lc.indexOf(refName + '[') >= 0 && lc.indexOf(refName + '[') === rm.index) continue;
              // Skip lines inside the array body (data bytes)
              if (body && body.start > 0 && ln >= body.start && ln <= body.end) continue;
              // Skip if already an entry at this exact position
              var existing = _inlineDetectionMap[ln];
              var dup = false;
              if (existing) {
                for (var ei = 0; ei < existing.length; ei++) {
                  if (existing[ei].col === refCol) { dup = true; break; }
                }
              }
              if (dup) continue;

              _addEntry(ln, refCol, refEnd, refArgs);
              var iconCls = (refArgs._maskOnly) ? 'bitmap-mask-icon' : 'bitmap-inline-icon';
              specs.push({
                range: new monaco.Range(ln, refCol, ln, refEnd),
                options: {
                  beforeContentClassName: iconCls,
                  stickiness: 1
                }
              });
            }
          }
        }

        bitmapInlineDecoIds = editor.deltaDecorations(bitmapInlineDecoIds, specs);
      }

      BitmapDetector._onDetectionsUpdated = function (uri) {
        updateBitmapInlineDecorations();
      };

      // Also refresh inline decorations when switching tabs
      editor.onDidChangeModel(function () {
        // Ensure all tabs have had their detections run (background scan)
        if (typeof tabs !== 'undefined') {
          for (var ti = 0; ti < tabs.length; ti++) {
            var tab = tabs[ti];
            if (!tab.model || tab.isBinary) continue;
            var tabUri = tab.model.uri.toString();
            // If this tab hasn't been scanned yet, run detection on it
            var existing = BitmapDetector.getFullDetections(tabUri);
            if (existing.length === 0 && /\.(ino|cpp|h|hpp|c)$/i.test(tabUri)) {
              BitmapDetector.provideCodeLenses(tab.model);
            }
          }
        }
        updateBitmapInlineDecorations();
      });

      /* ── Hover provider: bitmap preview tooltip ────────────────────── */
      var _previewCache = {}; // key: "name:line" → data URL string

      function generateBitmapPreview(args, scale) {
        scale = scale || 1;
        var imageOnly = !!args._imageOnly;
        var maskOnly = !!args._maskOnly;
        var suffix = imageOnly ? ':img' : maskOnly ? ':mask' : '';
        var key = args.arrayInfo.name + ':' + args.arrayInfo.declLine + ':' + scale + suffix;
        if (_previewCache[key]) return _previewCache[key];
        try {
          var detection = args.detection;

          // Resolve external mask array if needed (for EXT_MASK format)
          if (detection.maskArrayName && !detection.maskArrayInfo) {
            var srcModel = null;
            if (args._sourceTabId) {
              var srcTab = findTab(args._sourceTabId);
              if (srcTab && srcTab.model) srcModel = srcTab.model;
            }
            if (!srcModel) srcModel = editor.getModel();
            if (srcModel) {
              var allArrays = BitmapDetector.Parser.parseArrays(srcModel.getValue());
              for (var mi = 0; mi < allArrays.length; mi++) {
                if (allArrays[mi].name === detection.maskArrayName) {
                  detection.maskArrayInfo = allArrays[mi];
                  break;
                }
              }
            }
          }

          var imgData;
          if (imageOnly || maskOnly) {
            imgData = _decodeSplitChannel(args.arrayInfo, detection, maskOnly);
          } else {
            imgData = BitmapDetector.Codec.decode(args.arrayInfo, detection);
          }
          if (!imgData) return null;
          var sw = imgData.width;
          var sh = imgData.height;
          var dw = sw * scale;
          var dh = sh * scale;
          var c = document.createElement('canvas');
          c.width = dw;
          c.height = dh;
          var ctx = c.getContext('2d');
          var fmt = args.detection.format;
          var hasMask = !imageOnly && !maskOnly &&
            (fmt === BitmapDetector.FORMAT.SPRITES_EXT_MASK || fmt === BitmapDetector.FORMAT.SPRITES_PLUS_MASK);
          // Background: green matte for combined masked sprites, checkerboard for others
          for (var cy = 0; cy < sh; cy++) {
            for (var cx = 0; cx < sw; cx++) {
              ctx.fillStyle = hasMask ? '#34D399' : (((cx + cy) % 2 === 0) ? '#2d2d2d' : '#3d3d3d');
              ctx.fillRect(cx * scale, cy * scale, scale, scale);
            }
          }
          // Draw pixels with nearest-neighbor (manual upscale)
          var data = imgData.data;
          for (var py = 0; py < sh; py++) {
            for (var px = 0; px < sw; px++) {
              var i = (py * sw + px) * 4;
              var a = data[i + 3];
              if (a > 0) {
                ctx.fillStyle = 'rgba(' + data[i] + ',' + data[i+1] + ',' + data[i+2] + ',' + (a / 255) + ')';
                ctx.fillRect(px * scale, py * scale, scale, scale);
              }
            }
          }
          var dataUrl = c.toDataURL('image/png');
          _previewCache[key] = dataUrl;
          return dataUrl;
        } catch (e) {
          return null;
        }
      }

      // Clear preview cache when detections update
      var _origOnDetectionsUpdated = BitmapDetector._onDetectionsUpdated;
      BitmapDetector._onDetectionsUpdated = function (uri) {
        _previewCache = {};
        _origOnDetectionsUpdated(uri);
      };

      monaco.languages.registerHoverProvider('cpp', {
        provideHover: function (model, position) {
          var entry = _findEntryAt(position.lineNumber, position.column);
          if (!entry) return null;

          var args = entry.args;
          var name = args.arrayInfo.name;
          var nameStart = entry.col;
          var nameEnd = entry.endCol;
          var isMaskEntry = !!args._maskOnly;

          var det = args.detection;
          var w = det.width;
          var h = det.height;
          var frames = det.frameCount || 1;
          var format = det.format || '';

          // Deduce the Arduboy draw function for this format
          var drawFunc = '';
          var declHint = '';
          if (isMaskEntry) {
            drawFunc = '// Mask for ' + (args._parentArgs ? args._parentArgs.arrayInfo.name : name);
            declHint = 'MASK';
          } else {
          switch (format) {
            case 'drawBitmap':
              drawFunc = 'arduboy.drawBitmap(x, y, ' + name + ', ' + w + ', ' + h + ', WHITE);';
              declHint = 'BITMAP';
              break;
            case 'drawSlowXYBitmap':
              drawFunc = 'arduboy.drawSlowXYBitmap(x, y, ' + name + ', ' + w + ', ' + h + ', WHITE);';
              declHint = 'BITMAP';
              break;
            case 'spritesOverwrite':
              drawFunc = 'Sprites::drawOverwrite(x, y, ' + name + ', frame);';
              declHint = 'SPRITE';
              break;
            case 'spritesExternalMask':
              drawFunc = 'Sprites::drawExternalMask(x, y, ' + name + ', ' + (det.maskArrayName || (name + '_mask')) + ', frame, frame);';
              declHint = 'SPRITE';
              break;
            case 'spritesPlusMask':
              drawFunc = 'Sprites::drawPlusMask(x, y, ' + name + ', frame);';
              declHint = 'SPRITE';
              break;
            default:
              drawFunc = '// ' + name;
              declHint = 'Bitmap data';
          }
          }

          // Build dimension string
          var dimStr = w + '\u00D7' + h;
          if (frames > 1) dimStr += ', ' + frames + ' frames';

          // Generate upscaled pixel preview (crisp nearest-neighbor baked in)
          var maxDim = Math.max(w * frames, h);
          var scale = maxDim <= 16 ? 8 : maxDim <= 32 ? 4 : maxDim <= 64 ? 2 : 1;
          var dataUrl = generateBitmapPreview(args, scale);
          var dispW = (w * frames) * scale;
          var dispH = h * scale;

          // Match Monaco default hover format: code block header → separator → docs
          var contents = [];
          // First block: header
          contents.push({ value: declHint + ' \u2014 ' + dimStr });
          // Second block: description + preview (separator auto-inserted)
          var body = '\n';
          if (dataUrl) {
            body += '<img src="' + dataUrl + '" width="' + dispW + '" height="' + dispH + '" style="border: 1px solid #555;" />\n\n';
          }
          body += isMaskEntry ? '_Click to open Mask Editor_' : '_Click to open Pixel Editor_';

          contents.push({ value: body, supportHtml: true, isTrusted: true });

          return {
            range: new monaco.Range(position.lineNumber, nameStart, position.lineNumber, nameEnd),
            contents: contents
          };
        }
      });

      /* ── Click handler: click 🖼️ icon → open bitmap editor ────────── */
      editor.onMouseDown(function (e) {
        if (!e.target || !e.target.position) return;
        var targetType = e.target.type;
        if (targetType !== 6) return; // CONTENT_TEXT
        var pos = e.target.position;
        var entry = _findEntryAt(pos.lineNumber, pos.column);
        if (!entry) return;

        var el = e.target.element;
        if (el && el.classList && (el.classList.contains('bitmap-inline-icon') || el.classList.contains('bitmap-mask-icon'))) {
          e.event.preventDefault();
          e.event.stopPropagation();
          BitmapDetector._onEditBitmap(entry.args);
        }
      });

      /* ── Hover: bidirectional highlight between CodeLens and data ───── */
      var bitmapHoverDecoIds = [];
      var _activeCodeLensEl = null;
      var editorDom = null;
      function getEditorDom() {
        if (!editorDom) editorDom = editor.getDomNode();
        return editorDom;
      }

      function clearBitmapHovers() {
        if (bitmapHoverDecoIds.length > 0) {
          bitmapHoverDecoIds = editor.deltaDecorations(bitmapHoverDecoIds, []);
        }
        if (_activeCodeLensEl) {
          _activeCodeLensEl.classList.remove('bitmap-hover-active');
          _activeCodeLensEl = null;
        }
      }

      window._bitmapUpdateInlineDecos = updateBitmapInlineDecorations;
      window._bitmapClearHovers = clearBitmapHovers;

      function findCodeLensForLine(declLine) {
        var dom = getEditorDom();
        var pos = editor.getScrolledVisiblePosition({ lineNumber: declLine, column: 1 });
        if (!pos || !dom) return null;
        var editorRect = dom.getBoundingClientRect();
        var lineTop = editorRect.top + pos.top;
        var lensEls = dom.querySelectorAll('.codelens-decoration[widgetid]');
        var best = null;
        var bestDist = Infinity;
        for (var li = 0; li < lensEls.length; li++) {
          var rect = lensEls[li].getBoundingClientRect();
          var dist = Math.abs(rect.bottom - lineTop);
          if (dist < bestDist) { bestDist = dist; best = lensEls[li]; }
        }
        return bestDist < pos.height * 2 ? best : null;
      }

      function findDetectionForCodeLens(lensRect) {
        var dom = getEditorDom();
        var model = editor.getModel();
        if (!model || !dom) return null;
        var dets = BitmapDetector.getDetections(model.uri.toString());
        var editorRect = dom.getBoundingClientRect();
        for (var di = 0; di < dets.length; di++) {
          if (dets[di].compressed) continue;
          var pos = editor.getScrolledVisiblePosition({ lineNumber: dets[di].declLine, column: 1 });
          if (!pos) continue;
          var lineTop = editorRect.top + pos.top;
          if (Math.abs(lensRect.bottom - lineTop) < pos.height * 2) return dets[di];
        }
        return null;
      }

      // Hover decl line or data body → highlight entire bitmap region + CodeLens
      editor.onMouseMove(function (e) {
        if (!pixelEditorCodeLensCheckbox.checked) {
          clearBitmapHovers();
          return;
        }
        if (!e.target || !e.target.position) {
          clearBitmapHovers();
          return;
        }
        var hoverLine = e.target.position.lineNumber;
        var model = editor.getModel();
        if (!model) return;
        var detections = BitmapDetector.getDetections(model.uri.toString());
        var specs = [];
        var targetDeclLine = null;

        for (var hd = 0; hd < detections.length; hd++) {
          var det = detections[hd];
          if (det.compressed) continue;
          if (hoverLine >= det.declLine && hoverLine <= det.bodyEnd) {
            // Highlight decl line (stronger shade) + data body
            specs.push({
              range: new monaco.Range(det.declLine, 1, det.declLine, 1),
              options: { isWholeLine: true, className: 'bitmap-decl-hover' }
            });
            var dataStart = det.declLine + 1;
            if (dataStart <= det.bodyEnd) {
              specs.push({
                range: new monaco.Range(dataStart, 1, det.bodyEnd, 1),
                options: { isWholeLine: true, className: 'bitmap-data-hover' }
              });
            }
            targetDeclLine = det.declLine;
            break;
          }
        }

        bitmapHoverDecoIds = editor.deltaDecorations(bitmapHoverDecoIds, specs);

        // Highlight/unhighlight CodeLens DOM element
        if (_activeCodeLensEl) {
          _activeCodeLensEl.classList.remove('bitmap-hover-active');
          _activeCodeLensEl = null;
        }
        if (targetDeclLine !== null) {
          var el = findCodeLensForLine(targetDeclLine);
          if (el) { el.classList.add('bitmap-hover-active'); _activeCodeLensEl = el; }
        }
      });

      // CodeLens hover → highlight decl + data body
      // Use document-level delegation since CodeLens widgets may sit outside editor.getDomNode()
      document.addEventListener('mouseover', function (e) {
        if (!pixelEditorCodeLensCheckbox.checked) return;
        var lensEl = e.target.closest ? e.target.closest('.codelens-decoration') : null;
        if (!lensEl) return;
        var det = findDetectionForCodeLens(lensEl.getBoundingClientRect());
        if (!det) return;
        // Highlight decl line + data body
        var specs = [];
        specs.push({
          range: new monaco.Range(det.declLine, 1, det.declLine, 1),
          options: { isWholeLine: true, className: 'bitmap-decl-hover' }
        });
        var dataStart = det.declLine + 1;
        if (dataStart <= det.bodyEnd) {
          specs.push({
            range: new monaco.Range(dataStart, 1, det.bodyEnd, 1),
            options: { isWholeLine: true, className: 'bitmap-data-hover' }
          });
        }
        bitmapHoverDecoIds = editor.deltaDecorations(bitmapHoverDecoIds, specs);
        if (!lensEl.classList.contains('bitmap-hover-active')) {
          lensEl.classList.add('bitmap-hover-active');
          _activeCodeLensEl = lensEl;
        }
      });

      document.addEventListener('mouseout', function (e) {
        if (!pixelEditorCodeLensCheckbox.checked) return;
        var lensEl = e.target.closest ? e.target.closest('.codelens-decoration') : null;
        if (!lensEl) return;
        clearBitmapHovers();
      });
    }

    /* ══════════════════════════════════════════════════════════════════════
     *  Example Link decorations — clickable // Example: lines
     * ══════════════════════════════════════════════════════════════════════ */
    var exampleLinksCheckbox = document.getElementById('exampleLinksCheckbox');
    var exampleLinkDecoIds = [];

    // Inject CSS for example link decorations
    var exampleLinkStyleEl = document.createElement('style');
    exampleLinkStyleEl.textContent = [
      '.example-link-deco {',
      '  color: #4ec9b0 !important;',
      '  text-decoration: underline;',
      '  text-decoration-style: dotted;',
      '  cursor: pointer;',
      '}',
      '.example-link-deco:hover {',
      '  background: rgba(78, 201, 176, 0.15);',
      '  text-decoration-style: solid;',
      '}',
    ].join('\n');
    document.head.appendChild(exampleLinkStyleEl);

    function updateExampleLinkDecorations() {
      var model = editor.getModel();
      if (!model || !exampleLinksCheckbox || !exampleLinksCheckbox.checked) {
        exampleLinkDecoIds = editor.deltaDecorations(exampleLinkDecoIds, []);
        return;
      }
      var specs = [];
      var lineCount = model.getLineCount();
      for (var i = 1; i <= lineCount; i++) {
        var lineContent = model.getLineContent(i);
        var m = lineContent.match(/^(\s*)(\/\/ Example: )(.+)$/);
        if (m) {
          var startCol = m[1].length + m[2].length + 1;
          var endCol = startCol + m[3].length;
          specs.push({
            range: new monaco.Range(i, startCol, i, endCol),
            options: {
              inlineClassName: 'example-link-deco',
              hoverMessage: { value: 'Click to copy: `' + m[3].replace(/`/g, '\\`') + '`' },
              stickiness: 1,
            }
          });
        }
      }
      exampleLinkDecoIds = editor.deltaDecorations(exampleLinkDecoIds, specs);
    }

    // Click handler for example links in Monaco
    editor.onMouseDown(function (e) {
      if (!exampleLinksCheckbox || !exampleLinksCheckbox.checked) return;
      if (!e.target || !e.target.position) return;
      var el = e.target.element;
      if (!el || !el.classList || !el.classList.contains('example-link-deco')) return;
      var pos = e.target.position;
      var lineContent = editor.getModel().getLineContent(pos.lineNumber);
      var match = lineContent.match(/\/\/ Example: (.+)$/);
      if (match) {
        navigator.clipboard.writeText(match[1]).then(function () {
          setStatus('Example copied to clipboard', 'success');
        }, function () {
          setStatus('Failed to copy example', 'error');
        });
        e.event.preventDefault();
        e.event.stopPropagation();
      }
    });

    // Update decorations on model change and tab switch (deferred to avoid recursive deltaDecorations)
    var _exampleLinkPending = 0;
    function scheduleExampleLinkUpdate() {
      if (_exampleLinkPending) return;
      _exampleLinkPending = requestAnimationFrame(function () {
        _exampleLinkPending = 0;
        updateExampleLinkDecorations();
      });
    }
    editor.onDidChangeModelContent(function () {
      scheduleExampleLinkUpdate();
    });
    editor.onDidChangeModel(function () {
      scheduleExampleLinkUpdate();
    });

    // Expose for toggle callback
    window._updateExampleLinkDecos = updateExampleLinkDecorations;

    /* ── Create default tab ──────────────────────────────────────────── */
    if (!loadWorkspaceFromLocalStorage()) {
      createTab('Sketch.ino', DEFAULT_SKETCH, true);
    }

    /* ── Auto-save on content changes ────────────────────────────────── */
    tabs.forEach(function (tab) {
      if (!tab.isBinary && tab.model) {
        tab.model.onDidChangeContent(function () {
          saveWorkspaceToLocalStorage();
          renderTabBar();
        });
      }
    });

    /* ── Keyboard shortcuts ──────────────────────────────────────────── */
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, function () {
      onBuild();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
      // Prevent browser save dialog — no-op
    });

    /* ── Ctrl+Shift+H  — toggle highlight ────────────────────────────── */
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyH,
      function () { toggleDiagnosticHighlighting(); }
    );

    /* ── Restore synced folder from IndexedDB ────────────────────────── */
    if (isFileSystemAccessSupported) {
      loadSyncHandleFromIDB(function (handle) {
        if (!handle) return;
        var checkPerm = handle.queryPermission
          ? handle.queryPermission({ mode: 'read' })
          : Promise.resolve('prompt');
        checkPerm.then(function (state) {
          if (state === 'granted') {
            syncDirHandle = handle;
            syncFolderName = localStorage.getItem('syncFolderName') || handle.name;
            updateSyncUI(true);
            startSyncMonitoring();
            setTimeout(function () { performSyncCheck(false); }, 2000);
          } else {
            removeSyncHandleFromIDB();
            localStorage.removeItem('syncFolderName');
          }
        }).catch(function () {
          removeSyncHandleFromIDB();
          localStorage.removeItem('syncFolderName');
        });
      });
    }

    /* ── Expose Code Editor API for webtools interop ──────────────────── */
    window.__codeEditor = {
      /** Return all non-binary tabs. */
      getTabs: function () { return tabs; },
      /** Find a tab by exact filename. */
      findTabByFilename: function (name) { return findTabByFilename(name); },
      /** Find a tab whose basename matches (searches subdirs). */
      findTabByBasename: function (basename) {
        var lower = basename.toLowerCase();
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].filename.replace(/.*\//, '').toLowerCase() === lower) {
            return tabs[i];
          }
        }
        return null;
      },
      /** Find the .ino tab. */
      findInoTab: function () {
        for (var i = 0; i < tabs.length; i++) {
          if (getExtension(tabs[i].filename) === '.ino' && tabs[i].model) return tabs[i];
        }
        return null;
      },
      /** Create a new text tab. Returns the tab object. */
      createTab: function (filename, content) { return createTab(filename, content); },
      /** Sort tabs in standard order (.ino first, then .h/.cpp, etc.). */
      sortTabs: function () { sortTabs(); },
      /**
       * Import a sketch (.ino) with the standard project-replace prompt.
       * @param {string} filename - e.g. 'Example.ino'
       * @param {string} content - Full sketch source code
       * @returns {Promise<boolean>} true if imported
       */
      importSketch: function (filename, content) {
        // Check if workspace is the unmodified default sketch
        var textTabs = [];
        for (var ti = 0; ti < tabs.length; ti++) {
          if (!tabs[ti].isBinary) textTabs.push(tabs[ti]);
        }
        var isUnmodifiedDefault = textTabs.length === 1
          && textTabs[0].isDefault
          && getExtension(textTabs[0].filename).toLowerCase() === '.ino'
          && textTabs[0].model.getValue() === DEFAULT_SKETCH;

        function doImport() {
          resetWorkspaceForProjectImport();
          var data = new TextEncoder().encode(content);
          var tabId = importSingleFile(filename, data);
          if (tabId !== null) switchToTab(tabId);
          saveWorkspaceToLocalStorage();
          sortTabs();
        }

        if (isUnmodifiedDefault) {
          doImport();
          return Promise.resolve(true);
        }
        return showConfirmModal(
          'Import Sketch',
          'This will replace your current project with <b>' + filename + '</b>.<br><br><small>Current files will not be saved.</small>',
          'Import'
        ).then(function (ok) {
          if (!ok) return false;
          doImport();
          return true;
        });
      },
      /** Switch to (activate) a tab by its id. */
      switchToTab: function (id) { switchToTab(id); },
      /** Create or update a binary (non-editable) tab. Returns the tab object. */
      createBinaryTab: function (filename, sizeBytes, binaryData) {
        return createBinaryTab(filename, sizeBytes, binaryData);
      },
      /** Close (remove) a tab by its id. */
      closeTab: function (id) { closeTab(id); },
      /** Re-render the binaries list in the UI. */
      renderBinariesList: function () { renderBinariesList(); },
      /** Persist workspace to localStorage. */
      saveWorkspace: function () { saveWorkspaceToLocalStorage(); },
      /** Get the Monaco editor instance. */
      getEditor: function () { return editor; },
      /** Get the monaco namespace. */
      getMonaco: function () { return monaco; },
    };
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  Highlight toggle — button + keyboard shortcut handler
   * ══════════════════════════════════════════════════════════════════════ */
  function toggleDiagnosticHighlighting() {
    diagnosticHighlightingEnabled = !diagnosticHighlightingEnabled;
    localStorage.setItem('highlightEnabled', diagnosticHighlightingEnabled ? 'true' : 'false');

    if (diagnosticHighlightingEnabled) {
      // Re-enable: rebuild marker/decoration data from allDiagnostics and apply
      highlightToggleBtn.className = highlightToggleBtn.className.replace('highlight-btn--off', 'highlight-btn--on');
      highlightToggleBtn.title = 'Toggle inline error/warning highlighting (currently ON)';
      if (typeof monaco !== 'undefined') {
        tabs.forEach(function (tab) {
          if (tab.isBinary) return;
          monaco.editor.setModelMarkers(tab.model, 'arduboy-compile', buildMarkers(tab.id));
          tabDecorationData[tab.id] = buildDecorationSpecs(tab.id);
          tabDecorationIds[tab.id]  = [];   // will be (re-)applied fresh below
        });
        applyEditorDecorations();
      }
    } else {
      // Disable: clear all markers and decorations
      highlightToggleBtn.className = highlightToggleBtn.className.replace('highlight-btn--on', 'highlight-btn--off');
      highlightToggleBtn.title = 'Toggle inline error/warning highlighting (currently OFF)';
      if (typeof monaco !== 'undefined') {
        tabs.forEach(function (tab) {
          if (tab.isBinary) return;
          monaco.editor.setModelMarkers(tab.model, 'arduboy-compile', []);
          if (editor && tab.id === activeTabId) {
            tabDecorationIds[tab.id] = editor.deltaDecorations(
              tabDecorationIds[tab.id] || [], []
            );
          } else {
            // Decorations on inactive models are cleared the next time that
            // tab's model is made active (applyEditorDecorations uses [] specs).
            tabDecorationIds[tab.id] = [];
          }
        });
      }
    }
  }

  highlightToggleBtn.addEventListener('click', toggleDiagnosticHighlighting);
})();
