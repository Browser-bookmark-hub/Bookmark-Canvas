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
        recentHeader:     { 'zh_CN': '已用 tag（全局）', 'en': 'Recent tags (all)' },
        noTagsYet:        { 'zh_CN': '暂无已用 tag', 'en': 'No tags yet' },
        moreEllipsis:     { 'zh_CN': '…还有 {n} 个', 'en': '…{n} more' },
        tagAriaLabel:     { 'zh_CN': '标签', 'en': 'Tags' }
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
    let __popoverCtx = null;
    // __popoverCtx shape: { targets, anchor, selectedColor }
    let __outsideClickHandler = null;
    let __escKeyHandler = null;
    const RECENT_INITIAL_VISIBLE = 3;
    const RECENT_LOAD_STEP = 3;
    const RECENT_MAX_VISIBLE = 10;

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
            </div>
            <div class="tag-popover-palette" data-role="palette">
                <div class="tag-popover-palette-colors" data-role="palette-colors">
                    ${TAG_PALETTE.map((c) =>
                        `<button class="tag-palette-btn" data-color="${c}" type="button" aria-label="${c}"><span class="tag-dot tag-dot-${c}"></span></button>`
                    ).join('')}
                </div>
                <button class="tag-popover-delete" data-role="delete-existing" type="button" aria-label="${__t(TAG_PANEL_I18N.removeAriaLabel)}" hidden>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z"/></svg>
                </button>
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
                <div class="tag-popover-applied-header" data-role="recent-header"></div>
                <div class="tag-popover-applied" data-role="recent"></div>
                <button class="tag-popover-more" data-role="recent-more" type="button" hidden></button>
            </div>
        `;
        document.body.appendChild(el);
        __popoverEl = el;

        el.addEventListener('click', __onPopoverClick);
        const input = el.querySelector('[data-role="input"]');
        input.addEventListener('input', __onPopoverInput);
        input.addEventListener('keydown', __onPopoverInputKeydown);
        const recent = el.querySelector('[data-role="recent"]');
        recent.addEventListener('scroll', __onRecentListScroll);
        return el;
    }

    function __closePopover() {
        if (__popoverEl) {
            __popoverEl.hidden = true;
            __popoverEl.style.removeProperty('transform');
            __popoverEl.style.removeProperty('transform-origin');
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
        pop.style.left = `${Math.round(left + window.scrollX)}px`;
        pop.style.top = `${Math.round(top + window.scrollY)}px`;
    }

    function __updatePreview() {
        if (!__popoverEl || !__popoverCtx) return;
        const placeholder = __popoverEl.querySelector('[data-role="preview-placeholder"]');
        const card = __popoverEl.querySelector('[data-role="preview-card"]');
        const dot = __popoverEl.querySelector('[data-role="preview-dot"]');
        const txt = __popoverEl.querySelector('[data-role="preview-text"]');
        const input = __popoverEl.querySelector('[data-role="input"]');
        const confirmBtn = __popoverEl.querySelector('[data-role="confirm"]');
        const deleteBtn = __popoverEl.querySelector('[data-role="delete-existing"]');
        const color = __popoverCtx.selectedColor;
        if (deleteBtn) {
            deleteBtn.hidden = !__popoverCtx.editingTag;
        }
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

        // Recent (global) tag list — fetched from collectAllUsedTags (Phase A).
        // Per the new spec, this list is GLOBAL: shows tags ever used on any bookmark/folder,
        // so the user can quickly re-apply existing tags. The per-row status (✓/–/+) reflects
        // whether the current target(s) have that tag applied.
        let globalTags = [];
        try {
            if (bridge && bridge.collectAllUsedTags) globalTags = await bridge.collectAllUsedTags();
        } catch (_) {}

        const recentEl = el.querySelector('[data-role="recent"]');
        const recentHeader = el.querySelector('[data-role="recent-header"]');
        const recentMore = el.querySelector('[data-role="recent-more"]');

        recentHeader.textContent = __t(TAG_PANEL_I18N.recentHeader);
        recentEl.innerHTML = '';

        recentEl.classList.remove('is-scrollable');

        if (!globalTags.length) {
            const empty = document.createElement('div');
            empty.className = 'tag-recent-empty';
            empty.textContent = __t(TAG_PANEL_I18N.noTagsYet);
            recentEl.appendChild(empty);
            recentMore.hidden = true;
        } else {
            const recentLimit = Math.min(
                RECENT_MAX_VISIBLE,
                Math.max(RECENT_INITIAL_VISIBLE, Number(__popoverCtx.recentLimit) || RECENT_INITIAL_VISIBLE)
            );
            __popoverCtx.recentLimit = recentLimit;
            const visible = globalTags.slice(0, recentLimit);
            recentEl.classList.toggle('is-scrollable', visible.length > RECENT_INITIAL_VISIBLE);
            visible.forEach((t) => {
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
                recentEl.appendChild(row);
            });

            const hidden = Math.max(0, Math.min(globalTags.length, RECENT_MAX_VISIBLE) - visible.length);
            if (hidden > 0) {
                recentMore.hidden = false;
                recentMore.dataset.action = 'load-more-tags';
                recentMore.textContent = __t(TAG_PANEL_I18N.moreEllipsis, { n: hidden });
            } else {
                recentMore.hidden = true;
                delete recentMore.dataset.action;
            }
        }

        // Input placeholder
        el.querySelector('[data-role="input"]').setAttribute('placeholder', __t(TAG_PANEL_I18N.inputPlaceholder));

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

    async function __deleteEditingTag() {
        if (!__popoverCtx || !__popoverCtx.editingTag) return;
        const tag = __popoverCtx.editingTag;
        await __toggleTagOnAllTargets(tag, { mode: 'remove' });
        __closePopover();
    }

    function __loadMoreRecentTags() {
        if (!__popoverCtx) return;
        const prev = Number(__popoverCtx.recentLimit) || RECENT_INITIAL_VISIBLE;
        const next = Math.min(RECENT_MAX_VISIBLE, prev + RECENT_LOAD_STEP);
        if (next === prev) return;
        __popoverCtx.recentLimit = next;
        __renderPopover();
    }

    function __showAllRecentTags() {
        if (!__popoverCtx) return;
        if (Number(__popoverCtx.recentLimit) >= RECENT_MAX_VISIBLE) return;
        __popoverCtx.recentLimit = RECENT_MAX_VISIBLE;
        __renderPopover();
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
        await __renderPopover();
        __refreshTargetTagDots(targets);
        __notifyTagSearchChanged(targets, { updatedTags: latestSingleTargetTags });
    }

    function __onPopoverClick(ev) {
        const target = ev.target;
        const paletteBtn = target.closest('.tag-palette-btn');
        if (paletteBtn) {
            const color = paletteBtn.dataset.color;
            // Toggle off if user clicks the already-selected color.
            __popoverCtx.selectedColor = (__popoverCtx.selectedColor === color) ? null : color;
            __updatePreview();
            // Update palette is-selected highlights
            __popoverEl.querySelectorAll('.tag-palette-btn').forEach((b) => {
                b.classList.toggle('is-selected', b.dataset.color === __popoverCtx.selectedColor);
            });
            ev.stopPropagation();
            return;
        }
        const confirmBtn = target.closest('[data-role="confirm"]');
        if (confirmBtn) {
            if (!confirmBtn.disabled) __confirmCurrentSelection();
            ev.stopPropagation();
            return;
        }
        const deleteBtn = target.closest('[data-role="delete-existing"]');
        if (deleteBtn) {
            __deleteEditingTag();
            ev.stopPropagation();
            return;
        }
        const recentMore = target.closest('[data-role="recent-more"]');
        if (recentMore && recentMore.dataset.action === 'load-more-tags') {
            __showAllRecentTags();
            ev.stopPropagation();
            return;
        }
        const recentRow = target.closest('.tag-applied-row');
        if (recentRow) {
            const tag = { color: recentRow.dataset.color, text: recentRow.dataset.text };
            if (recentRow.classList.contains('is-active') || recentRow.classList.contains('is-mixed')) {
                __popoverCtx.editingTag = tag;
                __popoverCtx.selectedColor = tag.color;
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

    const MAX_DOTS_VISIBLE = 3;
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

    function __isWideRowContext(treeItem) {
        if (!treeItem) return false;
        // Fullscreen / global search panel → always wide.
        if (treeItem.closest('.canvas-fullscreen-active, .canvas-fullscreen-node, .search-results-panel')) return true;
        const layoutWidth = treeItem.offsetWidth || treeItem.clientWidth || treeItem.scrollWidth || 0;
        return layoutWidth >= WIDE_ROW_THRESHOLD;
    }

    function __buildDotsElement(tags, treeItem) {
        const wide = __isWideRowContext(treeItem);
        const wrap = document.createElement('span');
        wrap.className = 'tree-item-tag-dots ' + (wide ? 'dots-trailing' : 'dots-leading');
        wrap.dataset.role = 'tag-dots';
        const visible = tags.slice(0, MAX_DOTS_VISIBLE);
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
            if (tags.length > MAX_DOTS_VISIBLE) {
                const more = document.createElement('span');
                more.className = 'tree-item-tag-chip-more';
                more.textContent = `…+${tags.length - MAX_DOTS_VISIBLE}`;
                wrap.appendChild(more);
            }
        } else {
            // Narrow rows: compact dots (no text), on the left.
            visible.forEach((t) => {
                const dot = document.createElement('span');
                dot.className = `tag-dot tag-dot-${t.color}`;
                dot.dataset.color = t.color;
                dot.dataset.text = t.text || '';
                wrap.appendChild(dot);
            });
            if (tags.length > MAX_DOTS_VISIBLE) {
                const more = document.createElement('span');
                more.className = 'tag-dot tag-dot-more';
                more.textContent = `…+${tags.length - MAX_DOTS_VISIBLE}`;
                wrap.appendChild(more);
            }
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
        next.getBoundingClientRect();
        requestAnimationFrame(() => {
            next.style.setProperty('--tag-dot-shift-x', '0px');
            next.style.setProperty('--tag-dot-shift-y', '0px');
            next.style.opacity = '';
            window.setTimeout(() => {
                next.style.removeProperty('--tag-dot-shift-x');
                next.style.removeProperty('--tag-dot-shift-y');
            }, 260);
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
        const next = __buildDotsElement(tags, treeItem);
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
        document.body.appendChild(el);
        __hoverBubble = el;
        return el;
    }
    function __showHoverBubble(dot) {
        const bubble = __ensureHoverBubble();
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
            items.forEach((el) => {
                if (document.contains(el)) __injectDotsIntoTreeItem(el);
            });
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
                    target.querySelectorAll('.tree-item').forEach(__observeTreeItem);
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
        document.querySelectorAll('.tree-item').forEach(__observeTreeItem);
    });
    // In case DOMContentLoaded already fired before this file ran:
    if (document.readyState !== 'loading') {
        __treeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        document.querySelectorAll('.tree-item').forEach(__observeTreeItem);
    }
    window.addEventListener('resize', () => {
        document.querySelectorAll('.tree-item').forEach(__observeTreeItem);
    }, { passive: true });

    function refreshTagDotsForTargets(targets) {
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
            recentLimit: RECENT_INITIAL_VISIBLE
        };
        __ensurePopoverDom();
        const inputEl = __popoverEl.querySelector('[data-role="input"]');
        if (inputEl) inputEl.value = initialTag ? (initialTag.text || __colorName(initialTag.color)) : '';
        __renderPopover().then(() => __positionPopover(anchor));

        // Outside click / Esc close
        __outsideClickHandler = (ev) => {
            if (!__popoverEl) return;
            if (__popoverEl.contains(ev.target)) return;
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
            ev.stopPropagation();
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
        ev.stopPropagation();
        ev.preventDefault();
        const treeItem = tip.closest('.tree-item');
        const target = __resolveTargetFromTreeItem(treeItem);
        if (!target) return;
        openTagPopover({ target, anchor: tip });
    }, true);

    // Prevent dragstart from initiating on the tip icon (it's draggable=false but
    // some browsers still bubble the dragstart up; this is defensive).
    document.addEventListener('mousedown', (ev) => {
        const tip = ev.target.closest('.tree-tip-icon');
        if (tip) ev.stopPropagation();
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
