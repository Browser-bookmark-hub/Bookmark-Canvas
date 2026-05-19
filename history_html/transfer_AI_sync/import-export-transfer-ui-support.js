/*
 * Bookmark-Canvas transfer_AI_sync supplemental extraction
 *
 * Source: history_html/bookmark_canvas_module.js
 *
 * These are import/export-adjacent runtime helpers that live outside the main
 * `// 导入导出功能` block. They are included so the extracted folder covers
 * the button wiring, drag/drop import helpers, import-container membership,
 * positioning, and imported-group drag behavior. It is loaded by history.html
 * before bookmark_canvas_module.js and still expects the original
 * Bookmark-Canvas runtime globals when executed.
 */


// ---- export-folder-name-helpers: source lines 5-7 ----

// Unified Export Folder Paths - 统一的导出文件夹路径（根据语言动态选择）
const getCanvasExportRootFolder = () => (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? '书签画布' : 'Bookmark Canvas';
const getCanvasExportFolder = () => (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? '书签画布' : 'Canvas';



// ---- import-container-membership-helpers: source lines 1424-1669 ----

function __rectFullyInside(inner, outer, margin = 0) {
    if (!inner || !outer) return false;
    const m = (typeof margin === 'number' && isFinite(margin)) ? margin : 0;
    return (
        inner.x >= outer.x + m &&
        inner.y >= outer.y + m &&
        inner.x + inner.w <= outer.x + outer.w - m &&
        inner.y + inner.h <= outer.y + outer.h - m
    );
}

function __ensureImportContainerMembership(containerNode) {
    if (!containerNode || containerNode.subtype !== 'import-container') return;
    if (!containerNode.containedTempIds) containerNode.containedTempIds = [];
    if (!containerNode.containedMdIds) containerNode.containedMdIds = [];
    if (containerNode._membershipInitialized) return;

    // 若当前与其它组框重叠，避免“误吸附”迁移：保持空成员，后续由用户手动拖入建立关系
    const selfRect = __getRectOfSectionOrNode(containerNode, 'md-node');
    if (!selfRect) {
        containerNode._membershipInitialized = true;
        return;
    }
    const otherContainers = Array.isArray(CanvasState.mdNodes)
        ? CanvasState.mdNodes.filter(n => n && n.id && n.id !== containerNode.id && n.subtype === 'import-container')
        : [];
    const overlapsOther = otherContainers.some((n) => {
        const r = __getRectOfSectionOrNode(n, 'md-node');
        return r ? __rectsOverlap(selfRect, r, 0) : false;
    });
    if (overlapsOther) {
        containerNode._membershipInitialized = true;
        return;
    }

    // 尝试一次性迁移：把“完全在框内”的节点作为初始成员（仅在不重叠的情况下）
    const zoom = (CanvasState.zoom && CanvasState.zoom > 0) ? CanvasState.zoom : 1;
    const margin = 12 / zoom;

    const tempIds = [];
    for (const s of (CanvasState.tempSections || [])) {
        if (!s || !s.id) continue;
        const r = __getRectOfSectionOrNode(s, 'temp-section');
        if (r && __rectFullyInside(r, selfRect, margin)) tempIds.push(s.id);
    }
    const mdIds = [];
    for (const n of (CanvasState.mdNodes || [])) {
        if (!n || !n.id) continue;
        if (n.id === containerNode.id) continue;
        if (n.subtype === 'import-container') continue; // 不自动把组框放进组框
        const r = __getRectOfSectionOrNode(n, 'md-node');
        if (r && __rectFullyInside(r, selfRect, margin)) mdIds.push(n.id);
    }

    containerNode.containedTempIds = Array.from(new Set([...(containerNode.containedTempIds || []), ...tempIds]));
    containerNode.containedMdIds = Array.from(new Set([...(containerNode.containedMdIds || []), ...mdIds]));
    containerNode._membershipInitialized = true;
    try { saveTempNodes(); } catch (_) { }
}

function __collectImportContainerChildElements(containerNode) {
    if (!containerNode || containerNode.subtype !== 'import-container') return [];
    __ensureImportContainerMembership(containerNode);
    const childElements = [];

    const tempIds = Array.isArray(containerNode.containedTempIds) ? containerNode.containedTempIds : [];
    tempIds.forEach((id) => {
        const sec = (CanvasState.tempSections || []).find(s => s && s.id === id);
        if (!sec) return;
        childElements.push({
            type: 'temp-section',
            data: sec,
            startX: Number(sec.x),
            startY: Number(sec.y),
            element: document.getElementById(sec.id)
        });
    });

    const mdIds = Array.isArray(containerNode.containedMdIds) ? containerNode.containedMdIds : [];
    mdIds.forEach((id) => {
        const n = (CanvasState.mdNodes || []).find(nn => nn && nn.id === id);
        if (!n) return;
        childElements.push({
            type: 'md-node',
            data: n,
            startX: Number(n.x),
            startY: Number(n.y),
            element: document.getElementById(n.id)
        });
    });

    childElements.forEach((child) => {
        if (child && child.element) {
            try { child.element.style.transition = 'none'; } catch (_) { }
        }
    });

    return childElements;
}

function __removeNodeFromAllImportContainers(nodeId) {
    if (!nodeId) return false;
    let changed = false;
    for (const c of (CanvasState.mdNodes || [])) {
        if (!c || c.subtype !== 'import-container') continue;
        if (Array.isArray(c.containedTempIds) && c.containedTempIds.includes(nodeId)) {
            c.containedTempIds = c.containedTempIds.filter(id => id !== nodeId);
            changed = true;
        }
        if (Array.isArray(c.containedMdIds) && c.containedMdIds.includes(nodeId)) {
            c.containedMdIds = c.containedMdIds.filter(id => id !== nodeId);
            changed = true;
        }
    }
    return changed;
}

function __addNodeToImportContainer(containerNode, nodeId, nodeType) {
    if (!containerNode || containerNode.subtype !== 'import-container') return false;
    if (!nodeId) return false;
    __ensureImportContainerMembership(containerNode);
    if (nodeType === 'temp-section') {
        containerNode.containedTempIds = Array.isArray(containerNode.containedTempIds) ? containerNode.containedTempIds : [];
        if (!containerNode.containedTempIds.includes(nodeId)) {
            containerNode.containedTempIds.push(nodeId);
            return true;
        }
        return false;
    }
    if (nodeType === 'md-node') {
        // 不允许组框进组框（降低误触/误吸附）
        const n = (CanvasState.mdNodes || []).find(nn => nn && nn.id === nodeId);
        if (n && n.subtype === 'import-container') return false;
        containerNode.containedMdIds = Array.isArray(containerNode.containedMdIds) ? containerNode.containedMdIds : [];
        if (!containerNode.containedMdIds.includes(nodeId)) {
            containerNode.containedMdIds.push(nodeId);
            return true;
        }
        return false;
    }
    return false;
}

function __updateImportContainerMembershipAfterMove(nodeId) {
    if (!nodeId) return;
    const temp = (CanvasState.tempSections || []).find(s => s && s.id === nodeId) || null;
    const md = (CanvasState.mdNodes || []).find(n => n && n.id === nodeId) || null;
    const nodeType = temp ? 'temp-section' : (md ? 'md-node' : null);
    if (!nodeType) return;
    if (md && md.subtype === 'import-container') return; // 组框本身不参与

    const nodeRect = __getRectOfSectionOrNode(temp || md, nodeType);
    if (!nodeRect) return;

    const zoom = (CanvasState.zoom && CanvasState.zoom > 0) ? CanvasState.zoom : 1;
    const margin = 12 / zoom;

    const containers = (CanvasState.mdNodes || []).filter(n => n && n.subtype === 'import-container');
    // 选择“最小能完全包含”的容器（更符合小放大、可嵌套的直觉）
    let target = null;
    let bestArea = Infinity;
    for (const c of containers) {
        if (!c || !c.id) continue;
        const r = __getRectOfSectionOrNode(c, 'md-node');
        if (!r) continue;
        if (!__rectFullyInside(nodeRect, r, margin)) continue;
        const area = r.w * r.h;
        if (area < bestArea) {
            bestArea = area;
            target = c;
        }
    }

    let changed = false;
    changed = __removeNodeFromAllImportContainers(nodeId) || changed;
    if (target) {
        changed = __addNodeToImportContainer(target, nodeId, nodeType) || changed;
    }
    if (changed) {
        try { saveTempNodes(); } catch (_) { }
    }
}

function __recomputeImportContainerMembershipForTempState(tempState) {
    if (!tempState || typeof tempState !== 'object') return;
    const tempSections = Array.isArray(tempState.sections) ? tempState.sections : [];
    const mdNodes = Array.isArray(tempState.mdNodes) ? tempState.mdNodes : [];
    const containers = mdNodes.filter(n => n && n.subtype === 'import-container');
    if (containers.length === 0) return;

    const margin = 12;

    const getRect = (obj) => {
        if (!obj) return null;
        const x = Number(obj.x);
        const y = Number(obj.y);
        const w = Number(obj.width);
        const h = Number(obj.height);
        if (![x, y, w, h].every(v => typeof v === 'number' && isFinite(v))) return null;
        return { x, y, w, h };
    };

    // Reset and mark initialized: membership is derived from geometry here (Obsidian .canvas has no explicit membership).
    containers.forEach((c) => {
        c.containedTempIds = [];
        c.containedMdIds = [];
        c._membershipInitialized = true;
    });

    const findSmallestContainer = (rect) => {
        let target = null;
        let bestArea = Infinity;
        for (const c of containers) {
            const cr = getRect(c);
            if (!cr) continue;
            if (!__rectFullyInside(rect, cr, margin)) continue;
            const area = cr.w * cr.h;
            if (area < bestArea) {
                bestArea = area;
                target = c;
            }
        }
        return target;
    };

    for (const s of tempSections) {
        if (!s || !s.id) continue;
        const r = getRect(s);
        if (!r) continue;
        const c = findSmallestContainer(r);
        if (c) {
            c.containedTempIds.push(s.id);
        }
    }

    for (const n of mdNodes) {
        if (!n || !n.id) continue;
        if (n.subtype === 'import-container') continue; // 不做组框进组框
        const r = getRect(n);
        if (!r) continue;
        const c = findSmallestContainer(r);
        if (c) {
            c.containedMdIds.push(n.id);
        }
    }
}



// ---- import-auto-position-helper: source lines 3092-3234 ----

let importPositionOffset = 0;

function findAvailablePositionInViewport(width = null, height = null) {
    const defaults = getTempSectionBaseSize();
    const resolvedWidth = Number.isFinite(width) ? width : defaults.width;
    const resolvedHeight = Number.isFinite(height) ? height : defaults.height;
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) {
        return { x: 100, y: 100, needsHigherZIndex: false };
    }

    const rect = workspace.getBoundingClientRect();
    const zoom = CanvasState.zoom || 1;
    const panX = CanvasState.panOffsetX || 0;
    const panY = CanvasState.panOffsetY || 0;

    // 计算当前视口中心的 Canvas 坐标
    const viewportCenterScreenX = rect.width / 2;
    const viewportCenterScreenY = rect.height / 2;
    const viewportCenterCanvasX = (viewportCenterScreenX - panX) / zoom;
    const viewportCenterCanvasY = (viewportCenterScreenY - panY) / zoom;

    // 计算当前视口边界的 Canvas 坐标（用于 clamp，确保新元素在视口内可见）
    const viewportLeftCanvasX = (0 - panX) / zoom;
    const viewportTopCanvasY = (0 - panY) / zoom;
    const viewportRightCanvasX = (rect.width - panX) / zoom;
    const viewportBottomCanvasY = (rect.height - panY) / zoom;

    // 位置策略：
    // - 默认落点在“当前视口中心偏右一点”的空白区域（右偏移以屏幕像素为基准，跨缩放一致）
    // - 多次导入时，轻微右下错位（同样以屏幕像素为基准）
    // - 额外：尽量避免与现有栏目重叠（否则拖动 import-container 时会误捕获其它栏目）
    // - 最终 clamp 到当前视口内，避免跑到很远的右侧
    const marginPx = 24;
    const marginX = marginPx / zoom;
    const marginY = marginPx / zoom;

    const baseRightBiasPx = Math.min(200, rect.width * 0.18); // 视口宽度的 18%，上限 200px
    const baseRightBiasX = baseRightBiasPx / zoom;

    const clampWithin = (value, min, max) => {
        if (!(typeof min === 'number' && isFinite(min))) return value;
        if (!(typeof max === 'number' && isFinite(max))) return value;
        // 若元素尺寸大于视口，min/max 会反转；此时不强行 clamp（避免跳到奇怪的位置）
        if (max < min) return value;
        return Math.min(max, Math.max(min, value));
    };

    const padPx = 16; // 期望与其它栏目保持的最小间距（屏幕像素）
    const pad = padPx / zoom;

    const overlaps = (ax, ay, aw, ah, bx, by, bw, bh) => {
        if (![ax, ay, aw, ah, bx, by, bw, bh].every(v => typeof v === 'number' && isFinite(v))) return false;
        return !(
            ax + aw + pad <= bx ||
            bx + bw + pad <= ax ||
            ay + ah + pad <= by ||
            by + bh + pad <= ay
        );
    };

    const collidesWithExisting = (x, y) => {
        // 仅用状态数据做碰撞检测（即使某些 DOM 休眠未渲染，也能避免重叠）
        for (const sec of (CanvasState.tempSections || [])) {
            if (!sec) continue;
            // 自己还没 push 进 tempSections，此处无需排除 id
            const sx = Number(sec.x);
            const sy = Number(sec.y);
            const sw = Number(sec.width);
            const sh = Number(sec.height);
            if (overlaps(x, y, resolvedWidth, resolvedHeight, sx, sy, sw, sh)) return true;
        }
        for (const node of (CanvasState.mdNodes || [])) {
            if (!node) continue;
            const nx = Number(node.x);
            const ny = Number(node.y);
            const nw = Number(node.width) || 200;
            const nh = Number(node.height) || 100;
            if (overlaps(x, y, resolvedWidth, resolvedHeight, nx, ny, nw, nh)) return true;
        }
        return false;
    };

    const baseX = viewportCenterCanvasX - resolvedWidth / 2 + baseRightBiasX;
    const baseY = viewportCenterCanvasY - resolvedHeight / 2;

    // 搜索候选点：优先“偏右”，上下交替扩展；步长按元素尺寸计算，保证连续导入不会重叠/内嵌
    const minStepPx = 44;
    const stepX = Math.max((resolvedWidth + pad * 2), (minStepPx / zoom));
    const stepY = Math.max((resolvedHeight * 0.65 + pad * 2), ((minStepPx * 0.6) / zoom));
    const yMultipliers = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    const xMultipliers = [0, 1, 2, 3, 4, 5, 6];

    let targetX = baseX;
    let targetY = baseY;
    let found = false;

    const seedX = ((importPositionOffset % 3) * 10) / zoom;
    const seedY = ((importPositionOffset % 5) * 8) / zoom;

    for (let xi = 0; xi < xMultipliers.length && !found; xi++) {
        for (let yi = 0; yi < yMultipliers.length && !found; yi++) {
            const x = clampWithin(
                baseX + xMultipliers[xi] * stepX + seedX,
                viewportLeftCanvasX + marginX,
                viewportRightCanvasX - resolvedWidth - marginX
            );
            const y = clampWithin(
                baseY + yMultipliers[yi] * stepY + seedY,
                viewportTopCanvasY + marginY,
                viewportBottomCanvasY - resolvedHeight - marginY
            );
            if (!collidesWithExisting(x, y)) {
                targetX = x;
                targetY = y;
                found = true;
            }
        }
    }

    // 如果都碰撞，至少保证在视口内
    if (!found) {
        targetX = clampWithin(
            baseX + seedX,
            viewportLeftCanvasX + marginX,
            viewportRightCanvasX - resolvedWidth - marginX
        );
        targetY = clampWithin(
            baseY + seedY,
            viewportTopCanvasY + marginY,
            viewportBottomCanvasY - resolvedHeight - marginY
        );
    }

    // 更新偏移计数器（循环使用，避免偏移过大）
    importPositionOffset = (importPositionOffset + 1) % 8;

    return {
        x: targetX,
        y: targetY,
        needsHigherZIndex: true  // 所有导入的栏目都设置更高z-index，确保可见
    };
}



// ---- drag-drop-bookmark-import-helpers: source lines 5075-5768 ----

async function handleSingleUrlDrop(url, htmlData, dropX, dropY) {
    const { isEn } = __getLang();

    // 从 HTML 获取标题
    let title = '';
    if (htmlData) {
        const match = htmlData.match(/<a[^>]*>([^<]*)<\/a>/i);
        if (match && match[1]) {
            title = match[1].trim();
        }
    }

    // 尝试在书签库中找到这个 URL
    if (browserAPI && browserAPI.bookmarks) {
        try {
            const results = await browserAPI.bookmarks.search({ url: url });
            if (results && results.length > 0) {
                const bookmark = results[0];
                let parentId = String(bookmark.parentId); // 确保是字符串

                console.log('[Canvas] 书签 parentId:', parentId, '类型:', typeof bookmark.parentId);

                // 根级文件夹的 ID（不应该导入整个根文件夹）
                const rootFolderIds = ['0', '1', '2']; // 0=root, 1=Bookmarks Bar, 2=Other Bookmarks
                const isRootFolder = rootFolderIds.includes(parentId);

                // 获取父文件夹信息
                if (parentId) {
                    const parents = await browserAPI.bookmarks.get(parentId);
                    if (parents && parents[0] && !parents[0].url) {
                        const parentFolder = parents[0];
                        const folderTitle = parentFolder.title || '';

                        // 根级文件夹名称列表（不应该导入整个根文件夹）
                        const rootFolderNames = [
                            'Bookmarks Bar', '书签栏', 'Bookmark Bar',
                            'Other Bookmarks', '其他书签', 'Other bookmarks',
                            'Mobile Bookmarks', '移动设备书签', 'Mobile bookmarks',
                            'Bookmarks', '书签'
                        ];
                        const isRootFolder = rootFolderNames.some(name =>
                            folderTitle.toLowerCase() === name.toLowerCase()
                        );

                        console.log('[Canvas] 父文件夹:', folderTitle, 'ID:', parentId, '是根文件夹:', isRootFolder);

                        if (isRootFolder) {
                            // 书签直接位于根文件夹下，创建单个书签
                            console.log('[Canvas] 书签位于根文件夹下，直接创建单个书签');
                        } else {
                            // 获取父文件夹内的直接子项数量
                            const children = await browserAPI.bookmarks.getChildren(parentId);
                            const directChildCount = children ? children.length : 0;

                            console.log('[Canvas] 普通文件夹，直接子项数量:', directChildCount);

                            // 如果父文件夹有多个子项，说明用户拖动的是文件夹，自动导入整个文件夹
                            if (directChildCount > 1) {
                                console.log('[Canvas] 检测到不完整的文件夹拖拽，自动导入整个文件夹');
                                await createTempNodeFromBookmarkFolder(parentFolder, dropX, dropY);
                                return;
                            }
                            // 父文件夹只有一个书签，直接创建单个书签
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[Canvas] 查找书签失败:', error);
        }
    }

    // 如果无法找到父文件夹，或父文件夹只有一个书签，直接创建单个书签的临时栏目
    await createTempNodeFromBrowserBookmark({
        title: title || url,
        url: url,
        type: 'bookmark'
    }, dropX, dropY);
}

function __escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 显示导入选择对话框：让用户选择导入单个书签还是整个文件夹
 */
async function showImportChoiceDialog(bookmark, parentFolder, dropX, dropY) {
    const { isEn } = __getLang();

    // 移除已有的对话框
    const existingDialog = document.getElementById('importChoiceDialog');
    if (existingDialog) existingDialog.remove();

    // 获取文件夹内的书签数量
    let folderBookmarkCount = 0;
    try {
        const subTree = await browserAPI.bookmarks.getSubTree(parentFolder.id);
        if (subTree && subTree[0]) {
            const countBookmarks = (node) => {
                let count = 0;
                if (node.url) count = 1;
                if (node.children) {
                    for (const child of node.children) {
                        count += countBookmarks(child);
                    }
                }
                return count;
            };
            folderBookmarkCount = countBookmarks(subTree[0]);
        }
    } catch (e) { }

    const bookmarkTitleEsc = __escapeHtml(bookmark && (bookmark.title || bookmark.url));
    const parentFolderTitleEsc = __escapeHtml(parentFolder && parentFolder.title);

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.id = 'importChoiceDialog';
    dialog.className = 'import-dialog';
    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 420px;">
            <div class="import-dialog-header">
                <h3>${isEn ? 'Import Options' : '导入选项'}</h3>
                <button class="import-dialog-close">&times;</button>
            </div>
            <div class="import-dialog-body">
                <p style="margin-bottom: 16px; color: var(--text-secondary);">
                    ${isEn
            ? `This bookmark is in folder "${parentFolderTitleEsc}". What would you like to import?`
            : `此书签位于文件夹「${parentFolderTitleEsc}」中，您要导入什么？`}
                </p>
                <div class="import-options">
                    <button class="import-option-btn" id="importSingleBtn">
                        <i class="fas fa-bookmark" style="color: var(--accent-primary);"></i>
                        <div style="flex: 1; text-align: left;">
                            <div style="font-weight: 600;">${isEn ? 'Single Bookmark' : '单个书签'}</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                ${bookmarkTitleEsc}
                            </div>
                        </div>
                    </button>
                    <button class="import-option-btn" id="importFolderBtn">
                        <i class="fas fa-folder" style="color: var(--warning);"></i>
                        <div style="flex: 1; text-align: left;">
                            <div style="font-weight: 600;">${isEn ? 'Entire Folder' : '整个文件夹'}</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                ${parentFolderTitleEsc} (${folderBookmarkCount} ${isEn ? 'bookmarks' : '个书签'})
                            </div>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    dialog.querySelector('.import-dialog-close').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };

    dialog.querySelector('#importSingleBtn').onclick = async () => {
        dialog.remove();
        await createTempNodeFromBrowserBookmark({
            title: bookmark.title || bookmark.url,
            url: bookmark.url,
            type: 'bookmark'
        }, dropX, dropY);
    };

    dialog.querySelector('#importFolderBtn').onclick = async () => {
        dialog.remove();
        await createTempNodeFromBookmarkFolder(parentFolder, dropX, dropY);
    };
}

/**
 * 获取书签的祖先路径（从根到当前节点的 ID 列表）
 */
async function getBookmarkAncestorPath(bookmarkId) {
    const path = [];
    let currentId = bookmarkId;

    try {
        while (currentId && currentId !== '0') {
            path.unshift(currentId);
            const nodes = await browserAPI.bookmarks.get(currentId);
            if (nodes && nodes[0] && nodes[0].parentId) {
                currentId = nodes[0].parentId;
            } else {
                break;
            }
        }
    } catch (e) {
        console.warn('[Canvas] 获取书签祖先路径失败:', e);
    }

    return path;
}

/**
 * 找到多个路径的最近公共祖先
 * @param {Array<Array<string>>} paths - 多个祖先路径数组
 * @returns {string|null} - 最近公共祖先的 ID
 */
function findLowestCommonAncestor(paths) {
    if (!paths || paths.length === 0) return null;
    if (paths.length === 1) {
        // 单个路径，返回倒数第二个（父文件夹）
        return paths[0].length > 1 ? paths[0][paths[0].length - 2] : null;
    }

    // 找到最短路径长度
    const minLen = Math.min(...paths.map(p => p.length));

    // 从根开始，找最后一个共同的祖先
    let lcaIndex = -1;
    for (let i = 0; i < minLen; i++) {
        const id = paths[0][i];
        if (paths.every(p => p[i] === id)) {
            lcaIndex = i;
        } else {
            break;
        }
    }

    return lcaIndex >= 0 ? paths[0][lcaIndex] : null;
}

/**
 * 从多个 URL 创建临时栏目（文件夹拖拽）
 * 通过书签 API 搜索匹配的书签来获取原始标题和文件夹结构
 */
async function createTempNodeFromMultipleUrls(urls, dropX, dropY) {
    const { isEn } = __getLang();

    if (!urls || urls.length === 0) return;

    // 使用书签 API 搜索每个 URL 对应的书签
    let bookmarks = [];
    let commonParentId = null;
    let commonParentTitle = null;

    if (browserAPI && browserAPI.bookmarks) {
        try {
            // 获取每个 URL 对应的书签及其祖先路径
            const bookmarkInfos = [];

            for (const url of urls) {
                const results = await browserAPI.bookmarks.search({ url: url });
                if (results && results.length > 0) {
                    const bm = results[0];
                    // 获取这个书签的祖先路径
                    const ancestors = await getBookmarkAncestorPath(bm.id);
                    bookmarkInfos.push({
                        bookmark: bm,
                        ancestors: ancestors // 从根到当前的 ID 路径
                    });
                }
            }

            console.log('[Canvas] 书签信息:', bookmarkInfos.length, '个');

            // 如果成功获取了所有书签信息，找最近公共祖先
            if (bookmarkInfos.length === urls.length && bookmarkInfos.length > 0) {
                // 找到最近公共祖先（LCA）
                const lcaId = findLowestCommonAncestor(bookmarkInfos.map(info => info.ancestors));

                if (lcaId && lcaId !== '0' && lcaId !== '1' && lcaId !== '2') {
                    console.log('[Canvas] 找到最近公共祖先:', lcaId);
                    const folder = await browserAPI.bookmarks.get(lcaId);
                    if (folder && folder[0] && !folder[0].url) {
                        // 确认是文件夹，使用 createTempNodeFromBookmarkFolder
                        await createTempNodeFromBookmarkFolder(folder[0], dropX, dropY);
                        return; // 已完成，直接返回
                    }
                }
            }

            // 如果无法确定公共祖先，逐个收集书签信息
            for (const info of bookmarkInfos) {
                bookmarks.push({
                    title: info.bookmark.title || info.bookmark.url,
                    url: info.bookmark.url,
                    parentId: info.bookmark.parentId
                });
            }

            // 补充未找到的 URL
            if (bookmarks.length < urls.length) {
                for (const url of urls) {
                    if (!bookmarks.find(b => b.url === url)) {
                        bookmarks.push({ title: url, url: url, parentId: null });
                    }
                }
            }
        } catch (error) {
            console.warn('[Canvas] 搜索书签失败，使用 URL 作为标题:', error);
        }
    }

    // 如果书签 API 搜索失败或未启用，使用 URL 提取标题
    if (bookmarks.length === 0) {
        for (const url of urls) {
            let title = url;
            try {
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split('/').filter(p => p);
                if (pathParts.length > 0) {
                    title = decodeURIComponent(pathParts[pathParts.length - 1]) || urlObj.hostname;
                } else {
                    title = urlObj.hostname;
                }
            } catch (e) { }
            bookmarks.push({ title, url, parentId: null });
        }
    }

    // 创建临时栏目
    const sectionId = allocateTempSectionId();
    const items = [];

    for (const bm of bookmarks) {
        items.push({
            id: allocateTempItemId(sectionId),
            sectionId: sectionId,
            title: bm.title,
            url: bm.url,
            type: 'bookmark',
            children: [],
            createdAt: Date.now()
        });
    }

    // 使用默认标题格式
    const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;

    const section = {
        id: sectionId,
        title: getDefaultTempSectionTitle(),
        sequenceNumber: sequenceNumber,
        label: isEn ? 'Drop' : '拖入',  // 左边标签：拖入
        color: getSpecialTempSectionDefaultColor(),
        colorLocked: __getDefaultTempColorLockedState(),
        x: dropX,
        y: dropY,
        width: 0,
        height: 0,
        createdAt: Date.now(),
        source: 'browser-drop',  // 标记来源
        items: items
    };
    const specialBaseSize = getTempSectionBaseSize(section);
    section.width = specialBaseSize.width;
    section.height = specialBaseSize.height;

    CanvasState.tempSections.push(section);
    renderTempNode(section);
    applyTempSectionAutoSizeIfNeeded(section);

    // 设置更高的 z-index 和呼吸效果
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        nodeElement.style.zIndex = '500';
        pulseBreathingEffect(nodeElement, 1500);
    }

    saveTempNodes();

    const message = commonParentTitle
        ? (isEn ? `Imported folder "${commonParentTitle}" with ${items.length} bookmarks`
            : `已导入文件夹「${commonParentTitle}」，共 ${items.length} 个书签`)
        : (isEn ? `Created temporary section with ${items.length} bookmarks`
            : `已创建临时栏目，包含 ${items.length} 个书签`);
    showCanvasToast(message, 'success');
}

/**
 * 处理文件夹拖拽：通过标题匹配永久栏目中的文件夹
 */
async function handleBrowserBookmarkFolderDrop(folderTitle, dropX, dropY) {
    const { isEn } = __getLang();

    if (!browserAPI || !browserAPI.bookmarks) {
        showCanvasToast(isEn ? 'Bookmarks API not available' : '书签API不可用', 'error');
        return;
    }

    try {
        // 搜索匹配标题的书签节点
        const results = await browserAPI.bookmarks.search({ title: folderTitle });

        // 过滤出文件夹（没有 url 的节点是文件夹）
        const folders = results.filter(node => !node.url);

        if (folders.length === 0) {
            showCanvasToast(
                isEn ? `Folder "${folderTitle}" not found` : `未找到文件夹「${folderTitle}」`,
                'warning'
            );
            return;
        }

        if (folders.length === 1) {
            // 唯一匹配，直接获取内容并创建临时栏目
            await createTempNodeFromBookmarkFolder(folders[0], dropX, dropY);
        } else {
            // 多个匹配，让用户选择
            await showFolderSelectionDialog(folders, dropX, dropY);
        }
    } catch (error) {
        console.error('[Canvas] 搜索书签文件夹失败:', error);
        showCanvasToast(
            isEn ? 'Failed to search bookmark folder' : '搜索书签文件夹失败',
            'error'
        );
    }
}

/**
 * 从书签文件夹创建临时栏目
 */
async function createTempNodeFromBookmarkFolder(folder, dropX, dropY) {
    const { isEn } = __getLang();

    if (!browserAPI || !browserAPI.bookmarks) return;

    try {
        // 获取文件夹的完整子树
        const subTree = await browserAPI.bookmarks.getSubTree(folder.id);
        if (!subTree || !subTree[0]) {
            showCanvasToast(isEn ? 'Folder is empty' : '文件夹为空', 'warning');
            return;
        }

        const folderNode = subTree[0];
        const children = folderNode.children || [];

        if (children.length === 0) {
            showCanvasToast(isEn ? 'Folder is empty' : '文件夹为空', 'warning');
            return;
        }

        // 计算书签总数
        const countBookmarks = (nodes) => {
            let count = 0;
            for (const node of nodes) {
                if (node.url) count++;
                if (node.children) count += countBookmarks(node.children);
            }
            return count;
        };
        const totalCount = countBookmarks(children);

        // 创建临时栏目（使用默认标题格式）
        const sectionId = allocateTempSectionId();
        const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;
        const section = {
            id: sectionId,
            title: getDefaultTempSectionTitle(),
            sequenceNumber: sequenceNumber,
            label: isEn ? 'Drop' : '拖入',  // 左边标签：拖入
            color: getSpecialTempSectionDefaultColor(),
            colorLocked: __getDefaultTempColorLockedState(),
            x: dropX,
            y: dropY,
            width: 0,
            height: 0,
            createdAt: Date.now(),
            source: 'browser-drop',  // 标记来源
            items: []
        };
        const specialBaseSize = getTempSectionBaseSize(section);
        section.width = specialBaseSize.width;
        section.height = specialBaseSize.height;

        // 递归转换为临时栏目格式
        const convertToTempItem = (node) => {
            const item = {
                id: allocateTempItemId(sectionId),
                sectionId: sectionId,
                title: node.title || (node.url ? (isEn ? 'Untitled' : '未命名') : (isEn ? 'Folder' : '文件夹')),
                url: node.url || '',
                type: node.url ? 'bookmark' : 'folder',
                children: [],
                createdAt: Date.now()
            };

            if (node.children && Array.isArray(node.children)) {
                item.children = node.children.map(convertToTempItem).filter(Boolean);
            }

            return item;
        };

        // 将整个文件夹作为一个顶层项放入临时栏目（保留完整层次结构）
        const folderItem = convertToTempItem(folderNode);
        section.items = [folderItem];

        // 调试：打印创建的数据结构
        console.log('[Canvas] 创建的临时栏目数据结构:', JSON.stringify(section, null, 2).substring(0, 2000));
        console.log('[Canvas] 顶层项类型:', folderItem.type, '子项数量:', folderItem.children?.length);

        CanvasState.tempSections.push(section);
        renderTempNode(section);
        applyTempSectionAutoSizeIfNeeded(section);

        // 设置更高的 z-index
        const nodeElement = document.getElementById(section.id);
        if (nodeElement) {
            nodeElement.style.zIndex = '500';
            pulseBreathingEffect(nodeElement, 1500);
        }

        saveTempNodes();

        showCanvasToast(
            isEn ? `Imported folder "${folderNode.title}" with ${totalCount} bookmarks`
                : `已导入文件夹「${folderNode.title}」，共 ${totalCount} 个书签`,
            'success'
        );
    } catch (error) {
        console.error('[Canvas] 创建临时栏目失败:', error);
        showCanvasToast(isEn ? 'Failed to import folder' : '导入文件夹失败', 'error');
    }
}

/**
 * 从单个书签创建临时栏目
 */
async function createTempNodeFromBrowserBookmark(bookmark, dropX, dropY) {
    const { isEn } = __getLang();

    // 获取书签的路径
    let sourcePath = '';
    if (browserAPI && browserAPI.bookmarks && bookmark.url) {
        try {
            const results = await browserAPI.bookmarks.search({ url: bookmark.url });
            if (results && results.length > 0 && results[0].parentId) {
                sourcePath = await getBookmarkPathString(results[0].parentId);
            }
        } catch (e) { }
    }

    // 生成标题：时间 + 书签数量 + 来源说明
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    const sourceInfo = isEn
        ? `${dateStr} ${timeStr} | 1 bookmark | Browser drop`
        : `${dateStr} ${timeStr} | 1个书签 | 浏览器拖入`;

    // 生成说明：书签路径
    const description = sourcePath
        ? (isEn ? `Source: ${sourcePath}` : `来源路径：${sourcePath}`)
        : '';

    const sectionId = allocateTempSectionId();
    const section = {
        id: sectionId,
        title: sourceInfo,
        descriptionMd: __normalizeCanvasMarkdownSource(description),  // 添加说明
        label: isEn ? 'Drop' : '拖入',  // 左边标签：拖入
        color: getSpecialTempSectionDefaultColor(),
        colorLocked: __getDefaultTempColorLockedState(),
        x: dropX,
        y: dropY,
        width: 0,
        height: 0,
        createdAt: Date.now(),
        source: 'browser-drop',  // 标记来源
        items: [{
            id: allocateTempItemId(sectionId),
            sectionId: sectionId,
            title: bookmark.title || bookmark.url,
            url: bookmark.url || '',
            type: 'bookmark',
            children: [],
            createdAt: Date.now()
        }]
    };
    const baseSize = getTempSectionBaseSize(section);
    section.width = baseSize.width;
    section.height = baseSize.height;

    CanvasState.tempSections.push(section);
    renderTempNode(section);
    applyTempSectionAutoSizeIfNeeded(section);

    // 设置更高的 z-index
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        nodeElement.style.zIndex = '500';
        pulseBreathingEffect(nodeElement, 1500);
    }

    saveTempNodes();

    showCanvasToast(
        isEn ? 'Created temporary section with 1 bookmark' : '已创建临时栏目，包含 1 个书签',
        'success'
    );
}

/**
 * 显示文件夹选择对话框（当有多个同名文件夹时）
 */
async function showFolderSelectionDialog(folders, dropX, dropY) {
    const { isEn } = __getLang();

    // 移除已有的对话框
    const existingDialog = document.getElementById('folderSelectionDialog');
    if (existingDialog) existingDialog.remove();

    // 获取每个文件夹的路径信息
    const foldersWithPath = await Promise.all(folders.map(async (folder) => {
        let path = folder.title;
        try {
            // 获取父文件夹路径
            let current = folder;
            const pathParts = [folder.title];
            while (current.parentId && current.parentId !== '0') {
                const parents = await browserAPI.bookmarks.get(current.parentId);
                if (parents && parents[0]) {
                    pathParts.unshift(parents[0].title || '');
                    current = parents[0];
                } else {
                    break;
                }
            }
            path = pathParts.filter(p => p).join(' / ');
        } catch (e) {
            console.warn('[Canvas] 获取文件夹路径失败:', e);
        }
        return { ...folder, path };
    }));

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.id = 'folderSelectionDialog';
    dialog.className = 'import-dialog';
    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 500px;">
            <div class="import-dialog-header">
                <h3>${isEn ? 'Multiple folders found' : '找到多个同名文件夹'}</h3>
                <button class="import-dialog-close">&times;</button>
            </div>
            <div class="import-dialog-body">
                <p style="margin-bottom: 16px; color: var(--text-secondary);">
                    ${isEn ? 'Please select the folder you want to import:' : '请选择要导入的文件夹：'}
                </p>
                <div class="import-options">
                    ${foldersWithPath.map((folder, index) => `
                        <button class="import-option-btn folder-select-btn" data-index="${index}">
                            <i class="fas fa-folder" style="color: var(--warning);"></i>
                            <div style="flex: 1; text-align: left;">
                                <div style="font-weight: 600;">${__escapeHtml(folder.title)}</div>
                                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                    ${__escapeHtml(folder.path)}
                                </div>
                            </div>
                        </button>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    dialog.querySelector('.import-dialog-close').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };

    dialog.querySelectorAll('.folder-select-btn').forEach(btn => {
        btn.onclick = async () => {
            const index = parseInt(btn.dataset.index, 10);
            const selectedFolder = folders[index];
            dialog.remove();
            await createTempNodeFromBookmarkFolder(selectedFolder, dropX, dropY);
        };
    });
}

// =============================================================================
// Backup dialog (single-slot backup; auto-saved before export; manual + restore).
// =============================================================================

async function showBackupDialog() {
    const isEn = (typeof currentLang !== 'undefined' && currentLang === 'en');
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (!bridge) {
        alert(isEn ? 'Storage bridge unavailable.' : '存储桥不可用。');
        return;
    }

    const existing = await bridge.readBackupSlot();
    const savedAt = existing && existing.savedAt ? new Date(existing.savedAt) : null;
    const savedLabel = savedAt ? savedAt.toLocaleString(isEn ? 'en-US' : 'zh-CN') : (isEn ? 'No backup yet' : '暂无备份');

    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog';
        dialog.id = 'canvasBackupDialog';
        dialog.innerHTML = `
            <div class="import-dialog-content">
                <div class="import-dialog-header">
                    <h3>${isEn ? 'Backup' : '备份'}</h3>
                    <button class="import-dialog-close" id="closeBackupDialog">&times;</button>
                </div>
                <div class="import-dialog-body" style="padding: 16px;">
                    <p style="margin: 0 0 8px;">${isEn ? 'Single-slot backup. Last save:' : '单槽备份。上次保存：'}</p>
                    <p style="margin: 0 0 16px; font-weight: 600;">${savedLabel}</p>
                    <p style="font-size: 12px; opacity: 0.7; margin: 0 0 12px;">
                        ${isEn
                            ? 'Each export auto-saves here. Manual save overwrites the slot. Restore replays the slot as an overwrite-import (current data lost).'
                            : '每次导出自动保存。手动保存会覆盖此槽。恢复将把此槽以「覆盖导入」回放（当前数据丢失）。'}
                    </p>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="import-mode-btn import-mode-btn-confirm" id="backupManualBtn">${isEn ? 'Manual Backup' : '手动备份'}</button>
                        <button type="button" class="import-mode-btn import-mode-btn-confirm" id="backupRestoreBtn" ${existing ? '' : 'disabled'}>${isEn ? 'Restore' : '恢复'}</button>
                        <button type="button" class="import-mode-btn import-mode-btn-cancel" id="backupCloseBtn">${isEn ? 'Close' : '关闭'}</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        const cleanup = () => { try { dialog.remove(); } catch (_) {} resolve(); };
        document.getElementById('closeBackupDialog').addEventListener('click', cleanup);
        document.getElementById('backupCloseBtn').addEventListener('click', cleanup);
        document.getElementById('backupManualBtn').addEventListener('click', async () => {
            try {
                const sandbox = await bridge.buildExportSandbox({ reason: 'manual-backup' });
                if (sandbox) {
                    bridge.processExportSandboxForExport(sandbox);
                    await bridge.writeBackupSlotFromSandbox(sandbox);
                }
                const msg = isEn ? 'Manual backup saved.' : '手动备份已保存。';
                try { (typeof showCanvasToast === 'function') ? showCanvasToast(msg, 'success', 3000) : alert(msg); } catch (_) { alert(msg); }
            } catch (e) {
                console.error('[Backup] manual save failed:', e);
                alert(isEn ? `Backup failed: ${e.message}` : `备份失败：${e.message}`);
            }
            cleanup();
        });
        document.getElementById('backupRestoreBtn').addEventListener('click', async () => {
            const confirmMsg = isEn
                ? 'Restore backup will overwrite current local data with the backup snapshot. Continue?'
                : '恢复备份将以备份快照覆盖当前本地数据。继续吗？';
            if (!window.confirm(confirmMsg)) return;
            try {
                const slot = await bridge.readBackupSlot();
                if (!slot || !slot.sandbox) {
                    alert(isEn ? 'No backup found.' : '未找到备份。');
                    cleanup();
                    return;
                }
                const sandbox = slot.sandbox;
                const parsedStorage = {};
                if (sandbox.permMain) parsedStorage['bcs:perm:main'] = sandbox.permMain;
                if (sandbox.canvasState) parsedStorage['bcs:canvas'] = sandbox.canvasState;
                if (sandbox.permCopies && typeof sandbox.permCopies === 'object') {
                    for (const k of Object.keys(sandbox.permCopies)) parsedStorage[k] = sandbox.permCopies[k];
                }
                await __performOverwriteImport({
                    parsedTempState: sandbox.tempState,
                    parsedStorage,
                    parsedPrimaryState: null,
                    importFileName: 'backup-slot',
                    threshold: 0 // force overwrite branch
                });
            } catch (e) {
                console.error('[Backup] restore failed:', e);
                alert(isEn ? `Restore failed: ${e.message}` : `恢复失败：${e.message}`);
            }
            cleanup();
        });
    });
}



// ---- toolbar-import-export-bindings: source lines 28699-28720 ----

    // 工具栏按钮
    const importBtn = document.getElementById('importCanvasBtn');
    const exportBtn = document.getElementById('exportCanvasBtn');
    const importOtherBtn = document.getElementById('importCanvasOtherBtn');
    const exportOtherBtn = document.getElementById('exportCanvasOtherBtn');
    const backupBtn = document.getElementById('backupCanvasBtn');
    const backupOtherBtn = document.getElementById('backupCanvasOtherBtn');

    if (importBtn) importBtn.addEventListener('click', showImportDialog);
    if (exportBtn) exportBtn.addEventListener('click', exportCanvas);
    if (backupBtn) backupBtn.addEventListener('click', () => { try { showBackupDialog(); } catch (e) { console.warn(e); } });
    if (importOtherBtn) {
        importOtherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try { document.getElementById('canvasOtherManageModal').style.display = 'none'; } catch (_) { }
            showImportDialog();
        });
    }
    if (exportOtherBtn) {
        exportOtherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try { document.getElementById('canvasOtherManageModal').style.display = 'none'; } catch (_) { }
            exportCanvas();
        });
    }
    if (backupOtherBtn) {
        backupOtherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try { document.getElementById('canvasOtherManageModal').style.display = 'none'; } catch (_) { }
            try { showBackupDialog(); } catch (err) { console.warn(err); }
        });
    }



