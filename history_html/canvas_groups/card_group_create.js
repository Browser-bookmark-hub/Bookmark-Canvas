/*
 * canvas_groups/card_group_create.js
 *
 * 卡片组（card-group）创建入口：window.CanvasGroups.createCardGroup。
 * 由 bookmark_tree_context_menu.js 中的 __invokeCanvasCardGroupCreateHandler 调用。
 *
 * 在 card_group_render.js 之后加载（依赖 CanvasState、renderCardGroup、saveTempNodes、
 * scheduleSaveBcsCanvas、formatTimestampForTitle）。
 */

const CARD_GROUP_DEFAULT_WIDTH = 480;
const CARD_GROUP_DEFAULT_HEIGHT = 320;
const CARD_GROUP_EMPTY_SCALE = 3;

function __cardGroupNewId() {
    const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
    if (!state) return `card-group-${Date.now().toString(36)}`;
    state.mdNodeCounter = (Number(state.mdNodeCounter) || 0) + 1;
    return `card-group-${state.mdNodeCounter}`;
}

function getDefaultCardGroupLabel() {
    const isEn = (typeof currentLang !== 'undefined') && String(currentLang).toLowerCase().startsWith('en');
    const prefix = isEn ? 'Card Group' : '卡片组';
    let suffix = '';
    try {
        if (typeof formatTimestampForTitle === 'function') {
            suffix = ' ' + String(formatTimestampForTitle(new Date()) || '').trim();
        }
    } catch (_) { suffix = ''; }
    if (!suffix) {
        const d = new Date();
        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        suffix = ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return (prefix + suffix).trim();
}

function createCardGroupNode(payload) {
    const safe = (payload && typeof payload === 'object') ? payload : {};
    const pos = (safe.canvasPosition && typeof safe.canvasPosition === 'object') ? safe.canvasPosition : {};
    const left = Number.isFinite(Number(pos.left)) ? Number(pos.left) : 0;
    const top = Number.isFinite(Number(pos.top)) ? Number(pos.top) : 0;
    const size = (safe.canvasSize && typeof safe.canvasSize === 'object') ? safe.canvasSize : {};
    const isEmptyGroup = safe.empty === true || safe.emptyGroup === true;
    const defaultWidth = isEmptyGroup ? CARD_GROUP_DEFAULT_WIDTH * CARD_GROUP_EMPTY_SCALE : CARD_GROUP_DEFAULT_WIDTH;
    const defaultHeight = isEmptyGroup ? CARD_GROUP_DEFAULT_HEIGHT * CARD_GROUP_EMPTY_SCALE : CARD_GROUP_DEFAULT_HEIGHT;
    const width = Math.max(160, Number.isFinite(Number(safe.width)) ? Number(safe.width)
        : (Number.isFinite(Number(size.width)) ? Number(size.width) : defaultWidth));
    const height = Math.max(120, Number.isFinite(Number(safe.height)) ? Number(safe.height)
        : (Number.isFinite(Number(size.height)) ? Number(size.height) : defaultHeight));

    let label = String(safe.title || '').trim();
    if (!label || label.toLowerCase() === 'fixed group' || label === '固定组') {
        label = getDefaultCardGroupLabel();
    }

    const defaultColor = (typeof getCardGroupDefaultColor === 'function')
        ? getCardGroupDefaultColor()
        : ((window.CanvasModule && typeof window.CanvasModule.getCardGroupDefaultColor === 'function')
            ? window.CanvasModule.getCardGroupDefaultColor()
            : '#888888');

    const node = {
        id: __cardGroupNewId(),
        type: 'md',
        subtype: 'card-group',
        x: left,
        y: top,
        width,
        height,
        label,
        color: null,
        colorHex: defaultColor || null,
        pinned: false
    };

    if (typeof CanvasState !== 'undefined' && Array.isArray(CanvasState.mdNodes)) {
        CanvasState.mdNodes.push(node);
    }

    try {
        if (window.__BCSCardGroup && typeof window.__BCSCardGroup.renderCardGroup === 'function') {
            window.__BCSCardGroup.renderCardGroup(node);
        }
    } catch (_) { }

    try { if (typeof selectMdNode === 'function') selectMdNode(node.id); } catch (_) { }
    try { if (typeof saveTempNodes === 'function') saveTempNodes(); } catch (_) { }
    try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
    try { if (typeof scheduleBoundsUpdate === 'function') scheduleBoundsUpdate(); } catch (_) { }

    return { ...safe, completed: true, node };
}

if (typeof window !== 'undefined') {
    window.CanvasGroups = window.CanvasGroups || {};
    window.CanvasGroups.createCardGroup = createCardGroupNode;
    window.CanvasGroups.getDefaultCardGroupLabel = getDefaultCardGroupLabel;
}
