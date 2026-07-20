(function setupCanvasClipboard(global) {
    'use strict';

    const STORAGE_KEY = 'bcs:clipboard-history';
    const MIN_LIMIT = 1;
    const MAX_LIMIT = 50;
    const DEFAULT_LIMIT = 7;
    const clone = (value) => {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    };
    const isEn = () => String(global.currentLang || 'zh_CN').toLowerCase().startsWith('en');
    const text = (zh, en) => isEn() ? en : zh;
    let state = { version: 1, limit: DEFAULT_LIMIT, activeEntryId: null, entries: [] };
    let initialized = false;
    let writeChain = Promise.resolve();
    let selectedIds = new Set();
    let itemTooltip = null;

    function getArea() {
        try { if (global.chrome && chrome.storage && chrome.storage.local) return chrome.storage.local; } catch (_) {}
        try { if (global.browser && browser.storage && browser.storage.local) return browser.storage.local; } catch (_) {}
        return null;
    }

    function normalize(raw) {
        const input = raw && typeof raw === 'object' ? raw : {};
        const limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Number.parseInt(input.limit, 10) || DEFAULT_LIMIT));
        const entries = Array.isArray(input.entries) ? input.entries.filter(Boolean).slice(0, limit) : [];
        const activeEntryId = entries.some((entry) => entry.id === input.activeEntryId) ? input.activeEntryId : null;
        return { version: 1, limit, activeEntryId, entries };
    }

    function getActiveEntry() {
        return state.entries.find((entry) => entry && entry.id === state.activeEntryId) || null;
    }

    function promoteLatestEntry() {
        if (state.activeEntryId || !Array.isArray(state.entries)) return null;
        const entry = state.entries.find((item) => item && item.cutState !== 'claimed');
        if (!entry) return null;
        if (entry.originalOperation === 'cut' && entry.cutState === 'pending') entry.cutState = 'superseded';
        entry.currentOperation = 'copy';
        entry.updatedAt = Date.now();
        state.activeEntryId = entry.id;
        return entry;
    }

    function notify() {
        global.dispatchEvent(new CustomEvent('canvas-clipboard-changed', {
            detail: { state: clone(state), activePayload: getActivePayload() }
        }));
        render();
    }

    function readStorage() {
        const area = getArea();
        if (!area) {
            try { return Promise.resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch (_) { return Promise.resolve({}); }
        }
        return new Promise((resolve) => {
            try {
                const result = area.get([STORAGE_KEY], (items) => resolve((items && items[STORAGE_KEY]) || {}));
                if (result && typeof result.then === 'function') result.then((items) => resolve((items && items[STORAGE_KEY]) || {})).catch(() => resolve({}));
            } catch (_) { resolve({}); }
        });
    }

    function persist() {
        const snapshot = clone(state);
        writeChain = writeChain.then(() => new Promise((resolve) => {
            const area = getArea();
            if (!area) {
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch (_) {}
                resolve();
                return;
            }
            try {
                const result = area.set({ [STORAGE_KEY]: snapshot }, () => resolve());
                if (result && typeof result.then === 'function') result.then(() => resolve()).catch(() => resolve());
            } catch (_) { resolve(); }
        }));
        return writeChain;
    }

    function sendRuntimeMessage(message) {
        const runtime = (global.chrome && global.chrome.runtime) || (global.browser && global.browser.runtime);
        if (!runtime || typeof runtime.sendMessage !== 'function') return Promise.resolve(null);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (response) => {
                if (settled) return;
                settled = true;
                resolve(response || null);
            };
            try {
                const result = runtime.sendMessage(message, finish);
                if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null));
            } catch (_) {
                finish(null);
            }
        });
    }

    async function mutateInBackground(operation, details = {}) {
        const response = await sendRuntimeMessage({ action: 'canvasClipboardMutate', operation, ...details });
        if (!response || response.success !== true || !response.state) return null;
        state = normalize(response.state);
        initialized = true;
        return response;
    }

    async function init() {
        if (initialized) return state;
        state = normalize(await readStorage());
        initialized = true;
        notify();
        return state;
    }

    function summarizeStructured(data) {
        const items = Array.isArray(data && data.payload) ? data.payload : [];
        let bookmarkCount = 0;
        let folderCount = 0;
        const previewItems = [];
        const visit = (item, nested) => {
            if (!item) return;
            const folder = !item.url && (item.type === 'folder' || Array.isArray(item.children));
            if (folder) folderCount += 1; else bookmarkCount += 1;
            if (!nested && previewItems.length < 2) previewItems.push({ title: String(item.title || (folder ? text('文件夹', 'Folder') : text('书签', 'Bookmark'))), folder });
            (item.children || []).forEach((child) => visit(child, true));
        };
        items.forEach((item) => visit(item, false));
        return { bookmarkCount, folderCount, previewItems, textPreview: '' };
    }

    function makeId() {
        try { return crypto.randomUUID(); } catch (_) { return `clipboard-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    }

    async function addStructured(data, options = {}) {
        await init();
        const now = Date.now();
        const next = clone(data || {});
        if (!next || next.__canvasClipboardCancelled || !Array.isArray(next.payload) || !next.payload.length) return null;
        const oldActive = getActiveEntry();
        if (oldActive && oldActive.currentOperation === 'cut' && oldActive.cutState === 'pending') {
            oldActive.cutState = 'superseded';
            oldActive.currentOperation = null;
        }
        const entry = {
            id: makeId(),
            kind: 'structured',
            originalOperation: next.action === 'cut' ? 'cut' : 'copy',
            currentOperation: next.action === 'cut' ? 'cut' : 'copy',
            cutState: next.action === 'cut' ? 'pending' : null,
            createdAt: now,
            updatedAt: now,
            data: next,
            summary: summarizeStructured(next)
        };
        const remote = await mutateInBackground('add-entry', { entry });
        if (remote) {
            selectedIds.clear();
            notify();
            return remote.activePayload || getActivePayload();
        }
        state.entries.unshift(entry);
        state.entries = state.entries.slice(0, state.limit);
        state.activeEntryId = entry.id;
        selectedIds.clear();
        await persist();
        notify();
        return getActivePayload();
    }

    async function addText(rawText) {
        await init();
        const value = String(rawText ?? '');
        if (!value.trim()) return null;
        const now = Date.now();
        const oldActive = getActiveEntry();
        if (oldActive && oldActive.currentOperation === 'cut' && oldActive.cutState === 'pending') {
            oldActive.cutState = 'superseded';
            oldActive.currentOperation = null;
        }
        const entry = {
            id: makeId(), kind: 'text', originalOperation: 'copy', currentOperation: 'copy', cutState: null,
            createdAt: now, updatedAt: now, data: { text: value },
            summary: { bookmarkCount: 0, folderCount: 0, previewItems: [], textPreview: value.trim() }
        };
        const remote = await mutateInBackground('add-entry', { entry });
        if (remote) {
            selectedIds.clear();
            notify();
            return remote.activePayload || getActivePayload();
        }
        state.entries.unshift(entry);
        state.entries = state.entries.slice(0, state.limit);
        state.activeEntryId = entry.id;
        selectedIds.clear();
        await persist();
        notify();
        return getActivePayload();
    }

    function getActivePayload() {
        const entry = getActiveEntry();
        if (!entry || !entry.currentOperation) return null;
        if (entry.kind === 'text') return { action: 'copy', source: 'text', text: entry.data && entry.data.text, entryId: entry.id };
        const payload = clone(entry.data || {});
        payload.action = entry.currentOperation;
        payload.entryId = entry.id;
        return payload;
    }

    async function consumeActiveCut() {
        await init();
        const entry = getActiveEntry();
        if (!entry || entry.currentOperation !== 'cut') return;
        entry.cutState = 'consumed';
        entry.currentOperation = null;
        entry.updatedAt = Date.now();
        state.activeEntryId = null;
        await persist();
        notify();
    }

    async function claimActiveStructuredForPaste() {
        await init();
        const remote = await mutateInBackground('claim-active-structured');
        if (remote) {
            notify();
            return remote.activePayload || null;
        }
        const payload = getActivePayload();
        if (!payload || payload.source === 'text') return null;
        return payload;
    }

    async function finishClaimedCut(entryId, consumed = true) {
        const id = String(entryId || '');
        if (!id) return false;
        const remote = await mutateInBackground('finish-claimed-cut', { entryId: id, consumed });
        if (remote) {
            notify();
            return remote.finished === true;
        }
        if (consumed) return consumeActiveCut();
        return false;
    }

    async function cancelActiveCut(entryId = null) {
        await init();
        if (!entryId) return false;
        const remote = await mutateInBackground('cancel-cut', { entryId });
        if (remote) {
            notify();
            return remote.cancelled === true;
        }
        const entry = getActiveEntry();
        if (!entry || entry.currentOperation !== 'cut') return false;
        entry.cutState = 'cancelled';
        entry.currentOperation = null;
        entry.updatedAt = Date.now();
        state.activeEntryId = null;
        await persist();
        notify();
        return true;
    }

    async function activateSelected() {
        await init();
        const selected = state.entries.filter((entry) => selectedIds.has(entry.id));
        if (!selected.length) return null;
        if (selected.some((entry) => entry.kind === 'text')) {
            if (selected.length !== 1 || selected[0].kind !== 'text') {
                showMixedSelectionToast();
                return null;
            }
            const value = String(selected[0].data && selected[0].data.text || '');
            try { await navigator.clipboard.writeText(value); } catch (_) {}
            const remote = await mutateInBackground('activate-text', { entryId: selected[0].id });
            if (remote) {
                selectedIds.clear();
                notify();
                return remote.activePayload || getActivePayload();
            }
            state.activeEntryId = selected[0].id;
            selected[0].currentOperation = 'copy';
            selected[0].updatedAt = Date.now();
            selectedIds.clear();
            await persist();
            notify();
            return getActivePayload();
        }
        const payload = [];
        selected.forEach((entry) => {
            if (entry.kind !== 'structured') return;
            const items = entry.data && Array.isArray(entry.data.payload) ? entry.data.payload : [];
            payload.push(...clone(items));
        });
        return addStructured({ action: 'copy', source: selected.length > 1 ? 'mixed' : (selected[0].data && selected[0].data.source) || 'mixed', payload, timestamp: Date.now() });
    }

    async function removeEntry(id) {
        await init();
        const remote = await mutateInBackground('remove-entry', { entryId: id });
        if (remote) {
            selectedIds.delete(id);
            notify();
            return;
        }
        state.entries = state.entries.filter((entry) => entry.id !== id);
        if (state.activeEntryId === id) state.activeEntryId = null;
        promoteLatestEntry();
        selectedIds.delete(id);
        await persist();
        notify();
    }

    async function clear() {
        await init();
        const remote = await mutateInBackground('clear');
        if (remote) {
            selectedIds.clear();
            notify();
            return;
        }
        state.entries = [];
        state.activeEntryId = null;
        selectedIds.clear();
        await persist();
        notify();
    }

    async function setLimit(value) {
        await init();
        const remote = await mutateInBackground('set-limit', { limit: value });
        if (remote) {
            notify();
            return;
        }
        state.limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Number.parseInt(value, 10) || DEFAULT_LIMIT));
        state.entries = state.entries.slice(0, state.limit);
        if (!state.entries.some((entry) => entry.id === state.activeEntryId)) state.activeEntryId = null;
        promoteLatestEntry();
        await persist();
        notify();
    }

    function getEntryPresentation(entry) {
        const summary = entry.summary || {};
        if (entry.kind === 'text') {
            return {
                preview: String(summary.textPreview || '').split(/\n/).filter(Boolean).slice(0, 2).join(' · '),
                counts: text('文本', 'Text'),
                items: []
            };
        }
        const items = [];
        const visit = (item) => {
            if (!item) return;
            const folder = !item.url && (item.type === 'folder' || Array.isArray(item.children));
            items.push({
                title: String(item.title || (folder ? text('文件夹', 'Folder') : text('书签', 'Bookmark'))),
                url: String(item.url || ''),
                folder
            });
            (item.children || []).forEach(visit);
        };
        ((entry.data && entry.data.payload) || []).forEach(visit);
        const preview = items.slice(0, 2).map((item) => item.title).join(' · ');
        const counts = [];
        if (summary.bookmarkCount) counts.push(`${summary.bookmarkCount} ${text('个书签', 'bookmarks')}`);
        if (summary.folderCount) counts.push(`${summary.folderCount} ${text('个文件夹', 'folders')}`);
        return { preview, counts: counts.join(' · ') || text('空内容', 'Empty'), items };
    }

    function getItemIconHtml(item, className = '') {
        const title = escapeHtml(item && item.title || '');
        if (item && item.folder) {
            return `<i class="canvas-clipboard-item-icon is-folder fas fa-folder ${className}" data-clipboard-item-title="${title}" aria-label="${title}"></i>`;
        }
        const url = String(item && item.url || '');
        let favicon = '';
        try {
            favicon = typeof global.getFaviconUrl === 'function' ? global.getFaviconUrl(url) : '';
        } catch (_) {}
        if (!favicon) {
            return `<i class="canvas-clipboard-item-icon is-bookmark-fallback fas fa-bookmark ${className}" data-clipboard-item-title="${title}" aria-label="${title}"></i>`;
        }
        return `<img class="canvas-clipboard-item-icon canvas-bookmark-icon ${className}" src="${escapeHtml(favicon)}" data-bookmark-url="${escapeHtml(url)}" data-clipboard-item-title="${title}" alt="">`;
    }

    function getTooltipContainer() {
        try {
            if (typeof global.getOverlayContainer === 'function') return global.getOverlayContainer();
        } catch (_) {}
        return document.body;
    }

    function hideItemTooltip() {
        if (!itemTooltip) return;
        itemTooltip.remove();
        itemTooltip = null;
    }

    function showItemTooltip(icon) {
        const label = String(icon && icon.dataset && icon.dataset.clipboardItemTitle || '').trim();
        if (!label || !icon || !icon.getBoundingClientRect) return;
        hideItemTooltip();
        const tooltip = document.createElement('div');
        tooltip.className = 'canvas-clipboard-item-tooltip';
        tooltip.textContent = label;
        tooltip.setAttribute('role', 'tooltip');
        tooltip.style.visibility = 'hidden';
        getTooltipContainer().appendChild(tooltip);
        const rect = icon.getBoundingClientRect();
        const width = tooltip.offsetWidth || 0;
        const height = tooltip.offsetHeight || 0;
        const margin = 8;
        const left = Math.max(margin + width / 2, Math.min(window.innerWidth - margin - width / 2, rect.left + rect.width / 2));
        const showBelow = rect.top - height - margin < margin;
        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(showBelow ? rect.bottom + margin : rect.top - margin)}px`;
        tooltip.classList.toggle('is-below', showBelow);
        tooltip.style.visibility = '';
        itemTooltip = tooltip;
    }

    function formatEntryTime(timestamp) {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (value) => String(value).padStart(2, '0');
        const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        if (isEn()) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
    }

    function refreshStaticText() {
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        const setLabel = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.title = value;
            el.setAttribute('aria-label', value);
        };
        setText('canvasClipboardModalTitle', text('剪贴板', 'Clipboard'));
        setText('canvasClipboardLimitLabel', text('最多保存', 'Keep up to'));
        setText('canvasClipboardLimitUnit', text('条', 'items'));
        setText('canvasClipboardSaveSettingsBtn', text('保存', 'Save'));
        setText('canvasClipboardCancelBtn', text('取消', 'Cancel'));
        setLabel('canvasClipboardSettingsBtn', text('剪贴板设置', 'Clipboard settings'));
        setLabel('canvasClipboardClearBtn', text('清空剪贴板', 'Clear clipboard'));
        setLabel('canvasClipboardModalClose', text('关闭', 'Close'));
    }

    function renderStructuredPreview(presentation) {
        const items = Array.isArray(presentation.items) ? presentation.items : [];
        if (!items.length) return escapeHtml(presentation.preview);
        if (items.length === 1) {
            return `<span class="canvas-clipboard-primary-item">${getItemIconHtml(items[0], 'is-primary')}<span class="canvas-clipboard-primary-title">${escapeHtml(items[0].title)}</span></span>`;
        }

        const previewIcons = items.slice(0, 25);
        return `<span class="canvas-clipboard-item-rail is-batch" aria-label="${escapeHtml(items.map((item) => item.title).join('、'))}">
            <span class="canvas-clipboard-item-rail-visible">${previewIcons.map((item) => getItemIconHtml(item)).join('')}</span>
            <span class="canvas-clipboard-item-ellipsis is-trailing">…</span>
        </span>`;
    }

    function render() {
        hideItemTooltip();
        const list = document.getElementById('canvasClipboardList');
        const apply = document.getElementById('canvasClipboardApplyBtn');
        const cancel = document.getElementById('canvasClipboardCancelBtn');
        if (!list || !apply || !cancel) return;
        const chosen = selectedIds.size;
        apply.hidden = chosen === 0;
        cancel.hidden = chosen === 0;
        apply.textContent = text('复制', 'Copy');
        apply.title = text(`复制 ${chosen} 条`, `Copy ${chosen} selected`);
        apply.setAttribute('aria-label', apply.title);
        if (!state.entries.length) {
            list.innerHTML = `<div class="canvas-clipboard-empty">${text('暂无剪贴板记录', 'No clipboard records yet')}</div>`;
            return;
        }
        list.innerHTML = state.entries.map((entry) => {
            const current = entry.id === state.activeEntryId && entry.currentOperation;
            const presentation = getEntryPresentation(entry);
            const singleStructured = entry.kind === 'structured' && Array.isArray(presentation.items) && presentation.items.length === 1;
            const selected = selectedIds.has(entry.id);
            return `<div class="canvas-clipboard-entry${current ? ' is-current' : ''}${selected ? ' is-selected' : ''}" data-clipboard-id="${entry.id}">
                <input class="canvas-clipboard-check" type="checkbox" data-clipboard-check="${entry.id}" ${selected ? 'checked' : ''} aria-label="${text('选择记录', 'Select record')}">
                <div class="canvas-clipboard-entry-main"><div class="canvas-clipboard-entry-meta"><time>${formatEntryTime(entry.createdAt)}</time></div><div class="canvas-clipboard-entry-summary"><span class="canvas-clipboard-entry-preview${singleStructured ? ' is-single-structured' : ''}">${entry.kind === 'structured' ? renderStructuredPreview(presentation) : escapeHtml(presentation.preview)}</span><span class="canvas-clipboard-entry-counts">${escapeHtml(presentation.counts)}</span></div>${current ? `<div class="canvas-clipboard-current-row"><span class="canvas-clipboard-current-badge">${text('当前', 'Current')}</span></div>` : ''}</div>
                <button class="canvas-clipboard-delete" type="button" data-clipboard-delete="${entry.id}" aria-label="${text('删除记录', 'Delete record')}" title="${text('删除', 'Delete')}"><i class="fas fa-trash-alt"></i></button>
            </div>`;
        }).join('');
    }

    function escapeHtml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function showMixedSelectionToast() {
        const message = text('文字与书签/文件夹记录不能同时选择。', 'Text and bookmark/folder records cannot be selected together.');
        try {
            if (typeof global.showCanvasToast === 'function') {
                global.showCanvasToast(message, 'warning');
                return;
            }
        } catch (_) {}
        try {
            if (typeof global.showToast === 'function') {
                global.showToast(message);
                return;
            }
        } catch (_) {}
    }

    function shouldCaptureTextCopy(event) {
        const target = event && event.target;
        if (!target || !target.closest) return false;
        return !!target.closest('.temp-canvas-node, .permanent-bookmark-section, .md-canvas-node, .canvas-description, .canvas-native-text');
    }

    function getCopiedCanvasText(event) {
        const target = event && event.target;
        if (target && typeof target.value === 'string' && Number.isInteger(target.selectionStart) && Number.isInteger(target.selectionEnd)) {
            return target.value.slice(target.selectionStart, target.selectionEnd);
        }
        return global.getSelection ? String(global.getSelection()) : '';
    }

    function toggleSelectedEntry(id) {
        const entry = state.entries.find((item) => item && item.id === id);
        if (!entry) return;
        if (selectedIds.has(id)) {
            selectedIds.delete(id);
            return;
        }
        const hasText = state.entries.some((item) => item && item.kind === 'text' && selectedIds.has(item.id));
        const hasStructured = state.entries.some((item) => item && item.kind === 'structured' && selectedIds.has(item.id));
        if ((entry.kind === 'text' && hasStructured) || (entry.kind === 'structured' && hasText)) {
            showMixedSelectionToast();
            return;
        }
        selectedIds.add(id);
    }

    function bindUi() {
        const modal = document.getElementById('canvasClipboardModal');
        if (!modal || modal.dataset.clipboardBound === 'true') return;
        modal.dataset.clipboardBound = 'true';
        document.getElementById('canvasClipboardModalClose')?.addEventListener('click', () => { hideItemTooltip(); modal.style.display = 'none'; });
        document.getElementById('canvasClipboardApplyBtn')?.addEventListener('click', async () => { await activateSelected(); });
        document.getElementById('canvasClipboardCancelBtn')?.addEventListener('click', () => { selectedIds.clear(); render(); });
        document.getElementById('canvasClipboardClearBtn')?.addEventListener('click', async () => { if (confirm(text('清空全部剪贴板记录？', 'Clear all clipboard records?'))) await clear(); });
        document.getElementById('canvasClipboardSettingsBtn')?.addEventListener('click', () => { const settings = document.getElementById('canvasClipboardSettings'); const input = document.getElementById('canvasClipboardLimitInput'); if (settings) settings.hidden = !settings.hidden; if (input) input.value = state.limit; });
        document.getElementById('canvasClipboardSaveSettingsBtn')?.addEventListener('click', async () => { const input = document.getElementById('canvasClipboardLimitInput'); await setLimit(input && input.value); const settings = document.getElementById('canvasClipboardSettings'); if (settings) settings.hidden = true; });
        modal.addEventListener('change', (event) => {
            const input = event.target;
            if (!input || !input.matches('[data-clipboard-check]')) return;
            const id = input.dataset.clipboardCheck;
            if (input.checked) toggleSelectedEntry(id); else selectedIds.delete(id);
            render();
        });
        modal.addEventListener('click', async (event) => {
            const target = event.target;
            const button = target && target.closest && target.closest('[data-clipboard-delete]');
            if (button) {
                await removeEntry(button.dataset.clipboardDelete);
                return;
            }
            if (target && target.closest && target.closest('[data-clipboard-check]')) return;
            const entry = target && target.closest && target.closest('.canvas-clipboard-entry[data-clipboard-id]');
            if (!entry || !modal.contains(entry)) return;
            const id = entry.dataset.clipboardId;
            if (!id) return;
            toggleSelectedEntry(id);
            render();
        });
        modal.addEventListener('pointerover', (event) => {
            const icon = event.target && event.target.closest && event.target.closest('.canvas-clipboard-item-icon[data-clipboard-item-title]');
            if (!icon || icon.contains(event.relatedTarget)) return;
            showItemTooltip(icon);
        });
        modal.addEventListener('pointerout', (event) => {
            const icon = event.target && event.target.closest && event.target.closest('.canvas-clipboard-item-icon[data-clipboard-item-title]');
            if (!icon || icon.contains(event.relatedTarget)) return;
            hideItemTooltip();
        });
        document.addEventListener('click', (event) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const clickedInsideModal = path.length ? path.includes(modal) : modal.contains(event.target);
            if (modal.style.display !== 'block' || clickedInsideModal) return;
            const isTrigger = event.target && event.target.closest && (
                event.target.closest('#settingsToggle') ||
                event.target.closest('#titleSettingsToggleBtn') ||
                event.target.closest('.settings-menu-item[data-action="open-canvas-clipboard"]')
            );
            if (!isTrigger) {
                hideItemTooltip();
                modal.style.display = 'none';
            }
        });
        document.addEventListener('copy', (event) => { if (!shouldCaptureTextCopy(event)) return; const selection = getCopiedCanvasText(event); if (selection.trim()) addText(selection); });
    }

    global.addEventListener('storage', (event) => { if (event.key === STORAGE_KEY) { init().then(() => { try { state = normalize(JSON.parse(event.newValue || '{}')); notify(); } catch (_) {} }); } });
    try {
        if (chrome && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[STORAGE_KEY]) { state = normalize(changes[STORAGE_KEY].newValue); initialized = true; notify(); } });
        }
    } catch (_) {}

    global.CanvasClipboard = {
        init, addStructured, addText, getActivePayload, consumeActiveCut, claimActiveStructuredForPaste, finishClaimedCut,
        cancelActiveCut, activateSelected, removeEntry, clear, setLimit,
        open() {
            const modal = document.getElementById('canvasClipboardModal');
            if (!modal) return;
            refreshStaticText();
            modal.style.display = 'block';
            render();
            // Reuse the shortcut modal's settings-anchor positioning so the
            // panel follows a top- or bottom-docked title bar.
            window.requestAnimationFrame(() => {
                if (typeof positionManageModalUnderSettingsBtn === 'function') {
                    positionManageModalUnderSettingsBtn(modal);
                }
            });
        },
        getState: () => clone(state),
        refreshLanguage() {
            refreshStaticText();
            render();
        }
    };
    document.addEventListener('DOMContentLoaded', () => { init().then(bindUi); });
})(window);
