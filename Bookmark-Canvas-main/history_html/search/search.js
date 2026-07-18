/**
 * 搜索功能模块（Canvas 专用）
 * Search Module (Canvas-only)
 *
 * 文件位置：history_html/search/search.js
 *
 * Canvas 搜索：
 * - 搜索范围：`history.html` 的 `view=canvas`（书签画布视图）
 * - 说明搜索：MD卡片文本、连接线标签、临时栏目说明、永久栏目说明
 * - 卡片（组）搜索：#N序号定位、A-群组搜索、卡片组名字、标题匹配
 * - 行为：点击/回车选择结果后，画布平移到目标位置 + 高亮脉冲动画
 *
 * 依赖：
 * - history.js 中的全局变量：currentView, currentLang, cachedCurrentTree, cachedOldTree, lastTreeSnapshotVersion
 * - history.js 中的工具函数：escapeHtml, i18n
 * - bookmark_canvas_module.js 中的 CanvasState 对象
 */

// ==================== 模块状态 ====================

/**
 * 搜索 UI 状态
 */
const searchUiState = {
    view: null,
    query: '',
    selectedIndex: -1,
    results: [],
    resultSource: [],
    resultAll: [],
    resultPagingKey: '',
    resultVisibleCount: 0,
    resultHasMore: false,
    resultPageSize: 50,
    activeMode: 'bookmark',
    isMenuOpen: false,
    canvasSuggestionsVisible: false,

    // Canvas bookmark mode: group-by-section UI state
    bookmarkGroupCollapse: new Map(), // groupId -> boolean (true = collapsed)
    bookmarkGroupVisibleCount: new Map(), // groupId -> number (visible count)
    bookmarkGroupModel: null, // [{ header, children:[{item,s}] }]
    bookmarkDetailsExpanded: new Set(), // Set of expanded item IDs / childKeys

    // Canvas bookmark search: whether to show bookmark / folder / domain results
    // Values: 'bookmark' | 'folder' | 'domain' | null (auto)
    bookmarkTypeFilter: null,

    // Canvas card(group) search: whether to show cards/sections or groups
    // Values: 'card' | 'group' | null (auto)
    structureTypeFilter: null,

    // Cache for bookmark-domain grouping (per query)
    domainIndexCache: null,
    domainGroupCollapse: new Map(),
    // Domain grouping level: 'root' (registrable) or 'host' (subdomain)
    domainGrouping: 'host',

    // Search help menu state (click the left icon)
    isHelpOpen: false,

    // In fullscreen mode, user manual mode switch should win over auto-default.
    fullscreenAutoModeLocked: false,

    // Tag browser: when query is "#" / "{#}", first-level shows color+tag navigator.
    // Click one entry to enter second-level bookmark result view.
    tagBrowseDetail: null,
    tagBrowseBucketsLimit: 5,
    tagBrowseBucketLimits: {},
    noteBrowseDetail: null,
    noteBrowseBucketsLimit: 5,
    noteBrowseBucketLimits: {},

    // Localized area search range
    areaSearchScope: null,

    // In fullscreen card mode, user dismissed the area indicator → search globally while staying fullscreen.
    fullscreenAreaSearchDismissed: false
};

const TEMP_SECTION_BUILD_YIELD_EVERY = 180;
const TEMP_SECTION_INSERT_CHUNK_THRESHOLD = 240;
const TEMP_SECTION_INSERT_BATCH_SIZE = 120;
const TEMP_SECTION_LARGE_FOLDER_NODE_THRESHOLD = 320;
const TEMP_SECTION_LARGE_FOLDER_CHILD_THRESHOLD = 120;
let isTempSectionCreationInProgress = false;
const SIDE_PANEL_SEARCH_COLLAPSE_FINISH_MS = 260;
let sidePanelSearchCollapseCleanupTimer = null;
let sidePanelSearchCollapseTransitionEndHandler = null;
const SEARCH_RESULT_HOVER_SUPPRESS_MS_AFTER_NAV = 180;
const SEARCH_RESULT_HOVER_SUPPRESS_MS_AFTER_WHEEL = 120;
const SEARCH_RESULT_MIN_PAGE_SIZE = 20;
let lastSearchResultKeyboardNavTs = 0;
let lastSearchResultWheelTs = 0;

function isSidePanelModeInSearch() {
    try {
        if (window.__SIDE_PANEL_MODE__ === true) return true;
        if (document && document.documentElement && document.documentElement.classList.contains('side-panel-mode')) return true;
        const params = new URLSearchParams(window.location.search);
        const flag = params.get('sidepanel') || params.get('side_panel') || params.get('panel');
        return flag === '1' || flag === 'true';
    } catch (_) {
        return false;
    }
}

function getCurrentLangSafe() {
    try {
        if (typeof currentLang !== 'undefined' && currentLang) return currentLang;
    } catch (_) { }
    if (typeof window !== 'undefined' && window.currentLang) return window.currentLang;
    return 'zh_CN';
}

function squeezeSpaces(value) {
    return String(value || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function toPositiveIntForSearch(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function collectPermanentViewShellSnapshotForSearch(sourceInput = null) {
    const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.collectPermanentViewShellSnapshot === 'function'
        ? window.CanvasProtocolBridge
        : null;
    if (!protocolBridge) return null;
    try {
        const snapshot = protocolBridge.collectPermanentViewShellSnapshot(sourceInput);
        return snapshot && Array.isArray(snapshot.views) ? snapshot : null;
    } catch (_) {
        return null;
    }
}

function getPermanentViewShellViewsForSearch(snapshotInput = null) {
    const snapshot = snapshotInput && Array.isArray(snapshotInput.views)
        ? snapshotInput
        : collectPermanentViewShellSnapshotForSearch(snapshotInput);
    return Array.isArray(snapshot && snapshot.views) ? snapshot.views : [];
}

function getPermanentMainShellForSearch(snapshotInput = null) {
    return getPermanentViewShellViewsForSearch(snapshotInput).find((view) => !(view && view.copyId)) || null;
}

function getPermanentCopyShellsForSearch(snapshotInput = null) {
    return getPermanentViewShellViewsForSearch(snapshotInput).filter((view) => view && view.copyId);
}

function getPermanentCopySearchDisplayIndex(shell, orderIndex = 0) {
    const raw = toPositiveIntForSearch(shell && shell.displayIndex);
    return raw ? (raw + 1) : (orderIndex + 2);
}

function getPermanentDescriptionTextForSearch(copyId = null, snapshotInput = null) {
    const safeCopyId = String(copyId || '').trim();
    const shell = safeCopyId
        ? getPermanentCopyShellsForSearch(snapshotInput).find((view) => String(view && view.copyId || '').trim() === safeCopyId)
        : getPermanentMainShellForSearch(snapshotInput);
    return shell && typeof shell.descriptionMd === 'string'
        ? squeezeSpaces(shell.descriptionMd)
        : '';
}

function setSidePanelSearchExpanded(expanded) {
    const container = document.querySelector('.search-container');
    if (!container) return;

    const inputWrap = container.querySelector('.search-input-wrapper');

    const shouldExpand = !!expanded;
    const isExpanded = container.classList.contains('side-panel-search-expanded');
    const isCollapsing = container.classList.contains('side-panel-search-collapsing');

    const clearCollapseCleanupTimer = () => {
        if (sidePanelSearchCollapseCleanupTimer) {
            clearTimeout(sidePanelSearchCollapseCleanupTimer);
            sidePanelSearchCollapseCleanupTimer = null;
        }
    };

    const clearCollapseTransitionEndHandler = () => {
        if (inputWrap && sidePanelSearchCollapseTransitionEndHandler) {
            inputWrap.removeEventListener('transitionend', sidePanelSearchCollapseTransitionEndHandler);
        }
        sidePanelSearchCollapseTransitionEndHandler = null;
    };

    const finishCollapse = () => {
        if (!container.classList.contains('side-panel-search-collapsing')) return;
        container.classList.remove('side-panel-search-collapsing');
        clearCollapseCleanupTimer();
        clearCollapseTransitionEndHandler();
    };

    // 清理旧动画类（兼容旧样式）
    container.classList.remove('side-panel-search-expanding');
    if (shouldExpand) container.classList.remove('side-panel-search-collapsing');

    if (shouldExpand) {
        clearCollapseCleanupTimer();
        clearCollapseTransitionEndHandler();
        if (isExpanded && !isCollapsing) return;
        container.classList.add('side-panel-search-expanded');
        return;
    }

    if (!isExpanded && !isCollapsing) return;
    if (isCollapsing) return;

    clearCollapseCleanupTimer();
    clearCollapseTransitionEndHandler();
    container.classList.add('side-panel-search-collapsing');

    requestAnimationFrame(() => {
        container.classList.remove('side-panel-search-expanded');
    });

    if (inputWrap && typeof inputWrap.addEventListener === 'function') {
        sidePanelSearchCollapseTransitionEndHandler = (event) => {
            if (!event || (event.propertyName !== 'max-width' && event.propertyName !== 'opacity')) return;
            clearCollapseTransitionEndHandler();
            finishCollapse();
        };
        inputWrap.addEventListener('transitionend', sidePanelSearchCollapseTransitionEndHandler);
    }

    sidePanelSearchCollapseCleanupTimer = setTimeout(() => {
        finishCollapse();
    }, SIDE_PANEL_SEARCH_COLLAPSE_FINISH_MS);
}

function isSidePanelSearchExpanded() {
    const container = document.querySelector('.search-container');
    return !!(container && container.classList.contains('side-panel-search-expanded'));
}

const DOMAIN_GROUP_PREF_KEY = 'canvas-search-domain-grouping';
const TAG_BROWSER_COLOR_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
const TAG_BROWSER_ROOT_QUERIES = new Set(['#', '{#}']);
const NOTE_BROWSER_ROOT_QUERIES = new Set(['*', '{*}']);
const TAG_BROWSER_ALPHA_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES = [
    { letter: 'A', marker: '阿' },
    { letter: 'B', marker: '芭' },
    { letter: 'C', marker: '擦' },
    { letter: 'D', marker: '搭' },
    { letter: 'E', marker: '蛾' },
    { letter: 'F', marker: '发' },
    { letter: 'G', marker: '噶' },
    { letter: 'H', marker: '哈' },
    { letter: 'J', marker: '击' },
    { letter: 'K', marker: '喀' },
    { letter: 'L', marker: '垃' },
    { letter: 'M', marker: '妈' },
    { letter: 'N', marker: '拿' },
    { letter: 'O', marker: '哦' },
    { letter: 'P', marker: '啪' },
    { letter: 'Q', marker: '期' },
    { letter: 'R', marker: '然' },
    { letter: 'S', marker: '撒' },
    { letter: 'T', marker: '塌' },
    { letter: 'W', marker: '挖' },
    { letter: 'X', marker: '昔' },
    { letter: 'Y', marker: '压' },
    { letter: 'Z', marker: '匝' }
];
const TAG_BROWSER_COLOR_LABELS = {
    red: { zh_CN: '红色', en: 'Red' },
    orange: { zh_CN: '橙色', en: 'Orange' },
    yellow: { zh_CN: '黄色', en: 'Yellow' },
    green: { zh_CN: '绿色', en: 'Green' },
    blue: { zh_CN: '蓝色', en: 'Blue' },
    purple: { zh_CN: '紫色', en: 'Purple' },
    gray: { zh_CN: '灰色', en: 'Gray' }
};
try {
    const stored = localStorage.getItem(DOMAIN_GROUP_PREF_KEY);
    if (stored === 'root' || stored === 'host') {
        searchUiState.domainGrouping = stored;
    }
} catch (_) { }


// ==================== 搜索上下文管理器 (Phase 4) ====================

/**
 * 搜索上下文管理器
 * 负责根据当前视图状态（View/Tab）动态配置搜索行为
 */
window.SearchContextManager = {
    currentContext: {
        view: 'canvas', // Canvas-only
        tab: null,
        subTab: null
    },

    _lastContextKey: '',

    /**
     * 更新搜索上下文
     */
    updateContext(view, tab = null, subTab = null) {
        const next = { view, tab, subTab };
        const key = `${String(view || '')}::${String(tab || '')}::${String(subTab || '')}`;
        const changed = key !== this._lastContextKey;

        this.currentContext = next;
        this._lastContextKey = key;
        ;

        // [Search Isolation] Different pages share the same top search input but have different behaviors.
        // When context changes, clear the input + results so queries won't leak across views/tabs.
        if (changed && typeof window.resetMainSearchUI === 'function') {
            window.resetMainSearchUI({ reason: 'context-change' });
        }

        this.updateUI();
    },

    /**
     * 根据当前上下文更新 UI（如 Placeholder）
     */
    updateUI() {
        const input = document.getElementById('searchInput');
        if (!input) return;

        let placeholder = '';
        const ctx = this.currentContext;

        if (ctx.view === 'canvas') {
            // Canvas placeholder is driven by Search Mode (bookmark/structure/description).
            try {
                if (typeof window.currentView === 'string' && window.currentView === 'canvas') {
                    if (typeof setSearchMode === 'function' && typeof searchUiState === 'object' && searchUiState) {
                        setSearchMode(searchUiState.activeMode || 'bookmark', { skipIndexLoad: true });
                        return;
                    }
                }
            } catch (_) { }
            placeholder = currentLang === 'zh_CN' ? '搜索书签、文件夹...' : 'Search bookmarks/folders...';
        }

        if (placeholder) {
            input.setAttribute('placeholder', placeholder);
        }
    },

    /**
     * 获取当前上下文的搜索模式 ID
     */
    getModeId() {
        return 'default';
    }
};

function syncSearchContextFromCurrentUI(reason = 'sync') {
    try {
        if (!window.SearchContextManager || typeof window.SearchContextManager.updateContext !== 'function') return;

        const view = (typeof window.currentView === 'string' && window.currentView)
            ? window.currentView
            : 'canvas';
        window.SearchContextManager.updateContext(view, null, null);
        ;
    } catch (_) { }
}

try {
    window.syncSearchContextFromCurrentUI = syncSearchContextFromCurrentUI;
} catch (_) { }

// Ensure correct placeholder after refresh.
// history.js runs before search.js; re-sync once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
    // Defer 1 tick to let history.js finish early view restore.
    setTimeout(() => syncSearchContextFromCurrentUI('DOMContentLoaded'), 0);
});

// ==================== DOM 操作辅助函数 ====================

/**
 * 获取搜索结果面板元素
 */
function getSearchResultsPanel() {
    return document.getElementById('searchResultsPanel');
}

let searchPanelShowFrame = null;

/**
 * 显示搜索结果面板
 */
function showSearchResultsPanel() {
    const panel = getSearchResultsPanel();
    if (!panel) return;
    if (panel.classList.contains('visible')) return;

    if (searchPanelShowFrame) {
        cancelAnimationFrame(searchPanelShowFrame);
        searchPanelShowFrame = null;
    }

    searchPanelShowFrame = requestAnimationFrame(() => {
        searchPanelShowFrame = null;
        panel.classList.add('visible');
    });
}

/**
 * 隐藏搜索结果面板
 */
function hideSearchResultsPanel() {
    const panel = getSearchResultsPanel();
    if (panel) {
        if (searchPanelShowFrame) {
            cancelAnimationFrame(searchPanelShowFrame);
            searchPanelShowFrame = null;
        }
        panel.classList.remove('visible');
        try { panel.dataset.panelType = ''; } catch (_) { }
    }

    // 如果之前触发了同步构建 fallback，在搜索框关闭时将其回写到 IndexedDB，并清空 fallback 标记
    if (typeof SearchIndexManager !== 'undefined' && SearchIndexManager.hasPendingSyncWriteBack) {
        SearchIndexManager.hasPendingSyncWriteBack = false;
        ;
        saveMemoryIndexToIndexedDb().catch(err => {
            console.error('[Search] Failed to write back sync fallback index:', err);
        });
    }

    try {
        if (typeof searchUiState === 'object' && searchUiState) {
            searchUiState.canvasSuggestionsVisible = false;
            
            // 立即清理 UI 搜索结果缓存，保证下次打开界面干净
            searchUiState.results = [];
            searchUiState.resultSource = [];
            searchUiState.resultAll = [];
            searchUiState.resultPagingKey = '';
            searchUiState.resultVisibleCount = 0;
            searchUiState.resultHasMore = false;
            searchUiState.selectedIndex = -1;

            // 5分钟防抖延迟卸载内存物理索引，防范频繁开关搜索导致的磁盘 I/O 轰炸
            if (typeof scheduleReleaseSearchMemoryDebounced === 'function') {
                scheduleReleaseSearchMemoryDebounced();
            }
        }
    } catch (_) { }
}

function prepareSearchInputBeforeCanvasNavigate() {
    try {
        hideSearchResultsPanel();
        toggleSearchModeMenu(false);
        toggleSearchHelpMenu(false);
        const inputEl = document.getElementById('searchInput');
        if (inputEl) inputEl.value = '';
    } catch (_) { }
}

function dismissMainSearchAfterCanvasNavigate() {
    try {
        if (typeof window.cancelPendingMainSearchDebounce === 'function') {
            window.cancelPendingMainSearchDebounce();
        }
    } catch (_) { }

    try {
        const input = document.getElementById('searchInput');
        if (input) {
            input.value = '';
            try { input.blur(); } catch (_) { }
        }
    } catch (_) { }

    try {
        hideSearchResultsPanel();
        toggleSearchModeMenu(false);
        toggleSearchHelpMenu(false);
    } catch (_) { }

    try {
        if (typeof performSearch === 'function') {
            performSearch('');
        }
    } catch (_) { }

    try {
        if (typeof searchUiState === 'object' && searchUiState) {
            searchUiState.query = '';
            searchUiState.results = [];
            searchUiState.resultSource = [];
            searchUiState.resultAll = [];
            searchUiState.resultPagingKey = '';
            searchUiState.resultVisibleCount = 0;
            searchUiState.resultHasMore = false;
            searchUiState.selectedIndex = -1;
            searchUiState.canvasSuggestionsVisible = false;
        }
    } catch (_) { }

    try {
        if (isSidePanelModeInSearch()) {
            setSidePanelSearchExpanded(false);
        }
    } catch (_) { }
}

/**
 * 重置顶部主搜索框（跨视图/标签隔离）
 * - 清空输入框
 * - 隐藏并清空结果面板
 * - 清空 searchUiState
 * - 清除 Canvas 高亮（避免群组高亮跨页面残留）
 */
function resetMainSearchUI(options = {}) {
    const { clearInput = true } = options;

    // Cancel any pending debounced search from history.js
    // (Shared top search box across views/sub-tabs: avoid stale renders)
    try {
        if (typeof window.cancelPendingMainSearchDebounce === 'function') {
            window.cancelPendingMainSearchDebounce();
        }
    } catch (_) { }

    // Cancel focus-triggered delayed search to avoid cross-view leakage
    try {
        if (typeof focusSearchTimeout !== 'undefined' && focusSearchTimeout) {
            clearTimeout(focusSearchTimeout);
            focusSearchTimeout = null;
        }
    } catch (_) { }

    try {
        if (clearInput) {
            const input = document.getElementById('searchInput');
            if (input) input.value = '';
        }

        const panel = getSearchResultsPanel();
        if (panel) panel.innerHTML = '';

        if (typeof hideSearchResultsPanel === 'function') hideSearchResultsPanel();
        if (typeof toggleSearchModeMenu === 'function') toggleSearchModeMenu(false);
        if (typeof clearCanvasSearchHighlight === 'function') clearCanvasSearchHighlight();

        // Reset UI state
        if (typeof searchUiState === 'object' && searchUiState) {
            searchUiState.view = null;
            searchUiState.query = '';
            searchUiState.results = [];
            searchUiState.resultSource = [];
            searchUiState.resultAll = [];
            searchUiState.resultPagingKey = '';
            searchUiState.resultVisibleCount = 0;
            searchUiState.resultHasMore = false;
            searchUiState.selectedIndex = -1;
            searchUiState.bookmarkGroupModel = null;
            searchUiState.bookmarkGroupCollapse = new Map();
            searchUiState.domainGroupCollapse = new Map();
            searchUiState.areaSearchScope = null;
            searchUiState.fullscreenAreaSearchDismissed = false;
            if (typeof updateSearchAreaIndicatorUI === 'function') {
                updateSearchAreaIndicatorUI();
            }
        }
    } catch (_) { }

    // Close any help/mode menu to avoid cross-view leakage
    try {
        toggleSearchModeMenu(false);
        toggleSearchHelpMenu(false);
    } catch (_) { }
}

try {
    window.resetMainSearchUI = resetMainSearchUI;
} catch (_) { }

/**
 * 更新搜索结果选中项
 */
function ensureSelectedResultVisibleInPanel(panel, selectedEl) {
    if (!panel || !selectedEl) return;

    const toggleRow = panel.querySelector('.canvas-bookmark-type-toggle');
    const topInset = toggleRow ? toggleRow.offsetHeight : 0;

    const itemTop = selectedEl.offsetTop;
    const itemBottom = itemTop + selectedEl.offsetHeight;
    const visibleTop = panel.scrollTop + topInset;
    const visibleBottom = panel.scrollTop + panel.clientHeight;

    if (itemTop < visibleTop) {
        panel.scrollTop = Math.max(0, itemTop - topInset);
        return;
    }

    if (itemBottom > visibleBottom) {
        panel.scrollTop = Math.max(0, itemBottom - panel.clientHeight);
    }
}

function updateSearchResultSelection(nextIndex, options = {}) {
    const panel = getSearchResultsPanel();
    if (!panel) return;
    const ensureVisible = options.ensureVisible !== false;

    const items = panel.querySelectorAll('.search-result-item');
    if (!items.length) {
        searchUiState.selectedIndex = -1;
        return;
    }
    const maxIdx = items.length - 1;
    const clamped = Math.max(0, Math.min(maxIdx, nextIndex));

    items.forEach(el => el.classList.remove('selected'));
    const selectedEl = items[clamped];
    if (selectedEl) {
        selectedEl.classList.add('selected');
        if (ensureVisible) {
            ensureSelectedResultVisibleInPanel(panel, selectedEl);
        }
    }
    searchUiState.selectedIndex = clamped;
}

// ==================== 搜索结果渲染 ====================

/**
 * 渲染搜索结果面板
 * @param {Array} results - 搜索结果数组
 * @param {Object} options - 渲染选项
 */
function renderSearchResultsPanel(results, options = {}) {
    const { view = null, query = '' } = options;
    const panel = getSearchResultsPanel();
    if (!panel) return;

    // Isolation guard:
    // Prevent stale (debounced/queued) renders from a different view/query from overwriting the panel.
    try {
        const input = document.getElementById('searchInput');
        const currentQ = (input && typeof input.value === 'string') ? input.value.trim().toLowerCase() : '';
        const expectedQ = String(query || '').trim().toLowerCase();
        if (currentQ !== expectedQ) return;
        if (view && typeof window.currentView === 'string' && window.currentView !== view) return;
    } catch (_) { }

    searchUiState.view = view;
    searchUiState.query = query;
    searchUiState.results = Array.isArray(results) ? results : [];
    searchUiState.selectedIndex = -1;
    try {
        searchUiState.canvasSuggestionsVisible = false;
        panel.dataset.panelType = 'results';
    } catch (_) { }

    if (!searchUiState.results.length) {
        const emptyText = options.emptyText || i18n.searchNoResults[currentLang];
        panel.innerHTML = `<div class="search-results-empty">${escapeHtml(emptyText)}</div>`;
        showSearchResultsPanel();
        return;
    }

    const rowsHtml = searchUiState.results.map((item, idx) => {
        const safeTitle = escapeHtml(item.title || (currentLang === 'zh_CN' ? '（无标题）' : '(Untitled)'));

        // Meta Logic: Path or URL
        // If meta is provided (e.g. "Added on 2024..."), use it.
        // If not, and it's a bookmark, try to show URL.
        let metaText = item.meta ? escapeHtml(item.meta) : '';
        if (!metaText && item.nodeType === 'bookmark' && item.url) {
            metaText = escapeHtml(item.url);
        }

        // Badges (Moved up to be available for all blocks)
        const parts = Array.isArray(item.changeTypeParts) ? item.changeTypeParts : [];
        const badges = [];
        if (parts.includes('added') || item.changeType === 'added') badges.push(`<span class="search-change-prefix added">+</span>`);
        if (parts.includes('deleted') || item.changeType === 'deleted') badges.push(`<span class="search-change-prefix deleted">-</span>`);
        if (parts.includes('moved')) badges.push(`<span class="search-change-prefix moved">>></span>`);
        if (parts.includes('modified')) badges.push(`<span class="search-change-prefix modified">~</span>`);

        const badgesHtml = badges.length ? badges.join('') : '';
        const changeIconsHtml = badgesHtml ? `<span class="search-change-icons">${badgesHtml}</span>` : '';

        // Favicon / Icon Logic - 使用全局 FaviconCache 统一缓存系统
        // 策略: 优先使用 FaviconCache 获取的真实 favicon，
        // 如果获取不到（返回 fallbackIcon）则使用黄色书签 SVG 图标
        let iconHtml = '';

        // 黄色书签图标（书签搜索模式的默认 fallback）
        const bookmarkFallbackIcon = `<div class="search-result-icon-box-inline" style="display:flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0;">
            <i class="fas fa-bookmark" style="color:#f59e0b; font-size:14px;"></i>
        </div>`;

        if (item.nodeType === 'bookmark' && item.url) {
            // 使用全局的 getFaviconUrl 函数（如果存在）
            // 这会自动从 FaviconCache（IndexedDB + 内存缓存）获取图标
            if (typeof getFaviconUrl === 'function' && typeof fallbackIcon !== 'undefined') {
                const faviconSrc = getFaviconUrl(item.url);
                // 检查是否获取到真实 favicon（不是 fallbackIcon 灰色星标）
                if (faviconSrc && !faviconSrc.startsWith('data:image/svg+xml')) {
                    // 真实 favicon（已缓存的 Base64 或第三方服务 URL）
                    iconHtml = `<img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" alt="">`;
                } else {
                    // 返回的是 fallbackIcon（灰色星标 SVG），使用黄色书签图标替代
                    // 但仍然添加一个隐藏的 img 以便后台加载完成后可以触发更新
                    iconHtml = bookmarkFallbackIcon + `<img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" alt="" style="display:none;">`;
                }
            } else if (typeof getFaviconUrl === 'function') {
                // getFaviconUrl 可用但 fallbackIcon 未定义，直接使用 favicon
                const faviconSrc = getFaviconUrl(item.url);
                iconHtml = `<img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" alt="">`;
            } else {
                // Fallback: 如果全局函数不可用，使用黄色书签图标
                iconHtml = bookmarkFallbackIcon;
            }
        } else if (item.nodeType === 'folder') {
            // 文件夹使用蓝色文件夹图标
            iconHtml = `<div class="search-result-icon-box-inline" style="display:flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0;">
                <i class="fas fa-folder" style="color:#2563eb; font-size:14px;"></i>
            </div>`;
        }



        // Layout:
        // [Icon/Favicon]  [Title + Badges]
        //                 [Meta/URL]
        return `
            <div class="search-result-item" role="option" data-index="${idx}" data-type="${item.type || ''}" data-node-id="${escapeHtml(item.id)}">
                <div class="search-result-left">
                    ${iconHtml}
                </div>
                <div class="search-result-content">
                    <div class="search-result-title-row">
                        ${changeIconsHtml}
                        <span class="search-result-title-text" style="${item.nodeType === 'group_action' ? 'color:var(--accent-primary); font-weight:700;' : ''}">${safeTitle}</span>
                        ${!iconHtml ? `<span class="search-result-index-tag">${idx + 1}</span>` : ''} 
                    </div>
                    ${metaText ? `<div class="search-result-meta-row">${metaText}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    panel.innerHTML = rowsHtml;
    showSearchResultsPanel();
    updateSearchResultSelection(0);
}

// ==================== 搜索结果激活 ====================

/**
 * 激活指定索引的搜索结果（Canvas）
 * @param {number} index - 结果索引
 */
async function activateSearchResultAtIndex(index) {
    await activateCanvasSearchResultAtIndex(index);
}

// ==================== 事件处理 ====================

/**
 * 激活搜索结果（根据当前视图调用对应的激活函数）
 * @param {number} index - 结果索引
 */
function activateSearchResult(index) {
    activateCanvasSearchResultAtIndex(index);
}

/**
 * 搜索输入框键盘事件处理
 */
function handleSearchKeydown(e) {
    try {
        if (!e) return;
        if (e.isComposing) return;

        const panel = getSearchResultsPanel();
        const panelVisible = !!(panel && panel.classList.contains('visible'));
        const panelType = panel && panel.dataset ? panel.dataset.panelType : '';

        if (e.key === 'ArrowRight') {
            const view = getCurrentViewSafe();
            const input = e.target;
            if (view === 'canvas' && input && typeof input.selectionStart === 'number') {
                const value = String(input.value || '');
                const atEnd = input.selectionStart === value.length && input.selectionEnd === value.length;
                if (atEnd && value.trim() && searchUiState && searchUiState.activeMode === 'bookmark') {
                    if (panelVisible && panelType === 'results') {
                        const counts = searchUiState.bookmarkModeCounts || {};
                        const bookmarkCount = Number(counts.bookmarkCount || 0);
                        const folderCount = Number(counts.folderCount || 0);
                        const domainCount = Number(counts.domainCount || 0);
                        if (domainCount > 0) {
                            e.preventDefault();
                            const hasBookmark = bookmarkCount > 0;
                            const hasFolder = folderCount > 0;
                            const currentType = searchUiState.bookmarkTypeFilter;
                            const currentGrouping = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';

                            let nextType = currentType;
                            let nextGrouping = currentGrouping;

                            if (currentType === 'domain') {
                                if (currentGrouping === 'root') {
                                    nextGrouping = 'host';
                                } else {
                                    if (hasBookmark) {
                                        nextType = 'bookmark';
                                    } else if (hasFolder) {
                                        nextType = 'folder';
                                    } else {
                                        nextGrouping = 'root';
                                    }
                                }
                            } else if (currentType === 'bookmark') {
                                if (hasFolder) {
                                    nextType = 'folder';
                                } else {
                                    nextType = 'domain';
                                    nextGrouping = 'root';
                                }
                            } else if (currentType === 'folder') {
                                nextType = 'domain';
                                nextGrouping = 'root';
                            } else {
                                nextType = 'domain';
                                nextGrouping = 'root';
                            }

                            searchUiState.bookmarkTypeFilter = nextType;
                            if (nextType === 'domain') {
                                searchUiState.domainGrouping = nextGrouping;
                                if (nextGrouping !== currentGrouping) {
                                    try { localStorage.setItem(DOMAIN_GROUP_PREF_KEY, nextGrouping); } catch (_) { }
                                }
                            }

                            const groups = searchUiState.bookmarkGroupModel;
                            if (Array.isArray(groups)) {
                                const nextResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
                                renderCanvasSearchResults(nextResults, { view: 'canvas', query: searchUiState.query, selectedIndex: 0 });
                            } else {
                                searchCanvasAndRender(searchUiState.query);
                            }
                            return;
                        } else {
                            const availableTypes = [];
                            if (bookmarkCount > 0) availableTypes.push('bookmark');
                            if (folderCount > 0) availableTypes.push('folder');

                            if (availableTypes.length > 1) {
                                e.preventDefault();
                                const currentType = searchUiState.bookmarkTypeFilter;
                                const idx = availableTypes.indexOf(currentType);
                                const nextType = availableTypes[(idx >= 0 ? idx + 1 : 0) % availableTypes.length];
                                searchUiState.bookmarkTypeFilter = nextType;
                                const groups = searchUiState.bookmarkGroupModel;
                                if (Array.isArray(groups)) {
                                    const nextResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
                                    renderCanvasSearchResults(nextResults, { view: 'canvas', query: searchUiState.query, selectedIndex: 0 });
                                } else {
                                    searchCanvasAndRender(searchUiState.query);
                                }
                                return;
                            }
                        }
                    }
                }
            }
        }

        if (e.key === 'ArrowLeft') {
            const view = getCurrentViewSafe();
            const input = e.target;
            if (view === 'canvas' && input && typeof input.selectionStart === 'number') {
                if (input.selectionStart === 0 && input.selectionEnd === 0) {
                    const trigger = document.getElementById('searchModeTrigger');
                    if (trigger) {
                        e.preventDefault();
                        trigger.focus();
                    }
                    return;
                }
            }
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const view = getCurrentViewSafe();
            const input = e.target;
            const q = (input && typeof input.value === 'string') ? input.value.trim() : '';
            const dir = (e.key === 'ArrowDown') ? 1 : -1;

            if (panelVisible && panelType === 'results') {
                e.preventDefault();
                lastSearchResultKeyboardNavTs = Date.now();
                updateSearchResultSelection(searchUiState.selectedIndex + dir);
                return;
            }

            if (view === 'canvas' && !q) {
                e.preventDefault();
                cycleSearchMode(dir);
                return;
            }

            if (panelVisible && panelType === 'canvas-suggestions') {
                e.preventDefault();
                cycleSearchMode(dir);
                return;
            }

            if (searchUiState.isMenuOpen) {
                e.preventDefault();
                cycleSearchMode(dir);
                return;
            }
        }

        if (e.key === 'Enter') {
            if (panelVisible && panelType === 'results' && searchUiState.selectedIndex >= 0) {
                e.preventDefault();
                activateSearchResult(searchUiState.selectedIndex);
            }
            return;
        }

        if (e.key === 'Escape') {
            if (panelVisible) {
                e.preventDefault();
                const queryText = e && e.target ? String(e.target.value || '').trim() : '';
                const isTagBrowseBackEscape = panelType === 'results'
                    && isTagBrowseRootQuery(queryText)
                    && searchUiState
                    && searchUiState.tagBrowseDetail
                    && searchUiState.tagBrowseDetail.active === true;
                if (isTagBrowseBackEscape) {
                    searchUiState.tagBrowseDetail = null;
                    searchCanvasAndRender(queryText || '#');
                    return;
                }
                const isNoteBrowseBackEscape = panelType === 'results'
                    && isNoteBrowseRootQuery(queryText)
                    && searchUiState
                    && searchUiState.noteBrowseDetail
                    && searchUiState.noteBrowseDetail.active === true;
                if (isNoteBrowseBackEscape) {
                    searchUiState.noteBrowseDetail = null;
                    searchCanvasAndRender(queryText || '*');
                    return;
                }
                hideSearchResultsPanel();
            }
            toggleSearchModeMenu(false);
            toggleSearchHelpMenu(false);
            if (isSidePanelModeInSearch()) {
                const input = document.getElementById('searchInput');
                const hasQuery = !!(input && String(input.value || '').trim());
                if (!hasQuery) setSidePanelSearchExpanded(false);
            }
        }
    } catch (_) { }
}

/**
 * 搜索输入框聚焦处理
 */
async function handleSearchInputFocus(e) {
    try {
        // 取消由于搜索框关闭触发的 5 分钟延迟卸载内存缓存定时器，直接复用当前内存索引
        if (typeof cancelReleaseSearchMemory === 'function') {
            cancelReleaseSearchMemory();
        }
        const input = e && e.target ? e.target : document.getElementById('searchInput');
        if (!input) return;
        if (isSidePanelModeInSearch()) {
            setSidePanelSearchExpanded(true);
        }
        
        // 确保主动加载当前激活模式的索引和坐标映射
        const activeMode = (typeof searchUiState !== 'undefined' && searchUiState && searchUiState.activeMode) || 'bookmark';
        if (typeof ensureIndexForModeLoaded === 'function') {
            await ensureIndexForModeLoaded(activeMode);
        }

        const q = (input.value || '').trim().toLowerCase();

        if (!q) {
            if (shouldShowEmptyQuerySuggestions()) {
                renderCanvasSearchSuggestions();
                showSearchResultsPanel();
            } else {
                hideSearchResultsPanel();
            }
            return;
        }

        if (typeof handleSearch === 'function') {
            handleSearch({ target: input });
            return;
        }
        if (typeof performSearch === 'function') {
            performSearch(q);
        }
    } catch (_) { }
}

/**
 * 点击搜索结果
 */
function handleSearchResultsPanelClick(e) {
    const panel = getSearchResultsPanel();
    const panelType = panel && panel.dataset ? panel.dataset.panelType : '';
    if (panelType !== 'results') return;

    // Handle Details Expand/Collapse Toggle
    const bookmarkDetailsToggle = e.target.closest('.canvas-bookmark-details-toggle');
    if (bookmarkDetailsToggle) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const itemId = String(bookmarkDetailsToggle.getAttribute('data-item-id') || '').trim();
        if (!itemId) return;

        if (!(searchUiState.bookmarkDetailsExpanded instanceof Set)) {
            searchUiState.bookmarkDetailsExpanded = new Set();
        }
        
        const isCurrentlyExpanded = searchUiState.bookmarkDetailsExpanded.has(itemId);
        const willExpand = !isCurrentlyExpanded;
        
        if (willExpand) {
            searchUiState.bookmarkDetailsExpanded.add(itemId);
        } else {
            searchUiState.bookmarkDetailsExpanded.delete(itemId);
        }

        // Toggle DOM in-place to avoid vertical scroll jumps/resets
        const detailsRow = bookmarkDetailsToggle.closest('.canvas-bookmark-details-row');
        const itemRow = bookmarkDetailsToggle.closest('.search-result-item, .canvas-bookmark-group-child-item');
        if (itemRow) {
            // Update toggle button attributes
            bookmarkDetailsToggle.setAttribute('aria-expanded', String(willExpand));
            const isZh = (currentLang === 'zh_CN');
            bookmarkDetailsToggle.setAttribute('title', isZh ? (willExpand ? '收起信息' : '展开信息') : (willExpand ? 'Collapse info' : 'Expand info'));
            
            // Update caret icon
            const caret = bookmarkDetailsToggle.querySelector('i.fas');
            if (caret) {
                caret.className = `fas ${willExpand ? 'fa-chevron-down' : 'fa-chevron-right'}`;
            }

            // Toggle collapsible container
            const collapsible = itemRow.querySelector('.canvas-bookmark-details-collapsible');
            if (collapsible) {
                collapsible.style.display = willExpand ? 'flex' : 'none';
            }

            // Toggle preview context
            const preview = itemRow.querySelector('.search-result-details-preview-context');
            if (preview) {
                preview.style.display = willExpand ? 'none' : 'flex';
            }
        }
        return;
    }

    const tagBucketLoadMore = e.target.closest('.canvas-tag-bucket-load-more-btn');
    if (tagBucketLoadMore) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        const bucketKey = tagBucketLoadMore.getAttribute('data-bucket');
        if (bucketKey) {
            const db = buildCanvasSearchDb();
            const sourceIndex = db.bookmarkIndex || [];
            const query = String(searchUiState.query || '').trim();
            if (isNoteBrowseRootQuery(query)) {
                if (!searchUiState.noteBrowseBucketLimits) {
                    searchUiState.noteBrowseBucketLimits = {};
                }
                const currentLimit = searchUiState.noteBrowseBucketLimits[bucketKey] || 5;
                searchUiState.noteBrowseBucketLimits[bucketKey] = currentLimit + 5;
                const scopedSource = getCanvasBookmarkBrowseScopedSource(sourceIndex);
                const rootModel = buildCanvasNoteBrowseRootModel(scopedSource.sourceIndex, scopedSource.cacheKey);
                renderCanvasNoteBrowseRootPanel(rootModel, { query: searchUiState.query });
            } else {
                if (!searchUiState.tagBrowseBucketLimits) {
                    searchUiState.tagBrowseBucketLimits = {};
                }
                const currentLimit = searchUiState.tagBrowseBucketLimits[bucketKey] || 5;
                searchUiState.tagBrowseBucketLimits[bucketKey] = currentLimit + 5;
                const scopedSource = getCanvasBookmarkBrowseScopedSource(sourceIndex);
                const rootModel = buildCanvasTagBrowseRootModel(scopedSource.sourceIndex, scopedSource.cacheKey);
                renderCanvasTagBrowseRootPanel(rootModel, { query: searchUiState.query });
            }
        }
        return;
    }

    const tagBucketCollapse = e.target.closest('.canvas-tag-bucket-collapse-btn');
    if (tagBucketCollapse) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        const bucketKey = tagBucketCollapse.getAttribute('data-bucket');
        if (bucketKey) {
            const db = buildCanvasSearchDb();
            const sourceIndex = db.bookmarkIndex || [];
            const query = String(searchUiState.query || '').trim();
            if (isNoteBrowseRootQuery(query)) {
                if (!searchUiState.noteBrowseBucketLimits) {
                    searchUiState.noteBrowseBucketLimits = {};
                }
                searchUiState.noteBrowseBucketLimits[bucketKey] = 5;
                const scopedSource = getCanvasBookmarkBrowseScopedSource(sourceIndex);
                const rootModel = buildCanvasNoteBrowseRootModel(scopedSource.sourceIndex, scopedSource.cacheKey);
                renderCanvasNoteBrowseRootPanel(rootModel, { query: searchUiState.query });
            } else {
                if (!searchUiState.tagBrowseBucketLimits) {
                    searchUiState.tagBrowseBucketLimits = {};
                }
                searchUiState.tagBrowseBucketLimits[bucketKey] = 5;
                const scopedSource = getCanvasBookmarkBrowseScopedSource(sourceIndex);
                const rootModel = buildCanvasTagBrowseRootModel(scopedSource.sourceIndex, scopedSource.cacheKey);
                renderCanvasTagBrowseRootPanel(rootModel, { query: searchUiState.query });
            }
        }
        return;
    }

    const descriptionOthersBtn = e.target.closest('.canvas-description-others-btn');
    if (descriptionOthersBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        searchUiState.showFullscreenDescriptionOthers = true;
        if (typeof searchCanvasAndRender === 'function') {
            searchCanvasAndRender(searchUiState.query || '');
        }
        return;
    }

    const tagBrowseCollectionBtn = e.target.closest('.canvas-tag-browse-collection-btn');
    if (tagBrowseCollectionBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        const query = String(searchUiState.query || '').trim();
        if (isNoteBrowseRootQuery(query) && searchUiState.noteBrowseDetail && searchUiState.noteBrowseDetail.kind === 'color') {
            searchUiState.noteBrowseDetail.showBookmarks = true;
            searchCanvasAndRender(query || '*', { source: 'system', keepNoteBrowseDetail: true });
        } else if (searchUiState.tagBrowseDetail && searchUiState.tagBrowseDetail.kind === 'color') {
            searchUiState.tagBrowseDetail.showBookmarks = true;
            searchCanvasAndRender(query || '#', { source: 'system', keepTagBrowseDetail: true });
        }
        return;
    }

    const tagBrowseBackBtn = e.target.closest('.canvas-tag-browse-back-btn');
    if (tagBrowseBackBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        
        const query = String(searchUiState.query || '').trim();
        if (isNoteBrowseRootQuery(query)) {
            searchUiState.noteBrowseDetail = null;
            searchCanvasAndRender(query || '*', { source: 'system', keepNoteBrowseDetail: true });
            return;
        }

        if (searchUiState.tagBrowseDetail && searchUiState.tagBrowseDetail.kind === 'color' && searchUiState.tagBrowseDetail.showBookmarks === true) {
            searchUiState.tagBrowseDetail.showBookmarks = false;
            searchCanvasAndRender(query, { source: 'system', keepTagBrowseDetail: true });
            return;
        }

        searchUiState.tagBrowseDetail = null;
        if (isTagBrowseRootQuery(query)) {
            searchCanvasAndRender(query, { source: 'system', keepTagBrowseDetail: true });
        } else {
            const input = document.getElementById('searchInput');
            const q = input ? String(input.value || '').trim() : '';
            if (isTagBrowseRootQuery(q)) {
                searchCanvasAndRender(q);
            } else {
                searchCanvasAndRender(query || '#');
            }
        }
        return;
    }

    const pathEllipsisToggle = e.target.closest('.search-result-path-ellipsis-toggle');
    if (pathEllipsisToggle) {
        e.preventDefault();
        e.stopPropagation();
        const hint = pathEllipsisToggle.closest('.search-result-path-hint');
        if (!hint) return;
        hint.classList.add('is-expanded');
        return;
    }

    const externalLink = e.target.closest('.search-result-external-link');
    if (externalLink) {
        e.preventDefault();
        e.stopPropagation();
        const url = externalLink.dataset
            ? String(externalLink.dataset.searchUrl || externalLink.getAttribute('href') || '').trim()
            : String(externalLink.getAttribute('href') || '').trim();
        openSearchResultExternalUrl(url);
        return;
    }

    const locationMoreBtn = e.target.closest('.canvas-bookmark-location-more');
    if (locationMoreBtn) {
        e.preventDefault();
        e.stopPropagation();
        const row = locationMoreBtn.closest('.canvas-bookmark-location-chip-row');
        if (!row) return;
        row.classList.add('is-expanded');
        row.querySelectorAll('[data-location-chip-extra="true"]').forEach((chip) => {
            chip.hidden = false;
        });
        locationMoreBtn.hidden = true;
        const lessBtn = row.querySelector('.canvas-bookmark-location-less');
        if (lessBtn) {
            lessBtn.hidden = false;
        }
        return;
    }

    const locationLessBtn = e.target.closest('.canvas-bookmark-location-less');
    if (locationLessBtn) {
        e.preventDefault();
        e.stopPropagation();
        const row = locationLessBtn.closest('.canvas-bookmark-location-chip-row');
        if (!row) return;
        row.classList.remove('is-expanded');
        row.querySelectorAll('[data-location-chip-extra="true"]').forEach((chip) => {
            chip.hidden = true;
        });
        locationLessBtn.hidden = true;
        const moreBtn = row.querySelector('.canvas-bookmark-location-more');
        if (moreBtn) {
            moreBtn.hidden = false;
        }
        return;
    }

    const bookmarkGroupToggle = e.target.closest('.canvas-bookmark-group-toggle, .canvas-bookmark-group-count');
    if (bookmarkGroupToggle) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const groupId = String(bookmarkGroupToggle.getAttribute('data-bookmark-group-id') || '').trim();
        const groupRow = bookmarkGroupToggle.closest('.search-result-item');
        const selectedIndex = parseInt(groupRow && groupRow.getAttribute('data-index') || '-1', 10);
        if (!groupId) return;

        if (!(searchUiState.bookmarkGroupCollapse instanceof Map)) {
            searchUiState.bookmarkGroupCollapse = new Map();
        }
        const previous = searchUiState.bookmarkGroupCollapse.get(groupId);
        const wasCollapsed = typeof previous === 'boolean' ? previous : true;
        searchUiState.bookmarkGroupCollapse.set(groupId, !wasCollapsed);

        if (!wasCollapsed) {
            // It was expanded, now collapsing. Reset visible count to 10.
            if (searchUiState.bookmarkGroupVisibleCount instanceof Map) {
                searchUiState.bookmarkGroupVisibleCount.set(groupId, 10);
            }
        }

        rerenderCanvasBookmarkResults(Number.isNaN(selectedIndex) ? searchUiState.selectedIndex : selectedIndex);
        return;
    }

    const bookmarkGroupLoadMore = e.target.closest('.canvas-bookmark-group-load-more-btn');
    if (bookmarkGroupLoadMore) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const groupId = String(bookmarkGroupLoadMore.getAttribute('data-bookmark-group-id') || '').trim();
        const groupRow = bookmarkGroupLoadMore.closest('.search-result-item');
        const selectedIndex = parseInt(groupRow && groupRow.getAttribute('data-index') || '-1', 10);
        if (!groupId) return;

        if (!(searchUiState.bookmarkGroupVisibleCount instanceof Map)) {
            searchUiState.bookmarkGroupVisibleCount = new Map();
        }
        searchUiState.bookmarkGroupVisibleCount.set(groupId, Infinity);
        rerenderCanvasBookmarkResults(Number.isNaN(selectedIndex) ? searchUiState.selectedIndex : selectedIndex);
        return;
    }

    const bookmarkGroupChild = e.target.closest('.canvas-bookmark-group-child-item');
    if (bookmarkGroupChild) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const groupId = String(bookmarkGroupChild.getAttribute('data-bookmark-group-id') || '').trim();
        const childKey = String(bookmarkGroupChild.getAttribute('data-bookmark-child-key') || '').trim();
        const childId = String(bookmarkGroupChild.getAttribute('data-bookmark-child-id') || '').trim();
        const pools = [searchUiState.results, searchUiState.resultAll, searchUiState.resultSource];
        let groupItem = null;
        for (const pool of pools) {
            if (!Array.isArray(pool)) continue;
            groupItem = pool.find((result) => result && result.type === 'bookmark-group' && String(result.id || '') === groupId) || null;
            if (groupItem) break;
        }

        const targetItems = Array.isArray(groupItem && groupItem.targetItems) ? groupItem.targetItems : [];
        const targetItem = targetItems.find((child) => {
            if (!child) return false;
            const key = String(child.locationKey || getCanvasBookmarkLocationKeyForSearch(child));
            if (childKey && key === childKey) return true;
            return !childKey && childId && String(child.id || '') === childId;
        }) || null;

        if (targetItem) {
            try {
                hideSearchResultsPanel();
                const inputEl = document.getElementById('searchInput');
                if (inputEl) inputEl.value = '';
            } catch (_) { }
            locateCanvasBookmarkItem(targetItem);
        }
        return;
    }

    const exportBtn = e.target.closest('.canvas-bookmark-to-temp-btn');
    if (exportBtn) {
        e.preventDefault();
        e.stopPropagation();
        try { createTempSectionFromSearchResults(); } catch (_) { }
        try { hideSearchResultsPanel(); } catch (_) { }
        return;
    }

    const loadMoreBtn = e.target.closest('.search-load-more-btn');
    if (loadMoreBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        appendCanvasSearchResultsPage();
        return;
    }

    // 0. Canvas Bookmark Mode: type toggles (Bookmark / Folder)
    const typeBtn = e.target.closest('.canvas-bookmark-type-btn');
    if (typeBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const type = String(typeBtn.dataset.type || '');
        if (type !== 'bookmark' && type !== 'folder' && type !== 'domain') return;

        // Update filter and re-render (do NOT close panel)
        searchUiState.bookmarkTypeFilter = type;
        if (type === 'domain') {
            searchUiState.domainGrouping = 'root';
            try { localStorage.setItem(DOMAIN_GROUP_PREF_KEY, 'root'); } catch (_) { }
        }
        const groups = searchUiState.bookmarkGroupModel;
        if (Array.isArray(groups)) {
            const nextResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
            renderCanvasSearchResults(nextResults, { view: 'canvas', query: searchUiState.query, selectedIndex: 0 });
        } else {
            // Fallback: rerun search
            searchCanvasAndRender(searchUiState.query);
        }
        return;
    }

    const structureTypeBtn = e.target.closest('.canvas-structure-type-btn');
    if (structureTypeBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const type = String(structureTypeBtn.dataset.type || '');
        if (type !== 'card' && type !== 'group') return;
        searchUiState.structureTypeFilter = type;
        renderCanvasSearchResults(searchUiState.resultSource || [], {
            view: 'canvas',
            query: searchUiState.query,
            selectedIndex: 0
        });
        return;
    }

    // 0b. Domain granularity toggle (Root / Subdomain)
    const domainGranularityBtn = e.target.closest('.canvas-bookmark-domain-granularity-btn');
    if (domainGranularityBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const targetGroup = String(domainGranularityBtn.dataset.domainGroup || '');
        const next = targetGroup === 'root' ? 'root' : 'host';
        searchUiState.bookmarkTypeFilter = 'domain';
        searchUiState.domainGrouping = next;
        try { localStorage.setItem(DOMAIN_GROUP_PREF_KEY, next); } catch (_) { }

        const groups = searchUiState.bookmarkGroupModel;
        if (Array.isArray(groups)) {
            const nextResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
            renderCanvasSearchResults(nextResults, { view: 'canvas', query: searchUiState.query, selectedIndex: 0 });
        } else {
            searchCanvasAndRender(searchUiState.query);
        }
        return;
    }

    const domainToggleBtn = e.target.closest('.search-domain-toggle-btn');
    if (domainToggleBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const itemEl = domainToggleBtn.closest('.search-result-item');
        if (!itemEl) return;
        const index = parseInt(itemEl.getAttribute('data-index') || '-1', 10);
        const item = searchUiState.results[index];
        if (!item || item.type !== 'domain-group') return;

        const domainKey = String(item.domain || item.title || '').trim().toLowerCase();
        if (!domainKey) return;

        setDomainGroupCollapsed(domainKey, item.isExpanded === true);
        rerenderCanvasBookmarkResults(index);
        return;
    }

    // 1. Handle Copy-Jump Badges AND Location Chips (Unified)
    // .search-result-badge-interactive (Legacy or direct Permanent badges)
    // .search-loc-chip, .search-loc-chip-row (New Bookmark Group Location chips)
    const interactive = e.target.closest('.search-result-badge-interactive, .search-loc-chip, .search-loc-chip-row');
    if (interactive) {
        if (interactive.dataset && interactive.dataset.searchNavDisabled === 'true') {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        // 1a. Extract Item Context
        const itemEl = interactive.closest('.search-result-item');
        if (!itemEl) return;
        const index = parseInt(itemEl.getAttribute('data-index') || '-1', 10);
        const item = searchUiState.results[index];
        if (!item) return;

        // 1b. Determine Action
        hideSearchResultsPanel();

        // Default options
        const opts = {
            color: item.color || '#2563eb',
            expandTargetFolder: shouldExpandSearchLocateTargetFolder(item)
        };

        // Is it a "Location Chip" with explicit instructions?
        const locId = interactive.dataset.locId;
        const locSource = interactive.dataset.locSource;
        const locSection = interactive.dataset.locSection;
        const copyId = interactive.dataset.copyId;

        const explicitLocation = locId && Array.isArray(item.locations)
            ? item.locations.find((loc) => {
                if (!loc) return false;
                if (String(loc.id || '') !== String(locId || '')) return false;
                if (locSource && String(loc.source || '') !== String(locSource || '')) return false;
                if (locSection && String(loc.sectionId || '') !== String(locSection || '')) return false;
                if (copyId && copyId !== 'null' && String(loc.copyId || '') !== String(copyId || '')) return false;
                return true;
            }) || null
            : null;
        if (explicitLocation) {
            opts.expandTargetFolder = shouldExpandSearchLocateTargetFolder(explicitLocation);
        }

        if (copyId && copyId !== 'null') opts.copyId = copyId;

        // Priority 1: Location Chip specific ID
        if (locId) {
            if (locSource === 'temporary') {
                locateBookmarkItemInTempTree(locSection, locId, opts);
            } else {
                locateBookmarkItemInPermanentTree(locId, opts);
            }
            return;
        }

        // Priority 2: Direct Jump Badge (on a normal Permanent search result)
        if (item.type === 'bookmark-item' && item.source === 'permanent') {
            locateBookmarkItemInPermanentTree(item.id, opts);
            return;
        }

        return;
    }

    const itemEl = e.target.closest('.search-result-item');
    if (!itemEl) return;

    const itemType = String(itemEl.getAttribute('data-type') || '').trim();
    if (itemType === 'tag-browser-color' || itemType === 'tag-browser-tag') {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }
        const idx = parseInt(itemEl.getAttribute('data-index') || '-1', 10);
        if (Number.isNaN(idx) || idx < 0) return;
        const tagItem = Array.isArray(searchUiState.results) ? searchUiState.results[idx] : null;
        if (!tagItem) return;
        searchUiState.tagBrowseDetail = {
            active: true,
            kind: itemType === 'tag-browser-color' ? 'color' : 'tag',
            color: normalizeTagBrowseColor(tagItem.color),
            text: String(tagItem.text || '').trim(),
            textLower: String(tagItem.textLower || '').trim().toLowerCase(),
            showBookmarks: false
        };
        const query = String(searchUiState.query || '').trim() || '#';
        searchCanvasAndRender(query, { source: 'system', keepTagBrowseDetail: true });
        return;
    }

    try {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
            e.stopPropagation();
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
    } catch (_) { }

    const idx = parseInt(itemEl.getAttribute('data-index') || '-1', 10);
    if (Number.isNaN(idx)) return;
    activateSearchResult(idx);
}

/**
 * 悬停搜索结果
 */
function handleSearchResultsPanelMouseOver(e) {
    const panel = getSearchResultsPanel();
    const panelType = panel && panel.dataset ? panel.dataset.panelType : '';
    if (panelType !== 'results') return;

    const now = Date.now();
    if (now - lastSearchResultKeyboardNavTs < SEARCH_RESULT_HOVER_SUPPRESS_MS_AFTER_NAV) return;
    if (now - lastSearchResultWheelTs < SEARCH_RESULT_HOVER_SUPPRESS_MS_AFTER_WHEEL) return;

    const item = e && e.target ? e.target.closest('.search-result-item') : null;
    if (!item) return;
    const idx = parseInt(item.getAttribute('data-index') || '-1', 10);
    if (Number.isNaN(idx)) return;
    updateSearchResultSelection(idx, { ensureVisible: false });
}

/**
 * 搜索面板外部点击处理
 */
function handleSearchOutsideClick(e) {
    const container = document.querySelector('.search-container');
    const panel = getSearchResultsPanel();
    if (!container || !panel) return;
    if (container.contains(e.target)) return;
    hideSearchResultsPanel();
    toggleSearchModeMenu(false);
    toggleSearchHelpMenu(false);
    if (isSidePanelModeInSearch()) {
        const input = document.getElementById('searchInput');
        const hasQuery = !!(input && String(input.value || '').trim());
        if (!hasQuery) setSidePanelSearchExpanded(false);
    }
}

// ==================== Robust Date Parser ====================

/**
 * Robust Date Parser
 * Supports: 
 * - Numeric: YYYY, YYYY-MM, YYYYMMDD, YYYY.MM.DD, YYYY/MM/DD
 * - Relative: 今天/Today, 昨天/Yesterday, 前天
 * - Chinese: 2024年1月5日, 1月5日, 2024年1月, 1月
 * - Strict: NO standalone day numbers (e.g. "15", "15日")
 */
function parseDateQuery(query) {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const currentYear = now.getFullYear();

    // --- 1. Relative Keywords ---
    if (['今天', 'today'].includes(q)) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }
    if (['昨天', 'yesterday'].includes(q)) {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${day}`, y, m, day };
    }
    if (['前天', 'day before yesterday'].includes(q)) {
        const d = new Date(now);
        d.setDate(d.getDate() - 2);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${day}`, y, m, day };
    }

    // --- 2. Numeric Formats ---

    // YYYYMMDD (8 digits) -> YYYY-MM-DD
    if (/^\d{8}$/.test(q)) {
        const y = q.substring(0, 4);
        const m = q.substring(4, 6);
        const d = q.substring(6, 8);
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }

    // MMDD (4 digits) -> CurrentYear-MM-DD
    // Conflict with YYYY (Year). Logic:
    // - Years are usually 1990-2100.
    // - MMDD is 0101-1231.
    // - Overlap: 1990-2025 might be year OR time (e.g. 2025 = 8:25pm? No, strict date).
    // - User asked for "0115". 
    // Logic: If starts with '0' or '1' (up to 12), and valid day, treat as MMDD. 
    // Exception: 1998, 2000 are definitely Years. 
    // Heuristic: If it looks like a valid MMDD (MM=01-12, DD=01-31), AND (startswith 0 OR (startswith 1 and year outside typical range?)).
    // Actually, "0115" is unambiguous (Year 115 vs Jan 15). User implies Current Year.
    if (/^\d{4}$/.test(q)) {
        const val = parseInt(q, 10);
        // Valid Year Range for this app: 2010 - 2030+
        const isLikelyYear = (val >= 2000 && val <= 2100);

        // Check MMDD validity
        const mStr = q.substring(0, 2);
        const dStr = q.substring(2, 4);
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        const isValidMMDD = (m >= 1 && m <= 12 && d >= 1 && d <= 31);

        // Decision: 
        // If it starts with '0', it's MMDD (e.g. 0115).
        // If it is 2024, it's Year.
        // If it is 1231, it's Dec 31 (Year 1231 unlikely).
        if (!isLikelyYear && isValidMMDD) {
            const y = String(currentYear);
            return { type: 'day', key: `${y}-${mStr}-${dStr}`, y, m: mStr, d: dStr, ignoreYear: true };
        }
        // Fallback to Year logic later
    }

    // YYYYMM (6 digits) -> YYYY-MM
    if (/^\d{6}$/.test(q)) {
        const y = q.substring(0, 4);
        const m = q.substring(4, 6);
        return { type: 'month', key: `${y}-${m}`, y, m };
    }

    // Separator formats: 2024-11-05, 2024.11.05, 2024/11/05
    const sepMatch = q.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (sepMatch) {
        const y = sepMatch[1];
        const m = sepMatch[2].padStart(2, '0');
        const d = sepMatch[3].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }

    // MM-DD Separator (Current Year): "01-15", "1/15", "1.15"
    // Distinct from YYYY-MM (starts with 4 digits)
    const mdMatch = q.match(/^(\d{1,2})[-./](\d{1,2})$/);
    if (mdMatch) {
        const y = String(currentYear);
        const m = mdMatch[1].padStart(2, '0');
        const d = mdMatch[2].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d, ignoreYear: true };
    }

    // YYYY-MM
    const ymMatch = q.match(/^(\d{4})[-./](\d{1,2})$/);
    if (ymMatch) {
        const y = ymMatch[1];
        const m = ymMatch[2].padStart(2, '0');
        return { type: 'month', key: `${y}-${m}`, y, m };
    }

    // YYYY
    if (/^\d{4}$/.test(q)) {
        return { type: 'year', key: q, y: q };
    }

    // --- 3. Chinese Formats (Strict) ---

    // 2024年1月5日
    const cnFull = q.match(/^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?$/);
    if (cnFull) {
        const y = cnFull[1];
        const m = cnFull[2].padStart(2, '0');
        const d = cnFull[3].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }

    // 1月5日 (Implies Current Year)
    const cnMonthDay = q.match(/^(\d{1,2})月(\d{1,2})[日号]?$/);
    if (cnMonthDay) {
        const y = String(currentYear);
        const m = cnMonthDay[1].padStart(2, '0');
        const d = cnMonthDay[2].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d, ignoreYear: true };
    }

    // 2024年1月
    const cnYearMonth = q.match(/^(\d{4})年(\d{1,2})月?$/);
    if (cnYearMonth) {
        const y = cnYearMonth[1];
        const m = cnYearMonth[2].padStart(2, '0');
        return { type: 'month', key: `${y}-${m}`, y, m };
    }

    // 1月 (Implies Current Year)
    const cnMonthOnly = q.match(/^(\d{1,2})月$/);
    if (cnMonthOnly) {
        const y = String(currentYear);
        const m = cnMonthOnly[1].padStart(2, '0');
        return { type: 'month', key: `${y}-${m}`, y, m, ignoreYear: true };
    }

    // --- 4. Date Range Formats ---
    // Support: MMDD-MMDD (e.g., 0107-0120), MMDD~MMDD, MMDD到MMDD
    // Also: MM-DD~MM-DD, MM/DD-MM/DD

    // MMDD-MMDD (8 digits with separator)
    const rangeMatch1 = q.match(/^(\d{4})[-~到](\d{4})$/);
    if (rangeMatch1) {
        const start = rangeMatch1[1];
        const end = rangeMatch1[2];

        const startM = parseInt(start.substring(0, 2), 10);
        const startD = parseInt(start.substring(2, 4), 10);
        const endM = parseInt(end.substring(0, 2), 10);
        const endD = parseInt(end.substring(2, 4), 10);

        // Validate MMDD
        if (startM >= 1 && startM <= 12 && startD >= 1 && startD <= 31 &&
            endM >= 1 && endM <= 12 && endD >= 1 && endD <= 31) {
            const y = String(currentYear);
            return {
                type: 'range',
                startKey: `${y}-${String(startM).padStart(2, '0')}-${String(startD).padStart(2, '0')}`,
                endKey: `${y}-${String(endM).padStart(2, '0')}-${String(endD).padStart(2, '0')}`,
                startM: String(startM).padStart(2, '0'),
                startD: String(startD).padStart(2, '0'),
                endM: String(endM).padStart(2, '0'),
                endD: String(endD).padStart(2, '0'),
                ignoreYear: true
            };
        }
    }

    // MM-DD~MM-DD or MM/DD-MM/DD (with separators)
    const rangeMatch2 = q.match(/^(\d{1,2})[-./](\d{1,2})[-~到](\d{1,2})[-./](\d{1,2})$/);
    if (rangeMatch2) {
        const startM = parseInt(rangeMatch2[1], 10);
        const startD = parseInt(rangeMatch2[2], 10);
        const endM = parseInt(rangeMatch2[3], 10);
        const endD = parseInt(rangeMatch2[4], 10);

        if (startM >= 1 && startM <= 12 && startD >= 1 && startD <= 31 &&
            endM >= 1 && endM <= 12 && endD >= 1 && endD <= 31) {
            const y = String(currentYear);
            return {
                type: 'range',
                startKey: `${y}-${String(startM).padStart(2, '0')}-${String(startD).padStart(2, '0')}`,
                endKey: `${y}-${String(endM).padStart(2, '0')}-${String(endD).padStart(2, '0')}`,
                startM: String(startM).padStart(2, '0'),
                startD: String(startD).padStart(2, '0'),
                endM: String(endM).padStart(2, '0'),
                endD: String(endD).padStart(2, '0'),
                ignoreYear: true
            };
        }
    }

    // YYYYMMDD-YYYYMMDD (Full date range)
    const rangeMatch3 = q.match(/^(\d{8})[-~到](\d{8})$/);
    if (rangeMatch3) {
        const start = rangeMatch3[1];
        const end = rangeMatch3[2];

        const startY = start.substring(0, 4);
        const startM = start.substring(4, 6);
        const startD = start.substring(6, 8);
        const endY = end.substring(0, 4);
        const endM = end.substring(4, 6);
        const endD = end.substring(6, 8);

        return {
            type: 'range',
            startKey: `${startY}-${startM}-${startD}`,
            endKey: `${endY}-${endM}-${endD}`,
            startY, startM, startD,
            endY, endM, endD,
            ignoreYear: false
        };
    }

    // Explicitly REJECT standalone day numbers (e.g. "15", "15日", "15号")
    // They are too ambiguous and clash with ID searches or other numbers.

    return null;
}

// ==================== Phase 3: 时间匹配工具函数 ====================

/**
 * 月份映射（中英文 -> 月份数字）
 */
const MONTH_MAPPINGS = {
    // 中文
    '一月': 1, '1月': 1, '01月': 1,
    '二月': 2, '2月': 2, '02月': 2,
    '三月': 3, '3月': 3, '03月': 3,
    '四月': 4, '4月': 4, '04月': 4,
    '五月': 5, '5月': 5, '05月': 5,
    '六月': 6, '6月': 6, '06月': 6,
    '七月': 7, '7月': 7, '07月': 7,
    '八月': 8, '8月': 8, '08月': 8,
    '九月': 9, '9月': 9, '09月': 9,
    '十月': 10, '10月': 10,
    '十一月': 11, '11月': 11,
    '十二月': 12, '12月': 12,
    // 英文完整
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    // 英文缩写
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
};

/**
 * 星期映射（中英文 -> 0-6, 0=Sunday）
 */
const WEEKDAY_MAPPINGS = {
    // 中文
    '星期日': 0, '周日': 0, '星期天': 0,
    '星期一': 1, '周一': 1,
    '星期二': 2, '周二': 2,
    '星期三': 3, '周三': 3,
    '星期四': 4, '周四': 4,
    '星期五': 5, '周五': 5,
    '星期六': 6, '周六': 6,
    // 英文完整
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    // 英文缩写
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3,
    'thu': 4, 'fri': 5, 'sat': 6
};

/**
 * 解析时间关键词，返回匹配范围
 * @param {string} query - 搜索关键词（已转小写）
 * @returns {Object|null} - { type, start, end } 或 null
 */
function parseTimeKeyword(query) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 相对时间关键词
    if (query === '今天' || query === 'today') {
        return {
            type: 'range',
            start: today.getTime(),
            end: today.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }
    if (query === '昨天' || query === 'yesterday') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
            type: 'range',
            start: yesterday.getTime(),
            end: today.getTime() - 1
        };
    }
    if (query === '前天' || query === 'day before yesterday') {
        const dayBefore = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
            type: 'range',
            start: dayBefore.getTime(),
            end: yesterday.getTime() - 1
        };
    }

    // 本周/上周
    if (query === '本周' || query === 'this week') {
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(today.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
        return {
            type: 'range',
            start: monday.getTime(),
            end: now.getTime()
        };
    }
    if (query === '上周' || query === 'last week') {
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const thisMonday = new Date(today.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
        const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
        const lastSunday = new Date(thisMonday.getTime() - 1);
        return {
            type: 'range',
            start: lastMonday.getTime(),
            end: lastSunday.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }

    // 本月/上月
    if (query === '本月' || query === 'this month') {
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
            type: 'range',
            start: firstOfMonth.getTime(),
            end: now.getTime()
        };
    }
    if (query === '上月' || query === 'last month') {
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return {
            type: 'range',
            start: firstOfLastMonth.getTime(),
            end: firstOfThisMonth.getTime() - 1
        };
    }

    // 月份匹配（如：1月、January、Jan）
    const monthNum = MONTH_MAPPINGS[query];
    if (monthNum) {
        return { type: 'month', month: monthNum };
    }

    // 星期匹配（如：星期三、Wednesday、Wed）
    const weekdayNum = WEEKDAY_MAPPINGS[query];
    if (typeof weekdayNum === 'number') {
        return { type: 'weekday', weekday: weekdayNum };
    }

    // 日期匹配（如：15日、15号、15th、1st）
    const dayMatch = query.match(/^(\\d{1,2})(日|号|st|nd|rd|th)?$/);
    if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        if (day >= 1 && day <= 31) {
            return { type: 'day', day };
        }
    }

    // 年份匹配（如：2026、2026年）
    const yearMatch = query.match(/^(\\d{4})年?$/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (year >= 1970 && year <= 2100) {
            return { type: 'year', year };
        }
    }

    // 精确日期匹配（如：2026-01-15、2026年1月15日）
    const isoMatch = query.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10);
        const day = parseInt(isoMatch[3], 10);
        const date = new Date(year, month - 1, day);
        return {
            type: 'range',
            start: date.getTime(),
            end: date.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }

    // 中文日期格式
    const zhDateMatch = query.match(/^(\\d{4})年(\\d{1,2})月(\\d{1,2})日$/);
    if (zhDateMatch) {
        const year = parseInt(zhDateMatch[1], 10);
        const month = parseInt(zhDateMatch[2], 10);
        const day = parseInt(zhDateMatch[3], 10);
        const date = new Date(year, month - 1, day);
        return {
            type: 'range',
            start: date.getTime(),
            end: date.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }

    return null;
}

/**
 * 判断时间戳是否匹配时间关键词
 * @param {number} timestamp - 时间戳
 * @param {Object} timeKeyword - parseTimeKeyword 的返回值
 * @returns {boolean}
 */
function matchTimeRange(timestamp, timeKeyword) {
    if (!timeKeyword || !timestamp) return false;

    const date = new Date(timestamp);

    switch (timeKeyword.type) {
        case 'range':
            return timestamp >= timeKeyword.start && timestamp <= timeKeyword.end;
        case 'month':
            return date.getMonth() + 1 === timeKeyword.month;
        case 'weekday':
            return date.getDay() === timeKeyword.weekday;
        case 'day':
            return date.getDate() === timeKeyword.day;
        case 'year':
            return date.getFullYear() === timeKeyword.year;
        default:
            return false;
    }
}

/**
 * 构建时间搜索字符串（用于模糊匹配）
 * @param {number} timestamp - 时间戳
 * @returns {string}
 */
function buildTimeSearchableString(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = date.getDay();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    const zhMonths = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const enMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const enMonthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const zhWeekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const zhWeekdaysShort = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const enWeekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const enWeekdaysShort = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const parts = [
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        `${year}年${month}月${day}日`,
        `${month}月${day}日`,
        `${day}日`,
        `${day}号`,
        `${year}年`,
        zhMonths[month - 1],
        zhWeekdays[weekday],
        zhWeekdaysShort[weekday],
        enMonths[month - 1],
        enMonthsShort[month - 1],
        enWeekdays[weekday],
        enWeekdaysShort[weekday],
        `${month}月`,
        `${hours}:${String(minutes).padStart(2, '0')}`,
        String(year)
    ];

    return parts.join(' ').toLowerCase();
}

// ==================== 初始化 ====================

function initSearchClearButton() {
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    if (!searchInput || !searchClearBtn) return;

    if (searchClearBtn.hasAttribute('data-clear-bound')) return;
    searchClearBtn.setAttribute('data-clear-bound', 'true');

    const updateClearButton = () => {
        const hasText = !!(searchInput.value || '').trim();
        searchClearBtn.style.display = hasText ? 'inline-flex' : 'none';
    };

    try {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor && descriptor.set) {
            Object.defineProperty(searchInput, 'value', {
                get: function() {
                    return descriptor.get.call(this);
                },
                set: function(val) {
                    descriptor.set.call(this, val);
                    updateClearButton();
                },
                configurable: true
            });
        }
    } catch (e) {
        console.warn('[Search] Failed to hook programmatic value setter for searchInput:', e);
    }

    searchInput.addEventListener('input', updateClearButton);
    searchInput.addEventListener('change', updateClearButton);
    searchInput.addEventListener('focus', updateClearButton);

    searchClearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        searchInput.value = '';
        updateClearButton();
        searchInput.focus();

        if (typeof handleSearch === 'function') {
            handleSearch({ target: searchInput });
        }
    });

    updateClearButton();
}

/**
 * 初始化搜索模块事件监听
 * 应在 DOM 加载完成后调用
 */
function initSearchEvents() {
    initSearchClearButton();
    if (typeof SearchIndexManager !== 'undefined' && typeof SearchIndexManager.init === 'function') {
        setTimeout(() => {
            SearchIndexManager.init().catch(err => {
                console.error('[Search] Failed to initialize SearchIndexManager in initSearchEvents:', err);
            });
        }, 800);
    }

    const searchAreaExitBtn = document.getElementById('searchAreaExitBtn');
    if (searchAreaExitBtn && !searchAreaExitBtn.hasAttribute('data-exit-bound')) {
        searchAreaExitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            exitAreaSearch();
        });
        searchAreaExitBtn.setAttribute('data-exit-bound', 'true');
    }

    const searchInput = document.getElementById('searchInput');
    const searchResultsPanel = getSearchResultsPanel();

    // Avoid double-binding: history.js may also bind these listeners.
    // IMPORTANT: history.js binds `input` later (after async settings load). If we set
    // `data-search-bound` too early without binding `input`, search won't trigger.
    if (searchInput && !searchInput.hasAttribute('data-search-bound')) {
        // If user starts typing while a menu is open (help/mode), auto-close it
        // so the results panel can show immediately.
        searchInput.addEventListener('input', () => {
            try {
                const q = (searchInput.value || '').trim();
                if (!q) return;
                toggleSearchModeMenu(false);
                toggleSearchHelpMenu(false);
            } catch (_) { }
        });

        // Bind input -> trigger search
        if (typeof handleSearch === 'function') {
            searchInput.addEventListener('input', handleSearch);
        } else if (typeof performSearch === 'function') {
            // Fallback: call search immediately (no debounce)
            searchInput.addEventListener('input', (e) => {
                try {
                    const q = (e && e.target && typeof e.target.value === 'string')
                        ? e.target.value.trim().toLowerCase()
                        : '';
                    performSearch(q);
                } catch (_) { }
            });
        }

        // Keyboard navigation
        searchInput.addEventListener('keydown', handleSearchKeydown);
        // Suggestions / auto search on focus
        searchInput.addEventListener('focus', handleSearchInputFocus);
        searchInput.addEventListener('blur', () => {
            if (!isSidePanelModeInSearch()) return;

            requestAnimationFrame(() => {
                try {
                    const container = document.querySelector('.search-container');
                    const activeEl = document.activeElement;
                    if (container && activeEl && container.contains(activeEl)) return;

                    const hasQuery = !!(searchInput && String(searchInput.value || '').trim());
                    if (hasQuery) return;

                    hideSearchResultsPanel();
                    toggleSearchModeMenu(false);
                    toggleSearchHelpMenu(false);
                    setSidePanelSearchExpanded(false);
                } catch (_) { }
            });
        });

        searchInput.setAttribute('data-search-bound', 'true');
    }

    if (searchResultsPanel && !searchResultsPanel.hasAttribute('data-search-bound')) {
        searchResultsPanel.addEventListener('click', handleSearchResultsPanelClick);
        searchResultsPanel.addEventListener('mouseover', handleSearchResultsPanelMouseOver);
        searchResultsPanel.setAttribute('data-search-bound', 'true');
    }

    if (searchResultsPanel && !searchResultsPanel.hasAttribute('data-search-wheel-bound')) {
        searchResultsPanel.addEventListener('wheel', () => {
            lastSearchResultWheelTs = Date.now();
        }, { passive: true });
        searchResultsPanel.setAttribute('data-search-wheel-bound', 'true');
    }

    // Global delegation listener for bookmark-mode helper links (# tag / * note).
    if (!document.documentElement.hasAttribute('data-search-helper-link-bound')) {
        document.addEventListener('mousedown', (e) => {
            const link = e.target.closest('.search-helper-tag-link, .search-helper-note-link');
            if (link) {
                e.preventDefault();
                e.stopPropagation();
                
                // Set search mode to bookmark
                if (typeof setSearchMode === 'function') {
                    try { setSearchMode('bookmark', { source: 'user' }); } catch (_) {}
                }
                
                // Clear input and insert the helper query.
                const helperQuery = String(link.getAttribute('data-helper-query') || (link.classList.contains('search-helper-note-link') ? '*' : '#')).trim() || '#';
                const input = document.getElementById('searchInput');
                if (input) {
                    input.value = helperQuery;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                }
                
                // Close mode menu if open
                if (typeof toggleSearchModeMenu === 'function') {
                    try { toggleSearchModeMenu(false); } catch (_) {}
                }
            }
        }, true); // Capture phase
        
        document.addEventListener('click', (e) => {
            const link = e.target.closest('.search-helper-tag-link, .search-helper-note-link');
            if (link) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
        
        document.documentElement.setAttribute('data-search-helper-link-bound', 'true');
    }

    // Outside click: use the same capture+guard strategy as history.js
    if (!document.documentElement.hasAttribute('data-search-outside-bound')) {
        document.addEventListener('click', handleSearchOutsideClick, true);
        document.documentElement.setAttribute('data-search-outside-bound', 'true');
    }

    // Canvas: ensure mode cycling hotkeys survive re-renders.
    // Some parts of history.js may re-render header UI (or re-create the search box) in other branches.
    // Use a document-level fallback so ArrowUp/ArrowDown keeps working when the search UI re-appears.
    if (!document.documentElement.hasAttribute('data-canvas-mode-cycle-bound')) {
        document.addEventListener('keydown', (e) => {
            try {
                const view = (typeof window.currentView === 'string' && window.currentView)
                    ? window.currentView
                    : (typeof currentView === 'string' ? currentView : '');
                if (view !== 'canvas') return;
                if (e.isComposing) return;
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                if (e.altKey || e.ctrlKey || e.metaKey) return;

                // Don't hijack arrow keys while typing in other inputs/textareas.
                const active = document.activeElement;
                const tag = active && active.tagName ? String(active.tagName).toLowerCase() : '';
                const isEditable = !!(active && (
                    tag === 'input' || tag === 'textarea' || active.isContentEditable
                ));

                const input = document.getElementById('searchInput');
                const trigger = document.getElementById('searchModeTrigger');
                if (!input) return;

                // If focus is already in the search input, let handleSearchKeydown() own ArrowUp/ArrowDown.
                // Otherwise we may cycle twice (document capture + input handler), which looks like reversed order.
                if (active === input) return;

                // If focus is on the left "mode" button, let its own handler handle ArrowUp/ArrowDown.
                if (trigger && active === trigger) return;

                // Only enable global ArrowUp/Down mode switch when the search box is empty.
                // This matches user expectation: use arrows to change modes, not to scroll the page.
                const q = (typeof input.value === 'string') ? input.value.trim() : '';
                if (q) return;

                if (isEditable && active !== input && active !== trigger) return;

                const panel = getSearchResultsPanel();
                const panelVisible = !!(panel && panel.classList.contains('visible'));
                const allowWhenPanelVisible = !!(searchUiState && searchUiState.canvasSuggestionsVisible);
                if (panelVisible && !allowWhenPanelVisible) return;

                e.preventDefault();
                // Standard direction: ArrowUp = previous, ArrowDown = next
                cycleSearchMode(e.key === 'ArrowUp' ? -1 : 1);
            } catch (_) { }
        }, true);
        document.documentElement.setAttribute('data-canvas-mode-cycle-bound', 'true');
    }

    // Phase 3.5: Init Mode UI
    initSearchModeUI();
}

// ==================== Phase 3.5: 搜索模式与快捷键 (Search Mode & Shortcuts) ====================

const SEARCH_MODES = [
    {
        key: 'bookmark',
        label: '书签',
        labelEn: 'Bookmark',
        icon: 'fa-bookmark',
        color: 'mode-color-blue',
        desc: '标题、URL、文件夹、<span class="search-helper-tag-link" data-helper-query="#" style="color: var(--accent-blue, #0a84ff); text-decoration: underline; cursor: pointer;">#标签</span>、<span class="search-helper-note-link" data-helper-query="*" style="color: var(--accent-blue, #0a84ff); text-decoration: underline; cursor: pointer;">*笔记</span>',
        descEn: 'Title, URL, Folders, <span class="search-helper-tag-link" data-helper-query="#" style="color: var(--accent-blue, #0a84ff); text-decoration: underline; cursor: pointer;">#Tags</span>, <span class="search-helper-note-link" data-helper-query="*" style="color: var(--accent-blue, #0a84ff); text-decoration: underline; cursor: pointer;">*Notes</span>'
    },
    {
        key: 'structure',
        label: '卡片（组）',
        labelEn: 'Card (Group)',
        icon: 'fa-layer-group',
        color: 'mode-color-orange',
        desc: '序号 (#A / A-1), 卡片(组)名字',
        descEn: 'Index (#A / A-1), Card (Group) name'
    },
    {
        key: 'description',
        label: '说明',
        labelEn: 'Description',
        icon: 'fa-align-left',
        color: 'mode-color-green',
        desc: '栏目说明、卡片文本、连接线标签',
        descEn: 'Section Notes, Card Text, Edge Labels'
    }
];

// Canvas mode order must match the visual order in UI:
// Bookmark (including tags) -> Card (Group) -> Description
const CANVAS_MODE_KEYS = ['bookmark', 'structure', 'description'];

function getCurrentViewSafe() {
    try {
        if (typeof window !== 'undefined' && typeof window.currentView === 'string' && window.currentView) {
            return window.currentView;
        }
    } catch (_) { }
    try {
        if (typeof currentView === 'string' && currentView) return currentView;
    } catch (_) { }
    return '';
}

function getCanvasModesInOrder() {
    const map = new Map(SEARCH_MODES.map(m => [m.key, m]));
    return CANVAS_MODE_KEYS.map(k => map.get(k)).filter(Boolean);
}

function getCanvasFullscreenScopeFromElement(element) {
    if (!element || !element.classList || !element.classList.contains('canvas-node-maximized')) return null;

    if (element.classList.contains('permanent-bookmark-section')) {
        const copyId = element.dataset ? String(element.dataset.permanentSectionCopyId || '').trim() : '';
        return {
            kind: 'permanent',
            id: copyId || 'permanentSection',
            copyId: copyId || null
        };
    }

    if (element.classList.contains('temp-canvas-node')) {
        const sectionId = element.dataset && element.dataset.sectionId
            ? String(element.dataset.sectionId).trim()
            : String(element.id || '').trim();
        if (!sectionId) return null;
        return {
            kind: 'temp',
            id: sectionId
        };
    }

    if (element.classList.contains('md-canvas-node')) {
        const nodeId = String(element.id || '').trim();
        if (!nodeId) return null;
        return {
            kind: 'blank',
            id: nodeId
        };
    }

    return null;
}

function getCanvasFullscreenSearchScope() {
    try {
        const maximized = document.querySelector('.canvas-node-maximized');
        return getCanvasFullscreenScopeFromElement(maximized);
    } catch (_) {
        return null;
    }
}

function isCanvasFullscreenActive() {
    return !!getCanvasFullscreenSearchScope();
}

function isFullscreenGlobalSearchActive() {
    return isCanvasFullscreenActive() && !!searchUiState.fullscreenAreaSearchDismissed;
}

function getActiveFullscreenSearchScopeForFiltering() {
    if (searchUiState.fullscreenAreaSearchDismissed) return null;
    if (searchUiState.activeMode === 'structure') return null;
    return getCanvasFullscreenSearchScope();
}

function getCanvasFullscreenAreaSearchScopeFromElement(element) {
    if (!element || !element.classList) return null;

    if (element.classList.contains('permanent-bookmark-section')) {
        const copyId = element.dataset
            ? String(element.dataset.permanentSectionCopyId || element.getAttribute('data-permanent-section-copy-id') || '').trim()
            : '';
        const memberIds = ['permanentSection', 'permanent-section'];
        if (copyId) {
            memberIds.push(copyId, `permanent-section-copy-${copyId}`);
        }
        return {
            kind: 'permanent',
            id: copyId || 'permanentSection',
            memberIds
        };
    }

    if (element.classList.contains('temp-canvas-node')) {
        const sectionId = element.dataset && element.dataset.sectionId
            ? String(element.dataset.sectionId).trim()
            : String(element.id || '').trim();
        if (!sectionId) return null;
        return {
            kind: 'temp',
            id: sectionId,
            memberIds: [sectionId]
        };
    }

    if (element.classList.contains('md-canvas-node')) {
        const nodeId = String(element.id || '').trim();
        if (!nodeId) return null;
        return {
            kind: 'blank',
            id: nodeId,
            memberIds: [nodeId]
        };
    }

    return null;
}

function syncFullscreenAreaSearchWithActiveMode() {
    if (!isCanvasFullscreenActive()) return;

    const modeKey = searchUiState.activeMode;
    let changed = false;

    if (modeKey === 'structure') {
        if (searchUiState.areaSearchScope !== null || !searchUiState.fullscreenAreaSearchDismissed) {
            searchUiState.areaSearchScope = null;
            searchUiState.fullscreenAreaSearchDismissed = true;
            changed = true;
        }
        updateSearchAreaIndicatorUI();
    } else if (!searchUiState.fullscreenAreaSearchDismissed) {
        const maximized = document.querySelector('.canvas-node-maximized');
        const scopeData = getCanvasFullscreenAreaSearchScopeFromElement(maximized);
        if (scopeData) {
            const nextScope = {
                kind: scopeData.kind,
                id: scopeData.id || null,
                memberIds: Array.isArray(scopeData.memberIds) ? scopeData.memberIds : []
            };
            const prevScope = searchUiState.areaSearchScope;
            const scopeChanged = !prevScope
                || prevScope.kind !== nextScope.kind
                || String(prevScope.id || '') !== String(nextScope.id || '')
                || JSON.stringify(prevScope.memberIds || []) !== JSON.stringify(nextScope.memberIds || []);
            if (scopeChanged) {
                searchUiState.fullscreenAreaSearchDismissed = false;
                searchUiState.areaSearchScope = nextScope;
                changed = true;
                updateSearchAreaIndicatorUI();
            }
        }
    }

    if (changed) {
        const searchInput = document.getElementById('searchInput');
        const q = searchInput ? String(searchInput.value || '').trim() : '';
        if (q) {
            if (typeof searchCanvasAndRender === 'function') {
                searchCanvasAndRender(q);
            }
        } else {
            // Keep the suggestion panel open if it was already open or if suggestions are enabled
            if (getCurrentViewSafe() === 'canvas') {
                try {
                    const panel = getSearchResultsPanel();
                    const suggestionsVisible = !!(searchUiState && searchUiState.canvasSuggestionsVisible);
                    const panelIsSuggestions = !!(panel && panel.dataset && panel.dataset.panelType === 'canvas-suggestions');
                    const panelVisible = !!(panel && panel.classList.contains('visible'));
                    
                    if (panelVisible && (suggestionsVisible || panelIsSuggestions)) {
                        if (shouldShowEmptyQuerySuggestions()) {
                            renderCanvasSearchSuggestions();
                            showSearchResultsPanel();
                        } else {
                            hideSearchResultsPanel();
                        }
                    }
                } catch (_) { }
            }
        }
    }
}

function isItemInAreaSearchScope(item, scope) {
    if (!scope || !Array.isArray(scope.memberIds)) return true;
    const memberIds = scope.memberIds;

    // Check if the item itself is one of the member nodes
    if (item.type === 'temp-section' || item.type === 'permanent-section' || item.type === 'md-node') {
        if (memberIds.includes(item.id)) return true;
        // Fix ID discrepancy for permanent sections (main / copies) between canvas/DOM and search indexes
        if (item.type === 'permanent-section' && item.id) {
            if (item.id === 'permanentSection' && memberIds.includes('permanent-section')) {
                return true;
            }
            if (memberIds.includes(`permanent-section-copy-${item.id}`)) {
                return true;
            }
        }
        return false;
    }

    // Check if the item is a bookmark item
    if (item.type === 'bookmark-item') {
        if (item.source === 'temporary') {
            return memberIds.includes(item.sectionId);
        } else if (item.source === 'permanent') {
            return memberIds.some(id => 
                id === 'permanentSection' || 
                id.startsWith('permanent-section') || 
                id.startsWith('permanentSection')
            );
        }
    }

    // Check if the item is a connection line (edge)
    if (item.type === 'edge') {
        if (memberIds.includes(item.id)) return true;
        if (memberIds.includes(item.fromId) || memberIds.includes(item.toId)) return true;
        // Align connection lines attached to permanent section / copies
        const connectsToPermanent = (nodeId) => {
            if (!nodeId) return false;
            if (nodeId === 'permanentSection' || nodeId === 'permanent-section') {
                return memberIds.includes('permanent-section') || memberIds.includes('permanentSection');
            }
            if (nodeId.startsWith('permanent-section-copy-')) {
                const pureId = nodeId.slice('permanent-section-copy-'.length);
                return memberIds.includes(nodeId) || memberIds.includes(pureId) || memberIds.includes(`permanent-section-copy-${pureId}`);
            }
            return memberIds.includes(`permanent-section-copy-${nodeId}`) || memberIds.includes(nodeId);
        };
        return connectsToPermanent(item.fromId) || connectsToPermanent(item.toId);
    }

    // Check if it's the group card itself
    if (item.type === 'group') {
        return item.id === scope.id || memberIds.includes(item.id);
    }

    return false;
}

function getCanvasBookmarkBrowseScopeForFiltering() {
    if (searchUiState && searchUiState.areaSearchScope) {
        return {
            source: 'area',
            scope: searchUiState.areaSearchScope
        };
    }
    const fullscreenScope = getActiveFullscreenSearchScopeForFiltering();
    if (fullscreenScope) {
        return {
            source: 'fullscreen',
            scope: fullscreenScope
        };
    }
    return {
        source: 'global',
        scope: null
    };
}

function getCanvasBookmarkBrowseScopeCacheKey(scopeInfo) {
    const source = scopeInfo && scopeInfo.source ? String(scopeInfo.source) : 'global';
    const scope = scopeInfo && scopeInfo.scope && typeof scopeInfo.scope === 'object' ? scopeInfo.scope : null;
    if (!scope) return `${source}:global`;
    const kind = String(scope.kind || '').trim();
    const id = String(scope.id || '').trim();
    const copyId = String(scope.copyId || '').trim();
    const memberIds = Array.isArray(scope.memberIds)
        ? scope.memberIds.map(idValue => String(idValue || '').trim()).filter(Boolean).join(',')
        : '';
    return [source, kind, id, copyId, memberIds].join(':');
}

function doesBookmarkItemMatchFullscreenBrowseScope(item, scope) {
    if (!item || item.type !== 'bookmark-item' || !scope) return false;
    const scopeKind = String(scope.kind || '').trim();
    if (scopeKind === 'temp') {
        const targetSectionId = String(scope.id || '').trim();
        return item.source === 'temporary' && String(item.sectionId || '') === targetSectionId;
    }
    if (scopeKind === 'permanent') {
        return item.source === 'permanent';
    }
    if (scopeKind === 'blank') {
        return false;
    }
    return true;
}

function getCanvasBookmarkBrowseScopedSource(sourceIndex) {
    const list = Array.isArray(sourceIndex) ? sourceIndex : [];
    const scopeInfo = getCanvasBookmarkBrowseScopeForFiltering();
    const scope = scopeInfo.scope;
    const cacheKey = getCanvasBookmarkBrowseScopeCacheKey(scopeInfo);
    if (!scope) {
        return { sourceIndex: list, cacheKey };
    }
    if (scopeInfo.source === 'area') {
        return {
            sourceIndex: list.filter(item => isItemInAreaSearchScope(item, scope)),
            cacheKey
        };
    }
    return {
        sourceIndex: list.filter(item => doesBookmarkItemMatchFullscreenBrowseScope(item, scope)),
        cacheKey
    };
}

function triggerAreaSearch(scope, options = {}) {
    if (!scope) return;

    searchUiState.fullscreenAreaSearchDismissed = false;
    
    searchUiState.areaSearchScope = {
        kind: scope.kind,
        id: scope.id || null,
        memberIds: Array.isArray(scope.memberIds) ? scope.memberIds : []
    };
    
    updateSearchAreaIndicatorUI();
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const opts = options && typeof options === 'object' ? options : {};
        if (!opts.silent) {
            // 如果标题栏是收缩状态，则自动展开
            if (document.body.classList.contains('header-compact') && typeof window.setHeaderState === 'function') {
                window.setHeaderState('expanded');
            }
            if (typeof setSidePanelSearchExpanded === 'function') {
                setSidePanelSearchExpanded(true);
            }
            searchInput.focus();
        }
        
        const q = (searchInput.value || '').trim();
        if (typeof searchCanvasAndRender === 'function') {
            searchCanvasAndRender(q);
        }
    }
}

function exitAreaSearch() {
    searchUiState.areaSearchScope = null;
    if (isCanvasFullscreenActive()) {
        searchUiState.fullscreenAreaSearchDismissed = true;
    }
    updateSearchAreaIndicatorUI();
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        const q = (searchInput.value || '').trim();
        if (typeof searchCanvasAndRender === 'function') {
            searchCanvasAndRender(q);
        }
    }
}

function updateSearchAreaIndicatorUI() {
    const indicator = document.getElementById('searchAreaIndicator');
    const inputWrap = document.querySelector('.search-input-wrapper');
    if (!indicator || !inputWrap) return;
    
    if (searchUiState.areaSearchScope) {
        const isEn = String(typeof currentLang !== 'undefined' ? currentLang : 'zh').toLowerCase().startsWith('en');
        const labelText = isEn ? 'Area' : '区域';
        const labelEl = indicator.querySelector('.search-area-indicator-label');
        if (labelEl) {
            labelEl.textContent = labelText;
        }
        indicator.style.display = 'inline-flex';
        inputWrap.classList.add('has-area-search');
    } else {
        indicator.style.display = 'none';
        inputWrap.classList.remove('has-area-search');
    }
}

if (typeof window !== 'undefined') {
    window.triggerAreaSearch = triggerAreaSearch;
    window.exitAreaSearch = exitAreaSearch;
}

function getPreferredSearchModeByFullscreenScope(scope) {
    if (!scope || typeof scope !== 'object') return null;
    if (scope.kind === 'blank') return 'description';
    if (scope.kind === 'permanent' || scope.kind === 'temp') return 'bookmark';
    return null;
}

function applyFullscreenDefaultSearchMode(options = {}) {
    if (getCurrentViewSafe() !== 'canvas') return false;

    const safeOptions = options && typeof options === 'object' ? options : {};
    const targetElement = safeOptions.targetElement || null;
    const onlyWhenInputEmpty = safeOptions.onlyWhenInputEmpty !== false;

    const scope = targetElement
        ? getCanvasFullscreenScopeFromElement(targetElement)
        : getCanvasFullscreenSearchScope();
    if (!scope) {
        searchUiState.fullscreenAutoModeLocked = false;
        searchUiState.showFullscreenDescriptionOthers = false;
        return false;
    }
    if (searchUiState.fullscreenAutoModeLocked) return false;

    const preferredMode = getPreferredSearchModeByFullscreenScope(scope);
    if (!preferredMode) return false;

    const input = document.getElementById('searchInput');
    if (onlyWhenInputEmpty && input && String(input.value || '').trim()) {
        return false;
    }

    if (searchUiState.activeMode === preferredMode) return false;
    setSearchMode(preferredMode, { source: 'auto' });
    return true;
}

function getCanvasScopePriorityForItem(item, scope) {
    if (!item || !scope) return 0;

    if (scope.kind === 'temp') {
        const targetSectionId = String(scope.id || '');
        if (!targetSectionId) return 0;

        if (item.type === 'temp-section' && String(item.id || '') === targetSectionId) return 700;
        if (item.type === 'bookmark-item' && item.source === 'temporary' && String(item.sectionId || '') === targetSectionId) return 620;
        if (item.type === 'edge' && (String(item.fromId || '') === targetSectionId || String(item.toId || '') === targetSectionId)) return 240;
        return 0;
    }

    if (scope.kind === 'permanent') {
        if (item.type === 'permanent-section') {
            if (scope.copyId && String(item.id || '') === String(scope.copyId)) return 720;
            return 640;
        }
        if (item.type === 'bookmark-item' && item.source === 'permanent') return 600;
        return 0;
    }

    if (scope.kind === 'blank') {
        const targetNodeId = String(scope.id || '');
        if (!targetNodeId) return 0;

        if (item.type === 'md-node' && String(item.id || '') === targetNodeId) return 760;
        if (item.type === 'edge' && (String(item.fromId || '') === targetNodeId || String(item.toId || '') === targetNodeId)) return 300;
        return 0;
    }

    return 0;
}

function getCanvasScopePriorityForBookmarkLocation(location, scope) {
    if (!location || !scope) return 0;

    if (scope.kind === 'temp') {
        const targetSectionId = String(scope.id || '');
        if (!targetSectionId) return 0;
        if (location.source === 'temporary' && String(location.sectionId || '') === targetSectionId) return 800;
        if (location.source === 'temporary') return 200;
        return 0;
    }

    if (scope.kind === 'permanent') {
        return location.source === 'permanent' ? 800 : 0;
    }

    return 0;
}

function pickBestBookmarkLocationByScope(locations, scope) {
    const list = Array.isArray(locations) ? locations : [];
    if (!list.length) return null;
    if (!scope) return list[0] || null;

    let best = list[0] || null;
    let bestScore = getCanvasScopePriorityForBookmarkLocation(best, scope);

    for (let index = 1; index < list.length; index += 1) {
        const candidate = list[index];
        const score = getCanvasScopePriorityForBookmarkLocation(candidate, scope);
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }

    return best;
}

function getPreferredSearchResultIndexByScope(results, scope) {
    const list = Array.isArray(results) ? results : [];
    if (!list.length || !scope) return -1;

    let bestIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < list.length; index += 1) {
        const item = list[index];
        if (!item) continue;

        let score = 0;
        if (item.type === 'bookmark-group' && Array.isArray(item.locations)) {
            const preferredLoc = pickBestBookmarkLocationByScope(item.locations, scope);
            score = preferredLoc ? getCanvasScopePriorityForBookmarkLocation(preferredLoc, scope) : 0;
        } else {
            score = getCanvasScopePriorityForItem(item, scope);
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return bestIndex;
}

searchUiState.activeMode = 'bookmark';
searchUiState.isMenuOpen = false;
let autoHideMenuTimer = null;

// Search help guide (markdown) cache
let searchHelpGuideMarkdownCache = null;

function getActiveSearchMode() {
    return SEARCH_MODES.find(m => m.key === searchUiState.activeMode) || SEARCH_MODES[0];
}

async function setSearchMode(modeKey, options = {}) {
    if (modeKey === 'tag') modeKey = 'bookmark';
    const mode = SEARCH_MODES.find(m => m.key === modeKey);
    if (!mode) return;

    const fullscreenScope = getCanvasFullscreenSearchScope();
    if (!fullscreenScope) {
        searchUiState.fullscreenAutoModeLocked = false;
    }

    const source = options && typeof options === 'object'
        ? String(options.source || 'system')
        : 'system';
    if (source === 'user' && fullscreenScope) {
        searchUiState.fullscreenAutoModeLocked = true;
    }

    const previousModeKey = searchUiState.activeMode;
    searchUiState.activeMode = modeKey;
    searchUiState.showFullscreenDescriptionOthers = false;
    try { localStorage.setItem('canvasSearchMode', modeKey); } catch (_) { }
    renderSearchModeUI();

    // 确保异步加载目标模式的分片索引，加载完成后再触发搜索渲染，避免回退到同步内存构建
    if (typeof ensureIndexForModeLoaded === 'function' && !(options && options.skipIndexLoad === true)) {
        try {
            await ensureIndexForModeLoaded(modeKey);
        } catch (_) {}
    }

    // Active mode check: if the user quickly selected another mode during index loading, abort
    if (searchUiState.activeMode !== modeKey) {
        return;
    }

    // Bookmark mode includes metadata matching, so warm up permanent identityMap caches.
    if (modeKey === 'bookmark' && typeof window !== 'undefined' && window.TagSystem && window.TagSystem.ensurePermTagsLoaded) {
        try {
            window.TagSystem.ensurePermTagsLoaded().then(() => {
                invalidateCanvasTagSearchCaches();
                if (searchUiState && searchUiState.domainIndexCache) {
                    searchUiState.domainIndexCache = null;
                }
                const input2 = document.getElementById('searchInput');
                if (input2 && input2.value && input2.value.trim()) {
                    try { searchCanvasAndRender(input2.value.trim()); } catch (_) {}
                }
            });
        } catch (_) {}
    }
    if (modeKey === 'bookmark' && typeof window !== 'undefined' && window.NoteSystem && window.NoteSystem.ensurePermNotesLoaded) {
        try {
            window.NoteSystem.ensurePermNotesLoaded().then(() => {
                invalidateCanvasNoteSearchCaches();
                if (searchUiState && searchUiState.domainIndexCache) {
                    searchUiState.domainIndexCache = null;
                }
                const input2 = document.getElementById('searchInput');
                if (input2 && input2.value && input2.value.trim()) {
                    try { searchCanvasAndRender(input2.value.trim()); } catch (_) {}
                }
            });
        } catch (_) {}
    }

    // [Modified] Update input placeholder with mode description
    const input = document.getElementById('searchInput');
    if (input) {
        const isZh = getCurrentLangSafe() === 'zh_CN';
        // Use the description as placeholder
        if (getCurrentViewSafe() === 'canvas') {
            const rawDesc = isZh ? mode.desc : mode.descEn;
            input.placeholder = rawDesc.replace(/<[^>]*>/g, '');
        }

        // If the Canvas empty-query suggestions panel is currently shown, keep it shown
        // and re-render so the active mode highlight follows ArrowUp/ArrowDown.
        try {
            const panel = getSearchResultsPanel();
            const isCanvas = getCurrentViewSafe() === 'canvas';
            const empty = !String(input.value || '').trim();
            const suggestionsVisible = !!(searchUiState && searchUiState.canvasSuggestionsVisible);
            const panelIsSuggestions = !!(panel && panel.dataset && panel.dataset.panelType === 'canvas-suggestions');
            const panelVisible = !!(panel && panel.classList.contains('visible'));

            if (isCanvas && empty && panelVisible && (suggestionsVisible || panelIsSuggestions)) {
                if (shouldShowEmptyQuerySuggestions()) {
                    renderCanvasSearchSuggestions();
                    showSearchResultsPanel();
                }
            }
        } catch (_) { }

        // Refresh search if there is query (bookmark mode is skipped as it handles this async via ensurePermTagsLoaded)
        let suppressSearchRerender = false;
        try {
            const pendingCount = Number(window.__canvasSearchSuppressFullscreenAutoModeCounter || 0);
            suppressSearchRerender = Number.isFinite(pendingCount) && pendingCount > 0;
        } catch (_) { }
        if (input.value.trim() && modeKey !== 'bookmark' && !suppressSearchRerender) {
            const q = input.value.trim();
            const isCanvas = getCurrentViewSafe() === 'canvas';

            if (isCanvas && typeof searchCanvasAndRender === 'function') {
                searchCanvasAndRender(q);
            } else if (typeof handleSearchInputFocus === 'function') {
                handleSearchInputFocus({ target: input });
            } else if (typeof performSearch === 'function') {
                try { performSearch(q.toLowerCase()); } catch (_) { }
            }
        }
    }

    if (isCanvasFullscreenActive()) {
        if (previousModeKey === 'structure' && modeKey !== 'structure' && source === 'user') {
            searchUiState.fullscreenAreaSearchDismissed = false;
        }
        syncFullscreenAreaSearchWithActiveMode();
    }
}

function cycleSearchMode(direction) {
    // Always cycle in the same order as the visual list.
    // This prevents mismatch if SEARCH_MODES order changes elsewhere.
    const ordered = getCanvasModesInOrder();
    if (!ordered.length) return;
    const currentIndex = ordered.findIndex(m => m.key === searchUiState.activeMode);
    const idx = currentIndex >= 0 ? currentIndex : 0;
    let nextIndex = idx + direction;
    if (nextIndex >= ordered.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = ordered.length - 1;

    setSearchMode(ordered[nextIndex].key, { source: 'user' });

    // [User Request] Sync menu UI if it is already open
    if (searchUiState.isMenuOpen) {
        renderSearchModeMenu();
    }
}

function toggleSearchModeMenu(show) {
    const menu = document.getElementById('searchModeMenu');
    if (!menu) return;

    const shouldShow = (typeof show === 'boolean') ? show : menu.hasAttribute('hidden');

    if (shouldShow) {
        try {
            const dock = document.body && document.body.classList.contains('header-dock-bottom')
                ? 'bottom'
                : 'top';
            menu.dataset.dock = dock;
        } catch (_) { }
        menu.removeAttribute('hidden');
        menu.dataset.menuType = 'mode';
        renderSearchModeMenu();
    } else {
        menu.setAttribute('hidden', '');
        menu.dataset.menuType = '';
    }
    searchUiState.isMenuOpen = shouldShow;
}

function toggleSearchHelpMenu(show) {
    const menu = document.getElementById('searchModeMenu');
    if (!menu) return;

    const shouldShow = (typeof show === 'boolean') ? show : menu.hasAttribute('hidden');

    if (shouldShow) {
        try {
            const dock = document.body && document.body.classList.contains('header-dock-bottom')
                ? 'bottom'
                : 'top';
            menu.dataset.dock = dock;
        } catch (_) { }
        menu.removeAttribute('hidden');
        menu.dataset.menuType = 'help';
        renderSearchHelpMenu();
    } else {
        menu.setAttribute('hidden', '');
        menu.dataset.menuType = '';
    }
    searchUiState.isHelpOpen = shouldShow;
}

function getSearchHelpContextKey() {
    if (typeof currentView === 'undefined') return null;
    return currentView === 'canvas' ? 'canvas' : null;
}

function getHelpHeadingForKey(key) {
    const isZh = typeof currentLang !== 'undefined' && currentLang === 'zh_CN';
    if (key !== 'canvas') return null;
    return isZh ? '## 书签画布搜索' : '## Bookmark Canvas Search';
}

function shouldIncludeCommonDateRules(key) {
    return key === 'canvas';
}

function extractMarkdownSection(md, headingLine) {
    if (!md || !headingLine) return '';
    const lines = String(md).split(/\r?\n/);

    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === headingLine.trim()) {
            start = i;
            break;
        }
    }
    if (start < 0) return '';

    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith('## ')) {
            end = i;
            break;
        }
    }

    return lines.slice(start, end).join('\n').trim();
}

function markdownToSimpleHtml(md) {
    const lines = String(md || '').split(/\r?\n/);
    let html = '';
    let inList = false;

    const esc = (s) => escapeHtml(String(s || ''));

    for (const raw of lines) {
        const line = raw.trimEnd();
        const t = line.trim();

        if (!t) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            continue;
        }

        // Ignore markdown separators (---)
        if (/^---+$/.test(t)) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            continue;
        }

        if (t.startsWith('## ')) {
            if (inList) {
                html += '</ul>';
                inList = false;
            }
            html += `<div class="search-help-title" style="font-weight:700; font-size:12px; margin:10px 0 6px 0; color:var(--text-normal);">${esc(t.replace(/^##\s+/, ''))}</div>`;
            continue;
        }

        if (t.startsWith('- ')) {
            if (!inList) {
                html += '<ul class="search-help-list" style="margin:0 0 8px 0; padding-left:18px; color:var(--text-secondary); font-size:12px; line-height:1.55;">';
                inList = true;
            }
            // Keep inline code backticks as-is (escapeHtml already called), but we want them readable.
            // Minimal: convert `code` to <code>code</code>
            const content = esc(t.replace(/^-\s+/, '')).replace(/`([^`]+)`/g, '<code>$1</code>');
            html += `<li style="margin:3px 0;">${content}</li>`;
            continue;
        }

        // Non-list paragraph
        if (inList) {
            html += '</ul>';
            inList = false;
        }
        html += `<div style="margin:6px 0; color:var(--text-secondary); font-size:12px; line-height:1.55;">${esc(t).replace(/`([^`]+)`/g, '<code>$1</code>')}</div>`;
    }

    if (inList) html += '</ul>';
    return html;
}

async function loadSearchHelpGuideMarkdown() {
    if (typeof searchHelpGuideMarkdownCache === 'string' && searchHelpGuideMarkdownCache.trim()) {
        return searchHelpGuideMarkdownCache;
    }
    try {
        const res = await fetch('search/SEARCH_HELP_GUIDE.md');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        searchHelpGuideMarkdownCache = text;
        return text;
    } catch (e) {
        console.warn('[SearchHelp] Failed to load SEARCH_HELP_GUIDE.md:', e);
        searchHelpGuideMarkdownCache = '';
        return '';
    }
}

async function renderSearchHelpMenu() {
    const menu = document.getElementById('searchModeMenu');
    if (!menu) return;

    const key = getSearchHelpContextKey();
    const specificHeading = getHelpHeadingForKey(key);
    const commonHeading = (currentLang === 'zh_CN') ? '## 日期协议' : '## Date Protocol';

    const md = await loadSearchHelpGuideMarkdown();
    let specific = extractMarkdownSection(md, specificHeading);
    let common = shouldIncludeCommonDateRules(key) ? extractMarkdownSection(md, commonHeading) : '';

    // Fallback: if the requested language section is missing, try the other language.
    try {
        if (!specific) {
            const altHeading = currentLang === 'zh_CN'
                ? '## Bookmark Canvas Search'
                : '## 书签画布搜索';
            specific = extractMarkdownSection(md, altHeading);
        }

        if (shouldIncludeCommonDateRules(key) && !common) {
            common = extractMarkdownSection(md, (currentLang === 'zh_CN') ? '## Date Protocol' : '## 日期协议');
        }
    } catch (_) { }

    const bodyHtml = [specific, common].filter(Boolean).map(markdownToSimpleHtml).join('');

    menu.innerHTML = `
        <div class="search-help-body" style="padding:10px 12px 10px 12px;">
            ${bodyHtml || `<div style="color:var(--text-tertiary); font-size:12px;">(No help content)</div>`}
        </div>
    `;
}

function renderSearchModeUI() {
    const mode = getActiveSearchMode();
    const trigger = document.getElementById('searchModeTrigger');
    const container = document.querySelector('.search-container');

    if (!trigger) return;
    if (getCurrentViewSafe() !== 'canvas') return;

    // Interactive Mode UI (Canvas)
    if (trigger) {
        const colorClasses = ['mode-color-blue', 'mode-color-orange', 'mode-color-green', 'mode-color-purple'];
        trigger.classList.remove(...colorClasses);
        if (mode && mode.color) trigger.classList.add(mode.color);
    }
    const label = getCurrentLangSafe() === 'zh_CN' ? mode.label : mode.labelEn;
    if (isSidePanelModeInSearch()) {
        trigger.innerHTML = `<i class="fas fa-search ${mode.color}"></i><span class="search-mode-label ${mode.color}">${label}</span>`;
        trigger.title = getCurrentLangSafe() === 'zh_CN' ? `搜索（模式：${label}）` : `Search (Mode: ${label})`;
        trigger.style.cursor = 'pointer';
        trigger.classList.add('active-mode-trigger');
        return;
    }

    trigger.innerHTML = `<i class="fas ${mode.icon} ${mode.color}"></i><span class="search-mode-label ${mode.color}">${label}</span>`;
    trigger.title = getCurrentLangSafe() === 'zh_CN' ? `切换模式: ${label}` : `Mode: ${label}`;
    trigger.style.cursor = 'pointer';
    trigger.classList.add('active-mode-trigger');

    // [User Request] Wider search box in Canvas
    if (container) container.classList.add('canvas-search-active');
}

function getSearchHintHelpContent() {
    const isZh = getCurrentLangSafe() === 'zh_CN';
    const text = isZh
        ? '模式切换：← 到左侧模式按钮，↑/↓ 切换并实时更新结果；空输入：↑/↓ 直接切换模式。书签模式：光标在输入末尾时，→ 切换书签/文件夹/域名筛选。标签/笔记：搜索标签前加 #，搜索笔记前加 *。候选条目：↑/↓ 选择，Enter 跳转；域名结果：Enter 生成临时栏目。域名粒度：点击域名旁按钮切换主域名/子域名。'
        : 'Mode: ← to the left mode button, ↑/↓ switches and updates results; empty: ↑/↓ switches modes directly. Bookmark mode: with cursor at end, → toggles bookmark/folder/domain filter. Tags/notes: prefix tag searches with # and note searches with *. Results: ↑/↓ to select, Enter to jump; Domain results: Enter creates a temp section. Domain granularity: click the domain pill to toggle root/subdomain.';
    const rows = isZh
        ? [
            ['模式切换：', '← 到左侧模式按钮，↑/↓ 切换并实时更新结果；'],
            ['', '空输入：↑/↓ 直接切换模式。'],
            ['书签模式：', '光标在输入末尾时，→ 切换书签/文件夹/域名筛选。'],
            ['标签/笔记：', '搜索标签前加 #，搜索笔记前加 *。'],
            ['候选条目：', '↑/↓ 选择，Enter 跳转；域名结果：Enter 生成临时栏目。'],
            ['域名粒度：', '点击域名旁按钮切换主域名/子域名。']
        ]
        : [
            ['Mode:', '← to the left mode button, ↑/↓ switches and updates results;'],
            ['', 'Empty: ↑/↓ switches modes directly.'],
            ['Bookmark:', 'with cursor at end, → toggles bookmark/folder/domain filter.'],
            ['Tags/notes:', 'prefix tag searches with # and note searches with *.'],
            ['Results:', '↑/↓ to select, Enter to jump; Domain results: Enter creates a temp section.'],
            ['Domain:', 'click the domain pill to toggle root/subdomain.']
        ];
    const html = rows.map(([label, value]) => `
        <div class="search-hint-help-row">
            <span class="search-hint-help-label">${escapeHtml(label)}</span>
            <span class="search-hint-help-value">${escapeHtml(value)}</span>
        </div>
    `).join('');
    return { text, html };
}

function bindSearchHintHelpButton(helpBtn, helpHtml) {
    if (!helpBtn) return;
    const getOverlayContainer = () => {
        if (typeof window !== 'undefined' && typeof window.getOverlayContainer === 'function') {
            return window.getOverlayContainer();
        }
        const container = document.querySelector('.canvas-main-container');
        if (container && (document.fullscreenElement === container ||
            document.webkitFullscreenElement === container ||
            document.mozFullScreenElement === container ||
            document.msFullscreenElement === container)) {
            return container;
        }
        return document.body;
    };

    const ensurePopover = () => {
        let pop = document.getElementById('searchHintPopover');
        const targetParent = getOverlayContainer();
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'searchHintPopover';
            pop.className = 'perf-help-popover search-hint-help-popover';
            pop.innerHTML = '<div class="perf-help-popover-content"></div>';
            targetParent.appendChild(pop);
        } else if (pop.parentElement !== targetParent) {
            targetParent.appendChild(pop);
        }
        return pop;
    };

    const helpPopover = ensurePopover();
    const contentEl = helpPopover.querySelector('.perf-help-popover-content');
    if (contentEl) contentEl.innerHTML = helpHtml;

    let outsideHandler = null;
    const hideHelp = () => {
        helpPopover.classList.remove('show');
        if (outsideHandler) {
            document.removeEventListener('mousedown', outsideHandler, true);
            outsideHandler = null;
        }
    };
    const showHelp = () => {
        const targetParent = getOverlayContainer();
        if (helpPopover.parentElement !== targetParent) {
            targetParent.appendChild(helpPopover);
        }
        helpPopover.classList.add('show');
        helpPopover.style.visibility = 'hidden';
        helpPopover.style.width = 'max-content';
        helpPopover.style.maxWidth = '560px';

        const rect = helpBtn.getBoundingClientRect();
        const popRect = helpPopover.getBoundingClientRect();
        const margin = 12;
        let left = rect.left + rect.width / 2 - popRect.width / 2;
        const maxLeft = window.innerWidth - popRect.width - margin;
        left = Math.max(margin, Math.min(maxLeft, left));

        const top = Math.min(window.innerHeight - popRect.height - margin, rect.bottom + 8);

        helpPopover.style.left = left + 'px';
        helpPopover.style.top = top + 'px';
        helpPopover.style.visibility = '';
        helpPopover.classList.add('show');

        if (!outsideHandler) {
            outsideHandler = (ev) => {
                if (helpBtn.contains(ev.target) || helpPopover.contains(ev.target)) return;
                hideHelp();
            };
            document.addEventListener('mousedown', outsideHandler, true);
        }
    };

    helpPopover.classList.remove('show');
    helpBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (helpPopover.classList.contains('show')) hideHelp();
        else showHelp();
    };
}

function renderSearchModeMenu() {
    const menu = document.getElementById('searchModeMenu');
    if (!menu) return;

    // Guard: only render when menu is in mode state
    if (menu.dataset.menuType && menu.dataset.menuType !== 'mode') return;

    // Keep the menu hint short (canvas users open this mainly to switch modes).
    const hintText = currentLang === 'zh_CN'
        ? '↑/↓ 切换模式，Enter 选择，→ 返回输入'
        : '↑/↓ switch mode, Enter select, → back to input';
    const hintHelp = getSearchHintHelpContent();

    let html = `<div class="search-mode-hint" style="text-align:left; display:flex; align-items:center; gap:6px;">
        <span>${escapeHtml(hintText)}</span>
        <button type="button" class="search-hint-help-btn search-mode-hint-help-btn perf-help-btn" aria-label="${escapeHtml(hintHelp.text)}">
            <i class="fas fa-question-circle"></i>
        </button>
    </div>`;

    const modes = getCanvasModesInOrder();

    html += modes.map(mode => {
        const isActive = mode.key === searchUiState.activeMode;
        const isZh = currentLang === 'zh_CN';
        const desc = isZh ? mode.desc : mode.descEn;

        return `
            <div class="search-mode-menu-item ${isActive ? 'active' : ''}" data-mode-key="${mode.key}">
                <div class="mode-icon"><i class="fas ${mode.icon} ${mode.color}"></i></div>
                <div class="mode-info">
                    <div class="mode-name">${isZh ? mode.label : mode.labelEn}</div>
                    <div class="mode-desc">${desc}</div>
                </div>
            </div>
        `;
    }).join('');
    menu.innerHTML = html;
    bindSearchHintHelpButton(menu.querySelector('.search-mode-hint-help-btn'), hintHelp.html);
}

function initSearchModeUI() {
    // [Phase 3.5] Restore persistent mode
    try {
        const savedMode = localStorage.getItem('canvasSearchMode');
        const normalizedSavedMode = savedMode === 'tag' ? 'bookmark' : savedMode;
        if (normalizedSavedMode && SEARCH_MODES.some(m => m.key === normalizedSavedMode)) {
            searchUiState.activeMode = normalizedSavedMode;
        }
    } catch (_) { }

    // [Fix] Ensure placeholder and UI are synced on init
    setSearchMode(searchUiState.activeMode, { skipIndexLoad: true });
    applyFullscreenDefaultSearchMode({ onlyWhenInputEmpty: true });

    const trigger = document.getElementById('searchModeTrigger');
    if (trigger && !trigger.hasAttribute('data-mode-ui-bound')) {
        trigger.setAttribute('data-mode-ui-bound', 'true');

        // When users move focus to the left mode trigger (ArrowLeft),
        // show the dedicated mode menu (NOT the empty-query suggestions panel).
        trigger.addEventListener('focus', () => {
            try {
                if (getCurrentViewSafe() !== 'canvas') return;
                const input = document.getElementById('searchInput');
                const hasQuery = !!(input && String(input.value || '').trim());
                toggleSearchHelpMenu(false);

                // Side Panel（折叠态）下，trigger 的职责是“展开搜索框”，
                // 不应在 focus 阶段先弹出模式菜单，否则会出现一次额外弹层抖动。
                if (isSidePanelModeInSearch() && !isSidePanelSearchExpanded()) {
                    toggleSearchModeMenu(false);
                    return;
                }

                if (hasQuery) {
                    // Keep results visible when a query exists; don't open the mode menu.
                    toggleSearchModeMenu(false);
                    return;
                }

                hideSearchResultsPanel();
                toggleSearchModeMenu(true);
            } catch (_) { }
        });

        trigger.addEventListener('click', (e) => {
            if (getCurrentViewSafe() !== 'canvas') return;
            e.stopPropagation();

            if (isSidePanelModeInSearch()) {
                const input = document.getElementById('searchInput');
                if (!isSidePanelSearchExpanded()) {
                    setSidePanelSearchExpanded(true);
                    try {
                        if (input) requestAnimationFrame(() => input.focus());
                    } catch (_) { }
                    return;
                }
            }

            toggleSearchHelpMenu(false);
            toggleSearchModeMenu();

            // Keep typing flow: return focus to input
            try {
                const input = document.getElementById('searchInput');
                if (input) requestAnimationFrame(() => input.focus());
            } catch (_) { }
        });

        // [Fixed] Allow cycling mode even when button has focus
        trigger.addEventListener('keydown', (e) => {
            if (getCurrentViewSafe() === 'canvas') {
                const input = document.getElementById('searchInput');
                const hasQuery = !!(input && String(input.value || '').trim());

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!hasQuery) {
                        toggleSearchModeMenu(true);
                    } else {
                        toggleSearchModeMenu(false);
                    }
                    cycleSearchMode(-1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (!hasQuery) {
                        toggleSearchModeMenu(true);
                    } else {
                        toggleSearchModeMenu(false);
                    }
                    cycleSearchMode(1);
                } else if (e.key === 'ArrowRight') {
                    // [User Request] Arrow Right to return to input
                    e.preventDefault();
                    const input = document.getElementById('searchInput');
                    if (input) {
                        // Leaving mode trigger: close the mode menu.
                        try { toggleSearchModeMenu(false); } catch (_) { }

                        input.focus();

                        // If input is empty, revert to the empty-query suggestions panel (unless user disabled it).
                        try {
                            const q = String(input.value || '').trim();
                            if (!q) {
                                if (shouldShowEmptyQuerySuggestions()) {
                                    renderCanvasSearchSuggestions();
                                    showSearchResultsPanel();
                                } else {
                                    hideSearchResultsPanel();
                                }
                            }
                        } catch (_) { }
                    }
                }
            }
        });
    }

    const menu = document.getElementById('searchModeMenu');
    if (menu) {
        menu.addEventListener('mousedown', (e) => {
            // Only handle mode selection in Canvas/mode menu
            if (menu.dataset.menuType && menu.dataset.menuType !== 'mode') return;
            const item = e.target.closest('.search-mode-menu-item');
            if (item) {
                e.preventDefault();
                e.stopPropagation();
                const modeKey = item.getAttribute('data-mode-key');
                if (modeKey) {
                    setSearchMode(modeKey, { source: 'user' });
                    // Hide menu immediately on manual selection
                    toggleSearchModeMenu(false);
                }
            }
        });
    }

    renderSearchModeUI();
}

// =============================================================================
// =============================================================================

// =============================================================================
// Phase 3: 书签画布搜索（Canvas Search）
// =============================================================================

/**
 * 画布搜索数据库（缓存索引）
 */
let canvasSearchDb = {
    signature: null,
    structureIndex: [],    // 卡片/栏目结构 (Permanent, Temp, Groups)
    descriptionIndex: [],  // 说明/内容 (MD Cards, Edges, Section Notes)
    bookmarkIndex: [],     // 书签 (Raw Bookmarks)
    itemById: new Map()
};
let canvasSearchLoadedModes = new Set();

function normalizeCanvasSearchModeKey(mode) {
    if (mode === 'bookmark' || mode === 'tag') return 'bookmark';
    if (mode === 'description') return 'description';
    return 'structure';
}

function markCanvasSearchModeLoaded(mode) {
    canvasSearchLoadedModes.add(normalizeCanvasSearchModeKey(mode));
}

function markAllCanvasSearchModesLoaded() {
    canvasSearchLoadedModes = new Set(['bookmark', 'structure', 'description']);
}

let canvasSearchReadyWaitPromise = null;

function getActiveCanvasState() {
    if (typeof window !== 'undefined' && window.CanvasModule && window.CanvasModule.CanvasState) {
        return window.CanvasModule.CanvasState;
    }
    if (typeof CanvasState !== 'undefined') {
        return CanvasState;
    }
    return null;
}

function isCanvasSearchStateReady() {
    if (!getActiveCanvasState()) return false;
    if (typeof window !== 'undefined' && window.__bookmarkCanvasSearchStateReady === true) return true;
    return false;
}

function waitForCanvasSearchStateReady() {
    if (isCanvasSearchStateReady()) return Promise.resolve(true);
    if (canvasSearchReadyWaitPromise) return canvasSearchReadyWaitPromise;

    canvasSearchReadyWaitPromise = new Promise((resolve) => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
            resolve(false);
            return;
        }
        const onReady = () => {
            cleanup();
            resolve(true);
        };
        const cleanup = () => {
            try { window.removeEventListener('canvas-search-state-ready', onReady); } catch (_) { }
            canvasSearchReadyWaitPromise = null;
        };
        window.addEventListener('canvas-search-state-ready', onReady, { once: true });
    });

    return canvasSearchReadyWaitPromise;
}

/**
 * 画布搜索高亮状态
 */
const canvasSearchHighlightState = {
    query: '',
    highlightedIds: [],
    isGroupHighlight: false
};

// ==================== Phase 3: 缓存管理 ====================

/**
 * 获取画布搜索签名（用于缓存失效判断）
 */
function getCanvasSearchSignature() {
    const activeCanvasState = getActiveCanvasState();
    if (!activeCanvasState) return '';

    return `v4:${stringifyCanvasSearchSignaturePayload(buildCanvasSearchSignaturePayload(activeCanvasState))}`;
}

/**
 * 重置画布搜索数据库
 */
function resetCanvasSearchDb(reason = '') {
    canvasSearchDb = {
        signature: null,
        structureIndex: [],
        descriptionIndex: [],
        bookmarkIndex: [],
        itemById: new Map()
    };
    canvasSearchLoadedModes = new Set();
    invalidateCanvasTagSearchCaches();
    invalidateCanvasNoteSearchCaches();
    if (searchUiState && searchUiState.domainIndexCache) {
        searchUiState.domainIndexCache = null;
    }
    ;
}

function updateCanvasSearchBookmarkTags(targets) {
    const list = Array.isArray(targets) ? targets : [];
    if (!list.length || !canvasSearchDb || !Array.isArray(canvasSearchDb.bookmarkIndex)) return false;

    let changed = false;
    list.forEach((target) => {
        if (!target) return;
        let matched = [];
        if (target.kind === 'temporary') {
            const sectionId = String(target.sectionId || '');
            const itemId = String(target.itemId || '');
            matched = canvasSearchDb.bookmarkIndex.filter((item) =>
                item && item.type === 'bookmark-item' &&
                item.source === 'temporary' &&
                String(item.sectionId || '') === sectionId &&
                String(item.id || '') === itemId
            );
        } else if (target.kind === 'permanent') {
            const chromeId = String(target.chromeId || '');
            matched = canvasSearchDb.bookmarkIndex.filter((item) =>
                item && item.type === 'bookmark-item' &&
                item.source === 'permanent' &&
                String(item.id || '') === chromeId
            );
        }

        matched.forEach((item) => {
            const sourceTags = Array.isArray(target.tags) ? target.tags : __getItemTagsForSearch(item);
            const tags = sourceTags.map((tag) => ({
                color: String(tag.color || ''),
                text: String(tag.text || '')
            })).filter((tag) => tag.color);
            if (tags.length) item.tags = tags;
            else if (Object.prototype.hasOwnProperty.call(item, 'tags')) delete item.tags;
            item.__tags = tags.map((tag) => `${tag.color} ${tag.text}`).join(' ').toLowerCase();
            if (canvasBookmarkTagSearchStateCache && typeof canvasBookmarkTagSearchStateCache.delete === 'function') {
                canvasBookmarkTagSearchStateCache.delete(item);
            }
            changed = true;
        });
    });

    if (changed) {
        invalidateCanvasTagSearchCaches();
        if (searchUiState && searchUiState.domainIndexCache) {
            searchUiState.domainIndexCache = null;
        }
    }

    return changed;
}

function updateCanvasSearchBookmarkNotes(targets) {
    const list = Array.isArray(targets) ? targets : [];
    if (!list.length || !canvasSearchDb || !Array.isArray(canvasSearchDb.bookmarkIndex)) return false;

    let changed = false;
    list.forEach((target) => {
        if (!target) return;
        let matched = [];
        if (target.kind === 'temporary') {
            const sectionId = String(target.sectionId || '');
            const itemId = String(target.itemId || '');
            matched = canvasSearchDb.bookmarkIndex.filter((item) =>
                item && item.type === 'bookmark-item' &&
                item.source === 'temporary' &&
                String(item.sectionId || '') === sectionId &&
                String(item.id || '') === itemId
            );
        } else if (target.kind === 'permanent') {
            const chromeId = String(target.chromeId || '');
            matched = canvasSearchDb.bookmarkIndex.filter((item) =>
                item && item.type === 'bookmark-item' &&
                item.source === 'permanent' &&
                String(item.id || '') === chromeId
            );
        }

        matched.forEach((item) => {
            const sourceMeta = __getItemNoteMetaForSearch(item);
            const note = normalizeNoteForSearch(
                Object.prototype.hasOwnProperty.call(target, 'note')
                    ? target.note
                    : sourceMeta.note
            );
            const color = normalizeNoteColorForSearch(
                Object.prototype.hasOwnProperty.call(target, 'color')
                    ? target.color
                    : (Object.prototype.hasOwnProperty.call(target, 'noteColor') ? target.noteColor : sourceMeta.color)
            );
            if (note) {
                item.note = note;
                item.noteColor = color;
            } else {
                if (Object.prototype.hasOwnProperty.call(item, 'note')) delete item.note;
                if (Object.prototype.hasOwnProperty.call(item, 'noteColor')) delete item.noteColor;
            }
            item.__note = note.toLowerCase();
            if (canvasBookmarkNoteSearchStateCache && typeof canvasBookmarkNoteSearchStateCache.delete === 'function') {
                canvasBookmarkNoteSearchStateCache.delete(item);
            }
            changed = true;
        });
    });

    if (changed) {
        invalidateCanvasNoteSearchCaches();
        if (searchUiState && searchUiState.domainIndexCache) {
            searchUiState.domainIndexCache = null;
        }
    }

    return changed;
}

// ==================== Phase 3: 缓存与空闲优化管理器 ====================

let isSearchStorageListening = false;

function startListeningStorageChanges() {
    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.onChanged) {
        if (!isSearchStorageListening) {
            chrome.storage.onChanged.addListener(handleSearchStorageChange);
            isSearchStorageListening = true;
            ;
        }
    }
}

function stopListeningStorageChanges() {
    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.onChanged) {
        if (isSearchStorageListening) {
            chrome.storage.onChanged.removeListener(handleSearchStorageChange);
            isSearchStorageListening = false;
            ;
        }
    }
}

// 提取的辅助工具函数（原定义在 buildCanvasSearchDbSync 内部）
const toAlpha = (num) => {
    if (!Number.isFinite(num) || num <= 0) return '';
    let s = '';
    while (num > 0) {
        const rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
};

const canvasSearchPresetToHex = (preset) => {
    switch (String(preset)) {
        case '1': return '#fb464c'; // Red
        case '2': return '#e9973f'; // Orange
        case '3': return '#e0de71'; // Yellow
        case '4': return '#44cf6e'; // Green
        case '5': return '#53dfdd'; // Cyan
        case '6': return '#a882ff'; // Purple
        case 'red': return '#fb464c';
        case 'orange': return '#e9973f';
        case 'yellow': return '#e0de71';
        case 'green': return '#44cf6e';
        case 'cyan': return '#53dfdd';
        case 'blue': return '#2563eb'; // Temp section blue
        case 'purple': return '#a882ff';
        case 'gray': return '#9ca3af';
        default: return null;
    }
};

const parseDefaultTempSectionTitleTime = (title) => {
    const t = String(title || '').trim();
    if (!t) return 0;
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return 0;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const hh = parseInt(m[4] || '0', 10);
    const mi = parseInt(m[5] || '0', 10);
    const ss = parseInt(m[6] || '0', 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
    const dt = new Date(y, mo - 1, d, hh, mi, ss);
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : 0;
};

const inferTempSectionTime = (section, title) => {
    if (!section || typeof section !== 'object') return 0;
    const explicit = section.time;
    if (explicit) {
        const ms = (typeof explicit === 'number')
            ? explicit
            : Date.parse(String(explicit));
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    const fromTitle = parseDefaultTempSectionTitleTime(title);
    if (fromTitle) return fromTitle;
    return 0;
};

function normalizeCanvasSearchNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeCanvasSearchString(value) {
    return value === undefined || value === null ? '' : String(value);
}

function stringifyCanvasSearchSignaturePayload(payload) {
    try {
        return JSON.stringify(payload || {});
    } catch (_) {
        return '{}';
    }
}

function parseCanvasSearchSignaturePayload(signature) {
    const raw = normalizeCanvasSearchString(signature);
    const sep = raw.indexOf(':');
    if (sep <= 0) return null;
    const version = raw.slice(0, sep);
    if (!/^v\d+$/.test(version)) return null;
    try {
        const parsed = JSON.parse(raw.slice(sep + 1));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function collectCanvasSearchContentSignature(activeCanvasState) {
    const canvasItems = [];
    if (!activeCanvasState || typeof activeCanvasState !== 'object') return canvasItems;

    for (const node of (Array.isArray(activeCanvasState.mdNodes) ? activeCanvasState.mdNodes : [])) {
        if (!node || !node.id) continue;
        if (node.subtype === 'card-group') {
            const label = normalizeCanvasSearchString(node.label).trim();
            if (!label) continue;
            canvasItems.push({
                id: normalizeCanvasSearchString(node.id),
                kind: 'group',
                label,
                color: normalizeCanvasSearchString(getCanvasSearchNodeColor(node, '#475569'))
            });
            continue;
        }
        canvasItems.push({
            id: normalizeCanvasSearchString(node.id),
            kind: 'md-node',
            subtype: normalizeCanvasSearchString(node.subtype),
            title: normalizeCanvasSearchString(node.title),
            text: normalizeCanvasSearchString(node.text),
            color: normalizeCanvasSearchString(getCanvasSearchNodeColor(node, '#2563eb'))
        });
    }

    for (const edge of (Array.isArray(activeCanvasState.edges) ? activeCanvasState.edges : [])) {
        if (!edge || !edge.id || !edge.label) continue;
        canvasItems.push({
            id: normalizeCanvasSearchString(edge.id),
            kind: 'edge',
            label: normalizeCanvasSearchString(edge.label),
            color: normalizeCanvasSearchString(edge.colorHex || canvasSearchPresetToHex(edge.color) || '#999'),
            direction: normalizeCanvasSearchString(edge.direction || 'none')
        });
    }

    return canvasItems;
}

function collectSectionSearchContentSignature(activeCanvasState) {
    const sectionItems = [];
    if (!activeCanvasState || typeof activeCanvasState !== 'object') return sectionItems;

    for (const section of (Array.isArray(activeCanvasState.tempSections) ? activeCanvasState.tempSections : [])) {
        if (!section || !section.id) continue;
        const title = section.title || section.name || '';
        const label = getTempSectionSearchLabel(section);
        sectionItems.push({
            id: normalizeCanvasSearchString(section.id),
            title: normalizeCanvasSearchString(title),
            label,
            sequenceNumber: normalizeCanvasSearchString(section.sequenceNumber || null),
            description: normalizeCanvasSearchString((section.description || '').replace(/<[^>]+>/g, ' ').trim()),
            originDisplayIndex: normalizeCanvasSearchString(getTempSectionOriginDisplayIndex(section, label) || ''),
            color: normalizeCanvasSearchString(getTempSectionSearchColor(section)),
            items: collectTempSectionSearchItemSnapshots(section)
        });
    }

    return sectionItems;
}

function collectPermanentBookmarkMetadataSearchSignature() {
    const metadata = [];
    let permanentTree = null;
    try {
        if (typeof cachedCurrentTree !== 'undefined' && Array.isArray(cachedCurrentTree)) {
            permanentTree = cachedCurrentTree;
        } else if (typeof window !== 'undefined' && Array.isArray(window.cachedCurrentTree)) {
            permanentTree = window.cachedCurrentTree;
        }
    } catch (_) { }
    if (!permanentTree || !permanentTree[0]) return metadata;

    const stack = [permanentTree[0]];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node.id === 'undefined' || node.id === null) continue;
        const id = String(node.id);
        const tags = normalizeTagsForPayload(readPermanentNodeTagsCachedForPayload(id));
        const noteMeta = readPermanentNodeNoteMetaCachedForPayload(id);
        const note = normalizeNoteForSearch(noteMeta.note);
        if (tags.length || note) {
            metadata.push({
                id,
                tags,
                note,
                noteColor: normalizeNoteColorForSearch(noteMeta.noteColor || noteMeta.color)
            });
        }
        if (Array.isArray(node.children) && node.children.length) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push(node.children[i]);
            }
        }
    }
    metadata.sort((a, b) => a.id.localeCompare(b.id));
    return metadata;
}

function collectPermanentSearchContentSignature() {
    const treeVersion = (typeof lastTreeSnapshotVersion !== 'undefined' && lastTreeSnapshotVersion !== null)
        ? String(lastTreeSnapshotVersion)
        : '';
    const treeFingerprint = (typeof lastTreeFingerprint !== 'undefined' && lastTreeFingerprint)
        ? String(lastTreeFingerprint)
        : '';

    let mainDescription = '';
    try {
        mainDescription = getPermanentDescriptionTextForSearch(null);
    } catch (_) { }

    const copies = [];
    try {
        const liveCopies = getPermanentCopyShellsForSearch();
        liveCopies.forEach((copy, idx) => {
            if (!copy || !copy.copyId) return;
            const copyId = normalizeCanvasSearchString(copy.copyId);
            copies.push({
                copyId,
                displayIndex: normalizeCanvasSearchString(getPermanentCopySearchDisplayIndex(copy, idx)),
                description: normalizeCanvasSearchString(getPermanentDescriptionTextForSearch(copyId))
            });
        });
    } catch (_) { }

    return {
        treeVersion,
        treeFingerprint,
        mainDescription: normalizeCanvasSearchString(mainDescription),
        metadata: collectPermanentBookmarkMetadataSearchSignature(),
        copies
    };
}

function buildCanvasSearchSignaturePayload(activeCanvasState) {
    return {
        canvas: collectCanvasSearchContentSignature(activeCanvasState),
        sections: collectSectionSearchContentSignature(activeCanvasState),
        permanent: collectPermanentSearchContentSignature()
    };
}

function getCanvasSearchSignatureParts(signature) {
    const raw = normalizeCanvasSearchString(signature);
    const firstColon = raw.indexOf(':');
    if (firstColon < 0) {
        return {
            raw,
            version: raw,
            tempStateTimestamp: '',
            treeSnapshotToken: '',
            permanentCopiesLen: ''
        };
    }

    const version = raw.slice(0, firstColon);
    const rest = raw.slice(firstColon + 1);
    const secondColon = rest.indexOf(':');
    if (secondColon < 0) {
        return {
            raw,
            version,
            tempStateTimestamp: rest,
            treeSnapshotToken: '',
            permanentCopiesLen: ''
        };
    }

    const tempStateTimestamp = rest.slice(0, secondColon);
    const afterTemp = rest.slice(secondColon + 1);
    const lastColon = afterTemp.lastIndexOf(':');

    return {
        raw,
        version,
        tempStateTimestamp,
        treeSnapshotToken: lastColon >= 0 ? afterTemp.slice(0, lastColon) : afterTemp,
        permanentCopiesLen: lastColon >= 0 ? afterTemp.slice(lastColon + 1) : ''
    };
}

function addDirtyKeysFromSearchSignatureDiff(detected, cachedSignature, liveSignature) {
    if (!(detected instanceof Set)) return;
    const cachedPayload = parseCanvasSearchSignaturePayload(cachedSignature);
    const livePayload = parseCanvasSearchSignaturePayload(liveSignature);
    if (cachedPayload && livePayload) {
        if (stringifyCanvasSearchSignaturePayload(cachedPayload.canvas) !== stringifyCanvasSearchSignaturePayload(livePayload.canvas)) {
            detected.add('bcs:canvas');
        }

        const cachedSections = new Map((Array.isArray(cachedPayload.sections) ? cachedPayload.sections : [])
            .filter(sec => sec && sec.id)
            .map(sec => [String(sec.id), sec]));
        const liveSections = new Map((Array.isArray(livePayload.sections) ? livePayload.sections : [])
            .filter(sec => sec && sec.id)
            .map(sec => [String(sec.id), sec]));
        for (const [sectionId, liveSection] of liveSections.entries()) {
            if (stringifyCanvasSearchSignaturePayload(cachedSections.get(sectionId)) !== stringifyCanvasSearchSignaturePayload(liveSection)) {
                detected.add(`bcs:section:${sectionId}`);
            }
        }
        for (const sectionId of cachedSections.keys()) {
            if (!liveSections.has(sectionId)) {
                detected.add(`bcs:section:${sectionId}`);
            }
        }

        const cachedPermanent = cachedPayload.permanent || {};
        const livePermanent = livePayload.permanent || {};
        if (normalizeCanvasSearchString(cachedPermanent.treeVersion) !== normalizeCanvasSearchString(livePermanent.treeVersion) ||
            normalizeCanvasSearchString(cachedPermanent.treeFingerprint) !== normalizeCanvasSearchString(livePermanent.treeFingerprint)) {
            detected.add('cachedCurrentTree');
        }
        if (normalizeCanvasSearchString(cachedPermanent.mainDescription) !== normalizeCanvasSearchString(livePermanent.mainDescription)) {
            detected.add('bcs:perm:main');
        }

        const cachedCopies = new Map((Array.isArray(cachedPermanent.copies) ? cachedPermanent.copies : [])
            .filter(copy => copy && copy.copyId)
            .map(copy => [String(copy.copyId), copy]));
        const liveCopies = new Map((Array.isArray(livePermanent.copies) ? livePermanent.copies : [])
            .filter(copy => copy && copy.copyId)
            .map(copy => [String(copy.copyId), copy]));
        for (const [copyId, liveCopy] of liveCopies.entries()) {
            if (stringifyCanvasSearchSignaturePayload(cachedCopies.get(copyId)) !== stringifyCanvasSearchSignaturePayload(liveCopy)) {
                detected.add(`bcs:perm:copy-${copyId}`);
            }
        }
        for (const copyId of cachedCopies.keys()) {
            if (!liveCopies.has(copyId)) {
                detected.add(`bcs:perm:copy-${copyId}`);
            }
        }
        return;
    }

    const cached = getCanvasSearchSignatureParts(cachedSignature);
    const live = getCanvasSearchSignatureParts(liveSignature);
    if (!cached.raw || !live.raw || cached.raw === live.raw) return;

    if (cached.version !== live.version) {
        detected.add('bcs:canvas');
        detected.add('bcs:perm:main');
        return;
    }

    if (cached.treeSnapshotToken !== live.treeSnapshotToken) {
        detected.add('cachedCurrentTree');
    }
    if (cached.permanentCopiesLen !== live.permanentCopiesLen) {
        detected.add('bcs:perm:main');
    }
}

function getCanvasSearchBoxMetrics(source, fallbackColor = '') {
    const safe = source && typeof source === 'object' ? source : {};
    return {
        x: normalizeCanvasSearchNumber(safe.x, 0),
        y: normalizeCanvasSearchNumber(safe.y, 0),
        w: normalizeCanvasSearchNumber(safe.width !== undefined ? safe.width : safe.w, 300),
        h: normalizeCanvasSearchNumber(safe.height !== undefined ? safe.height : safe.h, 300),
        color: normalizeCanvasSearchString(safe.color || fallbackColor)
    };
}

function getCanvasSearchNodeColor(node, fallbackColor) {
    if (node && node.colorHex) return node.colorHex;
    if (node && node.color) return canvasSearchPresetToHex(node.color) || fallbackColor;
    return fallbackColor;
}

function getTempSectionSearchColor(section) {
    if (section && section.color) {
        const c = String(section.color).trim();
        return c.startsWith('#') ? c : `#${c}`;
    }
    return '#2563eb';
}

function getTempSectionSearchLabel(section) {
    if (!section || typeof section !== 'object') return '';
    let label = (typeof section.label === 'string') ? section.label.trim() : '';
    const sequenceNumber = section.sequenceNumber || null;
    if (!label && sequenceNumber) {
        const alpha = toAlpha(sequenceNumber);
        if (alpha) label = `${alpha}-1`;
    }
    return label;
}

function getTempSectionOriginDisplayIndex(section, label = '') {
    if (!section || typeof section !== 'object') return null;
    let originDisplayIndex = null;
    if (section.originPermanent && typeof section.originPermanent === 'object') {
        if (typeof section.originPermanent.displayIndex === 'number') {
            originDisplayIndex = section.originPermanent.displayIndex;
        } else if (section.originPermanent.copyId === null) {
            originDisplayIndex = 1;
        }
    }
    const safeLabel = normalizeCanvasSearchString(label).trim();
    if (safeLabel && /^[A-Z]-/i.test(safeLabel)) {
        const inferredIndex = safeLabel.charAt(0).toUpperCase().charCodeAt(0) - 64;
        if (inferredIndex >= 1) originDisplayIndex = inferredIndex;
    }
    return originDisplayIndex;
}

function buildCanvasSearchDateFields(timestamp) {
    const ms = Number(timestamp);
    if (!Number.isFinite(ms) || ms <= 0) return {};
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return {
        __dateYear: year,
        __dateMonth: month,
        __dateDay: day,
        __dateWeekday: d.getDay(),
        __dateKey: `${year}-${mm}-${dd}`,
        __dateMonthKey: `${year}-${mm}`,
        __dateMmdd: `${mm}-${dd}`
    };
}

function getInlineTagSearchSignature(tags) {
    if (!Array.isArray(tags)) return '';
    return tags
        .filter(t => t && t.color)
        .map(t => `${String(t.color)}:${String(t.text || '')}`)
        .join('|');
}

function normalizeNoteForSearch(noteInput) {
    if (noteInput === undefined || noteInput === null) return '';
    return String(noteInput).replace(/\r\n?/g, '\n').trim();
}

const NOTE_COLOR_DEFAULT = 'orange';
const NOTE_COLOR_PALETTE = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']);

function normalizeNoteColorForSearch(colorInput, fallback = NOTE_COLOR_DEFAULT) {
    const color = String(colorInput || '').trim().toLowerCase();
    if (NOTE_COLOR_PALETTE.has(color)) return color;
    const fallbackColor = String(fallback || '').trim().toLowerCase();
    return NOTE_COLOR_PALETTE.has(fallbackColor) ? fallbackColor : NOTE_COLOR_DEFAULT;
}

function collectTempSectionSearchItemSnapshots(section) {
    const snapshots = [];
    if (!section || !Array.isArray(section.items)) return snapshots;

    const sectionTitle = typeof section.title === 'string' ? section.title : (typeof section.name === 'string' ? section.name : '');
    const sectionLabel = getTempSectionSearchLabel(section);
    const sectionPrefix = [sectionLabel, sectionTitle].filter(Boolean).join(' ');
    const pathStack = sectionPrefix ? [sectionPrefix] : [];
    const stack = [];

    for (let i = section.items.length - 1; i >= 0; i--) {
        stack.push({ item: section.items[i], parentId: '', stage: 0 });
    }

    while (stack.length) {
        const frame = stack.pop();
        const it = frame ? frame.item : null;
        if (!it || !it.id) continue;

        const itemUrl = typeof it.url === 'string' ? it.url : '';
        const itemNodeType = it.type === 'folder' ? 'folder' : 'bookmark';
        const rawTitle = typeof it.title === 'string' ? it.title : '';
        const itemTitle = (itemNodeType === 'bookmark') ? (rawTitle || itemUrl || '') : rawTitle;

        if (frame.stage === 1) {
            if (itemTitle) pathStack.pop();
            continue;
        }

        if (itemTitle) pathStack.push(itemTitle);

        if (itemUrl || itemTitle) {
            snapshots.push({
                id: String(it.id),
                nodeType: itemNodeType,
                title: itemTitle,
                url: itemUrl,
                parentId: frame.parentId ? String(frame.parentId) : '',
                namedPath: pathStack.length ? pathStack.join(' > ') : '',
                tags: getInlineTagSearchSignature(it.tags),
                note: normalizeNoteForSearch(it.note),
                noteColor: normalizeNoteColorForSearch(it.noteColor)
            });
        }

        stack.push({ item: it, parentId: frame.parentId, stage: 1 });

        if (Array.isArray(it.children) && it.children.length) {
            for (let j = it.children.length - 1; j >= 0; j--) {
                stack.push({ item: it.children[j], parentId: it.id, stage: 0 });
            }
        }
    }

    return snapshots;
}

function checkCanvasSearchMultiColumnMode() {
    let maxIndexFound = 1;
    try {
        if (getPermanentCopyShellsForSearch().length > 0) {
            maxIndexFound = 2;
        }
    } catch (_) { }
    const activeCanvasState = getActiveCanvasState();
    if (activeCanvasState && activeCanvasState.tempSections) {
        for (const section of activeCanvasState.tempSections) {
            if (!section) continue;
            let idx = 1;
            if (section.originPermanent && typeof section.originPermanent.displayIndex === 'number') {
                idx = section.originPermanent.displayIndex;
            }
            const label = (typeof section.label === 'string') ? section.label.trim() : '';
            if (label && /^[A-Z]-/i.test(label)) {
                const letter = label.charAt(0).toUpperCase();
                const inferred = letter.charCodeAt(0) - 64;
                if (inferred > idx) idx = inferred;
            }
            if (idx > maxIndexFound) maxIndexFound = idx;
        }
    }
    return maxIndexFound > 1;
}

// 模块化切片解析器 Helpers
function parseTempSectionSlice(section, db, coords, isMultiColumnMode, bookmarkOrderRef) {
    if (!section || !section.id) return;

    const title = section.title || section.name || '';
    const description = (section.description || '').replace(/<[^>]+>/g, ' ').trim();
    const label = getTempSectionSearchLabel(section);
    const sequenceNumber = section.sequenceNumber || null;
    const originDisplayIndex = getTempSectionOriginDisplayIndex(section, label);
    const color = getTempSectionSearchColor(section);
    const metrics = getCanvasSearchBoxMetrics(section, color);

    const item = {
        id: section.id,
        type: 'temp-section',
        title: title,
        label: label,
        sequenceNumber: sequenceNumber,
        description: description,
        originDisplayIndex: originDisplayIndex,
        x: metrics.x,
        y: metrics.y,
        w: metrics.w,
        h: metrics.h,
        color: color,
        __title: title.toLowerCase(),
        __label: label.toLowerCase(),
        __description: description.toLowerCase(),
        isMultiColumnMode: isMultiColumnMode
    };

    const structureItem = Object.assign({}, item);
    structureItem.__description = '';
    db.structureIndex.push(structureItem);

    if (description) {
        const descItem = Object.assign({}, item);
        descItem.__title = '';
        descItem.__label = '';
        db.descriptionIndex.push(descItem);
    }

    db.itemById.set(section.id, item);

    if (coords) {
        coords[section.id] = {
            x: metrics.x,
            y: metrics.y,
            w: metrics.w,
            h: metrics.h,
            color: color,
            type: 'structure-item',
            copyId: null,
            sectionId: null
        };
    }

    // 递归解析栏目内部的所有书签
    if (Array.isArray(section.items)) {
        const sectionTitle = typeof section.title === 'string' ? section.title : (typeof section.name === 'string' ? section.name : '');
        const sectionLabel = getTempSectionSearchLabel(section);

        const sectionPrefix = [sectionLabel, sectionTitle].filter(Boolean).join(' ');
        const pathStack = sectionPrefix ? [sectionPrefix] : [];

        const stack = [];
        for (let i = section.items.length - 1; i >= 0; i--) {
            stack.push({ item: section.items[i], parentId: '', stage: 0 });
        }

        while (stack.length) {
            const frame = stack.pop();
            const it = frame ? frame.item : null;
            if (!it || !it.id) continue;

            const itemUrl = typeof it.url === 'string' ? it.url : '';
            const itemNodeType = it.type === 'folder' ? 'folder' : 'bookmark';
            const rawTitle = typeof it.title === 'string' ? it.title : '';
            const itemTitle = (itemNodeType === 'bookmark') ? (rawTitle || itemUrl || '') : rawTitle;

            if (frame.stage === 1) {
                if (itemTitle) pathStack.pop();
                continue;
            }

            if (itemTitle) pathStack.push(itemTitle);

            if (itemUrl || itemTitle) {
                const namedPath = pathStack.length ? pathStack.join(' > ') : '';
                const inlineTags = Array.isArray(it.tags)
                    ? it.tags.filter(t => t && t.color).map(t => ({ color: String(t.color), text: String(t.text || '') }))
                    : [];
                const inlineNote = normalizeNoteForSearch(it.note);
                const inlineNoteColor = normalizeNoteColorForSearch(it.noteColor);
                const bItem = {
                    id: String(it.id),
                    type: 'bookmark-item',
                    source: 'temporary',
                    nodeType: itemNodeType,
                    title: itemTitle,
                    url: itemUrl,
                    parentId: frame.parentId ? String(frame.parentId) : '',
                    sectionId: String(section.id),
                    sectionLabel,
                    sectionTitle,
                    sectionSource: typeof section.source === 'string' ? section.source : '',
                    namedPath,
                    color: color,
                    tags: inlineTags,
                    note: inlineNote,
                    noteColor: inlineNoteColor,
                    __title: itemTitle.toLowerCase(),
                    __url: itemUrl.toLowerCase(),
                    __path: namedPath.toLowerCase(),
                    __tags: inlineTags.map(t => `${t.color} ${t.text}`).join(' ').toLowerCase(),
                    __note: inlineNote.toLowerCase(),
                    bookmarkSearchOrder: bookmarkOrderRef.value++
                };
                db.bookmarkIndex.push(bItem);
                db.itemById.set(String(it.id), bItem);
            }

            stack.push({ item: it, parentId: frame.parentId, stage: 1 });

            if (Array.isArray(it.children) && it.children.length) {
                for (let j = it.children.length - 1; j >= 0; j--) {
                    stack.push({ item: it.children[j], parentId: it.id, stage: 0 });
                }
            }
        }
    }
}

function parseCanvasLayoutSlice(db, coords) {
    const activeCanvasState = getActiveCanvasState();
    if (!activeCanvasState) return;

    // 1. MD 卡片 (说明搜索 + 标题)
    for (const node of (activeCanvasState.mdNodes || [])) {
        if (!node || !node.id) continue;
        if (node.subtype === 'card-group') continue;

        const title = node.title || '';
        const text = node.text || '';
        const subtype = node.subtype || '';

        const color = getCanvasSearchNodeColor(node, '#2563eb');
        const metrics = getCanvasSearchBoxMetrics(node, color);

        const item = {
            id: node.id,
            type: 'md-node',
            subtype: subtype,
            title: title,
            text: text,
            x: metrics.x,
            y: metrics.y,
            w: metrics.w,
            h: metrics.h,
            color: color,
            __title: title.toLowerCase(),
            __text: text.substring(0, 3000).toLowerCase()
        };

        db.descriptionIndex.push(item);
        db.itemById.set(node.id, item);

        if (coords) {
            coords[node.id] = {
                x: metrics.x,
                y: metrics.y,
                w: metrics.w,
                h: metrics.h,
                color: color,
                type: 'description-item',
                copyId: null,
                sectionId: null
            };
        }
    }

    // 2. 连接线 (说明搜索)
    for (const edge of (activeCanvasState.edges || [])) {
        if (!edge || !edge.id) continue;
        if (!edge.label) continue;

        const item = {
            id: edge.id,
            type: 'edge',
            label: edge.label,
            fromId: edge.fromNode || edge.from || edge.fromId,
            toId: edge.toNode || edge.to || edge.toId,
            color: edge.colorHex || canvasSearchPresetToHex(edge.color) || '#999',
            direction: edge.direction || 'none',
            __label: edge.label.toLowerCase()
        };

        db.descriptionIndex.push(item);
        db.itemById.set(edge.id, item);
    }

    // 3. 卡片组 (容器名)
    for (const node of (activeCanvasState.mdNodes || [])) {
        if (!node || !node.id) continue;
        if (node.subtype !== 'card-group') continue;
        const labelRaw = node.label || '';
        const labelText = String(labelRaw).trim();
        if (!labelText) continue;

        const color = getCanvasSearchNodeColor(node, '#475569');
        const metrics = getCanvasSearchBoxMetrics(node, color);

        const groupItem = {
            id: node.id,
            type: 'group',
            subtype: node.subtype,
            title: labelText,
            label: labelText,
            x: metrics.x,
            y: metrics.y,
            w: metrics.w,
            h: metrics.h,
            color: color,
            __title: labelText.toLowerCase(),
            __label: labelText.toLowerCase()
        };
        db.structureIndex.push(groupItem);
        db.itemById.set(node.id, groupItem);

        if (coords) {
            coords[node.id] = {
                x: metrics.x,
                y: metrics.y,
                w: metrics.w,
                h: metrics.h,
                color: color,
                type: 'structure-item',
                copyId: null,
                sectionId: null
            };
        }
    }
}

function parsePermanentSectionSlice(db, coords, isMultiColumnMode) {
    const permanentShellSnapshot = collectPermanentViewShellSnapshotForSearch();
    const permanentDescription = getPermanentDescriptionTextForSearch(null, permanentShellSnapshot);
    const permanentCopies = getPermanentCopyShellsForSearch(permanentShellSnapshot);
    const hasCopies = permanentCopies.length > 0;

    const permanentSectionId = 'permanentSection';
    const permColor = '#10b981';

    const mainTitle = (currentLang === 'en' ? 'Permanent Column' : '永久栏目') + ' #A';
    const mainItem = {
        id: permanentSectionId,
        type: 'permanent-section',
        title: mainTitle,
        description: permanentDescription,
        copyIndex: null,
        displayIndex: 1,
        hasCopies: hasCopies,
        color: permColor,
        __title: (currentLang === 'en' ? 'permanent column' : '永久栏目'),
        __label: '#a',
        __description: permanentDescription.toLowerCase(),
        isMultiColumnMode: isMultiColumnMode
    };

    const mainStructureItem = Object.assign({}, mainItem);
    mainStructureItem.__description = '';
    db.structureIndex.push(mainStructureItem);

    if (permanentDescription) {
        const mainDescItem = Object.assign({}, mainItem);
        mainDescItem.__title = '';
        mainDescItem.__label = '';
        db.descriptionIndex.push(mainDescItem);
    }

    db.itemById.set(permanentSectionId, mainItem);

    if (coords) {
        coords[permanentSectionId] = {
            x: 0,
            y: 0,
            w: 300,
            h: 300,
            color: permColor,
            type: 'structure-item',
            copyId: null,
            sectionId: null
        };
    }
}

function parsePermanentCopySlice(copy, idx, db, coords, isMultiColumnMode) {
    if (!copy) return;
    const copyId = String(copy.copyId || '').trim();
    if (!copyId) return;

    const dIndex = getPermanentCopySearchDisplayIndex(copy, idx);
    const permanentShellSnapshot = collectPermanentViewShellSnapshotForSearch();
    const copyDescription = getPermanentDescriptionTextForSearch(copyId, permanentShellSnapshot);

    const idxLabel = toAlpha(dIndex);
    const permColor = '#10b981';
    const copyItem = {
        id: copyId,
        type: 'permanent-section',
        title: (currentLang === 'en' ? `Permanent Copy #${idxLabel}` : `永久栏目副本 #${idxLabel}`),
        description: copyDescription,
        copyId,
        displayIndex: dIndex,
        hasCopies: true,
        isMultiColumnMode: isMultiColumnMode,
        color: permColor,
        __title: (currentLang === 'en' ? `permanent copy #${idxLabel}` : `永久栏目副本 #${idxLabel}`).toLowerCase(),
        __label: `#${idxLabel.toLowerCase()}`,
        __description: copyDescription.toLowerCase()
    };

    const itemStructureCopy = Object.assign({}, copyItem);
    itemStructureCopy.__description = '';
    db.structureIndex.push(itemStructureCopy);

    if (copyDescription) {
        const itemDescCopy = Object.assign({}, copyItem);
        itemDescCopy.__title = '';
        itemDescCopy.__label = '';
        db.descriptionIndex.push(itemDescCopy);
    }
    db.itemById.set(copyId, copyItem);

    if (coords) {
        coords[copyId] = {
            x: 0,
            y: 0,
            w: 300,
            h: 300,
            color: permColor,
            type: 'structure-item',
            copyId: copyId,
            sectionId: null
        };
    }
}

function parsePermanentTreeSlice(db, bookmarkOrderRef) {
    let permanentTree = null;
    try {
        if (typeof cachedCurrentTree !== 'undefined' && Array.isArray(cachedCurrentTree)) {
            permanentTree = cachedCurrentTree;
        } else if (typeof window !== 'undefined' && Array.isArray(window.cachedCurrentTree)) {
            permanentTree = window.cachedCurrentTree;
        }
    } catch (_) { }

    if (permanentTree && permanentTree[0]) {
        const pathStack = [];
        const stack = [{ node: permanentTree[0], stage: 0 }];

        while (stack.length) {
            const frame = stack.pop();
            const node = frame ? frame.node : null;
            if (!node || typeof node.id === 'undefined' || node.id === null) continue;

            const rawTitle = typeof node.title === 'string' ? node.title : '';

            if (frame.stage === 1) {
                if (rawTitle) pathStack.pop();
                continue;
            }

            const url = typeof node.url === 'string' ? node.url : '';
            const nodeType = url ? 'bookmark' : 'folder';
            const title = (nodeType === 'bookmark') ? (rawTitle || url || '') : rawTitle;

            if (rawTitle) pathStack.push(rawTitle);

            if (url || title) {
                const namedPath = pathStack.length ? pathStack.join(' > ') : '';
                const bItem = {
                    id: String(node.id),
                    type: 'bookmark-item',
                    source: 'permanent',
                    nodeType,
                    title,
                    url,
                    parentId: node.parentId ? String(node.parentId) : '',
                    namedPath,
                    __title: title.toLowerCase(),
                    __url: url.toLowerCase(),
                    __path: namedPath.toLowerCase(),
                    bookmarkSearchOrder: bookmarkOrderRef.value++
                };
                db.bookmarkIndex.push(bItem);
                db.itemById.set(String(node.id), bItem);
            }

            stack.push({ node, stage: 1 });

            if (Array.isArray(node.children) && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i], stage: 0 });
                }
            }
        }
    }
}

function mergeCoordinatesIntoItemById(db, coords) {
    if (!coords || !db.itemById) return;
    for (const [id, coord] of Object.entries(coords)) {
        if (!db.itemById.has(id)) {
            db.itemById.set(id, {
                id,
                type: coord.type,
                x: coord.x,
                y: coord.y,
                w: coord.w,
                h: coord.h,
                color: coord.color,
                copyId: coord.copyId,
                sectionId: coord.sectionId
            });
        } else {
            const item = db.itemById.get(id);
            item.x = coord.x;
            item.y = coord.y;
            if (typeof coord.w === 'number') item.w = coord.w;
            if (typeof coord.h === 'number') item.h = coord.h;
            if (coord.color) item.color = coord.color;
            if (coord.copyId) item.copyId = coord.copyId;
            if (coord.sectionId) item.sectionId = coord.sectionId;
        }
    }
}

const SearchIndexManager = {
    isDirty: false,
    needsFullUpdate: false,
    dirtyKeys: new Set(),
    dirtyKeyVersions: {},
    dirtyRevision: 0,
    fullDirtyRevision: 0,
    isIndexing: false,
    hasPendingSyncWriteBack: false,
    listenersBound: false,
    idleListener: null,
    checkTimer: null,
    recordActivity: null,

    // Snapshot the exact dirty revisions being processed so newer dirty marks survive cleanup.
    processingKeys: null,
    processingKeyVersions: null,
    processingFullUpdate: false,
    processingFullRevision: 0,
    processingBaseSignature: null,
    dirtyStateWriteChain: Promise.resolve(),
    dirtyStateNotifyChain: Promise.resolve(),

    bindActivityListeners() {
        if (this.listenersBound) return;
        this.listenersBound = true;
        
        if (typeof chrome !== 'undefined' && chrome && chrome.idle) {
            try {
                chrome.idle.setDetectionInterval(15);
                this.idleListener = (state) => {
                    if (state === 'idle') {
                        ;
                        this.triggerIdleIndexing();
                    }
                };
                chrome.idle.onStateChanged.addListener(this.idleListener);
                ;
            } catch (e) {
                console.error('[SearchIndexManager] Failed to bind chrome.idle:', e);
                this.setupFallbackIdleTimer();
            }
        } else {
            this.setupFallbackIdleTimer();
        }
    },

    setupFallbackIdleTimer() {
        if (this.checkTimer) clearInterval(this.checkTimer);
        this.lastActivityTime = Date.now();
        
        this.recordActivity = () => { this.lastActivityTime = Date.now(); };
        window.addEventListener('focus', this.recordActivity, { passive: true });
        document.addEventListener('visibilitychange', this.recordActivity, { passive: true });
        
        this.checkTimer = setInterval(() => {
            const now = Date.now();
            if (this.isDirty && now - this.lastActivityTime > 15000 && document.visibilityState === 'visible') {
                ;
                this.triggerIdleIndexing();
            }
        }, 5000);
        ;
    },

    unbindActivityListeners() {
        if (!this.listenersBound) return;
        this.listenersBound = false;
        
        if (typeof chrome !== 'undefined' && chrome && chrome.idle && this.idleListener) {
            try {
                chrome.idle.onStateChanged.removeListener(this.idleListener);
            } catch (_) {}
            this.idleListener = null;
        }
        
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        
        if (this.recordActivity) {
            window.removeEventListener('focus', this.recordActivity);
            document.removeEventListener('visibilitychange', this.recordActivity);
            this.recordActivity = null;
        }
        ;
    },

    normalizeDirtyKeys(keys) {
        return Array.from(new Set((Array.isArray(keys) ? keys : [])
            .map(key => String(key || '').trim())
            .filter(Boolean)));
    },

    getDirtyStateApi() {
        return (typeof window !== 'undefined' &&
            window.SearchIndexDb &&
            typeof window.SearchIndexDb.getDirtyState === 'function')
            ? window.SearchIndexDb
            : null;
    },

    getLocalDirtyState() {
        return {
            dirty: this.isDirty || this.needsFullUpdate || this.dirtyKeys.size > 0,
            needsFullUpdate: this.needsFullUpdate,
            dirtyKeys: Array.from(this.dirtyKeys),
            dirtyKeyVersions: Object.assign({}, this.dirtyKeyVersions),
            revision: this.dirtyRevision,
            fullRevision: this.fullDirtyRevision
        };
    },

    applyDirtyState(state) {
        const safeState = state && typeof state === 'object' ? state : {};
        const sourceKeys = this.normalizeDirtyKeys([
            ...(Array.isArray(safeState.dirtyKeys) ? safeState.dirtyKeys : []),
            ...Object.keys(safeState.dirtyKeyVersions || {})
        ]);
        const versions = {};
        const rawVersions = safeState.dirtyKeyVersions && typeof safeState.dirtyKeyVersions === 'object'
            ? safeState.dirtyKeyVersions
            : {};
        const fallbackRevision = Number.isFinite(Number(safeState.revision)) ? Number(safeState.revision) : 0;

        sourceKeys.forEach(key => {
            const keyRevision = Number(rawVersions[key]);
            versions[key] = Number.isFinite(keyRevision) && keyRevision > 0
                ? Math.floor(keyRevision)
                : fallbackRevision;
        });

        const maxKeyRevision = sourceKeys.reduce((max, key) => {
            return Math.max(max, Number(versions[key]) || 0);
        }, 0);
        const fullRevision = Number(safeState.fullRevision);
        const normalizedFullRevision = Number.isFinite(fullRevision) && fullRevision > 0 ? Math.floor(fullRevision) : 0;
        const normalizedRevision = Math.max(fallbackRevision, maxKeyRevision, normalizedFullRevision);

        this.dirtyKeys = new Set(sourceKeys);
        this.dirtyKeyVersions = versions;
        this.needsFullUpdate = safeState.needsFullUpdate === true;
        this.isDirty = safeState.dirty === true || this.needsFullUpdate || this.dirtyKeys.size > 0;
        this.dirtyRevision = normalizedRevision;
        this.fullDirtyRevision = normalizedFullRevision;
    },

    notifyDirtyStateChanged(state = null) {
        if (!(typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local)) {
            return Promise.resolve();
        }
        const dirtyState = state || this.getLocalDirtyState();
        const payload = {
            canvas_search_index_dirty: dirtyState.dirty === true,
            canvas_search_index_needs_full: dirtyState.needsFullUpdate === true,
            canvas_search_index_dirty_revision: Number(dirtyState.revision) || 0,
            canvas_search_index_dirty_keys: []
        };
        this.dirtyStateNotifyChain = this.dirtyStateNotifyChain.then(
            () => chrome.storage.local.set(payload),
            () => chrome.storage.local.set(payload)
        );
        return this.dirtyStateNotifyChain.catch(err => {
            console.error('[SearchIndexManager] Failed to publish dirty state notification:', err);
        });
    },

    async markDirty(options = {}) {
        const keys = this.normalizeDirtyKeys(options.keys);
        const localRevision = this.dirtyRevision + 1;
        this.isDirty = true;
        this.dirtyRevision = localRevision;
        if (options.full) {
            this.needsFullUpdate = true;
            this.fullDirtyRevision = localRevision;
        }
        keys.forEach(k => {
            this.dirtyKeys.add(k);
            this.dirtyKeyVersions[k] = localRevision;
        });

        const run = async () => {
            const api = this.getDirtyStateApi();
            if (api && typeof api.markDirtyState === 'function') {
                const state = await api.markDirtyState({
                    full: options.full === true,
                    keys
                });
                this.applyDirtyState(state);
                await this.notifyDirtyStateChanged(state);
            } else {
                await this.notifyDirtyStateChanged(this.getLocalDirtyState());
            }
        };

        this.dirtyStateWriteChain = this.dirtyStateWriteChain.then(run, run).catch(async (err) => {
            console.error('[SearchIndexManager] Failed to persist dirty state in IndexedDB:', err);
            await this.notifyDirtyStateChanged(this.getLocalDirtyState());
        });
        await this.dirtyStateWriteChain;
    },

    async refreshDirtyStateFromStorage() {
        await this.dirtyStateWriteChain.catch(() => {});
        const api = this.getDirtyStateApi();
        if (api && typeof api.getDirtyState === 'function') {
            const state = await api.getDirtyState();
            this.applyDirtyState(state);
            return state;
        }

        if (!(typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local)) {
            return this.getLocalDirtyState();
        }

        const data = await chrome.storage.local.get([
            'canvas_search_index_dirty',
            'canvas_search_index_needs_full'
        ]);
        this.applyDirtyState({
            dirty: data['canvas_search_index_dirty'] === true,
            needsFullUpdate: data['canvas_search_index_needs_full'] === true,
            dirtyKeys: [],
            dirtyKeyVersions: {},
            revision: this.dirtyRevision,
            fullRevision: this.fullDirtyRevision
        });
        return this.getLocalDirtyState();
    },

    snapshotDirtyState() {
        this.processingKeys = new Set(this.dirtyKeys);
        this.processingKeyVersions = {};
        this.processingKeys.forEach(key => {
            const revision = Number(this.dirtyKeyVersions[key]) || this.dirtyRevision;
            if (revision > 0) {
                this.processingKeyVersions[key] = revision;
            }
        });
        this.processingFullUpdate = this.needsFullUpdate;
        this.processingFullRevision = this.needsFullUpdate
            ? (Number(this.fullDirtyRevision) || Number(this.dirtyRevision) || 0)
            : 0;
        this.processingBaseSignature = null;
    },

    async clearProcessedDirtyState() {
        const processedKeys = this.processingKeys ? Array.from(this.processingKeys) : [];
        const processedKeyVersions = Object.assign({}, this.processingKeyVersions || {});
        const processedFull = this.processingFullUpdate === true;
        const processedFullRevision = this.processingFullRevision || 0;
        const api = this.getDirtyStateApi();

        if (api && typeof api.clearProcessedDirtyState === 'function') {
            try {
                const state = await api.clearProcessedDirtyState({
                    keys: processedKeys,
                    keyVersions: processedKeyVersions,
                    full: processedFull,
                    fullRevision: processedFullRevision
                });
                this.applyDirtyState(state);
                this.processingKeys = null;
                this.processingKeyVersions = null;
                this.processingFullUpdate = false;
                this.processingFullRevision = 0;
                this.processingBaseSignature = null;
                await this.notifyDirtyStateChanged(state);
                startListeningStorageChanges();
                return;
            } catch (err) {
                console.error('[Search] Failed to clear processed dirty state in IndexedDB:', err);
                throw err;
            }
        }

        if (this.processingKeys) {
            this.processingKeys.forEach(k => {
                this.dirtyKeys.delete(k);
                delete this.dirtyKeyVersions[k];
            });
            this.processingKeys = null;
        }
        this.processingKeyVersions = null;

        const hasRemainingDirty = this.dirtyKeys.size > 0;
        if (!hasRemainingDirty) {
            this.isDirty = false;
            if (this.processingFullUpdate) {
                this.needsFullUpdate = false;
                this.fullDirtyRevision = 0;
            }
        } else {
            this.isDirty = true;
        }
        this.processingFullUpdate = false;
        this.processingFullRevision = 0;
        this.processingBaseSignature = null;

        await this.notifyDirtyStateChanged(this.getLocalDirtyState());
        startListeningStorageChanges();
    },

    async triggerIdleIndexing() {
        try {
            await this.refreshDirtyStateFromStorage();
        } catch (err) {
            console.warn('[SearchIndexManager] Failed to refresh dirty state before idle indexing:', err);
        }
        if (!this.isDirty) return;
        if (this.isIndexing) return;
        if (!isCanvasSearchStateReady()) {
            ;
            await waitForCanvasSearchStateReady();
            if (this.isIndexing) return;
            try {
                await this.refreshDirtyStateFromStorage();
            } catch (err) {
                console.warn('[SearchIndexManager] Failed to refresh dirty state after canvas ready:', err);
            }
            if (!this.isDirty) return;
        }
        this.isIndexing = true;
        this.snapshotDirtyState();
        
        // Before rebuilding, check if another tab/end already wrote a fresh IndexedDB index.
        try {
            const liveSig = getCanvasSearchSignature();
            if (window.SearchIndexDb && !shouldBypassFreshIndexShortcutForProcessingDirty() && await window.SearchIndexDb.hasFreshIndex(liveSig)) {
                ;
                await this.clearProcessedDirtyState();

                if (typeof ensureIndexForModeLoaded === 'function') {
                    const activeMode = (typeof searchUiState !== 'undefined' && searchUiState && searchUiState.activeMode) || 'bookmark';
                    ensureIndexForModeLoaded(activeMode).catch(err => {
                        console.error('[SearchIndexManager] Failed to preload updated index on skip:', err);
                    });
                }

                this.isIndexing = false;
                return;
            }
        } catch (err) {
            console.error('[SearchIndexManager] Failed to check IndexedDB before idle indexing:', err);
        }
        
        ;
        
        const runTask = () => {
            return new Promise((resolve, reject) => {
                const checkFull = () => {
                    return this.processingFullUpdate || this.needsFullUpdate;
                };

                if (typeof window.requestIdleCallback === 'function') {
                    window.requestIdleCallback(async (deadline) => {
                        try {
                            if (checkFull()) {
                                buildCanvasSearchDbSync();
                            } else {
                                await buildCanvasSearchDbIncrementallyInMemory();
                            }
                            await saveMemoryIndexToIndexedDb();
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    }, { timeout: 2000 });
                } else {
                    (async () => {
                        try {
                            if (checkFull()) {
                                buildCanvasSearchDbSync();
                            } else {
                                await buildCanvasSearchDbIncrementallyInMemory();
                            }
                            await saveMemoryIndexToIndexedDb();
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    })();
                }
            });
        };

        try {
            await runTask();
        } catch (err) {
            console.error('[SearchIndexManager] Idle indexing failed:', err);
        } finally {
            this.isIndexing = false;
        }
    },

    async init() {
        if (!isCanvasSearchStateReady()) {
            if (!this.initDeferred) {
                this.initDeferred = true;
                waitForCanvasSearchStateReady().then(() => {
                    this.initDeferred = false;
                    return this.init();
                }).catch(() => {
                    this.initDeferred = false;
                });
            }
            return;
        }
        try {
            let hasIndex = false;
            try {
                const liveSig = getCanvasSearchSignature();
                hasIndex = !!(window.SearchIndexDb && await window.SearchIndexDb.hasFreshIndex(liveSig));
                if (window.SearchIndexDb && typeof window.SearchIndexDb.clearLegacyChromeStorageIndex === 'function') {
                    window.SearchIndexDb.clearLegacyChromeStorageIndex().catch(() => {});
                }
            } catch (_) {}

            await this.refreshDirtyStateFromStorage();
            if (!hasIndex && !this.isDirty) {
                await this.markDirty({ full: true });
            }

            this.bindActivityListeners();

            if (this.isDirty && this.needsFullUpdate) {
                stopListeningStorageChanges();
            } else {
                startListeningStorageChanges();
            }
        } catch (err) {
            console.error('[SearchIndexManager] Failed to initialize dirty state:', err);
            startListeningStorageChanges();
        }
    }
};

function handleSearchStorageChange(changes, areaName) {
    if (areaName !== 'local') return;
    
    // chrome.storage is only a cross-tab notification surface. The dirty set lives in IndexedDB.
    if (changes['canvas_search_index_dirty'] !== undefined ||
        changes['canvas_search_index_needs_full'] !== undefined ||
        changes['canvas_search_index_dirty_revision'] !== undefined) {
        SearchIndexManager.refreshDirtyStateFromStorage().then(() => {
            if (!SearchIndexManager.isDirty && typeof ensureIndexForModeLoaded === 'function') {
                const activeMode = (typeof searchUiState !== 'undefined' && searchUiState && searchUiState.activeMode) || 'bookmark';
                ensureIndexForModeLoaded(activeMode).catch(err => {
                    console.error('[Search] Failed to preload updated index in background:', err);
                });
            }
        }).catch(err => {
            console.error('[Search] Failed to sync dirty state from IndexedDB notification:', err);
        });
        return;
    }
    
    const activeCanvasState = getActiveCanvasState();
    if (activeCanvasState && activeCanvasState.dragState && activeCanvasState.dragState.isDragging) {
        return;
    }
    
    if (SearchIndexManager.isDirty && SearchIndexManager.needsFullUpdate) {
        stopListeningStorageChanges();
        return;
    }
    
    // Note: 'bcs:canvas' (containing MD nodes and edges) is intentionally excluded here to avoid
    // unnecessary background re-indexing storms during frequent canvas edits.
    // Instead, signature comparison (via getCanvasSearchSignature) is used to detect canvas changes
    // dynamically when the user actually initiates search, keeping background tabs highly performant.
    const changedKeys = Object.keys(changes).filter(key => 
        key.startsWith('bcs:section:') || 
        key.startsWith('bcs:perm:') || 
        key === 'cachedCurrentTree'
    );
    if (changedKeys.length === 0) return;
    
    SearchIndexManager.markDirty({ full: false, keys: changedKeys });

    if (SearchIndexManager.needsFullUpdate) {
        stopListeningStorageChanges();
    }
}

startListeningStorageChanges();

function normalizeSearchIndexOwnerKey(key) {
    const normalized = String(key || '').trim();
    if (normalized === 'cachedCurrentTree') return 'bcs:perm:main';
    return normalized || 'bcs:canvas';
}

function getSearchIndexOwnerKeyForItem(item) {
    if (!item || typeof item !== 'object') return 'bcs:canvas';
    if (item.ownerKey) return normalizeSearchIndexOwnerKey(item.ownerKey);

    if (item.type === 'bookmark-item') {
        if (item.source === 'temporary' && item.sectionId) {
            return `bcs:section:${String(item.sectionId)}`;
        }
        if (item.source === 'permanent') {
            return 'bcs:perm:main';
        }
    }

    if (item.type === 'temp-section' && item.id) {
        return `bcs:section:${String(item.id)}`;
    }
    if (item.type === 'permanent-section') {
        if (item.copyId) return `bcs:perm:copy-${String(item.copyId)}`;
        return 'bcs:perm:main';
    }
    if (item.copyId) return `bcs:perm:copy-${String(item.copyId)}`;
    if (item.sectionId) return `bcs:section:${String(item.sectionId)}`;
    return 'bcs:canvas';
}

function markCanvasSearchBookmarkNoteDirty(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const keys = new Set();
    list.forEach((target) => {
        if (!target || typeof target !== 'object') return;
        if (target.kind === 'temporary' && target.sectionId) {
            keys.add(`bcs:section:${String(target.sectionId)}`);
        } else if (target.kind === 'permanent' && target.chromeId) {
            keys.add('bcs:perm:main');
        }
    });
    if (!keys.size || !SearchIndexManager || typeof SearchIndexManager.markDirty !== 'function') return Promise.resolve();
    return SearchIndexManager.markDirty({ full: false, keys: Array.from(keys) }).catch((err) => {
        console.error('[Search] Failed to mark note search index dirty:', err);
    });
}

function markCanvasSearchBookmarkTagDirty(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const keys = new Set();
    list.forEach((target) => {
        if (!target || typeof target !== 'object') return;
        if (target.kind === 'temporary' && target.sectionId) {
            keys.add(`bcs:section:${String(target.sectionId)}`);
        } else if (target.kind === 'permanent' && target.chromeId) {
            keys.add('bcs:perm:main');
        }
    });
    if (!keys.size || !SearchIndexManager || typeof SearchIndexManager.markDirty !== 'function') return Promise.resolve();
    return SearchIndexManager.markDirty({ full: false, keys: Array.from(keys) }).catch((err) => {
        console.error('[Search] Failed to mark tag search index dirty:', err);
    });
}

function getSearchIndexOwnerKeysFromDirtyKeys(keys) {
    const source = keys instanceof Set ? Array.from(keys) : (Array.isArray(keys) ? keys : []);
    const ownerKeys = new Set();

    source.forEach((key) => {
        const normalized = normalizeSearchIndexOwnerKey(key);
        if (normalized === 'bcs:canvas' ||
            normalized === 'bcs:perm:main' ||
            normalized.startsWith('bcs:section:') ||
            normalized.startsWith('bcs:perm:copy-')) {
            ownerKeys.add(normalized);
        }
    });

    return ownerKeys;
}

function filterSearchIndexListByOwnerKeys(list, ownerKeys) {
    if (!(ownerKeys instanceof Set) || ownerKeys.size === 0) {
        return Array.isArray(list) ? list : [];
    }
    const filtered = [];
    (Array.isArray(list) ? list : []).forEach((item, order) => {
        if (!ownerKeys.has(getSearchIndexOwnerKeyForItem(item))) return;
        filtered.push({
            __searchIndexRecordItem: item,
            __searchIndexRecordOrder: order
        });
    });
    return filtered;
}

function collectSearchIndexCoordinatesForPersistence(ownerKeys = null) {
    const coordinates = {};
    if (!canvasSearchDb || !canvasSearchDb.itemById) return coordinates;
    const shouldFilter = ownerKeys instanceof Set && ownerKeys.size > 0;

    for (const item of canvasSearchDb.itemById.values()) {
        if (!item || item.id === undefined || item.id === null) continue;
        const ownerKey = getSearchIndexOwnerKeyForItem(item);
        if (shouldFilter && !ownerKeys.has(ownerKey)) continue;
        if (typeof item.x !== 'number' && typeof item.y !== 'number') continue;

        coordinates[String(item.id)] = {
            x: item.x || 0,
            y: item.y || 0,
            w: item.width || item.w || 300,
            h: item.height || item.h || 300,
            color: item.color || null,
            type: item.type || null,
            copyId: item.copyId || null,
            sectionId: item.sectionId || null,
            ownerKey
        };
    }

    return coordinates;
}

function buildSearchIndexPersistencePayload(signature, ownerKeys = null) {
    const shouldFilter = ownerKeys instanceof Set && ownerKeys.size > 0;
    return {
        signature,
        bookmarkIndex: shouldFilter
            ? filterSearchIndexListByOwnerKeys(canvasSearchDb.bookmarkIndex, ownerKeys)
            : (Array.isArray(canvasSearchDb.bookmarkIndex) ? canvasSearchDb.bookmarkIndex : []),
        cardIndex: shouldFilter
            ? filterSearchIndexListByOwnerKeys(canvasSearchDb.structureIndex, ownerKeys)
            : (Array.isArray(canvasSearchDb.structureIndex) ? canvasSearchDb.structureIndex : []),
        descriptionIndex: shouldFilter
            ? filterSearchIndexListByOwnerKeys(canvasSearchDb.descriptionIndex, ownerKeys)
            : (Array.isArray(canvasSearchDb.descriptionIndex) ? canvasSearchDb.descriptionIndex : []),
        coordinates: collectSearchIndexCoordinatesForPersistence(shouldFilter ? ownerKeys : null)
    };
}

function getPendingIncrementalPersistenceOwnerKeys() {
    if (!SearchIndexManager || SearchIndexManager.processingFullUpdate) return null;
    if (!SearchIndexManager.processingKeys || SearchIndexManager.processingKeys.size === 0) return null;
    if (!SearchIndexManager.processingBaseSignature) return null;

    const ownerKeys = getSearchIndexOwnerKeysFromDirtyKeys(SearchIndexManager.processingKeys);
    return ownerKeys.size > 0 ? ownerKeys : null;
}

function shouldBypassFreshIndexShortcutForProcessingDirty() {
    if (!SearchIndexManager || !SearchIndexManager.processingKeys || SearchIndexManager.processingKeys.size === 0) return false;
    return getSearchIndexOwnerKeysFromDirtyKeys(SearchIndexManager.processingKeys).has('bcs:perm:main');
}

async function saveMemoryIndexToIndexedDb() {
    const startTime = performance.now();
    const liveSig = getCanvasSearchSignature();

    if (!window.SearchIndexDb || typeof window.SearchIndexDb.saveSnapshot !== 'function') {
        throw new Error('SearchIndexDb is not available');
    }

    // Check if another tab/end already indexed and wrote it to IndexedDB.
    try {
        if (!shouldBypassFreshIndexShortcutForProcessingDirty() && await window.SearchIndexDb.hasFreshIndex(liveSig)) {
            ;
            await SearchIndexManager.clearProcessedDirtyState();

            // Preload the updated index from IndexedDB to ensure local memory DB is not stale.
            if (typeof ensureIndexForModeLoaded === 'function') {
                const activeMode = (typeof searchUiState !== 'undefined' && searchUiState && searchUiState.activeMode) || 'bookmark';
                ensureIndexForModeLoaded(activeMode).catch(err => {
                    console.error('[Search] Failed to preload updated index on skip write-back:', err);
                });
            }
            return;
        }
    } catch (_) {}

    if (!canvasSearchDb.signature) {
        buildCanvasSearchDbSync();
    }

    try {
        let meta = null;
        let incrementalFallbackReason = '';
        const incrementalOwnerKeys = getPendingIncrementalPersistenceOwnerKeys();
        const canTryIncremental = incrementalOwnerKeys &&
            canvasSearchDb.signature === liveSig &&
            typeof window.SearchIndexDb.saveIncrementalSnapshot === 'function';

        if (canTryIncremental) {
            const patchPayload = buildSearchIndexPersistencePayload(liveSig, incrementalOwnerKeys);
            patchPayload.ownerKeys = Array.from(incrementalOwnerKeys);
            patchPayload.baseSignature = SearchIndexManager.processingBaseSignature;
            meta = await window.SearchIndexDb.saveIncrementalSnapshot(patchPayload);
            if (meta && meta.applied === false) {
                incrementalFallbackReason = meta.reason || '';
                ;
                meta = null;
            }
        }

        if (!meta) {
            if (incrementalFallbackReason === 'base-signature-mismatch' || canvasSearchDb.signature !== liveSig) {
                buildCanvasSearchDbSync();
            }
            const snapshotPayload = buildSearchIndexPersistencePayload(canvasSearchDb.signature || liveSig);
            meta = await window.SearchIndexDb.saveSnapshot(snapshotPayload);
        }

        await SearchIndexManager.clearProcessedDirtyState();
        if (window.SearchIndexDb && typeof window.SearchIndexDb.clearLegacyChromeStorageIndex === 'function') {
            window.SearchIndexDb.clearLegacyChromeStorageIndex().catch(() => {});
        }
        const counts = meta && meta.counts ? meta.counts : {};
        ;
    } catch (err) {
        console.error('[Search] Failed to save search index to IndexedDB. Dirty state retained:', err);
        SearchIndexManager.hasPendingSyncWriteBack = true;
        throw err;
    }
}

async function loadIndexForMode(mode) {
    if (!window.SearchIndexDb || typeof window.SearchIndexDb.loadModeSnapshot !== 'function') {
        return null;
    }

    try {
        const liveSig = getCanvasSearchSignature();
        const normalizedMode = mode === 'tag' ? 'bookmark' : mode;
        const snapshot = await window.SearchIndexDb.loadModeSnapshot(normalizedMode, liveSig);
        if (!snapshot) {
            return null;
        }

        if (canvasSearchDb.signature !== snapshot.signature) {
            canvasSearchDb.signature = snapshot.signature;
            canvasSearchDb.structureIndex = [];
            canvasSearchDb.descriptionIndex = [];
            canvasSearchDb.bookmarkIndex = [];
            canvasSearchDb.itemById = new Map();
            canvasSearchLoadedModes = new Set();
        }

        if (normalizedMode === 'bookmark') {
            canvasSearchDb.bookmarkIndex = snapshot.list;
        } else if (normalizedMode === 'description') {
            canvasSearchDb.descriptionIndex = snapshot.list;
        } else {
            canvasSearchDb.structureIndex = snapshot.list;
        }

        for (const item of snapshot.list) {
            if (item && item.id) {
                canvasSearchDb.itemById.set(item.id, item);
            }
        }

        mergeCoordinatesIntoItemById(canvasSearchDb, snapshot.coordinates);
        markCanvasSearchModeLoaded(normalizedMode);

        return canvasSearchDb;
    } catch (err) {
        console.warn('[Search] Failed to load index for mode from IndexedDB:', err);
        return null;
    }
}

async function loadAllIndexShardsFromIndexedDb(options = {}) {
    if (!window.SearchIndexDb || typeof window.SearchIndexDb.loadAllSnapshot !== 'function') {
        return false;
    }

    try {
        const allowStale = !!(options && options.allowStale === true);
        const liveSig = getCanvasSearchSignature();
        const hasAllMemoryShards = Array.isArray(canvasSearchDb.bookmarkIndex) &&
            Array.isArray(canvasSearchDb.structureIndex) &&
            Array.isArray(canvasSearchDb.descriptionIndex) &&
            canvasSearchLoadedModes.has('bookmark') &&
            canvasSearchLoadedModes.has('structure') &&
            canvasSearchLoadedModes.has('description');

        if (hasAllMemoryShards && (canvasSearchDb.signature === liveSig || (allowStale && canvasSearchDb.signature))) {
            return true;
        }

        const snapshot = allowStale && typeof window.SearchIndexDb.loadLatestSnapshot === 'function'
            ? await window.SearchIndexDb.loadLatestSnapshot()
            : await window.SearchIndexDb.loadAllSnapshot(liveSig);
        if (!snapshot) {
            return false;
        }

        canvasSearchDb.signature = snapshot.signature;
        canvasSearchDb.bookmarkIndex = snapshot.bookmark;
        canvasSearchDb.structureIndex = snapshot.card;
        canvasSearchDb.descriptionIndex = snapshot.description;
        canvasSearchDb.itemById = new Map();

        const rebuildMap = (list) => {
            for (const item of list) {
                if (item && item.id) {
                    canvasSearchDb.itemById.set(item.id, item);
                }
            }
        };
        rebuildMap(canvasSearchDb.bookmarkIndex);
        rebuildMap(canvasSearchDb.structureIndex);
        rebuildMap(canvasSearchDb.descriptionIndex);

        mergeCoordinatesIntoItemById(canvasSearchDb, snapshot.coordinates);
        markAllCanvasSearchModesLoaded();

        return true;
    } catch (err) {
        console.warn('[Search] Failed to load all index shards from IndexedDB:', err);
        return false;
    }
}

function applyIncrementalUpdatesToMemory(dirtyKeys) {
    if (!dirtyKeys || dirtyKeys.size === 0) return;
    
    ;

    // Save old bookmarkSearchOrder values and find max order to avoid duplicates or resetting to 0
    const oldBookmarkOrders = new Map();
    let maxOrder = -1;
    if (Array.isArray(canvasSearchDb.bookmarkIndex)) {
        canvasSearchDb.bookmarkIndex.forEach(item => {
            if (item && item.id && typeof item.bookmarkSearchOrder === 'number') {
                oldBookmarkOrders.set(item.id, item.bookmarkSearchOrder);
                if (item.bookmarkSearchOrder > maxOrder) {
                    maxOrder = item.bookmarkSearchOrder;
                }
            }
        });
    }

    const sliceDb = {
        structureIndex: [],
        descriptionIndex: [],
        bookmarkIndex: [],
        itemById: new Map()
    };
    const sliceCoords = {};
    const isMultiColumnMode = checkCanvasSearchMultiColumnMode();
    const bookmarkOrderRef = { value: 0 };

    let reparseSections = new Set();
    let reparsePermMain = false;
    let reparsePermCopies = new Set();
    let reparseCanvasLayout = false;
    
    dirtyKeys.forEach(key => {
        if (key === 'bcs:canvas') {
            reparseCanvasLayout = true;
        } else if (key === 'bcs:perm:main' || key === 'cachedCurrentTree') {
            reparsePermMain = true;
        } else if (key.startsWith('bcs:perm:copy-')) {
            reparsePermCopies.add(key.substring('bcs:perm:copy-'.length));
        } else if (key.startsWith('bcs:section:')) {
            reparseSections.add(key.substring('bcs:section:'.length));
        }
    });

    const filterOutItems = (predicate) => {
        canvasSearchDb.bookmarkIndex = canvasSearchDb.bookmarkIndex.filter(item => !predicate(item));
        canvasSearchDb.structureIndex = canvasSearchDb.structureIndex.filter(item => !predicate(item));
        canvasSearchDb.descriptionIndex = canvasSearchDb.descriptionIndex.filter(item => !predicate(item));
        for (const [id, item] of canvasSearchDb.itemById.entries()) {
            if (predicate(item)) {
                canvasSearchDb.itemById.delete(id);
            }
        }
    };
    
    const filterPredicates = [];
    
    if (reparseCanvasLayout) {
        filterPredicates.push(item => item.type === 'md-node' || item.type === 'edge' || item.type === 'group');
        parseCanvasLayoutSlice(sliceDb, sliceCoords);
    }
    
    if (reparsePermMain) {
        filterPredicates.push(item => (item.type === 'permanent-section' && item.displayIndex === 1) || (item.source === 'permanent' && !item.copyId));
        parsePermanentSectionSlice(sliceDb, sliceCoords, isMultiColumnMode);
        parsePermanentTreeSlice(sliceDb, bookmarkOrderRef);
    }
    
    reparsePermCopies.forEach(copyId => {
        filterPredicates.push(item => item.copyId === copyId || item.id === copyId);
        const permanentShellSnapshot = collectPermanentViewShellSnapshotForSearch();
        const permanentCopies = getPermanentCopyShellsForSearch(permanentShellSnapshot);
        const idx = permanentCopies.findIndex(c => String(c.copyId) === copyId);
        if (idx >= 0) {
            parsePermanentCopySlice(permanentCopies[idx], idx, sliceDb, sliceCoords, isMultiColumnMode);
        }
    });
    
    reparseSections.forEach(secId => {
        filterPredicates.push(item => item.sectionId === secId || item.id === secId);
        const activeCanvasState = getActiveCanvasState();
        if (activeCanvasState && activeCanvasState.tempSections) {
            const section = activeCanvasState.tempSections.find(s => s && s.id === secId);
            if (section) {
                parseTempSectionSlice(section, sliceDb, sliceCoords, isMultiColumnMode, bookmarkOrderRef);
            }
        }
    });

    if (filterPredicates.length > 0) {
        const combinedPredicate = (item) => filterPredicates.some(p => p(item));
        canvasSearchDb.bookmarkIndex = canvasSearchDb.bookmarkIndex.filter(item => !combinedPredicate(item));
        canvasSearchDb.structureIndex = canvasSearchDb.structureIndex.filter(item => !combinedPredicate(item));
        canvasSearchDb.descriptionIndex = canvasSearchDb.descriptionIndex.filter(item => !combinedPredicate(item));
        for (const [id, item] of canvasSearchDb.itemById.entries()) {
            if (combinedPredicate(item)) {
                canvasSearchDb.itemById.delete(id);
            }
        }
    }

    // Re-calibrate bookmarkSearchOrder values to prevent them from resetting to 0 and colliding
    let nextNewOrder = maxOrder >= 0 ? maxOrder + 1 : 0;
    sliceDb.bookmarkIndex.forEach(item => {
        if (item && item.id) {
            if (oldBookmarkOrders.has(item.id)) {
                item.bookmarkSearchOrder = oldBookmarkOrders.get(item.id);
            } else {
                item.bookmarkSearchOrder = nextNewOrder++;
            }
        }
    });

    mergeCoordinatesIntoItemById(sliceDb, sliceCoords);

    canvasSearchDb.bookmarkIndex.push(...sliceDb.bookmarkIndex);
    canvasSearchDb.structureIndex.push(...sliceDb.structureIndex);
    canvasSearchDb.descriptionIndex.push(...sliceDb.descriptionIndex);
    for (const [id, item] of sliceDb.itemById.entries()) {
        canvasSearchDb.itemById.set(id, item);
    }
}

function detectDirtyKeysFromLiveState() {
    const detected = new Set();
    const activeCanvasState = getActiveCanvasState();
    if (!activeCanvasState || !canvasSearchDb.itemById) return detected;
    
    // Calculate live standard MD cards and labeled card groups
    let liveMdCount = 0;
    if (Array.isArray(activeCanvasState.mdNodes)) {
        for (const node of activeCanvasState.mdNodes) {
            if (!node) continue;
            if (node.subtype === 'card-group') {
                if (String(node.label || '').trim()) {
                    liveMdCount++; // Only count labeled card-groups as they are indexed
                }
            } else {
                liveMdCount++;
            }
        }
    }

    // Calculate live labeled edges
    let liveEdgeCount = 0;
    if (Array.isArray(activeCanvasState.edges)) {
        for (const edge of activeCanvasState.edges) {
            if (edge && edge.label) {
                liveEdgeCount++; // Only count labeled edges as unlabeled ones are skipped in index
            }
        }
    }
    
    let cachedMdCount = 0;
    let cachedEdgeCount = 0;
    for (const item of canvasSearchDb.itemById.values()) {
        if (item && (item.type === 'md-node' || item.type === 'group')) cachedMdCount++;
        if (item && item.type === 'edge') cachedEdgeCount++;
    }
    
    if (liveMdCount !== cachedMdCount || liveEdgeCount !== cachedEdgeCount) {
        detected.add('bcs:canvas');
    } else {
        for (const node of (activeCanvasState.mdNodes || [])) {
            if (!node || !node.id) continue;
            if (node.subtype === 'card-group' && !String(node.label || '').trim()) continue;
            
            const cached = canvasSearchDb.itemById.get(node.id);
            if (!cached) {
                detected.add('bcs:canvas');
                break;
            }
            if (node.subtype === 'card-group') {
                const liveTitle = String(node.label || '').trim();
                if (cached.title !== liveTitle ||
                    cached.label !== liveTitle ||
                    normalizeCanvasSearchString(cached.color) !== normalizeCanvasSearchString(getCanvasSearchNodeColor(node, '#475569'))) {
                    detected.add('bcs:canvas');
                    break;
                }
            } else {
                const liveSubtype = node.subtype || '';
                if (cached.title !== (node.title || '') ||
                    cached.text !== (node.text || '') ||
                    normalizeCanvasSearchString(cached.subtype) !== normalizeCanvasSearchString(liveSubtype) ||
                    normalizeCanvasSearchString(cached.color) !== normalizeCanvasSearchString(getCanvasSearchNodeColor(node, '#2563eb'))) {
                    detected.add('bcs:canvas');
                    break;
                }
            }
        }

        if (!detected.has('bcs:canvas')) {
            for (const edge of (activeCanvasState.edges || [])) {
                if (!edge || !edge.id) continue;
                if (!edge.label) continue;
                const cached = canvasSearchDb.itemById.get(edge.id);
                if (!cached) {
                    detected.add('bcs:canvas');
                    break;
                }
                const liveColor = edge.colorHex || canvasSearchPresetToHex(edge.color) || '#999';
                const liveDirection = edge.direction || 'none';
                if (cached.label !== edge.label ||
                    normalizeCanvasSearchString(cached.color) !== normalizeCanvasSearchString(liveColor) ||
                    normalizeCanvasSearchString(cached.direction || 'none') !== normalizeCanvasSearchString(liveDirection)) {
                    detected.add('bcs:canvas');
                    break;
                }
            }
        }
    }
    
    const liveSections = activeCanvasState.tempSections || [];
    liveSections.forEach(sec => {
        if (!sec || !sec.id) return;
        const cached = canvasSearchDb.itemById.get(sec.id);
        if (!cached) {
            detected.add(`bcs:section:${sec.id}`);
            return;
        }
        
        const liveTitle = sec.title || sec.name || '';
        const liveDesc = (sec.description || '').replace(/<[^>]+>/g, ' ').trim();
        const liveLabel = getTempSectionSearchLabel(sec);
        const liveOriginDisplayIndex = getTempSectionOriginDisplayIndex(sec, liveLabel);
        const liveColor = getTempSectionSearchColor(sec);
        if (cached.title !== liveTitle ||
            cached.description !== liveDesc ||
            normalizeCanvasSearchString(cached.label) !== normalizeCanvasSearchString(liveLabel) ||
            normalizeCanvasSearchString(cached.sequenceNumber) !== normalizeCanvasSearchString(sec.sequenceNumber || null) ||
            normalizeCanvasSearchNumber(cached.originDisplayIndex, 0) !== normalizeCanvasSearchNumber(liveOriginDisplayIndex, 0) ||
            normalizeCanvasSearchString(cached.color) !== normalizeCanvasSearchString(liveColor)) {
            detected.add(`bcs:section:${sec.id}`);
        }
        
        const cachedItems = Array.isArray(canvasSearchDb.bookmarkIndex)
            ? canvasSearchDb.bookmarkIndex.filter(item => item && String(item.sectionId || '') === String(sec.id))
            : [];
        const liveItems = collectTempSectionSearchItemSnapshots(sec);
        if (liveItems.length !== cachedItems.length) {
            detected.add(`bcs:section:${sec.id}`);
        } else {
            for (let i = 0; i < liveItems.length; i += 1) {
                const liveItem = liveItems[i];
                const cachedItem = cachedItems[i];
                if (!cachedItem ||
                    normalizeCanvasSearchString(cachedItem.id) !== normalizeCanvasSearchString(liveItem.id) ||
                    normalizeCanvasSearchString(cachedItem.nodeType) !== normalizeCanvasSearchString(liveItem.nodeType) ||
                    normalizeCanvasSearchString(cachedItem.title) !== normalizeCanvasSearchString(liveItem.title) ||
                    normalizeCanvasSearchString(cachedItem.url) !== normalizeCanvasSearchString(liveItem.url) ||
                    normalizeCanvasSearchString(cachedItem.parentId) !== normalizeCanvasSearchString(liveItem.parentId) ||
                    normalizeCanvasSearchString(cachedItem.namedPath) !== normalizeCanvasSearchString(liveItem.namedPath) ||
                    getInlineTagSearchSignature(cachedItem.tags) !== normalizeCanvasSearchString(liveItem.tags) ||
                    normalizeCanvasSearchString(cachedItem.note) !== normalizeCanvasSearchString(liveItem.note) ||
                    normalizeCanvasSearchString(cachedItem.noteColor || NOTE_COLOR_DEFAULT) !== normalizeCanvasSearchString(liveItem.noteColor || NOTE_COLOR_DEFAULT)) {
                    detected.add(`bcs:section:${sec.id}`);
                    break;
                }
            }
        }
    });

    // Detect deleted temp sections
    for (const item of canvasSearchDb.itemById.values()) {
        if (item && item.type === 'temp-section') {
            const stillExists = liveSections.some(s => s && s.id === item.id);
            if (!stillExists) {
                detected.add(`bcs:section:${item.id}`);
            }
        }
    }
    
    try {
        const livePermDesc = getPermanentDescriptionTextForSearch(null);
        const cachedPerm = canvasSearchDb.itemById.get('permanentSection');
        if (!cachedPerm || (cachedPerm.description || '') !== livePermDesc) {
            detected.add('bcs:perm:main');
        }
    } catch (_) {}
    
    try {
        const liveCopies = getPermanentCopyShellsForSearch();
        liveCopies.forEach(copy => {
            if (!copy || !copy.copyId) return;
            const cachedCopy = canvasSearchDb.itemById.get(copy.copyId);
            if (!cachedCopy) {
                detected.add(`bcs:perm:copy-${copy.copyId}`);
                return;
            }
            const liveCopyDesc = getPermanentDescriptionTextForSearch(copy.copyId);
            if ((cachedCopy.description || '') !== liveCopyDesc) {
                detected.add(`bcs:perm:copy-${copy.copyId}`);
            }
        });

        // Detect deleted permanent copies
        for (const item of canvasSearchDb.itemById.values()) {
            if (item && item.type === 'permanent-section' && item.copyId) {
                const stillExists = liveCopies.some(c => c && String(c.copyId) === item.copyId);
                if (!stillExists) {
                    detected.add(`bcs:perm:copy-${item.copyId}`);
                }
            }
        }
    } catch (_) {}
    
    addDirtyKeysFromSearchSignatureDiff(detected, canvasSearchDb.signature, getCanvasSearchSignature());
    
    return detected;
}

async function buildCanvasSearchDbIncrementallyInMemory() {
    if (!isCanvasSearchStateReady()) {
        await waitForCanvasSearchStateReady();
    }

    const liveSig = getCanvasSearchSignature();
    
    // Bypass incremental updates and do a full sync rebuild if a full rebuild is requested
    if (SearchIndexManager.needsFullUpdate) {
        SearchIndexManager.processingBaseSignature = null;
        buildCanvasSearchDbSync();
        return;
    }
    
    const baseLoaded = await loadAllIndexShardsFromIndexedDb({ allowStale: true });
    if (!baseLoaded) {
        SearchIndexManager.processingBaseSignature = null;
        buildCanvasSearchDbSync();
        return;
    }
    SearchIndexManager.processingBaseSignature = canvasSearchDb.signature || null;
    
    const keysToApply = new Set(SearchIndexManager.processingKeys
        ? Array.from(SearchIndexManager.processingKeys)
        : Array.from(SearchIndexManager.dirtyKeys));
    const extraDirtyKeys = detectDirtyKeysFromLiveState();
    const extraDirtyKeyList = Array.from(extraDirtyKeys);
    if (extraDirtyKeyList.length > 0) {
        try {
            await SearchIndexManager.markDirty({ full: false, keys: extraDirtyKeyList });
        } catch (err) {
            console.warn('[Search] Failed to persist live-detected dirty keys. Keeping them in memory for this pass:', err);
        }
        extraDirtyKeyList.forEach(k => {
            SearchIndexManager.dirtyKeys.add(k);
            keysToApply.add(k);
        });
    }
    
    if (keysToApply.size === 0 && canvasSearchDb.signature !== liveSig) {
        ;
        canvasSearchDb.signature = liveSig;
        return;
    }

    if (keysToApply.size > 0) {
        SearchIndexManager.processingKeys = new Set(keysToApply);
        if (!SearchIndexManager.processingKeyVersions) {
            SearchIndexManager.processingKeyVersions = {};
        }
        keysToApply.forEach(key => {
            if (!SearchIndexManager.processingKeyVersions[key]) {
                const revision = Number(SearchIndexManager.dirtyKeyVersions[key]) || Number(SearchIndexManager.dirtyRevision) || 0;
                if (revision > 0) {
                    SearchIndexManager.processingKeyVersions[key] = revision;
                }
            }
        });
        applyIncrementalUpdatesToMemory(keysToApply);
    }
    
    canvasSearchDb.signature = liveSig;
}

let ensureIndexPromiseChain = Promise.resolve();

async function ensureIndexForModeLoaded(modeKey) {
    const run = async () => {
        if (!isCanvasSearchStateReady()) {
            await waitForCanvasSearchStateReady();
        }

        try {
            await SearchIndexManager.refreshDirtyStateFromStorage();
        } catch (err) {
            console.warn('[Search] Failed to refresh stored dirty state before loading index:', err);
        }

        const liveSig = getCanvasSearchSignature();
        
        // If we are dirty or signatures mismatch, first check if IndexedDB has already been updated.
        if (SearchIndexManager.isDirty || canvasSearchDb.signature !== liveSig) {
            if (SearchIndexManager.isDirty && !SearchIndexManager.processingKeys) {
                SearchIndexManager.snapshotDirtyState();
            }
            const result = await loadIndexForMode(modeKey);
            if (result) {
                // IndexedDB is already up-to-date. Clear only the dirty revisions observed before this check.
                await SearchIndexManager.clearProcessedDirtyState();
                return;
            }
        }
        
        if (SearchIndexManager.isDirty) {
            ;
            SearchIndexManager.snapshotDirtyState();
            await buildCanvasSearchDbIncrementallyInMemory();
            SearchIndexManager.hasPendingSyncWriteBack = true;
            return;
        }

        if (canvasSearchDb.signature === liveSig) {
            const indexList = modeKey === 'bookmark' ? canvasSearchDb.bookmarkIndex :
                              modeKey === 'description' ? canvasSearchDb.descriptionIndex :
                              canvasSearchDb.structureIndex;
            if (Array.isArray(indexList) && indexList.length > 0) {
                return;
            }
        }
        
        const result = await loadIndexForMode(modeKey);
        if (!result) {
            ;
            SearchIndexManager.snapshotDirtyState();
            await buildCanvasSearchDbIncrementallyInMemory();
            SearchIndexManager.hasPendingSyncWriteBack = true;
        }
    };

    ensureIndexPromiseChain = ensureIndexPromiseChain.then(run).catch(err => {
        console.error('[Search] Error in ensureIndexForModeLoaded:', err);
    });
    return ensureIndexPromiseChain;
}

function releaseSearchMemory() {
    canvasSearchDb = {
        signature: null,
        structureIndex: [],
        descriptionIndex: [],
        bookmarkIndex: [],
        itemById: new Map()
    };
    canvasSearchLoadedModes = new Set();
    invalidateCanvasTagSearchCaches();
    invalidateCanvasNoteSearchCaches();
    if (searchUiState) {
        searchUiState.results = [];
        searchUiState.resultSource = [];
        searchUiState.resultAll = [];
    }
    ;
}

let releaseSearchMemoryTimer = null;

function scheduleReleaseSearchMemoryDebounced() {
    if (releaseSearchMemoryTimer) clearTimeout(releaseSearchMemoryTimer);
    releaseSearchMemoryTimer = setTimeout(() => {
        releaseSearchMemoryTimer = null;
        releaseSearchMemory();
    }, 300000); // 5 minutes
}

function cancelReleaseSearchMemory() {
    if (releaseSearchMemoryTimer) {
        clearTimeout(releaseSearchMemoryTimer);
        releaseSearchMemoryTimer = null;
        ;
    }
}

// ==================== Phase 3: 索引构建 ====================

/**
 * 构建画布搜索数据库
 */
function isCanvasSearchMemoryCompleteForSignature(signature) {
    return !!(
        signature &&
        canvasSearchDb.signature === signature &&
        Array.isArray(canvasSearchDb.structureIndex) &&
        Array.isArray(canvasSearchDb.descriptionIndex) &&
        Array.isArray(canvasSearchDb.bookmarkIndex) &&
        canvasSearchLoadedModes.has('structure') &&
        canvasSearchLoadedModes.has('description') &&
        canvasSearchLoadedModes.has('bookmark')
    );
}

function buildCanvasSearchDb() {
    const liveSignature = getCanvasSearchSignature();
    const previousSignature = canvasSearchDb.signature || '';
    if (SearchIndexManager.isDirty) {
        if (
            SearchIndexManager.hasPendingSyncWriteBack &&
            isCanvasSearchMemoryCompleteForSignature(liveSignature)
        ) {
            return canvasSearchDb;
        }

        if (!SearchIndexManager.processingKeys && !SearchIndexManager.processingFullUpdate) {
            SearchIndexManager.snapshotDirtyState();
        }

        const rebuilt = buildCanvasSearchDbSync();
        SearchIndexManager.hasPendingSyncWriteBack = true;
        return rebuilt;
    }

    const signature = canvasSearchDb.signature || liveSignature;
    if (canvasSearchDb.signature === signature) {
        const mode = searchUiState.activeMode;
        const indexList = mode === 'bookmark' ? canvasSearchDb.bookmarkIndex :
                          mode === 'description' ? canvasSearchDb.descriptionIndex :
                          canvasSearchDb.structureIndex;
        if (canvasSearchLoadedModes.has(normalizeCanvasSearchModeKey(mode)) ||
            (Array.isArray(indexList) && indexList.length > 0)) {
            return canvasSearchDb;
        }
    }
    const rebuilt = buildCanvasSearchDbSync();
    if (previousSignature !== rebuilt.signature) {
        SearchIndexManager.hasPendingSyncWriteBack = true;
    }
    return rebuilt;
}

function buildCanvasSearchDbSync() {
    const signature = getCanvasSearchSignature();
    if (isCanvasSearchMemoryCompleteForSignature(signature)) {
        return canvasSearchDb;
    }

    const startTime = performance.now();
    const db = {
        signature,
        structureIndex: [],
        descriptionIndex: [],
        bookmarkIndex: [],
        itemById: new Map()
    };
    const coords = {};
    const isMultiColumnMode = checkCanvasSearchMultiColumnMode();
    const bookmarkOrderRef = { value: 0 };
    const activeCanvasState = getActiveCanvasState();

    for (const section of ((activeCanvasState && activeCanvasState.tempSections) || [])) {
        parseTempSectionSlice(section, db, coords, isMultiColumnMode, bookmarkOrderRef);
    }

    parseCanvasLayoutSlice(db, coords);

    parsePermanentSectionSlice(db, coords, isMultiColumnMode);

    const permanentShellSnapshot = collectPermanentViewShellSnapshotForSearch();
    const permanentCopies = getPermanentCopyShellsForSearch(permanentShellSnapshot);
    if (permanentCopies.length > 0) {
        permanentCopies.forEach((copy, idx) => {
            parsePermanentCopySlice(copy, idx, db, coords, isMultiColumnMode);
        });
    }

    parsePermanentTreeSlice(db, bookmarkOrderRef);

    mergeCoordinatesIntoItemById(db, coords);

    canvasSearchDb = db;
    markAllCanvasSearchModesLoaded();

    const count = db.structureIndex.length + db.descriptionIndex.length + db.bookmarkIndex.length;
    ;
    return canvasSearchDb;
}

// ==================== Phase 3: 特殊语法解析 ====================

/**
 * 解析永久栏目序号查询 (#1, #2, ...)
 * @param {string} query - 搜索关键词
 * @returns {Object|null} - { type: 'main' } 或 { type: 'copy', displayIndex: N }
 */
function parsePermanentSectionQuery(query) {
    const match = query.trim().match(/^#([a-zA-Z0-9]+)$/);
    if (!match) return null;

    const val = match[1];

    // Case 2: #A, #B... (New alpha syntax)
    // A=1, B=2 ...
    const upper = val.toUpperCase();
    // Only allow letters
    if (!/^[A-Z]+$/.test(upper)) return null;

    let index = 0;
    for (let i = 0; i < upper.length; i++) {
        index = index * 26 + (upper.charCodeAt(i) - 64);
    }

    if (index >= 1) return { type: index === 1 ? 'main' : 'copy', displayIndex: index };

    return null;
}

/**
 * 检测是否为群组搜索查询 (A-, 工作-, ...)
 * @param {string} query - 搜索关键词
 * @returns {boolean}
 */
function isGroupSearchQuery(query) {
    // 格式：字母/汉字 + 横杠（末尾）
    return /^[\w\u4e00-\u9fa5]+-$/.test(query.trim());
}

/**
 * 匹配群组前缀
 * @param {string} title - 卡片标题
 * @param {string} prefix - 群组前缀（如 "A-"）
 * @returns {boolean}
 */
function matchGroupPrefix(title, prefix) {
    const t = (title || '').toLowerCase();
    const p = prefix.toLowerCase().replace(/-$/, '');
    // 匹配 "A" 或 "A-xxx"
    return t === p || t.startsWith(p + '-');
}

// ==================== Phase 3: 搜索匹配与评分 ====================

/**
 * 生成搜索结果高亮摘要
 * @param {string} text - 原始文本
 * @param {string} query - 搜索关键词
 * @returns {string} - 带 <mark> 的 HTML 摘要
 */
function generateSearchSnippet(text, query) {
    if (!text || !query) return '';
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // 查找第一个匹配位置
    const idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return '';

    const SNIPPET_LEN = 60; // 摘要总长度
    const HALF_LEN = Math.floor(SNIPPET_LEN / 2);

    // 计算截取范围
    let start = Math.max(0, idx - 10); // 匹配处往前留一点上下文
    let end = Math.min(text.length, idx + query.length + 40); // 往后多留一点

    // 如果截取太长，进行修剪
    if (end - start > SNIPPET_LEN) {
        end = Math.min(text.length, start + SNIPPET_LEN);
    }

    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';

    const rawSnippet = text.substring(start, end);

    // 在截取的片段中进行正则替换高亮（保留原大小写）
    // 简单转义正则特殊字符
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlightRe = new RegExp(`(${escapedQuery})`, 'gi');

    const highlightedSnippet = escapeHtml(rawSnippet).replace(highlightRe, '<mark>$1</mark>');

    return `${prefix}${highlightedSnippet}${suffix}`;
}

function createCanvasSearchQueryContext(query, mode = '') {
    const rawQuery = String(query || '').trim();
    const lowerQuery = rawQuery.toLowerCase();
    const tokens = lowerQuery.split(/\s+/)
        .map(token => String(token || '').trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    const isBookmarkMode = mode === 'bookmark' || mode === 'tag';
    const permanentQuery = !isBookmarkMode ? parsePermanentSectionQuery(rawQuery) : null;
    const isGroupSearch = !isBookmarkMode && isGroupSearchQuery(rawQuery);

    return {
        rawQuery,
        lowerQuery,
        tokens,
        isSingleChar: lowerQuery.length === 1,
        isBookmarkMode,
        permanentQuery,
        isPermanentQuery: permanentQuery !== null,
        isGroupSearch,
        groupPrefix: isGroupSearch ? lowerQuery.replace(/-$/, '') : ''
    };
}

function getCanvasSearchQueryContext(query, options = {}) {
    if (options && options.queryContext) return options.queryContext;
    const mode = options && options.mode ? String(options.mode) :
        ((typeof searchUiState !== 'undefined' && searchUiState && searchUiState.activeMode) || '');
    return createCanvasSearchQueryContext(query, mode);
}

function shouldSkipCanvasSearchCandidateForQuery(item, mode, queryContext) {
    if (!item || !queryContext) return true;
    if (mode !== 'structure') return false;

    if (queryContext.isPermanentQuery) {
        return item.type !== 'permanent-section';
    }
    if (queryContext.isGroupSearch) {
        return item.type !== 'temp-section' || !item.__label;
    }
    return false;
}

/**
 * 计算画布搜索项的匹配分数
 * @param {Object} item - 索引项
 * @param {string} query - 搜索关键词（小写）
 * @param {Object} options - 选项
 * @returns {number} - 匹配分数（-Infinity 表示不匹配）
 */
function scoreCanvasSearchItem(item, query, options = {}) {
    let score = 0;
    const queryContext = getCanvasSearchQueryContext(query, options);
    const q = queryContext.lowerQuery;

    // 0. Mode-specific scoring check (Optional, as we partition indices now)
    // But helpful for mixed logic if any.

    // 1. 特殊语法：#N 序号定位 (Only for Permanent)
    if (item.type === 'permanent-section') {
        const sectionQuery = queryContext.permanentQuery;
        if (sectionQuery) {
            if (sectionQuery.displayIndex === item.displayIndex) {
                return 300; // 精确匹配
            }
        }
    }

    // 2. 群组搜索（如 A- 或 A-1）- 只搜索临时栏目
    if (queryContext.isGroupSearch || options.isGroupSearch) {
        // 群组搜索只适用于有 label 的临时栏目
        if (item.type === 'temp-section' && item.__label) {
            // 匹配 label 字段（如搜索 "A-" 匹配 "A-1", "A-2" 等）
            const prefix = queryContext.groupPrefix || q.replace(/-$/, '');
            if (item.__label === prefix || item.__label.startsWith(prefix + '-')) {
                return 250;
            }
        }
        return -Infinity;
    }

    // 3. 普通文本匹配
    // [Optim] Single letter query: strict prefix matching only to avoid noise (e.g. searching 'A' finding 'B-1' via 'a' in date/text)
    const isSingleChar = queryContext.isSingleChar;

    // Description Mode Multi-word AND Match
    if (searchUiState.activeMode === 'description') {
        const tokens = queryContext.tokens;
        if (!tokens.length) return -Infinity;
        let totalScore = 0;

        for (const t of tokens) {
            let tokenScore = 0;
            if (item.type === 'temp-section') {
                if (item.__description && item.__description.includes(t)) {
                    tokenScore = Math.max(tokenScore, 80);
                }
            } else if (item.type === 'permanent-section') {
                if (item.__description && item.__description.includes(t)) {
                    tokenScore = Math.max(tokenScore, 70);
                }
            } else if (item.type === 'md-node') {
                if (item.__title) {
                    if (item.__title.startsWith(t)) {
                        tokenScore = Math.max(tokenScore, 150);
                    } else if (item.__title.includes(t)) {
                        tokenScore = Math.max(tokenScore, 120);
                    }
                }
                if (item.__text && item.__text.includes(t)) {
                    tokenScore = Math.max(tokenScore, 90);
                }
            } else if (item.type === 'edge') {
                if (item.__label) {
                    if (item.__label.startsWith(t)) {
                        tokenScore = Math.max(tokenScore, 140);
                    } else if (item.__label.includes(t)) {
                        tokenScore = Math.max(tokenScore, 110);
                    }
                }
            }
            if (tokenScore === 0) return -Infinity;
            totalScore += tokenScore;
        }
        return totalScore;
    }

    const checkMatch = (text, scoreValPrefix, scoreValContains) => {
        if (!text) return -Infinity;
        const low = text.toLowerCase(); // Assuming text is already normalized if intended, but safe to re-lower or assume passed args are checked
        // Note: In existing logic below, we check item.__label etc which are already lowercase.
        // We will adapt the logic to use the specific fields.
        return -Infinity;
    };

    switch (item.type) {
        case 'temp-section':
            // 标签匹配（如 A-1, A-1-1）- 最高优先级
            if (item.__label) {
                if (item.__label.startsWith(q)) score = Math.max(score, 160);
                else if (!isSingleChar && item.__label.includes(q)) score = Math.max(score, 130);
            }
            // 标题匹配
            if (item.__title) {
                if (item.__title.startsWith(q)) score = Math.max(score, 150);
                else if (!isSingleChar && item.__title.includes(q)) score = Math.max(score, 120);
            }
            // 说明匹配
            if (item.__description && !isSingleChar && item.__description.includes(q)) score = Math.max(score, 80);
            break;

        case 'md-node':
            // 标题匹配
            if (item.__title) {
                if (item.__title.startsWith(q)) score = Math.max(score, 150);
                else if (!isSingleChar && item.__title.includes(q)) score = Math.max(score, 120);
            }
            // 文本内容匹配
            if (item.__text && !isSingleChar && item.__text.includes(q)) score = Math.max(score, 90);
            break;

        case 'edge':
            // 标签匹配
            if (item.__label) {
                if (item.__label.startsWith(q)) score = Math.max(score, 140);
                else if (!isSingleChar && item.__label.includes(q)) score = Math.max(score, 110);
            }
            break;

        case 'permanent-section':
            // 标题匹配
            if (item.__title) {
                if (item.__title.startsWith(q)) score = Math.max(score, 130);
                else if (!isSingleChar && item.__title.includes(q)) score = Math.max(score, 130);
            }
            // 说明匹配 (Only if in Description Mode or index contains it)
            if (item.__description && !isSingleChar && item.__description.includes(q)) score = Math.max(score, 70);
            break;

        case 'group':
            // 卡片组：按 label/title 命中（#7）
            if (item.__title) {
                if (item.__title.startsWith(q)) score = Math.max(score, 140);
                else if (!isSingleChar && item.__title.includes(q)) score = Math.max(score, 115);
            }
            if (item.__label) {
                if (item.__label.startsWith(q)) score = Math.max(score, 140);
                else if (!isSingleChar && item.__label.includes(q)) score = Math.max(score, 115);
            }
            break;

        case 'bookmark-item': {
            // 书签/文件夹匹配（支持多关键词，以空格分隔）；
            // 普通关键词只匹配标题、URL、路径；#... 专门匹配标签，*... 专门匹配笔记。
            if (queryContext.isBookmarkMode && isCanvasNoteSearchQuery(q)) {
                return doesCanvasBookmarkItemNoteMatchQuery(item, q) ? 132 : -Infinity;
            }

            const tokens = queryContext.tokens;
            if (!tokens.length) return -Infinity;

            let tokenScoreSum = 0;
            for (const t of tokens) {
                const isSingleToken = t.length === 1;
                const isTagToken = t.startsWith('#');
                let tokenScore = 0;

                if (!isTagToken && item.__title) {
                    if (item.__title.startsWith(t)) tokenScore = Math.max(tokenScore, 140);
                    else if (item.__title.includes(t)) tokenScore = Math.max(tokenScore, 110);
                }
                if (!isTagToken && item.__url && !isSingleToken && item.__url.includes(t)) tokenScore = Math.max(tokenScore, 90);
                if (!isTagToken && item.__path) {
                    if (item.__path.startsWith(t)) tokenScore = Math.max(tokenScore, 105);
                    else if (!isSingleToken && item.__path.includes(t)) tokenScore = Math.max(tokenScore, 95);
                }
                if (isTagToken && doesCanvasBookmarkItemTagsMatchQuery(item, t)) {
                    tokenScore = Math.max(tokenScore, 135);
                }

                if (tokenScore === 0) return -Infinity;
                tokenScoreSum += tokenScore;
            }

            score = Math.max(score, tokenScoreSum);
            break;
        }
    }

    if (score === 0) return -Infinity;
    return score;
}

function getCanvasBookmarkSearchOrderValue(item) {
    const raw = Number(item && item.bookmarkSearchOrder);
    return Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;
}

function compareCanvasBookmarkSearchItems(leftItem, rightItem, scope = null) {
    const left = leftItem || null;
    const right = rightItem || null;
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;

    const scopeDelta = getCanvasScopePriorityForItem(right, scope) - getCanvasScopePriorityForItem(left, scope);
    if (scopeDelta !== 0) return scopeDelta;

    const leftOrder = getCanvasBookmarkSearchOrderValue(left);
    const rightOrder = getCanvasBookmarkSearchOrderValue(right);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const titleDelta = String(left.title || '').localeCompare(String(right.title || ''));
    if (titleDelta !== 0) return titleDelta;

    return String(left.url || '').localeCompare(String(right.url || ''));
}

function compareCanvasBookmarkScoredPairs(leftPair, rightPair, scope = null) {
    const leftRaw = Number(leftPair && leftPair.rawScore);
    const rightRaw = Number(rightPair && rightPair.rawScore);
    if (Number.isFinite(rightRaw) && Number.isFinite(leftRaw) && rightRaw !== leftRaw) {
        return rightRaw - leftRaw;
    }

    const leftScore = Number(leftPair && leftPair.s);
    const rightScore = Number(rightPair && rightPair.s);
    if (Number.isFinite(rightScore) && Number.isFinite(leftScore) && rightScore !== leftScore) {
        return rightScore - leftScore;
    }

    const itemDelta = compareCanvasBookmarkSearchItems(
        leftPair && leftPair.item ? leftPair.item : null,
        rightPair && rightPair.item ? rightPair.item : null,
        scope
    );
    if (itemDelta !== 0) return itemDelta;

    return 0;
}

function getBookmarkItemParentPathForSearch(item) {
    const fullPath = String(item && item.namedPath || '').trim();
    if (!fullPath) return '';

    const title = String(item && item.title || '').trim();
    const parts = fullPath.split('>').map((part) => String(part || '').trim()).filter(Boolean);
    if (!parts.length) return '';

    if (title) {
        const last = String(parts[parts.length - 1] || '').trim();
        if (last && last.toLowerCase() === title.toLowerCase()) {
            parts.pop();
        }
    } else {
        parts.pop();
    }

    return parts.join(' > ');
}

function getBookmarkItemParentPathForSearchScope(item, scope = null) {
    const parentPath = getBookmarkItemParentPathForSearch(item);
    if (!parentPath) return '';

    if (item && item.source === 'temporary') {
        const parts = parentPath.split('>').map((part) => String(part || '').trim()).filter(Boolean);
        if (!parts.length) return '';

        const sectionLabel = String(item.sectionLabel || '').trim();
        const sectionTitle = String(item.sectionTitle || '').trim();
        const sectionPrefix = [sectionLabel, sectionTitle].filter(Boolean).join(' ').trim();
        const firstPart = String(parts[0] || '').trim().toLowerCase();
        const prefixCandidates = [sectionPrefix, sectionLabel, sectionTitle]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean);

        if (prefixCandidates.includes(firstPart)) {
            return parts.length <= 1 ? '' : parts.slice(1).join(' > ');
        }
    }

    return parentPath;
}

function getCanvasBookmarkLocationKeyForSearch(item) {
    if (!item || typeof item !== 'object') return '';
    return [
        String(item.source || ''),
        String(item.copyId || ''),
        String(item.sectionId || ''),
        String(item.id || ''),
        String(item.namedPath || '')
    ].join('::');
}

function buildCanvasBookmarkGroupModel(scoredPairs, options = {}) {
    const scope = options && typeof options === 'object' ? (options.scope || null) : null;
    const groupsMap = new Map();
    const isZh = currentLang === 'zh_CN';

    // Group by Content: Title + URL
    const getOrCreateGroup = (key, meta) => {
        if (groupsMap.has(key)) return groupsMap.get(key);
        const group = {
            id: key, // unique key based on content
            header: Object.assign({
                id: key,
                type: 'bookmark-group',
                groupType: 'content', // New type for styling
                title: meta.title,
                url: meta.url,
                nodeType: meta.nodeType, // bookmark/folder
                count: 0
            }, meta.extra || {}),
            children: [], // [{ item, s }]
            bestScore: -Infinity
        };
        groupsMap.set(key, group);
        return group;
    };

    for (const pair of scoredPairs) {
        const item = pair ? pair.item : null;
        const s = pair ? pair.s : -Infinity;
        const rawScore = pair ? pair.rawScore : -Infinity;
        if (!item || item.type !== 'bookmark-item') continue;

        // Generate Content Key
        // Bookmarks: Title + URL
        // Folders: Title, matching the history snapshot search grouping behavior.
        let key, title, url, nodeType;
        let extra = null;

        if (item.nodeType === 'folder') {
            title = item.title;
            url = '';
            nodeType = 'folder';
            const parentPath = getBookmarkItemParentPathForSearchScope(item, scope);
            const normalizedTitle = String(title || '').trim().toLowerCase();
            const fallbackId = String(item.id || '').trim().toLowerCase();
            key = normalizedTitle ? `FOLDER::${normalizedTitle}` : `FOLDER::${fallbackId}`;
            extra = { parentPath };
        } else {
            title = item.title;
            url = item.url;
            nodeType = 'bookmark';
            key = `BM::${url}::${title}`; // URL primary, title secondary
        }

        const group = getOrCreateGroup(key, { title, url, nodeType, extra });
        group.children.push({ item, s, rawScore });
        group.bestScore = Math.max(group.bestScore, s);
    }

    const groups = Array.from(groupsMap.values());

    for (const g of groups) {
        g.children.sort((a, b) => compareCanvasBookmarkScoredPairs(a, b, scope));
        g.header.matchesCount = g.children.length;
        g.firstChild = g.children[0] || null;
        g.firstOrder = g.firstChild ? getCanvasBookmarkSearchOrderValue(g.firstChild.item) : Number.POSITIVE_INFINITY;
        const uniqueParentPaths = [];
        const parentPathSet = new Set();
        for (let i = 0; i < g.children.length; i += 1) {
            const child = g.children[i] && g.children[i].item ? g.children[i].item : null;
            const rawPath = getBookmarkItemParentPathForSearchScope(child, scope);
            const key = rawPath ? rawPath.toLowerCase() : '__root__';
            if (parentPathSet.has(key)) continue;
            parentPathSet.add(key);
            uniqueParentPaths.push(rawPath);
        }
        g.header.parentPaths = uniqueParentPaths;
        g.header.parentPath = uniqueParentPaths.length > 0 ? uniqueParentPaths[0] : '';
        g.header.hasMultipleParentPath = uniqueParentPaths.length > 1;
    }

    groups.sort((a, b) => {
        const childDelta = compareCanvasBookmarkScoredPairs(a.firstChild, b.firstChild, scope);
        if (childDelta !== 0) return childDelta;
        return String(a.header.title || '').localeCompare(String(b.header.title || ''));
    });

    return groups;
}

function buildCanvasBookmarkGroupedResultsFromModel(groups) {
    const results = [];
    const isZh = currentLang === 'zh_CN';
    const fullscreenScope = getActiveFullscreenSearchScopeForFiltering();

    const sourceGroups = Array.isArray(groups) ? groups : [];

    for (const g of sourceGroups) {
        if (!g || !g.header) continue;

        const groupId = String(g.id || g.header.id || '');
        if (!groupId) continue;

        // [Phase 3.7 Redesign] Flat Card Layout. 
        // No more "collapsed/expanded" parent-child rows.
        // Instead, we pass the children data directly into the group header item.
        // The render function will use this 'locations' array to draw chips.

        const sortedChildren = Array.isArray(g.children)
            ? g.children.slice().sort((left, right) => compareCanvasBookmarkScoredPairs(left, right, fullscreenScope))
            : [];
        const activePermanentCopyId = fullscreenScope && String(fullscreenScope.kind || '') === 'permanent'
            ? String(fullscreenScope.copyId || '').trim()
            : '';
        const targetItems = sortedChildren.map((c) => {
            const sourceItem = c && c.item ? c.item : null;
            const itemCopy = sourceItem ? Object.assign({}, sourceItem) : null;
            if (itemCopy && itemCopy.source === 'permanent') {
                itemCopy.copyId = activePermanentCopyId || null;
            }
            if (itemCopy) {
                itemCopy.locationKey = getCanvasBookmarkLocationKeyForSearch(itemCopy);
            }
            return itemCopy;
        }).filter(Boolean);

        const locations = sortedChildren.map((c, childIndex) => {
            const item = targetItems[childIndex] || (c ? c.item : null);
            if (!item) return null;
            // Pre-calculate display props for efficiency
            const isPerm = item.source === 'permanent';
            let locationName = '';

            // Calculate Location Badge (Reuse Card Logic)
            let color = item.color || '#2563eb'; // Default

            if (isPerm) {
                // Permanent
                locationName = isZh ? '永久栏目' : 'Permanent Section';
                color = '#059669'; // Fixed Green for Perm
            } else {
                // Temporary
                if (String(item.sectionSource || '').trim() === 'search-result') {
                    locationName = '';
                } else {
                    locationName = item.sectionTitle || (isZh ? '临时栏目' : 'Temp Section');
                }
                // Use section color if available 
                // item.color should already be populated from buildCanvasSearchDb -> section.color
            }
            return {
                id: item.id, // Target ID to jump to
                source: item.source,
                nodeType: item.nodeType,
                sectionId: item.sectionId,
                copyId: item.copyId || null,
                label: item.sectionLabel, // e.g. "A-1"
                title: locationName,
                color: color,
                locationKey: getCanvasBookmarkLocationKeyForSearch(item),
                originalItem: item
            };
        }).filter(Boolean);

        const headerItem = Object.assign({}, g.header, {
            id: groupId,
            type: 'bookmark-group', // Keep type, but render differently
            locations: locations, // [New] Attached locations
            targetItems,
            childItems: targetItems,
            matchesCount: g.children.length
        });
        results.push(headerItem);
    }

    return results;
}

// ==================== Phase 3: 搜索主入口 ====================

// Tag mode helpers (doc §3): resolve an item's tags for search-time matching.
// Permanent items: lookup via cached identityMap exposed by tag_system.js.
// Temporary items: read inline `tags` already embedded in bookmarkIndex entry.
function __getItemTagsForSearch(item) {
    if (!item) return [];
    if (Array.isArray(item.tags) && item.tags.length) return item.tags;
    if (item.source === 'permanent' && typeof window !== 'undefined' && window.TagSystem
        && typeof window.TagSystem.getPermNodeTagsCached === 'function') {
        return window.TagSystem.getPermNodeTagsCached(item.id) || [];
    }
    return [];
}

const TAG_SEARCH_COLOR_ALIASES = {
    red: ['red', '红', '红色'],
    orange: ['orange', '橙', '橙色'],
    yellow: ['yellow', '黄', '黄色'],
    green: ['green', '绿', '绿色'],
    blue: ['blue', '蓝', '蓝色'],
    purple: ['purple', '紫', '紫色'],
    gray: ['gray', 'grey', '灰', '灰色']
};

function __getTagSearchTerms(tag) {
    if (!tag) return [];
    const color = String(tag.color || '').trim().toLowerCase();
    const text = String(tag.text || '').trim().toLowerCase();
    const terms = [];
    if (color) {
        terms.push(color);
        (TAG_SEARCH_COLOR_ALIASES[color] || []).forEach((alias) => terms.push(alias.toLowerCase()));
    }
    if (text) terms.push(text);
    return Array.from(new Set(terms.filter(Boolean)));
}

// Match against a query. Empty query → all items with at least one tag match.
// '#Red'/'#/RED'/'#红色'/'#/红色' → exact color/text/alias match (case-insensitive).
// Plain text → substring match against tag.text and tag.color.
function __tagMatchesQuery(tags, query) {
    if (!tags || !tags.length) return false;
    const q = String(query || '').trim().toLowerCase();
    if (!q) return tags.length > 0;
    if (q.startsWith('#')) {
        const rawTagQuery = q.slice(1);
        const tagQuery = rawTagQuery.startsWith('/') ? rawTagQuery.slice(1) : rawTagQuery;
        if (!tagQuery) return tags.length > 0;
        return tags.some((t) => __getTagSearchTerms(t).some((term) => term === tagQuery));
    }
    return tags.some((t) => {
        return __getTagSearchTerms(t).some((term) => term.includes(q));
    });
}

let canvasTagSearchCacheRevision = 0;
let canvasTagBrowseRootCache = null;
const canvasBookmarkTagSearchStateCache = new WeakMap();

function invalidateCanvasTagSearchCaches() {
    canvasTagSearchCacheRevision += 1;
    canvasTagBrowseRootCache = null;
}

function getCanvasBookmarkTagSearchState(item) {
    if (!item || typeof item !== 'object') {
        return { tags: [], terms: [], exactTerms: new Set() };
    }

    const cached = canvasBookmarkTagSearchStateCache.get(item);
    if (cached && cached.revision === canvasTagSearchCacheRevision) return cached;

    const tags = normalizeTagsForPayload(__getItemTagsForSearch(item));
    const exactTerms = new Set();
    const terms = [];
    tags.forEach((tag) => {
        __getTagSearchTerms(tag).forEach((term) => {
            const normalized = String(term || '').trim().toLowerCase();
            if (!normalized || exactTerms.has(normalized)) return;
            exactTerms.add(normalized);
            terms.push(normalized);
        });
    });

    const state = {
        revision: canvasTagSearchCacheRevision,
        tags,
        terms,
        exactTerms
    };
    canvasBookmarkTagSearchStateCache.set(item, state);
    return state;
}

function getCanvasBookmarkTagsForSearchCached(item) {
    return getCanvasBookmarkTagSearchState(item).tags;
}

function doesCanvasBookmarkItemTagsMatchQuery(item, query) {
    const state = getCanvasBookmarkTagSearchState(item);
    const q = String(query || '').trim().toLowerCase();
    if (!q) return state.tags.length > 0;
    if (q.startsWith('#')) {
        const rawTagQuery = q.slice(1);
        const tagQuery = rawTagQuery.startsWith('/') ? rawTagQuery.slice(1) : rawTagQuery;
        if (!tagQuery) return state.tags.length > 0;
        return state.exactTerms.has(tagQuery);
    }
    return state.terms.some((term) => term.includes(q));
}

function __getItemNoteForSearch(item) {
    return __getItemNoteMetaForSearch(item).note;
}

function __getItemNoteMetaForSearch(item) {
    if (!item) return { note: '', color: NOTE_COLOR_DEFAULT };
    const inlineNote = normalizeNoteForSearch(item.note);
    if (inlineNote) {
        return {
            note: inlineNote,
            color: normalizeNoteColorForSearch(item.noteColor)
        };
    }
    if (item.source === 'permanent' && typeof window !== 'undefined' && window.NoteSystem
        && typeof window.NoteSystem.getPermNodeNoteMetaCached === 'function') {
        const meta = window.NoteSystem.getPermNodeNoteMetaCached(item.id) || {};
        return {
            note: normalizeNoteForSearch(meta.note),
            color: normalizeNoteColorForSearch(meta.noteColor || meta.color)
        };
    }
    if (item.source === 'permanent' && typeof window !== 'undefined' && window.NoteSystem
        && typeof window.NoteSystem.getPermNodeNoteCached === 'function') {
        return {
            note: normalizeNoteForSearch(window.NoteSystem.getPermNodeNoteCached(item.id)),
            color: NOTE_COLOR_DEFAULT
        };
    }
    return { note: '', color: NOTE_COLOR_DEFAULT };
}

function normalizeNoteBrowseRootQuery(query) {
    return String(query || '').trim().toLowerCase();
}

function isNoteBrowseRootQuery(query) {
    return NOTE_BROWSER_ROOT_QUERIES.has(normalizeNoteBrowseRootQuery(query));
}

function isCanvasTagSearchQuery(query) {
    const q = String(query || '').trim().toLowerCase();
    return !!q && (q.startsWith('#') || q.startsWith('{#}'));
}

function getCanvasNoteSearchNeedle(query) {
    const raw = String(query || '').trim();
    const lower = raw.toLowerCase();
    if (NOTE_BROWSER_ROOT_QUERIES.has(lower)) return '';
    if (lower.startsWith('*/')) return raw.slice(2).trim().toLowerCase();
    if (lower.startsWith('*')) return raw.slice(1).trim().toLowerCase();
    if (lower.startsWith('{*}')) return raw.slice(3).trim().toLowerCase();
    return null;
}

function isCanvasNoteSearchQuery(query) {
    return getCanvasNoteSearchNeedle(query) !== null;
}

let canvasNoteSearchCacheRevision = 0;
let canvasNoteBrowseRootCache = null;
const canvasBookmarkNoteSearchStateCache = new WeakMap();

function invalidateCanvasNoteSearchCaches() {
    canvasNoteSearchCacheRevision += 1;
    canvasNoteBrowseRootCache = null;
}

function getCanvasBookmarkNoteSearchState(item) {
    if (!item || typeof item !== 'object') {
        return { note: '', lower: '', color: NOTE_COLOR_DEFAULT };
    }

    const cached = canvasBookmarkNoteSearchStateCache.get(item);
    if (cached && cached.revision === canvasNoteSearchCacheRevision) return cached;

    const noteMeta = __getItemNoteMetaForSearch(item);
    const note = normalizeNoteForSearch(noteMeta.note);
    const state = {
        revision: canvasNoteSearchCacheRevision,
        note,
        color: normalizeNoteColorForSearch(noteMeta.color),
        lower: note.toLowerCase()
    };
    canvasBookmarkNoteSearchStateCache.set(item, state);
    return state;
}

function getCanvasBookmarkNoteForSearchCached(item) {
    return getCanvasBookmarkNoteSearchState(item).note;
}

function getCanvasBookmarkNoteMetaForSearchCached(item) {
    const state = getCanvasBookmarkNoteSearchState(item);
    return { note: state.note, color: state.color || NOTE_COLOR_DEFAULT };
}

function doesCanvasBookmarkItemNoteMatchQuery(item, query) {
    const needle = getCanvasNoteSearchNeedle(query);
    if (needle === null) return false;
    const state = getCanvasBookmarkNoteSearchState(item);
    if (!state.note) return false;
    if (!needle) return true;
    return state.lower.includes(needle);
}

function normalizeNoteBrowseColor(rawColor) {
    return normalizeNoteColorForSearch(rawColor);
}

function getNoteBrowseColorLabel(color, isZh) {
    return getTagBrowseColorLabel(normalizeNoteBrowseColor(color), isZh);
}

function getNoteBrowseLabel(note) {
    return String(note || '').replace(/\s+/g, ' ').trim();
}

function getNoteBrowseBucketKey(label, collator = null) {
    const text = String(label || '').trim();
    if (!text) return '#';
    const first = text.charAt(0);
    if (/^[0-9]$/.test(first)) return first; // individual digits 0-9
    if (/^[A-Za-z]$/.test(first)) return first.toUpperCase();

    if (/^[\u4e00-\u9fff]$/.test(first)) {
        const cmp = collator && typeof collator.compare === 'function'
            ? collator
            : getTagBrowseSortCollator(true);
        if (cmp && TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES.length) {
            let bucket = 'A';
            for (let i = 0; i < TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES.length; i += 1) {
                const marker = TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES[i];
                try {
                    if (cmp.compare(first, marker.marker) >= 0) {
                        bucket = marker.letter;
                    } else {
                        break;
                    }
                } catch (_) { }
            }
            if (cmp && cmp.compare(first, TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES[TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES.length - 1].marker) >= 0) {
                return 'Z';
            }
            return bucket;
        }
        return 'A';
    }
    return '#';
}

function buildCanvasNoteBrowseRootModel(sourceIndex, scopeCacheKey = '') {
    const isZh = currentLang === 'zh_CN';
    const list = Array.isArray(sourceIndex) ? sourceIndex : [];
    const cacheKey = [
        canvasSearchDb && canvasSearchDb.signature ? canvasSearchDb.signature : '',
        canvasNoteSearchCacheRevision,
        isZh ? 'zh_CN' : 'en',
        list.length,
        String(scopeCacheKey || 'global')
    ].join('::');
    if (canvasNoteBrowseRootCache && canvasNoteBrowseRootCache.key === cacheKey) {
        return canvasNoteBrowseRootCache.model;
    }

    const colorMap = new Map();
    TAG_BROWSER_COLOR_ORDER.forEach((color) => {
        colorMap.set(color, {
            type: 'note-browser-color',
            color,
            label: getNoteBrowseColorLabel(color, isZh),
            count: 0
        });
    });

    const numberBuckets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const alphabetBuckets = TAG_BROWSER_ALPHA_KEYS;
    const otherBucket = '#';

    const bucketCounts = new Map();
    numberBuckets.forEach(b => bucketCounts.set(b, 0));
    alphabetBuckets.forEach(b => bucketCounts.set(b, 0));
    bucketCounts.set(otherBucket, 0);

    const collator = getTagBrowseSortCollator(isZh);

    list.forEach((item) => {
        if (!item || item.type !== 'bookmark-item') return;
        const itemKey = String(item.locationKey || getCanvasBookmarkLocationKeyForSearch(item) || item.id || '').trim();
        if (!itemKey) return;

        const meta = getCanvasBookmarkNoteMetaForSearchCached(item);
        const note = normalizeNoteForSearch(meta && meta.note);
        if (!note) return;

        const color = normalizeNoteBrowseColor(meta && meta.color);
        const colorEntry = colorMap.get(color);
        if (colorEntry) {
            colorEntry.count += 1;
        }

        const label = getNoteBrowseLabel(note);
        const bucket = getNoteBrowseBucketKey(label, collator);
        if (bucketCounts.has(bucket)) {
            bucketCounts.set(bucket, bucketCounts.get(bucket) + 1);
        } else {
            bucketCounts.set(otherBucket, bucketCounts.get(otherBucket) + 1);
        }
    });

    const colorEntries = TAG_BROWSER_COLOR_ORDER.map((color) => {
        const entry = colorMap.get(color);
        return {
            type: 'note-browser-color',
            color,
            label: entry ? entry.label : getNoteBrowseColorLabel(color, isZh),
            count: entry ? entry.count : 0
        };
    });

    const numberEntries = numberBuckets.map(b => ({
        type: 'note-browser-bucket',
        bucket: b,
        label: b,
        count: bucketCounts.get(b) || 0
    }));

    const alphabetEntries = alphabetBuckets.map(b => ({
        type: 'note-browser-bucket',
        bucket: b,
        label: b,
        count: bucketCounts.get(b) || 0
    }));

    const otherEntries = [{
        type: 'note-browser-bucket',
        bucket: otherBucket,
        label: otherBucket,
        count: bucketCounts.get(otherBucket) || 0
    }];

    const model = { colorEntries, numberEntries, alphabetEntries, otherEntries };
    canvasNoteBrowseRootCache = { key: cacheKey, model };
    return model;
}

function noteMatchesBrowseDetail(item, detail) {
    if (!item || !detail) return false;
    const state = getCanvasBookmarkNoteSearchState(item);
    if (!state.note) return false;
    const color = normalizeNoteBrowseColor(state.color);
    if (detail.kind === 'color') {
        return color === normalizeNoteBrowseColor(detail.color);
    }
    if (detail.kind === 'bucket') {
        const label = getNoteBrowseLabel(state.note);
        const collator = getTagBrowseSortCollator(currentLang === 'zh_CN');
        const itemBucket = getNoteBrowseBucketKey(label, collator);
        return itemBucket === detail.bucket;
    }
    const targetColor = normalizeNoteBrowseColor(detail.color);
    const targetNoteLower = String(detail.noteLower || '').trim().toLowerCase();
    if (!targetNoteLower) return color === targetColor;
    return color === targetColor && state.lower === targetNoteLower;
}

function renderCanvasNoteBrowseRootPanel(model, options = {}) {
    const panel = getSearchResultsPanel();
    if (!panel) return;

    try {
        if (typeof window.currentView === 'string' && window.currentView !== 'canvas') return;
        const input = document.getElementById('searchInput');
        const currentQ = (input && typeof input.value === 'string') ? input.value.trim().toLowerCase() : '';
        const expectedQ = normalizeNoteBrowseRootQuery(options && options.query || '');
        if (currentQ !== expectedQ) return;
    } catch (_) { }

    const isZh = currentLang === 'zh_CN';
    const colorEntries = Array.isArray(model && model.colorEntries) ? model.colorEntries : [];
    const numberEntries = Array.isArray(model && model.numberEntries) ? model.numberEntries : [];
    const alphabetEntries = Array.isArray(model && model.alphabetEntries) ? model.alphabetEntries : [];
    const otherEntries = Array.isArray(model && model.otherEntries) ? model.otherEntries : [];

    const activeColorDetail = (searchUiState && searchUiState.noteBrowseDetail && searchUiState.noteBrowseDetail.active && searchUiState.noteBrowseDetail.kind === 'color')
        ? searchUiState.noteBrowseDetail
        : null;
    const selectedColor = activeColorDetail ? normalizeNoteBrowseColor(activeColorDetail.color) : null;

    const colorTitle = isZh ? '按颜色筛选' : 'Filter by Color';
    const alphabetTitle = isZh ? '按首字母筛选 (A-Z)' : 'Filter by Letter (A-Z)';
    const numberTitle = isZh ? '按数字首字符筛选 (0-9)' : 'Filter by Number (0-9)';

    const visibleColors = colorEntries.filter(e => e && e.count > 0);
    const combinedAlphaAndOther = alphabetEntries.concat(otherEntries).filter(e => e && e.count > 0);
    const visibleNumbers = numberEntries.filter(e => e && e.count > 0);

    const resultItems = [];
    const registerResultItem = (entry) => {
        const color = normalizeNoteBrowseColor(entry && entry.color);
        const note = String(entry && entry.note || '').trim();
        const noteLower = String(entry && entry.noteLower || '').trim().toLowerCase();
        const type = String(entry && entry.type || 'note-browser-note');
        const label = String(entry && entry.label || '').trim() || (type === 'note-browser-bucket' ? entry.bucket : getNoteBrowseColorLabel(color, isZh));
        const count = Number(entry && entry.count || 0);
        const index = resultItems.length;
        const item = {
            id: type === 'note-browser-bucket' ? `note-browser::bucket::${entry.bucket}::${index}` : `note-browser::${type}::${color}::${index}`,
            type,
            color,
            note,
            noteLower,
            label,
            count,
            bucket: entry.bucket || null
        };
        resultItems.push(item);
        return { item, index };
    };

    const renderColorCards = (entries) => {
        return entries.map((entry) => {
            const { item, index } = registerResultItem(entry);
            const isSelectedClass = normalizeNoteBrowseColor(entry.color) === selectedColor ? ' is-selected' : '';
            return `
                <div class="search-result-item canvas-tag-browse-item canvas-note-browse-item is-color-card${isSelectedClass}" data-index="${index}" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}" title="${escapeHtml(item.label)} (${item.count})">
                    <div class="search-result-content">
                        <div class="search-result-title">
                            <span class="canvas-tag-browse-dot-wrap"><i class="fas fa-pencil-alt canvas-note-browse-icon note-color-${escapeHtml(item.color)}"></i></span>
                        </div>
                    </div>
                    <span class="canvas-tag-browse-count">${escapeHtml(String(item.count))}</span>
                </div>
            `;
        }).join('');
    };

    const renderBucketGrid = (entries) => {
        return entries.map((entry) => {
            const { item, index } = registerResultItem(entry);
            return `
                <div class="search-result-item canvas-note-browse-bucket-btn" data-index="${index}" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}" title="${escapeHtml(item.label)} (${item.count})">
                    <span class="bucket-label">${escapeHtml(item.label)}</span>
                    <span class="bucket-count">${escapeHtml(String(item.count))}</span>
                </div>
            `;
        }).join('');
    };

    let html = '';

    if (visibleColors.length > 0) {
        html += `
            <div class="canvas-tag-browse-section">
                <div class="canvas-tag-browse-section-title">${escapeHtml(colorTitle)}</div>
                <div class="canvas-tag-browse-color-grid">
                    ${renderColorCards(visibleColors)}
                </div>
            </div>
        `;
    }

    if (visibleNumbers.length > 0) {
        html += `
            <div class="canvas-tag-browse-section">
                <div class="canvas-tag-browse-section-title">${escapeHtml(numberTitle)}</div>
                <div class="canvas-note-browse-bucket-grid">
                    ${renderBucketGrid(visibleNumbers)}
                </div>
            </div>
        `;
    }

    if (combinedAlphaAndOther.length > 0) {
        html += `
            <div class="canvas-tag-browse-section">
                <div class="canvas-tag-browse-section-title">${escapeHtml(alphabetTitle)}</div>
                <div class="canvas-note-browse-bucket-grid">
                    ${renderBucketGrid(combinedAlphaAndOther)}
                </div>
            </div>
        `;
    }

    if (!html) {
        const noNotesMsg = isZh ? '暂无任何带有笔记的书签' : 'No bookmarks with notes found';
        html = `<div class="search-result-empty">${escapeHtml(noNotesMsg)}</div>`;
    }

    panel.innerHTML = html;

    searchUiState.view = 'canvas';
    searchUiState.query = String(options && options.query || '*');
    searchUiState.resultSource = resultItems;
    searchUiState.resultAll = resultItems;
    searchUiState.resultVisibleCount = resultItems.length;
    searchUiState.resultHasMore = false;
    searchUiState.resultPagingKey = `note-browse-root|${searchUiState.query}`;
    searchUiState.results = resultItems;
    searchUiState.bookmarkModeCounts = null;
    searchUiState.bookmarkGroupModel = null;
    searchUiState.selectedIndex = resultItems.length > 0 ? 0 : -1;
    try {
        searchUiState.canvasSuggestionsVisible = false;
        panel.dataset.panelType = 'results';
    } catch (_) { }

    showSearchResultsPanel();
    if (resultItems.length > 0) {
        updateSearchResultSelection(0);
    }
}

function normalizeTagBrowseRootQuery(query) {
    return String(query || '').trim().toLowerCase();
}

function isTagBrowseRootQuery(query) {
    return TAG_BROWSER_ROOT_QUERIES.has(normalizeTagBrowseRootQuery(query));
}

function normalizeTagBrowseColor(rawColor) {
    const raw = String(rawColor || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'grey') return 'gray';
    if (TAG_BROWSER_COLOR_ORDER.includes(raw)) return raw;
    return '';
}

function getTagBrowseColorLabel(color, isZh) {
    const key = normalizeTagBrowseColor(color);
    const map = TAG_BROWSER_COLOR_LABELS[key];
    if (!map) return key || '';
    return isZh ? (map.zh_CN || map.en || key) : (map.en || map.zh_CN || key);
}

function normalizeTagBrowseTextForColor(color, rawText) {
    const safeColor = normalizeTagBrowseColor(color);
    const safeText = String(rawText || '').trim();
    if (!safeColor || !safeText) return safeText;

    const compactLower = safeText.replace(/\s+/g, '').toLowerCase();
    const aliases = Array.isArray(TAG_SEARCH_COLOR_ALIASES[safeColor]) ? TAG_SEARCH_COLOR_ALIASES[safeColor] : [];
    const matchedAlias = aliases.some((alias) => {
        const aliasLower = String(alias || '').replace(/\s+/g, '').toLowerCase();
        return aliasLower && aliasLower === compactLower;
    });
    return matchedAlias ? '' : safeText;
}

function getTagBrowseSortCollator(isZh) {
    try {
        if (isZh) {
            return new Intl.Collator(['zh-Hans-CN-u-co-pinyin', 'zh-CN-u-co-pinyin', 'zh-CN', 'en'], {
                sensitivity: 'base',
                numeric: true
            });
        }
        return new Intl.Collator(['en', 'zh-CN'], { sensitivity: 'base', numeric: true });
    } catch (_) {
        return null;
    }
}

function getTagBrowseBucketKey(label, collator = null) {
    const text = String(label || '').trim();
    if (!text) return '#';
    const first = text.charAt(0);
    if (/^[0-9]$/.test(first)) return '0-9';
    if (/^[A-Za-z]$/.test(first)) return first.toUpperCase();

    if (/^[\u4e00-\u9fff]$/.test(first)) {
        const cmp = collator && typeof collator.compare === 'function'
            ? collator
            : getTagBrowseSortCollator(true);
        if (cmp && TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES.length) {
            let bucket = 'A';
            for (let i = 0; i < TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES.length; i += 1) {
                const marker = TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES[i];
                try {
                    if (cmp.compare(first, marker.marker) >= 0) {
                        bucket = marker.letter;
                    } else {
                        break;
                    }
                } catch (_) { }
            }
            if (cmp && cmp.compare(first, TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES[TAG_BROWSER_PINYIN_INITIAL_BOUNDARIES.length - 1].marker) >= 0) {
                return 'Z';
            }
            return bucket;
        }
        return 'A';
    }
    return '#';
}

function buildCanvasTagBrowseRootModel(sourceIndex, scopeCacheKey = '') {
    const isZh = currentLang === 'zh_CN';
    const list = Array.isArray(sourceIndex) ? sourceIndex : [];
    const cacheKey = [
        canvasSearchDb && canvasSearchDb.signature ? canvasSearchDb.signature : '',
        canvasTagSearchCacheRevision,
        isZh ? 'zh_CN' : 'en',
        list.length,
        String(scopeCacheKey || 'global')
    ].join('::');
    if (canvasTagBrowseRootCache && canvasTagBrowseRootCache.key === cacheKey) {
        return canvasTagBrowseRootCache.model;
    }

    const colorMap = new Map();
    TAG_BROWSER_COLOR_ORDER.forEach((color) => {
        colorMap.set(color, {
            type: 'tag-browser-color',
            color,
            text: '',
            textLower: '',
            label: getTagBrowseColorLabel(color, isZh),
            itemKeys: new Set()
        });
    });

    const tagMap = new Map();
    const ensureTagEntry = (color, text = '', itemKey = '') => {
        const safeColor = normalizeTagBrowseColor(color);
        if (!safeColor) return null;
        const safeText = normalizeTagBrowseTextForColor(safeColor, text);
        const textLower = safeText.toLowerCase();
        const key = `${safeColor}::${textLower}`;
        let entry = tagMap.get(key);
        if (!entry) {
            entry = {
                type: 'tag-browser-tag',
                color: safeColor,
                text: safeText,
                textLower,
                label: safeText || getTagBrowseColorLabel(safeColor, isZh),
                itemKeys: new Set()
            };
            tagMap.set(key, entry);
        }
        if (itemKey) entry.itemKeys.add(itemKey);
        return entry;
    };

    list.forEach((item) => {
        if (!item || item.type !== 'bookmark-item') return;
        const itemKey = String(item.locationKey || getCanvasBookmarkLocationKeyForSearch(item) || item.id || '').trim();
        if (!itemKey) return;

        const tags = getCanvasBookmarkTagsForSearchCached(item);
        if (!tags.length) return;

        const localSeen = new Set();
        tags.forEach((tag) => {
            const color = normalizeTagBrowseColor(tag && tag.color);
            if (!color) return;
            const colorEntry = colorMap.get(color);
            if (colorEntry) colorEntry.itemKeys.add(itemKey);

            const safeText = String(tag && tag.text || '').trim();
            const textLower = safeText.toLowerCase();
            const localKey = `${color}::${textLower}`;
            if (localSeen.has(localKey)) return;
            localSeen.add(localKey);
            ensureTagEntry(color, safeText, itemKey);
        });
    });

    // 二区块包含“全部 tag 标识”，因此将 7 种颜色标签也放入该列表（即便当前没有命中项）。
    TAG_BROWSER_COLOR_ORDER.forEach((color) => {
        const colorEntry = colorMap.get(color);
        const defaultTagEntry = ensureTagEntry(color, '');
        if (defaultTagEntry && colorEntry && colorEntry.itemKeys.size) {
            colorEntry.itemKeys.forEach((itemKey) => defaultTagEntry.itemKeys.add(itemKey));
        }
    });

    const colorEntries = TAG_BROWSER_COLOR_ORDER.map((color) => {
        const entry = colorMap.get(color);
        return {
            type: 'tag-browser-color',
            color,
            text: '',
            textLower: '',
            label: entry ? entry.label : getTagBrowseColorLabel(color, isZh),
            count: entry ? entry.itemKeys.size : 0
        };
    });

    const collator = getTagBrowseSortCollator(isZh);
    const compareText = (left, right) => {
        const la = String(left || '');
        const lb = String(right || '');
        if (collator) return collator.compare(la, lb);
        return la.localeCompare(lb, isZh ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
    };

    const tagEntries = Array.from(tagMap.values()).map((entry) => ({
        type: 'tag-browser-tag',
        color: entry.color,
        text: entry.text,
        textLower: entry.textLower,
        label: entry.label,
        count: entry.itemKeys.size
    })).sort((a, b) => {
        const textDelta = compareText(a.label, b.label);
        if (textDelta !== 0) return textDelta;
        return TAG_BROWSER_COLOR_ORDER.indexOf(a.color) - TAG_BROWSER_COLOR_ORDER.indexOf(b.color);
    });

    const model = { colorEntries, tagEntries };
    canvasTagBrowseRootCache = { key: cacheKey, model };
    return model;
}

function tagMatchesBrowseDetail(tag, detail) {
    if (!tag || !detail) return false;
    const color = normalizeTagBrowseColor(tag.color);
    if (!color) return false;
    if (detail.kind === 'color') {
        return color === normalizeTagBrowseColor(detail.color);
    }
    const targetColor = normalizeTagBrowseColor(detail.color);
    const targetText = String(detail.textLower || '').trim().toLowerCase();
    if (!targetText) {
        return color === targetColor;
    }
    const currentText = String(tag.text || '').trim().toLowerCase();
    return color === targetColor && currentText === targetText;
}

function renderCanvasTagBrowseRootPanel(model, options = {}) {
    const panel = getSearchResultsPanel();
    if (!panel) return;

    try {
        if (typeof window.currentView === 'string' && window.currentView !== 'canvas') return;
        const input = document.getElementById('searchInput');
        const currentQ = (input && typeof input.value === 'string') ? input.value.trim().toLowerCase() : '';
        const expectedQ = normalizeTagBrowseRootQuery(options && options.query || '');
        if (currentQ !== expectedQ) return;
    } catch (_) { }

    const isZh = currentLang === 'zh_CN';
    const colorEntries = Array.isArray(model && model.colorEntries) ? model.colorEntries : [];
    const tagEntries = Array.isArray(model && model.tagEntries) ? model.tagEntries : [];
    
    // Check if color filter is active
    const activeColorDetail = (searchUiState && searchUiState.tagBrowseDetail && searchUiState.tagBrowseDetail.active && searchUiState.tagBrowseDetail.kind === 'color')
        ? searchUiState.tagBrowseDetail
        : null;
    const selectedColor = activeColorDetail ? activeColorDetail.color : null;
    
    const colorTitle = isZh ? '颜色' : 'Colors';
    
    let tagTitle = isZh ? '全部标签（0-9 / A-Z）' : 'All Tags (0-9 / A-Z)';
    let titleHtml = `<div class="canvas-tag-browse-section-title">${escapeHtml(tagTitle)}</div>`;
    
    const filteredTagEntries = selectedColor
        ? tagEntries.filter(entry => normalizeTagBrowseColor(entry.color) === selectedColor)
        : tagEntries;
        
    if (selectedColor) {
        const colorLabel = getTagBrowseColorLabel(selectedColor, isZh);
        const displayTagTitle = isZh ? `${colorLabel}标签` : `${colorLabel} Tags`;
        
        const backLabel = isZh ? '返回' : 'Back';
        const collectionLabel = isZh ? '集合' : 'Collection';
        
        titleHtml = `
            <div class="canvas-tag-browse-section-header">
                <div class="canvas-tag-browse-section-title">${escapeHtml(displayTagTitle)}</div>
                <div class="canvas-tag-browse-section-header-right">
                    <button type="button" class="canvas-tag-browse-collection-btn">${escapeHtml(collectionLabel)}</button>
                    <button type="button" class="canvas-tag-browse-back-btn">${escapeHtml(backLabel)}</button>
                </div>
            </div>
        `;
    }

    const resultItems = [];
    const registerResultItem = (entry) => {
        const color = normalizeTagBrowseColor(entry && entry.color) || 'gray';
        const text = String(entry && entry.text || '').trim();
        const textLower = String(entry && entry.textLower || '').trim().toLowerCase();
        const label = String(entry && entry.label || '').trim() || getTagBrowseColorLabel(color, isZh);
        const count = Number(entry && entry.count || 0);
        const type = String(entry && entry.type || 'tag-browser-tag');
        const item = {
            id: `tag-browser::${type}::${color}::${textLower || '__color__'}`,
            type,
            color,
            text,
            textLower,
            label,
            count
        };
        const index = resultItems.length;
        resultItems.push(item);
        return { item, index };
    };

    const renderColorCards = (entries) => {
        const list = Array.isArray(entries) ? entries : [];
        return list.map((entry) => {
            const { item, index } = registerResultItem(entry);
            const isSelectedClass = normalizeTagBrowseColor(entry.color) === selectedColor ? ' is-selected' : '';
            return `
                <div class="search-result-item canvas-tag-browse-item is-color-card${isSelectedClass}" data-index="${index}" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">
                    <div class="search-result-content">
                        <div class="search-result-title">
                            <span class="canvas-tag-browse-dot-wrap"><span class="tag-dot tag-dot-${escapeHtml(item.color)}"></span></span>
                        </div>
                    </div>
                    <span class="canvas-tag-browse-count">${escapeHtml(String(item.count))}</span>
                </div>
            `;
        }).join('');
    };

    const renderTagRows = (entries) => {
        const list = Array.isArray(entries) ? entries : [];
        return list.map((entry) => {
            const { item, index } = registerResultItem(entry);
            const countHtml = Number(item.count || 0) > 0
                ? `<span class="canvas-tag-browse-count">${escapeHtml(String(item.count))}</span>`
                : '';
            return `
                <div class="search-result-item canvas-tag-browse-item is-tag-row" data-index="${index}" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">
                    <div class="search-result-content">
                        <div class="search-result-title">
                            <span class="canvas-tag-browse-dot-wrap"><span class="tag-dot tag-dot-${escapeHtml(item.color)}"></span></span>
                            <span class="canvas-tag-browse-label">${escapeHtml(item.label)}</span>
                        </div>
                    </div>
                    ${countHtml}
                </div>
            `;
        }).join('');
    };

    const collator = getTagBrowseSortCollator(isZh);
    const compareTagEntries = (left, right) => {
        const la = String(left && left.label || '');
        const lb = String(right && right.label || '');
        if (collator) {
            try {
                const delta = collator.compare(la, lb);
                if (delta !== 0) return delta;
            } catch (_) { }
        } else {
            const delta = la.localeCompare(lb, isZh ? 'zh-CN' : 'en', { sensitivity: 'base', numeric: true });
            if (delta !== 0) return delta;
        }
        return TAG_BROWSER_COLOR_ORDER.indexOf(normalizeTagBrowseColor(left && left.color))
            - TAG_BROWSER_COLOR_ORDER.indexOf(normalizeTagBrowseColor(right && right.color));
    };
    const bucketOrder = ['0-9'].concat(TAG_BROWSER_ALPHA_KEYS);
    const bucketMap = new Map(bucketOrder.map((key) => [key, []]));
    const others = [];
    filteredTagEntries.forEach((entry) => {
        const bucket = getTagBrowseBucketKey(entry && entry.label, collator);
        if (bucketMap.has(bucket)) {
            bucketMap.get(bucket).push(entry);
        } else {
            others.push(entry);
        }
    });
    bucketMap.forEach((entries) => entries.sort(compareTagEntries));
    others.sort(compareTagEntries);

    const renderBucketSection = (key, entries) => {
        const list = (Array.isArray(entries) ? entries : []).filter((entry) => Number(entry && entry.count || 0) > 0);
        if (!list.length) return '';

        if (!searchUiState.tagBrowseBucketLimits) {
            searchUiState.tagBrowseBucketLimits = {};
        }
        const tagLimit = searchUiState.tagBrowseBucketLimits[key] || 5;
        searchUiState.tagBrowseBucketLimits[key] = tagLimit;

        const visibleTags = list.slice(0, tagLimit);

        const hasMore = list.length > visibleTags.length;
        const canCollapse = tagLimit > 5;

        let bucketActionsHtml = '';
        if (hasMore || canCollapse) {
            const remaining = list.length - visibleTags.length;
            const willLoad = Math.min(5, remaining);

            const loadMoreBtnHtml = hasMore
                ? `<button type="button" class="canvas-tag-bucket-load-more-btn" data-bucket="${escapeHtml(key)}" style="border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-secondary); padding:4px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px; flex:1; justify-content:center;">
                    <i class="fas fa-chevron-down" style="font-size:9px;"></i>
                    <span>${isZh ? `展开 ${willLoad} 项` : `Load ${willLoad} more`}</span>
                   </button>`
                : '';

            const collapseBtnHtml = canCollapse
                ? `<button type="button" class="canvas-tag-bucket-collapse-btn" data-bucket="${escapeHtml(key)}" style="border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-secondary); padding:4px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px; flex:1; justify-content:center;">
                    <i class="fas fa-chevron-up" style="font-size:9px;"></i>
                    <span>${isZh ? '收起已加载' : 'Collapse'}</span>
                   </button>`
                : '';

            bucketActionsHtml = `<div class="canvas-tag-bucket-actions-row" style="padding:4px 12px; display:flex; justify-content:center; gap:8px;">
                ${loadMoreBtnHtml}
                ${collapseBtnHtml}
            </div>`;
        }

        return `<div class="canvas-tag-browse-bucket">
            <div class="canvas-tag-browse-bucket-title">${escapeHtml(key)}</div>
            <div class="canvas-tag-browse-bucket-list">${renderTagRows(visibleTags)}</div>
            ${bucketActionsHtml}
        </div>`;
    };

    // Collect active non-empty buckets
    const activeBuckets = [];
    const numberBucketEntries = (bucketMap.get('0-9') || []).filter((entry) => Number(entry && entry.count || 0) > 0);
    if (numberBucketEntries.length) {
        activeBuckets.push({ key: '0-9', entries: numberBucketEntries });
    }
    TAG_BROWSER_ALPHA_KEYS.forEach((letter) => {
        const entries = (bucketMap.get(letter) || []).filter((entry) => Number(entry && entry.count || 0) > 0);
        if (entries && entries.length) {
            activeBuckets.push({ key: letter, entries });
        }
    });
    const otherEntries = others.filter((entry) => Number(entry && entry.count || 0) > 0);
    if (otherEntries.length) {
        activeBuckets.push({ key: '#', entries: otherEntries });
    }

    let bucketsHtml = '';
    activeBuckets.forEach((b, idx) => {
        bucketsHtml += renderBucketSection(b.key, b.entries);
        if (b.key === '0-9' && idx < activeBuckets.length - 1) {
            bucketsHtml += `<div class="canvas-tag-browse-major-divider"></div>`;
        }
    });

    const visibleColors = colorEntries.filter(e => e && e.count > 0);
    let html = '';
    if (visibleColors.length > 0) {
        html += `
            <div class="canvas-tag-browse-section">
                <div class="canvas-tag-browse-section-title">${escapeHtml(colorTitle)}</div>
                <div class="canvas-tag-browse-color-grid">
                    ${renderColorCards(visibleColors)}
                </div>
            </div>
        `;
    }
    html += `
        <div class="canvas-tag-browse-section">
            ${titleHtml}
            <div class="canvas-tag-browse-buckets">
                ${bucketsHtml}
            </div>
        </div>
    `;

    panel.innerHTML = html;

    searchUiState.view = 'canvas';
    searchUiState.query = String(options && options.query || '#');
    searchUiState.resultSource = resultItems;
    searchUiState.resultAll = resultItems;
    searchUiState.resultVisibleCount = resultItems.length;
    searchUiState.resultHasMore = false;
    searchUiState.resultPagingKey = `tag-browse-root|${searchUiState.query}`;
    searchUiState.results = resultItems;
    searchUiState.bookmarkModeCounts = null;
    searchUiState.bookmarkGroupModel = null;
    searchUiState.selectedIndex = resultItems.length > 0 ? 0 : -1;
    try {
        searchUiState.canvasSuggestionsVisible = false;
        panel.dataset.panelType = 'results';
    } catch (_) { }

    showSearchResultsPanel();
    if (resultItems.length > 0) {
        updateSearchResultSelection(0);
    }
}

/**
 * 执行画布搜索并渲染结果
 * @param {string} query - 搜索关键词
 * @param {Object} options - 触发选项（source/keepTagBrowseDetail/keepNoteBrowseDetail）
 */
function searchCanvasAndRender(query, options = {}) {
    const db = buildCanvasSearchDb();
    const triggerSource = options && typeof options === 'object'
        ? String(options.source || 'system')
        : 'system';
    const keepTagBrowseDetail = !!(options && typeof options === 'object' && options.keepTagBrowseDetail === true);
    const keepNoteBrowseDetail = !!(options && typeof options === 'object' && options.keepNoteBrowseDetail === true);

    // Check if entire DB is broken
    if (!db.itemById) {
        renderSearchResultsPanel([], { view: 'canvas', query, emptyText: i18n.searchNoResults[currentLang] });
        return;
    }

    const trimmedQuery = String(query).trim();
    if (!trimmedQuery) {
        searchUiState.tagBrowseDetail = null;
        searchUiState.tagBrowseBucketsLimit = 5;
        searchUiState.tagBrowseBucketLimits = {};
        searchUiState.noteBrowseDetail = null;
        searchUiState.noteBrowseBucketsLimit = 5;
        searchUiState.noteBrowseBucketLimits = {};
        hideSearchResultsPanel();
        return;
    }
    // 用户直接输入 # / {#} 时，始终回到一级 UI，不记忆上次二级状态和二级筛选选择。
    if (isTagBrowseRootQuery(trimmedQuery) && triggerSource === 'input' && !keepTagBrowseDetail) {
        searchUiState.tagBrowseDetail = null;
        searchUiState.bookmarkTypeFilter = null;
    }
    if (isNoteBrowseRootQuery(trimmedQuery) && triggerSource === 'input' && !keepNoteBrowseDetail) {
        searchUiState.noteBrowseDetail = null;
        searchUiState.bookmarkTypeFilter = null;
    }
    if (!isTagBrowseRootQuery(trimmedQuery)) {
        searchUiState.tagBrowseDetail = null;
        searchUiState.tagBrowseBucketsLimit = 5;
        searchUiState.tagBrowseBucketLimits = {};
    }
    if (!isNoteBrowseRootQuery(trimmedQuery)) {
        searchUiState.noteBrowseDetail = null;
        searchUiState.noteBrowseBucketsLimit = 5;
        searchUiState.noteBrowseBucketLimits = {};
    }
    const previousCanvasQuery = String(searchUiState.query || '').trim().toLowerCase();
    const nextCanvasQuery = trimmedQuery.toLowerCase();

    // Determine Source Index based on Active Mode
    let sourceIndex = [];
    const mode = searchUiState.activeMode;
    const queryContext = createCanvasSearchQueryContext(trimmedQuery, mode);
    if (mode === 'bookmark' && isCanvasTagSearchQuery(trimmedQuery) &&
        typeof window !== 'undefined' && window.TagSystem &&
        typeof window.TagSystem.ensurePermTagsLoaded === 'function' &&
        typeof window.TagSystem.isPermTagsLoaded === 'function' &&
        !window.TagSystem.isPermTagsLoaded()) {
        window.TagSystem.ensurePermTagsLoaded().then(() => {
            try {
                invalidateCanvasTagSearchCaches();
                if (searchUiState && searchUiState.domainIndexCache) {
                    searchUiState.domainIndexCache = null;
                }
                const currentQuery = String(searchUiState && searchUiState.query || '').trim();
                const currentMode = searchUiState && searchUiState.activeMode;
                if (currentMode === 'bookmark' && currentQuery === trimmedQuery) {
                    searchCanvasAndRender(trimmedQuery, { source: 'tag-cache', keepTagBrowseDetail: true, keepNoteBrowseDetail: true });
                }
            } catch (_) {}
        }).catch(() => {});
    }
    if (mode === 'bookmark' && isCanvasNoteSearchQuery(trimmedQuery) &&
        typeof window !== 'undefined' && window.NoteSystem &&
        typeof window.NoteSystem.ensurePermNotesLoaded === 'function' &&
        typeof window.NoteSystem.isPermNotesLoaded === 'function' &&
        !window.NoteSystem.isPermNotesLoaded()) {
        window.NoteSystem.ensurePermNotesLoaded().then(() => {
            try {
                invalidateCanvasNoteSearchCaches();
                if (searchUiState && searchUiState.domainIndexCache) {
                    searchUiState.domainIndexCache = null;
                }
                const currentQuery = String(searchUiState && searchUiState.query || '').trim();
                const currentMode = searchUiState && searchUiState.activeMode;
                if (currentMode === 'bookmark' && currentQuery === trimmedQuery) {
                    searchCanvasAndRender(trimmedQuery, { source: 'note-cache', keepTagBrowseDetail: true, keepNoteBrowseDetail: true });
                }
            } catch (_) {}
        }).catch(() => {});
    }
    if (mode === 'bookmark' && previousCanvasQuery !== nextCanvasQuery) {
        searchUiState.bookmarkGroupCollapse = new Map();
    }

    if (mode === 'bookmark') {
        sourceIndex = db.bookmarkIndex || [];
    } else if (mode === 'description') {
        sourceIndex = db.descriptionIndex || [];
    } else if (mode === 'tag') {
        // Tag mode shares the bookmark index, filtered by tag presence/match below.
        sourceIndex = db.bookmarkIndex || [];
    } else {
        // Default to Structure (Card)
        sourceIndex = db.structureIndex || [];
    }

    if (sourceIndex.length === 0) {
        // Index empty for this mode
        renderSearchResultsPanel([], { view: 'canvas', query: trimmedQuery, emptyText: i18n.searchNoResults[currentLang] });
        return;
    }

    if (mode === 'bookmark' && isTagBrowseRootQuery(trimmedQuery)) {
        const detail = searchUiState && searchUiState.tagBrowseDetail ? searchUiState.tagBrowseDetail : null;
        if (!detail || detail.active !== true || (detail.kind === 'color' && !detail.showBookmarks)) {
            const scopedSource = getCanvasBookmarkBrowseScopedSource(sourceIndex);
            const rootModel = buildCanvasTagBrowseRootModel(scopedSource.sourceIndex, scopedSource.cacheKey);
            renderCanvasTagBrowseRootPanel(rootModel, { query: trimmedQuery });
            return;
        }
    }
    if (mode === 'bookmark' && isNoteBrowseRootQuery(trimmedQuery)) {
        const detail = searchUiState && searchUiState.noteBrowseDetail ? searchUiState.noteBrowseDetail : null;
        if (!detail || detail.active !== true) {
            const scopedSource = getCanvasBookmarkBrowseScopedSource(sourceIndex);
            const rootModel = buildCanvasNoteBrowseRootModel(scopedSource.sourceIndex, scopedSource.cacheKey);
            renderCanvasNoteBrowseRootPanel(rootModel, { query: trimmedQuery });
            return;
        }
    }
    const activeTagBrowseDetail = mode === 'bookmark' && isTagBrowseRootQuery(trimmedQuery)
        && searchUiState
        && searchUiState.tagBrowseDetail
        && searchUiState.tagBrowseDetail.active === true
        ? searchUiState.tagBrowseDetail
        : null;
    const activeNoteBrowseDetail = mode === 'bookmark' && isNoteBrowseRootQuery(trimmedQuery)
        && searchUiState
        && searchUiState.noteBrowseDetail
        && searchUiState.noteBrowseDetail.active === true
        ? searchUiState.noteBrowseDetail
        : null;
    const bookmarkScoringQuery = activeTagBrowseDetail ? '#' : (activeNoteBrowseDetail ? '*' : trimmedQuery);
    const scoringQueryContext = (activeTagBrowseDetail || activeNoteBrowseDetail)
        ? createCanvasSearchQueryContext(bookmarkScoringQuery, mode)
        : queryContext;

    // 检测特殊语法
    // Bookmark 模式下应当被视为“纯文本搜索”，不触发 # / A- 等特殊语法。
    const isGroupSearch = queryContext.isGroupSearch;
    const isPermanentQuery = queryContext.isPermanentQuery;

    // 清除之前的高亮状态 (用户输入改变时，如果不再匹配之前的群组，需要清除高亮)
    clearCanvasSearchHighlight();

    const scored = [];
    const fullscreenScope = getActiveFullscreenSearchScopeForFiltering();

    const currentScopeId = fullscreenScope ? `${fullscreenScope.kind}:${fullscreenScope.id}` : '';
    const lastScopeId = searchUiState.lastFullscreenScopeId || '';
    if (previousCanvasQuery !== nextCanvasQuery || currentScopeId !== lastScopeId) {
        searchUiState.showFullscreenDescriptionOthers = false;
        searchUiState.lastFullscreenScopeId = currentScopeId;
    }

    const fullscreenOthers = [];
    const belongsToFullscreen = (item, scope) => {
        if (!scope) return false;
        if (scope.kind === 'temp' && item.type === 'temp-section' && String(item.id) === String(scope.id)) {
            return true;
        }
        if (scope.kind === 'permanent' && item.type === 'permanent-section' && String(item.id) === String(scope.id)) {
            return true;
        }
        if (scope.kind === 'blank' && item.type === 'md-node' && String(item.id) === String(scope.id)) {
            return true;
        }
        return false;
    };

    // Aggregation buckets
    const groupAggregation = {
        ids: [],
        type: null, // 'permanent-group' | 'temp-group'
        label: '',
        count: 0
    };

    // 1. Detect Aggregation Intent
    let isAggregationIntent = false;

    // 1a. Permanent Group Intent: "#", "永久", "permanent"
    const lowerQ = trimmedQuery.toLowerCase();
    if (trimmedQuery === '#' || lowerQ === '永久' || lowerQ === 'permanent') {
        isAggregationIntent = true;
        groupAggregation.type = 'permanent-group';
        groupAggregation.label = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'All Permanent Sections' : '所有永久栏目';
    }
    // 1b. Temp Group Intent: "A", "Job"... (Prefix match)
    // Only if it looks like a prefix (alphanumeric/hanzi) and isn't a widely generic term unless it matches a specific label prefix logic
    else if (/^[a-zA-Z0-9\u4e00-\u9fa5]+$/.test(trimmedQuery)) {
        // Potential temp group
        // Check if multiple items actually start with this prefix plus dash
        // Logic will be done during iteration
    }
    for (const item of sourceIndex) {
        if (searchUiState.areaSearchScope) {
            if (!isItemInAreaSearchScope(item, searchUiState.areaSearchScope)) {
                continue;
            }
        }
        // [Optim] Strict Partitioning: We already selected the sourceIndex.
        if (searchUiState.activeMode === 'description') {
            // Description Mode: Only MD Nodes, Edges, Section Descriptions
            if (item.type !== 'md-node' && item.type !== 'edge' &&
                !(item.type === 'temp-section' && item.__description) &&
                !(item.type === 'permanent-section' && item.__description)) {
                continue;
            }
        } else if (searchUiState.activeMode === 'structure') {
            // Card/Structure Mode: Permanent Sections, Temp Sections (Structure), Groups
            if (item.type !== 'permanent-section' && item.type !== 'temp-section' && item.type !== 'group') {
                continue;
            }
        } else if (searchUiState.activeMode === 'tag') {
            // Tag Mode: only bookmark-items whose tags match the query.
            if (item.type !== 'bookmark-item') continue;
            if (!doesCanvasBookmarkItemTagsMatchQuery(item, trimmedQuery)) continue;
        }
        // Note: 'bookmark' mode logic is "not done yet" but currently implicit.
        // Once bookmark data is in indices, we will filter for it here.
        // For now, if activeMode is 'bookmark', we might show everything or nothing depending on status.
        // Assuming current items are structure/description, we should probably hide them in bookmark mode?
        // User says "Bookmark mode not done yet", so maybe it should show nothing or fallback.
        // However, user prompt didn't strictly say "hide everything in bookmark mode", just "separation".
        // Let's implement strict separation: if 'bookmark', only show bookmark items (none currently in db).

        if (searchUiState.activeMode === 'bookmark') {
            // Placeholder: currently no bookmark items in db.items (they verify against buildCanvasSearchDb)
            // If we filter strict, results will be empty, which is correct for "not done".
            // But to avoid confusion, maybe we allow fallthrough? 
            // User request is explicit about "Search Partitioning".
            // So we strictly filter. Since we have no bookmark items yet, this returns empty.
            // This matches the "Not done yet" state.
            if (item.type !== 'bookmark-item') { // Future type
                continue;
            }
        }

        if (shouldSkipCanvasSearchCandidateForQuery(item, mode, queryContext)) {
            continue;
        }

        if (mode === 'bookmark' && fullscreenScope && item.type === 'bookmark-item') {
            const scopeKind = String(fullscreenScope.kind || '').trim();
            if (scopeKind === 'temp') {
                const targetSectionId = String(fullscreenScope.id || '').trim();
                if (!(item.source === 'temporary' && String(item.sectionId || '') === targetSectionId)) {
                    continue;
                }
            } else if (scopeKind === 'permanent') {
                if (item.source !== 'permanent') {
                    continue;
                }
            } else if (scopeKind === 'blank') {
                continue;
            }
        }

        if (activeTagBrowseDetail && item.type === 'bookmark-item') {
            const itemTags = getCanvasBookmarkTagsForSearchCached(item);
            if (!itemTags.some((tag) => tagMatchesBrowseDetail(tag, activeTagBrowseDetail))) {
                continue;
            }
        }
        if (activeNoteBrowseDetail && item.type === 'bookmark-item') {
            if (!noteMatchesBrowseDetail(item, activeNoteBrowseDetail)) {
                continue;
            }
        }

        if (mode === 'tag' && fullscreenScope && item.type === 'bookmark-item') {
            const scopeKind = String(fullscreenScope.kind || '').trim();
            if (scopeKind === 'temp') {
                const targetSectionId = String(fullscreenScope.id || '').trim();
                if (!(item.source === 'temporary' && String(item.sectionId || '') === targetSectionId)) {
                    continue;
                }
            } else if (scopeKind === 'permanent') {
                if (item.source !== 'permanent') {
                    continue;
                }
            } else if (scopeKind === 'blank') {
                continue;
            }
        }

        // 特殊语法过滤
        if (isPermanentQuery && item.type !== 'permanent-section') continue;

        // Tag mode: skip score machinery (already filtered above). Give a flat score
        // proportional to tag count so items with more tags rank higher.
        if (mode === 'tag') {
            const tags = getCanvasBookmarkTagsForSearchCached(item);
            const rawScore = 100 + Math.min(10, tags.length);
            const scopeBonus = getCanvasScopePriorityForItem(item, fullscreenScope);
            scored.push({ item, s: rawScore + scopeBonus, rawScore });
            continue;
        }

        const rawScore = scoreCanvasSearchItem(item, bookmarkScoringQuery, { isGroupSearch, queryContext: scoringQueryContext, mode });
        if (rawScore > -Infinity) {
            const scopeBonus = getCanvasScopePriorityForItem(item, fullscreenScope);
            const scoredItem = { item, s: rawScore + scopeBonus, rawScore };
            if (fullscreenScope) {
                // 如果是全屏模式，书签和卡片模式过滤已单独处理（书签在循环开头过滤，卡片模式在全屏下用于切换，不限制在当前卡片）
                if (mode === 'bookmark' || mode === 'structure') {
                    scored.push(scoredItem);
                } else if (belongsToFullscreen(item, fullscreenScope)) {
                    scored.push(scoredItem);
                } else if (mode === 'description') {
                    // 全屏说明模式下，非当前卡片的匹配项归入 others，用户点击“展示其他”按钮时才展示
                    fullscreenOthers.push(scoredItem);
                }
            } else {
                scored.push(scoredItem);
            }

            // Collect for Aggregation
            if (groupAggregation.type === 'permanent-group') {
                if (item.type === 'permanent-section') {
                    groupAggregation.ids.push(item.id);
                    groupAggregation.count++;
                }
            } else {
                // Check Temp Group Prefix aggregation (Dynamic)
                if (item.type === 'temp-section' && item.label) {
                    // Startswith query + "-"
                    // e.g. Query "A" -> matches "A-1", "A-2"
                    // Case insensitive
                    const prefix = trimmedQuery.toLowerCase();
                    const cleanPrefix = prefix.replace(/-$/, '');
                    const lbl = item.label.toLowerCase();
                    if (lbl === cleanPrefix || lbl.startsWith(cleanPrefix + '-')) {
                        if (!groupAggregation.type) {
                            groupAggregation.type = 'temp-group';
                            groupAggregation.label = (typeof currentLang !== 'undefined' && currentLang === 'en') ? `Group: ${trimmedQuery.toUpperCase()}` : `群组: ${trimmedQuery.toUpperCase()}`;
                        }
                        if (groupAggregation.type === 'temp-group') {
                            groupAggregation.ids.push(item.id);
                            groupAggregation.count++;
                        }
                    }
                }
            }
        }
    }

    // Bookmark Mode: Group results by "section card" (永久栏目 / 临时栏目)
    if (mode === 'bookmark') {
        scored.sort((a, b) => compareCanvasBookmarkScoredPairs(a, b, fullscreenScope));
        const groups = buildCanvasBookmarkGroupModel(scored, { scope: fullscreenScope });
        searchUiState.bookmarkGroupModel = groups;
        const groupedResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
        const preferredIndex = getPreferredSearchResultIndexByScope(groupedResults, fullscreenScope);
        renderCanvasSearchResults(groupedResults, {
            view: 'canvas',
            query: trimmedQuery,
            selectedIndex: preferredIndex >= 0 ? preferredIndex : 0
        });
        return;
    }

    if (mode === 'description' && fullscreenScope) {
        fullscreenOthers.sort((a, b) => {
            if (b.s !== a.s) return b.s - a.s;
            const ta = a.item.title || a.item.label || '';
            const tb = b.item.title || b.item.label || '';
            return ta.localeCompare(tb);
        });

        searchUiState.fullscreenDescriptionOthers = fullscreenOthers.map(x => x.item);

        if (searchUiState.showFullscreenDescriptionOthers) {
            scored.push(...fullscreenOthers);
        }
    } else {
        searchUiState.fullscreenDescriptionOthers = [];
    }

    // 按分数排序
    scored.sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        // 稳定排序：按标题
        const ta = a.item.title || a.item.label || '';
        const tb = b.item.title || b.item.label || '';
        return ta.localeCompare(tb);
    });

    const MAX_RESULTS = 20;
    const finalResults = scored.slice(0, MAX_RESULTS).map(x => x.item);

    // Insert Group Result if applicable
    if (groupAggregation.count > 1) { // Only show group if > 1 items
        const groupItem = {
            id: 'group-aggregation-result', // unique phantom ID
            type: 'group-result',
            title: `${groupAggregation.label} (${groupAggregation.count})`,
            itemsCount: groupAggregation.count,
            targetIds: groupAggregation.ids,
            groupType: groupAggregation.type
        };
        finalResults.unshift(groupItem);
    }

    // 渲染结果（使用画布专用渲染）
    searchUiState.bookmarkGroupModel = null;
    const preferredIndex = getPreferredSearchResultIndexByScope(finalResults, fullscreenScope);
    const renderOptions = { view: 'canvas', query: trimmedQuery, isGroupSearch };
    if (preferredIndex >= 0) {
        renderOptions.selectedIndex = preferredIndex;
    }
    renderCanvasSearchResults(finalResults, renderOptions);
}


function getEmptyQuerySuggestionsPrefKey() {
    return 'canvasSearchHideSuggestions';
}

function shouldShowEmptyQuerySuggestions() {
    try {
        if (typeof window.currentView === 'string' && window.currentView !== 'canvas') return false;
    } catch (_) { }
    try {
        return localStorage.getItem(getEmptyQuerySuggestionsPrefKey()) !== 'true';
    } catch (_) { }
    return true;
}

/**
 * 渲染画布搜索建议（三搜索模式推荐）
 */
function renderCanvasSearchSuggestions() {
    // Isolation guard: only render suggestions in canvas view
    try {
        if (typeof window.currentView === 'string' && window.currentView !== 'canvas') return;
    } catch (_) { }

    const isZh = currentLang === 'zh_CN';
    const prefKey = getEmptyQuerySuggestionsPrefKey();

    // Match the Canvas mode menu styles (colors/icons) by reusing the same ordered modes.
    const modesToShow = getCanvasModesInOrder();

    const panel = getSearchResultsPanel();
    if (!panel) return;

    searchUiState.view = 'canvas';
    searchUiState.query = '';
    searchUiState.results = []; // No actual results
    searchUiState.selectedIndex = -1;
    try {
        searchUiState.canvasSuggestionsVisible = true;
        panel.dataset.panelType = 'canvas-suggestions';
    } catch (_) { }

    const listHtml = modesToShow.map((mode) => {
        const isActive = mode.key === searchUiState.activeMode;
        const title = isZh ? mode.label : mode.labelEn;
        const desc = isZh ? mode.desc : mode.descEn;
        return `
            <div class="search-mode-menu-item ${isActive ? 'active' : ''} canvas-suggestion-mode-item" data-mode-key="${escapeHtml(mode.key)}" style="border-bottom:1px solid var(--border-color-light); border-radius:0;">
                <div class="mode-icon"><i class="fas ${escapeHtml(mode.icon)} ${escapeHtml(mode.color)}"></i></div>
                <div class="mode-info">
                    <div class="mode-name">${escapeHtml(title)}</div>
                    <div class="mode-desc">${desc}</div>
                </div>
            </div>
        `;
    }).join('');

    // Add a header or instruction? User said "double click to click exclusive mode???" maybe just display them as hints.
    // Making them non-clickable (pointer-events: none) as they are suggestions/help.
    // Or we could make them clickable to pre-fill the input with a prefix like "#" or "A-".

    // [Tweak] Stronger border for separation
    const isBottomDock = !!(document.body && document.body.classList.contains('header-dock-bottom'));
    const arrowSvg = isBottomDock ? `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M12 3v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M7 13l5 5 5-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    ` : `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M12 21V7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M7 11l5-5 5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    const hideLabel = isZh ? '下次不再出现' : "Don't show again";
    const hintText = isZh
        ? (isBottomDock ? '点下侧按钮切换模式' : '点左侧按钮切换模式')
        : (isBottomDock ? 'Use the bottom button to switch mode' : 'Use the left button to switch mode');
    const hintHelp = getSearchHintHelpContent();

    panel.innerHTML = `
        <div class="search-suggestions-header" style="position:relative; padding:6px 10px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:flex-end; gap:10px;">
            <div class="search-empty-suggestions-hint" style="position:absolute; left:16px; top:50%; transform:translateY(-50%);">
                <span class="search-hint-icon" style="display:inline-flex; position:relative; top:-1px;">${arrowSvg}</span>
                <span class="search-hint-text">${escapeHtml(hintText)}</span>
                <button type="button" class="search-hint-help-btn perf-help-btn" aria-label="${escapeHtml(hintHelp.text)}">
                    <i class="fas fa-question-circle"></i>
                </button>
            </div>
            <button type="button" class="search-empty-suggestions-hide-btn canvas-suggestions-hide-btn" style="border:1px solid var(--border-color); background:var(--bg-secondary); padding:3px 10px; border-radius:999px; font-size:11px; color:var(--text-secondary); cursor:pointer; white-space:nowrap;">
                ${escapeHtml(hideLabel)}
            </button>
        </div>
        <div style="padding:4px 0;">
            ${listHtml}
        </div>
    `;

    // Bind
    try {
        const hideBtn = panel.querySelector('.canvas-suggestions-hide-btn');
        if (hideBtn) {
            hideBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try { localStorage.setItem(prefKey, 'true'); } catch (_) { }
                try { hideSearchResultsPanel(); } catch (_) { }
            });
        }
        panel.querySelectorAll('.canvas-suggestion-mode-item').forEach((el) => {
            el.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const key = el.getAttribute('data-mode-key');
                if (key) {
                    try { setSearchMode(key, { source: 'user' }); } catch (_) { }
                    
                    // Do not automatically collapse the candidate panel, keep it open and re-render suggestions
                    try {
                        if (shouldShowEmptyQuerySuggestions()) {
                            renderCanvasSearchSuggestions();
                            showSearchResultsPanel();
                        }
                    } catch (_) { }

                    // Explicitly focus input to allow direct typing
                    try {
                        const input = document.getElementById('searchInput');
                        if (input) input.focus();
                    } catch (_) { }
                }
            });
        });
        bindSearchHintHelpButton(panel.querySelector('.search-hint-help-btn'), hintHelp.html);
    } catch (_) { }

}

function getDomainCacheKey() {
    const version = (typeof lastTreeSnapshotVersion !== 'undefined' && lastTreeSnapshotVersion !== null)
        ? String(lastTreeSnapshotVersion)
        : '';
    const fingerprint = (typeof lastTreeFingerprint !== 'undefined' && lastTreeFingerprint)
        ? String(lastTreeFingerprint.length)
        : '';
    return `${version}:${fingerprint}`;
}

const MULTI_LEVEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'net.uk', 'sch.uk', 'nhs.uk', 'police.uk', 'mod.uk', 'me.uk', 'plc.uk', 'ltd.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
    'com.br', 'net.br', 'org.br', 'gov.br',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp',
    'co.kr', 'ne.kr', 'or.kr', 'ac.kr', 'go.kr', 'pe.kr', 're.kr',
    'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in', 'res.in',
    'co.nz', 'net.nz', 'org.nz', 'gov.nz', 'ac.nz',
    'com.hk', 'edu.hk', 'gov.hk', 'org.hk', 'net.hk',
    'com.tw', 'edu.tw', 'gov.tw', 'org.tw', 'net.tw',
    'com.sg', 'edu.sg', 'gov.sg', 'org.sg', 'net.sg',
    'com.my', 'edu.my', 'gov.my', 'org.my', 'net.my',
    'com.tr', 'edu.tr', 'gov.tr', 'org.tr', 'net.tr',
    'com.sa', 'edu.sa', 'gov.sa', 'org.sa', 'net.sa',
    'com.ar', 'edu.ar', 'gov.ar', 'org.ar', 'net.ar',
    'com.mx', 'edu.mx', 'gob.mx', 'org.mx', 'net.mx',
    'com.ru', 'net.ru', 'org.ru', 'edu.ru', 'gov.ru',
    'com.id', 'net.id', 'org.id', 'go.id', 'ac.id', 'co.id',
    'co.il', 'co.za', 'co.ke', 'co.ug', 'co.tz', 'co.th', 'co.ve'
]);

function extractBookmarkHost(url) {
    if (!url) return '';
    try {
        const parsed = new URL(String(url));
        const host = parsed.hostname || '';
        return host ? host.toLowerCase().replace(/\.$/, '') : '';
    } catch (_) {
        return '';
    }
}

function getRegistrableDomain(host) {
    if (!host) return '';
    const h = String(host).trim().toLowerCase().replace(/\.$/, '');
    if (!h) return '';
    if (h === 'localhost') return h;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
    if (/^[0-9a-f:]+$/i.test(h) && h.includes(':')) return h;

    const parts = h.split('.').filter(Boolean);
    if (parts.length <= 2) return h;

    const last2 = parts.slice(-2).join('.');
    const last3 = parts.slice(-3).join('.');
    if (MULTI_LEVEL_SUFFIXES.has(last2)) {
        return parts.slice(-3).join('.');
    }
    if (MULTI_LEVEL_SUFFIXES.has(last3)) {
        return parts.slice(-4).join('.');
    }
    return last2;
}

function getDomainGroupKey(url) {
    const host = extractBookmarkHost(url);
    if (!host) return '';
    const level = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';
    return level === 'host' ? host : getRegistrableDomain(host);
}

function getDomainCollapseKey(domain) {
    const level = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';
    return `${level}:${String(domain || '').trim().toLowerCase()}`;
}

function isDomainGroupCollapsed(domain) {
    const key = getDomainCollapseKey(domain);
    if (!key) return true;
    const stored = searchUiState && searchUiState.domainGroupCollapse
        ? searchUiState.domainGroupCollapse.get(key)
        : undefined;
    if (typeof stored === 'boolean') return stored;
    return true;
}

function setDomainGroupCollapsed(domain, collapsed) {
    const key = getDomainCollapseKey(domain);
    if (!key || !searchUiState || !searchUiState.domainGroupCollapse) return;
    searchUiState.domainGroupCollapse.set(key, !!collapsed);
}

function getActiveTagBrowseDetailForQuery(query) {
    const q = String(query || '').trim();
    if (!isTagBrowseRootQuery(q)) return null;
    const detail = searchUiState && searchUiState.tagBrowseDetail ? searchUiState.tagBrowseDetail : null;
    return (detail && detail.active === true) ? detail : null;
}

function getActiveNoteBrowseDetailForQuery(query) {
    const q = String(query || '').trim();
    if (!isNoteBrowseRootQuery(q)) return null;
    const detail = searchUiState && searchUiState.noteBrowseDetail ? searchUiState.noteBrowseDetail : null;
    return (detail && detail.active === true) ? detail : null;
}

function isDomainSearchItemMatched(domain, item, query, detailInput = null, noteDetailInput = null) {
    const q = String(query || '').trim().toLowerCase();
    const detail = detailInput && detailInput.active === true ? detailInput : null;
    const noteDetail = noteDetailInput && noteDetailInput.active === true ? noteDetailInput : null;
    if (!q) return true;

    if (detail) {
        const tags = getCanvasBookmarkTagsForSearchCached(item);
        return tags.some((tag) => tagMatchesBrowseDetail(tag, detail));
    }

    if (noteDetail) {
        return noteMatchesBrowseDetail(item, noteDetail);
    }

    const domainText = String(domain || '').trim().toLowerCase();
    if (domainText.includes(q)) return true;

    const titleText = String(item && item.__title || '').trim().toLowerCase();
    if (titleText && titleText.includes(q)) return true;

    const urlText = String(item && item.__url || '').trim().toLowerCase();
    if (urlText && urlText.includes(q)) return true;

    const pathText = String(item && item.__path || '').trim().toLowerCase();
    if (pathText && pathText.includes(q)) return true;

    if (q.startsWith('#') && doesCanvasBookmarkItemTagsMatchQuery(item, q)) {
        return true;
    }

    if (isCanvasNoteSearchQuery(q) && doesCanvasBookmarkItemNoteMatchQuery(item, q)) {
        return true;
    }

    return false;
}

function resolveDomainSearchScope(scopeInput = null) {
    const scope = scopeInput && typeof scopeInput === 'object'
        ? scopeInput
        : (searchUiState && searchUiState.areaSearchScope
            ? searchUiState.areaSearchScope
            : getActiveFullscreenSearchScopeForFiltering());
    if (!scope || typeof scope !== 'object') return null;
    const kind = String(scope.kind || '').trim();
    if (kind === 'temp') {
        const id = String(scope.id || '').trim();
        if (!id) return null;
        return { kind: 'temp', id, key: `temp:${id}`, memberIds: scope.memberIds };
    }
    if (kind === 'permanent') {
        const copyId = String(scope.copyId || '').trim();
        return { kind: 'permanent', copyId: copyId || null, key: copyId ? `permanent:${copyId}` : 'permanent:main', memberIds: scope.memberIds };
    }
    if (kind === 'blank') {
        const id = String(scope.id || '').trim();
        return { kind: 'blank', id: id || '', key: id ? `blank:${id}` : 'blank', memberIds: scope.memberIds };
    }
    if (kind === 'group') {
        const id = String(scope.id || '').trim();
        return { kind: 'group', id, key: `group:${id}`, memberIds: scope.memberIds };
    }
    return null;
}

function ensureDomainCacheForQuery(query, scopeInput = null) {
    const q = String(query || '').trim().toLowerCase();
    const treeKey = getDomainCacheKey();
    const groupLevel = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';
    const tagBrowseDetail = getActiveTagBrowseDetailForQuery(query);
    const tagBrowseDetailKey = tagBrowseDetail
        ? `${String(tagBrowseDetail.kind || '')}:${normalizeTagBrowseColor(tagBrowseDetail.color)}:${String(tagBrowseDetail.textLower || '').trim().toLowerCase()}`
        : '';
    const noteBrowseDetail = getActiveNoteBrowseDetailForQuery(query);
    const noteBrowseDetailKey = noteBrowseDetail
        ? `${String(noteBrowseDetail.kind || '')}:${normalizeNoteBrowseColor(noteBrowseDetail.color)}:${String(noteBrowseDetail.noteLower || '').trim().toLowerCase()}`
        : '';
    const scope = resolveDomainSearchScope(scopeInput);
    const scopeKey = scope ? scope.key : 'global';
    const cache = searchUiState.domainIndexCache;
    if (cache
        && cache.query === q
        && cache.treeKey === treeKey
        && cache.groupLevel === groupLevel
        && cache.scopeKey === scopeKey
        && cache.tagBrowseDetailKey === tagBrowseDetailKey
        && cache.noteBrowseDetailKey === noteBrowseDetailKey) return cache;

    const db = buildCanvasSearchDb();
    const items = Array.isArray(db.bookmarkIndex) ? db.bookmarkIndex : [];
    const map = new Map();

    for (const item of items) {
        if (!item || item.nodeType !== 'bookmark') continue;

        if (scope) {
            if (Array.isArray(scope.memberIds)) {
                const memberIds = scope.memberIds;
                if (item.source === 'temporary') {
                    if (!memberIds.includes(item.sectionId)) continue;
                } else if (item.source === 'permanent') {
                    if (!memberIds.some(id => 
                        id === 'permanentSection' || 
                        id.startsWith('permanent-section') || 
                        id.startsWith('permanentSection')
                    )) continue;
                } else {
                    continue;
                }
            } else {
                if (scope.kind === 'temp') {
                    if (!(item.source === 'temporary' && String(item.sectionId || '') === scope.id)) continue;
                } else if (scope.kind === 'permanent') {
                    if (item.source !== 'permanent') continue;
                } else if (scope.kind === 'blank') {
                    continue;
                }
            }
        } else {
            if (item.source !== 'permanent' && item.source !== 'temporary') continue;
        }

        const domain = getDomainGroupKey(item.url);
        if (!domain) continue;

        const host = extractBookmarkHost(item.url);

        let entry = map.get(domain);
        if (!entry) {
            entry = {
                domain,
                count: 0,
                items: [],
                match: false,
                hostSet: new Set(),
                matchedCount: 0,
                matchedHostSet: new Set()
            };
            map.set(domain, entry);
        }
        const itemMatched = isDomainSearchItemMatched(domain, item, q, tagBrowseDetail, noteBrowseDetail);

        entry.count += 1;
        entry.items.push({
            id: item.id,
            type: 'bookmark-item',
            title: item.title,
            url: item.url,
            nodeType: item.nodeType || 'bookmark',
            source: item.source || 'permanent',
            sectionId: item.sectionId || null,
            color: item.color || '#0ea5e9',
            host: host || '',
            tags: getCanvasBookmarkTagsForSearchCached(item),
            note: getCanvasBookmarkNoteForSearchCached(item),
            noteColor: getCanvasBookmarkNoteMetaForSearchCached(item).color,
            __title: item.__title || '',
            __url: item.__url || '',
            __path: item.__path || '',
            __note: item.__note || '',
            matched: !!itemMatched
        });
        if (host) {
            entry.hostSet.add(host);
        }

        if (itemMatched) {
            entry.match = true;
            entry.matchedCount += 1;
            if (host) {
                entry.matchedHostSet.add(host);
            }
        }
    }

    const useMatchedStats = !!q;
    const results = Array.from(map.values())
        .filter(entry => !q || entry.match)
        .map(entry => {
            const totalCount = Number(entry.count || 0);
            const totalSubdomainCount = entry.hostSet ? entry.hostSet.size : 0;
            const matchedCount = Number(entry.matchedCount || 0);
            const matchedSubdomainCount = entry.matchedHostSet ? entry.matchedHostSet.size : 0;
            return {
                id: `domain:${entry.domain}`,
                type: 'domain-group',
                domain: entry.domain,
                title: entry.domain,
                count: useMatchedStats ? matchedCount : totalCount,
                subdomainCount: useMatchedStats ? matchedSubdomainCount : totalSubdomainCount,
                totalCount,
                totalSubdomainCount,
                matchedCount,
                matchedSubdomainCount,
                statsMode: useMatchedStats ? 'matched' : 'total',
                groupLevel,
                color: '#0ea5e9'
            };
        });

    results.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.domain || '').localeCompare(String(b.domain || ''));
    });

    const nextCache = { query: q, treeKey, groupLevel, scopeKey, tagBrowseDetailKey, noteBrowseDetailKey, map, results };
    searchUiState.domainIndexCache = nextCache;
    return nextCache;
}

function getDomainResultsForQuery(query, scopeInput = null) {
    const cache = ensureDomainCacheForQuery(query, scopeInput);
    return Array.isArray(cache.results) ? cache.results : [];
}

function buildCanvasDomainDisplayResultsForQuery(query, scopeInput = null) {
    const cache = ensureDomainCacheForQuery(query, scopeInput);
    const parentResults = Array.isArray(cache.results) ? cache.results : [];
    const displayResults = [];
    const groupLevel = cache && cache.groupLevel === 'root' ? 'root' : 'host';
    const hasQuery = !!String(query || '').trim();

    for (const parent of parentResults) {
        if (!parent) continue;

        const domainKey = String(parent.domain || parent.title || '').trim().toLowerCase();
        const collapsed = isDomainGroupCollapsed(domainKey);
        const entry = cache.map instanceof Map ? cache.map.get(domainKey) : null;
        const parentTargetItems = entry && Array.isArray(entry.items)
            ? entry.items.filter((child) => !hasQuery || child.matched === true)
            : [];
        displayResults.push(Object.assign({}, parent, {
            isCollapsed: collapsed,
            isExpanded: !collapsed,
            targetItems: parentTargetItems,
            childItems: parentTargetItems
        }));

        if (collapsed) continue;

        const childItems = entry && Array.isArray(entry.items)
            ? entry.items.filter((child) => !hasQuery || child.matched === true).slice()
            : [];
        childItems.sort((a, b) => {
            if (groupLevel === 'root') {
                const hostDelta = String(a && a.host || '').localeCompare(String(b && b.host || ''));
                if (hostDelta !== 0) return hostDelta;
            }
            const titleDelta = String(a && a.title || a && a.url || '').localeCompare(String(b && b.title || b && b.url || ''));
            if (titleDelta !== 0) return titleDelta;
            return String(a && a.url || '').localeCompare(String(b && b.url || ''));
        });

        childItems.forEach((child) => {
            if (!child) return;
            displayResults.push({
                id: child.id,
                type: 'bookmark-item',
                nodeType: 'bookmark',
                title: child.title,
                url: child.url,
                source: child.source || 'permanent',
                sectionId: child.sectionId || null,
                color: child.color || parent.color || '#0ea5e9',
                isChild: true,
                domainChild: true,
                domain: domainKey,
                domainHost: child.host || '',
                tags: Array.isArray(child.tags) ? child.tags : [],
                note: normalizeNoteForSearch(child.note),
                noteColor: normalizeNoteColorForSearch(child.noteColor),
                __note: normalizeNoteForSearch(child.note).toLowerCase(),
                groupLevel
            });
        });
    }

    return displayResults;
}

function getDomainItemsForTemp(domain, query, scopeInput = null) {
    const cache = ensureDomainCacheForQuery(query, scopeInput);
    const key = String(domain || '').trim().toLowerCase();
    const entry = cache.map.get(key);
    if (!entry || !Array.isArray(entry.items)) return [];
    const hasQuery = !!String(query || '').trim();
    return entry.items.filter((item) => !hasQuery || item.matched === true);
}

function getSubdomainFolderTitle(host, domainKey, isZh) {
    const safeHost = String(host || '').trim().toLowerCase();
    const safeDomain = String(domainKey || '').trim().toLowerCase();
    if (!safeHost) return safeDomain || (isZh ? '未知域名' : 'Unknown host');
    if (safeDomain && safeHost === safeDomain) {
        return isZh ? `主域名 (${safeHost})` : `Root (${safeHost})`;
    }
    return safeHost;
}

async function buildDomainPayloadBySubdomain(items, domainKey, isZh) {
    const hostMap = new Map();
    let processed = 0;

    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;

        const safeTitle = item.title || item.url || (isZh ? '书签' : 'Bookmark');
        const safeUrl = item.url || 'https://';
        const host = extractBookmarkHost(safeUrl) || domainKey || '';
        const hostKey = String(host || '').trim().toLowerCase();
        if (!hostKey) continue;

        let entry = hostMap.get(hostKey);
        if (!entry) {
            entry = { host: hostKey, children: [] };
            hostMap.set(hostKey, entry);
        }

        entry.children.push(buildSearchBookmarkPayload({
            ...item,
            title: safeTitle,
            url: safeUrl
        }, isZh));

        processed += 1;
        if (processed % TEMP_SECTION_BUILD_YIELD_EVERY === 0) {
            await yieldToMainThread();
        }
    }

    const payloadItems = Array.from(hostMap.values())
        .sort((a, b) => {
            if (b.children.length !== a.children.length) return b.children.length - a.children.length;
            return String(a.host || '').localeCompare(String(b.host || ''));
        })
        .map(entry => ({
            title: getSubdomainFolderTitle(entry.host, domainKey, isZh),
            url: '',
            type: 'folder',
            children: entry.children
        }));

    return payloadItems;
}

/**
 * 渲染画布搜索结果
 */
function renderCanvasSearchResults(results, options = {}) {
    const panel = getSearchResultsPanel();
    if (!panel) return;

    try {
        if (typeof searchUiState === 'object' && searchUiState) {
            searchUiState.canvasSuggestionsVisible = false;
        }
        panel.dataset.panelType = 'results';
    } catch (_) { }

    // Isolation guard: avoid stale renders after switching view or clearing input.
    try {
        if (typeof window.currentView === 'string' && window.currentView !== 'canvas') return;
        const q = String(options.query || '').trim().toLowerCase();
        const input = document.getElementById('searchInput');
        const currentQ = (input && typeof input.value === 'string') ? input.value.trim().toLowerCase() : '';
        if (currentQ !== q) return;
    } catch (_) { }

    // Canvas Bookmark Mode: count + filter (bookmark vs folder vs domain)
    const isBookmarkMode = searchUiState.activeMode === 'bookmark';
    const isStructureMode = searchUiState.activeMode === 'structure';
    let bookmarkModeCounts = null;
    let structureModeCounts = null;
    const sourceResults = Array.isArray(results) ? results : [];
    let displayResults = sourceResults;
    let domainResults = [];
    let domainCount = 0;

    if (isBookmarkMode) {
        const countType = (nodeType) => (Array.isArray(sourceResults)
            ? sourceResults.filter(r => r && (r.type === 'bookmark-group' || r.type === 'bookmark-item') && r.nodeType === nodeType).length
            : 0);

        const bookmarkCount = countType('bookmark');
        const folderCount = countType('folder');
        try {
            const q = options.query || searchUiState.query || '';
            const scope = getActiveFullscreenSearchScopeForFiltering();
            domainResults = buildCanvasDomainDisplayResultsForQuery(q, scope);
            domainCount = getDomainResultsForQuery(q, scope).length;
        } catch (_) { }

        bookmarkModeCounts = { bookmarkCount, folderCount, domainCount };
        searchUiState.bookmarkModeCounts = bookmarkModeCounts;

        // Determine effective filter (auto fallback)
        let effectiveFilter = searchUiState.bookmarkTypeFilter;
        if (effectiveFilter === 'bookmark' && bookmarkCount === 0) effectiveFilter = null;
        if (effectiveFilter === 'folder' && folderCount === 0) effectiveFilter = null;
        if (effectiveFilter === 'domain' && domainCount === 0) effectiveFilter = null;
        if (!effectiveFilter) {
            if (bookmarkCount > 0) {
                effectiveFilter = 'bookmark';
            } else if (folderCount > 0) {
                effectiveFilter = 'folder';
            } else if (domainCount > 0) {
                effectiveFilter = 'domain';
            } else {
                effectiveFilter = null;
            }
        }
        searchUiState.bookmarkTypeFilter = effectiveFilter;

        // Apply filter only when we actually have a chosen filter
        if (effectiveFilter === 'bookmark') {
            displayResults = sourceResults.filter(r => !(r && r.nodeType === 'folder'));
        } else if (effectiveFilter === 'folder') {
            displayResults = sourceResults.filter(r => !(r && r.nodeType === 'bookmark'));
        } else if (effectiveFilter === 'domain') {
            displayResults = domainResults;
        }
    }

    if (isStructureMode) {
        const cardCount = sourceResults.filter(r => r && r.type !== 'group').length;
        const groupCount = sourceResults.filter(r => r && r.type === 'group').length;
        structureModeCounts = { cardCount, groupCount };

        let effectiveFilter = searchUiState.structureTypeFilter;
        if (effectiveFilter === 'card' && cardCount === 0) effectiveFilter = null;
        if (effectiveFilter === 'group' && groupCount === 0) effectiveFilter = null;
        if (!effectiveFilter) {
            if (cardCount > 0) {
                effectiveFilter = 'card';
            } else if (groupCount > 0) {
                effectiveFilter = 'group';
            } else {
                effectiveFilter = null;
            }
        }
        searchUiState.structureTypeFilter = effectiveFilter;

        if (effectiveFilter === 'card') {
            displayResults = sourceResults.filter(r => r && r.type !== 'group');
        } else if (effectiveFilter === 'group') {
            displayResults = sourceResults.filter(r => r && r.type === 'group');
        }
    }

    // [Tweak] Add style block for result item border
    // Ensure .search-result-item has stronger border
    if (!document.getElementById('search-result-tweaks')) {
        const style = document.createElement('style');
        style.id = 'search-result-tweaks';
        style.textContent = `
            .search-result-item { border-bottom: 1px solid rgba(128, 128, 128, 0.15) !important; }
            .search-result-item:last-child { border-bottom: none !important; }
        `;
        document.head.appendChild(style);
    }

    const renderQuery = String(options.query || '');
    const normalizedRenderQuery = normalizeTagBrowseRootQuery(renderQuery);
    const isTagBrowseQuery = isTagBrowseRootQuery(normalizedRenderQuery);
    const activeTagBrowseDetail = isTagBrowseQuery
        && searchUiState
        && searchUiState.tagBrowseDetail
        && searchUiState.tagBrowseDetail.active === true
        ? searchUiState.tagBrowseDetail
        : null;
    const isTagBrowseSecondary = !!activeTagBrowseDetail;
    const normalizedNoteRenderQuery = normalizeNoteBrowseRootQuery(renderQuery);
    const isNoteBrowseQuery = isNoteBrowseRootQuery(normalizedNoteRenderQuery);
    const activeNoteBrowseDetail = isNoteBrowseQuery
        && searchUiState
        && searchUiState.noteBrowseDetail
        && searchUiState.noteBrowseDetail.active === true
        ? searchUiState.noteBrowseDetail
        : null;
    const isNoteBrowseSecondary = !!activeNoteBrowseDetail;
    const isBrowseSecondary = isTagBrowseSecondary || isNoteBrowseSecondary;
    const renderBrowseDetailHeaderHtml = (extraClass = '') => {
        const isZhLocal = currentLang === 'zh_CN';
        const backLabel = isZhLocal ? '返回' : 'Back';
        if (isTagBrowseSecondary) {
            const detailColor = normalizeTagBrowseColor(activeTagBrowseDetail.color) || 'gray';
            const detailLabel = activeTagBrowseDetail.kind === 'color'
                ? getTagBrowseColorLabel(activeTagBrowseDetail.color, isZhLocal)
                : (String(activeTagBrowseDetail.text || '').trim() || getTagBrowseColorLabel(activeTagBrowseDetail.color, isZhLocal));
            return `<div class="canvas-tag-browse-detail-header${extraClass ? ` ${escapeHtml(extraClass)}` : ''}">
                <span class="canvas-tag-browse-detail-pill">
                    <span class="tag-dot tag-dot-${escapeHtml(detailColor)}"></span>
                    <span class="canvas-tag-browse-detail-pill-text">${escapeHtml(detailLabel)}</span>
                </span>
                <button type="button" class="canvas-tag-browse-back-btn" style="margin-left: auto;">${escapeHtml(backLabel)}</button>
            </div>`;
        }
        if (isNoteBrowseSecondary) {
            const detailColor = activeNoteBrowseDetail.kind === 'bucket' ? 'gray' : normalizeNoteBrowseColor(activeNoteBrowseDetail.color);
            const detailLabel = activeNoteBrowseDetail.kind === 'color'
                ? getNoteBrowseColorLabel(activeNoteBrowseDetail.color, isZhLocal)
                : (activeNoteBrowseDetail.kind === 'bucket'
                    ? activeNoteBrowseDetail.bucket
                    : (String(activeNoteBrowseDetail.note || '').trim() || getNoteBrowseColorLabel(activeNoteBrowseDetail.color, isZhLocal)));
            return `<div class="canvas-tag-browse-detail-header${extraClass ? ` ${escapeHtml(extraClass)}` : ''}">
                <span class="canvas-tag-browse-detail-pill">
                    <i class="fas fa-pencil-alt canvas-note-browse-detail-icon note-color-${escapeHtml(detailColor)}"></i>
                    <span class="canvas-tag-browse-detail-pill-text">${escapeHtml(getNoteBrowseLabel(detailLabel))}</span>
                </span>
                <button type="button" class="canvas-tag-browse-back-btn" style="margin-left: auto;">${escapeHtml(backLabel)}</button>
            </div>`;
        }
        return '';
    };
    const renderBrowseMatchIndicatorHtml = (item) => {
        if (!isBrowseSecondary || !item) return '';

        if (isTagBrowseSecondary) {
            const tags = getBookmarkResultTags(item);
            const matchedTag = tags.find((tag) => tagMatchesBrowseDetail(tag, activeTagBrowseDetail));
            if (!matchedTag) return '';

            const color = normalizeTagBrowseColor(matchedTag.color) || normalizeTagBrowseColor(activeTagBrowseDetail.color) || 'gray';
            const label = activeTagBrowseDetail.kind === 'color'
                ? getTagBrowseColorLabel(color, isZh)
                : (String(matchedTag.text || '').trim() || getTagBrowseColorLabel(color, isZh));
            const titleText = isZh ? `命中: ${label}` : `Matched: ${label}`;
            return `<div class="canvas-bookmark-browse-match-pill is-tag" title="${escapeHtml(titleText)}">
                <span class="tag-dot tag-dot-${escapeHtml(color)}"></span>
                <span class="canvas-bookmark-browse-match-text">${escapeHtml(label)}</span>
            </div>`;
        }

        if (isNoteBrowseSecondary) {
            const notes = getBookmarkResultNotes(item);
            const collator = getTagBrowseSortCollator(isZh);
            const matchedNote = notes.find((entry) => {
                if (!entry || !entry.note) return false;
                const color = normalizeNoteBrowseColor(entry.color);
                if (activeNoteBrowseDetail.kind === 'color') {
                    return color === normalizeNoteBrowseColor(activeNoteBrowseDetail.color);
                }
                if (activeNoteBrowseDetail.kind === 'bucket') {
                    return getNoteBrowseBucketKey(getNoteBrowseLabel(entry.note), collator) === activeNoteBrowseDetail.bucket;
                }
                const targetColor = normalizeNoteBrowseColor(activeNoteBrowseDetail.color);
                const targetNoteLower = String(activeNoteBrowseDetail.noteLower || '').trim().toLowerCase();
                return color === targetColor && (!targetNoteLower || String(entry.note || '').trim().toLowerCase() === targetNoteLower);
            });
            if (!matchedNote) return '';

            const color = activeNoteBrowseDetail.kind === 'bucket' ? normalizeNoteBrowseColor(matchedNote.color) : normalizeNoteBrowseColor(activeNoteBrowseDetail.color);
            if (activeNoteBrowseDetail.kind === 'color') {
                const colorLabel = getNoteBrowseColorLabel(color, isZh);
                const titleText = isZh ? `命中: ${colorLabel}` : `Matched: ${colorLabel}`;
                return `<div class="canvas-bookmark-browse-match-pill is-note" title="${escapeHtml(titleText)}">
                    <i class="fas fa-pencil-alt canvas-note-browse-icon note-color-${escapeHtml(color)}"></i>
                    <span class="canvas-bookmark-browse-match-text">${escapeHtml(colorLabel)}</span>
                </div>`;
            }

            const label = getNoteBrowseLabel(matchedNote.note);
            const renderNoteBrowseMatchedText = () => {
                if (!label) return '';
                if (activeNoteBrowseDetail.kind === 'bucket') {
                    const firstChar = label.charAt(0);
                    if (!firstChar) return escapeHtml(label);
                    return `<mark>${escapeHtml(firstChar)}</mark>${escapeHtml(label.slice(firstChar.length))}`;
                }
                if (activeNoteBrowseDetail.kind === 'note') {
                    const needle = getNoteBrowseLabel(activeNoteBrowseDetail.note || '');
                    return needle ? generateSearchSnippet(label, needle) : escapeHtml(label);
                }
                return escapeHtml(label);
            };
            const titleText = isZh ? `命中: ${label}` : `Matched: ${label}`;
            const bucketMatchClass = activeNoteBrowseDetail.kind === 'bucket' ? ' is-note-browse-bucket-match-snippet' : '';
            return `<div class="search-result-note-snippet is-note-match-snippet${bucketMatchClass} note-color-${escapeHtml(color)}" data-note-color="${escapeHtml(color)}" title="${escapeHtml(titleText)}">
                <i class="fas fa-pencil-alt"></i>
                <span class="search-result-note-text">${renderNoteBrowseMatchedText()}</span>
            </div>`;
        }

        return '';
    };
    const renderDetailsPreviewContextHtml = (item, preview, detailsExpanded) => {
        const browseMatchHtml = renderBrowseMatchIndicatorHtml(item);
        if (browseMatchHtml) {
            return `<div class="search-result-details-preview-context is-single-line canvas-bookmark-browse-match-context" style="display: ${detailsExpanded ? 'none' : 'flex'};">${browseMatchHtml}</div>`;
        }
        return preview && preview.html
            ? `<div class="search-result-details-preview-context ${preview.count === 1 ? 'is-single-line' : ''}" style="display: ${detailsExpanded ? 'none' : 'flex'};">${preview.html}</div>`
            : '';
    };
    const pageSize = Math.max(
        SEARCH_RESULT_MIN_PAGE_SIZE,
        Number(searchUiState.resultPageSize) || SEARCH_RESULT_MIN_PAGE_SIZE
    );
    const pagingKey = [
        String(searchUiState.activeMode || ''),
        renderQuery.trim().toLowerCase(),
        String(searchUiState.bookmarkTypeFilter || ''),
        String(searchUiState.structureTypeFilter || ''),
        String(searchUiState.domainGrouping || '')
    ].join('|');
    const appendPage = options && options.append === true;
    const prevVisibleCount = Number(searchUiState.resultVisibleCount || 0);
    const nextVisibleCount = appendPage && searchUiState.resultPagingKey === pagingKey
        ? Math.min(displayResults.length, prevVisibleCount + pageSize)
        : Math.min(displayResults.length, pageSize);
    const visibleResults = displayResults.slice(0, nextVisibleCount);
    const hasMoreResults = nextVisibleCount < displayResults.length;

    searchUiState.view = 'canvas';
    searchUiState.query = renderQuery;
    searchUiState.resultSource = sourceResults;
    searchUiState.resultAll = displayResults;
    searchUiState.resultPagingKey = pagingKey;
    searchUiState.resultVisibleCount = nextVisibleCount;
    searchUiState.resultHasMore = hasMoreResults;
    searchUiState.results = visibleResults;
    if (typeof options.selectedIndex === 'number' && Number.isFinite(options.selectedIndex)) {
        const maxIdx = visibleResults.length - 1;
        searchUiState.selectedIndex = maxIdx >= 0 ? Math.max(0, Math.min(maxIdx, options.selectedIndex)) : -1;
    } else if (appendPage) {
        const maxIdx = visibleResults.length - 1;
        const currentIdx = Number(searchUiState.selectedIndex);
        searchUiState.selectedIndex = maxIdx >= 0
            ? Math.max(0, Math.min(maxIdx, Number.isFinite(currentIdx) ? currentIdx : 0))
            : -1;
    } else {
        searchUiState.selectedIndex = visibleResults.length > 0 ? 0 : -1;
    }

    if (visibleResults.length === 0) {
        // [Modified] Customize empty message for Bookmark mode
        let msg = options.emptyText || (i18n.searchNoResults ? i18n.searchNoResults[currentLang] : '无结果');
        if (searchUiState.activeMode === 'bookmark') {
            // If we have no bookmarks indexed (maybe tree not loaded), prompt user?
            // Or just standard no results.
            // msg = "No bookmark matches found"; 
        }
        if (isBrowseSecondary) {
            panel.innerHTML = `
                ${renderBrowseDetailHeaderHtml('canvas-tag-browse-detail-header-empty')}
                <div class="search-result-empty">${msg}</div>
            `;
        } else {
            panel.innerHTML = `<div class="search-result-empty">${msg}</div>`;
        }
        showSearchResultsPanel();
        return;
    }

    const isZh = currentLang === 'zh_CN';
    let html = '';

    const toAlpha = (num) => {
        if (!Number.isFinite(num) || num <= 0) return '';
        let s = '';
        while (num > 0) {
            const rem = (num - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            num = Math.floor((num - 1) / 26);
        }
        return s;
    };

    const queryText = String(searchUiState.query || '');
    const normalizedDetailsQuery = queryText.trim().toLowerCase();
    const isTagDetailsQuery = normalizedDetailsQuery.startsWith('#');
    const isNoteDetailsQuery = isCanvasNoteSearchQuery(normalizedDetailsQuery);
    const isPlainBookmarkDetailsQuery = !!normalizedDetailsQuery && !isTagDetailsQuery && !isNoteDetailsQuery;
    const fullscreenScope = getCanvasFullscreenSearchScope();
    const disableLocationJumpBadges = false;
    const compactBookmarkToolbar = Boolean(fullscreenScope);
    const markQueryInText = (text) => {
        let safe = escapeHtml(String(text || ''));
        if (!queryText) return safe;
        try {
            const isBookmarkOrDesc = searchUiState.activeMode === 'bookmark' || searchUiState.activeMode === 'description';
            if (isBookmarkOrDesc) {
                const tokens = queryText.split(/\s+/).map(s => s.trim()).filter(Boolean);
                if (!tokens.length) return safe;
                // Sort descending by length to avoid sub-token matching inside other tokens before they are fully matched
                tokens.sort((a, b) => b.length - a.length);
                tokens.forEach((token) => {
                    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const re = new RegExp(`(${escapedToken})(?![^<>]*>)`, 'gi');
                    safe = safe.replace(re, '<mark>$1</mark>');
                });
                return safe;
            } else {
                const escapedQuery = queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re = new RegExp(`(${escapedQuery})`, 'gi');
                return safe.replace(re, '<mark>$1</mark>');
            }
        } catch (_) {
            return safe;
        }
    };
    const parsePathParts = (pathText) => {
        const raw = String(pathText || '').trim();
        if (!raw) return [];
        return raw.split('>').map((part) => String(part || '').trim()).filter(Boolean);
    };
    const getPlainPathMatchTokens = () => {
        if (!isPlainBookmarkDetailsQuery) return [];
        return queryText.split(/\s+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    };
    const renderMatchedPathLevelPreview = (pathText) => {
        const parts = parsePathParts(pathText);
        const tokens = getPlainPathMatchTokens();
        if (!parts.length || !tokens.length) return '';
        const matchIndex = parts.findIndex((part) => {
            const lower = String(part || '').toLowerCase();
            return tokens.some((token) => lower.includes(token));
        });
        if (matchIndex < 0) return '';
        const prefix = matchIndex > 0
            ? `<button class="search-result-path-ellipsis-toggle" type="button" title="${escapeHtml(isZh ? '展开完整路径' : 'Show full path')}" aria-label="${escapeHtml(isZh ? '展开完整路径' : 'Show full path')}">...</button><span class="search-result-path-sep"> &gt; </span>`
            : '';
        const suffix = matchIndex < parts.length - 1
            ? `<span class="search-result-path-sep"> &gt; </span><button class="search-result-path-ellipsis-toggle" type="button" title="${escapeHtml(isZh ? '展开完整路径' : 'Show full path')}" aria-label="${escapeHtml(isZh ? '展开完整路径' : 'Show full path')}">...</button>`
            : '';
        return `${prefix}<span class="search-result-path-part">${markQueryInText(parts[matchIndex])}</span>${suffix}`;
    };
    const renderPathTextWithFolderUnderline = (pathText, options = {}) => {
        const raw = String(pathText || '').trim();
        if (!raw) return '';
        if (!(options && options.forceFull === true)) {
            const matchedPreview = renderMatchedPathLevelPreview(raw);
            if (matchedPreview) return matchedPreview;
        }
        const parts = parsePathParts(raw);
        if (!parts.length) return escapeHtml(raw);
        return parts.map((part, index) => {
            const safePart = `<span class="search-result-path-part">${markQueryInText(part)}</span>`;
            if (index >= parts.length - 1) return safePart;
            return `${safePart}<span class="search-result-path-sep"> &gt; </span>`;
        }).join('');
    };
    const renderPathListWithFolderUnderline = (paths, rootLabel, options = {}) => {
        const list = Array.isArray(paths) ? paths : [];
        const normalized = list.length
            ? list.map((p) => String(p || '').trim()).filter((p) => p !== '')
            : [];
        if (!normalized.length) return `<span class="search-result-path-part">${escapeHtml(rootLabel)}</span>`;
        return normalized.map((path, idx) => {
            const safe = renderPathTextWithFolderUnderline(path, options);
            if (idx >= normalized.length - 1) return safe;
            return `${safe}<span class="search-result-path-list-sep"> ｜ </span>`;
        }).join('');
    };
    const renderCollapsedPathListWithTailPreview = (paths, rootLabel, maxDepth = 3) => {
        const list = Array.isArray(paths) ? paths : [];
        const normalized = list.length
            ? list.map((p) => String(p || '').trim()).filter((p) => p !== '')
            : [];
        if (!normalized.length) {
            return {
                html: `<span class="search-result-path-part">${escapeHtml(rootLabel)}</span>`,
                hasTruncated: false
            };
        }

        const hasMultiplePath = normalized.length > 1;
        const primaryPath = normalized[0];
        const ellipsisTitle = isZh ? '展开完整路径' : 'Show full path';
        const matchedPreview = renderMatchedPathLevelPreview(primaryPath);
        if (matchedPreview) {
            return {
                html: matchedPreview,
                hasTruncated: hasMultiplePath || matchedPreview.includes('search-result-path-ellipsis')
            };
        }
        const parts = parsePathParts(primaryPath);
        if (!parts.length) {
            return {
                html: `<span class="search-result-path-part">${escapeHtml(rootLabel)}</span>`,
                hasTruncated: hasMultiplePath
            };
        }

        const isPathDeep = parts.length > maxDepth;
        const needsEllipsis = isPathDeep || hasMultiplePath;
        const visibleParts = isPathDeep ? parts.slice(parts.length - maxDepth) : parts;
        const visibleHtml = visibleParts.map((part, partIdx) => {
            const safePart = `<span class="search-result-path-part">${markQueryInText(part)}</span>`;
            if (partIdx >= visibleParts.length - 1) return safePart;
            return `${safePart}<span class="search-result-path-sep"> &gt; </span>`;
        }).join('');

            const ellipsisHtml = needsEllipsis
            ? `<button class="search-result-path-ellipsis-toggle" type="button" title="${escapeHtml(ellipsisTitle)}" aria-label="${escapeHtml(ellipsisTitle)}">...</button><span class="search-result-path-sep"> &gt; </span>`
            : '';

        return {
            html: `${ellipsisHtml}${visibleHtml}`,
            hasTruncated: needsEllipsis
        };
    };
    const renderPathHintWithTailPreview = (paths, rootLabel, pathHintTypeClass) => {
        const collapsed = renderCollapsedPathListWithTailPreview(paths, rootLabel, 3);
        if (!collapsed.hasTruncated) {
            return `<div class="search-result-path-hint ${pathHintTypeClass}"><span class="search-result-path-text">${collapsed.html}</span></div>`;
        }

        const fullHtml = renderPathListWithFolderUnderline(paths, rootLabel, { forceFull: true });
        return `<div class="search-result-path-hint ${pathHintTypeClass}" data-path-expandable="true">
            <span class="search-result-path-text">
                <span class="search-result-path-preview">${collapsed.html}</span>
                <span class="search-result-path-full">${fullHtml}</span>
            </span>
        </div>`;
    };
    const renderExternalLinkHtml = (url, extraClass = '') => {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) return '';
        const className = ['search-result-external-link', extraClass].filter(Boolean).join(' ');
        return `<a class="${className}" href="${escapeHtml(safeUrl)}" data-search-url="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${markQueryInText(safeUrl)}</a>`;
    };
    const getBookmarkResultTags = (item) => {
        const result = [];
        const seen = new Set();
        const addTags = (tags) => {
            (Array.isArray(tags) ? tags : []).forEach((tag) => {
                if (!tag || !tag.color) return;
                const color = String(tag.color || '').trim().toLowerCase();
                const text = String(tag.text || '').trim();
                const key = `${color}::${text.toLowerCase()}`;
                if (seen.has(key)) return;
                seen.add(key);
                result.push({ color, text });
            });
        };
        if (item && (item.type === 'bookmark-group' || item.type === 'domain-group')) {
            const children = Array.isArray(item.targetItems) ? item.targetItems : [];
            children.forEach((child) => addTags(getCanvasBookmarkTagsForSearchCached(child)));
        } else {
            addTags(getCanvasBookmarkTagsForSearchCached(item));
        }
        return result;
    };
    const renderBookmarkResultTagMarkers = (item) => {
        if (!item || (item.type !== 'bookmark-group' && item.type !== 'bookmark-item' && item.type !== 'domain-group')) return '';
        const tags = getBookmarkResultTags(item);
        if (!tags.length) return '';
        const safeColorClass = (color) => {
            const c = String(color || '').trim().toLowerCase();
            return Object.prototype.hasOwnProperty.call(TAG_SEARCH_COLOR_ALIASES, c) ? c : 'gray';
        };
        const tagTitle = tags.map((tag) => tag.text || tag.color).filter(Boolean).join(', ');
        if (tags.length > 5) {
            const visible = tags.slice(0, 5).map((tag) =>
                `<span class="tag-dot tag-dot-${safeColorClass(tag.color)}" title="${escapeHtml(tag.text || tag.color)}"></span>`
            ).join('');
            return `<div class="search-result-tag-strip search-result-tag-strip-compact" title="${escapeHtml(tagTitle)}">${visible}<span class="search-result-tag-more">…+${tags.length - 5}</span></div>`;
        }
        const chips = tags.map((tag) => {
            const label = tag.text || tag.color;
            let highlightedLabel = escapeHtml(label);
            if (isTagDetailsQuery) {
                const tokens = queryText.split(/\s+/).map(s => {
                    let t = s.trim();
                    if (t.startsWith('#')) {
                        t = t.slice(1);
                        if (t.startsWith('/')) t = t.slice(1);
                    }
                    return t;
                }).filter(Boolean);
                
                if (tokens.length > 0) {
                    tokens.sort((a, b) => b.length - a.length);
                    let safe = escapeHtml(label);
                    tokens.forEach((token) => {
                        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const re = new RegExp(`(${escapedToken})(?![^<>]*>)`, 'gi');
                        safe = safe.replace(re, '<mark>$1</mark>');
                    });
                    highlightedLabel = safe;
                }
            }
            return `<span class="search-result-tag-chip" title="${escapeHtml(label)}"><span class="tag-dot tag-dot-${safeColorClass(tag.color)}"></span><span class="search-result-tag-chip-text">${highlightedLabel}</span></span>`;
        }).join('');
        return `<div class="search-result-tag-strip" title="${escapeHtml(tagTitle)}">${chips}</div>`;
    };
    const getBookmarkResultNotes = (item) => {
        const result = [];
        const seen = new Set();
        const addNote = (noteInput, colorInput) => {
            const note = normalizeNoteForSearch(noteInput);
            if (!note) return;
            const key = note.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            result.push({
                note,
                color: normalizeNoteColorForSearch(colorInput)
            });
        };
        if (item && (item.type === 'bookmark-group' || item.type === 'domain-group')) {
            const children = Array.isArray(item.targetItems) ? item.targetItems : [];
            children.forEach((child) => {
                const meta = getCanvasBookmarkNoteMetaForSearchCached(child);
                addNote(meta.note, meta.color);
            });
        } else {
            const meta = getCanvasBookmarkNoteMetaForSearchCached(item);
            addNote(meta.note, meta.color);
        }
        return result;
    };
    const renderBookmarkResultNoteMarker = (item) => {
        return '';
    };
    const renderBookmarkResultNoteSnippet = (item) => {
        const notes = getBookmarkResultNotes(item);
        if (!notes.length) return '';
        let first = notes[0];
        const note = first.note;
        const needle = getCanvasNoteSearchNeedle(queryText);
        let snippet = needle ? generateSearchSnippet(note, needle) : escapeHtml(note);
        let matchClass = needle ? ' is-note-match-snippet' : '';

        if (isNoteBrowseSecondary && activeNoteBrowseDetail && activeNoteBrowseDetail.kind !== 'color') {
            const collator = getTagBrowseSortCollator(isZh);
            const matchedNote = notes.find((entry) => {
                if (!entry || !entry.note) return false;
                if (activeNoteBrowseDetail.kind === 'bucket') {
                    return getNoteBrowseBucketKey(getNoteBrowseLabel(entry.note), collator) === activeNoteBrowseDetail.bucket;
                }
                const color = normalizeNoteBrowseColor(entry.color);
                const targetColor = normalizeNoteBrowseColor(activeNoteBrowseDetail.color);
                const targetNoteLower = String(activeNoteBrowseDetail.noteLower || '').trim().toLowerCase();
                return color === targetColor && (!targetNoteLower || String(entry.note || '').trim().toLowerCase() === targetNoteLower);
            });
            if (matchedNote) {
                first = matchedNote;
                const matchedText = getNoteBrowseLabel(matchedNote.note);
                if (activeNoteBrowseDetail.kind === 'bucket') {
                    const firstChar = matchedText.charAt(0);
                    snippet = firstChar
                        ? `<mark>${escapeHtml(firstChar)}</mark>${escapeHtml(matchedText.slice(firstChar.length))}`
                        : escapeHtml(matchedText);
                } else {
                    const detailNeedle = getNoteBrowseLabel(activeNoteBrowseDetail.note || '');
                    snippet = detailNeedle ? generateSearchSnippet(matchedText, detailNeedle) : escapeHtml(matchedText);
                }
                matchClass = ' is-note-match-snippet';
                if (activeNoteBrowseDetail.kind === 'bucket') {
                    matchClass += ' is-note-browse-bucket-match-snippet';
                }
            }
        }

        const more = notes.length > 1 ? `<span class="search-result-note-more">+${notes.length - 1}</span>` : '';
        return `<div class="search-result-note-snippet${matchClass} note-color-${escapeHtml(first.color)}" data-note-color="${escapeHtml(first.color)}"><i class="fas fa-pencil-alt"></i><span class="search-result-note-text">${snippet}</span>${more}</div>`;
    };
    const getPermanentCopyLabelForBookmarkSearch = (copyId) => {
        const safeCopyId = String(copyId || '').trim();
        if (!safeCopyId) return '#A';
        try {
            const copies = getPermanentCopyShellsForSearch();
            const copyIndex = copies.findIndex((copy) => String(copy && copy.copyId || '').trim() === safeCopyId);
            if (copyIndex >= 0) {
                const displayIndex = getPermanentCopySearchDisplayIndex(copies[copyIndex], copyIndex);
                const alpha = toAlpha(displayIndex);
                if (alpha) return `#${alpha}`;
            }
        } catch (_) { }
        return '#?';
    };
    const renderBookmarkLocationInlineChip = (contentHtml, color, titleText = '') => {
        const rawColor = String(color || '#2563eb').trim() || '#2563eb';
        const safeColor = escapeHtml(rawColor);
        const safeTitle = String(titleText || contentHtml || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return `<span class="search-loc-chip search-loc-chip-disabled canvas-bookmark-location-chip canvas-bookmark-location-chip-compact canvas-bookmark-location-chip-static" data-search-nav-disabled="true" aria-disabled="true" style="cursor:default; --loc-color:${safeColor}; border-color:${safeColor}; color:${safeColor}; background:${safeColor}18;" title="${escapeHtml(safeTitle)}"><span class="canvas-bookmark-location-chip-text">${contentHtml}</span></span>`;
    };
    const renderBookmarkChildSourceHtml = (child) => {
        if (!child) return '';
        if (child.source === 'temporary') {
            const color = String(child.color || '#2563eb').trim() || '#2563eb';
            const sectionLabel = String(child.sectionLabel || '').trim();
            const sectionTitle = String(child.sectionTitle || '').trim();
            const shouldShowTitle = !!sectionTitle && (!sectionLabel || sectionTitle.toLowerCase() !== sectionLabel.toLowerCase());
            let chipContent = '';
            if (sectionLabel && shouldShowTitle) {
                chipContent = `<b>${escapeHtml(sectionLabel)}</b> <span style="opacity:0.8; margin-left:3px;">${escapeHtml(sectionTitle)}</span>`;
            } else if (sectionLabel) {
                chipContent = `<b>${escapeHtml(sectionLabel)}</b>`;
            } else if (sectionTitle) {
                chipContent = escapeHtml(sectionTitle);
            } else {
                chipContent = escapeHtml(isZh ? '临时栏目' : 'Temporary');
            }
            const chipTitle = [sectionLabel, sectionTitle].filter(Boolean).join(' ');
            return `<div class="canvas-bookmark-location-row canvas-bookmark-location-row-temp canvas-bookmark-location-row-compact canvas-bookmark-group-child-source">
                <span class="canvas-bookmark-location-label">${isZh ? '临时栏目' : 'Temporary'}:</span>
                <div class="canvas-bookmark-location-chip-row">${renderBookmarkLocationInlineChip(chipContent, color, chipTitle)}</div>
            </div>`;
        }

        const copyLabel = getPermanentCopyLabelForBookmarkSearch(child.copyId || null);
        return `<div class="canvas-bookmark-location-row canvas-bookmark-location-row-permanent canvas-bookmark-location-row-compact canvas-bookmark-group-child-source">
            <span class="canvas-bookmark-location-label">${isZh ? '永久栏目' : 'Permanent'}:</span>
            <div class="canvas-bookmark-location-chip-row">${renderBookmarkLocationInlineChip(escapeHtml(copyLabel), '#059669', copyLabel)}</div>
        </div>`;
    };
    const renderBookmarkChildIconHtml = (child) => {
        const iconWrapStyle = 'display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; flex-shrink:0;';
        if (child && child.nodeType === 'folder') {
            return `<span class="search-result-icon-box-inline" style="${iconWrapStyle}">
                <i class="fas fa-folder" style="color:#2563eb; font-size:11px;"></i>
            </span>`;
        }
        const fallbackHtml = `<span class="search-result-icon-box-inline" style="${iconWrapStyle}">
            <i class="fas fa-bookmark" style="color:#f59e0b; font-size:11px;"></i>
        </span>`;
        const url = String(child && child.url || '').trim();
        if (!url || typeof getFaviconUrl !== 'function') return fallbackHtml;
        const faviconSrc = getFaviconUrl(url);
        if (faviconSrc && !String(faviconSrc).startsWith('data:image/svg+xml')) {
            return `<img class="search-result-favicon canvas-bookmark-group-child-favicon" src="${escapeHtml(faviconSrc)}" data-bookmark-url="${escapeHtml(url)}" alt="" style="width:13px; height:13px; max-width:13px; max-height:13px; object-fit:contain; border-radius:3px;">`;
        }
        return `${fallbackHtml}<img class="search-result-favicon canvas-bookmark-group-child-favicon" src="${escapeHtml(faviconSrc || '')}" data-bookmark-url="${escapeHtml(url)}" alt="" style="display:none; width:13px; height:13px; max-width:13px; max-height:13px; object-fit:contain; border-radius:3px;">`;
    };
    const isBookmarkGroupExpanded = (groupId) => {
        if (!groupId) return false;
        if (!(searchUiState.bookmarkGroupCollapse instanceof Map)) {
            searchUiState.bookmarkGroupCollapse = new Map();
        }
        const collapsed = searchUiState.bookmarkGroupCollapse.get(groupId);
        return collapsed === false;
    };
    const isBookmarkDetailsExpanded = (itemId) => {
        if (!itemId) return false;
        if (!(searchUiState.bookmarkDetailsExpanded instanceof Set)) {
            searchUiState.bookmarkDetailsExpanded = new Set();
        }
        return searchUiState.bookmarkDetailsExpanded.has(String(itemId));
    };
    const buildMatchedDetailsPreviewHtml = (entries) => {
        const lines = (Array.isArray(entries) ? entries : [])
            .filter((entry) => entry && entry.matched && entry.html)
            .map((entry) => `<div class="search-result-details-preview-line">${entry.html}</div>`);
        return {
            html: lines.join(''),
            count: lines.length
        };
    };
    const renderBookmarkGroupChildRow = (child, groupItem, childIndex) => {
        if (!child) return '';
        const groupId = String(groupItem && groupItem.id || '').trim();
        const childKey = String(child.locationKey || getCanvasBookmarkLocationKeyForSearch(child));
        const titleHtml = markQueryInText(child.title || (isZh ? '（无标题）' : '(Untitled)'));
        const rootLabel = isZh ? '根目录' : 'Root';
        const parentPath = getBookmarkItemParentPathForSearchScope(child, fullscreenScope);
        const pathList = parentPath ? [parentPath] : [];
        const pathHintTypeClass = child.nodeType === 'folder' ? 'is-folder' : 'is-bookmark';
        const pathHtml = renderPathHintWithTailPreview(pathList, rootLabel, pathHintTypeClass);
        const urlHtml = child.url
            ? `<div class="search-result-link-row">${renderExternalLinkHtml(child.url)}</div>`
            : '';
        const sourceHtml = renderBookmarkChildSourceHtml(child);
        const childTagMarkersHtml = renderBookmarkResultTagMarkers(child);
        const childNoteMarkerHtml = renderBookmarkResultNoteMarker(child);
        const childNoteSnippetHtml = renderBookmarkResultNoteSnippet(child);

        const detailsExpanded = isBookmarkDetailsExpanded(childKey);

        const hasPathMatch = isPlainBookmarkDetailsQuery && pathHtml && pathHtml.includes('<mark>');
        const hasUrlMatch = isPlainBookmarkDetailsQuery && urlHtml && urlHtml.includes('<mark>');
        const hasTagMatch = isTagDetailsQuery && childTagMarkersHtml && childTagMarkersHtml.includes('<mark>');
        const hasNoteMatch = isNoteDetailsQuery && childNoteSnippetHtml && childNoteSnippetHtml.includes('<mark>');
        
        const preview = buildMatchedDetailsPreviewHtml([
            { matched: hasPathMatch, html: pathHtml },
            { matched: hasUrlMatch, html: urlHtml },
            { matched: hasTagMatch, html: childTagMarkersHtml ? `<div class="canvas-bookmark-child-tags-row" style="margin-top:3px;">${childTagMarkersHtml}</div>` : '' },
            { matched: hasNoteMatch, html: childNoteSnippetHtml }
        ]);

        const previewContextHtml = renderDetailsPreviewContextHtml(child, preview, detailsExpanded);

        const infoToggleHtml = `
            <div class="canvas-bookmark-details-row">
                <button class="canvas-bookmark-details-toggle" type="button" data-item-id="${escapeHtml(String(childKey))}" aria-expanded="${detailsExpanded ? 'true' : 'false'}" title="${escapeHtml(isZh ? (detailsExpanded ? '收起信息' : '展开信息') : (detailsExpanded ? 'Collapse info' : 'Expand info'))}">
                    <i class="fas ${detailsExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                    <span>${isZh ? '信息' : 'Info'}</span>
                </button>
                ${previewContextHtml}
            </div>
        `;

        const childTagsHtml = childTagMarkersHtml ? `<div class="canvas-bookmark-child-tags-row" style="margin-top:3px;">${childTagMarkersHtml}</div>` : '';
        
        let childDetailsContentHtml = '';
        childDetailsContentHtml += pathHtml;
        childDetailsContentHtml += urlHtml;
        if (childTagsHtml) childDetailsContentHtml += childTagsHtml;
        if (childNoteSnippetHtml) childDetailsContentHtml += childNoteSnippetHtml;

        const detailsHtml = `
            <div class="canvas-bookmark-details-collapsible" style="display: ${detailsExpanded ? 'flex' : 'none'}; flex-direction: column; width: 100%; min-width: 0; margin-top: 4px; gap: 4px;">
                ${childDetailsContentHtml}
            </div>
        `;

        return `
            <div class="canvas-bookmark-group-child-item ${child.nodeType === 'folder' ? 'is-folder' : 'is-bookmark'}" role="button" tabindex="0"
                data-bookmark-group-id="${escapeHtml(groupId)}"
                data-bookmark-child-id="${escapeHtml(child.id || '')}"
                data-bookmark-child-key="${escapeHtml(childKey)}">
                <div class="canvas-bookmark-group-child-topline">
                    <span class="canvas-bookmark-group-child-index">${childIndex + 1}</span>
                    ${renderBookmarkChildIconHtml(child)}
                    <span class="canvas-bookmark-group-child-title">${titleHtml}</span>
                    ${childNoteMarkerHtml ? `<span class="canvas-bookmark-group-child-note">${childNoteMarkerHtml}</span>` : ''}
                </div>
                <div class="canvas-bookmark-group-child-meta">
                    ${sourceHtml}
                    ${infoToggleHtml}
                    ${detailsHtml}
                </div>
            </div>
        `;
    };
    const renderBookmarkGroupChildren = (groupItem) => {
        const targetItems = Array.isArray(groupItem && groupItem.targetItems) ? groupItem.targetItems : [];
        if (targetItems.length <= 1) return '';
        const groupId = String(groupItem && groupItem.id || '').trim();
        if (!groupId) return '';
        const isExpanded = isBookmarkGroupExpanded(groupId);
        
        let childRowsHtml = '';
        if (isExpanded) {
            if (!(searchUiState.bookmarkGroupVisibleCount instanceof Map)) {
                searchUiState.bookmarkGroupVisibleCount = new Map();
            }
            const visibleLimit = searchUiState.bookmarkGroupVisibleCount.get(groupId) || 10;
            const sliced = targetItems.slice(0, visibleLimit);
            childRowsHtml = sliced.map((child, childIndex) => renderBookmarkGroupChildRow(child, groupItem, childIndex)).join('');
            
            if (targetItems.length > visibleLimit) {
                const remain = targetItems.length - visibleLimit;
                const loadMoreLabel = isZh
                    ? `展开剩余 ${remain} 条`
                    : `Show ${remain} more`;
                childRowsHtml += `
                    <div class="canvas-bookmark-group-load-more-row" style="padding: 6px 12px; display: flex; justify-content: center;">
                        <button type="button" class="canvas-bookmark-group-load-more-btn" data-bookmark-group-id="${escapeHtml(groupId)}" style="border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-secondary); padding:4px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px;">
                            <i class="fas fa-chevron-down" style="font-size:9px;"></i>
                            <span>${escapeHtml(loadMoreLabel)}</span>
                        </button>
                    </div>
                `;
            }
        }

        return `
            <div class="canvas-bookmark-group-children" data-bookmark-group-id="${escapeHtml(groupId)}" ${isExpanded ? '' : 'hidden'}>
                ${childRowsHtml}
            </div>
        `;
    };

    // Canvas Bookmark Mode: render a top toggle row (counts + click to switch)
    if (isBookmarkMode && bookmarkModeCounts) {
        const { bookmarkCount, folderCount, domainCount } = bookmarkModeCounts;
        const active = searchUiState.bookmarkTypeFilter;

        const showBookmarkBtn = bookmarkCount > 0;
        const showFolderBtn = folderCount > 0;
        const showDomainBtn = domainCount > 0;

        if (showBookmarkBtn || showFolderBtn || showDomainBtn) {
            const isZh = currentLang === 'zh_CN';
            if (isBrowseSecondary) {
                html += renderBrowseDetailHeaderHtml();
            }
            const makeBtn = ({ type, icon, color, count, isActiveOverride = null }) => {
                const isActive = (typeof isActiveOverride === 'boolean') ? isActiveOverride : active === type;
                const bg = isActive ? `${color}22` : 'transparent';
                const border = isActive ? `${color}55` : 'rgba(128, 128, 128, 0.28)';
                const text = isActive ? color : 'var(--text-secondary)';
                const gapPx = compactBookmarkToolbar ? 5 : 6;
                const paddingValue = compactBookmarkToolbar ? '5px 8px' : '6px 10px';
                const radiusValue = compactBookmarkToolbar ? '7px' : '8px';
                const fontSizeValue = compactBookmarkToolbar ? '11px' : '12px';
                return `<button class="canvas-bookmark-type-btn${compactBookmarkToolbar ? ' canvas-bookmark-type-btn-compact' : ''}" data-type="${type}" style="display:inline-flex; align-items:center; gap:${gapPx}px; padding:${paddingValue}; border-radius:${radiusValue}; border:1px solid ${border}; background:${bg}; color:${text}; font-size:${fontSizeValue}; font-weight:600; cursor:pointer;">
                        <i class="fas ${icon}" style="color:${color};"></i>
                        <span>${count}</span>
                    </button>`;
            };

            const bookmarkBtn = showBookmarkBtn
                ? makeBtn({ type: 'bookmark', icon: 'fa-bookmark', color: '#f59e0b', count: bookmarkCount })
                : '';
            const folderBtn = showFolderBtn
                ? makeBtn({ type: 'folder', icon: 'fa-folder', color: '#2563eb', count: folderCount })
                : '';
            const domainGrouping = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';
            const subdomainLabel = isZh ? '子域名' : 'Subdomain';
            const domainGroupingTitle = isZh
                ? '域名粒度：点击切换 主域名 / 子域名'
                : 'Domain granularity: click to toggle root/subdomain';
            const subActive = active === 'domain' && domainGrouping === 'host';
            const rootActive = active === 'domain' && domainGrouping === 'root';
            const domainBtn = showDomainBtn
                ? makeBtn({ type: 'domain', icon: 'fa-globe', color: '#0ea5e9', count: domainCount, isActiveOverride: rootActive })
                : '';
            const shouldShowDomainGranularity = showDomainBtn && active === 'domain';
            const domainGranularityBtn = shouldShowDomainGranularity
                ? `<button class="canvas-bookmark-domain-granularity-btn ${subActive ? 'active' : ''}${compactBookmarkToolbar ? ' canvas-bookmark-domain-granularity-btn-compact' : ''}" type="button" data-domain-group="host" title="${escapeHtml(domainGroupingTitle)}"${compactBookmarkToolbar ? ' style="padding:4px 7px; font-size:10px;"' : ''}>${escapeHtml(subdomainLabel)}</button>`
                : '';
            const domainControls = domainBtn
                ? `<div class="canvas-bookmark-domain-control-group${compactBookmarkToolbar ? ' canvas-bookmark-domain-control-group-compact' : ''}">${domainBtn}${domainGranularityBtn}</div>`
                : '';

            const visibleCount = displayResults.filter(r => r && (r.type === 'bookmark-group' || r.type === 'bookmark-item')).length;
            const exportLabel = isZh
                ? `生成临时栏目${visibleCount ? ` (${visibleCount})` : ''}`
                : `To Temp${visibleCount ? ` (${visibleCount})` : ''}`;

            const showExportBtn = (active !== 'domain') && (!compactBookmarkToolbar || isBrowseSecondary);
            const exportBtnHtml = showExportBtn
                ? `<button class="canvas-bookmark-to-temp-btn${compactBookmarkToolbar ? ' canvas-bookmark-to-temp-btn-compact' : ''}" type="button"${compactBookmarkToolbar ? ' style="padding:5px 8px; font-size:11px; border-radius:7px;"' : ''}>${escapeHtml(exportLabel)}</button>`
                : '';
            const justifyStyle = showExportBtn ? 'space-between' : 'flex-start';
            const toolbarGap = compactBookmarkToolbar ? 6 : 8;
            const toolbarPadding = compactBookmarkToolbar ? '6px 8px 6px 8px' : '8px 12px';
            const controlGap = compactBookmarkToolbar ? 6 : 8;

            html += `<div class="canvas-bookmark-type-toggle${compactBookmarkToolbar ? ' canvas-bookmark-type-toggle-compact' : ''}" style="display:flex; align-items:center; justify-content:${justifyStyle}; gap:${toolbarGap}px; padding:${toolbarPadding};">
                <div style="display:flex; align-items:center; gap:${controlGap}px;">${bookmarkBtn}${folderBtn}${domainControls}</div>
                ${exportBtnHtml}
            </div>`;
        }
    }

    if (isStructureMode && structureModeCounts) {
        const { cardCount, groupCount } = structureModeCounts;
        const active = searchUiState.structureTypeFilter;
        const showCardBtn = cardCount > 0;
        const showGroupBtn = groupCount > 0;

        if (showCardBtn || showGroupBtn) {
            const makeStructureBtn = ({ type, icon, color, label, count }) => {
                const isActive = active === type;
                const bg = isActive ? `${color}22` : 'transparent';
                const border = isActive ? `${color}55` : 'rgba(128, 128, 128, 0.28)';
                const text = isActive ? color : 'var(--text-secondary)';
                const gapPx = compactBookmarkToolbar ? 5 : 6;
                const paddingValue = compactBookmarkToolbar ? '5px 8px' : '6px 10px';
                const radiusValue = compactBookmarkToolbar ? '7px' : '8px';
                const fontSizeValue = compactBookmarkToolbar ? '11px' : '12px';
                return `<button class="canvas-structure-type-btn${compactBookmarkToolbar ? ' canvas-structure-type-btn-compact' : ''}" data-type="${type}" style="display:inline-flex; align-items:center; gap:${gapPx}px; padding:${paddingValue}; border-radius:${radiusValue}; border:1px solid ${border}; background:${bg}; color:${text}; font-size:${fontSizeValue}; font-weight:600; cursor:pointer;">
                        <i class="fas ${icon}" style="color:${color};"></i>
                        <span>${escapeHtml(label)}</span>
                        <span>${count}</span>
                    </button>`;
            };
            const cardBtn = showCardBtn
                ? makeStructureBtn({ type: 'card', icon: 'fa-layer-group', color: '#f97316', label: isZh ? '卡片' : 'Card', count: cardCount })
                : '';
            const groupBtn = showGroupBtn
                ? makeStructureBtn({ type: 'group', icon: 'fa-object-group', color: '#7c3aed', label: isZh ? '组' : 'Group', count: groupCount })
                : '';
            const toolbarGap = compactBookmarkToolbar ? 6 : 8;
            const toolbarPadding = compactBookmarkToolbar ? '6px 8px 6px 8px' : '8px 12px';
            const controlGap = compactBookmarkToolbar ? 6 : 8;

            html += `<div class="canvas-bookmark-type-toggle canvas-structure-type-toggle${compactBookmarkToolbar ? ' canvas-bookmark-type-toggle-compact canvas-structure-type-toggle-compact' : ''}" style="display:flex; align-items:center; justify-content:flex-start; gap:${toolbarGap}px; padding:${toolbarPadding};">
                <div style="display:flex; align-items:center; gap:${controlGap}px;">${cardBtn}${groupBtn}</div>
            </div>`;
        }
    }

    if (searchUiState.activeMode === 'description' && fullscreenScope) {
        const othersCount = Array.isArray(searchUiState.fullscreenDescriptionOthers)
            ? searchUiState.fullscreenDescriptionOthers.length
            : 0;
        const showingOthers = !!searchUiState.showFullscreenDescriptionOthers;

        if (othersCount > 0 && !showingOthers) {
            const otherBtnLabel = isZh ? '其他' : 'Other';

            html += `<div class="canvas-description-fullscreen-header" style="display:flex; align-items:center; justify-content:flex-start; padding:6px 8px 6px 8px; border-bottom:1px solid rgba(128, 128, 128, 0.15);">
                <button class="canvas-description-others-btn" type="button" style="border:1px solid var(--border-color); background:var(--bg-secondary); padding:4px 10px; border-radius:999px; font-size:11px; color:var(--text-secondary); cursor:pointer; font-weight:600; white-space:nowrap;">
                    ${escapeHtml(otherBtnLabel)} (${othersCount})
                </button>
            </div>`;
        }
    }

    visibleResults.forEach((item, index) => {
        const isSelected = index === searchUiState.selectedIndex ? 'selected' : '';
        let title = '';
        let badge = '';
        let indexLabel = '';
        let descHtml = '';

        const hideAggregateTags = (item.type === 'bookmark-group' && isBookmarkGroupExpanded(String(item.id || '')))
            || (item.type === 'domain-group' && item.isExpanded === true);
        const tagMarkersHtml = isBookmarkMode && !hideAggregateTags ? renderBookmarkResultTagMarkers(item) : '';
        const tagsRowHtml = tagMarkersHtml ? `<div class="canvas-bookmark-tags-row" style="margin-top:4px;">${tagMarkersHtml}</div>` : '';

        const itemColor = item.color || '#999';
        const colorStyle = `color:${itemColor}; background:${itemColor}15; border-color:${itemColor}30;`;

        // Helper for colored index/badge
        const makeColoredSpan = (text, extraClass = '') =>
            `<span class="search-result-index ${extraClass}" style="${colorStyle}">${escapeHtml(text)}</span>`;
        const makeColoredBadge = (text, extraClass = '') =>
            `<span class="search-result-badge ${extraClass}" style="${colorStyle} border:1px solid ${itemColor}30;">${escapeHtml(text)}</span>`;

        switch (item.type) {
            case 'group-result':
                // Group Aggregation Display
                indexLabel = `<span class="search-result-index group" style="background:rgba(139, 92, 246, 0.15);color:#7c3aed;border-color:rgba(139, 92, 246, 0.3);width:auto;padding:0 6px;">GROUP</span>`;
                title = escapeHtml(item.title);
                badge = `<span class="search-result-badge container" style="cursor:pointer;" title="${isZh ? '点击高亮全部' : 'Click to highlight all'}">${isZh ? '聚合' : 'Agg'}</span>`;
                break;

            case 'temp-section':
                // 1. 标签：A-1
                if (item.label) {
                    // Use item color for the label
                    indexLabel += makeColoredSpan(item.label, 'group');
                }
                // [Modified] 按照用户需求，临时栏目的来源序号（如 #A 等）不再显示，直接屏蔽不渲染

                title = escapeHtml(item.title || (isZh ? '临时栏目' : 'Temp Section'));
                // [Modified] Restore badge with dynamic color
                badge = makeColoredBadge(isZh ? '临时' : 'Temp', 'temp');
                break;

            case 'md-node':
                // MD 卡片
                title = escapeHtml(item.title || (item.text ? item.text.substring(0, 30) + '...' : (isZh ? 'MD卡片' : 'MD Card')));
                badge = makeColoredBadge(isZh ? '卡片' : 'Card', 'md');
                break;

            case 'edge':
                title = escapeHtml(item.label);
                badge = makeColoredBadge(isZh ? '连线' : 'Edge', 'edge');
                break;

            case 'group': {
                title = escapeHtml(item.title || item.label || (isZh ? '组' : 'Group'));
                badge = makeColoredBadge(
                    isZh ? '组' : 'Group',
                    'md'
                );
                break;
            }

            case 'permanent-section':
                // 显示序号 #A, #B, ...
                const alpha = toAlpha(item.displayIndex);
                // Permanent color usually static Green, but we use what's in DB

                // [Modified] Conditional #A display
                // Logic: Show #A only if we are in multi-column mode (copies exist or ghost content exists)
                // If isMultiColumnMode is false, then displayIndex 1 should be clean.
                // If displayIndex > 1, always show.
                if (item.displayIndex === 1 && !item.isMultiColumnMode) {
                    indexLabel = ''; // No #A label
                } else {
                    indexLabel = makeColoredSpan(`#${alpha}`, 'permanent');
                }

                title = item.displayIndex === 1
                    ? (isZh ? '永久栏目' : 'Permanent')
                    : (isZh ? '永久栏目副本' : 'Permanent Copy');
                badge = makeColoredBadge(isZh ? '永久' : 'Perm', 'permanent');
                break;

            case 'domain-group': {
                const domainText = markQueryInText(item.domain || item.title || '');
                const count = Number(item.count || 0);
                const subdomainCount = Number(item.subdomainCount || 0);
                const isRootGroup = String(item.groupLevel || '') === 'root';
                const isMatchedStats = String(item.statsMode || 'total') === 'matched';
                const isExpanded = item.isExpanded === true;
                const toggleTitle = isExpanded
                    ? (isZh ? '收起当前域名结果' : 'Collapse domain results')
                    : (isZh ? '展开当前域名结果' : 'Expand domain results');
                const countLabel = isRootGroup
                    ? (isZh
                        ? (isMatchedStats
                            ? `${count} 个匹配书签 · ${subdomainCount} 个匹配子域名`
                            : `${count} 个书签 · ${subdomainCount} 个子域名`)
                        : (isMatchedStats
                            ? `${count} matched bookmarks · ${subdomainCount} matched subdomains`
                            : `${count} bookmarks · ${subdomainCount} subdomains`))
                    : (isZh
                        ? (isMatchedStats ? `${count} 个匹配书签` : `${count} 个书签`)
                        : (isMatchedStats ? `${count} matched bookmarks` : `${count} bookmarks`));
                const domainUrl = 'https://' + (item.domain || item.title || '');
                const faviconSrc = (typeof getFaviconUrl === 'function') ? getFaviconUrl(domainUrl) : null;
                const hasRealFavicon = faviconSrc && !String(faviconSrc).startsWith('data:image/svg+xml') && faviconSrc !== (typeof fallbackIcon !== 'undefined' ? fallbackIcon : null);

                indexLabel = `<div class="search-domain-group-icon" style="position:relative; display:inline-flex; align-items:center; justify-content:flex-start; width:18px; height:20px; flex-shrink:0;">
                    <span class="search-result-icon-box-inline" style="display:${hasRealFavicon ? 'none' : 'inline-flex'}; align-items:center; justify-content:center; width:16px; height:16px;">
                        <i class="fas fa-globe" style="color:#0ea5e9; font-size:16px;"></i>
                    </span>
                    <img class="search-result-favicon" src="${escapeHtml(faviconSrc || '')}" data-bookmark-url="${escapeHtml(domainUrl)}" style="display:${hasRealFavicon ? '' : 'none'}; width:16px; height:16px; object-fit:contain; border-radius:3px;" alt="">
                </div>`;
                title = `<div class="search-result-domain-title-text">${domainText}</div>${renderBookmarkResultNoteMarker(item)}`;
                descHtml = `<div class="search-result-match" style="margin-top:2px; color:var(--text-muted); font-size:11px;">${escapeHtml(countLabel)}</div>${tagsRowHtml}${renderBookmarkResultNoteSnippet(item)}`;
                badge = `<div class="search-domain-actions">
                    ${makeColoredBadge(isZh ? '域名' : 'Domain', 'domain')}
                    <button class="search-domain-toggle-btn" type="button" data-domain="${escapeHtml(item.domain || item.title || '')}" aria-label="${escapeHtml(toggleTitle)}" title="${escapeHtml(toggleTitle)}">
                        <i class="fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                    </button>
                </div>`;
                break;
            }

            case 'bookmark-group': {
                // [Phase 3.7 Redesign] Card Layout
                indexLabel = '';
                const bookmarkIconWrapStyle = 'display:flex; align-items:center; justify-content:flex-start; width:18px; height:20px; flex-shrink:0;';

                // 1. Icon (Folder=Blue, Bookmark=Gold or Favicon)
                const isFolder = item.nodeType === 'folder';

                let iconHtml = '';
                if (isFolder) {
                    // 文件夹：使用蓝色文件夹图标
                    iconHtml = `<div style="${bookmarkIconWrapStyle}">
                        <i class="fas fa-folder" style="color:#2563eb; font-size:16px;"></i>
                    </div>`;
                } else if (item.url) {
                    // 书签：优先尝试加载 favicon，fallback 到黄色书签图标
                    // [接入 FaviconCache 统一缓存系统]
                    const bookmarkFallbackHtml = `<div class="search-result-icon-box-inline" style="${bookmarkIconWrapStyle}">
                        <i class="fas fa-bookmark" style="color:#f59e0b; font-size:16px;"></i>
                    </div>`;

                    if (typeof getFaviconUrl === 'function') {
                        const faviconSrc = getFaviconUrl(item.url);
                        // 检查是否是真实 favicon（不是 SVG fallback 图标）
                        if (faviconSrc && !faviconSrc.startsWith('data:image/svg+xml')) {
                            // 真实 favicon（已缓存）
                            iconHtml = `<div style="${bookmarkIconWrapStyle}">
                                <img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" style="width:16px; height:16px; object-fit:contain;" alt="">
                            </div>`;
                        } else {
                            // fallback 图标 + 隐藏的 img 用于后台加载后更新
                            iconHtml = `<div style="${bookmarkIconWrapStyle} position:relative;">
                                <i class="fas fa-bookmark search-result-icon-box-inline" style="color:#f59e0b; font-size:16px;"></i>
                                <img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" style="display:none; width:16px; height:16px; object-fit:contain; position:absolute;" alt="">
                            </div>`;
                        }
                    } else {
                        // getFaviconUrl 不可用，使用黄色书签图标
                        iconHtml = bookmarkFallbackHtml;
                    }
                } else {
                    // 没有 URL 的书签（异常情况），使用黄色书签图标
                    iconHtml = `<div style="${bookmarkIconWrapStyle}">
                        <i class="fas fa-bookmark" style="color:#f59e0b; font-size:16px;"></i>
                    </div>`;
                }

                indexLabel = iconHtml;

                // 2. Title & URL
                const titleText = markQueryInText(item.title || (isZh ? '（无标题）' : '(Untitled)'));
                const groupId = String(item.id || '').trim();
                const targetItems = Array.isArray(item.targetItems) ? item.targetItems : [];
                const matchCount = Number(item.matchesCount || targetItems.length || 0);
                const canExpandGroup = groupId && targetItems.length > 1;
                const isGroupExpanded = canExpandGroup && isBookmarkGroupExpanded(groupId);
                const countHtml = canExpandGroup
                    ? `<button class="canvas-bookmark-match-count canvas-bookmark-group-count" type="button" data-bookmark-group-id="${escapeHtml(groupId)}" aria-expanded="${isGroupExpanded ? 'true' : 'false'}">${isZh ? `${matchCount}处` : `${matchCount} locations`}</button>`
                    : '';
                const noteMarkerHtml = renderBookmarkResultNoteMarker(item);
                const toggleHtml = canExpandGroup
                    ? `<button class="canvas-bookmark-group-toggle" type="button" data-bookmark-group-id="${escapeHtml(groupId)}" aria-label="${escapeHtml(isZh ? '展开或收起候选路径' : 'Expand or collapse candidate paths')}"><i class="fas ${isGroupExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i></button>`
                    : '';
                const groupActionsHtml = countHtml || toggleHtml
                    ? `<div class="canvas-bookmark-group-actions">${countHtml}${toggleHtml}</div>`
                    : '';
                title = `<div class="search-result-bookmark-title-text">${titleText}</div>${noteMarkerHtml}${groupActionsHtml}`;
                const rootLabel = isZh ? '根目录' : 'Root';
                const parentPathListRaw = Array.isArray(item.parentPaths) ? item.parentPaths : [];
                const parentPathList = parentPathListRaw.length
                    ? parentPathListRaw
                    : [String(item.parentPath || '').trim()].filter(Boolean);
                const showPathHint = Boolean(fullscreenScope || parentPathList.length);
                const pathHintTypeClass = isFolder ? 'is-folder' : 'is-bookmark';
                const parentPathHtml = showPathHint
                    ? renderPathHintWithTailPreview(parentPathList, rootLabel, pathHintTypeClass)
                    : '';

                let urlHtml = '';
                if (item.url) {
                    urlHtml = `<div class="search-result-link-row">${renderExternalLinkHtml(item.url)}</div>`;
                }

                // 3. Location Chips (Grouped & Labeled)
                let locationsHtml = '';
                if (!disableLocationJumpBadges && item.locations && item.locations.length > 0) {

                    const perms = item.locations.filter(l => l.source === 'permanent');
                    const temps = item.locations.filter(l => l.source !== 'permanent');

                    // Helper to make chip
                    const makeChip = (text, color, attr, extraStyle = '', titleText = '', extraAttrs = '') => {
                        const chipClass = disableLocationJumpBadges
                            ? 'search-loc-chip search-loc-chip-disabled canvas-bookmark-location-chip'
                            : 'search-loc-chip canvas-bookmark-location-chip';
                        const chipAttr = disableLocationJumpBadges
                            ? 'data-search-nav-disabled="true" aria-disabled="true"'
                            : attr;
                        const chipCursor = disableLocationJumpBadges ? 'cursor:default;' : 'cursor:pointer;';
                        const safeTitle = String(titleText || text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                        const compactClass = compactBookmarkToolbar ? ' canvas-bookmark-location-chip-compact' : '';
                        const safeColor = escapeHtml(color);
                        return `<button type="button" class="${chipClass}${compactClass}" ${chipAttr} ${extraAttrs} style="${chipCursor} --loc-color:${safeColor}; border-color:${safeColor}; color:${safeColor}; background:${safeColor}18; ${extraStyle}" title="${escapeHtml(safeTitle)}"><span class="canvas-bookmark-location-chip-text">${text}</span></button>`;
                    };
                    const renderLocationChipRow = (chips, limit = 5) => {
                        const list = Array.isArray(chips) ? chips.filter(Boolean) : [];
                        const compactClass = compactBookmarkToolbar ? ' canvas-bookmark-location-chip-row-compact' : '';
                        const renderChipWithBreaks = (sourceList, options = {}) => sourceList.map((chipHtml, localIndex) => {
                            const index = Number(options.startIndex || 0) + localIndex;
                            const hiddenAttr = options.hidden ? 'hidden data-location-chip-extra="true" ' : '';
                            const chip = hiddenAttr
                                ? chipHtml.replace('<button ', `<button ${hiddenAttr}`)
                                : chipHtml;
                            const shouldBreak = (index + 1) % 3 === 0 && (index + 1) < list.length;
                            const breakHiddenAttr = (options.hidden || (index + 1) === limit) ? 'hidden data-location-chip-extra="true" ' : '';
                            const breakHtml = shouldBreak
                                ? `<span class="canvas-bookmark-location-chip-row-break" ${breakHiddenAttr}></span>`
                                : '';
                            return `${chip}${breakHtml}`;
                        }).join('');
                        if (list.length <= limit) {
                            return `<div class="canvas-bookmark-location-chip-row canvas-bookmark-location-chip-row-limited${compactClass}">${renderChipWithBreaks(list)}</div>`;
                        }
                        const visibleList = list.slice(0, limit);
                        const hiddenList = list.slice(limit);
                        const visible = renderChipWithBreaks(visibleList);
                        const hidden = renderChipWithBreaks(hiddenList, { hidden: true, startIndex: visibleList.length });
                        return `<div class="canvas-bookmark-location-chip-row canvas-bookmark-location-chip-row-limited${compactClass}">
                            ${visible}
                            ${hidden}
                            <button type="button" class="canvas-bookmark-location-more" title="${escapeHtml(isZh ? '展开全部标识' : 'Show all markers')}">...</button>
                            <button type="button" class="canvas-bookmark-location-less" title="${escapeHtml(isZh ? '收起部分标识' : 'Collapse markers')}" hidden><i class="fas fa-chevron-up"></i></button>
                        </div>`;
                    };

                    // A. Permanent Row
                    if (perms.length > 0) {
                        // Reuse first perm item for ID reference (they are usually duplicates in terms of location logic if multiple perm matches exist, but usually just one "Permanent" location per bookmark logic)
                        const loc = perms[0];
                        const permLabel = `<span class="canvas-bookmark-location-label">${isZh ? '永久栏目' : 'Permanent'}:</span>`;

                        let copyBadges = [];

                        try {
                            const copies = getPermanentCopyShellsForSearch();

                            // #A
                            // Badge Click Attr
                            const clickAttrBase = `data-loc-id="${loc.id}" data-loc-source="permanent"`;

                            copyBadges.push(makeChip('#A', '#059669', `${clickAttrBase} data-copy-id="null"`));

                            const toAlphaLocal = (num) => (num > 0 ? String.fromCharCode(64 + num) : '');
                            copies.forEach((c, idx) => {
                                const copyId = String(c && c.copyId || '').trim();
                                if (!copyId) return;
                                const dIdx = getPermanentCopySearchDisplayIndex(c, idx);
                                const label = toAlphaLocal(dIdx);
                                copyBadges.push(makeChip(`#${label}`, '#059669', `${clickAttrBase} data-copy-id="${copyId}"`));
                            });
                        } catch (_) { }

                        if (copyBadges.length === 0) {
                            copyBadges.push(makeChip('#A', '#059669', `data-loc-id="${loc.id}" data-loc-source="permanent" data-copy-id="null"`));
                        }

                        locationsHtml += `<div class="canvas-bookmark-location-row canvas-bookmark-location-row-permanent${compactBookmarkToolbar ? ' canvas-bookmark-location-row-compact' : ''}">
                            ${permLabel}
                            ${renderLocationChipRow(copyBadges)}
                        </div>`;
                    }

                    // B. Temporary Row
                    if (temps.length > 0) {
                        const tempLabel = `<span class="canvas-bookmark-location-label">${isZh ? '临时栏目' : 'Temporary'}:</span>`;

                        const tempBadges = temps.map(loc => {
                            const color = loc.color || '#2563eb';
                            const seq = loc.label ? String(loc.label).trim() : '';
                            const rawTitle = String(loc.title || '').trim();
                            const htmlTitle = escapeHtml(rawTitle);
                            const shouldShowTitle = !!rawTitle && (!seq || rawTitle.toLowerCase() !== seq.toLowerCase());
                            let content = htmlTitle;
                            if (seq && shouldShowTitle) {
                                content = `<b>${escapeHtml(seq)}</b> <span style="opacity:0.8; margin-left:3px;">${htmlTitle}</span>`;
                            } else if (seq) {
                                content = `<b>${escapeHtml(seq)}</b>`;
                            }
                            const attr = `data-loc-id="${loc.id}" data-loc-source="${loc.source}" data-loc-section="${loc.sectionId || ''}"`;
                            return makeChip(content, color, attr, '', [seq, rawTitle].filter(Boolean).join(' '));
                        });

                        locationsHtml += `<div class="canvas-bookmark-location-row canvas-bookmark-location-row-temp${compactBookmarkToolbar ? ' canvas-bookmark-location-row-compact' : ''}">
                            ${tempLabel}
                            ${renderLocationChipRow(tempBadges, 3)}
                        </div>`;
                    }
                }

                const childrenHtml = renderBookmarkGroupChildren(item);
                const noteSnippetHtml = renderBookmarkResultNoteSnippet(item);

                const hasPathMatch = isPlainBookmarkDetailsQuery && parentPathHtml && parentPathHtml.includes('<mark>');
                const hasUrlMatch = isPlainBookmarkDetailsQuery && urlHtml && urlHtml.includes('<mark>');
                const hasTagMatch = isTagDetailsQuery && tagsRowHtml && tagsRowHtml.includes('<mark>');
                const hasNoteMatch = isNoteDetailsQuery && noteSnippetHtml && noteSnippetHtml.includes('<mark>');
                
                const preview = buildMatchedDetailsPreviewHtml([
                    { matched: hasPathMatch, html: parentPathHtml },
                    { matched: hasUrlMatch, html: urlHtml },
                    { matched: hasTagMatch, html: tagsRowHtml },
                    { matched: hasNoteMatch, html: noteSnippetHtml }
                ]);

                const detailsExpanded = isBookmarkDetailsExpanded(item.id);
                const previewContextHtml = renderDetailsPreviewContextHtml(item, preview, detailsExpanded);

                const infoToggleHtml = `
                    <div class="canvas-bookmark-details-row">
                        <button class="canvas-bookmark-details-toggle" type="button" data-item-id="${escapeHtml(String(item.id))}" aria-expanded="${detailsExpanded ? 'true' : 'false'}" title="${escapeHtml(isZh ? (detailsExpanded ? '收起信息' : '展开信息') : (detailsExpanded ? 'Collapse info' : 'Expand info'))}">
                            <i class="fas ${detailsExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                            <span>${isZh ? '信息' : 'Info'}</span>
                        </button>
                        ${previewContextHtml}
                    </div>
                `;

                const detailsHtml = `
                    <div class="canvas-bookmark-details-collapsible" style="display: ${detailsExpanded ? 'flex' : 'none'}; flex-direction: column; width: 100%; min-width: 0; margin-top: 4px; gap: 4px;">
                        ${parentPathHtml}
                        ${urlHtml}
                        ${tagsRowHtml}
                        ${noteSnippetHtml}
                    </div>
                `;

                descHtml = `<div class="search-result-match canvas-bookmark-group-summary" style="display:flex; flex-direction:column; width:100%; min-width:0;">
                    ${locationsHtml}
                    ${infoToggleHtml}
                    ${detailsHtml}
                </div>${childrenHtml}`;

                badge = '';
                break;
            }

            case 'bookmark-group-more': {
                indexLabel = `<span class="search-child-dot">…</span>`;
                title = escapeHtml(item.title || (isZh ? '更多' : 'More'));
                badge = '';
                break;
            }

            case 'bookmark-item': {
                // Child item under a bookmark-group
                if (item.isChild) {
                    const childDotClass = item.domainChild ? 'search-child-dot search-domain-child-dot' : 'search-child-dot';
                    if (item.nodeType === 'folder') {
                        indexLabel = `<span class="${childDotClass}"><i class="fas fa-folder" style="color:#2563eb;"></i></span>`;
                    } else if (item.url) {
                        const iconColor = '#f59e0b';
                        if (typeof getFaviconUrl === 'function') {
                            const faviconSrc = getFaviconUrl(item.url);
                            const hasRealFavicon = faviconSrc && !faviconSrc.startsWith('data:image/svg+xml') && faviconSrc !== (typeof fallbackIcon !== 'undefined' ? fallbackIcon : null);
                            
                            const spanWidth = item.domainChild ? '18px' : '16px';
                            const spanHeight = item.domainChild ? '20px' : '16px';
                            const spanJustify = item.domainChild ? 'flex-start' : 'center';
                            const imgLeft = '0';
                            const imgTop = item.domainChild ? '2px' : '0';
                            
                            if (hasRealFavicon) {
                                indexLabel = `<span class="${childDotClass}" style="position:relative; display:inline-flex; align-items:center; justify-content:${spanJustify}; width:${spanWidth}; height:${spanHeight};">
                                    <img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" style="width:16px; height:16px; object-fit:contain; border-radius:3px;" alt="">
                                </span>`;
                            } else {
                                indexLabel = `<span class="${childDotClass}" style="position:relative; display:inline-flex; align-items:center; justify-content:${spanJustify}; width:${spanWidth}; height:${spanHeight};">
                                    <i class="fas fa-bookmark search-result-icon-box-inline" style="color:${iconColor}; font-size:14px; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px;"></i>
                                    <img class="search-result-favicon" src="${faviconSrc || ''}" data-bookmark-url="${escapeHtml(item.url)}" style="display:none; width:16px; height:16px; object-fit:contain; border-radius:3px; position:absolute; left:${imgLeft}; top:${imgTop};" alt="">
                                </span>`;
                            }
                        } else {
                            indexLabel = `<span class="${childDotClass}"><i class="fas fa-bookmark" style="color:${iconColor};"></i></span>`;
                        }
                    } else {
                        indexLabel = `<span class="${childDotClass}"><i class="fas fa-bookmark" style="color:#f59e0b;"></i></span>`;
                    }
                }

                const itemNoteMarkerHtml = renderBookmarkResultNoteMarker(item);
                const itemNoteSnippetHtml = renderBookmarkResultNoteSnippet(item);
                title = `<span class="search-result-bookmark-title-text">${markQueryInText(item.title || (isZh ? '（无标题）' : '(Untitled)'))}</span>${itemNoteMarkerHtml}`;
                if (item.domainChild) {
                    const hostText = String(item.domainHost || '').trim().toLowerCase();
                    const showHost = hostText && (String(item.groupLevel || '') === 'root' || hostText !== String(item.domain || '').trim().toLowerCase());
                    const hostLabel = showHost
                        ? `<div class="search-domain-host-line">${escapeHtml(hostText)}</div>`
                        : '';
                    const linkHtml = item.url
                        ? `<div class="search-result-link-row">${renderExternalLinkHtml(item.url)}</div>`
                        : '';
                    descHtml = `<div class="search-result-match search-domain-children-meta">${hostLabel}${linkHtml}${tagsRowHtml}${itemNoteSnippetHtml}</div>`;
                } else {
                    descHtml = '';
                    if (tagsRowHtml) descHtml += tagsRowHtml;
                    if (itemNoteSnippetHtml) descHtml += itemNoteSnippetHtml;
                }

                // 子项不再显示右侧 badge（更像“折叠列表”）
                if (!item.isChild) {
                    const isFolder = item.nodeType === 'folder';
                    const badgeText = isFolder
                        ? (isZh ? '文件夹' : 'Folder')
                        : (isZh ? '书签' : 'BM');

                    // Default Badge
                    badge = makeColoredBadge(badgeText, 'bookmark');
                } else {
                    badge = '';
                }

                // [Feature] 如果是永久栏目书签，且存在副本 -> 显示跳转按钮 (#A, #B...)
                // (无论是否为子项都显示，方便在聚合列表中跳转)
                if (!disableLocationJumpBadges && item.source === 'permanent' && !item.domainChild) {
                    try {
                        const copies = getPermanentCopyShellsForSearch();
                        // Only show interactive badges if there are ACTUALLY copies (B, C...)
                        if (Array.isArray(copies) && copies.length > 0) {
                            // Build interactive HTML
                            // Style: small chips, clickable
                            let buttonsHtml = '';

                            // Button A (Main)
                            const badgeCursor = disableLocationJumpBadges ? 'default' : 'pointer';
                            const badgeClass = disableLocationJumpBadges
                                ? 'search-result-badge-disabled'
                                : 'search-result-badge-interactive';
                            const styleBase = `cursor:${badgeCursor}; margin-left:4px; padding:0 6px; font-family:var(--font-mono, monospace); font-weight:bold; color:var(--text-secondary); background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; font-size:11px;`;

                            // #A
                            const disabledAttrBase = `data-search-nav-disabled="true" aria-disabled="true"`;
                            const mainAttr = disableLocationJumpBadges
                                ? disabledAttrBase
                                : `data-copy-id="null" data-display-index="1"`;
                            buttonsHtml += `<span class="${badgeClass}" ${mainAttr} style="${styleBase}" title="Jump to Copy #A">#A</span>`;

                            const toAlphaLocal = (num) => {
                                if (num <= 0) return '';
                                return String.fromCharCode(64 + num);
                            };

                            copies.forEach((c, idx) => {
                                const copyId = String(c && c.copyId || '').trim();
                                if (!copyId) return;

                                const dIdx = getPermanentCopySearchDisplayIndex(c, idx);

                                const label = toAlphaLocal(dIdx);
                                const copyAttr = disableLocationJumpBadges
                                    ? disabledAttrBase
                                    : `data-copy-id="${escapeHtml(copyId)}" data-display-index="${dIdx}"`;
                                buttonsHtml += `<span class="${badgeClass}" ${copyAttr} style="${styleBase}" title="Jump to Copy #${label}">#${label}</span>`;
                            });

                            if (buttonsHtml) {
                                badge = `<div style="display:flex; align-items:center; flex-shrink:0;">${buttonsHtml}</div><div style="width:8px;"></div>${badge}`;
                            }
                        }
                    } catch (e) { console.error(e); }
                }

                // [Feature] 临时栏目跳转按钮 (Similar to Permanent Buttons)
                if (!disableLocationJumpBadges && item.source === 'temporary' && item.sectionId && !item.domainChild) {
                    const sectionName = item.sectionLabel || item.sectionTitle || (isZh ? '临时' : 'Temp');
                    // Style: mimic permanent interactive badge but allow colored border
                    const sectionColor = item.color || '#2563eb';
                    // Utilize the same robust style
                    const chipCursor = disableLocationJumpBadges ? 'default' : 'pointer';
                    const chipClass = disableLocationJumpBadges
                        ? 'search-loc-chip search-loc-chip-disabled'
                        : 'search-loc-chip';
                    const styleBase = `cursor:${chipCursor}; margin-left:4px; padding:0 6px; font-family:var(--font-mono, monospace); font-weight:bold; color:var(--text-secondary); background:var(--bg-secondary); border:1px solid ${sectionColor}80; border-radius:4px; font-size:11px;`;

                    // Use .search-loc-chip class as it triggers 'handleSearchResultsPanelClick' with data-loc-... attributes
                    const attr = disableLocationJumpBadges
                        ? `data-search-nav-disabled="true" aria-disabled="true"`
                        : `data-loc-id="${item.id}" data-loc-source="temporary" data-loc-section="${item.sectionId}"`;
                    // Use sectionTitle for tooltip
                    const tooltip = escapeHtml(item.sectionTitle || sectionName);

                    const buttonsHtml = `<span class="${chipClass}" ${attr} style="${styleBase}" title="${tooltip}">${escapeHtml(sectionName)}</span>`;

                    badge = `<div style="display:flex; align-items:center; flex-shrink:0;">${buttonsHtml}</div><div style="width:8px;"></div>${badge}`;
                }
                break;
            }
        }

        // --- 增强显示：颜色与说明 ---

        // 1. Edge 颜色图标 (SVG)
        if (item.type === 'edge' && item.color) {
            const dir = item.direction || 'none';
            let svgContent = '';
            const stroke = item.color;

            // Base line with color
            // 使用 16x16 视图
            if (dir === 'both') {
                // 双向箭头 <->
                svgContent = `
                    <path d="M4,8 L12,8" stroke="${stroke}" stroke-width="1.5" />
                    <path d="M5,5 L2,8 L5,11" stroke="${stroke}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M11,5 L14,8 L11,11" stroke="${stroke}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                `;
            } else if (dir === 'forward') {
                // 单向箭头 ->
                svgContent = `
                    <path d="M2,8 L12,8" stroke="${stroke}" stroke-width="1.5" />
                    <path d="M11,5 L14,8 L11,11" stroke="${stroke}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="2" cy="8" r="1.5" fill="${stroke}" />
                `;
            } else {
                // 无箭头 -o- (两端圆点)
                svgContent = `
                    <path d="M3,8 L13,8" stroke="${stroke}" stroke-width="1.5" />
                    <circle cx="2" cy="8" r="1.5" fill="${stroke}" />
                    <circle cx="14" cy="8" r="1.5" fill="${stroke}" />
                `;
            }

            const colorIcon = `
                <svg viewBox="0 0 16 16" width="16" height="16" style="margin-right:4px; vertical-align:middle; flex-shrink:0;">
                    ${svgContent}
                </svg>
            `;
            badge = `<div style="display:flex;align-items:center;">${colorIcon}${badge}</div>`;
        }

        // 2. 说明文字 / MD 内容摘要 (Description / Text Snippet)
        const lowerQuery = searchUiState.query ? searchUiState.query.toLowerCase() : '';

        // 策略：优先展示 "文本内容匹配" 的摘要，其次是 "说明匹配"
        let snippet = '';
        let isTextMatch = false;

        // A. 尝试匹配 MD 卡片正文
        if (item.type === 'md-node' && item.text) {
            snippet = generateSearchSnippet(item.text, searchUiState.query);
            if (snippet) isTextMatch = true;
        }

        // B. 如果没有文本匹配（或者不是 MD 卡片），尝试匹配 Description
        if (!snippet && item.description) {
            snippet = generateSearchSnippet(item.description, searchUiState.query);
        }

        // C. 渲染摘要
        if (snippet) {
            const label = isTextMatch ? (isZh ? '匹配内容: ' : 'Match: ') : '';
            descHtml = `<div class="search-result-match" style="margin-top:4px; color:var(--text-muted); font-size:12px; line-height:1.4;">
                ${label}${snippet}
            </div>`;
        } else if (item.description) {
            // Fallback: 如果仅标题匹配，但有说明，则显示静态说明（截断）
            const maxDescLen = 40;
            let d = item.description;
            if (d.length > maxDescLen) {
                d = d.substring(0, maxDescLen) + '...';
            }
            descHtml = `<div class="search-result-match" style="margin-top:2px; color:var(--text-muted); font-size:12px;">${escapeHtml(d)}</div>`;
        }

        // Bookmark/Folder meta: show matched path/URL plus explicit tag/note searches.
        if (item.type === 'bookmark-item' && !item.isChild && !item.domainChild) {
            const rootLabel = isZh ? '根目录' : 'Root';
            const parentPath = getBookmarkItemParentPathForSearchScope(item, fullscreenScope);
            const pathList = parentPath ? [parentPath] : [];
            const pathHintTypeClass = item.nodeType === 'folder' ? 'is-folder' : 'is-bookmark';
            const pathHtml = pathList.length
                ? renderPathHintWithTailPreview(pathList, rootLabel, pathHintTypeClass)
                : '';
            const linkHtml = item.url ? `<div class="search-result-match search-result-link-row">${renderExternalLinkHtml(item.url)}</div>` : '';
            const itemNoteSnippetHtml = renderBookmarkResultNoteSnippet(item);
            
            let detailsContentHtml = '';
            if (pathHtml) detailsContentHtml += pathHtml;
            if (linkHtml) detailsContentHtml += linkHtml;
            if (tagsRowHtml) detailsContentHtml += tagsRowHtml;
            if (itemNoteSnippetHtml) detailsContentHtml += itemNoteSnippetHtml;

            const hasPathMatch = isPlainBookmarkDetailsQuery && pathHtml && pathHtml.includes('<mark>');
            const hasUrlMatch = isPlainBookmarkDetailsQuery && linkHtml && linkHtml.includes('<mark>');
            const hasTagMatch = isTagDetailsQuery && tagsRowHtml && tagsRowHtml.includes('<mark>');
            const hasNoteMatch = isNoteDetailsQuery && itemNoteSnippetHtml && itemNoteSnippetHtml.includes('<mark>');
            
            const preview = buildMatchedDetailsPreviewHtml([
                { matched: hasPathMatch, html: pathHtml },
                { matched: hasUrlMatch, html: linkHtml },
                { matched: hasTagMatch, html: tagsRowHtml },
                { matched: hasNoteMatch, html: itemNoteSnippetHtml }
            ]);

            const detailsExpanded = isBookmarkDetailsExpanded(item.id);
            const previewContextHtml = renderDetailsPreviewContextHtml(item, preview, detailsExpanded);

            const infoToggleHtml = `
                <div class="canvas-bookmark-details-row">
                    <button class="canvas-bookmark-details-toggle" type="button" data-item-id="${escapeHtml(String(item.id))}" aria-expanded="${detailsExpanded ? 'true' : 'false'}" title="${escapeHtml(isZh ? (detailsExpanded ? '收起信息' : '展开信息') : (detailsExpanded ? 'Collapse info' : 'Expand info'))}">
                        <i class="fas ${detailsExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                        <span>${isZh ? '信息' : 'Info'}</span>
                    </button>
                    ${previewContextHtml}
                </div>
            `;

            const detailsHtml = `
                <div class="canvas-bookmark-details-collapsible" style="display: ${detailsExpanded ? 'flex' : 'none'}; flex-direction: column; width: 100%; min-width: 0; margin-top: 4px; gap: 4px;">
                    ${detailsContentHtml}
                </div>
            `;

            descHtml = `
                <div style="display: flex; flex-direction: column; width: 100%; min-width: 0;">
                    ${infoToggleHtml}
                    ${detailsHtml}
                </div>
            `;
        } else if (item.type === 'bookmark-item' && item.url && item.domainChild) {
            // Keep original logic for domainChild but swap tag and note
            const linkHtml = `<div class="search-result-match search-result-link-row">${renderExternalLinkHtml(item.url)}</div>`;
            const itemNoteSnippetHtml = renderBookmarkResultNoteSnippet(item);
            descHtml = `<div class="search-result-match search-domain-children-meta">${linkHtml}${tagsRowHtml}${itemNoteSnippetHtml}</div>`;
        }

        const extraClasses = [];
        if (item.type === 'bookmark-group') extraClasses.push('bookmark-group');
        if (item.type === 'bookmark-group-more') extraClasses.push('bookmark-more');
        if (item.type === 'domain-group') extraClasses.push('domain-group');
        if (item.isChild) extraClasses.push('bookmark-child');
        if (item.domainChild) extraClasses.push('domain-child');
        const rowClassName = ['search-result-item', isSelected].concat(extraClasses).filter(Boolean).join(' ');
        const bookmarkGroupExpandedAttr = item.type === 'bookmark-group' && isBookmarkGroupExpanded(String(item.id || ''))
            ? ' data-expanded="true"'
            : '';

        html += `
            <div class="${rowClassName}" data-index="${index}" data-id="${item.id}" data-type="${item.type}"${bookmarkGroupExpandedAttr}>
                <div class="search-result-content">
                    <div class="search-result-title">${indexLabel}${title}</div>
                    ${descHtml}
                </div>
                ${badge}
            </div>
        `;
    });

    if (hasMoreResults) {
        const remain = Math.max(0, displayResults.length - visibleResults.length);
        const loadMoreText = isZh
            ? `继续加载（剩余 ${remain}）`
            : `Load More (${remain} left)`;
        html += `
            <div class="search-results-load-more-row" style="padding:10px 12px 12px; display:flex; justify-content:center;">
                <button class="search-load-more-btn" type="button" style="border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-normal); padding:6px 12px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;">
                    ${escapeHtml(loadMoreText)}
                </button>
            </div>
        `;
    }

    panel.innerHTML = html;

    const syncBookmarkResultTitleLayout = () => {
        if (!panel || typeof panel.querySelectorAll !== 'function') return;
        const titleEls = panel.querySelectorAll('.search-result-bookmark-title-text, .search-result-domain-title-text');
        titleEls.forEach((el) => {
            const row = el.closest('.search-result-title');
            if (!row) return;

            let lineHeight = 15.84;
            try {
                const computed = window.getComputedStyle ? window.getComputedStyle(el) : null;
                const rawLineHeight = computed ? parseFloat(computed.lineHeight) : 0;
                if (Number.isFinite(rawLineHeight) && rawLineHeight > 0) {
                    lineHeight = rawLineHeight;
                } else {
                    const fontSize = computed ? parseFloat(computed.fontSize) : 12;
                    if (Number.isFinite(fontSize) && fontSize > 0) {
                        lineHeight = fontSize * 1.32;
                    }
                }
            } catch (_) { }

            const measuredHeight = Math.max(
                Number(el.scrollHeight || 0),
                Number(el.getBoundingClientRect ? el.getBoundingClientRect().height : 0)
            );
            const isMultiline = measuredHeight > (lineHeight * 1.5);
            row.classList.toggle('search-result-title-multiline', isMultiline);
        });
    };

    syncBookmarkResultTitleLayout();
    showSearchResultsPanel();
    requestAnimationFrame(syncBookmarkResultTitleLayout);
    updateSearchResultSelection(searchUiState.selectedIndex, { ensureVisible: !options.skipEnsureVisible });

}

function collectBookmarkItemsForTempSection() {
    const filter = searchUiState.bookmarkTypeFilter;
    if (filter === 'domain') return [];
    let items = [];
    const groups = searchUiState.bookmarkGroupModel;

    if (Array.isArray(groups) && groups.length) {
        groups.forEach(g => {
            if (!g || !Array.isArray(g.children) || !g.children.length) return;
            const item = g.children[0].item;
            if (!item) return;
            if (filter === 'bookmark' && item.nodeType !== 'bookmark') return;
            if (filter === 'folder' && item.nodeType !== 'folder') return;
            items.push(item);
        });
        return items;
    }

    items = (searchUiState.resultAll || searchUiState.results || []).filter(r => r && r.type === 'bookmark-item');
    if (filter === 'bookmark') {
        items = items.filter(r => r.nodeType === 'bookmark');
    } else if (filter === 'folder') {
        items = items.filter(r => r.nodeType === 'folder');
    }
    return items;
}

function getCanvasViewportCenterForTemp() {
    const workspace = document.getElementById('canvasWorkspace');
    const state = getActiveCanvasState();
    if (!workspace || !state) return { x: 100, y: 100 };

    const rect = workspace.getBoundingClientRect();
    const zoom = state.zoom || 1;
    const panX = state.panOffsetX || 0;
    const panY = state.panOffsetY || 0;
    const rightShiftPx = Math.min(rect.width * 0.12, 180);
    const x = (rect.width / 2 + rightShiftPx - panX) / zoom;
    const y = (rect.height / 2 - panY) / zoom;
    return { x, y };
}

function showCanvasToastSafe(message, type = 'info', duration = 2200) {
    try {
        if (typeof showCanvasToast === 'function') {
            showCanvasToast(message, type, duration);
        }
    } catch (_) { }
}

function yieldToMainThread() {
    return new Promise(resolve => {
        try {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
                return;
            }
        } catch (_) { }
        setTimeout(resolve, 0);
    });
}

function rerenderCanvasBookmarkResults(selectedIndex = 0) {
    const query = String(searchUiState && searchUiState.query || '').trim();
    const groups = searchUiState ? searchUiState.bookmarkGroupModel : null;
    if (Array.isArray(groups)) {
        const nextResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
        renderCanvasSearchResults(nextResults, {
            view: 'canvas',
            query,
            selectedIndex: Number.isFinite(selectedIndex) ? selectedIndex : 0,
            skipEnsureVisible: true
        });
        return;
    }
    searchCanvasAndRender(query, { source: 'system', keepTagBrowseDetail: true, keepNoteBrowseDetail: true });
}

function appendCanvasSearchResultsPage() {
    const sourceResults = Array.isArray(searchUiState.resultSource) ? searchUiState.resultSource : [];
    const query = String(searchUiState && searchUiState.query || '').trim();
    if (!sourceResults.length) {
        searchCanvasAndRender(query, { source: 'system', keepTagBrowseDetail: true, keepNoteBrowseDetail: true });
        return;
    }
    renderCanvasSearchResults(sourceResults, {
        view: 'canvas',
        query,
        append: true,
        selectedIndex: searchUiState.selectedIndex
    });
}

function openSearchResultExternalUrl(url) {
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return false;

    try {
        if (typeof window.openBookmarkNewTab === 'function') {
            window.openBookmarkNewTab(safeUrl);
            return true;
        }
    } catch (_) { }

    try {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeTagsForPayload(tagsInput) {
    return (Array.isArray(tagsInput) ? tagsInput : [])
        .map((tag) => ({
            color: String(tag && tag.color || '').trim().toLowerCase(),
            text: String(tag && tag.text || '').trim()
        }))
        .filter((tag) => tag.color);
}

function readPermanentNodeTagsCachedForPayload(chromeId) {
    const safeId = String(chromeId || '').trim();
    if (!safeId) return [];
    try {
        if (typeof window !== 'undefined'
            && window.TagSystem
            && typeof window.TagSystem.getPermNodeTagsCached === 'function') {
            return normalizeTagsForPayload(window.TagSystem.getPermNodeTagsCached(safeId));
        }
    } catch (_) { }
    return [];
}

function normalizeNoteMetaForPayload(noteInput, colorInput) {
    const note = normalizeNoteForSearch(noteInput);
    return note ? {
        note,
        noteColor: normalizeNoteColorForSearch(colorInput)
    } : { note: '', noteColor: normalizeNoteColorForSearch(colorInput) };
}

function readPermanentNodeNoteMetaCachedForPayload(chromeId) {
    const safeId = String(chromeId || '').trim();
    if (!safeId) return { note: '', noteColor: NOTE_COLOR_DEFAULT };
    try {
        if (typeof window !== 'undefined' && window.NoteSystem) {
            if (typeof window.NoteSystem.getPermNodeNoteMetaCached === 'function') {
                const meta = window.NoteSystem.getPermNodeNoteMetaCached(safeId) || {};
                return normalizeNoteMetaForPayload(meta.note, meta.noteColor || meta.color);
            }
            if (typeof window.NoteSystem.getPermNodeNoteCached === 'function') {
                return normalizeNoteMetaForPayload(window.NoteSystem.getPermNodeNoteCached(safeId), NOTE_COLOR_DEFAULT);
            }
        }
    } catch (_) { }
    return { note: '', noteColor: NOTE_COLOR_DEFAULT };
}

function applyNoteMetaToBookmarkPayload(payload, noteMeta) {
    if (!payload || !noteMeta) return;
    const note = normalizeNoteForSearch(noteMeta.note);
    if (!note) return;
    payload.note = note;
    payload.noteColor = normalizeNoteColorForSearch(noteMeta.noteColor || noteMeta.color);
}

async function buildPermanentNodeMap(root) {
    const map = new Map();
    if (!root) return map;

    const stack = [root];
    let scanned = 0;
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node.id === 'undefined' || node.id === null) continue;

        map.set(String(node.id), node);
        scanned += 1;
        if (scanned % TEMP_SECTION_BUILD_YIELD_EVERY === 0) {
            await yieldToMainThread();
        }

        if (Array.isArray(node.children) && node.children.length) {
            for (let i = node.children.length - 1; i >= 0; i -= 1) {
                stack.push(node.children[i]);
            }
        }
    }
    return map;
}

function buildSearchBookmarkPayload(item, isZh) {
    const source = String(item && item.source || '').trim();
    const safeTitle = item && (item.title || item.url) ? (item.title || item.url) : (isZh ? '书签' : 'Bookmark');
    const safeUrl = item && item.url ? item.url : 'https://';
    const payload = {
        title: safeTitle,
        url: safeUrl,
        type: 'bookmark',
        children: []
    };
    if (item && item.id) payload.id = String(item.id);
    const inlineTags = normalizeTagsForPayload(item && Array.isArray(item.tags) ? item.tags : []);
    const fallbackPermanentTags = (!inlineTags.length && source === 'permanent' && item && item.id)
        ? readPermanentNodeTagsCachedForPayload(item.id)
        : [];
    const payloadTags = inlineTags.length ? inlineTags : fallbackPermanentTags;
    if (payloadTags.length) payload.tags = payloadTags;
    const inlineNoteMeta = normalizeNoteMetaForPayload(item && item.note, item && item.noteColor);
    const fallbackPermanentNoteMeta = (!inlineNoteMeta.note && source === 'permanent' && item && item.id)
        ? readPermanentNodeNoteMetaCachedForPayload(item.id)
        : { note: '', noteColor: NOTE_COLOR_DEFAULT };
    applyNoteMetaToBookmarkPayload(payload, inlineNoteMeta.note ? inlineNoteMeta : fallbackPermanentNoteMeta);
    if (source === 'permanent') {
        payload.__canvasPayloadSource = 'permanent';
    }
    return payload;
}

async function buildPayloadFromPermanentNode(node, isZh, options = {}) {
    if (!node) return null;
    const resolvePermanentNodeTags = (options && typeof options.resolvePermanentNodeTags === 'function')
        ? options.resolvePermanentNodeTags
        : null;
    const resolvePermanentNodeNotes = (options && typeof options.resolvePermanentNodeNotes === 'function')
        ? options.resolvePermanentNodeNotes
        : null;
    const resolveTags = (nodeId, fallback = []) => {
        const fromResolver = resolvePermanentNodeTags ? resolvePermanentNodeTags(nodeId) : [];
        const primary = normalizeTagsForPayload(fromResolver);
        if (primary.length) return primary;
        return normalizeTagsForPayload(fallback);
    };
    const resolveNoteMeta = (nodeId, fallback = {}) => {
        const fromResolver = resolvePermanentNodeNotes ? resolvePermanentNodeNotes(nodeId) : null;
        const primary = fromResolver
            ? normalizeNoteMetaForPayload(fromResolver.note, fromResolver.noteColor || fromResolver.color)
            : { note: '', noteColor: NOTE_COLOR_DEFAULT };
        if (primary.note) return primary;
        return normalizeNoteMetaForPayload(fallback.note, fallback.noteColor || fallback.color);
    };

    const nodeUrl = typeof node.url === 'string' ? node.url : '';
    const nodeTitle = typeof node.title === 'string' ? node.title : '';
    const rootId = node && node.id ? String(node.id) : '';
    const rootTags = resolveTags(rootId, options && options.rootTags);
    const rootNoteMeta = resolveNoteMeta(rootId, options && options.rootNoteMeta ? options.rootNoteMeta : node);
    if (nodeUrl) {
        const bookmarkPayload = {
            id: node.id ? String(node.id) : undefined,
            title: nodeTitle || nodeUrl || (isZh ? '书签' : 'Bookmark'),
            url: nodeUrl,
            type: 'bookmark',
            __canvasPayloadSource: 'permanent',
            children: []
        };
        if (rootTags.length) bookmarkPayload.tags = rootTags;
        applyNoteMetaToBookmarkPayload(bookmarkPayload, rootNoteMeta);
        return bookmarkPayload;
    }

    const rootPayload = {
        id: node.id ? String(node.id) : undefined,
        title: nodeTitle || (isZh ? '文件夹' : 'Folder'),
        url: '',
        type: 'folder',
        __canvasPayloadSource: 'permanent',
        children: []
    };
    if (rootTags.length) rootPayload.tags = rootTags;
    applyNoteMetaToBookmarkPayload(rootPayload, rootNoteMeta);

    const stack = [{ source: node, target: rootPayload, index: 0 }];
    let scanned = 0;

    while (stack.length) {
        const frame = stack[stack.length - 1];
        const children = Array.isArray(frame.source.children) ? frame.source.children : [];

        if (frame.index >= children.length) {
            stack.pop();
            continue;
        }

        const child = children[frame.index];
        frame.index += 1;
        if (!child) continue;

        const childUrl = typeof child.url === 'string' ? child.url : '';
        const childTitle = typeof child.title === 'string' ? child.title : '';
        const childId = child && child.id ? String(child.id) : '';
        const childTags = resolveTags(childId);
        const childNoteMeta = resolveNoteMeta(childId, child);

        if (childUrl) {
            const childPayload = {
                id: child.id ? String(child.id) : undefined,
                title: childTitle || childUrl || (isZh ? '书签' : 'Bookmark'),
                url: childUrl,
                type: 'bookmark',
                __canvasPayloadSource: 'permanent',
                children: []
            };
            if (childTags.length) childPayload.tags = childTags;
            applyNoteMetaToBookmarkPayload(childPayload, childNoteMeta);
            frame.target.children.push(childPayload);
        } else {
            const folderPayload = {
                id: child.id ? String(child.id) : undefined,
                title: childTitle || (isZh ? '文件夹' : 'Folder'),
                url: '',
                type: 'folder',
                __canvasPayloadSource: 'permanent',
                children: []
            };
            if (childTags.length) folderPayload.tags = childTags;
            applyNoteMetaToBookmarkPayload(folderPayload, childNoteMeta);
            frame.target.children.push(folderPayload);

            if (Array.isArray(child.children) && child.children.length) {
                stack.push({ source: child, target: folderPayload, index: 0 });
            }
        }

        scanned += 1;
        if (scanned % TEMP_SECTION_BUILD_YIELD_EVERY === 0) {
            await yieldToMainThread();
        }
    }

    return rootPayload;
}

function getInsertBatchSize(total) {
    const count = Number(total) || 0;
    if (count <= TEMP_SECTION_INSERT_CHUNK_THRESHOLD) return count;
    return TEMP_SECTION_INSERT_BATCH_SIZE;
}

async function insertPayloadWithBatches(tempApi, sectionId, payloadItems, parentId = null, options = {}) {
    if (!tempApi || !sectionId || !Array.isArray(payloadItems) || !payloadItems.length) return;

    if (typeof tempApi.insertFromPayload !== 'function') {
        return;
    }

    const insertOptions = options && typeof options === 'object' ? options : {};
    const total = payloadItems.length;
    const batchSize = getInsertBatchSize(total);
    if (!batchSize || batchSize >= total) {
        tempApi.insertFromPayload(sectionId, parentId, payloadItems, null, insertOptions);
        return;
    }

    for (let i = 0; i < total; i += batchSize) {
        const chunk = payloadItems.slice(i, i + batchSize);
        tempApi.insertFromPayload(sectionId, parentId, chunk, null, insertOptions);
        if (i + batchSize < total) {
            await yieldToMainThread();
        }
    }
}

function isLargeFolderPayload(payload) {
    if (!payload || payload.type !== 'folder') return false;
    const rootChildren = Array.isArray(payload.children) ? payload.children : [];
    if (rootChildren.length >= TEMP_SECTION_LARGE_FOLDER_CHILD_THRESHOLD) return true;

    const stack = [payload];
    let count = 0;
    while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        count += 1;
        if (count >= TEMP_SECTION_LARGE_FOLDER_NODE_THRESHOLD) return true;

        const children = Array.isArray(node.children) ? node.children : [];
        for (let i = children.length - 1; i >= 0; i -= 1) {
            stack.push(children[i]);
        }
    }
    return false;
}

async function insertLargeFolderPayload(tempApi, sectionId, folderPayload, fallbackTitle, options = {}) {
    if (!tempApi || !sectionId || !folderPayload || folderPayload.type !== 'folder') return false;
    if (typeof tempApi.createFolder !== 'function' || typeof tempApi.insertFromPayload !== 'function') return false;

    const folderTitle = folderPayload.title || fallbackTitle || 'Folder';
    const createOptions = {};
    if (folderPayload.__canvasPayloadSource) createOptions.__canvasPayloadSource = folderPayload.__canvasPayloadSource;
    const folderId = tempApi.createFolder(sectionId, '', folderTitle, createOptions);
    if (!folderId) return false;

    const children = Array.isArray(folderPayload.children) ? folderPayload.children : [];
    if (!children.length) return true;

    await insertPayloadWithBatches(tempApi, sectionId, children, folderId, options);
    return true;
}

async function createTempSectionFromSearchResults() {
    if (getCurrentViewSafe() !== 'canvas') return;
    if (!window.CanvasModule || !window.CanvasModule.createEmptyTempSection || !window.CanvasModule.temp) return;
    if (isTempSectionCreationInProgress) {
        const isZhBusy = currentLang === 'zh_CN';
        showCanvasToastSafe(isZhBusy ? '正在生成临时栏目，请稍候…' : 'Creating temp section, please wait…', 'warning', 1800);
        return;
    }

    isTempSectionCreationInProgress = true;
    try {
        const items = collectBookmarkItemsForTempSection();
        if (!items.length) return;

        const isZh = currentLang === 'zh_CN';
        showCanvasToastSafe(isZh ? '正在生成临时栏目…' : 'Creating temp section…', 'info', 1800);

        const pos = getCanvasViewportCenterForTemp();
        const sectionId = window.CanvasModule.createEmptyTempSection(pos.x, pos.y, {
            title: '',
            label: isZh ? '搜索' : 'Search',
            source: 'search-result',
            colorLocked: true
        });
        if (!sectionId) return;

        const tempApi = window.CanvasModule.temp;
        const section = tempApi && typeof tempApi.getSection === 'function'
            ? tempApi.getSection(sectionId)
            : null;
        if (section) {
            section.title = isZh ? '搜索结果' : 'Search Results';
            section.label = isZh ? '搜索' : 'Search';
            section.colorLocked = true;
            section.source = 'search-result';
        }

        const getPermanentTreeRoot = async () => {
            try {
                const bridge = window.CanvasProtocolBridge;
                if (bridge && typeof bridge.readPermanentTreeSnapshotFromBcs === 'function') {
                    const tree = await bridge.readPermanentTreeSnapshotFromBcs({
                        assumeCleanWhenMissingState: true
                    });
                    if (Array.isArray(tree) && tree[0]) return tree[0];
                }
            } catch (_) { }
            try {
                if (typeof cachedCurrentTree !== 'undefined' && Array.isArray(cachedCurrentTree)) return cachedCurrentTree[0] || null;
            } catch (_) { }
            try {
                if (typeof window !== 'undefined' && Array.isArray(window.cachedCurrentTree)) return window.cachedCurrentTree[0] || null;
            } catch (_) { }
            return null;
        };

        const needsPermanentLookup = items.some(item => item && item.source === 'permanent');
        let permanentNodeMap = null;
        let resolvePermanentNodeTags = null;
        let resolvePermanentNodeNotes = null;
        if (needsPermanentLookup) {
            showCanvasToastSafe(isZh ? '正在整理文件夹结构…' : 'Preparing folder structure…', 'info', 1600);
            permanentNodeMap = await buildPermanentNodeMap(await getPermanentTreeRoot());
            try {
                if (typeof window !== 'undefined'
                    && window.TagSystem
                    && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                    await window.TagSystem.ensurePermTagsLoaded();
                }
            } catch (_) { }
            try {
                if (typeof window !== 'undefined'
                    && window.NoteSystem
                    && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
                    await window.NoteSystem.ensurePermNotesLoaded();
                }
            } catch (_) { }
            resolvePermanentNodeTags = (chromeId) => readPermanentNodeTagsCachedForPayload(chromeId);
            resolvePermanentNodeNotes = (chromeId) => readPermanentNodeNoteMetaCachedForPayload(chromeId);
        }

        const payloadItems = [];
        let insertedDirectCount = 0;
        let processed = 0;
        const appendPayloadList = async (payload, fallbackTitle) => {
            if (!payload || !payload.length) return;
            for (let j = 0; j < payload.length; j += 1) {
                const payloadItem = payload[j];
                if (!payloadItem) continue;

                if (isLargeFolderPayload(payloadItem)) {
                    const inserted = await insertLargeFolderPayload(
                        tempApi,
                        sectionId,
                        payloadItem,
                        fallbackTitle || (isZh ? '文件夹' : 'Folder')
                    );
                    if (inserted) {
                        insertedDirectCount += 1;
                        await yieldToMainThread();
                        continue;
                    }
                }

                payloadItems.push(payloadItem);
            }
        };

        for (let i = 0; i < items.length; i += 1) {
            const item = items[i];
            if (!item) continue;

            if (item.source === 'permanent' && permanentNodeMap) {
                const node = permanentNodeMap.get(String(item.id));
                const built = await buildPayloadFromPermanentNode(node, isZh, {
                    resolvePermanentNodeTags,
                    resolvePermanentNodeNotes,
                    rootTags: item.tags,
                    rootNoteMeta: item
                });
                if (built) {
                    await appendPayloadList([built], item.title || (isZh ? '文件夹' : 'Folder'));
                    processed += 1;
                    if (processed % TEMP_SECTION_BUILD_YIELD_EVERY === 0) {
                        await yieldToMainThread();
                    }
                    continue;
                }
                throw new Error(isZh ? '永久搜索结果无法构建负载，无法创建临时栏目。' : 'Failed to build payload from permanent search result; cannot create a temporary section.');
            }

            if (item.nodeType === 'folder') {
                let payload = null;
                if (item.source === 'temporary' && item.sectionId && typeof tempApi.extractPayload === 'function') {
                    try {
                        payload = tempApi.extractPayload(item.sectionId, [item.id]);
                    } catch (_) { }
                }

                if (payload && payload.length) {
                    await appendPayloadList(payload, item.title || (isZh ? '文件夹' : 'Folder'));
                } else {
                    const fallbackPayload = {
                        ...(item.source === 'permanent' && item.id ? { id: String(item.id), __canvasPayloadSource: 'permanent' } : {}),
                        title: item.title || (isZh ? '文件夹' : 'Folder'),
                        url: '',
                        type: 'folder',
                        children: []
                    };
                    const fallbackTags = normalizeTagsForPayload(
                        (item && Array.isArray(item.tags) && item.tags.length)
                            ? item.tags
                            : (item && item.source === 'permanent' && item.id
                                ? readPermanentNodeTagsCachedForPayload(item.id)
                                : [])
                    );
                    if (fallbackTags.length) fallbackPayload.tags = fallbackTags;
                    const fallbackNoteMeta = normalizeNoteMetaForPayload(item && item.note, item && item.noteColor);
                    applyNoteMetaToBookmarkPayload(
                        fallbackPayload,
                        fallbackNoteMeta.note
                            ? fallbackNoteMeta
                            : (item && item.source === 'permanent' && item.id
                                ? readPermanentNodeNoteMetaCachedForPayload(item.id)
                                : null)
                    );
                    payloadItems.push(fallbackPayload);
                }
            } else {
                payloadItems.push(buildSearchBookmarkPayload(item, isZh));
            }

            processed += 1;
            if (processed % TEMP_SECTION_BUILD_YIELD_EVERY === 0) {
                await yieldToMainThread();
            }
        }

        showCanvasToastSafe(
            isZh
                ? `正在写入临时栏目…（${payloadItems.length + insertedDirectCount}）`
                : `Writing temp section… (${payloadItems.length + insertedDirectCount})`,
            'info',
            1600
        );

        await insertPayloadWithBatches(tempApi, sectionId, payloadItems, null, { defaultCollapseFolders: true });

        try {
            if (window.CanvasModule && typeof window.CanvasModule.scheduleDormancyUpdate === 'function') {
                window.CanvasModule.scheduleDormancyUpdate();
            }
        } catch (_) { }

        try {
            if (window.CanvasModule && typeof window.CanvasModule.locateSection === 'function') {
                window.CanvasModule.locateSection(sectionId);
            }
        } catch (_) { }

        try {
            const state = getActiveCanvasState();
            if (state) {
                state.tempStateTimestamp = Date.now();
            }
        } catch (_) { }

        showCanvasToastSafe(
            isZh
                ? `已生成并定位临时栏目（${payloadItems.length + insertedDirectCount}）`
                : `Temp section created and located (${payloadItems.length + insertedDirectCount})`,
            'success',
            2600
        );
    } catch (error) {
        const isZh = currentLang === 'zh_CN';
        showCanvasToastSafe(
            isZh
                ? `生成临时栏目失败：${error && error.message ? error.message : '未知错误'}`
                : `Failed to create temp section: ${error && error.message ? error.message : 'Unknown error'}`,
            'error',
            3200
        );
    } finally {
        isTempSectionCreationInProgress = false;
    }
}

async function createTempSectionFromDomainResult(domain) {
    if (getCurrentViewSafe() !== 'canvas') return;
    if (!window.CanvasModule || !window.CanvasModule.createEmptyTempSection || !window.CanvasModule.temp) return;

    if (isTempSectionCreationInProgress) {
        const isZhBusy = currentLang === 'zh_CN';
        showCanvasToastSafe(isZhBusy ? '正在生成临时栏目，请稍候…' : 'Creating temp section, please wait…', 'warning', 1800);
        return;
    }

    isTempSectionCreationInProgress = true;
    try {

        const isZh = currentLang === 'zh_CN';
        const domainKey = String(domain || '').trim().toLowerCase();
        if (!domainKey) return;
        const groupBySubdomainFolders = (searchUiState && searchUiState.domainGrouping === 'root');

        try {
            if (typeof window !== 'undefined'
                && window.TagSystem
                && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                await window.TagSystem.ensurePermTagsLoaded();
                if (searchUiState && searchUiState.domainIndexCache) {
                    searchUiState.domainIndexCache = null;
                }
            }
        } catch (_) { }
        try {
            if (typeof window !== 'undefined'
                && window.NoteSystem
                && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
                await window.NoteSystem.ensurePermNotesLoaded();
                if (searchUiState && searchUiState.domainIndexCache) {
                    searchUiState.domainIndexCache = null;
                }
            }
        } catch (_) { }

        const items = getDomainItemsForTemp(domainKey, searchUiState.query || '');
        if (!items.length) return;

        showCanvasToastSafe(isZh ? '正在生成域名临时栏目…' : 'Creating domain temp section…', 'info', 1800);

        const pos = getCanvasViewportCenterForTemp();
        const sectionId = window.CanvasModule.createEmptyTempSection(pos.x, pos.y, {
            title: '',
            label: isZh ? '搜索' : 'Search',
            source: 'search-result',
            colorLocked: true
        });
        if (!sectionId) return;

        const tempApi = window.CanvasModule.temp;
        const section = tempApi && typeof tempApi.getSection === 'function'
            ? tempApi.getSection(sectionId)
            : null;
        if (section) {
            section.title = groupBySubdomainFolders
                ? (isZh ? `域名: ${domainKey}（子域名分组）` : `Domain: ${domainKey} (Subdomain groups)`)
                : (isZh ? `域名: ${domainKey}` : `Domain: ${domainKey}`);
            section.label = isZh ? '搜索' : 'Search';
            section.colorLocked = true;
            section.source = 'search-result';
        }

        let payloadItems = [];
        if (groupBySubdomainFolders) {
            payloadItems = await buildDomainPayloadBySubdomain(items, domainKey, isZh);
        }

        if (!payloadItems.length) {
            let processed = 0;
            for (let i = 0; i < items.length; i += 1) {
                const item = items[i];
                if (!item) continue;
                const safeTitle = item.title || item.url || (isZh ? '书签' : 'Bookmark');
                const safeUrl = item.url || 'https://';
                payloadItems.push(buildSearchBookmarkPayload({
                    ...item,
                    title: safeTitle,
                    url: safeUrl
                }, isZh));

                processed += 1;
                if (processed % TEMP_SECTION_BUILD_YIELD_EVERY === 0) {
                    await yieldToMainThread();
                }
            }
        }

        const folderCount = payloadItems.filter(item => item && item.type === 'folder').length;
        const bookmarkCount = items.length;

        showCanvasToastSafe(
            groupBySubdomainFolders
                ? (isZh
                    ? `正在按子域名写入…（${folderCount} 个文件夹 / ${bookmarkCount}）`
                    : `Writing by subdomain… (${folderCount} folders / ${bookmarkCount})`)
                : (isZh
                    ? `正在写入域名结果…（${payloadItems.length}）`
                    : `Writing domain results… (${payloadItems.length})`),
            'info',
            1600
        );

        await insertPayloadWithBatches(tempApi, sectionId, payloadItems, null, { defaultCollapseFolders: true });

        try {
            if (window.CanvasModule && typeof window.CanvasModule.scheduleDormancyUpdate === 'function') {
                window.CanvasModule.scheduleDormancyUpdate();
            }
        } catch (_) { }

        try {
            if (window.CanvasModule && typeof window.CanvasModule.locateSection === 'function') {
                window.CanvasModule.locateSection(sectionId);
            }
        } catch (_) { }

        try {
            const state = getActiveCanvasState();
            if (state) {
                state.tempStateTimestamp = Date.now();
            }
        } catch (_) { }

        showCanvasToastSafe(
            groupBySubdomainFolders
                ? (isZh
                    ? `已按子域名生成并定位（${folderCount} 组 / ${bookmarkCount}）`
                    : `Subdomain-grouped temp section created (${folderCount} groups / ${bookmarkCount})`)
                : (isZh
                    ? `已生成并定位域名栏目（${payloadItems.length}）`
                    : `Domain temp section created and located (${payloadItems.length})`),
            'success',
            2600
        );
    } catch (error) {
        const isZh = currentLang === 'zh_CN';
        showCanvasToastSafe(
            isZh
                ? `生成域名临时栏目失败：${error && error.message ? error.message : '未知错误'}`
                : `Failed to create domain temp section: ${error && error.message ? error.message : 'Unknown error'}`,
            'error',
            3200
        );
    } finally {
        isTempSectionCreationInProgress = false;
    }
}

// ==================== Phase 3: 定位与高亮 ====================

/**
 * 展开树项的所有祖先节点
 * @param {Element} treeItem - 树项 DOM 元素
 * @param {Element} previewContainer - 预览容器
 */
function expandAncestorsForTreeItem(treeItem, previewContainer) {
    try {
        let parent = treeItem.parentElement;
        while (parent && parent !== previewContainer) {
            if (parent.classList.contains('tree-children')) {
                parent.classList.add('expanded');
            }

            const parentItem = parent.previousElementSibling;
            if (parentItem && parentItem.classList.contains('tree-item')) {
                const toggle = parentItem.querySelector('.tree-toggle');
                if (toggle) toggle.classList.add('expanded');

                const folderIcon = parentItem.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
                if (folderIcon) {
                    folderIcon.classList.remove('fa-folder');
                    folderIcon.classList.add('fa-folder-open');
                }

                const parentId = parentItem.getAttribute('data-node-id');
                if (parentId) {
                    // Canvas 独立版不保存“变化预览”的展开状态
                }
            }

            parent = parent.parentElement;
        }
    } catch (_) { }
}

function persistSearchLocateTreeExpandState(treeContainer) {
    if (!treeContainer) return;
    try {
        if (typeof __saveTreeExpandStateToStorage === 'function') {
            __saveTreeExpandStateToStorage(treeContainer);
            return;
        }
    } catch (_) { }
    try {
        if (typeof saveTreeExpandState === 'function') {
            saveTreeExpandState(treeContainer);
        }
    } catch (_) { }
}

function persistTempSearchLocateExpandState(sectionId, folderIds) {
    const sid = String(sectionId || '').trim();
    if (!sid || !Array.isArray(folderIds) || !folderIds.length) return;
    let changed = false;

    try {
        if (typeof LAZY_LOAD_THRESHOLD === 'undefined' || !LAZY_LOAD_THRESHOLD) return;
        if (!(LAZY_LOAD_THRESHOLD.expandedFolders instanceof Set)) {
            LAZY_LOAD_THRESHOLD.expandedFolders = new Set();
        }
        if (!(LAZY_LOAD_THRESHOLD.collapsedFolders instanceof Set)) {
            LAZY_LOAD_THRESHOLD.collapsedFolders = new Set();
        }

        folderIds.forEach((folderId) => {
            const fid = String(folderId || '').trim();
            if (!fid) return;
            const key = `${sid}-${fid}`;
            if (!LAZY_LOAD_THRESHOLD.expandedFolders.has(key)) changed = true;
            if (LAZY_LOAD_THRESHOLD.collapsedFolders.has(key)) changed = true;
            LAZY_LOAD_THRESHOLD.expandedFolders.add(key);
            LAZY_LOAD_THRESHOLD.collapsedFolders.delete(key);
        });
    } catch (_) {
        return;
    }

    if (!changed) return;
    try {
        if (typeof saveTempExpandState === 'function') {
            saveTempExpandState();
        }
    } catch (_) { }
}

function clearSearchTreeItemOutline() {
    try {
        // Clear outline info
        document.querySelectorAll('.tree-item.search-locate-outline').forEach(el => {
            try {
                el.classList.remove('search-locate-outline');
                el.style.removeProperty('--search-highlight-color');
            } catch (_) { }
        });
        document.querySelectorAll('.tree-locate-group-outline').forEach(el => {
            try { el.remove(); } catch (_) { }
        });
        // Clear selected state (optional, but good for exclusive search selection)
        // Only clear those we marked? Or all? Standard tree might have its own selection.
        // Let's only clear ".selected" if we are sure we want to hijack selection.
        // For search result navigation, replacing selection is expected.
        document.querySelectorAll('.tree-item.selected').forEach(el => {
            el.classList.remove('selected');
        });
    } catch (_) { }
}

function highlightSearchTreeItemOutline(treeItem, color = '#2563eb', doClear = true) {
    if (!treeItem) return;
    try {
        if (doClear) clearSearchTreeItemOutline();

        // 1. Outline & Color (Animation)
        treeItem.style.setProperty('--search-highlight-color', color);
        treeItem.classList.add('search-locate-outline');

        // 2. Timeout for Outline (Animation)
        setTimeout(() => {
            try {
                treeItem.classList.remove('search-locate-outline');
                treeItem.style.removeProperty('--search-highlight-color');
            } catch (_) { }
        }, 2000);
    } catch (_) { }
}

let searchTreeItemLocateCenterToken = 0;

function getTreeItemScrollableContainer(treeItem) {
    if (!treeItem || !treeItem.closest) return null;

    const preferred = treeItem.closest('.permanent-section-body, .temp-node-body');
    if (preferred) return preferred;

    let current = treeItem.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
        try {
            const style = window.getComputedStyle(current);
            const overflowY = style ? String(style.overflowY || '').toLowerCase() : '';
            const canScrollY = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
                && current.scrollHeight > current.clientHeight + 1;
            if (canScrollY) return current;
        } catch (_) { }
        current = current.parentElement;
    }

    return null;
}

function getScrollableTreeContainerScrollBaseKey(container) {
    if (!container || !container.classList) return null;

    try {
        if (container.classList.contains('permanent-section-body')) {
            const sectionEl = container.closest('.permanent-bookmark-section');
            if (sectionEl && typeof __getPermanentSectionScrollBaseKey === 'function') {
                return __getPermanentSectionScrollBaseKey(sectionEl);
            }
        }
    } catch (_) { }

    try {
        if (container.classList.contains('temp-node-body')) {
            const nodeEl = container.closest('.temp-canvas-node');
            const sectionId = nodeEl && nodeEl.dataset ? nodeEl.dataset.sectionId : null;
            if (sectionId && typeof __getTempSectionScrollBaseKey === 'function') {
                return __getTempSectionScrollBaseKey(sectionId);
            }
        }
    } catch (_) { }

    return null;
}

function persistScrollableTreeContainerPosition(container) {
    if (!container || typeof saveViewState !== 'function') return;

    const baseKey = getScrollableTreeContainerScrollBaseKey(container);
    if (!baseKey) return;

    try {
        saveViewState('scroll', baseKey, {
            top: Math.max(0, container.scrollTop || 0),
            left: Math.max(0, container.scrollLeft || 0)
        });
    } catch (_) { }
}

function lockScrollableTreeContainerRestore(container, durationMs = 1800) {
    if (!container || !container.dataset) return;
    try {
        container.dataset.scrollRestoreBlockUntil = String(Date.now() + Math.max(0, durationMs));
    } catch (_) { }
}

function getScrollableTreeContainerVisualScale(container) {
    if (!container || typeof container.getBoundingClientRect !== 'function') {
        return { rect: null, scaleX: 1, scaleY: 1 };
    }

    try {
        const rect = container.getBoundingClientRect();
        const clientWidth = Math.max(1, Number(container.clientWidth) || 0);
        const clientHeight = Math.max(1, Number(container.clientHeight) || 0);
        let scaleX = rect && Number.isFinite(rect.width) && rect.width > 0
            ? rect.width / clientWidth
            : 1;
        let scaleY = rect && Number.isFinite(rect.height) && rect.height > 0
            ? rect.height / clientHeight
            : 1;

        if (!Number.isFinite(scaleX) || scaleX <= 0) scaleX = 1;
        if (!Number.isFinite(scaleY) || scaleY <= 0) scaleY = 1;

        return { rect, scaleX, scaleY };
    } catch (_) {
        return { rect: null, scaleX: 1, scaleY: 1 };
    }
}

function centerTreeItemInScrollableContainer(treeItem, options = {}) {
    if (!treeItem) return false;

    const container = getTreeItemScrollableContainer(treeItem);
    if (!container) return false;

    try {
        const itemRect = treeItem.getBoundingClientRect();
        const scaleInfo = getScrollableTreeContainerVisualScale(container);
        const containerRect = scaleInfo.rect || container.getBoundingClientRect();
        const scaleY = Number.isFinite(scaleInfo.scaleY) && scaleInfo.scaleY > 0
            ? scaleInfo.scaleY
            : 1;
        const viewportHeight = Math.max(1, Number(container.clientHeight) || 0);
        const currentScrollTop = Math.max(0, Number(container.scrollTop) || 0);
        const innerVisualTop = containerRect.top + ((Number(container.clientTop) || 0) * scaleY);
        const itemVisualTop = Number.isFinite(itemRect.top) ? itemRect.top : innerVisualTop;
        const itemVisualHeight = Number.isFinite(itemRect.height) && itemRect.height > 0
            ? itemRect.height
            : Math.max(1, (Number(treeItem.offsetHeight) || 0) * scaleY);
        const itemTopInLayout = currentScrollTop + ((itemVisualTop - innerVisualTop) / scaleY);
        const itemHeightInLayout = Math.max(1, itemVisualHeight / scaleY);
        const rawTargetTop = itemTopInLayout - ((viewportHeight - itemHeightInLayout) / 2);
        const maxScrollTop = Math.max(0, (container.scrollHeight || 0) - (container.clientHeight || 0));
        const targetTop = Math.max(0, Math.min(maxScrollTop, rawTargetTop));
        lockScrollableTreeContainerRestore(container, options.lockMs);
        if (Math.abs((container.scrollTop || 0) - targetTop) > 0.5) {
            container.scrollTop = targetTop;
        }
        if (options.persist !== false) {
            persistScrollableTreeContainerPosition(container);
        }
        return true;
    } catch (_) {
        return false;
    }
}

function waitForSearchLocateAnimationFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
            return;
        }
        setTimeout(resolve, 16);
    });
}

function waitForSearchLocateDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function waitForSearchLocateAnimationFrames(count = 1) {
    const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    for (let i = 0; i < total; i++) {
        await waitForSearchLocateAnimationFrame();
    }
}

async function waitForTreeMutationsToSettle(treeContainer, options = {}) {
    const idleMs = Number.isFinite(options.idleMs) ? Math.max(0, options.idleMs) : 80;
    const maxMs = Number.isFinite(options.maxMs) ? Math.max(idleMs, options.maxMs) : 700;

    if (!treeContainer || typeof MutationObserver === 'undefined') {
        await waitForSearchLocateDelay(idleMs);
        return;
    }

    await new Promise((resolve) => {
        let finished = false;
        let idleTimer = 0;
        let maxTimer = 0;
        let observer = null;

        const finish = () => {
            if (finished) return;
            finished = true;
            if (idleTimer) clearTimeout(idleTimer);
            if (maxTimer) clearTimeout(maxTimer);
            try {
                if (observer) observer.disconnect();
            } catch (_) { }
            resolve();
        };

        const scheduleIdle = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(finish, idleMs);
        };

        try {
            observer = new MutationObserver(() => {
                scheduleIdle();
            });
            observer.observe(treeContainer, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class', 'data-children-loaded', 'data-start-index']
            });
        } catch (_) { }

        scheduleIdle();
        maxTimer = setTimeout(finish, maxMs);
    });
}

function expandTreeFolderVisualState(treeItem) {
    if (!treeItem) return null;
    const treeNode = treeItem.closest('.tree-node');
    const children = treeNode ? treeNode.querySelector(':scope > .tree-children') : null;
    if (!children) return null;

    try { children.classList.add('expanded'); } catch (_) { }
    try {
        const toggle = treeItem.querySelector('.tree-toggle');
        if (toggle) toggle.classList.add('expanded');
    } catch (_) { }
    try {
        const folderIcon = treeItem.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
        if (folderIcon) {
            folderIcon.classList.remove('fa-folder');
            folderIcon.classList.add('fa-folder-open');
        }
    } catch (_) { }

    return children;
}

async function finalizeTreeItemCentering(treeContainer, resolveTarget, token) {
    await waitForSearchLocateAnimationFrames(2);
    await waitForTreeMutationsToSettle(treeContainer, { idleMs: 90, maxMs: 900 });

    if (token !== searchTreeItemLocateCenterToken) return null;
    const currentTarget = (typeof resolveTarget === 'function') ? resolveTarget() : null;
    if (!currentTarget) return null;

    if (!centerTreeItemInScrollableContainer(currentTarget, { lockMs: 2200, persist: true })) {
        if (typeof currentTarget.scrollIntoView === 'function') {
            try {
                currentTarget.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            } catch (_) {
                try { currentTarget.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) { }
            }
        }
    }

    await waitForSearchLocateAnimationFrames(1);
    if (token !== searchTreeItemLocateCenterToken) return null;

    const latestTarget = (typeof resolveTarget === 'function') ? resolveTarget() : null;
    if (latestTarget) {
        centerTreeItemInScrollableContainer(latestTarget, { lockMs: 2200, persist: true });
    }
    return latestTarget || currentTarget;
}

async function ensurePermanentSearchFolderExpanded(treeItem) {
    if (!treeItem || treeItem.dataset.nodeType !== 'folder') return;
    const children = expandTreeFolderVisualState(treeItem);
    if (!children) return;

    if (treeItem.dataset && treeItem.dataset.childrenLoaded === 'false' && treeItem.dataset.hasChildren === 'true') {
        if (typeof loadPermanentFolderChildrenLazy === 'function') {
            await loadPermanentFolderChildrenLazy(treeItem.dataset.nodeId, children, 0, null);
        }
    }
}

async function ensureTempSearchFolderExpanded(sectionObj, treeItem) {
    if (!treeItem || treeItem.dataset.nodeType !== 'folder') return;
    const children = expandTreeFolderVisualState(treeItem);
    if (!children) return;

    if (treeItem.dataset && treeItem.dataset.childrenLoaded === 'false' && treeItem.dataset.hasChildren === 'true') {
        if (window.CanvasModule && typeof window.CanvasModule.loadFolderChildren === 'function') {
            window.CanvasModule.loadFolderChildren(sectionObj, treeItem.dataset.nodeId, children);
            return;
        }
        if (typeof loadFolderChildren === 'function') {
            loadFolderChildren(sectionObj, treeItem.dataset.nodeId, children);
        }
    }
}

function shouldSkipCanvasPanForMaximizedTarget(elementId, type) {
    const targetId = String(elementId || '').trim();
    if (!targetId) return false;

    const active = document.querySelector('.canvas-node-maximized');
    if (!active || !active.classList) return false;

    if (type === 'temp-section' && active.classList.contains('temp-canvas-node')) {
        const activeId = active.dataset && active.dataset.sectionId
            ? String(active.dataset.sectionId).trim()
            : String(active.id || '').trim();
        return activeId === targetId;
    }

    if (type === 'md-node' && active.classList.contains('md-canvas-node')) {
        return String(active.id || '').trim() === targetId;
    }

    if (type === 'permanent-section' && active.classList.contains('permanent-bookmark-section')) {
        const activeCopyId = active.dataset
            ? String(active.dataset.permanentSectionCopyId || '').trim()
            : '';
        if (activeCopyId) {
            return activeCopyId === targetId;
        }
        return targetId === 'permanentSection';
    }

    return false;
}

async function exitCanvasNodeFullscreenForSearchLocate() {
    const active = document.querySelector('.canvas-node-maximized');
    if (!active || !active.classList) return false;
    const fullscreenBtn = active.querySelector('.canvas-node-fullscreen-btn, .permanent-section-fullscreen-btn, .temp-node-fullscreen-btn, .md-node-toolbar-btn[data-action="md-fullscreen"]');
    if (!fullscreenBtn || typeof fullscreenBtn.click !== 'function') return false;

    try {
        window.__canvasSearchSuppressFullscreenAutoModeCounter = Math.max(
            Number(window.__canvasSearchSuppressFullscreenAutoModeCounter || 0),
            1
        );
    } catch (_) { }

    try {
        fullscreenBtn.click();
    } catch (_) {
        return false;
    }

    await waitForSearchLocateAnimationFrames(2);
    return !document.querySelector('.canvas-node-maximized');
}

async function locateCanvasGroupSearchResult(item) {
    if (!item || !item.id) return false;

    // Reuse the directory's card-group locator: it fits the group's stored
    // rect, drives the shared viewport navigation, then wakes and highlights
    // virtualized groups after they enter the viewport.
    try {
        const directory = window.CanvasSidebarDirectory;
        if (directory && typeof directory.locateCardGroup === 'function') {
            const located = directory.locateCardGroup(item.id, 'fit');
            if (located) {
                return true;
            }
        }
    } catch (_) { }

    // Compatibility fallback for an unavailable directory module.
    let groupElement = document.getElementById(item.id);
    if (!groupElement) {
        try {
            const module = window.CanvasModule;
            if (module && typeof module.materializeMaximizedNodeFromDescriptor === 'function') {
                groupElement = module.materializeMaximizedNodeFromDescriptor({
                    type: 'md-node',
                    id: item.id
                }) || document.getElementById(item.id);
            }
        } catch (_) { }
    }

    if (groupElement && typeof locateAndZoomToMdNode === 'function') {
        try {
            locateAndZoomToMdNode(item.id, 'fit');
            return true;
        } catch (_) { }
    }

    // If the virtualized node cannot be materialized, still navigate to its
    // persisted rect so the search result remains usable.
    const located = await locateCanvasElement(item.id, 'group', {
        color: item.color || '#7c3aed'
    });
    return located;
}

function getCanvasSearchFullscreenTargetElement(item) {
    if (!item || !item.type) return null;
    const type = String(item.type || '').trim();
    if (!type) return null;

    if (type === 'temp-section' || type === 'md-node') {
        const id = String(item.id || '').trim();
        if (!id) return null;
        return document.getElementById(id);
    }

    if (type === 'permanent-section') {
        const copyId = String(item.copyId || '').trim();
        if (copyId) return resolvePermanentSectionElementForSearch(copyId);

        const itemId = String(item.id || '').trim();
        if (itemId && itemId !== 'permanentSection') {
            const copyEl = resolvePermanentSectionElementForSearch(itemId);
            if (copyEl) return copyEl;
        }
        return resolvePermanentSectionElementForSearch(null) || document.getElementById('permanentSection');
    }

    return null;
}

async function ensureCanvasSearchResultTargetFullscreen(item) {
    if (!item || !item.type) return false;
    const type = String(item.type || '').trim();
    if (type !== 'temp-section' && type !== 'md-node' && type !== 'permanent-section') return false;

    let target = getCanvasSearchFullscreenTargetElement(item);

    if (!target) {
        try {
            if (window.CanvasModule && typeof window.CanvasModule.materializeMaximizedNodeFromDescriptor === 'function') {
                const descriptor = type === 'temp-section'
                    ? { type: 'temp-node', id: String(item.id || '').trim() }
                    : (type === 'md-node'
                        ? { type: 'md-node', id: String(item.id || '').trim() }
                        : null);
                if (descriptor) {
                    target = window.CanvasModule.materializeMaximizedNodeFromDescriptor(descriptor);
                }
            }
            if (!target && type === 'temp-section' && window.CanvasModule && typeof window.CanvasModule.forceWakeAndRender === 'function') {
                window.CanvasModule.forceWakeAndRender(String(item.id || '').trim());
            }
        } catch (_) { }
        await waitForSearchLocateAnimationFrames(1);
        target = target || getCanvasSearchFullscreenTargetElement(item);
    }

    if (!target) {
        try {
            await locateCanvasElement(item.id, item.type, {
                color: item.color || '#2563eb',
                disableAnimation: true
            });
        } catch (_) { }
        target = getCanvasSearchFullscreenTargetElement(item);
    }

    if (!target || !target.classList) return false;
    if (target.classList.contains('canvas-node-maximized')) return true;

    try {
        if (window.CanvasModule && typeof window.CanvasModule.wakeCanvasNodeFromLazyState === 'function') {
            window.CanvasModule.wakeCanvasNodeFromLazyState(target);
        }
    } catch (_) { }

    const fullscreenBtn = target.querySelector('.canvas-node-fullscreen-btn, .permanent-section-fullscreen-btn, .temp-node-fullscreen-btn, .md-node-toolbar-btn[data-action="md-fullscreen"]');
    if (!fullscreenBtn || typeof fullscreenBtn.click !== 'function') return false;

    try {
        // One search-triggered fullscreen switch may emit two fullscreen-context notifications:
        // restore current maximized node, then maximize target node.
        // We suppress both auto-mode applications to keep the user-selected mode stable.
        window.__canvasSearchSuppressFullscreenAutoModeCounter = Math.max(
            Number(window.__canvasSearchSuppressFullscreenAutoModeCounter || 0),
            2
        );
    } catch (_) { }

    try {
        fullscreenBtn.click();
    } catch (_) {
        return false;
    }

    await waitForSearchLocateAnimationFrames(1);
    return target.classList.contains('canvas-node-maximized') || !!document.querySelector('.canvas-node-maximized');
}

function isMaximizedTempSectionActive(sectionId) {
    const sid = String(sectionId || '').trim();
    if (!sid) return false;
    const active = document.querySelector('.temp-canvas-node.canvas-node-maximized');
    if (!active) return false;
    const activeId = active.dataset && active.dataset.sectionId
        ? String(active.dataset.sectionId).trim()
        : String(active.id || '').trim();
    return activeId === sid;
}

function isMaximizedPermanentSectionActive(copyId = null) {
    const active = document.querySelector('.permanent-bookmark-section.canvas-node-maximized');
    if (!active) return false;

    const activeCopyId = active.dataset
        ? String(active.dataset.permanentSectionCopyId || '').trim()
        : '';
    const targetCopyId = String(copyId || '').trim();

    if (targetCopyId) {
        return activeCopyId === targetCopyId;
    }
    return !activeCopyId;
}

function resolvePermanentSectionElementForSearch(copyId = null) {
    const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionElement === 'function'
        ? window.CanvasProtocolBridge
        : null;
    if (protocolBridge) {
        try {
            const resolved = protocolBridge.resolvePermanentSectionElement(copyId);
            if (resolved) return resolved;
        } catch (_) { }
    }

    const safeCopyId = String(copyId || '').trim();
    if (!safeCopyId) return document.getElementById('permanentSection');

    try {
        return document.querySelector(`.permanent-bookmark-section[data-permanent-section-copy-id="${CSS.escape(safeCopyId)}"]`)
            || document.getElementById(`permanent-section-copy-${safeCopyId}`);
    } catch (_) {
        return document.getElementById(`permanent-section-copy-${safeCopyId}`);
    }
}

async function locateBookmarkItemInPermanentTree(nodeId, options = {}) {
    const id = String(nodeId || '');
    if (!id) return false;
    const locateToken = ++searchTreeItemLocateCenterToken;
    const shouldOutlineTarget = options.suppressOutline !== true;

    // 先把永久栏目卡片定位到视口（复用 Storage-first 的缩放/平移逻辑）
    try {
        if (typeof currentView !== 'undefined' && currentView === 'canvas') {
            const sameMaximizedTarget = isMaximizedPermanentSectionActive(options.copyId || null);
            if (sameMaximizedTarget) {
                // 当前就在目标全屏栏目，不触发画布平移，避免全屏层级抖动
            } else {
            // locateCanvasElement(id, classPart, ...)
            // 'permanent-section' matches id="permanentSection" via helper or manual logic?
            // Actually locateCanvasElement's second arg is expected class substring or similar.
            // But let's check if we can rely on it for copies.
            // If copyId is set, locateCanvasElement might fail if it relies on ID.
            // locateToElement logic handles arbitrary element.
            // Let's manually find element if it's a copy.

                if (options.copyId) {
                    let copyEl = resolvePermanentSectionElementForSearch(options.copyId);
                    if (!copyEl) {
                        // 如果 DOM 节点不存在，通过存储坐标平移画布，促使虚拟滚动重新创建该 DOM 节点
                        await locateCanvasElement(options.copyId, 'permanent-section', { color: options.color || '#059669' });
                        await waitForSearchLocateAnimationFrames(2);
                        copyEl = resolvePermanentSectionElementForSearch(options.copyId);
                    } else {
                        locateToElement(copyEl);
                        await waitForSearchLocateAnimationFrames(2);
                    }
                } else {
                    await locateCanvasElement('permanentSection', 'permanent-section', { color: options.color || '#059669' });
                    await waitForSearchLocateAnimationFrames(2);
                }
            }
        }
    } catch (_) { }

    const permanentSection = resolvePermanentSectionElementForSearch(options.copyId || null);

    // 强行唤醒并加载永久栏目 DOM 和树，以防止因卡片懒加载或虚拟滚动导致树内容为空而无法定位
    if (permanentSection) {
        let needWake = false;
        if (permanentSection.classList.contains('canvas-viewport-lazy-shell') || 
            (permanentSection.dataset && permanentSection.dataset.viewportLazy === 'true')) {
            needWake = true;
            permanentSection.classList.remove('canvas-viewport-lazy-shell');
            if (permanentSection.dataset) {
                delete permanentSection.dataset.viewportLazy;
            }
        }
        
        // 临时退出低细节模式，确保可见
        if (permanentSection.classList.contains('low-detail-active')) {
            permanentSection.classList.remove('low-detail-active');
            const overlay = permanentSection.querySelector('.permanent-node-low-detail-overlay');
            if (overlay) {
                try { overlay.remove(); } catch (_) { }
            }
        }

        const tree = permanentSection.querySelector('.bookmark-tree') || permanentSection.querySelector('#bookmarkTree');
        const isUnloaded = tree && (
            (tree.dataset && tree.dataset.contentUnloaded === 'true') ||
            (permanentSection.classList && permanentSection.classList.contains('permanent-tree-unloaded'))
        );
        if (isUnloaded || needWake) {
            if (tree) {
                try { tree.style.display = ''; } catch (_) { }
                try { tree.dataset.contentHidden = 'false'; } catch (_) { }
                try { tree.dataset.contentUnloaded = 'false'; } catch (_) { }

                const body = permanentSection.querySelector('.permanent-section-body');
                if (body && body.dataset) {
                    try { body.dataset.contentHidden = 'false'; } catch (_) { }
                    try { body.dataset.contentUnloaded = 'false'; } catch (_) { }
                }

                try { permanentSection.classList.remove('permanent-tree-unloaded'); } catch (_) { }
                
                const key = (permanentSection.id === 'permanentSection') 
                    ? 'permanentSection' 
                    : (permanentSection.dataset && permanentSection.dataset.permanentSectionCopyId);
                if (key && window.CanvasState && window.CanvasState.unloadedPermanentSectionTrees) {
                    try { window.CanvasState.unloadedPermanentSectionTrees.delete(key); } catch (_) { }
                }

                if (typeof window.__renderPermanentTreeIntoTree === 'function') {
                    window.__renderPermanentTreeIntoTree(tree, { force: true, reason: 'viewport-lazy-load' });
                }
            }
        }
    }

    const treeContainer = (permanentSection && permanentSection.querySelector('.bookmark-tree')) || (permanentSection && permanentSection.querySelector('#bookmarkTree')) || document.getElementById('bookmarkTree');
    if (!treeContainer) return false;

    const findTarget = () => treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`);

    let target = findTarget();

    // Canvas 永久栏目启用懒加载：目标不在 DOM 时，按祖先链逐级加载
    try {
        const index = (typeof getCachedCurrentTreeIndex === 'function') ? getCachedCurrentTreeIndex() : null;
        if (!target && index && index.get(id)) {
            const chain = [];
            let cur = index.get(id);
            let guard = 0;
            while (cur && cur.parentId && String(cur.parentId) !== '0' && guard < 80) {
                chain.push(String(cur.parentId));
                cur = index.get(String(cur.parentId));
                guard++;
            }
            chain.reverse();

            for (let i = 0; i < chain.length; i++) {
                const folderId = chain[i];
                const nextId = (i + 1 < chain.length) ? chain[i + 1] : id;

                const folderEl = treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(folderId)}"]`);
                if (!folderEl) break;

                const folderNode = folderEl.closest('.tree-node');
                const children = folderNode ? folderNode.querySelector(':scope > .tree-children') : null;
                if (!children) continue;

                // 展开
                children.classList.add('expanded');
                const toggle = folderEl.querySelector(':scope > .tree-toggle') || folderEl.querySelector('.tree-toggle');
                if (toggle) toggle.classList.add('expanded');
                const folderIcon = folderEl.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
                if (folderIcon) {
                    folderIcon.classList.remove('fa-folder');
                    folderIcon.classList.add('fa-folder-open');
                }

                // 子节点未加载：先加载首批
                if (folderEl.dataset && folderEl.dataset.childrenLoaded === 'false' && folderEl.dataset.hasChildren === 'true') {
                    if (typeof loadPermanentFolderChildrenLazy === 'function') {
                        await loadPermanentFolderChildrenLazy(folderId, children, 0, null);
                    }
                }

                // 若 nextId 仍未出现，继续按 "Load more" 追加加载
                let nextEl = treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(String(nextId))}"]`);
                let loadGuard = 0;
                while (!nextEl && loadGuard < 60) {
                    const loadMoreBtn = children.querySelector('.tree-load-more');
                    if (!loadMoreBtn) break;
                    const startIndex = parseInt(loadMoreBtn.dataset.startIndex, 10) || 0;
                    if (typeof loadPermanentFolderChildrenLazy === 'function') {
                        await loadPermanentFolderChildrenLazy(folderId, children, startIndex, loadMoreBtn);
                    } else {
                        break;
                    }
                    nextEl = treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(String(nextId))}"]`);
                    loadGuard++;
                }
            }

            target = findTarget();
        }
    } catch (_) { }

    if (!target) return false;

    try { expandAncestorsForTreeItem(target, treeContainer); } catch (_) { }
    if (options.expandTargetFolder !== false) {
        try { await ensurePermanentSearchFolderExpanded(target); } catch (_) { }
    }
    persistSearchLocateTreeExpandState(treeContainer);
    const resolvePermanentTarget = () => {
        const latestSection = resolvePermanentSectionElementForSearch(options.copyId || null);
        const latestTree = (latestSection && latestSection.querySelector('.bookmark-tree'))
            || (latestSection && latestSection.querySelector('#bookmarkTree'))
            || document.getElementById('bookmarkTree');
        return latestTree
            ? latestTree.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`)
            : null;
    };
    const settledPermanentTarget = await finalizeTreeItemCentering(treeContainer, resolvePermanentTarget, locateToken);
    if (shouldOutlineTarget) {
        highlightSearchTreeItemOutline(settledPermanentTarget || target, options.color || '#2563eb');
    }

    if (shouldOutlineTarget) {
        const permanentHighlightColor = options.color || '#2563eb';
        setTimeout(() => {
            if (locateToken !== searchTreeItemLocateCenterToken) return;
            const freshTarget = resolvePermanentTarget();
            if (!freshTarget) return;
            highlightSearchTreeItemOutline(freshTarget, permanentHighlightColor, false);
        }, 220);
    }

    return true;
}

async function locateBookmarkItemInTempTree(sectionId, itemId, options = {}) {
    const sid = String(sectionId || '');
    const id = String(itemId || '');
    if (!sid || !id) return false;
    const locateToken = ++searchTreeItemLocateCenterToken;
    const shouldOutlineTarget = options.suppressOutline !== true;

    // 先把临时栏目卡片定位到视口
    try {
        if (typeof currentView !== 'undefined' && currentView === 'canvas') {
            if (!isMaximizedTempSectionActive(sid)) {
                await locateCanvasElement(sid, 'temp-section', { color: options.color || '#2563eb' });
                await waitForSearchLocateAnimationFrames(2);
            }
        }
    } catch (_) { }

    // 确保栏目非休眠、且树 DOM 已构建
    try {
        if (window.CanvasModule && typeof window.CanvasModule.forceWakeAndRender === 'function') {
            window.CanvasModule.forceWakeAndRender(sid);
        }
        if (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.ensureRendered === 'function') {
            window.CanvasModule.temp.ensureRendered(sid);
        }
    } catch (_) { }

    const sectionEl = document.getElementById(sid);
    if (!sectionEl) return false;

    const treeContainer = sectionEl.querySelector('.temp-bookmark-tree');
    if (!treeContainer) return false;

    const sectionObj = (window.CanvasModule && typeof window.CanvasModule.getTempSection === 'function')
        ? window.CanvasModule.getTempSection(sid)
        : null;
    if (!sectionObj) return false;

    const findEl = (nid) => treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(String(nid))}"]`);

    const ensureRootLoadedUntil = (targetId) => {
        let el = findEl(targetId);
        let guard = 0;
        while (!el && guard < 120) {
            const loadMoreBtn = treeContainer.querySelector('.tree-load-more-root');
            if (!loadMoreBtn || typeof loadMoreRootItems !== 'function') break;
            const ok = loadMoreRootItems(sectionObj, treeContainer, loadMoreBtn);
            if (!ok) break;
            el = findEl(targetId);
            guard++;
        }
        return el;
    };

    // 计算祖先链：从目标向上找 parent
    const parents = [];
    try {
        if (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.findItem === 'function') {
            let entry = window.CanvasModule.temp.findItem(sid, id);
            let guard = 0;
            while (entry && entry.parent && entry.parent.id && guard < 80) {
                parents.push(String(entry.parent.id));
                entry = window.CanvasModule.temp.findItem(sid, entry.parent.id);
                guard++;
            }
        }
    } catch (_) { }
    parents.reverse();

    // 按祖先链展开 + 懒加载，确保目标节点可见
    for (let i = 0; i < parents.length; i++) {
        const folderId = parents[i];
        const nextId = (i + 1 < parents.length) ? parents[i + 1] : id;

        let folderEl = findEl(folderId);
        if (!folderEl) {
            folderEl = ensureRootLoadedUntil(folderId);
        }
        if (!folderEl) break;

        const folderNode = folderEl.closest('.tree-node');
        const children = folderNode ? folderNode.querySelector(':scope > .tree-children') : null;
        if (!children) continue;

        children.classList.add('expanded');
        const toggle = folderEl.querySelector('.tree-toggle');
        if (toggle) toggle.classList.add('expanded');
        const folderIcon = folderEl.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
        if (folderIcon) {
            folderIcon.classList.remove('fa-folder');
            folderIcon.classList.add('fa-folder-open');
        }

        if (folderEl.dataset && folderEl.dataset.childrenLoaded === 'false' && folderEl.dataset.hasChildren === 'true') {
            try {
                if (window.CanvasModule && typeof window.CanvasModule.loadFolderChildren === 'function') {
                    window.CanvasModule.loadFolderChildren(sectionObj, folderId, children);
                } else if (typeof loadFolderChildren === 'function') {
                    loadFolderChildren(sectionObj, folderId, children);
                }
            } catch (_) { }
        }

        let nextEl = findEl(nextId);
        let loadGuard = 0;
        while (!nextEl && loadGuard < 120) {
            const loadMoreBtn = children.querySelector('.tree-load-more');
            if (!loadMoreBtn || typeof loadMoreChildren !== 'function') break;
            const startIndex = parseInt(loadMoreBtn.dataset.startIndex, 10) || 0;
            const ok = loadMoreChildren(sectionObj, folderId, startIndex, loadMoreBtn);
            if (!ok) break;
            nextEl = findEl(nextId);
            loadGuard++;
        }
    }

    let target = findEl(id);
    if (!target) {
        target = ensureRootLoadedUntil(id);
    }
    if (!target) return false;

    try { expandAncestorsForTreeItem(target, treeContainer); } catch (_) { }
    if (options.expandTargetFolder !== false) {
        try { await ensureTempSearchFolderExpanded(sectionObj, target); } catch (_) { }
    }
    try {
        const expandedTempFolderIds = parents.slice();
        if (options.expandTargetFolder !== false && target && target.dataset && target.dataset.nodeType === 'folder') {
            expandedTempFolderIds.push(id);
        }
        persistTempSearchLocateExpandState(sid, expandedTempFolderIds);
    } catch (_) { }
    const resolveTempTarget = () => {
        const freshSection = document.getElementById(sid);
        if (!freshSection) return null;
        const freshTree = freshSection.querySelector('.temp-bookmark-tree');
        return freshTree
            ? freshTree.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`)
            : null;
    };
    const settledTempTarget = await finalizeTreeItemCentering(treeContainer, resolveTempTarget, locateToken);
    if (shouldOutlineTarget) {
        highlightSearchTreeItemOutline(settledTempTarget || target, options.color || '#2563eb');
    }

    if (shouldOutlineTarget) {
        // [Fix] Retry highlight to combat potential re-renders (anti-flash)
        // Re-query the container to ensure we are highlighting the FRESH DOM element
        const highlightColor = options.color || '#2563eb';
        const retry = (delay) => {
            setTimeout(() => {
                if (locateToken !== searchTreeItemLocateCenterToken) return;
                const freshSection = document.getElementById(sid);
                if (!freshSection) return;
                const freshTree = freshSection.querySelector('.temp-bookmark-tree');
                if (!freshTree) return;
                const t = freshTree.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`);
                if (t) {
                    highlightSearchTreeItemOutline(t, highlightColor, false);
                }
            }, delay);
        };
        retry(220);
    }

    return true;
}

function shouldExpandSearchLocateTargetFolder(target) {
    const rawNodeType = target && (target.nodeType || (target.originalItem && target.originalItem.nodeType));
    return String(rawNodeType || '').trim() !== 'folder';
}

async function ensureBookmarkSearchTargetFullscreen(target) {
    if (!target || typeof target !== 'object') return false;

    const source = String(target.source || '').trim();
    if (source === 'temporary') {
        const sectionId = String(target.sectionId || '').trim();
        if (!sectionId) return false;
        if (isMaximizedTempSectionActive(sectionId)) return true;
        return ensureCanvasSearchResultTargetFullscreen({ type: 'temp-section', id: sectionId });
    }

    if (source === 'permanent') {
        const copyId = String(target.copyId || '').trim() || null;
        if (isMaximizedPermanentSectionActive(copyId)) return true;
        return ensureCanvasSearchResultTargetFullscreen({
            type: 'permanent-section',
            id: copyId || 'permanentSection',
            copyId
        });
    }

    return false;
}

async function locateCanvasBookmarkItem(item) {
    if (!item || item.type !== 'bookmark-item') return false;
    const expandTargetFolder = shouldExpandSearchLocateTargetFolder(item);
    if (item.source === 'temporary' && item.sectionId) {
        return locateBookmarkItemInTempTree(item.sectionId, item.id, {
            color: item.color || '#2563eb',
            expandTargetFolder
        });
    }
    const fullscreenScope = getCanvasFullscreenSearchScope();
    const activePermanentCopyId = fullscreenScope && String(fullscreenScope.kind || '') === 'permanent'
        ? String(fullscreenScope.copyId || '').trim()
        : '';
    return locateBookmarkItemInPermanentTree(item.id, {
        color: item.color || '#2563eb',
        copyId: item.copyId || activePermanentCopyId || null,
        expandTargetFolder
    });
}

async function locateCanvasBookmarkTreeItem(target) {
    if (!target || typeof target !== 'object') return false;
    const source = String(target.source || '').trim();
    const color = target.color || '#2563eb';
    const expandTargetFolder = target.expandTargetFolder !== false;
    const suppressOutline = target.suppressOutline === true;

    if (source === 'temporary') {
        return locateBookmarkItemInTempTree(target.sectionId, target.id, { color, expandTargetFolder, suppressOutline });
    }

    return locateBookmarkItemInPermanentTree(target.id, {
        color,
        copyId: target.copyId || null,
        expandTargetFolder,
        suppressOutline
    });
}

/**
 * 文本高亮并滚动到可见区域 (滚动条自动定位)
 */
function highlightAndScrollToText(container, queryText) {
    if (!container || !queryText) return;
    const terms = queryText.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return;

    function findTextNodes(node, nodesList = []) {
        if (node.nodeType === 3) {
            nodesList.push(node);
        } else if (node.nodeType === 1) {
            if (node.classList.contains('temp-node-action-btn') || 
                node.classList.contains('permanent-section-actions') ||
                node.classList.contains('temp-node-description-controls') ||
                node.classList.contains('permanent-section-tip-controls') ||
                node.tagName === 'SCRIPT' || 
                node.tagName === 'STYLE') {
                return nodesList;
            }
            for (let child = node.firstChild; child; child = child.nextSibling) {
                findTextNodes(child, nodesList);
            }
        }
        return nodesList;
    }

    let contentElement = container;
    if (container.classList.contains('md-canvas-node')) {
        contentElement = container.querySelector('.md-canvas-editor, .md-canvas-text') || container;
    } else if (container.classList.contains('permanent-bookmark-section')) {
        const tipContainer = container.querySelector('.permanent-section-tip-container');
        if (tipContainer) {
            document.querySelectorAll('.temp-node-description-container.desc-selected, .permanent-section-tip-container.desc-selected')
                .forEach(el => el.classList.remove('desc-selected'));
            tipContainer.classList.add('desc-selected');
        }
        contentElement = container.querySelector('.permanent-section-tip') || container;
    } else if (container.classList.contains('temp-canvas-node')) {
        const descContainer = container.querySelector('.temp-node-description-container');
        if (descContainer) {
            document.querySelectorAll('.temp-node-description-container.desc-selected, .permanent-section-tip-container.desc-selected')
                .forEach(el => el.classList.remove('desc-selected'));
            descContainer.classList.add('desc-selected');
        }
        contentElement = container.querySelector('.temp-node-description') || container;
    }

    if (contentElement.querySelector('.canvas-text-search-highlight-match')) {
        return;
    }

    const originalHTML = contentElement.innerHTML;
    const textNodes = findTextNodes(contentElement);
    const marks = [];

    textNodes.forEach(node => {
        let text = node.data;
        let lowerText = text.toLowerCase();
        
        for (const term of terms) {
            const index = lowerText.indexOf(term.toLowerCase());
            if (index >= 0) {
                const matchedText = text.substring(index, index + term.length);
                const remainingText = text.substring(index + term.length);
                
                node.data = text.substring(0, index);
                
                const mark = document.createElement('mark');
                mark.className = 'canvas-text-search-highlight-match';
                mark.style.backgroundColor = '#fbbf24';
                mark.style.color = '#000000';
                mark.style.borderRadius = '3px';
                mark.style.padding = '0 2px';
                mark.style.boxShadow = '0 0 5px rgba(251, 191, 36, 0.7)';
                mark.style.fontWeight = 'bold';
                mark.textContent = matchedText;
                
                node.parentNode.insertBefore(mark, node.nextSibling);
                if (remainingText) {
                    const newTextNode = document.createTextNode(remainingText);
                    mark.parentNode.insertBefore(newTextNode, mark.nextSibling);
                }
                marks.push(mark);
                break;
            }
        }
    });

    if (marks.length > 0) {
        setTimeout(() => {
            try {
                marks[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (_) {}
        }, 100);
    }

    const clearHighlights = () => {
        try {
            if (contentElement.querySelector('.canvas-text-search-highlight-match')) {
                contentElement.innerHTML = originalHTML;
            }
        } catch (_) {}
        cleanupEvents();
    };

    const cleanupEvents = () => {
        contentElement.removeEventListener('focusin', clearHighlights);
        contentElement.removeEventListener('click', clearHighlights);
    };

    contentElement.addEventListener('focusin', clearHighlights);
    contentElement.addEventListener('click', clearHighlights);

    setTimeout(clearHighlights, 3000);
}

/**
 * 定位画布元素 (Storage-First Approach)
 * 优先使用 CanvasState/LocalStorage 中的坐标数据进行定位，
 * 从而支持在 DOM 元素被剔除（Low Detail Mode）时仍能准确定位。
 */
async function locateCanvasElement(elementId, type, options = {}) {
    if (!elementId) return false;

    // 清除之前的高亮
    clearCanvasSearchHighlight();

    let targetX = 0;
    let targetY = 0;
    let foundLocation = false;
    let highlightSelector = null; // 用于查找 DOM 元素的高亮选择器

    // [New] Dynamic Highlight Color
    const highlightColor = options.color || '#2563eb';
    const disableAnimation = options.disableAnimation === true;

    // Helper: 获取节点/栏目矩形 (从 Storage)
    const getRectFromStorage = (id, typeHint) => {
        const state = getActiveCanvasState();
        if (!state) return null;
        // 1. Temp Section
        if (!typeHint || typeHint === 'temp-section') {
            const temp = (state.tempSections || []).find(s => s.id === id);
            if (temp) return { x: Number(temp.x) || 0, y: Number(temp.y) || 0, w: Number(temp.width) || 0, h: Number(temp.height) || 0 };
        }
        // 2. MD Node / Card-Group / Import-Container
        if (!typeHint || typeHint === 'md-node' || typeHint === 'group') {
            const md = (state.mdNodes || []).find(n => n.id === id);
            if (md) return { x: Number(md.x) || 0, y: Number(md.y) || 0, w: Number(md.width) || 0, h: Number(md.height) || 0 };
        }
        // 3. Permanent Main
        if (id === 'permanentSection') {
            try {
                const shell = getPermanentMainShellForSearch();
                const pos = shell && shell.cardState ? shell.cardState : {};
                const x = parseFloat(pos.left) || 0;
                const y = parseFloat(pos.top) || 0;
                const w = parseFloat(pos.width) || 340;
                const h = parseFloat(pos.height) || 600;
                return { x, y, w, h };
            } catch (_) { }
        }
        // 4. Permanent Copy
        if (!typeHint || typeHint === 'permanent-section') {
            try {
                const copy = getPermanentCopyShellsForSearch().find((view) => String(view && view.copyId || '') === String(id || ''));
                if (copy) {
                    const cardState = copy.cardState || copy;
                    const x = parseFloat(cardState.left) || parseFloat(cardState.x) || 0;
                    const y = parseFloat(cardState.top) || parseFloat(cardState.y) || 0;
                    const w = parseFloat(cardState.width) || parseFloat(cardState.w) || 340;
                    const h = parseFloat(cardState.height) || parseFloat(cardState.h) || 600;
                    return { x, y, w, h };
                }
            } catch (_) { }
        }
        return null;
    };

    switch (type) {
        case 'temp-section':
        case 'md-node':
        case 'group':
            const rect = getRectFromStorage(elementId, type);
            if (rect) {
                targetX = rect.x + rect.w / 2;
                targetY = rect.y + rect.h / 2;
                foundLocation = true;

                targetX = rect.x + rect.w / 2;
                targetY = rect.y + rect.h / 2;
                foundLocation = true;

                // [Fix] MD Node highlighting
                // Directly selector by ID.
                highlightSelector = `[id="${elementId}"]`;

                // Also force immediate Highlight if element exists
                const mdEl = document.getElementById(elementId);
                if (mdEl && !disableAnimation) {
                    highlightCanvasElement(mdEl);
                }
            }
            break;

        case 'edge':
            // 1. Try DOM-based location (Most Accurate)
            // [Fix] Edges do not have 'id' attribute, they use 'data-edge-id'
            let edgeDom = document.querySelector(`.canvas-edge[data-edge-id="${elementId}"]`);

            if (!edgeDom) {
                // Fallback or retry
                edgeDom = document.querySelector(`path[data-edge-id="${elementId}"]`);
            }

            if (edgeDom) {
                // [Fix] 直接高亮实体（SVG Path）
                if (!disableAnimation) {
                    try {
                        edgeDom.classList.add('canvas-search-highlight-edge');
                        setTimeout(() => {
                            try { edgeDom.classList.remove('canvas-search-highlight-edge'); } catch (_) { }
                        }, 2500);
                    } catch (_) { }
                }

                const rect = edgeDom.getBoundingClientRect();
                if (rect && rect.width > 0 && rect.height > 0) {
                    // Convert Screen Rect Center to Canvas Coords
                    const container = document.querySelector('.canvas-main-container');
                    if (container) {
                        const bgRect = container.getBoundingClientRect();
                        const screenCX = rect.left + rect.width / 2;
                        const screenCY = rect.top + rect.height / 2;

                        const relX = screenCX - bgRect.left;
                        const relY = screenCY - bgRect.top;

                        const state = getActiveCanvasState();
                        const currentZoom = (state && state.zoom) || 1;
                        const currentPanX = (state && state.panOffsetX) || 0;
                        const currentPanY = (state && state.panOffsetY) || 0;

                        // CanvasX = (RelX - PanX) / Zoom
                        targetX = (relX - currentPanX) / currentZoom;
                        targetY = (relY - currentPanY) / currentZoom;
                        foundLocation = true;
                    }
                }
            }

            // 2. Fallback to Storage/Memory (if DOM missing)
            if (!foundLocation) {
                const state = getActiveCanvasState();
                const edge = ((state && state.edges) || []).find(e => e.id === elementId);
                if (edge) {
                    const fromRect = getRectFromStorage(edge.fromNode || edge.from);
                    const toRect = getRectFromStorage(edge.toNode || edge.to);

                    if (fromRect && toRect) {
                        const fromCX = fromRect.x + fromRect.w / 2;
                        const fromCY = fromRect.y + fromRect.h / 2;
                        const toCX = toRect.x + toRect.w / 2;
                        const toCY = toRect.y + toRect.h / 2;

                        targetX = (fromCX + toCX) / 2;
                        targetY = (fromCY + toCY) / 2;
                        foundLocation = true;
                    } else if (fromRect) {
                        targetX = fromRect.x + fromRect.w / 2;
                        targetY = fromRect.y + fromRect.h / 2;
                        foundLocation = true;
                    }
                }
            }

            if (foundLocation) {
                // [Modified] 移除原有的圆形覆盖层 (Dot Overlay)，改为仅依赖 CSS 类高亮实体
                /*
                const edgeOverlayId = `edge-highlight-${elementId}`;
                const existing = document.getElementById(edgeOverlayId);
                if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
 
                const overlay = document.createElement('div');
                // ... (Original overlay code removed to avoid "dot" appearance)
                */

                highlightSelector = null;
            }
            break;

        case 'permanent-section':
            const pRect = getRectFromStorage(elementId, 'permanent-section');
            if (pRect) {
                targetX = pRect.x + pRect.w / 2;
                targetY = pRect.y + pRect.h / 2;
                foundLocation = true;
                if (elementId === 'permanentSection') highlightSelector = '#permanentSection';
                else highlightSelector = `.permanent-bookmark-section[data-permanent-section-copy-id="${elementId}"]`;
            }
            break;
    }

    if (!foundLocation) {
        console.warn('[Search] Element location not found in storage:', elementId);
        // Fallback to strict DOM search if storage failed (unlikely for valid IDs)
        const el = document.getElementById(elementId);
        if (el) {
            // ... (Simple logic if needed, but storage usually covers it)
        }
        return false;
    }

    // 1. 平移画布到计算出的坐标 (Storage-based Pan)
    try {
        const state = getActiveCanvasState();
        if (state) {
            const container = document.querySelector('.canvas-main-container');
            if (container) {
                const skipPanForMaximizedTarget = shouldSkipCanvasPanForMaximizedTarget(elementId, type);
                if (!skipPanForMaximizedTarget) {
                    let currentZoom = (state.baseZoom && state.baseZoom > 0) ? state.baseZoom : 1.0;
                    if (window.CanvasModule && typeof window.CanvasModule.setZoom === 'function') {
                        window.CanvasModule.setZoom(currentZoom, null, null, { silent: true });
                    } else {
                        state.zoom = currentZoom;
                    }
                    // Sync CSS variable immediately so every locate entry uses the same 100% view.
                    container.style.setProperty('--canvas-scale', currentZoom.toString());

                    const containerRect = container.getBoundingClientRect();
                    const viewportCX = containerRect.width / 2;
                    const viewportCY = containerRect.height / 2;

                    // NewPan = ViewportCenter - Target * Zoom (Ensure Finite)
                    let newPanX = viewportCX - targetX * currentZoom;
                    let newPanY = viewportCY - targetY * currentZoom;

                    if (!Number.isFinite(newPanX)) newPanX = 0;
                    if (!Number.isFinite(newPanY)) newPanY = 0;

                    // Update State
                    state.panOffsetX = newPanX;
                    state.panOffsetY = newPanY;

                    // Apply Transform (Immediate)
                    const content = document.getElementById('canvasContent');
                    if (content) {
                        if (typeof applyCanvasContentTransform === 'function') {
                            applyCanvasContentTransform(content, newPanX, newPanY, currentZoom);
                        } else {
                            content.style.transform = `translate3d(${newPanX}px, ${newPanY}px, 0) scale(${currentZoom})`;
                            if (typeof updateCanvasGridLayerTransform === 'function') {
                                updateCanvasGridLayerTransform(newPanX, newPanY, currentZoom, true);
                            }
                        }
                    }

                    // Update CSS Vars
                    container.style.setProperty('--canvas-pan-x', `${newPanX}px`);
                    container.style.setProperty('--canvas-pan-y', `${newPanY}px`);

                    // Notify system (if needed)
                    if (typeof updateCanvasTransform === 'function') {
                        // updateCanvasTransform might overwrite if we don't sync state first.
                        // We synced state above.
                        // Doing rAF to ensure clean update cycle
                        requestAnimationFrame(() => updateCanvasTransform(false));
                    }
                }
            }
        }
    } catch (e) {
        console.error('[Search] Pan failed:', e);
    }

    // [Fix] Force wake up target temp section after jump
    if (type === 'temp-section' && window.CanvasModule && typeof window.CanvasModule.forceWakeAndRender === 'function') {
        // Use a small timeout to allow the transform to settle/apply first
        setTimeout(() => window.CanvasModule.forceWakeAndRender(elementId), 50);
    }

    // 2. 尝试高亮 DOM 元素 (Best Effort)
    if (highlightSelector && !disableAnimation) {
        const tryHighlight = () => {
            const el = document.querySelector(highlightSelector);
            if (el) {
                // Apply Highlight Class & Color
                el.style.setProperty('--search-highlight-color', highlightColor);
                // For edges, we use a specific class
                if (type === 'edge') {
                    el.classList.add('canvas-search-highlight-edge');
                    setTimeout(() => {
                        el.classList.remove('canvas-search-highlight-edge');
                        el.style.removeProperty('--search-highlight-color');
                    }, 2500);
                } else {
                    el.classList.add('canvas-search-highlight');
                    setTimeout(() => {
                        el.classList.remove('canvas-search-highlight');
                        el.style.removeProperty('--search-highlight-color');
                    }, 2000);
                }
            }
        };

        tryHighlight();
        // 如果虚拟列表/LOD需要时间渲染，再试一次
        setTimeout(tryHighlight, 100);
        setTimeout(tryHighlight, 300);
    }

    // [Fix] Edges highlighting logic was partly inline in previous block, clean up here
    if (!disableAnimation && foundLocation && type === 'edge' && !highlightSelector) {
        // If we found location via storage but selector failed (rare for edge if virtualized?)
        // Actually edge relies on DOM query selector in switch case. 
        // If logic fell through to just coords, we might need overlay? 
        // User disliked overlay. Rely on DOM appearing after Pan.
        const retryEdge = () => {
            const edgeDom = document.querySelector(`.canvas-edge[data-edge-id="${elementId}"]`) ||
                document.querySelector(`path[data-edge-id="${elementId}"]`);
            if (edgeDom) {
                edgeDom.style.setProperty('--search-highlight-color', highlightColor);
                edgeDom.classList.add('canvas-search-highlight-edge');
                setTimeout(() => edgeDom.classList.remove('canvas-search-highlight-edge'), 2500);
            }
        };
        setTimeout(retryEdge, 100);
        setTimeout(retryEdge, 300);
    }

    // 3. 说明搜索文本高亮与垂直滚动定位
    const queryText = (searchUiState && searchUiState.query) || '';
    if (queryText) {
        if (type === 'edge') {
            const tryEdgeLabelHighlight = () => {
                const labelDom = document.querySelector(`.canvas-edge-label[data-edge-id="${elementId}"]`);
                if (labelDom) {
                    labelDom.style.fill = '#f59e0b';
                    labelDom.style.fontWeight = 'bold';
                    setTimeout(() => {
                        labelDom.style.fill = '';
                        labelDom.style.fontWeight = '';
                    }, 2500);
                }
            };
            setTimeout(tryEdgeLabelHighlight, 100);
            setTimeout(tryEdgeLabelHighlight, 350);
        } else {
            const tryTextHighlight = () => {
                const el = document.querySelector(highlightSelector || `[id="${elementId}"]`);
                if (el) {
                    highlightAndScrollToText(el, queryText);
                }
            };
            setTimeout(tryTextHighlight, 100);
            setTimeout(tryTextHighlight, 350);
        }
    }

    return foundLocation;
}


/**
 * 高亮画布元素
 */
function highlightCanvasElement(element, type) {
    if (!element) return;

    // 清空现有的（防止叠加）
    element.classList.remove('canvas-search-highlight');
    element.classList.remove('canvas-search-highlight-pulse');

    // 强制重绘以触发动画重置
    void element.offsetWidth;

    // 添加高亮类
    element.classList.add('canvas-search-highlight');
    element.classList.add('canvas-search-highlight-pulse');

    // 动画结束后移除所有高亮类 (2s 动画 + buffer)
    setTimeout(() => {
        try {
            element.classList.remove('canvas-search-highlight-pulse');
            element.classList.remove('canvas-search-highlight');
            // 清理状态
            const idx = canvasSearchHighlightState.highlightedIds.indexOf(element.id);
            if (idx !== -1) {
                canvasSearchHighlightState.highlightedIds.splice(idx, 1);
            }
        } catch (_) { }
    }, 2200);
}

/**
 * 高亮群组（多个元素）
 * @param {string} prefix - 群组前缀（如 A- 或 A）
 */
function highlightCanvasGroup(prefix) {
    clearCanvasSearchHighlight();

    const db = buildCanvasSearchDb();
    const matchedIds = [];
    const p = prefix.toLowerCase().replace(/-$/, '');
    const structureItems = Array.isArray(db.structureIndex) ? db.structureIndex : [];

    for (const item of structureItems) {
        // 只匹配有 label 的临时栏目
        if (item.type === 'temp-section' && item.__label) {
            if (item.__label === p || item.__label.startsWith(p + '-')) {
                matchedIds.push(item.id);
            }
        }
    }

    matchedIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('canvas-search-highlight');
        }
    });

    canvasSearchHighlightState.highlightedIds = matchedIds;
    canvasSearchHighlightState.isGroupHighlight = true;

    return matchedIds.length;
}

/**
 * 清除画布搜索高亮
 */
function clearCanvasSearchHighlight() {
    // 移除所有高亮类
    document.querySelectorAll('.canvas-search-highlight').forEach(el => {
        el.classList.remove('canvas-search-highlight');
        el.classList.remove('canvas-search-highlight-pulse');
    });

    document.querySelectorAll('.canvas-search-highlight-outline').forEach(el => {
        el.classList.remove('canvas-search-highlight-outline');
    });

    canvasSearchHighlightState.highlightedIds = [];
    canvasSearchHighlightState.isGroupHighlight = false;
}

// ==================== Phase 3: 搜索结果激活 ====================

/**
 * 激活画布搜索结果
 * @param {number} index - 结果索引
 */
async function activateCanvasSearchResultAtIndex(index) {
    const idx = typeof index === 'number' ? index : parseInt(index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= searchUiState.results.length) return;

    const item = searchUiState.results[idx];
    if (!item) return;

    if (item.type === 'tag-browser-color' || item.type === 'tag-browser-tag') {
        searchUiState.tagBrowseDetail = {
            active: true,
            kind: item.type === 'tag-browser-color' ? 'color' : 'tag',
            color: normalizeTagBrowseColor(item.color),
            text: String(item.text || '').trim(),
            textLower: String(item.textLower || '').trim().toLowerCase()
        };
        const query = String(searchUiState.query || '').trim() || '#';
        searchCanvasAndRender(query, { source: 'system', keepTagBrowseDetail: true });
        return;
    }

    if (item.type === 'note-browser-color' || item.type === 'note-browser-note') {
        searchUiState.noteBrowseDetail = {
            active: true,
            kind: item.type === 'note-browser-color' ? 'color' : 'note',
            color: normalizeNoteBrowseColor(item.color),
            note: String(item.note || '').trim(),
            noteLower: String(item.noteLower || '').trim().toLowerCase()
        };
        const query = String(searchUiState.query || '').trim() || '*';
        searchCanvasAndRender(query, { source: 'system', keepNoteBrowseDetail: true });
        return;
    }

    if (item.type === 'note-browser-bucket') {
        if (item.count === 0) return;
        searchUiState.noteBrowseDetail = {
            active: true,
            kind: 'bucket',
            bucket: item.bucket
        };
        const query = String(searchUiState.query || '').trim() || '*';
        searchCanvasAndRender(query, { source: 'system', keepNoteBrowseDetail: true });
        return;
    }

    // Canvas Bookmark Mode: flat group card
    if (item.type === 'bookmark-group') {
        const locations = Array.isArray(item.locations) ? item.locations : [];
        if (locations.length > 0) {
            // Jump to the best-matched location (first in list)
            try {
                hideSearchResultsPanel();
                const inputEl = document.getElementById('searchInput');
                if (inputEl) inputEl.value = '';
            } catch (_) { }

            const loc = pickBestBookmarkLocationByScope(locations, getActiveFullscreenSearchScopeForFiltering()) || locations[0];
            if (isFullscreenGlobalSearchActive() && loc) {
                try {
                    await ensureBookmarkSearchTargetFullscreen(loc);
                } catch (_) { }
            }
            const opts = {
                color: loc.color || item.color || '#2563eb',
                expandTargetFolder: shouldExpandSearchLocateTargetFolder(loc || item)
            };
            if (loc.copyId) opts.copyId = loc.copyId;
            if (loc.source === 'temporary') {
                await locateBookmarkItemInTempTree(loc.sectionId, loc.id, opts);
            } else {
                await locateBookmarkItemInPermanentTree(loc.id, opts);
            }
            return;
        }

        // Fallback: keep legacy toggle behavior (if any data exists)
        const groupId = String(item.id || '');
        if (groupId) {
            const prev = searchUiState.bookmarkGroupCollapse.get(groupId);
            const prevCollapsed = (typeof prev === 'boolean') ? prev : true;
            searchUiState.bookmarkGroupCollapse.set(groupId, !prevCollapsed);

            const groups = searchUiState.bookmarkGroupModel;
            if (Array.isArray(groups)) {
                const nextResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
                const nextIndex = Math.max(0, nextResults.findIndex(r => r && r.type === 'bookmark-group' && String(r.id) === groupId));
                renderCanvasSearchResults(nextResults, { view: 'canvas', query: searchUiState.query, selectedIndex: nextIndex });
            } else {
                // Fallback: rerun search (should be rare)
                searchCanvasAndRender(searchUiState.query);
            }
        }
        return;
    }

    // "more" row is informational only
    if (item.type === 'bookmark-group-more') {
        return;
    }

    if (item.type === 'domain-group') {
        const domainKey = String(item.domain || item.title || '').trim().toLowerCase();
        const fullscreenScope = getActiveFullscreenSearchScopeForFiltering();
        if (fullscreenScope && domainKey) {
            setDomainGroupCollapsed(domainKey, item.isExpanded === true);
            rerenderCanvasBookmarkResults(idx);
            return;
        }

        hideSearchResultsPanel();
        try {
            const inputEl = document.getElementById('searchInput');
            if (inputEl) inputEl.value = '';
        } catch (_) { }
        createTempSectionFromDomainResult(item.domain || item.title || '');
        return;
    }

    const navigateModeAtStart = searchUiState.activeMode;
    const shouldDismissSearchAfterGlobalFullscreenNavigate = isFullscreenGlobalSearchActive()
        && (navigateModeAtStart === 'structure' || navigateModeAtStart === 'description');

    const isInFullscreen = isCanvasFullscreenActive();
    let fullscreenScope = getCanvasFullscreenSearchScope();
    const isGlobalFullscreenSearch = isFullscreenGlobalSearchActive();

    // 清空输入框 (仅针对非群组结果，群组结果需保留文字以维持高亮状态)
    // 在全屏卡片切换前先清空，避免切换过程中 setSearchMode 用旧关键词重新展开结果面板
    if (item.type !== 'group-result') {
        prepareSearchInputBeforeCanvasNavigate();
    }

    const shouldExitFullscreenForSearchLocate = isInFullscreen
        && (
            item.type === 'edge'
            || item.type === 'group'
            || (searchUiState.activeMode === 'structure' && item.type === 'md-node')
        );
    if (shouldExitFullscreenForSearchLocate) {
        try {
            await exitCanvasNodeFullscreenForSearchLocate();
        } catch (_) { }
        fullscreenScope = getCanvasFullscreenSearchScope();
    }
    const shouldSwitchFullscreenTarget = !!fullscreenScope
        && searchUiState.activeMode !== 'bookmark'
        && (item.type === 'temp-section' || item.type === 'md-node' || item.type === 'permanent-section');
    if (shouldSwitchFullscreenTarget) {
        try {
            await ensureCanvasSearchResultTargetFullscreen(item);
        } catch (_) { }
    }
    if (isGlobalFullscreenSearch && item.type === 'bookmark-item') {
        try {
            await ensureBookmarkSearchTargetFullscreen(item);
        } catch (_) { }
    }

    // Case 1: Group Result (Aggregation Item)
    if (item.type === 'group-result') {
        // DO NOT clear input for group search, as requested by user.

        const ids = item.targetIds || [];
        if (ids.length) {
            // 1. Highlight all items PERSISTENTLY
            // Clear old highlights first
            clearCanvasSearchHighlight();

            const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };

            ids.forEach(id => {
                let el = document.getElementById(id);
                if (item.groupType === 'permanent-group' && !el) {
                    // fallback for copy
                    el = document.querySelector(`.permanent-bookmark-section[data-copy-id="${id}"]`);
                }

                if (el) {
                    // Force重绘
                    void el.offsetWidth;
                    // Add Highlight Classes PERSISTENTLY (no timeout)
                    el.classList.add('canvas-search-highlight');
                    // Add pulse for initial attention, but keep it persistent visually
                    // (Actually pulse is an animation, we can let it play, but the static highlight stays)
                    el.classList.add('canvas-search-highlight-pulse');

                    // Register globally to track highlighted elements (for later cleanup)
                    canvasSearchHighlightState.highlightedIds.push(id);

                    // Calculation for FitBounds
                    const r = el.getBoundingClientRect();
                    let x = 0, y = 0, w = 0, h = 0;
                    const searchItem = canvasSearchDb.itemById?.get(id);
                    if (searchItem) {
                        x = searchItem.x || 0;
                        y = searchItem.y || 0;
                    } else {
                        x = parseFloat(el.style.left) || 0;
                        y = parseFloat(el.style.top) || 0;
                    }
                    w = el.offsetWidth || 300;
                    h = el.offsetHeight || 300;

                    bounds.minX = Math.min(bounds.minX, x);
                    bounds.minY = Math.min(bounds.minY, y);
                    bounds.maxX = Math.max(bounds.maxX, x + w);
                    bounds.maxY = Math.max(bounds.maxY, y + h);
                    bounds.count++;
                }
            });

            canvasSearchHighlightState.isGroupHighlight = true;
            canvasSearchHighlightState.groupQuery = searchUiState.query; // Track query to clear on mismatch

            // 2. Fit Bounds
            if (bounds.count > 0) {
                const state = getActiveCanvasState();
                if (state) {
                    // Calculate Target Rect
                    const targetW = bounds.maxX - bounds.minX;
                    const targetH = bounds.maxY - bounds.minY;
                    const centerX = bounds.minX + targetW / 2;
                    const centerY = bounds.minY + targetH / 2;

                    // Padding
                    const padding = 100;
                    const container = document.querySelector('.canvas-main-container');
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        const viewportW = rect.width;
                        const viewportH = rect.height;

                        // Determined Zoom to fit
                        const scaleX = viewportW / (targetW + padding * 2);
                        const scaleY = viewportH / (targetH + padding * 2);
                        let targetZoom = Math.min(scaleX, scaleY);

                        // Clamp zoom
                        targetZoom = Math.min(Math.max(targetZoom, 0.1), 1.5); // Don't zoom in too much

                        // Apply Transform (Center View on CenterX, CenterY)
                        // PanX = ViewportCX - CenterX * Zoom
                        let newPanX = (viewportW / 2) - centerX * targetZoom;
                        let newPanY = (viewportH / 2) - centerY * targetZoom;

                        if (!Number.isFinite(newPanX)) newPanX = 0;
                        if (!Number.isFinite(newPanY)) newPanY = 0;

                        // Update State
                        state.zoom = targetZoom;
                        state.panOffsetX = newPanX;
                        state.panOffsetY = newPanY;

                        // Apply Transform (Immediate)
                        const content = document.getElementById('canvasContent');
                        if (content) {
                            if (typeof applyCanvasContentTransform === 'function') {
                                applyCanvasContentTransform(content, newPanX, newPanY, targetZoom);
                            } else {
                                content.style.transform = `translate3d(${newPanX}px, ${newPanY}px, 0) scale(${targetZoom})`;
                                if (typeof updateCanvasGridLayerTransform === 'function') {
                                    updateCanvasGridLayerTransform(newPanX, newPanY, targetZoom, true);
                                }
                            }
                        }

                        // Update CSS Vars
                        container.style.setProperty('--canvas-scale', targetZoom.toString());
                        container.style.setProperty('--canvas-pan-x', `${newPanX}px`);
                        container.style.setProperty('--canvas-pan-y', `${newPanY}px`);

                        // Notify system (if needed)
                        if (typeof updateCanvasTransform === 'function') {
                            requestAnimationFrame(() => updateCanvasTransform(false));
                        }
                    }
                }
            }
        }
        return;
    }

    // Case 2: Group Prefix Search (legacy A-)
    if (canvasSearchHighlightState.isGroupHighlight || isGroupSearchQuery(searchUiState.query)) {
        highlightCanvasGroup(searchUiState.query);
        return;
    }

    // Case 3: Single Element
    if (item.type === 'bookmark-item') {
        await locateCanvasBookmarkItem(item);
    } else if (item.type === 'group') {
        await locateCanvasGroupSearchResult(item);
    } else {
        const disableAnimationForFullscreenCardSearch = !!fullscreenScope
            && (searchUiState.activeMode === 'structure' || searchUiState.activeMode === 'description');
        await locateCanvasElement(item.id, item.type, {
            disableAnimation: disableAnimationForFullscreenCardSearch
        });
    }

    if (shouldDismissSearchAfterGlobalFullscreenNavigate) {
        dismissMainSearchAfterCanvasNavigate();
    }
}

// ==================== 导出（供 history.js 调用） ====================
// 注意：由于 history.js 不使用 ES6 模块，这些函数作为全局函数暴露
// 主要供 history.js 中的 performSearch 调用

// 将函数暴露到全局作用域，以便 history.js 可以直接调用
if (typeof window !== 'undefined') {
    window.searchUiState = searchUiState;
    // ==================== Phase 3: 画布搜索 ====================
    window.searchCanvasAndRender = searchCanvasAndRender;
    window.resetCanvasSearchDb = resetCanvasSearchDb;
    window.updateCanvasSearchBookmarkTags = updateCanvasSearchBookmarkTags;
    window.updateCanvasSearchBookmarkNotes = updateCanvasSearchBookmarkNotes;
    window.markCanvasSearchBookmarkNoteDirty = markCanvasSearchBookmarkNoteDirty;
    window.markCanvasSearchBookmarkTagDirty = markCanvasSearchBookmarkTagDirty;
    window.invalidateCanvasNoteSearchCaches = invalidateCanvasNoteSearchCaches;
    window.getCanvasBookmarkNoteForSearchCached = getCanvasBookmarkNoteForSearchCached;
    window.getCanvasBookmarkNoteMetaForSearchCached = getCanvasBookmarkNoteMetaForSearchCached;
    window.doesCanvasBookmarkItemNoteMatchQuery = doesCanvasBookmarkItemNoteMatchQuery;
    window.locateCanvasElement = locateCanvasElement;
    window.locateCanvasBookmarkTreeItem = locateCanvasBookmarkTreeItem;
    window.clearCanvasSearchHighlight = clearCanvasSearchHighlight;
    window.activateCanvasSearchResultAtIndex = activateCanvasSearchResultAtIndex;
    window.ensureCanvasSearchIndexForModeLoaded = ensureIndexForModeLoaded;
    window.ensureCanvasSearchIndexForActiveMode = function () {
        const activeMode = (window.searchUiState && window.searchUiState.activeMode) || 'bookmark';
        return ensureIndexForModeLoaded(activeMode);
    };

    // ==================== 通用事件处理函数 ====================
    window.handleSearchKeydown = handleSearchKeydown;
    window.handleSearchInputFocus = handleSearchInputFocus;
    window.handleSearchResultsPanelClick = handleSearchResultsPanelClick;
    window.handleSearchResultsPanelMouseOver = handleSearchResultsPanelMouseOver;
    window.handleSearchOutsideClick = handleSearchOutsideClick;

    // Phase 3.5 Export
    window.setSearchMode = setSearchMode;
    window.cycleSearchMode = cycleSearchMode;
    window.toggleSearchModeMenu = toggleSearchModeMenu;
    window.__canvasApplyFullscreenSearchDefault = function (targetElement, options = {}) {
        const safeOptions = options && typeof options === 'object' ? Object.assign({}, options) : {};
        if (targetElement) safeOptions.targetElement = targetElement;
        return applyFullscreenDefaultSearchMode(safeOptions);
    };
    window.__syncFullscreenAreaSearchWithActiveMode = syncFullscreenAreaSearchWithActiveMode;

    // 初始化
    window.initSearchEvents = initSearchEvents;

    // 模块对象（可选的命名空间访问方式）
    window.searchModule = {
        // 初始化
        init: initSearchEvents,
        hidePanel: hideSearchResultsPanel,
        // Phase 3: 画布搜索
        searchCanvas: searchCanvasAndRender,
        resetCanvas: resetCanvasSearchDb,
        locateCanvasElement: locateCanvasElement,
        clearCanvasHighlight: clearCanvasSearchHighlight
    };
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.initSearchEvents === 'function') {
        window.initSearchEvents();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Re-bind mode menu events in case they were lost
    if (typeof window.initSearchModeUI === 'function') {
        // This function is internal but initSearchEvents calls it.
        // If we need to re-run it for safety:
        // window.initSearchEvents(); 
        // But let's check if the delegation is working.
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Re-bind click listener for manual selection to auto-close menu
    const menu = document.getElementById('searchModeMenu');
    if (menu) {
        // Cloning and replacing to remove old listeners might be cleaner, 
        // but 'search.js' architecture suggests straightforward updates.
        // We trust the latest initSearchModeUI() call from initSearchEvents().
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Re-bind mode trigger logic to respect visibility rules
    if (typeof window.renderSearchModeUI === 'function') {
        window.renderSearchModeUI();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Force refresh mode UI to update placeholder
    if (typeof window.setSearchMode === 'function' && window.searchUiState && window.searchUiState.activeMode) {
        window.setSearchMode(window.searchUiState.activeMode, { skipIndexLoad: true });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Re-bind mode trigger logic to respect visibility rules
    if (typeof window.renderSearchModeUI === 'function') {
        window.renderSearchModeUI();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // 1. Force placeholder update
    if (window.setSearchMode && window.searchUiState && window.searchUiState.activeMode) {
        window.setSearchMode(window.searchUiState.activeMode, { skipIndexLoad: true });
    }

    // 2. Add extra safeguard for button focus cycling IF it wasn't added by previous steps correctly
    // (Though step 214 should have handled it in initSearchModeUI)
    const trigger = document.getElementById('searchModeTrigger');
    if (trigger && !trigger.hasAttribute('data-mode-ui-bound') && !trigger.hasAttribute('data-cycle-bound')) {
        trigger.setAttribute('data-cycle-bound', 'true');
        trigger.addEventListener('keydown', (e) => {
            const view = (typeof window.currentView === 'string' && window.currentView)
                ? window.currentView
                : (typeof currentView === 'string' ? currentView : '');
            if (view === 'canvas') {
                if (e.key === 'ArrowUp') { e.preventDefault(); if (window.cycleSearchMode) window.cycleSearchMode(-1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); if (window.cycleSearchMode) window.cycleSearchMode(1); }
            }
        });
    }
});

// [User Request] Function to update search UI language (placeholder & menu)
function updateSearchUILanguage() {
    // Sync Placeholder
    if (typeof setSearchMode === 'function' && typeof searchUiState !== 'undefined') {
        setSearchMode(searchUiState.activeMode, { skipIndexLoad: true });
    }

    // Sync Menu if open
    if (typeof renderSearchModeMenu === 'function') {
        const menu = document.getElementById('searchModeMenu');
        if (menu && !menu.hidden) {
            renderSearchModeMenu();
        }
    }
}
window.updateSearchUILanguage = updateSearchUILanguage;
