const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome :
  (typeof browser !== 'undefined' ? browser : null);

const popupI18n = {
  zh_CN: {
    pageTitle: '书签画布',
    canvasHintAction: '点击进入画布',
    canvasHintShortcut: (shortcut) => `快捷键 ${shortcut}`,
    loading: '加载中...',
    noThumbnail: '暂无缩略图',
    openSourceInfo: '开源信息',
    openSourceTitle: '开源信息',
    openSourceGithubLabel: 'GitHub 仓库:',
    openSourceIssueLabel: '问题反馈:',
    openSourceIssueText: '提交问题',
    sidePanelOpen: '打开侧边栏',
    shortcutsTitle: '快捷键',
    shortcutsActivateExtension: '打开主 UI（Activate the extension）',
    shortcutsOpenSidePanel: '打开侧边栏',
    shortcutsOpenCanvas: '打开画布',
    shortcutsSettings: '在浏览器中管理快捷键',
    shortcutsUnset: '未设置'
  },
  en: {
    pageTitle: 'Bookmark Canvas',
    canvasHintAction: 'Click to open Canvas',
    canvasHintShortcut: (shortcut) => `Shortcut ${shortcut}`,
    loading: 'Loading...',
    noThumbnail: 'No thumbnail yet',
    openSourceInfo: 'Open source',
    openSourceTitle: 'Open source',
    openSourceGithubLabel: 'GitHub repo:',
    openSourceIssueLabel: 'Issue tracker:',
    openSourceIssueText: 'Report issue',
    sidePanelOpen: 'Open side panel',
    shortcutsTitle: 'Shortcuts',
    shortcutsActivateExtension: 'Activate the extension',
    shortcutsOpenSidePanel: 'Open side panel',
    shortcutsOpenCanvas: 'Open canvas',
    shortcutsSettings: 'Manage shortcuts in browser',
    shortcutsUnset: 'Not set'
  }
};

let currentLang = 'en';
let currentCanvasShortcut = '';
let currentShortcuts = {
  _execute_action: '',
  open_side_panel: '',
  open_canvas_view: ''
};

const osInfo = (() => {
  const platform = navigator.platform || '';
  const ua = navigator.userAgent || '';
  const isMac = /Mac/i.test(platform) || /Mac/i.test(ua);
  const isWindows = /Win/i.test(platform) || /Windows/i.test(ua);
  const isLinux = /Linux/i.test(platform) && !/Android/i.test(ua);
  return { isMac, isWindows, isLinux };
})();

function getOsLabel() {
  if (osInfo.isMac) return 'macOS';
  if (osInfo.isWindows) return 'Windows';
  if (osInfo.isLinux) return 'Linux';
  return 'Other';
}

function formatShortcutDisplay(value, lang) {
  const strings = getLangStrings(lang);
  if (!value || typeof value !== 'string') {
    return strings.shortcutsUnset;
  }
  let text = value;
  if (osInfo.isMac) {
    text = text.replace(/Alt/gi, 'Option');
  }
  text = text.replace(/\+/g, ' + ');
  return text || strings.shortcutsUnset;
}

function detectDefaultLang() {
  try {
    const ui = (browserAPI?.i18n?.getUILanguage?.() || '').toLowerCase();
    return ui.startsWith('zh') ? 'zh_CN' : 'en';
  } catch (_) {}
  return 'en';
}

async function safeCreateTab({ url }) {
  if (browserAPI && browserAPI.tabs && browserAPI.tabs.create) {
    return browserAPI.tabs.create({ url });
  }
  window.open(url, '_blank');
}

async function focusOrCreateCanvasTabInCurrentWindow() {
  const canvasUrlBase = browserAPI?.runtime?.getURL
    ? browserAPI.runtime.getURL('history_html/history.html')
    : null;
  if (!canvasUrlBase) {
    window.open('history_html/history.html?view=canvas', '_blank');
    return;
  }

  try {
    const win = await new Promise((resolve) => {
      if (!browserAPI?.windows?.getCurrent) return resolve(null);
      browserAPI.windows.getCurrent((w) => resolve(w || null));
    });
    const windowId = win && typeof win.id === 'number' ? win.id : null;

    const tabs = await new Promise((resolve) => {
      if (!browserAPI?.tabs?.query || windowId == null) return resolve([]);
      browserAPI.tabs.query({ windowId }, (list) => resolve(Array.isArray(list) ? list : []));
    });

    const existing = tabs.find(t => t && typeof t.url === 'string' && t.url.startsWith(canvasUrlBase));
    if (existing && typeof existing.id === 'number') {
      await new Promise((resolve) => {
        browserAPI.tabs.update(existing.id, { active: true }, () => resolve());
      });
      // Keep behavior window-local: only focus the current window.
      if (windowId != null && browserAPI?.windows?.update) {
        browserAPI.windows.update(windowId, { focused: true }, () => {});
      }
      return;
    }

    await new Promise((resolve) => {
      browserAPI.tabs.create({ url: `${canvasUrlBase}?view=canvas`, active: true, windowId: windowId ?? undefined }, () => resolve());
    });
  } catch (_) {
    // Fallback: create a new tab
    await safeCreateTab({ url: `${canvasUrlBase}?view=canvas` });
  }
}

