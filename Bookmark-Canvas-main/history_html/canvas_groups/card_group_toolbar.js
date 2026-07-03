/*
 * canvas_groups/card_group_toolbar.js
 *
 * 卡片组（card-group）悬浮工具窗：颜色 / 定位 / 置顶 / 删除组框 / 删除组框+成员。
 * 工具窗在 hover 与 selected 时可见，附在卡片组 DOM 元素内（in-element absolute）。
 *
 * 在 card_group_render.js 之后加载（依赖 selectMdNode、locateAndZoomToMdNode、
 * toggleMdNodePin、removeMdNode、saveTempNodes、presetToHex）。
 */

const CARD_GROUP_PRESET_COLORS = [
    { key: 'gray', hex: '#888888', custom: true },
    { key: 'blue', hex: '#66bbff', custom: true },
    { key: '1', hex: '#fb464c' },
    { key: '2', hex: '#e9973f' },
    { key: '3', hex: '#e0de71' },
    { key: '4', hex: '#44cf6e' },
    { key: '5', hex: '#53dfdd' },
    { key: '6', hex: '#a882ff' }
];

function __saveCardGroupToolbarCanvasManifest(options = {}) {
    try {
        if (typeof saveCanvasManifestOnly === 'function') {
            saveCanvasManifestOnly(options);
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

function __cardGroupToolbarBuild(node, opts) {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    const t = {
        rename: isEn ? 'Rename' : '重命名',
        color: isEn ? 'Color' : '颜色',
        search: isEn ? 'Search in current scope' : '当前范围搜索',
        locate: isEn ? 'Locate and zoom' : '定位并放大',
        pin: isEn ? 'Pin' : '置顶',
        unpin: isEn ? 'Unpin' : '取消置顶',
        deleteFrame: isEn ? 'Delete Frame Only' : '仅删除框体',
        deleteAll: isEn ? 'Delete Frame and Members' : '删除框体与成员'
    };

    const toolbar = document.createElement('div');
    toolbar.className = 'md-node-toolbar card-group-toolbar';
    let memberPinState = { allPinned: false };
    try {
        if (typeof getCardGroupMembersPinState === 'function') {
            memberPinState = getCardGroupMembersPinState(node.id) || memberPinState;
        }
    } catch (_) { }
    const pinTitle = memberPinState.allPinned ? t.unpin : t.pin;
    const pinIcon = memberPinState.allPinned
        ? '<i class="fas fa-thumbtack"></i>'
        : '<i class="fas fa-thumbtack" style="opacity: 0.5;"></i>';

    toolbar.innerHTML = `
        <button class="md-node-toolbar-btn card-group-toolbar-btn" data-action="card-group-rename" data-tooltip="${t.rename}"><i class="fas fa-pen"></i></button>
        <button class="md-node-toolbar-btn card-group-toolbar-btn" data-action="card-group-color" data-tooltip="${t.color}"><i class="fas fa-palette"></i></button>
        <button class="md-node-toolbar-btn card-group-toolbar-btn" data-action="card-group-search" data-tooltip="${t.search}"><i class="fas fa-search"></i></button>
        <button class="md-node-toolbar-btn card-group-toolbar-btn" data-action="card-group-locate" data-tooltip="${t.locate}"><i class="fas fa-search-plus"></i></button>
        <button class="md-node-toolbar-btn card-group-toolbar-btn${memberPinState.allPinned ? ' pinned' : ''}" data-action="card-group-pin" data-tooltip="${pinTitle}">${pinIcon}</button>
        <button class="md-node-toolbar-btn card-group-toolbar-btn" data-action="card-group-delete-frame" data-tooltip="${t.deleteFrame}">
            <span class="icon-frame-delete">
                <i class="far fa-square"></i>
                <i class="fas fa-trash-alt"></i>
            </span>
        </button>
        <button class="md-node-toolbar-btn md-delete-danger-btn card-group-toolbar-btn card-group-toolbar-btn-danger" data-action="card-group-delete-all" data-tooltip="${t.deleteAll}"><i class="far fa-trash-alt"></i></button>
    `;

    return { toolbar, labels: t };
}

function __cardGroupBuildColorPopover(node) {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    const rgbPickerTitle = isEn ? 'RGB Color Picker' : 'RGB颜色选择器';
    const customColorTitle = isEn ? 'Select custom color' : '选择自定义颜色';
    const recentTitle = isEn ? 'Previous color' : '上一次颜色';

    const pop = document.createElement('div');
    pop.className = 'md-color-popover card-group-color-popover';
    const chipsHtml = CARD_GROUP_PRESET_COLORS.map((c) => `
        <span class="md-color-chip card-group-color-chip" data-card-group-color-action="${c.custom ? 'custom' : 'preset'}" data-color="${c.key}" data-hex="${c.hex}" style="background:${c.hex}"></span>
    `).join('');
    pop.innerHTML = `
        ${chipsHtml}
        <span class="md-color-divider card-group-color-divider" aria-hidden="true"></span>
        <span class="md-color-chip md-color-recent-chip card-group-color-chip" data-card-group-color-action="recent" title="${recentTitle}"></span>
        <button class="md-color-chip md-color-picker-btn card-group-color-picker-btn" data-card-group-color-action="picker" title="${rgbPickerTitle}">
            <svg viewBox="0 0 24 24" width="14" height="14">
                <circle cx="12" cy="12" r="10" fill="url(#card-group-rainbow-gradient)" />
                <defs>
                    <linearGradient id="card-group-rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
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
    const defaultColor = (typeof getCardGroupDefaultColor === 'function')
        ? getCardGroupDefaultColor()
        : ((window.CanvasModule && typeof window.CanvasModule.getCardGroupDefaultColor === 'function')
            ? window.CanvasModule.getCardGroupDefaultColor()
            : '#66bbff');
    const rgbPicker = document.createElement('div');
    rgbPicker.className = 'md-rgb-picker card-group-rgb-picker';
    rgbPicker.innerHTML = `
        <input class="md-color-input" type="color" value="${node.colorHex || defaultColor}" title="${customColorTitle}" />
    `;
    pop.appendChild(rgbPicker);

    const recentChipEl = pop.querySelector('.md-color-recent-chip');
    const syncRecent = () => {
        if (!recentChipEl) return;
        const safe = (typeof CanvasState !== 'undefined' && CanvasState.cardGroupPrevColor) ? CanvasState.cardGroupPrevColor : defaultColor;
        recentChipEl.dataset.hex = safe;
        recentChipEl.style.backgroundColor = safe;
    };
    syncRecent();

    const pickerBtn = pop.querySelector('.card-group-color-picker-btn');
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
            __cardGroupSetColor(node, null, ev.target.value);
        });
        colorInput.addEventListener('change', (ev) => {
            __cardGroupSetColor(node, null, ev.target.value);
            rgbPicker.classList.remove('open');
            syncRecent();
        });
    }

    if (typeof preventCanvasEventsPropagation === 'function') {
        try { preventCanvasEventsPropagation(pop); } catch (_) { }
    }
    return pop;
}

function __cardGroupSetColor(node, preset, hex) {
    if (!node) return;
    const defaultColor = (typeof getCardGroupDefaultColor === 'function')
        ? getCardGroupDefaultColor()
        : ((window.CanvasModule && typeof window.CanvasModule.getCardGroupDefaultColor === 'function')
            ? window.CanvasModule.getCardGroupDefaultColor()
            : '#66bbff');
    const prev = node.colorHex || (typeof presetToHex === 'function' && node.color ? presetToHex(node.color) : '') || defaultColor;
    if (typeof CanvasState !== 'undefined') CanvasState.cardGroupPrevColor = prev;
    if (preset && /^[1-6]$/.test(String(preset))) {
        node.color = String(preset);
        if (typeof presetToHex === 'function') {
            node.colorHex = presetToHex(node.color);
        }
    } else if (hex && /^#[0-9a-fA-F]{3,8}$/.test(hex)) {
        node.color = null;
        node.colorHex = hex;
    } else {
        node.color = null;
        node.colorHex = null;
    }
    try {
        if (window.__BCSCardGroup && typeof window.__BCSCardGroup.applyCardGroupColor === 'function') {
            window.__BCSCardGroup.applyCardGroupColor(node);
        }
    } catch (_) { }
    __saveCardGroupToolbarCanvasManifest();
}

function __cardGroupBindToolbarActions(element, toolbar, node, labels) {
    let colorPop = null;
    const closeColorPop = () => {
        if (colorPop) {
            colorPop.classList.remove('open');
            if (typeof updateCanvasPopoverState === 'function') {
                try { updateCanvasPopoverState(false); } catch (_) { }
            }
        }
    };

    toolbar.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.card-group-toolbar-btn') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-action');

        if (action === 'card-group-rename') {
            closeColorPop();
            try {
                if (window.__BCSCardGroup && typeof window.__BCSCardGroup.startRename === 'function') {
                    window.__BCSCardGroup.startRename(node.id);
                }
            } catch (_) { }
        } else if (action === 'card-group-color') {
            if (!colorPop) {
                colorPop = __cardGroupBuildColorPopover(node);
                toolbar.appendChild(colorPop);
                colorPop.addEventListener('click', (ev) => {
                    const chip = ev.target && ev.target.closest ? ev.target.closest('[data-card-group-color-action]') : null;
                    if (!chip) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    const kind = chip.getAttribute('data-card-group-color-action');
                    if (kind === 'preset') {
                        __cardGroupSetColor(node, chip.getAttribute('data-color'), null);
                    } else if (kind === 'custom' || kind === 'recent') {
                        __cardGroupSetColor(node, null, chip.getAttribute('data-hex'));
                    }
                });
            }
            const isOpen = colorPop.classList.contains('open');
            if (isOpen) {
                closeColorPop();
            } else {
                colorPop.classList.add('open');
                if (typeof updateCanvasPopoverState === 'function') {
                    try { updateCanvasPopoverState(true); } catch (_) { }
                }
                const onDoc = (ev) => {
                    if (!toolbar.contains(ev.target)) {
                        closeColorPop();
                        document.removeEventListener('mousedown', onDoc, true);
                    }
                };
                document.addEventListener('mousedown', onDoc, true);
            }
        } else if (action === 'card-group-search') {
            closeColorPop();
            try {
                if (window.__BCSCardGroup && typeof window.__BCSCardGroup.collectCardGroupChildElementsRecursive === 'function') {
                    const members = window.__BCSCardGroup.collectCardGroupChildElementsRecursive(node);
                    const memberIds = Array.isArray(members) ? members.map(m => m.data && m.data.id).filter(Boolean) : [];
                    if (!memberIds.includes(node.id)) {
                        memberIds.push(node.id);
                    }
                    if (typeof window.triggerAreaSearch === 'function') {
                        window.triggerAreaSearch({
                            kind: 'group',
                            id: node.id,
                            memberIds: memberIds
                        });
                    }
                }
            } catch (err) {
                console.error('[CardGroup] failed to trigger area search:', err);
            }
        } else if (action === 'card-group-locate') {
            try { if (typeof locateAndZoomToMdNode === 'function') locateAndZoomToMdNode(node.id, 'fit'); } catch (_) { }
        } else if (action === 'card-group-pin') {
            try {
                if (typeof toggleCardGroupMembersPin === 'function') {
                    const pinned = toggleCardGroupMembersPin(node.id);
                    const title = pinned ? labels.unpin : labels.pin;
                    btn.classList.toggle('pinned', !!pinned);
                    btn.setAttribute('data-tooltip', title);
                    btn.title = title;
                    btn.innerHTML = pinned
                        ? '<i class="fas fa-thumbtack"></i>'
                        : '<i class="fas fa-thumbtack" style="opacity: 0.5;"></i>';
                }
            } catch (_) { }
        } else if (action === 'card-group-delete-frame') {
            try {
                if (typeof removeMdNode === 'function') removeMdNode(node.id, false);
                if (typeof clearMdSelection === 'function') clearMdSelection();
            } catch (_) { }
        } else if (action === 'card-group-delete-all') {
            try {
                if (typeof removeMdNode === 'function') removeMdNode(node.id, true);
                if (typeof clearMdSelection === 'function') clearMdSelection();
            } catch (_) { }
        }
    });
}

function __cardGroupContextMenuLabels(node) {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh';
    const isEn = String(lang).toLowerCase().startsWith('en');
    let memberPinState = { allPinned: false };
    try {
        if (node && typeof getCardGroupMembersPinState === 'function') {
            memberPinState = getCardGroupMembersPinState(node.id) || memberPinState;
        }
    } catch (_) { }
    return {
        color: isEn ? 'Color' : '颜色',
        search: isEn ? 'Search in current scope' : '当前范围搜索',
        locate: isEn ? 'Locate' : '定位',
        pin: memberPinState.allPinned ? (isEn ? 'Unpin' : '取消置顶') : (isEn ? 'Pin' : '置顶'),
        deleteFrame: isEn ? 'Delete Frame Only' : '仅删除框体',
        deleteAll: isEn ? 'Delete Frame and Members' : '删除框体与成员',
        export: isEn ? 'Export' : '导出'
    };
}

function __cardGroupPositionContextColorPopover(pop, anchorPoint) {
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

function __cardGroupOpenContextColorPopover(node, anchorPoint) {
    if (!node) return;
    const existing = document.querySelector('.card-group-context-color-popover');
    if (existing) existing.remove();
    const pop = __cardGroupBuildColorPopover(node);
    pop.classList.add('card-group-context-color-popover');
    getOverlayContainer().appendChild(pop);
    pop.addEventListener('click', (ev) => {
        const chip = ev.target && ev.target.closest ? ev.target.closest('[data-card-group-color-action]') : null;
        if (!chip) return;
        ev.preventDefault();
        ev.stopPropagation();
        const kind = chip.getAttribute('data-card-group-color-action');
        if (kind === 'preset') {
            __cardGroupSetColor(node, chip.getAttribute('data-color'), null);
        } else if (kind === 'custom' || kind === 'recent') {
            __cardGroupSetColor(node, null, chip.getAttribute('data-hex'));
        }
    });
    __cardGroupPositionContextColorPopover(pop, anchorPoint);
    if (typeof updateCanvasPopoverState === 'function') {
        try { updateCanvasPopoverState(true); } catch (_) { }
    }
    const close = (ev) => {
        if (pop.contains(ev.target)) return;
        try { pop.remove(); } catch (_) { }
        if (typeof updateCanvasPopoverState === 'function') {
            try { updateCanvasPopoverState(false); } catch (_) { }
        }
        document.removeEventListener('mousedown', close, true);
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
}

function __cardGroupHandleContextMenuAction(action, node, options = {}) {
    if (!node) return;
    if (action === 'card-group-context-color') {
        __cardGroupOpenContextColorPopover(node, options.anchorPoint || null);
    } else if (action === 'card-group-context-search') {
        try {
            if (window.__BCSCardGroup && typeof window.__BCSCardGroup.collectCardGroupChildElementsRecursive === 'function') {
                const members = window.__BCSCardGroup.collectCardGroupChildElementsRecursive(node);
                const memberIds = Array.isArray(members) ? members.map(m => m.data && m.data.id).filter(Boolean) : [];
                if (!memberIds.includes(node.id)) {
                    memberIds.push(node.id);
                }
                if (typeof window.triggerAreaSearch === 'function') {
                    window.triggerAreaSearch({
                        kind: 'group',
                        id: node.id,
                        memberIds: memberIds
                    });
                }
            }
        } catch (err) {
            console.error('[CardGroup] failed to trigger area search from context menu:', err);
        }
    } else if (action === 'card-group-context-locate') {
        try { if (typeof locateAndZoomToMdNode === 'function') locateAndZoomToMdNode(node.id, 'fit'); } catch (_) { }
    } else if (action === 'card-group-context-pin') {
        try { if (typeof toggleCardGroupMembersPin === 'function') toggleCardGroupMembersPin(node.id); } catch (_) { }
    } else if (action === 'card-group-context-delete') {
        try {
            if (typeof removeMdNode === 'function') removeMdNode(node.id, false);
            if (typeof clearMdSelection === 'function') clearMdSelection();
        } catch (_) { }
    } else if (action === 'card-group-context-delete-all') {
        try {
            if (typeof removeMdNode === 'function') removeMdNode(node.id, true);
            if (typeof clearMdSelection === 'function') clearMdSelection();
        } catch (_) { }
    } else if (action === 'card-group-context-export') {
        try {
            if (typeof window !== 'undefined' && typeof window.exportCanvasCardGroupPackage === 'function') {
                window.exportCanvasCardGroupPackage(node).catch((error) => {
                    console.error('[CardGroup] export failed:', error);
                    alert(((typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? '导出失败: ' : 'Export failed: ') + (error && error.message ? error.message : error));
                });
            }
        } catch (error) {
            console.error('[CardGroup] export failed:', error);
        }
    }
}

function showCardGroupContextMenu(event, node) {
    if (!event || !node) return false;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    try { if (typeof selectMdNode === 'function') selectMdNode(node.id); } catch (_) { }
    const menu = document.getElementById('bookmark-context-menu');
    if (!menu) return false;
    const labels = __cardGroupContextMenuLabels(node);
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'zh_CN';
    const items = [
        { action: 'card-group-context-color', label: labels.color, icon: 'palette' },
        { action: 'card-group-context-search', label: labels.search, icon: 'search' },
        { action: 'card-group-context-locate', label: labels.locate, icon: 'crosshairs' },
        { action: 'card-group-context-pin', label: labels.pin, icon: 'thumbtack' },
        { action: 'card-group-context-delete', label: labels.deleteFrame, icon: 'trash-alt', group: 'delete' },
        { action: 'card-group-context-delete-all', label: labels.deleteAll, icon: 'trash-alt', group: 'delete' },
        { action: 'card-group-context-export', label: labels.export, icon: 'file-export', group: 'export' }
    ];
    menu.classList.remove('horizontal-layout', 'density-xs', 'density-md', 'density-lg', 'lang-zh', 'lang-en');
    menu.classList.add('density-sm');
    menu.classList.add(String(lang).toLowerCase().startsWith('en') ? 'lang-en' : 'lang-zh');
    menu.dataset.menuScope = 'card-group-object';
    const normalItems = items.filter(item => item.group !== 'delete' && item.group !== 'export');
    const deleteItems = items.filter(item => item.group === 'delete');
    const exportItems = items.filter(item => item.group === 'export');
    menu.innerHTML = [
        normalItems.map(item => `
            <div class="context-menu-item ${item.className || ''}" data-action="${item.action}">
                <i class="fas fa-${item.icon}"></i>
                <span class="context-menu-item-label"><span>${item.label}</span></span>
            </div>
        `).join(''),
        `<div class="card-group-context-delete-box">
            ${deleteItems.map(item => `
                <div class="context-menu-item card-group-context-delete-item" data-action="${item.action}">
                    <i class="fas fa-${item.icon}"></i>
                    <span class="context-menu-item-label"><span>${item.label}</span></span>
                </div>
            `).join('')}
        </div>`,
        exportItems.map(item => `
            <div class="context-menu-item ${item.className || ''}" data-action="${item.action}">
                <i class="fas fa-${item.icon}"></i>
                <span class="context-menu-item-label"><span>${item.label}</span></span>
            </div>
        `).join('')
    ].join('');
    const point = { x: event.clientX, y: event.clientY };
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const action = item.dataset.action;
            const anchorPoint = action === 'card-group-context-color'
                ? { x: point.x, y: point.y + (item.offsetTop || 0) }
                : point;
            if (typeof hideContextMenu === 'function') {
                try { hideContextMenu(); } catch (_) { }
            } else {
                menu.style.display = 'none';
            }
            __cardGroupHandleContextMenuAction(action, node, { anchorPoint });
        });
    });
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.transformOrigin = '';
    menu.style.transform = '';
    menu.style.display = 'block';
    const targetParent = getOverlayContainer();
    if (menu.parentElement && menu.parentElement !== targetParent) targetParent.appendChild(menu);
    return true;
}

function attachCardGroupToolbar(element, node) {
    if (!element || !node) return null;
    const existing = element.querySelector(':scope > .card-group-toolbar');
    if (existing) existing.remove();
    const { toolbar, labels } = __cardGroupToolbarBuild(node, {});
    element.appendChild(toolbar);
    __cardGroupBindToolbarActions(element, toolbar, node, labels);
    return toolbar;
}

if (typeof window !== 'undefined') {
    window.__BCSCardGroupToolbar = window.__BCSCardGroupToolbar || {};
    window.__BCSCardGroupToolbar.attachToolbar = attachCardGroupToolbar;
    window.__BCSCardGroupToolbar.showContextMenu = showCardGroupContextMenu;
}