// ---- import-group-drag-edge-helpers: source lines 13765-13953 ----

function __initImportGroupDragEdgeFollow(meta, containerSection) {
    if (!meta || meta.importGroupEdgeFollowInit) return;
    meta.importGroupEdgeFollowInit = true;

    const movedIds = new Set();
    const movedRects = new Map();

    if (containerSection && containerSection.id) {
        movedIds.add(containerSection.id);
        const containerEl = document.getElementById(containerSection.id);
        const domW = containerEl ? (containerEl.offsetWidth || 0) : 0;
        const domH = containerEl ? (containerEl.offsetHeight || 0) : 0;
        movedRects.set(containerSection.id, {
            x: Number(containerSection.x) || 0,
            y: Number(containerSection.y) || 0,
            width: domW || (Number(containerSection.width) || 0),
            height: domH || (Number(containerSection.height) || 0)
        });
    }

    const children = Array.isArray(CanvasState.dragState.childElements) ? CanvasState.dragState.childElements : [];
    children.forEach((child) => {
        if (!child || !child.data || !child.data.id) return;
        const id = child.data.id;
        movedIds.add(id);

        const isTemp = child.type === 'temp-section';
        const childEl = child.element || null;
        const domW = childEl ? (childEl.offsetWidth || 0) : 0;
        const domH = childEl ? (childEl.offsetHeight || 0) : 0;
        const width = domW || Number(child.data.width) || (isTemp ? 360 : 120);
        const height = domH || Number(child.data.height) || (isTemp ? 280 : 60);
        const baseX = (typeof child.startX === 'number') ? child.startX : (Number(child.data.x) || 0);
        const baseY = (typeof child.startY === 'number') ? child.startY : (Number(child.data.y) || 0);

        movedRects.set(id, {
            x: baseX,
            y: baseY,
            width,
            height
        });
    });

    meta.importGroupMovedIds = movedIds;
    meta.importGroupMovedRects = movedRects;

    const allEdges = Array.isArray(CanvasState.edges) ? CanvasState.edges : [];
    meta.importGroupAffectedEdges = allEdges.length
        ? allEdges.filter(e => e && e.id && (movedIds.has(e.fromNode) || movedIds.has(e.toNode)))
        : [];

    const svg = document.querySelector('.canvas-edges');
    if (!svg) {
        meta.importGroupEdgeDomMap = null;
        return;
    }

    const domMap = new Map();
    const els = svg.querySelectorAll('.canvas-edge, .canvas-edge-hit-area, .canvas-edge-label, .canvas-edge-label-bg, foreignObject.edge-label-fo');
    els.forEach((el) => {
        const edgeId = (el && el.dataset && el.dataset.edgeId) ? el.dataset.edgeId : (el ? el.getAttribute('data-edge-id') : null);
        if (!edgeId) return;

        let entry = domMap.get(edgeId);
        if (!entry) {
            entry = { path: null, hitArea: null, label: null, labelBg: null, labelFo: null };
            domMap.set(edgeId, entry);
        }

        if (el.classList && el.classList.contains('canvas-edge-hit-area')) {
            entry.hitArea = el;
        } else if (el.classList && el.classList.contains('canvas-edge')) {
            entry.path = el;
        } else if (el.classList && el.classList.contains('canvas-edge-label-bg')) {
            entry.labelBg = el;
        } else if (el.classList && el.classList.contains('edge-label-fo')) {
            entry.labelFo = el;
        } else if (el.classList && el.classList.contains('canvas-edge-label')) {
            entry.label = el;
        }
    });
    meta.importGroupEdgeDomMap = domMap;
}

