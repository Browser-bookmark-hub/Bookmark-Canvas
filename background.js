// Minimal background for Bookmark Canvas extension (MV3)

import { applyRepoFilesBatch, deleteRepoFile, getRepoBlobBySha, getRepoBranchHeadSignal, getRepoFile, listRepoFiles, testRepoConnection, upsertRepoFile } from './github/repo-api.js';

const browserAPI = (function () {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  throw new Error('Unsupported browser');
})();

const CANVAS_GIT_SYNC_BG_STATE_KEY = 'canvas-obsidian-git-sync-background-state-v1';
const CANVAS_GIT_SYNC_RECOVERY_KEY = 'canvas-obsidian-git-sync-recovery-v1';
const CANVAS_GIT_SYNC_RECOVERY_KEEP_LATEST = 1;
const CANVAS_GIT_SYNC_RECOVERY_REASON_IDLE = 'idle-periodic-backup';
const CANVAS_GIT_SYNC_RECOVERY_REASON_MANUAL = 'manual-backup';
const CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT = {
  enabled: false,
  obsidianExportRoot: '书签画布'
};

const DEFAULT_CANVAS_GIT_SYNC_BG_RUNTIME = {
  lastRemoteSha: '',
  lastRemoteCommittedAt: 0,
  lastLocalHash: '',
  lastSuccessAt: 0,
  lastLocalMutationAt: 0,
  hasPendingWork: false,
  localDirty: false,
  lastRecoverySnapshotAt: 0,
  lastRecoverySnapshotError: ''
};

function normalizeCanvasGitSyncBackgroundRuntime(runtimeRaw) {
  const runtime = runtimeRaw && typeof runtimeRaw === 'object' ? runtimeRaw : {};
  return {
    isRunning: runtime.isRunning === true,
    lastRemoteSha: typeof runtime.lastRemoteSha === 'string' ? runtime.lastRemoteSha : '',
    lastRemoteCommittedAt: Number.isFinite(Number(runtime.lastRemoteCommittedAt)) ? Number(runtime.lastRemoteCommittedAt) : 0,
    lastLocalHash: typeof runtime.lastLocalHash === 'string' ? runtime.lastLocalHash : '',
    lastSuccessAt: Number.isFinite(Number(runtime.lastSuccessAt)) ? Number(runtime.lastSuccessAt) : 0,
    lastLocalMutationAt: Number.isFinite(Number(runtime.lastLocalMutationAt)) ? Number(runtime.lastLocalMutationAt) : 0,
    hasPendingWork: runtime.hasPendingWork === true,
    localDirty: runtime.localDirty === true,
    lastRecoverySnapshotAt: Number.isFinite(Number(runtime.lastRecoverySnapshotAt)) ? Number(runtime.lastRecoverySnapshotAt) : 0,
    lastRecoverySnapshotError: typeof runtime.lastRecoverySnapshotError === 'string' ? runtime.lastRecoverySnapshotError : ''
  };
}


function clearExtensionBadge() {
  try {
    if (!browserAPI?.action || typeof browserAPI.action.setBadgeText !== 'function') return;
    browserAPI.action.setBadgeText({ text: '' }, () => {
      try {
        const err = browserAPI?.runtime?.lastError;
        if (err && err.message) {
          // ignore
        }
      } catch (_) { }
    });
  } catch (_) { }
}

function initSidePanel() {
  if (!browserAPI?.sidePanel) return;
  try {
    // Bind "Activate extension" action to the side panel.
    if (browserAPI.sidePanel.setPanelBehavior) {
      browserAPI.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }, () => {});
    }
  } catch (_) {}
}

const SIDE_PANEL_CONTEXT = browserAPI?.runtime?.ContextType?.SIDE_PANEL || 'SIDE_PANEL';
const SIDE_PANEL_TOGGLE_PORT = 'bookmark-canvas-sidepanel-toggle-v1';
const sidePanelOpenWindows = new Set();
const sidePanelTogglePortsByWindow = new Map();
const sidePanelToggleUnboundPorts = new Set();
let sidePanelTogglePortListenerRegistered = false;

function setSidePanelOpenWindowState(windowId, isOpen) {
  if (typeof windowId !== 'number') return;
  if (isOpen) {
    sidePanelOpenWindows.add(windowId);
    return;
  }
  sidePanelOpenWindows.delete(windowId);
}

function addUnboundSidePanelTogglePort(port) {
  if (!port) return;
  sidePanelToggleUnboundPorts.add(port);
}

function removeUnboundSidePanelTogglePort(port) {
  if (!port) return;
  sidePanelToggleUnboundPorts.delete(port);
}

function addSidePanelTogglePort(windowId, port) {
  if (typeof windowId !== 'number' || !port) return;
  removeUnboundSidePanelTogglePort(port);
  let windowPorts = sidePanelTogglePortsByWindow.get(windowId);
  if (!windowPorts) {
    windowPorts = new Set();
    sidePanelTogglePortsByWindow.set(windowId, windowPorts);
  }
  windowPorts.add(port);
}

function cleanupWindowPortSetIfEmpty(windowId, windowPorts) {
  if (!windowPorts || windowPorts.size !== 0) return;
  sidePanelTogglePortsByWindow.delete(windowId);
}

function removeSidePanelTogglePort(windowId, port) {
  if (typeof windowId !== 'number' || !port) return;
  const windowPorts = sidePanelTogglePortsByWindow.get(windowId);
  if (!windowPorts) return;
  windowPorts.delete(port);
  cleanupWindowPortSetIfEmpty(windowId, windowPorts);
}

function removeSidePanelTogglePortEverywhere(port) {
  if (!port) return;
  removeUnboundSidePanelTogglePort(port);
  for (const [windowId, windowPorts] of Array.from(sidePanelTogglePortsByWindow.entries())) {
    if (!windowPorts.has(port)) continue;
    windowPorts.delete(port);
    cleanupWindowPortSetIfEmpty(windowId, windowPorts);
  }
}

function registerSidePanelTogglePortListener() {
  if (sidePanelTogglePortListenerRegistered) return;
  if (!browserAPI?.runtime?.onConnect?.addListener) return;
  sidePanelTogglePortListenerRegistered = true;

  browserAPI.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== SIDE_PANEL_TOGGLE_PORT) return;

    let trackedWindowId = null;
    addUnboundSidePanelTogglePort(port);

    const updateTrackedWindowId = (windowId) => {
      if (typeof windowId !== 'number') return;
      if (trackedWindowId === windowId) return;
      if (typeof trackedWindowId === 'number') {
        removeSidePanelTogglePort(trackedWindowId, port);
      }
      trackedWindowId = windowId;
      addSidePanelTogglePort(trackedWindowId, port);
      setSidePanelOpenWindowState(trackedWindowId, true);
    };

    const senderWindowId = port?.sender?.tab?.windowId;
    if (typeof senderWindowId === 'number') {
      updateTrackedWindowId(senderWindowId);
    }

    const onMessage = (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'sidepanel_toggle_bridge_hello') {
        updateTrackedWindowId(message.windowId);
        try {
          port.postMessage({ type: 'sidepanel_toggle_bridge_ack', ts: Date.now() });
        } catch (_) { }
      }
    };

    const onDisconnect = () => {
      try {
        const err = browserAPI?.runtime?.lastError;
        if (err && err.message) {
          // touch lastError to avoid unchecked runtime.lastError noise.
        }
      } catch (_) { }

      if (typeof trackedWindowId === 'number') {
        setSidePanelOpenWindowState(trackedWindowId, false);
      }
      removeSidePanelTogglePortEverywhere(port);
      try {
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(onDisconnect);
      } catch (_) { }
    };

    try {
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
    } catch (_) { }

    try {
      port.postMessage({ type: 'sidepanel_toggle_bridge_request_window_id', ts: Date.now() });
    } catch (_) { }
  });

  if (browserAPI?.windows?.onRemoved?.addListener) {
    browserAPI.windows.onRemoved.addListener((windowId) => {
      if (typeof windowId !== 'number') return;
      sidePanelTogglePortsByWindow.delete(windowId);
      setSidePanelOpenWindowState(windowId, false);
    });
  }
}

