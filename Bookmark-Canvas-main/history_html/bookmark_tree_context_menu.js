// =================================================================================
// TABLE OF CONTENTS (目录索引)
// =================================================================================
// I.     GLOBAL STATE, CORE HELPERS & PERMANENT BCS MUTATIONS (全局状态、基础工具与永久书签 BCS 变更)
// II.    OPEN MODE STATE, WINDOW/GROUP REGISTRIES & LIFECYCLE GUARDS (打开方式状态、窗口/标签组登记簿与生命周期守卫)
// III.   MANUAL WINDOW/GROUP SELECTOR & GLOBAL OPEN EXPORTS (手动窗口/标签组选择与全局打开导出)
// IV.    HYPERLINK OPENING IMPLEMENTATION (超链接打开实现)
// V.     SELECTION MODE & BATCH PANEL FOUNDATIONS (选择模式与批量面板基础设施)
// VI.    CONTEXT MENU INIT, RENDERING, POSITIONING & HYPERLINK MENU (右键菜单初始化、渲染、定位与超链接菜单)
// VII.   TRACE, INFO/TAG SUBMENUS & TEMPORARY TREE OPERATIONS (溯源、信息/标签子菜单与临时树操作)
// VIII.  TAG/NOTE ACTIONS, BOOKMARK ADD FLOW & MENU DISPATCH (标签/备注操作、添加书签流程与菜单派发)
// IX.    BOOKMARK OPENING, CRUD, CLIPBOARD & TAB GROUP HELPERS (书签打开、增删改、剪贴板与标签组辅助)
// X.     MULTI-SELECT, BATCH OPERATIONS, TOOLBAR & PANEL LAYOUT (多选、批量操作、工具栏与面板布局)
// XI.    BLANK AREA, CANVAS OBJECT MENUS & CORE GLOBAL EXPORTS (空白区、画布对象菜单与核心全局导出)
// =================================================================================

// =================================================================================
// I. GLOBAL STATE, CORE HELPERS & PERMANENT BCS MUTATIONS (全局状态、基础工具与永久书签 BCS 变更)
// =================================================================================

// 书签树右键菜单功能
// 提供类似Chrome原生书签管理器的功能

// Unified Export Folder Paths - 统一的导出文件夹路径（根据语言动态选择）
const getTreeExportRootFolder = () => (typeof currentLang !== 'undefined' && currentLang === 'zh_CN')
    ? '书签画布'
    : 'Bookmark Canvas';
const getTreeExportFolder = () => '';
const getTreeExportDownloadFolder = () => [getTreeExportRootFolder(), getTreeExportFolder()]
    .filter(Boolean)
    .join('/');

// 全局变量
let contextMenu = null;
let contextSubmenu = null;
let tabPlacementSubmenu = null;
let lastTabPlacementTriggerItem = null;
let tagSubmenuCtx = null;
let currentContextNode = null;
let bookmarkClipboard = null; // 剪贴板 { action: 'cut'|'copy', nodeId, nodeData }
let infoNoteTextareaExternalCloseGuardUntil = 0;

function setBookmarkClipboardState(nextClipboard, options = {}) {
    bookmarkClipboard = nextClipboard || null;
    clipboardOperation = bookmarkClipboard ? bookmarkClipboard.action : null;
    if (options.persist !== false && bookmarkClipboard && window.CanvasClipboard && typeof window.CanvasClipboard.addStructured === 'function') {
        window.CanvasClipboard.addStructured(bookmarkClipboard).catch(() => {});
    }
    if (bookmarkClipboard) showPasteButton();
    else hidePasteButton();
}

async function finalizeBookmarkClipboardPaste(clipboard) {
    if (!clipboard || clipboard.action !== 'cut') return;
    if (window.CanvasClipboard && typeof window.CanvasClipboard.finishClaimedCut === 'function') {
        await window.CanvasClipboard.finishClaimedCut(clipboard.entryId, true);
        setBookmarkClipboardState(window.CanvasClipboard.getActivePayload(), { persist: false });
    } else {
        setBookmarkClipboardState(null, { persist: false });
    }
    unmarkCutNode();
}

async function restoreBookmarkClipboardCutClaim(clipboard) {
    if (!clipboard || clipboard.action !== 'cut') return;
    if (window.CanvasClipboard && typeof window.CanvasClipboard.finishClaimedCut === 'function') {
        await window.CanvasClipboard.finishClaimedCut(clipboard.entryId, false);
    }
}

async function getLatestBookmarkClipboardForPaste() {
    if (window.CanvasClipboard && typeof window.CanvasClipboard.claimActiveStructuredForPaste === 'function') {
        return window.CanvasClipboard.claimActiveStructuredForPaste();
    }
    return bookmarkClipboard;
}

window.addEventListener('canvas-clipboard-changed', (event) => {
    const activePayload = event && event.detail ? event.detail.activePayload : null;
    bookmarkClipboard = activePayload && activePayload.source !== 'text' ? activePayload : null;
    clipboardOperation = bookmarkClipboard ? bookmarkClipboard.action : null;
    try {
        syncDismissedCutMarkIdentity();
        unmarkCutNode();
        if (bookmarkClipboard && bookmarkClipboard.action === 'cut' && Array.isArray(bookmarkClipboard.nodeIds)) {
            bookmarkClipboard.nodeIds.forEach((id) => markCutNode(id));
        }
        if (bookmarkClipboard) showPasteButton(); else hidePasteButton();
    } catch (_) {}
});

function isInfoNoteTextareaExternalCloseGuardActive() {
    return Date.now() < infoNoteTextareaExternalCloseGuardUntil;
}

function armInfoNoteTextareaExternalCloseGuard() {
    infoNoteTextareaExternalCloseGuardUntil = Date.now() + 1200;
    const releaseGuard = () => {
        infoNoteTextareaExternalCloseGuardUntil = Date.now() + 220;
        window.removeEventListener('mouseup', releaseGuard, true);
        window.removeEventListener('pointerup', releaseGuard, true);
    };
    window.addEventListener('mouseup', releaseGuard, true);
    window.addEventListener('pointerup', releaseGuard, true);
}

function getOverlayContainer() {
    if (typeof window !== 'undefined' && typeof window.getOverlayContainer === 'function' && window.getOverlayContainer !== getOverlayContainer) {
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
}


// 防抖机制：防止重复打开书签
const bookmarkOpenDebounce = {
    lastActionTime: 0,
    lastActionKey: null,
    debounceDelay: 300 // 300ms防抖延迟
};

// 检查是否应该执行操作（防抖）
function shouldAllowBookmarkOpen(actionKey) {
    const now = Date.now();
    const timeSinceLastAction = now - bookmarkOpenDebounce.lastActionTime;

    // 如果是相同的操作且时间间隔小于防抖延迟，则忽略
    if (bookmarkOpenDebounce.lastActionKey === actionKey && timeSinceLastAction < bookmarkOpenDebounce.debounceDelay) {
        ;
        return false;
    }

    // 更新最后操作时间和key
    bookmarkOpenDebounce.lastActionTime = now;
    bookmarkOpenDebounce.lastActionKey = actionKey;
    return true;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function __ctxNormalizeNote(noteInput) {
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (bridge && typeof bridge.normalizeNoteInput === 'function') {
        return bridge.normalizeNoteInput(noteInput);
    }
    return String(noteInput == null ? '' : noteInput).replace(/\r\n?/g, '\n').trim();
}

function __ctxNormalizeNoteColor(colorInput, fallback = 'orange') {
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (bridge && typeof bridge.normalizeNoteColorInput === 'function') {
        return bridge.normalizeNoteColorInput(colorInput, fallback);
    }
    const palette = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
    const color = String(colorInput || '').trim().toLowerCase();
    if (palette.includes(color)) return color;
    const fallbackColor = String(fallback || '').trim().toLowerCase();
    return palette.includes(fallbackColor) ? fallbackColor : 'orange';
}

async function __ctxEnsurePermanentMetadataLoaded() {
    if (window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
        try {
            await window.TagSystem.ensurePermTagsLoaded();
        } catch (e) {
            console.warn('[元数据] 加载永久标签失败:', e);
        }
    }
    if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
        try {
            await window.NoteSystem.ensurePermNotesLoaded();
        } catch (e) {
            console.warn('[元数据] 加载永久笔记失败:', e);
        }
    }
}

async function __ctxFlushPermanentMetadataUpdates(tagUpdates, noteUpdates, reason = '') {
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    const tags = Array.isArray(tagUpdates) ? tagUpdates : [];
    const notes = Array.isArray(noteUpdates) ? noteUpdates : [];

    if (tags.length && bridge && typeof bridge.writePermanentNodeTagsBulk === 'function') {
        try {
            await bridge.writePermanentNodeTagsBulk(tags);
            const tagTargets = tags.map((u) => ({
                kind: 'permanent',
                chromeId: u.chromeId,
                tags: Array.isArray(u.tags) ? u.tags : []
            }));
            if (window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                await window.TagSystem.ensurePermTagsLoaded(true);
            }
            if (typeof window.__refreshAllTagDots === 'function') {
                window.__refreshAllTagDots();
            }
            try {
                if (typeof window.markCanvasSearchBookmarkTagDirty === 'function') {
                    window.markCanvasSearchBookmarkTagDirty(tagTargets);
                }
            } catch (_) { }
        } catch (e) {
            console.warn('[元数据] 批量写入永久书签标签失败:', reason, e);
        }
    }

    if (notes.length && bridge) {
        try {
            let writtenNotes = [];
            if (typeof bridge.writePermanentNodeNotesBulk === 'function') {
                const result = await bridge.writePermanentNodeNotesBulk(notes);
                if (result && result.changed) writtenNotes = notes;
            } else if (typeof bridge.writePermanentNodeNoteMeta === 'function') {
                for (const update of notes) {
                    const result = await bridge.writePermanentNodeNoteMeta(update.chromeId, update.note, update.noteColor || update.color);
                    if (result) writtenNotes.push(update);
                }
            }
            if (!writtenNotes.length) return;
            if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
                await window.NoteSystem.ensurePermNotesLoaded(true);
            }
            const noteTargets = writtenNotes.map((u) => ({
                kind: 'permanent',
                chromeId: u.chromeId,
                note: u.note,
                color: u.noteColor || u.color,
                noteColor: u.noteColor || u.color
            }));
            if (typeof window.__refreshNoteMarkersForTargets === 'function') {
                window.__refreshNoteMarkersForTargets(noteTargets);
            } else if (typeof window.__refreshAllNoteMarkers === 'function') {
                window.__refreshAllNoteMarkers();
            }
            try {
                if (typeof window.updateCanvasSearchBookmarkNotes === 'function') {
                    window.updateCanvasSearchBookmarkNotes(noteTargets);
                }
            } catch (_) { }
            try {
                if (typeof window.markCanvasSearchBookmarkNoteDirty === 'function') {
                    window.markCanvasSearchBookmarkNoteDirty(noteTargets);
                }
            } catch (_) { }
        } catch (e) {
            console.warn('[元数据] 批量写入永久书签笔记失败:', reason, e);
        }
    }
}

async function readPermanentNodeFromBcs(nodeId) {
    const id = String(nodeId || '').trim();
    if (!id) return null;
    try {
        const bridge = window.CanvasProtocolBridge;
        const tree = bridge && typeof bridge.readPermanentTreeSnapshotFromBcs === 'function'
            ? await bridge.readPermanentTreeSnapshotFromBcs({
                assumeCleanWhenMissingState: true
            })
            : null;
        const stack = Array.isArray(tree) ? tree.slice() : [];
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (String(node.id || '').trim() === id) return node;
            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i -= 1) {
                    stack.push(node.children[i]);
                }
            }
        }
    } catch (_) { }
    return null;
}

async function readPermanentNodeForPayload(nodeId) {
    const bcsNode = await readPermanentNodeFromBcs(nodeId);
    if (bcsNode) return bcsNode;
    if (chrome && chrome.bookmarks && typeof chrome.bookmarks.getSubTree === 'function') {
        const nodes = await chrome.bookmarks.getSubTree(nodeId);
        return nodes && nodes[0] ? nodes[0] : null;
    }
    return null;
}

function getPermanentMutationBridge() {
    const bridge = window && window.CanvasProtocolBridge ? window.CanvasProtocolBridge : null;
    return bridge && typeof bridge.restorePermanentMainContentSnapshot === 'function' ? bridge : null;
}

async function rollbackPermanentBcsMutation(prepared, reason = '') {
    const bridge = getPermanentMutationBridge();
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

async function createPermanentBookmarkNode(createPayload, options = {}) {
    if (!chrome || !chrome.bookmarks || typeof chrome.bookmarks.create !== 'function') {
        throw new Error('Chrome bookmarks API unavailable');
    }
    const skipBcs = options.skipBcs === true || (window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.isRenderingBlocked === 'function' && window.__canvasBookmarkBulkMode.isRenderingBlocked());
    const bridge = getPermanentMutationBridge();
    let prepared = null;
    if (!skipBcs && bridge && typeof bridge.preparePermanentCreateNodeInBcs === 'function') {
        prepared = await bridge.preparePermanentCreateNodeInBcs(createPayload);
    }
    try {
        const created = await chrome.bookmarks.create(createPayload);
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
            await rollbackPermanentBcsMutation(prepared, 'create-failed');
        }
        throw error;
    }
}

async function updatePermanentBookmarkNode(nodeId, updates, options = {}) {
    if (!chrome || !chrome.bookmarks || typeof chrome.bookmarks.update !== 'function') {
        throw new Error('Chrome bookmarks API unavailable');
    }
    const skipBcs = options.skipBcs === true || (window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.isRenderingBlocked === 'function' && window.__canvasBookmarkBulkMode.isRenderingBlocked());
    const bridge = getPermanentMutationBridge();
    const prepared = !skipBcs && bridge && typeof bridge.updatePermanentNodeInBcs === 'function'
        ? await bridge.updatePermanentNodeInBcs(nodeId, updates, { assumeClean: false })
        : null;
    try {
        const updated = await chrome.bookmarks.update(nodeId, updates);
        if (options.createdEvents && Array.isArray(options.createdEvents)) {
            options.createdEvents.push({
                type: 'changed',
                id: nodeId,
                changeInfo: updates
            });
        }
        return updated;
    } catch (error) {
        if (!skipBcs) {
            await rollbackPermanentBcsMutation(prepared, 'update-failed');
        }
        throw error;
    }
}

async function removePermanentBookmarkNode(nodeId, isFolder = false, options = {}) {
    if (!chrome || !chrome.bookmarks) {
        throw new Error('Chrome bookmarks API unavailable');
    }
    const skipBcs = options.skipBcs === true || (window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.isRenderingBlocked === 'function' && window.__canvasBookmarkBulkMode.isRenderingBlocked());
    const bridge = getPermanentMutationBridge();
    const prepared = !skipBcs && bridge && typeof bridge.removePermanentNodeFromBcs === 'function'
        ? await bridge.removePermanentNodeFromBcs(nodeId, { assumeClean: false })
        : null;
    try {
        let result;
        if (isFolder) result = await chrome.bookmarks.removeTree(nodeId);
        else result = await chrome.bookmarks.remove(nodeId);
        if (options.createdEvents && Array.isArray(options.createdEvents)) {
            options.createdEvents.push({
                type: 'removed',
                id: nodeId,
                isFolder: isFolder
            });
        }
        return result;
    } catch (error) {
        if (!skipBcs) {
            await rollbackPermanentBcsMutation(prepared, 'remove-failed');
        }
        throw error;
    }
}

async function movePermanentBookmarkNode(nodeId, target, options = {}) {
    if (!chrome || !chrome.bookmarks || typeof chrome.bookmarks.move !== 'function') {
        throw new Error('Chrome bookmarks API unavailable');
    }
    const skipBcs = options.skipBcs === true || (window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.isRenderingBlocked === 'function' && window.__canvasBookmarkBulkMode.isRenderingBlocked());
    const bridge = getPermanentMutationBridge();
    const prepared = !skipBcs && bridge && typeof bridge.movePermanentNodeInBcs === 'function'
        ? await bridge.movePermanentNodeInBcs(nodeId, target, { assumeClean: false })
        : null;
    try {
        const moved = await chrome.bookmarks.move(nodeId, target);
        if (options.createdEvents && Array.isArray(options.createdEvents)) {
            options.createdEvents.push({
                type: 'moved',
                id: nodeId,
                parentId: target.parentId,
                index: target.index
            });
        }
        return moved;
    } catch (error) {
        if (!skipBcs) {
            await rollbackPermanentBcsMutation(prepared, 'move-failed');
        }
        throw error;
    }
}

if (typeof window !== 'undefined') {
    window.__canvasPermanentBookmarkMutations = {
        getPermanentMutationBridge,
        rollbackPermanentBcsMutation,
        createPermanentBookmarkNode,
        updatePermanentBookmarkNode,
        removePermanentBookmarkNode,
        movePermanentBookmarkNode
    };
}


// =================================================================================
// II. OPEN MODE STATE, WINDOW/GROUP REGISTRIES & LIFECYCLE GUARDS (打开方式状态、窗口/标签组登记簿与生命周期守卫)
// =================================================================================

// 全局：当前窗口ID，在初始化时自动获取
let currentWindowId = null;
let specificTabGroups = {}; // { [windowId]: groupId }
let hyperlinkSpecificTabGroups = {}; // { [windowId]: groupId }

async function ensureCurrentWindowId() {
    if (currentWindowId) return;
    if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
        try {
            const win = await chrome.windows.getCurrent({ populate: false });
            if (win && win.id) {
                currentWindowId = win.id;
                // 初始化当前窗口专属标签组
                if (Number.isInteger(specificTabGroups[currentWindowId])) {
                    specificTabGroupId = specificTabGroups[currentWindowId];
                    specificGroupWindowId = currentWindowId;
                }
                if (Number.isInteger(hyperlinkSpecificTabGroups[currentWindowId])) {
                    hyperlinkSpecificTabGroupId = hyperlinkSpecificTabGroups[currentWindowId];
                    hyperlinkSpecificGroupWindowId = currentWindowId;
                }
            }
        } catch (_) {}
    }
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.bookmarkSpecificTabGroups) {
            specificTabGroups = changes.bookmarkSpecificTabGroups.newValue || {};
            if (currentWindowId && Number.isInteger(specificTabGroups[currentWindowId])) {
                specificTabGroupId = specificTabGroups[currentWindowId];
                specificGroupWindowId = currentWindowId;
            } else {
                specificTabGroupId = null;
                specificGroupWindowId = null;
            }
        }
        if (changes.hyperlinkSpecificTabGroups) {
            hyperlinkSpecificTabGroups = changes.hyperlinkSpecificTabGroups.newValue || {};
            if (currentWindowId && Number.isInteger(hyperlinkSpecificTabGroups[currentWindowId])) {
                hyperlinkSpecificTabGroupId = hyperlinkSpecificTabGroups[currentWindowId];
                hyperlinkSpecificGroupWindowId = currentWindowId;
            } else {
                hyperlinkSpecificTabGroupId = null;
                hyperlinkSpecificGroupWindowId = null;
            }
        }
        if (changes.bookmarkScopedCurrentGroups) {
            scopedCurrentGroups = changes.bookmarkScopedCurrentGroups.newValue || {};
        }
        if (changes.bookmarkScopedWindows) {
            scopedWindows = changes.bookmarkScopedWindows.newValue || {};
        }
        if (changes.bookmarkSameWindowSpecificGroupScopes) {
            sameWindowSpecificGroupScopes = changes.bookmarkSameWindowSpecificGroupScopes.newValue || {};
        }

        // 同步默认打开模式与特定窗口/分组配置
        if (changes.bookmarkDefaultOpenMode) {
            defaultOpenMode = changes.bookmarkDefaultOpenMode.newValue || 'new-tab';
            try { window.defaultOpenMode = defaultOpenMode; } catch (_) {}
        }
        if (changes.newTabPlacement) {
            newTabPlacement = normalizeNewTabPlacement(changes.newTabPlacement.newValue);
        }
        if (changes.hyperlinkDefaultOpenMode) {
            hyperlinkDefaultOpenMode = changes.hyperlinkDefaultOpenMode.newValue || 'new-tab';
            try { window.hyperlinkDefaultOpenMode = hyperlinkDefaultOpenMode; } catch (_) {}
        }
        if (changes.bookmarkSpecificWindowId) {
            specificWindowId = changes.bookmarkSpecificWindowId.newValue || null;
        }
        if (changes.hyperlinkSpecificWindowId) {
            hyperlinkSpecificWindowId = changes.hyperlinkSpecificWindowId.newValue || null;
        }
        if (changes.bookmarkSameWindowSpecificGroupWindowId) {
            sameWindowSpecificGroupWindowId = changes.bookmarkSameWindowSpecificGroupWindowId.newValue || null;
        }

        // 同步手动选择记忆
        if (changes.manualSelectedWindowId) {
            manualSelectedWindowId = changes.manualSelectedWindowId.newValue || null;
        }
        if (changes.manualSelectedGroupId) {
            manualSelectedGroupId = changes.manualSelectedGroupId.newValue || null;
        }
        if (changes.customWindowNames) {
            customWindowNames = changes.customWindowNames.newValue || {};
        }
        if (changes.manualFocusWindow) {
            manualFocusWindow = changes.manualFocusWindow.newValue === true;
        }
        if (changes.folderManualSelectedWindowId) {
            folderManualSelectedWindowId = changes.folderManualSelectedWindowId.newValue || null;
        }
        if (changes.folderManualSelectedGroupId) {
            folderManualSelectedGroupId = changes.folderManualSelectedGroupId.newValue || null;
        }
        if (changes.folderManualOpenMode) {
            folderManualOpenMode = changes.folderManualOpenMode.newValue || 'open-all';
        }
        if (changes.folderManualFocusWindow) {
            folderManualFocusWindow = changes.folderManualFocusWindow.newValue !== false;
        }
    });
}

// 全局：默认打开方式与特定窗口/分组ID
let defaultOpenMode = 'new-tab'; // 默认：'new-tab'（新标签页）。可选：'new-tab' | 'new-window' | 'incognito' | 'specific-window' | 'specific-group' | 'scoped-window' | 'scoped-group' | 'same-window-specific-group'
const NEW_TAB_PLACEMENT_STORAGE_KEY = 'newTabPlacement';
const NEW_TAB_PLACEMENTS = new Set(['root', 'before-current', 'after-current']);
let newTabPlacement = 'after-current'; // 单链接新标签页的插入位置；默认当前标签页下方
let specificWindowId = null; // chrome.windows Window ID
let specificTabGroupId = null; // chrome.tabGroups Group ID（在“特定标签组”模式下复用）
let specificGroupWindowId = null; // 保存分组所在窗口，确保新开的标签在同一窗口

// 超链接系统：独立的打开方式与窗口/分组ID（与书签系统完全隔离）
let hyperlinkDefaultOpenMode = 'new-tab'; // 超链接的默认打开方式：'new-tab'（新标签页）
let hyperlinkSpecificWindowId = null; // 超链接专用的窗口ID
let hyperlinkSpecificTabGroupId = null; // 超链接专用的分组ID
let hyperlinkSpecificGroupWindowId = null; // 超链接分组所在窗口
let hyperlinkSameWindowSpecificGroupWindowId = null; // 超链接的同窗特定组窗口ID
let hyperlinkSameWindowSpecificGroupScopes = {}; // 超链接的同窗特定组作用域
let hyperlinkGroupCounter = 0; // 超链接分组计数器（用于命名 Hyperlink 1, 2, 3...）
// 注意：超链接的窗口计数器使用独立的注册表系统，通过 allocateNextHyperlinkWindowNumber() 动态分配

const PLUGIN_GROUP_REGISTRY_KEY = 'pluginTabGroupsRegistry';
const PLUGIN_WINDOW_REGISTRY_KEY = 'pluginWindowsRegistry';
const PLUGIN_SCOPED_GROUP_REGISTRY_KEY = 'pluginScopedTabGroupsRegistry';
const PLUGIN_SCOPED_WINDOW_REGISTRY_KEY = 'pluginScopedWindowsRegistry';
const SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY = 'bookmarkSameWindowSpecificGroupWindowId';
const SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY = 'bookmarkSameWindowSpecificGroupScopes';

// 超链接系统专用注册表键
const HYPERLINK_WINDOW_REGISTRY_KEY = 'hyperlinkWindowsRegistry';
const BOOKMARK_ADD_TEMPLATE_STORAGE_KEY = 'bookmarkContextAddTemplateV1';

const LIVE_GROUP_SEED_CACHE_TTL = 1200; // ms

let scopedCurrentGroups = {}; // { [scopeKey: string]: { groupId: number, windowId: number|null } }
let scopedWindows = {}; // { [scopeKey: string]: number /* windowId */ }
let sameWindowSpecificGroupWindowId = null;
let sameWindowSpecificGroupScopes = {}; // { [scopeKey: string]: { groupId, windowId, number, updatedAt } }
let lifecycleGuardsRegistered = false;
let liveGroupSeedCache = null;
let liveGroupSeedCacheTs = 0;
// 暴露给其他脚本（如 history.js）
window.getDefaultOpenMode = () => defaultOpenMode;
try {
    window.getHyperlinkDefaultOpenMode = () => hyperlinkDefaultOpenMode;
} catch (_) { }

// 读取持久化默认打开方式（书签系统）
(async function initDefaultOpenMode() {
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
            try {
                const win = await chrome.windows.getCurrent({ populate: false });
                if (win && win.id) {
                    currentWindowId = win.id;
                }
            } catch (_) {}
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([
                'bookmarkDefaultOpenMode',
                NEW_TAB_PLACEMENT_STORAGE_KEY,
                'bookmarkSpecificWindowId',
                'bookmarkSpecificGroupId',
                'bookmarkSpecificGroupWindowId',
                'bookmarkScopedCurrentGroups',
                'bookmarkScopedWindows',
                'bookmarkSpecificTabGroups',
                SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY,
                SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY
            ]);
            if (data && typeof data.bookmarkDefaultOpenMode === 'string') {
                defaultOpenMode = data.bookmarkDefaultOpenMode;
            }
            if (data) {
                newTabPlacement = normalizeNewTabPlacement(data[NEW_TAB_PLACEMENT_STORAGE_KEY]);
            }
            if (data && Number.isInteger(data.bookmarkSpecificWindowId)) {
                specificWindowId = data.bookmarkSpecificWindowId;
            }
            if (data && data.bookmarkSpecificTabGroups && typeof data.bookmarkSpecificTabGroups === 'object') {
                specificTabGroups = data.bookmarkSpecificTabGroups || {};
            }
            if (currentWindowId && Number.isInteger(specificTabGroups[currentWindowId])) {
                specificTabGroupId = specificTabGroups[currentWindowId];
                specificGroupWindowId = currentWindowId;
            } else if (data && Number.isInteger(data.bookmarkSpecificGroupId)) {
                specificTabGroupId = data.bookmarkSpecificGroupId;
                specificGroupWindowId = data.bookmarkSpecificGroupWindowId || null;
            }
            if (data && Number.isInteger(data[SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY])) {
                sameWindowSpecificGroupWindowId = data[SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY];
            }
            // 初始化作用域映射（分栏位）
            if (data && data.bookmarkScopedCurrentGroups && typeof data.bookmarkScopedCurrentGroups === 'object') {
                try { scopedCurrentGroups = data.bookmarkScopedCurrentGroups || {}; } catch (_) { }
            }
            if (data && data.bookmarkScopedWindows && typeof data.bookmarkScopedWindows === 'object') {
                try { scopedWindows = data.bookmarkScopedWindows || {}; } catch (_) { }
            }
            if (data && data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] && typeof data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] === 'object') {
                try { sameWindowSpecificGroupScopes = data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] || {}; } catch (_) { }
            }
        } else {
            const mode = localStorage.getItem('bookmarkDefaultOpenMode');
            const winId = parseInt(localStorage.getItem('bookmarkSpecificWindowId') || '', 10);
            if (mode) defaultOpenMode = mode;
            newTabPlacement = normalizeNewTabPlacement(localStorage.getItem(NEW_TAB_PLACEMENT_STORAGE_KEY));
            if (Number.isInteger(winId)) specificWindowId = winId;
            try {
                specificTabGroups = JSON.parse(localStorage.getItem('bookmarkSpecificTabGroups') || '{}');
            } catch (_) {}
            if (currentWindowId && Number.isInteger(specificTabGroups[currentWindowId])) {
                specificTabGroupId = specificTabGroups[currentWindowId];
                specificGroupWindowId = currentWindowId;
            } else {
                const gid = parseInt(localStorage.getItem('bookmarkSpecificGroupId') || '', 10);
                const gwid = parseInt(localStorage.getItem('bookmarkSpecificGroupWindowId') || '', 10);
                if (Number.isInteger(gid)) specificTabGroupId = gid;
                if (Number.isInteger(gwid)) specificGroupWindowId = gwid;
            }
            const combinedWinId = parseInt(localStorage.getItem(SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY) || '', 10);
            if (Number.isInteger(combinedWinId)) sameWindowSpecificGroupWindowId = combinedWinId;
            try { scopedCurrentGroups = JSON.parse(localStorage.getItem('bookmarkScopedCurrentGroups') || '{}'); } catch (_) { }
            try { scopedWindows = JSON.parse(localStorage.getItem('bookmarkScopedWindows') || '{}'); } catch (_) { }
            try {
                const storedScopes = localStorage.getItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY);
                if (storedScopes) {
                    sameWindowSpecificGroupScopes = JSON.parse(storedScopes) || {};
                }
            } catch (_) { }
        }
        try { window.defaultOpenMode = defaultOpenMode; } catch (_) { }
    } catch (_) { }
})();

// 读取持久化默认打开方式（超链接系统）
(async function initHyperlinkSettings() {
    try {
        ;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([
                'hyperlinkDefaultOpenMode',
                'hyperlinkSpecificWindowId',
                'hyperlinkSpecificGroupId',
                'hyperlinkSpecificGroupWindowId',
                'hyperlinkSpecificTabGroups'
            ]);
            ;
            if (data && typeof data.hyperlinkDefaultOpenMode === 'string') {
                hyperlinkDefaultOpenMode = data.hyperlinkDefaultOpenMode;
                ;
            }
            if (data && Number.isInteger(data.hyperlinkSpecificWindowId)) {
                hyperlinkSpecificWindowId = data.hyperlinkSpecificWindowId;
                ;
            }
            if (data && data.hyperlinkSpecificTabGroups && typeof data.hyperlinkSpecificTabGroups === 'object') {
                hyperlinkSpecificTabGroups = data.hyperlinkSpecificTabGroups || {};
            }
            if (currentWindowId && Number.isInteger(hyperlinkSpecificTabGroups[currentWindowId])) {
                hyperlinkSpecificTabGroupId = hyperlinkSpecificTabGroups[currentWindowId];
                hyperlinkSpecificGroupWindowId = currentWindowId;
                ;
            } else if (data && Number.isInteger(data.hyperlinkSpecificGroupId)) {
                hyperlinkSpecificTabGroupId = data.hyperlinkSpecificGroupId;
                hyperlinkSpecificGroupWindowId = data.hyperlinkSpecificGroupWindowId || null;
                ;
            }
        } else {
            ;
            const mode = localStorage.getItem('hyperlinkDefaultOpenMode');
            if (mode) {
                hyperlinkDefaultOpenMode = mode;
                ;
            }
            const winId = parseInt(localStorage.getItem('hyperlinkSpecificWindowId') || '', 10);
            if (Number.isInteger(winId)) {
                hyperlinkSpecificWindowId = winId;
                ;
            }
            try {
                hyperlinkSpecificTabGroups = JSON.parse(localStorage.getItem('hyperlinkSpecificTabGroups') || '{}');
            } catch (_) {}
            if (currentWindowId && Number.isInteger(hyperlinkSpecificTabGroups[currentWindowId])) {
                hyperlinkSpecificTabGroupId = hyperlinkSpecificTabGroups[currentWindowId];
                hyperlinkSpecificGroupWindowId = currentWindowId;
            } else {
                const gid = parseInt(localStorage.getItem('hyperlinkSpecificGroupId') || '', 10);
                const gwid = parseInt(localStorage.getItem('hyperlinkSpecificGroupWindowId') || '', 10);
                if (Number.isInteger(gid)) hyperlinkSpecificTabGroupId = gid;
                if (Number.isInteger(gwid)) hyperlinkSpecificGroupWindowId = gwid;
            }
        }
        ;
        try { window.hyperlinkDefaultOpenMode = hyperlinkDefaultOpenMode; } catch (_) { }
    } catch (err) {
        console.error('[超链接初始化] 失败:', err);
    }
})();

async function setDefaultOpenMode(mode) {
    defaultOpenMode = mode;
    try { window.defaultOpenMode = mode; } catch (_) { }
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkDefaultOpenMode: mode });
        } else {
            localStorage.setItem('bookmarkDefaultOpenMode', mode);
        }
    } catch (_) { }
}

function normalizeNewTabPlacement(value) {
    return NEW_TAB_PLACEMENTS.has(value) ? value : 'after-current';
}

async function setNewTabPlacement(placement) {
    newTabPlacement = normalizeNewTabPlacement(placement);
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [NEW_TAB_PLACEMENT_STORAGE_KEY]: newTabPlacement });
        } else {
            localStorage.setItem(NEW_TAB_PLACEMENT_STORAGE_KEY, newTabPlacement);
        }
    } catch (_) { }
}

async function setSpecificWindowId(winId) {
    specificWindowId = winId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ bookmarkSpecificWindowId: winId });
        } else {
            localStorage.setItem('bookmarkSpecificWindowId', String(winId));
        }
    } catch (_) { }
}

async function resetSpecificWindowId() {
    specificWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['bookmarkSpecificWindowId']);
        } else {
            localStorage.removeItem('bookmarkSpecificWindowId');
        }
    } catch (_) { }
}

async function setSpecificGroupInfo(groupId, windowId) {
    specificTabGroupId = groupId;
    specificGroupWindowId = windowId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('bookmarkSpecificTabGroups');
            specificTabGroups = data.bookmarkSpecificTabGroups || {};
            if (windowId) {
                specificTabGroups[windowId] = groupId;
            }
            await chrome.storage.local.set({
                bookmarkSpecificGroupId: groupId,
                bookmarkSpecificGroupWindowId: windowId,
                bookmarkSpecificTabGroups: specificTabGroups
            });
        } else {
            try {
                specificTabGroups = JSON.parse(localStorage.getItem('bookmarkSpecificTabGroups') || '{}');
            } catch (_) {}
            if (windowId) {
                specificTabGroups[windowId] = groupId;
            }
            localStorage.setItem('bookmarkSpecificGroupId', String(groupId));
            localStorage.setItem('bookmarkSpecificGroupWindowId', String(windowId));
            localStorage.setItem('bookmarkSpecificTabGroups', JSON.stringify(specificTabGroups));
        }
    } catch (_) { }
}

async function resetSpecificGroupInfo(targetWindowId = null) {
    const targetWinIdInt = targetWindowId ? parseInt(targetWindowId, 10) : null;
    const winId = targetWinIdInt || currentWindowId || specificGroupWindowId;
    if (!targetWindowId || winId === currentWindowId || winId === specificGroupWindowId) {
        specificTabGroupId = null;
        specificGroupWindowId = null;
    }
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('bookmarkSpecificTabGroups');
            specificTabGroups = data.bookmarkSpecificTabGroups || {};
            if (winId) {
                delete specificTabGroups[winId];
            }
            const updates = { bookmarkSpecificTabGroups: specificTabGroups };
            await chrome.storage.local.set(updates);
            if (!targetWindowId || winId === currentWindowId || winId === specificGroupWindowId) {
                await chrome.storage.local.remove(['bookmarkSpecificGroupId', 'bookmarkSpecificGroupWindowId']);
            }
        } else {
            try {
                specificTabGroups = JSON.parse(localStorage.getItem('bookmarkSpecificTabGroups') || '{}');
            } catch (_) {}
            if (winId) {
                delete specificTabGroups[winId];
            }
            localStorage.setItem('bookmarkSpecificTabGroups', JSON.stringify(specificTabGroups));
            if (!targetWindowId || winId === currentWindowId || winId === specificGroupWindowId) {
                localStorage.removeItem('bookmarkSpecificGroupId');
                localStorage.removeItem('bookmarkSpecificGroupWindowId');
            }
        }
    } catch (_) { }
}

// ====== 超链接系统：持久化函数（独立于书签系统） ======

async function setHyperlinkSpecificWindowId(winId) {
    hyperlinkSpecificWindowId = winId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ hyperlinkSpecificWindowId: winId });
        } else {
            localStorage.setItem('hyperlinkSpecificWindowId', String(winId));
        }
    } catch (_) { }
}

async function resetHyperlinkSpecificWindowId() {
    hyperlinkSpecificWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove(['hyperlinkSpecificWindowId']);
        } else {
            localStorage.removeItem('hyperlinkSpecificWindowId');
        }
    } catch (_) { }
}

async function setHyperlinkSpecificGroupInfo(groupId, windowId) {
    hyperlinkSpecificTabGroupId = groupId;
    hyperlinkSpecificGroupWindowId = windowId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('hyperlinkSpecificTabGroups');
            hyperlinkSpecificTabGroups = data.hyperlinkSpecificTabGroups || {};
            if (windowId) {
                hyperlinkSpecificTabGroups[windowId] = groupId;
            }
            await chrome.storage.local.set({
                hyperlinkSpecificGroupId: groupId,
                hyperlinkSpecificGroupWindowId: windowId,
                hyperlinkSpecificTabGroups: hyperlinkSpecificTabGroups
            });
        } else {
            try {
                hyperlinkSpecificTabGroups = JSON.parse(localStorage.getItem('hyperlinkSpecificTabGroups') || '{}');
            } catch (_) {}
            if (windowId) {
                hyperlinkSpecificTabGroups[windowId] = groupId;
            }
            localStorage.setItem('hyperlinkSpecificGroupId', String(groupId));
            localStorage.setItem('hyperlinkSpecificGroupWindowId', String(windowId));
            localStorage.setItem('hyperlinkSpecificTabGroups', JSON.stringify(hyperlinkSpecificTabGroups));
        }
    } catch (_) { }
}

async function resetHyperlinkSpecificGroupInfo(targetWindowId = null) {
    const targetWinIdInt = targetWindowId ? parseInt(targetWindowId, 10) : null;
    const winId = targetWinIdInt || currentWindowId || hyperlinkSpecificGroupWindowId;
    if (!targetWindowId || winId === currentWindowId || winId === hyperlinkSpecificGroupWindowId) {
        hyperlinkSpecificTabGroupId = null;
        hyperlinkSpecificGroupWindowId = null;
    }
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('hyperlinkSpecificTabGroups');
            hyperlinkSpecificTabGroups = data.hyperlinkSpecificTabGroups || {};
            if (winId) {
                delete hyperlinkSpecificTabGroups[winId];
            }
            const updates = { hyperlinkSpecificTabGroups: hyperlinkSpecificTabGroups };
            await chrome.storage.local.set(updates);
            if (!targetWindowId || winId === currentWindowId || winId === hyperlinkSpecificGroupWindowId) {
                await chrome.storage.local.remove(['hyperlinkSpecificGroupId', 'hyperlinkSpecificGroupWindowId']);
            }
        } else {
            try {
                hyperlinkSpecificTabGroups = JSON.parse(localStorage.getItem('hyperlinkSpecificTabGroups') || '{}');
            } catch (_) {}
            if (winId) {
                delete hyperlinkSpecificTabGroups[winId];
            }
            localStorage.setItem('hyperlinkSpecificTabGroups', JSON.stringify(hyperlinkSpecificTabGroups));
            if (!targetWindowId || winId === currentWindowId || winId === hyperlinkSpecificGroupWindowId) {
                localStorage.removeItem('hyperlinkSpecificGroupId');
                localStorage.removeItem('hyperlinkSpecificGroupWindowId');
            }
        }
    } catch (_) { }
}


const CTXMENU_PERMANENT_SECTION_COPIES_STORAGE_KEY = 'bcs:perm:copies';

function __ctxMenuNormalizePositiveInt(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function __ctxMenuReadPermanentSectionCopies() {
    try {
        const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.collectPermanentViewShellSnapshot === 'function'
            ? window.CanvasProtocolBridge
            : null;
        if (protocolBridge) {
            const snapshot = protocolBridge.collectPermanentViewShellSnapshot();
            if (snapshot && Array.isArray(snapshot.views)) {
                return snapshot.views
                    .filter((view) => view && view.copyId)
                    .map((view) => ({
                        id: String(view.copyId || '').trim(),
                        displayIndex: __ctxMenuNormalizePositiveInt(view.displayIndex)
                    }))
                    .filter((copy) => copy.id);
            }
        }
    } catch (_) { }
    try {
        const raw = localStorage.getItem(CTXMENU_PERMANENT_SECTION_COPIES_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

function __ctxMenuHasAnyPermanentSectionCopies() {
    try {
        const copies = __ctxMenuReadPermanentSectionCopies();
        return Array.isArray(copies) && copies.some(c => c && c.id);
    } catch (_) {
        return false;
    }
}

function __ctxMenuResolvePermanentCopyDisplayIndex(copyId) {
    if (!copyId) return null;
    try {
        const copies = __ctxMenuReadPermanentSectionCopies();
        if (!Array.isArray(copies) || !copies.length) return null;
        const found = copies.find(c => c && c.id === copyId);
        return __ctxMenuNormalizePositiveInt(found && found.displayIndex);
    } catch (_) {
        return null;
    }
}

// Helper to convert 1 -> A, 2 -> B...
function toAlphaLabel(n) {
    let num = parseInt(n, 10);
    if (!Number.isFinite(num) || num <= 0) return '';
    let s = '';
    while (num > 0) {
        const rem = (num - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        num = Math.floor((num - 1) / 26);
    }
    return s;
}

function getScopeFromContext(context) {
    const type = context && context.treeType ? String(context.treeType) : 'permanent';
    let cardTitle = '';
    let cardColor = '';

    const resolveCardColor = (element) => {
        if (!element) return '';
        try {
            const computedStyle = window.getComputedStyle(element);
            const val = computedStyle.getPropertyValue('--section-color') || '';
            return val.trim();
        } catch (_) {
            return '';
        }
    };

    // Try to resolve color from DOM
    try {
        let sectionEl = null;
        if (context && context.node) {
            sectionEl = context.node.closest('.temp-canvas-node, .permanent-bookmark-section');
        }
        if (!sectionEl && context && context.sectionId) {
            sectionEl = document.querySelector(`.temp-canvas-node[data-section-id="${context.sectionId}"]`);
        }
        if (!sectionEl) {
            const raw = (context && (context.permanentCopyId || context.permanentSectionCopyId || context.permanent_section_copy_id)) || '';
            const copyId = typeof raw === 'string' ? raw.trim() : '';
            if (copyId) {
                sectionEl = document.getElementById(`permanent-section-copy-${copyId}`) ||
                            document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id="${copyId}"]`);
            } else if (type === 'permanent') {
                sectionEl = document.getElementById('permanentSection');
            }
        }
        if (sectionEl) {
            cardColor = resolveCardColor(sectionEl);
        }
    } catch (_) {}

    // Temporary sections use their explicit display label. IDs handle duplicates.
    if (type === 'temporary' && context && context.sectionId) {
        try {
            const sec = (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.getSection === 'function')
                ? window.CanvasModule.temp.getSection(context.sectionId)
                : (typeof getTempSection === 'function' ? getTempSection(context.sectionId) : null);
            const explicit = (sec && typeof sec.label === 'string') ? sec.label.trim() : '';
            const label = explicit || 'unknown';

            const explicitTitle = (sec && typeof sec.title === 'string') ? sec.title.trim() : '';
            cardTitle = explicitTitle || ((window.currentLang || 'zh_CN') === 'zh_CN' ? '临时栏目' : 'Temp Section');

            if (!cardColor && sec && sec.color) {
                cardColor = sec.color;
            }

            return { key: `temp:${label || context.sectionId}`, prefix: label, kind: 'temporary', title: cardTitle, color: cardColor };
        } catch (_) {
            cardTitle = (window.currentLang || 'zh_CN') === 'zh_CN' ? '临时栏目' : 'Temp Section';
            return { key: `temp:${context.sectionId}`, prefix: '', kind: 'temporary', title: cardTitle, color: cardColor };
        }
    }

    // Permanent sections: support permanent copies (#A/#B/...) and original (#A when any copy exists)
    let copyId = null;
    try {
        const raw = (context && (context.permanentCopyId || context.permanentSectionCopyId || context.permanent_section_copy_id)) || '';
        const s = typeof raw === 'string' ? raw.trim() : '';
        if (s) copyId = s;
    } catch (_) { copyId = null; }

    // Try to find the title from the DOM node if available
    try {
        const node = context && context.node;
        const sectionEl = node && node.closest ? node.closest('.permanent-bookmark-section') : null;
        const titleEl = sectionEl ? sectionEl.querySelector('.permanent-section-title h3') : null;
        const text = titleEl ? String(titleEl.textContent || '').trim() : '';
        if (text) cardTitle = text;
    } catch (_) {}

    // Fallback to reading the main permanent section title from the page
    if (!cardTitle) {
        try {
            const mainTitleEl = document.getElementById('permanentSectionTitle');
            const text = mainTitleEl ? String(mainTitleEl.textContent || '').trim() : '';
            if (text) cardTitle = text;
        } catch (_) {}
    }

    // Ultimate fallback using language
    if (!cardTitle) {
        const lang = (typeof currentLang !== 'undefined' && currentLang) ? currentLang : 'zh_CN';
        const isEn = lang === 'en' || lang === 'en_US' || lang === 'en-GB' || String(lang).toLowerCase().startsWith('en');
        cardTitle = isEn ? 'Bookmark Tree (Permanent)' : '书签树 (永久栏目)';
    }

    const idx = __ctxMenuNormalizePositiveInt(context && (context.permanentDisplayIndex || context.permanentSectionDisplayIndex));
    if (copyId) {
        const resolved = idx || __ctxMenuResolvePermanentCopyDisplayIndex(copyId);
        // Copy 1 (idx=1) -> #B (toAlphaLabel(1+1))
        const badge = resolved ? `#${toAlphaLabel(resolved + 1)}` : '';
        return { key: `permanent-copy:${copyId}`, prefix: badge, kind: 'permanent', copyId, displayIndex: resolved, title: cardTitle, color: cardColor };
    }

    // Original -> #A (toAlphaLabel(1))
    const badge = `#${toAlphaLabel(1)}`;
    return { key: 'permanent', prefix: badge, kind: 'permanent', copyId: null, displayIndex: 0, title: cardTitle, color: cardColor };
}

function __formatScopedTempTitle(prefix, number) {
    const p = String(prefix || '').trim();
    const n = String(number ?? '').trim();
    if (!p) return n;
    if (!n) return p;
    // Use a space to separate "section label" and "target number" (avoid confusing it with the label hierarchy).
    // Example: "A-1 1", "A-1-1 2"
    return `${p} ${n}`;
}

async function readScopedGroupRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_SCOPED_GROUP_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_SCOPED_GROUP_REGISTRY_KEY]) ? data[PLUGIN_SCOPED_GROUP_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_SCOPED_GROUP_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeScopedGroupRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_SCOPED_GROUP_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_SCOPED_GROUP_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function readScopedWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_SCOPED_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_SCOPED_WINDOW_REGISTRY_KEY]) ? data[PLUGIN_SCOPED_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_SCOPED_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeScopedWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_SCOPED_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_SCOPED_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

function getSameWindowSpecificGroupEntry(scopeKey) {
    if (!scopeKey || !sameWindowSpecificGroupScopes) return null;
    const entry = sameWindowSpecificGroupScopes[scopeKey];
    if (!entry || typeof entry !== 'object') return null;
    if (entry.windowId !== sameWindowSpecificGroupWindowId) return null;
    return entry;
}

async function persistSameWindowSpecificGroupScopes() {
    const payload = (sameWindowSpecificGroupScopes && typeof sameWindowSpecificGroupScopes === 'object')
        ? sameWindowSpecificGroupScopes
        : {};
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY]: payload });
        } else {
            localStorage.setItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY, JSON.stringify(payload));
        }
    } catch (_) { }
}

async function setSameWindowSpecificGroupScope(scopeKey, groupId, windowId, number) {
    if (!scopeKey) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY);
            sameWindowSpecificGroupScopes = data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] || {};
        } else {
            try {
                sameWindowSpecificGroupScopes = JSON.parse(localStorage.getItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY) || '{}');
            } catch (_) {}
        }
    } catch (_) {}
    sameWindowSpecificGroupScopes[scopeKey] = {
        groupId,
        windowId: windowId || null,
        number: Number.isFinite(number) ? number : null,
        updatedAt: Date.now()
    };
    await persistSameWindowSpecificGroupScopes();
}

async function clearSameWindowSpecificGroupScope(scopeKey) {
    if (!scopeKey) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY);
            sameWindowSpecificGroupScopes = data[SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY] || {};
        } else {
            try {
                sameWindowSpecificGroupScopes = JSON.parse(localStorage.getItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY) || '{}');
            } catch (_) {}
        }
    } catch (_) {}
    if (sameWindowSpecificGroupScopes && sameWindowSpecificGroupScopes[scopeKey]) {
        delete sameWindowSpecificGroupScopes[scopeKey];
        await persistSameWindowSpecificGroupScopes();
    }
}

async function resetSameWindowSpecificGroupScopes() {
    sameWindowSpecificGroupScopes = {};
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove([SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY]);
        } else {
            localStorage.removeItem(SAME_WINDOW_SPECIFIC_GROUP_SCOPES_KEY);
        }
    } catch (_) { }
}

async function setSameWindowSpecificGroupWindowId(winId) {
    sameWindowSpecificGroupWindowId = winId;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY]: winId });
        } else {
            localStorage.setItem(SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY, String(winId));
        }
    } catch (_) { }
}

async function resetSameWindowSpecificGroupState() {
    sameWindowSpecificGroupWindowId = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove([SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY]);
        } else {
            localStorage.removeItem(SAME_WINDOW_SPECIFIC_GROUP_WINDOW_KEY);
        }
    } catch (_) { }
    await resetSameWindowSpecificGroupScopes();
}

function invalidateLiveGroupSeeds() {
    liveGroupSeedCache = null;
    liveGroupSeedCacheTs = 0;
}

function parseGroupFingerprint(title) {
    if (!title || typeof title !== 'string') return null;
    const trimmed = title.trim();
    if (!trimmed) return null;
    const sameWindowPermanent = /^A-Z\s+(\d+)$/.exec(trimmed);
    if (sameWindowPermanent) {
        return { kind: 'scoped', scopeKey: 'permanent', number: parseInt(sameWindowPermanent[1], 10) };
    }
    const scopedTemp = /^([A-Z]+)(\d+)$/.exec(trimmed);
    if (scopedTemp && scopedTemp[1] !== 'A-Z') {
        const prefix = scopedTemp[1];
        return {
            kind: 'scoped',
            scopeKey: `temp:${prefix}`,
            number: parseInt(scopedTemp[2], 10)
        };
    }
    const globalMatch = /^(\d+)$/.exec(trimmed);
    if (globalMatch) {
        return { kind: 'global', number: parseInt(globalMatch[1], 10) };
    }
    return null;
}

function queryAllTabGroups(filter = {}) {
    if (typeof chrome === 'undefined' || !chrome.tabGroups || typeof chrome.tabGroups.query !== 'function') {
        return Promise.resolve([]);
    }
    return new Promise((resolve) => {
        try {
            chrome.tabGroups.query(filter, (groups) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    console.warn('[tabGroups.query] failed:', chrome.runtime.lastError);
                    resolve([]);
                    return;
                }
                resolve(Array.isArray(groups) ? groups : []);
            });
        } catch (err) {
            console.warn('[tabGroups.query] exception:', err);
            resolve([]);
        }
    });
}

async function getLiveGroupSeeds(force = false) {
    const now = Date.now();
    if (!force && liveGroupSeedCache && (now - liveGroupSeedCacheTs) < LIVE_GROUP_SEED_CACHE_TTL) {
        return liveGroupSeedCache;
    }
    const seeds = { globalMax: 0, scopedMax: {} };
    if (typeof chrome === 'undefined' || !chrome.tabGroups || typeof chrome.tabGroups.query !== 'function') {
        liveGroupSeedCache = seeds;
        liveGroupSeedCacheTs = now;
        return seeds;
    }
    try {
        const groups = await queryAllTabGroups({});
        (groups || []).forEach(group => {
            if (!group || !group.title) return;
            const info = parseGroupFingerprint(group.title);
            if (!info || !Number.isFinite(info.number) || info.number <= 0) return;
            if (info.kind === 'global') {
                if (info.number > seeds.globalMax) seeds.globalMax = info.number;
            } else if (info.kind === 'scoped' && info.scopeKey) {
                const prev = seeds.scopedMax[info.scopeKey] || 0;
                if (info.number > prev) seeds.scopedMax[info.scopeKey] = info.number;
            }
        });
    } catch (err) {
        console.warn('[LiveGroupSeeds] query failed:', err);
    }
    liveGroupSeedCache = seeds;
    liveGroupSeedCacheTs = Date.now();
    return seeds;
}

async function isWindowAlive(windowId) {
    if (!Number.isInteger(windowId)) return false;
    if (typeof chrome === 'undefined' || !chrome.windows || !chrome.windows.get) return false;
    try {
        const win = await chrome.windows.get(windowId, { populate: false });
        return !!(win && win.id === windowId);
    } catch (_) {
        return false;
    }
}

async function isTabGroupAlive(groupId) {
    if (!Number.isInteger(groupId)) return false;
    if (typeof chrome === 'undefined' || !chrome.tabGroups || !chrome.tabGroups.get) return false;
    try {
        const group = await chrome.tabGroups.get(groupId);
        return !!(group && group.id === groupId);
    } catch (_) {
        return false;
    }
}

async function refreshTrackedOpenTargets() {
    if (typeof chrome === 'undefined') return;
    try {
        if (specificWindowId && !(await isWindowAlive(specificWindowId))) {
            await resetSpecificWindowId();
        }
        if (specificTabGroupId) {
            const aliveGroup = await isTabGroupAlive(specificTabGroupId);
            const aliveWindow = specificGroupWindowId ? await isWindowAlive(specificGroupWindowId) : true;
            if (!aliveGroup || !aliveWindow) {
                await resetSpecificGroupInfo();
            }
        }
        if (sameWindowSpecificGroupWindowId && !(await isWindowAlive(sameWindowSpecificGroupWindowId))) {
            await resetSameWindowSpecificGroupState();
        }

        const scopedGroupEntries = Object.entries(scopedCurrentGroups || {});
        for (const [scopeKey, entry] of scopedGroupEntries) {
            if (!entry || !Number.isInteger(entry.groupId)) {
                await removeScopedCurrentGroup(scopeKey);
                continue;
            }
            const groupAlive = await isTabGroupAlive(entry.groupId);
            const windowAlive = entry.windowId ? await isWindowAlive(entry.windowId) : true;
            if (!groupAlive || !windowAlive) {
                await removeScopedCurrentGroup(scopeKey);
            }
        }

        const scopedWindowEntries = Object.entries(scopedWindows || {});
        for (const [scopeKey, winId] of scopedWindowEntries) {
            if (!Number.isInteger(winId)) {
                await removeScopedWindowEntry(scopeKey);
                continue;
            }
            if (!(await isWindowAlive(winId))) {
                await removeScopedWindowEntry(scopeKey);
            }
        }

        const combinedEntries = Object.entries(sameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of combinedEntries) {
            if (!entry) {
                await clearSameWindowSpecificGroupScope(scopeKey);
                continue;
            }
            const windowAlive = entry.windowId ? await isWindowAlive(entry.windowId) : false;
            const groupAlive = entry.groupId ? await isTabGroupAlive(entry.groupId) : false;
            if (!windowAlive || !groupAlive) {
                await clearSameWindowSpecificGroupScope(scopeKey);
            }
        }
    } catch (refreshError) {
        console.warn('[OpenTargets] refresh failed:', refreshError);
    }
}

async function handleTrackedWindowRemoved(windowId) {
    if (!Number.isInteger(windowId)) return;
    try {
        // 书签系统
        if (specificWindowId === windowId) {
            await resetSpecificWindowId();
        }
        if (sameWindowSpecificGroupWindowId === windowId) {
            await resetSameWindowSpecificGroupState();
        }
        if (specificGroupWindowId === windowId || specificTabGroups[windowId]) {
            await resetSpecificGroupInfo(windowId);
        }

        // 超链接系统：窗口关闭时重置
        if (hyperlinkSpecificWindowId === windowId) {
            await resetHyperlinkSpecificWindowId();
            // 注意：不重置计数器，计数器由注册表系统管理
            ;
        }
        if (hyperlinkSpecificGroupWindowId === windowId || hyperlinkSpecificTabGroups[windowId]) {
            await resetHyperlinkSpecificGroupInfo(windowId);
            hyperlinkGroupCounter = 0; // 重置分组计数器
            ;
        }
        if (hyperlinkSameWindowSpecificGroupWindowId === windowId) {
            hyperlinkSameWindowSpecificGroupWindowId = null;
            hyperlinkSameWindowSpecificGroupScopes = {};
            ;
        }

        const scopedWindowEntries = Object.entries(scopedWindows || {});
        for (const [scopeKey, winId] of scopedWindowEntries) {
            if (winId === windowId) {
                await removeScopedWindowEntry(scopeKey);
            }
        }
        const scopedGroupEntries = Object.entries(scopedCurrentGroups || {});
        for (const [scopeKey, entry] of scopedGroupEntries) {
            if (entry && entry.windowId === windowId) {
                await removeScopedCurrentGroup(scopeKey);
            }
        }
        const combinedEntries = Object.entries(sameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of combinedEntries) {
            if (entry && entry.windowId === windowId) {
                await clearSameWindowSpecificGroupScope(scopeKey);
            }
        }
        invalidateLiveGroupSeeds();
    } catch (err) {
        console.warn('[LifecycleGuards] windowRemoved handler failed:', err);
    }
}

async function handleTrackedGroupRemoved(groupInfo) {
    let groupId = null;
    if (groupInfo && typeof groupInfo === 'object') {
        if (Number.isInteger(groupInfo.groupId)) groupId = groupInfo.groupId;
        if (Number.isInteger(groupInfo.id)) groupId = groupInfo.id;
    } else if (Number.isInteger(groupInfo)) {
        groupId = groupInfo;
    }
    if (!Number.isInteger(groupId)) return;
    try {
        // 书签系统
        let isSpecificGroupDeleted = false;
        for (const [winId, gId] of Object.entries(specificTabGroups)) {
            if (gId === groupId) {
                await resetSpecificGroupInfo(winId);
                isSpecificGroupDeleted = true;
            }
        }
        if (specificTabGroupId === groupId && !isSpecificGroupDeleted) {
            await resetSpecificGroupInfo();
        }

        // 超链接系统：分组关闭时重置
        let isHyperlinkSpecificGroupDeleted = false;
        for (const [winId, gId] of Object.entries(hyperlinkSpecificTabGroups)) {
            if (gId === groupId) {
                await resetHyperlinkSpecificGroupInfo(winId);
                isHyperlinkSpecificGroupDeleted = true;
            }
        }
        if (hyperlinkSpecificTabGroupId === groupId && !isHyperlinkSpecificGroupDeleted) {
            await resetHyperlinkSpecificGroupInfo();
            hyperlinkGroupCounter = 0; // 重置分组计数器
            ;
        }

        // 检查超链接的同窗特定组作用域
        const hyperlinkScopeEntries = Object.entries(hyperlinkSameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of hyperlinkScopeEntries) {
            if (entry && entry.groupId === groupId) {
                delete hyperlinkSameWindowSpecificGroupScopes[scopeKey];
                ;
            }
        }

        const scopedGroupEntries = Object.entries(scopedCurrentGroups || {});
        for (const [scopeKey, entry] of scopedGroupEntries) {
            if (entry && entry.groupId === groupId) {
                await removeScopedCurrentGroup(scopeKey);
            }
        }
        const combinedEntries = Object.entries(sameWindowSpecificGroupScopes || {});
        for (const [scopeKey, entry] of combinedEntries) {
            if (entry && entry.groupId === groupId) {
                await clearSameWindowSpecificGroupScope(scopeKey);
            }
        }
        invalidateLiveGroupSeeds();
    } catch (err) {
        console.warn('[LifecycleGuards] groupRemoved handler failed:', err);
    }
}

function registerLifecycleGuards() {
    if (lifecycleGuardsRegistered) return;
    if (typeof chrome === 'undefined') return;
    try {
        if (chrome.windows && chrome.windows.onRemoved && typeof chrome.windows.onRemoved.addListener === 'function') {
            chrome.windows.onRemoved.addListener((windowId) => {
                handleTrackedWindowRemoved(windowId);
            });
        }
        if (chrome.tabGroups && chrome.tabGroups.onRemoved && typeof chrome.tabGroups.onRemoved.addListener === 'function') {
            chrome.tabGroups.onRemoved.addListener((group) => {
                handleTrackedGroupRemoved(group);
            });
        }
        lifecycleGuardsRegistered = true;
    } catch (err) {
        console.warn('[LifecycleGuards] 注册失败:', err);
    }
}

try { registerLifecycleGuards(); } catch (_) { }

async function pruneDeadScopedWindows() {
    let reg = await readScopedWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeScopedWindowRegistry(alive);
    return alive;
}

async function allocateNextScopedWindowNumber(scopeKey) {
    const alive = await pruneDeadScopedWindows();
    let maxN = 0;
    alive.forEach(e => { if (e && e.scope === scopeKey && Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerScopedWindow(scopeKey, windowId, number) {
    const reg = await pruneDeadScopedWindows();
    reg.push({ scope: scopeKey, windowId, number, createdAt: Date.now() });
    await writeScopedWindowRegistry(reg);
}

async function pruneDeadScopedGroups() {
    let reg = await readScopedGroupRegistry();
    const alive = [];
    for (const entry of reg) {
        const { groupId } = entry || {};
        if (!Number.isInteger(groupId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.tabGroups && chrome.tabGroups.get) {
                const g = await chrome.tabGroups.get(groupId);
                ok = !!(g && g.id === groupId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeScopedGroupRegistry(alive);
    return alive;
}

async function allocateNextScopedNumber(scopeKey) {
    const seeds = await getLiveGroupSeeds();
    const alive = await pruneDeadScopedGroups();
    let maxN = (seeds && seeds.scopedMax && scopeKey) ? (seeds.scopedMax[scopeKey] || 0) : 0;
    alive.forEach(e => {
        if (e && e.scope === scopeKey && Number.isInteger(e.number) && e.number > maxN) {
            maxN = e.number;
        }
    });
    return maxN + 1;
}

async function registerScopedGroup(scopeKey, groupId, windowId, number) {
    const reg = await pruneDeadScopedGroups();
    reg.push({ scope: scopeKey, groupId, windowId, number, createdAt: Date.now() });
    await writeScopedGroupRegistry(reg);
    invalidateLiveGroupSeeds();
}

async function setScopedCurrentGroup(scopeKey, groupId, windowId) {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('bookmarkScopedCurrentGroups');
            scopedCurrentGroups = data.bookmarkScopedCurrentGroups || {};
            scopedCurrentGroups[scopeKey] = { groupId, windowId: windowId || null };
            await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
        } else {
            try {
                scopedCurrentGroups = JSON.parse(localStorage.getItem('bookmarkScopedCurrentGroups') || '{}');
            } catch (_) {}
            scopedCurrentGroups[scopeKey] = { groupId, windowId: windowId || null };
            localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
        }
    } catch (_) {
        scopedCurrentGroups[scopeKey] = { groupId, windowId: windowId || null };
    }
}

async function removeScopedCurrentGroup(key) {
    if (!key) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('bookmarkScopedCurrentGroups');
            scopedCurrentGroups = data.bookmarkScopedCurrentGroups || {};
            if (scopedCurrentGroups[key]) {
                delete scopedCurrentGroups[key];
                await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
            }
        } else {
            try {
                scopedCurrentGroups = JSON.parse(localStorage.getItem('bookmarkScopedCurrentGroups') || '{}');
            } catch (_) {}
            if (scopedCurrentGroups[key]) {
                delete scopedCurrentGroups[key];
                localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
            }
        }
    } catch (_) {
        if (scopedCurrentGroups && scopedCurrentGroups[key]) {
            delete scopedCurrentGroups[key];
        }
    }
}

async function setScopedWindow(scopeKey, windowId) {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('bookmarkScopedWindows');
            scopedWindows = data.bookmarkScopedWindows || {};
            scopedWindows[scopeKey] = windowId;
            await chrome.storage.local.set({ bookmarkScopedWindows: scopedWindows });
        } else {
            try {
                scopedWindows = JSON.parse(localStorage.getItem('bookmarkScopedWindows') || '{}');
            } catch (_) {}
            scopedWindows[scopeKey] = windowId;
            localStorage.setItem('bookmarkScopedWindows', JSON.stringify(scopedWindows));
        }
    } catch (_) {
        scopedWindows[scopeKey] = windowId;
    }
}

async function removeScopedWindowEntry(scopeKey) {
    if (!scopeKey) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('bookmarkScopedWindows');
            scopedWindows = data.bookmarkScopedWindows || {};
            if (typeof scopedWindows[scopeKey] !== 'undefined') {
                delete scopedWindows[scopeKey];
                await chrome.storage.local.set({ bookmarkScopedWindows: scopedWindows });
            }
        } else {
            try {
                scopedWindows = JSON.parse(localStorage.getItem('bookmarkScopedWindows') || '{}');
            } catch (_) {}
            if (typeof scopedWindows[scopeKey] !== 'undefined') {
                delete scopedWindows[scopeKey];
                localStorage.setItem('bookmarkScopedWindows', JSON.stringify(scopedWindows));
            }
        }
    } catch (_) {
        if (scopedWindows && typeof scopedWindows[scopeKey] !== 'undefined') {
            delete scopedWindows[scopeKey];
        }
    }
}

async function readPluginGroupRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_GROUP_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_GROUP_REGISTRY_KEY]) ? data[PLUGIN_GROUP_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_GROUP_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writePluginGroupRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_GROUP_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_GROUP_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

// ==== 插件生成的（全局"同一窗口"）窗口登记簿 ====
async function readPluginWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([PLUGIN_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[PLUGIN_WINDOW_REGISTRY_KEY]) ? data[PLUGIN_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(PLUGIN_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writePluginWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [PLUGIN_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(PLUGIN_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function pruneDeadPluginWindows() {
    let reg = await readPluginWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writePluginWindowRegistry(alive);
    return alive;
}

async function allocateNextWindowNumber() {
    const alive = await pruneDeadPluginWindows();
    let maxN = 0;
    alive.forEach(e => { if (Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerPluginWindow(windowId, number) {
    const reg = await pruneDeadPluginWindows();
    reg.push({ windowId, number, createdAt: Date.now() });
    await writePluginWindowRegistry(reg);
}

// ==== 同窗专属组专用窗口登记簿 ====
const SWSG_WINDOW_REGISTRY_KEY = 'swsgWindowsRegistry';

async function readSwsgWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([SWSG_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[SWSG_WINDOW_REGISTRY_KEY]) ? data[SWSG_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(SWSG_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeSwsgWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [SWSG_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(SWSG_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function pruneDeadSwsgWindows() {
    let reg = await readSwsgWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeSwsgWindowRegistry(alive);
    return alive;
}

async function allocateNextSwsgWindowNumber() {
    const alive = await pruneDeadSwsgWindows();
    let maxN = 0;
    alive.forEach(e => { if (Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerSwsgWindow(windowId, number) {
    const reg = await pruneDeadSwsgWindows();
    reg.push({ windowId, number, createdAt: Date.now() });
    await writeSwsgWindowRegistry(reg);
}

// ==== 超链接系统专用窗口登记簿 ====
async function readHyperlinkWindowRegistry() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([HYPERLINK_WINDOW_REGISTRY_KEY]);
            return Array.isArray(data[HYPERLINK_WINDOW_REGISTRY_KEY]) ? data[HYPERLINK_WINDOW_REGISTRY_KEY] : [];
        }
        const raw = localStorage.getItem(HYPERLINK_WINDOW_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

async function writeHyperlinkWindowRegistry(reg) {
    const safe = Array.isArray(reg) ? reg : [];
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [HYPERLINK_WINDOW_REGISTRY_KEY]: safe });
        } else {
            localStorage.setItem(HYPERLINK_WINDOW_REGISTRY_KEY, JSON.stringify(safe));
        }
    } catch (_) { }
}

async function pruneDeadHyperlinkWindows() {
    let reg = await readHyperlinkWindowRegistry();
    const alive = [];
    for (const entry of reg) {
        const { windowId } = entry || {};
        if (!Number.isInteger(windowId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.windows && chrome.windows.get) {
                const w = await chrome.windows.get(windowId, { populate: false });
                ok = !!(w && w.id === windowId);
            }
        } catch (_) { ok = false; }
        if (ok) alive.push(entry);
    }
    await writeHyperlinkWindowRegistry(alive);
    return alive;
}

async function allocateNextHyperlinkWindowNumber() {
    const alive = await pruneDeadHyperlinkWindows();
    let maxN = 0;
    alive.forEach(e => { if (Number.isInteger(e.number) && e.number > 0 && e.number > maxN) maxN = e.number; });
    return maxN + 1;
}

async function registerHyperlinkWindow(windowId, number) {
    const reg = await pruneDeadHyperlinkWindows();
    reg.push({ windowId, number, createdAt: Date.now() });
    await writeHyperlinkWindowRegistry(reg);
}

async function pruneDeadPluginGroups() {
    let reg = await readPluginGroupRegistry();
    const alive = [];
    for (const entry of reg) {
        const { groupId } = entry || {};
        if (!Number.isInteger(groupId)) continue;
        let ok = false;
        try {
            if (chrome && chrome.tabGroups && chrome.tabGroups.get) {
                const g = await chrome.tabGroups.get(groupId);
                ok = !!(g && g.id === groupId);
            }
        } catch (_) {
            ok = false;
        }
        if (ok) alive.push(entry);
    }
    await writePluginGroupRegistry(alive);
    return alive;
}

async function allocateNextGroupNumber() {
    const seeds = await getLiveGroupSeeds();
    const alive = await pruneDeadPluginGroups();
    let maxN = seeds && Number.isFinite(seeds.globalMax) ? seeds.globalMax : 0;
    alive.forEach(e => {
        if (Number.isInteger(e.number) && e.number > maxN) {
            maxN = e.number;
        }
    });
    return maxN + 1;
}

async function registerPluginGroup(groupId, windowId, number) {
    const reg = await pruneDeadPluginGroups();
    reg.push({ groupId, windowId, number, createdAt: Date.now() });
    await writePluginGroupRegistry(reg);
    invalidateLiveGroupSeeds();
}


// =================================================================================
// III. MANUAL WINDOW/GROUP SELECTOR & GLOBAL OPEN EXPORTS (手动窗口/标签组选择与全局打开导出)
// =================================================================================

// =====================================================================
// 手动选择窗口+组功能
// =====================================================================

// 存储手动选择的窗口和组
let manualSelectedWindowId = null;
let manualSelectedGroupId = null;
let manualFocusWindow = false; // 确认后是否跳转/激活窗口，默认不勾选

// 存储自定义窗口名称
let customWindowNames = {};

// 存储窗口ID到序号的映射（用于在标签组中显示友好序号）
let windowIdToIndexMap = {};

// 存储文件夹手动选择的窗口、组和打开模式
let folderManualSelectedWindowId = null;
let folderManualSelectedGroupId = null;
let folderManualOpenMode = 'open-all'; // 'open-all' or 'tab-group'
let folderManualFocusWindow = true; // 确认后是否跳转/激活窗口，默认勾选

/**
 * 显示手动选择窗口+组的选择器
 */
async function showManualWindowGroupSelector(context) {
    try {
        const lang = currentLang || 'zh_CN';
        const selectorType = (context && context.isFolder) ? 'folder' : 'bookmark';

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'manual-selector-overlay';
        overlay.dataset.selectorType = selectorType;

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'manual-selector-dialog';

        // 头部
        const header = document.createElement('div');
        header.className = 'manual-selector-header';
        header.innerHTML = `
            <div class="manual-selector-title">${lang === 'zh_CN' ? '选择窗口和标签组' : 'Select Window and Tab Group'}</div>
            <div class="manual-selector-header-right-btns" style="display: flex; align-items: center; gap: 8px;">
                <div class="manual-selector-drag-btn" title="${lang === 'zh_CN' ? '拖动移动' : 'Drag to move'}">
                    <i class="fas fa-hand-paper"></i>
                </div>
                <button class="manual-selector-close" style="margin: 0;">×</button>
            </div>
        `;

        // 主体
        const body = document.createElement('div');
        body.className = 'manual-selector-body';

        // 左侧：窗口列表
        const windowPanel = document.createElement('div');
        windowPanel.className = 'manual-selector-panel';
        windowPanel.style.position = 'relative';
        windowPanel.innerHTML = `
            <div class="manual-selector-panel-title">
                <span>${lang === 'zh_CN' ? '窗口' : 'Windows'}</span>
                <span style="position: relative; display: inline-flex; align-items: center;">
                    <i class="fas fa-question-circle manual-selector-help-icon"></i>
                </span>
            </div>
            <div class="manual-selector-help-tooltip">
                <p>${lang === 'zh_CN'
                ? '「手动选择」具有记忆功能：选择目标窗口与标签组后，下次点击书签将在指定位置打开。'
                : 'Manual Selection has memory: choosing a target window and tab group will open bookmarks there in the future.'}</p>
                <p>${lang === 'zh_CN'
                ? '如果仅选择窗口而不选择标签组，书签将直接在窗口中追加打开。'
                : 'If you select only a window and no group, bookmarks will be opened inside that window subsequently.'}</p>
            </div>
            <div class="manual-selector-list" data-type="windows"></div>
        `;

        // 绑定帮助图标hover事件
        const helpIcon = windowPanel.querySelector('.manual-selector-help-icon');
        const helpTooltip = windowPanel.querySelector('.manual-selector-help-tooltip');

        // 动态计算箭头位置
        const updateArrowPosition = () => {
            const panelRect = windowPanel.getBoundingClientRect();
            const iconRect = helpIcon.getBoundingClientRect();
            const arrowOffset = iconRect.left - panelRect.left + (iconRect.width / 2);
            helpTooltip.style.setProperty('--arrow-offset', `${arrowOffset}px`);
        };

        helpIcon.addEventListener('mouseenter', () => {
            updateArrowPosition();
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpIcon.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        helpTooltip.addEventListener('mouseenter', () => {
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpTooltip.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        // 右侧：组列表
        const groupPanel = document.createElement('div');
        groupPanel.className = 'manual-selector-panel';
        groupPanel.innerHTML = `
            <div class="manual-selector-panel-title">${lang === 'zh_CN' ? '标签组' : 'Tab Groups'}</div>
            <div class="manual-selector-list" data-type="groups"></div>
        `;

        body.appendChild(windowPanel);
        body.appendChild(groupPanel);

        // 底部按钮
        const footer = document.createElement('div');
        footer.className = 'manual-selector-footer';
        if (selectorType === 'folder') {
            footer.innerHTML = `
                <button class="manual-selector-btn manual-selector-btn-clear">${lang === 'zh_CN' ? '清除选择' : 'Clear'}</button>
                <button class="manual-selector-btn manual-selector-btn-confirm">${lang === 'zh_CN' ? '确认' : 'Confirm'}</button>
            `;
        } else {
            footer.innerHTML = `
                <label class="manual-selector-checkbox-label" style="margin-right: auto;">
                    <input type="checkbox" id="bookmark-focus-window" ${manualFocusWindow ? 'checked' : ''}>
                    <span>${lang === 'zh_CN' ? '确认后跳转' : 'Jump on confirm'}</span>
                </label>
                <button class="manual-selector-btn manual-selector-btn-clear">${lang === 'zh_CN' ? '清除选择' : 'Clear'}</button>
                <button class="manual-selector-btn manual-selector-btn-confirm">${lang === 'zh_CN' ? '确认' : 'Confirm'}</button>
            `;
        }

        // 组装
        dialog.appendChild(header);
        dialog.appendChild(body);
        if (selectorType === 'folder') {
            const optionsRow = document.createElement('div');
            optionsRow.className = 'manual-selector-options-row';
            optionsRow.innerHTML = `
                <span class="manual-selector-options-label" style="display: inline-flex; align-items: center; gap: 4px;">
                    ${lang === 'zh_CN' ? '打开方式:' : 'Open Mode:'}
                    <span style="position: relative; display: inline-flex; align-items: center;">
                        <i class="fas fa-question-circle manual-selector-mode-help-icon" style="color: var(--text-secondary); cursor: pointer; font-size: 13px;"></i>
                        <div class="manual-selector-help-tooltip manual-selector-mode-help-tooltip" style="bottom: 24px; top: auto; left: 50%; transform: translateX(-50%); text-align: left; width: 220px; padding: 8px 12px;">
                            <p style="text-align: left;">${lang === 'zh_CN'
                            ? '参考浏览器官方的做法，打开文件夹时只打开该文件夹下的直接书签，不包含其子文件夹里的书签。'
                            : 'Following browser behavior, opening folders only opens direct bookmarks within this folder, excluding sub-folders.'}</p>
                        </div>
                    </span>
                </span>
                <label class="manual-selector-radio-label">
                    <input type="radio" name="folder-open-mode" value="open-all" ${folderManualOpenMode === 'open-all' ? 'checked' : ''}>
                    <span>${lang === 'zh_CN' ? '打开全部' : 'Open All'}</span>
                </label>
                <label class="manual-selector-radio-label">
                    <input type="radio" name="folder-open-mode" value="tab-group" ${folderManualOpenMode === 'tab-group' ? 'checked' : ''}>
                    <span>${lang === 'zh_CN' ? '标签页组' : 'Tab Group'}</span>
                </label>
                <label class="manual-selector-checkbox-label" style="margin-left: auto;">
                    <input type="checkbox" id="folder-focus-window" ${folderManualFocusWindow ? 'checked' : ''}>
                    <span>${lang === 'zh_CN' ? '确认后跳转' : 'Jump on confirm'}</span>
                </label>
            `;
            dialog.appendChild(optionsRow);
        }
        dialog.appendChild(footer);
        overlay.appendChild(dialog);

        // 将overlay添加到全屏容器或body
        const canvasContainer = getOverlayContainer();
        canvasContainer.appendChild(overlay);

        // 加载窗口和组数据
        await loadWindowsAndGroups(overlay, lang);

        // 阻止选择器内的所有滚动相关事件冒泡到画布
        const preventBubble = (e) => {
            e.stopPropagation();
        };

        // 滚轮事件
        dialog.addEventListener('wheel', preventBubble, { passive: false });

        // 触摸事件
        dialog.addEventListener('touchmove', preventBubble, { passive: false });

        // 鼠标拖动事件（可能影响滚动）
        dialog.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        // 防止点击事件冒泡导致画布交互
        dialog.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 事件处理
        setupSelectorEvents(overlay, context, lang);

        // 如果是文件夹模式且初始为标签页组，则禁用右侧标签组面板并清空选中组ID
        if (selectorType === 'folder' && folderManualOpenMode === 'tab-group') {
            const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
            const groupsPanel = groupsList ? groupsList.closest('.manual-selector-panel') : null;
            if (groupsPanel) {
                groupsPanel.style.opacity = '0.5';
                groupsPanel.style.pointerEvents = 'none';
            }
            folderManualSelectedGroupId = null;
            overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                i.classList.remove('selected');
            });
        }

        // 如果是批量操作，添加 batch-selector 标识
        if (context && context.isBatch) {
            overlay.classList.add('is-batch-selector');
        }

        // 初始化手动选择面板的拖拽功能
        initManualSelectorDrag(overlay, dialog, header);

    } catch (error) {
        console.error('[手动选择器] 显示失败:', error);
    }
}

/**
 * 加载所有窗口和组
 */
async function loadWindowsAndGroups(overlay, lang) {
    try {
        const selectorType = overlay.dataset.selectorType || 'bookmark';
        const selectedWindowId = selectorType === 'folder' ? folderManualSelectedWindowId : manualSelectedWindowId;

        // 获取所有窗口
        const windows = await chrome.windows.getAll({ populate: true });
        const windowsList = overlay.querySelector('.manual-selector-list[data-type="windows"]');

        // 重置窗口序号映射
        windowIdToIndexMap = {};

        if (windows.length === 0) {
            windowsList.innerHTML = `<div class="manual-selector-empty">${lang === 'zh_CN' ? '没有窗口' : 'No windows'}</div>`;
        } else {
            windowsList.innerHTML = '';

            // 获取当前窗口ID
            const currentWindow = await chrome.windows.getCurrent();
            const currentWindowId = currentWindow.id;

            // 预先解析所有窗口的注册信息，以便做排序和标记
            const windowInfos = await Promise.all(windows.map(async (win) => {
                const registeredLabel = await getRegisteredWindowLabel(win.id, lang);
                const isPluginWindow = registeredLabel !== null;
                return { win, isPluginWindow, registeredLabel };
            }));

            // 排序：插件窗口置顶在上方 (isPluginWindow === true 的排在前面)
            windowInfos.sort((a, b) => {
                if (a.isPluginWindow && !b.isPluginWindow) return -1;
                if (!a.isPluginWindow && b.isPluginWindow) return 1;
                return 0; // 维持原相对顺序
            });

            // 构建窗口ID到序号的映射
            windowInfos.forEach((info, index) => {
                windowIdToIndexMap[info.win.id] = index + 1;
            });

            for (const [index, info] of windowInfos.entries()) {
                const win = info.win;
                const windowIndex = index + 1;  // 窗口序号（从1开始）
                const isCurrent = win.id === currentWindowId;
                const tabCount = win.tabs ? win.tabs.length : 0;

                // 获取活动标签页标题
                const activeTab = win.tabs ? win.tabs.find(tab => tab.active) : null;
                const activeTabTitle = activeTab ? activeTab.title : `Window #${win.id}`;

                // 获取显示名称（优先使用自定义名称）
                const defaultName = info.registeredLabel || (lang === 'zh_CN' ? `其他 (${activeTabTitle})` : `Other (${activeTabTitle})`);
                const displayName = customWindowNames[win.id] || defaultName;
                const hasCustomName = !!customWindowNames[win.id];

                // 窗口状态 (插件 / 正常)
                const stateIcon = info.isPluginWindow
                    ? '<i class="fas fa-puzzle-piece"></i>'
                    : '<i class="fas fa-window-restore"></i>';

                const stateText = info.isPluginWindow
                    ? (lang === 'zh_CN' ? '插件' : 'Plugin')
                    : (lang === 'zh_CN' ? '正常' : 'Normal');

                const item = document.createElement('div');
                item.className = 'manual-selector-item';
                item.dataset.windowId = win.id;
                item.dataset.windowIndex = windowIndex;

                // 如果是当前选中的窗口，添加选中样式
                if (selectedWindowId === win.id) {
                    item.classList.add('selected');
                }

                item.innerHTML = `
                    <div class="manual-selector-item-header">
                        <div class="manual-selector-item-title">
                            <span class="manual-selector-window-index">${windowIndex}</span>
                            ${win.incognito ? '🕶️' : '🪟'} ${escapeHtml(displayName)}
                            ${isCurrent ? `<span class="manual-selector-item-badge">${lang === 'zh_CN' ? '当前' : 'Current'}</span>` : ''}
                            ${hasCustomName ? `<span class="manual-selector-item-badge" style="background: var(--accent-primary);">✓</span>` : ''}
                        </div>
                        <div class="manual-selector-item-actions">
                            ${!info.isPluginWindow ? `
                            <button class="manual-selector-edit-btn" data-window-id="${win.id}" title="${lang === 'zh_CN' ? '编辑名称' : 'Edit name'}">
                                <i class="fas fa-edit"></i>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="manual-selector-item-info">
                        <span class="manual-selector-item-meta">${stateIcon} ${stateText}</span>
                        <span class="manual-selector-item-meta"><i class="fas fa-layer-group"></i> ${tabCount} ${lang === 'zh_CN' ? '个标签页' : 'tabs'}</span>
                        ${win.incognito ? `<span class="manual-selector-item-meta"><i class="fas fa-user-secret"></i> ${lang === 'zh_CN' ? '无痕模式' : 'Incognito'}</span>` : ''}
                    </div>
                `;

                // 绑定编辑按钮事件
                const editBtn = item.querySelector('.manual-selector-edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await showWindowNameEditor(item, win.id, displayName, lang);
                    });
                }

                // 点击选择窗口
                item.addEventListener('click', async (e) => {
                    // 如果处于编辑模式，不触发选择
                    if (item.dataset.editing === 'true') {
                        return;
                    }
                    // 如果点击的是编辑按钮或输入框，不触发选择
                    if (e.target.closest('.manual-selector-edit-btn') || e.target.closest('.manual-selector-item-input')) {
                        return;
                    }
                    // 切换选择
                    const wasSelected = item.classList.contains('selected');
                    overlay.querySelectorAll('.manual-selector-list[data-type="windows"] .manual-selector-item').forEach(i => {
                        i.classList.remove('selected');
                    });

                    if (!wasSelected) {
                        item.classList.add('selected');
                        if (selectorType === 'folder') {
                            folderManualSelectedWindowId = win.id;
                        } else {
                            manualSelectedWindowId = win.id;
                        }
                    } else {
                        if (selectorType === 'folder') {
                            folderManualSelectedWindowId = null;
                        } else {
                            manualSelectedWindowId = null;
                        }
                    }

                    // 更新组列表
                    const nextWinId = selectorType === 'folder' ? folderManualSelectedWindowId : manualSelectedWindowId;
                    await loadGroupsForWindow(overlay, nextWinId, lang);
                });

                windowsList.appendChild(item);
            }
        }

        // 初始加载组列表
        await loadGroupsForWindow(overlay, selectedWindowId, lang);

    } catch (error) {
        console.error('[手动选择器] 加载窗口和组失败:', error);
    }
}

/**
 * 加载指定窗口的组（如果未指定窗口，显示所有组）
 */
async function loadGroupsForWindow(overlay, windowId, lang) {
    try {
        const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');

        // 查询组
        const query = windowId ? { windowId } : {};
        const groups = await chrome.tabGroups.query(query);

        if (groups.length === 0) {
            groupsList.innerHTML = `<div class="manual-selector-empty">${windowId ? (lang === 'zh_CN' ? '该窗口没有标签组' : 'No groups in this window') : (lang === 'zh_CN' ? '选择窗口以查看其标签组，或直接选择所有组' : 'Select a window to see its groups, or choose from all groups')}</div>`;

            // 如果没有选择窗口，显示所有组
            if (!windowId) {
                const allGroups = await chrome.tabGroups.query({});
                if (allGroups.length > 0) {
                    renderGroups(overlay, allGroups, lang);
                }
            }
        } else {
            renderGroups(overlay, groups, lang);
        }
    } catch (error) {
        console.error('[手动选择器] 加载组失败:', error);
    }
}

/**
 * 渲染组列表
 */
function renderGroups(overlay, groups, lang) {
    const selectorType = overlay.dataset.selectorType || 'bookmark';
    const selectedGroupId = selectorType === 'folder' ? folderManualSelectedGroupId : manualSelectedGroupId;
    const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
    groupsList.innerHTML = '';

    // 按窗口分组显示
    const groupsByWindow = {};
    groups.forEach(group => {
        if (!groupsByWindow[group.windowId]) {
            groupsByWindow[group.windowId] = [];
        }
        groupsByWindow[group.windowId].push(group);
    });

    // 获取窗口ID列表（如果有多个窗口的组，显示窗口分隔）
    const windowIds = Object.keys(groupsByWindow);
    const showWindowHeaders = windowIds.length > 1;

    windowIds.forEach(winId => {
        // 获取窗口序号
        const windowIndex = windowIdToIndexMap[winId] || winId;

        // 如果有多个窗口，显示窗口标题
        if (showWindowHeaders) {
            const header = document.createElement('div');
            header.className = 'manual-selector-item-info';
            header.style.padding = '8px 16px';
            header.style.fontWeight = '600';
            header.style.borderBottom = '1px solid var(--border-color)';
            header.style.marginBottom = '6px';
            header.innerHTML = `<i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '窗口' : 'Window'} ${windowIndex}`;
            groupsList.appendChild(header);
        }

        groupsByWindow[winId].forEach(group => {
            const colorMap = {
                'grey': '⚪',
                'blue': '🔵',
                'red': '🔴',
                'yellow': '🟡',
                'green': '🟢',
                'pink': '🟣',
                'purple': '🟣',
                'cyan': '🔵',
                'orange': '🟠'
            };
            const colorIcon = colorMap[group.color] || '⚪';

            const item = document.createElement('div');
            item.className = 'manual-selector-item';
            item.dataset.groupId = group.id;
            item.dataset.windowId = group.windowId;

            // 如果是当前选中的组，添加选中样式
            if (selectedGroupId === group.id) {
                item.classList.add('selected');
            }

            const title = group.title || (lang === 'zh_CN' ? '(无标题)' : '(Untitled)');
            const groupWindowIndex = windowIdToIndexMap[group.windowId] || group.windowId;

            item.innerHTML = `
                <div class="manual-selector-item-title">
                    ${colorIcon} ${escapeHtml(title)}
                </div>
                <div class="manual-selector-item-info">${lang === 'zh_CN' ? '窗口' : 'Window'} ${groupWindowIndex}</div>
            `;

            // 点击选择组
            item.addEventListener('click', () => {
                // 切换选择
                const wasSelected = item.classList.contains('selected');
                overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                    i.classList.remove('selected');
                });

                if (!wasSelected) {
                    item.classList.add('selected');
                    if (selectorType === 'folder') {
                        folderManualSelectedGroupId = group.id;
                    } else {
                        manualSelectedGroupId = group.id;
                    }
                } else {
                    if (selectorType === 'folder') {
                        folderManualSelectedGroupId = null;
                    } else {
                        manualSelectedGroupId = null;
                    }
                }
            });

            groupsList.appendChild(item);
        });
    });
}

/**
 * 设置选择器事件
 */
function setupSelectorEvents(overlay, context, lang) {
    // 绑定打开方式的帮助图标hover事件
    const selectorType = overlay.dataset.selectorType || 'bookmark';
    if (selectorType === 'folder') {
        const modeHelpIcon = overlay.querySelector('.manual-selector-mode-help-icon');
        const modeHelpTooltip = overlay.querySelector('.manual-selector-mode-help-tooltip');
        if (modeHelpIcon && modeHelpTooltip) {
            modeHelpIcon.addEventListener('mouseenter', () => {
                modeHelpTooltip.style.opacity = '1';
                modeHelpTooltip.style.visibility = 'visible';
            });

            modeHelpIcon.addEventListener('mouseleave', () => {
                modeHelpTooltip.style.opacity = '0';
                modeHelpTooltip.style.visibility = 'hidden';
            });

            modeHelpTooltip.addEventListener('mouseenter', () => {
                modeHelpTooltip.style.opacity = '1';
                modeHelpTooltip.style.visibility = 'visible';
            });

            modeHelpTooltip.addEventListener('mouseleave', () => {
                modeHelpTooltip.style.opacity = '0';
                modeHelpTooltip.style.visibility = 'hidden';
            });
        }
    }

    // 关闭按钮
    const closeBtn = overlay.querySelector('.manual-selector-close');
    closeBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // 绑定文件夹打开方式单选框变化事件
    if (selectorType === 'folder') {
        const radios = overlay.querySelectorAll('input[name="folder-open-mode"]');
        radios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const val = e.target.value;
                const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
                const groupsPanel = groupsList ? groupsList.closest('.manual-selector-panel') : null;
                if (val === 'tab-group') {
                    folderManualSelectedGroupId = null;
                    overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                        i.classList.remove('selected');
                    });
                    if (groupsPanel) {
                        groupsPanel.style.opacity = '0.5';
                        groupsPanel.style.pointerEvents = 'none';
                    }
                } else {
                    if (groupsPanel) {
                        groupsPanel.style.opacity = '';
                        groupsPanel.style.pointerEvents = '';
                    }
                }
            });
        });
    }

    // 清除按钮
    const clearBtn = overlay.querySelector('.manual-selector-btn-clear');
    clearBtn.addEventListener('click', () => {
        const selectorType = overlay.dataset.selectorType || 'bookmark';
        if (selectorType === 'folder') {
            folderManualSelectedWindowId = null;
            folderManualSelectedGroupId = null;
            folderManualOpenMode = 'open-all';
            folderManualFocusWindow = true;

            const radio = overlay.querySelector('input[name="folder-open-mode"][value="open-all"]');
            if (radio) radio.checked = true;

            const checkbox = overlay.querySelector('#folder-focus-window');
            if (checkbox) checkbox.checked = true;

            const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
            const groupsPanel = groupsList ? groupsList.closest('.manual-selector-panel') : null;
            if (groupsPanel) {
                groupsPanel.style.opacity = '';
                groupsPanel.style.pointerEvents = '';
            }

            saveFolderManualSelection();
        } else {
            manualSelectedWindowId = null;
            manualSelectedGroupId = null;
            manualFocusWindow = false;

            const checkbox = overlay.querySelector('#bookmark-focus-window');
            if (checkbox) checkbox.checked = false;

            saveManualSelection();
        }

        // 清除选中样式
        overlay.querySelectorAll('.manual-selector-item').forEach(item => {
            item.classList.remove('selected');
        });

        // 重新加载组列表
        loadGroupsForWindow(overlay, null, lang);
    });

    // 确认按钮
    const confirmBtn = overlay.querySelector('.manual-selector-btn-confirm');
    confirmBtn.addEventListener('click', async () => {
        const selectorType = overlay.dataset.selectorType || 'bookmark';

        if (selectorType === 'folder') {
            const checkedRadio = overlay.querySelector('input[name="folder-open-mode"]:checked');
            if (checkedRadio) {
                folderManualOpenMode = checkedRadio.value;
            }
            const checkbox = overlay.querySelector('#folder-focus-window');
            if (checkbox) {
                folderManualFocusWindow = checkbox.checked;
            }
            // 保存选择
            await saveFolderManualSelection();

            // 关闭选择器
            overlay.remove();

            // 立即使用选择的窗口/组/模式打开文件夹的所有子书签
            const urls = await getUrlsFromContext(context);
            if (urls && urls.length > 0) {
                await openFolderWithManualSelection(urls, context.nodeTitle, context);
            }
        } else {
            const checkbox = overlay.querySelector('#bookmark-focus-window');
            if (checkbox) {
                manualFocusWindow = checkbox.checked;
            }
            // 保存选择
            await saveManualSelection();

            // 设置为默认打开方式
            if (context && context.isHyperlink) {
                await setHyperlinkDefaultOpenMode('manual-select');
            } else {
                await setDefaultOpenMode('manual-select');
            }

            // 关闭选择器
            overlay.remove();

            // 如果有书签URL，立即使用选择的窗口/组打开
            if (context && context.nodeUrl) {
                await openBookmarkWithManualSelection(context.nodeUrl, context);
            }
        }
    });
}

/**
 * 保存手动选择到storage
 */
async function saveManualSelection() {
    try {
        await chrome.storage.local.set({
            manualSelectedWindowId,
            manualSelectedGroupId,
            customWindowNames,
            manualFocusWindow
        });
        ;
    } catch (error) {
        console.error('[手动选择器] 保存失败:', error);
    }
}

/**
 * 保存文件夹手动选择到storage
 */
async function saveFolderManualSelection() {
    try {
        await chrome.storage.local.set({
            folderManualSelectedWindowId,
            folderManualSelectedGroupId,
            folderManualOpenMode,
            folderManualFocusWindow
        });
        ;
    } catch (error) {
        console.error('[手动选择器] 保存文件夹设置失败:', error);
    }
}

/**
 * 设置窗口自定义名称
 */
async function setCustomWindowName(windowId, customName) {
    if (customName && customName.trim()) {
        customWindowNames[windowId] = customName.trim();
    } else {
        delete customWindowNames[windowId];
    }
    await saveManualSelection();
}

async function getRegisteredWindowLabel(winId, lang) {
    if (!Number.isInteger(winId)) return null;
    const isZh = lang === 'zh_CN';

    try {
        const [scopedReg, swsgReg, pluginReg, hyperlinkReg] = await Promise.all([
            readScopedWindowRegistry(),
            readSwsgWindowRegistry(),
            readPluginWindowRegistry(),
            readHyperlinkWindowRegistry()
        ]);

        const scopedEntry = scopedReg.find(e => e && e.windowId === winId);
        if (scopedEntry) {
            let scopePrefix = '';
            if (scopedEntry.scope) {
                if (scopedEntry.scope === 'permanent') {
                    scopePrefix = '#A';
                } else if (scopedEntry.scope.startsWith('permanent-copy:')) {
                    const copyId = scopedEntry.scope.substring('permanent-copy:'.length);
                    const idx = typeof __ctxMenuResolvePermanentCopyDisplayIndex === 'function' ? __ctxMenuResolvePermanentCopyDisplayIndex(copyId) : null;
                    scopePrefix = idx ? `#${toAlphaLabel(idx + 1)}` : '';
                } else if (scopedEntry.scope.startsWith('temp:')) {
                    scopePrefix = scopedEntry.scope.substring('temp:'.length);
                }
            }
            const prefixSpace = scopePrefix ? `${scopePrefix} ` : '';
            return isZh
                ? `专属窗口 ${prefixSpace}${scopedEntry.number}`
                : `Exclusive Window ${prefixSpace}${scopedEntry.number}`;
        }

        const swsgEntry = swsgReg.find(e => e && e.windowId === winId);
        if (swsgEntry) {
            return isZh
                ? `同窗专属组 ${swsgEntry.number}`
                : `Same Window Exclusive Group ${swsgEntry.number}`;
        }

        const pluginEntry = pluginReg.find(e => e && e.windowId === winId);
        if (pluginEntry) {
            return isZh
                ? `同一窗口 ${pluginEntry.number}`
                : `Same Window ${pluginEntry.number}`;
        }

        const hyperlinkEntry = hyperlinkReg.find(e => e && e.windowId === winId);
        if (hyperlinkEntry) {
            return isZh
                ? `超链接窗口 ${hyperlinkEntry.number}`
                : `Hyperlink Window ${hyperlinkEntry.number}`;
        }

        if (winId === sameWindowSpecificGroupWindowId) {
            return isZh ? `同窗专属组` : `Same Window Exclusive Group`;
        }
        if (winId === specificWindowId || winId === specificGroupWindowId) {
            return isZh ? `同一窗口` : `Same Window`;
        }
        if (winId === hyperlinkSpecificWindowId || winId === hyperlinkSpecificGroupWindowId || winId === hyperlinkSameWindowSpecificGroupWindowId) {
            return isZh ? `超链接窗口` : `Hyperlink Window`;
        }

        if (scopedWindows) {
            for (const [scopeKey, id] of Object.entries(scopedWindows)) {
                if (id === winId) {
                    let scopePrefix = '';
                    if (scopeKey === 'permanent') {
                        scopePrefix = '#A';
                    } else if (scopeKey.startsWith('permanent-copy:')) {
                        const copyId = scopeKey.substring('permanent-copy:'.length);
                        const idx = typeof __ctxMenuResolvePermanentCopyDisplayIndex === 'function' ? __ctxMenuResolvePermanentCopyDisplayIndex(copyId) : null;
                        scopePrefix = idx ? `#${toAlphaLabel(idx + 1)}` : '';
                    } else if (scopeKey.startsWith('temp:')) {
                        scopePrefix = scopeKey.substring('temp:'.length);
                    }
                    const prefixSpace = scopePrefix ? `${scopePrefix} ` : '';
                    return isZh
                        ? `专属窗口 ${prefixSpace}`
                        : `Exclusive Window ${prefixSpace}`;
                }
            }
        }
    } catch (err) {
        console.warn('[getRegisteredWindowLabel] Error identifying window:', err);
    }

    return null;
}

/**
 * 获取窗口显示名称（优先使用自定义名称）
 */
async function getWindowDisplayName(windowId, activeTabTitle, lang) {
    if (customWindowNames[windowId]) {
        return customWindowNames[windowId];
    }
    const registeredLabel = await getRegisteredWindowLabel(windowId, lang);
    if (registeredLabel) {
        return registeredLabel;
    }
    return lang === 'zh_CN' ? `其他 (${activeTabTitle})` : `Other (${activeTabTitle})`;
}

/**
 * 显示窗口名称编辑器
 */
async function showWindowNameEditor(item, windowId, currentName, lang) {
    const titleDiv = item.querySelector('.manual-selector-item-title');
    const actionsDiv = item.querySelector('.manual-selector-item-actions');

    // 保存原始HTML
    const originalTitleHTML = titleDiv.innerHTML;
    const originalActionsHTML = actionsDiv.innerHTML;

    // 标记为编辑模式，防止item的click事件触发
    item.dataset.editing = 'true';

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'manual-selector-item-input';
    input.value = currentName;
    input.placeholder = lang === 'zh_CN' ? '输入自定义名称' : 'Enter custom name';

    // 创建操作按钮
    const saveBtn = document.createElement('button');
    saveBtn.className = 'manual-selector-edit-btn';
    saveBtn.innerHTML = '<i class="fas fa-check"></i>';
    saveBtn.title = lang === 'zh_CN' ? '保存' : 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'manual-selector-edit-btn';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
    cancelBtn.title = lang === 'zh_CN' ? '取消' : 'Cancel';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'manual-selector-edit-btn';
    clearBtn.innerHTML = '<i class="fas fa-undo"></i>';
    clearBtn.title = lang === 'zh_CN' ? '还原为默认名称' : 'Restore default name';
    clearBtn.style.color = '#dc3545';

    // 替换内容
    titleDiv.innerHTML = '';
    titleDiv.appendChild(input);

    actionsDiv.innerHTML = '';
    actionsDiv.appendChild(saveBtn);
    actionsDiv.appendChild(clearBtn);
    actionsDiv.appendChild(cancelBtn);
    actionsDiv.style.opacity = '1'; // 始终显示

    // 聚焦并选中文本
    input.focus();
    input.select();

    // 保存函数
    const save = async () => {
        const newName = input.value.trim();
        await setCustomWindowName(windowId, newName);

        // 重新加载窗口列表以刷新显示
        const overlay = item.closest('.manual-selector-overlay');
        if (overlay) {
            await loadWindowsAndGroups(overlay, lang);
        }
    };

    // 取消函数
    const cancel = () => {
        // 移除编辑模式标记
        delete item.dataset.editing;

        titleDiv.innerHTML = originalTitleHTML;
        actionsDiv.innerHTML = originalActionsHTML;
        actionsDiv.style.opacity = '';

        // 重新绑定编辑按钮
        const editBtn = actionsDiv.querySelector('.manual-selector-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await showWindowNameEditor(item, windowId, currentName, lang);
            });
        }
    };

    // 清除函数
    const clear = async () => {
        await setCustomWindowName(windowId, '');
        const overlay = item.closest('.manual-selector-overlay');
        if (overlay) {
            await loadWindowsAndGroups(overlay, lang);
        }
    };

    // 绑定事件
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        save();
    });

    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancel();
    });

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clear();
    });

    // Enter保存，Escape取消
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            if (e.isComposing) return;
            save();
        } else if (e.key === 'Escape') {
            cancel();
        }
    });

    // 阻止点击输入框时触发窗口选择
    input.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

async function loadManualSelection() {
    try {
        const data = await chrome.storage.local.get([
            'manualSelectedWindowId',
            'manualSelectedGroupId',
            'customWindowNames',
            'manualFocusWindow',
            'folderManualSelectedWindowId',
            'folderManualSelectedGroupId',
            'folderManualOpenMode',
            'folderManualFocusWindow'
        ]);
        manualSelectedWindowId = data.manualSelectedWindowId || null;
        manualSelectedGroupId = data.manualSelectedGroupId || null;
        customWindowNames = data.customWindowNames || {};
        manualFocusWindow = data.manualFocusWindow === true;

        folderManualSelectedWindowId = data.folderManualSelectedWindowId || null;
        folderManualSelectedGroupId = data.folderManualSelectedGroupId || null;
        folderManualOpenMode = data.folderManualOpenMode || 'open-all';
        folderManualFocusWindow = data.folderManualFocusWindow !== false;
    } catch (error) {
        console.error('[手动选择器] 加载失败:', error);
    }
}

/**
 * 使用手动选择的窗口/组打开书签
 */
async function openBookmarkWithManualSelection(url, context = null) {
    try {
        if (!url) return;

        const windowId = manualSelectedWindowId;
        const groupId = manualSelectedGroupId;
        const focusWindow = manualFocusWindow;

        const handleTabCreated = async (tab) => {
            if (tab && tab.id != null) {
                await reportExtensionBookmarkOpen({ tabId: tab.id, url, source: 'history_ui' });
                if (context) {
                    try {
                        const scope = getScopeFromContext(context);
                        if (scope) {
                            const prefix = scope.prefix || '';
                            const titleText = scope.title || '';
                            const label = (prefix && titleText) ? `${prefix} - ${titleText}` : (prefix || titleText || '');
                            if (label) {
                                await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                            }
                        }
                    } catch (_) {}
                }
            }
        };

        // 情况1: 窗口 + 组
        if (windowId && groupId) {
            try {
                // 验证组是否存在
                const group = await chrome.tabGroups.get(groupId);

                // 如果组存在，则使用该组所在的实际窗口 ID
                const targetWindowId = group.windowId;
                const tab = await chrome.tabs.create({ url, windowId: targetWindowId, active: focusWindow });
                await chrome.tabs.group({ groupId, tabIds: [tab.id] });
                await handleTabCreated(tab);
            } catch (error) {
                console.warn('[手动选择器] 组不存在，尝试在指定窗口中创建标签:', error);

                // 组不存在，退而求其次，在指定窗口打开
                let targetWindowId = windowId;
                if (targetWindowId) {
                    try {
                        await chrome.windows.get(targetWindowId);
                    } catch (_) {
                        console.warn('[手动选择器] 指定窗口不存在，回退到当前窗口');
                        targetWindowId = null;
                    }
                }

                const createProps = { url, active: focusWindow };
                if (targetWindowId) {
                    createProps.windowId = targetWindowId;
                }
                const tab = await chrome.tabs.create(createProps);
                await handleTabCreated(tab);
            }
        }
        // 情况2: 仅窗口
        else if (windowId) {
            let targetWindowId = windowId;
            try {
                await chrome.windows.get(targetWindowId);
            } catch (_) {
                console.warn('[手动选择器] 指定窗口不存在，回退到当前窗口');
                targetWindowId = null;
            }
            const createProps = { url, active: focusWindow };
            if (targetWindowId) {
                createProps.windowId = targetWindowId;
            }
            const tab = await chrome.tabs.create(createProps);
            await handleTabCreated(tab);
        }
        // 情况3: 仅组
        else if (groupId) {
            try {
                const group = await chrome.tabGroups.get(groupId);
                const tab = await chrome.tabs.create({ url, windowId: group.windowId, active: focusWindow });
                await chrome.tabs.group({ groupId, tabIds: [tab.id] });
                await handleTabCreated(tab);
            } catch (error) {
                console.warn('[手动选择器] 组不存在，在新标签页打开:', error);
                const tab = await chrome.tabs.create({ url, active: focusWindow });
                await handleTabCreated(tab);
            }
        }
        // 情况4: 都不选（新标签页）
        else {
            const tab = await chrome.tabs.create({ url, active: focusWindow });
            await handleTabCreated(tab);
        }

        // 如果要跳转，激活目标窗口
        if (focusWindow) {
            let targetWindowId = windowId;
            if (groupId) {
                try {
                    const group = await chrome.tabGroups.get(groupId);
                    targetWindowId = group.windowId;
                } catch (_) {}
            }
            if (targetWindowId) {
                try {
                    await chrome.windows.get(targetWindowId);
                    await chrome.windows.update(targetWindowId, { focused: true });
                } catch (_) {}
            }
        }

    } catch (error) {
        console.error('[手动选择器] 打开书签失败:', error);
        window.open(url, '_blank');
    }
}

/**
 * 递归或者从临时栏目获取文件夹的所有子书签 URL
 */
async function getUrlsFromContext(context) {
    if (!context) return [];
    if (context.isBatch) {
        if (typeof context.getUrls === 'function') {
            return await context.getUrls();
        }
        return [];
    }
    if (!context.isFolder) {
        return context.nodeUrl ? [context.nodeUrl] : [];
    }
    if (context.treeType === 'temporary') {
        return collectTempUrls(context.sectionId, context.nodeId);
    } else {
        const urls = [];
        try {
            const children = await chrome.bookmarks.getChildren(context.nodeId);
            for (const child of children) {
                if (child.url) {
                    urls.push(child.url);
                }
            }
        } catch (error) {
            console.error('[手动选择器] 获取书签子项失败:', error);
        }
        return urls;
    }
}

/**
 * 使用手动选择的窗口/组/模式打开文件夹下所有书签
 */
async function openFolderWithManualSelection(urls, title, context = null) {
    if (!urls || !urls.length) return;

    // 确认是否打开大量书签
    if (urls.length > 10) {
        const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    const windowId = folderManualSelectedWindowId;
    const groupId = folderManualSelectedGroupId;
    const openMode = folderManualOpenMode || 'open-all';
    const focusWindow = folderManualFocusWindow;

    // 构建来源映射
    const urlToScopeMap = {};
    let singleFolderScope = null;
    if (context && context.isBatch) {
        Object.assign(urlToScopeMap, await buildSelectionUrlToScopeMap());
    } else if (context) {
        singleFolderScope = getScopeFromContext(context);
    }

    try {
        // 1. 确定目标窗口 ID
        let targetWindowId = windowId;
        if (!targetWindowId && groupId) {
            try {
                const group = await chrome.tabGroups.get(groupId);
                targetWindowId = group.windowId;
            } catch (_) {}
        }
        if (targetWindowId) {
            try {
                // 验证目标窗口是否存在
                await chrome.windows.get(targetWindowId);
            } catch (_) {
                console.warn('[手动选择器] 指定目标窗口不存在，回退到当前窗口');
                targetWindowId = null;
            }
        }
        if (!targetWindowId) {
            const currentWindow = await chrome.windows.getCurrent();
            targetWindowId = currentWindow.id;
        }

        // 2. 创建所有标签页
        const tabIds = [];
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            const active = focusWindow && (i === urls.length - 1);
            const tab = await chrome.tabs.create({
                url,
                windowId: targetWindowId,
                active: active
            });
            if (tab && tab.id != null) {
                tabIds.push(tab.id);
                await reportExtensionBookmarkOpen({ tabId: tab.id, url, source: 'history_ui' });

                // 写入来源标记
                try {
                    const scope = (context && context.isBatch) ? urlToScopeMap[url] : singleFolderScope;
                    if (scope) {
                        const prefix = scope.prefix || '';
                        const titleText = scope.title || '';
                        const label = (prefix && titleText) ? `${prefix} - ${titleText}` : (prefix || titleText || '');
                        if (label) {
                            await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                        }
                    }
                } catch (labelErr) {
                    console.warn('[手动选择器] 保存标签来源失败:', labelErr);
                }
            }
        }

        if (tabIds.length === 0) return;

        // 3. 分组处理
        if (openMode === 'tab-group') {
            const newGroupId = await chrome.tabs.group({
                tabIds: tabIds,
                createProperties: { windowId: targetWindowId }
            });
            if (newGroupId != null) {
                await chrome.tabGroups.update(newGroupId, {
                    title: title || ((typeof currentLang !== 'undefined' ? currentLang : 'zh_CN') === 'zh_CN' ? '新分组' : 'New Group')
                });
            }
        } else {
            if (groupId) {
                try {
                    const targetGroup = await chrome.tabGroups.get(groupId);
                    if (targetGroup && targetGroup.windowId === targetWindowId) {
                        await chrome.tabs.group({
                            groupId: groupId,
                            tabIds: tabIds
                        });
                    }
                } catch (err) {
                    console.warn('[手动选择器] 目标组不存在或不在目标窗口，忽略分组操作:', err);
                }
            }
        }

        // 4. 如果要跳转且目标窗口不是当前窗口，则激活该窗口
        if (focusWindow) {
            try {
                await chrome.windows.update(targetWindowId, { focused: true });
            } catch (_) {}
        }
    } catch (error) {
        console.error('[手动选择器] 打开文件夹失败:', error);
        for (const url of urls) {
            window.open(url, '_blank');
        }
    }
}

// 初始化时延迟加载手动选择（避开首屏加载）
setTimeout(() => {
    try { loadManualSelection(); } catch (_) {}
}, 600);

// 导出到全局供其他模块调用
try {
    // Canvas / History UI 里会优先调用这些 window.* 打开函数（否则会 fallback 到 window.open，无法归因）
    window.openBookmarkNewTab = openBookmarkNewTab;
    window.openBookmarkNewWindow = openBookmarkNewWindow;
    window.openInNewTab = openInNewTab;
    window.openInNewWindow = openInNewWindow;
    window.openInSpecificTabGroup = openInSpecificTabGroup;
    window.openInSpecificWindow = openInSpecificWindow;
    window.reportExtensionBookmarkOpen = reportExtensionBookmarkOpen;
    window.openBookmarkWithManualSelection = openBookmarkWithManualSelection;
    window.openFolderWithManualSelection = openFolderWithManualSelection;
    window.batchOpenWithManualSelection = batchOpenWithManualSelection;
    window.batchOpenWithManualSelectionTemplateRun = batchOpenWithManualSelectionTemplateRun;
    window.saveTabSourceLabel = saveTabSourceLabel;
} catch (_) { }

// Redundant click listener removed. Global modifier key click listener is managed near selectModeGlobalClickHandler.


// =================================================================================
// IV. HYPERLINK OPENING IMPLEMENTATION (超链接打开实现)
// =================================================================================

// ========== 超链接系统：独立的打开函数（不与书签共享状态） ==========

// 超链接：新标签页打开
async function openHyperlinkNewTab(url) {
    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            const placement = await getNewTabPlacementProperties();
            const { groupId, currentTabId, placement: placementMode, ...createPlacement } = placement;
            const tab = await chrome.tabs.create({
                url,
                active: false,
                ...createPlacement
            });
            await groupCreatedTabIfNeeded(tab, groupId, placementMode, currentTabId);
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 新标签页打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：新窗口打开
async function openHyperlinkNewWindow(url) {
    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
            await chrome.windows.create({ url, focused: true });
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 新窗口打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：无痕窗口打开（独立于书签系统）
async function openHyperlinkIncognito(url) {
    if (!url) return;
    const lang = currentLang || 'zh_CN';

    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.create) {
            try {
                await chrome.windows.create({ url, incognito: true, focused: true });
            } catch (error) {
                if (error.message && error.message.includes('Incognito mode is disabled')) {
                    const msg = lang === 'zh_CN'
                        ? '无痕模式已禁用。正在普通窗口中打开。\n\n如需使用无痕模式，请在扩展程序设置中启用"在无痕模式下运行"。'
                        : 'Incognito mode is disabled. Opening in normal window.\n\nTo use incognito mode, enable "Allow in Incognito" in extension settings.';
                    alert(msg);
                    await chrome.windows.create({ url, incognito: false, focused: true });
                } else {
                    throw error;
                }
            }
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 无痕窗口打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：同窗特定组（独立于书签系统）
async function openHyperlinkInSameWindowSpecificGroup(url, options = {}) {
    const { forceNew = false, forceNewGroup = false, forceNewWindow = false } = options;
    const lang = currentLang || 'zh_CN';

    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        window.open(url, '_blank');
        return;
    }

    try {
        // 使用超链接专用的作用域键
        const scopeKey = 'hyperlink';

        if (forceNewWindow) {
            hyperlinkSameWindowSpecificGroupWindowId = null;
            hyperlinkSameWindowSpecificGroupScopes = {};
        }

        if (forceNewGroup || forceNew) {
            if (hyperlinkSameWindowSpecificGroupScopes && hyperlinkSameWindowSpecificGroupScopes[scopeKey]) {
                delete hyperlinkSameWindowSpecificGroupScopes[scopeKey];
            }
        }

        // 检查已有窗口是否有效
        let windowOk = false;
        if (hyperlinkSameWindowSpecificGroupWindowId && Number.isInteger(hyperlinkSameWindowSpecificGroupWindowId)) {
            try {
                if (chrome.windows && chrome.windows.get) {
                    await chrome.windows.get(hyperlinkSameWindowSpecificGroupWindowId, { populate: false });
                    windowOk = true;
                }
            } catch (_) {
                hyperlinkSameWindowSpecificGroupWindowId = null;
                hyperlinkSameWindowSpecificGroupScopes = {};
            }
        }

        // 如果没有有效窗口，创建新窗口
        if (!windowOk) {
            const newWin = await chrome.windows.create({ url, focused: true });
            hyperlinkSameWindowSpecificGroupWindowId = newWin.id;
            hyperlinkSameWindowSpecificGroupScopes = {};

            // 创建分组
            if (newWin.tabs && newWin.tabs.length > 0 && chrome.tabs.group) {
                hyperlinkGroupCounter++;
                const groupName = `Hyperlink ${hyperlinkGroupCounter}`;
                const groupId = await chrome.tabs.group({
                    tabIds: [newWin.tabs[0].id],
                    createProperties: { windowId: newWin.id }
                });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    await chrome.tabGroups.update(groupId, {
                        title: groupName,
                        color: 'purple'
                    });
                }
                hyperlinkSameWindowSpecificGroupScopes[scopeKey] = { groupId, windowId: newWin.id };
            }
            return;
        }

        // 有效窗口存在，检查作用域的分组
        const scopeEntry = hyperlinkSameWindowSpecificGroupScopes && hyperlinkSameWindowSpecificGroupScopes[scopeKey];
        let groupOk = false;

        if (scopeEntry && scopeEntry.groupId && Number.isInteger(scopeEntry.groupId)) {
            try {
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(scopeEntry.groupId);
                    groupOk = true;
                }
            } catch (_) {
                if (hyperlinkSameWindowSpecificGroupScopes[scopeKey]) {
                    delete hyperlinkSameWindowSpecificGroupScopes[scopeKey];
                }
            }
        }

        if (groupOk && scopeEntry) {
            // 分组有效，在该分组中创建标签
            const tab = await chrome.tabs.create({
                url,
                windowId: hyperlinkSameWindowSpecificGroupWindowId,
                active: true
            });

            if (chrome.tabs.group) {
                await chrome.tabs.group({
                    tabIds: [tab.id],
                    groupId: scopeEntry.groupId
                });
            }
        } else {
            // 需要创建新分组
            const tab = await chrome.tabs.create({
                url,
                windowId: hyperlinkSameWindowSpecificGroupWindowId,
                active: true
            });

            if (chrome.tabs.group) {
                hyperlinkGroupCounter++;
                const groupName = `Hyperlink ${hyperlinkGroupCounter}`;
                const groupId = await chrome.tabs.group({
                    tabIds: [tab.id],
                    createProperties: { windowId: hyperlinkSameWindowSpecificGroupWindowId }
                });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    await chrome.tabGroups.update(groupId, {
                        title: groupName,
                        color: 'purple'
                    });
                }
                hyperlinkSameWindowSpecificGroupScopes[scopeKey] = { groupId, windowId: hyperlinkSameWindowSpecificGroupWindowId };
            }
        }
    } catch (error) {
        console.error('[超链接] 同窗特定组打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：在特定标签组中打开（Group名："Hyperlink 1", "Hyperlink 2"...）
async function openHyperlinkInSpecificTabGroup(url, options = {}) {
    const { forceNew = false } = options;
    const lang = currentLang || 'zh_CN';

    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        window.open(url, '_blank');
        return;
    }

    await ensureCurrentWindowId();

    try {
        if (forceNew) {
            await resetHyperlinkSpecificGroupInfo(currentWindowId);
        }

        // 检查已有分组是否有效
        if (hyperlinkSpecificTabGroupId && Number.isInteger(hyperlinkSpecificTabGroupId)) {
            try {
                // 窗口必须匹配当前窗口，以实现窗口隔离
                if (hyperlinkSpecificGroupWindowId !== currentWindowId) {
                    throw new Error('Window mismatch');
                }
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(hyperlinkSpecificTabGroupId);
                }
                if (hyperlinkSpecificGroupWindowId && chrome.windows && chrome.windows.get) {
                    await chrome.windows.get(hyperlinkSpecificGroupWindowId, { populate: false });
                }

                // 分组有效，在该分组中创建标签
                const tab = await chrome.tabs.create({
                    url,
                    windowId: hyperlinkSpecificGroupWindowId || undefined,
                    active: true
                });

                if (chrome.tabs.group) {
                    await chrome.tabs.group({
                        tabIds: [tab.id],
                        groupId: hyperlinkSpecificTabGroupId
                    });
                }

                ;
                return;
            } catch (error) {
                console.warn('[超链接] 分组已失效或窗口不匹配，创建新分组');
                await resetHyperlinkSpecificGroupInfo(currentWindowId);
            }
        }

        // 创建新分组，递增计数器
        hyperlinkGroupCounter++;
        const groupTitle = `Hyperlink ${hyperlinkGroupCounter}`;

        const winId = currentWindowId || (await chrome.windows.getCurrent({ populate: false })).id;
        const tab = await chrome.tabs.create({
            url,
            windowId: winId,
            active: true
        });

        if (chrome.tabs.group && chrome.tabGroups && chrome.tabGroups.update) {
            const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
            await chrome.tabGroups.update(groupId, {
                title: groupTitle,
                collapsed: false
            });

            await setHyperlinkSpecificGroupInfo(groupId, winId);

            ;
        }
    } catch (error) {
        console.error('[超链接] 分组打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：在特定窗口中打开（带书签画布tab + Window名："Hyperlink 1", "Hyperlink 2"...）
async function openHyperlinkInSpecificWindow(url, options = {}) {
    const { forceNew = false } = options;
    const lang = currentLang || 'zh_CN';

    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.tabs) {
            if (forceNew) {
                await resetHyperlinkSpecificWindowId();
            }

            // 检查窗口是否存在
            if (hyperlinkSpecificWindowId) {
                try {
                    const win = await chrome.windows.get(hyperlinkSpecificWindowId, { populate: false });
                    if (win && win.id) {
                        // 在现有窗口中打开新标签
                        const tab = await chrome.tabs.create({
                            url,
                            windowId: hyperlinkSpecificWindowId,
                            active: true
                        });
                        await chrome.windows.update(hyperlinkSpecificWindowId, { focused: true });
                        const reg = await readHyperlinkWindowRegistry();
                        const entry = reg.find(e => e.windowId === hyperlinkSpecificWindowId);
                        const num = entry ? entry.number : 1;
                        const label = (currentLang || 'zh_CN') === 'zh_CN' ? `超链接-${num}` : `Hyperlink-${num}`;
                        await saveTabSourceLabel(tab.id, label);
                        ;
                        return;
                    }
                } catch (error) {
                    console.warn('[超链接] 窗口已失效，创建新窗口');
                    await resetHyperlinkSpecificWindowId();
                }
            }

            // 创建新窗口，使用独立的注册表系统
            const nextNumber = await allocateNextHyperlinkWindowNumber();
            const windowTitle = `Hyperlink ${nextNumber}`;

            // 构建window_marker.html的URL（用于标识窗口）
            let markerUrl = null;
            try {
                const params = new URLSearchParams();
                params.set('t', String(nextNumber));
                params.set('type', 'hyperlink'); // 标识这是超链接系统的窗口
                params.set('mode', 'same-window');
                if (chrome.runtime && chrome.runtime.getURL) {
                    markerUrl = chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`);
                }
            } catch (_) { }

            // 先创建窗口，默认打开目标URL
            const created = await chrome.windows.create({
                url: url,
                focused: true
            });
            await setHyperlinkSpecificWindowId(created.id);

            const firstTabId = created?.tabs?.[0]?.id ?? null;
            if (firstTabId != null) {
                const label = (currentLang || 'zh_CN') === 'zh_CN' ? `超链接-${nextNumber}` : `Hyperlink-${nextNumber}`;
                await saveTabSourceLabel(firstTabId, label);
            }

            // 注册到超链接窗口注册表
            await registerHyperlinkWindow(created.id, nextNumber);

            // 创建书签画布标识tab（固定在第一位）
            if (markerUrl) {
                try {
                    const markerTab = await chrome.tabs.create({
                        windowId: created.id,
                        url: markerUrl,
                        pinned: false,
                        active: false
                    });
                    // 移动到第一位
                    if (markerTab && markerTab.id != null) {
                        await chrome.tabs.move(markerTab.id, { index: 0 });
                    }
                } catch (markerError) {
                    console.warn('[超链接] 创建标识标签失败:', markerError);
                }
            }

            ;
        } else {
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[超链接] 特定窗口打开失败:', error);
        window.open(url, '_blank');
    }
}

// 超链接：同窗特定组打开（Group名："超链接" / "Hyperlink"）
async function openHyperlinkInSameWindowSpecificGroup(url) {
    const lang = currentLang || 'zh_CN';
    const groupTitle = lang === 'zh_CN' ? '超链接' : 'Hyperlink';

    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.windows) {
        window.open(url, '_blank');
        return;
    }

    try {
        // 确保窗口存在
        let windowId = hyperlinkSameWindowSpecificGroupWindowId;
        if (!windowId) {
            const currentWindow = await chrome.windows.getCurrent({ populate: false });
            windowId = currentWindow.id;
            hyperlinkSameWindowSpecificGroupWindowId = windowId;
        }

        // 检查窗口是否有效
        try {
            await chrome.windows.get(windowId, { populate: false });
        } catch (error) {
            const currentWindow = await chrome.windows.getCurrent({ populate: false });
            windowId = currentWindow.id;
            hyperlinkSameWindowSpecificGroupWindowId = windowId;
        }

        // 检查作用域中的分组
        const scopeEntry = hyperlinkSameWindowSpecificGroupScopes['_hyperlink'];
        let groupId = null;

        if (scopeEntry && scopeEntry.windowId === windowId && Number.isInteger(scopeEntry.groupId)) {
            try {
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(scopeEntry.groupId);
                }
                groupId = scopeEntry.groupId;
            } catch (error) {
                console.warn('[超链接] 分组已失效');
                groupId = null;
            }
        }

        // 创建标签
        const tab = await chrome.tabs.create({
            url,
            windowId: windowId,
            active: true
        });

        if (chrome.tabs.group && chrome.tabGroups && chrome.tabGroups.update) {
            if (groupId) {
                // 复用现有分组
                await chrome.tabs.group({
                    tabIds: [tab.id],
                    groupId: groupId
                });
            } else {
                // 创建新分组
                groupId = await chrome.tabs.group({ tabIds: [tab.id] });
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    collapsed: false
                });

                // 保存到作用域
                hyperlinkSameWindowSpecificGroupScopes['_hyperlink'] = {
                    groupId: groupId,
                    windowId: windowId,
                    updatedAt: Date.now()
                };
            }
        }

        ;
    } catch (error) {
        console.error('[超链接] 同窗特定组打开失败:', error);
        window.open(url, '_blank');
    }
}


// =================================================================================
// V. SELECTION MODE & BATCH PANEL FOUNDATIONS (选择模式与批量面板基础设施)
// =================================================================================

let clipboardOperation = null; // 'cut' | 'copy'
let selectedNodes = new Set(); // 多选节点集合
let selectedNodeMeta = new Map(); // 节点元信息：nodeId -> { treeType, sectionId }
let lastClickedNode = null; // 上次点击的节点（用于Shift选择）
let lastClickedElement = null; // 上次点击的元素（用于永久栏目副本定位）
let selectionSnapshot = new Set(); // 范围选择快照
let selectMode = false; // 是否处于Select模式
let lastKeyboardCanvasPointer = null; // 鼠标在画布中的最近位置，供对象快捷键定位栏目
try {
    Object.defineProperty(window, 'selectMode', {
        get: () => selectMode,
        set: (v) => { selectMode = v; },
        configurable: true
    });
} catch (_) {}

function getPermanentColumnKeyFromElement(el) {
    if (!el || !el.closest) return null;
    const section = el.closest('.permanent-bookmark-section');
    if (!section) return null;
    try {
        const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionContext === 'function'
            ? window.CanvasProtocolBridge
            : null;
        if (protocolBridge) {
            const context = protocolBridge.resolvePermanentSectionContext(section);
            if (context) {
                if (context.isCopy && context.copyId) return String(context.copyId);
                return 'origin';
            }
        }
    } catch (_) { }
    const isCopy = section.classList && section.classList.contains('permanent-section-copy');
    if (!isCopy) return 'origin';
    const copyId = section.dataset && section.dataset.permanentSectionCopyId ? String(section.dataset.permanentSectionCopyId) : '';
    return copyId || 'origin';
}

function findPermanentColumnElementByKey(key) {
    const k = key || 'origin';
    try {
        const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionElement === 'function'
            ? window.CanvasProtocolBridge
            : null;
        if (protocolBridge) {
            const resolved = protocolBridge.resolvePermanentSectionElement(k === 'origin' ? null : k);
            if (resolved) return resolved;
        }
    } catch (_) { }
    if (k === 'origin') {
        return document.querySelector('.permanent-bookmark-section:not(.permanent-section-copy)') ||
            document.getElementById('permanentSection') ||
            document.querySelector('.permanent-bookmark-section');
    }
    try {
        return document.querySelector(`.permanent-bookmark-section.permanent-section-copy[data-permanent-section-copy-id="${CSS.escape(k)}"]`);
    } catch (_) {
        return document.querySelector('.permanent-bookmark-section.permanent-section-copy');
    }
}

// Select 模式蓝框：按栏目卡片分别显示
let selectModeOverlayObserver = null;

// Select 模式：全局事件捕获（用于跨栏目多选，且不阻塞滚动/拖拽）
let selectModeGlobalClickHandler = null;
let selectModeGlobalContextMenuHandler = null;
let selectModeGlobalDragEndHandler = null;
let selectModeJustDraggedUntil = 0;

function __isSelectModeUiTarget(target) {
    if (!target || !target.closest) return false;
    return !!(
        target.closest('#batch-action-panel') ||
        target.closest('#batch-panel-restore-btn') ||
        target.closest('#batch-toolbar') ||
        target.closest('#bookmark-context-menu') ||
        target.closest('#bookmark-context-submenu') ||
        target.closest('.manual-selector-overlay') ||
        target.closest('.manual-selector-dialog') ||
        target.closest('#canvasManageModal') ||
        target.closest('#canvasImportDialog') ||
        target.closest('.import-dialog')
    );
}

// 和右键“添加/粘贴”菜单共用同一类栏目空白区域：
// 书签树、永久栏目 body、临时栏目 body 或树视图容器。
// 不把栏目标题、按钮或节点本身算作空白。
function __isBookmarkTreeBlankTarget(target) {
    if (!target || !target.closest) return false;
    if (!target.closest('.permanent-bookmark-section, .temp-canvas-node')) return false;
    if (!target.closest('.bookmark-tree, .temp-bookmark-tree, .permanent-section-body, .temp-node-body, .tree-view-container')) return false;
    if (target.closest('.tree-item[data-node-id]')) return false;
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"], label')) return false;
    return true;
}

let pendingCutCancelPromise = null;
let dismissedCutMarkIdentity = '';
let dismissedCutMarkCardKeys = new Set();

function getBookmarkCardKey(section) {
    if (!section || !section.classList) return '';
    if (section.classList.contains('temp-canvas-node')) {
        return `temp:${String(section.dataset && section.dataset.sectionId || '')}`;
    }
    if (section.classList.contains('permanent-bookmark-section')) {
        return `permanent:${getPermanentColumnKeyFromElement(section) || 'origin'}`;
    }
    return '';
}

function syncDismissedCutMarkIdentity() {
    const identity = bookmarkClipboard && bookmarkClipboard.action === 'cut'
        ? String(bookmarkClipboard.entryId || bookmarkClipboard.timestamp || '')
        : '';
    if (identity !== dismissedCutMarkIdentity) {
        dismissedCutMarkIdentity = identity;
        dismissedCutMarkCardKeys.clear();
    }
    return identity;
}

function dismissCutMarksInBookmarkCard(section) {
    if (!section || !bookmarkClipboard || bookmarkClipboard.action !== 'cut') return;
    syncDismissedCutMarkIdentity();
    const cardKey = getBookmarkCardKey(section);
    if (cardKey) dismissedCutMarkCardKeys.add(cardKey);
    section.querySelectorAll('.tree-item.cut-marked').forEach((node) => node.classList.remove('cut-marked'));
}

function deselectBookmarkCard(section) {
    if (!section || !section.querySelectorAll) return;
    const ids = new Set();
    section.querySelectorAll('.tree-item.selected[data-node-id]').forEach((node) => {
        if (node.dataset.nodeId) ids.add(node.dataset.nodeId);
        node.classList.remove('selected');
    });
    ids.forEach((nodeId) => {
        // 同一永久书签可能同时出现在主栏目和副本中；其它卡片仍选中时保留全局选择数据。
        if (!document.querySelector(`.tree-item.selected[data-node-id="${CSS.escape(nodeId)}"]`)) {
            selectedNodes.delete(nodeId);
            selectedNodeMeta.delete(nodeId);
        }
    });
    if (lastClickedElement && !lastClickedElement.classList.contains('selected')) {
        lastClickedNode = null;
        lastClickedElement = null;
    }
    selectionSnapshot = new Set(selectedNodes);
    if (selectedNodes.size === 0) lastBatchSelectionInfo = null;
    updateBatchToolbar();
    updateBatchPanelCount();
}

function clearBookmarkCardTransientState(target) {
    const section = target && target.closest
        ? target.closest('.permanent-bookmark-section, .temp-canvas-node')
        : null;
    if (!section) return;
    deselectBookmarkCard(section);
    dismissCutMarksInBookmarkCard(section);
}

// 取消待剪切状态：橙色标记要立即消失，随后同步持久剪贴板，避免其它页面再把它恢复。
function cancelPendingBookmarkCut() {
    if (!bookmarkClipboard || bookmarkClipboard.action !== 'cut') return Promise.resolve(false);
    const entryId = bookmarkClipboard.entryId || null;
    bookmarkClipboard.__canvasClipboardCancelled = true;
    unmarkCutNode();
    bookmarkClipboard = null;
    clipboardOperation = null;
    try { hidePasteButton(); } catch (_) {}

    if (!window.CanvasClipboard || typeof window.CanvasClipboard.cancelActiveCut !== 'function') {
        return Promise.resolve(true);
    }
    if (!pendingCutCancelPromise) {
        pendingCutCancelPromise = Promise.resolve(window.CanvasClipboard.cancelActiveCut(entryId))
            .catch((error) => {
                console.warn('[剪切] 取消待剪切状态失败:', error);
                return false;
            })
            .finally(() => { pendingCutCancelPromise = null; });
    }
    return pendingCutCancelPromise;
}

// 普通剪切不一定会进入批量选择模式；因此栏目书签树的空白点击也要能取消它。
document.addEventListener('click', (event) => {
    const target = event && event.target;
    if (__isBookmarkTreeBlankTarget(target)) {
        clearBookmarkCardTransientState(target);
    }
}, true);

function bindSelectModeGlobalHandlers() {
    if (selectModeGlobalClickHandler || selectModeGlobalContextMenuHandler || selectModeGlobalDragEndHandler) return;

    selectModeGlobalClickHandler = (e) => {
        if (!selectMode) return;
        const target = e && e.target;
        if (!target || __isSelectModeUiTarget(target)) return;
        if (Date.now() < selectModeJustDraggedUntil) return;

        const treeItem = target.closest ? target.closest('.tree-item[data-node-id]') : null;
        if (!treeItem) {
            // 只清除当前栏目卡片的选择与待剪切视觉状态，不影响其它栏目。
            if (__isBookmarkTreeBlankTarget(target)) {
                clearBookmarkCardTransientState(target);
            }
            return;
        }

        // 允许折叠按钮（及其右侧一定范围）触发展开/收起，不视为选择
        const toggle = treeItem.querySelector ? treeItem.querySelector('.tree-toggle') : null;
        if (toggle) {
            const toggleRect = toggle.getBoundingClientRect();
            const nearToggle = (
                e.clientX >= toggleRect.left &&
                e.clientX <= (toggleRect.right + 30) &&
                e.clientY >= toggleRect.top &&
                e.clientY <= toggleRect.bottom
            );
            if ((target.closest && target.closest('.tree-toggle')) || nearToggle) {
                return;
            }
        }

        const nodeId = treeItem.dataset ? treeItem.dataset.nodeId : null;
        if (!nodeId) return;

        const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        if (isMac && e.ctrlKey) return; // macOS 下 Ctrl+Click 视为右键，不作选择拦截

        // 如果是系统默认的打开新标签页修饰键（Cmd+Click在Mac上，或者Ctrl/Cmd+Click在其他系统上），且没有按下Alt/Shift，则不拦截，由浏览器默认处理
        const isDefaultModifierClick = isMac ? (e.metaKey && !e.altKey && !e.shiftKey) : ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey);
        if (isDefaultModifierClick) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        // Option/Alt + Click: 多选
        if (e.altKey) {
            toggleSelectItem(nodeId, treeItem);
            lastClickedNode = nodeId;
            return;
        }

        // Shift + Click: 范围选择
        if (e.shiftKey && lastClickedNode) {
            selectRange(lastClickedNode, nodeId, treeItem);
            return;
        }

        // 普通点击: 切换选择
        toggleSelectItem(nodeId, treeItem);
        lastClickedNode = nodeId;
    };

    selectModeGlobalContextMenuHandler = (e) => {
        if (!selectMode) return;
        if (!selectedNodes || selectedNodes.size === 0) return;
        const target = e && e.target;
        if (!target || __isSelectModeUiTarget(target)) return;

        // Select 模式下：允许在具体节点上继续使用原右键菜单（例如“粘贴”）
        const treeItem = target.closest ? target.closest('.tree-item[data-node-id]') : null;
        if (treeItem) return;

        // 允许卡片内部空白区域、栏目body区域、以及画布空白区域触发原有的右键空白菜单（用于粘贴、添加、此位置导入等操作）
        const isBlankArea = !!(
            target.closest('.bookmark-tree') ||
            target.closest('.permanent-section-body') ||
            target.closest('.temp-node-body') ||
            target.closest('.canvas-workspace') ||
            target.closest('.tree-view-container')
        );
        if (isBlankArea) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        showBatchContextMenu(e);
    };

    // 防止拖拽结束后触发 click 导致误切换选择
    selectModeGlobalDragEndHandler = (e) => {
        if (!selectMode) return;
        const target = e && e.target;
        const treeItem = target && target.closest ? target.closest('.tree-item[data-node-id]') : null;
        if (!treeItem) return;
        selectModeJustDraggedUntil = Date.now() + 350;
    };

    document.addEventListener('click', selectModeGlobalClickHandler, true);
    document.addEventListener('contextmenu', selectModeGlobalContextMenuHandler, true);
    document.addEventListener('dragend', selectModeGlobalDragEndHandler, true);
}

function unbindSelectModeGlobalHandlers() {
    if (selectModeGlobalClickHandler) {
        document.removeEventListener('click', selectModeGlobalClickHandler, true);
        selectModeGlobalClickHandler = null;
    }
    if (selectModeGlobalContextMenuHandler) {
        document.removeEventListener('contextmenu', selectModeGlobalContextMenuHandler, true);
        selectModeGlobalContextMenuHandler = null;
    }
    if (selectModeGlobalDragEndHandler) {
        document.removeEventListener('dragend', selectModeGlobalDragEndHandler, true);
        selectModeGlobalDragEndHandler = null;
    }
    selectModeJustDraggedUntil = 0;
}

// 全局快捷键/修饰键点击监听器：用于在未进入选择模式时，通过 Cmd/Ctrl/Shift + 点击触发选择模式
document.addEventListener('click', (e) => {
    if (typeof selectMode !== 'undefined' && selectMode) return; // 已进入选择模式，由 selectModeGlobalClickHandler 处理

    const hasModifier = e.altKey || e.shiftKey;
    if (!hasModifier) return; // 没有按下修饰键

    const target = e.target;
    if (!target) return;

    // 排除批量操作面板等 UI
    if (typeof __isSelectModeUiTarget === 'function' && __isSelectModeUiTarget(target)) return;

    const treeItem = target.closest ? target.closest('.tree-item[data-node-id]') : null;
    if (!treeItem) return;

    // 允许折叠按钮（及其右侧一定范围）触发展开/收起，不视为选择
    const toggle = treeItem.querySelector ? treeItem.querySelector('.tree-toggle') : null;
    if (toggle) {
        const toggleRect = toggle.getBoundingClientRect();
        const nearToggle = (
            e.clientX >= toggleRect.left &&
            e.clientX <= (toggleRect.right + 30) &&
            e.clientY >= toggleRect.top &&
            e.clientY <= toggleRect.bottom
        );
        if ((target.closest && target.closest('.tree-toggle')) || nearToggle) {
            return;
        }
    }

    const nodeId = treeItem.dataset ? treeItem.dataset.nodeId : null;
    if (!nodeId) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    ;
    if (typeof enterSelectMode === 'function') {
        enterSelectMode();
    }

    if (e.shiftKey && typeof lastClickedNode !== 'undefined' && lastClickedNode) {
        if (typeof selectRange === 'function') {
            selectRange(lastClickedNode, nodeId, treeItem);
        }
    } else {
        if (typeof toggleSelectItem === 'function') {
            toggleSelectItem(nodeId, treeItem);
        }
        lastClickedNode = nodeId;
    }
}, true); // 使用捕获阶段


const BATCH_PANEL_STATE_MAP_KEY = 'batchPanelStateMap';
const BATCH_PANEL_LEGACY_KEY = 'batchPanelState';
const BATCH_PANEL_GLOBAL_STATE_KEY = 'batchPanelGlobalState';
const BATCH_PANEL_RESTORE_DOCK_KEY = 'batchPanelRestoreDockV2';
const BATCH_PANEL_MINIMIZED_KEY = 'batchPanelMinimizedV1';
const BATCH_PANEL_RESTORE_DRAG_ACTIVATE_THRESHOLD = 8;
const BATCH_PANEL_RESTORE_HINT_HOLD_DELAY_MS = 160;
const BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD = 42;
const BATCH_PANEL_RESTORE_CORNER_SWITCH_THRESHOLD = 0.08;
const BATCH_PANEL_RESTORE_CORNER_SWITCH_CONFIRM_DISTANCE = 14;
const PERMANENT_SECTION_ANCHOR_ID = 'permanent-root';
let currentBatchPanelAnchorInfo = null; // 当前批量面板定位信息
let lastBatchSelectionInfo = null; // 最近一次选择所属栏目

// 批量面板默认尺寸：固定宽度，不跟随画布缩放。
// 纵向高度按内容自适应；仅用户手动调整的高度才持久化。
const BATCH_PANEL_VERTICAL_DEFAULT_WIDTH = 200;
const BATCH_PANEL_VERTICAL_LEGACY_DEFAULT_HEIGHT = 450;
const BATCH_PANEL_HORIZONTAL_DEFAULT_WIDTH = 860;

function getBatchPanelGlobalState() {
    try {
        const raw = localStorage.getItem(BATCH_PANEL_GLOBAL_STATE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                // Older versions persisted their automatic vertical height as a
                // fixed value, which can clip the final command group. Treat
                // those known defaults as auto height instead.
                if (parsed.vertical && (
                    parsed.vertical.height === 700 ||
                    parsed.vertical.height === BATCH_PANEL_VERTICAL_LEGACY_DEFAULT_HEIGHT
                )) {
                    parsed.vertical.height = null;
                }
                return parsed;
            }
        }
    } catch (e) {
        console.error('[批量面板] 读取全局状态失败:', e);
    }
    return {
        vertical: {
            width: BATCH_PANEL_VERTICAL_DEFAULT_WIDTH,
            height: null,
            manualPosition: false,
            left: null,
            top: null
        },
        horizontal: {
            width: BATCH_PANEL_HORIZONTAL_DEFAULT_WIDTH,
            height: null,
            manualPosition: false,
            left: null,
            top: null
        }
    };
}

function saveBatchPanelGlobalState(state) {
    try {
        localStorage.setItem(BATCH_PANEL_GLOBAL_STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('[批量面板] 保存全局状态失败:', e);
    }
}

function clampValue(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (min > max) return min;
    return Math.min(Math.max(value, min), max);
}

function getStoredBatchPanelLayout() {
    try {
        const isSidePanel = __isSidePanelModeForAdd();
        const storageKey = isSidePanel ? 'batchPanelLayout_sidepanel' : 'batchPanelLayout_page';
        const raw = localStorage.getItem(storageKey);

        if (raw === 'horizontal') return 'horizontal';
        if (raw === 'vertical') return 'vertical';

        return isSidePanel ? 'vertical' : 'horizontal';
    } catch (_) {
        return 'vertical';
    }
}

let batchHelpPopoverEl = null;

function __ensureBatchHelpAnchors() {
    const panel = document.getElementById('batch-action-panel');
    if (!panel) return;
    const add = (action, n) => {
        panel.querySelectorAll(`.context-menu-item[data-action="${action}"]`).forEach((el) => {
            if (!el || !el.appendChild) return;
            if (el.querySelector && el.querySelector('.batch-help-anchor')) return;
            const badge = document.createElement('span');
            badge.className = 'batch-help-anchor';
            badge.textContent = String(n);
            el.appendChild(badge);
            el.classList.add('has-help-badge');
        });
    };

    // 1) Open / Group / New Window / Manual Selection
    add('batch-open', 1);
    add('batch-open-tab-group', 1);
    add('batch-open-new-window', 1);
    add('batch-open-manual-selection', 1);
    // 2) Temp / Merge
    add('batch-to-temp-section', 2);
    add('batch-merge-folder', 2);
    // 3) Copy / Cut
    add('batch-copy', 3);
    add('batch-cut', 3);
    // 4) Export
    add('batch-export-html', 4);
    add('batch-export-json', 4);
}

function getBatchHelpHtml(lang) {
    if ((lang || 'zh_CN') === 'zh_CN') {
        return `
<div class="batch-help-popover-title">说明</div>

<div class="batch-help-card batch-help-card-overview" id="batch-help-card-overview">
  <div class="batch-help-card-title">选择规则</div>
  <div class="batch-help-line">操作逻辑遵循常见 PC 文件管理方式。选择项目时使用 <strong class="batch-help-key-emphasis">Alt / Option / Shift</strong>；不使用 Ctrl / Command，以避免与画布快捷键冲突。</div>
  <div class="batch-help-line"><u>点击当前栏目内、书签树项目之外的空白处（包括四周边缘和书签树下方），会清除该栏目全部高亮。</u>全局剪贴板内容不受影响。</div>
</div>

<div class="batch-help-card" id="batch-help-card-open">
  <div class="batch-help-card-title"><span class="batch-help-badge">1</span>打开 / 标签组 / 新窗口 / 手动选择</div>
  <div class="batch-help-line">选中书签：直接打开。</div>
  <div class="batch-help-line">选中文件夹：只处理<strong>直接子书签</strong>（一层），不包含子文件夹里的书签。</div>
</div>

<div class="batch-help-card" id="batch-help-card-temp-merge">
  <div class="batch-help-card-title"><span class="batch-help-badge">2</span>临时栏目 / 合并</div>
  <div class="batch-help-line">临时栏目：把当前选择汇总成一个新的临时栏目，方便临时整理。</div>
  <div class="batch-help-line">合并：会在根目录下生成一个新文件夹并合并（临时栏目则在当前栏目内），名称默认为当前时间戳（例如：${formatTimestampForTitle()}）。</div>
  <div class="batch-help-line">合并仅支持单张卡片，或永久栏目与其副本的组合。</div>
</div>

<div class="batch-help-card" id="batch-help-card-copy-cut">
  <div class="batch-help-card-title"><span class="batch-help-badge">3</span>复制 / 剪切</div>
  <div class="batch-help-line">复制/剪切会写入剪贴板；可在目标文件夹上<strong>右键</strong>选择“粘贴”，也可用 <strong>Ctrl / Command + V</strong> 按光标位置粘贴。</div>
  <div class="batch-help-line">文件夹会按结构复制/剪切（包含子文件夹）。</div>
  <div class="batch-help-shortcuts" aria-label="通用快捷键">
    <div class="batch-help-shortcuts-title">通用快捷键（批量模式）</div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>A</kbd></span><span>选中光标所在栏目中的全部书签/文件夹</span></div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>X</kbd></span><span>剪切已选项目</span></div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>C</kbd></span><span>复制已选项目</span></div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>V</kbd></span><span class="batch-help-shortcut-action">粘贴到光标所在位置<button class="batch-help-pointer-info-btn" type="button" data-batch-help-pointer-info aria-expanded="false" aria-controls="batch-help-pointer-info" title="查看光标落点说明"><i class="fas fa-info-circle"></i></button></span></div>
    <div class="batch-help-pointer-info" id="batch-help-pointer-info" hidden>
      <div class="batch-help-pointer-info-title">光标落点</div>
      <ul><li>文件夹：粘贴到文件夹内；书签：粘贴在同级位置下方。</li><li>临时栏目空白：粘贴到该栏目根部；永久栏目空白：粘贴到浏览器书签栏根部。</li><li>画布空白：在光标处新建“粘贴”临时栏目后落地。</li><li>仅画布内的书签/文件夹剪贴板会被接管；文本仍使用浏览器原生粘贴。</li></ul>
    </div>
  </div>
</div>

<div class="batch-help-card" id="batch-help-card-export">
  <div class="batch-help-card-title"><span class="batch-help-badge">4</span>导出 HTML / JSON</div>
  <div class="batch-help-line">选中文件夹：会导出该文件夹下的<strong>全部子书签</strong>（包含子文件夹，递归）。</div>
</div>
`;
    }
    return `
<div class="batch-help-popover-title">Help</div>

<div class="batch-help-card batch-help-card-overview" id="batch-help-card-overview">
  <div class="batch-help-card-title">Selection Rules</div>
  <div class="batch-help-line">The interaction follows familiar desktop file-management behavior. Use <strong class="batch-help-key-emphasis">Alt / Option / Shift</strong> when selecting items; Ctrl / Command is reserved to avoid conflicts with canvas shortcuts.</div>
  <div class="batch-help-line"><u>Clicking blank space inside the current card but outside its bookmark-tree items, including the surrounding edges and space below the tree, clears every highlight in that card.</u> The global clipboard remains unchanged.</div>
</div>

<div class="batch-help-card" id="batch-help-card-open">
  <div class="batch-help-card-title"><span class="batch-help-badge">1</span>Open / Tab Group / New Window / Manual Select</div>
  <div class="batch-help-line">Bookmark: opens directly.</div>
  <div class="batch-help-line">Folder: applies to <strong>direct child bookmarks</strong> only (one level), not bookmarks inside subfolders.</div>
</div>

<div class="batch-help-card" id="batch-help-card-temp-merge">
  <div class="batch-help-card-title"><span class="batch-help-badge">2</span>Temp Section / Merge</div>
  <div class="batch-help-line">Temp Section: collects current selection into a new temporary section for quick organization.</div>
  <div class="batch-help-line">Merge: creates a new folder in the root directory (or within the current section for temp items), named by current timestamp by default (e.g. ${formatTimestampForTitle()}).</div>
  <div class="batch-help-line">Merge supports one card only, or a permanent section together with its copies.</div>
</div>

<div class="batch-help-card" id="batch-help-card-copy-cut">
  <div class="batch-help-card-title"><span class="batch-help-badge">3</span>Copy / Cut</div>
  <div class="batch-help-line">Copy/Cut writes into clipboard; <strong>right-click</strong> the target folder and Paste, or use <strong>Ctrl / Command + V</strong> to paste at the cursor location.</div>
  <div class="batch-help-line">Folders preserve structure (recursive).</div>
  <div class="batch-help-shortcuts" aria-label="General shortcuts">
    <div class="batch-help-shortcuts-title">General Shortcuts (Batch Mode)</div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>A</kbd></span><span>Select all bookmark/folder items in the card under the cursor</span></div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>X</kbd></span><span>Cut selected items</span></div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>C</kbd></span><span>Copy selected items</span></div>
    <div class="batch-help-shortcut-row"><span class="batch-help-shortcut-keys"><kbd>Ctrl</kbd><span>/</span><kbd>Command</kbd><span>+</span><kbd>V</kbd></span><span class="batch-help-shortcut-action">Paste at the cursor location<button class="batch-help-pointer-info-btn" type="button" data-batch-help-pointer-info aria-expanded="false" aria-controls="batch-help-pointer-info" title="Show cursor placement rules"><i class="fas fa-info-circle"></i></button></span></div>
    <div class="batch-help-pointer-info" id="batch-help-pointer-info" hidden>
      <div class="batch-help-pointer-info-title">Cursor placement</div>
      <ul><li>Folder: paste inside it. Bookmark: paste below it at the same level.</li><li>Blank temp card: paste at its root. Blank permanent card: paste at the browser Bookmarks Bar root.</li><li>Blank canvas: creates a new “Paste” temp card at the cursor, then pastes there.</li><li>Only structured bookmark/folder clipboard content is handled here; text keeps native browser paste behavior.</li></ul>
    </div>
  </div>
</div>

<div class="batch-help-card" id="batch-help-card-export">
  <div class="batch-help-card-title"><span class="batch-help-badge">4</span>Export HTML / JSON</div>
  <div class="batch-help-line">Folder: exports <strong>all bookmarks</strong> inside (recursive into subfolders).</div>
</div>
`;
}

function hideBatchHelpPopover() {
    if (!batchHelpPopoverEl) return;
    batchHelpPopoverEl.remove();
    batchHelpPopoverEl = null;

    // Remove button-side numeric anchors and classes
    try {
        document.querySelectorAll('#batch-action-panel .context-menu-item .batch-help-anchor').forEach((el) => el.remove());
        document.querySelectorAll('#batch-action-panel .context-menu-item.has-help-badge').forEach((el) => el.classList.remove('has-help-badge'));
    } catch (_) { }
}

function showBatchHelpPopover() {
    const panel = document.getElementById('batch-action-panel');
    if (!panel) return;
    const header = panel.querySelector('#batch-panel-header');
    if (!header) return;

    if (!batchHelpPopoverEl) {
        const lang = currentLang || 'zh_CN';
        const el = document.createElement('div');
        el.className = 'batch-help-popover';
        el.id = 'batch-help-popover-floating';
        el.innerHTML = `
            <div class="batch-help-popover-inner">
                <button class="batch-help-popover-close canvas-manage-modal-close" type="button" aria-label="close"><i class="fas fa-times"></i></button>
                <div class="batch-help-popover-body">${getBatchHelpHtml(lang)}</div>
            </div>
        `;
        getOverlayContainer().appendChild(el);
        batchHelpPopoverEl = el;

        // Add numeric anchors on buttons while help is visible
        try { __ensureBatchHelpAnchors(); } catch (_) { }

        const closeBtn = el.querySelector('.batch-help-popover-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                hideBatchHelpPopover();
            });
        }
        el.querySelectorAll('[data-batch-help-pointer-info]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const info = el.querySelector('.batch-help-pointer-info');
                if (!info) return;
                const willOpen = info.hidden;
                info.hidden = !willOpen;
                btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });
        });
        const onDocClick = (ev) => {
            if (!batchHelpPopoverEl) return;
            const t = ev && ev.target;
            if (!t) return;
            if (t.closest && (t.closest('#batch-help-popover-floating') || t.closest('.batch-panel-help-btn'))) return;
            hideBatchHelpPopover();
        };
        document.addEventListener('click', onDocClick, true);
        el.dataset.boundDocClick = 'true';
    }

    // Prefer:
    // - vertical layout: on the right side, vertically centered
    // - horizontal layout: above the panel, horizontally centered
    const panelRect = panel.getBoundingClientRect();
    const viewportW = window.innerWidth || 1200;
    const viewportH = window.innerHeight || 800;
    const margin = 16;
    const gap = 10;

    const isHorizontalLayout = panel.classList && panel.classList.contains('horizontal-batch-layout');

    const width = Math.min(520, Math.max(300, Math.floor(panelRect.width * (isHorizontalLayout ? 0.72 : 0.98))));
    batchHelpPopoverEl.style.width = `${width}px`;
    batchHelpPopoverEl.style.left = `${Math.max(margin, panelRect.right + gap)}px`;
    batchHelpPopoverEl.style.top = `${Math.max(margin, panelRect.top)}px`;

    requestAnimationFrame(() => {
        if (!batchHelpPopoverEl) return;
        const popRect = batchHelpPopoverEl.getBoundingClientRect();

        const clampLeft = (x) => clampValue(x, margin, Math.max(margin, viewportW - popRect.width - margin));
        const clampTop = (y) => clampValue(y, margin, Math.max(margin, viewportH - popRect.height - margin));

        let left;
        let top;

        if (isHorizontalLayout) {
            // Horizontal: prefer above, if no space then below.
            left = clampLeft(panelRect.left + (panelRect.width - popRect.width) / 2);
            const aboveTop = panelRect.top - popRect.height - gap;
            const belowTop = panelRect.bottom + gap;
            top = (aboveTop >= margin) ? aboveTop : belowTop;
            top = clampTop(top);
        } else {
            // Vertical: prefer right, if no space then left.
            const rightLeft = panelRect.right + gap;
            const leftLeft = panelRect.left - popRect.width - gap;
            const hasRight = (rightLeft + popRect.width) <= (viewportW - margin);
            const hasLeft = leftLeft >= margin;
            if (hasRight) {
                left = rightLeft;
            } else if (hasLeft) {
                left = leftLeft;
            } else {
                left = (viewportW - popRect.width) / 2;
            }
            left = clampLeft(left);
            top = clampTop(panelRect.top + (panelRect.height - popRect.height) / 2);
        }

        batchHelpPopoverEl.style.left = `${left}px`;
        batchHelpPopoverEl.style.top = `${top}px`;

        // Ensure anchors exist after DOM/layout updates
        try { __ensureBatchHelpAnchors(); } catch (_) { }
    });
}

function toggleBatchHelpPopover() {
    if (batchHelpPopoverEl) {
        hideBatchHelpPopover();
    } else {
        showBatchHelpPopover();
    }
}

function flashBatchActionStatus(action) {
    try {
        const panel = document.getElementById('batch-action-panel');
        if (panel) {
            panel.classList.remove('batch-action-success');
            void panel.offsetWidth;
            panel.classList.add('batch-action-success');
            panel.querySelectorAll(`.context-menu-item[data-action="${action}"]`).forEach((el) => {
                el.classList.remove('action-success');
                // Force reflow to restart animation
                void el.offsetWidth;
                el.classList.add('action-success');
            });
        }
        const toolbar = document.getElementById('batch-toolbar');
        if (toolbar) {
            const btn = toolbar.querySelector(`.batch-btn[data-action="${action}"]`);
            if (btn) {
                btn.classList.remove('action-success');
                void btn.offsetWidth;
                btn.classList.add('action-success');
            }
        }
        setTimeout(() => {
            if (panel) {
                panel.classList.remove('batch-action-success');
                panel.querySelectorAll(`.context-menu-item[data-action="${action}"]`).forEach((el) => el.classList.remove('action-success'));
            }
            if (toolbar) {
                const btn = toolbar.querySelector(`.batch-btn[data-action="${action}"]`);
                if (btn) btn.classList.remove('action-success');
            }
        }, 900);
    } catch (_) { }
}

function getCurrentBatchPanelZoom() {
    // 批量面板尺寸固定：不跟随 CanvasState.zoom / --canvas-scale
    return 1;
}

function computeBatchPanelSizing(anchorRect, zoom, viewportWidth, viewportHeight, margin) {
    const normalizedZoom = clampValue(zoom, 0.25, 2.5);
    const safeViewportWidth = Math.max(viewportWidth || 1280, 320);
    const safeViewportHeight = Math.max(viewportHeight || 720, 320);
    const baseMinWidth = 240;
    const baseMaxWidth = 640;
    const baseMinHeight = 200;
    const baseMaxHeight = safeViewportHeight - margin * 2;
    const baseDefaultWidth = 280;
    const baseDefaultHeight = 360;

    const minWidth = clampValue(baseMinWidth * normalizedZoom, 140, safeViewportWidth - margin * 2);
    const maxWidth = clampValue(baseMaxWidth * normalizedZoom, Math.max(minWidth + 1, 200), safeViewportWidth - margin * 2);
    const minHeight = clampValue(baseMinHeight * normalizedZoom, 140, baseMaxHeight);
    const maxHeight = clampValue(baseMaxHeight, Math.max(minHeight + 1, 140), safeViewportHeight - margin);

    const widthFromAnchor = anchorRect ? anchorRect.width * 0.52 : baseDefaultWidth * normalizedZoom;
    const heightFromAnchor = anchorRect ? Math.max(anchorRect.height - 48, baseMinHeight * 0.75) : baseDefaultHeight * normalizedZoom;

    const defaultWidth = clampValue(widthFromAnchor, minWidth, maxWidth);
    const defaultHeight = clampValue(heightFromAnchor, minHeight, maxHeight);
    const gap = Math.max(8, 12 * normalizedZoom);

    return {
        minWidth,
        maxWidth,
        minHeight,
        maxHeight,
        defaultWidth,
        defaultHeight,
        gap,
        normalizedZoom
    };
}

function applyBatchPanelTransform(panel, options = {}) {
    if (!panel) return;
    const baseTransform = options.baseTransform !== undefined
        ? (options.baseTransform || 'none')
        : (panel.dataset.baseTransform || 'none');
    panel.dataset.baseTransform = baseTransform;
    panel.style.transformOrigin = 'top left';
    panel.style.transform = baseTransform && baseTransform !== 'none' ? baseTransform : 'none';
}

function fitBatchPanelToContent(panel, options = {}) {
    if (!panel) return;
    const delay = options.delay || 0;
    const margin = options.margin || 16;
    const retries = options.retries !== undefined ? options.retries : 2;
    const shrink = options.shrink === true;
    const attemptFit = () => {
        const content = panel.querySelector('.batch-panel-content');
        if (!content) return;
        const viewportWidth = window.innerWidth || 1920;
        const viewportHeight = window.innerHeight || 1080;
        const panelRect = panel.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const widthPadding = panelRect.width - contentRect.width;
        const heightPadding = panelRect.height - contentRect.height;
        let desiredWidth = panelRect.width;
        let desiredHeight = panelRect.height;

        const isHorizontal = panel.classList && panel.classList.contains('horizontal-batch-layout');
        const hasUserWidth = isHorizontal
            ? (panel.dataset.userWidthHorizontal && Number.isFinite(parseFloat(panel.dataset.userWidthHorizontal)))
            : (panel.dataset.userWidthVertical && Number.isFinite(parseFloat(panel.dataset.userWidthVertical)));
        const hasUserHeight = isHorizontal
            ? (panel.dataset.userHeightHorizontal && Number.isFinite(parseFloat(panel.dataset.userHeightHorizontal)))
            : (panel.dataset.userHeightVertical && Number.isFinite(parseFloat(panel.dataset.userHeightVertical)));

        const defaultHorizontalBottom = 80;

        // 贴合内容：避免最后一排按钮下方空白
        if (isHorizontal || shrink) {
            const horizontalWidthCap = isHorizontal
                ? Math.min(1200, viewportWidth - margin * 2)
                : (viewportWidth - margin * 2);
            desiredWidth = hasUserWidth
                ? panelRect.width
                : Math.min(content.scrollWidth + widthPadding, horizontalWidthCap);
        } else {
            if (!hasUserWidth && content.scrollWidth > content.clientWidth + 1) {
                desiredWidth = Math.min(content.scrollWidth + widthPadding, viewportWidth - margin * 2);
            }
        }

        // 高度贴合：如果用户没有手动调整过高度，则始终贴合内容，防止空白或异常滚动条
        if (!hasUserHeight) {
            desiredHeight = Math.min(content.scrollHeight + heightPadding, viewportHeight - margin * 2);
        } else {
            desiredHeight = panelRect.height;
        }

        let minWidth = parseFloat(panel.style.minWidth);
        let maxWidth = parseFloat(panel.style.maxWidth);
        let minHeight = parseFloat(panel.style.minHeight);
        let maxHeight = parseFloat(panel.style.maxHeight);
        if (!Number.isFinite(minWidth)) minWidth = 0;
        if (!Number.isFinite(minHeight)) minHeight = 0;
        if (!Number.isFinite(maxWidth)) maxWidth = viewportWidth - margin * 2;
        if (!Number.isFinite(maxHeight)) maxHeight = viewportHeight - margin * 2;

        desiredWidth = Math.max(minWidth, Math.min(maxWidth, desiredWidth));
        desiredHeight = Math.max(minHeight, Math.min(maxHeight, desiredHeight));

        // 纵向布局：不要为了内容自动变宽（避免切换后“越来越宽”）
        if (!isHorizontal) {
            desiredWidth = panelRect.width;
        }

        if (Math.abs(desiredWidth - panelRect.width) > 1) {
            panel.style.width = `${desiredWidth.toFixed(2)}px`;
        }

        // 横向布局：保持 height=auto，避免底部残留空白
        if (isHorizontal && !hasUserHeight) {
            if (panel.style.height !== 'auto') {
                panel.style.height = 'auto';
            }
        } else {
            if (Math.abs(desiredHeight - panelRect.height) > 1) {
                panel.style.height = `${desiredHeight.toFixed(2)}px`;
            }
        }

        const updatedRect = panel.getBoundingClientRect();
        let left = updatedRect.left;
        let top = updatedRect.top;

        if (isHorizontal && panel.dataset.manualPosition !== 'true') {
            left = clampValue((viewportWidth - desiredWidth) / 2, margin, viewportWidth - desiredWidth - margin);
            top = clampValue(viewportHeight - desiredHeight - defaultHorizontalBottom, margin, viewportHeight - desiredHeight - margin);
        } else {
            if (updatedRect.right > viewportWidth - margin) {
                left = Math.max(margin, viewportWidth - margin - updatedRect.width);
            }
            if (updatedRect.left < margin) {
                left = margin;
            }
            if (updatedRect.bottom > viewportHeight - margin) {
                top = Math.max(margin, viewportHeight - margin - updatedRect.height);
            }
            if (updatedRect.top < margin) {
                top = margin;
            }
        }

        if (left !== updatedRect.left) {
            panel.style.left = `${left}px`;
            panel.style.right = 'auto';
        }
        if (top !== updatedRect.top) {
            panel.style.top = `${top}px`;
            panel.style.bottom = 'auto';
        }
        if (retries > 0) {
            setTimeout(() => fitBatchPanelToContent(panel, {
                delay: 0,
                margin,
                retries: retries - 1
            }), 60);
        }
    };

    if (delay > 0) {
        setTimeout(attemptFit, delay);
    } else {
        requestAnimationFrame(attemptFit);
    }
}

function getBatchPanelAnchorKey(info) {
    if (!info) return 'global';
    const type = info.treeType || 'permanent';
    const sectionId = info.sectionId || (type === 'permanent' ? PERMANENT_SECTION_ANCHOR_ID : 'global');
    return `${type}:${sectionId}`;
}

function isBatchPanelGlobalOrFullscreenMode(info) {
    if (!info) return true;
    try {
        const fullscreenElement = document.fullscreenElement
            || document.webkitFullscreenElement
            || document.mozFullScreenElement
            || document.msFullscreenElement;
        if (fullscreenElement) return true;
        if (document.body && document.body.classList && document.body.classList.contains('canvas-node-maximized-active')) return true;
        if (document.querySelector && document.querySelector('.canvas-node-maximized')) return true;
    } catch (_) { }
    return getBatchPanelAnchorKey(info) === 'global';
}

function findBatchPanelColumnElement(treeType, sectionId) {
    if (treeType === 'temporary' && sectionId) {
        return document.getElementById(sectionId) ||
            document.querySelector(`.temp-canvas-node[data-section-id="${sectionId}"]`) ||
            document.querySelector(`.bookmark-tree[data-section-id="${sectionId}"][data-tree-type="temporary"]`);
    }
    if (treeType === 'permanent') {
        return document.querySelector('.permanent-bookmark-section') ||
            document.getElementById('bookmarkTree')?.closest('.permanent-bookmark-section') ||
            document.getElementById('bookmarkTree');
    }
    return document.getElementById('bookmarkTree') ||
        document.querySelector('.bookmark-tree');
}

function getBatchPanelAnchorInfoFromElement(element) {
    if (!element) return null;

    const tempColumn = element.closest('.temp-canvas-node[data-section-id]');
    if (tempColumn) {
        return {
            treeType: 'temporary',
            sectionId: tempColumn.dataset.sectionId,
            element: tempColumn
        };
    }

    const tempTree = element.closest('.bookmark-tree[data-tree-type="temporary"][data-section-id]');
    if (tempTree) {
        const column = tempTree.closest('.temp-canvas-node[data-section-id]') || tempTree;
        return {
            treeType: 'temporary',
            sectionId: tempTree.dataset.sectionId,
            element: column
        };
    }

    const permanentColumn = element.closest('.permanent-bookmark-section');
    if (permanentColumn) {
        return {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: permanentColumn
        };
    }

    const permanentTree = element.closest('#bookmarkTree, .bookmark-tree[data-tree-type="permanent"]');
    if (permanentTree) {
        const column = permanentTree.closest('.permanent-bookmark-section') || permanentTree;
        return {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: column
        };
    }

    return null;
}

function getBatchPanelAnchorInfoFromSelection() {
    if (lastClickedNode) {
        const clickedElement = document.querySelector(`.tree-item[data-node-id="${lastClickedNode}"]`);
        const info = getBatchPanelAnchorInfoFromElement(clickedElement);
        if (info) return info;
    }

    if (lastBatchSelectionInfo) {
        const element = findBatchPanelColumnElement(lastBatchSelectionInfo.treeType, lastBatchSelectionInfo.sectionId);
        if (element) {
            return {
                treeType: lastBatchSelectionInfo.treeType,
                sectionId: lastBatchSelectionInfo.sectionId,
                element
            };
        }
    }

    const firstSelectedEntry = selectedNodes.values().next();
    if (!firstSelectedEntry.done) {
        const firstSelectedId = firstSelectedEntry.value;
        const nodeElement = document.querySelector(`.tree-item[data-node-id="${firstSelectedId}"]`);
        const info = getBatchPanelAnchorInfoFromElement(nodeElement);
        if (info) return info;
    }

    const permanentColumn = findBatchPanelColumnElement('permanent', PERMANENT_SECTION_ANCHOR_ID);
    if (permanentColumn) {
        return {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: permanentColumn
        };
    }
    return null;
}

function resolveBatchPanelAnchorInfo(event) {
    let info = null;
    if (event && event.target) {
        info = getBatchPanelAnchorInfoFromElement(event.target);
    }

    if (!info && event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
        info = getBatchPanelAnchorInfoFromElement(elementBelow);
    }

    if (!info) {
        info = getBatchPanelAnchorInfoFromSelection();
    }

    if (info && !info.element) {
        info.element = findBatchPanelColumnElement(info.treeType, info.sectionId);
    }

    return info;
}

function rememberBatchSelection(nodeElement) {
    if (!nodeElement) return;
    const treeType = nodeElement.dataset.treeType || 'permanent';
    const sectionId = treeType === 'temporary'
        ? (nodeElement.dataset.sectionId || null)
        : PERMANENT_SECTION_ANCHOR_ID;
    lastBatchSelectionInfo = {
        treeType,
        sectionId
    };
}


// =================================================================================
// VI. CONTEXT MENU INIT, RENDERING, POSITIONING & HYPERLINK MENU (右键菜单初始化、渲染、定位与超链接菜单)
// =================================================================================

// 绑定超链接的右键菜单和左键点击（用于描述区域中的链接）
function attachHyperlinkContextMenu() {
    // 1. 右键菜单：使用事件委托，监听整个文档的右键点击
    document.addEventListener('contextmenu', (e) => {
        const targetEl = (e.target && e.target.nodeType === Node.ELEMENT_NODE)
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!targetEl) return;
        const linkElement = targetEl.closest('a[href]');
        if (!linkElement) return;

        // 检查是否在描述区域内
        const inPermanentTip = linkElement.closest('.permanent-section-tip, .permanent-section-tip-editor');
        const inTempDescription = linkElement.closest('.temp-node-description, .temp-node-description-editor');
        const inMdNodeContent = linkElement.closest('.md-canvas-text, .md-canvas-editor');

        if (inPermanentTip || inTempDescription || inMdNodeContent) {
            // 阻止默认右键菜单
            e.preventDefault();
            e.stopPropagation();

            ;

            // 显示超链接专用菜单
            if (typeof showHyperlinkContextMenu === 'function') {
                showHyperlinkContextMenu(e, linkElement);
            } else {
                console.error('[右键菜单] showHyperlinkContextMenu 函数未定义');
            }
        }
    }, true); // 使用捕获阶段，优先处理

    // 2. 左键点击：按照勾选的默认方式打开
    document.addEventListener('click', async (e) => {
        const targetEl = (e.target && e.target.nodeType === Node.ELEMENT_NODE)
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (!targetEl) return;
        const linkElement = targetEl.closest('a[href]');
        if (!linkElement) return;

        // 检查是否在描述区域内
        const inPermanentTip = linkElement.closest('.permanent-section-tip, .permanent-section-tip-editor');
        const inTempDescription = linkElement.closest('.temp-node-description, .temp-node-description-editor');
        const inMdNodeContent = linkElement.closest('.md-canvas-text, .md-canvas-editor');

        if (inPermanentTip || inTempDescription || inMdNodeContent) {
            // 如果有系统快捷键，走浏览器默认行为
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
            }

            // 阻止默认行为
            e.preventDefault();
            e.stopPropagation();

            const url = linkElement.href;
            const context = {
                url: url,
                title: linkElement.textContent || linkElement.title || url,
                isHyperlink: true,
                treeType: linkElement.closest('.temp-canvas-node') ? 'temporary' : 'permanent',
                sectionId: linkElement.closest('.temp-canvas-node')?.dataset.sectionId || null
            };

            ;

            try {
                await openHyperlinkWithDefaultMode(url, { context });
            } catch (error) {
                console.error('[超链接] 左键打开失败:', error);
                window.open(url, '_blank'); // 失败时回退
            }
        }
    }, true); // 使用捕获阶段

    ;
}

// 初始化右键菜单
function initContextMenu() {
    // 创建菜单容器
    contextMenu = document.createElement('div');
    contextMenu.id = 'bookmark-context-menu';
    contextMenu.className = 'bookmark-context-menu';
    contextMenu.style.display = 'none';

    // 如果默认是横向布局，添加 horizontal-layout 类
    if (contextMenuHorizontal) {
        contextMenu.classList.add('horizontal-layout');
    }

    // 初始挂载，使用时会动态插入到目标节点附近
    getOverlayContainer().appendChild(contextMenu);

    // 创建子菜单容器
    contextSubmenu = document.createElement('div');
    contextSubmenu.id = 'bookmark-context-submenu';
    contextSubmenu.className = 'bookmark-context-menu bookmark-context-submenu';
    contextSubmenu.style.display = 'none';
    getOverlayContainer().appendChild(contextSubmenu);

    tabPlacementSubmenu = document.createElement('div');
    tabPlacementSubmenu.id = 'bookmark-tab-placement-submenu';
    tabPlacementSubmenu.className = 'bookmark-context-menu bookmark-context-submenu is-tab-placement-submenu';
    tabPlacementSubmenu.style.display = 'none';
    getOverlayContainer().appendChild(tabPlacementSubmenu);

    // 绑定超链接的右键菜单
    attachHyperlinkContextMenu();

    // 【修复】添加滚轮事件监听器，允许在菜单上滚动栏目
    // 当鼠标在菜单上滚动时，将事件传递给滚动容器
    const isInfoNoteTextareaWheelTarget = (event) => {
        const target = event && event.target;
        return !!(target && target.closest && target.closest('.info-note-textarea'));
    };

    contextMenu.addEventListener('wheel', (e) => {
        if (isInfoNoteTextareaWheelTarget(e)) return;
        // 查找最近的滚动容器
        const scrollContainer = currentContextNode ? currentContextNode.closest('.permanent-section-body, .temp-node-body') : null;
        if (scrollContainer) {
            // 阻止菜单本身的默认滚动行为（因为菜单不是滚动容器）
            e.preventDefault();

            // 手动触发滚动容器的滚动
            // 使用 deltaY 和 deltaX 来支持纵向和横向滚动
            scrollContainer.scrollTop += e.deltaY;
            scrollContainer.scrollLeft += e.deltaX;

            // 滚动时隐藏子菜单
            hideSubmenu();

            // 注意：不调用 e.stopPropagation()，保持事件冒泡
        }
    }, { passive: false }); // 使用 passive: false 以允许 preventDefault()

    // 监听子菜单的滚轮，如果子菜单滚动，也隐藏或者直接滚动（由于子菜单是 fixed，这里可以同样处理滚动）
    contextSubmenu.addEventListener('wheel', (e) => {
        if (isInfoNoteTextareaWheelTarget(e)) return;
        const scrollContainer = currentContextNode ? currentContextNode.closest('.permanent-section-body, .temp-node-body') : null;
        if (scrollContainer) {
            e.preventDefault();
            scrollContainer.scrollTop += e.deltaY;
            scrollContainer.scrollLeft += e.deltaX;
            hideSubmenu(); // 滚动时关闭子菜单
        }
    }, { passive: false });

    // 点击其他地方关闭菜单（使用捕获阶段，优先处理）
    document.addEventListener('click', (e) => {
        if (isInfoNoteTextareaExternalCloseGuardActive()) return;
        // 如果点击的不是菜单和子菜单内部，并且不是快捷图标本身，关闭菜单
        const clickInMenu = contextMenu && contextMenu.contains(e.target);
        const clickInSubmenu = contextSubmenu && contextSubmenu.contains(e.target);
        const clickInTabPlacementSubmenu = tabPlacementSubmenu && tabPlacementSubmenu.contains(e.target);
        const clickInShortcut = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.tree-trace-icon, .tree-info-icon, .tree-delete-icon, .tree-confirm-icon, .tree-cancel-icon') : null;
        if (!clickInMenu && !clickInSubmenu && !clickInTabPlacementSubmenu && !clickInShortcut) {
            hideContextMenu();
        }
    }, true);  // 使用捕获阶段

    // 监听全局滚动，关闭菜单
    window.addEventListener('scroll', (e) => {
        if (contextMenu && contextMenu.style.display !== 'none') {
            // 如果滚动的容器是包含右键菜单的内部滚动容器（例如永久栏目/临时栏目的滚动体），我们只关闭二级子菜单，让主菜单跟着列表滚动
            if (e.target && e.target.nodeType === Node.ELEMENT_NODE &&
                e.target !== document.body && e.target !== document.documentElement &&
                e.target.contains(contextMenu)) {
                hideSubmenu();
            } else {
                // 如果是其他不相干的容器或者全局窗口滚动，则关闭整个菜单
                if (e.target !== contextMenu
                    && !contextMenu.contains(e.target)
                    && e.target !== contextSubmenu
                    && (!contextSubmenu || !contextSubmenu.contains(e.target))
                    && e.target !== tabPlacementSubmenu
                    && (!tabPlacementSubmenu || !tabPlacementSubmenu.contains(e.target))) {
                    hideContextMenu();
                }
            }
        }
    }, true);

    // 窗口调整大小时，关闭菜单
    window.addEventListener('resize', () => {
        hideContextMenu();
    });

    // 也监听右键事件，关闭已打开的菜单
    document.addEventListener('contextmenu', (e) => {
        // 检查是否是超链接
        const linkElement = (e.target && typeof e.target.closest === 'function') ? e.target.closest('a[href]') : null;
        if (linkElement) {
            const inPermanentTip = linkElement.closest('.permanent-section-tip, .permanent-section-tip-editor');
            const inTempDescription = linkElement.closest('.temp-node-description, .temp-node-description-editor');
            const inMdNodeContent = linkElement.closest('.md-canvas-text, .md-canvas-editor'); // 修复：使用 md-canvas-text

            // 如果是描述区域 of 超链接，不要关闭菜单（由超链接处理器处理）
            if (inPermanentTip || inTempDescription || inMdNodeContent) {
                return;
            }
        }

        // 如果不是在树节点上右键，关闭菜单
        if (!e.target || typeof e.target.closest !== 'function' || !e.target.closest('.tree-item[data-node-id]')) {
            hideContextMenu();
        }
    }, true);

    // ESC键关闭菜单
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContextMenu();
        }
    });

    ;
}

function getNodeContext(node) {
    if (!node) return null;
    const ctx = {
        node,
        nodeId: node.dataset.nodeId,
        nodeTitle: node.dataset.nodeTitle,
        nodeUrl: node.dataset.nodeUrl,
        isFolder: node.dataset.nodeType === 'folder',
        treeType: node.dataset.treeType || 'permanent',
        sectionId: node.dataset.sectionId || null
    };

    // Permanent copy context (for scoped group/window per-copy)
    try {
        const sectionEl = node.closest ? node.closest('.permanent-bookmark-section') : null;
        const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionContext === 'function'
            ? window.CanvasProtocolBridge
            : null;
        const permanentContext = sectionEl && protocolBridge
            ? protocolBridge.resolvePermanentSectionContext(sectionEl)
            : null;
        if (permanentContext && permanentContext.isCopy) {
            if (permanentContext.copyId) ctx.permanentCopyId = permanentContext.copyId;
            if (permanentContext.displayIndex) ctx.permanentDisplayIndex = permanentContext.displayIndex;
        } else if (sectionEl && sectionEl.dataset) {
            const copyIdRaw = sectionEl.dataset.permanentSectionCopyId;
            const copyId = (typeof copyIdRaw === 'string') ? copyIdRaw.trim() : '';
            if (copyId) ctx.permanentCopyId = copyId;
            const displayIndexRaw = sectionEl.dataset.permanentSectionDisplayIndex;
            const displayIndex = __ctxMenuNormalizePositiveInt(displayIndexRaw);
            if (displayIndex) ctx.permanentDisplayIndex = displayIndex;
        }
    } catch (_) { }

    // Temporary nodes sometimes don't carry sectionId on every tree item; fall back to container.
    try {
        if (ctx.treeType === 'temporary' && !ctx.sectionId) {
            const tempEl = node.closest ? node.closest('.temp-canvas-node[data-section-id]') : null;
            if (tempEl && tempEl.dataset && tempEl.dataset.sectionId) {
                ctx.sectionId = tempEl.dataset.sectionId;
            }
        }
    } catch (_) { }

    return ctx;
}

// 显示超链接右键菜单（用于描述中的链接）
async function showHyperlinkContextMenu(e, linkElement) {
    ;
    ;
    ;

    e.preventDefault();
    e.stopPropagation();

    await ensureCurrentWindowId();

    const url = linkElement.href;
    ;

    if (!url) {
        console.warn('[右键菜单] 超链接URL无效');
        return;
    }

    // 移除链接元素的title属性，避免显示浏览器默认tooltip
    if (linkElement.hasAttribute('title')) {
        linkElement.removeAttribute('title');
    }

    // 获取上下文（判断是永久栏目还是临时栏目）
    const permanentSection = linkElement.closest('#permanentSection, .permanent-bookmark-section');
    const tempNode = linkElement.closest('.temp-canvas-node');

    const context = {
        url: url,
        title: linkElement.textContent || linkElement.title || url,
        isHyperlink: true,
        treeType: tempNode ? 'temporary' : 'permanent',
        sectionId: tempNode ? tempNode.dataset.sectionId : null
    };

    ;

    // 刷新跟踪的打开目标
    await refreshTrackedOpenTargets();

    // 构建超链接菜单项
    const menuItems = buildHyperlinkMenuItems(context);

    // 渲染菜单
    const lang = currentLang || 'zh_CN';
    contextMenu.classList.remove('lang-zh', 'lang-en');
    contextMenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');

    // 超链接菜单始终使用紧凑的纵向布局
    contextMenu.classList.remove('horizontal-layout');
    contextMenu.classList.add('density-sm');

    let menuHTML = menuItems.map(item => {
        if (item.separator) {
            return '<div class="context-menu-separator"></div>';
        }

        const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
        const disabled = item.disabled ? 'disabled' : '';
        const selected = item.selected ? 'selected-open' : '';
        const colorClass = item.action === 'hyperlink-open-label' ? 'section-label' : '';
        const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
        const labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;

        // 添加空title属性以防止浏览器默认tooltip
        return `
            <div class="context-menu-item ${disabled} ${colorClass} ${selected}" data-action="${item.action}" ${hiddenStyle} title="">
                ${icon}
                <span class="context-menu-item-label">${labelContent}</span>
            </div>
        `;
    }).join('');

    contextMenu.innerHTML = menuHTML;

    // 绑定sub-badge点击事件（超链接专用的强制新建操作）
    contextMenu.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (event) => {
            const subAction = badge.dataset.subAction;
            if (!subAction || !context || !context.url) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                switch (subAction) {
                    // 同一标签组的"新分组"徽标
                    case 'hyperlink-same-group-new':
                        setHyperlinkDefaultOpenMode('specific-group');
                        await openHyperlinkInSpecificTabGroup(context.url, { forceNew: true });
                        break;
                    // 同一窗口的"新窗口"徽标
                    case 'hyperlink-same-window-new':
                        setHyperlinkDefaultOpenMode('specific-window');
                        await openHyperlinkInSpecificWindow(context.url, { forceNew: true });
                        break;
                    case 'hyperlink-open-manual-select-template-run':
                        await openBookmarkWithManualSelection(context.url);
                        break;
                    case 'tab-placement-submenu-trigger': {
                        const triggerItem = badge.closest('.context-menu-item');
                        if (triggerItem) toggleTabPlacementSubmenu(triggerItem);
                        return;
                    }
                    default:
                        console.warn('[超链接菜单] 未知的 sub-action:', subAction);
                }
            } catch (badgeError) {
                console.warn('[超链接菜单] sub-badge 操作失败:', badgeError);
            }
            hideContextMenu();
        });
    });

    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;

            if (action === 'hyperlink-open-label') {
                return;
            }
            handleHyperlinkMenuAction(action, context);
            hideContextMenu();
        });
    });

    // 超链接使用固定定位（浮动菜单），不嵌入DOM，避免破坏文档流和蓝色条纹问题
    positionHyperlinkContextMenu(e, linkElement);
    contextMenu.style.display = 'block';
}

// 为超链接菜单使用固定定位（浮动在鼠标位置）
function positionHyperlinkContextMenu(event, linkElement) {
    // 确保菜单在body中
    if (contextMenu.parentElement !== getOverlayContainer()) {
        getOverlayContainer().appendChild(contextMenu);
    }

    // 使用固定定位
    contextMenu.style.cssText = `
        position: fixed !important;
        display: block !important;
        margin: 0 !important;
        z-index: 10001 !important;
    `;

    // 获取点击位置
    const clickX = event.clientX;
    const clickY = event.clientY;

    // 获取菜单尺寸（先显示以获取真实尺寸）
    contextMenu.style.visibility = 'hidden';
    contextMenu.style.display = 'block';
    const menuRect = contextMenu.getBoundingClientRect();
    contextMenu.style.visibility = 'visible';

    // 视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;

    // 计算最佳位置（默认在鼠标右下方）
    let left = clickX + 2;
    let top = clickY + 2;

    // 防止超出右边界
    if (left + menuRect.width > viewportWidth - margin) {
        left = clickX - menuRect.width - 2;
    }

    // 防止超出左边界
    if (left < margin) {
        left = margin;
    }

    // 防止超出底部边界
    if (top + menuRect.height > viewportHeight - margin) {
        top = clickY - menuRect.height - 2;
    }

    // 防止超出顶部边界
    if (top < margin) {
        top = margin;
    }

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.right = 'auto';
    contextMenu.style.bottom = 'auto';

    ;
}

// 构建超链接菜单项（独立系统，6个选项 - 与书签系统隔离）
function buildHyperlinkMenuItems(context) {
    const lang = currentLang || 'zh_CN';
    const items = [];

    // 标题：打开超链接
    items.push({
        action: 'hyperlink-open-label',
        label: lang === 'zh_CN' ? '打开超链接：' : 'Open Hyperlink:',
        icon: '',
        disabled: true
    });

    // === 第一组：新建（新标签页 + 新窗口） ===

    // 1. in New Tab（新标签页）
    items.push({
        action: 'hyperlink-open-new-tab',
        labelHTML: `<span>${lang === 'zh_CN' ? '新标签页' : 'in New Tab'} <span class="sub-badge" data-sub-action="tab-placement-submenu-trigger">${lang === 'zh_CN' ? '位置' : 'Position'}</span></span>`,
        label: lang === 'zh_CN' ? '新标签页' : 'in New Tab',
        icon: 'window-maximize',
        selected: hyperlinkDefaultOpenMode === 'new-tab'
    });

    // 2. in New Window（新窗口）
    items.push({
        action: 'hyperlink-open-new-window',
        label: lang === 'zh_CN' ? '新窗口' : 'in New Window',
        icon: 'window-restore',
        selected: hyperlinkDefaultOpenMode === 'new-window'
    });

    items.push({ separatorShort: true });

    // === 第二组：复用（同一标签组 + 同一窗口） ===

    // 3. in Same Group（同一标签组）- 带可点击的"新分组"徽标
    (() => {
        const showBadge = !!hyperlinkSpecificTabGroupId;
        const baseLabelZh = '同一标签组';
        const baseLabelEn = 'in Same Group';
        // 添加 data-sub-action 使徽标可点击，用于强制新建分组
        const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge" data-sub-action="hyperlink-same-group-new">新分组</span>' : ' <span class="sub-badge" data-sub-action="hyperlink-same-group-new">New Group</span>') : '';

        items.push({
            action: 'hyperlink-open-same-group',
            label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge,
            icon: 'object-group',
            selected: hyperlinkDefaultOpenMode === 'specific-group'
        });
    })();

    // 4. in Same Window（同一窗口）- 带可点击的"新窗口"徽标
    (() => {
        const showBadge = !!hyperlinkSpecificWindowId;
        const baseLabelZh = '同一窗口';
        const baseLabelEn = 'in Same Window';
        // 添加 data-sub-action 使徽标可点击，用于强制新建窗口
        const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge" data-sub-action="hyperlink-same-window-new">新窗口</span>' : ' <span class="sub-badge" data-sub-action="hyperlink-same-window-new">New Window</span>') : '';

        items.push({
            action: 'hyperlink-open-specific-window',
            label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge,
            icon: 'window-restore',
            selected: hyperlinkDefaultOpenMode === 'specific-window'
        });
    })();

    items.push({ separatorShort: true });

    // === 第三组：其他选项 ===

    // 5. 手动选择窗口+组（可勾选）
    items.push({
        action: 'hyperlink-open-manual-select',
        label: lang === 'zh_CN' ? '手动选择...' : 'Manual Select...',
        icon: 'crosshairs',
        selected: hyperlinkDefaultOpenMode === 'manual-select'
    });

    // 6. 无痕窗口
    items.push({
        action: 'hyperlink-open-incognito',
        label: lang === 'zh_CN' ? '无痕窗口' : 'in Incognito',
        icon: 'user-secret',
        selected: hyperlinkDefaultOpenMode === 'incognito'
    });

    return items;
}


// 处理超链接菜单操作（独立系统，6个选项）
async function handleHyperlinkMenuAction(action, context) {
    const url = context.url;
    const lang = currentLang || 'zh_CN';

    try {
        switch (action) {
            case 'hyperlink-open-new-tab':
                setHyperlinkDefaultOpenMode('new-tab');
                await openHyperlinkNewTab(url);
                break;

            case 'hyperlink-open-new-window':
                setHyperlinkDefaultOpenMode('new-window');
                await openHyperlinkNewWindow(url);
                break;

            case 'hyperlink-open-same-group':
                // 右键点击 = 勾选模式 + 复用已有分组打开（点击 sub-badge 才强制新建）
                setHyperlinkDefaultOpenMode('specific-group');
                await openHyperlinkInSpecificTabGroup(url);
                break;

            case 'hyperlink-open-specific-window':
                // 右键点击 = 勾选模式 + 复用已有窗口打开（点击 sub-badge 才强制新建）
                setHyperlinkDefaultOpenMode('specific-window');
                await openHyperlinkInSpecificWindow(url);
                break;

            case 'hyperlink-open-manual-select':
                // 打开手动选择窗口+组的选择器（超链接模式）
                setHyperlinkDefaultOpenMode('manual-select');
                await showManualWindowGroupSelector({ nodeUrl: url, isHyperlink: true });
                break;


            case 'hyperlink-open-incognito':
                // 无痕窗口
                setHyperlinkDefaultOpenMode('incognito');
                await openHyperlinkIncognito(url);
                break;

            default:
                console.warn('[超链接菜单] 未处理的操作:', action);
        }
    } catch (error) {
        console.error('[超链接菜单] 操作失败:', error);
        alert((lang === 'zh_CN' ? '操作失败: ' : 'Failed: ') + error.message);
    }
}

// 设置超链接默认打开方式（独立于书签系统）
async function setHyperlinkDefaultOpenMode(mode) {
    ;
    hyperlinkDefaultOpenMode = mode;
    try { window.hyperlinkDefaultOpenMode = mode; } catch (_) { }
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ hyperlinkDefaultOpenMode: mode });
            ;
        } else {
            localStorage.setItem('hyperlinkDefaultOpenMode', mode);
            ;
        }
    } catch (err) {
        console.error('[超链接] 保存失败:', err);
    }
}

// 按超链接默认模式打开（供左键/其他模块复用）
async function openHyperlinkWithDefaultMode(url, options = {}) {
    if (!url) return;
    const { context } = (options && typeof options === 'object') ? options : {};
    try {
        switch (hyperlinkDefaultOpenMode) {
            case 'new-tab':
                await openHyperlinkNewTab(url);
                break;
            case 'new-window':
                await openHyperlinkNewWindow(url);
                break;
            case 'specific-window':
                await openHyperlinkInSpecificWindow(url, { context });
                break;
            case 'specific-group':
                await openHyperlinkInSpecificTabGroup(url, { context });
                break;
            case 'manual-select':
                if (typeof openBookmarkWithManualSelection === 'function') {
                    await openBookmarkWithManualSelection(url);
                } else {
                    await openHyperlinkNewTab(url);
                }
                break;
            case 'incognito':
                await openHyperlinkIncognito(url);
                break;
            default:
                await openHyperlinkNewTab(url);
        }
    } catch (err) {
        console.warn('[超链接] openHyperlinkWithDefaultMode 失败，回退 window.open:', err);
        window.open(url, '_blank');
    }
}

try {
    window.openHyperlinkWithDefaultMode = openHyperlinkWithDefaultMode;
} catch (_) { }

// 显示右键菜单
async function showContextMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();

    await ensureCurrentWindowId();

    currentContextNode = node;

    // 移除之前的右键选中标识
    document.querySelectorAll('.tree-item.context-selected').forEach(item => {
        item.classList.remove('context-selected');
    });

    // 普通模式显示右键目标高亮；批量模式右键只定位粘贴，不改变选中视觉。
    if (!selectMode) {
        node.classList.add('context-selected');
    }

    // 获取节点信息
    const context = getNodeContext(node);
    if (!context || !context.nodeId) {
        console.warn('[右键菜单] 节点上下文无效');
        return;
    }

    const { nodeId, nodeTitle, nodeUrl, isFolder } = context;
    ;

    // 菜单展示前刷新一次所有受管理的窗口/分组指针，避免引用失效对象
    await refreshTrackedOpenTargets();

    // 根据容器大小自适应布局与密度（若用户手动选择过布局，则尊重“按类型”用户设置）
    const container = node.closest('#permanentSection, .permanent-bookmark-section, .temp-canvas-node, .md-canvas-node, .canvas-main-container') || document.body;
    const rect = container.getBoundingClientRect();
    const availableWidth = Math.max(0, rect.width || window.innerWidth || 1024);

    // 宽度阈值：根据栏目的类型（永久/临时）做不同规划
    const scope = context.treeType === 'temporary' ? 'temporary' : 'permanent';
    // 永久栏目通常更宽：阈值更高；临时卡片更窄：阈值更低
    const H_BREAK_PERMANENT = 640; // >= 横向
    const H_BREAK_TEMP = 520;      // >= 横向
    const baseBreak = scope === 'permanent' ? H_BREAK_PERMANENT : H_BREAK_TEMP;

    // 密度阈值：<420 极窄（竖向+紧凑），<640 紧凑横向，其它横向舒适
    let density = 'md';
    if (availableWidth < 420) density = 'xs';
    else if (availableWidth < 640) density = 'sm';
    else if (availableWidth > 980) density = 'lg';

    // 自动切换布局；如果localStorage有“按类型”的显式偏好，则优先使用
    try {
        const savedTypeLayout = localStorage.getItem(`contextMenuLayout_${scope}`);
        if (savedTypeLayout === 'horizontal') contextMenuHorizontal = true;
        else if (savedTypeLayout === 'vertical') contextMenuHorizontal = false;
        else contextMenuHorizontal = availableWidth >= baseBreak;
    } catch (_) {
        contextMenuHorizontal = availableWidth >= baseBreak;
    }

    // 批量模式的节点粘贴菜单是专用定位菜单，始终采用纵向布局，避免与普通菜单布局混用。
    if (selectMode) {
        contextMenuHorizontal = false;
    }

    // 更新容器类名，并写入作用域，供切换按钮使用
    contextMenu.classList.toggle('horizontal-layout', contextMenuHorizontal);
    contextMenu.classList.remove('density-xs', 'density-sm', 'density-md', 'density-lg');
    contextMenu.classList.add(`density-${density}`);
    contextMenu.dataset.menuScope = scope;

    // 构建菜单项
    const menuItems = buildMenuItems(context);

    // 渲染菜单
    const lang = currentLang || 'zh_CN';

    // 添加语言class，用于CSS中区分中英文样式
    contextMenu.classList.remove('lang-zh', 'lang-en');
    contextMenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');

    let menuHTML;

    if (contextMenuHorizontal) {
        // 横向布局：按分组渲染
        const groups = {};
        const groupOrder = [];

        // 分组菜单项
        menuItems.forEach(item => {
            if (item.separator || item.separatorShort) return; // 横向布局忽略分隔符

            const groupName = item.group || 'default';
            if (!groups[groupName]) {
                groups[groupName] = [];
                groupOrder.push(groupName);
            }
            groups[groupName].push(item);
        });

        // 指定横向布局行次：
        // 行1：actions（包含选择及编辑的所有操作，由 flex 容器自动换行，填充空白）；行2：open；行3：其余（settings/structure等）
        const explicitOrder = [];
        if (groups.actions) explicitOrder.push('actions');
        if (groups.open) explicitOrder.push('open');
        // 其余分组保持出现顺序
        groupOrder.forEach(g => { if (!['actions', 'open'].includes(g)) explicitOrder.push(g); });

        const groupElements = explicitOrder.map((groupName, idx) => {
            const groupItems = groups[groupName];
            const inner = groupItems.map(item => {
                const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
                const disabled = item.disabled ? 'disabled' : '';
                const selected = item.selected ? 'selected-open' : '';
                const labelClass = item.action === 'open-label' ? 'section-label' : '';
                const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
                const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
                const extraClass = item.className ? item.className : '';
                let labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;
                if (item.hasSubmenu) {
                    labelContent = `<span>${item.label || ''} <i class="fas fa-chevron-right" style="margin-left: auto; font-size: 0.8em; opacity: 0.7;"></i></span>`;
                }
                return `
                    <div class="context-menu-item ${disabled} ${colorClass} ${selected} ${labelClass} ${extraClass}" data-action="${item.action}" ${hiddenStyle}>
                        ${icon}
                        <span class="context-menu-item-label">${labelContent}</span>
                    </div>`;
            }).join('');
            const html = `<div class="context-menu-group" data-group="${groupName}">${inner}</div>`;
            // 仅在第1组 (actions) 之后插入换行占位，使后面的“默认打开模式”与“纵/横向布局切换”并排显示
            if (idx === 0) {
                return html + '<div class="context-menu-break"></div>';
            }
            return html;
        }).join('');

        menuHTML = groupElements;
    } else {
        // 纵向布局：原始格式
        menuHTML = menuItems.map(item => {
            if (item.separator) {
                return '<div class="context-menu-separator"></div>';
            }
            if (item.separatorShort) {
                return '<div class="context-menu-separator short"></div>';
            }

            const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
            const disabled = item.disabled ? 'disabled' : '';
            const selected = item.selected ? 'selected-open' : '';
            const labelClass = item.action === 'open-label' ? 'section-label' : '';
            const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
            const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
            const extraClass = item.className ? item.className : '';
            let labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;
            if (item.hasSubmenu) {
                labelContent = `<span>${item.label || ''} <i class="fas fa-chevron-right" style="margin-left: auto; font-size: 0.8em; opacity: 0.7;"></i></span>`;
            }

            return `
                <div class="context-menu-item ${disabled} ${colorClass} ${selected} ${labelClass} ${extraClass}" data-action="${item.action}" ${hiddenStyle}>
                    ${icon}
                    <span class="context-menu-item-label">${labelContent}</span>
                </div>
            `;
        }).filter(html => html !== '').join('');
    }

    contextMenu.innerHTML = menuHTML;

    contextMenu.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (event) => {
            const subAction = badge.dataset.subAction;
            if (!subAction || !context) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                switch (subAction) {
                    case 'tab-placement-submenu-trigger': {
                        const triggerItem = badge.closest('.context-menu-item');
                        if (triggerItem) toggleTabPlacementSubmenu(triggerItem);
                        return;
                    }
                    case 'add-template-run':
                        hideContextMenu();
                        await openBookmarkAddByTemplateAction(context);
                        return;
                    case 'open-manual-select-template-run':
                        hideContextMenu();
                        if (context.nodeUrl) {
                            await openBookmarkWithManualSelection(context.nodeUrl, context);
                        }
                        return;
                    case 'open-all-manual-select-template-run':
                        hideContextMenu();
                        const urls = await getUrlsFromContext(context);
                        await openFolderWithManualSelection(urls, context.nodeTitle, context);
                        return;
                    case 'swsg-new-group':
                    case 'swsg-new-window':
                        if (!context.nodeUrl) return;
                        await openInSameWindowSpecificGroup(context.nodeUrl, {
                            context,
                            forceNewGroup: subAction === 'swsg-new-group' || subAction === 'swsg-new-window',
                            forceNewWindow: subAction === 'swsg-new-window'
                        });
                        await setDefaultOpenMode('same-window-specific-group');
                        break;
                    case 'scoped-group-new':
                        if (!context.nodeUrl) return;
                        await openInScopedTabGroup(context.nodeUrl, { context, forceNew: true });
                        await setDefaultOpenMode('scoped-group');
                        break;
                    case 'scoped-window-new':
                        if (!context.nodeUrl) return;
                        await openInScopedWindow(context.nodeUrl, { context, forceNew: true });
                        await setDefaultOpenMode('scoped-window');
                        break;
                    default:
                        console.warn('[右键菜单] unknown sub-action:', subAction);
                }
            } catch (badgeError) {
                console.warn('[右键菜单] sub-badge 操作失败:', badgeError);
            }
            hideContextMenu();
        });
    });

    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;

            // 切换布局时，不关闭菜单
            if (action === 'toggle-context-menu-layout') {
                toggleContextMenuLayout();
                // 重新渲染菜单以更新按钮文字
                showContextMenu(e, currentContextNode);
                return;
            }
            // 分组标题不处理
            if (action === 'open-label') {
                return;
            }
            // 如果是打开子菜单的触发器
            if (action === 'open-submenu-trigger' || action === 'trace-submenu-trigger' || action === 'tag-submenu-trigger' || action === 'info-submenu-trigger') {
                toggleSubmenu(item, context);
                return;
            }

            // Click on other main menu item hides submenu
            hideSubmenu();

            handleMenuAction(action, context);
            hideContextMenu();
        });
    });

    // 使用固定定位显示菜单（不嵌入DOM，悬浮于卡片之上）
    positionPrimaryContextMenu(e, node);
}

// 渲染二级菜单
function renderSubmenu(context) {
    if (!contextSubmenu) return;

    if (contextSubmenu.style.display === 'block') {
        flushInfoSubmenuNoteEditor();
    }
    contextSubmenu.__flushInfoNoteEditor = null;
    contextSubmenu.classList.remove('is-tag-submenu', 'is-trace-submenu', 'is-info-submenu', 'is-tab-placement-submenu');

    if (contextSubmenu.dataset.triggerAction === 'trace-submenu-trigger') {
        renderTraceSubmenu(context);
        return;
    }

    if (contextSubmenu.dataset.triggerAction === 'tag-submenu-trigger') {
        renderTagSubmenu(context);
        return;
    }

    if (contextSubmenu.dataset.triggerAction === 'info-submenu-trigger') {
        renderInfoSubmenu(context);
        return;
    }

    const lang = currentLang || 'zh_CN';
    contextSubmenu.classList.remove('lang-zh', 'lang-en');
    contextSubmenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');

    // Sync density classes from the main contextMenu to match size
    contextSubmenu.classList.remove('density-xs', 'density-sm', 'density-md', 'density-lg');
    const activeDensity = ['density-xs', 'density-sm', 'density-md', 'density-lg'].find(cls => contextMenu.classList.contains(cls));
    if (activeDensity) {
        contextSubmenu.classList.add(activeDensity);
    }

    // 构建子菜单项
    const submenuItems = buildSubmenuItems(context);

    // 渲染 HTML
    const submenuHTML = submenuItems.map(item => {
        if (item.separator) {
            return '<div class="context-menu-separator"></div>';
        }
        if (item.separatorShort) {
            return '<div class="context-menu-separator short"></div>';
        }

        const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
        const disabled = item.disabled ? 'disabled' : '';
        const selected = item.selected ? 'selected-open' : '';
        const labelClass = item.action === 'open-label' ? 'section-label' : '';
        const colorClass = item.action === 'select-item' ? 'color-blue' : item.action === 'delete' ? 'color-red' : '';
        const hiddenStyle = item.hidden ? 'style="display:none;"' : '';
        const extraClass = item.className ? item.className : '';
        const labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label || ''}</span>`;

        return `
            <div class="context-menu-item ${disabled} ${colorClass} ${selected} ${labelClass} ${extraClass}" data-action="${item.action}" ${hiddenStyle}>
                ${icon}
                <span class="context-menu-item-label">${labelContent}</span>
            </div>
        `;
    }).filter(html => html !== '').join('');

    contextSubmenu.innerHTML = submenuHTML;

    // 绑定子菜单的 badge 点击事件
    contextSubmenu.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (event) => {
            const subAction = badge.dataset.subAction;
            if (!subAction || !context) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                switch (subAction) {
                    case 'tab-placement-submenu-trigger': {
                        const triggerItem = badge.closest('.context-menu-item');
                        if (triggerItem) toggleTabPlacementSubmenu(triggerItem);
                        return;
                    }
                    case 'add-template-run':
                        hideContextMenu();
                        await openBookmarkAddByTemplateAction(context);
                        return;
                    case 'open-manual-select-template-run':
                        hideContextMenu();
                        if (context.nodeUrl) {
                            await openBookmarkWithManualSelection(context.nodeUrl, context);
                        }
                        return;
                    case 'open-all-manual-select-template-run':
                        hideContextMenu();
                        const urls = await getUrlsFromContext(context);
                        await openFolderWithManualSelection(urls, context.nodeTitle, context);
                        return;
                    case 'swsg-new-group':
                    case 'swsg-new-window':
                        if (!context.nodeUrl) return;
                        await openInSameWindowSpecificGroup(context.nodeUrl, {
                            context,
                            forceNewGroup: subAction === 'swsg-new-group' || subAction === 'swsg-new-window',
                            forceNewWindow: subAction === 'swsg-new-window'
                        });
                        await setDefaultOpenMode('same-window-specific-group');
                        break;
                    case 'scoped-group-new':
                        if (!context.nodeUrl) return;
                        await openInScopedTabGroup(context.nodeUrl, { context, forceNew: true });
                        await setDefaultOpenMode('scoped-group');
                        break;
                    case 'scoped-window-new':
                        if (!context.nodeUrl) return;
                        await openInScopedWindow(context.nodeUrl, { context, forceNew: true });
                        await setDefaultOpenMode('scoped-window');
                        break;
                    default:
                        console.warn('[右键菜单] unknown sub-action:', subAction);
                }
            } catch (badgeError) {
                console.warn('[右键菜单] sub-badge 操作失败:', badgeError);
            }
            hideContextMenu();
        });
    });

    // 绑定子菜单项点击事件
    contextSubmenu.querySelectorAll('.context-menu-item:not(.disabled)').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            if (action === 'open-label') return;
            handleMenuAction(action, context);
            hideContextMenu();
        });
    });
}

// 隐藏二级菜单，并在纵向布局下重置一级菜单的位置
function flushInfoSubmenuNoteEditor() {
    if (!contextSubmenu || typeof contextSubmenu.__flushInfoNoteEditor !== 'function') return;
    try {
        const result = contextSubmenu.__flushInfoNoteEditor();
        if (result && typeof result.catch === 'function') {
            result.catch((err) => console.error('[Info] Failed to flush note before closing submenu:', err));
        }
    } catch (err) {
        console.error('[Info] Failed to flush note before closing submenu:', err);
    }
}

function hideSubmenu() {
    hideTabPlacementSubmenu();
    if (contextSubmenu) {
        flushInfoSubmenuNoteEditor();
        contextSubmenu.__flushInfoNoteEditor = null;
        contextSubmenu.style.display = 'none';
        contextSubmenu.classList.remove('is-tag-submenu', 'is-trace-submenu');
    }
    tagSubmenuCtx = null;
    if (contextMenu && !contextMenuHorizontal) {
        if (contextMenu.dataset.originalLeft) {
            contextMenu.style.left = contextMenu.dataset.originalLeft;
            delete contextMenu.dataset.originalLeft;
        }
    }
}

function hideTabPlacementSubmenu() {
    if (!tabPlacementSubmenu) return;
    tabPlacementSubmenu.style.display = 'none';
    tabPlacementSubmenu.style.transform = '';
    tabPlacementSubmenu.style.transformOrigin = '';
    lastTabPlacementTriggerItem = null;
}

function getQuickActionPopoverScale(anchor) {
    const BASE = 0.9;
    try {
        const inCanvas = anchor && anchor.closest && anchor.closest('.canvas-content, .canvas-workspace');
        if (inCanvas && typeof CanvasState !== 'undefined' && CanvasState) {
            const zoom = Number(CanvasState.zoom);
            const baseZoom = Number(CanvasState.baseZoom) || 1;
            if (Number.isFinite(zoom) && zoom > 0 && Number.isFinite(baseZoom) && baseZoom > 0) {
                return BASE * (zoom / baseZoom);
            }
        }
    } catch (_) { }
    return BASE;
}

function getContextSubmenuScale(triggerItem, triggerAction) {
    const action = String(triggerAction || '');
    const fromQuickAction = !!(triggerItem && triggerItem.closest && triggerItem.closest('.tree-item-hover-actions'));
    if (fromQuickAction && (action === 'trace-submenu-trigger' || action === 'info-submenu-trigger')) {
        const quickScale = getQuickActionPopoverScale(triggerItem);
        if (Number.isFinite(quickScale) && quickScale > 0) return quickScale;
    }

    let scale = 1;
    if (currentContextNode) {
        const scaleInfo = __getBookmarkAddLocateContainerScale(currentContextNode);
        if (scaleInfo && scaleInfo.scaleX) {
            scale = scaleInfo.scaleX;
        }
    } else if (contextMenu) {
        const scaleInfo = __getBookmarkAddLocateContainerScale(contextMenu);
        if (scaleInfo && scaleInfo.scaleX) {
            scale = scaleInfo.scaleX;
        }
    }
    return scale;
}

// 展开/收起二级菜单
function toggleSubmenu(triggerItem, context) {
    if (!contextSubmenu) return;

    hideTabPlacementSubmenu();

    const currentTriggerAction = contextSubmenu.dataset.triggerAction;
    const newTriggerAction = triggerItem.dataset.action;

    if (contextSubmenu.style.display === 'block' && currentTriggerAction === newTriggerAction) {
        hideSubmenu();
        return;
    }

    lastSubmenuTriggerItem = triggerItem;
    lastSubmenuContext = context;
    contextSubmenu.dataset.triggerAction = newTriggerAction;

    // 先渲染子菜单内容
    renderSubmenu(context);

    // 挂载到 body 以便进行屏幕绝对定位
    if (contextSubmenu.parentElement !== getOverlayContainer()) {
        getOverlayContainer().appendChild(contextSubmenu);
    }

    // 关键：在测量前临时设置为 fixed 并重置 transform，确保浏览器计算出正确的 offsetWidth / offsetHeight
    contextSubmenu.style.transform = 'none';
    contextSubmenu.style.position = 'fixed';
    contextSubmenu.style.display = 'block';

    updateSubmenuPosition();
}

// 重新计算并更新二级子菜单位置
function updateSubmenuPosition() {
    if (!contextSubmenu || contextSubmenu.style.display !== 'block' || !lastSubmenuTriggerItem) return;

    const triggerItem = lastSubmenuTriggerItem;
    const newTriggerAction = contextSubmenu.dataset.triggerAction;

    // 计算二级菜单缩放比例
    const scale = getContextSubmenuScale(triggerItem, newTriggerAction);

    const triggerRect = triggerItem.getBoundingClientRect();
    const submenuWidth = contextSubmenu.offsetWidth || 280;
    const submenuHeight = contextSubmenu.offsetHeight || 300;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 计算实际的缩放后宽度和高度
    const visualWidth = submenuWidth * scale;
    const visualHeight = submenuHeight * scale;

    // 定位和变换原点
    let left, top, transformOriginX, transformOriginY;

    if (contextMenuHorizontal) {
        // 横向布局下：二级子菜单显示在“默认打开模式”按钮的下方或上方
        transformOriginY = 'top';
        top = triggerRect.bottom + 4;

        // 检查底部是否溢出，如果溢出则显示在上方
        if (top + visualHeight > viewportHeight - 8) {
            top = triggerRect.top - submenuHeight - 4;
            transformOriginY = 'bottom';
        }

        // 水平对齐：默认左对齐，如果右侧溢出则右对齐
        if (triggerRect.left + visualWidth <= viewportWidth - 8) {
            left = triggerRect.left;
            transformOriginX = 'left';
        } else {
            left = triggerRect.right - submenuWidth;
            transformOriginX = 'right';
        }

        // 边界防护
        left = Math.max(8, left);
    } else if (!contextMenu || contextMenu.style.display === 'none') {
        // 当主菜单未显示时（通过快捷按钮直接触发），学习 Tag 系统 popover 的优秀定位逻辑
        const preferLeft = !!(triggerItem && triggerItem.closest && triggerItem.closest('.canvas-fullscreen-active, .canvas-fullscreen-node, .canvas-content, .canvas-workspace, .search-results-panel'));

        // 始终采用 left top 作为缩放原点，以精确对齐视觉 top-left 坐标
        transformOriginX = 'left';
        transformOriginY = 'top';

        if (preferLeft) {
            left = triggerRect.left - visualWidth - 6;
            if (left < 8) {
                // 左侧放不下，尝试放在右侧
                left = triggerRect.right + 6;
                if (left + visualWidth > viewportWidth - 8) {
                    left = Math.max(8, viewportWidth - visualWidth - 8);
                }
            }
        } else {
            left = triggerRect.right + 6;
            if (left + visualWidth > viewportWidth - 8) {
                // 右侧放不下，尝试放在左侧
                left = triggerRect.left - visualWidth - 6;
                if (left < 8) {
                    left = Math.max(8, viewportWidth - visualWidth - 8);
                }
            }
        }

        // 垂直定位：顶端与触发按钮顶端对齐，并防止超出视口安全区域
        top = triggerRect.top;
        if (top + visualHeight > viewportHeight - 8) {
            top = Math.max(8, viewportHeight - visualHeight - 8);
        }
    } else {
        // 纵向布局下：始终显示在右侧或左侧 (与默认打开方式、溯源面板一致)
        const primaryRect = contextMenu.getBoundingClientRect();
        const rightFits = (triggerRect.right + 4 + visualWidth <= viewportWidth - 8);
        const leftFits = (triggerRect.left - 4 - visualWidth >= 8);

        let shift = 0;
        let showOnRight = true;

        if (rightFits) {
            showOnRight = true;
            shift = 0;
        } else if (leftFits) {
            showOnRight = false;
            shift = 0;
        } else {
            // 左右都不够，尝试平移一级菜单
            const neededShiftLeft = (viewportWidth - 8) - (triggerRect.right + 4 + visualWidth); // 负值
            const neededShiftRight = 8 - (triggerRect.left - 4 - visualWidth); // 正值

            const canShiftLeft = (primaryRect.left + neededShiftLeft >= 8);
            const canShiftRight = (primaryRect.right + neededShiftRight <= viewportWidth - 8);

            if (canShiftLeft && canShiftRight) {
                if (Math.abs(neededShiftLeft) <= Math.abs(neededShiftRight)) {
                    shift = neededShiftLeft;
                    showOnRight = true;
                } else {
                    shift = neededShiftRight;
                    showOnRight = false;
                }
            } else if (canShiftLeft) {
                shift = neededShiftLeft;
                showOnRight = true;
            } else if (canShiftRight) {
                shift = neededShiftRight;
                showOnRight = false;
            } else {
                // 如果平移都会导致一级菜单部分移出屏幕，优先向空间多的一侧移动，并限制在边界内
                if (primaryRect.left - 8 > (viewportWidth - 8) - primaryRect.right) {
                    shift = Math.max(neededShiftLeft, 8 - primaryRect.left);
                    showOnRight = true;
                } else {
                    shift = Math.min(neededShiftRight, (viewportWidth - 8) - primaryRect.right);
                    showOnRight = false;
                }
            }
        }

        // 应用一级菜单的水平位移
        if (shift !== 0 && contextMenu) {
            const originalLeft = parseFloat(contextMenu.dataset.originalLeft) || parseFloat(contextMenu.style.left) || 0;
            if (!contextMenu.dataset.originalLeft) {
                contextMenu.dataset.originalLeft = contextMenu.style.left;
            }
            contextMenu.style.left = `${originalLeft + shift}px`;
        } else if (contextMenu) {
            if (contextMenu.dataset.originalLeft) {
                contextMenu.style.left = contextMenu.dataset.originalLeft;
                delete contextMenu.dataset.originalLeft;
            }
        }

        // 重新计算移动后 trigger 按钮的实际水平坐标
        const newTriggerLeft = triggerRect.left + shift;
        const newTriggerRight = triggerRect.right + shift;

        if (showOnRight) {
            left = newTriggerRight + 4;
            transformOriginX = 'left';
        } else {
            left = newTriggerLeft - submenuWidth - 4;
            transformOriginX = 'right';
        }

        // 垂直定位：与触发项 (triggerItem) 在 Y 轴中心对齐
        let visualCenterY = triggerRect.top + triggerRect.height / 2;
        const visualHalfHeight = visualHeight / 2;

        // 限制在视口上下安全区域内
        if (visualCenterY - visualHalfHeight < 8) {
            visualCenterY = 8 + visualHalfHeight;
        }
        if (visualCenterY + visualHalfHeight > viewportHeight - 8) {
            visualCenterY = viewportHeight - 8 - visualHalfHeight;
        }
        top = visualCenterY - submenuHeight / 2;
        transformOriginY = 'center';
    }

    // 应用 fixed 绝对定位和缩放 transform
    contextSubmenu.style.cssText = `
        position: fixed !important;
        display: block !important;
        left: ${left}px !important;
        top: ${top}px !important;
        z-index: 10001 !important;
        margin: 0 !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25) !important;
        transform: scale(${scale}) !important;
        transform-origin: ${transformOriginX} ${transformOriginY} !important;
    `;
}

// 供外部/异步加载事件/折叠面板调用的公共位置修正接口
function repositionSubmenu() {
    updateSubmenuPosition();
}

// 构建子菜单项
function buildSubmenuItems(context) {
    const lang = currentLang || 'zh_CN';
    const items = [];

    if (context && context.isFolder) {
        items.push(
            { action: 'open-all', label: lang === 'zh_CN' ? '打开全部' : 'Open All', icon: 'folder-open' },
            { action: 'open-all-tab-group', label: lang === 'zh_CN' ? '标签页组' : 'Tab Group', icon: 'object-group' },
            { action: 'open-all-new-window', label: lang === 'zh_CN' ? '新窗口' : 'New Window', icon: 'window-restore' },
            { action: 'open-all-incognito', label: lang === 'zh_CN' ? '无痕窗口' : 'Incognito', icon: 'user-secret' },
            {
                action: 'open-all-manual-select',
                labelHTML: `<span>${lang === 'zh_CN' ? '手动选择...' : 'Manual Select...'}<span class="sub-badge" data-sub-action="open-all-manual-select-template-run">${lang === 'zh_CN' ? '模版' : 'Template'}</span></span>`,
                label: lang === 'zh_CN' ? '手动选择...' : 'Manual Select...',
                icon: 'crosshairs'
            }
        );
        return items;
    }

    items.push(
        // 新增：手动选择窗口+组（可勾选）
        {
            action: 'open-manual-select',
            label: lang === 'zh_CN' ? '手动选择...' : 'Manual Select...',
            icon: 'crosshairs',
            selected: defaultOpenMode === 'manual-select'
        },
        { separatorShort: true },
        {
            action: 'open-new-tab',
            labelHTML: `<span>${lang === 'zh_CN' ? '新标签页' : 'in New Tab'} <span class="sub-badge" data-sub-action="tab-placement-submenu-trigger">${lang === 'zh_CN' ? '位置' : 'Position'}</span></span>`,
            label: lang === 'zh_CN' ? '新标签页' : 'in New Tab',
            icon: 'window-maximize',
            selected: defaultOpenMode === 'new-tab'
        },
        // 改名：原“特定标签组”改为“同一标签组”/“In Same Group”（带提示徽标）
        (() => {
            const showBadge = !!specificTabGroupId;
            const baseLabelZh = '同一标签组';
            const baseLabelEn = 'in Same Group';
            const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge">新分组</span>' : ' <span class="sub-badge">New Group</span>') : '';
            return { action: 'open-specific-group', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'object-group', selected: defaultOpenMode === 'specific-group' };
        })(),
        // 新增：分栏“特定标签组”（放在“同一标签组”之下）
        (() => {
            const scope = getScopeFromContext(context);
            const key = currentWindowId && scope ? `${currentWindowId}:${scope.key}` : (scope ? scope.key : null);
            const scopedEntry = (key && scopedCurrentGroups) ? scopedCurrentGroups[key] : null;
            const showBadge = !!(scopedEntry && Number.isInteger(scopedEntry.groupId));
            const scopeSuffix = scope && scope.prefix ? ` (${escapeHtml(scope.prefix)})` : '';
            const baseLabelZh = `专属标签组${scopeSuffix}`;
            const baseLabelEn = `in Exclusive Group${scopeSuffix}`;
            // badge 点击：强制新建分组（不复用已有组）
            const badge = showBadge
                ? (lang === 'zh_CN'
                    ? ' <span class="sub-badge" data-sub-action="scoped-group-new">新分组</span>'
                    : ' <span class="sub-badge" data-sub-action="scoped-group-new">New Group</span>')
                : '';
            return { action: 'open-scoped-group', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'object-group', selected: defaultOpenMode === 'scoped-group' };
        })(),
        { separatorShort: true },
        // 第三行：窗口相关
        { action: 'open-new-window', label: lang === 'zh_CN' ? '新窗口' : 'in New Window', icon: 'window-restore', selected: defaultOpenMode === 'new-window' },
        // 改名：原“特定窗口打开”改为“同一窗口”/“In Same Window”（带提示徽标）
        (() => {
            const showBadge = !!specificWindowId;
            const baseLabelZh = '同一窗口';
            const baseLabelEn = 'in Same Window';
            const badge = showBadge ? (lang === 'zh_CN' ? ' <span class="sub-badge">新窗口</span>' : ' <span class="sub-badge">New Window</span>') : '';
            return { action: 'open-specific-window', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'window-restore', selected: defaultOpenMode === 'specific-window' };
        })(),
        (() => {
            const scope = getScopeFromContext(context);
            const scopedWinId = (scope && scopedWindows) ? scopedWindows[scope.key] : null;
            const showBadge = Number.isInteger(scopedWinId);
            const scopeSuffix = scope && scope.prefix ? ` (${escapeHtml(scope.prefix)})` : '';
            const baseLabelZh = `专属窗口${scopeSuffix}`;
            const baseLabelEn = `in Exclusive Window${scopeSuffix}`;
            // badge 点击：强制新建窗口（不复用已有窗口）
            const badge = showBadge
                ? (lang === 'zh_CN'
                    ? ' <span class="sub-badge" data-sub-action="scoped-window-new">新窗口</span>'
                    : ' <span class="sub-badge" data-sub-action="scoped-window-new">New Window</span>')
                : '';
            return { action: 'open-scoped-window', label: (lang === 'zh_CN' ? baseLabelZh : baseLabelEn) + badge, icon: 'window-restore', selected: defaultOpenMode === 'scoped-window' };
        })(),
        // 同窗专属组
        (() => {
            const scope = getScopeFromContext(context);
            const badges = [
                `<span class="sub-badge" data-sub-action="swsg-new-group">${lang === 'zh_CN' ? '新分组' : 'New Group'}</span>`,
                `<span class="sub-badge" data-sub-action="swsg-new-window">${lang === 'zh_CN' ? '新窗口' : 'New Window'}</span>`
            ];
            const scopeSuffix = scope && scope.prefix ? ` (${escapeHtml(scope.prefix)})` : '';
            const baseLabelZh = `同窗专属组${scopeSuffix}`;
            const baseLabelEn = `In Same Window & Exclusive Group${scopeSuffix}`;
            const badgeHtml = `<div class="swsg-badge-row">${badges.join('')}</div>`;
            const titleClass = lang === 'zh_CN' ? 'swsg-title' : 'swsg-title swsg-title-compact';
            const titleHtml = `<span class="${titleClass}">${lang === 'zh_CN' ? baseLabelZh : baseLabelEn}</span>`;
            return {
                action: 'open-same-window-specific-group',
                labelHTML: `${titleHtml}${badgeHtml}`,
                label: lang === 'zh_CN' ? baseLabelZh : baseLabelEn,
                icon: 'layer-group',
                className: 'swsg-option',
                selected: defaultOpenMode === 'same-window-specific-group'
            };
        })(),
        { action: 'open-incognito', label: lang === 'zh_CN' ? '无痕窗口' : 'in Incognito', icon: 'user-secret', selected: defaultOpenMode === 'incognito' }
    );

    return items;
}

function toggleTabPlacementSubmenu(triggerItem) {
    if (!tabPlacementSubmenu || !triggerItem) return;
    if (tabPlacementSubmenu.style.display === 'block' && lastTabPlacementTriggerItem === triggerItem) {
        hideTabPlacementSubmenu();
        return;
    }
    lastTabPlacementTriggerItem = triggerItem;
    renderTabPlacementSubmenu();
    if (tabPlacementSubmenu.parentElement !== getOverlayContainer()) {
        getOverlayContainer().appendChild(tabPlacementSubmenu);
    }
    tabPlacementSubmenu.style.transform = 'none';
    tabPlacementSubmenu.style.position = 'fixed';
    tabPlacementSubmenu.style.display = 'block';
    updateTabPlacementSubmenuPosition();
}

function updateTabPlacementSubmenuPosition() {
    if (!tabPlacementSubmenu || tabPlacementSubmenu.style.display !== 'block' || !lastTabPlacementTriggerItem) return;

    const triggerRect = lastTabPlacementTriggerItem.getBoundingClientRect();
    const submenuWidth = tabPlacementSubmenu.offsetWidth || 230;
    const submenuHeight = tabPlacementSubmenu.offsetHeight || 160;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scale = getContextSubmenuScale(lastTabPlacementTriggerItem, 'tab-placement-submenu-trigger');
    const visualWidth = submenuWidth * scale;
    const visualHeight = submenuHeight * scale;
    let left;
    let top;
    let transformOriginX;
    let transformOriginY;
    const isHorizontalLayout = contextMenuHorizontal && contextMenu && contextMenu.classList.contains('horizontal-layout');

    if (isHorizontalLayout) {
        top = triggerRect.bottom + 4;
        transformOriginY = 'top';
        if (top + visualHeight > viewportHeight - 8) {
            top = triggerRect.top - submenuHeight - 4;
            transformOriginY = 'bottom';
        }
        if (triggerRect.left + visualWidth <= viewportWidth - 8) {
            left = triggerRect.left;
            transformOriginX = 'left';
        } else {
            left = Math.max(8, triggerRect.right - submenuWidth);
            transformOriginX = 'right';
        }
    } else {
        const showOnRight = triggerRect.right + 4 + visualWidth <= viewportWidth - 8
            || triggerRect.left - 4 - visualWidth < 8;
        left = showOnRight ? triggerRect.right + 4 : triggerRect.left - submenuWidth - 4;
        transformOriginX = showOnRight ? 'left' : 'right';

        let visualCenterY = triggerRect.top + triggerRect.height / 2;
        const visualHalfHeight = visualHeight / 2;
        visualCenterY = Math.max(8 + visualHalfHeight, Math.min(viewportHeight - 8 - visualHalfHeight, visualCenterY));
        top = visualCenterY - submenuHeight / 2;
        transformOriginY = 'center';
    }

    tabPlacementSubmenu.style.cssText = `
        position: fixed !important;
        display: block !important;
        left: ${left}px !important;
        top: ${top}px !important;
        z-index: 10002 !important;
        margin: 0 !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25) !important;
        transform: scale(${scale}) !important;
        transform-origin: ${transformOriginX} ${transformOriginY} !important;
    `;
}

function renderTabPlacementSubmenu() {
    if (!tabPlacementSubmenu) return;
    const lang = currentLang || 'zh_CN';
    tabPlacementSubmenu.classList.remove('lang-zh', 'lang-en');
    tabPlacementSubmenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');
    tabPlacementSubmenu.innerHTML = [
        { value: 'root', zh: '所有标签页末尾', en: 'End of tab strip', icon: 'align-justify' },
        { value: 'before-current', zh: '当前标签页上方', en: 'Above current tab', icon: 'arrow-up' },
        { value: 'after-current', zh: '当前标签页下方', en: 'Below current tab', icon: 'arrow-down' }
    ].map(option => `
        <div class="context-menu-item ${newTabPlacement === option.value ? 'selected-open' : ''}" data-action="set-tab-placement" data-placement="${option.value}">
            <i class="fas fa-${option.icon}"></i>
            <span class="context-menu-item-label"><span>${lang === 'zh_CN' ? option.zh : option.en}</span></span>
        </div>
    `).join('');
    tabPlacementSubmenu.querySelectorAll('[data-action="set-tab-placement"]').forEach(item => {
        item.addEventListener('click', async event => {
            event.stopPropagation();
            await setNewTabPlacement(item.dataset.placement);
            hideTabPlacementSubmenu();
        });
    });
}

// 构建菜单项
function buildMenuItems(context) {
    const nodeId = context.nodeId;
    const nodeTitle = context.nodeTitle;
    const nodeUrl = context.nodeUrl;
    const isFolder = context.isFolder;
    const treeType = context.treeType || 'permanent';
    const lang = currentLang || 'zh_CN';
    const items = [];

    // 检查是否有选中项
    const hasSelection = selectedNodes.size > 0;

    // 检查当前右键的项是否已被选中
    const isNodeSelected = selectedNodes.has(nodeId);

    // 批量模式下，节点右键菜单只提供剪贴板定位粘贴；其它批量操作统一由批量面板处理。
    if (selectMode) {
        const pasteDisabled = !hasClipboard();
        const pasteItems = [
            { action: 'paste-above', label: lang === 'zh_CN' ? '粘贴到上方' : 'Paste Above', icon: 'paste', disabled: pasteDisabled },
            ...(isFolder ? [{ action: 'paste', label: lang === 'zh_CN' ? '粘贴到文件夹内' : 'Paste into Folder', icon: 'paste', disabled: pasteDisabled }] : []),
            { action: 'paste-below', label: lang === 'zh_CN' ? '粘贴到下方' : 'Paste Below', icon: 'paste', disabled: pasteDisabled }
        ];
        return pasteItems;
    }

    // 如果右键的是已选中的项，且有多个选中项，显示批量操作菜单
    if (isNodeSelected && selectedNodes.size > 0) {
        items.push(
            { action: 'batch-open', label: lang === 'zh_CN' ? `打开选中的 ${selectedNodes.size} 项` : `Open ${selectedNodes.size} Selected`, icon: 'folder-open' },
            { action: 'batch-open-tab-group', label: lang === 'zh_CN' ? '在新标签页组中打开' : 'Open in New Tab Group', icon: 'object-group' },
            { separator: true },
            { action: 'batch-cut', label: lang === 'zh_CN' ? '剪切选中项' : 'Cut Selected', icon: 'cut' },
            { action: 'batch-delete', label: lang === 'zh_CN' ? '删除选中项' : 'DELETE', icon: 'trash-alt' },
            { action: 'tag-submenu-trigger', label: lang === 'zh_CN' ? '标签' : 'Tags', icon: 'hashtag', hasSubmenu: true },
            { action: 'batch-clear-tags', label: lang === 'zh_CN' ? '清除标签' : 'Clear Tags', icon: 'times-circle' },
            { action: 'batch-edit-note', label: lang === 'zh_CN' ? '批量编辑笔记' : 'Batch Edit Notes', icon: 'sticky-note' },
            { action: 'batch-clear-note', label: lang === 'zh_CN' ? '清除笔记' : 'Clear Notes', icon: 'eraser' },
            { action: 'batch-rename', label: lang === 'zh_CN' ? '批量重命名' : 'Batch Rename', icon: 'edit' },
            { separator: true },
            { action: 'batch-export-html', label: lang === 'zh_CN' ? '导出为HTML' : 'Export to HTML', icon: 'file-code' },
            { action: 'batch-export-json', label: lang === 'zh_CN' ? '导出为JSON' : 'Export to JSON', icon: 'file-alt' },
            { action: 'batch-merge-folder', label: lang === 'zh_CN' ? '合并为新文件夹' : 'Merge to New Folder', icon: 'folder-plus' },
            { separator: true },
            { action: 'deselect-all', label: lang === 'zh_CN' ? '取消全选' : 'Deselect All', icon: 'times' }
        );
        return items;
    }

    // 普通单项菜单
    // 普通单项菜单
    if (isFolder) {
        // 文件夹菜单 - 按分组组织
        items.push(
            // 选择组
            { action: 'select-item', label: lang === 'zh_CN' ? (contextMenuHorizontal ? '选择' : '选择（批量操作）') : (contextMenuHorizontal ? 'Select' : 'Select (Batch)'), icon: 'check-square', group: 'actions' },
            {
                action: 'info-submenu-trigger',
                label: lang === 'zh_CN' ? '信息与笔记' : 'Info & Notes',
                icon: 'info-circle',
                group: 'actions',
                hasSubmenu: true
            },
            { action: 'tag-submenu-trigger', label: lang === 'zh_CN' ? '标签' : 'Tags', icon: 'hashtag', group: 'actions', hasSubmenu: true },

            // 临时溯源放在重命名上方
            {
                action: 'trace-submenu-trigger',
                label: lang === 'zh_CN' ? '临时溯源' : 'Temporary Trace',
                icon: 'route',
                group: 'actions',
                hasSubmenu: true
            },

            // 编辑组 - 紧跟在select后面
            { action: 'rename', label: lang === 'zh_CN' ? '重命名' : 'Rename', icon: 'edit', group: 'actions' },
            {
                action: 'add-entry',
                labelHTML: `<span class="swsg-title">${lang === 'zh_CN' ? '添加' : 'Add'}</span><div class="swsg-badge-row"><span class="sub-badge" data-sub-action="add-template-run">${lang === 'zh_CN' ? '上次' : 'Last'}</span></div>`,
                label: lang === 'zh_CN' ? '添加' : 'Add',
                icon: 'plus-circle',
                group: 'actions',
                className: 'add-entry-option',
                hidden: false
            },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', group: 'actions' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy', group: 'actions' },
            { action: 'paste-below', label: lang === 'zh_CN' ? (contextMenuHorizontal ? '粘贴到下方' : '粘贴到该文件夹下方') : (contextMenuHorizontal ? 'Paste Below' : 'Paste Below Folder'), icon: 'paste', disabled: !hasClipboard(), hidden: !hasClipboard(), group: 'actions' },
            { separator: true },

            // 打开方式（二级菜单）
            {
                action: 'open-submenu-trigger',
                label: lang === 'zh_CN' ? '打开方式' : 'Open Mode',
                icon: 'external-link-alt',
                group: 'open',
                hasSubmenu: true
            },
            { separator: true },

            // 结构/设置组（合并第三组）
            { action: 'add-page', label: lang === 'zh_CN' ? '添加网页' : 'Add Page', icon: 'plus-circle', group: 'structure', hidden: true },
            { action: 'add-folder', label: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder', icon: 'folder-plus', group: 'structure', hidden: true },
            { action: 'toggle-context-menu-layout', label: contextMenuHorizontal ? (lang === 'zh_CN' ? '纵向布局' : 'Vertical') : (lang === 'zh_CN' ? '横向布局' : 'Horizontal'), icon: 'exchange-alt', group: 'structure' },
            { separator: true },
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt', group: 'structure' }
        );
    } else {
        // 书签菜单 - 按分组组织
        items.push(
            // 选择组
            { action: 'select-item', label: lang === 'zh_CN' ? (contextMenuHorizontal ? '选择' : '选择（批量操作）') : (contextMenuHorizontal ? 'Select' : 'Select (Batch)'), icon: 'check-square', group: 'actions' },
            {
                action: 'info-submenu-trigger',
                label: lang === 'zh_CN' ? '信息与笔记' : 'Info & Notes',
                icon: 'info-circle',
                group: 'actions',
                hasSubmenu: true
            },
            { action: 'tag-submenu-trigger', label: lang === 'zh_CN' ? '标签' : 'Tags', icon: 'hashtag', group: 'actions', hasSubmenu: true },

            // 临时溯源放在编辑上方
            {
                action: 'trace-submenu-trigger',
                label: lang === 'zh_CN' ? '临时溯源' : 'Temporary Trace',
                icon: 'route',
                group: 'actions',
                hasSubmenu: true
            },

            // 编辑组 - 紧跟在select后面
            { action: 'edit', label: lang === 'zh_CN' ? '编辑' : 'Edit', icon: 'edit', group: 'actions' },
            {
                action: 'add-entry',
                labelHTML: `<span class="swsg-title">${lang === 'zh_CN' ? '添加' : 'Add'}</span><div class="swsg-badge-row"><span class="sub-badge" data-sub-action="add-template-run">${lang === 'zh_CN' ? '上次' : 'Last'}</span></div>`,
                label: lang === 'zh_CN' ? '添加' : 'Add',
                icon: 'plus-circle',
                group: 'actions',
                className: 'add-entry-option',
                hidden: false
            },
            { action: 'cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', group: 'actions' },
            { action: 'copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy', group: 'actions' },
            { action: 'paste', label: lang === 'zh_CN' ? '粘贴到下方' : 'Paste Below', icon: 'paste', disabled: !hasClipboard(), hidden: !hasClipboard(), group: 'actions' },
            { separator: true },

            // 打开组（二级菜单）
            {
                action: 'open-submenu-trigger',
                label: lang === 'zh_CN' ? '默认打开模式' : 'Default Open Mode',
                icon: 'external-link-alt',
                group: 'open',
                hasSubmenu: true
            },
            { separator: true },

            // 设置组
            { action: 'toggle-context-menu-layout', label: contextMenuHorizontal ? (lang === 'zh_CN' ? '纵向布局' : 'Vertical') : (lang === 'zh_CN' ? '横向布局' : 'Horizontal'), icon: 'exchange-alt', group: 'settings' },
            { separator: true },
            { action: 'delete', label: lang === 'zh_CN' ? '删除' : 'Delete', icon: 'trash-alt', group: 'settings' }
        );
    }

    return items;
}

// 将菜单嵌入到DOM中（已弃用，保留以维持向后兼容性）
function embedContextMenu(node) {
    // 从当前位置移除菜单
    if (contextMenu.parentElement) {
        contextMenu.parentElement.removeChild(contextMenu);
    }

    // 找到合适的插入位置
    // 将菜单插入到被右键的节点后面
    const parent = node.parentElement;
    const nextSibling = node.nextSibling;

    if (nextSibling) {
        parent.insertBefore(contextMenu, nextSibling);
    } else {
        parent.appendChild(contextMenu);
    }

    // 使用相对定位，嵌入文档流
    contextMenu.style.cssText = `
        position: relative !important;
        display: block !important;
        margin-left: 20px !important;
        margin-top: 5px !important;
        margin-bottom: 5px !important;
    `;

    ;
}

// 使用固定定位定位一级菜单（悬浮在卡片之上）
function positionPrimaryContextMenu(event, node) {
    // 确保菜单在body中
    if (contextMenu.parentElement !== getOverlayContainer()) {
        getOverlayContainer().appendChild(contextMenu);
    }

    // 计算缩放比例
    let scale = 1;
    if (node) {
        const scaleInfo = __getBookmarkAddLocateContainerScale(node);
        if (scaleInfo && scaleInfo.scaleX) {
            scale = scaleInfo.scaleX;
        }
    }

    // 设置基本定位样式
    contextMenu.style.cssText = `
        position: fixed !important;
        display: block !important;
        margin: 0 !important;
        z-index: 10001 !important;
        transform: scale(${scale}) !important;
        transform-origin: top left !important;
    `;

    // 获取点击位置
    let clickX = 0;
    let clickY = 0;

    // 检查是不是在已开启菜单上点击了切换布局等操作重新渲染菜单
    const isClickInsideMenu = event && event.target && contextMenu && contextMenu.contains(event.target);

    if (isClickInsideMenu) {
        const menuRect = contextMenu.getBoundingClientRect();
        clickX = menuRect.left;
        clickY = menuRect.top;
    } else if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        clickX = event.clientX;
        clickY = event.clientY;
    } else if (node) {
        const nodeRect = node.getBoundingClientRect();
        clickX = nodeRect.left;
        clickY = nodeRect.bottom;
    }

    // 获取菜单尺寸（先显示以获取真实尺寸）
    contextMenu.style.visibility = 'hidden';
    contextMenu.style.display = 'block';
    const menuRect = contextMenu.getBoundingClientRect();
    contextMenu.style.visibility = 'visible';

    // 视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;

    // 计算在缩放下的视觉大小
    const visualWidth = menuRect.width;
    const visualHeight = menuRect.height;

    // 计算最佳位置（默认在鼠标右下方）
    let left = clickX + 2;
    let top = clickY + 2;

    // 防止超出右边界
    if (left + visualWidth > viewportWidth - margin) {
        left = clickX - visualWidth - 2;
    }

    // 防止超出左边界
    if (left < margin) {
        left = margin;
    }

    // 防止超出底部边界
    if (top + visualHeight > viewportHeight - margin) {
        top = clickY - visualHeight - 2;
    }

    // 防止超出顶部边界
    if (top < margin) {
        top = margin;
    }

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.right = 'auto';
    contextMenu.style.bottom = 'auto';

    ;
}

// 隐藏菜单
function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
        contextMenu.style.left = ''; // Reset custom position!
        contextMenu.style.top = '';  // Reset custom position!
        contextMenu.style.position = ''; // Reset custom position!
        contextMenu.style.margin = ''; // Reset custom position!
        contextMenu.style.transform = ''; // Reset transform!
        contextMenu.style.transformOrigin = ''; // Reset transform-origin!

        // 将菜单移回body/fullscreen容器，避免影响DOM结构
        if (contextMenu.parentElement !== getOverlayContainer()) {
            getOverlayContainer().appendChild(contextMenu);
        }
    }

    if (contextSubmenu) {
        hideSubmenu();

        // 将子菜单移回body/fullscreen容器，避免影响DOM结构
        if (contextSubmenu.parentElement !== getOverlayContainer()) {
            getOverlayContainer().appendChild(contextSubmenu);
        }
    }

    if (tabPlacementSubmenu && tabPlacementSubmenu.parentElement !== getOverlayContainer()) {
        getOverlayContainer().appendChild(tabPlacementSubmenu);
    }

    // 移除右键选中标识
    document.querySelectorAll('.tree-item.context-selected').forEach(item => {
        item.classList.remove('context-selected');
    });

    currentContextNode = null;
}

// 显示粘贴按钮
function showPasteButton() {
    if (!contextMenu) return;
    const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
    if (pasteBtn) {
        pasteBtn.style.display = 'inline-flex';
        pasteBtn.classList.remove('paste-hidden');
    }
    const pasteBelowBtn = contextMenu.querySelector('[data-action="paste-below"]');
    if (pasteBelowBtn) {
        pasteBelowBtn.style.display = 'inline-flex';
        pasteBelowBtn.classList.remove('paste-hidden');
    }
}

// 隐藏粘贴按钮
function hidePasteButton() {
    if (!contextMenu) return;
    const pasteBtn = contextMenu.querySelector('[data-action="paste"]');
    if (pasteBtn) {
        pasteBtn.style.display = 'none';
        pasteBtn.classList.add('paste-hidden');
    }
    const pasteBelowBtn = contextMenu.querySelector('[data-action="paste-below"]');
    if (pasteBelowBtn) {
        pasteBelowBtn.style.display = 'none';
        pasteBelowBtn.classList.add('paste-hidden');
    }
}

// 检查是否有剪贴板内容
function hasClipboard() {
    return bookmarkClipboard !== null;
}

function getTempManager() {
    return (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
}


// =================================================================================
// VII. TRACE, INFO/TAG SUBMENUS & TEMPORARY TREE OPERATIONS (溯源、信息/标签子菜单与临时树操作)
// =================================================================================

// ==================== 临时溯源核心逻辑 ====================
window.__activeTraces = [];

const TRACE_PALETTE = {
    red: { hex: '#ff453a', rgb: [255, 69, 58], class: 'tag-dot-red', labelZh: '红色', labelEn: 'Red' },
    orange: { hex: '#ff9f0a', rgb: [255, 159, 10], class: 'tag-dot-orange', labelZh: '橙色', labelEn: 'Orange' },
    yellow: { hex: '#ffd60a', rgb: [255, 214, 10], class: 'tag-dot-yellow', labelZh: '黄色', labelEn: 'Yellow' },
    green: { hex: '#30d158', rgb: [48, 209, 88], class: 'tag-dot-green', labelZh: '绿色', labelEn: 'Green' },
    blue: { hex: '#0a84ff', rgb: [10, 132, 255], class: 'tag-dot-blue', labelZh: '蓝色', labelEn: 'Blue' },
    purple: { hex: '#bf5af2', rgb: [191, 90, 242], class: 'tag-dot-purple', labelZh: '紫色', labelEn: 'Purple' },
    gray: { hex: '#8e8e93', rgb: [142, 142, 147], class: 'tag-dot-gray', labelZh: '灰色', labelEn: 'Gray' }
};

let currentTraceLevel = '2'; // 默认溯源层级

const traceSyncChannel = new BroadcastChannel('bookmark-canvas-trace-sync');
traceSyncChannel.onmessage = (event) => {
    const { action, traces } = event.data;
    if (action === 'sync-traces') {
        window.__activeTraces = traces || [];
        if (typeof window.__updateTraceHighlights === 'function') {
            window.__updateTraceHighlights();
        }
    } else if (action === 'request-traces-state') {
        if (window.__activeTraces && window.__activeTraces.length > 0) {
            broadcastTraces();
        }
    }
};

function broadcastTraces() {
    try {
        traceSyncChannel.postMessage({
            action: 'sync-traces',
            traces: window.__activeTraces
        });
    } catch (e) {
        console.warn('[Trace Sync] Broadcast failed:', e);
    }
}

// 启动时请求其他页面的溯源状态
try {
    traceSyncChannel.postMessage({ action: 'request-traces-state' });
} catch (e) {}

// 页面隐藏/卸载（如关闭侧边栏/标签页）时，清空当前溯源状态并广播给其他同步页面
function clearAndBroadcastTracesOnUnload() {
    if (window.__activeTraces && window.__activeTraces.length > 0) {
        window.__activeTraces = [];
        broadcastTraces();
        if (typeof window.__updateTraceHighlights === 'function') {
            window.__updateTraceHighlights();
        }
    }
}
window.addEventListener('pagehide', clearAndBroadcastTracesOnUnload);
window.addEventListener('beforeunload', clearAndBroadcastTracesOnUnload);

// 计算指定节点元素上方实际有多少级可追溯的父目录
function getAvailableLevelsAbove(nodeElement) {
    if (!nodeElement) return 0;

    let count = 0;
    let currentItem = nodeElement;
    while (true) {
        const currentNode = currentItem.closest('.tree-node');
        if (!currentNode) break;

        const parentChildren = currentNode.parentElement.closest('.tree-children');
        if (!parentChildren) break;

        const parentNode = parentChildren.closest('.tree-node');
        if (!parentNode) break;

        const parentItem = parentNode.querySelector(':scope > .tree-item');
        if (!parentItem) break;

        currentItem = parentItem;
        count++;
    }
    return count;
}

// DOM爬取路径元素：从指定的.tree-item向上查找指定层级的父节点和父连线
function getDOMPathElements(startItem, level) {
    const pathElements = [];
    if (!startItem) return pathElements;

    let currentItem = startItem;
    pathElements.push(currentItem);

    const maxParents = (level === 'root') ? Infinity : parseInt(level, 10);

    let parentCount = 0;
    while (parentCount < maxParents) {
        const currentNode = currentItem.closest('.tree-node');
        if (!currentNode) break;

        const parentChildren = currentNode.parentElement.closest('.tree-children');
        if (!parentChildren) break;

        // 垂直导引线是由 tree-children 容器的 border-left (或其 pseudo-element) 渲染的
        pathElements.push(parentChildren);

        const parentNode = parentChildren.closest('.tree-node');
        if (!parentNode) break;

        const parentItem = parentNode.querySelector(':scope > .tree-item');
        if (!parentItem) break;

        currentItem = parentItem;
        pathElements.push(currentItem);
        parentCount++;
    }

    return pathElements;
}

// 混合多个重合颜色，求 RGB 平均值
function blendColors(colorNames) {
    if (!colorNames || colorNames.size === 0) return null;
    if (colorNames.size === 1) {
        const name = Array.from(colorNames)[0];
        return TRACE_PALETTE[name] || null;
    }

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;

    for (const name of colorNames) {
        const color = TRACE_PALETTE[name];
        if (color && color.rgb) {
            sumR += color.rgb[0];
            sumG += color.rgb[1];
            sumB += color.rgb[2];
            count++;
        }
    }

    if (count === 0) return null;

    const avgR = Math.round(sumR / count);
    const avgG = Math.round(sumG / count);
    const avgB = Math.round(sumB / count);

    const hex = '#' + [avgR, avgG, avgB].map(x => {
        const s = x.toString(16);
        return s.length === 1 ? '0' + s : s;
    }).join('');

    return {
        hex,
        rgb: [avgR, avgG, avgB]
    };
}

// 取消经过指定点击元素的 trace
function cancelTracesPassingThrough(clickedElement) {
    if (!window.__activeTraces || window.__activeTraces.length === 0) return;

    const tracesToRemove = new Set();

    for (const trace of window.__activeTraces) {
        const startItems = document.querySelectorAll(`.tree-item[data-node-id="${trace.targetId}"]`);
        let passes = false;
        for (const startItem of startItems) {
            const path = getDOMPathElements(startItem, trace.level);
            if (path.includes(clickedElement)) {
                passes = true;
                break;
            }
        }
        if (passes) {
            tracesToRemove.add(trace.targetId);
        }
    }

    if (tracesToRemove.size > 0) {
        window.__activeTraces = window.__activeTraces.filter(t => !tracesToRemove.has(t.targetId));
        broadcastTraces();
        window.__updateTraceHighlights();
    }
}

function getTraceCardScope(nodeElement) {
    if (!nodeElement || !nodeElement.closest) return { key: '', card: null };
    const tempCard = nodeElement.closest('.temp-canvas-node[data-section-id]');
    if (tempCard) {
        const sectionId = tempCard.dataset && tempCard.dataset.sectionId ? String(tempCard.dataset.sectionId) : '';
        return { key: sectionId ? `temporary:${sectionId}` : '', card: tempCard };
    }

    const permanentCard = nodeElement.closest('.permanent-bookmark-section');
    if (permanentCard) {
        const copyId = permanentCard.dataset && permanentCard.dataset.permanentSectionCopyId
            ? String(permanentCard.dataset.permanentSectionCopyId)
            : '';
        const cardId = copyId || permanentCard.id || 'permanent-main';
        return { key: `permanent:${cardId}`, card: permanentCard };
    }

    const tree = nodeElement.closest('.bookmark-tree, .temp-bookmark-tree');
    return { key: '', card: tree || null };
}

function collectTraceTargetIdsInCard(cardElement) {
    const ids = new Set();
    if (!cardElement || !cardElement.querySelectorAll) return ids;
    cardElement.querySelectorAll('.tree-item[data-node-id]').forEach((item) => {
        const id = item && item.dataset ? String(item.dataset.nodeId || '').trim() : '';
        if (id) ids.add(id);
    });
    return ids;
}

function clearTracesForCurrentCard(context) {
    if (!window.__activeTraces || window.__activeTraces.length === 0) return false;
    const nodeElement = (context && context.node) || currentContextNode;
    const scope = getTraceCardScope(nodeElement);
    const cardTargetIds = collectTraceTargetIdsInCard(scope.card);
    if (!scope.key && cardTargetIds.size === 0) return false;

    const originalLength = window.__activeTraces.length;
    window.__activeTraces = window.__activeTraces.filter((trace) => {
        const targetId = String(trace && trace.targetId || '').trim();
        const traceScopeKey = String(trace && trace.scopeKey || '').trim();
        if (scope.key && traceScopeKey && traceScopeKey === scope.key) return false;
        return !targetId || !cardTargetIds.has(targetId);
    });

    if (window.__activeTraces.length === originalLength) return false;
    broadcastTraces();
    window.__updateTraceHighlights();
    return true;
}

// 更新 DOM 的溯源高亮渲染
window.__updateTraceHighlights = function() {
    // 1. 清除旧高亮及所有自定义高度、偏移、并排颜色线等属性
    const prevHighlighted = document.querySelectorAll('.has-trace');
    prevHighlighted.forEach(el => {
        el.classList.remove('has-trace');
        el.classList.remove('has-trace-no-line');
        el.style.removeProperty('--trace-color');
        el.style.removeProperty('--trace-shadow-color');
        el.style.removeProperty('--trace-line-top');
        el.style.removeProperty('--trace-line-height');
        el.style.removeProperty('--trace-line-width');
        el.style.removeProperty('--trace-line-background');
        el.style.removeProperty('--trace-item-line-height');
        el.style.removeProperty('--trace-item-line-background');
        el.style.removeProperty('--trace-text-gradient');
        el.style.removeProperty('--trace-text-shadow');
    });

    if (!window.__activeTraces || window.__activeTraces.length === 0) return;

    // Helper: 计算元素相对于其容器祖先元素的本地 offsetTop 偏移量，避免受 CSS 缩放/变换影响
    function getRelativeOffsetTop(element, ancestor) {
        let offsetTop = 0;
        let curr = element;
        while (curr && curr !== ancestor) {
            offsetTop += curr.offsetTop || 0;
            curr = curr.offsetParent;
        }
        if (curr !== ancestor) {
            const rectEl = element.getBoundingClientRect();
            const rectAnc = ancestor.getBoundingClientRect();
            return rectEl.top - rectAnc.top;
        }
        return offsetTop;
    }

    // 2. 映射 DOM 节点到颜色名集合，并计算每个垂直引导线的最远点高度与顶部偏移量
    const elementColorsMap = new Map();
    const childrenHeightsMap = new Map();
    const startItemsSet = new Set();

    for (const trace of window.__activeTraces) {
        const startItems = document.querySelectorAll(`.tree-item[data-node-id="${trace.targetId}"]`);
        for (const startItem of startItems) {
            startItemsSet.add(startItem);
            const path = getDOMPathElements(startItem, trace.level);

            // 逐级向上爬取并精确算得垂直引导线的可见截断高度和顶部偏移量
            let currentItem = startItem;
            const maxParents = (trace.level === 'root') ? Infinity : parseInt(trace.level, 10);
            let parentCount = 0;
            while (parentCount < maxParents) {
                const currentNode = currentItem.closest('.tree-node');
                if (!currentNode) break;

                const parentChildren = currentNode.parentElement.closest('.tree-children');
                if (!parentChildren) break;

                const itemHeight = currentItem.offsetHeight || 0;
                const rectChildren = parentChildren.getBoundingClientRect();
                if (itemHeight > 0 && rectChildren.height > 0) {
                    const localOffsetTop = getRelativeOffsetTop(currentItem, parentChildren);
                    const height = localOffsetTop + itemHeight / 2;

                    // 计算 parentItem 的 center Y，得到精确 of topOffset
                    const parentNode = parentChildren.closest('.tree-node');
                    const parentItem = parentNode ? parentNode.querySelector(':scope > .tree-item') : null;
                    let topOffset = -14; // 默认 fallback
                    if (parentItem) {
                        const parentItemHeight = parentItem.offsetHeight || 0;
                        if (parentItemHeight > 0) {
                            const parentItemOffsetTop = parentItem.offsetTop || 0;
                            const parentChildrenOffsetTop = parentChildren.offsetTop || 0;
                            topOffset = (parentItemOffsetTop + parentItemHeight / 2) - parentChildrenOffsetTop;
                        } else {
                            const rectParentItem = parentItem.getBoundingClientRect();
                            if (rectParentItem.height > 0) {
                                const parentCenterY = rectParentItem.top + rectParentItem.height / 2;
                                topOffset = parentCenterY - rectChildren.top;
                            }
                        }
                    }

                    if (!childrenHeightsMap.has(parentChildren) || height > childrenHeightsMap.get(parentChildren).height) {
                        childrenHeightsMap.set(parentChildren, { height, topOffset });
                    }
                }

                const parentNode = parentChildren.closest('.tree-node');
                if (!parentNode) break;

                const parentItem = parentNode.querySelector(':scope > .tree-item');
                if (!parentItem) break;

                currentItem = parentItem;
                parentCount++;
            }

            for (const el of path) {
                if (!elementColorsMap.has(el)) {
                    elementColorsMap.set(el, new Set());
                }
                elementColorsMap.get(el).add(trace.colorName);
            }
        }
    }

    // 3. 决定哪些 tree-item 在溯源中作为最上级，不需要横线
    const noLineItemsSet = new Set();
    for (const el of elementColorsMap.keys()) {
        if (el.classList.contains('tree-item')) {
            // 如果该节点是任何溯源路线的起点（即目标节点本身），则必须给水平引导线上颜色，不能去除横线
            if (startItemsSet.has(el)) {
                continue;
            }
            const parentNode = el.closest('.tree-node');
            const parentChildren = parentNode ? parentNode.parentElement.closest('.tree-children') : null;
            if (!parentChildren || !elementColorsMap.has(parentChildren)) {
                noLineItemsSet.add(el);
            }
        }
    }

    // 4. 应用混合颜色和高亮到 DOM 节点
    for (const [el, colorsSet] of elementColorsMap.entries()) {
        const hexColors = Array.from(colorsSet).map(name => TRACE_PALETTE[name]?.hex).filter(Boolean);
        const rgbColors = Array.from(colorsSet).map(name => TRACE_PALETTE[name]?.rgb).filter(Boolean);

        if (hexColors.length > 0) {
            el.classList.add('has-trace');
            if (noLineItemsSet.has(el)) {
                el.classList.add('has-trace-no-line');
            }

            // 主要颜色变量设置为首选色作为 Fallback
            const primaryColor = hexColors[0];
            el.style.setProperty('--trace-color', primaryColor, 'important');

            // 阴影颜色也基于首选色
            const primaryRgb = rgbColors[0];
            const shadowColor = `rgba(${primaryRgb[0]}, ${primaryRgb[1]}, ${primaryRgb[2]}, 0.4)`;
            el.style.setProperty('--trace-shadow-color', shadowColor, 'important');

            // 1. 如果有多个颜色，构建平分颜色的线性渐变并赋给文本与图标的背景
            if (hexColors.length > 1) {
                const step = 100 / hexColors.length;
                const stops = [];
                hexColors.forEach((color, idx) => {
                    stops.push(`${color} ${idx * step}%`);
                    stops.push(`${color} ${(idx + 1) * step}%`);
                });
                const textGradient = `linear-gradient(to right, ${stops.join(', ')})`;
                el.style.setProperty('--trace-text-gradient', textGradient, 'important');
                el.style.setProperty('--trace-text-shadow', 'none', 'important'); // 禁用文字阴影以防干扰渐变字
            } else {
                el.style.setProperty('--trace-text-gradient', primaryColor, 'important');
                el.style.removeProperty('--trace-text-shadow');
            }

            // 2. 引导线绘制：如果是多颜色且不互相影响，利用无混色的多条并排（不重叠紧贴）实线绘制
            if (el.classList.contains('tree-children')) {
                const traceInfo = childrenHeightsMap.get(el);
                if (traceInfo) {
                    const lineTop = traceInfo.topOffset;
                    const lineHeight = traceInfo.height - traceInfo.topOffset;
                    el.style.setProperty('--trace-line-top', `${lineTop}px`, 'important');
                    el.style.setProperty('--trace-line-height', `${lineHeight}px`, 'important');
                } else {
                    el.style.setProperty('--trace-line-top', '-14px', 'important');
                    el.style.setProperty('--trace-line-height', 'calc(100% + 14px)', 'important');
                }

                if (hexColors.length > 1) {
                    const baseWidth = 1.5;
                    const totalWidth = baseWidth * hexColors.length;
                    const bgGradients = hexColors.map((color, idx) => {
                        return `linear-gradient(${color}, ${color}) no-repeat ${idx * baseWidth}px 0px / ${baseWidth}px 100%`;
                    });
                    el.style.setProperty('--trace-line-width', `${totalWidth}px`, 'important');
                    el.style.setProperty('--trace-line-background', bgGradients.join(', '), 'important');
                } else {
                    el.style.setProperty('--trace-line-width', '1.5px', 'important');
                    el.style.setProperty('--trace-line-background', primaryColor, 'important');
                }
            } else if (el.classList.contains('tree-item')) {
                if (hexColors.length > 1) {
                    const baseHeight = 1.5;
                    const totalHeight = baseHeight * hexColors.length;
                    const bgGradients = hexColors.map((color, idx) => {
                        return `linear-gradient(${color}, ${color}) no-repeat 0px ${idx * baseHeight}px / 100% ${baseHeight}px`;
                    });
                    el.style.setProperty('--trace-item-line-height', `${totalHeight}px`, 'important');
                    el.style.setProperty('--trace-item-line-background', bgGradients.join(', '), 'important');
                } else {
                    el.style.setProperty('--trace-item-line-height', '1.5px', 'important');
                    el.style.setProperty('--trace-item-line-background', primaryColor, 'important');
                }
            }
        }
    }
};

// 渲染二级溯源菜单
function renderTraceSubmenu(context) {
    if (!contextSubmenu) return;

    contextSubmenu.classList.remove('is-tag-submenu');
    contextSubmenu.classList.add('is-trace-submenu');

    const lang = currentLang || 'zh_CN';

    // 计算当前右键节点上方实际有多少个父层级可选
    const availableLevels = getAvailableLevelsAbove(currentContextNode);

    // 如果当前选中的层级越界，则降级到最大可用层级，或直接降为 Root (根)
    if (currentTraceLevel !== 'root') {
        const currentLvlNum = parseInt(currentTraceLevel, 10);
        if (isNaN(currentLvlNum) || currentLvlNum > availableLevels) {
            currentTraceLevel = availableLevels > 0 ? String(availableLevels) : 'root';
        }
    } else if (availableLevels === 0) {
        currentTraceLevel = 'root';
    }

    // 找出当前节点是否已经有临时溯源，如果有，获取其颜色
    const targetId = context.nodeId;
    const activeTrace = window.__activeTraces ? window.__activeTraces.find(t => t.targetId === targetId) : null;
    const activeColorName = activeTrace ? activeTrace.colorName : null;

    // 生成颜色按钮 HTML
    const colorsHtml = Object.keys(TRACE_PALETTE).map(name => {
        const color = TRACE_PALETTE[name];
        const label = lang === 'zh_CN' ? color.labelZh : color.labelEn;
        const isActiveColor = activeColorName === name;
        return `
            <button class="trace-palette-btn ${isActiveColor ? 'is-active' : ''}" data-color="${name}" title="${label}">
                <span class="tag-dot ${color.class}"></span>
            </button>
        `;
    }).join('');

    const levels = ['0'];
    if (availableLevels <= 15) {
        for (let i = 1; i <= availableLevels; i++) {
            levels.push(String(i));
        }
        levels.push('root');
    } else {
        for (let i = 1; i <= 14; i++) {
            levels.push(String(i));
        }
        levels.push('...');
        levels.push('root');
    }

    const levelsHtml = levels.map(lvl => {
        const isRoot = lvl === 'root';
        const isEllipsis = lvl === '...';
        const label = isRoot ? (lang === 'zh_CN' ? '根' : 'Root') : lvl;
        const isActive = currentTraceLevel === lvl;

        let style = `
            width: calc((100% - 20px) / 6);
            box-sizing: border-box;
            padding: 4px 0;
            font-size: 11px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            text-align: center;
            transition: all 0.1s ease;
        `;

        if (isEllipsis) {
            style += `
                background: transparent;
                border-color: transparent;
                color: var(--text-tertiary);
                cursor: default;
            `;
            return `
                <span class="trace-level-ellipsis" style="${style}">${label}</span>
            `;
        } else {
            style += `
                background: ${isActive ? 'var(--accent-primary)' : 'var(--bg-secondary)'};
                color: ${isActive ? '#ffffff' : 'var(--text-primary)'};
                cursor: pointer;
            `;
            return `
                <button class="trace-level-btn ${isActive ? 'active' : ''}"
                    data-level="${lvl}"
                    style="${style}">${label}</button>
            `;
        }
    }).join('');

    const descText = lang === 'zh_CN'
        ? '点击颜色可对当前节点向上追溯 guide lines、文本及图标高亮标记。<br/>- 向上溯源：可选不同层级或直到根目录。<br/>- 临时标记：<span style="color: var(--accent-orange, #ff9f0a); font-weight: 600;">不保存到存储，刷新或重开侧栏即消失。</span><br/>- 单层高亮：选择层级为 0 即可只高亮当前节点，充当临时高亮。<br/>- <span style="color: var(--accent-orange, #ff9f0a); font-weight: 600;">取消方式</span>：直接点击高亮引导线，或者开关插件侧边栏/标签页即可取消该溯源。'
        : 'Click color to trace upward guide lines, text and icons.<br/>- Levels: Select parent level or up to root directory.<br/>- Temporary: <span style="color: var(--accent-orange, #ff9f0a); font-weight: 600;">Saved in-memory only, lost on reload/reopen.</span><br/>- Single-layer Highlight: Select level 0 to highlight only the current node, serving as a temporary highlight.<br/>- <span style="color: var(--accent-orange, #ff9f0a); font-weight: 600;">Cancel</span>: Click on any highlighted guide line, or toggle the extension sidebar/tab to cancel.';

    const helpLabel = lang === 'zh_CN' ? '说明' : 'Info';

    contextSubmenu.innerHTML = `
        <div class="trace-submenu-header" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; position: relative;">
            <span style="font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
                ${lang === 'zh_CN' ? '临时溯源' : 'Temporary Trace'}
            </span>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button class="trace-clear-btn" title="${lang === 'zh_CN' ? '清除高亮' : 'Clear Highlight'}" style="background: transparent; border: none; padding: 2px; cursor: pointer; color: var(--text-tertiary); display: inline-flex; align-items: center; font-size: 12px; transition: color 0.12s ease;">
                    <i class="fas fa-trash-alt"></i>
                </button>
                <button class="trace-close-btn" title="${lang === 'zh_CN' ? '关闭' : 'Close'}" style="background: transparent; border: none; padding: 2px; cursor: pointer; color: var(--text-tertiary); display: inline-flex; align-items: center; font-size: 15px; transition: color 0.12s ease;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
        <div class="trace-popover-palette">
            <div class="trace-submenu-label" style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">
                ${lang === 'zh_CN' ? '选择标记颜色' : 'Select Trace Color'}
            </div>
            <div class="trace-popover-palette-colors">
                ${colorsHtml}
            </div>
        </div>
        <div class="trace-menu-divider" style="height: 1px; background: var(--border-color); margin: 4px 0; opacity: 0.5;"></div>
        <div class="trace-level-section" style="padding: 6px 12px 10px;">
            <div class="trace-submenu-label" style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;">
                ${lang === 'zh_CN' ? '向上溯源层级' : 'Trace Levels'}
            </div>
            <div class="trace-level-buttons" style="display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-start;">
                ${levelsHtml}
            </div>
        </div>
        <div class="trace-menu-divider" style="height: 1px; background: var(--border-color); margin: 4px 0; opacity: 0.5;"></div>
        <div class="trace-help-toggle-row">
            <span class="trace-help-trigger" style="font-size: 11px; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px; position: relative; cursor: pointer;">
                <i class="fas fa-question-circle"></i> ${helpLabel}
                <span class="trace-help-bubble">${descText}</span>
            </span>
            <button class="trace-clear-card-btn" type="button" title="${lang === 'zh_CN' ? '清除当前卡片全部溯源' : 'Clear all traces in this card'}">
                <i class="fas fa-broom"></i>
                <span>${lang === 'zh_CN' ? '清除全部' : 'Clear all'}</span>
            </button>
        </div>
    `;

    // 绑定颜色按钮事件
    contextSubmenu.querySelectorAll('.trace-palette-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const colorName = btn.dataset.color;
            const targetId = context.nodeId;
            const level = currentTraceLevel;
            const traceScope = getTraceCardScope((context && context.node) || currentContextNode);
            const nextTrace = { targetId, colorName, level };
            if (traceScope && traceScope.key) nextTrace.scopeKey = traceScope.key;

            const existingIndex = window.__activeTraces.findIndex(t => t.targetId === targetId);
            if (existingIndex !== -1) {
                window.__activeTraces[existingIndex] = nextTrace;
            } else {
                window.__activeTraces.push(nextTrace);
            }

            broadcastTraces();
            window.__updateTraceHighlights();
            hideContextMenu();
        });
    });

    // 绑定层级按钮事件 (忽略 disabled 状态)
    contextSubmenu.querySelectorAll('.trace-level-btn:not(.disabled)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const lvl = btn.dataset.level;
            currentTraceLevel = lvl;
            // 更新 UI 状态
            contextSubmenu.querySelectorAll('.trace-level-btn:not(.disabled)').forEach(b => {
                const isActive = b.dataset.level === lvl;
                b.style.background = isActive ? 'var(--accent-primary)' : 'var(--bg-secondary)';
                b.style.color = isActive ? '#ffffff' : 'var(--text-primary)';
            });
        });
    });

    // 绑定清除高亮事件
    const clearBtn = contextSubmenu.querySelector('.trace-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = context.nodeId;
            const originalLength = window.__activeTraces.length;
            window.__activeTraces = window.__activeTraces.filter(t => t.targetId !== targetId);
            if (window.__activeTraces.length !== originalLength) {
                broadcastTraces();
                window.__updateTraceHighlights();
            }
            hideContextMenu();
        });
    }

    const clearCardBtn = contextSubmenu.querySelector('.trace-clear-card-btn');
    if (clearCardBtn) {
        clearCardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTracesForCurrentCard(context);
            hideContextMenu();
        });
    }

    // 绑定退出面板事件
    const closeBtn = contextSubmenu.querySelector('.trace-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideContextMenu();
        });
    }
}

// 渲染二级信息菜单
function renderInfoSubmenu(context) {
    if (!contextSubmenu) return;

    contextSubmenu.classList.remove('is-tag-submenu', 'is-trace-submenu');
    contextSubmenu.classList.add('is-info-submenu');

    const lang = currentLang || 'zh_CN';
    const isTemporary = context.treeType === 'temporary';
    const nodeId = context.nodeId;

    // 尝试直接提取被右键节点的图标 HTML (优先使用其已渲染的 favicon 或图标类)
    let nodeIconHtml = '';
    const nodeEl = context.node;
    const treeIconEl = nodeEl ? nodeEl.querySelector('.tree-icon') : null;
    if (treeIconEl) {
        if (treeIconEl.tagName.toLowerCase() === 'img') {
            nodeIconHtml = `<img src="${escapeHtml(treeIconEl.src)}" class="info-card-favicon" style="width: 14px; height: 14px; border-radius: 3px; object-fit: contain; flex-shrink: 0; margin-right: 4px;" onerror="this.outerHTML='<i class=\\'fas fa-bookmark\\' style=\\'color: #f59e0b; font-size: 13.5px;\\'></i>'">`;
        } else {
            const iconClass = treeIconEl.className || '';
            const color = context.isFolder ? '#2563eb' : '#f59e0b';
            nodeIconHtml = `<i class="${escapeHtml(iconClass)}" style="color: ${color}; font-size: 13.5px; flex-shrink: 0;"></i>`;
        }
    }

    // 格式化时间辅助函数
    function formatInfoTime(timestamp) {
        if (!timestamp) return '';
        try {
            const date = new Date(timestamp);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
        } catch (_) {
            return '';
        }
    }

    const normalizeInfoNote = (raw) => {
        if (raw === undefined || raw === null) return '';
        return String(raw).replace(/\r\n?/g, '\n').trim();
    };

    const normalizeInfoTags = (tags) => {
        return (Array.isArray(tags) ? tags : [])
            .map((tag) => (tag && typeof tag === 'object')
                ? { color: String(tag.color || '').trim(), text: String(tag.text || '').trim() }
                : null)
            .filter((tag) => tag && tag.color);
    };

    const INFO_NOTE_COLOR_PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
    const INFO_NOTE_LAST_COLOR_STORAGE_KEY = 'infoNoteLastColor';
    const normalizeInfoNoteColor = (raw, fallback = 'orange') => {
        const color = String(raw || '').trim().toLowerCase();
        if (INFO_NOTE_COLOR_PALETTE.includes(color)) return color;
        const fallbackColor = String(fallback || '').trim().toLowerCase();
        return INFO_NOTE_COLOR_PALETTE.includes(fallbackColor) ? fallbackColor : 'orange';
    };

    const getLastInfoNoteColor = () => {
        try {
            return normalizeInfoNoteColor(localStorage.getItem(INFO_NOTE_LAST_COLOR_STORAGE_KEY));
        } catch (_) {
            return 'orange';
        }
    };

    const setLastInfoNoteColor = (colorInput) => {
        const color = normalizeInfoNoteColor(colorInput);
        try {
            localStorage.setItem(INFO_NOTE_LAST_COLOR_STORAGE_KEY, color);
        } catch (_) { }
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ [INFO_NOTE_LAST_COLOR_STORAGE_KEY]: color });
            }
        } catch (_) { }
        return color;
    };

    const renderInfoTagsHtml = (tags) => {
        const normalized = normalizeInfoTags(tags);
        const empty = lang === 'zh_CN' ? '无' : 'None';
        const label = lang === 'zh_CN' ? '标签' : 'TAGS';
        const chips = normalized.length
            ? normalized.map((tag) => {
                const colorClass = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].includes(tag.color) ? tag.color : 'gray';
                const text = tag.text || tag.color;
                return `<span class="info-tag-chip"><span class="tag-dot tag-dot-${escapeHtml(colorClass)}"></span><span>${escapeHtml(text)}</span></span>`;
            }).join('')
            : `<span class="info-card-value info-card-muted">${escapeHtml(empty)}</span>`;
        return `
            <div class="info-card-row info-card-tags-row">
                <span class="info-card-label">${label}</span>
                <div class="info-tag-chip-row">${chips}</div>
            </div>
        `;
    };

    const renderInfoNoteHtml = (note, noteColor) => {
        const safeNote = normalizeInfoNote(note);
        const safeColor = safeNote ? normalizeInfoNoteColor(noteColor) : getLastInfoNoteColor();
        const label = lang === 'zh_CN' ? '笔记' : 'NOTE';
        const placeholder = lang === 'zh_CN' ? '添加笔记...' : 'Add note...';
        const colorTitle = lang === 'zh_CN' ? '笔记颜色' : 'Note color';
        return `
            <div class="info-card-row info-card-note-row" data-note-color="${escapeHtml(safeColor)}">
                <div class="info-note-heading">
                    <span class="info-card-label">${label}</span>
                    <div class="info-note-color-palette" title="${escapeHtml(colorTitle)}" aria-label="${escapeHtml(colorTitle)}">
                        ${INFO_NOTE_COLOR_PALETTE.map((color) =>
                            `<button class="tag-palette-btn info-note-color-btn${color === safeColor ? ' is-selected' : ''}" data-note-color="${escapeHtml(color)}" type="button" aria-label="${escapeHtml(color)}"><span class="tag-dot tag-dot-${escapeHtml(color)}"></span></button>`
                        ).join('')}
                    </div>
                </div>
                <div class="info-note-editor note-color-${escapeHtml(safeColor)}">
                    <textarea class="info-note-textarea" rows="3" data-note-color="${escapeHtml(safeColor)}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(safeNote)}</textarea>
                </div>
            </div>
        `;
    };

    // 显示加载状态
    contextSubmenu.innerHTML = `
        <div class="info-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>${lang === 'zh_CN' ? '正在查询...' : 'Querying...'}</span>
        </div>
    `;

    const renderCard = (data) => {
        let titleIconHtml = nodeIconHtml;
        if (!titleIconHtml) {
            const titleIcon = data.type === 'folder' ? 'fa-folder' : 'fa-bookmark';
            const titleIconColor = data.type === 'folder' ? '#2563eb' : '#f59e0b';
            titleIconHtml = `<i class="fas ${titleIcon}" style="color: ${titleIconColor};"></i>`;
        }

        let pathHtml = '';
        if (data.path) {
            const needsTrunc = data.needsTruncation || data.path.startsWith('.../');
            const pathStr = data.pathStr || (needsTrunc ? data.path.substring(4) : data.path);
            if (needsTrunc) {
                pathHtml = `
                    <div class="info-card-row">
                        <span class="info-card-label">${lang === 'zh_CN' ? '路径' : 'PATH'}</span>
                        <div class="info-path-container">
                            <span class="info-card-value info-path-collapsed">
                                <button class="info-path-ellipsis-toggle" type="button">...</button>/${escapeHtml(pathStr)}
                            </span>
                            <span class="info-card-value info-path-expanded" style="display: none;">
                                ${escapeHtml(data.fullPath || data.path)}
                                <button class="info-path-collapse-toggle" type="button">${lang === 'zh_CN' ? '收起' : 'Collapse'}</button>
                            </span>
                        </div>
                    </div>
                `;
            } else {
                pathHtml = `
                    <div class="info-card-row">
                        <span class="info-card-label">${lang === 'zh_CN' ? '路径' : 'PATH'}</span>
                        <span class="info-card-value info-path-expanded">${escapeHtml(data.fullPath || data.path)}</span>
                    </div>
                `;
            }
        }

        let urlHtml = '';
        if (data.url) {
            urlHtml = `
                <div class="info-card-row">
                    <span class="info-card-label">URL</span>
                    <div class="info-url-row">
                        <span class="info-url-text" title="${escapeHtml(data.url)}">${escapeHtml(data.url)}</span>
                        <button class="info-copy-btn" id="infoCopyUrlBtn" data-url="${escapeHtml(data.url)}" title="${lang === 'zh_CN' ? '复制链接' : 'Copy Link'}">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        let timesHtml = '';
        if (!isTemporary) {
            const addedTime = formatInfoTime(data.dateAdded);
            const modifiedTime = data.type === 'folder' ? formatInfoTime(data.dateGroupModified) : '';

            if (data.type === 'folder' && modifiedTime) {
                timesHtml = `
                    <div class="info-card-times-row">
                        <div class="info-card-row">
                            <span class="info-card-label">${lang === 'zh_CN' ? '创建时间' : 'CREATED AT'}</span>
                            <span class="info-card-value">${escapeHtml(addedTime || '-')}</span>
                        </div>
                        <div class="info-card-row">
                            <span class="info-card-label">${lang === 'zh_CN' ? '修改时间' : 'MODIFIED AT'}</span>
                            <span class="info-card-value">${escapeHtml(modifiedTime || '-')}</span>
                        </div>
                    </div>
                `;
            } else {
                timesHtml = `
                    <div class="info-card-row">
                        <span class="info-card-label">${lang === 'zh_CN' ? '创建时间' : 'CREATED AT'}</span>
                        <span class="info-card-value">${escapeHtml(addedTime || '-')}</span>
                    </div>
                `;
            }
        }

        const closeLabel = lang === 'zh_CN' ? '关闭' : 'Close';

        return `
            <div class="info-card-container">
                <div class="info-card-title-row">
                    ${titleIconHtml}
                    <span class="info-card-title-text" title="${escapeHtml(data.title)}">${escapeHtml(data.title)}</span>
                    <button class="tag-popover-close info-card-close-btn" data-role="close-info-popover" type="button" title="${escapeHtml(closeLabel)}" aria-label="${escapeHtml(closeLabel)}">
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>
                    </button>
                </div>
                ${pathHtml}
                ${urlHtml}
                ${timesHtml}
                ${renderInfoTagsHtml(data.tags)}
                ${renderInfoNoteHtml(data.note, data.noteColor)}
            </div>
        `;
    };

    const bindCopyEvent = () => {
        const copyBtn = contextSubmenu.querySelector('#infoCopyUrlBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const url = copyBtn.dataset.url;
                if (!url) return;
                try {
                    await navigator.clipboard.writeText(url);
                    copyBtn.classList.add('copied');
                    const icon = copyBtn.querySelector('i');
                    if (icon) {
                        icon.className = 'fas fa-check';
                    }
                    if (typeof showToast === 'function') {
                        showToast(lang === 'zh_CN' ? '已复制链接' : 'Link copied');
                    }
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        if (icon) {
                            icon.className = 'fas fa-copy';
                        }
                    }, 1500);
                } catch (err) {
                    console.error('Copy failed:', err);
                }
            });
        }
    };

    const bindPathToggleEvent = () => {
        const container = contextSubmenu.querySelector('.info-path-container');
        if (!container) return;
        const ellipsisBtn = container.querySelector('.info-path-ellipsis-toggle');
        const collapseBtn = container.querySelector('.info-path-collapse-toggle');
        const collapsedSpan = container.querySelector('.info-path-collapsed');
        const expandedSpan = container.querySelector('.info-path-expanded');

        if (ellipsisBtn && collapsedSpan && expandedSpan) {
            ellipsisBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                collapsedSpan.style.display = 'none';
                expandedSpan.style.display = 'block';
            });
        }
        if (collapseBtn && collapsedSpan && expandedSpan) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                expandedSpan.style.display = 'none';
                collapsedSpan.style.display = '';
            });
        }
    };

    const bindInfoCloseEvent = () => {
        const closeBtn = contextSubmenu.querySelector('[data-role="close-info-popover"]');
        if (!closeBtn) return;
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideContextMenu();
        });
    };

    const bindNoteEditorEvent = (data) => {
        const textarea = contextSubmenu.querySelector('.info-note-textarea');
        const noteRow = contextSubmenu.querySelector('.info-card-note-row');
        const editor = contextSubmenu.querySelector('.info-note-editor');
        if (!textarea || !data || !data.target) return;
        let selectedColor = normalizeInfoNote(data.note) ? normalizeInfoNoteColor(data.noteColor) : getLastInfoNoteColor();
        let saveChain = Promise.resolve();

        const applyColorUi = (colorInput) => {
            selectedColor = normalizeInfoNoteColor(colorInput, selectedColor);
            if (noteRow) noteRow.dataset.noteColor = selectedColor;
            if (textarea) textarea.dataset.noteColor = selectedColor;
            if (editor) {
                INFO_NOTE_COLOR_PALETTE.forEach((color) => editor.classList.remove(`note-color-${color}`));
                editor.classList.add(`note-color-${selectedColor}`);
            }
            contextSubmenu.querySelectorAll('.info-note-color-btn').forEach((btn) => {
                btn.classList.toggle('is-selected', btn.dataset.noteColor === selectedColor);
            });
        };

        const setBusy = (busy) => {
            textarea.disabled = !!busy;
            contextSubmenu.querySelectorAll('.info-note-color-btn').forEach((btn) => { btn.disabled = !!busy; });
        };
        const persist = async (noteInput, colorInput = selectedColor) => {
            const note = normalizeInfoNote(noteInput);
            const color = normalizeInfoNoteColor(colorInput);
            const target = data.target;
            setBusy(true);
            try {
                if (target.kind === 'temporary') {
                    if (typeof setTempItemNote === 'function') {
                        setTempItemNote(target.sectionId, target.itemId, note, { noteColor: color, skipSearchUpdate: false });
                    } else if (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.setNote === 'function') {
                        window.CanvasModule.temp.setNote(target.sectionId, target.itemId, note, { noteColor: color, skipSearchUpdate: false });
                    } else {
                        throw new Error('Temporary note helper unavailable');
                    }
                    const noteTarget = { kind: 'temporary', sectionId: target.sectionId, itemId: target.itemId, note, color, noteColor: color };
                    try { if (typeof window.__refreshNoteMarkersForTargets === 'function') window.__refreshNoteMarkersForTargets([noteTarget]); } catch (_) {}
                } else if (target.kind === 'permanent') {
                    const bridge = window.CanvasProtocolBridge;
                    if (!bridge || (typeof bridge.writePermanentNodeNoteMeta !== 'function' && typeof bridge.writePermanentNodeNote !== 'function')) {
                        throw new Error('Permanent note bridge unavailable');
                    }
                    let writeResult = null;
                    if (typeof bridge.writePermanentNodeNoteMeta === 'function') {
                        writeResult = await bridge.writePermanentNodeNoteMeta(target.chromeId, note, color);
                    } else {
                        writeResult = await bridge.writePermanentNodeNote(target.chromeId, note, { noteColor: color });
                    }
                    if (!writeResult) {
                        throw new Error('Permanent note target not found');
                    }
                    try {
                        if (window.NoteSystem && typeof window.NoteSystem.invalidatePermNotesCache === 'function') {
                            window.NoteSystem.invalidatePermNotesCache();
                        }
                    } catch (_) {}
                    try {
                        if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
                            await window.NoteSystem.ensurePermNotesLoaded(true);
                        }
                    } catch (_) {}
                    const noteTarget = { kind: 'permanent', chromeId: target.chromeId, note, color, noteColor: color };
                    try { if (typeof window.updateCanvasSearchBookmarkNotes === 'function') window.updateCanvasSearchBookmarkNotes([noteTarget]); } catch (_) {}
                    try { if (typeof window.markCanvasSearchBookmarkNoteDirty === 'function') window.markCanvasSearchBookmarkNoteDirty([noteTarget]); } catch (_) {}
                    try { if (typeof window.__refreshNoteMarkersForTargets === 'function') window.__refreshNoteMarkersForTargets([noteTarget]); } catch (_) {}
                }
                textarea.value = note;
                data.note = note;
                data.noteColor = color;
                applyColorUi(color);
            } catch (err) {
                console.error('[Info] Failed to save note:', err);
                if (typeof showToast === 'function') {
                    showToast(lang === 'zh_CN' ? '笔记保存失败' : 'Failed to save note', 'error');
                }
            } finally {
                setBusy(false);
            }
        };

        const hasUnsavedNoteChange = () => {
            return normalizeInfoNote(textarea.value) !== normalizeInfoNote(data.note) ||
                normalizeInfoNoteColor(selectedColor) !== normalizeInfoNoteColor(data.noteColor);
        };

        const persistIfChanged = () => {
            if (!hasUnsavedNoteChange()) return saveChain;
            const noteToSave = textarea.value;
            const colorToSave = selectedColor;
            saveChain = saveChain.then(
                () => persist(noteToSave, colorToSave),
                () => persist(noteToSave, colorToSave)
            );
            return saveChain;
        };

        contextSubmenu.__flushInfoNoteEditor = persistIfChanged;

        const scheduleAutoSaveAfterFocusExit = () => {
            setTimeout(() => {
                const active = document.activeElement;
                if (noteRow && active && noteRow.contains(active)) return;
                persistIfChanged();
            }, 0);
        };

        applyColorUi(selectedColor);
        contextSubmenu.querySelectorAll('.info-note-color-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                applyColorUi(setLastInfoNoteColor(btn.dataset.noteColor));
            });
        });
        if (noteRow) noteRow.addEventListener('focusout', scheduleAutoSaveAfterFocusExit);
        textarea.addEventListener('click', (e) => e.stopPropagation());
        textarea.addEventListener('keydown', (e) => e.stopPropagation());
        textarea.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        textarea.addEventListener('mousedown', armInfoNoteTextareaExternalCloseGuard);
        textarea.addEventListener('pointerdown', armInfoNoteTextareaExternalCloseGuard);
    };

    if (isTemporary) {
        const manager = getTempManager();
        const entry = manager ? manager.findItem(context.sectionId, nodeId) : null;
        if (!entry || !entry.item) {
            contextSubmenu.innerHTML = `<div style="padding: 12px; color: var(--accent-red);">${lang === 'zh_CN' ? '未找到节点' : 'Node not found'}</div>`;
            return;
        }

        const pathParts = [];
        let current = entry;
        while (current && current.parent) {
            pathParts.unshift(current.parent.title || 'Folder');
            current = manager.findItem(context.sectionId, current.parent.id);
        }
        const section = getTempSection(context.sectionId);
        if (section) {
            pathParts.unshift(section.title || (lang === 'zh_CN' ? '临时栏目' : 'Temp Column'));
        }

        const fullPath = pathParts.length > 0 ? pathParts.join(' > ') : (lang === 'zh_CN' ? '根目录' : 'Root');
        const needsTruncation = pathParts.length > 3;
        const visibleParts = needsTruncation ? pathParts.slice(-3) : pathParts;
        const pathStr = visibleParts.join(' > ');
        const path = needsTruncation ? `.../${pathStr}` : pathStr;
        const tags = typeof getTempItemTags === 'function'
            ? getTempItemTags(context.sectionId, nodeId)
            : (Array.isArray(entry.item.tags) ? entry.item.tags : []);
        const noteMeta = typeof getTempItemNoteMeta === 'function'
            ? getTempItemNoteMeta(context.sectionId, nodeId)
            : (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.getNoteMeta === 'function'
                ? window.CanvasModule.temp.getNoteMeta(context.sectionId, nodeId)
                : { note: normalizeInfoNote(entry.item.note), color: normalizeInfoNoteColor(entry.item.noteColor) });
        const note = normalizeInfoNote(noteMeta && noteMeta.note);
        const noteColor = normalizeInfoNoteColor(noteMeta && (noteMeta.noteColor || noteMeta.color));
        const cardData = {
            title: entry.item.title,
            url: entry.item.url,
            type: entry.item.type,
            path,
            fullPath,
            needsTruncation,
            pathStr,
            id: entry.item.id,
            tags,
            note,
            noteColor,
            target: { kind: 'temporary', sectionId: context.sectionId, itemId: nodeId }
        };

        contextSubmenu.innerHTML = renderCard(cardData);
        bindInfoCloseEvent();
        bindCopyEvent();
        bindPathToggleEvent();
        bindNoteEditorEvent(cardData);
        repositionSubmenu();
    } else {
        if (!chrome || !chrome.bookmarks) {
            contextSubmenu.innerHTML = `<div style="padding: 12px; color: var(--accent-red);">${lang === 'zh_CN' ? '当前环境不支持书签 API' : 'Bookmarks API not supported'}</div>`;
            return;
        }

        chrome.bookmarks.get(nodeId, async (nodes) => {
            if (chrome.runtime.lastError || !nodes || !nodes[0]) {
                contextSubmenu.innerHTML = `<div style="padding: 12px; color: var(--accent-red);">${lang === 'zh_CN' ? '未找到书签' : 'Bookmark not found'}</div>`;
                return;
            }
            const node = nodes[0];

            const pathParts = [];
            let currentParentId = node.parentId;
            while (currentParentId && currentParentId !== '0') {
                try {
                    const parentNodes = await new Promise((resolve) => {
                        chrome.bookmarks.get(currentParentId, (p) => {
                            if (chrome.runtime.lastError) resolve(null);
                            else resolve(p);
                        });
                    });
                    if (parentNodes && parentNodes[0]) {
                        pathParts.unshift(parentNodes[0].title || (parentNodes[0].id === '1' ? '书签栏' : '文件夹'));
                        currentParentId = parentNodes[0].parentId;
                    } else {
                        break;
                    }
                } catch (_) {
                    break;
                }
            }

            const fullPath = pathParts.length > 0 ? pathParts.join(' > ') : (lang === 'zh_CN' ? '书签根目录' : 'Bookmark Root');
            const needsTruncation = pathParts.length > 3;
            const visibleParts = needsTruncation ? pathParts.slice(-3) : pathParts;
            const pathStr = visibleParts.join(' > ');
            const path = needsTruncation ? `.../${pathStr}` : pathStr;
            const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
            let tags = [];
            let note = '';
            let noteColor = 'orange';
            try {
                if (bridge && typeof bridge.readPermanentNodeTags === 'function') {
                    tags = await bridge.readPermanentNodeTags(node.id);
                }
            } catch (_) { tags = []; }
            try {
                if (bridge && typeof bridge.readPermanentNodeNoteMeta === 'function') {
                    const noteMeta = await bridge.readPermanentNodeNoteMeta(node.id);
                    note = normalizeInfoNote(noteMeta && noteMeta.note);
                    noteColor = normalizeInfoNoteColor(noteMeta && (noteMeta.noteColor || noteMeta.color));
                } else if (bridge && typeof bridge.readPermanentNodeNote === 'function') {
                    note = await bridge.readPermanentNodeNote(node.id);
                }
            } catch (_) { note = ''; }
            const cardData = {
                title: node.title,
                url: node.url,
                type: node.url ? 'bookmark' : 'folder',
                path,
                fullPath,
                needsTruncation,
                pathStr,
                dateAdded: node.dateAdded,
                dateGroupModified: node.dateGroupModified,
                id: node.id,
                tags,
                note,
                noteColor,
                target: { kind: 'permanent', chromeId: node.id }
            };

            contextSubmenu.innerHTML = renderCard(cardData);
            bindInfoCloseEvent();
            bindCopyEvent();
            bindPathToggleEvent();
            bindNoteEditorEvent(cardData);
            repositionSubmenu();
        });
    }
}

// 渲染二级标签菜单
function renderTagSubmenu(context) {
    if (!contextSubmenu) return;

    contextSubmenu.classList.remove('is-trace-submenu');
    contextSubmenu.classList.add('is-tag-submenu');

    const lang = currentLang || 'zh_CN';
    const { targets } = resolveTagTargetsForContext('tag-submenu-trigger', context);
    if (!targets || !targets.length) {
        contextSubmenu.innerHTML = `<div style="padding: 8px; color: var(--text-secondary);">${lang === 'zh_CN' ? '无有效节点' : 'No valid nodes'}</div>`;
        return;
    }

    if (!tagSubmenuCtx || JSON.stringify(tagSubmenuCtx.targets) !== JSON.stringify(targets)) {
        tagSubmenuCtx = {
            targets,
            selectedColor: null,
            editingTag: null,
            recentLimit: 3
        };
    }

    const TAG_SUBMENU_I18N = {
        inputPlaceholder: { 'zh_CN': '可选：自定义文字...', 'en': 'Optional: custom text...' },
        confirmAriaLabel: { 'zh_CN': '确认', 'en': 'Confirm' },
        removeAriaLabel:  { 'zh_CN': '删除标签', 'en': 'Delete tag' },
        previewEmpty:     { 'zh_CN': '选一个颜色…', 'en': 'Pick a color…' },
        recentHeader:     { 'zh_CN': '已用 tag（全局）', 'en': 'Recent tags (all)' },
        noTagsYet:        { 'zh_CN': '暂无已用 tag', 'en': 'No tags yet' },
        moreEllipsis:     { 'zh_CN': '…还有 {n} 个', 'en': '…{n} more' }
    };
    const t = (key, vars) => {
        let s = TAG_SUBMENU_I18N[key][lang] || TAG_SUBMENU_I18N[key]['zh_CN'];
        if (vars) {
            Object.keys(vars).forEach(k => {
                s = s.replace(new RegExp(`{${k}}`, 'g'), String(vars[k]));
            });
        }
        return s;
    };
    const colorNames = {
        red:    { 'zh_CN': '红色',  'en': 'Red' },
        orange: { 'zh_CN': '橙色',  'en': 'Orange' },
        yellow: { 'zh_CN': '黄色',  'en': 'Yellow' },
        green:  { 'zh_CN': '绿色',  'en': 'Green' },
        blue:   { 'zh_CN': '蓝色',  'en': 'Blue' },
        purple: { 'zh_CN': '紫色',  'en': 'Purple' },
        gray:   { 'zh_CN': '灰色',  'en': 'Gray' }
    };
    const colorName = (c) => (colorNames[c] ? colorNames[c][lang] : c);

    const TAG_PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

    contextSubmenu.innerHTML = `
        <div class="tag-popover-top" style="padding: 6px 12px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            <input type="text" class="tag-popover-input" data-role="input" placeholder="${t('inputPlaceholder')}" style="flex: 1;" />
            <button class="tag-popover-confirm" data-role="confirm" type="button" title="${t('confirmAriaLabel')}" style="width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.2 11.4 2.6 7.8l1.4-1.4 2.2 2.2 5.8-5.8 1.4 1.4z"/></svg>
            </button>
            <button class="tag-popover-close" data-role="close-popover" type="button" title="${lang === 'zh_CN' ? '关闭' : 'Close'}" style="width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>
            </button>
        </div>
        <div class="tag-popover-palette" data-role="palette" style="padding: 4px 12px 6px; display: flex; align-items: center;">
            <div class="tag-popover-palette-colors" data-role="palette-colors" style="display: flex; gap: 4px; align-items: center;">
                ${TAG_PALETTE.map((c) =>
                    `<button class="tag-palette-btn" data-color="${c}" type="button" aria-label="${c}"><span class="tag-dot tag-dot-${c}"></span></button>`
                ).join('')}
            </div>
        </div>
        <div class="tag-popover-divider" style="height: 1px; background: var(--border-color); opacity: 0.5; margin: 4px 0;"></div>
        <div class="tag-popover-preview" data-role="preview" style="padding: 4px 12px 6px; display: flex; align-items: center; min-height: 20px;">
            <span class="tag-preview-placeholder" data-role="preview-placeholder" style="color: var(--text-tertiary); font-size: 11px;"></span>
            <span class="tag-preview-card" data-role="preview-card" style="display: inline-flex; align-items: center; gap: 4px;" hidden>
                <span class="tag-dot" data-role="preview-dot"></span>
                <span class="tag-preview-text" data-role="preview-text"></span>
            </span>
        </div>
        <div class="tag-popover-divider" style="height: 1px; background: var(--border-color); opacity: 0.5; margin: 4px 0;"></div>
        <div class="tag-popover-applied-section" style="padding: 6px 12px 10px;">
            <div class="tag-popover-applied-header" data-role="recent-header" style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;"></div>
            <div class="tag-popover-applied" data-role="recent" style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;"></div>
            <button class="tag-popover-more" data-role="recent-more" type="button" style="background: transparent; border: none; color: var(--accent-blue); cursor: pointer; padding: 2px 0; font-size: 11px; text-align: left;" hidden></button>
        </div>
    `;

    const inputEl = contextSubmenu.querySelector('[data-role="input"]');
    const confirmBtn = contextSubmenu.querySelector('[data-role="confirm"]');
    const closeBtn = contextSubmenu.querySelector('[data-role="close-popover"]');
    const recentHeader = contextSubmenu.querySelector('[data-role="recent-header"]');
    const recentEl = contextSubmenu.querySelector('[data-role="recent"]');
    const recentMore = contextSubmenu.querySelector('[data-role="recent-more"]');
    const previewPlaceholder = contextSubmenu.querySelector('[data-role="preview-placeholder"]');
    const previewCard = contextSubmenu.querySelector('[data-role="preview-card"]');
    const previewDot = contextSubmenu.querySelector('[data-role="preview-dot"]');
    const previewText = contextSubmenu.querySelector('[data-role="preview-text"]');

    function updatePreview() {
        const color = tagSubmenuCtx.selectedColor;
        if (!color) {
            previewCard.hidden = true;
            previewPlaceholder.hidden = false;
            previewPlaceholder.textContent = t('previewEmpty');
            confirmBtn.disabled = true;
            confirmBtn.classList.remove('is-ready');
            confirmBtn.style.removeProperty('color');
            return;
        }
        previewPlaceholder.hidden = true;
        previewCard.hidden = false;
        previewDot.className = `tag-dot tag-dot-${color}`;
        previewDot.dataset.color = color;
        const typed = (inputEl.value || '').trim();
        const text = typed || colorName(color);
        previewText.textContent = text;
        confirmBtn.disabled = false;
        confirmBtn.classList.add('is-ready');
    }

    async function toggleTagOnAllTargets(tagInput, options = {}) {
        if (!window.TagSystem || !window.TagSystem.toggleTagOnTarget) return;
        const bridge = window.CanvasProtocolBridge;
        if (!bridge || !bridge.normalizeTagInput || !bridge.makeTagKey) return;

        const norm = bridge.normalizeTagInput(tagInput);
        if (!norm) return;
        const key = bridge.makeTagKey(norm.color, norm.text);

        const perTargetTags = await Promise.all(targets.map((t) => window.TagSystem.getTagsForTarget(t)));
        const allHave = perTargetTags.every((tags) => (tags || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === key));
        const mode = options.mode || 'auto';
        let latestSingleTargetTags = null;

        for (let i = 0; i < targets.length; i++) {
            const has = (perTargetTags[i] || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === key);
            let result = null;
            if (mode === 'remove') {
                if (has) result = await window.TagSystem.toggleTagOnTarget(targets[i], norm);
            } else {
                if (allHave && has) {
                    result = await window.TagSystem.toggleTagOnTarget(targets[i], norm);
                } else if (!allHave && !has) {
                    result = await window.TagSystem.toggleTagOnTarget(targets[i], norm);
                }
            }
            if (targets.length === 1 && result && Array.isArray(result.tags)) {
                latestSingleTargetTags = result.tags;
            }
        }

        await renderList();

        if (typeof window.__refreshTagDotsForTargets === 'function') {
            window.__refreshTagDotsForTargets(targets);
        }
    }

    async function confirmCurrentSelection() {
        if (!tagSubmenuCtx.selectedColor) return;
        const color = tagSubmenuCtx.selectedColor;
        const typed = (inputEl.value || '').trim();
        const text = typed || colorName(color);
        const tagInput = { color, text };

        const bridge = window.CanvasProtocolBridge;
        if (!bridge || !bridge.normalizeTagInput || !bridge.makeTagKey) return;
        const norm = bridge.normalizeTagInput(tagInput);
        if (!norm) return;
        const key = bridge.makeTagKey(norm.color, norm.text);

        const editingNorm = tagSubmenuCtx.editingTag ? bridge.normalizeTagInput(tagSubmenuCtx.editingTag) : null;
        const editingKey = editingNorm ? bridge.makeTagKey(editingNorm.color, editingNorm.text) : null;

        const perTargetTags = await Promise.all(targets.map((t) => window.TagSystem.getTagsForTarget(t)));
        let latestSingleTargetTags = null;
        for (let i = 0; i < targets.length; i++) {
            const has = (perTargetTags[i] || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === key);
            if (editingNorm && editingKey && editingKey !== key) {
                const hasEditingTag = (perTargetTags[i] || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === editingKey);
                let result = null;
                if (hasEditingTag) result = await window.TagSystem.toggleTagOnTarget(targets[i], editingNorm);
                if (!has) result = await window.TagSystem.toggleTagOnTarget(targets[i], norm);
                if (targets.length === 1 && result && Array.isArray(result.tags)) latestSingleTargetTags = result.tags;
            } else if (!has) {
                const result = await window.TagSystem.toggleTagOnTarget(targets[i], norm);
                if (targets.length === 1 && result && Array.isArray(result.tags)) latestSingleTargetTags = result.tags;
            }
        }

        inputEl.value = '';
        tagSubmenuCtx.selectedColor = null;
        tagSubmenuCtx.editingTag = null;

        await renderList();

        if (typeof window.__refreshTagDotsForTargets === 'function') {
            window.__refreshTagDotsForTargets(targets);
        }
    }


    async function renderList() {
        if (!window.TagSystem || !window.TagSystem.getTagsForTarget) return;
        const perTargetTags = await Promise.all(targets.map((t) => window.TagSystem.getTagsForTarget(t)));
        const bridge = window.CanvasProtocolBridge;
        if (!bridge) return;

        const keyOf = (color, text) => (bridge && bridge.makeTagKey) ? bridge.makeTagKey(color, text) : `${color}::${text}`;

        const aggregate = new Map();
        perTargetTags.forEach((list) => {
            const seen = new Set();
            (list || []).forEach((t) => {
                const k = keyOf(t.color, t.text);
                if (seen.has(k)) return;
                seen.add(k);
                const prev = aggregate.get(k);
                if (prev) prev.present += 1;
                else aggregate.set(k, { tag: { color: t.color, text: t.text }, present: 1 });
            });
        });

        const allByColor = new Map();
        aggregate.forEach((entry) => {
            const c = entry.tag.color;
            const prev = allByColor.get(c) || 0;
            if (entry.present > prev) allByColor.set(c, entry.present);
        });
        contextSubmenu.querySelectorAll('.tag-palette-btn').forEach((btn) => {
            const color = btn.dataset.color;
            btn.classList.toggle('is-selected', color === tagSubmenuCtx.selectedColor);
            const presentCount = allByColor.get(color) || 0;
            btn.classList.toggle('is-applied', presentCount === targets.length && targets.length > 0);
            btn.classList.toggle('is-mixed', presentCount > 0 && presentCount < targets.length);
        });

        let globalTags = [];
        try {
            if (bridge && bridge.collectAllUsedTags) globalTags = await bridge.collectAllUsedTags();
        } catch (_) {}

        recentHeader.textContent = t('recentHeader');
        recentEl.innerHTML = '';

        if (!globalTags.length) {
            const empty = document.createElement('div');
            empty.className = 'tag-recent-empty';
            empty.textContent = t('noTagsYet');
            recentEl.appendChild(empty);
            recentMore.hidden = true;
        } else {
            const limit = Math.min(10, Math.max(3, tagSubmenuCtx.recentLimit || 3));
            tagSubmenuCtx.recentLimit = limit;
            const visible = globalTags.slice(0, limit);

            visible.forEach((tag) => {
                const k = keyOf(tag.color, tag.text);
                const entry = aggregate.get(k);
                const row = document.createElement('div');
                row.className = 'tag-applied-row';
                row.dataset.color = tag.color;
                row.dataset.text = tag.text;
                let statusMark = '+';
                if (entry) {
                    if (entry.present === targets.length) {
                        row.classList.add('is-active');
                        statusMark = '✓';
                    } else {
                        row.classList.add('is-mixed');
                        statusMark = '–';
                    }
                }
                row.innerHTML = `
                    <span class="tag-dot tag-dot-${tag.color}"></span>
                    <span class="tag-applied-text"></span>
                    <span class="tag-applied-status">${statusMark}</span>
                `;
                row.querySelector('.tag-applied-text').textContent = tag.text || colorName(tag.color);

                row.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (row.classList.contains('is-active') || row.classList.contains('is-mixed')) {
                        tagSubmenuCtx.editingTag = tag;
                        tagSubmenuCtx.selectedColor = tag.color;
                        inputEl.value = tag.text || colorName(tag.color);
                        updatePreview();
                        await renderList();
                    } else {
                        await toggleTagOnAllTargets(tag, { mode: 'auto' });
                    }
                });

                recentEl.appendChild(row);
            });

            const hiddenCount = Math.max(0, Math.min(globalTags.length, 10) - visible.length);
            if (hiddenCount > 0) {
                recentMore.hidden = false;
                recentMore.textContent = t('moreEllipsis', { n: hiddenCount });
            } else {
                recentMore.hidden = true;
            }
        }
        updatePreview();
    }

    contextSubmenu.querySelectorAll('.tag-palette-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const color = btn.dataset.color;
            tagSubmenuCtx.selectedColor = (tagSubmenuCtx.selectedColor === color) ? null : color;
            updatePreview();
            await renderList();
        });
    });

    confirmBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirmBtn.disabled) {
            await confirmCurrentSelection();
        }
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
    });


    recentMore.addEventListener('click', async (e) => {
        e.stopPropagation();
        tagSubmenuCtx.recentLimit = 10;
        await renderList();
    });

    inputEl.addEventListener('input', () => {
        updatePreview();
    });
    inputEl.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (tagSubmenuCtx.selectedColor) {
                await confirmCurrentSelection();
            }
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            hideContextMenu();
        }
    });

    renderList();
}

// 捕获阶段的全局点击监听，用于检测是否点击了高亮导引线并取消 Trace
document.addEventListener('click', (event) => {
    if (!window.__activeTraces || window.__activeTraces.length === 0) return;

    const target = event.target;
    if (!target) return;

    // 情况 1: 点击垂直引导线 (.tree-children 且 has-trace)
    if (target.classList.contains('tree-children') && target.classList.contains('has-trace')) {
        const rect = target.getBoundingClientRect();
        if (Math.abs(event.clientX - rect.left) <= 8) {
            // 读取 trace-line-height 自定义属性，限制只在可见高亮线段高度内才响应点击
            const style = window.getComputedStyle(target);
            const lineHeightStr = style.getPropertyValue('--trace-line-height');
            const lineHeight = parseFloat(lineHeightStr);

            if (!isNaN(lineHeight) && lineHeight > 0) {
                if (event.clientY < rect.top || event.clientY > rect.top + lineHeight) {
                    return; // 点击落在可见高亮线高度之外，不做任何操作
                }
            }

            event.preventDefault();
            event.stopPropagation();
            cancelTracesPassingThrough(target);
            return;
        }
    }

    // 情况 2: 点击水平引导线 (点击点在 .tree-item.has-trace 且不含 has-trace-no-line 的左侧 ::before 位置)
    const item = target.closest('.tree-item');
    if (item && item.classList.contains('has-trace') && !item.classList.contains('has-trace-no-line')) {
        const rect = item.getBoundingClientRect();
        // 横线位于 left: -1px，宽度 12px，故点击的水平坐标应在 [rect.left - 4, rect.left + 12] 范围内
        if (event.clientX >= rect.left - 4 && event.clientX <= rect.left + 12) {
            event.preventDefault();
            event.stopPropagation();
            cancelTracesPassingThrough(item);
            return;
        }
    }
}, true);

// 捕获阶段的全局点击监听，用于响应信息行尾快捷图标
document.addEventListener('click', (e) => {
    const infoIcon = e.target.closest('.tree-info-icon');
    if (!infoIcon) return;
    e.stopImmediatePropagation();
    e.preventDefault();

    const treeItem = infoIcon.closest('.tree-item');
    if (!treeItem) return;

    // 获取节点的上下文
    const context = getNodeContext(treeItem);
    if (!context) return;

    // 设置当前节点
    currentContextNode = treeItem;

    // 如果该节点的信息子菜单已经是打开状态，则关闭它
    if (contextSubmenu && contextSubmenu.style.display === 'block' &&
        contextSubmenu.dataset.triggerAction === 'info-submenu-trigger' &&
        contextSubmenu.dataset.contextNodeId === context.nodeId) {
        hideContextMenu();
        return;
    }

    // 否则，先隐藏旧的菜单和子菜单
    hideContextMenu();

    // 重新设置上下文
    currentContextNode = treeItem;
    contextSubmenu.dataset.triggerAction = 'info-submenu-trigger';
    contextSubmenu.dataset.contextNodeId = context.nodeId; // 用于第二次点击时切换关闭

    // 展开信息面板
    toggleSubmenu(infoIcon, context);
}, true);

// 捕获阶段的全局点击监听，用于响应删除及确认二次确认快捷图标
document.addEventListener('click', (e) => {
    // 1. 点击删除按钮 (trash) -> 进入确认状态
    const deleteIcon = e.target.closest('.tree-delete-icon');
    if (deleteIcon) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const hoverActions = deleteIcon.closest('.tree-item-hover-actions');
        const treeItem = deleteIcon.closest('.tree-item');
        if (hoverActions && treeItem) {
            // 清除其它项的确认状态及监听器
            document.querySelectorAll('.tree-item-hover-actions.confirming-delete').forEach(el => {
                if (el !== hoverActions) {
                    el.classList.remove('confirming-delete');
                    const otherItem = el.closest('.tree-item');
                    if (otherItem) {
                        otherItem.onmouseleave = null;
                    }
                }
            });

            // 进入确认状态
            hoverActions.classList.add('confirming-delete');

            // 动态绑定一次性移出事件，用以重置当前行的确认状态
            treeItem.onmouseleave = () => {
                hoverActions.classList.remove('confirming-delete');
                treeItem.onmouseleave = null;
            };
        }
        return;
    }

    // 2. 点击确认按钮 (checkmark) -> 执行删除
    const confirmIcon = e.target.closest('.tree-confirm-icon');
    if (confirmIcon) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const treeItem = confirmIcon.closest('.tree-item');
        if (!treeItem) return;

        // 清理绑定的移出事件
        treeItem.onmouseleave = null;

        const context = getNodeContext(treeItem);
        if (!context) return;
        handleMenuAction('delete', context);
        return;
    }

    // 3. 点击取消按钮 (cross) -> 取消确认状态
    const cancelIcon = e.target.closest('.tree-cancel-icon');
    if (cancelIcon) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const hoverActions = cancelIcon.closest('.tree-item-hover-actions');
        const treeItem = cancelIcon.closest('.tree-item');
        if (hoverActions) {
            hoverActions.classList.remove('confirming-delete');
        }
        if (treeItem) {
            treeItem.onmouseleave = null;
        }
        return;
    }

    // 4. 点击其它任何地方 -> 清除所有确认状态
    const activeConfirmActions = document.querySelector('.tree-item-hover-actions.confirming-delete');
    if (activeConfirmActions && !activeConfirmActions.contains(e.target)) {
        activeConfirmActions.classList.remove('confirming-delete');
        const treeItem = activeConfirmActions.closest('.tree-item');
        if (treeItem) {
            treeItem.onmouseleave = null;
        }
    }
}, true);

// 捕获阶段全局拦截除 click 外的各类鼠标/指针/拖拽/右键/双击事件，避免快捷按钮触发树节点的选中、高亮、折叠/展开、拖拽等行为
['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'dragstart'].forEach(eventType => {
    document.addEventListener(eventType, (e) => {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('.tree-item-hover-actions')) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);
});

// 捕获阶段全局拦截对快捷按钮背景/间隔的点击，防止误触发文件夹的展开或折叠
document.addEventListener('click', (e) => {
    if (e.target && typeof e.target.closest === 'function' && e.target.closest('.tree-item-hover-actions')) {
        const button = e.target.closest('.tree-trace-icon, .tree-info-icon, .tree-delete-icon, .tree-tip-icon, .tree-confirm-icon, .tree-cancel-icon');
        if (!button) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }
}, true);

function ensureTempManager() {
    const manager = getTempManager();
    if (!manager) {
        throw new Error('临时栏目管理器不可用');
    }
    return manager;
}

function getSelectedTempNodes() {
    const nodes = [];
    const manager = getTempManager();
    const selectionIds = (typeof window !== 'undefined' && typeof window.getEffectiveBookmarkDragSelectionIds === 'function')
        ? window.getEffectiveBookmarkDragSelectionIds()
        : Array.from(selectedNodes);
    selectionIds.forEach(nodeId => {
        const meta = selectedNodeMeta.get(nodeId);
        if (!meta || meta.treeType !== 'temporary') return;
        const element = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);

        let isFolder = meta.nodeType === 'folder';
        let title = '';
        let url = '';

        // Try to retrieve data from temporary section memory manager first
        if (manager && typeof manager.findItem === 'function') {
            try {
                const entry = manager.findItem(meta.sectionId, nodeId);
                if (entry && entry.item) {
                    isFolder = entry.item.type === 'folder';
                    title = entry.item.title || '';
                    url = entry.item.url || '';
                }
            } catch (err) {
                console.warn('[getSelectedTempNodes] Memory query failed, fallback to DOM:', err);
            }
        }

        // Fallback to DOM queries if memory query failed or properties are missing
        if (!title && element) {
            title = element.dataset.nodeTitle || '';
        }
        if (!url && element) {
            url = element.dataset.nodeUrl || '';
        }
        if (element && !isFolder) {
            isFolder = element.dataset.nodeType === 'folder';
        }

        nodes.push({
            id: nodeId,
            sectionId: meta.sectionId,
            element,
            isFolder,
            title,
            url
        });
    });
    return nodes;
}

function getSelectedPermanentNodeIds() {
    const ids = [];
    const selectionIds = (typeof window !== 'undefined' && typeof window.getEffectiveBookmarkDragSelectionIds === 'function')
        ? window.getEffectiveBookmarkDragSelectionIds()
        : Array.from(selectedNodes);
    selectionIds.forEach(nodeId => {
        const meta = selectedNodeMeta.get(nodeId);
        const treeType = meta ? meta.treeType : 'permanent';
        if (treeType === 'permanent') {
            ids.push(nodeId);
        }
    });
    return ids;
}

function getBatchSelectionCapabilities() {
    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();
    const hasPermanent = permanentIds.length > 0;
    const hasTemp = tempNodes.length > 0;
    const mixed = hasPermanent && hasTemp;

    let tempAllSameSection = true;
    if (hasTemp) {
        const sectionId = tempNodes[0].sectionId;
        tempAllSameSection = tempNodes.every(n => n.sectionId === sectionId);
    }

    let hasBookmarks = false;
    let hasFolders = false;

    // 直接从选中的元数据缓存中获取节点类型，避免 DOM 查询及折叠状态导致的错误 fallback
    selectedNodes.forEach(nodeId => {
        const meta = selectedNodeMeta.get(nodeId);
        if (meta) {
            if (meta.nodeType === 'folder') {
                hasFolders = true;
            } else {
                hasBookmarks = true;
            }
        } else {
            hasBookmarks = true; // 默认回退
        }
    });

    const mixedTypes = hasBookmarks && hasFolders;

    return {
        permanentIds,
        tempNodes,
        hasPermanent,
        hasTemp,
        mixed,
        tempAllSameSection,
        hasBookmarks,
        hasFolders,
        mixedTypes
    };
}

function isBatchMergeDisabled(caps) {
    return caps.mixed || (caps.hasTemp && !caps.tempAllSameSection);
}

function getBatchMergeUnsupportedMessage(lang) {
    return lang === 'zh_CN'
        ? '合并仅支持单张卡片，或永久栏目与其副本的组合'
        : 'Merge supports one card only, or a permanent section together with its copies';
}

function formatTimestampForTitle(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function collectTempUrls(sectionId, nodeId) {
    const manager = getTempManager();
    if (!manager) return [];
    const entry = manager.findItem(sectionId, nodeId);
    if (!entry || !entry.item) return [];

    const urls = [];
    // One-level only: folder -> direct child bookmarks
    const item = entry.item;
    if (item.type === 'bookmark' && item.url) {
        urls.push(item.url);
        return urls;
    }
    if (item.children && item.children.length) {
        item.children.forEach((child) => {
            if (child && child.type === 'bookmark' && child.url) {
                urls.push(child.url);
            }
        });
    }
    return urls;
}

async function openUrlList(urls, { newWindow = false, incognito = false, tabGroup = false, groupTitle = '' } = {}, urlToScopeMap = null) {
    if (!urls || !urls.length) {
        const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    if (urls.length > 10) {
        const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    if (newWindow) {
        if (chrome && chrome.windows) {
            try {
                const createdWin = await chrome.windows.create({ url: urls, incognito });
                if (createdWin && urlToScopeMap) {
                    let winTabs = createdWin.tabs;
                    if (!winTabs || winTabs.length === 0) {
                        try {
                            winTabs = await chrome.tabs.query({ windowId: createdWin.id });
                        } catch (_) {}
                    }
                    if (winTabs && winTabs.length > 0) {
                        for (const tab of winTabs) {
                            if (tab && tab.id != null && tab.url) {
                                const scope = urlToScopeMap[tab.url];
                                if (scope) {
                                    const prefix = scope.prefix || '';
                                    const title = scope.title || '';
                                    const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                                    if (label) {
                                        await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                if (incognito && error.message && error.message.includes('Incognito mode is disabled')) {
                    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
                    const message = lang === 'zh_CN'
                         ? '无痕模式已被禁用。将在普通窗口中打开。\n\n若要使用无痕模式，请在扩展管理页面启用"在无痕模式下启用"。'
                         : 'Incognito mode is disabled. Opening in normal window.\n\nTo use incognito mode, enable "Allow in Incognito" in extension settings.';
                    alert(message);
                    // 降级为普通新窗口
                    const createdWin = await chrome.windows.create({ url: urls, incognito: false });
                    if (createdWin && urlToScopeMap) {
                        let winTabs = createdWin.tabs;
                        if (!winTabs || winTabs.length === 0) {
                            try {
                                winTabs = await chrome.tabs.query({ windowId: createdWin.id });
                            } catch (_) {}
                        }
                        if (winTabs && winTabs.length > 0) {
                            for (const tab of winTabs) {
                                if (tab && tab.id != null && tab.url) {
                                    const scope = urlToScopeMap[tab.url];
                                    if (scope) {
                                        const prefix = scope.prefix || '';
                                        const title = scope.title || '';
                                        const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                                        if (label) {
                                            await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    console.error('[openUrlList] 新窗口失败:', error);
                    urls.forEach(url => window.open(url, '_blank'));
                }
            }
        } else {
            urls.forEach(url => window.open(url, '_blank'));
        }
        return;
    }

    const openedTabIds = [];
    if (chrome && chrome.tabs) {
        for (const url of urls) {
            try {
                const tab = await chrome.tabs.create({ url, active: false });
                if (tab && typeof tab.id === 'number') {
                    openedTabIds.push(tab.id);
                    if (urlToScopeMap) {
                        const scope = urlToScopeMap[url];
                        if (scope) {
                            const prefix = scope.prefix || '';
                            const title = scope.title || '';
                            const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                            if (label) {
                                await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('[临时栏目] 打开标签失败:', error);
            }
        }

        if (tabGroup && openedTabIds.length && chrome.tabs.group) {
            try {
                const groupId = await chrome.tabs.group({ tabIds: openedTabIds });
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    await chrome.tabGroups.update(groupId, { title: groupTitle || 'Temp Bookmarks' });
                }
            } catch (error) {
                console.warn('[临时栏目] 创建标签页组失败:', error);
            }
        }
    } else {
        urls.forEach(url => window.open(url, '_blank'));
    }
}

async function openTempUrls(sectionId, nodeId, options = {}) {
    const urls = collectTempUrls(sectionId, nodeId);
    if (!urls.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
        return;
    }
    await openUrlList(urls, options);
}

function normalizePastePlacement(isFolder, requestedPlacement) {
    if (requestedPlacement === 'before' || requestedPlacement === 'inside' || requestedPlacement === 'after') {
        return requestedPlacement;
    }
    if (requestedPlacement === true) return 'after';
    return isFolder ? 'inside' : 'after';
}

function getTempPasteTarget(context, requestedPlacement = false) {
    const manager = ensureTempManager();
    const sectionId = context.sectionId;
    if (!sectionId) throw new Error('未找到临时栏目');

    // 如果没有 nodeId，说明是在空白处粘贴，粘贴到根目录
    if (!context.nodeId) {
        return { sectionId, parentId: null, index: null };
    }

    const placement = normalizePastePlacement(!!context.isFolder, requestedPlacement);
    let parentId = context.nodeId;
    let index = null;

    // 文件夹的 inside 位置追加到其子项末尾。
    if (context.isFolder && placement === 'inside') {
        parentId = context.nodeId;
        index = null; // 添加到文件夹末尾
    } else {
        // before/after 均插入到目标节点的同级位置。
        const entry = manager.findItem(sectionId, context.nodeId);
        if (entry) {
            parentId = entry.parent ? (entry.parent.id || null) : null;
            index = entry.index + (placement === 'after' ? 1 : 0);
        } else {
            // 如果找不到节点，粘贴到根目录
            parentId = null;
            index = null;
        }
    }

    return { sectionId, parentId, index };
}

function getBookmarkEditorModalElements() {
    const modal = document.getElementById('editBookmarkModal');
    if (!modal) return null;

    return {
        modal,
        titleInput: document.getElementById('editBookmarkTitle'),
        urlInput: document.getElementById('editBookmarkUrl'),
        urlField: document.getElementById('editBookmarkUrlField'),
        modalTitle: document.getElementById('editBookmarkModalTitle'),
        titleLabel: document.getElementById('editBookmarkTitleLabel'),
        urlLabel: document.getElementById('editBookmarkUrlLabel'),
        saveBtn: document.getElementById('editBookmarkSaveBtn'),
        cancelBtn: document.getElementById('editBookmarkCancelBtn'),
        closeBtn: document.getElementById('editBookmarkModalClose')
    };
}

function showBookmarkEditorModal(options = {}) {
    const refs = getBookmarkEditorModalElements();
    if (!refs || !refs.titleInput || !refs.urlInput || !refs.urlField || !refs.modalTitle || !refs.titleLabel || !refs.urlLabel || !refs.saveBtn || !refs.cancelBtn || !refs.closeBtn) {
        console.error('[编辑] 未找到编辑模态框元素');
        return Promise.resolve(null);
    }

    const lang = currentLang || 'zh_CN';
    const {
        modalTitle,
        titleLabel,
        urlLabel,
        saveText,
        cancelText,
        titlePlaceholder,
        urlPlaceholder,
        titleValue,
        urlValue,
        showUrl = true,
        requireUrl = false,
        requireTitle = false
    } = options;

    refs.modalTitle.textContent = modalTitle || (lang === 'zh_CN' ? '编辑书签' : 'Edit Bookmark');
    refs.titleLabel.textContent = titleLabel || (lang === 'zh_CN' ? '书签名称' : 'Bookmark Name');
    refs.urlLabel.textContent = urlLabel || (lang === 'zh_CN' ? '书签地址' : 'Bookmark URL');
    refs.saveBtn.textContent = saveText || (lang === 'zh_CN' ? '保存' : 'Save');
    refs.cancelBtn.textContent = cancelText || (lang === 'zh_CN' ? '取消' : 'Cancel');

    refs.titleInput.placeholder = titlePlaceholder || (lang === 'zh_CN' ? '输入名称...' : 'Enter name...');
    refs.urlInput.placeholder = urlPlaceholder || 'https://...';
    refs.titleInput.value = typeof titleValue === 'string' ? titleValue : '';
    refs.urlInput.value = typeof urlValue === 'string' ? urlValue : '';
    refs.urlField.style.display = showUrl ? 'flex' : 'none';
    refs.modal.dataset.bookmarkEditorType = showUrl ? 'bookmark' : 'folder';

    refs.modal.classList.add('show');
    setTimeout(() => refs.titleInput.focus(), 100);

    return new Promise((resolve) => {
        let settled = false;

        function cleanup() {
            refs.saveBtn.removeEventListener('click', handleSave);
            refs.cancelBtn.removeEventListener('click', handleCancel);
            refs.closeBtn.removeEventListener('click', handleCancel);
            refs.titleInput.removeEventListener('keydown', handleKeydown);
            refs.urlInput.removeEventListener('keydown', handleKeydown);
            delete refs.modal.dataset.bookmarkEditorType;
        }

        function closeModal(result = null) {
            if (settled) return;
            settled = true;
            cleanup();
            refs.modal.classList.remove('show');
            resolve(result);
        }

        function handleSave() {
            const title = refs.titleInput.value.trim();
            const url = refs.urlInput.value.trim();

            if (requireTitle && !title) {
                refs.titleInput.focus();
                return;
            }

            if (showUrl && requireUrl && !url) {
                refs.urlInput.focus();
                return;
            }

            closeModal({ title, url });
        }

        function handleCancel() {
            closeModal(null);
        }

        function handleKeydown(e) {
            if (e.key === 'Enter') {
                if (e.isComposing) return;
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                closeModal(null);
            }
        }

        refs.saveBtn.addEventListener('click', handleSave);
        refs.cancelBtn.addEventListener('click', handleCancel);
        refs.closeBtn.addEventListener('click', handleCancel);
        refs.titleInput.addEventListener('keydown', handleKeydown);
        refs.urlInput.addEventListener('keydown', handleKeydown);
    });
}

async function editTempNode(context) {
    const manager = ensureTempManager();
    const { sectionId, nodeId, nodeTitle, nodeUrl, isFolder } = context;
    const lang = currentLang || 'zh_CN';

    const result = await showBookmarkEditorModal({
        modalTitle: isFolder
            ? (lang === 'zh_CN' ? '重命名文件夹' : 'Rename Folder')
            : (lang === 'zh_CN' ? '编辑书签' : 'Edit Bookmark'),
        titleLabel: isFolder
            ? (lang === 'zh_CN' ? '文件夹名称' : 'Folder Name')
            : (lang === 'zh_CN' ? '书签名称' : 'Bookmark Name'),
        urlLabel: lang === 'zh_CN' ? '书签地址' : 'Bookmark URL',
        saveText: lang === 'zh_CN' ? '保存' : 'Save',
        cancelText: lang === 'zh_CN' ? '取消' : 'Cancel',
        titlePlaceholder: lang === 'zh_CN' ? '输入名称...' : 'Enter name...',
        urlPlaceholder: 'https://...',
        titleValue: nodeTitle || '',
        urlValue: nodeUrl || '',
        showUrl: !isFolder,
        requireUrl: !isFolder
    });

    if (!result) return;

    const normalizedTitle = result.title;
    const normalizedCurrentTitle = typeof nodeTitle === 'string' ? nodeTitle.trim() : '';

    if (isFolder) {
        if (normalizedTitle !== normalizedCurrentTitle) {
            manager.renameItem(sectionId, nodeId, normalizedTitle);
        }
        return;
    }

    const normalizedUrl = result.url;
    const normalizedCurrentUrl = typeof nodeUrl === 'string' ? nodeUrl.trim() : '';

    if (normalizedTitle === normalizedCurrentTitle && normalizedUrl === normalizedCurrentUrl) {
        return;
    }

    manager.updateBookmark(sectionId, nodeId, {
        title: normalizedTitle,
        url: normalizedUrl
    });
}

async function addTempBookmarkAction(context) {
    const manager = ensureTempManager();
    const { sectionId, nodeId, isFolder } = context;
    const target = isFolder ? nodeId : getTempPasteTarget(context).parentId;
    const lang = currentLang || 'zh_CN';

    const title = prompt(
        lang === 'zh_CN' ? '新书签名称:' : 'New bookmark name:',
        ''
    );
    if (title === null) return;

    const url = prompt(
        lang === 'zh_CN' ? '新书签地址:' : 'New bookmark URL:',
        'https://'
    );
    if (url === null) return;

    manager.createBookmark(sectionId, target, title.trim(), url.trim());
}

async function addTempFolderAction(context) {
    const manager = ensureTempManager();
    const { sectionId, nodeId, isFolder } = context;
    const target = isFolder ? nodeId : getTempPasteTarget(context).parentId;
    const lang = currentLang || 'zh_CN';

    const title = prompt(
        lang === 'zh_CN' ? '新文件夹名称:' : 'New folder name:',
        ''
    );
    if (title === null) return;

    manager.createFolder(sectionId, target, title.trim());
}

async function deleteTempNodes(nodeIds, sectionId, nodeTitle, isFolder) {
    const manager = ensureTempManager();
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];

    // 普通删除不需要二次确认，直接删除
    manager.removeItems(sectionId, ids);
}

function copyTempNodes(sectionId, nodeIds) {
    const manager = ensureTempManager();
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    const payload = manager.extractPayload(sectionId, ids);

    setBookmarkClipboardState({
        action: 'copy',
        source: 'temporary',
        sectionId,
        nodeIds: ids,
        payload,
        timestamp: Date.now()
    });
    unmarkCutNode();
    ;
}

async function cutTempNodes(sectionId, nodeIds) {
    const manager = ensureTempManager();
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    const payload = manager.extractPayload(sectionId, ids);

    setBookmarkClipboardState({
        action: 'cut',
        source: 'temporary',
        sectionId,
        nodeIds: ids,
        payload,
        timestamp: Date.now()
    });

    unmarkCutNode();
    ids.forEach(id => markCutNode(id));
    ;
}

async function pasteIntoTemp(context, requestedPlacement = false) {
    const clipboard = await getLatestBookmarkClipboardForPaste();
    if (!clipboard) return;
    const manager = ensureTempManager();

    try {
        const target = getTempPasteTarget(context, requestedPlacement);
        if (clipboard.source === 'temporary') {
            if (clipboard.action === 'copy') {
                manager.insertFromPayload(target.sectionId, target.parentId, clipboard.payload, target.index);
            } else if (clipboard.action === 'cut') {
                const sourceIds = Array.isArray(clipboard.nodeIds) ? clipboard.nodeIds : [];
                const fallbackItems = Array.isArray(clipboard.payload) ? clipboard.payload : [];
                const existingSourceIds = [];
                const missingPayload = [];
                sourceIds.forEach((id, index) => {
                    const sourceItem = manager.extractPayload(clipboard.sectionId, [id]);
                    if (Array.isArray(sourceItem) && sourceItem.length) existingSourceIds.push(id);
                    else if (fallbackItems[index]) missingPayload.push(fallbackItems[index]);
                });

                if (existingSourceIds.length) {
                    if (clipboard.sectionId === target.sectionId) {
                        manager.moveWithin(target.sectionId, existingSourceIds, target.parentId, target.index);
                    } else {
                        manager.moveAcross(clipboard.sectionId, target.sectionId, existingSourceIds, target.parentId, target.index);
                    }
                }
                if (missingPayload.length) {
                    const offset = typeof target.index === 'number' ? target.index + existingSourceIds.length : target.index;
                    manager.insertFromPayload(target.sectionId, target.parentId, missingPayload, offset);
                }
            }
        } else if (clipboard.source === 'permanent' || clipboard.source === 'mixed') {
            let payload = clipboard.payload;
            if (!payload || !payload.length) {
                payload = [];
                if (chrome && chrome.bookmarks && clipboard.nodeIds) {
                    await __ctxEnsurePermanentMetadataLoaded();
                    for (const id of clipboard.nodeIds) {
                        const node = await readPermanentNodeForPayload(id);
                        if (node) {
                            payload.push(serializeBookmarkNode(node));
                        }
                    }
                }
            }

            if (payload && payload.length) {
                if (clipboard.source === 'mixed' && clipboard.action === 'copy') {
                    const tempPayload = payload.filter(item => String(item && item.__canvasPayloadSource || '') !== 'permanent');
                    const permanentPayload = payload.filter(item => String(item && item.__canvasPayloadSource || '') === 'permanent');
                    let insertIndex = target.index;
                    if (tempPayload.length) {
                        manager.insertFromPayload(target.sectionId, target.parentId, tempPayload, insertIndex);
                        if (typeof insertIndex === 'number') insertIndex += tempPayload.length;
                    }
                    if (permanentPayload.length) {
                        manager.insertFromPayload(target.sectionId, target.parentId, permanentPayload, insertIndex);
                    }
                } else {
                    manager.insertFromPayload(target.sectionId, target.parentId, payload, target.index);
                }
            }

            if (clipboard.source !== 'mixed' && clipboard.action === 'cut' && clipboard.nodeIds) {
                for (const id of clipboard.nodeIds) {
                    try {
                        if (chrome && chrome.bookmarks) {
                            await removePermanentBookmarkNode(id, true);
                        }
                    } catch (error) {
                        console.warn('[临时栏目] 移除原始书签失败:', error);
                    }
                }
            }
        }

        await finalizeBookmarkClipboardPaste(clipboard);
    } catch (error) {
        await restoreBookmarkClipboardCutClaim(clipboard);
        console.error('[临时栏目] 粘贴失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `粘贴失败: ${error.message}` : `Paste failed: ${error.message}`);
    }
}

function countPayloadNodes(payload) {
    if (!payload) return 0;
    const items = Array.isArray(payload) ? payload : [payload];
    let count = 0;
    const stack = [...items];
    while (stack.length) {
        const item = stack.pop();
        if (!item) continue;
        count += 1;
        if (item.children && item.children.length) {
            stack.push(...item.children);
        }
    }
    return count;
}

function serializeBookmarkNode(node) {
    if (!node) return null;
    const out = {
        ...(node.id ? { id: String(node.id) } : {}),
        title: node.title,
        url: node.url || '',
        type: node.url ? 'bookmark' : 'folder',
        __canvasPayloadSource: 'permanent'
    };
    if (node.id && window.TagSystem && typeof window.TagSystem.getPermNodeTagsCached === 'function') {
        const cachedTags = window.TagSystem.getPermNodeTagsCached(node.id);
        if (Array.isArray(cachedTags) && cachedTags.length) {
            out.tags = cachedTags.map(t => ({ color: t.color, text: t.text }));
        }
    }
    const inlineNote = __ctxNormalizeNote(node.note);
    if (inlineNote) {
        out.note = inlineNote;
        out.noteColor = __ctxNormalizeNoteColor(node.noteColor);
    } else if (node.id && window.NoteSystem) {
        try {
            const meta = typeof window.NoteSystem.getPermNodeNoteMetaCached === 'function'
                ? window.NoteSystem.getPermNodeNoteMetaCached(node.id)
                : { note: (typeof window.NoteSystem.getPermNodeNoteCached === 'function' ? window.NoteSystem.getPermNodeNoteCached(node.id) : ''), color: 'orange' };
            const note = __ctxNormalizeNote(meta && meta.note);
            if (note) {
                out.note = note;
                out.noteColor = __ctxNormalizeNoteColor(meta && (meta.noteColor || meta.color));
            }
        } catch (_) { }
    }
    out.children = (node.children || []).map(serializeBookmarkNode);
    return out;
}

function markClipboardPayloadSource(itemsInput, sourceKind) {
    const items = Array.isArray(itemsInput) ? itemsInput : [];
    const source = String(sourceKind || '').trim();
    return items.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const clone = {
            ...item,
            __canvasPayloadSource: source
        };
        clone.children = Array.isArray(item.children)
            ? markClipboardPayloadSource(item.children, source)
            : [];
        return clone;
    }).filter(Boolean);
}

async function handleTempMenuAction(action, context) {
    switch (action) {
        case 'open':
            await openBookmark(context.nodeUrl);
            break;
        case 'open-new-tab':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openBookmarkNewTab(context.nodeUrl);
            await setDefaultOpenMode('new-tab');
            break;
        case 'open-new-window':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openBookmarkNewWindow(context.nodeUrl, false);
            await setDefaultOpenMode('new-window');
            break;
        case 'open-incognito':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openBookmarkNewWindow(context.nodeUrl, true);
            await setDefaultOpenMode('incognito');
            break;
        case 'open-specific-window':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInSpecificWindow(context.nodeUrl, { forceNew: true, context });
            await setDefaultOpenMode('specific-window');
            break;
        case 'open-specific-group':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInSpecificTabGroup(context.nodeUrl, { forceNew: true });
            await setDefaultOpenMode('specific-group');
            break;
        case 'open-same-window-specific-group':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInSameWindowSpecificGroup(context.nodeUrl, { context });
            await setDefaultOpenMode('same-window-specific-group');
            break;
        case 'open-manual-select':
            // 打开手动选择窗口+组的选择器
            await showManualWindowGroupSelector(context);
            break;
        case 'open-scoped-window':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInScopedWindow(context.nodeUrl, { context });
            await setDefaultOpenMode('scoped-window');
            break;
        case 'open-scoped-group':
            if (!shouldAllowBookmarkOpen(`${action}-${context.nodeUrl}`)) return;
            await openInScopedTabGroup(context.nodeUrl, { context });
            await setDefaultOpenMode('scoped-group');
            break;
        case 'open-all':
            await openTempUrls(context.sectionId, context.nodeId, { newWindow: false, incognito: false });
            break;
        case 'open-all-new-window':
            await openTempUrls(context.sectionId, context.nodeId, { newWindow: true, incognito: false });
            break;
        case 'open-all-incognito':
            await openTempUrls(context.sectionId, context.nodeId, { newWindow: true, incognito: true });
            break;
        case 'open-all-tab-group':
            await openTempUrls(context.sectionId, context.nodeId, { tabGroup: true, groupTitle: context.nodeTitle });
            break;
        case 'open-all-manual-select':
            await showManualWindowGroupSelector(context);
            break;
        case 'open-all-manual-select-template-run':
            {
                const urls = await getUrlsFromContext(context);
                await openFolderWithManualSelection(urls, context.nodeTitle, context);
            }
            break;
        case 'edit':
        case 'rename':
            await editTempNode(context);
            break;
        case 'add-entry':
            await openBookmarkAddMenuAction(context);
            break;
        case 'add-template-run':
            await openBookmarkAddByTemplateAction(context);
            break;
        case 'add-page':
            await addTempBookmarkAction(context);
            break;
        case 'add-folder':
            await addTempFolderAction(context);
            break;
        case 'delete':
            // 乐观 UI 更新：立即从 DOM 中移除对应的节点，消除视觉延迟
            if (context.node) {
                const treeNode = context.node.closest('.tree-node');
                if (treeNode) {
                    treeNode.remove();
                }
            }
            await deleteTempNodes(context.nodeId, context.sectionId, context.nodeTitle, context.isFolder);
            break;
        case 'cut':
            await cutTempNodes(context.sectionId, context.nodeId);
            break;
        case 'copy':
            copyTempNodes(context.sectionId, context.nodeId);
            break;
        case 'paste':
            await pasteIntoTemp(context, false);
            break;
        case 'paste-above':
            await pasteIntoTemp(context, 'before');
            break;
        case 'paste-below':
            await pasteIntoTemp(context, true);
            break;
        case 'select-item':
            // 进入Select模式并切换当前节点的选中状态
            if (!selectMode) {
                enterSelectMode();
            }
            if (context.nodeId) {
                toggleSelectItem(context.nodeId, context.node);
            }
            updateBatchToolbar();
            break;
        case 'deselect-all':
            deselectAll();
            updateBatchToolbar();
            break;
        case 'batch-open':
            await batchOpenTemp();
            break;
        case 'batch-open-tab-group':
            await batchOpenTemp({ tabGroup: true });
            break;
        case 'batch-cut':
            await batchCutTemp();
            break;
        case 'batch-delete':
            await batchDeleteTemp();
            break;
        case 'batch-rename':
            await batchRenameTemp();
            break;
        case 'batch-export-html':
        case 'batch-export-json':
        case 'batch-merge-folder':
            alert('该功能暂未在临时栏目中实现');
            break;
        case 'add-tags':
        case 'batch-add-tags':
            await openTagPopoverForContext(action, context);
            break;
        case 'batch-clear-tags':
            await clearTagsForContext(action, context);
            break;
        case 'batch-edit-note':
            await editNotesForContext(action, context);
            break;
        case 'batch-clear-note':
            await clearNotesForContext(action, context);
            break;
        default:
            console.warn('[临时栏目] 未处理的菜单操作:', action);
    }
}


// =================================================================================
// VIII. TAG/NOTE ACTIONS, BOOKMARK ADD FLOW & MENU DISPATCH (标签/备注操作、添加书签流程与菜单派发)
// =================================================================================

// ----- Tag popover entry (Phase E) -----------------------------------------
// Open the tag popover from a right-click action ('add-tags') or a batch
// action ('batch-add-tags'). Resolves anchor + target(s) and delegates to the
// TagSystem module (history_html/tag_system/tag_system.js).
function resolveTagTargetsForContext(action, context) {
    const isBatch = action === 'batch-add-tags' || action === 'batch-clear-tags' ||
                    action === 'batch-edit-note' || action === 'batch-clear-note' ||
                    (action === 'tag-submenu-trigger' && selectedNodes && selectedNodes.size > 0 && context && selectedNodes.has(context.nodeId));
    let targets = [];
    let anchorEl = null;

    if (isBatch && selectedNodes && selectedNodes.size) {
        selectedNodes.forEach((id) => {
            const meta = (selectedNodeMeta && selectedNodeMeta.get) ? selectedNodeMeta.get(id) : null;
            const treeType = (meta && meta.treeType) || (context && context.treeType) || 'permanent';
            if (treeType === 'temporary') {
                const sectionId = meta && meta.sectionId;
                let el = document.querySelector(`.tree-item[data-tree-type="temporary"][data-section-id="${CSS.escape(String(sectionId || ''))}"][data-node-id="${CSS.escape(String(id))}"]`);
                if (!el && context && context.nodeId === id) el = context.node || null;
                const title = el ? (el.dataset.nodeTitle || '') : '';
                const url = el ? (el.dataset.nodeUrl || '') : '';
                targets.push({
                    kind: 'temporary',
                    sectionId: String(sectionId || ''),
                    itemId: String(id),
                    nodeType: el ? (el.dataset.nodeType || 'bookmark') : 'bookmark',
                    title,
                    url
                });
                if (!anchorEl && el) anchorEl = el.querySelector(':scope > .tree-tip-icon') || el;
            } else {
                let el = document.querySelector(`.tree-item[data-node-id="${CSS.escape(String(id))}"]:not([data-tree-type="temporary"])`);
                const title = el ? (el.dataset.nodeTitle || '') : '';
                const url = el ? (el.dataset.nodeUrl || '') : '';
                targets.push({
                    kind: 'permanent',
                    chromeId: String(id),
                    nodeType: el ? (el.dataset.nodeType || 'bookmark') : 'bookmark',
                    title,
                    url
                });
                if (!anchorEl && el) anchorEl = el.querySelector(':scope > .tree-tip-icon') || el;
            }
        });
    } else if (context && context.nodeId) {
        const treeType = context.treeType || 'permanent';
        if (treeType === 'temporary') {
            targets.push({
                kind: 'temporary',
                sectionId: String(context.sectionId || ''),
                itemId: String(context.nodeId),
                nodeType: context.isFolder ? 'folder' : 'bookmark',
                title: context.nodeTitle || '',
                url: context.nodeUrl || ''
            });
        } else {
            targets.push({
                kind: 'permanent',
                chromeId: String(context.nodeId),
                nodeType: context.isFolder ? 'folder' : 'bookmark',
                title: context.nodeTitle || '',
                url: context.nodeUrl || ''
            });
        }
        const sel = treeType === 'temporary'
            ? `.tree-item[data-tree-type="temporary"][data-section-id="${CSS.escape(String(context.sectionId || ''))}"][data-node-id="${CSS.escape(String(context.nodeId))}"]`
            : `.tree-item[data-node-id="${CSS.escape(String(context.nodeId))}"]:not([data-tree-type="temporary"])`;
        const el = document.querySelector(sel) || (context.node || null);
        if (el) anchorEl = (el.querySelector ? el.querySelector(':scope > .tree-tip-icon') : null) || el;
    }

    return { targets, anchorEl };
}

async function openTagPopoverForContext(action, context, anchorOverride) {
    if (typeof window.openTagPopover !== 'function' || !window.TagSystem) return;
    const { targets, anchorEl } = resolveTagTargetsForContext(action, context);
    if (!targets.length) return;
    // Batch actions originate in a floating panel.  Keep the Tag popover next to
    // that command rather than jumping to the first selected canvas item.
    const anchor = anchorOverride || (action === 'batch-add-tags'
        ? document.getElementById('batch-action-panel')
        : anchorEl);
    window.openTagPopover({ targets, anchor });
}

async function __ctxFilterTargetsWithTags(targets) {
    const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
    const tagSystem = (typeof window !== 'undefined') ? window.TagSystem : null;
    if (!tagSystem || typeof tagSystem.getTagsForTarget !== 'function') return list;

    const tagsByTarget = await Promise.all(list.map(async (target) => {
        try {
            const tags = await tagSystem.getTagsForTarget(target);
            return Array.isArray(tags) ? tags : [];
        } catch (_) {
            return null;
        }
    }));
    // Keep unreadable targets as a fallback; normally every target is readable.
    return list.filter((_, index) => tagsByTarget[index] === null || tagsByTarget[index].length > 0);
}

async function clearTagsForContext(action, context) {
    const { targets } = resolveTagTargetsForContext(action, context);
    if (!targets.length) return;
    const lang = currentLang || 'zh_CN';
    const message = lang === 'zh_CN'
        ? `确定清除选中 ${targets.length} 项里的所有标签吗？`
        : `Clear all tags from ${targets.length} selected item(s)?`;
    if (!confirm(message)) return;

    const targetsToClear = await __ctxFilterTargetsWithTags(targets);

    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    const permanentUpdates = [];
    const permanentTargets = [];
    const changedTargets = [];
    let clearedCount = 0;

    for (const target of targetsToClear) {
        if (!target) continue;
        if (target.kind === 'permanent') {
            permanentUpdates.push({ chromeId: target.chromeId, tags: [] });
            permanentTargets.push(target);
        } else if (target.kind === 'temporary' && typeof setTempItemTags === 'function') {
            const ok = setTempItemTags(target.sectionId, target.itemId, []);
            if (ok) {
                changedTargets.push(Object.assign({}, target, { tags: [] }));
                clearedCount += 1;
            }
        }
    }

    if (permanentUpdates.length && bridge) {
        if (typeof bridge.writePermanentNodeTagsBulk === 'function') {
            const result = await bridge.writePermanentNodeTagsBulk(permanentUpdates);
            const changed = result && Number.isFinite(result.changed) ? result.changed : 0;
            clearedCount += changed;
            if (changed) {
                permanentTargets.forEach((target) => changedTargets.push(Object.assign({}, target, { tags: [] })));
            }
        } else if (typeof bridge.writePermanentNodeTags === 'function') {
            for (let i = 0; i < permanentUpdates.length; i++) {
                const update = permanentUpdates[i];
                const result = await bridge.writePermanentNodeTags(update.chromeId, update.tags);
                if (result) {
                    changedTargets.push(Object.assign({}, permanentTargets[i], { tags: [] }));
                    clearedCount += 1;
                }
            }
        }
    }

    if (!changedTargets.length) {
        if (typeof showToast === 'function') {
            showToast(lang === 'zh_CN'
                ? `已清除 ${clearedCount} 项的标签`
                : `Cleared tags from ${clearedCount} item(s)`);
        }
        return;
    }
    if (typeof window.closeTagPopover === 'function') {
        try { window.closeTagPopover(); } catch (_) {}
    }
    if (typeof window.__refreshTagDotsForTargets === 'function') {
        try { window.__refreshTagDotsForTargets(changedTargets); } catch (_) {}
    }
    try {
        if (typeof window.markCanvasSearchBookmarkTagDirty === 'function') {
            window.markCanvasSearchBookmarkTagDirty(changedTargets);
        }
        if (typeof window.updateCanvasSearchBookmarkTags === 'function') {
            window.updateCanvasSearchBookmarkTags(changedTargets);
        }
        const input = document.getElementById('searchInput');
        const q = input && typeof input.value === 'string' ? input.value.trim() : '';
        if (q && typeof window.searchCanvasAndRender === 'function') {
            window.searchCanvasAndRender(q);
        }
    } catch (_) {}
    if (typeof showToast === 'function') {
        showToast(lang === 'zh_CN'
            ? `已清除 ${clearedCount} 项的标签`
            : `Cleared tags from ${clearedCount} item(s)`);
    }
}

function __ctxReadNoteMetaForTarget(target) {
    if (!target) return { note: '', noteColor: 'orange' };
    try {
        if (typeof window !== 'undefined' && window.NoteSystem && typeof window.NoteSystem.getNoteMetaForTargetSync === 'function') {
            const meta = window.NoteSystem.getNoteMetaForTargetSync(target) || {};
            return {
                note: __ctxNormalizeNote(meta.note),
                noteColor: __ctxNormalizeNoteColor(meta.noteColor || meta.color)
            };
        }
    } catch (_) { }
    try {
        if (target.kind === 'temporary') {
            if (typeof getTempItemNoteMeta === 'function') {
                const meta = getTempItemNoteMeta(target.sectionId, target.itemId) || {};
                return {
                    note: __ctxNormalizeNote(meta.note),
                    noteColor: __ctxNormalizeNoteColor(meta.noteColor || meta.color)
                };
            }
            if (typeof getTempItemNote === 'function') {
                return {
                    note: __ctxNormalizeNote(getTempItemNote(target.sectionId, target.itemId)),
                    noteColor: 'orange'
                };
            }
        } else if (target.kind === 'permanent' && typeof window !== 'undefined' && window.NoteSystem) {
            if (typeof window.NoteSystem.getPermNodeNoteMetaCached === 'function') {
                const meta = window.NoteSystem.getPermNodeNoteMetaCached(target.chromeId) || {};
                return {
                    note: __ctxNormalizeNote(meta.note),
                    noteColor: __ctxNormalizeNoteColor(meta.noteColor || meta.color)
                };
            }
            if (typeof window.NoteSystem.getPermNodeNoteCached === 'function') {
                return {
                    note: __ctxNormalizeNote(window.NoteSystem.getPermNodeNoteCached(target.chromeId)),
                    noteColor: 'orange'
                };
            }
        }
    } catch (_) { }
    return { note: '', noteColor: 'orange' };
}

function __ctxBuildBatchNoteInitialMeta(targets) {
    const list = (Array.isArray(targets) ? targets : []).map(__ctxReadNoteMetaForTarget);
    if (!list.length) return { note: '', noteColor: 'orange', mixed: false };
    const first = list[0];
    const sameNote = list.every((meta) => __ctxNormalizeNote(meta.note) === __ctxNormalizeNote(first.note));
    const sameColor = list.every((meta) => __ctxNormalizeNoteColor(meta.noteColor) === __ctxNormalizeNoteColor(first.noteColor));
    return {
        note: sameNote ? first.note : '',
        noteColor: sameColor ? first.noteColor : 'orange',
        mixed: !sameNote
    };
}

function showBatchNoteEditModal(targets) {
    const lang = currentLang || 'zh_CN';
    const initial = __ctxBuildBatchNoteInitialMeta(targets);
    const palette = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
    const count = Array.isArray(targets) ? targets.length : 0;
    const selectedInitial = __ctxNormalizeNoteColor(initial.noteColor);

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal content-center batch-note-edit-modal';
        modal.innerHTML = `
            <div class="modal-content batch-note-edit-content">
                <div class="modal-header compact batch-note-edit-header">
                    <h3>${escapeHtml(lang === 'zh_CN' ? `批量编辑笔记 (${count})` : `Batch Edit Notes (${count})`)}</h3>
                    <button class="modal-close perf-modal-close batch-note-edit-close" type="button" aria-label="${escapeHtml(lang === 'zh_CN' ? '关闭' : 'Close')}"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body batch-note-edit-body">
                    <div class="info-note-heading">
                        <span class="info-card-label">${escapeHtml(lang === 'zh_CN' ? 'NOTE' : 'NOTE')}</span>
                        <div class="batch-note-edit-heading-controls">
                            <div class="info-note-color-palette">
                                ${palette.map((color) =>
                                    `<button class="tag-palette-btn info-note-color-btn${color === selectedInitial ? ' is-selected' : ''}" data-note-color="${escapeHtml(color)}" type="button" aria-label="${escapeHtml(color)}"><span class="tag-dot tag-dot-${escapeHtml(color)}"></span></button>`
                                ).join('')}
                            </div>
                            <div class="batch-note-edit-actions">
                                <button class="perf-btn secondary batch-note-edit-btn" type="button" data-note-cancel="true">${escapeHtml(lang === 'zh_CN' ? '取消' : 'Cancel')}</button>
                                <button class="perf-btn primary batch-note-edit-btn" type="button" data-note-save="true">${escapeHtml(lang === 'zh_CN' ? '保存' : 'Save')}</button>
                            </div>
                        </div>
                    </div>
                    <div class="info-note-editor note-color-${escapeHtml(selectedInitial)}">
                        <textarea class="info-note-textarea" rows="5" placeholder="${escapeHtml(lang === 'zh_CN' ? '添加笔记...' : 'Add note...')}">${escapeHtml(initial.note)}</textarea>
                    </div>
                </div>
            </div>
        `;

        let closed = false;
        const cleanup = (value) => {
            if (closed) return;
            closed = true;
            modal.classList.remove('show');
            setTimeout(() => { try { modal.remove(); } catch (_) { } }, 120);
            resolve(value);
        };
        const editor = modal.querySelector('.info-note-editor');
        const textarea = modal.querySelector('.info-note-textarea');
        let selectedColor = selectedInitial;
        const applyColor = (colorInput) => {
            selectedColor = __ctxNormalizeNoteColor(colorInput, selectedColor);
            if (editor) {
                palette.forEach((color) => editor.classList.remove(`note-color-${color}`));
                editor.classList.add(`note-color-${selectedColor}`);
            }
            modal.querySelectorAll('.info-note-color-btn').forEach((btn) => {
                btn.classList.toggle('is-selected', btn.dataset.noteColor === selectedColor);
            });
        };

        modal.addEventListener('click', (event) => {
            if (isInfoNoteTextareaExternalCloseGuardActive() && event.target === modal) return;
            if (event.target === modal || event.target.closest('.modal-close') || event.target.closest('[data-note-cancel="true"]')) {
                cleanup(null);
                return;
            }
            const colorBtn = event.target.closest('.info-note-color-btn');
            if (colorBtn) {
                event.preventDefault();
                applyColor(colorBtn.dataset.noteColor);
                return;
            }
            if (event.target.closest('[data-note-save="true"]')) {
                cleanup({
                    note: __ctxNormalizeNote(textarea ? textarea.value : ''),
                    noteColor: selectedColor
                });
            }
        });
        modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') cleanup(null);
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                cleanup({
                    note: __ctxNormalizeNote(textarea ? textarea.value : ''),
                    noteColor: selectedColor
                });
            }
        });
        if (textarea) {
            textarea.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
            textarea.addEventListener('mousedown', armInfoNoteTextareaExternalCloseGuard);
            textarea.addEventListener('pointerdown', armInfoNoteTextareaExternalCloseGuard);
        }

        getOverlayContainer().appendChild(modal);
        requestAnimationFrame(() => {
            modal.classList.add('show');
            if (textarea) textarea.focus();
        });
    });
}

async function writeNotesForContextTargets(targets, noteInput, colorInput, reason = '') {
    const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!list.length) return [];
    const note = __ctxNormalizeNote(noteInput);
    const noteColor = __ctxNormalizeNoteColor(colorInput);
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    const permanentUpdates = [];
    const permanentTargets = [];
    const changedTargets = [];
    const changedTempSectionIds = new Set();

    for (const target of list) {
        if (target.kind === 'permanent') {
            permanentUpdates.push({ chromeId: target.chromeId, note, noteColor });
            permanentTargets.push(target);
        } else if (target.kind === 'temporary') {
            let ok = false;
            if (typeof setTempItemNote === 'function') {
                ok = !!setTempItemNote(target.sectionId, target.itemId, note, {
                    noteColor,
                    skipRender: true,
                    skipSave: true,
                    skipSearchUpdate: true
                });
            } else if (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.setNote === 'function') {
                ok = !!window.CanvasModule.temp.setNote(target.sectionId, target.itemId, note, {
                    noteColor,
                    skipRender: true,
                    skipSave: true,
                    skipSearchUpdate: true
                });
            }
            if (ok) {
                changedTempSectionIds.add(String(target.sectionId || ''));
                changedTargets.push(Object.assign({}, target, { note, color: noteColor, noteColor }));
            }
        }
    }

    if (permanentUpdates.length && bridge) {
        if (typeof bridge.writePermanentNodeNotesBulk === 'function') {
            const result = await bridge.writePermanentNodeNotesBulk(permanentUpdates);
            if (result && result.changed) {
                permanentTargets.forEach((target) => changedTargets.push(Object.assign({}, target, { note, color: noteColor, noteColor })));
            }
        } else if (typeof bridge.writePermanentNodeNoteMeta === 'function') {
            for (let i = 0; i < permanentUpdates.length; i += 1) {
                const update = permanentUpdates[i];
                const result = await bridge.writePermanentNodeNoteMeta(update.chromeId, update.note, update.noteColor);
                if (result) {
                    changedTargets.push(Object.assign({}, permanentTargets[i], { note, color: noteColor, noteColor }));
                }
            }
        } else if (typeof bridge.writePermanentNodeNote === 'function') {
            for (let i = 0; i < permanentUpdates.length; i += 1) {
                const update = permanentUpdates[i];
                const result = await bridge.writePermanentNodeNote(update.chromeId, update.note, { noteColor: update.noteColor });
                if (result) {
                    changedTargets.push(Object.assign({}, permanentTargets[i], { note, color: noteColor, noteColor }));
                }
            }
        } else {
            console.warn('[元数据] 永久书签笔记写入桥接不可用:', reason);
        }
    }

    if (changedTempSectionIds.size && window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.getSection === 'function') {
        const changedSections = [];
        changedTempSectionIds.forEach((sectionId) => {
            try {
                const section = window.CanvasModule.temp.getSection(sectionId);
                if (section) changedSections.push(section);
                const refreshFn = (typeof window.refreshTempSectionTreeInPlace === 'function')
                    ? window.refreshTempSectionTreeInPlace
                    : (typeof refreshTempSectionTreeInPlace === 'function' ? refreshTempSectionTreeInPlace : null);
                if (section && refreshFn) {
                    refreshFn(section);
                }
            } catch (_) { }
        });
        try {
            if (window.CanvasModule.temp && typeof window.CanvasModule.temp.saveSectionsPatch === 'function' && changedSections.length) {
                await window.CanvasModule.temp.saveSectionsPatch(changedSections);
            } else {
                const saveFn = (typeof window.saveTempNodes === 'function')
                    ? window.saveTempNodes
                    : (typeof saveTempNodes === 'function' ? saveTempNodes : null);
                if (saveFn) await saveFn();
            }
        } catch (_) { }
    }

    if (!changedTargets.length) return [];
    try {
        if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
            await window.NoteSystem.ensurePermNotesLoaded(true);
        }
    } catch (_) { }
    if (typeof window.__refreshNoteMarkersForTargets === 'function') {
        try { window.__refreshNoteMarkersForTargets(changedTargets); } catch (_) { }
    } else if (typeof window.__refreshAllNoteMarkers === 'function') {
        try { window.__refreshAllNoteMarkers(); } catch (_) { }
    }
    try {
        if (typeof window.updateCanvasSearchBookmarkNotes === 'function') {
            window.updateCanvasSearchBookmarkNotes(changedTargets);
        }
        if (typeof window.markCanvasSearchBookmarkNoteDirty === 'function') {
            window.markCanvasSearchBookmarkNoteDirty(changedTargets);
        }
        const input = document.getElementById('searchInput');
        const q = input && typeof input.value === 'string' ? input.value.trim() : '';
        if (q && typeof window.searchCanvasAndRender === 'function') {
            window.searchCanvasAndRender(q);
        }
    } catch (_) { }
    return changedTargets;
}

async function editNotesForContext(action, context) {
    const { targets } = resolveTagTargetsForContext(action, context);
    if (!targets.length) return;
    try {
        if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
            await window.NoteSystem.ensurePermNotesLoaded();
        }
    } catch (_) { }
    const result = await showBatchNoteEditModal(targets);
    if (!result) return;
    await writeNotesForContextTargets(targets, result.note, result.noteColor, 'batch-edit-note');
}

async function clearNotesForContext(action, context) {
    const { targets } = resolveTagTargetsForContext(action, context);
    if (!targets.length) return;
    const lang = currentLang || 'zh_CN';
    const message = lang === 'zh_CN'
        ? `确定清除选中 ${targets.length} 项里的笔记吗？`
        : `Clear notes from ${targets.length} selected item(s)?`;
    if (!confirm(message)) return;
    let targetsToClear = targets;
    try {
        if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
            await window.NoteSystem.ensurePermNotesLoaded();
            targetsToClear = targets.filter((target) => __ctxReadNoteMetaForTarget(target).note.length > 0);
        }
    } catch (_) { }
    const changedTargets = await writeNotesForContextTargets(targetsToClear, '', 'orange', 'batch-clear-note');
    if (typeof showToast === 'function') {
        showToast(lang === 'zh_CN'
            ? `已清除 ${changedTargets.length} 项的笔记`
            : `Cleared notes from ${changedTargets.length} item(s)`);
    }
}

async function batchOpenTemp(options = {}) {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '请先选择临时栏目中的书签或文件夹' : 'Select temporary bookmarks first');
        return;
    }
    const urlSet = new Set();
    tempNodes.forEach(node => {
        if (node.isFolder) {
            collectTempUrls(node.sectionId, node.id).forEach(url => urlSet.add(url));
        } else if (node.url) {
            urlSet.add(node.url);
        }
    });
    await openUrlList(Array.from(urlSet), options);
}

async function batchCutTemp() {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) return;
    const sectionId = tempNodes[0].sectionId;
    const allSameSection = tempNodes.every(node => node.sectionId === sectionId);
    if (!allSameSection) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '剪切操作仅支持同一临时栏目内的节点' : 'Cut only supports nodes within the same temporary section');
        return;
    }
    const ids = tempNodes.map(node => node.id);
    await cutTempNodes(sectionId, ids);
}

async function batchDeleteTemp() {
    const tempNodes = getSelectedTempNodes();
    if (!tempNodes.length) return;
    const lang = currentLang || 'zh_CN';
    const message = lang === 'zh_CN'
        ? `确定要删除选中的 ${tempNodes.length} 项吗？`
        : `Delete ${tempNodes.length} selected items?`;
    if (!confirm(message)) return;
    const manager = ensureTempManager();
    const sectionGroups = new Map();
    tempNodes.forEach(node => {
        if (!sectionGroups.has(node.sectionId)) {
            sectionGroups.set(node.sectionId, []);
        }
        sectionGroups.get(node.sectionId).push(node.id);
    });
    sectionGroups.forEach((ids, sectionId) => {
        manager.removeItems(sectionId, ids);
    });
    deselectAll();
}

async function batchRenameTemp() {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
    const caps = getBatchSelectionCapabilities();

    const tempNodes = caps.tempNodes;
    if (!tempNodes.length) return;

    const newTitle = prompt(
        lang === 'zh_CN' ? '请输入统一的新名称（覆盖所有选中项）:' : 'Enter a new name (overwrites all selected items):',
        ''
    );
    if (newTitle === null) return;
    const normalizedTitle = newTitle.trim();
    if (!normalizedTitle) return;

    const manager = ensureTempManager();
    let count = 0;
    for (const node of tempNodes) {
        if (node.isFolder) {
            manager.renameItem(node.sectionId, node.id, normalizedTitle);
        } else {
            manager.updateBookmark(node.sectionId, node.id, {
                title: normalizedTitle
            });
        }
        count++;
    }
    ;
}

function __normalizeBookmarkAddActionType(actionType) {
    const value = String(actionType || '').trim();
    const allowCurrentTab = __isSidePanelModeForAdd();

    if (value === 'add-current-tab' && !allowCurrentTab) {
        return 'add-page';
    }

    if (value === 'add-page' || value === 'add-folder' || value === 'add-current-window' || value === 'add-all-windows-card-group' || (allowCurrentTab && value === 'add-current-tab')) {
        return value;
    }

    return 'add-page';
}

function __getBookmarkAddPositionOptions(context) {
    const lang = currentLang || 'zh_CN';

    if (context && context.blankRoot) {
        const isCanvasBlank = context.sectionId === '__canvas-blank-add-target__';
        return [
            {
                value: 'inside',
                label: isCanvasBlank
                    ? (lang === 'zh_CN' ? '生成特殊临时栏目' : 'Generate Special Temporary Section')
                    : (lang === 'zh_CN' ? '根目录' : 'Root Directory')
            }
        ];
    }

    if (context && context.isFolder) {
        return [
            {
                value: 'inside',
                label: lang === 'zh_CN' ? '文件夹内（默认）' : 'Inside Folder (Default)'
            },
            {
                value: 'before',
                label: lang === 'zh_CN' ? '文件夹上方' : 'Above Folder'
            },
            {
                value: 'after',
                label: lang === 'zh_CN' ? '文件夹下方' : 'Below Folder'
            }
        ];
    }

    return [
        {
            value: 'after',
            label: lang === 'zh_CN' ? '当前书签下方（默认）' : 'Below Bookmark (Default)'
        },
        {
            value: 'before',
            label: lang === 'zh_CN' ? '当前书签上方' : 'Above Bookmark'
        }
    ];
}

function __isSidePanelModeForAdd() {
    try {
        if (typeof window !== 'undefined' && typeof window.__SIDE_PANEL_MODE__ === 'boolean') {
            return window.__SIDE_PANEL_MODE__;
        }
    } catch (_) { }

    try {
        const params = new URLSearchParams((window && window.location && window.location.search) || '');
        const flag = params.get('sidepanel') || params.get('side_panel') || params.get('panel');
        return flag === '1' || flag === 'true';
    } catch (_) {
        return false;
    }
}

function __normalizeBookmarkAddPosition(context, position) {
    const options = __getBookmarkAddPositionOptions(context);
    const allowed = options.map((item) => item.value);
    const normalized = String(position || '').trim();
    if (allowed.includes(normalized)) return normalized;
    return context && context.isFolder ? 'inside' : 'after';
}

function __normalizeBookmarkAddWindowAsFolder(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function __normalizeBookmarkAddLocateAfterAction(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function __formatBookmarkAddWindowFolderTitle() {
    const lang = currentLang || 'zh_CN';
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const dt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return lang === 'zh_CN' ? `窗口标签 ${dt}` : `Window Tabs ${dt}`;
}

function __readBookmarkAddTemplate() {
    try {
        const raw = localStorage.getItem(BOOKMARK_ADD_TEMPLATE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const hasWindowAsFolder = Object.prototype.hasOwnProperty.call(parsed, 'windowAsFolder');
        const hasLocateAfterAction = Object.prototype.hasOwnProperty.call(parsed, 'locateAfterAction');
        const actionType = __normalizeBookmarkAddActionType(parsed.actionType);
        return {
            actionType,
            position: parsed.position || null,
            windowAsFolder: hasWindowAsFolder
                ? __normalizeBookmarkAddWindowAsFolder(parsed.windowAsFolder)
                : (actionType === 'add-all-windows-card-group' ? false : true),
            locateAfterAction: hasLocateAfterAction
                ? __normalizeBookmarkAddLocateAfterAction(parsed.locateAfterAction)
                : true
        };
    } catch (_) {
        return null;
    }
}

function __writeBookmarkAddTemplate(config) {
    if (!config || typeof config !== 'object') return;
    const normalizedActionType = __normalizeBookmarkAddActionType(config.actionType);
    const payload = {
        actionType: normalizedActionType,
        position: config.position || null,
        windowAsFolder: (normalizedActionType === 'add-current-window' || normalizedActionType === 'add-all-windows-card-group') && __normalizeBookmarkAddWindowAsFolder(config.windowAsFolder),
        locateAfterAction: __normalizeBookmarkAddLocateAfterAction(config.locateAfterAction),
        updatedAt: Date.now()
    };
    try {
        localStorage.setItem(BOOKMARK_ADD_TEMPLATE_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) { }
}

function __queryCurrentWindowTabs(query = {}) {
    return new Promise((resolve) => {
        try {
            if (!chrome || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
                resolve([]);
                return;
            }
            chrome.tabs.query(query, (tabs) => {
                resolve(Array.isArray(tabs) ? tabs : []);
            });
        } catch (_) {
            resolve([]);
        }
    });
}

function __sortBookmarkAddTabsByIndex(tabs) {
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

function __dedupeBookmarkAddTabs(tabs) {
    const list = __sortBookmarkAddTabsByIndex(tabs);
    const seen = new Set();
    const deduped = [];
    list.forEach((tab) => {
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

async function __queryCurrentTabActionTabs() {
    const highlightedTabs = __dedupeBookmarkAddTabs(await __queryCurrentWindowTabs({ currentWindow: true, highlighted: true }));
    if (highlightedTabs.length > 0) {
        return highlightedTabs;
    }

    const activeTabs = __dedupeBookmarkAddTabs(await __queryCurrentWindowTabs({ currentWindow: true, active: true }));
    const activeTab = activeTabs[0] || null;
    return activeTab ? [activeTab] : [];
}

function __waitBookmarkAddLocateDelay(delayMs) {
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    return new Promise((resolve) => {
        setTimeout(resolve, safeDelay);
    });
}

async function __prepareBookmarkAddLocateTarget(target) {
    if (!target || typeof target !== 'object') return;

    if (target.source === 'temporary') {
        try {
            if (window.CanvasModule && typeof window.CanvasModule.forceWakeAndRender === 'function' && target.sectionId) {
                window.CanvasModule.forceWakeAndRender(target.sectionId);
            }
        } catch (_) { }
        try {
            if (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.ensureRendered === 'function' && target.sectionId) {
                window.CanvasModule.temp.ensureRendered(target.sectionId);
            }
        } catch (_) { }
    } else {
        try {
            if (typeof flushPendingAddRemoveEvents === 'function') {
                await flushPendingAddRemoveEvents('bookmark-add-locate');
            }
        } catch (_) { }
        try {
            if (typeof refreshCachedCurrentTreeSnapshot === 'function') {
                await refreshCachedCurrentTreeSnapshot('bookmark-add-locate');
            }
        } catch (_) { }
    }

    await __waitBookmarkAddLocateDelay(0);
}

function __getBookmarkAddLocateTreeItem(target) {
    if (!target || typeof target !== 'object' || !target.id) return null;

    if (target.source === 'temporary') {
        const sectionEl = document.getElementById(String(target.sectionId || '').trim());
        const tree = sectionEl ? sectionEl.querySelector('.temp-bookmark-tree') : null;
        return tree ? tree.querySelector(`.tree-item[data-node-id="${CSS.escape(String(target.id))}"]`) : null;
    }

    let sectionEl = null;
    const copyId = String(target.copyId || '').trim();
    if (copyId) {
        try {
            sectionEl = document.querySelector(`.permanent-bookmark-section[data-permanent-section-copy-id="${CSS.escape(copyId)}"]`);
        } catch (_) {
            sectionEl = null;
        }
        if (!sectionEl) {
            sectionEl = document.getElementById(`permanent-section-copy-${copyId}`);
        }
    } else {
        sectionEl = document.getElementById('permanentSection');
    }
    const tree = (sectionEl && sectionEl.querySelector('.bookmark-tree'))
        || (sectionEl && sectionEl.querySelector('#bookmarkTree'))
        || document.getElementById('bookmarkTree');
    return tree ? tree.querySelector(`.tree-item[data-node-id="${CSS.escape(String(target.id))}"]`) : null;
}

function __applyBookmarkAddLocateOutline(treeItem, color = '#3b82f6') {
    if (!treeItem) return false;
    try {
        treeItem.style.setProperty('--search-highlight-color', color);
        treeItem.classList.add('search-locate-outline');
        setTimeout(() => {
            try {
                treeItem.classList.remove('search-locate-outline');
                treeItem.style.removeProperty('--search-highlight-color');
            } catch (_) { }
        }, 2000);
        return true;
    } catch (_) {
        return false;
    }
}

function __clearBookmarkAddLocateVisuals() {
    try {
        if (typeof clearSearchTreeItemOutline === 'function') {
            clearSearchTreeItemOutline();
            return;
        }
    } catch (_) { }

    try {
        document.querySelectorAll('.tree-item.search-locate-outline').forEach((el) => {
            try {
                el.classList.remove('search-locate-outline');
                el.style.removeProperty('--search-highlight-color');
            } catch (_) { }
        });
        document.querySelectorAll('.tree-locate-group-outline').forEach((el) => {
            try { el.remove(); } catch (_) { }
        });
    } catch (_) { }
}

function __getBookmarkAddLocateGroupContainer(treeItem) {
    if (!treeItem || typeof treeItem.closest !== 'function') return null;
    return treeItem.closest('.bookmark-tree, .temp-bookmark-tree')
        || treeItem.closest('.permanent-section-body, .temp-node-body')
        || null;
}

function __getBookmarkAddLocateContainerScale(container) {
    if (!container || typeof container.getBoundingClientRect !== 'function') {
        return { rect: null, scaleX: 1, scaleY: 1 };
    }

    try {
        const rect = container.getBoundingClientRect();
        const layoutWidth = Math.max(1, Number(container.offsetWidth || container.clientWidth) || 0);
        const layoutHeight = Math.max(1, Number(container.offsetHeight || container.clientHeight) || 0);
        let scaleX = rect && Number.isFinite(rect.width) && rect.width > 0
            ? rect.width / layoutWidth
            : 1;
        let scaleY = rect && Number.isFinite(rect.height) && rect.height > 0
            ? rect.height / layoutHeight
            : 1;

        if (!Number.isFinite(scaleX) || scaleX <= 0) scaleX = 1;
        if (!Number.isFinite(scaleY) || scaleY <= 0) scaleY = 1;

        return { rect, scaleX, scaleY };
    } catch (_) {
        return { rect: null, scaleX: 1, scaleY: 1 };
    }
}

function __appendBookmarkAddLocateGroupOutline(treeItems, color = '#3b82f6', container = null) {
    const list = (Array.isArray(treeItems) ? treeItems : []).filter(Boolean);
    if (!list.length || !document || !document.body) return 0;
    const outlineContainer = container || __getBookmarkAddLocateGroupContainer(list[0]) || document.body;
    if (!outlineContainer || typeof outlineContainer.appendChild !== 'function') return 0;

    const rects = list
        .map((item) => {
            try { return item.getBoundingClientRect(); } catch (_) { return null; }
        })
        .filter((rect) => rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0);

    if (!rects.length) return 0;

    const padding = 6;
    const minLeft = Math.min(...rects.map((rect) => rect.left)) - padding;
    const minTop = Math.min(...rects.map((rect) => rect.top)) - padding;
    const maxRight = Math.max(...rects.map((rect) => rect.right)) + padding;
    const maxBottom = Math.max(...rects.map((rect) => rect.bottom)) + padding;
    const scaleInfo = __getBookmarkAddLocateContainerScale(outlineContainer);
    const containerRect = scaleInfo.rect;
    const scaleX = scaleInfo.scaleX;
    const scaleY = scaleInfo.scaleY;
    const innerLeft = containerRect ? containerRect.left + ((Number(outlineContainer.clientLeft) || 0) * scaleX) : 0;
    const innerTop = containerRect ? containerRect.top + ((Number(outlineContainer.clientTop) || 0) * scaleY) : 0;
    const scrollLeft = Math.max(0, Number(outlineContainer.scrollLeft) || 0);
    const scrollTop = Math.max(0, Number(outlineContainer.scrollTop) || 0);
    const outlineLeft = scrollLeft + ((minLeft - innerLeft) / scaleX);
    const outlineTop = scrollTop + ((minTop - innerTop) / scaleY);
    const outlineWidth = (maxRight - minLeft) / scaleX;
    const outlineHeight = (maxBottom - minTop) / scaleY;

    const outline = document.createElement('div');
    outline.className = 'tree-locate-group-outline';
    outline.style.setProperty('--search-highlight-color', color);
    outline.style.left = `${outlineLeft}px`;
    outline.style.top = `${outlineTop}px`;
    outline.style.width = `${Math.max(0, outlineWidth)}px`;
    outline.style.height = `${Math.max(0, outlineHeight)}px`;
    outlineContainer.appendChild(outline);

    setTimeout(() => {
        try { outline.remove(); } catch (_) { }
    }, 2000);

    return list.length;
}

function __highlightBookmarkAddLocateTargets(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const groups = new Map();
    list.forEach((target) => {
        const treeItem = __getBookmarkAddLocateTreeItem(target);
        if (!treeItem) return;
        const container = __getBookmarkAddLocateGroupContainer(treeItem) || treeItem;
        const color = target && target.color ? target.color : '#3b82f6';
        let entry = groups.get(container);
        if (!entry) {
            entry = { items: [], color, container };
            groups.set(container, entry);
        }
        entry.items.push(treeItem);
        if (!entry.color && color) entry.color = color;
    });

    __clearBookmarkAddLocateVisuals();

    let count = 0;
    groups.forEach((entry) => {
        const items = entry && Array.isArray(entry.items) ? entry.items : [];
        const color = entry && entry.color ? entry.color : '#3b82f6';
        if (!items.length) return;
        if (items.length === 1) {
            if (__applyBookmarkAddLocateOutline(items[0], color)) {
                count += 1;
            }
            return;
        }
        count += __appendBookmarkAddLocateGroupOutline(items, color, entry && entry.container ? entry.container : null);
    });

    return count;
}

async function __locateBookmarkAddTargetWithRetry(target) {
    if (!target || typeof target !== 'object') return false;

    const attemptLocate = async () => {
        if (typeof window !== 'undefined' && typeof window.locateCanvasBookmarkTreeItem === 'function') {
            return !!(await window.locateCanvasBookmarkTreeItem(target));
        }
        if (typeof window === 'undefined' || !window.CanvasModule) return false;
        if (target.source === 'temporary' && target.sectionId && typeof window.CanvasModule.locateSection === 'function') {
            window.CanvasModule.locateSection(target.sectionId);
            return true;
        }
        if (target.source === 'permanent' && typeof window.CanvasModule.locatePermanent === 'function') {
            window.CanvasModule.locatePermanent();
            return true;
        }
        return false;
    };

    const retryDelays = [0, 90, 180, 320, 520, 760];
    for (let index = 0; index < retryDelays.length; index += 1) {
        const delay = retryDelays[index];
        if (delay > 0) {
            await __waitBookmarkAddLocateDelay(delay);
        }
        await __prepareBookmarkAddLocateTarget(target);
        const located = await attemptLocate();
        if (located) return true;
    }

    return false;
}

function __dedupeBookmarkAddLocateTargets(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const seen = new Set();
    return list.filter((target) => {
        if (!target || !target.id) return false;
        const key = [
            String(target.source || ''),
            String(target.sectionId || ''),
            String(target.copyId || ''),
            String(target.id || '')
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function __locateBookmarkAddTargetsWithRetry(targets) {
    const list = __dedupeBookmarkAddLocateTargets(targets);
    if (!list.length) return false;

    const anchor = (list.length > 1)
        ? Object.assign({}, list[0], { suppressOutline: true })
        : list[0];
    const located = await __locateBookmarkAddTargetWithRetry(anchor);

    if (list.length <= 1) {
        return located;
    }

    const highlightRetryDelays = [0, 80, 180, 320];
    let highlightedCount = 0;
    for (let index = 0; index < highlightRetryDelays.length; index += 1) {
        const delay = highlightRetryDelays[index];
        if (delay > 0) {
            await __waitBookmarkAddLocateDelay(delay);
        }
        highlightedCount = __highlightBookmarkAddLocateTargets(list);
        if (highlightedCount >= list.length) {
            break;
        }
    }

    return located || highlightedCount > 0;
}

function __isTabUrlAddable(url) {
    const value = String(url || '').trim();
    if (!value) return false;
    if (value.startsWith('chrome://') || value.startsWith('chrome-extension://')) return false;
    if (value.startsWith('edge://') || value.startsWith('about:') || value.startsWith('devtools://')) return false;
    return true;
}

function __resolveTempBookmarkAddTarget(context, preferredPosition = null) {
    const manager = ensureTempManager();
    const lang = currentLang || 'zh_CN';
    const sectionId = context && context.sectionId ? context.sectionId : null;
    if (!sectionId) {
        throw new Error(lang === 'zh_CN' ? '未找到临时栏目' : 'Temporary section not found');
    }

    if (context && context.blankRoot) {
        return {
            scope: 'temporary',
            sectionId,
            parentId: null,
            index: null,
            position: 'inside'
        };
    }

    const normalizedPosition = __normalizeBookmarkAddPosition(context, preferredPosition);
    const entry = context && context.nodeId ? manager.findItem(sectionId, context.nodeId) : null;

    if (context && context.isFolder) {
        if (normalizedPosition === 'inside' || !entry || !entry.item) {
            return {
                scope: 'temporary',
                sectionId,
                parentId: context.nodeId,
                index: null,
                position: 'inside'
            };
        }

        const baseIndex = Number.isFinite(entry.index) ? entry.index : null;
        return {
            scope: 'temporary',
            sectionId,
            parentId: entry.parent ? (entry.parent.id || null) : null,
            index: Number.isFinite(baseIndex)
                ? (normalizedPosition === 'before' ? baseIndex : baseIndex + 1)
                : null,
            position: normalizedPosition
        };
    }

    if (!entry || !entry.item) {
        return {
            scope: 'temporary',
            sectionId,
            parentId: null,
            index: null,
            position: normalizedPosition
        };
    }

    const baseIndex = Number.isFinite(entry.index) ? entry.index : null;
    return {
        scope: 'temporary',
        sectionId,
        parentId: entry.parent ? (entry.parent.id || null) : null,
        index: Number.isFinite(baseIndex)
            ? (normalizedPosition === 'before' ? baseIndex : baseIndex + 1)
            : null,
        position: normalizedPosition
    };
}

async function __resolveBookmarkAddPermanentRootId(context = null) {
    const preferredParentId = context && context.preferredParentId ? String(context.preferredParentId).trim() : '';
    if (preferredParentId && preferredParentId !== '0') {
        return preferredParentId;
    }

    if (!chrome || !chrome.bookmarks || typeof chrome.bookmarks.getTree !== 'function') {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '当前环境不支持书签操作' : 'Bookmark API unavailable');
    }

    const tree = await chrome.bookmarks.getTree();
    const root = Array.isArray(tree) ? tree[0] : null;
    const children = root && Array.isArray(root.children) ? root.children : [];

    const bookmarkBar = children.find((child) => {
        if (!child) return false;
        if (String(child.id || '') === '1' || child.folderType === 'bookmarks-bar') return true;
        return /^(书签栏|收藏夹栏|bookmarks?\s+bar|favorites?\s+bar)$/i.test(String(child.title || '').trim());
    });
    const firstWritableFolder = children.find((child) => {
        if (!child) return false;
        if (child.url) return false;
        const id = String(child.id || '').trim();
        return !!id && id !== '0';
    });

    const target = bookmarkBar || firstWritableFolder;
    if (!target || !target.id) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '找不到可添加的根目录' : 'No writable root folder found');
    }

    return String(target.id);
}

function __convertBookmarkAddItemsToTempPayload(items) {
    return (Array.isArray(items) ? items : []).map((item) => {
        if (!item) return null;

        if (item.type === 'folder' || Array.isArray(item.children)) {
            return {
                type: 'folder',
                title: __resolveBookmarkAddTabGroupFolderTitle(item.title, 1),
                children: __convertBookmarkAddItemsToTempPayload(item.children || [])
            };
        }

        if (!__isTabUrlAddable(item.url)) return null;
        return {
            type: 'bookmark',
            title: String(item.title || item.url || '').trim() || String(item.url || ''),
            url: String(item.url || '').trim()
        };
    }).filter(Boolean);
}

function __insertBookmarkAddItemsToTemp(target, items) {
    const manager = ensureTempManager();
    const lang = currentLang || 'zh_CN';
    const sectionId = target && target.sectionId ? target.sectionId : null;
    if (!sectionId) {
        throw new Error(lang === 'zh_CN' ? '未找到临时栏目' : 'Temporary section not found');
    }

    const payload = __convertBookmarkAddItemsToTempPayload(items);
    if (!payload.length) {
        return { createdCount: 0, firstCreated: null };
    }

    const index = Number.isFinite(target && target.index) ? target.index : null;
    const insertedItems = manager.insertFromPayload(
        sectionId,
        target && target.parentId ? target.parentId : null,
        payload,
        index,
        { defaultCollapseFolders: true }
    );
    const firstInserted = Array.isArray(insertedItems) && insertedItems.length ? insertedItems[0] : null;
    const createdTargets = (Array.isArray(insertedItems) ? insertedItems : [])
        .filter((item) => !!(item && item.id))
        .map((item) => ({
            id: String(item.id),
            type: item.type === 'folder' ? 'folder' : 'bookmark',
            expandTargetFolder: item.type === 'folder' ? false : true
        }));
    return {
        createdCount: __collectBookmarkAddLeafTabs(payload).length,
        firstCreated: firstInserted && firstInserted.id
            ? {
                id: String(firstInserted.id),
                type: firstInserted.type === 'folder' ? 'folder' : 'bookmark'
            }
            : null,
        createdTargets
    };
}

async function __createTempBookmarkViaModal(target) {
    const lang = currentLang || 'zh_CN';
    const result = await showBookmarkEditorModal({
        modalTitle: lang === 'zh_CN' ? '添加书签' : 'Add Bookmark',
        titleLabel: lang === 'zh_CN' ? '书签名称' : 'Bookmark Name',
        urlLabel: lang === 'zh_CN' ? '书签地址' : 'Bookmark URL',
        saveText: lang === 'zh_CN' ? '添加' : 'Add',
        cancelText: lang === 'zh_CN' ? '取消' : 'Cancel',
        titlePlaceholder: lang === 'zh_CN' ? '输入书签名称...' : 'Enter bookmark name...',
        urlPlaceholder: 'https://...',
        titleValue: '',
        urlValue: '',
        showUrl: true,
        requireUrl: true,
        requireTitle: true
    });

    if (!result) return { success: false, createdCount: 0, firstCreated: null };

    const createResult = __insertBookmarkAddItemsToTemp(target, [{
        type: 'bookmark',
        title: result.title,
        url: result.url
    }]);
    return {
        success: !!(createResult && createResult.firstCreated && createResult.firstCreated.id),
        createdCount: createResult && Number.isFinite(createResult.createdCount) ? createResult.createdCount : 0,
        firstCreated: createResult ? createResult.firstCreated || null : null,
        createdTargets: createResult ? createResult.createdTargets || [] : []
    };
}

async function __createTempFolderViaModal(target) {
    const lang = currentLang || 'zh_CN';
    const result = await showBookmarkEditorModal({
        modalTitle: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder',
        titleLabel: lang === 'zh_CN' ? '文件夹名称' : 'Folder Name',
        saveText: lang === 'zh_CN' ? '添加' : 'Add',
        cancelText: lang === 'zh_CN' ? '取消' : 'Cancel',
        titlePlaceholder: lang === 'zh_CN' ? '输入文件夹名称...' : 'Enter folder name...',
        titleValue: '',
        urlValue: '',
        showUrl: false,
        requireTitle: true
    });

    if (!result) return { success: false, createdCount: 0, firstCreated: null };

    const createResult = __insertBookmarkAddItemsToTemp(target, [{
        type: 'folder',
        title: result.title,
        children: []
    }]);
    return {
        success: !!(createResult && createResult.firstCreated && createResult.firstCreated.id),
        createdCount: createResult && Number.isFinite(createResult.createdCount) ? createResult.createdCount : 0,
        firstCreated: createResult ? createResult.firstCreated || null : null,
        createdTargets: createResult ? createResult.createdTargets || [] : []
    };
}

async function __resolveBookmarkAddTarget(context, preferredPosition = null) {
    const isBlankRoot = !!(context && context.blankRoot);
    if (!context || (!context.nodeId && !isBlankRoot)) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '缺少目标节点' : 'Missing target node');
    }

    if (context && context.treeType === 'temporary') {
        return __resolveTempBookmarkAddTarget(context, preferredPosition);
    }

    if (!chrome || !chrome.bookmarks || typeof chrome.bookmarks.get !== 'function') {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '当前环境不支持书签操作' : 'Bookmark API unavailable');
    }

    if (isBlankRoot) {
        const parentId = await __resolveBookmarkAddPermanentRootId(context);
        return { parentId, index: null, position: 'inside' };
    }

    const nodes = await chrome.bookmarks.get(context.nodeId);
    const node = Array.isArray(nodes) ? nodes[0] : null;
    if (!node) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '目标节点不存在' : 'Target node not found');
    }

    const normalizedPosition = __normalizeBookmarkAddPosition(context, preferredPosition);

    if (context.isFolder) {
        if (normalizedPosition === 'inside') {
            return { parentId: node.id, index: null, position: normalizedPosition };
        }
        if (!node.parentId) {
            return { parentId: node.id, index: null, position: 'inside' };
        }
        const baseIndex = Number.isFinite(node.index) ? node.index : 0;
        return {
            parentId: node.parentId,
            index: normalizedPosition === 'before' ? baseIndex : baseIndex + 1,
            position: normalizedPosition
        };
    }

    if (!node.parentId) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '无法找到父文件夹' : 'Cannot resolve parent folder');
    }

    const baseIndex = Number.isFinite(node.index) ? node.index : 0;
    return {
        parentId: node.parentId,
        index: normalizedPosition === 'before' ? baseIndex : baseIndex + 1,
        position: normalizedPosition
    };
}

async function __addTabsToBookmarkTree(target, tabs, options = {}) {
    if (!target || !target.parentId) {
        return { createdCount: 0, firstCreated: null, createdTargets: [] };
    }
    if (!Array.isArray(tabs) || !tabs.length) {
        return { createdCount: 0, firstCreated: null, createdTargets: [] };
    }

    let insertIndex = Number.isFinite(target.index) ? target.index : null;
    let createdCount = 0;
    let firstCreated = null;
    const createdTargets = [];

    for (const tab of tabs) {
        if (!tab || !__isTabUrlAddable(tab.url)) continue;
        const createPayload = {
            parentId: target.parentId,
            title: String(tab.title || tab.url || '').trim() || String(tab.url || ''),
            url: String(tab.url || '').trim()
        };
        if (!createPayload.url) continue;
        if (Number.isFinite(insertIndex)) {
            createPayload.index = insertIndex;
            insertIndex += 1;
        }
        const created = await createPermanentBookmarkNode(createPayload, options);
        createdCount += 1;
        if (!firstCreated && created && created.id) {
            firstCreated = { id: String(created.id), type: 'bookmark' };
        }
        if (created && created.id) {
            createdTargets.push({
                id: String(created.id),
                type: 'bookmark',
                expandTargetFolder: true
            });
        }
    }

    return { createdCount, firstCreated, createdTargets };
}

function __collectBookmarkAddLeafTabs(items, output = []) {
    const result = Array.isArray(output) ? output : [];
    (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item) return;
        if (item.type === 'folder' || Array.isArray(item.children)) {
            __collectBookmarkAddLeafTabs(item.children || [], result);
            return;
        }
        if (!__isTabUrlAddable(item.url)) return;
        result.push({
            title: String(item.title || item.url || '').trim() || String(item.url || ''),
            url: String(item.url || '').trim()
        });
    });
    return result;
}

function __resolveBookmarkAddTabGroupFolderTitle(groupTitle, order) {
    const normalized = String(groupTitle || '').trim();
    if (normalized) return normalized;
    const lang = currentLang || 'zh_CN';
    const index = Number.isFinite(order) ? order : 1;
    return lang === 'zh_CN' ? `标签组 ${index}` : `Tab Group ${index}`;
}

async function __queryBookmarkAddTabGroupTitleMap(groupIds) {
    const map = new Map();
    const ids = Array.from(new Set((Array.isArray(groupIds) ? groupIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id >= 0)));

    if (!ids.length) return map;
    if (!chrome || !chrome.tabGroups || typeof chrome.tabGroups.get !== 'function') {
        return map;
    }

    await Promise.all(ids.map((groupId) => new Promise((resolve) => {
        try {
            chrome.tabGroups.get(groupId, (group) => {
                try {
                    if (!chrome.runtime || !chrome.runtime.lastError) {
                        const title = group && typeof group.title === 'string' ? group.title.trim() : '';
                        if (title) map.set(groupId, title);
                    }
                } catch (_) { }
                resolve();
            });
        } catch (_) {
            resolve();
        }
    })));

    return map;
}

async function __buildBookmarkAddItemsFromTabs(tabs, options = {}) {
    const sourceTabs = Array.isArray(tabs) ? tabs : [];
    const groupByTabGroup = !!(options && options.groupByTabGroup);
    if (!sourceTabs.length) return [];

    if (!groupByTabGroup) {
        return sourceTabs
            .filter((tab) => tab && __isTabUrlAddable(tab.url))
            .map((tab) => ({
                type: 'bookmark',
                title: String(tab.title || tab.url || '').trim() || String(tab.url || ''),
                url: String(tab.url || '').trim()
            }));
    }

    const groupIds = sourceTabs
        .map((tab) => (tab && Number.isInteger(tab.groupId) && tab.groupId >= 0 ? tab.groupId : -1))
        .filter((groupId) => groupId >= 0);
    const groupTitleMap = await __queryBookmarkAddTabGroupTitleMap(groupIds);

    const items = [];
    const groupedFolderMap = new Map();
    let unnamedGroupOrder = 0;

    sourceTabs.forEach((tab) => {
        if (!tab || !__isTabUrlAddable(tab.url)) return;

        const bookmarkItem = {
            type: 'bookmark',
            title: String(tab.title || tab.url || '').trim() || String(tab.url || ''),
            url: String(tab.url || '').trim()
        };

        const groupId = (Number.isInteger(tab.groupId) && tab.groupId >= 0) ? tab.groupId : -1;
        if (groupId < 0) {
            items.push(bookmarkItem);
            return;
        }

        let groupFolder = groupedFolderMap.get(groupId);
        if (!groupFolder) {
            unnamedGroupOrder += 1;
            groupFolder = {
                type: 'folder',
                title: __resolveBookmarkAddTabGroupFolderTitle(groupTitleMap.get(groupId), unnamedGroupOrder),
                children: []
            };
            groupedFolderMap.set(groupId, groupFolder);
            items.push(groupFolder);
        }

        groupFolder.children.push(bookmarkItem);
    });

    return items;
}

async function __addBookmarkAddItemsToTree(target, items, options = {}) {
    if (!target || !target.parentId) {
        return { createdCount: 0, firstCreated: null, createdTargets: [] };
    }
    const sourceItems = Array.isArray(items) ? items : [];
    if (!sourceItems.length) {
        return { createdCount: 0, firstCreated: null, createdTargets: [] };
    }

    let insertIndex = Number.isFinite(target.index) ? target.index : null;
    let createdCount = 0;
    let firstCreated = null;
    const createdTargets = [];

    const rememberFirstCreated = (item) => {
        if (!firstCreated && item && item.id) {
            firstCreated = {
                id: String(item.id),
                type: item.type === 'folder' ? 'folder' : 'bookmark'
            };
        }
    };

    for (const item of sourceItems) {
        if (!item) continue;

        if (item.type === 'folder' || Array.isArray(item.children)) {
            const folderPayload = {
                parentId: target.parentId,
                title: __resolveBookmarkAddTabGroupFolderTitle(item.title, 1)
            };
            if (Number.isFinite(insertIndex)) {
                folderPayload.index = insertIndex;
                insertIndex += 1;
            }

            let folderNode = null;
            try {
                folderNode = await createPermanentBookmarkNode(folderPayload, options);
            } catch (folderError) {
                console.warn('[右键菜单] 创建分组文件夹失败，回退直插:', folderError);
            }

            if (folderNode && folderNode.id) {
                rememberFirstCreated({ id: folderNode.id, type: 'folder' });
                createdTargets.push({
                    id: String(folderNode.id),
                    type: 'folder',
                    expandTargetFolder: false
                });
                const nestedResult = await __addBookmarkAddItemsToTree({
                    parentId: folderNode.id,
                    index: null,
                    position: target.position
                }, item.children || [], options);
                createdCount += nestedResult.createdCount;
                if (!firstCreated && nestedResult.firstCreated) {
                    firstCreated = nestedResult.firstCreated;
                }
            } else {
                const fallbackTabs = __collectBookmarkAddLeafTabs(item.children || []);
                const fallbackTarget = {
                    parentId: target.parentId,
                    index: insertIndex,
                    position: target.position
                };
                const fallbackResult = await __addTabsToBookmarkTree(fallbackTarget, fallbackTabs, options);
                createdCount += fallbackResult.createdCount;
                if (!firstCreated && fallbackResult.firstCreated) {
                    firstCreated = fallbackResult.firstCreated;
                }
                if (Array.isArray(fallbackResult.createdTargets) && fallbackResult.createdTargets.length) {
                    createdTargets.push(...fallbackResult.createdTargets);
                }
                if (Number.isFinite(insertIndex)) {
                    insertIndex += fallbackResult.createdCount;
                }
            }

            continue;
        }

        if (!__isTabUrlAddable(item.url)) continue;
        const createPayload = {
            parentId: target.parentId,
            title: String(item.title || item.url || '').trim() || String(item.url || ''),
            url: String(item.url || '').trim()
        };
        if (!createPayload.url) continue;

        if (Number.isFinite(insertIndex)) {
            createPayload.index = insertIndex;
            insertIndex += 1;
        }

        const created = await createPermanentBookmarkNode(createPayload, options);
        createdCount += 1;
        if (!firstCreated && created && created.id) {
            firstCreated = { id: String(created.id), type: 'bookmark' };
        }
        if (created && created.id) {
            createdTargets.push({
                id: String(created.id),
                type: 'bookmark',
                expandTargetFolder: true
            });
        }
    }

    return { createdCount, firstCreated, createdTargets };
}

function __buildBookmarkAddSecondaryModal() {
    const existing = document.getElementById('bookmarkAddSecondaryModal');
    if (existing) return existing;

    const modal = document.createElement('div');
    modal.id = 'bookmarkAddSecondaryModal';
    modal.className = 'modal content-center bookmark-add-secondary-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header compact">
                <div class="bookmark-add-secondary-title-row">
                    <h3 id="bookmarkAddSecondaryTitle"></h3>
                    <button class="bookmark-add-secondary-help-btn" id="bookmarkAddSecondaryHelpBtn" type="button" aria-label="">
                        <i class="fas fa-question-circle"></i>
                        <span class="bookmark-add-secondary-help-tooltip" id="bookmarkAddSecondaryHelpTooltip"></span>
                    </button>
                </div>
                <button class="modal-close" id="bookmarkAddSecondaryClose" type="button">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="bookmark-add-secondary-form">
                    <div class="bookmark-add-secondary-field">
                        <label id="bookmarkAddSecondaryActionLabel"></label>
                        <div class="bookmark-add-secondary-grid" id="bookmarkAddSecondaryActionOptions"></div>
                    </div>
                    <div class="bookmark-add-secondary-field">
                        <label id="bookmarkAddSecondaryPositionLabel"></label>
                        <div class="bookmark-add-secondary-options" id="bookmarkAddSecondaryPositionOptions"></div>
                    </div>
                    <div class="bookmark-add-secondary-field bookmark-add-secondary-field-inline">
                        <label class="bookmark-add-secondary-inline-toggle" for="bookmarkAddSecondaryLocateAfterAction">
                            <input type="checkbox" id="bookmarkAddSecondaryLocateAfterAction">
                            <span id="bookmarkAddSecondaryLocateLabel"></span>
                        </label>
                    </div>
                </div>
                <div class="bookmark-add-secondary-actions">
                    <button id="bookmarkAddSecondaryCancel" class="modal-btn" type="button"></button>
                    <button id="bookmarkAddSecondaryConfirm" class="modal-btn primary" type="button"></button>
                </div>
            </div>
        </div>
    `;

    getOverlayContainer().appendChild(modal);
    return modal;
}

function __renderBookmarkAddActionOptions(container, lang, actionType, windowAsFolder = false, context = null) {
    if (!container) return;

    const options = [
        {
            value: 'add-page',
            label: lang === 'zh_CN' ? '添加网页' : 'Add Page',
            icon: 'plus-circle'
        },
        {
            value: 'add-folder',
            label: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder',
            icon: 'folder-plus'
        }
    ];

    if (__isSidePanelModeForAdd()) {
        options.push({
            value: 'add-current-tab',
            label: lang === 'zh_CN' ? '添加当前页 | 选中标签页' : 'Add Current | Selected Tabs',
            icon: 'file'
        });
    }

    options.push({
        value: 'add-current-window',
        label: lang === 'zh_CN' ? '添加当前窗口所有标签页' : 'Add All Current Window Tabs',
        icon: 'window-maximize'
    });

    if (context && context.blankRoot === true && context.sectionId === '__canvas-blank-add-target__') {
        options.push({
            value: 'add-all-windows-card-group',
            label: lang === 'zh_CN' ? '一键存档（所有窗口）' : 'Archive All (All Windows)',
            icon: 'archive'
        });
    }

    const selected = __normalizeBookmarkAddActionType(actionType);
    const checkedWindowAsFolder = __normalizeBookmarkAddWindowAsFolder(windowAsFolder);

    container.innerHTML = options.map((option) => {
        const isWindowOption = option.value === 'add-current-window' || option.value === 'add-all-windows-card-group';
        const isCurrentTabsOption = option.value === 'add-current-tab';
        if (!isWindowOption) {
            return `
        <label class="bookmark-add-secondary-choice ${isCurrentTabsOption ? 'bookmark-add-secondary-choice-current-tabs' : ''}">
            <input type="radio" name="bookmarkAddActionType" value="${option.value}" ${option.value === selected ? 'checked' : ''}>
            <span class="bookmark-add-secondary-choice-label">
                <span class="bookmark-add-secondary-choice-main"><i class="fas fa-${option.icon}"></i><span>${option.label}</span></span>
            </span>
        </label>
    `;
        }

        const isChoiceSelected = option.value === selected;
        const isArchive = option.value === 'add-all-windows-card-group';
        const checked = isChoiceSelected ? checkedWindowAsFolder : (isArchive ? false : true);

        const folderLabel = lang === 'zh_CN' ? '外裹文件夹' : 'Wrapper Folder';
        return `
        <label class="bookmark-add-secondary-choice bookmark-add-secondary-choice-window">
            <input type="radio" name="bookmarkAddActionType" value="${option.value}" ${option.value === selected ? 'checked' : ''}>
            <span class="bookmark-add-secondary-choice-label">
                <span class="bookmark-add-secondary-choice-main"><i class="fas fa-${option.icon}"></i><span>${option.label}</span></span>
                <span class="bookmark-add-secondary-window-option">
                    <input type="checkbox" class="bookmark-add-secondary-window-folder-checkbox" ${checked ? 'checked' : ''}>
                    <span>${folderLabel}</span>
                </span>
            </span>
        </label>
    `;
    }).join('');
}

function __renderBookmarkAddPositionOptions(container, context, position) {
    if (!container) return;
    const options = __getBookmarkAddPositionOptions(context);
    const selected = __normalizeBookmarkAddPosition(context, position);

    container.innerHTML = options.map((option) => `
        <label class="bookmark-add-secondary-choice">
            <input type="radio" name="bookmarkAddPosition" value="${option.value}" ${option.value === selected ? 'checked' : ''}>
            <span class="bookmark-add-secondary-choice-label">${option.label}</span>
        </label>
    `).join('');
}

function __readCheckedValue(root, selector, fallback = '') {
    if (!root || !root.querySelector) return fallback;
    const selected = root.querySelector(selector);
    if (!selected) return fallback;
    return String(selected.value || '').trim() || fallback;
}

function showBookmarkAddSecondaryModal(context, options = {}) {
    const modal = __buildBookmarkAddSecondaryModal();
    const lang = currentLang || 'zh_CN';

    const titleEl = modal.querySelector('#bookmarkAddSecondaryTitle');
    const helpBtn = modal.querySelector('#bookmarkAddSecondaryHelpBtn');
    const helpTooltip = modal.querySelector('#bookmarkAddSecondaryHelpTooltip');
    const closeBtn = modal.querySelector('#bookmarkAddSecondaryClose');
    const actionLabelEl = modal.querySelector('#bookmarkAddSecondaryActionLabel');
    const actionWrap = modal.querySelector('#bookmarkAddSecondaryActionOptions');
    const positionLabelEl = modal.querySelector('#bookmarkAddSecondaryPositionLabel');
    const positionWrap = modal.querySelector('#bookmarkAddSecondaryPositionOptions');
    const locateLabelEl = modal.querySelector('#bookmarkAddSecondaryLocateLabel');
    const locateAfterActionInput = modal.querySelector('#bookmarkAddSecondaryLocateAfterAction');
    const cancelBtn = modal.querySelector('#bookmarkAddSecondaryCancel');
    const confirmBtn = modal.querySelector('#bookmarkAddSecondaryConfirm');

    let initialActionType = __normalizeBookmarkAddActionType(options.actionType);
    if (initialActionType === 'add-current-tab' && !__isSidePanelModeForAdd()) {
        initialActionType = 'add-page';
    }
    if (initialActionType === 'add-all-windows-card-group' && !(context && context.blankRoot === true && context.sectionId === '__canvas-blank-add-target__')) {
        initialActionType = 'add-page';
    }

    const initialPosition = __normalizeBookmarkAddPosition(context, options.position);
    const initialWindowAsFolder = (options && options.windowAsFolder !== undefined && options.windowAsFolder !== null)
        ? __normalizeBookmarkAddWindowAsFolder(options.windowAsFolder)
        : (initialActionType === 'add-all-windows-card-group' ? false : true);
    const initialLocateAfterAction = (options && options.locateAfterAction !== undefined && options.locateAfterAction !== null)
        ? __normalizeBookmarkAddLocateAfterAction(options.locateAfterAction)
        : true;

    if (titleEl) titleEl.textContent = lang === 'zh_CN' ? '添加' : 'Add';
    const templateHelpLabel = lang === 'zh_CN' ? '「上次」说明' : 'Last Help';
    const templateHelpText = lang === 'zh_CN'
        ? '会记住你在这里最后一次确认的“添加内容 + 位置 + 动作结束后目标定位”。点击右键菜单里的「上次」会直接按该组合执行（后改覆盖前改）。'
        : '"Last" remembers the latest confirmed "content + position + locate target after action". Clicking "Last" in the context menu runs that combination directly (last change wins).';
    if (helpBtn) {
        helpBtn.setAttribute('aria-label', templateHelpLabel);
        helpBtn.title = templateHelpLabel;
    }
    if (helpTooltip) helpTooltip.textContent = templateHelpText;
    if (actionLabelEl) actionLabelEl.textContent = lang === 'zh_CN' ? '添加内容' : 'Add Content';
    if (positionLabelEl) positionLabelEl.textContent = lang === 'zh_CN' ? '位置' : 'Position';
    if (locateLabelEl) locateLabelEl.textContent = lang === 'zh_CN' ? '动作结束后目标定位' : 'Locate Target After Action';
    if (cancelBtn) cancelBtn.textContent = lang === 'zh_CN' ? '取消' : 'Cancel';
    if (confirmBtn) confirmBtn.textContent = lang === 'zh_CN' ? '确定' : 'Confirm';

    __renderBookmarkAddActionOptions(actionWrap, lang, initialActionType, initialWindowAsFolder, context);
    __renderBookmarkAddPositionOptions(positionWrap, context, initialPosition);

    if (locateAfterActionInput) {
        locateAfterActionInput.checked = initialLocateAfterAction;
    }

    const positionField = positionWrap ? positionWrap.closest('.bookmark-add-secondary-field') : null;
    const locateField = modal.querySelector('.bookmark-add-secondary-field-inline');

    const updateFieldVisibility = () => {
        const actionType = __readCheckedValue(modal, 'input[name="bookmarkAddActionType"]:checked', initialActionType);
        const isArchiveAll = actionType === 'add-all-windows-card-group';
        if (positionField) {
            positionField.style.display = isArchiveAll ? 'none' : '';
        }
        if (locateField) {
            locateField.style.display = (isArchiveAll || (context && context.blankRoot && context.sectionId === '__canvas-blank-add-target__')) ? 'none' : '';
        }
    };

    modal.querySelectorAll('input[name="bookmarkAddActionType"]').forEach(radio => {
        radio.addEventListener('change', updateFieldVisibility);
    });
    updateFieldVisibility();

    modal.querySelectorAll('.bookmark-add-secondary-window-folder-checkbox').forEach(checkbox => {
        checkbox.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    });

    modal.classList.add('show');

    return new Promise((resolve) => {
        let settled = false;

        const closeModal = (result = null) => {
            if (settled) return;
            settled = true;
            try {
                modal.classList.remove('show');
            } catch (_) { }
            if (closeBtn) closeBtn.removeEventListener('click', onCancel);
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
            if (confirmBtn) confirmBtn.removeEventListener('click', onConfirm);
            modal.removeEventListener('click', onBackdropClick);
            document.removeEventListener('keydown', onKeydown, true);
            resolve(result);
        };

        const onCancel = () => closeModal(null);
        const onConfirm = () => {
            const actionType = __readCheckedValue(modal, 'input[name="bookmarkAddActionType"]:checked', initialActionType);
            const normalizedActionType = __normalizeBookmarkAddActionType(actionType);
            const position = __readCheckedValue(modal, 'input[name="bookmarkAddPosition"]:checked', initialPosition);
            const checkedRadio = modal.querySelector('input[name="bookmarkAddActionType"]:checked');
            const parentChoice = checkedRadio ? checkedRadio.closest('.bookmark-add-secondary-choice') : null;
            const inlineWindowFolderInput = parentChoice ? parentChoice.querySelector('.bookmark-add-secondary-window-folder-checkbox') : null;
            const windowAsFolder = (normalizedActionType === 'add-current-window' || normalizedActionType === 'add-all-windows-card-group') && !!(inlineWindowFolderInput && inlineWindowFolderInput.checked);
            const locateAfterAction = (context && context.blankRoot && context.sectionId === '__canvas-blank-add-target__') ? false : !!(locateAfterActionInput && locateAfterActionInput.checked);
            closeModal({
                actionType: normalizedActionType,
                position: __normalizeBookmarkAddPosition(context, position),
                windowAsFolder,
                locateAfterAction
            });
        };
        const onBackdropClick = (event) => {
            if (event.target === modal) {
                closeModal(null);
            }
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeModal(null);
                return;
            }
            if (event.key === 'Enter') {
                if (event.isComposing) return;
                const target = event.target;
                if (target && target.closest && target.closest('.bookmark-add-secondary-choice')) {
                    event.preventDefault();
                    onConfirm();
                }
            }
        };

        if (closeBtn) closeBtn.addEventListener('click', onCancel);
        if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
        if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
        modal.addEventListener('click', onBackdropClick);
        document.addEventListener('keydown', onKeydown, true);
    });
}

async function executeBookmarkAddAction(context, config, options = {}) {
    const lang = currentLang || 'zh_CN';
    let actionType = __normalizeBookmarkAddActionType(config && config.actionType);
    if (actionType === 'add-all-windows-card-group' && !(context && context.blankRoot === true && context.sectionId === '__canvas-blank-add-target__')) {
        actionType = 'add-page';
    }
    const preferredPosition = __normalizeBookmarkAddPosition(context, config && config.position);
    const windowAsFolder = (actionType === 'add-current-window' || actionType === 'add-all-windows-card-group') && __normalizeBookmarkAddWindowAsFolder(config && config.windowAsFolder);
    const locateAfterAction = (context && context.blankRoot && context.sectionId === '__canvas-blank-add-target__') ? false : __normalizeBookmarkAddLocateAfterAction(config && config.locateAfterAction);
    const saveTemplate = options && options.saveTemplate !== false;
    const permanentCopyId = (context && context.permanentCopyId)
        ? String(context.permanentCopyId).trim()
        : '';

    const target = await __resolveBookmarkAddTarget(context, preferredPosition);
    const isTemporaryTarget = !!(target && target.scope === 'temporary');
    let success = false;
    let locateTarget = null;
    let locateTargets = [];

    const rememberLocateTarget = (candidate) => {
        if (locateTarget || !candidate || !candidate.id) return;
        locateTarget = Object.assign({}, candidate);
    };

    const rememberLocateTargets = (candidates, basePayload = {}) => {
        (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
            if (!candidate || !candidate.id) return;
            const normalized = Object.assign({}, basePayload, candidate, {
                id: String(candidate.id)
            });
            locateTargets.push(normalized);
            rememberLocateTarget(normalized);
        });
    };

    if (actionType === 'add-all-windows-card-group') {
        const x = context && Number.isFinite(context.x) ? context.x : (target && Number.isFinite(target.x) ? target.x : null);
        const y = context && Number.isFinite(context.y) ? context.y : (target && Number.isFinite(target.y) ? target.y : null);
        const positionOption = x !== null && y !== null ? { x, y } : null;
        const archiveOptions = {
            position: positionOption,
            windowAsFolder: windowAsFolder
        };
        if (typeof archiveAllWindowsToCardGroup === 'function') {
            await archiveAllWindowsToCardGroup(archiveOptions);
        } else if (window.archiveAllWindowsToCardGroup) {
            await window.archiveAllWindowsToCardGroup(archiveOptions);
        }
        return true;
    }

    if (actionType === 'add-page') {
        if (isTemporaryTarget) {
            const createResult = await __createTempBookmarkViaModal(target);
            success = !!(createResult && createResult.success);
            if (createResult && createResult.firstCreated && createResult.firstCreated.id) {
                rememberLocateTarget({
                    source: 'temporary',
                    sectionId: target.sectionId,
                    id: String(createResult.firstCreated.id),
                    expandTargetFolder: createResult.firstCreated.type === 'folder' ? false : true
                });
            }
        } else {
            const created = await addBookmark(target.parentId, { index: target.index });
            success = !!created;
            if (created && created.id) {
                rememberLocateTarget({
                    source: 'permanent',
                    id: String(created.id),
                    copyId: permanentCopyId || null,
                    expandTargetFolder: true
                });
            }
        }
    } else if (actionType === 'add-folder') {
        if (isTemporaryTarget) {
            const createResult = await __createTempFolderViaModal(target);
            success = !!(createResult && createResult.success);
            if (createResult && createResult.firstCreated && createResult.firstCreated.id) {
                rememberLocateTarget({
                    source: 'temporary',
                    sectionId: target.sectionId,
                    id: String(createResult.firstCreated.id),
                    expandTargetFolder: false
                });
            }
        } else {
            const created = await addFolder(target.parentId, { index: target.index });
            success = !!created;
            if (created && created.id) {
                rememberLocateTarget({
                    source: 'permanent',
                    id: String(created.id),
                    copyId: permanentCopyId || null,
                    expandTargetFolder: false
                });
            }
        }
    } else {
        const tabs = actionType === 'add-current-tab'
            ? await __queryCurrentTabActionTabs()
            : __dedupeBookmarkAddTabs(await __queryCurrentWindowTabs({ currentWindow: true }));

        const addableTabs = tabs.filter((tab) => tab && __isTabUrlAddable(tab.url));
        if (!addableTabs.length) {
            const message = lang === 'zh_CN' ? '没有可添加页面 或 此页面不可添加' : 'No pages can be added, or this page cannot be added';
            try { alert(message); } catch (_) { }
            return false;
        }

        const shouldGroupByTabGroup = actionType === 'add-current-window';
        const addItems = await __buildBookmarkAddItemsFromTabs(addableTabs, {
            groupByTabGroup: shouldGroupByTabGroup
        });

        let createdCount = 0;
        let usedFolderMode = false;
        let firstCreated = null;

        if (isTemporaryTarget) {
            let itemsForTarget = addItems;
            if (actionType === 'add-current-window' && windowAsFolder) {
                itemsForTarget = [{
                    type: 'folder',
                    title: __formatBookmarkAddWindowFolderTitle(),
                    children: addItems
                }];
                usedFolderMode = true;
            }
            const tempInsertResult = __insertBookmarkAddItemsToTemp(target, itemsForTarget);
            createdCount = tempInsertResult && Number.isFinite(tempInsertResult.createdCount)
                ? tempInsertResult.createdCount
                : 0;
            firstCreated = tempInsertResult && tempInsertResult.firstCreated
                ? tempInsertResult.firstCreated
                : null;
            rememberLocateTargets(
                tempInsertResult ? tempInsertResult.createdTargets || [] : [],
                {
                    source: 'temporary',
                    sectionId: target.sectionId
                }
            );
        } else {
            const totalToAdd = Array.isArray(addItems) ? addItems.length : 0;
            const totalNodes = (actionType === 'add-current-window' && windowAsFolder) ? (totalToAdd + 1) : totalToAdd;
            const useBulkMute = totalNodes > 15;
            let muteSession = null;
            let loadingToast = null;
            const createdEvents = [];
            const createOptions = { createdEvents };
            try {
                if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
                    muteSession = await beginBookmarkBulkMute('add-bookmark-action');
                }
                if (useBulkMute && typeof window !== 'undefined' && typeof window.showLoadingToast === 'function') {
                    const loadingMsg = lang === 'zh_CN' ? `正在添加 ${totalNodes} 个页面...` : `Adding ${totalNodes} pages...`;
                    loadingToast = window.showLoadingToast(loadingMsg);
                }

                if (actionType === 'add-current-window' && windowAsFolder) {
            const folderPayload = {
                parentId: target.parentId,
                title: __formatBookmarkAddWindowFolderTitle()
            };
            if (Number.isFinite(target.index)) {
                folderPayload.index = target.index;
            }

            let folderNode = null;
            try {
                folderNode = await createPermanentBookmarkNode(folderPayload, createOptions);
            } catch (folderError) {
                console.warn('[右键菜单] 创建窗口文件夹失败，回退直插:', folderError);
            }

            if (folderNode && folderNode.id) {
                const nestedResult = await __addBookmarkAddItemsToTree({
                    parentId: folderNode.id,
                    index: null,
                    position: target.position
                }, addItems, createOptions);
                createdCount = nestedResult && Number.isFinite(nestedResult.createdCount)
                    ? nestedResult.createdCount
                    : 0;
                firstCreated = { id: String(folderNode.id), type: 'folder' };
                rememberLocateTargets([{
                    id: String(folderNode.id),
                    type: 'folder',
                    expandTargetFolder: false
                }], {
                    source: 'permanent',
                    copyId: permanentCopyId || null
                });
                usedFolderMode = true;
            } else {
                const fallbackResult = await __addBookmarkAddItemsToTree(target, addItems, createOptions);
                createdCount = fallbackResult && Number.isFinite(fallbackResult.createdCount)
                    ? fallbackResult.createdCount
                    : 0;
                firstCreated = fallbackResult && fallbackResult.firstCreated
                    ? fallbackResult.firstCreated
                    : null;
                rememberLocateTargets(
                    fallbackResult ? fallbackResult.createdTargets || [] : [],
                    {
                        source: 'permanent',
                        copyId: permanentCopyId || null
                    }
                );
            }
                } else {
                    const treeResult = await __addBookmarkAddItemsToTree(target, addItems, createOptions);
                    createdCount = treeResult && Number.isFinite(treeResult.createdCount)
                        ? treeResult.createdCount
                        : 0;
                    firstCreated = treeResult && treeResult.firstCreated
                        ? treeResult.firstCreated
                        : null;
                    rememberLocateTargets(
                        treeResult ? treeResult.createdTargets || [] : [],
                        {
                            source: 'permanent',
                            copyId: permanentCopyId || null
                        }
                    );
                }

                if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                    await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'add-bookmark-action');
                }
            } finally {
                if (loadingToast) {
                    loadingToast.close();
                }
                if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                    await endBookmarkBulkMute('add-bookmark-action', { refreshTree: true });
                }
            }
        }

        success = createdCount > 0;
        if (success && firstCreated && firstCreated.id) {
            if (isTemporaryTarget) {
                rememberLocateTarget({
                    source: 'temporary',
                    sectionId: target.sectionId,
                    id: String(firstCreated.id),
                    expandTargetFolder: firstCreated.type === 'folder' ? false : true
                });
            } else {
                rememberLocateTarget({
                    source: 'permanent',
                    id: String(firstCreated.id),
                    copyId: permanentCopyId || null,
                    expandTargetFolder: firstCreated.type === 'folder' ? false : true
                });
            }
        }

        if (success && typeof showToast === 'function') {
            const text = actionType === 'add-current-tab'
                ? (createdCount > 1
                    ? (lang === 'zh_CN'
                        ? `已添加选中标签页（${createdCount} 项）。`
                        : `Selected tabs added (${createdCount}).`)
                    : (lang === 'zh_CN' ? '已添加当前页。' : 'Current page added.'))
                : (usedFolderMode
                    ? (lang === 'zh_CN' ? `已将当前窗口所有标签页添加到文件夹（${createdCount} 项）。` : `Current window tabs added to folder (${createdCount}).`)
                    : (lang === 'zh_CN' ? `已添加当前窗口所有标签页（${createdCount} 项）。` : `Current window tabs added (${createdCount}).`));
            try { showToast(text); } catch (_) { }
        }
    }

    if (success && saveTemplate) {
        __writeBookmarkAddTemplate({
            actionType,
            position: target.position,
            windowAsFolder,
            locateAfterAction
        });
    }

    if (success && locateAfterAction && (locateTarget || locateTargets.length)) {
        try {
            const finalLocateTargets = locateTargets.length ? locateTargets : (locateTarget ? [locateTarget] : []);
            await __locateBookmarkAddTargetsWithRetry(finalLocateTargets);
        } catch (locateError) {
            console.warn('[右键菜单] 添加后定位失败:', locateError);
        }
    }

    return success;
}

async function openBookmarkAddMenuAction(context) {
    const lang = currentLang || 'zh_CN';
    const remembered = __readBookmarkAddTemplate();
    let initialActionType = remembered && remembered.actionType
        ? __normalizeBookmarkAddActionType(remembered.actionType)
        : 'add-page';
    if (initialActionType === 'add-current-tab' && !__isSidePanelModeForAdd()) {
        initialActionType = 'add-page';
    }

    const initialPosition = __normalizeBookmarkAddPosition(
        context,
        remembered && remembered.position ? remembered.position : null
    );

    const selected = await showBookmarkAddSecondaryModal(context, {
        actionType: initialActionType,
        position: initialPosition,
        windowAsFolder: remembered ? remembered.windowAsFolder : undefined,
        locateAfterAction: remembered ? remembered.locateAfterAction : undefined
    });

    if (!selected) return false;

    const normalizedSelection = {
        actionType: __normalizeBookmarkAddActionType(selected.actionType),
        position: __normalizeBookmarkAddPosition(context, selected.position),
        windowAsFolder: (__normalizeBookmarkAddActionType(selected.actionType) === 'add-current-window' || __normalizeBookmarkAddActionType(selected.actionType) === 'add-all-windows-card-group')
            && __normalizeBookmarkAddWindowAsFolder(selected.windowAsFolder),
        locateAfterAction: __normalizeBookmarkAddLocateAfterAction(selected.locateAfterAction)
    };

    __writeBookmarkAddTemplate(normalizedSelection);

    try {
        return await executeBookmarkAddAction(context, normalizedSelection, { saveTemplate: false });
    } catch (error) {
        console.error('[右键菜单] 添加操作失败:', error);
        alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
        return false;
    }
}

async function openBookmarkAddByTemplateAction(context) {
    const lang = currentLang || 'zh_CN';
    const template = __readBookmarkAddTemplate();

    if (!template) {
        return await openBookmarkAddMenuAction(context);
    }

    try {
        return await executeBookmarkAddAction(context, {
            actionType: template.actionType,
            position: __normalizeBookmarkAddPosition(context, template.position),
            windowAsFolder: __normalizeBookmarkAddWindowAsFolder(template.windowAsFolder),
            locateAfterAction: __normalizeBookmarkAddLocateAfterAction(template.locateAfterAction)
        }, { saveTemplate: false });
    } catch (error) {
        console.error('[右键菜单] 模版添加失败，回退二级菜单:', error);
        const fallback = await openBookmarkAddMenuAction(context);
        if (!fallback) {
            alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
        }
        return fallback;
    }
}

// 处理菜单操作
async function handleMenuAction(action, context) {
    if (!context) return;
    const { nodeId, nodeTitle, nodeUrl, isFolder, treeType } = context;
    ;
    if (treeType === 'temporary' && action !== 'toggle-context-menu-layout') {
        await handleTempMenuAction(action, context);
        return;
    }

    try {
        switch (action) {
            case 'open':
                await openBookmark(nodeUrl);
                break;

            case 'open-new-tab':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openBookmarkNewTab(nodeUrl);
                await setDefaultOpenMode('new-tab');
                break;

            case 'open-new-window':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openBookmarkNewWindow(nodeUrl, false);
                await setDefaultOpenMode('new-window');
                break;

            case 'open-incognito':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openBookmarkNewWindow(nodeUrl, true);
                await setDefaultOpenMode('incognito');
                break;

            case 'open-specific-group':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInSpecificTabGroup(nodeUrl, { forceNew: true });
                await setDefaultOpenMode('specific-group');
                break;

            case 'open-same-window-specific-group':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInSameWindowSpecificGroup(nodeUrl, { context });
                await setDefaultOpenMode('same-window-specific-group');
                break;

            case 'open-specific-window':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInSpecificWindow(nodeUrl, { forceNew: true, context });
                await setDefaultOpenMode('specific-window');
                break;

            case 'open-scoped-group':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInScopedTabGroup(nodeUrl, { context });
                await setDefaultOpenMode('scoped-group');
                break;

            case 'open-scoped-window':
                if (!shouldAllowBookmarkOpen(`${action}-${nodeUrl}`)) return;
                await openInScopedWindow(nodeUrl, { context });
                await setDefaultOpenMode('scoped-window');
                break;

            case 'open-all':
                await openAllBookmarks(nodeId, false, false);
                break;

            case 'open-all-new-window':
                await openAllBookmarks(nodeId, true, false);
                break;

            case 'open-all-incognito':
                await openAllBookmarks(nodeId, true, true);
                break;

            case 'open-all-tab-group':
                await openAllInTabGroup(nodeId);
                break;

            case 'open-all-manual-select':
                await showManualWindowGroupSelector(context);
                break;

            case 'open-all-manual-select-template-run':
                {
                    const urls = await getUrlsFromContext(context);
                    await openFolderWithManualSelection(urls, nodeTitle, context);
                }
                break;

            case 'open-selected':
                await openSelectedBookmarks();
                break;

            case 'open-selected-tab-group':
                await openSelectedInTabGroup();
                break;

            // 批量操作
            case 'batch-open':
                await batchOpen();
                break;

            case 'batch-open-tab-group':
                await batchOpenTabGroup();
                break;

            case 'batch-to-temp-section':
                await batchToTempSection(null);
                break;

            case 'batch-copy':
                await copySelected();
                break;

            case 'batch-cut':
                await batchCut();
                break;

            case 'batch-delete':
                await batchDelete();
                break;

            case 'batch-rename':
                await batchRename();
                break;

            case 'batch-export-html':
                await batchExportHTML();
                break;

            case 'batch-export-json':
                await batchExportJSON();
                break;

            case 'batch-merge-folder':
                await batchMergeFolder();
                break;

            case 'add-tags':
            case 'batch-add-tags':
                await openTagPopoverForContext(action, context);
                break;

            case 'batch-clear-tags':
                await clearTagsForContext(action, context);
                break;

            case 'batch-edit-note':
                await editNotesForContext(action, context);
                break;

            case 'batch-clear-note':
                await clearNotesForContext(action, context);
                break;

            case 'select-item':
                enterSelectMode();
                // 切换当前右键点击的节点的选中状态
                if (nodeId) {
                    toggleSelectItem(nodeId, context.node);
                }
                break;

            case 'deselect-all':
                deselectAll();
                updateBatchToolbar();
                break;

            case 'edit':
            case 'rename':
                await editBookmark(nodeId, nodeTitle, nodeUrl, isFolder);
                break;

            case 'add-entry':
                await openBookmarkAddMenuAction(context);
                break;

            case 'add-page': {
                const target = await __resolveBookmarkAddTarget(context, __normalizeBookmarkAddPosition(context, context && context.isFolder ? 'inside' : 'after'));
                await addBookmark(target.parentId, { index: target.index });
                break;
            }

            case 'add-folder': {
                const target = await __resolveBookmarkAddTarget(context, __normalizeBookmarkAddPosition(context, context && context.isFolder ? 'inside' : 'after'));
                await addFolder(target.parentId, { index: target.index });
                break;
            }

            case 'cut':
                await cutBookmark(nodeId, nodeTitle, isFolder);
                showPasteButton();
                break;

            case 'copy':
                await copyBookmark(nodeId, nodeTitle, isFolder);
                showPasteButton();
                break;

            case 'paste':
                await pasteBookmark(nodeId, isFolder, false);
                break;

            case 'paste-above':
                await pasteBookmark(nodeId, isFolder, 'before');
                break;

            case 'paste-below':
                await pasteBookmark(nodeId, isFolder, true);
                break;

            case 'copy-url':
                await copyUrl(nodeUrl);
                break;

            case 'delete':
                // 乐观 UI 更新：立即从 DOM 中移除对应的节点，消除视觉延迟
                if (context.node) {
                    const treeNode = context.node.closest('.tree-node');
                    if (treeNode) {
                        treeNode.remove();
                    }
                }
                await deleteBookmark(nodeId, nodeTitle, isFolder);
                break;

            case 'toggle-context-menu-layout':
                toggleContextMenuLayout();
                break;

            case 'open-manual-select':
                // 打开手动选择窗口+组的选择器
                await showManualWindowGroupSelector(context);
                break;

            default:
                console.warn('[右键菜单] 未知操作:', action);
        }
    } catch (error) {
        console.error('[右键菜单] 操作失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `操作失败: ${error.message}` : `Operation failed: ${error.message}`);
    }
}


// =================================================================================
// IX. BOOKMARK OPENING, CRUD, CLIPBOARD & TAB GROUP HELPERS (书签打开、增删改、剪贴板与标签组辅助)
// =================================================================================

// 打开书签（根据defaultOpenMode决定打开方式）
async function openBookmark(url) {
    if (!url) return;

    // 如果默认打开方式是手动选择，使用保存的窗口/组打开
    if (defaultOpenMode === 'manual-select') {
        await openBookmarkWithManualSelection(url);
        return;
    }

    // 使用 tabs.create 以便 background 能拿到 tabId 做“点击记录/时间追踪”归因
    await openBookmarkNewTab(url, { source: 'history_ui' });
}

async function reportExtensionBookmarkOpen({ tabId, url, title = '', bookmarkId = null, source = 'history_ui' } = {}) {
    try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
        if (typeof tabId !== 'number') return;
        if (!url || typeof url !== 'string') return;
        await chrome.runtime.sendMessage({
            action: 'extensionBookmarkOpen',
            tabId,
            url,
            title,
            bookmarkId,
            source
        });
    } catch (_) { }
}

async function saveTabSourceLabel(tabId, label) {
    if (!tabId || !label) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get(['bookmarkTabSourceLabels']);
            const labels = data.bookmarkTabSourceLabels || {};
            labels[tabId] = label;
            await chrome.storage.local.set({ bookmarkTabSourceLabels: labels });
        }
    } catch (_) {}
}

// 在新标签页中打开
async function getNewTabPlacementProperties() {
    try {
        if (typeof chrome === 'undefined'
            || !chrome.tabs
            || typeof chrome.tabs.query !== 'function') return {};
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const currentTab = Array.isArray(tabs) ? tabs[0] : null;
        if (!currentTab
            || !Number.isInteger(currentTab.windowId)
            || !Number.isInteger(currentTab.index)
            || currentTab.index < 0) {
            return {};
        }
        // tabs.create 的 index 是整个窗口的索引；分组标签需要在创建后显式加入当前组。
        const groupId = Number.isInteger(currentTab.groupId) && currentTab.groupId >= 0
            ? currentTab.groupId
            : null;
        const placementMeta = {
            groupId,
            currentTabId: Number.isInteger(currentTab.id) ? currentTab.id : null,
            placement: newTabPlacement
        };
        if (newTabPlacement === 'before-current') {
            return { windowId: currentTab.windowId, index: currentTab.index, ...placementMeta };
        }
        if (newTabPlacement === 'after-current') {
            return { windowId: currentTab.windowId, index: currentTab.index + 1, ...placementMeta };
        }
        const windowTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
        const lastIndex = Array.isArray(windowTabs) && windowTabs.length
            ? Math.max(...windowTabs.map(tab => Number.isInteger(tab.index) ? tab.index : -1))
            : currentTab.index;
        return { windowId: currentTab.windowId, index: lastIndex + 1, groupId: null, currentTabId: null, placement: 'root' };
    } catch (_) {
        return {};
    }
}

async function groupCreatedTabIfNeeded(tab, groupId, placement = 'root', currentTabId = null) {
    if (!tab || tab.id == null || !Number.isInteger(groupId) || groupId < 0) return;
    try {
        if (chrome.tabs && typeof chrome.tabs.group === 'function') {
            await chrome.tabs.group({ groupId, tabIds: [tab.id] });
            if (typeof chrome.tabs.get === 'function' && typeof chrome.tabs.move === 'function'
                && Number.isInteger(currentTabId)
                && (placement === 'before-current' || placement === 'after-current')) {
                const [currentTab, createdTab] = await Promise.all([
                    chrome.tabs.get(currentTabId),
                    chrome.tabs.get(tab.id)
                ]);
                if (currentTab && createdTab
                    && Number.isInteger(currentTab.index)
                    && Number.isInteger(createdTab.index)
                    && Number.isInteger(currentTab.windowId)) {
                    const windowTabs = typeof chrome.tabs.query === 'function'
                        ? await chrome.tabs.query({ windowId: currentTab.windowId })
                        : [];
                    const groupTabs = (Array.isArray(windowTabs) ? windowTabs : [])
                        .filter(item => Number.isInteger(item.index) && item.groupId === groupId)
                        .sort((a, b) => a.index - b.index);
                    const groupMin = groupTabs.length ? groupTabs[0].index : currentTab.index;
                    const groupMax = groupTabs.length ? groupTabs[groupTabs.length - 1].index : currentTab.index;
                    const createdWasAboveCurrent = createdTab.index < currentTab.index;
                    let targetIndex = placement === 'before-current'
                        ? currentTab.index - (createdWasAboveCurrent ? 1 : 0)
                        : currentTab.index + (createdWasAboveCurrent ? 0 : 1);
                    targetIndex = Math.max(groupMin, Math.min(groupMax, targetIndex));
                    await chrome.tabs.move(tab.id, { index: targetIndex });
                }
            }
        }
    } catch (error) {
        // 分组可能在创建期间被关闭；标签本身仍应正常打开。
        console.warn('[新标签页] 加入当前标签组失败:', error);
    }
}

async function openBookmarkNewTab(url, meta = {}) {
    if (!url) return;
    if (chrome && chrome.tabs) {
        try {
            const placement = await getNewTabPlacementProperties();
            const { groupId, currentTabId, placement: placementMode, ...createPlacement } = placement;
            const tab = await chrome.tabs.create({
                url: url,
                active: false,
                ...createPlacement
            });
            await groupCreatedTabIfNeeded(tab, groupId, placementMode, currentTabId);
            if (tab && tab.id != null) {
                await reportExtensionBookmarkOpen({
                    tabId: tab.id,
                    url,
                    title: meta.title || '',
                    bookmarkId: meta.bookmarkId || null,
                    source: meta.source || 'history_ui'
                });
            }
        } catch (_) {
            window.open(url, '_blank');
        }
    } else {
        window.open(url, '_blank');
    }
}

// 在新标签页中打开（统一接口，支持超链接标识）
async function openInNewTab(url, opts = {}) {
    const { context = null, isHyperlink = false } = opts || {};
    if (!url) return;

    if (isHyperlink) {
        // 超链接打开：暂不添加特殊标识，直接打开
        // 未来可以考虑创建带标识的组
        await openBookmarkNewTab(url, opts);
    } else {
        await openBookmarkNewTab(url, opts);
    }
}

// 在新窗口中打开（统一接口，支持超链接标识）
async function openInNewWindow(url, opts = {}) {
    const { context = null, isHyperlink = false, incognito = false } = opts || {};
    if (!url) return;

    if (isHyperlink) {
        // 超链接在新窗口打开：创建带"超链接"标记的窗口
        try {
            if (typeof chrome !== 'undefined' && chrome.windows && chrome.tabs) {
                const lang = currentLang || 'zh_CN';
                const hyperlinkTitle = lang === 'zh_CN' ? '超链接' : 'Hyperlink';
                const created = await chrome.windows.create({ url });

                // 添加标记页
                if (created && created.id) {
                    try {
                        const params = new URLSearchParams();
                        params.set('t', hyperlinkTitle);
                        const markerUrl = (chrome && chrome.runtime && chrome.runtime.getURL)
                            ? chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`)
                            : null;
                        if (markerUrl) {
                            const markerTab = await chrome.tabs.create({
                                windowId: created.id,
                                url: markerUrl,
                                pinned: false,
                                active: false
                            });
                            try {
                                if (markerTab && markerTab.id != null) {
                                    await chrome.tabs.move(markerTab.id, { index: 0 });
                                }
                            } catch (_) { }
                        }
                    } catch (_) { }
                }
            } else {
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('[超链接新窗口] 打开失败:', error);
            window.open(url, '_blank');
        }
    } else {
        await openBookmarkNewWindow(url, incognito, opts);
    }
}

// 在同一标签组中打开（统一接口，支持超链接标识）
async function openInSameGroup(url, opts = {}) {
    const { context = null, isHyperlink = false, forceNew = false } = opts || {};
    if (!url) return;

    if (isHyperlink) {
        // 超链接在标签组打开：使用"超链接"标题
        if (typeof chrome === 'undefined' || !chrome.tabs) {
            window.open(url, '_blank');
            return;
        }

        let tabCreated = false;
        try {
            const lang = currentLang || 'zh_CN';
            const hyperlinkTitle = lang === 'zh_CN' ? '超链接' : 'Hyperlink';

            // 检查是否已有超链接专用组（使用特殊标识）
            const HYPERLINK_GROUP_KEY = '_hyperlink_group_id';
            let hyperlinkGroupId = null;

            try {
                const stored = localStorage.getItem(HYPERLINK_GROUP_KEY);
                if (stored) {
                    hyperlinkGroupId = parseInt(stored, 10);
                    // 验证组是否仍然存在
                    if (chrome.tabGroups && chrome.tabGroups.get) {
                        await chrome.tabGroups.get(hyperlinkGroupId);
                    }
                }
            } catch (_) {
                hyperlinkGroupId = null;
                localStorage.removeItem(HYPERLINK_GROUP_KEY);
            }

            if (hyperlinkGroupId) {
                // 复用现有超链接组
                const tab = await chrome.tabs.create({ url, active: false });
                tabCreated = true;
                try {
                    await chrome.tabs.group({ groupId: hyperlinkGroupId, tabIds: tab.id });
                } catch (groupErr) {
                    console.warn('[超链接标签组] 复用分组加入失败 (仅保留标签):', groupErr);
                }
            } else {
                // 创建新的超链接组
                const tab = await chrome.tabs.create({ url, active: false });
                tabCreated = true;
                try {
                    const groupId = await chrome.tabs.group({ tabIds: tab.id });
                    if (chrome.tabGroups && chrome.tabGroups.update) {
                        try {
                            await chrome.tabGroups.update(groupId, {
                                title: hyperlinkTitle,
                                color: 'cyan'
                            });
                        } catch (_) { }
                    }
                    localStorage.setItem(HYPERLINK_GROUP_KEY, String(groupId));
                    const scope = getScopeFromContext(context || {});
                    const label = (scope.prefix || scope.title) ? `${scope.prefix || ''}${scope.prefix && scope.title ? ' - ' : ''}${scope.title || ''}` : '';
                    if (label) await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                } catch (groupErr) {
                    console.warn('[超链接标签组] 新建标签组失败 (仅保留标签):', groupErr);
                }
            }
        } catch (error) {
            console.warn('[超链接标签组] 打开失败:', error);
            if (!tabCreated) {
                window.open(url, '_blank');
            }
        }
    } else {
        await openInSpecificTabGroup(url, { forceNew });
    }
}

// 在新窗口中打开
async function openBookmarkNewWindow(url, incognito = false, meta = {}) {
    if (!url) return;
    if (chrome && chrome.windows) {
        try {
            const created = await chrome.windows.create({ url: url, incognito: incognito });
            const tabId = created?.tabs?.[0]?.id ?? null;
            if (tabId != null) {
                await reportExtensionBookmarkOpen({
                    tabId,
                    url,
                    title: meta.title || '',
                    bookmarkId: meta.bookmarkId || null,
                    source: meta.source || 'history_ui'
                });
            }
        } catch (error) {
            // 处理无痕模式被禁用的错误
            if (incognito && error.message && error.message.includes('Incognito mode is disabled')) {
                const lang = currentLang || 'zh_CN';
                const message = lang === 'zh_CN'
                    ? '无痕模式已被禁用。\n\n请在扩展管理页面启用"在无痕模式下启用"选项：\n1. 右键点击扩展图标\n2. 选择"管理扩展程序"\n3. 启用"在无痕模式下启用"'
                    : 'Incognito mode is disabled.\n\nPlease enable "Allow in Incognito" in extension settings:\n1. Right-click extension icon\n2. Select "Manage extensions"\n3. Enable "Allow in Incognito"';
                alert(message);
                // 降级为普通新窗口
                const created = await chrome.windows.create({ url: url, incognito: false });
                const tabId = created?.tabs?.[0]?.id ?? null;
                if (tabId != null) {
                    await reportExtensionBookmarkOpen({
                        tabId,
                        url,
                        title: meta.title || '',
                        bookmarkId: meta.bookmarkId || null,
                        source: meta.source || 'history_ui'
                    });
                }
            } else {
                console.error('[新窗口] 打开失败:', error);
                window.open(url, '_blank');
            }
        }
    } else {
        window.open(url, '_blank');
    }
}

// 在特定标签页组中打开：首次创建标签组，后续复用
async function openInSpecificTabGroup(url, options = {}) {
    const { forceNew = false } = options;
    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        // 回退
        window.open(url, '_blank');
        return;
    }

    await ensureCurrentWindowId();

    let tabCreated = false;
    try {
        if (forceNew) {
            await resetSpecificGroupInfo(currentWindowId);
        }

        // 如果已有分组，先校验分组与窗口是否有效
        if (specificTabGroupId && Number.isInteger(specificTabGroupId)) {
            let isValidGroup = false;
            try {
                // 窗口必须匹配当前窗口，以实现窗口隔离
                if (specificGroupWindowId !== currentWindowId) {
                    throw new Error('Window mismatch');
                }
                // 校验组是否存在
                if (chrome.tabGroups && chrome.tabGroups.get) {
                    await chrome.tabGroups.get(specificTabGroupId);
                }
                // 校验窗口是否存在
                if (specificGroupWindowId && chrome.windows && chrome.windows.get) {
                    await chrome.windows.get(specificGroupWindowId, { populate: false });
                }
                isValidGroup = true;
            } catch (err) {
                // 可能分组或窗口失效，或者窗口不匹配，重置当前窗口的分组数据后走创建逻辑
                await resetSpecificGroupInfo(currentWindowId);
            }

            if (isValidGroup) {
                const tab = await chrome.tabs.create({ url, active: false, windowId: specificGroupWindowId || undefined });
                tabCreated = true;
                if (tab && tab.id != null) {
                    await reportExtensionBookmarkOpen({ tabId: tab.id, url, source: 'history_ui' });
                    try {
                        await chrome.tabs.group({ groupId: specificTabGroupId, tabIds: tab.id });
                    } catch (groupErr) {
                        console.warn('[特定标签组] 复用分组加入失败 (仅保留标签，不重新打开):', groupErr);
                    }
                }
                return;
            }
        }

        // 创建新标签并建立新的分组
        const nextNumber = await allocateNextGroupNumber();
        const tab = await chrome.tabs.create({ url, active: false });
        tabCreated = true;
        if (tab && tab.id != null) {
            await reportExtensionBookmarkOpen({ tabId: tab.id, url, source: 'history_ui' });
            try {
                const groupId = await chrome.tabs.group({ tabIds: tab.id });
                await setSpecificGroupInfo(groupId, tab.windowId || null);
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    try { await chrome.tabGroups.update(groupId, { title: String(nextNumber), color: 'blue' }); } catch (_) { }
                }
                await registerPluginGroup(groupId, tab.windowId || null, nextNumber);
            } catch (groupErr) {
                console.warn('[特定标签组] 新建标签组失败 (仅保留标签):', groupErr);
            }
        }
    } catch (error) {
        console.warn('[特定标签组] 打开失败:', error);
        // 兜底回退
        if (!tabCreated) {
            try { window.open(url, '_blank'); } catch (_) { }
        }
    }
}

// 在特定窗口中打开：首次创建窗口A，后续复用
async function openInSpecificWindow(url, options = {}) {
    const { forceNew = false, context = null } = options;
    if (!url) return;
    try {
        if (typeof chrome !== 'undefined' && chrome.windows && chrome.tabs) {
            // 若切换回“特定窗口”，则重置，创建一个全新的窗口
            if (forceNew) {
                specificWindowId = null;
            }

            // 检查窗口是否存在（且未被关闭）
            if (specificWindowId) {
                try {
                    const win = await chrome.windows.get(specificWindowId, { populate: false });
                    if (win && win.id) {
                        const tab = await chrome.tabs.create({ windowId: specificWindowId, url, active: false });
                        if (tab && tab.id != null) {
                            await reportExtensionBookmarkOpen({ tabId: tab.id, url, source: 'history_ui' });
                            const scope = getScopeFromContext(context);
                            if (scope) {
                                const prefix = scope.prefix || '';
                                const title = scope.title || '';
                                const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                                if (label) {
                                    await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                                }
                            }
                        }
                        return;
                    }
                } catch (_) {
                    // 窗口不存在，创建新的
                }
            }
            const created = await chrome.windows.create({ url });
            if (created && created.id) {
                await setSpecificWindowId(created.id);
                let firstTabId = created?.tabs?.[0]?.id ?? null;
                if (firstTabId == null) {
                    try {
                        const winTabs = await chrome.tabs.query({ windowId: created.id });
                        if (winTabs && winTabs.length > 0) {
                            firstTabId = winTabs[0].id;
                        }
                    } catch (_) {}
                }
                if (firstTabId != null) {
                    await reportExtensionBookmarkOpen({ tabId: firstTabId, url, source: 'history_ui' });
                    const scope = getScopeFromContext(context);
                    if (scope) {
                        const prefix = scope.prefix || '';
                        const title = scope.title || '';
                        const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                        if (label) {
                            await saveTabSourceLabel(firstTabId, { text: label, color: scope.color || '' });
                        }
                    }
                }
                // 为“同一窗口”创建可见标记页（用于命名），标题使用连续编号
                try {
                    const nextNum = await allocateNextWindowNumber();
                    await registerPluginWindow(created.id, nextNum);
                    const lt = (context && context.treeType === 'temporary') ? 'temporary' : 'permanent';
                    const sid = (lt === 'temporary' && context && context.sectionId) ? context.sectionId : '';
                    const nid = (lt === 'permanent' && context && context.nodeId) ? context.nodeId : '';
                    const params = new URLSearchParams();
                    params.set('t', String(nextNum));
                    if (lt) params.set('lt', lt);
                    if (sid) params.set('sid', sid);
                    if (nid) params.set('nid', nid);
                    params.set('mode', 'same-window');
                    const markerUrl = (chrome && chrome.runtime && chrome.runtime.getURL)
                        ? chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`)
                        : null;
                    if (markerUrl && chrome && chrome.tabs && chrome.tabs.create) {
                        const markerTab = await chrome.tabs.create({ windowId: created.id, url: markerUrl, pinned: false, active: false });
                        if (markerTab && markerTab.id != null) {
                            try { if (markerTab && markerTab.id != null) await chrome.tabs.move(markerTab.id, { index: 0 }); } catch (_) { }
                            const scope = getScopeFromContext(context);
                            if (scope) {
                                const prefix = scope.prefix || '';
                                const title = scope.title || '';
                                const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                                if (label) {
                                    await saveTabSourceLabel(markerTab.id, { text: label, color: scope.color || '' });
                                }
                            }
                        }
                    }
                } catch (_) { }
            }
        } else {
            // 非扩展环境：退回到新窗口
            window.open(url, '_blank');
        }
    } catch (error) {
        console.error('[特定窗口] 打开失败:', error);
    }
}

// ===== 分栏作用域化：在特定（按栏目区分）标签组中打开 =====
async function openInScopedTabGroup(url, opts = {}) {
    const { context = null, forceNew = false } = opts || {};
    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs) {
        window.open(url, '_blank');
        return;
    }

    await ensureCurrentWindowId();

    const scope = getScopeFromContext(context || {});
    const key = currentWindowId ? `${currentWindowId}:${scope.key}` : scope.key;
    let tabCreated = false;
    try {
        // 尝试复用当前作用域的组
        if (!forceNew) {
            const entry = scopedCurrentGroups[key];
            if (entry && Number.isInteger(entry.groupId)) {
                let isValidGroup = false;
                try {
                    if (chrome.tabGroups && chrome.tabGroups.get) await chrome.tabGroups.get(entry.groupId);
                    if (entry.windowId && chrome.windows && chrome.windows.get) await chrome.windows.get(entry.windowId, { populate: false });
                    isValidGroup = true;
                } catch (_) {
                    // 失效：清除指针，落到新建逻辑
                    try {
                        delete scopedCurrentGroups[key];
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
                        } else {
                            localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
                        }
                    } catch (_) { }
                }

                if (isValidGroup) {
                    if (entry.windowId === currentWindowId) {
                        const tab = await chrome.tabs.create({ url, active: false, windowId: entry.windowId || undefined });
                        tabCreated = true;
                        if (tab && tab.id != null) {
                            try {
                                await chrome.tabs.group({ groupId: entry.groupId, tabIds: tab.id });
                            } catch (groupErr) {
                                console.warn('[分栏特定标签组] 复用分组加入失败 (仅保留标签):', groupErr);
                            }
                        }
                        return;
                    } else {
                        // Window mismatch: remove the stale reference and proceed to create in current window
                        try {
                            delete scopedCurrentGroups[key];
                            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                                await chrome.storage.local.set({ bookmarkScopedCurrentGroups: scopedCurrentGroups });
                            } else {
                                localStorage.setItem('bookmarkScopedCurrentGroups', JSON.stringify(scopedCurrentGroups));
                            }
                        } catch (_) {}
                    }
                }
            }
        }

        // 新建：分配本作用域下一可用编号
        const nextNumber = await allocateNextScopedNumber(scope.key);
        const winId = currentWindowId || (await chrome.windows.getCurrent({ populate: false })).id;
        const tab = await chrome.tabs.create({ url, active: false, windowId: winId });
        tabCreated = true;
        if (tab && tab.id != null) {
            try {
                const groupId = await chrome.tabs.group({ tabIds: tab.id });
                const windowId = tab.windowId || null;
                const title = (scope && scope.kind === 'permanent')
                    ? `${scope.prefix || 'A-Z'} ${nextNumber}`
                    : __formatScopedTempTitle(scope && scope.prefix, nextNumber);
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    try { await chrome.tabGroups.update(groupId, { title, color: 'blue' }); } catch (_) { }
                }
                await setScopedCurrentGroup(key, groupId, windowId);
                await registerScopedGroup(scope.key, groupId, windowId, nextNumber);
            } catch (groupErr) {
                console.warn('[分栏特定标签组] 新建标签组失败 (仅保留标签):', groupErr);
            }
        }
    } catch (error) {
        console.warn('[分栏特定标签组] 打开失败:', error);
        if (!tabCreated) {
            try { window.open(url, '_blank'); } catch (_) { }
        }
    }
}

// ===== 分栏作用域化：在特定（按栏目区分）窗口中打开 =====
async function openInScopedWindow(url, opts = {}) {
    const { context = null, forceNew = false } = opts || {};
    if (!url) return;
    try {
        const scope = getScopeFromContext(context || {});
        if (!forceNew) {
            const winId = scopedWindows[scope.key];
            if (Number.isInteger(winId)) {
                try {
                    const win = await chrome.windows.get(winId, { populate: false });
                    if (win && win.id) {
                        const tab = await chrome.tabs.create({ windowId: win.id, url, active: false });
                        if (tab && tab.id != null) {
                            const prefix = scope.prefix || '';
                            const title = scope.title || '';
                            const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                            if (label) {
                                await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                            }
                        }
                        return;
                    }
                } catch (_) {
                    try {
                        delete scopedWindows[scope.key];
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            await chrome.storage.local.set({ bookmarkScopedWindows: scopedWindows });
                        } else {
                            localStorage.setItem('bookmarkScopedWindows', JSON.stringify(scopedWindows));
                        }
                    } catch (_) { }
                }
            }
        }
        const created = await chrome.windows.create({ url });
        if (created && created.id) {
            await setScopedWindow(scope.key, created.id);
            let firstTabId = created?.tabs?.[0]?.id ?? null;
            if (firstTabId == null) {
                try {
                    const winTabs = await chrome.tabs.query({ windowId: created.id });
                    if (winTabs && winTabs.length > 0) {
                        firstTabId = winTabs[0].id;
                    }
                } catch (_) {}
            }
            if (firstTabId != null) {
                const prefix = scope.prefix || '';
                const title = scope.title || '';
                const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                if (label) {
                    await saveTabSourceLabel(firstTabId, { text: label, color: scope.color || '' });
                }
            }
            // 为不同作用域添加可见标记页：
            // permanent -> 标题 "A-Z <n>"；temporary(alpha) -> 标题 "<alpha><n>"
            const markerTitleNumber = await allocateNextScopedWindowNumber(scope.key);
            await registerScopedWindow(scope.key, created.id, markerTitleNumber);
            try {
                const titleStr = (scope && scope.kind === 'permanent')
                    ? `${scope.prefix || 'A-Z'} ${markerTitleNumber}`
                    : __formatScopedTempTitle(scope && scope.prefix, markerTitleNumber);
                const lt = (scope && scope.kind === 'permanent') ? 'permanent' : 'temporary';
                const sid = (lt === 'temporary' && context && context.sectionId) ? context.sectionId : '';
                const nid = (lt === 'permanent' && context && context.nodeId) ? context.nodeId : '';
                const p = new URLSearchParams();
                p.set('t', titleStr);
                if (lt) p.set('lt', lt);
                if (sid) p.set('sid', sid);
                if (nid) p.set('nid', nid);
                p.set('mode', 'scoped-window');
                const markerUrl = (chrome && chrome.runtime && chrome.runtime.getURL)
                    ? chrome.runtime.getURL(`history_html/window_marker.html?${p.toString()}`)
                    : null;
                if (markerUrl && chrome && chrome.tabs && chrome.tabs.create) {
                    const markerTab = await chrome.tabs.create({ windowId: created.id, url: markerUrl, pinned: false, active: false });
                    if (markerTab && markerTab.id != null) {
                        try { if (markerTab && markerTab.id != null) await chrome.tabs.move(markerTab.id, { index: 0 }); } catch (_) { }
                        const prefix = scope.prefix || '';
                        const titleText = scope.title || '';
                        const label = (prefix && titleText) ? `${prefix} - ${titleText}` : (prefix || titleText || '');
                        if (label) {
                            await saveTabSourceLabel(markerTab.id, { text: label, color: scope.color || '' });
                        }
                    }
                }
            } catch (_) { }
        }
    } catch (error) {
        console.error('[分栏特定窗口] 打开失败:', error);
        try { window.open(url, '_blank'); } catch (_) { }
    }
}

async function ensureSameWindowSpecificGroupWindow(context) {
    if (sameWindowSpecificGroupWindowId && chrome && chrome.windows && chrome.windows.get) {
        try {
            const existing = await chrome.windows.get(sameWindowSpecificGroupWindowId, { populate: false });
            if (existing && existing.id) {
                return existing.id;
            }
        } catch (_) {
            await resetSameWindowSpecificGroupState();
        }
    }
    return await createSameWindowSpecificGroupWindow(context);
}

async function createSameWindowSpecificGroupWindow(context) {
    if (typeof chrome === 'undefined' || !chrome.windows) {
        throw new Error('chrome.windows unavailable');
    }
    const nextNumber = await allocateNextSwsgWindowNumber();
    let markerUrl = null;
    try {
        const params = new URLSearchParams();
        params.set('t', String(nextNumber));
        const treeType = context && context.treeType === 'temporary' ? 'temporary' : 'permanent';
        if (treeType) params.set('lt', treeType);
        if (context && context.sectionId) params.set('sid', context.sectionId);
        if (context && context.nodeId) params.set('nid', context.nodeId);
        params.set('mode', 'same-window-specific-group');
        if (chrome.runtime && chrome.runtime.getURL) {
            markerUrl = chrome.runtime.getURL(`history_html/window_marker.html?${params.toString()}`);
        }
    } catch (_) { }
    const createArgs = markerUrl ? { url: markerUrl } : {};
    const created = await chrome.windows.create(createArgs);
    if (!created || created.id == null) {
        throw new Error('failed to create combined window');
    }
    await registerSwsgWindow(created.id, nextNumber);
    await setSameWindowSpecificGroupWindowId(created.id);

    // 为该 marker tab 写入来源标签
    try {
        let markerTabId = created?.tabs?.[0]?.id ?? null;
        if (markerTabId == null) {
            const winTabs = await chrome.tabs.query({ windowId: created.id });
            if (winTabs && winTabs.length > 0) {
                markerTabId = winTabs[0].id;
            }
        }
        if (markerTabId != null) {
            const scope = getScopeFromContext(context);
            if (scope) {
                const prefix = scope.prefix || '';
                const title = scope.title || '';
                const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
                if (label) {
                    await saveTabSourceLabel(markerTabId, { text: label, color: scope.color || '' });
                }
            }
        }
    } catch (_) {}

    return created.id;
}

async function openInSameWindowSpecificGroup(url, opts = {}) {
    const { context = null, forceNewWindow = false, forceNewGroup = false, isHyperlink = false } = opts || {};
    if (!url) return;
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.windows) {
        window.open(url, '_blank');
        return;
    }
    let tabCreated = false;
    try {
        if (forceNewWindow) {
            await resetSameWindowSpecificGroupState();
        }

        // 如果是超链接，使用特殊的作用域键
        const scope = isHyperlink
            ? { key: '_hyperlink_swsg', prefix: '' }
            : getScopeFromContext(context || {});

        // 检查目标窗口是否在打开前已存在（若不存在或强制新建，则属于新建窗口）
        let isNewWindow = false;
        if (forceNewWindow || !sameWindowSpecificGroupWindowId) {
            isNewWindow = true;
        } else {
            try {
                const existing = await chrome.windows.get(sameWindowSpecificGroupWindowId, { populate: false });
                if (!existing || !existing.id) {
                    isNewWindow = true;
                }
            } catch (_) {
                isNewWindow = true;
            }
        }

        const windowId = await ensureSameWindowSpecificGroupWindow(context);
        if (forceNewGroup) {
            await clearSameWindowSpecificGroupScope(scope.key);
        }

        let reuseGroupId = null;
        if (!forceNewGroup) {
            const entry = getSameWindowSpecificGroupEntry(scope.key);
            if (entry && Number.isInteger(entry.groupId) && entry.windowId === windowId) {
                try {
                    if (chrome.tabGroups && chrome.tabGroups.get) {
                        await chrome.tabGroups.get(entry.groupId);
                    }
                    reuseGroupId = entry.groupId;
                } catch (_) {
                    await clearSameWindowSpecificGroupScope(scope.key);
                    reuseGroupId = null;
                }
            }
        }

        const tab = await chrome.tabs.create({ url, active: isNewWindow, windowId });
        tabCreated = true;

        if (tab && tab.id != null) {
            const prefix = scope.prefix || '';
            const title = scope.title || '';
            const label = (prefix && title) ? `${prefix} - ${title}` : (prefix || title || '');
            if (label) {
                await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
            }
        }

        // 激活窗口，确保显示最新打开的书签页面（如果是新窗口才激活，避免已存在的窗口后续打开tab页时跳转）
        if (isNewWindow) {
            try {
                await chrome.windows.update(windowId, { focused: true });
            } catch (_) { }
        }

        if (reuseGroupId) {
            try {
                await chrome.tabs.group({ groupId: reuseGroupId, tabIds: tab.id });
            } catch (groupErr) {
                console.warn('[同窗特定标签组] 复用分组加入失败 (仅保留标签):', groupErr);
            }
            return;
        }

        // 创建标签组
        let groupId;
        try {
            groupId = await chrome.tabs.group({ tabIds: tab.id, createProperties: { windowId } });
        } catch (groupErr) {
            console.warn('[同窗特定标签组] 创建标签组失败 (仅保留标签):', groupErr);
            return; // 标签已创建，无法建组则结束
        }

        // 如果是超链接，使用特殊的标题
        let title;
        let groupNumber = null;

        if (isHyperlink) {
            const lang = currentLang || 'zh_CN';
            title = lang === 'zh_CN' ? '超链接' : 'Hyperlink';
        } else {
            groupNumber = await allocateNextScopedNumber(scope.key);
            title = (scope && scope.kind === 'permanent')
                ? `${scope.prefix || 'A-Z'} ${groupNumber}`
                : __formatScopedTempTitle(scope && scope.prefix, groupNumber);
            await registerScopedGroup(scope.key, groupId, windowId, groupNumber);
        }

        if (chrome.tabGroups && chrome.tabGroups.update) {
            try {
                await chrome.tabGroups.update(groupId, {
                    title,
                    color: isHyperlink ? 'cyan' : 'blue'
                });
            } catch (_) { }
        }

        await setSameWindowSpecificGroupScope(scope.key, groupId, windowId, groupNumber);
    } catch (error) {
        console.error('[同窗特定标签组] 打开失败:', error);
        if (!tabCreated) {
            try { window.open(url, '_blank'); } catch (_) { }
        }
    }
}

// 暴露新函数给全局（供临时栏目的左键处理调用）
try {
    window.openInScopedTabGroup = openInScopedTabGroup;
    window.openInScopedWindow = openInScopedWindow;
    window.openInSameWindowSpecificGroup = openInSameWindowSpecificGroup;
} catch (_) { }

// 打开文件夹中所有书签
async function openAllBookmarks(folderId, newWindow = false, incognito = false) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    // 获取文件夹中的所有书签（递归）
    async function getAllUrls(folderId) {
        const urls = [];
        const children = await chrome.bookmarks.getChildren(folderId);

        for (const child of children) {
            if (child.url) {
                urls.push(child.url);
            } else if (child.children) {
                // 递归获取子文件夹中的书签
                const subUrls = await getAllUrls(child.id);
                urls.push(...subUrls);
            }
        }

        return urls;
    }

    const urls = await getAllUrls(folderId);

    if (urls.length === 0) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
        return;
    }

    // 确认是否打开大量书签
    if (urls.length > 10) {
        const lang = currentLang || 'zh_CN';
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    if (newWindow) {
        // 在新窗口中打开
        if (chrome.windows) {
            try {
                await chrome.windows.create({ url: urls, incognito: incognito });
            } catch (error) {
                if (incognito && error.message && error.message.includes('Incognito mode is disabled')) {
                    const lang = currentLang || 'zh_CN';
                    const message = lang === 'zh_CN'
                        ? '无痕模式已被禁用。将在普通窗口中打开。\n\n若要使用无痕模式，请在扩展管理页面启用"在无痕模式下启用"。'
                        : 'Incognito mode is disabled. Opening in normal window.\n\nTo use incognito mode, enable "Allow in Incognito" in extension settings.';
                    alert(message);
                    // 降级为普通新窗口
                    await chrome.windows.create({ url: urls, incognito: false });
                } else {
                    console.error('[打开全部] 新窗口失败:', error);
                    urls.forEach(url => window.open(url, '_blank'));
                }
            }
        }
    } else {
        // 在新标签页中打开
        if (chrome.tabs) {
            for (const url of urls) {
                chrome.tabs.create({ url: url, active: false });
            }
        }
    }
}

// 编辑书签 - 使用自定义模态框
async function editBookmark(nodeId, currentTitle, currentUrl, isFolder) {
    const lang = currentLang || 'zh_CN';

    const result = await showBookmarkEditorModal({
        modalTitle: isFolder
            ? (lang === 'zh_CN' ? '重命名文件夹' : 'Rename Folder')
            : (lang === 'zh_CN' ? '编辑书签' : 'Edit Bookmark'),
        titleLabel: isFolder
            ? (lang === 'zh_CN' ? '文件夹名称' : 'Folder Name')
            : (lang === 'zh_CN' ? '书签名称' : 'Bookmark Name'),
        urlLabel: lang === 'zh_CN' ? '书签地址' : 'Bookmark URL',
        saveText: lang === 'zh_CN' ? '保存' : 'Save',
        cancelText: lang === 'zh_CN' ? '取消' : 'Cancel',
        titlePlaceholder: lang === 'zh_CN' ? '输入名称...' : 'Enter name...',
        urlPlaceholder: 'https://...',
        titleValue: currentTitle || '',
        urlValue: currentUrl || '',
        showUrl: !isFolder,
        requireUrl: !isFolder
    });

    if (!result) return;

    const newTitle = result.title;
    const newUrl = result.url;
    const currentTitleValue = typeof currentTitle === 'string' ? currentTitle.trim() : '';
    const currentUrlValue = typeof currentUrl === 'string' ? currentUrl.trim() : '';

    try {
        if (chrome && chrome.bookmarks) {
            if (isFolder) {
                if (newTitle !== currentTitleValue) {
                    await updatePermanentBookmarkNode(nodeId, { title: newTitle });
                }
            } else {
                const updates = {};
                if (newTitle !== currentTitleValue) updates.title = newTitle;
                if (newUrl !== currentUrlValue) updates.url = newUrl;

                if (Object.keys(updates).length > 0) {
                    await updatePermanentBookmarkNode(nodeId, updates);
                }
            }
        }
    } catch (error) {
        console.error('[编辑] 保存失败:', error);
        alert(lang === 'zh_CN' ? `保存失败: ${error.message}` : `Save failed: ${error.message}`);
    }
}

// 添加书签 - 使用自定义模态框
async function addBookmark(parentId, options = {}) {
    const lang = currentLang || 'zh_CN';

    const result = await showBookmarkEditorModal({
        modalTitle: lang === 'zh_CN' ? '添加书签' : 'Add Bookmark',
        titleLabel: lang === 'zh_CN' ? '书签名称' : 'Bookmark Name',
        urlLabel: lang === 'zh_CN' ? '书签地址' : 'Bookmark URL',
        saveText: lang === 'zh_CN' ? '添加' : 'Add',
        cancelText: lang === 'zh_CN' ? '取消' : 'Cancel',
        titlePlaceholder: lang === 'zh_CN' ? '输入书签名称...' : 'Enter bookmark name...',
        urlPlaceholder: 'https://...',
        titleValue: '',
        urlValue: '',
        showUrl: true,
        requireUrl: true,
        requireTitle: true
    });

    if (!result) return null;

    try {
        if (chrome && chrome.bookmarks) {
            const payload = {
                parentId,
                title: result.title,
                url: result.url
            };
            const index = Number(options && options.index);
            if (Number.isFinite(index)) {
                payload.index = Math.max(0, Math.floor(index));
            }
            return await createPermanentBookmarkNode(payload);
        }
    } catch (error) {
        console.error('[添加书签] 失败:', error);
        alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
    }

    return null;
}

// 添加文件夹 - 使用自定义模态框
async function addFolder(parentId, options = {}) {
    const lang = currentLang || 'zh_CN';

    const result = await showBookmarkEditorModal({
        modalTitle: lang === 'zh_CN' ? '添加文件夹' : 'Add Folder',
        titleLabel: lang === 'zh_CN' ? '文件夹名称' : 'Folder Name',
        saveText: lang === 'zh_CN' ? '添加' : 'Add',
        cancelText: lang === 'zh_CN' ? '取消' : 'Cancel',
        titlePlaceholder: lang === 'zh_CN' ? '输入文件夹名称...' : 'Enter folder name...',
        titleValue: '',
        urlValue: '',
        showUrl: false,
        requireTitle: true
    });

    if (!result) return null;

    try {
        if (chrome && chrome.bookmarks) {
            const payload = {
                parentId,
                title: result.title
            };
            const index = Number(options && options.index);
            if (Number.isFinite(index)) {
                payload.index = Math.max(0, Math.floor(index));
            }
            return await createPermanentBookmarkNode(payload);
        }
    } catch (error) {
        console.error('[添加文件夹] 失败:', error);
        alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
    }

    return null;
}

// 复制URL
async function copyUrl(url) {
    if (!url) return;

    try {
        await navigator.clipboard.writeText(url);
        const lang = currentLang || 'zh_CN';
        ;
        // 可以显示一个toast提示
    } catch (err) {
        console.error('复制失败:', err);
    }
}

// 删除书签/文件夹（普通删除不需要二次确认）
// 不调用refreshBookmarkTree，让onRemoved事件的增量更新处理红色标识
async function deleteBookmark(nodeId, nodeTitle, isFolder) {
    if (chrome && chrome.bookmarks) {
        if (isFolder) {
            await removePermanentBookmarkNode(nodeId, true);
        } else {
            await removePermanentBookmarkNode(nodeId, false);
        }
    }
}

// 剪切书签
async function cutBookmark(nodeId, nodeTitle, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const node = await readPermanentNodeForPayload(nodeId);

        await __ctxEnsurePermanentMetadataLoaded();

        setBookmarkClipboardState({
            action: 'cut',
            source: 'permanent',
            nodeIds: [nodeId],
            nodeData: node,
            payload: node ? [serializeBookmarkNode(node)] : [],
            timestamp: Date.now()
        });

        ;

        markCutNode(nodeId);

    } catch (error) {
        console.error('[剪切] 失败:', error);
    }
}

// 复制书签
async function copyBookmark(nodeId, nodeTitle, isFolder) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const node = await readPermanentNodeForPayload(nodeId);

        await __ctxEnsurePermanentMetadataLoaded();

        setBookmarkClipboardState({
            action: 'copy',
            source: 'permanent',
            nodeIds: [nodeId],
            nodeData: node,
            payload: node ? [serializeBookmarkNode(node)] : [],
            timestamp: Date.now()
        });

        ;

    } catch (error) {
        console.error('[复制] 失败:', error);
    }
}

// 粘贴书签
async function pasteBookmark(targetNodeId, isFolder, requestedPlacement = false) {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const clipboard = await getLatestBookmarkClipboardForPaste();
    if (!clipboard) {
        return;
    }

    try {
        const placement = normalizePastePlacement(isFolder, requestedPlacement);

        // 确定目标文件夹ID和起始位置
        let targetFolderId;
        let insertIndex = undefined;

        if (isFolder && placement === 'inside') {
            // 粘贴到目标文件夹末尾
            targetFolderId = targetNodeId;
        } else {
            // before/after：获取目标节点父文件夹及同级插入位置
            const nodes = await chrome.bookmarks.get(targetNodeId);
            if (nodes && nodes[0]) {
                if (nodes[0].parentId && nodes[0].parentId !== '0') {
                    targetFolderId = nodes[0].parentId;
                    insertIndex = typeof nodes[0].index === 'number'
                        ? nodes[0].index + (placement === 'after' ? 1 : 0)
                        : undefined;
                } else {
                    // 如果父文件夹为 '0'，表示目标是根文件夹（如书签栏本身），无法在其下方粘贴，降级为粘贴到其内部
                    targetFolderId = targetNodeId;
                    insertIndex = undefined;
                }
            } else {
                throw new Error('无法找到父文件夹');
            }
        }

        if (clipboard.source === 'temporary' || clipboard.source === 'mixed') {
            const payload = clipboard.payload || [];
            if (payload.length) {
                const totalNodes = countPayloadNodes(payload);
                const useBulkMute = totalNodes > 1;
                let muteSession = null;
                let loadingToast = null;
                if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
                    muteSession = await beginBookmarkBulkMute('paste-temp-to-permanent');
                }
                if (typeof window.showLoadingToast === 'function' && totalNodes > 30) {
                    const lang = currentLang || 'zh_CN';
                    loadingToast = window.showLoadingToast(lang === 'zh_CN' ? `正在粘贴 ${totalNodes} 项...` : `Pasting ${totalNodes} items...`);
                }
                const progressTracker = {
                    total: totalNodes,
                    current: 0,
                    startTime: Date.now()
                };
                const createdEvents = [];
                try {
                    const tagUpdates = [];
                    const noteUpdates = [];
                    for (const item of payload) {
                        const dupOptions = { tagUpdates, noteUpdates, createdEvents, progressTracker, loadingToast };
                        if (typeof insertIndex === 'number') {
                            dupOptions.index = insertIndex;
                        }
                        await duplicateNode(item, targetFolderId, dupOptions);
                        if (typeof insertIndex === 'number') {
                            insertIndex++;
                        }
                    }
                    if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                        await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'paste-temp-to-permanent');
                    }
                    await __ctxFlushPermanentMetadataUpdates(tagUpdates, noteUpdates, 'paste-temp-to-permanent');
                } finally {
                    if (loadingToast) loadingToast.close();
                    if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                        await endBookmarkBulkMute('paste-temp-to-permanent', { refreshTree: true });
                    }
                }
            }

            if (clipboard.source !== 'mixed' && clipboard.action === 'cut' && clipboard.sectionId && clipboard.nodeIds) {
                const manager = getTempManager();
                if (manager) {
                    try { manager.removeItems(clipboard.sectionId, clipboard.nodeIds); } catch (_) {}
                }
            }
            await finalizeBookmarkClipboardPaste(clipboard);
        } else if (clipboard.source === 'permanent') {
            if (clipboard.action === 'cut' && clipboard.nodeIds) {
                const totalNodes = clipboard.nodeIds.length;
                const useBulkMute = totalNodes > 1;
                let muteSession = null;
                let loadingToast = null;
                if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
                    muteSession = await beginBookmarkBulkMute('paste-permanent-cut');
                }
                if (typeof window.showLoadingToast === 'function' && totalNodes > 30) {
                    const lang = currentLang || 'zh_CN';
                    loadingToast = window.showLoadingToast(lang === 'zh_CN' ? `正在移动 ${totalNodes} 项...` : `Moving ${totalNodes} items...`);
                }
                const progressTracker = {
                    total: totalNodes,
                    current: 0,
                    startTime: Date.now()
                };
                const createdEvents = [];
                try {
                    // Pre-fetch original nodes to get oldParentId and oldIndex
                    let originalNodeMap = new Map();
                    try {
                        const originalNodes = await chrome.bookmarks.get(clipboard.nodeIds);
                        originalNodes.forEach(node => {
                            if (node) {
                                originalNodeMap.set(node.id, {
                                    oldParentId: node.parentId,
                                    oldIndex: node.index
                                });
                            }
                        });
                    } catch (err) {
                        console.warn('[粘贴] 获取原始节点信息失败:', err);
                    }

                    const fallbackPayload = clipboard.payload || [];
                    const tagUpdates = [];
                    const noteUpdates = [];
                    for (let itemIndex = 0; itemIndex < clipboard.nodeIds.length; itemIndex++) {
                        const id = clipboard.nodeIds[itemIndex];
                        const target = { parentId: targetFolderId };
                        if (typeof insertIndex === 'number') {
                            target.index = insertIndex;
                        }
                        const orig = originalNodeMap.get(id) || {};
                        progressTracker.current++;
                        if (loadingToast) {
                            const current = progressTracker.current;
                            const msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                                ? `Moving: ${current}/${total}`
                                : `正在移动: ${current}/${total}`;
                            loadingToast.update(msg);
                        }
                        try {
                            await movePermanentBookmarkNode(id, target, {
                                createdEvents,
                                oldParentId: orig.oldParentId,
                                oldIndex: orig.oldIndex
                            });
                        } catch (moveError) {
                            // A deleted source must not invalidate the cut snapshot.
                            const fallback = fallbackPayload[itemIndex];
                            if (!fallback) throw moveError;
                            await duplicateNode(fallback, targetFolderId, { index: target.index, tagUpdates, noteUpdates, createdEvents, progressTracker, loadingToast });
                        }
                        if (typeof insertIndex === 'number') {
                            insertIndex++;
                        }
                    }
                    if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                        await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'paste-permanent-cut');
                    }
                    await __ctxFlushPermanentMetadataUpdates(tagUpdates, noteUpdates, 'paste-permanent-cut-fallback');
                } finally {
                    if (loadingToast) loadingToast.close();
                    if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                        await endBookmarkBulkMute('paste-permanent-cut', { refreshTree: true });
                    }
                }
            } else if (clipboard.action === 'copy') {
                const payload = clipboard.payload || (clipboard.nodeData ? [clipboard.nodeData] : []);
                const totalNodes = countPayloadNodes(payload);
                const useBulkMute = totalNodes > 1;
                let muteSession = null;
                let loadingToast = null;
                if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
                    muteSession = await beginBookmarkBulkMute('paste-permanent-copy');
                }
                if (typeof window.showLoadingToast === 'function' && totalNodes > 30) {
                    const lang = currentLang || 'zh_CN';
                    loadingToast = window.showLoadingToast(lang === 'zh_CN' ? `正在复制 ${totalNodes} 项...` : `Copying ${totalNodes} items...`);
                }
                const progressTracker = {
                    total: totalNodes,
                    current: 0,
                    startTime: Date.now()
                };
                const createdEvents = [];
                try {
                    const tagUpdates = [];
                    const noteUpdates = [];
                    for (const node of payload) {
                        const dupOptions = { tagUpdates, noteUpdates, createdEvents, progressTracker, loadingToast };
                        if (typeof insertIndex === 'number') {
                            dupOptions.index = insertIndex;
                        }
                        await duplicateNode(node, targetFolderId, dupOptions);
                        if (typeof insertIndex === 'number') {
                            insertIndex++;
                        }
                    }
                    if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                        await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'paste-permanent-copy');
                    }
                    await __ctxFlushPermanentMetadataUpdates(tagUpdates, noteUpdates, 'paste-permanent-copy');
                } finally {
                    if (loadingToast) loadingToast.close();
                    if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                        await endBookmarkBulkMute('paste-permanent-copy', { refreshTree: true });
                    }
                }
            }
            await finalizeBookmarkClipboardPaste(clipboard);
        }

        // 不调用 refreshBookmarkTree()，让 onMoved/onCreated 事件触发增量更新

    } catch (error) {
        await restoreBookmarkClipboardCutClaim(clipboard);
        console.error('[粘贴] 失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `粘贴失败: ${error.message}` : `Paste failed: ${error.message}`);
    }
}

// 递归复制节点
async function duplicateNode(node, parentId, options = {}) {
    if (options.progressTracker) {
        options.progressTracker.current++;
        if (options.loadingToast && typeof options.loadingToast.update === 'function') {
            const current = options.progressTracker.current;
            const total = options.progressTracker.total;
            const msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                ? `Pasting: ${current}/${total}`
                : `正在粘贴: ${current}/${total}`;
            options.loadingToast.update(msg);
        }
    }

    const newNode = {
        parentId: parentId,
        title: node.title
    };

    if (node.url) {
        newNode.url = node.url;
    }

    if (typeof options.index === 'number') {
        newNode.index = options.index;
    }

    // 创建节点
    const created = await createPermanentBookmarkNode(newNode, options);

    // Inherit tags if tagUpdates array is provided
    if (node.tags && node.tags.length && options.tagUpdates) {
        options.tagUpdates.push({
            chromeId: created.id,
            tags: node.tags
        });
    }
    const note = __ctxNormalizeNote(node.note);
    if (note && options.noteUpdates) {
        options.noteUpdates.push({
            chromeId: created.id,
            note,
            noteColor: __ctxNormalizeNoteColor(node.noteColor)
        });
    }

    // 如果有子节点，递归复制
    if (node.children) {
        const childOptions = { ...options };
        delete childOptions.index; // 子节点不需要继承外层指定的 index，应该直接追加
        for (const child of node.children) {
            await duplicateNode(child, created.id, childOptions);
        }
    }

    return created;
}

// 标记被剪切的节点
function markCutNode(nodeId) {
    syncDismissedCutMarkIdentity();
    document.querySelectorAll(`.tree-item[data-node-id="${nodeId}"]`).forEach((node) => {
        const section = node.closest('.permanent-bookmark-section, .temp-canvas-node');
        const cardKey = getBookmarkCardKey(section);
        if (!cardKey || !dismissedCutMarkCardKeys.has(cardKey)) {
            node.classList.add('cut-marked');
        }
    });
}

// 取消标记
function unmarkCutNode() {
    document.querySelectorAll('.cut-marked').forEach(node => {
        node.classList.remove('cut-marked');
    });
}

// ==================== 标签页组功能 ====================

// 在新标签页组中打开所有书签
async function openAllInTabGroup(folderId) {
    if (!chrome || !chrome.bookmarks || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        // 获取所有URL
        const urls = await getAllUrlsFromFolder(folderId);

        if (urls.length === 0) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '文件夹中没有书签' : 'No bookmarks in folder');
            return;
        }

        // 确认是否打开大量书签
        if (urls.length > 10) {
            const lang = currentLang || 'zh_CN';
            const message = lang === 'zh_CN'
                ? `确定要打开 ${urls.length} 个书签吗？`
                : `Open ${urls.length} bookmarks?`;
            if (!confirm(message)) return;
        }

        // 获取文件夹信息作为组名
        const [folder] = await chrome.bookmarks.get(folderId);
        const groupTitle = folder.title;

        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            tabIds.push(tab.id);
        }

        // 创建标签页组
        if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: tabIds });

            // 设置组标题和颜色
            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    collapsed: false
                });
            }
        }

        ;

    } catch (error) {
        console.error('[标签页组] 打开失败:', error);
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 辅助函数：递归获取文件夹中的所有URL
async function getAllUrlsFromFolder(folderId) {
    const urls = [];
    const children = await chrome.bookmarks.getChildren(folderId);

    for (const child of children) {
        if (child.url) {
            urls.push(child.url);
        }
    }

    return urls;
}


// =================================================================================
// X. MULTI-SELECT, BATCH OPERATIONS, TOOLBAR & PANEL LAYOUT (多选、批量操作、工具栏与面板布局)
// =================================================================================

// ==================== 多选功能 ====================

// 切换节点选中状态
function toggleNodeSelection(nodeId, nodeElement) {
    toggleSelectItem(nodeId, nodeElement);
}

window.getDragSelectionBreakdown = function(nodeIds) {
    let foldersCount = 0;
    let bookmarksCount = 0;
    const ids = nodeIds || (typeof selectedNodes !== 'undefined' ? Array.from(selectedNodes) : []);
    const manager = getTempManager();

    ids.forEach(id => {
        const el = document.querySelector(`.tree-item[data-node-id="${id}"]`);
        if (el) {
            if (el.dataset.nodeType === 'folder') {
                foldersCount++;
            } else {
                bookmarksCount++;
            }
        } else {
            const meta = typeof selectedNodeMeta !== 'undefined' && selectedNodeMeta.get(id);
            if (meta) {
                if (meta.nodeType === 'folder') {
                    foldersCount++;
                } else if (meta.treeType === 'temporary' && manager && typeof manager.findItem === 'function') {
                    try {
                        const entry = manager.findItem(meta.sectionId, id);
                        if (entry && entry.item && entry.item.type === 'folder') {
                            foldersCount++;
                            return;
                        }
                    } catch (_) {}
                    bookmarksCount++;
                } else {
                    bookmarksCount++;
                }
            } else {
                bookmarksCount++;
            }
        }
    });

    return { folders: foldersCount, bookmarks: bookmarksCount, total: ids.length };
};

window.formatDragPreviewText = function(nodeIds, lang = 'zh_CN') {
    const breakdown = window.getDragSelectionBreakdown(nodeIds);
    const f = breakdown.folders;
    const b = breakdown.bookmarks;

    if (lang === 'zh_CN') {
        if (f > 0 && b > 0) {
            return `${b} 个书签，${f} 个文件夹`;
        } else if (f > 0) {
            return `${f} 个文件夹`;
        } else if (b > 0) {
            return `${b} 个书签`;
        }
        return '0 个项目';
    } else {
        if (f > 0 && b > 0) {
            return `${b} bookmark${b > 1 ? 's' : ''}, ${f} folder${f > 1 ? 's' : ''}`;
        } else if (f > 0) {
            return `${f} folder${f > 1 ? 's' : ''}`;
        } else if (b > 0) {
            return `${b} bookmark${b > 1 ? 's' : ''}`;
        }
        return '0 items';
    }
};

// 范围选择（Shift+Click）
function selectRange(startNodeId, endNodeId, endNodeElement = null) {
    // 找出结束节点元素及其所在的卡片容器（确保选择是在同一个卡片内进行）
    const endEl = endNodeElement ||
                  document.querySelector(`.tree-item[data-node-id="${endNodeId}"].selected`) ||
                  document.querySelector(`.tree-item[data-node-id="${endNodeId}"]`);
    const container = endEl ? endEl.closest('.permanent-bookmark-section, .temp-canvas-node') : null;
    if (!container) return;

    // 尝试在同一个卡片容器中解析起始节点元素（支持因更新/重渲染导致的元素离线或指针丢失）
    let startEl = null;
    if (lastClickedElement && container.contains(lastClickedElement)) {
        startEl = lastClickedElement;
    } else {
        startEl = container.querySelector(`.tree-item[data-node-id="${startNodeId}"]`);
    }

    // 如果起始节点不在此卡片容器内，则不支持跨卡片范围选择，回退为单选当前节点
    if (!startEl) {
        toggleSelectItem(endNodeId, endEl);
        lastClickedNode = endNodeId;
        return;
    }

    const scope = container;
    const allNodes = Array.from(scope.querySelectorAll('.tree-item[data-node-id]'));

    const startIndex = allNodes.findIndex(n => n.dataset.nodeId === startNodeId);
    const endIndex = allNodes.findIndex(n => n.dataset.nodeId === endNodeId);

    if (startIndex === -1 || endIndex === -1) {
        toggleSelectItem(endNodeId, endEl);
        lastClickedNode = endNodeId;
        return;
    }

    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    // 计算当前范围内的节点集合
    const rangeNodeIds = new Set();
    for (let i = start; i <= end; i++) {
        const nodeId = allNodes[i].dataset.nodeId;
        if (nodeId) rangeNodeIds.add(nodeId);
    }

    // 更新该容器下的选择状态（支持扩大与收缩收回）
    allNodes.forEach(node => {
        const nodeId = node.dataset.nodeId;
        if (!nodeId) return;

        if (rangeNodeIds.has(nodeId)) {
            selectedNodes.add(nodeId);
            const existingMeta = selectedNodeMeta.get(nodeId);
            selectedNodeMeta.set(nodeId, {
                treeType: node.dataset.treeType || 'permanent',
                sectionId: node.dataset.sectionId || null,
                nodeType: node.dataset.nodeType || 'bookmark',
                cardKey: (node.closest('.permanent-bookmark-section, .temp-canvas-node') || {}).id || node.dataset.sectionId || null,
                selectionSource: existingMeta && existingMeta.selectionSource === 'manual' ? 'manual' : 'range'
            });
            document.querySelectorAll(`.tree-item[data-node-id="${nodeId}"]`).forEach(el => {
                el.classList.add('selected');
            });
        } else {
            if (selectionSnapshot && selectionSnapshot.has(nodeId)) {
                selectedNodes.add(nodeId);
                document.querySelectorAll(`.tree-item[data-node-id="${nodeId}"]`).forEach(el => {
                    el.classList.add('selected');
                });
            } else {
                selectedNodes.delete(nodeId);
                selectedNodeMeta.delete(nodeId);
                document.querySelectorAll(`.tree-item[data-node-id="${nodeId}"]`).forEach(el => {
                    el.classList.remove('selected');
                });
            }
        }
    });

    rememberBatchSelection(allNodes[end]);

    updateBatchToolbar();
    updateBatchPanelCount();

    ;
}

// 全选
function selectAll() {
    document.querySelectorAll('.tree-item[data-node-id]').forEach(node => {
        selectedNodes.add(node.dataset.nodeId);
        selectedNodeMeta.set(node.dataset.nodeId, {
            treeType: node.dataset.treeType || 'permanent',
            sectionId: node.dataset.sectionId || null,
            nodeType: node.dataset.nodeType || 'bookmark',
            cardKey: (node.closest('.permanent-bookmark-section, .temp-canvas-node') || {}).id || node.dataset.sectionId || null,
            selectionSource: 'select-all'
        });
        node.classList.add('selected');
    });

    const firstNode = document.querySelector('.tree-item[data-node-id]');
    rememberBatchSelection(firstNode);

    selectionSnapshot = new Set(selectedNodes); // 更新范围选择快照

    updateBatchToolbar();
    updateBatchPanelCount();

    ;
}

// 取消全选
function deselectAll() {
    document.querySelectorAll('.tree-item[data-node-id]').forEach(node => {
        node.classList.remove('selected');
    });
    selectedNodes.clear();
    selectedNodeMeta.clear();
    lastBatchSelectionInfo = null;
    lastClickedNode = null;
    lastClickedElement = null;
    selectionSnapshot.clear();

    updateBatchToolbar();
    updateBatchPanelCount();

    ;
}

// 打开选中的书签
async function openSelectedBookmarks() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const permanentIds = getSelectedPermanentNodeIds();
        const tempNodes = getSelectedTempNodes();
        const urlSet = new Set();
        if (permanentIds.length) {
            const permanentUrls = await getSelectedUrls(permanentIds);
            permanentUrls.forEach(url => urlSet.add(url));
        }
        tempNodes.forEach(node => {
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(url => urlSet.add(url));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
        const urls = Array.from(urlSet);

        if (urls.length === 0) {
            const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
            alert(lang === 'zh_CN' ? '没有选中书签' : 'No bookmarks selected');
            return;
        }

        // 打开所有URL，传入来源映射
        const urlToScopeMap = await buildSelectionUrlToScopeMap();
        await openUrlList(urls, {}, urlToScopeMap);
    } catch (error) {
        console.error('[多选] 打开失败:', error);
    }
}

// 在新标签页组中打开选中的书签
async function openSelectedInTabGroup() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    try {
        const permanentIds = getSelectedPermanentNodeIds();
        const tempNodes = getSelectedTempNodes();
        const urlSet = new Set();
        if (permanentIds.length) {
            const permanentUrls = await getSelectedUrls(permanentIds);
            permanentUrls.forEach(url => urlSet.add(url));
        }
        tempNodes.forEach(node => {
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(url => urlSet.add(url));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
        const urls = Array.from(urlSet);

        if (urls.length === 0) {
            const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
            alert(lang === 'zh_CN' ? '没有选中书签' : 'No bookmarks selected');
            return;
        }

        const urlToScopeMap = await buildSelectionUrlToScopeMap();
        await openUrlList(urls, { tabGroup: true }, urlToScopeMap);
    } catch (error) {
        console.error('[多选] 打开失败:', error);
        const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 剪切选中的项
async function cutSelected() {
    await batchCut();
}

// 复制选中的项
async function copySelected() {
    const tempNodes = getSelectedTempNodes();
    const permanentIds = getSelectedPermanentNodeIds();
    if (!tempNodes.length && !permanentIds.length) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '没有选中的项目' : 'No items selected');
        return;
    }

    // 临时节点允许跨栏目复制：聚合为统一 payload
    const tempPayload = [];
    if (tempNodes.length) {
        const manager = getTempManager();
        if (manager && typeof manager.extractPayload === 'function') {
            const sectionGroups = new Map();
            tempNodes.forEach((node) => {
                if (!node || !node.sectionId || !node.id) return;
                if (!sectionGroups.has(node.sectionId)) sectionGroups.set(node.sectionId, []);
                sectionGroups.get(node.sectionId).push(node.id);
            });
            sectionGroups.forEach((ids, sectionId) => {
                try {
                    const p = manager.extractPayload(sectionId, ids);
                    if (p && p.length) tempPayload.push(...p);
                } catch (_) { }
            });
        }
    }

    // 混合选择：统一用 payload（title/url/type/children）形式，便于粘贴到永久/临时
    if (tempNodes.length && permanentIds.length) {
        try {
            await __ctxEnsurePermanentMetadataLoaded();
            const payload = markClipboardPayloadSource(tempPayload, 'temporary');
            for (const nodeId of permanentIds) {
                const node = await readPermanentNodeForPayload(nodeId);
                if (node) {
                    payload.push(...markClipboardPayloadSource([serializeBookmarkNode(node)], 'permanent'));
                }
            }
            setBookmarkClipboardState({
                action: 'copy',
                source: 'mixed',
                payload,
                timestamp: Date.now()
            });
            unmarkCutNode();
            flashBatchActionStatus('batch-copy');
        } catch (error) {
            console.error('[多选] 复制失败:', error);
        }
        return;
    }

    if (tempNodes.length) {
        setBookmarkClipboardState({
            action: 'copy',
            source: 'temporary',
            payload: tempPayload,
            timestamp: Date.now()
        });
        unmarkCutNode();
        flashBatchActionStatus('batch-copy');
        return;
    }

    try {
        await __ctxEnsurePermanentMetadataLoaded();
        const payload = [];
        for (const nodeId of permanentIds) {
            const node = await readPermanentNodeForPayload(nodeId);
            if (node) {
                payload.push(serializeBookmarkNode(node));
            }
        }
        setBookmarkClipboardState({
            action: 'copy',
            source: 'permanent',
            nodeIds: permanentIds,
            payload,
            timestamp: Date.now()
        });
        unmarkCutNode();
        flashBatchActionStatus('batch-copy');
        ;
    } catch (error) {
        console.error('[多选] 复制失败:', error);
    }
}

// 删除选中的项
async function deleteSelected() {
    await batchDelete();
}

// 构建当前选中节点到它们对应的来源 scope 映射的辅助函数
async function buildSelectionUrlToScopeMap() {
    const urlToScopeMap = {};
    try {
        const permanentIds = getSelectedPermanentNodeIds();
        const tempNodes = getSelectedTempNodes();

        // 1. 映射临时栏目节点
        for (const node of tempNodes) {
            if (!node) continue;
            const nodeScope = getScopeFromContext({
                treeType: 'temporary',
                sectionId: node.sectionId,
                node: node.element
            });
            if (node.isFolder) {
                const folderUrls = collectTempUrls(node.sectionId, node.id);
                folderUrls.forEach(u => {
                    if (u) urlToScopeMap[u] = nodeScope;
                });
            } else if (node.url) {
                urlToScopeMap[node.url] = nodeScope;
            }
        }

        // 2. 映射永久栏目节点
        for (const nodeId of permanentIds) {
            const element = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
            const nodeContext = {
                treeType: 'permanent',
                node: element,
                permanentCopyId: element ? (element.dataset.permanentCopyId || element.dataset.permanentSectionCopyId) : null,
                permanentDisplayIndex: element ? element.dataset.permanentDisplayIndex : null
            };
            const nodeScope = getScopeFromContext(nodeContext);
            const isFolder = element ? (element.dataset.nodeType === 'folder') : false;
            if (isFolder) {
                const folderUrls = await getAllUrlsFromFolder(nodeId);
                folderUrls.forEach(u => {
                    if (u) urlToScopeMap[u] = nodeScope;
                });
            } else {
                try {
                    const [node] = await chrome.bookmarks.get(nodeId);
                    if (node && node.url) {
                        urlToScopeMap[node.url] = nodeScope;
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[批量选择] 构建 URL 来源映射失败:', e);
    }
    return urlToScopeMap;
}

// 获取选中节点的所有URL
async function getSelectedUrls(nodeIdList) {
    const urls = [];
    const ids = nodeIdList || Array.from(selectedNodes);

    for (const nodeId of ids) {
        try {
            const [node] = await chrome.bookmarks.get(nodeId);
            if (node.url) {
                urls.push(node.url);
            } else {
                // 如果是文件夹，递归获取
                const folderUrls = await getAllUrlsFromFolder(nodeId);
                urls.push(...folderUrls);
            }
        } catch (error) {
            console.error('[多选] 获取URL失败:', nodeId, error);
        }
    }

    return urls;
}

// 刷新书签树（批量操作后专用，不显示变更标记）
async function refreshBookmarkTree() {
    ;

    if (typeof renderTreeView === 'function') {
        await renderTreeView(true);
    } else {
        console.warn('[批量操作] renderTreeView 函数不存在');
    }
}

// ==================== Select模式 ====================

// 进入Select模式
function enterSelectMode() {
    selectMode = true;

    lastClickedNode = null;
    lastClickedElement = null;
    selectionSnapshot.clear();

    // 重置画布上的 Ctrl/Space/平移 状态，避免处于卡死状态
    try {
        if (window.CanvasModule && typeof window.CanvasModule.resetCanvasCtrlState === 'function') {
            window.CanvasModule.resetCanvasCtrlState();
        }
    } catch (e) {
        console.error('[Select模式] 进入时重置画布状态失败:', e);
    }

    // 显示全局蓝框和提示
    showSelectModeOverlay();
    bindSelectModeGlobalHandlers();

    // 隐藏顶部工具栏
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
        ;
    }

    // 更新批量工具栏（但不显示，因为我们要显示批量菜单）
    updateBatchToolbar();

    // 关闭右键菜单
    hideContextMenu();

    // 收起状态会在下次进入选择模式时保留，使用恢复图标提示用户展开面板。
    if (isBatchPanelMinimized()) {
        setTimeout(() => {
            if (selectMode) showBatchPanelRestoreButton({ attention: true });
        }, 100);
        return;
    }

    setTimeout(() => {
        const fakeEvent = { preventDefault: () => { }, stopPropagation: () => { } };
        showBatchContextMenu(fakeEvent);
        ;
    }, 100);

    ;
}

// 退出Select模式
function exitSelectMode() {
    hideBatchPanelRestoreButton();
    selectMode = false;
    unbindSelectModeGlobalHandlers();

    // 隐藏蓝框
    hideSelectModeOverlay();

    // 隐藏批量操作面板
    hideBatchActionPanel();

    // 关闭说明弹窗
    try { hideBatchHelpPopover(); } catch (_) { }

    // 清空选中
    deselectAll();
    updateBatchToolbar();
    cancelPendingBookmarkCut();

    lastClickedNode = null;
    lastClickedElement = null;
    selectionSnapshot.clear();

    // 重置画布上的 Ctrl 状态，恢复正常缩放/平移操作，防止按键由于失焦导致未触发 keyup
    try {
        if (window.CanvasModule && typeof window.CanvasModule.resetCanvasCtrlState === 'function') {
            window.CanvasModule.resetCanvasCtrlState();
        }
    } catch (e) {
        console.error('[Select模式] 退出时重置画布状态失败:', e);
    }

    ;
}

// 隐藏批量操作面板
function hideBatchActionPanel() {
    hideBatchPanelRestoreButton();
    cancelPendingBookmarkCut();
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        batchPanel.style.display = 'none';
        ;
    }
    // 关闭说明弹窗
    try { hideBatchHelpPopover(); } catch (_) { }
}

// 显示Select模式蓝框（不再显示顶部提示）
function showSelectModeOverlay() {
    // 兼容旧版本的单一蓝框（若存在则移除）
    try {
        const legacy = document.getElementById('select-mode-overlay');
        if (legacy) legacy.remove();
    } catch (_) { }

    const refresh = () => {
        // 优先：书签画布上的“栏目卡片”分别套蓝框（可随卡片尺寸变化自动跟随）
        let targets = Array.from(document.querySelectorAll('.permanent-bookmark-section, .temp-canvas-node'));

        // 回退：传统书签树（无画布/无栏目卡片时）
        if (!targets.length) {
            const fallback = [
                document.getElementById('bookmarkTree'),
                document.querySelector('.bookmark-tree'),
                document.querySelector('.tree-view-container')
            ].filter(Boolean);
            if (fallback[0]) targets = [fallback[0]];
        }

        targets.forEach((container) => {
            if (!container) return;
            try {
                const position = window.getComputedStyle(container).position;
                if (position === 'static') container.style.position = 'relative';
            } catch (_) { }

            let overlay = container.querySelector('.select-mode-overlay[data-select-mode-overlay="true"]');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'select-mode-overlay';
                overlay.dataset.selectModeOverlay = 'true';
                overlay.style.pointerEvents = 'none';
                container.appendChild(overlay);
            }
            overlay.style.display = 'block';
        });
    };

    refresh();

    if (!selectModeOverlayObserver) {
        try {
            const root = document.getElementById('canvasContent') || document.getElementById('canvasWorkspace') || document.body;
            selectModeOverlayObserver = new MutationObserver(() => {
                if (!selectMode) return;
                refresh();
            });
            selectModeOverlayObserver.observe(root, { childList: true, subtree: true });
        } catch (_) {
            selectModeOverlayObserver = null;
        }
    }
}

// 隐藏Select模式蓝框
function hideSelectModeOverlay() {
    try {
        document.querySelectorAll('.select-mode-overlay[data-select-mode-overlay="true"]').forEach((overlay) => {
            overlay.style.display = 'none';
        });
    } catch (_) { }
    try {
        const legacy = document.getElementById('select-mode-overlay');
        if (legacy) legacy.style.display = 'none';
    } catch (_) { }

    if (selectModeOverlayObserver) {
        try { selectModeOverlayObserver.disconnect(); } catch (_) { }
        selectModeOverlayObserver = null;
    }
}

// 显示批量操作固定面板
function showBatchContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    setBatchPanelMinimized(false);
    hideBatchPanelRestoreButton();

    ;

    let anchorInfo = resolveBatchPanelAnchorInfo(e);
    if (!anchorInfo) {
        anchorInfo = {
            treeType: 'permanent',
            sectionId: PERMANENT_SECTION_ANCHOR_ID,
            element: findBatchPanelColumnElement('permanent', PERMANENT_SECTION_ANCHOR_ID)
        };
    }
    currentBatchPanelAnchorInfo = anchorInfo;
    const anchorKey = getBatchPanelAnchorKey(anchorInfo);

    // 检查是否已存在批量面板
    let batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        // 如果已存在，只需确保显示
        hideBatchPanelRestoreButton();
        batchPanel.style.display = 'block';
        if (batchPanel.parentNode !== getOverlayContainer()) {
            getOverlayContainer().appendChild(batchPanel);
        }
        batchPanel.dataset.anchorKey = anchorKey;
        batchPanel.dataset.treeType = anchorInfo.treeType || 'permanent';
        if (anchorInfo.sectionId) {
            batchPanel.dataset.sectionId = anchorInfo.sectionId;
        } else {
            delete batchPanel.dataset.sectionId;
        }
        restoreBatchPanelState(batchPanel, anchorInfo);
        try { updateBatchPanelCount(); } catch (_) { }
        ;
        return;
    }

    // 创建固定位置的批量操作面板
    batchPanel = document.createElement('div');
    batchPanel.id = 'batch-action-panel';
    batchPanel.className = 'batch-action-panel vertical-batch-layout'; // 默认纵向布局
    batchPanel.dataset.anchorKey = anchorKey;
    batchPanel.dataset.treeType = anchorInfo.treeType || 'permanent';
    if (anchorInfo.sectionId) {
        batchPanel.dataset.sectionId = anchorInfo.sectionId;
    }

    const lang = currentLang || 'zh_CN';

    const caps = getBatchSelectionCapabilities();
    const cutDisabled = caps.mixed || (caps.hasTemp && !caps.tempAllSameSection);
    const mergeDisabled = isBatchMergeDisabled(caps);

    // 构建批量菜单 - 分组显示（简化版本）
        const itemGroups = [
        // 打开组
        {
            name: lang === 'zh_CN' ? '打开' : 'Open',
            items: [
                { action: 'batch-open', label: lang === 'zh_CN' ? '此窗口打开' : 'This Window', icon: 'folder-open' },
                { action: 'batch-open-tab-group', label: lang === 'zh_CN' ? '标签组' : 'Group', icon: 'object-group' },
                { action: 'batch-open-new-window', label: lang === 'zh_CN' ? '新窗口' : 'Window', icon: 'window-maximize' },
                {
                    action: 'batch-open-manual-selection',
                    labelHTML: `<span>${lang === 'zh_CN' ? '手动选择' : 'Manual Select'}<span class="sub-badge" data-sub-action="batch-open-manual-selection-template-run">${lang === 'zh_CN' ? '模版' : 'Template'}</span></span>`,
                    label: lang === 'zh_CN' ? '手动选择' : 'Manual Select',
                    icon: 'crosshairs'
                },
                { action: 'batch-to-temp-section', label: lang === 'zh_CN' ? '临时栏目' : 'To Temp', icon: 'layer-group' },
                { action: 'batch-merge-folder', label: lang === 'zh_CN' ? '合并' : 'Merge', icon: 'folder-plus', disabled: mergeDisabled }
            ]
        },
        // 编辑组
        {
            name: lang === 'zh_CN' ? '编辑' : 'Edit',
            items: [
                { action: 'batch-copy', label: lang === 'zh_CN' ? '复制' : 'Copy', icon: 'copy' },
                { action: 'batch-cut', label: lang === 'zh_CN' ? '剪切' : 'Cut', icon: 'cut', disabled: cutDisabled },
                { action: 'batch-delete', label: lang === 'zh_CN' ? '删除' : 'DELETE', icon: 'trash-alt' },
                { action: 'batch-rename', label: lang === 'zh_CN' ? '改名' : 'Rename', icon: 'edit' },
                { action: 'batch-add-tags', label: lang === 'zh_CN' ? '标签' : 'Tags', icon: 'hashtag' },
                { action: 'batch-clear-tags', label: lang === 'zh_CN' ? '清除标签' : 'Clear Tags', icon: 'times-circle' },
                { action: 'batch-edit-note', label: lang === 'zh_CN' ? '编辑笔记' : 'Edit Notes', icon: 'sticky-note' },
                { action: 'batch-clear-note', label: lang === 'zh_CN' ? '清除笔记' : 'Clear Notes', icon: 'eraser' }
            ]
        },
        // 导出组
        {
            name: lang === 'zh_CN' ? '导出' : 'Export',
            items: [
                { action: 'batch-export-html', label: 'HTML', icon: 'file-code' },
                { action: 'batch-export-json', label: 'JSON', icon: 'file-alt' }
            ]
        },
        // 控制组
        {
            name: lang === 'zh_CN' ? '控制' : 'Control',
            items: [
                { action: 'toggle-batch-layout', label: lang === 'zh_CN' ? '横向/纵向' : 'Horiz/Vert', icon: 'exchange-alt' },

            ]
        }
    ];

    // 读全局布局偏好（无特定栏目保存状态时使用）
    try {
        batchPanelHorizontal = getStoredBatchPanelLayout() === 'horizontal';
    } catch (_) { }

    batchPanel.innerHTML = `
        <div class="batch-panel-header" id="batch-panel-header">
            <span class="batch-panel-title" title="${lang === 'zh_CN' ? '拖动移动窗口' : 'Drag to move'}">${lang === 'zh_CN' ? '批量操作' : 'Batch Actions'}</span>
            <button class="batch-panel-hide-btn" type="button" title="${lang === 'zh_CN' ? '收起批量操作面板' : 'Collapse batch panel'}" aria-label="${lang === 'zh_CN' ? '收起批量操作面板' : 'Collapse batch panel'}"><i class="fas fa-compress"></i></button>
            <button class="batch-panel-help-btn" type="button" data-action="batch-help" title="${lang === 'zh_CN' ? '说明' : 'Help'}">?</button>
            <button class="batch-panel-cancel-btn" type="button" title="${lang === 'zh_CN' ? '取消全部选择' : 'Clear all selection'}">${lang === 'zh_CN' ? '取消' : 'Clear'}</button>
            <button class="batch-panel-exit-btn" type="button" data-action="exit-select-mode" aria-label="${lang === 'zh_CN' ? '退出Select模式' : 'Exit Select Mode'}" title="${lang === 'zh_CN' ? '退出Select模式' : 'Exit Select Mode'}">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="batch-panel-resize-handles">
            <div class="resize-handle resize-n" data-direction="n"></div>
            <div class="resize-handle resize-s" data-direction="s"></div>
            <div class="resize-handle resize-w" data-direction="w"></div>
            <div class="resize-handle resize-e" data-direction="e"></div>
            <div class="resize-handle resize-nw" data-direction="nw"></div>
            <div class="resize-handle resize-ne" data-direction="ne"></div>
            <div class="resize-handle resize-sw" data-direction="sw"></div>
            <div class="resize-handle resize-se" data-direction="se"></div>
        </div>
        <div class="batch-panel-content">
            ${itemGroups.map((group, groupIndex) => {
        const groupItems = group.items.map(item => {
            const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
            const exitClass = item.isExit ? 'exit-item' : '';
            const disabledClass = item.disabled ? 'disabled' : '';
            return `
                        <div class="context-menu-item ${exitClass} ${disabledClass}" data-action="${item.action}">
                            ${icon}
                            ${item.labelHTML ? item.labelHTML : `<span>${item.label}</span>`}
                        </div>
                    `;
        }).join('');

        return `
                    <div class="batch-menu-group" data-group="${group.name}">
                        <div class="batch-group-label">${group.name}</div>
                        <div class="batch-group-items">
                            ${groupItems}
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;

    // 绑定点击事件
    batchPanel.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (item.classList && item.classList.contains('disabled')) return;
            const action = item.dataset.action;
            ;

            if (action === 'exit-select-mode') {
                exitSelectMode();
            } else if (action === 'toggle-batch-layout') {
                toggleBatchPanelLayout();
            } else if (action === 'batch-open') {
                await batchOpen();
            } else if (action === 'batch-open-tab-group') {
                await batchOpenTabGroup();
            } else if (action === 'batch-open-new-window') {
                await batchOpenNewWindow();
            } else if (action === 'batch-open-manual-selection') {
                await batchOpenWithManualSelection();
            } else if (action === 'batch-to-temp-section') {
                await batchToTempSection(e);
            } else if (action === 'batch-copy') {
                await copySelected();
            } else if (action === 'batch-cut') {
                await batchCut();
            } else if (action === 'batch-delete') {
                await batchDelete();
            } else if (action === 'batch-rename') {
                await batchRename();
            } else if (action === 'batch-export-html') {
                await batchExportHTML();
            } else if (action === 'batch-export-json') {
                await batchExportJSON();
            } else if (action === 'batch-merge-folder') {
                await batchMergeFolder();
            } else if (action === 'batch-add-tags') {
                await openTagPopoverForContext('batch-add-tags', null, item);
            } else if (action === 'batch-clear-tags') {
                await clearTagsForContext('batch-clear-tags', null);
            } else if (action === 'batch-edit-note') {
                await editNotesForContext('batch-edit-note', null);
            } else if (action === 'batch-clear-note') {
                await clearNotesForContext('batch-clear-note', null);
            } else {
                // 其他操作通过handleMenuAction处理（需要context）
                await handleMenuAction(action, null, null, null, false);
            }
        });
    });

    // 绑定 sub-badge 点击事件
    batchPanel.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const subAction = badge.dataset.subAction;
            ;
            if (subAction === 'batch-open-manual-selection-template-run') {
                await batchOpenWithManualSelectionTemplateRun();
            }
        });
    });

    // 绑定标题栏退出按钮事件
    const headerExitBtn = batchPanel.querySelector('.batch-panel-exit-btn');
    if (headerExitBtn) {
        headerExitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                exitSelectMode();
            } catch (_) {
                // 兜底：显式关闭面板与蓝框并清空选择并重置画布 Ctrl 状态
                try { selectMode = false; } catch (_) { }
                try { unbindSelectModeGlobalHandlers(); } catch (_) { }
                try { hideBatchActionPanel(); } catch (_) { }
                try { hideSelectModeOverlay(); } catch (_) { }
                try { if (typeof deselectAll === 'function') deselectAll(); } catch (_) { }
                try { cancelPendingBookmarkCut(); } catch (_) { }
                try { updateBatchToolbar(); } catch (_) { }
                try {
                    if (window.CanvasModule && typeof window.CanvasModule.resetCanvasCtrlState === 'function') {
                        window.CanvasModule.resetCanvasCtrlState();
                    }
                } catch (_) { }
            }
            ;
        });
    }

    // 绑定独立的取消选择按钮事件
    const countCancelBtn = batchPanel.querySelector('.batch-panel-cancel-btn');
    if (countCancelBtn) {
        countCancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            ;
            if (typeof deselectAll === 'function') {
                deselectAll();
            }
        });
    }

    const headerHideBtn = batchPanel.querySelector('.batch-panel-hide-btn');
    if (headerHideBtn) {
        headerHideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            minimizeBatchPanel();
        });
    }

    // 标题栏帮助按钮
    const headerHelpBtn = batchPanel.querySelector('.batch-panel-help-btn');
    if (headerHelpBtn) {
        headerHelpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBatchHelpPopover();
        });
    }

    // 添加拖拽移动功能
    initBatchPanelDrag(batchPanel);

    // 添加调整大小功能（四边和四角）
    initBatchPanelResize(batchPanel);

    // 添加窗口大小变化监听器（用于横向布局自适应）
    initBatchPanelWindowResize(batchPanel);

    // 始终挂载到 body，避免祖先 transform 影响定位
    if (batchPanel.parentNode !== getOverlayContainer()) {
        getOverlayContainer().appendChild(batchPanel);
        ;
    }

    // 恢复保存的位置和大小，或设置初始定位
    restoreBatchPanelState(batchPanel, anchorInfo);
}

// ==================== 批量操作功能 ====================

// 切换选择单个项目
function toggleSelectItem(nodeId, nodeElement) {
    if (!nodeElement) {
        nodeElement = document.querySelector(`.tree-item[data-node-id="${nodeId}"]`);
    }

    const nodeElements = Array.from(document.querySelectorAll(`.tree-item[data-node-id="${nodeId}"]`));
    const referenceEl = nodeElement || nodeElements[0] || null;
    if (!referenceEl) {
        ;
        return;
    }

    lastClickedElement = referenceEl;

    const treeType = referenceEl.dataset.treeType || 'permanent';

    if (selectedNodes.has(nodeId)) {
        const existingMeta = selectedNodeMeta.get(nodeId);
        selectedNodes.delete(nodeId);
        selectedNodeMeta.delete(nodeId);
        nodeElements.forEach(el => el.classList.remove('selected'));
        ;
        if (selectedNodes.size === 0) {
            lastBatchSelectionInfo = null;
        }
    } else {
        selectedNodes.add(nodeId);
        const meta = {
            treeType,
            sectionId: referenceEl.dataset.sectionId || null,
            nodeType: referenceEl.dataset.nodeType || 'bookmark',
            cardKey: (referenceEl.closest('.permanent-bookmark-section, .temp-canvas-node') || {}).id || referenceEl.dataset.sectionId || null,
            selectionSource: 'manual'
        };
        if (treeType === 'permanent') {
            meta.sectionId = PERMANENT_SECTION_ANCHOR_ID;
        }
        selectedNodeMeta.set(nodeId, meta);
        nodeElements.forEach(el => el.classList.add('selected'));
        rememberBatchSelection(referenceEl);
        ;
    }

    selectionSnapshot = new Set(selectedNodes); // 更新范围选择快照

    updateBatchToolbar();
    updateBatchPanelCount(); // 实时更新批量面板计数
    ;
}

// 批量打开
async function batchOpen() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();

    const urlSet = new Set();
    if (permanentIds.length) {
        const permanentUrls = await getSelectedUrls(permanentIds);
        permanentUrls.forEach(u => urlSet.add(u));
    }
    if (tempNodes.length) {
        tempNodes.forEach((node) => {
            if (!node) return;
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(u => urlSet.add(u));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
    }
    const urls = Array.from(urlSet);

    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    if (urls.length > 10) {
        const message = lang === 'zh_CN'
            ? `确定要打开 ${urls.length} 个书签吗？`
            : `Open ${urls.length} bookmarks?`;
        if (!confirm(message)) return;
    }

    const urlToScopeMap = await buildSelectionUrlToScopeMap();
    for (const url of urls) {
        const tab = await chrome.tabs.create({ url: url, active: false });
        if (tab && tab.id != null) {
            const scope = urlToScopeMap[url];
            if (scope) {
                const prefix = scope.prefix || '';
                const titleText = scope.title || '';
                const label = (prefix && titleText) ? `${prefix} - ${titleText}` : (prefix || titleText || '');
                if (label) {
                    await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                }
            }
        }
    }
}

// 批量打开（新窗口）
async function batchOpenNewWindow() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();
    const urlSet = new Set();
    if (permanentIds.length) {
        const permanentUrls = await getSelectedUrls(permanentIds);
        permanentUrls.forEach(u => urlSet.add(u));
    }
    if (tempNodes.length) {
        tempNodes.forEach((node) => {
            if (!node) return;
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(u => urlSet.add(u));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
    }
    const urls = Array.from(urlSet);
    const urlToScopeMap = await buildSelectionUrlToScopeMap();
    await openUrlList(urls, { newWindow: true }, urlToScopeMap);
}

// 批量打开（标签页组）
async function batchOpenTabGroup() {
    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();

    const urlSet = new Set();
    if (permanentIds.length) {
        const permanentUrls = await getSelectedUrls(permanentIds);
        permanentUrls.forEach(u => urlSet.add(u));
    }
    if (tempNodes.length) {
        tempNodes.forEach((node) => {
            if (!node) return;
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(u => urlSet.add(u));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
    }
    const urls = Array.from(urlSet);

    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    try {
        const urlToScopeMap = await buildSelectionUrlToScopeMap();
        // 创建标签页
        const tabIds = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url: url, active: false });
            if (tab && tab.id != null) {
                tabIds.push(tab.id);
                const scope = urlToScopeMap[url];
                if (scope) {
                    const prefix = scope.prefix || '';
                    const titleText = scope.title || '';
                    const label = (prefix && titleText) ? `${prefix} - ${titleText}` : (prefix || titleText || '');
                    if (label) {
                        await saveTabSourceLabel(tab.id, { text: label, color: scope.color || '' });
                    }
                }
            }
        }

        // 创建标签页组
        if (chrome.tabs.group) {
            const groupId = await chrome.tabs.group({ tabIds: tabIds });

            if (chrome.tabGroups) {
                await chrome.tabGroups.update(groupId, {
                    title: lang === 'zh_CN' ? `选中的书签 (${urls.length})` : `Selected (${urls.length})`,
                    collapsed: false
                });
            }
        }
    } catch (error) {
        console.error('[批量] 打开失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 批量选择 -> 生成一个新的临时栏目（将选中项加入该栏目）
async function batchToTempSection(triggerEvent) {
    const lang = currentLang || 'zh_CN';
    const canvas = window.CanvasModule;
    const workspace = document.getElementById('canvasWorkspace');
    if (!canvas || !workspace || typeof canvas.createTempNode !== 'function') {
        alert(lang === 'zh_CN' ? '该功能需要在「书签画布」中使用' : 'This action requires Bookmark Canvas');
        return;
    }

    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();
    if (!permanentIds.length && !tempNodes.length) {
        alert(lang === 'zh_CN' ? '没有选中的项目' : 'No items selected');
        return;
    }

    const state = canvas.CanvasState || window.CanvasState || {};
    const zoom = (typeof state.zoom === 'number' && state.zoom > 0) ? state.zoom : 1;
    const panX = (typeof state.panOffsetX === 'number') ? state.panOffsetX : 0;
    const panY = (typeof state.panOffsetY === 'number') ? state.panOffsetY : 0;
    const workspaceRect = workspace.getBoundingClientRect();

    const computeCanvasPoint = (clientX, clientY) => {
        return {
            x: (clientX - workspaceRect.left - panX) / zoom,
            y: (clientY - workspaceRect.top - panY) / zoom
        };
    };

    let clientX = (triggerEvent && typeof triggerEvent.clientX === 'number') ? triggerEvent.clientX : null;
    let clientY = (triggerEvent && typeof triggerEvent.clientY === 'number') ? triggerEvent.clientY : null;

    const inWorkspace = (x, y) => (
        typeof x === 'number' && typeof y === 'number' &&
        x >= workspaceRect.left && x <= workspaceRect.right &&
        y >= workspaceRect.top && y <= workspaceRect.bottom
    );

    if (!inWorkspace(clientX, clientY)) {
        // 优先靠近当前栏目卡片（批量面板锚点/最近一次选择所属栏目）
        let anchorInfo = null;
        try {
            anchorInfo = resolveBatchPanelAnchorInfo(triggerEvent) || getBatchPanelAnchorInfoFromSelection();
        } catch (_) { }
        const anchorEl = anchorInfo && anchorInfo.element
            ? anchorInfo.element
            : (anchorInfo ? findBatchPanelColumnElement(anchorInfo.treeType, anchorInfo.sectionId) : null);
        if (anchorEl) {
            const r = anchorEl.getBoundingClientRect();
            clientX = Math.min(workspaceRect.right - 24, r.right + 24);
            clientY = Math.min(workspaceRect.bottom - 24, r.top + 80);
        } else {
            clientX = workspaceRect.left + workspaceRect.width / 2;
            clientY = workspaceRect.top + workspaceRect.height / 2;
        }
    }

    const { x: canvasX, y: canvasY } = computeCanvasPoint(clientX, clientY);

    const sectionLabel = lang === 'zh_CN' ? '批量' : 'Batch';
    const sectionTitle = formatTimestampForTitle();

    const resolvePermanentOriginMeta = () => {
        try {
            // 最高优先级：最近一次点击的永久栏目（能区分副本）
            try {
                const clickedElement = lastClickedElement;
                const permanentSection = clickedElement && clickedElement.closest
                    ? clickedElement.closest('.permanent-bookmark-section')
                    : null;
                if (permanentSection) {
                    const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionContext === 'function'
                        ? window.CanvasProtocolBridge
                        : null;
                    const context = protocolBridge
                        ? protocolBridge.resolvePermanentSectionContext(permanentSection)
                        : null;
                    if (context) {
                        if (!context.isCopy) return { copyId: null };
                        const out = { copyId: context.copyId || null };
                        if (context.displayIndex) out.displayIndex = context.displayIndex;
                        return out;
                    }
                    const isCopy = permanentSection.classList && permanentSection.classList.contains('permanent-section-copy');
                    if (!isCopy) return { copyId: null };
                    const copyId = (permanentSection.dataset && permanentSection.dataset.permanentSectionCopyId)
                        ? String(permanentSection.dataset.permanentSectionCopyId)
                        : null;
                    const idx = (permanentSection.dataset && permanentSection.dataset.permanentSectionDisplayIndex)
                        ? parseInt(permanentSection.dataset.permanentSectionDisplayIndex, 10)
                        : null;
                    const out = { copyId: copyId || null };
                    if (Number.isFinite(idx) && idx > 0) out.displayIndex = idx;
                    return out;
                }
            } catch (_) { }

            let anchorInfo = null;
            try {
                anchorInfo = resolveBatchPanelAnchorInfo(triggerEvent) || getBatchPanelAnchorInfoFromSelection();
            } catch (_) { }
            const el = anchorInfo && anchorInfo.element
                ? anchorInfo.element
                : (anchorInfo ? findBatchPanelColumnElement(anchorInfo.treeType, anchorInfo.sectionId) : null);

            const permanentSection = el && el.closest ? el.closest('.permanent-bookmark-section') : null;
            if (!permanentSection) return null;
            const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionContext === 'function'
                ? window.CanvasProtocolBridge
                : null;
            const context = protocolBridge
                ? protocolBridge.resolvePermanentSectionContext(permanentSection)
                : null;
            if (context) {
                if (!context.isCopy) return { copyId: null };
                const out = { copyId: context.copyId || null };
                if (context.displayIndex) out.displayIndex = context.displayIndex;
                return out;
            }
            const isCopy = permanentSection.classList && permanentSection.classList.contains('permanent-section-copy');
            if (!isCopy) return { copyId: null };
            const copyId = (permanentSection.dataset && permanentSection.dataset.permanentSectionCopyId)
                ? String(permanentSection.dataset.permanentSectionCopyId)
                : null;
            const idx = (permanentSection.dataset && permanentSection.dataset.permanentSectionDisplayIndex)
                ? parseInt(permanentSection.dataset.permanentSectionDisplayIndex, 10)
                : null;
            const out = { copyId: copyId || null };
            if (Number.isFinite(idx) && idx > 0) out.displayIndex = idx;
            return out;
        } catch (_) {
            return null;
        }
    };

    let newSectionId = null;
    try {
        if (permanentIds.length) {
            const permanentLabelContext = resolvePermanentOriginMeta();
            newSectionId = await canvas.createTempNode({
                source: 'permanent',
                multi: true,
                permanentIds,
                permanentCopyId: permanentLabelContext && permanentLabelContext.copyId,
                permanentDisplayIndex: permanentLabelContext && permanentLabelContext.displayIndex,
                permanentIsOriginal: !!(permanentLabelContext && !permanentLabelContext.copyId),
                title: sectionTitle,
                label: sectionLabel,
                tempKind: 'special',
                colorLocked: true,
                pinned: true
            }, canvasX, canvasY);
        } else if (typeof canvas.createEmptyTempSection === 'function') {
            newSectionId = canvas.createEmptyTempSection(canvasX, canvasY, {
                title: sectionTitle,
                label: sectionLabel,
                source: 'batch',
                tempKind: 'special',
                colorLocked: true,
                pinned: true
            });
        } else {
            // 兼容：若没有暴露创建空栏目 API，则用一个空 payload 的方式兜底
            newSectionId = await canvas.createTempNode({ multi: true, permanentIds: [] }, canvasX, canvasY);
        }
    } catch (error) {
        console.error('[批量->临时栏目] 创建失败:', error);
        alert((lang === 'zh_CN' ? '创建临时栏目失败: ' : 'Failed to create temp section: ') + error.message);
        return;
    }

    if (!newSectionId) return;

    try {
        const tempApi = canvas.temp;
        const section = tempApi && typeof tempApi.getSection === 'function'
            ? tempApi.getSection(newSectionId)
            : null;
        if (section) {
            section.source = 'batch';
            section.colorLocked = true;
        }
    } catch (_) { }

    // 将已选的临时栏目节点也加入新栏目（以 payload 方式复制进去）
    if (tempNodes.length && canvas.temp && typeof canvas.temp.extractPayload === 'function' && typeof canvas.temp.insertFromPayload === 'function') {
        const bySection = new Map();
        tempNodes.forEach((n) => {
            if (!n || !n.sectionId || !n.id) return;
            if (!bySection.has(n.sectionId)) bySection.set(n.sectionId, []);
            bySection.get(n.sectionId).push(n.id);
        });
        // 记录需要兜底刷新的栏目
        const __sectionsToRefresh = new Set();
        bySection.forEach((ids, sectionId) => {
            let moved = false;
            try {
                const payload = canvas.temp.extractPayload(sectionId, ids);
                if (payload && payload.length) {
                    canvas.temp.insertFromPayload(newSectionId, null, payload, null, { defaultCollapseFolders: true });
                    if (canvas.temp && typeof canvas.temp.removeItems === 'function') {
                        canvas.temp.removeItems(sectionId, ids);
                    }
                    moved = true;
                }
            } catch (error) {
                console.warn('[批量->临时栏目] 复制临时节点失败:', error);
            }
            // 兜底：extractPayload 返回空或异常时，刷新源栏目树确保项目仍可见
            if (!moved) {
                __sectionsToRefresh.add(sectionId);
            }
        });
        // 统一刷新需要兜底的源栏目
        if (__sectionsToRefresh.size > 0) {
            __sectionsToRefresh.forEach((sectionId) => {
                try {
                    const section = (typeof canvas.temp.getSection === 'function')
                        ? canvas.temp.getSection(sectionId)
                        : null;
                    if (section && typeof window.refreshTempSectionTreeInPlace === 'function') {
                        console.warn('[批量兜底] extractPayload 为空或异常，刷新源栏目:', sectionId);
                        window.refreshTempSectionTreeInPlace(section);
                    }
                } catch (_) { }
            });
        }
    }


    // 生成成功后自动退出批量选择模式
    try { exitSelectMode(); } catch (_) { }
}

/**
 * 批量打开（手动选择窗口/组 - 使用保存的模版配置）
 */
async function batchOpenWithManualSelectionTemplateRun() {
    ;

    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();

    if (!permanentIds.length && !tempNodes.length) {
        alert(lang === 'zh_CN' ? '没有选中任何书签或文件夹' : 'No bookmarks or folders selected');
        return;
    }

    // 获取所有选中的 URLs
    const urlSet = new Set();
    if (permanentIds.length) {
        const permanentUrls = await getSelectedUrls(permanentIds);
        permanentUrls.forEach(u => urlSet.add(u));
    }
    if (tempNodes.length) {
        tempNodes.forEach((node) => {
            if (!node) return;
            if (node.isFolder) {
                collectTempUrls(node.sectionId, node.id).forEach(u => urlSet.add(u));
            } else if (node.url) {
                urlSet.add(node.url);
            }
        });
    }
    const urls = Array.from(urlSet);

    if (urls.length === 0) {
        alert(lang === 'zh_CN' ? '没有可打开的书签' : 'No bookmarks to open');
        return;
    }

    // 调用 openFolderWithManualSelection 打开所有收集到的 URLs
    await openFolderWithManualSelection(urls, lang === 'zh_CN' ? '批量打开' : 'Batch Open', { isBatch: true });
}

// 批量打开（手动选择窗口/组）
async function batchOpenWithManualSelection() {
    ;

    if (!chrome || !chrome.tabs) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    // 获取所有选中项的详细信息（不针对URL，需要区分书签与文件夹）
    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();

    if (!permanentIds.length && !tempNodes.length) {
        alert(lang === 'zh_CN' ? '没有选中任何书签或文件夹' : 'No bookmarks or folders selected');
        return;
    }

    // 构建统一的手动选择 batchContext
    const batchContext = {
        isBatch: true,
        isFolder: true, // 批量操作以文件夹的形式提供打开全部/标签页组选项
        nodeTitle: lang === 'zh_CN' ? '批量打开' : 'Batch Open',
        getUrls: async () => {
            const urlSet = new Set();
            if (permanentIds.length) {
                const permanentUrls = await getSelectedUrls(permanentIds);
                permanentUrls.forEach(u => urlSet.add(u));
            }
            if (tempNodes.length) {
                tempNodes.forEach((node) => {
                    if (!node) return;
                    if (node.isFolder) {
                        collectTempUrls(node.sectionId, node.id).forEach(u => urlSet.add(u));
                    } else if (node.url) {
                        urlSet.add(node.url);
                    }
                });
            }
            return Array.from(urlSet);
        }
    };

    // 显示与文件夹右键一致的手动选择对话框
    await showManualWindowGroupSelector(batchContext);
}

/**
 * 显示批量手动选择窗口+组的选择器
 */
async function showBatchManualWindowGroupSelector(selectionInfo, lang) {
    try {
        lang = lang || currentLang || 'zh_CN';

        // 计算初始书签数量（单层模式）
        let initialCount = selectionInfo.bookmarks.length;
        for (const folder of selectionInfo.folders) {
            const urls = await getFolderUrls(folder, 1); // 单层
            initialCount += urls.length;
        }

        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'manual-selector-overlay';

        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'manual-selector-dialog';

        // 头部（包含层级选项）
        const header = document.createElement('div');
        header.className = 'manual-selector-header';
        header.innerHTML = `
            <h3>${lang === 'zh_CN' ? '批量打开 - 选择目标窗口/标签组' : 'Batch Open - Select Target Window/Group'}</h3>
            <div class="manual-selector-header-right">
                <span class="manual-selector-count" id="batch-bookmark-count">${initialCount} ${lang === 'zh_CN' ? '个书签' : 'bookmarks'}</span>
                ${selectionInfo.hasFolders ? `
                    <div class="manual-selector-depth-control">
                        <label class="manual-selector-depth-checkbox">
                            <input type="checkbox" id="include-subfolders-checkbox">
                            <span>${lang === 'zh_CN' ? '包含子文件夹' : 'Include subfolders'}</span>
                        </label>
                        <select id="depth-level-select" class="manual-selector-depth-select" disabled>
                            <option value="all">${lang === 'zh_CN' ? '全部层级' : 'All levels'}</option>
                            <option value="1">${lang === 'zh_CN' ? '1层' : '1 level'}</option>
                            <option value="2">${lang === 'zh_CN' ? '2层' : '2 levels'}</option>
                            <option value="3">${lang === 'zh_CN' ? '3层' : '3 levels'}</option>
                            <option value="4">${lang === 'zh_CN' ? '4层' : '4 levels'}</option>
                            <option value="5">${lang === 'zh_CN' ? '5层' : '5 levels'}</option>
                        </select>
                    </div>
                ` : ''}
                <button class="manual-selector-close">&times;</button>
            </div>
        `;

        // 内容区 - 使用DOM方式创建以便绑定帮助提示事件
        const body = document.createElement('div');
        body.className = 'manual-selector-body';

        // 左侧：窗口列表面板
        const windowPanel = document.createElement('div');
        windowPanel.className = 'manual-selector-panel';
        windowPanel.id = 'batch-window-panel';
        windowPanel.style.position = 'relative';
        windowPanel.innerHTML = `
            <div class="manual-selector-panel-title">
                <span>${lang === 'zh_CN' ? '窗口' : 'Windows'}</span>
                <span style="position: relative; display: inline-flex; align-items: center;">
                    <i class="fas fa-question-circle manual-selector-help-icon"></i>
                </span>
            </div>
            <div class="manual-selector-help-tooltip">
                <p>${lang === 'zh_CN'
                ? '「手动选择」具有记忆功能：选择目标窗口与标签组后，下次点击书签将在指定位置打开。'
                : 'Manual Selection has memory: choosing a target window and tab group will open bookmarks there in the future.'}</p>
                <p>${lang === 'zh_CN'
                ? '如果仅选择窗口而不选择标签组，书签将直接在窗口中追加打开。'
                : 'If you select only a window and no group, bookmarks will be opened inside that window subsequently.'}</p>
            </div>
            <div class="manual-selector-list" data-type="windows"></div>
        `;

        // 绑定帮助图标hover事件
        const helpIcon = windowPanel.querySelector('.manual-selector-help-icon');
        const helpTooltip = windowPanel.querySelector('.manual-selector-help-tooltip');

        // 动态计算箭头位置
        const updateArrowPosition = () => {
            const panelRect = windowPanel.getBoundingClientRect();
            const iconRect = helpIcon.getBoundingClientRect();
            const arrowOffset = iconRect.left - panelRect.left + (iconRect.width / 2);
            helpTooltip.style.setProperty('--arrow-offset', `${arrowOffset}px`);
        };

        helpIcon.addEventListener('mouseenter', () => {
            updateArrowPosition();
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpIcon.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        helpTooltip.addEventListener('mouseenter', () => {
            helpTooltip.style.opacity = '1';
            helpTooltip.style.visibility = 'visible';
        });

        helpTooltip.addEventListener('mouseleave', () => {
            helpTooltip.style.opacity = '0';
            helpTooltip.style.visibility = 'hidden';
        });

        // 右侧：标签组列表面板
        const groupPanel = document.createElement('div');
        groupPanel.className = 'manual-selector-panel';
        groupPanel.id = 'batch-group-panel';
        groupPanel.innerHTML = `
            <div class="manual-selector-panel-title">
                <span>${lang === 'zh_CN' ? '标签组' : 'Tab Groups'}</span>
                ${selectionInfo.hasFolders ? `
                    <span class="manual-selector-panel-hint" id="group-panel-hint">
                        ${lang === 'zh_CN' ? '(不选择则文件夹自动成组)' : '(Folders become groups if none selected)'}
                    </span>
                ` : ''}
            </div>
            <div class="manual-selector-list" data-type="groups"></div>
        `;

        // 创建panels容器并添加两个面板
        const panelsContainer = document.createElement('div');
        panelsContainer.className = 'manual-selector-panels';
        panelsContainer.appendChild(windowPanel);
        panelsContainer.appendChild(groupPanel);

        body.appendChild(panelsContainer);

        // 特色功能说明区域
        const featuresSection = document.createElement('div');
        featuresSection.className = 'manual-selector-features';
        featuresSection.innerHTML = `
            <div class="manual-selector-features-title">
                <i class="fas fa-lightbulb"></i>
                <span>${lang === 'zh_CN' ? '特色功能' : 'Features'}</span>
            </div>
            <div class="manual-selector-features-grid">
                <div class="manual-selector-feature-item">
                    <i class="fas fa-check-square"></i>
                    <span>${lang === 'zh_CN' ? '多选模式：右键 → 选择（批量操作），支持跨栏目多选' : 'Multi-select: Right-click → Select, supports cross-column selection'}</span>
                </div>
                <div class="manual-selector-feature-item">
                    <i class="fas fa-folder-open"></i>
                    <span>${lang === 'zh_CN' ? '文件夹智能分组：不选择标签组时，每个文件夹自动创建对应标签组' : 'Smart grouping: Each folder auto-creates its own tab group when none selected'}</span>
                </div>
                <div class="manual-selector-feature-item">
                    <i class="fas fa-sitemap"></i>
                    <span>${lang === 'zh_CN' ? '层级控制：可选择包含子文件夹，并控制递归深度' : 'Depth control: Include subfolders with customizable depth'}</span>
                </div>
                <div class="manual-selector-feature-item">
                    <i class="fas fa-window-restore"></i>
                    <span>${lang === 'zh_CN' ? '灵活目标：选择窗口+标签组，或仅选窗口让文件夹自动成组' : 'Flexible target: Choose window + group, or just window for auto-grouping'}</span>
                </div>
            </div>
        `;
        body.appendChild(featuresSection);

        // 底部
        const footer = document.createElement('div');
        footer.className = 'manual-selector-footer';
        footer.innerHTML = `
            <button class="manual-selector-btn manual-selector-btn-clear">${lang === 'zh_CN' ? '清除选择' : 'Clear'}</button>
            <button class="manual-selector-btn manual-selector-btn-cancel">${lang === 'zh_CN' ? '取消' : 'Cancel'}</button>
            <button class="manual-selector-btn manual-selector-btn-confirm">${lang === 'zh_CN' ? '打开' : 'Open'}</button>
        `;

        // 组装
        dialog.appendChild(header);
        dialog.appendChild(body);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);

        // 将overlay添加到全屏容器或body
        const canvasContainer = getOverlayContainer();
        canvasContainer.appendChild(overlay);

        // 存储批量选择的临时状态
        let batchSelectedWindowId = null;
        let batchSelectedGroupId = null;
        let includeSubfolders = false;
        let depthLevel = 'all';

        // 设置层级选择事件
        const checkbox = overlay.querySelector('#include-subfolders-checkbox');
        const depthSelect = overlay.querySelector('#depth-level-select');
        const countDisplay = overlay.querySelector('#batch-bookmark-count');

        const updateBookmarkCount = async () => {
            let count = selectionInfo.bookmarks.length;
            const depth = includeSubfolders ? (depthLevel === 'all' ? Infinity : parseInt(depthLevel)) : 1;

            for (const folder of selectionInfo.folders) {
                const urls = await getFolderUrls(folder, depth);
                count += urls.length;
            }

            countDisplay.textContent = `${count} ${lang === 'zh_CN' ? '个书签' : 'bookmarks'}`;
        };

        if (checkbox) {
            checkbox.addEventListener('change', async () => {
                includeSubfolders = checkbox.checked;
                if (depthSelect) {
                    depthSelect.disabled = !includeSubfolders;
                }
                await updateBookmarkCount();
            });
        }

        if (depthSelect) {
            depthSelect.addEventListener('change', async () => {
                depthLevel = depthSelect.value;
                await updateBookmarkCount();
            });
        }

        // 加载窗口和组列表
        await loadBatchWindowsAndGroups(overlay, lang, (windowId, groupId) => {
            batchSelectedWindowId = windowId;
            batchSelectedGroupId = groupId;
        });

        // 设置事件
        setupBatchSelectorEventsV2(overlay, selectionInfo, lang, () => ({
            windowId: batchSelectedWindowId,
            groupId: batchSelectedGroupId,
            includeSubfolders,
            depthLevel
        }));

    } catch (error) {
        console.error('[批量手动选择器] 创建失败:', error);
    }
}

/**
 * 获取文件夹的URL列表（支持层级限制）
 */
async function getFolderUrls(folder, maxDepth = 1) {
    const urls = [];

    if (folder.type === 'permanent') {
        await collectPermanentFolderUrls(folder.id, urls, 1, maxDepth);
    } else if (folder.type === 'temporary') {
        const tempManager = (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
        if (tempManager) {
            try {
                const itemEntry = tempManager.findItem(folder.sectionId, folder.id);
                if (itemEntry && itemEntry.item) {
                    collectTempFolderUrls(itemEntry.item, urls, 1, maxDepth);
                }
            } catch (err) {
                console.warn('[批量手动选择] 获取临时文件夹内容失败:', err);
            }
        }
    }

    return urls;
}

/**
 * 递归收集永久文件夹的URL（带层级限制）
 */
async function collectPermanentFolderUrls(folderId, urls, currentDepth, maxDepth) {
    if (currentDepth > maxDepth) return;

    try {
        const children = await chrome.bookmarks.getChildren(folderId);
        for (const child of children) {
            if (child.url) {
                urls.push(child.url);
            } else if (currentDepth < maxDepth) {
                await collectPermanentFolderUrls(child.id, urls, currentDepth + 1, maxDepth);
            }
        }
    } catch (error) {
        console.error('[批量手动选择] 获取文件夹子项失败:', error);
    }
}

/**
 * 递归收集临时文件夹的URL（带层级限制）
 */
function collectTempFolderUrls(item, urls, currentDepth, maxDepth) {
    if (!item || currentDepth > maxDepth) return;

    if (item.children && Array.isArray(item.children)) {
        for (const child of item.children) {
            if (child.url && child.type !== 'folder') {
                urls.push(child.url);
            } else if (child.type === 'folder' && currentDepth < maxDepth) {
                collectTempFolderUrls(child, urls, currentDepth + 1, maxDepth);
            }
        }
    }
}

/**
 * 设置批量选择器事件（V2版本，支持智能分组）
 */
function setupBatchSelectorEventsV2(overlay, selectionInfo, lang, getSelection) {
    // 关闭按钮
    const closeBtn = overlay.querySelector('.manual-selector-close');
    closeBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // 取消按钮
    const cancelBtn = overlay.querySelector('.manual-selector-btn-cancel');
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 清除按钮
    const clearBtn = overlay.querySelector('.manual-selector-btn-clear');
    clearBtn.addEventListener('click', () => {
        overlay.querySelectorAll('.manual-selector-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
    });

    // 确认按钮
    const confirmBtn = overlay.querySelector('.manual-selector-btn-confirm');
    confirmBtn.addEventListener('click', async () => {
        const selection = getSelection();
        const { windowId, groupId, includeSubfolders, depthLevel } = selection;

        ;

        // 关闭选择器
        overlay.remove();

        // 批量打开书签（使用新的智能打开逻辑）
        await batchOpenWithSmartGrouping(selectionInfo, windowId, groupId, includeSubfolders, depthLevel, lang);
    });
}

/**
 * 智能分组打开书签
 * - 如果选择了标签组：所有书签打开到该组
 * - 如果只选择了窗口：文件夹各自成组，单个书签作为独立标签
 */
async function batchOpenWithSmartGrouping(selectionInfo, windowId, groupId, includeSubfolders, depthLevel, lang) {
    try {
        const depth = includeSubfolders ? (depthLevel === 'all' ? Infinity : parseInt(depthLevel)) : 1;

        // 情况1：选择了标签组 - 所有书签打开到该组
        if (groupId) {
            const allUrls = [];

            // 收集单个书签
            selectionInfo.bookmarks.forEach(b => allUrls.push(b.url));

            // 收集文件夹中的书签
            for (const folder of selectionInfo.folders) {
                const urls = await getFolderUrls(folder, depth);
                allUrls.push(...urls);
            }

            if (allUrls.length > 0) {
                await batchOpenUrlsWithSelection(allUrls, windowId, groupId, lang);
            }
        }
        // 情况2：只选择了窗口或都不选 - 文件夹各自成组，单个书签独立
        else {
            const targetWindowId = windowId || (await chrome.windows.getCurrent()).id;

            // 1. 先处理文件夹 - 每个文件夹创建一个标签组
            for (const folder of selectionInfo.folders) {
                const urls = await getFolderUrls(folder, depth);
                if (urls.length > 0) {
                    const tabIds = [];
                    for (const url of urls) {
                        const tab = await chrome.tabs.create({ url, windowId: targetWindowId, active: false });
                        tabIds.push(tab.id);
                    }

                    // 创建标签组，以文件夹名命名
                    if (tabIds.length > 0 && chrome.tabs.group) {
                        const newGroupId = await chrome.tabs.group({ tabIds });
                        if (chrome.tabGroups) {
                            await chrome.tabGroups.update(newGroupId, {
                                title: folder.title || (lang === 'zh_CN' ? '文件夹' : 'Folder'),
                                collapsed: false
                            });
                        }
                        ;
                    }
                }
            }

            // 2. 处理单个书签 - 作为独立标签页
            for (const bookmark of selectionInfo.bookmarks) {
                await chrome.tabs.create({ url: bookmark.url, windowId: targetWindowId, active: false });
            }

            ;
        }

    } catch (error) {
        console.error('[批量手动选择器] 智能分组打开失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

/**
 * 加载批量选择器的窗口和组列表
 */
async function loadBatchWindowsAndGroups(overlay, lang, onSelectionChange) {
    try {
        // 获取所有窗口
        const windows = await chrome.windows.getAll({ populate: true });
        const windowsList = overlay.querySelector('.manual-selector-list[data-type="windows"]');

        // 重置窗口序号映射
        windowIdToIndexMap = {};

        if (windows.length === 0) {
            windowsList.innerHTML = `<div class="manual-selector-empty">${lang === 'zh_CN' ? '没有窗口' : 'No windows'}</div>`;
        } else {
            windowsList.innerHTML = '';

            // 获取当前窗口ID
            const currentWindow = await chrome.windows.getCurrent();
            const currentWindowId = currentWindow.id;

            // 预先解析所有窗口的注册信息，以便做排序和标记
            const windowInfos = await Promise.all(windows.map(async (win) => {
                const registeredLabel = await getRegisteredWindowLabel(win.id, lang);
                const isPluginWindow = registeredLabel !== null;
                return { win, isPluginWindow, registeredLabel };
            }));

            // 排序：插件窗口置顶在上方 (isPluginWindow === true 的排在前面)
            windowInfos.sort((a, b) => {
                if (a.isPluginWindow && !b.isPluginWindow) return -1;
                if (!a.isPluginWindow && b.isPluginWindow) return 1;
                return 0; // 维持原相对顺序
            });

            // 构建窗口ID到序号的映射
            windowInfos.forEach((info, index) => {
                windowIdToIndexMap[info.win.id] = index + 1;
            });

            // 当前选中的窗口ID（用于状态管理）
            let selectedWindowId = null;

            for (const [index, info] of windowInfos.entries()) {
                const win = info.win;
                const windowIndex = index + 1;  // 窗口序号（从1开始）
                const isCurrent = win.id === currentWindowId;
                const tabCount = win.tabs ? win.tabs.length : 0;

                // 获取活动标签页标题
                const activeTab = win.tabs ? win.tabs.find(tab => tab.active) : null;
                const activeTabTitle = activeTab ? activeTab.title : `Window #${win.id}`;

                // 获取显示名称（优先使用自定义名称）
                const defaultName = info.registeredLabel || (lang === 'zh_CN' ? `其他 (${activeTabTitle})` : `Other (${activeTabTitle})`);
                const displayName = customWindowNames[win.id] || defaultName;
                const hasCustomName = !!customWindowNames[win.id];

                // 窗口状态 (插件 / 正常)
                const stateIcon = info.isPluginWindow
                    ? '<i class="fas fa-puzzle-piece"></i>'
                    : '<i class="fas fa-window-restore"></i>';

                const stateText = info.isPluginWindow
                    ? (lang === 'zh_CN' ? '插件' : 'Plugin')
                    : (lang === 'zh_CN' ? '正常' : 'Normal');

                const item = document.createElement('div');
                item.className = 'manual-selector-item';
                item.dataset.windowId = win.id;
                item.dataset.windowIndex = windowIndex;

                item.innerHTML = `
                    <div class="manual-selector-item-header">
                        <div class="manual-selector-item-title">
                            <span class="manual-selector-window-index">${windowIndex}</span>
                            ${win.incognito ? '🕶️' : '🪟'} ${escapeHtml(displayName)}
                            ${isCurrent ? `<span class="manual-selector-item-badge">${lang === 'zh_CN' ? '当前' : 'Current'}</span>` : ''}
                            ${hasCustomName ? `<span class="manual-selector-item-badge" style="background: var(--accent-primary);">✓</span>` : ''}
                        </div>
                        <div class="manual-selector-item-actions">
                            ${!info.isPluginWindow ? `
                            <button class="manual-selector-edit-btn" data-window-id="${win.id}" title="${lang === 'zh_CN' ? '编辑名称' : 'Edit name'}">
                                <i class="fas fa-edit"></i>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="manual-selector-item-info">
                        <span class="manual-selector-item-meta">${stateIcon} ${stateText}</span>
                        <span class="manual-selector-item-meta"><i class="fas fa-layer-group"></i> ${tabCount} ${lang === 'zh_CN' ? '个标签页' : 'tabs'}</span>
                        ${win.incognito ? `<span class="manual-selector-item-meta"><i class="fas fa-user-secret"></i> ${lang === 'zh_CN' ? '无痕模式' : 'Incognito'}</span>` : ''}
                    </div>
                `;

                // 绑定编辑按钮事件
                const editBtn = item.querySelector('.manual-selector-edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await showWindowNameEditor(item, win.id, displayName, lang);
                    });
                }

                // 点击选择窗口
                item.addEventListener('click', async (e) => {
                    // 如果处于编辑模式，不触发选择
                    if (item.dataset.editing === 'true') {
                        return;
                    }
                    // 如果点击的是编辑按钮或输入框，不触发选择
                    if (e.target.closest('.manual-selector-edit-btn') || e.target.closest('.manual-selector-item-input')) {
                        return;
                    }

                    // 切换选中状态
                    const wasSelected = item.classList.contains('selected');
                    overlay.querySelectorAll('.manual-selector-list[data-type="windows"] .manual-selector-item').forEach(i => {
                        i.classList.remove('selected');
                    });

                    if (!wasSelected) {
                        item.classList.add('selected');
                        selectedWindowId = win.id;
                        onSelectionChange(win.id, null);
                        // 加载该窗口 of groups
                        await loadBatchGroupsForWindow(overlay, win.id, lang, onSelectionChange);
                    } else {
                        selectedWindowId = null;
                        onSelectionChange(null, null);
                        // 清除组选择
                        overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                            i.classList.remove('selected');
                        });
                        // 加载所有组
                        await loadBatchGroupsForWindow(overlay, null, lang, onSelectionChange);
                    }
                });

                windowsList.appendChild(item);
            }
        }

        // 加载所有组
        await loadBatchGroupsForWindow(overlay, null, lang, onSelectionChange);

    } catch (error) {
        console.error('[批量手动选择器] 加载失败:', error);
    }
}

/**
 * 加载批量选择器的组列表
 */
async function loadBatchGroupsForWindow(overlay, windowId, lang, onSelectionChange) {
    try {
        const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');

        // 查询组
        const query = windowId ? { windowId } : {};
        const groups = await chrome.tabGroups.query(query);

        if (groups.length === 0) {
            groupsList.innerHTML = `<div class="manual-selector-empty">${windowId
                ? (lang === 'zh_CN' ? '该窗口没有标签组' : 'No groups in this window')
                : (lang === 'zh_CN' ? '选择窗口以查看其标签组，或直接选择所有组' : 'Select a window to see its groups, or choose from all groups')}</div>`;

            // 如果没有选择窗口，显示所有组
            if (!windowId) {
                const allGroups = await chrome.tabGroups.query({});
                if (allGroups.length > 0) {
                    renderBatchGroups(overlay, allGroups, lang, onSelectionChange);
                }
            }
        } else {
            renderBatchGroups(overlay, groups, lang, onSelectionChange);
        }
    } catch (error) {
        console.error('[批量手动选择器] 加载组失败:', error);
    }
}

/**
 * 渲染批量选择器的组列表
 */
function renderBatchGroups(overlay, groups, lang, onSelectionChange) {
    const groupsList = overlay.querySelector('.manual-selector-list[data-type="groups"]');
    groupsList.innerHTML = '';

    // 按窗口分组显示
    const groupsByWindow = {};
    groups.forEach(group => {
        if (!groupsByWindow[group.windowId]) {
            groupsByWindow[group.windowId] = [];
        }
        groupsByWindow[group.windowId].push(group);
    });

    // 获取窗口ID列表（如果有多个窗口的组，显示窗口分隔）
    const windowIds = Object.keys(groupsByWindow);
    const showWindowHeaders = windowIds.length > 1;

    windowIds.forEach(winId => {
        // 获取窗口序号
        const windowIndex = windowIdToIndexMap[winId] || winId;

        // 如果有多个窗口，显示窗口标题
        if (showWindowHeaders) {
            const header = document.createElement('div');
            header.className = 'manual-selector-item-info';
            header.style.padding = '8px 16px';
            header.style.fontWeight = '600';
            header.style.borderBottom = '1px solid var(--border-color)';
            header.style.marginBottom = '6px';
            header.innerHTML = `<i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '窗口' : 'Window'} ${windowIndex}`;
            groupsList.appendChild(header);
        }

        groupsByWindow[winId].forEach(group => {
            const colorMap = {
                'grey': '⚪',
                'blue': '🔵',
                'red': '🔴',
                'yellow': '🟡',
                'green': '🟢',
                'pink': '🟣',
                'purple': '🟣',
                'cyan': '🔵',
                'orange': '🟠'
            };
            const colorIcon = colorMap[group.color] || '⚪';

            const item = document.createElement('div');
            item.className = 'manual-selector-item';
            item.dataset.groupId = group.id;
            item.dataset.windowId = group.windowId;

            const title = group.title || (lang === 'zh_CN' ? '(无标题)' : '(Untitled)');
            const groupWindowIndex = windowIdToIndexMap[group.windowId] || group.windowId;

            item.innerHTML = `
                <div class="manual-selector-item-title">
                    ${colorIcon} ${escapeHtml(title)}
                </div>
                <div class="manual-selector-item-info">${lang === 'zh_CN' ? '窗口' : 'Window'} ${groupWindowIndex}</div>
            `;

            // 点击选择组
            item.addEventListener('click', () => {
                const wasSelected = item.classList.contains('selected');
                overlay.querySelectorAll('.manual-selector-list[data-type="groups"] .manual-selector-item').forEach(i => {
                    i.classList.remove('selected');
                });

                if (!wasSelected) {
                    item.classList.add('selected');
                    // 获取当前选中的窗口
                    const selectedWindowItem = overlay.querySelector('.manual-selector-list[data-type="windows"] .manual-selector-item.selected');
                    const currentWindowId = selectedWindowItem ? parseInt(selectedWindowItem.dataset.windowId) : null;
                    onSelectionChange(currentWindowId, group.id);
                } else {
                    const selectedWindowItem = overlay.querySelector('.manual-selector-list[data-type="windows"] .manual-selector-item.selected');
                    const currentWindowId = selectedWindowItem ? parseInt(selectedWindowItem.dataset.windowId) : null;
                    onSelectionChange(currentWindowId, null);
                }
            });

            groupsList.appendChild(item);
        });
    });
}

/**
 * 设置批量选择器事件
 */
function setupBatchSelectorEvents(overlay, urls, lang, getSelection) {
    // 关闭按钮
    const closeBtn = overlay.querySelector('.manual-selector-close');
    closeBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    // 取消按钮
    const cancelBtn = overlay.querySelector('.manual-selector-btn-cancel');
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });

    // 清除按钮
    const clearBtn = overlay.querySelector('.manual-selector-btn-clear');
    clearBtn.addEventListener('click', () => {
        overlay.querySelectorAll('.manual-selector-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
    });

    // 确认按钮
    const confirmBtn = overlay.querySelector('.manual-selector-btn-confirm');
    confirmBtn.addEventListener('click', async () => {
        const selection = getSelection();
        const { windowId, groupId } = selection;

        ;

        // 关闭选择器
        overlay.remove();

        // 批量打开书签
        await batchOpenUrlsWithSelection(urls, windowId, groupId, lang);
    });
}

/**
 * 使用选择的窗口/组批量打开URL
 */
async function batchOpenUrlsWithSelection(urls, windowId, groupId, lang) {
    try {
        const tabIds = [];

        // 情况1: 窗口 + 组
        if (windowId && groupId) {
            // 验证组是否存在且在指定窗口中
            try {
                const group = await chrome.tabGroups.get(groupId);
                if (group.windowId !== windowId) {
                    throw new Error('组不在指定窗口中');
                }

                // 在指定窗口的指定组中打开
                for (const url of urls) {
                    const tab = await chrome.tabs.create({ url, windowId, active: false });
                    tabIds.push(tab.id);
                }

                // 添加到组
                if (tabIds.length > 0) {
                    await chrome.tabs.group({ groupId, tabIds });
                }

            } catch (error) {
                console.warn('[批量手动选择器] 组不存在，在窗口中创建新标签组:', error);
                // 在窗口中创建新标签和组
                for (const url of urls) {
                    const tab = await chrome.tabs.create({ url, windowId, active: false });
                    tabIds.push(tab.id);
                }
                if (tabIds.length > 0 && chrome.tabs.group) {
                    const newGroupId = await chrome.tabs.group({ tabIds });
                    if (chrome.tabGroups) {
                        await chrome.tabGroups.update(newGroupId, {
                            title: lang === 'zh_CN' ? `批量打开 (${urls.length})` : `Batch (${urls.length})`,
                            collapsed: false
                        });
                    }
                }
            }
        }
        // 情况2: 仅窗口
        else if (windowId) {
            for (const url of urls) {
                await chrome.tabs.create({ url, windowId, active: false });
            }
        }
        // 情况3: 仅组
        else if (groupId) {
            try {
                const group = await chrome.tabGroups.get(groupId);
                for (const url of urls) {
                    const tab = await chrome.tabs.create({ url, windowId: group.windowId, active: false });
                    tabIds.push(tab.id);
                }
                if (tabIds.length > 0) {
                    await chrome.tabs.group({ groupId, tabIds });
                }
            } catch (error) {
                console.warn('[批量手动选择器] 组不存在，在新标签中打开:', error);
                for (const url of urls) {
                    await chrome.tabs.create({ url, active: false });
                }
            }
        }
        // 情况4: 都不选（新标签页）
        else {
            for (const url of urls) {
                await chrome.tabs.create({ url, active: false });
            }
        }

        ;

    } catch (error) {
        console.error('[批量手动选择器] 打开书签失败:', error);
        alert(lang === 'zh_CN' ? `打开失败: ${error.message}` : `Failed to open: ${error.message}`);
    }
}

// 批量剪切
async function batchCut() {
    const caps = getBatchSelectionCapabilities();
    if (caps.mixed) {
        const lang = currentLang || 'zh_CN';
        alert(lang === 'zh_CN' ? '剪切暂不支持同时选择永久与临时栏目' : 'Cut does not support mixed permanent + temporary selection');
        return;
    }
    if (caps.hasTemp) {
        if (!caps.tempAllSameSection) {
            const lang = currentLang || 'zh_CN';
            alert(lang === 'zh_CN' ? '剪切操作仅支持同一临时栏目内的节点' : 'Cut only supports nodes within the same temporary section');
            return;
        }
        await batchCutTemp();
        // A cut payload is now owned by the global clipboard. Keeping the
        // source nodes selected makes the next batch operation look mixed.
        deselectAll();
        flashBatchActionStatus('batch-cut');
        return;
    }
    const permanentIds = caps.permanentIds;
    if (!permanentIds.length) return;
    try {
        await __ctxEnsurePermanentMetadataLoaded();
        const payload = [];
        for (const nodeId of permanentIds) {
            const node = await readPermanentNodeForPayload(nodeId);
            if (node) {
                payload.push(serializeBookmarkNode(node));
            }
        }
        setBookmarkClipboardState({
            action: 'cut',
            source: 'permanent',
            nodeIds: permanentIds,
            payload,
            timestamp: Date.now()
        });
        unmarkCutNode();
        permanentIds.forEach(id => markCutNode(id));
        // The cut mark is independent from the transient batch selection.
        deselectAll();
        flashBatchActionStatus('batch-cut');
        ;
    } catch (error) {
        console.error('[批量] 剪切失败:', error);
    }
}

// 批量删除
async function batchDelete() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';
    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();
    const count = permanentIds.length + tempNodes.length;
    if (count === 0) return;

    // 二次确认
    const message = lang === 'zh_CN'
        ? `确定要删除选中的 ${count} 项吗？此操作不可撤销！`
        : `Delete ${count} selected items? This cannot be undone!`;

    if (!confirm(message)) return;

    try {
        let successCount = 0;
        let failCount = 0;
        const affectedParentIds = new Set(); // 记录受影响的父文件夹ID

        const manager = (tempNodes.length ? getTempManager() : null);
        const tempGroups = new Map();
        if (manager && tempNodes.length) {
            tempNodes.forEach((node) => {
                if (!node || !node.sectionId || !node.id) return;
                if (!tempGroups.has(node.sectionId)) tempGroups.set(node.sectionId, []);
                tempGroups.get(node.sectionId).push(node.id);
            });
        }

        if (permanentIds.length) {
            const permanentRoots = [];
            // 先收集所有要删除的节点的父ID
            for (const nodeId of permanentIds) {
                try {
                    const roots = await chrome.bookmarks.getSubTree(nodeId);
                    const node = roots && roots[0];
                    if (!node) continue;
                    permanentRoots.push(node);
                    if (node.parentId) {
                        affectedParentIds.add(node.parentId);
                    }
                } catch (error) {
                    console.error('[批量] 获取节点信息失败:', nodeId, error);
                }
            }

            const useBulkMute = permanentRoots.length > 1;
            let muteSession = null;
            let loadingToast = null;
            if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
                muteSession = await beginBookmarkBulkMute('batch-delete-permanent');
            }
            if (typeof window.showLoadingToast === 'function' && permanentRoots.length > 30) {
                loadingToast = window.showLoadingToast(lang === 'zh_CN' ? `正在删除 ${permanentRoots.length} 项...` : `Deleting ${permanentRoots.length} items...`);
            }

            const progressTracker = {
                total: permanentRoots.length,
                current: 0,
                startTime: Date.now()
            };

            const createdEvents = [];
            const createOptions = { createdEvents };

            try {
                // 执行永久书签删除
                for (const rootNode of permanentRoots) {
                    try {
                        progressTracker.current++;
                        if (loadingToast) {
                            const current = progressTracker.current;
                            const msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                                ? `Deleting: ${current}/${total}`
                                : `正在删除: ${current}/${total}`;
                            loadingToast.update(msg);
                        }
                        if (rootNode.url) {
                            await removePermanentBookmarkNode(rootNode.id, false, {
                                ...createOptions,
                                parentId: rootNode.parentId,
                                index: rootNode.index
                            });
                        } else {
                            await removePermanentBookmarkNode(rootNode.id, true, {
                                ...createOptions,
                                parentId: rootNode.parentId,
                                index: rootNode.index
                            });
                        }
                        successCount++;
                    } catch (error) {
                        console.error('[批量] 删除失败:', rootNode && rootNode.id, error);
                        failCount++;
                    }
                }
                if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                    await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'batch-delete-permanent');
                }
            } finally {
                if (loadingToast) loadingToast.close();
                if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                    await endBookmarkBulkMute('batch-delete-permanent', { refreshTree: true });
                }
            }
        }

        // 删除临时栏目节点
        if (manager && tempGroups.size) {
            try {
                tempGroups.forEach((ids, sectionId) => {
                    try {
                        manager.removeItems(sectionId, ids);
                        successCount += ids.length;
                    } catch (error) {
                        console.warn('[批量] 删除临时节点失败:', { sectionId, error });
                        failCount += ids.length;
                    }
                });
            } catch (error) {
                console.warn('[批量] 删除临时节点失败:', error);
            }
        }

        // 先清空选择状态（重要：避免残留蓝色标记）
        deselectAll();
        updateBatchToolbar();

        // 存储受影响的父文件夹列表到临时存储，供比较算法使用（仅永久书签删除才需要）
        if (affectedParentIds.size > 0) {
            await chrome.storage.local.set({
                tempDeletedParents: Array.from(affectedParentIds),
                tempDeleteTimestamp: Date.now()
            });
            ;
        }

        // 不调用 refreshBookmarkTree()，让 onRemoved 事件触发增量更新
        // 增量更新会添加删除标记，用户可以通过"清理变动标识"功能来清除

        // 清除临时标记（延迟清除，给渲染留出更长时间，从1秒增加到5秒）
        if (affectedParentIds.size > 0) {
            setTimeout(async () => {
                await chrome.storage.local.remove(['tempDeletedParents', 'tempDeleteTimestamp']);
                ;
            }, 5000);
        }

        const result = lang === 'zh_CN'
            ? `已删除 ${successCount} 项${failCount > 0 ? `，失败 ${failCount} 项` : ''}`
            : `Deleted ${successCount} items${failCount > 0 ? `, failed ${failCount}` : ''}`;

        alert(result);
        ;

    } catch (error) {
        console.error('[批量] 删除失败:', error);
        alert(lang === 'zh_CN' ? `删除失败: ${error.message}` : `Delete failed: ${error.message}`);
    }
}

// 批量重命名
async function batchRename() {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
    const caps = getBatchSelectionCapabilities();

    const permanentIds = caps.permanentIds;
    const tempNodes = caps.tempNodes;

    if (!permanentIds.length && !tempNodes.length) return;

    const newTitle = prompt(
        lang === 'zh_CN' ? '请输入统一的新名称（覆盖所有选中项）:' : 'Enter a new name (overwrites all selected items):',
        ''
    );
    if (newTitle === null) return;
    const normalizedTitle = newTitle.trim();
    if (!normalizedTitle) return;

    try {
        let count = 0;

        if (permanentIds.length) {
            if (!chrome || !chrome.bookmarks) {
                alert('此功能需要Chrome扩展环境');
                return;
            }

            const useBulkMute = permanentIds.length > 1;
            let muteSession = null;
            let loadingToast = null;
            if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
                muteSession = await beginBookmarkBulkMute('batch-rename-permanent');
            }
            if (typeof window.showLoadingToast === 'function' && permanentIds.length > 30) {
                loadingToast = window.showLoadingToast(lang === 'zh_CN' ? `正在重命名 ${permanentIds.length} 项...` : `Renaming ${permanentIds.length} items...`);
            }

            const progressTracker = {
                total: permanentIds.length,
                current: 0,
                startTime: Date.now()
            };

            const createdEvents = [];
            const createOptions = { createdEvents };

            try {
                for (const nodeId of permanentIds) {
                    progressTracker.current++;
                    if (loadingToast) {
                        const current = progressTracker.current;
                        const msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                            ? `Renaming: ${current}/${progressTracker.total}`
                            : `正在重命名: ${current}/${progressTracker.total}`;
                        loadingToast.update(msg);
                    }
                    await updatePermanentBookmarkNode(nodeId, { title: normalizedTitle }, createOptions);
                    count++;
                }

                if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                    await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'batch-rename-permanent');
                }
            } finally {
                if (loadingToast) loadingToast.close();
                if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                    await endBookmarkBulkMute('batch-rename-permanent', { refreshTree: true });
                }
            }
        }

        if (tempNodes.length) {
            const manager = ensureTempManager();
            const updatedSections = new Set();
            const changedSections = [];
            for (const node of tempNodes) {
                if (node.isFolder) {
                    manager.renameItem(node.sectionId, node.id, normalizedTitle, { skipRender: true, skipSave: true });
                } else {
                    manager.updateBookmark(node.sectionId, node.id, {
                        title: normalizedTitle
                    }, { skipRender: true, skipSave: true });
                }
                updatedSections.add(node.sectionId);
                count++;
            }
            // 批量修改完成后，对所有受影响的栏目各触发一次统一重绘 and 存储保存
            updatedSections.forEach(sectionId => {
                try {
                    if (typeof manager.getSection === 'function') {
                        const section = manager.getSection(sectionId);
                        if (section) {
                            changedSections.push(section);
                            if (typeof manager.refreshSectionTree === 'function') {
                                manager.refreshSectionTree(section);
                            } else if (typeof window !== 'undefined' && typeof window.refreshTempSectionTreeInPlace === 'function') {
                                window.refreshTempSectionTreeInPlace(section);
                            } else if (typeof manager.ensureRendered === 'function') {
                                manager.ensureRendered(sectionId);
                            }
                        } else if (typeof manager.ensureRendered === 'function') {
                            manager.ensureRendered(sectionId);
                        }
                    }
                } catch (_) { }
            });
            if (typeof manager.saveSectionsPatch === 'function' && changedSections.length) {
                await manager.saveSectionsPatch(changedSections);
            } else {
                await saveTempNodes();
            }
        }

        alert(lang === 'zh_CN' ? `已重命名 ${count} 项` : `Renamed ${count} items`);
        ;

    } catch (error) {
        console.error('[批量] 重命名失败:', error);
        alert(lang === 'zh_CN' ? `重命名失败: ${error.message}` : `Rename failed: ${error.message}`);
    }
}

// 导出为HTML
async function batchExportHTML() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    const permanentIds = getSelectedPermanentNodeIds();
    const tempNodes = getSelectedTempNodes();
    const manager = (tempNodes.length ? getTempManager() : null);

    const escapeHtml = (s) => String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const renderTempItemHtml = (item, depth = 1) => {
        if (!item) return '';
        const indent = '    '.repeat(depth);
        if (item.type === 'bookmark' && item.url) {
            return `${indent}<DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title)}</A>\n`;
        }
        const title = escapeHtml(item.title || (lang === 'zh_CN' ? '文件夹' : 'Folder'));
        let out = `${indent}<DT><H3>${title}</H3>\n`;
        out += `${indent}<DL><p>\n`;
        (item.children || []).forEach((child) => {
            out += renderTempItemHtml(child, depth + 1);
        });
        out += `${indent}</DL><p>\n`;
        return out;
    };

    const renderPermanentNodeHtml = (node, depth = 1) => {
        if (!node) return '';
        const indent = '    '.repeat(depth);
        if (node.url) {
            return `${indent}<DT><A HREF="${escapeHtml(node.url)}">${escapeHtml(node.title)}</A>\n`;
        }
        const title = escapeHtml(node.title || (lang === 'zh_CN' ? '文件夹' : 'Folder'));
        let out = `${indent}<DT><H3>${title}</H3>\n`;
        out += `${indent}<DL><p>\n`;
        (node.children || []).forEach((child) => {
            out += renderPermanentNodeHtml(child, depth + 1);
        });
        out += `${indent}</DL><p>\n`;
        return out;
    };

    try {
        let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
        html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
        html += '<TITLE>Bookmarks</TITLE>\n';
        html += '<H1>Bookmarks</H1>\n';
        html += '<DL><p>\n';

        // 永久书签（递归导出）
        for (const nodeId of permanentIds) {
            const node = await readPermanentNodeForPayload(nodeId);
            if (node) {
                html += renderPermanentNodeHtml(node, 1);
            }
        }

        // 临时栏目
        if (manager && tempNodes.length) {
            for (const node of tempNodes) {
                const entry = manager.findItem(node.sectionId, node.id);
                if (!entry || !entry.item) continue;
                html += renderTempItemHtml(entry.item, 1);
            }
        }

        html += '</DL><p>\n';

        // 下载文件
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const exportPath = getTreeExportDownloadFolder();
        const filename = 'bookmarks.html';

        if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url: url,
                filename: `${exportPath}/${filename}`,
                saveAs: false,
                conflictAction: 'uniquify'
            }, () => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }

        alert(lang === 'zh_CN' ? '导出成功！' : 'Export successful!');
        ;

    } catch (error) {
        console.error('[批量] 导出HTML失败:', error);
        alert(lang === 'zh_CN' ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);
    }
}

// 导出为JSON
async function batchExportJSON() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    try {
        await __ctxEnsurePermanentMetadataLoaded();

        const payload = {
            format: 'bookmark-canvas-section',
            schemaVersion: 2,
            sectionType: 'temporary',
            title: lang === 'zh_CN' ? `批量导出的书签 (${formatTimestampForTitle()})` : `Batch Exported Bookmarks (${formatTimestampForTitle()})`,
            tempKind: 'special',
            source: 'batch',
            label: lang === 'zh_CN' ? '批量' : 'Batch',
            items: []
        };

        const permanentIds = getSelectedPermanentNodeIds();
        const tempNodes = getSelectedTempNodes();
        const manager = (tempNodes.length ? getTempManager() : null);

        // 永久书签（递归导出）
        for (const nodeId of permanentIds) {
            const node = await readPermanentNodeForPayload(nodeId);
            if (node) {
                payload.items.push(serializeBookmarkNode(node));
            }
        }

        // 临时栏目
        const serializeTempItem = (item) => {
            if (!item) return null;
            const out = {
                title: item.title,
                url: item.url || null,
                type: item.type
            };
            const note = __ctxNormalizeNote(item.note);
            if (note) {
                out.note = note;
                out.noteColor = __ctxNormalizeNoteColor(item.noteColor);
            }
            if (Array.isArray(item.tags) && item.tags.length) {
                out.tags = item.tags.map(t => ({ color: t.color, text: t.text }));
            }
            out.children = (item.children || []).map(serializeTempItem).filter(Boolean);
            return out;
        };
        if (manager && tempNodes.length) {
            for (const node of tempNodes) {
                const entry = manager.findItem(node.sectionId, node.id);
                if (!entry || !entry.item) continue;
                payload.items.push(serializeTempItem(entry.item));
            }
        }

        const json = JSON.stringify(payload, null, 2);

        // 下载文件
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const exportPath = getTreeExportDownloadFolder();
        const filename = 'bookmarks.json';

        if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url: url,
                filename: `${exportPath}/${filename}`,
                saveAs: false,
                conflictAction: 'uniquify'
            }, () => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }

        alert(lang === 'zh_CN' ? '导出成功！' : 'Export successful!');
        ;

    } catch (error) {
        console.error('[批量] 导出JSON失败:', error);
        alert(lang === 'zh_CN' ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);
    }
}

// 合并为新文件夹
async function batchMergeFolder() {
    if (!chrome || !chrome.bookmarks) {
        alert('此功能需要Chrome扩展环境');
        return;
    }

    const lang = currentLang || 'zh_CN';

    const caps = getBatchSelectionCapabilities();
    if (isBatchMergeDisabled(caps)) {
        alert(getBatchMergeUnsupportedMessage(lang));
        return;
    }

    // 临时栏目：将选中项合并为“一个新文件夹（包含原选中项）”
    if (caps.hasTemp) {
        const folderName = prompt(
            lang === 'zh_CN' ? '请输入新文件夹名称（将在当前临时栏目内合并）:' : 'Enter new folder name (will be merged in the current temporary section):',
            formatTimestampForTitle()
        );
        if (!folderName) return;

        try {
            const manager = ensureTempManager();
            const sectionGroups = new Map();
            caps.tempNodes.forEach((node) => {
                if (!node || !node.sectionId || !node.id) return;
                if (!sectionGroups.has(node.sectionId)) sectionGroups.set(node.sectionId, []);
                sectionGroups.get(node.sectionId).push(node.id);
            });

            sectionGroups.forEach((ids, sectionId) => {
                if (!ids.length) return;
                const payload = manager.extractPayload(sectionId, ids) || [];
                // 先移除原项，再插入一个文件夹（子项=原payload），相当于“合并到文件夹”
                manager.removeItems(sectionId, ids);
                manager.insertFromPayload(sectionId, null, [{
                    title: folderName,
                    type: 'folder',
                    children: payload
                }], null, { defaultCollapseFolders: true });
            });

            deselectAll();
            alert(lang === 'zh_CN' ? '已合并' : 'Merged');
        } catch (error) {
            console.error('[批量] 临时合并失败:', error);
            alert(lang === 'zh_CN' ? `合并失败: ${error.message}` : `Merge failed: ${error.message}`);
        }
        return;
    }

    // 永久书签：新建文件夹并把选中项 move 进去
    const permanentIds = caps.permanentIds;
    if (!permanentIds.length) return;
    let permanentRootId;
    try {
        permanentRootId = await __resolveBookmarkAddPermanentRootId();
    } catch (error) {
        console.error('[批量] 解析永久书签根目录失败:', error);
        alert(lang === 'zh_CN' ? `合并失败: ${error.message}` : `Merge failed: ${error.message}`);
        return;
    }

    const folderName = prompt(
        lang === 'zh_CN' ? '请输入新文件夹名称（将合并在根目录）:' : 'Enter new folder name (will be merged in the root directory):',
        formatTimestampForTitle()
    );

    if (!folderName) {
        return;
    }

    const totalNodes = permanentIds.length + 1;
    const useBulkMute = totalNodes > 1;
    let muteSession = null;
    let loadingToast = null;
    const createdEvents = [];
    const progressTracker = {
        total: totalNodes,
        current: 0,
        startTime: Date.now()
    };
    const createOptions = { createdEvents, progressTracker, loadingToast };
    try {
        if (useBulkMute && typeof beginBookmarkBulkMute === 'function') {
            muteSession = await beginBookmarkBulkMute('batch-merge-folder');
        }
        if (typeof window.showLoadingToast === 'function' && totalNodes > 30) {
            loadingToast = window.showLoadingToast(lang === 'zh_CN' ? `正在合并 ${permanentIds.length} 项...` : `Merging ${permanentIds.length} items...`);
        }

        // 在当前浏览器提供的永久书签根目录下创建新文件夹。
        progressTracker.current++;
        const newFolder = await createPermanentBookmarkNode({
            parentId: permanentRootId,
            title: folderName
        }, createOptions);

        // Pre-fetch original nodes to get oldParentId and oldIndex
        let originalNodeMap = new Map();
        try {
            const originalNodes = await chrome.bookmarks.get(permanentIds);
            originalNodes.forEach(node => {
                if (node) {
                    originalNodeMap.set(node.id, {
                        oldParentId: node.parentId,
                        oldIndex: node.index
                    });
                }
            });
        } catch (err) {
            console.warn('[批量] 获取原始节点信息失败:', err);
        }

        // 移动所有选中项到新文件夹
        let count = 0;
        for (const nodeId of permanentIds) {
            try {
                const orig = originalNodeMap.get(nodeId) || {};
                progressTracker.current++;
                if (loadingToast) {
                    const current = progressTracker.current;
                    const msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                        ? `Merging: ${current}/${totalNodes}`
                        : `正在合并: ${current}/${totalNodes}`;
                    loadingToast.update(msg);
                }
                await movePermanentBookmarkNode(nodeId, { parentId: newFolder.id }, {
                    ...createOptions,
                    oldParentId: orig.oldParentId,
                    oldIndex: orig.oldIndex
                });
                count++;
            } catch (error) {
                console.error('[批量] 移动失败:', nodeId, error);
            }
        }

        if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
            await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'batch-merge-folder');
        }

        deselectAll();
        updateBatchToolbar();
        // 不调用 refreshBookmarkTree()，让 onCreated/onMoved 事件触发增量更新

        if (typeof showToast === 'function') {
            showToast(lang === 'zh_CN' ? `已将 ${count} 项合并到新文件夹` : `Merged ${count} items to new folder`);
        } else {
            alert(lang === 'zh_CN' ? `已将 ${count} 项合并到新文件夹` : `Merged ${count} items to new folder`);
        }
        ;
    } catch (error) {
        console.error('[批量] 合并失败:', error);
        alert(lang === 'zh_CN' ? `合并失败: ${error.message}` : `Merge failed: ${error.message}`);
    } finally {
        if (loadingToast) loadingToast.close();
        if (useBulkMute && typeof endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
            await endBookmarkBulkMute('batch-merge-folder', { refreshTree: true });
        }
    }
}

// ==================== 顶部批量操作工具栏 ====================

// 初始化批量操作工具栏
function initBatchToolbar() {
    // 查找书签树视图的标题
    const pageTitle = document.querySelector('#treeViewTitle') ||
        document.querySelector('#treeView h2') ||
        document.querySelector('h2');
    if (!pageTitle) {
        console.warn('[批量工具栏] 未找到页面标题');
        return;
    }

    ;

    // 创建工具栏容器（在标题同一行）
    const titleContainer = pageTitle.parentElement;
    titleContainer.style.display = 'flex';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.gap = '20px';
    titleContainer.style.flexWrap = 'wrap';

    // 创建工具栏
    const toolbar = document.createElement('div');
    toolbar.id = 'batch-toolbar';
    toolbar.className = 'batch-toolbar';
    toolbar.style.display = 'none';
    const lang = currentLang || 'zh_CN';
    toolbar.innerHTML = `
        <span class="selected-count">已选中 0 项</span>
        <button class="batch-btn" data-action="show-batch-panel" title="${lang === 'zh_CN' ? '显示悬浮窗菜单' : 'Show Floating Panel'}">
            <i class="fas fa-window-restore"></i> ${lang === 'zh_CN' ? '悬浮窗' : 'Float'}
        </button>
        <button class="batch-btn" data-action="batch-open"><i class="fas fa-folder-open"></i> 打开</button>
        <button class="batch-btn" data-action="batch-open-tab-group"><i class="fas fa-object-group"></i> 标签组</button>
        <button class="batch-btn" data-action="batch-cut"><i class="fas fa-cut"></i> 剪切</button>
        <button class="batch-btn" data-action="batch-delete"><i class="fas fa-trash-alt"></i> ${lang === 'zh_CN' ? '删除' : 'DELETE'}</button>
        <button class="batch-btn" data-action="batch-rename"><i class="fas fa-edit"></i> 重命名</button>
        <button class="batch-btn" data-action="batch-export-html"><i class="fas fa-file-code"></i> HTML</button>
        <button class="batch-btn" data-action="batch-export-json"><i class="fas fa-file-alt"></i> JSON</button>
        <button class="batch-btn" data-action="batch-merge-folder"><i class="fas fa-folder-plus"></i> 合并</button>
        <button class="batch-btn exit-select-btn" data-action="exit-select-mode"><i class="fas fa-times"></i> 退出</button>
    `;

    // 插入到标题旁边
    titleContainer.appendChild(toolbar);

    // 绑定按钮事件
    toolbar.querySelectorAll('.batch-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const action = btn.dataset.action;
            if (action === 'exit-select-mode') {
                exitSelectMode();
            } else if (action === 'show-batch-panel') {
                showBatchPanel();
            } else {
                await handleMenuAction(action, null, null, null, false);
            }
        });
    });

    ;
}

// 更新批量操作工具栏
function updateBatchToolbar() {
    const toolbar = document.getElementById('batch-toolbar');
    if (!toolbar) {
        console.warn('[批量工具栏] 未找到工具栏元素');
        return;
    }

    const lang = currentLang || 'zh_CN';
    const count = (typeof window !== 'undefined' && typeof window.getEffectiveBookmarkDragSelectionIds === 'function')
        ? window.getEffectiveBookmarkDragSelectionIds().length
        : selectedNodes.size;

    // 根据选择能力灰度不可用操作（目前只处理剪切/合并）
    try {
        const caps = getBatchSelectionCapabilities();
        const cutDisabled = caps.mixed || (caps.hasTemp && !caps.tempAllSameSection);
        const mergeDisabled = isBatchMergeDisabled(caps);

        const cutBtn = toolbar.querySelector('[data-action="batch-cut"]');
        if (cutBtn) {
            cutBtn.disabled = !!cutDisabled;
            cutBtn.classList.toggle('disabled', !!cutDisabled);
        }
        const mergeBtn = toolbar.querySelector('[data-action="batch-merge-folder"]');
        if (mergeBtn) {
            mergeBtn.disabled = !!mergeDisabled;
            mergeBtn.classList.toggle('disabled', !!mergeDisabled);
        }
    } catch (_) { }

    ;

    // 在Select模式下，默认不显示工具栏（显示批量菜单）
    // 除非用户点击了"隐藏批量菜单"按钮
    // 如果不在Select模式，也隐藏
    if (!selectMode) {
        toolbar.style.display = 'none';
        ;
        return;
    }

    // 更新计数文本
    const countText = lang === 'zh_CN' ? `已选中 ${count} 项` : `${count} Selected`;
    const countElement = toolbar.querySelector('.selected-count');
    if (countElement) {
        countElement.textContent = countText;
    }

    ;
}

// ==================== 快捷键支持 ====================

function getKeyboardCanvasPointerContext() {
    const pointer = lastKeyboardCanvasPointer;
    const workspace = document.getElementById('canvasWorkspace');
    if (!pointer || !workspace) return null;
    const workspaceRect = workspace.getBoundingClientRect();
    if (pointer.clientX < workspaceRect.left || pointer.clientX > workspaceRect.right || pointer.clientY < workspaceRect.top || pointer.clientY > workspaceRect.bottom) {
        return null;
    }

    const element = document.elementFromPoint(pointer.clientX, pointer.clientY);
    if (!element) return { kind: 'blank', workspace, workspaceRect, pointer };
    const treeItem = element.closest && element.closest('.tree-item[data-node-id]');
    const tempSection = element.closest && element.closest('.temp-canvas-node[data-section-id]');
    const permanentSection = element.closest && element.closest('.permanent-bookmark-section');

    if (treeItem) {
        const treeType = treeItem.dataset.treeType || (tempSection ? 'temporary' : 'permanent');
        return {
            kind: 'node', workspace, workspaceRect, pointer, element, treeItem, treeType,
            nodeId: treeItem.dataset.nodeId || null,
            sectionId: treeType === 'temporary'
                ? (treeItem.dataset.sectionId || (tempSection && tempSection.dataset.sectionId) || null)
                : PERMANENT_SECTION_ANCHOR_ID,
            isFolder: treeItem.dataset.nodeType === 'folder',
            sectionElement: tempSection || permanentSection || null
        };
    }

    if (tempSection) {
        return {
            kind: 'temp-root', workspace, workspaceRect, pointer, element,
            sectionId: tempSection.dataset.sectionId || null,
            sectionElement: tempSection
        };
    }
    if (permanentSection) {
        return { kind: 'permanent-root', workspace, workspaceRect, pointer, element, sectionElement: permanentSection };
    }
    return { kind: 'blank', workspace, workspaceRect, pointer, element };
}

function selectAllInKeyboardCanvasCard(context) {
    const card = context && context.sectionElement;
    if (!card) return false;
    const items = Array.from(card.querySelectorAll('.tree-item[data-node-id]'));
    if (!items.length) return false;

    deselectAll();
    items.forEach((node) => {
        const nodeId = node.dataset.nodeId;
        if (!nodeId) return;
        const treeType = node.dataset.treeType || (context.kind === 'temp-root' ? 'temporary' : 'permanent');
        selectedNodes.add(nodeId);
        selectedNodeMeta.set(nodeId, {
            treeType,
            sectionId: treeType === 'temporary'
                ? (node.dataset.sectionId || context.sectionId || null)
                : PERMANENT_SECTION_ANCHOR_ID,
            nodeType: node.dataset.nodeType || 'bookmark',
            cardKey: (node.closest('.permanent-bookmark-section, .temp-canvas-node') || {}).id || node.dataset.sectionId || context.sectionId || null,
            selectionSource: 'select-all'
        });
        node.classList.add('selected');
        lastClickedNode = nodeId;
        lastClickedElement = node;
    });
    selectionSnapshot = new Set(selectedNodes);
    updateBatchToolbar();
    updateBatchPanelCount();
    return selectedNodes.size > 0;
}

async function resolveKeyboardPermanentRootId() {
    if (!chrome || !chrome.bookmarks || typeof chrome.bookmarks.getTree !== 'function') return null;
    try {
        const tree = await chrome.bookmarks.getTree();
        const root = Array.isArray(tree) ? tree[0] : null;
        const bar = root && Array.isArray(root.children)
            ? root.children.find((node) => node && (node.id === '1' || /书签栏|Bookmarks Bar/i.test(node.title || '')))
            : null;
        return bar && bar.id ? bar.id : null;
    } catch (_) {
        return null;
    }
}

async function pasteClipboardAtKeyboardCanvasPointer(context) {
    if (!bookmarkClipboard || !context) return false;
    if (context.kind === 'node') {
        if (context.treeType === 'temporary') {
            await pasteIntoTemp({ sectionId: context.sectionId, nodeId: context.nodeId, isFolder: context.isFolder }, false);
        } else {
            await pasteBookmark(context.nodeId, context.isFolder, false);
        }
        return true;
    }
    if (context.kind === 'temp-root') {
        await pasteIntoTemp({ sectionId: context.sectionId, nodeId: null, isFolder: false }, false);
        return true;
    }
    if (context.kind === 'permanent-root') {
        const rootId = await resolveKeyboardPermanentRootId();
        if (!rootId) return false;
        await pasteBookmark(rootId, true, false);
        return true;
    }
    if (context.kind !== 'blank' || !window.CanvasModule || typeof window.CanvasModule.createEmptyTempSection !== 'function') return false;

    const state = window.CanvasModule.CanvasState || {};
    const zoom = Number(state.zoom) > 0 ? Number(state.zoom) : 1;
    const panX = Number(state.panOffsetX) || 0;
    const panY = Number(state.panOffsetY) || 0;
    const x = (context.pointer.clientX - context.workspaceRect.left - panX) / zoom;
    const y = (context.pointer.clientY - context.workspaceRect.top - panY) / zoom;
    const sectionId = window.CanvasModule.createEmptyTempSection(x, y, {
        title: (currentLang || 'zh_CN') === 'zh_CN' ? '粘贴' : 'Paste',
        label: (currentLang || 'zh_CN') === 'zh_CN' ? '粘贴' : 'Paste',
        source: 'clipboard-paste'
    });
    if (!sectionId) return false;
    await pasteIntoTemp({ sectionId, nodeId: null, isFolder: false }, false);
    return true;
}

// 初始化快捷键
function initKeyboardShortcuts() {
    if (document.documentElement.dataset.canvasObjectShortcutsBound === 'true') return;
    document.documentElement.dataset.canvasObjectShortcutsBound = 'true';

    document.addEventListener('pointermove', (event) => {
        const workspace = document.getElementById('canvasWorkspace');
        if (!workspace) return;
        const rect = workspace.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
            lastKeyboardCanvasPointer = { clientX: event.clientX, clientY: event.clientY };
        } else {
            lastKeyboardCanvasPointer = null;
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        const keyboardTarget = e.target && e.target.nodeType === Node.ELEMENT_NODE
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        // Keep browser-native shortcuts for text fields and canvas text editors.
        if (keyboardTarget && keyboardTarget.closest('input, textarea, select, [contenteditable="true"], .md-canvas-editor, .temp-node-description-editor, .permanent-section-tip-editor')) {
            return;
        }

        // ESC - 退出Select模式
        if (e.key === 'Escape' && selectMode) {
            // 如果当前正在进行拖拽，优先交给拖拽系统处理，不要退出选择模式
            if (window.pointerDragState && window.pointerDragState.isDragging) {
                return;
            }
            exitSelectMode();
            return;
        }

        const hasCustomSelection = selectedNodes.size > 0;
        const hasCommandModifier = e.ctrlKey || e.metaKey;
        const key = String(e.key || '').toLowerCase();

        // Cmd/Ctrl + A selects only the bookmark/folder nodes in the card
        // currently under the pointer, never every card on the canvas.
        if (hasCommandModifier && key === 'a' && selectMode) {
            const pointerContext = getKeyboardCanvasPointerContext();
            if (!pointerContext || !pointerContext.sectionElement) return;
            e.preventDefault();
            selectAllInKeyboardCanvasCard(pointerContext);
            return;
        }

        if (!hasCommandModifier) return;

        if (key === 'c' && hasCustomSelection) {
            e.preventDefault();
            copySelected();
            return;
        }

        if (key === 'x' && hasCustomSelection) {
            e.preventDefault();
            cutSelected();
            return;
        }

        if (key === 'v') {
            // A text clipboard keeps its native paste behavior; only structured
            // bookmark/folder clipboard content is pasted through the canvas.
            const pointerContext = getKeyboardCanvasPointerContext();
            if (!bookmarkClipboard || !pointerContext) return;
            e.preventDefault();
            pasteClipboardAtKeyboardCanvasPointer(pointerContext).catch((error) => {
                console.warn('[快捷键] 粘贴失败:', error);
            });
            return;
        }

    });

    ;
}

// 初始化点击选择 - 现在改为在overlay上处理，不需要这个函数了
function initClickSelect() {
    ;
}

// 更新批量面板的选择计数
function updateBatchPanelCount() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (!batchPanel) return;

    const countElement = batchPanel.querySelector('#batch-panel-count');
    if (!countElement) return;

    const lang = currentLang || 'zh_CN';
    const count = (typeof window !== 'undefined' && typeof window.getEffectiveBookmarkDragSelectionIds === 'function')
        ? window.getEffectiveBookmarkDragSelectionIds().length
        : selectedNodes.size;
    countElement.textContent = `${count}${lang === 'zh_CN' ? ' 项' : ' items'}`;

    ;

    try {
        const caps = getBatchSelectionCapabilities();
        const cutDisabled = caps.mixed || (caps.hasTemp && !caps.tempAllSameSection);
        const mergeDisabled = isBatchMergeDisabled(caps);
        batchPanel.querySelectorAll('.context-menu-item[data-action="batch-cut"]').forEach((el) => {
            el.classList.toggle('disabled', !!cutDisabled);
        });
        batchPanel.querySelectorAll('.context-menu-item[data-action="batch-merge-folder"]').forEach((el) => {
            el.classList.toggle('disabled', !!mergeDisabled);
        });
        batchPanel.querySelectorAll('.context-menu-item[data-action="batch-rename"]').forEach((el) => {
            el.classList.remove('disabled');
        });
    } catch (_) { }
}

// 恢复批量面板的位置和大小
function restoreBatchPanelState(panel, anchorInfo) {
    try {
        if (!panel) return;
        const info = anchorInfo || currentBatchPanelAnchorInfo || getBatchPanelAnchorInfoFromSelection();
        if (!info) {
            console.warn('[批量面板] 缺少定位信息，维持默认位置');
            return;
        }

        const resolvedElement = info.element || findBatchPanelColumnElement(info.treeType, info.sectionId);
        const anchorKey = getBatchPanelAnchorKey({ treeType: info.treeType, sectionId: info.sectionId });

        currentBatchPanelAnchorInfo = {
            treeType: info.treeType || 'permanent',
            sectionId: info.sectionId || (info.treeType === 'permanent' ? PERMANENT_SECTION_ANCHOR_ID : null),
            element: resolvedElement
        };

        panel.dataset.anchorKey = anchorKey;
        panel.dataset.treeType = currentBatchPanelAnchorInfo.treeType;
        if (currentBatchPanelAnchorInfo.sectionId) {
            panel.dataset.sectionId = currentBatchPanelAnchorInfo.sectionId;
        } else {
            delete panel.dataset.sectionId;
        }

        panel.style.position = 'fixed';
        const margin = 16;
        const defaultHorizontalBottom = 80;

        const anchorRect = resolvedElement && typeof resolvedElement.getBoundingClientRect === 'function'
            ? resolvedElement.getBoundingClientRect()
            : null;
        const viewportWidth = window.innerWidth || 1920;
        const viewportHeight = window.innerHeight || 1080;

        // 加载全局状态
        const globalState = getBatchPanelGlobalState();

        // 兼容处理：如果全局状态里没有自定义数据，但是旧的 localStorage 里有，做一次性数据同步
        const legacyRaw = localStorage.getItem(BATCH_PANEL_LEGACY_KEY);
        if (legacyRaw) {
            try {
                const legacyState = JSON.parse(legacyRaw);
                if (legacyState && legacyState.manualPosition === true) {
                    if (legacyState.layout === 'vertical') {
                        if (!globalState.vertical.manualPosition && parseFloat(legacyState.width)) {
                            globalState.vertical.width = parseFloat(legacyState.width);
                            globalState.vertical.height = parseFloat(legacyState.height) || null;
                            globalState.vertical.manualPosition = true;
                            globalState.vertical.left = legacyState.left;
                            globalState.vertical.top = legacyState.top;
                        }
                    } else if (legacyState.layout === 'horizontal') {
                        if (!globalState.horizontal.manualPosition && parseFloat(legacyState.width)) {
                            globalState.horizontal.width = parseFloat(legacyState.width);
                            globalState.horizontal.height = parseFloat(legacyState.height) || null;
                            globalState.horizontal.manualPosition = true;
                            globalState.horizontal.left = legacyState.left;
                            globalState.horizontal.top = legacyState.top;
                        }
                    }
                }
            } catch (_) {}
        }

        // 同步数据集
        if (globalState.vertical.width) {
            panel.dataset.userWidthVertical = String(globalState.vertical.width);
        } else {
            delete panel.dataset.userWidthVertical;
        }
        if (globalState.vertical.height) {
            panel.dataset.userHeightVertical = String(globalState.vertical.height);
        } else {
            delete panel.dataset.userHeightVertical;
        }
        if (globalState.horizontal.width) {
            panel.dataset.userWidthHorizontal = String(globalState.horizontal.width);
        } else {
            delete panel.dataset.userWidthHorizontal;
        }
        if (globalState.horizontal.height) {
            panel.dataset.userHeightHorizontal = String(globalState.horizontal.height);
        } else {
            delete panel.dataset.userHeightHorizontal;
        }

        const computeAnchorAlignedPosition = (rect, panelWidth, panelHeight) => {
            const gap = 8;
            let left = clampValue(viewportWidth - panelWidth - margin, margin, viewportWidth - panelWidth - margin);
            let top = clampValue(margin, margin, viewportHeight - panelHeight - margin);
            if (!rect) {
                return { left, top };
            }
            const spaceOnRight = viewportWidth - rect.right - margin;
            const spaceOnLeft = rect.left - margin;
            if (spaceOnRight >= panelWidth + gap || spaceOnRight >= spaceOnLeft) {
                left = clampValue(rect.right + gap, margin, viewportWidth - panelWidth - margin);
            } else if (spaceOnLeft >= panelWidth + gap) {
                left = clampValue(rect.left - gap - panelWidth, margin, viewportWidth - panelWidth - margin);
            } else {
                left = clampValue(rect.right + gap, margin, viewportWidth - panelWidth - margin);
            }
            const idealTop = rect.top;
            top = clampValue(idealTop, margin, viewportHeight - panelHeight - margin);
            return { left, top };
        };

        const deriveManualCoordinate = (primary, secondary, viewportSize, panelSize) => {
            if (primary && primary !== 'auto') {
                const numeric = parseFloat(primary);
                if (Number.isFinite(numeric)) {
                    return clampValue(numeric, margin, viewportSize - panelSize - margin);
                }
            }
            if (secondary && secondary !== 'auto') {
                const numeric = parseFloat(secondary);
                if (Number.isFinite(numeric)) {
                    const inferred = viewportSize - panelSize - numeric;
                    return clampValue(inferred, margin, viewportSize - panelSize - margin);
                }
            }
            return null;
        };

        const storedLayout = getStoredBatchPanelLayout();
        const isVerticalLayout = storedLayout === 'vertical';

        if (isVerticalLayout) {
            batchPanelHorizontal = false;
            panel.classList.remove('horizontal-batch-layout', 'tall-layout');
            panel.classList.add('vertical-batch-layout');

            const maxH = Math.max(300, viewportHeight - margin * 2);
            const maxW = Math.max(160, Math.min(480, viewportWidth - margin * 2));
            const minW = 160;
            const minH = 160;

            const storedWidth = globalState.vertical.width;
            const storedHeight = globalState.vertical.height;
            const widthValue = Number.isFinite(storedWidth) ? clampValue(storedWidth, minW, maxW) : BATCH_PANEL_VERTICAL_DEFAULT_WIDTH;
            const heightValue = Number.isFinite(storedHeight) ? clampValue(storedHeight, minH, maxH) : null;

            panel.style.width = `${widthValue}px`;
            panel.style.minWidth = `${minW}px`;
            panel.style.maxWidth = `${maxW}px`;
            if (Number.isFinite(heightValue)) {
                panel.style.height = `${heightValue}px`;
            } else {
                panel.style.height = 'auto';
            }
            panel.style.minHeight = `${minH}px`;
            panel.style.maxHeight = `${maxH}px`;

            const storedManual = globalState.vertical.manualPosition === true;
            let left, top;
            const alignHeight = Number.isFinite(heightValue) ? heightValue : minH;

            if (!storedManual) {
                panel.dataset.manualPosition = 'false';
                const aligned = computeAnchorAlignedPosition(anchorRect, widthValue, alignHeight);
                left = aligned.left;
                top = aligned.top;
            } else {
                left = deriveManualCoordinate(globalState.vertical.left, null, viewportWidth, widthValue);
                top = deriveManualCoordinate(globalState.vertical.top, null, viewportHeight, alignHeight);
                if (left === null || top === null) {
                    const fallback = computeAnchorAlignedPosition(anchorRect, widthValue, alignHeight);
                    if (left === null) left = fallback.left;
                    if (top === null) top = fallback.top;
                    panel.dataset.manualPosition = 'false';
                } else {
                    panel.dataset.manualPosition = 'true';
                }
            }
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            applyBatchPanelTransform(panel, { baseTransform: 'none' });
        } else {
            batchPanelHorizontal = true;
            panel.classList.add('horizontal-batch-layout');
            panel.classList.remove('vertical-batch-layout');

            const horizontalMaxWidth = viewportWidth - margin * 2;
            const storedWidth = globalState.horizontal.width;
            const storedHeight = globalState.horizontal.height;

            const widthValue = Number.isFinite(storedWidth) ? clampValue(storedWidth, 320, horizontalMaxWidth) : BATCH_PANEL_HORIZONTAL_DEFAULT_WIDTH;
            panel.style.width = `${widthValue}px`;
            panel.style.minWidth = '320px';
            panel.style.maxWidth = `${horizontalMaxWidth}px`;

            const heightValue = Number.isFinite(storedHeight) ? clampValue(storedHeight, 76, Math.max(180, Math.floor(viewportHeight * 0.6))) : null;
            if (Number.isFinite(heightValue)) {
                panel.style.height = `${heightValue}px`;
            } else {
                panel.style.height = 'auto';
            }
            panel.style.minHeight = '0';
            panel.style.maxHeight = `${Math.max(180, Math.floor(viewportHeight * 0.6))}px`;

            const storedManual = globalState.horizontal.manualPosition === true;
            if (!storedManual) {
                const left = clampValue((viewportWidth - widthValue) / 2, margin, viewportWidth - widthValue - margin);
                panel.style.left = `${left}px`;
                panel.style.right = 'auto';
                panel.style.bottom = `${defaultHorizontalBottom}px`;
                panel.style.top = 'auto';
                panel.dataset.manualPosition = 'false';
            } else {
                const left = deriveManualCoordinate(globalState.horizontal.left, null, viewportWidth, widthValue);
                const top = deriveManualCoordinate(globalState.horizontal.top, null, viewportHeight, Number.isFinite(heightValue) ? heightValue : 180);
                if (left !== null && top !== null) {
                    panel.style.left = `${left}px`;
                    panel.style.top = `${top}px`;
                    panel.style.right = 'auto';
                    panel.style.bottom = 'auto';
                    panel.dataset.manualPosition = 'true';
                } else {
                    const leftFallback = clampValue((viewportWidth - widthValue) / 2, margin, viewportWidth - widthValue - margin);
                    panel.style.left = `${leftFallback}px`;
                    panel.style.right = 'auto';
                    panel.style.bottom = `${defaultHorizontalBottom}px`;
                    panel.style.top = 'auto';
                    panel.dataset.manualPosition = 'false';
                }
            }
            applyBatchPanelTransform(panel, { baseTransform: 'none' });
            if (panel.classList.contains('horizontal-batch-layout')) {
                const currentHeight = parseFloat(panel.style.height) || panel.offsetHeight;
                updateTallLayoutClass(panel, currentHeight);
            }
        }

        fitBatchPanelToContent(panel);
        if (isVerticalLayout && !globalState.vertical.manualPosition) {
            fitBatchPanelToContent(panel, { delay: 0, retries: 1, shrink: true });
        }
    } catch (e) {
        console.error('[批量面板] 恢复状态失败:', e);
    }
}

// 初始化批量面板的拖拽移动功能
function initBatchPanelDrag(panel) {
    const header = panel.querySelector('#batch-panel-header');
    if (!header) return;

    let dragState = null;
    let rafId = null;

    const shouldIgnoreTarget = (target) => {
        if (!target) return false;
        return target.closest('.batch-panel-exit-btn') ||
            target.closest('.batch-panel-help-btn') ||
            target.closest('#batch-panel-count') ||
            target.closest('.batch-help-popover') ||
            target.closest('.context-menu-item') ||
            target.closest('button') ||
            target.closest('a') ||
            target.closest('input') ||
            target.closest('.resize-handle');
    };

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    header.style.cursor = 'grab';
    header.style.touchAction = 'none';

    const applyDragPosition = () => {
        if (!dragState) return;
        rafId = null;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const panelWidth = panel.offsetWidth || 280;
        const panelHeight = panel.offsetHeight || 200;
        const margin = 8;
        const maxLeft = viewportWidth - panelWidth - margin;
        const maxTop = viewportHeight - panelHeight - margin;
        const newLeft = clamp(dragState.pendingLeft, margin, Math.max(margin, maxLeft));
        const newTop = clamp(dragState.pendingTop, margin, Math.max(margin, maxTop));
        panel.style.left = `${newLeft}px`;
        panel.style.top = `${newTop}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    };

    const scheduleUpdate = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(applyDragPosition);
    };

    const finishDrag = () => {
        if (!dragState) return;
        try {
            header.releasePointerCapture(dragState.pointerId);
        } catch (_) {
            // ignore
        }
        header.style.cursor = 'grab';
        // 拖动结束后保持 baseTransform=none，避免横向布局 translateX(-50%) 导致“跳动”
        applyBatchPanelTransform(panel, { baseTransform: 'none' });
        panel.dataset.manualPosition = 'true';
        saveBatchPanelState(panel, currentBatchPanelAnchorInfo);
        dragState = null;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        ;
    };

    header.addEventListener('pointerdown', (e) => {
        if (shouldIgnoreTarget(e.target)) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
            pointerId: e.pointerId,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            pendingLeft: rect.left,
            pendingTop: rect.top,
            previousBaseTransform: panel.dataset.baseTransform || 'none'
        };
        applyBatchPanelTransform(panel, { baseTransform: 'none' });
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        try {
            header.setPointerCapture(e.pointerId);
        } catch (_) {
            // ignore capture failures
        }

        header.style.cursor = 'grabbing';
        applyDragPosition();
        e.preventDefault();
        ;
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        dragState.pendingLeft = e.clientX - dragState.offsetX;
        dragState.pendingTop = e.clientY - dragState.offsetY;
        scheduleUpdate();
    });

    const onPointerUp = (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        finishDrag();
    };

    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);

    ;
}

// 初始化手动选择面板的拖拽移动功能
function initManualSelectorDrag(overlay, dialog, header) {
    if (!header) return;

    let dragState = null;
    let rafId = null;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    header.style.cursor = 'grab';
    header.style.touchAction = 'none';

    // 拖动前如果是 flex 居中，我们需要将其转换为绝对定位，以防拖动时跳跃
    const prepareForDrag = () => {
        if (dialog.style.position === 'absolute') return;
        const rect = dialog.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();

        dialog.style.position = 'absolute';
        dialog.style.margin = '0';
        dialog.style.left = `${rect.left - overlayRect.left}px`;
        dialog.style.top = `${rect.top - overlayRect.top}px`;

        // 移除 flex 居中影响
        overlay.style.alignItems = 'flex-start';
        overlay.style.justifyContent = 'flex-start';
    };

    const applyDragPosition = () => {
        if (!dragState) return;
        rafId = null;

        const overlayRect = overlay.getBoundingClientRect();
        const dialogWidth = dialog.offsetWidth;
        const dialogHeight = dialog.offsetHeight;

        const margin = 8;
        const maxLeft = overlayRect.width - dialogWidth - margin;
        const maxTop = overlayRect.height - dialogHeight - margin;

        const newLeft = clamp(dragState.pendingLeft, margin, Math.max(margin, maxLeft));
        const newTop = clamp(dragState.pendingTop, margin, Math.max(margin, maxTop));

        dialog.style.left = `${newLeft}px`;
        dialog.style.top = `${newTop}px`;
    };

    const scheduleUpdate = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(applyDragPosition);
    };

    const finishDrag = () => {
        if (!dragState) return;
        try {
            header.releasePointerCapture(dragState.pointerId);
        } catch (_) {}
        header.style.cursor = 'grab';
        dragState = null;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    };

    header.addEventListener('pointerdown', (e) => {
        // 排除关闭按钮等
        if (e.target.closest('.manual-selector-close') || e.target.closest('button')) return;

        prepareForDrag();

        const rect = dialog.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();

        dragState = {
            pointerId: e.pointerId,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            pendingLeft: rect.left - overlayRect.left,
            pendingTop: rect.top - overlayRect.top
        };

        try {
            header.setPointerCapture(e.pointerId);
        } catch (_) {}

        header.style.cursor = 'grabbing';
        applyDragPosition();
        e.preventDefault();
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        const overlayRect = overlay.getBoundingClientRect();
        dragState.pendingLeft = e.clientX - overlayRect.left - dragState.offsetX;
        dragState.pendingTop = e.clientY - overlayRect.top - dragState.offsetY;
        scheduleUpdate();
    });

    const onPointerUp = (e) => {
        if (!dragState || e.pointerId !== dragState.pointerId) return;
        finishDrag();
    };

    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);
}

// 根据高度更新tall-layout类（横向布局专用）
function updateTallLayoutClass(panel, height) {
    const threshold = 200; // 高度阈值：200px

    if (height >= threshold) {
        if (!panel.classList.contains('tall-layout')) {
            panel.classList.add('tall-layout');
            ;
        }
    } else {
        if (panel.classList.contains('tall-layout')) {
            panel.classList.remove('tall-layout');
            ;
        }
    }
}

// 初始化批量面板的调整大小功能（四边和四角）
function initBatchPanelResize(panel) {
    const handles = panel.querySelectorAll('.resize-handle');
    if (handles.length === 0) return;

    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let direction = '';

    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = panel.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            startLeft = rect.left;
            startTop = rect.top;

            direction = handle.dataset.direction;

            // 防止文字选中
            e.preventDefault();
            e.stopPropagation();

            ;
        });
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const isVertical = panel.classList.contains('vertical-batch-layout');
        const minWidth = isVertical ? 160 : 360;
        const maxWidth = isVertical ? 480 : Math.min((window.innerWidth || 1920) * 0.95, 1400);
        const minHeight = isVertical ? 160 : 76;
        const maxHeight = (window.innerHeight || 1080) * 0.8;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        // 根据方向调整
        if (direction.includes('e')) {
            newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + deltaX));
        }
        if (direction.includes('w')) {
            newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth - deltaX));
            newLeft = startLeft + (startWidth - newWidth);
        }
        if (direction.includes('s')) {
            newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
        }
        if (direction.includes('n')) {
            newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - deltaY));
            newTop = startTop + (startHeight - newHeight);
        }

        // 根据方向调整并设置样式与数据集
        if (direction.includes('e') || direction.includes('w')) {
            panel.style.width = newWidth + 'px';
            if (isVertical) {
                panel.dataset.userWidthVertical = String(newWidth);
            } else {
                panel.dataset.userWidthHorizontal = String(newWidth);
            }
        }
        if (direction.includes('s') || direction.includes('n')) {
            panel.style.height = newHeight + 'px';  // 始终设置高度为计算值，实现无极调整
            if (isVertical) {
                panel.dataset.userHeightVertical = String(newHeight);
            } else {
                panel.dataset.userHeightHorizontal = String(newHeight);
            }
        }

        // 根据高度动态切换横向/纵向布局（只对横向布局生效）
        if (!isVertical) {
            updateTallLayoutClass(panel, newHeight);
        }

        if (direction.includes('w')) {
            panel.style.left = newLeft + 'px';
            panel.style.right = 'auto';
            panel.dataset.manualPosition = 'true';
        }
        if (direction.includes('n')) {
            panel.style.top = newTop + 'px';
            panel.style.bottom = 'auto';
            panel.dataset.manualPosition = 'true';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            // 最终确认布局类型
            const isVertical = panel.classList.contains('vertical-batch-layout');
            if (!isVertical) {
                const currentHeight = parseFloat(panel.style.height) || panel.offsetHeight;
                updateTallLayoutClass(panel, currentHeight);
            }

            // 保存大小
            saveBatchPanelState(panel);
            ;
        }
    });

    ;
}

// 初始化窗口大小变化监听器（横向布局自适应）
function initBatchPanelWindowResize(panel) {
    let resizeTimer;
    window.addEventListener('resize', () => {
        // 使用防抖，避免频繁触发
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const batchPanel = document.getElementById('batch-action-panel');
            if (!batchPanel) return;

            // 只在横向布局时自动调整宽度
            if (batchPanel.classList.contains('horizontal-batch-layout')) {
                if (batchPanel.dataset.manualPosition === 'true') return;
                const viewportWidth = window.innerWidth;
                const maxPanelWidth = Math.min(viewportWidth * 0.95, 2000);
                const currentWidth = parseFloat(batchPanel.style.width) || 1000;
                if (currentWidth > maxPanelWidth) {
                    batchPanel.style.width = `${maxPanelWidth}px`;
                    ;
                }
                // 不使用 translateX(-50%)，避免拖动/fit 时跳动
                const margin = 16;
                const rect = batchPanel.getBoundingClientRect();
                const left = clampValue((viewportWidth - rect.width) / 2, margin, viewportWidth - rect.width - margin);
                batchPanel.style.left = `${left}px`;
                batchPanel.style.right = 'auto';
                applyBatchPanelTransform(batchPanel, { baseTransform: 'none' });
            }
        }, 200); // 防抖延迟200ms
    });

    ;
}

// 切换批量面板布局（横向/纵向）
let batchPanelHorizontal = false; // 默认纵向
function toggleBatchPanelLayout() {
    const batchPanel = document.getElementById('batch-action-panel');
    if (!batchPanel) return;

    batchPanelHorizontal = !batchPanelHorizontal;
    try {
        const isSidePanel = __isSidePanelModeForAdd();
        const storageKey = isSidePanel ? 'batchPanelLayout_sidepanel' : 'batchPanelLayout_page';
        localStorage.setItem(storageKey, batchPanelHorizontal ? 'horizontal' : 'vertical');
    } catch (e) {
        console.error('[批量面板] 保存布局状态失败:', e);
    }

    // 恢复新布局的状态
    restoreBatchPanelState(batchPanel, currentBatchPanelAnchorInfo);

    // 更新按钮文字
    const btn = batchPanel.querySelector('[data-action="toggle-batch-layout"] span');
    if (btn) {
        const lang = currentLang || 'zh_CN';
        btn.textContent = lang === 'zh_CN' ? '横向/纵向' : 'Horiz/Vert';
    }

    // Reposition help popover/connectors if visible
    try {
        if (batchHelpPopoverEl) {
            showBatchHelpPopover();
        }
    } catch (_) { }
}

// 保存批量面板的位置和大小
function saveBatchPanelState(panel, anchorInfo) {
    try {
        if (!panel) return;
        const isVertical = panel.classList.contains('vertical-batch-layout');
        const globalState = getBatchPanelGlobalState();
        const layoutKey = isVertical ? 'vertical' : 'horizontal';

        // 1. 保存大小
        const currentWidth = parseFloat(panel.style.width);
        const currentHeight = parseFloat(panel.style.height);

        if (isVertical) {
            const userW = panel.dataset.userWidthVertical ? parseFloat(panel.dataset.userWidthVertical) : null;
            const userH = panel.dataset.userHeightVertical ? parseFloat(panel.dataset.userHeightVertical) : null;
            globalState.vertical.width = Number.isFinite(userW) ? userW : (Number.isFinite(currentWidth) ? currentWidth : BATCH_PANEL_VERTICAL_DEFAULT_WIDTH);
            globalState.vertical.height = Number.isFinite(userH) ? userH : null; // 不将自适应的高度误存为用户手动调整的高度
        } else {
            const userW = panel.dataset.userWidthHorizontal ? parseFloat(panel.dataset.userWidthHorizontal) : null;
            const userH = panel.dataset.userHeightHorizontal ? parseFloat(panel.dataset.userHeightHorizontal) : null;
            globalState.horizontal.width = Number.isFinite(userW) ? userW : (Number.isFinite(currentWidth) ? currentWidth : BATCH_PANEL_HORIZONTAL_DEFAULT_WIDTH);
            globalState.horizontal.height = Number.isFinite(userH) ? userH : null; // 不将自适应的高度误存为用户手动调整的高度
        }

        // 2. 保存位置
        const isManual = panel.dataset.manualPosition === 'true';
        globalState[layoutKey].manualPosition = isManual;
        if (isManual) {
            globalState[layoutKey].left = panel.style.left;
            globalState[layoutKey].top = panel.style.top;
        } else {
            globalState[layoutKey].left = null;
            globalState[layoutKey].top = null;
        }

        saveBatchPanelGlobalState(globalState);

        // 同时兼容保存旧的状态映射以防其他模块依赖
        const info = anchorInfo || currentBatchPanelAnchorInfo || getBatchPanelAnchorInfoFromSelection();
        const inferredKey = getBatchPanelAnchorKey(info);
        const anchorKey = panel.dataset.anchorKey || inferredKey;
        if (anchorKey) {
            const anchorRect = info && info.element && typeof info.element.getBoundingClientRect === 'function'
                ? info.element.getBoundingClientRect()
                : null;
            const currentZoom = getCurrentBatchPanelZoom();
            const isVisible = panel && panel.style.display !== 'none';
            const state = {
                left: panel.style.left,
                top: panel.style.top,
                bottom: panel.style.bottom,
                right: panel.style.right,
                width: panel.style.width,
                height: panel.style.height,
                transform: panel.style.transform,
                layout: isVertical ? 'vertical' : 'horizontal',
                visible: isVisible,
                treeType: (info && info.treeType) || panel.dataset.treeType || 'permanent',
                sectionId: (info && info.sectionId) || panel.dataset.sectionId || null,
                anchorKey,
                baseTransform: panel.dataset.baseTransform || 'none',
                manualPosition: isManual,
                zoom: currentZoom,
                userWidthVertical: globalState.vertical.width,
                userHeightVertical: globalState.vertical.height,
                userWidthHorizontal: globalState.horizontal.width,
                userHeightHorizontal: globalState.horizontal.height,
                anchorRect: anchorRect ? {
                    left: anchorRect.left,
                    top: anchorRect.top,
                    width: anchorRect.width,
                    height: anchorRect.height,
                    right: anchorRect.right,
                    bottom: anchorRect.bottom
                } : null
            };
            const stateMapRaw = localStorage.getItem(BATCH_PANEL_STATE_MAP_KEY);
            const stateMap = stateMapRaw ? JSON.parse(stateMapRaw) : {};
            stateMap[anchorKey] = state;
            localStorage.setItem(BATCH_PANEL_STATE_MAP_KEY, JSON.stringify(stateMap));
            localStorage.setItem(BATCH_PANEL_LEGACY_KEY, JSON.stringify(state));
        }
        ;
    } catch (e) {
        console.error('[批量面板] 保存状态失败:', e);
    }
}

// 仅收起面板，当前选择和剪切板状态继续保留。
function minimizeBatchPanel() {
    try { hideBatchHelpPopover(); } catch (_) { }
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        // 先记录位置和尺寸；此处不把“当前收起”固化为下次默认隐藏。
        saveBatchPanelState(batchPanel);
        batchPanel.style.display = 'none';
    }
    setBatchPanelMinimized(true);
    showBatchPanelRestoreButton();
}

function isBatchPanelMinimized() {
    try { return localStorage.getItem(BATCH_PANEL_MINIMIZED_KEY) === 'true'; } catch (_) { return false; }
}

function setBatchPanelMinimized(minimized) {
    try { localStorage.setItem(BATCH_PANEL_MINIMIZED_KEY, minimized ? 'true' : 'false'); } catch (_) { }
}

function showBatchPanelRestoreButton(options = {}) {
    const host = getBatchPanelRestoreHost();
    if (!host) return;

    let button = document.getElementById('batch-panel-restore-btn');
    if (!button) {
        button = document.createElement('button');
        button.id = 'batch-panel-restore-btn';
        button.className = 'batch-panel-restore-btn';
        button.type = 'button';
        button.innerHTML = '<i class="fas fa-tasks" aria-hidden="true"></i>';
        button.addEventListener('pointerdown', beginBatchPanelRestoreDrag);
        button.addEventListener('pointermove', moveBatchPanelRestoreDrag);
        button.addEventListener('pointerup', finishBatchPanelRestoreDrag);
        button.addEventListener('pointercancel', cancelBatchPanelRestoreDrag);
        button.addEventListener('click', (event) => {
            if (button.dataset.dragged === 'true') {
                delete button.dataset.dragged;
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            showBatchPanel();
        });
    }

    if (button.parentElement !== host) host.appendChild(button);
    const isZh = (currentLang || 'zh_CN') === 'zh_CN';
    const label = isZh ? '打开批量操作面板' : 'Open batch panel';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.hidden = false;
    applyBatchPanelRestoreDock(button, readBatchPanelRestoreDock());
    bindBatchPanelRestoreResize();
    if (options.attention === true) {
        button.classList.remove('batch-panel-restore-attention');
        void button.offsetWidth;
        button.classList.add('batch-panel-restore-attention');
    }
}

function hideBatchPanelRestoreButton() {
    const button = document.getElementById('batch-panel-restore-btn');
    if (button) button.remove();
}

function getBatchPanelRestoreHost() {
    return document.getElementById('canvasWorkspace') || document.body;
}

function getBatchPanelRestoreBounds() {
    const host = getBatchPanelRestoreHost();
    if (!host) return null;
    if (host === document.body) {
        return { host, left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, fixed: true };
    }
    const rect = host.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { host, left: rect.left, top: rect.top, width: rect.width, height: rect.height, fixed: false };
}

function normalizeBatchPanelRestoreDock(state) {
    const edge = String(state && state.edge || '').toLowerCase();
    const ratio = Number(state && state.ratio);
    return {
        edge: ['left', 'right', 'top', 'bottom'].includes(edge) ? edge : 'right',
        ratio: Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0.75
    };
}

function readBatchPanelRestoreDock() {
    try {
        return normalizeBatchPanelRestoreDock(JSON.parse(localStorage.getItem(BATCH_PANEL_RESTORE_DOCK_KEY) || 'null'));
    } catch (_) {
        return normalizeBatchPanelRestoreDock(null);
    }
}

function writeBatchPanelRestoreDock(state) {
    const normalized = normalizeBatchPanelRestoreDock(state);
    try { localStorage.setItem(BATCH_PANEL_RESTORE_DOCK_KEY, JSON.stringify(normalized)); } catch (_) { }
    return normalized;
}

function getBatchPanelRestoreSize(edge) {
    return (edge === 'left' || edge === 'right')
        ? { width: 18, height: 24 }
        : { width: 24, height: 18 };
}

function applyBatchPanelRestoreDock(button, state) {
    const bounds = getBatchPanelRestoreBounds();
    if (!button || !bounds) return;
    const dock = normalizeBatchPanelRestoreDock(state);
    const size = getBatchPanelRestoreSize(dock.edge);
    // 完全复用悬浮工具窗收起按钮的锚点和图标偏移：
    // 锚点距画布边缘 10px，图标再按各边 CSS 的 4px/12px 偏移伸出。
    const margin = 10;
    const anchorWidth = size.width;
    const anchorHeight = size.height;
    const anchorMaxLeft = Math.max(margin, bounds.width - anchorWidth - margin);
    const anchorMaxTop = Math.max(margin, bounds.height - anchorHeight - margin);
    let left = margin;
    let top = margin;
    if (dock.edge === 'left') {
        left = margin + 4;
        top = margin + ((anchorMaxTop - margin) * dock.ratio) - 12;
    } else if (dock.edge === 'right') {
        left = anchorMaxLeft - 22;
        top = margin + ((anchorMaxTop - margin) * dock.ratio) - 12;
    } else if (dock.edge === 'top') {
        left = margin + ((anchorMaxLeft - margin) * dock.ratio) + 12;
        top = margin + 4;
    } else {
        left = margin + ((anchorMaxLeft - margin) * dock.ratio) + 12;
        top = anchorMaxTop - 22;
    }

    button.style.position = bounds.fixed ? 'fixed' : 'absolute';
    button.style.left = `${Math.round(bounds.fixed ? bounds.left + left : left)}px`;
    button.style.top = `${Math.round(bounds.fixed ? bounds.top + top : top)}px`;
    button.dataset.dockEdge = dock.edge;
}

function resolveBatchPanelRestoreDockFromPointer(clientX, clientY, options = {}) {
    const bounds = getBatchPanelRestoreBounds();
    if (!bounds) return null;
    const localX = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
    const localY = Math.max(0, Math.min(bounds.height, clientY - bounds.top));
    const distances = [
        { edge: 'left', value: localX },
        { edge: 'right', value: bounds.width - localX },
        { edge: 'top', value: localY },
        { edge: 'bottom', value: bounds.height - localY }
    ];
    distances.sort((a, b) => a.value - b.value);

    let edge = String(options.forcedEdge || '').toLowerCase();
    if (!['left', 'right', 'top', 'bottom'].includes(edge)) {
        edge = distances[0].edge;
        const currentEdge = String(options.currentEdge || '').toLowerCase();
        const currentMatch = distances.find((item) => item.edge === currentEdge);
        if (currentMatch && (currentMatch.value - distances[0].value) <= 10) {
            edge = currentEdge;
        }
    }
    const size = getBatchPanelRestoreSize(edge);
    const margin = 10;
    const available = edge === 'left' || edge === 'right'
        ? Math.max(1, bounds.height - size.height - margin * 2)
        : Math.max(1, bounds.width - size.width - margin * 2);
    // This receives the same virtual dock anchor coordinate as the reference
    // floating tools button, not the visible icon's offset position.
    const anchorCoordinate = edge === 'left' || edge === 'right' ? localY : localX;
    return normalizeBatchPanelRestoreDock({ edge, ratio: (anchorCoordinate - margin) / available });
}

function getBatchPanelRestoreAnchorPoint(state) {
    const bounds = getBatchPanelRestoreBounds();
    if (!bounds) return null;
    const dock = normalizeBatchPanelRestoreDock(state);
    const size = getBatchPanelRestoreSize(dock.edge);
    const margin = 10;
    const anchorMaxLeft = Math.max(margin, bounds.width - size.width - margin);
    const anchorMaxTop = Math.max(margin, bounds.height - size.height - margin);
    let left = margin;
    let top = margin;

    if (dock.edge === 'left') {
        top = margin + ((anchorMaxTop - margin) * dock.ratio);
    } else if (dock.edge === 'right') {
        left = anchorMaxLeft;
        top = margin + ((anchorMaxTop - margin) * dock.ratio);
    } else {
        left = margin + ((anchorMaxLeft - margin) * dock.ratio);
        top = dock.edge === 'top' ? margin : anchorMaxTop;
    }

    return { left: bounds.left + left, top: bounds.top + top };
}

function resolveBatchPanelRestoreAdjacentEdgeFromCorner(currentEdge, ratio, dx, dy) {
    const edge = normalizeBatchPanelRestoreDock({ edge: currentEdge }).edge;
    const safeRatio = normalizeBatchPanelRestoreDock({ ratio }).ratio;
    const nearStart = safeRatio <= BATCH_PANEL_RESTORE_CORNER_SWITCH_THRESHOLD;
    const nearEnd = safeRatio >= (1 - BATCH_PANEL_RESTORE_CORNER_SWITCH_THRESHOLD);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (edge === 'left' || edge === 'right') {
        const towardInner = edge === 'left' ? dx > 0 : dx < 0;
        if (nearStart && dy < -BATCH_PANEL_RESTORE_DRAG_ACTIVATE_THRESHOLD) return 'top';
        if (nearEnd && dy > BATCH_PANEL_RESTORE_DRAG_ACTIVATE_THRESHOLD) return 'bottom';
        if (!towardInner || absDx < BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD || absDx < absDy) return null;
        if (nearStart) return 'top';
        if (nearEnd) return 'bottom';
        return null;
    }

    const towardInner = edge === 'top' ? dy > 0 : dy < 0;
    if (nearStart && dx < -BATCH_PANEL_RESTORE_DRAG_ACTIVATE_THRESHOLD) return 'left';
    if (nearEnd && dx > BATCH_PANEL_RESTORE_DRAG_ACTIVATE_THRESHOLD) return 'right';
    if (!towardInner || absDy < BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD || absDy <= absDx) return null;
    if (nearStart) return 'left';
    if (nearEnd) return 'right';
    return null;
}

function confirmBatchPanelRestoreCornerEdgeSwitch(drag, event, currentEdge, candidateEdge) {
    if (!drag || !candidateEdge || candidateEdge === currentEdge) {
        if (drag) drag.cornerSwitchCandidate = null;
        return currentEdge;
    }

    const candidate = drag.cornerSwitchCandidate;
    if (!candidate || candidate.edge !== candidateEdge) {
        drag.cornerSwitchCandidate = {
            edge: candidateEdge,
            x: event.clientX,
            y: event.clientY
        };
        return currentEdge;
    }

    if (Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < BATCH_PANEL_RESTORE_CORNER_SWITCH_CONFIRM_DISTANCE) {
        return currentEdge;
    }

    drag.cornerSwitchCandidate = null;
    return candidateEdge;
}

function resolveBatchPanelRestoreFinalEdgeFromRelease(edge, dx, dy) {
    const currentEdge = normalizeBatchPanelRestoreDock({ edge }).edge;
    const horizontalDominant = Math.abs(dx) >= Math.abs(dy);
    if (currentEdge === 'left') {
        return horizontalDominant && dx >= BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD ? 'right' : 'left';
    }
    if (currentEdge === 'right') {
        return horizontalDominant && dx <= -BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD ? 'left' : 'right';
    }
    if (currentEdge === 'top') {
        return !horizontalDominant && dy >= BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD ? 'bottom' : 'top';
    }
    return !horizontalDominant && dy <= -BATCH_PANEL_RESTORE_DRAG_SWITCH_THRESHOLD ? 'top' : 'bottom';
}

function resolveBatchPanelRestoreDockDuringDrag(event, drag, dx, dy) {
    const current = drag && drag.currentDock ? drag.currentDock : readBatchPanelRestoreDock();
    const adjacentCandidate = resolveBatchPanelRestoreAdjacentEdgeFromCorner(current.edge, current.ratio, dx, dy);
    const adjacentEdge = confirmBatchPanelRestoreCornerEdgeSwitch(drag, event, current.edge, adjacentCandidate);
    const targetX = event.clientX - (drag.anchorOffsetX || 0);
    const targetY = event.clientY - (drag.anchorOffsetY || 0);
    return resolveBatchPanelRestoreDockFromPointer(targetX, targetY, {
        currentEdge: adjacentEdge || current.edge,
        forcedEdge: adjacentEdge || ''
    }) || current;
}

function resolveBatchPanelRestoreFinalDockState(event, drag, dx, dy) {
    const current = drag && drag.currentDock ? drag.currentDock : readBatchPanelRestoreDock();
    const edge = resolveBatchPanelRestoreFinalEdgeFromRelease(current.edge, dx, dy);
    const targetX = event.clientX - (drag.anchorOffsetX || 0);
    const targetY = event.clientY - (drag.anchorOffsetY || 0);
    return resolveBatchPanelRestoreDockFromPointer(targetX, targetY, {
        currentEdge: edge,
        forcedEdge: edge
    }) || { edge, ratio: current.ratio };
}

function clearBatchPanelRestoreHintHoldTimer(button) {
    if (!button || button.__batchRestoreHintHoldTimer == null) return;
    window.clearTimeout(button.__batchRestoreHintHoldTimer);
    button.__batchRestoreHintHoldTimer = null;
}

function clearBatchPanelRestoreDragVisualState(button) {
    if (!button) return;
    clearBatchPanelRestoreHintHoldTimer(button);
    button.classList.remove('canvas-floating-hold-active');
    button.classList.remove('canvas-floating-dragging');
}

function scheduleBatchPanelRestoreHintReveal(button) {
    clearBatchPanelRestoreHintHoldTimer(button);
    button.__batchRestoreHintHoldTimer = window.setTimeout(() => {
        button.__batchRestoreHintHoldTimer = null;
        if (!button.__batchRestoreDrag) return;
        button.classList.add('canvas-floating-hold-active');
    }, BATCH_PANEL_RESTORE_HINT_HOLD_DELAY_MS);
}

function beginBatchPanelRestoreDrag(event) {
    if (event.button !== 0) return;
    const button = event.currentTarget;
    clearBatchPanelRestoreDragVisualState(button);
    const initialDock = readBatchPanelRestoreDock();
    const anchorPoint = getBatchPanelRestoreAnchorPoint(initialDock);
    button.__batchRestoreDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        currentDock: initialDock,
        cornerSwitchCandidate: null,
        anchorOffsetX: anchorPoint ? event.clientX - anchorPoint.left : 0,
        anchorOffsetY: anchorPoint ? event.clientY - anchorPoint.top : 0
    };
    button.dataset.dockEdge = initialDock.edge;
    try { button.setPointerCapture(event.pointerId); } catch (_) { }
    scheduleBatchPanelRestoreHintReveal(button);
    event.preventDefault();
}

function moveBatchPanelRestoreDrag(event) {
    const button = event.currentTarget;
    const drag = button.__batchRestoreDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) >= BATCH_PANEL_RESTORE_DRAG_ACTIVATE_THRESHOLD) {
        drag.moved = true;
        clearBatchPanelRestoreHintHoldTimer(button);
        button.classList.add('canvas-floating-hold-active');
        button.classList.add('canvas-floating-dragging');
    }
    if (!drag.moved) return;
    const dock = resolveBatchPanelRestoreDockDuringDrag(event, drag, dx, dy);
    if (dock) {
        drag.currentDock = dock;
        applyBatchPanelRestoreDock(button, dock);
    }
    event.preventDefault();
    event.stopPropagation();
}

function finishBatchPanelRestoreDrag(event) {
    const button = event.currentTarget;
    const drag = button.__batchRestoreDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const dock = resolveBatchPanelRestoreFinalDockState(event, drag, dx, dy);
        if (dock) {
            writeBatchPanelRestoreDock(dock);
            applyBatchPanelRestoreDock(button, dock);
        }
        button.dataset.dragged = 'true';
    }
    try { button.releasePointerCapture(event.pointerId); } catch (_) { }
    delete button.__batchRestoreDrag;
    clearBatchPanelRestoreDragVisualState(button);
}

function cancelBatchPanelRestoreDrag(event) {
    const button = event.currentTarget;
    if (!button.__batchRestoreDrag || button.__batchRestoreDrag.pointerId !== event.pointerId) return;
    try { button.releasePointerCapture(event.pointerId); } catch (_) { }
    delete button.__batchRestoreDrag;
    clearBatchPanelRestoreDragVisualState(button);
}

function bindBatchPanelRestoreResize() {
    if (document.documentElement.dataset.batchPanelRestoreResizeBound === 'true') return;
    document.documentElement.dataset.batchPanelRestoreResizeBound = 'true';
    window.addEventListener('resize', () => {
        const button = document.getElementById('batch-panel-restore-btn');
        if (button) applyBatchPanelRestoreDock(button, readBatchPanelRestoreDock());
    });
}

// 隐藏批量面板，显示顶部工具栏
function hideBatchPanel() {
    setBatchPanelMinimized(false);
    hideBatchPanelRestoreButton();
    // “关闭”是全局退出，不保留当前栏目的待剪切橙色状态。
    if (selectMode) {
        exitSelectMode();
        return;
    }
    cancelPendingBookmarkCut();
    const batchPanel = document.getElementById('batch-action-panel');
    if (batchPanel) {
        batchPanel.style.display = 'none';
        // 保存隐藏状态
        saveBatchPanelState(batchPanel);
    }

    // 显示顶部工具栏
    updateBatchToolbar();
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'flex';
    }

    ;
}

// 显示批量面板，隐藏顶部工具栏
function showBatchPanel() {
    setBatchPanelMinimized(false);
    hideBatchPanelRestoreButton();
    const batchPanel = document.getElementById('batch-action-panel');

    // 如果面板不存在，创建它
    if (!batchPanel) {
        const fakeEvent = { preventDefault: () => { }, stopPropagation: () => { } };
        showBatchContextMenu(fakeEvent);
        ;
    } else {
        // 如果面板已存在，直接显示
        batchPanel.style.display = 'block';
        const anchorInfo = getBatchPanelAnchorInfoFromSelection();
        if (anchorInfo) {
            currentBatchPanelAnchorInfo = anchorInfo;
            restoreBatchPanelState(batchPanel, anchorInfo);
        }
        ;
        // 保存显示状态
        saveBatchPanelState(batchPanel);
        fitBatchPanelToContent(batchPanel, { delay: 0 });
    }

    // 隐藏顶部工具栏
    const toolbar = document.getElementById('batch-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
    }

    ;
}


// =================================================================================
// XI. BLANK AREA, CANVAS OBJECT MENUS & CORE GLOBAL EXPORTS (空白区、画布对象菜单与核心全局导出)
// =================================================================================

// 切换右键菜单布局（横向/纵向）
let contextMenuHorizontal = true;  // 默认横向（根据阈值自动，再可被用户覆盖）
function toggleContextMenuLayout() {
    const contextMenu = document.getElementById('bookmark-context-menu');
    if (!contextMenu) return;
    // 读作用域：permanent | temporary
    const scope = contextMenu.dataset.menuScope || 'permanent';
    contextMenuHorizontal = !contextMenuHorizontal;

    if (contextMenuHorizontal) {
        contextMenu.classList.add('horizontal-layout');
        ;
    } else {
        contextMenu.classList.remove('horizontal-layout');
        ;
    }

    // 保存“按类型”的状态到localStorage
    try {
        localStorage.setItem(`contextMenuLayout_${scope}`, contextMenuHorizontal ? 'horizontal' : 'vertical');
    } catch (e) {
        console.error('[右键菜单] 保存布局状态失败:', e);
    }
}

// 恢复保存的右键菜单布局状态
function restoreContextMenuLayout() {
    try {
        const contextMenu = document.getElementById('bookmark-context-menu');
        if (!contextMenu) return;
        const scope = contextMenu.dataset.menuScope || 'permanent';
        const savedLayout = localStorage.getItem(`contextMenuLayout_${scope}`);
        if (savedLayout === 'vertical') {
            contextMenuHorizontal = false;
            contextMenu.classList.remove('horizontal-layout');
            ;
        } else if (savedLayout === 'horizontal') {
            contextMenuHorizontal = true;
            contextMenu.classList.add('horizontal-layout');
            ;
        } else {
            // 未指定，保持当前（由自动阈值决定）
        }
    } catch (e) {
        console.error('[右键菜单] 恢复布局状态失败:', e);
    }
}

// 显示空白区域右键菜单
function __resolvePermanentBlankAddParentIdFromEvent(event) {
    try {
        const target = event && event.target ? event.target : null;
        const section = target && target.closest ? target.closest('.permanent-bookmark-section') : null;
        const scope = section || document.getElementById('permanentSection') || document.querySelector('.permanent-bookmark-section');
        const tree = scope ? scope.querySelector('.bookmark-tree') : (document.getElementById('bookmarkTree') || document.querySelector('.bookmark-tree[data-tree-type="permanent"]'));
        if (!tree) return null;

        const level1Folder = tree.querySelector('.tree-item[data-node-type="folder"][data-node-level="1"][data-node-id]');
        const level1Id = level1Folder && level1Folder.dataset ? String(level1Folder.dataset.nodeId || '').trim() : '';
        if (level1Id && level1Id !== '0') return level1Id;

        const level0Folder = tree.querySelector('.tree-item[data-node-type="folder"][data-node-level="0"][data-node-id]');
        const level0Id = level0Folder && level0Folder.dataset ? String(level0Folder.dataset.nodeId || '').trim() : '';
        if (level0Id && level0Id !== '0') return level0Id;
    } catch (_) { }
    return null;
}

function __resolveCanvasContextMenuPositionFromEvent(event) {
    try {
        const workspace = document.getElementById('canvasWorkspace');
        if (!workspace || !event) return null;
        const rect = workspace.getBoundingClientRect();
        const zoom = (typeof CanvasState !== 'undefined' && CanvasState && typeof CanvasState.zoom === 'number' && CanvasState.zoom > 0)
            ? CanvasState.zoom : 1;
        const panX = (typeof CanvasState !== 'undefined' && CanvasState && typeof CanvasState.panOffsetX === 'number')
            ? CanvasState.panOffsetX : 0;
        const panY = (typeof CanvasState !== 'undefined' && CanvasState && typeof CanvasState.panOffsetY === 'number')
            ? CanvasState.panOffsetY : 0;
        const left = (event.clientX - rect.left - panX) / zoom;
        const top = (event.clientY - rect.top - panY) / zoom;
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        return { left, top };
    } catch (_) {
        return null;
    }
}

function __createCanvasQuickAddTempSectionAtPosition(left, top) {
    const lang = currentLang || 'zh_CN';
    const x = Number(left);
    const y = Number(top);
    const canvas = (typeof window !== 'undefined') ? window.CanvasModule : null;
    const options = {
        label: lang === 'zh_CN' ? '添加' : 'Add',
        source: 'quick-add'
    };
    if (canvas && typeof canvas.createEmptyTempSection === 'function') {
        return canvas.createEmptyTempSection(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, options);
    }
    if (typeof createEmptyTempSection === 'function') {
        return createEmptyTempSection(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, options);
    }
    return null;
}

async function __openCanvasBlankAddSecondaryAtPosition(left, top) {
    const lang = currentLang || 'zh_CN';
    const baseContext = {
        treeType: 'temporary',
        sectionId: '__canvas-blank-add-target__',
        nodeId: null,
        isFolder: true,
        blankRoot: true
    };
    const remembered = __readBookmarkAddTemplate();
    let initialActionType = remembered && remembered.actionType
        ? __normalizeBookmarkAddActionType(remembered.actionType)
        : 'add-page';
    if (initialActionType === 'add-current-tab' && !__isSidePanelModeForAdd()) {
        initialActionType = 'add-page';
    }
    const selected = await showBookmarkAddSecondaryModal(baseContext, {
        actionType: initialActionType,
        position: 'inside',
        windowAsFolder: remembered ? remembered.windowAsFolder : undefined,
        locateAfterAction: false
    });
    if (!selected) return false;
    const actionType = __normalizeBookmarkAddActionType(selected.actionType);
    if (actionType === 'add-all-windows-card-group') {
        const windowAsFolder = __normalizeBookmarkAddWindowAsFolder(selected.windowAsFolder);
        const normalizedSelection = {
            actionType,
            position: 'inside',
            windowAsFolder: windowAsFolder,
            locateAfterAction: false
        };
        __writeBookmarkAddTemplate(normalizedSelection);
        const archiveOptions = {
            position: { x: left, y: top },
            windowAsFolder: windowAsFolder
        };
        if (typeof archiveAllWindowsToCardGroup === 'function') {
            await archiveAllWindowsToCardGroup(archiveOptions);
        } else if (window.archiveAllWindowsToCardGroup) {
            await window.archiveAllWindowsToCardGroup(archiveOptions);
        }
        return true;
    }
    const sectionId = __createCanvasQuickAddTempSectionAtPosition(left, top);
    if (!sectionId) return false;
    const context = Object.assign({}, baseContext, { sectionId });
    const normalizedSelection = {
        actionType: __normalizeBookmarkAddActionType(selected.actionType),
        position: __normalizeBookmarkAddPosition(context, selected.position),
        windowAsFolder: (__normalizeBookmarkAddActionType(selected.actionType) === 'add-current-window' || __normalizeBookmarkAddActionType(selected.actionType) === 'add-all-windows-card-group')
            && __normalizeBookmarkAddWindowAsFolder(selected.windowAsFolder),
        locateAfterAction: false
    };
    __writeBookmarkAddTemplate(normalizedSelection);
    try {
        return await executeBookmarkAddAction(context, normalizedSelection, { saveTemplate: false });
    } catch (error) {
        console.error('[右键菜单] 画布空白添加操作失败:', error);
        alert(lang === 'zh_CN' ? `添加失败: ${error.message}` : `Add failed: ${error.message}`);
        return false;
    }
}

async function __createCanvasBlankMdCardAtPosition(left, top) {
    const x = Number(left);
    const y = Number(top);
    const canvas = (typeof window !== 'undefined') ? window.CanvasModule : null;
    const create = canvas && typeof canvas.createMdNode === 'function'
        ? canvas.createMdNode.bind(canvas)
        : (typeof createMdNode === 'function' ? createMdNode : null);
    if (!create) return null;
    const nodeId = await create(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, '');
    requestAnimationFrame(() => {
        const el = document.getElementById(nodeId);
        if (!el) return;
        const editor = el.querySelector('.md-canvas-editor');
        if (editor) editor.focus();
    });
    return nodeId;
}

function __getCanvasCardGroupCreateTitles(lang) {
    return {
        modalTitle: lang === 'zh_CN' ? '创建卡片组' : 'Create Card Group',
        modalIntro: lang === 'zh_CN' ? '创建固定卡片组。当前仅创建入口，功能暂未完成。' : 'Create a fixed card group. This only creates the entry for now.',
        fixedTitle: lang === 'zh_CN' ? '固定组' : 'Fixed Group',
        fixedDesc: lang === 'zh_CN' ? '对应「固定组」规则与后续存储实现。' : 'Maps to fixed group rules and future storage implementation.',
        closeText: lang === 'zh_CN' ? '关闭' : 'Close',
        pendingText: lang === 'zh_CN' ? '创建卡片组暂未完成。' : 'Create card group is not completed yet.'
    };
}

function __invokeCanvasCardGroupCreateHandler(kind, left, top, title, options = {}) {
    const x = Number(left);
    const y = Number(top);
    const payload = {
        kind,
        title,
        canvasPosition: {
            left: Number.isFinite(x) ? x : 0,
            top: Number.isFinite(y) ? y : 0
        },
        completed: false
    };
    if (options && typeof options === 'object') {
        if (options.empty === true) payload.empty = true;
        if (Number.isFinite(Number(options.width))) payload.width = Number(options.width);
        if (Number.isFinite(Number(options.height))) payload.height = Number(options.height);
    }
    const canvas = (typeof window !== 'undefined') ? window.CanvasModule : null;
    const groupApi = (typeof window !== 'undefined') ? window.CanvasGroups : null;
    const create = groupApi && typeof groupApi.createCardGroup === 'function'
        ? groupApi.createCardGroup.bind(groupApi)
        : (canvas && typeof canvas.createCardGroup === 'function' ? canvas.createCardGroup.bind(canvas) : null);
    if (create) return create(payload);
    const lang = currentLang || 'zh_CN';
    const titles = __getCanvasCardGroupCreateTitles(lang);
    try { alert(titles.pendingText); } catch (_) { }
    return payload;
}

function __getCanvasCardGroupCreateActions(left, top) {
    const lang = currentLang || 'zh_CN';
    const titles = __getCanvasCardGroupCreateTitles(lang);
    return [
        {
            key: 'fixed-group',
            title: titles.fixedTitle,
            description: titles.fixedDesc,
            handler: () => __invokeCanvasCardGroupCreateHandler('fixed', left, top, titles.fixedTitle)
        }
    ];
}

async function __openCanvasCardGroupCreateUiAtPosition(left, top) {
    const lang = currentLang || 'zh_CN';
    const titles = __getCanvasCardGroupCreateTitles(lang);
    const actions = __getCanvasCardGroupCreateActions(left, top);
    let modal = document.getElementById('canvasCardGroupCreateModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'canvasCardGroupCreateModal';
        modal.className = 'modal content-center canvas-card-group-create-modal';
        getOverlayContainer().appendChild(modal);
    }
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header compact">
                <h3>${escapeHtml(titles.modalTitle)}</h3>
                <button class="modal-close" type="button"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="bookmark-add-secondary-form">
                    <div class="bookmark-add-secondary-field">
                        <label>${escapeHtml(titles.modalIntro)}</label>
                        <div class="bookmark-add-secondary-grid">
                            ${actions.map(action => `
                                <button class="bookmark-add-secondary-choice" type="button" data-card-group-action="${escapeHtml(action.key)}">
                                    <span class="bookmark-add-secondary-choice-main"><i class="fas fa-object-group"></i><span>${escapeHtml(action.title)}</span></span>
                                    <span class="bookmark-add-secondary-choice-desc">${escapeHtml(action.description)}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div class="bookmark-add-secondary-actions">
                    <button class="modal-btn" type="button" data-card-group-close="true">${escapeHtml(titles.closeText)}</button>
                </div>
            </div>
        </div>
    `;
    modal.classList.add('show');
    await new Promise((resolve) => {
        let settled = false;
        const close = () => {
            if (settled) return;
            settled = true;
            modal.classList.remove('show');
            modal.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKeydown, true);
            resolve(false);
        };
        const choose = async (key) => {
            const action = actions.find(item => item.key === key);
            if (!action) return;
            try { await action.handler(); } catch (error) { console.warn('[右键菜单] 创建卡片组入口执行失败:', error); }
            close();
        };
        const onClick = (event) => {
            const closeBtn = event.target && event.target.closest ? event.target.closest('.modal-close, [data-card-group-close="true"]') : null;
            if (closeBtn || event.target === modal) {
                close();
                return;
            }
            const actionBtn = event.target && event.target.closest ? event.target.closest('[data-card-group-action]') : null;
            if (actionBtn) {
                event.preventDefault();
                choose(actionBtn.dataset.cardGroupAction);
            }
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        modal.addEventListener('click', onClick);
        document.addEventListener('keydown', onKeydown, true);
    });
}

function showBlankAreaContextMenu(e, sectionId, treeType) {
    e.preventDefault();
    e.stopPropagation();

    const lang = currentLang || 'zh_CN';
    const menuItems = [];
    const preferredPermanentParentId = treeType === 'permanent' ? __resolvePermanentBlankAddParentIdFromEvent(e) : null;
    const canvasPosition = treeType === 'canvas' ? __resolveCanvasContextMenuPositionFromEvent(e) : null;

    if (treeType === 'canvas') {
        menuItems.push({
            action: 'add-via-secondary-at-position',
            label: lang === 'zh_CN' ? '添加' : 'Add',
            icon: 'plus-circle',
            sectionId,
            treeType,
            canvasLeft: canvasPosition ? canvasPosition.left : '',
            canvasTop: canvasPosition ? canvasPosition.top : ''
        });
        menuItems.push({
            action: 'add-permanent-copy-at-position',
            label: lang === 'zh_CN' ? '添加永久栏目副本' : 'Add permanent section copy',
            icon: 'copy',
            sectionId,
            treeType,
            canvasLeft: canvasPosition ? canvasPosition.left : '',
            canvasTop: canvasPosition ? canvasPosition.top : ''
        });
        menuItems.push({
            action: 'add-empty-temp-card-at-position',
            label: lang === 'zh_CN' ? '添加临时栏目' : 'Add temporary section',
            icon: 'plus-square',
            sectionId,
            treeType,
            canvasLeft: canvasPosition ? canvasPosition.left : '',
            canvasTop: canvasPosition ? canvasPosition.top : ''
        });
        menuItems.push({
            action: 'add-blank-md-card-at-position',
            label: lang === 'zh_CN' ? '添加空白栏目' : 'Add blank section',
            icon: 'sticky-note',
            sectionId,
            treeType,
            canvasLeft: canvasPosition ? canvasPosition.left : '',
            canvasTop: canvasPosition ? canvasPosition.top : ''
        });
        menuItems.push({
            action: 'create-card-group-at-position',
            label: lang === 'zh_CN' ? '创建卡片组' : 'Create card group',
            icon: 'object-group',
            sectionId,
            treeType,
            canvasLeft: canvasPosition ? canvasPosition.left : '',
            canvasTop: canvasPosition ? canvasPosition.top : ''
        });
        menuItems.push({ separator: true });
        menuItems.push({
            action: 'import-at-position',
            label: lang === 'zh_CN' ? '此位置导入' : 'Import here',
            icon: 'file-import',
            sectionId,
            treeType,
            canvasLeft: canvasPosition ? canvasPosition.left : '',
            canvasTop: canvasPosition ? canvasPosition.top : ''
        });
    }

    if (treeType !== 'canvas') {
        menuItems.push({
            action: 'add-entry-blank',
            labelHTML: `<span class="swsg-title">${lang === 'zh_CN' ? '添加' : 'Add'}</span><div class="swsg-badge-row"><span class="sub-badge" data-sub-action="add-template-run">${lang === 'zh_CN' ? '上次' : 'Last'}</span></div>`,
            label: lang === 'zh_CN' ? '添加' : 'Add',
            icon: 'plus-circle',
            className: 'add-entry-option',
            sectionId,
            treeType,
            preferredParentId: preferredPermanentParentId
        });
    }

    // 粘贴选项（如果剪贴板有内容）
    if (treeType !== 'canvas' && hasClipboard()) {
        menuItems.push({
            action: 'paste-blank',
            label: lang === 'zh_CN' ? '粘贴' : 'Paste',
            icon: 'paste',
            sectionId,
            treeType
        });
    }

    if (menuItems.length === 0) {
        return;
    }

    // 渲染菜单
    const contextMenu = document.getElementById('bookmark-context-menu');
    if (!contextMenu) return;

    contextMenu.classList.remove('horizontal-layout', 'density-xs', 'density-sm', 'density-md', 'density-lg');
    contextMenu.classList.add('density-sm');
    contextMenu.classList.remove('lang-zh', 'lang-en');
    contextMenu.classList.add(lang === 'zh_CN' ? 'lang-zh' : 'lang-en');
    contextMenu.dataset.menuScope = treeType === 'canvas' ? 'canvas-blank' : '';

    const menuHTML = menuItems.map(item => {
        if (item.separator) {
            return '<div class="context-menu-separator"></div>';
        }
        const icon = item.icon ? `<i class="fas fa-${item.icon}"></i>` : '';
        const extraClass = item.className ? item.className : '';
        const labelContent = item.labelHTML ? item.labelHTML : `<span>${item.label}</span>`;
        return `
            <div class="context-menu-item ${extraClass}" data-action="${item.action}" data-section-id="${item.sectionId || ''}" data-tree-type="${item.treeType || ''}" data-parent-id="${item.preferredParentId || ''}" data-canvas-left="${item.canvasLeft || ''}" data-canvas-top="${item.canvasTop || ''}">
                ${icon}
                <span class="context-menu-item-label">${labelContent}</span>
            </div>
        `;
    }).join('');

    contextMenu.innerHTML = menuHTML;

    // 绑定子徽章（如“上次”）点击事件
    contextMenu.querySelectorAll('.sub-badge[data-sub-action]').forEach(badge => {
        badge.addEventListener('click', async (clickEvent) => {
            const subAction = badge.dataset.subAction;
            if (!subAction) return;
            clickEvent.preventDefault();
            clickEvent.stopPropagation();

            const item = badge.closest('.context-menu-item');
            if (!item) return;
            const sid = item.dataset.sectionId;
            const ttype = item.dataset.treeType;
            const preferredParentId = item.dataset.parentId;

            hideContextMenu();

            if (subAction === 'add-template-run') {
                const addContext = {
                    treeType: ttype === 'temporary' ? 'temporary' : 'permanent',
                    sectionId: ttype === 'temporary' ? sid : null,
                    nodeId: null,
                    isFolder: true,
                    blankRoot: true,
                    preferredParentId: ttype === 'permanent' && preferredParentId ? preferredParentId : null
                };
                await openBookmarkAddByTemplateAction(addContext);
            }
        });
    });

    // 绑定点击事件
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (clickEvent) => {
            clickEvent.stopPropagation();
            const action = item.dataset.action;
            const sid = item.dataset.sectionId;
            const ttype = item.dataset.treeType;
            const preferredParentId = item.dataset.parentId;
            const canvasLeft = item.dataset.canvasLeft;
            const canvasTop = item.dataset.canvasTop;

            hideContextMenu();

            if (action === 'add-permanent-copy-at-position') {
                const left = Number(canvasLeft);
                const top = Number(canvasTop);
                const sourceSection = document.getElementById('permanentSection') || document.querySelector('.permanent-bookmark-section');
                if (typeof createPermanentSectionCopy === 'function') {
                    createPermanentSectionCopy(sourceSection, {
                        canvasPosition: {
                            left,
                            top
                        }
                    });
                }
            } else if (action === 'add-empty-temp-card-at-position') {
                const left = Number(canvasLeft);
                const top = Number(canvasTop);
                __createCanvasQuickAddTempSectionAtPosition(left, top);
            } else if (action === 'add-via-secondary-at-position') {
                const left = Number(canvasLeft);
                const top = Number(canvasTop);
                await __openCanvasBlankAddSecondaryAtPosition(left, top);
            } else if (action === 'add-blank-md-card-at-position') {
                const left = Number(canvasLeft);
                const top = Number(canvasTop);
                await __createCanvasBlankMdCardAtPosition(left, top);
            } else if (action === 'create-card-group-at-position') {
                const left = Number(canvasLeft);
                const top = Number(canvasTop);
                await __invokeCanvasCardGroupCreateHandler('fixed', left, top, '', { empty: true });
            } else if (action === 'import-at-position') {
                const left = Number(canvasLeft);
                const top = Number(canvasTop);
                if (typeof showImportDialog === 'function') {
                    showImportDialog({
                        title: (currentLang || 'zh_CN') === 'zh_CN' ? '此位置导入' : 'Import here',
                        canvasPosition: {
                            left: Number.isFinite(left) ? left : 0,
                            top: Number.isFinite(top) ? top : 0
                        },
                        forceSnapshot: true,
                        trigger: 'canvas-blank-context-import'
                    });
                }
            } else if (action === 'add-entry-blank') {
                const addContext = {
                    treeType: ttype === 'temporary' ? 'temporary' : 'permanent',
                    sectionId: ttype === 'temporary' ? sid : null,
                    nodeId: null,
                    isFolder: true,
                    blankRoot: true,
                    preferredParentId: ttype === 'permanent' && preferredParentId ? preferredParentId : null
                };
                await openBookmarkAddMenuAction(addContext);
            } else if (action === 'paste-blank') {
                if (ttype === 'temporary' && sid) {
                    await pasteIntoTemp({ sectionId: sid, parentId: null, index: null });
                } else if (ttype === 'permanent') {
                    // 粘贴到书签栏根目录
                    if (chrome && chrome.bookmarks) {
                        const parentId = await __resolveBookmarkAddPermanentRootId({ preferredParentId });
                        await pasteBookmark(parentId, true);
                    }
                }
            }
        });
    });

    // 使用固定定位显示菜单（不嵌入DOM）
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.style.display = 'block';

    // 移除之前的嵌入样式
    contextMenu.style.position = 'fixed';
    if (contextMenu.parentElement && contextMenu.parentElement !== getOverlayContainer()) {
        getOverlayContainer().appendChild(contextMenu);
    }
}

function __getCanvasObjectMenuLabels() {
    const lang = currentLang || 'zh_CN';
    return {
        fullscreen: lang === 'zh_CN' ? '全屏' : 'Fullscreen',
        locate: lang === 'zh_CN' ? '定位' : 'Locate',
        rename: lang === 'zh_CN' ? '重命名' : 'Rename',
        pin: lang === 'zh_CN' ? '置顶' : 'Pin',
        duplicate: lang === 'zh_CN' ? '创建副本' : 'Create copy',
        color: lang === 'zh_CN' ? '颜色' : 'Color',
        edgeDirection: lang === 'zh_CN' ? '连接线方向' : 'Line direction',
        editLabel: lang === 'zh_CN' ? '编辑标签' : 'Edit label',
        delete: lang === 'zh_CN' ? '删除' : 'Delete',
        copySource: lang === 'zh_CN' ? '复制文字源码' : 'Copy text source',
        exportJson: lang === 'zh_CN' ? '导出当前 JSON' : 'Export current JSON',
        exportHtml: lang === 'zh_CN' ? '导出当前 HTML' : 'Export current HTML',
        searchScope: lang === 'zh_CN' ? '当前范围的搜索' : 'Search in current scope'
    };
}

async function __copyBookmarkTreeObjectText(text) {
    const value = String(text == null ? '' : text);
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
}

function __showBookmarkTreeObjectToast(message, type = 'success') {
    const text = String(message == null ? '' : message);
    if (!text) return;
    if (typeof showCanvasToast === 'function') {
        try {
            showCanvasToast(text, type);
            return;
        } catch (_) { }
    }
    if (typeof showToast === 'function') {
        try {
            showToast(text);
            return;
        } catch (_) { }
    }
}

function __buildMdNodeSourceText(target) {
    const canvas = window.CanvasModule || {};
    const nodeId = String(target && target.nodeId || '').trim();
    const node = target && target.nodeData
        ? target.nodeData
        : (canvas && typeof canvas.getMdNode === 'function' ? canvas.getMdNode(nodeId) : null);
    if (!node) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '空白栏目不存在' : 'Blank section not found');
    }
    const normalizeText = (value) => {
        if (typeof window.__normalizeCanvasMarkdownSource === 'function') {
            try { return window.__normalizeCanvasMarkdownSource(value); } catch (_) { }
        }
        return String(value == null ? '' : value)
            .replace(/\u200B/g, '')
            .replace(/\r\n?/g, '\n');
    };
    const isNativeTextNode = (() => {
        if (typeof window.__isCanvasNativeTextNode === 'function') {
            try { return !!window.__isCanvasNativeTextNode(node); } catch (_) { }
        }
        const kind = String(node.canvasTextKind || '').trim().toLowerCase();
        if (kind === 'blank') return false;
        if (kind === 'native') return true;
        const subtype = String(node.subtype || '').trim().toLowerCase();
        const source = String(node.source || '').trim().toLowerCase();
        return subtype === 'canvas-native-text' || source === 'obsidian-canvas-text';
    })();
    const resolveText = () => {
        if (isNativeTextNode && typeof window.__resolveCanvasNativeTextNodeBody === 'function') {
            try { return window.__resolveCanvasNativeTextNodeBody(node); } catch (_) { }
        }
        if (!isNativeTextNode && typeof window.__deriveMdNodeMarkdownSource === 'function') {
            try { return window.__deriveMdNodeMarkdownSource(node); } catch (_) { }
        }
        if (typeof node.markdownSource === 'string' && node.markdownSource.trim()) return node.markdownSource;
        return String(node.text == null ? '' : node.text);
    };
    return normalizeText(resolveText());
}

function __downloadBookmarkTreeObjectFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const exportPath = getTreeExportDownloadFolder();
    if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.download === 'function') {
        chrome.downloads.download({
            url,
            filename: `${exportPath}/${filename}`,
            saveAs: false,
            conflictAction: 'uniquify'
        }, () => setTimeout(() => URL.revokeObjectURL(url), 10000));
    } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
}

function __sanitizeBookmarkTreeObjectFileSegment(value, fallback = 'bookmarks') {
    const raw = String(value || '').trim() || String(fallback || 'bookmarks');
    const safe = raw
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim();
    return safe || String(fallback || 'bookmarks');
}

function __bookmarkTreeObjectBasenameFromRelativePath(rel) {
    const leaf = String(rel || '').split('/').filter(Boolean).pop() || '';
    return leaf.replace(/\.(md|json|html)$/i, '');
}

function __getBookmarkTreeObjectPermanentCopySlot(target) {
    const copyId = String(target && target.copyId || '').trim();
    if (!copyId) return 2;
    try {
        const canvas = window.CanvasModule;
        const copies = canvas && typeof canvas.ensurePermanentSectionCopyDisplayIndexes === 'function'
            ? canvas.ensurePermanentSectionCopyDisplayIndexes()
            : [];
        const matched = Array.isArray(copies)
            ? copies.find((copy) => copy && String(copy.id || '') === copyId)
            : null;
        const idx = matched && Number.parseInt(matched.displayIndex, 10);
        if (Number.isFinite(idx) && idx > 0) return idx + 1;
    } catch (_) { }
    return 2;
}

function __buildBookmarkTreeObjectExportFilename(target, format) {
    const lang = currentLang || 'zh_CN';
    const isEn = lang === 'en' || lang === 'en_US' || String(lang).toLowerCase().startsWith('en');
    const ext = format === 'html' ? 'html' : 'json';
    const type = target && target.type;

    if (type === 'permanent' || type === 'permanent-copy') {
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        const fallbackBasename = type === 'permanent-copy'
            ? (isEn ? 'B-PermanentBookmarks' : 'B书签树（永久栏目）')
            : (isEn ? 'A-PermanentBookmarks' : 'A书签树（永久栏目）');
        if (bridge && typeof bridge.buildPermanentSectionMarkdownRelativePath === 'function') {
            const slot = type === 'permanent-copy' ? __getBookmarkTreeObjectPermanentCopySlot(target) : 1;
            const rel = bridge.buildPermanentSectionMarkdownRelativePath(slot, isEn, 'json').replace(/\.json$/i, `.${ext}`);
            const basename = __bookmarkTreeObjectBasenameFromRelativePath(rel);
            return `${__sanitizeBookmarkTreeObjectFileSegment(basename, fallbackBasename)}.${ext}`;
        }
        return `${__sanitizeBookmarkTreeObjectFileSegment(fallbackBasename)}.${ext}`;
    }

    if (type === 'temporary') {
        const canvas = window.CanvasModule;
        const section = canvas && canvas.temp && typeof canvas.temp.getSection === 'function'
            ? canvas.temp.getSection(target.sectionId)
            : null;
        const label = section && typeof getTempSectionLabel === 'function' ? getTempSectionLabel(section) : '';
        const title = section && section.title ? section.title : (isEn ? 'Temp Section' : '临时栏目');
        const fileTitle = label ? `${label} ${title}` : title;
        const fallbackTitle = label || title || (section && section.id) || (isEn ? 'Temp Section' : '临时栏目');
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (section && bridge
            && typeof bridge.buildObsidianSafeFilenameStem === 'function'
            && typeof bridge.buildTempSectionMarkdownRelativePath === 'function') {
            const safeTitle = bridge.buildObsidianSafeFilenameStem(
                fileTitle,
                fallbackTitle,
                (section && section.id) || fileTitle
            );
            const rel = bridge.buildTempSectionMarkdownRelativePath(section, safeTitle, isEn, 'json');
            const basename = __bookmarkTreeObjectBasenameFromRelativePath(rel);
            return `${__sanitizeBookmarkTreeObjectFileSegment(basename, safeTitle || fallbackTitle)}.${ext}`;
        }
        const safeTitle = __sanitizeBookmarkTreeObjectFileSegment(fileTitle, fallbackTitle);
        return `${safeTitle}.${ext}`;
    }

    return `${isEn ? 'bookmarks' : '书签'}.${ext}`;
}

function __bookmarkTreeObjectHtmlFromItems(items) {
    const render = (item, depth = 1) => {
        if (!item) return '';
        const indent = '    '.repeat(depth);
        const title = escapeHtml(item.title || ((currentLang || 'zh_CN') === 'zh_CN' ? '文件夹' : 'Folder'));
        if ((item.type === 'bookmark' || item.url) && item.url) {
            return `${indent}<DT><A HREF="${escapeHtml(item.url)}">${title}</A>\n`;
        }
        let out = `${indent}<DT><H3>${title}</H3>\n${indent}<DL><p>\n`;
        (item.children || []).forEach(child => { out += render(child, depth + 1); });
        out += `${indent}</DL><p>\n`;
        return out;
    };
    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
    (Array.isArray(items) ? items : []).forEach(item => { html += render(item, 1); });
    html += '</DL><p>\n';
    return html;
}

function __serializeTempTreeItem(item) {
    if (!item) return null;
    const out = {
        title: item.title || '',
        url: item.url || '',
        type: item.type || (item.url ? 'bookmark' : 'folder')
    };
    const note = __ctxNormalizeNote(item.note);
    if (note) {
        out.note = note;
        out.noteColor = __ctxNormalizeNoteColor(item.noteColor);
    }
    if (Array.isArray(item.tags) && item.tags.length) {
        out.tags = item.tags.map((tag) => (tag && typeof tag === 'object') ? { color: tag.color, text: tag.text || '' } : null).filter(Boolean);
    }
    out.children = (item.children || []).map(__serializeTempTreeItem).filter(Boolean);
    return out;
}

function __buildTemporaryObjectJsonPayload(target) {
    const canvas = window.CanvasModule;
    const section = canvas && canvas.temp && typeof canvas.temp.getSection === 'function'
        ? canvas.temp.getSection(target && target.sectionId)
        : null;
    if (!section) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '临时栏目不存在' : 'Temporary section not found');
    }
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (bridge && typeof bridge.buildTempSectionJsonProtocol === 'function') {
        return bridge.buildTempSectionJsonProtocol(section);
    }
    if (bridge && typeof bridge.normalizeTempSectionProtocol === 'function') {
        return bridge.normalizeTempSectionProtocol(section);
    }
    const label = typeof getTempSectionLabel === 'function' ? getTempSectionLabel(section) : '';
    const tempKind = (typeof __isSpecialTempSection === 'function' && __isSpecialTempSection(section))
        ? 'special'
        : 'regular';
    const payload = {
        format: 'bookmark-canvas-section',
        schemaVersion: 2,
        sectionType: 'temporary',
        id: section.id,
        label,
        title: section.title || '',
        tempKind,
        descriptionMd: section.descriptionMd || '',
        items: Array.isArray(section.items) ? section.items.map(__serializeTempTreeItem).filter(Boolean) : []
    };
    const source = String(section.source || '').trim();
    if (source) payload.source = source;
    if (!label) delete payload.label;
    return payload;
}

async function __buildPermanentObjectJsonPayload(target) {
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (!bridge || typeof bridge.ensurePermanentMainContentInBcs !== 'function') {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '永久栏目 JSON 真相源不可用' : 'Permanent JSON source unavailable');
    }

    const permanentContent = await bridge.ensurePermanentMainContentInBcs();
    const payload = bridge && typeof bridge.buildPermanentMainSyncPayload === 'function'
        ? bridge.buildPermanentMainSyncPayload(permanentContent, { idsAlreadySyncIds: false })
        : null;
    if (!payload || !payload.tree) {
        throw new Error((currentLang || 'zh_CN') === 'zh_CN' ? '永久栏目 JSON 导出转换失败' : 'Permanent JSON export conversion failed');
    }

    const type = target && target.type;
    const copyId = type === 'permanent-copy' ? String(target.copyId || '').trim() : '';
    try {
        const descKey = copyId ? `bcs:perm:tip-copy-${copyId}` : 'bcs:perm:tip-main';
        payload.descriptionMd = localStorage.getItem(descKey) || '';
    } catch (_) {
        if (typeof payload.descriptionMd !== 'string') payload.descriptionMd = '';
    }

    return payload;
}

async function __exportBookmarkTreeObject(target, format) {
    const lang = currentLang || 'zh_CN';
    const type = target && target.type;
    let items = [];
    const filename = __buildBookmarkTreeObjectExportFilename(target, format);
    if (type === 'temporary') {
        const canvas = window.CanvasModule;
        const section = canvas && canvas.temp && typeof canvas.temp.getSection === 'function'
            ? canvas.temp.getSection(target.sectionId)
            : null;
        items = section && Array.isArray(section.items)
            ? section.items.map(__serializeTempTreeItem).filter(Boolean)
            : [];
    } else if (format === 'html') {
        const roots = typeof chrome !== 'undefined' && chrome.bookmarks && typeof chrome.bookmarks.getTree === 'function'
            ? await chrome.bookmarks.getTree()
            : [];
        const root = roots && roots[0] ? roots[0] : null;
        const bookmarkBar = root && Array.isArray(root.children)
            ? (root.children.find(child => child && (child.id === '1' || child.title === '书签栏' || child.title === 'Bookmarks bar')) || root.children[0])
            : null;
        if (bookmarkBar) items = [serializeBookmarkNode(bookmarkBar)];
    }
    if (format === 'html') {
        __downloadBookmarkTreeObjectFile(__bookmarkTreeObjectHtmlFromItems(items), filename, 'text/html');
    } else {
        const payload = (type === 'permanent' || type === 'permanent-copy')
            ? await __buildPermanentObjectJsonPayload(target)
            : __buildTemporaryObjectJsonPayload(target);
        __downloadBookmarkTreeObjectFile(JSON.stringify(payload, null, 2), filename, 'application/json');
    }
    if (format === 'html') {
        __showBookmarkTreeObjectToast(lang === 'zh_CN' ? '导出成功！HTML 为标准书签树格式，不包含说明与 tag。' : 'Export successful. HTML uses the standard bookmarks tree format without descriptions or tags.');
    } else {
        __showBookmarkTreeObjectToast(lang === 'zh_CN' ? '导出成功！' : 'Export successful.');
    }
}

function __handleBookmarkTreeObjectMenuAction(action, target, options = {}) {
    const canvas = window.CanvasModule || {};
    const type = target && target.type;
    const sectionEl = target && target.sectionElement;
    if (action === 'fullscreen' && canvas.toggleElementFullscreen) return canvas.toggleElementFullscreen(sectionEl);
    if (action === 'locate') {
        if (type === 'temporary' && canvas.locateSection) return canvas.locateSection(target.sectionId);
        if (sectionEl && canvas.locateElement) return canvas.locateElement(sectionEl);
        if (canvas.locatePermanent) return canvas.locatePermanent();
    }
    if (action === 'rename') {
        if (type === 'temporary' && canvas.openTempSectionRename) return canvas.openTempSectionRename(target.sectionId, {
            anchorPoint: options.anchorPoint || null
        });
    }
    if (action === 'pin') {
        if (type === 'temporary' && canvas.toggleTempSectionPin) return canvas.toggleTempSectionPin(target.sectionId);
        if (type === 'md-node' && canvas.toggleMdNodePin) return canvas.toggleMdNodePin(target.nodeId);
        if (canvas.togglePermanentSectionPin) return canvas.togglePermanentSectionPin(sectionEl);
    }
    if (action === 'duplicate' && canvas.createPermanentSectionCopy) return canvas.createPermanentSectionCopy(sectionEl);
    if (action === 'color') {
        if (type === 'temporary' && canvas.openTempSectionColorPicker) return canvas.openTempSectionColorPicker(target.sectionId, {
            anchorPoint: options.anchorPoint || null
        });
        if (type === 'md-node' && canvas.openMdNodeColorPicker) return canvas.openMdNodeColorPicker(target.nodeId, {
            anchorPoint: options.anchorPoint || null
        });
    }
    if (action === 'delete') {
        if (type === 'temporary' && canvas.removeTempSection) return canvas.removeTempSection(target.sectionId);
        if (type === 'md-node' && canvas.removeMdNode) return canvas.removeMdNode(target.nodeId);
        if (type === 'permanent-copy' && canvas.removePermanentSectionCopy) return canvas.removePermanentSectionCopy(sectionEl);
    }
    if (action === 'copy-source') {
        const text = __buildMdNodeSourceText(target);
        return __copyBookmarkTreeObjectText(text).then(() => {
            __showBookmarkTreeObjectToast((currentLang || 'zh_CN') === 'zh_CN' ? '已复制当前栏目文字。' : 'Current section text copied.');
        });
    }
    if (action === 'edge-color' && canvas.openEdgeColorPicker) return canvas.openEdgeColorPicker(target.edgeId, {
        anchorPoint: options.anchorPoint || null
    });
    if (action === 'edge-locate' && canvas.locateEdge) return canvas.locateEdge(target.edgeId);
    if (action === 'edge-direction' && canvas.openEdgeDirectionPicker) return canvas.openEdgeDirectionPicker(target.edgeId, {
        anchorPoint: options.anchorPoint || null
    });
    if (action === 'edge-label' && canvas.openEdgeLabelEditor) return canvas.openEdgeLabelEditor(target.edgeId, {
        anchorPoint: options.anchorPoint || null
    });
    if (action === 'edge-delete' && canvas.removeEdge) return canvas.removeEdge(target.edgeId);
    if (action === 'export-json') return __exportBookmarkTreeObject(target, 'json');
    if (action === 'export-html') return __exportBookmarkTreeObject(target, 'html');
    if (action === 'search-scope') {
        const type = target && target.type;
        if (type === 'permanent' || type === 'permanent-copy') {
            if (typeof window.setSearchMode === 'function') {
                window.setSearchMode('bookmark', { source: 'user' });
            }
            const copyId = target.copyId;
            const memberIds = ['permanentSection', 'permanent-section'];
            if (copyId) {
                memberIds.push(copyId, `permanent-section-copy-${copyId}`);
            }
            if (typeof window.triggerAreaSearch === 'function') {
                window.triggerAreaSearch({
                    kind: 'permanent',
                    id: copyId || 'permanentSection',
                    memberIds: memberIds
                });
            }
        } else if (type === 'temporary') {
            if (typeof window.setSearchMode === 'function') {
                window.setSearchMode('bookmark', { source: 'user' });
            }
            if (typeof window.triggerAreaSearch === 'function') {
                window.triggerAreaSearch({
                    kind: 'temp',
                    id: target.sectionId,
                    memberIds: [target.sectionId]
                });
            }
        } else if (type === 'md-node') {
            if (typeof window.setSearchMode === 'function') {
                window.setSearchMode('description', { source: 'user' });
            }
            if (typeof window.triggerAreaSearch === 'function') {
                window.triggerAreaSearch({
                    kind: 'blank',
                    id: target.nodeId,
                    memberIds: [target.nodeId]
                });
            }
        }
        return Promise.resolve();
    }
}

function showBookmarkTreeObjectContextMenu(e, target) {
    e.preventDefault();
    e.stopPropagation();
    const labels = __getCanvasObjectMenuLabels();
    const type = target && target.type;
    const items = [
        { action: 'fullscreen', label: labels.fullscreen, icon: 'expand' },
        { action: 'locate', label: labels.locate, icon: 'crosshairs' }
    ];
    if (type === 'temporary') {
        items.push({ action: 'rename', label: labels.rename, icon: 'edit' });
    }
    if (type === 'md-node') {
        items.push({ action: 'color', label: labels.color, icon: 'palette' });
    }

    const lang = currentLang || 'zh_CN';
    const isCurrentlyPinned = (() => {
        if (type === 'temporary') {
            const section = typeof getTempSection === 'function' ? getTempSection(target.sectionId) : null;
            return section ? !!section.pinned : false;
        }
        if (type === 'md-node') {
            const isPinnedFromData = target.nodeData ? !!target.nodeData.pinned : false;
            if (isPinnedFromData) return true;
            const el = target.sectionElement || document.getElementById(target.nodeId);
            const pinBtn = el ? el.querySelector('[data-action="md-pin"]') : null;
            return pinBtn ? pinBtn.classList.contains('pinned') : false;
        }
        if (type === 'permanent' || type === 'permanent-copy') {
            const el = target.sectionElement || document.getElementById('permanentSection');
            const pinBtn = el ? el.querySelector('.permanent-section-pin-btn') : null;
            return pinBtn ? pinBtn.classList.contains('pinned') : false;
        }
        return false;
    })();

    const pinLabel = isCurrentlyPinned
        ? (lang === 'zh_CN' ? '取消置顶' : 'Unpin')
        : (lang === 'zh_CN' ? '置顶' : 'Pin');

    items.push({ action: 'search-scope', label: labels.searchScope, icon: 'search' });
    if (type === 'permanent' || type === 'permanent-copy') {
        items.push({ action: 'duplicate', label: labels.duplicate, icon: 'copy' });
    }
    if (type === 'temporary') {
        items.push({ action: 'color', label: labels.color, icon: 'palette' });
    }
    items.push({ action: 'pin', label: pinLabel, icon: 'thumbtack' });
    if (type === 'md-node') {
        items.push({ action: 'copy-source', label: labels.copySource, icon: 'code' });
    } else {
        items.push(
            { action: 'export-json', label: labels.exportJson, icon: 'file-alt' },
            { action: 'export-html', label: labels.exportHtml, icon: 'file-code' }
        );
    }
    if (type === 'permanent-copy' || type === 'temporary' || type === 'md-node') {
        items.push({ action: 'delete', label: labels.delete, icon: 'trash-alt', className: 'color-red' });
    }

    const menu = document.getElementById('bookmark-context-menu');
    if (!menu) return;
    target = target && typeof target === 'object' ? target : {};
    target.contextMenuPoint = { x: e.clientX, y: e.clientY };
    target.contextMenuRenamePoint = { x: e.clientX, y: e.clientY };
    target.contextMenuColorPoint = { x: e.clientX, y: e.clientY };
    menu.classList.remove('horizontal-layout', 'density-xs', 'density-md', 'density-lg');
    menu.classList.add('density-sm');
    menu.dataset.menuScope = 'bookmark-tree-object';
    menu.innerHTML = items.map(item => `
        <div class="context-menu-item ${item.className || ''}" data-action="${item.action}">
            <i class="fas fa-${item.icon}"></i>
            <span class="context-menu-item-label"><span>${item.label}</span></span>
        </div>
    `).join('');
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const action = item.dataset.action;
            const actionPoint = action === 'rename'
                ? target.contextMenuRenamePoint
                : (action === 'color' ? target.contextMenuColorPoint : null);
            const anchorPoint = actionPoint || (target && target.contextMenuPoint ? target.contextMenuPoint : null);
            hideContextMenu();
            try { await __handleBookmarkTreeObjectMenuAction(action, target, { anchorPoint }); } catch (error) {
                console.error('[右键菜单] 书签树对象操作失败:', error);
                alert((currentLang || 'zh_CN') === 'zh_CN' ? `操作失败: ${error.message}` : `Action failed: ${error.message}`);
            }
        });
    });
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.transformOrigin = '';
    menu.style.transform = '';
    menu.style.display = 'block';
    if (menu.parentElement && menu.parentElement !== getOverlayContainer()) getOverlayContainer().appendChild(menu);
    const colorItem = menu.querySelector('.context-menu-item[data-action="color"]');
    if (colorItem) {
        target.contextMenuColorPoint = {
            x: e.clientX,
            y: e.clientY + (colorItem.offsetTop || 0)
        };
    }
    const renameItem = menu.querySelector('.context-menu-item[data-action="rename"]');
    if (renameItem) {
        target.contextMenuRenamePoint = {
            x: e.clientX,
            y: e.clientY + (renameItem.offsetTop || 0)
        };
    }
}

function showCanvasEdgeObjectContextMenu(e, edgeId) {
    e.preventDefault();
    e.stopPropagation();
    const labels = __getCanvasObjectMenuLabels();
    const target = {
        type: 'edge',
        edgeId: String(edgeId || '').trim(),
        contextMenuPoint: { x: e.clientX, y: e.clientY }
    };
    if (!target.edgeId) return;
    const items = [
        { action: 'edge-label', label: labels.editLabel, icon: 'edit' },
        { action: 'edge-color', label: labels.color, icon: 'palette' },
        { action: 'edge-locate', label: labels.locate, icon: 'crosshairs' },
        { action: 'edge-direction', label: labels.edgeDirection, icon: 'arrows-alt-h' },
        { action: 'edge-delete', label: labels.delete, icon: 'trash-alt', className: 'color-red' }
    ];
    const menu = document.getElementById('bookmark-context-menu');
    if (!menu) return;
    menu.classList.remove('horizontal-layout', 'density-xs', 'density-md', 'density-lg');
    menu.classList.add('density-sm');
    menu.dataset.menuScope = 'canvas-edge-object';
    menu.innerHTML = items.map(item => `
        <div class="context-menu-item ${item.className || ''}" data-action="${item.action}">
            <i class="fas fa-${item.icon}"></i>
            <span class="context-menu-item-label"><span>${item.label}</span></span>
        </div>
    `).join('');
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const action = item.dataset.action;
            const actionPoint = target.contextMenuActionPoints && target.contextMenuActionPoints[action]
                ? target.contextMenuActionPoints[action]
                : target.contextMenuPoint;
            hideContextMenu();
            try { await __handleBookmarkTreeObjectMenuAction(action, target, { anchorPoint: actionPoint }); } catch (error) {
                console.error('[右键菜单] 连接线操作失败:', error);
                alert((currentLang || 'zh_CN') === 'zh_CN' ? `操作失败: ${error.message}` : `Action failed: ${error.message}`);
            }
        });
    });
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.transformOrigin = '';
    menu.style.transform = '';
    menu.style.display = 'block';
    if (menu.parentElement && menu.parentElement !== getOverlayContainer()) getOverlayContainer().appendChild(menu);
    target.contextMenuActionPoints = {};
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        const action = item.dataset.action;
        target.contextMenuActionPoints[action] = {
            x: e.clientX,
            y: e.clientY + (item.offsetTop || 0)
        };
    });
}

// 导出函数
if (typeof window !== 'undefined') {
    window.initContextMenu = initContextMenu;
    window.showContextMenu = showContextMenu;
    window.showBlankAreaContextMenu = showBlankAreaContextMenu;
    window.showBookmarkTreeObjectContextMenu = showBookmarkTreeObjectContextMenu;
    window.showCanvasEdgeObjectContextMenu = showCanvasEdgeObjectContextMenu;
    window.hideContextMenu = hideContextMenu;
    window.toggleNodeSelection = toggleNodeSelection;
    window.selectRange = selectRange;
    window.selectAll = selectAll;
    window.deselectAll = deselectAll;
    window.initBatchToolbar = initBatchToolbar;
    window.updateBatchToolbar = updateBatchToolbar;
    window.showBatchPanel = showBatchPanel;
    window.hideBatchPanel = hideBatchPanel;
    window.initKeyboardShortcuts = initKeyboardShortcuts;
    window.initClickSelect = initClickSelect;
    window.enterSelectMode = enterSelectMode;
    window.exitSelectMode = exitSelectMode;
    window.toggleContextMenuLayout = toggleContextMenuLayout;
    window.restoreContextMenuLayout = restoreContextMenuLayout;

    // 页面加载时恢复布局
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreContextMenuLayout);
    } else {
        restoreContextMenuLayout();
    }
}