function __getEdgeCurveMidpointFromAnchors(edge, start, end) {
    if (!edge || !start || !end) return null;
    const x1 = start.x, y1 = start.y;
    const x2 = end.x, y2 = end.y;
    const { cp1x, cp1y, cp2x, cp2y } = computeEdgeControlPoints(x1, y1, x2, y2, edge.fromSide, edge.toSide);
    const midX = (x1 + 3 * cp1x + 3 * cp2x + x2) / 8;
    const midY = (y1 + 3 * cp1y + 3 * cp2y + y2) / 8;
    return { x: midX, y: midY };
}

function __getAnchorPositionForImportGroupDrag(meta, nodeId, side) {
    if (!meta || !nodeId) return getAnchorPosition(nodeId, side);
    if (meta.importGroupMovedIds && meta.importGroupMovedIds.has && meta.importGroupMovedIds.has(nodeId)) {
        const rect = meta.importGroupMovedRects && meta.importGroupMovedRects.get ? meta.importGroupMovedRects.get(nodeId) : null;
        if (rect) {
            const dx = (typeof meta.importGroupDx === 'number' && isFinite(meta.importGroupDx)) ? meta.importGroupDx : 0;
            const dy = (typeof meta.importGroupDy === 'number' && isFinite(meta.importGroupDy)) ? meta.importGroupDy : 0;
            const left = (Number(rect.x) || 0) + dx;
            const top = (Number(rect.y) || 0) + dy;
            const width = Number(rect.width) || 0;
            const height = Number(rect.height) || 0;
            switch (side) {
                case 'top': return { x: left + width / 2, y: top };
                case 'bottom': return { x: left + width / 2, y: top + height };
                case 'left': return { x: left, y: top + height / 2 };
                case 'right': return { x: left + width, y: top + height / 2 };
                default: return { x: left + width / 2, y: top + height / 2 };
            }
        }
    }
    return getAnchorPosition(nodeId, side);
}