function getLangStrings(lang) {
  return popupI18n[lang] || popupI18n.zh_CN;
}

function setPreferredLang(lang) {
  currentLang = lang;
  try {
    localStorage.setItem('preferredLang', lang);
  } catch (_) {}
  if (browserAPI?.storage?.local) {
    browserAPI.storage.local.set({ preferredLang: lang }, () => {});
  }
}

function loadPreferredLang() {
  return new Promise((resolve) => {
    if (!browserAPI?.storage?.local) {
      resolve(detectDefaultLang());
      return;
    }
    browserAPI.storage.local.get(['preferredLang'], (data) => {
      resolve(data.preferredLang || detectDefaultLang());
    });
  });
}

function updateCanvasHintText(lang, shortcut) {
  const hint = document.getElementById('canvasHint');
  if (!hint) return;
  const strings = getLangStrings(lang);
  const displayShortcut = formatShortcutDisplay(shortcut, lang);
  const shortcutText = (typeof strings.canvasHintShortcut === 'function')
    ? strings.canvasHintShortcut(displayShortcut)
    : `Shortcut ${displayShortcut}`;
  const actionText = strings.canvasHintAction || 'Click to open Canvas';
  hint.innerHTML = `
    <div class="canvas-hint-content" aria-hidden="true">
      <div class="canvas-hint-shortcut">${shortcutText}</div>
      <div class="canvas-hint-action">${actionText}</div>
    </div>
  `;
}

function updateOpenSourceText(lang) {
  const strings = getLangStrings(lang);
  const openSourceTooltip = document.getElementById('openSourceTooltip');
  if (openSourceTooltip) openSourceTooltip.textContent = strings.openSourceInfo;
  const openSourceTitle = document.getElementById('openSourceInfoTitle');
  if (openSourceTitle) openSourceTitle.textContent = strings.openSourceTitle;
  const openSourceGithubLabel = document.getElementById('openSourceGithubLabel');
  if (openSourceGithubLabel) openSourceGithubLabel.textContent = strings.openSourceGithubLabel;
  const openSourceIssueLabel = document.getElementById('openSourceIssueLabel');
  if (openSourceIssueLabel) openSourceIssueLabel.textContent = strings.openSourceIssueLabel;
  const openSourceIssueText = document.getElementById('openSourceIssueText');
  if (openSourceIssueText) openSourceIssueText.textContent = strings.openSourceIssueText;
}

function updateSidePanelText(lang) {
  const strings = getLangStrings(lang);
  const tooltip = document.getElementById('sidePanelTooltip');
  if (tooltip) tooltip.textContent = strings.sidePanelOpen;
  const btn = document.getElementById('openSidePanelBtn');
  if (btn) btn.setAttribute('aria-label', strings.sidePanelOpen);
}

function renderShortcutsList(lang, shortcuts) {
  const list = document.getElementById('shortcutsList');
  const title = document.getElementById('shortcutsTitle');
  const settingsBtn = document.getElementById('openShortcutsSettingsBtn');
  const strings = getLangStrings(lang);
  if (title) title.textContent = `${strings.shortcutsTitle} (${getOsLabel()})`;
  if (settingsBtn) settingsBtn.textContent = strings.shortcutsSettings;
  if (!list) return;
  list.innerHTML = '';
  const map = shortcuts && typeof shortcuts === 'object' ? shortcuts : {};
  const rows = [
    { label: strings.shortcutsActivateExtension, key: map._execute_action },
    { label: strings.shortcutsOpenSidePanel, key: map.open_side_panel },
    { label: strings.shortcutsOpenCanvas, key: map.open_canvas_view }
  ];
  rows.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'shortcuts-row';
    const label = document.createElement('span');
    label.textContent = item.label;
    const key = document.createElement('kbd');
    key.textContent = formatShortcutDisplay(item.key, lang);
    row.appendChild(label);
    row.appendChild(key);
    list.appendChild(row);
  });
}