async function getSidePanelContexts() {
  if (!browserAPI?.runtime?.getContexts) return null;
  try {
    const filter = { contextTypes: [SIDE_PANEL_CONTEXT] };
    const result = browserAPI.runtime.getContexts(filter);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return await new Promise((resolve) => {
      try {
        browserAPI.runtime.getContexts(filter, (contexts) => {
          resolve(Array.isArray(contexts) ? contexts : []);
        });
      } catch (_) {
        resolve([]);
      }
    });
  } catch (_) {
    return null;
  }
}

async function refreshSidePanelOpenWindows() {
  const contexts = await getSidePanelContexts();
  if (!Array.isArray(contexts)) return null;
  sidePanelOpenWindows.clear();
  contexts.forEach((ctx) => {
    if (ctx && typeof ctx.windowId === 'number') {
      setSidePanelOpenWindowState(ctx.windowId, true);
    }
  });
  return contexts;
}

async function getCurrentWindowIdAsync() {
  return await new Promise((resolve) => {
    try {
      if (!browserAPI?.windows?.getCurrent) {
        resolve(null);
        return;
      }
      browserAPI.windows.getCurrent((win) => {
        resolve(win && typeof win.id === 'number' ? win.id : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function resolveWindowIdForSidePanelAction(message, sender) {
  const requestedWindowId = Number(message && message.windowId);
  if (Number.isFinite(requestedWindowId) && requestedWindowId >= 0) {
    return requestedWindowId;
  }
  const senderWindowId = sender && sender.tab && typeof sender.tab.windowId === 'number'
    ? sender.tab.windowId
    : null;
  if (senderWindowId != null) return senderWindowId;
  return await getCurrentWindowIdAsync();
}

async function getSidePanelOpenStateForWindow(windowId) {
  if (typeof windowId !== 'number') return false;
  const contexts = await refreshSidePanelOpenWindows();
  if (Array.isArray(contexts)) {
    if (sidePanelOpenWindows.has(windowId)) {
      return true;
    }
  }

  const windowPorts = sidePanelTogglePortsByWindow.get(windowId);
  if (windowPorts && windowPorts.size > 0) {
    return true;
  }

  return sidePanelOpenWindows.has(windowId);
}

async function openSidePanelInWindow(windowId) {
  if (typeof windowId !== 'number') {
    return { success: false, error: 'window_unavailable' };
  }
  if (typeof browserAPI?.sidePanel?.open !== 'function') {
    return { success: false, error: 'open_unavailable' };
  }

  return await new Promise((resolve) => {
    try {
      browserAPI.sidePanel.open({ windowId }, () => {
        const err = browserAPI?.runtime?.lastError;
        if (err) {
          resolve({ success: false, error: err.message || 'open_failed' });
          return;
        }
        setSidePanelOpenWindowState(windowId, true);
        resolve({ success: true, isOpen: true });
      });
    } catch (error) {
      resolve({ success: false, error: error?.message || 'open_failed' });
    }
  });
}

async function closeSidePanelInWindow(windowId) {
  if (typeof windowId !== 'number') {
    return { success: false, error: 'window_unavailable' };
  }
  if (typeof browserAPI?.sidePanel?.close !== 'function') {
    return { success: false, error: 'close_unavailable' };
  }

  return await new Promise((resolve) => {
    try {
      browserAPI.sidePanel.close({ windowId }, () => {
        const err = browserAPI?.runtime?.lastError;
        if (err) {
          resolve({ success: false, error: err.message || 'close_failed' });
          return;
        }
        setSidePanelOpenWindowState(windowId, false);
        resolve({ success: true, isOpen: false });
      });
    } catch (error) {
      resolve({ success: false, error: error?.message || 'close_failed' });
    }
  });
}

if (browserAPI?.runtime?.onInstalled) {
  browserAPI.runtime.onInstalled.addListener(() => {
    initSidePanel();
    refreshSidePanelOpenWindows().catch(() => {});
    clearExtensionBadge();
    restoreCanvasGitSyncBackgroundScheduling().catch(() => {});
  });
}

try {
  if (browserAPI?.runtime?.onStartup?.addListener) {
    browserAPI.runtime.onStartup.addListener(() => {
      clearExtensionBadge();
      restoreCanvasGitSyncBackgroundScheduling().catch(() => {});
    });
  }
} catch (_) { }

initSidePanel();
registerSidePanelTogglePortListener();
refreshSidePanelOpenWindows().catch(() => {});
clearExtensionBadge();
restoreCanvasGitSyncBackgroundScheduling().catch(() => {});

// Favicon broadcast (align with reference project)
const processedFavicons = new Map();
const FAVICON_UPDATE_COOLDOWN = 5000;

async function blobToDataUrl(blob) {
  if (!blob) return null;
  return await new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch (_) {
      resolve(null);
    }
  });
}

async function readBlobDimensions(blob) {
  if (!blob) return null;
  try {
    if (typeof createImageBitmap !== 'function') {
      return null;
    }
    const bitmap = await createImageBitmap(blob);
    const width = Number(bitmap && bitmap.width) || 0;
    const height = Number(bitmap && bitmap.height) || 0;
    try {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    } catch (_) { }
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function fetchImageAsDataUrl(url, options = {}) {
  if (!url) {
    return options.includeMeta === true
      ? {
        dataUrl: '',
        meta: {
          attempted: false,
          hardFailure: false,
          resultClass: 'invalid_content',
          errorCode: 'invalid_url'
        }
      }
      : null;
  }
  const timeoutMs = Math.max(500, Number(options.timeoutMs) || 4000);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || (512 * 1024));
  const minDimensionPx = Math.max(1, Number(options.minDimensionPx) || 1);
  const includeMeta = options.includeMeta === true;
  const wrap = (dataUrl, meta) => includeMeta ? { dataUrl, meta } : dataUrl;
  const isHardFailureStatus = (statusCode) => {
    const code = Number(statusCode);
    if (!Number.isFinite(code)) return false;
    if (code === 0 || code === 408) return true;
    return code >= 500 && code <= 599;
  };
  const classifyResultByStatus = (statusCode) => (
    isHardFailureStatus(statusCode) ? 'hard_failure' : 'invalid_content'
  );
  const isNonFetchableError = (error) => {
    const name = String(error?.name || '').toLowerCase();
    if (name === 'securityerror' || name === 'notsupportederror') return true;

    const message = String(error?.message || '').toLowerCase();
    const text = `${name} ${message}`;
    if (text.includes('err_unknown_url_scheme')) return true;
    if (text.includes('unknown url scheme')) return true;
    if (text.includes('url scheme') && (text.includes('unsupported') || text.includes('not supported'))) {
      return true;
    }

    const hasUrlHint = text.includes('url') || text.includes('scheme') || text.includes('protocol');
    const hasUnsupportedHint = text.includes('unsupported')
      || text.includes('not supported')
      || text.includes('invalid')
      || text.includes('failed to parse');
    return hasUrlHint && hasUnsupportedHint;
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try { controller.abort(); } catch (_) { }
  }, timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const statusCode = Number(res.status) || 0;
      const resultClass = classifyResultByStatus(statusCode);
      return wrap('', {
        attempted: true,
        statusCode,
        hardFailure: resultClass === 'hard_failure',
        resultClass,
        errorCode: `http_${statusCode || 0}`
      });
    }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
      return wrap('', {
        attempted: true,
        statusCode: Number(res.status) || 200,
        hardFailure: false,
        resultClass: 'invalid_content',
        errorCode: 'non_image_content'
      });
    }

    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return wrap('', {
        attempted: true,
        statusCode: Number(res.status) || 200,
        hardFailure: false,
        resultClass: 'invalid_content',
        errorCode: 'payload_too_large'
      });
    }

    const blob = await res.blob();
    if (!blob || blob.size <= 0 || blob.size > maxBytes) {
      return wrap('', {
        attempted: true,
        statusCode: Number(res.status) || 200,
        hardFailure: false,
        resultClass: 'invalid_content',
        errorCode: 'invalid_blob'
      });
    }

    const dimensions = await readBlobDimensions(blob);
    if (!dimensions || dimensions.width < minDimensionPx || dimensions.height < minDimensionPx) {
      return wrap('', {
        attempted: true,
        statusCode: Number(res.status) || 200,
        hardFailure: false,
        resultClass: 'invalid_content',
        errorCode: 'dimension_too_small'
      });
    }

    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return wrap('', {
        attempted: true,
        statusCode: Number(res.status) || 200,
        hardFailure: false,
        resultClass: 'invalid_content',
        errorCode: 'invalid_data_url'
      });
    }
    return wrap(dataUrl, {
      attempted: true,
      statusCode: Number(res.status) || 200,
      hardFailure: false,
      resultClass: 'success',
      errorCode: ''
    });
  } catch (error) {
    const isTimeout = error && error.name === 'AbortError';
    const resultClass = isTimeout
      ? 'hard_failure'
      : (isNonFetchableError(error) ? 'non_fetchable' : 'hard_failure');
    const errorCode = isTimeout
      ? 'timeout'
      : (resultClass === 'non_fetchable' ? 'non_fetchable' : 'fetch_failed');
    return wrap('', {
      attempted: true,
      hardFailure: resultClass === 'hard_failure',
      resultClass,
      errorCode
    });
  } finally {
    clearTimeout(timeout);
  }
}

if (browserAPI.tabs && browserAPI.tabs.onUpdated) {
  browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      if (!changeInfo?.favIconUrl || !tab?.url) return;
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return;

      const now = Date.now();
      const last = processedFavicons.get(tab.url);
      if (last && (now - last) < FAVICON_UPDATE_COOLDOWN) return;
      processedFavicons.set(tab.url, now);

      if (processedFavicons.size > 1000) {
        const entries = Array.from(processedFavicons.entries());
        entries.sort((a, b) => a[1] - b[1]);
        entries.slice(0, 500).forEach(([url]) => processedFavicons.delete(url));
      }

      const fetchOptions = {
        minDimensionPx: 16,
        maxBytes: 512 * 1024,
        timeoutMs: 4000,
        includeMeta: true
      };
      const isFetchSuccess = (result) => {
        if (!result || typeof result !== 'object') return false;
        const dataUrl = typeof result.dataUrl === 'string' ? result.dataUrl : '';
        const resultClass = String(result?.meta?.resultClass || '').toLowerCase();
        return resultClass === 'success' && dataUrl.startsWith('data:image/');
      };

      let faviconFetchResult = await fetchImageAsDataUrl(tab.favIconUrl, fetchOptions);
      if (!isFetchSuccess(faviconFetchResult)) {
        const fallbackPath = `/_favicon?pageUrl=${encodeURIComponent(tab.url)}&size=32`;
        const fallbackUrl = browserAPI?.runtime?.getURL
          ? browserAPI.runtime.getURL(fallbackPath)
          : fallbackPath;
        faviconFetchResult = await fetchImageAsDataUrl(fallbackUrl, fetchOptions);
      }

      const shouldSendUpdate = isFetchSuccess(faviconFetchResult);
      if (shouldSendUpdate) {
        try {
          browserAPI.runtime.sendMessage({
            action: 'updateFaviconFromTab',
            url: tab.url,
            favIconUrl: faviconFetchResult.dataUrl
          }).catch(() => {});
        } catch (_) {}
      }
    } catch (_) {}
  });
}

