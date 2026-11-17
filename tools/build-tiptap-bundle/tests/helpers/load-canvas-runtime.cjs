const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '../../../..');
const canvasSource = fs.readFileSync(path.join(root, 'Bookmark-Canvas-main/history_html/bookmark_canvas_module.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js'), 'utf8');
const peleBundle = fs.readFileSync(path.join(root, 'Bookmark-Canvas-main/history_html/vendor/pele.min.js'), 'utf8');
const bundle = buildSync({
  entryPoints: [path.join(__dirname, '../../entry.js')],
  bundle: true,
  format: 'iife',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error(`Missing canvas function: ${name}`);
  return source.slice(start, end + 2);
}

/** Load production functions in an isolated DOM without booting extension services. */
module.exports = function loadCanvasRuntime({ platform } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://canvas.test',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const context = dom.getInternalVMContext();
  if (platform) Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, value: platform });
  const run = code => new vm.Script(code).runInContext(context);
  run(peleBundle);
  run(bundle);
  const functions = [
    '__looksLikeHtmlTagContent', '__sanitizeCanvasRichTextHtml',
    '__buildTiptapObservationInnerHtml', '__buildTiptapObservationDom',
    '__toggleMarkdownTaskAtIndex', '__normalizeCanvasMarkdownSource',
    '__stripUnsupportedCanvasHtmlMarkdown', '__repairLegacyCanvasMarkdownSource',
    '__convertInlineMarkdownToHtmlTags',
    '__mountMdCloneDescriptionEditor', 'preventCanvasEventsPropagation',
    '__normalizeCanvasRichHtml', '__hasMeaningfulRichContent',
    '__getCleanHtmlForStorage', '__coerceDescriptionSourceToHtml',
    '__resolveMarkdownSourceFromEditorHtml', '__normalizePermanentViewDescriptionMarkdown',
    '__clearCanvasDescriptionSelection', '__selectCanvasDescriptionContainer',
    '__bindCanvasDescriptionSelectionClear', '__isSelectionAll',
    '__cleanupCanvasNodeTiptapInstances', 'bindPermanentSectionTipBehavior',
    'renderCanvasMermaidDiagrams', '__deselectCanvasMermaidDiagram', '__selectCanvasMermaidDiagram',
    '__triggerDiagramParentEdit', '__getCanvasMermaidLightboxZoomKeyName', '__updateCanvasMermaidLightboxHint',
    '__ensureCanvasMermaidLightboxOverlay', '__openCanvasMermaidLightbox',
    '__bindCanvasMermaidSelectionClear',
    '__isHeadingNode', '__getHeadingLevel', '__applyHeadingCollapse', '__postProcessCanvasObservationDom', '__handleHeadingCollapseClick',
    '__isViewportLowDetailEffective', 'isCanvasVirtualizationEnabled',
    '__setupDescAutoScroll',
    '__bindFormatEditingHelp', '__syncFormatToolbarActiveStates', '__renderMdNodeImpl',
    '__cleanupMdNodeElementLifecycle', '__resetMdNodeElementForRender',
    'clearMdSelection', 'selectMdNode',
    '__syncMdNodeFromEditor', 'getOverlayContainer', '__positionCanvasFloatingPopoverAboveButton',
    '__setCanvasPopoverTopLayer', '__bindCanvasFormatPopoverLayout', '__positionCanvasFormatSubmenu',
  ];
  run([
    extractFunction(storageSource, '__stripZwsp'),
    extractFunction(storageSource, '__htmlToMarkdown'),
    ...functions.map(name => extractFunction(canvasSource, name)),
  ].join('\n'));
  const start = canvasSource.indexOf('    // 创建说明文字容器（始终显示）', canvasSource.indexOf('function __renderTempNodeImpl('));
  const end = canvasSource.indexOf("    const body = document.createElement('div');", start);
  if (start < 0 || end < 0) throw new Error('Missing temporary description fixture');
  run(`
    const TEMP_DESC_HEIGHT_SETTINGS_KEY = 'test-height';
    const PERMANENT_DESC_HEIGHT_SETTINGS_KEY = 'test-permanent-height';
    const PERMANENT_COPY_TIP_STORAGE_PREFIX = 'test-copy-tip:';
    const PERMANENT_MAIN_TIP_STORAGE_KEY = 'test-main-tip';
    const DESC_CLEAR_CONFIRM_POPOVER_ID = 'test-confirm';
    const DESC_HEIGHT_SETTINGS_POPOVER_ID = 'test-height-pop';
    const CANVAS_BROOM_SVG = '';
    const PELE_ICON_PREVIEW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
    const PELE_ICON_EDIT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
    const PELE_ICON_CLOSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    const MD_NODE_DEFAULT_FONT_SIZE = 20;
    const CANVAS_MD_CONTENT_UNLOADED_CLASS = 'md-content-unloaded';
    const CANVAS_PLUGIN_MARKDOWN_SUBTYPE = 'canvas-markdown-blank';
    const CANVAS_PLUGIN_MARKDOWN_SOURCE = 'bookmark-canvas-blank';
    const CanvasState = { mdNodes: [], lowDetailActive: false, selectedMdNodeId: null };
    window.CanvasState = CanvasState;
    let activeSelectedDiagram = null;
    let activeLightboxOverlay = null;
    let canvasShortcuts = { ctrlKey: 'Control', spaceKey: 'Space' };
    window.canvasShortcuts = canvasShortcuts;
    function isMacEnvironment() { return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || ''); }
    function getKeyDisplayName(key) { if (key === 'Control') return 'Ctrl'; if (key === 'Meta') return 'Cmd'; if (key === 'Alt') return 'Option'; return key; }
    function isCustomCtrlKeyPressed(e) { return !!e.ctrlKey; }
    function isCustomSpaceKeyCode(code) { return code === 'Space'; }
    window.__canvasActiveSelectedDiagram = null;
    window.__canvasActiveLightboxOverlay = null;
    function __getCanvasTotalDataStatsSync() { return window.__canvasTotalStats || { totalColumnCount: 0, totalBookmarkCount: 0, totalFolderCount: 0 }; }
    let __canvasDescSelectionClearBound = false;
    window.sectionSaves = [];
    window.tipSaves = [];
    window.manifestSaves = [];
    function __normalizeTempSectionDescriptionMarkdown(section) { return String(section.descriptionMd || ''); }
    function __readDescHeightSettings(_key, defaults) { return { ...defaults }; }
    function __readJSON(_key, fallback) { return fallback; }
    function __persistPermanentTipStorageValue(key, value) {
      localStorage.setItem(key, value);
      tipSaves.push({ key, value });
    }
    function saveTempSectionsPatch(section) { sectionSaves.push(JSON.parse(JSON.stringify(section))); }
    function saveCanvasManifestOnly(options) { manifestSaves.push(options); }
    function __setCanvasDescriptionToolbarTopLayer() {}
    function __showDescClearConfirmPopover(_button, options) { options.onConfirm(); }
    function updateCanvasPopoverState() {}
    function __ensureMdNodeMarkdownProtocol() {}
    function __isCanvasNativeTextNode() { return false; }
    function __deriveMdNodeMarkdownSource(node) { return node.text || ''; }
    function getBlankNodeDefaultSize() { return { width: 360, height: 280, minWidth: 100, minHeight: 100 }; }
    function applyElementMinimumSize() {}
    function getSectionMinimumSize() { return {}; }
    function __setCanvasViewportLazyShellClass() {}
    function getFullscreenLabel() { return 'Fullscreen'; }
    function getLayoutZoomLabel() { return 'Zoom'; }
    function __getDefaultLayoutZoomPercentByElement() { return 100; }
    function __buildCanvasPartitionedViewStateKey(_kind, key) { return key; }
    function __readPartitionedViewJSON() { return null; }
    function __bindCanvasSectionScrollPerformance() {}
    function __scheduleCanvasSectionScrollPersistence() {}
    function updateNodeFullscreenButtons() {}
    function __handleLayoutZoomAction() { return false; }
    function closeMdColorPopover() {}
    function isSectionCtrlModeEvent() { return false; }
    function makeMdNodeDraggable() {}
    function makeTempNodeResizable() {}
    function applyMdNodeColor() {}
    function addAnchorsToNode() {}
    function __tryRestorePendingMaximizedNodeForElement() {}
    function __isNodeMaximized(el) { return !!el && el.classList.contains('canvas-node-maximized'); }
    function __scheduleNodeLayoutZoomStabilize() {}
    function registerSectionCtrlOverlay() {}
    function __ensureMdNodeLowDetailOverlay() {}
    function clearEdgeSelection() {}
    function createBlankFixture(source = 'blank text') {
      if (!document.getElementById('canvasContent')) {
        const container = document.createElement('div');
        container.id = 'canvasContent';
        document.body.append(container);
      }
      const node = { id: 'md-node-' + CanvasState.mdNodes.length, text: source, x: 0, y: 0, fontSize: 20 };
      CanvasState.mdNodes.push(node);
      __renderMdNodeImpl(node);
      return { node, element: document.getElementById(node.id) };
    }
    function createTempDescriptionFixture(section) {
      const nodeElement = document.createElement('div');
      nodeElement.className = 'temp-canvas-node';
      nodeElement.id = section.id;
      document.body.append(nodeElement);
      ${canvasSource.slice(start, end)}
      nodeElement.append(descriptionContainer);
      return { section, nodeElement, descriptionText, descriptionContainer, descriptionControls,
        descEditorApi, enterEditingDescription, exitEditingDescription, clearTempDescription,
        isEditing: () => isEditingDesc };
    }
  `);
  return { window: dom.window, run, close: () => dom.window.close() };
};
