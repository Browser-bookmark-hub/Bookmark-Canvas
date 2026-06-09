/*
 * Bookmark-Canvas import/export feature layer
 *
 * This file contains manual import/export UI, file-entry handlers, and package
 * assembly/parsing endpoints. Shared BCS storage, protocol, JSON compatibility,
 * and markdown/html conversion helpers remain in storageBCS/storageBCS_core.js
 * so AI, sync, and import/export can use the same data core.
 */

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

        document.body.appendChild(dialog);

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

        document.body.appendChild(dialog);

        let selectedMode = defaultMode;
        let currentThreshold = 300;
        const bridge = (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
        if (bridge && typeof bridge.getImportOverwriteThreshold === 'function') {
            bridge.getImportOverwriteThreshold().then((v) => {
                currentThreshold = Number(v) || 300;
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
                        const v = Math.max(1, Math.min(100000, parseInt(inp.value, 10) || 300));
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

function __countOverwriteDiff(localContent, importTreeRoot) {
    // Returns approximate diff count: |importSyncIds ⊖ localSyncIds| + same-syncId field diffs.
    const localList = (localContent && Array.isArray(localContent.identityMap)) ? localContent.identityMap : [];
    const localBySyncId = new Map();
    for (const entry of localList) {
        if (entry && entry.syncId) localBySyncId.set(String(entry.syncId), entry);
    }
    const importSyncIds = __collectSyncIdsFromImportTree(importTreeRoot);
    let diff = 0;
    importSyncIds.forEach((syncId) => { if (!localBySyncId.has(syncId)) diff += 1; });
    localBySyncId.forEach((_v, syncId) => { if (!importSyncIds.has(syncId)) diff += 1; });
    // Approximation: don't recurse into title/url comparison here; overwrite path doesn't need exact value.
    return diff;
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

async function __applyOverwriteImportedCanvasState(parsedTempState, bridge, parsedStorage = null) {
    if (!parsedTempState || typeof parsedTempState !== 'object') return false;
    let persisted = false;
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
            preferStoragePermanentLayout: true
        });
        persisted = true;
    } else {
        await new Promise((resolve) => {
            try { chrome.storage.local.set({ 'bcs:temp-state-snapshot': stateForOverwrite }, () => resolve()); }
            catch (_) { resolve(); }
        });
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
    const threshold = Number.isFinite(__parsedThreshold) ? Math.max(0, __parsedThreshold) : 300;
    const skipBackupWrite = !!(payload && payload.skipBackupWrite === true);
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
    const importIdentityMap = Array.isArray(importPermMain.identityMap) ? importPermMain.identityMap : [];

    // 3. Decide branch.
    const localContent = await bridge.readPermanentMainContentFromBcs({
        skipIdentityMapHeal: true
    });
    const diff = __countOverwriteDiff(localContent, importTree);
    const goOverwrite = threshold <= 0 || diff >= threshold;
    console.log(`[Overwrite Import] diff=${diff}, threshold=${threshold}, branch=${goOverwrite ? 'overwrite' : 'incremental'}`);

    // 4. Open bulk-mute envelope.
    let muteSession = null;
    if (typeof window.beginBookmarkBulkMute === 'function') {
        muteSession = await window.beginBookmarkBulkMute('overwrite-import');
    }

    // Extract extras (tags, etc.) from import identityMap keyed by syncId — both branches reuse.
    const importExtrasBySyncId = new Map();
    for (const entry of importIdentityMap) {
        if (!entry || !entry.syncId) continue;
        const extras = Object.keys(entry).filter((k) => k !== 'id' && k !== 'syncId');
        if (extras.length) {
            const obj = {};
            for (const k of extras) obj[k] = entry[k];
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
            if (typeof window.__refreshAllTagDots === 'function') {
                window.__refreshAllTagDots();
            }
        } catch (_) {}
    };
    try {
        if (goOverwrite) {
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
        } else {
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

            // 1) Delete: local syncId not in expectedSyncIds. (Skip root/top-roots — they always exist.)
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
            // §3.2: drop deleted entries from local maps so they cannot leak into nextIdentityMap.
            for (const entry of toDeleteEntries) {
                localBySyncId.delete(String(entry.syncId));
                localByChromeId.delete(String(entry.id));
            }
            // Also drop descendants whose chromeId no longer exists. We'll re-validate against fresh tree below.

            // 2) Pull fresh tree after deletes, then create missing nodes (parents first via DFS over import tree).
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

            // 3) Update title/url. We need fresh local tree to compare correctly after creates/deletes.
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

            // 4) Move/reorder. §3.4: refresh lookups so parent/index decisions reflect post-create/delete state.
            //    Walk top-down per parent so parents move before children.
            lookups = await buildFreshLookups();
            const moveWalk = async (importChildren) => {
                if (!Array.isArray(importChildren)) return;
                for (let i = 0; i < importChildren.length; i++) {
                    const node = importChildren[i];
                    if (!node || !node.id) continue;
                    const syncId = String(node.id);
                    const chromeId = syncIdToChromeId.get(syncId);
                    if (!chromeId) continue;
                    const parentSyncId = String(node.parentId || '').trim();
                    const desiredParentChromeId = syncIdToChromeId.get(parentSyncId);
                    const currentInfo = lookups.parentByChildId.get(chromeId);
                    const parentDiffers = !!(desiredParentChromeId && currentInfo && String(currentInfo.parentId) !== String(desiredParentChromeId));
                    const desiredIndex = i;
                    // When import contains unmapped siblings, raw `i` can exceed the current live
                    // sibling range and trigger "Index out of bounds". Clamp before move.
                    const desiredParentNode = desiredParentChromeId
                        ? lookups.nodeByChromeId.get(String(desiredParentChromeId))
                        : null;
                    const desiredParentChildCount = Array.isArray(desiredParentNode && desiredParentNode.children)
                        ? desiredParentNode.children.length
                        : 0;
                    const maxAllowedIndex = Math.max(
                        0,
                        desiredParentChildCount - (parentDiffers ? 0 : 1)
                    );
                    const safeDesiredIndex = Math.max(0, Math.min(desiredIndex, maxAllowedIndex));
                    const indexDiffers = !!(currentInfo && Number(currentInfo.index) !== Number(safeDesiredIndex));
                    if ((parentDiffers || indexDiffers) && desiredParentChromeId) {
                        try {
                            await new Promise((resolve) => {
                                try {
                                    chrome.bookmarks.move(
                                        chromeId,
                                        { parentId: desiredParentChromeId, index: safeDesiredIndex },
                                        () => {
                                            // Read lastError to avoid "Unchecked runtime.lastError" noise.
                                            const err = chrome.runtime && chrome.runtime.lastError
                                                ? String(chrome.runtime.lastError.message || '')
                                                : '';
                                            if (err) {
                                                try { console.warn('[Incremental Import] bookmarks.move skipped:', { chromeId, desiredParentChromeId, safeDesiredIndex, err }); } catch (_) {}
                                            }
                                            resolve();
                                        }
                                    );
                                }
                                catch (_) { resolve(); }
                            });
                        } catch (_) {}
                        // Refresh after each move so subsequent siblings see the new ordering.
                        lookups = await buildFreshLookups();
                    }
                    if (Array.isArray(node.children) && node.children.length) {
                        await moveWalk(node.children);
                    }
                }
            };
            if (Array.isArray(importTree.children)) {
                for (const topChild of importTree.children) {
                    if (!topChild) continue;
                    await moveWalk(topChild.children);
                }
            }

            // 5) Rebuild identityMap. §3.3: only include syncIds that come from the import package.
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
        }

        // 5. Overwrite non-Chrome state directly (temp sections, mdNodes, edges, canvas state, copies).
        try {
            await __applyOverwriteImportedCanvasState(parsedTempState, bridge, parsedStorage);
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
            await window.endBookmarkBulkMute('overwrite-import', { refreshTree: true });
        }
    }

    if (success) {
        await refreshTagUiAfterImport();
        const msg = isEn ? 'Full overwrite complete. Undo via Backup.' : '全量覆盖完成。可通过「备份」撤销。';
        try { (typeof showCanvasToast === 'function') ? showCanvasToast(msg, 'success', 4000) : alert(msg); } catch (_) { alert(msg); }
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
            } else {
                failedFiles += 1;
            }
        } catch (error) {
            failedFiles += 1;
            console.error('[Canvas] 批量书签文件导入失败:', file && file.name, error);
        }
    }

    if (importedFiles > 0) {
        try { saveTempNodes(); } catch (_) { }
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
            <strong>Bookmarks (HTML / JSON)</strong><br>
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
            <strong>书签文件 (HTML / JSON)</strong><br>
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
                    <div class="import-section-label-large" style="margin-top: 12px;">${isEn ? 'Bookmarks' : '书签文件'}</div>
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

    document.body.appendChild(dialog);

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
        preserveRaw: true
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
                __processImportedPackage(parsedTempState, parsedStorage, parsedPrimaryState, file.name, {
                    source: 'zip',
                    trigger: importOptions.trigger || 'canvas-position-import',
                    canvasPosition
                });
                const activeDialog = document.getElementById('canvasImportDialog');
                if (activeDialog) activeDialog.remove();
                e.target.value = '';
                e.target.__canvasImportOptions = null;
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
                        threshold: Number.isFinite(overwriteThreshold) ? overwriteThreshold : 300
                    });
                } catch (err) {
                    console.error('[Overwrite Import] failed:', err);
                    alert(isEn ? `Full overwrite failed: ${err.message}` : `全量覆盖失败：${err.message}`);
                }
                return;
            }
            __setCanvasImportRuntimeMode(mode);

            __processImportedPackage(parsedTempState, parsedStorage, parsedPrimaryState, file.name, {
                source: type === 'package-archive' ? 'zip' : 'json',
                trigger: canvasPosition ? 'canvas-position-import' : 'manual-file-import',
                canvasPosition
            });
        } else if (type === 'html' || type === 'json') {
            if (files.length > 1) {
                await __importBookmarkFilesBatch(type, files, {
                    canvasPosition
                });
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
            __processImportedPackage(parsed.tempState, parsed.storage, parsed.primaryState, folderName, {
                source: 'folder',
                trigger: importOptions.trigger || 'canvas-position-import',
                canvasPosition
            });
            const activeDialog = document.getElementById('canvasImportDialog');
            if (activeDialog) activeDialog.remove();
            e.target.value = '';
            e.target.__canvasImportOptions = null;
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
                    threshold: Number.isFinite(overwriteThreshold) ? overwriteThreshold : 300
                });
            } catch (err) {
                console.error('[Overwrite Import] failed:', err);
                alert(isEn ? `Full overwrite failed: ${err.message}` : `全量覆盖失败：${err.message}`);
            }
            return;
        }
        __setCanvasImportRuntimeMode(mode);

        __processImportedPackage(parsed.tempState, parsed.storage, parsed.primaryState, folderName, {
            source: 'folder',
            trigger: canvasPosition ? 'canvas-position-import' : 'manual-folder-import',
            canvasPosition
        });

        const activeDialog = document.getElementById('canvasImportDialog');
        if (activeDialog) activeDialog.remove();
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
        saveTempNodes();
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

    // 统计书签总数
    let totalBookmarkCount = 0;

    // 通用转换器 - 支持多种字段名
    const convert = (node) => {
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

        // 提取 tags
        if (Array.isArray(node.tags) && node.tags.length) {
            item.tags = node.tags
                .map(t => (t && typeof t === 'object') ? { color: String(t.color || '').trim(), text: String(t.text || '').trim() } : null)
                .filter(t => t && t.color);
            if (!item.tags.length) delete item.tags;
        }

        // 递归处理子节点
        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(convert).filter(Boolean);
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

        if (Array.isArray(node.tags) && node.tags.length) {
            item.tags = node.tags;
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
        console.log('[Canvas] Detected Bookmark Canvas permanent section JSON format');
        const permanentTree = data.tree;
        const roots = permanentTree && Array.isArray(permanentTree.children)
            ? permanentTree.children
            : [permanentTree];
        roots.forEach((entry) => {
            const item = convert(entry);
            if (item) items.push(item);
        });
    } else if (looksLikeCanvasTempProtocol) {
        console.log('[Canvas] Detected Bookmark Canvas temporary section JSON format');
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
        console.log('[Canvas] Detected wrapped bookmarkTree snapshot format');
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
        console.log('[Canvas] Detected wrapped bookmarks array format');
        data.bookmarks.forEach((entry) => {
            const item = convert(entry);
            if (item) items.push(item);
        });
    } else if (data && typeof data === 'object' && Array.isArray(data.items)) {
        // 第三方常见包裹格式：{ items: [...] }
        console.log('[Canvas] Detected wrapped items array format');
        data.items.forEach((entry) => {
            const item = convert(entry);
            if (item) items.push(item);
        });
    } else if (data.roots) {
        // Chrome/Edge 内部格式：{roots: {bookmark_bar, other, synced}}
        console.log('[Canvas] Detected Chrome/Edge internal bookmark format');
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
        console.log('[Canvas] Detected Firefox bookmark format');
        if (data.children && Array.isArray(data.children)) {
            data.children.forEach(child => {
                const item = convert(child);
                if (item) items.push(item);
            });
        }
    } else if (Array.isArray(data)) {
        // 数组格式 - 最通用的格式
        console.log('[Canvas] Detected array bookmark format');

        // 检查是否是 Chrome bookmarks.getTree() 的输出格式
        // 通常返回 [{id: "0", title: "", children: [...]}]
        if (data.length === 1 && data[0].children && !data[0].url) {
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
    } else if (data.children && Array.isArray(data.children)) {
        // 单个根节点格式（可能是 Chrome API 格式）
        console.log('[Canvas] Detected single root node format');
        data.children.forEach(child => {
            const item = convert(child);
            if (item) items.push(item);
        });
    } else {
        // 单个对象格式
        console.log('[Canvas] Detected single object format');
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
        saveTempNodes();
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
                    || __joinObsidianExportPath(exportRoot, __buildPermanentSectionMarkdownRelativePath(1, isEn, exportFormat))
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
    const exportedAt = new Date().toISOString();
    const guide = __buildExportGuide(
        guideNames,
        'groupExportGuide',
        isEn,
        exportedAt,
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

    document.body.appendChild(dialog);

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


function __buildExportGuide(guideNames, source, isEn, exportedAt, exportRoot, vaultPrefix, permanentMdRel, exportFormat) {
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
    let compatText = '';
    let aiGuideText = '';

    const modeTreeRulesEn = [
        '- JSON Mode (for AI) stores the bookmark tree as a single plain JSON object body (no fenced code block).',
        '- Permanent/temporary section imports read this JSON body directly.'
    ];

    const modeTreeRulesZh = [
        '- JSON模式（供AI）使用单一 JSON 对象正文承载书签树（不使用代码围栏）。',
        '- 永久栏目与临时栏目导入时读取这个 JSON 正文，不再依赖视觉 HTML 包裹结构。'
    ];

    compatText = isEn
        ? [
            '# Bookmark Canvas Import/Export Rules',
            '',
            'This file is written for AI agents that edit an exported Bookmark Canvas package. Keep edits protocol-aware and minimal.',
            '',
            '## Part A. Package & View Structure',
            '',
            '### A0. Full Workflow Example (Export → Edit → Re-import)',
            '1. Export using JSON Mode (for AI).',
            '2. Unzip into your Obsidian vault.',
            '3. Open the package `.canvas` entry file in the export root. It is usually named like the folder, but use the actual `.canvas` filename if it was renamed.',
            '4. Edit Permanent/Temporary `.json` files only when their bookmark data is in scope; edit blank cards directly in `.canvas` text nodes.',
            '5. If any Permanent/Temporary `.json` file is renamed or moved, update every matching `.canvas` file path.',
            '6. Re-import via ZIP or folder.',
            '',
            '### A1. Generic Package Structure Diagram',
            '```text',
            '<export-root>/',
            '├── ' + guidePrimaryName.padEnd(9) + '                              (this AI editing guide)',
            '├── <canvas-entry>.canvas                  (canvas entry: nodes, edges, file mappings, text cards, groups, connectors; see R6)',
            '├── Permanent/                             (permanent section JSON folder; Chinese export: 永久栏目/)',
            '│   ├── A-PermanentBookmarks.json          (main permanent section, slot A; browser bookmark-tree snapshot; see R2)',
            '│   └── B-PermanentBookmarks.json          (optional permanent copy anchor, slot B; description/view only; see R3)',
            '└── Temporary/                             (temporary section JSON folder; Chinese export: 临时栏目/)',
            '    ├── General Chain/                     (regular chain bookmark sandboxes; Chinese export: 常规链式/)',
            '    │   ├── A-1 <title>.json               (regular chain from permanent slot A or fallback sequence label; see R4/R1.4)',
            '    │   ├── A-2 <title>.json               (next same-origin A chain; scan existing A-N and use max+1; see R4/R1.4)',
            '    │   ├── A-1-1 <title>.json             (derived chain; may inherit most content from A-1; see R4/R1.4)',
            '    │   └── B-1 <title>.json               (regular chain from permanent copy/slot B; see R4/R1.4)',
            '    └── Special temporary/                 (special bookmark sandboxes; Chinese export: 特殊临时栏目/)',
            '        ├── AI <title>.json                (fallback target for AI-generated bookmark sets when no existing target is specified; see R5/R7)',
            '        └── Add/Search/Import <title>.json (other special temporary sections; see R5)',
            '```',
            '- JSON Mode exports section files as `.json`; blank cards are `.canvas` `type: "text"` nodes, not standalone files.',
            '- Example index: permanent main [R2](#ref-r2); permanent copy [R3](#ref-r3); regular temporary [R4](#ref-r4); AI/special temporary [R5](#ref-r5)/[R7](#ref-r7); canvas [R6](#ref-r6); tags [R8](#ref-r8).',
            '',
            '### A2. Mode-specific Content Grammar',
            ...modeTreeRulesEn,
            '- Do not wrap section JSON in Markdown fences. Keep each section file parseable as one JSON object.',
            '',
            '### A3. Permanent Section Contract',
            '- Permanent sections represent the browser bookmark tree. Treat them as user data with higher risk than temporary sections.',
            '- Main permanent file shape: `format`, `schemaVersion`, `sectionType: "permanent"`, `slot: "A"`, `descriptionMd`, optional `identityMap`, and `tree`. See [R2](#ref-r2).',
            '- `descriptionMd` describes the current bookmark tree. Preserve Markdown source unless the user asks to change the description.',
            '- The exported `tree.id` and `tree.parentId` values are `syncId_*`, not local Chrome numeric IDs. When adding permanent nodes, mint unique IDs shaped like `syncId_YYYYMMDD_hash_<token7>`, where `token7` is lowercase letters/digits only. See [R1.1](#ref-r1-1) and [R1.2](#ref-r1-2).',
            '- Top-level browser roots use `folderType` such as `bookmarks-bar`, `other`, or `mobile`, plus `syncing`. Do not add, delete, move, or edit `folderType` / `syncing` on these roots.',
            '- `identityMap` is exported only for extra metadata such as tags. If present, keep entries keyed by `syncId`; do not invent Chrome local `id` values in exported packages. See [R2](#ref-r2).',
            '- Permanent copies are not duplicate trees. A copy file has `fileRole: "copy-anchor"`, `anchorOnly: true`, `inheritFrom`, `copyId`, its own `descriptionMd`, and view state. Do not add a `tree` to a copy anchor. See [R3](#ref-r3).',
            '',
            '### A4. Temporary Section Contract',
            '- Temporary sections are bookmark sandboxes. Editing them does not mean directly editing the browser bookmark tree.',
            '- Regular chain sections live under `Temporary/General Chain/` with labels like `A-1`, `A-1-1`, `B-1`. A derived chain may intentionally carry over many items from its parent chain. See [R4](#ref-r4).',
            '- If a regular section has an explicit `label`, that label is authoritative. Without one, the fallback top-level label is generated from `sequenceNumber` through `toAlphaLabel()`: 1 => A-1, 2 => B-1, 3 => C-1, 27 => AA-1. See [R1.4](#ref-r1-4).',
            '- For sections created from a permanent origin, the label family follows that origin: slot A uses `A-N`, copy/slot B uses `B-N`; scan existing same-family labels and use max+1, so a second slot-A section is `A-2`, not `B-1`.',
            '- Runtime section IDs mirror labels: `temp-section-A-1`, `temp-section-A-1-1`. Every item inside the section must use the same `sectionId`.',
            '- Special temporary sections live under `Temporary/Special temporary/` and use `tempKind: "special"` with a human label such as Drop, Search, Add, Import, or AI. See [R5](#ref-r5).',
            '- For repeated special labels, scan existing same-label IDs and use the next suffix, for example `temp-section-AI`, then `temp-section-AI-2`. See [R1.5](#ref-r1-5).',
            '- Temporary item IDs use `tempId_YYYYMMDD_hash_<token7>`, where `token7` is lowercase letters/digits only. Folders use `type: "folder"` and bookmarks use `type: "bookmark"` with `url`. See [R1.1](#ref-r1-1), [R1.3](#ref-r1-3), and [R4](#ref-r4).',

            '',
            '### A5. .canvas Element Contract',
            '- Root keys must remain `nodes[]` and `edges[]`; the file is JSON Canvas compatible. See [R6](#ref-r6).',
            '- File nodes point to Permanent/Temporary JSON files through vault-relative `file` paths.',
            '- Text nodes (`type: "text"`) are blank cards and may contain prompt text; edit their `text` field directly.',
            '- Group nodes (`type: "group"`) are card groups. They do not store `children`; nesting and membership are inferred by geometry containment.',
            '- Edge `fromNode` / `toNode` values must reference existing node IDs. Default connectors are single-arrow lines unless the existing edge says otherwise.',
            '- A node already geometrically inside a group should not be connected to that same containing group just to express membership.',
            '- Preserve existing plugin-style IDs such as `permanent-section`, `temp-section-A-1`, `card-group-*`, `md-node-*`, and `edge-*`; do not convert them to generic 16-hex IDs. See [R1.6](#ref-r1-6).',
            '',
            '### A6. Tag System Contract',
            '- Tags follow a macOS Finder-like model: one bookmark/folder item can have multiple colored tags, each stored as `{ "color": "<palette>", "text": "<label>" }`. See [R8](#ref-r8).',
            '- Allowed tag `color` values are lowercase palette names only: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`. Use `gray`, not `grey`; do not use hex values, `colorHex`, or canvas color preset numbers for tags.',
            '- Palette display colors: red `#ff453a`, orange `#ff9f0a`, yellow `#ffd60a`, green `#30d158`, blue `#0a84ff`, purple `#bf5af2`, gray `#8e8e93`.',
            '- `text` is the visible tag label. If the UI user only clicks a color, the app uses the localized color name as text; AI edits should write an explicit short `text`.',
            '- Multiple tags are allowed. Keep their order stable, remove exact duplicates by `color + text`, and preserve existing tags unless the task asks to change them.',
            '- Add tags only when the user requests tags or the item/folder is important to the task. Avoid over-tagging large URL sets.',
            '- Permanent tags belong on `identityMap` entries keyed by `syncId`, not inside bookmark tree nodes. See [R2](#ref-r2).',
            '- Temporary tags belong inline on the affected item object, so they move/delete with that item. See [R4](#ref-r4).',
            '- Tag colors are separate from `.canvas` node/edge/section `color` and `colorHex` values. Do not convert between them.',
            '- Preserve unknown metadata fields unless the task explicitly targets them.',
            '',
            '### A7. Import Recognition Priority',
            '- Type recognition uses `.canvas` file references plus folder paths.',
            '- Permanent `slot` in JSON and any header/filename slot hint must stay aligned; import can fall back to filename/order when needed.',
            '- Temporary labels are resolved by explicit JSON `label`, then header/filename prefix.',
            '- In normal import flow, permanent files are restored as snapshot sections. Browser-tree overwrite is a separate high-risk import mode.',
            '',
            '### A8. Signal and Relationship Use',
            '- Permanent/temporary `descriptionMd` and `.canvas` text nodes are notes or prompts about the nearby bookmark tree. Use them as context, but do not treat them as bookmark items.',
            '- For first-pass analysis of a regular chain section, inspect its likely source family and parent chain first, such as `#A`, `#B`, `A-1`, `A-1-1`, or `B-1`. If lineage is ambiguous, match by `title` or `url` with local search/tools.',
            '- Edge direction can encode relationship semantics. Canonical export form: single arrow from `fromNode` to `toNode` omits both ends; no arrow sets `toEnd: "none"`; two-ended arrow sets `fromEnd: "arrow"` and relies on the default `toEnd` arrow. Preserve existing direction unless the task asks to change the relationship.',
            '- Tags should mark user-requested or especially important items. Avoid adding many tags just because many URLs are present.',
            '',
            '### A9. Text Formatting Support',
            '- Blank cards (`.canvas` `text` nodes) and permanent/temporary `descriptionMd` support Obsidian-style Markdown and partial HTML rendering.',
            '- Formatting should primarily follow the habits of the user\'s current tool. If some tools lack support, adjust based on the user\'s actual habits, supplementing other tools as needed. There is no need to list all supported tools and formats.',
            '- Recommended Markdown examples (3 types): Highlights `==text==`, blockquotes `> text`, and lists `- item` or `1. item`.',
            '- Recommended HTML examples (2 types): Text color `<span style="color:red;">text</span>` and alignment `<div align="center">text</div>` (supports left/center/right).'
        ].join('\n')
        : [
            '# 书签画布导入/导出规则',
            '',
            '本文件专项给 AI 代理使用：编辑导出的书签画布包时，必须按插件协议最小改动，不能按普通 Canvas 文件随意重写。',
            '',
            '## 第一部分：文件结构与视图结构（导入识别基准）',
            '',
            '### A0. 完整操作示例（导出 → 编辑 → 导入）',
            '1. 在书签画布执行 JSON模式（供AI）导出。',
            '2. 将 ZIP 解压到 Obsidian 仓库。',
            '3. 打开导出包根目录下的 `.canvas` 入口文件。通常它与导出文件夹同名；如果用户改名，以实际 `.canvas` 文件名为准。',
            '4. 只有需求命中书签数据时才编辑 永久栏目/、临时栏目/ 下的 `.json`；空白栏目直接编辑 `.canvas` 的 text 节点。',
            '5. 若重命名或移动 永久/临时 `.json` 文件，必须同步修改 `.canvas` 中所有对应 file 路径。',
            '6. 回到扩展中，以 ZIP 或文件夹方式导入。',
            '',
            '### A1. 通用包结构图',
            '```text',
            '<导出包根目录>/',
            '├── ' + guidePrimaryName.padEnd(9) + '                                   (当前 AI 编辑指南)',
            '├── <画布入口>.canvas                            (画布入口：nodes、edges、文件映射、空白栏目、卡片组、连接线；见 R6)',
            '├── 永久栏目/                                    (永久栏目 JSON 文件夹；对应浏览器书签树)',
            '│   ├── A书签树（永久栏目）.json                   (主永久栏目，slot A；永久书签树快照规范来源；见 R2)',
            '│   └── B书签树（永久栏目）.json                   (可选永久栏目副本锚点，slot B；只保留副本说明/视图；见 R3)',
            '└── 临时栏目/                                    (临时栏目 JSON 文件夹；书签沙盒)',
            '    ├── 常规链式/                                (普通链式书签沙盒)',
            '    │   ├── A-1 <标题>.json                     (永久栏目 A 来源或无显式 label 时的普通链式；见 R4/R1.4)',
            '    │   ├── A-2 <标题>.json                     (同源 A 的下一份；扫描 A-N 取 max+1；见 R4/R1.4)',
            '    │   ├── A-1-1 <标题>.json                   (派生链式；可承接 A-1 的大部分内容；见 R4/R1.4)',
            '    │   └── B-1 <标题>.json                     (永久副本/slot B 来源的普通链式；见 R4/R1.4)',
            '    └── 特殊临时栏目/                            (特殊临时书签沙盒)',
            '        ├── AI <标题>.json                      (无现成落点时的 AI 生成书签树落点；见 R5/R7)',
            '        └── 添加/搜索/导入 <标题>.json            (其他特殊临时栏目；见 R5)',
            '```',
            '- JSON模式不导出栏目 `.md` 文件；栏目文件都是 `.json`，空白栏目只存在于 `.canvas` 的 `type: "text"` 节点。',
            '- 示例索引：永久主文件见 [R2](#ref-r2)；永久副本见 [R3](#ref-r3)；普通链式临时栏目见 [R4](#ref-r4)；AI/特殊临时栏目见 [R5](#ref-r5)/[R7](#ref-r7)；.canvas 见 [R6](#ref-r6)；tag 见 [R8](#ref-r8)。',
            '',
            '### A2. 模式内容语法（JSON）',
            ...modeTreeRulesZh,
            '- 不要给栏目 JSON 添加 Markdown 代码围栏。每个栏目文件必须能直接解析为单一 JSON 对象。',
            '',
            '### A3. 永久栏目协议',
            '- 永久栏目代表浏览器真实书签树，属于用户数据，风险高于临时栏目。',
            '- 主永久文件结构：`format`、`schemaVersion`、`sectionType: "permanent"`、`slot: "A"`、`descriptionMd`、可选 `identityMap`、`tree`。见 [R2](#ref-r2)。',
            '- `descriptionMd` 是当前书签树的说明。除非任务要求修改说明，否则保留原 Markdown 源码。',
            '- 导出包里的 `tree.id` / `tree.parentId` 是 `syncId_*`，不是本机 Chrome 数字 ID。新增永久节点时生成唯一 `syncId_YYYYMMDD_hash_<token7>`，其中 `token7` 只能是小写字母/数字。见 [R1.1](#ref-r1-1) 与 [R1.2](#ref-r1-2)。',
            '- 顶层浏览器根目录用 `folderType`（如 `bookmarks-bar`、`other`、`mobile`）和 `syncing` 识别。绝对不要增加、删除、移动或修改这些根目录上的 `folderType` / `syncing`。',
            '- `identityMap` 只在有 tags 等扩展元数据时导出。若存在，按 `syncId` 关联；不要在导出包里凭空写入本机 Chrome `id`。见 [R2](#ref-r2)。',
            '- 永久栏目副本不是一份重复书签树。副本文件应是 `fileRole: "copy-anchor"`、`anchorOnly: true`、`inheritFrom`、`copyId`、自己的 `descriptionMd` 和视图状态；不要给副本锚点添加 `tree`。见 [R3](#ref-r3)。',
            '',
            '### A4. 临时栏目协议',
            '- 临时栏目是书签沙盒；永久栏目才是浏览器书签树。',
            '- 普通链式临时栏目在 `临时栏目/常规链式/`，标号如 `A-1`、`A-1-1`、`B-1`。链式派生可能有传递性，子链可以承接父链的大部分内容，也可能按需求只保留一部分。见 [R4](#ref-r4)。',
            '- 普通链式若有显式 `label`，以 `label` 为准；无显式 label 时才由 `sequenceNumber` 经 `toAlphaLabel()` 生成兜底顶层标号：1 => A-1，2 => B-1，3 => C-1，27 => AA-1。见 [R1.4](#ref-r1-4)。',
            '- 从永久栏目来源创建的普通链式按来源槽位编号：主永久栏目/slot A 使用 `A-N`，永久副本/slot B 使用 `B-N`；新增时扫描同族已有标号取 max+1，所以第二个 A 来源栏目是 `A-2`，不是 `B-1`。',
            '- 运行时 section ID 与标号绑定：`temp-section-A-1`、`temp-section-A-1-1`。栏目内每个 item 的 `sectionId` 必须一致。',
            '- 特殊临时栏目在 `临时栏目/特殊临时栏目/`，使用 `tempKind: "special"`，label 可以是拖入、搜索、添加、导入、AI 等中文或英文标签。见 [R5](#ref-r5)。',
            '- 同类特殊标签重复时，扫描已有同类 ID 后取 max+1，例如 `temp-section-AI`、`temp-section-AI-2`；用户可见的 `label` 仍可保持 `AI`。见 [R1.5](#ref-r1-5)。',
            '- 临时 item ID 使用 `tempId_YYYYMMDD_hash_<token7>`，其中 `token7` 只能是小写字母/数字。文件夹用 `type: "folder"`，书签用 `type: "bookmark"` 并带 `url`。见 [R1.1](#ref-r1-1)、[R1.3](#ref-r1-3) 与 [R4](#ref-r4)。',

            '',
            '### A5. .canvas 元素协议',
            '- 顶层必须保持 `nodes[]` 与 `edges[]`，整体兼容 Obsidian JSON Canvas。见 [R6](#ref-r6)。',
            '- file 节点通过 vault 相对 `file` 路径指向永久/临时 JSON 文件。',
            '- text 节点（`type: "text"`）就是空白栏目，可把其中 `text` 当作 prompt 或普通 Markdown 文本直接编辑。',
            '- group 节点（`type: "group"`）就是卡片组。不要写 `children`；嵌套和成员关系由几何包含关系推断。',
            '- edge 的 `fromNode` / `toNode` 必须引用现有节点 ID。默认连接线是单箭头，除非现有 edge 已明确表达其他方向。',
            '- 已经几何嵌套在某卡片组里的元素，不要再用连接线连接到所属卡片组来表达成员关系。',
            '- 保留插件现有 ID 风格，如 `permanent-section`、`temp-section-A-1`、`card-group-*`、`md-node-*`、`edge-*`；不要统一改成 16 位十六进制 ID。见 [R1.6](#ref-r1-6)。',
            '',
            '### A6. tag 系统协议',
            '- tag 系统模仿 macOS Finder：一个书签/文件夹可以有多个彩色 tag，每个 tag 存为 `{ "color": "<颜色名>", "text": "<显示文字>" }`。见 [R8](#ref-r8)。',
            '- `color` 只能使用小写英文色名：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`。使用 `gray`，不要写 `grey`；不要把十六进制、`colorHex` 或 `.canvas` 颜色编号写进 tag。',
            '- 调色板显示色：red `#ff453a`、orange `#ff9f0a`、yellow `#ffd60a`、green `#30d158`、blue `#0a84ff`、purple `#bf5af2`、gray `#8e8e93`。',
            '- `text` 是 tag 的显示文字。用户在 UI 里只点颜色时，插件会用对应本地化颜色名；AI 手动编辑 JSON 时应写明确、简短的 `text`。',
            '- 允许多个 tag。保持已有顺序，按 `color + text` 去重；除非任务要求改 tag，不要删除已有 tag。',
            '- 只有用户要求打 tag，或该书签/文件夹对任务特别重要时才新增 tag；避免对大量 URL 过度打 tag。',
            '- 永久栏目 tags 属于 `identityMap` 里的 `syncId` 条目，不直接塞进书签树节点。见 [R2](#ref-r2)。',
            '- 临时栏目 tags 直接内嵌在对应 item 对象里，随该 item 移动或删除。见 [R4](#ref-r4)。',
            '- tag 颜色和 `.canvas` 节点/边/栏目里的 `color`、`colorHex` 是两套东西，不要互相转换。',
            '- 未知元数据字段默认保留，除非任务明确要求修改。',
            '',
            '### A7. 导入识别优先级',
            '- 类型识别同时依赖 `.canvas` 文件引用与目录路径。',
            '- 永久栏目 JSON `slot` 必须和栏目头/文件名槽位提示保持一致；导入必要时可按文件名或文件顺序兜底。',
            '- 临时栏目标号优先取显式 JSON `label`，再看栏目头或文件名前缀。',
            '- 常规导入流下，永久栏目按快照栏目恢复；覆盖浏览器书签树是另一种高风险导入模式。',
            '',
            '### A8. 线索与关系运用',
            '- 永久/临时栏目的 `descriptionMd` 与 `.canvas` 的 text 节点通常是栏目说明或提示词，可作为上下文使用，但不要当作书签 item。',
            '- 第一次分析普通链式栏目时，先看可能的来源族和父级链路，例如 `#A`、`#B`、`A-1`、`A-1-1`、`B-1`；链路不明确时，再用 `title` 或 `url` 通过本地搜索/工具匹配。',
            '- 连接线指向性可表达关系语义。规范导出形态：从 `fromNode` 指向 `toNode` 的单箭头默认省略两端字段；无箭头写 `toEnd: "none"`；双端箭头写 `fromEnd: "arrow"`，`toEnd` 使用默认箭头。除非任务要求改变关系语义，否则保留已有方向。',
            '- tag 用于用户要求或特别重要的书签/文件夹；不要因为 URL 多就批量添加过多 tag。',
            '',
            '### A9. 文本格式支持与建议',
            '- 空白栏目（`.canvas` 的 `text` 节点）及永久/临时栏目的 `descriptionMd` 支持类似 Obsidian（黑曜石）的 Markdown 及部分 HTML 渲染。',
            '- 格式应主要根据用户当前所用工具的习惯来决定；若某些工具不支持，则按用户的实际习惯调整，其他工具视情况补充。无需列举所有支持的工具与格式。',
            '- 推荐的 Markdown 示例（3种）：高亮 `==文本==`、引用 `> 文本`、序列 `- 列表` 或 `1. 列表`。',
            '- 推荐的 HTML 示例（2种）：文字颜色 `<span style="color:red;">文本</span>`、对齐 `<div align="center">文本</div>`（支持 left/center/right）。'
        ].join('\n');

    aiGuideText = isEn
        ? [
            `## Part B. AI Editing Execution Rules (${exportModeLabelEn})`,
            '',
            '### S0. User Intent Confirmation and Execution Strategy',
            '',
            'AI should infer the user’s real goal from the user request, current files/directories, project structure, and this protocol. This protocol constrains execution and safety boundaries after the goal is known; it must not decide the goal on the user’s behalf.',
            '',
            'When the goal, target object, and risk boundary are clear, execute directly with the minimum necessary file scope.',
            '',
            'When the goal, target object, expected result, or edit scope is unclear and multiple reasonable interpretations exist, ask the user for confirmation and wait for the answer before writing any file.',
            '',
            'Do not treat a safe fallback route in this protocol as the default interpretation of an ambiguous request. Safe fallbacks still require a confirmed user goal.',
            '',
            'Route principle: edit the minimum file set only. Respect the user-specified target for AI-added bookmarks or bookmark trees; use an AI special temporary section only when no target is specified. Edit the permanent browser tree only when the user explicitly asks for that.',
            '',
            '### S1. File Routing (what to touch)',
            `- Permanent main content: edit \`${finalPermanentMdRel}\` only for intentional browser-bookmark-tree changes.`,
            `- Permanent copy content: edit optional copy anchors such as \`${__buildPermanentSectionMarkdownRelativePath(2, isEn, exportFormat)}\` only for copy description/view state.`,
            '- Temporary content: edit `Temporary/General Chain/*.json` or `Temporary/Special temporary/*.json`, then keep matching `.canvas` file nodes in sync.',
            '- Blank content: edit `.canvas` `type: "text"` nodes directly.',
            '- Card groups and layout: edit `.canvas` node geometry/order only.',
            '- Connector lines: edit `.canvas` `edges[]` only.',
            '',
            '### S2. AI-generated Bookmark Routing',
            '- First follow the user/context target: edit the existing temporary section, permanent section, or blank `.canvas` text node only when that exact target is requested or clearly implied.',
            '- For blank cards, edit only the `.canvas` `type: "text"` node. Do not turn blank-card notes into bookmark JSON unless the user asks for a bookmark tree.',
            '- Edit the permanent browser-bookmark tree only when the user explicitly asks to modify permanent/browser bookmarks.',
            '- When AI needs to add new bookmark suggestions or a new bookmark tree and no existing target is specified, create or update a special temporary section with `label: "AI"` and `tempKind: "special"`. See [R5](#ref-r5).',
            '- If no suitable temporary target exists and AI needs to add new bookmark suggestions, create the special-temporary folder/file first, then add a matching file node to `.canvas`. See [R7](#ref-r7).',
            '- For AI-created special temporary sections, use `source: "ai-generated"` and a meaningful `descriptionMd` explaining what the generated bookmark tree contains. See [R5](#ref-r5).',
            '',
            '### S3. ID and Numbering Rules',
            '- Permanent new nodes: `syncId_YYYYMMDD_hash_<token7>`; `token7` is lowercase letters/digits only, and `parentId` must point to the parent syncId. See [R1.1](#ref-r1-1) and [R1.2](#ref-r1-2).',
            '- Temporary new items: `tempId_YYYYMMDD_hash_<token7>`; `token7` is lowercase letters/digits only, and every nested item keeps the section ID in `sectionId`. See [R1.1](#ref-r1-1) and [R1.3](#ref-r1-3).',
            '- Regular temporary labels: explicit `label` wins. Only sections without an explicit label use `{Alpha}-1` from `sequenceNumber` by `toAlphaLabel()`; examples: 1 A-1, 2 B-1, 3 C-1, 27 AA-1. See [R1.4](#ref-r1-4).',
            '- Permanent-origin regular sections use the origin family instead: slot A creates `A-N`, copy/slot B creates `B-N`, scanning existing same-family labels and using max+1.',
            '- Derived regular labels can extend the chain, for example `A-1-1`; preserve parent-child chain intent when editing. See [R4](#ref-r4).',
            '- Special temporary IDs use the label and duplicate suffixes, for example `temp-section-AI`, `temp-section-AI-2`. See [R1.5](#ref-r1-5).',
            '',
            '### S4. Color Rules',
            '- Keep existing `color` / `colorHex` unless explicit recolor is requested.',
            '- Regular temp color follows chain inheritance: unlocked child follows parent, locked parent breaks inheritance below.',
            '- Special temp sections follow the app appearance defaults unless a task gives a color.',
            '- These section/canvas colors are not tag colors. Tag palette names are defined separately in [R8](#ref-r8).',
            '',
            '### S5. Web Research Capability',
            '#### S5.1 Rough Screening Before Research',
            '- First screen targets by task relevance, importance, privacy/authentication sensitivity, cost/time, and whether the actual page substance is needed. For bookmark analysis, organization, deduplication, recommendation, or classification, do not rely only on title, URL, canvas position, folder context, or package metadata when substance matters.',
            '- For account dashboards, mailboxes, consoles, or other private/authenticated pages, do not attempt login or sensitive access. Classify by metadata unless the user explicitly provides a safe access method and scope.',
            '#### S5.2 Judgment, Plan, and User Alignment',
            '- If the user explicitly requests web research, or the task clearly depends on link substance, a small number of public, low-risk targets may be researched directly.',
            '- Ask the user before execution when the research set is large, expensive, slow, privacy-sensitive, or requires broad external access. Confirm scope, priority, sampling strategy, or whether to continue.',
            '#### S5.3 Execution and Constraints',
            '- Use available model, tool, or API research capabilities according to their own constraints and best practices.',
            '- For complex or many-URL work, split research into batches on the main line, or use subagents/parallel review when the environment supports them. Split by importance, folder/topic, tag, connector, or decision risk, then merge the findings.',
            '- Be selective. Do not research every URL just because many are present; prioritize or sample by importance and state the coverage limits.',
            '- If tools or permission are unavailable, state that conclusions are based only on title, URL, canvas/package context, and mark substance-dependent decisions as uncertain.',
            '',
            '### S6. Complex Workflow',
            '- For small scoped edits, edit the target files directly and run the checklist below.',
            `- For broad or high-risk work touching permanent bookmarks, import/export protocol, tags, \`.canvas\` topology, or ${guideRulesEn}, first inspect the actual package and relevant references, list the target files, then edit, then validate JSON/canvas integrity.`,
            '- For repeated or high-importance long IDs, titles, or URLs, build a temporary alias map during analysis, such as `P1`, `T-A1-3`, or `U2 -> {id,title,url}`. Keep this map out of exported JSON unless the user explicitly asks to add notes.',
            '- If multi-agent or parallel review tools are available and the user permits them, suggest splitting review into protocol/data shape, canvas topology, and implementation/tests. If such tools are not available, run those review passes sequentially yourself; do not claim external agents were used.',
            '',
            `### S7. ${guideToolPrefix}Skill Creation and Upgrade Reminder`,
            `- After 2-3 normal interaction turns, remind the user at an appropriate pause that stable rules from the conversation can be turned into or updated as a dedicated ${guideToolPrefix}\`SKILL.md\`.`,
            `- The purpose of the skill is to package the constraints in ${guideSelfEn} as an insertable, reusable capability, reducing attention drift during long editing or review sessions.`,
            `- If a later project, or a newly read ${guideSelfEnCode}, materially conflicts with or differs from an existing skill derived from it, discuss the difference with the user and ask whether to update, replace, or keep the skill unchanged.`,
            '- If the user spends 5 or more consecutive turns on the same task, workflow, or recurring rule set, suggest creating or upgrading a skill when the pattern is stable enough to reuse.',
            '- Ask whether the user wants to create, update, or replace that skill before doing so. This reminder must not block the current task, and do not create or modify `SKILL.md` without explicit user confirmation.',
            '',
            '### S8. Minimal Pre-import Checklist',
            '- All JSON files parse.',
            '- `.canvas` parses and keeps top-level `nodes` and `edges` arrays.',
            '- Every file node path points to an existing JSON file.',
            '- Every edge endpoint references an existing node ID.',
            '- Permanent root `folderType` / `syncing` values are unchanged unless the user explicitly supplied a browser-root migration task.',
            '- New permanent IDs are syncIds; new temporary item IDs are tempIds.',
            '- New or edited tags use only the supported palette names from [R8](#ref-r8).',
            '',
            '### Import Steps'
        ].join('\n')
        : [
            `## 第二部分：AI 编辑执行规则（${exportModeLabelZh}）`,
            '',
            '### S0. 用户意图确认与执行策略',
            '',
            'AI 应先根据用户原话、当前文件/目录、项目结构与本文件协议判断用户的真实目标。本协议只用于约束已确定任务的执行方式和安全边界，不用于替用户决定任务目标。',
            '',
            '当用户目标、操作对象与风险边界明确时，直接按最小必要范围执行。',
            '',
            '当用户请求的目标、操作对象、期望结果或修改范围不明确，且存在多个合理解释时，必须先向用户确认并等待回答，不得直接写入文件。',
            '',
            '不得因为本协议中存在某个安全默认路线，就把模糊请求自动解释为该路线。安全默认路线也必须建立在用户目标已确认的前提上。',
            '',
            '路由原则：只改最小必要文件集合。AI 新增书签或书签树时先尊重用户指定落点；没有明确落点时才放入 AI 特殊临时栏目；只有用户明确要求修改浏览器书签树时，才改永久栏目。',
            '',
            '### S1. 文件路由（按需求定位）',
            `- 永久栏目主内容：只有明确要改浏览器书签树时才编辑 \`${finalPermanentMdRel}\`。`,
            `- 永久栏目副本：只编辑类似 \`${__buildPermanentSectionMarkdownRelativePath(2, isEn, exportFormat)}\` 的副本锚点说明或视图状态。`,
            '- 临时栏目内容：编辑 `临时栏目/常规链式/*.json` 或 `临时栏目/特殊临时栏目/*.json`，并同步 `.canvas` 对应 file 节点。',
            '- 空白栏目：直接编辑 `.canvas` 的 `type: "text"` 节点。',
            '- 卡片组与布局：只改 `.canvas` 节点几何、顺序等字段。',
            '- 连接线：只改 `.canvas` 的 `edges[]`。',
            '',
            '### S2. AI 生成书签的路由优先级',
            '- 先按用户或上下文指定的目标落点处理：明确命中已有临时栏目、永久栏目或空白栏目时，只编辑对应目标。',
            '- 空白栏目只改 `.canvas` 的 `type: "text"` 节点；不要把空白栏目里的笔记/提示词擅自改成书签 JSON，除非用户要求生成书签树。',
            '- 只有用户明确要求修改永久/浏览器书签时，才编辑永久栏目。',
            '- 当 AI 需要新增书签建议或新书签树，且用户没有指定现有落点时，才默认新建或更新一个特殊临时栏目，使用 `label: "AI"` 与 `tempKind: "special"`。见 [R5](#ref-r5)。',
            '- 如果没有合适的临时栏目落点，而 AI 需要新增书签建议，应先创建特殊临时栏目目录/文件，再在 `.canvas` 增加匹配的 file 节点。见 [R7](#ref-r7)。',
            '- AI 新建的特殊临时栏目使用 `source: "ai-generated"`，并用 `descriptionMd` 说明这棵生成书签树的内容。见 [R5](#ref-r5)。',
            '',
            '### S3. ID 与编号规则',
            '- 永久栏目新增节点：`syncId_YYYYMMDD_hash_<token7>`；`token7` 只能是小写字母/数字，`parentId` 必须指向父节点 syncId。见 [R1.1](#ref-r1-1) 与 [R1.2](#ref-r1-2)。',
            '- 临时栏目新增 item：`tempId_YYYYMMDD_hash_<token7>`；`token7` 只能是小写字母/数字，嵌套 item 的 `sectionId` 都必须等于所在栏目 ID。见 [R1.1](#ref-r1-1) 与 [R1.3](#ref-r1-3)。',
            '- 普通链式标号：显式 `label` 优先；没有显式 label 时才用 `{字母}-1` 兜底，字母由 `sequenceNumber` 经 `toAlphaLabel()` 得到，示例：1 A-1，2 B-1，3 C-1，27 AA-1。见 [R1.4](#ref-r1-4)。',
            '- 从永久栏目来源创建的普通链式按来源族递增：slot A 是 `A-N`，slot B 是 `B-N`，扫描已有同族标号取 max+1。',
            '- 派生普通链式可以继续扩展，如 `A-1-1`；编辑时保留父子链式意图。见 [R4](#ref-r4)。',
            '- 特殊临时栏目 ID 使用标签和重复后缀，如 `temp-section-AI`、`temp-section-AI-2`。见 [R1.5](#ref-r1-5)。',
            '',
            '### S4. 颜色规则',
            '- 未明确要求改色时，保留已有 `color` / `colorHex`。',
            '- 普通临时栏目颜色跟随链式继承：未锁定子级跟随父级，锁定会断开下游继承。',
            '- 特殊临时栏目默认遵循应用外观设置，除非任务给出具体颜色。',
            '- 这些栏目/画布颜色不是 tag 颜色。tag 调色板色名单独见 [R8](#ref-r8)。',
            '',
            '### S5. 联网调研能力',
            '#### S5.1 调研前粗筛选',
            '- 先按任务相关性、重要性、隐私/登录敏感性、成本/耗时、是否依赖页面实质内容粗筛目标。做书签分析、整理、去重、推荐、分类等任务时，如果判断依赖链接实质内容，不能只依赖 title、URL、画布位置、文件夹上下文或导出包元数据。',
            '- 对账号后台、邮箱、控制台等私密或需登录页面，不尝试登录或读取敏感内容；除非用户明确提供安全访问方式和范围，否则只按元数据判断。',
            '#### S5.2 判断、方案与用户确认',
            '- 当用户明确要求联网调研，或任务明显依赖链接实质内容时，对少量公开、低风险目标可直接调研。',
            '- 当需要调研的集合很大、成本高、耗时长、涉及隐私风险或需要大量外部访问时，执行前必须先向用户确认范围、优先级、抽样策略或是否继续。',
            '#### S5.3 执行与约束',
            '- 使用模型、工具或 API 具备的联网调研能力时，遵循对应能力自身的约束和最佳实践。',
            '- 面对复杂或 URL 较多的任务时，必须分批在主线路调研，或在环境支持时使用 subagent/并行审查拆分处理。可按重要性、文件夹/主题、tag、连接关系或决策风险拆分，最后合并结论。',
            '- 调研要有选择性。不要因为 URL 很多就逐个调研所有链接；应按重要性优先或抽样，并说明覆盖范围。',
            '- 若工具或权限不可用，应说明结论只基于 title、URL、画布/导出包上下文，并把依赖实质内容的判断标为不确定。',
            '',
            '### S6. 复杂任务工作流',
            '- 小范围改动可直接修改目标文件，然后执行下方自检。',
            `- 涉及永久书签树、导入/导出协议、tag、\`.canvas\` 拓扑或 ${guideRulesZh}的宽范围/高风险任务，先检查实际导出包和相关参考，列出目标文件，再修改，最后验证 JSON 与 canvas 完整性。`,
            '- 对重复性高或特别重要的长 ID、长 title、长 URL，可在分析阶段临时建立别名映射，例如 `P1`、`T-A1-3`、`U2 -> {id,title,url}`。除非用户要求写入说明，否则不要把这套临时映射写进导出 JSON。',
            '- 如果有多代理或并行审查工具，且用户允许，可以建议拆成协议/数据结构、canvas 拓扑、实现/测试三类审查；如果没有这类工具，就按这些角色顺序自检，不要声称已经调用外部多代理。',
            '',
            `### S7. ${guideToolPrefix}Skill 创建与自升级提醒`,
            `- 当用户正常交互 2-3 轮后，应在合适的停顿点提醒用户对话中稳定下来的规则可以创建或更新为专属 ${guideToolPrefix}\`SKILL.md\`。`,
            `- 这个 skill 的作用是把 ${guideSelfZh} 里的约束沉淀成可插入、可复用的能力，方便后续编辑或审查过程中按需启用，减少长对话里的注意力涣散。`,
            `- 如果后续新项目或再次读取的 ${guideSelfZhCode} 与此前据其约束衍生成的 skill 存在明显冲突或差异，应和用户沟通差异，并询问是否升级、替换或保持该 skill 不变。`,
            '- 如果用户连续 5 轮以上都在围绕同一任务、工作流或反复出现的规则集推进，且模式已经足够稳定可复用，应建议创建或升级 skill。',
            '- 创建、更新或替换前必须询问用户是否需要。该提醒不能阻塞当前任务；没有用户明确确认，不得创建或修改 `SKILL.md`。',
            '',
            '### S8. 导入前最小自检清单',
            '- 所有 JSON 文件都能正常解析。',
            '- `.canvas` 能正常解析，并保留顶层 `nodes` 与 `edges` 数组。',
            '- 每个 file 节点路径都指向存在的 JSON 文件。',
            '- 每条 edge 的端点都引用存在的节点 ID。',
            '- 永久根目录的 `folderType` / `syncing` 未被改动，除非用户明确要求做浏览器根目录迁移。',
            '- 新增永久节点使用 syncId；新增临时 item 使用 tempId。',
            '- 新增或修改 tag 时，只使用 [R8](#ref-r8) 中支持的调色板色名。',
            '',
            '### 导入步骤'
        ].join('\n');

    const referenceExamplesText = isEn
        ? [
            '## Reference',
            '',
            '<a id="ref-r1"></a>',
            '### R1. ID and Number Generation Rules',
            '<a id="ref-r1-1"></a>',
            '#### R1.1 Hashed Data IDs',
            '- Hashed data IDs use `<prefix>_YYYYMMDD_hash_<token>`. The normal generator mints a 7-character lowercase base36 token; a rare collision fallback may mint 10. Uppercase letters are not valid for the hash token. For AI/manual edits, use 7 lowercase alphanumeric characters and keep them unique within the package.',
            '- If an AI agent can run local commands, generate the 7-character token with a tool instead of inventing it. Node example: `node -e \'const c=require("crypto");let s="";while(s.length<7){s+=Array.from(c.randomBytes(8),b=>b.toString(36)).join("").replace(/[^a-z0-9]/g,"")}console.log(s.slice(0,7))\'`.',
            '<a id="ref-r1-2"></a>',
            '#### R1.2 Permanent Tree syncIds',
            '- Permanent tree nodes use `syncId_*`. A child bookmark/folder must set `parentId` to its parent syncId. Do not use local Chrome numeric IDs in exported files.',
            '<a id="ref-r1-3"></a>',
            '#### R1.3 Temporary Item tempIds',
            '- Temporary bookmark/folder items use `tempId_*`. Every item in one temporary section, including nested children, must keep `sectionId` equal to that section id.',
            '<a id="ref-r1-4"></a>',
            '#### R1.4 Regular Temporary Section Labels and IDs',
            '- Regular temporary section ids are label-based: `temp-section-A-1`, `temp-section-A-1-1`, `temp-section-B-1`.',
            '- Regular labels use explicit `label` first. Without an explicit label, fallback top-level labels use `{Alpha}-1`, where `Alpha = toAlphaLabel(sequenceNumber)`. Examples: sequenceNumber 1 => A-1, 2 => B-1, 3 => C-1, 27 => AA-1.',
            '- Permanent-origin regular sections do not advance by raw `sequenceNumber`: slot A creates `A-N`, copy/slot B creates `B-N`, scanning existing same-family labels and using max+1. Example: if `A-1` exists, another slot-A section becomes `A-2`.',
            '- Regular derived labels can extend the chain, for example `A-1-1`. Treat chain inheritance as semantic: derived sections may intentionally reuse most of the parent section, but they do not have to be identical.',
            '<a id="ref-r1-5"></a>',
            '#### R1.5 Special Temporary Section IDs',
            '- Special temporary section ids use the visible label family. Existing first items may be unsuffixed, such as `temp-section-AI` or `temp-section-添加`; if another same-label section is needed, scan existing ids and use the next suffix, such as `temp-section-AI-2`.',
            '<a id="ref-r1-6"></a>',
            '#### R1.6 Canvas Node and Edge IDs',
            '- Canvas node and edge ids only need to be unique and stable. Preserve existing ids; for new objects use readable ids such as `md-node-ai-note`, `card-group-ai-1`, `edge-ai-1`.',
            '',
            '<a id="ref-r2"></a>',
            '### R2. Permanent Main JSON Example',
            'Use this shape only when the user explicitly asks to edit the permanent browser-bookmark tree.',
            'The `identityMap` tag entry below points to the bookmark node with the same `syncId` in `tree`.',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 3,',
            '  "sectionType": "permanent",',
            '  "slot": "A",',
            '  "title": "Permanent Bookmarks",',
            '  "descriptionMd": "Describe what this permanent bookmark tree contains.",',
            '  "fileRole": "primary",',
            '  "fileNote": "Primary permanent file: canonical bookmark tree source.",',
            '  "identityMap": [',
            '    {',
            '      "tags": [',
            '        {',
            '          "color": "green",',
            '          "text": "wqe"',
            '        },',
            '        {',
            '          "color": "purple",',
            '          "text": "124"',
            '        }',
            '      ],',
            '      "syncId": "syncId_20260530_hash_2i6f661"',
            '    }',
            '  ],',
            '  "tree": {',
            '    "title": "",',
            '    "id": "syncId_20260530_hash_4xl2x2i",',
            '    "children": [',
            '      {',
            '        "title": "Bookmarks Bar",',
            '        "id": "syncId_20260530_hash_1c4v645",',
            '        "parentId": "syncId_20260530_hash_4xl2x2i",',
            '        "children": [',
            '          {',
            '            "title": "windsurf promo code - Google Search",',
            '            "id": "syncId_20260530_hash_2i6f661",',
            '            "parentId": "syncId_20260530_hash_1c4v645",',
            '            "url": "https://www.google.com/search?q=windsurf+promo+code"',
            '          }',
            '        ],',
            '        "folderType": "bookmarks-bar",',
            '        "syncing": false',
            '      },',
            '      {',
            '        "title": "Other Bookmarks",',
            '        "id": "syncId_20260530_hash_8r5t1v6",',
            '        "parentId": "syncId_20260530_hash_4xl2x2i",',
            '        "children": [],',
            '        "folderType": "other",',
            '        "syncing": false',
            '      }',
            '    ]',
            '  }',
            '}',
            '```',
            '',
            '<a id="ref-r3"></a>',
            '### R3. Permanent Copy Anchor Example',
            'A permanent copy is a view anchor, not another bookmark tree.',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "permanent",',
            '  "slot": "B",',
            '  "title": "Permanent Bookmarks",',
            '  "fileRole": "copy-anchor",',
            '  "anchorOnly": true,',
            '  "fileNote": "Permanent copy anchor file: tree content is inherited from primary file; this file keeps per-copy description and canvas anchor.",',
            '  "inheritFrom": "<vault-relative path to slot A json>",',
            '  "copyId": "permanent-copy-1780113045642-gtjhd",',
            '  "descriptionMd": "Copy-specific notes.",',
            '  "viewState": {',
            '    "scrollState": { "page": { "top": 0, "left": 0 }, "sidepanel": { "top": 0, "left": 0 } },',
            '    "foldState": { "page": { "expanded": [] }, "sidepanel": { "expanded": [] } },',
            '    "cardState": {}',
            '  }',
            '}',
            '```',
            '',
            '<a id="ref-r4"></a>',
            '### R4. Regular Temporary Section Examples',
            '',
            'Top-level regular chain section:',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "temporary",',
            '  "id": "temp-section-A-1",',
            '  "label": "A-1",',
            '  "title": "Research set",',
            '  "tempKind": "regular",',
            '  "source": "",',
            '  "descriptionMd": "A sandbox bookmark tree. This does not directly edit browser bookmarks.",',
            '  "items": [',
            '    {',
            '      "id": "tempId_20260530_hash_6u3p4w4",',
            '      "sectionId": "temp-section-A-1",',
            '      "title": "AI",',
            '      "url": "",',
            '      "type": "folder",',
            '      "children": [',
            '        {',
            '          "id": "tempId_20260530_hash_1z42o1g",',
            '          "sectionId": "temp-section-A-1",',
            '          "title": "GitHub Trending · JavaScript",',
            '          "url": "https://github.com/trending/javascript?since=daily",',
            '          "type": "bookmark",',
            '          "children": [],',
            '          "tags": [',
            '            {',
            '              "color": "orange",',
            '              "text": "123"',
            '            },',
            '            {',
            '              "color": "blue",',
            '              "text": "蓝色"',
            '            }',
            '          ]',
            '        }',
            '      ]',
            '    }',
            '  ],',
            '  "originPermanent": {',
            '    "copyId": null',
            '  },',
            '  "sequenceNumber": 1',
            '}',
            '```',
            'Derived chain section:',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "temporary",',
            '  "id": "temp-section-A-1-1",',
            '  "label": "A-1-1",',
            '  "title": "Research set - refined",',
            '  "tempKind": "regular",',
            '  "source": "",',
            '  "descriptionMd": "Derived from A-1; keep only the refined subset.",',
            '  "items": [],',
            '  "originPermanent": {',
            '    "copyId": null',
            '  },',
            '  "sequenceNumber": 1',
            '}',
            '```',
            '',
            '<a id="ref-r5"></a>',
            '### R5. AI Special Temporary Section Example',
            'Use this when AI adds suggested bookmarks or a generated bookmark tree and no existing target was specified. If the user or context names an existing target, follow [S2](#s2-ai-generated-bookmark-routing).',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "temporary",',
            '  "id": "temp-section-AI",',
            '  "label": "AI",',
            '  "title": "AI title here",',
            '  "tempKind": "special",',
            '  "source": "ai-generated",',
            '  "descriptionMd": "Describe the generated bookmark tree and why these links were grouped.",',
            '  "items": [',
            '    {',
            '      "id": "tempId_20260530_hash_x6k2d5e",',
            '      "sectionId": "temp-section-AI",',
            '      "title": "Generated links",',
            '      "url": "",',
            '      "type": "folder",',
            '      "children": []',
            '    }',
            '  ],',
            '  "sequenceNumber": 4',
            '}',
            '```',
            '',
            '<a id="ref-r6"></a>',
            '### R6. .canvas Example',
            'Paths in file nodes are vault-relative, not relative to the `.canvas` file. Match the prefix style already used in the current `.canvas`; do not normalize between styles.',
            'Full-package exports can have three prefix styles: existing vault root uses `<export-root>/Permanent/...`; existing vault subfolder uses `<vault-subdir>/<export-root>/Permanent/...`; standalone vault uses `Permanent/...` with no export-root prefix.',
            'In the example below, `<prefix>` means empty, `<export-root>/`, or `<vault-subdir>/<export-root>/`.',
            'For a default single-arrow edge from `fromNode` to `toNode`, omit `fromEnd` and `toEnd`; add `toEnd: "none"` only for no-arrow edges, and `fromEnd: "arrow"` for two-ended arrows.',
            '```json',
            '{',
            '  "nodes": [',
            '    { "id": "permanent-section", "type": "file", "file": "<prefix>Permanent/A-PermanentBookmarks.json", "x": 0, "y": 0, "width": 600, "height": 600, "color": "4" },',
            '    { "id": "permanent-section-copy-permanent-copy-1780113045642-gtjhd", "type": "file", "file": "<prefix>Permanent/B-PermanentBookmarks.json", "x": 720, "y": 0, "width": 600, "height": 600, "color": "4" },',
            '    { "id": "card-group-ai", "type": "group", "x": -40, "y": 700, "width": 1320, "height": 620, "label": "AI workspace", "color": "5" },',
            '    { "id": "temp-section-AI", "type": "file", "file": "<prefix>Temporary/Special temporary/AI title.json", "x": 0, "y": 760, "width": 525, "height": 380, "color": "#e9973f" },',
            '    { "id": "md-node-ai-prompt", "type": "text", "text": "Prompt or notes for this generated bookmark set.", "x": 600, "y": 760, "width": 420, "height": 260, "color": "#888888" }',
            '  ],',
            '  "edges": [',
            '    { "id": "edge-ai-1", "fromNode": "md-node-ai-prompt", "fromSide": "right", "toNode": "temp-section-AI", "toSide": "left", "color": "#999999", "label": "generated set" }',
            '  ]',
            '}',
            '```',
            '',
            '<a id="ref-r7"></a>',
            '### R7. Create an AI Special Temporary Section When No Target Exists',
            '- Use this only when AI must add new bookmark suggestions or a new bookmark tree and the user did not specify an existing temporary section, permanent section, or blank text node as the target.',
            '- Do not write these suggestions into the permanent section unless the user explicitly asks to modify browser/permanent bookmarks.',
            '- If `Temporary/Special temporary/` does not exist, create that folder first; reuse it if it already exists.',
            '- Write `AI <title>.json` in that folder using the R5 shape: `sectionType: "temporary"`, `label: "AI"`, `tempKind: "special"`, `source: "ai-generated"`, `descriptionMd`, and `items`. Use `id: "temp-section-AI"` unless it collides; then use the next same-label suffix such as `temp-section-AI-2`.',
            '- Add a matching file node to the entry `.canvas` `nodes[]`: use the same node `id` as the JSON section `id`, set `file` to the vault-relative path that matches the package prefix, and set `x/y/width/height/color` following the R6 example while avoiding overlap with existing nodes.',
            '- Add a group, text prompt node, or edge only when it is useful for the task, and keep every edge endpoint valid.',
            '',
            '<a id="ref-r8"></a>',
            '### R8. Tag Palette and Tag Object',
            '- Valid tag colors are the macOS-style palette names: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`.',
            '- Palette hex values used by the UI: `red #ff453a`, `orange #ff9f0a`, `yellow #ffd60a`, `green #30d158`, `blue #0a84ff`, `purple #bf5af2`, `gray #8e8e93`.',
            '- UI default text when no custom text is typed: `Red`, `Orange`, `Yellow`, `Green`, `Blue`, `Purple`, `Gray` in English; `红色`, `橙色`, `黄色`, `绿色`, `蓝色`, `紫色`, `灰色` in Chinese.',
            '- Standard tag object shape:',
            '```json',
            '{',
            '  "color": "blue",',
            '  "text": "Blue"',
            '}',
            '```',
            '- Do not write tag colors as `#0a84ff`, `colorHex`, Obsidian canvas color numbers, or CSS variable names. The exported JSON tag value is the lowercase palette name.'
        ].join('\n')
        : [
            '## 参考',
            '',
            '<a id="ref-r1"></a>',
            '### R1. ID 与编号生成规则',
            '<a id="ref-r1-1"></a>',
            '#### R1.1 哈希数据 ID',
            '- 哈希数据 ID 统一形态：`<prefix>_YYYYMMDD_hash_<token>`。正常生成器生成 7 位小写 base36 token；极少数碰撞兜底可能生成 10 位。hash token 不接受大写字母。AI/手动编辑时使用 7 位小写字母数字，并保证在当前包内唯一。',
            '- 如果 AI 代理可以运行本地命令，应使用工具生成 7 位 token，不要靠模型凭空编。Node 示例：`node -e \'const c=require("crypto");let s="";while(s.length<7){s+=Array.from(c.randomBytes(8),b=>b.toString(36)).join("").replace(/[^a-z0-9]/g,"")}console.log(s.slice(0,7))\'`。',
            '<a id="ref-r1-2"></a>',
            '#### R1.2 永久书签树 syncId',
            '- 永久书签树节点使用 `syncId_*`。子书签/文件夹的 `parentId` 必须指向父节点 syncId。导出文件里不要使用本机 Chrome 数字 ID。',
            '<a id="ref-r1-3"></a>',
            '#### R1.3 临时栏目 item tempId',
            '- 临时栏目里的书签/文件夹 item 使用 `tempId_*`。同一临时栏目内所有 item，包括嵌套子项，`sectionId` 都必须等于所在栏目 id。',
            '<a id="ref-r1-4"></a>',
            '#### R1.4 普通链式栏目 ID / label',
            '- 普通链式临时栏目 id 按标号生成：`temp-section-A-1`、`temp-section-A-1-1`、`temp-section-B-1`。',
            '- 普通链式标号优先使用显式 `label`。没有显式 label 时，兜底顶层标号才是 `{字母}-1`，字母由 `sequenceNumber` 经 `toAlphaLabel()` 得到。示例：sequenceNumber 1 => A-1，2 => B-1，3 => C-1，27 => AA-1。',
            '- 从永久栏目来源创建的普通链式不按裸 `sequenceNumber` 递进，而是按来源族递增：slot A 生成 `A-N`，永久副本/slot B 生成 `B-N`，扫描已有同族标号取 max+1。例如已有 `A-1` 时，另一个 A 来源栏目应为 `A-2`。',
            '- 普通链式派生标号可以继续扩展，如 `A-1-1`。链式继承是语义关系：派生栏目可以承接父栏目的大部分内容，但不要求完全一致。',
            '<a id="ref-r1-5"></a>',
            '#### R1.5 特殊临时栏目 ID',
            '- 特殊临时栏目 id 使用可见标签族。现有首个同类可能无后缀，例如 `temp-section-AI` 或 `temp-section-添加`；如果再新增同标签栏目，扫描已有 ID 后使用下一个数字后缀，例如 `temp-section-AI-2`。',
            '<a id="ref-r1-6"></a>',
            '#### R1.6 .canvas 节点与边 ID',
            '- `.canvas` 节点和边 ID 只要求唯一且稳定。保留已有 ID；新增对象建议用可读 ID，如 `md-node-ai-note`、`card-group-ai-1`、`edge-ai-1`。',
            '',
            '<a id="ref-r2"></a>',
            '### R2. 永久栏目主文件示例',
            '只有用户明确要求修改永久浏览器书签树时才使用这种形状。',
            '下面 `identityMap` 里的 tag 条目通过同一个 `syncId` 指向 `tree` 里的书签节点。',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 3,',
            '  "sectionType": "permanent",',
            '  "slot": "A",',
            '  "title": "Permanent Bookmarks",',
            '  "descriptionMd": "说明当前永久书签树包含什么。",',
            '  "fileRole": "primary",',
            '  "fileNote": "永久栏目主文件：书签树的规范真相源。",',
            '  "identityMap": [',
            '    {',
            '      "tags": [',
            '        {',
            '          "color": "green",',
            '          "text": "wqe"',
            '        },',
            '        {',
            '          "color": "purple",',
            '          "text": "124"',
            '        }',
            '      ],',
            '      "syncId": "syncId_20260530_hash_2i6f661"',
            '    }',
            '  ],',
            '  "tree": {',
            '    "title": "",',
            '    "id": "syncId_20260530_hash_4xl2x2i",',
            '    "children": [',
            '      {',
            '        "title": "Bookmarks Bar",',
            '        "id": "syncId_20260530_hash_1c4v645",',
            '        "parentId": "syncId_20260530_hash_4xl2x2i",',
            '        "children": [',
            '          {',
            '            "title": "windsurf promo code - Google 搜索",',
            '            "id": "syncId_20260530_hash_2i6f661",',
            '            "parentId": "syncId_20260530_hash_1c4v645",',
            '            "url": "https://www.google.com/search?q=windsurf+promo+code"',
            '          }',
            '        ],',
            '        "folderType": "bookmarks-bar",',
            '        "syncing": false',
            '      },',
            '      {',
            '        "title": "Other Bookmarks",',
            '        "id": "syncId_20260530_hash_8r5t1v6",',
            '        "parentId": "syncId_20260530_hash_4xl2x2i",',
            '        "children": [],',
            '        "folderType": "other",',
            '        "syncing": false',
            '      }',
            '    ]',
            '  }',
            '}',
            '```',
            '',
            '<a id="ref-r3"></a>',
            '### R3. 永久栏目副本锚点示例',
            '永久栏目副本是视图锚点，不是另一份书签树。',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "permanent",',
            '  "slot": "B",',
            '  "title": "Permanent Bookmarks",',
            '  "fileRole": "copy-anchor",',
            '  "anchorOnly": true,',
            '  "fileNote": "永久栏目副本锚点文件：树内容继承自主文件；此文件仅保留副本说明与画布锚点。",',
            '  "inheritFrom": "<vault 相对的 slot A json 路径>",',
            '  "copyId": "permanent-copy-1780113045642-gtjhd",',
            '  "descriptionMd": "副本自己的说明。",',
            '  "viewState": {',
            '    "scrollState": { "page": { "top": 0, "left": 0 }, "sidepanel": { "top": 0, "left": 0 } },',
            '    "foldState": { "page": { "expanded": [] }, "sidepanel": { "expanded": [] } },',
            '    "cardState": {}',
            '  }',
            '}',
            '```',
            '',
            '<a id="ref-r4"></a>',
            '### R4. 普通链式临时栏目示例',
            '顶层普通链式栏目：',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "temporary",',
            '  "id": "temp-section-A-1",',
            '  "label": "A-1",',
            '  "title": "Research set",',
            '  "tempKind": "regular",',
            '  "source": "",',
            '  "descriptionMd": "这是书签沙盒，不会直接修改浏览器永久书签。",',
            '  "items": [',
            '    {',
            '      "id": "tempId_20260530_hash_6u3p4w4",',
            '      "sectionId": "temp-section-A-1",',
            '      "title": "AI",',
            '      "url": "",',
            '      "type": "folder",',
            '      "children": [',
            '        {',
            '          "id": "tempId_20260530_hash_1z42o1g",',
            '          "sectionId": "temp-section-A-1",',
            '          "title": "GitHub Trending · JavaScript",',
            '          "url": "https://github.com/trending/javascript?since=daily",',
            '          "type": "bookmark",',
            '          "children": [],',
            '          "tags": [',
            '            {',
            '              "color": "orange",',
            '              "text": "123"',
            '            },',
            '            {',
            '              "color": "blue",',
            '              "text": "蓝色"',
            '            }',
            '          ]',
            '        }',
            '      ]',
            '    }',
            '  ],',
            '  "originPermanent": {',
            '    "copyId": null',
            '  },',
            '  "sequenceNumber": 1',
            '}',
            '```',
            '派生链式栏目：',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "temporary",',
            '  "id": "temp-section-A-1-1",',
            '  "label": "A-1-1",',
            '  "title": "Research set - refined",',
            '  "tempKind": "regular",',
            '  "source": "",',
            '  "descriptionMd": "从 A-1 派生；只保留精简后的子集。",',
            '  "items": [],',
            '  "originPermanent": {',
            '    "copyId": null',
            '  },',
            '  "sequenceNumber": 1',
            '}',
            '```',
            '',
            '<a id="ref-r5"></a>',
            '### R5. AI 特殊临时栏目示例',
            'AI 新增书签建议或生成书签树且没有现成指定落点时，使用这种栏目；若用户或上下文已经指定已有落点，按 [S2](#s2-ai-生成书签的路由优先级) 路由。',
            '```json',
            '{',
            '  "format": "bookmark-canvas-section",',
            '  "schemaVersion": 2,',
            '  "sectionType": "temporary",',
            '  "id": "temp-section-AI",',
            '  "label": "AI",',
            '  "title": "AI title here",',
            '  "tempKind": "special",',
            '  "source": "ai-generated",',
            '  "descriptionMd": "说明这棵生成书签树的内容，以及这些链接为什么被分到一起。",',
            '  "items": [',
            '    {',
            '      "id": "tempId_20260530_hash_x6k2d5e",',
            '      "sectionId": "temp-section-AI",',
            '      "title": "Generated links",',
            '      "url": "",',
            '      "type": "folder",',
            '      "children": []',
            '    }',
            '  ],',
            '  "sequenceNumber": 4',
            '}',
            '```',
            '',
            '<a id="ref-r6"></a>',
            '### R6. .canvas 示例',
            'file 节点路径是 vault 相对路径，不是相对 `.canvas` 文件本身。新增路径要匹配当前 `.canvas` 已经使用的前缀风格；不要在不同风格之间擅自归一化。',
            '完整导出包有三种前缀形态：放在已有 vault 根目录时是 `<导出包名>/永久栏目/...`；放在已有 vault 子目录时是 `<vault子目录>/<导出包名>/永久栏目/...`；把导出文件夹本身作为独立 vault 时没有导出包名前缀，直接是 `永久栏目/...`。',
            '下面示例里的 `<前缀>` 表示空字符串、`<导出包名>/` 或 `<vault子目录>/<导出包名>/`。',
            '从 `fromNode` 指向 `toNode` 的默认单箭头边省略 `fromEnd` 和 `toEnd`；只有无箭头才写 `toEnd: "none"`，双端箭头才写 `fromEnd: "arrow"`。',
            '```json',
            '{',
            '  "nodes": [',
            '    { "id": "permanent-section", "type": "file", "file": "<前缀>永久栏目/A书签树（永久栏目）.json", "x": 0, "y": 0, "width": 600, "height": 600, "color": "4" },',
            '    { "id": "permanent-section-copy-permanent-copy-1780113045642-gtjhd", "type": "file", "file": "<前缀>永久栏目/B书签树（永久栏目）.json", "x": 720, "y": 0, "width": 600, "height": 600, "color": "4" },',
            '    { "id": "card-group-ai", "type": "group", "x": -40, "y": 700, "width": 1320, "height": 620, "label": "AI workspace", "color": "5" },',
            '    { "id": "temp-section-AI", "type": "file", "file": "<前缀>临时栏目/特殊临时栏目/AI title.json", "x": 0, "y": 760, "width": 525, "height": 380, "color": "#e9973f" },',
            '    { "id": "md-node-ai-prompt", "type": "text", "text": "Prompt or notes for this generated bookmark set.", "x": 600, "y": 760, "width": 420, "height": 260, "color": "#888888" }',
            '  ],',
            '  "edges": [',
            '    { "id": "edge-ai-1", "fromNode": "md-node-ai-prompt", "fromSide": "right", "toNode": "temp-section-AI", "toSide": "left", "color": "#999999", "label": "generated set" }',
            '  ]',
            '}',
            '```',
            '',
            '<a id="ref-r7"></a>',
            '### R7. 无现成落点时创建 AI 特殊临时栏目',
            '- 只在 AI 需要新增书签建议或新书签树，且用户没有指定已有临时栏目、永久栏目或空白栏目作为落点时使用本规则。',
            '- 不要把这些建议直接写进永久栏目；只有用户明确要求修改永久/浏览器书签时，才编辑永久栏目。',
            '- 如果 `临时栏目/特殊临时栏目/` 不存在，先创建这个文件夹；已存在则复用。',
            '- 在该文件夹写入 `AI <标题>.json`，JSON 结构按 [R5](#ref-r5)：`sectionType: "temporary"`、`label: "AI"`、`tempKind: "special"`、`source: "ai-generated"`、`descriptionMd`、`items`。`id` 默认用 `temp-section-AI`；若冲突则用同标签下一个后缀，如 `temp-section-AI-2`。',
            '- 在入口 `.canvas` 的 `nodes[]` 增加匹配的 file 节点：节点 `id` 与 JSON 栏目 `id` 保持一致，`file` 使用当前包前缀风格下的 vault 相对路径，`x/y/width/height/color` 参考 [R6](#ref-r6) 示例布置，并避开已有节点。',
            '- 只有任务需要时才额外新增 group、text prompt 节点或 edge；新增 edge 时端点必须引用现有节点。',
            '',
            '<a id="ref-r8"></a>',
            '### R8. tag 调色板与 tag 对象',
            '- 合法 tag 颜色是 macOS 风格调色板色名：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`。',
            '- UI 使用的调色板十六进制：`red #ff453a`、`orange #ff9f0a`、`yellow #ffd60a`、`green #30d158`、`blue #0a84ff`、`purple #bf5af2`、`gray #8e8e93`。',
            '- 未输入自定义文字时，UI 默认文字：英文为 `Red`、`Orange`、`Yellow`、`Green`、`Blue`、`Purple`、`Gray`；中文为 `红色`、`橙色`、`黄色`、`绿色`、`蓝色`、`紫色`、`灰色`。',
            '- 标准 tag 对象形态：',
            '```json',
            '{',
            '  "color": "blue",',
            '  "text": "蓝色"',
            '}',
            '```',
            '- 不要把 tag 颜色写成 `#0a84ff`、`colorHex`、Obsidian canvas 颜色编号或 CSS 变量名。导出 JSON 里的 tag 颜色值就是小写英文调色板名。'
        ].join('\n');

    const guide = [
        __frontmatter({
            exportedAt,
            source,
            title: isEn ? 'Obsidian Import Rules' : 'Obsidian 导入规则'
        }),
        compatText,
        '',
        '-----------------------------------------------------------------------------',
        aiGuideText,
        isEn ? `1) Unzip: ${exportRoot}.zip` : `1）解压：${exportRoot}.zip`,
        isEn
            ? `2) Put the folder \`${exportRoot}/\` into your vault at: \`${(vaultPrefix ? (vaultPrefix.split('/').slice(0, -1).join('/') || '(vault root)') : '(standalone vault)')}\`.`
            : `2）把文件夹 \`${exportRoot}/\` 放到仓库：\`${(vaultPrefix ? (vaultPrefix.split('/').slice(0, -1).join('/') || '（vault根目录）') : '（独立vault）')}\`。`,
        isEn
            ? '3) Open the package .canvas entry file in the export root. If the folder or canvas file was renamed, use the actual .canvas file.'
            : '3）打开导出包根目录中的 .canvas 入口文件。若文件夹或 canvas 文件已改名，以实际 .canvas 文件为准。',
        '',
        isEn
            ? 'If you only copy the .canvas file without the .json files, Canvas will show that linked files could not be found.'
            : '注意：如果只拷贝 .canvas 文件而没有同时拷贝对应的 .json 文件，Canvas 会显示关联文件找不到。',
        '',
        '-----------------------------------------------------------------------------',
        referenceExamplesText,
        ''
    ].join('\n');

    return guide;
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

    const exportedAt = new Date().toISOString();
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
        const title = isEn ? 'Export: Obsidian Path' : '导出：Obsidian 路径';
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

        const stepC = isEn
            ? `If you use it as a ${hl('standalone vault')}, ${hl('clear the input')} and click Confirm.`
            : `-若把它直接作为一个独立的仓库，请${hl('清空输入框')}，点击确认即可。`;

        const formatOptionJson = isEn ? 'JSON Mode (for AI)' : 'JSON模式（供AI）';
        const formatOptionJsonDesc = isEn
            ? 'Stores the bookmark tree as structured JSON, best for AI analysis and stable sync.'
            : '用结构化 JSON 表示书签树，更适合 AI 分析、增删改移和稳定同步。';

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

                        <div style="margin-top: 16px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 10px;">
                            <div style="font-weight: 600; font-size: 13px;">${formatOptionJson}</div>
                            <div style="font-size: 12px; color: #666; margin-top: 4px;">${formatOptionJsonDesc}</div>
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
	                        <div style="margin: 6px 0 0;">${stepC}</div>
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

        document.body.appendChild(dialog);

        const closeBtn = document.getElementById('closeCanvasExportVaultPrefixDialog');
        if (closeBtn) closeBtn.addEventListener('click', () => cleanup(null));

        const input = document.getElementById('canvasExportVaultPrefixInput');
        if (input) {
            input.value = String(defaultValue || '');
            try { input.focus(); input.select(); } catch (_) { }
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (e.isComposing) return;
                    e.preventDefault();
                    cleanup({
                        path: String(input.value || ''),
                        format: 'json'
                    });
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                }
            });
        }



        const okBtn = document.getElementById('canvasExportVaultPrefixOk');
        if (okBtn) okBtn.addEventListener('click', () => cleanup({
            path: input ? String(input.value || '') : String(defaultValue || ''),
            format: 'json'
        }));
    });

    // 让用户决定"导出文件夹在 vault 内的相对位置"，以适配：
    // - vault 根目录下（默认）：bookmark-canvas-export/...
    // - vault 的子文件夹下：SomeFolder/bookmark-canvas-export/...
    // - 或把 bookmark-canvas-export/ 直接作为一个独立 vault 根目录（portable canvas）

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
                    inheritFrom: __joinObsidianExportPath(exportRoot, permanentMdRel)
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

    const guide = __buildExportGuide(
        guideNames,
        'exportGuide',
        isEn,
        exportedAt,
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
    console.log(`[ZIP] 中央目录: ${cdEntryCount} 个条目, 偏移 ${cdOffset}`);

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
            console.log(`[ZIP] 跳过: ${name}`);
            continue;
        }

        // 3. 读取本地文件头获取数据位置
        const localNameLen = readU16(localOffset + 26);
        const localExtraLen = readU16(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressedData = bytes.slice(dataStart, dataStart + compSize);

        console.log(`[ZIP] 条目: "${name}", method=${method}, size=${compSize}`);

        // 4. 解压
        if (method === 0) {
            files.set(name, compressedData);
        } else if (method === 8) {
            if (!supportsDeflate) {
                throw new Error('浏览器不支持 Deflate 解压');
            }
            const decompressed = await __inflateDeflate(compressedData);
            files.set(name, decompressed);
            console.log(`[ZIP] 解压: ${name}, ${compSize} -> ${decompressed.length}`);
        } else {
            throw new Error(`不支持的压缩方法 ${method}`);
        }
    }

    console.log(`[ZIP] 完成，共 ${files.size} 个文件`);
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
    const overwriteMode = !!(options && options.importMode === 'overwrite');
    if (overwriteMode && canvasData && typeof canvasData === 'object') {
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

        let best = null;
        for (const [rawKey, rawValue] of sourceFiles.entries()) {
            const normalizedKey = normalizePath(rawKey);
            if (!normalizedKey) continue;
            if (normalizedKey === normalizedRel) return rawValue;
            if (normalizedKey.endsWith(`/${normalizedRel}`)) {
                if (!best || normalizedKey.length < best.key.length) {
                    best = { key: normalizedKey, value: rawValue };
                }
            }
        }
        return best ? best.value : null;
    };

    const parsePermanentProtocol = (fileText, requireTree) => {
        const text = String(fileText || '').trim();
        if (!text) return null;

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (_) {
            try {
                if (typeof __extractCanvasSectionJsonCodeBlock === 'function') {
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
    console.log('[Canvas] ZIP 包含的文件:', Array.from(zipFiles.keys()));

    for (const name of zipFiles.keys()) {
        // 获取文件名（不含路径）
        const baseName = name.split('/').pop();

        // 查找 .canvas 文件 - 支持任意目录深度
        if (baseName.endsWith('.canvas')) {
            if (!canvasFileName) {
                canvasFileName = name;
                console.log('[Canvas] 找到 canvas 文件:', name);
            }
        }
    }

    let tempState = null;
    let storage = {};
    let primaryState = {}; // Mock primary state for compatibility

    if (canvasFileName) {
        console.log(`[Canvas] Import using OBSIDIAN CANVAS mode: ${canvasFileName}`);
        const canvasText = new TextDecoder('utf-8').decode(zipFiles.get(canvasFileName));
        const canvasData = JSON.parse(canvasText);
        tempState = __rebuildTempStateFromObsidianCanvasPackage(canvasData, zipFiles, primaryState, { isEn, importMode });
        storage = __buildImportedStorageFromCanvasPackage(canvasData, zipFiles, { importMode });
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
        console.log(`[Canvas] Folder Import using OBSIDIAN CANVAS mode: ${canvasFileName}`);
        const canvasText = new TextDecoder('utf-8').decode(folderFiles.get(canvasFileName));
        const canvasData = JSON.parse(canvasText);
        tempState = __rebuildTempStateFromObsidianCanvasPackage(canvasData, folderFiles, primaryState, { isEn, importMode });
        storage = __buildImportedStorageFromCanvasPackage(canvasData, folderFiles, { importMode });
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

if (typeof window !== 'undefined') {
    window.showImportDialog = showImportDialog;
    window.exportCanvasCardGroupPackage = exportCanvasCardGroupPackage;
    window.exportCanvasTempGroupPackage = exportCanvasTempGroupPackage;
}
