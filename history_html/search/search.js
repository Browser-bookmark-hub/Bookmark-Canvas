/**
 * 搜索功能模块（Canvas 专用）
 * Search Module (Canvas-only)
 *
 * 文件位置：history_html/search/search.js
 *
 * Canvas 搜索：
 * - 搜索范围：`history.html` 的 `view=canvas`（书签画布视图）
 * - 说明搜索：MD卡片文本、连接线标签、临时栏目说明、永久栏目说明
 * - 卡片搜索：#N序号定位、A-群组搜索、标题匹配
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
    activeMode: 'bookmark',
    isMenuOpen: false,
    canvasSuggestionsVisible: false,

    // Canvas bookmark mode: group-by-section UI state
    bookmarkGroupCollapse: new Map(), // groupId -> boolean (true = collapsed)
    bookmarkGroupModel: null // [{ header, children:[{item,s}] }]
    ,
    // Canvas bookmark search: whether to show bookmark / folder / domain results
    // Values: 'bookmark' | 'folder' | 'domain' | null (auto)
    bookmarkTypeFilter: null,

    // Cache for bookmark-domain grouping (per query)
    domainIndexCache: null,
    // Domain grouping level: 'root' (registrable) or 'host' (subdomain)
    domainGrouping: 'host',

    // Search help menu state (click the left icon)
    isHelpOpen: false
};

const DOMAIN_GROUP_PREF_KEY = 'canvas-search-domain-grouping';
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
        console.log('[SearchContext] Context Updated:', this.currentContext);

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
                        setSearchMode(searchUiState.activeMode || 'bookmark');
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
        console.log('[SearchContext] Synced from UI:', { reason, view });
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

/**
 * 显示搜索结果面板
 */
function showSearchResultsPanel() {
    const panel = getSearchResultsPanel();
    if (panel) panel.classList.add('visible');
}

/**
 * 隐藏搜索结果面板
 */
function hideSearchResultsPanel() {
    const panel = getSearchResultsPanel();
    if (panel) {
        panel.classList.remove('visible');
        try { panel.dataset.panelType = ''; } catch (_) { }
    }
    try {
        if (typeof searchUiState === 'object' && searchUiState) {
            searchUiState.canvasSuggestionsVisible = false;
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
            searchUiState.selectedIndex = -1;
            searchUiState.bookmarkGroupModel = null;
            searchUiState.bookmarkGroupCollapse = new Map();
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
function updateSearchResultSelection(nextIndex) {
    const panel = getSearchResultsPanel();
    if (!panel) return;
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
        // 仅在面板内滚动，不影响页面滚动
        try {
            selectedEl.scrollIntoView({ block: 'nearest' });
        } catch (_) { }
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
                                if (currentGrouping === 'host') {
                                    nextGrouping = 'root';
                                } else {
                                    if (hasBookmark) {
                                        nextType = 'bookmark';
                                    } else if (hasFolder) {
                                        nextType = 'folder';
                                    } else {
                                        nextGrouping = 'host';
                                    }
                                }
                            } else if (currentType === 'bookmark') {
                                if (hasFolder) {
                                    nextType = 'folder';
                                } else {
                                    nextType = 'domain';
                                    nextGrouping = 'host';
                                }
                            } else if (currentType === 'folder') {
                                nextType = 'domain';
                                nextGrouping = 'host';
                            } else {
                                nextType = 'domain';
                                nextGrouping = 'host';
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
                hideSearchResultsPanel();
            }
            toggleSearchModeMenu(false);
            toggleSearchHelpMenu(false);
        }
    } catch (_) { }
}

/**
 * 搜索输入框聚焦处理
 */