function __updateImportGroupDragEdges(meta) {
    if (!meta || !meta.importGroupDrag) return;

    const edges = Array.isArray(meta.importGroupAffectedEdges) ? meta.importGroupAffectedEdges : [];
    if (!edges.length) {
        try { updateEdgeToolbarPosition(); } catch (_) { }
        return;
    }

    const domMap = meta.importGroupEdgeDomMap;
    if (!domMap || !domMap.get) {
        try { updateEdgeToolbarPosition(); } catch (_) { }
        return;
    }

    edges.forEach((edge) => {
        if (!edge || !edge.id) return;
        const dom = domMap.get(edge.id);
        if (!dom) return;

        const start = __getAnchorPositionForImportGroupDrag(meta, edge.fromNode, edge.fromSide);
        const end = __getAnchorPositionForImportGroupDrag(meta, edge.toNode, edge.toSide);
        const d = (start && end) ? getEdgePathD(start.x, start.y, end.x, end.y, edge.fromSide, edge.toSide) : '';

        if (dom.hitArea) {
            try { dom.hitArea.setAttribute('d', d); } catch (_) { }
        }
        if (dom.path) {
            try { dom.path.setAttribute('d', d); } catch (_) { }
        }

        // 标签/编辑器跟随（不重建，只更新坐标）
        if (!dom.label && !dom.labelBg && !dom.labelFo) return;
        if (!start || !end) return;
        const mid = __getEdgeCurveMidpointFromAnchors(edge, start, end);
        if (!mid) return;

        if (dom.label) {
            try {
                dom.label.setAttribute('x', mid.x);
                dom.label.setAttribute('y', mid.y);
            } catch (_) { }
        }
        if (dom.labelBg) {
            try {
                const w = parseFloat(dom.labelBg.getAttribute('width')) || 0;
                const h = parseFloat(dom.labelBg.getAttribute('height')) || 0;
                dom.labelBg.setAttribute('x', (mid.x - w / 2).toString());
                dom.labelBg.setAttribute('y', (mid.y - h / 2).toString());
            } catch (_) { }
        }
        if (dom.labelFo) {
            try {
                const w = parseFloat(dom.labelFo.getAttribute('width')) || 0;
                const h = parseFloat(dom.labelFo.getAttribute('height')) || 0;
                dom.labelFo.setAttribute('x', (mid.x - w / 2).toString());
                dom.labelFo.setAttribute('y', (mid.y - h / 2).toString());
            } catch (_) { }
        }
    });

    try { updateEdgeToolbarPosition(); } catch (_) { }
}

function __scheduleImportGroupDragEdgeUpdate(meta) {
    if (!meta || !meta.importGroupDrag) return;
    if (meta.importGroupEdgeRaf) return;
    meta.importGroupEdgeRaf = requestAnimationFrame(() => {
        meta.importGroupEdgeRaf = 0;
        try { __updateImportGroupDragEdges(meta); } catch (_) { }
    });
}