function getCommandShortcuts() {
  const fallbackShortcuts = {
    _execute_action: '',
    open_side_panel: '',
    open_canvas_view: ''
  };
  if (!browserAPI?.commands?.getAll) {
    return Promise.resolve({ ...fallbackShortcuts });
  }
  return new Promise((resolve) => {
    try {
      browserAPI.commands.getAll((commands) => {
        const shortcutMap = { ...fallbackShortcuts };
        if (Array.isArray(commands)) {
          commands.forEach((cmd) => {
            if (!cmd || !cmd.name) return;
            if (typeof cmd.shortcut === 'string') {
              shortcutMap[cmd.name] = cmd.shortcut;
            }
          });
        }
        resolve(shortcutMap);
      });
    } catch (_) {
      resolve({ ...fallbackShortcuts });
    }
  });
}

function setupOpenSourceDialog() {
  const openSourceInfoBtn = document.getElementById('openSourceInfoBtn');
  const openSourceInfoDialog = document.getElementById('openSourceInfoDialog');
  const closeOpenSourceDialog = document.getElementById('closeOpenSourceDialog');
  const openSourceTooltip = document.getElementById('openSourceTooltip');
  if (!openSourceInfoBtn || !openSourceInfoDialog || !closeOpenSourceDialog) return;

  openSourceInfoBtn.addEventListener('click', () => {
    openSourceInfoDialog.style.display = 'block';
    openSourceInfoDialog.setAttribute('aria-hidden', 'false');
  });

  closeOpenSourceDialog.addEventListener('click', () => {
    openSourceInfoDialog.style.display = 'none';
    openSourceInfoDialog.setAttribute('aria-hidden', 'true');
  });

  openSourceInfoDialog.addEventListener('click', (e) => {
    if (e.target === openSourceInfoDialog) {
      openSourceInfoDialog.style.display = 'none';
      openSourceInfoDialog.setAttribute('aria-hidden', 'true');
    }
  });

  if (openSourceTooltip) {
    openSourceInfoBtn.addEventListener('mouseenter', () => {
      openSourceTooltip.style.visibility = 'visible';
      openSourceTooltip.style.opacity = '1';
    });
    openSourceInfoBtn.addEventListener('mouseleave', () => {
      openSourceTooltip.style.visibility = 'hidden';
      openSourceTooltip.style.opacity = '0';
    });
  }
}

function setupShortcutsSettingsButton() {
  const btn = document.getElementById('openShortcutsSettingsBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    try {
      const ua = navigator.userAgent || '';
      const url = ua.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
      safeCreateTab({ url });
    } catch (_) {}
  });
}

function setupSidePanelButton() {
  const btn = document.getElementById('openSidePanelBtn');
  const tooltip = document.getElementById('sidePanelTooltip');
  if (!btn) return;

  if (tooltip) {
    btn.addEventListener('mouseenter', () => {
      tooltip.style.visibility = 'visible';
      tooltip.style.opacity = '1';
    });
    btn.addEventListener('mouseleave', () => {
      tooltip.style.visibility = 'hidden';
      tooltip.style.opacity = '0';
    });
  }

  const hasSidePanel = !!browserAPI?.sidePanel?.open;
  if (!hasSidePanel) {
    btn.style.opacity = '0.65';
  }

  btn.addEventListener('click', async () => {
    if (browserAPI?.sidePanel?.open) {
      try {
        const win = await new Promise((resolve) => {
          if (!browserAPI?.windows?.getCurrent) return resolve(null);
          browserAPI.windows.getCurrent((w) => resolve(w || null));
        });
        const windowId = win && typeof win.id === 'number' ? win.id : undefined;
        if (windowId != null) {
          browserAPI.sidePanel.open({ windowId }, () => {});
        } else {
          browserAPI.sidePanel.open({}, () => {});
        }
        return;
      } catch (_) {}
    }
    // Fallback: open canvas in a normal tab
    try {
      await focusOrCreateCanvasTabInCurrentWindow();
    } catch (_) {}
  });
}

