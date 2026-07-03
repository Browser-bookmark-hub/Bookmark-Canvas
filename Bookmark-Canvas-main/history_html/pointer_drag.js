// =============================================================================
// 指针事件拖拽系统 (Pointer-based Drag System)
// 解决原生HTML5 DnD拖拽期间无法使用滚轮的问题
// =============================================================================

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

let pointerDragState = {
    isDragging: false,
    draggedElement: null,
    dragOverlay: null,
    currentTarget: null,
    startX: 0,
    startY: 0,
    treeContainer: null,
    dragThreshold: 5, // 移动5px后才开始拖拽
    hasMoved: false,
    preventNextClick: false
};

// 全局捕获阶段 click 监听器，用于阻止拖拽释放后误触发的点击事件
document.addEventListener('click', (e) => {
    if (pointerDragState.preventNextClick) {
        e.stopPropagation();
        e.preventDefault();
        pointerDragState.preventNextClick = false;
    }
}, true);

// 暴露给外部的接口：为书签树容器附加指针拖拽事件
// 悬停展开状态（跨模块共享，二次/后续加速）
var __hoverExpandState = (typeof window !== 'undefined' && window.__hoverExpandState)
    ? window.__hoverExpandState
    : { timers: new Map(), counts: new Map(), lastAt: new Map(), session: 0, lastDragEndTime: 0 };
if (typeof window !== 'undefined') window.__hoverExpandState = __hoverExpandState;

// 长时间不拖动后重置的阈值（毫秒）- 使用 var 避免与 bookmark_tree_drag_drop.js 重复声明
var HOVER_EXPAND_RESET_THRESHOLD = (typeof HOVER_EXPAND_RESET_THRESHOLD !== 'undefined')
    ? HOVER_EXPAND_RESET_THRESHOLD
    : 5000; // 5秒不拖动则重置

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
    const hadTimer = __hoverExpandState.timers.has(folderId);
    // 若已有定时器，保持不变，避免把"首次 2.5 秒"意外缩短为更快延迟
    if (hadTimer) return;

    const delay = getHoverDelayForFolder(folderId);

    // 在安排定时器时计数（一次悬停一次识别），连续 dragover 仅重置定时不叠加计数
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
                            console.warn('[指针拖拽展开] 临时栏目懒加载失败:', loadErr);
                        }
                    } else if (treeType === 'permanent' || !treeType) {
                        // 永久栏目：调用 history.js 的懒加载函数
                        try {
                            if (typeof loadPermanentFolderChildrenLazy === 'function') {
                                loadPermanentFolderChildrenLazy(nodeId, children, 0, null);
                            }
                        } catch (loadErr) {
                            console.warn('[指针拖拽展开] 永久栏目懒加载失败:', loadErr);
                        }
                    }
                }

                // 【新增】保存展开状态
                try {
                    if (treeType === 'temporary' && sectionId) {
                        // 临时栏目：调用 saveTempExpandState（如果存在）
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

function findClosestTreeItem(treeRoot, clientY) {
    if (!treeRoot) return null;
    const treeItems = Array.from(treeRoot.querySelectorAll('.tree-item[data-node-id]'));
    let closestItem = null;
    let minDistance = Infinity;
    for (const item of treeItems) {
        const rect = item.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const dist = Math.abs(clientY - centerY);
        if (dist < minDistance) {
            minDistance = dist;
            closestItem = item;
        }
    }
    if (minDistance < 40) {
        return closestItem;
    }
    return null;
}

function attachPointerDragEvents(treeContainer) {
    if (!treeContainer) {
        console.warn('[指针拖拽] 未提供树容器');
        return;
    }

    // 避免重复绑定（renderTreeView 可能多次调用 attachPointerDragEvents）
    if (treeContainer.dataset.pointerDragAttached === 'true') {
        return;
    }
    treeContainer.dataset.pointerDragAttached = 'true';

    ;

    // 使用事件委托，只在容器上监听
    treeContainer.addEventListener('pointerdown', handlePointerDown);

    // 阻止原生拖拽，以便由我们的指针拖拽系统完全接管并允许滚轮滚动
    // 使用捕获阶段绑定在 document 上，以确保比 bookmark_canvas_module.js 的捕获监听器更早执行，
    // 从而使 onDragStart 能够通过 e.defaultPrevented 识别并跳过，防止 CanvasState.dragState.wheelScrollEnabled 被错误置为 true。
    if (!document.__pointerDragGlobalDragStartBound) {
        document.__pointerDragGlobalDragStartBound = true;
        document.addEventListener('dragstart', (e) => {
            const targetItem = e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
            if (targetItem) {
                e.preventDefault();
            }
        }, true);
    }

    // 全局监听 pointermove 和 pointerup（只绑定一次）
    if (!pointerDragState.globalHandlersAttached) {
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerCancel);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && pointerDragState.isDragging) {
                cleanupPointerDrag();
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, true);
        pointerDragState.globalHandlersAttached = true;
    }
}

