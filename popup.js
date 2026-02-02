const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome :
  (typeof browser !== 'undefined' ? browser : null);

const popupI18n = {
  zh_CN: {
    pageTitle: '书签画布',
    canvasHint: (shortcut) => `点击进入画布（快捷键 ${shortcut}）`,
    loading: '加载中...',
    noThumbnail: '暂无缩略图',
    openSourceInfo: '开源信息',
    openSourceTitle: '开源信息',
    openSourceGithubLabel: 'GitHub 仓库:',
    openSourceIssueLabel: '问题反馈:',
    openSourceIssueText: '提交问题',
    shortcutsTitle: '快捷键',
    shortcutsOpenCanvas: '打开画布',
    shortcutsSettings: '在浏览器中管理快捷键'
  },
  en: {
    pageTitle: 'Bookmark Canvas',
    canvasHint: (shortcut) => `Click to open Canvas (${shortcut})`,
    loading: 'Loading...',
    noThumbnail: 'No thumbnail yet',
    openSourceInfo: 'Open source',
    openSourceTitle: 'Open source',
    openSourceGithubLabel: 'GitHub repo:',
    openSourceIssueLabel: 'Issue tracker:',
    openSourceIssueText: 'Report issue',
    shortcutsTitle: 'Shortcuts',
    shortcutsOpenCanvas: 'Open canvas',
    shortcutsSettings: 'Manage shortcuts in browser'
  }
};

let currentLang = 'zh_CN';
let currentShortcut = 'Alt+3';

async function safeCreateTab({ url }) {
  if (browserAPI && browserAPI.tabs && browserAPI.tabs.create) {
    return browserAPI.tabs.create({ url });
  }
  window.open(url, '_blank');
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
      resolve('zh_CN');
      return;
    }
    browserAPI.storage.local.get(['preferredLang'], (data) => {
      resolve(data.preferredLang || 'zh_CN');
    });
  });
}

function updateCanvasHintText(lang, shortcut) {
  const hint = document.getElementById('canvasHint');
  if (!hint) return;
  const strings = getLangStrings(lang);
  hint.textContent = strings.canvasHint(shortcut);
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

function renderShortcutsList(lang, shortcut) {
  const list = document.getElementById('shortcutsList');
  const title = document.getElementById('shortcutsTitle');
  const settingsBtn = document.getElementById('openShortcutsSettingsBtn');
  if (title) title.textContent = getLangStrings(lang).shortcutsTitle;
  if (settingsBtn) settingsBtn.textContent = getLangStrings(lang).shortcutsSettings;
  if (!list) return;
  list.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'shortcuts-row';
  const label = document.createElement('span');
  label.textContent = getLangStrings(lang).shortcutsOpenCanvas;
  const key = document.createElement('kbd');
  key.textContent = shortcut;
  row.appendChild(label);
  row.appendChild(key);
  list.appendChild(row);
}

function getCanvasShortcut() {
  const fallbackShortcut = 'Alt+3';
  if (!browserAPI?.commands?.getAll) {
    return Promise.resolve(fallbackShortcut);
  }
  return new Promise((resolve) => {
    try {
      browserAPI.commands.getAll((commands) => {
        let shortcut = fallbackShortcut;
        if (Array.isArray(commands)) {
          const cmd = commands.find(c => c.name === 'open_canvas_view');
          if (cmd && cmd.shortcut) shortcut = cmd.shortcut;
        }
        resolve(shortcut);
      });
    } catch (_) {
      resolve(fallbackShortcut);
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
  if (canvasThumbnailContainer && !canvasThumbnailContainer.querySelector('img')) {
    canvasThumbnailContainer.textContent = strings.noThumbnail;
  }
  updateCanvasHintText(lang, currentShortcut);
  updateOpenSourceText(lang);
  renderShortcutsList(lang, currentShortcut);
}

function initializeBookmarkCanvasPopup() {
  const canvasContainer = document.getElementById('bookmarkCanvas');
  const canvasThumbnailContainer = document.getElementById('canvasThumbnail');

  if (!canvasContainer || !canvasThumbnailContainer) return;

  canvasContainer.addEventListener('click', async () => {
    try {
      const url = browserAPI.runtime.getURL('history_html/history.html?view=canvas');
      await safeCreateTab({ url });
    } catch (e) {
      console.warn('[Canvas Popup] Failed to open canvas view:', e);
    }
  });

  setupOpenSourceDialog();
  setupShortcutsSettingsButton();
  setupLanguageToggle();

  loadPreferredLang().then(async (lang) => {
    currentLang = lang || 'zh_CN';
    currentShortcut = await getCanvasShortcut();
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
      const img = document.createElement('img');
      img.src = thumbnail;
      img.alt = 'Canvas Thumbnail';
      canvasThumbnailContainer.appendChild(img);
      if (hint) {
        hint.style.display = 'none';
        canvasThumbnailContainer.appendChild(hint);
      }
    } else {
      const wrapper = document.createElement('div');
      wrapper.textContent = strings.noThumbnail;
      canvasThumbnailContainer.appendChild(wrapper);
      if (hint) {
        hint.style.display = '';
        updateCanvasHintText(lang, currentShortcut);
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
            updateCanvasHintText(currentLang, currentShortcut);
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
