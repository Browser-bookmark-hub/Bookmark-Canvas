// 书签树拖拽功能
// 支持拖拽移动书签和文件夹

// 全局变量
let draggedNode = null;
let draggedNodeId = null;
let draggedNodeParent = null;
let draggedNodePrev = null;  // 被拖动节点的前一个同级节点
let draggedNodeNext = null;  // 被拖动节点的后一个同级节点
let dropIndicator = null;
let autoScrollInterval = null;
let lastScrollTime = 0;
let hoverExpandTimer = null;
// 记录文件夹被悬停展开的次数和定时器，加快二次与后续展开
var __hoverExpandState = (typeof window !== 'undefined' && window.__hoverExpandState)
    ? window.__hoverExpandState
    : { timers: new Map(), counts: new Map(), lastAt: new Map(), session: 0, lastDragEndTime: 0 };
if (typeof window !== 'undefined') window.__hoverExpandState = __hoverExpandState;

// 长时间不拖动后重置的阈值（毫秒）
var HOVER_EXPAND_RESET_THRESHOLD = 5000; // 5秒不拖动则重置

function getOverlayContainer() {
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

function getHoverDelayForFolder(folderId) {
    // 检查是否距离上次拖动结束已经过了很长时间，如果是则重置计数
    const now = Date.now();
    if (__hoverExpandState.lastDragEndTime > 0 &&
        (now - __hoverExpandState.lastDragEndTime) > HOVER_EXPAND_RESET_THRESHOLD) {
        // 距离上次拖动结束超过阈值，重置所有计数
        __hoverExpandState.counts.clear();
        __hoverExpandState.lastDragEndTime = 0;
    }

    // 延迟逻辑：首次 2000ms，后续统一 1200ms
    const count = __hoverExpandState.counts.get(folderId) || 0;
    if (count >= 1) return 1200;
    return 2000;
}

function scheduleFolderExpand(targetNode) {
    if (!targetNode || targetNode.dataset.nodeType !== 'folder') return;
    const folderId = targetNode.dataset.nodeId;
    // 若已有定时器，仅重置定时而不增加识别计数（避免连续 dragover 快速累加）
    const hadTimer = __hoverExpandState.timers.has(folderId);
    // 若已有定时器，保持不变，避免把“首次 3 秒”意外缩短为更快延迟
    if (hadTimer) return;

    const delay = getHoverDelayForFolder(folderId);

    // 在“安排定时器”的时刻记录一次识别，使得：
    // - 第一次安排 → 使用 2500ms，同时计数从 0→1；
    // - 第二次（离开后再次悬停并安排）→ 使用 400ms，计数 1→2；
    // - 后续 → 使用 200ms；
    const prev = __hoverExpandState.counts.get(folderId) || 0;
    __hoverExpandState.counts.set(folderId, Math.min(prev + 1, 2));
    __hoverExpandState.lastAt.set(folderId, Date.now());

    const sessionAtSchedule = __hoverExpandState.session;
    const timer = setTimeout(() => {
        try {
            if (__hoverExpandState.session !== sessionAtSchedule) return; // 仅限当前拖动会话

            const treeNode = targetNode.closest('.tree-node');
            const children = treeNode ? treeNode.querySelector(':scope > .tree-children') : targetNode.nextElementSibling;
            const toggle = targetNode.querySelector('.tree-toggle');
            const icon = targetNode.querySelector('.tree-icon.fas');

            if (children && children.classList.contains('tree-children') && !children.classList.contains('expanded')) {
                children.classList.add('expanded');
                if (toggle) toggle.classList.add('expanded');

                // 更新文件夹图标
                if (icon) {
                    icon.classList.remove('fa-folder');
                    icon.classList.add('fa-folder-open');
                }

                // 【关键修复】触发懒加载：检查子节点是否需要加载
                const treeType = targetNode.dataset.treeType;
                const sectionId = targetNode.dataset.sectionId;
                const childrenLoaded = targetNode.dataset.childrenLoaded;
                const hasChildren = targetNode.dataset.hasChildren;
                const nodeId = targetNode.dataset.nodeId;

                if (childrenLoaded === 'false' && hasChildren === 'true') {
                    if (treeType === 'temporary' && sectionId) {
                        // 临时栏目：调用 Canvas 模块的懒加载函数
                        try {
                            const loadFolderChildren = window.CanvasModule?.loadFolderChildren;
                            const getTempSection = window.CanvasModule?.getTempSection;
                            if (loadFolderChildren && getTempSection) {
                                const section = getTempSection(sectionId);
                                if (section) {
                                    loadFolderChildren(section, nodeId, children);
                                }
                            }
                        } catch (loadErr) {
                            console.warn('[拖拽展开] 临时栏目懒加载失败:', loadErr);
                        }
                    } else if (treeType === 'permanent' || !treeType) {
                        // 永久栏目：调用 history.js 的懒加载函数
                        try {
                            if (typeof loadPermanentFolderChildrenLazy === 'function') {
                                loadPermanentFolderChildrenLazy(nodeId, children, 0, null);
                            }
                        } catch (loadErr) {
                            console.warn('[拖拽展开] 永久栏目懒加载失败:', loadErr);
                        }
                    }
                }

                // 【新增】保存展开状态
                try {
                    if (treeType === 'temporary' && sectionId) {
                        // 临时栏目：更新 LAZY_LOAD_THRESHOLD 并保存
                        const folderId = `${sectionId}-${nodeId}`;
                        if (window.CanvasModule?.clearLazyLoadState) {
                            // 使用 Canvas 模块的内部状态管理
                            // LAZY_LOAD_THRESHOLD 是内部变量，通过间接方式更新
                        }
                        // 调用 saveTempExpandState（如果存在）
                        if (typeof saveTempExpandState === 'function') {
                            saveTempExpandState();
                        }
                    } else {
                        // 永久栏目：调用 saveTreeExpandState
                        const treeContainer = targetNode.closest('.bookmark-tree');
                        if (treeContainer && typeof saveTreeExpandState === 'function') {
                            saveTreeExpandState(treeContainer);
                        }
                    }
                } catch (_) { }
            }
        } catch (_) { }
    }, delay);
    __hoverExpandState.timers.set(folderId, timer);
}
let draggedNodeTreeType = 'permanent';
let draggedNodeSectionId = null;

function getTempManager() {
    return (window.CanvasModule && window.CanvasModule.temp) ? window.CanvasModule.temp : null;
}

function isTempDescendantOf(sectionId, childId, parentFolderId) {
    if (!childId || !parentFolderId) return false;
    if (childId === parentFolderId) return true;
    let currentId = childId;
    let iterations = 0;
    while (currentId && iterations < 100) {
        iterations++;
        const manager = getTempManager();
        if (!manager || typeof manager.findItem !== 'function') break;
        const entry = manager.findItem(sectionId, currentId);
        if (!entry || !entry.parent) break;
        if (entry.parent.id === parentFolderId) return true;
        currentId = entry.parent.id;
    }
    return false;
}

async function isPermanentDescendantOf(childId, parentFolderId) {
    if (!childId || !parentFolderId) return false;
    if (childId === parentFolderId) return true;
    let currentId = childId;
    let iterations = 0;
    while (currentId && currentId !== '0' && iterations < 100) {
        iterations++;
        try {
            const [node] = await chrome.bookmarks.get(currentId);
            if (!node || !node.parentId) break;
            if (node.parentId === parentFolderId) return true;
            currentId = node.parentId;
        } catch (_) {
            break;
        }
    }
    return false;
}

function serializeBookmarkNode(node) {
    if (!node) return null;
    const out = {
        ...(node.id ? { id: String(node.id) } : {}),
        title: node.title,
        url: node.url || '',
        type: node.url ? 'bookmark' : 'folder',
        __canvasPayloadSource: 'permanent',
        children: (node.children || []).map(child => serializeBookmarkNode(child))
    };
    if (node.id && window.TagSystem && typeof window.TagSystem.getPermNodeTagsCached === 'function') {
        const cachedTags = window.TagSystem.getPermNodeTagsCached(node.id);
        if (Array.isArray(cachedTags) && cachedTags.length) {
            out.tags = cachedTags.map(t => ({ color: t.color, text: t.text }));
        }
    }
    return out;
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

function getSharedPermanentMutationOps() {
    const ops = (typeof window !== 'undefined' && window.__canvasPermanentBookmarkMutations)
        ? window.__canvasPermanentBookmarkMutations
        : null;
    return ops
        && typeof ops.createPermanentBookmarkNode === 'function'
        && typeof ops.movePermanentBookmarkNode === 'function'
        ? ops
        : null;
}

function isBookmarkTreeSelectModeActive() {
    try {
        if (typeof selectMode !== 'undefined' && selectMode) return true;
    } catch (_) { }
    try {
        return !!(typeof window !== 'undefined' && window.selectMode === true);
    } catch (_) {
        return false;
    }
}

function isBookmarkTreeBatchDragSelection(nodeId) {
    if (!nodeId || !isBookmarkTreeSelectModeActive()) return false;
    return typeof selectedNodes !== 'undefined'
        && selectedNodes
        && typeof selectedNodes.has === 'function'
        && selectedNodes.has(nodeId);
}

function applyPermanentMoveDomFastPath(nodeId, moveInfo, reason = 'drag-single-permanent', options = {}) {
    if (!nodeId || !moveInfo) return false;
    const applyDom = (typeof window !== 'undefined' && typeof window.__applyPermanentBookmarkEventsToDomIncremental === 'function')
        ? window.__applyPermanentBookmarkEventsToDomIncremental
        : null;
    if (!applyDom) return false;

    try {
        const result = applyDom([{
            type: 'moved',
            id: String(nodeId),
            moveInfo
        }], {
            reason,
            skipSnapshotRefresh: !!(options && options.skipSnapshotRefresh === true),
            allowFallbackRender: options && options.allowFallbackRender === false ? false : true
        });
        if (result && typeof result.catch === 'function') {
            result.catch((error) => {
                console.warn('[拖拽] 永久栏目单个移动快速落位失败:', error);
            });
        }
        return true;
    } catch (error) {
        console.warn('[拖拽] 永久栏目单个移动快速落位失败:', error);
        return false;
    }
}

async function createPermanentBookmarkNodeViaSharedOps(createPayload, options = {}) {
    const ops = getSharedPermanentMutationOps();
    if (!ops) {
        throw new Error('Permanent bookmark mutation ops unavailable');
    }
    return await ops.createPermanentBookmarkNode(createPayload, options);
}

async function movePermanentBookmarkNodeViaSharedOps(nodeId, target, options = {}) {
    const ops = getSharedPermanentMutationOps();
    if (!ops) {
        throw new Error('Permanent bookmark mutation ops unavailable');
    }
    return await ops.movePermanentBookmarkNode(nodeId, target, options);
}

function resolvePermanentBlankDropParentId(targetElement = null) {
    try {
        const section = targetElement && targetElement.closest
            ? targetElement.closest('.permanent-bookmark-section')
            : null;
        const scope = section || document.getElementById('permanentSection') || document.querySelector('.permanent-bookmark-section');
        const tree = scope
            ? scope.querySelector('.bookmark-tree')
            : (document.getElementById('bookmarkTree') || document.querySelector('.bookmark-tree[data-tree-type="permanent"]'));
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

// 初始化拖拽功能
function initDragDrop() {
    // 创建拖拽指示器
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    dropIndicator.style.display = 'none';
    getOverlayContainer().appendChild(dropIndicator);

    ;
}

// 为树节点绑定拖拽事件
function attachDragEvents(treeContainer) {
    if (!treeContainer) return;

    // 获取所有可拖拽的节点
    const draggableNodes = treeContainer.querySelectorAll('.tree-item[data-node-id]');

    draggableNodes.forEach(node => {
        // 避免重复绑定：renderTreeView/懒加载可能多次调用 attachDragEvents
        if (node.dataset.dragEventsBound === 'true') return;
        node.dataset.dragEventsBound = 'true';

        // 设置可拖拽
        node.setAttribute('draggable', 'true');

        // 拖拽开始
        node.addEventListener('dragstart', handleDragStart);

        // 拖拽经过
        node.addEventListener('dragover', handleDragOver);

        // 拖拽进入
        node.addEventListener('dragenter', handleDragEnter);

        // 拖拽离开
        node.addEventListener('dragleave', handleDragLeave);

        // 放下
        node.addEventListener('drop', handleDrop);

        // 拖拽结束
        node.addEventListener('dragend', handleDragEnd);
    });

    ;

    // 额外：在滚动容器层面也监听 dragover，用于容器空白区域的自动滚动
    try {
        const scrollContainer = treeContainer.closest('.permanent-section-body') || treeContainer.closest('.temp-node-body');
        if (scrollContainer && !scrollContainer.__autoScrollHooked) {
            scrollContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateAutoScroll(e);
            });
            scrollContainer.__autoScrollHooked = true;
            ;
        }

        const permanentBody = treeContainer.closest('.permanent-section-body');
        if (permanentBody && !permanentBody.__blankDropHooked) {
            permanentBody.addEventListener('dragover', (e) => {
                const targetNode = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
                if (targetNode) return;
                e.preventDefault();
                e.stopPropagation();
                hideDropIndicator();
                updateAutoScroll(e);
            });
            permanentBody.addEventListener('drop', async (e) => {
                const targetNode = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
                if (targetNode) return;
                e.preventDefault();
                e.stopPropagation();
                hideDropIndicator();

                const parentId = resolvePermanentBlankDropParentId(permanentBody);
                if (!parentId) return;

                const isExternal = !draggedNodeId;
                if (isExternal) {
                    await handleExternalDropOnTreeNode(e, parentId, true, {
                        targetTreeType: 'permanent',
                        targetSectionId: null,
                        position: 'inside'
                    });
                    return;
                }

                await moveBookmark(draggedNodeId, parentId, true, {
                    sourceTreeType: draggedNodeTreeType,
                    sourceSectionId: draggedNodeSectionId,
                    targetTreeType: 'permanent',
                    targetSectionId: null,
                    position: 'inside',
                    event: e
                });
            });
            permanentBody.__blankDropHooked = true;
            ;
        }

        const tempBody = treeContainer.closest('.temp-node-body');
        if (tempBody && !tempBody.__blankDropHooked) {
            tempBody.addEventListener('dragover', (e) => {
                const targetNode = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
                if (targetNode) return;
                e.preventDefault();
                e.stopPropagation();
                hideDropIndicator();
                updateAutoScroll(e);
            });
            tempBody.addEventListener('drop', async (e) => {
                const targetNode = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
                if (targetNode) return;
                e.preventDefault();
                e.stopPropagation();
                hideDropIndicator();

                const section = tempBody.closest('.temp-canvas-node');
                const sectionId = section ? section.id : null;
                if (!sectionId) return;

                const isExternal = !draggedNodeId;
                if (isExternal) {
                    await handleExternalDropOnTreeNode(e, null, true, {
                        targetTreeType: 'temporary',
                        targetSectionId: sectionId,
                        position: 'inside'
                    });
                    return;
                }

                await moveBookmark(draggedNodeId, null, true, {
                    sourceTreeType: draggedNodeTreeType,
                    sourceSectionId: draggedNodeSectionId,
                    targetTreeType: 'temporary',
                    targetSectionId: sectionId,
                    position: 'inside',
                    event: e
                });
            });
            tempBody.__blankDropHooked = true;
            ;
        }
    } catch (_) { }
}

// 拖拽开始
function handleDragStart(e) {
    if (e && e.defaultPrevented) return;
    draggedNode = e.currentTarget;
    draggedNodeId = draggedNode?.dataset?.nodeId;
    draggedNodeTreeType = draggedNode?.dataset?.treeType || 'permanent';
    draggedNodeSectionId = draggedNode?.dataset?.sectionId || null;

    // 获取被拖动节点的父级（tree-node 容器）
    draggedNodeParent = draggedNode.parentElement;

    // 获取同级节点中相邻 of the top and bottom elements
    let prevSibling = draggedNodeParent?.previousElementSibling;
    let nextSibling = draggedNodeParent?.nextElementSibling;

    // 如果前一个是 tree-children，继续往前找
    while (prevSibling && prevSibling.classList.contains('tree-children')) {
        prevSibling = prevSibling.previousElementSibling;
    }

    // 如果后一个是 tree-children，继续往后找
    while (nextSibling && nextSibling.classList.contains('tree-children')) {
        nextSibling = nextSibling.nextElementSibling;
    }

    // 找到前一个节点的 tree-item
    draggedNodePrev = prevSibling?.querySelector('.tree-item') || null;

    // 后一个节点的 tree-item 就是 nextSibling（如果存在的话）
    draggedNodeNext = nextSibling?.classList.contains('tree-node') ?
        nextSibling.querySelector('.tree-item') : null;

    // 设置拖拽数据
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedNodeId);
    try {
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('application/json', JSON.stringify({
                id: draggedNodeId,
                title: draggedNode?.dataset?.nodeTitle || '',
                url: draggedNode?.dataset?.nodeUrl || '',
                type: draggedNode?.dataset?.nodeType === 'folder' ? 'folder' : 'bookmark'
            }));
        }
    } catch (_) {}

    // 设置 Canvas 全局拖拽状态
    if (typeof CanvasState !== 'undefined' && CanvasState.dragState) {
        CanvasState.dragState.isDragging = true;
        CanvasState.dragState.draggedData = {
            id: draggedNodeId,
            title: draggedNode?.dataset?.nodeTitle || '',
            url: draggedNode?.dataset?.nodeUrl || '',
            type: draggedNode?.dataset?.nodeType === 'folder' ? 'folder' : 'bookmark',
            source: 'temporary',
            sectionId: draggedNodeSectionId
        };
        CanvasState.dragState.dragSource = 'temporary';
        CanvasState.dragState.wheelScrollEnabled = true;
    }

    // 设置多选拖拽数量预览
    try {
        if (e.dataTransfer && typeof e.dataTransfer.setDragImage === 'function') {
            let previewText = draggedNode?.dataset?.nodeTitle || draggedNode?.dataset?.nodeUrl || '';
            const selection = (typeof selectedNodes !== 'undefined') ? selectedNodes : null;
            if (selection && selection.has(draggedNodeId) && selection.size > 1) {
                let bookmarkCount = 0;
                let folderCount = 0;
                selection.forEach(id => {
                    const el = document.querySelector(`.tree-item[data-node-id="${id}"]`);
                    if (el) {
                        if (el.dataset.nodeType === 'folder') {
                            folderCount++;
                        } else {
                            bookmarkCount++;
                        }
                    } else {
                        const meta = typeof selectedNodeMeta !== 'undefined' ? selectedNodeMeta.get(id) : null;
                        if (meta && meta.nodeType === 'folder') {
                            folderCount++;
                        } else {
                            bookmarkCount++;
                        }
                    }
                });
                const lang = (typeof currentLang !== 'undefined' ? currentLang : 'zh_CN');
                const isEn = lang === 'en' || lang === 'en_US';
                if (isEn) {
                    const bText = bookmarkCount > 0 ? `${bookmarkCount} bookmark${bookmarkCount > 1 ? 's' : ''}` : '';
                    const fText = folderCount > 0 ? `${folderCount} folder${folderCount > 1 ? 's' : ''}` : '';
                    previewText = (bText && fText) ? `${bText}, ${fText}` : (bText || fText || '0 items');
                } else {
                    const bText = bookmarkCount > 0 ? `${bookmarkCount}个书签` : '';
                    const fText = folderCount > 0 ? `${folderCount}个文件夹` : '';
                    previewText = (bText && fText) ? `${bText}，${fText}` : (bText || fText || '0个项目');
                }
            }
            const preview = document.createElement('div');
            preview.className = 'drag-preview';
            preview.textContent = previewText || '';
            preview.style.left = '-9999px';
            getOverlayContainer().appendChild(preview);
            e.dataTransfer.setDragImage(preview, 0, 0);
            setTimeout(() => preview.remove(), 0);
        }
    } catch (_) { }

    // 添加拖拽样式
    draggedNode.classList.add('dragging');

    ;
    ;
    ;
    ;
    ;

    // 启动自动滚动检测
    startAutoScroll();

    // 重置悬停展开的加速状态，仅对“当前一次拖动”生效
    try {
        if (__hoverExpandState) {
            __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
            // 彻底清理上一拖动残留
            __hoverExpandState.timers.forEach((t) => clearTimeout(t));
            __hoverExpandState.timers.clear();
            __hoverExpandState.counts.clear();
            __hoverExpandState.lastAt.clear();
        }
    } catch (_) { }
}

