/*
 * Bookmark-Canvas import/export feature layer
 *
 * This file contains manual import/export UI, file-entry handlers, and package
 * assembly/parsing endpoints. Shared BCS storage, protocol, JSON compatibility,
 * and markdown/html conversion helpers remain in storageBCS/storageBCS_core.js
 * so AI, sync, and import/export can use the same data core.
 */

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

function __saveTransferImportSectionsDelta(sectionInputs, options = {}) {
    const sections = (Array.isArray(sectionInputs) ? sectionInputs : [sectionInputs])
        .filter((section) => section && typeof section === 'object' && section.id);
    if (!sections.length) return;
    try {
        if (typeof saveCanvasSectionDelta === 'function') {
            saveCanvasSectionDelta({ upsertSections: sections }, options);
            return;
        }
    } catch (_) { }
    try { if (typeof saveTempNodes === 'function') saveTempNodes(options); } catch (_) { }
}

function __trimImportPreviewText(value, max = 52) {
    const text = String(value || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function __extractImportPreviewTextFromHtml(html) {
    const raw = String(html || '').trim();
    if (!raw) return '';
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = raw;
        const txt = String(tmp.textContent || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n').trim();
        if (!txt) return '';
        const lines = txt.split(/\n+/).map((line) => String(line || '').trim()).filter(Boolean);
        return lines.length ? lines[0] : txt;
    } catch (_) {
        return '';
    }
}

function __resolveImportPreviewMdTitle(node, index, isEn) {
    if (!node || typeof node !== 'object') {
        return isEn ? `Blank node ${index + 1}` : `空白栏目 ${index + 1}`;
    }

    const readable = __resolveMdNodeReadableText(node);
    const lines = readable.replace(/\r\n?/g, '\n').split(/\n+/).map((line) => String(line || '').trim()).filter(Boolean);
    let base = lines.length ? lines[0] : readable;

    base = __trimImportPreviewText(base);
    if (base) return base;
    return isEn ? `Blank node ${index + 1}` : `空白栏目 ${index + 1}`;
}

function __resolveImportPreviewNativeCardTitle(node, index, isEn) {
    if (!node || typeof node !== 'object') {
        return isEn ? `Native card ${index + 1}` : `原生卡片 ${index + 1}`;
    }

    let base = '';
    if (typeof node.text === 'string' && node.text.trim()) {
        const lines = node.text.replace(/\u200B/g, '').replace(/\r\n?/g, '\n').split(/\n+/).map((line) => String(line || '').trim()).filter(Boolean);
        base = lines.length ? lines[0] : node.text;
    }

    if (!base && typeof node.html === 'string' && node.html.trim()) {
        base = __extractImportPreviewTextFromHtml(node.html);
    }

    base = __trimImportPreviewText(base);
    if (base) return base;
    return isEn ? `Native card ${index + 1}` : `原生卡片 ${index + 1}`;
}

function __resolveImportPreviewSectionTitle(section, index, isEn) {
    const title = __trimImportPreviewText(section && section.title ? section.title : '');
    if (title) return title;
    return isEn ? `Section ${index + 1}` : `栏目 ${index + 1}`;
}

function __resolveImportPreviewSnapshotBadge(section, fallbackIndex = 1) {
    if (section && typeof section === 'object') {
        const presetBadge = String(section.previewBadge || '').trim();
        if (presetBadge) return presetBadge;

        const title = String(section.title || '');
        const badgeMatch = title.match(/\(#\s*([A-Za-z]+)\s*\)/);
        if (badgeMatch && badgeMatch[1]) {
            return `#${String(badgeMatch[1]).toUpperCase()}`;
        }
    }

    const idx = Number.isFinite(Number(fallbackIndex)) ? Number(fallbackIndex) : 1;
    const alpha = toAlphaLabel(Math.max(1, idx));
    return alpha ? `#${alpha}` : '';
}

function __collectImportedPermanentLayoutFromStorage(fullStorage) {
    const result = { main: null, copies: [] };
    if (!fullStorage || typeof fullStorage !== 'object') return result;

    const copyDisplayIndexById = new Map();
    try {
        const rawCopies = fullStorage[PERMANENT_SECTION_COPIES_STORAGE_KEY];
        const copies = Array.isArray(rawCopies) ? rawCopies : [];
        copies.forEach((copy, idx) => {
            if (!copy || typeof copy !== 'object') return;
            const copyId = String(copy.id || '').trim() || `copy-${idx + 1}`;
            const displayIndex = __normalizePositiveInt(copy.displayIndex);
            if (displayIndex) copyDisplayIndexById.set(copyId, displayIndex);
        });
    } catch (_) { }

    const canvasLayout = (() => {
        try {
            const canvasRaw = fullStorage[BCS_CANVAS_KEY];
            const canvas = __readBcsCanvasPayload(canvasRaw);
            return __extractPermanentLayoutFromCanvasNodes(
                Array.isArray(canvas && canvas.nodes) ? canvas.nodes : []
            );
        } catch (_) {
            return { main: null, copiesById: {} };
        }
    })();

    const mainCardState = __normalizePermanentViewCardState(canvasLayout && canvasLayout.main);
    result.main = Object.keys(mainCardState).length ? mainCardState : null;

    const copyIds = new Set(
        Object.keys((canvasLayout && canvasLayout.copiesById) || {}).filter(Boolean).map((id) => String(id))
    );
    try {
        Array.from(copyIds).forEach((copyId, idx) => {
            if (!copyDisplayIndexById.has(copyId)) {
                copyDisplayIndexById.set(copyId, idx + 1);
            }
        });
    } catch (_) { }

    const usedDisplayIndexes = new Set();
    copyDisplayIndexById.forEach((value) => {
        if (value) usedDisplayIndexes.add(value);
    });
    let autoDisplayIndex = 1;
    const getNextDisplayIndex = () => {
        while (usedDisplayIndexes.has(autoDisplayIndex)) autoDisplayIndex += 1;
        const next = autoDisplayIndex;
        usedDisplayIndexes.add(next);
        autoDisplayIndex += 1;
        return next;
    };

    const sortedCopyIds = Array.from(copyIds.values())
        .filter(Boolean)
        .sort((a, b) => {
            const idxA = copyDisplayIndexById.get(a) || 0;
            const idxB = copyDisplayIndexById.get(b) || 0;
            if (idxA && idxB && idxA !== idxB) return idxA - idxB;
            if (idxA && !idxB) return -1;
            if (!idxA && idxB) return 1;
            return String(a).localeCompare(String(b));
        });

    sortedCopyIds.forEach((copyId) => {
        const displayIndex = copyDisplayIndexById.get(copyId) || getNextDisplayIndex();
        const cardState = __normalizePermanentViewCardState(
            canvasLayout && canvasLayout.copiesById && canvasLayout.copiesById[copyId]
        );
        result.copies.push({
            id: copyId,
            displayIndex,
            cardState
        });
    });

    return result;
}

function __buildImportPreviewSyntheticPermanentSections(fullStorage, isEn) {
    const importedPermanentLayout = __collectImportedPermanentLayoutFromStorage(fullStorage);
    const hasMain = !!(importedPermanentLayout && importedPermanentLayout.main);
    const copies = importedPermanentLayout && Array.isArray(importedPermanentLayout.copies)
        ? importedPermanentLayout.copies
        : [];
    if (!hasMain && !copies.length) return [];

    const snapshotSections = [];
    const baseTitle = isEn ? '[Snapshot] Permanent Sections' : '[快照] 永久栏目';
    const defaultColor = getPermanentSectionDefaultColor();

    if (hasMain) {
        snapshotSections.push({
            id: 'preview-permanent-section-original',
            title: `${baseTitle} (#A)`,
            isSnapshot: true,
            color: defaultColor,
            previewBadge: '#A'
        });
    }

    copies.forEach((copyPos, idx) => {
        const displayIndex = __normalizePositiveInt(copyPos && copyPos.displayIndex) || (idx + 1);
        const badge = `#${toAlphaLabel(displayIndex + 1)}`;
        snapshotSections.push({
            id: `preview-permanent-section-copy-${displayIndex}`,
            title: `${baseTitle} (${badge})`,
            isSnapshot: true,
            color: defaultColor,
            previewBadge: badge
        });
    });

    return snapshotSections;
}

function __normalizeImportPreviewColorHex(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const normalized = value.startsWith('#') ? value : `#${value}`;
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : '';
}

function __convertPreviewTempStateToDirectoryState(tempState) {
    const src = tempState && typeof tempState === 'object' ? tempState : {};
    return {
        tempSections: Array.isArray(src.sections) ? src.sections.map((section) => ({ ...section })) : [],
        mdNodes: Array.isArray(src.mdNodes) ? src.mdNodes.map((node) => ({ ...node })) : [],
        edges: Array.isArray(src.edges) ? src.edges.map((edge) => ({ ...edge })) : []
    };
}

function __resolveImportPreviewSectionColor(section, fallbackColor = '') {
    if (!section || typeof section !== 'object') {
        return __normalizeImportPreviewColorHex(fallbackColor);
    }

    let color = __normalizeImportPreviewColorHex(section.colorHex || '');
    if (!color && typeof section.color === 'string') {
        color = __normalizeImportPreviewColorHex(section.color);
    }
    if (!color && typeof presetToHex === 'function') {
        try { color = __normalizeImportPreviewColorHex(presetToHex(section.color)); } catch (_) { }
    }
    if (!color) {
        color = __normalizeImportPreviewColorHex(fallbackColor);
    }
    return color;
}

function __resolveImportPreviewMdNodeColor(node, fallbackColor = '') {
    if (!node || typeof node !== 'object') {
        return __normalizeImportPreviewColorHex(fallbackColor);
    }

    let color = __normalizeImportPreviewColorHex(node.colorHex || '');
    if (!color && typeof node.color === 'string') {
        color = __normalizeImportPreviewColorHex(node.color);
    }
    if (!color && typeof presetToHex === 'function') {
        try { color = __normalizeImportPreviewColorHex(presetToHex(node.color)); } catch (_) { }
    }
    if (!color) {
        color = __normalizeImportPreviewColorHex(fallbackColor);
    }
    return color;
}

function __resolveImportPreviewEdgeColor(edge, fallbackColor = '') {
    if (!edge || typeof edge !== 'object') {
        return __normalizeImportPreviewColorHex(fallbackColor);
    }
    let color = __normalizeImportPreviewColorHex(edge.colorHex || '');
    if (!color && typeof edge.color === 'string') {
        color = __normalizeImportPreviewColorHex(edge.color);
    }
    if (!color && typeof presetToHex === 'function') {
        try { color = __normalizeImportPreviewColorHex(presetToHex(edge.color)); } catch (_) { }
    }
    if (!color) color = __normalizeImportPreviewColorHex(fallbackColor);
    return color;
}

function __buildImportPreviewDataFromTempState(tempState, options = {}) {
    const { isEn } = __getLang();
    const sourceLabel = String((options && options.sourceLabel) || '').trim();
    const fullStorage = (options && options.fullStorage && typeof options.fullStorage === 'object') ? options.fullStorage : null;

    const sections = (tempState && Array.isArray(tempState.sections)) ? tempState.sections : [];
    const mdNodes = (tempState && Array.isArray(tempState.mdNodes)) ? tempState.mdNodes : [];
    const edges = (tempState && Array.isArray(tempState.edges)) ? tempState.edges : [];

    const groupNodes = mdNodes.filter((node) => !!(node && node.subtype === 'card-group'));
    const hasSnapshotInTempState = sections.some((section) => !!(section && section.isSnapshot));
    const syntheticPermanentSections = hasSnapshotInTempState
        ? []
        : __buildImportPreviewSyntheticPermanentSections(fullStorage, isEn);

    const getRect = (node) => {
        if (!node) return null;
        const x = Number(node.x);
        const y = Number(node.y);
        const w = Number(node.width);
        const h = Number(node.height);
        if (![x, y, w, h].every(v => typeof v === 'number' && isFinite(v))) return null;
        return { x, y, w, h };
    };
    const isInsideGroup = (candidate, groupNode) => {
        const groupRect = getRect(groupNode);
        const candidateRect = getRect(candidate);
        if (!groupRect || !candidateRect || typeof __rectFullyInside !== 'function') return false;
        try {
            return __rectFullyInside(candidateRect, groupRect, 0);
        } catch (_) {
            return false;
        }
    };

    const buildGroup = (groupNode, index) => {
        let groupTitle = '';
        if (groupNode) {
            groupTitle = __trimImportPreviewText(String(groupNode.label || '').trim());
        }
        if (!groupTitle) {
            groupTitle = groupNode ? (isEn ? 'Card Group' : '卡片组') : (isEn ? 'Imported Content' : '导入内容');
        }

        let groupTempSections = [];
        let groupMdNodes = [];
        let nodeIdSet = new Set();

        if (groupNode) {
            groupTempSections = sections.filter((section) => isInsideGroup(section, groupNode));
            groupMdNodes = mdNodes.filter((node) => !!(
                node
                && node.id
                && node.id !== groupNode.id
                && node.subtype !== 'card-group'
                && isInsideGroup(node, groupNode)
            ));
            groupTempSections.forEach((section) => {
                if (section && section.id) nodeIdSet.add(String(section.id));
            });
            groupMdNodes.forEach((node) => {
                if (node && node.id) nodeIdSet.add(String(node.id));
            });

            if (!groupTempSections.length && !groupMdNodes.length && groupNodes.length === 1) {
                groupTempSections = sections.slice();
                groupMdNodes = mdNodes.filter((node) => !!(node && node.subtype !== 'card-group'));
                nodeIdSet = new Set();
                groupTempSections.forEach((section) => {
                    if (section && section.id) nodeIdSet.add(String(section.id));
                });
                groupMdNodes.forEach((node) => {
                    if (node && node.id) nodeIdSet.add(String(node.id));
                });
            }
        } else {
            groupTempSections = sections.slice();
            groupMdNodes = mdNodes.filter((node) => !!(node && node.subtype !== 'card-group'));
            groupTempSections.forEach((section) => {
                if (section && section.id) nodeIdSet.add(String(section.id));
            });
            groupMdNodes.forEach((node) => {
                if (node && node.id) nodeIdSet.add(String(node.id));
            });
        }

        if (index === 1 && syntheticPermanentSections.length) {
            groupTempSections = groupTempSections.concat(syntheticPermanentSections);
        }

        const permanentSections = groupTempSections.filter((section) => !!(section && section.isSnapshot));
        const temporarySections = groupTempSections.filter((section) => !(section && section.isSnapshot));
        const blankMdNodes = groupMdNodes.filter((node) => !__isCanvasNativeTextNode(node));
        const nativeCardNodes = groupMdNodes.filter((node) => __isCanvasNativeTextNode(node));
        const splitSections = temporarySections.filter((section) => !__isSpecialTempSection(section));
        const specialSections = temporarySections.filter((section) => __isSpecialTempSection(section));

        const edgeEntries = edges
            .filter((edge) => {
                if (!edge || typeof edge !== 'object') return false;
                const fromNode = String(edge.fromNode || '');
                const toNode = String(edge.toNode || '');
                if (!fromNode || !toNode) return false;
                if (!nodeIdSet.has(fromNode) || !nodeIdSet.has(toNode)) return false;
                return !!String(edge.label || '').trim();
            })
            .map((edge) => ({
                title: __trimImportPreviewText(String(edge.label || '').trim()),
                color: __resolveImportPreviewEdgeColor(edge, getEdgeDefaultColor())
            }))
            .filter((entry) => !!entry.title)
            .filter(Boolean);

        const MAX_ITEMS = 6;
        const mapSectionItems = (list, fallbackColor, kind = 'temporary') => list
            .map((section, idx) => {
                const title = __resolveImportPreviewSectionTitle(section, idx, isEn);
                let indexLabel = '';
                if (kind === 'permanent') {
                    indexLabel = __resolveImportPreviewSnapshotBadge(section, idx + 1);
                } else {
                    const sectionLabel = getTempSectionLabel(section);
                    indexLabel = sectionLabel || String(idx + 1);
                }
                return {
                    title,
                    color: __resolveImportPreviewSectionColor(section, fallbackColor),
                    active: true,
                    indexLabel
                };
            })
            .slice(0, MAX_ITEMS);
        const mapMdItems = (list, fallbackColor) => list
            .map((node, idx) => ({
                title: __resolveImportPreviewMdTitle(node, idx, isEn),
                color: __resolveImportPreviewMdNodeColor(node, fallbackColor),
                active: true,
                indexLabel: String(idx + 1)
            }))
            .slice(0, MAX_ITEMS);

        const permanentItems = mapSectionItems(permanentSections, getPermanentSectionDefaultColor(), 'permanent');
        const splitItems = mapSectionItems(splitSections, getTempSectionDefaultColor(), 'temporary');
        const specialItems = mapSectionItems(specialSections, getSpecialTempSectionDefaultColor(), 'special');
        const blankItems = mapMdItems(blankMdNodes, getBlankNodeDefaultColor());
        const nativeItems = nativeCardNodes
            .map((node, idx) => ({
                title: __resolveImportPreviewNativeCardTitle(node, idx, isEn),
                color: __resolveImportPreviewMdNodeColor(node, getBlankNodeDefaultColor()),
                active: true
            }))
            .slice(0, MAX_ITEMS);
        const otherItems = nativeItems
            .concat(edgeEntries.map((entry) => ({
                ...entry,
                active: true
            })))
            .slice(0, MAX_ITEMS)
            .map((entry, idx) => ({
                ...entry,
                indexLabel: String(idx + 1)
            }));
        const otherCount = nativeCardNodes.length + edgeEntries.length;

        const temporaryCount = splitSections.length + specialSections.length;
        const totalCount = permanentSections.length + temporaryCount + groupMdNodes.length + edgeEntries.length;

        return {
            title: groupTitle,
            totalCount,
            permanent: {
                count: permanentSections.length,
                items: permanentItems
            },
            temporary: {
                count: temporaryCount,
                split: {
                    count: splitSections.length,
                    items: splitItems
                },
                special: {
                    count: specialSections.length,
                    items: specialItems
                }
            },
            blank: {
                count: blankMdNodes.length,
                items: blankItems
            },
            other: {
                count: otherCount,
                items: otherItems
            }
        };
    };

    const groups = [];
    if (groupNodes.length) {
        groupNodes.forEach((groupNode, index) => {
            groups.push(buildGroup(groupNode, index + 1));
        });
    } else {
        groups.push(buildGroup(null, 1));
    }

    const visibleGroups = groups.filter((group) => {
        if (!group || typeof group !== 'object') return false;
        return (group.totalCount || 0) > 0
            || (group.permanent && group.permanent.items && group.permanent.items.length)
            || (group.temporary && ((group.temporary.split && group.temporary.split.items && group.temporary.split.items.length) || (group.temporary.special && group.temporary.special.items && group.temporary.special.items.length)))
            || (group.blank && group.blank.items && group.blank.items.length)
            || (group.other && group.other.items && group.other.items.length);
    });

    return {
        sourceLabel,
        groups: visibleGroups.length ? visibleGroups : groups,
        hasContent: visibleGroups.length > 0,
        __rawTempState: tempState && typeof tempState === 'object' ? tempState : null,
        __rawStorage: fullStorage
    };
}

function showImportStructurePreviewDialog(options = {}) {
    const { isEn } = __getLang();
    const sourceLabel = String((options && options.sourceLabel) || '').trim();
    const mode = (options && options.mode === 'overwrite') ? 'overwrite' : 'permanent';
    const previewData = (options && options.previewData && typeof options.previewData === 'object') ? options.previewData : null;
    const previewTempState = (options && options.previewTempState && typeof options.previewTempState === 'object') ? options.previewTempState : null;
    const previewStorage = (options && options.previewStorage && typeof options.previewStorage === 'object') ? options.previewStorage : null;

    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog import-preview-dialog';
        dialog.id = 'canvasImportPreviewDialog';

        const title = isEn ? 'Import Structure Preview' : '导入结构预览';
        const closeText = isEn ? 'Close' : '关闭';
        const modeBadge = mode === 'overwrite'
            ? (isEn ? 'Full Overwrite' : '全量覆盖')
            : (isEn ? 'Snapshot Package Import' : '导入快照包');
        const sourceText = sourceLabel
            ? (isEn ? `Source: ${sourceLabel}` : `来源：${sourceLabel}`)
            : '';

        const note = previewData && previewData.hasContent
            ? (isEn
                ? (mode === 'overwrite'
                    ? 'Shows the final directory after full overwrite: local target is cleared and replaced by package content.'
                    : 'Imported content is treated as an incremental snapshot package and wrapped in a group frame for safer compare/manage.')
                : (mode === 'overwrite'
                    ? '展示全量覆盖后的最终目录：本地目标会被清空并替换为导入包内容。'
                    : '导入内容按增量快照包处理，并自动放入分组框，便于对比与管理。'))
            : (isEn ? 'No parse result yet. Confirm this mode first, then preview imported structure.' : '当前尚无解析结果，请先选定模式后再预览导入结构。');

        dialog.innerHTML = `
            <div class="import-dialog-content import-preview-dialog-content">
                <div class="import-dialog-header">
                    <h3>${title}</h3>
                    <button class="import-dialog-close" id="closeImportPreviewDialog">&times;</button>
                </div>
                <div class="import-dialog-body import-preview-dialog-body">
                    <div class="import-preview-meta">
                        <span class="import-preview-mode-badge ${mode === 'overwrite' ? 'is-overwrite' : 'is-permanent'}">${modeBadge}</span>
                        ${sourceText ? `<span class="import-preview-source">${sourceText}</span>` : ''}
                    </div>
                    <div class="import-preview-note">${note}</div>
                    <div class="import-preview-tree canvas-directory-tree" id="canvasImportPreviewTree"></div>
                    <div class="import-mode-actions import-preview-actions">
                        <button type="button" class="import-mode-btn" id="importPreviewCloseBtn">${closeText}</button>
                    </div>
                </div>
            </div>
        `;

        getOverlayContainer().appendChild(dialog);

        try {
            const previewTree = document.getElementById('canvasImportPreviewTree');
            if (previewTree && window.CanvasSidebarDirectory && typeof window.CanvasSidebarDirectory.renderPreviewDirectory === 'function') {
                const previewState = __convertPreviewTempStateToDirectoryState(previewTempState || {});
                window.CanvasSidebarDirectory.renderPreviewDirectory(previewTree, previewState, {
                    storage: previewStorage,
                    groupName: sourceLabel,
                    mode
                });
            }
        } catch (err) {
            console.warn('[Canvas] Failed to render preview directory with shared renderer:', err);
        }

        const cleanup = () => {
            try { dialog.remove(); } catch (_) { }
            resolve();
        };

        const closeBtn = document.getElementById('closeImportPreviewDialog');
        if (closeBtn) {
            closeBtn.addEventListener('click', cleanup);
        }

        const footerCloseBtn = document.getElementById('importPreviewCloseBtn');
        if (footerCloseBtn) {
            footerCloseBtn.addEventListener('click', cleanup);
        }

        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                cleanup();
            }
        });

        dialog.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cleanup();
            }
        });
    });
}

