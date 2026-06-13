/*
 * canvas_groups/card_group_render.js
 *
 * 卡片组（card-group）DOM 渲染：
 *   - 圆角矩形容器 + 左上角 label pill（pill 在容器 bbox 之外）
 *   - 4 边连接点（复用 addAnchorsToNode）
 *   - resize 句柄（复用 makeTempNodeResizable）
 *   - pill 点击进入选中态；选中后显示一层蒙版，可像临时组一样按住蒙版拖动整组
 *   - 根节点接收组内空白处点击用于选中；pill/toolbar/anchors/resize handles/
 *     选中蒙版单独处理交互
 *   - 颜色 / 置顶 / 工具窗 与 mdNode 系统协作
 *
 * 在 bookmark_canvas_module.js 之后加载（依赖 CanvasState、addAnchorsToNode、
 * makeTempNodeResizable、saveTempNodes、selectMdNode、locateAndZoomToMdNode、
 * toggleMdNodePin、removeMdNode）。
 */

const CARD_GROUP_DEFAULT_BORDER = '#94a3b8';
const CARD_GROUP_DEFAULT_FILL = 'rgba(148, 163, 184, 0.06)';
const CARD_GROUP_DEFAULT_PILL_BG = '#475569';
const CARD_GROUP_DEFAULT_PILL_FG = '#f8fafc';

function __cardGroupResolveColors(node) {
    let hex = (node && typeof node.colorHex === 'string') ? node.colorHex.trim() : '';
    if (!hex || !/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
        hex = (typeof getCardGroupDefaultColor === 'function')
            ? getCardGroupDefaultColor()
            : ((window.CanvasModule && typeof window.CanvasModule.getCardGroupDefaultColor === 'function')
                ? window.CanvasModule.getCardGroupDefaultColor()
                : CARD_GROUP_DEFAULT_BORDER);
    }
    return {
        border: hex,
        fill: __cardGroupHexWithAlpha(hex, 0.10),
        pillBg: hex,
        pillFg: __cardGroupPickReadableForeground(hex)
    };
}