// 拖拽经过
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    const targetNodeId = targetNode?.dataset?.nodeId;

    e.dataTransfer.dropEffect = 'move';

    // 显示拖拽指示器（包含屏蔽逻辑）
    showDropIndicator(targetNode, e);

    // 持续悬停也触发展开（不依赖仅一次的 dragenter）
    if (targetNode.dataset.nodeType === 'folder') {
        scheduleFolderExpand(targetNode);
    }

    // 当来源为临时栏目时，对永久栏目的文件夹增加蓝色候选高亮
    try {
        // 无论来源（永久/临时/指针），只要目标是文件夹都蓝色候选高亮
        if (targetNode.dataset.nodeType === 'folder') {
            targetNode.classList.add('temp-tree-drop-highlight');
        }
    } catch (_) { }

    // 更新自动滚动
    updateAutoScroll(e);
}

// 拖拽进入
function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    if (targetNode !== draggedNode && !isDescendant(targetNode, draggedNode)) {
        targetNode.classList.add('drag-over');
    }

    // 当来源为临时栏目时，对永久栏目的文件夹增加蓝色候选高亮
    try {
        if (targetNode.dataset.nodeType === 'folder') {
            targetNode.classList.add('temp-tree-drop-highlight');
        }
    } catch (_) { }

    // 悬停自动展开文件夹（带二次与后续加速）
    try { clearTimeout(hoverExpandTimer); } catch (_) { }
    scheduleFolderExpand(targetNode);
}