function showImportModeConfirmDialog(options = {}) {
    const { isEn } = __getLang();
    const defaultMode = (options && options.defaultMode === 'overwrite') ? 'overwrite' : 'permanent';
    const sourceLabel = String((options && options.sourceLabel) || '').trim();
    const onConfirm = (options && typeof options.onConfirm === 'function') ? options.onConfirm : null;
    const previewData = (options && options.previewData && typeof options.previewData === 'object') ? options.previewData : null;

    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog import-mode-dialog';
        dialog.id = 'canvasImportModeDialog';

        const title = isEn ? 'Import Mode' : '导入模式';
        const sourceText = sourceLabel
            ? (isEn ? `Source: ${sourceLabel}` : `来源：${sourceLabel}`)
            : '';

        const permanentTitle = isEn ? 'Snapshot Package Import' : '导入快照包';
        const permanentDesc = isEn
            ? 'Equivalent to incremental-style import: load as a snapshot package and wrap it in a group frame. (Default)'
            : '相当于增量式导入：按快照包导入，并用分组框包裹（默认）。';
        const overwriteTitle = isEn ? 'Full Overwrite' : '全量覆盖';
        const overwriteDesc = isEn
            ? 'Clears current local target and writes the imported package in. Undo via Backup.'
            : '清空本地目标，写入导入包内容。可通过「备份」撤销。';

        const previewText = isEn ? 'Preview Directory' : '预览目录';
        const confirmText = isEn ? 'Import' : '导入';
        const cancelText = isEn ? 'Cancel' : '取消';
        const thresholdLabel = isEn ? 'Diff threshold (entries)' : '差异阈值（条目数）';
        const thresholdHint = isEn
            ? 'If syncId diff entries ≥ threshold, full overwrite; otherwise incremental.'
            : '差异条目 ≥ 阈值时全量覆盖，否则按增量更新。';

        dialog.innerHTML = `
            <div class="import-dialog-content import-mode-dialog-content">
                <div class="import-dialog-header">
                    <h3>${title}</h3>
                    <button class="import-dialog-close" id="closeImportModeDialog">&times;</button>
                </div>
                <div class="import-dialog-body import-mode-dialog-body">
                    ${sourceText ? `<div class="import-mode-source">${sourceText}</div>` : ''}
                    <div class="import-mode-options" id="importModeOptions">
                        <button type="button" class="import-mode-option ${defaultMode === 'permanent' ? 'is-selected' : ''}" data-mode="permanent">
                            <span class="import-mode-radio" aria-hidden="true"></span>
                            <span class="import-mode-option-main">
                                <span class="import-mode-option-title">${permanentTitle}</span>
                                <span class="import-mode-option-desc">${permanentDesc}</span>
                            </span>
                        </button>
                        <button type="button" class="import-mode-option ${defaultMode === 'overwrite' ? 'is-selected' : ''}" data-mode="overwrite">
                            <span class="import-mode-radio" aria-hidden="true"></span>
                            <span class="import-mode-option-main">
                                <span class="import-mode-option-title">${overwriteTitle}</span>
                                <span class="import-mode-option-desc">${overwriteDesc}</span>
                            </span>
                        </button>
                    </div>
                    <div class="import-mode-overwrite-config" id="importModeOverwriteConfig" style="display:none; margin-top: 8px;">
                        <label style="display:flex; gap:8px; align-items:center; font-size: 12px;">
                            <span>${thresholdLabel}</span>
                            <input type="number" id="importModeThresholdInput" min="1" max="100000" step="1" style="width:80px;" />
                        </label>
                        <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">${thresholdHint}</div>
                    </div>
                    <div class="import-mode-actions">
                        <button type="button" class="import-mode-btn import-mode-btn-preview" id="importModePreviewBtn">${previewText}</button>
                        <div class="import-mode-actions-right">
                            <button type="button" class="import-mode-btn import-mode-btn-cancel" id="importModeCancelBtn">${cancelText}</button>
                            <button type="button" class="import-mode-btn import-mode-btn-confirm" id="importModeConfirmBtn">${confirmText}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        getOverlayContainer().appendChild(dialog);

        let selectedMode = defaultMode;
        let currentThreshold = 500;
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (bridge && typeof bridge.getImportOverwriteThreshold === 'function') {
            bridge.getImportOverwriteThreshold().then((v) => {
                currentThreshold = Number(v) || 500;
                const inp = document.getElementById('importModeThresholdInput');
                if (inp) inp.value = String(currentThreshold);
            }).catch(() => {});
        }
        const overwriteConfig = dialog.querySelector('#importModeOverwriteConfig');
        const refreshOverwriteVisibility = () => {
            if (overwriteConfig) overwriteConfig.style.display = (selectedMode === 'overwrite') ? '' : 'none';
        };
        refreshOverwriteVisibility();

        const cleanup = (result) => {
            try { dialog.remove(); } catch (_) { }
            resolve(result);
        };

        const pickMode = (mode) => {
            if (mode === 'overwrite') selectedMode = 'overwrite';
            else selectedMode = 'permanent';
            const optionsWrap = document.getElementById('importModeOptions');
            refreshOverwriteVisibility();
            if (!optionsWrap) return;
            optionsWrap.querySelectorAll('.import-mode-option').forEach((el) => {
                const elMode = String(el && el.dataset ? el.dataset.mode : '').toLowerCase();
                if (elMode === selectedMode) {
                    el.classList.add('is-selected');
                } else {
                    el.classList.remove('is-selected');
                }
            });
        };

        const optionsWrap = document.getElementById('importModeOptions');
        if (optionsWrap) {
            optionsWrap.addEventListener('click', (event) => {
                const btn = event && event.target && event.target.closest
                    ? event.target.closest('.import-mode-option')
                    : null;
                if (!btn) return;
                event.preventDefault();
                const mode = String(btn.dataset.mode || '').toLowerCase();
                pickMode(mode);
            });
        }

        const previewBtn = document.getElementById('importModePreviewBtn');
        if (previewBtn) {
            previewBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                await showImportStructurePreviewDialog({
                    sourceLabel,
                    mode: selectedMode,
                    previewData,
                    previewTempState: (previewData && previewData.__rawTempState) ? previewData.__rawTempState : null,
                    previewStorage: (previewData && previewData.__rawStorage) ? previewData.__rawStorage : null
                });
            });
        }

        const closeBtn = document.getElementById('closeImportModeDialog');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => cleanup(null));
        }

        const cancelBtn = document.getElementById('importModeCancelBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => cleanup(null));
        }

        const confirmBtn = document.getElementById('importModeConfirmBtn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                if (selectedMode === 'overwrite') {
                    // Capture threshold from input (or fall back to default), persist, and confirm.
                    const inp = document.getElementById('importModeThresholdInput');
                    if (inp) {
                        const v = Math.max(1, Math.min(100000, parseInt(inp.value, 10) || 500));
                        currentThreshold = v;
                        if (bridge && typeof bridge.setImportOverwriteThreshold === 'function') {
                            try { await bridge.setImportOverwriteThreshold(v); } catch (_) {}
                        }
                    }
                    const confirmMsg = isEn
                        ? `Full overwrite will clear your current local data and write the imported package in. You can undo via Backup. Threshold: ${currentThreshold}. Continue?`
                        : `全量覆盖将清空当前本地数据并写入导入包内容。可通过「备份」撤销。阈值：${currentThreshold}。继续吗？`;
                    if (!window.confirm(confirmMsg)) {
                        return;
                    }
                }
                if (onConfirm) {
                    try { onConfirm(selectedMode, { threshold: currentThreshold }); } catch (_) { }
                }
                cleanup({ mode: selectedMode, threshold: currentThreshold });
            });
        }

        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                cleanup(null);
            }
        });

        dialog.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cleanup(null);
            }
        });
    });
}

// =============================================================================
// Overwrite Import
// =============================================================================
// The overwrite path clears the local target (Chrome bookmark roots that map to the
// permanent section), recreates the bookmark tree from the import package, and rebuilds
// the local identityMap so that import-package syncIds map to the freshly minted
// chromeIds. Non-Chrome state (temp sections, .canvas, copies) is overwritten directly.
// The whole flow runs inside one bulk-mute span so per-event onCreated/onRemoved/onMoved
// listeners do not race against the orchestration.

function __collectSyncIdsFromImportTree(treeRoot) {
    const set = new Set();
    if (!treeRoot || typeof treeRoot !== 'object') return set;
    const stack = [treeRoot];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const id = String(node.id || '').trim();
        if (id) set.add(id);
        if (Array.isArray(node.children)) {
            for (const child of node.children) stack.push(child);
        }
    }
    return set;
}

// doc 第三轮修复 §2.3: 校验函数已迁到 storageBCS_core.js，通过 bridge.validateImportedIdentityMapAgainstTree
// 调用，不再在本文件内重复实现。本文件只负责调用并构造 ignoredChromeIds（由 fresh tree 推导）。

function __collectChromeIdsFromLocalContent(content) {
    const set = new Set();
    if (!content || typeof content !== 'object') return set;
    if (!content.tree || typeof content.tree !== 'object') return set;
    const stack = [content.tree];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const id = String(node.id || '').trim();
        if (id) set.add(id);
        if (Array.isArray(node.children)) {
            for (const child of node.children) stack.push(child);
        }
    }
    return set;
}

function __indexTreeBySyncId(root, idMap = null) {
    const map = new Map();
    if (!root || typeof root !== 'object') return map;
    const walk = (node, parentSyncId) => {
        if (!node || typeof node !== 'object') return;
        const rawId = String(node.id || '').trim();
        let syncId = rawId;
        if (idMap) {
            syncId = idMap.get(rawId) || rawId;
        }
        if (syncId) {
            const children = Array.isArray(node.children) ? node.children : [];
            map.set(syncId, {
                syncId,
                chromeId: rawId,
                parentSyncId,
                title: String(node.title || ''),
                url: String(node.url || ''),
                isFolder: !node.url,
                childrenSyncIds: children.map(c => {
                    const cid = String(c && c.id || '').trim();
                    return idMap ? (idMap.get(cid) || cid) : cid;
                }).filter(Boolean)
            });
            children.forEach((child) => {
                walk(child, syncId);
            });
        }
    };
    walk(root, null);
    return map;
}

function __countOverwriteDiff(localContent, importTreeRoot) {
    // Build local chromeId -> syncId translation map from identityMap
    const localChromeIdToSyncId = new Map();
    if (localContent && Array.isArray(localContent.identityMap)) {
        for (const entry of localContent.identityMap) {
            if (entry && entry.id && entry.syncId) {
                localChromeIdToSyncId.set(String(entry.id), String(entry.syncId));
            }
        }
    }

    const localMap = __indexTreeBySyncId(localContent && localContent.tree, localChromeIdToSyncId);
    const importMap = __indexTreeBySyncId(importTreeRoot);
    
    let adds = 0;
    let deletes = 0;
    let updates = 0;
    let moves = 0;
    const siblingFilterCache = new Map();

    importMap.forEach((impNode, syncId) => {
        const isRootOrTopRoot = (syncId === 'syncId_root' || syncId === importTreeRoot.id || impNode.parentSyncId === null || impNode.parentSyncId === importTreeRoot.id);
        const locNode = localMap.get(syncId);
        if (!locNode) {
            if (!isRootOrTopRoot) {
                adds += 1;
            }
        } else {
            if (!isRootOrTopRoot) {
                const needTitle = locNode.title !== impNode.title;
                const needUrl = !impNode.isFolder && locNode.url !== impNode.url;
                if (needTitle || needUrl) {
                    updates += 1;
                }
                
                const parentDiffers = locNode.parentSyncId !== impNode.parentSyncId;
                let orderDiffers = false;
                if (!parentDiffers && impNode.parentSyncId) {
                    let cache = siblingFilterCache.get(impNode.parentSyncId);
                    if (!cache) {
                        const parentImpNode = importMap.get(impNode.parentSyncId);
                        const parentLocNode = localMap.get(impNode.parentSyncId);
                        const impSiblingsMap = new Map();
                        const locSiblingsMap = new Map();
                        if (parentImpNode && parentLocNode) {
                            let impIdx = 0;
                            for (const id of parentImpNode.childrenSyncIds) {
                                if (localMap.has(id)) {
                                    impSiblingsMap.set(id, impIdx++);
                                }
                            }
                            let locIdx = 0;
                            for (const id of parentLocNode.childrenSyncIds) {
                                if (importMap.has(id)) {
                                    locSiblingsMap.set(id, locIdx++);
                                }
                            }
                        }
                        cache = { impSiblingsMap, locSiblingsMap };
                        siblingFilterCache.set(impNode.parentSyncId, cache);
                    }
                    const impIndex = cache.impSiblingsMap.has(syncId) ? cache.impSiblingsMap.get(syncId) : -1;
                    const locIndex = cache.locSiblingsMap.has(syncId) ? cache.locSiblingsMap.get(syncId) : -1;
                    if (impIndex >= 0 && locIndex >= 0 && impIndex !== locIndex) {
                        orderDiffers = true;
                    }
                }
                if (parentDiffers || orderDiffers) {
                    moves += 1;
                }
            }
        }
    });
    
    localMap.forEach((locNode, syncId) => {
        if (!importMap.has(syncId)) {
            const cid = locNode.chromeId;
            const isRootOrTopRoot = (syncId === 'syncId_root' || cid === '0' || cid === '1' || cid === '2' || cid === '3');
            if (!isRootOrTopRoot) {
                deletes += 1;
            }
        }
    });
    
    const totalImportedNodes = importMap.size;
    const totalLocalNodes = localMap.size;
    
    return {
        adds,
        deletes,
        updates,
        moves,
        totalImportedNodes,
        totalLocalNodes,
        costIncremental: adds + deletes + updates + moves,
        costOverwrite: 3 + totalImportedNodes
    };
}

function __chromeBookmarksRemoveNodeByType(node) {
    if (!node || !node.id || !chrome || !chrome.bookmarks) return Promise.resolve(false);
    const childId = String(node.id);
    const isFolder = !node.url;
    const removeApi = isFolder ? chrome.bookmarks.removeTree : chrome.bookmarks.remove;
    if (typeof removeApi !== 'function') return Promise.resolve(false);
    return new Promise((resolve) => {
        try {
            removeApi.call(chrome.bookmarks, childId, () => {
                const err = chrome.runtime && chrome.runtime.lastError
                    ? String(chrome.runtime.lastError.message || '')
                    : '';
                if (err) {
                    try {
                        console.warn('[Overwrite Import] bookmarks remove skipped:', {
                            chromeId: childId,
                            isFolder,
                            api: isFolder ? 'removeTree' : 'remove',
                            err
                        });
                    } catch (_) {}
                    resolve(false);
                    return;
                }
                resolve(true);
            });
        } catch (error) {
            try {
                console.warn('[Overwrite Import] bookmarks remove failed:', {
                    chromeId: childId,
                    isFolder,
                    api: isFolder ? 'removeTree' : 'remove',
                    error
                });
            } catch (_) {}
            resolve(false);
        }
    });
}

async function __chromeBookmarksGetNodeById(chromeId) {
    const id = String(chromeId || '').trim();
    if (!id || !chrome || !chrome.bookmarks || typeof chrome.bookmarks.getSubTree !== 'function') return null;
    try {
        const roots = await new Promise((resolve) => {
            try {
                chrome.bookmarks.getSubTree(id, (nodes) => {
                    const err = chrome.runtime && chrome.runtime.lastError;
                    resolve(err ? null : nodes);
                });
            } catch (_) { resolve(null); }
        });
        return roots && roots[0] ? roots[0] : null;
    } catch (_) {
        return null;
    }
}

async function __chromeBookmarksRemoveExistingNodeById(chromeId) {
    const node = await __chromeBookmarksGetNodeById(chromeId);
    return node ? __chromeBookmarksRemoveNodeByType(node) : false;
}

async function __chromeBookmarksRemoveAllInRoot(rootNode) {
    if (!rootNode || !Array.isArray(rootNode.children) || !chrome || !chrome.bookmarks) return;
    const childrenSnapshot = rootNode.children.slice();
    for (const child of childrenSnapshot) {
        if (!child || !child.id) continue;
        await __chromeBookmarksRemoveNodeByType(child);
    }
}

async function __recreateChromeBookmarkTreeFromImport(importTreeRoot, syncIdToChromeId) {
    if (!importTreeRoot || !Array.isArray(importTreeRoot.children) || !chrome || !chrome.bookmarks) return;
    const createOne = (parentId, payload) => new Promise((resolve, reject) => {
        const createInfo = { parentId, title: String(payload.title || '') };
        if (payload.url) createInfo.url = payload.url;
        try {
            chrome.bookmarks.create(createInfo, (created) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(created);
                }
            });
        } catch (e) { reject(e); }
    });
    const folderTypeToChromeId = { 'bookmarks-bar': '1', 'other': '2', 'mobile': '3' };
    // doc 第三轮修复 §2.2: 不再静默 fallback 到书签栏。folderType 缺失或未识别时返回 null,
    // 调用方负责跳过该 top-child 并 console.warn, 避免把整棵子树堆到 '1' 导致重复。
    const rootChromeIdOf = (importRootChild) => {
        const ft = String(importRootChild && importRootChild.folderType || '').trim();
        if (folderTypeToChromeId[ft]) return folderTypeToChromeId[ft];
        return null;
    };

    // Record root + top-level root syncId → fixed Chrome root id BEFORE walking children.
    // These nodes are not created via chrome.bookmarks.create (they're permanent Chrome
    // roots), so we map them by convention. Without this, the rebuilt identityMap would
    // miss `root`, `bookmarks-bar`, `other`, `mobile` entries and __verifyAndHealIdentityMap
    // would later mint fresh syncIds for them, violating doc §2.2.1.4.
    const importRootSyncId = String(importTreeRoot.id || '').trim();
    if (importRootSyncId) {
        syncIdToChromeId.set(importRootSyncId, '0');
    }
    for (const topChild of importTreeRoot.children) {
        if (!topChild) continue;
        const topSyncId = String(topChild.id || '').trim();
        if (!topSyncId) continue;
        const chromeRootId = rootChromeIdOf(topChild);
        if (!chromeRootId) {
            try { console.warn('[Overwrite Import] unknown top-root folderType, skipping:', topChild.folderType, 'syncId=', topSyncId); } catch (_) {}
            continue;
        }
        syncIdToChromeId.set(topSyncId, chromeRootId);
    }

    const walk = async (chromeParentId, importChildren) => {
        if (!Array.isArray(importChildren)) return;
        for (const node of importChildren) {
            if (!node || !node.id) continue;
            const created = await createOne(chromeParentId, node);
            if (!created || !created.id) continue;
            syncIdToChromeId.set(String(node.id), String(created.id));
            if (Array.isArray(node.children) && node.children.length) {
                await walk(created.id, node.children);
            }
        }
    };
    for (const topChild of importTreeRoot.children) {
        if (!topChild) continue;
        const chromeRootId = rootChromeIdOf(topChild);
        if (!chromeRootId) continue; // already warned above
        if (Array.isArray(topChild.children) && topChild.children.length) {
            await walk(chromeRootId, topChild.children);
        }
    }
}

async function __applyOverwriteImportedCanvasState(parsedTempState, bridge, parsedStorage = null, options = {}) {
    if (!parsedTempState || typeof parsedTempState !== 'object') return false;
    let persisted = false;
    const deferRuntimeApply = options && (
        options.deferRuntimeApply === true
        || options.willReloadAfterImport === true
    );
    const cloneJson = (value) => {
        try {
            if (typeof structuredClone === 'function') return structuredClone(value);
        } catch (_) {}
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    };
    const isPermanentCanvasSectionId = (idInput) => {
        const id = String(idInput || '').trim();
        return id === 'permanent-section' || id.startsWith('permanent-section-copy-');
    };
    const originalSections = Array.isArray(parsedTempState.sections)
        ? parsedTempState.sections
        : (Array.isArray(parsedTempState.tempSections) ? parsedTempState.tempSections : []);
    const permanentLayoutNodes = [];
    const filteredSections = [];
    originalSections.forEach((section) => {
        if (!section || typeof section !== 'object') return;
        const id = String(section.id || '').trim();
        if (isPermanentCanvasSectionId(id)) {
            permanentLayoutNodes.push({
                id,
                type: 'file',
                file: '',
                x: Number(section.x) || 0,
                y: Number(section.y) || 0,
                width: Number(section.width) || 600,
                height: Number(section.height) || 600,
                color: section.color || '4'
            });
            return;
        }
        filteredSections.push(section);
    });
    const stateForOverwrite = cloneJson(parsedTempState) || {};
    stateForOverwrite.sections = filteredSections;
    if (Object.prototype.hasOwnProperty.call(stateForOverwrite, 'tempSections')) {
        stateForOverwrite.tempSections = filteredSections;
    }
    stateForOverwrite.timestamp = Date.now();
    let storagePatch = null;
    if (parsedStorage && typeof parsedStorage === 'object' && parsedStorage[BCS_CANVAS_KEY]) {
        storagePatch = { [BCS_CANVAS_KEY]: parsedStorage[BCS_CANVAS_KEY] };
    } else if (permanentLayoutNodes.length) {
        storagePatch = { [BCS_CANVAS_KEY]: JSON.stringify({ nodes: permanentLayoutNodes, edges: [] }) };
    }

    // 覆盖导入的临时栏目 / .canvas 需要写入当前 BCS 分片真相源：
    // bcs:meta + bcs:canvas + bcs:section:*。只写旧的 temp snapshot key 会被加载器忽略。
    if (bridge && typeof bridge.saveCanvasTempStateToBcsStorage === 'function') {
        await bridge.saveCanvasTempStateToBcsStorage(stateForOverwrite, {
            immediate: true,
            storagePatch,
            preferStoragePermanentLayout: true,
            skipValidation: true
        });
        persisted = true;
    } else {
        await new Promise((resolve) => {
            try { chrome.storage.local.set({ 'bcs:temp-state-snapshot': stateForOverwrite }, () => resolve()); }
            catch (_) { resolve(); }
        });
    }

    if (deferRuntimeApply) {
        return persisted;
    }

    // 同步当前运行态，避免用户覆盖导入后不刷新页面就再次导出时，
    // 旧 CanvasState 把刚写入的 BCS 状态覆盖回去。
    try {
        const runtimeCanvasState = (typeof CanvasState !== 'undefined' && CanvasState)
            ? CanvasState
            : (window.CanvasState || null);
        const prevSections = (runtimeCanvasState && Array.isArray(runtimeCanvasState.tempSections))
            ? runtimeCanvasState.tempSections.slice()
            : [];
        const prevMdNodes = (runtimeCanvasState && Array.isArray(runtimeCanvasState.mdNodes))
            ? runtimeCanvasState.mdNodes.slice()
            : [];
        prevSections.forEach((section) => {
            if (!section || !section.id) return;
            const el = document.getElementById(section.id);
            if (el) el.remove();
        });
        prevMdNodes.forEach((node) => {
            if (!node || !node.id) return;
            const el = document.getElementById(node.id);
            if (el) el.remove();
        });
        const svg = document.querySelector('.canvas-edges');
        if (svg) {
            Array.from(svg.querySelectorAll('.canvas-edge, .canvas-edge-label, .canvas-edge-label-bg, .canvas-edge-hit-area, foreignObject.edge-label-fo')).forEach((el) => {
                try { el.remove(); } catch (_) {}
            });
        }
        if (typeof window.__applyCanvasTempStateObject === 'function') {
            window.__applyCanvasTempStateObject(stateForOverwrite, { preserveRaw: true });
        } else if (typeof __applyCanvasTempStateObject === 'function') {
            __applyCanvasTempStateObject(stateForOverwrite, { preserveRaw: true });
        }
        if (typeof window.__finalizeTempNodesLoad === 'function') {
            window.__finalizeTempNodesLoad({ loadedFromStorage: true });
        } else if (typeof __finalizeTempNodesLoad === 'function') {
            __finalizeTempNodesLoad({ loadedFromStorage: true });
        }
        if (storagePatch && storagePatch[BCS_CANVAS_KEY]) {
            const layoutStorage = { [BCS_CANVAS_KEY]: storagePatch[BCS_CANVAS_KEY] };
            if (typeof window.__applyPermanentLayoutFromBcsStorageSnapshot === 'function') {
                window.__applyPermanentLayoutFromBcsStorageSnapshot(layoutStorage, { removeMissingCopies: true });
            } else if (typeof __applyPermanentLayoutFromBcsStorageSnapshot === 'function') {
                __applyPermanentLayoutFromBcsStorageSnapshot(layoutStorage, { removeMissingCopies: true });
            }
        }
        if (window.CanvasSidebarDirectory && typeof window.CanvasSidebarDirectory.refresh === 'function') {
            try { window.CanvasSidebarDirectory.refresh({ force: true }); } catch (_) {}
        }
    } catch (e) {
        console.warn('[Overwrite Import] runtime canvas-state apply failed; storage was still updated:', e);
    }

    return persisted;
}



async function __performOverwriteImport(payload) {
    const { isEn } = __getLang();
    const parsedTempState = payload && payload.parsedTempState;
    const parsedStorage = (payload && payload.parsedStorage && typeof payload.parsedStorage === 'object') ? payload.parsedStorage : {};
    const parsedPrimaryState = payload && payload.parsedPrimaryState;
    const importFileName = String(payload && payload.importFileName || '');
    // doc 最终修复计划 §3.1: threshold:0 必须强制覆盖。
    // 旧实现 `parseInt(...) || 300` 会把 0 重新映射成 300，导致 backup restore / auto-rollback 走增量分支。
    const __parsedThreshold = parseInt(payload && payload.threshold, 10);
    const threshold = Number.isFinite(__parsedThreshold) ? Math.max(0, __parsedThreshold) : 500;
    const skipBackupWrite = !!(payload && payload.skipBackupWrite === true);
    const deferRuntimeApply = !!(payload && (
        payload.deferRuntimeApply === true
        || payload.willReloadAfterImport === true
    ));
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (!bridge) throw new Error('Storage bridge unavailable.');

    // 1. Snapshot current local state to backup slot (undo entry).
    //    Restore-from-backup callers pass skipBackupWrite=true to avoid overwriting the very
    //    backup they're restoring from (fix plan §2.6 step 3).
    let preImportBackup = null;
    if (!skipBackupWrite) {
        try {
            preImportBackup = await bridge.buildExportSandbox({ reason: 'overwrite-import-pre' });
            if (preImportBackup) {
                bridge.processExportSandboxForExport(preImportBackup);
                await bridge.writeBackupSlotFromSandbox(preImportBackup);
            }
        } catch (e) { console.warn('[Overwrite Import] pre-import backup failed:', e); }
    }

    // 2. Locate the import permanent main content within parsedStorage.
    const importPermMain = parsedStorage['bcs:perm:main'] || (parsedPrimaryState && parsedPrimaryState['bcs:perm:main']) || null;
    if (!importPermMain || !importPermMain.tree) {
        throw new Error(isEn ? 'Import package missing permanent main content.' : '导入包缺少永久主体内容。');
    }
    const importTree = importPermMain.tree;
    if (importTree && Array.isArray(importTree.children)) {
        importTree.children = importTree.children.filter(child => {
            if (!child) return false;
            const rawFt = child.folderType || child.folder_type || '';
            const ft = typeof __normalizeBookmarkFolderType === 'function'
                ? __normalizeBookmarkFolderType(rawFt)
                : String(rawFt).trim().toLowerCase();
            if (typeof __canPersistBookmarkRootSyncing === 'function') {
                return __canPersistBookmarkRootSyncing(ft);
            }
            return ft === 'bookmarks-bar' || ft === 'other' || ft === 'mobile' || ft === 'managed';
        });
    }
    const importIdentityMap = Array.isArray(importPermMain.identityMap) ? importPermMain.identityMap : [];

    // 3. Decide branch.
    const localContent = await bridge.readPermanentMainContentFromBcs({
        skipIdentityMapHeal: true
    });
    const costEval = __countOverwriteDiff(localContent, importTree);
    const goOverwrite = threshold <= 0 || costEval.costIncremental >= threshold;
    try {} catch (_) {}

    // 4. Open bulk-mute envelope.
    let muteSession = null;
    if (typeof window.beginBookmarkBulkMute === 'function') {
        muteSession = await window.beginBookmarkBulkMute('overwrite-import');
    }

    const normalizeTagArrayForOverwrite = (rawList) => {
        if (bridge && typeof bridge.normalizeTagArray === 'function') {
            return bridge.normalizeTagArray(rawList);
        }
        if (!Array.isArray(rawList)) return [];
        const out = [];
        const seen = new Set();
        rawList.forEach((raw) => {
            if (!raw || typeof raw !== 'object') return;
            const color = String(raw.color || '').trim();
            if (!color) return;
            const text = String(raw.text || '').trim();
            const key = `${color.toLowerCase()}::${text}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ color, text });
        });
        return out;
    };

    // Extract item metadata from import identityMap keyed by syncId — both branches reuse.
    const importExtrasBySyncId = new Map();
    for (const entry of importIdentityMap) {
        if (!entry || !entry.syncId) continue;
        const obj = {};
        const tags = normalizeTagArrayForOverwrite(entry.tags);
        if (tags.length) obj.tags = tags;
        const note = bridge && typeof bridge.normalizeNoteInput === 'function'
            ? bridge.normalizeNoteInput(entry.note)
            : String(entry.note == null ? '' : entry.note).replace(/\r\n?/g, '\n').trim();
        if (note) {
            obj.note = note;
            obj.noteColor = bridge && typeof bridge.normalizeNoteColorInput === 'function'
                ? bridge.normalizeNoteColorInput(entry.noteColor)
                : (['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].includes(String(entry.noteColor || '').trim().toLowerCase())
                    ? String(entry.noteColor || '').trim().toLowerCase()
                    : 'orange');
        }
        for (const k of Object.keys(entry)) {
            if (k === 'id' || k === 'syncId' || k === 'tags' || k === 'note' || k === 'noteColor') continue;
            obj[k] = entry[k];
        }
        if (Object.keys(obj).length) {
            importExtrasBySyncId.set(String(entry.syncId), obj);
        }
    }

    // doc 最终修复计划 §3.3 / §3.8: expectedSyncIds 包含导入包 root + top + 所有普通节点。
    // 写入 BCS 前必须用此集合校验 identityMap，防止重新生成 syncId 或漏项。
    const expectedSyncIds = __collectSyncIdsFromImportTree(importTree);

    let success = false;
    const refreshTagUiAfterImport = async () => {
        try {
            if (window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
                await window.TagSystem.ensurePermTagsLoaded(true);
            }
        } catch (_) {}
        try {
            if (window.NoteSystem && typeof window.NoteSystem.ensurePermNotesLoaded === 'function') {
                await window.NoteSystem.ensurePermNotesLoaded(true);
            }
        } catch (_) {}
        try {
            if (typeof window.__refreshAllTagDots === 'function') {
                window.__refreshAllTagDots();
            }
        } catch (_) {}
        try {
            if (typeof window.__refreshAllNoteMarkers === 'function') {
                window.__refreshAllNoteMarkers();
            }
        } catch (_) {}
        try {
            if (typeof window.invalidateCanvasNoteSearchCaches === 'function') {
                window.invalidateCanvasNoteSearchCaches();
            }
        } catch (_) {}
    };
    try {
        const executeOverwriteBranch = async () => {
            // -- Overwrite branch ---------------------------------------------------------
            // Clear Chrome bookmark roots (immediate children of the bookmarks tree root).
            const tree = await new Promise((resolve) => chrome.bookmarks.getTree((t) => resolve(t)));
            const rootNode = Array.isArray(tree) ? tree[0] : null;
            if (rootNode && Array.isArray(rootNode.children)) {
                for (const topRoot of rootNode.children) {
                    if (!topRoot || !Array.isArray(topRoot.children)) continue;
                    await __chromeBookmarksRemoveAllInRoot(topRoot);
                }
            }

            const syncIdToChromeId = new Map();
            await __recreateChromeBookmarkTreeFromImport(importTree, syncIdToChromeId);

            // doc 最终修复计划 §3.3: nextIdentityMap 必须只包含 expectedSyncIds 来源的项。
            const nextIdentityMap = [];
            syncIdToChromeId.forEach((chromeId, syncId) => {
                if (!expectedSyncIds.has(syncId)) return;
                const out = { id: chromeId, syncId };
                const extras = importExtrasBySyncId.get(syncId);
                if (extras) Object.assign(out, extras);
                nextIdentityMap.push(out);
            });

            const freshTree = await new Promise((resolve) => chrome.bookmarks.getTree((t) => resolve(t)));
            const freshRoot = Array.isArray(freshTree) ? freshTree[0] : null;

            // doc 最终修复计划 §3.8 + 第三轮 §2.2/§2.3: 写入前校验通过 bridge 调用，
            // 并把 fresh tree 中 managed 等不可写根的 chromeId 列入 ignoredChromeIds，
            // 避免企业策略环境下因 managed 节点未在 nextIdentityMap 中而误报失败。
            const ignoredChromeIds = (typeof bridge.collectIgnoredChromeIdsFromFreshTree === 'function')
                ? bridge.collectIgnoredChromeIdsFromFreshTree(freshRoot)
                : new Set();
            const validation = bridge.validateImportedIdentityMapAgainstTree(
                freshRoot, nextIdentityMap, expectedSyncIds, { ignoredChromeIds }
            );
            if (!validation.ok) {
                throw new Error('[Overwrite Import] identityMap validation failed: ' + validation.errors.slice(0, 5).join('; '));
            }

            await bridge.writePermanentTreeSnapshotAfterChromeApply([freshRoot], {
                skipIdentityMapHeal: true,
                baseContent: {
                    ...(localContent || {}),
                    descriptionMd: importPermMain.descriptionMd || (localContent && localContent.descriptionMd) || '',
                    identityMap: nextIdentityMap
                }
            });
        };

        let runOverwrite = goOverwrite;
        if (!runOverwrite) {
            try {
                // -- Incremental branch -------------------------------------------------------
            // doc 最终修复计划 §3.2 / §3.3 / §3.4: 删除后必须清理 mapping；root/top-root syncId
            // 必须以导入包为准；move/sort 必须基于 fresh tree。

            // Local tables.
            const localList = (localContent && Array.isArray(localContent.identityMap)) ? localContent.identityMap : [];
            const localBySyncId = new Map();
            const localByChromeId = new Map();
            for (const entry of localList) {
                if (!entry || !entry.syncId || !entry.id) continue;
                localBySyncId.set(String(entry.syncId), entry);
                localByChromeId.set(String(entry.id), entry);
            }

            // Import tree shape:
            //   importTree (root, syncId = importRootSyncId)
            //     ├ topChild (folderType, syncId = topSyncId)
            //     │   └ ...children
            //     └ ...
            const folderTypeToChromeId = { 'bookmarks-bar': '1', 'other': '2', 'mobile': '3' };
            const importRootSyncId = String(importTree.id || '').trim();
            const importTopSyncIdToChromeId = new Map();
            // doc 第三轮修复 §2.2: 未识别的 folderType 直接跳过并 console.warn，
            // 不再 fallback 到 '1'，避免把整棵子树堆到书签栏导致重复 / 错位。
            if (Array.isArray(importTree.children)) {
                for (const topChild of importTree.children) {
                    if (!topChild) continue;
                    const topSyncId = String(topChild.id || '').trim();
                    if (!topSyncId) continue;
                    const ft = String(topChild.folderType || '').trim();
                    const mapped = folderTypeToChromeId[ft];
                    if (!mapped) {
                        try { console.warn('[Incremental Import] unknown top-root folderType, skipping:', ft, 'syncId=', topSyncId); } catch (_) {}
                        continue;
                    }
                    importTopSyncIdToChromeId.set(topSyncId, mapped);
                }
            }

            // Flatten import normal nodes (skip root + top-roots, since those are not created).
            const importNormalNodesBySyncId = new Map(); // syncId -> { title, url, isFolder, parentSyncId }
            const flattenImport = (node, parentSyncId) => {
                if (!node || typeof node !== 'object') return;
                const syncId = String(node.id || '').trim();
                const children = Array.isArray(node.children) ? node.children : [];
                if (syncId && parentSyncId !== null) {
                    importNormalNodesBySyncId.set(syncId, {
                        syncId,
                        parentSyncId,
                        title: String(node.title || ''),
                        url: String(node.url || ''),
                        isFolder: !node.url
                    });
                }
                for (let i = 0; i < children.length; i++) {
                    flattenImport(children[i], syncId || parentSyncId);
                }
            };
            if (Array.isArray(importTree.children)) {
                for (const topChild of importTree.children) {
                    if (!topChild) continue;
                    const topSyncId = String(topChild.id || '').trim();
                    if (Array.isArray(topChild.children)) {
                        for (const grandChild of topChild.children) {
                            flattenImport(grandChild, topSyncId);
                        }
                    }
                }
            }

            const importNormalSyncIds = new Set(importNormalNodesBySyncId.keys());

            // 1) Create missing nodes & Update title/url. (DFS over import tree, parents first).
            //    syncIdToChromeId is rebuilt from scratch, seeded only by import-package authoritative ids.
            const syncIdToChromeId = new Map();
            // Root + top-roots come from import (§3.3).
            if (importRootSyncId) syncIdToChromeId.set(importRootSyncId, '0');
            importTopSyncIdToChromeId.forEach((chromeId, syncId) => syncIdToChromeId.set(syncId, chromeId));
            // Seed normal nodes with surviving local mappings.
            importNormalSyncIds.forEach((syncId) => {
                const local = localBySyncId.get(syncId);
                if (local) syncIdToChromeId.set(syncId, String(local.id));
            });

            const createMissingWalk = async (chromeParentId, importChildren) => {
                if (!Array.isArray(importChildren)) return;
                for (const node of importChildren) {
                    if (!node || !node.id) continue;
                    const syncId = String(node.id);
                    let chromeId = syncIdToChromeId.get(syncId);
                    if (!chromeId) {
                        const createInfo = { parentId: chromeParentId, title: String(node.title || '') };
                        if (node.url) createInfo.url = node.url;
                        const created = await new Promise((resolve, reject) => {
                            try { chrome.bookmarks.create(createInfo, (c) => { if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(c); }); } catch (e) { reject(e); }
                        });
                        chromeId = created && created.id;
                        if (chromeId) syncIdToChromeId.set(syncId, chromeId);
                    }
                    if (chromeId && Array.isArray(node.children) && node.children.length) {
                        await createMissingWalk(chromeId, node.children);
                    }
                }
            };
            if (Array.isArray(importTree.children)) {
                for (const topChild of importTree.children) {
                    if (!topChild) continue;
                    const topSyncId = String(topChild.id || '').trim();
                    // doc 第三轮修复 §2.2: 未在 importTopSyncIdToChromeId 中的 top-child 已在
                    // 上方被显式跳过（含 warn），这里也跳过其子树，不再 fallback 到 '1'。
                    const chromeRootId = importTopSyncIdToChromeId.get(topSyncId);
                    if (!chromeRootId) continue;
                    await createMissingWalk(chromeRootId, topChild.children);
                }
            }

            // Update title/url. We need fresh local tree to compare correctly after creates.
            const buildFreshLookups = async () => {
                const t = await new Promise((resolve) => chrome.bookmarks.getTree((tree) => resolve(tree)));
                const root = Array.isArray(t) ? t[0] : null;
                const nodeByChromeId = new Map();
                const parentByChildId = new Map();
                if (root) {
                    const stack = [{ node: root, parent: null, index: -1 }];
                    while (stack.length) {
                        const { node, parent, index } = stack.pop();
                        if (!node || typeof node !== 'object') continue;
                        const id = String(node.id || '').trim();
                        if (id) {
                            nodeByChromeId.set(id, node);
                            if (parent) parentByChildId.set(id, { parentId: String(parent.id || '').trim(), index });
                        }
                        const children = Array.isArray(node.children) ? node.children : [];
                        for (let i = 0; i < children.length; i++) stack.push({ node: children[i], parent: node, index: i });
                    }
                }
                return { root, nodeByChromeId, parentByChildId };
            };

            let lookups = await buildFreshLookups();
            for (const imp of importNormalNodesBySyncId.values()) {
                const chromeId = syncIdToChromeId.get(imp.syncId);
                if (!chromeId) continue;
                const liveNode = lookups.nodeByChromeId.get(chromeId);
                if (!liveNode) continue;
                const needTitle = String(liveNode.title || '') !== imp.title;
                const needUrl = !imp.isFolder && String(liveNode.url || '') !== imp.url;
                if (needTitle || needUrl) {
                    const updateInfo = {};
                    if (needTitle) updateInfo.title = imp.title;
                    if (needUrl) updateInfo.url = imp.url;
                    try {
                        await new Promise((resolve) => { try { chrome.bookmarks.update(chromeId, updateInfo, () => resolve()); } catch (_) { resolve(); } });
                    } catch (_) {}
                }
            }

            // 2) Move/reorder.
            //    Phase 1: Resolve parent modifications (move nodes to their desired parents first, appended to the end).
            //    Phase 2: Sort children within each modified folder in memory without rebuilding tree lookups.
            lookups = await buildFreshLookups();

            const parentMoveQueue = [];
            const collectParentMoves = (importChildren) => {
                if (!Array.isArray(importChildren)) return;
                for (const node of importChildren) {
                    if (!node || !node.id) continue;
                    const syncId = String(node.id);
                    const chromeId = syncIdToChromeId.get(syncId);
                    if (chromeId) {
                        const parentSyncId = String(node.parentId || '').trim();
                        const desiredParentChromeId = syncIdToChromeId.get(parentSyncId);
                        const currentInfo = lookups.parentByChildId.get(chromeId);
                        const parentDiffers = !!(desiredParentChromeId && currentInfo && String(currentInfo.parentId) !== String(desiredParentChromeId));
                        if (parentDiffers && desiredParentChromeId) {
                            parentMoveQueue.push({ chromeId, desiredParentChromeId, syncId });
                        }
                    }
                    if (Array.isArray(node.children) && node.children.length) {
                        collectParentMoves(node.children);
                    }
                }
            };
            if (Array.isArray(importTree.children)) {
                for (const topChild of importTree.children) {
                    if (!topChild) continue;
                    collectParentMoves(topChild.children);
                }
            }

            for (const item of parentMoveQueue) {
                try {
                    await new Promise((resolve) => {
                        try {
                            chrome.bookmarks.move(
                                item.chromeId,
                                { parentId: item.desiredParentChromeId },
                                () => {
                                    const err = chrome.runtime && chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
                                    if (err) {
                                        try { console.warn('[Incremental Import] parent move failed:', item.syncId, err); } catch (_) {}
                                    }
                                    resolve();
                                }
                            );
                        } catch (_) { resolve(); }
                    });
                } catch (_) {}
            }

            // 3) Delete: local syncId not in expectedSyncIds. (Skip root/top-roots — they always exist.)
            //    Since we delete after move, any surviving node under a deleted folder has already been
            //    safely moved out to its new parent, avoiding cascade deletion errors.
            const toDeleteEntries = [];
            for (const [syncId, entry] of localBySyncId) {
                if (expectedSyncIds.has(syncId)) continue; // import has it, keep
                if (importTopSyncIdToChromeId.has(syncId)) continue; // top root; keep chromeId, syncId rewritten later
                if (syncId === importRootSyncId) continue; // root; same
                // Skip if the chromeId is one of the fixed Chrome roots (defensive; shouldn't happen).
                if (entry.id === '0' || entry.id === '1' || entry.id === '2' || entry.id === '3') continue;
                toDeleteEntries.push(entry);
            }
            for (const entry of toDeleteEntries) {
                try {
                    await __chromeBookmarksRemoveExistingNodeById(entry.id);
                } catch (_) {}
            }

            const foldersToSort = [];
            const collectFolders = (node) => {
                if (!node || typeof node !== 'object') return;
                const syncId = String(node.id || '').trim();
                const chromeId = syncIdToChromeId.get(syncId);
                const children = Array.isArray(node.children) ? node.children : [];
                if (chromeId && chromeId !== '0' && children.length > 0) {
                    foldersToSort.push({
                        chromeId,
                        expectedChildrenSyncIds: children.map(c => String(c.id)).filter(Boolean)
                    });
                }
                for (const child of children) {
                    if (Array.isArray(child.children)) {
                        collectFolders(child);
                    }
                }
            };
            if (Array.isArray(importTree.children)) {
                for (const topChild of importTree.children) {
                    if (!topChild) continue;
                    collectFolders(topChild);
                }
            }

            const chromeIdToSyncId = new Map();
            syncIdToChromeId.forEach((cid, sid) => {
                chromeIdToSyncId.set(String(cid), String(sid));
            });

            const finalPreSortLookups = await buildFreshLookups();

            for (const folder of foldersToSort) {
                const parentId = folder.chromeId;
                const expectedSyncIdsList = folder.expectedChildrenSyncIds;

                const parentNode = finalPreSortLookups.nodeByChromeId.get(parentId);
                const currentChromeChildren = (parentNode && Array.isArray(parentNode.children)) ? parentNode.children : [];

                const simulatedList = currentChromeChildren.map(c => {
                    const cid = String(c.id);
                    return {
                        chromeId: cid,
                        syncId: chromeIdToSyncId.get(cid) || ''
                    };
                });

                for (let i = 0; i < expectedSyncIdsList.length; i++) {
                    const targetSyncId = expectedSyncIdsList[i];
                    const targetChromeId = syncIdToChromeId.get(targetSyncId);
                    if (!targetChromeId) continue;

                    const currentItem = simulatedList[i];
                    if (currentItem && currentItem.chromeId === targetChromeId) {
                        continue;
                    }

                    const currentIndex = simulatedList.findIndex(item => item.chromeId === targetChromeId);
                    if (currentIndex < 0) {
                        simulatedList.splice(i, 0, { chromeId: targetChromeId, syncId: targetSyncId });
                    } else {
                        const [movedItem] = simulatedList.splice(currentIndex, 1);
                        simulatedList.splice(i, 0, movedItem);
                    }

                    try {
                        await new Promise((resolve) => {
                            try {
                                chrome.bookmarks.move(
                                    targetChromeId,
                                    { parentId, index: i },
                                    () => {
                                        const err = chrome.runtime && chrome.runtime.lastError ? String(chrome.runtime.lastError.message) : '';
                                        resolve();
                                    }
                                );
                            } catch (_) { resolve(); }
                        });
                    } catch (_) {}
                }
            }

            // 4) Rebuild identityMap. §3.3: only include syncIds that come from the import package.
            const nextIdentityMap = [];
            const seenSyncIds = new Set();
            const pushEntry = (syncId, chromeId) => {
                if (!syncId || !chromeId) return;
                if (seenSyncIds.has(syncId)) return;
                seenSyncIds.add(syncId);
                const out = { id: String(chromeId), syncId };
                const extras = importExtrasBySyncId.get(syncId);
                if (extras) Object.assign(out, extras);
                nextIdentityMap.push(out);
            };
            // root/top-roots first so their syncId is the canonical one.
            if (importRootSyncId) pushEntry(importRootSyncId, '0');
            importTopSyncIdToChromeId.forEach((chromeId, syncId) => pushEntry(syncId, chromeId));
            importNormalSyncIds.forEach((syncId) => {
                const chromeId = syncIdToChromeId.get(syncId);
                if (chromeId) pushEntry(syncId, chromeId);
            });

            const freshFinal = await buildFreshLookups();

            // doc 最终修复计划 §3.8 + 第三轮 §2.2/§2.3: validate before write via bridge,
            // 并把 fresh tree 中 managed 等不可写根的 chromeId 列入 ignoredChromeIds。
            const ignoredChromeIdsFinal = (typeof bridge.collectIgnoredChromeIdsFromFreshTree === 'function')
                ? bridge.collectIgnoredChromeIdsFromFreshTree(freshFinal.root)
                : new Set();
            const validation = bridge.validateImportedIdentityMapAgainstTree(
                freshFinal.root, nextIdentityMap, expectedSyncIds, { ignoredChromeIds: ignoredChromeIdsFinal }
            );
            if (!validation.ok) {
                throw new Error('[Incremental Import] identityMap validation failed: ' + validation.errors.slice(0, 5).join('; '));
            }

            await bridge.writePermanentTreeSnapshotAfterChromeApply([freshFinal.root], {
                skipIdentityMapHeal: true,
                baseContent: {
                    ...(localContent || {}),
                    identityMap: nextIdentityMap
                }
            });
        } catch (incErr) {
            try { console.warn('[Incremental Import] Error encountered, falling back to Overwrite:', incErr); } catch (_) {}
            runOverwrite = true;
        }
    }
    if (runOverwrite) {
        await executeOverwriteBranch();
    }

        // 5. Overwrite non-Chrome state directly (temp sections, mdNodes, edges, canvas state, copies).
        try {
            await __applyOverwriteImportedCanvasState(parsedTempState, bridge, parsedStorage, {
                deferRuntimeApply,
                willReloadAfterImport: deferRuntimeApply
            });
            for (const key of Object.keys(parsedStorage || {})) {
                if (typeof key !== 'string') continue;
                if (key.startsWith('bcs:perm:copy-')) {
                    await new Promise((resolve) => { try { chrome.storage.local.set({ [key]: parsedStorage[key] }, () => resolve()); } catch (_) { resolve(); } });
                }
            }
        } catch (_) {}

        success = true;
    } catch (mainErr) {
        console.error('[Overwrite Import] main flow failed:', mainErr);
        // Attempt auto-rollback from the just-written backup slot (fix plan §2.6).
        if (!skipBackupWrite) {
            try {
                if (muteSession && muteSession.active && typeof window.endBookmarkBulkMute === 'function') {
                    await window.endBookmarkBulkMute('overwrite-import-failed', { refreshTree: false });
                    muteSession = null;
                }
                const slot = await bridge.readBackupSlot();
                if (slot && slot.sandbox) {
                    const rollbackStorage = {};
                    if (slot.sandbox.permMain) rollbackStorage['bcs:perm:main'] = slot.sandbox.permMain;
                    if (slot.sandbox.canvasState) rollbackStorage['bcs:canvas'] = slot.sandbox.canvasState;
                    if (slot.sandbox.permCopies && typeof slot.sandbox.permCopies === 'object') {
                        for (const k of Object.keys(slot.sandbox.permCopies)) rollbackStorage[k] = slot.sandbox.permCopies[k];
                    }
                    await __performOverwriteImport({
                        parsedTempState: slot.sandbox.tempState,
                        parsedStorage: rollbackStorage,
                        parsedPrimaryState: null,
                        importFileName: 'rollback-from-backup',
                        threshold: 0,
                        skipBackupWrite: true
                    });
                    const msg = isEn
                        ? `Full overwrite failed; rolled back to backup. Error: ${mainErr.message}`
                        : `全量覆盖失败，已回滚到备份。错误：${mainErr.message}`;
                    try { (typeof showCanvasToast === 'function') ? showCanvasToast(msg, 'warning', 6000) : alert(msg); } catch (_) { alert(msg); }
                    return;
                }
            } catch (rollbackErr) {
                console.error('[Overwrite Import] auto-rollback failed:', rollbackErr);
            }
        }
        throw mainErr;
    } finally {
        if (muteSession && muteSession.active && typeof window.endBookmarkBulkMute === 'function') {
            await window.endBookmarkBulkMute('overwrite-import', { refreshTree: !deferRuntimeApply });
        }
    }

    if (success) {
        if (!deferRuntimeApply) {
            await refreshTagUiAfterImport();
            const msg = isEn ? 'Full overwrite complete. Undo via Backup.' : '全量覆盖完成。可通过「备份」撤销。';
            try { (typeof showCanvasToast === 'function') ? showCanvasToast(msg, 'success', 4000) : alert(msg); } catch (_) { alert(msg); }
        }
    }
}

