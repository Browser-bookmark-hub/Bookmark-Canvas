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
    if (key === 'folder-card-groups' || key === 'folder-permanent' || key === 'folder-temporary') {
      return true;
    }
    return false;
  }

  const SPECIAL_TEMP_SOURCE_SET = new Set(['browser-drop', 'search-result', 'batch', 'quick-add', 'file-import', 'import-html-bookmarks', 'import-json-bookmarks']);
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
    if (explicit) return explicit;
    const seq = toPositiveInt(section.sequenceNumber);
    if (!seq) return '';
    const alpha = toAlphaLabel(seq);
    return alpha ? `${alpha}-1` : '';
  }

  function getTempSplitDepth(label) {
    const normalized = normalizeText(label);
    if (!normalized) return 0;
    const parts = normalized.split('-').map(part => part.trim()).filter(Boolean);
    if (parts.length <= 2) return 0;
    return Math.max(0, parts.length - 2);
  }

  function getTempParentLabel(label) {
    const normalized = normalizeText(label);
    if (!normalized) return '';
    const dashIndex = normalized.lastIndexOf('-');
    if (dashIndex > 0) return normalized.slice(0, dashIndex);

    const legacy = normalized.match(/^([A-Za-z]+)\d+$/);
    if (legacy) return String(legacy[1] || '').toUpperCase();
    return '';
  }

  function isSpecialTempSection(section) {
    if (!section) return false;
    const tempKindRaw = normalizeText(section.tempKind).toLowerCase();
    if (tempKindRaw === 'special') return true;
    if (tempKindRaw === 'regular') return false;

    const sourceRaw = normalizeText(section.source).toLowerCase();
    if (sourceRaw && SPECIAL_TEMP_SOURCE_SET.has(sourceRaw)) return true;

    const seq = toPositiveInt(section.sequenceNumber);
    if (!seq) return true;

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

  function getMdNodeTitle(node) {
    if (!node) return '--';
    if (node.type === 'file') {
      const fileName = String(node.file || '').split('/').pop();
      if (fileName) return fileName;
    }
    const mainText = (typeof node.title === 'string' && node.title.trim()) ? node.title.trim() : (node.markdownSource || node.text || node.html || '');
    const bySourceLine = normalizeMdNodeTitleLine(getFirstLineText(mainText));
    if (bySourceLine) return bySourceLine;
    return '--';
  }

  function sortTempSections(a, b) {
    const as = toPositiveInt(a && a.sequenceNumber);
    const bs = toPositiveInt(b && b.sequenceNumber);
    if (as && bs && as !== bs) return as - bs;
    if (as && !bs) return -1;
    if (!as && bs) return 1;
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

  function buildSplitChainNodes(splitTempSections, options = {}) {
    const resolveColor = typeof options.resolveColor === 'function'
      ? options.resolveColor
      : (() => options.fallbackColor || '');
    const defaultColor = options.defaultColor || options.fallbackColor || '';
    const keyPrefix = (typeof options.keyPrefix === 'string' && options.keyPrefix)
      ? options.keyPrefix
      : 'temp-split-';
    const entries = (Array.isArray(splitTempSections) ? splitTempSections : []).map((section) => ({
      section,
      label: getTempSectionLabel(section),
      children: []
    }));

    const entryByLabel = new Map();
    entries.forEach((entry) => {
      const key = normalizeText(entry.label);
      if (!key || entryByLabel.has(key)) return;
      entryByLabel.set(key, entry);
    });

    const roots = [];
    entries.forEach((entry) => {
      const parentLabel = getTempParentLabel(entry.label);
      const parentEntry = parentLabel ? entryByLabel.get(parentLabel) : null;
      if (parentEntry && parentEntry !== entry) {
        parentEntry.children.push(entry);
        return;
      }
      roots.push(entry);
    });

    const toNode = (entry) => {
      const section = entry.section;
      const target = { kind: 'temp-section', sectionId: section.id };
      const preview = getTempSectionDescription(section);
      const title = getTempSectionDisplayText(section);
      const key = `${keyPrefix}${section.id}`;

      if (entry.children.length) {
        return makeFolderNode({
          key,
          code: '',
          title,
          color: resolveColor(section),
          defaultColor,
          icon: 'fas fa-code-branch',
          variant: 'chain',
          showIcon: false,
          showFoldControl: true,
          showDeleteControl: true,
          deleteAction: {
            kind: 'temp-section',
            sectionId: section.id,
            scopeOptions: true
          },
          target,
          preview,
          children: foldExtraNodes(entry.children.map(toNode), `${key}-children`)
        });
      }

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
    };

    const rootNodes = roots.map(toNode);
    return foldExtraNodes(rootNodes, `${keyPrefix}root`);
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

  function foldExtraNodes(nodes, parentKey) {
    if (!Array.isArray(nodes) || nodes.length <= 5) return nodes;
    const result = nodes.slice(0, 5);
    const remaining = nodes.slice(5);
    result.push(makeFolderNode({
      key: `${parentKey}-more`,
      code: '',
      title: t('展开更多', 'Expand more'),
      icon: 'fas fa-chevron-down',
      showIcon: true,
      showFoldControl: true,
      open: false,
      count: remaining.length,
      children: remaining
    }));
    return result;
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

      const specialRootLabelSet = new Set();
      const specialTempSections = [];
      const splitTempSections = [];

      const isSpecialLineageSection = (section) => {
        const label = getTempSectionLabel(section);
        if (!label) return false;
        let parentLabel = getTempParentLabel(label);
        while (parentLabel) {
          if (specialRootLabelSet.has(parentLabel)) return true;
          parentLabel = getTempParentLabel(parentLabel);
        }
        return false;
      };

      sections.forEach((section) => {
        if (!section || !isSpecialTempSection(section)) return;
        specialTempSections.push(section);
        const label = normalizeText(getTempSectionLabel(section));
        if (label) specialRootLabelSet.add(label);
      });

      sections.forEach((section) => {
        if (!section || isSpecialTempSection(section)) return;
        if (isSpecialLineageSection(section)) {
          specialTempSections.push(section);
        } else {
          splitTempSections.push(section);
        }
      });

      splitTempSections.sort(sortTempSections);
      specialTempSections.sort(sortTempSections);

      const splitItems = buildSplitChainNodes(splitTempSections, {
        resolveColor: sectionColorResolver,
        fallbackColor: splitColor,
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

      const specialItems = buildSplitChainNodes(specialTempSections, {
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
            target: { kind: 'md-node', nodeId: node.id },
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

    const getFileIconClass = (filePath) => {
      const ext = String(filePath || '').split('.').pop().toLowerCase();
      switch (ext) {
        case 'mp4': case 'webm': case 'ogg': case 'mov': case 'avi': case 'flv': case 'mkv':
          return 'fas fa-file-video';
        case 'mp3': case 'wav': case 'flac': case 'aac': case 'm4a': case 'wma':
          return 'fas fa-file-audio';
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp': case 'ico':
          return 'fas fa-file-image';
        case 'pdf':
          return 'fas fa-file-pdf';
        case 'zip': case 'rar': case '7z': case 'tar': case 'gz':
          return 'fas fa-file-archive';
        case 'md': case 'txt': case 'json': case 'js': case 'css': case 'html':
          return 'fas fa-file-alt';
        default:
          return 'fas fa-file';
      }
    };

    const buildUnsupportedFilesFolder = (nodes, config = {}) => {
      const keyPrefix = config.itemKeyPrefix || '';
      const nodeColorResolver = (typeof config.nodeColorResolver === 'function')
        ? config.nodeColorResolver
        : resolveMdNodeColor;
      const folderColor = config.folderColor || colorTokens.blank;
      const defaultColor = config.defaultColor || folderColor;
      const folderIcon = config.folderIcon || 'fas fa-folder-open';
      
      const sortedNodes = [...nodes].sort((a, b) => {
        const titleA = getMdNodeTitle(a);
        const titleB = getMdNodeTitle(b);
        const cmp = compareText(titleA, titleB);
        if (cmp !== 0) return cmp;
        return compareText(a && a.id, b && b.id);
      });

      const buildItems = (list) => {
        return list.map((node, index) => {
          const title = getMdNodeTitle(node);
          const icon = getFileIconClass(node.file);
          return makeItemNode({
            key: `${keyPrefix}unsupported-file-${node.id}`,
            code: '',
            title: `${index + 1}. ${clampCardTitle(title, 30)}`,
            color: nodeColorResolver(node),
            defaultColor,
            icon: icon,
            showIcon: true,
            variant: 'unsupported-file-item',
            showDeleteControl: true,
            deleteAction: {
              kind: 'md-node',
              nodeId: node.id,
              scopeOptions: false
            },
            target: { kind: 'md-node', nodeId: node.id },
            preview: node.file || ''
          });
        });
      };

      const directItems = buildItems(sortedNodes);

      return makeFolderNode({
        key: config.folderKey || 'folder-unsupported-files',
        code: '',
        title: config.title || t('其他', 'Other'),
        color: folderColor,
        defaultColor,
        icon: folderIcon,
        open: config.open !== false,
        count: sortedNodes.length,
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
            target: { kind: 'edge', edgeId, fromNode, toNode },
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

    const regularMdNodes = mdNodes.filter(node => node && node.subtype !== 'card-group' && node.type !== 'file');

    const unsupportedFileNodes = mdNodes.filter(node => node && node.type === 'file');

    const regularEdges = edges.slice();

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
        target: { kind: 'permanent-main' },
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
        target: { kind: 'permanent-copy', copyId },
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

    const unsupportedFilesFolder = unsupportedFileNodes.length > 0 ? buildUnsupportedFilesFolder(unsupportedFileNodes, {
      folderKey: 'folder-unsupported-files',
      count: unsupportedFileNodes.length,
      emptyKey: 'unsupported-files-empty',
      open: false
    }) : null;

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
          const x = Number(mainShell.cardState.left);
          const y = Number(mainShell.cardState.top);
          const w = Number(mainShell.cardState.width);
          const h = Number(mainShell.cardState.height);
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
          target: { kind: 'permanent-main' },
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
          target: { kind: 'permanent-copy', copyId },
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
      const nonGroupMdNodes = geo.mdNodes.filter((n) => n && n.subtype !== 'card-group' && n.type !== 'file');
      const groupUnsupportedFileNodes = geo.mdNodes.filter((n) => n && n.type === 'file');
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
            target: { kind: 'md-node', nodeId: n.id },
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
            target: { kind: 'edge', edgeId, fromNode, toNode },
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

      // 7. Other files (folded under "Other" below Edges)
      if (groupUnsupportedFileNodes.length > 0) {
        const sortedGroupUnsupportedNodes = [...groupUnsupportedFileNodes].sort((a, b) => {
          const titleA = getMdNodeTitle(a);
          const titleB = getMdNodeTitle(b);
          const cmp = compareText(titleA, titleB);
          if (cmp !== 0) return cmp;
          return compareText(a && a.id, b && b.id);
        });
        const groupUnsupportedItems = sortedGroupUnsupportedNodes.map((n, idx) => {
          const nodeColor = resolveMdNodeColor(n);
          const icon = getFileIconClass(n.file);
          return makeItemNode({
            key: `group-${parentSafeId}-unsupported-file-${n.id}`,
            code: '',
            title: `${idx + 1}. ${clampCardTitle(getMdNodeTitle(n), 30)}`,
            color: nodeColor,
            defaultColor: nodeColor,
            icon: icon,
            showIcon: true,
            variant: 'unsupported-file-item',
            showDeleteControl: true,
            deleteAction: {
              kind: 'md-node',
              nodeId: n.id,
              scopeOptions: false
            },
            target: { kind: 'md-node', nodeId: n.id },
            preview: n.file || ''
          });
        });
        otherChildren.push(makeFolderNode({
          key: `group-${parentSafeId}-subfolder-unsupported-files`,
          code: '',
          title: t('其他', 'Other'),
          icon: 'fas fa-folder-open',
          count: sortedGroupUnsupportedNodes.length,
          showFoldControl: true,
          open: false,
          children: groupUnsupportedItems
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
        target: { kind: 'md-node', nodeId: safeId },
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
    if (unsupportedFilesFolder) {
      nodes.push(unsupportedFilesFolder);
    }
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

    // If the element is already highlighted, clear its previous timeout first
    if (element.dataset.locateHighlightTimeoutId) {
      global.clearTimeout(parseInt(element.dataset.locateHighlightTimeoutId, 10));
    } else {
      // Save original zIndex if not already saved
      element.dataset.originalZIndex = element.style.zIndex || '';
    }

    element.style.zIndex = '99999';
    element.classList.add(highlightClass);

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
    }, 1250);

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

    if (module && typeof module.locateMdNode === 'function') {
      try {
        module.locateMdNode(id, zoom);
        highlightLocatedElement(document.getElementById(id));
        return true;
      } catch (_) { }
    }

    const target = document.getElementById(id);
    if (target) {
      return locateElement(module, target, zoom);
    }

    return false;
  }

  function highlightEdge(edgeId) {
    const id = normalizeText(edgeId);
    if (!id) return;
    const escaped = escapeSelector(id);
    if (!escaped) return;

    const targets = document.querySelectorAll(`[data-edge-id=\"${escaped}\"]`);
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
        locatePermanentMain(module, zoom);
        break;
      case 'permanent-copy':
        locatePermanentCopy(module, target.copyId, zoom);
        break;
      case 'temp-section':
        if (module && typeof module.locateSection === 'function') {
          try {
            module.locateSection(target.sectionId, zoom);
            highlightLocatedElement(document.getElementById(target.sectionId));
            return;
          } catch (_) { }
        }
        locateByNodeId(module, target.sectionId, zoom);
        break;
      case 'md-node':
        locateByNodeId(module, target.nodeId, zoom);
        break;
      case 'edge':
        highlightEdge(target.edgeId);
        if (locateByNodeId(module, target.fromNode, zoom)) return;
        locateByNodeId(module, target.toNode, zoom);
        break;
      default:
        break;
    }
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
        return document.getElementById(nodeId);
      }
      default:
        return null;
    }
  }

  function switchFullscreenNodeByDirectoryTarget(target) {
    const currentMaximized = document.querySelector('.canvas-node-maximized');
    if (!currentMaximized) return false;

    const nextTarget = resolveTargetElementForFullscreenSwitch(target);
    if (!nextTarget) return false;
    if (nextTarget === currentMaximized) return true;

    const isCanvasNode = nextTarget.classList
      && (nextTarget.classList.contains('permanent-bookmark-section')
        || nextTarget.classList.contains('temp-canvas-node')
        || nextTarget.classList.contains('md-canvas-node'));
    if (!isCanvasNode) return false;

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

  function collectTempSectionDeleteIds(sectionId, includeDescendants = false) {
    const normalizedId = normalizeText(sectionId);
    if (!normalizedId) return [];

    const state = getCanvasState();
    const sections = Array.isArray(state && state.tempSections)
      ? state.tempSections.filter(Boolean)
      : [];

    if (!sections.length) return [normalizedId];

    const sectionById = new Map();
    const labelById = new Map();
    sections.forEach((section) => {
      const id = normalizeText(section && section.id);
      if (!id) return;
      sectionById.set(id, section);
      labelById.set(id, normalizeText(getTempSectionLabel(section)));
    });

    const target = sectionById.get(normalizedId);
    if (!target) return [normalizedId];

    const targetLabel = labelById.get(normalizedId) || '';
    const ids = new Set([normalizedId]);

    if (includeDescendants && targetLabel) {
      const prefix = `${targetLabel}-`;
      labelById.forEach((label, id) => {
        if (!label) return;
        if (label === targetLabel || label.startsWith(prefix)) {
          ids.add(id);
        }
      });
    }

    return Array.from(ids).sort((a, b) => {
      const la = labelById.get(a) || '';
      const lb = labelById.get(b) || '';
      if (la.length !== lb.length) return lb.length - la.length;
      return compareText(a, b);
    });
  }

  function runDeleteTempSectionAction(action, mode = 'confirm') {
    if (!action || action.kind !== 'temp-section') return false;
    const sectionId = normalizeText(action.sectionId);
    if (!sectionId || typeof global.removeTempNode !== 'function') return false;

    const includeDescendants = !!(action.scopeOptions && mode === 'all');
    const ids = collectTempSectionDeleteIds(sectionId, includeDescendants);
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
            locateByNodeId(module, target.nodeId, 'fit');
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
    const openFolderKeys = collectOpenFolderKeys(root);
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
      queueRefresh({ force: pendingForceRefresh });
    }, REFRESH_DEFER_MS);
  }

  function queueRefresh(options = {}) {
    if (options.force) pendingForceRefresh = true;
    if (lastFingerprint && isCanvasInteractionActiveForDirectory()) {
      scheduleDeferredRefresh();
      return;
    }
    if (refreshRaf) return;
    refreshRaf = global.requestAnimationFrame(() => {
      refreshRaf = null;
      const force = pendingForceRefresh;
      pendingForceRefresh = false;
      if (lastFingerprint && isCanvasInteractionActiveForDirectory()) {
        if (force) pendingForceRefresh = true;
        scheduleDeferredRefresh();
        return;
      }
      refreshDirectory({ force });
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

  function init() {
    if (initialized) {
      queueRefresh({ force: true });
      return;
    }

    initialized = true;
    ensureCanvasObserver();
    queueRefresh({ force: true });
    global.addEventListener('pointerdown', handleGlobalPointerDown, true);

    refreshTimer = global.setInterval(() => {
      ensureCanvasObserver();
      queueRefresh();
    }, REFRESH_INTERVAL_MS);

    global.addEventListener('storage', () => {
      queueRefresh({ force: true });
    });
  }

  function refresh(options = {}) {
    queueRefresh({ force: !!(options && options.force) });
  }

  global.CanvasSidebarDirectory = {
    init,
    refresh,
    renderPreviewDirectory,
    getMdNodeTitle,
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