// 拖拽离开
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    targetNode.classList.remove('temp-tree-drop-highlight');
    try { clearTimeout(hoverExpandTimer); } catch (_) { }
    if (targetNode && targetNode.dataset && targetNode.dataset.nodeId) {
        const t = __hoverExpandState.timers.get(targetNode.dataset.nodeId);
        if (t) { clearTimeout(t); __hoverExpandState.timers.delete(targetNode.dataset.nodeId); }
    }
}

// 放下
async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetNode = e.currentTarget;
    targetNode.classList.remove('drag-over');
    targetNode.classList.remove('temp-tree-drop-highlight');

    const targetNodeId = targetNode.dataset.nodeId;
    const targetIsFolder = targetNode.dataset.nodeType === 'folder';
    const position = dropIndicator ? dropIndicator.dataset.position : null;

    // 隐藏拖拽指示器
    hideDropIndicator();

    const targetTreeType = targetNode.dataset.treeType || 'permanent';
    const targetSectionId = targetNode.dataset.sectionId || null;

    const isExternal = !draggedNodeId;
    if (isExternal) {
        await handleExternalDropOnTreeNode(e, targetNodeId, targetIsFolder, {
            targetTreeType,
            targetSectionId,
            position
        });
        return;
    }

    await moveBookmark(draggedNodeId, targetNodeId, targetIsFolder, {
        sourceTreeType: draggedNodeTreeType,
        sourceSectionId: draggedNodeSectionId,
        targetTreeType,
        targetSectionId,
        position,
        event: e
    });
}

