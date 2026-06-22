// =============================================================================
// 全局变量和常量
// =============================================================================

let currentLang = 'zh_CN';
// [Init] Pick a reasonable default immediately (no async storage available yet):
// - browser UI is Chinese => zh_CN
// - otherwise => en
try {
    const ui = (chrome?.i18n?.getUILanguage?.() || '').toLowerCase();
    currentLang = ui.startsWith('zh') ? 'zh_CN' : 'en';
} catch (e) { }

window.currentLang = currentLang; // 暴露给其他模块使用
// 允许外部页面限制可用视图（拆分插件时使用）
const DEFAULT_VIEWS = ['canvas'];
const ALLOWED_VIEWS = (Array.isArray(window.__ALLOWED_VIEWS) && window.__ALLOWED_VIEWS.length)
    ? window.__ALLOWED_VIEWS
    : DEFAULT_VIEWS;
const DEFAULT_VIEW = (typeof window.__DEFAULT_VIEW === 'string' && ALLOWED_VIEWS.includes(window.__DEFAULT_VIEW))
    ? window.__DEFAULT_VIEW
    : ALLOWED_VIEWS[0];
const isViewAllowed = (view) => ALLOWED_VIEWS.includes(view);
let currentTheme = 'light';
// 从 localStorage 立即恢复视图，避免页面闪烁
// 从 URL 参数或 localStorage 恢复视图
let currentView = (() => {
    try {
        // 1. 优先尝试从 URL 参数获取
        // 注意：此时 window.location.search 可能已经可用
        const params = new URLSearchParams(window.location.search);
        const viewFromUrl = params.get('view');
        if (viewFromUrl) {
            ;
            return viewFromUrl;
        }

        // 2. 其次尝试从 localStorage 获取
        const saved = localStorage.getItem('lastActiveView');
        ;
        return saved || DEFAULT_VIEW;
    } catch (e) {
        console.error('[全局初始化] 读取视图失败:', e);
        return DEFAULT_VIEW;
    }
})();

const isSidePanelMode = (() => {
    try {
        const params = new URLSearchParams(window.location.search);
        const flag = params.get('sidepanel') || params.get('side_panel') || params.get('panel');
        return flag === '1' || flag === 'true';
    } catch (_) {
        return false;
    }
})();

if (isSidePanelMode) {
    const sidePanelFixedView = isViewAllowed('canvas') ? 'canvas' : DEFAULT_VIEW;
    currentView = sidePanelFixedView;
}

window.__SIDE_PANEL_MODE__ = isSidePanelMode;
try {
    if (isSidePanelMode && document && document.documentElement) {
        document.documentElement.classList.add('side-panel-mode');
    }
} catch (_) { }

const SIDE_PANEL_FLOATING_TOOLS_MODE_KEY = 'sidepanelFloatingToolsMode';
const CANVAS_FLOATING_TOOLS_MODE_KEY = 'canvasFloatingToolsMode';
const HEADER_LAYOUT_STORAGE_KEYS = isSidePanelMode
    ? {
        collapseState: 'sidepanelHeaderCollapseState',
        dockSide: 'sidepanelHeaderDockSide',
        compactLeftTop: 'sidepanelHeaderCompactToggleLeftTop',
        compactLeftBottom: 'sidepanelHeaderCompactToggleLeftBottom',
        compactLeftLegacy: 'sidepanelHeaderCompactToggleLeft',
        compactLeftMovedTop: 'sidepanelHeaderCompactToggleLeftMovedTop',
        compactLeftMovedBottom: 'sidepanelHeaderCompactToggleLeftMovedBottom'
    }
    : {
        collapseState: 'headerCollapseState',
        dockSide: 'headerDockSide',
        compactLeftTop: 'headerCompactToggleLeftTop',
        compactLeftBottom: 'headerCompactToggleLeftBottom',
        compactLeftLegacy: 'headerCompactToggleLeft',
        compactLeftMovedTop: 'headerCompactToggleLeftMovedTop',
        compactLeftMovedBottom: 'headerCompactToggleLeftMovedBottom'
    };
const HEADER_COLLAPSE_STATE_KEY = HEADER_LAYOUT_STORAGE_KEYS.collapseState;
const HEADER_DOCK_SIDE_KEY = HEADER_LAYOUT_STORAGE_KEYS.dockSide;
const HEADER_COMPACT_LEFT_TOP_KEY = HEADER_LAYOUT_STORAGE_KEYS.compactLeftTop;
const HEADER_COMPACT_LEFT_BOTTOM_KEY = HEADER_LAYOUT_STORAGE_KEYS.compactLeftBottom;
const HEADER_COMPACT_LEFT_KEY = HEADER_LAYOUT_STORAGE_KEYS.compactLeftLegacy;
const HEADER_COMPACT_LEFT_MOVED_TOP_KEY = HEADER_LAYOUT_STORAGE_KEYS.compactLeftMovedTop;
const HEADER_COMPACT_LEFT_MOVED_BOTTOM_KEY = HEADER_LAYOUT_STORAGE_KEYS.compactLeftMovedBottom;
const CANVAS_PAGE_FULLSCREEN_BRIDGE_ACTION = 'triggerCanvasPageFullscreenByTabId';
const CANVAS_PAGE_FULLSCREEN_BRIDGE_STORAGE_KEY = 'canvas_page_fullscreen_bridge_request_v1';
const CANVAS_PAGE_FULLSCREEN_BRIDGE_MAX_AGE_MS = 30000;
const CANVAS_PAGE_FULLSCREEN_STATE_STORAGE_KEY = 'canvas_page_fullscreen_state_v1';
const CANVAS_PAGE_FULLSCREEN_STATE_MAX_AGE_MS = 30000;
const CANVAS_NODE_LAST_MAXIMIZED_STORAGE_KEY = 'canvas-node-last-maximized-v1';
const QUICK_ADD_WINDOW_FOLDER_OPTION_STORAGE_KEY = 'quickAddWindowAsFolderV1';
const QUICK_ADD_BLANK_HEADING_OPTION_STORAGE_KEY = 'quickAddBlankHeadingV1';
const QUICK_ADD_INLINE_OPTION_STATES_STORAGE_KEY = 'quickAddInlineOptionStatesV1';
const CANVAS_LAST_MAXIMIZED_UPDATED_EVENT = 'canvas-last-maximized-node-updated';
const CANVAS_FLOATING_TOOLS_DOCK_KEY = isSidePanelMode
    ? 'sidepanelFloatingToolsDockV1'
    : 'canvasFloatingToolsDockV1';
const SIDE_PANEL_FLOATING_TOOLS_MODES = {
    NONE: 'none',
    HIDDEN: 'hidden',
    SHOWN: 'shown'
};
const CANVAS_FLOATING_DOCK_EDGES = ['left', 'right', 'top', 'bottom'];
const CANVAS_FLOATING_EDGE_MARGIN_PX = 10;
const CANVAS_FLOATING_EDGE_TRACK_INSET_PX = 120;
const CANVAS_FLOATING_DEFAULT_DOCK_EDGE = 'top';
const CANVAS_FLOATING_DEFAULT_DOCK_RATIO = 0;
const CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD = 8;
const CANVAS_FLOATING_HINT_HOLD_DELAY_MS = 160;
const CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD = 42;
const CANVAS_FLOATING_CORNER_SWITCH_THRESHOLD = 0.08;

let canvasFloatingToolsDockStateCache = null;
let canvasFloatingToolsDragSession = null;
let canvasFloatingToolsHintHoldTimer = null;
let suppressCanvasFloatingToolsToggleClick = false;
let canvasFloatingToolsResizeBound = false;

let currentHeaderState = 'expanded';
let currentHeaderDockSide = isSidePanelMode ? 'bottom' : 'top';
const LAYOUT_PRELOAD_CLASSES = [
    'layout-preload-active',
    'layout-preload-sidebar-compact',
    'layout-preload-sidebar-right',
    'layout-preload-header-compact',
    'layout-preload-header-dock-bottom',
    'layout-preload-node-maximized-active',
    'layout-preload-floating-hidden',
    'layout-preload-canvas-scrollbar-vertical-hidden',
    'layout-preload-canvas-scrollbar-horizontal-hidden'
];
let layoutPreloadCleared = false;

function clearLayoutPreloadState() {
    if (layoutPreloadCleared) return;
    try {
        if (currentView === 'canvas') {
            try {
                updateSidePanelFloatingToolsDisplay();
            } catch (_) { }
        }
        const root = document.documentElement;
        if (!root) return;
        LAYOUT_PRELOAD_CLASSES.forEach((name) => root.classList.remove(name));
    } catch (_) { }
    layoutPreloadCleared = true;
}

let canvasPreloadReleaseBound = false;
function bindCanvasPreloadRelease() {
    if (canvasPreloadReleaseBound) return;
    canvasPreloadReleaseBound = true;

    const releaseCanvasPreloadWhenReady = () => {
        const root = document.documentElement;
        if (!root || !root.classList.contains('layout-preload-node-maximized-active')) {
            window.setTimeout(() => {
                clearLayoutPreloadState();
            }, 80);
            return;
        }

        const startedAt = Date.now();
        let finished = false;

        const finish = (delayMs = 0) => {
            if (finished) return;
            finished = true;
            window.setTimeout(() => {
                clearLayoutPreloadState();
            }, delayMs);
        };

        const hasReadyMaximizedNode = () => {
            try {
                return !!document.querySelector('.canvas-node-maximized[data-fullscreen-preload-ready="true"][data-fullscreen-body-ready="true"]');
            } catch (_) {
                return !!document.querySelector('.canvas-node-maximized');
            }
        };

        const restorePendingMaximizedNode = () => {
            try {
                if (typeof window.__tryRestoreMaximizedNode === 'function') {
                    window.__tryRestoreMaximizedNode({ clearIfMissing: false });
                }
            } catch (_) { }
        };

        const tick = () => {
            if (finished) return;
            if (hasReadyMaximizedNode()) {
                finish(12);
                return;
            }

            restorePendingMaximizedNode();

            if (hasReadyMaximizedNode()) {
                finish(12);
                return;
            }

            if (Date.now() - startedAt >= 1400) {
                finish(0);
                return;
            }

            window.setTimeout(tick, 24);
        };

        window.addEventListener('canvas-maximized-node-ready', () => {
            if (!hasReadyMaximizedNode()) return;
            finish(12);
        }, { once: true });

        tick();
    };

    window.addEventListener('canvas-initial-layout-ready', () => {
        releaseCanvasPreloadWhenReady();
    }, { once: true });

    // 兜底：避免异常路径导致预置状态长期不释放
    window.setTimeout(() => {
        clearLayoutPreloadState();
    }, 3200);
}

function __shouldSuppressCanvasBootstrapRestoreInHistory(target) {
    try {
        if (currentView !== 'canvas') return false;
        return !!(typeof window.__shouldSuppressCanvasBootstrapRestore === 'function'
            && window.__shouldSuppressCanvasBootstrapRestore(target));
    } catch (_) {
        return false;
    }
}

function __isCanvasBodyScrollRestoreBlocked(body) {
    if (!body) return false;
    try {
        const until = parseInt(body.dataset && body.dataset.scrollRestoreBlockUntil ? body.dataset.scrollRestoreBlockUntil : '0', 10) || 0;
        if (until && Date.now() < until) return true;
    } catch (_) { }
    return __shouldSuppressCanvasBootstrapRestoreInHistory(body);
}
window.__isCanvasBodyScrollRestoreBlocked = __isCanvasBodyScrollRestoreBlocked;

function __scheduleCanvasBodyScrollRestoreInHistory(body, payload, options = {}) {
    if (!body || !payload || typeof payload !== 'object') return false;

    const target = options && options.target ? options.target : body;
    const suppressBootstrapRestore = __shouldSuppressCanvasBootstrapRestoreInHistory(target);

    if (typeof window.__scheduleCanvasBodyScrollRestore === 'function') {
        return !!window.__scheduleCanvasBodyScrollRestore(body, payload, Object.assign({}, options, {
            target,
            suppressBootstrapRestore
        }));
    }

    if (typeof payload.top === 'number') body.scrollTop = payload.top || 0;
    if (typeof payload.left === 'number') body.scrollLeft = payload.left || 0;
    return true;
}

function normalizeSidePanelFloatingToolsMode(mode) {
    return mode === SIDE_PANEL_FLOATING_TOOLS_MODES.NONE
        || mode === SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN
        || mode === SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN
        ? mode
        : SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN;
}

function getSidePanelFloatingToolsMode() {
    try {
        if (isSidePanelMode) {
            const savedMode = localStorage.getItem(SIDE_PANEL_FLOATING_TOOLS_MODE_KEY);
            if (savedMode) return normalizeSidePanelFloatingToolsMode(savedMode);
            return SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
        }

        const canvasMode = localStorage.getItem(CANVAS_FLOATING_TOOLS_MODE_KEY);
        if (canvasMode) return normalizeSidePanelFloatingToolsMode(canvasMode);
        return SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
    } catch (_) {
        return SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
    }
}

function setSidePanelFloatingToolsMode(mode) {
    let normalizedMode = normalizeSidePanelFloatingToolsMode(mode);
    if (!isSidePanelMode && normalizedMode === SIDE_PANEL_FLOATING_TOOLS_MODES.NONE) {
        normalizedMode = SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN;
    }

    try {
        if (isSidePanelMode) {
            __saveLocalStorageRaw(SIDE_PANEL_FLOATING_TOOLS_MODE_KEY, normalizedMode);
        } else {
            __saveLocalStorageRaw(CANVAS_FLOATING_TOOLS_MODE_KEY, normalizedMode);
        }
    } catch (_) { }
}

function applySidePanelFloatingToolsMode(mode) {
    const normalizedMode = normalizeSidePanelFloatingToolsMode(mode);
    setSidePanelFloatingToolsMode(normalizedMode);
    updateSidePanelFloatingToolsDisplay();
}

function updateFloatingToolsModeControlState() {
    const mode = getSidePanelFloatingToolsMode();
    document.querySelectorAll('.floating-tools-mode-switch').forEach((switchEl) => {
        switchEl.querySelectorAll('.floating-tools-mode-btn').forEach((btn) => {
            const isActive = btn.dataset.mode === mode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    });
}

function isSidePanelFloatingToolsVisible() {
    return getSidePanelFloatingToolsMode() === SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN;
}

function setSidePanelFloatingToolsVisible(visible) {
    setSidePanelFloatingToolsMode(
        visible ? SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN : SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN
    );
}

function clampCanvasFloatingValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeCanvasFloatingDockEdge(edge) {
    const value = String(edge || '').toLowerCase();
    return CANVAS_FLOATING_DOCK_EDGES.includes(value) ? value : 'top';
}

function normalizeCanvasFloatingDockRatio(ratio) {
    const value = Number(ratio);
    if (!Number.isFinite(value)) return 0;
    return clampCanvasFloatingValue(value, 0, 1);
}

function readCanvasFloatingToolsDockState() {
    if (canvasFloatingToolsDockStateCache) {
        return {
            edge: canvasFloatingToolsDockStateCache.edge,
            ratio: canvasFloatingToolsDockStateCache.ratio
        };
    }

    let parsed = null;
    try {
        const raw = localStorage.getItem(CANVAS_FLOATING_TOOLS_DOCK_KEY);
        if (raw) {
            parsed = JSON.parse(raw);
        }
    } catch (_) { }

    const hasParsedRatio = parsed && Number.isFinite(Number(parsed.ratio));
    const state = {
        edge: normalizeCanvasFloatingDockEdge(parsed && parsed.edge),
        ratio: hasParsedRatio
            ? normalizeCanvasFloatingDockRatio(parsed && parsed.ratio)
            : CANVAS_FLOATING_DEFAULT_DOCK_RATIO
    };

    if (!parsed || !parsed.edge) {
        state.edge = CANVAS_FLOATING_DEFAULT_DOCK_EDGE;
    }

    canvasFloatingToolsDockStateCache = state;
    return { edge: state.edge, ratio: state.ratio };
}

function writeCanvasFloatingToolsDockState(state) {
    const normalized = {
        edge: normalizeCanvasFloatingDockEdge(state && state.edge),
        ratio: normalizeCanvasFloatingDockRatio(state && state.ratio)
    };

    canvasFloatingToolsDockStateCache = normalized;
    try {
        __saveLocalStorageJSON(CANVAS_FLOATING_TOOLS_DOCK_KEY, normalized);
    } catch (_) { }
    return { edge: normalized.edge, ratio: normalized.ratio };
}

function cacheCanvasFloatingToolsDockState(state) {
    const normalized = {
        edge: normalizeCanvasFloatingDockEdge(state && state.edge),
        ratio: normalizeCanvasFloatingDockRatio(state && state.ratio)
    };
    canvasFloatingToolsDockStateCache = normalized;
    return { edge: normalized.edge, ratio: normalized.ratio };
}

function getCanvasFloatingToolsWorkspaceRect() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return null;
    const rect = workspace.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
        return null;
    }
    return rect;
}

function getCanvasFloatingToolsIndicatorSize(mode) {
    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    const miniToggle = document.getElementById('canvasFloatingToggleMini');
    if (!zoomIndicator) {
        return {
            width: 0,
            height: 0
        };
    }

    if (mode === SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN) {
        if (miniToggle) {
            const rect = miniToggle.getBoundingClientRect();
            if (rect && Number.isFinite(rect.width) && rect.width > 0 && Number.isFinite(rect.height) && rect.height > 0) {
                return {
                    width: rect.width,
                    height: rect.height
                };
            }
        }
        return {
            width: 24,
            height: 32
        };
    }

    const rect = zoomIndicator.getBoundingClientRect();
    const width = rect && Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 250;
    const height = rect && Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 84;
    return { width, height };
}

function buildCanvasFloatingHorizontalTrack(minX, maxX, restrictMiddle) {
    const safeMin = Math.min(minX, maxX);
    const safeMax = Math.max(minX, maxX);
    const available = Math.max(0, safeMax - safeMin);

    if (!restrictMiddle || available <= 0) {
        return {
            segmented: false,
            minX: safeMin,
            maxX: safeMax,
            available
        };
    }

    const segmentLength = Math.min(CANVAS_FLOATING_EDGE_TRACK_INSET_PX, available / 2);
    if (segmentLength <= 0) {
        return {
            segmented: false,
            minX: safeMin,
            maxX: safeMax,
            available
        };
    }

    const leftEnd = safeMin + segmentLength;
    const rightStart = safeMax - segmentLength;
    if (rightStart <= leftEnd) {
        return {
            segmented: false,
            minX: safeMin,
            maxX: safeMax,
            available
        };
    }

    return {
        segmented: true,
        minX: safeMin,
        maxX: safeMax,
        available,
        segmentLength,
        leftEnd,
        rightStart,
        totalLength: segmentLength * 2
    };
}

function getCanvasFloatingTrackXByRatio(track, ratio) {
    const safeRatio = normalizeCanvasFloatingDockRatio(ratio);
    if (!track.segmented) {
        if (track.available <= 0) return track.minX;
        return track.minX + (track.available * safeRatio);
    }

    const totalLength = track.totalLength;
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
        return track.minX;
    }

    const progress = safeRatio * totalLength;
    if (progress <= track.segmentLength) {
        return track.minX + progress;
    }

    return track.rightStart + (progress - track.segmentLength);
}

function getCanvasFloatingTrackRatioByX(track, x) {
    if (!track.segmented) {
        if (track.available <= 0) return 0;
        const clampedX = clampCanvasFloatingValue(x, track.minX, track.maxX);
        return normalizeCanvasFloatingDockRatio((clampedX - track.minX) / track.available);
    }

    const xSafe = Number.isFinite(x) ? x : track.minX;
    const leftDistance = xSafe < track.minX
        ? (track.minX - xSafe)
        : (xSafe > track.leftEnd ? (xSafe - track.leftEnd) : 0);
    const rightDistance = xSafe < track.rightStart
        ? (track.rightStart - xSafe)
        : (xSafe > track.maxX ? (xSafe - track.maxX) : 0);

    const pickLeft = leftDistance <= rightDistance;
    let progress = 0;

    if (pickLeft) {
        const leftX = clampCanvasFloatingValue(xSafe, track.minX, track.leftEnd);
        progress = leftX - track.minX;
    } else {
        const rightX = clampCanvasFloatingValue(xSafe, track.rightStart, track.maxX);
        progress = track.segmentLength + (rightX - track.rightStart);
    }

    if (!Number.isFinite(track.totalLength) || track.totalLength <= 0) return 0;
    return normalizeCanvasFloatingDockRatio(progress / track.totalLength);
}

function resolveCanvasFloatingIndicatorPosition(state, options = {}) {
    const mode = normalizeSidePanelFloatingToolsMode(options.mode || getSidePanelFloatingToolsMode());
    const dock = {
        edge: normalizeCanvasFloatingDockEdge(state && state.edge),
        ratio: normalizeCanvasFloatingDockRatio(state && state.ratio)
    };

    const workspaceRect = getCanvasFloatingToolsWorkspaceRect();
    if (!workspaceRect) return null;

    const indicatorSize = getCanvasFloatingToolsIndicatorSize(mode);
    const margin = CANVAS_FLOATING_EDGE_MARGIN_PX;
    const maxLeft = Math.max(margin, workspaceRect.width - indicatorSize.width - margin);
    const minLeft = margin;
    const maxTop = Math.max(margin, workspaceRect.height - indicatorSize.height - margin);
    const minTop = margin;

    let left = minLeft;
    let top = minTop;

    if (dock.edge === 'left') {
        left = minLeft;
        top = minTop + ((maxTop - minTop) * dock.ratio);
    } else if (dock.edge === 'right') {
        left = maxLeft;
        top = minTop + ((maxTop - minTop) * dock.ratio);
    } else if (dock.edge === 'top' || dock.edge === 'bottom') {
        const track = buildCanvasFloatingHorizontalTrack(minLeft, maxLeft, false);
        left = getCanvasFloatingTrackXByRatio(track, dock.ratio);
        top = dock.edge === 'top' ? minTop : maxTop;
    }

    return {
        edge: dock.edge,
        ratio: dock.ratio,
        left: clampCanvasFloatingValue(left, minLeft, maxLeft),
        top: clampCanvasFloatingValue(top, minTop, maxTop)
    };
}

function applyCanvasFloatingToolsDockState(state, options = {}) {
    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    if (!zoomIndicator) {
        if (options && options.persist === true) {
            return writeCanvasFloatingToolsDockState(state);
        }
        return cacheCanvasFloatingToolsDockState(state);
    }

    const mode = normalizeSidePanelFloatingToolsMode(options.mode || getSidePanelFloatingToolsMode());
    const position = resolveCanvasFloatingIndicatorPosition(state, { mode });
    const normalized = {
        edge: normalizeCanvasFloatingDockEdge(position ? position.edge : (state && state.edge)),
        ratio: normalizeCanvasFloatingDockRatio(position ? position.ratio : (state && state.ratio))
    };

    if (position) {
        zoomIndicator.style.left = `${position.left}px`;
        zoomIndicator.style.top = `${position.top}px`;
    }
    zoomIndicator.dataset.dockEdge = normalized.edge;

    if (options && options.persist === true) {
        return writeCanvasFloatingToolsDockState(normalized);
    }
    return cacheCanvasFloatingToolsDockState(normalized);
}

function resolveCanvasFloatingDockStateFromPointer(clientX, clientY, options = {}) {
    const mode = normalizeSidePanelFloatingToolsMode(options.mode || getSidePanelFloatingToolsMode());
    const workspaceRect = getCanvasFloatingToolsWorkspaceRect();
    if (!workspaceRect) return null;

    const indicatorSize = getCanvasFloatingToolsIndicatorSize(mode);
    const margin = CANVAS_FLOATING_EDGE_MARGIN_PX;
    const maxLeft = Math.max(margin, workspaceRect.width - indicatorSize.width - margin);
    const minLeft = margin;
    const maxTop = Math.max(margin, workspaceRect.height - indicatorSize.height - margin);
    const minTop = margin;

    const localX = clampCanvasFloatingValue(clientX - workspaceRect.left, 0, workspaceRect.width);
    const localY = clampCanvasFloatingValue(clientY - workspaceRect.top, 0, workspaceRect.height);

    const edgeDistances = [
        { edge: 'left', distance: localX },
        { edge: 'right', distance: Math.abs(workspaceRect.width - localX) },
        { edge: 'top', distance: localY },
        { edge: 'bottom', distance: Math.abs(workspaceRect.height - localY) }
    ];
    edgeDistances.sort((a, b) => a.distance - b.distance);

    let edge = normalizeCanvasFloatingDockEdge(options.forcedEdge || '');
    if (!options.forcedEdge) {
        edge = edgeDistances[0].edge;
        const preferredEdge = normalizeCanvasFloatingDockEdge(options.currentEdge);
        const preferredMatch = edgeDistances.find(item => item.edge === preferredEdge);
        if (preferredMatch && (preferredMatch.distance - edgeDistances[0].distance) <= 10) {
            edge = preferredEdge;
        }
    }

    let ratio = 0;
    if (edge === 'left' || edge === 'right') {
        const trackHeight = Math.max(0, maxTop - minTop);
        if (trackHeight > 0) {
            ratio = normalizeCanvasFloatingDockRatio((clampCanvasFloatingValue(localY, minTop, maxTop) - minTop) / trackHeight);
        }
    } else {
        const track = buildCanvasFloatingHorizontalTrack(minLeft, maxLeft, false);
        ratio = getCanvasFloatingTrackRatioByX(track, localX);
    }

    return {
        edge,
        ratio
    };
}

function isCanvasFloatingNearTopOrBottomCorner(edge, ratio) {
    const safeEdge = normalizeCanvasFloatingDockEdge(edge);
    const safeRatio = normalizeCanvasFloatingDockRatio(ratio);
    if (safeEdge !== 'left' && safeEdge !== 'right') return false;
    const thresholdRatio = normalizeCanvasFloatingDockRatio(CANVAS_FLOATING_CORNER_SWITCH_THRESHOLD);
    return safeRatio <= thresholdRatio || safeRatio >= (1 - thresholdRatio);
}

function isCanvasFloatingNearLeftOrRightCorner(edge, ratio) {
    const safeEdge = normalizeCanvasFloatingDockEdge(edge);
    const safeRatio = normalizeCanvasFloatingDockRatio(ratio);
    if (safeEdge !== 'top' && safeEdge !== 'bottom') return false;
    const thresholdRatio = normalizeCanvasFloatingDockRatio(CANVAS_FLOATING_CORNER_SWITCH_THRESHOLD);
    return safeRatio <= thresholdRatio || safeRatio >= (1 - thresholdRatio);
}

function getCanvasFloatingDragButtons() {
    const miniToggle = document.getElementById('canvasFloatingToggleMini');
    const inlineToggleBtn = document.getElementById('canvasFloatingToolsToggleBtn');
    return [miniToggle, inlineToggleBtn].filter(Boolean);
}

function ensureCanvasFloatingDragHints(btn) {
    if (!btn) return;
    const hintDefs = [
        { className: 'canvas-floating-drag-hint canvas-floating-drag-hint-up', selector: '.canvas-floating-drag-hint-up' },
        { className: 'canvas-floating-drag-hint canvas-floating-drag-hint-down', selector: '.canvas-floating-drag-hint-down' },
        { className: 'canvas-floating-drag-hint canvas-floating-drag-hint-left', selector: '.canvas-floating-drag-hint-left' },
        { className: 'canvas-floating-drag-hint canvas-floating-drag-hint-right', selector: '.canvas-floating-drag-hint-right' }
    ];

    hintDefs.forEach((def) => {
        let hint = btn.querySelector(def.selector);
        if (!hint) {
            hint = document.createElement('span');
            hint.className = def.className;
            hint.setAttribute('aria-hidden', 'true');
            btn.appendChild(hint);
        }
    });
}

function clearCanvasFloatingHintHoldTimer() {
    if (canvasFloatingToolsHintHoldTimer == null) return;
    window.clearTimeout(canvasFloatingToolsHintHoldTimer);
    canvasFloatingToolsHintHoldTimer = null;
}

function setCanvasFloatingDragGuide(edge) {
    const normalized = edge === 'up' || edge === 'down' || edge === 'left' || edge === 'right'
        ? edge
        : '';
    const buttons = getCanvasFloatingDragButtons();
    buttons.forEach((btn) => {
        if (!btn) return;
        if (canvasFloatingToolsDragSession && btn === canvasFloatingToolsDragSession.sourceBtn && normalized) {
            btn.dataset.dragGuide = normalized;
        } else {
            delete btn.dataset.dragGuide;
        }
    });
}

function getCanvasFloatingAllowedDragDirections(edge) {
    return new Set(['left', 'right', 'up', 'down']);
}

function getCanvasFloatingDragGuideDirection(dx, dy, edge) {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD && absDy < CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) {
        return null;
    }

    const primary = absDx >= absDy
        ? (dx >= 0 ? 'right' : 'left')
        : (dy >= 0 ? 'down' : 'up');

    const allowed = getCanvasFloatingAllowedDragDirections(edge);
    if (allowed.has(primary)) return primary;
    return null;
}

function getCanvasFloatingGuideDirectionAtCurrentDock(dx, dy, dockState) {
    const edge = normalizeCanvasFloatingDockEdge(dockState && dockState.edge);
    const ratio = normalizeCanvasFloatingDockRatio(dockState && dockState.ratio);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDx < CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD && absDy < CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) {
        return null;
    }

    if (edge === 'left' || edge === 'right') {
        const movingHorizontal = absDx >= absDy && absDx >= CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD;
        if (movingHorizontal) {
            return dx >= 0 ? 'right' : 'left';
        }
        return dy >= 0 ? 'down' : 'up';
    }

    if (edge === 'top' || edge === 'bottom') {
        const movingVertical = absDy > absDx && absDy >= CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD;
        if (movingVertical) {
            return dy >= 0 ? 'down' : 'up';
        }
        return dx >= 0 ? 'right' : 'left';
    }

    return getCanvasFloatingDragGuideDirection(dx, dy, edge);
}

function resolveCanvasFloatingAdjacentEdgeFromCorner(currentEdge, ratio, dx, dy) {
    const edge = normalizeCanvasFloatingDockEdge(currentEdge);
    const safeRatio = normalizeCanvasFloatingDockRatio(ratio);
    const nearStart = safeRatio <= CANVAS_FLOATING_CORNER_SWITCH_THRESHOLD;
    const nearEnd = safeRatio >= (1 - CANVAS_FLOATING_CORNER_SWITCH_THRESHOLD);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (edge === 'left' || edge === 'right') {
        const towardInner = edge === 'left' ? dx > 0 : dx < 0;

        // Allow sliding along perimeter (up/down past corners)
        if (nearStart && dy < -CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) return 'top';
        if (nearEnd && dy > CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) return 'bottom';

        if (!towardInner || absDx < CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD || absDx < absDy) return null;
        if (nearStart) return 'top';
        if (nearEnd) return 'bottom';
        return null;
    }

    if (edge === 'top' || edge === 'bottom') {
        const towardInner = edge === 'top' ? dy > 0 : dy < 0;

        // Allow sliding along perimeter (left/right past corners)
        if (nearStart && dx < -CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) return 'left';
        if (nearEnd && dx > CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) return 'right';

        if (!towardInner || absDy < CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD || absDy <= absDx) return null;
        if (nearStart) return 'left';
        if (nearEnd) return 'right';
        return null;
    }

    return null;
}

function resolveCanvasFloatingFinalEdgeFromRelease(edge, dx, dy) {
    const currentEdge = normalizeCanvasFloatingDockEdge(edge);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const horizontalDominant = absDx >= absDy;

    // Only switch if dragging AWAY from the current edge.
    // If we have already moved dragging to the new edge (e.g. Left -> Right),
    // currentEdge will be 'right', and dx will be positive. We should NOT switch back to left.

    if (currentEdge === 'left') {
        if (horizontalDominant && dx >= CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD) return 'right';
        return 'left';
    }
    if (currentEdge === 'right') {
        if (horizontalDominant && dx <= -CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD) return 'left';
        return 'right';
    }
    if (currentEdge === 'top') {
        if (!horizontalDominant && dy >= CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD) return 'bottom';
        return 'top';
    }
    if (currentEdge === 'bottom') {
        if (!horizontalDominant && dy <= -CANVAS_FLOATING_DRAG_SWITCH_THRESHOLD) return 'top';
        return 'bottom';
    }

    return currentEdge;
}

function resolveCanvasFloatingFinalDockStateOnRelease(event, dragSession, dx, dy) {
    const current = dragSession && dragSession.currentDockState
        ? dragSession.currentDockState
        : { edge: 'top', ratio: 0 };
    const targetEdge = resolveCanvasFloatingFinalEdgeFromRelease(current.edge, dx, dy);
    const targetX = event.clientX - (dragSession.dragOffsetX || 0);
    const targetY = event.clientY - (dragSession.dragOffsetY || 0);

    const next = resolveCanvasFloatingDockStateFromPointer(targetX, targetY, {
        mode: dragSession ? dragSession.mode : undefined,
        currentEdge: targetEdge,
        forcedEdge: targetEdge
    });
    if (!next) {
        return {
            edge: normalizeCanvasFloatingDockEdge(targetEdge),
            ratio: normalizeCanvasFloatingDockRatio(current.ratio)
        };
    }
    return next;
}

function resolveCanvasFloatingDockStateDuringDrag(event, dragSession, dx, dy) {
    const current = dragSession && dragSession.currentDockState
        ? dragSession.currentDockState
        : { edge: 'top', ratio: 0 };
    const edge = normalizeCanvasFloatingDockEdge(current.edge);
    const ratio = normalizeCanvasFloatingDockRatio(current.ratio);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    let forcedEdge = edge;
    const adjacent = resolveCanvasFloatingAdjacentEdgeFromCorner(edge, ratio, dx, dy);
    if (adjacent) {
        forcedEdge = adjacent;
    }

    const targetX = event.clientX - (dragSession.dragOffsetX || 0);
    const targetY = event.clientY - (dragSession.dragOffsetY || 0);

    const next = resolveCanvasFloatingDockStateFromPointer(targetX, targetY, {
        mode: dragSession ? dragSession.mode : undefined,
        currentEdge: forcedEdge,
        forcedEdge
    });

    if (!next) {
        return {
            edge: forcedEdge,
            ratio
        };
    }
    return next;
}

function setCanvasFloatingHoldVisualActive(active) {
    if (!canvasFloatingToolsDragSession || !canvasFloatingToolsDragSession.sourceBtn) return;
    canvasFloatingToolsDragSession.sourceBtn.classList.toggle('canvas-floating-hold-active', active === true);
}

function scheduleCanvasFloatingHintReveal() {
    clearCanvasFloatingHintHoldTimer();
    canvasFloatingToolsHintHoldTimer = window.setTimeout(() => {
        canvasFloatingToolsHintHoldTimer = null;
        if (!canvasFloatingToolsDragSession || !canvasFloatingToolsDragSession.sourceBtn) return;
        canvasFloatingToolsDragSession.sourceBtn.classList.add('canvas-floating-show-hints');
        setCanvasFloatingHoldVisualActive(true);
    }, CANVAS_FLOATING_HINT_HOLD_DELAY_MS);
}

function clearCanvasFloatingDragVisualState() {
    const buttons = getCanvasFloatingDragButtons();
    buttons.forEach((btn) => {
        if (!btn) return;
        btn.classList.remove('canvas-floating-show-hints');
        btn.classList.remove('canvas-floating-hold-active');
        btn.classList.remove('canvas-floating-dragging');
        delete btn.dataset.dragGuide;
    });

    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    if (zoomIndicator) {
        zoomIndicator.classList.remove('canvas-floating-dragging');
    }
}

function clearCanvasFloatingToolsDragSession() {
    clearCanvasFloatingHintHoldTimer();
    if (!canvasFloatingToolsDragSession) {
        clearCanvasFloatingDragVisualState();
        return;
    }

    const { sourceBtn, pointerId } = canvasFloatingToolsDragSession;
    try {
        if (sourceBtn && sourceBtn.hasPointerCapture(pointerId)) {
            sourceBtn.releasePointerCapture(pointerId);
        }
    } catch (_) { }

    canvasFloatingToolsDragSession = null;
    clearCanvasFloatingDragVisualState();
}

function beginCanvasFloatingToolsDrag(event, sourceBtn, mode) {
    if (!sourceBtn) return;
    if (event.button !== 0) return;

    clearCanvasFloatingToolsDragSession();
    ensureCanvasFloatingDragHints(sourceBtn);

    const initialState = readCanvasFloatingToolsDockState();
    canvasFloatingToolsDragSession = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        sourceBtn,
        mode,
        currentDockState: {
            edge: initialState.edge,
            ratio: initialState.ratio
        }
    };
    sourceBtn.dataset.dockEdge = initialState.edge;

    let dragOffsetX = 0;
    let dragOffsetY = 0;
    try {
        const zoomIndicator = document.getElementById('canvasZoomIndicator');
        if (zoomIndicator) {
            const rect = zoomIndicator.getBoundingClientRect();
            dragOffsetX = event.clientX - rect.left;
            dragOffsetY = event.clientY - rect.top;
        } else {
            // Fallback to button if indicator not found (unlikely)
            const rect = sourceBtn.getBoundingClientRect();
            dragOffsetX = event.clientX - rect.left;
            dragOffsetY = event.clientY - rect.top;
        }
    } catch (_) { }

    canvasFloatingToolsDragSession.dragOffsetX = dragOffsetX;
    canvasFloatingToolsDragSession.dragOffsetY = dragOffsetY;

    try {
        sourceBtn.setPointerCapture(event.pointerId);
    } catch (_) { }

    sourceBtn.classList.remove('canvas-floating-show-hints');
    sourceBtn.classList.remove('canvas-floating-hold-active');
    sourceBtn.classList.remove('canvas-floating-dragging');
    setCanvasFloatingDragGuide(null);
    scheduleCanvasFloatingHintReveal();
    event.preventDefault();
}

function handleCanvasFloatingToolsDragMove(event) {
    if (!canvasFloatingToolsDragSession || event.pointerId !== canvasFloatingToolsDragSession.pointerId) return;

    const dx = event.clientX - canvasFloatingToolsDragSession.startX;
    const dy = event.clientY - canvasFloatingToolsDragSession.startY;
    const dragDistance = Math.hypot(dx, dy);

    if (!canvasFloatingToolsDragSession.moved && dragDistance >= CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD) {
        canvasFloatingToolsDragSession.moved = true;
        clearCanvasFloatingHintHoldTimer();
        canvasFloatingToolsDragSession.sourceBtn.classList.add('canvas-floating-show-hints');
        canvasFloatingToolsDragSession.sourceBtn.classList.add('canvas-floating-hold-active');
        canvasFloatingToolsDragSession.sourceBtn.classList.add('canvas-floating-dragging');
        const zoomIndicator = document.getElementById('canvasZoomIndicator');
        if (zoomIndicator) {
            zoomIndicator.classList.add('canvas-floating-dragging');
        }
    }

    if (!canvasFloatingToolsDragSession.moved) return;

    const nextState = resolveCanvasFloatingDockStateDuringDrag(
        event,
        canvasFloatingToolsDragSession,
        dx,
        dy
    );

    if (nextState) {
        const applied = applyCanvasFloatingToolsDockState(nextState, {
            persist: false,
            mode: canvasFloatingToolsDragSession.mode
        });
        canvasFloatingToolsDragSession.currentDockState = {
            edge: applied.edge,
            ratio: applied.ratio
        };
        canvasFloatingToolsDragSession.sourceBtn.dataset.dockEdge = applied.edge;
        setCanvasFloatingDragGuide(getCanvasFloatingGuideDirectionAtCurrentDock(dx, dy, applied));
    }

    event.preventDefault();
    event.stopPropagation();
}

function finishCanvasFloatingToolsDrag(event, canceled) {
    if (!canvasFloatingToolsDragSession || event.pointerId !== canvasFloatingToolsDragSession.pointerId) return;

    const dx = event.clientX - canvasFloatingToolsDragSession.startX;
    const dy = event.clientY - canvasFloatingToolsDragSession.startY;
    const dragDistance = Math.hypot(dx, dy);
    const moved = canvasFloatingToolsDragSession.moved || dragDistance >= CANVAS_FLOATING_DRAG_ACTIVATE_THRESHOLD;
    let consumed = false;

    if (!canceled && moved) {
        const finalState = resolveCanvasFloatingFinalDockStateOnRelease(
            event,
            canvasFloatingToolsDragSession,
            dx,
            dy
        );

        if (finalState) {
            applyCanvasFloatingToolsDockState(finalState, {
                persist: true,
                mode: canvasFloatingToolsDragSession.mode
            });
            consumed = true;
        }
    }

    clearCanvasFloatingToolsDragSession();

    if (consumed) {
        suppressCanvasFloatingToolsToggleClick = true;
        window.setTimeout(() => {
            suppressCanvasFloatingToolsToggleClick = false;
        }, 0);
    }
}

function bindCanvasFloatingToolsGlobalDragEvents() {
    if (document.documentElement.hasAttribute('data-canvas-floating-global-drag-bound')) return;
    document.documentElement.setAttribute('data-canvas-floating-global-drag-bound', 'true');

    document.addEventListener('pointermove', handleCanvasFloatingToolsDragMove, true);
    document.addEventListener('pointerup', (event) => {
        finishCanvasFloatingToolsDrag(event, false);
    }, true);
    document.addEventListener('pointercancel', (event) => {
        finishCanvasFloatingToolsDrag(event, true);
    }, true);
}

function bindCanvasFloatingToolsResizeHandler() {
    if (canvasFloatingToolsResizeBound) return;
    canvasFloatingToolsResizeBound = true;
    window.addEventListener('resize', () => {
        if (currentView !== 'canvas') return;
        applyCanvasFloatingToolsDockState(readCanvasFloatingToolsDockState(), { persist: false });
    });
}

function updateSidePanelFloatingToolsDisplay() {
    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    const miniToggle = document.getElementById('canvasFloatingToggleMini');
    const inlinePanel = document.getElementById('canvasFloatingToolsPanel');
    const inlineToggleBtn = document.getElementById('canvasFloatingToolsToggleBtn');
    const mode = getSidePanelFloatingToolsMode();
    const inCanvasView = currentView === 'canvas';

    if (zoomIndicator) {
        const shouldShowMain = inCanvasView && mode !== SIDE_PANEL_FLOATING_TOOLS_MODES.NONE;
        zoomIndicator.style.display = shouldShowMain ? 'block' : 'none';
        zoomIndicator.classList.toggle('floating-tools-collapsed', mode === SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN);
        zoomIndicator.dataset.floatingMode = mode;
    }

    if (miniToggle) {
        const shouldAttachMini = inCanvasView && mode !== SIDE_PANEL_FLOATING_TOOLS_MODES.NONE;
        miniToggle.style.display = shouldAttachMini ? 'inline-flex' : 'none';
    }

    if ((!inCanvasView || mode !== SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN) && inlinePanel && !inlinePanel.hasAttribute('hidden')) {
        inlinePanel.setAttribute('hidden', '');
    }
    if (inlineToggleBtn && (!inCanvasView || mode !== SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN)) {
        inlineToggleBtn.setAttribute('aria-expanded', 'false');
    }

    if (inCanvasView && mode !== SIDE_PANEL_FLOATING_TOOLS_MODES.NONE) {
        applyCanvasFloatingToolsDockState(readCanvasFloatingToolsDockState(), {
            persist: false,
            mode
        });
    }

    if ((!inCanvasView || mode === SIDE_PANEL_FLOATING_TOOLS_MODES.NONE) && canvasFloatingToolsDragSession) {
        clearCanvasFloatingToolsDragSession();
    }

    updateFloatingToolsModeControlState();
}

// 用于避免重复在一次快照后多次重置（基于最近一条记录的指纹或时间）
window.__lastResetFingerprint = window.__lastResetFingerprint || null;

// 用于标记由拖拽操作处理过的移动，防止 applyIncrementalMoveToTree 重复处理
window.__dragMoveHandled = window.__dragMoveHandled || new Set();

let bookmarkBulkMuteDepth = 0;
let bookmarkBulkMuteReason = '';
let bookmarkBulkNeedsRefresh = false;
let bookmarkBulkMuteIgnoreUntil = 0;
const BULK_BOOKMARK_POST_EVENT_GRACE_MS = 1800;

function isBookmarkBulkMuteRenderingBlocked() {
    return bookmarkBulkMuteDepth > 0;
}

function isBookmarkBulkMuteActive() {
    return bookmarkBulkMuteDepth > 0 || Date.now() < bookmarkBulkMuteIgnoreUntil;
}

function clearBookmarkBulkQueuedEvents() {
    try {
        if (pendingBookmarkMutationTimer) {
            clearTimeout(pendingBookmarkMutationTimer);
            pendingBookmarkMutationTimer = null;
        }
    } catch (_) { }
    try { pendingBookmarkMutationEvents = []; } catch (_) { }
    try { bookmarkMutationFlushQueued = false; } catch (_) { }
}

function noteBookmarkBulkMutation(reason = '') {
    bookmarkBulkNeedsRefresh = true;
    if (reason) {
        bookmarkBulkMuteReason = String(reason);
    }
}

async function beginBookmarkBulkMute(reason = 'bulk-bookmark-operation', options = {}) {
    const normalizedReason = String(reason || 'bulk-bookmark-operation');
    bookmarkBulkMuteDepth += 1;
    bookmarkBulkMuteReason = normalizedReason;
    if (options.needsRefresh !== false) {
        bookmarkBulkNeedsRefresh = true;
    }
    bookmarkBulkMuteIgnoreUntil = 0;
    if (bookmarkBulkMuteDepth === 1) {
        clearBookmarkBulkQueuedEvents();
        try { clearCanvasLazyChangeHints('bulk-bookmark-begin'); } catch (_) { }
    }
    return { active: true, depth: bookmarkBulkMuteDepth, reason: normalizedReason };
}

async function endBookmarkBulkMute(reason = '', options = {}) {
    if (bookmarkBulkMuteDepth > 0) {
        bookmarkBulkMuteDepth -= 1;
    }
    const normalizedReason = String(reason || bookmarkBulkMuteReason || 'bulk-bookmark-operation');
    if (bookmarkBulkMuteDepth > 0) {
        ;
        return { active: true, depth: bookmarkBulkMuteDepth, reason: normalizedReason };
    }

    const hadBulkMutations = bookmarkBulkNeedsRefresh;
    const shouldRefreshTree = options.refreshTree !== false && hadBulkMutations;

    bookmarkBulkMuteReason = '';
    bookmarkBulkNeedsRefresh = false;
    clearBookmarkBulkQueuedEvents();

    if (shouldRefreshTree) {
        cachedTreeData = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        await renderTreeView(true);
    }

    if (hadBulkMutations) {
        bookmarkBulkMuteIgnoreUntil = Date.now() + BULK_BOOKMARK_POST_EVENT_GRACE_MS;
    }
    return {
        active: false,
        depth: 0,
        reason: normalizedReason,
        refreshed: shouldRefreshTree,
        mutated: hadBulkMutations
    };
}

async function applyPermanentBookmarkEventsToDomIncremental(events, options = {}) {
    if (!events || !events.length) return false;
    let allPatched = true;
    for (const event of events) {
        if (event.type === 'created') {
            const id = event.id;
            const bookmark = event.bookmark;
            addBookmarkToCache(bookmark);
            const appliedToCachedTree = applyIncrementalCreateToCachedCurrentTree(id, bookmark);
            if (appliedToCachedTree) {
                refreshPermanentSharedSourceAfterDomPatch('create');
                const domPatched = applyPermanentCreateDomPatch(id, bookmark);
                if (!domPatched) allPatched = false;
            } else {
                allPatched = false;
            }
        } else if (event.type === 'removed') {
            const id = event.id;
            const removeInfo = event.removeInfo || { parentId: event.parentId, index: event.index };
            removeBookmarkFromCache(id, removeInfo);
            const appliedToCachedTree = applyIncrementalRemoveFromCachedCurrentTree(id, removeInfo);
            if (appliedToCachedTree) {
                refreshPermanentSharedSourceAfterDomPatch('remove');
                const domPatched = applyPermanentRemoveDomPatch(id, removeInfo);
                if (!domPatched) allPatched = false;
            } else {
                allPatched = false;
            }
        } else if (event.type === 'moved') {
            const id = event.id;
            const moveInfo = event.moveInfo || { parentId: event.parentId, index: event.index, oldParentId: event.oldParentId, oldIndex: event.oldIndex };
            moveBookmarkInCache(id, moveInfo);
            const appliedToCachedTree = applyIncrementalMoveToCachedCurrentTree(id, moveInfo);
            if (appliedToCachedTree) {
                refreshPermanentSharedSourceAfterDomPatch('move');
                const domPatched = applyPermanentMoveDomPatch(id, moveInfo);
                if (!domPatched) allPatched = false;
            } else {
                allPatched = false;
            }
        } else if (event.type === 'changed') {
            const id = event.id;
            const changeInfo = event.changeInfo;
            updateBookmarkInCache(id, changeInfo);
            const appliedToCachedTree = applyIncrementalChangeToCachedCurrentTree(id, changeInfo);
            if (appliedToCachedTree) {
                refreshPermanentSharedSourceAfterDomPatch('change');
                const domPatched = applyPermanentChangeDomPatch(id, changeInfo);
                if (!domPatched) allPatched = false;
            } else {
                allPatched = false;
            }
        }
    }
    if (allPatched) {
        const skipSnapshotRefresh = !!(options && options.skipSnapshotRefresh === true);
        if (skipSnapshotRefresh) return true;
        scheduleCachedCurrentTreeSnapshotRefresh('bulk-dom-patch-success', 40);
        return true;
    } else {
        const allowFallbackRender = !(options && options.allowFallbackRender === false);
        if (!allowFallbackRender) return false;
        cachedTreeData = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        await renderTreeView(true);
        return false;
    }
}

if (typeof window !== 'undefined') {
    window.__applyPermanentBookmarkEventsToDomIncremental = applyPermanentBookmarkEventsToDomIncremental;
}

async function flushPermanentBookmarkEventsAfterBulk(events, reason) {
    if (!events || !events.length) return;
    const bridge = getPermanentMutationBridgeForHistory();
    if (!bridge) return;
    if (events.length >= BULK_BOOKMARK_MUTATION_THRESHOLD) {
        if (typeof bridge.syncPermanentMainTreeFromChromeBookmarks === 'function') {
            await bridge.syncPermanentMainTreeFromChromeBookmarks({
                assumeClean: false,
                reason: reason || 'bulk-flush-full'
            });
        }
        bookmarkBulkNeedsRefresh = true;
    } else {
        await applyPermanentBookmarkEventsToBcsIncremental(events, reason || 'bulk-flush-incremental');
        const domPatched = await applyPermanentBookmarkEventsToDomIncremental(events);
        if (domPatched) {
            bookmarkBulkNeedsRefresh = false;
        } else {
            bookmarkBulkNeedsRefresh = true;
        }
    }
}

window.__canvasBookmarkBulkMode = {
    begin: beginBookmarkBulkMute,
    end: endBookmarkBulkMute,
    isActive: isBookmarkBulkMuteActive,
    isRenderingBlocked: isBookmarkBulkMuteRenderingBlocked,
    noteMutation: noteBookmarkBulkMutation,
    flushEvents: flushPermanentBookmarkEventsAfterBulk
};

function extractLastBookmarkTree(storageData) {
    void storageData;
    return null;
}
;
let allBookmarks = [];
let currentBookmarkData = null;

const bookmarkUrlSet = new Set();
const bookmarkTitleSet = new Set(); // 书签标题集合（用于标题匹配的实时刷新）

const DATA_CACHE_KEYS = {
    bookmarks: 'bb_cache_bookmarks_v1'
};

let bookmarkCacheRestored = false;
let saveBookmarkCacheTimer = null;

// 预加载缓存
let cachedBookmarkTree = null;

// 图标预加载缓存
const preloadedIcons = new Map();
const iconPreloadQueue = [];

class BoundedLruMap extends Map {
    constructor(maxEntries = 4000) {
        super();
        const normalized = Number(maxEntries);
        this.maxEntries = Number.isFinite(normalized) ? Math.max(100, Math.floor(normalized)) : 4000;
    }

    _trimToLimit() {
        while (this.size > this.maxEntries) {
            const oldestKey = this.keys().next().value;
            if (oldestKey === undefined) break;
            super.delete(oldestKey);
        }
    }

    set(key, value) {
        if (super.has(key)) {
            super.delete(key);
        }
        super.set(key, value);
        this._trimToLimit();
        return this;
    }

    get(key) {
        if (!super.has(key)) return undefined;
        const value = super.get(key);
        super.delete(key);
        super.set(key, value);
        return value;
    }
}

// Favicon 缓存管理（持久化 + 失败缓存）
const FaviconCache = {
    db: null,
    dbName: 'BookmarkFaviconCache',
    dbVersion: 1,
    storeName: 'favicons',
    failureStoreName: 'failures',
    failureTtlMs: 60000,
    requestTimeoutMs: 2200,
    maxFetchedBytes: 512 * 1024,
    minFaviconDimensionPx: 16,
    minFallbackFaviconDimensionPx: 16,
    minTerminalFallbackFaviconDimensionPx: 16,
    browserFaviconSizeCandidates: [16, 32, 64, 96, 128],
    publicFaviconSizeCandidates: [64, 96, 128, 192, 256],
    googleS2SizeCandidates: [64, 128],
    cravatarSizeCandidates: [64, 128],
    domesticBranchProbeWindowSize: 12,
    domesticBranchHardFailureThreshold: 8,
    domesticBranchConsecutiveHardFailureThreshold: 5,
    networkBranchMode: 'overseas',
    networkBranchLocked: false,
    networkBranchPendingReevaluation: true,
    networkBranchWindow: [],
    networkBranchHardFailureCount: 0,
    networkBranchConsecutiveHardFailureCount: 0,
    networkBranchLastReevaluationAt: 0,
    networkBranchReevaluationCooldownMs: 300000,
    networkBranchSwitchReason: '',
    networkBranchLastReevaluationReason: '',
    cacheQualityVersion: 9,
    cacheQualityVersionKey: 'bb_favicon_quality_version',
    firstInstallFastPathKey: 'bb_favicon_first_install_fast_path_done',
    firstInstallSkipDbReadsRemaining: 0,
    memoryCache: new BoundedLruMap(4000), // {hostname: faviconDataUrl}
    dimensionCache: new BoundedLruMap(3000), // {faviconDataUrl: {width, height}}
    visualProfileCache: new BoundedLruMap(3000), // {faviconDataUrl: visual profile}
    failureCache: new BoundedLruMap(4000), // {hostname: timestamp}
    cravatarDefaultIconSha256: '2e30ff33270fd8687b0eb4d12652bfd967f23975f158bf8da93bece2ba4ab947',
    cravatarDefaultIconBytes: 492,
    cravatarDefaultCheckCache: new BoundedLruMap(1200), // {dataUrl: boolean}
    pendingRequests: new Map(), // inflight(hostname) 请求去重

    scheduleIdleCleanup() {
        try {
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                window.requestIdleCallback(() => this.checkAndEvictOldest(), { timeout: 5000 });
            } else {
                setTimeout(() => this.checkAndEvictOldest(), 2000);
            }
        } catch (_) { }
    },

    // 初始化 IndexedDB
    async init() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                Promise.resolve()
                    .then(() => this._ensureQualityCacheVersion())
                    .then(() => this._initializeFirstInstallFastPath())
                    .catch(() => {
                        // ignore init errors
                    })
                    .finally(() => {
                        resolve();
                        // 触发容量检查与超限淘汰
                        this.scheduleIdleCleanup();
                    });
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建成功缓存的存储
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'domain' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // 创建失败缓存的存储
                if (!db.objectStoreNames.contains(this.failureStoreName)) {
                    const failureStore = db.createObjectStore(this.failureStoreName, { keyPath: 'domain' });
                    failureStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    },

    async _countStoreEntries(storeName) {
        if (!this.db) return 0;
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction([storeName], 'readonly');
                const req = tx.objectStore(storeName).count();
                req.onsuccess = () => resolve(Number(req.result) || 0);
                req.onerror = () => resolve(0);
            } catch (_) {
                resolve(0);
            }
        });
    },

    async _initializeFirstInstallFastPath() {
        let alreadyHandled = false;
        try {
            alreadyHandled = localStorage.getItem(this.firstInstallFastPathKey) === '1';
        } catch (_) {
            alreadyHandled = false;
        }

        if (alreadyHandled) {
            this.firstInstallSkipDbReadsRemaining = 0;
            return;
        }

        const [faviconCount, failureCount] = await Promise.all([
            this._countStoreEntries(this.storeName),
            this._countStoreEntries(this.failureStoreName)
        ]);

        // 仅首次安装：当持久化缓存完全为空时，仅跳过第 1 次 DB 读取。
        this.firstInstallSkipDbReadsRemaining = (faviconCount === 0 && failureCount === 0) ? 1 : 0;

        try {
            localStorage.setItem(this.firstInstallFastPathKey, '1');
        } catch (_) {
            // ignore
        }
    },

    async _ensureQualityCacheVersion() {
        const currentVersion = Number(this.cacheQualityVersion) || 1;
        let storedVersion = 0;

        try {
            storedVersion = Number(localStorage.getItem(this.cacheQualityVersionKey) || 0);
            if (!Number.isFinite(storedVersion)) storedVersion = 0;
        } catch (_) {
            storedVersion = 0;
        }

        if (storedVersion >= currentVersion) {
            return;
        }

        this.memoryCache.clear();
        this.dimensionCache.clear();
        this.visualProfileCache.clear();
        this.failureCache.clear();
        this.cravatarDefaultCheckCache.clear();

        if (this.db) {
            await new Promise((resolve) => {
                try {
                    const tx = this.db.transaction([this.storeName, this.failureStoreName], 'readwrite');
                    tx.objectStore(this.storeName).clear();
                    tx.objectStore(this.failureStoreName).clear();
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                    tx.onabort = () => resolve();
                } catch (_) {
                    resolve();
                }
            });
        }

        try {
            localStorage.setItem(this.cacheQualityVersionKey, String(currentVersion));
        } catch (_) {
            // ignore
        }
    },

    // 检查URL是否为本地/内网/明显无效
    isInvalidUrl(url) {
        if (!url || typeof url !== 'string') return true;

        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            // 本地地址
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                return true;
            }

            // 内网地址
            if (hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/)) {
                return true;
            }

            // .local 域名
            if (hostname.endsWith('.local')) {
                return true;
            }

            // 文件协议等
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return true;
            }

            return false;
        } catch (e) {
            return true;
        }
    },

    isStoredFaviconData(dataUrl) {
        return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/');
    },

    _getHostnameKey(urlOrHostname) {
        if (!urlOrHostname || typeof urlOrHostname !== 'string') return '';
        const raw = String(urlOrHostname).trim();
        if (!raw) return '';

        if (raw.includes('://')) {
            try {
                return (new URL(raw).hostname || '').toLowerCase().replace(/\.$/, '');
            } catch (_) {
                return '';
            }
        }

        return raw.toLowerCase().replace(/\.$/, '');
    },

    _markFailureDomain(domain, timestamp = Date.now()) {
        const hostname = this._getHostnameKey(domain);
        if (!hostname) return;
        const ts = Number(timestamp) || Date.now();
        this.failureCache.set(hostname, ts);
    },

    _clearFailureDomain(domain) {
        const hostname = this._getHostnameKey(domain);
        if (!hostname) return;
        this.failureCache.delete(hostname);
    },

    _isFailureDomainActive(domain) {
        const hostname = this._getHostnameKey(domain);
        if (!hostname) return false;
        const ts = Number(this.failureCache.get(hostname) || 0);
        if (!ts) return false;
        if ((Date.now() - ts) < this.failureTtlMs) {
            return true;
        }
        this.failureCache.delete(hostname);
        return false;
    },

    // 从缓存获取favicon
    async get(url, options = {}) {
        if (this.isInvalidUrl(url)) {
            return null;
        }

        try {
            const domain = this._getHostnameKey(url);
            if (!domain) return null;
            const ignoreFailureCache = options && options.ignoreFailureCache === true;

            // 检查失败缓存
            if (!ignoreFailureCache && this._isFailureDomainActive(domain)) {
                return 'failed';
            }

            // 检查内存缓存
            if (this.memoryCache.has(domain)) {
                return this.memoryCache.get(domain);
            }

            // 首次安装快速路径：仅第 1 次读取跳过 IndexedDB，后续恢复正常。
            if (this.firstInstallSkipDbReadsRemaining > 0) {
                this.firstInstallSkipDbReadsRemaining -= 1;
                return null;
            }

            // 从 IndexedDB 读取
            if (!this.db) await this.init();

            return new Promise((resolve) => {
                const transaction = this.db.transaction([this.storeName, this.failureStoreName], 'readonly');

                // 先检查失败缓存
                const failureStore = transaction.objectStore(this.failureStoreName);
                const failureRequest = failureStore.get(domain);

                failureRequest.onsuccess = () => {
                    if (!ignoreFailureCache && failureRequest.result) {
                        // 检查失败缓存是否过期（默认 24 小时）
                        const age = Date.now() - failureRequest.result.timestamp;
                        if (age < this.failureTtlMs) {
                            this._markFailureDomain(domain, failureRequest.result.timestamp);
                            resolve('failed');
                            return;
                        }
                    }

                    // 检查成功缓存
                    const store = transaction.objectStore(this.storeName);
                    const request = store.get(domain);

                    request.onsuccess = () => {
                        if (request.result && this.isStoredFaviconData(request.result.dataUrl)) {
                            // 永久缓存，不检查过期（只有删除书签时才删除缓存）
                            this.memoryCache.set(domain, request.result.dataUrl);
                            resolve(request.result.dataUrl);
                        } else if (request.result) {
                            try {
                                const cleanupTx = this.db.transaction([this.storeName], 'readwrite');
                                cleanupTx.objectStore(this.storeName).delete(domain);
                            } catch (_) {
                                // ignore
                            }
                            resolve(null);
                        } else {
                            resolve(null);
                        }
                    };

                    request.onerror = () => resolve(null);
                };

                failureRequest.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    },

    // 保存favicon到缓存
    async save(url, dataUrl) {
        if (this.isInvalidUrl(url) || !this.isStoredFaviconData(dataUrl)) return;

        try {
            const domain = this._getHostnameKey(url);
            if (!domain) return;

            // 更新内存缓存
            this.memoryCache.set(domain, dataUrl);

            // 保存到 IndexedDB
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            store.put({
                domain: domain,
                dataUrl: dataUrl,
                timestamp: Date.now()
            });

            // 从失败缓存中移除（如果存在）
            this._clearFailureDomain(domain);
            this.removeFailure(domain);

        } catch (e) {
            // 静默处理
        }
    },

    // 记录失败
    async saveFailure(url) {
        if (this.isInvalidUrl(url)) return;

        try {
            const domain = this._getHostnameKey(url);
            if (!domain) return;

            // 更新内存缓存
            this._markFailureDomain(domain);

            // 保存到 IndexedDB
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.failureStoreName], 'readwrite');
            const store = transaction.objectStore(this.failureStoreName);

            store.put({
                domain: domain,
                timestamp: Date.now()
            });

        } catch (e) {
            // 静默处理
        }
    },

    // 检查图标缓存容量并淘汰最老的数据，保证不超过 2000 个域名
    async checkAndEvictOldest() {
        try {
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const countRequest = store.count();
            countRequest.onsuccess = () => {
                const count = countRequest.result;
                if (count < 2000) return; // 没到 2000 个域名，不进行任何处理

                const deleteCount = 500; // 超限后淘汰最老的 500 个
                const index = store.index('timestamp');
                const cursorRequest = index.openCursor(null, 'next'); // 按时间戳升序遍历（最老的最先）

                let evicted = 0;
                cursorRequest.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor && evicted < deleteCount) {
                        const domain = cursor.value.domain;
                        this.memoryCache.delete(domain);
                        cursor.delete();
                        evicted++;
                        cursor.continue();
                    }
                };
            };
        } catch (_) {
            // 静默处理
        }
    },

    // 移除失败记录（当URL被修改时）
    async removeFailure(domain) {
        try {
            const hostname = this._getHostnameKey(domain);
            if (!hostname) return;
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.failureStoreName], 'readwrite');
            const store = transaction.objectStore(this.failureStoreName);
            store.delete(hostname);
        } catch (e) {
            // 静默失败
        }
    },

    // 清除特定URL的缓存（用于书签URL修改时）
    async clear(url) {
        if (this.isInvalidUrl(url)) return;

        try {
            const domain = this._getHostnameKey(url);
            if (!domain) return;

            // 清除内存缓存
            this.memoryCache.delete(domain);
            this.dimensionCache.clear();
            this.visualProfileCache.clear();
            this._clearFailureDomain(domain);

            // 清除 IndexedDB
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.storeName, this.failureStoreName], 'readwrite');
            transaction.objectStore(this.storeName).delete(domain);
            transaction.objectStore(this.failureStoreName).delete(domain);

        } catch (e) {
            // 静默处理
        }
    },

    async getDataUrlDimensions(dataUrl) {
        if (!this.isStoredFaviconData(dataUrl)) return null;
        if (this.dimensionCache.has(dataUrl)) {
            return this.dimensionCache.get(dataUrl);
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const width = Number(img.naturalWidth || img.width || 0);
                const height = Number(img.naturalHeight || img.height || 0);
                if (width > 0 && height > 0) {
                    const dimensions = { width, height };
                    this.dimensionCache.set(dataUrl, dimensions);
                    resolve(dimensions);
                    return;
                }
                resolve(null);
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    },

    async isDataUrlAtLeast(dataUrl, minDimensionPx = 1) {
        const min = Math.max(1, Number(minDimensionPx) || 1);
        if (!this.isStoredFaviconData(dataUrl)) return false;
        const dimensions = await this.getDataUrlDimensions(dataUrl);
        if (!dimensions) return false;
        return Number(dimensions.width) >= min && Number(dimensions.height) >= min;
    },

    async getDataUrlVisualProfile(dataUrl) {
        if (!this.isStoredFaviconData(dataUrl)) return null;
        if (this.visualProfileCache.has(dataUrl)) {
            return this.visualProfileCache.get(dataUrl);
        }

        const profile = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const width = Number(img.naturalWidth || img.width || 0);
                const height = Number(img.naturalHeight || img.height || 0);
                if (width <= 0 || height <= 0) {
                    resolve(null);
                    return;
                }

                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        resolve({
                            width,
                            height,
                            minDimension: Math.min(width, height),
                            sampleCount: 0,
                            transparentRatio: 0,
                            whiteOpaqueRatio: 0,
                            nearWhiteOpaqueRatio: 0
                        });
                        return;
                    }
                    ctx.drawImage(img, 0, 0);
                    const pixels = ctx.getImageData(0, 0, width, height).data;

                    const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
                    let sampleCount = 0;
                    let transparentCount = 0;
                    let whiteOpaqueCount = 0;
                    let nearWhiteOpaqueCount = 0;

                    for (let y = 0; y < height; y += step) {
                        for (let x = 0; x < width; x += step) {
                            const idx = ((y * width) + x) * 4;
                            const r = pixels[idx];
                            const g = pixels[idx + 1];
                            const b = pixels[idx + 2];
                            const a = pixels[idx + 3];
                            sampleCount += 1;

                            if (a <= 8) {
                                transparentCount += 1;
                                continue;
                            }

                            if (a >= 245) {
                                if (r >= 250 && g >= 250 && b >= 250) {
                                    whiteOpaqueCount += 1;
                                }
                                if (r >= 240 && g >= 240 && b >= 240) {
                                    nearWhiteOpaqueCount += 1;
                                }
                            }
                        }
                    }

                    resolve({
                        width,
                        height,
                        minDimension: Math.min(width, height),
                        sampleCount,
                        transparentRatio: sampleCount > 0 ? (transparentCount / sampleCount) : 0,
                        whiteOpaqueRatio: sampleCount > 0 ? (whiteOpaqueCount / sampleCount) : 0,
                        nearWhiteOpaqueRatio: sampleCount > 0 ? (nearWhiteOpaqueCount / sampleCount) : 0
                    });
                } catch (_) {
                    resolve({
                        width,
                        height,
                        minDimension: Math.min(width, height),
                        sampleCount: 0,
                        transparentRatio: 0,
                        whiteOpaqueRatio: 0,
                        nearWhiteOpaqueRatio: 0
                    });
                }
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });

        if (profile) {
            this.visualProfileCache.set(dataUrl, profile);
        }
        return profile;
    },

    _decodeBase64DataUrlBytes(dataUrl = '') {
        if (!this.isStoredFaviconData(dataUrl)) return null;
        const commaIndex = dataUrl.indexOf(',');
        if (commaIndex <= 0) return null;
        const header = String(dataUrl.slice(0, commaIndex)).toLowerCase();
        if (!header.includes(';base64')) return null;
        const encoded = dataUrl.slice(commaIndex + 1);
        if (!encoded) return null;
        try {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        } catch (_) {
            return null;
        }
    },

    async _computeSha256HexFromBytes(bytes) {
        try {
            if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0) return '';
            if (!globalThis.crypto || !globalThis.crypto.subtle || typeof globalThis.crypto.subtle.digest !== 'function') {
                return '';
            }
            const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
            const view = new Uint8Array(digest);
            return Array.from(view).map((value) => value.toString(16).padStart(2, '0')).join('');
        } catch (_) {
            return '';
        }
    },

    _hasPngSignature(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) return false;
        const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        for (let i = 0; i < pngSig.length; i += 1) {
            if (bytes[i] !== pngSig[i]) return false;
        }
        return true;
    },

    async _isCravatarDefaultIconDataUrl(dataUrl = '') {
        if (!this.isStoredFaviconData(dataUrl)) return false;
        const cached = this.cravatarDefaultCheckCache.get(dataUrl);
        if (typeof cached === 'boolean') return cached;

        let isDefault = false;
        const bytes = this._decodeBase64DataUrlBytes(dataUrl);
        if (bytes && bytes.byteLength > 0) {
            if (bytes.byteLength === Number(this.cravatarDefaultIconBytes) && this._hasPngSignature(bytes)) {
                const hash = await this._computeSha256HexFromBytes(bytes);
                const expected = String(this.cravatarDefaultIconSha256 || '').toLowerCase();
                if (hash && expected && hash === expected) {
                    isDefault = true;
                }
            }
        }

        this.cravatarDefaultCheckCache.set(dataUrl, isDefault);
        return isDefault;
    },

    _classifyFaviconSource(sourceUrl = '') {
        const safe = String(sourceUrl || '');
        if (safe.includes('icons.duckduckgo.com/ip3/')) return 'duckduckgo';
        if (safe.includes('faviconV2?client=SOCIAL')) return 'gstatic';
        if (safe.includes('cn.cravatar.com/favicon/')) return 'cravatar';
        if (safe.includes('google.com/s2/favicons')) return 'google-s2';
        if (safe.includes('/_favicon/')) return 'browser';
        return 'other';
    },

    _getSourceTimeoutMs(sourceUrl = '', minDimensionPx = this.minFaviconDimensionPx) {
        const sourceKind = this._classifyFaviconSource(sourceUrl);
        const baseTimeout = Math.max(500, Number(this.requestTimeoutMs) || 2200);

        if (sourceKind === 'duckduckgo') return Math.min(baseTimeout, 1200);
        if (sourceKind === 'google-s2') return Math.min(baseTimeout, 1300);
        if (sourceKind === 'gstatic') return Math.min(baseTimeout, 1500);
        if (sourceKind === 'cravatar') return Math.min(baseTimeout, 1200);
        if (sourceKind === 'browser') return Math.min(baseTimeout, 1000);
        return baseTimeout;
    },

    _isWhitePlateProfile(profile) {
        if (!profile || typeof profile !== 'object') return false;
        const nearWhite = Number(profile.nearWhiteOpaqueRatio || 0);
        const transparent = Number(profile.transparentRatio || 0);
        return nearWhite >= 0.22 && transparent <= 0.10;
    },

    _isTransparentPreferredProfile(profile) {
        if (!profile || typeof profile !== 'object') return false;
        const transparent = Number(profile.transparentRatio || 0);
        return transparent >= 0.04;
    },

    _scoreFaviconCandidate(profile, sourceKind = '') {
        if (!profile || typeof profile !== 'object') return -Infinity;
        const minDimension = Math.max(0, Number(profile.minDimension || 0));
        const transparentRatio = Math.max(0, Math.min(1, Number(profile.transparentRatio || 0)));
        const nearWhiteRatio = Math.max(0, Math.min(1, Number(profile.nearWhiteOpaqueRatio || 0)));

        let score = 0;
        score += Math.min(200, minDimension);
        score += transparentRatio * 60;
        score -= nearWhiteRatio * 90;

        if (sourceKind === 'duckduckgo') score += 8;
        else if (sourceKind === 'gstatic') score += 4;
        else if (sourceKind === 'google-s2') score += 3;
        else if (sourceKind === 'cravatar') score += 2;
        else if (sourceKind === 'browser') score += 1;

        return score;
    },

    async _buildFaviconCandidate(dataUrl, sourceUrl, minDimensionPx, options = {}) {
        if (!this.isStoredFaviconData(dataUrl)) return null;
        const dimensions = await this.getDataUrlDimensions(dataUrl);
        if (!dimensions) return null;

        const minDimension = Math.max(0, Math.min(
            Number(dimensions.width) || 0,
            Number(dimensions.height) || 0
        ));
        const reachedMin = minDimension >= Math.max(1, Number(minDimensionPx) || 1);
        const sourceKind = this._classifyFaviconSource(sourceUrl);
        const includeVisualProfile = !!(options && options.includeVisualProfile === true);

        let profile = null;
        let isWhitePlate = false;
        let score = minDimension;

        if (includeVisualProfile) {
            profile = await this.getDataUrlVisualProfile(dataUrl);
            if (profile) {
                isWhitePlate = this._isWhitePlateProfile(profile);
                score = this._scoreFaviconCandidate(profile, sourceKind);
            }
        }

        return {
            dataUrl,
            sourceUrl,
            sourceKind,
            profile,
            score,
            isWhitePlate,
            reachedMin,
            minDimension,
            width: Number(dimensions.width) || 0,
            height: Number(dimensions.height) || 0
        };
    },

    async _selectBestCandidateWithConflictRule(candidates = []) {
        const validCandidates = Array.isArray(candidates)
            ? candidates.filter((candidate) => candidate && candidate.reachedMin)
            : [];
        if (validCandidates.length === 0) return null;

        let topMinDimension = 0;
        for (const candidate of validCandidates) {
            const candidateMin = Math.max(0, Number(candidate.minDimension) || 0);
            if (candidateMin > topMinDimension) topMinDimension = candidateMin;
        }

        const topCandidates = validCandidates.filter((candidate) => {
            const candidateMin = Math.max(0, Number(candidate.minDimension) || 0);
            return candidateMin === topMinDimension;
        });

        if (topCandidates.length <= 1) {
            return topCandidates[0] || validCandidates[0];
        }

        let bestTransparentCandidate = null;
        let bestNonWhiteCandidate = null;
        let bestAnyCandidate = null;

        for (const rawCandidate of topCandidates) {
            const candidate = await this._buildFaviconCandidate(
                rawCandidate.dataUrl,
                rawCandidate.sourceUrl,
                1,
                { includeVisualProfile: true }
            ) || rawCandidate;

            if (!bestAnyCandidate || candidate.score > bestAnyCandidate.score) {
                bestAnyCandidate = candidate;
            }

            if (candidate.isWhitePlate) {
                continue;
            }

            if (!bestNonWhiteCandidate || candidate.score > bestNonWhiteCandidate.score) {
                bestNonWhiteCandidate = candidate;
            }

            if (this._isTransparentPreferredProfile(candidate.profile)) {
                if (!bestTransparentCandidate || candidate.score > bestTransparentCandidate.score) {
                    bestTransparentCandidate = candidate;
                }
            }
        }

        return bestTransparentCandidate || bestNonWhiteCandidate || bestAnyCandidate || topCandidates[0] || validCandidates[0];
    },

    _normalizeNetworkBranchMode(mode = '') {
        return String(mode || '').toLowerCase() === 'domestic' ? 'domestic' : 'overseas';
    },

    _resolveNetworkLanguageBucket() {
        const normalizedCurrentLang = String((typeof currentLang === 'string' ? currentLang : '') || '').toLowerCase();
        if (normalizedCurrentLang.startsWith('zh')) return 'zh';
        try {
            const uiLang = String(chrome?.i18n?.getUILanguage?.() || navigator?.language || '').toLowerCase();
            return uiLang.startsWith('zh') ? 'zh' : 'non_zh';
        } catch (_) {
            return 'non_zh';
        }
    },

    _resetNetworkBranchProbeStats() {
        this.networkBranchWindow = [];
        this.networkBranchHardFailureCount = 0;
        this.networkBranchConsecutiveHardFailureCount = 0;
    },

    markNetworkBranchReevaluation(reason = '') {
        this.networkBranchLastReevaluationReason = String(reason || '');
        // no-op: branch selection is language-driven now.
    },

    requestNetworkBranchReevaluation(reason = '') {
        this.networkBranchLastReevaluationAt = Date.now();
        this.markNetworkBranchReevaluation(reason);
        return false;
    },

    _resolveNetworkBranchForFetch() {
        const languageBucket = this._resolveNetworkLanguageBucket();
        const branchMode = languageBucket === 'zh' ? 'domestic' : 'overseas';
        this.networkBranchMode = branchMode;
        return branchMode;
    },

    _isHardFailureStatus(statusCode) {
        const code = Number(statusCode);
        if (!Number.isFinite(code)) return false;
        if (code === 0 || code === 408) return true;
        return code >= 500 && code <= 599;
    },

    _isHardFailureMeta(meta) {
        if (!meta || typeof meta !== 'object') return false;
        if (meta.hardFailure === true) return true;
        if (this._isHardFailureStatus(meta.statusCode)) return true;
        const errorCode = String(meta.errorCode || '').toLowerCase();
        return errorCode === 'timeout'
            || errorCode === 'abort'
            || errorCode === 'network_error'
            || errorCode === 'fetch_failed'
            || errorCode === 'proxy_error'
            || errorCode === 'http_0';
    },

    _switchToDomesticBranch(reason = '') {
        this.networkBranchMode = 'domestic';
        this.networkBranchLocked = true;
        this.networkBranchPendingReevaluation = false;
        this.networkBranchSwitchReason = String(reason || '');
    },

    _recordBranchProbeResult({ branchMode = '', sourceUrl = '', meta = null } = {}) {
        // no-op: probe-based branch switching is disabled.
        return;
    },

    _ensureInFlightHostnameRequest(hostnameKey, url, options = {}) {
        const requestKey = this._getHostnameKey(hostnameKey);
        if (!requestKey) return Promise.resolve(fallbackIcon);

        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }

        const requestPromise = this._fetchFavicon(url, options)
            .catch(() => fallbackIcon)
            .finally(() => {
                this.pendingRequests.delete(requestKey);
            });

        this.pendingRequests.set(requestKey, requestPromise);
        return requestPromise;
    },

    // 获取favicon（带缓存和请求合并）
    async fetch(url, options = {}) {
        if (this.isInvalidUrl(url)) {
            return fallbackIcon;
        }

        try {
            const domain = this._getHostnameKey(url);
            if (!domain) {
                return fallbackIcon;
            }
            const requestedMinDimension = Math.max(0, Number(options?.minDimensionPx) || 0);
            const strictMinDimension = requestedMinDimension > 0
                ? Math.max(Math.max(1, Number(this.minFaviconDimensionPx) || 96), requestedMinDimension)
                : Math.max(1, Number(this.minFaviconDimensionPx) || 96);
            const fallbackMinCandidate = Number(options?.fallbackMinDimensionPx);
            const fallbackMinBase = Number.isFinite(fallbackMinCandidate) && fallbackMinCandidate > 0
                ? fallbackMinCandidate
                : (Number(this.minFallbackFaviconDimensionPx) || 32);
            const fallbackMinDimension = Math.max(1, Math.min(strictMinDimension, fallbackMinBase));
            const cacheMinDimension = requestedMinDimension > 0
                ? Math.max(1, Number(options?.cacheMinDimensionPx) || fallbackMinDimension)
                : 0;
            const branchMode = this._resolveNetworkBranchForFetch();
            const speedFirst = options?.speedFirst === true;
            const ignoreFailureCache = options?.ignoreFailureCache === true;

            // 同步阶段优先返回当前可用值，避免前台阻塞。
            if (!ignoreFailureCache && this._isFailureDomainActive(domain)) {
                return fallbackIcon;
            }
            if (this.memoryCache.has(domain)) {
                const memoryHit = this.memoryCache.get(domain);
                if (cacheMinDimension <= 0 || await this.isDataUrlAtLeast(memoryHit, cacheMinDimension)) {
                    return memoryHit;
                }
            }

            const requestOptions = {
                strictMinDimensionPx: strictMinDimension,
                fallbackMinDimensionPx: fallbackMinDimension,
                branchMode
            };

            if (speedFirst) {
                const networkPromise = this._ensureInFlightHostnameRequest(domain, url, requestOptions);
                const cached = await this.get(url, options);
                if (cached === 'failed') {
                    return fallbackIcon;
                }
                if (cached) {
                    if (cacheMinDimension <= 0 || await this.isDataUrlAtLeast(cached, cacheMinDimension)) {
                        return cached;
                    }
                }
                return await networkPromise;
            }

            const cached = await this.get(url, options);
            if (cached === 'failed') {
                return fallbackIcon;
            }
            if (cached) {
                if (cacheMinDimension <= 0 || await this.isDataUrlAtLeast(cached, cacheMinDimension)) {
                    return cached;
                }
            }

            return await this._ensureInFlightHostnameRequest(domain, url, requestOptions);
        } catch (e) {
            return fallbackIcon;
        }
    },

    // 实际请求favicon - 语言分支固定瀑布策略：
    // 中文分支：Cravatar -> Google S2 -> /_favicon
    // 非中文分支：Google S2 -> DuckDuckGo -> t3.gstatic.com -> /_favicon
    async _fetchFavicon(url, options = {}) {
        return new Promise(async (resolve) => {
            try {
                const domain = this._getHostnameKey(url);
                if (!domain) {
                    resolve(fallbackIcon);
                    return;
                }

                const strictMinDimension = Math.max(
                    1,
                    Number(options?.strictMinDimensionPx) || Number(this.minFaviconDimensionPx) || 96
                );
                const fallbackMinCandidate = Number(options?.fallbackMinDimensionPx);
                const fallbackMinDimension = Math.max(
                    1,
                    Math.min(
                        strictMinDimension,
                        (Number.isFinite(fallbackMinCandidate) && fallbackMinCandidate > 0)
                            ? fallbackMinCandidate
                            : (Number(this.minFallbackFaviconDimensionPx) || 32)
                    )
                );

                let activeBranchMode = this._normalizeNetworkBranchMode(options?.branchMode || this._resolveNetworkBranchForFetch());

                const strictFaviconSources = this._buildFaviconSourceList(url, domain, {
                    branchMode: activeBranchMode,
                    minDimensionPx: strictMinDimension,
                    maxDomesticGstaticSizes: 2,
                    maxOverseasGoogleSizes: 1,
                    maxDomesticCravatarSizes: 1,
                    maxBrowserSizes: 1
                });

                if (strictFaviconSources.length === 0) {
                    this.saveFailure(url);
                    resolve(fallbackIcon);
                    return;
                }

                const attemptedSourceUrls = new Set();
                const tryCandidateFromSource = async (faviconUrl, minDimensionPx, candidateBucket) => {
                    const minDimensionKey = Math.max(1, Number(minDimensionPx) || 1);
                    const attemptKey = `${faviconUrl}|${minDimensionKey}`;
                    if (!faviconUrl || attemptedSourceUrls.has(attemptKey)) {
                        return false;
                    }
                    attemptedSourceUrls.add(attemptKey);

                    const loadResult = await this._tryLoadFavicon(faviconUrl, minDimensionPx, {
                        timeoutMs: this._getSourceTimeoutMs(faviconUrl, minDimensionPx)
                    });
                    this._recordBranchProbeResult({
                        branchMode: activeBranchMode,
                        sourceUrl: faviconUrl,
                        meta: loadResult && loadResult.meta ? loadResult.meta : null
                    });
                    const result = loadResult && typeof loadResult.dataUrl === 'string' ? loadResult.dataUrl : '';
                    if (!result || result === fallbackIcon) {
                        if (activeBranchMode === 'overseas' && this.networkBranchMode === 'domestic') {
                            return 'switch_branch';
                        }
                        return false;
                    }

                    const candidate = await this._buildFaviconCandidate(result, faviconUrl, minDimensionPx);
                    if (!candidate || !candidate.reachedMin) {
                        return false;
                    }

                    if (Array.isArray(candidateBucket)) {
                        candidateBucket.push(candidate);
                    }
                    return false;
                };

                const runCandidateRound = async (sourceList, minDimensionPx, candidateBucket, options = {}) => {
                    const safeList = Array.isArray(sourceList) ? sourceList : [];
                    const parallelCount = Math.max(1, Number(options.parallelCount) || 1);
                    const stopOnFirstCandidate = options.stopOnFirstCandidate !== false;

                    for (let i = 0; i < safeList.length; i += parallelCount) {
                        const chunk = safeList.slice(i, i + parallelCount);
                        if (chunk.length === 0) break;
                        const results = await Promise.all(
                            chunk.map((sourceUrl) => tryCandidateFromSource(sourceUrl, minDimensionPx, candidateBucket))
                        );
                        if (results.includes('switch_branch')) return 'switch_branch';
                        if (stopOnFirstCandidate && candidateBucket.length > 0) return 'found';
                    }

                    return candidateBucket.length > 0 ? 'found' : 'none';
                };

                // 第一轮：默认走极速链路（>=16）；高分辨率请求会自动拉高 strictMinDimension。
                const strictCandidates = [];
                await runCandidateRound(strictFaviconSources, strictMinDimension, strictCandidates, {
                    parallelCount: 3,
                    stopOnFirstCandidate: true
                });

                activeBranchMode = this._normalizeNetworkBranchMode(this.networkBranchMode || activeBranchMode);
                let chosenCandidate = await this._selectBestCandidateWithConflictRule(strictCandidates);

                // 第二轮：放宽到兜底阈值（默认 >= 32，拒绝 16x16）
                if (!chosenCandidate && fallbackMinDimension < strictMinDimension) {
                    const fallbackFaviconSources = this._buildFaviconSourceList(url, domain, {
                        branchMode: activeBranchMode,
                        minDimensionPx: fallbackMinDimension,
                        maxDomesticGstaticSizes: 1,
                        maxOverseasGoogleSizes: 1,
                        maxDomesticCravatarSizes: 1,
                        maxBrowserSizes: 1
                    });
                    const fallbackCandidates = [];
                    await runCandidateRound(fallbackFaviconSources, fallbackMinDimension, fallbackCandidates, {
                        parallelCount: 2,
                        stopOnFirstCandidate: true
                    });
                    chosenCandidate = await this._selectBestCandidateWithConflictRule(fallbackCandidates);
                }

                // 第三轮（终极兜底）：仅在前两轮都拿不到任何可用候选时，放宽到 >=16。
                if (!chosenCandidate) {
                    const terminalFallbackMinDimension = Math.max(
                        1,
                        Math.min(
                            fallbackMinDimension,
                            Number(this.minTerminalFallbackFaviconDimensionPx) || 16
                        )
                    );
                    if (terminalFallbackMinDimension < fallbackMinDimension) {
                        const terminalFallbackSources = this._buildFaviconSourceList(url, domain, {
                            branchMode: activeBranchMode,
                            minDimensionPx: terminalFallbackMinDimension,
                            maxDomesticGstaticSizes: 1,
                            maxOverseasGoogleSizes: 1,
                            maxDomesticCravatarSizes: 1,
                            maxBrowserSizes: 1
                        });
                        const terminalCandidates = [];
                        await runCandidateRound(terminalFallbackSources, terminalFallbackMinDimension, terminalCandidates, {
                            parallelCount: 2,
                            stopOnFirstCandidate: true
                        });
                        chosenCandidate = await this._selectBestCandidateWithConflictRule(terminalCandidates);
                    }
                }

                if (chosenCandidate && chosenCandidate.dataUrl) {
                    await this.save(url, chosenCandidate.dataUrl);
                    resolve(chosenCandidate.dataUrl);
                    return;
                }

                // 所有源都失败，统一写入失败缓存（含 hard failure）
                await this.saveFailure(url);
                resolve(fallbackIcon);

            } catch (e) {
                // 静默处理错误
                resolve(fallbackIcon);
            }
        });
    },

    _pickCandidateSizes(candidates, minDimensionPx = 1, maxCount = 2) {
        const min = Math.max(1, Number(minDimensionPx) || 1);
        const limit = Math.max(1, Number(maxCount) || 1);
        const list = Array.isArray(candidates)
            ? candidates.map((size) => Number(size)).filter((size) => Number.isFinite(size) && size > 0)
            : [];
        if (list.length === 0) return [];
        const filtered = list.filter((size) => size >= min);
        const source = filtered.length > 0 ? filtered : list;
        return source.slice(0, limit);
    },

    _buildFaviconSourceList(url, domain, options = {}) {
        const branchMode = this._normalizeNetworkBranchMode(options?.branchMode || this._resolveNetworkBranchForFetch());
        const minDimensionPx = Math.max(1, Number(options?.minDimensionPx) || 1);
        const maxBrowserSizes = Math.max(1, Number(options?.maxBrowserSizes) || 1);
        const maxOverseasGoogleSizes = Math.max(1, Number(options?.maxOverseasGoogleSizes) || 1);
        const maxDomesticGstaticSizes = Math.max(1, Number(options?.maxDomesticGstaticSizes) || 2);
        const maxDomesticCravatarSizes = Math.max(1, Number(options?.maxDomesticCravatarSizes) || 1);

        const sources = [];
        const seen = new Set();
        const addSource = (sourceUrl) => {
            if (!sourceUrl || seen.has(sourceUrl)) return;
            seen.add(sourceUrl);
            sources.push(sourceUrl);
        };

        const gstaticSizes = this._pickCandidateSizes(this.publicFaviconSizeCandidates, minDimensionPx, maxDomesticGstaticSizes);
        const googleSizes = this._pickCandidateSizes(this.googleS2SizeCandidates, minDimensionPx, maxOverseasGoogleSizes);
        const cravatarSizes = this._pickCandidateSizes(this.cravatarSizeCandidates, minDimensionPx, maxDomesticCravatarSizes);
        const browserSizes = this._pickCandidateSizes(this.browserFaviconSizeCandidates, minDimensionPx, maxBrowserSizes);

        if (branchMode === 'domestic') {
            for (const size of cravatarSizes) {
                addSource(this._getCravatarFaviconUrl(domain, size));
            }
            for (const size of googleSizes) {
                addSource(this._getGoogleS2FaviconUrl(url, size));
            }
            for (const size of browserSizes) {
                addSource(this._getBrowserFaviconServiceUrl(url, size));
            }
        } else {
            for (const size of googleSizes) {
                addSource(this._getGoogleS2FaviconUrl(url, size));
            }
            addSource(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
            for (const size of gstaticSizes) {
                addSource(this._getGstaticCnFaviconUrl(url, size));
            }
            for (const size of browserSizes) {
                addSource(this._getBrowserFaviconServiceUrl(url, size));
            }
        }

        return sources;
    },

    _getBrowserFaviconServiceUrl(url, size = 64) {
        try {
            if (!browserAPI?.runtime?.getURL) return null;
            const baseUrl = browserAPI.runtime.getURL('/_favicon/');
            return `${baseUrl}?pageUrl=${encodeURIComponent(url)}&size=${encodeURIComponent(size)}`;
        } catch (e) {
            return null;
        }
    },

    _getGstaticCnFaviconUrl(url, size = 128) {
        return `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=${encodeURIComponent(size)}&url=${encodeURIComponent(url)}`;
    },

    _getCravatarFaviconUrl(domain, size = 64) {
        return `https://cn.cravatar.com/favicon/api/index.php?url=${encodeURIComponent(domain)}&size=${encodeURIComponent(size)}`;
    },

    _getGoogleS2FaviconUrl(url, size = 64) {
        return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=${encodeURIComponent(size)}`;
    },

    async _blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
                    resolve(reader.result);
                    return;
                }
                reject(new Error('invalid_data_url'));
            };
            reader.onerror = () => reject(reader.error || new Error('read_failed'));
            reader.readAsDataURL(blob);
        });
    },

    async _readBlobDimensions(blob) {
        return new Promise((resolve) => {
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();

            const cleanup = () => {
                try {
                    URL.revokeObjectURL(objectUrl);
                } catch (_) {
                    // ignore
                }
            };

            img.onload = () => {
                const width = img.naturalWidth || img.width || 0;
                const height = img.naturalHeight || img.height || 0;
                cleanup();
                resolve({ width, height });
            };

            img.onerror = () => {
                cleanup();
                resolve(null);
            };

            img.src = objectUrl;
        });
    },

    async _fetchImageAsDataUrl(faviconUrl, minDimensionPx = this.minFaviconDimensionPx, options = {}) {
        const timeoutMs = Math.max(500, Number(options?.timeoutMs) || Number(this.requestTimeoutMs) || 3000);
        try {
            if (browserAPI?.runtime?.sendMessage) {
                const requiredDimension = Math.max(1, Number(minDimensionPx) || this.minFaviconDimensionPx);
                const response = await browserAPI.runtime.sendMessage({
                    action: 'canvasFetchFaviconDataUrl',
                    url: String(faviconUrl || ''),
                    minDimensionPx: requiredDimension,
                    maxBytes: Number(this.maxFetchedBytes) || (512 * 1024),
                    timeoutMs,
                    includeMeta: true
                });

                const dataUrl = response && response.success ? response.dataUrl : '';
                const safeMeta = response && response.meta && typeof response.meta === 'object'
                    ? response.meta
                    : null;

                if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
                    return {
                        dataUrl,
                        meta: safeMeta || { attempted: true, hardFailure: false, errorCode: '' }
                    };
                }

                return {
                    dataUrl: '',
                    meta: safeMeta || {
                        attempted: true,
                        hardFailure: false,
                        errorCode: response && response.success === false ? 'proxy_error' : 'proxy_empty_result'
                    }
                };
            }
        } catch (_) {
            // 若后台代理不可用，回退到页面内 fetch 路径
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(faviconUrl, {
                signal: controller.signal
            });

            if (!response.ok) {
                const statusCode = Number(response.status) || 0;
                return {
                    dataUrl: '',
                    meta: {
                        attempted: true,
                        statusCode,
                        hardFailure: this._isHardFailureStatus(statusCode),
                        errorCode: `http_${statusCode || 0}`
                    }
                };
            }

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (contentType && !contentType.startsWith('image/')) {
                return {
                    dataUrl: '',
                    meta: { attempted: true, hardFailure: false, errorCode: 'non_image_content' }
                };
            }

            const declaredLength = Number(response.headers.get('content-length') || 0);
            if (Number.isFinite(declaredLength) && declaredLength > this.maxFetchedBytes) {
                return {
                    dataUrl: '',
                    meta: { attempted: true, hardFailure: false, errorCode: 'payload_too_large' }
                };
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0 || blob.size > this.maxFetchedBytes) {
                return {
                    dataUrl: '',
                    meta: { attempted: true, hardFailure: false, errorCode: 'invalid_blob' }
                };
            }

            const dimensions = await this._readBlobDimensions(blob);
            const requiredDimension = Math.max(1, Number(minDimensionPx) || this.minFaviconDimensionPx);
            if (!dimensions || dimensions.width < requiredDimension || dimensions.height < requiredDimension) {
                return {
                    dataUrl: '',
                    meta: { attempted: true, hardFailure: false, errorCode: 'dimension_too_small' }
                };
            }

            const dataUrl = await this._blobToDataUrl(blob);
            return {
                dataUrl,
                meta: { attempted: true, hardFailure: false, statusCode: Number(response.status) || 200, errorCode: '' }
            };
        } catch (e) {
            const errorCode = e && e.name === 'AbortError' ? 'timeout' : 'fetch_failed';
            return {
                dataUrl: '',
                meta: {
                    attempted: true,
                    hardFailure: errorCode === 'timeout' || errorCode === 'fetch_failed',
                    errorCode
                }
            };
        } finally {
            clearTimeout(timeout);
        }
    },

    // 尝试从单个源加载 favicon，仅返回 dataURL，不在此阶段写缓存
    async _tryLoadFavicon(faviconUrl, minDimensionPx = this.minFaviconDimensionPx, options = {}) {
        try {
            const result = await this._fetchImageAsDataUrl(faviconUrl, minDimensionPx, options);
            const dataUrl = result && typeof result.dataUrl === 'string' ? result.dataUrl : '';
            if (!dataUrl || !this.isStoredFaviconData(dataUrl)) {
                return {
                    dataUrl: '',
                    meta: result && result.meta ? result.meta : { attempted: true, hardFailure: false, errorCode: 'empty_data_url' }
                };
            }
            const sourceKind = this._classifyFaviconSource(faviconUrl);
            if (sourceKind === 'cravatar' && await this._isCravatarDefaultIconDataUrl(dataUrl)) {
                return {
                    dataUrl: '',
                    meta: { attempted: true, hardFailure: false, errorCode: 'cravatar_default_icon' }
                };
            }
            return {
                dataUrl,
                meta: result && result.meta ? result.meta : { attempted: true, hardFailure: false, errorCode: '' }
            };
        } catch (e) {
            return {
                dataUrl: '',
                meta: { attempted: true, hardFailure: true, errorCode: 'fetch_failed' }
            };
        }
    }
};

// 浏览器 API 兼容性
const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;

let __canvasViewSurfaceKeyInitPromise = null;

function __buildCanvasViewSurfaceKey({ isSidePanel, tabId, windowId }) {
    if (isSidePanel) {
        return Number.isFinite(windowId) ? `sidepanel:${windowId}` : 'sidepanel:unknown';
    }

    if (Number.isFinite(tabId)) return `tab:${tabId}`;
    if (Number.isFinite(windowId)) return `page-window:${windowId}`;
    return 'page:unknown';
}

function __setCanvasViewSurfaceGlobals(payload) {
    const safe = payload && typeof payload === 'object' ? payload : {};
    const surfaceKey = typeof safe.surfaceKey === 'string' && safe.surfaceKey
        ? safe.surfaceKey
        : (isSidePanelMode ? 'sidepanel:unknown' : 'page:unknown');

    try {
        const mode = safe.mode === 'sidepanel' ? 'sidepanel' : 'page';
        window.__CANVAS_VIEW_SURFACE_KEY__ = surfaceKey;
        window.__CANVAS_VIEW_PARTITION_KEY__ = mode;
        window.__CANVAS_VIEW_SURFACE_INFO__ = {
            mode,
            tabId: Number.isFinite(safe.tabId) ? safe.tabId : null,
            windowId: Number.isFinite(safe.windowId) ? safe.windowId : null,
            surfaceKey,
            partitionKey: mode,
            updatedAt: Date.now()
        };
    } catch (_) { }

    return surfaceKey;
}

async function __initCanvasViewSurfaceKey() {
    if (__canvasViewSurfaceKeyInitPromise) {
        return __canvasViewSurfaceKeyInitPromise;
    }

    __canvasViewSurfaceKeyInitPromise = (async () => {
        const payload = {
            mode: isSidePanelMode ? 'sidepanel' : 'page',
            tabId: null,
            windowId: null,
            surfaceKey: isSidePanelMode ? 'sidepanel:unknown' : 'page:unknown'
        };

        const tabIdPromise = (!isSidePanelMode && browserAPI?.tabs?.getCurrent)
            ? new Promise((resolve) => {
                try {
                    browserAPI.tabs.getCurrent((tab) => {
                        const id = tab && typeof tab.id === 'number' ? tab.id : null;
                        resolve(id);
                    });
                } catch (_) {
                    resolve(null);
                }
            })
            : Promise.resolve(null);

        const windowIdPromise = browserAPI?.windows?.getCurrent
            ? new Promise((resolve) => {
                try {
                    browserAPI.windows.getCurrent((win) => {
                        const id = win && typeof win.id === 'number' ? win.id : null;
                        resolve(id);
                    });
                } catch (_) {
                    resolve(null);
                }
            })
            : Promise.resolve(null);

        try {
            const withTimeout = (promise, timeoutMs = 180) => Promise.race([
                promise,
                new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
            ]);
            payload.tabId = await withTimeout(tabIdPromise);
            payload.windowId = await withTimeout(windowIdPromise);
        } catch (_) { }

        payload.surfaceKey = __buildCanvasViewSurfaceKey({
            isSidePanel: isSidePanelMode,
            tabId: payload.tabId,
            windowId: payload.windowId
        });

        return __setCanvasViewSurfaceGlobals(payload);
    })();

    return __canvasViewSurfaceKeyInitPromise;
}

__setCanvasViewSurfaceGlobals({ mode: isSidePanelMode ? 'sidepanel' : 'page' });

function getCacheStorageArea() {
    try {
        if (browserAPI && browserAPI.storage && browserAPI.storage.local) {
            return browserAPI.storage.local;
        }
    } catch (_) {
        // ignore
    }
    return null;
}

// =============================================================================
// Canvas 永久栏目副本：渲染同步（主永久栏目 -> 所有副本）
// =============================================================================

let permanentTreeCopySyncObserver = null;
let permanentTreeCopySyncTarget = null;
let permanentTreeCopySyncTimer = null;
let pendingPermanentTreeSharedMutationRefreshHandle = null;
const pendingPermanentTreeSharedMutationRefreshReasons = new Set();

function cancelScheduledPermanentTreeCopySync() {
    if (permanentTreeCopySyncTimer) {
        try { clearTimeout(permanentTreeCopySyncTimer); } catch (_) { }
    }
    permanentTreeCopySyncTimer = null;
}

function schedulePermanentTreeCopySync() {
    try {
        if (currentView !== 'canvas') return;
    } catch (_) { return; }

    const DEBOUNCE_MS = 220;
    cancelScheduledPermanentTreeCopySync();
    permanentTreeCopySyncTimer = setTimeout(() => {
        permanentTreeCopySyncTimer = null;
        syncPermanentTreeCopiesFromPrimary();
    }, DEBOUNCE_MS);
}
window.schedulePermanentTreeCopySync = schedulePermanentTreeCopySync;

function hasPermanentTreeCopyTargets() {
    try {
        if (currentView !== 'canvas') return false;
    } catch (_) { return false; }

    const canvasContent = document.getElementById('canvasContent');
    if (!canvasContent) return false;
    return !!canvasContent.querySelector('.permanent-bookmark-section.permanent-section-copy .bookmark-tree');
}

function refreshSharedPermanentTreeCopySourceData(reason = '') {
    const primaryTree = document.getElementById('bookmarkTree');
    if (!primaryTree && !hasPermanentTreeCopyTargets()) return false;
    if (!cachedCurrentTree || !Array.isArray(cachedCurrentTree) || !cachedCurrentTree[0]) return false;

    const nextRenderTree = cachedCurrentTree;

    try {
        cachedRenderTreeIndex = null;
        if (currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED && nextRenderTree && nextRenderTree[0]) {
            const idx = buildTreeIndexFromRoot(nextRenderTree[0]);
            if (idx) {
                cachedRenderTreeIndex = idx;
                try { window.__canvasRenderTreeIndex = idx; } catch (_) { }
            } else {
                try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            }
        } else {
            try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        }
    } catch (_) { }

    cachedTreeData = {
        ...(cachedTreeData || {}),
        currentTree: cachedCurrentTree,
        renderTree: nextRenderTree,
        treeFragment: null
    };

    if (reason) {
        ;
    }
    return true;
}

function __getPermanentTreeSharedSourceFingerprint() {
    try {
        const renderTree = cachedTreeData && Array.isArray(cachedTreeData.renderTree)
            ? cachedTreeData.renderTree
            : null;
        if (renderTree && renderTree[0]) return getTreeFingerprint(renderTree);
    } catch (_) { }

    try {
        const currentTree = cachedTreeData && Array.isArray(cachedTreeData.currentTree)
            ? cachedTreeData.currentTree
            : null;
        if (currentTree && currentTree[0]) return getTreeFingerprint(currentTree);
    } catch (_) { }

    try {
        const version = cachedTreeData && typeof cachedTreeData.version !== 'undefined'
            ? cachedTreeData.version
            : lastTreeSnapshotVersion;
        if (version !== null && typeof version !== 'undefined') return `version:${String(version)}`;
    } catch (_) { }

    return '';
}

function __flushPermanentTreeSharedMutationRefresh() {
    cancelScheduledPermanentTreeCopySync();
    if (pendingPermanentTreeSharedMutationRefreshHandle !== null) {
        try { clearTimeout(pendingPermanentTreeSharedMutationRefreshHandle); } catch (_) { }
    }
    pendingPermanentTreeSharedMutationRefreshHandle = null;

    try {
        if (currentView !== 'canvas') {
            pendingPermanentTreeSharedMutationRefreshReasons.clear();
            return;
        }
    } catch (_) {
        pendingPermanentTreeSharedMutationRefreshReasons.clear();
        return;
    }

    const reason = Array.from(pendingPermanentTreeSharedMutationRefreshReasons).join(',') || 'mutation';
    pendingPermanentTreeSharedMutationRefreshReasons.clear();
    refreshPermanentTreeSharedViewsAfterMutation(reason);
}

function schedulePermanentTreeSharedMutationRefresh(reason = '') {
    try {
        if (currentView !== 'canvas') return;
    } catch (_) { return; }

    const normalizedReason = String(reason || '').trim();
    if (normalizedReason) {
        pendingPermanentTreeSharedMutationRefreshReasons.add(normalizedReason);
    }
    
    if (pendingPermanentTreeSharedMutationRefreshHandle !== null) {
        try { clearTimeout(pendingPermanentTreeSharedMutationRefreshHandle); } catch (_) { }
    }

    pendingPermanentTreeSharedMutationRefreshHandle = setTimeout(() => {
        __flushPermanentTreeSharedMutationRefresh();
    }, 150);
}

function refreshPermanentTreeSharedViewsAfterMutation(reason = '') {
    try {
        // mutation 触发共享树重绘前，先把当前滚动位置同步到存储，
        // 避免 restore 阶段被 debounce 尚未落盘的旧值抢回去。
        if (typeof __flushPermanentSectionScrollStates === 'function') {
            __flushPermanentSectionScrollStates();
        }
    } catch (_) { }

    const refreshedSharedSource = refreshSharedPermanentTreeCopySourceData(reason);
    if (!refreshedSharedSource) return false;

    // 永久栏目主体和副本是“共享内容 + 独立交互壳”。
    // 实时增量事件如果只补主树局部 DOM，很容易在副本存在时把可见层级和共享源打散。
    // 这里统一把主体回到共享源，再让副本按同一份共享源同步。
    try {
        const rendered = !!__renderPermanentTreeSharedViews({
            includePrimary: true,
            includeCopies: true,
            reason: reason || 'mutation'
        });
        if (!rendered) {
            try { schedulePermanentTreeCopySync(); } catch (_) { }
        }
        return rendered;
    } catch (_) {
        try { schedulePermanentTreeCopySync(); } catch (_) { }
        return false;
    }
}

function __captureTreeExpandedNodeIds(tree) {
    const expanded = new Set();
    if (!tree) return expanded;
    try {
        tree.querySelectorAll('.tree-children.expanded').forEach(children => {
            const node = children.closest('.tree-node');
            const item = node ? node.querySelector(':scope > .tree-item[data-node-id]') : null;
            const stableId = __getTreeExpandStateIdentity(item);
            if (stableId) expanded.add(stableId);
        });
    } catch (_) { }
    return expanded;
}

function __resetTreeExpandedState(tree) {
    if (!tree) return;
    try {
        tree.querySelectorAll('.tree-children.expanded').forEach(children => {
            children.classList.remove('expanded');
        });
        tree.querySelectorAll('.tree-toggle.expanded').forEach(toggle => {
            toggle.classList.remove('expanded');
        });
        tree.querySelectorAll('.tree-item[data-node-type="folder"] .tree-icon.fas.fa-folder-open').forEach(icon => {
            icon.classList.remove('fa-folder-open');
            icon.classList.add('fa-folder');
        });
    } catch (_) { }
}

function __applyTreeExpandedNodeIds(tree, expandedNodeIds) {
    if (!tree || !expandedNodeIds) return;
    const expanded = expandedNodeIds instanceof Set ? expandedNodeIds : new Set(expandedNodeIds);
    if (!expanded.size) return;
    expanded.forEach(nodeId => {
        try {
            const item = __findTreeItemByExpandStateIdentity(tree, nodeId);
            if (!item) return;
            const node = item.closest('.tree-node');
            if (!node) return;
            const children = node.querySelector(':scope > .tree-children');
            const toggle = item.querySelector(':scope > .tree-toggle') || item.querySelector('.tree-toggle');
            if (children) children.classList.add('expanded');
            if (toggle) toggle.classList.add('expanded');
            const icon = item.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
            if (icon) {
                icon.classList.remove('fa-folder');
                icon.classList.add('fa-folder-open');
            }
        } catch (_) { }
    });
}

function __ensureTreeRootExpanded(tree) {
    if (!tree) return;
    try {
        const rootItem = tree.querySelector('.tree-item[data-node-type="folder"][data-node-level="0"][data-node-id]');
        if (!rootItem) return;
        const node = rootItem.closest('.tree-node');
        if (!node) return;
        const children = node.querySelector(':scope > .tree-children');
        const toggle = rootItem.querySelector('.tree-toggle');
        const icon = rootItem.querySelector('.tree-icon.fas');
        if (children) children.classList.add('expanded');
        if (toggle) toggle.classList.add('expanded');
        if (icon && icon.classList.contains('fa-folder')) {
            icon.classList.remove('fa-folder');
            icon.classList.add('fa-folder-open');
        }
    } catch (_) { }
}

// NOTE: bookmark_canvas_module.js already defines global PERMANENT_SECTION_EXPANDED_KEY.
// We must NOT redeclare it here (global const redeclare throws SyntaxError).
const __PERMANENT_SECTION_EXPANDED_KEY = (typeof PERMANENT_SECTION_EXPANDED_KEY !== 'undefined')
    ? PERMANENT_SECTION_EXPANDED_KEY
    : 'permanent-section-expanded';

const __CANVAS_VIEW_STATE_STORAGE_NS = 'canvas:view:v1';

function __getCanvasViewStatePartitionKey() {
    return isSidePanelMode ? 'sidepanel' : 'page';
}

function __buildCanvasPartitionedViewKey(kind, baseKey) {
    if (!kind || !baseKey) return baseKey;
    const partition = __getCanvasViewStatePartitionKey();
    return `${__CANVAS_VIEW_STATE_STORAGE_NS}:${kind}:${partition}:${baseKey}`;
}

function __getOtherCanvasViewStatePartitionKey(partitionKey = __getCanvasViewStatePartitionKey()) {
    return partitionKey === 'sidepanel' ? 'page' : 'sidepanel';
}

function __readCanvasPartitionedViewRawWithLegacyFallback(kind, baseKey, legacyKeys = []) {
    if (!kind || !baseKey) return null;
    const currentKey = __buildCanvasPartitionedViewKey(kind, baseKey);
    try {
        const rawCurrent = localStorage.getItem(currentKey);
        if (rawCurrent) return rawCurrent;
    } catch (_) { }

    const otherKey = `${__CANVAS_VIEW_STATE_STORAGE_NS}:${kind}:${__getOtherCanvasViewStatePartitionKey()}:${baseKey}`;
    try {
        const rawOther = localStorage.getItem(otherKey);
        if (rawOther) {
            try { localStorage.setItem(currentKey, rawOther); } catch (_) { }
            return rawOther;
        }
    } catch (_) { }

    const fallbackKeys = Array.from(new Set(
        (Array.isArray(legacyKeys) ? legacyKeys : [])
            .map((key) => String(key || '').trim())
            .filter(Boolean)
    ));
    for (const legacyKey of fallbackKeys) {
        try {
            const rawLegacy = localStorage.getItem(legacyKey);
            if (!rawLegacy) continue;
            try { localStorage.setItem(currentKey, rawLegacy); } catch (_) { }
            return rawLegacy;
        } catch (_) { }
    }
    return null;
}

function __getTreeExpandStateStorageKey(treeContainer) {
    try {
        const previewRoot = treeContainer && treeContainer.closest ? treeContainer.closest('#changesTreePreviewInline') : null;
        if (previewRoot) {
            const mode = previewRoot.classList && previewRoot.classList.contains('compact-mode') ? 'compact' : 'detailed';
            return `changesPreviewExpandedNodes:${mode}`;
        }
    } catch (_) { }

    // Canvas 永久栏目：每个副本独立持久化展开状态（不做同步），
    // 但按视图分区（page / sidepanel）分别记忆“最后一次状态”。
    try {
        if (currentView === 'canvas') {
            const section = treeContainer && treeContainer.closest ? treeContainer.closest('.permanent-bookmark-section') : null;
            if (section) {
                const copyId = section.dataset ? section.dataset.permanentSectionCopyId : null;
                const baseKey = copyId ? `${__PERMANENT_SECTION_EXPANDED_KEY}:${copyId}` : __PERMANENT_SECTION_EXPANDED_KEY;
                return __buildCanvasPartitionedViewKey('expand', baseKey);
            }
        }
    } catch (_) { }
    return 'treeExpandedNodeIds';
}

function __readTreeExpandStateFromStorage(treeContainer) {
    const key = __getTreeExpandStateStorageKey(treeContainer);
    try {
        const raw = localStorage.getItem(key);
        if (raw) return raw;
    } catch (_) { }

    try {
        if (currentView === 'canvas') {
            const section = treeContainer && treeContainer.closest ? treeContainer.closest('.permanent-bookmark-section') : null;
            if (section) {
                const copyId = section.dataset ? section.dataset.permanentSectionCopyId : null;
                const baseKey = copyId ? `${__PERMANENT_SECTION_EXPANDED_KEY}:${copyId}` : __PERMANENT_SECTION_EXPANDED_KEY;
                return __readCanvasPartitionedViewRawWithLegacyFallback('expand', baseKey, [baseKey]);
            }
        }
    } catch (_) { }
    return null;
}

function __getPermanentSectionScrollStorageKeyFromTree(tree) {
    try {
        const section = tree && tree.closest ? tree.closest('.permanent-bookmark-section') : null;
        const copyId = section && section.dataset ? section.dataset.permanentSectionCopyId : null;
        const baseKey = copyId ? `permanent-section-scroll:${copyId}` : 'permanent-section-scroll';
        return __buildCanvasPartitionedViewKey('scroll', baseKey);
    } catch (_) {
        return __buildCanvasPartitionedViewKey('scroll', 'permanent-section-scroll');
    }
}

function __readPermanentSectionScrollStateByCopyId(copyId = '') {
    const normalizedCopyId = String(copyId || '').trim();
    const baseKey = normalizedCopyId ? `permanent-section-scroll:${normalizedCopyId}` : 'permanent-section-scroll';
    const raw = __readCanvasPartitionedViewRawWithLegacyFallback('scroll', baseKey, [baseKey]);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function __readPermanentSectionScrollStateFromTree(tree) {
    try {
        const section = tree && tree.closest ? tree.closest('.permanent-bookmark-section') : null;
        const copyId = section && section.dataset ? section.dataset.permanentSectionCopyId : null;
        return __readPermanentSectionScrollStateByCopyId(copyId || '');
    } catch (_) {
        return __readPermanentSectionScrollStateByCopyId('');
    }
}

function __readLocalStorageJSON(key) {
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

// 统一写入入口（history.js）：
// - 约束：除本入口外，业务代码不要直接调用 localStorage.setItem。
function __saveLocalStorageRaw(key, value) {
    if (!key) return false;
    try {
        localStorage.setItem(key, String(value));
        return true;
    } catch (_) {
        return false;
    }
}

function __saveLocalStorageJSON(key, value) {
    if (!key) return false;
    try {
        return __saveLocalStorageRaw(key, JSON.stringify(value));
    } catch (_) {
        return false;
    }
}

function __removeLocalStorageKey(key) {
    if (!key) return false;
    try {
        localStorage.removeItem(key);
        return true;
    } catch (_) {
        return false;
    }
}

function __lazyLoadExpandedFolders(tree, expandedNodeIds) {
    if (!tree || !expandedNodeIds || typeof loadPermanentFolderChildrenLazy !== 'function') return;
    try {
        const ids = expandedNodeIds instanceof Set ? expandedNodeIds : new Set(expandedNodeIds);
        if (!ids.size) return;
        ids.forEach((nodeId) => {
            try {
                const item = __findTreeItemByExpandStateIdentity(tree, nodeId);
                if (!item) return;
                const node = item.closest('.tree-node');
                if (!node) return;
                const children = node.querySelector(':scope > .tree-children');
                if (!children) return;
                if (!__shouldHydratePermanentFolderChildren(item, children)) return;
                loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null);
            } catch (_) { }
        });
    } catch (_) { }
}

function __shouldHydratePermanentFolderChildren(item, children) {
    if (!item || !item.dataset || !children) return false;
    if (item.dataset.nodeType !== 'folder') return false;
    if (item.dataset.hasChildren !== 'true') return false;
    if (item.dataset.childrenLoaded === 'false') return true;

    // 某些实时更新/重渲染/清理路径下，DOM 可能出现“标记已加载，但子容器实际为空”。
    // 这时必须允许重新 hydrate，否则就会出现“展开了但没有内容”的假空状态。
    try {
        return !children.querySelector(':scope > .tree-node, :scope > .tree-load-more, :scope > .tree-lazy-actions-container');
    } catch (_) {
        return !(children.childElementCount > 0);
    }
}

function __hasPermanentTreeSharedContentSource() {
    const renderTree = cachedTreeData && Array.isArray(cachedTreeData.renderTree)
        ? cachedTreeData.renderTree
        : null;
    if (renderTree && renderTree[0]) return true;

    try {
        const cachedFragment = cachedTreeData && cachedTreeData.treeFragment;
        if (cachedFragment && cachedFragment.childNodes && cachedFragment.childNodes.length) {
            return true;
        }
    } catch (_) { }

    const primaryTree = document.getElementById('bookmarkTree');
    if (!primaryTree) return false;
    try {
        return !!primaryTree.querySelector(':scope > .empty-state, :scope > .error');
    } catch (_) {
        return false;
    }
}

function __appendClonedPermanentTreeFragment(targetFragment, sourceFragment) {
    if (!targetFragment || !sourceFragment) return false;
    try {
        const cloned = sourceFragment.cloneNode(true);
        if (!cloned) return false;
        if (cloned.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            while (cloned.firstChild) {
                targetFragment.appendChild(cloned.firstChild);
            }
        } else {
            targetFragment.appendChild(cloned);
        }
        return true;
    } catch (_) {
        return false;
    }
}

function __buildPermanentTreeSourceFragment() {
    const fragment = document.createDocumentFragment();

    // Prioritize cloning from the cached treeFragment to avoid redundant compilation/parsing.
    try {
        const cachedFragment = cachedTreeData && cachedTreeData.treeFragment
            ? cachedTreeData.treeFragment
            : null;
        if (cachedFragment) {
            if (__appendClonedPermanentTreeFragment(fragment, cachedFragment)) {
                return fragment;
            }
        }
    } catch (_) { }

    const renderTree = cachedTreeData && Array.isArray(cachedTreeData.renderTree)
        ? cachedTreeData.renderTree
        : null;
    const renderRoot = renderTree && renderTree[0] ? renderTree[0] : null;

    if (renderRoot) {
        try {
            const hintSet = (currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED && window.__canvasPermanentHintSet instanceof Set)
                ? window.__canvasPermanentHintSet
                : null;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = renderTreeNodeWithChanges(renderRoot, 0, 50, new Set(), hintSet);
            while (tempDiv.firstChild) {
                fragment.appendChild(tempDiv.firstChild);
            }
            // Cache the generated fragment (cloned) so subsequent copies in this render pass can clone it directly.
            if (cachedTreeData) {
                cachedTreeData.treeFragment = fragment.cloneNode(true);
            }
            return fragment;
        } catch (_) { }
    }

    const primaryTree = document.getElementById('bookmarkTree');
    if (!primaryTree) return null;
    try {
        const specialState = primaryTree.querySelector(':scope > .empty-state, :scope > .error');
        if (specialState) {
            fragment.appendChild(specialState.cloneNode(true));
            return fragment;
        }
    } catch (_) { }
    return null;
}

function __renderCachedPermanentTreeIntoPrimary(tree) {
    if (!tree) return false;
    if (__renderPermanentTreeIntoTree(tree)) {
        return true;
    }

    if (!(cachedTreeData && cachedTreeData.treeFragment)) {
        return false;
    }

    try {
        tree.innerHTML = '';
        tree.appendChild(cachedTreeData.treeFragment.cloneNode(true));
        return true;
    } catch (_) {
        return false;
    }
}

function __beginPermanentTreeRenderVisualLock(tree) {
    try {
        const section = tree && typeof tree.closest === 'function'
            ? tree.closest('.permanent-bookmark-section')
            : null;
        if (!section || !section.classList || !section.classList.contains('canvas-node-maximized')) return null;
        const body = typeof tree.closest === 'function' ? tree.closest('.permanent-section-body') : null;
        const treeRect = typeof tree.getBoundingClientRect === 'function' ? tree.getBoundingClientRect() : null;
        const bodyRect = body && typeof body.getBoundingClientRect === 'function' ? body.getBoundingClientRect() : null;
        const treeHeight = treeRect && Number.isFinite(treeRect.height) ? Math.ceil(treeRect.height) : 0;
        const bodyHeight = bodyRect && Number.isFinite(bodyRect.height) ? Math.ceil(bodyRect.height) : 0;
        const previousTreeMinHeight = tree.style.minHeight || '';
        const previousBodyMinHeight = body ? (body.style.minHeight || '') : '';
        if (treeHeight > 0) tree.style.minHeight = `${treeHeight}px`;
        if (body && bodyHeight > 0) body.style.minHeight = `${bodyHeight}px`;
        section.classList.add('permanent-tree-rerendering');
        if (body && body.classList) body.classList.add('permanent-tree-rerendering');
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            const restore = () => {
                try {
                    if (tree && tree.style) tree.style.minHeight = previousTreeMinHeight;
                    if (body && body.style) body.style.minHeight = previousBodyMinHeight;
                    if (section && section.classList) section.classList.remove('permanent-tree-rerendering');
                    if (body && body.classList) body.classList.remove('permanent-tree-rerendering');
                } catch (_) { }
            };
            try {
                requestAnimationFrame(() => {
                    try {
                        requestAnimationFrame(restore);
                    } catch (_) {
                        restore();
                    }
                });
            } catch (_) {
                setTimeout(restore, 32);
            }
        };
        setTimeout(release, 800);
        return release;
    } catch (_) {
        return null;
    }
}

function scanPermanentExpandedFolderCounts(tree) {
    const counts = {};
    if (tree) {
        tree.querySelectorAll('.tree-children.expanded').forEach(subContainer => {
            const parentItem = subContainer.previousElementSibling;
            const parentId = parentItem ? parentItem.dataset.nodeId : null;
            if (parentId) {
                const count = subContainer.querySelectorAll(':scope > .tree-node').length;
                const hasLoadMore = !!subContainer.querySelector(':scope > .tree-load-more') ||
                                    !!subContainer.querySelector(':scope > .tree-lazy-actions-container .tree-load-more');
                counts[parentId] = {
                    count: count,
                    fullyExpanded: !hasLoadMore
                };
            }
        });
    }
    return counts;
}

function __renderPermanentTreeIntoTree(tree, options = {}) {
    if (!tree) return false;

    const reason = String(options.reason || '').trim();
    const force = options.force === true
        || reason === 'render-finished'
        || reason.includes('mutation')
        || reason.includes('onCreated')
        || reason.includes('onRemoved')
        || reason.includes('onChanged')
        || reason.includes('onMoved')
        || reason.includes('bulk-add-remove')
        || reason.includes('browser-import');
    const sourceFingerprint = __getPermanentTreeSharedSourceFingerprint();
    try {
        if (!force && sourceFingerprint && tree.dataset.permanentTreeFingerprint === sourceFingerprint && tree.children.length) {
            return true;
        }
    } catch (_) { }

    try {
        tree._existingLoadedCounts = scanPermanentExpandedFolderCounts(tree);
        // 如果 DOM 快照为空（如页面刷新后首次渲染），从持久化存储恢复
        if (!tree._existingLoadedCounts || Object.keys(tree._existingLoadedCounts).length === 0) {
            const persisted = loadPermanentLoadedCounts();
            if (persisted && Object.keys(persisted).length > 0) {
                tree._existingLoadedCounts = persisted;
            }
        }
    } catch (_) {}

    const sourceFragment = __buildPermanentTreeSourceFragment();
    if (!sourceFragment) return false;

    const body = tree.closest('.permanent-section-body');
    const prevScrollTop = body ? body.scrollTop : null;
    const prevScrollLeft = body ? body.scrollLeft : 0;
    const prevExpanded = __captureTreeExpandedNodeIds(tree);
    let persistedExpanded = null;
    try {
        const raw = __readTreeExpandStateFromStorage(tree);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) {
                persistedExpanded = new Set(arr.map(String));
            }
        }
    } catch (_) { }

    let desiredScrollTop = prevScrollTop;
    let desiredScrollLeft = prevScrollLeft;
    try {
        const persisted = __readPermanentSectionScrollStateFromTree(tree);
        if (persisted && typeof persisted.top === 'number' && isFinite(persisted.top)) {
            desiredScrollTop = persisted.top;
            desiredScrollLeft = (typeof persisted.left === 'number' && isFinite(persisted.left)) ? persisted.left : 0;
        }
    } catch (_) { }

    const releaseVisualLock = __beginPermanentTreeRenderVisualLock(tree);
    try {
        tree.replaceChildren(sourceFragment);
    } catch (_) {
        tree.innerHTML = '';
        try { tree.appendChild(sourceFragment); } catch (_) { }
    }

    // Shared-source rerender replaces all tree-item nodes. Rebind per-node drag handlers
    // so permanent main/copies continue to support cross-column drag after sync/render.
    try {
        if (typeof attachDragEvents === 'function') {
            attachDragEvents(tree);
        }
    } catch (_) { }

    // 共享内容源重新渲染后，副本仍需保持自己的交互壳状态。
    try {
        tree.querySelectorAll('#bookmark-context-menu, .bookmark-context-menu').forEach(el => {
            try { el.remove(); } catch (_) { }
        });
        tree.querySelectorAll('.tree-item.context-selected').forEach(el => {
            try { el.classList.remove('context-selected'); } catch (_) { }
        });
    } catch (_) { }

    try { ensureCanvasLazyLegend(tree); } catch (_) { }

    __resetTreeExpandedState(tree);
    __ensureTreeRootExpanded(tree);
    const expandedFallback = (persistedExpanded && persistedExpanded.size)
        ? persistedExpanded
        : prevExpanded;
    if (expandedFallback && expandedFallback.size) {
        __applyTreeExpandedNodeIds(tree, expandedFallback);
        __lazyLoadExpandedFolders(tree, expandedFallback);
    }

    if (body && desiredScrollTop !== null) {
        __scheduleCanvasBodyScrollRestoreInHistory(body, {
            top: desiredScrollTop,
            left: desiredScrollLeft
        }, {
            isBlocked: () => __isCanvasBodyScrollRestoreBlocked(body),
            fallbackDelays: [80, 180, 360]
        });
    }

    try {
        if (sourceFingerprint) {
            tree.dataset.permanentTreeFingerprint = sourceFingerprint;
        }
        tree.dataset.permanentTreeRenderReason = reason || 'shared-render';
        tree.dataset.permanentTreeRenderRole = tree.id === 'bookmarkTree' ? 'primary' : 'copy';
    } catch (_) { }

    if (typeof releaseVisualLock === 'function') releaseVisualLock();

    try { delete tree._existingLoadedCounts; } catch (_) {}

    return true;
}
window.__renderPermanentTreeIntoTree = __renderPermanentTreeIntoTree;

function __collectPermanentTreeSharedRenderTargets(options = {}) {
    const includePrimary = options.includePrimary !== false;
    const includeCopies = options.includeCopies !== false;
    const trees = [];
    const seen = new Set();
    const primaryTree = document.getElementById('bookmarkTree');
    const pushTree = (tree) => {
        if (!tree || seen.has(tree)) return;
        seen.add(tree);
        trees.push(tree);
    };

    if (includePrimary && primaryTree) {
        pushTree(primaryTree);
    }

    if (!includeCopies) return trees;

    const canvasContent = document.getElementById('canvasContent');
    const scope = canvasContent || document;
    try {
        scope.querySelectorAll('.permanent-bookmark-section .bookmark-tree').forEach((tree) => {
            if (!includePrimary && tree === primaryTree) return;
            pushTree(tree);
        });
    } catch (_) { }

    return trees;
}

function __renderPermanentTreeSharedViews(options = {}) {
    try {
        if (currentView !== 'canvas') return false;
    } catch (_) {
        return false;
    }

    try {
        const state = window.CanvasModule && window.CanvasModule.CanvasState ? window.CanvasModule.CanvasState : null;
        const reason = String(options && options.reason ? options.reason : '').trim();
        const allowLowDetailRestore = reason === 'low-detail-exit';
        if (state && state.lowDetailActive && !allowLowDetailRestore) {
            return false;
        }
    } catch (_) { }

    if (!__hasPermanentTreeSharedContentSource()) return false;

    const targets = __collectPermanentTreeSharedRenderTargets(options);
    if (!targets.length) return false;

    let rendered = false;
    targets.forEach((tree) => {
        try {
            if (__renderPermanentTreeIntoTree(tree, options)) {
                rendered = true;
            }
        } catch (_) { }
    });

    return rendered;
}
window.__renderPermanentTreeSharedViews = __renderPermanentTreeSharedViews;

function syncPermanentTreeCopiesFromPrimary() {
    __renderPermanentTreeSharedViews({
        includePrimary: false,
        includeCopies: true,
        reason: 'scheduled-copy-sync'
    });
}

function ensurePermanentTreeCopySync() {
    const primaryTree = document.getElementById('bookmarkTree');
    if (!primaryTree) return;

    // 共享树模型已经由统一渲染入口接管。
    // 这里不再用 MutationObserver 盯着主树变化，否则会把“一次共享渲染”
    // 再次放大成“主树变更 -> 副本补刷”的第二轮可见刷新。
    if (typeof window.__renderPermanentTreeSharedViews === 'function') {
        teardownPermanentTreeCopySync();
        return;
    }

    if (permanentTreeCopySyncObserver && permanentTreeCopySyncTarget === primaryTree) return;

    teardownPermanentTreeCopySync();

    permanentTreeCopySyncTarget = primaryTree;
    permanentTreeCopySyncObserver = new MutationObserver(() => {
        try {
            if (currentView !== 'canvas') return;
        } catch (_) { return; }

        schedulePermanentTreeCopySync();
    });

    // 同步必须覆盖“增/删/改/移”的标识与内容更新：
    // - childList: 徽标插入/节点插入/移动
    // - characterData: 标题文本更新
    // - attributes: href/title/data-* 等的更新
    permanentTreeCopySyncObserver.observe(primaryTree, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
            'href',
            'title',
            'data-node-title',
            'data-node-url',
            'data-move-from'
        ]
    });
    // 触发一次初始同步（通过 debounce 合并，避免和首屏渲染的 mutation “打架”造成闪烁）
    setTimeout(schedulePermanentTreeCopySync, 0);
}

function teardownPermanentTreeCopySync() {
    if (permanentTreeCopySyncObserver) {
        try { permanentTreeCopySyncObserver.disconnect(); } catch (_) { }
    }
    permanentTreeCopySyncObserver = null;
    permanentTreeCopySyncTarget = null;
    cancelScheduledPermanentTreeCopySync();
}

// Debug helper: inspect copy-specific persisted states (run in DevTools: `__debugPermanentCopyStates()`)
function __debugPermanentCopyStates() {
    try {
        const canvasContent = document.getElementById('canvasContent');
        if (!canvasContent) {
            ;
            return;
        }
        const sections = Array.from(canvasContent.querySelectorAll('.permanent-bookmark-section.permanent-section-copy'));
        if (!sections.length) {
            ;
            return;
        }
        sections.forEach((sec) => {
            const copyId = sec.dataset ? sec.dataset.permanentSectionCopyId : null;
            const tree = sec.querySelector('.bookmark-tree');
            const body = sec.querySelector('.permanent-section-body');

            const scrollKey = tree ? __getPermanentSectionScrollStorageKeyFromTree(tree) : (copyId ? `permanent-section-scroll:${copyId}` : 'permanent-section-scroll');
            const expandKey = tree ? __getTreeExpandStateStorageKey(tree) : null;

            let storedScroll = null;
            let storedExpandedCount = null;
            try {
                storedScroll = __readLocalStorageJSON(scrollKey);
            } catch (_) { }
            try {
                if (expandKey) {
                    let raw = localStorage.getItem(expandKey);
                    const parsed = raw ? JSON.parse(raw) : null;
                    storedExpandedCount = Array.isArray(parsed) ? parsed.length : null;
                }
            } catch (_) { }

            let runtimeExpandedCount = null;
            try { runtimeExpandedCount = tree ? tree.querySelectorAll('.tree-children.expanded').length : null; } catch (_) { }

            ;
        });
    } catch (e) {
        console.error('[DebugCopyState] failed:', e);
    }
}
window.__debugPermanentCopyStates = __debugPermanentCopyStates;

function readCachedValue(key) {
    return new Promise((resolve) => {
        const storageArea = getCacheStorageArea();
        if (storageArea) {
            storageArea.get([key], (result) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    console.warn('[Cache] 读取失败:', browserAPI.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                resolve(result ? result[key] : null);
            });
            return;
        }

        try {
            const raw = localStorage.getItem(key);
            resolve(raw ? JSON.parse(raw) : null);
        } catch (error) {
            console.warn('[Cache] 读取 localStorage 失败:', error);
            resolve(null);
        }
    });
}

function writeCachedValue(key, value) {
    return new Promise((resolve) => {
        const storageArea = getCacheStorageArea();
        if (storageArea) {
            storageArea.set({ [key]: value }, () => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    console.warn('[Cache] 写入失败:', browserAPI.runtime.lastError.message);
                }
                resolve();
            });
            return;
        }

        try {
            __saveLocalStorageJSON(key, value);
        } catch (error) {
            console.warn('[Cache] 写入 localStorage 失败:', error);
        }
        resolve();
    });
}

function normalizeBookmarkCacheEntry(entry) {
    if (!entry || !entry.url) return null;
    const timestamp = typeof entry.dateAdded === 'number'
        ? entry.dateAdded
        : (entry.dateAdded instanceof Date ? entry.dateAdded.getTime() : Date.now());
    return {
        id: entry.id,
        title: entry.title || entry.url || '',
        url: entry.url || '',
        dateAdded: timestamp,
        parentId: entry.parentId || '',
        path: entry.path || ''
    };
}

async function ensureBookmarkCacheLoaded(skipRender) {
    if (bookmarkCacheRestored || allBookmarks.length > 0) {
        return;
    }
    try {
        const cached = await readCachedValue(DATA_CACHE_KEYS.bookmarks);
        if (cached && Array.isArray(cached.bookmarks)) {
            allBookmarks = cached.bookmarks
                .map(normalizeBookmarkCacheEntry)
                .filter(Boolean);
            bookmarkCacheRestored = true;
            rebuildBookmarkUrlSet();
            ;
            if (!skipRender) {
            }
        }
    } catch (error) {
        console.warn('[BookmarkCache] 恢复失败:', error);
    }
}

async function persistBookmarkCache() {
    try {
        const payload = {
            timestamp: Date.now(),
            bookmarks: allBookmarks.map(normalizeBookmarkCacheEntry).filter(Boolean)
        };
        await writeCachedValue(DATA_CACHE_KEYS.bookmarks, payload);
        ;
    } catch (error) {
        console.warn('[BookmarkCache] 保存失败:', error);
    }
}

function scheduleBookmarkCacheSave() {
    if (saveBookmarkCacheTimer) {
        clearTimeout(saveBookmarkCacheTimer);
    }
    saveBookmarkCacheTimer = setTimeout(() => {
        saveBookmarkCacheTimer = null;
        persistBookmarkCache();
    }, 600);
}

function handleBookmarkCacheMutation(forceRender = true) {
    bookmarkCacheRestored = true;
    scheduleBookmarkCacheSave();
}

function addBookmarkToCache(bookmark) {
    const normalized = normalizeBookmarkCacheEntry(bookmark);
    if (!normalized) return;
    allBookmarks.push(normalized);
    addUrlToBookmarkSet(normalized.url);
    const normalizedTitle = normalizeBookmarkTitle(normalized.title);
    if (normalizedTitle) {
        bookmarkTitleSet.add(normalizedTitle);
    }
    handleBookmarkCacheMutation(true);
}

function removeBookmarkFromCache(bookmarkId, removeInfo = null) {
    if (!bookmarkId) return;
    const descendants = new Set([String(bookmarkId)]);
    const removedNode = removeInfo && (removeInfo.node || removeInfo.bookmark);
    if (removedNode && Array.isArray(removedNode.children)) {
        const stack = [...removedNode.children];
        while (stack.length) {
            const child = stack.pop();
            if (child) {
                if (child.id) descendants.add(String(child.id));
                if (Array.isArray(child.children)) stack.push(...child.children);
            }
        }
    }

    // Pre-collect all URLs of bookmarks that are NOT being deleted to make check O(1)
    const remainingUrls = new Set();
    for (const item of allBookmarks) {
        if (!descendants.has(String(item.id))) {
            remainingUrls.add(item.url);
        }
    }

    let changed = false;
    allBookmarks = allBookmarks.filter(item => {
        if (descendants.has(String(item.id))) {
            if (!remainingUrls.has(item.url)) {
                removeUrlFromBookmarkSet(item.url);
            }
            changed = true;
            return false;
        }
        return true;
    });

    if (changed) {
        handleBookmarkCacheMutation(true);
    }
}

function updateBookmarkInCache(bookmarkId, changeInfo = {}) {
    if (!bookmarkId) return;
    const target = allBookmarks.find(item => item.id === bookmarkId);
    if (!target) return;
    const prevUrl = target.url;
    if (typeof changeInfo.title !== 'undefined') {
        target.title = changeInfo.title;
        const normalizedTitle = normalizeBookmarkTitle(changeInfo.title);
        if (normalizedTitle) {
            bookmarkTitleSet.add(normalizedTitle);
        }
    }
    if (typeof changeInfo.url !== 'undefined') {
        target.url = changeInfo.url;
        const isUrlShared = allBookmarks.some(item => item.id !== bookmarkId && item.url === prevUrl);
        if (!isUrlShared) {
            removeUrlFromBookmarkSet(prevUrl);
        }
        addUrlToBookmarkSet(changeInfo.url);
    }
    handleBookmarkCacheMutation(true);
}

function moveBookmarkInCache(bookmarkId, moveInfo = {}) {
    if (!bookmarkId) return;
    const target = allBookmarks.find(item => item.id === bookmarkId);
    if (!target) return;
    if (typeof moveInfo.parentId !== 'undefined') {
        target.parentId = moveInfo.parentId;
    }
    handleBookmarkCacheMutation(false);
}

function normalizeBookmarkTitle(title) {
    if (!title || typeof title !== 'string') return null;
    const trimmed = title.trim();
    return trimmed || null;
}

function normalizeBookmarkUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return null;
    }
    return url.trim();
}

function rebuildBookmarkUrlSet() {
    bookmarkUrlSet.clear();
    bookmarkTitleSet.clear();
    allBookmarks.forEach(item => {
        const normalized = normalizeBookmarkUrl(item.url);
        if (normalized) {
            bookmarkUrlSet.add(normalized);
        }
        const normalizedTitle = normalizeBookmarkTitle(item.title);
        if (normalizedTitle) {
            bookmarkTitleSet.add(normalizedTitle);
        }
    });
}

function addUrlToBookmarkSet(url) {
    const normalized = normalizeBookmarkUrl(url);
    if (normalized) {
        bookmarkUrlSet.add(normalized);
    }
}

function removeUrlFromBookmarkSet(url) {
    const normalized = normalizeBookmarkUrl(url);
    if (normalized) {
        bookmarkUrlSet.delete(normalized);
    }
}

// 实时更新状态控制
let messageListenerRegistered = false;
let canvasFullscreenBridgeStorageListenerBound = false;
let lastHandledCanvasFullscreenBridgeNonce = null;
let sidePanelMirroredCanvasFullscreen = false;
let pendingCanvasFullscreenBridgeNonces = new Set();
// 显式移动集合（基于 onMoved 事件），用于同级移动标识，设置短期有效期
// 页面刷新/重新打开时，恢复“显式移动”标记

// =============================================================================
// 辅助函数 - URL 处理
// =============================================================================

// 安全地获取网站图标 URL（同步版本，用于兼容旧代码）
// 注意：这个函数会触发后台异步加载，初次调用返回fallbackIcon
function getFaviconUrl(url) {
    if (!url) return fallbackIcon;

    // 验证是否是有效的 HTTP/HTTPS URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return fallbackIcon;
    }

    // 检查是否是无效URL
    if (FaviconCache.isInvalidUrl(url)) {
        return fallbackIcon;
    }

    try {
        const domain = FaviconCache._getHostnameKey(url);
        if (!domain) return fallbackIcon;

        // 【关键修复】先检查内存缓存（在 renderTreeView 时已预热）
        if (FaviconCache.memoryCache.has(domain)) {
            return FaviconCache.memoryCache.get(domain);
        }

        // 检查失败缓存
        if (FaviconCache._isFailureDomainActive(domain)) {
            FaviconCache.fetch(url, {
                speedFirst: true,
                ignoreFailureCache: true
            }).then(dataUrl => {
                if (dataUrl && dataUrl !== fallbackIcon) {
                    updateFaviconImages(url, dataUrl);
                }
            }).catch(() => { });
            return fallbackIcon;
        }

        // 触发后台异步加载（不等待结果）
        // 注意：由于在 renderTreeView 时已经预热了缓存，
        // 这里只是作为兜底机制，处理动态添加的书签
        FaviconCache.fetch(url, { speedFirst: true }).then(dataUrl => {
            // 加载完成后，查找并更新所有使用这个URL的img标签
            if (dataUrl && dataUrl !== fallbackIcon) {
                updateFaviconImages(url, dataUrl);
            }
        });

        // 立即返回 fallback 图标作为占位符
        return fallbackIcon;
    } catch (error) {
        return fallbackIcon;
    }
}

function resolveFaviconBindingUrlFromElement(element) {
    if (!element) return '';

    const readFrom = (node) => {
        if (!node) return '';
        if (node.dataset) {
            if (node.dataset.bookmarkUrl) return node.dataset.bookmarkUrl;
            if (node.dataset.nodeUrl) return node.dataset.nodeUrl;
            if (node.dataset.url) return node.dataset.url;
        }
        if (typeof node.getAttribute === 'function') {
            return node.getAttribute('data-bookmark-url')
                || node.getAttribute('data-node-url')
                || node.getAttribute('data-url')
                || '';
        }
        return '';
    };

    let itemUrl = readFrom(element);
    if (!itemUrl && typeof element.closest === 'function') {
        const item = element.closest('[data-node-url], [data-bookmark-url], [data-url]');
        itemUrl = readFrom(item);
    }
    return typeof itemUrl === 'string' ? itemUrl.trim() : '';
}

// 更新页面上所有指定URL的favicon图片
function updateFaviconImages(url, dataUrl) {
    let updatedCount = 0;
    try {
        const domain = FaviconCache._getHostnameKey(url);
        if (!domain) return 0;

        const allImages = document.querySelectorAll(
            'img.tree-icon, img.canvas-bookmark-icon, img.search-result-favicon, img[data-bookmark-url], img[data-node-url], img[data-url]'
        );

        allImages.forEach(img => {
            const itemUrl = resolveFaviconBindingUrlFromElement(img);
            if (!itemUrl) return;

            try {
                const itemDomain = FaviconCache._getHostnameKey(itemUrl);
                if (itemDomain !== domain) return;
                if (img.src === dataUrl) return;

                img.src = dataUrl;
                if (img.style.display === 'none') {
                    img.style.display = '';
                    const prevSibling = img.previousElementSibling;
                    if (prevSibling && prevSibling.classList.contains('search-result-icon-box-inline')) {
                        prevSibling.style.display = 'none';
                    } else {
                        const parent = img.parentElement;
                        if (parent) {
                            const inlineFallbackIcon = parent.querySelector('.search-result-icon-box-inline');
                            if (inlineFallbackIcon) {
                                inlineFallbackIcon.style.display = 'none';
                            }
                        }
                    }
                }

                updatedCount++;
            } catch (_) {
                // 忽略无效URL
            }
        });
    } catch (_) {
        // 静默处理
    }
    return updatedCount;
}

// 全局图片错误处理（使用事件委托，避免CSP内联事件处理器）
function setupGlobalImageErrorHandler() {
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG' &&
            (e.target.classList.contains('tree-icon') ||
                e.target.classList.contains('canvas-bookmark-icon') ||
                e.target.classList.contains('search-result-favicon'))) {
            // 只在src不是fallbackIcon时才替换，避免无限循环
            // fallbackIcon 是 data URL，不会加载失败
            if (e.target.src !== fallbackIcon && !e.target.src.startsWith('data:image/svg+xml')) {
                e.target.src = fallbackIcon;
            }
        }
    }, true); // 使用捕获阶段
}

// 异步获取favicon（推荐使用，支持完整缓存）
async function getFaviconUrlAsync(url) {
    if (!url) return fallbackIcon;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return fallbackIcon;
    }

    return await FaviconCache.fetch(url);
}

// Fallback 图标 - 星标书签图标
const fallbackIcon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath fill=%22%23999%22 d=%22M8 0l2.8 5.5 6.2 0.5-4.5 4 1.5 6-5.5-3.5-5.5 3.5 1.5-6-4.5-4 6.2-0.5z%22/%3E%3C/svg%3E';

// Edge/Chrome 内置页面 scheme 不同（仅用于展示/跳转提示）
const internalScheme = (navigator.userAgent || '').includes('Edg/') ? 'edge://' : 'chrome://';

// =============================================================================
// 国际化文本
// =============================================================================

const i18n = {
    pageTitle: {
        'zh_CN': '书签画布',
        'en': 'Bookmark Canvas'
    },
    pageSubtitle: {
        'zh_CN': '',
        'en': ''
    },
    searchPlaceholder: {
        'zh_CN': '搜索书签、文件夹...',
        'en': 'Search bookmarks, folders...'
    },
    helpTooltip: {
        'zh_CN': '快捷键',
        'en': 'Shortcuts'
    },
    settingsTooltip: {
        'zh_CN': '设置',
        'en': 'Settings'
    },
    settingsThemeText: {
        'zh_CN': '主题切换',
        'en': 'Toggle Theme'
    },
    settingsLanguageText: {
        'zh_CN': '中文 / English',
        'en': '中文 / English'
    },
    settingsHelpText: {
        'zh_CN': '快捷键',
        'en': 'Shortcuts'
    },
    settingsOpenSourceText: {
        'zh_CN': '开源信息',
        'en': 'Open Source'
    },
    settingsFloatText: {
        'zh_CN': '悬浮工具窗状态',
        'en': 'Floating Tools Status'
    },
    floatingToolsModeNoneText: {
        'zh_CN': '不显示',
        'en': 'Off'
    },
    floatingToolsModeHiddenText: {
        'zh_CN': '隐藏',
        'en': 'Hide'
    },
    floatingToolsModeShownText: {
        'zh_CN': '显示',
        'en': 'Show'
    },
    floatingToolsModeGroupLabel: {
        'zh_CN': '显示/隐藏',
        'en': 'Show/Hide'
    },
    floatingToolsHideTitle: {
        'zh_CN': '隐藏悬浮工具窗',
        'en': 'Hide floating tools'
    },
    floatingToolsMiniShowTitle: {
        'zh_CN': '显示悬浮工具窗',
        'en': 'Show floating tools'
    },
    settingsSidePanelText: {
        'zh_CN': '侧边栏管理',
        'en': 'Side Panel'
    },
    settingsCanvasManageText: {
        'zh_CN': '画布管理',
        'en': 'Canvas Management'
    },
    settingsOtherManageText: {
        'zh_CN': '其他管理',
        'en': 'Other Manage'
    },
    openCanvasPageTooltip: {
        'zh_CN': 'HTML 页面',
        'en': 'HTML Page'
    },
    titleSidePanelToggleTooltip: {
        'zh_CN': '侧边栏',
        'en': 'Side Panel'
    },
    headerToggleCollapseTooltip: {
        'zh_CN': '收起标题栏',
        'en': 'Collapse header'
    },
    headerToggleExpandTooltip: {
        'zh_CN': '展开标题栏',
        'en': 'Expand header'
    },
    quickAddTooltip: {
        'zh_CN': '添加',
        'en': 'Add'
    },
    titleLastFullscreenTooltip: {
        'zh_CN': '上次全屏卡片',
        'en': 'Last Fullscreen Card'
    },
    titleLastFullscreenNoCardToast: {
        'zh_CN': '未找到上次全屏卡片',
        'en': 'No previous fullscreen card found'
    },
    quickAddCurrentTitle: {
        'zh_CN': '当前页 | 选中标签页',
        'en': 'Current | Selected Tabs'
    },
    quickAddWindowTitle: {
        'zh_CN': '当前窗口全部',
        'en': 'Current Window'
    },
    quickAddCurrentTempText: {
        'zh_CN': '加入特殊临时栏目',
        'en': 'Add to Special Temp'
    },
    quickAddCurrentPermanentText: {
        'zh_CN': '添加到永久栏目',
        'en': 'Add to Permanent'
    },
    quickAddCurrentBlankText: {
        'zh_CN': '添加到空白栏目',
        'en': 'Add to Blank'
    },
    quickAddCurrentViewText: {
        'zh_CN': '添加到当前栏目',
        'en': 'Add to Current Column'
    },
    quickAddWindowViewText: {
        'zh_CN': '当前窗口全部到当前栏目',
        'en': 'Add Window Tabs to Current Column'
    },
    quickAddWindowTempText: {
        'zh_CN': '全部加入特殊临时栏目',
        'en': 'Add All to Special Temp'
    },
    quickAddWindowPermanentText: {
        'zh_CN': '全部加入永久栏目',
        'en': 'Add All to Permanent'
    },
    quickAddWindowBlankText: {
        'zh_CN': '全部加入空白栏目',
        'en': 'Add All to Blank'
    },
    quickAddAllWindowsTitle: {
        'zh_CN': '所有窗口全部',
        'en': 'All Windows'
    },
    quickAddAllWindowsCardGroupText: {
        'zh_CN': '一键存档（卡片组）',
        'en': 'Archive All (Card Group)'
    },
    navCanvas: {
        'zh_CN': '书签画布',
        'en': 'Bookmark Canvas'
    },
    importCanvasText: {
        'zh_CN': '导入',
        'en': 'Import'
    },
    exportCanvasText: {
        'zh_CN': '导出',
        'en': 'Export'
    },
    backupCanvasText: {
        'zh_CN': '备份',
        'en': 'Backup'
    },
    githubConfigText: {
        'zh_CN': '配置',
        'en': 'Config'
    },
    githubPushText: {
        'zh_CN': '推送',
        'en': 'Push'
    },
    githubPullText: {
        'zh_CN': '拉取',
        'en': 'Pull'
    },
    clearMenuText: {
        'zh_CN': '清除',
        'en': 'Clear'
    },
    clearByClickText: {
        'zh_CN': '点击清除',
        'en': 'Click to Clear'
    },
    clearAllText: {
        'zh_CN': '清除全部（永久栏目除外）',
        'en': 'Clear All (Except Permanent)'
    },
    canvasFullscreenEnter: {
        'zh_CN': '全屏',
        'en': 'Fullscreen'
    },
    canvasFullscreenExit: {
        'zh_CN': '退出',
        'en': 'Exit'
    },
    canvasZoomLabel: {
        'zh_CN': '缩放',
        'en': 'Zoom'
    },
    zoomInTitle: {
        'zh_CN': '放大 (10%)',
        'en': 'Zoom In (10%)'
    },
    zoomOutTitle: {
        'zh_CN': '缩小 (10%)',
        'en': 'Zoom Out (10%)'
    },
    zoomLocateTitle: {
        'zh_CN': '定位到永久栏目',
        'en': 'Locate to Permanent Section'
    },
    zoomLocateText: {
        'zh_CN': '定位',
        'en': 'Locate'
    },
    canvasManageText: {
        'zh_CN': '管理',
        'en': 'Manage'
    },
    canvasManageTitle: {
        'zh_CN': '画布管理',
        'en': 'Canvas Manage'
    },
    canvasOtherManageTitle: {
        'zh_CN': '其他管理',
        'en': 'Other Manage'
    },
    canvasSidePanelSettingsText: {
        'zh_CN': '侧边栏',
        'en': 'Side Panel'
    },
    canvasSidePanelSettingsTitle: {
        'zh_CN': '侧边栏管理',
        'en': 'Side Panel'
    },
    canvasPerfSettingsText: {
        'zh_CN': '性能',
        'en': 'Performance'
    },
    canvasAppearanceSettingsText: {
        'zh_CN': '外观',
        'en': 'Appearance'
    },
    canvasOtherSettingsText: {
        'zh_CN': '缩放',
        'en': 'Zoom'
    },
    canvasManageSectionGeneralText: {
        'zh_CN': '常规',
        'en': 'General'
    },
    canvasManageSectionOtherText: {
        'zh_CN': '其他',
        'en': 'Other'
    },
    canvasManageSectionStorageText: {
        'zh_CN': '存储与同步',
        'en': 'Storage & Sync'
    },
    canvasManageSectionSyncText: {
        'zh_CN': '视图同步',
        'en': 'View Sync'
    },
    canvasViewSyncToggleText: {
        'zh_CN': '视图同步',
        'en': 'View Sync'
    },
    canvasViewSyncCameraText: {
        'zh_CN': '同步相机/模式',
        'en': 'Sync Camera/Mode'
    },
    canvasViewSyncExpandScrollText: {
        'zh_CN': '同步展开与滚动',
        'en': 'Sync Expand + Scroll'
    },
    canvasViewSyncHintGlobalText: {
        'zh_CN': '相机：相机就是我们当前窗口的视图。\n全屏模式：指永久栏目/临时栏目/空白栏目卡片的全屏（最大化）状态。\n展开与滚动：指永久栏目或临时栏目中文件夹的展开状态，以及垂直滚动条的滚动位置。\n内容类：主数据/外观/设置始终全局共享，标签页与侧边栏会看到同一份内容。',
        'en': 'Camera: The camera is the current window viewport.\nFullscreen Mode: Card fullscreen (maximized) state for permanent/temporary/blank cards.\nExpand & Scroll: Folder expanded/collapsed state in permanent or temporary sections, plus the vertical scrollbar position.\nContent State: Main data / appearance / settings are globally shared across Tab and Side Panel.'
    },
    canvasViewSyncHintCameraLabel: {
        'zh_CN': '相机：',
        'en': 'Camera:'
    },
    canvasViewSyncHintCameraText: {
        'zh_CN': '相机就是我们当前的视图。',
        'en': 'The camera is the current viewport.'
    },
    canvasViewSyncHintExpandScrollLabel: {
        'zh_CN': '展开与滚动：',
        'en': 'Expand & Scroll:'
    },
    canvasViewSyncHintExpandScrollText: {
        'zh_CN': '指永久栏目或临时栏目中文件夹的展开状态，以及垂直滚动条的滚动位置。',
        'en': 'Folder expanded/collapsed state in permanent or temporary sections, plus the vertical scrollbar position.'
    },
    canvasViewSyncHintContentLabel: {
        'zh_CN': '内容类：',
        'en': 'Content State:'
    },
    canvasViewSyncHintContentText: {
        'zh_CN': '主数据/外观/设置始终全局共享，标签页与侧边栏会看到同一份内容。',
        'en': 'Main data / appearance / settings are globally shared across Tab and Side Panel.'
    },
    canvasViewSyncHintViewLabel: {
        'zh_CN': '视图类：',
        'en': 'View State:'
    },
    canvasViewSyncHintViewText: {
        'zh_CN': '例如相机、全屏模式、展开与滚动（<strong><u>以当前窗口为准</u></strong>），按 标签页 与 侧边栏 <strong><u>分区独立</u></strong>。',
        'en': 'For example, camera/fullscreen mode/expand/scroll (<strong><u>using current window</u></strong>) are <strong><u>independent</u></strong> between Tab and Side Panel.'
    },
    canvasHelpBtnTitle: {
        'zh_CN': '说明',
        'en': 'Help'
    },
    canvasHelpModalTitle: {
        'zh_CN': '说明',
        'en': 'Help'
    },
    canvasHelpTabShortcuts: {
        'zh_CN': '快捷键',
        'en': 'Shortcuts'
    },
    canvasHelpTabRelease: {
        'zh_CN': '画布基础',
        'en': 'Canvas Basics'
    },
    canvasHelpTabFeatures: {
        'zh_CN': '特性',
        'en': 'Features'
    },
    canvasHelpTabOpenSource: {
        'zh_CN': '开源信息',
        'en': 'Open Source'
    },
    canvasHelpPanelShortcuts: {
        'zh_CN': `<h2>快捷键说明</h2>
<h3>Ctrl 键操作</h3>
<ul>
<li><strong>Ctrl + 左键（按住）</strong>：拖动画布 或 栏目卡片</li>
<li><strong>Ctrl + 滚轮（或 触控板双指滑动）</strong>：缩放画布</li>
<li><strong>Ctrl + 右键（单击）</strong>：更改栏目卡片的大小</li>
</ul>
<h3>空格键操作</h3>
<ul>
<li><strong>空格 + 左键（按住）</strong>：拖动全局画布</li>
</ul>
<h3>触控板操作</h3>
<ul>
<li><strong>双指捏合</strong>：缩放画布</li>
<li><strong>Ctrl + 双指滑动</strong>：缩放（兼容侧边栏）</li>
<li><strong>双指滑动</strong>：拖动画布</li>
</ul>
<hr>
<p><em>快捷键可在左上角「管理」中自定义</em></p>`,
        'en': `<h2>Keyboard Shortcuts</h2>
<h3>Ctrl Key Operations</h3>
<ul>
<li><strong>Ctrl + Left Click (hold)</strong>: Drag canvas or section card</li>
<li><strong>Ctrl + Scroll (or Trackpad swipe)</strong>: Zoom canvas</li>
<li><strong>Ctrl + Right Click</strong>: Resize section card</li>
</ul>
<h3>Space Key Operations</h3>
<ul>
<li><strong>Space + Left Click (hold)</strong>: Drag global canvas</li>
</ul>
<h3>Touchpad Operations</h3>
<ul>
<li><strong>Pinch gesture</strong>: Zoom canvas</li>
<li><strong>Ctrl + swipe</strong>: Zoom (Sidebar compatible)</li>
<li><strong>Two-finger swipe</strong>: Drag canvas</li>
</ul>
<hr>
<p><em>Shortcuts can be customized in the "Manage" button at top-left</em></p>`
    },
    canvasHelpPanelRelease: {
        'zh_CN': `<h2>画布基础</h2>
<ol>
<li><strong>拖动书签/文件夹至空白处</strong>，<font color="#44cf6e">创建书签型临时节点</font>；</li>
<li>临时节点的修改 <strong>不计入核心数据</strong>，可用于对比查看/整理；</li>
<li><strong>栏目间可互相拖动/粘贴</strong>。</li>
</ol>
<hr>
<h3>基本操作</h3>
<ul>
<li><strong>创建临时栏目</strong>：从书签树拖动书签到空白处</li>
<li><strong>创建空白卡片</strong>：双击画布空白处</li>
<li><strong>创建卡片组</strong>：框选多个元素后创建组，或右键画布空白处创建空组</li>
<li><strong>画布元素</strong>：永久栏目及其副本、临时栏目、空白栏目、卡片组、连接线</li>
</ul>
<hr>
<h3>连接线</h3>
<ul>
<li><strong>创建连接</strong>：点击栏目边缘连接点，拖向另一栏目</li>
<li><strong>编辑连接</strong>：点击连接线，可修改颜色、方向、标签</li>
<li><strong>预设颜色</strong>：<font color="#66bbff">蓝</font>、<font color="#fb464c">红</font>、<font color="#e9973f">橙</font>、<font color="#e0de71">黄</font>、<font color="#44cf6e">绿</font>、<font color="#53dfdd">青</font>、<font color="#a882ff">紫</font></li>
</ul>
<hr>
<h3>卡片组</h3>
<ul>
<li><strong>嵌套组</strong>：把栏目、空白卡片或其他组放进组框内，即可形成嵌套关系</li>
<li><strong>组内整理</strong>：卡片组按 <code>.canvas</code> 几何包含关系保存，不需要手动维护 children</li>
<li><strong>组导出</strong>：卡片组或临时选区可以单独导出为小型画布包</li>
</ul>
<hr>
<h3>Markdown / HTML 编辑</h3>
<ul>
<li><strong>双击编辑</strong>：空白栏目和说明框都可以双击进入编辑</li>
<li><strong>格式工具栏</strong>：支持标题、列表、引用、加粗、斜体、下划线、字体颜色、对齐和高亮</li>
<li><strong>安全 HTML</strong>：粘贴或使用格式按钮产生的 HTML 会按安全子集保存和渲染</li>
<li><strong>Markdown 示例</strong>：<strong>加粗文字</strong>、<mark>高亮文字</mark><blockquote>
<p>引用内容</p>
</blockquote>
</li>
<li><strong>HTML 示例</strong>：<font color="#fb464c">红色文字</font>、<span style="color: #66bbff">蓝色文字</span>、<u>下划线</u></li>
<li><strong>图片/图标</strong>：轻量化 HTML/Markdown 图标支持，可以拖入，支持 URL 和 Base64，有 20KB 限制，一般不建议带图</li>
</ul>`,
        'en': `<h2>Canvas Basics</h2>
<ol>
<li><strong>Drag bookmarks/folders to a blank area</strong> to <font color="#44cf6e">create bookmark-type temp nodes</font>.</li>
<li>Temp node changes are <strong>not saved to core data</strong>, useful for comparison and organization.</li>
<li><strong>Drag/paste between sections</strong>.</li>
</ol>
<hr>
<h3>Basic Operations</h3>
<ul>
<li><strong>Create temp section</strong>: Drag a bookmark from the tree to a blank area</li>
<li><strong>Create blank card</strong>: Double-click on canvas blank area</li>
<li><strong>Create card group</strong>: Drag-select multiple elements and create a group, or right-click a blank canvas area to create an empty group</li>
<li><strong>Canvas elements</strong>: Permanent section and copies, temporary sections, blank cards, card groups, and connection lines</li>
</ul>
<hr>
<h3>Connection Lines</h3>
<ul>
<li><strong>Create connection</strong>: Click a section edge anchor and drag to another section</li>
<li><strong>Edit connection</strong>: Click a line to change color, direction, and label</li>
<li><strong>Preset colors</strong>: <font color="#66bbff">Blue</font>, <font color="#fb464c">Red</font>, <font color="#e9973f">Orange</font>, <font color="#e0de71">Yellow</font>, <font color="#44cf6e">Green</font>, <font color="#53dfdd">Cyan</font>, <font color="#a882ff">Purple</font></li>
</ul>
<hr>
<h3>Card Groups</h3>
<ul>
<li><strong>Nested groups</strong>: Place sections, blank cards, or other groups inside a group frame to create nesting</li>
<li><strong>Group organization</strong>: Card groups are saved by <code>.canvas</code> geometric containment, without manually maintaining children</li>
<li><strong>Group export</strong>: A card group or temporary selection can be exported as a smaller canvas package</li>
</ul>
<hr>
<h3>Markdown / HTML Editing</h3>
<ul>
<li><strong>Double-click to edit</strong>: Blank cards and description boxes can both be edited by double-clicking</li>
<li><strong>Format toolbar</strong>: Supports headings, lists, quotes, bold, italic, underline, font color, alignment, and highlight</li>
<li><strong>Safe HTML</strong>: HTML created by paste or toolbar actions is saved and rendered through the safe subset</li>
<li><strong>Markdown examples</strong>: <strong>bold text</strong>, <mark>highlight text</mark><blockquote>
<p>quote content</p>
</blockquote>
</li>
<li><strong>HTML examples</strong>: <font color="#fb464c">red text</font>, <span style="color: #66bbff">blue text</span>, <u>underline</u></li>
<li><strong>Images/Icons</strong>: Lightweight HTML/Markdown icon support, drag-and-drop allowed, URL and Base64 supported, with a 20KB limit (images are generally not recommended)</li>
</ul>`
    },
    canvasHelpPanelOpenSource: {
        'zh_CN': `<h2>开源信息</h2>
<h3>主项目</h3>
<ul>
<li><strong>Bookmark Canvas</strong> (书签画布):<br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Canvas" target="_blank"><i class="fab fa-github"></i> https://github.com/Browser-bookmark-hub/Bookmark-Canvas</a><br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Canvas/issues" target="_blank" style="font-size: 11px;"><i class="fas fa-exclamation-circle"></i> 问题反馈</a></li>
</ul>
<hr>
<h3>关联生态项目</h3>
<ul>
<li><strong>Browser Bookmark Hub 组织</strong>:<br>
<a href="https://github.com/orgs/Browser-bookmark-hub/repositories" target="_blank"><i class="fab fa-github"></i> https://github.com/orgs/Browser-bookmark-hub/repositories</a></li>
<li><strong>Bookmark Backup</strong> (书签备份):<br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Backup" target="_blank"><i class="fab fa-github"></i> https://github.com/Browser-bookmark-hub/Bookmark-Backup</a></li>
<li><strong>Bookmark Record and Recommend</strong> (书签记录与推荐):<br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend" target="_blank"><i class="fab fa-github"></i> https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend</a></li>
</ul>
<hr>
<h3>数据兼容说明</h3>
<p>这两个生态项目（Bookmark Backup & Bookmark Record and Recommend）导出的 JSON/HTML 备份文件，均支持直接拖入书签画布或通过导入功能，在画布中快速形成临时的栏目卡片。</p>`,
        'en': `<h2>Open Source</h2>
<h3>Main Project</h3>
<ul>
<li><strong>Bookmark Canvas</strong>:<br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Canvas" target="_blank"><i class="fab fa-github"></i> https://github.com/Browser-bookmark-hub/Bookmark-Canvas</a><br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Canvas/issues" target="_blank" style="font-size: 11px;"><i class="fas fa-exclamation-circle"></i> Feedback / Issues</a></li>
</ul>
<hr>
<h3>Ecosystem Projects</h3>
<ul>
<li><strong>Browser Bookmark Hub Repositories</strong>:<br>
<a href="https://github.com/orgs/Browser-bookmark-hub/repositories" target="_blank"><i class="fab fa-github"></i> https://github.com/orgs/Browser-bookmark-hub/repositories</a></li>
<li><strong>Bookmark Backup</strong>:<br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Backup" target="_blank"><i class="fab fa-github"></i> https://github.com/Browser-bookmark-hub/Bookmark-Backup</a></li>
<li><strong>Bookmark Record and Recommend</strong>:<br>
<a href="https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend" target="_blank"><i class="fab fa-github"></i> https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend</a></li>
</ul>
<hr>
<h3>Compatibility Note</h3>
<p>The JSON/HTML files exported by Bookmark Backup and Bookmark Record and Recommend can be directly dragged or imported onto the canvas to form temporary section cards.</p>`
    },
    canvasHelpPanelFeatures: {
        'zh_CN': `<h2>特色功能</h2>
<h3>全屏与跳转</h3>
<ul>
<li><strong>全屏模式</strong>：全屏放大当前栏目卡片，适用于<span style="color: #66bbff">侧边栏</span></li>
<li><strong>跳转</strong>：在全屏模式下，可通过「目录侧」或搜索中的「卡片模式」条目点击快速切换卡片跳转</li>
</ul>
<hr>
<h3>一键连续打开</h3>
<ul>
<li><strong>勾选默认打开方式</strong>：右键菜单中选择并勾选你想要的打开方式</li>
<li><strong>左键单击即生效</strong>：设置后，每次左键点击书签自动使用已选方式打开</li>
<li><strong>右键打开方式</strong>：右键书签可选择新标签页、标签组、窗口、无痕窗口等打开方式</li>
</ul>
<hr>
<h3>可选打开方式</h3>
<ul>
<li>新标签页 / 同一标签组 / 专属标签组</li>
<li>新窗口 / 同一窗口 / 专属窗口 / 无痕窗口</li>
<li><strong>同窗专属组</strong>：在同一窗口的专属标签组中打开</li>
<li><strong>手动选择...</strong>：每次手动选择目标窗口和标签组</li>
</ul>
<hr>
<h3>批量操作</h3>
<ul>
<li><strong>选择（批量操作）</strong>：进入多选模式，支持跨栏目多选</li>
<li><strong>文件夹自动成组</strong>：批量打开时，文件夹自动创建标签组</li>
</ul>
<hr>
<h3>搜索</h3>
<ul>
<li><strong>书签模式</strong>：搜索书签标题、URL、文件夹名称和 #标签</li>
<li><strong>卡片（组）模式</strong>：搜索永久栏目及其副本、临时栏目、空白栏目、卡片组等元素的序号、标题、组名和时间</li>
<li><strong>说明模式</strong>：搜索栏目说明、空白卡片文本和连接线标签</li>
</ul>
<hr>
<h3>导入导出</h3>
<ul>
<li><strong>全局导出</strong>：导出 <code>.canvas</code>、栏目 JSON/Markdown、空白卡片和连接线</li>
<li><strong>组导出</strong>：卡片组和临时框选组可单独导出，导入后仍按普通卡片组处理</li>
<li><strong>快照包导入</strong>：文件夹或压缩包可作为画布快照包导入，用于恢复或对比一整套画布结构</li>
<li><strong>覆盖导入</strong>：可用快照包覆盖当前画布内容，适合明确要恢复到某份备份时使用</li>
<li><strong>此位置导入</strong>：在画布空白处或元素右键导入，可把文件夹/压缩包作为快照包导入到当前画布位置附近</li>
<li><strong>拖入</strong>：支持直接拖入文件或书签到画布空白处。包括单个 JSON/HTML 文件的拖入恢复，以及书签横栏（书签栏）中的文件夹直接拖入的检测（注：Edge 侧边栏书签不支持拖拽到书签画布，Chrome 支持；Chrome 与 Edge 在横向条的拖拽只支持普通书签/链接）</li>
<li><strong><mark>AI</mark> 指南</strong>：导出包可生成 <code>AGENTS.md</code> 或 <code>CLAUDE.md</code>，用于约束 <code>AI</code> 编辑画布包时保留结构</li>
</ul>
<hr>
<h3>推送拉取</h3>
<ul>
<li><font color="#fb464c"><strong>安全警示 (切记)</strong></font>：推送时同步机制会清理远端目录。请勿在同步目录下存放任何无关文件（如个人笔记、多媒体等），否则它们将被<strong>彻底删除</strong>！另外，画布中禁止接入任何外部文件节点（如视频、音频、图片、PDF 等）。</li>
</ul>`,
        'en': `<h2>Features</h2>
<h3>Fullscreen and Navigation</h3>
<ul>
<li><strong>Fullscreen mode</strong>: Expand current section card to fullscreen, suitable for the <span style="color: #66bbff">side panel</span></li>
<li><strong>Navigation</strong>: In fullscreen mode, quickly switch and navigate between cards by clicking items in the "Directory Side Panel" or "Card Mode" in search results</li>
</ul>
<hr>
<h3>One-Click Continuous Open</h3>
<ul>
<li><strong>Check default open mode</strong>: Select and check your preferred mode in the right-click menu</li>
<li><strong>Left-click to open</strong>: After setting, each left-click opens bookmarks in the selected mode</li>
<li><strong>Right-click open modes</strong>: Right-click a bookmark to choose new tab, tab group, window, incognito window, and other open modes</li>
</ul>
<hr>
<h3>Available Open Modes</h3>
<ul>
<li>New Tab / Same Group / Exclusive Group</li>
<li>New Window / Same Window / Exclusive Window / Incognito</li>
<li><strong>Same Window + Exclusive Group</strong>: Open in an exclusive tab group in the current window</li>
<li><strong>Manual Select...</strong>: Choose target window and tab group each time</li>
</ul>
<hr>
<h3>Batch Operations</h3>
<ul>
<li><strong>Select (Batch)</strong>: Enter multi-select mode and select across sections</li>
<li><strong>Auto folder grouping</strong>: Folders auto-create tab groups during batch open</li>
</ul>
<hr>
<h3>Search</h3>
<ul>
<li><strong>Bookmark mode</strong>: Search bookmark titles, URLs, folder names, and #tags</li>
<li><strong>Card (Group) mode</strong>: Search element indexes, titles, group names, and time for permanent sections and copies, temporary sections, blank cards, and card groups</li>
<li><strong>Description mode</strong>: Search section descriptions, blank card text, and connection line labels</li>
</ul>
<hr>
<h3>Import / Export</h3>
<ul>
<li><strong>Global export</strong>: Exports <code>.canvas</code>, section JSON/Markdown, blank cards, and connections</li>
<li><strong>Group export</strong>: Card groups and temporary selections can be exported separately, then imported back as normal card groups</li>
<li><strong>Snapshot package import</strong>: Folders or zip files can be imported as canvas snapshot packages for restoring or comparing a full canvas structure</li>
<li><strong>Overwrite import</strong>: A snapshot package can overwrite the current canvas when you explicitly want to restore a backup</li>
<li><strong>Import at this position</strong>: Right-click a blank canvas area or an element to import a folder/zip snapshot package near the current canvas position</li>
<li><strong>Drag and Drop</strong>: Supports dragging files/bookmarks directly onto the canvas. Includes single JSON/HTML file recovery detection, and folder drops from the bookmarks bar (Note: Edge side panel bookmarks do not support drag-and-drop, Chrome does; horizontal bookmarks bar drag-and-drop only supports single bookmarks in both Chrome & Edge)</li>
<li><strong><mark>AI</mark> guide</strong>: Export packages can generate <code>AGENTS.md</code> or <code>CLAUDE.md</code> to guide <code>AI</code> edits while preserving structure</li>
</ul>
<hr>
<h3>Push / Pull</h3>
<ul>
<li><font color="#fb464c"><strong>Safety Warning (Crucial)</strong></font>: Pushing automatically cleans up the remote sync directory. Do NOT store unrelated files (e.g. personal notes, media files) in the sync directory, otherwise they will be <strong>permanently deleted</strong>! Additionally, external file nodes (videos, audio, images, PDFs, etc.) are prohibited in the canvas.</li>
</ul>`
    },
    canvasHelpBatchSelectTitle: {
        'zh_CN': '批量选择',
        'en': 'Batch Selection'
    },
    canvasHelpBatchSelectClick: {
        'zh_CN': '左键（单击）',
        'en': 'Left Click'
    },
    canvasHelpBatchSelectDesc: {
        'zh_CN': '批量/单个选中书签（进入批量模式后左键单击也可以选中）',
        'en': 'Batch/single selection of bookmarks (left click also selects under batch mode)'
    },
    canvasHelpBatchSelectTooltip: {
        'zh_CN': '进入批量模式的时候鼠标左键单击也可以选中',
        'en': 'Clicking the left mouse button in batch mode can also select elements'
    },
    canvasHelpLeftClickSelectTitle: {
        'zh_CN': '左键框选',
        'en': 'Left-Click Selection'
    },
    canvasHelpLeftClickSelectDrag: {
        'zh_CN': '左键拖动（画布空白处）',
        'en': 'Left Click + Drag (blank canvas)'
    },
    canvasHelpLeftClickSelectDesc: {
        'zh_CN': '多选元素并形成临时组，支持整组拖动、批量修改颜色/置顶/删除或转换为卡片组',
        'en': 'Select multiple elements to form a temporary group for group dragging, batch coloring, pinning, deleting, or creating a card group'
    },
    canvasHelpRightClickTitle: {
        'zh_CN': '元素右键',
        'en': 'Element Right-Click'
    },
    canvasHelpRightClickTarget: {
        'zh_CN': '可右键元素',
        'en': 'Right-clickable elements'
    },
    canvasHelpRightClickTargetDesc: {
        'zh_CN': '永久栏目及其副本、临时栏目、空白栏目、连接线、卡片组、左键框选的临时组、画布空白处',
        'en': 'Permanent section and copies, temporary sections, blank cards, connection lines, card groups, and temporary selection groups'
    },
    canvasHelpRightClickAction: {
        'zh_CN': '常用操作',
        'en': 'Common actions'
    },
    canvasHelpRightClickActionDesc: {
        'zh_CN': '全屏、定位、置顶、颜色、重命名、删除、复制源码、导出当前',
        'en': 'Fullscreen, locate, pin, color, rename, delete, copy source, export current'
    },
    canvasHelpCtrlTitle: {
        'zh_CN': 'Ctrl 键操作',
        'en': 'Ctrl Key Actions'
    },
    canvasHelpCtrlLeftClick: {
        'zh_CN': '左键（按住）',
        'en': 'Left Click (Hold)'
    },
    canvasHelpCtrlLeftDesc: {
        'zh_CN': '拖动画布 或 栏目卡片',
        'en': 'Drag canvas or section card'
    },
    canvasHelpCtrlWheel: {
        'zh_CN': '滚轮 或 双指滑动',
        'en': 'Scroll or Swipe'
    },
    canvasHelpCtrlWheelDesc: {
        'zh_CN': '缩放',
        'en': 'Zoom'
    },
    canvasHelpCtrlRightClick: {
        'zh_CN': '右键（单击）',
        'en': 'Right Click'
    },
    canvasHelpCtrlRightDesc: {
        'zh_CN': '更改栏目卡片的大小',
        'en': 'Resize section card'
    },
    canvasHelpSpaceTitle: {
        'zh_CN': '空格键操作',
        'en': 'Space Key Actions'
    },
    canvasHelpSpaceKey: {
        'zh_CN': '空格',
        'en': 'Space'
    },
    canvasHelpSpaceLeftClick: {
        'zh_CN': '左键（按住）',
        'en': 'Left Click (Hold)'
    },
    canvasHelpSpaceDesc: {
        'zh_CN': '拖动全局画布',
        'en': 'Drag global canvas'
    },
    canvasHelpTouchpadTitle: {
        'zh_CN': '触控板操作',
        'en': 'Touchpad Actions'
    },
    canvasHelpTouchpadPinch: {
        'zh_CN': '双指捏合',
        'en': 'Pinch'
    },
    canvasHelpTouchpadPinchDesc: {
        'zh_CN': '缩放画布',
        'en': 'Zoom canvas'
    },
    canvasHelpTouchpadPinchTooltip: {
        'zh_CN': '若系统手势或设备设置与缩放冲突，\n请改用「按键 + 双指滑动」作为备用方式。',
        'en': 'If system gestures or device settings conflict,\nuse "Modifier + Swipe" as a fallback zoom method.'
    },
    canvasHelpTouchpadModifierSwipe: {
        'zh_CN': '双指滑动',
        'en': 'Swipe'
    },
    canvasHelpTouchpadModifierSwipeDesc: {
        'zh_CN': '缩放（兼容侧边栏）',
        'en': 'Zoom (Sidebar compatible)'
    },
    canvasHelpTouchpadScroll: {
        'zh_CN': '双指滑动',
        'en': 'Two-finger Scroll'
    },
    canvasHelpTouchpadScrollDesc: {
        'zh_CN': '拖动画布',
        'en': 'Pan canvas'
    },
    canvasShortcutSettingsText: {
        'zh_CN': '快捷键',
        'en': 'Shortcuts'
    },
    canvasShortcutsModalTitle: {
        'zh_CN': '快捷键',
        'en': 'Shortcuts'
    },
    canvasShortcutRecorderCancel: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    canvasShortcutEditTitle: {
        'zh_CN': '点击修改快捷键',
        'en': 'Click to change shortcut'
    },
    recorderHelpTitle: {
        'zh_CN': '可用按键',
        'en': 'Available Keys'
    },
    recorderHelpBtnTitle: {
        'zh_CN': '查看可用按键',
        'en': 'View available keys'
    },
    tooltipModifierLabel: {
        'zh_CN': '修饰键:',
        'en': 'Modifiers:'
    },
    tooltipSpecialLabel: {
        'zh_CN': '特殊键:',
        'en': 'Special:'
    },
    tooltipLetterLabel: {
        'zh_CN': '字母键:',
        'en': 'Letters:'
    },
    tooltipNumberLabel: {
        'zh_CN': '数字键:',
        'en': 'Numbers:'
    },
    permanentSectionTitle: {
        'zh_CN': '书签树 (永久栏目)',
        'en': 'Bookmark Tree (Permanent)'
    },
    permanentSectionTip: {
        'zh_CN': '点击添加说明...',
        'en': 'Click to add description...'
    },
    shortcutsModalTitle: {
        'zh_CN': '快捷键',
        'en': 'Shortcuts'
    },
    shortcutsTitle: {
        'zh_CN': '基础快捷键',
        'en': 'Basic Shortcuts'
    },
    shortcutsTableHeaderKey: {
        'zh_CN': '按键',
        'en': 'Key'
    },
    shortcutsTableHeaderAction: {
        'zh_CN': '功能',
        'en': 'Action'
    },
    shortcutsSettingsTooltip: {
        'zh_CN': '在浏览器中管理快捷键',
        'en': 'Manage shortcuts in browser'
    },
    shortcutsOpenTitle: {
        'zh_CN': '打开',
        'en': 'Open'
    },
    shortcutsSettingsButton: {
        'zh_CN': '跳转',
        'en': 'Open'
    },
    shortcutsManageTooltip: {
        'zh_CN': '跳转到管理里的快捷键',
        'en': 'Open shortcut settings in manage panel'
    },
    shortcutsManageButton: {
        'zh_CN': '管理快捷键',
        'en': 'Manage Shortcuts'
    },
    shortcutSidePanel: {
        'zh_CN': '打开/关闭侧边栏',
        'en': 'Toggle side panel'
    },
    shortcutCanvasPage: {
        'zh_CN': '打开/定位 HTML 页面',
        'en': 'Open/locate HTML page'
    },
    shortcutsUnset: {
        'zh_CN': '未设置',
        'en': 'Not set'
    },
    closeShortcutsText: {
        'zh_CN': '关闭',
        'en': 'Close'
    },
    emptyTree: {
        'zh_CN': '无法加载书签树',
        'en': 'Unable to load bookmark tree'
    },
    loading: {
        'zh_CN': '加载中...',
        'en': 'Loading...'
    },
    themeTooltip: {
        'zh_CN': '切换主题',
        'en': 'Toggle Theme'
    },
    langTooltip: {
        'zh_CN': '中文 / English',
        'en': '中文 / English'
    },
    bookmarkToolboxTitle: {
        'zh_CN': '书签工具箱',
        'en': 'Bookmark Toolbox'
    },
    horizontalScrollHint: {
        'zh_CN': 'Shift + 滚轮',
        'en': 'Shift + Wheel'
    },
};
window.i18n = i18n; // 暴露给其他模块使用

// =============================================================================
// 初始化
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    ;

    // ========================================================================
    // 【关键步骤 -1】检测是否需要清除 localStorage（"恢复到初始状态"功能触发）
    // ========================================================================
    try {
        const resetCheck = await new Promise(resolve => {
            browserAPI.storage.local.get(['needClearLocalStorage'], result => resolve(result));
        });

        if (resetCheck && resetCheck.needClearLocalStorage === true) {
            ;

            // 清除当前页面上下文的所有 localStorage
            localStorage.clear();

            // 移除重置标志（避免重复清除）
            await new Promise(resolve => {
                browserAPI.storage.local.remove(['needClearLocalStorage'], resolve);
            });

            ;
        }
    } catch (error) {
        console.warn('[初始化] 检测重置标志时出错:', error);
    }

    // ========================================================================
    // 【关键步骤 0】初始化 Favicon 缓存系统
    // ========================================================================
    try {
        await FaviconCache.init();
    } catch (error) {
        // 静默处理
    }


    // 设置全局图片错误处理（避免CSP内联事件处理器）
    setupGlobalImageErrorHandler();

    // ========================================================================
    // 【关键步骤 1】最优先：立即恢复并应用视图状态
    // ========================================================================
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');

    // 优先级：URL参数 > localStorage > 默认值
    if (isSidePanelMode) {
        const sidePanelFixedView = isViewAllowed('canvas') ? 'canvas' : DEFAULT_VIEW;
        currentView = sidePanelFixedView;
        ;
    } else if (viewParam && ALLOWED_VIEWS.includes(viewParam)) {
        currentView = viewParam;
        ;

        // 【关键】应用 URL 参数后，立即从 URL 中移除 view 参数
        // 这样刷新页面时就会使用 localStorage，实现持久化
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('view');
        window.history.replaceState({}, '', newUrl.toString());
        ;
    } else {
        const lastView = localStorage.getItem('lastActiveView');
        if (lastView && ALLOWED_VIEWS.includes(lastView)) {
            currentView = lastView;
            ;
        } else {
            currentView = DEFAULT_VIEW;
            ;
        }
    }

    // 立即应用视图状态到DOM
    ;
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.view === currentView) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    document.querySelectorAll('.view').forEach(view => {
        if (view.id === `${currentView}View`) {
            view.classList.add('active');
        } else {
            view.classList.remove('active');
        }
    });

    // Canvas 视图：去除 content-area padding，避免画布四周出现“边框/留白”
    const initialContentArea = document.querySelector('.content-area');
    if (initialContentArea) {
        initialContentArea.classList.toggle('canvas-full-bleed', currentView === 'canvas');
    }
    // Canvas 视图：取消 html 的 scrollbar gutter，避免右侧出现空隙/黑边
    try {
        document.documentElement.classList.toggle('canvas-view-active', currentView === 'canvas');
    } catch (_) { }
    if (!isSidePanelMode) {
        __saveLocalStorageRaw('lastActiveView', currentView);
    }
    ;

    // [Search Context Boot] 首次加载时同步 SearchContextManager 的 view/tab/subTab。
    // 这里不能依赖 switchView()，因为初始化阶段是直接改 DOM 来显示视图。
    try {
        if (window.SearchContextManager && typeof window.SearchContextManager.updateContext === 'function') {
            window.SearchContextManager.updateContext(currentView, null, null);
        }
    } catch (_) { }

    // ========================================================================
    // 其他初始化
    // ========================================================================
    ;
    ;

    // 加载用户设置
    await loadUserSettings();
    // 初始化 UI（此时currentView已经是正确的值）
    initializeUI();

    // 初始化侧边栏收起功能
    initSidebarToggle();
    initHeaderToggle();
    // Canvas-only：不初始化非画布功能

    // 初始化右键菜单和拖拽功能
    if (typeof initContextMenu === 'function') {
        initContextMenu();
    }
    if (typeof initDragDrop === 'function') {
        initDragDrop();
    }

    // 初始化批量操作相关功能
    if (typeof initBatchToolbar === 'function') {
        initBatchToolbar();
        ;
    }
    if (typeof initKeyboardShortcuts === 'function') {
        initKeyboardShortcuts();
        ;
    }
    if (typeof initClickSelect === 'function') {
        initClickSelect();
        ;
    }

    // 注册消息监听
    setupRealtimeMessageListener();

    // 先加载基础数据
    ;
    await loadAllData();

    // 在渲染 Canvas 前确定当前视图分区信息（page / sidepanel），
    // 供画布相机（pan/zoom）按逻辑分区持久化使用。
    await __initCanvasViewSurfaceKey();

    // 使用智能等待：尝试渲染，如果数据不完整则等待后重试
    // 初始化时强制刷新缓存，确保显示最新数据
    ;

    // 根据当前视图渲染
    await renderCurrentView();

    // 如果通过 window_marker.html 传入了定位参数，则在 Canvas 视图渲染后执行一次定位
    try {
        const lt = urlParams.get('lt'); // 'permanent' | 'temporary'
        const sid = urlParams.get('sid');
        const nid = urlParams.get('nid');
        const titleParam = urlParams.get('t');
        const typeParam = urlParams.get('type'); // 'hyperlink' 或 undefined

        if (titleParam && typeof titleParam === 'string' && titleParam.trim()) {
            // 根据type参数设置不同的标题格式
            if (typeParam === 'hyperlink') {
                // 超链接系统：使用 "Hyperlink N" 格式
                document.title = `Hyperlink ${titleParam.trim()}`;
            } else {
                // 书签系统：直接使用数字
                document.title = titleParam.trim();
            }
        }

        const waitFor = (predicate, timeout = 5000, interval = 50) => new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                try {
                    if (predicate()) return resolve(true);
                    if (Date.now() - start >= timeout) return resolve(false);
                } catch (_) { }
                setTimeout(tick, interval);
            };
            tick();
        });

        if (currentView === 'canvas' && (lt === 'permanent' || lt === 'temporary')) {
            // 等待 Canvas 初始化完成
            await waitFor(() => window.CanvasModule && document.getElementById('canvasWorkspace'));
            if (lt === 'permanent') {
                if (window.CanvasModule && typeof window.CanvasModule.locatePermanent === 'function') {
                    window.CanvasModule.locatePermanent();
                }
                if (nid) {
                    // 等待树节点渲染完成后滚动到对应书签
                    await waitFor(() => document.querySelector('#permanentSection .permanent-section-body .tree-item'));
                    const body = document.querySelector('#permanentSection .permanent-section-body');
                    const target = body ? body.querySelector(`.tree-item[data-node-id="${CSS.escape(nid)}"]`) : null;
                    if (target && target.scrollIntoView) {
                        try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { target.scrollIntoView(); }
                    }
                }
            } else if (lt === 'temporary' && sid) {
                if (window.CanvasModule && typeof window.CanvasModule.locateSection === 'function') {
                    try { window.CanvasModule.locateSection(sid); } catch (_) { }
                }
            }
        }
    } catch (e) {
        console.warn('[初始化] Canvas 定位参数处理失败:', e);
    }

    // 并行预加载其他视图和图标（不阻塞）
    Promise.all([
        preloadCommonIcons()
    ]).then(() => {
        ;
    }).catch(error => {
        console.error('[初始化] 预加载失败:', error);
    });

    // 监听存储变化（实时更新）
    browserAPI.storage.onChanged.addListener(handleStorageChange);

    // 监听书签API变化（实时更新书签树视图）
    setupBookmarkListener();

    ;
});

// =============================================================================
// 用户设置
// =============================================================================

// 检查是否有覆盖设置
function hasThemeOverride() {
    try {
        return localStorage.getItem('historyViewerHasCustomTheme') === 'true';
    } catch (e) {
        return false;
    }
}

function hasLangOverride() {
    try {
        return localStorage.getItem('historyViewerHasCustomLang') === 'true';
    } catch (e) {
        return false;
    }
}

// 获取覆盖设置
function getThemeOverride() {
    try {
        return localStorage.getItem('historyViewerCustomTheme');
    } catch (e) {
        return null;
    }
}

function getLangOverride() {
    try {
        return localStorage.getItem('historyViewerCustomLang');
    } catch (e) {
        return null;
    }
}

async function loadUserSettings() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['preferredLang', 'currentTheme'], (result) => {
            const mainUILang = (result.preferredLang === 'zh_CN' || result.preferredLang === 'en')
                ? result.preferredLang
                : (function () {
                    try {
                        const ui = (browserAPI?.i18n?.getUILanguage?.() || '').toLowerCase();
                        return ui.startsWith('zh') ? 'zh_CN' : 'en';
                    } catch (_) { }
                    return 'en';
                })();
            const mainUITheme = result.currentTheme || 'dark';

            // Keep History Viewer in sync with main UI.
            // Legacy: older versions supported per-page overrides, but that commonly caused "not linked" confusion.
            try {
                __removeLocalStorageKey('historyViewerHasCustomTheme');
                __removeLocalStorageKey('historyViewerCustomTheme');
                __removeLocalStorageKey('historyViewerHasCustomLang');
                __removeLocalStorageKey('historyViewerCustomLang');
            } catch (_) { }

            currentTheme = mainUITheme;
            ;

            currentLang = mainUILang;
            window.currentLang = currentLang; // 同步到 window
            ;

            // 应用主题
            if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
            else document.documentElement.removeAttribute('data-theme');

            // 更新主题切换按钮图标
            const themeIcon = document.querySelector('#themeToggle i');
            if (themeIcon) {
                themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }

            // 应用语言
            applyLanguage();

            // 更新语言切换按钮文本
            const langText = document.querySelector('#langToggle .lang-text');
            if (langText) {
                langText.textContent = currentLang === 'zh_CN' ? 'EN' : '中';
            }

            resolve();
        });
    });
}


function applyLanguage() {
    try {
        document.documentElement.lang = currentLang === 'zh_CN' ? 'zh' : 'en';
    } catch (_) { }
    document.getElementById('pageTitle').textContent = i18n.pageTitle[currentLang];
    const subtitleEl = document.getElementById('pageSubtitle');
    if (subtitleEl) {
        const subtitleText = (i18n.pageSubtitle && i18n.pageSubtitle[currentLang]) ? i18n.pageSubtitle[currentLang] : '';
        subtitleEl.textContent = subtitleText;
        subtitleEl.style.display = subtitleText ? '' : 'none';
    }

    // 搜索框 placeholder 由 SearchContextManager 统一控制
    try {
        if (window.SearchContextManager && typeof window.SearchContextManager.updateUI === 'function') {
            window.SearchContextManager.updateUI();
        } else {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.placeholder = i18n.searchPlaceholder[currentLang];
        }
    } catch (_) { }

    // Canvas 搜索模式 UI（左侧模式按钮 + placeholder）由 search.js 维护
    try {
        if (currentView === 'canvas') {
            if (typeof renderSearchModeUI === 'function') {
                renderSearchModeUI();
            }
            if (typeof window.updateSearchUILanguage === 'function') {
                window.updateSearchUILanguage();
            }
        }
    } catch (_) { }

    const navCanvasText = document.getElementById('navCanvasText');
    if (navCanvasText) navCanvasText.textContent = i18n.navCanvas[currentLang];
    const bookmarkToolboxTitle = document.getElementById('bookmarkToolboxTitle');
    if (bookmarkToolboxTitle) bookmarkToolboxTitle.textContent = '';
    if (window.CanvasSidebarDirectory && typeof window.CanvasSidebarDirectory.refresh === 'function') {
        try { window.CanvasSidebarDirectory.refresh({ force: true }); } catch (_) { }
    }

    // Canvas 视图按钮翻译
    const importCanvasText = document.getElementById('importCanvasText');
    if (importCanvasText) importCanvasText.textContent = i18n.importCanvasText[currentLang];
    const exportCanvasText = document.getElementById('exportCanvasText');
    if (exportCanvasText) exportCanvasText.textContent = i18n.exportCanvasText[currentLang];
    const backupCanvasText = document.getElementById('backupCanvasText');
    if (backupCanvasText) backupCanvasText.textContent = i18n.backupCanvasText[currentLang];
    const githubConfigText = document.getElementById('githubConfigText');
    if (githubConfigText) githubConfigText.textContent = i18n.githubConfigText[currentLang];
    const githubPushText = document.getElementById('githubPushText');
    if (githubPushText) githubPushText.textContent = i18n.githubPushText[currentLang];
    const githubPullText = document.getElementById('githubPullText');
    if (githubPullText) githubPullText.textContent = i18n.githubPullText[currentLang];
    const clearMenuText = document.getElementById('clearMenuText');
    if (clearMenuText) clearMenuText.textContent = i18n.clearMenuText[currentLang];
    const canvasClearSettingsText = document.getElementById('canvasClearSettingsText');
    if (canvasClearSettingsText) canvasClearSettingsText.textContent = i18n.clearMenuText[currentLang];
    const clearByClickText = document.getElementById('clearByClickText');
    if (clearByClickText) clearByClickText.textContent = i18n.clearByClickText[currentLang];
    const clearTempNodesText = document.getElementById('clearTempNodesText');
    if (clearTempNodesText) clearTempNodesText.textContent = i18n.clearTempNodesText[currentLang];
    const clearAllText = document.getElementById('clearAllText');
    if (clearAllText) clearAllText.textContent = i18n.clearAllText[currentLang];

    const canvasZoomLabel = document.getElementById('canvasZoomLabel');
    if (canvasZoomLabel) canvasZoomLabel.textContent = i18n.canvasZoomLabel[currentLang];
    const zoomInBtn = document.getElementById('zoomInBtn');
    if (zoomInBtn) zoomInBtn.title = i18n.zoomInTitle[currentLang];
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    if (zoomOutBtn) zoomOutBtn.title = i18n.zoomOutTitle[currentLang];
    const zoomLocateBtn = document.getElementById('zoomLocateBtn');
    if (zoomLocateBtn) zoomLocateBtn.title = i18n.zoomLocateTitle[currentLang];
    const zoomLocateText = document.getElementById('zoomLocateText');
    if (zoomLocateText) zoomLocateText.textContent = i18n.zoomLocateText[currentLang];
    const canvasManageText = document.getElementById('canvasManageText');
    if (canvasManageText) canvasManageText.textContent = i18n.canvasManageText[currentLang];
    const canvasManageBtn = document.getElementById('canvasManageBtn');
    if (canvasManageBtn) canvasManageBtn.title = i18n.canvasManageTitle[currentLang];
    const canvasHelpBtn = document.getElementById('canvasHelpBtn');
    if (canvasHelpBtn) {
        canvasHelpBtn.title = i18n.canvasHelpBtnTitle[currentLang];
        canvasHelpBtn.setAttribute('aria-label', i18n.canvasHelpBtnTitle[currentLang]);
    }
    const canvasFloatingToolsToggleBtn = document.getElementById('canvasFloatingToolsToggleBtn');
    if (canvasFloatingToolsToggleBtn) {
        canvasFloatingToolsToggleBtn.title = i18n.floatingToolsHideTitle[currentLang];
        canvasFloatingToolsToggleBtn.setAttribute('aria-label', i18n.floatingToolsHideTitle[currentLang]);
    }
    const canvasSidePanelSettingsText = document.getElementById('canvasSidePanelSettingsText');
    if (canvasSidePanelSettingsText) canvasSidePanelSettingsText.textContent = i18n.canvasSidePanelSettingsText[currentLang];
    const canvasSidePanelSettingsBtn = document.getElementById('canvasSidePanelSettingsBtn');
    if (canvasSidePanelSettingsBtn) canvasSidePanelSettingsBtn.title = i18n.canvasSidePanelSettingsTitle[currentLang];
    const canvasAppearanceSettingsText = document.getElementById('canvasAppearanceSettingsText');
    if (canvasAppearanceSettingsText) canvasAppearanceSettingsText.textContent = i18n.canvasAppearanceSettingsText[currentLang];
    const canvasOtherSettingsText = document.getElementById('canvasOtherSettingsText');
    if (canvasOtherSettingsText) canvasOtherSettingsText.textContent = i18n.canvasOtherSettingsText[currentLang];
    const canvasShortcutSettingsText = document.getElementById('canvasShortcutSettingsText');
    if (canvasShortcutSettingsText) canvasShortcutSettingsText.textContent = i18n.canvasShortcutSettingsText[currentLang];

    const canvasManageOtherSectionText = document.getElementById('canvasManageOtherSectionText');
    if (canvasManageOtherSectionText) canvasManageOtherSectionText.textContent = i18n.canvasManageSectionOtherText[currentLang];
    const canvasManageStorageSectionText = document.getElementById('canvasManageStorageSectionText');
    if (canvasManageStorageSectionText) canvasManageStorageSectionText.textContent = i18n.canvasManageSectionStorageText[currentLang];
    const canvasManageSyncSectionText = document.getElementById('canvasManageSyncSectionText');
    if (canvasManageSyncSectionText) canvasManageSyncSectionText.textContent = i18n.canvasManageSectionSyncText[currentLang];

    const canvasViewSyncToggleText = document.getElementById('canvasViewSyncToggleText');
    if (canvasViewSyncToggleText) canvasViewSyncToggleText.textContent = i18n.canvasViewSyncToggleText[currentLang];
    const canvasViewSyncCameraText = document.getElementById('canvasViewSyncCameraText');
    if (canvasViewSyncCameraText) canvasViewSyncCameraText.textContent = i18n.canvasViewSyncCameraText[currentLang];
    const canvasViewSyncExpandScrollText = document.getElementById('canvasViewSyncExpandScrollText');
    if (canvasViewSyncExpandScrollText) canvasViewSyncExpandScrollText.textContent = i18n.canvasViewSyncExpandScrollText[currentLang];
    if (window.CanvasModule && typeof window.CanvasModule.updateViewSyncExpandScrollButtonText === 'function') {
        window.CanvasModule.updateViewSyncExpandScrollButtonText();
    }
    const canvasViewSyncHintViewLabel = document.getElementById('canvasViewSyncHintViewLabel');
    if (canvasViewSyncHintViewLabel) canvasViewSyncHintViewLabel.textContent = i18n.canvasViewSyncHintViewLabel[currentLang];
    const canvasViewSyncHintViewText = document.getElementById('canvasViewSyncHintViewText');
    if (canvasViewSyncHintViewText) canvasViewSyncHintViewText.innerHTML = i18n.canvasViewSyncHintViewText[currentLang];
    const canvasViewSyncHintInfoBtn = document.getElementById('canvasViewSyncHintInfoBtn');
    if (canvasViewSyncHintInfoBtn) {
        const hint = i18n.canvasViewSyncHintGlobalText[currentLang];
        canvasViewSyncHintInfoBtn.setAttribute('aria-label', hint);
    }
    const canvasViewSyncHintCameraLabel = document.getElementById('canvasViewSyncHintCameraLabel');
    if (canvasViewSyncHintCameraLabel) canvasViewSyncHintCameraLabel.textContent = i18n.canvasViewSyncHintCameraLabel[currentLang];
    const canvasViewSyncHintCameraText = document.getElementById('canvasViewSyncHintCameraText');
    if (canvasViewSyncHintCameraText) canvasViewSyncHintCameraText.textContent = i18n.canvasViewSyncHintCameraText[currentLang];
    const canvasViewSyncHintExpandScrollLabel = document.getElementById('canvasViewSyncHintExpandScrollLabel');
    if (canvasViewSyncHintExpandScrollLabel) canvasViewSyncHintExpandScrollLabel.textContent = i18n.canvasViewSyncHintExpandScrollLabel[currentLang];
    const canvasViewSyncHintExpandScrollText = document.getElementById('canvasViewSyncHintExpandScrollText');
    if (canvasViewSyncHintExpandScrollText) canvasViewSyncHintExpandScrollText.textContent = i18n.canvasViewSyncHintExpandScrollText[currentLang];
    const canvasViewSyncHintContentLabel = document.getElementById('canvasViewSyncHintContentLabel');
    if (canvasViewSyncHintContentLabel) canvasViewSyncHintContentLabel.textContent = i18n.canvasViewSyncHintContentLabel[currentLang];
    const canvasViewSyncHintContentText = document.getElementById('canvasViewSyncHintContentText');
    if (canvasViewSyncHintContentText) canvasViewSyncHintContentText.textContent = i18n.canvasViewSyncHintContentText[currentLang];

    const canvasManageModalTitle = document.getElementById('canvasManageModalTitle');
    if (canvasManageModalTitle) canvasManageModalTitle.textContent = i18n.canvasManageTitle[currentLang];
    const canvasOtherManageModalTitle = document.getElementById('canvasOtherManageModalTitle');
    if (canvasOtherManageModalTitle) canvasOtherManageModalTitle.textContent = i18n.canvasOtherManageTitle[currentLang];

    const canvasOtherManageGeneralSectionText = document.getElementById('canvasOtherManageGeneralSectionText');
    if (canvasOtherManageGeneralSectionText) canvasOtherManageGeneralSectionText.textContent = i18n.canvasManageSectionGeneralText[currentLang];
    const canvasOtherManageOtherSectionText = document.getElementById('canvasOtherManageOtherSectionText');
    if (canvasOtherManageOtherSectionText) canvasOtherManageOtherSectionText.textContent = i18n.canvasManageSectionOtherText[currentLang];
    const canvasOtherPerfSettingsText = document.getElementById('canvasOtherPerfSettingsText');
    if (canvasOtherPerfSettingsText) canvasOtherPerfSettingsText.textContent = i18n.canvasPerfSettingsText[currentLang];
    const canvasOtherAppearanceSettingsText = document.getElementById('canvasOtherAppearanceSettingsText');
    if (canvasOtherAppearanceSettingsText) canvasOtherAppearanceSettingsText.textContent = i18n.canvasAppearanceSettingsText[currentLang];
    const canvasOtherSettingsManageText = document.getElementById('canvasOtherSettingsManageText');
    if (canvasOtherSettingsManageText) canvasOtherSettingsManageText.textContent = i18n.canvasOtherSettingsText[currentLang];
    const canvasOtherShortcutSettingsText = document.getElementById('canvasOtherShortcutSettingsText');
    if (canvasOtherShortcutSettingsText) canvasOtherShortcutSettingsText.textContent = i18n.canvasShortcutSettingsText[currentLang];
    const importCanvasOtherText = document.getElementById('importCanvasOtherText');
    if (importCanvasOtherText) importCanvasOtherText.textContent = i18n.importCanvasText[currentLang];
    const exportCanvasOtherText = document.getElementById('exportCanvasOtherText');
    if (exportCanvasOtherText) exportCanvasOtherText.textContent = i18n.exportCanvasText[currentLang];
    const backupCanvasOtherText = document.getElementById('backupCanvasOtherText');
    if (backupCanvasOtherText) backupCanvasOtherText.textContent = i18n.backupCanvasText[currentLang];
    const githubConfigOtherText = document.getElementById('githubConfigOtherText');
    if (githubConfigOtherText) githubConfigOtherText.textContent = i18n.githubConfigText[currentLang];
    const githubPushOtherText = document.getElementById('githubPushOtherText');
    if (githubPushOtherText) githubPushOtherText.textContent = i18n.githubPushText[currentLang];
    const githubPullOtherText = document.getElementById('githubPullOtherText');
    if (githubPullOtherText) githubPullOtherText.textContent = i18n.githubPullText[currentLang];
    const clearMenuOtherText = document.getElementById('clearMenuOtherText');
    if (clearMenuOtherText) clearMenuOtherText.textContent = i18n.clearMenuText[currentLang];
    const clearMenuOtherSettingsText = document.getElementById('clearMenuOtherSettingsText');
    if (clearMenuOtherSettingsText) clearMenuOtherSettingsText.textContent = i18n.clearMenuText[currentLang];
    const clearByClickOtherText = document.getElementById('clearByClickOtherText');
    if (clearByClickOtherText) clearByClickOtherText.textContent = i18n.clearByClickText[currentLang];
    const clearTempNodesOtherText = document.getElementById('clearTempNodesOtherText');
    if (clearTempNodesOtherText) clearTempNodesOtherText.textContent = i18n.clearTempNodesText[currentLang];
    const clearAllOtherText = document.getElementById('clearAllOtherText');
    if (clearAllOtherText) clearAllOtherText.textContent = i18n.clearAllText[currentLang];

    const canvasHelpModalTitle = document.getElementById('canvasHelpModalTitle');
    if (canvasHelpModalTitle) canvasHelpModalTitle.textContent = i18n.canvasHelpModalTitle[currentLang];
    const canvasHelpTabShortcuts = document.getElementById('canvasHelpTabShortcuts');
    if (canvasHelpTabShortcuts) canvasHelpTabShortcuts.textContent = i18n.canvasHelpTabShortcuts[currentLang];
    const canvasHelpTabRelease = document.getElementById('canvasHelpTabRelease');
    if (canvasHelpTabRelease) canvasHelpTabRelease.textContent = i18n.canvasHelpTabRelease[currentLang];
    const canvasHelpTabFeatures = document.getElementById('canvasHelpTabFeatures');
    if (canvasHelpTabFeatures) canvasHelpTabFeatures.textContent = i18n.canvasHelpTabFeatures[currentLang];
    const canvasHelpPanelRelease = document.getElementById('canvasHelpPanelRelease');
    if (canvasHelpPanelRelease) canvasHelpPanelRelease.innerHTML = i18n.canvasHelpPanelRelease[currentLang];
    const canvasHelpPanelFeatures = document.getElementById('canvasHelpPanelFeatures');
    if (canvasHelpPanelFeatures) canvasHelpPanelFeatures.innerHTML = i18n.canvasHelpPanelFeatures[currentLang];
    const canvasHelpTabOpenSource = document.getElementById('canvasHelpTabOpenSource');
    if (canvasHelpTabOpenSource) canvasHelpTabOpenSource.textContent = i18n.canvasHelpTabOpenSource[currentLang];
    const canvasHelpPanelOpenSource = document.getElementById('canvasHelpPanelOpenSource');
    if (canvasHelpPanelOpenSource) canvasHelpPanelOpenSource.innerHTML = i18n.canvasHelpPanelOpenSource[currentLang];
    const canvasOpenSourceModalTitle = document.getElementById('canvasOpenSourceModalTitle');
    if (canvasOpenSourceModalTitle) canvasOpenSourceModalTitle.textContent = i18n.canvasHelpTabOpenSource[currentLang];
    const canvasOpenSourceContent = document.getElementById('canvasOpenSourceContent');
    if (canvasOpenSourceContent) canvasOpenSourceContent.innerHTML = i18n.canvasHelpPanelOpenSource[currentLang];
    const canvasShortcutsModalTitle = document.getElementById('canvasShortcutsModalTitle');
    if (canvasShortcutsModalTitle) canvasShortcutsModalTitle.textContent = i18n.canvasShortcutsModalTitle[currentLang];
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const batchModifier = isMac ? 'Option' : 'Alt';

    const canvasHelpBatchSelectTitle = document.getElementById('canvasHelpBatchSelectTitle');
    if (canvasHelpBatchSelectTitle) canvasHelpBatchSelectTitle.textContent = i18n.canvasHelpBatchSelectTitle[currentLang];
    const canvasHelpBatchSelectTitleHelp = document.getElementById('canvasHelpBatchSelectTitleHelp');
    if (canvasHelpBatchSelectTitleHelp) canvasHelpBatchSelectTitleHelp.textContent = i18n.canvasHelpBatchSelectTitle[currentLang];

    const canvasHelpBatchSelectModifier1 = document.getElementById('canvasHelpBatchSelectModifier1');
    if (canvasHelpBatchSelectModifier1) canvasHelpBatchSelectModifier1.textContent = batchModifier;
    const canvasHelpBatchSelectModifier2 = document.getElementById('canvasHelpBatchSelectModifier2');
    if (canvasHelpBatchSelectModifier2) canvasHelpBatchSelectModifier2.textContent = batchModifier;

    const canvasHelpBatchSelectClick1 = document.getElementById('canvasHelpBatchSelectClick1');
    if (canvasHelpBatchSelectClick1) canvasHelpBatchSelectClick1.textContent = i18n.canvasHelpBatchSelectClick[currentLang];
    const canvasHelpBatchSelectClick2 = document.getElementById('canvasHelpBatchSelectClick2');
    if (canvasHelpBatchSelectClick2) canvasHelpBatchSelectClick2.textContent = i18n.canvasHelpBatchSelectClick[currentLang];

    const canvasHelpBatchSelectDesc1 = document.getElementById('canvasHelpBatchSelectDesc1');
    if (canvasHelpBatchSelectDesc1) canvasHelpBatchSelectDesc1.textContent = i18n.canvasHelpBatchSelectDesc[currentLang];
    const canvasHelpBatchSelectDesc2 = document.getElementById('canvasHelpBatchSelectDesc2');
    if (canvasHelpBatchSelectDesc2) canvasHelpBatchSelectDesc2.textContent = i18n.canvasHelpBatchSelectDesc[currentLang];

    const batchSelectHelpText1 = document.getElementById('batchSelectHelpText1');
    if (batchSelectHelpText1) batchSelectHelpText1.innerHTML = i18n.canvasHelpBatchSelectTooltip[currentLang].replace(/\n/g, '<br>');
    const batchSelectHelpText2 = document.getElementById('batchSelectHelpText2');
    if (batchSelectHelpText2) batchSelectHelpText2.innerHTML = i18n.canvasHelpBatchSelectTooltip[currentLang].replace(/\n/g, '<br>');

    const canvasHelpCtrlTitle = document.getElementById('canvasHelpCtrlTitle');
    if (canvasHelpCtrlTitle) canvasHelpCtrlTitle.textContent = i18n.canvasHelpCtrlTitle[currentLang];
    const canvasHelpCtrlLeftClick = document.getElementById('canvasHelpCtrlLeftClick');
    if (canvasHelpCtrlLeftClick) canvasHelpCtrlLeftClick.textContent = i18n.canvasHelpCtrlLeftClick[currentLang];
    const canvasHelpCtrlLeftDesc = document.getElementById('canvasHelpCtrlLeftDesc');
    if (canvasHelpCtrlLeftDesc) canvasHelpCtrlLeftDesc.textContent = i18n.canvasHelpCtrlLeftDesc[currentLang];
    const canvasHelpCtrlWheel = document.getElementById('canvasHelpCtrlWheel');
    if (canvasHelpCtrlWheel) canvasHelpCtrlWheel.textContent = i18n.canvasHelpCtrlWheel[currentLang];
    const canvasHelpCtrlWheelDesc = document.getElementById('canvasHelpCtrlWheelDesc');
    if (canvasHelpCtrlWheelDesc) canvasHelpCtrlWheelDesc.textContent = i18n.canvasHelpCtrlWheelDesc[currentLang];
    const canvasHelpCtrlRightClick = document.getElementById('canvasHelpCtrlRightClick');
    if (canvasHelpCtrlRightClick) canvasHelpCtrlRightClick.textContent = i18n.canvasHelpCtrlRightClick[currentLang];
    const canvasHelpCtrlRightDesc = document.getElementById('canvasHelpCtrlRightDesc');
    if (canvasHelpCtrlRightDesc) canvasHelpCtrlRightDesc.textContent = i18n.canvasHelpCtrlRightDesc[currentLang];
    const canvasHelpSpaceTitle = document.getElementById('canvasHelpSpaceTitle');
    if (canvasHelpSpaceTitle) canvasHelpSpaceTitle.textContent = i18n.canvasHelpSpaceTitle[currentLang];
    const canvasHelpSpaceKey = document.getElementById('canvasHelpSpaceKey');
    if (canvasHelpSpaceKey) canvasHelpSpaceKey.textContent = i18n.canvasHelpSpaceKey[currentLang];
    const canvasHelpSpaceLeftClick = document.getElementById('canvasHelpSpaceLeftClick');
    if (canvasHelpSpaceLeftClick) canvasHelpSpaceLeftClick.textContent = i18n.canvasHelpSpaceLeftClick[currentLang];
    const canvasHelpSpaceDesc = document.getElementById('canvasHelpSpaceDesc');
    if (canvasHelpSpaceDesc) canvasHelpSpaceDesc.textContent = i18n.canvasHelpSpaceDesc[currentLang];
    const canvasHelpTouchpadTitle = document.getElementById('canvasHelpTouchpadTitle');
    if (canvasHelpTouchpadTitle) canvasHelpTouchpadTitle.textContent = i18n.canvasHelpTouchpadTitle[currentLang];
    const canvasHelpTouchpadPinch = document.getElementById('canvasHelpTouchpadPinch');
    if (canvasHelpTouchpadPinch) canvasHelpTouchpadPinch.textContent = i18n.canvasHelpTouchpadPinch[currentLang];
    const canvasHelpTouchpadPinchDesc = document.getElementById('canvasHelpTouchpadPinchDesc');
    if (canvasHelpTouchpadPinchDesc) canvasHelpTouchpadPinchDesc.textContent = i18n.canvasHelpTouchpadPinchDesc[currentLang];

    const pinchText1 = document.getElementById('pinchHelpText1');
    if (pinchText1) pinchText1.innerHTML = i18n.canvasHelpTouchpadPinchTooltip[currentLang].replace(/\n/g, '<br>');
    const pinchText2 = document.getElementById('pinchHelpText2');
    if (pinchText2) pinchText2.innerHTML = i18n.canvasHelpTouchpadPinchTooltip[currentLang].replace(/\n/g, '<br>');

    const setupPinchPopover = (btnId, popoverId) => {
        const btn = document.getElementById(btnId);
        const popover = document.getElementById(popoverId);
        if (btn && popover) {
            // Remove old title if any
            btn.removeAttribute('title');

            // Prevent multiple listeners if updateLanguageStrings is called multiple times
            if (btn.dataset.popoverBound === 'true') return;
            btn.dataset.popoverBound = 'true';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isShow = popover.classList.contains('show');
                document.querySelectorAll('.perf-help-popover.show').forEach(p => p.classList.remove('show'));
                if (!isShow) {
                    const rect = btn.getBoundingClientRect();
                    const container = btn.closest('.modal-content') || document.body;
                    const containerRect = container.getBoundingClientRect();
                    // Basic position calculation relative to container
                    popover.style.top = (rect.top - containerRect.top) + 'px';
                    popover.style.left = (rect.right - containerRect.left + 8) + 'px';
                    popover.classList.add('show');
                }
            });
        }
    };
    setupPinchPopover('pinchHelpBtn1', 'pinchHelpPopover1');
    setupPinchPopover('pinchHelpBtn2', 'pinchHelpPopover2');
    setupPinchPopover('batchSelectHelpBtn1', 'batchSelectHelpPopover1');
    setupPinchPopover('batchSelectHelpBtn2', 'batchSelectHelpPopover2');
    if (!document.body.dataset.pinchPopoverGlobalBound) {
        document.body.dataset.pinchPopoverGlobalBound = 'true';
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.perf-help-btn') && !e.target.closest('.perf-help-popover')) {
                document.querySelectorAll('.perf-help-popover.show').forEach(p => p.classList.remove('show'));
            }
        });
    }

    const canvasHelpTouchpadModifierSwipe = document.getElementById('canvasHelpTouchpadModifierSwipe');
    if (canvasHelpTouchpadModifierSwipe) canvasHelpTouchpadModifierSwipe.textContent = i18n.canvasHelpTouchpadModifierSwipe[currentLang];
    const canvasHelpTouchpadModifierSwipeDesc = document.getElementById('canvasHelpTouchpadModifierSwipeDesc');
    if (canvasHelpTouchpadModifierSwipeDesc) canvasHelpTouchpadModifierSwipeDesc.textContent = i18n.canvasHelpTouchpadModifierSwipeDesc[currentLang];
    const canvasHelpTouchpadScroll = document.getElementById('canvasHelpTouchpadScroll');
    if (canvasHelpTouchpadScroll) canvasHelpTouchpadScroll.textContent = i18n.canvasHelpTouchpadScroll[currentLang];
    const canvasHelpTouchpadScrollDesc = document.getElementById('canvasHelpTouchpadScrollDesc');
    if (canvasHelpTouchpadScrollDesc) canvasHelpTouchpadScrollDesc.textContent = i18n.canvasHelpTouchpadScrollDesc[currentLang];

    document.querySelectorAll('[data-i18n-key]').forEach(el => {
        const key = el.getAttribute('data-i18n-key');
        if (key && i18n[key] && i18n[key][currentLang]) {
            el.textContent = i18n[key][currentLang];
        }
    });

    const editCtrlKeyBtn = document.getElementById('editCtrlKeyBtn');
    if (editCtrlKeyBtn) editCtrlKeyBtn.title = i18n.canvasShortcutEditTitle[currentLang];
    const editSpaceKeyBtn = document.getElementById('editSpaceKeyBtn');
    if (editSpaceKeyBtn) editSpaceKeyBtn.title = i18n.canvasShortcutEditTitle[currentLang];
    const editCtrlKeyBtnHelp = document.getElementById('editCtrlKeyBtnHelp');
    if (editCtrlKeyBtnHelp) editCtrlKeyBtnHelp.title = i18n.canvasShortcutEditTitle[currentLang];
    const editSpaceKeyBtnHelp = document.getElementById('editSpaceKeyBtnHelp');
    if (editSpaceKeyBtnHelp) editSpaceKeyBtnHelp.title = i18n.canvasShortcutEditTitle[currentLang];
    const recorderCancelBtn = document.getElementById('recorderCancelBtn');
    if (recorderCancelBtn) recorderCancelBtn.textContent = i18n.canvasShortcutRecorderCancel[currentLang];
    const recorderHelpBtn = document.getElementById('recorderHelpBtn');
    if (recorderHelpBtn) recorderHelpBtn.title = i18n.recorderHelpBtnTitle[currentLang];
    const recorderHelpTitle = document.getElementById('recorderHelpTitle');
    if (recorderHelpTitle) recorderHelpTitle.textContent = i18n.recorderHelpTitle[currentLang];
    const tooltipModifierLabel = document.getElementById('tooltipModifierLabel');
    if (tooltipModifierLabel) tooltipModifierLabel.textContent = i18n.tooltipModifierLabel[currentLang];
    const tooltipSpecialLabel = document.getElementById('tooltipSpecialLabel');
    if (tooltipSpecialLabel) tooltipSpecialLabel.textContent = i18n.tooltipSpecialLabel[currentLang];
    const tooltipLetterLabel = document.getElementById('tooltipLetterLabel');
    if (tooltipLetterLabel) tooltipLetterLabel.textContent = i18n.tooltipLetterLabel[currentLang];
    const tooltipNumberLabel = document.getElementById('tooltipNumberLabel');
    if (tooltipNumberLabel) tooltipNumberLabel.textContent = i18n.tooltipNumberLabel[currentLang];
    if (window.CanvasModule && typeof window.CanvasModule.updateShortcutDisplays === 'function') {
        window.CanvasModule.updateShortcutDisplays();
    }

    const fullscreenBtn = document.getElementById('canvasFullscreenBtn');
    if (fullscreenBtn) {
        if (window.CanvasModule && typeof window.CanvasModule.updateFullscreenButton === 'function') {
            window.CanvasModule.updateFullscreenButton();
        }
        if (window.CanvasModule && typeof window.CanvasModule.updateNodeFullscreenButtons === 'function') {
            window.CanvasModule.updateNodeFullscreenButtons();
        }
        const container = document.querySelector('.canvas-main-container');
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        const isFullscreen = !!(fullscreenElement && (fullscreenElement === container || fullscreenElement === document.documentElement || fullscreenElement === document.body)) || (window.CanvasModule && window.CanvasModule.CanvasState && window.CanvasModule.CanvasState.isFullscreen === true);
        const key = isFullscreen ? 'canvasFullscreenExit' : 'canvasFullscreenEnter';
        const text = i18n[key] && i18n[key][currentLang] ? i18n[key][currentLang] : (key === 'canvasFullscreenExit' ? (currentLang === 'en' ? 'Exit' : '退出') : (currentLang === 'en' ? 'Fullscreen' : '全屏'));
        fullscreenBtn.textContent = text;
        fullscreenBtn.setAttribute('aria-label', text);
        fullscreenBtn.classList.toggle('fullscreen-active', Boolean(isFullscreen));
        fullscreenBtn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
    }

    const permanentSectionTitle = document.getElementById('permanentSectionTitle');
    if (permanentSectionTitle) permanentSectionTitle.textContent = i18n.permanentSectionTitle[currentLang];
    const permanentSectionTip = document.getElementById('permanentSectionTip');
    if (permanentSectionTip) {
        const placeholder = i18n.permanentSectionTip[currentLang];
        try {
            permanentSectionTip.setAttribute('data-placeholder', placeholder);
            permanentSectionTip.setAttribute('aria-label', placeholder);
        } catch (_) { }

        let savedTip = '';
        try { savedTip = localStorage.getItem('bcs:perm:tip-main') || ''; } catch { }
        if (!savedTip.trim()) {
            const t = (permanentSectionTip.textContent || '').trim();
            const zh = i18n.permanentSectionTip['zh_CN'];
            const en = i18n.permanentSectionTip['en'];
            if (t === zh || t === en) {
                permanentSectionTip.innerHTML = '';
            }
        }
    }

    const themeTooltip = document.getElementById('themeTooltip');
    if (themeTooltip) themeTooltip.textContent = i18n.themeTooltip[currentLang];
    const langTooltip = document.getElementById('langTooltip');
    if (langTooltip) langTooltip.textContent = i18n.langTooltip[currentLang];
    const helpTooltip = document.getElementById('helpTooltip');
    if (helpTooltip) helpTooltip.textContent = i18n.helpTooltip[currentLang];
    const settingsTooltip = document.getElementById('settingsTooltip');
    if (settingsTooltip) settingsTooltip.textContent = i18n.settingsTooltip[currentLang];
    const settingsToggle = document.getElementById('settingsToggle');
    if (settingsToggle) settingsToggle.setAttribute('aria-label', i18n.settingsTooltip[currentLang]);

    const titleSettingsTooltip = document.getElementById('titleSettingsTooltip');
    if (titleSettingsTooltip) titleSettingsTooltip.textContent = i18n.settingsTooltip[currentLang];
    const titleSettingsToggleBtn = document.getElementById('titleSettingsToggleBtn');
    if (titleSettingsToggleBtn) titleSettingsToggleBtn.setAttribute('aria-label', i18n.settingsTooltip[currentLang]);

    const settingsFloatText = document.getElementById('settingsFloatText');
    if (settingsFloatText) settingsFloatText.textContent = i18n.settingsFloatText[currentLang];
    const settingsFloatingToolsToggle = document.getElementById('settingsFloatingToolsToggle');
    if (settingsFloatingToolsToggle) {
        settingsFloatingToolsToggle.setAttribute('aria-label', i18n.settingsFloatText[currentLang]);
    }
    document.querySelectorAll('[data-floating-mode-text="none"]').forEach((el) => {
        el.textContent = i18n.floatingToolsModeNoneText[currentLang];
    });
    document.querySelectorAll('[data-floating-mode-text="hidden"]').forEach((el) => {
        el.textContent = i18n.floatingToolsModeHiddenText[currentLang];
    });
    document.querySelectorAll('[data-floating-mode-text="shown"]').forEach((el) => {
        el.textContent = i18n.floatingToolsModeShownText[currentLang];
    });
    document.querySelectorAll('.floating-tools-mode-switch').forEach((switchEl) => {
        switchEl.setAttribute('aria-label', i18n.floatingToolsModeGroupLabel[currentLang]);
    });
    document.querySelectorAll('.floating-tools-mode-btn[data-mode="none"]').forEach((btn) => {
        btn.title = i18n.floatingToolsModeNoneText[currentLang];
        btn.setAttribute('aria-label', i18n.floatingToolsModeNoneText[currentLang]);
    });
    document.querySelectorAll('.floating-tools-mode-btn[data-mode="hidden"]').forEach((btn) => {
        btn.title = i18n.floatingToolsModeHiddenText[currentLang];
        btn.setAttribute('aria-label', i18n.floatingToolsModeHiddenText[currentLang]);
    });
    document.querySelectorAll('.floating-tools-mode-btn[data-mode="shown"]').forEach((btn) => {
        btn.title = i18n.floatingToolsModeShownText[currentLang];
        btn.setAttribute('aria-label', i18n.floatingToolsModeShownText[currentLang]);
    });
    const settingsSidePanelText = document.getElementById('settingsSidePanelText');
    if (settingsSidePanelText) settingsSidePanelText.textContent = i18n.settingsSidePanelText[currentLang];
    const settingsCanvasManageText = document.getElementById('settingsCanvasManageText');
    if (settingsCanvasManageText) settingsCanvasManageText.textContent = i18n.settingsCanvasManageText[currentLang];
    const settingsOtherManageText = document.getElementById('settingsOtherManageText');
    if (settingsOtherManageText) settingsOtherManageText.textContent = i18n.settingsOtherManageText[currentLang];
    const settingsThemeText = document.getElementById('settingsThemeText');
    if (settingsThemeText) settingsThemeText.textContent = i18n.settingsThemeText[currentLang];
    const settingsLanguageText = document.getElementById('settingsLanguageText');
    if (settingsLanguageText) settingsLanguageText.textContent = i18n.settingsLanguageText[currentLang];
    const settingsHelpText = document.getElementById('settingsHelpText');
    if (settingsHelpText) settingsHelpText.textContent = i18n.settingsHelpText[currentLang];
    const settingsOpenSourceText = document.getElementById('settingsOpenSourceText');
    if (settingsOpenSourceText) settingsOpenSourceText.textContent = i18n.settingsOpenSourceText[currentLang];
    const canvasFloatingToggleMini = document.getElementById('canvasFloatingToggleMini');
    if (canvasFloatingToggleMini) {
        canvasFloatingToggleMini.title = i18n.floatingToolsMiniShowTitle[currentLang];
        canvasFloatingToggleMini.setAttribute('aria-label', i18n.floatingToolsMiniShowTitle[currentLang]);
    }

    const quickAddTooltip = document.getElementById('quickAddTooltip');
    if (quickAddTooltip) quickAddTooltip.textContent = i18n.quickAddTooltip[currentLang];
    const quickAddToggle = document.getElementById('quickAddToggle');
    if (quickAddToggle) quickAddToggle.setAttribute('aria-label', i18n.quickAddTooltip[currentLang]);
    const titleQuickAddTooltip = document.getElementById('titleQuickAddTooltip');
    if (titleQuickAddTooltip) titleQuickAddTooltip.textContent = i18n.quickAddTooltip[currentLang];
    const titleQuickAddToggleBtn = document.getElementById('titleQuickAddToggleBtn');
    if (titleQuickAddToggleBtn) titleQuickAddToggleBtn.setAttribute('aria-label', i18n.quickAddTooltip[currentLang]);
    const titleLastFullscreenTooltip = document.getElementById('titleLastFullscreenTooltip');
    if (titleLastFullscreenTooltip) titleLastFullscreenTooltip.textContent = i18n.titleLastFullscreenTooltip[currentLang];
    const titleLastFullscreenBtn = document.getElementById('titleLastFullscreenBtn');
    if (titleLastFullscreenBtn) titleLastFullscreenBtn.setAttribute('aria-label', i18n.titleLastFullscreenTooltip[currentLang]);
    const sideLastFullscreenTooltip = document.getElementById('sideLastFullscreenTooltip');
    if (sideLastFullscreenTooltip) sideLastFullscreenTooltip.textContent = i18n.titleLastFullscreenTooltip[currentLang];
    const sideLastFullscreenBtn = document.getElementById('sideLastFullscreenBtn');
    if (sideLastFullscreenBtn) sideLastFullscreenBtn.setAttribute('aria-label', i18n.titleLastFullscreenTooltip[currentLang]);
    const openCanvasPageTooltip = document.getElementById('openCanvasPageTooltip');
    if (openCanvasPageTooltip) openCanvasPageTooltip.textContent = i18n.openCanvasPageTooltip[currentLang];
    const openCanvasPageBtn = document.getElementById('openCanvasPageBtn');
    if (openCanvasPageBtn) openCanvasPageBtn.setAttribute('aria-label', i18n.openCanvasPageTooltip[currentLang]);
    const titleSidePanelToggleTooltip = document.getElementById('titleSidePanelToggleTooltip');
    if (titleSidePanelToggleTooltip) titleSidePanelToggleTooltip.textContent = i18n.titleSidePanelToggleTooltip[currentLang];
    const titleSidePanelToggleBtn = document.getElementById('titleSidePanelToggleBtn');
    if (titleSidePanelToggleBtn) {
        const label = i18n.titleSidePanelToggleTooltip[currentLang];
        titleSidePanelToggleBtn.setAttribute('aria-label', label);
    }
    const headerToggleBtn = document.getElementById('headerToggleBtn');
    const headerCollapsed = currentHeaderState === 'compact';
    const headerLabel = headerCollapsed
        ? i18n.headerToggleExpandTooltip[currentLang]
        : i18n.headerToggleCollapseTooltip[currentLang];
    if (headerToggleBtn) {
        headerToggleBtn.setAttribute('aria-label', headerLabel);
    }
    const quickAddCurrentTitle = document.getElementById('quickAddCurrentTitle');
    if (quickAddCurrentTitle) quickAddCurrentTitle.textContent = i18n.quickAddCurrentTitle[currentLang];
    const quickAddWindowTitle = document.getElementById('quickAddWindowTitle');
    if (quickAddWindowTitle) quickAddWindowTitle.textContent = i18n.quickAddWindowTitle[currentLang];
    const quickAddCurrentTempText = document.getElementById('quickAddCurrentTempText');
    if (quickAddCurrentTempText) quickAddCurrentTempText.textContent = i18n.quickAddCurrentTempText[currentLang];
    const quickAddCurrentPermanentText = document.getElementById('quickAddCurrentPermanentText');
    if (quickAddCurrentPermanentText) quickAddCurrentPermanentText.textContent = i18n.quickAddCurrentPermanentText[currentLang];
    const quickAddCurrentBlankText = document.getElementById('quickAddCurrentBlankText');
    if (quickAddCurrentBlankText) quickAddCurrentBlankText.textContent = i18n.quickAddCurrentBlankText[currentLang];
    const quickAddCurrentViewText = document.getElementById('quickAddCurrentViewText');
    if (quickAddCurrentViewText) quickAddCurrentViewText.textContent = i18n.quickAddCurrentViewText[currentLang];
    const quickAddWindowViewText = document.getElementById('quickAddWindowViewText');
    if (quickAddWindowViewText) quickAddWindowViewText.textContent = i18n.quickAddWindowViewText[currentLang];
    const quickAddWindowTempText = document.getElementById('quickAddWindowTempText');
    if (quickAddWindowTempText) quickAddWindowTempText.textContent = i18n.quickAddWindowTempText[currentLang];
    const quickAddWindowPermanentText = document.getElementById('quickAddWindowPermanentText');
    if (quickAddWindowPermanentText) quickAddWindowPermanentText.textContent = i18n.quickAddWindowPermanentText[currentLang];
    const quickAddWindowBlankText = document.getElementById('quickAddWindowBlankText');
    if (quickAddWindowBlankText) quickAddWindowBlankText.textContent = i18n.quickAddWindowBlankText[currentLang];
    const quickAddAllWindowsTitle = document.getElementById('quickAddAllWindowsTitle');
    if (quickAddAllWindowsTitle) quickAddAllWindowsTitle.textContent = i18n.quickAddAllWindowsTitle[currentLang];
    const quickAddAllWindowsCardGroupText = document.getElementById('quickAddAllWindowsCardGroupText');
    if (quickAddAllWindowsCardGroupText) quickAddAllWindowsCardGroupText.textContent = i18n.quickAddAllWindowsCardGroupText[currentLang];
    if (typeof window.__refreshQuickAddWindowFolderOptionLabels === 'function') {
        try { window.__refreshQuickAddWindowFolderOptionLabels(); } catch (_) { }
    }

    const shortcutsModalTitle = document.getElementById('shortcutsModalTitle');
    if (shortcutsModalTitle) shortcutsModalTitle.textContent = i18n.shortcutsModalTitle[currentLang];
    const closeShortcutsText = document.getElementById('closeShortcutsText');
    if (closeShortcutsText) closeShortcutsText.textContent = i18n.closeShortcutsText[currentLang];

    const scrollbarHint = document.querySelector('.canvas-scrollbar.horizontal .scrollbar-hint');
    if (scrollbarHint) scrollbarHint.textContent = i18n.horizontalScrollHint[currentLang];

    const langText = document.querySelector('#langToggle .lang-text');
    if (langText) langText.textContent = currentLang === 'zh_CN' ? 'EN' : '中';

    const themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) {
        themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    const settingsThemeIcon = document.querySelector('#settingsMenu [data-action="toggle-theme"] i');
    if (settingsThemeIcon) {
        settingsThemeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    const canvasPerfSettingsText = document.getElementById('canvasPerfSettingsText');
    if (canvasPerfSettingsText) canvasPerfSettingsText.textContent = i18n.canvasPerfSettingsText[currentLang];
    if (typeof updateShortcutsDisplay === 'function') {
        updateShortcutsDisplay();
    }

}
// =============================================================================
// UI 初始化
// =============================================================================

function setupSidePanelSettingsMenu() {
    const toggle = document.getElementById('settingsToggle');
    const menu = document.getElementById('settingsMenu');
    const viewSyncToggle = document.getElementById('canvasViewSyncToggleBtn');
    const viewSyncPanel = document.getElementById('canvasViewSyncPanel');
    const floatingToolsToggle = document.getElementById('settingsFloatingToolsToggle');
    const floatingToolsPanel = document.getElementById('floatingToolsModePanel');
    if (!toggle || !menu) return;
    if (menu.dataset.bound === 'true') return;
    menu.dataset.bound = 'true';

    const closeFloatingToolsPanel = () => {
        if (floatingToolsPanel && !floatingToolsPanel.hasAttribute('hidden')) {
            floatingToolsPanel.setAttribute('hidden', '');
        }
        if (floatingToolsToggle) {
            floatingToolsToggle.setAttribute('aria-expanded', 'false');
        }
    };

    const closeViewSyncPanel = () => {
        if (viewSyncPanel) {
            viewSyncPanel.style.display = 'none';
        }
        if (viewSyncToggle) {
            viewSyncToggle.setAttribute('aria-expanded', 'false');
        }
    };

    const openFloatingToolsPanel = () => {
        if (!floatingToolsPanel) return;
        floatingToolsPanel.removeAttribute('hidden');
        if (floatingToolsToggle) {
            floatingToolsToggle.setAttribute('aria-expanded', 'true');
        }
        updateFloatingToolsModeControlState();
    };

    const toggleFloatingToolsPanel = () => {
        if (!floatingToolsPanel) return;
        if (floatingToolsPanel.hasAttribute('hidden')) {
            openFloatingToolsPanel();
        } else {
            closeFloatingToolsPanel();
        }
    };

    const closeMenu = () => {
        closeFloatingToolsPanel();
        closeViewSyncPanel();
        if (!menu.hasAttribute('hidden')) menu.setAttribute('hidden', '');
    };

    const openMenu = () => {
        if (typeof currentHeaderDockSide === 'string') {
            menu.dataset.dock = currentHeaderDockSide;
        }
        menu.removeAttribute('hidden');
        closeViewSyncPanel();
        closeFloatingToolsPanel();
    };

    toggle.addEventListener('click', (e) => {
        if (menu.hasAttribute('hidden')) {
            openMenu();
        } else {
            closeMenu();
        }
    });

    menu.addEventListener('click', (e) => {
        const modeBtn = e.target && e.target.closest ? e.target.closest('.floating-tools-mode-btn') : null;
        if (modeBtn && menu.contains(modeBtn)) {
            e.stopPropagation();
            const mode = modeBtn.dataset.mode || SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN;
            applySidePanelFloatingToolsMode(mode);
            return;
        }

        const storageBtn = e.target && e.target.closest ? e.target.closest('#settingsStorageSyncBlock button') : null;
        if (storageBtn && menu.contains(storageBtn)) {
            const keepOpen = storageBtn.id === 'clearMenuOtherBtn' || storageBtn.id === 'clearTempNodesOtherHelpBtn';
            if (!keepOpen) closeMenu();
            return;
        }

        const item = e.target && e.target.closest ? e.target.closest('.settings-menu-item') : null;
        if (!item) return;
        e.stopPropagation(); // Stop propagation to prevent document click listener from immediately closing modal
        const action = item.dataset.action || '';

        if (action === 'open-floating-toolbar') {
            closeViewSyncPanel();
            toggleFloatingToolsPanel();
            return;
        }

        closeMenu();

        if (action === 'toggle-theme') {
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle && typeof themeToggle.click === 'function') {
                themeToggle.click();
            }
            return;
        }

        if (action === 'toggle-language') {
            const langToggle = document.getElementById('langToggle');
            if (langToggle && typeof langToggle.click === 'function') {
                langToggle.click();
            }
            return;
        }

        if (action === 'open-help') {
            if (currentView === 'canvas') {
                if (window.CanvasModule && typeof window.CanvasModule.openShortcuts === 'function') {
                    window.CanvasModule.openShortcuts({ anchorToSettings: true });
                }
            } else {
                const helpToggle = document.getElementById('helpToggle');
                if (helpToggle && typeof helpToggle.click === 'function') {
                    helpToggle.click();
                }
            }
            return;
        }

        if (action === 'open-opensource') {
            if (window.CanvasModule && typeof window.CanvasModule.openOpenSource === 'function') {
                window.CanvasModule.openOpenSource();
            }
            return;
        }

        if (action === 'open-sidepanel-settings') {
            const sidePanelBtn = document.getElementById('canvasSidePanelSettingsBtn');
            if (sidePanelBtn && typeof sidePanelBtn.click === 'function') {
                window.setTimeout(() => {
                    try { sidePanelBtn.click(); } catch (_) { }
                }, 0);
            }
            return;
        }
        if (action === 'open-other-manage') {
            const otherBtn = document.getElementById('canvasOpenOtherManageBridgeBtn');
            if (otherBtn && typeof otherBtn.click === 'function') {
                window.setTimeout(() => {
                    try { otherBtn.click(); } catch (_) { }
                }, 0);
            }
            return;
        }
        if (action === 'open-canvas-manage') {
            const canvasBtn = document.getElementById('canvasOpenManageBridgeBtn');
            if (canvasBtn && typeof canvasBtn.click === 'function') {
                window.setTimeout(() => {
                    try { canvasBtn.click(); } catch (_) { }
                }, 0);
            }
            return;
        }
    });

    if (floatingToolsPanel && floatingToolsPanel.dataset.modeBound !== 'true') {
        floatingToolsPanel.dataset.modeBound = 'true';
        floatingToolsPanel.addEventListener('click', (e) => {
            const modeBtn = e.target && e.target.closest ? e.target.closest('.floating-tools-mode-btn') : null;
            if (!modeBtn || !floatingToolsPanel.contains(modeBtn)) return;
            e.stopPropagation();
            const mode = modeBtn.dataset.mode || SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN;
            applySidePanelFloatingToolsMode(mode);
        });
    }

    document.addEventListener('click', (e) => {
        const titleSettingsBtn = document.getElementById('titleSettingsToggleBtn');
        if (menu.contains(e.target) || toggle.contains(e.target) || (titleSettingsBtn && titleSettingsBtn.contains(e.target))) return;
        if (floatingToolsPanel && !floatingToolsPanel.hasAttribute('hidden') && floatingToolsPanel.contains(e.target)) return;
        closeMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
    });

}

function setupCanvasFloatingToolsMenu() {
    const toggleBtn = document.getElementById('canvasFloatingToolsToggleBtn');
    if (!toggleBtn) return;
    if (toggleBtn.dataset.bound === 'true') return;
    toggleBtn.dataset.bound = 'true';

    ensureCanvasFloatingDragHints(toggleBtn);
    bindCanvasFloatingToolsGlobalDragEvents();
    bindCanvasFloatingToolsResizeHandler();

    toggleBtn.addEventListener('pointerdown', (e) => {
        beginCanvasFloatingToolsDrag(e, toggleBtn, SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN);
    });

    toggleBtn.addEventListener('click', (e) => {
        if (suppressCanvasFloatingToolsToggleClick) {
            suppressCanvasFloatingToolsToggleClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        e.preventDefault();
        applySidePanelFloatingToolsMode(SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN);
    });
}

function setupCanvasFloatingMiniToggle() {
    const btn = document.getElementById('canvasFloatingToggleMini');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    ensureCanvasFloatingDragHints(btn);
    bindCanvasFloatingToolsGlobalDragEvents();
    bindCanvasFloatingToolsResizeHandler();

    btn.addEventListener('pointerdown', (e) => {
        beginCanvasFloatingToolsDrag(e, btn, SIDE_PANEL_FLOATING_TOOLS_MODES.HIDDEN);
    });

    btn.addEventListener('click', (e) => {
        if (suppressCanvasFloatingToolsToggleClick) {
            suppressCanvasFloatingToolsToggleClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        e.preventDefault();
        applySidePanelFloatingToolsMode(SIDE_PANEL_FLOATING_TOOLS_MODES.SHOWN);
    });
}

function getCanvasPageUrl() {
    return browserAPI?.runtime?.getURL
        ? browserAPI.runtime.getURL('history_html/history.html?view=canvas')
        : 'history_html/history.html?view=canvas';
}

function getCanvasPageExtensionOrigin() {
    try {
        if (!browserAPI?.runtime?.getURL) return null;
        return new URL(browserAPI.runtime.getURL('')).origin;
    } catch (_) {
        return null;
    }
}

function isMatchingCanvasPageUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;

    const extensionOrigin = getCanvasPageExtensionOrigin();
    try {
        const parsed = new URL(rawUrl);
        if (extensionOrigin && parsed.origin !== extensionOrigin) return false;
        if (!parsed.pathname.endsWith('/history_html/history.html')) return false;
        const view = parsed.searchParams.get('view');
        return !view || view === 'canvas';
    } catch (_) {
        return false;
    }
}

async function findLatestCanvasPageTabInCurrentWindow() {
    if (!browserAPI?.tabs?.query) return null;

    const tabs = await new Promise((resolve) => {
        try {
            browserAPI.tabs.query({ currentWindow: true }, (items) => {
                resolve(Array.isArray(items) ? items : []);
            });
        } catch (_) {
            resolve([]);
        }
    });

    const candidates = tabs
        .filter(tab => tab && typeof tab.id === 'number' && isMatchingCanvasPageUrl(tab.url))
        .sort((a, b) => {
            const aId = typeof a.id === 'number' ? a.id : -1;
            const bId = typeof b.id === 'number' ? b.id : -1;
            return bId - aId;
        });

    return candidates.length ? candidates[0] : null;
}

async function activateTab(tabId) {
    if (!browserAPI?.tabs?.update || typeof tabId !== 'number') return null;

    return await new Promise((resolve) => {
        try {
            browserAPI.tabs.update(tabId, { active: true }, (tab) => {
                resolve(tab || { id: tabId });
            });
        } catch (_) {
            resolve({ id: tabId });
        }
    });
}

async function createCanvasPageTab(url) {
    if (!browserAPI?.tabs?.create) return null;

    return await new Promise((resolve) => {
        try {
            browserAPI.tabs.create({ url, active: true }, (tab) => {
                resolve(tab || null);
            });
        } catch (_) {
            resolve(null);
        }
    });
}

async function waitForTabComplete(tabId, timeoutMs = 5000) {
    if (!browserAPI?.tabs?.onUpdated?.addListener || !browserAPI?.tabs?.get || typeof tabId !== 'number') {
        return;
    }

    await new Promise((resolve) => {
        let finished = false;
        let timerId = null;

        const done = () => {
            if (finished) return;
            finished = true;
            try {
                if (timerId) clearTimeout(timerId);
            } catch (_) { }
            try {
                browserAPI.tabs.onUpdated.removeListener(onUpdated);
            } catch (_) { }
            resolve();
        };

        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId) return;
            if (changeInfo && changeInfo.status === 'complete') {
                done();
            }
        };

        try {
            browserAPI.tabs.onUpdated.addListener(onUpdated);
        } catch (_) {
            resolve();
            return;
        }

        timerId = setTimeout(done, timeoutMs);

        try {
            browserAPI.tabs.get(tabId, (tab) => {
                if (tab && tab.status === 'complete') {
                    done();
                }
            });
        } catch (_) {
            done();
        }
    });
}

function normalizeCanvasFullscreenIntent(intent) {
    return intent === 'exit' || intent === 'status' ? intent : 'enter';
}

async function requestCanvasTabFullscreen(targetTabId, intent = 'enter') {
    if (typeof targetTabId !== 'number') return;

    const normalizedIntent = normalizeCanvasFullscreenIntent(intent);

    const payload = {
        targetTabId,
        nonce: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10),
        ts: Date.now(),
        intent: normalizedIntent
    };

    const sendRequestOnce = (payload) => new Promise((resolve) => {
        if (!browserAPI?.runtime?.sendMessage) {
            resolve();
            return;
        }
        try {
            browserAPI.runtime.sendMessage({
                action: CANVAS_PAGE_FULLSCREEN_BRIDGE_ACTION,
                targetTabId: payload.targetTabId,
                nonce: payload.nonce,
                ts: payload.ts,
                intent: payload.intent
            }, () => {
                try {
                    const err = browserAPI?.runtime?.lastError;
                    if (err && err.message) {
                        // ignore: background may respond first.
                    }
                } catch (_) { }
                resolve();
            });
        } catch (_) {
            resolve();
        }
    });

    const writeStorageBridgePayload = (payload) => new Promise((resolve) => {
        if (!browserAPI?.storage?.local?.set) {
            resolve();
            return;
        }
        try {
            browserAPI.storage.local.set({
                [CANVAS_PAGE_FULLSCREEN_BRIDGE_STORAGE_KEY]: payload
            }, () => {
                resolve();
            });
        } catch (_) {
            resolve();
        }
    });

    const retryCount = normalizedIntent === 'enter' ? 4 : 1;

    for (let i = 0; i < retryCount; i += 1) {
        await Promise.all([
            sendRequestOnce(payload),
            writeStorageBridgePayload(payload)
        ]);

        if (i < retryCount - 1) {
            await new Promise((resolve) => setTimeout(resolve, 160));
        }
    }
}

async function getCurrentHistoryPageTabId() {
    if (!browserAPI?.tabs?.getCurrent) return null;

    return await new Promise((resolve) => {
        try {
            browserAPI.tabs.getCurrent((tab) => {
                resolve(tab && typeof tab.id === 'number' ? tab.id : null);
            });
        } catch (_) {
            resolve(null);
        }
    });
}

function getCanvasContainerFullscreenState() {
    try {
        const container = document.querySelector('.canvas-main-container');
        const fullscreenElement = document.fullscreenElement
            || document.webkitFullscreenElement
            || document.mozFullScreenElement
            || document.msFullscreenElement;
        
        let isNowFullscreen = false;
        if (window.CanvasModule && window.CanvasModule.CanvasState && typeof window.CanvasModule.CanvasState.isFullscreen === 'boolean') {
            isNowFullscreen = window.CanvasModule.CanvasState.isFullscreen;
        } else {
            isNowFullscreen = !!(fullscreenElement && (fullscreenElement === container || fullscreenElement === document.documentElement || fullscreenElement === document.body));
        }

        return {
            container,
            isFullscreen: isNowFullscreen
        };
    } catch (_) {
        return { container: null, isFullscreen: false };
    }
}

window.getOverlayContainer = function() {
    const container = document.querySelector('.canvas-main-container');
    if (container && (document.fullscreenElement === container || 
                      document.webkitFullscreenElement === container || 
                      document.mozFullScreenElement === container || 
                      document.msFullscreenElement === container)) {
        return container;
    }
    return document.body;
};


function isCanvasFullscreenControlReady() {
    try {
        return Boolean(
            window.CanvasModule
            && window.CanvasModule.CanvasState
            && window.CanvasModule.CanvasState.fullscreenHandlersBound === true
        );
    } catch (_) {
        return false;
    }
}

async function waitForCanvasFullscreenState(targetIsFullscreen, timeoutMs = 700) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const { isFullscreen } = getCanvasContainerFullscreenState();
        if (isFullscreen === targetIsFullscreen) return true;
        await new Promise((resolve) => setTimeout(resolve, 80));
    }

    const { isFullscreen } = getCanvasContainerFullscreenState();
    return isFullscreen === targetIsFullscreen;
}

function setSidePanelMirroredCanvasFullscreen(nextState, options = {}) {
    if (!isSidePanelMode) return;
    const normalized = nextState === true;
    const force = options && options.force === true;
    if (!force && sidePanelMirroredCanvasFullscreen === normalized) return;

    sidePanelMirroredCanvasFullscreen = normalized;

    try {
        if (window.CanvasModule && typeof window.CanvasModule.updateFullscreenButton === 'function') {
            window.CanvasModule.updateFullscreenButton();
        }
    } catch (_) { }
}

function getSidePanelMirroredCanvasFullscreen() {
    return sidePanelMirroredCanvasFullscreen === true;
}

function normalizeCanvasFullscreenStatePayload(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') return null;

    const tabId = Number(rawPayload.tabId);
    const ts = Number(rawPayload.ts);
    const isFullscreen = rawPayload.isFullscreen === true;

    if (!Number.isFinite(tabId) || !Number.isFinite(ts)) return null;
    if (Date.now() - ts > CANVAS_PAGE_FULLSCREEN_STATE_MAX_AGE_MS) return null;

    return { tabId, ts, isFullscreen };
}

function applySidePanelFullscreenStatePayload(rawPayload, options = {}) {
    if (!isSidePanelMode) return;
    const payload = normalizeCanvasFullscreenStatePayload(rawPayload);
    if (!payload) {
        if (options && options.force === true) {
            setSidePanelMirroredCanvasFullscreen(false, { force: true });
        }
        return;
    }

    setSidePanelMirroredCanvasFullscreen(payload.isFullscreen, options);
}

async function publishCanvasPageFullscreenState(isFullscreenOverride = null) {
    if (isSidePanelMode) return;
    if (!browserAPI?.storage?.local?.set) return;

    const tabId = await getCurrentHistoryPageTabId();
    if (typeof tabId !== 'number') return;

    const isFullscreen = typeof isFullscreenOverride === 'boolean'
        ? isFullscreenOverride
        : getCanvasContainerFullscreenState().isFullscreen;

    await new Promise((resolve) => {
        try {
            browserAPI.storage.local.set({
                [CANVAS_PAGE_FULLSCREEN_STATE_STORAGE_KEY]: {
                    tabId,
                    isFullscreen,
                    ts: Date.now()
                }
            }, () => {
                resolve();
            });
        } catch (_) {
            resolve();
        }
    });
}

async function refreshSidePanelFullscreenStateFromCanvasPage() {
    if (!isSidePanelMode) return;

    const targetTab = await findLatestCanvasPageTabInCurrentWindow();
    if (!targetTab || typeof targetTab.id !== 'number') {
        setSidePanelMirroredCanvasFullscreen(false, { force: true });
        return;
    }

    await requestCanvasTabFullscreen(targetTab.id, 'status');
}

try {
    window.__canvasSidePanelGetFullscreenState = getSidePanelMirroredCanvasFullscreen;
    window.__canvasSidePanelPublishFullscreenStateFromModule = (isFullscreen) => {
        publishCanvasPageFullscreenState(isFullscreen).catch(() => { });
    };
} catch (_) { }

function normalizeCanvasFullscreenBridgePayload(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') return null;

    const targetTabId = Number(rawPayload.targetTabId);
    const ts = Number(rawPayload.ts);
    const intent = normalizeCanvasFullscreenIntent(rawPayload.intent);
    const nonce = typeof rawPayload.nonce === 'string'
        ? rawPayload.nonce
        : String(targetTabId) + '-' + String(ts);

    if (!Number.isFinite(targetTabId) || !Number.isFinite(ts)) return null;
    if (Date.now() - ts > CANVAS_PAGE_FULLSCREEN_BRIDGE_MAX_AGE_MS) return null;

    return { targetTabId, ts, nonce, intent };
}

function tryHandleCanvasFullscreenBridgePayload(rawPayload) {
    if (isSidePanelMode) return;

    const payload = normalizeCanvasFullscreenBridgePayload(rawPayload);
    if (!payload) return;
    if (lastHandledCanvasFullscreenBridgeNonce === payload.nonce) return;
    if (pendingCanvasFullscreenBridgeNonces.has(payload.nonce)) return;

    pendingCanvasFullscreenBridgeNonces.add(payload.nonce);

    getCurrentHistoryPageTabId().then((currentTabId) => {
        if (typeof currentTabId !== 'number' || currentTabId !== payload.targetTabId) {
            pendingCanvasFullscreenBridgeNonces.delete(payload.nonce);
            return;
        }

        triggerCanvasFullscreenButtonFromBridge(payload.intent)
            .then((handled) => {
                if (handled) {
                    lastHandledCanvasFullscreenBridgeNonce = payload.nonce;
                }
            })
            .catch(() => { })
            .finally(() => {
                pendingCanvasFullscreenBridgeNonces.delete(payload.nonce);
            });
    }).catch(() => {
        pendingCanvasFullscreenBridgeNonces.delete(payload.nonce);
    });
}

function setupCanvasFullscreenBridgeStorageListener() {
    if (canvasFullscreenBridgeStorageListenerBound) return;
    canvasFullscreenBridgeStorageListenerBound = true;

    if (browserAPI?.storage?.onChanged?.addListener) {
        try {
            browserAPI.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'local' || !changes) return;

                const bridgeChanged = changes[CANVAS_PAGE_FULLSCREEN_BRIDGE_STORAGE_KEY];
                if (bridgeChanged && ('newValue' in bridgeChanged)) {
                    tryHandleCanvasFullscreenBridgePayload(bridgeChanged.newValue);
                }

                const stateChanged = changes[CANVAS_PAGE_FULLSCREEN_STATE_STORAGE_KEY];
                if (stateChanged && ('newValue' in stateChanged)) {
                    applySidePanelFullscreenStatePayload(stateChanged.newValue, { force: true });
                }
            });
        } catch (_) { }
    }

    if (browserAPI?.storage?.local?.get) {
        try {
            browserAPI.storage.local.get([
                CANVAS_PAGE_FULLSCREEN_BRIDGE_STORAGE_KEY,
                CANVAS_PAGE_FULLSCREEN_STATE_STORAGE_KEY
            ], (data) => {
                const bridgePayload = data && data[CANVAS_PAGE_FULLSCREEN_BRIDGE_STORAGE_KEY];
                tryHandleCanvasFullscreenBridgePayload(bridgePayload);

                const statePayload = data && data[CANVAS_PAGE_FULLSCREEN_STATE_STORAGE_KEY];
                applySidePanelFullscreenStatePayload(statePayload, { force: true });
            });
        } catch (_) { }
    }

    if (!isSidePanelMode) {
        publishCanvasPageFullscreenState().catch(() => { });
    } else {
        refreshSidePanelFullscreenStateFromCanvasPage().catch(() => { });
    }
}

async function triggerCanvasFullscreenButtonFromBridge(intent = 'enter') {
    if (isSidePanelMode) return false;

    const normalizedIntent = normalizeCanvasFullscreenIntent(intent);
    const maxAttempts = normalizedIntent === 'enter' ? 28 : 16;

    if (currentView !== 'canvas' && typeof switchView === 'function') {
        try {
            switchView('canvas');
        } catch (_) { }
    }

    for (let i = 0; i < maxAttempts; i += 1) {
        const { isFullscreen } = getCanvasContainerFullscreenState();

        if (normalizedIntent === 'status') {
            publishCanvasPageFullscreenState(isFullscreen).catch(() => { });
            return true;
        }

        if (normalizedIntent === 'enter' && isFullscreen) {
            publishCanvasPageFullscreenState(true).catch(() => { });
            return true;
        }

        if (normalizedIntent === 'exit' && !isFullscreen) {
            publishCanvasPageFullscreenState(false).catch(() => { });
            return true;
        }

        if (!isCanvasFullscreenControlReady()) {
            await new Promise((resolve) => setTimeout(resolve, 120));
            continue;
        }

        const fullscreenBtn = document.getElementById('canvasFullscreenBtn');
        if (fullscreenBtn) {
            try {
                fullscreenBtn.click();
                const targetIsFullscreen = normalizedIntent === 'enter';
                const reached = await waitForCanvasFullscreenState(targetIsFullscreen, 700);
                if (reached) {
                    publishCanvasPageFullscreenState(targetIsFullscreen).catch(() => { });
                    return true;
                }
            } catch (_) { }
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
    }

    publishCanvasPageFullscreenState().catch(() => { });
    return false;
}

async function openOrFocusCanvasPage(options = {}) {
    const { requestFullscreen = false, fullscreenIntent = 'enter' } = options;
    const normalizedIntent = normalizeCanvasFullscreenIntent(fullscreenIntent);
    const url = getCanvasPageUrl();
    const shouldActivateExistingTab = !(requestFullscreen && normalizedIntent !== 'enter');

    let targetTab = await findLatestCanvasPageTabInCurrentWindow();
    if (targetTab && typeof targetTab.id === 'number') {
        if (shouldActivateExistingTab) {
            targetTab = await activateTab(targetTab.id);
        }
    } else if (requestFullscreen && normalizedIntent === 'exit') {
        setSidePanelMirroredCanvasFullscreen(false, { force: true });
        return null;
    } else {
        targetTab = await createCanvasPageTab(url);
    }

    const targetTabId = targetTab && typeof targetTab.id === 'number' ? targetTab.id : null;
    if (typeof targetTabId !== 'number') {
        if (requestFullscreen && normalizedIntent === 'exit') {
            setSidePanelMirroredCanvasFullscreen(false, { force: true });
            return null;
        }
        try {
            window.open(url, '_blank');
        } catch (_) { }
        return null;
    }

    if (requestFullscreen) {
        if (normalizedIntent === 'enter') {
            await waitForTabComplete(targetTabId);
        }
        await requestCanvasTabFullscreen(targetTabId, normalizedIntent);
        if (isSidePanelMode && normalizedIntent === 'enter') {
            try {
                await requestSidePanelToggle('closeSidePanelFromCanvasPage');
            } catch (_) {}
        }
    }

    return targetTabId;
}

try {
    window.__canvasSidePanelOpenOrFocusPage = openOrFocusCanvasPage;
} catch (_) { }

function setupOpenCanvasPageButton() {
    if (!isSidePanelMode) return;
    const btn = document.getElementById('openCanvasPageBtn');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await openOrFocusCanvasPage({ requestFullscreen: false });
        } catch (_) { }
    });
}

let lastFullscreenButtonsVisibilitySyncBound = false;

function hasStoredLastFullscreenNodeDescriptor() {
    const descriptor = __readLocalStorageJSON(CANVAS_NODE_LAST_MAXIMIZED_STORAGE_KEY);
    if (!descriptor || typeof descriptor !== 'object') {
        return false;
    }

    if (descriptor.type === 'permanent') {
        return true;
    }

    if (descriptor.type === 'permanent-copy') {
        const copyId = descriptor.copyId == null ? '' : String(descriptor.copyId).trim();
        return copyId.length > 0;
    }

    const id = descriptor.id == null ? '' : String(descriptor.id).trim();
    return id.length > 0;
}

function refreshLastFullscreenButtonsVisibility() {
    const hasStoredNode = hasStoredLastFullscreenNodeDescriptor();
    const buttonIds = ['titleLastFullscreenBtn', 'sideLastFullscreenBtn'];

    buttonIds.forEach((buttonId) => {
        const button = document.getElementById(buttonId);
        if (!button) return;

        let shouldHide = !hasStoredNode;
        if (buttonId === 'titleLastFullscreenBtn' && !isSidePanelMode) {
            shouldHide = true;
        }

        if (shouldHide && document.activeElement === button) {
            try { button.blur(); } catch (_) { }
        }

        button.hidden = shouldHide;
        if (button.hasAttribute('aria-hidden')) {
            button.removeAttribute('aria-hidden');
        }
    });
}

function bindLastFullscreenButtonsVisibilitySync() {
    if (lastFullscreenButtonsVisibilitySyncBound) return;
    lastFullscreenButtonsVisibilitySyncBound = true;

    window.addEventListener(CANVAS_LAST_MAXIMIZED_UPDATED_EVENT, () => {
        refreshLastFullscreenButtonsVisibility();
    });

    window.addEventListener('storage', (event) => {
        if (!event || event.key !== CANVAS_NODE_LAST_MAXIMIZED_STORAGE_KEY) return;
        refreshLastFullscreenButtonsVisibility();
    });
}

async function handleOpenLastFullscreenCard() {
    const openLastFullscreenNode = window.CanvasModule && typeof window.CanvasModule.openLastFullscreenNode === 'function'
        ? window.CanvasModule.openLastFullscreenNode
        : null;
    if (!openLastFullscreenNode) return;

    const needSwitchToCanvas = currentView !== 'canvas';
    if (needSwitchToCanvas && typeof switchView === 'function') {
        try {
            switchView('canvas');
        } catch (_) { }
    }

    const result = await openLastFullscreenNode({
        retries: needSwitchToCanvas ? 30 : 10,
        retryDelayMs: 120
    });
    if (result && result.success) return;

    if (!result || result.reason === 'empty' || result.reason === 'not-found') {
        __removeLocalStorageKey(CANVAS_NODE_LAST_MAXIMIZED_STORAGE_KEY);
        refreshLastFullscreenButtonsVisibility();
    }

    const msg = i18n.titleLastFullscreenNoCardToast[currentLang];
    try { showToast(msg); } catch (_) { }
}

function setupSideLastFullscreenButton() {
    if (!isSidePanelMode) return;
    const btn = document.getElementById('sideLastFullscreenBtn');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        await handleOpenLastFullscreenCard();
    });
}

function setupTitleSideTools() {
    if (isSidePanelMode) return;

    const titleLastFullscreenBtn = document.getElementById('titleLastFullscreenBtn');
    if (titleLastFullscreenBtn && titleLastFullscreenBtn.dataset.bound !== 'true') {
        titleLastFullscreenBtn.dataset.bound = 'true';
        titleLastFullscreenBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await handleOpenLastFullscreenCard();
        });
    }

    const titleSettingsBtn = document.getElementById('titleSettingsToggleBtn');
    const settingsMenu = document.getElementById('settingsMenu');
    if (titleSettingsBtn && settingsMenu && titleSettingsBtn.dataset.proxyBound !== 'true') {
        titleSettingsBtn.dataset.proxyBound = 'true';
        titleSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const floatingToolsPanel = document.getElementById('floatingToolsModePanel');
            const floatingToolsToggle = document.getElementById('settingsFloatingToolsToggle');
            if (settingsMenu.hasAttribute('hidden')) {
                settingsMenu.removeAttribute('hidden');
                if (floatingToolsPanel && !floatingToolsPanel.hasAttribute('hidden')) {
                    floatingToolsPanel.setAttribute('hidden', '');
                }
                if (floatingToolsToggle) {
                    floatingToolsToggle.setAttribute('aria-expanded', 'false');
                }
            } else {
                settingsMenu.setAttribute('hidden', '');
            }
        });
    }
}

async function getCurrentWindowIdForSidePanelToggle() {
    return await new Promise((resolve) => {
        try {
            if (!browserAPI?.windows?.getCurrent) {
                resolve(null);
                return;
            }
            browserAPI.windows.getCurrent((win) => {
                resolve(win && typeof win.id === 'number' ? win.id : null);
            });
        } catch (_) {
            resolve(null);
        }
    });
}

async function requestSidePanelToggle(action) {
    const payload = { action };
    const windowId = await getCurrentWindowIdForSidePanelToggle();
    if (typeof windowId === 'number') payload.windowId = windowId;

    return await new Promise((resolve) => {
        try {
            if (!browserAPI?.runtime?.sendMessage) {
                resolve({ success: false, error: 'runtime_unavailable' });
                return;
            }

            browserAPI.runtime.sendMessage(payload, (response) => {
                try {
                    const err = browserAPI?.runtime?.lastError;
                    if (err) {
                        resolve({ success: false, error: err.message || 'send_message_failed' });
                        return;
                    }
                } catch (_) { }
                resolve(response && typeof response === 'object' ? response : { success: false });
            });
        } catch (error) {
            resolve({ success: false, error: error?.message || 'send_message_failed' });
        }
    });
}

async function openSidePanelDirectlyFromCanvasPage() {
    const windowId = await getCurrentWindowIdForSidePanelToggle();
    if (typeof windowId !== 'number') return { success: false, error: 'window_unavailable' };
    if (!browserAPI?.sidePanel?.open) return { success: false, error: 'sidepanel_unavailable' };

    return await new Promise((resolve) => {
        try {
            browserAPI.sidePanel.open({ windowId }, () => {
                try {
                    const err = browserAPI?.runtime?.lastError;
                    if (err) {
                        resolve({ success: false, error: err.message || 'open_failed' });
                        return;
                    }
                } catch (_) { }
                resolve({ success: true, isOpen: true });
            });
        } catch (error) {
            resolve({ success: false, error: error?.message || 'open_failed' });
        }
    });
}

function applyTitleSidePanelToggleButtonState(isOpen) {
    const btn = document.getElementById('titleSidePanelToggleBtn');
    if (!btn) return;
    const open = isOpen === true;
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
}

function setupTitleSidePanelToggleButton() {
    if (isSidePanelMode) return;
    const btn = document.getElementById('titleSidePanelToggleBtn');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    let stateSyncSeq = 0;

    const syncButtonStateFromBackground = async () => {
        const requestSeq = ++stateSyncSeq;
        const result = await requestSidePanelToggle('getSidePanelStateFromCanvasPage');
        if (requestSeq !== stateSyncSeq) {
            return null;
        }
        if (result && result.success) {
            const isOpen = result.isOpen === true;
            applyTitleSidePanelToggleButtonState(isOpen);
            return isOpen;
        }
        return null;
    };

    const bootstrapState = async () => {
        await syncButtonStateFromBackground();
    };
    applyTitleSidePanelToggleButtonState(false);

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (btn.dataset.loading === 'true') return;
        btn.dataset.loading = 'true';

        try {
            const syncedState = await syncButtonStateFromBackground();
            const currentlyOpen = typeof syncedState === 'boolean'
                ? syncedState
                : btn.getAttribute('aria-pressed') === 'true';

            if (currentlyOpen) {
                const result = await requestSidePanelToggle('closeSidePanelFromCanvasPage');
                if (result && result.success) {
                    applyTitleSidePanelToggleButtonState(false);
                } else {
                    const failMsg = currentLang === 'en' ? 'Failed to toggle side panel' : '侧边栏切换失败';
                    try { showToast(failMsg); } catch (_) { }
                }
            } else {
                const openResult = await openSidePanelDirectlyFromCanvasPage();
                if (openResult && openResult.success) {
                    applyTitleSidePanelToggleButtonState(true);
                    try {
                        requestSidePanelToggle('markSidePanelOpenFromCanvasPage');
                    } catch (_) { }
                } else {
                    const failMsg = currentLang === 'en' ? 'Failed to toggle side panel' : '侧边栏切换失败';
                    try { showToast(failMsg); } catch (_) { }
                }
            }
        } finally {
            btn.dataset.loading = 'false';
        }
    });

    bootstrapState();
}
function setupQuickAddMenu() {
    const toggle = document.getElementById('quickAddToggle');
    const titleToggle = document.getElementById('titleQuickAddToggleBtn');
    const menu = document.getElementById('quickAddMenu');
    if (!toggle || !menu) return;
    if (menu.dataset.bound === 'true') return;
    menu.dataset.bound = 'true';

    const quickAddCurrentTitle = document.getElementById('quickAddCurrentTitle');
    const quickAddWindowTitle = document.getElementById('quickAddWindowTitle');
    const quickAddAllWindowsTitle = document.getElementById('quickAddAllWindowsTitle');
    const quickAddCurrentViewItem = document.getElementById('quickAddCurrentViewItem');
    const quickAddWindowViewItem = document.getElementById('quickAddWindowViewItem');
    const quickAddCurrentItems = menu.querySelectorAll('.quick-add-menu-item[data-action^="add-current-"]');
    const quickAddAllItems = menu.querySelectorAll('.quick-add-menu-item');
    const quickAddDivider = menu.querySelector('.quick-add-menu-divider');

    const setQuickAddMenuColorVars = () => {
        try {
            const appearanceGetter = window.CanvasModule && typeof window.CanvasModule.getCanvasAppearanceSettings === 'function'
                ? window.CanvasModule.getCanvasAppearanceSettings
                : null;
            const settings = appearanceGetter ? appearanceGetter() : null;
            const colors = settings && settings.colors ? settings.colors : null;
            const tempColor = (colors && colors.specialTemp) || '#e9973f';
            const permanentColor = (colors && colors.permanent) || '#10b981';
            const blankColor = (colors && colors.mdNode) || '#888888';
            const cardGroupColor = (colors && colors.cardGroup) || blankColor;
            menu.style.setProperty('--quick-add-special-temp-color', tempColor);
            menu.style.setProperty('--quick-add-permanent-color', permanentColor);
            menu.style.setProperty('--quick-add-blank-color', blankColor);
            menu.style.setProperty('--quick-add-card-group-color', cardGroupColor);
        } catch (_) {
            menu.style.setProperty('--quick-add-special-temp-color', '#e9973f');
            menu.style.setProperty('--quick-add-permanent-color', '#10b981');
            menu.style.setProperty('--quick-add-blank-color', '#888888');
            menu.style.setProperty('--quick-add-card-group-color', '#888888');
        }
    };

    quickAddAllItems.forEach((item) => {
        const action = item && item.dataset ? item.dataset.action || '' : '';
        if (!action) return;
        if (action.endsWith('-temp')) {
            item.dataset.kind = 'temp';
            return;
        }
        if (action.endsWith('-permanent')) {
            item.dataset.kind = 'permanent';
            return;
        }
        if (action.endsWith('-blank')) {
            item.dataset.kind = 'blank';
            return;
        }
        if (action.endsWith('-card-group')) {
            item.dataset.kind = 'card-group';
        }
    });

    const getQuickAddInlineOptionMode = (action) => {
        if (!action) return '';
        if (action === 'add-all-windows-card-group') return 'folder';
        if (!action.includes('window')) return '';
        if (action === 'add-window-blank') return 'heading';
        if (action === 'add-window-view' && !!getMaximizedMdNodeId()) return 'heading';
        return 'folder';
    };

    const readQuickAddInlineOptionChecked = (action, mode) => {
        return readQuickAddInlineActionOptionState(action, mode);
    };

    const writeQuickAddInlineOptionChecked = (action, mode, enabled) => {
        writeQuickAddInlineActionOptionState(action, mode, enabled);
    };

    const refreshQuickAddWindowFolderControls = () => {
        const lang = currentLang || 'zh_CN';
        quickAddAllItems.forEach((item) => {
            const action = item && item.dataset ? item.dataset.action || '' : '';
            const optionMode = getQuickAddInlineOptionMode(action);
            const existed = item.querySelector('.quick-add-window-folder-option');

            if (!optionMode) {
                item.classList.remove('quick-add-menu-item-with-folder-toggle');
                if (existed) existed.remove();
                return;
            }

            item.classList.add('quick-add-menu-item-with-folder-toggle');

            let optionEl = existed;
            if (!optionEl) {
                optionEl = document.createElement('span');
                optionEl.className = 'quick-add-window-folder-option';
                optionEl.innerHTML = `
                    <input type="checkbox" class="quick-add-window-folder-checkbox">
                    <span class="quick-add-window-folder-option-text"></span>
                `;
                item.appendChild(optionEl);

                const checkboxEl = optionEl.querySelector('.quick-add-window-folder-checkbox');
                if (checkboxEl) {
                    checkboxEl.addEventListener('click', (event) => {
                        event.stopPropagation();
                    });
                    checkboxEl.addEventListener('change', (event) => {
                        event.stopPropagation();
                        const actionValue = item && item.dataset ? item.dataset.action || '' : '';
                        const nextMode = checkboxEl.dataset.mode || optionEl.dataset.mode || 'folder';
                        const nextChecked = !!checkboxEl.checked;
                        writeQuickAddInlineOptionChecked(actionValue, nextMode, nextChecked);
                    });
                }

            }

            optionEl.dataset.mode = optionMode;

            const checkboxEl = optionEl.querySelector('.quick-add-window-folder-checkbox');
            const textEl = optionEl.querySelector('.quick-add-window-folder-option-text');
            if (checkboxEl) {
                checkboxEl.dataset.mode = optionMode;
                checkboxEl.checked = readQuickAddInlineOptionChecked(action, optionMode);
            }
            if (textEl) {
                textEl.textContent = optionMode === 'heading'
                    ? (lang === 'zh_CN' ? '一级标题' : 'Heading')
                    : (lang === 'zh_CN' ? '外裹文件夹' : 'Wrapper Folder');
            }
        });
    };

    const syncQuickAddMenuSections = (options = {}) => {
        const fromTitle = options && options.fromTitle === true;
        const hideCurrentGroup = fromTitle || !isSidePanelMode;
        const isFullscreenQuickAdd = !!document.querySelector('.canvas-node-maximized');

        if (isFullscreenQuickAdd) {
            menu.classList.add('quick-add-menu-fullscreen-only');
            if (quickAddCurrentTitle) quickAddCurrentTitle.style.display = 'none';
            if (quickAddWindowTitle) quickAddWindowTitle.style.display = 'none';
            if (quickAddAllWindowsTitle) quickAddAllWindowsTitle.style.display = 'none';
            if (quickAddDivider) quickAddDivider.style.display = 'none';
            quickAddAllItems.forEach((item) => {
                const action = item && item.dataset ? item.dataset.action || '' : '';
                const allowCurrentViewAction = isSidePanelMode && action === 'add-current-view';
                const visible = allowCurrentViewAction || action === 'add-window-view';
                item.style.display = visible ? '' : 'none';
            });
            return;
        }

        menu.classList.remove('quick-add-menu-fullscreen-only');

        if (quickAddCurrentViewItem) quickAddCurrentViewItem.style.display = 'none';
        if (quickAddWindowViewItem) quickAddWindowViewItem.style.display = 'none';

        if (quickAddCurrentTitle) quickAddCurrentTitle.style.display = hideCurrentGroup ? 'none' : '';
        if (quickAddWindowTitle) quickAddWindowTitle.style.display = '';
        if (quickAddAllWindowsTitle) quickAddAllWindowsTitle.style.display = '';
        quickAddCurrentItems.forEach((item) => {
            const action = item && item.dataset ? item.dataset.action || '' : '';
            if (action === 'add-current-view') return;
            item.style.display = hideCurrentGroup ? 'none' : '';
        });
        quickAddAllItems.forEach((item) => {
            const action = item && item.dataset ? item.dataset.action || '' : '';
            if (action === 'add-current-view' || action === 'add-window-view') return;
            if (hideCurrentGroup && action.startsWith('add-current-')) {
                item.style.display = 'none';
                return;
            }
            item.style.display = '';
        });
        if (quickAddDivider) quickAddDivider.style.display = hideCurrentGroup ? 'none' : '';
    };

    const positionQuickAddMenu = (options = {}) => {
        if (!isSidePanelMode || menu.hasAttribute('hidden')) return;

        const fromTitle = options && options.fromTitle === true;
        const anchor = (fromTitle && titleToggle) ? titleToggle : toggle;
        if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;

        const host = menu.offsetParent || anchor.closest('.header-right') || menu.parentElement;
        if (!host || typeof host.getBoundingClientRect !== 'function') return;

        const hostRect = host.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const menuWidth = menuRect.width || menu.offsetWidth || 280;
        const edgePadding = 8;
        const sidePanelNudgeRight = 14;

        const centeredLeft = anchorRect.left + (anchorRect.width / 2) - hostRect.left - (menuWidth / 2) + sidePanelNudgeRight;
        const maxLeft = Math.max(edgePadding, hostRect.width - menuWidth - edgePadding);
        const nextLeft = Math.min(Math.max(centeredLeft, edgePadding), maxLeft);

        menu.style.left = `${Math.round(nextLeft)}px`;
        menu.style.right = 'auto';
        menu.style.transform = 'none';
    };

    const closeMenu = () => {
        if (!menu.hasAttribute('hidden')) menu.setAttribute('hidden', '');
    };

    const openMenu = (options = {}) => {
        setQuickAddMenuColorVars();
        menu.dataset.openFromTitle = options && options.fromTitle === true ? 'true' : 'false';
        syncQuickAddMenuSections(options);
        refreshQuickAddWindowFolderControls();
        if (typeof currentHeaderDockSide === 'string') {
            menu.dataset.dock = currentHeaderDockSide;
        }
        menu.removeAttribute('hidden');

        if (isSidePanelMode) {
            positionQuickAddMenu(options);
            requestAnimationFrame(() => positionQuickAddMenu(options));
        } else {
            menu.style.left = '';
            menu.style.right = '';
            menu.style.transform = '';
        }
    };

    setQuickAddMenuColorVars();
    syncQuickAddMenuSections({ fromTitle: false });
    refreshQuickAddWindowFolderControls();
    try {
        window.__refreshQuickAddWindowFolderOptionLabels = refreshQuickAddWindowFolderControls;
    } catch (_) { }

    const toggleMenu = (options = {}) => {
        if (menu.hasAttribute('hidden')) {
            openMenu(options);
        } else {
            closeMenu();
        }
    };

    toggle.addEventListener('click', (e) => {
        toggleMenu({ fromTitle: false });
    });

    if (titleToggle && titleToggle.dataset.bound !== 'true') {
        titleToggle.dataset.bound = 'true';
        titleToggle.addEventListener('click', (e) => {
            toggleMenu({ fromTitle: true });
        });
    }

    menu.addEventListener('click', async (e) => {
        if (e.target && e.target.closest && e.target.closest('.quick-add-window-folder-checkbox')) {
            return;
        }
        const item = e.target && e.target.closest ? e.target.closest('.quick-add-menu-item') : null;
        if (!item) return;
        const action = item.dataset.action || '';
        closeMenu();
        try {
            await handleQuickAddAction(action);
        } catch (err) {
            const msg = currentLang === 'en' ? 'Add failed' : '添加失败';
            try { showToast(`${msg}: ${err && err.message ? err.message : String(err)}`); } catch (_) { }
        }
    });

    document.addEventListener('click', (e) => {
        const inTitleToggle = titleToggle && titleToggle.contains(e.target);
        if (menu.contains(e.target) || toggle.contains(e.target) || inTitleToggle) return;
        closeMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
    });

    const refreshCurrentViewEntry = () => {
        const fromTitle = menu.dataset.openFromTitle === 'true';
        syncQuickAddMenuSections({ fromTitle });
        refreshQuickAddWindowFolderControls();
        if (!menu.hasAttribute('hidden')) {
            positionQuickAddMenu({ fromTitle });
        }
    };

    if (document.body && document.documentElement.getAttribute('data-current-view-add-observer') !== 'true') {
        const observer = new MutationObserver(() => {
            refreshCurrentViewEntry();
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
        try {
            window.__canvasCurrentViewAddObserver = observer;
        } catch (_) { }
        document.documentElement.setAttribute('data-current-view-add-observer', 'true');
    }

    try {
        window.__canvasRefreshCurrentViewAddButton = refreshCurrentViewEntry;
    } catch (_) { }
}

function readQuickAddWindowAsFolderOption() {
    try {
        const raw = localStorage.getItem(QUICK_ADD_WINDOW_FOLDER_OPTION_STORAGE_KEY);
        if (raw === null) return true;
        return raw === '1';
    } catch (_) {
        return true;
    }
}

function writeQuickAddWindowAsFolderOption(enabled) {
    try {
        localStorage.setItem(QUICK_ADD_WINDOW_FOLDER_OPTION_STORAGE_KEY, enabled ? '1' : '0');
    } catch (_) { }
}

function readQuickAddBlankHeadingOption() {
    try {
        const raw = localStorage.getItem(QUICK_ADD_BLANK_HEADING_OPTION_STORAGE_KEY);
        if (raw === null) return true;
        return raw === '1';
    } catch (_) {
        return true;
    }
}

function writeQuickAddBlankHeadingOption(enabled) {
    try {
        localStorage.setItem(QUICK_ADD_BLANK_HEADING_OPTION_STORAGE_KEY, enabled ? '1' : '0');
    } catch (_) { }
}

function normalizeQuickAddInlineOptionState(value, fallback = true) {
    if (value === true || value === '1' || value === 1 || value === 'true') return true;
    if (value === false || value === '0' || value === 0 || value === 'false') return false;
    return !!fallback;
}

function readQuickAddInlineOptionStateMap() {
    try {
        const raw = localStorage.getItem(QUICK_ADD_INLINE_OPTION_STATES_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeQuickAddInlineOptionStateMap(map) {
    try {
        localStorage.setItem(QUICK_ADD_INLINE_OPTION_STATES_STORAGE_KEY, JSON.stringify(map || {}));
    } catch (_) { }
}

function getQuickAddInlineOptionStateKey(action, mode) {
    const actionKey = String(action || '').trim();
    const modeKey = String(mode || '').trim() || 'folder';
    return `${actionKey}::${modeKey}`;
}

function readQuickAddInlineActionOptionState(action, mode) {
    const stateMap = readQuickAddInlineOptionStateMap();
    const stateKey = getQuickAddInlineOptionStateKey(action, mode);
    if (Object.prototype.hasOwnProperty.call(stateMap, stateKey)) {
        return normalizeQuickAddInlineOptionState(stateMap[stateKey], true);
    }
    if (action === 'add-all-windows-card-group') {
        return false;
    }
    return true;
}

function writeQuickAddInlineActionOptionState(action, mode, enabled) {
    const stateMap = readQuickAddInlineOptionStateMap();
    const stateKey = getQuickAddInlineOptionStateKey(action, mode);
    stateMap[stateKey] = !!enabled;
    writeQuickAddInlineOptionStateMap(stateMap);
}

function buildQuickAddWindowFolderItems(items, scope = 'window') {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    return [{
        type: 'folder',
        title: buildSectionTitle(list, scope),
        children: list
    }];
}

async function handleQuickAddAction(action) {
    if (!action) return;

    if (action === 'add-all-windows-card-group') {
        const windowAsFolder = readQuickAddInlineActionOptionState(action, 'folder');
        await archiveAllWindowsToCardGroup({ windowAsFolder });
        return;
    }

    const isWindowScopeAction = action.includes('window');
    const isWindowViewAction = action === 'add-window-view';
    const isBlankViewTarget = isWindowViewAction && !!getMaximizedMdNodeId();
    const isBlankTargetAction = action.includes('blank') || isBlankViewTarget;
    const blankUseHeading = isBlankTargetAction && readQuickAddInlineActionOptionState(action, 'heading');
    const canUseWindowAsFolder = isWindowScopeAction && !isBlankTargetAction;
    const windowAsFolder = canUseWindowAsFolder && readQuickAddInlineActionOptionState(action, 'folder');

    if (action === 'add-current-view' || action === 'add-window-view') {
        const viewScope = action === 'add-window-view' ? 'window' : 'current';
        const tabsForCurrentView = viewScope === 'window'
            ? await getCurrentWindowTabs()
            : await getActiveTabList();
        const normalizedForCurrentView = await normalizeTabsForQuickAdd(tabsForCurrentView, {
            groupByTabGroup: viewScope === 'window'
        });
        const flatForCurrentView = Array.isArray(normalizedForCurrentView.flatItems) ? normalizedForCurrentView.flatItems : [];
        const structuredForCurrentView = Array.isArray(normalizedForCurrentView.structuredItems) ? normalizedForCurrentView.structuredItems : [];

        if (!flatForCurrentView.length) {
            const msg = currentLang === 'en' ? 'No valid pages to add' : '没有可添加的页面';
            try { showToast(msg); } catch (_) { }
            return;
        }

        const baseItemsForCurrentView = structuredForCurrentView.length ? structuredForCurrentView : flatForCurrentView;
        const itemsForCurrentView = (viewScope === 'window' && windowAsFolder)
            ? buildQuickAddWindowFolderItems(baseItemsForCurrentView, viewScope)
            : baseItemsForCurrentView;

        const addToCurrentOptions = {
            skipAutoSectionFolder: viewScope === 'window'
        };
        if (viewScope === 'window' && isBlankViewTarget) {
            addToCurrentOptions.useBlankHeading = blankUseHeading;
        }

        await addTabsToCurrentViewSection(itemsForCurrentView, viewScope, addToCurrentOptions);
        return;
    }

    const scope = isWindowScopeAction ? 'window' : 'current';
    const target = action.includes('permanent') ? 'permanent'
        : (action.includes('blank') ? 'blank' : 'temp');

    const tabs = scope === 'window'
        ? await getCurrentWindowTabs()
        : await getActiveTabList();

    const normalized = await normalizeTabsForQuickAdd(tabs, {
        groupByTabGroup: scope === 'window'
    });
    const flatItems = Array.isArray(normalized.flatItems) ? normalized.flatItems : [];
    const structuredItems = Array.isArray(normalized.structuredItems) ? normalized.structuredItems : [];

    if (!flatItems.length) {
        const msg = currentLang === 'en' ? 'No valid pages to add' : '没有可添加的页面';
        try { showToast(msg); } catch (_) { }
        return;
    }

    const baseItems = structuredItems.length ? structuredItems : flatItems;
    const itemsForTarget = (scope === 'window' && windowAsFolder)
        ? buildQuickAddWindowFolderItems(baseItems, scope)
        : baseItems;

    if (target === 'permanent') {
        await addTabsToPermanent(itemsForTarget, scope, { skipAutoSectionFolder: scope === 'window' });
        return;
    }
    if (target === 'blank') {
        await addTabsToBlankNode(itemsForTarget, scope, { useHeading: blankUseHeading });
        return;
    }
    await addTabsToTempSection(itemsForTarget, scope);
}

function getAllWindowsWithTabs() {
    return new Promise((resolve) => {
        if (!browserAPI || !browserAPI.windows || typeof browserAPI.windows.getAll !== 'function') {
            resolve([]);
            return;
        }
        browserAPI.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
            const err = browserAPI.runtime && browserAPI.runtime.lastError;
            if (err) {
                console.warn('[Archive] windows.getAll failed:', err.message);
                resolve([]);
                return;
            }
            resolve(Array.isArray(windows) ? windows : []);
        });
    });
}

function getAllTabGroups() {
    return new Promise((resolve) => {
        if (!browserAPI || !browserAPI.tabGroups || typeof browserAPI.tabGroups.query !== 'function') {
            resolve([]);
            return;
        }
        browserAPI.tabGroups.query({}, (groups) => {
            const err = browserAPI.runtime && browserAPI.runtime.lastError;
            if (err) {
                console.warn('[Archive] tabGroups.query failed:', err.message);
                resolve([]);
                return;
            }
            resolve(Array.isArray(groups) ? groups : []);
        });
    });
}

async function archiveAllWindowsToCardGroup(options = {}) {
    const isEn = currentLang === 'en';
    const showToastMsg = (msg) => {
        try { showToast(msg); } catch (_) { }
    };

    const windows = await getAllWindowsWithTabs();
    if (!windows || !windows.length) {
        showToastMsg(isEn ? 'No windows found to archive' : '未找到可存档的窗口');
        return;
    }

    const addableTabsByWindow = [];
    for (const win of windows) {
        const tabs = (win.tabs || []).filter(tab => {
            const url = tab.url || tab.pendingUrl;
            return url && isAddableUrl(url);
        });
        if (tabs.length > 0) {
            addableTabsByWindow.push({
                window: win,
                tabs: tabs
            });
        }
    }

    if (!addableTabsByWindow.length) {
        showToastMsg(isEn ? 'No valid pages to archive' : '没有可存档的页面');
        return;
    }

    if (!window.CanvasModule || !window.CanvasModule.createEmptyTempSection || !window.CanvasModule.temp) {
        showToastMsg(isEn ? 'Canvas Module is not ready' : '画布模块未就绪');
        return;
    }

    const settings = window.CanvasModule.getCanvasAppearanceSettings() || {};
    const sizes = settings.sizes || {};
    const tempWidth = (sizes.temp && sizes.temp.width) || 500;
    const tempHeight = (sizes.temp && sizes.temp.height) || 450;

    const gap = 80;
    const totalWidth = addableTabsByWindow.length * tempWidth + (addableTabsByWindow.length - 1) * gap;

    let pos = options.position;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        pos = getCanvasCenterPoint();
    }

    const startX = pos.x - totalWidth / 2;
    const startY = pos.y - tempHeight / 2;

    const activeGroups = await getAllTabGroups();
    const groupInfoMap = new Map();
    activeGroups.forEach(g => groupInfoMap.set(g.id, g));

    const sectionIds = [];

    let loadingToast = null;
    if (typeof window.showLoadingToast === 'function' && addableTabsByWindow.length > 1) {
        const initialMsg = isEn ? 'Archiving windows...' : '正在一键存档所有窗口...';
        loadingToast = window.showLoadingToast(initialMsg);
    }

    for (let i = 0; i < addableTabsByWindow.length; i++) {
        if (loadingToast) {
            const msg = isEn
                ? `Archiving window ${i + 1} of ${addableTabsByWindow.length}...`
                : `正在存档第 ${i + 1}/${addableTabsByWindow.length} 个窗口...`;
            loadingToast.update(msg);
        }

        const winData = addableTabsByWindow[i];
        const win = winData.window;
        const tabs = winData.tabs;

        const structuredItems = [];
        const groupedFolderMap = new Map();

        tabs.forEach((tab) => {
            const groupId = (tab && typeof tab.groupId === 'number') ? tab.groupId : -1;
            if (groupId >= 0) {
                let folder = groupedFolderMap.get(groupId);
                if (!folder) {
                    folder = {
                        type: 'folder',
                        title: resolveTabGroupFolderTitle(groupId, groupInfoMap.get(groupId)),
                        children: []
                    };
                    groupedFolderMap.set(groupId, folder);
                    structuredItems.push(folder);
                }
                folder.children.push({
                    type: 'bookmark',
                    title: tab.title || tab.url,
                    url: tab.url
                });
            } else {
                structuredItems.push({
                    type: 'bookmark',
                    title: tab.title || tab.url,
                    url: tab.url
                });
            }
        });

        const x = startX + i * (tempWidth + gap);
        const y = startY;

        let windowTitle = '';
        if (win.focused) {
            windowTitle = isEn ? 'Main Window' : '主窗口';
        } else {
            windowTitle = (isEn ? 'Window ' : '窗口 ') + (i + 1);
        }
        windowTitle += ` (${tabs.length})`;

        const windowAsFolder = !!(options && options.windowAsFolder);
        const initialItems = windowAsFolder ? [{
            type: 'folder',
            title: windowTitle,
            children: structuredItems
        }] : structuredItems;

        const sectionId = window.CanvasModule.createEmptyTempSection(x, y, {
            title: windowTitle,
            label: isEn ? 'Archive' : '存档',
            source: 'quick-add',
            initialItems: initialItems
        });

        if (sectionId) {
            sectionIds.push(sectionId);
            if (window.CanvasModule.temp.ensureRendered) {
                window.CanvasModule.temp.ensureRendered(sectionId);
            }
        }

        // yield to event loop to prevent UI freezing
        await new Promise(resolve => setTimeout(resolve, 30));
    }

    if (loadingToast) {
        loadingToast.close();
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const CanvasState = window.CanvasModule.CanvasState;
            if (!CanvasState || !Array.isArray(CanvasState.tempSections)) return;

            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;

            sectionIds.forEach(id => {
                const section = CanvasState.tempSections.find(s => s && s.id === id);
                if (!section) return;
                const x = section.x;
                const y = section.y;
                const w = section.width;
                const h = section.height;

                if (x < minX) minX = x;
                if (x + w > maxX) maxX = x + w;
                if (y < minY) minY = y;
                if (y + h > maxY) maxY = y + h;
            });

            if (minX === Infinity) return;

            const paddingX = 40;
            const paddingY = 60;
            const groupX = minX - paddingX;
            const groupY = minY - paddingY;
            const groupWidth = (maxX - minX) + 2 * paddingX;
            const groupHeight = (maxY - minY) + paddingY + paddingX;

            const baseLabel = isEn ? 'Archived Windows' : '一键存档';
            let groupLabel = baseLabel;
            if (CanvasState && Array.isArray(CanvasState.mdNodes)) {
                let maxIndex = 0;
                let baseFound = false;
                const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`^${escapeRegExp(baseLabel)}(?:\\s*\\((\\d+)\\))?$`);

                CanvasState.mdNodes.forEach(node => {
                    if (!node || node.subtype !== 'card-group' || typeof node.label !== 'string') return;
                    const match = node.label.match(pattern);
                    if (match) {
                        if (match[1]) {
                            const num = parseInt(match[1], 10);
                            if (Number.isFinite(num)) {
                                maxIndex = Math.max(maxIndex, num);
                            }
                        } else {
                            baseFound = true;
                        }
                    }
                });

                if (baseFound || maxIndex > 0) {
                    groupLabel = `${baseLabel} (${maxIndex + 1})`;
                }
            }
            const defaultColor = (typeof getCardGroupDefaultColor === 'function')
                ? getCardGroupDefaultColor()
                : ((window.CanvasModule && typeof window.CanvasModule.getCardGroupDefaultColor === 'function')
                    ? window.CanvasModule.getCardGroupDefaultColor()
                    : null);

            const groupNode = {
                id: `card-group-${++CanvasState.mdNodeCounter}`,
                type: 'md',
                subtype: 'card-group',
                x: groupX,
                y: groupY,
                width: groupWidth,
                height: groupHeight,
                label: groupLabel,
                color: null,
                colorHex: defaultColor || null,
                pinned: false,
                createdAt: Date.now()
            };

            CanvasState.mdNodes.push(groupNode);

            if (typeof renderMdNode === 'function') {
                renderMdNode(groupNode);
            } else if (window.CanvasModule.renderMdNode) {
                window.CanvasModule.renderMdNode(groupNode);
            }

            if (typeof saveTempNodes === 'function') {
                saveTempNodes();
            }
            if (typeof scheduleBoundsUpdate === 'function') {
                scheduleBoundsUpdate();
            }

            const successMsg = isEn
                ? `Archived all windows into a card group`
                : `一键存档已完成，已包含所有窗口的所有页面并打包到卡片组`;
            showToastMsg(successMsg);
        });
    });
}

function queryTabs(params) {
    return new Promise((resolve) => {
        if (!browserAPI || !browserAPI.tabs || typeof browserAPI.tabs.query !== 'function') {
            resolve([]);
            return;
        }
        browserAPI.tabs.query(params, (tabs) => {
            const err = browserAPI.runtime && browserAPI.runtime.lastError;
            if (err) {
                console.warn('[QuickAdd] tabs.query failed:', err.message);
                resolve([]);
                return;
            }
            resolve(Array.isArray(tabs) ? tabs : []);
        });
    });
}

function sortQuickAddTabsByIndex(tabs) {
    const list = Array.isArray(tabs) ? tabs.slice() : [];
    list.sort((left, right) => {
        const leftIndex = (left && typeof left.index === 'number') ? left.index : Number.MAX_SAFE_INTEGER;
        const rightIndex = (right && typeof right.index === 'number') ? right.index : Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        const leftId = (left && typeof left.id === 'number') ? left.id : Number.MAX_SAFE_INTEGER;
        const rightId = (right && typeof right.id === 'number') ? right.id : Number.MAX_SAFE_INTEGER;
        return leftId - rightId;
    });
    return list;
}

function dedupeQuickAddTabs(tabs) {
    const sortedTabs = sortQuickAddTabsByIndex(tabs);
    const seen = new Set();
    const deduped = [];
    sortedTabs.forEach((tab) => {
        if (!tab) return;
        const key = (typeof tab.id === 'number')
            ? `id:${tab.id}`
            : `${String(tab.url || tab.pendingUrl || '')}|${typeof tab.index === 'number' ? tab.index : ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(tab);
    });
    return deduped;
}

async function getActiveTabList() {
    const highlightedTabs = dedupeQuickAddTabs(await queryTabs({ highlighted: true, currentWindow: true }));
    if (highlightedTabs.length > 0) {
        return highlightedTabs;
    }

    const activeTabs = dedupeQuickAddTabs(await queryTabs({ active: true, currentWindow: true }));
    const activeTab = activeTabs[0] || null;
    return activeTab ? [activeTab] : [];
}

async function getCurrentWindowTabs() {
    const tabs = await queryTabs({ currentWindow: true, windowType: 'normal' });
    return dedupeQuickAddTabs(tabs);
}

async function normalizeTabsForQuickAdd(tabs, options = {}) {
    const normalizedTabs = [];
    const flatItems = [];
    const seen = new Set();
    const groupByTabGroup = !!(options && options.groupByTabGroup);

    (Array.isArray(tabs) ? tabs : []).forEach((tab) => {
        const url = tab && (tab.url || tab.pendingUrl);
        if (!url || !isAddableUrl(url)) return;

        const groupId = (tab && typeof tab.groupId === 'number') ? tab.groupId : -1;
        const dedupKey = (tab && typeof tab.id === 'number')
            ? `id:${tab.id}`
            : `${String(url)}|${groupId}|${tab && typeof tab.index === 'number' ? tab.index : ''}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);

        const title = (tab && tab.title) ? String(tab.title) : String(url);
        const item = {
            type: 'bookmark',
            title,
            url: String(url),
            groupId,
            index: (tab && typeof tab.index === 'number') ? tab.index : Number.MAX_SAFE_INTEGER
        };
        normalizedTabs.push(item);
        flatItems.push({ title: item.title, url: item.url });
    });

    if (!normalizedTabs.length) {
        return { flatItems: [], structuredItems: [] };
    }

    const structuredItems = groupByTabGroup
        ? await buildStructuredItemsFromTabs(normalizedTabs)
        : [];
    return { flatItems, structuredItems };
}

async function buildStructuredItemsFromTabs(tabs) {
    const groupIds = Array.from(new Set(
        tabs
            .map(tab => (tab && typeof tab.groupId === 'number') ? tab.groupId : -1)
            .filter(groupId => groupId >= 0)
    ));

    const groupInfoMap = new Map();
    await Promise.all(groupIds.map(async (groupId) => {
        const group = await getTabGroupInfo(groupId);
        groupInfoMap.set(groupId, group);
    }));

    const groupedFolderMap = new Map();
    const structured = [];

    tabs.forEach((tab) => {
        if (!tab || tab.type !== 'bookmark') return;

        if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
            let folder = groupedFolderMap.get(tab.groupId);
            if (!folder) {
                folder = {
                    type: 'folder',
                    title: resolveTabGroupFolderTitle(tab.groupId, groupInfoMap.get(tab.groupId)),
                    children: []
                };
                groupedFolderMap.set(tab.groupId, folder);
                structured.push(folder);
            }
            folder.children.push({
                type: 'bookmark',
                title: tab.title,
                url: tab.url
            });
            return;
        }

        structured.push({
            type: 'bookmark',
            title: tab.title,
            url: tab.url
        });
    });

    return structured;
}

function getTabGroupInfo(groupId) {
    return new Promise((resolve) => {
        if (!browserAPI || !browserAPI.tabGroups || typeof browserAPI.tabGroups.get !== 'function') {
            resolve(null);
            return;
        }

        browserAPI.tabGroups.get(groupId, (group) => {
            const err = browserAPI.runtime && browserAPI.runtime.lastError;
            if (err) {
                console.warn('[QuickAdd] tabGroups.get failed:', err.message);
                resolve(null);
                return;
            }
            resolve(group || null);
        });
    });
}

function resolveTabGroupFolderTitle(groupId, group) {
    if (group && typeof group.title === 'string') {
        return group.title.trim();
    }
    return '';
}

function resolveQuickAddFolderTitle(title) {
    if (typeof title === 'string') {
        return title.trim();
    }
    return currentLang === 'en' ? 'Folder' : '文件夹';
}

function isAddableUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(u)) return false;
    return /^(https?|file):/i.test(u);
}

function pad2(num) {
    return String(num).padStart(2, '0');
}

function formatDateTimeShort() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function getCanvasCenterPoint() {
    const workspace = document.getElementById('canvasWorkspace');
    const state = window.CanvasModule && window.CanvasModule.CanvasState ? window.CanvasModule.CanvasState : null;
    if (!workspace || !state) return { x: 0, y: 0 };
    const rect = workspace.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const zoom = state.zoom || 1;
    const canvasX = (centerX - rect.left - (state.panOffsetX || 0)) / zoom;
    const canvasY = (centerY - rect.top - (state.panOffsetY || 0)) / zoom;
    return { x: canvasX, y: canvasY };
}

function getMaximizedTempSectionId() {
    const el = document.querySelector('.temp-canvas-node.canvas-node-maximized');
    if (!el) return null;
    return (el.dataset && el.dataset.sectionId) ? el.dataset.sectionId : (el.id || null);
}

function getMaximizedMdNodeId() {
    const el = document.querySelector('.md-canvas-node.canvas-node-maximized');
    return el ? el.id : null;
}

function getMaximizedPermanentSectionElement() {
    return document.querySelector('.permanent-bookmark-section.canvas-node-maximized');
}

function countQuickAddBookmarks(items) {
    let count = 0;
    (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item) return;
        if (item.type === 'folder' || Array.isArray(item.children)) {
            count += countQuickAddBookmarks(item.children || []);
            return;
        }
        if (item.url) count += 1;
    });
    return count;
}

function findFirstQuickAddBookmark(items) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) {
        if (!item) continue;
        if (item.type === 'folder' || Array.isArray(item.children)) {
            const found = findFirstQuickAddBookmark(item.children || []);
            if (found) return found;
            continue;
        }
        if (item.url) return item;
    }
    return null;
}

function buildSectionTitle(tabs, scope) {
    const bookmarkCount = countQuickAddBookmarks(tabs);
    if (bookmarkCount <= 1) {
        const firstItem = findFirstQuickAddBookmark(tabs);
        if (firstItem) return firstItem.title || firstItem.url;
    }
    const dt = formatDateTimeShort();
    if (currentLang === 'en') {
        return scope === 'window' ? `Window Tabs ${dt}` : `Pages ${dt}`;
    }
    return scope === 'window' ? `窗口标签 ${dt}` : `页面 ${dt}`;
}

function resolveQuickAddGroupHeading(title, index = 1) {
    const normalized = typeof title === 'string' ? title.trim() : '';
    if (normalized) return normalized;
    return currentLang === 'en' ? `Tab Group ${index}` : `标签组 ${index}`;
}

function buildMarkdownFromTabs(tabs, heading, options = {}) {
    const lines = [];
    const rootItems = Array.isArray(tabs) ? tabs : [];
    const groupAsSecondLevel = !!(options && options.groupAsSecondLevel);

    if (heading) {
        lines.push(`# ${escapeMarkdownText(heading)}`, '');
    }

    const appendItems = (items, depth = 0) => {
        const indent = '  '.repeat(depth);
        (Array.isArray(items) ? items : []).forEach((item) => {
            if (!item) return;

            if (isQuickAddFolderItem(item)) {
                const folderTitle = resolveQuickAddFolderTitle(item.title) || (currentLang === 'en' ? 'Folder' : '文件夹');
                lines.push(`${indent}- **${escapeMarkdownText(folderTitle)}**`);
                appendItems(item.children || [], depth + 1);
                return;
            }

            const title = escapeMarkdownText(item.title || item.url);
            const url = item.url;
            if (!url) return;
            lines.push(`${indent}- [${title}](${url})`);
        });
    };

    if (groupAsSecondLevel) {
        const hasGroupedItem = rootItems.some((item) => isQuickAddFolderItem(item));
        if (hasGroupedItem) {
            let groupIndex = 0;
            const pendingUngrouped = [];

            const flushUngrouped = () => {
                if (!pendingUngrouped.length) return;
                appendItems(pendingUngrouped, 0);
                pendingUngrouped.length = 0;
            };

            rootItems.forEach((item) => {
                if (!item) return;

                if (isQuickAddFolderItem(item)) {
                    flushUngrouped();
                    groupIndex += 1;
                    const groupTitle = resolveQuickAddGroupHeading(item.title, groupIndex);
                    lines.push(`## ${escapeMarkdownText(groupTitle)}`);
                    appendItems(Array.isArray(item.children) ? item.children : [], 0);
                    lines.push('');
                    return;
                }

                pendingUngrouped.push(item);
            });

            flushUngrouped();

            while (lines.length && lines[lines.length - 1] === '') {
                lines.pop();
            }
            return lines.join('\n');
        }
    }

    appendItems(rootItems, 0);
    return lines.join('\n');
}

function escapeMarkdownText(text) {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_');
}

function buildHtmlFromTabs(tabs, heading, options = {}) {
    const rootItems = Array.isArray(tabs) ? tabs : [];
    const groupAsSecondLevel = !!(options && options.groupAsSecondLevel);
    const titleHtml = heading ? `<h1>${escapeHtml(heading)}</h1>` : '';

    const buildList = (items) => {
        return (Array.isArray(items) ? items : []).map((item) => {
            if (!item) return '';

            if (isQuickAddFolderItem(item)) {
                const folderTitle = resolveQuickAddFolderTitle(item.title);
                const folderLabel = folderTitle ? `📁 ${escapeHtml(folderTitle)}` : '📁';
                const childrenHtml = buildList(item.children || []);
                return `<li><strong>${folderLabel}</strong>${childrenHtml ? `<ul>${childrenHtml}</ul>` : ''}</li>`;
            }

            const safeTitle = escapeHtml(item.title || item.url);
            const safeUrl = escapeHtml(item.url);
            if (!safeUrl) return '';
            return `<li><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></li>`;
        }).join('');
    };

    if (groupAsSecondLevel) {
        const hasGroupedItem = rootItems.some((item) => isQuickAddFolderItem(item));
        if (hasGroupedItem) {
            const chunks = [];
            let groupIndex = 0;
            const pendingUngrouped = [];

            const flushUngrouped = () => {
                if (!pendingUngrouped.length) return;
                const listHtml = buildList(pendingUngrouped);
                if (listHtml) {
                    chunks.push(`<ul>${listHtml}</ul>`);
                }
                pendingUngrouped.length = 0;
            };

            rootItems.forEach((item) => {
                if (!item) return;

                if (isQuickAddFolderItem(item)) {
                    flushUngrouped();
                    groupIndex += 1;
                    const groupTitle = resolveQuickAddGroupHeading(item.title, groupIndex);
                    const childrenHtml = buildList(Array.isArray(item.children) ? item.children : []);
                    chunks.push(`<h2>${escapeHtml(groupTitle)}</h2>${childrenHtml ? `<ul>${childrenHtml}</ul>` : ''}`);
                    return;
                }

                pendingUngrouped.push(item);
            });

            flushUngrouped();
            return `${titleHtml}${chunks.join('')}`;
        }
    }

    const items = buildList(rootItems);
    return `${titleHtml}<ul>${items}</ul>`;
}

function insertQuickAddItemsToTempSection(sectionId, items, parentId = '') {
    if (!window.CanvasModule || !window.CanvasModule.temp) return;

    (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item) return;

        if (item.type === 'folder' || Array.isArray(item.children)) {
            const folderTitle = resolveQuickAddFolderTitle(item.title);
            const createdFolderId = (typeof window.CanvasModule.temp.createFolder === 'function')
                ? window.CanvasModule.temp.createFolder(sectionId, parentId, folderTitle)
                : null;
            const nextParentId = createdFolderId || parentId;
            insertQuickAddItemsToTempSection(sectionId, item.children || [], nextParentId);
            return;
        }

        if (!item.url || typeof window.CanvasModule.temp.createBookmark !== 'function') return;
        window.CanvasModule.temp.createBookmark(sectionId, parentId, item.title, item.url);
    });
}

function stripHtmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || div.innerText || '';
}

async function addTabsToCurrentViewSection(tabs, scope, options = {}) {
    const bookmarkCount = countQuickAddBookmarks(tabs);
    if (!bookmarkCount) {
        const msg = currentLang === 'en' ? 'No valid pages to add' : '没有可添加的页面';
        try { showToast(msg); } catch (_) { }
        return;
    }

    const tempTargetId = getMaximizedTempSectionId();
    if (tempTargetId && window.CanvasModule && window.CanvasModule.temp) {
        const sections = window.CanvasModule && window.CanvasModule.CanvasState && Array.isArray(window.CanvasModule.CanvasState.tempSections)
            ? window.CanvasModule.CanvasState.tempSections
            : [];
        const targetSection = sections.find((section) => section && section.id === tempTargetId);
        if (targetSection) {
            if (window.CanvasModule.temp.insertFromPayload) {
                window.CanvasModule.temp.insertFromPayload(tempTargetId, '', tabs);
            } else {
                insertQuickAddItemsToTempSection(tempTargetId, tabs, '');
            }
            if (window.CanvasModule.temp.ensureRendered) {
                window.CanvasModule.temp.ensureRendered(tempTargetId);
            }
            const msg = currentLang === 'en'
                ? `Added ${bookmarkCount} item${bookmarkCount > 1 ? 's' : ''} to current temp section`
                : `已添加到当前临时栏目：${bookmarkCount} 项`;
            try { showToast(msg); } catch (_) { }
            return;
        }
    }

    const mdTargetId = getMaximizedMdNodeId();
    if (mdTargetId) {
        const useBlankHeading = options && typeof options === 'object' && ('useBlankHeading' in options)
            ? !!options.useBlankHeading
            : true;
        await addTabsToBlankNode(tabs, scope, { useHeading: useBlankHeading });
        return;
    }

    if (getMaximizedPermanentSectionElement()) {
        await addTabsToPermanent(tabs, scope, options);
        return;
    }

    await addTabsToTempSection(tabs, scope);
}

async function addTabsToTempSection(tabs, scope) {
    if (!window.CanvasModule || !window.CanvasModule.createEmptyTempSection || !window.CanvasModule.temp) {
        const msg = currentLang === 'en' ? 'Temp section is unavailable' : '临时栏目不可用';
        try { showToast(msg); } catch (_) { }
        return;
    }

    const bookmarkCount = countQuickAddBookmarks(tabs);
    const isBatchMode = bookmarkCount > 1;
    const specialSource = isBatchMode ? 'batch' : 'quick-add';
    const specialLabel = isBatchMode
        ? (currentLang === 'en' ? 'Batch' : '批量')
        : (currentLang === 'en' ? 'Add' : '添加');

    const isMatchingSpecialSection = (section) => {
        if (!section) return false;
        const source = typeof section.source === 'string' ? section.source.trim().toLowerCase() : '';
        if (source === specialSource) return true;
        const label = typeof section.label === 'string' ? section.label.trim().toLowerCase() : '';
        if (isBatchMode) return label === '批量' || label === 'batch';
        return label === '添加' || label === 'add';
    };

    const targetId = getMaximizedTempSectionId();
    let sectionId = null;
    if (targetId) {
        try {
            const sections = window.CanvasModule && window.CanvasModule.CanvasState && Array.isArray(window.CanvasModule.CanvasState.tempSections)
                ? window.CanvasModule.CanvasState.tempSections
                : [];
            const targetSection = sections.find((section) => section && section.id === targetId);
            if (isMatchingSpecialSection(targetSection)) {
                sectionId = targetId;
            }
        } catch (_) { }
    }

    let isNewSection = false;
    if (!sectionId) {
        const pos = getCanvasCenterPoint();
        const title = buildSectionTitle(tabs, scope);
        sectionId = window.CanvasModule.createEmptyTempSection(pos.x, pos.y, {
            title,
            label: specialLabel,
            source: specialSource,
            initialItems: tabs
        });
        isNewSection = true;
    }

    if (!isNewSection) {
        if (window.CanvasModule.temp.insertFromPayload) {
            window.CanvasModule.temp.insertFromPayload(sectionId, '', tabs);
        } else {
            insertQuickAddItemsToTempSection(sectionId, tabs, '');
        }
    }
    if (window.CanvasModule.temp.ensureRendered) {
        window.CanvasModule.temp.ensureRendered(sectionId);
    }
    const msg = currentLang === 'en'
        ? `Added ${bookmarkCount} item${bookmarkCount > 1 ? 's' : ''} to temp section`
        : `已加入临时栏目：${bookmarkCount} 项`;
    try { showToast(msg); } catch (_) { }
}

async function addTabsToBlankNode(tabs, scope, options = {}) {
    if (!window.CanvasModule || !window.CanvasModule.createMdNode || !window.CanvasModule.CanvasState) {
        const msg = currentLang === 'en' ? 'Blank node is unavailable' : '空白栏目不可用';
        try { showToast(msg); } catch (_) { }
        return;
    }
    const bookmarkCount = countQuickAddBookmarks(tabs);
    const useHeading = !!(options && options.useHeading);
    const heading = useHeading ? buildSectionTitle(tabs, scope) : '';
    const markdown = buildMarkdownFromTabs(tabs, heading, { groupAsSecondLevel: true });
    const html = buildHtmlFromTabs(tabs, heading, { groupAsSecondLevel: true });

    const targetId = getMaximizedMdNodeId();
    if (targetId) {
        const node = window.CanvasModule.CanvasState.mdNodes.find(n => n && n.id === targetId);
        if (node) {
            if (typeof __ensureMdNodeMarkdownProtocol === 'function') {
                const existingMarkdown =
                    typeof __resolveCanvasNativeTextNodeBody === 'function'
                        ? __resolveCanvasNativeTextNodeBody(node)
                        : String(node.text || '');
                const normalizedExisting = String(existingMarkdown || '').replace(/\s+$/, '');
                const normalizedAppend = String(markdown || '').replace(/^\s+/, '').replace(/\s+$/, '');
                const mergedMarkdown = normalizedExisting
                    ? `${normalizedExisting}\n\n---\n\n${normalizedAppend}`
                    : normalizedAppend;
                node.text = mergedMarkdown;
                node.subtype = 'canvas-native-text';
                node.source = 'obsidian-canvas-text';
                __ensureMdNodeMarkdownProtocol(node, { refreshCachesFromMarkdown: true });
            } else {
                if (node.html && node.html.trim()) {
                    const existingText = (typeof node.text === 'string' && node.text.trim())
                        ? node.text
                        : stripHtmlToText(node.html);
                    node.html = `${node.html}${node.html.trim() ? '<hr>' : ''}${html}`;
                    node.text = `${existingText}${existingText ? '\n\n' : ''}${markdown}`;
                } else {
                    const base = (typeof node.text === 'string') ? node.text.trim() : '';
                    node.text = base ? `${base}\n\n${markdown}` : markdown;
                    node.html = '';
                }
            }
            if (typeof renderMdNode === 'function') renderMdNode(node);
            if (typeof saveTempNodes === 'function') saveTempNodes();
            try {
                const msg = currentLang === 'en' ? 'Added to current blank node' : '已添加到当前空白栏目';
                showToast(msg);
            } catch (_) { }
            return;
        }
    }

    const pos = getCanvasCenterPoint();
    await window.CanvasModule.createMdNode(pos.x, pos.y, markdown);
    const msg = currentLang === 'en'
        ? `Created blank node with ${bookmarkCount} item${bookmarkCount > 1 ? 's' : ''}`
        : `已创建空白栏目，包含 ${bookmarkCount} 项`;
    try { showToast(msg); } catch (_) { }
}

function getPermanentMutationBridgeForHistory() {
    const bridge = window && window.CanvasProtocolBridge ? window.CanvasProtocolBridge : null;
    return bridge && typeof bridge.restorePermanentMainContentSnapshot === 'function' ? bridge : null;
}

async function rollbackPermanentBcsMutationForHistory(prepared, reason = '') {
    const bridge = getPermanentMutationBridgeForHistory();
    if (!bridge || !prepared || !prepared.previousContent) return;
    try {
        await bridge.restorePermanentMainContentSnapshot(prepared.previousContent, {
            assumeClean: false,
            reason
        });
    } catch (rollbackError) {
        console.warn('[Permanent JSON] rollback failed:', rollbackError);
        try {
            if (typeof bridge.syncPermanentMainTreeFromChromeBookmarks === 'function') {
                await bridge.syncPermanentMainTreeFromChromeBookmarks({
                    assumeClean: false,
                    reason: reason || 'rollback-fallback'
                });
            }
        } catch (_) { }
    }
}

async function bookmarksCreate(info, options = {}) {
    const bridge = getPermanentMutationBridgeForHistory();
    let prepared = null;
    const skipBcs = options.skipBcs === true || (typeof isBookmarkBulkMuteRenderingBlocked === 'function' && isBookmarkBulkMuteRenderingBlocked());
    if (!skipBcs && bridge && typeof bridge.preparePermanentCreateNodeInBcs === 'function') {
        prepared = await bridge.preparePermanentCreateNodeInBcs(info, {});
    }
    try {
        const created = await new Promise((resolve, reject) => {
            if (!browserAPI || !browserAPI.bookmarks || typeof browserAPI.bookmarks.create !== 'function') {
                reject(new Error('bookmarks API not available'));
                return;
            }
            browserAPI.bookmarks.create(info, (node) => {
                const err = browserAPI.runtime && browserAPI.runtime.lastError;
                if (err) {
                    reject(new Error(err.message || 'bookmarks.create failed'));
                    return;
                }
                resolve(node);
            });
        });
        if (options.createdEvents && Array.isArray(options.createdEvents)) {
            options.createdEvents.push({
                type: 'created',
                id: created.id,
                parentId: created.parentId,
                bookmark: created
            });
        }
        try {
            if (!skipBcs && prepared && bridge && typeof bridge.commitPermanentCreatedNodeInBcs === 'function') {
                await bridge.commitPermanentCreatedNodeInBcs(prepared.pendingId, created);
            }
        } catch (commitError) {
            console.warn('[Permanent JSON] create commit failed, resyncing from Chrome:', commitError);
            try {
                if (bridge && typeof bridge.syncPermanentMainTreeFromChromeBookmarks === 'function') {
                    await bridge.syncPermanentMainTreeFromChromeBookmarks({
                        assumeClean: false,
                        reason: 'create-commit-fallback'
                    });
                }
            } catch (_) { }
        }
        return created;
    } catch (error) {
        if (!skipBcs) {
            await rollbackPermanentBcsMutationForHistory(prepared, 'create-failed');
        }
        throw error;
    }
}

async function getBookmarksBarId() {
    if (!browserAPI || !browserAPI.bookmarks || typeof browserAPI.bookmarks.getTree !== 'function') return null;
    const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
    const root = Array.isArray(tree) ? tree[0] : null;
    if (!root || !Array.isArray(root.children)) return null;
    const bar = root.children.find(child => child && (child.id === '1' || /书签栏|Bookmarks Bar/i.test(child.title)));
    return bar ? bar.id : null;
}

function isQuickAddFolderItem(item) {
    return !!(item && (item.type === 'folder' || Array.isArray(item.children)));
}

function isQuickAddSingleBookmarkItem(items) {
    if (!Array.isArray(items) || items.length !== 1) return false;
    const item = items[0];
    return !!(item && !isQuickAddFolderItem(item) && item.url);
}

async function insertQuickAddItemsToPermanent(parentId, items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) {
        if (!item) continue;

        if (isQuickAddFolderItem(item)) {
            const folderTitle = resolveQuickAddFolderTitle(item.title);
            const folder = await bookmarksCreate({ parentId, title: folderTitle }, options);
            await insertQuickAddItemsToPermanent(folder.id, item.children || [], options);
            continue;
        }

        if (!item.url) continue;
        const bookmarkTitle = (typeof item.title === 'string') ? item.title : String(item.url);
        await bookmarksCreate({ parentId, title: bookmarkTitle, url: item.url }, options);
    }
}

async function addTabsToPermanent(tabs, scope, options = {}) {
    const barId = await getBookmarksBarId();
    if (!barId) {
        const msg = currentLang === 'en' ? 'Bookmarks bar not found' : '找不到书签栏';
        try { showToast(msg); } catch (_) { }
        return;
    }

    const items = Array.isArray(tabs) ? tabs : [];
    const bookmarkCount = countQuickAddBookmarks(items);
    if (!bookmarkCount) {
        const msg = currentLang === 'en' ? 'No valid pages to add' : '没有可添加的页面';
        try { showToast(msg); } catch (_) { }
        return;
    }

    const skipAutoSectionFolder = !!(options && options.skipAutoSectionFolder);

    const useBulkMute = bookmarkCount > 15;
    let muteSession = null;
    let loadingToast = null;
    if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
        muteSession = await beginBookmarkBulkMute('add-tabs-to-permanent');
    }
    if (useBulkMute && typeof window.showLoadingToast === 'function') {
        const msg = currentLang === 'en' ? `Adding ${bookmarkCount} pages...` : `正在添加 ${bookmarkCount} 个页面...`;
        loadingToast = window.showLoadingToast(msg);
    }
    
    const createdEvents = [];
    const createOptions = { createdEvents };
    try {
        if (skipAutoSectionFolder) {
            await insertQuickAddItemsToPermanent(barId, items, createOptions);
        } else if (bookmarkCount === 1 && isQuickAddSingleBookmarkItem(items)) {
            const singleItem = items[0];
            await bookmarksCreate({ parentId: barId, title: singleItem.title || singleItem.url, url: singleItem.url }, createOptions);
        } else {
            const folderTitle = scope === 'window' ? formatQuickAddWindowFolderTitle() : formatQuickAddCurrentFolderTitle();
            const folder = await bookmarksCreate({ parentId: barId, title: folderTitle }, createOptions);
            await insertQuickAddItemsToPermanent(folder.id, items, createOptions);
        }

        if (useBulkMute && createdEvents.length > 0) {
            await flushPermanentBookmarkEventsAfterBulk(createdEvents, 'add-tabs-to-permanent');
        }
    } finally {
        if (loadingToast) {
            loadingToast.close();
        }
        if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
            await endBookmarkBulkMute('add-tabs-to-permanent', { refreshTree: true });
        }
    }

    const msg = (scope === 'window')
        ? (currentLang === 'en' ? `Added current window tabs (${bookmarkCount})` : `已添加当前窗口所有标签页 (${bookmarkCount} 项)`)
        : (currentLang === 'en' ? `Added ${bookmarkCount} tab(s)` : `已添加 ${bookmarkCount} 个标签页`);
    try { showToast(msg); } catch (_) { }
}

function initializeUI() {
    if (window.CanvasSidebarDirectory && typeof window.CanvasSidebarDirectory.init === 'function') {
        try { window.CanvasSidebarDirectory.init(); } catch (_) { }
    }

    // 导航标签切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // 工具按钮
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    const langToggle = document.getElementById('langToggle');
    if (langToggle) langToggle.addEventListener('click', toggleLanguage);

    const helpToggle = document.getElementById('helpToggle');
    const shortcutsModal = document.getElementById('shortcutsModal');
    const closeShortcutsModal = document.getElementById('closeShortcutsModal');
    if (helpToggle && shortcutsModal) {
        helpToggle.addEventListener('click', () => {
            if (typeof updateShortcutsDisplay === 'function') {
                updateShortcutsDisplay();
            }
            shortcutsModal.classList.add('show');
        });
    }
    if (closeShortcutsModal && shortcutsModal) {
        closeShortcutsModal.addEventListener('click', () => {
            shortcutsModal.classList.remove('show');
        });
    }
    if (shortcutsModal) {
        shortcutsModal.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) {
                shortcutsModal.classList.remove('show');
            }
        });
    }

    setupSidePanelSettingsMenu();
    setupCanvasFloatingToolsMenu();
    setupCanvasFloatingMiniToggle();
    bindLastFullscreenButtonsVisibilitySync();
    refreshLastFullscreenButtonsVisibility();
    setupQuickAddMenu();
    setupOpenCanvasPageButton();
    setupSideLastFullscreenButton();
    setupTitleSidePanelToggleButton();
    setupTitleSideTools();

    // 搜索
    const searchInputEl = document.getElementById('searchInput');
    if (searchInputEl && !searchInputEl.hasAttribute('data-search-bound')) {
        searchInputEl.addEventListener('input', handleSearch);
        searchInputEl.addEventListener('keydown', handleSearchKeydown);
        searchInputEl.addEventListener('focus', handleSearchInputFocus);
        searchInputEl.setAttribute('data-search-bound', 'true');
    }

    const searchResultsPanel = document.getElementById('searchResultsPanel');
    if (searchResultsPanel && !searchResultsPanel.hasAttribute('data-search-bound')) {
        searchResultsPanel.addEventListener('click', handleSearchResultsPanelClick);
        searchResultsPanel.addEventListener('mouseover', handleSearchResultsPanelMouseOver);
        searchResultsPanel.setAttribute('data-search-bound', 'true');
    }

    if (!document.documentElement.hasAttribute('data-search-outside-bound')) {
        document.addEventListener('click', handleSearchOutsideClick, true);
        document.documentElement.setAttribute('data-search-outside-bound', 'true');
    }

    ;
}

// =============================================================================
// 数据加载
// =============================================================================

async function loadAllData(options = {}) {
    const { skipRender = false } = options;
    ;

    try {
        await ensureBookmarkCacheLoaded(skipRender);

        const bookmarkTree = await loadBookmarkTree();
        allBookmarks = flattenBookmarkTree(bookmarkTree);
        rebuildBookmarkUrlSet();
        bookmarkCacheRestored = true;
        await persistBookmarkCache();
        cachedBookmarkTree = bookmarkTree;

        ;
    } catch (error) {
        console.error('[loadAllData] 加载数据失败:', error);
        showError('加载数据失败');
    }
}

// 预加载常见网站的图标
async function preloadCommonIcons() {
    ;

    try {
        // 获取当前所有书签的 URL，过滤掉无效的
        const urls = allBookmarks
            .map(b => b.url)
            .filter(url => url && url.trim() && (url.startsWith('http://') || url.startsWith('https://')));

        if (urls.length === 0) {
            ;
            return;
        }

        // 批量预加载（限制并发数）
        const batchSize = 10;
        const maxPreload = Math.min(urls.length, 50);

        for (let i = 0; i < maxPreload; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            await Promise.all(batch.map(url => preloadIcon(url)));
        }

        ;
    } catch (error) {
        console.error('[图标预加载] 失败:', error);
    }
}

// 预加载单个图标（使用新的缓存系统）
async function preloadIcon(url) {
    try {
        // 基本验证
        if (!url || FaviconCache.isInvalidUrl(url)) {
            return;
        }

        // 使用缓存系统获取favicon（会自动缓存）
        await FaviconCache.fetch(url);
    } catch (error) {
        console.warn('[图标预加载] URL 预加载失败:', url, error.message);
    }
}

// 【关键修复】预热 favicon 内存缓存（从 IndexedDB 批量加载）
// 用于解决切换视图时图标变成五角星的问题
async function warmupFaviconCache(bookmarkUrls) {
    if (!bookmarkUrls || bookmarkUrls.length === 0) return;

    try {
        ;

        // 初始化 IndexedDB（如果还没初始化）
        if (!FaviconCache.db) {
            await FaviconCache.init();
        }

        // 批量从 IndexedDB 读取所有域名的 favicon
        const domains = new Set();
        bookmarkUrls.forEach(url => {
            try {
                if (!FaviconCache.isInvalidUrl(url)) {
                    const domain = FaviconCache._getHostnameKey(url);
                    if (!domain) return;
                    domains.add(domain);
                }
            } catch (e) {
                // 忽略无效URL
            }
        });

        if (domains.size === 0) return;

        ;

        // 批量读取
        const transaction = FaviconCache.db.transaction([FaviconCache.storeName], 'readonly');
        const store = transaction.objectStore(FaviconCache.storeName);

        let loaded = 0;
        for (const domain of domains) {
            // 跳过已在内存缓存中的
            if (FaviconCache.memoryCache.has(domain)) continue;

            try {
                const request = store.get(domain);
                await new Promise((resolve) => {
                    request.onsuccess = () => {
                        if (request.result && request.result.dataUrl) {
                            FaviconCache.memoryCache.set(domain, request.result.dataUrl);
                            loaded++;
                        }
                        resolve();
                    };
                    request.onerror = () => resolve();
                });
            } catch (e) {
                // 忽略单个域名的错误
            }
        }

        ;
    } catch (error) {
        console.warn('[Favicon预热] 失败:', error);
    }
}

function loadBookmarkTree() {
    return new Promise((resolve) => {
        browserAPI.bookmarks.getTree((tree) => {
            resolve(tree[0]);
        });
    });
}

function flattenBookmarkTree(node, parentPath = '') {
    const bookmarks = [];
    const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;

    if (node.url) {
        bookmarks.push({
            id: node.id,
            title: node.title,
            url: node.url,
            dateAdded: node.dateAdded,
            path: currentPath,
            parentId: node.parentId
        });
    }

    if (node.children) {
        node.children.forEach(child => {
            bookmarks.push(...flattenBookmarkTree(child, currentPath));
        });
    }

    return bookmarks;
}

// =============================================================================



function buildChangeSummary(diffMeta, stats, lang) {
    const effectiveLang = lang === 'en' ? 'en' : 'zh_CN';
    const summary = {
        hasQuantityChange: false,
        quantityTotalLine: '',
        quantityDiffLine: '',
        hasStructuralChange: false,
        structuralLine: '',
        structuralItems: []
    };

    if (!diffMeta) {
        diffMeta = {
            bookmarkDiff: 0,
            folderDiff: 0,
            hasNumericalChange: false,
            currentBookmarkCount: 0,
            currentFolderCount: 0
        };
    }

    const bookmarkDiff = diffMeta.bookmarkDiff || 0;
    const folderDiff = diffMeta.folderDiff || 0;
    const hasNumericalChange = diffMeta.hasNumericalChange === true;
    const currentBookmarks = diffMeta.currentBookmarkCount ?? 0;
    const currentFolders = diffMeta.currentFolderCount ?? 0;

    // 新口径：若 background 提供了新增/删除分开计数，则优先用它（支持“加减相同数量但内容不同”）
    const bookmarkAdded = typeof stats?.bookmarkAdded === 'number' ? stats.bookmarkAdded : null;
    const bookmarkDeleted = typeof stats?.bookmarkDeleted === 'number' ? stats.bookmarkDeleted : null;
    const folderAdded = typeof stats?.folderAdded === 'number' ? stats.folderAdded : null;
    const folderDeleted = typeof stats?.folderDeleted === 'number' ? stats.folderDeleted : null;
    const hasDetailedQuantity = (bookmarkAdded !== null) || (bookmarkDeleted !== null) || (folderAdded !== null) || (folderDeleted !== null);
    const hasQuantityChange = hasDetailedQuantity
        ? ((bookmarkAdded || 0) > 0 || (bookmarkDeleted || 0) > 0 || (folderAdded || 0) > 0 || (folderDeleted || 0) > 0)
        : hasNumericalChange;

    const i18nBookmarksLabel = window.i18nLabels?.bookmarksLabel || (effectiveLang === 'en' ? 'bookmarks' : '个书签');
    const i18nFoldersLabel = window.i18nLabels?.foldersLabel || (effectiveLang === 'en' ? 'folders' : '个文件夹');
    const totalBookmarkTerm = effectiveLang === 'en' ? 'BKM' : i18nBookmarksLabel;
    const totalFolderTerm = effectiveLang === 'en' ? 'FLD' : i18nFoldersLabel;

    summary.quantityTotalLine = effectiveLang === 'en'
        ? `${currentBookmarks} ${totalBookmarkTerm}, ${currentFolders} ${totalFolderTerm}`
        : `${currentBookmarks}${totalBookmarkTerm}，${currentFolders}${totalFolderTerm}`;

    if (hasQuantityChange) {
        summary.hasQuantityChange = true;
        const parts = [];

        if (hasDetailedQuantity) {
            const joinDelta = (deltaParts) => {
                const sep = '<span style="display:inline-block;width:3px;"></span>/<span style="display:inline-block;width:3px;"></span>';
                return deltaParts.join(sep);
            };

            const buildDual = (added, deleted, label) => {
                const deltaParts = [];
                if (added > 0) deltaParts.push(`<span style="color:var(--positive-color, #4CAF50);font-weight:bold;">+${added}</span>`);
                if (deleted > 0) deltaParts.push(`<span style="color:var(--negative-color, #F44336);font-weight:bold;">-${deleted}</span>`);
                if (deltaParts.length === 0) return '';
                const numbersHTML = joinDelta(deltaParts);
                return effectiveLang === 'en' ? `${numbersHTML} ${label}` : `${numbersHTML}${label}`;
            };

            const bookmarkLabel = effectiveLang === 'en' ? 'BKM' : '书签';
            const folderLabel = effectiveLang === 'en' ? 'FLD' : '文件夹';

            const bPart = buildDual(bookmarkAdded || 0, bookmarkDeleted || 0, bookmarkLabel);
            const fPart = buildDual(folderAdded || 0, folderDeleted || 0, folderLabel);

            if (bPart) parts.push(bPart);
            if (fPart) parts.push(fPart);
        } else {
            if (bookmarkDiff !== 0) {
                const sign = bookmarkDiff > 0 ? '+' : '';
                const color = bookmarkDiff > 0 ? 'var(--positive-color, #4CAF50)' : 'var(--negative-color, #F44336)';
                const label = effectiveLang === 'en' ? 'BKM' : '书签';
                parts.push(`<span style="color:${color};font-weight:bold;">${sign}${bookmarkDiff}</span>${effectiveLang === 'en' ? ` ${label}` : label}`);
            }

            if (folderDiff !== 0) {
                const sign = folderDiff > 0 ? '+' : '';
                const color = folderDiff > 0 ? 'var(--positive-color, #4CAF50)' : 'var(--negative-color, #F44336)';
                const label = effectiveLang === 'en' ? 'FLD' : '文件夹';
                parts.push(`<span style="color:${color};font-weight:bold;">${sign}${folderDiff}</span>${effectiveLang === 'en' ? ` ${label}` : label}`);
            }
        }

        summary.quantityDiffLine = parts.join(effectiveLang === 'en' ? ` <span style="color:var(--text-tertiary);">|</span> ` : '、');
    }

    const bookmarkMoved = Boolean(stats?.bookmarkMoved);
    const folderMoved = Boolean(stats?.folderMoved);
    const bookmarkModified = Boolean(stats?.bookmarkModified);
    const folderModified = Boolean(stats?.folderModified);

    const hasBookmarkStructural = bookmarkMoved || bookmarkModified;
    const hasFolderStructural = folderMoved || folderModified;

    if (hasBookmarkStructural || hasFolderStructural) {
        summary.hasStructuralChange = true;

        // 构建具体的结构变化列表
        const structuralParts = [];
        const movedCount = typeof stats?.movedCount === 'number'
            ? stats.movedCount
            : (typeof stats?.movedBookmarkCount === 'number' ? stats.movedBookmarkCount : 0) + (typeof stats?.movedFolderCount === 'number' ? stats.movedFolderCount : 0);
        const modifiedCount = typeof stats?.modifiedCount === 'number'
            ? stats.modifiedCount
            : (typeof stats?.modifiedBookmarkCount === 'number' ? stats.modifiedBookmarkCount : 0) + (typeof stats?.modifiedFolderCount === 'number' ? stats.modifiedFolderCount : 0);

        if (bookmarkMoved || folderMoved) {
            const movedLabel = effectiveLang === 'en' ? (movedCount > 0 ? `${movedCount} moved` : 'Moved') : (movedCount > 0 ? `${movedCount}个移动` : '移动');
            structuralParts.push(movedLabel);
            summary.structuralItems.push(movedLabel);
        }
        if (bookmarkModified || folderModified) {
            const modifiedLabel = effectiveLang === 'en' ? (modifiedCount > 0 ? `${modifiedCount} modified` : 'Modified') : (modifiedCount > 0 ? `${modifiedCount}个修改` : '修改');
            structuralParts.push(modifiedLabel);
            summary.structuralItems.push(modifiedLabel);
        }


        // 用具体的变化类型替代通用的"变动"标签
        const separator = effectiveLang === 'en' ? ' <span style="color:var(--text-tertiary);">|</span> ' : '、';
        const structuralText = structuralParts.join(separator);
        summary.structuralLine = `<span style="color:var(--accent-secondary, #FF9800);font-weight:bold;">${structuralText}</span>`;
    }

    return summary;
}

// =============================================================================
// 侧边栏收起功能
// =============================================================================

function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    const resizeHandle = document.getElementById('sidebarResizeHandle');

    if (!sidebar || !toggleBtn || !resizeHandle) {
        console.warn('[侧边栏] 找不到侧边栏或切换按钮');
        return;
    }

    const SIDEBAR_STORAGE_KEYS = isSidePanelMode
        ? {
            state: 'sidepanelSidebarCollapseState',
            manual: 'sidepanelSidebarManualOverride',
            legacyCollapsed: 'sidepanelSidebarCollapsed',
            position: 'sidepanelSidebarDockSide',
            widthLeft: 'sidepanelSidebarExpandedWidthLeft',
            widthRight: 'sidepanelSidebarExpandedWidthRight',
            toggleRatio: 'sidepanelSidebarToggleTopRatio',
            toggleMoved: 'sidepanelSidebarToggleTopMoved'
        }
        : {
            state: 'sidebarCollapseState',
            manual: 'sidebarManualOverride',
            legacyCollapsed: 'sidebarCollapsed',
            position: 'sidebarDockSide',
            widthLeft: 'sidebarExpandedWidthLeft',
            widthRight: 'sidebarExpandedWidthRight',
            toggleRatio: 'sidebarToggleTopRatio',
            toggleMoved: 'sidebarToggleTopMoved'
        };
    const SIDEBAR_STATE_KEY = SIDEBAR_STORAGE_KEYS.state;
    const SIDEBAR_MANUAL_KEY = SIDEBAR_STORAGE_KEYS.manual;
    const LEGACY_COLLAPSED_KEY = SIDEBAR_STORAGE_KEYS.legacyCollapsed;
    const SIDEBAR_POSITION_KEY = SIDEBAR_STORAGE_KEYS.position;
    const SIDEBAR_WIDTH_LEFT_KEY = SIDEBAR_STORAGE_KEYS.widthLeft;
    const SIDEBAR_WIDTH_RIGHT_KEY = SIDEBAR_STORAGE_KEYS.widthRight;
    const SIDEBAR_TOGGLE_TOP_RATIO_KEY = SIDEBAR_STORAGE_KEYS.toggleRatio;
    const SIDEBAR_TOGGLE_TOP_MOVED_KEY = SIDEBAR_STORAGE_KEYS.toggleMoved;
    const SIDEBAR_STATES = ['expanded', 'compact'];
    const SIDEBAR_POSITIONS = ['left', 'right'];
    const AUTO_COLLAPSE_WIDTH_DEFAULT = 600;
    const AUTO_COLLAPSE_WIDTH_MIN = 320;
    const AUTO_COLLAPSE_WIDTH_MAX = 2000;
    const SIDEBAR_COLLAPSE_MODE_AUTO = 'auto';
    const SIDEBAR_COLLAPSE_MODE_MANUAL = 'manual';
    const AUTO_RESIZE_DEBOUNCE_MS = 220;
    const SIDEBAR_TRANSITION_MS = 220;
    const SIDEBAR_MIN_WIDTH = 180;
    const SIDEBAR_MAX_WIDTH = 560;
    const SIDEBAR_RESIZE_COMPACT_THRESHOLD = 56;
    const TOGGLE_DRAG_ACTIVATE_THRESHOLD = 10;
    const TOGGLE_HINT_HOLD_DELAY_MS = 160;
    const TOGGLE_DRAG_DIRECTION_THRESHOLD = 8;
    const TOGGLE_DRAG_SWITCH_THRESHOLD = 42;
    const TOGGLE_VERTICAL_MARGIN_PX = 28;
    const TOGGLE_DEFAULT_RATIO = 0.6;
    const TOGGLE_RATIO_MIN = 0.08;
    const TOGGLE_RATIO_MAX = 0.92;
    const SIDEBAR_SIDE_SWITCH_ANIMATION_MS = 220;
    const persistEnabled = true;
    const sidebarContainer = sidebar.closest('.main-container');
    const contentArea = sidebarContainer
        ? sidebarContainer.querySelector('.content-area')
        : document.querySelector('.content-area');

    let refreshRaf = null;
    let suppressToggleClick = false;
    let toggleDragSession = null;
    let resizeDragSession = null;
    let sideSwitchAnimationCleanup = null;
    let toggleHintUp = null;
    let toggleHintDown = null;
    let toggleHintOutward = null;
    let toggleHintHoldTimer = null;
    let toggleHoldVisualActive = false;
    let toggleDragGuideDirection = null;
    let autoResizeDebounceTimer = null;
    let sidebarCollapseMode = SIDEBAR_COLLAPSE_MODE_AUTO;
    let autoCollapseWidth = AUTO_COLLAPSE_WIDTH_DEFAULT;
    let hasManualOverride = false;
    let headerStateChangeAnchorY = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getCanvasOtherSettingsSafe() {
        try {
            if (window.CanvasModule && typeof window.CanvasModule.getCanvasOtherSettings === 'function') {
                return window.CanvasModule.getCanvasOtherSettings();
            }
        } catch (_) { }
        return null;
    }

    function normalizeCollapseMode(raw) {
        const value = String(raw || '').toLowerCase();
        if (value === SIDEBAR_COLLAPSE_MODE_MANUAL) return SIDEBAR_COLLAPSE_MODE_MANUAL;
        return SIDEBAR_COLLAPSE_MODE_AUTO;
    }

    function normalizeAutoCollapseWidth(raw) {
        const value = Number(raw);
        if (!Number.isFinite(value)) return AUTO_COLLAPSE_WIDTH_DEFAULT;
        return clamp(Math.round(value), AUTO_COLLAPSE_WIDTH_MIN, AUTO_COLLAPSE_WIDTH_MAX);
    }

    function getDirectoryCollapsePrefsFromSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            return {
                mode: SIDEBAR_COLLAPSE_MODE_AUTO,
                width: AUTO_COLLAPSE_WIDTH_DEFAULT
            };
        }

        const modeKey = isSidePanelMode ? 'sidepanelDirectoryCollapseMode' : 'directoryCollapseMode';
        const widthKey = isSidePanelMode ? 'sidepanelDirectoryAutoCollapseWidth' : 'directoryAutoCollapseWidth';
        const modeRaw = settings[modeKey] != null
            ? settings[modeKey]
            : settings.directoryCollapseMode;
        const widthRaw = settings[widthKey] != null
            ? settings[widthKey]
            : settings.directoryAutoCollapseWidth;

        return {
            mode: normalizeCollapseMode(modeRaw),
            width: normalizeAutoCollapseWidth(widthRaw)
        };
    }

    function readSidebarCollapsePrefs() {
        try {
            const raw = localStorage.getItem('canvas-other-settings-v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    return getDirectoryCollapsePrefsFromSettings(parsed);
                }
            }
        } catch (_) { }

        const settings = getCanvasOtherSettingsSafe();
        if (settings && typeof settings === 'object') {
            return getDirectoryCollapsePrefsFromSettings(settings);
        }

        return getDirectoryCollapsePrefsFromSettings(null);
    }

    function persistSidebarCollapsePrefs(nextPrefs, options = {}) {
        const safePrefs = nextPrefs && typeof nextPrefs === 'object' ? nextPrefs : {};
        const mode = normalizeCollapseMode(safePrefs.mode);
        const width = normalizeAutoCollapseWidth(safePrefs.width);
        const dispatchEvent = !(options && options.dispatch === false);

        try {
            if (window.CanvasModule && typeof window.CanvasModule.setCanvasDirectoryCollapsePrefs === 'function') {
                window.CanvasModule.setCanvasDirectoryCollapsePrefs(
                    { mode, width },
                    {
                        forSidePanel: isSidePanelMode,
                        dispatch: dispatchEvent
                    }
                );
                return { mode, width };
            }
        } catch (_) { }

        try {
            const raw = localStorage.getItem('canvas-other-settings-v1');
            const parsed = raw ? JSON.parse(raw) : {};
            const nextSettings = (parsed && typeof parsed === 'object') ? parsed : {};

            if (isSidePanelMode) {
                nextSettings.sidepanelDirectoryCollapseMode = mode;
                nextSettings.sidepanelDirectoryAutoCollapseWidth = width;
            } else {
                nextSettings.directoryCollapseMode = mode;
                nextSettings.directoryAutoCollapseWidth = width;
            }

            __saveLocalStorageJSON('canvas-other-settings-v1', nextSettings);
            if (dispatchEvent) {
                window.dispatchEvent(new CustomEvent('canvas-other-settings-updated', {
                    detail: nextSettings
                }));
            }
        } catch (_) { }

        return { mode, width };
    }

    function readStorage(key) {
        try {
            return localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            __saveLocalStorageRaw(key, value);
        } catch (_) { }
    }

    function normalizeSidebarPosition(raw) {
        const value = String(raw || '').toLowerCase();
        return SIDEBAR_POSITIONS.includes(value) ? value : null;
    }

    function normalizeSidebarWidth(raw) {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        return clamp(Math.round(value), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
    }

    function normalizeToggleRatio(raw) {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        return clamp(value, TOGGLE_RATIO_MIN, TOGGLE_RATIO_MAX);
    }

    const initialRect = sidebar.getBoundingClientRect();
    const defaultExpandedWidth = normalizeSidebarWidth(initialRect && initialRect.width)
        || normalizeSidebarWidth(getComputedStyle(sidebar).width)
        || 260;

    let expandedWidthBySide = {
        left: normalizeSidebarWidth(readStorage(SIDEBAR_WIDTH_LEFT_KEY)) || defaultExpandedWidth,
        right: normalizeSidebarWidth(readStorage(SIDEBAR_WIDTH_RIGHT_KEY)) || defaultExpandedWidth
    };
    let sidebarPosition = normalizeSidebarPosition(readStorage(SIDEBAR_POSITION_KEY)) || 'left';
    const storedToggleTopRatio = normalizeToggleRatio(readStorage(SIDEBAR_TOGGLE_TOP_RATIO_KEY));
    const hasStoredToggleTopRatio = storedToggleTopRatio != null;
    const hasToggleTopMoved = readStorage(SIDEBAR_TOGGLE_TOP_MOVED_KEY) === 'true';
    let toggleTopRatio = hasStoredToggleTopRatio ? storedToggleTopRatio : TOGGLE_DEFAULT_RATIO;

    if (!hasToggleTopMoved) {
        toggleTopRatio = TOGGLE_DEFAULT_RATIO;
        writeStorage(SIDEBAR_TOGGLE_TOP_RATIO_KEY, String(toggleTopRatio));
    }

    function getExpandedWidth(position) {
        const safePosition = normalizeSidebarPosition(position) || 'left';
        const width = expandedWidthBySide[safePosition];
        return normalizeSidebarWidth(width) || defaultExpandedWidth;
    }

    function setExpandedWidth(position, width, options = {}) {
        const safePosition = normalizeSidebarPosition(position) || 'left';
        const safeWidth = normalizeSidebarWidth(width) || defaultExpandedWidth;
        expandedWidthBySide[safePosition] = safeWidth;
        if (options && options.persist !== false) {
            const key = safePosition === 'right' ? SIDEBAR_WIDTH_RIGHT_KEY : SIDEBAR_WIDTH_LEFT_KEY;
            writeStorage(key, String(safeWidth));
        }
        if (options && options.apply === true && safePosition === sidebarPosition && currentState === 'expanded') {
            sidebar.style.width = `${safeWidth}px`;
        }
        return safeWidth;
    }

    function setToggleTopRatio(ratio, options = {}) {
        toggleTopRatio = clamp(ratio, TOGGLE_RATIO_MIN, TOGGLE_RATIO_MAX);
        const pct = `${(toggleTopRatio * 100).toFixed(2)}%`;
        toggleBtn.style.top = pct;
        if (options && options.persist !== false) {
            writeStorage(SIDEBAR_TOGGLE_TOP_RATIO_KEY, String(toggleTopRatio));
        }
        return toggleTopRatio;
    }

    function getToggleRatioFromClientY(clientY) {
        const rect = sidebar.getBoundingClientRect();
        if (!rect || !rect.height) return toggleTopRatio;
        const minTop = TOGGLE_VERTICAL_MARGIN_PX;
        const maxTop = Math.max(minTop, rect.height - TOGGLE_VERTICAL_MARGIN_PX);
        const localY = clamp(clientY - rect.top, minTop, maxTop);
        return localY / rect.height;
    }

    function getToggleViewportCenterY() {
        const rect = toggleBtn.getBoundingClientRect();
        if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.height)) return null;
        return rect.top + (rect.height / 2);
    }

    function preserveToggleViewportCenterY(anchorY, options = {}) {
        if (!Number.isFinite(anchorY)) return;
        const rect = sidebar.getBoundingClientRect();
        if (!rect || !rect.height) return;
        const minTop = TOGGLE_VERTICAL_MARGIN_PX;
        const maxTop = Math.max(minTop, rect.height - TOGGLE_VERTICAL_MARGIN_PX);
        const localY = clamp(anchorY - rect.top, minTop, maxTop);
        const nextRatio = localY / rect.height;
        setToggleTopRatio(nextRatio, { persist: options && options.persist !== false });
    }

    function ensureToggleDragHints() {
        if (!toggleHintUp || !toggleHintUp.isConnected) {
            toggleHintUp = toggleBtn.querySelector('.sidebar-toggle-hint-up');
            if (!toggleHintUp) {
                toggleHintUp = document.createElement('span');
                toggleHintUp.className = 'sidebar-toggle-hint sidebar-toggle-hint-up';
                toggleHintUp.setAttribute('aria-hidden', 'true');
                toggleBtn.appendChild(toggleHintUp);
            }
        }

        if (!toggleHintDown || !toggleHintDown.isConnected) {
            toggleHintDown = toggleBtn.querySelector('.sidebar-toggle-hint-down');
            if (!toggleHintDown) {
                toggleHintDown = document.createElement('span');
                toggleHintDown.className = 'sidebar-toggle-hint sidebar-toggle-hint-down';
                toggleHintDown.setAttribute('aria-hidden', 'true');
                toggleBtn.appendChild(toggleHintDown);
            }
        }

        if (!toggleHintOutward || !toggleHintOutward.isConnected) {
            toggleHintOutward = toggleBtn.querySelector('.sidebar-toggle-hint-outward');
            if (!toggleHintOutward) {
                toggleHintOutward = document.createElement('span');
                toggleHintOutward.className = 'sidebar-toggle-hint sidebar-toggle-hint-outward';
                toggleHintOutward.setAttribute('aria-hidden', 'true');
                toggleBtn.appendChild(toggleHintOutward);
            }
        }
    }

    function updateToggleHintDirection() {
        ensureToggleDragHints();
        const outwardToRight = sidebarPosition === 'left';
        toggleBtn.dataset.outwardDir = outwardToRight ? 'right' : 'left';
        toggleHintUp.textContent = '';
        toggleHintDown.textContent = '';
        toggleHintOutward.textContent = '';
    }

    function setToggleHoldVisualActive(active) {
        const nextActive = active === true;
        if (toggleHoldVisualActive === nextActive) return;
        toggleHoldVisualActive = nextActive;
        toggleBtn.classList.toggle('sidebar-toggle-hold-active', nextActive);
        updateToggleIcon(currentState);
    }

    function normalizeToggleDragGuideDirection(direction) {
        if (direction === 'up' || direction === 'down' || direction === 'outward' || direction === 'inward') {
            return direction;
        }
        return null;
    }

    function setToggleDragGuideDirection(direction) {
        const safeDirection = normalizeToggleDragGuideDirection(direction);
        if (toggleDragGuideDirection === safeDirection) return;
        toggleDragGuideDirection = safeDirection;
        toggleBtn.dataset.dragGuide = safeDirection || '';
        updateToggleIcon(currentState);
    }

    function getToggleDragGuideDirection(dx, dy) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDy >= TOGGLE_DRAG_DIRECTION_THRESHOLD && absDy > absDx) {
            return dy < 0 ? 'up' : 'down';
        }

        if (absDx >= TOGGLE_DRAG_DIRECTION_THRESHOLD && absDx > absDy) {
            const outward = (sidebarPosition === 'left' && dx > 0)
                || (sidebarPosition === 'right' && dx < 0);
            if (outward) return 'outward';
            return 'inward';
        }

        return null;
    }

    function clearToggleHintHoldTimer() {
        if (toggleHintHoldTimer == null) return;
        window.clearTimeout(toggleHintHoldTimer);
        toggleHintHoldTimer = null;
    }

    function scheduleToggleHintReveal() {
        clearToggleHintHoldTimer();
        toggleHintHoldTimer = window.setTimeout(() => {
            toggleHintHoldTimer = null;
            if (!toggleDragSession) return;
            toggleBtn.classList.add('sidebar-toggle-show-hints');
            setToggleHoldVisualActive(true);
        }, TOGGLE_HINT_HOLD_DELAY_MS);
    }

    // 根据当前实际 DOM 宽度更新侧边栏宽度 CSS 变量
    function syncSidebarWidth() {
        const rect = sidebar.getBoundingClientRect();
        const actualWidth = rect && rect.width ? rect.width : 0;
        const effectiveWidth = currentState === 'compact' ? 0 : actualWidth;
        const widthPx = `${Math.max(0, Math.round(effectiveWidth))}px`;

        document.documentElement.style.setProperty('--sidebar-width', widthPx);
        if (sidebarPosition === 'right') {
            document.documentElement.style.setProperty('--content-area-left', '0px');
            document.documentElement.style.setProperty('--content-area-right', widthPx);
        } else {
            document.documentElement.style.setProperty('--content-area-left', widthPx);
            document.documentElement.style.setProperty('--content-area-right', '0px');
        }
    }

    function refreshMaximizedNodesSafe(options = {}) {
        try {
            if (!document.body || !document.body.classList.contains('canvas-node-maximized-active')) {
                return;
            }
            const parsedDelay = Number(options && options.delayMs);
            const delayMs = Number.isFinite(parsedDelay) ? Math.max(0, parsedDelay) : 120;
            const parsedStabilizeDelay = Number(options && options.stabilizeDelayMs);
            const stabilizeDelayMs = Number.isFinite(parsedStabilizeDelay) ? Math.max(delayMs, parsedStabilizeDelay) : 220;
            if (!(options && options.immediate === true) && typeof scheduleMaximizedNodesRefresh === 'function') {
                scheduleMaximizedNodesRefresh({ delayMs, stabilizeDelayMs });
                return;
            }
            if (typeof refreshMaximizedNodes === 'function') {
                refreshMaximizedNodes({ stabilize: !(options && options.stabilize === false) });
            }
        } catch (_) { }
    }

    function stabilizeCanvasLayoutSafe(options = {}) {
        try {
            if (window.CanvasModule && typeof window.CanvasModule.stabilizePermanentSectionAnchors === 'function') {
                window.CanvasModule.stabilizePermanentSectionAnchors(options);
            }
            if (window.CanvasModule && typeof window.CanvasModule.syncViewportVisualState === 'function') {
                window.CanvasModule.syncViewportVisualState();
            }
        } catch (_) { }
    }

    function scheduleCanvasLayoutStabilization(options = {}) {
        stabilizeCanvasLayoutSafe(options);
        requestAnimationFrame(() => {
            stabilizeCanvasLayoutSafe(options);
        });
        window.setTimeout(() => {
            stabilizeCanvasLayoutSafe(options);
        }, SIDEBAR_TRANSITION_MS + 40);
    }

    function scheduleMaximizedRefresh() {
        if (refreshRaf) {
            cancelAnimationFrame(refreshRaf);
            refreshRaf = null;
        }
        refreshMaximizedNodesSafe({
            delayMs: SIDEBAR_TRANSITION_MS + 40,
            stabilizeDelayMs: SIDEBAR_TRANSITION_MS + 120
        });
    }

    function prefersReducedMotion() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {
            return false;
        }
    }

    function clearSideSwitchAnimation() {
        if (typeof sideSwitchAnimationCleanup !== 'function') return;
        sideSwitchAnimationCleanup();
        sideSwitchAnimationCleanup = null;
    }

    function runSidebarSwitchFlipAnimation(mutateLayout) {
        clearSideSwitchAnimation();

        if (prefersReducedMotion()) {
            mutateLayout();
            return;
        }

        const targets = [sidebar, contentArea].filter((element) => element && element.isConnected);
        if (!targets.length) {
            mutateLayout();
            return;
        }

        const records = targets.map((element) => ({
            element,
            beforeRect: element.getBoundingClientRect(),
            prevTransition: element.style.transition,
            prevTransform: element.style.transform,
            prevWillChange: element.style.willChange
        }));

        mutateLayout();

        const animatedRecords = [];
        records.forEach((record) => {
            const afterRect = record.element.getBoundingClientRect();
            const dx = record.beforeRect.left - afterRect.left;
            const dy = record.beforeRect.top - afterRect.top;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
            animatedRecords.push({
                ...record,
                dx,
                dy
            });
        });

        if (!animatedRecords.length) {
            return;
        }

        animatedRecords.forEach((record) => {
            record.element.classList.add('sidebar-side-switch-animating');
            record.element.style.transition = 'none';
            record.element.style.transform = `translate(${record.dx}px, ${record.dy}px)`;
            record.element.style.willChange = 'transform';
        });

        void sidebar.offsetWidth;

        const transitionValue = `transform ${SIDEBAR_SIDE_SWITCH_ANIMATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        animatedRecords.forEach((record) => {
            record.element.style.transition = transitionValue;
            record.element.style.transform = '';
        });

        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            animatedRecords.forEach((record) => {
                record.element.classList.remove('sidebar-side-switch-animating');
                record.element.style.transition = record.prevTransition;
                record.element.style.transform = record.prevTransform;
                record.element.style.willChange = record.prevWillChange;
            });
            if (sideSwitchAnimationCleanup === cleanup) {
                sideSwitchAnimationCleanup = null;
            }
        };

        sideSwitchAnimationCleanup = cleanup;
        window.setTimeout(cleanup, SIDEBAR_SIDE_SWITCH_ANIMATION_MS + 80);
    }

    function normalizeSidebarState(raw) {
        const value = String(raw || '').toLowerCase();
        if (value === 'collapsed') return 'compact';
        return SIDEBAR_STATES.includes(value) ? value : null;
    }

    let currentState = readSidebarState();

    function updateToggleIcon(state) {
        const icon = toggleBtn.querySelector('i');
        if (!icon) return;

        const defaultPointTo = state === 'expanded'
            ? (sidebarPosition === 'left' ? 'left' : 'right')
            : (sidebarPosition === 'left' ? 'right' : 'left');

        icon.textContent = '';

        if (toggleHoldVisualActive) {
            if (toggleDragGuideDirection === 'up') {
                icon.className = 'fas fa-chevron-up';
                return;
            }
            if (toggleDragGuideDirection === 'down') {
                icon.className = 'fas fa-chevron-down';
                return;
            }

            const outwardPointTo = sidebarPosition === 'left' ? 'right' : 'left';
            if (toggleDragGuideDirection === 'outward') {
                icon.className = `fas fa-chevron-${outwardPointTo}`;
                return;
            }

            if (toggleDragGuideDirection === 'inward') {
                icon.className = `fas fa-chevron-${defaultPointTo}`;
                return;
            }

            icon.className = `fas fa-chevron-${outwardPointTo}`;
            return;
        }

        icon.className = `fas fa-chevron-${defaultPointTo}`;
    }

    function updateToggleLabel(state) {
        const isEn = currentLang === 'en';
        const collapseTitle = isEn ? 'Collapse sidebar' : '收起菜单栏';
        const expandTitle = isEn ? 'Expand sidebar' : '展开菜单栏';
        const circleTitle = state === 'expanded' ? collapseTitle : expandTitle;

        toggleBtn.setAttribute('title', circleTitle);
        toggleBtn.setAttribute('aria-label', circleTitle);
        toggleBtn.setAttribute('aria-expanded', state === 'expanded' ? 'true' : 'false');
        toggleBtn.dataset.collapseState = state;
        updateToggleIcon(state);
        updateToggleHintDirection();
    }

    function applySidebarPosition(position, options = {}) {
        const nextPosition = normalizeSidebarPosition(position) || 'left';
        const sideChanged = nextPosition !== sidebarPosition;
        stabilizeCanvasLayoutSafe({ syncBounds: false });

        const applyPositionState = () => {
            sidebarPosition = nextPosition;

            const onRight = nextPosition === 'right';
            sidebar.classList.toggle('position-right', onRight);
            sidebar.dataset.position = nextPosition;
            document.documentElement.classList.toggle('sidebar-on-right', onRight);

            if (currentState === 'expanded') {
                sidebar.style.width = `${getExpandedWidth(nextPosition)}px`;
            }

            updateToggleLabel(currentState);
            syncSidebarWidth();
        };

        if (sideChanged) {
            runSidebarSwitchFlipAnimation(applyPositionState);
        } else {
            clearSideSwitchAnimation();
            applyPositionState();
        }

        if (!options || options.persist !== false) {
            writeStorage(SIDEBAR_POSITION_KEY, nextPosition);
        }

        if (!options || options.refresh !== false) {
            scheduleMaximizedRefresh();
            scheduleCanvasLayoutStabilization({ syncBounds: false });
        }
    }

    function applySidebarState(state) {
        clearSideSwitchAnimation();
        stabilizeCanvasLayoutSafe({ syncBounds: false });
        const nextState = normalizeSidebarState(state) || 'expanded';
        sidebar.classList.toggle('compact', nextState === 'compact');
        sidebar.classList.remove('collapsed');
        if (nextState === 'expanded') {
            sidebar.style.width = `${getExpandedWidth(sidebarPosition)}px`;
        } else {
            sidebar.style.removeProperty('width');
        }
        sidebar.dataset.collapseState = nextState;
        updateToggleLabel(nextState);
        return nextState;
    }

    function persistSidebarState(state) {
        if (!persistEnabled) return;
        const safeState = normalizeSidebarState(state) || 'expanded';
        writeStorage(SIDEBAR_STATE_KEY, safeState);
        const legacyValue = safeState === 'expanded' ? 'false' : 'true';
        writeStorage(LEGACY_COLLAPSED_KEY, legacyValue);
    }

    function readSidebarState() {
        const savedState = normalizeSidebarState(readStorage(SIDEBAR_STATE_KEY));
        if (savedState) return savedState;
        const legacy = readStorage(LEGACY_COLLAPSED_KEY);
        if (legacy === 'true') return 'compact';
        if (legacy === 'false') return 'expanded';
        return isSidePanelMode ? 'compact' : 'expanded';
    }

    function readManualOverride() {
        if (!persistEnabled) return false;
        const raw = readStorage(SIDEBAR_MANUAL_KEY);
        if (raw === 'true') {
            hasManualOverride = true;
            return true;
        }
        if (raw === 'false') {
            hasManualOverride = false;
            return false;
        }
        hasManualOverride = false;
        return false;
    }

    function setManualOverride(isManual) {
        hasManualOverride = !!isManual;
        if (!persistEnabled) return;
        writeStorage(SIDEBAR_MANUAL_KEY, isManual ? 'true' : 'false');
    }

    function getAutoState() {
        return window.innerWidth <= autoCollapseWidth ? 'compact' : 'expanded';
    }

    function setSidebarState(state, options = {}) {
        const nextState = applySidebarState(state);

        if (options.manual === true) {
            if (sidebarCollapseMode === SIDEBAR_COLLAPSE_MODE_AUTO) {
                sidebarCollapseMode = SIDEBAR_COLLAPSE_MODE_MANUAL;
                setManualOverride(false);
                persistSidebarCollapsePrefs({
                    mode: SIDEBAR_COLLAPSE_MODE_MANUAL,
                    width: autoCollapseWidth
                });
            } else {
                setManualOverride(true);
            }
        } else if (options.manual === false) {
            setManualOverride(false);
        }

        persistSidebarState(nextState);
        syncSidebarWidth();
        scheduleMaximizedRefresh();
        scheduleCanvasLayoutStabilization({ syncBounds: false });
        return nextState;
    }

    function applyAutoState(options = {}) {
        if (!persistEnabled) return;
        if (sidebarCollapseMode === SIDEBAR_COLLAPSE_MODE_MANUAL) {
            if (options && options.force === true) {
                updateToggleLabel(currentState);
            }
            return;
        }
        const ignoreManualOverride = !!(options && options.ignoreManualOverride);
        const isManualOverride = readManualOverride();
        if (isManualOverride && !ignoreManualOverride) return;
        if (isManualOverride && ignoreManualOverride) {
            setManualOverride(false);
        }
        const targetState = getAutoState();
        if (targetState !== currentState) {
            currentState = setSidebarState(targetState, { manual: false });
        } else {
            updateToggleLabel(currentState);
        }
    }

    function scheduleAutoStateOnResize() {
        if (autoResizeDebounceTimer != null) {
            window.clearTimeout(autoResizeDebounceTimer);
        }

        autoResizeDebounceTimer = window.setTimeout(() => {
            autoResizeDebounceTimer = null;
            if (sidebarCollapseMode === SIDEBAR_COLLAPSE_MODE_MANUAL) {
                scheduleCanvasLayoutStabilization({ syncBounds: false });
                return;
            }
            applyAutoState({ ignoreManualOverride: true });
            syncSidebarWidth();
            scheduleMaximizedRefresh();
            scheduleCanvasLayoutStabilization({ syncBounds: false });
        }, AUTO_RESIZE_DEBOUNCE_MS);
    }

    function applySidebarCollapsePrefs(nextPrefs, options = {}) {
        const safePrefs = nextPrefs && typeof nextPrefs === 'object' ? nextPrefs : {};
        const nextMode = normalizeCollapseMode(safePrefs.mode);
        const nextWidth = normalizeAutoCollapseWidth(safePrefs.width);
        const forceIgnoreManualOverride = !!(options && options.ignoreManualOverride === true);
        const modeChanged = nextMode !== sidebarCollapseMode;
        const widthChanged = nextWidth !== autoCollapseWidth;

        sidebarCollapseMode = nextMode;
        autoCollapseWidth = nextWidth;

        if (modeChanged || widthChanged || (options && options.forceApply)) {
            if (sidebarCollapseMode === SIDEBAR_COLLAPSE_MODE_AUTO) {
                const shouldIgnoreManualOverride = forceIgnoreManualOverride || modeChanged;
                if (modeChanged && hasManualOverride) {
                    setManualOverride(false);
                }
                applyAutoState({ ignoreManualOverride: shouldIgnoreManualOverride, force: true });
            } else {
                if (modeChanged) {
                    setManualOverride(true);
                }
                updateToggleLabel(currentState);
                syncSidebarWidth();
                scheduleMaximizedRefresh();
                scheduleCanvasLayoutStabilization({ syncBounds: false });
            }
        }
    }

    applySidebarPosition(sidebarPosition, { persist: false, refresh: false });
    setToggleTopRatio(toggleTopRatio, { persist: false });

    const initialCollapsePrefs = readSidebarCollapsePrefs();
    applySidebarCollapsePrefs(initialCollapsePrefs, { forceApply: true });

    if (persistEnabled) {
        if (sidebarCollapseMode === SIDEBAR_COLLAPSE_MODE_MANUAL) {
            currentState = setSidebarState(currentState, { manual: true });
        } else if (readManualOverride()) {
            currentState = setSidebarState(currentState, { manual: true });
        } else {
            currentState = setSidebarState(getAutoState(), { manual: false });
        }
        if (currentState !== 'expanded') {
            ;
        }
    } else {
        currentState = applySidebarState('compact');
        syncSidebarWidth();
        scheduleMaximizedRefresh();
        scheduleCanvasLayoutStabilization({ syncBounds: false });
        ;
    }

    // 点击圆形按钮：展开 <-> 完全收起
    toggleBtn.addEventListener('click', (e) => {
        if (suppressToggleClick) {
            suppressToggleClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        e.stopPropagation();
        if (currentState === 'expanded') {
            currentState = setSidebarState('compact', { manual: true });
        } else {
            currentState = setSidebarState('expanded', { manual: true });
        }
        ;
    });

    function clearToggleDragSession() {
        clearToggleHintHoldTimer();
        setToggleDragGuideDirection(null);

        if (!toggleDragSession) {
            toggleBtn.classList.remove('sidebar-toggle-dragging');
            toggleBtn.classList.remove('sidebar-toggle-show-hints');
            setToggleHoldVisualActive(false);
            return;
        }

        const { pointerId } = toggleDragSession;
        try {
            if (toggleBtn.hasPointerCapture(pointerId)) {
                toggleBtn.releasePointerCapture(pointerId);
            }
        } catch (_) { }
        toggleBtn.classList.remove('sidebar-toggle-dragging');
        toggleBtn.classList.remove('sidebar-toggle-show-hints');
        setToggleHoldVisualActive(false);
        toggleDragSession = null;
    }

    toggleBtn.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;

        toggleDragSession = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
        };

        try {
            toggleBtn.setPointerCapture(event.pointerId);
        } catch (_) { }

        setToggleDragGuideDirection(null);
        toggleBtn.classList.remove('sidebar-toggle-show-hints');
        setToggleHoldVisualActive(false);
        scheduleToggleHintReveal();
        event.preventDefault();
    });

    toggleBtn.addEventListener('pointermove', (event) => {
        if (!toggleDragSession || event.pointerId !== toggleDragSession.pointerId) return;

        const dx = event.clientX - toggleDragSession.startX;
        const dy = event.clientY - toggleDragSession.startY;
        const dragDistance = Math.hypot(dx, dy);
        if (!toggleDragSession.moved && dragDistance >= TOGGLE_DRAG_ACTIVATE_THRESHOLD) {
            toggleDragSession.moved = true;
            clearToggleHintHoldTimer();
            toggleBtn.classList.add('sidebar-toggle-show-hints');
            setToggleHoldVisualActive(true);
            toggleBtn.classList.add('sidebar-toggle-dragging');
        }
        if (!toggleDragSession.moved) return;

        setToggleDragGuideDirection(getToggleDragGuideDirection(dx, dy));

        setToggleTopRatio(getToggleRatioFromClientY(event.clientY), { persist: false });
    });

    function finishToggleDrag(event, canceled) {
        if (!toggleDragSession || event.pointerId !== toggleDragSession.pointerId) return;

        const dx = event.clientX - toggleDragSession.startX;
        const dy = event.clientY - toggleDragSession.startY;
        const dragDistance = Math.hypot(dx, dy);
        const moved = toggleDragSession.moved || dragDistance >= TOGGLE_DRAG_ACTIVATE_THRESHOLD;
        let consumed = false;
        let switchedSide = false;

        if (moved && !canceled) {
            toggleBtn.classList.add('sidebar-toggle-dragging');
            setToggleTopRatio(getToggleRatioFromClientY(event.clientY), { persist: true });
            writeStorage(SIDEBAR_TOGGLE_TOP_MOVED_KEY, 'true');
            consumed = true;

            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= TOGGLE_DRAG_SWITCH_THRESHOLD) {
                const shouldSwitch = (sidebarPosition === 'left' && dx > 0)
                    || (sidebarPosition === 'right' && dx < 0);
                if (shouldSwitch) {
                    const nextPosition = sidebarPosition === 'left' ? 'right' : 'left';
                    applySidebarPosition(nextPosition, { persist: true, refresh: true });
                    switchedSide = true;
                }
            }
        }

        clearToggleDragSession();

        if (consumed || switchedSide) {
            suppressToggleClick = true;
            window.setTimeout(() => {
                suppressToggleClick = false;
            }, 0);
        }
    }

    toggleBtn.addEventListener('pointerup', (event) => {
        finishToggleDrag(event, false);
    });
    toggleBtn.addEventListener('pointercancel', (event) => {
        finishToggleDrag(event, true);
    });

    function clearResizeDragSession() {
        if (!resizeDragSession) return;
        const { pointerId } = resizeDragSession;
        try {
            if (resizeHandle.hasPointerCapture(pointerId)) {
                resizeHandle.releasePointerCapture(pointerId);
            }
        } catch (_) { }
        resizeDragSession = null;
        sidebar.classList.remove('is-resizing');
        document.body.classList.remove('sidebar-resizing');
    }

    function widthFromDragDelta(startWidth, dx) {
        return sidebarPosition === 'right' ? startWidth - dx : startWidth + dx;
    }

    resizeHandle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;

        const rect = sidebar.getBoundingClientRect();
        const startWidth = currentState === 'compact'
            ? 0
            : (rect && rect.width ? rect.width : getExpandedWidth(sidebarPosition));

        resizeDragSession = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth,
            moved: false,
            previewState: currentState,
            previewWidth: getExpandedWidth(sidebarPosition)
        };

        sidebar.classList.add('is-resizing');
        document.body.classList.add('sidebar-resizing');

        try {
            resizeHandle.setPointerCapture(event.pointerId);
        } catch (_) { }

        event.preventDefault();
    });

    resizeHandle.addEventListener('pointermove', (event) => {
        if (!resizeDragSession || event.pointerId !== resizeDragSession.pointerId) return;

        const dx = event.clientX - resizeDragSession.startX;
        if (!resizeDragSession.moved && Math.abs(dx) > 1) {
            resizeDragSession.moved = true;
        }

        const rawWidth = widthFromDragDelta(resizeDragSession.startWidth, dx);
        if (rawWidth <= SIDEBAR_RESIZE_COMPACT_THRESHOLD) {
            currentState = applySidebarState('compact');
            resizeDragSession.previewState = 'compact';
            syncSidebarWidth();
            refreshMaximizedNodesSafe();
            stabilizeCanvasLayoutSafe({ syncBounds: false });
            return;
        }

        const safeWidth = setExpandedWidth(sidebarPosition, rawWidth, { persist: false, apply: false });
        currentState = applySidebarState('expanded');
        sidebar.style.width = `${safeWidth}px`;
        resizeDragSession.previewState = 'expanded';
        resizeDragSession.previewWidth = safeWidth;
        syncSidebarWidth();
        refreshMaximizedNodesSafe();
        stabilizeCanvasLayoutSafe({ syncBounds: false });
    });

    function finishResizeDrag(event, canceled) {
        if (!resizeDragSession || event.pointerId !== resizeDragSession.pointerId) return;

        const moved = resizeDragSession.moved;
        const previewState = resizeDragSession.previewState;
        const previewWidth = resizeDragSession.previewWidth;

        clearResizeDragSession();

        if (!moved || canceled) {
            currentState = setSidebarState(currentState, { manual: true });
            return;
        }

        if (previewState === 'expanded') {
            setExpandedWidth(sidebarPosition, previewWidth, { persist: true, apply: true });
            currentState = setSidebarState('expanded', { manual: true });
            return;
        }

        currentState = setSidebarState('compact', { manual: true });
    }

    resizeHandle.addEventListener('pointerup', (event) => {
        finishResizeDrag(event, false);
    });
    resizeHandle.addEventListener('pointercancel', (event) => {
        finishResizeDrag(event, true);
    });

    // 窗口尺寸变化时，按自动规则收缩/展开（仅自动模式）
    window.addEventListener('resize', () => {
        scheduleAutoStateOnResize();
    });

    window.addEventListener('canvas-other-settings-updated', (event) => {
        const detail = event && event.detail;
        const nextPrefs = detail && typeof detail === 'object'
            ? getDirectoryCollapsePrefsFromSettings(detail)
            : readSidebarCollapsePrefs();
        applySidebarCollapsePrefs(nextPrefs, { forceApply: true });
    });

    // 初次加载后应用一次自动规则（若允许）
    applyAutoState();

    // 侧边栏动画结束后再补一次，避免过渡期间尺寸未更新
    sidebar.addEventListener('transitionend', (e) => {
        if (!e || !e.propertyName) return;
        if (e.propertyName === 'width' || e.propertyName.startsWith('padding')) {
            scheduleMaximizedRefresh();
            scheduleCanvasLayoutStabilization({ syncBounds: false });
        }
    });

    window.addEventListener('header-compact-state-changed', () => {
        const anchorY = headerStateChangeAnchorY;
        headerStateChangeAnchorY = null;
        if (Number.isFinite(anchorY)) {
            preserveToggleViewportCenterY(anchorY, { persist: true });
        }
        syncSidebarWidth();
        scheduleMaximizedRefresh();
        scheduleCanvasLayoutStabilization({ syncBounds: false });
    });

    window.addEventListener('header-compact-state-will-change', () => {
        headerStateChangeAnchorY = getToggleViewportCenterY();
    });
}

function initHeaderToggle() {
    const header = document.querySelector('.history-header');
    const toggleBtn = document.getElementById('headerToggleBtn');
    if (!header || !toggleBtn) return;

    const HEADER_STATES = ['expanded', 'compact'];
    const HEADER_DOCK_SIDES = ['top', 'bottom'];
    const DEFAULT_HEADER_DOCK_SIDE = isSidePanelMode ? 'bottom' : 'top';
    const TOGGLE_DRAG_ACTIVATE_THRESHOLD = 10;
    const TOGGLE_HINT_HOLD_DELAY_MS = 160;
    const TOGGLE_DRAG_DIRECTION_THRESHOLD = 8;
    const TOGGLE_DOCK_SWITCH_THRESHOLD = 42;
    const COMPACT_DRAG_ACTIVATE_THRESHOLD = 1;
    const COMPACT_LEFT_DEFAULT = 18;
    const COMPACT_LEFT_MIN = 0;

    let suppressToggleClick = false;
    let dragSession = null;
    let hintUp = null;
    let hintDown = null;
    let hintHoldTimer = null;
    let holdVisualActive = false;
    let dragGuideDirection = null;
    let compactLeft = COMPACT_LEFT_DEFAULT;
    let compactLeftByDock = {
        top: COMPACT_LEFT_DEFAULT,
        bottom: COMPACT_LEFT_DEFAULT
    };
    let compactLeftHasStoredByDock = {
        top: false,
        bottom: false
    };
    let compactFirstCollapseDoneByDock = {
        top: false,
        bottom: false
    };
    let compactDragSession = null;

    function normalizeHeaderState(raw) {
        const value = String(raw || '').toLowerCase();
        return HEADER_STATES.includes(value) ? value : null;
    }

    function normalizeHeaderDockSide(raw) {
        const value = String(raw || '').toLowerCase();
        return HEADER_DOCK_SIDES.includes(value) ? value : null;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getCompactLeftMax() {
        const width = Math.max(window.innerWidth || 0, 0);
        return Math.max(COMPACT_LEFT_MIN, width - 40);
    }

    function normalizeCompactLeft(raw) {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        return clamp(Math.round(value), COMPACT_LEFT_MIN, getCompactLeftMax());
    }

    function readStorage(key) {
        try {
            return localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            __saveLocalStorageRaw(key, value);
        } catch (_) { }
    }

    function getCompactLeftStorageKey(dockSide) {
        return dockSide === 'bottom' ? HEADER_COMPACT_LEFT_BOTTOM_KEY : HEADER_COMPACT_LEFT_TOP_KEY;
    }

    function getCompactLeftMovedStorageKey(dockSide) {
        return dockSide === 'bottom'
            ? HEADER_COMPACT_LEFT_MOVED_BOTTOM_KEY
            : HEADER_COMPACT_LEFT_MOVED_TOP_KEY;
    }

    function readCompactLeftByDock(dockSide) {
        const key = getCompactLeftStorageKey(dockSide);
        return normalizeCompactLeft(readStorage(key));
    }

    function readCompactLeftMovedByDock(dockSide) {
        return readStorage(getCompactLeftMovedStorageKey(dockSide)) === 'true';
    }

    function setCompactToggleLeft(nextLeft, options = {}) {
        compactLeft = clamp(Math.round(nextLeft), COMPACT_LEFT_MIN, getCompactLeftMax());
        compactLeftByDock.top = compactLeft;
        compactLeftByDock.bottom = compactLeft;
        document.documentElement.style.setProperty('--header-toggle-compact-left', `${compactLeft}px`);
        if (!options || options.persist !== false) {
            compactLeftHasStoredByDock.top = true;
            compactLeftHasStoredByDock.bottom = true;
            writeStorage(HEADER_COMPACT_LEFT_TOP_KEY, String(compactLeft));
            writeStorage(HEADER_COMPACT_LEFT_BOTTOM_KEY, String(compactLeft));
            writeStorage(HEADER_COMPACT_LEFT_MOVED_TOP_KEY, 'true');
            writeStorage(HEADER_COMPACT_LEFT_MOVED_BOTTOM_KEY, 'true');
            writeStorage(HEADER_COMPACT_LEFT_KEY, String(compactLeft));
        }
        return compactLeft;
    }

    function syncCompactLeftFromDock(dockSide, options = {}) {
        void dockSide;
        setCompactToggleLeft(compactLeft, { persist: options && options.persist === true });
    }

    function ensureToggleHints() {
        if (!hintUp || !hintUp.isConnected) {
            hintUp = toggleBtn.querySelector('.header-toggle-hint-up');
            if (!hintUp) {
                hintUp = document.createElement('span');
                hintUp.className = 'header-toggle-hint header-toggle-hint-up';
                hintUp.setAttribute('aria-hidden', 'true');
                toggleBtn.appendChild(hintUp);
            }
        }

        if (!hintDown || !hintDown.isConnected) {
            hintDown = toggleBtn.querySelector('.header-toggle-hint-down');
            if (!hintDown) {
                hintDown = document.createElement('span');
                hintDown.className = 'header-toggle-hint header-toggle-hint-down';
                hintDown.setAttribute('aria-hidden', 'true');
                toggleBtn.appendChild(hintDown);
            }
        }
    }

    function clearHintHoldTimer() {
        if (hintHoldTimer == null) return;
        window.clearTimeout(hintHoldTimer);
        hintHoldTimer = null;
    }

    function scheduleHintReveal() {
        clearHintHoldTimer();
        hintHoldTimer = window.setTimeout(() => {
            hintHoldTimer = null;
            if (!dragSession) return;
            toggleBtn.classList.add('header-toggle-show-hints');
            setHoldVisualActive(true);
        }, TOGGLE_HINT_HOLD_DELAY_MS);
    }

    function normalizeDragGuideDirection(direction) {
        if (direction === 'up' || direction === 'down') return direction;
        return null;
    }

    function setDragGuideDirection(direction) {
        const next = normalizeDragGuideDirection(direction);
        if (dragGuideDirection === next) return;
        dragGuideDirection = next;
        updateToggleIcon(currentHeaderState);
    }

    function setHoldVisualActive(active) {
        const next = active === true;
        if (holdVisualActive === next) return;
        holdVisualActive = next;
        toggleBtn.classList.toggle('header-toggle-hold-active', next);
        updateToggleIcon(currentHeaderState);
    }

    function getDragGuideDirection(dx, dy) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDy >= TOGGLE_DRAG_DIRECTION_THRESHOLD && absDy >= absDx) {
            return dy < 0 ? 'up' : 'down';
        }
        return null;
    }

    function applyHeaderDockSide(dockSide, options = {}) {
        const nextDock = normalizeHeaderDockSide(dockSide) || DEFAULT_HEADER_DOCK_SIDE;
        const changed = nextDock !== currentHeaderDockSide;
        currentHeaderDockSide = nextDock;
        document.body.classList.toggle('header-dock-bottom', nextDock === 'bottom');
        if (changed) {
            setCompactToggleLeft(compactLeft, { persist: false });
        }
        if (!options || options.persist !== false) {
            writeStorage(HEADER_DOCK_SIDE_KEY, nextDock);
        }
        updateToggleLabel(currentHeaderState);
    }

    function applyHeaderState(state, options = {}) {
        const prevCompact = currentHeaderState === 'compact';
        const prevRect = toggleBtn.getBoundingClientRect();
        const nextState = normalizeHeaderState(state) || 'expanded';
        const prevState = currentHeaderState;
        const isBootstrap = !!(options && options.bootstrap === true);
        const dock = currentHeaderDockSide === 'bottom' ? 'bottom' : 'top';
        let firstCompactAlignedLeft = null;
        const shouldForceFirstCompactOrigin = nextState === 'compact'
            && prevState !== 'compact'
            && !isBootstrap
            && !compactFirstCollapseDoneByDock[dock]
            && !compactLeftHasStoredByDock[dock];

        // 关键：首次从展开切换到折叠时，先把折叠按钮位置对齐到“原位”
        // 必须在 body 切换到 header-compact 前执行，避免先闪到默认位置再纠正。
        if (shouldForceFirstCompactOrigin) {
            const centerX = prevRect && Number.isFinite(prevRect.left)
                ? (prevRect.left + prevRect.width / 2)
                : compactLeft;
            if (Number.isFinite(centerX)) {
                firstCompactAlignedLeft = centerX - 15;
                setCompactToggleLeft(firstCompactAlignedLeft, { persist: false });
            }
        }

        if (typeof window !== 'undefined' && prevCompact !== (nextState === 'compact')) {
            window.dispatchEvent(new CustomEvent('header-compact-state-will-change', {
                detail: { nextCompact: nextState === 'compact' }
            }));
        }

        currentHeaderState = nextState;
        document.body.classList.toggle('header-compact', nextState === 'compact');
        if (nextState === 'compact') {
            if (prevState !== 'compact') {
                if (shouldForceFirstCompactOrigin) {
                    compactFirstCollapseDoneByDock[dock] = true;
                    if (firstCompactAlignedLeft == null) {
                        const centerX = prevRect && Number.isFinite(prevRect.left)
                            ? (prevRect.left + prevRect.width / 2)
                            : compactLeft;
                        if (Number.isFinite(centerX)) {
                            const alignedLeft = centerX - 15;
                            setCompactToggleLeft(alignedLeft, { persist: false });
                        }
                    }
                } else if (isBootstrap || compactLeftHasStoredByDock[dock]) {
                    const dockLeft = compactLeftByDock[dock];
                    setCompactToggleLeft(dockLeft, { persist: false });
                } else if (firstCompactAlignedLeft == null) {
                    const centerX = prevRect && Number.isFinite(prevRect.left)
                        ? (prevRect.left + prevRect.width / 2)
                        : compactLeft;
                    if (Number.isFinite(centerX)) {
                        const alignedLeft = centerX - 15;
                        setCompactToggleLeft(alignedLeft, { persist: false });
                    }
                }
            } else {
                setCompactToggleLeft(compactLeft, { persist: false });
            }
        }
        if (!options || options.persist !== false) {
            writeStorage(HEADER_COLLAPSE_STATE_KEY, nextState);
        }

        if (typeof window !== 'undefined' && prevCompact !== (nextState === 'compact')) {
            try {
                window.dispatchEvent(new CustomEvent('header-compact-state-changed', {
                    detail: { compact: nextState === 'compact' }
                }));
            } catch (_) { }
        }

        updateToggleLabel(nextState);
        return nextState;
    }

    function updateToggleIcon(state) {
        const icon = toggleBtn.querySelector('i');
        if (!icon) return;

        icon.textContent = '';

        const defaultPointTo = state === 'expanded'
            ? (currentHeaderDockSide === 'top' ? 'up' : 'down')
            : (currentHeaderDockSide === 'top' ? 'down' : 'up');

        if (holdVisualActive) {
            if (dragGuideDirection === 'up') {
                icon.className = 'fas fa-chevron-up';
                return;
            }
            if (dragGuideDirection === 'down') {
                icon.className = 'fas fa-chevron-down';
                return;
            }
        }

        icon.className = `fas fa-chevron-${defaultPointTo}`;
    }

    function getHeaderToggleLabel(state) {
        const lang = currentLang === 'en' ? 'en' : 'zh_CN';
        if (state === 'compact') {
            return i18n.headerToggleExpandTooltip[lang];
        }
        return i18n.headerToggleCollapseTooltip[lang];
    }

    function updateToggleLabel(state) {
        const label = getHeaderToggleLabel(state);
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.setAttribute('aria-expanded', state === 'expanded' ? 'true' : 'false');
        toggleBtn.dataset.collapseState = state;
        updateToggleIcon(state);
    }

    function clearDragSession() {
        clearHintHoldTimer();
        setDragGuideDirection(null);

        if (!dragSession) {
            setHoldVisualActive(false);
            return;
        }

        const { pointerId } = dragSession;
        try {
            if (toggleBtn.hasPointerCapture(pointerId)) {
                toggleBtn.releasePointerCapture(pointerId);
            }
        } catch (_) { }

        toggleBtn.classList.remove('header-toggle-show-hints');
        setHoldVisualActive(false);
        dragSession = null;
    }

    function setHeaderState(state) {
        return applyHeaderState(state, { persist: true });
    }

    function toggleHeaderState() {
        if (currentHeaderState === 'expanded') {
            setHeaderState('compact');
        } else {
            setHeaderState('expanded');
        }
    }

    function finishDrag(event, canceled) {
        if (!dragSession || event.pointerId !== dragSession.pointerId) return;

        const dx = event.clientX - dragSession.startX;
        const dy = event.clientY - dragSession.startY;
        const dragDistance = Math.hypot(dx, dy);
        const moved = dragSession.moved || dragDistance >= TOGGLE_DRAG_ACTIVATE_THRESHOLD;
        let consumed = false;
        let switchedDock = false;

        if (moved && !canceled) {
            consumed = true;

            if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= TOGGLE_DOCK_SWITCH_THRESHOLD) {
                const shouldDockBottom = dy > 0;
                const nextDock = shouldDockBottom ? 'bottom' : 'top';
                if (nextDock !== currentHeaderDockSide) {
                    applyHeaderDockSide(nextDock, { persist: true });
                    switchedDock = true;
                }
            }
        }

        clearDragSession();

        if (consumed || switchedDock) {
            suppressToggleClick = true;
            window.setTimeout(() => {
                suppressToggleClick = false;
            }, 0);
        }
    }

    function clearCompactDragSession() {
        if (!compactDragSession) return;
        const { pointerId } = compactDragSession;
        try {
            if (toggleBtn.hasPointerCapture(pointerId)) {
                toggleBtn.releasePointerCapture(pointerId);
            }
        } catch (_) { }
        compactDragSession = null;
        setDragGuideDirection(null);
        toggleBtn.classList.remove('header-toggle-show-hints');
        setHoldVisualActive(false);
        toggleBtn.classList.remove('header-toggle-dragging');
    }

    function finishCompactDrag(event, canceled) {
        if (!compactDragSession || event.pointerId !== compactDragSession.pointerId) return;

        const dx = event.clientX - compactDragSession.startX;
        const dy = event.clientY - compactDragSession.startY;
        const dragDistance = Math.hypot(dx, dy);
        const moved = compactDragSession.moved || dragDistance >= COMPACT_DRAG_ACTIVATE_THRESHOLD;
        let consumed = false;

        if (!canceled && moved) {
            const verticalDominant = Math.abs(dy) >= Math.abs(dx);
            const shouldSwitchDock = verticalDominant && Math.abs(dy) >= TOGGLE_DOCK_SWITCH_THRESHOLD;

            if (shouldSwitchDock) {
                const nextDock = dy > 0 ? 'bottom' : 'top';
                applyHeaderDockSide(nextDock, { persist: true });
                consumed = true;
            } else {
                const nextLeft = compactDragSession.lastAppliedLeft;
                setCompactToggleLeft(nextLeft, { persist: true });
                consumed = true;
            }
        }

        clearCompactDragSession();

        if (consumed) {
            suppressToggleClick = true;
            window.setTimeout(() => {
                suppressToggleClick = false;
            }, 0);
        }
    }

    const savedDock = normalizeHeaderDockSide(readStorage(HEADER_DOCK_SIDE_KEY)) || DEFAULT_HEADER_DOCK_SIDE;
    const savedState = normalizeHeaderState(readStorage(HEADER_COLLAPSE_STATE_KEY)) || 'expanded';
    const legacyLeft = normalizeCompactLeft(readStorage(HEADER_COMPACT_LEFT_KEY));
    const savedTopLeft = readCompactLeftByDock('top');
    const savedBottomLeft = readCompactLeftByDock('bottom');
    const savedTopMoved = readCompactLeftMovedByDock('top');
    const savedBottomMoved = readCompactLeftMovedByDock('bottom');
    const fallbackLeft = clamp(COMPACT_LEFT_DEFAULT, COMPACT_LEFT_MIN, getCompactLeftMax());
    const legacyMoved = legacyLeft != null && legacyLeft !== COMPACT_LEFT_DEFAULT;
    const topMovedByValue = savedTopLeft != null && savedTopLeft !== COMPACT_LEFT_DEFAULT;
    const bottomMovedByValue = savedBottomLeft != null && savedBottomLeft !== COMPACT_LEFT_DEFAULT;
    const hasMovedMemory = savedTopMoved || savedBottomMoved || legacyMoved || topMovedByValue || bottomMovedByValue;
    const preferredDockLeft = savedDock === 'bottom' ? savedBottomLeft : savedTopLeft;
    const alternateDockLeft = savedDock === 'bottom' ? savedTopLeft : savedBottomLeft;
    const mirroredInitialLeft = legacyLeft != null
        ? legacyLeft
        : (preferredDockLeft != null
            ? preferredDockLeft
            : (alternateDockLeft != null ? alternateDockLeft : fallbackLeft));

    compactLeft = mirroredInitialLeft;
    compactLeftByDock.top = mirroredInitialLeft;
    compactLeftByDock.bottom = mirroredInitialLeft;
    compactLeftHasStoredByDock.top = hasMovedMemory;
    compactLeftHasStoredByDock.bottom = hasMovedMemory;

    if (hasMovedMemory) {
        writeStorage(HEADER_COMPACT_LEFT_TOP_KEY, String(mirroredInitialLeft));
        writeStorage(HEADER_COMPACT_LEFT_BOTTOM_KEY, String(mirroredInitialLeft));
        writeStorage(HEADER_COMPACT_LEFT_MOVED_TOP_KEY, 'true');
        writeStorage(HEADER_COMPACT_LEFT_MOVED_BOTTOM_KEY, 'true');
        writeStorage(HEADER_COMPACT_LEFT_KEY, String(mirroredInitialLeft));
    }

    ensureToggleHints();
    applyHeaderDockSide(savedDock, { persist: false });
    applyHeaderState(savedState, { persist: false, bootstrap: true });
    setCompactToggleLeft(compactLeft, { persist: false });

    window.addEventListener('resize', () => {
        setCompactToggleLeft(compactLeft, { persist: false });
    });

    toggleBtn.addEventListener('click', (event) => {
        if (suppressToggleClick) {
            suppressToggleClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        event.stopPropagation();
        toggleHeaderState();
    });

    toggleBtn.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;

        if (currentHeaderState === 'compact') {
            compactDragSession = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startLeft: compactLeft,
                moved: false,
                pendingLeft: compactLeft,
                lastAppliedLeft: compactLeft
            };

            try {
                toggleBtn.setPointerCapture(event.pointerId);
            } catch (_) { }

            toggleBtn.classList.remove('header-toggle-dragging');
            event.preventDefault();
            return;
        }

        dragSession = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false
        };

        try {
            toggleBtn.setPointerCapture(event.pointerId);
        } catch (_) { }

        setDragGuideDirection(null);
        toggleBtn.classList.remove('header-toggle-show-hints');
        setHoldVisualActive(false);
        scheduleHintReveal();
        event.preventDefault();
    });

    toggleBtn.addEventListener('pointermove', (event) => {
        if (compactDragSession && event.pointerId === compactDragSession.pointerId) {
            const dx = event.clientX - compactDragSession.startX;
            const dy = event.clientY - compactDragSession.startY;
            const dragDistance = Math.hypot(dx, dy);
            if (!compactDragSession.moved && dragDistance >= COMPACT_DRAG_ACTIVATE_THRESHOLD) {
                compactDragSession.moved = true;
                toggleBtn.classList.add('header-toggle-dragging');
            }
            if (!compactDragSession.moved) return;

            const verticalDominant = Math.abs(dy) >= Math.abs(dx);
            const switchingDock = verticalDominant && Math.abs(dy) >= TOGGLE_DOCK_SWITCH_THRESHOLD;
            if (switchingDock) {
                setDragGuideDirection(dy > 0 ? 'down' : 'up');
                toggleBtn.classList.add('header-toggle-show-hints');
                setHoldVisualActive(true);
                event.preventDefault();
                return;
            }

            setDragGuideDirection(null);
            toggleBtn.classList.remove('header-toggle-show-hints');
            setHoldVisualActive(false);

            const targetLeft = compactDragSession.startLeft + dx;
            compactDragSession.pendingLeft = targetLeft;
            compactDragSession.lastAppliedLeft = setCompactToggleLeft(targetLeft, { persist: false });
            event.preventDefault();
            return;
        }

        if (!dragSession || event.pointerId !== dragSession.pointerId) return;

        const dx = event.clientX - dragSession.startX;
        const dy = event.clientY - dragSession.startY;
        const dragDistance = Math.hypot(dx, dy);

        if (!dragSession.moved && dragDistance >= TOGGLE_DRAG_ACTIVATE_THRESHOLD) {
            dragSession.moved = true;
            clearHintHoldTimer();
            toggleBtn.classList.add('header-toggle-show-hints');
            setHoldVisualActive(true);
        }
        if (!dragSession.moved) return;

        setDragGuideDirection(getDragGuideDirection(dx, dy));
    });

    toggleBtn.addEventListener('pointerup', (event) => {
        if (compactDragSession && event.pointerId === compactDragSession.pointerId) {
            finishCompactDrag(event, false);
            return;
        }
        finishDrag(event, false);
    });
    toggleBtn.addEventListener('pointercancel', (event) => {
        if (compactDragSession && event.pointerId === compactDragSession.pointerId) {
            finishCompactDrag(event, true);
            return;
        }
        finishDrag(event, true);
    });
}

// =============================================================================
// 视图切换
// =============================================================================

function switchView(view) {
    ;

    const previousView = currentView;

    // 更新全局变量
    currentView = view;

    if (view === 'canvas' && previousView !== 'canvas') {
        treeChangeMap = new Map();
        cachedTreeData = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;
    }

    // 视图切换时隐藏搜索结果面板并清除搜索缓存（Phase 1 & 2 & 2.5）
    try {
        // [隔离增强] 确保清理搜索 UI 状态
        if (typeof cancelPendingMainSearchDebounce === 'function') cancelPendingMainSearchDebounce();
        if (typeof hideSearchResultsPanel === 'function') hideSearchResultsPanel();
        if (typeof toggleSearchModeMenu === 'function') toggleSearchModeMenu(false);
        if (typeof renderSearchModeUI === 'function') renderSearchModeUI();

        // [Search Isolation] Search box behaviors differ by view.
        // When leaving a view, clear the shared top search input to avoid leaking queries.
        if (previousView !== view && typeof window !== 'undefined' && typeof window.resetMainSearchUI === 'function') {
            window.resetMainSearchUI({ reason: 'switchView' });
        }

        if (window.SearchContextManager) {
            // but we set the main view here.
            window.SearchContextManager.updateContext(view);
        }

        // 当前仅保留 Canvas 视图，无需清理历史视图搜索缓存
    } catch (_) { }

    // 更新导航标签
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.view === view) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // 更新视图容器
    document.querySelectorAll('.view').forEach(v => {
        if (v.id === `${view}View`) {
            v.classList.add('active');
        } else {
            v.classList.remove('active');
        }
    });

    // Canvas 视图：去除 content-area padding，避免画布四周出现“边框/留白”
    const contentArea = document.querySelector('.content-area');
    if (contentArea) {
        contentArea.classList.toggle('canvas-full-bleed', view === 'canvas');
    }
    // Canvas 视图：取消 html 的 scrollbar gutter，避免右侧出现空隙/黑边
    try {
        document.documentElement.classList.toggle('canvas-view-active', view === 'canvas');
    } catch (_) { }

    // 保存到 localStorage
    if (!isSidePanelMode) {
        __saveLocalStorageRaw('lastActiveView', view);
    }
    ;

    // 渲染当前视图
    renderCurrentView();
}

function renderCurrentView() {
    // 离开 Canvas 时，停止永久栏目副本同步监听（减少无意义的 DOM 观察开销）
    if (currentView !== 'canvas') {
        teardownPermanentTreeCopySync();
    }

    // 控制缩放控制器的显示/隐藏
    updateSidePanelFloatingToolsDisplay();

    switch (currentView) {
        case 'canvas':
            // Canvas视图：包含原Bookmark Tree所有功能 + Canvas画布功能
            // 性能优化：使用状态缓存，避免重复初始化
            {
                const canvasContent = document.getElementById('canvasContent');
                let permanentSectionExists = document.getElementById('permanentSection');
                const canvasView = document.getElementById('canvasView');

                // 检查Canvas是否已经初始化过
                const isCanvasInitialized = canvasView && canvasView.dataset.initialized === 'true';

                // 1. 先从template创建永久栏目并添加到canvas-content（如果还不存在）
                if (!permanentSectionExists && canvasContent) {
                    const template = document.getElementById('permanentSectionTemplate');
                    if (template) {
                        const permanentSection = template.content.cloneNode(true);
                        const permanentSectionEl = permanentSection.querySelector('.permanent-bookmark-section');
                        if (permanentSectionEl) {
                            permanentSectionEl.style.width = '600px';
                            permanentSectionEl.style.height = '600px';
                        }
                        canvasContent.appendChild(permanentSection);
                        ;

                        // 立即应用语言设置（使用主UI的applyLanguage函数）
                        setTimeout(() => {
                            applyLanguage();
                            ;
                        }, 0);
                    } else {
                        console.error('[Canvas] 找不到permanentSectionTemplate');
                    }
                } else if (!canvasContent) {
                    console.error('[Canvas] 找不到canvasContent');
                } else {
                    ;
                }

                try {
                    if (typeof window.__primePendingCanvasFullscreenShell === 'function') {
                        window.__primePendingCanvasFullscreenShell();
                    }
                } catch (_) { }

                // 2. 渲染书签树
                // 即使是已初始化状态，也需要调用 renderTreeView 检查是否有数据更新（内部有缓存机制，开销很小）
                renderTreeView().catch(e => console.error('[Canvas] 书签树渲染失败:', e));
                // 多永久栏目副本：启动“主永久栏目 -> 副本”的同步
                ensurePermanentTreeCopySync();

                // 3. 初始化Canvas功能（缩放、平移、拖拽等）- 仅首次执行
                if (!isCanvasInitialized) {
                    // 首次初始化
                    try {
                        if (window.CanvasModule) {
                            window.CanvasModule.init();
                        }
                        updateSidePanelFloatingToolsDisplay();
                        bindCanvasPreloadRelease();

                        // 标记Canvas已初始化
                        if (canvasView) {
                            canvasView.dataset.initialized = 'true';
                            canvasView.dataset.initTime = Date.now().toString();
                        }
                        ;
                    } catch (initError) {
                        console.error('[Canvas] 初始化失败:', initError);
                        // 初始化失败时不标记为已初始化，下次会重试
                    }
                } else {
                    // 已初始化：验证状态
                    ;

                    // 验证Canvas状态是否有效
                    const canvasWorkspace = document.getElementById('canvasWorkspace');
                    const canvasContentEl = document.getElementById('canvasContent');
                    // 只要容器存在即可，children.length 检查交由 renderTreeView 保证
                    const hasValidState = canvasWorkspace && canvasContentEl;

                    if (!hasValidState) {
                        // 状态无效，尝试重新初始化模块
                        console.warn('[Canvas] 缓存状态无效，重新初始化模块');
                        if (canvasView) {
                            canvasView.dataset.initialized = 'false';
                        }
                        try {
                            if (window.CanvasModule) {
                                window.CanvasModule.init();
                            }
                            updateSidePanelFloatingToolsDisplay();
                            bindCanvasPreloadRelease();
                            if (canvasView) {
                                canvasView.dataset.initialized = 'true';
                                canvasView.dataset.initTime = Date.now().toString();
                            }
                        } catch (reinitError) {
                            console.error('[Canvas] 重新初始化失败:', reinitError);
                        }
                    } else {
                        bindCanvasPreloadRelease();
                        // 触发视口休眠管理，唤醒可见栏目
                        if (window.CanvasModule && window.CanvasModule.scheduleDormancyUpdate) {
                            // 延迟执行，确保视图切换完成
                            setTimeout(() => {
                                try {
                                    window.CanvasModule.scheduleDormancyUpdate();
                                    if (typeof window.CanvasModule.syncViewportVisualState === 'function') {
                                        window.CanvasModule.syncViewportVisualState();
                                    }
                                } catch (err) {
                                    console.warn('[Canvas] 休眠管理调度失败:', err);
                                }
                            }, 50);
                        }
                    }
                }

                if (window.CanvasSidebarDirectory && typeof window.CanvasSidebarDirectory.refresh === 'function') {
                    try { window.CanvasSidebarDirectory.refresh({ force: true }); } catch (_) { }
                }

            }
            break;
        default:
            clearLayoutPreloadState();
            break;
    }
}

// =============================================================================
// 本项目有三套独立的链接点击处理系统，互不干扰：
//   1. 书签系统（defaultOpenMode）- 处理 .tree-bookmark-link
//      → history.js:attachTreeEvents + bookmark_canvas_module.js:tempLinkClickHandler
//   2. 超链接系统（hyperlinkDefaultOpenMode）- 处理说明框/Markdown卡片内链接
//      → bookmark_tree_context_menu.js:attachHyperlinkContextMenu
//   3. 时间捕捉兜底（本监听器）- 处理其他所有 target="_blank" 链接
//
// ⚠️ 添加新功能时必须注意：
//   - 如果新增链接区域有自己的处理逻辑，必须在下面添加排除条件！
//   - 否则会导致链接被打开两次（本监听器 + 专用监听器都处理）
//   - 详见：.agent/workflows/link-click-handling.md
// =============================================================================
// 书签树视图
// =============================================================================

let treeChangeMap = null; // 缓存变动映射
let cachedTreeData = null; // 缓存树数据
let cachedOldTree = null; // 缓存旧树数据
let cachedCurrentTree = null; // 缓存当前树数据（用于智能路径检测）
let lastTreeFingerprint = null; // 上次树的指纹
let lastTreeSnapshotVersion = null; // 上次快照版本（来自 background 缓存）
let cachedCurrentTreeIndex = null; // id -> node（懒加载用，按需构建）
let cachedRenderTreeIndex = null; // id -> node（懒加载用，包含 deleted 合并树）

// Canvas 懒加载：用于“祖先文件夹灰点提示”的缓存（避免每次加载子节点都重复计算）
let __canvasPermanentHintSet = null;
// Canvas 懒加载：用于“祖先文件夹聚合徽标（+/-/~/>>）”的缓存
let __canvasPermanentAncestorBadges = null;

// Canvas 永久栏目树：懒加载配置（避免首次进入构建海量 DOM）
const CANVAS_PERMANENT_TREE_LAZY_ENABLED = true;
const CANVAS_PERMANENT_TREE_CHILD_BATCH = 20;

// 永久栏目：懒加载已加载项数持久化记忆（localStorage，不参与导出/同步）
const PERMANENT_LAZY_LOADED_COUNTS_KEY = 'canvas-permanent-lazy-loaded-counts';
let _savePermanentLoadedCountsTimer = null;

function savePermanentLoadedCounts(counts) {
    if (_savePermanentLoadedCountsTimer) {
        clearTimeout(_savePermanentLoadedCountsTimer);
    }
    _savePermanentLoadedCountsTimer = setTimeout(() => {
        _savePermanentLoadedCountsTimer = null;
        try {
            const payload = counts && typeof counts === 'object' ? counts : {};
            saveViewState('expand', PERMANENT_LAZY_LOADED_COUNTS_KEY, payload, { partitionKey: 'page' });
            saveViewState('expand', PERMANENT_LAZY_LOADED_COUNTS_KEY, payload, { partitionKey: 'sidepanel' });
        } catch (e) {
            console.warn('[Canvas Permanent] 保存已加载项数记忆失败:', e);
        }
    }, 300);
}

function loadPermanentLoadedCounts() {
    try {
        const currentPartition = __getCanvasViewPartitionKey();
        let key = __buildCanvasPartitionedViewStateKey('expand', PERMANENT_LAZY_LOADED_COUNTS_KEY, currentPartition);
        let counts = __readPartitionedViewJSON(key, null, 'expand');
        if (counts == null) {
            const otherPartition = currentPartition === 'sidepanel' ? 'page' : 'sidepanel';
            const otherKey = __buildCanvasPartitionedViewStateKey('expand', PERMANENT_LAZY_LOADED_COUNTS_KEY, otherPartition);
            counts = __readPartitionedViewJSON(otherKey, null, 'expand');
            if (counts != null) {
                try { saveViewState('expand', PERMANENT_LAZY_LOADED_COUNTS_KEY, counts, { partitionKey: currentPartition }); } catch (_) { }
            }
        }
        if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
            return counts;
        }
    } catch (e) {
        console.warn('[Canvas Permanent] 加载已加载项数记忆失败:', e);
    }
    return {};
}

function clearPermanentLoadedCounts() {
    try {
        if (_savePermanentLoadedCountsTimer) {
            clearTimeout(_savePermanentLoadedCountsTimer);
            _savePermanentLoadedCountsTimer = null;
        }
        __removeCanvasPartitionedViewStateKey('expand', PERMANENT_LAZY_LOADED_COUNTS_KEY);
    } catch (_) { }
}

function deletePermanentLoadedCountEntry(parentId) {
    try {
        const counts = loadPermanentLoadedCounts();
        const key = String(parentId);
        if (key in counts) {
            delete counts[key];
            savePermanentLoadedCounts(counts);
        }
    } catch (_) { }
}

function updatePermanentLoadedCountEntry(parentId, count, fullyExpanded) {
    try {
        const counts = loadPermanentLoadedCounts();
        const key = String(parentId);
        counts[key] = { count: count, fullyExpanded: !!fullyExpanded };
        savePermanentLoadedCounts(counts);
    } catch (_) { }
}

// Canvas 懒加载模式下的“变化提示缓存”（仅四类：新增/删除/修改/移动）
const CANVAS_LAZY_CHANGE_HINT_TTL_MS = 5 * 60 * 1000;
let canvasLazyChangeHints = {
    updatedAt: 0,
    added: new Set(),
    modified: new Set(),
    moved: new Set(),
    movedInfo: new Map(), // key -> { oldPath }
    deletedCount: 0,
    hasAny: false
};
let canvasLazyChangeHintsPromise = null;
// Canvas 懒加载：增量删除时缓存被删节点快照（用于后续展开时仍能显示红色占位）
let incrementalDeletedNodeSnapshots = new Map(); // id -> node snapshot
let incrementalDeletedChildrenByParent = new Map(); // parentId -> Map<id, node snapshot>

function stripTreeChangeType(changeMap, id, typeToStrip) {
    if (!(changeMap instanceof Map) || !id || !typeToStrip) return;
    const key = String(id);
    const existing = changeMap.get(key);
    if (!existing || typeof existing.type !== 'string') return;

    const nextTypes = existing.type.split('+').filter(type => type && type !== typeToStrip);
    if (!nextTypes.length) {
        changeMap.delete(key);
        return;
    }

    const next = { ...existing, type: nextTypes.join('+') };
    if (typeToStrip === 'added') delete next.added;
    if (typeToStrip === 'deleted') delete next.deleted;
    if (typeToStrip === 'modified') delete next.modified;
    if (typeToStrip === 'moved') delete next.moved;
    changeMap.set(key, next);
}

function compactStructuralRootChanges(changeMap, currentTree = null) {
    if (!(changeMap instanceof Map) || changeMap.size === 0) return changeMap;

    let currentIndex = null;
    try {
        if (currentTree && currentTree[0]) {
            currentIndex = buildTreeIndexFromRoot(currentTree[0]);
        } else if (cachedCurrentTree && cachedCurrentTree[0]) {
            currentIndex = getCachedCurrentTreeIndex() || buildTreeIndexFromRoot(cachedCurrentTree[0]);
        }
    } catch (_) { currentIndex = null; }

    if (currentIndex instanceof Map) {
        try {
            changeMap.forEach((change, id) => {
                if (!change || typeof change.type !== 'string' || !change.type.includes('added')) return;
                const rootNode = currentIndex.get(String(id));
                if (!rootNode || !Array.isArray(rootNode.children) || rootNode.children.length === 0) return;
                const stack = [...rootNode.children];
                while (stack.length) {
                    const child = stack.pop();
                    if (!child || typeof child.id === 'undefined' || child.id === null) continue;
                    stripTreeChangeType(changeMap, child.id, 'added');
                    if (Array.isArray(child.children) && child.children.length) {
                        stack.push(...child.children);
                    }
                }
            });
        } catch (_) { }
    }

    try {
        changeMap.forEach((change) => {
            if (!change || typeof change.type !== 'string' || !change.type.includes('deleted')) return;
            const snapshotRoot = cloneBookmarkNodeSnapshot(change.deleted && (change.deleted.nodeSnapshot || change.deleted.node));
            if (!snapshotRoot || !Array.isArray(snapshotRoot.children) || snapshotRoot.children.length === 0) return;
            const stack = [...snapshotRoot.children];
            while (stack.length) {
                const child = stack.pop();
                if (!child || typeof child.id === 'undefined' || child.id === null) continue;
                stripTreeChangeType(changeMap, child.id, 'deleted');
                if (Array.isArray(child.children) && child.children.length) {
                    stack.push(...child.children);
                }
            }
        });
    } catch (_) { }

    return changeMap;
}

// 清除树缓存（供拖拽模块调用，防止缓存覆盖DOM更新）
function clearTreeCache() {
    cachedTreeData = null;
    lastTreeFingerprint = null;
    lastTreeSnapshotVersion = null;
    cachedCurrentTreeIndex = null;
    cachedRenderTreeIndex = null;
    ;
}
window.clearTreeCache = clearTreeCache;

function buildTreeIndexFromRoot(root) {
    if (!root) return null;
    const map = new Map();
    // Some bookmark snapshots (or trimmed caches) may omit parentId/index.
    // For path-based features (e.g. ancestor "path badges"), we can safely infer them from structure.
    const stack = [{ node: root, parentId: null, index: null }];
    while (stack.length) {
        const cur = stack.pop();
        const node = cur ? cur.node : null;
        if (!node || node.id == null) continue;
        try {
            if (cur && cur.parentId != null && typeof node.parentId === 'undefined') node.parentId = String(cur.parentId);
            if (cur && typeof cur.index === 'number' && !Number.isNaN(cur.index) && typeof node.index !== 'number') node.index = cur.index;
        } catch (_) { }
        map.set(String(node.id), node);
        if (Array.isArray(node.children) && node.children.length) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], parentId: node.id, index: i });
            }
        }
    }
    return map;
}

function clearCanvasLazyChangeHints(reason = '') {
    canvasLazyChangeHints = {
        updatedAt: 0,
        added: new Set(),
        modified: new Set(),
        moved: new Set(),
        movedInfo: new Map(),
        deletedCount: 0,
        hasAny: false
    };
    if (reason) {}
}

function clearIncrementalDeletedSnapshots(reason = '') {
    incrementalDeletedNodeSnapshots = new Map();
    incrementalDeletedChildrenByParent = new Map();
    if (reason) {}
}

function cacheDeletedSnapshotForLazyRender(id, removeInfo) {
    if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    if (!id || !removeInfo) return;

    const sid = String(id);
    const sourceNode = removeInfo.node || removeInfo.nodeSnapshot || null;
    const raw = cloneBookmarkNodeSnapshot(sourceNode);
    if (!raw) return;

    raw.id = sid;
    if (typeof raw.parentId === 'undefined' || raw.parentId === null) {
        if (typeof removeInfo.parentId !== 'undefined' && removeInfo.parentId !== null) {
            raw.parentId = String(removeInfo.parentId);
        }
    }
    if (typeof raw.index !== 'number' && typeof removeInfo.index === 'number') {
        raw.index = removeInfo.index;
    }

    try {
        const previous = incrementalDeletedNodeSnapshots.get(sid);
        const prevParentId = previous && typeof previous.parentId !== 'undefined' && previous.parentId !== null
            ? String(previous.parentId)
            : '';
        if (prevParentId && incrementalDeletedChildrenByParent.has(prevParentId)) {
            const prevBucket = incrementalDeletedChildrenByParent.get(prevParentId);
            if (prevBucket) {
                prevBucket.delete(sid);
                if (prevBucket.size === 0) incrementalDeletedChildrenByParent.delete(prevParentId);
            }
        }
    } catch (_) { }

    incrementalDeletedNodeSnapshots.set(sid, raw);

    const parentId = (typeof raw.parentId !== 'undefined' && raw.parentId !== null)
        ? String(raw.parentId)
        : '';
    if (!parentId) return;

    let bucket = incrementalDeletedChildrenByParent.get(parentId);
    if (!bucket) {
        bucket = new Map();
        incrementalDeletedChildrenByParent.set(parentId, bucket);
    }
    bucket.set(sid, raw);
}

function mergeLazyChildrenWithDeletedSnapshots(parentId, baseChildren) {
    const merged = Array.isArray(baseChildren) ? baseChildren.slice() : [];
    return merged;
}

function hydrateDeletedSnapshotCachesFromChangeMap(changeMap) {
    if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    if (!(changeMap instanceof Map) || changeMap.size === 0) return;

    try {
        changeMap.forEach((change, id) => {
            if (!id || !change || typeof change.type !== 'string' || !change.type.includes('deleted')) return;
            const del = change.deleted || {};
            const nodeSnapshot = del.nodeSnapshot || del.node || null;
            if (!nodeSnapshot) return;

            cacheDeletedSnapshotForLazyRender(id, {
                parentId: del.oldParentId,
                index: del.oldIndex,
                nodeSnapshot
            });
        });
    } catch (_) { }
}

function mergeDeletedSnapshotsIntoTreeForRender(tree, changeMap) {
    if (!(changeMap instanceof Map) || changeMap.size === 0) return tree;
    if (!tree || !Array.isArray(tree) || !tree[0]) return tree;

    let hasDeletedSnapshot = false;
    try {
        changeMap.forEach((change) => {
            if (hasDeletedSnapshot) return;
            const type = change && typeof change.type === 'string' ? change.type : '';
            const del = change && change.deleted ? change.deleted : null;
            if (type.includes('deleted') && del && (del.nodeSnapshot || del.node)) {
                hasDeletedSnapshot = true;
            }
        });
    } catch (_) { }
    if (!hasDeletedSnapshot) return tree;

    let outTree = tree;
    try {
        outTree = JSON.parse(JSON.stringify(tree));
    } catch (_) {
        return tree;
    }
    if (!outTree || !Array.isArray(outTree) || !outTree[0]) return tree;

    const idx = buildTreeIndexFromRoot(outTree[0]);
    if (!(idx instanceof Map)) return tree;

    const insertNodeIntoIndex = (node) => {
        if (!node || typeof node.id === 'undefined' || node.id === null) return;
        const sid = String(node.id);
        idx.set(sid, node);
        if (Array.isArray(node.children)) {
            node.children.forEach((child) => {
                if (child && (typeof child.parentId === 'undefined' || child.parentId === null)) {
                    child.parentId = sid;
                }
                insertNodeIntoIndex(child);
            });
        }
    };

    try {
        changeMap.forEach((change, id) => {
            if (!id || !change || typeof change.type !== 'string' || !change.type.includes('deleted')) return;
            const del = change.deleted || {};
            const sourceNode = del.nodeSnapshot || del.node || null;
            const snapshotNode = cloneBookmarkNodeSnapshot(sourceNode);
            if (!snapshotNode) return;

            const sid = String(id);
            snapshotNode.id = sid;
            if (typeof snapshotNode.parentId === 'undefined' || snapshotNode.parentId === null) {
                if (del.oldParentId != null) snapshotNode.parentId = String(del.oldParentId);
            }
            if (typeof snapshotNode.index !== 'number' && typeof del.oldIndex === 'number') {
                snapshotNode.index = del.oldIndex;
            }

            const parentId = (typeof snapshotNode.parentId !== 'undefined' && snapshotNode.parentId !== null)
                ? String(snapshotNode.parentId)
                : '';
            if (!parentId) return;
            const parent = idx.get(parentId);
            if (!parent) return;
            if (!Array.isArray(parent.children)) parent.children = [];
            if (parent.children.some((child) => String(child?.id) === sid)) return;

            const targetIndex = (typeof snapshotNode.index === 'number') ? snapshotNode.index : Number.POSITIVE_INFINITY;
            if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= parent.children.length) {
                parent.children.push(snapshotNode);
            } else {
                let insertAt = parent.children.length;
                for (let i = 0; i < parent.children.length; i++) {
                    const currentIndex = (typeof parent.children[i]?.index === 'number')
                        ? parent.children[i].index
                        : Number.POSITIVE_INFINITY;
                    if (currentIndex >= targetIndex) {
                        insertAt = i;
                        break;
                    }
                }
                parent.children.splice(insertAt, 0, snapshotNode);
            }

            insertNodeIntoIndex(snapshotNode);
        });
    } catch (_) {
        return tree;
    }

    return outTree;
}

function buildFingerprintKeyFromChangeItem(item) {
    if (!item) return '';
    const path = typeof item.path === 'string' ? item.path : '';
    const title = typeof item.title === 'string' ? item.title : '';
    const url = typeof item.url === 'string' ? item.url : '';
    return `B:${path}|${title}|${url}`;
}

function getFolderPathFromBreadcrumb(bc) {
    if (!bc) return '';
    const parts = bc.split(' > ').map(s => s.trim()).filter(Boolean);
    const rootTitle = cachedCurrentTree && cachedCurrentTree[0] ? cachedCurrentTree[0].title : '';
    if (rootTitle && parts[0] === rootTitle) parts.shift();
    if (parts.length <= 1) return '';
    parts.pop(); // 移除当前节点名
    return parts.join('/');
}

function buildFingerprintKeyForBookmarkNode(node) {
    if (!node || !node.url) return '';
    const bc = cachedCurrentTree ? getNamedPathFromTree(cachedCurrentTree, node.id) : '';
    const folderPath = getFolderPathFromBreadcrumb(bc);
    return `B:${folderPath}|${node.title || ''}|${node.url || ''}`;
}

function formatFingerprintPathToSlash(path) {
    if (typeof path !== 'string' || !path.length) return '/';
    return path.startsWith('/') ? path : `/${path}`;
}

async function ensureCanvasLazyChangeHints(forceRefresh = false) {
    if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return null;
    const now = Date.now();
    if (!forceRefresh && canvasLazyChangeHints.updatedAt && (now - canvasLazyChangeHints.updatedAt) < CANVAS_LAZY_CHANGE_HINT_TTL_MS) {
        return canvasLazyChangeHints;
    }
    if (canvasLazyChangeHintsPromise) return canvasLazyChangeHintsPromise;

    canvasLazyChangeHintsPromise = (async () => {
        try {
            const changeData = null;
            const added = new Set();
            const modified = new Set();
            const moved = new Set();
            const movedInfo = new Map();
            let deletedCount = 0;

            const stats = changeData && changeData.stats ? changeData.stats : null;
            const statsHasAny = !!(stats && (
                stats.bookmarkDiff || stats.folderDiff ||
                stats.bookmarkMoved || stats.folderMoved ||
                stats.bookmarkModified || stats.folderModified
            ));

            if (changeData && (changeData.hasChanges || statsHasAny)) {
                if (Array.isArray(changeData.added)) {
                    changeData.added.forEach(item => {
                        const key = buildFingerprintKeyFromChangeItem(item);
                        if (key) added.add(key);
                    });
                }
                if (Array.isArray(changeData.modified)) {
                    changeData.modified.forEach(item => {
                        const key = buildFingerprintKeyFromChangeItem(item);
                        if (key) modified.add(key);
                    });
                }
                if (Array.isArray(changeData.moved)) {
                    changeData.moved.forEach(item => {
                        const key = buildFingerprintKeyFromChangeItem(item);
                        if (key) {
                            moved.add(key);
                            if (item.oldPath) movedInfo.set(key, { oldPath: item.oldPath });
                        }
                    });
                }
                if (Array.isArray(changeData.deleted)) {
                    deletedCount = changeData.deleted.length;
                }
            }

            canvasLazyChangeHints = {
                updatedAt: Date.now(),
                added,
                modified,
                moved,
                movedInfo,
                deletedCount,
                hasAny: added.size > 0 || modified.size > 0 || moved.size > 0 || deletedCount > 0 || statsHasAny
            };
            return canvasLazyChangeHints;
        } catch (e) {
            console.warn('[Canvas变化提示] 生成失败，回退为空:', e);
            canvasLazyChangeHints = {
                updatedAt: Date.now(),
                added: new Set(),
                modified: new Set(),
                moved: new Set(),
                movedInfo: new Map(),
                deletedCount: 0,
                hasAny: false
            };
            return canvasLazyChangeHints;
        } finally {
            canvasLazyChangeHintsPromise = null;
        }
    })();

    return canvasLazyChangeHintsPromise;
}

function ensureCanvasLazyLegend(treeContainer) {
    const container = treeContainer || document.getElementById('bookmarkTree');
    if (!container) return;
    container.querySelectorAll('.tree-legend').forEach((legend) => {
        try { legend.remove(); } catch (_) { }
    });
}

// 生成书签树指纹（快速哈希）
function getTreeFingerprint(tree) {
    if (!tree || !tree[0]) return '';

    // 只提取关键信息生成指纹
    const extractKey = (node) => {
        const key = {
            i: node.id,
            t: node.title,
            u: node.url,
            p: node.parentId,
            x: node.index
        };
        if (node.children) {
            key.c = node.children.map(extractKey);
        }
        return key;
    };

    return JSON.stringify(extractKey(tree[0]));
}

// 判断是否应该跳过 forceRefresh（缓存和指纹都完好，说明没有任何变化事件清除过它们）
// 所有真正的书签变化路径（增删改移/导入/批量操作）都会清除 lastTreeFingerprint 和 cachedTreeData。
// 如果两者都还在，说明上次渲染后没有发生任何变化，无需重新渲染。
// 这个判断是纯内存检查，零开销，不调用 Chrome API。
function shouldSkipForceTreeRefreshForNoNetChange() {
    return !!(lastTreeFingerprint && cachedTreeData);
}

// 从 background.js 获取书签树快照（优先走缓存，失败再直连 getTree）
async function getBookmarkTreeSnapshot() {
    try {
        const bridge = window.CanvasProtocolBridge;
        if (bridge && typeof bridge.readPermanentTreeSnapshotFromBcs === 'function') {
            const tree = await bridge.readPermanentTreeSnapshotFromBcs({
                assumeCleanWhenMissingState: true
            });
            if (Array.isArray(tree) && tree.length) {
                return { tree, version: null };
            }
        }
    } catch (e) {
        console.warn('[TreeSnapshot] 读取永久 JSON 真相源失败，回退后台快照:', e);
    }
    try {
        if (browserAPI && browserAPI.runtime && typeof browserAPI.runtime.sendMessage === 'function') {
            const resp = await browserAPI.runtime.sendMessage({ action: 'getBookmarkSnapshot' });
            if (resp && resp.success && Array.isArray(resp.tree)) {
                return { tree: resp.tree, version: resp.version ?? null };
            }
        }
    } catch (e) {
        console.warn('[TreeSnapshot] 获取后台快照失败，回退直连:', e);
    }
    const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
    return { tree, version: null };
}

let permanentMainStorageSyncTimer = null;
function schedulePermanentMainStorageSyncFromChrome(reason = '', delayMs = 180) {
    try {
        if (permanentMainStorageSyncTimer) clearTimeout(permanentMainStorageSyncTimer);
        permanentMainStorageSyncTimer = setTimeout(async () => {
            permanentMainStorageSyncTimer = null;
            const bridge = window.CanvasProtocolBridge;
            if (!bridge || typeof bridge.syncPermanentMainTreeFromChromeBookmarks !== 'function') return;
            bridge.syncPermanentMainTreeFromChromeBookmarks({
                reason,
                assumeClean: false
            }).then((syncResult) => {
                if (syncResult && syncResult.skipped) {
                    ;
                    return;
                }
                if (!syncResult) return;
                try {
                    if (typeof bridge.clearPermanentTreeRenderCaches === 'function') {
                        bridge.clearPermanentTreeRenderCaches();
                    }
                } catch (_) { }
                if (currentView === 'canvas') {
                    try { scheduleBulkBookmarkMutationTreeRefresh('post-main-storage-sync', 120); } catch (_) { }
                }
            }).catch((error) => {
                console.warn('[Permanent JSON] sync from Chrome bookmarks failed:', error);
            });
        }, Math.max(0, Number(delayMs) || 0));
    } catch (_) { }
}

function normalizePermanentBookmarkBcsEvents(eventsInput) {
    return (Array.isArray(eventsInput) ? eventsInput : [eventsInput])
        .filter(event => event && typeof event === 'object' && event.type && event.id)
        .map(event => ({
            ...event,
            id: String(event.id)
        }));
}

async function applyPermanentBookmarkEventsToBcsIncremental(eventsInput, reason = '') {
    const events = normalizePermanentBookmarkBcsEvents(eventsInput);
    if (!events.length) return true;
    const normalizedReason = String(reason || 'bookmark-event');
    const bridge = window.CanvasProtocolBridge;
    if (!bridge || typeof bridge.applyPermanentBookmarkEventsToBcs !== 'function') {
        schedulePermanentMainStorageSyncFromChrome(`${normalizedReason}-bcs-bridge-missing`, 0);
        return false;
    }
    try {
        const result = await bridge.applyPermanentBookmarkEventsToBcs(events, {
            reason: normalizedReason,
            assumeClean: false
        });
        if (result && result.changed && typeof bridge.clearPermanentTreeRenderCaches === 'function') {
            try { bridge.clearPermanentTreeRenderCaches(); } catch (_) { }
        }
        return true;
    } catch (error) {
        console.warn('[Permanent JSON] incremental BCS patch failed, fallback to Chrome sync:', normalizedReason, error);
        schedulePermanentMainStorageSyncFromChrome(`${normalizedReason}-bcs-incremental-fallback`, 0);
        if (currentView === 'canvas') {
            try { scheduleCachedCurrentTreeSnapshotRefresh(`${normalizedReason}-bcs-incremental-fallback`, 120); } catch (_) { }
            try { scheduleBulkBookmarkMutationTreeRefresh(`${normalizedReason}-bcs-incremental-fallback`, 900); } catch (_) { }
        }
        return false;
    }
}

// Canvas 永久栏目懒加载：需要依赖 cachedCurrentTree 来按需加载 folder children。
// 若只做 DOM 增量更新但不刷新 cachedCurrentTree，则在“展开/加载更多”时可能被旧快照覆盖，
// 造成“刷新/展开后移动效果消失 / 节点跑回去”的错觉。
let pendingTreeSnapshotRefreshTimer = null;
let treeSnapshotRefreshing = false;
let treeSnapshotRefreshQueued = false;

async function refreshCachedCurrentTreeSnapshot(reason = '') {
    if (!((currentView === 'canvas') && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    if (treeSnapshotRefreshing) {
        treeSnapshotRefreshQueued = true;
        return;
    }
    treeSnapshotRefreshing = true;
    try {
        const snapshot = await getBookmarkTreeSnapshot();
        if (snapshot && Array.isArray(snapshot.tree)) {
            cachedCurrentTree = snapshot.tree;
            cachedCurrentTreeIndex = null;
            cachedRenderTreeIndex = null;
            try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            if (typeof snapshot.version !== 'undefined') {
                lastTreeSnapshotVersion = snapshot.version;
            }
            ;
        }
    } catch (e) {
        console.warn('[TreeSnapshot] 刷新 cachedCurrentTree 失败:', e);
    } finally {
        treeSnapshotRefreshing = false;
        if (treeSnapshotRefreshQueued) {
            treeSnapshotRefreshQueued = false;
            refreshCachedCurrentTreeSnapshot('queued').catch(() => { });
        }
    }
}

function scheduleCachedCurrentTreeSnapshotRefresh(reason = '', delayMs = 300) {
    if (!((currentView === 'canvas') && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    if (pendingTreeSnapshotRefreshTimer) clearTimeout(pendingTreeSnapshotRefreshTimer);
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    pendingTreeSnapshotRefreshTimer = setTimeout(() => {
        pendingTreeSnapshotRefreshTimer = null;
        refreshCachedCurrentTreeSnapshot(reason).catch(() => { });
    }, safeDelay);
}

function applyIncrementalMoveToCachedCurrentTree(id, moveInfo) {
    try {
        if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id || !moveInfo || typeof moveInfo.parentId === 'undefined' || typeof moveInfo.oldParentId === 'undefined') return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const keyId = String(id);
        const movedNode = index.get(keyId);
        const oldParent = index.get(String(moveInfo.oldParentId));
        const newParent = index.get(String(moveInfo.parentId));
        if (!movedNode || !oldParent || !newParent) return false;

        const oldChildren = Array.isArray(oldParent.children) ? oldParent.children : [];
        oldParent.children = oldChildren.filter(child => String(child?.id) !== keyId);

        const newChildren = Array.isArray(newParent.children) ? newParent.children : [];
        const filteredNew = newChildren.filter(child => String(child?.id) !== keyId);
        const insertIndex = (typeof moveInfo.index === 'number')
            ? Math.max(0, Math.min(moveInfo.index, filteredNew.length))
            : filteredNew.length;
        filteredNew.splice(insertIndex, 0, movedNode);
        newParent.children = filteredNew;

        // 更新节点自身的父信息（供路径/懒加载逻辑使用）
        movedNode.parentId = String(moveInfo.parentId);
        if (typeof moveInfo.index === 'number') movedNode.index = moveInfo.index;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        // 静默失败：最终会由 refreshCachedCurrentTreeSnapshot() 兜底
        return false;
    }
}

function applyIncrementalCreateToCachedCurrentTree(id, bookmark) {
    try {
        if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id || !bookmark || typeof bookmark.parentId === 'undefined') return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const parent = index.get(String(bookmark.parentId));
        if (!parent) return false;

        const nodeId = String(id);
        const children = Array.isArray(parent.children) ? parent.children.filter(child => String(child?.id) !== nodeId) : [];
        const insertIndex = (typeof bookmark.index === 'number')
            ? Math.max(0, Math.min(bookmark.index, children.length))
            : children.length;

        const newNode = {
            id: nodeId,
            title: bookmark.title || '',
            url: bookmark.url || undefined,
            parentId: String(bookmark.parentId),
            index: (typeof bookmark.index === 'number') ? bookmark.index : insertIndex
        };
        if (!bookmark.url) newNode.children = [];

        children.splice(insertIndex, 0, newNode);
        parent.children = children;

        if (cachedCurrentTreeIndex instanceof Map) {
            cachedCurrentTreeIndex.set(nodeId, newNode);
        }
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        // 静默失败：最终会由 refreshCachedCurrentTreeSnapshot() 兜底
        return false;
    }
}

function applyIncrementalRemoveFromCachedCurrentTree(id, removeInfo) {
    try {
        if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id) return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const key = String(id);
        const node = index.get(key);
        const parentId = (node && typeof node.parentId !== 'undefined')
            ? node.parentId
            : (removeInfo && typeof removeInfo.parentId !== 'undefined'
                ? removeInfo.parentId
                : (removeInfo && removeInfo.node && typeof removeInfo.node.parentId !== 'undefined'
                    ? removeInfo.node.parentId
                    : null));
        if (!parentId) return false;
        const parent = index.get(String(parentId));
        if (!parent || !Array.isArray(parent.children)) return false;
        parent.children = parent.children.filter(child => String(child?.id) !== key);

        cachedCurrentTreeIndex = null;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        // 静默失败：最终会由 refreshCachedCurrentTreeSnapshot() 兜底
        return false;
    }
}

function applyIncrementalChangeToCachedCurrentTree(id, changeInfo) {
    try {
        if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id || !changeInfo) return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const node = index.get(String(id));
        if (!node) return false;
        if (typeof changeInfo.title !== 'undefined') node.title = changeInfo.title;
        if (typeof changeInfo.url !== 'undefined') node.url = changeInfo.url || undefined;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        // 静默失败：最终会由 refreshCachedCurrentTreeSnapshot() 兜底
        return false;
    }
}

function escapePermanentDomPatchId(id) {
    const value = String(id || '');
    try {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    } catch (_) { }
    return value.replace(/["\\]/g, '\\$&');
}

function collectPermanentTreeDomPatchTargets() {
    const trees = [];
    const seen = new Set();
    const pushTree = (tree) => {
        if (!tree || seen.has(tree)) return;
        seen.add(tree);
        trees.push(tree);
    };
    try {
        if (currentView !== 'canvas') return trees;
    } catch (_) {
        return trees;
    }
    try {
        pushTree(document.getElementById('bookmarkTree'));
        const canvasContent = document.getElementById('canvasContent');
        const scope = canvasContent || document;
        scope.querySelectorAll('.permanent-bookmark-section .bookmark-tree').forEach(pushTree);
    } catch (_) { }
    return trees;
}

function findPermanentTreeItemByChromeId(tree, id) {
    if (!tree || !id) return null;
    try {
        return tree.querySelector(`.tree-item[data-node-id="${escapePermanentDomPatchId(id)}"]`);
    } catch (_) {
        return null;
    }
}

function findPermanentTreeNodeByChromeId(tree, id) {
    const item = findPermanentTreeItemByChromeId(tree, id);
    return item && typeof item.closest === 'function' ? item.closest('.tree-node') : null;
}

function getPermanentCachedNodeById(id) {
    try {
        const index = getCachedCurrentTreeIndex();
        return index ? index.get(String(id)) : null;
    } catch (_) {
        return null;
    }
}

function renderPermanentDomPatchNode(node, level) {
    if (!node || typeof renderTreeNodeWithChanges !== 'function') return null;
    try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTreeNodeWithChanges(node, Math.max(0, Number(level) || 0), 50, new Set());
        return tempDiv.querySelector(':scope > .tree-node') || tempDiv.firstElementChild;
    } catch (_) {
        return null;
    }
}

function bindPermanentDomPatchNode(treeNode) {
    if (!treeNode) return;
    try {
        if (typeof attachDragEvents === 'function') attachDragEvents(treeNode);
    } catch (_) { }
}

function getPermanentDirectTreeNodes(container) {
    if (!container) return [];
    try {
        return Array.from(container.querySelectorAll(':scope > .tree-node'));
    } catch (_) {
        return Array.from(container.children || []).filter(el => el && el.classList && el.classList.contains('tree-node'));
    }
}

function findPermanentChildrenContainerByParentId(tree, parentId) {
    const parentItem = findPermanentTreeItemByChromeId(tree, parentId);
    const parentNode = parentItem && typeof parentItem.closest === 'function' ? parentItem.closest('.tree-node') : null;
    const childrenContainer = parentNode ? parentNode.querySelector(':scope > .tree-children') : null;
    return { parentItem, parentNode, childrenContainer };
}

function updatePermanentTreeNodeLevels(treeNode, level) {
    if (!treeNode) return;
    const safeLevel = Math.max(0, Number(level) || 0);
    try {
        const item = treeNode.querySelector(':scope > .tree-item[data-node-id]');
        if (item && item.dataset) item.dataset.nodeLevel = String(safeLevel);
        const children = treeNode.querySelector(':scope > .tree-children');
        if (!children) return;
        getPermanentDirectTreeNodes(children).forEach(childNode => {
            updatePermanentTreeNodeLevels(childNode, safeLevel + 1);
        });
    } catch (_) { }
}

function refreshPermanentLoadMoreState(tree, parentId) {
    const { parentItem, childrenContainer } = findPermanentChildrenContainerByParentId(tree, parentId);
    if (!parentItem || !childrenContainer) return;
    const parentNode = getPermanentCachedNodeById(parentId);
    const childCount = parentNode && Array.isArray(parentNode.children) ? parentNode.children.length : 0;
    try {
        parentItem.dataset.hasChildren = childCount > 0 ? 'true' : 'false';
        parentItem.dataset.childCount = String(childCount);
        if (childCount === 0) parentItem.dataset.childrenLoaded = 'true';
        if (parentItem.dataset.childrenLoaded !== 'true') return;

        const directNodes = getPermanentDirectTreeNodes(childrenContainer);
        const currentRendered = directNodes.length;

        // 移除旧的操作按钮容器和单独的 load-more 按钮
        const oldActions = childrenContainer.querySelector('.tree-lazy-actions-container');
        if (oldActions) oldActions.remove();
        const oldLoadMore = childrenContainer.querySelector(':scope > .tree-load-more');
        if (oldLoadMore) oldLoadMore.remove();

        // 附加更新后的操作按钮容器
        const lazyActions = createPermanentFolderLazyActions(parentId, childCount, currentRendered);
        if (lazyActions) {
            childrenContainer.appendChild(lazyActions);
        }
    } catch (_) { }
}

function insertPermanentDomPatchNodeAtIndex(childrenContainer, treeNode, index) {
    if (!childrenContainer || !treeNode) return false;
    try {
        const directNodes = getPermanentDirectTreeNodes(childrenContainer).filter(node => node !== treeNode);
        const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : directNodes.length;
        const referenceNode = safeIndex < directNodes.length
            ? directNodes[safeIndex]
            : (childrenContainer.querySelector(':scope > .tree-lazy-actions-container')
                || childrenContainer.querySelector(':scope > .tree-load-more'));
        childrenContainer.insertBefore(treeNode, referenceNode || null);
        bindPermanentDomPatchNode(treeNode);
        return true;
    } catch (_) {
        return false;
    }
}

function isPermanentChildrenContainerReadyForDomPatch(parentItem, childrenContainer) {
    if (!parentItem || !childrenContainer) return false;
    try {
        return parentItem.dataset.childrenLoaded === 'true';
    } catch (_) {
        return false;
    }
}

function refreshPermanentSharedSourceAfterDomPatch(reason = '') {
    try {
        refreshSharedPermanentTreeCopySourceData(reason || 'dom-patch');
    } catch (_) { }
}

function applyPermanentChangeDomPatch(id, changeInfo) {
    try {
        const targets = collectPermanentTreeDomPatchTargets();
        if (!targets.length) return true;
        const cachedNode = getPermanentCachedNodeById(id);
        let failed = false;
        targets.forEach(tree => {
            if (failed) return;
            const item = findPermanentTreeItemByChromeId(tree, id);
            if (!item) return;
            const treeNode = item.closest('.tree-node');
            if (!treeNode) {
                failed = true;
                return;
            }
            const isBookmark = item.dataset && item.dataset.nodeType === 'bookmark';
            if (isBookmark && cachedNode) {
                const level = parseInt(item.dataset.nodeLevel || '0', 10) || 0;
                const replacement = renderPermanentDomPatchNode(cachedNode, level);
                if (!replacement) {
                    failed = true;
                    return;
                }
                treeNode.replaceWith(replacement);
                bindPermanentDomPatchNode(replacement);
                return;
            }
            if (typeof changeInfo.title !== 'undefined') {
                item.dataset.nodeTitle = String(changeInfo.title || '');
                const label = item.querySelector(':scope > .tree-label');
                if (label) label.textContent = String(changeInfo.title || '');
            }
            if (typeof changeInfo.url !== 'undefined') {
                item.dataset.nodeUrl = String(changeInfo.url || '');
                const link = item.querySelector(':scope > a.tree-bookmark-link');
                if (link) link.setAttribute('href', String(changeInfo.url || ''));
            }
        });
        return !failed;
    } catch (_) {
        return false;
    }
}

function applyPermanentRemoveDomPatch(id, removeInfo) {
    try {
        const targets = collectPermanentTreeDomPatchTargets();
        if (!targets.length) return true;
        const parentId = removeInfo && typeof removeInfo.parentId !== 'undefined'
            ? String(removeInfo.parentId)
            : (removeInfo && removeInfo.node && typeof removeInfo.node.parentId !== 'undefined' ? String(removeInfo.node.parentId) : '');
        let failed = false;
        targets.forEach(tree => {
            if (failed) return;
            const treeNode = findPermanentTreeNodeByChromeId(tree, id);
            if (treeNode) {
                try { treeNode.remove(); } catch (_) { failed = true; return; }
            }
            if (parentId) refreshPermanentLoadMoreState(tree, parentId);
        });
        return !failed;
    } catch (_) {
        return false;
    }
}

function applyPermanentCreateDomPatch(id, bookmark) {
    try {
        const targets = collectPermanentTreeDomPatchTargets();
        if (!targets.length) return true;
        const parentId = bookmark && typeof bookmark.parentId !== 'undefined' ? String(bookmark.parentId) : '';
        if (!parentId) return false;
        const cachedNode = getPermanentCachedNodeById(id);
        if (!cachedNode) return false;
        const insertIndex = typeof bookmark.index === 'number' ? bookmark.index : cachedNode.index;
        let failed = false;
        targets.forEach(tree => {
            if (failed) return;
            const { parentItem, childrenContainer } = findPermanentChildrenContainerByParentId(tree, parentId);
            if (!parentItem) return;
            if (parentItem.dataset && parentItem.dataset.nodeType === 'folder' && !childrenContainer) {
                const parentNode = getPermanentCachedNodeById(parentId);
                const childCount = parentNode && Array.isArray(parentNode.children) ? parentNode.children.length : 0;
                parentItem.dataset.hasChildren = childCount > 0 ? 'true' : 'false';
                parentItem.dataset.childCount = String(childCount);
                return;
            }
            refreshPermanentLoadMoreState(tree, parentId);
            if (!isPermanentChildrenContainerReadyForDomPatch(parentItem, childrenContainer)) return;
            const directNodes = getPermanentDirectTreeNodes(childrenContainer);
            const hasLazyMore = !!(childrenContainer.querySelector(':scope > .tree-lazy-actions-container .tree-load-more')
                || childrenContainer.querySelector(':scope > .tree-load-more'));
            if (hasLazyMore && Number(insertIndex) > directNodes.length) return;
            const parentLevel = parseInt(parentItem.dataset.nodeLevel || '0', 10) || 0;
            const treeNode = renderPermanentDomPatchNode(cachedNode, parentLevel + 1);
            if (!treeNode || !insertPermanentDomPatchNodeAtIndex(childrenContainer, treeNode, insertIndex)) {
                failed = true;
                return;
            }
            refreshPermanentLoadMoreState(tree, parentId);
        });
        return !failed;
    } catch (_) {
        return false;
    }
}

function applyPermanentMoveDomPatch(id, moveInfo) {
    try {
        const targets = collectPermanentTreeDomPatchTargets();
        if (!targets.length) return true;
        if (!moveInfo || typeof moveInfo.parentId === 'undefined') return false;
        const newParentId = String(moveInfo.parentId);
        const oldParentId = typeof moveInfo.oldParentId !== 'undefined' ? String(moveInfo.oldParentId) : '';
        const cachedNode = getPermanentCachedNodeById(id);
        if (!cachedNode) return false;
        let failed = false;
        targets.forEach(tree => {
            if (failed) return;
            let sourceNode = findPermanentTreeNodeByChromeId(tree, id);
            const { parentItem, childrenContainer } = findPermanentChildrenContainerByParentId(tree, newParentId);
            if (parentItem && parentItem.dataset && parentItem.dataset.nodeType === 'folder' && !childrenContainer) {
                if (sourceNode && sourceNode.parentElement) {
                    try { sourceNode.parentElement.removeChild(sourceNode); } catch (_) { failed = true; return; }
                }
                if (oldParentId) refreshPermanentLoadMoreState(tree, oldParentId);
                const parentNode = getPermanentCachedNodeById(newParentId);
                const childCount = parentNode && Array.isArray(parentNode.children) ? parentNode.children.length : 0;
                parentItem.dataset.hasChildren = childCount > 0 ? 'true' : 'false';
                parentItem.dataset.childCount = String(childCount);
                return;
            }
            const canInsert = parentItem && isPermanentChildrenContainerReadyForDomPatch(parentItem, childrenContainer);
            if (sourceNode && sourceNode.parentElement) {
                try { sourceNode.parentElement.removeChild(sourceNode); } catch (_) { failed = true; return; }
            }
            if (oldParentId) refreshPermanentLoadMoreState(tree, oldParentId);
            if (!canInsert) {
                if (parentItem) refreshPermanentLoadMoreState(tree, newParentId);
                return;
            }
            const directNodes = getPermanentDirectTreeNodes(childrenContainer);
            const hasLazyMore = !!(childrenContainer.querySelector(':scope > .tree-lazy-actions-container .tree-load-more')
                || childrenContainer.querySelector(':scope > .tree-load-more'));
            const insertIndex = typeof moveInfo.index === 'number' ? moveInfo.index : cachedNode.index;
            if (hasLazyMore && Number(insertIndex) > directNodes.length) {
                refreshPermanentLoadMoreState(tree, newParentId);
                return;
            }
            if (!sourceNode) {
                const parentLevel = parseInt(parentItem.dataset.nodeLevel || '0', 10) || 0;
                sourceNode = renderPermanentDomPatchNode(cachedNode, parentLevel + 1);
            } else {
                const parentLevel = parseInt(parentItem.dataset.nodeLevel || '0', 10) || 0;
                updatePermanentTreeNodeLevels(sourceNode, parentLevel + 1);
            }
            if (!sourceNode || !insertPermanentDomPatchNodeAtIndex(childrenContainer, sourceNode, insertIndex)) {
                failed = true;
                return;
            }
            refreshPermanentLoadMoreState(tree, newParentId);
        });
        return !failed;
    } catch (_) {
        return false;
    }
}

function getCachedCurrentTreeIndex() {
    if (cachedCurrentTreeIndex) return cachedCurrentTreeIndex;
    if (!cachedCurrentTree || !cachedCurrentTree[0]) return null;
    cachedCurrentTreeIndex = buildTreeIndexFromRoot(cachedCurrentTree[0]);
    return cachedCurrentTreeIndex;
}

function getCachedRenderTreeIndex() {
    if (cachedRenderTreeIndex) return cachedRenderTreeIndex;
    try {
        if (window.__canvasRenderTreeIndex instanceof Map) {
            cachedRenderTreeIndex = window.__canvasRenderTreeIndex;
            return cachedRenderTreeIndex;
        }
    } catch (_) { }
    return null;
}

function getChangesPreviewTreeIndex() {
    try {
        if (window.__changesPreviewTreeIndex instanceof Map) return window.__changesPreviewTreeIndex;
    } catch (_) { }
    return null;
}

async function loadPermanentFolderChildrenLazy(parentId, childrenContainer, startIndex = 0, triggerBtn = null, isReadOnly = false) {
    try {
        if (!parentId || !childrenContainer) return;
        const treeRoot = childrenContainer.closest('.bookmark-tree') || document.getElementById('bookmarkTree') || document;
        const index = isReadOnly
            ? getChangesPreviewTreeIndex()
            : ((currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
                ? (getCachedRenderTreeIndex() || getCachedCurrentTreeIndex())
                : getCachedCurrentTreeIndex());
        const parentKey = String(parentId);
        let parent = index ? index.get(parentKey) : null;
        if (!parent && !isReadOnly) {
            parent = incrementalDeletedNodeSnapshots.get(parentKey) || null;
        }
        const baseChildren = (parent && Array.isArray(parent.children)) ? parent.children : [];
        const childrenForRender = (!isReadOnly && currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
            ? mergeLazyChildrenWithDeletedSnapshots(parentKey, baseChildren)
            : baseChildren;

        if (!childrenForRender.length) {
            const item = treeRoot.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`);
            if (item) {
                item.dataset.childrenLoaded = 'true';
                item.dataset.hasChildren = 'false';
            }
            if (triggerBtn) {
                try { triggerBtn.remove(); } catch (_) { }
            }
            return;
        }

        const item = treeRoot.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`);
        const level = item ? (parseInt(item.dataset.nodeLevel, 10) || 0) : 0;
        const nextLevel = level + 1;
        const underDeletedAncestor = false;
        const inheritedFolderChange = '';

        let batchSize = CANVAS_PERMANENT_TREE_CHILD_BATCH;
        if (startIndex === 0) {
            const treeRoot = childrenContainer.closest('.bookmark-tree');
            // 优先使用 DOM 快照记忆，其次使用持久化存储
            let memory = null;
            if (treeRoot && treeRoot._existingLoadedCounts) {
                memory = treeRoot._existingLoadedCounts[String(parentId)];
            }
            if (!memory) {
                const persistedCounts = loadPermanentLoadedCounts();
                memory = persistedCounts[String(parentId)] || null;
            }
            if (memory) {
                if (memory.fullyExpanded) {
                    batchSize = 999999;
                } else if (memory.count > 0) {
                    batchSize = Math.max(CANVAS_PERMANENT_TREE_CHILD_BATCH, memory.count);
                }
            }
        }
        const slice = childrenForRender.slice(startIndex, startIndex + batchSize);
        const visited = new Set([String(parentId)]);
        const html = slice.map(child => renderTreeNodeWithChanges(child, nextLevel, 50, visited, null, undefined, underDeletedAncestor, inheritedFolderChange)).join('');

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // 恢复子节点的选中状态
        if (typeof selectedNodes !== 'undefined' && selectedNodes && selectedNodes.size > 0) {
            tempDiv.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
                const nid = item.dataset.nodeId;
                if (nid && selectedNodes.has(nid)) {
                    item.classList.add('selected');
                }
            });
        }

        const frag = document.createDocumentFragment();
        while (tempDiv.firstChild) {
            frag.appendChild(tempDiv.firstChild);
        }

        if (startIndex === 0 && !triggerBtn) {
            childrenContainer.innerHTML = '';
        }

        // 插入到 lazy-actions 容器之前（若存在），或追加
        if (triggerBtn) {
            const actionsContainer = triggerBtn.closest('.tree-lazy-actions-container') || triggerBtn;
            if (actionsContainer.parentElement === childrenContainer) {
                childrenContainer.insertBefore(frag, actionsContainer);
            } else {
                childrenContainer.appendChild(frag);
            }
        } else {
            childrenContainer.appendChild(frag);
        }

        if (item) {
            item.dataset.childrenLoaded = 'true';
            item.dataset.hasChildren = 'true';
        }

        const nextStart = startIndex + slice.length;

        // 移除旧的操作按钮容器和单独 load-more 按钮
        try {
            const oldActions = childrenContainer.querySelector('.tree-lazy-actions-container');
            if (oldActions) oldActions.remove();
            const oldSingleBtn = childrenContainer.querySelector(':scope > .tree-load-more');
            if (oldSingleBtn) oldSingleBtn.remove();
        } catch (_) { }

        // 附加更新后的操作按钮容器（加载更多 + 全部展开 + 收起已加载）
        const lazyActions = createPermanentFolderLazyActions(parentId, childrenForRender.length, nextStart);
        if (lazyActions) {
            childrenContainer.appendChild(lazyActions);
        }
        // 懒加载插入新节点后：补绑定拖拽事件（内部拖拽排序/移动）
        try {
            // 仅对“刚插入的子树”补绑，避免每次懒加载都扫描整棵书签树
            if (typeof attachDragEvents === 'function' && !isReadOnly) {
                attachDragEvents(childrenContainer);
            }
        } catch (_) { }

        if (isReadOnly) {
            try {
                // 1. 禁用拖拽
                childrenContainer.querySelectorAll('[draggable="true"]').forEach(el => {
                    el.setAttribute('draggable', 'false');
                });
                // 2. 添加 dataset-readonly
                childrenContainer.querySelectorAll('.tree-item').forEach(el => {
                    el.dataset.readonly = 'true';
                });
                // 3. 移除右键菜单（如果有）
                childrenContainer.querySelectorAll('#bookmark-context-menu, .bookmark-context-menu').forEach(el => {
                    el.remove();
                });
            } catch (_) { }
        }

        // 懒加载完成后：检查新加载的子节点是否有需要恢复展开状态的
        // 注意：Canvas 永久栏目副本需要“按副本”独立恢复展开状态
        try {
            const treeForState = childrenContainer && childrenContainer.closest ? childrenContainer.closest('.bookmark-tree') : null;
            const savedState = __readTreeExpandStateFromStorage(treeForState);
            const suppressBootstrapRestore = __shouldSuppressCanvasBootstrapRestoreInHistory(treeForState || childrenContainer);
            if (savedState) {
                const expandedIds = JSON.parse(savedState);
                if (Array.isArray(expandedIds) && expandedIds.length > 0) {
                    const expandedSet = new Set(expandedIds);
                    // 只检查刚加载的子节点
                    childrenContainer.querySelectorAll(':scope > .tree-node > .tree-item[data-node-id]').forEach(item => {
                        if (__doesTreeExpandStateMatch(item, expandedSet)) {
                            const node = item.closest('.tree-node');
                            if (!node) return;
                            const children = node.querySelector(':scope > .tree-children');
                            const toggle = item.querySelector('.tree-toggle');
                            const icon = item.querySelector('.tree-icon.fas');
                            if (children && toggle) {
                                children.classList.add('expanded');
                                toggle.classList.add('expanded');
                                if (icon && icon.classList.contains('fa-folder')) {
                                    icon.classList.remove('fa-folder');
                                    icon.classList.add('fa-folder-open');
                                }
                                // 如果这个节点也需要懒加载，递归加载
                                if (__shouldHydratePermanentFolderChildren(item, children)) {
                                    if (suppressBootstrapRestore) {
                                        loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null, isReadOnly);
                                    } else {
                                        setTimeout(() => {
                                            loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null, isReadOnly);
                                        }, 10);
                                    }
                                }
                            }
                        }
                    });
                }
            }
        } catch (_) { }

        if (typeof window.__updateTraceHighlights === 'function') {
            window.__updateTraceHighlights();
        }

        // 持久化记忆：保存当前已加载的子项数
        try {
            updatePermanentLoadedCountEntry(parentId, nextStart, nextStart >= childrenForRender.length);
        } catch (_) { }
    } catch (e) {
        console.warn('[Canvas Tree Lazy] load children failed:', e);
    }
}
// 导出到全局，供拖拽模块在悬浮展开时调用
window.loadPermanentFolderChildrenLazy = loadPermanentFolderChildrenLazy;

// 创建永久栏目的懒加载操作按钮组（加载更多 + 全部展开 + 收起已加载）
function createPermanentFolderLazyActions(parentId, totalChildren, currentRendered) {
    const maxChildren = CANVAS_PERMANENT_TREE_CHILD_BATCH;
    const hasMore = totalChildren > currentRendered;
    const canCollapse = currentRendered > maxChildren;

    if (!hasMore && !canCollapse) return null;

    const isEn = currentLang === 'en';

    const btnContainer = document.createElement('div');
    btnContainer.className = 'tree-lazy-actions-container';

    if (hasMore) {
        const remaining = totalChildren - currentRendered;
        const willLoad = Math.min(maxChildren, remaining);

        // 剩余数量标签
        const infoSpan = document.createElement('span');
        infoSpan.className = 'tree-lazy-remaining-info';
        infoSpan.style.display = 'inline-flex';
        infoSpan.style.alignItems = 'center';
        infoSpan.style.fontSize = '12px';
        infoSpan.style.color = 'var(--text-secondary, #6b7280)';
        infoSpan.style.marginRight = '2px';
        infoSpan.style.userSelect = 'none';
        infoSpan.textContent = isEn ? `(${remaining} left)` : `(剩 ${remaining})`;
        btnContainer.appendChild(infoSpan);

        // 加载更多按钮
        const loadMoreBtn = document.createElement('div');
        loadMoreBtn.className = 'tree-load-more';
        loadMoreBtn.style.margin = '0';
        loadMoreBtn.style.flex = '1 1 auto';
        loadMoreBtn.dataset.parentId = String(parentId);
        loadMoreBtn.dataset.startIndex = String(currentRendered);
        loadMoreBtn.innerHTML = isEn
            ? `<i class="fas fa-plus"></i> <span>Load +${willLoad}</span>`
            : `<i class="fas fa-plus"></i> <span>展开 ${willLoad} 项</span>`;
        btnContainer.appendChild(loadMoreBtn);

        // 全部展开按钮
        const loadAllBtn = document.createElement('div');
        loadAllBtn.className = 'tree-load-all';
        loadAllBtn.style.margin = '0';
        loadAllBtn.style.flex = '1 1 auto';
        loadAllBtn.dataset.parentId = String(parentId);
        loadAllBtn.innerHTML = isEn
            ? `<i class="fas fa-expand-arrows-alt"></i> <span>Expand all</span>`
            : `<i class="fas fa-expand-arrows-alt"></i> <span>全部展开</span>`;
        btnContainer.appendChild(loadAllBtn);
    }

    if (canCollapse) {
        const loadLessBtn = document.createElement('div');
        loadLessBtn.className = 'tree-load-less';
        loadLessBtn.style.margin = '0';
        loadLessBtn.style.flex = '1 1 auto';
        loadLessBtn.dataset.parentId = String(parentId);
        loadLessBtn.innerHTML = isEn
            ? `<i class="fas fa-compress-alt"></i> <span>Collapse</span>`
            : `<i class="fas fa-compress-alt"></i> <span>收起已加载</span>`;
        btnContainer.appendChild(loadLessBtn);
    }

    return btnContainer;
}

// 全部展开永久栏目文件夹子节点
async function loadAllPermanentChildren(parentId, loadAllBtn, isReadOnly) {
    try {
        if (!parentId || !loadAllBtn) return false;
        const childrenContainer = loadAllBtn.closest('.tree-children');
        if (!childrenContainer) return false;

        const treeRoot = childrenContainer.closest('.bookmark-tree') || document.getElementById('bookmarkTree') || document;
        const index = isReadOnly
            ? getChangesPreviewTreeIndex()
            : ((currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
                ? (getCachedRenderTreeIndex() || getCachedCurrentTreeIndex())
                : getCachedCurrentTreeIndex());
        const parentKey = String(parentId);
        let parent = index ? index.get(parentKey) : null;
        if (!parent && !isReadOnly) {
            parent = incrementalDeletedNodeSnapshots.get(parentKey) || null;
        }
        const baseChildren = (parent && Array.isArray(parent.children)) ? parent.children : [];
        const childrenForRender = (!isReadOnly && currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
            ? mergeLazyChildrenWithDeletedSnapshots(parentKey, baseChildren)
            : baseChildren;

        if (!childrenForRender.length) return false;

        // 当前已渲染的数量
        const currentCount = childrenContainer.querySelectorAll(':scope > .tree-node').length;
        if (currentCount >= childrenForRender.length) return true;

        const item = treeRoot.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`);
        const level = item ? (parseInt(item.dataset.nodeLevel, 10) || 0) : 0;
        const nextLevel = level + 1;

        const fragment = document.createDocumentFragment();
        const visited = new Set([String(parentId)]);
        const htmls = [];
        for (let i = currentCount; i < childrenForRender.length; i++) {
            const child = childrenForRender[i];
            try {
                const html = renderTreeNodeWithChanges(child, nextLevel, 50, visited, null, undefined, false, '');
                htmls.push(html);
            } catch (_) { }
        }
        if (htmls.length > 0) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmls.join('');
            while (tempDiv.firstChild) {
                fragment.appendChild(tempDiv.firstChild);
            }
        }

        // 恢复选中状态
        if (typeof selectedNodes !== 'undefined' && selectedNodes && selectedNodes.size > 0) {
            fragment.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
                const nid = item.dataset.nodeId;
                if (nid && selectedNodes.has(nid)) {
                    item.classList.add('selected');
                }
            });
        }

        // 移除旧的操作按钮容器
        const oldActions = childrenContainer.querySelector('.tree-lazy-actions-container');
        if (oldActions) oldActions.remove();

        childrenContainer.appendChild(fragment);

        // 附加更新后的操作按钮容器（全展开后只会有"收起已加载"按钮）
        const lazyActions = createPermanentFolderLazyActions(parentId, childrenForRender.length, childrenForRender.length);
        if (lazyActions) {
            childrenContainer.appendChild(lazyActions);
        }

        // 绑定拖拽
        try {
            if (typeof attachDragEvents === 'function' && !isReadOnly) {
                attachDragEvents(childrenContainer);
            }
        } catch (_) { }

        // 恢复子文件夹展开状态
        try {
            const treeForState = childrenContainer.closest('.bookmark-tree');
            const savedState = __readTreeExpandStateFromStorage(treeForState);
            if (savedState) {
                const expandedIds = JSON.parse(savedState);
                if (Array.isArray(expandedIds) && expandedIds.length > 0) {
                    const expandedSet = new Set(expandedIds);
                    childrenContainer.querySelectorAll(':scope > .tree-node > .tree-item[data-node-id]').forEach(item => {
                        if (__doesTreeExpandStateMatch(item, expandedSet)) {
                            const node = item.closest('.tree-node');
                            if (!node) return;
                            const children = node.querySelector(':scope > .tree-children');
                            const toggle = item.querySelector('.tree-toggle');
                            const icon = item.querySelector('.tree-icon.fas');
                            if (children && toggle) {
                                children.classList.add('expanded');
                                toggle.classList.add('expanded');
                                if (icon && icon.classList.contains('fa-folder')) {
                                    icon.classList.remove('fa-folder');
                                    icon.classList.add('fa-folder-open');
                                }
                                if (__shouldHydratePermanentFolderChildren(item, children)) {
                                    loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null, isReadOnly);
                                }
                            }
                        }
                    });
                }
            }
        } catch (_) { }

        if (typeof window.__updateTraceHighlights === 'function') {
            window.__updateTraceHighlights();
        }

        // 持久化记忆：标记全部展开
        try {
            updatePermanentLoadedCountEntry(parentId, childrenForRender.length, true);
        } catch (_) { }

        return true;
    } catch (e) {
        console.warn('[Canvas Permanent Tree Lazy] loadAll failed:', e);
        return false;
    }
}

// 收起永久栏目文件夹已加载项到初始大小
async function collapsePermanentFolderChildren(parentId, childrenContainer, isReadOnly) {
    try {
        if (!parentId || !childrenContainer) return false;

        const treeRoot = childrenContainer.closest('.bookmark-tree') || document.getElementById('bookmarkTree') || document;
        const index = isReadOnly
            ? getChangesPreviewTreeIndex()
            : ((currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
                ? (getCachedRenderTreeIndex() || getCachedCurrentTreeIndex())
                : getCachedCurrentTreeIndex());
        const parentKey = String(parentId);
        let parent = index ? index.get(parentKey) : null;
        if (!parent && !isReadOnly) {
            parent = incrementalDeletedNodeSnapshots.get(parentKey) || null;
        }
        const baseChildren = (parent && Array.isArray(parent.children)) ? parent.children : [];
        const childrenForRender = (!isReadOnly && currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
            ? mergeLazyChildrenWithDeletedSnapshots(parentKey, baseChildren)
            : baseChildren;

        if (!childrenForRender.length) return false;

        const maxChildren = CANVAS_PERMANENT_TREE_CHILD_BATCH;

        // 持久化记忆：收起时清除该文件夹的已加载项数记忆
        try {
            deletePermanentLoadedCountEntry(parentId);
        } catch (_) { }

        // 清空并重新渲染子节点，恢复到初始 maxChildren 限制
        childrenContainer.innerHTML = '';

        const item = treeRoot.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`);
        const level = item ? (parseInt(item.dataset.nodeLevel, 10) || 0) : 0;
        const nextLevel = level + 1;

        const renderCount = Math.min(childrenForRender.length, maxChildren);
        const fragment = document.createDocumentFragment();
        const visited = new Set([String(parentId)]);
        const htmls = [];
        for (let i = 0; i < renderCount; i++) {
            const child = childrenForRender[i];
            try {
                const html = renderTreeNodeWithChanges(child, nextLevel, 50, visited, null, undefined, false, '');
                htmls.push(html);
            } catch (_) { }
        }
        if (htmls.length > 0) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmls.join('');
            while (tempDiv.firstChild) {
                fragment.appendChild(tempDiv.firstChild);
            }
        }

        // 恢复选中状态
        if (typeof selectedNodes !== 'undefined' && selectedNodes && selectedNodes.size > 0) {
            fragment.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
                const nid = item.dataset.nodeId;
                if (nid && selectedNodes.has(nid)) {
                    item.classList.add('selected');
                }
            });
        }

        // 附加操作按钮容器
        const lazyActions = createPermanentFolderLazyActions(parentId, childrenForRender.length, renderCount);
        if (lazyActions) {
            fragment.appendChild(lazyActions);
        }

        childrenContainer.appendChild(fragment);

        // 更新父节点状态
        if (item) {
            item.dataset.childrenLoaded = 'true';
        }

        // 绑定拖拽
        try {
            if (typeof attachDragEvents === 'function' && !isReadOnly) {
                attachDragEvents(childrenContainer);
            }
        } catch (_) { }

        // 恢复子文件夹展开状态
        try {
            const treeForState = childrenContainer.closest('.bookmark-tree');
            const savedState = __readTreeExpandStateFromStorage(treeForState);
            if (savedState) {
                const expandedIds = JSON.parse(savedState);
                if (Array.isArray(expandedIds) && expandedIds.length > 0) {
                    const expandedSet = new Set(expandedIds);
                    childrenContainer.querySelectorAll(':scope > .tree-node > .tree-item[data-node-id]').forEach(item => {
                        if (__doesTreeExpandStateMatch(item, expandedSet)) {
                            const node = item.closest('.tree-node');
                            if (!node) return;
                            const children = node.querySelector(':scope > .tree-children');
                            const toggle = item.querySelector('.tree-toggle');
                            const icon = item.querySelector('.tree-icon.fas');
                            if (children && toggle) {
                                children.classList.add('expanded');
                                toggle.classList.add('expanded');
                                if (icon && icon.classList.contains('fa-folder')) {
                                    icon.classList.remove('fa-folder');
                                    icon.classList.add('fa-folder-open');
                                }
                                if (__shouldHydratePermanentFolderChildren(item, children)) {
                                    loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null, isReadOnly);
                                }
                            }
                        }
                    });
                }
            }
        } catch (_) { }

        if (typeof window.__updateTraceHighlights === 'function') {
            window.__updateTraceHighlights();
        }

        return true;
    } catch (e) {
        console.warn('[Canvas Permanent Tree Lazy] collapse failed:', e);
        return false;
    }
}


// 计算节点在指定树中的“索引地址路径”（示例：/1/2/3），从根的第一层开始使用 1 基索引
function getIndexAddressPathFromTree(tree, targetId) {
    try {
        if (!tree || !tree[0]) return '';
        // 构建 id -> node 快速索引
        const map = new Map();
        (function build(n) {
            if (!n) return;
            map.set(n.id, n);
            if (n.children) n.children.forEach(build);
        })(tree[0]);

        const target = map.get(targetId);
        if (!target) return '';
        const segments = [];
        let cur = target;
        // 将当前节点的 index+1 放入，逐层向上直到父为 '0' 或无父
        while (cur && typeof cur.index === 'number') {
            segments.push(cur.index + 1);
            const pid = cur.parentId;
            if (!pid || pid === '0') break;
            cur = map.get(pid);
        }
        // 如果父为 '0'，还需要把顶层容器自身的 index+1 也包含（cur 即顶层容器）
        if (cur && typeof cur.parentId !== 'undefined' && cur.parentId === '0' && typeof cur.index === 'number') {
            // 已经在循环中加入了 cur 的 index+1（作为上一轮child），此处不重复
        }
        return segments.length ? ('/' + segments.reverse().join('/')) : '';
    } catch (_) {
        return '';
    }
}

// 计算“旧位置”的索引地址路径：优先从 cachedOldTree 获取；失败返回空串
function getOldIndexAddressForNode(nodeId) {
    if (!nodeId) return '';
    try {
        if (cachedOldTree && cachedOldTree[0]) {
            return getIndexAddressPathFromTree(cachedOldTree, nodeId);
        }
    } catch (_) { }
    return '';
}

// ============ 名称路径（按文件夹名称，不含数字） ============
function getNamedPathFromTree(tree, targetId) {
    try {
        if (!tree || !tree[0]) return '';
        const path = [];
        const dfs = (node, cur) => {
            if (!node) return false;
            if (node.id === String(targetId)) { path.push(...cur, node.title); return true; }
            if (node.children) {
                for (const c of node.children) {
                    if (dfs(c, [...cur, node.title])) return true;
                }
            }
            return false;
        };
        dfs(tree[0], []);
        return path.join(' > ');
    } catch (_) { return ''; }
}

function breadcrumbToSlashFolders(bc) {
    if (!bc) return '';
    const parts = bc.split(' > ').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    // 只取文件夹路径：去掉最后一级（当前节点名）
    if (parts.length > 1) parts.pop(); else return '/';
    return '/' + parts.join('/');
}

function breadcrumbToSlashFull(bc) {
    if (!bc) return '/';
    const parts = bc.split(' > ').map(s => s.trim()).filter(Boolean);
    return parts.length ? ('/' + parts.join('/')) : '/';
}

// 将 "/A/B/C" 转为带矩形片段的 HTML（用于 move tooltip）
function slashPathToChipsHTML(slashPath) {
    try {
        if (!slashPath || typeof slashPath !== 'string') return '<span class="breadcrumb-item">/</span>';
        const parts = slashPath.split('/').filter(Boolean);
        if (parts.length === 0) return '<span class="breadcrumb-item">/</span>';
        const chips = parts.map((p, i) => {
            const safe = escapeHtml(p);
            return `<span class="breadcrumb-item">${safe}</span>`;
        });
        const sep = '<span class="breadcrumb-separator">/</span>';
        return chips.join(sep);
    } catch (_) {
        return '<span class="breadcrumb-item">/</span>';
    }
}

// 基于“旧父ID + 旧index”从当前树推导旧地址（避免必须完整旧树）
function getOldAddressFromParentAndIndex(oldParentId, oldIndex) {
    try {
        if (typeof oldParentId === 'undefined' || oldParentId === null) return '';
        const base = (cachedCurrentTree && cachedCurrentTree[0]) ? cachedCurrentTree : (cachedOldTree && cachedOldTree[0] ? cachedOldTree : null);
        if (!base) return '';
        const parentPath = getIndexAddressPathFromTree(base, String(oldParentId));
        if (!parentPath) return '';
        const childSeg = (typeof oldIndex === 'number') ? ('/' + (oldIndex + 1)) : '';
        return parentPath + childSeg;
    } catch (_) { return ''; }
}

// 防止并发渲染和闪烁的标志
let isRenderingTree = false;
let pendingRenderRequest = null;

async function renderTreeViewSync() {
    ;

    const treeContainer = document.getElementById('bookmarkTree');
    if (!treeContainer) {
        console.error('[renderTreeViewSync] 容器元素未找到');
        return;
    }

    // 清除缓存，确保重新渲染
    cachedTreeData = null;
    lastTreeFingerprint = null;
    lastTreeSnapshotVersion = null;
    cachedCurrentTreeIndex = null;

    try {
        const snapshot = await getBookmarkTreeSnapshot();
        const currentTree = snapshot ? snapshot.tree : null;
        lastTreeSnapshotVersion = snapshot ? snapshot.version : null;

        if (!currentTree || currentTree.length === 0) {
            treeContainer.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-sitemap"></i></div><div class="empty-state-title">${i18n.emptyTree[currentLang]}</div></div>`;
            return;
        }

        cachedOldTree = null;
        cachedCurrentTree = currentTree;
        cachedCurrentTreeIndex = null;
        treeChangeMap = new Map();

        // 渲染树
        const fragment = document.createDocumentFragment();

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTreeNodeWithChanges(currentTree[0], 0);
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        treeContainer.innerHTML = '';
        treeContainer.appendChild(fragment);
        treeContainer.style.display = 'block';

        // 绑定事件
        attachTreeEvents(treeContainer);

        ;

    } catch (error) {
        console.error('[renderTreeViewSync] 渲染失败:', error);
        treeContainer.innerHTML = `<div class="error">${currentLang === 'zh_CN' ? '加载失败' : 'Failed to load'}</div>`;
    }
}

// 目标：避免 renderTreeViewSync 的整树 DOM 构建导致“黑屏/卡顿感”。
async function ensureChangesPreviewTreeDataLoaded() {
    try {
        const snapshot = await getBookmarkTreeSnapshot();
        const currentTree = snapshot ? snapshot.tree : null;
        if (!currentTree || !Array.isArray(currentTree) || currentTree.length === 0) {
            cachedCurrentTree = null;
            treeChangeMap = new Map();
            return;
        }

        cachedOldTree = null;
        cachedCurrentTree = currentTree;
        cachedCurrentTreeIndex = null;
        lastTreeSnapshotVersion = snapshot ? snapshot.version : null;
        treeChangeMap = new Map();
    } catch (e) {
        console.warn('[ensureChangesPreviewTreeDataLoaded] Failed:', e);
        try { treeChangeMap = new Map(); } catch (_) { }
    }
}

async function renderTreeView(forceRefresh = false) {
    ;

    if (isBookmarkBulkMuteRenderingBlocked()) {
        bookmarkBulkNeedsRefresh = true;
        ;
        return;
    }

    // 如果正在渲染中，合并请求，避免重复渲染导致闪烁
    if (isRenderingTree) {
        ;
        pendingRenderRequest = forceRefresh;
        return;
    }

    isRenderingTree = true;

    // 记录永久栏目滚动位置，渲染后恢复
    // 优先使用当前滚动位置；如果是0，尝试从 localStorage 读取持久化的值（页面刷新场景）
    const permBody = document.querySelector('.permanent-section-body');
    let permScrollTop = permBody ? permBody.scrollTop : null;
    let permScrollLeft = permBody ? permBody.scrollLeft : 0;

    // 避免“渲染后多次恢复滚动”与用户滚动产生抢夺：一旦检测到用户开始滚动，短时间内停止自动恢复
    const isScrollRestoreBlocked = () => {
        if (!permBody) return false;
        try {
            const until = parseInt(permBody.dataset.scrollRestoreBlockUntil || '0', 10) || 0;
            return until && Date.now() < until;
        } catch (_) {
            return false;
        }
    };
    if (permBody && permBody.dataset.scrollRestoreGuardAttached !== 'true') {
        permBody.dataset.scrollRestoreGuardAttached = 'true';
        const blockMs = 1000;
        const block = () => {
            try {
                permBody.dataset.scrollRestoreBlockUntil = String(Date.now() + blockMs);
            } catch (_) { }
        };
        permBody.addEventListener('wheel', block, { passive: true });
        permBody.addEventListener('touchstart', block, { passive: true });
        permBody.addEventListener('touchmove', block, { passive: true });
        // 仅当直接在滚动容器上按下（如拖动滚动条/空白区域）才算用户滚动意图，避免点击树节点误触发
        permBody.addEventListener('pointerdown', (e) => {
            if (e && e.target === permBody) block();
        }, { passive: true });
    }

    // 页面刷新后，permScrollTop 是 0，需要从 localStorage 恢复
    if (permScrollTop === 0 && currentView === 'canvas') {
        try {
            const persisted = __readPermanentSectionScrollStateByCopyId('');
            if (persisted && typeof persisted.top === 'number') {
                permScrollTop = persisted.top;
                permScrollLeft = persisted.left || 0;
            }
        } catch (_) { }
    }

    const treeContainer = document.getElementById('bookmarkTree');

    if (!treeContainer) {
        console.error('[renderTreeView] 容器元素未找到');
        isRenderingTree = false;
        return;
    }

    // 强制刷新时清除缓存，确保重新渲染
    // 但先检查 Chrome 实际树是否与已显示树相同，相同则跳过（避免无变化的全量重建）
    if (forceRefresh) {
        if (shouldSkipForceTreeRefreshForNoNetChange()) {
            ;
            isRenderingTree = false;
            if (pendingRenderRequest !== null) {
                const pending = pendingRenderRequest;
                pendingRenderRequest = null;
                renderTreeView(pending);
            }
            return;
        }
        cachedTreeData = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;
        ;
    }

    // 如果已有缓存且不强制刷新，直接使用（快速路径）
    if (!forceRefresh && cachedTreeData && (cachedTreeData.treeFragment || cachedTreeData.renderTree)) {
        ;
        let renderedSharedViewsInFastPath = false;
        // Canvas 视图下尽量避免整树替换，减少“重新加载感”
        if (currentView === 'canvas' && treeContainer.children.length) {
            try {
                if (hasPermanentTreeCopyTargets()) {
                    renderedSharedViewsInFastPath = !!__renderPermanentTreeSharedViews({
                        includePrimary: false,
                        includeCopies: true,
                        reason: 'render-cached-fast-shared'
                    });
                }
            } catch (_) { }
            treeContainer.style.display = 'block';
        } else {
            __renderCachedPermanentTreeIntoPrimary(treeContainer);
            treeContainer.style.display = 'block';
        }

        // 重新绑定事件
        attachTreeEvents(treeContainer);

        if (!renderedSharedViewsInFastPath) {
            try {
                const syncedSharedCopies = __renderPermanentTreeSharedViews({
                    includePrimary: false,
                    includeCopies: true,
                    reason: 'render-cached-fast'
                });
                if (!syncedSharedCopies) schedulePermanentTreeCopySync();
            } catch (_) {
                try { schedulePermanentTreeCopySync(); } catch (_) { }
            }
        }

        ;
        // 恢复滚动位置（延迟确保展开状态恢复后再恢复滚动位置）
        if (permBody && permScrollTop !== null) {
            __scheduleCanvasBodyScrollRestoreInHistory(permBody, {
                top: permScrollTop,
                left: permScrollLeft
            }, {
                isBlocked: isScrollRestoreBlocked,
                fallbackDelays: [50, 150, 300, 500]
            });
        }

        // 【关键修复】即使使用缓存，也要预热内存缓存
        // 因为内存缓存可能在页面刷新后被清空，导致图标显示为五角星
        // 预热完成后会自动更新页面上的图标
        (async () => {
            try {
                if (currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
                    // Canvas 永久栏目首屏多为文件夹，不需要全量预热 favicon（会导致首次进入卡顿）
                    return;
                }
                // 获取当前书签树（优先后台快照）
                const snapshot = await getBookmarkTreeSnapshot();
                const currentTree = snapshot ? snapshot.tree : null;
                if (currentTree && currentTree.length > 0) {
                    // 收集所有书签URL
                    const allBookmarkUrls = [];
                    const collectUrls = (nodes) => {
                        if (!nodes) return;
                        nodes.forEach(node => {
                            if (node.url) allBookmarkUrls.push(node.url);
                            if (node.children) collectUrls(node.children);
                        });
                    };
                    collectUrls(currentTree);

                    if (allBookmarkUrls.length > 0) {
                        await warmupFaviconCache(allBookmarkUrls);

                        // 预热完成后，更新页面上所有使用fallback图标的img标签
                        allBookmarkUrls.forEach(url => {
                            try {
                                const domain = FaviconCache._getHostnameKey(url);
                                if (!domain) return;
                                const cachedFavicon = FaviconCache.memoryCache.get(domain);
                                if (cachedFavicon && cachedFavicon !== fallbackIcon) {
                                    updateFaviconImages(url, cachedFavicon);
                                }
                            } catch (e) {
                                // 忽略无效URL
                            }
                        });

                        ;
                    }
                }
            } catch (e) {
                console.warn('[renderTreeView] 快速路径预热失败:', e);
            }
        })();

        // 重置渲染标志并处理合并请求
        isRenderingTree = false;
        if (pendingRenderRequest !== null) {
            const pending = pendingRenderRequest;
            pendingRenderRequest = null;
            ;
            renderTreeView(pending);
        }
        return;
    }

    // 没有缓存，开始加载数据
    // 注意：不清空容器，保持原有内容，避免闪烁和滚动位置丢失
    // 只有在容器为空时才显示加载状态
    ;
    if (!treeContainer.children.length || treeContainer.querySelector('.loading') || treeContainer.querySelector('.empty-state') || treeContainer.querySelector('.error')) {
        treeContainer.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    }
    treeContainer.style.display = 'block';

    // 获取数据并行处理
    getBookmarkTreeSnapshot().then(async (snapshot) => {
        const currentTree = snapshot ? snapshot.tree : null;
        const snapshotVersion = snapshot ? snapshot.version : null;
        if (!currentTree || currentTree.length === 0) {
            cachedCurrentTree = null;
            cachedCurrentTreeIndex = null;
            cachedRenderTreeIndex = null;
            cachedTreeData = null;
            treeChangeMap = new Map();
            try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            treeContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-sitemap"></i></div>
                    <div class="empty-state-title">${i18n.emptyTree[currentLang]}</div>
                </div>
            `;
            try {
                const syncedSharedCopies = __renderPermanentTreeSharedViews({
                    includePrimary: false,
                    includeCopies: true,
                    reason: 'render-empty-tree'
                });
                if (!syncedSharedCopies) schedulePermanentTreeCopySync();
            } catch (_) {
                try { schedulePermanentTreeCopySync(); } catch (_) { }
            }
            isRenderingTree = false;
            if (pendingRenderRequest !== null) {
                const pending = pendingRenderRequest;
                pendingRenderRequest = null;
                renderTreeView(pending);
            }
            return;
        }

        // 版本快路径：优先使用 background 快照版本，避免对整棵树做 JSON 指纹（非常耗时）
        const canUseVersion = snapshotVersion !== null && typeof snapshotVersion !== 'undefined';
        const currentFingerprint = canUseVersion ? null : getTreeFingerprint(currentTree);

        // 如果版本/指纹相同，直接使用缓存（树没有变化）
        if (cachedTreeData && ((canUseVersion && snapshotVersion === lastTreeSnapshotVersion) || (!canUseVersion && currentFingerprint === lastTreeFingerprint))) {
            ;

            // Canvas 视图下，如果已有 DOM，避免整树替换造成"重新加载感"
            if (currentView === 'canvas' && treeContainer.children.length) {
                cachedCurrentTree = currentTree;
                cachedCurrentTreeIndex = null;
                let renderedSharedViewsInNoChangePath = false;
                try {
                    if (hasPermanentTreeCopyTargets()) {
                        renderedSharedViewsInNoChangePath = !!__renderPermanentTreeSharedViews({
                            includePrimary: false,
                            includeCopies: true,
                            reason: 'render-cached-nochange-shared'
                        });
                    }
                } catch (_) { }
                if (!renderedSharedViewsInNoChangePath) {
                    try {
                        const syncedSharedCopies = __renderPermanentTreeSharedViews({
                            includePrimary: false,
                            includeCopies: true,
                            reason: 'render-cached-nochange-inplace'
                        });
                        if (!syncedSharedCopies) schedulePermanentTreeCopySync();
                    } catch (_) {
                        try { schedulePermanentTreeCopySync(); } catch (_) { }
                    }
                }
                // 恢复滚动位置
                if (permBody && permScrollTop !== null) {
                    __scheduleCanvasBodyScrollRestoreInHistory(permBody, {
                        top: permScrollTop,
                        left: permScrollLeft
                    }, {
                        isBlocked: isScrollRestoreBlocked,
                        scheduleFollowUps: false
                    });
                }
                isRenderingTree = false;
                if (pendingRenderRequest !== null) {
                    const pending = pendingRenderRequest;
                    pendingRenderRequest = null;
                    ;
                    renderTreeView(pending);
                }
                return;
            }

            __renderCachedPermanentTreeIntoPrimary(treeContainer);
            treeContainer.style.display = 'block';

            // 重新绑定事件
            attachTreeEvents(treeContainer);
            try {
                const syncedSharedCopies = __renderPermanentTreeSharedViews({
                    includePrimary: false,
                    includeCopies: true,
                    reason: 'render-cached-nochange'
                });
                if (!syncedSharedCopies) schedulePermanentTreeCopySync();
            } catch (_) {
                try { schedulePermanentTreeCopySync(); } catch (_) { }
            }
            // 恢复滚动位置（延迟确保展开状态恢复后再恢复滚动位置）
            if (permBody && permScrollTop !== null) {
                __scheduleCanvasBodyScrollRestoreInHistory(permBody, {
                    top: permScrollTop,
                    left: permScrollLeft
                }, {
                    isBlocked: isScrollRestoreBlocked,
                    fallbackDelays: [50, 150, 300, 500]
                });
            }

            // 重置渲染标志并处理合并请求
            isRenderingTree = false;
            if (pendingRenderRequest !== null) {
                const pending = pendingRenderRequest;
                pendingRenderRequest = null;
                ;
                renderTreeView(pending);
            }
            return;
        }

        // 树有变化，重新渲染
        ;

        cachedOldTree = null;
        cachedCurrentTree = currentTree;
        cachedCurrentTreeIndex = null;

        // 【关键修复】预热 favicon 缓存 - 从 IndexedDB 批量加载到内存
        // Canvas 永久栏目采用懒加载时，避免首次进入遍历整棵树做预热（代价很高）
        if (!(currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) {
            // 收集所有书签URL
            const allBookmarkUrls = [];
            const collectUrls = (nodes) => {
                if (!nodes) return;
                nodes.forEach(node => {
                    if (node.url) {
                        allBookmarkUrls.push(node.url);
                    }
                    if (node.children) {
                        collectUrls(node.children);
                    }
                });
            };
            collectUrls(currentTree);

            // 批量预热缓存（等待完成，确保渲染时缓存已就绪）
            if (allBookmarkUrls.length > 0) {
                try {
                    await warmupFaviconCache(allBookmarkUrls);
                } catch (e) {
                    console.warn('[renderTreeView] favicon缓存预热失败，继续渲染:', e);
                }
            }
        }

        treeChangeMap = new Map();
        const treeToRender = currentTree;

        // Canvas 懒加载：lazy-load 读取 children 数据时必须基于“实际渲染的树”。
        // 否则当 treeToRender 是 rebuiltTree（包含 deleted）时，展开文件夹仍会按 currentTreeIndex 取 children，导致 deleted 永远看不到。
        try {
            cachedRenderTreeIndex = null;
            if (currentView === 'canvas' && CANVAS_PERMANENT_TREE_LAZY_ENABLED && treeToRender && treeToRender[0]) {
                const idx = buildTreeIndexFromRoot(treeToRender[0]);
                if (idx) {
                    cachedRenderTreeIndex = idx;
                    try { window.__canvasRenderTreeIndex = idx; } catch (_) { }
                }
            } else {
                try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            }
        } catch (_) { }

        // 使用 DocumentFragment 优化渲染
        const fragment = document.createDocumentFragment();

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTreeNodeWithChanges(treeToRender[0], 0, 50, new Set());
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        // 更新缓存
        cachedTreeData = {
            treeFragment: fragment.cloneNode(true),
            currentTree: currentTree,
            renderTree: treeToRender
        };
        if (canUseVersion) {
            lastTreeSnapshotVersion = snapshotVersion;
        } else {
            lastTreeFingerprint = currentFingerprint;
        }

        // 使用 requestAnimationFrame 确保 DOM 更新和滚动恢复在同一帧内完成，减少闪烁
        requestAnimationFrame(() => {
            let renderedFromSharedSource = false;
            try {
                renderedFromSharedSource = __renderPermanentTreeSharedViews({
                    includePrimary: true,
                    includeCopies: true,
                    reason: 'render-finished'
                });
            } catch (_) {
                renderedFromSharedSource = false;
            }

            if (!renderedFromSharedSource) {
                treeContainer.innerHTML = '';
                treeContainer.appendChild(fragment);
            }
            treeContainer.style.display = 'block';

            // 绑定事件
            attachTreeEvents(treeContainer);
            if (!renderedFromSharedSource) {
                try {
                    const syncedSharedCopies = __renderPermanentTreeSharedViews({
                        includePrimary: false,
                        includeCopies: true,
                        reason: 'render-finished-fallback'
                    });
                    if (!syncedSharedCopies) schedulePermanentTreeCopySync();
                } catch (_) {
                    try { schedulePermanentTreeCopySync(); } catch (_) { }
                }
            }

            // 恢复滚动位置（延迟确保展开状态和懒加载完成后再恢复滚动位置）
            if (permBody && permScrollTop !== null) {
                __scheduleCanvasBodyScrollRestoreInHistory(permBody, {
                    top: permScrollTop,
                    left: permScrollLeft
                }, {
                    isBlocked: isScrollRestoreBlocked,
                    fallbackDelays: [50, 150, 300, 500]
                });
            }

            ;
        });

        // 重置渲染标志
        isRenderingTree = false;

        // 如果有待处理的渲染请求，处理它
        if (pendingRenderRequest !== null) {
            const pending = pendingRenderRequest;
            pendingRenderRequest = null;
            ;
            renderTreeView(pending);
        }
    }).catch(error => {
        console.error('[renderTreeView] 错误:', error);
        cachedCurrentTree = null;
        cachedCurrentTreeIndex = null;
        cachedRenderTreeIndex = null;
        cachedTreeData = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        treeContainer.innerHTML = `<div class="error">加载失败: ${escapeHtml(error && error.message ? error.message : String(error))}</div>`;
        treeContainer.style.display = 'block';
        try {
            const syncedSharedCopies = __renderPermanentTreeSharedViews({
                includePrimary: false,
                includeCopies: true,
                reason: 'render-error'
            });
            if (!syncedSharedCopies) schedulePermanentTreeCopySync();
        } catch (_) {
            try { schedulePermanentTreeCopySync(); } catch (_) { }
        }

        // 重置渲染标志
        isRenderingTree = false;
        pendingRenderRequest = null;
    });
}

// 树事件处理器映射（避免重复绑定）
const treeClickHandlers = new WeakMap();
const treeContextMenuHandlers = new WeakMap();

// 绑定树的展开/折叠事件
function attachTreeEvents(treeContainer) {
    const isReadOnlyChangesPreview = (() => {
        try {
            return !!(treeContainer && treeContainer.closest && treeContainer.closest('.changes-preview-readonly'));
        } catch (_) {
            return false;
        }
    })();

    // 移除旧的事件监听器
    const existingHandler = treeClickHandlers.get(treeContainer);
    if (existingHandler) {
        treeContainer.removeEventListener('click', existingHandler);
    }

    // 创建新的事件处理器
    const clickHandler = async (e) => {
        // Canvas 永久栏目懒加载：加载更多
        try {
            const loadMoreBtn = e.target && e.target.closest ? e.target.closest('.tree-load-more') : null;
            if (loadMoreBtn && CANVAS_PERMANENT_TREE_LAZY_ENABLED && (currentView === 'canvas' || isReadOnlyChangesPreview)) {
                e.preventDefault();
                e.stopPropagation();
                const parentId = loadMoreBtn.dataset.parentId;
                const startIndex = parseInt(loadMoreBtn.dataset.startIndex, 10) || 0;
                const childrenContainer = loadMoreBtn.closest('.tree-children');
                loadPermanentFolderChildrenLazy(parentId, childrenContainer, startIndex, loadMoreBtn, isReadOnlyChangesPreview);
                return;
            }
        } catch (_) { }

        // Canvas 永久栏目懒加载：收起已加载
        try {
            const loadLessBtn = e.target && e.target.closest ? e.target.closest('.tree-load-less') : null;
            if (loadLessBtn && CANVAS_PERMANENT_TREE_LAZY_ENABLED && (currentView === 'canvas' || isReadOnlyChangesPreview)) {
                e.preventDefault();
                e.stopPropagation();
                const parentId = loadLessBtn.dataset.parentId;
                const childrenContainer = loadLessBtn.closest('.tree-children');
                if (childrenContainer) {
                    let heightLocked = false;
                    try {
                        // Lock height to prevent layout collapse and scroll shift
                        const oldHeight = childrenContainer.offsetHeight;
                        childrenContainer.style.height = oldHeight + 'px';
                        heightLocked = true;

                        await collapsePermanentFolderChildren(parentId, childrenContainer, isReadOnlyChangesPreview);

                        const container = childrenContainer.closest('.permanent-section-body, .temp-node-body');
                        const isMaximized = container && container.closest('.canvas-node-maximized');
                        let zoom = 1;
                        if (isMaximized) {
                            const computedZoom = parseFloat(window.getComputedStyle(container).zoom);
                            zoom = (Number.isFinite(computedZoom) && computedZoom > 0) ? computedZoom : 1;
                        } else {
                            const CanvasState = (window.CanvasModule && window.CanvasModule.CanvasState) ? window.CanvasModule.CanvasState : null;
                            zoom = (CanvasState && CanvasState.zoom > 0) ? CanvasState.zoom : 1;
                        }

                        const lazyActions = childrenContainer.querySelector('.tree-lazy-actions-container');
                        if (lazyActions) {
                            if (container) {
                                const containerRect = container.getBoundingClientRect();
                                const targetRect = lazyActions.getBoundingClientRect();
                                const targetCenterInViewport = (targetRect.top + targetRect.bottom) / 2 - containerRect.top;
                                const containerCenter = containerRect.height / 2;
                                const dScroll = (targetCenterInViewport - containerCenter) / zoom;
                                const targetScrollTop = container.scrollTop + dScroll;

                                // Unlock height
                                childrenContainer.style.height = '';
                                heightLocked = false;

                                const maxScrollTop = container.scrollHeight - container.clientHeight;
                                const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
                                container.scrollTop = clampedScrollTop;
                            }
                        } else {
                            const parentTreeItem = childrenContainer.previousElementSibling;
                            if (parentTreeItem) {
                                if (container) {
                                    const containerRect = container.getBoundingClientRect();
                                    const targetRect = parentTreeItem.getBoundingClientRect();
                                    const dScroll = (targetRect.top - containerRect.top - 10) / zoom;
                                    const targetScrollTop = container.scrollTop + dScroll;

                                    // Unlock height
                                    childrenContainer.style.height = '';
                                    heightLocked = false;

                                    const maxScrollTop = container.scrollHeight - container.clientHeight;
                                    const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
                                    container.scrollTop = clampedScrollTop;
                                } else {
                                    childrenContainer.style.height = '';
                                    heightLocked = false;
                                    parentTreeItem.scrollIntoView({ block: 'start', behavior: 'auto' });
                                }
                            }
                        }
                    } finally {
                        if (heightLocked) {
                            childrenContainer.style.height = '';
                        }
                    }
                }
                return;
            }
        } catch (_) { }

        // Canvas 永久栏目懒加载：全部展开
        try {
            const loadAllBtn = e.target && e.target.closest ? e.target.closest('.tree-load-all') : null;
            if (loadAllBtn && CANVAS_PERMANENT_TREE_LAZY_ENABLED && (currentView === 'canvas' || isReadOnlyChangesPreview)) {
                e.preventDefault();
                e.stopPropagation();
                const parentId = loadAllBtn.dataset.parentId;
                await loadAllPermanentChildren(parentId, loadAllBtn, isReadOnlyChangesPreview);
                return;
            }
        } catch (_) { }

        // =============================================================================
        // 【重要架构】永久栏目书签左键点击处理器
        // =============================================================================
        // 本处理器是「书签系统」的一部分，与临时栏目的处理逻辑
        // （bookmark_canvas_module.js:tempLinkClickHandler）必须保持同步！
        // 两者都使用 window.defaultOpenMode 变量。
        //
        // ⚠️ 添加新的打开模式时，必须同时修改：
        //   1. 本文件 → attachTreeEvents → clickHandler（永久栏目）
        //   2. bookmark_canvas_module.js → tempLinkClickHandler（临时栏目）
        //   3. bookmark_tree_context_menu.js → 右键菜单action处理
        //
        // 详见：.agent/workflows/link-click-handling.md
        // =============================================================================
        // 左键点击书签标签，根据默认打开方式打开（避免重复绑定多个 click 监听器）
        try {
            const link = e.target && e.target.closest ? e.target.closest('a.tree-bookmark-link') : null;
            if (link && treeContainer.contains(link)) {
                // 如果处于批量选择模式，或者按下了修饰键（Option/Alt/Shift）用于选择，屏蔽默认的打开逻辑
                const hasSelectModifier = e.altKey || e.shiftKey;
                const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
                if ((typeof window.selectMode !== 'undefined' && window.selectMode && !(isMac && e.ctrlKey)) || 
                    hasSelectModifier) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                const url = link.getAttribute('href');
                const nodeElement = link.closest('.tree-item[data-node-id]');
                const contextInfo = nodeElement ? {
                    treeType: nodeElement.dataset.treeType || 'permanent',
                    sectionId: nodeElement.dataset.sectionId || null,
                    nodeId: nodeElement.dataset.nodeId || null
                } : { treeType: 'permanent' };
                // 永久栏目副本：补充 copyId / displayIndex，供“同窗专属组 / 专属标签组 / 专属窗口”等按栏目作用域区分
                try {
                    const sectionEl = link.closest ? link.closest('.permanent-bookmark-section') : null;
                    if (sectionEl && sectionEl.classList && sectionEl.classList.contains('permanent-section-copy') && sectionEl.dataset) {
                        const copyIdRaw = sectionEl.dataset.permanentSectionCopyId;
                        const copyId = (typeof copyIdRaw === 'string') ? copyIdRaw.trim() : '';
                        if (copyId) contextInfo.permanentCopyId = copyId;
                        const displayIndexRaw = sectionEl.dataset.permanentSectionDisplayIndex;
                        const displayIndex = parseInt(displayIndexRaw, 10);
                        if (Number.isFinite(displayIndex) && displayIndex > 0) {
                            contextInfo.permanentDisplayIndex = displayIndex;
                        }
                    }
                } catch (_) { }

                try {
                    if (window.defaultOpenMode === undefined && typeof window.getDefaultOpenMode === 'function') {
                        window.defaultOpenMode = window.getDefaultOpenMode();
                    }
                } catch (_) { }
                const mode = (typeof window !== 'undefined' && window.defaultOpenMode) || (typeof defaultOpenMode !== 'undefined' ? defaultOpenMode : 'specific-window');

                const actionKey = `left-click-${mode}-${url}`;
                if (typeof shouldAllowBookmarkOpen === 'function' && !shouldAllowBookmarkOpen(actionKey)) {
                    return;
                }

                if (mode === 'new-window') {
                    if (typeof openBookmarkNewWindow === 'function') openBookmarkNewWindow(url, false); else window.open(url, '_blank');
                } else if (mode === 'incognito') {
                    if (typeof openBookmarkNewWindow === 'function') openBookmarkNewWindow(url, true); else window.open(url, '_blank');
                } else if (mode === 'specific-window') {
                    if (typeof openInSpecificWindow === 'function') openInSpecificWindow(url, { context: contextInfo }); else window.open(url, '_blank');
                } else if (mode === 'specific-group') {
                    if (typeof openInSpecificTabGroup === 'function') openInSpecificTabGroup(url); else window.open(url, '_blank');
                } else if (mode === 'scoped-window') {
                    if (typeof openInScopedWindow === 'function') openInScopedWindow(url, { context: contextInfo }); else window.open(url, '_blank');
                } else if (mode === 'scoped-group') {
                    if (typeof openInScopedTabGroup === 'function') openInScopedTabGroup(url, { context: contextInfo }); else window.open(url, '_blank');
                } else if (mode === 'same-window-specific-group') {
                    if (typeof openInSameWindowSpecificGroup === 'function') openInSameWindowSpecificGroup(url, { context: contextInfo }); else window.open(url, '_blank');
                } else if (mode === 'manual-select') {
                    if (typeof openBookmarkWithManualSelection === 'function') openBookmarkWithManualSelection(url); else window.open(url, '_blank');
                } else {
                    if (typeof openBookmarkNewTab === 'function') openBookmarkNewTab(url); else window.open(url, '_blank');
                }
                return;
            }
        } catch (_) { }

        // 点击整个文件夹行都可以展开
        const treeItem = e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
        if (treeItem) {
            // 如果点击在右侧快捷图标区域或标签区域，不触发展开/收起，防止误触
            if (e.target.closest('.tree-item-hover-actions') || e.target.closest('.tree-item-tag-dots') || e.target.closest('.tree-tip-icon')) {
                return;
            }
            // 另外，如果点击在快捷图标区域或标签区域实际可见的边界内，才屏蔽展开/收起，防止误触且保留最大可点击范围
            const isClickInsideElement = (selector) => {
                const el = treeItem.querySelector(selector);
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    return false;
                }
                const rect = el.getBoundingClientRect();
                return e.clientX >= rect.left - 2 && e.clientX <= rect.right + 2 &&
                       e.clientY >= rect.top - 2 && e.clientY <= rect.bottom + 2;
            };

            if (isClickInsideElement('.tree-item-hover-actions') || 
                isClickInsideElement('.tree-item-tag-dots') || 
                isClickInsideElement('.tree-tip-icon')) {
                return;
            }

            // 找到包含这个tree-item的tree-node
            const node = treeItem.closest('.tree-node');
            if (!node) {
                ;
                return;
            }

            const children = node.querySelector(':scope > .tree-children');
            const toggle = treeItem.querySelector(':scope > .tree-toggle');

            ;

            if (children && toggle) {
                e.stopPropagation();
                children.classList.toggle('expanded');
                toggle.classList.toggle('expanded');

                // 保存展开状态
                saveTreeExpandState(treeContainer);
                // Canvas 永久栏目懒加载：展开时按需加载子节点，折叠时延迟卸载释放 DOM
                try {
                    const expanded = children.classList.contains('expanded');
                    if (expanded) {
                        if (children.__unloadTimer__) {
                            clearTimeout(children.__unloadTimer__);
                            children.__unloadTimer__ = null;
                        }
                        if (CANVAS_PERMANENT_TREE_LAZY_ENABLED &&
                            (currentView === 'canvas' || isReadOnlyChangesPreview) &&
                            __shouldHydratePermanentFolderChildren(treeItem, children)) {
                            loadPermanentFolderChildrenLazy(treeItem.dataset.nodeId, children, 0, null, isReadOnlyChangesPreview);
                        }
                    } else {
                        if (CANVAS_PERMANENT_TREE_LAZY_ENABLED && (currentView === 'canvas' || isReadOnlyChangesPreview)) {
                            // 如果当前渲染的数量大于 maxChildren，立刻卸载以重置状态并释放内存
                            const maxChildren = CANVAS_PERMANENT_TREE_CHILD_BATCH;
                            const childCount = children.querySelectorAll(':scope > .tree-node').length;
                            if (childCount > maxChildren) {
                                if (children.__unloadTimer__) {
                                    clearTimeout(children.__unloadTimer__);
                                    children.__unloadTimer__ = null;
                                }
                                children.innerHTML = '';
                                treeItem.dataset.childrenLoaded = 'false';
                            } else {
                                // 15秒防抖延迟卸载子 DOM，防止误触或高频折叠展开带来的重绘开销
                                if (children.__unloadTimer__) {
                                    clearTimeout(children.__unloadTimer__);
                                }
                                children.__unloadTimer__ = setTimeout(() => {
                                    children.__unloadTimer__ = null;
                                    if (!children.classList.contains('expanded') && document.body.contains(children)) {
                                        children.innerHTML = '';
                                        treeItem.dataset.childrenLoaded = 'false';
                                    }
                                }, 15000);
                            }
                            // 折叠时已直接更新 childrenLoaded/innerHTML 释放内存，不进行全局 scrollIntoView 定位，避免 Canvas 画布抖动。
                        }
                    }
                } catch (_) { }
            }
        }
    };

    // 绑定新的事件监听器
    treeContainer.addEventListener('click', clickHandler);
    treeClickHandlers.set(treeContainer, clickHandler);

    // 绑定右键菜单事件（只读预览禁用）
    if (!isReadOnlyChangesPreview) {
        const existingContextHandler = treeContextMenuHandlers.get(treeContainer);
        if (existingContextHandler) {
            treeContainer.removeEventListener('contextmenu', existingContextHandler);
        }
        const contextHandler = (e) => {
            const item = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
            if (!item || !treeContainer.contains(item)) return;
            if (typeof showContextMenu === 'function') {
                showContextMenu(e, item);
            }
        };
        treeContainer.addEventListener('contextmenu', contextHandler);
        treeContextMenuHandlers.set(treeContainer, contextHandler);
    }

    // 绑定拖拽事件（只读预览禁用）
    if (!isReadOnlyChangesPreview && typeof attachDragEvents === 'function') {
        attachDragEvents(treeContainer);
    }

    // 绑定指针拖拽事件（支持滚轮滚动）
    if (typeof attachPointerDragEvents === 'function') {
        attachPointerDragEvents(treeContainer);
        ;
    }

    // 如果在Canvas视图，重新绑定Canvas拖出功能
    if (currentView === 'canvas' && window.CanvasModule && window.CanvasModule.enhance) {
        ;
        window.CanvasModule.enhance();
    }

    ;

    // 恢复展开状态
    restoreTreeExpandState(treeContainer);

    ensureCanvasLazyLegend(treeContainer);

    if (typeof window.__updateTraceHighlights === 'function') {
        window.__updateTraceHighlights();
    }
}

function setupLegendClickHandlers(container) {
    void container;
}

async function jumpToNextChangeType(type, container) {
    void type;
    void container;
}

// 保存JSON滚动位置
function saveJSONScrollPosition(jsonContainer) {
    try {
        const content = jsonContainer.querySelector('.json-diff-content');
        if (content) {
            const scrollTop = content.scrollTop;
            __saveLocalStorageRaw('jsonScrollPosition', scrollTop.toString());
            ;
        }
    } catch (e) {
        console.error('[JSON状态] 保存滚动位置失败:', e);
    }
}

// 恢复JSON滚动位置
function restoreJSONScrollPosition(jsonContainer) {
    try {
        const savedPosition = localStorage.getItem('jsonScrollPosition');
        if (savedPosition) {
            const content = jsonContainer.querySelector('.json-diff-content');
            if (content) {
                content.scrollTop = parseInt(savedPosition, 10);
                ;
            }
        }
    } catch (e) {
        console.error('[JSON状态] 恢复滚动位置失败:', e);
    }
}

function __isCanvasPermanentTreeContainer(treeContainer) {
    try {
        return !!(
            currentView === 'canvas'
            && treeContainer
            && treeContainer.closest
            && treeContainer.closest('.permanent-bookmark-section')
        );
    } catch (_) {
        return false;
    }
}

function __getTreeExpandStateIdentity(item) {
    if (!item || !item.dataset) return '';
    return String(item.dataset.nodeId || '').trim();
}

function __findTreeItemByExpandStateIdentity(tree, stableId) {
    const id = String(stableId || '').trim();
    if (!tree || !id) return null;
    try {
        return tree.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`);
    } catch (_) {
        return null;
    }
}

function __doesTreeExpandStateMatch(item, expandedSet) {
    if (!item || !item.dataset || !expandedSet || !expandedSet.size) return false;
    const nodeId = String(item.dataset.nodeId || '').trim();
    return !!(nodeId && expandedSet.has(nodeId));
}

// 保存树的展开状态；完全依赖本地节点 ID（nodeId）。
const _saveTreeExpandStateTimers = new WeakMap();
function __saveTreeExpandStateToStorage(treeContainer) {
    if (!treeContainer) return;
    try {
        const expandedIds = [];
        treeContainer.querySelectorAll('.tree-children.expanded').forEach(children => {
            const node = children.closest('.tree-node');
            const item = node ? node.querySelector(':scope > .tree-item[data-node-id]') : null;
            const stableId = __getTreeExpandStateIdentity(item);
            if (stableId) {
                expandedIds.push(stableId);
            }
        });
        const key = __getTreeExpandStateStorageKey(treeContainer);
        __saveLocalStorageJSON(key, expandedIds);
        // Canvas view expand state is partitioned (page/sidepanel). Keep them in sync so exports/sync
        // can see the latest state even if toggled from a different partition.
        try {
            const partition = __getCanvasViewStatePartitionKey();
            const basePrefix = `${__CANVAS_VIEW_STATE_STORAGE_NS}:expand:${partition}:`;
            if (key && key.startsWith(basePrefix)) {
                const baseKey = key.slice(basePrefix.length);
                const otherPartition = partition === 'sidepanel' ? 'page' : 'sidepanel';
                const otherKey = `${__CANVAS_VIEW_STATE_STORAGE_NS}:expand:${otherPartition}:${baseKey}`;
                __saveLocalStorageJSON(otherKey, expandedIds);
            }
        } catch (_) { }
        ;
    } catch (e) {
        console.error('[树状态] 保存失败:', e);
    }
}
function saveTreeExpandState(treeContainer) {
    try {
        if (!treeContainer) return;
        try {
            const key = __getTreeExpandStateStorageKey(treeContainer);
            if (key && key.startsWith('changesPreviewExpandedNodes:')) {
                const prevTimer = _saveTreeExpandStateTimers.get(treeContainer);
                if (prevTimer) {
                    clearTimeout(prevTimer);
                    try { _saveTreeExpandStateTimers.delete(treeContainer); } catch (_) { }
                }
                __saveTreeExpandStateToStorage(treeContainer);
                return;
            }
        } catch (_) { }

        // Canvas 永久栏目副本：立即写入（避免同步/刷新时 debounce 丢失，确保“副本独立记忆”可靠）
        try {
            if (currentView === 'canvas') {
                const key = __getTreeExpandStateStorageKey(treeContainer);
                const copyExpandPrefix = `${__CANVAS_VIEW_STATE_STORAGE_NS}:expand:${__getCanvasViewStatePartitionKey()}:${__PERMANENT_SECTION_EXPANDED_KEY}:`;
                if (key && key.startsWith(copyExpandPrefix)) {
                    const prevTimer = _saveTreeExpandStateTimers.get(treeContainer);
                    if (prevTimer) {
                        clearTimeout(prevTimer);
                        try { _saveTreeExpandStateTimers.delete(treeContainer); } catch (_) { }
                    }
                    __saveTreeExpandStateToStorage(treeContainer);
                    return;
                }
            }
        } catch (_) { }
        const prevTimer = _saveTreeExpandStateTimers.get(treeContainer);
        if (prevTimer) {
            clearTimeout(prevTimer);
        }
        const timer = setTimeout(() => {
            try { _saveTreeExpandStateTimers.delete(treeContainer); } catch (_) { }
            __saveTreeExpandStateToStorage(treeContainer);
        }, 250);
        _saveTreeExpandStateTimers.set(treeContainer, timer);
    } catch (e) {
        console.error('[树状态] 保存失败:', e);
    }
}

// 恢复树的展开状态；完全依赖本地节点 ID（nodeId）。
function restoreTreeExpandState(treeContainer) {
    try {
        const savedState = __readTreeExpandStateFromStorage(treeContainer);
        if (!savedState) return;

        const expandedIds = JSON.parse(savedState);
        if (!Array.isArray(expandedIds) || expandedIds.length === 0) return;

        const expandedSet = new Set(expandedIds);
        const nodesToLazyLoad = []; // Canvas 懒加载模式下需要加载子节点的文件夹

        const isReadOnlyChangesPreview = (() => {
            try {
                return !!(treeContainer && treeContainer.closest && treeContainer.closest('.changes-preview-readonly'));
            } catch (_) {
                return false;
            }
        })();

        treeContainer.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
            if (__doesTreeExpandStateMatch(item, expandedSet)) {
                const node = item.closest('.tree-node');
                if (!node) return;
                const children = node.querySelector(':scope > .tree-children');
                const toggle = item.querySelector('.tree-toggle');
                const icon = item.querySelector('.tree-icon.fas');
                if (children && toggle) {
                    children.classList.add('expanded');
                    toggle.classList.add('expanded');
                    // 更新文件夹图标
                    if (icon && icon.classList.contains('fa-folder')) {
                        icon.classList.remove('fa-folder');
                        icon.classList.add('fa-folder-open');
                    }
                    // Canvas 懒加载模式：如果子节点未加载，记录下来稍后加载
                    if ((currentView === 'canvas' || isReadOnlyChangesPreview) &&
                        CANVAS_PERMANENT_TREE_LAZY_ENABLED &&
                        __shouldHydratePermanentFolderChildren(item, children)) {
                        nodesToLazyLoad.push({ parentId: item.dataset.nodeId, children });
                    }
                }
            }
        });

        // Canvas 懒加载模式：批量加载需要展开的文件夹的子节点
        if (nodesToLazyLoad.length > 0) {
            ;
            const suppressBootstrapRestore = __shouldSuppressCanvasBootstrapRestoreInHistory(treeContainer);
            const hydrate = () => {
                nodesToLazyLoad.forEach(({ parentId, children }) => {
                    try {
                        loadPermanentFolderChildrenLazy(parentId, children, 0, null, isReadOnlyChangesPreview);
                    } catch (e) {
                        console.warn('[树状态] 懒加载子节点失败:', parentId, e);
                    }
                });
            };
            // 启动全屏预恢复时不能再额外延迟 50ms，否则会在可见后继续跳。
            if (suppressBootstrapRestore) {
                hydrate();
            } else {
                setTimeout(hydrate, 50);
            }
        }

        ;
    } catch (e) {
        console.error('[树状态] 恢复失败:', e);
    }
}

// Canvas 永久栏目：在刷新/关闭前强制 flush 展开状态，避免 debounce 丢失（副本尤其明显）
function __flushCanvasPermanentSectionExpandState() {
    try {
        if (currentView !== 'canvas') return;
        const canvasContent = document.getElementById('canvasContent');
        if (!canvasContent) return;
        canvasContent.querySelectorAll('.permanent-bookmark-section .bookmark-tree').forEach(tree => {
            try {
                const t = _saveTreeExpandStateTimers.get(tree);
                if (t) {
                    clearTimeout(t);
                    _saveTreeExpandStateTimers.delete(tree);
                }
            } catch (_) { }
            try { __saveTreeExpandStateToStorage(tree); } catch (_) { }
        });
    } catch (_) { }
}
if (!window.__canvasPermanentSectionExpandStateFlushBound) {
    window.__canvasPermanentSectionExpandStateFlushBound = true;
    window.addEventListener('pagehide', __flushCanvasPermanentSectionExpandState);
    document.addEventListener('visibilitychange', () => {
        try {
            if (document.visibilityState === 'hidden') {
                __flushCanvasPermanentSectionExpandState();
            }
        } catch (_) { }
    });
}

// 快速检测书签树变动（性能优化版 + 智能移动检测）
// options:
async function detectTreeChangesFast(oldTree, newTree, options = {}) {
    const changes = new Map();
    if (!oldTree || !newTree) return changes;

    let explicitMovedIdSet = null;
    if (options && typeof options === 'object' && 'explicitMovedIdSet' in options) {
        const src = options.explicitMovedIdSet;
        if (src instanceof Set) {
            explicitMovedIdSet = new Set(Array.from(src).map(v => String(v)));
        } else if (Array.isArray(src)) {
            explicitMovedIdSet = new Set(src.map(v => String(v)));
        } else if (src === null) {
            explicitMovedIdSet = null;
        }
    }
    const hasExplicitMovedInfo = explicitMovedIdSet instanceof Set && explicitMovedIdSet.size > 0;

    const oldNodes = new Map();
    const newNodes = new Map();
    const oldByParent = new Map(); // parentId -> [{id,index}]
    const newByParent = new Map();

    const traverse = (node, map, byParent, parentId = null) => {
        if (node && node.id) {
            const record = {
                title: node.title,
                url: node.url,
                parentId: node.parentId || parentId,
                index: node.index
            };
            map.set(node.id, record);
            if (record.parentId) {
                if (!byParent.has(record.parentId)) byParent.set(record.parentId, []);
                byParent.get(record.parentId).push({ id: node.id, index: record.index });
            }
        }
        if (node && node.children) node.children.forEach(child => traverse(child, map, byParent, node.id));
    };

    if (oldTree[0]) traverse(oldTree[0], oldNodes, oldByParent, null);
    if (newTree[0]) traverse(newTree[0], newNodes, newByParent, null);

    const getNodePath = (tree, targetId) => {
        const path = [];
        const dfs = (node, cur) => {
            if (!node) return false;
            if (node.id === targetId) { path.push(...cur, node.title); return true; }
            if (node.children) {
                for (const c of node.children) { if (dfs(c, [...cur, node.title])) return true; }
            }
            return false;
        };
        if (tree[0]) dfs(tree[0], []);
        return path.join(' > ');
    };

    // 新增 / 修改 / 跨级移动
    newNodes.forEach((n, id) => {
        const o = oldNodes.get(id);
        if (!o) { changes.set(id, { type: 'added' }); return; }
        const modified = (o.title !== n.title) || (o.url !== n.url);
        const crossMove = o.parentId !== n.parentId;
        if (modified || crossMove) {
            const types = [];
            const detail = {};
            if (modified) types.push('modified');
            if (crossMove) {
                types.push('moved');
                detail.moved = {
                    oldPath: getNodePath(oldTree, id),
                    newPath: getNodePath(newTree, id),
                    oldParentId: o.parentId,
                    oldIndex: o.index,
                    newParentId: n.parentId,
                    newIndex: n.index
                };
            }
            changes.set(id, { type: types.join('+'), ...detail });
        }
    });

    // 删除（补充 oldParentId / oldIndex / oldPath，供懒加载“灰点提示”快速回溯祖先）
    oldNodes.forEach((o, id) => {
        if (newNodes.has(id)) return;
        try {
            changes.set(id, {
                type: 'deleted',
                deleted: {
                    oldPath: getNodePath(oldTree, id),
                    oldParentId: o && o.parentId ? o.parentId : null,
                    oldIndex: (o && typeof o.index === 'number') ? o.index : null
                }
            });
        } catch (_) {
            changes.set(id, { type: 'deleted' });
        }
    });

    // 建立“子节点集合发生变化”的父级集合：
    // - add/delete 会导致同级 index 被动变化（不应被当成 moved）
    // - 跨级移动会改变源/目标父级的 children 集合（同样不应误标同级为 moved）
    const parentsWithChildSetChange = new Set();
    changes.forEach((change, id) => {
        if (!change || !change.type) return;

        if (change.type.includes('added') || change.type.includes('deleted')) {
            const node = change.type.includes('added') ? newNodes.get(id) : oldNodes.get(id);
            if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
        }

        // 跨级移动：把 old/new parent 都加入（避免同级被动位移误标）
        if (change.type.includes('moved') && change.moved && change.moved.oldParentId !== change.moved.newParentId) {
            if (change.moved.oldParentId) parentsWithChildSetChange.add(change.moved.oldParentId);
            if (change.moved.newParentId) parentsWithChildSetChange.add(change.moved.newParentId);
        }
    });

    const markMoved = (id) => {
        const existing = changes.get(id);
        const types = existing && existing.type ? new Set(existing.type.split('+')) : new Set();
        types.add('moved');
        const movedDetail = { oldPath: getNodePath(oldTree, id), newPath: getNodePath(newTree, id) };
        changes.set(id, { type: Array.from(types).join('+'), moved: movedDetail });
    };

    // 同级移动（重要：只标记“被拖动”的对象；不标记因为插入/删除/跨级移动导致的同级被动位移）
    // - 有显式 moved IDs（onMoved）时：只按显式集合打标（即使该父级也发生了 add/delete 或跨级移动）
    // - 无显式 moved IDs 时：仅在该父级 children 集合未变化时，用 LIS 推导最小 moved 集合
    const commonPosCache = new Map(); // parentId -> { oldPosById, newPosById } （仅针对 common ids）
    const getCommonPositions = (parentId) => {
        if (commonPosCache.has(parentId)) return commonPosCache.get(parentId);

        const oldList = oldByParent.get(parentId) || [];
        const newList = newByParent.get(parentId) || [];
        const newIdSet = new Set(newList.map(x => String(x.id)));

        const oldPosById = new Map();
        let oldPos = 0;
        for (const item of oldList) {
            const sid = String(item.id);
            if (newIdSet.has(sid)) {
                oldPosById.set(sid, oldPos++);
            }
        }

        const newPosById = new Map();
        let newPos = 0;
        for (const item of newList) {
            const sid = String(item.id);
            if (oldPosById.has(sid)) {
                newPosById.set(sid, newPos++);
            }
        }

        const entry = { oldPosById, newPosById };
        commonPosCache.set(parentId, entry);
        return entry;
    };

    if (hasExplicitMovedInfo) {
        for (const id of explicitMovedIdSet) {
            const o = oldNodes.get(id);
            const n = newNodes.get(id);
            if (!o || !n) continue; // added/deleted: Git 口径不算 moved
            if (!o.parentId || !n.parentId) continue;
            if (o.parentId !== n.parentId) continue; // 跨级 moved 已在上方标记

            const parentId = n.parentId;
            const { oldPosById, newPosById } = getCommonPositions(parentId);
            const oldPos = oldPosById.get(id);
            const newPos = newPosById.get(id);
            if (typeof oldPos === 'number' && typeof newPos === 'number' && oldPos !== newPos) {
                markMoved(id);
            }
        }
    } else {
        // 无显式 moved：对“children 集合未变化”的父级做最小 moved 推导
        newByParent.forEach((newList, parentId) => {
            if (parentsWithChildSetChange.has(parentId)) return;

            const oldList = oldByParent.get(parentId) || [];
            if (oldList.length === 0 || newList.length === 0) return;
            if (oldList.length !== newList.length) return;

            // 先快速判等（完全一致则不必做 LIS）
            let sameOrder = true;
            for (let i = 0; i < oldList.length; i++) {
                if (String(oldList[i].id) !== String(newList[i].id)) {
                    sameOrder = false;
                    break;
                }
            }
            if (sameOrder) return;

            const oldPosById = new Map();
            for (let i = 0; i < oldList.length; i++) {
                oldPosById.set(String(oldList[i].id), i);
            }

            const seq = [];
            for (let i = 0; i < newList.length; i++) {
                const id = String(newList[i].id);
                const oldPos = oldPosById.get(id);
                if (typeof oldPos !== 'number') return; // children 集合变化（保险兜底）
                seq.push({ id, oldPos });
            }

            // 计算 LIS（基于 oldPos，得到最大稳定子序列），其余视为 moved
            const tails = [];
            const tailsIdx = [];
            const prevIdx = new Array(seq.length).fill(-1);

            for (let i = 0; i < seq.length; i++) {
                const v = seq[i].oldPos;
                let lo = 0;
                let hi = tails.length;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (tails[mid] < v) lo = mid + 1;
                    else hi = mid;
                }
                const pos = lo;
                if (pos > 0) prevIdx[i] = tailsIdx[pos - 1];
                if (pos === tails.length) {
                    tails.push(v);
                    tailsIdx.push(i);
                } else {
                    tails[pos] = v;
                    tailsIdx[pos] = i;
                }
            }

            const stableIds = new Set();
            let k = tailsIdx.length ? tailsIdx[tailsIdx.length - 1] : -1;
            while (k >= 0) {
                stableIds.add(seq[k].id);
                k = prevIdx[k];
            }

            for (const item of seq) {
                if (!stableIds.has(item.id)) {
                    markMoved(item.id);
                }
            }
        });
    }

    return compactStructuralRootChanges(changes, newTree);
}

// 重建树结构，包含删除的节点（保持原始位置）
function rebuildTreeWithDeleted(oldTree, newTree, changeMap) {
    ;

    if (!oldTree || !oldTree[0] || !newTree || !newTree[0]) {
        ;
        return newTree;
    }

    // 防止循环引用的集合
    const visitedIds = new Set();
    const MAX_DEPTH = 50;

    // 基于旧树重建，添加新节点和保留删除节点
    function rebuildNode(oldNode, newNodes, depth = 0) {
        // 安全检查
        if (!oldNode || typeof oldNode.id === 'undefined') {
            ;
            return null;
        }

        // 深度限制
        if (depth > MAX_DEPTH) {
            console.warn('[树重建] 超过最大深度限制:', depth);
            return null;
        }

        // 循环引用检测
        if (visitedIds.has(oldNode.id)) {
            console.warn('[树重建] 检测到循环引用:', oldNode.id);
            return null;
        }
        visitedIds.add(oldNode.id);

        // 在新树中查找对应的节点
        const newNode = newNodes ? newNodes.find(n => n && n.id === oldNode.id) : null;
        const change = changeMap ? changeMap.get(oldNode.id) : null;

        if (change && change.type === 'deleted') {
            // 节点被删除，保留但标记
            ;
            const snapshotNode = cloneBookmarkNodeSnapshot(change.deleted && (change.deleted.nodeSnapshot || change.deleted.node));
            const deletedNodeCopy = snapshotNode || JSON.parse(JSON.stringify(oldNode));

            if ((!Array.isArray(deletedNodeCopy.children) || deletedNodeCopy.children.length === 0) &&
                Array.isArray(oldNode.children) && oldNode.children.length > 0) {
                try {
                    deletedNodeCopy.children = JSON.parse(JSON.stringify(oldNode.children));
                } catch (_) {
                    deletedNodeCopy.children = oldNode.children.map(child => cloneBookmarkNodeSnapshot(child)).filter(Boolean);
                }
            }

            return deletedNodeCopy;
        } else if (newNode) {
            // 节点存在于新树中
            const nodeCopy = JSON.parse(JSON.stringify(newNode));

            // 处理子节点：合并新旧子节点
            if (oldNode.children || newNode.children) {
                const childrenMap = new Map();

                // 先添加旧的子节点
                if (oldNode.children) {
                    oldNode.children.forEach((child, index) => {
                        childrenMap.set(child.id, { node: child, index, source: 'old' });
                    });
                }

                // 更新或添加新的子节点
                if (newNode.children) {
                    newNode.children.forEach((child, index) => {
                        childrenMap.set(child.id, { node: child, index, source: 'new' });
                    });
                }

                // 重建子节点列表，保持原始顺序
                const rebuiltChildren = [];

                // 按照旧树的顺序遍历
                if (oldNode.children) {
                    oldNode.children.forEach(oldChild => {
                        if (!oldChild) return; // 跳过null/undefined子节点

                        const childInfo = childrenMap.get(oldChild.id);
                        if (childInfo) {
                            const rebuiltChild = rebuildNode(oldChild, newNode.children, depth + 1);
                            if (rebuiltChild) {
                                rebuiltChildren.push(rebuiltChild);
                            }
                        }
                    });
                }

                // 添加新增的子节点
                if (newNode.children) {
                    newNode.children.forEach(newChild => {
                        if (!newChild) return; // 跳过null/undefined子节点

                        if (!oldNode.children || !oldNode.children.find(c => c && c.id === newChild.id)) {
                            // 这是新增的节点
                            ;
                            rebuiltChildren.push(newChild);
                        }
                    });
                }

                nodeCopy.children = rebuiltChildren;
            }

            return nodeCopy;
        } else if (newNodes === null && change && change.type === 'deleted') {
            // 父节点已删除，这个子节点也视为删除，保留但标记
            ;
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));

            // 递归处理子节点
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children.map(child => rebuildNode(child, null, depth + 1)).filter(n => n !== null);
            }

            return deletedNodeCopy;
        } else {
            // 节点在新树中不存在，不是删除，跳过它
            ;
            return null;
        }
    }

    // 重建根节点
    const rebuiltRoot = rebuildNode(oldTree[0], [newTree[0]]);

    ;
    return [rebuiltRoot];
}

// 从完整路径中提取父文件夹路径（去掉最后一级）
function getParentFolderPath(fullPath, lang = 'zh_CN') {
    if (!fullPath) return lang === 'zh_CN' ? '未知位置' : 'Unknown';

    // 分割路径（使用 ' > ' 作为分隔符）
    const parts = fullPath.split(' > ').filter(p => p.trim());

    // 如果只有一级（根目录），直接返回
    if (parts.length <= 1) {
        return lang === 'zh_CN' ? '根目录' : 'Root';
    }

    // 去掉最后一级（书签/文件夹自己的名称），保留父文件夹路径
    parts.pop();
    return parts.join(' > ');
}

// 智能检测父路径是否发生变化（重命名、移动、删除等）
// 返回 { originalPath, currentPath, hasChanges }
function detectParentPathChanges(fullOldPath, oldTree, newTree, lang = 'zh_CN') {
    const parentPath = getParentFolderPath(fullOldPath, lang);

    // 如果是根目录，不需要检测
    if (parentPath === '根目录' || parentPath === 'Root') {
        return {
            originalPath: parentPath,
            currentPath: null,
            hasChanges: false
        };
    }

    // 分解父路径中的文件夹名称
    const folderNames = parentPath.split(' > ').filter(p => p.trim());

    if (folderNames.length === 0) {
        return {
            originalPath: parentPath,
            currentPath: null,
            hasChanges: false
        };
    }

    // 在旧树中找到这些文件夹对应的ID
    const folderIds = findFolderIdsByPath(oldTree, folderNames);

    if (folderIds.length === 0) {
        return {
            originalPath: parentPath,
            currentPath: null,
            hasChanges: false
        };
    }

    // 检查这些文件夹在新树中的路径
    let hasChanges = false;
    const currentPaths = [];

    folderIds.forEach(folderId => {
        if (treeChangeMap && treeChangeMap.has(folderId)) {
            const change = treeChangeMap.get(folderId);
            // 如果文件夹被移动、重命名或删除
            if (change.type === 'moved' || change.type === 'modified' || change.type === 'deleted' ||
                change.type.includes('moved') || change.type.includes('modified')) {
                hasChanges = true;
            }
        }
    });

    // 如果有变化，构建当前路径
    let currentPath = null;
    if (hasChanges && newTree) {
        // 尝试在新树中找到最后一个文件夹（最深层的父文件夹）
        const lastFolderId = folderIds[folderIds.length - 1];
        currentPath = findNodePathInTree(newTree, lastFolderId);

        if (currentPath) {
            // 去掉最后一级（这是找到的文件夹自己）
            currentPath = getParentFolderPath(currentPath + ' > dummy', lang);
        }
    }

    return {
        originalPath: parentPath,
        currentPath: currentPath,
        hasChanges: hasChanges && currentPath && currentPath !== parentPath
    };
}

// 根据路径中的文件夹名称找到对应的ID
function findFolderIdsByPath(tree, folderNames) {
    const ids = [];

    if (!tree || !tree[0] || folderNames.length === 0) {
        return ids;
    }

    let currentNodes = [tree[0]];

    for (const folderName of folderNames) {
        let found = false;

        for (const node of currentNodes) {
            if (node.children) {
                const folder = node.children.find(child =>
                    child.title === folderName && !child.url
                );

                if (folder) {
                    ids.push(folder.id);
                    currentNodes = [folder];
                    found = true;
                    break;
                }
            }
        }

        if (!found) break;
    }

    return ids;
}

// 在树中根据ID找到节点的完整路径
function findNodePathInTree(tree, nodeId) {
    if (!tree || !tree[0]) return null;

    const path = [];

    function traverse(node, currentPath) {
        if (node.id === nodeId) {
            path.push(...currentPath, node.title);
            return true;
        }

        if (node.children) {
            for (const child of node.children) {
                if (traverse(child, [...currentPath, node.title])) {
                    return true;
                }
            }
        }

        return false;
    }

    if (traverse(tree[0], [])) {
        return path.join(' > ');
    }

    return null;
}

// 渲染带变动标记的树节点
// Helper to identify nodes that must be expanded because they contain changes
function computeForceExpandSet(nodes, changeMap, explicitMovedIdSet = null) {
    const set = new Set();
    const hasAny =
        (!!(changeMap && changeMap.size)) ||
        (!!(explicitMovedIdSet && explicitMovedIdSet.size));
    if (!nodes || !hasAny) return set;

    // Recursive check. Returns true if node or descendants have changes.
    const check = (node) => {
        if (!node) return false;
        const id = String(node.id);
        let hasChange =
            (!!(changeMap && changeMap.has(node.id))) ||
            (!!(explicitMovedIdSet && explicitMovedIdSet.has(id)));

        if (node.children) {
            node.children.forEach(child => {
                if (check(child)) {
                    hasChange = true;
                }
            });
        }

        // If this node or any child has changes, this node must be expanded/rendered
        // Note: we might want to distinguish between "render children" and "expand visually".
        // Here we put it in the set, meaning "override lazy loading stop".
        if (hasChange) {
            set.add(node.id);
        }
        return hasChange;
    };

    if (Array.isArray(nodes)) {
        nodes.forEach(node => check(node));
    } else {
        check(nodes);
    }
    return set;
}

function renderTreeNodeWithChanges(node, level = 0, maxDepth = 50, visitedIds = new Set(), forceExpandSet = null, options = {}, underDeletedAncestor = false, inheritedFolderChange = '') {
    void forceExpandSet;
    void options;
    void underDeletedAncestor;
    void inheritedFolderChange;

    const MAX_DEPTH = maxDepth;
    const MAX_NODES = 10000;

    if (!node) return '';
    if (level > MAX_DEPTH) {
        console.warn('[renderTreeNodeWithChanges] 超过最大深度限制:', level);
        return '';
    }
    if (visitedIds.has(node.id)) {
        console.warn('[renderTreeNodeWithChanges] 检测到循环引用:', node.id);
        return '';
    }
    visitedIds.add(node.id);
    if (visitedIds.size > MAX_NODES) {
        console.warn('[renderTreeNodeWithChanges] 超过最大节点限制');
        return '';
    }

    if (node.url) {
        const favicon = getFaviconUrl(node.url);
        return `
            <div class="tree-node">
                <div class="tree-item" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-url="${escapeHtml(node.url || '')}" data-node-type="bookmark" data-node-level="${level}" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                    <span class="tree-toggle" style="opacity: 0"></span>
                    ${favicon ? `<img class="tree-icon" src="${favicon}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                    <a href="${escapeHtml(node.url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer">${escapeHtml(node.title)}</a>
                    <span class="tree-item-hover-actions">
                        <span class="tree-delete-icon" data-action="delete-node" draggable="false" aria-label="${currentLang === 'en' ? 'Delete' : '删除'}"></span>
                        <span class="tree-trace-icon" data-action="trace-submenu-trigger" draggable="false" aria-label="${currentLang === 'en' ? 'Trace' : '临时溯源'}"></span>
                        <span class="tree-tip-icon" data-action="open-tag-popover" draggable="false" aria-label="${currentLang === 'en' ? 'Tags' : '标签'}"></span>
                    </span>
                </div>
            </div>
        `;
    }

    const isLazyStop = CANVAS_PERMANENT_TREE_LAZY_ENABLED && currentView === 'canvas' && level > 0;
    if (isLazyStop) {
        const childCount = Array.isArray(node.children) ? node.children.length : 0;
        const hasChildren = childCount > 0;
        return `
            <div class="tree-node">
                <div class="tree-item" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-type="folder" data-node-level="${level}" data-has-children="${hasChildren ? 'true' : 'false'}" data-children-loaded="${hasChildren ? 'false' : 'true'}" data-child-count="${childCount}" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                    <span class="tree-toggle"><i class="fas fa-chevron-right"></i></span>
                    <i class="tree-icon fas fa-folder"></i>
                    <span class="tree-label">${escapeHtml(node.title)}</span>
                    <span class="tree-item-hover-actions">
                        <span class="tree-delete-icon" data-action="delete-node" draggable="false" aria-label="${currentLang === 'en' ? 'Delete' : '删除'}"></span>
                        <span class="tree-trace-icon" data-action="trace-submenu-trigger" draggable="false" aria-label="${currentLang === 'en' ? 'Trace' : '临时溯源'}"></span>
                        <span class="tree-tip-icon" data-action="open-tag-popover" draggable="false" aria-label="${currentLang === 'en' ? 'Tags' : '标签'}"></span>
                    </span>
                </div>
                <div class="tree-children"></div>
            </div>
        `;
    }

    const children = Array.isArray(node.children) ? node.children : [];
    const originalPos = new Map();
    for (let i = 0; i < children.length; i++) originalPos.set(children[i]?.id, i);
    const sortedChildren = children.slice().sort((a, b) => {
        const pa = originalPos.get(a?.id) ?? Number.POSITIVE_INFINITY;
        const pb = originalPos.get(b?.id) ?? Number.POSITIVE_INFINITY;
        return pa - pb;
    });

    return `
            <div class="tree-node">
                <div class="tree-item" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-type="folder" data-node-level="${level}" data-has-children="${Array.isArray(node.children) && node.children.length ? 'true' : 'false'}" data-children-loaded="true" data-child-count="${Array.isArray(node.children) ? node.children.length : 0}" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                    <span class="tree-toggle ${level === 0 ? 'expanded' : ''}"><i class="fas fa-chevron-right"></i></span>
                    <i class="tree-icon fas fa-folder${level === 0 ? '-open' : ''}"></i>
                    <span class="tree-label">${escapeHtml(node.title)}</span>
                    <span class="tree-item-hover-actions">
                        <span class="tree-delete-icon" data-action="delete-node" draggable="false" aria-label="${currentLang === 'en' ? 'Delete' : '删除'}"></span>
                        <span class="tree-trace-icon" data-action="trace-submenu-trigger" draggable="false" aria-label="${currentLang === 'en' ? 'Trace' : '临时溯源'}"></span>
                        <span class="tree-tip-icon" data-action="open-tag-popover" draggable="false" aria-label="${currentLang === 'en' ? 'Tags' : '标签'}"></span>
                    </span>
                </div>
                <div class="tree-children ${level === 0 ? 'expanded' : ''}">
                    ${sortedChildren.map(child => renderTreeNodeWithChanges(child, level + 1, maxDepth, visitedIds, null, options, false, '')).join('')}
                </div>
            </div>
        `;
}

function ensureTreeLegendExists(container) {
    ensureCanvasLazyLegend(container);
}

function cloneBookmarkNodeSnapshot(node) {
    if (!node || typeof node !== 'object') return null;
    try {
        return JSON.parse(JSON.stringify(node));
    } catch (_) {
        return null;
    }
}

function enrichRemoveInfoWithSnapshot(id, removeInfo) {
    const next = (removeInfo && typeof removeInfo === 'object') ? { ...removeInfo } : {};
    if (!next.node) {
        try {
            const sid = String(id);
            const renderIndex = getCachedRenderTreeIndex();
            const currentIndex = getCachedCurrentTreeIndex();
            const fromRender = renderIndex && renderIndex.get(sid);
            const fromCurrent = currentIndex && currentIndex.get(sid);
            next.node = cloneBookmarkNodeSnapshot(fromRender || fromCurrent);
        } catch (_) { }
    } else {
        next.node = cloneBookmarkNodeSnapshot(next.node);
    }

    if (typeof next.parentId === 'undefined' && next.node && typeof next.node.parentId !== 'undefined') {
        next.parentId = next.node.parentId;
    }
    if (typeof next.index !== 'number' && next.node && typeof next.node.index === 'number') {
        next.index = next.node.index;
    }
    return next;
}



// =============================================================================
// 搜索功能（核心逻辑已移动到 search/search.js）
// =============================================================================

// NOTE:
// 顶部搜索框在多个视图/子标签共用。
// 这里做“请求隔离 + 防抖取消”，避免：
// - 用户清空输入 / 切换视图后，旧的 debounce 回调仍执行，导致候选列表“串台”
// - 首次进入页面/快捷键进入/刷新时，初始化时序导致的旧状态残留

let mainSearchDebounceTimer = null;
let mainSearchDebounceSeq = 0;
let mainSearchRenderSeq = 0;

function getMainSearchContextKey() {
    const view = (typeof currentView === 'string' && currentView) ? currentView : 'unknown';
    try {
        const ctx = window.SearchContextManager && window.SearchContextManager.currentContext
            ? window.SearchContextManager.currentContext
            : null;
        if (ctx && typeof ctx === 'object') {
            const parts = [ctx.view || view, ctx.tab, ctx.subTab].filter(Boolean);
            if (parts.length) return parts.join('|');
        }
    } catch (_) { }
    return view;
}

function cancelPendingMainSearchDebounce() {
    try {
        if (mainSearchDebounceTimer) {
            clearTimeout(mainSearchDebounceTimer);
            mainSearchDebounceTimer = null;
        }
    } catch (_) { }
    // bump seq so any already-scheduled closures become stale
    mainSearchDebounceSeq += 1;
    mainSearchRenderSeq += 1;
}

try {
    window.cancelPendingMainSearchDebounce = cancelPendingMainSearchDebounce;
} catch (_) { }

function handleSearch(e) {
    const inputEl = e && e.target;
    const raw = (inputEl && typeof inputEl.value === 'string') ? inputEl.value : '';
    const normalizedQuery = raw.trim().toLowerCase();

    // 清空输入：立即执行清理，且取消所有排队的搜索
    if (!normalizedQuery) {
        cancelPendingMainSearchDebounce();
        if (currentView === 'canvas') {
            try {
                if (typeof shouldShowEmptyQuerySuggestions === 'function' && typeof renderCanvasSearchSuggestions === 'function') {
                    if (shouldShowEmptyQuerySuggestions()) {
                        renderCanvasSearchSuggestions();
                        if (typeof showSearchResultsPanel === 'function') {
                            showSearchResultsPanel();
                        }
                        return;
                    }
                }
            } catch (_) { }
        }
        performSearch('');
        return;
    }

    const seq = (mainSearchDebounceSeq += 1);
    const scheduledContextKey = getMainSearchContextKey();

    if (mainSearchDebounceTimer) clearTimeout(mainSearchDebounceTimer);
    mainSearchDebounceTimer = setTimeout(() => {
        // 1) 新的输入事件已经触发，旧回调作废
        if (seq !== mainSearchDebounceSeq) return;

        // 2) 切换了视图/子标签：作废（避免候选列表串台）
        if (scheduledContextKey !== getMainSearchContextKey()) return;

        // 3) 输入框内容已变化：作废（避免输入已清空但旧结果仍渲染）
        const currentInput = document.getElementById('searchInput');
        const currentNormalized = (currentInput && typeof currentInput.value === 'string')
            ? currentInput.value.trim().toLowerCase()
            : '';
        if (currentNormalized !== normalizedQuery) return;

        performSearch(normalizedQuery);
    }, 260);
}

function performSearch(query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        mainSearchRenderSeq += 1;
        hideSearchResultsPanel();
        if (typeof clearCanvasSearchHighlight === 'function') {
            clearCanvasSearchHighlight();
        }
        return;
    }

    // 根据当前视图执行搜索（仅 Canvas）
    if (currentView === 'canvas') {
        if (typeof searchCanvasAndRender === 'function') {
            const renderSeq = (mainSearchRenderSeq += 1);
            const scheduledContextKey = getMainSearchContextKey();
            const renderNow = () => {
                if (renderSeq !== mainSearchRenderSeq) return;
                if (scheduledContextKey !== getMainSearchContextKey()) return;

                const currentInput = document.getElementById('searchInput');
                const currentNormalized = (currentInput && typeof currentInput.value === 'string')
                    ? currentInput.value.trim().toLowerCase()
                    : '';
                if (currentNormalized !== normalizedQuery) return;

                searchCanvasAndRender(normalizedQuery, { source: 'input' });
            };

            const ensureIndex = typeof window.ensureCanvasSearchIndexForActiveMode === 'function'
                ? window.ensureCanvasSearchIndexForActiveMode
                : null;
            if (ensureIndex) {
                Promise.resolve()
                    .then(() => ensureIndex())
                    .then(renderNow)
                    .catch((err) => {
                        console.warn('[Search] Failed to load IndexedDB search index before rendering. Falling back to sync build:', err);
                        renderNow();
                    });
            } else {
                renderNow();
            }
        } else {
            console.warn('[Search] searchCanvasAndRender not available');
            hideSearchResultsPanel();
        }
    }
}

// =============================================================================
// 主题和语言切换
// =============================================================================

// 主题和语言切换 - 独立设置，主UI优先
// 设置覆盖后会显示重置按钮

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    // 主题切换后立即刷新画布连接线标签背景色
    try {
        if (currentView === 'canvas' && typeof renderEdges === 'function') {
            renderEdges();
        }
    } catch (_) { }

    // Sync with main UI:
    // - theme.js uses localStorage.themePreference
    // - History Viewer follows chrome.storage.local.currentTheme
    try {
        __saveLocalStorageRaw('themePreference', currentTheme);
        __removeLocalStorageKey('historyViewerHasCustomTheme');
        __removeLocalStorageKey('historyViewerCustomTheme');
    } catch (_) { }
    try {
        if (browserAPI && browserAPI.storage && browserAPI.storage.local) {
            browserAPI.storage.local.set({ currentTheme }, () => { });
        }
    } catch (_) { }

    // 更新图标
    const icon = document.querySelector('#themeToggle i');
    if (icon) {
        icon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
    const settingsIcon = document.querySelector('#settingsMenu [data-action="toggle-theme"] i');
    if (settingsIcon) {
        settingsIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
}

function toggleLanguage() {
    currentLang = currentLang === 'zh_CN' ? 'en' : 'zh_CN';
    window.currentLang = currentLang; // 同步到 window

    // Sync language preference in current page and extension storage.
    try {
        __saveLocalStorageRaw('preferredLang', currentLang);
        __removeLocalStorageKey('historyViewerHasCustomLang');
        __removeLocalStorageKey('historyViewerCustomLang');
    } catch (_) { }
    try {
        if (browserAPI && browserAPI.storage && browserAPI.storage.local) {
            browserAPI.storage.local.set({ preferredLang: currentLang }, () => { });
        }
    } catch (_) { }

    applyLanguage();

    // 只更新界面文字，不重新渲染内容（避免图标重新加载）
    // renderCurrentView();

    // 手动更新需要多语言的UI元素（不涉及书签树内容）
    updateLanguageDependentUI();

    // [User Request] 更新搜索组件语言
    if (typeof window.updateSearchUILanguage === 'function') {
        window.updateSearchUILanguage();
    }

    // Canvas-only：不涉及热力图/关联记录
}

// 更新依赖语言的UI元素（不重新渲染内容，避免图标重新加载）
function updateLanguageDependentUI() {
    const isEn = currentLang === 'en';

    // 更新加载文本（如果存在）
    const loadingTexts = document.querySelectorAll('.loading');
    loadingTexts.forEach(el => {
        if (el.textContent.includes('Loading') || el.textContent.includes('加载中')) {
            el.textContent = i18n.loading[currentLang];
        }
    });

    // 更新空状态文本
    const emptyStates = document.querySelectorAll('.empty-state');
    emptyStates.forEach(el => {
        if (el.textContent.includes('No') || el.textContent.includes('没有')) {
            el.textContent = isEn ? 'No data' : '没有数据';
        }
    });

    // ===== 更新临时栏目相关的多语言元素 =====

    // 1. 更新临时栏目的按钮tooltip
    document.querySelectorAll('.temp-node-rename-btn').forEach(btn => {
        const label = isEn ? 'Rename section' : '重命名栏目';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    document.querySelectorAll('.temp-node-color-btn, .temp-node-color-input').forEach(btn => {
        const label = isEn ? 'Change color' : '调整栏目颜色';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    document.querySelectorAll('.temp-color-lock-btn').forEach(btn => {
        const locked = btn.classList.contains('locked');
        const label = locked
            ? (isEn ? 'Unlock color' : '解除锁定')
            : (isEn ? 'Lock color' : '锁定颜色');
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    document.querySelectorAll('.temp-node-close').forEach(btn => {
        const label = isEn ? 'Remove section' : '删除临时栏目';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    // 2. 更新临时栏目说明（现为 WYSIWYG editor）
    document.querySelectorAll('.temp-node-description').forEach(descEl => {
        const placeholder = isEn ? 'Click to add description...' : '点击添加说明...';
        try {
            descEl.setAttribute('data-placeholder', placeholder);
            descEl.setAttribute('aria-label', placeholder);
        } catch (_) { }

        const text = (descEl.textContent || '').replace(/\u200B/g, '').trim();
        const hasNonText = !!descEl.querySelector('hr, input[type="checkbox"], ul, ol, blockquote, h1, h2, h3, h4, h5, h6');
        const hasContent = Boolean(text) || hasNonText;
        descEl.title = hasContent
            ? (isEn ? 'Click to edit' : '点击编辑说明')
            : (isEn ? 'Click to add description' : '点击添加说明');
    });

    // 3. 更新说明编辑按钮的tooltip
    document.querySelectorAll('.temp-node-desc-edit-btn').forEach(btn => {
        btn.title = isEn ? 'Edit description' : '编辑说明';
    });

    document.querySelectorAll('.temp-node-desc-format-btn').forEach(btn => {
        btn.title = isEn ? 'Format toolbar' : '格式工具栏';
    });

    document.querySelectorAll('.temp-node-desc-delete-btn').forEach(btn => {
        btn.title = isEn ? 'Clear input' : '清空输入框';
    });

    // 3.5. Update Permanent Section Titles (Copies)
    const pTitle = i18n.permanentSectionTitle[currentLang];
    document.querySelectorAll('.permanent-section-copy .permanent-section-title h3').forEach(el => {
        el.textContent = pTitle;
    });

    // 4. 更新永久栏目的说明提示 (Including Copies)
    document.querySelectorAll('.permanent-section-tip-collapsed span').forEach(el => {
        const text = isEn ? 'Click to add description...' : '点击添加说明...';
        el.textContent = text;
    });

    document.querySelectorAll('.permanent-section-tip').forEach(tip => {
        const placeholder = isEn ? 'Click to add description...' : '点击添加说明...';
        try {
            tip.setAttribute('data-placeholder', placeholder);
            tip.setAttribute('aria-label', placeholder);
        } catch (_) { }

        const text = (tip.textContent || '').replace(/\u200B/g, '').trim();
        const hasNonText = !!tip.querySelector('hr, input[type="checkbox"], ul, ol, blockquote, h1, h2, h3, h4, h5, h6');
        const hasContent = Boolean(text) || hasNonText;
        tip.title = hasContent
            ? (isEn ? 'Click to edit' : '点击编辑说明')
            : (isEn ? 'Click to add description' : '点击添加说明');
    });

    document.querySelectorAll('.permanent-section-tip-format-btn').forEach(btn => {
        btn.title = isEn ? 'Format toolbar' : '格式工具栏';
    });

    ;
}

// =============================================================================
// 实时更新
// =============================================================================

function handleStorageChange(changes, namespace) {
    if (namespace !== 'local') return;

    ;

    // 主题变化（只在没有覆盖设置时跟随主UI）
    if (changes.currentTheme && !hasThemeOverride()) {
        const newTheme = changes.currentTheme.newValue;
        ;
        currentTheme = newTheme;
        if (currentTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');

        // 主题切换后立即刷新连线标签背景色
        try {
            if (currentView === 'canvas' && typeof renderEdges === 'function') {
                renderEdges();
            }
        } catch (_) { }

        // 更新主题切换按钮图标
        const icon = document.querySelector('#themeToggle i');
        if (icon) {
            icon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    // 语言变化（只在没有覆盖设置时跟随主UI）
    if (changes.preferredLang && !hasLangOverride()) {
        const newLang = changes.preferredLang.newValue;
        ;
        currentLang = newLang;
        window.currentLang = currentLang; // 同步到 window

        // 更新语言切换按钮文本
        const langText = document.querySelector('#langToggle .lang-text');
        if (langText) {
            langText.textContent = currentLang === 'zh_CN' ? 'EN' : '中';
        }

        // 应用新语言到所有UI元素
        applyLanguage();

        // 重新渲染当前视图以应用语言
        renderCurrentView();
    }

}


// =============================================================================
// 书签API监听（实时更新书签树）
// =============================================================================

const BULK_BOOKMARK_MUTATION_THRESHOLD = 200;
const BULK_BOOKMARK_MUTATION_QUIET_MS = 220;

let pendingBookmarkMutationEvents = [];
let pendingBookmarkMutationTimer = null;
let bookmarkMutationFlushInProgress = false;
let bookmarkMutationFlushQueued = false;
let bookmarkMutationFlushPromise = null;
let bulkBookmarkMutationTreeRefreshTimer = null;

function scheduleBulkBookmarkMutationTreeRefresh(reason = '', delayMs = 700) {
    try {
        if (bulkBookmarkMutationTreeRefreshTimer) clearTimeout(bulkBookmarkMutationTreeRefreshTimer);
        bulkBookmarkMutationTreeRefreshTimer = setTimeout(async () => {
            bulkBookmarkMutationTreeRefreshTimer = null;
            if (currentView !== 'canvas') return;
            cachedTreeData = null;
            lastTreeFingerprint = null;
            lastTreeSnapshotVersion = null;
            cachedCurrentTreeIndex = null;
            cachedRenderTreeIndex = null;
            try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            await renderTreeView(false);
        }, Math.max(0, Number(delayMs) || 0));
    } catch (e) {
        console.warn('[书签监听] 批量刷新调度失败:', e);
    }
}

async function handleBookmarkCreateRealtime(id, bookmark, options = {}) {
    if (!(options && options.skipBcsIncremental === true)) {
        await applyPermanentBookmarkEventsToBcsIncremental({
            type: 'created',
            id: String(id),
            bookmark
        }, 'onCreated');
    }
    addBookmarkToCache(bookmark);

    if (currentView === 'canvas') {
        const appliedToCachedTree = applyIncrementalCreateToCachedCurrentTree(id, bookmark);
        if (!appliedToCachedTree) {
            scheduleCachedCurrentTreeSnapshotRefresh('onCreated-fast-fallback', 40);
        }
        if (appliedToCachedTree) refreshPermanentSharedSourceAfterDomPatch('onCreated');
        const domPatched = appliedToCachedTree && applyPermanentCreateDomPatch(id, bookmark);
        if (!domPatched) {
            schedulePermanentTreeSharedMutationRefresh('onCreated');
        }
        scheduleCachedCurrentTreeSnapshotRefresh('onCreated');
    }
}

async function handleBookmarkRemoveRealtime(id, removeInfo, options = {}) {
    const enrichedRemoveInfo = enrichRemoveInfoWithSnapshot(id, removeInfo);
    if (!(options && options.skipBcsIncremental === true)) {
        await applyPermanentBookmarkEventsToBcsIncremental({
            type: 'removed',
            id: String(id),
            removeInfo: enrichedRemoveInfo || removeInfo
        }, 'onRemoved');
    }
    removeBookmarkFromCache(id, enrichedRemoveInfo || removeInfo);

    clearIncrementalDeletedSnapshots('onRemoved');

    if (currentView === 'canvas') {
        const appliedToCachedTree = applyIncrementalRemoveFromCachedCurrentTree(id, enrichedRemoveInfo);
        if (!appliedToCachedTree) {
            scheduleCachedCurrentTreeSnapshotRefresh('onRemoved-fast-fallback', 40);
        }
        if (appliedToCachedTree) refreshPermanentSharedSourceAfterDomPatch('onRemoved');
        const domPatched = appliedToCachedTree && applyPermanentRemoveDomPatch(id, enrichedRemoveInfo);
        if (!domPatched) {
            schedulePermanentTreeSharedMutationRefresh('onRemoved');
        }
        scheduleCachedCurrentTreeSnapshotRefresh('onRemoved');
    }
}

async function handleBookmarkMoveRealtime(id, moveInfo, options = {}) {
    if (!(options && options.skipBcsIncremental === true)) {
        await applyPermanentBookmarkEventsToBcsIncremental({
            type: 'moved',
            id: String(id),
            moveInfo
        }, 'onMoved');
    }
    moveBookmarkInCache(id, moveInfo);

    if (currentView === 'canvas') {
        const appliedToCachedTree = applyIncrementalMoveToCachedCurrentTree(id, moveInfo);
        if (!appliedToCachedTree) {
            scheduleCachedCurrentTreeSnapshotRefresh('onMoved-fast-fallback', 40);
        }
        if (appliedToCachedTree) refreshPermanentSharedSourceAfterDomPatch('onMoved');
        const domPatched = appliedToCachedTree && applyPermanentMoveDomPatch(id, moveInfo);
        scheduleCachedCurrentTreeSnapshotRefresh('onMoved');

        if (!domPatched) {
            schedulePermanentTreeSharedMutationRefresh('onMoved');
        }
    }
}

function scheduleBookmarkMutationEventFlush() {
    if (pendingBookmarkMutationTimer) {
        clearTimeout(pendingBookmarkMutationTimer);
    }
    pendingBookmarkMutationTimer = setTimeout(() => {
        pendingBookmarkMutationTimer = null;
        flushPendingBookmarkMutationEvents('quiet-window').catch((e) => {
            console.warn('[书签监听] 书签变更批处理 flush 失败:', e);
        });
    }, BULK_BOOKMARK_MUTATION_QUIET_MS);
}

function enqueueBookmarkMutationEvent(event) {
    if (!event || !event.type || !event.id) return;
    pendingBookmarkMutationEvents.push(event);
    scheduleBookmarkMutationEventFlush();
}

async function flushPendingBookmarkMutationEvents(reason = '') {
    if (pendingBookmarkMutationTimer) {
        clearTimeout(pendingBookmarkMutationTimer);
        pendingBookmarkMutationTimer = null;
    }

    if (bookmarkMutationFlushInProgress) {
        bookmarkMutationFlushQueued = true;
        if (bookmarkMutationFlushPromise) await bookmarkMutationFlushPromise;
        return;
    }

    const flushPromise = (async () => {
        bookmarkMutationFlushInProgress = true;
        let flushReason = reason;

        try {
            while (true) {
                if (pendingBookmarkMutationTimer) {
                    clearTimeout(pendingBookmarkMutationTimer);
                    pendingBookmarkMutationTimer = null;
                }

                bookmarkMutationFlushQueued = false;

                if (isBookmarkBulkMuteActive()) {
                    clearBookmarkBulkQueuedEvents();
                    noteBookmarkBulkMutation(flushReason || 'bulk-bookmark-mutation');
                    clearCanvasLazyChangeHints('bulk-bookmark-mutation-muted');
                    return;
                }

                if (!pendingBookmarkMutationEvents.length) return;

                const batch = pendingBookmarkMutationEvents;
                pendingBookmarkMutationEvents = [];
                const isBulk = batch.length >= BULK_BOOKMARK_MUTATION_THRESHOLD;

                if (isBulk) {
                    ;

                    batch.forEach((event) => {
                        if (event.type === 'created') {
                            addBookmarkToCache(event.bookmark);
                            return;
                        }
                        if (event.type === 'removed') {
                            removeBookmarkFromCache(event.id, event.removeInfo);
                            return;
                        }
                        if (event.type === 'moved') {
                            moveBookmarkInCache(event.id, event.moveInfo);
                        }
                    });
                    schedulePermanentMainStorageSyncFromChrome('bulk-bookmark-mutation', 0);

                    if (currentView === 'canvas') {
                        scheduleCachedCurrentTreeSnapshotRefresh('bulk-bookmark-mutation', 320);
                        scheduleBulkBookmarkMutationTreeRefresh('bulk-bookmark-mutation-fallback', 900);
                    }
                    return;
                }

                await applyPermanentBookmarkEventsToBcsIncremental(batch, flushReason || 'bookmark-mutation');

                for (const event of batch) {
                    if (event.type === 'created') {
                        await handleBookmarkCreateRealtime(event.id, event.bookmark, { skipBcsIncremental: true });
                    } else if (event.type === 'removed') {
                        await handleBookmarkRemoveRealtime(event.id, event.removeInfo, { skipBcsIncremental: true });
                    } else if (event.type === 'moved') {
                        await handleBookmarkMoveRealtime(event.id, event.moveInfo, { skipBcsIncremental: true });
                    }
                }

                if (!bookmarkMutationFlushQueued) return;
                flushReason = 'queued';
            }
        } finally {
            bookmarkMutationFlushInProgress = false;
            bookmarkMutationFlushQueued = false;
        }
    })();

    bookmarkMutationFlushPromise = flushPromise;
    try {
        return await flushPromise;
    } finally {
        if (bookmarkMutationFlushPromise === flushPromise) {
            bookmarkMutationFlushPromise = null;
        }
    }
}

function setupBookmarkListener() {
    if (!browserAPI.bookmarks) {
        console.warn('[书签监听] 书签API不可用');
        return;
    }

    ;

    // 书签创建
    browserAPI.bookmarks.onCreated.addListener((id, bookmark) => {
        ;
        try {
            if (isBookmarkBulkMuteActive()) {
                noteBookmarkBulkMutation('bookmark-created');
                return;
            }
            enqueueBookmarkMutationEvent({
                type: 'created',
                id: String(id),
                bookmark
            });
        } catch (e) {
            console.warn('[书签监听] onCreated 处理异常:', e);
        }
    });

    // 书签删除
    browserAPI.bookmarks.onRemoved.addListener((id, removeInfo) => {
        ;
        try {
            if (isBookmarkBulkMuteActive()) {
                noteBookmarkBulkMutation('bookmark-removed');
                return;
            }
            const enriched = enrichRemoveInfoWithSnapshot(id, removeInfo);
            enqueueBookmarkMutationEvent({
                type: 'removed',
                id: String(id),
                removeInfo: enriched
            });
        } catch (e) {
            console.warn('[书签监听] onRemoved 处理异常:', e);
        }
    });

    // 书签修改
    browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
        ;
        try {
            if (isBookmarkBulkMuteActive()) {
                noteBookmarkBulkMutation('bookmark-changed');
                return;
            }
            await flushPendingBookmarkMutationEvents('before-onChanged');
            await applyPermanentBookmarkEventsToBcsIncremental({
                type: 'changed',
                id: String(id),
                changeInfo
            }, 'onChanged');
            updateBookmarkInCache(id, changeInfo);

            // 支持 canvas 视图（包含永久栏目的书签树）
            if (currentView === 'canvas') {
                const appliedToCachedTree = applyIncrementalChangeToCachedCurrentTree(id, changeInfo);
                if (!appliedToCachedTree) {
                    scheduleCachedCurrentTreeSnapshotRefresh('onChanged-fast-fallback', 40);
                }
                if (appliedToCachedTree) refreshPermanentSharedSourceAfterDomPatch('onChanged');
                const domPatched = appliedToCachedTree && applyPermanentChangeDomPatch(id, changeInfo);
                if (!domPatched) {
                    schedulePermanentTreeSharedMutationRefresh('onChanged');
                }
                scheduleCachedCurrentTreeSnapshotRefresh('onChanged');
            }
        } catch (e) {
            // 仅记录错误，不触发完全刷新以避免页面闪烁和滚动位置丢失
            console.warn('[书签监听] onChanged 处理异常:', e);
        }
    });

    // 书签移动
    browserAPI.bookmarks.onMoved.addListener(async (id, moveInfo) => {
        ;

        try {
            if (isBookmarkBulkMuteActive()) {
                noteBookmarkBulkMutation('bookmark-moved');
                return;
            }
            enqueueBookmarkMutationEvent({
                type: 'moved',
                id: String(id),
                moveInfo
            });
        } catch (e) {
            // 仅记录错误，不触发完全刷新以避免页面闪烁和滚动位置丢失
            console.warn('[书签监听] onMoved 处理异常:', e);
        }
    });

    if (browserAPI.bookmarks.onChildrenReordered && typeof browserAPI.bookmarks.onChildrenReordered.addListener === 'function') {
        browserAPI.bookmarks.onChildrenReordered.addListener((id, reorderInfo) => {
            ;
            try {
                if (isBookmarkBulkMuteActive()) {
                    noteBookmarkBulkMutation('bookmark-children-reordered');
                    return;
                }
                schedulePermanentMainStorageSyncFromChrome('bookmark-children-reordered', 0);
                if (currentView === 'canvas') {
                    scheduleCachedCurrentTreeSnapshotRefresh('bookmark-children-reordered', 120);
                }
            } catch (e) {
                console.warn('[书签监听] onChildrenReordered 处理异常:', e);
            }
        });
    }

    if (browserAPI.bookmarks.onImportBegan && typeof browserAPI.bookmarks.onImportBegan.addListener === 'function') {
        browserAPI.bookmarks.onImportBegan.addListener(() => {
            beginBookmarkBulkMute('browser-import', { needsRefresh: false }).catch((e) => {
                console.warn('[书签监听] onImportBegan 处理异常:', e);
            });
        });
    }

    if (browserAPI.bookmarks.onImportEnded && typeof browserAPI.bookmarks.onImportEnded.addListener === 'function') {
        browserAPI.bookmarks.onImportEnded.addListener(() => {
            endBookmarkBulkMute('browser-import', { resetBaseline: true, refreshTree: true }).then((result) => {
                if (result.mutated) {
                    schedulePermanentMainStorageSyncFromChrome('browser-import-ended', 0);
                }
            }).catch((e) => {
                console.warn('[书签监听] onImportEnded 处理异常:', e);
            });
        });
    }
}

// 如果当前在 Canvas 视图，刷新书签树
async function refreshTreeViewIfVisible() {
    if (currentView === 'canvas') {
        ;

        // 清除缓存，强制刷新
        cachedBookmarkTree = null;
        cachedTreeData = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;

        // 延迟一点刷新，避免频繁更新
        setTimeout(async () => {
            try {
                await renderTreeView(true);
                ;
            } catch (error) {
                console.error('[书签监听] 刷新树视图失败:', error);
            }
        }, 200);
    }
}

// =============================================================================
// 消息监听
// =============================================================================

function setupRealtimeMessageListener() {
    if (messageListenerRegistered) return;
    messageListenerRegistered = true;

    setupCanvasFullscreenBridgeStorageListener();

    browserAPI.runtime.onMessage.addListener((message) => {
        if (!message || !message.action) return;

        if (message.action === 'clearFaviconCache') {
            // 书签URL被修改，清除favicon缓存（静默）
            if (message.url) {
                FaviconCache.clear(message.url);
            }
        } else if (message.action === 'updateFaviconFromTab') {
            // 从打开的 tab 更新 favicon（静默）
            if (message.url && message.favIconUrl) {
                if (FaviconCache.isStoredFaviconData(message.favIconUrl)) {
                    const incomingDataUrl = message.favIconUrl;
                    Promise.resolve().then(async () => {
                        const existing = await FaviconCache.get(message.url);
                        const canBackfillHole = !existing || existing === 'failed' || existing === fallbackIcon;
                        const getDataUrlArea = (dataUrl) =>
                            new Promise((resolve) => {
                                if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
                                    resolve(0);
                                    return;
                                }
                                const img = new Image();
                                img.onload = () => {
                                    const w = img.naturalWidth || img.width || 0;
                                    const h = img.naturalHeight || img.height || 0;
                                    resolve(w * h);
                                };
                                img.onerror = () => resolve(0);
                                img.src = dataUrl;
                            });

                        if (!canBackfillHole) {
                            const [existingArea, incomingArea] = await Promise.all([
                                getDataUrlArea(existing),
                                getDataUrlArea(incomingDataUrl)
                            ]);
                            const shouldSkipOverwrite = incomingArea > 0 && existingArea > 0 && incomingArea < existingArea;
                            if (shouldSkipOverwrite) {
                                return;
                            }
                        }

                        await FaviconCache.save(message.url, incomingDataUrl);
                        // 更新页面上对应的 favicon 图标
                        updateFaviconImages(message.url, incomingDataUrl);
                    }).catch(() => {
                        // 静默处理错误
                    });
                }
            }
        } else if (message.action === CANVAS_PAGE_FULLSCREEN_BRIDGE_ACTION) {
            tryHandleCanvasFullscreenBridgePayload(message);
        } else if (message.action === 'clearLocalStorage') {
            // 收到来自 background.js 的清除 localStorage 请求（"恢复到初始状态"功能）
            ;
            try {
                localStorage.clear();
                ;
            } catch (e) {
                console.warn('[history.js] 清除 localStorage 失败:', e);
            }
        }
    });
}

// =============================================================================
// 工具函数
// =============================================================================

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// 用于导出文件名的本地时间格式化（避免 toISOString 的 UTC 时区问题）
function formatTimeForFilename(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function sanitizeFilenameSegment(text) {
    return String(text || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function buildSequenceMapFromHistory(historyRecords) {
    const records = Array.isArray(historyRecords) ? historyRecords.slice() : [];
    records.sort((a, b) => Number(a?.time || 0) - Number(b?.time || 0));
    const map = new Map();
    const used = new Set();
    for (const r of records) {
        const seq = Number(r?.seqNumber);
        if (Number.isFinite(seq) && seq > 0) used.add(seq);
    }
    let next = 1;
    for (const r of records) {
        let seq = Number(r?.seqNumber);
        if (!(Number.isFinite(seq) && seq > 0)) {
            while (used.has(next)) next++;
            seq = next;
            used.add(seq);
            next++;
        }
        map.set(String(r.time), seq);
    }
    return map;
}

function formatSelectedSequenceRanges(seqNumbers, lang) {
    const delim = lang === 'zh_CN' ? '、' : ',';
    const nums = Array.from(new Set((seqNumbers || []).filter(n => Number.isFinite(n) && n > 0)))
        .sort((a, b) => a - b);
    if (nums.length === 0) return '';

    const parts = [];
    let start = nums[0];
    let end = nums[0];
    for (let i = 1; i < nums.length; i++) {
        const n = nums[i];
        if (n === end + 1) {
            end = n;
            continue;
        }
        parts.push(start === end ? String(start) : `${start}-${end}`);
        start = n;
        end = n;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    return parts.join(delim);
}

function generateBookmarkExportHTMLFromTree(treeRoot) {
    const escapeAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += '<TITLE>Bookmarks</TITLE>\n';
    html += '<H1>Bookmarks</H1>\n';
    html += '<DL><p>\n';

    const generateNodeHTML = (node, indentLevel) => {
        const indent = '    '.repeat(indentLevel);
        const title = escapeText(node?.title || '');
        const url = node?.url ? String(node.url) : '';
        const isFolder = !url && node && Array.isArray(node.children);

        if (isFolder) {
            let result = `${indent}<DT><H3>${title}</H3>\n`;
            result += `${indent}<DL><p>\n`;
            node.children.forEach(child => {
                result += generateNodeHTML(child, indentLevel + 1);
            });
            result += `${indent}</DL><p>\n`;
            return result;
        }

        if (url) {
            return `${indent}<DT><A HREF="${escapeAttr(url)}">${title}</A>\n`;
        }

        // fallback: treat as folder-ish if children exists, otherwise skip
        if (node && Array.isArray(node.children)) {
            let result = `${indent}<DT><H3>${title}</H3>\n`;
            result += `${indent}<DL><p>\n`;
            node.children.forEach(child => {
                result += generateNodeHTML(child, indentLevel + 1);
            });
            result += `${indent}</DL><p>\n`;
            return result;
        }

        return '';
    };

    const nodes = Array.isArray(treeRoot) ? treeRoot : [treeRoot];
    nodes.forEach(root => {
        if (!root) return;
        if (root.title) {
            html += generateNodeHTML({ title: root.title, children: root.children || [] }, 1);
            return;
        }
        if (Array.isArray(root.children)) {
            root.children.forEach(child => {
                html += generateNodeHTML(child, 1);
            });
        }
    });

    html += '</DL><p>\n';
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    document.querySelectorAll('.view.active .bookmark-tree').forEach(el => {
        el.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    });
}

function showError(message) {
    const container = document.querySelector('.view.active > div:last-child');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="empty-state-title">${escapeHtml(message)}</div>
            </div>
        `;
    }
}

function showToast(message, options = {}) {
    // 简单的提示功能
    const position = options && options.position === 'top-right' ? 'top-right' : 'bottom-right';
    const verticalPos = position === 'top-right' ? 'top: 20px;' : 'bottom: 20px;';
    const duration = options && typeof options.duration === 'number' ? options.duration : 2000;
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        ${verticalPos}
        right: 20px;
        padding: 12px 20px;
        background: var(--accent-primary);
        color: white;
        border-radius: 8px;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    if (options && options.icon) {
        const icon = document.createElement('i');
        icon.className = options.icon;
        if (options.spin) icon.style.animation = 'spin 1s linear infinite';
        toast.appendChild(icon);
    }
    
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);
    
    const targetParent = (typeof window.getOverlayContainer === 'function') ? window.getOverlayContainer() : document.body;
    targetParent.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    return {
        update: (msg) => {
            textSpan.textContent = msg;
        },
        close: () => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    };
}

window.showLoadingToast = function(initialMessage) {
    return showToast(initialMessage, {
        duration: 0,
        icon: 'fas fa-spinner',
        spin: true
    });
};

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    @keyframes spin {
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
