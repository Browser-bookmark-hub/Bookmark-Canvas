(function setupCanvasSidebarDirectory(global) {
  'use strict';

  const ROOT_ID = 'canvasDirectoryTree';
  const CANVAS_CONTENT_ID = 'canvasContent';
  const REFRESH_INTERVAL_MS = 1200;
  const REFRESH_DEFER_MS = 180;
  const PREVIEW_LIMIT = 30;
  const STRIP_HTML_CACHE_LIMIT = 1200;
  const BCS_CANVAS_KEY = 'bcs:canvas';
  const PERMANENT_COPIES_STORAGE_KEY = 'bcs:perm:copies';
  const PERMANENT_MAIN_TIP_STORAGE_KEY = 'bcs:perm:tip-main';
  const PERMANENT_COPY_TIP_STORAGE_PREFIX = 'bcs:perm:tip-copy-';
  const FOLDER_OPEN_STATES_KEY = 'bcs:sidebar:folder_open_states';
  const POST_RELOAD_LOCATE_KEY = 'bcs:post-reload-locate';

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
    edge: '#999999'
  });
  const DIRECTORY_LOCATABLE_NEUTRAL_COLOR = '#888888';
  const IMPORT_DIRECTORY_NEUTRAL_COLOR = '#9aa0a6';

  let initialized = false;
  let refreshTimer = null;
  let refreshRaf = null;
  let refreshDeferredTimer = null;
  let pendingForceRefresh = false;
  let pendingPreferStoredFolderStates = false;
  let canvasObserver = null;
  let observedCanvasContent = null;
  let lastFingerprint = '';
  let activeNodeKey = '';
  let nodeActionMap = new Map();
  let nodeDeleteActionMap = new Map();
  let pendingDeleteUiKey = '';

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
      edge: normalizeHexColor(colors && colors.edge, defaults.edge)
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
        edge: DIRECTORY_LOCATABLE_NEUTRAL_COLOR
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
    if (section.isSnapshot) return true;
    const tempKindRaw = normalizeText(section.tempKind).toLowerCase();
    if (tempKindRaw === 'special') return true;
    if (tempKindRaw === 'regular') return false;

    const sourceRaw = normalizeText(section.source).toLowerCase();
    if (sourceRaw && SPECIAL_TEMP_SOURCE_SET.has(sourceRaw)) return true;

    const labelRaw = normalizeText(section.label);
    if (!labelRaw) return false;
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
        icon: 'fas fa-code-branch',
        variant: 'chain-item',
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
      .map(([bucket, bucketSections]) => makeFolderNode({
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
        children: buildFlatTempSectionNodes(bucketSections, {
          resolveColor: options.resolveColor,
          fallbackColor: options.color || '',
          defaultColor: options.defaultColor || options.color || '',
          keyPrefix: `${keyPrefix}${bucket}-`
        })
      }));
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
        folderNodes.push(makeFolderNode({
          key: `${parentKey}-cat-${cat}`,
          code: '',
          title: cat === 'other' ? t('其他', 'Other') : cat,
          color: folderColor,
          defaultColor,
          icon: 'fas fa-folder',
          open: false,
          count: groupNodes.length,
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
        const isLocatableNode = !!node.target && !node.placeholder;

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
        keyPrefix: `${keyPrefix}temp-split-`
      });

      if (!splitItems.length) {
        splitItems.push(makePlaceholderItem(
          config.splitEmptyKey || `${keyPrefix}temp-split-empty`,
          '',
          t('暂无分裂栏目', 'No split sections'),
          {
            color: splitColor,
            defaultColor: splitColor
          }
        ));
      }

      const specialItems = buildFlatTempSectionNodes(specialTempSections, {
        resolveColor: sectionColorResolver,
        fallbackColor: specialColor,
        defaultColor: specialColor,
        keyPrefix: `${keyPrefix}temp-special-`
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
          open: true,
          count: labeledEdges.length,
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
          open: true,
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
      color: '',
      defaultColor: '',
      open: true,
      count: cardGroupItems.length,
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

    if (!hasDelete && !isGroup) return;

    const deleteWrap = document.createElement('span');
    deleteWrap.className = 'canvas-dir-folder-delete-wrap';
    const deleteUiOpen = hasDelete && !!pendingDeleteUiKey && pendingDeleteUiKey === node.key;
    if (deleteUiOpen) {
      deleteWrap.classList.add('is-open');
    }

    if (isGroup) {
      const locateBtn = document.createElement('button');
      locateBtn.type = 'button';
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
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
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
          const currentBtn = document.createElement('button');
          currentBtn.type = 'button';
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

          const allBtn = document.createElement('button');
          allBtn.type = 'button';
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
          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.className = 'canvas-dir-folder-delete-confirm';
          confirmBtn.dataset.nodeDeleteKey = node.key;
          confirmBtn.title = labels.confirm;
          confirmBtn.setAttribute('aria-label', labels.confirm);
          confirmBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i>';
          secondaryWrap.appendChild(confirmBtn);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
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
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
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
    if (node.showDeleteControl && node.deleteAction) {
      btn.classList.add('canvas-dir-item-btn-has-delete');
    }

    item.appendChild(btn);

    if (node.showDeleteControl && node.deleteAction) {
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
    const highlight = () => {
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

    switch (target.kind) {
      case 'permanent-main':
        return resolvePermanentSectionElement(null);
      case 'permanent-copy': {
        const copyId = normalizeText(target.copyId);
        if (!copyId) return null;
        return resolvePermanentSectionElement(copyId);
      }
      case 'temp-section': {
        const sectionId = normalizeText(target.sectionId);
        if (!sectionId) return null;
        return document.getElementById(sectionId);
      }
      case 'md-node': {
        const nodeId = normalizeText(target.nodeId);
        if (!nodeId) return null;
        let el = document.getElementById(nodeId);
        if (!el && window.CanvasModule && typeof window.CanvasModule.locateElement === 'function') {
          try { window.CanvasModule.locateElement(nodeId); } catch (_) { }
          el = document.getElementById(nodeId);
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

    if (window.CanvasModule && typeof window.CanvasModule.toggleElementFullscreen === 'function') {
      try {
        window.CanvasModule.toggleElementFullscreen(nextTarget);
        return true;
      } catch (_) { }
    }

    const fullscreenBtn = nextTarget.querySelector('.canvas-node-fullscreen-btn');
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
    const locateBtn = event && event.target && event.target.closest ? event.target.closest('.canvas-dir-folder-locate') : null;
    if (locateBtn) {
      event.preventDefault();
      event.stopPropagation();
      const nodeKey = locateBtn.dataset.nodeLocateKey;
      if (nodeKey) {
        const target = nodeActionMap.get(nodeKey);
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
      }
      return;
    }

    const targetEl = event && event.target && event.target.closest
      ? event.target.closest('.canvas-dir-item-btn, .canvas-dir-folder-summary-btn')
      : null;
    if (!targetEl || !targetEl.dataset) return;

    const nodeKey = targetEl.dataset.nodeKey;
    if (!nodeKey) return;

    const target = nodeActionMap.get(nodeKey);
    if (!target) return;

    if (targetEl.classList.contains('canvas-dir-folder-summary-btn')) {
      const isTitleClick = !!event.target.closest('.canvas-dir-title');
      if (isTitleClick) {
        const folderEl = targetEl.closest('.canvas-dir-folder');
        const isCardGroupFolder = !!(folderEl && folderEl.dataset && folderEl.dataset.nodeVariant === 'card-group-item');
        if (isCardGroupFolder) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

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
        return;
      } else {
        // Clicked non-title, non-button area. Let details toggle natively.
        // Do not locate, do not set activeNodeKey / highlight.
        return;
      }
    }

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
        const key = details.dataset.nodeKey;
        if (key) {
          saveFolderOpenState(key, details.open);
        }
      }
    }, true);
  }

  function renderPreviewDirectory(root, previewState, options = {}) {
    if (!root) return;
    applyDirectoryColorVars(root);
    nodeActionMap = new Map();
    nodeDeleteActionMap = new Map();

    const openFolderKeys = new Set();
    const previewNodes = buildDirectoryDataForPreview(previewState, options);

    root.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'canvas-dir-root';
    previewNodes.forEach((node) => {
      container.appendChild(renderNode(node, openFolderKeys));
    });
    root.appendChild(container);
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
    const fingerprint = JSON.stringify({
      lang: getLang(),
      nodes: serializeNodesForFingerprint(nodes)
    });

    if (!options.force && fingerprint === lastFingerprint) {
      updateActiveState(root);
      return;
    }

    lastFingerprint = fingerprint;
    nodeActionMap = new Map();
    nodeDeleteActionMap = new Map();
    root.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'canvas-dir-root';
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

  function queueRefresh(options = {}) {
    if (options.force) pendingForceRefresh = true;
    if (options.preferStoredFolderStates) pendingPreferStoredFolderStates = true;
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
      return `${timeShortStr} | ${m} ${d}`;
    } else {
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${timeShortStr} | ${m}月${d}日`;
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
    return { autoRecordAnchor: false, autoRecordAnchorInterval: 15, manualAnchorLimit: 5 };
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
    const settings = getCanvasOtherSettingsSafe();
    let val = parseInt(settings.manualAnchorLimit, 10);
    if (isNaN(val) || val < 1) val = 5;
    return val;
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
    if (typeof global.showToast === 'function') {
      global.showToast(msg);
    } else {
      alert(msg);
    }
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
    while (slots.length < limit) {
      slots.push(null);
    }
    if (slots.length > limit) {
      slots = slots.slice(0, limit);
    }
    return slots;
  }

  function saveAnchorSlots(slots) {
    try {
      localStorage.setItem('canvasManualAnchorSlots', JSON.stringify(slots));
    } catch (e) {
      console.error('Failed to save manual anchor slots:', e);
    }
    window.dispatchEvent(new CustomEvent('storage', { key: 'canvasManualAnchorSlots' }));
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
      
      const existingName = slots[index] ? slots[index].name : null;
      const defaultName = existingName || (isEn ? `Slot ${index + 1}` : `槽位 ${index + 1}`);
      
      slots[index] = {
        name: defaultName,
        x: state.panOffsetX,
        y: state.panOffsetY,
        zoom: state.zoom,
        timestamp: Date.now()
      };
      highlightSlotIndex = index;
      saveAnchorSlots(slots);
      renderHistoryPanel();
      if (typeof global.showToast === 'function') {
        global.showToast(isEn ? 'Viewport saved to slot' : '视口已保存至槽位');
      }
    } 
    else if (action === 'locate') {
      const slot = slots[index];
      if (!slot) return;
      navigateToViewportFromAnchor(slot).then(() => {
        setTimeout(renderHistoryPanel, 50);
      });
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
      slots[index] = null;
      saveAnchorSlots(slots);
      renderHistoryPanel();
    }
  }

  function getDynamicStep() {
    const panel = document.getElementById('canvasHistoryPanel');
    const height = panel ? panel.clientHeight : 0;
    if (height <= 0) return 5;
    return Math.max(5, Math.floor(height / 100));
  }

  let autoRecordSettingsOpen = false;
  let manualAnchorSettingsOpen = false;
  let autoRecordVisibleLimit = 5;
  try {
    const saved = localStorage.getItem('canvas-auto-record-visible-limit');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 5) autoRecordVisibleLimit = parsed;
    }
  } catch (_) {}

  let manualAnchorVisibleLimit = 5;
  try {
    const saved = localStorage.getItem('canvas-manual-anchor-visible-limit');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 5) manualAnchorVisibleLimit = parsed;
    }
  } catch (_) {}
  
  let highlightSlotIndex = null;

  function saveManualSettingsOnCollapse() {
    const manualPanel = document.getElementById('manualAnchorInlineSettings');
    if (!manualPanel) return;
    const input = manualPanel.querySelector('#inlineManualAnchorLimitInput');
    if (!input) return;
    
    const rawVal = input.value.trim();
    let val = 5; // default
    if (/^[1-9]\d*$/.test(rawVal)) {
      const parsed = parseInt(rawVal, 10);
      val = Math.max(1, Math.min(50, parsed));
    }
    
    const currentSettings = getCanvasOtherSettingsSafe();
    currentSettings.manualAnchorLimit = val;
    saveCanvasOtherSettingsInline(currentSettings);
    
    let slots = loadAnchorSlots();
    saveAnchorSlots(slots);
  }

  function saveAutoRecordSettingsOnCollapse() {
    const autoPanel = document.getElementById('autoRecordInlineSettings');
    if (!autoPanel) return;
    
    const check = document.getElementById('inlineAutoRecordCheck');
    const intervalInput = autoPanel.querySelector('#inlineAutoRecordIntervalInput');
    const limitInput = autoPanel.querySelector('#inlineAutoRecordLimitInput');
    
    const currentSettings = getCanvasOtherSettingsSafe();
    
    if (check) {
      currentSettings.autoRecordAnchor = check.checked;
    }
    
    if (intervalInput) {
      const rawVal = intervalInput.value.trim();
      let val = 15; // default
      if (/^[1-9]\d*$/.test(rawVal)) {
        const parsed = parseInt(rawVal, 10);
        val = Math.max(1, Math.min(60, parsed));
      }
      currentSettings.autoRecordAnchorInterval = val;
    }
    
    if (limitInput) {
      const rawVal = limitInput.value.trim();
      let val = 5; // default
      if (/^[1-9]\d*$/.test(rawVal)) {
        const parsed = parseInt(rawVal, 10);
        val = Math.max(1, Math.min(50, parsed));
      }
      currentSettings.autoRecordAnchorLimit = val;
      
      let currentHistoryList = [];
      try {
        const raw = localStorage.getItem('canvasNavigationHistory');
        if (raw) currentHistoryList = JSON.parse(raw);
      } catch (_) {}
      if (Array.isArray(currentHistoryList) && currentHistoryList.length > val) {
        currentHistoryList = currentHistoryList.slice(0, val);
        localStorage.setItem('canvasNavigationHistory', JSON.stringify(currentHistoryList));
      }
    }
    
    saveCanvasOtherSettingsInline(currentSettings);
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

  function renderHistoryPanelActual() {
    const panel = document.getElementById('canvasHistoryPanel');
    if (!panel || panel.style.display === 'none') return;

    const slotsList = panel.querySelector('.anchor-slots-container');
    const historyListEl = panel.querySelector('.history-items-container');
    const slotsScrollTop = slotsList ? slotsList.scrollTop : 0;
    const historyScrollTop = historyListEl ? historyListEl.scrollTop : 0;

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
    const slots = loadAnchorSlots();
    const isCardFullscreen = isCanvasNodeFullscreenActive();
    
    let historyList = [];
    try {
      const raw = localStorage.getItem('canvasNavigationHistory');
      if (raw) historyList = JSON.parse(raw);
    } catch (_) {}
    if (!Array.isArray(historyList)) historyList = [];
    
    const step = getDynamicStep();
    if (manualAnchorVisibleLimit < step) {
      manualAnchorVisibleLimit = step;
    }
    if (autoRecordVisibleLimit < step) {
      autoRecordVisibleLimit = step;
    }

    const otherSettings = getCanvasOtherSettingsSafe();
    const isAutoRecordEnabled = otherSettings.autoRecordAnchor === true;
    const autoRecordInterval = otherSettings.autoRecordAnchorInterval || 15;
    const manualAnchorLimit = getManualAnchorLimit();
    
    const savedSlots = slots
      .map((slot, idx) => slot ? { ...slot, originalIndex: idx } : null)
      .filter(s => s !== null);

    const isFull = savedSlots.length >= manualAnchorLimit;
    const isAutoDisabledOrEmpty = historyList.length === 0;
      
    let html = `
      <div class="sidebar-anchor-container${isAutoDisabledOrEmpty ? ' auto-inactive' : ''}">
        <!-- Section 1: Pinned Anchors -->
        <div class="sidebar-section-header manual-anchor-header">
          <span class="sidebar-section-title">${isEn ? 'Pinned Anchors' : '固定锚点'}</span>
          <div class="sidebar-header-actions">
            <button class="sidebar-action-btn${isFull ? ' is-full' : ''}${isCardFullscreen ? ' is-disabled' : ''}" id="addManualAnchorBtn" title="${isEn ? 'Add Anchor' : '添加锚点'}"${isCardFullscreen ? ' disabled' : ''}>
              <i class="fas fa-plus"></i>
            </button>
            <button class="sidebar-action-btn" id="manualAnchorSettingsBtn" title="${isEn ? 'Anchor Settings' : '锚点设置'}">
              <i class="fas fa-cog"></i>
            </button>
          </div>
        </div>
        
        <!-- Inline Settings Panel for Pinned Anchors -->
        <div class="manual-anchor-settings-panel" id="manualAnchorInlineSettings" style="${manualAnchorSettingsOpen ? '' : 'display: none;'}">
          <div class="settings-inline-row" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="settings-inline-span">${isEn ? 'Max capacity:' : '最大记录数量：'}</span>
            <input type="number" id="inlineManualAnchorLimitInput" min="1" max="50" value="${manualAnchorLimit}" />
          </div>
        </div>
        
        <div class="anchor-slots-container">
    `;
    
    const visibleSavedSlots = savedSlots.slice(0, manualAnchorVisibleLimit);

    if (savedSlots.length === 0) {
      html += `
        <div class="history-empty-tip">
          ${isEn ? 'No pinned anchors yet.' : '暂无固定锚点'}
        </div>
      `;
    } else {
      visibleSavedSlots.forEach((slot) => {
        const index = slot.originalIndex;
        const slotNum = index + 1;
        const displayName = slot.name || (isEn ? `Slot ${slotNum}` : `槽位 ${slotNum}`);
        const zoomPercent = formatAnchorZoomPercent(slot.zoom);
        const absoluteTimeStr = slot.timestamp ? formatAbsoluteTime(slot.timestamp, isEn) : '';
        
        html += `
          <div class="anchor-slot-row" data-index="${index}">
            <div class="anchor-slot-header">
              <span class="anchor-slot-name" title="${displayName}">${displayName}</span>
              <div class="anchor-slot-actions">
                <button class="anchor-slot-btn rename-btn" data-index="${index}" title="${isEn ? 'Rename slot' : '重命名槽位'}">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="anchor-slot-btn delete-btn" data-index="${index}" title="${isEn ? 'Clear slot' : '清除槽位'}">
                  <i class="fas fa-trash-alt"></i>
                </button>
                <button class="anchor-slot-btn save-btn${isCardFullscreen ? ' is-disabled' : ''}" data-index="${index}" title="${isEn ? 'Overwrite with current viewport' : '用当前视口覆盖'}"${isCardFullscreen ? ' disabled' : ''}>
                  <i class="fas fa-anchor"></i>
                </button>
                <button class="anchor-slot-btn locate-btn" data-index="${index}" title="${isEn ? 'Locate viewport' : '定位到此视口'}">
                  <i class="fas fa-crosshairs"></i>
                </button>
              </div>
            </div>
            <div class="anchor-slot-info">
              <span class="anchor-slot-coords">X: ${Math.round(slot.x)} | Y: ${Math.round(slot.y)} | ${zoomPercent}</span>
              ${absoluteTimeStr ? `<span class="anchor-slot-time">${absoluteTimeStr}</span>` : ''}
            </div>
          </div>
        `;
      });
    }
    
    const hasMoreManual = savedSlots.length > visibleSavedSlots.length;
    const canCollapseManual = manualAnchorVisibleLimit > step;
    if (hasMoreManual || canCollapseManual) {
      const remaining = savedSlots.length - visibleSavedSlots.length;
      const willLoad = Math.min(step, remaining);
      
      html += `
        <div class="lazy-load-container" style="display: flex; gap: 8px; margin: 4px 8px 8px 8px; justify-content: center;">
      `;
      if (hasMoreManual) {
        html += `
          <button class="lazy-load-btn load-more-btn" id="manualAnchorLoadMoreBtn" style="flex: 1;">
            <i class="fas fa-chevron-down"></i> ${isEn ? `Show More (+${willLoad})` : `展开更多 (+${willLoad})`}
          </button>
        `;
      }
      if (canCollapseManual) {
        html += `
          <button class="lazy-load-btn collapse-btn" id="manualAnchorCollapseBtn" style="flex: 1;">
            <i class="fas fa-chevron-up"></i> ${isEn ? 'Collapse' : '收起'}
          </button>
        `;
      }
      html += `</div>`;
    }
    
    html += `</div>`;
    
    html += `
        <!-- Section 2: Auto-Saved History -->
        <div class="sidebar-section-header auto-record-header" style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
            <span class="sidebar-section-title" style="line-height: 1.2;">${isEn ? 'Auto' : '自动'}</span>
            <label class="other-toggle-switch" style="margin: 0; transform: scale(0.8); transform-origin: left center; flex-shrink: 0;" title="${isEn ? 'Enable Auto-save' : '开启自动保存'}">
              <input type="checkbox" id="inlineAutoRecordCheck" ${isAutoRecordEnabled ? 'checked' : ''}${isCardFullscreen && !isAutoRecordEnabled ? ' disabled' : ''} />
              <span class="other-toggle-slider"></span>
            </label>
          </div>
          <div class="sidebar-header-actions" style="flex-shrink: 0;">
            <button class="sidebar-action-btn" id="historyClearBtn" title="${isEn ? 'Clear All' : '清空历史'}">
              <i class="fas fa-trash-alt"></i>
            </button>
            <button class="sidebar-action-btn" id="autoRecordSettingsBtn" style="${isAutoRecordEnabled ? '' : 'display: none;'}" title="${isEn ? 'Auto-save Settings' : '自动保存设置'}">
              <i class="fas fa-cog"></i>
            </button>
          </div>
        </div>
        
        <!-- Inline Settings Panel -->
        <div class="auto-record-settings-panel" id="autoRecordInlineSettings" style="${autoRecordSettingsOpen && isAutoRecordEnabled ? '' : 'display: none;'}">
          <div class="settings-inline-row" id="inlineIntervalRow">
            <span class="settings-inline-span">${isEn ? 'Interval (s):' : '间隔 (秒)：'}</span>
            <input type="number" id="inlineAutoRecordIntervalInput" min="1" max="60" value="${autoRecordInterval}" />
          </div>
          <div class="settings-inline-row" id="inlineLimitRow">
            <span class="settings-inline-span">${isEn ? 'Max capacity:' : '最大记录数量：'}</span>
            <input type="number" id="inlineAutoRecordLimitInput" min="1" max="50" value="${otherSettings.autoRecordAnchorLimit || 5}" />
          </div>
        </div>
        
        <div class="history-items-container">
    `;
    
    const limit = otherSettings.autoRecordAnchorLimit || 5;
    const currentHistoryList = historyList.slice(0, limit);
    const visibleHistoryList = currentHistoryList.slice(0, autoRecordVisibleLimit);
    
    if (currentHistoryList.length === 0) {
      html += `
        <div class="history-empty-tip">
          ${isEn ? 'No auto-saved viewports yet' : '暂无自动记录'}
        </div>
      `;
    } else {
      visibleHistoryList.forEach((item, index) => {
        const dateObj = new Date(item.timestamp);
        const timeShortStr = formatTime24h(dateObj);
        let defaultName = '';
        if (isEn) {
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const m = monthNames[dateObj.getMonth()];
          const d = dateObj.getDate();
          defaultName = `${timeShortStr} | ${m} ${d}`;
        } else {
          const m = String(dateObj.getMonth() + 1).padStart(2, '0');
          const d = String(dateObj.getDate()).padStart(2, '0');
          defaultName = `${timeShortStr} | ${m}月${d}日`;
        }
        const displayName = item.name || defaultName;
        const zoomPercent = formatAnchorZoomPercent(item.zoom);
        
        html += `
          <div class="anchor-slot-row history-item-card" data-index="${index}">
            <div class="anchor-slot-header">
              <span class="anchor-slot-name" title="${displayName}">${displayName}</span>
              <div class="anchor-slot-actions">
                <button class="anchor-slot-btn pin-btn${isCardFullscreen ? ' is-disabled' : ''}" data-index="${index}" title="${isEn ? 'Pin to slot' : '固定到槽位'}"${isCardFullscreen ? ' disabled' : ''}>
                  <i class="fas fa-thumbtack"></i>
                </button>
                <button class="anchor-slot-btn delete-btn" data-index="${index}" title="${isEn ? 'Delete record' : '删除记录'}">
                  <i class="fas fa-trash-alt"></i>
                </button>
                <button class="anchor-slot-btn locate-btn" data-index="${index}" title="${isEn ? 'Locate viewport' : '定位到此视口'}">
                  <i class="fas fa-crosshairs"></i>
                </button>
              </div>
            </div>
            <div class="anchor-slot-info">
              X: ${Math.round(item.x)} | Y: ${Math.round(item.y)} | ${zoomPercent}
            </div>
          </div>
        `;
      });
    }
    
    const hasMore = currentHistoryList.length > visibleHistoryList.length;
    const canCollapse = autoRecordVisibleLimit > step;
    if (hasMore || canCollapse) {
      const remaining = currentHistoryList.length - visibleHistoryList.length;
      const willLoad = Math.min(step, remaining);
      
      html += `
        <div class="lazy-load-container" style="display: flex; gap: 8px; margin: 8px 8px 4px 8px; justify-content: center;">
      `;
      if (hasMore) {
        html += `
          <button class="lazy-load-btn load-more-btn" id="autoRecordLoadMoreBtn" style="flex: 1;">
            <i class="fas fa-chevron-down"></i> ${isEn ? `Show More (+${willLoad})` : `展开更多 (+${willLoad})`}
          </button>
        `;
      }
      if (canCollapse) {
        html += `
          <button class="lazy-load-btn collapse-btn" id="autoRecordCollapseBtn" style="flex: 1;">
            <i class="fas fa-chevron-up"></i> ${isEn ? 'Collapse' : '收起'}
          </button>
        `;
      }
      html += `</div>`;
    }
    
    html += `
        </div>
    `;
    
    html += `
      </div>
    `;
    
    panel.innerHTML = html;

    const newSlotsList = panel.querySelector('.anchor-slots-container');
    const newHistoryListEl = panel.querySelector('.history-items-container');
    if (newSlotsList) {
      if (highlightSlotIndex !== null) {
        const targetEl = panel.querySelector(`.anchor-slots-container .anchor-slot-row[data-index="${highlightSlotIndex}"]`);
        if (targetEl) {
          targetEl.classList.add('slot-highlight-flash');
          setTimeout(() => {
            targetEl.classList.remove('slot-highlight-flash');
          }, 2200);
          
          const containerRect = newSlotsList.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const offsetTop = targetRect.top - containerRect.top + slotsScrollTop;
          newSlotsList.scrollTop = slotsScrollTop;
          newSlotsList.scrollTo({ top: offsetTop, behavior: 'smooth' });
        } else {
          newSlotsList.scrollTop = slotsScrollTop;
        }
        highlightSlotIndex = null;
      } else {
        newSlotsList.scrollTop = slotsScrollTop;
      }
    }
    if (newHistoryListEl) newHistoryListEl.scrollTop = historyScrollTop;

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
    
    const addBtn = panel.querySelector('#addManualAnchorBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (isCanvasNodeFullscreenActive()) {
          showAnchorMutationBlockedToast(isEn);
          return;
        }
        const emptyIndex = slots.indexOf(null);
        if (emptyIndex !== -1) {
          const nonNullCount = slots.slice(0, emptyIndex).filter(s => s !== null).length + 1;
          if (manualAnchorVisibleLimit < nonNullCount) {
            manualAnchorVisibleLimit = nonNullCount;
            try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
          }
          highlightSlotIndex = emptyIndex;
          handleSlotAction('save', emptyIndex);
        } else {
          const msg = isEn 
            ? 'Pinned anchors are full. You can increase the maximum capacity in settings.' 
            : '固定锚点已满。您可以在右侧设置中增加最大记录上限。';
          if (typeof global.showToast === 'function') {
            global.showToast(msg);
          } else {
            alert(msg);
          }
        }
      });
    }

    const manualLoadMoreBtn = panel.querySelector('#manualAnchorLoadMoreBtn');
    if (manualLoadMoreBtn) {
      manualLoadMoreBtn.addEventListener('click', () => {
        const step = getDynamicStep();
        manualAnchorVisibleLimit += step;
        try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
        renderHistoryPanel();
      });
    }

    const manualCollapseBtn = panel.querySelector('#manualAnchorCollapseBtn');
    if (manualCollapseBtn) {
      manualCollapseBtn.addEventListener('click', () => {
        const step = getDynamicStep();
        manualAnchorVisibleLimit = step;
        try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
        renderHistoryPanel();
      });
    }

    const loadMoreBtn = panel.querySelector('#autoRecordLoadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        const step = getDynamicStep();
        autoRecordVisibleLimit += step;
        try { localStorage.setItem('canvas-auto-record-visible-limit', autoRecordVisibleLimit); } catch (_) {}
        renderHistoryPanel();
      });
    }

    const collapseBtn = panel.querySelector('#autoRecordCollapseBtn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        const step = getDynamicStep();
        autoRecordVisibleLimit = step;
        try { localStorage.setItem('canvas-auto-record-visible-limit', autoRecordVisibleLimit); } catch (_) {}
        renderHistoryPanel();
      });
    }

    panel.querySelectorAll('.anchor-slots-container .anchor-slot-btn').forEach(btn => {
      const index = parseInt(btn.dataset.index, 10);
      const action = btn.classList.contains('locate-btn') ? 'locate' :
                     btn.classList.contains('save-btn') ? 'save' :
                     btn.classList.contains('rename-btn') ? 'rename' :
                     btn.classList.contains('delete-btn') ? 'delete' : null;
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSlotAction(action, index, btn);
      });
    });
    
    const settingsBtn = panel.querySelector('#autoRecordSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (autoRecordSettingsOpen) {
          saveAutoRecordSettingsOnCollapse();
          autoRecordSettingsOpen = false;
          renderHistoryPanel();
        } else {
          autoRecordSettingsOpen = true;
          const inlinePanel = panel.querySelector('#autoRecordInlineSettings');
          if (inlinePanel) {
            inlinePanel.style.display = '';
          }
        }
      });
    }

    const manualSettingsBtn = panel.querySelector('#manualAnchorSettingsBtn');
    if (manualSettingsBtn) {
      manualSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (manualAnchorSettingsOpen) {
          saveManualSettingsOnCollapse();
          manualAnchorSettingsOpen = false;
          renderHistoryPanel();
        } else {
          manualAnchorSettingsOpen = true;
          const inlinePanel = panel.querySelector('#manualAnchorInlineSettings');
          if (inlinePanel) {
            inlinePanel.style.display = '';
          }
        }
      });
    }
    
    const manualLimitInput = panel.querySelector('#inlineManualAnchorLimitInput');
    if (manualLimitInput) {
      manualLimitInput.addEventListener('change', () => {
        const rawVal = manualLimitInput.value.trim();
        let val = 5; // default
        if (/^[1-9]\d*$/.test(rawVal)) {
          const parsed = parseInt(rawVal, 10);
          val = Math.max(1, Math.min(50, parsed));
        }
        manualLimitInput.value = val;
        
        const currentSettings = getCanvasOtherSettingsSafe();
        currentSettings.manualAnchorLimit = val;
        saveCanvasOtherSettingsInline(currentSettings);
        
        let slots = loadAnchorSlots();
        saveAnchorSlots(slots);
        renderHistoryPanel();
      });
    }
    
    const inlineCheck = panel.querySelector('#inlineAutoRecordCheck');
    const intervalInput = panel.querySelector('#inlineAutoRecordIntervalInput');
    const limitInput = panel.querySelector('#inlineAutoRecordLimitInput');
    
    if (inlineCheck) {
      inlineCheck.addEventListener('change', () => {
        if (inlineCheck.checked && isCanvasNodeFullscreenActive()) {
          inlineCheck.checked = false;
          showAnchorMutationBlockedToast(isEn);
          return;
        }
        const checked = inlineCheck.checked;
        const currentSettings = getCanvasOtherSettingsSafe();
        currentSettings.autoRecordAnchor = checked;
        saveCanvasOtherSettingsInline(currentSettings);
        renderHistoryPanel();
      });
    }
    
    if (intervalInput) {
      intervalInput.addEventListener('change', () => {
        const rawVal = intervalInput.value.trim();
        let val = 15; // default
        if (/^[1-9]\d*$/.test(rawVal)) {
          const parsed = parseInt(rawVal, 10);
          val = Math.max(1, Math.min(60, parsed));
        }
        intervalInput.value = val;
        
        const currentSettings = getCanvasOtherSettingsSafe();
        currentSettings.autoRecordAnchorInterval = val;
        saveCanvasOtherSettingsInline(currentSettings);
      });
    }
    
    if (limitInput) {
      limitInput.addEventListener('change', () => {
        const rawVal = limitInput.value.trim();
        let val = 5; // default
        if (/^[1-9]\d*$/.test(rawVal)) {
          const parsed = parseInt(rawVal, 10);
          val = Math.max(1, Math.min(50, parsed));
        }
        limitInput.value = val;
        
        const currentSettings = getCanvasOtherSettingsSafe();
        currentSettings.autoRecordAnchorLimit = val;
        saveCanvasOtherSettingsInline(currentSettings);
        
        let currentHistoryList = [];
        try {
          const raw = localStorage.getItem('canvasNavigationHistory');
          if (raw) currentHistoryList = JSON.parse(raw);
        } catch (_) {}
        if (Array.isArray(currentHistoryList) && currentHistoryList.length > val) {
          currentHistoryList = currentHistoryList.slice(0, val);
          localStorage.setItem('canvasNavigationHistory', JSON.stringify(currentHistoryList));
        }
        renderHistoryPanel();
      });
    }
    
    const clearBtn = panel.querySelector('#historyClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        localStorage.removeItem('canvasNavigationHistory');
        renderHistoryPanel();
      });
    }
    
    const historyCards = panel.querySelectorAll('.history-items-container .history-item-card');
    historyCards.forEach(card => {
      const index = parseInt(card.dataset.index, 10);
      const item = historyList[index];
      if (!item) return;
      
      card.addEventListener('click', (e) => {
        if (e.target.closest('.anchor-slot-btn')) return;

        navigateToViewportFromAnchor(item).then(() => {
          setTimeout(renderHistoryPanel, 50);
        });
      });
      
      const locateBtn = card.querySelector('.locate-btn');
      if (locateBtn) {
        locateBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigateToViewportFromAnchor(item).then(() => {
            setTimeout(renderHistoryPanel, 50);
          });
        });
      }
      
      const pinBtn = card.querySelector('.pin-btn');
      if (pinBtn) {
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isCanvasNodeFullscreenActive()) {
            showAnchorMutationBlockedToast(isEn);
            return;
          }
          const slots = loadAnchorSlots();
          
          // Check for duplicate coords (x, y, zoom)
          const duplicate = slots.find(slot => 
            slot && 
            Math.round(slot.x) === Math.round(item.x) && 
            Math.round(slot.y) === Math.round(item.y) && 
            slot.zoom === item.zoom
          );
          
          if (duplicate) {
            const msg = isEn 
              ? `Already exists as pinned anchor: "${duplicate.name}"` 
              : `已存在于固定锚点中，名称为：“${duplicate.name}”`;
            if (typeof global.showToast === 'function') {
              global.showToast(msg);
            } else {
              alert(msg);
            }
            return;
          }
          
          const emptyIndex = slots.indexOf(null);
          if (emptyIndex === -1) {
            const msg = isEn 
              ? 'Pinned anchors are full. Please increase capacity in settings or delete one.' 
              : '固定锚点已满。请在设置中增加最大记录数量，或者清除已有锚点。';
            if (typeof global.showToast === 'function') {
              global.showToast(msg);
            } else {
              alert(msg);
            }
            return;
          }
          
          const dateObj = new Date(item.timestamp);
          const timeShortStr = formatTime24h(dateObj);
          let defaultName = '';
          if (isEn) {
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const m = monthNames[dateObj.getMonth()];
            const d = dateObj.getDate();
            defaultName = `${timeShortStr} | ${m} ${d}`;
          } else {
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            defaultName = `${timeShortStr} | ${m}月${d}日`;
          }
          const displayName = item.name || defaultName;
          
          const nonNullCount = slots.slice(0, emptyIndex).filter(s => s !== null).length + 1;
          if (manualAnchorVisibleLimit < nonNullCount) {
            manualAnchorVisibleLimit = nonNullCount;
            try { localStorage.setItem('canvas-manual-anchor-visible-limit', manualAnchorVisibleLimit); } catch (_) {}
          }

          highlightSlotIndex = emptyIndex;

          slots[emptyIndex] = {
            name: displayName,
            x: item.x,
            y: item.y,
            zoom: item.zoom,
            timestamp: Date.now()
          };
          
          // Automatically remove from Auto-Recorded list
          historyList.splice(index, 1);
          localStorage.setItem('canvasNavigationHistory', JSON.stringify(historyList));
          
          saveAnchorSlots(slots);
          renderHistoryPanel();
          
          if (typeof global.showToast === 'function') {
            global.showToast(isEn ? 'Pinned to slots' : '已成功固定到槽位');
          }
        });
      }
      
      const deleteBtn = card.querySelector('.delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          historyList.splice(index, 1);
          localStorage.setItem('canvasNavigationHistory', JSON.stringify(historyList));
          renderHistoryPanel();
        });
      }
    });
  }

  function setupSidebarTabs() {
    const tabDir = document.getElementById('sidebarTabDirectory');
    const tabHist = document.getElementById('sidebarTabAnchor');
    const panelDir = document.getElementById('canvasDirectoryTree');
    const panelHist = document.getElementById('canvasHistoryPanel');
    
    if (!tabDir || !tabHist || !panelDir || !panelHist) return;
    
    const isEn = isEnglish();
    tabDir.innerText = isEn ? 'Directory' : '目录';
    tabHist.innerText = isEn ? 'Anchors' : '锚点';
    
    const navTabs = panelHist.closest('.nav-tabs');

    tabDir.addEventListener('click', () => {
      tabDir.classList.add('active');
      tabHist.classList.remove('active');
      panelDir.style.display = '';
      panelHist.style.display = 'none';
      if (navTabs) navTabs.classList.remove('history-tab-active');
      localStorage.setItem('canvasSidebarActiveTab', 'directory');
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

    try { setupSidebarTabs(); } catch (_) {}

    refreshTimer = global.setInterval(() => {
      ensureCanvasObserver();
      queueRefresh();
    }, REFRESH_INTERVAL_MS);

    global.addEventListener('storage', (event) => {
      const isFolderStateChange = !event || event.key === FOLDER_OPEN_STATES_KEY;
      queueRefresh({
        force: true,
        preferStoredFolderStates: isFolderStateChange
      });
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-navigation-history-updated', () => {
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-other-settings-updated', () => {
      try { renderHistoryPanel(); } catch (_) {}
    });

    global.addEventListener('canvas-maximized-state-change', () => {
      try { renderHistoryPanel(); } catch (_) {}
    });

    document.addEventListener('click', (e) => {
      const manualPanel = document.getElementById('manualAnchorInlineSettings');
      const manualBtn = document.getElementById('manualAnchorSettingsBtn');
      const autoPanel = document.getElementById('autoRecordInlineSettings');
      const autoBtn = document.getElementById('autoRecordSettingsBtn');

      let changed = false;

      // Click outside manual settings panel & button collapses manual panel
      if (manualAnchorSettingsOpen && manualPanel && manualBtn) {
        if (!manualPanel.contains(e.target) && !manualBtn.contains(e.target)) {
          saveManualSettingsOnCollapse();
          manualAnchorSettingsOpen = false;
          changed = true;
        }
      }

      // Click outside auto-record settings panel & button collapses auto-record panel
      if (autoRecordSettingsOpen && autoPanel && autoBtn) {
        if (!autoPanel.contains(e.target) && !autoBtn.contains(e.target)) {
          saveAutoRecordSettingsOnCollapse();
          autoRecordSettingsOpen = false;
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
    }
  };
})(window);