// 拖拽结束
async function handleDragEnd(e) {
    // 移除拖拽样式
    if (draggedNode) {
        draggedNode.classList.remove('dragging');
    }

    const dropX = e.clientX;
    const dropY = e.clientY;

    const workspace = document.getElementById('canvasWorkspace');
    if (workspace) {
        const rect = workspace.getBoundingClientRect();
        if (dropX >= rect.left && dropX <= rect.right &&
            dropY >= rect.top && dropY <= rect.bottom) {

            const elementAtPoint = document.elementFromPoint(dropX, dropY);
            const insidePermanentDom = !!(elementAtPoint && elementAtPoint.closest && elementAtPoint.closest('.permanent-bookmark-section'));
            const insideTempNodeDom = !!(elementAtPoint && elementAtPoint.closest && (elementAtPoint.closest('.temp-canvas-node') || elementAtPoint.closest('.temp-bookmark-tree')));

            let insidePermanentRect = false;
            try {
                const canvasContent = document.getElementById('canvasContent');
                const scope = canvasContent || document;
                scope.querySelectorAll('.permanent-bookmark-section').forEach((sec) => {
                    if (insidePermanentRect) return;
                    const pRect = sec.getBoundingClientRect();
                    if (dropX >= pRect.left && dropX <= pRect.right && dropY >= pRect.top && dropY <= pRect.bottom) {
                        insidePermanentRect = true;
                    }
                });
            } catch (_) { }

            if (!(insidePermanentDom || insidePermanentRect) && !insideTempNodeDom) {
                const isDraggedNodeSelected = isBookmarkTreeBatchDragSelection(draggedNodeId);
                if (isDraggedNodeSelected && typeof batchToTempSection === 'function') {
                    await batchToTempSection(e);
                } else {
                    // Fallback to single temporary node to temp section
                    if (window.CanvasModule && window.CanvasModule.temp && typeof window.CanvasModule.temp.extractPayload === 'function') {
                        try {
                            const payload = window.CanvasModule.temp.extractPayload(draggedNodeSectionId, [draggedNodeId]);
                            if (payload && payload.length) {
                                const state = window.CanvasState || {};
                                const zoom = state.zoom || 1;
                                const panX = state.panOffsetX || 0;
                                const panY = state.panOffsetY || 0;
                                const x = (dropX - rect.left - panX) / zoom;
                                const y = (dropY - rect.top - panY) / zoom;
                                const newSecId = await window.CanvasModule.createTempNode({
                                    multi: true,
                                    permanentIds: [],
                                    title: formatTimestampForTitle(),
                                    label: currentLang === 'zh_CN' ? '卡片' : 'Card'
                                }, x, y);
                                if (newSecId) {
                                    window.CanvasModule.temp.insertFromPayload(newSecId, null, payload, null, { defaultCollapseFolders: true });
                                    window.CanvasModule.temp.removeItems(draggedNodeSectionId, [draggedNodeId]);
                                }
                            }
                        } catch (error) {
                            console.error('[拖拽] 单个临时节点拖动到画布失败:', error);
                        }
                    }
                }
            }
        }
    }

    // 移除所有drag-over样式
    document.querySelectorAll('.drag-over').forEach(node => {
        node.classList.remove('drag-over');
    });
    // 清理跨栏目的候选高亮
    document.querySelectorAll('.temp-tree-drop-highlight').forEach(node => {
        node.classList.remove('temp-tree-drop-highlight');
    });

    // 隐藏拖拽指示器
    hideDropIndicator();

    // 停止自动滚动
    stopAutoScroll();

    if (typeof CanvasState !== 'undefined' && CanvasState.dragState) {
        CanvasState.dragState.isDragging = false;
        CanvasState.dragState.draggedData = null;
        CanvasState.dragState.dragSource = null;
        CanvasState.dragState.wheelScrollEnabled = false;
    }

    draggedNode = null;
    draggedNodeId = null;
    draggedNodeParent = null;
    draggedNodePrev = null;
    draggedNodeNext = null;
    draggedNodeTreeType = 'permanent';
    draggedNodeSectionId = null;
    if (typeof clearTreeItemDragging === 'function') {
        clearTreeItemDragging();
    }
    // 清理所有悬停展开计时器
    try {
        __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
        __hoverExpandState.timers.forEach((t) => clearTimeout(t));
        __hoverExpandState.timers.clear();
        __hoverExpandState.lastDragEndTime = Date.now();
        __hoverExpandState.lastAt.clear();
    } catch (_) { }

    ;
}

// 显示拖拽指示器
function showDropIndicator(targetNode, e) {
    if (!dropIndicator) return;

    const rect = targetNode.getBoundingClientRect();
    const mouseY = e.clientY;
    const targetIsFolder = targetNode?.dataset?.nodeType === 'folder';

    // 检查是否是当前层级的第一个节点
    const treeNode = targetNode.closest('.tree-node');
    const isFirstInLevel = treeNode && !treeNode.previousElementSibling;

    // 检查文件夹是否展开
    let isFolderExpanded = false;
    if (targetIsFolder && treeNode) {
        const childrenContainer = treeNode.querySelector(':scope > .tree-children');
        isFolderExpanded = childrenContainer && childrenContainer.classList.contains('expanded');
    }

    let position;

    if (targetIsFolder) {
        if (isFolderExpanded) {
            // 展开的文件夹：上半部分 = before（如果是首位）或 inside，下半部分也是 inside（没有 after）
            if (isFirstInLevel && mouseY < rect.top + rect.height / 3) {
                position = 'before';
            } else {
                position = 'inside';
            }
        } else {
            // 未展开的文件夹：首位有 before，上半部分 = inside，下半部分 = after
            if (isFirstInLevel && mouseY < rect.top + rect.height / 4) {
                position = 'before';
            } else if (mouseY < rect.top + rect.height / 2) {
                position = 'inside';
            } else {
                position = 'after';
            }
        }
    } else {
        // 书签：首位有 before，否则只有 after
        if (isFirstInLevel && mouseY < rect.top + rect.height / 2) {
            position = 'before';
        } else {
            position = 'after';
        }
    }

    // 设置指示器位置
    const targetParent = getOverlayContainer();
    if (dropIndicator.parentElement !== targetParent) {
        targetParent.appendChild(dropIndicator);
    }

    const parentRect = dropIndicator.parentElement.getBoundingClientRect();

    if (position === 'before') {
        dropIndicator.style.top = (rect.top - parentRect.top) + 'px';
        dropIndicator.style.left = (rect.left - parentRect.left) + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
    } else if (position === 'after') {
        dropIndicator.style.top = (rect.bottom - parentRect.top) + 'px';
        dropIndicator.style.left = (rect.left - parentRect.left) + 'px';
        dropIndicator.style.width = rect.width + 'px';
        dropIndicator.style.height = '2px';
        dropIndicator.style.display = 'block';
    } else {
        // inside - 隐藏线条（文件夹高亮显示）
        dropIndicator.style.display = 'none';
    }

    dropIndicator.dataset.position = position;
}

// 隐藏拖拽指示器
function hideDropIndicator() {
    if (dropIndicator) {
        dropIndicator.style.display = 'none';
    }
}

// 检查是否是后代节点
function isDescendant(potentialDescendant, ancestor) {
    let node = potentialDescendant.parentElement;
    while (node) {
        if (node === ancestor) return true;
        node = node.parentElement;
    }
    return false;
}

async function computePermanentInsertion(targetId, targetIsFolder, position) {
    position = position || 'inside';
    if (!chrome || !chrome.bookmarks) {
        return { parentId: targetId, index: null };
    }
    if (position === 'inside' && targetIsFolder) {
        return { parentId: targetId, index: null };
    }
    try {
        const [targetNode] = await chrome.bookmarks.get(targetId);
        if (!targetNode) {
            return { parentId: targetId, index: null };
        }
        const parentId = targetNode.parentId;
        const targetIndex = typeof targetNode.index === 'number' ? targetNode.index : null;
        const index = targetIndex === null ? null : (position === 'before' ? targetIndex : targetIndex + 1);
        return { parentId, index };
    } catch (error) {
        console.warn('[拖拽] 计算插入位置失败:', error);
        return { parentId: targetId, index: null };
    }
}

function computeTempInsertion(sectionId, targetId, position) {
    position = position || 'inside';
    const manager = getTempManager();
    if (!manager) {
        return { parentId: null, index: null };
    }
    const entry = manager.findItem(sectionId, targetId);
    if (!entry || !entry.item) {
        return { parentId: null, index: null };
    }
    if (position === 'inside' && entry.item.type === 'folder') {
        const children = entry.item.children || [];
        return { parentId: entry.item.id, index: children.length };
    }
    const parentId = entry.parent ? entry.parent.id : null;
    const index = position === 'before' ? entry.index : entry.index + 1;
    return { parentId, index };
}