function handlePointerDown(e) {
    // 只处理左键
    if (e.button !== 0) return;

    // 查找最近的 tree-item
    const treeItem = e.target.closest('.tree-item[data-node-id]');
    if (!treeItem) return;

    // 检查是否点击了toggle按钮
    if (e.target.closest('.tree-toggle')) return;

    // 检查是否点击了输入框或按钮
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;

    // 记录起始状态
    pointerDragState.draggedElement = treeItem;
    pointerDragState.startX = e.clientX;
    pointerDragState.startY = e.clientY;
    // 选择最近的可滚动树容器：永久（.permanent-section-body）或临时（.temp-node-body），最后再退化到 .bookmark-tree
    pointerDragState.treeContainer = treeItem.closest('.permanent-section-body') ||
        treeItem.closest('.temp-node-body') ||
        treeItem.closest('.bookmark-tree');
    pointerDragState.hasMoved = false;
    pointerDragState.isDragging = false; // 还未开始拖拽

    // 注意：在此处，我们不再调用 e.preventDefault()，从而允许浏览器正常触发 native click 事件。
    // 原生拖拽启动（dragstart）将由 attachPointerDragEvents 中绑定的 dragstart 监听器阻止。
}

function handlePointerMove(e) {
    if (!pointerDragState.draggedElement) return;

    const deltaX = Math.abs(e.clientX - pointerDragState.startX);
    const deltaY = Math.abs(e.clientY - pointerDragState.startY);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 检查是否超过阈值
    if (!pointerDragState.hasMoved && distance < pointerDragState.dragThreshold) {
        return; // 还未移动足够距离
    }

    // 开始拖拽
    if (!pointerDragState.isDragging) {
        startPointerDrag(e);
    }

    pointerDragState.hasMoved = true;

    // 如果处于拖动状态，阻止默认事件以避免在拖动过程中触发浏览器的其他默认行为（如文本选择或页面滚动）
    if (pointerDragState.isDragging) {
        e.preventDefault();
    }

    pointerDragState.hasMoved = true;

    // 更新拖拽覆盖层位置
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.style.left = e.clientX + 10 + 'px';
        pointerDragState.dragOverlay.style.top = e.clientY + 10 + 'px';
    }

    // 查找当前鼠标下的目标节点（暂时隐藏覆盖层和放置指示器以避免干扰）
    let target = null;
    const dropIndicator = document.querySelector('.drop-indicator');
    let originalPointerEvents = '';
    if (dropIndicator) {
        originalPointerEvents = dropIndicator.style.pointerEvents;
        dropIndicator.style.pointerEvents = 'none';
    }

    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.style.display = 'none';
        target = document.elementFromPoint(e.clientX, e.clientY);
        pointerDragState.dragOverlay.style.display = 'block';
    } else {
        target = document.elementFromPoint(e.clientX, e.clientY);
    }

    if (dropIndicator) {
        dropIndicator.style.pointerEvents = originalPointerEvents;
    }

    let targetTreeItem = target?.closest('.tree-item[data-node-id]');
    if (!targetTreeItem && target) {
        const treeRoot = target.closest('.bookmark-tree, .temp-bookmark-tree');
        if (treeRoot) {
            targetTreeItem = findClosestTreeItem(treeRoot, e.clientY);
        }
    }

    if (targetTreeItem && targetTreeItem !== pointerDragState.draggedElement) {
        // 更新当前目标
        if (pointerDragState.currentTarget !== targetTreeItem) {
            // 清除旧目标的高亮，并清理其悬停展开计时器
            if (pointerDragState.currentTarget) {
                pointerDragState.currentTarget.classList.remove('drag-over');
                pointerDragState.currentTarget.classList.remove('temp-tree-drop-highlight');
                try {
                    const prevId = pointerDragState.currentTarget.dataset?.nodeId;
                    const t = prevId && __hoverExpandState.timers.get(prevId);
                    if (t) { clearTimeout(t); __hoverExpandState.timers.delete(prevId); }
                } catch (_) { }
            }

            // 高亮新目标
            pointerDragState.currentTarget = targetTreeItem;
            targetTreeItem.classList.add('drag-over');
        }

        // 悬停自动展开文件夹（带二次与后续加速），并显示蓝色候选高亮
        if (targetTreeItem.dataset.nodeType === 'folder') {
            scheduleFolderExpand(targetTreeItem);
            targetTreeItem.classList.add('temp-tree-drop-highlight');
        }

        // 显示放置指示器（调用共享接口）
        if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.showIndicator === 'function') {
            window.__treeDnd.showIndicator(targetTreeItem, e);
        }
    } else if (!targetTreeItem) {
        // 鼠标不在任何tree-item上
        if (pointerDragState.currentTarget) {
            pointerDragState.currentTarget.classList.remove('drag-over');
            pointerDragState.currentTarget.classList.remove('temp-tree-drop-highlight');
            try {
                const prevId = pointerDragState.currentTarget.dataset?.nodeId;
                const t = prevId && __hoverExpandState.timers.get(prevId);
                if (t) { clearTimeout(t); __hoverExpandState.timers.delete(prevId); }
            } catch (_) { }
            pointerDragState.currentTarget = null;
        }

        // 隐藏指示器
        if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.hideIndicator === 'function') {
            window.__treeDnd.hideIndicator();
        }
    }

    // 处理自动滚动（靠近边缘时）
    handleAutoScroll(e);
}