if (browserAPI?.storage?.onChanged?.addListener) {
  browserAPI.storage.onChanged.addListener((changes, areaName) => {
    try {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') return;

      if (didCanvasGitSyncTargetStorageChange(changes)) {
        ensureCanvasGitSyncBackgroundTargetState().catch(() => {});
      }
    } catch (_) { }
  });
}

const GITHUB_SYNC_FILE_WARN_BYTES = 50 * 1024 * 1024;
const GITHUB_SYNC_FILE_LIMIT_BYTES = 100 * 1024 * 1024;

function normalizeGitHubRepoPath(path) {
  return String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');
}

function normalizeCanvasGitSyncExportRoot(path, options = {}) {
  const allowEmpty = !!(options && options.allowEmpty);
  const normalizedRaw = normalizeGitHubRepoPath(path);
  const normalized = (normalizedRaw === 'bookmark-canvas-sync'
    || normalizedRaw === 'bookmark-canvas'
    || normalizedRaw === '书签画布同步')
    ? '书签画布'
    : normalizedRaw;
  if (allowEmpty && typeof path === 'string' && !normalized) {
    return '';
  }
  return normalized || CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT.obsidianExportRoot;
}

function hashString(raw) {
  const text = String(raw || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildCanvasGitRemoteRevision(files, basePath = '') {
  const normalizedBasePath = normalizeGitHubRepoPath(basePath);
  const basePrefix = normalizedBasePath ? `${normalizedBasePath}/` : '';
  const sourceFiles = Array.isArray(files) ? files : [];
  if (!sourceFiles.length) return '';

  const canonical = sourceFiles
    .map((entry) => {
      const repoPath = normalizeGitHubRepoPath(entry && entry.path);
      if (!repoPath) return null;
      const relativePath = basePrefix && repoPath.startsWith(basePrefix)
        ? repoPath.slice(basePrefix.length)
        : repoPath;
      return {
        path: relativePath,
        sha: String((entry && entry.sha) || '')
      };
    })
    .filter((entry) => !!(entry && entry.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => `${entry.path}:${entry.sha}`)
    .join('\n');

  if (!canonical) return '';
  return `files:${hashString(canonical)}`;
}

function buildCanvasManagedCanvasFileNameCandidates(rootPath = '') {
  const normalizedRoot = normalizeGitHubRepoPath(rootPath);
  const rootLeaf = normalizedRoot
    ? normalizedRoot.split('/').filter(Boolean).slice(-1)[0]
    : '';
  const candidates = new Set([
    '书签画布.canvas',
    'bookmark-canvas.canvas'
  ]);
  if (rootLeaf) {
    candidates.add(`${rootLeaf}.canvas`);
  }
  return candidates;
}

function isCanvasManagedSyncRelativePath(relativePath, canvasFileNames) {
  const relative = normalizeGitHubRepoPath(relativePath);
  if (!relative) return false;
  if (/^(永久栏目|Permanent|临时栏目|Temporary)\/.+\.md$/i.test(relative)) {
    return true;
  }
  if (/^(说明导入规则\.md|README_Import_Rules\.md|说明_导入规则\.md)$/i.test(relative)) {
    return true;
  }
  if (/^[^/]+\.canvas$/i.test(relative)) {
    const fileName = relative.split('/').pop() || '';
    return !!(canvasFileNames && canvasFileNames.has(fileName));
  }
  return false;
}

function filterCanvasManagedSyncFilesForRevision(filesInput, rootPath = '') {
  const sourceFiles = Array.isArray(filesInput) ? filesInput : [];
  const normalizedRoot = normalizeGitHubRepoPath(rootPath);
  const rootPrefix = normalizedRoot ? `${normalizedRoot}/` : '';
  const canvasFileNames = buildCanvasManagedCanvasFileNameCandidates(normalizedRoot);
  const files = [];

  sourceFiles.forEach((entry) => {
    const repoPath = normalizeGitHubRepoPath(entry && entry.path);
    if (!repoPath) return;

    let relativePath = repoPath;
    if (normalizedRoot) {
      if (!repoPath.startsWith(rootPrefix)) return;
      relativePath = repoPath.slice(rootPrefix.length);
    }

    if (!isCanvasManagedSyncRelativePath(relativePath, canvasFileNames)) return;
    files.push(entry);
  });

  return files;
}

function textToBase64(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(String(text ?? ''));
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function estimateBase64ByteLength(base64Content) {
  const normalized = String(base64Content || '').replace(/\s+/g, '');
  if (!normalized) return 0;
  let padding = 0;
  if (normalized.endsWith('==')) {
    padding = 2;
  } else if (normalized.endsWith('=')) {
    padding = 1;
  }
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

async function resolveCanvasGitConfig() {
  const config = await browserAPI.storage.local.get([
    'githubRepoToken',
    'githubRepoOwner',
    'githubRepoName',
    'githubRepoBranch',
    'githubRepoBasePath',
    'githubRepoEnabled'
  ]);

  if (config.githubRepoEnabled === false) {
    return { success: false, error: 'GitHub 仓库已禁用' };
  }
  if (!config.githubRepoToken) {
    return { success: false, error: 'GitHub Token 未配置' };
  }
  if (!config.githubRepoOwner || !config.githubRepoName) {
    return { success: false, error: '仓库未配置' };
  }

  return {
    success: true,
    token: config.githubRepoToken,
    owner: config.githubRepoOwner,
    repo: config.githubRepoName,
    branch: config.githubRepoBranch,
    basePath: config.githubRepoBasePath
  };
}

function buildCanvasGitSyncBackgroundTargetSignature(target) {
  const owner = String(target && target.owner || '').trim();
  const repo = String(target && target.repo || '').trim();
  if (!owner || !repo) return '';

  const branch = String(target && target.branch || '').trim() || '(default)';
  const repoRootPath = normalizeGitHubRepoPath(target && target.repoRootPath);
  return [owner, repo, branch, repoRootPath || '(root)'].join('::');
}

async function resolveCanvasGitSyncBackgroundTargetDescriptor(settingsInput) {
  const settings = normalizeCanvasGitSyncBackgroundSettings(settingsInput);

  try {
    if (!browserAPI?.storage?.local) {
      return {
        owner: '',
        repo: '',
        branch: '',
        basePath: '',
        repoRootPath: normalizeCanvasGitSyncExportRoot(settings.obsidianExportRoot, { allowEmpty: true }),
        signature: ''
      };
    }

    const saved = await browserAPI.storage.local.get([
      'githubRepoOwner',
      'githubRepoName',
      'githubRepoBranch',
      'githubRepoBasePath',
      'githubRepoEnabled'
    ]);

    if (saved.githubRepoEnabled === false) {
      return {
        owner: '',
        repo: '',
        branch: '',
        basePath: '',
        repoRootPath: '',
        signature: ''
      };
    }

    const owner = String(saved.githubRepoOwner || '').trim();
    const repo = String(saved.githubRepoName || '').trim();
    const branch = String(saved.githubRepoBranch || '').trim();
    const basePath = normalizeGitHubRepoPath(saved.githubRepoBasePath);
    const normalizedRootPath = normalizeCanvasGitSyncExportRoot(settings.obsidianExportRoot, { allowEmpty: true });
    const repoRootPath = basePath
      ? normalizeGitHubRepoPath(`${basePath}/${normalizedRootPath}`)
      : normalizedRootPath;

    return {
      owner,
      repo,
      branch,
      basePath,
      repoRootPath,
      signature: buildCanvasGitSyncBackgroundTargetSignature({ owner, repo, branch, repoRootPath })
    };
  } catch (_) {
    return {
      owner: '',
      repo: '',
      branch: '',
      basePath: '',
      repoRootPath: '',
      signature: ''
    };
  }
}

function resetCanvasGitSyncBackgroundRuntimeBaseline(runtimeRaw) {
  const runtime = normalizeCanvasGitSyncBackgroundRuntime(runtimeRaw);
  return Object.assign({}, runtime, {
    lastRemoteSha: '',
    lastRemoteCommittedAt: 0,
    lastLocalHash: '',
    lastSuccessAt: 0,
    hasPendingWork: runtime.localDirty === true,
    lastRecoverySnapshotAt: 0,
    lastRecoverySnapshotError: ''
  });
}

async function ensureCanvasGitSyncBackgroundTargetState(stateInput, options = {}) {
  const state = stateInput == null
    ? await loadCanvasGitSyncBackgroundState()
    : normalizeCanvasGitSyncBackgroundState(stateInput);
  const targetDescriptor = options && options.targetDescriptor
    ? options.targetDescriptor
    : await resolveCanvasGitSyncBackgroundTargetDescriptor(state.settings);
  const nextSignature = String(targetDescriptor && targetDescriptor.signature || '');
  const previousSignature = String(state.targetSignature || '');

  if (previousSignature === nextSignature) {
    return { changed: false, reset: false, state, targetDescriptor };
  }

  state.targetSignature = nextSignature;
  const shouldResetBaseline = !!previousSignature;
  if (shouldResetBaseline) {
    state.runtime = resetCanvasGitSyncBackgroundRuntimeBaseline(state.runtime);
  }

  const saved = await saveCanvasGitSyncBackgroundState(state);
  return {
    changed: true,
    reset: shouldResetBaseline,
    state: saved,
    targetDescriptor
  };
}

function didCanvasGitSyncTargetStorageChange(changes) {
  if (!changes || typeof changes !== 'object') return false;
  if (changes.githubRepoOwner || changes.githubRepoName || changes.githubRepoBranch || changes.githubRepoBasePath || changes.githubRepoEnabled) {
    return true;
  }

  const bgStateChange = changes[CANVAS_GIT_SYNC_BG_STATE_KEY];
  if (!bgStateChange || typeof bgStateChange !== 'object') return false;

  const oldRoot = normalizeCanvasGitSyncBackgroundSettings(bgStateChange.oldValue && bgStateChange.oldValue.settings).obsidianExportRoot;
  const newRoot = normalizeCanvasGitSyncBackgroundSettings(bgStateChange.newValue && bgStateChange.newValue.settings).obsidianExportRoot;
  return oldRoot !== newRoot;
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeCanvasGitSyncBackgroundSettings(settingsRaw) {
  const source = settingsRaw && typeof settingsRaw === 'object' ? settingsRaw : {};
  return {
    enabled: source.enabled === true,
    obsidianExportRoot: normalizeCanvasGitSyncExportRoot(source.obsidianExportRoot, { allowEmpty: true })
  };
}

function normalizeCanvasGitSyncBackgroundState(stateRaw) {
  const raw = stateRaw && typeof stateRaw === 'object' ? stateRaw : {};
  return {
    settings: normalizeCanvasGitSyncBackgroundSettings(Object.assign({}, CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT, raw.settings || {})),
    runtime: Object.assign({}, DEFAULT_CANVAS_GIT_SYNC_BG_RUNTIME, normalizeCanvasGitSyncBackgroundRuntime(raw.runtime)),
    targetSignature: typeof raw.targetSignature === 'string' ? raw.targetSignature : '',
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0
  };
}



async function loadCanvasGitSyncBackgroundState() {
  try {
    if (!browserAPI?.storage?.local) {
      return normalizeCanvasGitSyncBackgroundState({});
    }
    const data = await browserAPI.storage.local.get([CANVAS_GIT_SYNC_BG_STATE_KEY]);
    return normalizeCanvasGitSyncBackgroundState(data && data[CANVAS_GIT_SYNC_BG_STATE_KEY]);
  } catch (_) {
    return normalizeCanvasGitSyncBackgroundState({});
  }
}

async function saveCanvasGitSyncBackgroundState(state) {
  const normalized = normalizeCanvasGitSyncBackgroundState(state);
  normalized.updatedAt = Date.now();
  try {
    if (browserAPI?.storage?.local) {
      await browserAPI.storage.local.set({ [CANVAS_GIT_SYNC_BG_STATE_KEY]: normalized });
    }
  } catch (_) { }
  return normalized;
}

function readBookmarkTreeForRecoveryInBackground() {
  return new Promise((resolve, reject) => {
    try {
      if (!browserAPI || !browserAPI.bookmarks || typeof browserAPI.bookmarks.getTree !== 'function') {
        reject(new Error('bookmarks-api-unavailable'));
        return;
      }
      browserAPI.bookmarks.getTree((tree) => {
        const err = browserAPI && browserAPI.runtime && browserAPI.runtime.lastError;
        if (err && err.message) {
          reject(new Error(err.message));
          return;
        }
        resolve(Array.isArray(tree) ? tree : []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeRecoverySnapshotRecords(recordsRaw) {
  const records = Array.isArray(recordsRaw) ? recordsRaw : [];
  return records
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const ts = Math.max(0, Number(item.ts) || 0);
      const reason = String(item.reason || '').trim();
      const snapshot = item.snapshot && typeof item.snapshot === 'object' ? item.snapshot : null;
      if (!ts || !snapshot) return null;
      return {
        ts,
        reason,
        snapshotHash: String(item.snapshotHash || '').trim(),
        snapshot
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, CANVAS_GIT_SYNC_RECOVERY_KEEP_LATEST);
}

async function loadRecoverySnapshotRecordsInBackground() {
  try {
    if (!browserAPI?.storage?.local) return [];
    const data = await browserAPI.storage.local.get([CANVAS_GIT_SYNC_RECOVERY_KEY]);
    const raw = data && data[CANVAS_GIT_SYNC_RECOVERY_KEY];
    let parsed = [];
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        parsed = [];
      }
    } else {
      parsed = raw;
    }
    return normalizeRecoverySnapshotRecords(parsed);
  } catch (_) {
    return [];
  }
}

async function saveRecoverySnapshotRecordsInBackground(records) {
  const normalized = normalizeRecoverySnapshotRecords(records);
  try {
    if (!browserAPI?.storage?.local) return false;
    await browserAPI.storage.local.set({
      [CANVAS_GIT_SYNC_RECOVERY_KEY]: JSON.stringify(normalized)
    });
    return true;
  } catch (_) {
    return false;
  }
}

function estimateRecoverySnapshotHash(snapshot) {
  try {
    const text = JSON.stringify(snapshot && snapshot.permanentTreeSnapshot ? snapshot.permanentTreeSnapshot : []);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch (_) {
    return '';
  }
}

function buildBackgroundPermanentRecoverySnapshot(tree, reason) {
  const now = Date.now();
  const snapshot = {
    schemaVersion: 1,
    format: 'bookmark-canvas-permanent-tree',
    updatedAt: now,
    generatedAt: now,
    trigger: String(reason || CANVAS_GIT_SYNC_RECOVERY_REASON_IDLE),
    permanentTreeSnapshot: Array.isArray(tree) ? tree : [],
    data: {}
  };
  return {
    ts: now,
    reason: String(reason || CANVAS_GIT_SYNC_RECOVERY_REASON_IDLE),
    snapshotHash: estimateRecoverySnapshotHash(snapshot),
    snapshot
  };
}

function normalizeBackgroundRecoverySnapshotReason(reasonInput) {
  const normalized = String(reasonInput || '').trim().toLowerCase();
  if (!normalized || normalized === 'alarm') return CANVAS_GIT_SYNC_RECOVERY_REASON_IDLE;
  if (normalized === 'manual' || normalized === 'manual-message' || normalized === 'manual-ui') {
    return CANVAS_GIT_SYNC_RECOVERY_REASON_MANUAL;
  }
  return normalized;
}

async function runCanvasGitSyncBackgroundRecoverySnapshot(reason = 'alarm') {
  let state = await loadCanvasGitSyncBackgroundState();
  const targetSync = await ensureCanvasGitSyncBackgroundTargetState(state);
  state = targetSync.state;
  const snapshotReason = normalizeBackgroundRecoverySnapshotReason(reason);
  const isManualTrigger = snapshotReason === CANVAS_GIT_SYNC_RECOVERY_REASON_MANUAL;
  if (!isManualTrigger) {
    return { success: false, skipped: true, reason: 'disabled' };
  }

  try {
    const tree = await readBookmarkTreeForRecoveryInBackground();
    const record = buildBackgroundPermanentRecoverySnapshot(tree, snapshotReason);
    const existing = await loadRecoverySnapshotRecordsInBackground();
    const latest = existing[0] || null;
    if (latest && String(latest.snapshotHash || '') && String(latest.snapshotHash || '') === String(record.snapshotHash || '')) {
      state.runtime.lastRecoverySnapshotError = '';
      state.runtime.lastRecoverySnapshotAt = Math.max(0, Number(latest.ts) || Date.now());
      state = await saveCanvasGitSyncBackgroundState(state);
      return {
        success: true,
        skipped: true,
        reason: 'same-as-latest',
        lastRecoverySnapshotAt: state.runtime.lastRecoverySnapshotAt
      };
    }

    const nextRecords = [record];
    const saved = await saveRecoverySnapshotRecordsInBackground(nextRecords);
    if (!saved) {
      throw new Error('save-recovery-snapshot-failed');
    }

    state.runtime.lastRecoverySnapshotError = '';
    state.runtime.lastRecoverySnapshotAt = record.ts;
    state = await saveCanvasGitSyncBackgroundState(state);
    return {
      success: true,
      skipped: false,
      lastRecoverySnapshotAt: record.ts
    };
  } catch (error) {
    state.runtime.lastRecoverySnapshotError = error && error.message ? error.message : String(error || 'recovery-snapshot-failed');
    state = await saveCanvasGitSyncBackgroundState(state);
    return {
      success: false,
      skipped: false,
      error: state.runtime.lastRecoverySnapshotError
    };
  }
}

async function readCanvasGitRemoteSignalForBackground(settings) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error || '仓库未就绪' };
  }

  const normalizedRootPath = normalizeCanvasGitSyncExportRoot(settings && settings.obsidianExportRoot, { allowEmpty: true });
  const repoRootPath = gitConfig.basePath
    ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${normalizedRootPath}`)
    : normalizedRootPath;

  const listResult = await listRepoFiles({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    rootPath: repoRootPath
  });

  if (!listResult || listResult.success !== true) {
    return { success: false, error: listResult?.error || '读取云端信号失败', path: repoRootPath || normalizedRootPath };
  }

  const sourceFiles = Array.isArray(listResult.files) ? listResult.files : [];
  const files = filterCanvasManagedSyncFilesForRevision(sourceFiles, repoRootPath);
  const revisionSha = buildCanvasGitRemoteRevision(files, gitConfig.basePath);

  return {
    success: true,
    notFound: files.length === 0,
    path: repoRootPath || normalizedRootPath,
    revisionSha: String(revisionSha || ''),
    committedAt: 0,
    fileCount: files.length,
    totalFileCount: sourceFiles.length,
    truncated: listResult.truncated === true
  };
}


async function restoreCanvasGitSyncBackgroundScheduling() {
  const loadedState = await loadCanvasGitSyncBackgroundState();
  const targetSync = await ensureCanvasGitSyncBackgroundTargetState(loadedState);
  void targetSync.state;
}

async function handleCanvasGitSyncUpdateContextMessage(message) {
  const state = await loadCanvasGitSyncBackgroundState();
  const incomingSettings = message && typeof message.settings === 'object' ? message.settings : null;
  const incomingRuntime = message && typeof message.runtime === 'object' ? message.runtime : null;
  const eventName = String(message && message.event || '').trim().toLowerCase();

  if (incomingSettings) {
    state.settings = normalizeCanvasGitSyncBackgroundSettings(Object.assign({}, state.settings, incomingSettings));
  }

  if (incomingRuntime) {
    state.runtime = Object.assign({}, state.runtime, normalizeCanvasGitSyncBackgroundRuntime(Object.assign({}, state.runtime, incomingRuntime)));
  }

  if (eventName === 'local-dirty') {
    state.runtime.localDirty = true;
    state.runtime.hasPendingWork = true;
  } else if (eventName === 'sync-success') {
    state.runtime.localDirty = false;
    state.runtime.hasPendingWork = false;
  } else if (eventName === 'sync-idle') {
    if (!state.runtime.localDirty) {
      state.runtime.hasPendingWork = false;
    }
  }

  state.runtime = normalizeCanvasGitSyncBackgroundRuntime(state.runtime);
  const saved = await saveCanvasGitSyncBackgroundState(state);

  return {
    success: true,
    runtime: saved.runtime,
    settings: saved.settings
  };
}

async function handleCanvasGitSyncGetBackgroundStateMessage() {
  const state = await loadCanvasGitSyncBackgroundState();
  return {
    success: true,
    runtime: state.runtime,
    settings: state.settings
  };
}

async function handleCanvasGitReadFileMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const rawPath = normalizeGitHubRepoPath(message.path);
  if (!rawPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const repoPath = gitConfig.basePath
    ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${rawPath}`)
    : rawPath;

  const result = await getRepoFile({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: repoPath
  });

  if (!result || result.success !== true) {
    if (result && result.notFound === true) {
      return { success: true, notFound: true, path: rawPath };
    }
    return { success: false, error: result?.error || '读取同步文件失败', path: rawPath };
  }

  const normalizedBasePath = normalizeGitHubRepoPath(gitConfig.basePath);
  const basePrefix = normalizedBasePath ? `${normalizedBasePath}/` : '';
  const resultPath = normalizeGitHubRepoPath(result.path || repoPath);
  const relativePath = basePrefix && resultPath.startsWith(basePrefix)
    ? resultPath.slice(basePrefix.length)
    : resultPath;

  return {
    success: true,
    path: relativePath || rawPath,
    sha: result.sha || null,
    encoding: result.encoding || 'base64',
    contentBase64: result.contentBase64 || ''
  };
}

async function handleCanvasGitReadBlobByShaMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const blobSha = String(message && message.sha || '').trim();
  if (!blobSha) {
    return { success: false, error: '缺少 Blob SHA' };
  }

  const result = await getRepoBlobBySha({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    sha: blobSha
  });

  if (!result || result.success !== true) {
    if (result && result.notFound === true) {
      return { success: true, notFound: true, sha: blobSha };
    }
    return { success: false, error: result?.error || '读取 Blob 失败', sha: blobSha };
  }

  return {
    success: true,
    sha: String(result.sha || blobSha),
    encoding: result.encoding || 'base64',
    contentBase64: result.contentBase64 || '',
    size: Math.max(0, Number(result.size) || 0)
  };
}

async function handleCanvasGitWriteFileMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const rawPath = normalizeGitHubRepoPath(message.path);
  if (!rawPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const repoPath = gitConfig.basePath
    ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${rawPath}`)
    : rawPath;

  const contentBase64 = String(message.contentBase64 || '').trim();
  const contentText = message.content;
  const resolvedContentBase64 = contentBase64 || textToBase64(contentText);

  if (!resolvedContentBase64) {
    return { success: false, error: '缺少同步内容', path: repoPath };
  }

  const contentSizeBytes = estimateBase64ByteLength(resolvedContentBase64);
  if (contentSizeBytes >= GITHUB_SYNC_FILE_LIMIT_BYTES) {
    return {
      success: false,
      error: '同步文件超过 100MB，无法写入 GitHub。请拆分同步文件。',
      errorCode: 'SYNC_FILE_TOO_LARGE',
      path: repoPath,
      sizeBytes: contentSizeBytes,
      limitBytes: GITHUB_SYNC_FILE_LIMIT_BYTES
    };
  }
  if (contentSizeBytes >= GITHUB_SYNC_FILE_WARN_BYTES) {
    console.warn('[Canvas Sync] Large file write may be unstable:', {
      path: repoPath,
      sizeBytes: contentSizeBytes
    });
  }

  const commitMessage = String(message.commitMessage || '').trim() || `Bookmark Canvas Sync: update ${rawPath}`;
  const result = await upsertRepoFile({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: repoPath,
    message: commitMessage,
    contentBase64: resolvedContentBase64
  });

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '写入同步文件失败', path: repoPath };
  }

  return {
    success: true,
    path: result.path || repoPath,
    htmlUrl: result.htmlUrl || null,
    fileSha: result.fileSha || null,
    commitSha: result.commitSha || null,
    created: result.created === true
  };
}

async function handleCanvasGitApplyFilesBatchMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const changesRaw = Array.isArray(message && message.changes) ? message.changes : [];
  if (!changesRaw.length) {
    return { success: false, error: '缺少变更列表' };
  }

  const commitMessage = String(message.commitMessage || '').trim()
    || `Bookmark Canvas Sync: batch apply (${changesRaw.length})`;

  const repoChanges = [];
  const repoPathToRawPath = {};

  for (let i = 0; i < changesRaw.length; i += 1) {
    const entry = changesRaw[i];
    if (!entry || typeof entry !== 'object') continue;

    const rawPath = normalizeGitHubRepoPath(entry.path);
    if (!rawPath) {
      return { success: false, error: '缺少文件路径' };
    }

    const repoPath = gitConfig.basePath
      ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${rawPath}`)
      : rawPath;

    repoPathToRawPath[repoPath] = rawPath;

    const isDelete = entry.delete === true || entry.deleted === true;
    if (isDelete) {
      repoChanges.push({ path: repoPath, delete: true });
      continue;
    }

    const contentText = String(entry.content == null ? '' : entry.content);
    const bytes = new TextEncoder().encode(contentText);
    if (bytes.length >= GITHUB_SYNC_FILE_LIMIT_BYTES) {
      return {
        success: false,
        error: '同步文件超过 100MB，无法写入 GitHub。请拆分同步文件。',
        errorCode: 'SYNC_FILE_TOO_LARGE',
        path: repoPath,
        sizeBytes: bytes.length,
        limitBytes: GITHUB_SYNC_FILE_LIMIT_BYTES
      };
    }
    if (bytes.length >= GITHUB_SYNC_FILE_WARN_BYTES) {
      console.warn('[Canvas Sync] Large file write may be unstable:', {
        path: repoPath,
        sizeBytes: bytes.length
      });
    }

    repoChanges.push({ path: repoPath, content: contentText });
  }

  if (!repoChanges.length) {
    return { success: false, error: '缺少有效变更项' };
  }

  const result = await applyRepoFilesBatch({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    message: commitMessage,
    changes: repoChanges
  });

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '批量写入同步文件失败' };
  }

  const rawFileShas = {};
  const fileShas = result.fileShas && typeof result.fileShas === 'object' ? result.fileShas : {};
  Object.keys(fileShas).forEach((repoPath) => {
    const rawPath = repoPathToRawPath[repoPath];
    if (!rawPath) return;
    rawFileShas[rawPath] = String(fileShas[repoPath] || '');
  });

  return {
    success: true,
    branch: result.branch || gitConfig.branch || null,
    commitSha: result.commitSha || null,
    updated: Number(result.updated) || 0,
    deleted: Number(result.deleted) || 0,
    fileShas: rawFileShas
  };
}

async function handleCanvasGitDeleteFileMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const rawPath = normalizeGitHubRepoPath(message.path);
  if (!rawPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const repoPath = gitConfig.basePath
    ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${rawPath}`)
    : rawPath;

  const commitMessage = String(message.commitMessage || '').trim() || `Bookmark Canvas Sync: delete ${rawPath}`;
  const result = await deleteRepoFile({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: repoPath,
    message: commitMessage
  });

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '删除同步文件失败', path: repoPath };
  }

  return {
    success: true,
    path: result.path || repoPath,
    deleted: result.deleted === true,
    notFound: result.notFound === true,
    commitSha: result.commitSha || null
  };
}

async function handleCanvasGitListFilesMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const rawRootPath = normalizeGitHubRepoPath(message.rootPath);
  const repoRootPath = gitConfig.basePath
    ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${rawRootPath}`)
    : rawRootPath;

  const result = await listRepoFiles({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    rootPath: repoRootPath
  });

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '列出同步文件失败', rootPath: rawRootPath };
  }

  const normalizedBasePath = normalizeGitHubRepoPath(gitConfig.basePath);
  const basePrefix = normalizedBasePath ? `${normalizedBasePath}/` : '';

  const files = (Array.isArray(result.files) ? result.files : []).map((entry) => {
    const repoPath = normalizeGitHubRepoPath(entry && entry.path);
    let relativePath = repoPath;
    if (basePrefix && repoPath.startsWith(basePrefix)) {
      relativePath = repoPath.slice(basePrefix.length);
    }
    return {
      path: relativePath,
      repoPath,
      sha: entry && entry.sha ? String(entry.sha) : '',
      size: Number.isFinite(Number(entry && entry.size)) ? Number(entry.size) : 0
    };
  }).filter((entry) => {
    if (!entry || !entry.path) return false;
    if (!rawRootPath) return true;
    return entry.path === rawRootPath || entry.path.startsWith(`${rawRootPath}/`);
  });

  return {
    success: true,
    rootPath: rawRootPath,
    repoRootPath,
    files,
    truncated: result.truncated === true
  };
}


async function handleCanvasGitReadRemoteSignalMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error || '仓库未就绪' };
  }

  const rawRootPath = normalizeGitHubRepoPath(message.rootPath);
  const repoRootPath = gitConfig.basePath
    ? normalizeGitHubRepoPath(`${gitConfig.basePath}/${rawRootPath}`)
    : rawRootPath;

  const result = await getRepoBranchHeadSignal({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: repoRootPath
  });

  if (!result || result.success !== true) {
    return {
      success: false,
      error: result?.error || '读取云端信号失败',
      rootPath: rawRootPath,
      repoRootPath
    };
  }

  return {
    success: true,
    rootPath: rawRootPath,
    repoRootPath,
    notFound: !String(result.revisionSha || '').trim(),
    revisionSha: String(result.revisionSha || ''),
    committedAt: Number(result.committedAt) || 0
  };
}

async function handleCanvasGitTestConfigMessage(message) {
  const incoming = message && typeof message.config === 'object' && message.config
    ? message.config
    : null;

  const saved = await browserAPI.storage.local.get([
    'githubRepoToken',
    'githubRepoOwner',
    'githubRepoName',
    'githubRepoBranch',
    'githubRepoBasePath',
    'githubRepoEnabled'
  ]);

  const token = String(incoming?.token != null ? incoming.token : saved.githubRepoToken || '').trim();
  const owner = String(incoming?.owner != null ? incoming.owner : saved.githubRepoOwner || '').trim();
  const repo = String(incoming?.repo != null ? incoming.repo : saved.githubRepoName || '').trim();
  const branch = String(incoming?.branch != null ? incoming.branch : saved.githubRepoBranch || '').trim();
  const basePath = String(incoming?.basePath != null ? incoming.basePath : saved.githubRepoBasePath || '').trim();
  const enabled = incoming && Object.prototype.hasOwnProperty.call(incoming, 'enabled')
    ? incoming.enabled !== false
    : saved.githubRepoEnabled !== false;

  if (!enabled) {
    return { success: false, error: 'GitHub 仓库已禁用' };
  }

  const result = await testRepoConnection({ token, owner, repo, branch, basePath });
  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '连接测试失败' };
  }

  return {
    success: true,
    resolvedBranch: result.resolvedBranch || branch || null,
    basePathExists: result.basePathExists,
    branchExists: result.branchExists,
    branchWillBeCreated: result.branchWillBeCreated === true,
    repo: result.repo || null
  };
}