async function createBookmarkFromPayload(parentId, index, payload, tagUpdates = null, options = {}) {
    if (!chrome || !chrome.bookmarks || !payload) return;

    if (options.progressTracker) {
        options.progressTracker.current++;
        if (options.loadingToast && typeof options.loadingToast.update === 'function') {
            const current = options.progressTracker.current;
            const total = options.progressTracker.total;
            const elapsedMs = Date.now() - options.progressTracker.startTime;
            const elapsedSec = (elapsedMs / 1000).toFixed(1);
            let msg = '';
            if (current > 1) {
                const msPerItem = elapsedMs / (current - 1);
                const remainingItems = total - current + 1;
                const estimatedRemainingMs = msPerItem * remainingItems;
                const estimatedRemainingSec = (estimatedRemainingMs / 1000).toFixed(1);
                msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                    ? `Creating: ${current}/${total} (${Math.round((current - 1) / total * 100)}%) | Elapsed ${elapsedSec}s | Est. remaining ${estimatedRemainingSec}s`
                    : `正在创建: ${current}/${total} (${Math.round((current - 1) / total * 100)}%) | 已用 ${elapsedSec}s | 预计剩余 ${estimatedRemainingSec}s`;
            } else {
                msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                    ? `Creating: ${current}/${total} (0%) | Elapsed ${elapsedSec}s`
                    : `正在创建: ${current}/${total} (0%) | 已用 ${elapsedSec}s`;
            }
            options.loadingToast.update(msg);
        }
    }

    const createInfo = {
        parentId: parentId,
        title: payload.title || ''
    };
    if (payload.url) {
        createInfo.url = payload.url;
    }
    if (typeof index === 'number') {
        createInfo.index = index;
    }
    const created = await createPermanentBookmarkNodeViaSharedOps(createInfo, options);

    if (payload.tags && payload.tags.length && Array.isArray(tagUpdates)) {
        tagUpdates.push({
            chromeId: created.id,
            tags: payload.tags
        });
    }

    if (payload.children && payload.children.length) {
        for (const child of payload.children) {
            await createBookmarkFromPayload(created.id, null, child, tagUpdates, options);
        }
    }
}

// 用于标记由拖拽操作触发的移动，防止 applyIncrementalMoveToTree 重复处理
if (typeof window !== 'undefined') {
    window.__dragMoveHandled = window.__dragMoveHandled || new Set();
}

