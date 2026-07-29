/*
 * canvas_selection/lasso_and_temp_group.js
 *
 * 左键框选 + 临时组：
 *   1) 画布空白处左键按下 + 拖动 → 绘制选区矩形
 *   2) mouseup 时收集所有 bbox 与选区相交的元素（temp-section / md-node / 永久副本 / 边）
 *   3) 选中后覆盖一层临时蒙版，按蒙版任意位置可整组拖动
 *   4) 显示悬浮工具窗：创建卡片组 / 颜色 / 定位 / 置顶 / 删除
 *
 * 临时组本身不持久化（只存在于运行时）。
 *
 * 加载顺序：在 bookmark_canvas_module.js 与 card_group_create.js 之后。
 */

const LASSO_DRAG_THRESHOLD_PX = 3;
const TEMP_GROUP_PADDING_PX = 12;

let __lassoActive = false;
let __lassoStartCanvas = { x: 0, y: 0 };
let __lassoCurrentCanvas = { x: 0, y: 0 };
let __lassoStartClient = { x: 0, y: 0 };
let __lassoRectEl = null;
let __lassoExceededThreshold = false;
let __lassoOnMove = null;
let __lassoOnUp = null;

let __tempGroup = null; // {members:[{type,data,el}], rect:{x,y,w,h}, maskEl, toolbarEl}

function __saveTempGroupCanvasManifest(options = {}) {
    try {
        if (typeof saveCanvasManifestOnly === 'function') {
            saveCanvasManifestOnly(options);
            return;
        }
    } catch (_) { }
    try { if (typeof saveTempNodes === 'function') saveTempNodes(options); } catch (_) { }
}

function __saveTempGroupNodeUiState() {
    try {
        if (typeof saveCanvasNodeUiState === 'function') {
            saveCanvasNodeUiState();
            return;
        }
    } catch (_) { }
    try { if (typeof saveTempNodes === 'function') saveTempNodes(); } catch (_) { }
}

function __saveTempGroupSectionDelta(deltaInput, options = {}) {
    try {
        if (typeof saveCanvasSectionDelta === 'function') {
            saveCanvasSectionDelta(deltaInput, options);
            return;
        }
    } catch (_) { }
    try { if (typeof saveTempNodes === 'function') saveTempNodes(options); } catch (_) { }
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

function __resolvePermanentSectionNodeId(el) {
    if (!el) return '';
    try {
        if (typeof __getPermanentSectionCanvasNodeId === 'function') {
            const nodeId = String(__getPermanentSectionCanvasNodeId(el) || '').trim();
            if (nodeId) return nodeId;
        }
    } catch (_) { }
    const copyId = String(el.dataset && el.dataset.permanentSectionCopyId || '').trim();
    if (copyId) return `permanent-section-copy-${copyId}`;
    const rawId = String(el.id || '').trim();
    if (rawId) return rawId;
    return '';
}
let __tempGroupEdgeRaf = 0;

let __tempGroupDrag = {
    dragging: false,
    startCanvas: { x: 0, y: 0 },
    snapshot: [],
    edgeMeta: null,
    lastDx: 0,
    lastDy: 0,
    lastClientX: 0,
    lastClientY: 0
};

function __updateTempGroupDragPositionForScroll() {
    if (!__tempGroup || !__tempGroupDrag.dragging) return;
    const currentCanvas = __clientToCanvas(__tempGroupDrag.lastClientX, __tempGroupDrag.lastClientY);
    __tempGroupDrag.lastDx = currentCanvas.x - __tempGroupDrag.startCanvas.x;
    __tempGroupDrag.lastDy = currentCanvas.y - __tempGroupDrag.startCanvas.y;

    __applyMemberTranslateDuringDrag(
        __tempGroupDrag.snapshot,
        __tempGroupDrag.lastDx,
        __tempGroupDrag.lastDy,
        __tempGroupDrag.edgeMeta
    );
    if (__tempGroup.maskEl) {
        __tempGroup.maskEl.style.transform = `translate3d(${__tempGroupDrag.lastDx}px, ${__tempGroupDrag.lastDy}px, 0)`;
    }
    if (__tempGroup.toolbarEl) {
        __tempGroup.toolbarEl.style.transform = `translate3d(${__tempGroupDrag.lastDx}px, ${__tempGroupDrag.lastDy}px, 0) translateX(-50%) scale(var(--canvas-scale-inv, 1))`;
    }
}


function __clientToCanvas(clientX, clientY) {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace || typeof CanvasState === 'undefined') return { x: 0, y: 0 };
    const rect = workspace.getBoundingClientRect();
    const zoom = (CanvasState.zoom && CanvasState.zoom > 0) ? CanvasState.zoom : 1;
    return {
        x: (clientX - rect.left - (Number(CanvasState.panOffsetX) || 0)) / zoom,
        y: (clientY - rect.top - (Number(CanvasState.panOffsetY) || 0)) / zoom
    };
}