function __normalizeCanvasImportPosition(positionInput) {
    const source = positionInput && typeof positionInput === 'object' ? positionInput : null;
    if (!source) return null;
    const left = Number(
        Object.prototype.hasOwnProperty.call(source, 'left') ? source.left : source.x
    );
    const top = Number(
        Object.prototype.hasOwnProperty.call(source, 'top') ? source.top : source.y
    );
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
}

function __resolveCanvasImportPlacement(width, height, options = {}) {
    const explicitPosition = __normalizeCanvasImportPosition(options && options.canvasPosition);
    if (explicitPosition) {
        return {
            x: explicitPosition.left,
            y: explicitPosition.top,
            needsHigherZIndex: true
        };
    }
    return findAvailablePositionInViewport(width, height);
}

function __getCanvasBookmarkImportBatchMeta(type) {
    const { isEn } = __getLang();
    const normalizedType = String(type || '').trim().toLowerCase();
    return {
        source: normalizedType === 'html' ? 'import-html-bookmarks' : 'import-json-bookmarks',
        label: isEn ? 'Import' : '导入'
    };
}

function __buildCanvasBookmarkImportBatchPlacement(type, count, options = {}) {
    const totalCount = Math.max(1, Number.parseInt(count, 10) || 1);
    const columns = Math.min(5, totalCount);
    const rows = Math.max(1, Math.ceil(totalCount / columns));
    const sectionMeta = __getCanvasBookmarkImportBatchMeta(type);
    const baseSize = getTempSectionBaseSize(sectionMeta);
    const zoom = (CanvasState && CanvasState.zoom && CanvasState.zoom > 0) ? CanvasState.zoom : 1;
    const gap = 32 / zoom;
    const totalWidth = (columns * baseSize.width) + ((columns - 1) * gap);
    const totalHeight = (rows * baseSize.height) + ((rows - 1) * gap);
    const origin = __resolveCanvasImportPlacement(totalWidth, totalHeight, options);

    return (index) => {
        const i = Math.max(0, Number.parseInt(index, 10) || 0);
        const col = i % columns;
        const row = Math.floor(i / columns);
        return {
            left: origin.x + col * (baseSize.width + gap),
            top: origin.y + row * (baseSize.height + gap)
        };
    };
}

async function __importBookmarkFilesBatch(type, filesInput, options = {}) {
    const { isEn } = __getLang();
    const files = Array.from(filesInput || []).filter(Boolean);
    if (!files.length) return { importedFiles: 0, failedFiles: 0, totalBookmarks: 0 };

    const resolvePosition = __buildCanvasBookmarkImportBatchPlacement(type, files.length, options);
    let importedFiles = 0;
    let failedFiles = 0;
    let totalBookmarks = 0;
    const importedSections = [];

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        try {
            const text = await file.text();
            const canvasPosition = resolvePosition(index);
            const result = String(type || '').toLowerCase() === 'html'
                ? await importHtmlBookmarks(text, file && file.name ? file.name : '', {
                    canvasPosition,
                    suppressToast: true,
                    suppressSave: true
                })
                : await importJsonBookmarks(text, file && file.name ? file.name : '', {
                    canvasPosition,
                    suppressToast: true,
                    suppressSave: true
                });
            if (result && result.ok) {
                importedFiles += 1;
                totalBookmarks += Number(result.count) || 0;
                if (result.section) importedSections.push(result.section);
            } else {
                failedFiles += 1;
            }
        } catch (error) {
            failedFiles += 1;
            console.error('[Canvas] 批量书签文件导入失败:', file && file.name, error);
        }
    }

    if (importedFiles > 0) {
        if (importedSections.length) {
            __saveTransferImportSectionsDelta(importedSections);
        } else {
            try { if (typeof saveTempNodes === 'function') saveTempNodes(); } catch (_) { }
        }
        showCanvasToast(
            isEn
                ? `Successfully imported ${importedFiles} files (${totalBookmarks} bookmarks)`
                : `成功导入 ${importedFiles} 个文件（${totalBookmarks} 个书签）`,
            'success'
        );
    }
    if (failedFiles > 0) {
        showCanvasToast(
            isEn
                ? `${failedFiles} files were not imported`
                : `${failedFiles} 个文件未导入`,
            importedFiles > 0 ? 'warning' : 'error'
        );
    }

    return { importedFiles, failedFiles, totalBookmarks };
}