async function moveBookmark(dragNodeId, targetId, targetIsFolder, context) {
    const { sourceTreeType = 'permanent', sourceSectionId = null, targetTreeType = 'permanent', targetSectionId = null, position = 'inside' } = context || {};
    const manager = getTempManager();
    try {
        const isDraggedNodeSelected = isBookmarkTreeBatchDragSelection(dragNodeId);

        if (isDraggedNodeSelected) {
            // Collect all selected permanent node IDs and selected temporary nodes
            const permanentIds = [];
            const tempNodes = [];

            selectedNodes.forEach(id => {
                const meta = selectedNodeMeta.get(id);
                const treeType = meta ? meta.treeType : 'permanent';
                if (treeType === 'temporary') {
                    if (meta.sectionId) {
                        tempNodes.push({ id, sectionId: meta.sectionId });
                    }
                } else {
                    permanentIds.push(id);
                }
            });

            // A. Target is temporary tree
            if (targetTreeType === 'temporary' && manager) {
                const targetInfo = computeTempInsertion(targetSectionId || sourceSectionId, targetId, position);

                // Check for cyclic/self-containment move in temporary selection
                for (const node of tempNodes) {
                    const isFolder = node.isFolder || (manager && typeof manager.findItem === 'function' && manager.findItem(node.sectionId, node.id)?.item?.type === 'folder');
                    if (isFolder && isTempDescendantOf(targetSectionId || sourceSectionId, targetInfo.parentId, node.id)) {
                        const msg = (typeof currentLang !== 'undefined' && currentLang === 'en')
                            ? "Cannot move a folder to itself or its descendants."
                            : "不能将文件夹移动到自身或其子文件夹中。";
                        if (typeof showCanvasToast === 'function') {
                            showCanvasToast(msg, 'warning');
                        } else if (typeof showToast === 'function') {
                            showToast(msg);
                        } else {
                            alert(msg);
                        }
                        return; // Abort drop operation
                    }
                }

                const bySection = new Map();
                tempNodes.forEach(n => {
                    if (!bySection.has(n.sectionId)) bySection.set(n.sectionId, []);
                    bySection.get(n.sectionId).push(n.id);
                });

                if (permanentIds.length === 0 && bySection.size === 1 && bySection.has(targetSectionId)) {
                    // Only same-section temporary items: just move within
                    const ids = bySection.get(targetSectionId);
                    manager.moveWithin(targetSectionId, ids, targetInfo.parentId, targetInfo.index);
                } else {
                    const payload = [];

                    // 1. Serialize permanent selections
                    if (permanentIds.length > 0) {
                        for (const id of permanentIds) {
                            let sourceNode = await readPermanentNodeFromBcs(id);
                            if (!sourceNode) {
                                const nodes = await chrome.bookmarks.getSubTree(id);
                                sourceNode = nodes && nodes[0] ? nodes[0] : null;
                            }
                            if (sourceNode) {
                                payload.push(serializeBookmarkNode(sourceNode));
                            }
                        }
                    }

                    // 2. Extract temporary selections
                    bySection.forEach((ids, secId) => {
                        const p = manager.extractPayload(secId, ids);
                        if (p && p.length) {
                            payload.push(...p);
                        }
                    });

                    // 3. Insert into target section (collapse folders by default)
                    manager.insertFromPayload(targetSectionId, targetInfo.parentId, payload, targetInfo.index, { defaultCollapseFolders: true });

                    // 4. Remove source temporary items
                    bySection.forEach((ids, secId) => {
                        manager.removeItems(secId, ids);
                    });
                }

                try { exitSelectMode(); } catch (_) { }
                return;
            }

            // B. Target is permanent tree
            if (targetTreeType === 'permanent' && chrome && chrome.bookmarks) {
                const insertInfo = await computePermanentInsertion(targetId, targetIsFolder, position);

                // Check for cyclic/self-containment move in permanent selection
                for (const id of permanentIds) {
                    const isFolder = await new Promise(resolve => {
                        try {
                            chrome.bookmarks.get(id, ([node]) => {
                                resolve(node && !node.url);
                            });
                        } catch (_) {
                            resolve(false);
                        }
                    });
                    if (isFolder && await isPermanentDescendantOf(insertInfo.parentId, id)) {
                        const msg = (typeof currentLang !== 'undefined' && currentLang === 'en')
                            ? "Cannot move a folder to itself or its descendants."
                            : "不能将文件夹移动到自身或其子文件夹中。";
                        if (typeof showCanvasToast === 'function') {
                            showCanvasToast(msg, 'warning');
                        } else if (typeof showToast === 'function') {
                            showToast(msg);
                        } else {
                            alert(msg);
                        }
                        return; // Abort drop operation
                    }
                }

                // Group temporary nodes by sectionId
                const bySection = new Map();
                tempNodes.forEach(n => {
                    if (!bySection.has(n.sectionId)) bySection.set(n.sectionId, []);
                    bySection.get(n.sectionId).push(n.id);
                });

                const tempPayload = [];
                bySection.forEach((ids, secId) => {
                    const p = manager.extractPayload(secId, ids);
                    if (p && p.length) {
                        tempPayload.push(...p);
                    }
                });

                // Calculate total operations (permanent nodes are moved, temporary nodes are created)
                const totalNodesToAdd = countPayloadNodes(tempPayload);
                const totalOperations = permanentIds.length + totalNodesToAdd;
                const useBulkMute = totalOperations > 1;
                let muteSession = null;
                let loadingToast = null;

                if (useBulkMute && typeof window !== 'undefined' && typeof window.beginBookmarkBulkMute === 'function') {
                    muteSession = await window.beginBookmarkBulkMute('drag-batch-to-permanent');
                }
                if (typeof window !== 'undefined' && typeof window.showLoadingToast === 'function' && totalOperations > 1) {
                    const msg = typeof currentLang !== 'undefined' && currentLang === 'en' ? `Processing ${totalOperations} items...` : `正在处理 ${totalOperations} 项...`;
                    loadingToast = window.showLoadingToast(msg);
                }

                const progressTracker = {
                    total: totalOperations,
                    current: 0,
                    startTime: Date.now()
                };

                const createdEvents = [];
                const createOptions = { createdEvents, progressTracker, loadingToast };

                try {
                    // 1. Move permanent nodes instead of cloning them (using simulation to prevent index drift)
                    if (permanentIds.length > 0) {
                        const targetParentId = insertInfo.parentId;
                        const targetIndex = insertInfo.index;

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
                            console.warn('[拖拽] 获取原始节点信息失败:', err);
                        }

                        // Retrieve current children of targetParentId to build simulation
                        const currentNodes = await chrome.bookmarks.getChildren(targetParentId);
                        let live = currentNodes.map(c => c.id);

                        // Build the desired final array of child IDs in targetParentId
                        // Remove the selected IDs from target parent if they already exist there
                        let desired = live.filter(id => !permanentIds.includes(id));
                        
                        // Clamp targetIndex
                        let actualInsertIndex = typeof targetIndex === 'number' ? Math.max(0, Math.min(targetIndex, desired.length)) : desired.length;
                        
                        // Insert selected IDs at actualInsertIndex
                        desired.splice(actualInsertIndex, 0, ...permanentIds);

                        // Simulate the moves in reverse order to find the exact indices
                        const plannedMoves = []; // Array of { id, index }
                        for (let i = permanentIds.length - 1; i >= 0; i--) {
                            const id = permanentIds[i];
                            const destIdx = desired.indexOf(id);
                            const nextId = destIdx < desired.length - 1 ? desired[destIdx + 1] : null;

                            // Remove from live simulation
                            const currentIdxInLive = live.indexOf(id);
                            if (currentIdxInLive !== -1) {
                                live.splice(currentIdxInLive, 1);
                            }

                            let insertIdxInLive;
                            if (nextId) {
                                insertIdxInLive = live.indexOf(nextId);
                                if (insertIdxInLive === -1) {
                                    insertIdxInLive = live.length;
                                }
                            } else {
                                insertIdxInLive = live.length;
                            }

                            // Insert in live simulation
                            live.splice(insertIdxInLive, 0, id);
                            plannedMoves.push({ id, index: insertIdxInLive });
                        }

                        // Execute the planned moves in reverse order (same order as collected)
                        for (const move of plannedMoves) {
                            const orig = originalNodeMap.get(move.id) || {};
                            progressTracker.current++;
                            if (loadingToast) {
                                const current = progressTracker.current;
                                const elapsedMs = Date.now() - progressTracker.startTime;
                                const elapsedSec = (elapsedMs / 1000).toFixed(1);
                                let msg = '';
                                if (current > 1) {
                                    const msPerItem = elapsedMs / (current - 1);
                                    const remainingItems = totalOperations - current + 1;
                                    const estimatedRemainingMs = msPerItem * remainingItems;
                                    const estimatedRemainingSec = (estimatedRemainingMs / 1000).toFixed(1);
                                    msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                                        ? `Moving: ${current}/${totalOperations} (${Math.round((current - 1) / totalOperations * 100)}%) | Elapsed ${elapsedSec}s | Est. remaining ${estimatedRemainingSec}s`
                                        : `正在移动: ${current}/${totalOperations} (${Math.round((current - 1) / totalOperations * 100)}%) | 已用 ${elapsedSec}s | 预计剩余 ${estimatedRemainingSec}s`;
                                } else {
                                    msg = typeof currentLang !== 'undefined' && currentLang === 'en'
                                        ? `Moving: ${current}/${totalOperations} (0%) | Elapsed ${elapsedSec}s`
                                        : `正在移动: ${current}/${totalOperations} (0%) | 已用 ${elapsedSec}s`;
                                }
                                loadingToast.update(msg);
                            }
                            await movePermanentBookmarkNodeViaSharedOps(move.id, {
                                parentId: targetParentId,
                                index: move.index
                            }, {
                                ...createOptions,
                                oldParentId: orig.oldParentId,
                                oldIndex: orig.oldIndex
                            });
                        }
                    }

                    // 2. Create permanent bookmarks from temporary payloads
                    let currIndex = typeof insertInfo.index === 'number' ? insertInfo.index + permanentIds.length : null;
                    if (tempPayload.length > 0) {
                        const tagUpdates = [];
                        for (const item of tempPayload) {
                            await createBookmarkFromPayload(insertInfo.parentId, currIndex, item, tagUpdates, createOptions);
                            if (typeof currIndex === 'number') {
                                currIndex++;
                            }
                        }

                        // Inherit tags in bulk
                        if (tagUpdates.length > 0) {
                            const bridge = window.CanvasProtocolBridge;
                            if (bridge && typeof bridge.writePermanentNodeTagsBulk === 'function') {
                                try {
                                    await bridge.writePermanentNodeTagsBulk(tagUpdates);
                                    if (window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                                        await window.TagSystem.ensurePermTagsLoaded(true);
                                    }
                                    if (typeof window.__refreshAllTagDots === 'function') {
                                        window.__refreshAllTagDots();
                                    }
                                } catch (e) {
                                    console.warn('[拖拽] 批量写入永久书签标签失败:', e);
                                }
                            }
                        }
                    }

                    if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                        await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'drag-batch-to-permanent');
                    }

                    // 3. Remove source temporary items only
                    bySection.forEach((ids, secId) => {
                        manager.removeItems(secId, ids);
                    });

                } finally {
                    if (loadingToast) loadingToast.close();
                    if (useBulkMute && typeof window !== 'undefined' && typeof window.endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                        await window.endBookmarkBulkMute('drag-batch-to-permanent', { refreshTree: true });
                    }
                }

                try { exitSelectMode(); } catch (_) { }
                return;
            }
        }

        // 1. 临时栏目 -> 临时栏目
        if (sourceTreeType === 'temporary' && targetTreeType === 'temporary' && manager) {
            // 单个拖拽逻辑（多选逻辑已由顶部 if (isDraggedNodeSelected) 处理并 return）
            const targetInfo = computeTempInsertion(targetSectionId || sourceSectionId, targetId, position);
            
            // Check for cyclic/self-containment move in single temporary item
            const isFolder = manager && typeof manager.findItem === 'function' && manager.findItem(sourceSectionId, dragNodeId)?.item?.type === 'folder';
            if (isFolder && isTempDescendantOf(targetSectionId || sourceSectionId, targetInfo.parentId, dragNodeId)) {
                const msg = (typeof currentLang !== 'undefined' && currentLang === 'en')
                    ? "Cannot move a folder to itself or its descendants."
                    : "不能将文件夹移动到自身或其子文件夹中。";
                if (typeof showCanvasToast === 'function') {
                    showCanvasToast(msg, 'warning');
                } else if (typeof showToast === 'function') {
                    showToast(msg);
                } else {
                    alert(msg);
                }
                return; // Abort
            }

            if (sourceSectionId === targetSectionId) {
                manager.moveWithin(sourceSectionId, [dragNodeId], targetInfo.parentId, targetInfo.index);
            } else {
                manager.moveAcross(sourceSectionId, targetSectionId, [dragNodeId], targetInfo.parentId, targetInfo.index);
            }
            return;
        }

        // 2. 临时栏目 -> 永久栏目
        if (sourceTreeType === 'temporary' && targetTreeType === 'permanent' && manager && chrome && chrome.bookmarks) {
            // 单个拖拽逻辑（多选逻辑已由顶部 if (isDraggedNodeSelected) 处理并 return）
            const payload = manager.extractPayload(sourceSectionId, [dragNodeId]);
            const { parentId, index } = await computePermanentInsertion(targetId, targetIsFolder, position);
            
            const totalNodes = countPayloadNodes(payload);
            const useBulkMute = totalNodes > 1;
            let muteSession = null;
            let loadingToast = null;
            
            if (useBulkMute && typeof window !== 'undefined' && typeof window.beginBookmarkBulkMute === 'function') {
                muteSession = await window.beginBookmarkBulkMute('drag-temp-to-permanent');
            }
            if (typeof window !== 'undefined' && typeof window.showLoadingToast === 'function' && totalNodes > 1) {
                const msg = typeof currentLang !== 'undefined' && currentLang === 'en' ? `Moving ${totalNodes} items...` : `正在移动 ${totalNodes} 项...`;
                loadingToast = window.showLoadingToast(msg);
            }
            const progressTracker = {
                total: totalNodes,
                current: 0,
                startTime: Date.now()
            };
            const createdEvents = [];
            const createOptions = { createdEvents, progressTracker, loadingToast };
            try {
                const tagUpdates = [];
                for (const item of payload) {
                    await createBookmarkFromPayload(parentId, index, item, tagUpdates, createOptions);
                }

                // Inherit tags in bulk
                if (tagUpdates.length > 0) {
                    const bridge = window.CanvasProtocolBridge;
                    if (bridge && typeof bridge.writePermanentNodeTagsBulk === 'function') {
                        try {
                            await bridge.writePermanentNodeTagsBulk(tagUpdates);
                            if (window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                                await window.TagSystem.ensurePermTagsLoaded(true);
                            }
                            if (typeof window.__refreshAllTagDots === 'function') {
                                window.__refreshAllTagDots();
                            }
                        } catch (e) {
                            console.warn('[拖拽] 批量写入永久书签标签失败:', e);
                        }
                    }
                }

                if (useBulkMute && createdEvents.length > 0 && window.__canvasBookmarkBulkMode && typeof window.__canvasBookmarkBulkMode.flushEvents === 'function') {
                    await window.__canvasBookmarkBulkMode.flushEvents(createdEvents, 'drag-temp-to-permanent');
                }

                // Delete the source temporary items
                manager.removeItems(sourceSectionId, [dragNodeId]);
            } finally {
                if (loadingToast) loadingToast.close();
                if (useBulkMute && typeof window !== 'undefined' && typeof window.endBookmarkBulkMute === 'function' && muteSession && muteSession.active) {
                    await window.endBookmarkBulkMute('drag-temp-to-permanent', { refreshTree: true });
                }
            }
            ;
            return;
        }

        // 3. 永久栏目 -> 临时栏目
        if (sourceTreeType === 'permanent' && targetTreeType === 'temporary' && manager && chrome && chrome.bookmarks) {
            // 单个拖拽逻辑（多选逻辑已由顶部 if (isDraggedNodeSelected) 处理并 return）
            let payload = [];
            let sourceNode = await readPermanentNodeFromBcs(dragNodeId);
            if (!sourceNode) {
                const nodes = await chrome.bookmarks.getSubTree(dragNodeId);
                sourceNode = nodes && nodes[0] ? nodes[0] : null;
            }
            if (sourceNode) {
                payload = [serializeBookmarkNode(sourceNode)];
            }

            if (window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                try {
                    await window.TagSystem.ensurePermTagsLoaded();
                } catch (e) {
                    console.warn('[拖拽] 加载永久标签失败:', e);
                }
            }
            const targetInfo = computeTempInsertion(targetSectionId, targetId, position);
            manager.insertFromPayload(targetSectionId, targetInfo.parentId, payload, targetInfo.index, { defaultCollapseFolders: true });
            return;
        }

        // 4. 永久栏目 -> 永久栏目
        if (!chrome || !chrome.bookmarks) {
            console.warn('[拖拽] Chrome扩展环境不可用');
            return;
        }

        // 单个拖拽逻辑（多选逻辑已由顶部 if (isDraggedNodeSelected) 处理并 return）
        const insertInfo = await computePermanentInsertion(targetId, targetIsFolder, position);

        // Check for cyclic/self-containment move in single permanent item
        let sourceChromeNode = null;
        try {
            const nodes = await chrome.bookmarks.get(dragNodeId);
            sourceChromeNode = nodes && nodes[0] ? nodes[0] : null;
        } catch (_) { }
        const isFolder = !!(sourceChromeNode && !sourceChromeNode.url);
        if (isFolder && await isPermanentDescendantOf(insertInfo.parentId, dragNodeId)) {
            const msg = (typeof currentLang !== 'undefined' && currentLang === 'en')
                ? "Cannot move a folder to itself or its descendants."
                : "不能将文件夹移动到自身或其子文件夹中。";
            if (typeof showCanvasToast === 'function') {
                showCanvasToast(msg, 'warning');
            } else if (typeof showToast === 'function') {
                showToast(msg);
            } else {
                alert(msg);
            }
            return; // Abort
        }

        const optimisticMoveInfo = sourceChromeNode && sourceChromeNode.parentId
            ? {
                parentId: String(insertInfo.parentId),
                index: typeof insertInfo.index === 'number' ? insertInfo.index : null,
                oldParentId: String(sourceChromeNode.parentId),
                oldIndex: typeof sourceChromeNode.index === 'number' ? sourceChromeNode.index : null
            }
            : null;
        const appliedOptimisticMove = optimisticMoveInfo
            ? applyPermanentMoveDomFastPath(dragNodeId, optimisticMoveInfo, 'drag-single-permanent-optimistic', {
                skipSnapshotRefresh: true,
                allowFallbackRender: false
            })
            : false;

        ;

        // 执行真实Chrome API移动，不进行克隆，保留原节点与原有标签
        try {
            const movedNode = await movePermanentBookmarkNodeViaSharedOps(dragNodeId, {
                parentId: insertInfo.parentId,
                index: insertInfo.index
            });
            const actualParentId = movedNode && movedNode.parentId ? String(movedNode.parentId) : String(insertInfo.parentId);
            const actualIndex = movedNode && typeof movedNode.index === 'number' ? movedNode.index : insertInfo.index;
            if (appliedOptimisticMove && optimisticMoveInfo
                && (actualParentId !== optimisticMoveInfo.parentId || actualIndex !== optimisticMoveInfo.index)) {
                applyPermanentMoveDomFastPath(dragNodeId, {
                    parentId: actualParentId,
                    index: typeof actualIndex === 'number' ? actualIndex : null,
                    oldParentId: optimisticMoveInfo.parentId,
                    oldIndex: optimisticMoveInfo.index
                }, 'drag-single-permanent-actual');
            }
        } catch (moveError) {
            if (appliedOptimisticMove && optimisticMoveInfo && sourceChromeNode && sourceChromeNode.parentId) {
                applyPermanentMoveDomFastPath(dragNodeId, {
                    parentId: String(sourceChromeNode.parentId),
                    index: typeof sourceChromeNode.index === 'number' ? sourceChromeNode.index : null,
                    oldParentId: optimisticMoveInfo.parentId,
                    oldIndex: optimisticMoveInfo.index
                }, 'drag-single-permanent-rollback');
            }
            throw moveError;
        }

        ;

    } catch (error) {
        if (error && error.message && error.message.includes('move parent is missing')) {
            return;
        }
        console.error('[拖拽] 移动操作失败:', error);
    }
}

