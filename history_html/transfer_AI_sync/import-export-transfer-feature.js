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

    const sectionById = new Map();
    sections.forEach((section) => {
        const id = section && section.id ? String(section.id) : '';
        if (id) sectionById.set(id, section);
    });

    const mdById = new Map();
    mdNodes.forEach((node) => {
        const id = node && node.id ? String(node.id) : '';
        if (id) mdById.set(id, node);
    });

    const containers = mdNodes.filter((node) => !!(node && node.subtype === 'import-container'));
    const hasSnapshotInTempState = sections.some((section) => !!(section && section.isSnapshot));
    const syntheticPermanentSections = hasSnapshotInTempState
        ? []
        : __buildImportPreviewSyntheticPermanentSections(fullStorage, isEn);

    const buildGroup = (container, index) => {
        let groupTitle = '';
        if (container) {
            try {
                groupTitle = __trimImportPreviewText(__getImportContainerLabelFromNode(container));
            } catch (_) {
                groupTitle = '';
            }
        }
        if (!groupTitle) {
            groupTitle = isEn ? `Imported Group ${index}` : `导入区块 ${index}`;
        }

        let groupTempSections = [];
        let groupMdNodes = [];
        let nodeIdSet = new Set();

        if (container) {
            const tempIds = Array.isArray(container.containedTempIds) ? container.containedTempIds : [];
            const mdIds = Array.isArray(container.containedMdIds) ? container.containedMdIds : [];

            groupTempSections = tempIds
                .map((id) => sectionById.get(String(id || '')))
                .filter(Boolean);

            groupMdNodes = mdIds
                .map((id) => mdById.get(String(id || '')))
                .filter((node) => !!(node && node.subtype !== 'import-container'));

            groupTempSections.forEach((section) => {
                if (section && section.id) nodeIdSet.add(String(section.id));
            });
            groupMdNodes.forEach((node) => {
                if (node && node.id) nodeIdSet.add(String(node.id));
            });

            if (!groupTempSections.length && !groupMdNodes.length && containers.length === 1) {
                groupTempSections = sections.slice();
                groupMdNodes = mdNodes.filter((node) => !!(node && node.subtype !== 'import-container'));
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
            groupMdNodes = mdNodes.filter((node) => !!(node && node.subtype !== 'import-container'));
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
    if (containers.length) {
        containers.forEach((container, index) => {
            groups.push(buildGroup(container, index + 1));
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

async function __chromeBookmarksRemoveAllInRoot(rootNode) {
    if (!rootNode || !Array.isArray(rootNode.children) || !chrome || !chrome.bookmarks) return;
    const removeOne = (childId, isFolder) => new Promise((resolve) => {
        if (isFolder) {
            try { chrome.bookmarks.removeTree(childId, () => resolve(true)); }
            catch (_) { resolve(false); }
        } else {
            try { chrome.bookmarks.remove(childId, () => resolve(true)); }
            catch (_) { resolve(false); }
        }
    });
    const childrenSnapshot = rootNode.children.slice();
    for (const child of childrenSnapshot) {
        if (!child || !child.id) continue;
        const isFolder = !child.url;
        await removeOne(child.id, isFolder);
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
                    await new Promise((resolve) => {
                        try { chrome.bookmarks.removeTree(entry.id, () => { if (chrome.runtime.lastError) { try { chrome.bookmarks.remove(entry.id, () => resolve()); } catch (_) { resolve(); } } else resolve(); }); }
                        catch (_) { resolve(); }
                    });
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

function showImportDialog() {
    const { isEn } = __getLang();
    // 创建导入对话框
    const dialog = document.createElement('div');
    dialog.className = 'import-dialog';
    dialog.id = 'canvasImportDialog';

    dialog.innerHTML = `
        <div class="import-dialog-content">
            <div class="import-dialog-header">
                <h3>${isEn ? 'Import' : '导入'}</h3>
                <button class="import-dialog-close" id="closeImportDialog">&times;</button>
            </div>
            <div class="import-dialog-body">
                <div class="import-options">
                    <div class="import-section-label-large">${isEn ? 'Canvas Snapshot' : '画布快照'}</div>
                    <div class="import-row">
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
    document.getElementById('closeImportDialog').addEventListener('click', () => {
        dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
    });

    document.getElementById('importCanvasZipBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        // 支持 ZIP 和 7z 压缩包
        input.accept = '.zip,.7z';
        input.dataset.type = 'package-archive';
        input.click();
    });

    // 文件夹导入按钮
    document.getElementById('importCanvasFolderBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFolderInput');
        input.click();
    });

    document.getElementById('importHtmlBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.html';
        input.dataset.type = 'html';
        input.click();
    });

    document.getElementById('importJsonBtn').addEventListener('click', () => {
        const input = document.getElementById('canvasFileInput');
        input.accept = '.json';
        input.dataset.type = 'json';
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
    const file = e.target.files[0];
    if (!file) return;

    const type = e.target.dataset.type;

    try {
        if (type === 'package-archive') {
            let parsedTempState = null;
            let parsedStorage = null;
            let parsedPrimaryState = {};

            const parsed = await parseCanvasPackageFromZipFile(file);
            parsedTempState = parsed.tempState;
            parsedStorage = parsed.storage;
            parsedPrimaryState = parsed.primaryState;

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
                trigger: 'manual-file-import'
            });
        } else {
            const text = await file.text();
            if (type === 'html') {
                await importHtmlBookmarks(text, file && file.name ? file.name : '');
            } else {
                await importJsonBookmarks(text, file && file.name ? file.name : '');
            }
        }

        document.getElementById('canvasImportDialog').remove();
        // 成功提示已在各导入函数中显示，这里不再重复
    } catch (error) {
        console.error('[Canvas] 导入失败:', error);
        const { isEn } = __getLang();
        showCanvasToast((isEn ? 'Import failed: ' : '导入失败: ') + (error && error.message ? error.message : error), 'error');
    }

    e.target.value = '';
}

/**
 * 处理文件夹导入
 * 支持导入已解压的画布快照文件夹
 */
async function handleFolderImport(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const { isEn } = __getLang();

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
            trigger: 'manual-folder-import'
        });

        document.getElementById('canvasImportDialog').remove();
    } catch (error) {
        console.error('[Canvas] 文件夹导入失败:', error);
        showCanvasToast((isEn ? 'Import failed: ' : '导入失败: ') + (error && error.message ? error.message : error), 'error');
    }

    e.target.value = '';
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
async function importHtmlBookmarks(html, importFileName = '') {
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
        showCanvasToast(isEn ? 'No valid bookmark links found.' : '未找到有效的书签链接', 'error');
        return;
    }

    // 创建一个新的临时栏目容器
    // 在当前视口中找一个空白位置
    const sectionMeta = { source: 'file-import', label: isEn ? 'Import' : '导入' };
    const baseSize = getTempSectionBaseSize(sectionMeta);
    const position = findAvailablePositionInViewport(baseSize.width, baseSize.height);
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
        createdAt: Date.now(),
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
            children: [],
            createdAt: Date.now()
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

    saveTempNodes();

    // 添加呼吸式闪烁效果，吸引用户注意
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        pulseBreathingEffect(nodeElement, 1500);
    }

    // 显示成功提示
    showCanvasToast(
        isEn ? `Successfully imported ${totalCount} bookmarks` : `成功导入 ${totalCount} 个书签`,
        'success'
    );
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
 * 6. 第三方插件常用格式（兼容各种字段名）
 */
async function importJsonBookmarks(json, importFileName = '') {
    const { isEn } = __getLang();
    let data;
    try {
        data = JSON.parse(json);
    } catch (e) {
        showCanvasToast(isEn ? 'Invalid JSON format.' : '无效的 JSON 格式', 'error');
        return;
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
            children: [],
            createdAt: Date.now()
        };

        if (node.children && Array.isArray(node.children)) {
            item.children = node.children.map(c => convertToTempItem(c, sectionId)).filter(Boolean);
        }

        return item;
    };

    let items = [];
    let tempProtocolMeta = null;
    const sectionType = String(data && data.sectionType || '').trim().toLowerCase();
    const formatType = String(data && data.format || '').trim().toLowerCase();
    const looksLikeCanvasTempProtocol = !!(
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && (
            sectionType === 'temporary'
            || formatType === String(__CANVAS_SECTION_JSON_FORMAT || '').toLowerCase()
            || (data.sectionMeta && typeof data.sectionMeta === 'object')
        )
    );
    let importedViaCanvasTempProtocol = false;

    // 检测并处理不同格式
    if (looksLikeCanvasTempProtocol) {
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
        showCanvasToast(isEn ? 'No valid bookmark data found.' : '未解析到有效的书签数据', 'error');
        return;
    }

    // 创建一个新的临时栏目容器
    // 在当前视口中找一个空白位置
    const sectionMeta = {
        source: String(tempProtocolMeta && tempProtocolMeta.source || 'file-import').trim() || 'file-import',
        label: String(tempProtocolMeta && tempProtocolMeta.label || '').trim() || (isEn ? 'Import' : '导入')
    };
    const baseSize = getTempSectionBaseSize(sectionMeta);
    const position = findAvailablePositionInViewport(baseSize.width, baseSize.height);
    const protocolSequenceNumberHint = __normalizePositiveInt(tempProtocolMeta && tempProtocolMeta.sequenceNumber);
    const sequenceNumberForId = protocolSequenceNumberHint || (++CanvasState.tempSectionSequenceNumber);
    const sectionId = allocateTempSectionId({
        label: sectionMeta.label,
        sequenceNumber: sequenceNumberForId,
        source: sectionMeta.source
    });
    const fileNameTitle = String(importFileName || '').replace(/[\r\n]/g, ' ').trim();
    const protocolTitle = String(tempProtocolMeta && tempProtocolMeta.title || '').trim();
    const protocolCreatedAt = Number(tempProtocolMeta && tempProtocolMeta.createdAt);
    const sectionCreatedAt = (Number.isFinite(protocolCreatedAt) && protocolCreatedAt > 0)
        ? protocolCreatedAt
        : Date.now();
    const protocolUpdatedAt = Number(tempProtocolMeta && tempProtocolMeta.updatedAt);
    const sectionUpdatedAt = (Number.isFinite(protocolUpdatedAt) && protocolUpdatedAt > 0)
        ? protocolUpdatedAt
        : 0;
    const protocolDescriptionMd = String(
        (tempProtocolMeta && tempProtocolMeta.descriptionMd != null)
            ? tempProtocolMeta.descriptionMd
            : ''
    );
    const protocolSequenceNumber = __normalizePositiveInt(tempProtocolMeta && tempProtocolMeta.sequenceNumber);
    const protocolOriginPermanent = __normalizeOriginPermanentPayload(tempProtocolMeta && tempProtocolMeta.originPermanent);
    const section = {
        id: sectionId,
        title: fileNameTitle || protocolTitle || (isEn
            ? `Imported Bookmarks (JSON, ${totalBookmarkCount}) - ${formatTimestampForTitle()}`
            : `导入的书签 (JSON, ${totalBookmarkCount}) - ${formatTimestampForTitle()}`),
        color: getTempSectionDefaultColor(sectionMeta),
        colorLocked: __getDefaultTempColorLockedState(),
        x: position.x,
        y: position.y,
        width: baseSize.width,
        height: baseSize.height,
        createdAt: sectionCreatedAt,
        source: sectionMeta.source,
        label: sectionMeta.label,
        items: items.map(item => convertToTempItem(item, sectionId)).filter(Boolean)
    };
    if (protocolDescriptionMd) {
        section.descriptionMd = protocolDescriptionMd;
        section.description = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(protocolDescriptionMd));
    }
    if (protocolSequenceNumber) {
        section.sequenceNumber = protocolSequenceNumber;
    }
    if (protocolOriginPermanent) {
        section.originPermanent = protocolOriginPermanent;
    }
    if (sectionUpdatedAt) {
        section.updatedAt = sectionUpdatedAt;
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

    saveTempNodes();

    // 添加呼吸式闪烁效果，吸引用户注意
    const nodeElement = document.getElementById(section.id);
    if (nodeElement) {
        pulseBreathingEffect(nodeElement, 1500);
    }

    // 显示成功提示
    showCanvasToast(
        isEn ? `Successfully imported ${totalBookmarkCount} bookmarks` : `成功导入 ${totalBookmarkCount} 个书签`,
        'success'
    );
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
    const backupHintPrefix = isEn ? 'Export automatically creates a backup. See ' : '导出时会进行自动备份，具体参考';
    const backupHintLink = isEn ? 'Backup' : '「备份」';
    const backupHintSuffix = isEn ? ' for details.' : '位置。';

    dialog.innerHTML = `
        <div class="import-dialog-content canvas-export-dialog-content" style="max-width: 430px; width: 90vw;">
            <div class="import-dialog-header" style="padding: 10px 16px;">
                <h3 style="margin-left: 4px;">${dialogTitle}</h3>
                <button class="import-dialog-close" id="closeExportModeDialog" style="margin-top: 1px;">&times;</button>
            </div>
            <div class="import-dialog-body" style="padding: 16px;">
                ${fullscreenTargetLabel ? `<div class="canvas-export-current-target">${fullscreenHintPrefix} ${fullscreenTargetLabel}</div>` : ''}
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
                <div class="canvas-export-backup-hint" style="margin-top: 12px; font-size: 12px; line-height: 1.5; opacity: 0.78;">
                    ${backupHintPrefix}<button type="button" id="exportBackupJumpBtn" style="border: 0; background: transparent; padding: 0; color: #2563eb; text-decoration: underline; cursor: pointer; font: inherit;">${backupHintLink}</button>${backupHintSuffix}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('closeExportModeDialog').addEventListener('click', () => {
        dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
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
        dialog.remove();
        const mode = isFullscreenTarget
            ? 'fullscreen-html'
            : 'obsidian';
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


async function exportCanvasPackage(options = {}) {
    const exportMode = options.mode || 'obsidian';
    const { isEn } = __getLang();

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

    const guideName = 'AGENTS.md';

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
            'This document is intentionally split into two layers for stable import and future sync:',
            '- Top: package structure + view structure.',
            '- Bottom: skills-like change profiles (edit only what is needed).',
            '',
            '## Part A. Package & View Structure',
            '',
            '### A0. Full Workflow Example (Export → Edit → Re-import)',
            '1. Export using the currently selected content format.',
            '2. Unzip into your Obsidian vault.',
            `3. Open ${exportRoot}/${canvasFileName}.`,
            '4. Edit files under Permanent/ and Temporary/, and edit blank sections directly in `.canvas` text nodes.',
            '5. If any Permanent/Temporary file is renamed or moved, update .canvas file paths in sync.',
            '6. Re-import via ZIP or folder.',
            '',
            '### A1. Package File Structure',
            `- ${exportRoot}/${canvasFileName}: canvas entry (nodes/edges + file mapping).`,
            `- ${exportRoot}/Permanent/#A <Permanent Title>.json: main permanent section file.`,
            '- Optional copy files: Permanent/#B <Permanent Title>.json / #C <Permanent Title>.json ...',
            '- Temporary/General Chain/*.json: general-chain temporary section files.',
            '- Temporary/Special temporary/*.json: special temporary section files.',
            '- Blank sections are stored directly in `.canvas` as `type: "text"` nodes.',
            '',
            '### A2. View File Structure (.canvas)',
            '- Root keys must remain nodes[] and edges[].',
            '- File nodes point to JSON section files through the file field (vault-relative path).',
            '- Group nodes are import containers; membership is inferred by geometry on import.',
            '- Edge fromNode/toNode must reference existing node IDs.',
            '- Native blank cards remain `type: "text"` nodes inside `.canvas`.',
            '',
            '### A3. JSON Structure (all section files)',
            '- JSON mode stores the tree as a single plain JSON object body (no fenced block).',
            '- Optional description uses compact hidden comment marker: `<!--bc:1:...-->` (base64 payload).',
            '- In JSON mode, permanent tree content is stored as a Chrome Bookmarks API-compatible root object.',
            '- Fold metadata uses compact hidden marker `<!--bc:2:...-->` when needed.',
            '- JSON mode parses permanent/temporary bookmark tree content from the plain JSON body directly.',
            '- Permanent slot recognition priority: header `#A/#B` > filename `(#B)` > file order fallback.',
            '- Special temporary files are placed under `Special temporary/`.',
            '- Blank sections are now stored directly as `.canvas` text nodes (no standalone blank section files).',
            '',
            '### A4. Mode-specific Content Grammar',
            ...modeTreeRulesEn,
            '',
            '### A5. Import Recognition Priority',
            '- Type recognition uses BOTH .canvas file references and folder paths.',
            '- Blank sections are recognized only from `.canvas` text nodes.',
            '- In normal import flow, permanent files are restored as snapshot sections (not direct browser-tree overwrite).'
        ].join('\n')
        : [
            '# 书签画布导入/导出规则',
            '',
            '本文件刻意拆成上下两层，便于导入稳定与后续同步扩展：',
            '- 上半部分：文件结构 + 视图结构（导入识别基准）。',
            '- 下半部分：类似 Skills 的改动配置（只改被需求命中的部分）。',
            '',
            '## 第一部分：文件结构与视图结构（导入识别基准）',
            '',
            '### A0. 完整操作示例（导出 → 编辑 → 导入）',
            '1. 在书签画布执行导出，并使用当前选择的内容格式。',
            '2. 将 ZIP 解压到 Obsidian 仓库。',
            `3. 打开 ${exportRoot}/${canvasFileName}。`,
            '4. 按需编辑 永久栏目/、临时栏目/ 下的 .json 文件；空白栏目请直接编辑 `.canvas` 的 text 节点。',
            '5. 若重命名或移动 永久/临时 栏目文件，必须同步修改 .canvas 的 file 路径。',
            '6. 回到扩展中，以 ZIP 或文件夹方式导入。',
            '',
            '### A1. 文件基本结构（目录层）',
            `- ${exportRoot}/${canvasFileName}：画布入口文件（nodes/edges + 文件映射）。`,
            `- ${exportRoot}/永久栏目/#A <永久栏目标题>.json：主永久栏目文件。`,
            '- 可能存在永久副本文件：永久栏目/#B <永久栏目标题>.json / #C <永久栏目标题>.json ...',
            '- 临时栏目/常规链式/*.json：常规链式临时栏目文件。',
            '- 临时栏目/特殊临时栏目/*.json：特殊临时栏目文件。',
            '- 空白栏目统一存放在 `.canvas` 的 `type: "text"` 节点中（不再导出空白栏目镜像文件）。',
            '',
            '### A2. 视图文件结构（.canvas）',
            '- 顶层结构必须保持 nodes[] 与 edges[]。',
            '- file 节点通过 file 字段指向 JSON 栏目文件（vault 相对路径）。',
            '- group 节点作为导入分组容器，导入时按几何包含关系识别归属。',
            '- 边的 fromNode/toNode 必须引用存在的节点 ID。',
            '- 空白栏目以 `.canvas` 中的 `type: "text"` 节点为唯一真相源。',
            '',
            '### A3. JSON 文件结构（所有栏目）',
            '- JSON模式正文直接是单一 JSON 对象。',
            '- 说明区可选，采用紧凑隐藏注释：`<!--bc:1:...-->`（base64 载荷）。',
            '- JSON模式下，永久树正文直接保存为 Chrome Bookmarks API 兼容根节点对象。',
            '- 折叠元数据如需写出，使用紧凑隐藏注释 `<!--bc:2:...-->`。',
            '- JSON模式直接解析永久/临时栏目的 JSON 正文。',
            '- 永久栏目槽位识别优先级：栏目头 `#A/#B` > 文件名 `(#B)` > 文件顺序兜底。',
            '- 特殊临时栏目文件统一放在 `临时栏目/特殊临时栏目/`。',
            '- 空白栏目正文直接存放在 `.canvas` 的 text 节点中，不再依赖空白栏目镜像文件。',
            '',
            '### A4. 模式内容语法（JSON）',
            ...modeTreeRulesZh,
            '',
            '### A5. 导入识别优先级',
            '- 类型识别同时依赖 .canvas 文件引用 与 目录路径命名。',
            '- 空白栏目仅从 `.canvas` 的 text 节点恢复。',
            '- 常规导入流下，永久栏目按“快照栏目”恢复，不直接覆盖浏览器真实书签树。'
        ].join('\n');

    aiGuideText = isEn
        ? [
            `## Part B. Skills-like Change Profiles (${exportModeLabelEn})`,
            '',
            'Route principle: edit the minimum file set only ("change where used").',
            '',
            '### S1. File Routing (what to touch)',
            '- Permanent content: `Permanent/#A <Permanent Title>.json` and optional copy files `Permanent/#B <Permanent Title>.json` ...',
            '- Temporary content: `Temporary/General Chain/*.json` and `Temporary/Special temporary/*.json` + matching file nodes in `.canvas`.',
            '- Blank content: edit `.canvas` `type: "text"` nodes directly (blank mirror files are removed).',
            '- Layout/links only: edit `.canvas` node geometry and edge fields.',
            '',
            '### S2. Header Line Contract (no required front matter)',
            '- JSON mode: the bookmark tree lives in a plain JSON object body, so no extra header line is required.',
            '- Temporary section label can still be derived from explicit JSON fields, header prefix, or filename prefix when restoring sequence mapping.',
            '',
            '### S3. Import Recognition & Merge Baseline',
            '- Type recognition = `.canvas` file mapping + folder path names.',
            '- Special temporary sections are recognized by folder + JSON/header/label semantics.',
            '- JSON mode parses the bookmark tree from the plain JSON body directly.',
            '- JSON-mode permanent files keep Chrome Bookmarks API-compatible tree shape in body.',
            '- In normal import flow, permanent files are restored as snapshot sections, not direct browser tree overwrite.',
            '',
            '### S4. Number / Title / Bookmark-count Priority',
            '- Numbering is identity first; title is display second.',
            '- Temp label priority: explicit label > header prefix > filename prefix (e.g., `A-1`).',
            '- Legacy labels are normalized to dash scheme (e.g., A1 => A-1-...).',
            '- Permanent slot baseline: main section is `#A`, copies follow display index/order.',
            '- Permanent slot import priority: `#A/#B` header > `(#B)` filename > file order fallback.',
            '- Bookmark count is statistical feedback and must not override identity mapping.',
            '',
            '### S5. Color Rules (chain inheritance)',
            '- Keep existing `color`/`colorHex` unless explicit recolor is requested.',
            '- Temp color follow works as chain inheritance: unlocked nodes follow parent; any lock breaks chain below.',
            '- Split/new temp section rule: locked parent => default color, unlocked parent => follow parent color.',
            '- Special temp sections (Drop/Search/Batch/Add/Import) follow appearance defaults.',
            '',
            '### S6. Basic Canvas Corrections',
            '- Keep `.canvas` valid JSON and preserve top-level `nodes` + `edges` arrays.',
            '- Node IDs must be unique; every edge endpoint must target an existing node.',
            '- Keep `x/y/width/height` as stable numeric values; avoid random drift edits.',
            '- Node order controls z-order (earlier lower, later higher).',
            '',
            '### S7. Minimal Pre-import Checklist',
            '- Every renamed/moved Permanent/Temporary `.json` path is synchronized into `.canvas`.',
            '- Header line and optional description comment block are not corrupted.',
            '- Links and node IDs remain referentially valid.',
            '',
            '### Import Steps'
        ].join('\n')
        : [
            `## 第二部分：模型改动配置（类似 Skills，按需调用）（${exportModeLabelZh}）`,
            '',
            '路由原则：只改最小必要文件集合（用到哪里改哪里），避免全量重写。',
            '',
            '### S1. 文件路由（按需求定位）',
            '- 永久栏目内容：修改 `永久栏目/#A <永久栏目标题>.json` 与可选副本 `永久栏目/#B <永久栏目标题>.json` ...。',
            '- 临时栏目内容：修改 `临时栏目/常规链式/*.json` 与 `临时栏目/特殊临时栏目/*.json`，并同步 `.canvas` 对应 file 节点。',
            '- 空白栏目：直接修改 `.canvas` 的 `type: "text"` 节点（不再维护空白栏目独立文件）。',
            '- 仅布局/连线：只改 `.canvas` 的节点几何与边字段。',
            '',
            '### S2. 栏目头文本合同（不要求 Front Matter）',
            '- JSON模式（供AI）：书签树正文直接放在单一 JSON 对象正文里（不使用代码围栏），不要求额外栏目头。',
            '- 临时栏目序号仍可由显式 JSON 字段、栏目头前缀或文件名前缀恢复。',
            '',
            '### S3. 导入识别与合并基线',
            '- 类型识别 = `.canvas` 文件映射 + 目录路径命名（双条件）。',
            '- 特殊临时栏目按目录 + JSON/栏目头/标签语义识别。',
            '- JSON模式直接解析 JSON 正文。',
            '- JSON 模式下的永久文件正文保持 Chrome Bookmarks API 兼容树结构。',
            '- 常规导入流下，永久栏目按快照栏目恢复，不直接覆盖浏览器真实书签树。',
            '',
            '### S4. 编号 / 标题 / 书签数优先级',
            '- 编号优先作为身份映射键，标题用于展示。',
            '- 临时栏目编号优先级：显式 label > 栏目头前缀 > 文件名前缀（如 `A-1`）。',
            '- 旧编号会归一到短横线方案（如 `A1` 会归一为 `A-1-...`）。',
            '- 永久栏目槽位：主栏目默认 `#A`，副本按显示序号/顺序递增。',
            '- 永久栏目导入槽位优先级：`#A/#B` 栏目头 > `(#B)` 文件名 > 文件顺序兜底。',
            '- 书签数属于统计反馈，不得反向覆盖编号身份规则。',
            '',
            '### S5. 颜色规则（链式继承）',
            '- 未明确改色时，保留现有 `color` / `colorHex`。',
            '- 临时栏目颜色跟随采用链式继承：解锁跟随父级，任何中间锁定都会断链。',
            '- 分裂/新增临时栏目：父级锁住用默认色；父级解锁跟随父级色。',
            '- 特殊临时栏目（拖入/搜索/批量/添加/导入）遵循外观设置中的默认颜色。',
            '',
            '### S6. 基础画布的改正',
            '- `.canvas` 必须保持合法 JSON，且顶层保留 `nodes` 与 `edges`。',
            '- 节点 ID 必须唯一；每条边的端点必须指向存在节点。',
            '- `x/y/width/height` 保持稳定数值，避免无意义漂移。',
            '- 节点数组顺序决定叠层顺序（前下后上）。',
            '',
            '### S7. 导入前最小自检清单',
            '- 所有重命名/移动过的 永久/临时 `.json` 已同步到 `.canvas` 的 file 路径。',
            '- 栏目头与说明注释块结构未损坏。',
            '- 链接、节点 ID、连线引用关系全部有效。',
            '',
            '### 导入步骤'
        ].join('\n');

    const guide = [
        __frontmatter({
            exportedAt,
            source: 'exportGuide',
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
            ? `3) Open: \`${exportRoot}/${canvasFileName}\`.`
            : `3）打开：\`${exportRoot}/${canvasFileName}\`。`,
        '',
        isEn
            ? 'If you only copy the .canvas file without the .json files, Canvas will show that linked files could not be found.'
            : '注意：如果只拷贝 .canvas 文件而没有同时拷贝对应的 .json 文件，Canvas 会显示关联文件找不到。',
        ''
    ].join('\n');
    files.push({ name: `${exportRoot}/${guideName}`, data: __toUint8(guide) });

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
