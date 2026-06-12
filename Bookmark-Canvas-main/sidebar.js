const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome
  : (typeof browser !== 'undefined' ? browser : null);

const STORAGE_KEY = 'canvas_sidebar_mode_v1';
const MODE_COPY = {
  permanent: '永久栏目及其副本：用于固定书签树与副本视图。',
  temporary: '临时栏目：用于临时整理、拖入或搜索得到的卡片。',
  blank: '空白栏目：用于自由画布或非书签内容的占位。'
};

const segments = Array.from(document.querySelectorAll('.segment'));
const modeDescription = document.getElementById('modeDescription');
const sidePanelStatus = document.getElementById('sidePanelStatus');
const openCanvasTabBtn = document.getElementById('openCanvasTab');
const reloadPanelBtn = document.getElementById('openSidePanelPage');

function getDefaultMode() {
  return 'permanent';
}

function updateStatus() {
  if (!sidePanelStatus) return;
  if (browserAPI?.sidePanel) {
    sidePanelStatus.textContent = '可用';
  } else {
    sidePanelStatus.textContent = '不可用';
  }
}

function applyMode(mode) {
  const current = MODE_COPY[mode] ? mode : getDefaultMode();
  segments.forEach((button) => {
    const isActive = button.dataset.mode === current;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (modeDescription) {
    modeDescription.textContent = MODE_COPY[current] || '';
  }
  return current;
}

function persistMode(mode) {
  if (browserAPI?.storage?.local) {
    browserAPI.storage.local.set({ [STORAGE_KEY]: mode }, () => {});
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (_) {}
}

function loadMode() {
  return new Promise((resolve) => {
    if (browserAPI?.storage?.local) {
      browserAPI.storage.local.get([STORAGE_KEY], (data) => {
        resolve(data && data[STORAGE_KEY]);
      });
      return;
    }
    try {
      resolve(localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      resolve(null);
    }
  });
}

async function initMode() {
  const stored = await loadMode();
  const current = applyMode(stored || getDefaultMode());
  if (!stored) {
    persistMode(current);
  }
}

segments.forEach((button) => {
  button.addEventListener('click', () => {
    const nextMode = button.dataset.mode || getDefaultMode();
    const current = applyMode(nextMode);
    persistMode(current);
  });
});

if (openCanvasTabBtn) {
  openCanvasTabBtn.addEventListener('click', () => {
    const url = browserAPI?.runtime?.getURL
      ? browserAPI.runtime.getURL('history_html/history.html?view=canvas')
      : 'history_html/history.html?view=canvas';
    if (browserAPI?.tabs?.create) {
      browserAPI.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  });
}

if (reloadPanelBtn) {
  reloadPanelBtn.addEventListener('click', () => {
    const url = browserAPI?.runtime?.getURL
      ? browserAPI.runtime.getURL('sidebar.html')
      : 'sidebar.html';
    window.location.href = url;
  });
}

updateStatus();
initMode();