function openCanvasViewFromCommand() {
  const url = browserAPI.runtime.getURL('history_html/history.html?view=canvas');
  browserAPI.tabs.create({ url });
}

if (browserAPI.commands && browserAPI.commands.onCommand) {
  browserAPI.commands.onCommand.addListener((command) => {
    if (command === 'open_canvas_view') {
      openCanvasViewFromCommand();
    }
  });
}

async function handleGetSidePanelStateFromCanvasPage(message, sender) {
  const windowId = await resolveWindowIdForSidePanelAction(message, sender);
  if (windowId == null) {
    return { success: false, error: 'window_unavailable' };
  }
  const isOpen = await getSidePanelOpenStateForWindow(windowId);
  return { success: true, isOpen };
}

async function handleCloseSidePanelFromCanvasPage(message, sender) {
  const windowId = await resolveWindowIdForSidePanelAction(message, sender);
  const result = await closeSidePanelInWindow(windowId);
  if (result && result.success) {
    return { success: true, isOpen: false, state: 'closed' };
  }
  return { success: false, error: result?.error || 'close_failed' };
}

async function handleToggleSidePanelFromCanvasPage(message, sender) {
  const windowId = await resolveWindowIdForSidePanelAction(message, sender);
  if (windowId == null) {
    return { success: false, error: 'window_unavailable' };
  }

  const isOpen = await getSidePanelOpenStateForWindow(windowId);
  const result = isOpen
    ? await closeSidePanelInWindow(windowId)
    : await openSidePanelInWindow(windowId);

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || 'toggle_failed' };
  }

  return {
    success: true,
    isOpen: result.isOpen === true,
    state: result.isOpen === true ? 'opened' : 'closed'
  };
}

