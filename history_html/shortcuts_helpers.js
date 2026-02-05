// Helper to render current keyboard shortcuts in the secondary UI
function updateShortcutsDisplay() {
    const shortcutsContent = document.getElementById('shortcutsContent');
    const canvasShortcutsList = document.getElementById('canvasShortcutsList');
    const canvasHelpShortcutsList = document.getElementById('canvasHelpShortcutsList');
    if (!shortcutsContent && !canvasShortcutsList && !canvasHelpShortcutsList) return;

    const lang = typeof currentLang === 'string' ? currentLang : 'zh_CN';
    const platform = navigator.platform || '';
    const ua = navigator.userAgent || '';
    const isMac = /MAC/i.test(platform) || /MAC/i.test(ua);
    const isWindows = /WIN/i.test(platform) || /WINDOWS/i.test(ua);
    const isLinux = /LINUX/i.test(platform) && !/ANDROID/i.test(ua);

    const osLabel = (() => {
        if (isMac) return 'macOS';
        if (isWindows) return 'Windows';
        if (isLinux) return 'Linux';
        return 'Other';
    })();

    // 格式化快捷键显示（Mac上Alt显示为Option）
    const formatKey = (key) => {
        if (!key) {
            return i18n.shortcutsUnset?.[lang] || (lang === 'zh_CN' ? '未设置' : 'Not set');
        }
        let text = String(key);
        if (isMac) {
            text = text.replace(/Alt/gi, 'Option');
        }
        return text.replace(/\+/g, ' + ');
    };

    const renderShortcutsModal = (shortcuts) => {
        if (!shortcutsContent) return;
        const safe = (value, fallback) => (value && typeof value === 'string') ? value : fallback;
        const key1 = formatKey(safe(shortcuts._execute_action, ''));
        const key2 = formatKey(safe(shortcuts.open_side_panel, ''));
        const key3 = formatKey(safe(shortcuts.open_canvas_view, ''));

        const rows = [];
        rows.push({ key: key1, label: i18n.shortcutActivateExtension[lang] });
        rows.push({ key: key2, label: i18n.shortcutSidePanel[lang] });
        rows.push({ key: key3, label: i18n.shortcutCanvas[lang] });
        const titleText = `${i18n.shortcutsTitle[lang]} (${osLabel})`;
        shortcutsContent.innerHTML = `
            <div class="shortcuts-card">
                <div class="shortcuts-section">
                    <div class="shortcuts-header-row">
                        <div>${titleText}</div>
                        <button class="shortcuts-settings-btn open-shortcuts-settings-btn"
                            title="${i18n.shortcutsSettingsTooltip[lang]}">
                            <i class="fas fa-external-link-alt"></i>
                        </button>
                    </div>
                    <div class="shortcuts-columns-header">
                        <span class="shortcuts-key-header">${i18n.shortcutsTableHeaderKey[lang]}</span>
                        <span class="shortcuts-action-header">${i18n.shortcutsTableHeaderAction[lang]}</span>
                    </div>
                    <div class="shortcuts-list">
                        ${rows.map(row => `
                            <div class="shortcuts-row">
                                <div class="shortcuts-key"><kbd>${row.key}</kbd></div>
                                <div class="shortcuts-action">${row.label}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    };

    const renderCanvasShortcuts = (container, shortcuts) => {
        if (!container) return;
        const safe = (value, fallback) => (value && typeof value === 'string') ? value : fallback;
        const key1 = formatKey(safe(shortcuts._execute_action, ''));
        const key2 = formatKey(safe(shortcuts.open_side_panel, ''));
        const key3 = formatKey(safe(shortcuts.open_canvas_view, ''));

        const rows = [];
        rows.push({ key: key1, label: i18n.shortcutActivateExtension[lang] });
        rows.push({ key: key2, label: i18n.shortcutSidePanel[lang] });
        rows.push({ key: key3, label: i18n.shortcutCanvas[lang] });

        container.innerHTML = `
            <div class="canvas-help-section-header canvas-shortcuts-open-header">
                <div class="canvas-help-section-header-left">
                    <span class="canvas-help-section-title">${i18n.shortcutsOpenTitle[lang]} (${osLabel})</span>
                </div>
                <button class="canvas-shortcuts-jump-btn open-shortcuts-settings-btn"
                    title="${i18n.shortcutsSettingsTooltip[lang]}">
                    <i class="fas fa-external-link-alt"></i>
                    <span>${i18n.shortcutsSettingsButton[lang]}</span>
                </button>
            </div>
            <div class="canvas-shortcuts-available-list">
                ${rows.map((row) => `
                    <div class="canvas-help-row canvas-shortcuts-row">
                        <span class="canvas-help-key"><kbd class="canvas-shortcut-key">${row.key}</kbd></span>
                        <span class="canvas-help-desc">${row.label}</span>
                    </div>
                `).join('')}
            </div>
        `;
    };

    const bindOpenSettings = (container) => {
        if (!container || !(browserAPI && browserAPI.tabs)) return;
        container.querySelectorAll('.open-shortcuts-settings-btn').forEach((openBtn) => {
            openBtn.addEventListener('click', () => {
                try {
                    const ua = navigator.userAgent || '';
                    const isEdge = ua.includes('Edg/');
                    const url = isEdge
                        ? 'edge://extensions/shortcuts'
                        : 'chrome://extensions/shortcuts';
                    browserAPI.tabs.create({ url });
                } catch (e) {
                    console.warn('[Shortcuts] 打开浏览器快捷键设置页面失败:', e);
                }
            });
        });
    };

    if (browserAPI && browserAPI.commands && browserAPI.commands.getAll) {
        try {
            browserAPI.commands.getAll((commands) => {
                const map = {};
                if (Array.isArray(commands)) {
                    commands.forEach((c) => {
                        if (!c || !c.name) return;
                        if (typeof c.shortcut === 'string') {
                            map[c.name] = c.shortcut;
                        }
                    });
                }
                renderShortcutsModal({
                    _execute_action: map._execute_action,
                    open_side_panel: map.open_side_panel,
                    open_canvas_view: map.open_canvas_view
                });
                renderCanvasShortcuts(canvasShortcutsList, {
                    _execute_action: map._execute_action,
                    open_side_panel: map.open_side_panel,
                    open_canvas_view: map.open_canvas_view
                });
                renderCanvasShortcuts(canvasHelpShortcutsList, {
                    _execute_action: map._execute_action,
                    open_side_panel: map.open_side_panel,
                    open_canvas_view: map.open_canvas_view
                });
                bindOpenSettings(shortcutsContent);
                bindOpenSettings(canvasShortcutsList);
                bindOpenSettings(canvasHelpShortcutsList);
            });
        } catch (e) {
            console.warn('[Shortcuts] 读取快捷键失败，显示未设置:', e);
            renderShortcutsModal({});
            renderCanvasShortcuts(canvasShortcutsList, {});
            renderCanvasShortcuts(canvasHelpShortcutsList, {});
            bindOpenSettings(shortcutsContent);
            bindOpenSettings(canvasShortcutsList);
            bindOpenSettings(canvasHelpShortcutsList);
        }
    } else {
        renderShortcutsModal({});
        renderCanvasShortcuts(canvasShortcutsList, {});
        renderCanvasShortcuts(canvasHelpShortcutsList, {});
        bindOpenSettings(shortcutsContent);
        bindOpenSettings(canvasShortcutsList);
        bindOpenSettings(canvasHelpShortcutsList);
    }
}
