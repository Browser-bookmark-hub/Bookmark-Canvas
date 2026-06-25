// Apply theme early to avoid flash (no inline script for CSP)
(function () {
  try {
    // Keep consistent with main UI theme.js:
    // - localStorage.themePreference: 'system' | 'light' | 'dark'
    // - only set data-theme='dark' when dark, otherwise remove the attribute.
    // Legacy override keys are cleared to avoid "not linked" confusion.
    try {
      localStorage.removeItem('historyViewerHasCustomTheme');
      localStorage.removeItem('historyViewerCustomTheme');
    } catch (_) { }

    const pref = localStorage.getItem('themePreference');
    const theme = (pref === 'dark' || pref === 'light')
      ? pref
      : 'dark';

    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  } catch (_) { }
})();

// Apply layout state early to avoid sidebar/header/floating flash on refresh
(function () {
  try {
    const root = document.documentElement;
    if (!root) return;

    const readStorage = (key) => {
      try {
        return localStorage.getItem(key);
      } catch (_) {
        return null;
      }
    };

    const clamp = (value, min, max) => {
      return Math.min(max, Math.max(min, value));
    };

    const normalizeSidebarState = (raw) => {
      const value = String(raw || '').toLowerCase();
      if (value === 'collapsed') return 'compact';
      return value === 'compact' ? 'compact' : (value === 'expanded' ? 'expanded' : null);
    };

    const normalizeHeaderState = (raw) => {
      const value = String(raw || '').toLowerCase();
      return value === 'compact' ? 'compact' : 'expanded';
    };

    const normalizeHeaderDock = (raw) => {
      const value = String(raw || '').toLowerCase();
      if (value === 'bottom') return 'bottom';
      if (value === 'top') return 'top';
      return null;
    };

    const normalizeSidebarDock = (raw) => {
      return String(raw || '').toLowerCase() === 'right' ? 'right' : 'left';
    };

    const normalizeSidebarWidth = (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      return clamp(Math.round(value), 200, 560);
    };

    const normalizeAutoCollapseWidth = (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return 600;
      return clamp(Math.round(value), 320, 2000);
    };

    const normalizeCompactLeft = (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      const max = Math.max(0, (window.innerWidth || 0) - 40);
      return clamp(Math.round(value), 0, max);
    };

    const TOGGLE_DEFAULT_RATIO = 0.6;
    const TOGGLE_RATIO_MIN = 0.08;
    const TOGGLE_RATIO_MAX = 0.92;

    const normalizeToggleRatio = (raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      return clamp(value, TOGGLE_RATIO_MIN, TOGGLE_RATIO_MAX);
    };

    const SIDE_PANEL_FLOATING_TOOLS_MODES = {
      NONE: 'none',
      HIDDEN: 'hidden',
      SHOWN: 'shown'
    };

    const normalizeFloatingToolsMode = (mode) => {
      return mode === SIDE_PANEL_FLOATING_TOOLS_MODES.NONE
        || mode === SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN
        || mode === SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN
        ? mode
        : SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN;
    };

    const getInitialFloatingToolsMode = (isSidePanel) => {
      try {
        if (isSidePanel) {
          const savedMode = readStorage('sidepanelFloatingToolsMode');
          if (savedMode) return normalizeFloatingToolsMode(savedMode);
          return SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
        }
        const canvasMode = readStorage('canvasFloatingToolsMode');
        if (canvasMode) return normalizeFloatingToolsMode(canvasMode);
        return SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
      } catch (_) {
        return SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
      }
    };

    const getInitialCanvasScrollbarHiddenState = () => {
      const out = {
        // 与 CanvasState.scrollState 默认值保持一致
        verticalHidden: true,
        horizontalHidden: true
      };
      try {
        const raw = readStorage('canvas-scroll-preferences');
        if (!raw) return out;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const vertical = parsed.vertical;
          const horizontal = parsed.horizontal;
          if (vertical && typeof vertical === 'object' && typeof vertical.hidden === 'boolean') {
            out.verticalHidden = vertical.hidden;
          }
          if (horizontal && typeof horizontal === 'object' && typeof horizontal.hidden === 'boolean') {
            out.horizontalHidden = horizontal.hidden;
          }
        }
      } catch (_) { }
      return out;
    };

    const getInitialCanvasScrollbarThumbPositionState = () => {
      const out = {
        verticalRatio: null,
        horizontalRatio: null
      };

      try {
        const raw = readStorage('canvas-scrollbar-preload-v1');
        if (!raw) return out;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return out;

        const ts = Number(parsed.ts || 0);
        // 仅使用较新的状态，避免历史过旧数据导致错误预置
        if (!Number.isFinite(ts) || (Date.now() - ts) > 7 * 24 * 60 * 60 * 1000) {
          return out;
        }

        const panX = Number(parsed.panX);
        const panY = Number(parsed.panY);
        const hMin = Number(parsed.horizontal && parsed.horizontal.min);
        const hMax = Number(parsed.horizontal && parsed.horizontal.max);
        const vMin = Number(parsed.vertical && parsed.vertical.min);
        const vMax = Number(parsed.vertical && parsed.vertical.max);

        if (Number.isFinite(panX) && Number.isFinite(hMin) && Number.isFinite(hMax) && hMax !== hMin) {
          const ratioX = (hMax - panX) / (hMax - hMin);
          out.horizontalRatio = clamp(ratioX, 0, 1);
        }

        if (Number.isFinite(panY) && Number.isFinite(vMin) && Number.isFinite(vMax) && vMax !== vMin) {
          const ratioY = (vMax - panY) / (vMax - vMin);
          out.verticalRatio = clamp(ratioY, 0, 1);
        }
      } catch (_) { }

      return out;
    };

    const CANVAS_VIEW_STATE_STORAGE_NS = 'canvas:view:v1';
    const CANVAS_FULLSCREEN_VIEW_STATE_KIND = 'fullscreen';
    const CANVAS_NODE_MAXIMIZED_STORAGE_KEY = 'canvas-node-maximized-v1';

    const buildCanvasPartitionedViewStateKey = (kind, baseKey, partitionKey) => {
      if (!kind || !baseKey || !partitionKey) return baseKey;
      return `${CANVAS_VIEW_STATE_STORAGE_NS}:${kind}:${partitionKey}:${baseKey}`;
    };

    const readCanvasPartitionedViewState = (kind, baseKey, partitionKey) => {
      const partitionedKey = buildCanvasPartitionedViewStateKey(kind, baseKey, partitionKey);
      return readStorage(partitionedKey) || readStorage(baseKey);
    };

    const params = new URLSearchParams(window.location.search || '');
    const sidePanelFlag = params.get('sidepanel') || params.get('side_panel') || params.get('panel');
    const isSidePanelMode = sidePanelFlag === '1' || sidePanelFlag === 'true';
    const canvasViewPartitionKey = isSidePanelMode ? 'sidepanel' : 'page';
    if (isSidePanelMode) {
      root.classList.add('side-panel-mode');
    }

    const headerLayoutKeys = isSidePanelMode
      ? {
        collapseState: 'sidepanelHeaderCollapseState',
        dockSide: 'sidepanelHeaderDockSide',
        compactLeftLegacy: 'sidepanelHeaderCompactToggleLeft',
        compactLeftTop: 'sidepanelHeaderCompactToggleLeftTop',
        compactLeftBottom: 'sidepanelHeaderCompactToggleLeftBottom'
      }
      : {
        collapseState: 'headerCollapseState',
        dockSide: 'headerDockSide',
        compactLeftLegacy: 'headerCompactToggleLeft',
        compactLeftTop: 'headerCompactToggleLeftTop',
        compactLeftBottom: 'headerCompactToggleLeftBottom'
      };

    const sidebarLayoutKeys = isSidePanelMode
      ? {
        state: 'sidepanelSidebarCollapseState',
        legacyCollapsed: 'sidepanelSidebarCollapsed',
        manualOverride: 'sidepanelSidebarManualOverride',
        dockSide: 'sidepanelSidebarDockSide',
        expandedWidthLeft: 'sidepanelSidebarExpandedWidthLeft',
        expandedWidthRight: 'sidepanelSidebarExpandedWidthRight',
        toggleRatio: 'sidepanelSidebarToggleTopRatio',
        toggleMoved: 'sidepanelSidebarToggleTopMoved'
      }
      : {
        state: 'sidebarCollapseState',
        legacyCollapsed: 'sidebarCollapsed',
        manualOverride: 'sidebarManualOverride',
        dockSide: 'sidebarDockSide',
        expandedWidthLeft: 'sidebarExpandedWidthLeft',
        expandedWidthRight: 'sidebarExpandedWidthRight',
        toggleRatio: 'sidebarToggleTopRatio',
        toggleMoved: 'sidebarToggleTopMoved'
      };

    const floatingDockStorageKey = isSidePanelMode
      ? 'sidepanelFloatingToolsDockV1'
      : 'canvasFloatingToolsDockV1';

    const viewFromUrl = params.get('view');
    const viewFromStorage = readStorage('lastActiveView');
    const initialView = viewFromUrl || viewFromStorage || 'canvas';
    root.classList.toggle('canvas-view-active', initialView === 'canvas');

    const initialFloatingMode = getInitialFloatingToolsMode(isSidePanelMode);
    if (initialView === 'canvas' && initialFloatingMode === SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN) {
      root.classList.add('layout-preload-floating-hidden');
    }

    const hasPendingNodeMaximizedState = (() => {
      if (initialView !== 'canvas') return false;
      try {
        const raw = readCanvasPartitionedViewState(
          CANVAS_FULLSCREEN_VIEW_STATE_KIND,
          CANVAS_NODE_MAXIMIZED_STORAGE_KEY,
          canvasViewPartitionKey
        );
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return false;
        if (parsed.type === 'permanent') return true;
        if (parsed.type === 'permanent-copy' && parsed.copyId) return true;
        return !!parsed.id;
      } catch (_) {
        return false;
      }
    })();

    if (hasPendingNodeMaximizedState) {
      root.classList.add('layout-preload-node-maximized-active');
    }

    if (initialView === 'canvas') {
      const scrollbarHiddenState = getInitialCanvasScrollbarHiddenState();
      if (scrollbarHiddenState.verticalHidden) {
        root.classList.add('layout-preload-canvas-scrollbar-vertical-hidden');
      }
      if (scrollbarHiddenState.horizontalHidden) {
        root.classList.add('layout-preload-canvas-scrollbar-horizontal-hidden');
      }

      const scrollbarThumbPosition = getInitialCanvasScrollbarThumbPositionState();
      if (scrollbarThumbPosition.verticalRatio != null) {
        root.style.setProperty('--canvas-scrollbar-preload-vertical-ratio', String(scrollbarThumbPosition.verticalRatio));
      }
      if (scrollbarThumbPosition.horizontalRatio != null) {
        root.style.setProperty('--canvas-scrollbar-preload-horizontal-ratio', String(scrollbarThumbPosition.horizontalRatio));
      }
    }

    const headerState = normalizeHeaderState(readStorage(headerLayoutKeys.collapseState));
    const defaultHeaderDock = isSidePanelMode ? 'bottom' : 'top';
    const savedHeaderDockRaw = readStorage(headerLayoutKeys.dockSide);
    const headerDock = (savedHeaderDockRaw == null)
      ? defaultHeaderDock
      : (normalizeHeaderDock(savedHeaderDockRaw) || defaultHeaderDock);
    if (headerState === 'compact') root.classList.add('layout-preload-header-compact');
    if (headerDock === 'bottom') root.classList.add('layout-preload-header-dock-bottom');

    const legacyCompactLeft = normalizeCompactLeft(readStorage(headerLayoutKeys.compactLeftLegacy));
    const topCompactLeft = normalizeCompactLeft(readStorage(headerLayoutKeys.compactLeftTop));
    const bottomCompactLeft = normalizeCompactLeft(readStorage(headerLayoutKeys.compactLeftBottom));
    const fallbackCompactLeft = 18;
    const preferredDockLeft = headerDock === 'bottom' ? bottomCompactLeft : topCompactLeft;
    const alternateDockLeft = headerDock === 'bottom' ? topCompactLeft : bottomCompactLeft;
    const mirroredCompactLeft = legacyCompactLeft != null
      ? legacyCompactLeft
      : (preferredDockLeft != null
        ? preferredDockLeft
        : (alternateDockLeft != null ? alternateDockLeft : fallbackCompactLeft));
    root.style.setProperty('--header-toggle-compact-left', String(mirroredCompactLeft) + 'px');

    let collapseMode = 'auto';
    let autoCollapseWidth = 600;
    try {
      const otherRaw = readStorage('canvas-other-settings-v1');
      if (otherRaw) {
        const other = JSON.parse(otherRaw);
        if (other && typeof other === 'object') {
          const modeKey = isSidePanelMode ? 'sidepanelDirectoryCollapseMode' : 'directoryCollapseMode';
          const widthKey = isSidePanelMode ? 'sidepanelDirectoryAutoCollapseWidth' : 'directoryAutoCollapseWidth';
          const modeRaw = other[modeKey] != null ? other[modeKey] : other.directoryCollapseMode;
          const widthRaw = other[widthKey] != null ? other[widthKey] : other.directoryAutoCollapseWidth;
          const mode = String(modeRaw || '').toLowerCase();
          if (mode === 'manual' || mode === 'auto') collapseMode = mode;
          autoCollapseWidth = normalizeAutoCollapseWidth(widthRaw);
        }
      }
    } catch (_) { }

    const persistedSidebarState = (() => {
      const savedState = normalizeSidebarState(readStorage(sidebarLayoutKeys.state));
      if (savedState) return savedState;
      const legacy = readStorage(sidebarLayoutKeys.legacyCollapsed);
      if (legacy === 'true') return 'compact';
      if (legacy === 'false') return 'expanded';
      return isSidePanelMode ? 'compact' : 'expanded';
    })();

    const hasManualOverride = readStorage(sidebarLayoutKeys.manualOverride) === 'true';
    const sidebarDock = normalizeSidebarDock(readStorage(sidebarLayoutKeys.dockSide));
    const hasStoredSidebarState = readStorage(sidebarLayoutKeys.state) != null
      || readStorage(sidebarLayoutKeys.legacyCollapsed) != null;

    const storedToggleTopRatio = normalizeToggleRatio(readStorage(sidebarLayoutKeys.toggleRatio));
    const hasToggleTopMoved = readStorage(sidebarLayoutKeys.toggleMoved) === 'true';
    const preloadToggleTopRatio = hasToggleTopMoved
      ? (storedToggleTopRatio != null ? storedToggleTopRatio : TOGGLE_DEFAULT_RATIO)
      : TOGGLE_DEFAULT_RATIO;
    root.style.setProperty('--sidebar-toggle-top', `${(preloadToggleTopRatio * 100).toFixed(2)}%`);

    let initialSidebarState = persistedSidebarState;
    if (collapseMode === 'auto' && !hasManualOverride) {
      initialSidebarState = (window.innerWidth <= autoCollapseWidth) ? 'compact' : 'expanded';
    }
    if (!hasStoredSidebarState) {
      initialSidebarState = isSidePanelMode ? 'compact' : 'expanded';
    }

    const expandedWidthKey = sidebarDock === 'right'
      ? sidebarLayoutKeys.expandedWidthRight
      : sidebarLayoutKeys.expandedWidthLeft;
    const expandedWidth = normalizeSidebarWidth(readStorage(expandedWidthKey)) || 260;
    const effectiveWidth = initialSidebarState === 'compact' ? 0 : expandedWidth;
    const widthPx = String(Math.max(0, Math.round(effectiveWidth))) + 'px';

    if (initialSidebarState === 'compact') root.classList.add('layout-preload-sidebar-compact');
    if (sidebarDock === 'right') root.classList.add('layout-preload-sidebar-right');

    root.style.setProperty('--sidebar-width', widthPx);
    if (sidebarDock === 'right') {
      root.style.setProperty('--content-area-left', '0px');
      root.style.setProperty('--content-area-right', widthPx);
    } else {
      root.style.setProperty('--content-area-left', widthPx);
      root.style.setProperty('--content-area-right', '0px');
    }

    try {
      const dockRaw = readStorage(floatingDockStorageKey);
      if (dockRaw) {
        const parsed = JSON.parse(dockRaw);
        if (parsed && parsed.edge) {
          const edge = String(parsed.edge).toLowerCase();
          if (['left', 'right', 'top', 'bottom'].includes(edge)) {
            root.classList.add('preload-canvas-floating-dock-' + edge);
            if (Number.isFinite(parsed.ratio)) {
              root.style.setProperty('--preload-canvas-floating-dock-ratio', String(parsed.ratio));
            }
          }
        }
      }
    } catch (_) { }

    document.addEventListener('DOMContentLoaded', () => {
      try {
        const body = document.body;
        if (body) {
          body.classList.toggle('header-compact', headerState === 'compact');
          body.classList.toggle('header-dock-bottom', headerDock === 'bottom');
          if (hasPendingNodeMaximizedState) {
            body.classList.add('canvas-node-maximized-active');
          }
        }

        root.classList.toggle('sidebar-on-right', sidebarDock === 'right');

        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
          sidebar.classList.toggle('compact', initialSidebarState === 'compact');
          sidebar.classList.remove('collapsed');
          sidebar.classList.toggle('position-right', sidebarDock === 'right');
          sidebar.dataset.position = sidebarDock;
          sidebar.dataset.collapseState = initialSidebarState;
          if (initialSidebarState === 'expanded') {
            sidebar.style.width = `${expandedWidth}px`;
          } else {
            sidebar.style.removeProperty('width');
          }
        }
      } catch (_) { }
    }, { once: true });

    root.classList.add('layout-preload-active');
  } catch (_) { }
})();