function showImportDialog(options = {}) {
    const { isEn } = __getLang();
    const dialogOptions = (options && typeof options === 'object') ? options : {};
    const canvasPosition = __normalizeCanvasImportPosition(dialogOptions.canvasPosition);
    const titleText = String(dialogOptions.title || '').trim() || (isEn ? 'Import' : '导入');
    const importOptions = {
        canvasPosition,
        forceSnapshot: !!dialogOptions.forceSnapshot,
        trigger: dialogOptions.trigger || (canvasPosition ? 'canvas-position-import' : 'manual-import')
    };
    const existingDialog = document.getElementById('canvasImportDialog');
    if (existingDialog) existingDialog.remove();
    // 创建导入对话框
    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasImportDialog';

    const importInfoHtml = isEn
        ? `
        <div style="font-weight: 600; margin-bottom: 6px; color: var(--accent-primary, #7c3aed); font-size: 13px;">Import Instructions</div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            <strong>Canvas Snapshot (ZIP / Folder)</strong><br>
            Supports <span style="color: #f97316; font-weight: 600;">Full Overwrite Restore</span> (clearing current canvas and replacing all layout and bookmarks) or <span style="color: #f97316; font-weight: 600;">Import as Package</span> (incrementally loading as a grouped canvas section card).
        </div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            <strong>Bookmarks (HTML / JSON - can be dragged directly onto canvas)</strong><br>
            Import standard HTML browser bookmarks or exported section JSON files. Imported bookmarks will create a <span style="color: #f97316; font-weight: 600;">new temporary section</span>.
        </div>
        <div style="border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px; font-size: 11px; opacity: 0.85; line-height: 1.4;">
            💡 <strong>Import Here Tip</strong>: You can right-click any blank canvas area and select <span style="color: #f97316; font-weight: 600;">"Import Here"</span> to import files at the clicked coordinates without affecting your current canvas layout.
        </div>
        `
        : `
        <div style="font-weight: 600; margin-bottom: 6px; color: var(--accent-primary, #7c3aed); font-size: 13px;">导入功能说明</div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            <strong>画布快照 (ZIP / 文件夹)</strong><br>
            支持<span style="color: #f97316; font-weight: 600;">全量覆盖还原</span>（清空当前状态，重现快照的排版布局及所有书签数据）或<span style="color: #f97316; font-weight: 600;">快照包导入</span>（增量导入为当前画布下的一个分组卡片）。
        </div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            <strong>书签文件 (HTML / JSON - 可直接在画布中拖入)</strong><br>
            导入普通的 HTML 浏览器书签或导出的临时/永久栏目 JSON，导入后将创建为一块<span style="color: #f97316; font-weight: 600;">新的临时栏目</span>。
        </div>
        <div style="border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px; font-size: 11px; opacity: 0.85; line-height: 1.4;">
            💡 <strong>此位置导入提示</strong>：您也可以在画布空白处右键并选择<span style="color: #f97316; font-weight: 600;">「此位置导入」</span>，即可在鼠标指定的坐标处导入书签文件，以防意外破坏您当前的画布布局。
        </div>
        `;

    dialog.innerHTML = `
        <div class="import-dialog-content" style="max-width: 400px; position: relative;">
            <div class="import-dialog-header">
                <h3 style="display: flex; align-items: center; justify-content: flex-start; margin: 0; width: 100%;">
                    <span>${titleText}</span>
                    <button type="button" class="canvas-import-info-btn" id="importInfoBtn" style="background: none; border: none; padding: 0 4px; color: var(--text-secondary); opacity: 0.8; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; line-height: 1; vertical-align: middle; margin-top: 1.5px;" title="${isEn ? 'View explanation' : '查看说明'}">
                        <i class="fas fa-info-circle" style="font-size: 14px;"></i>
                    </button>
                </h3>
                <button class="import-dialog-close" id="closeImportDialog">&times;</button>
            </div>
            <!-- Popover -->
            <div id="importInfoPopover" style="display: none; position: absolute; left: 16px; top: 52px; right: 16px; background: var(--bg-elevated, #ffffff); border: 1px solid var(--accent-primary, #7c3aed); border-radius: 8px; padding: 12px; box-shadow: var(--shadow-lg, 0 6px 16px rgba(0,0,0,0.15)); z-index: 1000; font-size: 12px; line-height: 1.5; color: var(--text-primary); text-align: left;">
                ${importInfoHtml}
            </div>
            <div class="import-dialog-body">
                <div class="import-options">
                    <div class="import-section-label-large">${isEn ? 'Canvas Snapshot' : '画布快照'}</div>
                    <div class="import-row import-row-2cols">
                        <button class="import-option-btn-compact" id="importCanvasFolderBtn" title="${isEn ? 'Import Folder' : '导入文件夹快照'}">
                            <i class="fas fa-folder-open"></i>
                            <span>${isEn ? 'Folder' : '文件夹'}</span>
                        </button>
                        <button class="import-option-btn-compact" id="importCanvasZipBtn" title="${isEn ? 'Import Archive (.zip / .7z)' : '导入压缩包 (.zip / .7z)'}">
                            <i class="fas fa-file-archive"></i>
                            <span>${isEn ? 'Archive' : '压缩包'}</span>
                        </button>
                    </div>
                    <div class="import-section-label-large" style="margin-top: 12px;">${isEn ? 'Bookmarks (can be dragged directly onto canvas)' : '书签文件（可直接在画布中拖入）'}</div>
                    <div class="import-row import-row-2cols">
                        <button class="import-option-btn-compact" id="importHtmlBtn" title="${isEn ? 'Import HTML Bookmarks' : '导入 HTML 书签'}">
                            <i class="fas fa-code"></i>
                            <span>${isEn ? 'HTML' : 'HTML 书签'}</span>
                        </button>
                        <button class="import-option-btn-compact" id="importJsonBtn" title="${isEn ? 'Import JSON Bookmarks / Temp Section JSON' : '导入 JSON 书签 / 临时栏目 JSON'}">
                            <i class="fas fa-file-alt"></i>
                            <span>${isEn ? 'JSON' : 'JSON 书签/临时'}</span>
                        </button>
                    </div>
                </div>
                <input type="file" id="canvasFileInput" accept=".zip,.7z,.html,.json" style="display: none;">
                <input type="file" id="canvasFolderInput" webkitdirectory directory style="display: none;">
            </div>
        </div>
    `;

    getOverlayContainer().appendChild(dialog);

    // 事件监听
    const importInfoBtn = dialog.querySelector('#importInfoBtn');
    const importInfoPopover = dialog.querySelector('#importInfoPopover');
    if (importInfoBtn && importInfoPopover) {
        importInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const visible = importInfoPopover.style.display === 'block';
            importInfoPopover.style.display = visible ? 'none' : 'block';
        });
    }

    document.getElementById('closeImportDialog').addEventListener('click', () => {
        dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            dialog.remove();
            return;
        }
        if (importInfoPopover && importInfoPopover.style.display === 'block' && !e.target.closest('#importInfoPopover') && !e.target.closest('#importInfoBtn')) {
            importInfoPopover.style.display = 'none';
        }
    });

    document.getElementById('importCanvasZipBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        // 支持 ZIP 和 7z 压缩包
        input.accept = '.zip,.7z';
        input.multiple = false;
        input.dataset.type = 'package-archive';
        input.__canvasImportOptions = importOptions;
        input.click();
    });

    // 文件夹导入按钮
    document.getElementById('importCanvasFolderBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFolderInput');
        input.__canvasImportOptions = importOptions;
        input.click();
    });

    document.getElementById('importHtmlBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.html';
        input.multiple = true;
        input.dataset.type = 'html';
        input.__canvasImportOptions = importOptions;
        input.click();
    });

    document.getElementById('importJsonBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.json';
        input.multiple = true;
        input.dataset.type = 'json';
        input.__canvasImportOptions = importOptions;
        input.click();
    });

    document.getElementById('canvasFileInput').addEventListener('change', handleFileImport);
    document.getElementById('canvasFolderInput').addEventListener('change', handleFolderImport);
}


function __collectCanvasTempStateForExport() {
    return __buildCanvasTempStateProtocolView({
        sections: Array.isArray(CanvasState.tempSections) ? CanvasState.tempSections : [],
        tempSectionCounter: CanvasState.tempSectionCounter,
        tempItemCounter: CanvasState.tempItemCounter,
        colorCursor: CanvasState.colorCursor,
        tempSectionLastColor: CanvasState.tempSectionLastColor || getTempSectionDefaultColor(),
        tempSectionPrevColor: CanvasState.tempSectionPrevColor || null,
        mdNodes: Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes : [],
        mdNodeCounter: CanvasState.mdNodeCounter,
        edges: Array.isArray(CanvasState.edges) ? CanvasState.edges : [],
        edgeCounter: CanvasState.edgeCounter,
        timestamp: Date.now()
    }, {
        preserveRaw: true,
        skipValidation: true
    });
}

async function handleFileImport(e) {
    const files = Array.from((e.target && e.target.files) || []);
    const file = files[0];
    if (!file) return;

    const type = e.target.dataset.type;
    const importOptions = (e.target && e.target.__canvasImportOptions && typeof e.target.__canvasImportOptions === 'object')
        ? e.target.__canvasImportOptions
        : {};
    const canvasPosition = __normalizeCanvasImportPosition(importOptions.canvasPosition);
    const forceSnapshotImport = !!importOptions.forceSnapshot;

    try {
        if (type === 'package-archive') {
            let parsedTempState = null;
            let parsedStorage = null;
            let parsedPrimaryState = {};

            const parsed = await parseCanvasPackageFromZipFile(file);
            parsedTempState = parsed.tempState;
            parsedStorage = parsed.storage;
            parsedPrimaryState = parsed.primaryState;

            if (forceSnapshotImport) {
                __setCanvasImportRuntimeMode('permanent');
                await __processImportedPackage(parsedTempState, parsedStorage, parsedPrimaryState, file.name, {
                    source: 'zip',
                    trigger: importOptions.trigger || 'canvas-position-import',
                    canvasPosition
                }, {
                    deferRuntimeRender: true,
                    willReloadAfterImport: true
                });
                const activeDialog = document.getElementById('canvasImportDialog');
                if (activeDialog) activeDialog.remove();
                e.target.value = '';
                e.target.__canvasImportOptions = null;
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
                return;
            }

            const previewData = __buildImportPreviewDataFromTempState(parsedTempState, {
                sourceLabel: file && file.name ? file.name : '',
                fullStorage: parsedStorage
            });

            const modeResult = await showImportModeConfirmDialog({
                defaultMode: 'permanent',
                sourceLabel: file && file.name ? file.name : '',
                previewData
            });
            const mode = (modeResult && typeof modeResult === 'object') ? modeResult.mode : modeResult;
            const overwriteThreshold = (modeResult && typeof modeResult === 'object') ? modeResult.threshold : null;
            if (!mode) {
                e.target.value = '';
                return;
            }
            if (mode === 'overwrite') {
                try {
                    const overwriteParsed = await parseCanvasPackageFromZipFile(file, { importMode: 'overwrite' });
                    await __performOverwriteImport({
                        parsedTempState: overwriteParsed.tempState,
                        parsedStorage: overwriteParsed.storage,
                        parsedPrimaryState: overwriteParsed.primaryState || parsedPrimaryState,
                        importFileName: file && file.name ? file.name : '',
                        // doc 第三轮修复 §2.4: 与 __performOverwriteImport 入口的 Number.isFinite 语义对齐，
                        // 避免 0 被静默吞成 300（未来 dialog 若放开 0=强制覆盖时也不会被劫持）。
                        threshold: Number.isFinite(overwriteThreshold) ? overwriteThreshold : 500,
                        deferRuntimeApply: true,
                        willReloadAfterImport: true
                    });
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                } catch (err) {
                    console.error('[Overwrite Import] failed:', err);
                    alert(isEn ? `Full overwrite failed: ${err.message}` : `全量覆盖失败：${err.message}`);
                }
                return;
            }
            __setCanvasImportRuntimeMode(mode);

            await __processImportedPackage(parsedTempState, parsedStorage, parsedPrimaryState, file.name, {
                source: type === 'package-archive' ? 'zip' : 'json',
                trigger: canvasPosition ? 'canvas-position-import' : 'manual-file-import',
                canvasPosition
            }, {
                deferRuntimeRender: true,
                willReloadAfterImport: true
            });
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else if (type === 'html' || type === 'json') {
            if (files.length > 1) {
                await __importBookmarkFilesBatch(type, files, {
                    canvasPosition
                });
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                const text = await file.text();
                if (type === 'html') {
                    await importHtmlBookmarks(text, file && file.name ? file.name : '', {
                        canvasPosition
                    });
                } else {
                    await importJsonBookmarks(text, file && file.name ? file.name : '', {
                        canvasPosition
                    });
                }
            }
        }

        const activeDialog = document.getElementById('canvasImportDialog');
        if (activeDialog) activeDialog.remove();
        // 成功提示已在各导入函数中显示，这里不再重复
    } catch (error) {
        console.error('[Canvas] 导入失败:', error);
        const { isEn } = __getLang();
        showCanvasToast((isEn ? 'Import failed: ' : '导入失败: ') + (error && error.message ? error.message : error), 'error');
    }

    e.target.value = '';
    e.target.__canvasImportOptions = null;
}

/**
 * 处理文件夹导入
 * 支持导入已解压的画布快照文件夹
 */
async function handleFolderImport(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const { isEn } = __getLang();
    const importOptions = (e.target && e.target.__canvasImportOptions && typeof e.target.__canvasImportOptions === 'object')
        ? e.target.__canvasImportOptions
        : {};
    const canvasPosition = __normalizeCanvasImportPosition(importOptions.canvasPosition);
    const forceSnapshotImport = !!importOptions.forceSnapshot;

    try {

        // 将文件列表转换为 Map<相对路径, 内容>
        const folderName = files[0].webkitRelativePath.split('/')[0];
        const folderFiles = new Map();

        for (const file of files) {
            // 获取相对路径（去掉根文件夹名）
            const relativePath = file.webkitRelativePath;
            const content = new Uint8Array(await file.arrayBuffer());
            folderFiles.set(relativePath, content);
        }

        const parsed = await parseCanvasPackageFromFolderFiles(folderFiles, folderName);
        if (forceSnapshotImport) {
            __setCanvasImportRuntimeMode('permanent');
            await __processImportedPackage(parsed.tempState, parsed.storage, parsed.primaryState, folderName, {
                source: 'folder',
                trigger: importOptions.trigger || 'canvas-position-import',
                canvasPosition
            }, {
                deferRuntimeRender: true,
                willReloadAfterImport: true
            });
            const activeDialog = document.getElementById('canvasImportDialog');
            if (activeDialog) activeDialog.remove();
            e.target.value = '';
            e.target.__canvasImportOptions = null;
            setTimeout(() => {
                window.location.reload();
            }, 1500);
            return;
        }

        const previewData = __buildImportPreviewDataFromTempState(parsed.tempState, {
            sourceLabel: folderName,
            fullStorage: parsed.storage
        });

        const modeResult = await showImportModeConfirmDialog({
            defaultMode: 'permanent',
            sourceLabel: folderName,
            previewData
        });
        const mode = (modeResult && typeof modeResult === 'object') ? modeResult.mode : modeResult;
        const overwriteThreshold = (modeResult && typeof modeResult === 'object') ? modeResult.threshold : null;
        if (!mode) {
            e.target.value = '';
            return;
        }
        if (mode === 'overwrite') {
            try {
                const overwriteParsed = await parseCanvasPackageFromFolderFiles(folderFiles, folderName, { importMode: 'overwrite' });
                await __performOverwriteImport({
                    parsedTempState: overwriteParsed.tempState,
                    parsedStorage: overwriteParsed.storage,
                    parsedPrimaryState: overwriteParsed.primaryState || parsed.primaryState,
                    importFileName: folderName,
                    // doc 第三轮修复 §2.4: 同上，使用 Number.isFinite 而非 ||。
                    threshold: Number.isFinite(overwriteThreshold) ? overwriteThreshold : 300,
                    deferRuntimeApply: true,
                    willReloadAfterImport: true
                });
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } catch (err) {
                console.error('[Overwrite Import] failed:', err);
                alert(isEn ? `Full overwrite failed: ${err.message}` : `全量覆盖失败：${err.message}`);
            }
            return;
        }
        __setCanvasImportRuntimeMode(mode);

        await __processImportedPackage(parsed.tempState, parsed.storage, parsed.primaryState, folderName, {
            source: 'folder',
            trigger: canvasPosition ? 'canvas-position-import' : 'manual-folder-import',
            canvasPosition
        }, {
            deferRuntimeRender: true,
            willReloadAfterImport: true
        });

        const activeDialog = document.getElementById('canvasImportDialog');
        if (activeDialog) activeDialog.remove();
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (error) {
        console.error('[Canvas] 文件夹导入失败:', error);
        showCanvasToast((isEn ? 'Import failed: ' : '导入失败: ') + (error && error.message ? error.message : error), 'error');
    }

    e.target.value = '';
    e.target.__canvasImportOptions = null;
}

/**
 * 导入 HTML 书签文件（支持 Netscape Bookmark 格式及通用 HTML）
 * 
 * 支持的格式：
 * 1. Netscape Bookmark 格式（<!DOCTYPE NETSCAPE-Bookmark-file-1>）
 *    - Chrome、Firefox、Edge、Safari 等浏览器导出的标准格式
 *    - 保留完整的文件夹层级结构
 *    - 解析 <DL>/<DT>/<H3>/<A> 标签
 * 2. 通用 HTML 格式
 *    - 任何包含 <a href> 链接的 HTML 文件
 *    - 扁平化提取所有链接
 */
async function importHtmlBookmarks(html, importFileName = '', options = {}) {
    const { isEn } = __getLang();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 检测是否为 Netscape Bookmark 格式（通过 DOCTYPE 或结构特征）
    const isNetscapeFormat = html.includes('NETSCAPE-Bookmark-file-1') ||
        html.includes('<!DOCTYPE NETSCAPE-Bookmark-file') ||
        (doc.querySelector('dl') && doc.querySelector('dt'));

    let items = [];
    let totalCount = 0;

    if (isNetscapeFormat) {
        // 使用 Netscape 格式解析器，保留层级结构
        const result = parseNetscapeBookmarkHtml(doc);
        items = result.items;
        totalCount = result.totalCount;
    } else {
        // 回退到简单的链接提取模式
        const links = doc.querySelectorAll('a[href]');
        if (links && links.length > 0) {
            items = Array.from(links).map(link => ({
                title: (link.textContent || '').trim() || link.href,
                url: link.href,
                type: 'bookmark',
                children: []
            }));
            totalCount = items.length;
        }
    }

    if (!items || items.length === 0) {
        if (!(options && options.suppressToast)) {
            showCanvasToast(isEn ? 'No valid bookmark links found.' : '未找到有效的书签链接', 'error');
        }
        return { ok: false, count: 0, section: null };
    }

    // 创建一个新的临时栏目容器
    // 在当前视口中找一个空白位置
    const sectionMeta = { source: 'import-html-bookmarks', label: isEn ? 'Import' : '导入' };
    const baseSize = getTempSectionBaseSize(sectionMeta);
    const position = __resolveCanvasImportPlacement(baseSize.width, baseSize.height, options);
    const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;
    const sectionId = allocateTempSectionId({
        label: sectionMeta.label,
        sequenceNumber,
        source: sectionMeta.source
    });
    const fileNameTitle = String(importFileName || '').replace(/[\r\n]/g, ' ').trim();
    const section = {
        id: sectionId,
        title: fileNameTitle || (isEn
            ? `Imported Bookmarks (${totalCount}) - ${formatTimestampForTitle()}`
            : `导入的书签 (${totalCount}) - ${formatTimestampForTitle()}`),
        color: getTempSectionDefaultColor(sectionMeta),
        colorLocked: __getDefaultTempColorLockedState(),
        x: position.x,
        y: position.y,
        width: baseSize.width,
        height: baseSize.height,
        source: sectionMeta.source,
        sequenceNumber,
        label: sectionMeta.label,
        items: []
    };

    // 递归转换为临时栏目格式
    const convertToTempItem = (node) => {
        const item = {
            id: allocateTempItemId(sectionId),
            sectionId: sectionId,
            title: node.title || (node.url ? (isEn ? 'Untitled' : '未命名') : (isEn ? 'Folder' : '文件夹')),
            url: node.url || '',
            type: node.url ? 'bookmark' : 'folder',
            children: []
        };

        if (Array.isArray(node.tags) && node.tags.length) {
            item.tags = node.tags;
        }

        const note = String(node.note == null ? '' : node.note).replace(/\r\n?/g, '\n').trim();
        if (note) {
            const noteColor = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].includes(String(node.noteColor || '').trim().toLowerCase())
                ? String(node.noteColor || '').trim().toLowerCase()
                : 'orange';
            item.note = note;
            item.noteColor = noteColor;
        }

        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(convertToTempItem).filter(Boolean);
        }

        return item;
    };

    section.items = items.map(convertToTempItem).filter(Boolean);

    CanvasState.tempSections.push(section);
    renderTempNode(section);
    applyTempSectionAutoSizeIfNeeded(section);

    // 如果找不到空白位置，需要将新栏目设置为更高的 z-index（覆盖在其他元素之上）
    if (position.needsHigherZIndex) {
        const nodeElement = document.getElementById(section.id);
        if (nodeElement) {
            nodeElement.style.zIndex = '500';  // 比其他栏目更高
            // 添加一个轻微的阴影效果，让用户知道这是覆盖在其他元素之上的
            nodeElement.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35)';
        }
    }

    if (!(options && options.suppressSave)) {
        __saveTransferImportSectionsDelta(section);
    }

    // 添加呼吸式闪烁效果，吸引用户注意
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        pulseBreathingEffect(nodeElement, 1500);
    }

    // 显示成功提示
    if (!(options && options.suppressToast)) {
        showCanvasToast(
            isEn ? `Successfully imported ${totalCount} bookmarks` : `成功导入 ${totalCount} 个书签`,
            'success'
        );
    }
    return { ok: true, count: totalCount, section };
}

/**
 * 解析 Netscape Bookmark HTML 格式
 * 标准结构：
 *   <DL><p>
 *     <DT><H3>文件夹名</H3>
 *     <DL><p>
 *       <DT><A HREF="...">书签名</A>
 *       ...
 *     </DL><p>
 *     <DT><A HREF="...">书签名</A>
 *   </DL><p>
 */
function parseNetscapeBookmarkHtml(doc) {
    let totalCount = 0;

    // 递归解析 DL 元素
    const parseDL = (dlElement) => {
        const items = [];
        if (!dlElement) return items;

        // 遍历 DL 的直接子元素
        const children = dlElement.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];

            // 跳过非 DT 元素（如 <p> 标签）
            if (child.tagName !== 'DT') continue;

            // 检查 DT 内部是文件夹（H3）还是书签（A）
            const h3 = child.querySelector(':scope > h3, :scope > H3');
            const anchor = child.querySelector(':scope > a, :scope > A');

            if (h3) {
                // 这是一个文件夹
                const folderTitle = (h3.textContent || '').trim() || 'Folder';

                // 查找紧随其后的 DL（文件夹内容）
                // 可能是 DT 的下一个兄弟元素，也可能在 DT 内部
                let subDL = child.querySelector(':scope > dl, :scope > DL');
                if (!subDL) {
                    // 检查下一个兄弟元素
                    let nextSibling = child.nextElementSibling;
                    while (nextSibling && nextSibling.tagName !== 'DT' && nextSibling.tagName !== 'DL') {
                        nextSibling = nextSibling.nextElementSibling;
                    }
                    if (nextSibling && (nextSibling.tagName === 'DL' || nextSibling.tagName === 'dl')) {
                        subDL = nextSibling;
                    }
                }

                const folderItem = {
                    title: folderTitle,
                    url: '',
                    type: 'folder',
                    children: subDL ? parseDL(subDL) : []
                };
                items.push(folderItem);

            } else if (anchor) {
                // 这是一个书签
                const href = anchor.getAttribute('href') || '';
                const title = (anchor.textContent || '').trim() || href;

                // 跳过无效的链接（如 javascript: 或空链接）
                if (href && !href.startsWith('javascript:') && href !== '#') {
                    const bookmarkItem = {
                        title: title,
                        url: href,
                        type: 'bookmark',
                        children: []
                    };
                    items.push(bookmarkItem);
                    totalCount++;
                }
            }
        }

        return items;
    };

    // 找到根 DL 元素
    // 通常在 <H1> 后面，或者直接是第一个 <DL>
    let rootDL = doc.querySelector('body > dl, body > DL');
    if (!rootDL) {
        // 尝试找到任何 DL
        rootDL = doc.querySelector('dl, DL');
    }

    const items = rootDL ? parseDL(rootDL) : [];

    return { items, totalCount };
}

/**
 * 导入 JSON 书签文件（支持多种格式）
 * 
 * 支持的格式：
 * 1. Chrome/Edge 内部格式：{roots: {bookmark_bar: {...}, other: {...}, synced: {...}}}
 * 2. Chrome API 格式：{id, title, url, children, dateAdded, parentId}
 * 3. Firefox 格式：{root, guid, title, uri, children, dateAdded}
 * 4. 通用数组格式：[{name/title, url/href/uri, children}, ...]
 * 5. 单对象格式：{name/title, url/href/uri, children}
 * 6. 包裹格式：{bookmarks/items/bookmarkTree: [...]}
 * 7. 第三方插件常用格式（兼容各种字段名）
 */