function handleSearchInputFocus(e) {
    try {
        const input = e && e.target ? e.target : document.getElementById('searchInput');
        if (!input) return;
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

    const exportBtn = e.target.closest('.canvas-bookmark-to-temp-btn');
    if (exportBtn) {
        e.preventDefault();
        e.stopPropagation();
        try { createTempSectionFromSearchResults(); } catch (_) { }
        try { hideSearchResultsPanel(); } catch (_) { }
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

    // 1. Handle Copy-Jump Badges AND Location Chips (Unified)
    // .search-result-badge-interactive (Legacy or direct Permanent badges)
    // .search-loc-chip, .search-loc-chip-row (New Bookmark Group Location chips)
    const interactive = e.target.closest('.search-result-badge-interactive, .search-loc-chip, .search-loc-chip-row');
    if (interactive) {
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
        const opts = { color: item.color || '#3b82f6' };

        // Is it a "Location Chip" with explicit instructions?
        const locId = interactive.dataset.locId;
        const locSource = interactive.dataset.locSource;
        const locSection = interactive.dataset.locSection;
        const copyId = interactive.dataset.copyId;

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

    const item = e && e.target ? e.target.closest('.search-result-item') : null;
    if (!item) return;
    const idx = parseInt(item.getAttribute('data-index') || '-1', 10);
    if (Number.isNaN(idx)) return;
    updateSearchResultSelection(idx);
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

/**
 * 初始化搜索模块事件监听
 * 应在 DOM 加载完成后调用
 */
function initSearchEvents() {
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

        searchInput.setAttribute('data-search-bound', 'true');
    }

    if (searchResultsPanel && !searchResultsPanel.hasAttribute('data-search-bound')) {
        searchResultsPanel.addEventListener('click', handleSearchResultsPanelClick);
        searchResultsPanel.addEventListener('mouseover', handleSearchResultsPanelMouseOver);
        searchResultsPanel.setAttribute('data-search-bound', 'true');
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
        desc: '书签标题、URL、文件夹名称',
        descEn: 'Title, URL, Folders'
    },
    {
        key: 'structure',
        label: '卡片',
        labelEn: 'Card',
        icon: 'fa-layer-group',
        color: 'mode-color-orange',
        // Include date-range example for card mode (e.g. 0107-0120)
        desc: '序号(#A/A-1), 群组(A-), 时间(今天/2024/0107-0120)',
        descEn: 'Index(#A/A-1), Group(A-), Time(Today/2024/0107-0120)'
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
// Bookmark -> Card -> Description
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

searchUiState.activeMode = 'bookmark';
searchUiState.isMenuOpen = false;
let autoHideMenuTimer = null;

// Search help guide (markdown) cache
let searchHelpGuideMarkdownCache = null;

function getActiveSearchMode() {
    return SEARCH_MODES.find(m => m.key === searchUiState.activeMode) || SEARCH_MODES[0];
}

function setSearchMode(modeKey) {
    const mode = SEARCH_MODES.find(m => m.key === modeKey);
    if (!mode) return;

    searchUiState.activeMode = modeKey;
    try { localStorage.setItem('canvasSearchMode', modeKey); } catch (_) { }
    renderSearchModeUI();

    // [Modified] Update input placeholder with mode description
    const input = document.getElementById('searchInput');
    if (input) {
        const isZh = currentLang === 'zh_CN';
        // Use the description as placeholder
        if (getCurrentViewSafe() === 'canvas') {
            input.placeholder = isZh ? mode.desc : mode.descEn;
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

        // Refresh search if there is query
        if (input.value.trim()) {
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

    setSearchMode(ordered[nextIndex].key);

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
    const label = currentLang === 'zh_CN' ? mode.label : mode.labelEn;
    trigger.innerHTML = `<i class="fas ${mode.icon} ${mode.color}"></i><span class="search-mode-label ${mode.color}">${label}</span>`;
    trigger.title = currentLang === 'zh_CN' ? `切换模式: ${label}` : `Mode: ${label}`;
    trigger.style.cursor = 'pointer';
    trigger.classList.add('active-mode-trigger');

    // [User Request] Wider search box in Canvas
    if (container) container.classList.add('canvas-search-active');
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

    let html = `<div class="search-mode-hint" style="text-align:left;">${hintText}</div>`;

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
}

function initSearchModeUI() {
    // [Phase 3.5] Restore persistent mode
    try {
        const savedMode = localStorage.getItem('canvasSearchMode');
        if (savedMode && SEARCH_MODES.some(m => m.key === savedMode)) {
            searchUiState.activeMode = savedMode;
        }
    } catch (_) { }

    // [Fix] Ensure placeholder and UI are synced on init
    setSearchMode(searchUiState.activeMode);

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
                        // Optional: Select text or move cursor to start? 
                        // User said "move to text we input", implying cursor position.
                        // Default focus behavior usually puts cursor at end or selects all depending on browser.
                        // Let's ensure it's usable.
                    }
                }
            }
        });
    }

    const menu = document.getElementById('searchModeMenu');
    if (menu) {
        menu.addEventListener('click', (e) => {
            // Only handle mode selection in Canvas/mode menu
            if (menu.dataset.menuType && menu.dataset.menuType !== 'mode') return;
            const item = e.target.closest('.search-mode-menu-item');
            if (item) {
                const modeKey = item.getAttribute('data-mode-key');
                if (modeKey) {
                    setSearchMode(modeKey);
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
    if (typeof CanvasState === 'undefined') return '';

    const tempCount = Array.isArray(CanvasState.tempSections) ? CanvasState.tempSections.length : 0;
    const mdCount = Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes.length : 0;
    const edgeCount = Array.isArray(CanvasState.edges) ? CanvasState.edges.length : 0;

    // Permanent bookmarks/folders rely on the cached bookmark tree snapshot.
    const treeVersion = (typeof lastTreeSnapshotVersion !== 'undefined' && lastTreeSnapshotVersion !== null)
        ? String(lastTreeSnapshotVersion)
        : '';
    const treeFingerprintLen = (typeof lastTreeFingerprint !== 'undefined' && lastTreeFingerprint)
        ? String(lastTreeFingerprint.length)
        : '';

    // Temporary bookmarks/folders rely on CanvasState.tempSections.items.
    // We prefer a timestamp written by the canvas module (cheap + reliable).
    const tempStateTimestamp = CanvasState.tempStateTimestamp || 0;
    const tempItemCounter = CanvasState.tempItemCounter || 0;

    // 使用计数器 + 简单的标题和说明 Checksum 作为签名
    // 解决：用户修改标题或说明后，计数器不变导致搜索索引不更新的问题
    let contentChecksum = 0;
    let tempRootItemsCount = 0;
    if (Array.isArray(CanvasState.tempSections)) {
        for (const s of CanvasState.tempSections) {
            // 简单校验和：标题长度 + 说明长度
            if (!s) continue;
            if (s.title) contentChecksum = (contentChecksum + s.title.length) % 10000;
            if (s.description) contentChecksum = (contentChecksum + s.description.length) % 10000;
            if (Array.isArray(s.items)) tempRootItemsCount = (tempRootItemsCount + s.items.length) % 100000;
        }
    }
    // 加入永久栏目说明的 checksum (从 Storage 读取)
    try {
        const permDesc = localStorage.getItem('canvas-permanent-tip-text') || '';
        contentChecksum = (contentChecksum + permDesc.length) % 10000;
    } catch (_) { }

    const tempCounter = CanvasState.tempSectionCounter || 0;
    const mdCounter = CanvasState.mdNodeCounter || 0;
    const edgeCounter = CanvasState.edgeCounter || 0;

    // Check permanent section copies count for cache invalidation
    let permanentCopiesLen = 0;
    try {
        const copies = JSON.parse(localStorage.getItem('permanent-section-copies') || '[]');
        permanentCopiesLen = Array.isArray(copies) ? copies.length : 0;
    } catch (_) { }

    return `${tempCount}:${mdCount}:${edgeCount}:${tempCounter}:${tempItemCounter}:${mdCounter}:${edgeCounter}:${contentChecksum}:${permanentCopiesLen}:${tempRootItemsCount}:${tempStateTimestamp}:${treeVersion}:${treeFingerprintLen}`;
}

/**
 * 重置画布搜索数据库
 */
function resetCanvasSearchDb(reason = '') {
    canvasSearchDb = {
        signature: null,
        items: [],
        itemById: new Map()
    };
    console.log('[Search] Phase 3 cache cleared:', reason);
}

// ==================== Phase 3: 索引构建 ====================

/**
 * 构建画布搜索数据库
 * 包含：说明搜索（MD卡片、连接线、栏目说明）+ 卡片搜索（标题）
 */
function buildCanvasSearchDb() {
    const signature = getCanvasSearchSignature();
    if (canvasSearchDb.signature === signature &&
        Array.isArray(canvasSearchDb.structureIndex) &&
        Array.isArray(canvasSearchDb.descriptionIndex) &&
        Array.isArray(canvasSearchDb.bookmarkIndex)) {
        return canvasSearchDb;
    }

    const startTime = performance.now();
    const structureIndex = [];
    const descriptionIndex = [];
    const bookmarkIndex = [];
    const itemById = new Map();

    if (typeof CanvasState === 'undefined') {
        canvasSearchDb = {
            signature,
            structureIndex: [],
            descriptionIndex: [],
            bookmarkIndex: [],
            itemById: new Map()
        };
        return canvasSearchDb;
    }

    // Helper: Convert preset color to hex
    const presetToHex = (preset) => {
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

    // Helper: Alpha index conversion
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

    // Helper: derive temp section timestamp from default title
    // Default title format: "YYYY-MM-DD HH:MM:SS" (see getDefaultTempSectionTitle in bookmark_canvas_module.js)
    const parseDefaultTempSectionTitleTime = (title) => {
        const t = String(title || '').trim();
        if (!t) return 0;

        // Accept: "YYYY-MM-DD", "YYYY-MM-DD HH:MM", "YYYY-MM-DD HH:MM:SS", also allow "T" separator.
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

        // 1) Explicit time
        const explicit = section.time;
        if (explicit) {
            const ms = (typeof explicit === 'number')
                ? explicit
                : Date.parse(String(explicit));
            if (Number.isFinite(ms) && ms > 0) return ms;
        }

        // 2) Default title timestamp (important for legacy data without createdAt)
        const fromTitle = parseDefaultTempSectionTitleTime(title);
        if (fromTitle) return fromTitle;

        // 3) createdAt fallback
        const createdAt = section.createdAt;
        if (createdAt) {
            const ms = (typeof createdAt === 'number')
                ? createdAt
                : parseInt(String(createdAt), 10);
            if (Number.isFinite(ms) && ms > 0) return ms;
        }

        return 0;
    };

    // Phase 3 Multi-column Detection
    // Determine if we should show column labels (#A, #B...).
    // Logic: If there are ANY copies OR any temp sections implying a column > 1 (e.g. B-1),
    // then we are in multi-column mode and should show labels for A as well.
    let maxIndexFound = 1;

    // 1. Check Copies (Raw check)
    try {
        const copies = JSON.parse(localStorage.getItem('permanent-section-copies') || '[]');
        if (Array.isArray(copies) && copies.length > 0) {
            maxIndexFound = 2; // At least B exists
        }
    } catch (_) { }

    // 2. Check Temp Sections (Ghost Check)
    // Even if copies are deleted, if B-1 temp sections exist, we keep multi-column mode.
    if (CanvasState.tempSections) {
        for (const section of CanvasState.tempSections) {
            if (!section) continue;
            let idx = 1;

            // Check originPermanent
            if (section.originPermanent && typeof section.originPermanent.displayIndex === 'number') {
                idx = section.originPermanent.displayIndex;
            }

            // Infer from Label "B-1"
            const label = (typeof section.label === 'string') ? section.label.trim() : '';
            if (label && /^[A-Z]-/i.test(label)) {
                const letter = label.charAt(0).toUpperCase();
                const inferred = letter.charCodeAt(0) - 64;
                if (inferred > idx) idx = inferred;
            }

            if (idx > maxIndexFound) maxIndexFound = idx;
        }
    }
    const isMultiColumnMode = maxIndexFound > 1;

    // 1. 临时栏目（卡片搜索 + 说明搜索）
    for (const section of (CanvasState.tempSections || [])) {
        if (!section || !section.id) continue;

        const title = section.title || section.name || '';
        const description = (section.description || '').replace(/<[^>]+>/g, ' ').trim();
        const time = inferTempSectionTime(section, title);
        let label = (typeof section.label === 'string') ? section.label.trim() : '';
        const sequenceNumber = section.sequenceNumber || null;

        if (!label && sequenceNumber) {
            // Replicate logical from bookmark_canvas_module.js
            const alpha = toAlpha(sequenceNumber);
            if (alpha) label = `${alpha}-1`;
        }

        let originDisplayIndex = null;
        if (section.originPermanent && typeof section.originPermanent === 'object') {
            if (typeof section.originPermanent.displayIndex === 'number') {
                originDisplayIndex = section.originPermanent.displayIndex;
            } else if (section.originPermanent.copyId === null) {
                originDisplayIndex = 1;
            }
        }

        // Infer index from Label if possible (e.g. "B-1" -> Index 2 (#B))
        // This fixes the issue where B-1 items show as #A because they originated from main section
        if (label && /^[A-Z]-/i.test(label)) {
            const letter = label.charAt(0).toUpperCase();
            const inferredIndex = letter.charCodeAt(0) - 64; // A=1, B=2...
            if (inferredIndex >= 1) {
                originDisplayIndex = inferredIndex;
            }
        }

        // Color Logic: Temp Section default #2563eb
        let color = '#2563eb';
        if (section.color) {
            // section.color might be hex without # or with #, or preset? Typically hex in this app.
            // Simple normalization
            const c = String(section.color).trim();
            color = c.startsWith('#') ? c : `#${c}`;
        }

        const item = {
            id: section.id,
            type: 'temp-section',
            title: title,
            label: label,
            sequenceNumber: sequenceNumber,
            description: description,
            time: time,
            originDisplayIndex: originDisplayIndex,
            x: section.x || 0,
            y: section.y || 0,
            color: color, // Store color
            __title: title.toLowerCase(),
            __label: label.toLowerCase(),
            __description: description.toLowerCase(),
            __timeSearchable: time ? buildTimeSearchableString(time) : '',
            isMultiColumnMode: isMultiColumnMode
        };

        // Partition Strategy:
        // Structure Index: If it has Title, Label, or Time (Structure data)
        // [Strict Separation] Clone item and remove description tokens for Structure Index
        const structureItem = Object.assign({}, item);
        structureItem.__description = ''; // Remove description content from search
        structureIndex.push(structureItem);

        // Description Index: If it has Description text
        if (description) {
            // [Strict Separation] Clone item and remove structure tokens for Description Index
            // Note: We keep __title for context if needed, but primary match is __description?
            // User requested strict separation ("Description is Description").
            // If we remove __title, searching Title in Description Mode won't work.
            // Assumption: Description Mode is for finding content "inside" the card/section.
            // We KEEP __title for display but maybe wipe it from search if we want ULTRA strict.
            // But let's start with removing the CROSS-POLLINATION (Structure shouldn't match Description).
            const descItem = Object.assign({}, item);

            // Should Description Mode match Title?
            // "Description Mode" desc says: "Section Notes, Card Text, Edge Labels".
            // It does NOT say "Section Title".
            // So we wipe __title and __label from Description Index item to be safe.
            descItem.__title = '';
            descItem.__label = '';
            descItem.__timeSearchable = '';

            descriptionIndex.push(descItem);
        }

        itemById.set(section.id, item); // itemById keeps the 'full' item for simple lookups if needed
    }

    // 2. MD 卡片（说明搜索 + 卡片标题）- 排除组框容器
    for (const node of (CanvasState.mdNodes || [])) {
        if (!node || !node.id) continue;
        if (node.subtype === 'import-container') continue;

        const title = node.title || '';
        const text = node.text || '';
        const subtype = node.subtype || '';

        // usage of node.color or node.colorHex
        let color = '#2563eb'; // Default Blue as per user request for "Blank Column"
        if (node.colorHex) {
            color = node.colorHex;
        } else if (node.color) {
            color = presetToHex(node.color) || color;
        }

        const item = {
            id: node.id,
            type: 'md-node',
            subtype: subtype,
            title: title,
            text: text,
            x: node.x || 0,
            y: node.y || 0,
            color: color,
            __title: title.toLowerCase(),
            __text: text.substring(0, 3000).toLowerCase()
        };

        // Partition Strategy:
        // Description Index: MD Cards are content
        descriptionIndex.push(item);

        // Also add to Structure Index if it acts as a "Head" (has Title)?
        // User definition: "Structure = Permanent, Temp, Groups". MD Cards are explicitly "Description".
        // So we do NOT add to structureIndex.

        itemById.set(node.id, item);
    }

    // 3. 连接线（说明搜索）
    for (const edge of (CanvasState.edges || [])) {
        if (!edge || !edge.id) continue;
        if (!edge.label) continue;

        const item = {
            id: edge.id,
            type: 'edge',
            label: edge.label,
            fromId: edge.from || edge.fromId,
            toId: edge.to || edge.toId,
            color: edge.colorHex || presetToHex(edge.color) || '#999', // Default fallback
            direction: edge.direction || 'none',
            __label: edge.label.toLowerCase()
        };

        // Partition Strategy:
        // Description Index: Edge Labels
        descriptionIndex.push(item);

        itemById.set(edge.id, item);
    }

    // 4. 永久栏目 (Permanent Section)
    let permanentDescription = '';
    try {
        const rawDesc = localStorage.getItem('canvas-permanent-tip-text') || '';
        permanentDescription = rawDesc.replace(/<[^>]+>/g, ' ').trim();
    } catch (e) { }

    // Check for copies to determine if main section needs #A label
    let permanentCopies = [];
    let hasCopies = false;
    try {
        const copiesRaw = localStorage.getItem('permanent-section-copies');
        permanentCopies = JSON.parse(copiesRaw || '[]');
        if (Array.isArray(permanentCopies) && permanentCopies.length > 0) {
            hasCopies = true;
        }
    } catch (e) {
        console.warn('[Search] Phase 3 permanent section copies read failed:', e);
    }

    const permanentSectionId = 'permanentSection';
    // Permanent Default Green
    const permColor = '#10b981';

    // Main Permanent Section
    // Title logic: If has copies, append #A to match user expectation (though render overrides commonly)
    // We add `hasCopies` property for the renderer to use.
    const mainTitle = (currentLang === 'en' ? 'Permanent Column' : '永久栏目') + ' #A';
    const mainLabel = '#a'; // Always searchable by #a
    // Keeping it searchable by #a might be useful even if hidden, but
    // logically if hidden, maybe user just searches "Permanent".

    const mainItem = {
        id: permanentSectionId,
        type: 'permanent-section',
        title: mainTitle,
        description: permanentDescription,
        copyIndex: null,
        displayIndex: 1,
        hasCopies: hasCopies, // Critical flag for renderer
        color: permColor,
        __title: (currentLang === 'en' ? 'permanent column' : '永久栏目'),
        __label: '#a', // Always allow searching by #A internally?
        __description: permanentDescription.toLowerCase(),
        isMultiColumnMode: isMultiColumnMode
    };

    // Partition Strategy:
    // Structure Index: Remove description
    const mainStructureItem = Object.assign({}, mainItem);
    mainStructureItem.__description = '';
    structureIndex.push(mainStructureItem);

    if (permanentDescription) {
        // Description Index: Remove structure labels
        const mainDescItem = Object.assign({}, mainItem);
        mainDescItem.__title = ''; // Don't match "Permanent Column" title in desc mode
        mainDescItem.__label = '';
        descriptionIndex.push(mainDescItem);
    }

    itemById.set(permanentSectionId, mainItem);

    // Permanent Copies
    if (hasCopies) {
        permanentCopies.forEach((copy, idx) => {
            if (!copy || !copy.id) return;

            // Sanitize displayIndex: Copies usually shouldn't be 1 (A).
            // If we find collision or invalid index, fallback to sequential (B, C...).
            let dIndex = copy.displayIndex;
            if (!Number.isFinite(dIndex) || dIndex <= 1) {
                dIndex = 2 + idx; // 0->2(B), 1->3(C)...
            }

            const idxLabel = toAlpha(dIndex);
            const copyItem = {
                id: copy.id,
                type: 'permanent-section',
                title: (currentLang === 'en' ? `Permanent Copy #${idxLabel}` : `永久栏目副本 #${idxLabel}`),
                description: permanentDescription,
                copyIndex: copy.copyIndex,
                displayIndex: dIndex, // Use sanitized index
                hasCopies: true,
                isMultiColumnMode: isMultiColumnMode,
                color: permColor,
                __title: (currentLang === 'en' ? `permanent copy #${idxLabel}` : `永久栏目副本 #${idxLabel}`).toLowerCase(),
                __label: `#${idxLabel.toLowerCase()}`,
                __description: permanentDescription.toLowerCase()
            };

            const itemStructureCopy = Object.assign({}, copyItem);
            itemStructureCopy.__description = '';

            structureIndex.push(itemStructureCopy);
            if (permanentDescription) {
                const itemDescCopy = Object.assign({}, copyItem);
                itemDescCopy.__title = '';
                itemDescCopy.__label = '';
                descriptionIndex.push(itemDescCopy);
            }
            itemById.set(copy.id, copyItem);
        });
    }

    // 5. 书签索引 (Bookmark Index)
    // 支持：永久栏目（cachedCurrentTree）+ 临时栏目（CanvasState.tempSections.items）
    const pushBookmarkIndexItem = (bItem) => {
        if (!bItem || !bItem.id) return;
        bookmarkIndex.push(bItem);
        itemById.set(String(bItem.id), bItem);
    };

    // 5a. 永久栏目：从 cachedCurrentTree 遍历所有书签/文件夹
    let permanentTree = null;
    try {
        if (typeof cachedCurrentTree !== 'undefined' && Array.isArray(cachedCurrentTree)) {
            permanentTree = cachedCurrentTree;
        } else if (typeof window !== 'undefined' && Array.isArray(window.cachedCurrentTree)) {
            // 兼容旧版本：若有挂到 window 上
            permanentTree = window.cachedCurrentTree;
        }
    } catch (_) { }

    if (permanentTree && permanentTree[0]) {
        // Iterative DFS to avoid call-stack overflow on deep trees.
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

            // 对于无标题书签，使用 URL 作为展示标题（避免搜索结果“空行”）
            const title = (nodeType === 'bookmark')
                ? (rawTitle || url || '')
                : rawTitle;

            if (rawTitle) pathStack.push(rawTitle);

            // 索引策略：
            // - 书签（有 URL）始终加入索引
            // - 文件夹：仅在有标题时加入索引（避免空标题污染结果）
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
                    __path: namedPath.toLowerCase()
                };
                pushBookmarkIndexItem(bItem);
            }

            // Exit frame (pop pathStack)
            stack.push({ node, stage: 1 });

            if (Array.isArray(node.children) && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i], stage: 0 });
                }
            }
        }
    }

    // 5b. 临时栏目：从 CanvasState.tempSections.items 遍历所有书签/文件夹
    if (Array.isArray(CanvasState.tempSections)) {
        for (const section of CanvasState.tempSections) {
            if (!section || !section.id || !Array.isArray(section.items)) continue;

            const sectionTitle = typeof section.title === 'string'
                ? section.title
                : (typeof section.name === 'string' ? section.name : '');

            // 复用 label 推导逻辑：优先 section.label，否则用 sequenceNumber 推导 "A-1"。
            let sectionLabel = (typeof section.label === 'string') ? section.label.trim() : '';
            const sequenceNumber = section.sequenceNumber || null;
            if (!sectionLabel && sequenceNumber) {
                const alpha = toAlpha(sequenceNumber);
                if (alpha) sectionLabel = `${alpha}-1`;
            }

            // 使用栏目颜色（若有），否则用默认蓝色
            let sectionColor = '#2563eb';
            if (section.color) {
                const c = String(section.color).trim();
                sectionColor = c.startsWith('#') ? c : `#${c}`;
            }

            const sectionPrefix = [sectionLabel, sectionTitle].filter(Boolean).join(' ');
            const pathStack = sectionPrefix ? [sectionPrefix] : [];

            // Iterative DFS to avoid call-stack overflow on deep trees.
            const stack = [];
            for (let i = section.items.length - 1; i >= 0; i--) {
                stack.push({ item: section.items[i], parentId: '', stage: 0 });
            }

            while (stack.length) {
                const frame = stack.pop();
                const item = frame ? frame.item : null;
                if (!item || !item.id) continue;

                const itemUrl = typeof item.url === 'string' ? item.url : '';
                const itemNodeType = item.type === 'folder' ? 'folder' : 'bookmark';

                const rawTitle = typeof item.title === 'string' ? item.title : '';
                const itemTitle = (itemNodeType === 'bookmark')
                    ? (rawTitle || itemUrl || '')
                    : rawTitle;

                if (frame.stage === 1) {
                    if (itemTitle) pathStack.pop();
                    continue;
                }

                if (itemTitle) pathStack.push(itemTitle);

                if (itemUrl || itemTitle) {
                    const namedPath = pathStack.length ? pathStack.join(' > ') : '';
                    const bItem = {
                        id: String(item.id),
                        type: 'bookmark-item',
                        source: 'temporary',
                        nodeType: itemNodeType,
                        title: itemTitle,
                        url: itemUrl,
                        parentId: frame.parentId ? String(frame.parentId) : '',
                        sectionId: String(section.id),
                        sectionLabel,
                        sectionTitle,
                        originalId: item.originalId ? String(item.originalId) : '',
                        namedPath,
                        color: sectionColor,
                        __title: itemTitle.toLowerCase(),
                        __url: itemUrl.toLowerCase(),
                        __path: namedPath.toLowerCase()
                    };
                    pushBookmarkIndexItem(bItem);
                }

                // Exit frame (pop pathStack)
                stack.push({ item, parentId: frame.parentId, stage: 1 });

                if (Array.isArray(item.children) && item.children.length) {
                    for (let j = item.children.length - 1; j >= 0; j--) {
                        stack.push({ item: item.children[j], parentId: item.id, stage: 0 });
                    }
                }
            }
        }
    }

    // Total Items count for log is sum? Or just structure+description?
    canvasSearchDb = {
        signature,
        structureIndex,
        descriptionIndex,
        bookmarkIndex,
        itemById
    };

    const count = structureIndex.length + descriptionIndex.length + bookmarkIndex.length;
    console.log(`[Search] Phase 3 index built (Partitioned): ${count} items (Structure:${structureIndex.length}, Desc:${descriptionIndex.length}, Bookmark:${bookmarkIndex.length}) in ${(performance.now() - startTime).toFixed(1)}ms`);
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

/**
 * 计算画布搜索项的匹配分数
 * @param {Object} item - 索引项
 * @param {string} query - 搜索关键词（小写）
 * @param {Object} options - 选项
 * @returns {number} - 匹配分数（-Infinity 表示不匹配）
 */
function scoreCanvasSearchItem(item, query, options = {}) {
    let score = 0;
    const q = query.toLowerCase();

    // 0. Mode-specific scoring check (Optional, as we partition indices now)
    // But helpful for mixed logic if any.

    // 1. 特殊语法：#N 序号定位 (Only for Permanent)
    if (item.type === 'permanent-section') {
        const sectionQuery = parsePermanentSectionQuery(query);
        if (sectionQuery) {
            if (sectionQuery.displayIndex === item.displayIndex) {
                return 300; // 精确匹配
            }
        }
    }

    // 2. 群组搜索（如 A- 或 A-1）- 只搜索临时栏目
    if (options.isGroupSearch) {
        // 群组搜索只适用于有 label 的临时栏目
        if (item.type === 'temp-section' && item.__label) {
            // 匹配 label 字段（如搜索 "A-" 匹配 "A-1", "A-2" 等）
            const prefix = query.toLowerCase().replace(/-$/, '');
            if (item.__label === prefix || item.__label.startsWith(prefix + '-')) {
                return 250;
            }
        }
        return -Infinity;
    }

    // 3. 时间搜索（临时栏目 - Unified Date）
    const dateMeta = parseDateQuery(q);
    if (dateMeta && item.type === 'temp-section' && item.time) {
        const d = new Date(item.time);
        let matched = false;
        let scoreVal = 0;

        if (dateMeta.type === 'day') {
            const vy = parseInt(dateMeta.y);
            const vm = parseInt(dateMeta.m);
            const vd = parseInt(dateMeta.d);

            if (dateMeta.ignoreYear) {
                if ((d.getMonth() + 1) === vm && d.getDate() === vd) {
                    matched = true; scoreVal = 200;
                }
            } else {
                if (d.getFullYear() === vy && (d.getMonth() + 1) === vm && d.getDate() === vd) {
                    matched = true; scoreVal = 200;
                }
            }
        } else if (dateMeta.type === 'month') {
            const vy = parseInt(dateMeta.y);
            const vm = parseInt(dateMeta.m);

            if (dateMeta.ignoreYear) {
                if ((d.getMonth() + 1) === vm) {
                    matched = true; scoreVal = 180;
                }
            } else {
                if (d.getFullYear() === vy && (d.getMonth() + 1) === vm) {
                    matched = true; scoreVal = 180;
                }
            }
        } else if (dateMeta.type === 'year') {
            if (d.getFullYear() === parseInt(dateMeta.y)) {
                matched = true;
                scoreVal = 160;
            }
        } else if (dateMeta.type === 'range') {
            // [New] Date Range Support for Canvas Card Mode
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const yyyy = String(d.getFullYear());

            if (dateMeta.ignoreYear) {
                // Compare only MM-DD
                const mmdd = mm + '-' + dd;
                const startMmdd = dateMeta.startM + '-' + dateMeta.startD;
                const endMmdd = dateMeta.endM + '-' + dateMeta.endD;
                if (mmdd >= startMmdd && mmdd <= endMmdd) {
                    matched = true;
                    scoreVal = 170;
                }
            } else {
                // Compare full date
                const fullDate = `${yyyy}-${mm}-${dd}`;
                if (fullDate >= dateMeta.startKey && fullDate <= dateMeta.endKey) {
                    matched = true;
                    scoreVal = 170;
                }
            }
        }

        if (matched) return scoreVal;
    }

    // 3b. 相对时间范围搜索 (本周/上周等 - Legacy Support)
    //parseDateQuery currently focuses on specific points (day/month/year). 
    //Time ranges are still handled by parseTimeKeyword for now.
    const timeKeyword = parseTimeKeyword(q);
    if (timeKeyword && timeKeyword.type === 'range' && item.type === 'temp-section' && item.time) {
        if (matchTimeRange(item.time, timeKeyword)) {
            return 150;
        }
    }

    // 4. 普通文本匹配
    // [Optim] Single letter query: strict prefix matching only to avoid noise (e.g. searching 'A' finding 'B-1' via 'a' in date/text)
    const isSingleChar = query.length === 1;

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
            // 时间字符串匹配
            // Ensure time string doesn't trigger on single char 'a' etc
            if (item.__timeSearchable && !isSingleChar && item.__timeSearchable.includes(q)) score = Math.max(score, 60);
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

        case 'bookmark-item': {
            // 书签/文件夹匹配（支持多关键词，以空格分隔）
            const tokens = q.split(/\s+/).map(s => s.trim()).filter(Boolean);
            if (!tokens.length) return -Infinity;

            let tokenScoreSum = 0;
            for (const t of tokens) {
                const isSingleToken = t.length === 1;
                let tokenScore = 0;

                if (item.__title) {
                    if (item.__title.startsWith(t)) tokenScore = Math.max(tokenScore, 140);
                    else if (item.__title.includes(t)) tokenScore = Math.max(tokenScore, 110);
                }
                if (item.__url && !isSingleToken && item.__url.includes(t)) tokenScore = Math.max(tokenScore, 90);

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

function buildCanvasBookmarkGroupModel(scoredPairs) {
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
        if (!item || item.type !== 'bookmark-item') continue;

        // Generate Content Key
        // Bookmarks: Title + URL
        // Folders: Title Only (marked as folder)
        let key, title, url, nodeType;

        if (item.nodeType === 'folder') {
            title = item.title;
            url = '';
            nodeType = 'folder';
            key = `FOLDER::${title}`;
        } else {
            title = item.title;
            url = item.url;
            nodeType = 'bookmark';
            key = `BM::${url}::${title}`; // URL primary, title secondary
        }

        const group = getOrCreateGroup(key, { title, url, nodeType });
        group.children.push({ item, s });
        group.bestScore = Math.max(group.bestScore, s);
    }

    const groups = Array.from(groupsMap.values());

    for (const g of groups) {
        // Sort children by "relevance" (though they are same content, maybe sort by location/source?)
        // For now, keep score sort (which might be identical) or sort by Source (Perm vs Temp)
        g.children.sort((a, b) => {
            if (b.s !== a.s) return b.s - a.s;
            // Secondary sort: Permanent first?
            const isAPerm = a.item.source === 'permanent';
            const isBPerm = b.item.source === 'permanent';
            if (isAPerm && !isBPerm) return -1;
            if (!isAPerm && isBPerm) return 1;
            return 0;
        });
        g.header.matchesCount = g.children.length;
    }

    // Sort groups by best score
    groups.sort((a, b) => {
        if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
        // Secondary: Count
        if (b.children.length !== a.children.length) return b.children.length - a.children.length;
        return String(a.header.title || '').localeCompare(String(b.header.title || ''));
    });

    return groups;
}

function buildCanvasBookmarkGroupedResultsFromModel(groups) {
    const results = [];
    const isZh = currentLang === 'zh_CN';

    const MAX_GROUPS = 50;

    const limitedGroups = Array.isArray(groups) ? groups.slice(0, MAX_GROUPS) : [];

    for (const g of limitedGroups) {
        if (!g || !g.header) continue;

        const groupId = String(g.id || g.header.id || '');
        if (!groupId) continue;

        // [Phase 3.7 Redesign] Flat Card Layout. 
        // No more "collapsed/expanded" parent-child rows.
        // Instead, we pass the children data directly into the group header item.
        // The render function will use this 'locations' array to draw chips.

        const locations = g.children.map(c => {
            const item = c.item;
            // Pre-calculate display props for efficiency
            const isPerm = item.source === 'permanent';
            let locationName = '';

            // Calculate Location Badge (Reuse Card Logic)
            let color = item.color || '#3b82f6'; // Default

            if (isPerm) {
                // Permanent
                locationName = isZh ? '永久栏目' : 'Permanent Section';
                color = '#059669'; // Fixed Green for Perm
            } else {
                // Temporary
                locationName = item.sectionTitle || (isZh ? '临时栏目' : 'Temp Section');
                // Use section color if available 
                // item.color should already be populated from buildCanvasSearchDb -> section.color
            }
            return {
                id: item.id, // Target ID to jump to
                source: item.source,
                sectionId: item.sectionId,
                label: item.sectionLabel, // e.g. "A-1"
                title: locationName,
                color: color,
                originalItem: item
            };
        });

        const headerItem = Object.assign({}, g.header, {
            id: groupId,
            type: 'bookmark-group', // Keep type, but render differently
            locations: locations, // [New] Attached locations
            matchesCount: g.children.length
        });
        results.push(headerItem);
    }

    return results;
}

// ==================== Phase 3: 搜索主入口 ====================

/**
 * 执行画布搜索并渲染结果
 * @param {string} query - 搜索关键词
 */
function searchCanvasAndRender(query) {
    const db = buildCanvasSearchDb();

    // Check if entire DB is broken
    if (!db.itemById) {
        renderSearchResultsPanel([], { view: 'canvas', query, emptyText: i18n.searchNoResults[currentLang] });
        return;
    }

    const trimmedQuery = String(query).trim();
    if (!trimmedQuery) {
        hideSearchResultsPanel();
        return;
    }

    // Determine Source Index based on Active Mode
    let sourceIndex = [];
    const mode = searchUiState.activeMode;

    if (mode === 'bookmark') {
        sourceIndex = db.bookmarkIndex || [];
    } else if (mode === 'description') {
        sourceIndex = db.descriptionIndex || [];
    } else {
        // Default to Structure (Card)
        sourceIndex = db.structureIndex || [];
    }

    if (sourceIndex.length === 0) {
        // Index empty for this mode
        renderSearchResultsPanel([], { view: 'canvas', query: trimmedQuery, emptyText: i18n.searchNoResults[currentLang] });
        return;
    }

    // 检测特殊语法
    // Bookmark 模式下应当被视为“纯文本搜索”，不触发 # / A- / 时间等特殊语法。
    const isBookmarkMode = mode === 'bookmark';
    const isGroupSearch = !isBookmarkMode && isGroupSearchQuery(trimmedQuery);
    const isPermanentQuery = !isBookmarkMode && parsePermanentSectionQuery(trimmedQuery) !== null;
    const timeKeyword = !isBookmarkMode ? parseTimeKeyword(trimmedQuery) : null;

    // 清除之前的高亮状态 (用户输入改变时，如果不再匹配之前的群组，需要清除高亮)
    clearCanvasSearchHighlight();

    const scored = [];

    // Aggregation buckets
    const groupAggregation = {
        ids: [],
        type: null, // 'permanent-group' | 'temp-group' | 'time-range'
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
    // 1c. Time Range Intent
    else if (timeKeyword && timeKeyword.type !== 'invalid') {
        // e.g. "2024", "1月"
        isAggregationIntent = true;
        groupAggregation.type = 'time-range';
        groupAggregation.label = (typeof currentLang !== 'undefined' && currentLang === 'en') ? `Time Range: ${trimmedQuery}` : `时间范围: ${trimmedQuery}`;
    }

    for (const item of sourceIndex) {
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
            if (item.type !== 'permanent-section' && item.type !== 'temp-section') {
                continue;
            }
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

        // 特殊语法过滤
        if (isPermanentQuery && item.type !== 'permanent-section') continue;

        const s = scoreCanvasSearchItem(item, trimmedQuery, { isGroupSearch });
        if (s > -Infinity) {
            scored.push({ item, s });

            // Collect for Aggregation
            if (groupAggregation.type === 'permanent-group') {
                if (item.type === 'permanent-section') {
                    groupAggregation.ids.push(item.id);
                    groupAggregation.count++;
                }
            } else if (groupAggregation.type === 'time-range') {
                // Item matches time search?
                // scoreCanvasSearchItem returns > -Infinity if match, so we can trust `s`
                // But we want to ensure it's a time match, not just text match.
                // Ideally check `scoreCanvasSearchItem` logic, but here assume if it scored high enough and is temp section
                if (item.type === 'temp-section' && s >= 100) { // arbitrary threshold for time match logic
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

    // 按分数排序
    scored.sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        // 稳定排序：按标题
        const ta = a.item.title || a.item.label || '';
        const tb = b.item.title || b.item.label || '';
        return ta.localeCompare(tb);
    });

    // Bookmark Mode: Group results by "section card" (永久栏目 / 临时栏目)
    if (mode === 'bookmark') {
        const groups = buildCanvasBookmarkGroupModel(scored);
        searchUiState.bookmarkGroupModel = groups;
        const groupedResults = buildCanvasBookmarkGroupedResultsFromModel(groups);
        renderCanvasSearchResults(groupedResults, { view: 'canvas', query: trimmedQuery, selectedIndex: 0 });
        return;
    }

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
    renderCanvasSearchResults(finalResults, { view: 'canvas', query: trimmedQuery, isGroupSearch });
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
                    <div class="mode-desc">${escapeHtml(desc)}</div>
                </div>
            </div>
        `;
    }).join('');

    // Add a header or instruction? User said "double click to click exclusive mode???" maybe just display them as hints.
    // Making them non-clickable (pointer-events: none) as they are suggestions/help.
    // Or we could make them clickable to pre-fill the input with a prefix like "#" or "A-".

    // [Tweak] Stronger border for separation
    const arrowUpSvg = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path d="M12 21V7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M7 11l5-5 5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    const hideLabel = isZh ? '下次不再出现' : "Don't show again";
    const hintText = isZh
        ? '点左侧按钮切换模式'
        : 'Use the left button to switch mode';
    const hintHelpText = isZh
        ? '模式切换：← 到左侧模式按钮，↑/↓ 切换并实时更新结果；空输入：↑/↓ 直接切换模式。书签模式：光标在输入末尾时，→ 切换书签/文件夹/域名筛选。候选条目：↑/↓ 选择，Enter 跳转；域名结果：Enter 生成临时栏目。域名粒度：点击域名旁按钮切换主域名/子域名。'
        : 'Mode: ← to the left mode button, ↑/↓ switches and updates results; empty: ↑/↓ switches modes directly. Bookmark mode: with cursor at end, → toggles bookmark/folder/domain filter. Results: ↑/↓ to select, Enter to jump; Domain results: Enter creates a temp section. Domain granularity: click the domain pill to toggle root/subdomain.';
    const hintLabelWidth = isZh ? '5em' : '6ch';
    const hintLabelStyle = `display:inline-block; min-width:${hintLabelWidth};`;
    const hintHelpHtml = isZh
        ? `<span style="${hintLabelStyle}">模式切换：</span><span>← 到左侧模式按钮，↑/↓ 切换并实时更新结果；</span><br><span style="${hintLabelStyle}"></span><span>空输入：↑/↓ 直接切换模式。</span><br>书签模式：光标在输入末尾时，→ 切换书签/文件夹/域名筛选。<br>候选条目：↑/↓ 选择，Enter 跳转；域名结果：Enter 生成临时栏目。<br>域名粒度：点击域名旁按钮切换主域名/子域名。`
        : `<span style="${hintLabelStyle}">Mode:</span><span>← to the left mode button, ↑/↓ switches and updates results;</span><br><span style="${hintLabelStyle}"></span><span>Empty: ↑/↓ switches modes directly.</span><br>Bookmark mode: with cursor at end, → toggles bookmark/folder/domain filter.<br>Results: ↑/↓ to select, Enter to jump; Domain results: Enter creates a temp section.<br>Domain granularity: click the domain pill to toggle root/subdomain.`;

    panel.innerHTML = `
        <div class="search-suggestions-header" style="position:relative; padding:6px 10px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:flex-end; gap:10px;">
            <div class="search-empty-suggestions-hint" style="position:absolute; left:16px; top:50%; transform:translateY(-50%);">
                <span class="search-hint-icon" style="display:inline-flex; position:relative; top:-1px;">${arrowUpSvg}</span>
                <span class="search-hint-text">${escapeHtml(hintText)}</span>
                <button type="button" class="search-hint-help-btn perf-help-btn" aria-label="${escapeHtml(hintHelpText)}">
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
            el.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const key = el.getAttribute('data-mode-key');
                if (key) {
                    try { setSearchMode(key); } catch (_) { }
                    try { hideSearchResultsPanel(); } catch (_) { }
                    try {
                        const input = document.getElementById('searchInput');
                        if (input) requestAnimationFrame(() => input.focus());
                    } catch (_) { }
                }
            });
        });
        const helpBtn = panel.querySelector('.search-hint-help-btn');
        if (helpBtn) {
            const ensurePopover = () => {
                let pop = document.getElementById('searchHintPopover');
                if (!pop) {
                    pop = document.createElement('div');
                    pop.id = 'searchHintPopover';
                    pop.className = 'perf-help-popover search-hint-help-popover';
                    pop.innerHTML = '<div class="perf-help-popover-content"></div>';
                    document.body.appendChild(pop);
                }
                return pop;
            };

            const helpPopover = ensurePopover();
            const contentEl = helpPopover.querySelector('.perf-help-popover-content');
            if (contentEl) contentEl.innerHTML = hintHelpHtml;

            let outsideHandler = null;
            const showHelp = () => {
                helpPopover.classList.add('show');
                helpPopover.style.visibility = 'hidden';
                helpPopover.style.width = 'max-content';
                helpPopover.style.maxWidth = '560px';

                const rect = helpBtn.getBoundingClientRect();
                const popRect = helpPopover.getBoundingClientRect();
                const margin = 12;
                let left = rect.left - 8;
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
            const hideHelp = () => {
                helpPopover.classList.remove('show');
                if (outsideHandler) {
                    document.removeEventListener('mousedown', outsideHandler, true);
                    outsideHandler = null;
                }
            };

            helpPopover.classList.remove('show');

            helpBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (helpPopover.classList.contains('show')) {
                    hideHelp();
                } else {
                    showHelp();
                }
            };
        }
    } catch (_) { }

    // Align the arrow (inside hint) to the center of the left search button.
    try {
        requestAnimationFrame(() => {
            const trigger = document.getElementById('searchModeTrigger');
            const hint = panel.querySelector('.search-empty-suggestions-hint');
            if (!trigger || !hint) return;
            const triggerRect = trigger.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            const centerX = triggerRect.left + triggerRect.width / 2;
            const arrowHalf = 8;
            const arrowNudgeLeft = 2;
            const left = centerX - panelRect.left - arrowHalf - arrowNudgeLeft;
            const clamped = Math.max(10, Math.min(panelRect.width - 10, left));
            hint.style.left = `${clamped}px`;
        });
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

function ensureDomainCacheForQuery(query) {
    const q = String(query || '').trim().toLowerCase();
    const treeKey = getDomainCacheKey();
    const groupLevel = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';
    const cache = searchUiState.domainIndexCache;
    if (cache && cache.query === q && cache.treeKey === treeKey && cache.groupLevel === groupLevel) return cache;

    const db = buildCanvasSearchDb();
    const items = Array.isArray(db.bookmarkIndex) ? db.bookmarkIndex : [];
    const map = new Map();

    for (const item of items) {
        if (!item || item.source !== 'permanent' || item.nodeType !== 'bookmark') continue;

        const domain = getDomainGroupKey(item.url);
        if (!domain) continue;

        let entry = map.get(domain);
        if (!entry) {
            entry = { domain, count: 0, items: [], match: false };
            map.set(domain, entry);
        }
        entry.count += 1;
        entry.items.push({ title: item.title, url: item.url, id: item.id });

        if (q && !entry.match) {
            if (domain.includes(q)) {
                entry.match = true;
            } else {
                const t = String(item.__title || '');
                const u = String(item.__url || '');
                const p = String(item.__path || '');
                if (t.includes(q) || u.includes(q) || p.includes(q)) {
                    entry.match = true;
                }
            }
        }
    }

    const results = Array.from(map.values())
        .filter(entry => !q || entry.match)
        .map(entry => ({
            id: `domain:${entry.domain}`,
            type: 'domain-group',
            domain: entry.domain,
            title: entry.domain,
            count: entry.count,
            color: '#0ea5e9'
        }));

    results.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.domain || '').localeCompare(String(b.domain || ''));
    });

    const nextCache = { query: q, treeKey, groupLevel, map, results };
    searchUiState.domainIndexCache = nextCache;
    return nextCache;
}

function getDomainResultsForQuery(query) {
    const cache = ensureDomainCacheForQuery(query);
    return Array.isArray(cache.results) ? cache.results : [];
}

function getDomainItemsForTemp(domain, query) {
    const cache = ensureDomainCacheForQuery(query);
    const key = String(domain || '').trim().toLowerCase();
    const entry = cache.map.get(key);
    return entry && Array.isArray(entry.items) ? entry.items : [];
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
    let bookmarkModeCounts = null;
    let displayResults = results;
    let domainResults = [];
    let domainCount = 0;

    if (isBookmarkMode) {
        const countType = (nodeType) => (Array.isArray(results)
            ? results.filter(r => r && (r.type === 'bookmark-group' || r.type === 'bookmark-item') && r.nodeType === nodeType).length
            : 0);

        const bookmarkCount = countType('bookmark');
        const folderCount = countType('folder');
        try {
            const q = options.query || searchUiState.query || '';
            domainResults = getDomainResultsForQuery(q);
            domainCount = domainResults.length;
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
            displayResults = results.filter(r => !(r && r.nodeType === 'folder'));
        } else if (effectiveFilter === 'folder') {
            displayResults = results.filter(r => !(r && r.nodeType === 'bookmark'));
        } else if (effectiveFilter === 'domain') {
            displayResults = domainResults;
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

    searchUiState.view = 'canvas';
    searchUiState.query = options.query || '';
    searchUiState.results = displayResults;
    if (typeof options.selectedIndex === 'number' && Number.isFinite(options.selectedIndex)) {
        const maxIdx = displayResults.length - 1;
        searchUiState.selectedIndex = maxIdx >= 0 ? Math.max(0, Math.min(maxIdx, options.selectedIndex)) : -1;
    } else {
        searchUiState.selectedIndex = displayResults.length > 0 ? 0 : -1;
    }

    if (displayResults.length === 0) {
        // [Modified] Customize empty message for Bookmark mode
        let msg = options.emptyText || (i18n.searchNoResults ? i18n.searchNoResults[currentLang] : '无结果');
        if (searchUiState.activeMode === 'bookmark') {
            // If we have no bookmarks indexed (maybe tree not loaded), prompt user?
            // Or just standard no results.
            // msg = "No bookmark matches found"; 
        }
        panel.innerHTML = `<div class="search-result-empty">${msg}</div>`;
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
    const markQueryInText = (text) => {
        const safe = escapeHtml(String(text || ''));
        if (!queryText) return safe;
        try {
            const escapedQuery = queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(${escapedQuery})`, 'gi');
            return safe.replace(re, '<mark>$1</mark>');
        } catch (_) {
            return safe;
        }
    };

    // Canvas Bookmark Mode: render a top toggle row (counts + click to switch)
    if (isBookmarkMode && bookmarkModeCounts) {
        const { bookmarkCount, folderCount, domainCount } = bookmarkModeCounts;
        const active = searchUiState.bookmarkTypeFilter;

        const showBookmarkBtn = bookmarkCount > 0;
        const showFolderBtn = folderCount > 0;
        const showDomainBtn = domainCount > 0;

        if (showBookmarkBtn || showFolderBtn || showDomainBtn) {
            const makeBtn = ({ type, icon, color, count }) => {
                const isActive = active === type;
                const bg = isActive ? `${color}22` : 'transparent';
                const border = isActive ? `${color}55` : 'rgba(128, 128, 128, 0.28)';
                const text = isActive ? color : 'var(--text-secondary)';
                return `<button class="canvas-bookmark-type-btn" data-type="${type}" style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; border:1px solid ${border}; background:${bg}; color:${text}; font-size:12px; font-weight:600; cursor:pointer;">
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
            const domainBtn = showDomainBtn
                ? makeBtn({ type: 'domain', icon: 'fa-globe', color: '#0ea5e9', count: domainCount })
                : '';
            const domainGrouping = (searchUiState && searchUiState.domainGrouping === 'host') ? 'host' : 'root';
            const subdomainLabel = isZh ? '子域名' : 'Subdomain';
            const rootDomainLabel = isZh ? '主域名' : 'Root';
            const domainGroupingTitle = isZh
                ? '域名粒度：点击切换 主域名 / 子域名'
                : 'Domain granularity: click to toggle root/subdomain';
            const subActive = active === 'domain' && domainGrouping === 'host';
            const rootActive = active === 'domain' && domainGrouping === 'root';
            const domainGranularityBtn = showDomainBtn
                ? `<button class="canvas-bookmark-domain-granularity-btn ${subActive ? 'active' : ''}" type="button" data-domain-group="host" title="${escapeHtml(domainGroupingTitle)}">${escapeHtml(subdomainLabel)}</button>
                   <button class="canvas-bookmark-domain-granularity-btn ${rootActive ? 'active' : ''}" type="button" data-domain-group="root" title="${escapeHtml(domainGroupingTitle)}">${escapeHtml(rootDomainLabel)}</button>`
                : '';

            const visibleCount = displayResults.filter(r => r && (r.type === 'bookmark-group' || r.type === 'bookmark-item')).length;
            const exportLabel = isZh
                ? `生成临时栏目${visibleCount ? ` (${visibleCount})` : ''}`
                : `To Temp Section${visibleCount ? ` (${visibleCount})` : ''}`;

            const showExportBtn = active !== 'domain';
            const exportBtnHtml = showExportBtn
                ? `<button class="canvas-bookmark-to-temp-btn" type="button">${escapeHtml(exportLabel)}</button>`
                : '';
            const justifyStyle = showExportBtn ? 'space-between' : 'flex-start';

            html += `<div class="canvas-bookmark-type-toggle" style="display:flex; align-items:center; justify-content:${justifyStyle}; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border-color);">
                <div style="display:flex; align-items:center; gap:8px;">${bookmarkBtn}${folderBtn}${domainBtn}${domainGranularityBtn}</div>
                ${exportBtnHtml}
            </div>`;
        }
    }

    displayResults.forEach((item, index) => {
        const isSelected = index === searchUiState.selectedIndex ? 'selected' : '';
        let title = '';
        let badge = '';
        let indexLabel = '';
        let descHtml = '';

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
                // 2. 序号：#A
                if (item.originDisplayIndex) {
                    const alpha = toAlpha(item.originDisplayIndex);
                    // Show label if index > 1 OR internal multi-column mode is active (so A is shown)
                    if (item.originDisplayIndex > 1 || item.isMultiColumnMode) {
                        indexLabel += makeColoredSpan(`#${alpha}`, 'hash');
                    }
                }

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
                const countLabel = isZh ? `${count} 个书签` : `${count} bookmarks`;
                indexLabel = `<div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; margin-right:2px;">
                    <i class="fas fa-globe" style="color:#0ea5e9; font-size:16px;"></i>
                </div>`;
                title = `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; color:var(--text-normal);">${domainText}</div>`;
                descHtml = `<div class="search-result-match" style="margin-top:2px; color:var(--text-muted); font-size:11px;">${escapeHtml(countLabel)}</div>`;
                badge = makeColoredBadge(isZh ? '域名' : 'Domain', 'domain');
                break;
            }

            case 'bookmark-group': {
                // [Phase 3.7 Redesign] Card Layout
                indexLabel = '';

                // 1. Icon (Folder=Blue, Bookmark=Gold or Favicon)
                const isFolder = item.nodeType === 'folder';

                let iconHtml = '';
                if (isFolder) {
                    // 文件夹：使用蓝色文件夹图标
                    iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; margin-right:2px;">
                        <i class="fas fa-folder" style="color:#2563eb; font-size:16px;"></i>
                    </div>`;
                } else if (item.url) {
                    // 书签：优先尝试加载 favicon，fallback 到黄色书签图标
                    // [接入 FaviconCache 统一缓存系统]
                    const bookmarkFallbackHtml = `<div class="search-result-icon-box-inline" style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; margin-right:2px;">
                        <i class="fas fa-bookmark" style="color:#f59e0b; font-size:16px;"></i>
                    </div>`;

                    if (typeof getFaviconUrl === 'function') {
                        const faviconSrc = getFaviconUrl(item.url);
                        // 检查是否是真实 favicon（不是 SVG fallback 图标）
                        if (faviconSrc && !faviconSrc.startsWith('data:image/svg+xml')) {
                            // 真实 favicon（已缓存）
                            iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; margin-right:2px;">
                                <img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" style="width:16px; height:16px; object-fit:contain;" alt="">
                            </div>`;
                        } else {
                            // fallback 图标 + 隐藏的 img 用于后台加载后更新
                            iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; margin-right:2px; position:relative;">
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
                    iconHtml = `<div style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; flex-shrink:0; margin-right:2px;">
                        <i class="fas fa-bookmark" style="color:#f59e0b; font-size:16px;"></i>
                    </div>`;
                }

                indexLabel = iconHtml;

                // 2. Title & URL
                const titleText = escapeHtml(item.title || (isZh ? '（无标题）' : '(Untitled)'));
                title = `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; color:var(--text-normal);">${titleText}</div>`;

                let urlHtml = '';
                if (item.url) {
                    urlHtml = `<div style="color:var(--text-tertiary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:0px;">${escapeHtml(item.url)}</div>`;
                }

                // 3. Location Chips (Grouped & Labeled)
                let locationsHtml = '';
                if (item.locations && item.locations.length > 0) {

                    const perms = item.locations.filter(l => l.source === 'permanent');
                    const temps = item.locations.filter(l => l.source !== 'permanent');

                    // Helper to make chip
                    const makeChip = (text, color, attr, extraStyle = '') => {
                        return `<div class="search-loc-chip" ${attr} style="cursor:pointer; display:inline-flex; align-items:center; border:1px solid ${color}; color:${color}; background:${color}08; border-radius:4px; padding:0 5px; font-size:11px; height:18px; line-height:16px; box-sizing:border-box; ${extraStyle}" title="${escapeHtml(text)}"><div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${text}</div></div>`;
                    };

                    // A. Permanent Row
                    if (perms.length > 0) {
                        // Reuse first perm item for ID reference (they are usually duplicates in terms of location logic if multiple perm matches exist, but usually just one "Permanent" location per bookmark logic)
                        const loc = perms[0];
                        // [User Request] White text for labels
                        const permLabel = `<span style="color:var(--text-normal); font-weight:bold; font-size:11px; margin-right:6px;">${isZh ? '永久栏目' : 'Permanent'}:</span>`;

                        let copyBadges = [];

                        try {
                            const copiesStr = localStorage.getItem('permanent-section-copies');
                            const copies = copiesStr ? JSON.parse(copiesStr) : [];

                            // #A
                            // Badge Click Attr
                            const clickAttrBase = `data-loc-id="${loc.id}" data-loc-source="permanent"`;

                            copyBadges.push(makeChip('#A', '#059669', `${clickAttrBase} data-copy-id="null"`));

                            const toAlphaLocal = (num) => (num > 0 ? String.fromCharCode(64 + num) : '');
                            copies.forEach((c, idx) => {
                                if (!c || !c.id) return;
                                let dIdx = parseInt(c.displayIndex, 10);
                                if (Number.isNaN(dIdx) || dIdx <= 1) dIdx = 2 + idx;
                                const label = toAlphaLocal(dIdx);
                                copyBadges.push(makeChip(`#${label}`, '#059669', `${clickAttrBase} data-copy-id="${c.id}"`));
                            });
                        } catch (_) { }

                        if (copyBadges.length === 0) {
                            copyBadges.push(makeChip('#A', '#059669', `data-loc-id="${loc.id}" data-loc-source="permanent" data-copy-id="null"`));
                        }

                        // Join with commas
                        const badgestStr = copyBadges.join('<span style="margin:0 4px; color:#999;">,</span>');

                        locationsHtml += `<div style="display:flex; align-items:center; margin-top:4px;">
                            ${permLabel}
                            <div style="display:flex; align-items:center; flex-wrap:wrap;">${badgestStr}</div>
                        </div>`;
                    }

                    // B. Temporary Row
                    if (temps.length > 0) {
                        // [User Request] White text for labels
                        const tempLabel = `<span style="color:var(--text-normal); font-weight:bold; font-size:11px; margin-right:6px;">${isZh ? '临时栏目' : 'Temporary'}:</span>`;

                        const tempBadges = temps.map(loc => {
                            const color = loc.color || '#3b82f6';
                            const seq = loc.label ? loc.label : '';
                            const htmlTitle = escapeHtml(loc.title);
                            // Content: "A-1 Title"
                            const content = seq ? `<b>${escapeHtml(seq)}</b> <span style="opacity:0.8; margin-left:3px;">${htmlTitle}</span>` : htmlTitle;
                            const attr = `data-loc-id="${loc.id}" data-loc-source="${loc.source}" data-loc-section="${loc.sectionId || ''}"`;
                            return makeChip(content, color, attr);
                        });

                        // Join with commas
                        const badgestStr = tempBadges.join('<span style="margin:0 4px; color:#999;">,</span>');

                        locationsHtml += `<div style="display:flex; align-items:baseline; margin-top:4px;">
                            ${tempLabel}
                            <div style="display:flex; flex-wrap:wrap; align-items:center;">${badgestStr}</div>
                        </div>`;
                    }
                }

                descHtml = `<div class="search-result-match" style="display:flex; flex-direction:column; width:100%; min-width:0;">
                    ${urlHtml}
                    ${locationsHtml}
                </div>`;

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
                    const icon = item.nodeType === 'folder' ? 'fa-folder' : 'fa-bookmark';
                    indexLabel = `<span class="search-child-dot"><i class="fas ${icon}"></i></span>`;
                }

                title = escapeHtml(item.title || (isZh ? '（无标题）' : '(Untitled)'));

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
                if (item.source === 'permanent') {
                    try {
                        const copiesStr = localStorage.getItem('permanent-section-copies');
                        const copies = copiesStr ? JSON.parse(copiesStr) : [];
                        // Only show interactive badges if there are ACTUALLY copies (B, C...)
                        if (Array.isArray(copies) && copies.length > 0) {
                            // Build interactive HTML
                            // Style: small chips, clickable
                            let buttonsHtml = '';

                            // Button A (Main)
                            const styleBase = `cursor:pointer; margin-left:4px; padding:0 6px; font-family:monospace; font-weight:bold; color:var(--text-secondary); background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:4px; font-size:11px;`;

                            // #A
                            buttonsHtml += `<span class="search-result-badge-interactive" data-copy-id="null" data-display-index="1" style="${styleBase}" title="Jump to Copy #A">#A</span>`;

                            const toAlphaLocal = (num) => {
                                if (num <= 0) return '';
                                return String.fromCharCode(64 + num);
                            };

                            copies.forEach((c, idx) => {
                                if (!c || !c.id) return;

                                let dIdx = parseInt(c.displayIndex, 10);
                                if (Number.isNaN(dIdx) || dIdx <= 1) {
                                    dIdx = 2 + idx;
                                }

                                const label = toAlphaLocal(dIdx);
                                buttonsHtml += `<span class="search-result-badge-interactive" data-copy-id="${escapeHtml(c.id)}" data-display-index="${dIdx}" style="${styleBase}" title="Jump to Copy #${label}">#${label}</span>`;
                            });

                            if (buttonsHtml) {
                                badge = `<div style="display:flex; align-items:center; flex-shrink:0;">${buttonsHtml}</div><div style="width:8px;"></div>${badge}`;
                            }
                        }
                    } catch (e) { console.error(e); }
                }

                // [Feature] 临时栏目跳转按钮 (Similar to Permanent Buttons)
                if (item.source === 'temporary' && item.sectionId) {
                    const sectionName = item.sectionLabel || item.sectionTitle || (isZh ? '临时' : 'Temp');
                    // Style: mimic permanent interactive badge but allow colored border
                    const sectionColor = item.color || '#3b82f6';
                    // Utilize the same robust style
                    const styleBase = `cursor:pointer; margin-left:4px; padding:0 6px; font-family:monospace; font-weight:bold; color:var(--text-secondary); background:var(--bg-secondary); border:1px solid ${sectionColor}80; border-radius:4px; font-size:11px;`;

                    // Use .search-loc-chip class as it triggers 'handleSearchResultsPanelClick' with data-loc-... attributes
                    const attr = `data-loc-id="${item.id}" data-loc-source="temporary" data-loc-section="${item.sectionId}"`;
                    // Use sectionTitle for tooltip
                    const tooltip = escapeHtml(item.sectionTitle || sectionName);

                    const buttonsHtml = `<span class="search-loc-chip" ${attr} style="${styleBase}" title="${tooltip}">${escapeHtml(sectionName)}</span>`;

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

        // Bookmark/Folder meta: show URL only (no path)
        if (item.type === 'bookmark-item' && item.url) {
            descHtml = `<div class="search-result-match" style="margin-top:4px; color:var(--text-muted); font-size:11px; line-height:1.35; overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${markQueryInText(item.url)}</div>`;
        }

        const extraClasses = [];
        if (item.type === 'bookmark-group') extraClasses.push('bookmark-group');
        if (item.type === 'bookmark-group-more') extraClasses.push('bookmark-more');
        if (item.isChild) extraClasses.push('bookmark-child');
        const rowClassName = ['search-result-item', isSelected].concat(extraClasses).filter(Boolean).join(' ');

        html += `
            <div class="${rowClassName}" data-index="${index}" data-id="${item.id}" data-type="${item.type}">
                <div class="search-result-content">
                    <div class="search-result-title">${indexLabel}${title}</div>
                    ${descHtml}
                </div>
                ${badge}
            </div>
        `;
    });

    panel.innerHTML = html;
    showSearchResultsPanel();
    updateSearchResultSelection(searchUiState.selectedIndex);

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

    items = (searchUiState.results || []).filter(r => r && r.type === 'bookmark-item');
    if (filter === 'bookmark') {
        items = items.filter(r => r.nodeType === 'bookmark');
    } else if (filter === 'folder') {
        items = items.filter(r => r.nodeType === 'folder');
    }
    return items;
}

function getCanvasViewportCenterForTemp() {
    const workspace = document.getElementById('canvasWorkspace');
    const state = (window.CanvasModule && window.CanvasModule.CanvasState) ? window.CanvasModule.CanvasState : (typeof CanvasState !== 'undefined' ? CanvasState : null);
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

function createTempSectionFromSearchResults() {
    if (getCurrentViewSafe() !== 'canvas') return;
    if (!window.CanvasModule || !window.CanvasModule.createEmptyTempSection || !window.CanvasModule.temp) return;

    const items = collectBookmarkItemsForTempSection();
    if (!items.length) return;

    const isZh = currentLang === 'zh_CN';
    const query = String(searchUiState.query || '').trim();
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
    const getPermanentTreeRoot = () => {
        try {
            if (typeof cachedCurrentTree !== 'undefined' && Array.isArray(cachedCurrentTree)) return cachedCurrentTree[0] || null;
        } catch (_) { }
        try {
            if (typeof window !== 'undefined' && Array.isArray(window.cachedCurrentTree)) return window.cachedCurrentTree[0] || null;
        } catch (_) { }
        return null;
    };
    const findPermanentNodeById = (targetId) => {
        const root = getPermanentTreeRoot();
        if (!root || !targetId) return null;
        const stack = [root];
        const idStr = String(targetId);
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node.id === 'undefined' || node.id === null) continue;
            if (String(node.id) === idStr) return node;
            if (Array.isArray(node.children) && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
        return null;
    };
    const buildPayloadFromPermanentNode = (node) => {
        if (!node) return null;
        const url = typeof node.url === 'string' ? node.url : '';
        const rawTitle = typeof node.title === 'string' ? node.title : '';
        if (url) {
            return {
                title: rawTitle || url || (isZh ? '书签' : 'Bookmark'),
                url,
                type: 'bookmark',
                children: []
            };
        }
        const children = Array.isArray(node.children) ? node.children.map(child => buildPayloadFromPermanentNode(child)).filter(Boolean) : [];
        return {
            title: rawTitle || (isZh ? '文件夹' : 'Folder'),
            url: '',
            type: 'folder',
            children
        };
    };

    items.forEach(item => {
        if (!item) return;
        if (item.nodeType === 'folder') {
            let payload = null;
            if (item.source === 'temporary' && item.sectionId && typeof tempApi.extractPayload === 'function') {
                try { payload = tempApi.extractPayload(item.sectionId, [item.id]); } catch (_) { }
            } else if (item.source === 'permanent') {
                const node = findPermanentNodeById(item.id);
                const built = buildPayloadFromPermanentNode(node);
                if (built) payload = [built];
            }
            if (payload && payload.length && typeof tempApi.insertFromPayload === 'function') {
                tempApi.insertFromPayload(sectionId, null, payload);
                return;
            }
            if (typeof tempApi.createFolder === 'function') {
                tempApi.createFolder(sectionId, '', item.title || (isZh ? '文件夹' : 'Folder'));
            }
            return;
        }
        if (typeof tempApi.createBookmark === 'function') {
            const safeTitle = item.title || item.url || (isZh ? '书签' : 'Bookmark');
            const safeUrl = item.url || 'https://';
            tempApi.createBookmark(sectionId, '', safeTitle, safeUrl);
        }
    });

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
        if (window.CanvasModule && window.CanvasModule.CanvasState) {
            window.CanvasModule.CanvasState.tempStateTimestamp = Date.now();
        }
    } catch (_) { }

    try {
        if (typeof showCanvasToast === 'function') {
            showCanvasToast(isZh ? `已生成临时栏目（${items.length}）` : `Temp section created (${items.length})`, 'success');
        }
    } catch (_) { }
}

function createTempSectionFromDomainResult(domain) {
    if (getCurrentViewSafe() !== 'canvas') return;
    if (!window.CanvasModule || !window.CanvasModule.createEmptyTempSection || !window.CanvasModule.temp) return;

    const isZh = currentLang === 'zh_CN';
    const domainKey = String(domain || '').trim().toLowerCase();
    if (!domainKey) return;

    const items = getDomainItemsForTemp(domainKey, searchUiState.query || '');
    if (!items.length) return;

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
        section.title = isZh ? `域名: ${domainKey}` : `Domain: ${domainKey}`;
        section.label = isZh ? '搜索' : 'Search';
        section.colorLocked = true;
        section.source = 'search-result';
    }

    items.forEach(item => {
        if (!item) return;
        if (typeof tempApi.createBookmark === 'function') {
            const safeTitle = item.title || item.url || (isZh ? '书签' : 'Bookmark');
            const safeUrl = item.url || 'https://';
            tempApi.createBookmark(sectionId, '', safeTitle, safeUrl);
        }
    });

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
        if (window.CanvasModule && window.CanvasModule.CanvasState) {
            window.CanvasModule.CanvasState.tempStateTimestamp = Date.now();
        }
    } catch (_) { }

    try {
        if (typeof showCanvasToast === 'function') {
            showCanvasToast(isZh ? `已生成临时栏目（${items.length}）` : `Temp section created (${items.length})`, 'success');
        }
    } catch (_) { }
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

function clearSearchTreeItemOutline() {
    try {
        // Clear outline info
        document.querySelectorAll('.tree-item.search-locate-outline').forEach(el => {
            try {
                el.classList.remove('search-locate-outline');
                el.style.removeProperty('--search-highlight-color');
            } catch (_) { }
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

function highlightSearchTreeItemOutline(treeItem, color = '#3b82f6', doClear = true) {
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

function scrollTreeItemIntoView(treeItem) {
    if (!treeItem || typeof treeItem.scrollIntoView !== 'function') return;
    try {
        treeItem.scrollIntoView({ block: 'center', behavior: 'instant' });
        return;
    } catch (_) { }
    try {
        treeItem.scrollIntoView({ block: 'center' });
        return;
    } catch (_) { }
    try {
        treeItem.scrollIntoView();
    } catch (_) { }
}

async function locateBookmarkItemInPermanentTree(nodeId, options = {}) {
    const id = String(nodeId || '');
    if (!id) return false;

    // 先把永久栏目卡片定位到视口（复用 Storage-first 的缩放/平移逻辑）
    try {
        if (typeof currentView !== 'undefined' && currentView === 'canvas') {
            const targetId = options.copyId || 'permanentSection';
            const targetClass = options.copyId ? 'permanent-bookmark-section' : 'permanent-section'; // locateCanvasElement class matching
            // locateCanvasElement(id, classPart, ...)
            // 'permanent-section' matches id="permanentSection" via helper or manual logic?
            // Actually locateCanvasElement's second arg is expected class substring or similar.
            // But let's check if we can rely on it for copies.
            // If copyId is set, locateCanvasElement might fail if it relies on ID.
            // locateToElement logic handles arbitrary element.
            // Let's manually find element if it's a copy.

            if (options.copyId) {
                const copyEl = document.querySelector(`.permanent-bookmark-section[data-permanent-section-copy-id="${CSS.escape(options.copyId)}"]`);
                if (copyEl) {
                    locateToElement(copyEl);
                }
            } else {
                await locateCanvasElement('permanentSection', 'permanent-section', { color: options.color || '#059669' });
            }
        }
    } catch (_) { }

    let permanentSection = null;
    if (options.copyId) {
        permanentSection = document.querySelector(`.permanent-bookmark-section[data-permanent-section-copy-id="${CSS.escape(options.copyId)}"]`);
    } else {
        permanentSection = document.getElementById('permanentSection');
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
                        loadPermanentFolderChildrenLazy(folderId, children, 0, null);
                    }
                }

                // 若 nextId 仍未出现，继续按 "Load more" 追加加载
                let nextEl = treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(String(nextId))}"]`);
                let loadGuard = 0;
                while (!nextEl && loadGuard < 60) {
                    const loadMoreBtn = children.querySelector('button.tree-load-more');
                    if (!loadMoreBtn) break;
                    const startIndex = parseInt(loadMoreBtn.dataset.startIndex, 10) || 0;
                    if (typeof loadPermanentFolderChildrenLazy === 'function') {
                        loadPermanentFolderChildrenLazy(folderId, children, startIndex, loadMoreBtn);
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
    scrollTreeItemIntoView(target);
    highlightSearchTreeItemOutline(target, options.color || '#3b82f6');

    return true;
}

async function locateBookmarkItemInTempTree(sectionId, itemId, options = {}) {
    const sid = String(sectionId || '');
    const id = String(itemId || '');
    if (!sid || !id) return false;

    // 先把临时栏目卡片定位到视口
    try {
        if (typeof currentView !== 'undefined' && currentView === 'canvas') {
            await locateCanvasElement(sid, 'temp-section', { color: options.color || '#3b82f6' });
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
    scrollTreeItemIntoView(target);
    highlightSearchTreeItemOutline(target, options.color || '#3b82f6');

    // [Fix] Retry highlight to combat potential re-renders (anti-flash)
    // Re-query the container to ensure we are highlighting the FRESH DOM element
    const highlightColor = options.color || '#3b82f6';
    const retry = (delay) => {
        setTimeout(() => {
            const freshSection = document.getElementById(sid);
            if (!freshSection) return;
            const freshTree = freshSection.querySelector('.temp-bookmark-tree');
            if (!freshTree) return;
            const t = freshTree.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`);
            if (t) highlightSearchTreeItemOutline(t, highlightColor, false);
        }, delay);
    };
    retry(100);
    retry(300);
    retry(600);
    retry(1200); // Add one more late check

    return true;
}

async function locateCanvasBookmarkItem(item) {
    if (!item || item.type !== 'bookmark-item') return false;
    if (item.source === 'temporary' && item.sectionId) {
        return locateBookmarkItemInTempTree(item.sectionId, item.id, { color: item.color || '#3b82f6' });
    }
    return locateBookmarkItemInPermanentTree(item.id, {
        color: item.color || '#3b82f6',
        copyId: (item.source === 'permanent-copy') ? item.copyId : null
    });
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
    const highlightColor = options.color || '#3b82f6';

    // Helper: 获取节点/栏目矩形 (从 Storage)
    const getRectFromStorage = (id, typeHint) => {
        // 1. Temp Section
        if (!typeHint || typeHint === 'temp-section') {
            const temp = (CanvasState.tempSections || []).find(s => s.id === id);
            if (temp) return { x: Number(temp.x) || 0, y: Number(temp.y) || 0, w: Number(temp.width) || 0, h: Number(temp.height) || 0 };
        }
        // 2. MD Node
        if (!typeHint || typeHint === 'md-node') {
            const md = (CanvasState.mdNodes || []).find(n => n.id === id);
            if (md) return { x: Number(md.x) || 0, y: Number(md.y) || 0, w: Number(md.width) || 0, h: Number(md.height) || 0 };
        }
        // 3. Permanent Main
        if (id === 'permanentSection') {
            try {
                const pos = JSON.parse(localStorage.getItem('permanent-section-position') || '{}');
                // Ensure numeric values (parse strings like "100px")
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
                const copies = JSON.parse(localStorage.getItem('permanent-section-copies') || '[]');
                const copy = copies.find(c => c.id === id);
                if (copy) {
                    const x = parseFloat(copy.left) || parseFloat(copy.x) || 0;
                    const y = parseFloat(copy.top) || parseFloat(copy.y) || 0;
                    const w = parseFloat(copy.width) || parseFloat(copy.w) || 340;
                    const h = parseFloat(copy.height) || parseFloat(copy.h) || 600;
                    return { x, y, w, h };
                }
            } catch (_) { }
        }
        return null;
    };

    switch (type) {
        case 'temp-section':
        case 'md-node':
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
                if (mdEl) {
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
                try {
                    edgeDom.classList.add('canvas-search-highlight-edge');
                    setTimeout(() => {
                        try { edgeDom.classList.remove('canvas-search-highlight-edge'); } catch (_) { }
                    }, 2500);
                } catch (_) { }

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

                        const currentZoom = CanvasState.zoom || 1;
                        const currentPanX = CanvasState.panOffsetX || 0;
                        const currentPanY = CanvasState.panOffsetY || 0;

                        // CanvasX = (RelX - PanX) / Zoom
                        targetX = (relX - currentPanX) / currentZoom;
                        targetY = (relY - currentPanY) / currentZoom;
                        foundLocation = true;
                    }
                }
            }

            // 2. Fallback to Storage/Memory (if DOM missing)
            if (!foundLocation) {
                const edge = (CanvasState.edges || []).find(e => e.id === elementId);
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
                else highlightSelector = `.permanent-bookmark-section[data-copy-id="${elementId}"]`;
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
        if (typeof CanvasState !== 'undefined') {
            const container = document.querySelector('.canvas-main-container');
            if (container) {
                let currentZoom = CanvasState.zoom || 1;

                // [Fix] Low Detail Mode / Card Sleep Safety check
                // If zoom < 0.7, elements might be unloaded/hidden (Virtualization/LOD).
                // Auto-zoom to 0.8 as requested to ensure visibility.
                if (currentZoom < 0.7) {
                    // Auto-zoom to 100% (baseZoom) as requested by user.
                    currentZoom = (CanvasState.baseZoom && CanvasState.baseZoom > 0) ? CanvasState.baseZoom : 1.0;
                    if (window.CanvasModule && typeof window.CanvasModule.setZoom === 'function') {
                        window.CanvasModule.setZoom(currentZoom, null, null, { silent: true });
                    } else {
                        CanvasState.zoom = currentZoom;
                    }
                    // Sync CSS Variable immediately
                    container.style.setProperty('--canvas-scale', currentZoom.toString());
                }

                const containerRect = container.getBoundingClientRect();
                const viewportCX = containerRect.width / 2;
                const viewportCY = containerRect.height / 2;

                // NewPan = ViewportCenter - Target * Zoom (Ensure Finite)
                let newPanX = viewportCX - targetX * currentZoom;
                let newPanY = viewportCY - targetY * currentZoom;

                if (!Number.isFinite(newPanX)) newPanX = 0;
                if (!Number.isFinite(newPanY)) newPanY = 0;

                // Update State
                CanvasState.panOffsetX = newPanX;
                CanvasState.panOffsetY = newPanY;

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
    } catch (e) {
        console.error('[Search] Pan failed:', e);
    }

    // [Fix] Force wake up target temp section after jump
    if (type === 'temp-section' && window.CanvasModule && typeof window.CanvasModule.forceWakeAndRender === 'function') {
        // Use a small timeout to allow the transform to settle/apply first
        setTimeout(() => window.CanvasModule.forceWakeAndRender(elementId), 50);
    }

    // 2. 尝试高亮 DOM 元素 (Best Effort)
    if (highlightSelector) {
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
    if (foundLocation && type === 'edge' && !highlightSelector) {
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

    // 动画结束后移除所有高亮类 (1.6s 动画 + buffer)
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
    }, 1800);
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

    for (const item of db.items) {
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

            const loc = locations[0];
            const opts = { color: loc.color || item.color || '#3b82f6' };
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

    hideSearchResultsPanel();

    // 清空输入框 (仅针对非群组结果，群组结果需保留文字以维持高亮状态)
    if (item.type !== 'group-result') {
        try {
            const inputEl = document.getElementById('searchInput');
            if (inputEl) inputEl.value = '';
        } catch (_) { }
    }

    if (item.type === 'domain-group') {
        createTempSectionFromDomainResult(item.domain || item.title || '');
        return;
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
            if (bounds.count > 0 && typeof CanvasState !== 'undefined') {
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
                    CanvasState.zoom = targetZoom;
                    CanvasState.panOffsetX = newPanX;
                    CanvasState.panOffsetY = newPanY;

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
    } else {
        await locateCanvasElement(item.id, item.type);
    }
}

// ==================== 导出（供 history.js 调用） ====================
// 注意：由于 history.js 不使用 ES6 模块，这些函数作为全局函数暴露
// 主要供 history.js 中的 performSearch 调用

// 将函数暴露到全局作用域，以便 history.js 可以直接调用
if (typeof window !== 'undefined') {
    // ==================== Phase 3: 画布搜索 ====================
    window.searchCanvasAndRender = searchCanvasAndRender;
    window.resetCanvasSearchDb = resetCanvasSearchDb;
    window.locateCanvasElement = locateCanvasElement;
    window.clearCanvasSearchHighlight = clearCanvasSearchHighlight;
    window.activateCanvasSearchResultAtIndex = activateCanvasSearchResultAtIndex;

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
        window.setSearchMode(window.searchUiState.activeMode);
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
        window.setSearchMode(window.searchUiState.activeMode);
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
        setSearchMode(searchUiState.activeMode);
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