function __rectsIntersect(a, b) {
    if (!a || !b) return false;
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function __rectFullyInsideLocal(inner, outer, margin = 0) {
    if (!inner || !outer) return false;
    const m = (typeof margin === 'number' && isFinite(margin)) ? margin : 0;
    return (
        inner.x >= outer.x + m &&
        inner.y >= outer.y + m &&
        inner.x + inner.w <= outer.x + outer.w - m &&
        inner.y + inner.h <= outer.y + outer.h - m
    );
}

function __isLassoGroupNode(node) {
    return !!(node && node.subtype === 'card-group');
}

function __pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function __normalizedLassoRect() {
    const x = Math.min(__lassoStartCanvas.x, __lassoCurrentCanvas.x);
    const y = Math.min(__lassoStartCanvas.y, __lassoCurrentCanvas.y);
    const w = Math.abs(__lassoCurrentCanvas.x - __lassoStartCanvas.x);
    const h = Math.abs(__lassoCurrentCanvas.y - __lassoStartCanvas.y);
    return { x, y, w, h };
}

function __isLassoBlankTarget(e) {
    const target = e && e.target;
    if (!target || !target.closest) return false;
    // 命中任何已存在的画布对象/工具/控件，都不能开始 lasso
    if (target.closest(
        '.permanent-bookmark-section, .temp-canvas-node, .md-canvas-node, .card-group-canvas-node, ' +
        '.card-group-header-pill, .card-group-drag-mask, .card-group-toolbar, .card-group-toolbar-btn, .card-group-color-popover, ' +
        '.canvas-node-anchor, .canvas-anchor-zone, .resize-handle, ' +
        '.canvas-edge, .canvas-edge-glow, .canvas-edge-hit-area, .canvas-edge-label, .canvas-edge-label-bg, .edge-label-fo, ' +
        '.md-node-toolbar, .temp-node-actions, .canvas-layout-zoom-controls, ' +
        '.temp-group-mask, .temp-group-toolbar, .temp-group-toolbar-btn, ' +
        'button, input, textarea, select, a'
    )) return false;
    return true;
}

function __ensureLassoRectEl() {
    if (__lassoRectEl) return __lassoRectEl;
    const content = document.getElementById('canvasContent');
    if (!content) return null;
    const el = document.createElement('div');
    el.className = 'lasso-rect';
    content.appendChild(el);
    __lassoRectEl = el;
    return el;
}

function __updateLassoRectDom() {
    const el = __ensureLassoRectEl();
    if (!el) return;
    const r = __normalizedLassoRect();
    el.style.left = r.x + 'px';
    el.style.top = r.y + 'px';
    el.style.width = r.w + 'px';
    el.style.height = r.h + 'px';
    el.style.display = (__lassoExceededThreshold) ? 'block' : 'none';
}

function __removeLassoRectDom() {
    if (__lassoRectEl) {
        try { __lassoRectEl.remove(); } catch (_) { }
    }
    __lassoRectEl = null;
}

function __getPermanentSectionMembersInRect(lassoRect) {
    const list = [];
    const nodes = document.querySelectorAll('.permanent-bookmark-section');
    nodes.forEach((el) => {
        if (!el) return;
        const nodeId = __resolvePermanentSectionNodeId(el);
        if (!nodeId) return;
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = el.offsetWidth || 0;
        const h = el.offsetHeight || 0;
        if (w <= 0 || h <= 0) return;
        if (__rectsIntersect({ x, y, w, h }, lassoRect)) {
            list.push({
                type: 'permanent-section',
                id: nodeId,
                data: { id: nodeId, x, y, width: w, height: h },
                element: el,
                rect: { x, y, w, h }
            });
        }
    });
    return list;
}

function __getEdgeEndpointPos(edge, role, nodeCenterById = null) {
    if (!edge) return null;
    const id = role === 'from' ? edge.fromNode : edge.toNode;
    if (!id) return null;
    if (nodeCenterById && typeof nodeCenterById.get === 'function') {
        const cached = nodeCenterById.get(id);
        if (cached) return cached;
    }
    const sec = (CanvasState.tempSections || []).find(s => s && s.id === id);
    if (sec) {
        const x = Number(sec.x) || 0;
        const y = Number(sec.y) || 0;
        const w = Number(sec.width) || 0;
        const h = Number(sec.height) || 0;
        return { x: x + w / 2, y: y + h / 2 };
    }
    const md = (CanvasState.mdNodes || []).find(n => n && n.id === id);
    if (md) {
        const x = Number(md.x) || 0;
        const y = Number(md.y) || 0;
        const w = Number(md.width) || 0;
        const h = Number(md.height) || 0;
        return { x: x + w / 2, y: y + h / 2 };
    }
    const el = document.getElementById(id);
    if (el) {
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = el.offsetWidth || 0;
        const h = el.offsetHeight || 0;
        return { x: x + w / 2, y: y + h / 2 };
    }
    return null;
}

function __collectLassoMembers(lassoRect) {
    const members = [];
    const nodeCenterById = new Map();
    (CanvasState.tempSections || []).forEach((s) => {
        if (!s || !s.id) return;
        const r = { x: Number(s.x) || 0, y: Number(s.y) || 0, w: Number(s.width) || 0, h: Number(s.height) || 0 };
        if (r.w <= 0 || r.h <= 0) return;
        nodeCenterById.set(s.id, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
        if (__rectsIntersect(r, lassoRect)) {
            members.push({ type: 'temp-section', id: s.id, data: s, rect: r });
        }
    });
    (CanvasState.mdNodes || []).forEach((n) => {
        if (!n || !n.id) return;
        const r = { x: Number(n.x) || 0, y: Number(n.y) || 0, w: Number(n.width) || 0, h: Number(n.height) || 0 };
        if (r.w <= 0 || r.h <= 0) return;
        nodeCenterById.set(n.id, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
        const matched = __isLassoGroupNode(n)
            ? __rectFullyInsideLocal(r, lassoRect)
            : __rectsIntersect(r, lassoRect);
        if (matched) {
            members.push({ type: 'md-node', id: n.id, data: n, rect: r });
        }
    });
    __getPermanentSectionMembersInRect(lassoRect).forEach((m) => {
        if (m && m.id && m.rect) {
            nodeCenterById.set(m.id, { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 });
        }
        members.push(m);
    });
    (CanvasState.edges || []).forEach((edge) => {
        if (!edge || !edge.id) return;
        const a = __getEdgeEndpointPos(edge, 'from', nodeCenterById);
        const b = __getEdgeEndpointPos(edge, 'to', nodeCenterById);
        if (!a || !b) return;
        if (__pointInRect(a.x, a.y, lassoRect) && __pointInRect(b.x, b.y, lassoRect)) {
            members.push({ type: 'edge', id: edge.id, data: edge, rect: null });
        }
    });
    return members;
}

function __unionRectOfMembers(members) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let counted = 0;
    members.forEach((m) => {
        if (!m || !m.rect) return;
        const r = m.rect;
        if (r.w <= 0 || r.h <= 0) return;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
        counted += 1;
    });
    if (counted === 0) return null;
    return {
        x: minX - TEMP_GROUP_PADDING_PX,
        y: minY - TEMP_GROUP_PADDING_PX,
        w: (maxX - minX) + TEMP_GROUP_PADDING_PX * 2,
        h: (maxY - minY) + TEMP_GROUP_PADDING_PX * 2
    };
}

function dismissTempGroup() {
    if (!__tempGroup) return;
    try { if (__tempGroup.maskEl) __tempGroup.maskEl.remove(); } catch (_) { }
    try { if (__tempGroup.toolbarEl) __tempGroup.toolbarEl.remove(); } catch (_) { }
    __tempGroup = null;
}

function __resolveMemberElement(member) {
    if (!member) return null;
    if (member.type === 'edge') return null;
    if (member.element) return member.element;
    if (typeof __resolveCanvasNodeElementById === 'function') {
        const resolved = __resolveCanvasNodeElementById(member.id);
        if (resolved) return resolved;
    }
    return document.getElementById(member.id);
}

function __captureMemberStartPositions(members) {
    return members.map((m) => {
        const el = __resolveMemberElement(m);
        const startX = (m.data && Number.isFinite(Number(m.data.x))) ? Number(m.data.x)
            : (el ? (parseFloat(el.style.left) || 0) : 0);
        const startY = (m.data && Number.isFinite(Number(m.data.y))) ? Number(m.data.y)
            : (el ? (parseFloat(el.style.top) || 0) : 0);
        return { ...m, element: el, startX, startY };
    });
}

function __tempGroupBuildDragEdgeMeta(snapshot) {
    const movedIds = new Set();
    const movedRects = new Map();
    snapshot.forEach((m) => {
        if (!m || !m.id || m.type === 'edge') return;
        movedIds.add(m.id);
        const domW = m.element ? (m.element.offsetWidth || 0) : 0;
        const domH = m.element ? (m.element.offsetHeight || 0) : 0;
        movedRects.set(m.id, {
            x: Number(m.startX) || 0,
            y: Number(m.startY) || 0,
            width: domW || (m.data ? Number(m.data.width) || 0 : 0),
            height: domH || (m.data ? Number(m.data.height) || 0 : 0)
        });
    });
    const affectedEdges = (CanvasState.edges || []).filter((edge) => edge && edge.id && (
        movedIds.has(edge.fromNode) || movedIds.has(edge.toNode) || movedIds.has(edge.from) || movedIds.has(edge.to)
    ));
    const edgeDomMap = new Map();
    const svg = document.querySelector('.canvas-edges');
    if (svg) {
        const els = svg.querySelectorAll('.canvas-edge, .canvas-edge-glow, .canvas-edge-hit-area, .canvas-edge-label, .canvas-edge-label-bg, foreignObject.edge-label-fo');
        els.forEach((el) => {
            const edgeId = (el && el.dataset && el.dataset.edgeId) ? el.dataset.edgeId : (el ? el.getAttribute('data-edge-id') : null);
            if (!edgeId) return;
            let entry = edgeDomMap.get(edgeId);
            if (!entry) {
                entry = { path: null, glow: null, hitArea: null, label: null, labelBg: null, labelFo: null };
                edgeDomMap.set(edgeId, entry);
            }
            if (el.classList && el.classList.contains('canvas-edge-hit-area')) {
                entry.hitArea = el;
            } else if (el.classList && el.classList.contains('canvas-edge-glow')) {
                entry.glow = el;
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
    }
    return { movedIds, movedRects, affectedEdges, edgeDomMap, dx: 0, dy: 0 };
}

function __tempGroupGetAnchorPosition(meta, nodeId, side) {
    if (meta && meta.movedIds && meta.movedIds.has(nodeId)) {
        const rect = meta.movedRects && meta.movedRects.get ? meta.movedRects.get(nodeId) : null;
        if (rect) {
            const left = (Number(rect.x) || 0) + (Number(meta.dx) || 0);
            const top = (Number(rect.y) || 0) + (Number(meta.dy) || 0);
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
    if (typeof getAnchorPosition === 'function') return getAnchorPosition(nodeId, side);
    return null;
}

function __tempGroupGetEdgeCurveMidpoint(edge, start, end) {
    if (!edge || !start || !end) return null;
    if (typeof computeEdgeControlPoints !== 'function') {
        return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    }
    const { cp1x, cp1y, cp2x, cp2y } = computeEdgeControlPoints(start.x, start.y, end.x, end.y, edge.fromSide, edge.toSide);
    return {
        x: (start.x + 3 * cp1x + 3 * cp2x + end.x) / 8,
        y: (start.y + 3 * cp1y + 3 * cp2y + end.y) / 8
    };
}

function __tempGroupUpdateDraggedEdges(meta) {
    if (!meta || !Array.isArray(meta.affectedEdges) || meta.affectedEdges.length === 0) return;
    meta.affectedEdges.forEach((edge) => {
        if (!edge || !edge.id) return;
        const start = __tempGroupGetAnchorPosition(meta, edge.fromNode || edge.from, edge.fromSide);
        const end = __tempGroupGetAnchorPosition(meta, edge.toNode || edge.to, edge.toSide);
        if (!start || !end) return;
        if (typeof getEdgePathD !== 'function') {
            try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
            return;
        }
        const d = getEdgePathD(start.x, start.y, end.x, end.y, edge.fromSide, edge.toSide);
        const dom = meta.edgeDomMap && meta.edgeDomMap.get ? meta.edgeDomMap.get(edge.id) : null;
        if (dom) {
            if (dom.hitArea) {
                try { dom.hitArea.setAttribute('d', d); } catch (_) { }
            }
            if (dom.path) {
                try { dom.path.setAttribute('d', d); } catch (_) { }
            }
            if (dom.glow) {
                try { dom.glow.setAttribute('d', d); } catch (_) { }
            }
        } else {
            const safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(edge.id) : String(edge.id).replace(/"/g, '\\"');
            const els = document.querySelectorAll(`[data-edge-id="${safeId}"]`);
            if (!els.length) {
                try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
                return;
            }
            els.forEach((el) => {
                if (el.classList && (el.classList.contains('canvas-edge') || el.classList.contains('canvas-edge-glow') || el.classList.contains('canvas-edge-hit-area'))) {
                    try { el.setAttribute('d', d); } catch (_) { }
                }
            });
        }

        if (!dom || (!dom.label && !dom.labelBg && !dom.labelFo)) return;
        const mid = __tempGroupGetEdgeCurveMidpoint(edge, start, end);
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
    try { if (typeof updateEdgeToolbarPosition === 'function') updateEdgeToolbarPosition(); } catch (_) { }
}

function __scheduleTempGroupDraggedEdgeUpdate(meta) {
    if (!meta || __tempGroupEdgeRaf) return;
    __tempGroupEdgeRaf = requestAnimationFrame(() => {
        __tempGroupEdgeRaf = 0;
        __tempGroupUpdateDraggedEdges(meta);
    });
}

function __setTempGroupDragActive(snapshot, active) {
    const content = document.getElementById('canvasContent');
    if (content) {
        try { content.classList.toggle('card-group-drag-active', !!active); } catch (_) { }
        if (!active) {
            try { content.style.removeProperty('--card-group-dx'); } catch (_) { }
            try { content.style.removeProperty('--card-group-dy'); } catch (_) { }
        }
    }
    snapshot.forEach((m) => {
        if (!m || !m.element || m.type === 'edge') return;
        try { m.element.classList.toggle('card-group-dragging', !!active); } catch (_) { }
        if (active) {
            try { m.element.style.transition = 'none'; } catch (_) { }
        }
    });
}

function __applyMemberTranslateDuringDrag(snapshot, dx, dy, edgeMeta) {
    const content = document.getElementById('canvasContent');
    if (content) {
        try { content.style.setProperty('--card-group-dx', `${dx}px`); } catch (_) { }
        try { content.style.setProperty('--card-group-dy', `${dy}px`); } catch (_) { }
    }
    if (edgeMeta) {
        edgeMeta.dx = dx;
        edgeMeta.dy = dy;
        __scheduleTempGroupDraggedEdgeUpdate(edgeMeta);
    }
}

function __commitMemberTranslate(snapshot, dx, dy) {
    if (__tempGroupEdgeRaf) {
        try { cancelAnimationFrame(__tempGroupEdgeRaf); } catch (_) { }
        __tempGroupEdgeRaf = 0;
    }
    const restoreTransitionEls = [];
    snapshot.forEach((m) => {
        if (m.type === 'edge') return;
        if (m.data && Number.isFinite(Number(m.startX)) && Number.isFinite(Number(m.startY))) {
            m.data.x = m.startX + dx;
            m.data.y = m.startY + dy;
        }
        if (m.element) {
            try {
                restoreTransitionEls.push(m.element);
                m.element.style.transition = 'none';
                m.element.style.transform = 'none';
                m.element.style.left = (m.startX + dx) + 'px';
                m.element.style.top = (m.startY + dy) + 'px';
            } catch (_) { }
        }
        if (m.type === 'permanent-section') {
            try {
                if (typeof savePermanentSectionPosition === 'function' && m.element) savePermanentSectionPosition(m.element);
            } catch (_) { }
        }
    });
    __saveTempGroupCanvasManifest();
    try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
    requestAnimationFrame(() => {
        restoreTransitionEls.forEach((el) => {
            try { el.style.transition = ''; } catch (_) { }
        });
    });
}

function __positionTempGroupChrome() {
    if (!__tempGroup) return;
    const r = __tempGroup.rect;
    if (__tempGroup.maskEl) {
        __tempGroup.maskEl.style.left = r.x + 'px';
        __tempGroup.maskEl.style.top = r.y + 'px';
        __tempGroup.maskEl.style.width = r.w + 'px';
        __tempGroup.maskEl.style.height = r.h + 'px';
    }
    if (__tempGroup.toolbarEl) {
        __tempGroup.toolbarEl.style.left = (r.x + r.w / 2) + 'px';
        __tempGroup.toolbarEl.style.top = `calc(${r.y}px - (46px * var(--canvas-scale-inv, 1)))`;
    }
}

function __attachMaskDrag(maskEl) {
    maskEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (!__tempGroup) return;
        e.preventDefault();
        e.stopPropagation();

        __tempGroupDrag.dragging = true;
        __tempGroupDrag.startCanvas = __clientToCanvas(e.clientX, e.clientY);
        __tempGroupDrag.lastClientX = e.clientX;
        __tempGroupDrag.lastClientY = e.clientY;
        __tempGroupDrag.lastDx = 0;
        __tempGroupDrag.lastDy = 0;
        __tempGroupDrag.snapshot = __captureMemberStartPositions(__tempGroup.members || []);
        __tempGroupDrag.edgeMeta = __tempGroupBuildDragEdgeMeta(__tempGroupDrag.snapshot);

        __setTempGroupDragActive(__tempGroupDrag.snapshot, true);
        let dragStarted = false;

        const onMove = (ev) => {
            if (!__tempGroupDrag.dragging) return;
            __tempGroupDrag.lastClientX = ev.clientX;
            __tempGroupDrag.lastClientY = ev.clientY;

            const dx = ev.clientX - e.clientX;
            const dy = ev.clientY - e.clientY;
            if (!dragStarted && Math.hypot(dx, dy) < 3) return;

            if (!dragStarted) {
                dragStarted = true;
                maskEl.classList.add('dragging');
            }

            const currentCanvas = __clientToCanvas(ev.clientX, ev.clientY);
            __tempGroupDrag.lastDx = currentCanvas.x - __tempGroupDrag.startCanvas.x;
            __tempGroupDrag.lastDy = currentCanvas.y - __tempGroupDrag.startCanvas.y;

            __applyMemberTranslateDuringDrag(
                __tempGroupDrag.snapshot,
                __tempGroupDrag.lastDx,
                __tempGroupDrag.lastDy,
                __tempGroupDrag.edgeMeta
            );
            if (__tempGroup) {
                if (__tempGroup.maskEl) {
                    __tempGroup.maskEl.style.transform = `translate3d(${__tempGroupDrag.lastDx}px, ${__tempGroupDrag.lastDy}px, 0)`;
                }
                if (__tempGroup.toolbarEl) {
                    __tempGroup.toolbarEl.style.transform = `translate3d(${__tempGroupDrag.lastDx}px, ${__tempGroupDrag.lastDy}px, 0) translateX(-50%) scale(var(--canvas-scale-inv, 1))`;
                }
            }

            if (typeof window.checkEdgeAutoScroll === 'function') {
                window.checkEdgeAutoScroll(ev.clientX, ev.clientY);
            }
        };

        const onUp = () => {
            if (!__tempGroupDrag.dragging) return;
            __tempGroupDrag.dragging = false;
            maskEl.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            __commitMemberTranslate(
                __tempGroupDrag.snapshot,
                __tempGroupDrag.lastDx,
                __tempGroupDrag.lastDy
            );
            __setTempGroupDragActive(__tempGroupDrag.snapshot, false);
            __tempGroupDrag.edgeMeta = null;

            if (__tempGroup) {
                __tempGroup.rect = {
                    x: __tempGroup.rect.x + __tempGroupDrag.lastDx,
                    y: __tempGroup.rect.y + __tempGroupDrag.lastDy,
                    w: __tempGroup.rect.w,
                    h: __tempGroup.rect.h
                };
                if (__tempGroup.maskEl) __tempGroup.maskEl.style.transform = 'none';
                if (__tempGroup.toolbarEl) __tempGroup.toolbarEl.style.transform = '';
                __positionTempGroupChrome();
            }

            if (typeof window.stopEdgeAutoScroll === 'function') {
                window.stopEdgeAutoScroll();
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}


function __buildTempGroupToolbar() {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    const t = {
        create: isEn ? 'Create card group' : '创建卡片组',
        color: isEn ? 'Color' : '颜色',
        search: isEn ? 'Search in current scope' : '当前范围搜索',
        locate: isEn ? 'Locate and zoom' : '定位并放大',
        pin: isEn ? 'Pin all' : '全部置顶',
        del: isEn ? 'Delete all' : '全部删除'
    };
    const toolbar = document.createElement('div');
    toolbar.className = 'md-node-toolbar temp-group-toolbar';
    toolbar.innerHTML = `
        <button class="md-node-toolbar-btn temp-group-toolbar-btn" data-action="temp-group-create" data-tooltip="${t.create}"><i class="fas fa-object-group"></i></button>
        <button class="md-node-toolbar-btn temp-group-toolbar-btn" data-action="temp-group-color" data-tooltip="${t.color}"><i class="fas fa-palette"></i></button>
        <button class="md-node-toolbar-btn temp-group-toolbar-btn" data-action="temp-group-search" data-tooltip="${t.search}"><i class="fas fa-search"></i></button>
        <button class="md-node-toolbar-btn temp-group-toolbar-btn" data-action="temp-group-locate" data-tooltip="${t.locate}"><i class="fas fa-search-plus"></i></button>
        <button class="md-node-toolbar-btn temp-group-toolbar-btn" data-action="temp-group-pin" data-tooltip="${t.pin}"><i class="fas fa-thumbtack"></i></button>
        <button class="md-node-toolbar-btn md-delete-danger-btn temp-group-toolbar-btn temp-group-toolbar-btn-danger" data-action="temp-group-delete" data-tooltip="${t.del}"><i class="far fa-trash-alt"></i></button>
    `;
    if (typeof preventCanvasEventsPropagation === 'function') {
        try { preventCanvasEventsPropagation(toolbar); } catch (_) { }
    }
    return toolbar;
}

function __buildTempGroupColorPopover() {
    const presets = [
        { key: 'gray', hex: '#888888', custom: true },
        { key: 'blue', hex: '#66bbff', custom: true },
        { key: '1', hex: '#fb464c' },
        { key: '2', hex: '#e9973f' },
        { key: '3', hex: '#e0de71' },
        { key: '4', hex: '#44cf6e' },
        { key: '5', hex: '#53dfdd' },
        { key: '6', hex: '#a882ff' }
    ];
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    const rgbPickerTitle = isEn ? 'RGB Color Picker' : 'RGB颜色选择器';
    const customColorTitle = isEn ? 'Select custom color' : '选择自定义颜色';
    const recentTitle = isEn ? 'Previous color' : '上一次颜色';
    const pop = document.createElement('div');
    pop.className = 'md-color-popover temp-group-color-popover card-group-color-popover';
    pop.innerHTML = `
        ${presets.map((p) => `<span class="md-color-chip card-group-color-chip" data-temp-color-action="${p.custom ? 'custom' : 'preset'}" data-color="${p.key}" data-hex="${p.hex}" style="background:${p.hex}"></span>`).join('')}
        <span class="md-color-divider card-group-color-divider" aria-hidden="true"></span>
        <span class="md-color-chip md-color-recent-chip card-group-color-chip" data-temp-color-action="recent" title="${recentTitle}"></span>
        <button class="md-color-chip md-color-picker-btn temp-group-color-picker-btn" data-temp-color-action="picker" title="${rgbPickerTitle}">
            <svg viewBox="0 0 24 24" width="14" height="14">
                <circle cx="12" cy="12" r="10" fill="url(#temp-group-rainbow-gradient)" />
                <defs>
                    <linearGradient id="temp-group-rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#ff0000" />
                        <stop offset="16.67%" style="stop-color:#ff9900" />
                        <stop offset="33.33%" style="stop-color:#ffff00" />
                        <stop offset="50%" style="stop-color:#00ff00" />
                        <stop offset="66.67%" style="stop-color:#0099ff" />
                        <stop offset="83.33%" style="stop-color:#9900ff" />
                        <stop offset="100%" style="stop-color:#ff0099" />
                    </linearGradient>
                </defs>
            </svg>
        </button>
    `;
    const rgbPicker = document.createElement('div');
    rgbPicker.className = 'md-rgb-picker temp-group-rgb-picker';
    rgbPicker.innerHTML = `
        <input class="md-color-input" type="color" value="${(typeof CanvasState !== 'undefined' && CanvasState.tempGroupPrevColor) ? CanvasState.tempGroupPrevColor : '#66bbff'}" title="${customColorTitle}" />
    `;
    pop.appendChild(rgbPicker);

    const recentChipEl = pop.querySelector('.md-color-recent-chip');
    const syncRecent = (value) => {
        if (!recentChipEl) return;
        const safe = value || ((typeof CanvasState !== 'undefined' && CanvasState.tempGroupPrevColor) ? CanvasState.tempGroupPrevColor : '#66bbff');
        recentChipEl.dataset.hex = safe;
        recentChipEl.style.backgroundColor = safe;
    };
    syncRecent();

    const pickerBtn = pop.querySelector('.temp-group-color-picker-btn');
    const colorInput = rgbPicker.querySelector('.md-color-input');
    if (pickerBtn && colorInput) {
        pickerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = rgbPicker.classList.contains('open');
            if (isOpen) {
                rgbPicker.classList.remove('open');
            } else {
                rgbPicker.classList.add('open');
                setTimeout(() => colorInput.click(), 50);
            }
        });
        colorInput.addEventListener('input', (ev) => {
            __applyTempGroupColor(null, ev.target.value);
            syncRecent(ev.target.value);
        });
        colorInput.addEventListener('change', (ev) => {
            __applyTempGroupColor(null, ev.target.value);
            syncRecent(ev.target.value);
            rgbPicker.classList.remove('open');
        });
    }
    if (typeof preventCanvasEventsPropagation === 'function') {
        try { preventCanvasEventsPropagation(pop); } catch (_) { }
    }
    return pop;
}

function __applyTempGroupColor(presetKey, hex) {
    if (!__tempGroup) return;
    if (typeof CanvasState !== 'undefined') {
        CanvasState.tempGroupPrevColor = hex || (presetKey && typeof presetToHex === 'function' ? presetToHex(presetKey) : CanvasState.tempGroupPrevColor) || '#66bbff';
    }
    __tempGroup.members.forEach((m) => {
        if (!m || !m.data) return;
        try {
            if (m.type === 'temp-section') {
                if (presetKey && /^[1-6]$/.test(String(presetKey))) {
                    if (typeof presetToHex === 'function') {
                        m.data.color = hex || presetToHex(presetKey);
                    }
                } else if (hex) {
                    m.data.color = hex;
                } else {
                    m.data.color = (typeof getTempSectionDefaultColor === 'function') ? getTempSectionDefaultColor(m.data) : m.data.color;
                }
                if (typeof updateTempSectionColor === 'function') {
                    updateTempSectionColor(m.data, m.data.color, { syncSidebar: false });
                }
            } else if (m.type === 'md-node') {
                if (m.data.subtype === 'card-group') {
                    if (presetKey && /^[1-6]$/.test(String(presetKey))) {
                        m.data.color = String(presetKey);
                        if (typeof presetToHex === 'function') m.data.colorHex = presetToHex(m.data.color);
                    } else if (hex) {
                        m.data.color = null;
                        m.data.colorHex = hex;
                    } else {
                        m.data.color = null;
                        m.data.colorHex = null;
                    }
                    if (window.__BCSCardGroup && typeof window.__BCSCardGroup.applyCardGroupColor === 'function') {
                        window.__BCSCardGroup.applyCardGroupColor(m.data);
                    }
                } else {
                    const value = (presetKey && /^[1-6]$/.test(String(presetKey)))
                        ? presetKey
                        : (hex || '');
                    if (typeof setMdNodeColor === 'function') setMdNodeColor(m.data, value, { persist: false, syncSidebar: false });
                }
            } else if (m.type === 'edge') {
                const value = (presetKey && /^[1-6]$/.test(String(presetKey)))
                    ? presetKey
                    : (hex || '');
                if (typeof setEdgeColor === 'function') setEdgeColor(m.data, value, { persist: false });
            }
        } catch (_) { }
    });
    __saveTempGroupCanvasManifest();
    try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
}

function __locateToTempGroup() {
    if (!__tempGroup) return;
    const r = __tempGroup.rect;
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    const wsW = workspace.clientWidth;
    const wsH = workspace.clientHeight;
    if (wsW <= 0 || wsH <= 0 || r.w <= 0 || r.h <= 0) return;
    const padding = 60;
    const fitW = Math.max(0.1, (wsW - padding) / r.w);
    const fitH = Math.max(0.1, (wsH - padding) / r.h);
    const fitZoom = Math.min(fitW, fitH);
    const targetZoom = (typeof clampCanvasZoom === 'function')
        ? clampCanvasZoom(Math.min(1.0, fitZoom))
        : Math.min(1.0, fitZoom);
    if (typeof setCanvasZoom === 'function' && Math.abs(targetZoom - (CanvasState.zoom || 1)) > 0.01) {
        try {
            const rect = workspace.getBoundingClientRect();
            setCanvasZoom(targetZoom, rect.left + rect.width / 2, rect.top + rect.height / 2, { recomputeBounds: true });
        } catch (_) { }
    }
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    CanvasState.panOffsetX = wsW / 2 - cx * (CanvasState.zoom || 1);
    CanvasState.panOffsetY = wsH / 2 - cy * (CanvasState.zoom || 1);
    try { if (typeof updateCanvasScrollBounds === 'function') updateCanvasScrollBounds(); } catch (_) { }
    try { if (typeof applyPanOffset === 'function') applyPanOffset(); } catch (_) { }
    try { if (typeof savePanOffsetThrottled === 'function') savePanOffsetThrottled(); } catch (_) { }
}

function __getTempGroupMemberPinnedState(member) {
    if (!member) return null;
    if (member.type === 'temp-section' || member.type === 'md-node') {
        if (member.type === 'md-node' && member.data && member.data.subtype === 'card-group') {
            if (typeof getCardGroupMembersPinState === 'function') {
                const state = getCardGroupMembersPinState(member.data.id);
                return state && state.hasTargets ? !!state.allPinned : null;
            }
            return null;
        }
        return member.data ? !!member.data.pinned : null;
    }
    if (member.type === 'permanent-section') {
        const el = __resolveMemberElement(member);
        if (!el) return null;
        const btn = el.querySelector('.permanent-section-pin-btn');
        return !!(btn && btn.classList && btn.classList.contains('pinned')) || el.style.zIndex === '200';
    }
    return null;
}

function __setTempGroupMemberPinnedState(member, isPinned) {
    if (!member) return false;
    const current = __getTempGroupMemberPinnedState(member);
    if (current === null || current === !!isPinned) return false;
    if (member.type === 'temp-section') {
        if (typeof toggleTempSectionPin === 'function') toggleTempSectionPin(member.id);
        return true;
    }
    if (member.type === 'md-node') {
        if (member.data && member.data.subtype === 'card-group') {
            if (typeof toggleCardGroupMembersPin === 'function') toggleCardGroupMembersPin(member.data.id);
            return true;
        }
        if (typeof toggleMdNodePin === 'function') toggleMdNodePin(member.id);
        return true;
    }
    if (member.type === 'permanent-section') {
        const el = __resolveMemberElement(member);
        if (typeof togglePermanentSectionPin === 'function' && el) {
            togglePermanentSectionPin(el);
            return true;
        }
    }
    return false;
}

function __syncTempGroupPinButton() {
    if (!__tempGroup || !__tempGroup.toolbarEl) return;
    const btn = __tempGroup.toolbarEl.querySelector('.temp-group-toolbar-btn[data-action="temp-group-pin"]');
    if (!btn) return;
    const members = (__tempGroup.members || []).filter((m) => __getTempGroupMemberPinnedState(m) !== null);
    const allPinned = members.length > 0 && members.every((m) => __getTempGroupMemberPinnedState(m) === true);
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    const title = allPinned ? (isEn ? 'Unpin all' : '全部取消置顶') : (isEn ? 'Pin all' : '全部置顶');
    btn.classList.toggle('pinned', allPinned);
    btn.setAttribute('data-tooltip', title);
    btn.title = title;
    btn.innerHTML = allPinned
        ? '<i class="fas fa-thumbtack"></i>'
        : '<i class="fas fa-thumbtack" style="opacity: 0.5;"></i>';
}

function __pinAllTempGroup() {
    if (!__tempGroup) return;
    const members = (__tempGroup.members || []).filter((m) => __getTempGroupMemberPinnedState(m) !== null);
    if (members.length === 0) return;
    const shouldPin = members.some((m) => __getTempGroupMemberPinnedState(m) !== true);
    members.forEach((m) => {
        try {
            __setTempGroupMemberPinnedState(m, shouldPin);
        } catch (_) { }
    });
    __syncTempGroupPinButton();
    __saveTempGroupNodeUiState();
}

function __deleteAllTempGroup() {
    if (!__tempGroup) return;
    const members = __tempGroup.members.slice();
    const removedTempIds = [];
    members.forEach((m) => {
        if (!m || !m.id) return;
        try {
            if (m.type === 'temp-section') {
                removedTempIds.push(m.id);
                if (typeof removeTempNode === 'function') removeTempNode(m.id, { skipSave: true });
            } else if (m.type === 'md-node') {
                if (typeof removeMdNode === 'function') removeMdNode(m.id, false, { skipSave: true });
            } else if (m.type === 'permanent-section') {
                // 永久副本删除：现有 API 接受 DOM 元素
                const el = __resolveMemberElement(m);
                if (el && typeof removePermanentSectionCopy === 'function') {
                    removePermanentSectionCopy(el);
                }
            } else if (m.type === 'edge') {
                if (typeof removeEdge === 'function') removeEdge(m.id);
            }
        } catch (_) { }
    });
    if (removedTempIds.length) {
        __saveTempGroupSectionDelta({ deleteSectionIds: removedTempIds }, { immediate: true });
    } else {
        __saveTempGroupCanvasManifest({ immediate: true });
    }
    try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
    dismissTempGroup();
}

function __convertTempGroupToCardGroup() {
    if (!__tempGroup) return;
    const r = __tempGroup.rect;
    if (!window.CanvasGroups || typeof window.CanvasGroups.createCardGroup !== 'function') return;
    const minW = Math.max(160, Math.round(r.w));
    const minH = Math.max(120, Math.round(r.h));
    const sourceMembers = (__tempGroup.members || []).slice();
    const created = window.CanvasGroups.createCardGroup({
        canvasPosition: { left: r.x, top: r.y },
        width: minW,
        height: minH,
        title: '',
        kind: 'fixed'
    });
    if (created && created.node) {
        try {
            if (window.__BCSCardGroup && typeof window.__BCSCardGroup.setTransientMemberHint === 'function') {
                window.__BCSCardGroup.setTransientMemberHint(created.node.id, sourceMembers);
            }
            __saveTempGroupCanvasManifest();
            try { if (typeof renderEdges === 'function') renderEdges(); } catch (_) { }
        } catch (_) { }
    }
    dismissTempGroup();
}

function __bindTempGroupToolbarActions(toolbar) {
    let colorPop = null;
    const closeColorPop = () => {
        if (colorPop) {
            colorPop.classList.remove('open');
        }
    };

    toolbar.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.temp-group-toolbar-btn') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-action');

        if (action === 'temp-group-create') {
            __convertTempGroupToCardGroup();
        } else if (action === 'temp-group-color') {
            if (!colorPop) {
                colorPop = __buildTempGroupColorPopover();
                toolbar.appendChild(colorPop);
                colorPop.addEventListener('click', (ev) => {
                    const chip = ev.target && ev.target.closest ? ev.target.closest('[data-temp-color-action]') : null;
                    if (!chip) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    const kind = chip.getAttribute('data-temp-color-action');
                    if (kind === 'preset') {
                        __applyTempGroupColor(chip.getAttribute('data-color'), chip.getAttribute('data-hex'));
                    } else if (kind === 'custom' || kind === 'recent') {
                        __applyTempGroupColor(null, chip.getAttribute('data-hex'));
                    }
                });
            }
            if (colorPop.classList.contains('open')) {
                closeColorPop();
            } else {
                colorPop.classList.add('open');
                const onDoc = (ev) => {
                    if (!toolbar.contains(ev.target)) {
                        closeColorPop();
                        document.removeEventListener('mousedown', onDoc, true);
                    }
                };
                document.addEventListener('mousedown', onDoc, true);
            }
        } else if (action === 'temp-group-search') {
            closeColorPop();
            try {
                if (__tempGroup && Array.isArray(__tempGroup.members)) {
                    const memberIds = __tempGroup.members.map(m => m.id).filter(Boolean);
                    if (typeof window.triggerAreaSearch === 'function') {
                        window.triggerAreaSearch({
                            kind: 'temp',
                            id: 'temp-group-selection',
                            memberIds: memberIds
                        });
                    }
                }
            } catch (err) {
                console.error('[TempGroup] failed to trigger area search:', err);
            }
        } else if (action === 'temp-group-locate') {
            __locateToTempGroup();
        } else if (action === 'temp-group-pin') {
            __pinAllTempGroup();
        } else if (action === 'temp-group-delete') {
            __deleteAllTempGroup();
        }
    });
}

function __tempGroupContextMenuLabels() {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    return {
        create: isEn ? 'Create card group' : '创建卡片组',
        color: isEn ? 'Color' : '颜色',
        search: isEn ? 'Search in current scope' : '当前范围搜索',
        locate: isEn ? 'Locate' : '定位',
        pin: isEn ? 'Pin' : '置顶',
        del: isEn ? 'Delete' : '删除',
        export: isEn ? 'Export' : '导出'
    };
}

function __positionTempGroupContextColorPopover(pop, anchorPoint) {
    if (!pop) return;
    const x = anchorPoint && Number.isFinite(Number(anchorPoint.x)) ? Number(anchorPoint.x) : 0;
    const y = anchorPoint && Number.isFinite(Number(anchorPoint.y)) ? Number(anchorPoint.y) : 0;
    pop.classList.add('context-anchored', 'open');
    pop.style.position = 'fixed';
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
    pop.style.transform = 'none';
    pop.style.zIndex = '10001';
    requestAnimationFrame(() => {
        const rect = pop.getBoundingClientRect();
        let nextLeft = x;
        let nextTop = y;
        if (rect.right > window.innerWidth - 8) nextLeft = Math.max(8, window.innerWidth - rect.width - 8);
        if (rect.bottom > window.innerHeight - 8) nextTop = Math.max(8, window.innerHeight - rect.height - 8);
        pop.style.left = nextLeft + 'px';
        pop.style.top = nextTop + 'px';
    });
}

function __openTempGroupContextColorPopover(anchorPoint) {
    if (!__tempGroup) return;
    const existing = document.querySelector('.temp-group-context-color-popover');
    if (existing) existing.remove();
    const pop = __buildTempGroupColorPopover();
    pop.classList.add('temp-group-context-color-popover');
    getOverlayContainer().appendChild(pop);
    pop.addEventListener('click', (ev) => {
        const chip = ev.target && ev.target.closest ? ev.target.closest('[data-temp-color-action]') : null;
        if (!chip) return;
        ev.preventDefault();
        ev.stopPropagation();
        const kind = chip.getAttribute('data-temp-color-action');
        if (kind === 'preset') {
            __applyTempGroupColor(chip.getAttribute('data-color'), chip.getAttribute('data-hex'));
        } else if (kind === 'custom' || kind === 'recent') {
            __applyTempGroupColor(null, chip.getAttribute('data-hex'));
        }
    });
    __positionTempGroupContextColorPopover(pop, anchorPoint);
    const close = (ev) => {
        if (pop.contains(ev.target)) return;
        try { pop.remove(); } catch (_) { }
        document.removeEventListener('mousedown', close, true);
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

function __handleTempGroupContextMenuAction(action, options = {}) {
    if (!__tempGroup) return;
    if (action === 'temp-group-context-create') {
        __convertTempGroupToCardGroup();
    } else if (action === 'temp-group-context-color') {
        __openTempGroupContextColorPopover(options.anchorPoint || null);
    } else if (action === 'temp-group-context-search') {
        try {
            if (__tempGroup && Array.isArray(__tempGroup.members)) {
                const memberIds = __tempGroup.members.map(m => m.id).filter(Boolean);
                if (typeof window.triggerAreaSearch === 'function') {
                    window.triggerAreaSearch({
                        kind: 'temp',
                        id: 'temp-group-selection',
                        memberIds: memberIds
                    });
                }
            }
        } catch (err) {
            console.error('[TempGroup] failed to trigger area search from context menu:', err);
        }
    } else if (action === 'temp-group-context-locate') {
        __locateToTempGroup();
    } else if (action === 'temp-group-context-pin') {
        __pinAllTempGroup();
    } else if (action === 'temp-group-context-delete') {
        __deleteAllTempGroup();
    } else if (action === 'temp-group-context-export') {
        const members = (__tempGroup.members || []).slice();
        try {
            if (typeof window !== 'undefined' && typeof window.exportCanvasTempGroupPackage === 'function') {
                window.exportCanvasTempGroupPackage(members, {
                    label: (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? '框选组' : 'selection'
                }).catch((error) => {
                    console.error('[TempGroup] export failed:', error);
                    alert(((typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? '导出失败: ' : 'Export failed: ') + (error && error.message ? error.message : error));
                });
            }
        } catch (error) {
            console.error('[TempGroup] export failed:', error);
        }
    }
}

function showTempGroupContextMenu(event) {
    if (!event || !__tempGroup) return false;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    const menu = document.getElementById('bookmark-context-menu');
    if (!menu) return false;
    const labels = __tempGroupContextMenuLabels();
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh_CN';
    const items = [
        { action: 'temp-group-context-create', label: labels.create, icon: 'object-group' },
        { action: 'temp-group-context-color', label: labels.color, icon: 'palette' },
        { action: 'temp-group-context-search', label: labels.search, icon: 'search' },
        { action: 'temp-group-context-locate', label: labels.locate, icon: 'crosshairs' },
        { action: 'temp-group-context-pin', label: labels.pin, icon: 'thumbtack' },
        { action: 'temp-group-context-export', label: labels.export, icon: 'file-export' },
        { action: 'temp-group-context-delete', label: labels.del, icon: 'trash-alt', className: 'color-red' }
    ];
    menu.classList.remove('horizontal-layout', 'density-xs', 'density-md', 'density-lg', 'lang-zh', 'lang-en');
    menu.classList.add('density-sm');
    menu.classList.add(String(lang).toLowerCase().startsWith('en') ? 'lang-en' : 'lang-zh');
    menu.dataset.menuScope = 'temp-group-object';
    menu.innerHTML = items.map(item => `
        <div class="context-menu-item ${item.className || ''}" data-action="${item.action}">
            <i class="fas fa-${item.icon}"></i>
            <span class="context-menu-item-label"><span>${item.label}</span></span>
        </div>
    `).join('');
    const point = { x: event.clientX, y: event.clientY };
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const action = item.dataset.action;
            const anchorPoint = action === 'temp-group-context-color'
                ? { x: point.x, y: point.y + (item.offsetTop || 0) }
                : point;
            if (typeof hideContextMenu === 'function') {
                try { hideContextMenu(); } catch (_) { }
            } else {
                menu.style.display = 'none';
            }
            __handleTempGroupContextMenuAction(action, { anchorPoint });
        });
    });
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.transformOrigin = '';
    menu.style.transform = '';
    menu.style.display = 'block';
    if (menu.parentElement && menu.parentElement !== getOverlayContainer()) getOverlayContainer().appendChild(menu);
    return true;
}

function showTempGroupForMembers(members) {
    dismissTempGroup();
    if (!Array.isArray(members) || members.length === 0) return;
    const unionRect = __unionRectOfMembers(members);
    if (!unionRect) return;

    const content = document.getElementById('canvasContent');
    if (!content) return;

    const maskEl = document.createElement('div');
    maskEl.className = 'temp-group-mask';
    content.appendChild(maskEl);
    __attachMaskDrag(maskEl);
    maskEl.addEventListener('contextmenu', showTempGroupContextMenu, true);

    const toolbarEl = __buildTempGroupToolbar();
    toolbarEl.classList.add('temp-group-toolbar-fixed');
    content.appendChild(toolbarEl);
    __bindTempGroupToolbarActions(toolbarEl);

    __tempGroup = { members, rect: unionRect, maskEl, toolbarEl };
    __syncTempGroupPinButton();
    __positionTempGroupChrome();

    // 外部 mousedown（除了蒙版/工具窗自身）取消临时组
    const onDocMouseDown = (e) => {
        if (!__tempGroup) {
            document.removeEventListener('mousedown', onDocMouseDown, true);
            return;
        }
        const target = e.target;
        if (!target) return;
        if (target.closest && (target.closest('.temp-group-mask') || target.closest('.temp-group-toolbar') || target.closest('#bookmark-context-menu') || target.closest('.temp-group-context-color-popover'))) return;
        // 进入新一轮 lasso 时也会自动取消；这里在点击空白处直接取消
        dismissTempGroup();
        document.removeEventListener('mousedown', onDocMouseDown, true);
    };
    setTimeout(() => {
        document.addEventListener('mousedown', onDocMouseDown, true);
    }, 0);
}

function __cancelLasso() {
    __lassoActive = false;
    __lassoExceededThreshold = false;
    __removeLassoRectDom();
    if (__lassoOnMove) {
        try { document.removeEventListener('mousemove', __lassoOnMove); } catch (_) { }
        __lassoOnMove = null;
    }
    if (__lassoOnUp) {
        try { document.removeEventListener('mouseup', __lassoOnUp); } catch (_) { }
        __lassoOnUp = null;
    }
}

function __handleLassoMouseDown(e) {
    if (e.button !== 0) return;
    if (typeof CanvasState === 'undefined' || !CanvasState) return;
    if (CanvasState.isSpacePressed || CanvasState.isCtrlPressed) return;
    if (CanvasState.isPanning) return;
    if (CanvasState.sectionCtrlMode && CanvasState.sectionCtrlMode.active) return;
    if (!__isLassoBlankTarget(e)) return;

    // 若有已存在的临时组，先取消
    dismissTempGroup();

    __lassoActive = true;
    __lassoExceededThreshold = false;
    __lassoStartClient = { x: e.clientX, y: e.clientY };
    __lassoStartCanvas = __clientToCanvas(e.clientX, e.clientY);
    __lassoCurrentCanvas = { ...__lassoStartCanvas };

    __lassoOnMove = (ev) => {
        if (!__lassoActive) return;
        const dx = Math.abs(ev.clientX - __lassoStartClient.x);
        const dy = Math.abs(ev.clientY - __lassoStartClient.y);
        if (!__lassoExceededThreshold && (dx + dy) < LASSO_DRAG_THRESHOLD_PX) return;
        __lassoExceededThreshold = true;
        __lassoCurrentCanvas = __clientToCanvas(ev.clientX, ev.clientY);
        __updateLassoRectDom();
    };
    __lassoOnUp = (ev) => {
        if (!__lassoActive) return;
        const wasLasso = __lassoExceededThreshold;
        __lassoActive = false;
        const rect = wasLasso ? __normalizedLassoRect() : null;
        __removeLassoRectDom();
        __lassoExceededThreshold = false;
        if (__lassoOnMove) {
            try { document.removeEventListener('mousemove', __lassoOnMove); } catch (_) { }
            __lassoOnMove = null;
        }
        if (__lassoOnUp) {
            try { document.removeEventListener('mouseup', __lassoOnUp); } catch (_) { }
            __lassoOnUp = null;
        }
        if (!wasLasso || !rect || rect.w < 4 || rect.h < 4) return;
        const members = __collectLassoMembers(rect);
        if (members.length > 0) {
            showTempGroupForMembers(members);
        }
    };
    document.addEventListener('mousemove', __lassoOnMove);
    document.addEventListener('mouseup', __lassoOnUp);
}

function __wireLassoSelect() {
    const workspace = document.getElementById('canvasWorkspace');
    if (!workspace) return;
    if (workspace.dataset.lassoWired === 'true') return;
    workspace.dataset.lassoWired = 'true';
    workspace.addEventListener('mousedown', __handleLassoMouseDown);
}

if (typeof window !== 'undefined') {
    window.__BCSLassoTempGroup = {
        wire: __wireLassoSelect,
        dismiss: dismissTempGroup,
        showForMembers: showTempGroupForMembers,
        isDragging: () => __tempGroupDrag.dragging,
        updateDragPositionForScroll: __updateTempGroupDragPositionForScroll
    };
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', __wireLassoSelect, { once: true });
    } else {
        // history.html 中 defer 脚本会在 DOMContentLoaded 之后才执行
        setTimeout(__wireLassoSelect, 0);
    }
}
