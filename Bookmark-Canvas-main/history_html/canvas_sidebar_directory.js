(function setupCanvasSidebarDirectory(global) {
  'use strict';

  const ROOT_ID = 'canvasDirectoryTree';
  const CANVAS_CONTENT_ID = 'canvasContent';
  const REFRESH_INTERVAL_MS = 60000;
  const REFRESH_DEFER_MS = 180;
  const PREVIEW_LIMIT = 30;
  const STRIP_HTML_CACHE_LIMIT = 1200;
  const BCS_CANVAS_KEY = 'bcs:canvas';
  const PERMANENT_COPIES_STORAGE_KEY = 'bcs:perm:copies';
  const PERMANENT_MAIN_TIP_STORAGE_KEY = 'bcs:perm:tip-main';
  const PERMANENT_COPY_TIP_STORAGE_PREFIX = 'bcs:perm:tip-copy-';
  const FOLDER_OPEN_STATES_KEY = 'bcs:sidebar:folder_open_states';
  const POST_RELOAD_LOCATE_KEY = 'bcs:post-reload-locate';
  const PINNED_KEYS_STORAGE_KEY = 'bcs:sidebar:directory_pinned_keys';
  const PINNED_SECTION_OPEN_KEY = 'bcs:sidebar:pinned_section_open';

  function loadPinnedKeys() {
    try {
      const raw = localStorage.getItem(PINNED_KEYS_STORAGE_KEY);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function savePinnedKeys(keys) {
    try {
      const clean = Array.isArray(keys) ? keys.filter(Boolean) : [];
      localStorage.setItem(PINNED_KEYS_STORAGE_KEY, JSON.stringify(clean));
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('canvas-directory-pinned-keys-changed', { detail: { keys: clean } }));
      }
    } catch (_) {}
  }

  function isNodeKeyPinned(key) {
    if (!key) return false;
    return loadPinnedKeys().includes(key);
  }

  function togglePinnedNodeKey(key) {
    if (!key) return;
    const keys = loadPinnedKeys().slice();
    const idx = keys.indexOf(key);
    if (idx >= 0) {
      keys.splice(idx, 1);
    } else {
      keys.push(key);
    }
    savePinnedKeys(keys);
    refreshDirectory({ force: true });
  }

  function removePinnedNodeKey(key) {
    if (!key) return;
    const keys = loadPinnedKeys().slice();
    const idx = keys.indexOf(key);
    if (idx >= 0) {
      keys.splice(idx, 1);
      savePinnedKeys(keys);
      refreshDirectory({ force: true });
    }
  }

  function unpinByEntityId(entityId) {
    const rawId = normalizeText(entityId);
    if (!rawId) return;
    const keys = loadPinnedKeys();
    const clean = keys.filter((k) => {
      if (!k) return false;
      if (k === rawId) return false;
      if (k.endsWith(`-${rawId}`)) return false;
      if (k.includes(`-${rawId}-`)) return false;
      return true;
    });
    if (clean.length !== keys.length) {
      savePinnedKeys(clean);
      refreshDirectory({ force: true });
    }
  }

  function unpinAllNonPermanent() {
    const keys = loadPinnedKeys();
    const clean = keys.filter((k) => {
      if (!k) return false;
      return k === 'folder-permanent' || k.startsWith('permanent-col-') || k === 'permanent-main';
    });
    if (clean.length !== keys.length) {
      savePinnedKeys(clean);
      refreshDirectory({ force: true });
    }
  }

  function getPinnedSectionOpenState() {
    try {
      const val = localStorage.getItem(PINNED_SECTION_OPEN_KEY);
      return val === null ? true : val === 'true';
    } catch (_) {
      return true;
    }
  }

  function savePinnedSectionOpenState(isOpen) {
    try {
      localStorage.setItem(PINNED_SECTION_OPEN_KEY, isOpen ? 'true' : 'false');
    } catch (_) {}
  }

  function canPinNode(node) {
    return !!(node && node.key && node.target && !node.placeholder);
  }

  function getFolderOpenStates() {
    try {
      const raw = localStorage.getItem(FOLDER_OPEN_STATES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function saveFolderOpenState(key, open) {
    try {
      const states = getFolderOpenStates();
      states[key] = !!open;
      localStorage.setItem(FOLDER_OPEN_STATES_KEY, JSON.stringify(states));
    } catch (_) {}
  }

  function getDefaultFolderOpenState(node) {
    if (node && typeof node.open === 'boolean') {
      return node.open;
    }
    const key = node.key || '';
    if (key === 'folder-card-groups' || key === 'folder-permanent') {
      return true;
    }
    return false;
  }

  const SPECIAL_TEMP_SOURCE_SET = new Set(['browser-drop', 'search-result', 'batch', 'quick-add', 'file-import', 'import-html-bookmarks', 'import-json-bookmarks', 'clipboard-paste']);
  const DIRECTORY_COLOR_DEFAULTS = Object.freeze({
    permanent: '#10b981',
    temp: '#2563eb',
    specialTemp: '#e9973f',
    blank: '#888888',
    cardGroup: '#888888',
    edge: '#999999',
    pinned: '#eab308'
  });
  const DIRECTORY_LOCATABLE_NEUTRAL_COLOR = '#888888';
  const IMPORT_DIRECTORY_NEUTRAL_COLOR = '#9aa0a6';

  let initialized = false;
  let refreshTimer = null;
  let refreshRaf = null;
  let refreshDeferredTimer = null;
  let pendingForceRefresh = false;
  let pendingPreferStoredFolderStates = false;
  let hasPendingRefreshOnVisible = false;
  let canvasObserver = null;
  let observedCanvasContent = null;
  let lastFingerprint = '';
  let activeNodeKey = '';
  let nodeActionMap = new Map();
  let nodeDeleteActionMap = new Map();
  let directoryNodeDataMap = new Map();
  let pinnedTargetMap = new Map();
  let pendingDeleteUiKey = '';

  function resolveNodeTarget(nodeKey) {
    if (!nodeKey) return null;
    if (pinnedTargetMap && pinnedTargetMap.has(nodeKey)) {
      return pinnedTargetMap.get(nodeKey);
    }
    const root = document.getElementById(ROOT_ID);
    const nodeMap = (root && root.__directoryNodeDataMap__) || directoryNodeDataMap;
    const node = nodeMap ? nodeMap.get(nodeKey) : null;
    if (node && node.target) {
      return node.target;
    }
    if (nodeActionMap && nodeActionMap.has(nodeKey)) {
      return nodeActionMap.get(nodeKey);
    }
    return null;
  }

  function getLang() {
    return (typeof global.currentLang === 'string' && global.currentLang) ? global.currentLang : 'zh_CN';
  }

  function isEnglish() {
    const lang = String(getLang()).toLowerCase();
    return lang === 'en' || lang.startsWith('en');
  }

  function t(zh, en) {
    return isEnglish() ? en : zh;
  }

  function collectPermanentViewShellSnapshot() {
    const protocolBridge = global.CanvasProtocolBridge && typeof global.CanvasProtocolBridge.collectPermanentViewShellSnapshot === 'function'
      ? global.CanvasProtocolBridge
      : null;
    if (!protocolBridge) return null;
    try {
      const snapshot = protocolBridge.collectPermanentViewShellSnapshot();
      return snapshot && Array.isArray(snapshot.views) ? snapshot : null;
    } catch (_) {
      return null;
    }
  }

  function getPermanentViewShellViews(snapshotInput = null) {
    const snapshot = snapshotInput && Array.isArray(snapshotInput.views)
      ? snapshotInput
      : collectPermanentViewShellSnapshot();
    return Array.isArray(snapshot && snapshot.views) ? snapshot.views : [];
  }

  function getPermanentCopyShells(snapshotInput = null) {
    return getPermanentViewShellViews(snapshotInput).filter((view) => view && view.copyId);
  }

  function getPermanentMainShell(snapshotInput = null) {
    return getPermanentViewShellViews(snapshotInput).find((view) => !(view && view.copyId)) || null;
  }

  function normalizeText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\u200B/g, '').replace(/\r\n?/g, '\n').trim();
  }

  function squeezeSpaces(value) {
    return String(value || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function clampText(value, limit = PREVIEW_LIMIT) {
    const text = squeezeSpaces(value);
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1)}…`;
  }

  function stripHtml(raw) {
    const text = normalizeText(raw);
    if (!text) return '';
    if (!/[<>]/.test(text)) return text;
    if (!stripHtml.cache) stripHtml.cache = new Map();
    const cached = stripHtml.cache.get(text);
    if (typeof cached === 'string') return cached;
    let stripped = '';
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = text;
      stripped = normalizeText(tmp.textContent || '');
    } catch (_) {
      stripped = normalizeText(text.replace(/<[^>]*>/g, ' '));
    }
    stripHtml.cache.set(text, stripped);
    if (stripHtml.cache.size > STRIP_HTML_CACHE_LIMIT) {
      try { stripHtml.cache.delete(stripHtml.cache.keys().next().value); } catch (_) {}
    }
    return stripped;
  }

  function cleanTextWithImageFallback(raw) {
    const text = normalizeText(raw);
    if (!text) return '';

    // 1. Get the normal stripped text using original stripping logic
    const normalStripped = stripInlineMarkdown(stripHtml(text)).trim();
    if (normalStripped) {
      return normalStripped;
    }

    // 2. If it is empty, extract the raw image source markup
    // Search for markdown image: ![]()
    const mdImgMatch = text.match(/(!\[[^\]]*\]\([^)]+\))/);
    if (mdImgMatch) {
      return mdImgMatch[1].trim();
    }

    // Search for HTML image: <img ...>
    const htmlImgMatch = text.match(/(<img[^>]*>)/i);
    if (htmlImgMatch) {
      return htmlImgMatch[1].trim();
    }

    return '';
  }

  function toPreviewText(raw, limit = PREVIEW_LIMIT) {
    return clampText(cleanTextWithImageFallback(raw), limit);
  }

  function getFirstLineText(raw) {
    const normalized = cleanTextWithImageFallback(raw);
    if (!normalized) return '';
    const lines = normalized.split(/\n+/).map(line => squeezeSpaces(line)).filter(Boolean);
    if (!lines.length) return '';
    return lines[0];
  }


  function normalizeMdNodeTitleLine(raw) {
    let line = squeezeSpaces(raw);
    if (!line) return '';
    while (/^#{1,6}\s+/.test(line)) {
      line = line.replace(/^#{1,6}\s+/, '').trim();
    }
    line = line
      .replace(/^>+\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    return squeezeSpaces(line);
  }

  function isCanvasNativeTextNode(node) {
    if (!node || typeof node !== 'object') return false;
    const subtype = normalizeText(node.subtype).toLowerCase();
    const source = normalizeText(node.source).toLowerCase();
    return subtype === 'canvas-native-text' || source === 'obsidian-canvas-text';
  }

  function stripInlineMarkdown(raw) {
    let line = String(raw || '');
    if (!line) return '';
    line = line
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/==([^=]+)==/g, '$1');
    return line;
  }

  function getMdNodeTitleLineFromSource(node) {
    const raw = isCanvasNativeTextNode(node)
      ? normalizeText(node && node.text)
      : normalizeText(node && node.text);
    if (!raw) return '';
    const lines = raw
      .split(/\n+/)
      .map((line) => squeezeSpaces(cleanTextWithImageFallback(line)))
      .filter(Boolean);
    if (!lines.length) return '';
    return lines[0];
  }



  function parseJSON(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function toPositiveInt(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function toAlphaLabel(value) {
    let n = toPositiveInt(value);
    if (!n) return '';
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function compareText(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  function escapeSelector(value) {
    const raw = String(value || '');
    if (!raw) return '';
    if (global.CSS && typeof global.CSS.escape === 'function') {
      return global.CSS.escape(raw);
    }
    return raw.replace(/["\\]/g, '\\$&');
  }

  function getCanvasModule() {
    return (global.CanvasModule && typeof global.CanvasModule === 'object') ? global.CanvasModule : null;
  }

  function getCanvasState() {
    const module = getCanvasModule();
    if (!module || !module.CanvasState || typeof module.CanvasState !== 'object') return null;
    return module.CanvasState;
  }

  function formatAnchorZoomPercent(zoom) {
    const module = getCanvasModule();
    if (module && typeof module.formatDisplayZoomPercent === 'function') {
      return module.formatDisplayZoomPercent(zoom);
    }

    const state = getCanvasState();
    const baseZoom = Number(state && state.baseZoom);
    const rawZoom = Number(zoom);
    const displayZoom = (Number.isFinite(rawZoom) && rawZoom > 0 ? rawZoom : 1)
      / (Number.isFinite(baseZoom) && baseZoom > 0 ? baseZoom : 1);
    return displayZoom < 0.1
      ? `${(displayZoom * 100).toFixed(1)}%`
      : `${Math.round(displayZoom * 100)}%`;
  }

  function normalizeHexColor(value, fallback) {
    const raw = normalizeText(value);
    if (!raw) return fallback;
    if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return raw;
    return fallback;
  }

  function presetColorToHex(value) {
    switch (String(value || '').trim()) {
      case '1': return '#fb464c';
      case '2': return '#e9973f';
      case '3': return '#e0de71';
      case '4': return '#44cf6e';
      case '5': return '#53dfdd';
      case '6': return '#a882ff';
      default: return null;
    }
  }

  function resolveNodeCustomColor(node) {
    const byHex = normalizeHexColor(node && node.colorHex, null);
    if (byHex) return byHex;
    const byPreset = presetColorToHex(node && node.color);
    return normalizeHexColor(byPreset, null);
  }

  function getDirectoryColorSyncFlags() {
    let defaultColorSync = true;
    let locatableColorSync = true;
    try {
      const module = getCanvasModule();
      if (module && typeof module.getCanvasOtherSettings === 'function') {
        const otherSettings = module.getCanvasOtherSettings();
        const legacySync = (otherSettings && typeof otherSettings.menuColorSync === 'boolean')
          ? otherSettings.menuColorSync
          : null;

        if (otherSettings && typeof otherSettings.menuDefaultColorSync === 'boolean') {
          defaultColorSync = otherSettings.menuDefaultColorSync;
        } else if (legacySync !== null) {
          defaultColorSync = legacySync;
        }

        if (otherSettings && typeof otherSettings.menuLocatableColorSync === 'boolean') {
          locatableColorSync = otherSettings.menuLocatableColorSync;
        } else if (legacySync !== null) {
          locatableColorSync = legacySync;
        }
      }
    } catch (_) {
      defaultColorSync = true;
      locatableColorSync = true;
    }

    return {
      defaultColorSync: !!defaultColorSync,
      locatableColorSync: !!locatableColorSync
    };
  }

  function getAppearanceThemeColorTokens() {
    const defaults = DIRECTORY_COLOR_DEFAULTS;
    let colors = null;
    try {
      const module = getCanvasModule();
      if (module && typeof module.getCanvasAppearanceSettings === 'function') {
        const settings = module.getCanvasAppearanceSettings();
        colors = settings && settings.colors ? settings.colors : null;
      }
    } catch (_) {
      colors = null;
    }

    return {
      permanent: normalizeHexColor(colors && colors.permanent, defaults.permanent),
      temp: normalizeHexColor(colors && colors.temp, defaults.temp),
      specialTemp: normalizeHexColor(colors && colors.specialTemp, defaults.specialTemp),
      blank: normalizeHexColor(colors && colors.mdNode, defaults.blank),
      cardGroup: normalizeHexColor(colors && colors.cardGroup, defaults.cardGroup),
      edge: normalizeHexColor(colors && colors.edge, defaults.edge),
      pinned: normalizeHexColor(colors && colors.pinned, defaults.pinned)
    };
  }

  function getAppearanceBaseColorTokens() {
    const syncFlags = getDirectoryColorSyncFlags();
    if (!syncFlags.defaultColorSync) {
      return {
        permanent: DIRECTORY_LOCATABLE_NEUTRAL_COLOR,
        temp: DIRECTORY_LOCATABLE_NEUTRAL_COLOR,
        specialTemp: DIRECTORY_LOCATABLE_NEUTRAL_COLOR,
        blank: DIRECTORY_LOCATABLE_NEUTRAL_COLOR,
        cardGroup: DIRECTORY_LOCATABLE_NEUTRAL_COLOR,
        edge: DIRECTORY_LOCATABLE_NEUTRAL_COLOR,
        pinned: DIRECTORY_LOCATABLE_NEUTRAL_COLOR
      };
    }
    return getAppearanceThemeColorTokens();
  }

  function getDirectoryColorTokens() {
    return getAppearanceBaseColorTokens();
  }

  function applyDirectoryColorVars(root) {
    if (!root || !root.style) return;
    const colors = getDirectoryColorTokens();

    root.style.setProperty('--quick-add-special-temp-color', colors.specialTemp);
    root.style.setProperty('--quick-add-permanent-color', colors.permanent);
    root.style.setProperty('--quick-add-blank-color', colors.blank);
    root.style.setProperty('--quick-add-card-group-color', colors.cardGroup);

    root.style.setProperty('--canvas-dir-color-permanent', colors.permanent);
    root.style.setProperty('--canvas-dir-color-temp', colors.temp);
    root.style.setProperty('--canvas-dir-color-special-temp', colors.specialTemp);
    root.style.setProperty('--canvas-dir-color-blank', colors.blank);
    root.style.setProperty('--canvas-dir-color-card-group', colors.cardGroup);
    root.style.setProperty('--canvas-dir-color-edge', colors.edge);
    root.style.setProperty('--canvas-dir-color-pinned', colors.pinned);
  }

  function readPermanentCopies() {
    const shellCopies = getPermanentCopyShells();
    if (shellCopies.length) {
      return shellCopies.map((shell) => ({
        id: normalizeText(shell.copyId),
        displayIndex: toPositiveInt(shell.displayIndex),
        left: shell.cardState && shell.cardState.left,
        top: shell.cardState && shell.cardState.top,
        width: shell.cardState && shell.cardState.width,
        height: shell.cardState && shell.cardState.height,
        descriptionMd: shell.descriptionMd || ''
      })).filter((copy) => copy.id);
    }

    let list = [];
    try {
      const raw = localStorage.getItem(PERMANENT_COPIES_STORAGE_KEY);
      const parsed = parseJSON(raw, []);
      list = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
      list = [];
    }

    list.sort((a, b) => {
      const ai = toPositiveInt(a && a.displayIndex);
      const bi = toPositiveInt(b && b.displayIndex);
      if (ai && bi && ai !== bi) return ai - bi;
      if (ai && !bi) return -1;
      if (!ai && bi) return 1;
      const at = toPositiveInt(a && a.createdAt);
      const bt = toPositiveInt(b && b.createdAt);
      if (at && bt && at !== bt) return at - bt;
      return compareText(a && a.id, b && b.id);
    });
    return list;
  }

  function getPermanentDescription(copyId = null) {
    const safeCopyId = normalizeText(copyId);
    const shell = safeCopyId
      ? getPermanentCopyShells().find((view) => normalizeText(view && view.copyId) === safeCopyId)
      : getPermanentMainShell();
    if (shell && typeof shell.descriptionMd === 'string') {
      return toPreviewText(shell.descriptionMd);
    }
    const key = safeCopyId ? `${PERMANENT_COPY_TIP_STORAGE_PREFIX}${safeCopyId}` : PERMANENT_MAIN_TIP_STORAGE_KEY;
    try { return toPreviewText(localStorage.getItem(key) || ''); } catch (_) { return ''; }
  }

  function getPermanentCopyDisplayIndex(copy, orderIndex) {
    return toPositiveInt(copy && copy.displayIndex) || (orderIndex + 1);
  }

  function getPermanentCopyTitle(copy, orderIndex) {
    const displayIndex = getPermanentCopyDisplayIndex(copy, orderIndex);
    const badge = toAlphaLabel(displayIndex + 1);
    const title = t('副本', 'Copy');
    return squeezeSpaces(`#${badge} ${title}`);
  }

  function readPermanentCopiesFromStorage(storage) {
    if (!storage || typeof storage !== 'object') return [];
    const raw = storage[PERMANENT_COPIES_STORAGE_KEY];
    const parsed = Array.isArray(raw)
      ? raw
      : (typeof raw === 'string' ? parseJSON(raw, []) : []);
    const list = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    list.sort((a, b) => {
      const ai = toPositiveInt(a && a.displayIndex);
      const bi = toPositiveInt(b && b.displayIndex);
      if (ai && bi && ai !== bi) return ai - bi;
      if (ai && !bi) return -1;
      if (!ai && bi) return 1;
      const at = toPositiveInt(a && a.createdAt);
      const bt = toPositiveInt(b && b.createdAt);
      if (at && bt && at !== bt) return at - bt;
      return compareText(a && a.id, b && b.id);
    });
    return list;
  }

  function hasPermanentMainInCanvasStorage(storage) {
    if (!storage || typeof storage !== 'object') return false;
    const raw = storage[BCS_CANVAS_KEY];
    const parsed = raw && typeof raw === 'object'
      ? raw
      : (typeof raw === 'string' ? parseJSON(raw, null) : null);
    const nodes = parsed && Array.isArray(parsed.nodes) ? parsed.nodes : [];
    return nodes.some((node) => node && String(node.id || '').trim() === 'permanent-section');
  }

  function buildPreviewSnapshotSectionsFromStorage(storage) {
    if (!storage || typeof storage !== 'object') return [];

    const hasOriginal = hasPermanentMainInCanvasStorage(storage);
    const copies = readPermanentCopiesFromStorage(storage);
    if (!hasOriginal && !copies.length) return [];

    const sections = [];
    const baseTitle = t('[快照] 永久栏目', '[Snapshot] Permanent Sections');

    if (hasOriginal) {
      sections.push({
        id: 'preview-permanent-section-original',
        title: `${baseTitle} (#A)`,
        label: '#A',
        isSnapshot: true,
        color: DIRECTORY_COLOR_DEFAULTS.permanent
      });
    }

    copies.forEach((copy, orderIndex) => {
      const displayIndex = getPermanentCopyDisplayIndex(copy, orderIndex);
      const badge = `#${toAlphaLabel(displayIndex + 1)}`;
      sections.push({
        id: `preview-permanent-section-copy-${displayIndex}`,
        title: `${baseTitle} (${badge})`,
        label: badge,
        isSnapshot: true,
        color: DIRECTORY_COLOR_DEFAULTS.permanent
      });
    });

    return sections;
  }

  function getTempSectionLabel(section) {
    if (!section) return '';
    const explicit = normalizeText(section.label);
    return explicit || 'unknown';
  }

  function getTempSplitDepth(label) {
    const normalized = normalizeText(label);
    if (!normalized) return 0;
    const parts = normalized.split('-').map(part => part.trim()).filter(Boolean);
    if (parts.length <= 2) return 0;
    return Math.max(0, parts.length - 2);
  }

  function isSpecialTempSection(section) {
    if (!section) return false;
    if (section.isSnapshot || section.isSpecial) return true;
    const tempKindRaw = normalizeText(section.tempKind).toLowerCase();
    if (tempKindRaw === 'special') return true;
    if (tempKindRaw === 'regular') return false;

    const sourceRaw = normalizeText(section.source).toLowerCase();
    if (sourceRaw && (SPECIAL_TEMP_SOURCE_SET.has(sourceRaw) || sourceRaw === 'special')) return true;

    const labelRaw = normalizeText(section.label);
    if (!labelRaw) return false;
    if (labelRaw.includes('✦')) return true;
    if (labelRaw === '拖入' || labelRaw === '搜索' || labelRaw === '批量' || labelRaw === '添加' || labelRaw === '导入文件' || labelRaw === '导入') return true;

    const label = labelRaw.toLowerCase();
    return label === 'drop' || label === 'search' || label === 'batch' || label === 'add' || label === 'import file' || label === 'import';
  }

  function __sidebarRectOf(node) {
    if (!node) return null;
    const x = Number(node.x);
    const y = Number(node.y);
    const w = Number(node.width);
    const h = Number(node.height);
    if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
    return { x, y, w, h };
  }

  function getRectCenter(rect) {
    if (!rect) return null;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const w = Number(rect.w);
    const h = Number(rect.h);
    if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
    return {
      x: x + (w / 2),
      y: y + (h / 2)
    };
  }

  function readCanvasElementRect(element) {
    if (!element || !element.style) return null;
    const x = Number.parseFloat(element.style.left);
    const y = Number.parseFloat(element.style.top);
    const w = Number.parseFloat(element.style.width);
    const h = Number.parseFloat(element.style.height);
    if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
    return { x, y, w, h };
  }

  function rectFromPermanentCopy(copy) {
    if (!copy || typeof copy !== 'object') return null;
    const cardState = (copy.cardState && typeof copy.cardState === 'object') ? copy.cardState : copy;
    const x = Number.parseFloat(cardState.left != null ? cardState.left : cardState.x);
    const y = Number.parseFloat(cardState.top != null ? cardState.top : cardState.y);
    const w = Number.parseFloat(cardState.width != null ? cardState.width : cardState.w);
    const h = Number.parseFloat(cardState.height != null ? cardState.height : cardState.h);
    if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
    return { x, y, w, h };
  }

  function makeTempSectionTarget(section) {
    const sectionId = normalizeText(section && section.id);
    if (!sectionId) return null;
    return {
      kind: 'temp-section',
      sectionId,
      rect: __sidebarRectOf(section)
    };
  }

  function makeMdNodeTarget(node, extras = {}) {
    const nodeId = normalizeText(node && node.id);
    if (!nodeId) return null;
    return {
      kind: 'md-node',
      nodeId,
      subtype: normalizeText(node && node.subtype),
      rect: __sidebarRectOf(node),
      ...extras
    };
  }

  function makeCardGroupTarget(node, title) {
    return makeMdNodeTarget(node, {
      subtype: 'card-group',
      title: normalizeText(title)
    });
  }

  function makePermanentMainTarget(rect = null) {
    return {
      kind: 'permanent-main',
      rect: rect || null
    };
  }

  function makePermanentCopyTarget(copy) {
    const copyId = normalizeText(copy && copy.id);
    if (!copyId) return null;
    return {
      kind: 'permanent-copy',
      copyId,
      rect: rectFromPermanentCopy(copy)
    };
  }

  function makeEdgeTarget(edge, rect = null) {
    const edgeId = normalizeText(edge && edge.id);
    const fromNode = normalizeText(edge && edge.fromNode);
    const toNode = normalizeText(edge && edge.toNode);
    return {
      kind: 'edge',
      edgeId,
      fromNode,
      toNode,
      rect: rect || null
    };
  }

  function __sidebarRectFullyInside(inner, outer, margin) {
    if (!inner || !outer) return false;
    const m = (typeof margin === 'number' && isFinite(margin)) ? margin : 0;
    if (typeof __rectFullyInside === 'function') {
      try { return __rectFullyInside(inner, outer, m); } catch (_) { }
    }
    return (
      inner.x >= outer.x + m &&
      inner.y >= outer.y + m &&
      inner.x + inner.w <= outer.x + outer.w - m &&
      inner.y + inner.h <= outer.y + outer.h - m
    );
  }

  function getTempSectionTitle(section) {
    const title = normalizeText(section && section.title);
    if (title) return title;
    return t('未命名栏目', 'Untitled section');
  }

  function getTempSectionDisplayText(section, options = {}) {
    const label = getTempSectionLabel(section);
    const title = getTempSectionTitle(section);
    return squeezeSpaces(`${label} ${title}`.trim());
  }

  function getTempSectionDescription(section) {
    return toPreviewText(section && section.description);
  }

  function clampCardTitle(title, limit = 30) {
    if (!title) return '';
    if (title.length <= limit) return title;
    return title.slice(0, limit) + '...';
  }

  function resolveTempSectionThemeColor(section, colorTokens) {
    const tokens = colorTokens || getAppearanceBaseColorTokens();
    const live = normalizeHexColor(section && section.color, null);
    if (live) return live;
    return isSpecialTempSection(section) ? tokens.specialTemp : tokens.temp;
  }

  function resolveMdNodeThemeColor(node, colorTokens) {
    const tokens = colorTokens || getAppearanceBaseColorTokens();
    if (node && node.subtype === 'card-group') {
      return tokens.cardGroup || tokens.blank;
    }
    const live = resolveNodeCustomColor(node);
    if (live) return live;
    return tokens.blank;
  }

  function isFullscreenHistoryDescriptorValid(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return false;

    const type = normalizeText(descriptor.type);
    if (type === 'permanent') {
      return true;
    }

    if (type === 'permanent-copy') {
      const copyId = normalizeText(descriptor.copyId);
      if (!copyId) return false;
      const copies = readPermanentCopies();
      return copies.some((copy) => normalizeText(copy && copy.id) === copyId);
    }

    const state = getCanvasState();
    const tempSections = Array.isArray(state && state.tempSections) ? state.tempSections.filter(Boolean) : [];
    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes.filter(Boolean) : [];

    if (type === 'temp-node') {
      const sectionId = normalizeText(descriptor.id);
      if (!sectionId) return false;
      return tempSections.some((section) => section && normalizeText(section.id) === sectionId);
    }

    if (type === 'md-node') {
      const nodeId = normalizeText(descriptor.id);
      if (!nodeId) return false;
      return mdNodes.some((node) => node && normalizeText(node.id) === nodeId);
    }

    if (type === 'node') {
      const nodeId = normalizeText(descriptor.id);
      if (!nodeId) return false;
      if (tempSections.some((section) => section && normalizeText(section.id) === nodeId)) return true;
      if (mdNodes.some((node) => node && normalizeText(node.id) === nodeId)) return true;
      try {
        return !!document.getElementById(nodeId);
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  function resolveFullscreenHistoryCardPresentation(descriptor) {
    const fallback = {
      badge: '',
      title: '--',
      color: DIRECTORY_COLOR_DEFAULTS.blank,
      tooltip: '--'
    };
    if (!descriptor || typeof descriptor !== 'object') return fallback;

    const colorTokens = getAppearanceBaseColorTokens();
    const state = getCanvasState();
    const tempSections = Array.isArray(state && state.tempSections) ? state.tempSections.filter(Boolean) : [];
    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes.filter(Boolean) : [];

    if (descriptor.type === 'permanent') {
      const badge = '#A';
      const title = t('主体', 'Main');
      return {
        badge,
        title,
        color: colorTokens.permanent,
        tooltip: squeezeSpaces(`${badge} ${title}`)
      };
    }

    if (descriptor.type === 'permanent-copy') {
      const copyId = normalizeText(descriptor.copyId);
      const copies = readPermanentCopies();
      const orderIndex = copies.findIndex((copy) => normalizeText(copy && copy.id) === copyId);
      const copy = orderIndex >= 0 ? copies[orderIndex] : { id: copyId };
      const fullTitle = getPermanentCopyTitle(copy, Math.max(0, orderIndex));
      const matched = String(fullTitle || '').match(/^(#[A-Z]+)\s+(.+)$/);
      const badge = matched ? matched[1] : '';
      const title = matched ? matched[2] : (fullTitle || t('副本', 'Copy'));
      return {
        badge,
        title,
        color: colorTokens.permanent,
        tooltip: squeezeSpaces(fullTitle || `${badge} ${title}`.trim())
      };
    }

    if (descriptor.type === 'temp-node') {
      const sectionId = normalizeText(descriptor.id);
      const section = sectionId
        ? tempSections.find((item) => item && normalizeText(item.id) === sectionId)
        : null;
      if (!section) {
        return {
          badge: '',
          title: t('临时栏目', 'Temp section'),
          color: colorTokens.temp,
          tooltip: t('临时栏目', 'Temp section')
        };
      }

      let badge = getTempSectionLabel(section);
      if (isSpecialTempSection(section)) {
        badge = badge ? `✦ ${badge}` : '✦';
      }
      const title = getTempSectionTitle(section);
      return {
        badge,
        title,
        color: resolveTempSectionThemeColor(section, colorTokens),
        tooltip: getTempSectionDisplayText(section)
      };
    }

    if (descriptor.type === 'md-node') {
      const nodeId = normalizeText(descriptor.id);
      const node = nodeId
        ? mdNodes.find((item) => item && normalizeText(item.id) === nodeId)
        : null;
      const title = getMdNodeTitle(node);
      const isCardGroup = !!(node && node.subtype === 'card-group');
      return {
        badge: '',
        badgeIconText: isCardGroup ? '' : 'md',
        badgeIconTone: isCardGroup ? '' : 'md',
        title,
        color: resolveMdNodeThemeColor(node, colorTokens),
        tooltip: title
      };
    }

    return fallback;
  }

  function getMdNodeTitle(node) {
    if (!node) return '--';
    const mainText = (typeof node.title === 'string' && node.title.trim()) ? node.title.trim() : (node.markdownSource || node.text || node.html || '');
    const bySourceLine = normalizeMdNodeTitleLine(getFirstLineText(mainText));
    if (bySourceLine) return bySourceLine;
    return '--';
  }

  function sortTempSections(a, b) {
    const aSpecial = isSpecialTempSection(a);
    const bSpecial = isSpecialTempSection(b);
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
    const nameA = getTempSectionDisplayText(a);
    const nameB = getTempSectionDisplayText(b);
    const cmp = compareText(nameA, nameB);
    if (cmp !== 0) return cmp;
    return compareText(a && a.id, b && b.id);
  }

  function buildNodeTitleLookup(tempSections, mdNodes, copies) {
    const map = new Map();
    map.set('permanentSection', t('永久栏目', 'Permanent section'));
    map.set('permanent-section', t('永久栏目', 'Permanent section'));

    tempSections.forEach((section) => {
      if (!section || !section.id) return;
      map.set(String(section.id), getTempSectionDisplayText(section));
    });

    mdNodes.forEach((node) => {
      if (!node || !node.id) return;
      map.set(String(node.id), getMdNodeTitle(node));
    });

    const copyTitleByCopyId = new Map();
    copies.forEach((copy, idx) => {
      const copyId = normalizeText(copy && copy.id);
      if (!copyId) return;
      copyTitleByCopyId.set(copyId, getPermanentCopyTitle(copy, idx));
      map.set(`permanent-section-copy-${copyId}`, getPermanentCopyTitle(copy, idx));
    });

    document.querySelectorAll('.permanent-bookmark-section.permanent-section-copy').forEach((sectionEl, domIndex) => {
      if (!sectionEl || !sectionEl.dataset) return;
      const copyId = normalizeText(sectionEl.dataset.permanentSectionCopyId);
      if (!copyId) return;
      const titleEl = sectionEl.querySelector('.permanent-section-title h3');
      const domTitle = normalizeText(titleEl && titleEl.textContent);
      const fallbackTitle = copyTitleByCopyId.get(copyId) || getPermanentCopyTitle({ id: copyId }, domIndex);
      const resolvedTitle = domTitle || fallbackTitle;

      if (sectionEl.id) {
        map.set(String(sectionEl.id), resolvedTitle);
      }
      map.set(`permanent-section-copy-${copyId}`, resolvedTitle);
    });

    return map;
  }

  function getLookupNodeTitle(nodeId, titleMap) {
    const key = normalizeText(nodeId);
    if (!key) return '';
    if (titleMap.has(key)) return titleMap.get(key);
    return key;
  }

  function makeFolderNode(config) {
    return {
      type: 'folder',
      key: config.key,
      code: config.code,
      title: config.title,
      icon: config.icon,
      iconText: config.iconText || '',
      iconTone: config.iconTone || '',
      variant: config.variant || '',
      showIcon: config.showIcon !== false,
      showFoldControl: config.showFoldControl === true,
      count: config.count,
      color: config.color || '',
      defaultColor: config.defaultColor || '',
      preview: config.preview || '',
      target: config.target || null,
      deleteAction: config.deleteAction || null,
      showDeleteControl: config.showDeleteControl === true,
      open: config.open !== false,
      children: Array.isArray(config.children) ? config.children : []
    };
  }

  function makeItemNode(config) {
    return {
      type: 'item',
      key: config.key,
      code: config.code,
      title: config.title,
      icon: config.icon,
      iconText: config.iconText || '',
      iconTone: config.iconTone || '',
      variant: config.variant || '',
      showIcon: config.showIcon === true,
      color: config.color || '',
      defaultColor: config.defaultColor || '',
      preview: config.preview || '',
      deleteAction: config.deleteAction || null,
      showDeleteControl: config.showDeleteControl === true,
      target: config.target || null,
      placeholder: !!config.placeholder
    };
  }

  function buildFlatTempSectionNodes(tempSections, options = {}) {
    const resolveColor = typeof options.resolveColor === 'function'
      ? options.resolveColor
      : (() => options.fallbackColor || '');
    const defaultColor = options.defaultColor || options.fallbackColor || '';
    const keyPrefix = (typeof options.keyPrefix === 'string' && options.keyPrefix)
      ? options.keyPrefix
      : 'temp-split-';
    return (Array.isArray(tempSections) ? tempSections : []).map((section) => {
      const target = makeTempSectionTarget(section);
      const preview = getTempSectionDescription(section);
      const title = getTempSectionDisplayText(section);
      const key = `${keyPrefix}${section.id}`;
      return makeItemNode({
        key,
        code: '',
        title,
        color: resolveColor(section),
        defaultColor,
        icon: options.icon || (options.iconText ? 'fas fa-star' : 'fas fa-sitemap'),
        iconText: options.iconText || '',
        iconTone: options.iconTone || '',
        variant: options.variant || 'chain-item',
        showIcon: false,
        showDeleteControl: true,
        deleteAction: {
          kind: 'temp-section',
          sectionId: section.id,
          scopeOptions: false
        },
        target,
        preview
      });
    });
  }

  function getRegularTempSectionLetterBucket(section) {
    const label = normalizeText(getTempSectionLabel(section));
    const match = label.match(/^([A-Za-z]+)(?:-\d+)+$/);
    return match ? String(match[1] || '').toUpperCase() : '';
  }

  function buildRegularTempSectionBucketNodes(sections, options = {}) {
    const keyPrefix = (typeof options.keyPrefix === 'string' && options.keyPrefix)
      ? options.keyPrefix
      : 'temp-split-';
    const buckets = new Map();

    (Array.isArray(sections) ? sections : []).forEach((section) => {
      const bucket = getRegularTempSectionLetterBucket(section) || 'other';
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(section);
    });

    return Array.from(buckets.entries())
      .sort(([left], [right]) => {
        if (left === 'other') return 1;
        if (right === 'other') return -1;
        return compareText(left, right);
      })
      .map(([bucket, bucketSections]) => {
        const sectionIds = bucketSections.map((s) => normalizeText(s && s.id)).filter(Boolean);
        const target = sectionIds.length > 0 ? {
          kind: 'folder-cluster',
          clusterType: 'temp-sections',
          sectionIds,
          title: bucket === 'other' ? t('其他', 'Other') : bucket
        } : null;
        return makeFolderNode({
          key: `${keyPrefix}bucket-${bucket}`,
          code: '',
          title: bucket === 'other' ? t('其他', 'Other') : bucket,
          color: options.color || '',
          defaultColor: options.defaultColor || options.color || '',
          icon: 'fas fa-folder',
          variant: 'temp-letter-bucket',
          showFoldControl: true,
          open: false,
          count: bucketSections.length,
          target,
          children: buildFlatTempSectionNodes(bucketSections, {
            resolveColor: options.resolveColor,
            fallbackColor: options.color || '',
            defaultColor: options.defaultColor || options.color || '',
            keyPrefix: `${keyPrefix}${bucket}-`,
            icon: options.icon || 'fas fa-sitemap',
            variant: 'chain-item'
          })
        });
      });
  }

  function makePlaceholderItem(key, code, title, options = {}) {
    return makeItemNode({
      key,
      code,
      title,
      icon: options.icon || 'fas fa-minus',
      iconText: options.iconText || '',
      iconTone: options.iconTone || '',
      variant: options.variant || '',
      color: options.color || '',
      defaultColor: options.defaultColor || options.color || '',
      placeholder: true,
      target: null,
      preview: ''
    });
  }

  function getPinyinInitial(char) {
    if (!char || char.charCodeAt(0) < 128) return null;
    const c = char.charAt(0);
    const BOUNDARIES = [
      { initial: 'A', char: '啊' },
      { initial: 'B', char: '芭' },
      { initial: 'C', char: '擦' },
      { initial: 'D', char: '搭' },
      { initial: 'E', char: '蛾' },
      { initial: 'F', char: '发' },
      { initial: 'G', char: '噶' },
      { initial: 'H', char: '哈' },
      { initial: 'J', char: '击' },
      { initial: 'K', char: '喀' },
      { initial: 'L', char: '垃圾' },
      { initial: 'M', char: '妈' },
      { initial: 'N', char: '拿' },
      { initial: 'O', char: '哦' },
      { initial: 'P', char: '啪' },
      { initial: 'Q', char: '期' },
      { initial: 'R', char: '然' },
      { initial: 'S', char: '撒' },
      { initial: 'T', char: '塌' },
      { initial: 'W', char: '挖' },
      { initial: 'X', char: '昔' },
      { initial: 'Y', char: '压' },
      { initial: 'Z', char: '匝' }
    ];
    let resolved = null;
    for (let i = 0; i < BOUNDARIES.length; i++) {
      const nextBoundary = BOUNDARIES[i + 1];
      const currentMatches = c.localeCompare(BOUNDARIES[i].char, 'zh') >= 0;
      const beforeNext = !nextBoundary || c.localeCompare(nextBoundary.char, 'zh') < 0;
      if (currentMatches && beforeNext) {
        resolved = BOUNDARIES[i].initial;
        break;
      }
    }
    return resolved;
  }

  function getFirstCharCategory(text) {
    const t = String(text || '').trim();
    if (!t) return 'other';
    const first = t.charAt(0);
    if (/^[0-9]/.test(first)) {
      return '0-9';
    }
    if (/^[A-Za-z]/.test(first)) {
      return first.toUpperCase();
    }
    const pinyin = getPinyinInitial(first);
    if (pinyin) {
      return pinyin;
    }
    return 'other';
  }

  const CATEGORY_ORDER = ['0-9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'W', 'X', 'Y', 'Z', 'other'];

  function processGroupAndFold(rawNodes, parentKey, getRawTitle, mapNodeToItem, folderColor, defaultColor) {
    const groups = new Map();
    rawNodes.forEach((node) => {
      const title = getRawTitle(node);
      const cat = getFirstCharCategory(title);
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat).push(node);
    });

    const folderNodes = [];
    const flatNodes = [];
    let globalIndex = 0;
    const allCats = CATEGORY_ORDER.slice();
    groups.forEach((_, cat) => {
      if (!allCats.includes(cat)) {
        allCats.push(cat);
      }
    });

    allCats.forEach((cat) => {
      if (!groups.has(cat)) return;
      const groupNodes = groups.get(cat);
      const threshold = (cat === '0-9') ? 10 : 5;

      if (groupNodes.length >= threshold) {
        const folderItems = groupNodes.map((node, idx) => mapNodeToItem(node, idx));
        const nodeIds = groupNodes.map((n) => normalizeText(n && n.id)).filter(Boolean);
        const folderTitle = cat === 'other' ? t('其他', 'Other') : cat;
        const target = nodeIds.length > 0 ? {
          kind: 'folder-cluster',
          clusterType: 'nodes',
          nodeIds,
          title: folderTitle
        } : null;
        folderNodes.push(makeFolderNode({
          key: `${parentKey}-cat-${cat}`,
          code: '',
          title: folderTitle,
          color: folderColor,
          defaultColor,
          icon: 'fas fa-folder',
          open: false,
          count: groupNodes.length,
          target,
          children: folderItems
        }));
      } else {
        groupNodes.forEach((node) => {
          flatNodes.push(mapNodeToItem(node, globalIndex++));
        });
      }
    });

    return folderNodes.concat(flatNodes);
  }

  function buildDirectoryData(options = {}) {
    const state = (options && options.state && typeof options.state === 'object')
      ? options.state
      : getCanvasState();
    const tempSections = Array.isArray(state && state.tempSections) ? state.tempSections.filter(Boolean) : [];
    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes.filter(Boolean) : [];
    const edges = Array.isArray(state && state.edges) ? state.edges.filter(Boolean) : [];
    const copies = (options && Array.isArray(options.copies)) ? options.copies : readPermanentCopies();
    const enableGroupDelete = !(options && options.enableGroupDelete === false);
    const colorTokens = getAppearanceBaseColorTokens();
    const locatableThemeTokens = getAppearanceThemeColorTokens();
    const syncFlags = getDirectoryColorSyncFlags();
    const defaultColorSync = !!syncFlags.defaultColorSync;
    const locatableColorSync = !!syncFlags.locatableColorSync;
    const tempSectionById = new Map();
    tempSections.forEach((section) => {
      const sectionId = normalizeText(section && section.id);
      if (!sectionId) return;
      tempSectionById.set(sectionId, section);
    });
    const mdNodeById = new Map();
    mdNodes.forEach((node) => {
      const nodeId = normalizeText(node && node.id);
      if (!nodeId) return;
      mdNodeById.set(nodeId, node);
    });
    const edgeById = new Map();
    edges.forEach((edge) => {
      const edgeId = normalizeText(edge && edge.id);
      if (!edgeId) return;
      edgeById.set(edgeId, edge);
    });

    const getLocatableThemeColorByTarget = (target) => {
      if (!target || typeof target !== 'object') return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
      const kind = normalizeText(target.kind);
      if (kind === 'permanent-main' || kind === 'permanent-copy') {
        return locatableThemeTokens.permanent;
      }
      if (kind === 'temp-section') {
        const sectionId = normalizeText(target.sectionId);
        const section = sectionId ? tempSectionById.get(sectionId) : null;
        return isSpecialTempSection(section) ? locatableThemeTokens.specialTemp : locatableThemeTokens.temp;
      }
      if (kind === 'md-node') {
        const nodeId = normalizeText(target.nodeId);
        const node = nodeId ? mdNodeById.get(nodeId) : null;
        if (node && node.subtype === 'card-group') {
          return locatableThemeTokens.cardGroup || locatableThemeTokens.blank;
        }
        return locatableThemeTokens.blank;
      }
      if (kind === 'edge') return locatableThemeTokens.edge;
      return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
    };

    const getLocatableLiveColorByTarget = (target) => {
      if (!target || typeof target !== 'object') return null;
      const kind = normalizeText(target.kind);
      if (kind === 'temp-section') {
        const sectionId = normalizeText(target.sectionId);
        const section = sectionId ? tempSectionById.get(sectionId) : null;
        return normalizeHexColor(section && section.color, null);
      }
      if (kind === 'md-node') {
        const nodeId = normalizeText(target.nodeId);
        const node = nodeId ? mdNodeById.get(nodeId) : null;
        return resolveNodeCustomColor(node);
      }
      if (kind === 'edge') {
        const edgeId = normalizeText(target.edgeId);
        const edge = edgeId ? edgeById.get(edgeId) : null;
        return resolveNodeCustomColor(edge);
      }
      return null;
    };

    const applyDirectoryColorControl = (nodes) => {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        const isClusterFolder = !!(node.target && node.target.kind === 'folder-cluster');
        const isLocatableNode = !!node.target && !node.placeholder && !isClusterFolder;

        if (isLocatableNode) {
          const themeColor = getLocatableThemeColorByTarget(node.target);
          if (!locatableColorSync) {
            node.color = DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
            node.defaultColor = DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
          } else {
            const liveColor = getLocatableLiveColorByTarget(node.target);
            node.color = liveColor || themeColor;
            node.defaultColor = themeColor;
          }
        } else if (!defaultColorSync) {
          node.color = DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
          node.defaultColor = DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
        }

        if (Array.isArray(node.children) && node.children.length) {
          node.children.forEach(walk);
        }
      };

      if (!Array.isArray(nodes)) return nodes;
      nodes.forEach(walk);
      return nodes;
    };

    const resolveTempSectionColor = (section) => {
      if (!locatableColorSync) return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
      const live = normalizeHexColor(section && section.color, null);
      if (live) return live;
      return isSpecialTempSection(section) ? locatableThemeTokens.specialTemp : locatableThemeTokens.temp;
    };

    const resolveMdNodeColor = (node) => {
      if (!locatableColorSync) return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
      const live = resolveNodeCustomColor(node);
      if (live) return live;
      return locatableThemeTokens.blank;
    };

    const resolveEdgeColor = (edge) => {
      if (!locatableColorSync) return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
      const live = resolveNodeCustomColor(edge);
      if (live) return live;
      return locatableThemeTokens.edge;
    };

    const buildTemporaryFolder = (sections, config = {}) => {
      const keyPrefix = config.itemKeyPrefix || '';
      const folderKey = config.folderKey || 'folder-temporary';
      const splitFolderKey = config.splitFolderKey || `${folderKey}-split`;
      const specialFolderKey = config.specialFolderKey || `${folderKey}-special`;
      const sectionColorResolver = (typeof config.sectionColorResolver === 'function')
        ? config.sectionColorResolver
        : resolveTempSectionColor;
      const tempColor = config.folderColor || colorTokens.temp;
      const splitColor = config.splitColor || tempColor;
      const specialColor = config.specialColor || colorTokens.specialTemp;
      const specialIconText = ('specialIconText' in config) ? config.specialIconText : '✦';
      const specialIconTone = ('specialIconTone' in config) ? config.specialIconTone : 'special';
      const folderIcon = config.folderIcon || 'fas fa-project-diagram';
      const splitFolderIcon = config.splitFolderIcon || 'fas fa-sitemap';
      const specialFolderIcon = config.specialFolderIcon || 'fas fa-star';

      const specialTempSections = sections.filter((section) => section && isSpecialTempSection(section));
      const splitTempSections = sections.filter((section) => section && !isSpecialTempSection(section));

      splitTempSections.sort(sortTempSections);
      specialTempSections.sort(sortTempSections);

      const splitItems = buildRegularTempSectionBucketNodes(splitTempSections, {
        resolveColor: sectionColorResolver,
        color: splitColor,
        defaultColor: splitColor,
        keyPrefix: `${keyPrefix}temp-split-`,
        icon: splitFolderIcon
      });

      if (!splitItems.length) {
        splitItems.push(makePlaceholderItem(
          config.splitEmptyKey || `${keyPrefix}temp-split-empty`,
          '',
          t('暂无分裂栏目', 'No split sections'),
          {
            color: splitColor,
            defaultColor: splitColor,
            icon: splitFolderIcon
          }
        ));
      }

      const specialItems = buildFlatTempSectionNodes(specialTempSections, {
        resolveColor: sectionColorResolver,
        fallbackColor: specialColor,
        defaultColor: specialColor,
        keyPrefix: `${keyPrefix}temp-special-`,
        icon: specialFolderIcon,
        iconText: specialIconText,
        iconTone: specialIconTone,
        variant: 'special-temp'
      });

      if (!specialItems.length) {
        specialItems.push(makePlaceholderItem(
          config.specialEmptyKey || `${keyPrefix}temp-special-empty`,
          '',
          t('暂无特殊栏目', 'No special sections'),
          {
            iconText: specialIconText,
            iconTone: specialIconTone,
            color: specialColor,
            defaultColor: specialColor
          }
        ));
      }

      return makeFolderNode({
        key: folderKey,
        code: '',
        title: config.title || t('临时栏目', 'Temporary'),
        color: tempColor,
        defaultColor: tempColor,
        icon: folderIcon,
        open: config.open !== false,
        count: typeof config.count === 'number' ? config.count : sections.length,
        target: sections.length > 0 ? {
          kind: 'folder-cluster',
          clusterType: 'temp-sections',
          sectionIds: sections.map((s) => normalizeText(s && s.id)).filter(Boolean),
          title: config.title || t('临时栏目', 'Temporary')
        } : null,
        children: [
          makeFolderNode({
            key: splitFolderKey,
            code: '',
            title: t('常规链式', 'General Chain'),
            color: splitColor,
            defaultColor: splitColor,
            icon: splitFolderIcon,
            open: false,
            count: splitTempSections.length,
            target: splitTempSections.length > 0 ? {
              kind: 'folder-cluster',
              clusterType: 'temp-sections',
              sectionIds: splitTempSections.map((s) => normalizeText(s && s.id)).filter(Boolean),
              title: t('常规链式', 'General Chain')
            } : null,
            children: splitItems
          }),
          makeFolderNode({
            key: specialFolderKey,
            code: '',
            title: t('特殊临时栏目', 'Special temporary'),
            color: specialColor,
            defaultColor: specialColor,
            icon: specialFolderIcon,
            iconText: specialIconText,
            iconTone: specialIconTone,
            open: false,
            count: specialTempSections.length,
            target: specialTempSections.length > 0 ? {
              kind: 'folder-cluster',
              clusterType: 'temp-sections',
              sectionIds: specialTempSections.map((s) => normalizeText(s && s.id)).filter(Boolean),
              title: t('特殊临时栏目', 'Special temporary')
            } : null,
            children: specialItems
          })
        ]
      });
    };

    const buildBlankFolder = (nodes, config = {}) => {
      const keyPrefix = config.itemKeyPrefix || '';
      const nodeColorResolver = (typeof config.nodeColorResolver === 'function')
        ? config.nodeColorResolver
        : resolveMdNodeColor;
      const folderColor = config.folderColor || colorTokens.blank;
      const defaultColor = config.defaultColor || folderColor;
      const iconText = ('iconText' in config) ? config.iconText : 'md';
      const iconTone = ('iconTone' in config) ? config.iconTone : 'md';
      const variant = config.variant || 'blank';
      const folderIcon = config.folderIcon || 'fas fa-sticky-note';
      const itemIcon = config.itemIcon || 'fas fa-file-alt';
      const sortedMdNodes = [...nodes].sort((a, b) => {
        const titleA = getMdNodeTitle(a);
        const titleB = getMdNodeTitle(b);
        const cmp = compareText(titleA, titleB);
        if (cmp !== 0) return cmp;
        const at = toPositiveInt(a && a.createdAt);
        const bt = toPositiveInt(b && b.createdAt);
        if (at && bt && at !== bt) return at - bt;
        if (at && !bt) return -1;
        if (!at && bt) return 1;
        return compareText(a && a.id, b && b.id);
      });

      const buildBlankItems = (list) => {
        return processGroupAndFold(
          list,
          config.folderKey || 'folder-blank',
          (node) => getMdNodeTitle(node),
          (node, index) => makeItemNode({
            key: `${keyPrefix}blank-${node.id}`,
            code: '',
            title: `${index + 1}. ${clampCardTitle(getMdNodeTitle(node), 30)}`,
            color: nodeColorResolver(node),
            defaultColor,
            icon: itemIcon,
            iconText,
            iconTone,
            variant,
            showDeleteControl: true,
            deleteAction: {
              kind: 'md-node',
              nodeId: node.id,
              scopeOptions: false,
              currentTitle: t('仅删除框体', 'Delete frame only'),
              allTitle: t('删除框体及成员', 'Delete frame and members')
            },
            target: makeMdNodeTarget(node),
            preview: ''
          }),
          folderColor,
          defaultColor
        );
      };

      const directItems = buildBlankItems(sortedMdNodes);
      if (!directItems.length) {
        directItems.push(makePlaceholderItem(
          config.emptyKey || `${keyPrefix}blank-empty`,
          '',
          t('暂无空白栏目', 'No blank cards'),
          {
            iconText,
            iconTone,
            variant,
            color: folderColor,
            defaultColor
          }
        ));
      }

      return makeFolderNode({
        key: config.folderKey || 'folder-blank',
        code: '',
        title: config.title || t('空白栏目', 'Blank'),
        color: folderColor,
        defaultColor,
        icon: folderIcon,
        iconText,
        iconTone,
        variant,
        open: config.open !== false,
        count: typeof config.count === 'number' ? config.count : sortedMdNodes.length,
        target: sortedMdNodes.length > 0 ? {
          kind: 'folder-cluster',
          clusterType: 'nodes',
          nodeIds: sortedMdNodes.map((n) => normalizeText(n && n.id)).filter(Boolean),
          title: config.title || t('空白栏目', 'Blank')
        } : null,
        children: directItems
      });
    };

    const buildOtherFolder = (edgeList, titleLookup, config = {}) => {
      const keyPrefix = config.itemKeyPrefix || '';
      const edgeColorResolver = (typeof config.edgeColorResolver === 'function')
        ? config.edgeColorResolver
        : resolveEdgeColor;
      const folderColor = config.folderColor || colorTokens.edge;
      const defaultColor = config.defaultColor || folderColor;
      const folderIcon = config.folderIcon || 'fas fa-link';

      const mainChildren = [];

      if (!edgeList.length) {
        mainChildren.push(makePlaceholderItem(
          config.emptyKey || `${keyPrefix}edge-empty`,
          '',
          t('暂无连接线', 'No edges'),
          {
            color: folderColor,
            defaultColor
          }
        ));
      } else {
        const labeledEdges = [];
        const unlabeledEdges = [];
        edgeList.forEach((edge) => {
          if (normalizeText(edge && edge.label)) {
            labeledEdges.push(edge);
          } else {
            unlabeledEdges.push(edge);
          }
        });

        // 排序
        labeledEdges.sort((a, b) => compareText(a.label, b.label));
        unlabeledEdges.sort((a, b) => {
          const titleA = getLookupNodeTitle(a.fromNode, titleLookup);
          const titleB = getLookupNodeTitle(b.fromNode, titleLookup);
          const cmp = compareText(titleA, titleB);
          if (cmp !== 0) return cmp;
          const toA = getLookupNodeTitle(a.toNode, titleLookup);
          const toB = getLookupNodeTitle(b.toNode, titleLookup);
          return compareText(toA, toB);
        });

        const buildEdgeItem = (edge, index, isLabeled) => {
          const edgeId = normalizeText(edge && edge.id);
          const fromNode = normalizeText(edge && edge.fromNode);
          const toNode = normalizeText(edge && edge.toNode);
          const fromTitle = getLookupNodeTitle(fromNode, titleLookup);
          const toTitle = getLookupNodeTitle(toNode, titleLookup);
          const label = isLabeled ? normalizeText(edge.label) : '--';
          
          const dir = edge.direction || 'none';
          let arrowSymbol = '→';
          if (dir === 'both') {
            arrowSymbol = '↔';
          } else if (dir === 'none') {
            arrowSymbol = '—';
          }

          const preview = (fromTitle || toTitle)
            ? `${fromTitle || t('未知起点', 'Unknown source')} ${arrowSymbol} ${toTitle || t('未知终点', 'Unknown target')}`
            : '';

          return makeItemNode({
            key: `${keyPrefix}edge-${isLabeled ? 'labeled' : 'unlabeled'}-${edgeId || index}`,
            code: '',
            title: `${index + 1}. ${label}`,
            color: edgeColorResolver(edge),
            defaultColor,
            icon: 'fas fa-link',
            showIcon: true,
            showDeleteControl: true,
            deleteAction: {
              kind: 'edge',
              edgeId
            },
            target: makeEdgeTarget(edge),
            preview
          });
        };

        const labeledItems = processGroupAndFold(
          labeledEdges,
          config.folderKey ? `${config.folderKey}-subfolder-labeled` : 'folder-other-labeled',
          (edge) => edge.label,
          (edge, idx) => buildEdgeItem(edge, idx, true),
          folderColor,
          defaultColor
        );
        const unlabeledItems = processGroupAndFold(
          unlabeledEdges,
          config.folderKey ? `${config.folderKey}-subfolder-unlabeled` : 'folder-other-unlabeled',
          (edge) => getLookupNodeTitle(edge.fromNode, titleLookup),
          (edge, idx) => buildEdgeItem(edge, idx, false),
          folderColor,
          defaultColor
        );

        if (!labeledItems.length) {
          labeledItems.push(makePlaceholderItem(
            `${keyPrefix}edge-labeled-empty`,
            '',
            t('暂无有标题连接线', 'No labeled edges'),
            {
              color: folderColor,
              defaultColor
            }
          ));
        }
        if (!unlabeledItems.length) {
          unlabeledItems.push(makePlaceholderItem(
            `${keyPrefix}edge-unlabeled-empty`,
            '',
            t('暂无无标题连接线', 'No untitled edges'),
            {
              color: folderColor,
              defaultColor
            }
          ));
        }

        const labeledFolder = makeFolderNode({
          key: config.folderKey ? `${config.folderKey}-subfolder-labeled` : 'folder-other-labeled',
          code: '',
          title: t('有标题', 'Labeled'),
          color: folderColor,
          defaultColor,
          icon: 'fas fa-link',
          open: false,
          count: labeledEdges.length,
          target: null,
          children: labeledItems
        });

        const unlabeledFolder = makeFolderNode({
          key: config.folderKey ? `${config.folderKey}-subfolder-unlabeled` : 'folder-other-unlabeled',
          code: '',
          title: t('无标题', 'Untitled'),
          color: folderColor,
          defaultColor,
          icon: 'fas fa-link',
          open: false,
          count: unlabeledEdges.length,
          target: null,
          children: unlabeledItems
        });

        mainChildren.push(labeledFolder, unlabeledFolder);
      }

      return makeFolderNode({
        key: config.folderKey || 'folder-other',
        code: '',
        title: config.title || t('连接线', 'Edges'),
        color: folderColor,
        defaultColor,
        icon: folderIcon,
        open: config.open !== false,
        count: edgeList.length,
        target: null,
        children: mainChildren
      });
    };

    const regularTempSections = tempSections.slice();

    const regularMdNodes = mdNodes.slice();

    const regularEdges = edges.slice();
    const permanentMainRect = getGeometricRect(null, 'permanent-main');

    const permanentChildren = [
      makeItemNode({
        key: 'permanent-main',
        code: '',
        title: t('#A 主体', '#A Main'),
        color: colorTokens.permanent,
        defaultColor: colorTokens.permanent,
        icon: 'fas fa-thumbtack',
        iconText: '#',
        iconTone: 'hash',
        target: makePermanentMainTarget(permanentMainRect),
        preview: getPermanentDescription(null)
      })
    ];

    copies.forEach((copy, index) => {
      const copyId = normalizeText(copy && copy.id);
      if (!copyId) return;
      permanentChildren.push(makeItemNode({
        key: `permanent-copy-${copyId}`,
        code: '',
        title: getPermanentCopyTitle(copy, index),
        color: colorTokens.permanent,
        defaultColor: colorTokens.permanent,
        icon: 'fas fa-copy',
        iconText: '#',
        iconTone: 'hash',
        showDeleteControl: true,
        deleteAction: {
          kind: 'permanent-copy',
          copyId
        },
        target: makePermanentCopyTarget(copy),
        preview: getPermanentDescription(copyId)
      }));
    });

    const permanentFolder = makeFolderNode({
      key: 'folder-permanent',
      code: '',
      title: t('永久栏目', 'Permanent'),
      color: colorTokens.permanent,
      defaultColor: colorTokens.permanent,
      icon: 'fas fa-layer-group',
      iconText: '#',
      iconTone: 'hash',
      count: permanentChildren.length,
      target: {
        kind: 'folder-cluster',
        clusterType: 'permanent',
        nodeIds: ['permanentSection', ...copies.map((c) => `permanent-section-copy-${c.id}`)],
        title: t('永久栏目', 'Permanent')
      },
      children: permanentChildren
    });

    const temporaryFolder = buildTemporaryFolder(regularTempSections, {
      folderKey: 'folder-temporary',
      splitFolderKey: 'folder-temp-split',
      specialFolderKey: 'folder-temp-special',
      count: regularTempSections.length,
      splitEmptyKey: 'temp-split-empty',
      specialEmptyKey: 'temp-special-empty'
    });

    const blankFolder = buildBlankFolder(regularMdNodes, {
      folderKey: 'folder-blank',
      count: regularMdNodes.length,
      emptyKey: 'blank-empty',
      open: false
    });

    const titleLookup = buildNodeTitleLookup(tempSections, mdNodes, copies);
    const otherFolder = buildOtherFolder(regularEdges, titleLookup, {
      folderKey: 'folder-other',
      emptyKey: 'edge-empty',
      open: false
    });

    function getGeometricRect(item, type) {
      if (type === 'temp-section' || type === 'md-node') {
        return __sidebarRectOf(item);
      }
      if (type === 'permanent-main') {
        const mainShell = getPermanentMainShell();
        if (mainShell && mainShell.cardState) {
          const x = Number.parseFloat(mainShell.cardState.left);
          const y = Number.parseFloat(mainShell.cardState.top);
          const w = Number.parseFloat(mainShell.cardState.width);
          const h = Number.parseFloat(mainShell.cardState.height);
          if ([x, y, w, h].every(v => Number.isFinite(v))) return { x, y, w, h };
        }
        const el = document.getElementById('permanentSection');
        if (el) {
          return {
            x: parseFloat(el.style.left) || 0,
            y: parseFloat(el.style.top) || 0,
            w: el.offsetWidth || parseFloat(el.style.width) || 0,
            h: el.offsetHeight || parseFloat(el.style.height) || 0
          };
        }
      }
      if (type === 'permanent-copy') {
        const copyId = normalizeText(item.id);
        const el = document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id="${copyId}"]`);
        if (el) {
          return {
            x: parseFloat(el.style.left) || 0,
            y: parseFloat(el.style.top) || 0,
            w: el.offsetWidth || parseFloat(el.style.width) || 0,
            h: el.offsetHeight || parseFloat(el.style.height) || 0
          };
        }
        const x = Number(item.left);
        const y = Number(item.top);
        const w = Number(item.width);
        const h = Number(item.height);
        if ([x, y, w, h].every(v => Number.isFinite(v))) return { x, y, w, h };
      }
      return null;
    }

    function getGroupGeometricChildren(group, tempSections, mdNodes, copies, edges) {
      const groupRect = getGeometricRect(group, 'md-node');
      if (!groupRect) return { tempSections: [], mdNodes: [], permanentMain: false, permanentCopies: [], edges: [] };

      const margin = (group.subtype === 'card-group') ? 0 : 12;
      const containedTempSections = [];
      const containedMdNodes = [];
      let containedPermanentMain = false;
      const containedPermanentCopies = [];
      const containedEdges = [];

      // 1. Temp sections
      tempSections.forEach((s) => {
        const r = getGeometricRect(s, 'temp-section');
        if (r && __sidebarRectFullyInside(r, groupRect, margin)) {
          containedTempSections.push(s);
        }
      });

      // 2. mdNodes (excluding group itself)
      mdNodes.forEach((n) => {
        if (!n || n.id === group.id) return;
        const r = getGeometricRect(n, 'md-node');
        if (r && __sidebarRectFullyInside(r, groupRect, margin)) {
          containedMdNodes.push(n);
        }
      });

      // 3. Permanent main
      const mainRect = getGeometricRect(null, 'permanent-main');
      if (mainRect && __sidebarRectFullyInside(mainRect, groupRect, margin)) {
        containedPermanentMain = true;
      }

      // 4. Permanent copies
      copies.forEach((copy) => {
        const r = getGeometricRect(copy, 'permanent-copy');
        if (r && __sidebarRectFullyInside(r, groupRect, margin)) {
          containedPermanentCopies.push(copy);
        }
      });

      // 5. Edges
      const containedIds = new Set();
      containedTempSections.forEach((s) => containedIds.add(normalizeText(s.id)));
      containedMdNodes.forEach((n) => containedIds.add(normalizeText(n.id)));
      if (containedPermanentMain) {
        containedIds.add('permanent-section');
        containedIds.add('permanent-main');
      }
      containedPermanentCopies.forEach((copy) => {
        containedIds.add(`permanent-section-copy-${normalizeText(copy.id)}`);
        containedIds.add(normalizeText(copy.id));
      });

      edges.forEach((edge) => {
        const fromNode = normalizeText(edge.fromNode);
        const toNode = normalizeText(edge.toNode);
        if (containedIds.has(fromNode) && containedIds.has(toNode)) {
          containedEdges.push(edge);
        }
      });

      return {
        tempSections: containedTempSections,
        mdNodes: containedMdNodes,
        permanentMain: containedPermanentMain,
        permanentCopies: containedPermanentCopies,
        edges: containedEdges
      };
    }

    function getDirectGroupChildren(group, tempSections, mdNodes, copies, edges) {
      const geo = getGroupGeometricChildren(group, tempSections, mdNodes, copies, edges);
      const groupId = normalizeText(group && group.id);
      const isDirectChild = (item, type) => getDirectParentGroupId(item, type) === groupId;
      const directTempSections = geo.tempSections.filter((section) => isDirectChild(section, 'temp-section'));
      const directMdNodes = geo.mdNodes.filter((node) => isDirectChild(node, 'md-node'));
      const directPermanentMain = geo.permanentMain && isDirectChild(null, 'permanent-main');
      const directPermanentCopies = geo.permanentCopies.filter((copy) => isDirectChild(copy, 'permanent-copy'));
      const directIds = new Set();
      directTempSections.forEach((section) => directIds.add(normalizeText(section && section.id)));
      directMdNodes.forEach((node) => directIds.add(normalizeText(node && node.id)));
      if (directPermanentMain) {
        directIds.add('permanent-section');
        directIds.add('permanent-main');
      }
      directPermanentCopies.forEach((copy) => {
        const copyId = normalizeText(copy && copy.id);
        if (!copyId) return;
        directIds.add(copyId);
        directIds.add(`permanent-section-copy-${copyId}`);
      });

      return {
        tempSections: directTempSections,
        mdNodes: directMdNodes,
        permanentMain: directPermanentMain,
        permanentCopies: directPermanentCopies,
        edges: geo.edges.filter((edge) => {
          const fromNode = normalizeText(edge && edge.fromNode);
          const toNode = normalizeText(edge && edge.toNode);
          return directIds.has(fromNode) && directIds.has(toNode);
        })
      };
    }

    function getDirectParentGroupId(item, type) {
      const itemRect = getGeometricRect(item, type);
      if (!itemRect) return '';
      const itemId = normalizeText(item && item.id);
      let parentId = '';
      let parentArea = Infinity;
      mdNodes.forEach((groupNode) => {
        if (!groupNode || groupNode.subtype !== 'card-group') return;
        const groupId = normalizeText(groupNode.id);
        if (!groupId || groupId === itemId) return;
        const groupRect = getGeometricRect(groupNode, 'md-node');
        if (!groupRect || !__sidebarRectFullyInside(itemRect, groupRect, 0)) return;
        const area = Math.max(0, Number(groupRect.w) || 0) * Math.max(0, Number(groupRect.h) || 0);
        if (area < parentArea) {
          parentArea = area;
          parentId = groupId;
        }
      });
      return parentId;
    }

    function isNodeInsideAnyGroup(node, allNodes) {
      const nodeRect = getGeometricRect(node, 'md-node');
      if (!nodeRect) return false;
      return allNodes.some((other) => {
        if (!other || other.id === node.id) return false;
        if (other.subtype !== 'card-group') return false;
        const otherRect = getGeometricRect(other, 'md-node');
        const margin = 0;
        return otherRect && __sidebarRectFullyInside(nodeRect, otherRect, margin);
      });
    }

    function buildGroupChildrenDirectoryNodes(geo, parentSafeId, visited, depth) {
      const childrenNodes = [];

      // 1. Nested card groups first: "然后内部嵌套组的优先显示在最上方"
      const nestedGroups = geo.mdNodes.filter((n) => n && n.subtype === 'card-group');
      nestedGroups.sort((a, b) => compareText(
        normalizeText(stripInlineMarkdown(stripHtml((a && a.label) || ''))),
        normalizeText(stripInlineMarkdown(stripHtml((b && b.label) || '')))
      ));

      nestedGroups.forEach((n) => {
        const childNode = buildCardGroupDirectoryNode(n, tempSections, mdNodes, copies, edges, visited, depth + 1, `group-${parentSafeId}-nested-`);
        if (childNode) {
          childrenNodes.push(childNode);
        }
      });

      // Then other elements
      const otherChildren = [];

      // 2 & 3. Permanent main + copies (folded under "Permanent Sections")
      const permSubChildren = [];
      if (geo.permanentMain) {
        permSubChildren.push(makeItemNode({
          key: `group-${parentSafeId}-perm-main`,
          code: '',
          title: t('#A 主体', '#A Main'),
          color: colorTokens.permanent,
          defaultColor: colorTokens.permanent,
          showIcon: false, // "永久栏目前面不需要图标"
          target: makePermanentMainTarget(permanentMainRect),
          preview: getPermanentDescription(null)
        }));
      }

      geo.permanentCopies.forEach((copy, idx) => {
        const copyId = normalizeText(copy && copy.id);
        if (!copyId) return;
        permSubChildren.push(makeItemNode({
          key: `group-${parentSafeId}-perm-copy-${copyId}`,
          code: '',
          title: getPermanentCopyTitle(copy, idx),
          color: colorTokens.permanent,
          defaultColor: colorTokens.permanent,
          showIcon: false, // "永久栏目前面不需要图标"
          showDeleteControl: true,
          deleteAction: {
            kind: 'permanent-copy',
            copyId
          },
          target: makePermanentCopyTarget(copy),
          preview: getPermanentDescription(copyId)
        }));
      });

      if (permSubChildren.length > 0) {
        otherChildren.push(makeFolderNode({
          key: `group-${parentSafeId}-subfolder-permanent`,
          code: '',
          title: t('永久栏目', 'Permanent'),
          icon: 'fas fa-layer-group',
          count: permSubChildren.length,
          showFoldControl: true,
          open: false,
          children: permSubChildren
        }));
      }

      // 4. Temporary sections (folded under "Temporary Sections")
      if (geo.tempSections.length > 0) {
        const groupTemporaryFolder = buildTemporaryFolder(geo.tempSections, {
          itemKeyPrefix: `group-${parentSafeId}-`,
          folderKey: `group-${parentSafeId}-subfolder-temporary`,
          splitFolderKey: `group-${parentSafeId}-subfolder-temporary-split`,
          specialFolderKey: `group-${parentSafeId}-subfolder-temporary-special`,
          count: geo.tempSections.length,
          splitEmptyKey: `group-${parentSafeId}-temp-split-empty`,
          specialEmptyKey: `group-${parentSafeId}-temp-special-empty`,
          open: false
        });
        otherChildren.push(groupTemporaryFolder);
      }

      // 5. Blank cards (folded under "Blank Cards")
      const blankSubChildren = [];
      const nonGroupMdNodes = geo.mdNodes.filter((n) => n && n.subtype !== 'card-group');
      const sortedBlankNodes = [...nonGroupMdNodes].sort((a, b) => {
        const titleA = getMdNodeTitle(a);
        const titleB = getMdNodeTitle(b);
        const cmp = compareText(titleA, titleB);
        if (cmp !== 0) return cmp;
        const at = toPositiveInt(a && a.createdAt);
        const bt = toPositiveInt(b && b.createdAt);
        if (at && bt && at !== bt) return at - bt;
        if (at && !bt) return -1;
        if (!at && bt) return 1;
        return compareText(a && a.id, b && b.id);
      });

      const groupBlankItems = processGroupAndFold(
        sortedBlankNodes,
        `group-${parentSafeId}-subfolder-blank`,
        (n) => getMdNodeTitle(n),
        (n, idx) => {
          const nodeColor = resolveMdNodeColor(n);
          return makeItemNode({
            key: `group-${parentSafeId}-blank-${n.id}`,
            code: '',
            title: `${idx + 1}. ${clampCardTitle(getMdNodeTitle(n), 30)}`,
            color: nodeColor,
            defaultColor: nodeColor,
            icon: 'fas fa-file-alt',
            iconText: 'md',
            iconTone: 'md',
            showIcon: false,
            showDeleteControl: true,
            deleteAction: {
              kind: 'md-node',
              nodeId: n.id,
              scopeOptions: false
            },
            target: makeMdNodeTarget(n),
            preview: ''
          });
        },
        colorTokens.blank,
        colorTokens.blank
      );

      if (sortedBlankNodes.length > 0) {
        otherChildren.push(makeFolderNode({
          key: `group-${parentSafeId}-subfolder-blank`,
          code: '',
          title: t('空白栏目', 'Blank Cards'),
          icon: 'fas fa-file-alt',
          iconText: 'md',
          iconTone: 'md',
          count: sortedBlankNodes.length,
          showFoldControl: true,
          open: false,
          children: groupBlankItems
        }));
      }

      // 6. Edges (folded under "Connections")
      if (geo.edges.length > 0) {
        const groupKeyPrefix = `group-${parentSafeId}-`;
        const edgeColorResolver = resolveEdgeColor;
        const defaultColor = colorTokens.edge;

        const groupLabeledEdges = [];
        const groupUnlabeledEdges = [];
        geo.edges.forEach((edge) => {
          if (normalizeText(edge && edge.label)) {
            groupLabeledEdges.push(edge);
          } else {
            groupUnlabeledEdges.push(edge);
          }
        });

        // 排序
        groupLabeledEdges.sort((a, b) => compareText(a.label, b.label));
        groupUnlabeledEdges.sort((a, b) => {
          const titleA = getLookupNodeTitle(a.fromNode, titleLookup);
          const titleB = getLookupNodeTitle(b.fromNode, titleLookup);
          const cmp = compareText(titleA, titleB);
          if (cmp !== 0) return cmp;
          const toA = getLookupNodeTitle(a.toNode, titleLookup);
          const toB = getLookupNodeTitle(b.toNode, titleLookup);
          return compareText(toA, toB);
        });

        const buildGroupEdgeItem = (edge, index, isLabeled) => {
          const edgeId = normalizeText(edge && edge.id);
          const fromNode = normalizeText(edge && edge.fromNode);
          const toNode = normalizeText(edge && edge.toNode);
          const fromTitle = getLookupNodeTitle(fromNode, titleLookup);
          const toTitle = getLookupNodeTitle(toNode, titleLookup);
          const label = isLabeled ? normalizeText(edge.label) : '--';
          
          const dir = edge.direction || 'none';
          let arrowSymbol = '→';
          if (dir === 'both') {
            arrowSymbol = '↔';
          } else if (dir === 'none') {
            arrowSymbol = '—';
          }

          const preview = (fromTitle || toTitle)
            ? `${fromTitle || t('未知起点', 'Unknown source')} ${arrowSymbol} ${toTitle || t('未知终点', 'Unknown target')}`
            : '';

          return makeItemNode({
            key: `${groupKeyPrefix}edge-${isLabeled ? 'labeled' : 'unlabeled'}-${edgeId || index}`,
            code: '',
            title: `${index + 1}. ${label}`,
            color: edgeColorResolver(edge),
            defaultColor,
            icon: 'fas fa-link',
            showIcon: true,
            showDeleteControl: true,
            deleteAction: {
              kind: 'edge',
              edgeId
            },
            target: makeEdgeTarget(edge),
            preview
          });
        };

        const groupLabeledItems = processGroupAndFold(
          groupLabeledEdges,
          `group-${parentSafeId}-subfolder-edges-labeled`,
          (edge) => edge.label,
          (edge, idx) => buildGroupEdgeItem(edge, idx, true),
          defaultColor,
          defaultColor
        );
        const groupUnlabeledItems = processGroupAndFold(
          groupUnlabeledEdges,
          `group-${parentSafeId}-subfolder-edges-unlabeled`,
          (edge) => getLookupNodeTitle(edge.fromNode, titleLookup),
          (edge, idx) => buildGroupEdgeItem(edge, idx, false),
          defaultColor,
          defaultColor
        );

        if (!groupLabeledItems.length) {
          groupLabeledItems.push(makePlaceholderItem(
            `${groupKeyPrefix}edge-labeled-empty`,
            '',
            t('暂无有标题连接线', 'No labeled edges'),
            {
              color: defaultColor,
              defaultColor
            }
          ));
        }
        if (!groupUnlabeledItems.length) {
          groupUnlabeledItems.push(makePlaceholderItem(
            `${groupKeyPrefix}edge-unlabeled-empty`,
            '',
            t('暂无无标题连接线', 'No untitled edges'),
            {
              color: defaultColor,
              defaultColor
            }
          ));
        }

        const groupLabeledFolder = makeFolderNode({
          key: `group-${parentSafeId}-subfolder-edges-labeled`,
          code: '',
          title: t('有标题', 'Labeled'),
          color: defaultColor,
          defaultColor,
          icon: 'fas fa-link',
          open: false,
          count: groupLabeledEdges.length,
          children: groupLabeledItems
        });

        const groupUnlabeledFolder = makeFolderNode({
          key: `group-${parentSafeId}-subfolder-edges-unlabeled`,
          code: '',
          title: t('无标题', 'Untitled'),
          color: defaultColor,
          defaultColor,
          icon: 'fas fa-link',
          open: false,
          count: groupUnlabeledEdges.length,
          children: groupUnlabeledItems
        });

        otherChildren.push(makeFolderNode({
          key: `group-${parentSafeId}-subfolder-edges`,
          code: '',
          title: t('连接线', 'Edges'),
          icon: 'fas fa-link',
          count: geo.edges.length,
          showFoldControl: true,
          open: false,
          children: [groupLabeledFolder, groupUnlabeledFolder]
        }));
      }

      const allChildren = childrenNodes.concat(otherChildren);
      if (allChildren.length === 0) {
        allChildren.push(makePlaceholderItem(`group-${parentSafeId}-empty`, '', t('暂无成员', 'No members'), {
          icon: 'fas fa-minus'
        }));
      }
      return allChildren;
    }

    function buildCardGroupDirectoryNode(node, tempSections, mdNodes, copies, edges, visited = new Set(), depth = 1, instancePrefix = '') {
      const safeId = normalizeText(node && node.id);
      if (!safeId || visited.has(safeId)) return null;
      visited.add(safeId);
      const instanceSafeId = `${normalizeText(instancePrefix)}${safeId}`;

      const labelRaw = normalizeText(stripInlineMarkdown(stripHtml((node && node.label) || ''))) || (
        isEnglish() ? 'Card Group' : '卡片组'
      );
      const target = makeCardGroupTarget(node, labelRaw);

      const geo = getDirectGroupChildren(node, tempSections, mdNodes, copies, edges);
      const children = buildGroupChildrenDirectoryNodes(geo, instanceSafeId, visited, depth);

      return makeFolderNode({
        key: `card-group-item-${instanceSafeId}`,
        code: '',
        title: labelRaw,
        icon: 'fas fa-object-group',
        variant: 'card-group-item',
        color: '',
        defaultColor: '',
        showIcon: false,
        showFoldControl: true,
        showDeleteControl: true,
        deleteAction: {
          kind: 'md-node',
          nodeId: safeId,
          directoryVariant: 'card-group',
          scopeOptions: true,
          deleteTitle: t('删除组', 'Delete group'),
          confirmTitle: t('确认删除组', 'Confirm delete group'),
          currentTitle: t('仅删除框体', 'Delete frame only'),
          allTitle: t('删除框体及成员', 'Delete frame and members')
        },
        target,
        open: false,
        count: children.length,
        children: children
      });
    }

    const cardGroupNodes = mdNodes.filter((node) => node && node.subtype === 'card-group' && !getDirectParentGroupId(node, 'md-node'));
    const cardGroupItems = cardGroupNodes
      .slice()
      .sort((a, b) => compareText(
        normalizeText(stripInlineMarkdown(stripHtml((a && a.label) || ''))),
        normalizeText(stripInlineMarkdown(stripHtml((b && b.label) || '')))
      ))
      .map((node) => buildCardGroupDirectoryNode(node, tempSections, mdNodes, copies, edges, new Set(), 1))
      .filter(Boolean);

    if (options && options.groupsOnly) {
      return applyDirectoryColorControl(cardGroupItems);
    }

    const groupsHaveAny = cardGroupItems.length > 0;
    const groupItems = cardGroupItems
      .sort((a, b) => compareText(a && a.title, b && b.title));

    const groupsFolder = groupsHaveAny ? makeFolderNode({
      key: 'folder-card-groups',
      code: '',
      title: t('组', 'Group'),
      icon: 'fas fa-object-group',
      variant: 'card-groups-root',
      color: colorTokens.cardGroup,
      defaultColor: colorTokens.cardGroup,
      open: true,
      count: cardGroupItems.length,
      target: {
        kind: 'folder-cluster',
        clusterType: 'nodes',
        nodeIds: cardGroupNodes.map((n) => normalizeText(n && n.id)).filter(Boolean),
        title: t('组', 'Group')
      },
      children: groupItems
    }) : null;

    const nodes = [];
    if (groupsFolder) {
      nodes.push(groupsFolder);
    }
    nodes.push(permanentFolder, temporaryFolder, blankFolder, otherFolder);
    return applyDirectoryColorControl(nodes);
  }

  function buildDirectoryDataForPreview(previewState, options = {}) {
    const inputState = previewState && typeof previewState === 'object' ? previewState : {};
    const storage = (options && options.storage && typeof options.storage === 'object') ? options.storage : null;
    const groupName = normalizeText(options && options.groupName);
    const mode = normalizeText(options && options.mode) === 'overwrite' ? 'overwrite' : 'permanent';

    const tempSections = Array.isArray(inputState.tempSections)
      ? inputState.tempSections.map((section) => section ? { ...section } : section).filter(Boolean)
      : [];
    const mdNodes = Array.isArray(inputState.mdNodes)
      ? inputState.mdNodes.map((node) => node ? { ...node } : node).filter(Boolean)
      : [];
    const edges = Array.isArray(inputState.edges)
      ? inputState.edges.map((edge) => edge ? { ...edge } : edge).filter(Boolean)
      : [];

    if (mode === 'overwrite') {
      const previewStatePrepared = {
        tempSections,
        mdNodes,
        edges
      };
      const previewCopies = readPermanentCopiesFromStorage(storage);
      return buildDirectoryData({
        state: previewStatePrepared,
        enableGroupDelete: false,
        copies: previewCopies
      });
    }

    let hasCardGroup = mdNodes.some((node) => node && node.subtype === 'card-group');
    if (!hasCardGroup) {
      const containerId = `preview-card-group-${Date.now()}`;
      mdNodes.unshift({
        id: containerId,
        type: 'md',
        subtype: 'card-group',
        label: groupName || t('未命名组', 'Untitled group')
      });
      hasCardGroup = true;
    }

    const hasSnapshot = tempSections.some((section) => !!(section && section.isSnapshot));
    if (!hasSnapshot && storage) {
      const syntheticSnapshots = buildPreviewSnapshotSectionsFromStorage(storage);
      if (syntheticSnapshots.length) {
        tempSections.unshift(...syntheticSnapshots);
      }
    }

    const previewStatePrepared = {
      tempSections,
      mdNodes,
      edges
    };

    return buildDirectoryData({
      state: previewStatePrepared,
      enableGroupDelete: false,
      copies: [],
      groupsOnly: true
    });
  }

  function serializeNodesForFingerprint(nodes) {
    return (Array.isArray(nodes) ? nodes : []).map((node) => ({
      type: node.type,
      key: node.key,
      code: node.code,
      title: node.title,
      preview: node.preview || '',
      target: node.target ? {
        kind: node.target.kind || '',
        nodeId: node.target.nodeId || '',
        sectionId: node.target.sectionId || '',
        copyId: node.target.copyId || '',
        edgeId: node.target.edgeId || '',
        fromNode: node.target.fromNode || '',
        toNode: node.target.toNode || '',
        subtype: node.target.subtype || '',
        rect: node.target.rect || null
      } : null,
      count: node.count || 0,
      children: serializeNodesForFingerprint(node.children || [])
    }));
  }

  function collectOpenFolderKeys(root) {
    const keys = new Set();
    if (!root) return keys;
    root.querySelectorAll('.canvas-dir-folder').forEach((el) => {
      if (el.open && el.dataset && el.dataset.nodeKey) {
        keys.add(el.dataset.nodeKey);
      }
    });
    return keys;
  }

  function buildLabelElement(node) {
    const label = document.createElement('span');
    label.className = 'canvas-dir-label';
    const titleEl = document.createElement('span');
    titleEl.className = 'canvas-dir-title';
    titleEl.textContent = node.title || '';
    label.appendChild(titleEl);
    return label;
  }

  function buildIconElement(iconClass, options = {}) {
    const iconWrap = document.createElement('span');
    iconWrap.className = 'canvas-dir-icon';

    const iconText = normalizeText(options.iconText);
    if (iconText) {
      const badge = document.createElement('span');
      badge.className = 'canvas-dir-icon-badge';
      const toneRaw = normalizeText(options.iconTone).toLowerCase();
      if (/^[a-z0-9-]+$/.test(toneRaw)) {
        badge.classList.add(`canvas-dir-icon-badge-${toneRaw}`);
      }
      badge.textContent = iconText;
      iconWrap.appendChild(badge);
      return iconWrap;
    }

    const icon = document.createElement('i');
    icon.className = iconClass || 'fas fa-folder';
    iconWrap.appendChild(icon);
    return iconWrap;
  }

  function buildIconSpacer() {
    const spacer = document.createElement('span');
    spacer.className = 'canvas-dir-icon-spacer';
    return spacer;
  }

  function getDeleteActionLabels(action) {
    const fallbackDelete = t('删除', 'Delete');
    const fallbackConfirm = t('确认删除', 'Confirm deletion');
    const fallbackCancel = t('取消删除', 'Cancel deletion');
    const fallbackCurrent = t('仅删除当前', 'Delete current only');
    const fallbackAll = t('删除当前及子级', 'Delete current and children');
    const kind = normalizeText(action && action.kind);

    if (kind === 'permanent-copy') {
      return {
        delete: t('删除永久栏目副本', 'Delete permanent copy'),
        confirm: t('确认删除永久栏目副本', 'Confirm delete permanent copy'),
        cancel: fallbackCancel,
        current: fallbackCurrent,
        all: fallbackAll
      };
    }

    if (kind === 'temp-section') {
      return {
        delete: t('删除临时栏目', 'Delete temporary section'),
        confirm: t('确认删除临时栏目', 'Confirm delete temporary section'),
        cancel: fallbackCancel,
        current: (action && action.currentTitle) || fallbackCurrent,
        all: (action && action.allTitle) || fallbackAll
      };
    }

    if (kind === 'md-node') {
      return {
        delete: (action && action.deleteTitle) || t('删除空白栏目', 'Delete blank card'),
        confirm: (action && action.confirmTitle) || t('确认删除空白栏目', 'Confirm delete blank card'),
        cancel: fallbackCancel,
        current: (action && action.currentTitle) || fallbackCurrent,
        all: (action && action.allTitle) || fallbackAll
      };
    }

    if (kind === 'edge') {
      return {
        delete: t('删除连接线', 'Delete edge'),
        confirm: t('确认删除连接线', 'Confirm delete edge'),
        cancel: fallbackCancel,
        current: fallbackCurrent,
        all: fallbackAll
      };
    }

    return {
      delete: fallbackDelete,
      confirm: fallbackConfirm,
      cancel: fallbackCancel,
      current: fallbackCurrent,
      all: fallbackAll
    };
  }

  function appendNodeDeleteControl(containerEl, node) {
    if (!containerEl || !node) return;

    const isGroup = node.variant === 'card-group-item' || (node.deleteAction && node.deleteAction.directoryVariant === 'card-group');
    const hasDelete = !!(node.showDeleteControl && node.deleteAction);
    const pinnable = canPinNode(node);

    if (!hasDelete && !isGroup && !pinnable) return;

    const deleteWrap = document.createElement('span');
    deleteWrap.className = 'canvas-dir-folder-delete-wrap';
    const deleteUiOpen = hasDelete && !!pendingDeleteUiKey && pendingDeleteUiKey === node.key;
    if (deleteUiOpen) {
      deleteWrap.classList.add('is-open');
    }

    if (pinnable && !deleteUiOpen) {
      const isPinned = isNodeKeyPinned(node.key);
      const pinBtn = document.createElement('span');
      pinBtn.setAttribute('role', 'button');
      pinBtn.className = 'canvas-dir-pin-btn' + (isPinned ? ' is-pinned' : '');
      pinBtn.dataset.nodePinKey = node.key;
      const isEn = isEnglish();
      const pinTitle = isPinned ? (isEn ? 'Unpin' : '取消置顶') : (isEn ? 'Pin to top' : '置顶');
      pinBtn.setAttribute('aria-label', pinTitle);
      pinBtn.dataset.tooltip = pinTitle;
      pinBtn.innerHTML = '<i class="fas fa-thumbtack" aria-hidden="true"></i>';
      deleteWrap.appendChild(pinBtn);
    }

    if (isGroup) {
      const locateBtn = document.createElement('span');
      locateBtn.setAttribute('role', 'button');
      locateBtn.className = 'canvas-dir-folder-locate';
      locateBtn.dataset.nodeLocateKey = node.key;
      locateBtn.setAttribute('aria-label', t('定位并放大', 'Locate and zoom'));
      locateBtn.title = t('定位并放大', 'Locate and zoom');
      locateBtn.innerHTML = '<i class="fas fa-search-plus" aria-hidden="true"></i>';
      deleteWrap.appendChild(locateBtn);
    }

    if (hasDelete) {
      const action = node.deleteAction;
      const labels = getDeleteActionLabels(action);
      nodeDeleteActionMap.set(node.key, action);

      if (!deleteUiOpen) {
        const deleteBtn = document.createElement('span');
        deleteBtn.setAttribute('role', 'button');
        deleteBtn.className = 'canvas-dir-folder-delete';
        deleteBtn.dataset.nodeDeleteKey = node.key;
        deleteBtn.setAttribute('aria-label', labels.delete);
        deleteBtn.title = labels.delete;
        deleteBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';
        deleteWrap.appendChild(deleteBtn);
      } else {
        const secondaryWrap = document.createElement('span');
        secondaryWrap.className = 'canvas-dir-folder-delete-secondary';

        if (action.scopeOptions) {
          const currentBtn = document.createElement('span');
          currentBtn.setAttribute('role', 'button');
          currentBtn.className = 'canvas-dir-folder-delete-current';
          currentBtn.dataset.nodeDeleteKey = node.key;
          currentBtn.setAttribute('aria-label', labels.current);
          currentBtn.dataset.tooltip = labels.current;
          if (normalizeText(action && action.directoryVariant) === 'card-group') {
            currentBtn.innerHTML = '<span class="icon-frame-delete"><i class="far fa-square"></i><i class="fas fa-trash-alt"></i></span>';
          } else {
            currentBtn.innerHTML = '<i class="fas fa-circle" aria-hidden="true"></i>';
          }
          secondaryWrap.appendChild(currentBtn);

          const allBtn = document.createElement('span');
          allBtn.setAttribute('role', 'button');
          allBtn.className = 'canvas-dir-folder-delete-all';
          allBtn.dataset.nodeDeleteKey = node.key;
          allBtn.setAttribute('aria-label', labels.all);
          allBtn.dataset.tooltip = labels.all;
          if (normalizeText(action && action.directoryVariant) === 'card-group') {
            allBtn.innerHTML = '<i class="far fa-trash-alt" aria-hidden="true"></i>';
          } else {
            allBtn.innerHTML = '<i class="fas fa-layer-group" aria-hidden="true"></i>';
          }
          secondaryWrap.appendChild(allBtn);
        } else {
          const confirmBtn = document.createElement('span');
          confirmBtn.setAttribute('role', 'button');
          confirmBtn.className = 'canvas-dir-folder-delete-confirm';
          confirmBtn.dataset.nodeDeleteKey = node.key;
          confirmBtn.title = labels.confirm;
          confirmBtn.setAttribute('aria-label', labels.confirm);
          confirmBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
          secondaryWrap.appendChild(confirmBtn);
        }

        const cancelBtn = document.createElement('span');
        cancelBtn.setAttribute('role', 'button');
        cancelBtn.className = 'canvas-dir-folder-delete-cancel';
        cancelBtn.dataset.nodeDeleteKey = node.key;
        cancelBtn.title = labels.cancel;
        cancelBtn.setAttribute('aria-label', labels.cancel);
        cancelBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
        secondaryWrap.appendChild(cancelBtn);

        deleteWrap.appendChild(secondaryWrap);
      }
    }

    containerEl.appendChild(deleteWrap);
  }

  function renderNode(node, openFolderKeys) {
    if (node.type === 'folder') {
      const details = document.createElement('details');
      details.className = 'canvas-dir-folder';
      details.dataset.nodeKey = node.key;
      if (node.variant) details.dataset.nodeVariant = node.variant;
      let isOpen = false;
      const storedStates = getFolderOpenStates();
      if (openFolderKeys.has(node.key)) {
        isOpen = true;
      } else if (storedStates[node.key] !== undefined) {
        isOpen = storedStates[node.key];
      } else {
        isOpen = getDefaultFolderOpenState(node);
      }
      details.open = isOpen;

      const summary = document.createElement('summary');
      if (node.showIcon) {
        summary.appendChild(buildIconElement(node.icon, {
          iconText: node.iconText,
          iconTone: node.iconTone
        }));
      } else {
        summary.classList.add('canvas-dir-no-icon');
      }
      summary.appendChild(buildLabelElement(node));
      if (node.title) {
        summary.dataset.miniTooltipTitle = node.title;
      }
      if (typeof node.count === 'number') {
        summary.dataset.miniTooltipSub = `${node.count} ${t('个条目', 'items')}`;
      }
      if (node.defaultColor) {
        summary.style.setProperty('--canvas-dir-node-default-color', node.defaultColor);
      }
      if (node.color) {
        summary.style.setProperty('--canvas-dir-node-color', node.color);
        summary.classList.add('canvas-dir-node-colored');
      }

      if (node.target) {
        summary.classList.add('canvas-dir-folder-summary-btn');
        summary.dataset.nodeKey = node.key;
        nodeActionMap.set(node.key, node.target);
      }

      appendNodeDeleteControl(summary, node);

      if (typeof node.count === 'number') {
        const count = document.createElement('span');
        count.className = 'canvas-dir-count';
        count.textContent = String(node.count);
        if (node.color) {
          count.style.color = node.color;
        }
        summary.appendChild(count);
      }

      if (node.showFoldControl) {
        const toggleBtn = document.createElement('span');
        toggleBtn.setAttribute('role', 'button');
        toggleBtn.className = 'canvas-dir-folder-toggle';
        toggleBtn.setAttribute('aria-label', t('折叠 / 展开', 'Collapse / Expand'));
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right" aria-hidden="true"></i>';
        summary.appendChild(toggleBtn);
      }

      details.appendChild(summary);

      if (node.preview) {
        const preview = document.createElement('div');
        preview.className = 'canvas-dir-preview canvas-dir-folder-preview';
        preview.textContent = node.preview;
        details.appendChild(preview);
      }

      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'canvas-dir-children';
      if (isOpen) {
        if (Array.isArray(node.children) && node.children.length) {
          node.children.forEach((child) => {
            childrenWrap.appendChild(renderNode(child, openFolderKeys));
          });
        } else {
          const empty = document.createElement('div');
          empty.className = 'canvas-dir-empty';
          empty.textContent = t('暂无条目', 'No entries');
          childrenWrap.appendChild(empty);
        }
        details.dataset.lazyLoaded = 'true';
      } else {
        // 初始折叠状态：不挂载子 DOM，待用户点击展开时按需懒加载水合
        details.dataset.lazyLoaded = 'false';
      }

      details.appendChild(childrenWrap);
      return details;
    }

    const item = document.createElement('div');
    item.className = 'canvas-dir-item';
    if (node.variant) item.dataset.nodeVariant = node.variant;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'canvas-dir-item-btn';
    btn.dataset.nodeKey = node.key;
    if (node.title) {
      btn.dataset.miniTooltipTitle = node.title;
    }
    if (node.preview) {
      btn.dataset.miniTooltipSub = clampText(node.preview, 30);
    }
    if (node.variant) btn.dataset.nodeVariant = node.variant;
    if (node.defaultColor) {
      btn.style.setProperty('--canvas-dir-node-default-color', node.defaultColor);
    }
    if (node.color) {
      item.dataset.nodeColored = 'true';
      item.style.setProperty('--canvas-dir-node-color', node.color);
      btn.style.setProperty('--canvas-dir-node-color', node.color);
      btn.classList.add('canvas-dir-node-colored');
    }

    if (!node.target || node.placeholder) {
      btn.classList.add('is-placeholder');
    }

    if (node.showIcon) {
      btn.appendChild(buildIconElement(node.icon, {
        iconText: node.iconText,
        iconTone: node.iconTone
      }));
    } else {
      btn.classList.add('canvas-dir-no-icon');
    }
    btn.appendChild(buildLabelElement(node));
    const hasControls = !!(
      (node.showDeleteControl && node.deleteAction) ||
      canPinNode(node)
    );
    if (hasControls) {
      btn.classList.add('canvas-dir-item-btn-has-delete');
    }

    item.appendChild(btn);

    if (hasControls) {
      appendNodeDeleteControl(item, node);
      const maybeDeleteWrap = item.lastElementChild;
      if (maybeDeleteWrap && maybeDeleteWrap.classList && maybeDeleteWrap.classList.contains('canvas-dir-folder-delete-wrap')) {
        maybeDeleteWrap.classList.add('canvas-dir-item-delete-wrap');
      }
    }

    if (node.preview) {
      const preview = document.createElement('div');
      preview.className = 'canvas-dir-preview';
      preview.textContent = node.preview;
      item.appendChild(preview);
    }

    if (node.target && !node.placeholder) {
      nodeActionMap.set(node.key, node.target);
    }

    return item;
  }

  function indexDirectoryNodes(nodes, targetRoot = null) {
    const map = new Map();
    function walk(node) {
      if (!node || !node.key) return;
      map.set(node.key, node);
      if (Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
    }
    if (Array.isArray(nodes)) {
      nodes.forEach(walk);
    }
    if (targetRoot) {
      targetRoot.__directoryNodeDataMap__ = map;
    }
    directoryNodeDataMap = map;
    return map;
  }

  function getDirectoryNodeDataMap(details) {
    const root = details && details.closest ? (details.closest('.canvas-directory-tree') || details.closest('.canvas-dir-root')) : null;
    if (root && root.__directoryNodeDataMap__) {
      return root.__directoryNodeDataMap__;
    }
    if (!directoryNodeDataMap || !directoryNodeDataMap.size) {
      try {
        const nodes = buildDirectoryData();
        const treeRoot = document.getElementById(ROOT_ID);
        indexDirectoryNodes(nodes, treeRoot);
      } catch (_) {}
    }
    return directoryNodeDataMap;
  }

  function findDirectoryNodeByTarget(kind, id) {
    const rawKind = normalizeText(kind);
    const rawId = normalizeText(id);
    const map = getDirectoryNodeDataMap();
    if (!map || !map.size) return null;

    for (const [key, node] of map.entries()) {
      const tgt = node && node.target;
      if (!tgt || node.placeholder) continue;
      const tKind = normalizeText(tgt.kind);
      if (rawKind === 'permanent-main' && tKind === 'permanent-main') {
        return node;
      }
      if (rawKind === 'permanent-copy' && tKind === 'permanent-copy' && normalizeText(tgt.copyId) === rawId) {
        return node;
      }
      if (rawKind === 'temp-section' && tKind === 'temp-section' && normalizeText(tgt.sectionId) === rawId) {
        return node;
      }
      if (rawKind === 'card-group') {
        if (tKind === 'md-node' && (normalizeText(tgt.subtype) === 'card-group' || node.variant === 'card-group-item') && normalizeText(tgt.nodeId) === rawId) {
          return node;
        }
      }
      if (rawKind === 'md-node' && tKind === 'md-node' && normalizeText(tgt.subtype) !== 'card-group' && normalizeText(tgt.nodeId) === rawId) {
        return node;
      }
      if (rawKind === 'edge' && tKind === 'edge' && normalizeText(tgt.edgeId) === rawId) {
        return node;
      }
    }
    return null;
  }

  function isEntityPinned(kind, id) {
    const rawKind = normalizeText(kind);
    const rawId = normalizeText(id);
    const node = findDirectoryNodeByTarget(rawKind, rawId);
    if (node && node.key) {
      return isNodeKeyPinned(node.key);
    }
    if (rawKind === 'permanent-main') {
      return isNodeKeyPinned('permanent-main') || isNodeKeyPinned('folder-permanent');
    }
    if (!rawId) return false;
    const keys = loadPinnedKeys();
    return keys.some((k) => k === rawId || k.endsWith(`-${rawId}`) || k.includes(`-${rawId}-`));
  }

  function toggleEntityPin(kind, id) {
    const rawKind = normalizeText(kind);
    const rawId = normalizeText(id);
    const node = findDirectoryNodeByTarget(rawKind, rawId);
    if (node && node.key) {
      togglePinnedNodeKey(node.key);
      return isNodeKeyPinned(node.key);
    }
    let fallbackKey = '';
    if (rawKind === 'permanent-main') fallbackKey = 'permanent-main';
    else if (rawKind === 'permanent-copy') fallbackKey = `permanent-copy-${rawId}`;
    else if (rawKind === 'temp-section') fallbackKey = `temp-split-${rawId}`;
    else if (rawKind === 'card-group') fallbackKey = `card-group-item-${rawId}`;
    else if (rawKind === 'md-node') fallbackKey = `blank-${rawId}`;
    else if (rawKind === 'edge') fallbackKey = `edge-unlabeled-${rawId}`;

    if (fallbackKey) {
      const keys = loadPinnedKeys();
      const existing = keys.find((k) => k === rawId || k.endsWith(`-${rawId}`) || k.includes(`-${rawId}-`));
      if (existing) {
        removePinnedNodeKey(existing);
        return false;
      } else {
        togglePinnedNodeKey(fallbackKey);
        return true;
      }
    }
    return false;
  }

  function hydrateFolderChildren(details, openFolderKeys) {
    if (!details || details.dataset.lazyLoaded === 'true') return;
    const nodeKey = details.dataset.nodeKey;
    if (!nodeKey) return;
    const nodeMap = getDirectoryNodeDataMap(details);
    const node = nodeMap ? nodeMap.get(nodeKey) : null;
    const childrenWrap = details.querySelector(':scope > .canvas-dir-children');
    if (!childrenWrap || !node) return;

    childrenWrap.innerHTML = '';
    const frag = document.createDocumentFragment();
    const currentOpenKeys = openFolderKeys || collectOpenFolderKeys(details.closest('.canvas-dir-root'));

    if (Array.isArray(node.children) && node.children.length) {
      node.children.forEach((child) => {
        frag.appendChild(renderNode(child, currentOpenKeys));
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'canvas-dir-empty';
      empty.textContent = t('暂无条目', 'No entries');
      frag.appendChild(empty);
    }

    childrenWrap.appendChild(frag);
    details.dataset.lazyLoaded = 'true';
    updateActiveState(details);
  }

  const FOLDER_UNLOAD_DEBOUNCE_MS = 600;

  function scheduleFolderUnload(details) {
    if (!details || details.dataset.lazyLoaded !== 'true') return;
    if (details.__unloadTimer__) {
      clearTimeout(details.__unloadTimer__);
    }
    details.__unloadTimer__ = setTimeout(() => {
      details.__unloadTimer__ = null;
      if (!details.open && document.body.contains(details)) {
        const childrenWrap = details.querySelector(':scope > .canvas-dir-children');
        if (childrenWrap) {
          clearAllFolderUnloadTimers(childrenWrap);
          childrenWrap.querySelectorAll('[data-node-key]').forEach((el) => {
            const k = el.dataset.nodeKey;
            if (k && !isNodeKeyPinned(k)) {
              nodeActionMap.delete(k);
              nodeDeleteActionMap.delete(k);
            }
          });
          childrenWrap.innerHTML = '';
          details.dataset.lazyLoaded = 'false';
        }
      }
    }, FOLDER_UNLOAD_DEBOUNCE_MS);
  }

  function handleFolderToggle(details) {
    if (!details || !details.classList.contains('canvas-dir-folder')) return;
    const isOpen = !!details.open;
    if (details.__lastProcessedOpen__ === isOpen) return;
    details.__lastProcessedOpen__ = isOpen;
    const key = details.dataset.nodeKey;
    if (key === 'folder-pinned') {
      savePinnedSectionOpenState(isOpen);
      return;
    }
    if (key) {
      saveFolderOpenState(key, isOpen);
    }
    if (isOpen) {
      if (details.__unloadTimer__) {
        clearTimeout(details.__unloadTimer__);
        details.__unloadTimer__ = null;
      }
      hydrateFolderChildren(details);
    } else {
      scheduleFolderUnload(details);
    }
  }

  function clearAllFolderUnloadTimers(root) {
    if (!root) return;
    root.querySelectorAll('.canvas-dir-folder').forEach((el) => {
      if (el.__unloadTimer__) {
        clearTimeout(el.__unloadTimer__);
        el.__unloadTimer__ = null;
      }
    });
  }

  function updateActiveState(root) {
    if (!root) return;
    root.querySelectorAll('.canvas-dir-item-btn, .canvas-dir-folder-summary-btn').forEach((btn) => {
      if (!btn || !btn.dataset) return;
      const key = btn.dataset.nodeKey || '';
      btn.classList.toggle('active', !!activeNodeKey && activeNodeKey === key);
    });
  }

  function highlightLocatedElement(element) {
    if (!element) return;
    const highlightClass = 'canvas-locate-highlight';
    const enterClass = 'temp-node-enter';

    // If the animation is already active, don't restart it to avoid double-triggering/glitches
    if (element.dataset.locateHighlightTimeoutId) {
      return;
    }

    // Save original zIndex if not already saved
    element.dataset.originalZIndex = element.style.zIndex || '';

    // Elevate z-index to show on top during transition
    element.style.zIndex = '99999';

    // Temporarily disable transition to snap to initial state
    const origTransition = element.style.transition;
    element.style.transition = 'none';
    element.classList.add(enterClass);

    // Force reflow
    element.offsetHeight;

    // Restore transition
    element.style.transition = origTransition;
    element.classList.add(highlightClass);

    // Trigger transition in the next frame
    global.requestAnimationFrame(() => {
      element.classList.remove(enterClass);
    });

    // Restore z-index after the border pulse has had time to complete.
    const timeoutId = global.setTimeout(() => {
      element.classList.remove(highlightClass);
      const origZIndex = element.dataset.originalZIndex;
      if (origZIndex !== undefined) {
        if (origZIndex === '') {
          element.style.removeProperty('z-index');
        } else {
          element.style.zIndex = origZIndex;
        }
      }
      delete element.dataset.originalZIndex;
      delete element.dataset.locateHighlightTimeoutId;
    }, 650);

    element.dataset.locateHighlightTimeoutId = String(timeoutId);
  }

  function locateElement(module, element, zoom = null) {
    if (!module || typeof module.locateElement !== 'function' || !element) return false;
    try {
      module.locateElement(element, zoom);
      highlightLocatedElement(element);
      return true;
    } catch (_) {
      return false;
    }
  }

  function resolvePermanentSectionElement(copyId = null) {
    const protocolBridge = global.CanvasProtocolBridge && typeof global.CanvasProtocolBridge.resolvePermanentSectionElement === 'function'
      ? global.CanvasProtocolBridge
      : null;
    if (protocolBridge) {
      try {
        const resolved = protocolBridge.resolvePermanentSectionElement(copyId);
        if (resolved) return resolved;
      } catch (_) { }
    }

    const safeCopyId = normalizeText(copyId);
    if (!safeCopyId) return document.getElementById('permanentSection');

    const escaped = escapeSelector(safeCopyId);
    if (escaped) {
      const byDataset = document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id="${escaped}"]`)
        || document.querySelector(`.permanent-bookmark-section[data-permanent-section-copy-id="${escaped}"]`);
      if (byDataset) return byDataset;
    }
    return document.getElementById(`permanent-section-copy-${safeCopyId}`);
  }

  function locatePermanentMain(module, zoom = null) {
    const sectionEl = resolvePermanentSectionElement(null);
    if (module && typeof module.locatePermanent === 'function') {
      try {
        module.locatePermanent(zoom);
        highlightLocatedElement(sectionEl);
        return true;
      } catch (_) { }
    }
    return locateElement(module, sectionEl, zoom);
  }

  function locatePermanentCopy(module, copyId, zoom = null) {
    if (!copyId) return false;
    const sectionEl = resolvePermanentSectionElement(copyId);
    if (sectionEl) {
      return locateElement(module, sectionEl, zoom);
    }
    return false;
  }

  function locateByNodeId(module, nodeId, zoom = null) {
    const id = normalizeText(nodeId);
    if (!id) return false;

    if (id === 'permanentSection' || id === 'permanent-section') {
      return locatePermanentMain(module, zoom);
    }

    if (id.startsWith('permanent-section-copy-')) {
      const copyId = id.slice('permanent-section-copy-'.length);
      return locatePermanentCopy(module, copyId, zoom);
    }

    if (id.startsWith('temp-section-') || id.startsWith('tempSecId_')) {
      const tempEl = document.getElementById(id);
      if (module && typeof module.locateSection === 'function') {
        try {
          module.locateSection(id, zoom);
          highlightLocatedElement(tempEl);
          return true;
        } catch (_) { }
      }
      if (tempEl) return locateElement(module, tempEl, zoom);
      return false;
    }

    const target = document.getElementById(id);
    if (target) {
      return locateElement(module, target, zoom);
    }

    return false;
  }

  function getPermanentMainRectFromState() {
    const mainShell = getPermanentMainShell();
    if (mainShell && mainShell.cardState) {
      const x = Number.parseFloat(mainShell.cardState.left);
      const y = Number.parseFloat(mainShell.cardState.top);
      const w = Number.parseFloat(mainShell.cardState.width);
      const h = Number.parseFloat(mainShell.cardState.height);
      if ([x, y, w, h].every(v => Number.isFinite(v))) return { x, y, w, h };
    }
    const el = document.getElementById('permanentSection');
    return readCanvasElementRect(el);
  }

  function getPermanentCopyRectFromState(copyId) {
    const safeCopyId = normalizeText(copyId);
    if (!safeCopyId) return null;

    const state = getCanvasState();
    const copyStateById = state && state.permanentLayout && state.permanentLayout.copiesById && typeof state.permanentLayout.copiesById === 'object'
      ? state.permanentLayout.copiesById
      : null;
    if (copyStateById && copyStateById[safeCopyId]) {
      const rect = rectFromPermanentCopy(copyStateById[safeCopyId]);
      if (rect) return rect;
    }

    const shell = getPermanentCopyShells().find((view) => normalizeText(view && view.copyId) === safeCopyId);
    if (shell) {
      const rect = rectFromPermanentCopy(shell.cardState || shell);
      if (rect) return rect;
    }

    const copies = readPermanentCopies();
    const copy = copies.find((item) => normalizeText(item && item.id) === safeCopyId);
    if (copy) {
      const rect = rectFromPermanentCopy(copy);
      if (rect) return rect;
    }

    const el = resolvePermanentSectionElement(safeCopyId);
    return readCanvasElementRect(el);
  }

  function getCanvasNodeRectFromState(nodeId) {
    const id = normalizeText(nodeId);
    if (!id) return null;

    if (id === 'permanentSection' || id === 'permanent-section') return getPermanentMainRectFromState();
    if (id.startsWith('permanent-section-copy-')) return getPermanentCopyRectFromState(id.slice('permanent-section-copy-'.length));

    const state = getCanvasState();
    const tempSections = Array.isArray(state && state.tempSections) ? state.tempSections : [];
    const temp = tempSections.find((section) => section && normalizeText(section.id) === id);
    if (temp) return __sidebarRectOf(temp);

    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes : [];
    const md = mdNodes.find((node) => node && normalizeText(node.id) === id);
    if (md) return __sidebarRectOf(md);

    const el = document.getElementById(id);
    return readCanvasElementRect(el);
  }

  function getEdgeRectFromState(target) {
    if (!target || typeof target !== 'object') return null;
    const edgeId = normalizeText(target.edgeId);
    const state = getCanvasState();
    const edges = Array.isArray(state && state.edges) ? state.edges : [];
    const edge = edgeId ? edges.find((item) => item && normalizeText(item.id) === edgeId) : null;
    const fromNode = normalizeText((edge && edge.fromNode) || target.fromNode);
    const toNode = normalizeText((edge && edge.toNode) || target.toNode);
    const fromRect = getCanvasNodeRectFromState(fromNode);
    const toRect = getCanvasNodeRectFromState(toNode);
    const fromCenter = getRectCenter(fromRect);
    const toCenter = getRectCenter(toRect);
    if (fromCenter && toCenter) {
      const minX = Math.min(fromCenter.x, toCenter.x);
      const minY = Math.min(fromCenter.y, toCenter.y);
      return {
        x: minX,
        y: minY,
        w: Math.max(1, Math.abs(fromCenter.x - toCenter.x)),
        h: Math.max(1, Math.abs(fromCenter.y - toCenter.y))
      };
    }
    return fromRect || toRect || null;
  }

  function computeUnionRect(rects) {
    const valid = (Array.isArray(rects) ? rects : []).filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h));
    if (!valid.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    valid.forEach((r) => {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    });
    if (minX === Infinity) return null;
    return {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY)
    };
  }

  function getCanvasRectForDirectoryTarget(target) {
    if (!target || typeof target !== 'object') return null;
    if (target.rect) return target.rect;
    switch (normalizeText(target.kind)) {
      case 'permanent-main':
        return getPermanentMainRectFromState();
      case 'permanent-copy':
        return getPermanentCopyRectFromState(target.copyId);
      case 'temp-section':
        return getCanvasNodeRectFromState(target.sectionId);
      case 'md-node':
        return getCanvasNodeRectFromState(target.nodeId);
      case 'edge':
        return getEdgeRectFromState(target);
      case 'folder-cluster': {
        const rects = [];
        if (target.hasPermanentMain) {
          const r = getPermanentMainRectFromState();
          if (r) rects.push(r);
        }
        if (Array.isArray(target.copyIds)) {
          target.copyIds.forEach((copyId) => {
            const r = getPermanentCopyRectFromState(copyId);
            if (r) rects.push(r);
          });
        }
        if (Array.isArray(target.sectionIds)) {
          target.sectionIds.forEach((id) => {
            const r = getCanvasNodeRectFromState(id);
            if (r) rects.push(r);
          });
        }
        if (Array.isArray(target.nodeIds)) {
          target.nodeIds.forEach((id) => {
            const r = getCanvasNodeRectFromState(id);
            if (r) rects.push(r);
          });
        }
        if (Array.isArray(target.edgeIds)) {
          target.edgeIds.forEach((id) => {
            const r = getEdgeRectFromState({ edgeId: id });
            if (r) rects.push(r);
          });
        }
        return computeUnionRect(rects);
      }
      default:
        return null;
    }
  }

  function resolveDirectoryTargetElement(target) {
    if (!target || typeof target !== 'object') return null;
    switch (normalizeText(target.kind)) {
      case 'permanent-main':
        return resolvePermanentSectionElement(null);
      case 'permanent-copy':
        return resolvePermanentSectionElement(target.copyId);
      case 'temp-section': {
        const id = normalizeText(target.sectionId);
        if (!id) return null;
        const escaped = escapeSelector(id);
        return document.getElementById(id)
          || (escaped ? document.querySelector(`.temp-canvas-node[data-section-id="${escaped}"]`) : null);
      }
      case 'md-node':
        return document.getElementById(normalizeText(target.nodeId));
      default:
        return null;
    }
  }

  function resolveDirectoryLocateZoom(rect, zoom = null) {
    if (zoom === 'fit' && rect) {
      const workspace = document.getElementById('canvasWorkspace');
      const wsW = (workspace && workspace.clientWidth) || global.innerWidth || 800;
      const wsH = (workspace && workspace.clientHeight) || global.innerHeight || 600;
      const padding = 60;
      const fitW = Math.max(0.1, (wsW - padding) / Math.max(1, Number(rect.w) || 1));
      const fitH = Math.max(0.1, (wsH - padding) / Math.max(1, Number(rect.h) || 1));
      return Math.min(1.0, fitW, fitH);
    }
    const requested = Number(zoom);
    if (Number.isFinite(requested) && requested > 0) return requested;
    const state = getCanvasState();
    const baseZoom = Number(state && state.baseZoom);
    return Number.isFinite(baseZoom) && baseZoom > 0 ? baseZoom : 1;
  }

  function scheduleDirectoryTargetWake(target) {
    const module = getCanvasModule();
    if (!module || !target) return;
    const kind = normalizeText(target.kind);
    const wake = () => {
      try {
        if (kind === 'folder-cluster') {
          if (target.hasPermanentMain) {
            const el = document.getElementById('permanentSection');
            if (el && typeof module.wakeCanvasNodeFromLazyState === 'function') {
              module.wakeCanvasNodeFromLazyState(el);
            }
          }
          if (Array.isArray(target.copyIds)) {
            target.copyIds.forEach((id) => {
              const el = document.querySelector(`.permanent-copy-canvas-node[data-copy-id="${escapeSelector(id)}"]`);
              if (el && typeof module.wakeCanvasNodeFromLazyState === 'function') {
                module.wakeCanvasNodeFromLazyState(el);
              }
            });
          }
          if (Array.isArray(target.sectionIds) && typeof module.forceWakeAndRender === 'function') {
            target.sectionIds.forEach((id) => {
              try { module.forceWakeAndRender(id); } catch (_) {}
            });
          }
          if (Array.isArray(target.nodeIds) && typeof module.materializeMaximizedNodeFromDescriptor === 'function') {
            target.nodeIds.forEach((id) => {
              try { module.materializeMaximizedNodeFromDescriptor({ type: 'md-node', id }); } catch (_) {}
            });
          }
          return;
        }
        const el = resolveDirectoryTargetElement(target);
        if (el && typeof module.wakeCanvasNodeFromLazyState === 'function') {
          module.wakeCanvasNodeFromLazyState(el);
        }
        if (kind === 'temp-section' && typeof module.forceWakeAndRender === 'function') {
          module.forceWakeAndRender(normalizeText(target.sectionId));
        }
        if (kind === 'md-node' && typeof module.materializeMaximizedNodeFromDescriptor === 'function') {
          module.materializeMaximizedNodeFromDescriptor({ type: 'md-node', id: normalizeText(target.nodeId) });
        }
      } catch (_) { }
    };
    wake();
    global.setTimeout(wake, 80);
    global.setTimeout(wake, 260);
  }

  function scheduleDirectoryTargetHighlight(target) {
    if (!target) return;
    const highlight = () => {
      if (target.kind === 'folder-cluster') {
        if (target.hasPermanentMain) {
          const el = document.getElementById('permanentSection');
          if (el) highlightLocatedElement(el);
        }
        if (Array.isArray(target.copyIds)) {
          target.copyIds.forEach((id) => {
            const escaped = escapeSelector(id);
            const el = document.querySelector(`.permanent-copy-canvas-node[data-copy-id="${escaped}"]`);
            if (el) highlightLocatedElement(el);
          });
        }
        if (Array.isArray(target.sectionIds)) {
          target.sectionIds.forEach((id) => {
            const escaped = escapeSelector(id);
            const el = document.getElementById(id)
              || (escaped ? document.querySelector(`.temp-canvas-node[data-section-id="${escaped}"]`) : null);
            if (el) highlightLocatedElement(el);
          });
        }
        if (Array.isArray(target.nodeIds)) {
          target.nodeIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) highlightLocatedElement(el);
          });
        }
        if (Array.isArray(target.edgeIds)) {
          target.edgeIds.forEach((id) => {
            highlightEdge(id);
          });
        }
        return;
      }
      const el = resolveDirectoryTargetElement(target);
      if (el) highlightLocatedElement(el);
    };
    highlight();
    global.setTimeout(highlight, 120);
    global.setTimeout(highlight, 360);
  }

  function locateDirectoryTargetFromRect(module, target, zoom = null) {
    const rect = getCanvasRectForDirectoryTarget(target);
    const center = getRectCenter(rect);
    if (!rect || !center) return false;

    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return false;
    const state = getCanvasState();
    if (!state) return false;

    const targetZoom = resolveDirectoryLocateZoom(rect, zoom);
    const workspaceWidth = workspace.clientWidth || global.innerWidth || 800;
    const workspaceHeight = workspace.clientHeight || global.innerHeight || 600;
    const panX = workspaceWidth / 2 - center.x * targetZoom;
    const panY = workspaceHeight / 2 - center.y * targetZoom;

    let navigated = false;
    if (module && typeof module.navigateToViewport === 'function') {
      try {
        navigated = module.navigateToViewport({ x: panX, y: panY, zoom: targetZoom }) !== false;
      } catch (_) {
        navigated = false;
      }
    }

    if (!navigated) {
      state.zoom = targetZoom;
      state.panOffsetX = panX;
      state.panOffsetY = panY;

      const content = document.getElementById(CANVAS_CONTENT_ID);
      if (content) {
        if (typeof global.applyCanvasContentTransform === 'function') {
          try { global.applyCanvasContentTransform(content, panX, panY, targetZoom); } catch (_) { }
        } else {
          content.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${targetZoom})`;
        }
      }
      const container = document.querySelector('.canvas-main-container');
      if (container && container.style) {
        container.style.setProperty('--canvas-scale', String(targetZoom));
        container.style.setProperty('--canvas-pan-x', `${panX}px`);
        container.style.setProperty('--canvas-pan-y', `${panY}px`);
      }
      if (typeof global.updateCanvasTransform === 'function') {
        try { global.requestAnimationFrame(() => global.updateCanvasTransform(false)); } catch (_) { }
      }
    }

    scheduleDirectoryTargetWake(target);
    scheduleDirectoryTargetHighlight(target);
    return true;
  }

  function locateCardGroupByCanvasRect(module, target, zoom = null) {
    if (!target || typeof target !== 'object') return false;
    const targetRect = target.rect || null;
    const targetCenter = getRectCenter(targetRect);
    if (!targetCenter) return false;

    const targetId = normalizeText(target.nodeId);
    const targetTitle = normalizeText(target.title);
    let candidates = [];
    try {
      candidates = Array.from(document.querySelectorAll('.card-group-canvas-node'));
    } catch (_) {
      candidates = [];
    }
    if (!candidates.length) return false;

    let best = null;
    let bestScore = Infinity;
    candidates.forEach((element) => {
      if (!element) return;
      const rect = readCanvasElementRect(element);
      const center = getRectCenter(rect);
      if (!center) return;

      const elementId = normalizeText(element.id);
      const elementTitle = normalizeText(
        (element.dataset && element.dataset.title)
        || element.getAttribute('aria-label')
        || ''
      );
      const idMatches = !!targetId && elementId === targetId;
      const titleMatches = !!targetTitle && elementTitle === targetTitle;
      if (!idMatches && targetTitle && elementTitle && !titleMatches) return;

      const dx = center.x - targetCenter.x;
      const dy = center.y - targetCenter.y;
      const sizePenalty = rect && targetRect
        ? Math.abs(Number(rect.w) - Number(targetRect.w)) + Math.abs(Number(rect.h) - Number(targetRect.h))
        : 0;
      const mismatchPenalty = idMatches ? 0 : (titleMatches ? 0.25 : 1);
      const score = (dx * dx) + (dy * dy) + sizePenalty + mismatchPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = element;
      }
    });

    if (!best) return false;

    const bestRect = readCanvasElementRect(best);
    const bestCenter = getRectCenter(bestRect);
    if (!bestCenter) return false;
    const centerDistance = Math.hypot(bestCenter.x - targetCenter.x, bestCenter.y - targetCenter.y);
    const targetSize = Math.max(Number(targetRect.w) || 0, Number(targetRect.h) || 0, 1);
    if (centerDistance > Math.max(12, targetSize * 0.03)) return false;

    if (module && typeof module.selectMdNode === 'function') {
      try { module.selectMdNode(best.id || targetId); } catch (_) {}
    }
    return locateElement(module, best, zoom);
  }

  function locateMdNodeTarget(module, target, zoom = null) {
    if (!target || typeof target !== 'object') return false;
    if (normalizeText(target.subtype) === 'card-group') {
      if (locateCardGroupByCanvasRect(module, target, zoom)) return true;
    }
    if (locateByNodeId(module, target.nodeId, zoom)) return true;
    return locateDirectoryTargetFromRect(module, target, zoom);
  }

  function locateCardGroup(nodeId, zoom = 'fit') {
    const id = normalizeText(nodeId);
    if (!id) return false;

    const state = getCanvasState();
    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes : [];
    const node = mdNodes.find((item) => item
      && normalizeText(item.id) === id
      && normalizeText(item.subtype) === 'card-group');
    if (!node) return false;

    const target = makeCardGroupTarget(node, node.label || node.title || '');
    return !!target && locateMdNodeTarget(getCanvasModule(), target, zoom);
  }

  function highlightEdge(edgeId) {
    const id = normalizeText(edgeId);
    if (!id) return;
    const escaped = escapeSelector(id);
    if (!escaped) return;

    const targets = document.querySelectorAll([
      `.canvas-edge[data-edge-id="${escaped}"]`,
      `.canvas-edge-hit-area[data-edge-id="${escaped}"]`,
      `path[data-edge-id="${escaped}"]`
    ].join(','));
    if (!targets.length) return;

    targets.forEach((el) => {
      el.classList.add('canvas-dir-edge-highlight');
    });

    global.setTimeout(() => {
      targets.forEach((el) => {
        el.classList.remove('canvas-dir-edge-highlight');
      });
    }, 1200);
  }

  function locateTarget(target, zoom = null) {
    if (!target || typeof target !== 'object') return;
    scheduleDirectoryTargetWake(target);

    const module = getCanvasModule();
    switch (target.kind) {
      case 'permanent-main':
        if (!locatePermanentMain(module, zoom)) locateDirectoryTargetFromRect(module, target, zoom);
        break;
      case 'permanent-copy':
        if (!locatePermanentCopy(module, target.copyId, zoom)) locateDirectoryTargetFromRect(module, target, zoom);
        break;
      case 'temp-section':
        {
          let located = false;
          if (module && typeof module.locateSection === 'function') {
            try {
              module.locateSection(target.sectionId, zoom);
              const tempEl = resolveDirectoryTargetElement(target);
              if (tempEl) {
                highlightLocatedElement(tempEl);
                located = true;
              }
            } catch (_) { }
          }
          if (!located && !locateByNodeId(module, target.sectionId, zoom)) {
            locateDirectoryTargetFromRect(module, target, zoom);
          }
        }
        break;
      case 'md-node':
        locateMdNodeTarget(module, target, zoom);
        break;
      case 'edge':
        {
          let located = false;
          if (module && typeof module.locateEdge === 'function') {
            try {
              module.locateEdge(target.edgeId, zoom);
              located = true;
            } catch (_) { }
          }
          highlightEdge(target.edgeId);
          if (!located && !locateDirectoryTargetFromRect(module, target, zoom)) {
            if (locateByNodeId(module, target.fromNode, zoom)) return;
            locateByNodeId(module, target.toNode, zoom);
          }
          global.setTimeout(() => highlightEdge(target.edgeId), 120);
          global.setTimeout(() => highlightEdge(target.edgeId), 360);
        }
        break;
      case 'folder-cluster':
        locateDirectoryTargetFromRect(module, target, zoom || 'fit');
        break;
      default:
        break;
    }
  }

  function notifyPostReloadLocateComplete(request, status) {
    try {
      global.dispatchEvent(new CustomEvent('bcs:post-reload-locate-complete', {
        detail: {
          request: request || null,
          status: status || 'complete'
        }
      }));
    } catch (_) {
      try {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent('bcs:post-reload-locate-complete', false, false, {
          request: request || null,
          status: status || 'complete'
        });
        global.dispatchEvent(event);
      } catch (_) {}
    }
  }

  function consumePostReloadLocateRequest() {
    let request = null;
    try {
      const raw = localStorage.getItem(POST_RELOAD_LOCATE_KEY);
      if (!raw) return;
      localStorage.removeItem(POST_RELOAD_LOCATE_KEY);
      request = parseJSON(raw, null);
    } catch (_) {
      try { localStorage.removeItem(POST_RELOAD_LOCATE_KEY); } catch (_) {}
      return;
    }

    if (!request || (request.target !== 'permanent-main' && request.target !== 'snapshot-card-group')) return;
    const requestedAt = Number(request.requestedAt) || 0;
    if (requestedAt && Date.now() - requestedAt > 5 * 60 * 1000) return;

    if (request.target === 'snapshot-card-group') {
      const rawRect = request.rect && typeof request.rect === 'object' ? request.rect : null;
      const rect = rawRect ? {
        x: Number(rawRect.x) || 0,
        y: Number(rawRect.y) || 0,
        w: Math.max(1, Number(rawRect.w || rawRect.width) || 1),
        h: Math.max(1, Number(rawRect.h || rawRect.height) || 1)
      } : null;
      const target = {
        kind: 'md-node',
        subtype: 'card-group',
        nodeId: normalizeText(request.nodeId),
        title: normalizeText(request.title),
        rect
      };
      let attempts = 0;
      const tryLocateSnapshotGroup = () => {
        attempts += 1;
        if (attempts === 1) {
          notifyPostReloadLocateComplete(request, 'started');
        }
        const module = getCanvasModule();
        if (locateMdNodeTarget(module, target, 'fit')) {
          notifyPostReloadLocateComplete(request, 'located');
          return;
        }
        if (attempts < 32) {
          global.setTimeout(tryLocateSnapshotGroup, 250);
        } else {
          notifyPostReloadLocateComplete(request, 'timeout');
        }
      };
      global.setTimeout(tryLocateSnapshotGroup, 450);
      return;
    }

    let attempts = 0;
    const tryLocate = () => {
      attempts += 1;
      if (attempts === 1) {
        notifyPostReloadLocateComplete(request, 'started');
      }
      const module = getCanvasModule();
      const sectionEl = resolvePermanentSectionElement(null);
      if (module && typeof module.locatePermanent === 'function' && sectionEl) {
        try {
          module.locatePermanent();
          notifyPostReloadLocateComplete(request, 'located');
          return;
        } catch (_) { }
      }
      if (attempts < 32) {
        global.setTimeout(tryLocate, 250);
      } else {
        notifyPostReloadLocateComplete(request, 'timeout');
      }
    };

    global.setTimeout(tryLocate, 450);
  }

  function resolveTargetElementForFullscreenSwitch(target) {
    if (!target || typeof target !== 'object') return null;

    const module = getCanvasModule();

    switch (target.kind) {
      case 'permanent-main': {
        const el = resolvePermanentSectionElement(null) || document.getElementById('permanentSection');
        if (el && module && typeof module.wakeCanvasNodeFromLazyState === 'function') {
          try { module.wakeCanvasNodeFromLazyState(el); } catch (_) { }
        }
        return el;
      }
      case 'permanent-copy': {
        const copyId = normalizeText(target.copyId);
        if (!copyId) return null;
        let el = resolvePermanentSectionElement(copyId);
        if (!el && module && typeof module.materializeMaximizedNodeFromDescriptor === 'function') {
          try {
            el = module.materializeMaximizedNodeFromDescriptor({ type: 'permanent-copy', copyId });
          } catch (_) { }
        }
        el = el || resolvePermanentSectionElement(copyId);
        if (el && module && typeof module.wakeCanvasNodeFromLazyState === 'function') {
          try { module.wakeCanvasNodeFromLazyState(el); } catch (_) { }
        }
        return el;
      }
      case 'temp-section': {
        const sectionId = normalizeText(target.sectionId);
        if (!sectionId) return null;
        let el = resolveDirectoryTargetElement(target) || document.getElementById(sectionId);
        if (!el && module && typeof module.materializeMaximizedNodeFromDescriptor === 'function') {
          try {
            el = module.materializeMaximizedNodeFromDescriptor({ type: 'temp-node', id: sectionId });
          } catch (_) { }
        }
        if (!el && module && typeof module.forceWakeAndRender === 'function') {
          try { module.forceWakeAndRender(sectionId); } catch (_) { }
          el = document.getElementById(sectionId);
        }
        if (!el && typeof global.renderTempNode === 'function') {
          try {
            const sec = (typeof global.getTempSection === 'function') ? global.getTempSection(sectionId) : null;
            if (sec) global.renderTempNode(sec);
            el = document.getElementById(sectionId);
          } catch (_) { }
        }
        el = el || document.getElementById(sectionId);
        if (el && module && typeof module.wakeCanvasNodeFromLazyState === 'function') {
          try { module.wakeCanvasNodeFromLazyState(el); } catch (_) { }
        }
        return el;
      }
      case 'md-node': {
        const nodeId = normalizeText(target.nodeId);
        if (!nodeId) return null;
        let el = document.getElementById(nodeId);
        if (!el && module && typeof module.materializeMaximizedNodeFromDescriptor === 'function') {
          try {
            el = module.materializeMaximizedNodeFromDescriptor({ type: 'md-node', id: nodeId });
          } catch (_) { }
        }
        if (!el && module && typeof module.locateMdNode === 'function') {
          try { module.locateMdNode(nodeId); } catch (_) { }
          el = document.getElementById(nodeId);
        }
        el = el || document.getElementById(nodeId);
        if (el && module && typeof module.wakeCanvasNodeFromLazyState === 'function') {
          try { module.wakeCanvasNodeFromLazyState(el); } catch (_) { }
        }
        return el;
      }
      default:
        return null;
    }
  }

  function switchFullscreenNodeByDirectoryTarget(target) {
    const currentMaximized = document.querySelector('.canvas-node-maximized');
    const isFullscreenActive = !!currentMaximized
      || !!(document.body && document.body.classList.contains('canvas-node-maximized-active'))
      || !!(document.documentElement && document.documentElement.classList.contains('layout-preload-node-maximized-active'));
    if (!isFullscreenActive) return false;

    const nextTarget = resolveTargetElementForFullscreenSwitch(target);
    if (!nextTarget) return false;
    if (currentMaximized && nextTarget === currentMaximized) return true;

    const isCanvasNode = nextTarget.classList
      && (nextTarget.classList.contains('permanent-bookmark-section')
        || nextTarget.classList.contains('temp-canvas-node')
        || nextTarget.classList.contains('md-canvas-node'));
    if (!isCanvasNode) return false;

    const module = getCanvasModule();
    if (module && typeof module.wakeCanvasNodeFromLazyState === 'function') {
      try { module.wakeCanvasNodeFromLazyState(nextTarget); } catch (_) { }
    }

    if (module && typeof module.toggleElementFullscreen === 'function') {
      try {
        module.toggleElementFullscreen(nextTarget);
        return true;
      } catch (_) { }
    }

    const fullscreenBtn = nextTarget.querySelector(
      '.canvas-node-fullscreen-btn, .permanent-section-fullscreen-btn, .temp-node-fullscreen-btn, .md-node-toolbar-btn[data-action="md-fullscreen"]'
    );
    if (!fullscreenBtn) return false;

    try {
      fullscreenBtn.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearPendingDeleteUi(options = {}) {
    if (!pendingDeleteUiKey) return;
    pendingDeleteUiKey = '';
    if (options && options.refresh) {
      queueRefresh({ force: true });
    }
  }

  function showPendingDeleteUi(nodeKey) {
    const key = normalizeText(nodeKey);
    if (!key) return;

    if (pendingDeleteUiKey && pendingDeleteUiKey === key) {
      clearPendingDeleteUi({ refresh: true });
      return;
    }

    pendingDeleteUiKey = key;
    queueRefresh({ force: true });
  }

  function collectTempSectionDeleteIds(sectionId) {
    const normalizedId = normalizeText(sectionId);
    return normalizedId ? [normalizedId] : [];
  }

  function runDeleteTempSectionAction(action) {
    if (!action || action.kind !== 'temp-section') return false;
    const sectionId = normalizeText(action.sectionId);
    if (!sectionId || typeof global.removeTempNode !== 'function') return false;

    const ids = collectTempSectionDeleteIds(sectionId);
    let removed = false;

    ids.forEach((id) => {
      try {
        global.removeTempNode(id);
        removed = true;
      } catch (_) { }
    });

    return removed;
  }

  function runDeleteMdNodeAction(action, mode = 'confirm') {
    if (!action || action.kind !== 'md-node') return false;
    const nodeId = normalizeText(action.nodeId);
    if (!nodeId || typeof global.removeMdNode !== 'function') return false;
    const deleteChildren = !!(action.scopeOptions && mode === 'all');

    try {
      global.removeMdNode(nodeId, deleteChildren);
      return true;
    } catch (_) {
      return false;
    }
  }

  function runDeleteEdgeAction(action) {
    if (!action || action.kind !== 'edge') return false;
    const edgeId = normalizeText(action.edgeId);
    if (!edgeId || typeof global.removeEdge !== 'function') return false;
    try {
      global.removeEdge(edgeId);
      return true;
    } catch (_) {
      return false;
    }
  }

  function runDeletePermanentCopyAction(action) {
    if (!action || action.kind !== 'permanent-copy') return false;
    const copyId = normalizeText(action.copyId);
    if (!copyId || typeof global.removePermanentSectionCopy !== 'function') return false;

    const escaped = escapeSelector(copyId);
    const sectionEl = (escaped
      ? document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id="${escaped}"]`)
      : null)
      || document.getElementById(`permanent-section-copy-${copyId}`);

    if (!sectionEl) return false;

    try {
      global.removePermanentSectionCopy(sectionEl);
      return true;
    } catch (_) {
      return false;
    }
  }

  function runDirectoryDeleteAction(action, mode = 'confirm') {
    if (!action || typeof action !== 'object') return false;

    switch (normalizeText(action.kind)) {
      case 'temp-section':
        return runDeleteTempSectionAction(action, mode);
      case 'md-node':
        return runDeleteMdNodeAction(action, mode);
      case 'edge':
        return runDeleteEdgeAction(action);
      case 'permanent-copy':
        return runDeletePermanentCopyAction(action);
      default:
        return false;
    }
  }

  function handleRootClick(event) {
    const unpinBtn = event && event.target && event.target.closest ? event.target.closest('.canvas-dir-unpin-btn') : null;
    if (unpinBtn) {
      event.preventDefault();
      event.stopPropagation();
      const nodeKey = unpinBtn.dataset.unpinKey;
      if (nodeKey) {
        removePinnedNodeKey(nodeKey);
      }
      return;
    }

    const pinBtn = event && event.target && event.target.closest ? event.target.closest('.canvas-dir-pin-btn') : null;
    if (pinBtn) {
      event.preventDefault();
      event.stopPropagation();
      const nodeKey = pinBtn.dataset.nodePinKey;
      if (nodeKey) {
        togglePinnedNodeKey(nodeKey);
      }
      return;
    }

    const pinnedBtn = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-pinned-item-btn')
      : null;
    if (pinnedBtn) {
      event.preventDefault();
      event.stopPropagation();
      const nodeKey = pinnedBtn.dataset.nodeKey;
      if (!nodeKey) return;

      activeNodeKey = nodeKey;
      const root = document.getElementById(ROOT_ID);
      updateActiveState(root);

      const clearActiveHighlight = () => {
        global.setTimeout(() => {
          if (activeNodeKey === nodeKey) {
            activeNodeKey = '';
            updateActiveState(root);
          }
        }, 300);
      };

      const target = resolveNodeTarget(nodeKey);
      if (target) {
        if (switchFullscreenNodeByDirectoryTarget(target)) {
          clearActiveHighlight();
          return;
        }
        locateTarget(target);
        clearActiveHighlight();
      }
      return;
    }

    const pinnedSummary = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-pinned-summary')
      : null;
    if (pinnedSummary) {
      const sidebar = document.getElementById('sidebar');
      const isMini = !!(sidebar && sidebar.classList.contains('mini'));
      if (isMini) {
        event.preventDefault();
        event.stopPropagation();
        const folder = pinnedSummary.closest('.canvas-dir-folder');
        if (folder) {
          folder.open = true;
          try { handleFolderToggle(folder); } catch (_) {}
        }
        if (typeof window.setSidebarState === 'function') {
          window.setSidebarState('expanded', { manual: true });
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const folder = pinnedSummary.closest('.canvas-dir-folder');
      if (folder) {
        folder.open = !folder.open;
        handleFolderToggle(folder);
      }
      return;
    }

    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('mini')) {
      event.preventDefault();
      event.stopPropagation();
      const folder = event.target && event.target.closest ? event.target.closest('.canvas-dir-folder') : null;
      if (folder) {
        folder.open = true;
        try { handleFolderToggle(folder); } catch (_) {}
      }
      if (typeof window.setSidebarState === 'function') {
        window.setSidebarState('expanded', { manual: true });
      }
      return;
    }

    const locateBtn = event && event.target && event.target.closest ? event.target.closest('.canvas-dir-folder-locate') : null;
    if (locateBtn) {
      event.preventDefault();
      event.stopPropagation();
      const nodeKey = locateBtn.dataset.nodeLocateKey;
      if (nodeKey) {
        const target = resolveNodeTarget(nodeKey);
        if (target) {
          activeNodeKey = nodeKey;
          const root = document.getElementById(ROOT_ID);
          updateActiveState(root);

          const clearActiveHighlight = () => {
            global.setTimeout(() => {
              if (activeNodeKey === nodeKey) {
                activeNodeKey = '';
                updateActiveState(root);
              }
            }, 300);
          };

          const module = getCanvasModule();
          if (target.kind === 'md-node') {
            if (module && typeof module.selectMdNode === 'function') {
              try { module.selectMdNode(target.nodeId); } catch (_) {}
            }
            locateMdNodeTarget(module, target, 'fit');
          } else {
            locateTarget(target, 'fit');
          }
          clearActiveHighlight();
        }
      }
      return;
    }

    const deleteCurrentBtn = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-folder-delete-current')
      : null;
    if (deleteCurrentBtn) {
      event.preventDefault();
      event.stopPropagation();

      const nodeKey = normalizeText(deleteCurrentBtn.dataset && deleteCurrentBtn.dataset.nodeDeleteKey);
      if (!nodeKey) return;

      const action = nodeDeleteActionMap.get(nodeKey);
      if (!action) {
        clearPendingDeleteUi({ refresh: true });
        return;
      }

      clearPendingDeleteUi();
      runDirectoryDeleteAction(action, 'current');
      queueRefresh({ force: true });
      return;
    }

    const deleteAllBtn = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-folder-delete-all')
      : null;
    if (deleteAllBtn) {
      event.preventDefault();
      event.stopPropagation();

      const nodeKey = normalizeText(deleteAllBtn.dataset && deleteAllBtn.dataset.nodeDeleteKey);
      if (!nodeKey) return;

      const action = nodeDeleteActionMap.get(nodeKey);
      if (!action) {
        clearPendingDeleteUi({ refresh: true });
        return;
      }

      clearPendingDeleteUi();
      runDirectoryDeleteAction(action, 'all');
      queueRefresh({ force: true });
      return;
    }

    const deleteConfirmBtn = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-folder-delete-confirm')
      : null;
    if (deleteConfirmBtn) {
      event.preventDefault();
      event.stopPropagation();

      const nodeKey = normalizeText(deleteConfirmBtn.dataset && deleteConfirmBtn.dataset.nodeDeleteKey);
      if (!nodeKey) return;

      const action = nodeDeleteActionMap.get(nodeKey);
      if (!action) {
        clearPendingDeleteUi({ refresh: true });
        return;
      }

      clearPendingDeleteUi();
      runDirectoryDeleteAction(action, 'confirm');
      queueRefresh({ force: true });
      return;
    }

    const deleteCancelBtn = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-folder-delete-cancel')
      : null;
    if (deleteCancelBtn) {
      event.preventDefault();
      event.stopPropagation();
      clearPendingDeleteUi({ refresh: true });
      return;
    }

    const deleteBtn = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-folder-delete')
      : null;
    if (deleteBtn) {
      event.preventDefault();
      event.stopPropagation();

      const nodeKey = normalizeText(deleteBtn.dataset && deleteBtn.dataset.nodeDeleteKey);
      if (!nodeKey) return;

      const action = nodeDeleteActionMap.get(nodeKey);
      if (!action) return;

      showPendingDeleteUi(nodeKey);
      return;
    }

    if (pendingDeleteUiKey) {
      clearPendingDeleteUi({ refresh: true });
    }

    const toggleBtn = event && event.target && event.target.closest ? event.target.closest('.canvas-dir-folder-toggle') : null;
    if (toggleBtn) {
      const folder = toggleBtn.closest('.canvas-dir-folder');
      if (folder) {
        event.preventDefault();
        event.stopPropagation();
        folder.open = !folder.open;
        handleFolderToggle(folder);
      }
      return;
    }

    const targetEl = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-item-btn, .canvas-dir-folder-summary-btn')
      : null;
    if (!targetEl || !targetEl.dataset) return;

    if (targetEl.classList.contains('canvas-dir-folder-summary-btn')) {
      event.preventDefault();
      event.stopPropagation();
      const folderEl = targetEl.closest('.canvas-dir-folder');
      if (folderEl) {
        folderEl.open = !folderEl.open;
        handleFolderToggle(folderEl);
      }
      return;
    }

    const nodeKey = targetEl.dataset.nodeKey;
    if (!nodeKey) return;

    const target = resolveNodeTarget(nodeKey);
    if (!target) return;

    if (targetEl.classList.contains('canvas-dir-item-btn')) {
      event.preventDefault();
      event.stopPropagation();
    }

    activeNodeKey = nodeKey;
    const root = document.getElementById(ROOT_ID);
    updateActiveState(root);

    const clearActiveHighlight = () => {
      global.setTimeout(() => {
        if (activeNodeKey === nodeKey) {
          activeNodeKey = '';
          updateActiveState(root);
        }
      }, 300);
    };

    if (switchFullscreenNodeByDirectoryTarget(target)) {
      clearActiveHighlight();
      return;
    }
    locateTarget(target);
    clearActiveHighlight();
  }

  function handleGlobalPointerDown(event) {
    if (!pendingDeleteUiKey) return;
    const target = event && event.target ? event.target : null;
    if (!target) return;

    const root = document.getElementById(ROOT_ID);
    if (root && typeof root.contains === 'function' && root.contains(target)) return;

    clearPendingDeleteUi({ refresh: true });
  }

  function bindRootEvents(root) {
    if (!root) return;
    if (root.dataset.canvasDirectoryBound === 'true') return;
    root.dataset.canvasDirectoryBound = 'true';
    root.addEventListener('click', handleRootClick);
    root.addEventListener('toggle', (event) => {
      const details = event.target;
      if (details && details.classList.contains('canvas-dir-folder')) {
        handleFolderToggle(details);
      }
    }, true);
  }

  function renderPreviewDirectory(root, previewState, options = {}) {
    if (!root) return;
    applyDirectoryColorVars(root);
    bindRootEvents(root);
    clearAllFolderUnloadTimers(root);
    nodeActionMap = new Map();
    nodeDeleteActionMap = new Map();

    const openFolderKeys = new Set();
    const previewNodes = buildDirectoryDataForPreview(previewState, options);
    indexDirectoryNodes(previewNodes, root);

    root.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'canvas-dir-root';
    container.__directoryNodeDataMap__ = root.__directoryNodeDataMap__;
    previewNodes.forEach((node) => {
      container.appendChild(renderNode(node, openFolderKeys));
    });
    root.appendChild(container);
  }

  function isCanvasReadyForPruning() {
    return typeof window !== 'undefined' && window.__bookmarkCanvasSearchStateReady === true;
  }

  function buildPinnedSection(directoryNodeDataMap, openFolderKeys) {
    const rawKeys = loadPinnedKeys();
    if (!rawKeys.length) return null;

    pinnedTargetMap.clear();

    const pinnedNodes = [];
    const validKeys = [];
    let hasStaleKeys = false;
    rawKeys.forEach((key) => {
      let node = directoryNodeDataMap.get(key);
      if (!node) {
        const cleanKey = normalizeText(key);
        for (const candidate of directoryNodeDataMap.values()) {
          const tgt = candidate && candidate.target;
          if (!tgt || candidate.placeholder) continue;
          const sId = normalizeText(tgt.sectionId);
          const nId = normalizeText(tgt.nodeId);
          const eId = normalizeText(tgt.edgeId);
          const cId = normalizeText(tgt.copyId);
          if (
            (sId && (cleanKey === sId || cleanKey.endsWith(`-${sId}`) || cleanKey.includes(`-${sId}-`))) ||
            (nId && (cleanKey === nId || cleanKey.endsWith(`-${nId}`) || cleanKey.includes(`-${nId}-`))) ||
            (eId && (cleanKey === eId || cleanKey.endsWith(`-${eId}`) || cleanKey.includes(`-${eId}-`))) ||
            (cId && (cleanKey === cId || cleanKey.endsWith(`-${cId}`) || cleanKey.includes(`-${cId}-`))) ||
            (tgt.kind === 'permanent-main' && (cleanKey === 'permanent-main' || cleanKey === 'folder-permanent'))
          ) {
            node = candidate;
            break;
          }
        }
      }
      if (node && node.target && !node.placeholder) {
        pinnedNodes.push(node);
        validKeys.push(node.key);
        pinnedTargetMap.set(node.key, node.target);
      } else {
        hasStaleKeys = true;
      }
    });

    if (hasStaleKeys && isCanvasReadyForPruning()) {
      savePinnedKeys(validKeys);
    }

    if (!pinnedNodes.length) return null;

    const isEn = isEnglish();
    const isPinnedOpen = getPinnedSectionOpenState();

    const pinnedSectionIds = [];
    const pinnedNodeIds = [];
    const pinnedEdgeIds = [];
    const pinnedCopyIds = [];
    let hasPermanentMain = false;

    pinnedNodes.forEach((node) => {
      const tgt = node && node.target;
      if (!tgt) return;
      const kind = normalizeText(tgt.kind);
      if (kind === 'temp-section' && tgt.sectionId) pinnedSectionIds.push(tgt.sectionId);
      else if (kind === 'md-node' && tgt.nodeId) pinnedNodeIds.push(tgt.nodeId);
      else if (kind === 'edge' && tgt.edgeId) pinnedEdgeIds.push(tgt.edgeId);
      else if (kind === 'permanent-copy' && tgt.copyId) pinnedCopyIds.push(tgt.copyId);
      else if (kind === 'permanent-main') hasPermanentMain = true;
      else if (kind === 'folder-cluster') {
        if (Array.isArray(tgt.sectionIds)) pinnedSectionIds.push(...tgt.sectionIds);
        if (Array.isArray(tgt.nodeIds)) pinnedNodeIds.push(...tgt.nodeIds);
        if (Array.isArray(tgt.edgeIds)) pinnedEdgeIds.push(...tgt.edgeIds);
      }
    });

    const pinnedClusterTarget = {
      kind: 'folder-cluster',
      clusterType: 'pinned',
      sectionIds: pinnedSectionIds,
      nodeIds: pinnedNodeIds,
      edgeIds: pinnedEdgeIds,
      copyIds: pinnedCopyIds,
      hasPermanentMain,
      title: isEn ? 'Pinned' : '置顶'
    };

    pinnedTargetMap.set('folder-pinned', pinnedClusterTarget);

    const details = document.createElement('details');
    details.className = 'canvas-dir-folder canvas-dir-pinned-folder';
    details.dataset.nodeKey = 'folder-pinned';
    details.open = isPinnedOpen;

    const summary = document.createElement('summary');
    summary.className = 'canvas-dir-pinned-summary canvas-dir-folder-summary-btn';
    summary.dataset.nodeKey = 'folder-pinned';
    summary.title = isEn ? `Pinned (${pinnedNodes.length})` : `置顶 (${pinnedNodes.length})`;
    summary.dataset.miniTooltipTitle = summary.title;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'canvas-dir-icon';
    iconWrap.innerHTML = '<i class="fas fa-thumbtack" aria-hidden="true"></i>';
    summary.appendChild(iconWrap);

    const label = document.createElement('span');
    label.className = 'canvas-dir-label';
    const titleEl = document.createElement('span');
    titleEl.className = 'canvas-dir-title';
    titleEl.textContent = isEn ? 'Pinned' : '置顶';
    label.appendChild(titleEl);
    summary.appendChild(label);

    const count = document.createElement('span');
    count.className = 'canvas-dir-count';
    count.textContent = String(pinnedNodes.length);
    summary.appendChild(count);

    details.appendChild(summary);

    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'canvas-dir-children canvas-dir-pinned-children';

    pinnedNodes.forEach((node) => {
      const item = document.createElement('div');
      item.className = 'canvas-dir-item canvas-dir-pinned-item';
      item.dataset.pinnedKey = node.key;
      if (node.variant) item.dataset.nodeVariant = node.variant;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'canvas-dir-item-btn canvas-dir-pinned-item-btn canvas-dir-item-btn-has-delete';
      btn.dataset.nodeKey = node.key;
      if (node.variant) btn.dataset.nodeVariant = node.variant;
      if (node.defaultColor) {
        btn.style.setProperty('--canvas-dir-node-default-color', node.defaultColor);
      }
      if (node.color) {
        item.dataset.nodeColored = 'true';
        item.style.setProperty('--canvas-dir-node-color', node.color);
        btn.style.setProperty('--canvas-dir-node-color', node.color);
        btn.classList.add('canvas-dir-node-colored');
      }
      btn.title = node.title || '';
      btn.dataset.miniTooltipTitle = node.title || '';
      if (node.preview) {
        btn.dataset.miniTooltipSub = clampText(node.preview, 30);
      }

      const iconToUse = node.icon || (node.iconText ? '' : 'fas fa-thumbtack');
      if (iconToUse || node.iconText) {
        btn.appendChild(buildIconElement(iconToUse, {
          iconText: node.iconText,
          iconTone: node.iconTone
        }));
      } else {
        btn.appendChild(buildIconSpacer());
      }

      btn.appendChild(buildLabelElement(node));
      if (typeof node.count === 'number') {
        const count = document.createElement('span');
        count.className = 'canvas-dir-count';
        count.textContent = String(node.count);
        if (node.color) {
          count.style.color = node.color;
        }
        btn.appendChild(count);
      }
      item.appendChild(btn);

      const unpinWrap = document.createElement('span');
      unpinWrap.className = 'canvas-dir-folder-delete-wrap canvas-dir-item-delete-wrap canvas-dir-pinned-unpin-wrap';
      const unpinBtn = document.createElement('span');
      unpinBtn.setAttribute('role', 'button');
      unpinBtn.className = 'canvas-dir-unpin-btn';
      unpinBtn.dataset.unpinKey = node.key;
      const unpinLabel = isEn ? 'Unpin' : '取消置顶';
      unpinBtn.setAttribute('aria-label', unpinLabel);
      unpinBtn.dataset.tooltip = unpinLabel;
      unpinBtn.innerHTML = '<i class="fas fa-ban" aria-hidden="true"></i>';
      unpinWrap.appendChild(unpinBtn);
      item.appendChild(unpinWrap);

      if (node.target) {
        pinnedTargetMap.set(node.key, node.target);
        nodeActionMap.set(node.key, node.target);
      }

      childrenWrap.appendChild(item);
    });

    details.appendChild(childrenWrap);
    return details;
  }

  function refreshDirectory(options = {}) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    applyDirectoryColorVars(root);
    bindRootEvents(root);
    // A remote folder-state write must win over this document's stale DOM snapshot.
    const openFolderKeys = options.preferStoredFolderStates
      ? new Set()
      : collectOpenFolderKeys(root);
    const nodes = buildDirectoryData();
    indexDirectoryNodes(nodes, root);
    const fingerprint = JSON.stringify({
      lang: getLang(),
      nodes: serializeNodesForFingerprint(nodes),
      pinned: loadPinnedKeys(),
      pinnedOpen: getPinnedSectionOpenState()
    });

    if (!options.force && fingerprint === lastFingerprint) {
      updateActiveState(root);
      return;
    }

    lastFingerprint = fingerprint;
    clearAllFolderUnloadTimers(root);
    nodeActionMap = new Map();
    nodeDeleteActionMap = new Map();
    root.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'canvas-dir-root';
    container.__directoryNodeDataMap__ = root.__directoryNodeDataMap__;

    const pinnedSection = buildPinnedSection(root.__directoryNodeDataMap__, openFolderKeys);
    if (pinnedSection) {
      container.appendChild(pinnedSection);
    }

    nodes.forEach((node) => {
      container.appendChild(renderNode(node, openFolderKeys));
    });

    root.appendChild(container);
    updateActiveState(root);
  }

  function isCanvasInteractionActiveForDirectory() {
    const workspace = document.getElementById('canvasWorkspace');
    const module = global.CanvasModule || null;
    const state = module && module.CanvasState ? module.CanvasState : null;
    const resizeState = state && state.sectionCtrlMode && state.sectionCtrlMode.resize;
    const dragging = !!(state && state.dragState && state.dragState.isDragging);
    const touchpadScrolling = !!(state && state.touchpadState && state.touchpadState.isScrolling);
    const inertiaScrolling = !!(state && state.inertiaState && state.inertiaState.isActive);
    const stateBusy = !!(
      dragging ||
      touchpadScrolling ||
      inertiaScrolling ||
      (state && state.isPanning) ||
      (resizeState && resizeState.active)
    );
    const workspaceBusy = !!(workspace && (
      workspace.classList.contains('is-zooming') ||
      workspace.classList.contains('is-scrolling') ||
      workspace.classList.contains('panning') ||
      (workspace.querySelector && workspace.querySelector('.resizing'))
    ));
    return stateBusy || workspaceBusy;
  }

  function scheduleDeferredRefresh() {
    if (refreshDeferredTimer) return;
    refreshDeferredTimer = global.setTimeout(() => {
      refreshDeferredTimer = null;
      queueRefresh({
        force: pendingForceRefresh,
        preferStoredFolderStates: pendingPreferStoredFolderStates
      });
    }, REFRESH_DEFER_MS);
  }

  function isSidebarDirectoryVisible() {
    if (typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return false;
    const sidebar = document.getElementById('sidebar');
    if (sidebar && (sidebar.classList.contains('compact') || (sidebar.dataset && sidebar.dataset.collapseState === 'compact'))) {
      return false;
    }
    const root = document.getElementById(ROOT_ID);
    if (!root || !root.isConnected) return false;
    if (root.style.display === 'none') return false;
    const navTabs = root.closest('.nav-tabs');
    if (navTabs && navTabs.style.display === 'none') return false;
    if (root.offsetWidth === 0 && root.offsetHeight === 0 && root.offsetParent === null) {
      return false;
    }
    return true;
  }

  function onBecameVisible() {
    ensureCanvasObserver();
    if (!isSidebarDirectoryVisible()) return;
    if (hasPendingRefreshOnVisible || !lastFingerprint) {
      hasPendingRefreshOnVisible = false;
      queueRefresh();
    }
  }

  function queueRefresh(options = {}) {
    if (options.force) pendingForceRefresh = true;
    if (options.preferStoredFolderStates) pendingPreferStoredFolderStates = true;
    if (!isSidebarDirectoryVisible()) {
      hasPendingRefreshOnVisible = true;
      return;
    }
    if (lastFingerprint && isCanvasInteractionActiveForDirectory()) {
      scheduleDeferredRefresh();
      return;
    }
    if (refreshRaf) return;
    refreshRaf = global.requestAnimationFrame(() => {
      refreshRaf = null;
      const force = pendingForceRefresh;
      const preferStoredFolderStates = pendingPreferStoredFolderStates;
      pendingForceRefresh = false;
      pendingPreferStoredFolderStates = false;
      if (!isSidebarDirectoryVisible()) {
        hasPendingRefreshOnVisible = true;
        if (force) pendingForceRefresh = true;
        if (preferStoredFolderStates) pendingPreferStoredFolderStates = true;
        return;
      }
      if (lastFingerprint && isCanvasInteractionActiveForDirectory()) {
        if (force) pendingForceRefresh = true;
        if (preferStoredFolderStates) pendingPreferStoredFolderStates = true;
        scheduleDeferredRefresh();
        return;
      }
      refreshDirectory({ force, preferStoredFolderStates });
    });
  }

  function getMutationElement(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    return node.parentElement || null;
  }

  function isDirectoryIgnoredMutationScope(element) {
    if (!element || !element.closest) return false;
    return !!element.closest([
      '.canvas-edges',
      '.bookmark-tree',
      '.temp-bookmark-tree',
      '.tree-node',
      '.tree-item',
      '.tree-children',
      '.tree-load-more',
      '.tree-load-more-root',
      '.temp-node-description',
      '.temp-node-description-controls',
      '.temp-node-actions',
      '.temp-color-popover',
      '.resize-handle',
      '.temp-node-resize-handle',
      '.canvas-node-anchor',
      '.canvas-anchor-zone'
    ].join(','));
  }

  function nodeTouchesDirectoryCardShell(node) {
    const element = getMutationElement(node);
    if (!element || !element.matches) return false;
    if (isDirectoryIgnoredMutationScope(element)) return false;

    const cardSelector = '.temp-canvas-node, .md-canvas-node, .permanent-bookmark-section';
    if (element.matches(cardSelector)) return true;
    if (element.querySelector && element.querySelector(cardSelector)) return true;

    const titleSelector = [
      '.temp-node-header',
      '.temp-node-title-container',
      '.temp-node-sequence-badge',
      '.permanent-section-title',
      '.md-canvas-header',
      '.md-canvas-title'
    ].join(',');
    return element.matches(titleSelector) || !!(element.querySelector && element.querySelector(titleSelector));
  }

  function shouldRefreshForCanvasMutations(mutations) {
    if (!Array.isArray(mutations) && !(mutations && typeof mutations.length === 'number')) return true;

    for (const mutation of mutations) {
      if (!mutation) continue;

      if (mutation.type === 'attributes') {
        const target = getMutationElement(mutation.target);
        if (!target || isDirectoryIgnoredMutationScope(target)) continue;
        const attr = normalizeText(mutation.attributeName);
        if (attr === 'style' || attr === 'class') continue;
        if (nodeTouchesDirectoryCardShell(target)) return true;
        continue;
      }

      if (mutation.type !== 'childList') continue;

      const target = getMutationElement(mutation.target);
      if (target && isDirectoryIgnoredMutationScope(target)) continue;
      if (target && target.matches && target.matches('.temp-canvas-node, .md-canvas-node, .permanent-bookmark-section')) {
        return true;
      }

      const added = Array.from(mutation.addedNodes || []);
      const removed = Array.from(mutation.removedNodes || []);
      if (added.some(nodeTouchesDirectoryCardShell) || removed.some(nodeTouchesDirectoryCardShell)) {
        return true;
      }
    }

    return false;
  }

  function ensureCanvasObserver() {
    const canvasContent = document.getElementById(CANVAS_CONTENT_ID);
    if (canvasContent === observedCanvasContent) return;

    if (canvasObserver) {
      canvasObserver.disconnect();
      canvasObserver = null;
    }

    observedCanvasContent = canvasContent;
    if (!canvasContent) return;

    canvasObserver = new MutationObserver((mutations) => {
      if (shouldRefreshForCanvasMutations(mutations)) {
        queueRefresh();
      }
    });
    canvasObserver.observe(canvasContent, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'data-section-id', 'data-permanent-section-copy-id', 'data-node-id', 'data-edge-id']
    });
  }

  function formatTime24h(dateObj) {
    const h = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    const s = String(dateObj.getSeconds()).padStart(2, '0');
    return `${h}:${min}:${s}`;
  }

  function formatAbsoluteTime(timestamp, isEn) {
    if (!timestamp) return '';
    const dateObj = new Date(timestamp);
    const timeShortStr = formatTime24h(dateObj);
    if (isEn) {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const m = monthNames[dateObj.getMonth()];
      const d = dateObj.getDate();
      return `${timeShortStr} │ ${m} ${d}`;
    } else {
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${timeShortStr} │ ${m}月${d}日`;
    }
  }

  function getCanvasOtherSettingsSafe() {
    if (global.CanvasModule && typeof global.CanvasModule.getCanvasOtherSettings === 'function') {
      return global.CanvasModule.getCanvasOtherSettings();
    }
    try {
      const raw = localStorage.getItem('canvas-other-settings-v1');
      if (raw) return JSON.parse(raw);
      
      const legacyRaw = localStorage.getItem('canvasOtherSettings');
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy === 'object') {
          localStorage.setItem('canvas-other-settings-v1', JSON.stringify(legacy));
          return legacy;
        }
      }
    } catch (_) {}
    return { manualAnchorLimit: 10, tempAnchorLimit: 10 };
  }

  function saveCanvasOtherSettingsInline(settings) {
    if (global.saveSharedState) {
      global.saveSharedState('canvas-other-settings-v1', settings);
    } else {
      localStorage.setItem('canvas-other-settings-v1', JSON.stringify(settings));
    }
    window.dispatchEvent(new CustomEvent('canvas-other-settings-updated', { detail: settings }));
    window.dispatchEvent(new CustomEvent('shared-state-updated', { detail: { key: 'canvas-other-settings-v1', value: settings } }));
  }

  function getManualAnchorLimit() {
    return 10;
  }

  function getTempAnchorLimit() {
    return 10;
  }

  function isCanvasNodeFullscreenActive() {
    try {
      if (document.body && document.body.classList.contains('canvas-node-maximized-active')) return true;
    } catch (_) {}
    try {
      return !!document.querySelector('.canvas-node-maximized');
    } catch (_) {
      return false;
    }
  }

  function getAnchorMutationBlockedMessage(isEn) {
    return isEn
      ? 'Anchors cannot be added or changed while a card is fullscreen.'
      : '卡片全屏模式下无法添加或修改锚点';
  }

  function showAnchorMutationBlockedToast(isEn) {
    const msg = getAnchorMutationBlockedMessage(isEn);
    showSidebarToast(msg, 'warning');
  }

  async function exitCanvasNodeFullscreenForAnchorLocate() {
    if (!isCanvasNodeFullscreenActive()) return true;

    const active = document.querySelector('.canvas-node-maximized');
    if (!active || !active.classList) return false;

    const fullscreenBtn = active.querySelector(
      '.canvas-node-fullscreen-btn, .permanent-section-fullscreen-btn, .temp-node-fullscreen-btn, .md-node-toolbar-btn[data-action="md-fullscreen"]'
    );
    if (!fullscreenBtn || typeof fullscreenBtn.click !== 'function') return false;

    try {
      fullscreenBtn.click();
    } catch (_) {
      return false;
    }

    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return !isCanvasNodeFullscreenActive();
  }

  async function navigateToViewportFromAnchor(anchor) {
    if (!anchor) return false;

    if (isCanvasNodeFullscreenActive()) {
      const exited = await exitCanvasNodeFullscreenForAnchorLocate();
      if (!exited) return false;
    }

    if (global.CanvasModule && typeof global.CanvasModule.navigateToViewport === 'function') {
      return global.CanvasModule.navigateToViewport(anchor);
    }
    return false;
  }

  function loadAnchorSlots() {
    let slots = [];
    try {
      const raw = localStorage.getItem('canvasManualAnchorSlots');
      if (raw) slots = JSON.parse(raw);
    } catch (_) {}
    if (!Array.isArray(slots)) {
      slots = [];
    }
    const limit = getManualAnchorLimit();
    const validSlots = slots.filter(s => s !== null && typeof s === 'object').slice(0, limit);
    while (validSlots.length < limit) {
      validSlots.push(null);
    }
    return validSlots;
  }

  const MANUAL_REMEMBERED_SLOT_KEY = 'canvas-manual-anchor-remembered-slot';
  let rememberedSlotIndex = null;
  try {
    const savedManualSlot = localStorage.getItem(MANUAL_REMEMBERED_SLOT_KEY);
    if (savedManualSlot !== null) {
      const parsed = parseInt(savedManualSlot, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        rememberedSlotIndex = parsed;
      }
    }
  } catch (_) {}

  function saveRememberedSlotIndex(index) {
    rememberedSlotIndex = (typeof index === 'number' && !isNaN(index) && index >= 0) ? index : null;
    try {
      if (rememberedSlotIndex === null) {
        localStorage.removeItem(MANUAL_REMEMBERED_SLOT_KEY);
      } else {
        localStorage.setItem(MANUAL_REMEMBERED_SLOT_KEY, String(rememberedSlotIndex));
      }
    } catch (_) {}
  }

  function saveAnchorSlots(slots) {
    try {
      localStorage.setItem('canvasManualAnchorSlots', JSON.stringify(slots));
    } catch (e) {
      console.error('Failed to save manual anchor slots:', e);
    }
    window.dispatchEvent(new CustomEvent('storage', { key: 'canvasManualAnchorSlots' }));
  }

  function findAdjacentValidSlotIndex(slots, deletedIndex) {
    if (!Array.isArray(slots)) return null;
    for (let i = deletedIndex + 1; i < slots.length; i++) {
      if (slots[i] && typeof slots[i] === 'object') return i;
    }
    for (let i = deletedIndex - 1; i >= 0; i--) {
      if (slots[i] && typeof slots[i] === 'object') return i;
    }
    return null;
  }

  function handleSlotAction(action, index, btnEl) {
    const slots = loadAnchorSlots();
    const isEn = isEnglish();

    if (action === 'save') {
      if (isCanvasNodeFullscreenActive()) {
        showAnchorMutationBlockedToast(isEn);
        return;
      }

      const state = global.CanvasModule && global.CanvasModule.CanvasState;
      if (!state) return;

      const workspace = document.getElementById('canvasWorkspace');
      const wsW = (workspace && workspace.clientWidth > 50) ? workspace.clientWidth : (window.innerWidth > 50 ? window.innerWidth : 800);
      const wsH = (workspace && workspace.clientHeight > 50) ? workspace.clientHeight : (window.innerHeight > 50 ? window.innerHeight : 600);
      const z = (state.zoom && state.zoom > 0) ? state.zoom : 1;
      const worldX = Math.round(((wsW / 2 - state.panOffsetX) / z) * 100) / 100;
      const worldY = Math.round(((wsH / 2 - state.panOffsetY) / z) * 100) / 100;
      
      const existingName = slots[index] ? slots[index].name : null;
      const defaultName = existingName || generateAnchorTimeName(slots);
      
      slots[index] = {
        name: defaultName,
        x: worldX,
        y: worldY,
        zoom: z,
        coordType: 'world',
        timestamp: Date.now()
      };
      highlightSlotIndex = index;
      saveRememberedSlotIndex(index);
      saveAnchorSlots(slots);
      renderHistoryPanel();
      const badgeNum = (index < 10) ? String((index + 1) % 10) : String(index + 1);
      showSidebarToast(isEn ? 'Viewport saved to slot' : '视口已保存至槽位', { type: 'success', badge: badgeNum, isTemp: false });
    } 
    else if (action === 'locate') {
      const slot = slots[index];
      if (!slot) return;
      saveRememberedSlotIndex(index);
      navigateToViewportFromAnchor(slot).then(() => {
        setTimeout(renderHistoryPanel, 50);
      });
      const slotNum = index + 1;
      const badgeNum = (index < 10) ? String((index + 1) % 10) : String(slotNum);
      const displayName = slot.name || (isEn ? `Slot ${slotNum}` : `槽位 ${slotNum}`);
      showSidebarToast(isEn ? `Anchor: ${displayName}` : `已切换至锚点：${displayName}`, { type: 'info', badge: badgeNum, isTemp: false });
    }
    else if (action === 'rename') {
      const slot = slots[index];
      if (!slot) return;
      
      const row = btnEl ? btnEl.closest('.anchor-slot-row') : null;
      if (row && row.querySelector('.anchor-slot-rename-input')) {
        return; // Already editing
      }
      
      const span = row ? row.querySelector('.anchor-slot-name') : null;
      if (!span) {
        // Fallback
        const newName = prompt(isEn ? 'Enter a new name for the slot:' : '请输入新的槽位名称：', slot.name || '');
        if (newName === null) return;
        const trimmed = newName.trim();
        if (trimmed) {
          slot.name = trimmed;
          saveAnchorSlots(slots);
          renderHistoryPanel();
        }
        return;
      }
      
      const currentValue = slot.name || (isEn ? `Slot ${index + 1}` : `槽位 ${index + 1}`);
      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'anchor-slot-rename-input';
      input.className = 'anchor-slot-rename-input';
      input.value = currentValue;
      
      span.parentNode.replaceChild(input, span);
      input.focus();
      input.select();
      
      input.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      input.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      
      let isFinished = false;
      const finish = (save) => {
        if (isFinished) return;
        isFinished = true;
        if (save) {
          const trimmed = input.value.trim();
          if (trimmed) {
            slot.name = trimmed;
            saveAnchorSlots(slots);
          }
        }
        renderHistoryPanel();
      };
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.isComposing) return;
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          if (e.isComposing) return;
          e.preventDefault();
          finish(false);
        }
      });
      
      input.addEventListener('blur', () => {
        finish(true);
      });
    } 
    else if (action === 'delete') {
      const validSlots = slots.filter(s => s && typeof s === 'object');
      if (index >= 0 && index < validSlots.length) {
        validSlots.splice(index, 1);
      }
      const limit = getManualAnchorLimit();
      const newSlots = [...validSlots];
      while (newSlots.length < limit) {
        newSlots.push(null);
      }
      if (rememberedSlotIndex !== null) {
        if (rememberedSlotIndex === index) {
          if (validSlots.length === 0) {
            saveRememberedSlotIndex(null);
          } else if (index < validSlots.length) {
            saveRememberedSlotIndex(index);
          } else {
            saveRememberedSlotIndex(validSlots.length - 1);
          }
        } else if (rememberedSlotIndex > index) {
          saveRememberedSlotIndex(rememberedSlotIndex - 1);
        }
      }
      if (highlightSlotIndex !== null) {
        if (highlightSlotIndex === index) {
          highlightSlotIndex = null;
        } else if (highlightSlotIndex > index) {
          highlightSlotIndex = highlightSlotIndex - 1;
        }
      }
      const remainingCount = validSlots.length;
      const step = getDynamicStep();
      if (manualAnchorVisibleLimit > Math.max(step, remainingCount)) {
        manualAnchorVisibleLimit = Math.max(step, remainingCount);
        try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
      }
      saveAnchorSlots(newSlots);
      renderHistoryPanel();
    }
  }

  function getDynamicStep() {
    return 10;
  }

  let anchorSettingsOpen = false;
  let isTempWorkspaceMode = false; // 临时工作区模式开关
  let tempAnchorVisibleLimit = 10;

  let manualAnchorVisibleLimit = 10;
  try {
    const saved = localStorage.getItem('canvas-manual-anchor-visible-limit');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 10) manualAnchorVisibleLimit = parsed;
    }
  } catch (_) {}
  
  const TEMP_ANCHOR_ENABLED_STORAGE_KEY = 'canvas-temp-anchor-enabled';
  let isTempAnchorEnabled = false; // 临时锚点手动开关，支持持久化存储
  try {
    const savedTempEnabled = localStorage.getItem(TEMP_ANCHOR_ENABLED_STORAGE_KEY);
    if (savedTempEnabled !== null) {
      isTempAnchorEnabled = (savedTempEnabled === 'true');
    } else {
      const currentSettings = getCanvasOtherSettingsSafe();
      if (typeof currentSettings.tempAnchorEnabled === 'boolean') {
        isTempAnchorEnabled = currentSettings.tempAnchorEnabled;
      }
    }
  } catch (_) {}

  function saveTempAnchorEnabledState(enabled) {
    isTempAnchorEnabled = !!enabled;
    try {
      localStorage.setItem(TEMP_ANCHOR_ENABLED_STORAGE_KEY, isTempAnchorEnabled ? 'true' : 'false');
      const currentSettings = getCanvasOtherSettingsSafe();
      currentSettings.tempAnchorEnabled = isTempAnchorEnabled;
      saveCanvasOtherSettingsInline(currentSettings);
    } catch (_) {}
  }
  let tempAnchorSlots = []; // 临时锚点仅存于当前页面/侧边栏内存中，各窗口完全独立，刷新页面即清空
  let highlightSlotIndex = null;
  let highlightTempSlotIndex = null;
  let rememberedTempSlotIndex = null;

  function loadTempAnchorSlots() {
    const limit = getTempAnchorLimit();
    if (!Array.isArray(tempAnchorSlots)) {
      tempAnchorSlots = [];
    }
    const validSlots = tempAnchorSlots.filter(s => s !== null && typeof s === 'object').slice(0, limit);
    while (validSlots.length < limit) {
      validSlots.push(null);
    }
    tempAnchorSlots = validSlots;
    return tempAnchorSlots;
  }

  function saveTempAnchorSlots(slots) {
    tempAnchorSlots = slots;
    try {
      window.__canvasTempAnchorSlots = slots;
    } catch (_) {}
  }

  function isMacPlatform() {
    return /Mac|iPod|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  }

  function navigateManualAnchorSlot(direction) {
    const slots = loadAnchorSlots();
    const validIndices = [];
    slots.forEach((s, idx) => {
      if (s && typeof s === 'object') {
        validIndices.push(idx);
      }
    });

    const isEn = isEnglish();

    if (validIndices.length === 0) {
      showSidebarToast(isEn ? 'No manual anchors yet' : '暂无手动锚点', 'warning');
      return false;
    }

    let targetIndex = null;
    // 首次使用为第一有效槽位锚点，后续按记忆中的锚点切换
    if (rememberedSlotIndex === null || !validIndices.includes(rememberedSlotIndex)) {
      targetIndex = validIndices[0];
    } else {
      const currentPos = validIndices.indexOf(rememberedSlotIndex);
      if (direction === 'prev') {
        const prevPos = (currentPos - 1 + validIndices.length) % validIndices.length;
        targetIndex = validIndices[prevPos];
      } else {
        const nextPos = (currentPos + 1) % validIndices.length;
        targetIndex = validIndices[nextPos];
      }
    }

    saveRememberedSlotIndex(targetIndex);
    const targetSlot = slots[targetIndex];
    if (!targetSlot) return false;

    const targetSlotOrder = validIndices.indexOf(targetIndex) + 1;
    if (manualAnchorVisibleLimit < targetSlotOrder) {
      manualAnchorVisibleLimit = Math.max(manualAnchorVisibleLimit, targetSlotOrder);
      try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
    }

    highlightSlotIndex = targetIndex;

    navigateToViewportFromAnchor(targetSlot).then(() => {
      renderHistoryPanel();
    });

    const slotNum = targetIndex + 1;
    const badgeNum = (targetIndex < 10) ? String((targetIndex + 1) % 10) : String(slotNum);
    const displayName = targetSlot.name || (isEn ? `Slot ${slotNum}` : `槽位 ${slotNum}`);
    showSidebarToast(isEn ? `Anchor: ${displayName}` : `已切换至锚点：${displayName}`, { type: 'info', badge: badgeNum, isTemp: false });

    return true;
  }

  function navigateTempAnchorSlot(direction) {
    const isEn = isEnglish();

    const slots = loadTempAnchorSlots();
    const validIndices = [];
    slots.forEach((s, idx) => {
      if (s && typeof s === 'object') {
        validIndices.push(idx);
      }
    });

    if (validIndices.length === 0) {
      showSidebarToast(isEn ? 'No temporary anchors yet' : '暂无临时锚点', 'warning');
      return false;
    }

    let targetIndex = null;
    // 首次使用为第一有效槽位锚点，后续按记忆中的锚点切换
    if (rememberedTempSlotIndex === null || !validIndices.includes(rememberedTempSlotIndex)) {
      targetIndex = validIndices[0];
    } else {
      const currentPos = validIndices.indexOf(rememberedTempSlotIndex);
      if (direction === 'prev') {
        const prevPos = (currentPos - 1 + validIndices.length) % validIndices.length;
        targetIndex = validIndices[prevPos];
      } else {
        const nextPos = (currentPos + 1) % validIndices.length;
        targetIndex = validIndices[nextPos];
      }
    }

    rememberedTempSlotIndex = targetIndex;
    const targetSlot = slots[targetIndex];
    if (!targetSlot) return false;

    const targetSlotOrder = validIndices.indexOf(targetIndex) + 1;
    if (tempAnchorVisibleLimit < targetSlotOrder) {
      tempAnchorVisibleLimit = Math.max(tempAnchorVisibleLimit, targetSlotOrder);
    }

    highlightTempSlotIndex = targetIndex;

    navigateToViewportFromAnchor(targetSlot).then(() => {
      renderHistoryPanel();
    });

    const slotNum = targetIndex + 1;
    const badgeNum = (targetIndex < 10) ? String((targetIndex + 1) % 10) : String(slotNum);
    const displayName = targetSlot.name || (isEn ? `Temp Slot ${slotNum}` : `临时槽位 ${slotNum}`);
    showSidebarToast(isEn ? `Temp Anchor: ${displayName}` : `已切换至临时锚点：${displayName}`, { type: 'info', badge: badgeNum, isTemp: true });

    return true;
  }

  function showSidebarToast(msg, typeOrOptions = 'info') {
    let type = 'info';
    let forceFresh = false;
    let badge = null;
    let isTemp = false;
    if (typeof typeOrOptions === 'string') {
      type = typeOrOptions;
    } else if (typeOrOptions && typeof typeOrOptions === 'object') {
      if (typeOrOptions.type) type = typeOrOptions.type;
      if (typeOrOptions.forceFresh) forceFresh = true;
      if (typeOrOptions.badge !== undefined && typeOrOptions.badge !== null) badge = String(typeOrOptions.badge);
      if (typeOrOptions.isTemp) isTemp = true;
    }

    const safeMsg = String(msg || '');
    if (!badge) {
      const slotMatch = safeMsg.match(/(?:槽位|Slot|锚点)\s*([1-9]|10)\b/i);
      if (slotMatch) {
        const rawNum = parseInt(slotMatch[1], 10);
        if (!isNaN(rawNum) && rawNum >= 1 && rawNum <= 10) {
          badge = (rawNum === 10) ? '0' : String(rawNum);
        }
      }
      if (safeMsg.includes('临时') || safeMsg.toLowerCase().includes('temp')) {
        isTemp = true;
      }
    }

    const isWarn = type === 'warning' || type === 'error';
    const isSuccess = type === 'success';
    const icon = isWarn ? 'fas fa-exclamation-triangle' : (isSuccess ? 'fas fa-check-circle' : 'fas fa-info-circle');
    const toastOptions = {
      type: type,
      icon: icon,
      duration: 2500,
      forceFresh: forceFresh || isWarn || isSuccess,
      badge: badge,
      isTemp: isTemp
    };

    // 针对警告类、成功类（如添加/保存锚点）或显式 forceFresh 提示，强制清理旧的残留 Toast 节点，确保每次点击都重新触发进场动效
    if (toastOptions.forceFresh) {
      try {
        const root = (typeof getOverlayContainer === 'function' ? getOverlayContainer() : null) || document.body;
        if (root) {
          root.querySelectorAll('.canvas-toast, .history-toast, .app-toast').forEach(t => t.remove());
        }
      } catch (_) {}
    }

    // 1. 优先调用当前上下文的统一 Canvas Toast
    if (typeof global.showCanvasToast === 'function') {
      try { return global.showCanvasToast(msg, toastOptions); } catch (_) {}
    }
    if (typeof window !== 'undefined' && typeof window.showCanvasToast === 'function') {
      try { return window.showCanvasToast(msg, toastOptions); } catch (_) {}
    }
    if (typeof global.showToast === 'function') {
      try { return global.showToast(msg, toastOptions); } catch (_) {}
    }
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      try { return window.showToast(msg, toastOptions); } catch (_) {}
    }

    // 2. 跨 frame 降级尝试（如果处在 panel-shell iframe 中）
    try {
      if (typeof top !== 'undefined' && top && typeof top.showCanvasToast === 'function') {
        return top.showCanvasToast(msg, toastOptions);
      }
      if (typeof top !== 'undefined' && top && typeof top.showToast === 'function') {
        return top.showToast(msg, toastOptions);
      }
    } catch (_) {}

    // 3. 强力原生 DOM 兜底，保证无论何种情况都有可见 Toast 弹出
    try {
      const existing = document.querySelector('.canvas-toast, .history-toast, .app-toast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.className = `canvas-toast history-toast app-toast toast-type-${type}${isWarn ? ' toast-shake' : ''}`;
      const borderColor = isWarn ? '#f59e0b' : (isSuccess ? '#10b981' : '#3b82f6');
      toast.style.cssText = `position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:9999999;display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:500;color:#ffffff;background:#1e1e20;border:1.5px solid ${borderColor};box-shadow:0 4px 14px rgba(0,0,0,0.28);pointer-events:none;max-width:min(420px, calc(100vw - 24px));`;
      
      const iconEl = document.createElement('i');
      iconEl.className = `toast-icon ${icon}`;
      toast.appendChild(iconEl);

      if (badge !== null && badge !== undefined && badge !== '') {
        const badgeEl = document.createElement('span');
        badgeEl.className = `toast-slot-badge${isTemp ? ' in-temp-mode' : ''}`;
        badgeEl.textContent = String(badge);
        toast.appendChild(badgeEl);
      }

      const textEl = document.createElement('span');
      textEl.className = 'toast-message';
      textEl.textContent = safeMsg;
      toast.appendChild(textEl);
      (document.body || document.documentElement).appendChild(toast);
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
    } catch (_) {
      alert(msg);
    }
  }

  function findExistingAnchorInSlots(slots, targetX, targetY, targetZoom, workspace) {
    if (!Array.isArray(slots)) return null;
    const ws = workspace || document.getElementById('canvasWorkspace');
    const wsW = (ws && ws.clientWidth > 50) ? ws.clientWidth : (window.innerWidth > 50 ? window.innerWidth : 800);
    const wsH = (ws && ws.clientHeight > 50) ? ws.clientHeight : (window.innerHeight > 50 ? window.innerHeight : 600);

    const tX = Number(targetX);
    const tY = Number(targetY);
    const tZ = (Number.isFinite(Number(targetZoom)) && Number(targetZoom) > 0) ? Number(targetZoom) : 1;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot || typeof slot !== 'object') continue;

      const rawX = Number(slot.x);
      const rawY = Number(slot.y);
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) continue;

      const sZ = (Number.isFinite(Number(slot.zoom)) && Number(slot.zoom) > 0) ? Number(slot.zoom) : 1;
      const dz = Math.abs(sZ - tZ);
      // 缩放容差：允许合理微调
      if (dz > 0.08) continue;

      // 1. 直接世界坐标比对（标准格式及已转换格式）
      const dxDirect = Math.abs(rawX - tX);
      const dyDirect = Math.abs(rawY - tY);
      if (dxDirect <= 25.0 && dyDirect <= 25.0) {
        return { slot, index: i };
      }

      // 2. 屏幕偏移转换为世界坐标比对（旧格式向下兼容）
      if (slot.coordType !== 'world') {
        const convWorldX = Math.round(((wsW / 2 - rawX) / sZ) * 100) / 100;
        const convWorldY = Math.round(((wsH / 2 - rawY) / sZ) * 100) / 100;
        const dxConv = Math.abs(convWorldX - tX);
        const dyConv = Math.abs(convWorldY - tY);
        if (dxConv <= 25.0 && dyConv <= 25.0) {
          return { slot, index: i };
        }
      }
    }
    return null;
  }

  function generateAnchorTimeName(slots, date = new Date()) {
    const isEn = isEnglish();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    let dateStr = '';
    if (isEn) {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const m = monthNames[date.getMonth()];
      const d = date.getDate();
      dateStr = `${m} ${d}`;
    } else {
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      dateStr = `${m}月${d}日`;
    }

    const baseName = `${timeStr} │ ${dateStr}`;

    if (!Array.isArray(slots) || slots.length === 0) {
      return baseName;
    }

    const existingNames = new Set(slots.filter(Boolean).map(s => s.name));
    if (!existingNames.has(baseName)) {
      return baseName;
    }

    let count = 2;
    while (existingNames.has(`${baseName} (${count})`)) {
      count++;
    }
    return `${baseName} (${count})`;
  }

  function getNextAnchorSlotNumber(slots, isTemp = false) {
    const prefixZh = isTemp ? '临时槽位 ' : '槽位 ';
    const prefixEn = isTemp ? 'Temp Slot ' : 'Slot ';
    let maxNum = 0;
    (slots || []).forEach(s => {
      if (!s || !s.name) return;
      const mZh = s.name.match(new RegExp(`^${prefixZh}(\\d+)$`));
      const mEn = s.name.match(new RegExp(`^${prefixEn}(\\d+)$`));
      const match = mZh || mEn;
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    const validCount = (slots || []).filter(s => s !== null && typeof s === 'object').length;
    return Math.max(maxNum + 1, validCount + 1);
  }

  function addManualAnchorFromCurrentViewport() {
    const isEn = isEnglish();
    if (isCanvasNodeFullscreenActive()) {
      showAnchorMutationBlockedToast(isEn);
      return false;
    }

    const state = getCanvasState() || (global.CanvasModule && global.CanvasModule.CanvasState) || (window.CanvasModule && window.CanvasModule.CanvasState) || window.CanvasState;
    if (!state) {
      showSidebarToast(isEn ? 'Canvas not ready' : '画布尚未就绪', 'warning');
      return false;
    }

    const workspace = document.getElementById('canvasWorkspace');
    const wsW = (workspace && workspace.clientWidth > 50) ? workspace.clientWidth : (window.innerWidth > 50 ? window.innerWidth : 800);
    const wsH = (workspace && workspace.clientHeight > 50) ? workspace.clientHeight : (window.innerHeight > 50 ? window.innerHeight : 600);
    const z = (state.zoom && state.zoom > 0) ? state.zoom : 1;
    const worldX = Math.round(((wsW / 2 - state.panOffsetX) / z) * 100) / 100;
    const worldY = Math.round(((wsH / 2 - state.panOffsetY) / z) * 100) / 100;

    const slots = loadAnchorSlots();
    const validSlots = slots.filter(s => s !== null && typeof s === 'object');
    const manualAnchorLimit = getManualAnchorLimit();

    // 检查当前视口是否已存在于手动锚点中（同一位置防连续重复添加）
    const existing = findExistingAnchorInSlots(validSlots, worldX, worldY, z, workspace);
    if (existing) {
      const existingName = existing.slot.name || (isEn ? `Slot ${existing.index + 1}` : `槽位 ${existing.index + 1}`);
      const msg = isEn 
        ? `Manual anchor already exists: "${existingName}"` 
        : `当前手动锚点已存在：“${existingName}”`;
      if (manualAnchorVisibleLimit < existing.index + 1) {
        manualAnchorVisibleLimit = existing.index + 1;
        try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
      }
      highlightSlotIndex = existing.index;
      saveRememberedSlotIndex(existing.index);
      renderHistoryPanel();
      const existingBadge = (existing.index < 10) ? String((existing.index + 1) % 10) : String(existing.index + 1);
      showSidebarToast(msg, { type: 'warning', forceFresh: true, badge: existingBadge, isTemp: false });
      return false;
    }

    if (validSlots.length >= manualAnchorLimit) {
      const msg = isEn 
        ? 'Manual anchors are full (maximum 10).' 
        : '手动锚点已满（上限 10 个）。';
      showSidebarToast(msg, { type: 'warning', forceFresh: true });
      return false;
    }

    const nextIndex = validSlots.length;
    const defaultName = generateAnchorTimeName(validSlots);

    const newSlot = {
      name: defaultName,
      x: worldX,
      y: worldY,
      zoom: z,
      coordType: 'world',
      timestamp: Date.now()
    };

    validSlots.push(newSlot);

    const newSlots = [...validSlots];
    while (newSlots.length < manualAnchorLimit) {
      newSlots.push(null);
    }

    if (manualAnchorVisibleLimit < validSlots.length) {
      manualAnchorVisibleLimit = validSlots.length;
      try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
    }

    highlightSlotIndex = nextIndex;
    saveRememberedSlotIndex(nextIndex);
    saveAnchorSlots(newSlots);
    renderHistoryPanel();

    const badgeNum = (nextIndex < 10) ? String((nextIndex + 1) % 10) : String(nextIndex + 1);
    showSidebarToast(isEn ? `Added manual anchor: ${defaultName}` : `已添加手动锚点：${defaultName}`, { type: 'success', forceFresh: true, badge: badgeNum, isTemp: false });
    return true;
  }

  function addTempAnchorFromCurrentViewport() {
    const isEn = isEnglish();

    if (isCanvasNodeFullscreenActive()) {
      showAnchorMutationBlockedToast(isEn);
      return false;
    }

    const state = getCanvasState() || (global.CanvasModule && global.CanvasModule.CanvasState) || (window.CanvasModule && window.CanvasModule.CanvasState) || window.CanvasState;
    if (!state) {
      showSidebarToast(isEn ? 'Canvas not ready' : '画布尚未就绪', 'warning');
      return false;
    }

    const workspace = document.getElementById('canvasWorkspace');
    const wsW = (workspace && workspace.clientWidth > 50) ? workspace.clientWidth : (window.innerWidth > 50 ? window.innerWidth : 800);
    const wsH = (workspace && workspace.clientHeight > 50) ? workspace.clientHeight : (window.innerHeight > 50 ? window.innerHeight : 600);
    const z = (state.zoom && state.zoom > 0) ? state.zoom : 1;
    const worldX = Math.round(((wsW / 2 - state.panOffsetX) / z) * 100) / 100;
    const worldY = Math.round(((wsH / 2 - state.panOffsetY) / z) * 100) / 100;

    const slots = loadTempAnchorSlots();
    const validSlots = slots.filter(s => s !== null && typeof s === 'object');
    const tempAnchorLimit = getTempAnchorLimit();

    // 检查当前视口是否已存在于临时锚点中（同一位置防连续重复添加）
    const existing = findExistingAnchorInSlots(validSlots, worldX, worldY, z, workspace);
    if (existing) {
      const existingName = existing.slot.name || (isEn ? `Temp Slot ${existing.index + 1}` : `临时槽位 ${existing.index + 1}`);
      const msg = isEn 
        ? `Temporary anchor already exists: "${existingName}"` 
        : `当前临时锚点已存在：“${existingName}”`;
      if (tempAnchorVisibleLimit < existing.index + 1) {
        tempAnchorVisibleLimit = existing.index + 1;
      }
      highlightTempSlotIndex = existing.index;
      rememberedTempSlotIndex = existing.index;
      renderHistoryPanel();
      const existingBadge = (existing.index < 10) ? String((existing.index + 1) % 10) : String(existing.index + 1);
      showSidebarToast(msg, { type: 'warning', forceFresh: true, badge: existingBadge, isTemp: true });
      return false;
    }

    if (validSlots.length >= tempAnchorLimit) {
      const msg = isEn 
        ? 'Temporary anchors are full (maximum 10).' 
        : '临时锚点已满（上限 10 个）。';
      showSidebarToast(msg, { type: 'warning', forceFresh: true });
      return false;
    }

    const nextIndex = validSlots.length;
    const defaultName = generateAnchorTimeName(validSlots);

    const newSlot = {
      name: defaultName,
      x: worldX,
      y: worldY,
      zoom: z,
      coordType: 'world',
      timestamp: Date.now()
    };

    validSlots.push(newSlot);

    const newSlots = [...validSlots];
    while (newSlots.length < tempAnchorLimit) {
      newSlots.push(null);
    }

    if (tempAnchorVisibleLimit < validSlots.length) {
      tempAnchorVisibleLimit = validSlots.length;
    }

    highlightTempSlotIndex = nextIndex;
    rememberedTempSlotIndex = nextIndex;
    saveTempAnchorSlots(newSlots);
    renderHistoryPanel();

    const badgeNum = (nextIndex < 10) ? String((nextIndex + 1) % 10) : String(nextIndex + 1);
    showSidebarToast(isEn ? `Added temp anchor: ${defaultName}` : `已添加临时锚点：${defaultName}`, { type: 'success', forceFresh: true, badge: badgeNum, isTemp: true });
    return true;
  }

  function normalizeAnchorShortcut(val, defaultKey) {
    const defaultCombo = {
      meta: false,
      ctrl: false,
      alt: true,
      shift: false,
      code: defaultKey
    };
    if (!val) return defaultCombo;
    if (typeof val === 'string') {
      return {
        meta: false,
        ctrl: false,
        alt: true,
        shift: false,
        code: val
      };
    }
    if (typeof val === 'object') {
      return {
        meta: Boolean(val.meta),
        ctrl: Boolean(val.ctrl),
        alt: Boolean(val.alt),
        shift: Boolean(val.shift),
        code: val.code || defaultKey,
        key: val.key || ''
      };
    }
    return defaultCombo;
  }

  function normalizeAnchorLocateShortcut(val) {
    const defaultModifier = {
      meta: false,
      ctrl: false,
      alt: true,
      shift: false
    };
    if (!val || typeof val !== 'object') return defaultModifier;
    const hasAny = Boolean(val.meta || val.ctrl || val.alt || val.shift);
    if (!hasAny) return defaultModifier;
    return {
      meta: Boolean(val.meta),
      ctrl: Boolean(val.ctrl),
      alt: Boolean(val.alt),
      shift: Boolean(val.shift)
    };
  }

  function formatAnchorLocateModifierDisplay(combo) {
    if (!combo || typeof combo !== 'object') return isMacPlatform() ? 'Option' : 'Alt';
    const isMac = isMacPlatform();
    const parts = [];
    if (isMac) {
      if (combo.meta) parts.push('Cmd');
      if (combo.ctrl) parts.push('Control');
      if (combo.alt) parts.push('Option');
      if (combo.shift) parts.push('Shift');
    } else {
      if (combo.ctrl) parts.push('Ctrl');
      if (combo.alt) parts.push('Alt');
      if (combo.shift) parts.push('Shift');
      if (combo.meta) parts.push('Win');
    }
    return parts.length ? parts.join(' + ') : (isMac ? 'Option' : 'Alt');
  }

  function matchesAnchorLocateModifier(combo, e) {
    if (!combo || typeof combo !== 'object') {
      return Boolean(e.altKey) && !e.metaKey && !e.ctrlKey && !e.shiftKey;
    }
    const reqMeta = Boolean(combo.meta);
    const reqCtrl = Boolean(combo.ctrl);
    const actualMeta = Boolean(e.metaKey);
    const actualCtrl = Boolean(e.ctrlKey);

    if (reqMeta && reqCtrl) {
      if (!actualMeta || !actualCtrl) return false;
    } else if (reqMeta) {
      if (!actualMeta && !actualCtrl) return false;
    } else if (reqCtrl) {
      if (!actualCtrl && !actualMeta) return false;
    } else {
      if (actualMeta || actualCtrl) return false;
    }

    if (Boolean(combo.alt) !== Boolean(e.altKey)) return false;
    if (Boolean(combo.shift) !== Boolean(e.shiftKey)) return false;

    return true;
  }

  function getCustomAnchorShortcuts() {
    try {
      const raw = localStorage.getItem('canvas-custom-shortcuts');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          anchorLocate: normalizeAnchorLocateShortcut(parsed.anchorLocate),
          anchorRecord: normalizeAnchorShortcut(parsed.anchorRecord, 'KeyS'),
          anchorTempWorkspace: normalizeAnchorShortcut(parsed.anchorTempWorkspace, 'KeyC')
        };
      }
    } catch (_) {}
    return {
      anchorLocate: normalizeAnchorLocateShortcut(null),
      anchorRecord: normalizeAnchorShortcut(null, 'KeyS'),
      anchorTempWorkspace: normalizeAnchorShortcut(null, 'KeyC')
    };
  }

  function formatCustomAnchorKeyDisplay(combo) {
    if (!combo) return '?';
    if (typeof combo === 'string') {
      combo = normalizeAnchorShortcut(combo, 'KeyS');
    }
    const isMac = isMacPlatform();
    const parts = [];
    if (isMac) {
      if (combo.meta) parts.push('Cmd');
      if (combo.ctrl) parts.push('Control');
      if (combo.alt) parts.push('Option');
      if (combo.shift) parts.push('Shift');
    } else {
      if (combo.ctrl) parts.push('Ctrl');
      if (combo.alt) parts.push('Alt');
      if (combo.shift) parts.push('Shift');
      if (combo.meta) parts.push('Win');
    }
    const code = combo.code || '';
    let keyName = '';
    if (code.startsWith('Key') && code.length === 4) {
      keyName = code.slice(3).toUpperCase();
    } else if (code.startsWith('Digit') && code.length === 6) {
      keyName = code.slice(5);
    } else {
      const map = {
        ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
        BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
        Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=',
        Backquote: '`', Backslash: '\\', Enter: 'Enter', Space: 'Space', Tab: 'Tab'
      };
      keyName = map[code] || combo.key || code;
    }
    if (keyName) parts.push(keyName);
    return parts.length ? parts.join(' + ') : '?';
  }

  function matchesAnchorShortcut(combo, e) {
    if (!combo || !combo.code) return false;
    const reqMeta = Boolean(combo.meta);
    const reqCtrl = Boolean(combo.ctrl);
    const actualMeta = Boolean(e.metaKey);
    const actualCtrl = Boolean(e.ctrlKey);

    if (reqMeta && reqCtrl) {
      if (!actualMeta || !actualCtrl) return false;
    } else if (reqMeta) {
      if (!actualMeta && !actualCtrl) return false;
    } else if (reqCtrl) {
      if (!actualCtrl && !actualMeta) return false;
    } else {
      if (actualMeta || actualCtrl) return false;
    }

    if (Boolean(combo.alt) !== Boolean(e.altKey)) return false;
    if (Boolean(combo.shift) !== Boolean(e.shiftKey)) return false;

    const eCode = e.code || '';
    if (eCode === combo.code) return true;

    // 兼容 macOS Option 特殊字符输入或无标准 e.code 的输入
    const keyLower = (e.key || '').toLowerCase();
    if (combo.code.startsWith('Key') && combo.code.length === 4) {
      const letter = combo.code.slice(3).toLowerCase();
      if (keyLower === letter) return true;
      const macOptionKeyMap = {
        KeyS: ['ß', 's'],
        KeyC: ['ç', 'c']
      };
      if (macOptionKeyMap[combo.code] && macOptionKeyMap[combo.code].includes(keyLower)) {
        return true;
      }
    }
    if (combo.code.startsWith('Digit') && combo.code.length === 6) {
      const digit = combo.code.slice(5);
      if (e.key === digit) return true;
      const macOptionDigitMap = {
        'Digit1': ['¡', '1'], 'Digit2': ['™', '2'], 'Digit3': ['£', '3'], 'Digit4': ['¢', '4'], 'Digit5': ['∞', '5'],
        'Digit6': ['§', '6'], 'Digit7': ['¶', '7'], 'Digit8': ['•', '8'], 'Digit9': ['ª', '9'], 'Digit0': ['º', '0']
      };
      if (macOptionDigitMap[combo.code] && macOptionDigitMap[combo.code].includes(e.key)) {
        return true;
      }
    }
    return false;
  }

  function openShortcutsModalFromSidebar(targetType = null) {
    if (window.CanvasModule && typeof window.CanvasModule.openShortcuts === 'function') {
      window.CanvasModule.openShortcuts({ anchorToSettings: true, scrollToTarget: targetType });
      return;
    }
    if (typeof openCanvasShortcutsModal === 'function') {
      openCanvasShortcutsModal({ anchorToSettings: true, scrollToTarget: targetType });
      return;
    }
    const btn = document.getElementById('canvasShortcutSettingsBtn');
    if (btn) btn.click();
  }

  function updateSidebarAnchorShortcutDisplays() {
    const sc = getCustomAnchorShortcuts();
    const panel = document.getElementById('canvasHistoryPanel');
    if (!panel) return;

    const locateEl = panel.querySelector('.sidebar-anchor-locate');
    if (locateEl) locateEl.textContent = formatAnchorLocateModifierDisplay(sc.anchorLocate);
    const suffixEl = panel.querySelector('.sidebar-anchor-locate + .canvas-shortcut-suffix');
    if (suffixEl) suffixEl.textContent = isEnglish() ? ' + 1...+9, 0' : ' + 1...+9、0';
    const recordEl = panel.querySelector('.sidebar-anchor-record');
    if (recordEl) recordEl.textContent = formatCustomAnchorKeyDisplay(sc.anchorRecord);
    const tempEl = panel.querySelector('.sidebar-anchor-temp-toggle');
    if (tempEl) tempEl.textContent = formatCustomAnchorKeyDisplay(sc.anchorTempWorkspace);

    const locateModifier = formatAnchorLocateModifierDisplay(sc.anchorLocate);
    const isEn = isEnglish();
    panel.querySelectorAll('.anchor-slot-row').forEach(row => {
      const idx = parseInt(row.dataset.index, 10);
      if (Number.isFinite(idx) && idx < 10) {
        const badge = row.querySelector('.anchor-slot-shortcut-badge');
        if (badge) {
          const badgeNum = String((idx + 1) % 10);
          const shortcutHint = `${locateModifier}+${badgeNum}`;
          badge.dataset.badgeTitle = isEn ? `Locate shortcut: ${shortcutHint}` : `定位快捷键：${shortcutHint}`;
          badge.removeAttribute('title');
          row.dataset.miniTooltipShortcut = shortcutHint;
        }
      }
    });
  }

  function locateAnchorByIndex(index) {
    const isEn = isEnglish();
    const slotNum = index + 1;
    const isTemp = isTempWorkspaceMode;
    const slots = isTemp ? loadTempAnchorSlots() : loadAnchorSlots();

    const slot = slots[index];
    const badgeNum = (index < 10) ? String((index + 1) % 10) : String(slotNum);
    if (!slot || typeof slot !== 'object') {
      const emptyMsg = isTemp
        ? (isEn ? `Temp anchor slot ${slotNum} is empty` : `临时锚点槽位 ${slotNum} 尚未保存`)
        : (isEn ? `Anchor slot ${slotNum} is empty` : `锚点槽位 ${slotNum} 尚未保存`);
      showSidebarToast(emptyMsg, { type: 'warning', badge: badgeNum, isTemp: isTemp });
      return false;
    }

    if (isTemp) {
      rememberedTempSlotIndex = index;
      highlightTempSlotIndex = index;
      if (tempAnchorVisibleLimit < slotNum) {
        tempAnchorVisibleLimit = Math.max(tempAnchorVisibleLimit, slotNum);
      }
    } else {
      saveRememberedSlotIndex(index);
      highlightSlotIndex = index;
      if (manualAnchorVisibleLimit < slotNum) {
        manualAnchorVisibleLimit = Math.max(manualAnchorVisibleLimit, slotNum);
        try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
      }
    }

    navigateToViewportFromAnchor(slot).then(() => {
      renderHistoryPanel();
    });

    const displayName = slot.name || (isEn ? (isTemp ? `Temp Slot ${slotNum}` : `Slot ${slotNum}`) : (isTemp ? `临时槽位 ${slotNum}` : `槽位 ${slotNum}`));
    const toastMsg = isTemp
      ? (isEn ? `Temp Anchor: ${displayName}` : `已切换至临时锚点：${displayName}`)
      : (isEn ? `Anchor: ${displayName}` : `已切换至锚点：${displayName}`);
    showSidebarToast(toastMsg, { type: 'info', badge: badgeNum, isTemp: isTemp });
    return true;
  }

  function toggleTempWorkspaceMode() {
    isTempWorkspaceMode = !isTempWorkspaceMode;
    const isEn = isEnglish();
    const tempToggleKeyDisplay = formatCustomAnchorKeyDisplay(getCustomAnchorShortcuts().anchorTempWorkspace);

    const panelHist = document.getElementById('canvasHistoryPanel');
    const tabHist = document.getElementById('sidebarTabAnchor');
    const tabDir = document.getElementById('sidebarTabDirectory');
    const panelDir = document.getElementById('canvasDirectoryTree');
    if (panelHist && panelHist.style.display === 'none' && tabHist && tabDir && panelDir) {
      tabDir.classList.remove('active');
      tabHist.classList.add('active');
      panelDir.style.display = 'none';
      panelHist.style.display = '';
      const navTabs = panelHist.closest('.nav-tabs');
      if (navTabs) navTabs.classList.add('history-tab-active');
    }

    renderHistoryPanel();

    const toastMsg = isTempWorkspaceMode
      ? (isEn ? `Entered Temporary Workspace (${tempToggleKeyDisplay})` : `已进入临时锚点工作区 (${tempToggleKeyDisplay})`)
      : (isEn ? `Exited to Permanent Anchors (${tempToggleKeyDisplay})` : `已退出临时工作区，返回永久锚点 (${tempToggleKeyDisplay})`);
    showSidebarToast(toastMsg, 'info');
  }

  function handleAnchorShortcutKeydown(e) {
    if (e.isComposing) return;

    // 在文本输入框/可编辑元素中输入时不拦截
    const activeEl = document.activeElement;
    if (activeEl) {
      const tag = (activeEl.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl.isContentEditable) {
        return;
      }
    }

    const sc = getCustomAnchorShortcuts();

    // 1. 检查数字键快速切换锚点: 默认 Option (Mac) / Alt (Win/Linux) + 1/2/.../9/0，可自定义修饰键
    if (matchesAnchorLocateModifier(sc.anchorLocate, e)) {
      let targetDigit = null;
      const digitMatch = (e.code || '').match(/^Digit([0-9])$/);
      if (digitMatch) {
        targetDigit = parseInt(digitMatch[1], 10);
      } else if (e.code && /^Numpad([0-9])$/.test(e.code)) {
        targetDigit = parseInt(e.code.slice(6), 10);
      } else {
        const macOptionDigitMap = {
          '¡': 1, '™': 2, '£': 3, '¢': 4, '∞': 5, '§': 6, '¶': 7, '•': 8, 'ª': 9, 'º': 0,
          '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 0
        };
        if (typeof e.key === 'string' && macOptionDigitMap.hasOwnProperty(e.key)) {
          targetDigit = macOptionDigitMap[e.key];
        }
      }

      if (targetDigit !== null) {
        const targetIndex = (targetDigit === 0) ? 9 : targetDigit - 1; // 1->0, 2->1, ..., 9->8, 0->9
        e.preventDefault();
        e.stopPropagation();
        locateAnchorByIndex(targetIndex);
        return;
      }
    }

    // 2. 检查记录锚点快捷键（永久/临时工作区共同按键，默认 Option/Alt + S）
    const isRecord = matchesAnchorShortcut(sc.anchorRecord, e);
    if (isRecord) {
      e.preventDefault();
      e.stopPropagation();
      if (isTempWorkspaceMode) {
        addTempAnchorFromCurrentViewport();
      } else {
        addManualAnchorFromCurrentViewport();
      }
      return;
    }

    // 3. 检查进入/退出临时工作区快捷键（默认 Option/Alt + C）
    const isToggleWorkspace = matchesAnchorShortcut(sc.anchorTempWorkspace, e);
    if (isToggleWorkspace) {
      e.preventDefault();
      e.stopPropagation();
      toggleTempWorkspaceMode();
      return;
    }
  }

  function updateManualAnchorLimit(val) {
    const currentSettings = getCanvasOtherSettingsSafe();
    currentSettings.manualAnchorLimit = val;
    saveCanvasOtherSettingsInline(currentSettings);

    let slots = loadAnchorSlots();

    if (rememberedSlotIndex !== null && rememberedSlotIndex >= val) {
      const validRemaining = slots.map((s, idx) => s ? idx : null).filter(i => i !== null);
      saveRememberedSlotIndex(validRemaining.length > 0 ? validRemaining[validRemaining.length - 1] : null);
    }
    if (highlightSlotIndex !== null && highlightSlotIndex >= val) {
      highlightSlotIndex = null;
    }

    const step = getDynamicStep();
    const remainingCount = slots.filter(s => s !== null).length;
    manualAnchorVisibleLimit = Math.max(step, Math.min(manualAnchorVisibleLimit, Math.max(step, remainingCount)));
    try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}

    saveAnchorSlots(slots);
  }

  function updateTempAnchorLimit(val) {
    const currentSettings = getCanvasOtherSettingsSafe();
    currentSettings.tempAnchorLimit = val;
    saveCanvasOtherSettingsInline(currentSettings);

    let slots = loadTempAnchorSlots();

    if (rememberedTempSlotIndex !== null && rememberedTempSlotIndex >= val) {
      const validRemaining = slots.map((s, idx) => s ? idx : null).filter(i => i !== null);
      rememberedTempSlotIndex = validRemaining.length > 0 ? validRemaining[validRemaining.length - 1] : null;
    }
    if (highlightTempSlotIndex !== null && highlightTempSlotIndex >= val) {
      highlightTempSlotIndex = null;
    }

    const step = getDynamicStep();
    const remainingCount = slots.filter(s => s !== null).length;
    tempAnchorVisibleLimit = Math.max(step, Math.min(tempAnchorVisibleLimit, Math.max(step, remainingCount)));

    saveTempAnchorSlots(slots);
  }

  function saveSettingsOnCollapse() {
    // 锚点容量固定为 10，无需在面板收起时保存容量设置
  }

  function saveManualSettingsOnCollapse() {
    saveSettingsOnCollapse();
  }

  function saveTempSettingsOnCollapse() {
    saveSettingsOnCollapse();
  }

  function handleTempSlotAction(action, index, btnEl) {
    const slots = loadTempAnchorSlots();
    const isEn = isEnglish();

    if (action === 'save') {
      if (isCanvasNodeFullscreenActive()) {
        showAnchorMutationBlockedToast(isEn);
        return;
      }

      const state = global.CanvasModule && global.CanvasModule.CanvasState;
      if (!state) return;

      const workspace = document.getElementById('canvasWorkspace');
      const wsW = (workspace && workspace.clientWidth > 50) ? workspace.clientWidth : (window.innerWidth > 50 ? window.innerWidth : 800);
      const wsH = (workspace && workspace.clientHeight > 50) ? workspace.clientHeight : (window.innerHeight > 50 ? window.innerHeight : 600);
      const z = (state.zoom && state.zoom > 0) ? state.zoom : 1;
      const worldX = Math.round(((wsW / 2 - state.panOffsetX) / z) * 100) / 100;
      const worldY = Math.round(((wsH / 2 - state.panOffsetY) / z) * 100) / 100;
      
      const existingName = slots[index] ? slots[index].name : null;
      const defaultName = existingName || generateAnchorTimeName(slots);
      
      slots[index] = {
        name: defaultName,
        x: worldX,
        y: worldY,
        zoom: z,
        coordType: 'world',
        timestamp: Date.now()
      };
      highlightTempSlotIndex = index;
      rememberedTempSlotIndex = index;
      saveTempAnchorSlots(slots);
      renderHistoryPanel();
      const badgeNum = (index < 10) ? String((index + 1) % 10) : String(index + 1);
      showSidebarToast(isEn ? 'Viewport saved to temp slot' : '视口已覆盖至临时槽位', { type: 'success', badge: badgeNum, isTemp: true });
    } 
    else if (action === 'locate') {
      const slot = slots[index];
      if (!slot) return;
      rememberedTempSlotIndex = index;
      navigateToViewportFromAnchor(slot).then(() => {
        setTimeout(renderHistoryPanel, 50);
      });
      const slotNum = index + 1;
      const badgeNum = (index < 10) ? String((index + 1) % 10) : String(slotNum);
      const displayName = slot.name || (isEn ? `Temp Slot ${slotNum}` : `临时槽位 ${slotNum}`);
      showSidebarToast(isEn ? `Temp Anchor: ${displayName}` : `已切换至临时锚点：${displayName}`, { type: 'info', badge: badgeNum, isTemp: true });
    }
    else if (action === 'rename') {
      const slot = slots[index];
      if (!slot) return;
      
      const row = btnEl ? btnEl.closest('.anchor-slot-row') : null;
      if (row && row.querySelector('.anchor-slot-rename-input')) {
        return; // Already editing
      }
      
      const span = row ? row.querySelector('.anchor-slot-name') : null;
      if (!span) {
        const newName = prompt(isEn ? 'Enter a new name for the temp slot:' : '请输入新的临时槽位名称：', slot.name || '');
        if (newName === null) return;
        const trimmed = newName.trim();
        if (trimmed) {
          slot.name = trimmed;
          saveTempAnchorSlots(slots);
          renderHistoryPanel();
        }
        return;
      }
      
      const currentValue = slot.name || (isEn ? `Temp Slot ${index + 1}` : `临时槽位 ${index + 1}`);
      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'anchor-slot-rename-input';
      input.className = 'anchor-slot-rename-input';
      input.value = currentValue;
      
      span.parentNode.replaceChild(input, span);
      input.focus();
      input.select();
      
      input.addEventListener('click', (e) => { e.stopPropagation(); });
      input.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      
      let isFinished = false;
      const finish = (save) => {
        if (isFinished) return;
        isFinished = true;
        if (save) {
          const trimmed = input.value.trim();
          if (trimmed) {
            slot.name = trimmed;
            saveTempAnchorSlots(slots);
          }
        }
        renderHistoryPanel();
      };
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.isComposing) return;
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          if (e.isComposing) return;
          e.preventDefault();
          finish(false);
        }
      });
      
      input.addEventListener('blur', () => {
        finish(true);
      });
    } 
    else if (action === 'delete') {
      const validSlots = slots.filter(s => s && typeof s === 'object');
      if (index >= 0 && index < validSlots.length) {
        validSlots.splice(index, 1);
      }
      const limit = getTempAnchorLimit();
      const newSlots = [...validSlots];
      while (newSlots.length < limit) {
        newSlots.push(null);
      }
      if (rememberedTempSlotIndex !== null) {
        if (rememberedTempSlotIndex === index) {
          if (validSlots.length === 0) {
            rememberedTempSlotIndex = null;
          } else if (index < validSlots.length) {
            rememberedTempSlotIndex = index;
          } else {
            rememberedTempSlotIndex = validSlots.length - 1;
          }
        } else if (rememberedTempSlotIndex > index) {
          rememberedTempSlotIndex = rememberedTempSlotIndex - 1;
        }
      }
      if (highlightTempSlotIndex !== null) {
        if (highlightTempSlotIndex === index) {
          highlightTempSlotIndex = null;
        } else if (highlightTempSlotIndex > index) {
          highlightTempSlotIndex = highlightTempSlotIndex - 1;
        }
      }
      const remainingCount = validSlots.length;
      const step = getDynamicStep();
      if (tempAnchorVisibleLimit > Math.max(step, remainingCount)) {
        tempAnchorVisibleLimit = Math.max(step, remainingCount);
      }
      saveTempAnchorSlots(newSlots);
      renderHistoryPanel();
    }
  }

  let renderHistoryPanelTimer = null;
  function renderHistoryPanel() {
    if (renderHistoryPanelTimer) {
      cancelAnimationFrame(renderHistoryPanelTimer);
    }
    renderHistoryPanelTimer = requestAnimationFrame(() => {
      renderHistoryPanelTimer = null;
      renderHistoryPanelActual();
    });
  }

  function refreshManualAnchorSlotsUI() {
    renderHistoryPanel();
  }

  function refreshTempAnchorSlotsUI() {
    renderHistoryPanel();
  }

  function scrollSlotRowIntoContainerView(container, element, behavior = 'smooth') {
    if (!container || !element) return;
    try {
      const containerRect = container.getBoundingClientRect();
      const elRect = element.getBoundingClientRect();
      const padding = 4;

      if (elRect.top < containerRect.top + padding) {
        const diff = (containerRect.top + padding) - elRect.top;
        const targetTop = Math.max(0, container.scrollTop - diff);
        if (typeof container.scrollTo === 'function') {
          container.scrollTo({ top: targetTop, behavior });
        } else {
          container.scrollTop = targetTop;
        }
      } else if (elRect.bottom > containerRect.bottom - padding) {
        const diff = elRect.bottom - (containerRect.bottom - padding);
        const targetTop = container.scrollTop + diff;
        if (typeof container.scrollTo === 'function') {
          container.scrollTo({ top: targetTop, behavior });
        } else {
          container.scrollTop = targetTop;
        }
      }
    } catch (_) {}
  }

  // ==========================================================================
  // 锚点指针拖拽排序系统 (Anchor Pointer Drag Reorder System)
  // 支持两形态（常规与窄边迷你形态）、滚轮/触控板滚动落位、防抖与序号快捷键实时重排
  // ==========================================================================
  let anchorDragState = {
    isDragging: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    fromIndex: -1,
    draggedRow: null,
    container: null,
    ghost: null,
    indicator: null,
    targetNewIndex: null,
    autoScrollTimer: null,
    autoScrollSpeed: 0,
    isMini: false,
    preventClick: false
  };
  let preventNextAnchorRowClick = false;
  let isAnchorReorderDragging = false;
  let lastAnchorPointerEvent = null;

  function reorderAnchorSlots(fromIndex, toIndex, isTemp) {
    const slots = isTemp ? loadTempAnchorSlots() : loadAnchorSlots();
    const validSlots = slots.filter(s => s !== null && typeof s === 'object');
    if (fromIndex < 0 || fromIndex >= validSlots.length || toIndex < 0 || toIndex >= validSlots.length) {
      return;
    }
    if (fromIndex === toIndex) return;

    const [moved] = validSlots.splice(fromIndex, 1);
    validSlots.splice(toIndex, 0, moved);

    // 默认命名前缀检测与自适应更新（如果用户未自定义名字，则序号自动同步）
    const isEn = isEnglish();
    const defaultRegex = /^(Slot|槽位|Temp Slot|临时槽位)\s*(\d+)$/i;
    validSlots.forEach((slot, idx) => {
      if (slot && slot.name && defaultRegex.test(slot.name)) {
        const prefix = isTemp ? (isEn ? 'Temp Slot ' : '临时槽位 ') : (isEn ? 'Slot ' : '槽位 ');
        slot.name = `${prefix}${idx + 1}`;
      }
    });

    // 同步更新当前激活槽位记忆索引
    if (isTemp) {
      if (rememberedTempSlotIndex !== null) {
        if (rememberedTempSlotIndex === fromIndex) {
          rememberedTempSlotIndex = toIndex;
        } else if (fromIndex < rememberedTempSlotIndex && toIndex >= rememberedTempSlotIndex) {
          rememberedTempSlotIndex -= 1;
        } else if (fromIndex > rememberedTempSlotIndex && toIndex <= rememberedTempSlotIndex) {
          rememberedTempSlotIndex += 1;
        }
      }
      highlightTempSlotIndex = toIndex;
    } else {
      if (rememberedSlotIndex !== null) {
        let newRemembered = rememberedSlotIndex;
        if (rememberedSlotIndex === fromIndex) {
          newRemembered = toIndex;
        } else if (fromIndex < rememberedSlotIndex && toIndex >= rememberedSlotIndex) {
          newRemembered -= 1;
        } else if (fromIndex > rememberedSlotIndex && toIndex <= rememberedSlotIndex) {
          newRemembered += 1;
        }
        saveRememberedSlotIndex(newRemembered);
      }
      highlightSlotIndex = toIndex;
    }

    const limit = isTemp ? getTempAnchorLimit() : getManualAnchorLimit();
    const newSlots = [...validSlots];
    while (newSlots.length < limit) {
      newSlots.push(null);
    }

    if (isTemp) {
      saveTempAnchorSlots(newSlots);
    } else {
      saveAnchorSlots(newSlots);
    }

    renderHistoryPanel();

    const toastMsg = isEn ? 'Anchor order updated' : '已调整锚点顺序';
    const badgeNum = (toIndex < 10) ? String((toIndex + 1) % 10) : String(toIndex + 1);
    showSidebarToast(toastMsg, { type: 'info', badge: badgeNum, isTemp: isTemp });
  }

  function handleAnchorRowPointerDown(e) {
    if (e.button !== 0) return; // 仅限鼠标主键或单指触摸
    const row = e.currentTarget || (e.target && e.target.closest('.anchor-slot-row'));
    if (!row) return;

    // 点击按钮或行内重命名输入框时不启动拖拽
    if (e.target.closest('.anchor-slot-btn') || 
        e.target.closest('.anchor-slot-rename-input') || 
        e.target.closest('input, button, textarea')) {
      return;
    }

    const container = row.closest('.anchor-slots-container');
    if (!container) return;

    // 只有一个或没有锚点时无需拖拽调整
    const totalRows = container.querySelectorAll('.anchor-slot-row').length;
    if (totalRows <= 1) return;

    const fromIndex = parseInt(row.dataset.index, 10);
    if (isNaN(fromIndex)) return;

    const sidebar = document.getElementById('sidebar');
    const isMini = !!(sidebar && sidebar.classList.contains('mini'));

    anchorDragState = {
      isDragging: false,
      hasMoved: false,
      startX: e.clientX,
      startY: e.clientY,
      fromIndex: fromIndex,
      draggedRow: row,
      container: container,
      ghost: null,
      indicator: null,
      targetNewIndex: fromIndex,
      autoScrollTimer: null,
      autoScrollSpeed: 0,
      isMini: isMini,
      preventClick: false
    };
    lastAnchorPointerEvent = e;

    document.addEventListener('pointermove', onAnchorPointerMove);
    document.addEventListener('pointerup', onAnchorPointerUp);
    document.addEventListener('pointercancel', onAnchorPointerCancel);
    document.addEventListener('keydown', onAnchorKeyDown, true);
    container.addEventListener('scroll', onContainerScrollDuringDrag, { passive: true });
  }

  function onAnchorPointerMove(e) {
    if (!anchorDragState.draggedRow) return;
    lastAnchorPointerEvent = e;

    const dx = e.clientX - anchorDragState.startX;
    const dy = e.clientY - anchorDragState.startY;
    const dist = Math.hypot(dx, dy);

    // 防抖机制：位移小于 5px 视为单纯点击或微颤，不触发拖拽
    if (!anchorDragState.isDragging) {
      if (dist < 5) return;
      startAnchorDrag(e);
    }

    if (anchorDragState.isDragging) {
      e.preventDefault();
      updateAnchorGhostPosition(e);
      updateAnchorDropIndicator(e);
      handleAnchorAutoScroll(e);
    }
  }

  function startAnchorDrag(e) {
    anchorDragState.isDragging = true;
    anchorDragState.hasMoved = true;
    anchorDragState.preventClick = true;
    preventNextAnchorRowClick = true;
    isAnchorReorderDragging = true;

    hideSidebarMiniTooltip(true);

    const row = anchorDragState.draggedRow;
    row.classList.add('is-dragging');

    // 构造跟随指针的拖拽悬浮镜像
    const ghost = document.createElement('div');
    ghost.className = 'anchor-drag-ghost' + 
      (anchorDragState.isMini ? ' mini' : '') + 
      (isTempWorkspaceMode ? ' in-temp-mode' : '');

    const badge = row.querySelector('.anchor-slot-shortcut-badge');
    const nameEl = row.querySelector('.anchor-slot-name');
    const badgeText = badge ? badge.textContent.trim() : String((anchorDragState.fromIndex + 1) % 10);
    const nameText = nameEl ? nameEl.textContent.trim() : '';

    if (anchorDragState.isMini) {
      ghost.innerHTML = `<span class="anchor-drag-ghost-badge">${escapeHtml(badgeText)}</span>`;
    } else {
      ghost.innerHTML = `
        <span class="anchor-drag-ghost-badge">${escapeHtml(badgeText)}</span>
        <span class="anchor-drag-ghost-name">${escapeHtml(nameText)}</span>
      `;
    }

    document.body.appendChild(ghost);
    anchorDragState.ghost = ghost;

    // 构造落位指示线 (Drop Indicator)
    const indicator = document.createElement('div');
    indicator.className = 'anchor-drop-indicator' + 
      (anchorDragState.isMini ? ' mini' : '') + 
      (isTempWorkspaceMode ? ' in-temp-mode' : '');
    anchorDragState.indicator = indicator;

    updateAnchorGhostPosition(e);
    updateAnchorDropIndicator(e);
  }

  function updateAnchorGhostPosition(e) {
    if (!anchorDragState.ghost) return;
    if (anchorDragState.isMini) {
      anchorDragState.ghost.style.left = `${e.clientX + 8}px`;
      anchorDragState.ghost.style.top = `${e.clientY - 17}px`;
    } else {
      anchorDragState.ghost.style.left = `${e.clientX + 12}px`;
      anchorDragState.ghost.style.top = `${e.clientY + 8}px`;
    }
  }

  function updateAnchorDropIndicator(e) {
    const container = anchorDragState.container;
    const indicator = anchorDragState.indicator;
    if (!container || !indicator) return;

    const rows = Array.from(container.querySelectorAll('.anchor-slot-row:not(.is-dragging)'));
    if (rows.length === 0) return;

    const fromIndex = anchorDragState.fromIndex;
    const clientY = e.clientY;

    let targetRow = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rect = r.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) {
        targetRow = r;
        break;
      }
    }

    if (!targetRow) {
      const lastRow = rows[rows.length - 1];
      if (indicator.parentNode !== container || indicator.previousElementSibling !== lastRow) {
        lastRow.after(indicator);
      }
      anchorDragState.targetNewIndex = rows.length;
    } else {
      if (indicator.parentNode !== container || indicator.nextElementSibling !== targetRow) {
        container.insertBefore(indicator, targetRow);
      }
      const targetOrigIdx = parseInt(targetRow.dataset.index, 10);
      if (targetOrigIdx > fromIndex) {
        anchorDragState.targetNewIndex = targetOrigIdx - 1;
      } else {
        anchorDragState.targetNewIndex = targetOrigIdx;
      }
    }
  }

  function handleAnchorAutoScroll(e) {
    const container = anchorDragState.container;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const zone = Math.max(28, Math.min(60, Math.round(rect.height * 0.15)));
    const maxSpeed = 16;

    let speed = 0;
    if (e.clientY >= rect.top && e.clientY < rect.top + zone) {
      const ratio = (rect.top + zone - e.clientY) / zone;
      speed = -maxSpeed * Math.max(0.2, ratio);
    } else if (e.clientY <= rect.bottom && e.clientY > rect.bottom - zone) {
      const ratio = (e.clientY - (rect.bottom - zone)) / zone;
      speed = maxSpeed * Math.max(0.2, ratio);
    }

    if (speed !== 0) {
      anchorDragState.autoScrollSpeed = speed;
      if (!anchorDragState.autoScrollTimer) {
        const loop = () => {
          if (!anchorDragState.isDragging || !anchorDragState.autoScrollSpeed || !anchorDragState.container) {
            anchorDragState.autoScrollTimer = null;
            return;
          }
          anchorDragState.container.scrollTop += anchorDragState.autoScrollSpeed;
          if (lastAnchorPointerEvent) {
            updateAnchorDropIndicator(lastAnchorPointerEvent);
          }
          anchorDragState.autoScrollTimer = requestAnimationFrame(loop);
        };
        anchorDragState.autoScrollTimer = requestAnimationFrame(loop);
      }
    } else {
      anchorDragState.autoScrollSpeed = 0;
      if (anchorDragState.autoScrollTimer) {
        cancelAnimationFrame(anchorDragState.autoScrollTimer);
        anchorDragState.autoScrollTimer = null;
      }
    }
  }

  function onContainerScrollDuringDrag() {
    if (anchorDragState.isDragging && lastAnchorPointerEvent) {
      updateAnchorDropIndicator(lastAnchorPointerEvent);
    }
  }

  function onAnchorPointerUp(e) {
    if (!anchorDragState.draggedRow) return;

    const wasDragging = anchorDragState.isDragging;
    const fromIndex = anchorDragState.fromIndex;
    const targetNewIndex = anchorDragState.targetNewIndex;

    cleanUpAnchorDrag();

    if (wasDragging) {
      const maxIndex = isTempWorkspaceMode 
        ? (loadTempAnchorSlots().filter(s => s && typeof s === 'object').length - 1)
        : (loadAnchorSlots().filter(s => s && typeof s === 'object').length - 1);
      
      if (typeof targetNewIndex === 'number' && maxIndex >= 0) {
        const clampedNewIndex = Math.max(0, Math.min(maxIndex, targetNewIndex));
        if (clampedNewIndex !== fromIndex) {
          reorderAnchorSlots(fromIndex, clampedNewIndex, isTempWorkspaceMode);
        }
      }
      setTimeout(() => {
        preventNextAnchorRowClick = false;
      }, 80);
    } else {
      preventNextAnchorRowClick = false;
    }
  }

  function onAnchorPointerCancel() {
    cleanUpAnchorDrag();
    preventNextAnchorRowClick = false;
  }

  function onAnchorKeyDown(e) {
    if (e.key === 'Escape' && anchorDragState.isDragging) {
      cleanUpAnchorDrag();
      preventNextAnchorRowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function cleanUpAnchorDrag() {
    if (anchorDragState.autoScrollTimer) {
      cancelAnimationFrame(anchorDragState.autoScrollTimer);
      anchorDragState.autoScrollTimer = null;
    }
    anchorDragState.autoScrollSpeed = 0;

    if (anchorDragState.ghost && anchorDragState.ghost.parentNode) {
      anchorDragState.ghost.remove();
      anchorDragState.ghost = null;
    }

    if (anchorDragState.indicator && anchorDragState.indicator.parentNode) {
      anchorDragState.indicator.remove();
      anchorDragState.indicator = null;
    }

    if (anchorDragState.draggedRow) {
      anchorDragState.draggedRow.classList.remove('is-dragging');
    }

    document.removeEventListener('pointermove', onAnchorPointerMove);
    document.removeEventListener('pointerup', onAnchorPointerUp);
    document.removeEventListener('pointercancel', onAnchorPointerCancel);
    document.removeEventListener('keydown', onAnchorKeyDown, true);

    if (anchorDragState.container) {
      anchorDragState.container.removeEventListener('scroll', onContainerScrollDuringDrag);
    }

    anchorDragState.isDragging = false;
    anchorDragState.draggedRow = null;
    anchorDragState.container = null;
    lastAnchorPointerEvent = null;
    isAnchorReorderDragging = false;
  }

  function renderHistoryPanelActual() {
    const panel = document.getElementById('canvasHistoryPanel');
    if (!panel || panel.style.display === 'none') return;

    const slotsList = panel.querySelector('.anchor-slots-container');
    const slotsScrollTop = slotsList ? slotsList.scrollTop : 0;

    const activeEl = document.activeElement;
    const activeId = activeEl ? activeEl.id : null;
    let selectionStart = null;
    let selectionEnd = null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.type !== 'checkbox') {
      try {
        selectionStart = activeEl.selectionStart;
        selectionEnd = activeEl.selectionEnd;
      } catch (_) {}
    }

    const isEn = isEnglish();
    const isMac = isMacPlatform();
    const isCardFullscreen = isCanvasNodeFullscreenActive();
    const step = getDynamicStep();

    if (manualAnchorVisibleLimit < step) {
      manualAnchorVisibleLimit = step;
    }
    if (tempAnchorVisibleLimit < step) {
      tempAnchorVisibleLimit = step;
    }

    const manualAnchorLimit = getManualAnchorLimit();
    const tempAnchorLimit = getTempAnchorLimit();

    const slots = loadAnchorSlots();
    const tempSlots = loadTempAnchorSlots();

    if (rememberedSlotIndex !== null) {
      if (!slots[rememberedSlotIndex] || typeof slots[rememberedSlotIndex] !== 'object') {
        const firstValid = slots.findIndex(s => s && typeof s === 'object');
        saveRememberedSlotIndex(firstValid >= 0 ? firstValid : null);
      }
    }
    if (rememberedTempSlotIndex !== null) {
      if (!tempSlots[rememberedTempSlotIndex] || typeof tempSlots[rememberedTempSlotIndex] !== 'object') {
        const firstValidTemp = tempSlots.findIndex(s => s && typeof s === 'object');
        rememberedTempSlotIndex = (firstValidTemp >= 0 ? firstValidTemp : null);
      }
    }

    const savedManualSlots = slots
      .map((slot, idx) => slot ? { ...slot, originalIndex: idx } : null)
      .filter(s => s !== null);

    const savedTempSlots = tempSlots
      .map((slot, idx) => slot ? { ...slot, originalIndex: idx } : null)
      .filter(s => s !== null);

    const activeSavedSlots = isTempWorkspaceMode ? savedTempSlots : savedManualSlots;
    const currentLimit = isTempWorkspaceMode ? tempAnchorLimit : manualAnchorLimit;
    const currentVisibleLimit = isTempWorkspaceMode ? tempAnchorVisibleLimit : manualAnchorVisibleLimit;
    const currentRememberedIndex = isTempWorkspaceMode ? rememberedTempSlotIndex : rememberedSlotIndex;
    const isFull = activeSavedSlots.length >= currentLimit;

    const customShortcuts = getCustomAnchorShortcuts();
    const locateModifierDisplay = formatAnchorLocateModifierDisplay(customShortcuts.anchorLocate);
    const anchorRecordDisplay = formatCustomAnchorKeyDisplay(customShortcuts.anchorRecord);
    const anchorTempWorkspaceDisplay = formatCustomAnchorKeyDisplay(customShortcuts.anchorTempWorkspace);

    let html = `
      <div class="sidebar-anchor-container${isTempWorkspaceMode ? ' in-temp-mode' : ''}">
        <!-- Unified Header: Left: Settings, Center: Temp Workspace, Right: Clear (in temp mode) + Add -->
        <div class="sidebar-section-header anchor-unified-header">
          <div class="sidebar-header-left">
            <button class="sidebar-action-btn" id="anchorSettingsBtn" title="${isEn ? 'Anchor Settings' : '锚点设置'}" data-mini-tooltip-title="${isEn ? 'Anchor Settings' : '锚点设置'}">
              <i class="fas fa-cog"></i>
            </button>
          </div>
          <div class="sidebar-header-center">
            <button class="sidebar-action-btn sidebar-temp-workspace-btn${isTempWorkspaceMode ? ' active' : ''}" id="tempWorkspaceToggleBtn" type="button" title="${isEn ? `Toggle Temporary Workspace (${anchorTempWorkspaceDisplay})` : `进入/退出临时工作区 (${anchorTempWorkspaceDisplay})`}" data-mini-tooltip-title="${isTempWorkspaceMode ? (isEn ? 'Exit Temporary Workspace' : '退出临时工作区') : (isEn ? 'Enter Temporary Workspace' : '进入临时工作区')}" data-mini-tooltip-shortcut="${anchorTempWorkspaceDisplay ? (isEn ? `Shortcut: ${anchorTempWorkspaceDisplay}` : `快捷键：${anchorTempWorkspaceDisplay}`) : ''}" data-mini-tooltip-current="${isTempWorkspaceMode ? 'true' : 'false'}">
              <i class="fas fa-layer-group"></i>
            </button>
          </div>
          <div class="sidebar-header-right">
            ${isTempWorkspaceMode ? `
              <button class="sidebar-action-btn" id="tempClearBtn" title="${isEn ? 'Clear Temporary Anchors' : '一键清空临时锚点'}" data-mini-tooltip-title="${isEn ? 'Clear Temporary Anchors' : '一键清空临时锚点'}" style="${savedTempSlots.length === 0 ? 'opacity: 0.5;' : ''}">
                <i class="fas fa-trash-alt"></i>
              </button>
            ` : ''}
            <button class="sidebar-action-btn${isFull ? ' is-full' : ''}${isCardFullscreen ? ' is-disabled' : ''}" id="addAnchorBtn" type="button" title="${isTempWorkspaceMode ? (isEn ? 'Add Temp Anchor' : '添加临时锚点') : (isEn ? 'Add Anchor' : '添加锚点')}" data-mini-tooltip-title="${isTempWorkspaceMode ? (isEn ? 'Add Temp Anchor' : '添加临时锚点') : (isEn ? 'Add Anchor' : '添加锚点')}" data-mini-tooltip-shortcut="${anchorRecordDisplay ? (isEn ? `Shortcut: ${anchorRecordDisplay}` : `快捷键：${anchorRecordDisplay}`) : ''}">
              <i class="fas fa-plus"></i>
            </button>
          </div>
        </div>

        <!-- Inline Settings Panel -->
        <div class="manual-anchor-settings-panel anchor-settings-panel" id="anchorInlineSettings" style="${anchorSettingsOpen ? '' : 'display: none;'}">
          <div class="manual-anchor-shortcuts-help" style="font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
            <div style="font-weight: 500; margin-bottom: 4px; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
              <span>${isEn ? 'Anchor Shortcuts' : '锚点快捷键'}</span>
              <button class="sidebar-action-btn edit-anchor-shortcuts-btn" id="openAnchorShortcutsBtn" type="button" title="${isEn ? 'Modify Shortcuts' : '点击修改快捷键'}" style="width: 20px; height: 20px; font-size: 11px;">
                <i class="fas fa-edit"></i>
              </button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
              <span>${isEn ? 'Locate 1~10:' : '定位 1~10：'}</span>
              <span><kbd class="canvas-shortcut-key sidebar-anchor-locate" data-shortcut-display="anchorLocate" style="font-size: 10px; padding: 1px 5px;">${locateModifierDisplay}</kbd><span class="canvas-shortcut-suffix">${isEn ? ' + 1...+9, 0' : ' + 1...+9、0'}</span></span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
              <span>${isEn ? 'Record Viewport:' : '记录视口：'}</span>
              <kbd class="canvas-shortcut-key sidebar-anchor-record" data-shortcut-display="anchorRecord" style="font-size: 10px; padding: 1px 5px;">${anchorRecordDisplay}</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
              <span>${isEn ? 'Temp Workspace:' : '进入/退出临时：'}</span>
              <kbd class="canvas-shortcut-key sidebar-anchor-temp-toggle" data-shortcut-display="anchorTempWorkspace" style="font-size: 10px; padding: 1px 5px;">${anchorTempWorkspaceDisplay}</kbd>
            </div>
            <div style="font-size: 10px; color: var(--text-muted, #888); margin-top: 4px; line-height: 1.4;">
              ${isEn ? 'Anchor capacity is fixed at 10. Temp anchors are independent per page and cleared on reload.' : '锚点容量最大限度为 10 个。临时锚点各页面独立，刷新或重启后自动清空。'}
            </div>
          </div>
        </div>

        <!-- Single Unified Slots Container -->
        <div class="anchor-slots-container">
    `;

    const visibleSavedSlots = activeSavedSlots.slice(0, currentVisibleLimit);

    if (activeSavedSlots.length === 0) {
      html += `
        <div class="history-empty-tip">
          ${isTempWorkspaceMode ? (isEn ? 'No temporary anchors yet' : '暂无临时锚点') : (isEn ? 'No manual anchors yet' : '暂无手动锚点')}
        </div>
      `;
    } else {
      visibleSavedSlots.forEach((slot) => {
        const index = slot.originalIndex;
        const slotNum = index + 1;
        const defaultPrefix = isTempWorkspaceMode ? (isEn ? 'Temp Slot' : '临时槽位') : (isEn ? 'Slot' : '槽位');
        const displayName = slot.name || `${defaultPrefix} ${slotNum}`;
        const zoomPercent = formatAnchorZoomPercent(slot.zoom);
        const absoluteTimeStr = slot.timestamp ? formatAbsoluteTime(slot.timestamp, isEn) : '';
        const isRemembered = (currentRememberedIndex === index);
        const badgeNum = (index < 10) ? String((index + 1) % 10) : String(slotNum);
        const locateModifier = locateModifierDisplay;
        const shortcutHint = (index < 10) ? `${locateModifier}+${badgeNum}` : '';
        const badgeTitle = shortcutHint
          ? (isEn ? `Locate shortcut: ${shortcutHint}` : `定位快捷键：${shortcutHint}`)
          : (isEn ? `Slot ${slotNum}` : `槽位 ${slotNum}`);
        const fullSlotTitle = shortcutHint ? `${displayName} (${shortcutHint})` : displayName;
        const rowTitle = isRemembered ? `${fullSlotTitle} [${isEn ? 'Current' : '当前'}]` : fullSlotTitle;

        html += `
          <div class="anchor-slot-row${isRemembered ? ' active-slot' : ''}" data-index="${index}" title="${rowTitle}" data-mini-tooltip-title="${escapeHtml(displayName)}" data-mini-tooltip-shortcut="${escapeHtml(shortcutHint ? (isEn ? `Shortcut: ${shortcutHint}` : `快捷键：${shortcutHint}`) : '')}" data-mini-tooltip-current="${isRemembered ? 'true' : 'false'}">
            <span class="anchor-slot-shortcut-badge" data-badge-title="${badgeTitle}">${badgeNum}</span>
            <div class="anchor-slot-header">
              <span class="anchor-slot-name" title="${displayName}">${displayName}</span>
              <div class="anchor-slot-actions">
                <button class="anchor-slot-btn rename-btn" data-index="${index}" title="${isTempWorkspaceMode ? (isEn ? 'Rename temp slot' : '重命名临时槽位') : (isEn ? 'Rename slot' : '重命名槽位')}">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="anchor-slot-btn delete-btn" data-index="${index}" title="${isTempWorkspaceMode ? (isEn ? 'Clear temp slot' : '清除临时槽位') : (isEn ? 'Clear slot' : '清除槽位')}">
                  <i class="fas fa-trash-alt"></i>
                </button>
                <button class="anchor-slot-btn save-btn${isCardFullscreen ? ' is-disabled' : ''}" data-index="${index}" title="${isEn ? 'Overwrite with current viewport' : '用当前视口覆盖'}">
                  <i class="fas fa-anchor"></i>
                </button>
                <button class="anchor-slot-btn locate-btn" data-index="${index}" title="${isEn ? 'Locate viewport' : '定位到此视口'}">
                  <i class="fas fa-crosshairs"></i>
                </button>
              </div>
            </div>
            <div class="anchor-slot-info">
              <span class="anchor-slot-coords">X: ${Math.round(slot.x)} │ Y: ${Math.round(slot.y)} │ ${zoomPercent}</span>
              ${absoluteTimeStr ? `<span class="anchor-slot-time">${absoluteTimeStr}</span>` : ''}
            </div>
          </div>
        `;
      });
    }

    const hasMore = activeSavedSlots.length > visibleSavedSlots.length;
    const canCollapse = currentVisibleLimit > step;
    if (hasMore || canCollapse) {
      const remaining = activeSavedSlots.length - visibleSavedSlots.length;
      const willLoad = Math.min(step, remaining);

      html += `
        <div class="lazy-load-container" style="display: flex; gap: 8px; margin: 4px 8px 8px 8px; justify-content: center;">
      `;
      if (hasMore) {
        html += `
          <button class="lazy-load-btn load-more-btn" id="anchorLoadMoreBtn" style="flex: 1;">
            <i class="fas fa-chevron-down"></i> ${isEn ? `Show More (+${willLoad})` : `展开更多 (+${willLoad})`}
          </button>
        `;
      }
      if (canCollapse) {
        html += `
          <button class="lazy-load-btn collapse-btn" id="anchorCollapseBtn" style="flex: 1;">
            <i class="fas fa-chevron-up"></i> ${isEn ? 'Collapse' : '收起'}
          </button>
        `;
      }
      html += `</div>`;
    }

    html += `
        </div>
      </div>
    `;

    panel.innerHTML = html;

    const newSlotsList = panel.querySelector('.anchor-slots-container');
    if (newSlotsList) {
      newSlotsList.scrollTop = slotsScrollTop;
      const highlightIdx = isTempWorkspaceMode ? highlightTempSlotIndex : highlightSlotIndex;
      if (highlightIdx !== null) {
        const targetEl = panel.querySelector(`.anchor-slots-container .anchor-slot-row[data-index="${highlightIdx}"]`);
        if (targetEl) {
          requestAnimationFrame(() => {
            scrollSlotRowIntoContainerView(newSlotsList, targetEl, 'smooth');
          });
        }
        if (isTempWorkspaceMode) {
          highlightTempSlotIndex = null;
        } else {
          highlightSlotIndex = null;
        }
      }
    }

    if (activeId) {
      const newActiveEl = panel.querySelector(`#${activeId}`);
      if (newActiveEl) {
        newActiveEl.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null) {
          try {
            newActiveEl.setSelectionRange(selectionStart, selectionEnd);
          } catch (_) {}
        }
      }
    }

    // --- 事件绑定 ---
    const settingsBtn = panel.querySelector('#anchorSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('mini')) {
          if (typeof window.setSidebarState === 'function') {
            window.setSidebarState('expanded', { manual: true });
          }
        }
        if (anchorSettingsOpen) {
          saveSettingsOnCollapse();
          anchorSettingsOpen = false;
          renderHistoryPanel();
        } else {
          anchorSettingsOpen = true;
          const inlinePanel = panel.querySelector('#anchorInlineSettings');
          if (inlinePanel) {
            inlinePanel.style.display = '';
          }
        }
      });
    }

    const tempToggleBtn = panel.querySelector('#tempWorkspaceToggleBtn');
    if (tempToggleBtn) {
      tempToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleTempWorkspaceMode();
      });
    }

    const tempClearBtn = panel.querySelector('#tempClearBtn');
    if (tempClearBtn) {
      tempClearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const limit = getTempAnchorLimit();
        tempAnchorSlots = new Array(limit).fill(null);
        rememberedTempSlotIndex = null;
        highlightTempSlotIndex = null;
        tempAnchorVisibleLimit = getDynamicStep();
        saveTempAnchorSlots(tempAnchorSlots);
        renderHistoryPanel();
        showSidebarToast(isEn ? 'All temporary anchors cleared' : '已清空所有临时锚点', 'info');
      });
    }

    const addBtn = panel.querySelector('#addAnchorBtn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTempWorkspaceMode) {
          addTempAnchorFromCurrentViewport();
        } else {
          addManualAnchorFromCurrentViewport();
        }
      });
    }

    const openShortcutsBtn = panel.querySelector('#openAnchorShortcutsBtn');
    if (openShortcutsBtn) {
      openShortcutsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openShortcutsModalFromSidebar(isTempWorkspaceMode ? 'anchorTempWorkspace' : 'anchorRecord');
      });
    }

    const loadMoreBtn = panel.querySelector('#anchorLoadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        const step = getDynamicStep();
        if (isTempWorkspaceMode) {
          tempAnchorVisibleLimit += step;
        } else {
          manualAnchorVisibleLimit += step;
          try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
        }
        renderHistoryPanel();
      });
    }

    const collapseBtn = panel.querySelector('#anchorCollapseBtn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const step = getDynamicStep();
        if (isTempWorkspaceMode) {
          tempAnchorVisibleLimit = step;
        } else {
          manualAnchorVisibleLimit = step;
          try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
        }
        renderHistoryPanel();
      });
    }

    panel.querySelectorAll('.anchor-slots-container .anchor-slot-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.anchor-slot-btn') || e.target.closest('.anchor-slot-rename-input')) return;
        if (preventNextAnchorRowClick) {
          preventNextAnchorRowClick = false;
          return;
        }
        const index = parseInt(row.dataset.index, 10);
        locateAnchorByIndex(index);
      });
      row.addEventListener('pointerdown', handleAnchorRowPointerDown);
      row.addEventListener('dragstart', (e) => { e.preventDefault(); });
    });

    panel.querySelectorAll('.anchor-slots-container .anchor-slot-btn').forEach(btn => {
      const index = parseInt(btn.dataset.index, 10);
      const action = btn.classList.contains('locate-btn') ? 'locate' :
                     btn.classList.contains('save-btn') ? 'save' :
                     btn.classList.contains('rename-btn') ? 'rename' :
                     btn.classList.contains('delete-btn') ? 'delete' : null;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isTempWorkspaceMode) {
          handleTempSlotAction(action, index, btn);
        } else {
          handleSlotAction(action, index, btn);
        }
      });
    });
  }

  // ==========================================================================
  // 第二形态窄边（48px mini）现代气泡提示系统 (Sidebar Mini Tooltip)
  // ==========================================================================
  let miniTooltipEl = null;
  let miniTooltipTimer = null;
  let miniTooltipHideTimer = null;
  let activeMiniTooltipTarget = null;
  let lastTooltipHideTime = 0;
  const MINI_TOOLTIP_WARM_MS = 300;
  const MINI_TOOLTIP_COLD_DELAY_MS = 100;

  function ensureMiniTooltipElement() {
    if (miniTooltipEl && miniTooltipEl.parentNode) return miniTooltipEl;
    miniTooltipEl = document.getElementById('sidebarMiniFloatingTooltip');
    if (!miniTooltipEl) {
      miniTooltipEl = document.createElement('div');
      miniTooltipEl.id = 'sidebarMiniFloatingTooltip';
      miniTooltipEl.className = 'sidebar-mini-floating-tooltip';
      miniTooltipEl.setAttribute('role', 'tooltip');
      miniTooltipEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(miniTooltipEl);
    }
    return miniTooltipEl;
  }

  function suppressNativeTitles(target) {
    if (!target) return;
    if (target.hasAttribute('title')) {
      target.dataset.originalTitleBackup = target.getAttribute('title');
      target.removeAttribute('title');
    }
    target.querySelectorAll('[title]').forEach(child => {
      child.dataset.originalTitleBackup = child.getAttribute('title');
      child.removeAttribute('title');
    });
  }

  function restoreNativeTitles(target) {
    if (!target) return;
    if (target.dataset.originalTitleBackup !== undefined) {
      target.setAttribute('title', target.dataset.originalTitleBackup);
      delete target.dataset.originalTitleBackup;
    }
    target.querySelectorAll('[data-original-title-backup]').forEach(child => {
      child.setAttribute('title', child.dataset.originalTitleBackup);
      delete child.dataset.originalTitleBackup;
    });
  }

  function hideSidebarMiniTooltip(immediate = false) {
    if (miniTooltipTimer) {
      clearTimeout(miniTooltipTimer);
      miniTooltipTimer = null;
    }
    if (activeMiniTooltipTarget) {
      restoreNativeTitles(activeMiniTooltipTarget);
      activeMiniTooltipTarget = null;
    }
    const tooltip = miniTooltipEl;
    if (!tooltip) return;

    if (immediate) {
      if (miniTooltipHideTimer) {
        clearTimeout(miniTooltipHideTimer);
        miniTooltipHideTimer = null;
      }
      tooltip.classList.remove('is-visible');
      tooltip.style.visibility = 'hidden';
      lastTooltipHideTime = Date.now();
    } else {
      if (miniTooltipHideTimer) clearTimeout(miniTooltipHideTimer);
      miniTooltipHideTimer = setTimeout(() => {
        miniTooltipHideTimer = null;
        tooltip.classList.remove('is-visible');
        tooltip.style.visibility = 'hidden';
        lastTooltipHideTime = Date.now();
      }, 40);
    }
  }

  function resolveSidebarMiniTooltipInfo(target) {
    if (!target) return null;
    if (isAnchorReorderDragging) return null;
    const isEn = isEnglish();

    // 1. 锚点槽位行（anchor slot row 或其内部元素）
    const anchorRow = target.closest('.anchor-slot-row');
    if (anchorRow) {
      const title = anchorRow.dataset.miniTooltipTitle || (isEn ? 'Anchor Slot' : '锚点槽位');
      const shortcut = anchorRow.dataset.miniTooltipShortcut || '';
      const isCurrent = anchorRow.dataset.miniTooltipCurrent === 'true' || anchorRow.classList.contains('active-slot');
      return {
        target: anchorRow,
        title,
        shortcut,
        isCurrent,
        type: 'anchor'
      };
    }

    // 2. 具有明确 data-mini-tooltip-title 的按钮或元素
    const withExplicit = target.closest('[data-mini-tooltip-title]');
    if (withExplicit) {
      const title = withExplicit.dataset.miniTooltipTitle;
      const shortcut = withExplicit.dataset.miniTooltipShortcut || '';
      const sub = withExplicit.dataset.miniTooltipSub || '';
      const isCurrent = withExplicit.dataset.miniTooltipCurrent === 'true';
      return {
        target: withExplicit,
        title,
        shortcut,
        sub,
        isCurrent,
        type: 'explicit'
      };
    }

    // 3. 目录树项或文件夹 summary
    const dirBtn = target.closest('.canvas-dir-item-btn, .canvas-dir-folder > summary, .canvas-dir-pinned-summary');
    if (dirBtn) {
      const titleEl = dirBtn.querySelector('.canvas-dir-title');
      const title = (titleEl && titleEl.textContent ? titleEl.textContent.trim() : '') ||
                    dirBtn.getAttribute('title') ||
                    dirBtn.dataset.originalTitleBackup || '';
      if (!title) return null;
      const countEl = dirBtn.querySelector('.canvas-dir-count');
      const countText = countEl && countEl.textContent ? countEl.textContent.trim() : '';
      const sub = countText ? `${countText} ${isEn ? 'items' : '个条目'}` : '';
      return {
        target: dirBtn,
        title,
        sub,
        type: 'dir'
      };
    }

    // 4. Tab 切换按钮
    const tabBtn = target.closest('.sidebar-tab-btn');
    if (tabBtn) {
      const tabType = tabBtn.dataset.tab;
      const title = tabType === 'anchor' ? (isEn ? 'Anchors' : '锚点') : (isEn ? 'Directory' : '目录');
      return {
        target: tabBtn,
        title,
        type: 'tab'
      };
    }

    // 5. 侧边栏折叠按钮（无需说明气泡）
    const toggleBtn = target.closest('#sidebarToggle');
    if (toggleBtn) {
      return null;
    }

    // 6. 通用按钮兜底
    const anyBtn = target.closest('button, [role="button"]');
    if (anyBtn) {
      const title = anyBtn.getAttribute('title') || anyBtn.dataset.originalTitleBackup || anyBtn.getAttribute('aria-label');
      if (title && title.trim()) {
        return {
          target: anyBtn,
          title: title.trim(),
          type: 'generic'
        };
      }
    }

    return null;
  }

  function showSidebarMiniTooltip(info) {
    if (!info || !info.target) return;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !sidebar.classList.contains('mini')) {
      hideSidebarMiniTooltip(true);
      return;
    }

    if (miniTooltipHideTimer) {
      clearTimeout(miniTooltipHideTimer);
      miniTooltipHideTimer = null;
    }

    const target = info.target;
    if (activeMiniTooltipTarget && activeMiniTooltipTarget !== target) {
      restoreNativeTitles(activeMiniTooltipTarget);
    }
    activeMiniTooltipTarget = target;
    suppressNativeTitles(target);

    const tooltip = ensureMiniTooltipElement();
    const isEn = isEnglish();

    let html = '<div class="sidebar-mini-tooltip-inner">';
    html += '<div class="sidebar-mini-tooltip-row">';
    html += `<span class="sidebar-mini-tooltip-name">${escapeHtml(info.title)}</span>`;
    if (info.isCurrent) {
      html += `<span class="sidebar-mini-tooltip-badge-current">${isEn ? 'Current' : '当前'}</span>`;
    }
    html += '</div>';

    if (info.shortcut) {
      let cleanKey = info.shortcut;
      let labelText = isEn ? 'Shortcut' : '快捷键';
      if (cleanKey.includes('：') || cleanKey.includes(':')) {
        const parts = cleanKey.split(/[:：]/);
        labelText = parts[0].trim();
        cleanKey = parts.slice(1).join(':').trim();
      }
      html += '<div class="sidebar-mini-tooltip-sub">';
      html += `<span class="sidebar-mini-tooltip-sub-label">${escapeHtml(labelText)}</span>`;
      html += `<kbd class="sidebar-mini-tooltip-kbd">${escapeHtml(cleanKey)}</kbd>`;
      html += '</div>';
    } else if (info.sub) {
      html += '<div class="sidebar-mini-tooltip-sub">';
      html += `<span class="sidebar-mini-tooltip-sub-text">${escapeHtml(info.sub)}</span>`;
      html += '</div>';
    }
    html += '</div>';

    tooltip.innerHTML = html;
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';

    const rect = target.getBoundingClientRect();
    const isRight = sidebar.classList.contains('position-right');
    const gap = 10;
    const margin = 8;

    const tooltipW = tooltip.offsetWidth || 120;
    const tooltipH = tooltip.offsetHeight || 36;

    let left = isRight ? (rect.left - gap - tooltipW) : (rect.right + gap);
    let top = rect.top + rect.height / 2;

    const minTop = margin + tooltipH / 2;
    const maxTop = window.innerHeight - margin - tooltipH / 2;
    const clampedTop = Math.max(minTop, Math.min(maxTop, top));

    const arrowOffsetY = Math.max(8, Math.min(tooltipH - 8, tooltipH / 2 + (top - clampedTop)));
    tooltip.style.setProperty('--tooltip-arrow-y', `${Math.round(arrowOffsetY)}px`);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(clampedTop - tooltipH / 2)}px`;
    tooltip.classList.toggle('is-on-right', isRight);

    tooltip.style.visibility = '';
    tooltip.classList.add('is-visible');
  }

  function setupSidebarMiniTooltip() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.dataset.miniTooltipBound === 'true') return;
    sidebar.dataset.miniTooltipBound = 'true';

    sidebar.addEventListener('pointerover', (e) => {
      if (!sidebar.classList.contains('mini')) return;
      const info = resolveSidebarMiniTooltipInfo(e.target);
      if (!info) {
        hideSidebarMiniTooltip();
        return;
      }

      if (activeMiniTooltipTarget === info.target && miniTooltipEl && miniTooltipEl.classList.contains('is-visible')) {
        return;
      }

      if (miniTooltipTimer) {
        clearTimeout(miniTooltipTimer);
        miniTooltipTimer = null;
      }

      const now = Date.now();
      const isWarm = (now - lastTooltipHideTime) < MINI_TOOLTIP_WARM_MS;
      const delay = isWarm ? 0 : MINI_TOOLTIP_COLD_DELAY_MS;

      if (delay === 0) {
        showSidebarMiniTooltip(info);
      } else {
        miniTooltipTimer = setTimeout(() => {
          miniTooltipTimer = null;
          showSidebarMiniTooltip(info);
        }, delay);
      }
    }, true);

    sidebar.addEventListener('pointerout', (e) => {
      const related = e.relatedTarget;
      if (activeMiniTooltipTarget && related && activeMiniTooltipTarget.contains(related)) {
        return;
      }
      hideSidebarMiniTooltip();
    }, true);

    sidebar.addEventListener('pointerdown', () => {
      hideSidebarMiniTooltip(true);
    }, true);

    window.addEventListener('scroll', () => {
      hideSidebarMiniTooltip(true);
    }, true);
  }

  function setupSidebarTabs() {
    const tabDir = document.getElementById('sidebarTabDirectory');
    const tabHist = document.getElementById('sidebarTabAnchor');
    const panelDir = document.getElementById('canvasDirectoryTree');
    const panelHist = document.getElementById('canvasHistoryPanel');
    
    if (!tabDir || !tabHist || !panelDir || !panelHist) return;
    
    const isEn = isEnglish();
    const dirText = isEn ? 'Directory' : '目录';
    const anchorText = isEn ? 'Anchors' : '锚点';
    tabDir.title = dirText;
    tabHist.title = anchorText;
    tabDir.dataset.miniTooltipTitle = dirText;
    tabHist.dataset.miniTooltipTitle = anchorText;
    tabDir.classList.toggle('lang-en', isEn);
    tabHist.classList.toggle('lang-en', isEn);
    const tabsHeader = tabDir.closest('.sidebar-tabs-header');
    if (tabsHeader) {
      tabsHeader.classList.toggle('lang-en', isEn);
    }
    const textDir = tabDir.querySelector('.sidebar-tab-text');
    if (textDir) {
      textDir.textContent = dirText;
    } else {
      tabDir.innerHTML = `<i class="fas fa-sitemap sidebar-tab-icon" aria-hidden="true"></i><span class="sidebar-tab-text">${dirText}</span>`;
    }
    const textHist = tabHist.querySelector('.sidebar-tab-text');
    if (textHist) {
      textHist.textContent = anchorText;
    } else {
      tabHist.innerHTML = `<i class="fas fa-anchor sidebar-tab-icon" aria-hidden="true"></i><span class="sidebar-tab-text">${anchorText}</span>`;
    }
    
    const navTabs = panelHist.closest('.nav-tabs');

    tabDir.addEventListener('click', () => {
      tabDir.classList.add('active');
      tabHist.classList.remove('active');
      panelDir.style.display = '';
      panelHist.style.display = 'none';
      if (navTabs) navTabs.classList.remove('history-tab-active');
      localStorage.setItem('canvasSidebarActiveTab', 'directory');
      onBecameVisible();
    });
    
    tabHist.addEventListener('click', () => {
      tabHist.classList.add('active');
      tabDir.classList.remove('active');
      panelDir.style.display = 'none';
      panelHist.style.display = '';
      if (navTabs) navTabs.classList.add('history-tab-active');
      localStorage.setItem('canvasSidebarActiveTab', 'anchor');
      renderHistoryPanel();
    });
    
    const savedTab = localStorage.getItem('canvasSidebarActiveTab') || 'directory';
    const isAnchor = (savedTab === 'anchor' || savedTab === 'history');
    if (isAnchor) {
      tabHist.classList.add('active');
      tabDir.classList.remove('active');
      panelDir.style.display = 'none';
      panelHist.style.display = '';
      if (navTabs) navTabs.classList.add('history-tab-active');
      renderHistoryPanel();
    } else {
      tabDir.classList.add('active');
      tabHist.classList.remove('active');
      panelDir.style.display = '';
      panelHist.style.display = 'none';
      if (navTabs) navTabs.classList.remove('history-tab-active');
    }

  }

  function setupStorageChangeListener() {
    const storageApi = (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.onChanged)
      ? chrome.storage.onChanged
      : ((typeof browser !== 'undefined' && browser && browser.storage && browser.storage.onChanged)
        ? browser.storage.onChanged
        : null);

    if (!storageApi) return;

    try {
      storageApi.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const relevantPrefixes = ['bcs:', 'canvas', 'bookmark', 'group-', 'preferredLang'];
        const hasRelevantChange = Object.keys(changes).some((k) =>
          relevantPrefixes.some((prefix) => k.startsWith(prefix))
        );
        if (hasRelevantChange) {
          queueRefresh();
        }
      });
    } catch (_) {}
  }

  function init() {
    if (initialized) {
      queueRefresh({ force: true });
      return;
    }

    initialized = true;
    ensureCanvasObserver();
    queueRefresh({ force: true });
    consumePostReloadLocateRequest();
    global.addEventListener('pointerdown', handleGlobalPointerDown, true);
    global.addEventListener('keydown', handleAnchorShortcutKeydown, true);

    try { setupSidebarTabs(); } catch (_) {}
    try { setupSidebarMiniTooltip(); } catch (_) {}

    // Event-driven: 监听 BCS 及底层的持久化存储变动（跨标签页、跨侧边栏秒级响应）
    setupStorageChangeListener();

    // 低频休眠兜底心跳（60秒一次，且仅在目录真实可见时执行，彻底消除1.2秒高频空转）
    refreshTimer = global.setInterval(() => {
      if (isSidebarDirectoryVisible()) {
        ensureCanvasObserver();
        queueRefresh();
      }
    }, REFRESH_INTERVAL_MS);

    // 页面可见性感知：切换回前台时，自动补齐休眠期间积攒的刷新
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        onBecameVisible();
      }
    });

    global.addEventListener('focus', () => {
      onBecameVisible();
    });

    // 监听侧边栏折叠/展开过渡
    const sidebar = document.getElementById('sidebar');
    if (sidebar && typeof MutationObserver !== 'undefined') {
      try {
        const sidebarObserver = new MutationObserver(() => {
          if (!sidebar.classList.contains('mini')) {
            hideSidebarMiniTooltip(true);
          }
          if (isSidebarDirectoryVisible()) {
            onBecameVisible();
          }
        });
        sidebarObserver.observe(sidebar, {
          attributes: true,
          attributeFilter: ['class', 'data-collapse-state']
        });
      } catch (_) {}
    }

    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        global.setTimeout(() => {
          if (isSidebarDirectoryVisible()) {
            onBecameVisible();
          }
        }, 60);
      });
    }

    global.addEventListener('storage', (event) => {
      const isFolderStateChange = !event || event.key === FOLDER_OPEN_STATES_KEY || event.key === PINNED_KEYS_STORAGE_KEY || event.key === PINNED_SECTION_OPEN_KEY;
      if (isFolderStateChange) {
        queueRefresh({
          force: false,
          preferStoredFolderStates: true
        });
      } else {
        // 非目录折叠状态的存储变动（例如其他Tab写的bcs信号）：走普通比对刷新，避免暴力闪烁
        queueRefresh();
      }
      if (event && event.key === TEMP_ANCHOR_ENABLED_STORAGE_KEY) {
        try {
          const val = localStorage.getItem(TEMP_ANCHOR_ENABLED_STORAGE_KEY);
          if (val !== null) {
            isTempAnchorEnabled = (val === 'true');
          }
        } catch (_) {}
      }
      if (event && event.key === 'canvas-custom-shortcuts') {
        try { updateSidebarAnchorShortcutDisplays(); } catch (_) {}
      }
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-navigation-history-updated', () => {
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-other-settings-updated', (e) => {
      try {
        if (e && e.detail && typeof e.detail.tempAnchorEnabled === 'boolean') {
          isTempAnchorEnabled = e.detail.tempAnchorEnabled;
        }
      } catch (_) {}
      queueRefresh();
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-maximized-state-change', () => {
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-shortcuts-updated', () => {
      try { updateSidebarAnchorShortcutDisplays(); } catch (_) {}
    });

    global.addEventListener('shared-state-updated', () => {
      try { updateSidebarAnchorShortcutDisplays(); } catch (_) {}
      queueRefresh();
    });

    global.addEventListener('bcs:language-changed', () => {
      queueRefresh({ force: true });
    });

    global.addEventListener('canvas-search-state-ready', () => {
      queueRefresh({ force: true });
    });

    document.addEventListener('click', (e) => {
      const anchorPanel = document.getElementById('anchorInlineSettings');
      const anchorBtn = document.getElementById('anchorSettingsBtn');

      let changed = false;

      // Click outside anchor settings panel & button collapses settings panel
      if (anchorSettingsOpen && anchorPanel && anchorBtn) {
        if (!anchorPanel.contains(e.target) && !anchorBtn.contains(e.target)) {
          saveSettingsOnCollapse();
          anchorSettingsOpen = false;
          changed = true;
        }
      }

      if (changed) {
        renderHistoryPanel();
      }
    });
  }

  function refresh(options = {}) {
    queueRefresh({ force: !!(options && options.force) });
  }

  global.CanvasSidebarDirectory = {
    init,
    refresh,
    isEntityPinned,
    toggleEntityPin,
    findDirectoryNodeByTarget,
    unpinByEntityId,
    unpinAllNonPermanent,
    navigateManualAnchorSlot,
    navigateTempAnchorSlot,
    locateAnchorByIndex,
    toggleTempWorkspaceMode,
    isTempWorkspaceMode: () => isTempWorkspaceMode,
    addManualAnchorFromCurrentViewport,
    addTempAnchorFromCurrentViewport,
    getManualAnchorSlots: () => loadAnchorSlots(),
    getTempAnchorSlots: () => loadTempAnchorSlots(),
    isTempAnchorEnabled: () => isTempAnchorEnabled,
    setTempAnchorEnabled: (enabled) => saveTempAnchorEnabledState(enabled),
    renderHistoryPanel,
    refreshNavHistoryPanel: () => {
      renderHistoryPanel();
    },
    refreshManualAnchorSlotsUI,
    refreshTempAnchorSlotsUI,
    locateCardGroup,
    renderPreviewDirectory,
    getMdNodeTitle,
    getTempSectionDisplayText,
    isFullscreenHistoryDescriptorValid,
    resolveFullscreenHistoryCardPresentation,
    clampCardTitle,
    getSortedMdNodes: (mdNodes) => {
      if (!Array.isArray(mdNodes)) return [];
      return [...mdNodes].sort((a, b) => {
        const titleA = getMdNodeTitle(a);
        const titleB = getMdNodeTitle(b);
        const cmp = compareText(titleA, titleB);
        if (cmp !== 0) return cmp;
        const at = toPositiveInt(a && a.createdAt);
        const bt = toPositiveInt(b && b.createdAt);
        if (at && bt && at !== bt) return at - bt;
        if (at && !bt) return -1;
        if (!at && bt) return 1;
        return compareText(a && a.id, b && b.id);
      });
    },
    hideSidebarMiniTooltip
  };
})(window);

