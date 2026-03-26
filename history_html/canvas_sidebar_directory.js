(function setupCanvasSidebarDirectory(global) {
  'use strict';

  const ROOT_ID = 'canvasDirectoryTree';
  const CANVAS_CONTENT_ID = 'canvasContent';
  const REFRESH_INTERVAL_MS = 1200;
  const PREVIEW_LIMIT = 260;
  const BCS_CANVAS_KEY = 'bcs:canvas';
  const PERMANENT_COPIES_STORAGE_KEY = 'bcs:perm:copies';
  const PERMANENT_MAIN_TIP_STORAGE_KEY = 'bcs:perm:tip-main';
  const PERMANENT_COPY_TIP_STORAGE_PREFIX = 'bcs:perm:tip-copy-';
  const SPECIAL_TEMP_SOURCE_SET = new Set(['browser-drop', 'search-result', 'batch', 'quick-add', 'file-import', 'import-html-bookmarks', 'import-json-bookmarks']);
  const DIRECTORY_COLOR_DEFAULTS = Object.freeze({
    permanent: '#10b981',
    temp: '#2563eb',
    specialTemp: '#e9973f',
    blank: '#888888',
    edge: '#999999'
  });
  const DIRECTORY_LOCATABLE_NEUTRAL_COLOR = '#888888';
  const IMPORT_DIRECTORY_NEUTRAL_COLOR = '#9aa0a6';

  let initialized = false;
  let refreshTimer = null;
  let refreshRaf = null;
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
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = text;
      return normalizeText(tmp.textContent || '');
    } catch (_) {
      return normalizeText(text.replace(/<[^>]*>/g, ' '));
    }
  }

  function toPreviewText(raw, limit = PREVIEW_LIMIT) {
    return clampText(stripHtml(raw), limit);
  }

  function getFirstLineText(raw) {
    const normalized = stripHtml(raw);
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

  function getMdNodeFirstLineFromDom(nodeId) {
    const normalizedId = normalizeText(nodeId);
    if (!normalizedId) return '';

    const nodeEl = document.getElementById(normalizedId);
    if (!nodeEl) return '';

    try {
      const liveTextEl = nodeEl.querySelector('.md-canvas-editor, .md-canvas-text');
      if (!liveTextEl) return '';
      return getFirstLineText(liveTextEl.innerText || liveTextEl.textContent || '');
    } catch (_) {
      return '';
    }
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

  function hasEnabledObsidianSync() {
    try {
      const syncApi = global.CanvasObsidianGitSync;
      if (!syncApi || typeof syncApi.getSettings !== 'function') return false;
      const settings = syncApi.getSettings();
      return !!(settings && settings.enabled);
    } catch (_) {
      return false;
    }
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

    root.style.setProperty('--canvas-dir-color-permanent', colors.permanent);
    root.style.setProperty('--canvas-dir-color-temp', colors.temp);
    root.style.setProperty('--canvas-dir-color-special-temp', colors.specialTemp);
    root.style.setProperty('--canvas-dir-color-blank', colors.blank);
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
    const sourceRaw = normalizeText(section.source).toLowerCase();
    if (sourceRaw && SPECIAL_TEMP_SOURCE_SET.has(sourceRaw)) return true;

    const labelRaw = normalizeText(section.label);
    if (!labelRaw) return false;
    if (labelRaw === '拖入' || labelRaw === '搜索' || labelRaw === '批量' || labelRaw === '添加' || labelRaw === '导入文件' || labelRaw === '导入') return true;

    const label = labelRaw.toLowerCase();
    return label === 'drop' || label === 'search' || label === 'batch' || label === 'add' || label === 'import file' || label === 'import';
  }

  function isImportedNodeId(value) {
    const id = normalizeText(value).toLowerCase();
    if (!id) return false;
    return id.startsWith('imported -') || id.startsWith('imported-');
  }

  function collectImportMembership(mdNodes) {
    const importContainers = [];
    const tempIds = new Set();
    const mdIds = new Set();

    (Array.isArray(mdNodes) ? mdNodes : []).forEach((node) => {
      if (!node || node.subtype !== 'import-container') return;
      importContainers.push(node);

      const containerId = normalizeText(node.id);
      if (containerId) mdIds.add(containerId);

      const memberTempIds = Array.isArray(node.containedTempIds) ? node.containedTempIds : [];
      memberTempIds.forEach((id) => {
        const normalized = normalizeText(id);
        if (normalized) tempIds.add(normalized);
      });

      const memberMdIds = Array.isArray(node.containedMdIds) ? node.containedMdIds : [];
      memberMdIds.forEach((id) => {
        const normalized = normalizeText(id);
        if (!normalized || normalized === containerId) return;
        mdIds.add(normalized);
      });
    });

    return { importContainers, tempIds, mdIds };
  }

  function isImportedTempSection(section, membership) {
    const sectionId = normalizeText(section && section.id);
    if (!sectionId) return false;
    if (membership && membership.tempIds && membership.tempIds.has(sectionId)) return true;
    if (section && section.isSnapshot) return true;

    const source = normalizeText(section && section.source).toLowerCase();
    if (source === 'file-import' || source === 'import-html-bookmarks' || source === 'import-json-bookmarks') return false;
    if (source.startsWith('import')) return true;

    return isImportedNodeId(sectionId);
  }

  function isImportedMdNode(node, membership) {
    if (!node) return false;
    if (node.subtype === 'import-container') return true;

    const nodeId = normalizeText(node.id);
    if (!nodeId) return false;
    if (membership && membership.mdIds && membership.mdIds.has(nodeId)) return true;

    return isImportedNodeId(nodeId);
  }

  function isImportedEdge(edge, importedNodeIds) {
    const edgeId = normalizeText(edge && edge.id);
    if (isImportedNodeId(edgeId)) return true;

    const fromNode = normalizeText(edge && edge.fromNode);
    const toNode = normalizeText(edge && edge.toNode);
    if (!fromNode || !toNode) return false;

    return importedNodeIds.has(fromNode) && importedNodeIds.has(toNode);
  }

  function getImportContainerName(node) {
    const byGroupLabel = normalizeText(node && node.groupLabel);
    if (byGroupLabel) return byGroupLabel;
    return getMdNodeTitle(node);
  }

  function collectImportedGroups(importMembership, importedTempSections, importedMdNodes, importedEdges) {
    const groups = [];
    const sectionToGroup = new Map();
    const mdToGroup = new Map();

    const importedTempList = Array.isArray(importedTempSections) ? importedTempSections : [];
    const importedMdList = Array.isArray(importedMdNodes) ? importedMdNodes : [];
    const importedEdgeList = Array.isArray(importedEdges) ? importedEdges : [];
    const containers = (importMembership && Array.isArray(importMembership.importContainers))
      ? importMembership.importContainers
      : [];

    const importedTempById = new Map();
    importedTempList.forEach((section) => {
      const id = normalizeText(section && section.id);
      if (id) importedTempById.set(id, section);
    });

    const importedMdById = new Map();
    importedMdList.forEach((node) => {
      const id = normalizeText(node && node.id);
      if (id) importedMdById.set(id, node);
    });

    const createGroup = (name, keySeed) => {
      const key = normalizeText(keySeed) || `import-group-${groups.length + 1}`;
      const group = {
        key,
        name: normalizeText(name) || `${t('导入区块', 'Imported')} ${groups.length + 1}`,
        containerId: '',
        tempSections: [],
        mdNodes: [],
        edges: []
      };
      groups.push(group);
      return group;
    };

    containers.forEach((container, index) => {
      const containerId = normalizeText(container && container.id);
      const name = getImportContainerName(container);
      const group = createGroup(name, containerId || `container-${index + 1}`);
      group.containerId = containerId;

      if (containerId && importedMdById.has(containerId)) {
        const node = importedMdById.get(containerId);
        if (node) {
          group.mdNodes.push(node);
          mdToGroup.set(containerId, group.key);
        }
      }

      const tempIds = Array.isArray(container && container.containedTempIds) ? container.containedTempIds : [];
      tempIds.forEach((id) => {
        const normalized = normalizeText(id);
        if (!normalized) return;
        const section = importedTempById.get(normalized);
        if (!section) return;
        if (!group.tempSections.some((item) => normalizeText(item && item.id) === normalized)) {
          group.tempSections.push(section);
        }
        sectionToGroup.set(normalized, group.key);
      });

      const mdIds = Array.isArray(container && container.containedMdIds) ? container.containedMdIds : [];
      mdIds.forEach((id) => {
        const normalized = normalizeText(id);
        if (!normalized || normalized === containerId) return;
        const node = importedMdById.get(normalized);
        if (!node) return;
        if (!group.mdNodes.some((item) => normalizeText(item && item.id) === normalized)) {
          group.mdNodes.push(node);
        }
        mdToGroup.set(normalized, group.key);
      });
    });

    importedTempList.forEach((section) => {
      const sectionId = normalizeText(section && section.id);
      if (!sectionId || sectionToGroup.has(sectionId)) return;
      const group = createGroup(getTempSectionTitle(section), sectionId);
      group.tempSections.push(section);
      sectionToGroup.set(sectionId, group.key);
    });

    importedMdList.forEach((node) => {
      const nodeId = normalizeText(node && node.id);
      if (!nodeId || mdToGroup.has(nodeId)) return;
      const group = createGroup(getMdNodeTitle(node), nodeId);
      group.mdNodes.push(node);
      mdToGroup.set(nodeId, group.key);
    });

    const groupByKey = new Map(groups.map((group) => [group.key, group]));
    importedEdgeList.forEach((edge) => {
      const fromNode = normalizeText(edge && edge.fromNode);
      const toNode = normalizeText(edge && edge.toNode);
      const fromGroupKey = sectionToGroup.get(fromNode) || mdToGroup.get(fromNode) || '';
      const toGroupKey = sectionToGroup.get(toNode) || mdToGroup.get(toNode) || '';
      if (!fromGroupKey || fromGroupKey !== toGroupKey) return;
      const group = groupByKey.get(fromGroupKey);
      if (group) group.edges.push(edge);
    });

    groups.forEach((group) => {
      group.tempSections.sort(sortTempSections);
      group.mdNodes.sort((a, b) => compareText(a && a.id, b && b.id));
      group.edges.sort((a, b) => compareText(a && a.id, b && b.id));
    });

    return groups;
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

  function getMdNodeTitle(node) {
    const byLiveText = normalizeMdNodeTitleLine(getMdNodeFirstLineFromDom(node && node.id));
    if (byLiveText) return byLiveText;

    const byText = normalizeMdNodeTitleLine(getFirstLineText(node && node.text));
    if (byText) return byText;

    const byHtml = normalizeMdNodeTitleLine(getFirstLineText(node && node.html));
    if (byHtml) return byHtml;

    return t('未命名空白栏目', 'Untitled blank node');
  }

  function sortTempSections(a, b) {
    const as = toPositiveInt(a && a.sequenceNumber);
    const bs = toPositiveInt(b && b.sequenceNumber);
    if (as && bs && as !== bs) return as - bs;
    if (as && !bs) return -1;
    if (!as && bs) return 1;
    const al = getTempSectionLabel(a);
    const bl = getTempSectionLabel(b);
    if (al && bl && al !== bl) return compareText(al, bl);
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
          children: entry.children.map(toNode)
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

    return roots.map(toNode);
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

  function buildDirectoryData(options = {}) {
    const state = (options && options.state && typeof options.state === 'object')
      ? options.state
      : getCanvasState();
    const tempSections = Array.isArray(state && state.tempSections) ? state.tempSections.filter(Boolean) : [];
    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes.filter(Boolean) : [];
    const edges = Array.isArray(state && state.edges) ? state.edges.filter(Boolean) : [];
    const copies = (options && Array.isArray(options.copies)) ? options.copies : readPermanentCopies();
    const importedOnly = !!(options && options.importedOnly);
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
      if (kind === 'md-node') return locatableThemeTokens.blank;
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

    const importNeutralColor = IMPORT_DIRECTORY_NEUTRAL_COLOR;
    const resolveImportedTempSectionColor = (section) => {
      if (!locatableColorSync) return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
      const live = normalizeHexColor(section && section.color, null);
      if (live) return live;
      if (section && section.isSnapshot) return locatableThemeTokens.permanent;
      return isSpecialTempSection(section) ? locatableThemeTokens.specialTemp : locatableThemeTokens.temp;
    };
    const resolveImportedMdNodeColor = (node) => {
      if (!locatableColorSync) return DIRECTORY_LOCATABLE_NEUTRAL_COLOR;
      const live = resolveNodeCustomColor(node);
      if (live) return live;
      return locatableThemeTokens.blank;
    };
    const resolveImportedEdgeColor = (edge) => {
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
        const at = toPositiveInt(a && a.createdAt);
        const bt = toPositiveInt(b && b.createdAt);
        if (at && bt && at !== bt) return at - bt;
        if (at && !bt) return -1;
        if (!at && bt) return 1;
        return compareText(a && a.id, b && b.id);
      });

      const isNativeCard = (node) => {
        if (!node) return false;
        const subtype = normalizeText(node && node.subtype).toLowerCase();
        const source = normalizeText(node && node.source).toLowerCase();
        return subtype === 'canvas-native-text' || source.startsWith('obsidian-canvas-');
      };

      const nativeCards = sortedMdNodes.filter((node) => isNativeCard(node));
      const pluginCards = sortedMdNodes.filter((node) => !isNativeCard(node));

      const buildBlankItems = (list, groupKey) => {
        const items = (Array.isArray(list) ? list : []).map((node, index) => makeItemNode({
          key: `${keyPrefix}blank-${groupKey}-${node.id}`,
          code: '',
          title: `${index + 1}. ${getMdNodeTitle(node)}`,
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
            scopeOptions: !!(node && node.subtype === 'import-container'),
            currentTitle: t('仅删除框体', 'Delete frame only'),
            allTitle: t('删除全部内容', 'Delete all content')
          },
          target: { kind: 'md-node', nodeId: node.id },
          preview: ''
        }));
        return items;
      };

      const showSyncSubfolders = hasEnabledObsidianSync();
      const directItems = buildBlankItems(sortedMdNodes, 'all');
      if (!showSyncSubfolders) {
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
      }

      const nativeItems = buildBlankItems(nativeCards, 'native');
      if (!nativeItems.length) {
        nativeItems.push(makePlaceholderItem(
          `${keyPrefix}blank-native-empty`,
          '',
          t('暂无 Obsidian 原生卡片', 'No Obsidian native cards'),
          {
            iconText,
            iconTone,
            variant,
            color: folderColor,
            defaultColor
          }
        ));
      }

      const pluginItems = buildBlankItems(pluginCards, 'plugin');
      if (!pluginItems.length) {
        pluginItems.push(makePlaceholderItem(
          `${keyPrefix}blank-plugin-empty`,
          '',
          t('暂无 插件空白卡片', 'No plugin blank cards'),
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
        children: [
          makeFolderNode({
            key: `${config.folderKey || 'folder-blank'}-native`,
            code: '',
            title: t('obsidian原生卡片', 'Obsidian native cards'),
            color: folderColor,
            defaultColor,
            icon: 'fas fa-pen',
            iconText,
            iconTone,
            variant,
            count: nativeCards.length,
            children: nativeItems
          }),
          makeFolderNode({
            key: `${config.folderKey || 'folder-blank'}-plugin`,
            code: '',
            title: t('插件空白卡片', 'Plugin blank cards'),
            color: folderColor,
            defaultColor,
            icon: 'fas fa-file-alt',
            iconText,
            iconTone,
            variant,
            count: pluginCards.length,
            children: pluginItems
          })
        ]
      });
    };

    const buildOtherFolder = (edgeList, titleLookup, config = {}) => {
      const keyPrefix = config.itemKeyPrefix || '';
      const edgeColorResolver = (typeof config.edgeColorResolver === 'function')
        ? config.edgeColorResolver
        : resolveEdgeColor;
      const folderColor = config.folderColor || colorTokens.edge;
      const defaultColor = config.defaultColor || folderColor;
      const folderIcon = config.folderIcon || 'fas fa-ellipsis-h';
      const edgesWithLabel = edgeList.filter((edge) => normalizeText(edge && edge.label));
      const edgeItems = edgesWithLabel.map((edge, index) => {
        const edgeId = normalizeText(edge && edge.id);
        const fromNode = normalizeText(edge && edge.fromNode);
        const toNode = normalizeText(edge && edge.toNode);
        const fromTitle = getLookupNodeTitle(fromNode, titleLookup);
        const toTitle = getLookupNodeTitle(toNode, titleLookup);
        const label = normalizeText(edge.label);
        const preview = (fromTitle || toTitle)
          ? `${fromTitle || t('未知起点', 'Unknown source')} → ${toTitle || t('未知终点', 'Unknown target')}`
          : '';
        return makeItemNode({
          key: `${keyPrefix}edge-${edgeId || index}`,
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
      });

      if (!edgeItems.length) {
        edgeItems.push(makePlaceholderItem(
          config.emptyKey || `${keyPrefix}edge-empty`,
          '',
          t('暂无带说明连接线', 'No labeled edges'),
          {
            color: folderColor,
            defaultColor
          }
        ));
      }

      return makeFolderNode({
        key: config.folderKey || 'folder-other',
        code: '',
        title: config.title || t('其他', 'Others'),
        color: folderColor,
        defaultColor,
        icon: folderIcon,
        open: config.open !== false,
        count: edgesWithLabel.length,
        children: edgeItems
      });
    };

    const importMembership = collectImportMembership(mdNodes);

    const importedTempSections = tempSections.filter((section) => isImportedTempSection(section, importMembership));
    const importedTempIdSet = new Set();
    importedTempSections.forEach((section) => {
      const sectionId = normalizeText(section && section.id);
      if (sectionId) importedTempIdSet.add(sectionId);
    });

    const importedMdNodes = mdNodes.filter((node) => isImportedMdNode(node, importMembership));
    const importedMdIdSet = new Set();
    importedMdNodes.forEach((node) => {
      const nodeId = normalizeText(node && node.id);
      if (nodeId) importedMdIdSet.add(nodeId);
    });

    const regularTempSections = tempSections.filter((section) => {
      const sectionId = normalizeText(section && section.id);
      return sectionId ? !importedTempIdSet.has(sectionId) : true;
    });

    const regularMdNodes = mdNodes.filter((node) => {
      const nodeId = normalizeText(node && node.id);
      return nodeId ? !importedMdIdSet.has(nodeId) : true;
    });

    const importedNodeIds = new Set();
    importedTempIdSet.forEach((id) => importedNodeIds.add(id));
    importedMdIdSet.forEach((id) => importedNodeIds.add(id));

    const importedEdges = [];
    const regularEdges = [];
    edges.forEach((edge) => {
      if (isImportedEdge(edge, importedNodeIds)) {
        importedEdges.push(edge);
      } else {
        regularEdges.push(edge);
      }
    });

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
      emptyKey: 'blank-empty'
    });

    const titleLookup = buildNodeTitleLookup(tempSections, mdNodes, copies);
    const otherFolder = buildOtherFolder(regularEdges, titleLookup, {
      folderKey: 'folder-other',
      emptyKey: 'edge-empty'
    });

    const importedTitleLookup = buildNodeTitleLookup(tempSections, mdNodes, []);

    const importedGroups = collectImportedGroups(
      importMembership,
      importedTempSections,
      importedMdNodes,
      importedEdges
    );

    const importedGroupFolders = importedGroups.map((group, index) => {
      const groupSnapshotSections = group.tempSections.filter((section) => !!(section && section.isSnapshot));
      const groupTemporarySections = group.tempSections.filter((section) => !(section && section.isSnapshot));

      const groupPermanentItems = [...groupSnapshotSections]
        .sort((a, b) => compareText(getTempSectionTitle(a), getTempSectionTitle(b)))
        .map((section) => makeItemNode({
          key: `imported-group-${index + 1}-permanent-${section.id}`,
          code: '',
          title: getTempSectionDisplayText(section),
          color: resolveImportedTempSectionColor(section),
          defaultColor: importNeutralColor,
          icon: 'fas fa-copy',
          iconText: '#',
          iconTone: 'hash',
          showDeleteControl: true,
          deleteAction: {
            kind: 'temp-section',
            sectionId: section.id,
            scopeOptions: false
          },
          target: { kind: 'temp-section', sectionId: section.id },
          preview: getTempSectionDescription(section)
        }));

      if (!groupPermanentItems.length) {
        groupPermanentItems.push(makePlaceholderItem(`imported-group-${index + 1}-permanent-empty`, '', t('暂无导入永久栏目', 'No imported permanent sections'), {
          iconText: '#',
          iconTone: 'hash',
          color: importNeutralColor,
          defaultColor: importNeutralColor
        }));
      }

      const groupPermanentFolder = makeFolderNode({
        key: `folder-imported-group-${index + 1}-permanent`,
        code: '',
        title: t('永久栏目', 'Permanent'),
        color: importNeutralColor,
        defaultColor: importNeutralColor,
        icon: 'fas fa-layer-group',
        iconText: '#',
        iconTone: 'hash',
        open: false,
        count: groupSnapshotSections.length,
        children: groupPermanentItems
      });

      const groupTemporaryFolder = buildTemporaryFolder(groupTemporarySections, {
        folderKey: `folder-imported-group-${index + 1}-temporary`,
        splitFolderKey: `folder-imported-group-${index + 1}-temp-split`,
        specialFolderKey: `folder-imported-group-${index + 1}-temp-special`,
        open: false,
        count: groupTemporarySections.length,
        itemKeyPrefix: `imported-group-${index + 1}-`,
        splitEmptyKey: `imported-group-${index + 1}-temp-split-empty`,
        specialEmptyKey: `imported-group-${index + 1}-temp-special-empty`,
        sectionColorResolver: resolveImportedTempSectionColor,
        folderColor: importNeutralColor,
        splitColor: importNeutralColor,
        specialColor: importNeutralColor,
        specialIconText: '✦',
        specialIconTone: 'special',
        folderIcon: 'fas fa-project-diagram',
        splitFolderIcon: 'fas fa-sitemap',
        specialFolderIcon: 'fas fa-star'
      });

      const groupBlankFolder = buildBlankFolder(group.mdNodes, {
        folderKey: `folder-imported-group-${index + 1}-blank`,
        open: false,
        count: group.mdNodes.length,
        itemKeyPrefix: `imported-group-${index + 1}-`,
        emptyKey: `imported-group-${index + 1}-blank-empty`,
        nodeColorResolver: resolveImportedMdNodeColor,
        folderColor: importNeutralColor,
        defaultColor: importNeutralColor,
        iconText: 'md',
        iconTone: 'md',
        variant: 'blank',
        folderIcon: 'fas fa-sticky-note',
        itemIcon: 'fas fa-file-alt'
      });

      const groupOtherFolder = buildOtherFolder(group.edges, importedTitleLookup, {
        folderKey: `folder-imported-group-${index + 1}-other`,
        open: false,
        itemKeyPrefix: `imported-group-${index + 1}-`,
        emptyKey: `imported-group-${index + 1}-edge-empty`,
        edgeColorResolver: resolveImportedEdgeColor,
        folderColor: importNeutralColor,
        defaultColor: importNeutralColor,
        folderIcon: 'fas fa-ellipsis-h'
      });

      const groupLabelBase = t('导入区块', 'Imported');
      const groupLabel = `${groupLabelBase} ${index + 1}`;
      const groupName = normalizeText(group.name);
      const groupPreview = groupName
        ? clampText(`${groupName}`)
        : '';
      const groupEdgeCount = group.edges.filter((edge) => normalizeText(edge && edge.label)).length;

      return makeFolderNode({
        key: `folder-imported-group-${index + 1}`,
        code: '',
        title: groupLabel,
        variant: 'import-group-root',
        color: importNeutralColor,
        defaultColor: importNeutralColor,
        icon: 'fas fa-box',
        open: true,
        showDeleteControl: enableGroupDelete,
        deleteAction: enableGroupDelete ? {
          kind: 'import-group',
          containerId: normalizeText(group.containerId),
          tempIds: group.tempSections.map((section) => section && section.id).filter(Boolean),
          mdIds: group.mdNodes.map((node) => node && node.id).filter(Boolean)
        } : null,
        count: groupSnapshotSections.length + groupTemporarySections.length + group.mdNodes.length + groupEdgeCount,
        preview: groupPreview,
        children: [
          groupPermanentFolder,
          groupTemporaryFolder,
          groupBlankFolder,
          groupOtherFolder
        ]
      });
    });

    if (importedOnly) {
      return applyDirectoryColorControl(importedGroupFolders);
    }

    const nodes = [permanentFolder, temporaryFolder, blankFolder, otherFolder];
    if (importedGroupFolders.length) {
      nodes.push(...importedGroupFolders);
    }
    return applyDirectoryColorControl(nodes);
  }

  function buildDirectoryDataForPreview(previewState, options = {}) {
    const inputState = previewState && typeof previewState === 'object' ? previewState : {};
    const storage = (options && options.storage && typeof options.storage === 'object') ? options.storage : null;
    const groupName = normalizeText(options && options.groupName);

    const tempSections = Array.isArray(inputState.tempSections)
      ? inputState.tempSections.map((section) => section ? { ...section } : section).filter(Boolean)
      : [];
    const mdNodes = Array.isArray(inputState.mdNodes)
      ? inputState.mdNodes.map((node) => node ? { ...node } : node).filter(Boolean)
      : [];
    const edges = Array.isArray(inputState.edges)
      ? inputState.edges.map((edge) => edge ? { ...edge } : edge).filter(Boolean)
      : [];

    let hasImportContainer = mdNodes.some((node) => node && node.subtype === 'import-container');
    if (!hasImportContainer) {
      const containerId = `preview-import-container-${Date.now()}`;
      mdNodes.unshift({
        id: containerId,
        type: 'md',
        subtype: 'import-container',
        groupLabel: groupName || t('导入区块 1', 'Imported 1'),
        containedTempIds: tempSections.map((section) => section && section.id).filter(Boolean),
        containedMdIds: mdNodes.map((node) => node && node.id).filter(Boolean)
      });
      hasImportContainer = true;
    }

    const hasSnapshot = tempSections.some((section) => !!(section && section.isSnapshot));
    if (!hasSnapshot && storage) {
      const syntheticSnapshots = buildPreviewSnapshotSectionsFromStorage(storage);
      if (syntheticSnapshots.length) {
        tempSections.unshift(...syntheticSnapshots);
        const firstContainer = mdNodes.find((node) => node && node.subtype === 'import-container');
        if (firstContainer) {
          const existingTempIds = Array.isArray(firstContainer.containedTempIds) ? firstContainer.containedTempIds : [];
          const extraIds = syntheticSnapshots.map((section) => section && section.id).filter(Boolean);
          firstContainer.containedTempIds = Array.from(new Set(existingTempIds.concat(extraIds)));
        }
      }
    }

    const previewStatePrepared = {
      tempSections,
      mdNodes,
      edges
    };

    return buildDirectoryData({
      state: previewStatePrepared,
      importedOnly: true,
      enableGroupDelete: false,
      copies: []
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

    if (kind === 'import-group') {
      return {
        delete: t('删除导入区块', 'Delete imported group'),
        confirm: t('确认删除导入区块', 'Confirm delete imported group'),
        cancel: fallbackCancel,
        current: fallbackCurrent,
        all: fallbackAll
      };
    }

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
        delete: t('删除空白栏目', 'Delete blank card'),
        confirm: t('确认删除空白栏目', 'Confirm delete blank card'),
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
    if (!containerEl || !node || !node.showDeleteControl || !node.deleteAction) return;

    const action = node.deleteAction;
    const labels = getDeleteActionLabels(action);
    const deleteUiOpen = !!pendingDeleteUiKey && pendingDeleteUiKey === node.key;
    const deleteWrap = document.createElement('span');
    deleteWrap.className = 'canvas-dir-folder-delete-wrap';
    if (deleteUiOpen) {
      deleteWrap.classList.add('is-open');
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'canvas-dir-folder-delete';
    if (deleteUiOpen) {
      deleteBtn.classList.add('is-armed');
    }
    deleteBtn.dataset.nodeDeleteKey = node.key;
    deleteBtn.setAttribute('aria-label', labels.delete);
    deleteBtn.title = labels.delete;
    deleteBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i>';
    deleteWrap.appendChild(deleteBtn);

    nodeDeleteActionMap.set(node.key, action);

    if (deleteUiOpen) {
      const secondaryWrap = document.createElement('span');
      secondaryWrap.className = 'canvas-dir-folder-delete-secondary';

      if (action.scopeOptions) {
        const currentBtn = document.createElement('button');
        currentBtn.type = 'button';
        currentBtn.className = 'canvas-dir-folder-delete-current';
        currentBtn.dataset.nodeDeleteKey = node.key;
        currentBtn.setAttribute('aria-label', labels.current);
        currentBtn.dataset.tooltip = labels.current;
        currentBtn.innerHTML = '<i class="fas fa-circle" aria-hidden="true"></i>';
        secondaryWrap.appendChild(currentBtn);

        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'canvas-dir-folder-delete-all';
        allBtn.dataset.nodeDeleteKey = node.key;
        allBtn.setAttribute('aria-label', labels.all);
        allBtn.dataset.tooltip = labels.all;
        allBtn.innerHTML = '<i class="fas fa-layer-group" aria-hidden="true"></i>';
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

    containerEl.appendChild(deleteWrap);
  }

  function renderNode(node, openFolderKeys) {
    if (node.type === 'folder') {
      const details = document.createElement('details');
      details.className = 'canvas-dir-folder';
      details.dataset.nodeKey = node.key;
      if (node.variant) details.dataset.nodeVariant = node.variant;
      details.open = openFolderKeys.has(node.key) || node.open !== false;

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

  function locateElement(module, element) {
    if (!module || typeof module.locateElement !== 'function' || !element) return false;
    try {
      module.locateElement(element);
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
      const byDataset = document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id=\"${escaped}\"]`)
        || document.querySelector(`.permanent-bookmark-section[data-permanent-section-copy-id=\"${escaped}\"]`);
      if (byDataset) return byDataset;
    }
    return document.getElementById(`permanent-section-copy-${safeCopyId}`);
  }

  function locatePermanentMain(module) {
    if (module && typeof module.locatePermanent === 'function') {
      try {
        module.locatePermanent();
        return true;
      } catch (_) { }
    }
    return locateElement(module, resolvePermanentSectionElement(null));
  }

  function locatePermanentCopy(module, copyId) {
    if (!copyId) return false;
    const sectionEl = resolvePermanentSectionElement(copyId);
    if (sectionEl) {
      return locateElement(module, sectionEl);
    }
    return false;
  }

  function locateByNodeId(module, nodeId) {
    const id = normalizeText(nodeId);
    if (!id) return false;

    if (id === 'permanentSection' || id === 'permanent-section') {
      return locatePermanentMain(module);
    }

    if (id.startsWith('permanent-section-copy-')) {
      const copyId = id.slice('permanent-section-copy-'.length);
      return locatePermanentCopy(module, copyId);
    }

    if (id.startsWith('temp-section-')) {
      if (module && typeof module.locateSection === 'function') {
        try {
          module.locateSection(id);
          return true;
        } catch (_) { }
      }
      const tempEl = document.getElementById(id);
      if (tempEl) return locateElement(module, tempEl);
      return false;
    }

    const target = document.getElementById(id);
    if (target) {
      return locateElement(module, target);
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

  function locateTarget(target) {
    if (!target || typeof target !== 'object') return;

    const module = getCanvasModule();
    switch (target.kind) {
      case 'permanent-main':
        locatePermanentMain(module);
        break;
      case 'permanent-copy':
        locatePermanentCopy(module, target.copyId);
        break;
      case 'temp-section':
        if (module && typeof module.locateSection === 'function') {
          try {
            module.locateSection(target.sectionId);
            return;
          } catch (_) { }
        }
        locateByNodeId(module, target.sectionId);
        break;
      case 'md-node':
        locateByNodeId(module, target.nodeId);
        break;
      case 'edge':
        highlightEdge(target.edgeId);
        if (locateByNodeId(module, target.fromNode)) return;
        locateByNodeId(module, target.toNode);
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

  function runDeleteImportedGroupAction(action) {
    if (!action || action.kind !== 'import-group') return false;

    const containerId = normalizeText(action.containerId);
    if (containerId) {
      try {
        if (typeof global.deleteImportGroup === 'function') {
          global.deleteImportGroup(containerId);
          return true;
        }
      } catch (_) { }

      try {
        if (typeof global.removeMdNode === 'function') {
          global.removeMdNode(containerId, true);
          return true;
        }
      } catch (_) { }
    }

    const tempIds = Array.isArray(action.tempIds) ? action.tempIds.map(id => normalizeText(id)).filter(Boolean) : [];
    const mdIds = Array.isArray(action.mdIds) ? action.mdIds.map(id => normalizeText(id)).filter(Boolean) : [];

    let removed = false;
    if (typeof global.removeTempNode === 'function') {
      tempIds.forEach((id) => {
        try {
          global.removeTempNode(id);
          removed = true;
        } catch (_) { }
      });
    }

    if (typeof global.removeMdNode === 'function') {
      mdIds.forEach((id) => {
        try {
          global.removeMdNode(id, false);
          removed = true;
        } catch (_) { }
      });
    }

    return removed;
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
      case 'import-group':
        return runDeleteImportedGroupAction(action);
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

    if (targetEl.classList.contains('canvas-dir-item-btn')) {
      event.preventDefault();
      event.stopPropagation();
    }

    activeNodeKey = nodeKey;
    const root = document.getElementById(ROOT_ID);
    updateActiveState(root);
    if (switchFullscreenNodeByDirectoryTarget(target)) return;
    locateTarget(target);
  }

  function bindRootEvents(root) {
    if (!root) return;
    if (root.dataset.canvasDirectoryBound === 'true') return;
    root.dataset.canvasDirectoryBound = 'true';
    root.addEventListener('click', handleRootClick);
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

  function queueRefresh(options = {}) {
    if (options.force) pendingForceRefresh = true;
    if (refreshRaf) return;
    refreshRaf = global.requestAnimationFrame(() => {
      refreshRaf = null;
      const force = pendingForceRefresh;
      pendingForceRefresh = false;
      refreshDirectory({ force });
    });
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

    canvasObserver = new MutationObserver(() => {
      queueRefresh();
    });
    canvasObserver.observe(canvasContent, {
      childList: true,
      subtree: true
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
    renderPreviewDirectory
  };
})(window);