async function handleMarkSidePanelOpenFromCanvasPage(message, sender) {
  const windowId = await resolveWindowIdForSidePanelAction(message, sender);
  if (windowId == null) {
    return { success: false, error: 'window_unavailable' };
  }
  setSidePanelOpenWindowState(windowId, true);
  return { success: true, isOpen: true, state: 'opened' };
}

const sidePanelCanvasMessageHandlers = {
  getSidePanelStateFromCanvasPage: handleGetSidePanelStateFromCanvasPage,
  closeSidePanelFromCanvasPage: handleCloseSidePanelFromCanvasPage,
  toggleSidePanelFromCanvasPage: handleToggleSidePanelFromCanvasPage,
  markSidePanelOpenFromCanvasPage: handleMarkSidePanelOpenFromCanvasPage
};

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !message.action) {
    sendResponse({ success: false, error: 'Invalid message' });
    return;
  }

  const sidePanelHandler = sidePanelCanvasMessageHandlers[message.action];
  if (sidePanelHandler) {
    (async () => {
      const response = await sidePanelHandler(message, sender);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitSyncUpdateContext') {
    (async () => {
      const response = await handleCanvasGitSyncUpdateContextMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitSyncGetBackgroundState') {
    (async () => {
      const response = await handleCanvasGitSyncGetBackgroundStateMessage();
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitSyncRunRecoverySnapshotNow') {
    (async () => {
      const response = await runCanvasGitSyncBackgroundRecoverySnapshot('manual-message');
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitReadFile') {
    (async () => {
      const response = await handleCanvasGitReadFileMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitReadBlobBySha') {
    (async () => {
      const response = await handleCanvasGitReadBlobByShaMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitTestConfig') {
    (async () => {
      const response = await handleCanvasGitTestConfigMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitWriteFile') {
    (async () => {
      const response = await handleCanvasGitWriteFileMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitApplyFilesBatch') {
    (async () => {
      const response = await handleCanvasGitApplyFilesBatchMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitDeleteFile') {
    (async () => {
      const response = await handleCanvasGitDeleteFileMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitListFiles') {
    (async () => {
      const response = await handleCanvasGitListFilesMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitReadRemoteSignal') {
    (async () => {
      const response = await handleCanvasGitReadRemoteSignalMessage(message);
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasFetchFaviconDataUrl') {
    (async () => {
      try {
        const url = typeof message.url === 'string' ? message.url : '';
        const includeMeta = message.includeMeta === true;
        const dataResult = await fetchImageAsDataUrl(url, {
          minDimensionPx: Number(message.minDimensionPx) || 1,
          maxBytes: Number(message.maxBytes) || (512 * 1024),
          timeoutMs: Number(message.timeoutMs) || 4000,
          includeMeta
        });
        const dataUrl = includeMeta
          ? (dataResult && typeof dataResult.dataUrl === 'string' ? dataResult.dataUrl : '')
          : (typeof dataResult === 'string' ? dataResult : '');
        sendResponse({
          success: true,
          dataUrl,
          meta: includeMeta && dataResult && typeof dataResult.meta === 'object' ? dataResult.meta : null
        });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message.action === 'getBookmarkSnapshot') {
    browserAPI.bookmarks.getTree((tree) => {
      sendResponse({ success: true, tree });
    });
    return true;
  }

  if (message.action === 'extensionBookmarkOpen') {
    sendResponse({ success: true });
    return;
  }

  sendResponse({ success: false, error: 'Unsupported action' });
});

clearExtensionBadge();