function setupLanguageToggle() {
  const langToggleButton = document.getElementById('lang-toggle-btn');
  if (!langToggleButton) return;
  langToggleButton.addEventListener('click', () => {
    const nextLang = currentLang === 'zh_CN' ? 'en' : 'zh_CN';
    setPreferredLang(nextLang);
    applyLanguage(nextLang);
  });
}

function applyLanguage(lang) {
  currentLang = lang;
  const strings = getLangStrings(lang);
  const pageTitleElement = document.getElementById('pageTitleElement');
  if (pageTitleElement) pageTitleElement.textContent = strings.pageTitle;
  const canvasThumbnailContainer = document.getElementById('canvasThumbnail');
  // Do not overwrite the thumbnail container via textContent; it would remove the shortcut hint overlay.
  // Instead, update/ensure the placeholder element.
  if (canvasThumbnailContainer && !canvasThumbnailContainer.querySelector('img')) {
    let placeholder = canvasThumbnailContainer.querySelector('.canvas-thumbnail-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'canvas-thumbnail-placeholder';
      canvasThumbnailContainer.prepend(placeholder);
    }
    placeholder.textContent = strings.noThumbnail;
  }
  updateCanvasHintText(lang, currentCanvasShortcut);
  updateOpenSourceText(lang);
  updateSidePanelText(lang);
  renderShortcutsList(lang, currentShortcuts);
}

function initializeBookmarkCanvasPopup() {
  const canvasContainer = document.getElementById('bookmarkCanvas');
  const canvasThumbnailContainer = document.getElementById('canvasThumbnail');

  if (!canvasContainer || !canvasThumbnailContainer) return;

  canvasContainer.addEventListener('click', async () => {
    try {
      await focusOrCreateCanvasTabInCurrentWindow();
    } catch (e) {
      console.warn('[Canvas Popup] Failed to open canvas view:', e);
    }
  });

  setupOpenSourceDialog();
  setupShortcutsSettingsButton();
  setupSidePanelButton();
  setupLanguageToggle();

  loadPreferredLang().then(async (lang) => {
    currentLang = lang || 'zh_CN';
    currentShortcuts = await getCommandShortcuts();
    currentCanvasShortcut = currentShortcuts.open_canvas_view || '';
    applyLanguage(currentLang);
  });

  browserAPI.storage.local.get(['bookmarkCanvasThumbnail', 'preferredLang'], (data) => {
    const thumbnail = data.bookmarkCanvasThumbnail;
    const lang = data.preferredLang || currentLang || 'zh_CN';
    const strings = getLangStrings(lang);
    const hint = document.getElementById('canvasHint');
    if (hint) hint.remove();
    canvasThumbnailContainer.innerHTML = '';
    if (thumbnail && typeof thumbnail === 'string') {
      // Clear placeholder if any
      const img = document.createElement('img');
      img.src = thumbnail;
      img.alt = 'Canvas Thumbnail';
      canvasThumbnailContainer.appendChild(img);
      if (hint) {
        hint.style.display = 'none';
        canvasThumbnailContainer.appendChild(hint);
      }
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'canvas-thumbnail-placeholder';
      placeholder.textContent = strings.noThumbnail;
      canvasThumbnailContainer.appendChild(placeholder);
      if (hint) {
        hint.style.display = '';
        updateCanvasHintText(lang, currentCanvasShortcut);
        canvasThumbnailContainer.appendChild(hint);
      }
    }
  });

  if (browserAPI.storage && browserAPI.storage.onChanged) {
    browserAPI.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.bookmarkCanvasThumbnail) {
        const value = changes.bookmarkCanvasThumbnail.newValue;
        const hint = document.getElementById('canvasHint');
        if (hint) hint.remove();
        canvasThumbnailContainer.innerHTML = '';
        if (value && typeof value === 'string') {
          const img = document.createElement('img');
          img.src = value;
          img.alt = 'Canvas Thumbnail';
          canvasThumbnailContainer.appendChild(img);
          if (hint) hint.style.display = 'none';
        } else {
          const wrapper = document.createElement('div');
          wrapper.textContent = getLangStrings(currentLang).noThumbnail;
          canvasThumbnailContainer.appendChild(wrapper);
          if (hint) {
            hint.style.display = '';
            updateCanvasHintText(currentLang, currentCanvasShortcut);
          }
        }
        if (hint) canvasThumbnailContainer.appendChild(hint);
      }
      if (changes.preferredLang) {
        const nextLang = changes.preferredLang.newValue || 'zh_CN';
        applyLanguage(nextLang);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initializeBookmarkCanvasPopup);