function __cardGroupHexWithAlpha(hex, alpha) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) {
        h = h.split('').map((ch) => ch + ch).join('');
    }
    if (h.length < 6) return CARD_GROUP_DEFAULT_FILL;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some((v) => !Number.isFinite(v))) return CARD_GROUP_DEFAULT_FILL;
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function __cardGroupPickReadableForeground(hex) {
    const h = String(hex || '').trim().replace(/^#/, '');
    const norm = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (norm.length < 6) return CARD_GROUP_DEFAULT_PILL_FG;
    const r = parseInt(norm.slice(0, 2), 16);
    const g = parseInt(norm.slice(2, 4), 16);
    const b = parseInt(norm.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? '#0f172a' : '#f8fafc';
}

function applyCardGroupColor(node) {
    if (!node) return;
    if (node.subtype !== 'card-group') return;
    const el = document.getElementById(node.id);
    if (!el) return;
    const colors = __cardGroupResolveColors(node);
    el.style.setProperty('--card-group-border', colors.border);
    el.style.setProperty('--card-group-fill', colors.fill);
    el.style.setProperty('--card-group-pill-bg', colors.pillBg);
    el.style.setProperty('--card-group-pill-fg', colors.pillFg);
    const hasCustomColor = !!(node && (node.colorHex || node.color));
    if (hasCustomColor) {
        el.style.setProperty('--node-glow-color', colors.border);
        el.style.setProperty('--card-group-highlight-color', colors.border);
        el.style.setProperty('--card-group-anchor-color', colors.border);
        el.setAttribute('data-has-color', 'true');
    } else {
        el.style.removeProperty('--node-glow-color');
        el.style.removeProperty('--card-group-highlight-color');
        el.style.removeProperty('--card-group-anchor-color');
        el.removeAttribute('data-has-color');
    }
}

function __cardGroupBeginDrag(element, node, startEvent) {
    if (!element || !node) return false;
    const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
    if (!state || !state.dragState) return false;

    state.dragState.isDragging = true;
    state.dragState.draggedElement = element;
    state.dragState.dragStartX = startEvent.clientX;
    state.dragState.dragStartY = startEvent.clientY;
    state.dragState.nodeStartX = Number(node.x) || 0;
    state.dragState.nodeStartY = Number(node.y) || 0;
    state.dragState.dragSource = 'temp-node';
    state.dragState.lastClientX = startEvent.clientX;
    state.dragState.lastClientY = startEvent.clientY;
    state.dragState.hasMoved = false;
    state.dragState.meta = null;
    state.dragState.wheelScrollEnabled = true;

    let childElements = [];
    try {
        if (window.__BCSCardGroup && typeof window.__BCSCardGroup.collectCardGroupChildElementsRecursive === 'function') {
            childElements = window.__BCSCardGroup.collectCardGroupChildElementsRecursive(node);
        }
    } catch (_) {
        childElements = [];
    }
    state.dragState.childElements = childElements;

    element.classList.add('dragging');
    element.style.transition = 'none';
    return true;
}

function __cardGroupAttachPillDrag(pill, element, node) {
    let dragPending = false;
    let startX = 0;
    let startY = 0;

    pill.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (!node || node.locked) return;

        try {
            if (typeof selectMdNode === 'function') selectMdNode(node.id);
        } catch (_) { }

        e.preventDefault();
        e.stopPropagation();

        dragPending = true;
        startX = e.clientX;
        startY = e.clientY;

        const onMove = (ev) => {
            if (!dragPending) return;
            const dx = Math.abs(ev.clientX - startX);
            const dy = Math.abs(ev.clientY - startY);
            if (dx + dy < 3) return;

            dragPending = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            const fakeStart = { clientX: startX, clientY: startY };
            __cardGroupBeginDrag(element, node, fakeStart);
            if (typeof updateActiveDragPosition === 'function') {
                try { updateActiveDragPosition(ev.clientX, ev.clientY); } catch (_) { }
            }
            ev.preventDefault();
        };

        const onUp = () => {
            dragPending = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    pill.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        __cardGroupStartRenamePill(pill, node);
    });
}

function __cardGroupAttachMaskDrag(mask, element, node) {
    let dragPending = false;
    let startX = 0;
    let startY = 0;

    mask.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (!node || node.locked) return;

        try {
            if (typeof selectMdNode === 'function') selectMdNode(node.id);
        } catch (_) { }

        e.preventDefault();
        e.stopPropagation();

        dragPending = true;
        startX = e.clientX;
        startY = e.clientY;

        const onMove = (ev) => {
            if (!dragPending) return;
            const dx = Math.abs(ev.clientX - startX);
            const dy = Math.abs(ev.clientY - startY);
            if (dx + dy < 3) return;

            dragPending = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            const fakeStart = { clientX: startX, clientY: startY };
            __cardGroupBeginDrag(element, node, fakeStart);
            if (typeof updateActiveDragPosition === 'function') {
                try { updateActiveDragPosition(ev.clientX, ev.clientY); } catch (_) { }
            }
            ev.preventDefault();
        };

        const onUp = () => {
            dragPending = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function __cardGroupAttachContextMenu(element, node) {
    if (!element || !node) return;
    if (element.dataset.cardGroupContextMenuWired === 'true') return;
    element.dataset.cardGroupContextMenuWired = 'true';
    element.addEventListener('contextmenu', (e) => {
        const target = e.target && e.target.nodeType === Node.ELEMENT_NODE
            ? e.target
            : (e.target && e.target.parentElement ? e.target.parentElement : null);
        if (target && target.closest && target.closest('input, textarea, [contenteditable="true"], .card-group-toolbar, .canvas-node-anchor')) return;
        if (window.__BCSCardGroupToolbar && typeof window.__BCSCardGroupToolbar.showContextMenu === 'function') {
            window.__BCSCardGroupToolbar.showContextMenu(e, node);
        }
    }, true);
}

function __getCardGroupNodeDisplayLabel(node) {
    if (!node) return '';
    const label = String(node.label || '').trim();
    return label || __cardGroupFallbackLabel();
}

function __setCardGroupNodeDisplayLabel(node, nextLabel) {
    if (!node) return '';
    const trimmed = String(nextLabel == null ? '' : nextLabel).trim();
    const next = trimmed || __cardGroupFallbackLabel();
    node.label = next;
    return next;
}

function __cardGroupStartRenamePill(pill, node) {
    if (!pill || !node) return;
    if (pill.dataset.renaming === 'true') return;
    const root = pill.closest('.card-group-canvas-node');
    if (root) {
        root.classList.add('card-group-renaming');
    }
    const toolbar = root ? root.querySelector('.card-group-toolbar') : null;
    if (toolbar) {
        try {
            const openPop = toolbar.querySelector('.card-group-color-popover.open');
            if (openPop) {
                openPop.classList.remove('open');
                if (typeof updateCanvasPopoverState === 'function') {
                    try { updateCanvasPopoverState(false); } catch (_) { }
                }
            }
        } catch (_) { }
        toolbar.style.display = 'none';
    }
    pill.dataset.renaming = 'true';
    const originalLabel = __getCardGroupNodeDisplayLabel(node);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'card-group-header-pill-input';
    input.value = originalLabel;
    pill.innerHTML = '';
    pill.appendChild(input);
    try {
        input.focus();
        const len = String(input.value || '').length;
        if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(len, len);
        }
    } catch (_) { }

    const commit = (save) => {
        if (pill.dataset.renaming !== 'true') return;
        delete pill.dataset.renaming;
        const next = save ? String(input.value || '').trim() : originalLabel;
        const finalLabel = __setCardGroupNodeDisplayLabel(node, next || originalLabel);
        pill.textContent = finalLabel;
        if (root) {
            root.dataset.title = finalLabel;
            root.setAttribute('aria-label', finalLabel);
            root.classList.remove('card-group-renaming');
            try { __ensureCardGroupLowDetailOverlay(root, node); } catch (_) { }
        }
        if (toolbar) {
            toolbar.style.display = '';
        }
        if (save) {
            try { saveTempNodes(); } catch (_) { }
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.isComposing) return;
            e.preventDefault();
            commit(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            commit(false);
        }
        e.stopPropagation();
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
}

function __cardGroupFallbackLabel() {
    const isEn = (typeof currentLang !== 'undefined') && String(currentLang).toLowerCase().startsWith('en');
    return isEn ? 'Card Group' : '卡片组';
}

function __cardGroupApplyZIndex(element, node) {
    if (!element || !node) return;
    element.style.zIndex = node.pinned ? '200' : '5';
    element.classList.toggle('pinned', !!node.pinned);
}

function __cardGroupUpdateHeaderPillScaleCap(element) {
    if (!element) return;
    const pill = element.querySelector('.card-group-header-pill');
    if (!pill) return;
    const cardWidth = element.offsetWidth || parseFloat(element.style.width) || 0;
    if (!Number.isFinite(cardWidth) || cardWidth <= 0) {
        try { pill.style.removeProperty('--card-group-pill-scale-max'); } catch (_) { }
        return;
    }

    // At scale=1, visual pill width equals offsetWidth.
    // To keep visual width <= 50% of card width: scale <= (cardWidth * 0.5) / basePillWidth.
    const basePillWidth = pill.offsetWidth || 0;
    if (!Number.isFinite(basePillWidth) || basePillWidth <= 0) {
        try { pill.style.removeProperty('--card-group-pill-scale-max'); } catch (_) { }
        return;
    }

    const hardMaxRaw = window.getComputedStyle ? window.getComputedStyle(pill).getPropertyValue('--card-group-pill-scale-hard-max') : '';
    const hardMax = parseFloat(hardMaxRaw);
    const widthCap = (cardWidth * 0.5) / basePillWidth;
    const cap = Math.min(widthCap, (Number.isFinite(hardMax) && hardMax > 0) ? hardMax : 2);
    if (Number.isFinite(cap) && cap > 0) {
        pill.style.setProperty('--card-group-pill-scale-max', String(cap));
    } else {
        try { pill.style.removeProperty('--card-group-pill-scale-max'); } catch (_) { }
    }
}

function __cardGroupUpdateLowDetailTitleMetrics(element, node) {
    if (!element) return;
    const width = Math.max(160,
        Number(node && node.width) ||
        parseFloat(element.style.width) ||
        element.offsetWidth ||
        0);
    const height = Math.max(120,
        Number(node && node.height) ||
        parseFloat(element.style.height) ||
        element.offsetHeight ||
        0);
    const minSide = Math.min(width, height);
    const raw = Math.min(width * 0.035, height * 0.10, minSide * 0.09);
    const fontSize = Math.max(14, Math.min(30, raw));
    try { element.style.setProperty('--card-group-low-detail-title-size', `${fontSize.toFixed(1)}px`); } catch (_) { }
}

function __ensureCardGroupLowDetailOverlay(element, node) {
    if (!element || !node) return null;
    let overlay = element.querySelector('.card-group-low-detail-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'card-group-low-detail-overlay';

        const content = document.createElement('div');
        content.className = 'card-group-low-detail-content';

        const title = document.createElement('div');
        title.className = 'card-group-low-detail-title';

        content.appendChild(title);
        overlay.appendChild(content);
        element.appendChild(overlay);
    }

    const title = overlay.querySelector('.card-group-low-detail-title');
    if (title) title.textContent = __getCardGroupNodeDisplayLabel(node);
    __cardGroupUpdateLowDetailTitleMetrics(element, node);
    return overlay;
}

function renderCardGroup(node) {
    if (!node) return null;
    if (node.subtype !== 'card-group') return null;
    const container = document.getElementById('canvasContent');
    if (!container) return null;

    let el = document.getElementById(node.id);
    const isNew = !el;
    if (!el) {
        el = document.createElement('div');
        el.id = node.id;
        el.className = 'card-group-canvas-node';
        container.appendChild(el);
    } else {
        el.classList.remove('md-canvas-node');
        el.classList.add('card-group-canvas-node');
        el.innerHTML = '';
        try { el.style.cssText = ''; } catch (_) { }
        el.classList.remove('low-detail-active');
    }

    if (typeof CanvasState !== 'undefined' && CanvasState && CanvasState.lowDetailActive) {
        el.classList.add('low-detail-active');
    }

    const width = Math.max(160, Number(node.width) || 480);
    const height = Math.max(120, Number(node.height) || 320);
    node.width = width;
    node.height = height;

    const isMax = el.classList && el.classList.contains('canvas-node-maximized');
    if (isMax) {
        el.dataset.maxPrevLeft = (Number(node.x) || 0) + 'px';
        el.dataset.maxPrevTop = (Number(node.y) || 0) + 'px';
        el.dataset.maxPrevWidth = width + 'px';
        el.dataset.maxPrevHeight = height + 'px';
    } else {
        el.style.left = (Number(node.x) || 0) + 'px';
        el.style.top = (Number(node.y) || 0) + 'px';
        el.style.width = width + 'px';
        el.style.height = height + 'px';
    }

    __cardGroupApplyZIndex(el, node);
    applyCardGroupColor(node);

    const labelText = __getCardGroupNodeDisplayLabel(node);

    if (labelText) {
        el.dataset.title = labelText;
        el.setAttribute('aria-label', labelText);
    }

    const pill = document.createElement('div');
    pill.className = 'card-group-header-pill';
    pill.dataset.role = 'drag-handle';
    pill.textContent = String(labelText);
    el.appendChild(pill);
    try { __cardGroupUpdateHeaderPillScaleCap(el); } catch (_) { }

    const body = document.createElement('div');
    body.className = 'card-group-body';
    el.appendChild(body);

    try { __ensureCardGroupLowDetailOverlay(el, node); } catch (_) { }

    const mask = document.createElement('div');
    mask.className = 'card-group-drag-mask';
    el.appendChild(mask);

    try {
        if (typeof window.__BCSCardGroupToolbar !== 'undefined' && typeof window.__BCSCardGroupToolbar.attachToolbar === 'function') {
            window.__BCSCardGroupToolbar.attachToolbar(el, node);
        }
    } catch (_) { }

    try { __cardGroupAttachPillDrag(pill, el, node); } catch (_) { }
    try { __cardGroupAttachMaskDrag(mask, el, node); } catch (_) { }
    try { __cardGroupAttachContextMenu(el, node); } catch (_) { }

    try {
        if (typeof makeTempNodeResizable === 'function') {
            makeTempNodeResizable(el, node);
        }
    } catch (_) { }

    try { __cardGroupUpdateHeaderPillScaleCap(el); } catch (_) { }

    try {
        if (typeof addAnchorsToNode === 'function') {
            addAnchorsToNode(el, node.id);
        }
    } catch (_) { }

    if (isNew) {
        try { scheduleBoundsUpdate && scheduleBoundsUpdate(); } catch (_) { }
    }

    return el;
}

function updateCardGroupLabel(node, nextLabel) {
    if (!node || node.subtype !== 'card-group') return;
    const label = __setCardGroupNodeDisplayLabel(node, nextLabel);
    const el = document.getElementById(node.id);
    if (el) {
        const pill = el.querySelector('.card-group-header-pill');
        if (pill && pill.dataset.renaming !== 'true') {
            pill.textContent = label;
        }
        try { __ensureCardGroupLowDetailOverlay(el, node); } catch (_) { }
        try { __cardGroupUpdateHeaderPillScaleCap(el); } catch (_) { }
        el.dataset.title = label;
        el.setAttribute('aria-label', label);
    }
    try { saveTempNodes(); } catch (_) { }
}

function startCardGroupRename(nodeId) {
    const id = String(nodeId || '').trim();
    if (!id) return false;
    const node = (typeof getMdNodeById === 'function') ? getMdNodeById(id) : null;
    const el = document.getElementById(id);
    const pill = el ? el.querySelector('.card-group-header-pill') : null;
    if (!node || !pill) return false;
    __cardGroupStartRenamePill(pill, node);
    return true;
}

if (typeof window !== 'undefined') {
    window.__BCSCardGroup = window.__BCSCardGroup || {};
    window.__BCSCardGroup.renderCardGroup = renderCardGroup;
    window.__BCSCardGroup.applyCardGroupColor = applyCardGroupColor;
    window.__BCSCardGroup.updateCardGroupLabel = updateCardGroupLabel;
    window.__BCSCardGroup.startRename = startCardGroupRename;
    window.__BCSCardGroup.applyZIndex = __cardGroupApplyZIndex;
    window.__BCSCardGroup.fallbackLabel = __cardGroupFallbackLabel;
    window.__BCSCardGroup.ensureLowDetailOverlay = __ensureCardGroupLowDetailOverlay;
}
