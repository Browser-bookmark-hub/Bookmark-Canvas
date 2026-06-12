/*
 * canvas_groups/card_group_membership.js
 *
 * 卡片组（card-group）几何成员判定。
 *
 * 该文件在 bookmark_canvas_module.js 之前加载，所以这里只声明函数；
 * 在被调用时再读取全局 CanvasState 与已加载的 helper（__getRectOfSectionOrNode、__rectFullyInside）。
 */

function isCardGroupNode(node) {
    return !!(node && node.subtype === 'card-group');
}

function isGroupLikeMdNode(node) {
    return isCardGroupNode(node);
}

const __cardGroupTransientMemberHints = new Map();

function setCardGroupTransientMemberHint(groupId, members) {
    const id = String(groupId || '').trim();
    if (!id || !Array.isArray(members)) return;
    const hints = members
        .map((m) => ({
            type: m && m.type,
            id: String((m && m.id) || '').trim()
        }))
        .filter((m) => m.id && (m.type === 'temp-section' || m.type === 'md-node' || m.type === 'permanent-section'));
    if (hints.length > 0) {
        __cardGroupTransientMemberHints.set(id, hints);
    } else {
        __cardGroupTransientMemberHints.delete(id);
    }
}

function __getCardGroupRect(group) {
    if (typeof __getRectOfSectionOrNode === 'function') {
        return __getRectOfSectionOrNode(group, 'md-node');
    }
    if (!group) return null;
    const x = Number(group.x);
    const y = Number(group.y);
    const w = Number(group.width);
    const h = Number(group.height);
    if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
    return { x, y, w, h };
}