async function importJsonBookmarks(json, importFileName = '', options = {}) {
    const { isEn } = __getLang();
    let data;
    try {
        data = JSON.parse(json);
    } catch (e) {
        if (!(options && options.suppressToast)) {
            showCanvasToast(isEn ? 'Invalid JSON format.' : '无效的 JSON 格式', 'error');
        }
        return { ok: false, count: 0, section: null };
    }

    // Automatically unpack wrapped bookmark API response wrappers / custom envelopes
    const unpackEnvelope = (obj) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return obj;
        }
        // If it looks like a valid named node or bookmark, do not unpack it
        if ((obj.title && obj.title.trim() !== '') || obj.url) {
            return obj;
        }
        // If it is a canvas protocol layout, do not unpack
        if (obj.sectionType === 'permanent' || obj.sectionType === 'temporary') {
            return obj;
        }

        const keys = ['data', 'tree', 'bookmarkTree', 'bookmarks', 'items'];
        for (const key of keys) {
            if (obj[key] && typeof obj[key] === 'object') {
                const val = obj[key];
                if (Array.isArray(val)) {
                    if (val.length > 0 && (val[0].children || val[0].url || val[0].title)) {
                        return val;
                    }
                } else if (val.children && Array.isArray(val.children)) {
                    return val;
                } else if (val.url || val.title) {
                    return val;
                }
                // Recursively unpack nested structures
                const nested = unpackEnvelope(val);
                if (nested !== val) {
                    return nested;
                }
            }
        }
        return obj;
    };

    data = unpackEnvelope(data);

    // 统计书签总数
    let totalBookmarkCount = 0;

    const normalizeTagArrayForImport = (rawList) => {
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (bridge && typeof bridge.normalizeTagArray === 'function') {
            return bridge.normalizeTagArray(rawList);
        }
        if (!Array.isArray(rawList)) return [];
        const out = [];
        const seen = new Set();
        rawList.forEach((raw) => {
            if (!raw || typeof raw !== 'object') return;
            const color = String(raw.color || '').trim();
            if (!color) return;
            const text = String(raw.text || '').trim();
            const key = `${color.toLowerCase()}::${text}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ color, text });
        });
        return out;
    };

    const normalizeNoteInputForImport = (raw) => {
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (bridge && typeof bridge.normalizeNoteInput === 'function') {
            return bridge.normalizeNoteInput(raw);
        }
        return String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').trim();
    };

    const normalizeNoteColorForImport = (raw, fallback = 'orange') => {
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (bridge && typeof bridge.normalizeNoteColorInput === 'function') {
            return bridge.normalizeNoteColorInput(raw, fallback);
        }
        const color = String(raw || '').trim().toLowerCase();
        if (['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].includes(color)) return color;
        const fallbackColor = String(fallback || '').trim().toLowerCase();
        return ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].includes(fallbackColor)
            ? fallbackColor
            : 'orange';
    };

    const normalizeNoteMetaForImport = (noteInput, colorInput, fallbackColor = 'orange') => {
        const note = normalizeNoteInputForImport(noteInput);
        const color = normalizeNoteColorForImport(colorInput, fallbackColor);
        return note ? { note, color } : { note: '', color };
    };

    const buildPermanentMetadataMapsForImport = (identityMap) => {
        const tagsByNodeId = new Map();
        const notesByNodeId = new Map();
        if (!Array.isArray(identityMap)) return { tagsByNodeId, notesByNodeId };
        identityMap.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const nodeId = String(entry.syncId || entry.id || '').trim();
            if (!nodeId) return;
            const tags = normalizeTagArrayForImport(entry.tags);
            if (tags.length) tagsByNodeId.set(nodeId, tags);
            const noteMeta = normalizeNoteMetaForImport(entry.note, entry.noteColor);
            if (noteMeta.note) notesByNodeId.set(nodeId, noteMeta);
        });
        return { tagsByNodeId, notesByNodeId };
    };

    const resolvePermanentMetadataForImport = (node, metadataMaps) => {
        if (!node || !metadataMaps) return { tags: [], noteMeta: { note: '', color: 'orange' } };
        const nodeId = String(node.id || node.syncId || '').trim();
        const inlineTags = normalizeTagArrayForImport(node.tags);
        const mappedTags = (!inlineTags.length && nodeId && metadataMaps.tagsByNodeId instanceof Map)
            ? normalizeTagArrayForImport(metadataMaps.tagsByNodeId.get(nodeId))
            : [];
        const inlineNoteMeta = normalizeNoteMetaForImport(node.note, node.noteColor);
        const mappedNoteMeta = (!inlineNoteMeta.note && nodeId && metadataMaps.notesByNodeId instanceof Map)
            ? normalizeNoteMetaForImport(
                metadataMaps.notesByNodeId.get(nodeId) && metadataMaps.notesByNodeId.get(nodeId).note,
                metadataMaps.notesByNodeId.get(nodeId) && metadataMaps.notesByNodeId.get(nodeId).color
            )
            : { note: '', color: 'orange' };
        return {
            tags: inlineTags.length ? inlineTags : mappedTags,
            noteMeta: inlineNoteMeta.note ? inlineNoteMeta : mappedNoteMeta
        };
    };

    const isRootNode = (node) => {
        if (!node) return false;
        if (node.id === '0') return true;
        if (!node.title || node.title.trim() === '') return true;
        return false;
    };

    // 通用转换器 - 支持多种字段名
    const convert = (node, metadataMaps = null) => {
        if (!node || typeof node !== 'object') return null;

        // 获取标题：支持 title, name, label, text
        const title = node.title || node.name || node.label || node.text || '';

        // 获取 URL：支持 url, uri, href, link
        const url = node.url || node.uri || node.href || node.link || '';

        // 判断类型
        // Firefox 使用 type: "text/x-moz-place" 或 "text/x-moz-place-container"
        // Chrome 使用 type 字段或检查是否有 url
        let isFolder = false;
        if (node.type) {
            // Firefox: "text/x-moz-place-container" 是文件夹
            // Chrome: "folder" 是文件夹
            if (node.type === 'text/x-moz-place-container' ||
                node.type === 'folder' ||
                node.type === 'directory') {
                isFolder = true;
            }
        } else {
            // 没有 type 字段时：有 children 且没有 url 视为文件夹
            isFolder = !url && (node.children && Array.isArray(node.children));
        }

        // 跳过无效节点（既没有标题也没有 URL，且没有 children）
        if (!title && !url && (!node.children || node.children.length === 0)) {
            return null;
        }

        // 跳过无效的链接
        if (url && (url.startsWith('javascript:') || url === '#' || url === 'about:blank')) {
            return null;
        }

        const item = {
            title: title || (url ? (isEn ? 'Untitled' : '未命名') : (isEn ? 'Folder' : '文件夹')),
            url: url,
            type: (url && !isFolder) ? 'bookmark' : 'folder',
            children: []
        };

        if (url && !isFolder) {
            totalBookmarkCount++;
        }

        const metadata = metadataMaps
            ? resolvePermanentMetadataForImport(node, metadataMaps)
            : {
                tags: normalizeTagArrayForImport(node.tags),
                noteMeta: normalizeNoteMetaForImport(node.note, node.noteColor)
            };
        if (metadata.tags.length) {
            item.tags = metadata.tags;
        }
        if (metadata.noteMeta.note) {
            item.note = metadata.noteMeta.note;
            item.noteColor = metadata.noteMeta.color;
        }

        // 递归处理子节点
        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map((child) => convert(child, metadataMaps)).filter(Boolean);
        }

        return item;
    };

    // 转换为临时栏目格式
    const convertToTempItem = (node, sectionId) => {
        const item = {
            id: allocateTempItemId(sectionId),
            sectionId: sectionId,
            title: node.title,
            url: node.url || '',
            type: node.type,
            children: []
        };

        const tags = normalizeTagArrayForImport(node.tags);
        if (tags.length) {
            item.tags = tags;
        }

        const noteMeta = normalizeNoteMetaForImport(node.note, node.noteColor);
        if (noteMeta.note) {
            item.note = noteMeta.note;
            item.noteColor = noteMeta.color;
        }

        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(c => convertToTempItem(c, sectionId)).filter(Boolean);
        }

        return item;
    };

    let items = [];
    let tempProtocolMeta = null;
    const sectionType = String(data && data.sectionType || '').trim().toLowerCase();
    const formatType = String(data && data.format || '').trim().toLowerCase();
    const looksLikeCanvasPermanentProtocol = !!(
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && sectionType === 'permanent'
        && data.tree
        && typeof data.tree === 'object'
    );
    const looksLikeCanvasTempProtocol = !!(
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && sectionType !== 'permanent'
        && (
            sectionType === 'temporary'
            || formatType === String(__CANVAS_SECTION_JSON_FORMAT || '').toLowerCase()
            || (data.sectionMeta && typeof data.sectionMeta === 'object')
        )
    );
    let importedViaCanvasTempProtocol = false;

    // 检测并处理不同格式
    if (looksLikeCanvasPermanentProtocol) {
        ;
        const permanentMetadataMaps = buildPermanentMetadataMapsForImport(data.identityMap);
        const permanentTree = data.tree;
        const roots = permanentTree && Array.isArray(permanentTree.children)
            ? permanentTree.children
            : [permanentTree];
        roots.forEach((entry) => {
            const item = convert(entry, permanentMetadataMaps);
            if (item) items.push(item);
        });
    } else if (looksLikeCanvasTempProtocol) {
        ;
        try {
            const normalizedProtocol = __normalizeTempSectionProtocolObject(data);
            if (normalizedProtocol) {
                importedViaCanvasTempProtocol = true;
                tempProtocolMeta = (normalizedProtocol.sectionMeta && typeof normalizedProtocol.sectionMeta === 'object')
                    ? normalizedProtocol.sectionMeta
                    : {};
                items = (Array.isArray(normalizedProtocol.items) ? normalizedProtocol.items : [])
                    .map(convert)
                    .filter(Boolean);
            } else {
                // 兼容“字段不完整”的临时栏目 JSON：尽量回退到纯书签树导入，不中断流程。
                const fallbackTree = Array.isArray(data.items)
                    ? data.items
                    : (Array.isArray(data.bookmarkTree)
                        ? data.bookmarkTree
                        : ((data.bookmarkTree && typeof data.bookmarkTree === 'object')
                            ? [data.bookmarkTree]
                            : []));
                items = fallbackTree.map(convert).filter(Boolean);
            }
        } catch (protocolError) {
            console.warn('[Canvas] Temporary protocol JSON parse fallback:', protocolError);
            const fallbackTree = Array.isArray(data.items)
                ? data.items
                : (Array.isArray(data.bookmarkTree)
                    ? data.bookmarkTree
                    : ((data.bookmarkTree && typeof data.bookmarkTree === 'object')
                        ? [data.bookmarkTree]
                        : []));
            items = fallbackTree.map(convert).filter(Boolean);
        }
    } else if (data && typeof data === 'object' && (Array.isArray(data.bookmarkTree) || (data.bookmarkTree && typeof data.bookmarkTree === 'object'))) {
        // Bookmark-Backup 快照格式：{ _exportInfo, bookmarkTree: chrome.bookmarks.getTree() }
        ;
        const treeEntries = Array.isArray(data.bookmarkTree) ? data.bookmarkTree : [data.bookmarkTree];
        if (treeEntries.length === 1 && treeEntries[0] && Array.isArray(treeEntries[0].children) && !treeEntries[0].url) {
            treeEntries[0].children.forEach((entry) => {
                const item = convert(entry);
                if (item) items.push(item);
            });
        } else {
            treeEntries.forEach((entry) => {
                const item = convert(entry);
                if (item) items.push(item);
            });
        }
    } else if (data && typeof data === 'object' && Array.isArray(data.bookmarks)) {
        // 第三方常见包裹格式：{ bookmarks: [...] }
        ;
        data.bookmarks.forEach((entry) => {
            const item = convert(entry);
            if (item) items.push(item);
        });
    } else if (data && typeof data === 'object' && Array.isArray(data.items)) {
        // 第三方常见包裹格式：{ items: [...] }
        ;
        data.items.forEach((entry) => {
            const item = convert(entry);
            if (item) items.push(item);
        });
    } else if (data.roots) {
        // Chrome/Edge 内部格式：{roots: {bookmark_bar, other, synced}}
        ;
        for (const [key, root] of Object.entries(data.roots)) {
            if (root && typeof root === 'object') {
                // 跳过 sync_transaction_version 等非书签字段
                if (typeof root === 'number' || typeof root === 'string') continue;

                if (root.children && Array.isArray(root.children)) {
                    // 创建一个代表根文件夹的节点
                    const rootName = root.name || key;
                    const rootItem = {
                        title: rootName,
                        url: '',
                        type: 'folder',
                        children: root.children.map(convert).filter(Boolean)
                    };
                    if (rootItem.children.length > 0) {
                        items.push(rootItem);
                    }
                } else if (root.url) {
                    // 单个书签
                    const item = convert(root);
                    if (item) items.push(item);
                }
            }
        }
    } else if (data.root && data.guid) {
        // Firefox JSON 格式（完整备份）
        ;
        if (data.children && Array.isArray(data.children)) {
            data.children.forEach(child => {
                const item = convert(child);
                if (item) items.push(item);
            });
        }
    } else if (Array.isArray(data)) {
        // 数组格式 - 最通用的格式
        ;

        // 检查是否是 Chrome bookmarks.getTree() 的输出格式
        // 通常返回 [{id: "0", title: "", children: [...]}]
        if (data.length === 1 && data[0].children && !data[0].url && isRootNode(data[0])) {
            // 可能是 Chrome API 格式的根节点
            data[0].children.forEach(child => {
                const item = convert(child);
                if (item) items.push(item);
            });
        } else {
            data.forEach(c => {
                const item = convert(c);
                if (item) items.push(item);
            });
        }
    } else if (data.children && Array.isArray(data.children) && isRootNode(data)) {
        // 单个根节点格式（可能是 Chrome API 格式）
        ;
        data.children.forEach(child => {
            const item = convert(child);
            if (item) items.push(item);
        });
    } else {
        // 单个对象格式
        ;
        const item = convert(data);
        if (item) items.push(item);
    }

    if (items.length === 0 && !importedViaCanvasTempProtocol) {
        if (!(options && options.suppressToast)) {
            showCanvasToast(isEn ? 'No valid bookmark data found.' : '未解析到有效的书签数据', 'error');
        }
        return { ok: false, count: 0, section: null };
    }

    // 创建一个新的临时栏目容器
    // 在当前视口中找一个空白位置
    const fallbackImportLabel = isEn ? 'Import' : '导入';
    const protocolLabel = String(tempProtocolMeta && tempProtocolMeta.label || '').trim();
    const protocolSource = String(tempProtocolMeta && tempProtocolMeta.source || '').trim();
    const protocolTempKindRaw = String(tempProtocolMeta && tempProtocolMeta.tempKind || '').trim().toLowerCase();
    const protocolTempKind = (protocolTempKindRaw === 'special' || protocolTempKindRaw === 'regular')
        ? protocolTempKindRaw
        : '';
    const protocolSequenceNumber = __normalizePositiveInt(tempProtocolMeta && tempProtocolMeta.sequenceNumber);
    const sectionMeta = importedViaCanvasTempProtocol
        ? {
            source: protocolSource,
            label: protocolLabel,
            tempKind: protocolTempKind,
            sequenceNumber: protocolSequenceNumber || undefined
        }
        : {
            source: 'import-json-bookmarks',
            label: fallbackImportLabel,
            tempKind: 'special'
        };
    const baseSize = getTempSectionBaseSize(sectionMeta);
    const position = __resolveCanvasImportPlacement(baseSize.width, baseSize.height, options);
    const nextSequenceNumber = ++CanvasState.tempSectionSequenceNumber;
    const sequenceNumberForId = protocolSequenceNumber || nextSequenceNumber;
    const sectionId = allocateTempSectionId({
        label: sectionMeta.label,
        sequenceNumber: sequenceNumberForId,
        source: sectionMeta.source
    });
    const fileNameTitle = String(importFileName || '').replace(/[\r\n]/g, ' ').trim();
    const protocolTitle = String(tempProtocolMeta && tempProtocolMeta.title || '').trim();
    const fallbackImportedTitle = isEn
        ? `Imported Bookmarks (JSON, ${totalBookmarkCount}) - ${formatTimestampForTitle()}`
        : `导入的书签 (JSON, ${totalBookmarkCount}) - ${formatTimestampForTitle()}`;
    const sectionTitle = importedViaCanvasTempProtocol
        ? (protocolTitle || fileNameTitle || fallbackImportedTitle)
        : (fileNameTitle || protocolTitle || fallbackImportedTitle);
    const protocolDescriptionMd = String(
        (tempProtocolMeta && tempProtocolMeta.descriptionMd != null)
            ? tempProtocolMeta.descriptionMd
            : ''
    );
    const protocolOriginPermanent = __normalizeOriginPermanentPayload(tempProtocolMeta && tempProtocolMeta.originPermanent);
    const section = {
        id: sectionId,
        title: sectionTitle,
        color: getTempSectionDefaultColor(sectionMeta),
        colorLocked: __getDefaultTempColorLockedState(),
        x: position.x,
        y: position.y,
        width: baseSize.width,
        height: baseSize.height,
        source: sectionMeta.source,
        label: sectionMeta.label,
        tempKind: sectionMeta.tempKind,
        items: items.map(item => convertToTempItem(item, sectionId)).filter(Boolean)
    };
    if (protocolSequenceNumber) {
        section.sequenceNumber = protocolSequenceNumber;
    }
    if (protocolDescriptionMd) {
        section.descriptionMd = protocolDescriptionMd;
        section.description = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(protocolDescriptionMd));
    }
    if (protocolOriginPermanent) {
        section.originPermanent = protocolOriginPermanent;
    }

    CanvasState.tempSections.push(section);
    renderTempNode(section);
    applyTempSectionAutoSizeIfNeeded(section);

    // 如果找不到空白位置，需要将新栏目设置为更高的 z-index（覆盖在其他元素之上）
    if (position.needsHigherZIndex) {
        const nodeElement = document.getElementById(section.id);
        if (nodeElement) {
            nodeElement.style.zIndex = '500';  // 比其他栏目更高
            // 添加一个轻微的阴影效果，让用户知道这是覆盖在其他元素之上的
            nodeElement.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35)';
        }
    }

    if (!(options && options.suppressSave)) {
        __saveTransferImportSectionsDelta(section);
    }

    // 添加呼吸式闪烁效果，吸引用户注意
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        pulseBreathingEffect(nodeElement, 1500);
    }

    // 显示成功提示
    if (!(options && options.suppressToast)) {
        showCanvasToast(
            isEn ? `Successfully imported ${totalBookmarkCount} bookmarks` : `成功导入 ${totalBookmarkCount} 个书签`,
            'success'
        );
    }
    return { ok: true, count: totalBookmarkCount, section };
}

function __getCurrentFullscreenExportTarget() {
    const maximizedNode = document.querySelector('.canvas-node-maximized');
    if (!maximizedNode) return null;
    const descriptor = __serializeMaximizedNode(maximizedNode);
    if (!descriptor || typeof descriptor !== 'object') return null;
    const supportedTypes = new Set(['permanent', 'permanent-copy', 'temp-node']);
    if (!supportedTypes.has(descriptor.type)) return null;
    return descriptor;
}

function __getSingleLinePreview(text, fallback = '') {
    const normalized = String(text || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n');
    const first = normalized
        .split('\n')
        .map(line => line.trim())
        .find(line => !!line);
    return first || String(fallback || '').trim();
}

function __getFullscreenExportTargetLabel(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') return '';
    const { isEn } = __getLang();

    if (descriptor.type === 'permanent') {
        return isEn ? 'Permanent Section (#A)' : '永久栏目（#A）';
    }

    if (descriptor.type === 'permanent-copy') {
        const copyId = String(descriptor.copyId || '').trim();
        let copyTag = copyId;
        try {
            const copies = __ensurePermanentSectionCopyDisplayIndexes();
            const matchedCopy = Array.isArray(copies)
                ? copies.find((item) => item && String(item.id || '') === copyId)
                : null;
            const idx = matchedCopy ? __normalizePositiveInt(matchedCopy.displayIndex) : null;
            const alpha = idx ? toAlphaLabel(idx + 1) : '';
            if (alpha) copyTag = `#${alpha}`;
        } catch (_) { }
        return isEn
            ? `Permanent Section Copy (${copyTag || copyId || 'copy'})`
            : `永久栏目副本（${copyTag || copyId || '副本'}）`;
    }

    if (descriptor.type === 'temp-node') {
        const sectionId = String(descriptor.id || '').trim();
        const section = (CanvasState.tempSections || []).find((item) => item && item.id === sectionId);
        if (!section) return isEn ? 'Temporary Section' : '临时栏目';
        const label = getTempSectionLabel(section);
        const title = __getSingleLinePreview(section.title, (isEn ? 'Temporary Section' : '临时栏目'));
        return label ? `${label}. ${title}` : title;
    }

    if (descriptor.type === 'md-node') {
        const nodeId = String(descriptor.id || '').trim();
        const node = (CanvasState.mdNodes || []).find((item) => item && item.id === nodeId);
        if (!node) return isEn ? 'Blank Section' : '空白栏目';
        const isNativeCard = __isCanvasNativeTextNode(node);
        let title = '';
        const nodeEl = document.getElementById(nodeId);
        if (nodeEl) {
            try {
                const liveTextEl = nodeEl.querySelector('.md-canvas-editor, .md-canvas-text');
                if (liveTextEl) {
                    title = __getSingleLinePreview(liveTextEl.innerText || liveTextEl.textContent || '');
                }
            }
            catch (_) { }
        }
        if (!title) {
            title = __getSingleLinePreview(__resolveMdNodeReadableText(node));
        }
        return title || (isNativeCard ? (isEn ? 'Native Card' : '原生卡片') : (isEn ? 'Blank Section' : '空白栏目'));
    }

    return '';
}


function exportCanvas() {
    const fullscreenTarget = __getCurrentFullscreenExportTarget();
    showExportModeDialog({ fullscreenTarget });
}