async function handlePointerUp(e) {
    if (!pointerDragState.isDragging) {
        // 未开始拖拽，清理状态。浏览器会自动触发原生 click 事件。
        cleanupPointerDrag();
        return;
    }

    try {
        // 隐藏覆盖层以准确检测落点
        if (pointerDragState.dragOverlay) {
            pointerDragState.dragOverlay.style.display = 'none';
        }

        // 临时禁用放置指示器的 pointer-events，防止其遮挡真正的落点元素
        const dropIndicator = document.querySelector('.drop-indicator');
        let originalPointerEvents = '';
        if (dropIndicator) {
            originalPointerEvents = dropIndicator.style.pointerEvents;
            dropIndicator.style.pointerEvents = 'none';
        }

        // 重新检测落点位置（确保最准确）
        const target = document.elementFromPoint(e.clientX, e.clientY);
        let targetTreeItem = target?.closest('.tree-item[data-node-id]');
        const permanentSection = target?.closest('.permanent-bookmark-section');
        const tempSection = target?.closest('.temp-canvas-node');

        if (dropIndicator) {
            dropIndicator.style.pointerEvents = originalPointerEvents;
        }

        // 恢复覆盖层显示（准备清理）
        if (pointerDragState.dragOverlay) {
            pointerDragState.dragOverlay.style.display = 'block';
        }

        // 检查是否在树容器内
        let treeContainer = target?.closest('.bookmark-tree, .temp-bookmark-tree');

        if (!targetTreeItem && target) {
            const treeRoot = treeContainer || target.closest('.bookmark-tree, .temp-bookmark-tree');
            if (treeRoot) {
                targetTreeItem = findClosestTreeItem(treeRoot, e.clientY);
                if (targetTreeItem) {
                    treeContainer = treeRoot;
                }
            }
        }

        if (targetTreeItem && targetTreeItem !== pointerDragState.draggedElement && treeContainer) {
            // 在树内放置
            performDrop(pointerDragState.draggedElement, targetTreeItem, e);
        } else if (targetTreeItem && targetTreeItem === pointerDragState.draggedElement) {
            // 拖到自己身上，视为取消/无效操作，直接清理，不创建新临时栏目
            return;
        } else if (!targetTreeItem && permanentSection) {
            const draggedElement = pointerDragState.draggedElement;
            const dragNodeId = draggedElement?.dataset?.nodeId || '';
            const sourceTreeType = draggedElement?.dataset?.treeType || 'permanent';
            const sourceSectionId = draggedElement?.dataset?.sectionId || null;
            const targetParentId = (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.resolvePermanentBlankDropParentId === 'function')
                ? window.__treeDnd.resolvePermanentBlankDropParentId(permanentSection)
                : null;

            if (dragNodeId && targetParentId && typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.performMove === 'function') {
                window.__treeDnd.performMove(dragNodeId, targetParentId, true, {
                    sourceTreeType,
                    sourceSectionId,
                    targetTreeType: 'permanent',
                    targetSectionId: null,
                    position: 'inside',
                    event: e
                });
            }
        } else if (!targetTreeItem && tempSection) {
            const draggedElement = pointerDragState.draggedElement;
            const dragNodeId = draggedElement?.dataset?.nodeId || '';
            const sourceTreeType = draggedElement?.dataset?.treeType || 'permanent';
            const sourceSectionId = draggedElement?.dataset?.sectionId || null;
            const targetSectionId = tempSection.dataset.sectionId;

            if (dragNodeId && targetSectionId && typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.performMove === 'function') {
                window.__treeDnd.performMove(dragNodeId, null, true, {
                    sourceTreeType,
                    sourceSectionId,
                    targetTreeType: 'temporary',
                    targetSectionId,
                    position: 'inside',
                    event: e
                });
            }
        } else {
            // 可能拖到Canvas外，检查是否需要创建临时栏目
            const canvasWorkspace = document.getElementById('canvasWorkspace');
            const primaryPermanentSection = document.getElementById('permanentSection');

            if (canvasWorkspace && primaryPermanentSection) {
                const workspaceRect = canvasWorkspace.getBoundingClientRect();
                const permanentRect = primaryPermanentSection.getBoundingClientRect();

                const inWorkspace = e.clientX >= workspaceRect.left &&
                    e.clientX <= workspaceRect.right &&
                    e.clientY >= workspaceRect.top &&
                    e.clientY <= workspaceRect.bottom;

                const inPermanent = e.clientX >= permanentRect.left &&
                    e.clientX <= permanentRect.right &&
                    e.clientY >= permanentRect.top &&
                    e.clientY <= permanentRect.bottom;

                let inTempSection = false;
                try {
                    const canvasContent = document.getElementById('canvasContent');
                    const scope = canvasContent || document;
                    scope.querySelectorAll('.temp-canvas-node').forEach((sec) => {
                        if (inTempSection) return;
                        const tRect = sec.getBoundingClientRect();
                        if (e.clientX >= tRect.left && e.clientX <= tRect.right &&
                            e.clientY >= tRect.top && e.clientY <= tRect.bottom) {
                            inTempSection = true;
                        }
                    });
                } catch (_) {}

                // 如果在Canvas工作区但不在任何已有栏目（永久/临时）内，创建临时栏目
                if (inWorkspace && !inPermanent && !inTempSection) {
                    const draggedElement = pointerDragState.draggedElement;
                    const dragNodeId = draggedElement?.dataset?.nodeId;
                    const isDraggedNodeSelected = dragNodeId && typeof selectedNodes !== 'undefined' && selectedNodes && selectedNodes.has(dragNodeId);

                    const batchToTemp = window.batchToTempSection || (typeof batchToTempSection !== 'undefined' ? batchToTempSection : null);
                    if (isDraggedNodeSelected && batchToTemp) {
                        await batchToTemp(e);
                    } else {
                        handleDropToCanvas(e, workspaceRect);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[指针拖拽] 放置操作发生异常:', err);
    } finally {
        // 拖拽成功结束，标记接下来短时间内阻止触发点击事件（防误触）
        pointerDragState.preventNextClick = true;
        setTimeout(() => {
            pointerDragState.preventNextClick = false;
        }, 50);

        cleanupPointerDrag();
    }
}

function handlePointerCancel(e) {
    cleanupPointerDrag();
}

function startPointerDrag(e) {
    pointerDragState.isDragging = true;
    try {
        window.getSelection()?.removeAllRanges();
    } catch (_) {}

    const draggedElement = pointerDragState.draggedElement;
    if (!draggedElement) return;

    // 添加拖拽样式
    draggedElement.classList.add('dragging');

    // 创建拖拽覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'pointer-drag-overlay';

    // Calculate detailed count for selection
    let previewText = draggedElement.dataset.nodeTitle || draggedElement.dataset.nodeUrl || '拖拽中...';
    const dragNodeId = draggedElement.dataset.nodeId;
    const isDraggedNodeSelected = dragNodeId && typeof selectedNodes !== 'undefined' && selectedNodes && selectedNodes.has(dragNodeId);

    if (isDraggedNodeSelected && selectedNodes.size > 1) {
        let bookmarkCount = 0;
        let folderCount = 0;
        selectedNodes.forEach(id => {
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

        // 简洁的框体样式：使用暗色背景和橙色边框
        overlay.style.background = '#282828';
        overlay.style.border = '1px solid #ff7b00';
        overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
        overlay.style.fontWeight = 'normal';
    } else {
        overlay.style.background = '#282828';
        overlay.style.border = '1px solid #555';
        overlay.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
        overlay.style.fontWeight = 'normal';
    }

    overlay.textContent = previewText;
    overlay.style.position = 'fixed';
    overlay.style.left = e.clientX + 10 + 'px';
    overlay.style.top = e.clientY + 10 + 'px';
    overlay.style.padding = '4px 8px';
    overlay.style.color = 'white';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '10000';
    overlay.style.fontSize = '12px';
    overlay.style.maxWidth = '260px'; // Slightly wider to hold details
    overlay.style.overflow = 'hidden';
    overlay.style.textOverflow = 'ellipsis';
    overlay.style.whiteSpace = 'nowrap';

    getOverlayContainer().appendChild(overlay);
    pointerDragState.dragOverlay = overlay;

    // 重置“本次拖动”的悬停展开加速状态
    try {
        if (__hoverExpandState) {
            __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
            __hoverExpandState.timers.forEach((t) => clearTimeout(t));
            __hoverExpandState.timers.clear();
            __hoverExpandState.counts.clear();
            __hoverExpandState.lastAt.clear();
        }
    } catch (_) { }

    ;
}

function performDrop(draggedElement, targetElement, event) {
    if (!draggedElement || !targetElement) return;

    const dragNodeId = draggedElement.dataset.nodeId;
    const targetId = targetElement.dataset.nodeId;
    const targetIsFolder = targetElement.dataset.nodeType === 'folder';

    ;

    // 获取放置位置（before/inside/after）
    let position = 'inside';
    if (typeof window.__treeDnd !== 'undefined' && window.__treeDnd.getIndicatorPosition) {
        position = window.__treeDnd.getIndicatorPosition();
    }

    // 获取树类型和section ID
    const sourceTreeType = draggedElement.dataset.treeType || 'permanent';
    const sourceSectionId = draggedElement.dataset.sectionId || null;
    const targetTreeType = targetElement.dataset.treeType || 'permanent';
    const targetSectionId = targetElement.dataset.sectionId || null;

    // 调用共享的移动逻辑
    if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.performMove === 'function') {
        window.__treeDnd.performMove(dragNodeId, targetId, targetIsFolder, {
            sourceTreeType,
            sourceSectionId,
            targetTreeType,
            targetSectionId,
            position,
            event
        });
    } else {
        console.warn('[指针拖拽] 未找到共享移动接口');
    }
}

function handleAutoScroll(e) {
    const baseZone = 96; // 更高的触发高度
    const scrollSpeed = 18; // 稍快
    let didScroll = false;

    // 根据指针位置选择容器进行滚动（永久 body + 临时 body）
    const containers = [];
    document.querySelectorAll('.permanent-section-body').forEach(el => containers.push(el));
    document.querySelectorAll('.temp-node-body').forEach(el => containers.push(el));
    for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
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

    // 如果没有滚动书签树容器，则检查并触发画布边缘自动滚动
    if (!didScroll) {
        if (typeof window.checkEdgeAutoScroll === 'function') {
            window.checkEdgeAutoScroll(e.clientX, e.clientY);
        }
        // 备选：滚动窗口
        const viewportHeight = window.innerHeight;
        const dynamicZone = Math.max(baseZone, Math.min(Math.round(viewportHeight * 0.12), 160));
        let winDelta = 0;
        if (e.clientY < dynamicZone) winDelta = -scrollSpeed * ((dynamicZone - e.clientY) / dynamicZone);
        else if (e.clientY > viewportHeight - dynamicZone) winDelta = scrollSpeed * ((e.clientY - (viewportHeight - dynamicZone)) / dynamicZone);
        if (winDelta !== 0) window.scrollBy(0, winDelta);
    } else {
        // 如果滚动了书签树容器，停止画布边缘自动滚动
        if (typeof window.stopEdgeAutoScroll === 'function') {
            window.stopEdgeAutoScroll();
        }
    }
}

async function handleDropToCanvas(event, workspaceRect) {
    if (!pointerDragState.draggedElement) return;

    const draggedElement = pointerDragState.draggedElement;
    const nodeId = draggedElement.dataset.nodeId;
    const nodeTitle = draggedElement.dataset.nodeTitle;
    const nodeUrl = draggedElement.dataset.nodeUrl;
    const isFolder = draggedElement.dataset.nodeType === 'folder';
    const sourceTreeType = draggedElement.dataset.treeType || 'permanent';
    const sourceSectionId = draggedElement.dataset.sectionId || null;

    ;

    // 获取Canvas状态（缩放和平移）
    const CanvasState = window.CanvasModule?.CanvasState || window.CanvasState;
    const zoom = CanvasState?.zoom || 1;
    const panOffsetX = CanvasState?.panOffsetX || 0;
    const panOffsetY = CanvasState?.panOffsetY || 0;

    // 计算Canvas坐标
    const canvasX = (event.clientX - workspaceRect.left - panOffsetX) / zoom;
    const canvasY = (event.clientY - workspaceRect.top - panOffsetY) / zoom;

    // 准备拖拽数据
    const dragData = {
        id: nodeId,
        title: nodeTitle,
        url: nodeUrl,
        type: isFolder ? 'folder' : 'bookmark',
        source: sourceTreeType === 'temporary' ? 'temporary' : 'permanent',
        sectionId: sourceTreeType === 'temporary' ? sourceSectionId : null
    };
    // Scheme A: persist "which permanent section (#0/#n) it came from" for new temp sections.
    if (dragData.source === 'permanent') {
        try {
            const originSection = draggedElement && draggedElement.closest ? draggedElement.closest('.permanent-bookmark-section') : null;
            const protocolBridge = window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.resolvePermanentSectionContext === 'function'
                ? window.CanvasProtocolBridge
                : null;
            const sectionContext = originSection && protocolBridge
                ? protocolBridge.resolvePermanentSectionContext(originSection)
                : null;
            const copyId = sectionContext && sectionContext.copyId
                ? sectionContext.copyId
                : (originSection && originSection.dataset ? originSection.dataset.permanentSectionCopyId : null);
            const displayIndex = sectionContext && sectionContext.displayIndex
                ? sectionContext.displayIndex
                : (originSection && originSection.dataset ? originSection.dataset.permanentSectionDisplayIndex : null);
            if (copyId) {
                dragData.permanentCopyId = copyId;
            } else if (originSection) {
                dragData.permanentIsOriginal = true;
            }
            if (displayIndex) dragData.permanentDisplayIndex = displayIndex;
        } catch (_) { }
    }

    try {
        // 调用Canvas模块创建临时栏目（复用原有逻辑）
        if (window.createTempNode && typeof window.createTempNode === 'function') {
            await window.createTempNode(dragData, canvasX, canvasY);
            ;
        } else if (window.CanvasModule && typeof window.CanvasModule.createTempNode === 'function') {
            await window.CanvasModule.createTempNode(dragData, canvasX, canvasY);
            ;
        } else {
            console.warn('[指针拖拽] 未找到创建临时栏目的函数');
        }
    } catch (error) {
        console.error('[指针拖拽] 创建临时栏目失败:', error);
    }
}

function cleanupPointerDrag() {
    // 停止画布边缘自动滚动
    if (typeof window.stopEdgeAutoScroll === 'function') {
        window.stopEdgeAutoScroll();
    }

    // 移除拖拽样式
    if (pointerDragState.draggedElement) {
        pointerDragState.draggedElement.classList.remove('dragging');
    }

    // 移除目标高亮
    if (pointerDragState.currentTarget) {
        pointerDragState.currentTarget.classList.remove('drag-over');
    }

    // 移除拖拽覆盖层
    if (pointerDragState.dragOverlay) {
        pointerDragState.dragOverlay.remove();
    }

    // 隐藏指示器
    if (typeof window.__treeDnd !== 'undefined' && typeof window.__treeDnd.hideIndicator === 'function') {
        window.__treeDnd.hideIndicator();
    }

    // 全量清除候选/悬停样式，防止残留需要刷新才消失
    try {
        document.querySelectorAll('.temp-tree-drop-highlight').forEach(el => el.classList.remove('temp-tree-drop-highlight'));
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        document.querySelectorAll('.temp-drop-highlight').forEach(el => el.classList.remove('temp-drop-highlight'));
        document.querySelectorAll('.tree-item.dragging').forEach(el => el.classList.remove('dragging'));
        document.querySelectorAll('.tree-item.tree-drag-out').forEach(el => el.classList.remove('tree-drag-out'));
        document.querySelectorAll('.tree-item.tree-drag-leaving').forEach(el => el.classList.remove('tree-drag-leaving'));
        document.querySelectorAll('.permanent-bookmark-section.drag-origin-active').forEach(el => el.classList.remove('drag-origin-active'));
        document.querySelectorAll('.temp-canvas-node.drag-origin-active').forEach(el => el.classList.remove('drag-origin-active'));
        const ws = document.getElementById('canvasWorkspace');
        if (ws) ws.classList.remove('canvas-drop-active');
    } catch (_) { }

    // 重置状态
    pointerDragState.isDragging = false;
    pointerDragState.draggedElement = null;
    pointerDragState.dragOverlay = null;
    pointerDragState.currentTarget = null;
    pointerDragState.treeContainer = null;
    pointerDragState.hasMoved = false;

    // 确保 CanvasState.dragState.wheelScrollEnabled 被还原，以防其处于 stuck 状态
    try {
        const CanvasState = window.CanvasModule?.CanvasState || window.CanvasState;
        if (CanvasState && CanvasState.dragState) {
            CanvasState.dragState.wheelScrollEnabled = false;
        }
    } catch (_) {}

    // 结束拖动：清理所有悬停展开计时器，记录结束时间
    // 不立即清除计数，让后续拖动可以继续使用1.2秒的快速延迟
    try {
        __hoverExpandState.session = (__hoverExpandState.session || 0) + 1;
        __hoverExpandState.timers.forEach((t) => clearTimeout(t));
        __hoverExpandState.timers.clear();
        __hoverExpandState.lastDragEndTime = Date.now();
        __hoverExpandState.lastAt.clear();
    } catch (_) { }
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.attachPointerDragEvents = attachPointerDragEvents;
    window.pointerDragState = pointerDragState;
    ;
}
