const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome :
  (typeof browser !== 'undefined' ? browser : null);

async function safeCreateTab({ url }) {
  if (browserAPI && browserAPI.tabs && browserAPI.tabs.create) {
    return browserAPI.tabs.create({ url });
  }
  window.open(url, '_blank');
}

function updateCanvasHintText(lang, shortcut) {
  const hint = document.getElementById('canvasHint');
  if (!hint) return;
  const isEN = lang === 'en';
  hint.textContent = isEN
    ? `Click to open Canvas (${shortcut})`
    : `点击进入画布（快捷键 ${shortcut}）`;
}

function initializeBookmarkCanvasPopup() {
  const canvasContainer = document.getElementById('bookmarkCanvas');
  const canvasThumbnailContainer = document.getElementById('canvasThumbnail');
  const titleEl = document.getElementById('bookmarkCanvasTitle');

  if (!canvasContainer || !canvasThumbnailContainer) return;

  canvasContainer.addEventListener('click', async () => {
    try {
      const url = browserAPI.runtime.getURL('history_html/history.html?view=canvas');
      await safeCreateTab({ url });
    } catch (e) {
      console.warn('[Canvas Popup] Failed to open canvas view:', e);
    }
  });

  browserAPI.storage.local.get(['bookmarkCanvasThumbnail', 'preferredLang'], (data) => {
    const thumbnail = data.bookmarkCanvasThumbnail;
    const lang = data.preferredLang || 'zh_CN';
    const isEN = lang === 'en';
    if (titleEl) {
      titleEl.textContent = isEN ? 'Bookmark Canvas' : '书签画布';
    }

    canvasThumbnailContainer.innerHTML = '';
    if (thumbnail && typeof thumbnail === 'string') {
      const img = document.createElement('img');
      img.src = thumbnail;
      img.alt = 'Canvas Thumbnail';
      canvasThumbnailContainer.appendChild(img);
    } else {
      const wrapper = document.createElement('div');
      wrapper.textContent = isEN ? 'No thumbnail yet' : '暂无缩略图';
      canvasThumbnailContainer.appendChild(wrapper);
    }

    const fallbackShortcut = 'Alt+3';
    if (browserAPI.commands && browserAPI.commands.getAll) {
      try {
        browserAPI.commands.getAll((commands) => {
          let shortcut = fallbackShortcut;
          if (Array.isArray(commands)) {
            const cmd = commands.find(c => c.name === 'open_canvas_view');
            if (cmd && cmd.shortcut) shortcut = cmd.shortcut;
          }
          updateCanvasHintText(lang, shortcut);
        });
      } catch (_) {
        updateCanvasHintText(lang, fallbackShortcut);
      }
    } else {
      updateCanvasHintText(lang, fallbackShortcut);
    }
  });

  if (browserAPI.storage && browserAPI.storage.onChanged) {
    browserAPI.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.bookmarkCanvasThumbnail) {
        const value = changes.bookmarkCanvasThumbnail.newValue;
        canvasThumbnailContainer.innerHTML = '';
        if (value && typeof value === 'string') {
          const img = document.createElement('img');
          img.src = value;
          img.alt = 'Canvas Thumbnail';
          canvasThumbnailContainer.appendChild(img);
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initializeBookmarkCanvasPopup);