function __canvasExportTimeParts() {
    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    return {
        ymd: `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`,
        hms: `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
    };
}

function __downloadCanvasZipPackage(files, zipName, downloadFolder) {
    const zipBlob = __zipStore(files);
    const zipUrl = URL.createObjectURL(zipBlob);
    if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
        chrome.downloads.download({
            url: zipUrl,
            filename: `${downloadFolder}/${zipName}`,
            saveAs: false,
            conflictAction: 'uniquify'
        }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn('[Canvas] chrome.downloads.download failed, fallback to <a> tag:', chrome.runtime.lastError);
                const a = document.createElement('a');
                a.href = zipUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
            setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
        });
        return;
    }

    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
}

function __normalizeCanvasSubsetMembers(rawMembers, options = {}) {
    const out = {
        tempIds: new Set(),
        mdIds: new Set(),
        edgeIds: new Set(),
        permanentMain: false,
        permanentCopyIds: new Set()
    };
    const addPermanentId = (rawId) => {
        const id = String(rawId || '').trim();
        if (!id) return;
        if (id === 'permanent-section' || id === 'permanentSection') {
            out.permanentMain = true;
            return;
        }
        if (id.startsWith('permanent-section-copy-')) {
            const copyId = id.slice('permanent-section-copy-'.length).trim();
            if (copyId) out.permanentCopyIds.add(copyId);
        }
    };
    const addMember = (member) => {
        if (!member || typeof member !== 'object') return;
        const type = String(member.type || '').trim();
        const data = member.data && typeof member.data === 'object' ? member.data : member;
        const id = String(member.id || (data && data.id) || '').trim();
        if (!id) return;
        if (type === 'temp-section') {
            out.tempIds.add(id);
        } else if (type === 'md-node') {
            out.mdIds.add(id);
        } else if (type === 'edge') {
            out.edgeIds.add(id);
        } else if (type === 'permanent-section') {
            addPermanentId(id);
        } else {
            const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
            if (state && (state.tempSections || []).some((section) => section && section.id === id)) out.tempIds.add(id);
            else if (state && (state.mdNodes || []).some((node) => node && node.id === id)) out.mdIds.add(id);
            else if (state && (state.edges || []).some((edge) => edge && edge.id === id)) out.edgeIds.add(id);
            else addPermanentId(id);
        }
    };

    if (options && options.includeMdId) {
        const mdId = String(options.includeMdId || '').trim();
        if (mdId) out.mdIds.add(mdId);
    }
    (Array.isArray(rawMembers) ? rawMembers : []).forEach(addMember);
    return out;
}

function __buildCanvasSubsetNodeIdSet(subset) {
    const ids = new Set();
    subset.tempIds.forEach((id) => ids.add(id));
    subset.mdIds.forEach((id) => ids.add(id));
    if (subset.permanentMain) ids.add('permanent-section');
    subset.permanentCopyIds.forEach((copyId) => {
        if (copyId) ids.add(`permanent-section-copy-${copyId}`);
    });
    return ids;
}

function __collectCanvasSubsetEdges(subset) {
    const nodeIds = __buildCanvasSubsetNodeIdSet(subset);
    return (CanvasState.edges || []).filter((edge) => {
        if (!edge || !edge.id) return false;
        const fromId = String(edge.fromNode || '').trim();
        const toId = String(edge.toNode || '').trim();
        return !!(fromId && toId && nodeIds.has(fromId) && nodeIds.has(toId));
    });
}

function __getCardGroupExportMembers(groupNode) {
    if (!groupNode || !groupNode.id) return [];
    const members = [{ type: 'md-node', id: groupNode.id, data: groupNode }];
    try {
        const api = window.__BCSCardGroup;
        if (api && typeof api.getRecursiveGeometricMembers === 'function') {
            const recursive = api.getRecursiveGeometricMembers(groupNode);
            if (Array.isArray(recursive)) members.push(...recursive);
        }
    } catch (_) { }
    return members;
}

async function __exportCanvasSubsetPackage(rawMembers, options = {}) {
    const { isEn } = __getLang();
    const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
    if (!state) {
        throw new Error(isEn ? 'Canvas state unavailable.' : '画布状态不可用。');
    }

    try { __flushMdEditorsForExport(); } catch (_) { }
    try { saveTempNodes(); } catch (_) { }
    try { savePermanentSectionPosition(); } catch (_) { }

    const subset = __normalizeCanvasSubsetMembers(rawMembers, {
        includeMdId: options && options.includeMdId
    });
    const selectedTempSections = (state.tempSections || []).filter((section) => section && subset.tempIds.has(section.id));
    const selectedMdNodes = (state.mdNodes || []).filter((node) => node && subset.mdIds.has(node.id));
    const selectedEdges = __collectCanvasSubsetEdges(subset);
    const includedNodeIds = __buildCanvasSubsetNodeIdSet(subset);

    if (!selectedTempSections.length && !selectedMdNodes.length && !subset.permanentMain && !subset.permanentCopyIds.size) {
        throw new Error(isEn ? 'Nothing to export.' : '没有可导出的对象。');
    }

    const { ymd, hms } = __canvasExportTimeParts();
    const rawLabel = String(options && options.label || '').trim();
    const labelStem = __sanitizeFilename(rawLabel || (isEn ? 'group' : '组')).replace(/[. ]+$/g, '').trim() || (isEn ? 'group' : '组');
    const exportRootBase = isEn ? `bookmark-canvas-${labelStem}` : `书签画布-${labelStem}`;
    const exportRoot = `${exportRootBase}-${ymd}-${hms}`;
    const downloadFolder = typeof getCanvasExportDownloadFolder === 'function'
        ? getCanvasExportDownloadFolder()
        : [getCanvasExportRootFolder(), getCanvasExportFolder()].filter(Boolean).join('/');
    const exportFormat = 'json';
    const files = [];
    const pushFile = (name, text) => files.push({ name, data: __toUint8(text) });

    const includePermanentFile = subset.permanentMain || subset.permanentCopyIds.size > 0;
    let permanentMdRel = '';
    let permanentCanvasPath = '';
    if (includePermanentFile) {
        let exportSandbox = null;
        try {
            const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
            if (bridge && typeof bridge.buildExportSandbox === 'function') {
                exportSandbox = await bridge.buildExportSandbox({ reason: 'subset-export' });
                if (exportSandbox && typeof bridge.processExportSandboxForExport === 'function') {
                    bridge.processExportSandboxForExport(exportSandbox);
                }
            }
        } catch (e) {
            console.warn('[Subset Export] sandbox pipeline failed:', e);
        }
        const usingSandboxPerm = !!(exportSandbox && exportSandbox.permMain);
        const permanentContent = usingSandboxPerm
            ? exportSandbox.permMain
            : await __ensurePermanentMainContentInBcs();
        if (!(permanentContent && permanentContent.tree)) {
            throw new Error(isEn ? 'Permanent JSON source unavailable.' : '永久栏目 JSON 真相源不可用。');
        }
        const permanentSyncPayload = __buildPermanentMainSyncPayload(permanentContent, {
            idsAlreadySyncIds: usingSandboxPerm
        });
        if (!permanentSyncPayload) {
            throw new Error(isEn ? 'Cannot export permanent section ids.' : '无法导出永久栏目 ID。');
        }
        permanentMdRel = __buildPermanentSectionMarkdownRelativePath(1, isEn, exportFormat);
        permanentCanvasPath = __joinObsidianExportPath(exportRoot, permanentMdRel);
        pushFile(`${exportRoot}/${permanentMdRel}`, `${__buildCanvasSectionJsonCodeBlock(permanentSyncPayload)}\n`);
    }

    const copyFileMap = {};
    const copyPathById = {};
    if (subset.permanentCopyIds.size > 0) {
        let copies = [];
        try { copies = __ensurePermanentSectionCopyDisplayIndexes(); } catch (_) { copies = []; }
        subset.permanentCopyIds.forEach((copyId) => {
            if (!copyId) return;
            const matchedCopy = Array.isArray(copies)
                ? copies.find((copy) => copy && String(copy.id || '') === copyId)
                : null;
            const idx = __normalizePositiveInt(matchedCopy && matchedCopy.displayIndex) || 1;
            const copyMdRel = __buildPermanentSectionMarkdownRelativePath(idx + 1, isEn, exportFormat);
            copyFileMap[copyId] = copyMdRel;
            copyPathById[copyId] = __joinObsidianExportPath(exportRoot, copyMdRel);
            const copyAnchorPayload = __buildPermanentCopyAnchorContentPayload(copyId, {
                displayIndex: idx,
                inheritFrom: permanentCanvasPath
                    || __joinObsidianExportPath(exportRoot, __buildPermanentSectionMarkdownRelativePath(1, isEn, exportFormat)),
                skipViewState: true
            });
            pushFile(`${exportRoot}/${copyMdRel}`, `${__buildCanvasSectionJsonCodeBlock(copyAnchorPayload)}\n`);
        });
    }

    const tempSectionPathById = {};
    const usedTempRelPaths = new Set();
    selectedTempSections.forEach((section) => {
        const seqLabel = getTempSectionLabel(section);
        const rawTitle = section.title || (isEn ? 'Temp Section' : '临时栏目');
        const fileTitle = seqLabel ? `${seqLabel} ${rawTitle}` : rawTitle;
        const safeTitle = __buildObsidianSafeFilenameStem(
            fileTitle,
            seqLabel || rawTitle || section.id || 'section',
            section.id || fileTitle
        );
        let rel = __buildTempSectionMarkdownRelativePath(section, safeTitle, isEn, exportFormat);
        if (usedTempRelPaths.has(rel)) {
            const slashIndex = rel.lastIndexOf('/');
            const relFolder = slashIndex >= 0 ? rel.slice(0, slashIndex) : '';
            const relFile = slashIndex >= 0 ? rel.slice(slashIndex + 1) : rel;
            const relStem = relFile.replace(/\.(md|json)$/i, '');
            const uniqueStem = __appendObsidianFilenameSuffix(relStem, section.id || relStem || 'section');
            rel = relFolder ? `${relFolder}/${uniqueStem}.json` : `${uniqueStem}.json`;
        }
        usedTempRelPaths.add(rel);
        tempSectionPathById[section.id] = __joinObsidianExportPath(exportRoot, rel);
        pushFile(`${exportRoot}/${rel}`, __buildTempSectionJsonMarkdown(section));
    });

    const canvasData = __buildBcsCanvasDataFromState({
        sections: selectedTempSections,
        mdNodes: selectedMdNodes,
        edges: selectedEdges
    }, {
        permanentPath: permanentCanvasPath,
        copyFileMap,
        copyPathById,
        tempSectionPathById
    });
    canvasData.nodes = (Array.isArray(canvasData.nodes) ? canvasData.nodes : [])
        .filter((node) => node && includedNodeIds.has(String(node.id || '').trim()));
    canvasData.edges = (Array.isArray(canvasData.edges) ? canvasData.edges : [])
        .filter((edge) => {
            if (!edge || !edge.id) return false;
            const fromId = String(edge.fromNode || '').trim();
            const toId = String(edge.toNode || '').trim();
            return !!(fromId && toId && includedNodeIds.has(fromId) && includedNodeIds.has(toId));
        });

    const canvasFileName = `${exportRoot}.canvas`;
    pushFile(`${exportRoot}/${canvasFileName}`, __formatObsidianCanvasJson(canvasData));

    const guideNames = __getExportGuideNamesFromStorage();
    const guide = await __buildExportGuide(
        guideNames,
        isEn,
        exportRoot,
        '',
        permanentMdRel,
        exportFormat
    );
    guideNames.forEach((name) => {
        pushFile(`${exportRoot}/${name}`, guide);
    });

    const zipName = `${exportRoot}.zip`;
    __downloadCanvasZipPackage(files, zipName, downloadFolder);
    const msg = isEn
        ? `Exported: ${zipName}`
        : `已导出：${zipName}`;
    if (typeof showCanvasToast === 'function') showCanvasToast(msg, 'success');
    else alert(msg);
}

async function exportCanvasCardGroupPackage(groupNode) {
    const { isEn } = __getLang();
    const node = groupNode && typeof groupNode === 'object' ? groupNode : null;
    if (!node || !node.id) {
        throw new Error(isEn ? 'Card group not found.' : '未找到卡片组。');
    }
    const members = __getCardGroupExportMembers(node);
    const label = String(node.label || '').trim() || (isEn ? 'card-group' : '卡片组');
    return __exportCanvasSubsetPackage(members, {
        includeMdId: node.id,
        label
    });
}

async function exportCanvasTempGroupPackage(members, options = {}) {
    const { isEn } = __getLang();
    return __exportCanvasSubsetPackage(Array.isArray(members) ? members : [], {
        label: (options && options.label) || (isEn ? 'selection' : '框选组')
    });
}

function showExportModeDialog(options = {}) {
    const { isEn } = __getLang();
    const fullscreenTarget = (options && options.fullscreenTarget && typeof options.fullscreenTarget === 'object')
        ? options.fullscreenTarget
        : null;
    const isFullscreenTarget = !!(fullscreenTarget && fullscreenTarget.type);

    const existingDialog = document.getElementById('canvasExportModeDialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasExportModeDialog';

    const dialogTitle = isEn ? 'Export' : '导出';
    const modeATitle = isFullscreenTarget
        ? (isEn ? 'HTML Bookmarks' : 'HTML 书签')
        : (isEn ? 'Obsidian Compatible' : 'Obsidian 兼容');
    const modeAHint = isFullscreenTarget
        ? (isEn ? 'Export as single HTML bookmark file' : '导出为单个 HTML 书签文件')
        : (isEn ? 'For viewing in Obsidian' : '用于 Obsidian，但需注意格式（详见说明）');
    const modeAHint2 = isFullscreenTarget
        ? ''
        : (isEn ? '(some features may differ, see README)' : '');
    const showModeBButton = isFullscreenTarget;
    const modeBTitle = isEn ? 'JSON Bookmarks' : 'JSON 书签';
    const modeBHint = isEn
        ? 'Export as single JSON bookmark file'
        : '导出为单个 JSON 书签文件';
    const fullscreenTargetLabel = isFullscreenTarget ? __getFullscreenExportTargetLabel(fullscreenTarget) : '';
    const fullscreenHintPrefix = isEn ? 'Current card:' : '当前栏目：';
    const exportSelectionInfoHtml = isEn
        ? `
        <div style="font-weight: 600; margin-bottom: 6px; color: var(--accent-primary, #7c3aed); font-size: 13px;">Export Instructions</div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            This panel performs a global export of the <span style="color: #f97316; font-weight: 600;">Canvas Snapshot</span> (packaging all card columns, lines, groups, and layouts, suitable for full restores).
        </div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            <strong>Local / Individual Export:</strong><br>
            You can also <span style="color: #f97316; font-weight: 600;">right-click directly on the canvas</span> elements to export them individually:
            <ul style="margin: 4px 0 0 14px; padding: 0; list-style-type: disc;">
                <li>Permanent columns & copies</li>
                <li>Temporary columns</li>
                <li>Card groups (nested groups / temporary box selection groups)</li>
            </ul>
        </div>
        <div style="border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px; font-size: 11px; opacity: 0.85; line-height: 1.4;">
            💡 <span style="color: #f97316; font-weight: 600;">Exporting automatically creates a backup</span>. See <button type="button" id="exportBackupJumpBtn" style="border: 0; background: transparent; padding: 0; color: #2563eb; text-decoration: underline; cursor: pointer; font: inherit;">Backup</button> for details.
        </div>
        `
        : `
        <div style="font-weight: 600; margin-bottom: 6px; color: var(--accent-primary, #7c3aed); font-size: 13px;">导出功能说明</div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            这里是全局导出<span style="color: #f97316; font-weight: 600;">「画布快照」</span>（打包全部卡片栏目、连接线、嵌套组及排版布局，适用于后续完整恢复）。
        </div>
        <div style="margin-bottom: 8px; line-height: 1.4;">
            <strong>局部元素导出：</strong><br>
            您也可以直接在<span style="color: #f97316; font-weight: 600;">画布上通过右键</span>以下元素来单独进行导出：
            <ul style="margin: 4px 0 0 14px; padding: 0; list-style-type: disc;">
                <li>永久栏目及其副本</li>
                <li>临时栏目</li>
                <li>卡片组（嵌套组 / 临时左键框选组）</li>
            </ul>
        </div>
        <div style="border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 6px; font-size: 11px; opacity: 0.85; line-height: 1.4;">
            💡 <span style="color: #f97316; font-weight: 600;">导出时会进行自动备份</span>，具体参考<button type="button" id="exportBackupJumpBtn" style="border: 0; background: transparent; padding: 0; color: #2563eb; text-decoration: underline; cursor: pointer; font: inherit;">「备份」</button>位置。
        </div>
        `;

    // AI 指南文件名选择（仅 Obsidian 包导出含 AI 指南；全屏单文件导出无此文件）
    // AGENTS.md 默认勾选（供 codex），CLAUDE.md 供 Claude Code，另可自定义名字。
    const GUIDE_NAME_PREF_KEY = 'bcs-canvas-export-guide-names';
    let guideNamePref = { choice: 'agents', customName: '' };
    try {
        const rawPref = localStorage.getItem(GUIDE_NAME_PREF_KEY);
        if (rawPref) {
            const parsed = JSON.parse(rawPref);
            if (parsed && typeof parsed === 'object') {
                let choice = parsed.choice;
                if (choice !== 'agents' && choice !== 'claude' && choice !== 'custom') {
                    // 兼容旧的多选格式
                    choice = parsed.custom ? 'custom' : (parsed.claude ? 'claude' : 'agents');
                }
                guideNamePref = {
                    choice,
                    customName: typeof parsed.customName === 'string' ? parsed.customName : ''
                };
            }
        }
    } catch (_) { }
    const __escAttr = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const guideNameTitle = isEn ? 'AI guide filename' : 'AI 指南文件名';
    const guideNameCustomLabel = isEn ? 'Custom' : '自定义';
    const guideNameCustomPlaceholder = isEn ? 'e.g. GUIDE.md' : '例如 GUIDE.md';
    const exportSelectionTitle = isEn ? 'Export option' : '导出选择';
    const guideNameBlockHtml = isFullscreenTarget ? '' : `
                <div class="canvas-export-guide-name" id="exportGuideNameBlock" style="position: relative;">
                    <div class="canvas-export-section-title" style="display: flex; align-items: center;">
                        <span>${guideNameTitle}</span>
                        <button type="button" class="canvas-export-guide-info-btn" id="guideNameInfoBtn" style="background: none; border: none; padding: 0 4px; color: var(--text-secondary); opacity: 0.8; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; line-height: 1; vertical-align: middle; margin-top: 1.75px;" title="${isEn ? 'View explanation' : '查看说明'}">
                            <i class="fas fa-info-circle" style="font-size: 14px;"></i>
                        </button>
                    </div>
                    <!-- Popover -->
                    <div id="guideNameInfoPopover" style="display: none; position: absolute; left: 16px; bottom: 100%; right: 16px; margin-bottom: 8px; background: var(--bg-elevated, #ffffff); border: 1px solid var(--accent-primary, #7c3aed); border-radius: 8px; padding: 10px 12px; box-shadow: var(--shadow-lg, 0 6px 16px rgba(0,0,0,0.15)); z-index: 100; font-size: 12px; line-height: 1.5; color: var(--text-primary);">
                        <div style="font-weight: 600; margin-bottom: 4px; color: var(--accent-primary, #7c3aed);">${isEn ? 'AI Guide Filename' : 'AI 指南文件说明'}</div>
                        <div>
                            ${isEn 
                                ? 'This file is used to provide constraints, introductions, and rules to guide AI behaviors when editing the exported package. The exports of nested Card Groups / Temporary Groups are also based on this selection.'
                                : '该文件用于提供约束、介绍及规范，以在 AI 编辑导出包时引导其行为。嵌套卡片组 / 临时组 的导出也依据这个勾选。'}
                        </div>
                    </div>
                    <label class="canvas-export-guide-name-row">
                        <input type="radio" name="guideNameChoice" value="agents" id="guideNameAgents" ${guideNamePref.choice === 'agents' ? 'checked' : ''}>
                        <span class="canvas-export-guide-name-file">AGENTS.md</span>
                        <span class="canvas-export-guide-name-tag">codex</span>
                    </label>
                    <label class="canvas-export-guide-name-row">
                        <input type="radio" name="guideNameChoice" value="claude" id="guideNameClaude" ${guideNamePref.choice === 'claude' ? 'checked' : ''}>
                        <span class="canvas-export-guide-name-file">CLAUDE.md</span>
                        <span class="canvas-export-guide-name-tag">Claude Code</span>
                    </label>
                    <label class="canvas-export-guide-name-row">
                        <input type="radio" name="guideNameChoice" value="custom" id="guideNameCustom" ${guideNamePref.choice === 'custom' ? 'checked' : ''}>
                        <span class="canvas-export-guide-name-file">${guideNameCustomLabel}</span>
                        <input type="text" id="guideNameCustomInput" class="canvas-export-guide-name-input" placeholder="${guideNameCustomPlaceholder}" value="${__escAttr(guideNamePref.customName)}" ${guideNamePref.choice === 'custom' ? '' : 'disabled'}>
                    </label>
                </div>
    `;

    dialog.innerHTML = `
        <div class="import-dialog-content canvas-export-dialog-content" style="max-width: 430px; width: 90vw; position: relative;">
            <div class="import-dialog-header" style="padding: 10px 16px;">
                <h3 style="margin-left: 4px;">${dialogTitle}</h3>
                <button class="import-dialog-close" id="closeExportModeDialog" style="margin-top: 1px;">&times;</button>
            </div>
            <div class="import-dialog-body" style="padding: 16px;">
                ${fullscreenTargetLabel ? `<div class="canvas-export-current-target">${fullscreenHintPrefix} ${fullscreenTargetLabel}</div>` : ''}
                
                <div style="position: relative;">
                    <div class="canvas-export-section-title" style="display: flex; align-items: center; margin-bottom: 6px;">
                        <span>${exportSelectionTitle}</span>
                        <button type="button" class="canvas-export-info-btn" id="exportSelectionInfoBtn" style="background: none; border: none; padding: 0 4px; color: var(--text-secondary); opacity: 0.8; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; line-height: 1; vertical-align: middle;" title="${isEn ? 'View explanation' : '查看说明'}">
                            <i class="fas fa-info-circle" style="font-size: 14px;"></i>
                        </button>
                    </div>
                    <!-- Popover -->
                    <div id="exportSelectionInfoPopover" style="display: none; position: absolute; left: 0; top: 100%; right: 0; margin-top: 4px; background: var(--bg-elevated, #ffffff); border: 1px solid var(--accent-primary, #7c3aed); border-radius: 8px; padding: 12px; box-shadow: var(--shadow-lg, 0 6px 16px rgba(0,0,0,0.15)); z-index: 1000; font-size: 12px; line-height: 1.5; color: var(--text-primary); text-align: left;">
                        ${exportSelectionInfoHtml}
                    </div>
                </div>

                <div class="import-options" style="gap: 12px;">
                    <button class="import-option-btn canvas-export-primary-option" id="exportModeA" style="padding: 14px 16px; display: flex; align-items: center;">
                        <div style="width: 32px; display: flex; justify-content: center; margin-right: 12px;">
                            <i class="${isFullscreenTarget ? 'fas fa-code' : 'fab fa-markdown'}" style="font-size: ${isFullscreenTarget ? '20px' : '22px'}; color: #7c3aed;"></i>
                        </div>
                        <div class="canvas-export-option-text">
                            <div class="canvas-export-option-title">${modeATitle}</div>
                            <div class="canvas-export-option-hint">${modeAHint}</div>
                            ${modeAHint2 ? `<div class="canvas-export-option-subhint">${modeAHint2}</div>` : ''}
                        </div>
                        <i class="fas fa-chevron-right" style="color: #ccc;"></i>
                    </button>

                    ${showModeBButton ? `
                    <button class="import-option-btn" id="exportModeB" style="padding: 14px 16px; display: flex; align-items: center;">
                        <div style="width: 32px; display: flex; justify-content: center; margin-right: 12px;">
                            <i class="fas fa-database" style="font-size: 20px; color: #059669;"></i>
                        </div>
                        <div class="canvas-export-option-text">
                            <div class="canvas-export-option-title">${modeBTitle}</div>
                            <div class="canvas-export-option-hint">${modeBHint}</div>
                        </div>
                    </button>
                    ` : ''}
                </div>
                ${guideNameBlockHtml}
            </div>
        </div>
    `;

    getOverlayContainer().appendChild(dialog);

    // ===== AI 指南文件名选择（单选）：启用自定义输入 / 持久化 / 收集 =====
    const guideNameRadios = dialog.querySelectorAll('input[name="guideNameChoice"]');
    const guideCustomRadio = document.getElementById('guideNameCustom');
    const guideCustomInput = document.getElementById('guideNameCustomInput');

    const getGuideChoice = () => {
        let val = 'agents';
        guideNameRadios.forEach((r) => { if (r.checked) val = r.value; });
        return val;
    };
    const sanitizeGuideFileName = (raw) => {
        let s = String(raw == null ? '' : raw).trim().replace(/[\\/:*?"<>|]+/g, '').trim();
        if (!s) return '';
        if (!/\.[A-Za-z0-9]+$/.test(s)) s += '.md';
        return s;
    };
    const persistGuideNamePref = () => {
        try {
            localStorage.setItem(GUIDE_NAME_PREF_KEY, JSON.stringify({
                choice: getGuideChoice(),
                customName: guideCustomInput ? guideCustomInput.value : ''
            }));
        } catch (_) { }
    };
    const syncCustomEnabled = () => {
        const isCustom = !!(guideCustomRadio && guideCustomRadio.checked);
        if (guideCustomInput) {
            guideCustomInput.disabled = !isCustom;
            if (isCustom) { try { guideCustomInput.focus(); } catch (_) { } }
        }
    };
    guideNameRadios.forEach((r) => {
        r.addEventListener('change', () => { syncCustomEnabled(); persistGuideNamePref(); });
    });
    if (guideCustomInput) guideCustomInput.addEventListener('input', persistGuideNamePref);
    // Popover Event Listeners
    const infoBtn = dialog.querySelector('#guideNameInfoBtn');
    const infoPopover = dialog.querySelector('#guideNameInfoPopover');

    if (infoBtn && infoPopover) {
        infoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const visible = infoPopover.style.display === 'block';
            infoPopover.style.display = visible ? 'none' : 'block';
        });
    }

    const exportSelectionInfoBtn = dialog.querySelector('#exportSelectionInfoBtn');
    const exportSelectionInfoPopover = dialog.querySelector('#exportSelectionInfoPopover');
    if (exportSelectionInfoBtn && exportSelectionInfoPopover) {
        exportSelectionInfoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const visible = exportSelectionInfoPopover.style.display === 'block';
            exportSelectionInfoPopover.style.display = visible ? 'none' : 'block';
        });
    }

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            dialog.remove();
            return;
        }
        if (infoPopover && infoPopover.style.display === 'block' && !e.target.closest('#guideNameInfoPopover') && !e.target.closest('#guideNameInfoBtn')) {
            infoPopover.style.display = 'none';
        }
        if (exportSelectionInfoPopover && exportSelectionInfoPopover.style.display === 'block' && !e.target.closest('#exportSelectionInfoPopover') && !e.target.closest('#exportSelectionInfoBtn')) {
            exportSelectionInfoPopover.style.display = 'none';
        }
    });

    const collectGuideNames = () => {
        if (typeof getGuideChoice !== 'function') {
            return __getExportGuideNamesFromStorage();
        }
        const choice = getGuideChoice();
        let name = 'AGENTS.md';
        if (choice === 'claude') name = 'CLAUDE.md';
        else if (choice === 'custom') {
            const guideCustomInput = document.getElementById('guideNameCustomInput');
            name = sanitizeGuideFileName(guideCustomInput && guideCustomInput.value) || 'AGENTS.md';
        }
        return [name];
    };

    document.getElementById('closeExportModeDialog').addEventListener('click', () => {
        dialog.remove();
    });

    const backupJumpBtn = document.getElementById('exportBackupJumpBtn');
    if (backupJumpBtn) {
        backupJumpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dialog.remove();
            try { showBackupDialog(); } catch (err) { console.warn(err); }
        });
    }

    document.getElementById('exportModeA').addEventListener('click', () => {
        let guideNames = ['AGENTS.md'];
        try {
            if (typeof collectGuideNames === 'function') {
                guideNames = collectGuideNames();
            }
        } catch (_) { }
        dialog.remove();
        const mode = isFullscreenTarget
            ? 'fullscreen-html'
            : 'obsidian';
        exportCanvasPackage({
            mode,
            fullscreenTarget,
            singleFile: isFullscreenTarget,
            guideNames
        }).catch((e) => {
            console.error('[Canvas] 导出失败:', e);
            const { isEn } = __getLang();
            alert((isEn ? 'Export failed: ' : '导出失败: ') + (e && e.message ? e.message : e));
        });
    });

    const modeBButton = showModeBButton ? document.getElementById('exportModeB') : null;
    if (modeBButton) {
        modeBButton.addEventListener('click', () => {
            dialog.remove();
            const mode = 'fullscreen-json';
            exportCanvasPackage({
                mode,
                fullscreenTarget,
                singleFile: isFullscreenTarget
            }).catch((e) => {
                console.error('[Canvas] 导出失败:', e);
                const { isEn } = __getLang();
                alert((isEn ? 'Export failed: ' : '导出失败: ') + (e && e.message ? e.message : e));
            });
        });
    }
}



function __getExportGuideNamesFromStorage() {
    const GUIDE_NAME_PREF_KEY = 'bcs-canvas-export-guide-names';
    let choice = 'agents';
    let customName = '';
    try {
        const rawPref = localStorage.getItem(GUIDE_NAME_PREF_KEY);
        if (rawPref) {
            const parsed = JSON.parse(rawPref);
            if (parsed && typeof parsed === 'object') {
                choice = parsed.choice;
                if (choice !== 'agents' && choice !== 'claude' && choice !== 'custom') {
                    choice = parsed.custom ? 'custom' : (parsed.claude ? 'claude' : 'agents');
                }
                customName = typeof parsed.customName === 'string' ? parsed.customName : '';
            }
        }
    } catch (_) { }

    let name = 'AGENTS.md';
    if (choice === 'claude') {
        name = 'CLAUDE.md';
    } else if (choice === 'custom') {
        const sanitizeGuideFileName = (raw) => {
            let s = String(raw == null ? '' : raw).trim().replace(/[\\/:*?"<>|]+/g, '').trim();
            if (!s) return '';
            if (!/\.[A-Za-z0-9]+$/.test(s)) s += '.md';
            return s;
        };
        name = sanitizeGuideFileName(customName) || 'AGENTS.md';
    }
    return [name];
}


async function __buildExportGuide(guideNames, isEn, exportRoot, vaultPrefix, permanentMdRel, exportFormat) {
    const finalPermanentMdRel = permanentMdRel || __buildPermanentSectionMarkdownRelativePath(1, isEn, exportFormat);
    const guidePrimaryName = guideNames[0];
    const __isAgentsGuide = guidePrimaryName === 'AGENTS.md';
    const __isClaudeGuide = guidePrimaryName === 'CLAUDE.md';
    const guideToolPrefix = __isAgentsGuide ? 'Codex ' : (__isClaudeGuide ? 'Claude Code ' : '');
    const guideSelfEn = __isAgentsGuide ? 'AGENTS.md' : (__isClaudeGuide ? 'CLAUDE.md' : 'this guide');
    const guideSelfEnCode = (__isAgentsGuide || __isClaudeGuide) ? ('`' + guideSelfEn + '`') : guideSelfEn;
    const guideRulesEn = __isAgentsGuide ? 'AGENTS.md rules' : (__isClaudeGuide ? 'CLAUDE.md rules' : "this guide's rules");
    const guideSelfZh = __isAgentsGuide ? 'AGENTS.md' : (__isClaudeGuide ? 'CLAUDE.md' : '本指南');
    const guideSelfZhCode = (__isAgentsGuide || __isClaudeGuide) ? ('`' + guideSelfZh + '`') : guideSelfZh;
    const guideRulesZh = __isAgentsGuide ? 'AGENTS.md 规则' : (__isClaudeGuide ? 'CLAUDE.md 规则' : '本指南规则');
    const exportModeLabelEn = 'JSON Mode (for AI)';
    const exportModeLabelZh = 'JSON模式（供AI）';

    let templateText = '';
    try {
        const templateUrl = chrome.runtime.getURL(isEn ? 'history_html/transfer_AI_sync/AGENTS_template/AGENTS_template_en.md' : 'history_html/transfer_AI_sync/AGENTS_template/AGENTS_template_zh.md');
        const response = await fetch(templateUrl);
        templateText = await response.text();
    } catch (err) {
        console.error('[Export Guide] failed to load template:', err);
        templateText = isEn 
            ? '# Bookmark Canvas Import/Export Rules\nTemplate load failed.' 
            : '# 书签画布导入/导出规则\n模板加载失败。';
    }

    const padEndName = guidePrimaryName.padEnd(9);
    const vaultDestEn = vaultPrefix 
        ? (vaultPrefix.split('/').slice(0, -1).join('/') || '(vault root)') 
        : '(standalone vault)';
    const vaultDestZh = vaultPrefix 
        ? (vaultPrefix.split('/').slice(0, -1).join('/') || '（vault根目录）') 
        : '（独立vault）';

    const guidePrimaryNameAlignSpaces = isEn
        ? ' '.repeat(Math.max(2, 39 - guidePrimaryName.length))
        : ' '.repeat(Math.max(2, 44 - guidePrimaryName.length));

    let body = templateText
        .replace(/{{GUIDE_PRIMARY_NAME_PAD}}/g, padEndName)
        .replace(/{{GUIDE_PRIMARY_NAME_ALIGN_SPACES}}/g, guidePrimaryNameAlignSpaces)
        .replace(/{{GUIDE_PRIMARY_NAME}}/g, guidePrimaryName)
        .replace(/{{FINAL_PERMANENT_MD_REL}}/g, finalPermanentMdRel)
        .replace(/{{PERMANENT_MD_REL_2}}/g, __buildPermanentSectionMarkdownRelativePath(2, isEn, exportFormat))
        .replace(/{{GUIDE_RULES}}/g, isEn ? guideRulesEn : guideRulesZh)
        .replace(/{{GUIDE_TOOL_PREFIX}}/g, guideToolPrefix)
        .replace(/{{GUIDE_SELF}}/g, isEn ? guideSelfEn : guideSelfZh)
        .replace(/{{GUIDE_SELF_CODE}}/g, isEn ? guideSelfEnCode : guideSelfZhCode)
        .replace(/{{EXPORT_MODE_LABEL}}/g, isEn ? exportModeLabelEn : exportModeLabelZh)
        .replace(/{{EXPORT_ROOT}}/g, exportRoot)
        .replace(/{{VAULT_DESTINATION}}/g, isEn ? vaultDestEn : vaultDestZh);

    return body;
}

async function exportCanvasPackage(options = {}) {
    const exportMode = options.mode || 'obsidian';
    const { isEn } = __getLang();
    
    // Check if options contains guideNames passed from dialog, otherwise fetch from storage
    const guideNames = (options && Array.isArray(options.guideNames) && options.guideNames.length > 0) 
        ? options.guideNames 
        : __getExportGuideNamesFromStorage();

    try { __flushMdEditorsForExport(); } catch (_) { }
    try { saveTempNodes(); } catch (_) { }
    try { savePermanentSectionPosition(); } catch (_) { }

    // Build an in-memory sandbox first, run the syncId/identityMap pipeline against the
    // clone, and persist the same processed shape into the single-slot backup. The live
    // chrome.storage.local data is not touched.
    let __exportSandbox = null;
    try {
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (bridge && typeof bridge.buildExportSandbox === 'function') {
            __exportSandbox = await bridge.buildExportSandbox({ reason: 'export' });
            if (__exportSandbox) {
                bridge.processExportSandboxForExport(__exportSandbox);
                try { await bridge.writeBackupSlotFromSandbox(__exportSandbox); } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[Export] sandbox/backup pipeline failed:', e);
    }

    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const ymd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;

    // zip 保存到浏览器默认下载目录下的统一父目录（根据语言动态选择）
    // 需求：不同日期的 zip 都归档在同一个文件夹下
    const downloadFolder = typeof getCanvasExportDownloadFolder === 'function'
        ? getCanvasExportDownloadFolder()
        : [getCanvasExportRootFolder(), getCanvasExportFolder()].filter(Boolean).join('/');
    // 默认导出文件夹名（也作为默认 zip 名与默认 .canvas 名）
    // - zh_CN: 书签画布-YYYYMMDD
    // - en: bookmark-canvas-YYYYMMDD
    const defaultExportRoot = isEn ? `bookmark-canvas-${ymd}` : `书签画布-${ymd}`;

    const files = [];
    const fullscreenTarget = (options && options.fullscreenTarget && typeof options.fullscreenTarget === 'object')
        ? options.fullscreenTarget
        : null;
    const fullscreenSingleFileMode = !!(options && options.singleFile && fullscreenTarget && fullscreenTarget.type);

    const resolveMdNodeTitle = (node) => {
        if (!node || typeof node !== 'object') return '';
        const title = String(__resolveMdNodeReadableText(node) || '').replace(/\u200B/g, '').trim();
        return title.split('\n')[0].trim();
    };

    const fallbackAnchorDownload = (url, fileName) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const downloadSingleFile = (fileName, contentString, contentType) => {
        const blob = new Blob([contentString], { type: contentType });
        const url = URL.createObjectURL(blob);

        if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
            chrome.downloads.download({
                url,
                filename: `${downloadFolder}/${fileName}`,
                saveAs: false,
                conflictAction: 'uniquify'
            }, () => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    console.warn('[Canvas] chrome.downloads.download failed, fallback to <a> tag:', chrome.runtime.lastError);
                    fallbackAnchorDownload(url, fileName);
                }
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            });
            return;
        }

        fallbackAnchorDownload(url, fileName);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    if (fullscreenSingleFileMode) {
        const descriptor = fullscreenTarget;
        const targetType = String(descriptor.type || '').trim();
        const namePrefix = isEn ? 'bookmark-canvas-fullscreen' : '书签画布-全屏';
        const getSafeName = (value, fallback) => {
            const fromValue = __sanitizeFilename(String(value || '').trim());
            if (fromValue && fromValue !== 'Untitled') return fromValue;
            return __sanitizeFilename(String(fallback || 'node'));
        };
        const buildDescriptionDataBookmark = ({ sequenceLabel, sectionTitle, descriptionHtml }) => {
            const rawHtml = String(descriptionHtml || '').trim();
            if (!rawHtml) return null;

            const escapeHtml = (value) => String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');

            const stripUnsafeScript = (value) => String(value || '')
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

            const titleParts = [];
            if (sequenceLabel) titleParts.push(String(sequenceLabel).trim());
            if (sectionTitle) titleParts.push(String(sectionTitle).trim());
            const baseTitle = titleParts.join('-') || (isEn ? 'Section' : '栏目');
            const bookmarkTitle = `${baseTitle}-${isEn ? 'Description' : '说明'}`;

            const sanitizedDescriptionHtml = stripUnsafeScript(rawHtml);
            const htmlDoc = `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(bookmarkTitle)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.65;
    background: #ffffff;
    color: #1f2937;
  }
  .desc-wrap {
    max-width: 900px;
    margin: 0 auto;
  }
  .desc-title {
    margin: 0 0 14px;
    font-size: 20px;
    font-weight: 700;
  }
  .desc-content {
    font-size: 15px;
    word-break: break-word;
  }
</style>
</head>
<body>
  <div class="desc-wrap">
    <h1 class="desc-title">${escapeHtml(bookmarkTitle)}</h1>
    <div class="desc-content">${sanitizedDescriptionHtml}</div>
  </div>
</body>
</html>`;

            const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlDoc)}`;
            return {
                title: bookmarkTitle,
                url: dataUrl,
                type: 'bookmark',
                children: []
            };
        };
        const toBookmarkNode = (node) => {
            if (!node || typeof node !== 'object') return null;
            const url = String(node.url || '').trim();
            const rawTitle = String(node.title || node.name || '').trim();
            if (url) {
                return {
                    title: rawTitle || url,
                    url,
                    type: 'bookmark',
                    children: []
                };
            }
            const childrenRaw = Array.isArray(node.children) ? node.children : [];
            return {
                title: rawTitle || (isEn ? 'Folder' : '文件夹'),
                type: 'folder',
                children: childrenRaw.map(toBookmarkNode).filter(Boolean)
            };
        };
        const buildNetscapeBookmarkHtml = (treeNodes) => {
            const escapeAttr = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const escapeText = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const renderNode = (node, depth = 1) => {
                if (!node) return '';
                const indent = '    '.repeat(depth);
                const title = escapeText(node.title || '');
                const url = String(node.url || '').trim();
                if (url) {
                    return `${indent}<DT><A HREF="${escapeAttr(url)}">${title}</A>\n`;
                }
                const children = Array.isArray(node.children) ? node.children : [];
                let html = `${indent}<DT><H3>${title}</H3>\n`;
                html += `${indent}<DL><p>\n`;
                children.forEach((child) => {
                    html += renderNode(child, depth + 1);
                });
                html += `${indent}</DL><p>\n`;
                return html;
            };

            let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
            html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
            html += '<TITLE>Bookmarks</TITLE>\n';
            html += '<H1>Bookmarks</H1>\n';
            html += '<DL><p>\n';
            (Array.isArray(treeNodes) ? treeNodes : []).forEach((node) => {
                html += renderNode(node, 1);
            });
            html += '</DL><p>\n';
            return html;
        };
        const normalizedMode = (() => {
            if (exportMode === 'fullscreen-html' || exportMode === 'fullscreen-json') {
                return exportMode;
            }
            if (exportMode === 'obsidian') return 'fullscreen-html';
            return '';
        })();

        let fileName = '';
        let contentString = '';
        let contentType = 'text/plain;charset=utf-8';
        let exportTypeLabel = '';
        let exportTitle = '';
        let exportSequence = '';
        let exportDescription = '';
        let contentNodes = [];

        if (targetType === 'permanent' || targetType === 'permanent-copy') {
            // doc 第三轮修复 §2.7: 全屏单卡导出（fullscreen-html / fullscreen-json）的输出
            // 走 `toBookmarkNode`，该函数只保留 { title, url, type, children }，会主动
            // 丢弃 node.id / node.parentId。因此 sandbox 命中（syncId 形态）与 live fallback
            // （chromeId 形态）在这里产生的最终文件**不会**夹带任一种 id，两条路径的输出
            // 字节级一致，无需再像主 payload 那样做 chromeId→syncId 转换。
            // 若将来 `toBookmarkNode` 需要保留 id，请改为统一使用
            //   `bridge.collectIgnoredChromeIdsFromFreshTree` 配合
            //   `__buildPermanentMainSyncPayload` 的 idsAlreadySyncIds 选项，以保证一致。
            const permanentContent = (__exportSandbox && __exportSandbox.permMain)
                ? __exportSandbox.permMain
                : await __ensurePermanentMainContentInBcs();
            const bookmarkTree = permanentContent && permanentContent.tree ? [permanentContent.tree] : null;
            if (!bookmarkTree) {
                alert(isEn ? 'Export failed: permanent JSON source unavailable.' : '导出失败：永久栏目 JSON 真相源不可用。');
                return;
            }
            const root = Array.isArray(bookmarkTree) ? bookmarkTree[0] : null;
            const roots = root && Array.isArray(root.children) ? root.children : [];
            contentNodes = roots.map(toBookmarkNode).filter(Boolean);

            const permanentTitleEl = document.getElementById('permanentSectionTitle');
            const permanentTitle = permanentTitleEl
                ? String(permanentTitleEl.textContent || '').trim()
                : (isEn ? 'Permanent Section' : '永久栏目');

            exportTypeLabel = isEn ? 'Permanent Section' : '永久栏目';
            exportTitle = permanentTitle || exportTypeLabel;
            exportSequence = '#A';
            try {
                exportDescription = localStorage.getItem(PERMANENT_MAIN_TIP_STORAGE_KEY) || '';
            } catch (_) {
                exportDescription = '';
            }

            if (targetType === 'permanent-copy') {
                const copyId = String(descriptor.copyId || '').trim();
                let copyTag = copyId || (isEn ? 'copy' : '副本');
                try {
                    const copies = __ensurePermanentSectionCopyDisplayIndexes();
                    const matchedCopy = Array.isArray(copies)
                        ? copies.find((item) => item && String(item.id || '') === copyId)
                        : null;
                    const idx = matchedCopy ? __normalizePositiveInt(matchedCopy.displayIndex) : null;
                    const alpha = idx ? toAlphaLabel(idx + 1) : '';
                    if (alpha) copyTag = `#${alpha}`;
                } catch (_) { }
                exportTypeLabel = isEn ? 'Permanent Section Copy' : '永久栏目副本';
                exportSequence = copyTag;
                exportTitle = `${permanentTitle || exportTypeLabel} (${copyTag})`;
                try {
                    exportDescription = localStorage.getItem(`${PERMANENT_COPY_TIP_STORAGE_PREFIX}${copyId}`) || '';
                } catch (_) {
                    exportDescription = '';
                }
            }
        } else if (targetType === 'temp-node') {
            const sectionId = String(descriptor.id || '').trim();
            const section = (CanvasState.tempSections || []).find((item) => item && item.id === sectionId);
            if (!section) {
                alert(isEn ? 'Export failed: temporary section not found.' : '导出失败：未找到当前临时栏目。');
                return;
            }
            const normalizedProtocol = __normalizeTempSectionProtocolObject(section) || __buildTempSectionProtocol(section);
            const sectionMeta = normalizedProtocol && normalizedProtocol.sectionMeta ? normalizedProtocol.sectionMeta : {};
            const exportItems = normalizedProtocol && Array.isArray(normalizedProtocol.items)
                ? normalizedProtocol.items
                : (Array.isArray(section.items) ? section.items : []);
            contentNodes = exportItems.map(toBookmarkNode).filter(Boolean);
            exportTypeLabel = isEn ? 'Temporary Section' : '临时栏目';
            exportTitle = String(sectionMeta.title || section.title || '').trim() || exportTypeLabel;
            exportSequence = String(sectionMeta.label || getTempSectionLabel(section) || '').trim();
            exportDescription = __normalizeCanvasRichHtml(
                __coerceDescriptionSourceToHtml(
                    (typeof sectionMeta.descriptionMd === 'string' && sectionMeta.descriptionMd.trim())
                        ? sectionMeta.descriptionMd
                        : __normalizeTempSectionDescriptionMarkdown(section)
                )
            );
        } else {
            alert(isEn ? 'Export failed: unsupported fullscreen card.' : '导出失败：不支持当前全屏卡片类型。');
            return;
        }

        if (targetType !== 'md-node') {
            if (normalizedMode !== 'fullscreen-html' && normalizedMode !== 'fullscreen-json') {
                alert(isEn ? 'Export failed: unsupported export mode.' : '导出失败：不支持当前导出格式。');
                return;
            }
            const payload = [];
            const descriptionBookmark = buildDescriptionDataBookmark({
                sequenceLabel: exportSequence,
                sectionTitle: exportTitle,
                descriptionHtml: exportDescription
            });
            if (descriptionBookmark) {
                payload.push(descriptionBookmark);
            }
            for (let i = 0; i < contentNodes.length; i++) {
                payload.push(contentNodes[i]);
            }
            const namePart = exportSequence ? `${exportSequence}-${exportTitle}` : (exportTitle || exportTypeLabel);

            if (normalizedMode === 'fullscreen-html') {
                contentString = buildNetscapeBookmarkHtml(payload);
                contentType = 'text/html;charset=utf-8';
                fileName = `${namePrefix}-${getSafeName(namePart, exportTypeLabel || 'section')}-${ymd}.html`;
            } else {
                contentString = JSON.stringify(payload, null, 2);
                contentType = 'application/json;charset=utf-8';
                fileName = `${namePrefix}-${getSafeName(namePart, exportTypeLabel || 'section')}-${ymd}.json`;
            }
        }

        if (!contentString || !fileName) {
            alert(isEn ? 'Export failed: unsupported fullscreen card.' : '导出失败：不支持当前全屏卡片类型。');
            return;
        }

        downloadSingleFile(fileName, contentString, contentType);

        alert(isEn
            ? `Exported: ${fileName}`
            : `已导出：${fileName}`);
        return;
    }

    // -------------------------------------------------------------------------
    // 模式 A: Obsidian 兼容模式 (ZIP Package)
    // -------------------------------------------------------------------------
    const normalizeVaultPrefix = (input) => {
        let s = String(input == null ? '' : input).trim();
        if (!s) return '';
        s = s.replace(/\\/g, '/');
        s = s.replace(/^\.\/+/, '');
        s = s.replace(/^\/+/, '');
        s = s.replace(/\/+$/, '');
        s = s.replace(/\/{2,}/g, '/');
        return s;
    };

    const promptVaultPrefixViaDialog = (defaultValue) => new Promise((resolve) => {
        const title = isEn ? 'Export: ".canvas" Internal Path' : '导出：「.canvas」内部路径';
        const isDark = (() => {
            try { return (document.documentElement.getAttribute('data-theme') || '') === 'dark'; } catch (_) { return false; }
        })();
        // Light mode: avoid pure yellow text (low contrast on white). Use a subtle highlight pill instead.
        const hl = (t) => {
            const style = isDark
                ? 'color:#fde68a;background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.35);padding:0 4px;border-radius:6px;font-weight:700;'
                : 'color:#92400e;background:rgba(245,158,11,0.22);border:1px solid rgba(245,158,11,0.38);padding:0 4px;border-radius:6px;font-weight:700;';
            return `<span style="${style}">${t}</span>`;
        };
        const arrow = '<div style="margin:8px 0; line-height:1; display:flex; justify-content:center;"><i class="fas fa-arrow-down"></i></div>';
        const contentMaxWidthPx = isEn ? 660 : 620;
        const exampleShiftPx = 14;

        const exampleFolderName = isEn
            ? `bookmark-canvas-${ymd} (example)/`
            : `书签画布-${ymd}（示例）/`;

        const intro = isEn
            ? 'Please follow the steps below to ensure Obsidian can locate the exported .json files.'
            : '请按以下流程选择位置，确保 Obsidian 能正确找到导出的 .json 文件。';

        const stepTitle = isEn
            ? `Where will you place <code>${exampleFolderName}</code> inside your Obsidian vault?`
            : `把 <code>${exampleFolderName}</code> 放入 Obsidian vault（仓库）里的哪个位置。`;

        const stepA = isEn
            ? `If you put it under an existing vault's ${hl('root')}, keep the default value and ${hl('click Confirm')}.`
            : `-若把它直接放在${hl('已有仓库的根目录')}下，请保持默认值，${hl('直接点击确认')}即可。`;

        const stepB = isEn
            ? `If you put it under an existing vault's ${hl('subfolder')}, enter the ${hl('relative path')}.`
            : `-若把它放在${hl('已有仓库的某个子文件夹')}下，请输入${hl('相对路径')}。`;

        const stepBExample = isEn
            ? `<div style="position:relative;text-align:center;">
  <span style="position:absolute;left:0;font-weight:600;">Put into:</span>
  <span style="display:inline-block; transform: translateX(${exampleShiftPx}px);"><code>Personal/Bookmarks/...</code></span>
</div>
<div style="transform: translateX(${exampleShiftPx}px);">${arrow}</div>
<div style="text-align:center;">Input: <code>Personal/Bookmarks/${defaultExportRoot}</code></div>`
            : `<div style="position:relative;text-align:center;">
  <span style="position:absolute;left:0;font-weight:600;">放入：</span>
  <span style="display:inline-block; transform: translateX(${exampleShiftPx}px);"><code>个人/书签/...</code></span>
</div>
<div style="transform: translateX(${exampleShiftPx}px);">${arrow}</div>
<div style="text-align:center;">输入框填：<code>个人/书签/${defaultExportRoot}</code> 即可</div>`;

        const inputLabel = isEn
            ? 'Enter path'
            : '请输入路径';

        const dialog = document.createElement('div');
        dialog.className = 'import-dialog';
        dialog.id = 'canvasExportVaultPrefixDialog';
        dialog.innerHTML = `
		            <div class="import-dialog-content" style="width:max-content;max-width:min(92vw, ${contentMaxWidthPx}px);box-sizing:border-box;">
			                <div class="import-dialog-header">
			                    <h3>${title}</h3>
			                    <button class="import-dialog-close" id="closeCanvasExportVaultPrefixDialog" style="transform: translateY(1px);">&times;</button>
			                </div>
	                <div class="import-dialog-body" style="padding: 18px;">
	                    <div style="margin: 0 0 6px; font-weight: 600;">${inputLabel}</div>
	                    <div style="display:flex; gap:8px; align-items:center;">
	                        <input id="canvasExportVaultPrefixInput" type="text" style="flex:1; padding: 9px 10px; border: 1px solid #d0d7de; border-radius: 8px;" />
	                        <button id="canvasExportVaultPrefixOk" class="import-option-btn" style="width:auto; padding: 9px 12px;">
	                            ${isEn ? 'OK' : '确定'}
	                        </button>
	                    </div>

                    <hr style="border:0;border-top:1px solid #e5e7eb;margin: 16px 0 12px;">

                    <div style="margin-bottom: 10px; line-height: 1.6;">
                        <div style="margin-bottom: 8px;">${intro}</div>
                        <div style="margin: 6px 0 10px; font-weight: 600;">${stepTitle}</div>
                        <div style="border-top:1px solid #e5e7eb;width:60%;margin: 6px 0 10px;"></div>
                        <div style="margin: 6px 0;">${stepA}</div>
	                        <div style="margin: 10px 0 6px;">${stepB}</div>
	                        <div style="margin: 6px 0 10px; text-align: center;">
	                            <div style="display: inline-block; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 10px; background: rgba(255, 255, 255, 0.04); line-height: 1.5; box-sizing: border-box; text-align: center; max-width: 100%;">
	                                <div style="font-weight: 600; margin: 0 0 1px; text-align: left;">${isEn ? 'Example:' : '例如：'}</div>
	                                <div style="text-align: center;">
	                                    ${stepBExample}
	                                </div>
	                            </div>
	                        </div>
                    </div>
                </div>
            </div>
        `;

        const cleanup = (val) => {
            try { dialog.remove(); } catch (_) { }
            resolve(val);
        };

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) cleanup(null);
        });

        getOverlayContainer().appendChild(dialog);

        const closeBtn = document.getElementById('closeCanvasExportVaultPrefixDialog');
        if (closeBtn) closeBtn.addEventListener('click', () => cleanup(null));

        const input = document.getElementById('canvasExportVaultPrefixInput');
        const confirm = () => {
            const val = input ? String(input.value || '').trim() : '';
            if (!val) {
                alert(isEn ? 'Path cannot be empty. Default value restored.' : '路径不能为空，已自动恢复默认值。');
                if (input) {
                    input.value = defaultValue || '';
                    try { input.focus(); input.select(); } catch (_) {}
                }
                return;
            }
            cleanup({
                path: val,
                format: 'json'
            });
        };

        if (input) {
            input.value = String(defaultValue || '');
            try { input.focus(); input.select(); } catch (_) { }
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (e.isComposing) return;
                    e.preventDefault();
                    confirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                }
            });
        }

        const okBtn = document.getElementById('canvasExportVaultPrefixOk');
        if (okBtn) okBtn.addEventListener('click', confirm);
    });

    // 让用户决定"导出文件夹在 vault 内的相对位置"，以适配：
    // - vault 根目录下（默认）：bookmark-canvas-export/...
    // - vault 的子文件夹下：SomeFolder/bookmark-canvas-export/...

    let vaultPrefixInput;
    let exportFormat = 'json';

    const result = await promptVaultPrefixViaDialog(defaultExportRoot);
    if (result === null) {
        return;
    }
    vaultPrefixInput = result.path;
    exportFormat = result.format || 'json';

    const vaultPrefix = normalizeVaultPrefix(vaultPrefixInput);
    exportFormat = __normalizeCanvasObsidianExportFormat(exportFormat, 'json');

    const isValidFolderPath = (p) => {
        if (!p) return true;
        const segs = String(p).split('/');
        for (const seg of segs) {
            if (!seg || seg === '.' || seg === '..') return false;
            if (/[<>:"\\|?*\x00-\x1F]/.test(seg)) return false;
            if (/[. ]$/.test(seg)) return false;
        }
        return true;
    };

    if (vaultPrefix && !isValidFolderPath(vaultPrefix)) {
        alert(isEn ? 'Invalid folder path. Please use a valid folder name.' : '路径不合法，请使用合法的文件夹命名。');
        return;
    }

    const exportRoot = vaultPrefix ? vaultPrefix.split('/').slice(-1)[0] : defaultExportRoot;

    // 1) JSON section files
    // doc 最终修复计划 §3.5: sandbox 路径与 live fallback 路径必须显式区分。
    const __usingSandboxPerm = !!(__exportSandbox && __exportSandbox.permMain);
    const permanentContent = __usingSandboxPerm
        ? __exportSandbox.permMain
        : await __ensurePermanentMainContentInBcs();
    if (!(permanentContent && permanentContent.tree)) {
        alert(isEn ? 'Export failed: permanent JSON source unavailable.' : '导出失败：永久栏目 JSON 真相源不可用。');
        return;
    }
    const permanentSyncPayload = __buildPermanentMainSyncPayload(permanentContent, {
        idsAlreadySyncIds: __usingSandboxPerm
    });
    if (!permanentSyncPayload) {
        alert(isEn
            ? 'Export aborted: cannot map all bookmark ids to syncIds (sandbox unavailable). Please retry.'
            : '导出已中止：无法将所有 chromeId 映射到 syncId（沙盒不可用）。请重试。');
        return;
    }
    const permanentMdRel = __buildPermanentSectionMarkdownRelativePath(1, isEn, exportFormat);

    files.push({
        name: `${exportRoot}/${permanentMdRel}`,
        data: __toUint8(`${__buildCanvasSectionJsonCodeBlock(permanentSyncPayload)}\n`)
    });

    // Generate separate MD files for Permanent Section Copies (with their own descriptions)
    const copyFileMap = {}; // copyId -> relativePath
    try {
        const copies = __ensurePermanentSectionCopyDisplayIndexes();
        if (Array.isArray(copies)) {
            copies.forEach(copy => {
                const copyId = copy.id;
                // idx is 1-based (Copy 1, Copy 2...)
                // Current naming logic: Main=#A (implicit). Copy 1 (#B), Copy 2 (#C)...
                // toAlphaLabel(2) -> 'B'
                const idx = __normalizePositiveInt(copy.displayIndex);
                if (!copyId) return;

                const copyMdRel = __buildPermanentSectionMarkdownRelativePath(idx + 1, isEn, exportFormat);
                copyFileMap[copyId] = copyMdRel;

                const copyAnchorPayload = __buildPermanentCopyAnchorContentPayload(copyId, {
                    displayIndex: idx,
                    inheritFrom: __joinObsidianExportPath(exportRoot, permanentMdRel),
                    skipViewState: true
                });
                const fileContent = `${__buildCanvasSectionJsonCodeBlock(copyAnchorPayload)}\n`;
                files.push({ name: `${exportRoot}/${copyMdRel}`, data: __toUint8(fileContent) });
            });
        }
    } catch (_) { }

    const tempSectionMdPaths = [];
    const usedTempRelPaths = new Set();
    CanvasState.tempSections.forEach((section) => {
        if (!section || !section.id) return;

        const seqLabel = getTempSectionLabel(section);
        const rawTitle = section.title || (isEn ? 'Temp Section' : '临时栏目');
        const fileTitle = seqLabel ? `${seqLabel} ${rawTitle}` : rawTitle;
        const safeTitle = __buildObsidianSafeFilenameStem(
            fileTitle,
            seqLabel || rawTitle || section.id || 'section',
            section.id || fileTitle
        );

        let rel = __buildTempSectionMarkdownRelativePath(section, safeTitle, isEn, exportFormat);
        if (usedTempRelPaths.has(rel)) {
            const slashIndex = rel.lastIndexOf('/');
            const relFolder = slashIndex >= 0 ? rel.slice(0, slashIndex) : '';
            const relFile = slashIndex >= 0 ? rel.slice(slashIndex + 1) : rel;
            const relStem = relFile.replace(/\.(md|json)$/i, '');
            const relExt = /\.json$/i.test(relFile) ? 'json' : 'md';
            const uniqueStem = __appendObsidianFilenameSuffix(relStem, section.id || relStem || 'section');
            const uniqueFile = `${uniqueStem}.${relExt}`;
            rel = relFolder ? `${relFolder}/${uniqueFile}` : uniqueFile;
        }
        usedTempRelPaths.add(rel);

        tempSectionMdPaths.push({ id: section.id, rel });

        files.push({ name: `${exportRoot}/${rel}`, data: __toUint8(__buildTempSectionJsonMarkdown(section)) });
    });

    const buildCanvasData = ({ vaultRelativePrefix }) => {
        // Obsidian Canvas 的 file 节点保存的是 vault-relative path（相对 vault 根目录的路径）。
        // 因此若用户把导出文件夹放在 vault 的子目录中，需要把该子目录前缀写进 file 字段。
        const prefix = normalizeVaultPrefix(vaultRelativePrefix);
        const withPrefix = (relPath) => {
            const rel = String(relPath || '').replace(/^\/+/, '');
            return prefix ? `${prefix}/${rel}` : rel;
        };
        const tempSectionPathById = {};
        tempSectionMdPaths.forEach(({ id, rel }) => {
            if (!id) return;
            tempSectionPathById[id] = withPrefix(rel);
        });
        const copyPathById = {};
        Object.keys(copyFileMap || {}).forEach((copyId) => {
            if (!copyId) return;
            copyPathById[copyId] = withPrefix(copyFileMap[copyId]);
        });
        return __buildBcsCanvasDataFromState({
            sections: CanvasState.tempSections,
            mdNodes: CanvasState.mdNodes,
            edges: CanvasState.edges
        }, {
            permanentPath: withPrefix(permanentMdRel),
            copyFileMap,
            copyPathById,
            tempSectionPathById
        });
    };

    // 2) .canvas file
    // 由用户输入的 vaultPrefix 决定 .canvas 内的 file 路径：
    // - vault 根目录：保持默认（bookmark-canvas-export）
    // - vault 子目录：填写 Exports/bookmark-canvas-export
    // - 独立 vault：留空（file 路径将是永久/临时栏目的 .json 文件）
    const canvasForVault = buildCanvasData({ vaultRelativePrefix: vaultPrefix });
    const canvasFileName = `${exportRoot}.canvas`;
    files.push({ name: `${exportRoot}/${canvasFileName}`, data: __toUint8(__formatObsidianCanvasJson(canvasForVault)) });

    // 3) Full state json (for full import)
    // 3.1) Supplementary layer (bookmark-canvas.full.json) - 补充层
    // [CHANGED] We no longer export 'style-data.json' for Obsidian Mode.
    // Obsidian Mode relies on .canvas and JSON section files to ensure edits in Obsidian are preserved.
    // We only keep this object construction if we want to include it in Full Backup (merged) or for legacy reasons.
    // For now, only generate it if specifically needed, but per request, we stop exporting it for standard Obsidian export.
    /* 
    const fullState = { ... };
    files.push({ name: `${exportRoot}/bookmark-canvas.style-data.json`, data: __toUint8(JSON.stringify(fullState, null, 2)) });
    */
    // 4) Import guide for Obsidian

    const guide = await __buildExportGuide(
        guideNames,
        isEn,
        exportRoot,
        vaultPrefix,
        permanentMdRel,
        exportFormat
    );
    guideNames.forEach((name) => {
        files.push({ name: `${exportRoot}/${name}`, data: __toUint8(guide) });
    });

    const zipBlob = __zipStore(files);
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipName = `${exportRoot}.zip`;

    // 优先使用 downloads API：支持子目录（浏览器默认下载目录下的 bookmark-canvas-export/）
    if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
        chrome.downloads.download({
            url: zipUrl,
            filename: `${downloadFolder}/${zipName}`,
            saveAs: false,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn('[Canvas] chrome.downloads.download failed, fallback to <a> tag:', chrome.runtime.lastError);
                const a = document.createElement('a');
                a.href = zipUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
            } else {
                setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
            }
        });
    } else {
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(zipUrl), 10000);
    }

    alert(isEn
        ? `Exported: ${zipName}(Downloads / ${downloadFolder} /)`
        : `已导出：${zipName}（默认下载目录 / ${downloadFolder} /）。`);
}