// 启动自动滚动
function startAutoScroll() {
    if (autoScrollInterval) return;

    autoScrollInterval = setInterval(() => {
        // 由 updateAutoScroll 控制实际滚动
    }, 10); // 100fps，更高的帧率提供更流畅的拖拽体验
}

// 更新自动滚动
function updateAutoScroll(e) {
    const baseZone = 96; // 基线高度（更大更容易触发）
    const scrollSpeed = 18; // 略微加速

    const now = Date.now();
    if (now - lastScrollTime <= 10) return; // 100fps 节流

    let didScroll = false;

    // 优先滚动鼠标所在的树容器（永久/临时）
    const containers = [];
    document.querySelectorAll('.permanent-section-body').forEach(el => containers.push(el));
    document.querySelectorAll('.temp-node-body').forEach(el => containers.push(el));

    for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
            // 动态热区：容器高度的 12%，夹在 [baseZone, 160]
            const dynamicZone = Math.max(baseZone, Math.min(Math.round(rect.height * 0.12), 160));
            let delta = 0;
            if (e.clientY < rect.top + dynamicZone && e.clientY > rect.top) {
                delta = -scrollSpeed * ((rect.top + dynamicZone - e.clientY) / dynamicZone);
            } else if (e.clientY > rect.bottom - dynamicZone && e.clientY < rect.bottom) {
                delta = scrollSpeed * ((e.clientY - (rect.bottom - dynamicZone)) / dynamicZone);
            }
            if (delta !== 0) {
                c.scrollTop += delta;
                didScroll = true;
                break;
            }
        }
    }

    // 若不在任何树容器边缘，则回退到窗口滚动
    if (!didScroll) {
        const viewportHeight = window.innerHeight;
        const mouseY = e.clientY;
        const dynamicZone = Math.max(baseZone, Math.min(Math.round(viewportHeight * 0.12), 160));
        let winDelta = 0;
        if (mouseY < dynamicZone) winDelta = -scrollSpeed * ((dynamicZone - mouseY) / dynamicZone);
        else if (mouseY > viewportHeight - dynamicZone) winDelta = scrollSpeed * ((mouseY - (viewportHeight - dynamicZone)) / dynamicZone);
        if (winDelta !== 0) {
            window.scrollBy(0, winDelta);
            didScroll = true;
        }
    }

    if (didScroll) lastScrollTime = now;
}

// 停止自动滚动
function stopAutoScroll() {
    if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
    }
}

// 刷新书签树
async function refreshBookmarkTree() {
    if (typeof renderTreeView === 'function') {
        await renderTreeView(true);
    }
}

// =============================================================================
// 外部拖拽反向查找与处理
// =============================================================================

