// =============================================================================
// Tag system runtime (doc §3):
//   - Tip-icon click delegate (Phase B) → opens tag popover.
//   - Target resolution for permanent / temporary tree items.
//   - Tag popover UI (Phase D): palette + search input + tag list.
//   - Public entrypoints: window.openTagPopover, window.openBatchTagPopover.
//
// Storage CRUD lives in storageBCS_core (permanent) and bookmark_canvas_module
// (temporary). This file ONLY orchestrates UI + invokes those helpers.
// =============================================================================

(function tagSystemModule() {
    const TAG_PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

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

    const TAG_COLOR_NAMES = {
        red:    { 'zh_CN': '红色',  'en': 'Red' },
        orange: { 'zh_CN': '橙色',  'en': 'Orange' },
        yellow: { 'zh_CN': '黄色',  'en': 'Yellow' },
        green:  { 'zh_CN': '绿色',  'en': 'Green' },
        blue:   { 'zh_CN': '蓝色',  'en': 'Blue' },
        purple: { 'zh_CN': '紫色',  'en': 'Purple' },
        gray:   { 'zh_CN': '灰色',  'en': 'Gray' }
    };

    const TAG_PANEL_I18N = {
        inputPlaceholder: { 'zh_CN': '可选：自定义文字（默认= 颜色名）', 'en': 'Optional: custom text (default = color name)' },
        confirmAriaLabel: { 'zh_CN': '确认添加', 'en': 'Confirm add' },
        removeAriaLabel:  { 'zh_CN': '移除', 'en': 'Remove' },
        previewEmpty:     { 'zh_CN': '选一个颜色…', 'en': 'Pick a color…' },
        appliedHeader:    { 'zh_CN': '当前标签', 'en': 'Current tags' },
        globalHeader:     { 'zh_CN': '全局使用标签', 'en': 'Global tags' },
        clearAllTags:     { 'zh_CN': '清除全部', 'en': 'Clear all' },
        noAppliedTags:    { 'zh_CN': '暂无应用 tag', 'en': 'No applied tags' },
        noTagsYet:        { 'zh_CN': '暂无已用 tag', 'en': 'No tags yet' },
        moreEllipsis:     { 'zh_CN': '…还有 {n} 个', 'en': '…{n} more' },
        tagAriaLabel:     { 'zh_CN': '标签', 'en': 'Tags' },
        collapseTags:     { 'zh_CN': '收起已加载', 'en': 'Collapse' }
    };

    function __lang() {
        if (typeof window !== 'undefined' && typeof window.currentLang === 'string') {
            return window.currentLang === 'en' ? 'en' : 'zh_CN';
        }
        return 'zh_CN';
    }

    function __t(map, vars) {
        const lang = __lang();
        let s = map[lang] || map.zh_CN || '';
        if (vars) {
            Object.keys(vars).forEach((k) => {
                s = s.replace(new RegExp(`{${k}}`, 'g'), String(vars[k]));
            });
        }
        return s;
    }

    function __colorName(color) {
        const map = TAG_COLOR_NAMES[color];
        return map ? __t(map) : (color || '');
    }

    function __getBucketKey(text) {
        if (typeof getTagBrowseBucketKey === 'function') {
            try {
                return getTagBrowseBucketKey(text);
            } catch (_) {}
        }
        const safeText = String(text || '').trim();
        if (!safeText) return '#';
        const first = safeText.charAt(0).toUpperCase();
        if (/^[0-9]$/.test(first)) return '0-9';
        if (/^[A-Z]$/.test(first)) return first;
        return '#';
    }

    function __normalizeColor(color) {
        if (typeof normalizeTagBrowseColor === 'function') {
            try {
                return normalizeTagBrowseColor(color);
            } catch (_) {}
        }
        const raw = String(color || '').trim().toLowerCase();
        const colorOrder = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
        if (colorOrder.includes(raw)) return raw;
        return '';
    }

    function __bridge() {
        return (typeof window !== 'undefined') ? window.CanvasProtocolBridge : null;
    }

    // -------------------------------------------------------------------------
    // Target resolution: figure out what bookmark/folder/section the click is on.
    // -------------------------------------------------------------------------

    function __resolveTargetFromTreeItem(treeItem) {
        if (!treeItem) return null;
        const nodeId = treeItem.dataset.nodeId || treeItem.getAttribute('data-node-id');
        if (!nodeId) return null;
        const title = treeItem.dataset.nodeTitle || treeItem.getAttribute('data-node-title') || '';
        const type = treeItem.dataset.nodeType || treeItem.getAttribute('data-node-type') || 'bookmark';
        const url = treeItem.dataset.nodeUrl || treeItem.getAttribute('data-node-url') || '';
        const treeType = treeItem.dataset.treeType || treeItem.getAttribute('data-tree-type') || '';

        if (treeType === 'temporary') {
            const sectionId = treeItem.dataset.sectionId || treeItem.getAttribute('data-section-id');
            return {
                kind: 'temporary',
                sectionId,
                itemId: nodeId,
                nodeType: type,
                title,
                url
            };
        }
        return {
            kind: 'permanent',
            chromeId: nodeId,
            nodeType: type,
            title,
            url
        };
    }

    function __getTagsForTarget(target) {
        if (!target) return Promise.resolve([]);
        const bridge = __bridge();
        if (target.kind === 'permanent') {
            if (!bridge || !bridge.readPermanentNodeTags) return Promise.resolve([]);
            return Promise.resolve(bridge.readPermanentNodeTags(target.chromeId)).catch(() => []);
        }
        if (target.kind === 'temporary') {
            try {
                return Promise.resolve(
                    (typeof getTempItemTags === 'function')
                        ? getTempItemTags(target.sectionId, target.itemId)
                        : []
                );
            } catch (_) { return Promise.resolve([]); }
        }
        return Promise.resolve([]);
    }

    async function __toggleTagOnTarget(target, tagInput) {
        if (!target || !tagInput) return null;
        const bridge = __bridge();
        if (target.kind === 'permanent') {
            if (!bridge || !bridge.togglePermanentNodeTag) return null;
            return await bridge.togglePermanentNodeTag(target.chromeId, tagInput);
        }
        if (target.kind === 'temporary') {
            try {
                return (typeof toggleTempItemTag === 'function')
                    ? toggleTempItemTag(target.sectionId, target.itemId, tagInput)
                    : null;
            } catch (_) { return null; }
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Popover state + DOM (Phase D)
    //
    // Flow: select a color in palette (transient) → optionally type custom text in
    // the input → click ✓ confirm to commit a single { color, text } tag.
    // The applied-tags list below the preview shows tags already on the target(s),
    // each with a remove button.
    // -------------------------------------------------------------------------

    let __popoverEl = null;
    let __popoverSubEl = null;
    let __popoverCtx = null;
    // __popoverCtx shape: { targets, anchor, selectedColor }
    let __outsideClickHandler = null;
    let __escKeyHandler = null;
    
    const APPLIED_INITIAL_VISIBLE = 5;
    const APPLIED_LOAD_STEP = 5;

    function __positionSubPanel() {
        if (!__popoverEl || !__popoverSubEl || !__popoverCtx) return;
        if (__popoverCtx.globalCollapsed) {
            __popoverSubEl.hidden = true;
            return;
        }
        
        const pop = __popoverEl;
        const sub = __popoverSubEl;
        const isAlreadyVisible = !sub.hidden && sub.style.visibility !== 'hidden';
        if (!isAlreadyVisible) {
            sub.style.visibility = 'hidden';
        }
        sub.hidden = false;
        
        const scale = __getCurrentPopoverScale();
        sub.style.transform = `scale(${scale})`;
        sub.style.transformOrigin = 'top left';
        
        const popRect = pop.getBoundingClientRect();
        const subRect = sub.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // Check spaces in different directions
        const spaceRight = vw - popRect.right - 8;
        const spaceLeft = popRect.left - 8;
        const spaceBottom = vh - popRect.bottom - 8;
        const spaceTop = popRect.top - 8;

        let left = 0;
        let top = 0;

        // Determine layout mode: horizontal (left/right) or vertical (above/below)
        if (spaceRight >= subRect.width) {
            // Put on the right
            left = popRect.right + 6;
            top = popRect.top;
            if (top + subRect.height > vh - 8) {
                top = Math.max(8, vh - subRect.height - 8);
            }
        } else if (spaceLeft >= subRect.width) {
            // Put on the left
            left = popRect.left - subRect.width - 6;
            top = popRect.top;
            if (top + subRect.height > vh - 8) {
                top = Math.max(8, vh - subRect.height - 8);
            }
        } else {
            // Vertical fallback: place below or above the main popover
            // Align horizontally and constrain within viewport bounds
            left = Math.max(8, Math.min(popRect.left, vw - subRect.width - 8));
            
            // Prefer placing below by default
            if (spaceBottom >= subRect.height) {
                top = popRect.bottom + 6;
            } else if (spaceTop >= subRect.height) {
                top = popRect.top - subRect.height - 6;
            } else {
                // If neither fits vertically, place where there is more vertical space
                if (spaceBottom >= spaceTop) {
                    top = popRect.bottom + 6;
                } else {
                    top = popRect.top - subRect.height - 6;
                }
            }
        }
        
        // Constrain final coordinates to be within viewport bounds (just in case)
        left = Math.max(8, Math.min(left, vw - subRect.width - 8));
        top = Math.max(8, Math.min(top, vh - subRect.height - 8));

        const parentRect = sub.parentElement.getBoundingClientRect();
        sub.style.left = `${Math.round(left - parentRect.left)}px`;
        sub.style.top = `${Math.round(top - parentRect.top)}px`;
        if (!isAlreadyVisible) {
            sub.style.visibility = '';
        }
    }

    function __onPopoverSubClick(ev) {
        const target = ev.target;
        
        const backBtn = target.closest('.canvas-tag-browse-back-btn');
        if (backBtn) {
            __popoverCtx.selectedColor = null;
            __popoverCtx.dontFilterSubPanel = false;
            __updatePreview();
            if (__popoverEl) {
                __popoverEl.querySelectorAll('.tag-palette-btn').forEach((b) => {
                    b.classList.remove('is-selected');
                });
            }
            __renderPopover();
            ev.stopPropagation();
            return;
        }

        const subColorCard = target.closest('[data-action="filter-sub-color"]');
        if (subColorCard) {
            const color = subColorCard.dataset.color;
            __popoverCtx.selectedColor = (__popoverCtx.selectedColor === color) ? null : color;
            __popoverCtx.dontFilterSubPanel = false;
            __updatePreview();
            if (__popoverEl) {
                __popoverEl.querySelectorAll('.tag-palette-btn').forEach((b) => {
                    b.classList.toggle('is-selected', b.dataset.color === __popoverCtx.selectedColor);
                });
            }
            __renderPopover();
            ev.stopPropagation();
            return;
        }

        const closeBtn = target.closest('[data-action="close-sub-panel"]');
        if (closeBtn) {
            __popoverCtx.globalCollapsed = true;
            __renderPopover();
            ev.stopPropagation();
            return;
        }


        const bucketLoadMore = target.closest('[data-action="load-more-bucket"]');
        if (bucketLoadMore) {
            const bucketKey = bucketLoadMore.dataset.bucket;
            if (bucketKey && __popoverCtx) {
                __popoverCtx.bucketLimits = __popoverCtx.bucketLimits || {};
                const prev = __popoverCtx.bucketLimits[bucketKey] || 5;
                __popoverCtx.bucketLimits[bucketKey] = prev + 5;
                __renderPopover();
            }
            ev.stopPropagation();
            return;
        }

        const bucketCollapse = target.closest('[data-action="collapse-bucket"]');
        if (bucketCollapse) {
            const bucketKey = bucketCollapse.dataset.bucket;
            if (bucketKey && __popoverCtx) {
                __popoverCtx.bucketLimits = __popoverCtx.bucketLimits || {};
                __popoverCtx.bucketLimits[bucketKey] = 5;
                __renderPopover();
            }
            ev.stopPropagation();
            return;
        }
        
        const recentRow = target.closest('.tag-applied-row');
        if (recentRow) {
            const tag = { color: recentRow.dataset.color, text: recentRow.dataset.text };
            if (recentRow.classList.contains('is-active') || recentRow.classList.contains('is-mixed')) {
                __toggleTagOnAllTargets(tag, { mode: 'remove' });
            } else {
                __toggleTagOnAllTargets(tag);
            }
            ev.stopPropagation();
            return;
        }
    }

    function __ensurePopoverDom() {
        if (__popoverEl) return __popoverEl;
        const el = document.createElement('div');
        el.className = 'tag-popover';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', __t(TAG_PANEL_I18N.tagAriaLabel));
        el.hidden = true;

        el.innerHTML = `
            <div class="tag-popover-top">
                <input type="text" class="tag-popover-input" data-role="input" />
                <button class="tag-popover-confirm" data-role="confirm" type="button" aria-label="${__t(TAG_PANEL_I18N.confirmAriaLabel)}">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.2 11.4 2.6 7.8l1.4-1.4 2.2 2.2 5.8-5.8 1.4 1.4z"/></svg>
                </button>
                <button class="tag-popover-close" data-role="close-popover" type="button" aria-label="${currentLang === 'en' ? 'Close' : '关闭'}">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>
                </button>
            </div>
            <div class="tag-popover-palette" data-role="palette">
                <div class="tag-popover-palette-colors" data-role="palette-colors">
                    ${TAG_PALETTE.map((c) =>
                        `<button class="tag-palette-btn" data-color="${c}" type="button" aria-label="${c}"><span class="tag-dot tag-dot-${c}"></span></button>`
                    ).join('')}
                </div>
            </div>
            <div class="tag-popover-divider"></div>
            <div class="tag-popover-preview" data-role="preview">
                <span class="tag-preview-placeholder" data-role="preview-placeholder"></span>
                <span class="tag-preview-card" data-role="preview-card" hidden>
                    <span class="tag-dot" data-role="preview-dot"></span>
                    <span class="tag-preview-text" data-role="preview-text"></span>
                </span>
            </div>
            <div class="tag-popover-applied-section">
                <div class="tag-popover-section-header">
                    <div class="tag-popover-applied-header" data-role="applied-header"></div>
                </div>
                <div class="tag-popover-applied" data-role="applied-list"></div>
                <div class="tag-popover-more-container" data-role="applied-actions" style="display: flex; gap: 4px; align-items: center; justify-content: center; margin-top: 4px;">
                    <button class="tag-popover-more" data-role="applied-more" type="button" style="margin: 0; flex: 1;" hidden></button>
                    <button class="tag-popover-more" data-role="applied-collapse" type="button" style="margin: 0; flex: 1;" hidden></button>
                </div>

                <div class="tag-popover-applied-divider"></div>

                <div class="tag-popover-section-header collapsible" data-action="toggle-global-collapse">
                    <div class="tag-popover-applied-header" data-role="global-header"></div>
                    <svg class="tag-collapse-chevron" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>
                </div>
            </div>
        `;

        const subEl = document.createElement('div');
        subEl.className = 'tag-popover-sub-panel';
        subEl.setAttribute('role', 'dialog');
        subEl.hidden = true;
        subEl.innerHTML = `
            <div class="tag-popover-sub-header">
                <span class="tag-popover-sub-title" data-role="sub-title"></span>
                <button class="tag-popover-sub-close" data-action="close-sub-panel" type="button" aria-label="${currentLang === 'en' ? 'Close' : '关闭'}">
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>
                </button>
            </div>
            <div class="tag-popover-sub-content">
                <div class="tag-popover-sub-colors" data-role="sub-colors"></div>
                <div class="tag-popover-applied-divider"></div>
                <div class="tag-popover-section-header" data-role="sub-global-header"></div>
                <div class="tag-popover-applied" data-role="sub-global-list"></div>
            </div>
        `;

        getOverlayContainer().appendChild(el);
        getOverlayContainer().appendChild(subEl);
        __popoverEl = el;
        __popoverSubEl = subEl;

        el.addEventListener('click', __onPopoverClick);
        subEl.addEventListener('click', __onPopoverSubClick);

        const input = el.querySelector('[data-role="input"]');
        input.addEventListener('input', __onPopoverInput);
        input.addEventListener('keydown', __onPopoverInputKeydown);
        
        const appliedList = el.querySelector('[data-role="applied-list"]');
        appliedList.addEventListener('scroll', __onAppliedListScroll);
        return el;
    }

    function __onAppliedListScroll(ev) {
        const el = ev.currentTarget;
        if (!el || !__popoverCtx) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) {
            __loadMoreAppliedTags();
        }
    }



    function __loadMoreAppliedTags() {
        if (!__popoverCtx) return;
        const prev = Number(__popoverCtx.appliedLimit) || APPLIED_INITIAL_VISIBLE;
        __popoverCtx.appliedLimit = prev + APPLIED_LOAD_STEP;
        __renderPopover();
    }

    function __collapseAppliedTags() {
        if (!__popoverCtx) return;
        __popoverCtx.appliedLimit = APPLIED_INITIAL_VISIBLE;
        __renderPopover();
    }



    function __closePopover() {
        if (__popoverEl) {
            __popoverEl.hidden = true;
            __popoverEl.style.removeProperty('transform');
            __popoverEl.style.removeProperty('transform-origin');
        }
        if (__popoverSubEl) {
            __popoverSubEl.hidden = true;
            __popoverSubEl.style.removeProperty('transform');
            __popoverSubEl.style.removeProperty('transform-origin');
        }
        __popoverCtx = null;
        if (__outsideClickHandler) {
            document.removeEventListener('mousedown', __outsideClickHandler, true);
            __outsideClickHandler = null;
        }
        if (__escKeyHandler) {
            document.removeEventListener('keydown', __escKeyHandler, true);
            __escKeyHandler = null;
        }
    }

    function __getCurrentPopoverScale() {
        // Default smaller than 1; if anchor is inside the canvas-content (i.e. zoomed
        // canvas / fullscreen view), multiply by the canvas zoom so the popover stays
        // visually consistent with the surrounding UI.
        const BASE = 0.9;
        try {
            const anchor = __popoverCtx && __popoverCtx.anchor;
            const inCanvas = anchor && anchor.closest && anchor.closest('.canvas-content, .canvas-workspace');
            if (inCanvas && typeof CanvasState !== 'undefined') {
                const z = Number(CanvasState.zoom);
                const b = Number(CanvasState.baseZoom) || 1;
                if (Number.isFinite(z) && z > 0) {
                    // CanvasState.zoom / baseZoom = displayed zoom (e.g. 1.0 when shown at 100%).
                    return BASE * (z / (b || 1));
                }
            }
        } catch (_) {}
        return BASE;
    }

    function __isAnchorInFullscreenContext(anchor) {
        if (!anchor || !anchor.closest) return false;
        return !!anchor.closest(
            '.canvas-fullscreen-active, .canvas-fullscreen-node, .canvas-content, .canvas-workspace, .search-results-panel'
        );
    }

    function __getAnchorRect(anchor) {
        if (!anchor) return null;
        if (anchor.__tagPopoverAnchorRect) return anchor.__tagPopoverAnchorRect;
        if (anchor.getBoundingClientRect) {
            const rect = anchor.getBoundingClientRect();
            const usable = (rect.width || rect.height) && (rect.left || rect.top || rect.right || rect.bottom);
            if (usable) return rect;
        }
        const fallback = anchor.closest && anchor.closest('.tree-item');
        return fallback ? fallback.getBoundingClientRect() : null;
    }

    function __positionPopover(anchor) {
        if (!__popoverEl || !anchor) return;
        const anchorRect = __getAnchorRect(anchor);
        if (!anchorRect) return;
        const pop = __popoverEl;
        const isAlreadyVisible = !pop.hidden && pop.style.visibility !== 'hidden';
        if (!isAlreadyVisible) {
            pop.style.visibility = 'hidden';
        }
        pop.hidden = false;
        const scale = __getCurrentPopoverScale();
        pop.style.transform = `scale(${scale})`;
        pop.style.transformOrigin = 'top left';
        const popRect = pop.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Default: open to the RIGHT of anchor.
        // Open to the LEFT when (a) anchor is in fullscreen/canvas context, or
        // (b) there is no room on the right (existing fallback).
        const preferLeft = __isAnchorInFullscreenContext(anchor);
        let left;
        if (preferLeft) {
            left = anchorRect.left - popRect.width - 6;
            if (left < 8) {
                // Fall back to right if not enough room on the left either.
                left = anchorRect.right + 6;
                if (left + popRect.width > vw - 8) left = Math.max(8, vw - popRect.width - 8);
            }
        } else {
            left = anchorRect.right + 6;
            if (left + popRect.width > vw - 8) {
                left = anchorRect.left - popRect.width - 6;
                if (left < 8) left = Math.max(8, vw - popRect.width - 8);
            }
        }

        let top = anchorRect.top;
        if (top + popRect.height > vh - 8) {
            top = Math.max(8, vh - popRect.height - 8);
        }
        const parentRect = pop.parentElement.getBoundingClientRect();
        pop.style.left = `${Math.round(left - parentRect.left)}px`;
        pop.style.top = `${Math.round(top - parentRect.top)}px`;
        if (!isAlreadyVisible) {
            pop.style.visibility = '';
        }

        if (!__popoverCtx.globalCollapsed) {
            __positionSubPanel();
        }
    }

    function __updatePreview() {
        if (!__popoverEl || !__popoverCtx) return;
        const placeholder = __popoverEl.querySelector('[data-role="preview-placeholder"]');
        const card = __popoverEl.querySelector('[data-role="preview-card"]');
        const dot = __popoverEl.querySelector('[data-role="preview-dot"]');
        const txt = __popoverEl.querySelector('[data-role="preview-text"]');
        const input = __popoverEl.querySelector('[data-role="input"]');
        const confirmBtn = __popoverEl.querySelector('[data-role="confirm"]');
        const color = __popoverCtx.selectedColor;
        if (!color) {
            card.hidden = true;
            placeholder.hidden = false;
            placeholder.textContent = __t(TAG_PANEL_I18N.previewEmpty);
            confirmBtn.disabled = true;
            confirmBtn.classList.remove('is-ready');
            confirmBtn.style.removeProperty('color');
            return;
        }
        placeholder.hidden = true;
        card.hidden = false;
        dot.className = `tag-dot tag-dot-${color}`;
        dot.dataset.color = color;
        const typed = (input && input.value || '').trim();
        const text = typed || __colorName(color);
        txt.textContent = text;
        confirmBtn.disabled = false;
        confirmBtn.classList.add('is-ready');
        confirmBtn.style.color = `var(--tag-${color})`;
    }

    async function __renderPopover() {
        const el = __ensurePopoverDom();
        if (!__popoverCtx) return;
        const { targets } = __popoverCtx;

        // Currently-applied tags per target → for palette ✓/– indicator + per-row state.
        const perTargetTags = await Promise.all(targets.map((t) => __getTagsForTarget(t)));
        const bridge = __bridge();
        const keyOf = (color, text) => (bridge && bridge.makeTagKey) ? bridge.makeTagKey(color, text) : `${color}::${text}`;

        const aggregate = new Map();  // key → { tag, present }
        perTargetTags.forEach((list) => {
            const seen = new Set();
            (list || []).forEach((t) => {
                const k = keyOf(t.color, t.text);
                if (seen.has(k)) return;
                seen.add(k);
                const prev = aggregate.get(k);
                if (prev) prev.present += 1;
                else aggregate.set(k, { tag: { color: t.color, text: t.text }, present: 1 });
            });
        });

        // Palette: highlight selected + ✓/– for any color the targets already have applied.
        const allByColor = new Map();
        aggregate.forEach((entry) => {
            const c = entry.tag.color;
            const prev = allByColor.get(c) || 0;
            if (entry.present > prev) allByColor.set(c, entry.present);
        });
        el.querySelectorAll('.tag-palette-btn').forEach((btn) => {
            const color = btn.dataset.color;
            btn.classList.toggle('is-selected', color === __popoverCtx.selectedColor);
            const presentCount = allByColor.get(color) || 0;
            btn.classList.toggle('is-applied', presentCount === targets.length && targets.length > 0);
            btn.classList.toggle('is-mixed', presentCount > 0 && presentCount < targets.length);
        });

        // 1. Applied tags list
        const appliedTags = Array.from(aggregate.values()).map(e => e.tag);
        appliedTags.sort((a, b) => {
            const entryA = aggregate.get(keyOf(a.color, a.text));
            const entryB = aggregate.get(keyOf(b.color, b.text));
            if (entryB.present !== entryA.present) {
                return entryB.present - entryA.present;
            }
            const textA = a.text || '';
            const textB = b.text || '';
            return textA.localeCompare(textB, undefined, { numeric: true, sensitivity: 'base' });
        });

        const appliedListEl = el.querySelector('[data-role="applied-list"]');
        const appliedHeaderEl = el.querySelector('[data-role="applied-header"]');
        const appliedMoreEl = el.querySelector('[data-role="applied-more"]');
        const appliedCollapseEl = el.querySelector('[data-role="applied-collapse"]');

        appliedHeaderEl.textContent = __t(TAG_PANEL_I18N.appliedHeader);
        appliedListEl.innerHTML = '';
        appliedListEl.classList.remove('is-scrollable');

        if (!appliedTags.length) {
            const empty = document.createElement('div');
            empty.className = 'tag-recent-empty';
            empty.textContent = __t(TAG_PANEL_I18N.noAppliedTags);
            appliedListEl.appendChild(empty);
            appliedMoreEl.hidden = true;
            if (appliedCollapseEl) appliedCollapseEl.hidden = true;
        } else {
            const appliedLimit = Math.max(APPLIED_INITIAL_VISIBLE, Number(__popoverCtx.appliedLimit) || APPLIED_INITIAL_VISIBLE);
            __popoverCtx.appliedLimit = appliedLimit;
            const visibleApplied = appliedTags.slice(0, appliedLimit);
            appliedListEl.classList.toggle('is-scrollable', visibleApplied.length > APPLIED_INITIAL_VISIBLE);
            
            visibleApplied.forEach((t) => {
                const k = keyOf(t.color, t.text);
                const entry = aggregate.get(k);
                const row = document.createElement('div');
                row.className = 'tag-applied-row';
                row.dataset.color = t.color;
                row.dataset.text = t.text;
                if (entry) {
                    if (entry.present === targets.length) {
                        row.classList.add('is-active');
                    } else {
                        row.classList.add('is-mixed');
                    }
                }
                row.innerHTML = `
                    <span class="tag-dot tag-dot-${t.color}"></span>
                    <span class="tag-applied-text"></span>
                    <button class="tag-row-delete-btn" type="button" aria-label="${__t(TAG_PANEL_I18N.removeAriaLabel)}">
                        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>
                    </button>
                `;
                row.querySelector('.tag-applied-text').textContent = t.text || __colorName(t.color);
                appliedListEl.appendChild(row);
            });

            const hiddenCount = Math.max(0, appliedTags.length - visibleApplied.length);
            if (hiddenCount > 0) {
                appliedMoreEl.hidden = false;
                appliedMoreEl.dataset.action = 'load-more-applied';
                appliedMoreEl.textContent = __t(TAG_PANEL_I18N.moreEllipsis, { n: hiddenCount });
            } else {
                appliedMoreEl.hidden = true;
                delete appliedMoreEl.dataset.action;
            }

            const canCollapse = appliedLimit > APPLIED_INITIAL_VISIBLE;
            if (appliedCollapseEl) {
                if (canCollapse) {
                    appliedCollapseEl.hidden = false;
                    appliedCollapseEl.dataset.action = 'collapse-applied';
                    appliedCollapseEl.textContent = __t(TAG_PANEL_I18N.collapseTags);
                } else {
                    appliedCollapseEl.hidden = true;
                    delete appliedCollapseEl.dataset.action;
                }
            }
        }

        // 2. Global tags list
        const globalHeaderWrapper = el.querySelector('[data-action="toggle-global-collapse"]');
        const globalHeaderEl = el.querySelector('[data-role="global-header"]');

        globalHeaderEl.textContent = __t(TAG_PANEL_I18N.globalHeader);

        const collapsed = !!__popoverCtx.globalCollapsed;
        globalHeaderWrapper.classList.toggle('is-expanded', !collapsed);

        if (collapsed) {
            if (__popoverSubEl) __popoverSubEl.hidden = true;
        } else {
            if (__popoverSubEl) {
                if (__popoverSubEl.hidden) {
                    __popoverSubEl.style.visibility = 'hidden';
                }
                __popoverSubEl.hidden = false;
                
                const subTitleEl = __popoverSubEl.querySelector('[data-role="sub-title"]');
                const isZh = __lang() === 'zh_CN';
                subTitleEl.textContent = __t(TAG_PANEL_I18N.globalHeader);
                
                let globalTags = [];
                try {
                    if (bridge && bridge.collectAllUsedTags) globalTags = await bridge.collectAllUsedTags();
                } catch (_) {}

                // Render sub-panel colors grid
                const subColorsEl = __popoverSubEl.querySelector('[data-role="sub-colors"]');
                if (subColorsEl) {
                    const colorCounts = new Map();
                    globalTags.forEach(t => {
                        const c = __normalizeColor(t.color) || 'gray';
                        colorCounts.set(c, (colorCounts.get(c) || 0) + (t.count || 0));
                    });
                    
                    const subColorEntries = TAG_PALETTE.map((color) => {
                        const label = TAG_COLOR_NAMES[color] ? (isZh ? TAG_COLOR_NAMES[color].zh_CN : TAG_COLOR_NAMES[color].en) : color;
                        return {
                            color,
                            label,
                            count: colorCounts.get(color) || 0
                        };
                    });
                    
                    const colorHtml = subColorEntries
                        .filter((entry) => entry.count > 0)
                        .map((entry) => {
                             const isSelected = !__popoverCtx.dontFilterSubPanel && (__normalizeColor(entry.color) === __normalizeColor(__popoverCtx.selectedColor));
                             const isSelectedClass = isSelected ? ' is-selected' : '';
                            return `
                                <button class="tag-palette-btn${isSelectedClass}" data-color="${escapeHtml(entry.color)}" data-action="filter-sub-color" type="button" aria-label="${escapeHtml(entry.label)}" style="position: relative;">
                                    <span class="tag-dot tag-dot-${escapeHtml(entry.color)}" style="width: 20px; height: 20px; border: 1px solid rgba(0, 0, 0, 0.15); display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: bold; text-shadow: 0 0 2px rgba(0,0,0,0.65);">${escapeHtml(String(entry.count))}</span>
                                </button>
                            `;
                        }).join('');
                    subColorsEl.innerHTML = `<div class="tag-popover-palette-colors" style="display: flex; justify-content: center; align-items: center; gap: 6px; padding: 0 2px 2px;">${colorHtml}</div>`;
                }

                // Render sub-panel global section header
                const subGlobalHeaderEl = __popoverSubEl.querySelector('[data-role="sub-global-header"]');
                if (subGlobalHeaderEl) {
                    if (__popoverCtx.selectedColor && !__popoverCtx.dontFilterSubPanel) {
                        const colorLabel = TAG_COLOR_NAMES[__popoverCtx.selectedColor] ? (isZh ? TAG_COLOR_NAMES[__popoverCtx.selectedColor].zh_CN : TAG_COLOR_NAMES[__popoverCtx.selectedColor].en) : __popoverCtx.selectedColor;
                        const displayTagTitle = isZh ? `${colorLabel}标签` : `${colorLabel} Tags`;
                        const backLabel = isZh ? '返回' : 'Back';
                        subGlobalHeaderEl.innerHTML = `
                            <div class="canvas-tag-browse-section-header" style="padding: 2px 0 5px; width: 100%;">
                                <div class="canvas-tag-browse-section-title" style="padding: 0; font-size: 11px;">${escapeHtml(displayTagTitle)}</div>
                                <div class="canvas-tag-browse-section-header-right">
                                    <button type="button" class="canvas-tag-browse-back-btn">${escapeHtml(backLabel)}</button>
                                </div>
                            </div>
                        `;
                    } else {
                        const displayTagTitle = isZh ? '全部标签' : 'All Tags';
                        subGlobalHeaderEl.innerHTML = `
                            <div class="canvas-tag-browse-section-header" style="padding: 2px 0 5px; width: 100%;">
                                <div class="canvas-tag-browse-section-title" style="padding: 0; font-size: 11px;">${escapeHtml(displayTagTitle)}</div>
                            </div>
                        `;
                    }
                }

                const subGlobalListEl = __popoverSubEl.querySelector('[data-role="sub-global-list"]');
                subGlobalListEl.innerHTML = '';
                subGlobalListEl.classList.remove('is-scrollable');

                // Filter by color
                let filteredGlobalTags = globalTags;
                if (__popoverCtx.selectedColor && !__popoverCtx.dontFilterSubPanel) {
                    filteredGlobalTags = globalTags.filter(t => __normalizeColor(t.color) === __normalizeColor(__popoverCtx.selectedColor));
                }

                if (!filteredGlobalTags.length) {
                    const empty = document.createElement('div');
                    empty.className = 'tag-recent-empty';
                    empty.textContent = __t(TAG_PANEL_I18N.noTagsYet);
                    subGlobalListEl.appendChild(empty);
                } else {
                    // Group global tags by bucket
                    const bucketsMap = new Map();
                    filteredGlobalTags.forEach((t) => {
                        const text = t.text || __colorName(t.color);
                        const bKey = __getBucketKey(text);
                        if (!bucketsMap.has(bKey)) {
                            bucketsMap.set(bKey, []);
                        }
                        bucketsMap.get(bKey).push(t);
                    });

                    const alphaKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
                    const bucketOrder = ['0-9'].concat(alphaKeys).concat(['#']);
                    
                    // Get sorted list of active buckets
                    const activeBucketKeys = bucketOrder.filter(key => bucketsMap.has(key) && bucketsMap.get(key).length > 0);
                    bucketsMap.forEach((_, key) => {
                        if (!activeBucketKeys.includes(key)) {
                            activeBucketKeys.push(key);
                        }
                    });

                    // Sort tags within each bucket
                    let collator = null;
                    if (typeof getTagBrowseSortCollator === 'function') {
                        try {
                            collator = getTagBrowseSortCollator(isZh);
                        } catch (_) {}
                    }
                    const compareTags = (a, b) => {
                        const labelA = a.text || __colorName(a.color);
                        const labelB = b.text || __colorName(b.color);
                        if (collator) {
                            try {
                                const delta = collator.compare(labelA, labelB);
                                if (delta !== 0) return delta;
                            } catch (_) {}
                        }
                        const delta = labelA.localeCompare(labelB, isZh ? 'zh-CN' : 'en', { sensitivity: 'base', numeric: true });
                        if (delta !== 0) return delta;
                        
                        const colorOrder = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
                        return colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
                    };

                    activeBucketKeys.forEach((key) => {
                        bucketsMap.get(key).sort(compareTags);
                    });

                    if (!__popoverCtx.bucketLimits) {
                        __popoverCtx.bucketLimits = {};
                    }

                    // It is scrollable if active buckets count is larger than 3
                    subGlobalListEl.classList.toggle('is-scrollable', activeBucketKeys.length > 3);
                    
                    activeBucketKeys.forEach((bucketKey) => {
                        const bucketTags = bucketsMap.get(bucketKey);
                        const bucketDiv = document.createElement('div');
                        bucketDiv.className = 'tag-global-bucket';
                        
                        const titleEl = document.createElement('div');
                        titleEl.className = 'tag-global-bucket-title';
                        titleEl.textContent = bucketKey;
                        bucketDiv.appendChild(titleEl);
                        
                        const listEl = document.createElement('div');
                        listEl.className = 'tag-global-bucket-list';
                        
                        const tagLimit = __popoverCtx.bucketLimits[bucketKey] || 5;
                        __popoverCtx.bucketLimits[bucketKey] = tagLimit;
                        
                        const visibleTags = bucketTags.slice(0, tagLimit);
                        
                        visibleTags.forEach((t) => {
                            const k = keyOf(t.color, t.text);
                            const entry = aggregate.get(k);
                            const row = document.createElement('div');
                            row.className = 'tag-applied-row';
                            row.dataset.color = t.color;
                            row.dataset.text = t.text;
                            let statusMark = '+';
                            if (entry) {
                                if (entry.present === targets.length) {
                                    row.classList.add('is-active');
                                    statusMark = '✓';
                                } else {
                                    row.classList.add('is-mixed');
                                    statusMark = '–';
                                }
                            }
                            row.innerHTML = `
                                <span class="tag-dot tag-dot-${t.color}"></span>
                                <span class="tag-applied-text"></span>
                                <span class="tag-applied-status">${statusMark}</span>
                            `;
                            row.querySelector('.tag-applied-text').textContent = t.text || __colorName(t.color);
                            listEl.appendChild(row);
                        });
                        
                        bucketDiv.appendChild(listEl);
                        
                        // Render bucket specific pagination buttons
                        const hasMore = bucketTags.length > visibleTags.length;
                        const canCollapse = tagLimit > 5;
                        
                        if (hasMore || canCollapse) {
                            const remaining = bucketTags.length - visibleTags.length;
                            const willLoad = Math.min(5, remaining);
                            
                            const btnContainer = document.createElement('div');
                            btnContainer.className = 'tag-popover-more-container';
                            btnContainer.style.display = 'flex';
                            btnContainer.style.gap = '4px';
                            btnContainer.style.alignItems = 'center';
                            btnContainer.style.padding = '2px 6px';
                            
                            if (hasMore) {
                                const loadMoreBtn = document.createElement('button');
                                loadMoreBtn.className = 'tag-popover-more';
                                loadMoreBtn.type = 'button';
                                loadMoreBtn.style.margin = '0';
                                loadMoreBtn.style.flex = '1';
                                loadMoreBtn.dataset.action = 'load-more-bucket';
                                loadMoreBtn.dataset.bucket = bucketKey;
                                loadMoreBtn.textContent = isZh ? `展开 ${willLoad} 项` : `Load +${willLoad}`;
                                btnContainer.appendChild(loadMoreBtn);
                            }
                            
                            if (canCollapse) {
                                const collapseBtn = document.createElement('button');
                                collapseBtn.className = 'tag-popover-more';
                                collapseBtn.type = 'button';
                                collapseBtn.style.margin = '0';
                                collapseBtn.style.flex = '1';
                                collapseBtn.dataset.action = 'collapse-bucket';
                                collapseBtn.dataset.bucket = bucketKey;
                                collapseBtn.textContent = __t(TAG_PANEL_I18N.collapseTags);
                                btnContainer.appendChild(collapseBtn);
                            }
                            bucketDiv.appendChild(btnContainer);
                        }
                        
                        subGlobalListEl.appendChild(bucketDiv);
                    });

                }
            }
        }

        // Input placeholder
        el.querySelector('[data-role="input"]').setAttribute('placeholder', __t(TAG_PANEL_I18N.inputPlaceholder));

        if (!__popoverCtx.globalCollapsed) {
            __positionSubPanel();
        } else if (__popoverSubEl) {
            __popoverSubEl.hidden = true;
        }

        __updatePreview();
    }

    async function __toggleTagOnAllTargets(tagInput, options = {}) {
        // mode:
        //   'auto'    – if all targets have it: remove from all; else add to those missing.
        //   'remove'  – remove from every target that has it.
        if (!__popoverCtx) return;
        const { targets } = __popoverCtx;
        const bridge = __bridge();
        if (!bridge || !bridge.normalizeTagInput || !bridge.makeTagKey) return;
        const norm = bridge.normalizeTagInput(tagInput);
        if (!norm) return;
        const key = bridge.makeTagKey(norm.color, norm.text);
        const perTargetTags = await Promise.all(targets.map((t) => __getTagsForTarget(t)));
        const allHave = perTargetTags.every((tags) => (tags || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === key));
        const mode = options.mode || 'auto';
        let latestSingleTargetTags = null;

        for (let i = 0; i < targets.length; i++) {
            const has = (perTargetTags[i] || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === key);
            let result = null;
            if (mode === 'remove') {
                if (has) result = await __toggleTagOnTarget(targets[i], norm);
            } else {
                if (allHave && has) {
                    result = await __toggleTagOnTarget(targets[i], norm);
                } else if (!allHave && !has) {
                    result = await __toggleTagOnTarget(targets[i], norm);
                }
            }
            if (targets.length === 1 && result && Array.isArray(result.tags)) {
                latestSingleTargetTags = result.tags;
            }
        }
        await __renderPopover();
        __refreshTargetTagDots(targets);
        __notifyTagSearchChanged(targets, { updatedTags: latestSingleTargetTags });
    }


    async function __clearAllTagsOnTargets() {
        if (!__popoverCtx) return;
        const { targets } = __popoverCtx;
        const bridge = __bridge();
        
        const lang = __lang();
        const confirmMsg = lang === 'en'
            ? 'Are you sure you want to clear all tags from the selected item(s)?'
            : '确定要清除当前选择项的所有标签吗？';
        if (!confirm(confirmMsg)) return;

        const permanentUpdates = [];
        for (const target of targets) {
            if (target.kind === 'permanent') {
                permanentUpdates.push({ chromeId: target.chromeId, tags: [] });
            } else if (target.kind === 'temporary') {
                if (typeof setTempItemTags === 'function') {
                    setTempItemTags(target.sectionId, target.itemId, [], { skipRender: true, skipSave: true });
                }
            }
        }

        if (permanentUpdates.length > 0 && bridge) {
            if (typeof bridge.writePermanentNodeTagsBulk === 'function') {
                await bridge.writePermanentNodeTagsBulk(permanentUpdates);
            } else if (typeof bridge.writePermanentNodeTags === 'function') {
                for (const upd of permanentUpdates) {
                    await bridge.writePermanentNodeTags(upd.chromeId, upd.tags);
                }
            }
        }

        const hasTemp = targets.some(t => t.kind === 'temporary');
        if (hasTemp && typeof saveTempNodes === 'function') {
            saveTempNodes();
        }
        if (hasTemp && typeof refreshTempSectionTreeInPlace === 'function') {
            const sectionIds = new Set(targets.filter(t => t.kind === 'temporary').map(t => t.sectionId));
            sectionIds.forEach(sid => {
                const sec = typeof getTempSection === 'function' ? getTempSection(sid) : null;
                if (sec) refreshTempSectionTreeInPlace(sec);
            });
        }

        await __renderPopover();
        __refreshTargetTagDots(targets);
        __notifyTagSearchChanged(targets, { updatedTags: [] });
    }

    async function __confirmCurrentSelection() {
        if (!__popoverCtx || !__popoverCtx.selectedColor) return;
        const color = __popoverCtx.selectedColor;
        const input = __popoverEl.querySelector('[data-role="input"]');
        const typed = (input && input.value || '').trim();
        const text = typed || __colorName(color);
        const tagInput = { color, text };

        const bridge = __bridge();
        if (!bridge || !bridge.normalizeTagInput || !bridge.makeTagKey) return;
        const norm = bridge.normalizeTagInput(tagInput);
        if (!norm) return;
        const key = bridge.makeTagKey(norm.color, norm.text);
        const editingNorm = __popoverCtx.editingTag ? bridge.normalizeTagInput(__popoverCtx.editingTag) : null;
        const editingKey = editingNorm ? bridge.makeTagKey(editingNorm.color, editingNorm.text) : null;

        // Add new tags normally; when opened from an existing row marker, confirm
        // replaces that exact tag so the marker can be edited in-place.
        const { targets } = __popoverCtx;
        const perTargetTags = await Promise.all(targets.map((t) => __getTagsForTarget(t)));
        let latestSingleTargetTags = null;
        for (let i = 0; i < targets.length; i++) {
            const has = (perTargetTags[i] || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === key);
            if (editingNorm && editingKey && editingKey !== key) {
                const hasEditingTag = (perTargetTags[i] || []).some((tt) => bridge.makeTagKey(tt.color, tt.text) === editingKey);
                let result = null;
                if (hasEditingTag) result = await __toggleTagOnTarget(targets[i], editingNorm);
                if (!has) result = await __toggleTagOnTarget(targets[i], norm);
                if (targets.length === 1 && result && Array.isArray(result.tags)) latestSingleTargetTags = result.tags;
            } else if (!has) {
                const result = await __toggleTagOnTarget(targets[i], norm);
                if (targets.length === 1 && result && Array.isArray(result.tags)) latestSingleTargetTags = result.tags;
            }
        }
        // Reset transient state
        if (input) input.value = '';
        __popoverCtx.selectedColor = null;
        __popoverCtx.editingTag = null;
        __popoverCtx.dontFilterSubPanel = false;
        await __renderPopover();
        __refreshTargetTagDots(targets);
        __notifyTagSearchChanged(targets, { updatedTags: latestSingleTargetTags });
    }

    function __onPopoverClick(ev) {
        const target = ev.target;
        
        // Single row delete button
        const rowDeleteBtn = target.closest('.tag-row-delete-btn');
        if (rowDeleteBtn) {
            const row = rowDeleteBtn.closest('.tag-applied-row');
            if (row) {
                const tag = { color: row.dataset.color, text: row.dataset.text };
                __toggleTagOnAllTargets(tag, { mode: 'remove' });
            }
            ev.stopPropagation();
            return;
        }

        // Collapsible header toggle
        const toggleGlobalHeader = target.closest('[data-action="toggle-global-collapse"]');
        if (toggleGlobalHeader) {
            __popoverCtx.globalCollapsed = !__popoverCtx.globalCollapsed;
            __renderPopover();
            ev.stopPropagation();
            return;
        }



        const paletteBtn = target.closest('.tag-palette-btn');
        if (paletteBtn) {
            const color = paletteBtn.dataset.color;
            // Toggle off if user clicks the already-selected color.
            __popoverCtx.selectedColor = (__popoverCtx.selectedColor === color) ? null : color;
            __popoverCtx.dontFilterSubPanel = false;
            __updatePreview();
            // Update palette is-selected highlights
            __popoverEl.querySelectorAll('.tag-palette-btn').forEach((b) => {
                b.classList.toggle('is-selected', b.dataset.color === __popoverCtx.selectedColor);
            });
            __renderPopover();
            ev.stopPropagation();
            return;
        }
        const confirmBtn = target.closest('[data-role="confirm"]');
        if (confirmBtn) {
            if (!confirmBtn.disabled) __confirmCurrentSelection();
            ev.stopPropagation();
            return;
        }
        const closeBtn = target.closest('[data-role="close-popover"]');
        if (closeBtn) {
            __closePopover();
            ev.stopPropagation();
            return;
        }

        
        const appliedMore = target.closest('[data-role="applied-more"]');
        if (appliedMore && appliedMore.dataset.action === 'load-more-applied') {
            __loadMoreAppliedTags();
            ev.stopPropagation();
            return;
        }
        const appliedCollapse = target.closest('[data-role="applied-collapse"]');
        if (appliedCollapse && appliedCollapse.dataset.action === 'collapse-applied') {
            __collapseAppliedTags();
            ev.stopPropagation();
            return;
        }


        const recentRow = target.closest('.tag-applied-row');
        if (recentRow) {
            const tag = { color: recentRow.dataset.color, text: recentRow.dataset.text };
            if (recentRow.classList.contains('is-active') || recentRow.classList.contains('is-mixed')) {
                const isAlreadyEditing = __popoverCtx && __popoverCtx.editingTag && 
                    __popoverCtx.editingTag.color === tag.color && 
                    __popoverCtx.editingTag.text === tag.text;
                if (isAlreadyEditing) {
                    ev.stopPropagation();
                    return;
                }
                __popoverCtx.editingTag = tag;
                __popoverCtx.selectedColor = tag.color;
                __popoverCtx.dontFilterSubPanel = true;
                const input = __popoverEl.querySelector('[data-role="input"]');
                if (input) input.value = tag.text || __colorName(tag.color);
                __updatePreview();
                __renderPopover();
            } else {
                __toggleTagOnAllTargets(tag);
            }
            ev.stopPropagation();
            return;
        }
    }

    function __onPopoverInput() {
        __updatePreview();
    }

    function __onPopoverInputKeydown(ev) {
        if (ev.key === 'Enter') {
            if (ev.isComposing) return;
            ev.preventDefault();
            if (__popoverCtx && __popoverCtx.selectedColor) __confirmCurrentSelection();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            __closePopover();
        }
    }

    function __onRecentListScroll(ev) {
        const el = ev.currentTarget;
        if (!el || !__popoverCtx) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) {
            __loadMoreRecentTags();
        }
    }

    function __refreshTargetTagDots(targets) {
        if (!Array.isArray(targets)) return;
        if (typeof window.__refreshTagDotsForTargets === 'function') {
            try { window.__refreshTagDotsForTargets(targets); } catch (_) {}
        }
    }

    function __notifyTagSearchChanged(targets, options = {}) {
        const list = Array.isArray(targets) ? targets : [];
        const hasPermanent = list.some((t) => t && t.kind === 'permanent');
        if (hasPermanent) __invalidatePermIdentityIndex();

        const rerenderSearch = () => {
            try {
                if (typeof window.updateCanvasSearchBookmarkTags === 'function') {
                    window.updateCanvasSearchBookmarkTags(list);
                }
                const input = document.getElementById('searchInput');
                const q = input && typeof input.value === 'string' ? input.value.trim() : '';
                const panel = document.getElementById('searchResultsPanel');
                const panelVisible = !!(panel && panel.classList && panel.classList.contains('visible'));
                // 只在结果面板当前可见时才重跑搜索，避免“输入框残留文字”导致每次打 tag 都弹出搜索面板。
                if (q && panelVisible && typeof window.searchCanvasAndRender === 'function') {
                    window.searchCanvasAndRender(q);
                }
            } catch (_) {}
        };

        if (hasPermanent) {
            __loadPermIdentityIndex(true).then(rerenderSearch).catch(rerenderSearch);
        } else {
            if (Array.isArray(options.updatedTags)) {
                list.forEach((t) => { if (t && t.kind === 'temporary') t.tags = options.updatedTags; });
            }
            rerenderSearch();
        }
    }

    // -------------------------------------------------------------------------
    // Phase C: tag dot rendering on tree-item rows + hover bubble.
    // -------------------------------------------------------------------------

    const LEADING_DOTS_VISIBLE = 5;
    const TRAILING_DOTS_VISIBLE = 5;
    const LEADING_DOTS_ANCHOR_VISIBLE = 3;
    const LEADING_DOT_OVERLAP_STEP = 5;
    // Width threshold: rows wider than this render tags as chips (dot + text) on the
    // RIGHT side, right-aligned. Rows narrower than this fall back to compact dots on
    // the LEFT. Sidebar tree rows typically sit around 220–360 px wide, so the cutoff
    // lives well above that to avoid showing chips in the narrow sidebar.
    const WIDE_ROW_THRESHOLD = 420;

    // Cached permanent identityMap → Map<chromeId, tags[]>
    let __permIdentityIndex = null;
    let __permIdentityIndexLoading = null;

    async function __loadPermIdentityIndex(force = false) {
        if (!force && __permIdentityIndex) return __permIdentityIndex;
        if (__permIdentityIndexLoading) return __permIdentityIndexLoading;
        const bridge = __bridge();
        if (!bridge || !bridge.readPermanentMainContentFromBcs) return new Map();
        __permIdentityIndexLoading = (async () => {
            try {
                const content = await bridge.readPermanentMainContentFromBcs({ skipIdentityMapHeal: true });
                const map = new Map();
                if (content && Array.isArray(content.identityMap)) {
                    for (const entry of content.identityMap) {
                        if (!entry || !entry.id) continue;
                        if (Array.isArray(entry.tags) && entry.tags.length) {
                            map.set(String(entry.id), entry.tags.map((t) => ({ color: t.color, text: t.text || '' })));
                        }
                    }
                }
                __permIdentityIndex = map;
                return map;
            } catch (e) {
                __permIdentityIndex = new Map();
                return __permIdentityIndex;
            } finally {
                __permIdentityIndexLoading = null;
            }
        })();
        return __permIdentityIndexLoading;
    }

    function __invalidatePermIdentityIndex() {
        __permIdentityIndex = null;
    }

    function __getTagsForTreeItemSync(treeItem) {
        const target = __resolveTargetFromTreeItem(treeItem);
        if (!target) return [];
        if (target.kind === 'temporary') {
            try {
                return (typeof getTempItemTags === 'function')
                    ? getTempItemTags(target.sectionId, target.itemId)
                    : [];
            } catch (_) { return []; }
        }
        if (target.kind === 'permanent' && __permIdentityIndex) {
            return __permIdentityIndex.get(String(target.chromeId)) || [];
        }
        return [];
    }

    function __getBookmarkTreeTagSettings() {
        if (window.CanvasModule && typeof window.CanvasModule.getCanvasOtherSettings === 'function') {
            const settings = window.CanvasModule.getCanvasOtherSettings();
            if (settings) {
                return {
                    position: settings.bookmarkTreeTagPosition || 'auto',
                    threshold: settings.bookmarkTreeTagPositionThreshold !== undefined ? settings.bookmarkTreeTagPositionThreshold : 420
                };
            }
        }
        return { position: 'auto', threshold: 420 };
    }

    function __isWideRowContext(treeItem, currentModeIsWide) {
        if (!treeItem) return false;
        // Fullscreen / global search panel → always wide.
        if (treeItem.closest('.canvas-fullscreen-active, .canvas-fullscreen-node, .search-results-panel')) return true;
        
        const settings = __getBookmarkTreeTagSettings();
        if (settings.position === 'left') {
            return false;
        } else if (settings.position === 'right') {
            return true;
        } else {
            const layoutWidth = treeItem.offsetWidth || treeItem.clientWidth || treeItem.scrollWidth || 0;
            const threshold = settings.threshold;
            
            // Implement hysteresis to prevent layout oscillation (flashing) near the threshold
            if (currentModeIsWide === true) {
                // Currently wide (dots-trailing): stay wide unless width drops below threshold - 40px
                return layoutWidth >= Math.max(100, threshold - 40);
            } else if (currentModeIsWide === false) {
                // Currently narrow (dots-leading): stay narrow unless width exceeds threshold + 10px
                return layoutWidth >= (threshold + 10);
            }
            
            return layoutWidth >= threshold;
        }
    }

    function __buildDotsElement(tags, treeItemOrWide, tagsKeyInput) {
        let wide;
        if (typeof treeItemOrWide === 'boolean') {
            wide = treeItemOrWide;
        } else {
            const existing = treeItemOrWide ? treeItemOrWide.querySelector(':scope > .tree-item-tag-dots') : null;
            const currentModeIsWide = existing ? existing.classList.contains('dots-trailing') : null;
            wide = __isWideRowContext(treeItemOrWide, currentModeIsWide);
        }
        const tagsKey = tagsKeyInput !== undefined ? tagsKeyInput : tags.map(t => `${t.color}:${t.text || ''}`).join('|');
        const wrap = document.createElement('span');
        wrap.className = 'tree-item-tag-dots ' + (wide ? 'dots-trailing' : 'dots-leading');
        wrap.dataset.role = 'tag-dots';
        wrap.dataset.tagsKey = tagsKey;
        const visibleLimit = wide ? TRAILING_DOTS_VISIBLE : LEADING_DOTS_VISIBLE;
        const visible = tags.slice(0, visibleLimit);
        if (wide) {
            // Wide rows: render tags as small chips (color dot + text). Right-aligned.
            visible.forEach((t) => {
                const chip = document.createElement('span');
                chip.className = 'tree-item-tag-chip';
                chip.dataset.color = t.color;
                chip.dataset.text = t.text || '';
                chip.innerHTML = `<span class="tag-dot tag-dot-${t.color}"></span><span class="tree-item-tag-chip-text"></span>`;
                chip.querySelector('.tree-item-tag-chip-text').textContent = t.text || __colorName(t.color);
                wrap.appendChild(chip);
            });
            if (tags.length > TRAILING_DOTS_VISIBLE) {
                const more = document.createElement('span');
                more.className = 'tree-item-tag-chip-more';
                more.textContent = `…+${tags.length - TRAILING_DOTS_VISIBLE}`;
                wrap.appendChild(more);
            }
        } else {
            const overflowCount = Math.max(0, visible.length - LEADING_DOTS_ANCHOR_VISIBLE);
            wrap.style.setProperty('--tag-leading-overflow-shift', `${-overflowCount * LEADING_DOT_OVERLAP_STEP}px`);
            // Narrow rows: compact dots (no text), on the left.
            if (tags.length > LEADING_DOTS_VISIBLE) {
                const more = document.createElement('span');
                more.className = 'tag-dot tag-dot-more';
                more.textContent = `+${tags.length - LEADING_DOTS_VISIBLE}…`;
                wrap.appendChild(more);
            }
            visible.forEach((t) => {
                const dot = document.createElement('span');
                dot.className = `tag-dot tag-dot-${t.color}`;
                dot.dataset.color = t.color;
                dot.dataset.text = t.text || '';
                wrap.appendChild(dot);
            });
        }
        return wrap;
    }

    function __animateDotsFromRect(next, previousRect, previousMode) {
        if (!next || !previousRect) return;
        const nextMode = next.classList.contains('dots-trailing') ? 'trailing' : 'leading';
        if (previousMode && previousMode !== nextMode) return;
        const nextRect = next.getBoundingClientRect();
        const dx = previousRect.left - nextRect.left;
        const dy = previousRect.top - nextRect.top;
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return;
        next.style.setProperty('--tag-dot-shift-x', `${Math.round(dx)}px`);
        next.style.setProperty('--tag-dot-shift-y', `${Math.round(dy)}px`);
        next.style.opacity = '0.86';
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                next.style.setProperty('--tag-dot-shift-x', '0px');
                next.style.setProperty('--tag-dot-shift-y', '0px');
                next.style.opacity = '';
                window.setTimeout(() => {
                    next.style.removeProperty('--tag-dot-shift-x');
                    next.style.removeProperty('--tag-dot-shift-y');
                }, 260);
            });
        });
    }

    function __injectDotsIntoTreeItem(treeItem) {
        if (!treeItem || !treeItem.classList.contains('tree-item')) return;
        const existing = treeItem.querySelector(':scope > .tree-item-tag-dots');
        const tags = __getTagsForTreeItemSync(treeItem);
        if (!tags.length) {
            if (existing) existing.remove();
            return;
        }
        const currentModeIsWide = existing
            ? existing.classList.contains('dots-trailing')
            : null;
        const wide = __isWideRowContext(treeItem, currentModeIsWide);
        const tagsKey = tags.map(t => `${t.color}:${t.text || ''}`).join('|');
        const nextMode = wide ? 'dots-trailing' : 'dots-leading';
        const currentMode = existing
            ? (existing.classList.contains('dots-trailing') ? 'dots-trailing' : 'dots-leading')
            : null;
        if (existing && existing.dataset.tagsKey === tagsKey && currentMode === nextMode) {
            return;
        }
        const next = __buildDotsElement(tags, wide, tagsKey);
        const previousRect = existing ? existing.getBoundingClientRect() : null;
        const previousMode = existing
            ? (existing.classList.contains('dots-trailing') ? 'trailing' : 'leading')
            : null;
        if (existing) {
            existing.replaceWith(next);
        } else {
            // Leading: insert as first child; trailing: insert before tipIcon.
            if (next.classList.contains('dots-trailing')) {
                const tip = treeItem.querySelector(':scope > .tree-tip-icon');
                if (tip) treeItem.insertBefore(next, tip);
                else treeItem.appendChild(next);
            } else {
                treeItem.insertBefore(next, treeItem.firstChild);
            }
        }
        __animateDotsFromRect(next, previousRect, previousMode);
    }

    // Hover bubble
    let __hoverBubble = null;
    function __ensureHoverBubble() {
        if (__hoverBubble) return __hoverBubble;
        const el = document.createElement('div');
        el.className = 'tag-hover-bubble';
        el.hidden = true;
        getOverlayContainer().appendChild(el);
        __hoverBubble = el;
        return el;
    }
    function __showHoverBubble(dot) {
        const bubble = __ensureHoverBubble();
        const targetParent = getOverlayContainer();
        if (bubble.parentElement !== targetParent) {
            targetParent.appendChild(bubble);
        }
        const color = dot.dataset.color;
        const text = dot.dataset.text || __colorName(color);
        bubble.dataset.color = color;
        bubble.innerHTML = `<span class="tag-hover-bubble-text"></span>`;
        bubble.querySelector('.tag-hover-bubble-text').textContent = text;
        bubble.hidden = false;
        const r = dot.getBoundingClientRect();
        const br = bubble.getBoundingClientRect();
        let top = r.top - br.height - 4;
        let left = r.left + r.width / 2 - br.width / 2;
        if (top < 8) top = r.bottom + 4;
        if (left < 8) left = 8;
        if (left + br.width > window.innerWidth - 8) left = window.innerWidth - br.width - 8;
        bubble.style.top = `${top}px`;
        bubble.style.left = `${left}px`;
    }
    function __hideHoverBubble() {
        if (__hoverBubble) __hoverBubble.hidden = true;
    }

    document.addEventListener('mouseover', (ev) => {
        const dot = ev.target.closest('.tree-item-tag-dots.dots-leading .tag-dot');
        if (dot && !dot.classList.contains('tag-dot-more')) __showHoverBubble(dot);
    });
    document.addEventListener('mouseout', (ev) => {
        const dot = ev.target.closest('.tree-item-tag-dots.dots-leading .tag-dot');
        if (dot) __hideHoverBubble();
    });

    // Mutation observer: auto-inject dots on newly-rendered tree items.
    let __pendingTreeItems = new Set();
    let __pendingFlushScheduled = false;
    const __resizeObservedTreeItems = new WeakSet();
    const __treeItemResizeObserver = (typeof ResizeObserver !== 'undefined')
        ? new ResizeObserver((entries) => {
            entries.forEach((entry) => __observeTreeItem(entry.target));
        })
        : null;
    function __scheduleFlushDots() {
        if (__pendingFlushScheduled) return;
        __pendingFlushScheduled = true;
        requestAnimationFrame(async () => {
            __pendingFlushScheduled = false;
            const items = Array.from(__pendingTreeItems);
            __pendingTreeItems.clear();
            // Ensure perm index is ready if any of the items are permanent.
            const hasPermItems = items.some((el) => {
                const tt = el.dataset.treeType || el.getAttribute('data-tree-type') || '';
                return tt !== 'temporary';
            });
            if (hasPermItems && !__permIdentityIndex) {
                await __loadPermIdentityIndex();
            }

            // --- BATCHED READ PHASE ---
            const updates = [];
            items.forEach((treeItem) => {
                if (!document.contains(treeItem)) return;

                const existing = treeItem.querySelector(':scope > .tree-item-tag-dots');
                const tags = __getTagsForTreeItemSync(treeItem);

                if (!tags.length) {
                    if (existing) {
                        updates.push({ treeItem, action: 'remove', existing });
                    }
                    return;
                }

                // Querying layout settings and offsetWidth in batch before writing to the DOM
                const currentModeIsWide = existing
                    ? existing.classList.contains('dots-trailing')
                    : null;
                const wide = __isWideRowContext(treeItem, currentModeIsWide);
                const nextMode = wide ? 'dots-trailing' : 'dots-leading';
                const currentMode = existing
                    ? (existing.classList.contains('dots-trailing') ? 'dots-trailing' : 'dots-leading')
                    : null;

                const tagsKey = tags.map(t => `${t.color}:${t.text || ''}`).join('|');
                const existingTagsKey = existing ? existing.dataset.tagsKey : null;

                // Compare tags and layout mode to skip redundant updates
                if (existing && existingTagsKey === tagsKey && currentMode === nextMode) {
                    return;
                }

                updates.push({
                    treeItem,
                    action: existing ? 'replace' : 'insert',
                    existing,
                    tags,
                    wide,
                    tagsKey
                });
            });

            // If there are no updates, exit early to avoid any layout invalidations or animations
            if (updates.length === 0) return;

            // --- BATCHED WRITE PHASE ---
            // 1. First, measure all previous rects (Reads)
            const previousModes = [];
            const previousRects = updates.map((up, idx) => {
                if (up.action === 'replace') {
                    previousModes[idx] = up.existing.classList.contains('dots-trailing') ? 'trailing' : 'leading';
                    return up.existing.getBoundingClientRect();
                }
                previousModes[idx] = null;
                return null;
            });

            // 2. Perform all DOM mutations (Writes)
            const elementsToAnimate = [];
            updates.forEach((up, idx) => {
                const { treeItem, action, existing, tags, wide, tagsKey } = up;

                if (action === 'remove') {
                    existing.remove();
                    return;
                }

                // Build new dots element passing wide/tagsKey directly
                const next = __buildDotsElement(tags, wide, tagsKey);

                if (action === 'replace') {
                    existing.replaceWith(next);
                    elementsToAnimate.push({
                        element: next,
                        previousRect: previousRects[idx],
                        previousMode: previousModes[idx]
                    });
                } else if (action === 'insert') {
                    if (wide) {
                        const tip = treeItem.querySelector(':scope > .tree-tip-icon');
                        if (tip) treeItem.insertBefore(next, tip);
                        else treeItem.appendChild(next);
                    } else {
                        treeItem.insertBefore(next, treeItem.firstChild);
                    }
                    elementsToAnimate.push({
                        element: next,
                        previousRect: null,
                        previousMode: null
                    });
                }
            });

            // 3. Batch the animation offset calculations (Reads)
            const animationData = [];
            elementsToAnimate.forEach((anim) => {
                const { element, previousRect, previousMode } = anim;
                if (!previousRect) return; // Only animate replacements

                const nextMode = element.classList.contains('dots-trailing') ? 'trailing' : 'leading';
                if (previousMode && previousMode !== nextMode) return;

                const nextRect = element.getBoundingClientRect(); // Read!
                const dx = previousRect.left - nextRect.left;
                const dy = previousRect.top - nextRect.top;

                if (Number.isFinite(dx) && Number.isFinite(dy) && (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)) {
                    animationData.push({
                        element,
                        dx,
                        dy
                    });
                }
            });

            // 4. Batch initial animation style assignments (Writes)
            animationData.forEach(({ element, dx, dy }) => {
                element.style.setProperty('--tag-dot-shift-x', `${Math.round(dx)}px`);
                element.style.setProperty('--tag-dot-shift-y', `${Math.round(dy)}px`);
                element.style.opacity = '0.86';
            });

            // 5. Trigger transition in subsequent frames without forcing synchronous layout
            if (animationData.length > 0) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        animationData.forEach(({ element }) => {
                            element.style.setProperty('--tag-dot-shift-x', '0px');
                            element.style.setProperty('--tag-dot-shift-y', '0px');
                            element.style.opacity = '';
                        });
                        window.setTimeout(() => {
                            animationData.forEach(({ element }) => {
                                element.style.removeProperty('--tag-dot-shift-x');
                                element.style.removeProperty('--tag-dot-shift-y');
                            });
                        }, 260);
                    });
                });
            }
        });
    }

    function __observeTreeItem(el) {
        if (!el || !el.classList || !el.classList.contains('tree-item')) return;
        if (__treeItemResizeObserver && !__resizeObservedTreeItems.has(el)) {
            __resizeObservedTreeItems.add(el);
            __treeItemResizeObserver.observe(el);
        }
        __pendingTreeItems.add(el);
        __scheduleFlushDots();
    }

    let __deferredTreeItemScanTimer = null;
    function __isCanvasInteractionBusyForTagDots() {
        const workspace = document.getElementById('canvasWorkspace');
        const state = (window.CanvasModule && window.CanvasModule.CanvasState) ? window.CanvasModule.CanvasState : null;
        const resizeState = state && state.sectionCtrlMode && state.sectionCtrlMode.resize;
        return !!(
            (workspace && (
                workspace.classList.contains('is-zooming') ||
                workspace.classList.contains('is-scrolling') ||
                workspace.classList.contains('panning')
            )) ||
            (state && state.isPanning) ||
            (state && state.dragState && state.dragState.isDragging) ||
            (state && state.touchpadState && state.touchpadState.isScrolling) ||
            (resizeState && resizeState.active)
        );
    }

    function __scanTreeItemsForTagDots(scope) {
        const root = (scope && scope.querySelectorAll) ? scope : document;
        root.querySelectorAll('.tree-item').forEach(__observeTreeItem);
    }

    function __scheduleDeferredTreeItemScan() {
        if (__deferredTreeItemScanTimer) return;
        __deferredTreeItemScanTimer = setTimeout(() => {
            __deferredTreeItemScanTimer = null;
            if (__isCanvasInteractionBusyForTagDots()) {
                __scheduleDeferredTreeItemScan();
                return;
            }
            __scanTreeItemsForTagDots(document);
        }, 180);
    }

    function __queueTreeItemScanForTagDots(scope) {
        if (__isCanvasInteractionBusyForTagDots()) {
            __scheduleDeferredTreeItemScan();
            return;
        }
        __scanTreeItemsForTagDots(scope);
    }

    const __treeObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'attributes') {
                const target = m.target;
                if (target.classList && target.classList.contains('tree-item')) {
                    __observeTreeItem(target);
                } else if (
                    target.querySelectorAll &&
                    target.matches &&
                    target.matches('.canvas-fullscreen-active, .canvas-fullscreen-node, .canvas-content, .canvas-workspace, .search-results-panel, body')
                ) {
                    __queueTreeItemScanForTagDots(target);
                }
                continue;
            }
            m.addedNodes.forEach((node) => {
                if (node.nodeType !== 1) return;
                if (node.classList && node.classList.contains('tree-item')) {
                    __observeTreeItem(node);
                }
                if (node.querySelectorAll) {
                    node.querySelectorAll('.tree-item').forEach(__observeTreeItem);
                }
            });
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        __treeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        // Initial pass for existing items
        __scanTreeItemsForTagDots(document);
    });
    // In case DOMContentLoaded already fired before this file ran:
    if (document.readyState !== 'loading') {
        __treeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        __scanTreeItemsForTagDots(document);
    }
    window.addEventListener('resize', () => {
        __queueTreeItemScanForTagDots(document);
    }, { passive: true });

    window.addEventListener('canvas-other-settings-updated', () => {
        if (typeof window.__refreshAllTagDots === 'function') {
            window.__refreshAllTagDots();
        }
    });

    const tagSyncChannel = new BroadcastChannel('bookmark-canvas-tag-sync');
    tagSyncChannel.onmessage = (event) => {
        const { action, targets } = event.data;
        if (action === 'sync-tags') {
            if (typeof window.__refreshTagDotsForTargets === 'function') {
                window.__refreshTagDotsForTargets(targets, true);
            }
            if (__popoverEl && !__popoverEl.hidden && __popoverCtx && __popoverCtx.targets) {
                const affected = __popoverCtx.targets.some(t => {
                    const k = t.kind === 'temporary' ? t.itemId : t.chromeId;
                    return targets.some(tt => (tt.kind === t.kind && (tt.kind === 'temporary' ? tt.itemId === k : tt.chromeId === k)));
                });
                if (affected) {
                    __renderPopover();
                }
            }
            try {
                if (typeof window.updateCanvasSearchBookmarkTags === 'function') {
                    window.updateCanvasSearchBookmarkTags(targets);
                }
                const input = document.getElementById('searchInput');
                const q = input && typeof input.value === 'string' ? input.value.trim() : '';
                const panel = document.getElementById('searchResultsPanel');
                const panelVisible = !!(panel && panel.classList && panel.classList.contains('visible'));
                if (q && panelVisible && typeof window.searchCanvasAndRender === 'function') {
                    window.searchCanvasAndRender(q);
                }
            } catch (_) {}
        }
    };

    function refreshTagDotsForTargets(targets, skipBroadcast = false) {
        if (!Array.isArray(targets)) return;
        // Invalidate perm index so the next read sees latest tags.
        const hasPerm = targets.some((t) => t && t.kind === 'permanent');
        if (hasPerm) __invalidatePermIdentityIndex();
        // Find affected tree-items
        const items = new Set();
        targets.forEach((t) => {
            if (!t) return;
            let sel;
            if (t.kind === 'temporary') sel = `.tree-item[data-tree-type="temporary"][data-section-id="${CSS.escape(t.sectionId || '')}"][data-node-id="${CSS.escape(t.itemId || '')}"]`;
            else sel = `.tree-item[data-node-id="${CSS.escape(t.chromeId || '')}"]:not([data-tree-type="temporary"])`;
            document.querySelectorAll(sel).forEach((el) => items.add(el));
        });
        items.forEach(__observeTreeItem);

        if (!skipBroadcast) {
            try {
                tagSyncChannel.postMessage({
                    action: 'sync-tags',
                    targets: targets
                });
            } catch (_) {}
        }
    }

    window.__refreshTagDotsForTargets = refreshTagDotsForTargets;
    window.__refreshAllTagDots = function () {
        __invalidatePermIdentityIndex();
        document.querySelectorAll('.tree-item').forEach(__observeTreeItem);
    };

    // -------------------------------------------------------------------------
    // Public entry points
    // -------------------------------------------------------------------------

    function openTagPopover(input) {
        // input: { target: {...} } OR { targets: [{...}], anchor }
        let targets = [];
        if (Array.isArray(input.targets)) targets = input.targets.filter(Boolean);
        else if (input.target) targets = [input.target];
        if (!targets.length) return;

        const anchor = input.anchor || null;
        const initialTag = (input.initialTag && input.initialTag.color) ? input.initialTag : null;
        __popoverCtx = {
            targets,
            anchor,
            selectedColor: initialTag ? initialTag.color : null,
            editingTag: initialTag,
            appliedLimit: APPLIED_INITIAL_VISIBLE,
            globalCollapsed: true,
            bucketLimits: {}
        };
        const pop = __ensurePopoverDom();
        const targetParent = getOverlayContainer();
        if (pop.parentElement !== targetParent) {
            targetParent.appendChild(pop);
        }
        if (__popoverSubEl && __popoverSubEl.parentElement !== targetParent) {
            targetParent.appendChild(__popoverSubEl);
        }
        const inputEl = __popoverEl.querySelector('[data-role="input"]');
        if (inputEl) inputEl.value = initialTag ? (initialTag.text || __colorName(initialTag.color)) : '';
        __renderPopover().then(() => __positionPopover(anchor));

        // Outside click / Esc close
        __outsideClickHandler = (ev) => {
            if (!__popoverEl) return;
            if (__popoverEl.contains(ev.target)) return;
            if (__popoverSubEl && __popoverSubEl.contains(ev.target)) return;
            if (anchor && anchor.contains && anchor.contains(ev.target)) return;
            __closePopover();
        };
        __escKeyHandler = (ev) => {
            if (ev.key === 'Escape') { __closePopover(); ev.stopPropagation(); }
        };
        document.addEventListener('mousedown', __outsideClickHandler, true);
        document.addEventListener('keydown', __escKeyHandler, true);
    }

    function closeTagPopover() { __closePopover(); }

    function __rectToPlainObject(rect) {
        if (!rect) return null;
        return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
        };
    }

    // -------------------------------------------------------------------------
    // Click delegate on tip icons (Phase B)
    // -------------------------------------------------------------------------

    document.addEventListener('click', (ev) => {
        const tagMark = ev.target.closest('.tree-item-tag-dots .tag-dot, .tree-item-tag-chip, .tree-item-tag-chip-more');
        if (tagMark) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
            const treeItem = tagMark.closest('.tree-item');
            const target = __resolveTargetFromTreeItem(treeItem);
            if (!target) return;
            __hideHoverBubble();
            const color = tagMark.dataset.color || '';
            const text = tagMark.dataset.text || '';
            const tagAnchor = document.createElement('span');
            tagAnchor.__tagPopoverAnchorRect = __rectToPlainObject(tagMark.getBoundingClientRect());
            tagAnchor.closest = (selector) => {
                if (selector === '.tree-item') return treeItem;
                return tagMark.closest(selector);
            };
            openTagPopover({
                target,
                anchor: tagAnchor,
                initialTag: color ? { color, text } : null
            });
            return;
        }

        const tip = ev.target.closest('.tree-tip-icon');
        if (!tip) return;
        ev.stopImmediatePropagation();
        ev.preventDefault();
        const treeItem = tip.closest('.tree-item');
        const target = __resolveTargetFromTreeItem(treeItem);
        if (!target) return;
        openTagPopover({ target, anchor: tip });
    }, true);

    // Prevent dragstart from initiating on the tip icon (it's draggable=false but
    // some browsers still bubble the dragstart up; this is defensive).
    document.addEventListener('mousedown', (ev) => {
        const tip = ev.target.closest('.tree-tip-icon, .tree-item-tag-dots');
        if (tip) {
            ev.stopImmediatePropagation();
            ev.preventDefault();
        }
    }, true);

    // -------------------------------------------------------------------------
    // Expose
    // -------------------------------------------------------------------------
    if (typeof window !== 'undefined') {
        window.TagSystem = {
            openTagPopover,
            closeTagPopover,
            resolveTargetFromTreeItem: __resolveTargetFromTreeItem,
            getTagsForTarget: __getTagsForTarget,
            toggleTagOnTarget: __toggleTagOnTarget,
            colorName: __colorName,
            palette: TAG_PALETTE.slice(),
            // For search (Phase F): sync read of cached permanent identityMap tags.
            getPermNodeTagsCached(chromeId) {
                if (!__permIdentityIndex) return [];
                return __permIdentityIndex.get(String(chromeId)) || [];
            },
            async ensurePermTagsLoaded(force) {
                return await __loadPermIdentityIndex(!!force);
            },
            invalidatePermTagsCache() { __invalidatePermIdentityIndex(); }
        };
        window.openTagPopover = openTagPopover;
        window.closeTagPopover = closeTagPopover;
    }
})();