/**
 * 解压 ZIP 文件（支持 store 和 deflate 压缩方式）
 * 使用中央目录方式解析，正确支持 macOS 压缩的 ZIP 文件
 * @param {ArrayBuffer} arrayBuffer - ZIP 文件的 ArrayBuffer
 * @returns {Promise<Map<string, Uint8Array>>} - 文件名到内容的 Map
 */
async function __unzipStore(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = new Map();

    const readU16 = (o) => dv.getUint16(o, true);
    const readU32 = (o) => dv.getUint32(o, true);

    // 检查是否支持 DecompressionStream
    const supportsDeflate = typeof DecompressionStream !== 'undefined';

    // 1. 查找 End of Central Directory (EOCD)
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65536; i--) {
        if (readU32(i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }

    if (eocdOffset === -1) {
        throw new Error('无效的 ZIP 文件：未找到中央目录');
    }

    const cdEntryCount = readU16(eocdOffset + 10);
    const cdOffset = readU32(eocdOffset + 16);
    ;

    // 2. 遍历中央目录
    let cdPos = cdOffset;
    for (let i = 0; i < cdEntryCount; i++) {
        if (cdPos + 46 > bytes.length || readU32(cdPos) !== 0x02014b50) break;

        const gpFlag = readU16(cdPos + 8);
        const method = readU16(cdPos + 10);
        const compSize = readU32(cdPos + 20);
        const nameLen = readU16(cdPos + 28);
        const extraLen = readU16(cdPos + 30);
        const commentLen = readU16(cdPos + 32);
        const localOffset = readU32(cdPos + 42);

        const name = new TextDecoder(gpFlag & 0x0800 ? 'utf-8' : 'utf-8')
            .decode(bytes.slice(cdPos + 46, cdPos + 46 + nameLen));

        cdPos += 46 + nameLen + extraLen + commentLen;

        // 跳过目录和 macOS 元数据
        const baseName = name.split('/').pop();
        if (name.endsWith('/') || name.includes('__MACOSX') || baseName.startsWith('._')) {
            ;
            continue;
        }

        // 3. 读取本地文件头获取数据位置
        const localNameLen = readU16(localOffset + 26);
        const localExtraLen = readU16(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressedData = bytes.slice(dataStart, dataStart + compSize);

        ;

        // 4. 解压
        if (method === 0) {
            files.set(name, compressedData);
        } else if (method === 8) {
            if (!supportsDeflate) {
                throw new Error('浏览器不支持 Deflate 解压');
            }
            const decompressed = await __inflateDeflate(compressedData);
            files.set(name, decompressed);
            ;
        } else {
            throw new Error(`不支持的压缩方法 ${method}`);
        }
    }

    ;
    return files;
}

/**
 * 使用 DecompressionStream 解压 Deflate 数据
 * @param {Uint8Array} compressed - 压缩的数据
 * @returns {Promise<Uint8Array>} - 解压后的数据
 */
async function __inflateDeflate(compressed) {
    // DecompressionStream 需要 'deflate-raw' 格式（不带 zlib 头）
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // 写入压缩数据
    writer.write(compressed);
    writer.close();

    // 读取解压后的数据
    const chunks = [];
    let totalLength = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
    }

    // 合并所有块
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
    }

    return result;
}