function __cardGroupContainmentMargin() {
    const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
    const zoom = (state && state.zoom && state.zoom > 0) ? state.zoom : 1;
    return 12 / zoom;
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

function __buildPermanentSectionMemberData(el, nodeId) {
    if (!el || !nodeId) return null;
    const x = parseFloat(el.style.left) || 0;
    const y = parseFloat(el.style.top) || 0;
    const width = parseFloat(el.style.width) || el.offsetWidth || 0;
    const height = parseFloat(el.style.height) || el.offsetHeight || 0;
    if (width <= 0 || height <= 0) return null;
    return { id: nodeId, x, y, width, height, _permanentElement: el };
}

function getDirectGeometricMembers(group) {
    if (!isGroupLikeMdNode(group)) return [];
    const selfRect = __getCardGroupRect(group);
    if (!selfRect) return [];
    const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
    if (!state) return [];

    const margin = 0;
    const fullyInside = (typeof __rectFullyInside === 'function') ? __rectFullyInside : null;
    if (!fullyInside) return [];

    const members = [];

    const tempSections = Array.isArray(state.tempSections) ? state.tempSections : [];
    tempSections.forEach((s) => {
        if (!s || !s.id) return;
        const r = __getRectOfSectionOrNode ? __getRectOfSectionOrNode(s, 'temp-section') : null;
        if (r && fullyInside(r, selfRect, margin)) {
            members.push({ type: 'temp-section', data: s });
        }
    });

    const mdNodes = Array.isArray(state.mdNodes) ? state.mdNodes : [];
    mdNodes.forEach((n) => {
        if (!n || !n.id || n.id === group.id) return;
        const r = __getRectOfSectionOrNode ? __getRectOfSectionOrNode(n, 'md-node') : null;
        const containmentMargin = isGroupLikeMdNode(n) ? 0 : margin;
        if (r && fullyInside(r, selfRect, containmentMargin)) {
            members.push({ type: 'md-node', data: n });
        }
    });

    try {
        const permanentEls = (typeof document !== 'undefined')
            ? document.querySelectorAll('.permanent-bookmark-section')
            : [];
        permanentEls.forEach((el) => {
            const nodeId = __resolvePermanentSectionNodeId(el);
            if (!nodeId) return;
            const data = __buildPermanentSectionMemberData(el, nodeId);
            if (!data) return;
            const r = { x: data.x, y: data.y, w: data.width, h: data.height };
            if (fullyInside(r, selfRect, margin)) {
                members.push({ type: 'permanent-section', data });
            }
        });
    } catch (_) { }

    return members;
}

function getRecursiveGeometricMembers(group, visited) {
    const seen = visited instanceof Set ? visited : new Set();
    if (!isGroupLikeMdNode(group) || seen.has(group.id)) return [];
    seen.add(group.id);

    const direct = getDirectGeometricMembers(group);
    const result = [];
    direct.forEach((member) => {
        result.push(member);
        if (member.type === 'md-node' && isGroupLikeMdNode(member.data)) {
            const deeper = getRecursiveGeometricMembers(member.data, seen);
            deeper.forEach((d) => result.push(d));
        }
    });
    return result;
}

function collectCardGroupChildElementsRecursive(group) {
    if (!isGroupLikeMdNode(group)) return [];
    const members = getRecursiveGeometricMembers(group);
    const childElements = [];
    const seen = new Set();
    const pushMember = (member) => {
        const data = member.data;
        if (!data || !data.id) return;
        if (seen.has(data.id)) return;
        seen.add(data.id);
        let element = null;
        if (member.type === 'permanent-section') {
            element = data._permanentElement
                || ((typeof __resolveCanvasNodeElementById === 'function') ? __resolveCanvasNodeElementById(data.id) : null)
                || ((typeof document !== 'undefined') ? document.getElementById(data.id) : null);
        } else {
            element = (typeof document !== 'undefined') ? document.getElementById(data.id) : null;
        }
        const startX = Number.isFinite(Number(data.x)) ? Number(data.x) : (element ? (parseFloat(element.style.left) || 0) : NaN);
        const startY = Number.isFinite(Number(data.y)) ? Number(data.y) : (element ? (parseFloat(element.style.top) || 0) : NaN);
        if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
        childElements.push({
            type: member.type,
            data,
            startX,
            startY,
            element
        });
    };
    members.forEach(pushMember);
    const hints = group && group.id ? __cardGroupTransientMemberHints.get(group.id) : null;
    if (Array.isArray(hints) && hints.length > 0) {
        const state = (typeof CanvasState !== 'undefined') ? CanvasState : null;
        hints.forEach((hint) => {
            if (!hint || !hint.id || hint.id === group.id) return;
            let data = null;
            if (state && hint.type === 'temp-section') {
                data = (state.tempSections || []).find((s) => s && s.id === hint.id);
            } else if (state && hint.type === 'md-node') {
                data = (state.mdNodes || []).find((n) => n && n.id === hint.id);
            } else if (hint.type === 'permanent-section') {
                const el = (typeof __resolveCanvasNodeElementById === 'function')
                    ? __resolveCanvasNodeElementById(hint.id)
                    : ((typeof document !== 'undefined') ? document.getElementById(hint.id) : null);
                data = __buildPermanentSectionMemberData(el, hint.id);
            }
            if (data) pushMember({ type: hint.type, data });
        });
        __cardGroupTransientMemberHints.delete(group.id);
    }
    childElements.forEach((child) => {
        if (child && child.element) {
            try { child.element.style.transition = 'none'; } catch (_) { }
        }
    });
    return childElements;
}

if (typeof window !== 'undefined') {
    window.__BCSCardGroup = window.__BCSCardGroup || {};
    window.__BCSCardGroup.isCardGroupNode = isCardGroupNode;
    window.__BCSCardGroup.isGroupLikeMdNode = isGroupLikeMdNode;
    window.__BCSCardGroup.containmentMargin = __cardGroupContainmentMargin;
    window.__BCSCardGroup.getDirectGeometricMembers = getDirectGeometricMembers;
    window.__BCSCardGroup.getRecursiveGeometricMembers = getRecursiveGeometricMembers;
    window.__BCSCardGroup.collectCardGroupChildElementsRecursive = collectCardGroupChildElementsRecursive;
    window.__BCSCardGroup.setTransientMemberHint = setCardGroupTransientMemberHint;
}