async function findMatchingChromeNode(urls, dataTransfer) {
    if (!chrome || !chrome.bookmarks) return null;
    
    // 1. 如果 urls 长度为 1，直接根据 URL 搜索
    if (urls.length === 1) {
        try {
            const results = await chrome.bookmarks.search({ url: urls[0] });
            if (results && results.length > 0) {
                return results[0];
            }
        } catch (e) {
            console.warn('[拖拽反向查找] 搜索单个 URL 失败:', e);
        }
        return null;
    }
    
    // 2. 如果 urls 长度大于 1，通过后序遍历匹配包含这些 URL 的最深文件夹
    if (urls.length > 1) {
        try {
            const tree = await chrome.bookmarks.getTree();
            const draggedUrlSet = new Set(urls.map(u => u.trim()));
            
            function traverse(node) {
                if (node.url) return null;
                
                // 先遍历子节点（优先匹配最深层级的文件夹）
                if (node.children) {
                    for (const c of node.children) {
                        const match = traverse(c);
                        if (match) return match;
                    }
                }
                
                // 再检查自己
                if (node.children) {
                    const folderUrls = [];
                    function collectUrls(childNode) {
                        if (childNode.url) {
                            folderUrls.push(childNode.url.trim());
                        }
                        if (childNode.children) {
                            for (const c of childNode.children) {
                                collectUrls(c);
                            }
                        }
                    }
                    for (const c of node.children) {
                        collectUrls(c);
                    }
                    
                    if (folderUrls.length === draggedUrlSet.size) {
                        const isMatch = folderUrls.every(url => draggedUrlSet.has(url));
                        if (isMatch) {
                            return node;
                        }
                    }
                }
                return null;
            }
            
            let matchedFolder = null;
            if (tree && tree.length) {
                for (const rootNode of tree) {
                    matchedFolder = traverse(rootNode);
                    if (matchedFolder) break;
                }
            }
            
            if (matchedFolder) {
                ;
                const subTree = await chrome.bookmarks.getSubTree(matchedFolder.id);
                return subTree && subTree[0] ? subTree[0] : matchedFolder;
            }
        } catch (e) {
            console.warn('[拖拽反向查找] 遍历树匹配文件夹失败:', e);
        }
    }
    
    // 3. 如果 urls 为空，或者 URL 集合匹配失败，尝试通过文本内容（文件夹名称）在 Chrome 书签中搜索
    let plainText = '';
    try {
        plainText = dataTransfer.getData('text/plain') || '';
    } catch (_) {}
    
    const folderName = plainText.trim().split(/[\r\n]+/)[0].trim();
    if (folderName && !folderName.match(/^(https?|ftp|file):\/\//i)) {
        try {
            const results = await chrome.bookmarks.search({ title: folderName });
            const folders = results.filter(node => !node.url);
            if (folders.length > 0) {
                const matchedFolder = folders[0];
                ;
                const subTree = await chrome.bookmarks.getSubTree(matchedFolder.id);
                return subTree && subTree[0] ? subTree[0] : matchedFolder;
            }
        } catch (e) {
            console.warn('[拖拽反向查找] 按名称搜索文件夹失败:', e);
        }
    }
    
    return null;
}

if (typeof window !== 'undefined') {
    window.findMatchingChromeNode = findMatchingChromeNode;
}

async function handleExternalDropOnTreeNode(e, targetNodeId, targetIsFolder, context) {
    const { targetTreeType = 'permanent', targetSectionId = null, position = 'inside' } = context || {};
    const { isEn } = (typeof __getLang === 'function' ? __getLang() : { isEn: false });
    const currentLang = isEn ? 'en' : 'zh';
    
    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;
    
    let uriList = '';
    let plainText = '';
    let htmlData = '';
    try {
        uriList = dataTransfer.getData('text/uri-list') || '';
        plainText = dataTransfer.getData('text/plain') || '';
        htmlData = dataTransfer.getData('text/html') || '';
    } catch (_) {}
    
    let urls = [];
    const rawUrls = (uriList || plainText || '').split(/[\r\n]+/).map(s => s.trim()).filter(s => s);
    for (const u of rawUrls) {
        if (u.match(/^(https?|ftp|file):\/\//i)) {
            urls.push(u);
        }
    }
    
    const matchedNode = await findMatchingChromeNode(urls, dataTransfer);
    const manager = getTempManager();
    
    if (matchedNode) {
        if (targetTreeType === 'temporary' && manager) {
            const payload = [serializeBookmarkNode(matchedNode)];
            const targetInfo = computeTempInsertion(targetSectionId, targetNodeId, position);
            manager.insertFromPayload(targetSectionId, targetInfo.parentId, payload, targetInfo.index, { defaultCollapseFolders: true });
        } else if (targetTreeType === 'permanent' && chrome && chrome.bookmarks) {
            const insertInfo = await computePermanentInsertion(targetNodeId, targetIsFolder, position);
            const payload = serializeBookmarkNode(matchedNode);
            await createBookmarkFromPayload(insertInfo.parentId, insertInfo.index, payload);
        }
    } else {
        let title = '';
        if (htmlData) {
            const match = htmlData.match(/<a[^>]*>([^<]*)<\/a>/i);
            if (match && match[1]) title = match[1].trim();
        }
        
        if (urls.length === 1) {
            if (targetTreeType === 'temporary' && manager) {
                const payload = [{
                    title: title || urls[0],
                    url: urls[0],
                    type: 'bookmark'
                }];
                const targetInfo = computeTempInsertion(targetSectionId, targetNodeId, position);
                manager.insertFromPayload(targetSectionId, targetInfo.parentId, payload, targetInfo.index, { defaultCollapseFolders: true });
            } else if (targetTreeType === 'permanent' && chrome && chrome.bookmarks) {
                const insertInfo = await computePermanentInsertion(targetNodeId, targetIsFolder, position);
                await createPermanentBookmarkNodeViaSharedOps({
                    parentId: insertInfo.parentId,
                    index: insertInfo.index,
                    title: title || urls[0],
                    url: urls[0]
                });
            }
        } else if (urls.length > 1) {
            const folderTitle = plainText.trim().split(/[\r\n]+/)[0].trim();
            const resolvedFolderTitle = (folderTitle && !folderTitle.match(/^(https?|ftp|file):\/\//i)) 
                ? folderTitle 
                : (currentLang === 'en' ? 'Imported Folder' : '拖入的文件夹');
                
            const bookmarks = [];
            for (const url of urls) {
                let bmTitle = url;
                if (chrome && chrome.bookmarks) {
                    try {
                        const results = await chrome.bookmarks.search({ url });
                        if (results && results.length > 0) {
                            bmTitle = results[0].title || url;
                        }
                    } catch (_) {}
                }
                bookmarks.push({ title: bmTitle, url, type: 'bookmark' });
            }
            
            const folderPayload = {
                title: resolvedFolderTitle,
                url: '',
                type: 'folder',
                children: bookmarks
            };
            
            if (targetTreeType === 'temporary' && manager) {
                const targetInfo = computeTempInsertion(targetSectionId, targetNodeId, position);
                manager.insertFromPayload(targetSectionId, targetInfo.parentId, [folderPayload], targetInfo.index, { defaultCollapseFolders: true });
            } else if (targetTreeType === 'permanent' && chrome && chrome.bookmarks) {
                const insertInfo = await computePermanentInsertion(targetNodeId, targetIsFolder, position);
                const createdFolder = await createPermanentBookmarkNodeViaSharedOps({
                    parentId: insertInfo.parentId,
                    index: insertInfo.index,
                    title: folderPayload.title
                });
                for (const child of folderPayload.children) {
                    await createPermanentBookmarkNodeViaSharedOps({
                        parentId: createdFolder.id,
                        title: child.title,
                        url: child.url
                    });
                }
            }
        }
    }
}

// =============================================================================
// 导出共享接口（供指针拖拽复用）
// =============================================================================

if (typeof window !== 'undefined') {
    window.__treeDnd = {
        // 显示放置指示器
        showIndicator: showDropIndicator,

        // 隐藏放置指示器
        hideIndicator: hideDropIndicator,

        // 获取当前指示器位置
        getIndicatorPosition: function () {
            return dropIndicator ? dropIndicator.dataset.position : 'inside';
        },

        // 执行移动操作
        performMove: moveBookmark,

        resolvePermanentBlankDropParentId,

        findMatchingChromeNode,

        // 获取拖拽的节点信息
        getDraggedNodeInfo: function () {
            return {
                nodeId: draggedNodeId,
                treeType: draggedNodeTreeType,
                sectionId: draggedNodeSectionId
            };
        }
    };
}

// 导出函数
if (typeof window !== 'undefined') {
    window.initDragDrop = initDragDrop;
    window.attachDragEvents = attachDragEvents;
}