function __buildImportedStorageFromCanvasPackage(canvasData, sourceFiles, options = {}) {
    const storage = {};
    if (!(sourceFiles instanceof Map)) return storage;
    if (canvasData && typeof canvasData === 'object') {
        try {
            storage[BCS_CANVAS_KEY] = (typeof __formatObsidianCanvasJson === 'function')
                ? __formatObsidianCanvasJson(canvasData)
                : JSON.stringify(canvasData);
        } catch (_) { }
    }

    const normalizePath = (path) => String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    const isPermanentPath = (path) => {
        const normalized = normalizePath(path);
        if (!normalized) return false;
        if (/(^|\/)(永久栏目|Permanent)(\/|$)/i.test(normalized)) return true;
        if (/Permanent\s*Sections/i.test(normalized)) return true;
        if (/Permanent\s*Bookmarks/i.test(normalized)) return true;
        if (/(^|\/)永久书签(\/|$)/.test(normalized)) return true;
        return false;
    };

    const findBytes = (relPath) => {
        const normalizedRel = normalizePath(relPath);
        if (!normalizedRel) return null;
        if (sourceFiles.has(normalizedRel)) {
            return sourceFiles.get(normalizedRel);
        }

        const normalizedLeaf = options && options.packageLeaf ? String(options.packageLeaf).trim() : '';
        const leafSegment = normalizedLeaf ? `${normalizedLeaf}/` : '';
        if (leafSegment) {
            const idxRel = normalizedRel.indexOf(leafSegment);
            if (idxRel >= 0) {
                const suffixRel = normalizedRel.slice(idxRel);
                for (const [rawKey, rawValue] of sourceFiles.entries()) {
                    const normalizedKey = normalizePath(rawKey);
                    const idxKey = normalizedKey.indexOf(leafSegment);
                    if (idxKey >= 0 && normalizedKey.slice(idxKey) === suffixRel) {
                        return rawValue;
                    }
                }
            }
        }

        let best = null;
        for (const [rawKey, rawValue] of sourceFiles.entries()) {
            const normalizedKey = normalizePath(rawKey);
            if (!normalizedKey) continue;
            if (normalizedKey === normalizedRel) return rawValue;
            if (normalizedRel.endsWith(`/${normalizedKey}`)) return rawValue;
            if (normalizedKey.endsWith(`/${normalizedRel}`)) {
                if (!best || normalizedKey.length < best.key.length) {
                    best = { key: normalizedKey, value: rawValue };
                }
                continue;
            }
            if (normalizedKey.includes(normalizedRel)) return rawValue;
        }
        if (best) return best.value;

        // Suffix fallback: strip first segment (e.g. package root folder name) of both paths
        const stripFirstSegment = (p) => {
            const parts = p.split('/');
            return parts.length > 1 ? parts.slice(1).join('/') : p;
        };
        const strippedRel = stripFirstSegment(normalizedRel);
        for (const [rawKey, rawValue] of sourceFiles.entries()) {
            const normalizedKey = normalizePath(rawKey);
            if (stripFirstSegment(normalizedKey) === strippedRel) return rawValue;
        }

        return null;
    };

    const parsePermanentProtocol = (fileText, requireTree) => {
        const text = String(fileText || '').trim();
        if (!text) return null;

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (_) {
            try {
                if (typeof __parseCanvasMarkdownPayload === 'function') {
                    const parsedMarkdown = __parseCanvasMarkdownPayload(text);
                    parsed = parsedMarkdown && parsedMarkdown.jsonProtocol ? parsedMarkdown.jsonProtocol : null;
                }
            } catch (_) { }
            try {
                if (!parsed && typeof __extractCanvasSectionJsonCodeBlock === 'function') {
                    const extracted = __extractCanvasSectionJsonCodeBlock(text);
                    parsed = extracted && extracted.jsonProtocol ? extracted.jsonProtocol : null;
                }
            } catch (_) { }
        }

        if (!parsed || typeof parsed !== 'object') return null;
        if (String(parsed.sectionType || '').trim().toLowerCase() !== 'permanent') return null;
        if (requireTree && !(parsed.tree && typeof parsed.tree === 'object')) return null;
        return parsed;
    };

    const nodes = Array.isArray(canvasData && canvasData.nodes) ? canvasData.nodes : [];
    const permanentNodes = nodes.filter((node) => {
        if (!node || node.type !== 'file') return false;
        const filePath = String(node.file || '').trim();
        if (!filePath || !/\.(json|md)$/i.test(filePath)) return false;
        return isPermanentPath(filePath);
    });
    if (!permanentNodes.length) return storage;

    const toBytes = (value) => {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        return null;
    };

    const mainNode = permanentNodes.find((node) => String(node.id || '').trim() === 'permanent-section') || permanentNodes[0];
    if (mainNode) {
        const mainBytesRaw = findBytes(mainNode.file);
        const mainBytes = toBytes(mainBytesRaw);
        if (mainBytes) {
            try {
                const mainText = new TextDecoder('utf-8').decode(mainBytes);
                const mainPayload = parsePermanentProtocol(mainText, true);
                if (mainPayload) {
                    storage['bcs:perm:main'] = mainPayload;
                }
            } catch (_) { }
        }
    }

    permanentNodes.forEach((node) => {
        if (!node || node === mainNode) return;
        const nodeId = String(node.id || '').trim();
        if (!nodeId.startsWith('permanent-section-copy-')) return;
        const copyId = nodeId.slice('permanent-section-copy-'.length).trim();
        if (!copyId) return;
        const raw = findBytes(node.file);
        const bytes = toBytes(raw);
        if (!bytes) return;
        try {
            const fileText = new TextDecoder('utf-8').decode(bytes);
            const payload = parsePermanentProtocol(fileText, false);
            if (payload) {
                storage[`bcs:perm:copy-${copyId}`] = payload;
            }
        } catch (_) { }
    });

    return storage;
}


async function parseCanvasPackageFromZipFile(file, options = {}) {
    const { isEn } = __getLang();
    const importMode = options && options.importMode === 'overwrite' ? 'overwrite' : 'snapshot';
    const lowerFileName = String((file && file.name) || '').toLowerCase();
    if (lowerFileName.endsWith('.7z')) {
        await importCanvasPackage7z(file);
    }

    const buf = await file.arrayBuffer();
    const zipFiles = await __unzipStore(buf);

    // 4.2 数据信任链：只接受 .canvas 包结构
    let canvasFileName = null;

    // 记录所有文件用于调试
    ;

    for (const name of zipFiles.keys()) {
        // 获取文件名（不含路径）
        const baseName = name.split('/').pop();

        // 查找 .canvas 文件 - 支持任意目录深度
        if (baseName.endsWith('.canvas')) {
            if (!canvasFileName) {
                canvasFileName = name;
                ;
            }
        }
    }

    let tempState = null;
    let storage = {};
    let primaryState = {}; // Mock primary state for compatibility

    if (canvasFileName) {
        ;
        const canvasText = new TextDecoder('utf-8').decode(zipFiles.get(canvasFileName));
        const canvasData = JSON.parse(canvasText);
        const packageLeaf = canvasFileName.split('/').pop().replace(/\.canvas$/i, '');
        tempState = __rebuildTempStateFromObsidianCanvasPackage(canvasData, zipFiles, primaryState, { isEn, importMode, packageLeaf });
        storage = __buildImportedStorageFromCanvasPackage(canvasData, zipFiles, { importMode, packageLeaf });
        if (storage && storage['bcs:perm:main'] && !primaryState['bcs:perm:main']) {
            primaryState['bcs:perm:main'] = storage['bcs:perm:main'];
        }
    } else {
        throw new Error(isEn
            ? 'Invalid Package: Missing .canvas file.'
            : '无效包：缺少 .canvas 文件。');
    }

    if (!tempState) {
        throw new Error(isEn ? 'Invalid package state.' : '导入包状态无效');
    }

    return {
        tempState,
        storage,
        primaryState,
        importFileName: file && file.name ? file.name : ''
    };
}

async function importCanvasPackageZip(file) {
    const parsed = await parseCanvasPackageFromZipFile(file);
    __processImportedPackage(
        parsed.tempState,
        parsed.storage,
        parsed.primaryState,
        parsed.importFileName || (file && file.name ? file.name : ''),
        {
            source: 'zip',
            trigger: 'manual-zip-import'
        }
    );
}

/**
 * 导入 7z 压缩包
 * 注意：7z 格式使用 LZMA/LZMA2 压缩，浏览器原生不支持
 * 暂时提示用户使用文件夹导入，未来可引入 7z 解压库
 */
async function importCanvasPackage7z(file) {
    const { isEn } = __getLang();

    // 检查文件头以确认是 7z 格式
    const buf = await file.arrayBuffer();
    const header = new Uint8Array(buf.slice(0, 6));
    const is7z = header[0] === 0x37 && header[1] === 0x7A &&
        header[2] === 0xBC && header[3] === 0xAF &&
        header[4] === 0x27 && header[5] === 0x1C;

    if (!is7z) {
        throw new Error(isEn
            ? 'Invalid 7z file format.'
            : '无效的 7z 文件格式。');
    }

    // 暂不支持直接解压 7z，提示用户使用文件夹导入
    throw new Error(isEn
        ? '.7z format requires external decompression. Please extract the archive first and use "Import Folder" instead.'
        : '.7z 格式需要外部解压。请先解压文件，然后使用「导入文件夹快照」功能。');
}

/**
 * 导入已解压的画布快照文件夹
 * 与 importCanvasPackageZip 类似，但处理的是已解压的文件夹
 * @param {Map<string, Uint8Array>} folderFiles - 文件夹中的文件 Map<路径, 内容>
 * @param {string} folderName - 文件夹名称
 */
async function parseCanvasPackageFromFolderFiles(folderFiles, folderName, options = {}) {
    const { isEn } = __getLang();
    const importMode = options && options.importMode === 'overwrite' ? 'overwrite' : 'snapshot';

    // 4.2 数据信任链：只接受 .canvas 包结构
    let canvasFileName = null;

    for (const name of folderFiles.keys()) {
        if (name.endsWith('.canvas') && !name.includes('/')) {
            canvasFileName = name;
        } else if (name.endsWith('.canvas')) {
            if (!canvasFileName) canvasFileName = name;
        }
    }

    let tempState = null;
    let storage = {};
    let primaryState = {};

    if (canvasFileName) {
        ;
        const canvasText = new TextDecoder('utf-8').decode(folderFiles.get(canvasFileName));
        const canvasData = JSON.parse(canvasText);
        const packageLeaf = canvasFileName.split('/').pop().replace(/\.canvas$/i, '');
        tempState = __rebuildTempStateFromObsidianCanvasPackage(canvasData, folderFiles, primaryState, { isEn, importMode, packageLeaf });
        storage = __buildImportedStorageFromCanvasPackage(canvasData, folderFiles, { importMode, packageLeaf });
        if (storage && storage['bcs:perm:main'] && !primaryState['bcs:perm:main']) {
            primaryState['bcs:perm:main'] = storage['bcs:perm:main'];
        }
    } else {
        throw new Error(isEn
            ? 'Invalid Folder: Missing .canvas file.'
            : '无效文件夹：缺少 .canvas 文件。');
    }

    if (!tempState) {
        throw new Error(isEn ? 'Invalid folder state.' : '文件夹状态无效');
    }

    return {
        tempState,
        storage,
        primaryState,
        importFileName: folderName || ''
    };
}

async function importCanvasPackageFolder(folderFiles, folderName) {
    const parsed = await parseCanvasPackageFromFolderFiles(folderFiles, folderName);
    __processImportedPackage(
        parsed.tempState,
        parsed.storage,
        parsed.primaryState,
        parsed.importFileName || folderName || '',
        {
            source: 'folder',
            trigger: 'manual-folder-import'
        }
    );
}

function __normalizeTransferExportRoot(value) {
    const { isEn } = __getLang();
    const def = isEn ? 'bookmark-canvas' : '书签画布';
    const normalized = String(value == null ? '' : value)
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/+/g, '/');
    if (normalized === 'bookmark-canvas-sync' || normalized === 'bookmark-canvas' || normalized === '书签画布同步' || normalized === '书签画布' || normalized === 'Bookmark Canvas') {
        return def;
    }
    return normalized || def;
}

function __buildTransferCopyEntriesFromSandbox(sandbox) {
    const copies = sandbox && sandbox.permCopies && typeof sandbox.permCopies === 'object'
        ? sandbox.permCopies
        : {};
    const entries = [];
    const pushed = new Set();

    try {
        const copyList = (typeof __ensurePermanentSectionCopyDisplayIndexes === 'function')
            ? __ensurePermanentSectionCopyDisplayIndexes()
            : [];
        if (Array.isArray(copyList)) {
            copyList.forEach((copy) => {
                const copyId = String(copy && copy.id || '').trim();
                if (!copyId || pushed.has(copyId)) return;
                const key = `bcs:perm:copy-${copyId}`;
                const payload = copies[key];
                if (!payload || typeof payload !== 'object') return;
                const displayIndex = (typeof __normalizePositiveInt === 'function')
                    ? __normalizePositiveInt(copy && copy.displayIndex)
                    : Math.max(1, parseInt(copy && copy.displayIndex, 10) || 1);
                entries.push({
                    key,
                    copyId,
                    payload,
                    slotIndex: displayIndex + 1
                });
                pushed.add(copyId);
            });
        }
    } catch (_) { }

    Object.keys(copies).forEach((key) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey.startsWith('bcs:perm:copy-')) return;
        const copyId = normalizedKey.slice('bcs:perm:copy-'.length).trim();
        if (!copyId || pushed.has(copyId)) return;
        const payload = copies[normalizedKey];
        if (!payload || typeof payload !== 'object') return;
        entries.push({
            key: normalizedKey,
            copyId,
            payload
        });
        pushed.add(copyId);
    });

    return entries;
}

async function buildFullCanvasPackageFromCurrent(options = {}) {
    const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    if (!bridge || typeof bridge.buildExportSandbox !== 'function' || typeof bridge.buildObsidianPackageFilesFromSnapshot !== 'function') {
        throw new Error('Canvas export bridge unavailable.');
    }

    const { isEn } = __getLang();
    const exportRoot = __normalizeTransferExportRoot(options && options.exportRoot);
    const exportFormat = 'json';
    const reason = String(options && options.reason || 'github-transfer-push');

    try { __flushMdEditorsForExport(); } catch (_) { }
    try {
        if (typeof saveTempNodes === 'function') {
            const result = saveTempNodes({ immediate: true, skipValidation: true });
            if (result && typeof result.then === 'function') await result;
        }
    } catch (_) { }
    try {
        if (typeof savePermanentSectionPosition === 'function') {
            const result = savePermanentSectionPosition();
            if (result && typeof result.then === 'function') await result;
        }
    } catch (_) { }

    const sandbox = await bridge.buildExportSandbox({ reason });
    if (!sandbox || !sandbox.permMain) {
        throw new Error(isEn ? 'Export failed: permanent JSON source unavailable.' : '导出失败：永久栏目 JSON 真相源不可用。');
    }

    bridge.processExportSandboxForExport(sandbox);
    if (options && options.writeBackupSlot === true && typeof bridge.writeBackupSlotFromSandbox === 'function') {
        try { await bridge.writeBackupSlotFromSandbox(sandbox); } catch (_) { }
    }

    const bundle = bridge.buildObsidianPackageFilesFromSnapshot({
        permMain: sandbox.permMain,
        permCopies: sandbox.permCopies,
        tempState: sandbox.tempState,
        canvasState: sandbox.canvasState
    }, {
        isEn,
        exportFormat,
        exportRoot,
        idsAlreadySyncIds: true,
        copyEntries: __buildTransferCopyEntriesFromSandbox(sandbox),
        skipValidation: true
    });

    const guideNames = (options && Array.isArray(options.guideNames) && options.guideNames.length > 0)
        ? options.guideNames
        : __getExportGuideNamesFromStorage();
    const permanentPath = String(bundle && bundle.permanentPath || '');
    const permanentMdRel = permanentPath.startsWith(`${exportRoot}/`)
        ? permanentPath.slice(exportRoot.length + 1)
        : permanentPath;
    const guide = await __buildExportGuide(
        guideNames,
        isEn,
        exportRoot,
        __normalizeTransferExportRoot(options && options.vaultPrefix) || exportRoot,
        permanentMdRel,
        exportFormat
    );
    const encoder = new TextEncoder();
    guideNames.forEach((name) => {
        const fileName = String(name || '').trim();
        if (!fileName) return;
        bundle.files.push({
            name: `${exportRoot}/${fileName}`,
            data: encoder.encode(guide)
        });
    });

    return bundle;
}

async function parseCanvasPackageForTransfer(input, options = {}) {
    const source = input && typeof input === 'object' ? input : {};
    if (source.folderFiles instanceof Map) {
        return await parseCanvasPackageFromFolderFiles(
            source.folderFiles,
            source.folderName || '',
            options
        );
    }
    if (source.file) {
        return await parseCanvasPackageFromZipFile(source.file, options);
    }
    throw new Error('Missing import package input.');
}

async function importParsedCanvasPackageForTransfer(parsed, options = {}) {
    const safeParsed = parsed && typeof parsed === 'object' ? parsed : {};
    const importMode = options && options.importMode === 'overwrite' ? 'overwrite' : 'snapshot';
    const importFileName = String(safeParsed.importFileName || options.importFileName || '');

    if (importMode === 'overwrite') {
        await __performOverwriteImport({
            parsedTempState: safeParsed.tempState,
            parsedStorage: safeParsed.storage,
            parsedPrimaryState: safeParsed.primaryState,
            importFileName,
            threshold: Number.isFinite(Number(options && options.threshold)) ? Number(options.threshold) : 300,
            deferRuntimeApply: !!(options && options.deferRuntimeApply === true),
            willReloadAfterImport: !!(options && options.willReloadAfterImport === true)
        });
        return { success: true, mode: 'overwrite' };
    }

    const processResult = __processImportedPackage(
        safeParsed.tempState,
        safeParsed.storage,
        safeParsed.primaryState,
        importFileName,
        options && options.importMeta ? options.importMeta : {
            source: 'github',
            trigger: 'github-pull-snapshot'
        },
        {
            deferRuntimeRender: !!(options && options.deferRuntimeRender === true),
            willReloadAfterImport: !!(options && options.willReloadAfterImport === true)
        }
    );
    if (processResult && typeof processResult.then === 'function') {
        await processResult;
    }
    return { success: true, mode: 'snapshot' };
}

async function importCanvasGithubFolderPackage(folderFiles, folderName, options = {}) {
    const importMode = options && options.importMode === 'overwrite' ? 'overwrite' : 'snapshot';
    const parsed = await parseCanvasPackageFromFolderFiles(folderFiles, folderName, { importMode });
    return await importParsedCanvasPackageForTransfer(parsed, {
        ...options,
        importMode,
        importFileName: parsed.importFileName || folderName || '',
        importMeta: {
            source: 'github',
            trigger: importMode === 'overwrite' ? 'github-pull-overwrite' : 'github-pull-snapshot'
        }
    });
}

if (typeof window !== 'undefined') {
    window.showImportDialog = showImportDialog;
    window.exportCanvasCardGroupPackage = exportCanvasCardGroupPackage;
    window.exportCanvasTempGroupPackage = exportCanvasTempGroupPackage;
    window.buildCanvasGithubPackageFiles = buildFullCanvasPackageFromCurrent;
    window.importCanvasGithubFolderPackage = importCanvasGithubFolderPackage;
    window.BookmarkCanvasPackageTransferBridge = Object.assign(window.BookmarkCanvasPackageTransferBridge || {}, {
        buildFullCanvasPackageFromCurrent,
        parseCanvasPackage: parseCanvasPackageForTransfer,
        importParsedCanvasPackage: importParsedCanvasPackageForTransfer,
        importCanvasGithubFolderPackage
    });
}
