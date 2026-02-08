(function setupCanvasSidebarDirectory(global) {
  'use strict';

  const ROOT_ID = 'canvasDirectoryTree';
  const CANVAS_CONTENT_ID = 'canvasContent';
  const REFRESH_INTERVAL_MS = 1200;
  const PREVIEW_LIMIT = 260;
  const PERMANENT_COPIES_STORAGE_KEY = 'permanent-section-copies';
  const SPECIAL_TEMP_SOURCE_SET = new Set(['browser-drop', 'search-result', 'batch', 'quick-add']);
  const DIRECTORY_COLOR_DEFAULTS = Object.freeze({
    permanent: '#10b981',
    temp: '#2563eb',
    specialTemp: '#e9973f',
    blank: '#888888',
    edge: '#999999'
  });

  let initialized = false;
  let refreshTimer = null;
  let refreshRaf = null;
  let pendingForceRefresh = false;
  let canvasObserver = null;
  let observedCanvasContent = null;
  let lastFingerprint = '';
  let activeNodeKey = '';
  let nodeActionMap = new Map();

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

  function getAppearanceBaseColorTokens() {
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
    const key = copyId ? `canvas-permanent-tip-text-copy-${copyId}` : 'canvas-permanent-tip-text';
    try {
      return toPreviewText(localStorage.getItem(key) || '');
    } catch (_) {
      return '';
    }
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
    if (labelRaw === '拖入' || labelRaw === '搜索' || labelRaw === '批量' || labelRaw === '添加') return true;

    const label = labelRaw.toLowerCase();
    return label === 'drop' || label === 'search' || label === 'batch' || label === 'add';
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
    const byTitle = getFirstLineText(node && node.title);
    if (byTitle) return byTitle;

    const byText = getFirstLineText(node && node.text);
    if (byText) return byText;

    const byHtml = getFirstLineText(node && node.html);
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
      target: config.target || null,
      placeholder: !!config.placeholder
    };
  }

  function buildSplitChainNodes(splitTempSections, options = {}) {
    const resolveColor = typeof options.resolveColor === 'function'
      ? options.resolveColor
      : (() => options.fallbackColor || '');
    const defaultColor = options.defaultColor || options.fallbackColor || '';
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
      const key = `temp-split-${section.id}`;

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

  function buildDirectoryData() {
    const state = getCanvasState();
    const module = getCanvasModule();
    const tempSections = Array.isArray(state && state.tempSections) ? state.tempSections.filter(Boolean) : [];
    const mdNodes = Array.isArray(state && state.mdNodes) ? state.mdNodes.filter(Boolean) : [];
    const edges = Array.isArray(state && state.edges) ? state.edges.filter(Boolean) : [];
    const copies = readPermanentCopies();
    const colorTokens = getAppearanceBaseColorTokens();

    let menuColorSync = false;
    try {
      if (module && typeof module.getCanvasOtherSettings === 'function') {
        const otherSettings = module.getCanvasOtherSettings();
        menuColorSync = !!(otherSettings && otherSettings.menuColorSync);
      }
    } catch (_) {
      menuColorSync = false;
    }

    const resolveTempSectionColor = (section) => {
      const live = normalizeHexColor(section && section.color, null);
      if (menuColorSync && live) return live;
      return isSpecialTempSection(section) ? colorTokens.specialTemp : colorTokens.temp;
    };

    const resolveMdNodeColor = (node) => {
      const live = resolveNodeCustomColor(node);
      if (menuColorSync && live) return live;
      return colorTokens.blank;
    };

    const resolveEdgeColor = (edge) => {
      const live = resolveNodeCustomColor(edge);
      if (menuColorSync && live) return live;
      return colorTokens.edge;
    };

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

    const specialTempSections = [];
    const splitTempSections = [];
    tempSections.forEach((section) => {
      if (isSpecialTempSection(section)) {
        specialTempSections.push(section);
      } else {
        splitTempSections.push(section);
      }
    });
    splitTempSections.sort(sortTempSections);
    specialTempSections.sort(sortTempSections);

    const splitItems = buildSplitChainNodes(splitTempSections, {
      resolveColor: resolveTempSectionColor,
      fallbackColor: colorTokens.temp,
      defaultColor: colorTokens.temp
    });

    if (!splitItems.length) {
      splitItems.push(makePlaceholderItem('temp-split-empty', '', t('暂无分裂栏目', 'No split sections'), {
        color: colorTokens.temp,
        defaultColor: colorTokens.temp
      }));
    }

    const specialItems = specialTempSections.map((section, index) => {
      const label = getTempSectionLabel(section);
      const title = squeezeSpaces(`${label} ${getTempSectionTitle(section)}`.trim());
      return makeItemNode({
        key: `temp-special-${section.id}`,
        code: '',
        title,
        color: resolveTempSectionColor(section),
        defaultColor: colorTokens.specialTemp,
        icon: 'fas fa-star',
        iconText: '✦',
        iconTone: 'special',
        target: { kind: 'temp-section', sectionId: section.id },
        preview: getTempSectionDescription(section)
      });
    });

    if (!specialItems.length) {
      specialItems.push(makePlaceholderItem('temp-special-empty', '', t('暂无特殊栏目', 'No special sections'), {
        iconText: '✦',
        iconTone: 'special',
        color: colorTokens.specialTemp,
        defaultColor: colorTokens.specialTemp
      }));
    }

    const temporaryFolder = makeFolderNode({
      key: 'folder-temporary',
      code: '',
      title: t('临时栏目', 'Temporary'),
      color: colorTokens.temp,
      defaultColor: colorTokens.temp,
      icon: 'fas fa-project-diagram',
      count: tempSections.length,
      children: [
        makeFolderNode({
          key: 'folder-temp-split',
          code: '',
          title: t('常规链式', 'General Chain'),
          color: colorTokens.temp,
          defaultColor: colorTokens.temp,
          icon: 'fas fa-sitemap',
          count: splitTempSections.length,
          children: splitItems
        }),
        makeFolderNode({
          key: 'folder-temp-special',
          code: '',
          title: t('特殊临时栏目', 'Special temporary'),
          color: colorTokens.specialTemp,
          defaultColor: colorTokens.specialTemp,
          icon: 'fas fa-star',
          iconText: '✦',
          iconTone: 'special',
          count: specialTempSections.length,
          children: specialItems
        })
      ]
    });

    const sortedMdNodes = [...mdNodes].sort((a, b) => {
      const at = toPositiveInt(a && a.createdAt);
      const bt = toPositiveInt(b && b.createdAt);
      if (at && bt && at !== bt) return at - bt;
      if (at && !bt) return -1;
      if (!at && bt) return 1;
      return compareText(a && a.id, b && b.id);
    });

    const blankItems = sortedMdNodes.map((node, index) => makeItemNode({
      key: `blank-${node.id}`,
      code: '',
      title: `${index + 1}. ${getMdNodeTitle(node)}`,
      color: resolveMdNodeColor(node),
      defaultColor: colorTokens.blank,
      icon: 'fas fa-file-alt',
      iconText: 'md',
      iconTone: 'md',
      variant: 'blank',
      target: { kind: 'md-node', nodeId: node.id },
      preview: ''
    }));

    if (!blankItems.length) {
      blankItems.push(makePlaceholderItem('blank-empty', '', t('暂无空白栏目', 'No blank nodes'), {
        iconText: 'md',
        iconTone: 'md',
        variant: 'blank',
        color: colorTokens.blank,
        defaultColor: colorTokens.blank
      }));
    }

    const blankFolder = makeFolderNode({
      key: 'folder-blank',
      code: '',
      title: t('空白栏目', 'Blank'),
      color: colorTokens.blank,
      defaultColor: colorTokens.blank,
      icon: 'fas fa-sticky-note',
      iconText: 'md',
      iconTone: 'md',
      variant: 'blank',
      count: sortedMdNodes.length,
      children: blankItems
    });

    const titleLookup = buildNodeTitleLookup(tempSections, mdNodes, copies);
    const edgesWithLabel = edges.filter((edge) => normalizeText(edge && edge.label));
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
        key: `edge-${edgeId || index}`,
        code: '',
        title: `${index + 1}. ${label}`,
        color: resolveEdgeColor(edge),
        defaultColor: colorTokens.edge,
        icon: 'fas fa-link',
        target: { kind: 'edge', edgeId, fromNode, toNode },
        preview
      });
    });

    if (!edgeItems.length) {
      edgeItems.push(makePlaceholderItem('edge-empty', '', t('暂无带说明连接线', 'No labeled edges'), {
        color: colorTokens.edge,
        defaultColor: colorTokens.edge
      }));
    }

    const otherFolder = makeFolderNode({
      key: 'folder-other',
      code: '',
      title: t('其他', 'Others'),
      color: colorTokens.edge,
      defaultColor: colorTokens.edge,
      icon: 'fas fa-ellipsis-h',
      count: edgesWithLabel.length,
      children: edgeItems
    });

    return [permanentFolder, temporaryFolder, blankFolder, otherFolder];
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

    item.appendChild(btn);

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

  function locatePermanentMain(module) {
    if (module && typeof module.locatePermanent === 'function') {
      try {
        module.locatePermanent();
        return true;
      } catch (_) { }
    }
    return locateElement(module, document.getElementById('permanentSection'));
  }

  function locatePermanentCopy(module, copyId) {
    if (!copyId) return false;
    const escaped = escapeSelector(copyId);
    if (!escaped) return false;

    const sectionEl = document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id=\"${escaped}\"]`);
    if (sectionEl) {
      return locateElement(module, sectionEl);
    }

    const byId = document.getElementById(`permanent-section-copy-${copyId}`);
    if (byId) {
      return locateElement(module, byId);
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

  function handleRootClick(event) {
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
    locateTarget(target);
  }

  function bindRootEvents(root) {
    if (!root) return;
    if (root.dataset.canvasDirectoryBound === 'true') return;
    root.dataset.canvasDirectoryBound = 'true';
    root.addEventListener('click', handleRootClick);
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
    refresh
  };
})(window);
