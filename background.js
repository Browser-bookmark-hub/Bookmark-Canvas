// Minimal background for Bookmark Canvas extension (MV3)

import { upsertRepoFile } from './github/repo-api.js';

const browserAPI = (function () {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  throw new Error('Unsupported browser');
})();

const SIDE_PANEL_CANVAS_PATH = 'history_html/history.html?view=canvas&sidepanel=1';

function initSidePanel() {
  if (!browserAPI?.sidePanel) return;
  try {
    // Bind "Activate extension" action to the side panel.
    if (browserAPI.sidePanel.setPanelBehavior) {
      browserAPI.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }, () => {});
    }
  } catch (_) {}
  try {
    if (browserAPI.sidePanel.setOptions) {
      browserAPI.sidePanel.setOptions({ path: SIDE_PANEL_CANVAS_PATH, enabled: true }, () => {});
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

async function setSidePanelOptionsForWindow(windowId, enabled = true) {
  if (typeof browserAPI?.sidePanel?.setOptions !== 'function') {
    return { success: true };
  }

  const baseOptions = enabled
    ? { path: SIDE_PANEL_CANVAS_PATH, enabled: true }
    : { enabled: false };

  const candidates = [];
  if (typeof windowId === 'number') {
    candidates.push({ ...baseOptions, windowId });
  }
  candidates.push(baseOptions);

  let last = { success: false, error: 'set_options_failed' };
  for (const opts of candidates) {
    const result = await new Promise((resolve) => {
      try {
        browserAPI.sidePanel.setOptions(opts, () => {
          const err = browserAPI?.runtime?.lastError;
          if (err) {
            resolve({ success: false, error: err.message || 'set_options_failed' });
            return;
          }
          resolve({ success: true });
        });
      } catch (error) {
        resolve({ success: false, error: error?.message || 'set_options_failed' });
      }
    });

    if (result && result.success) return result;
    last = result || last;
  }

  return last;
}

async function openSidePanelInWindow(windowId) {
  if (typeof windowId !== 'number') {
    return { success: false, error: 'window_unavailable' };
  }
  if (typeof browserAPI?.sidePanel?.open !== 'function') {
    return { success: false, error: 'open_unavailable' };
  }

  const configured = await setSidePanelOptionsForWindow(windowId, true);
  if (!configured || configured.success !== true) {
    return { success: false, error: configured?.error || 'set_options_failed' };
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
  });
}

initSidePanel();
registerSidePanelTogglePortListener();
refreshSidePanelOpenWindows().catch(() => {});

const RECENT_MOVED_IDS_KEY = 'canvas_recent_moved_ids_v1';
const RECENT_MOVED_MAX = 2000;
const CANVAS_CHANGE_LOG_KEY = 'canvas_change_log_v1';
const CHANGE_LOG_MAX = 10000;

// Favicon broadcast (align with reference project)
const processedFavicons = new Map();
const FAVICON_UPDATE_COOLDOWN = 5000;

async function fetchImageAsDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    return null;
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

      const dataUrl = await fetchImageAsDataUrl(changeInfo.favIconUrl || tab.favIconUrl);
      try {
        browserAPI.runtime.sendMessage({
          action: 'updateFaviconFromTab',
          url: tab.url,
          favIconUrl: dataUrl || changeInfo.favIconUrl || tab.favIconUrl
        }).catch(() => {});
      } catch (_) {}
    } catch (_) {}
  });
}

async function recordRecentMovedId(id) {
  try {
    const now = Date.now();
    const data = await browserAPI.storage.local.get([RECENT_MOVED_IDS_KEY]);
    const list = Array.isArray(data[RECENT_MOVED_IDS_KEY]) ? data[RECENT_MOVED_IDS_KEY] : [];
    const filtered = list.filter(item => item && (typeof item.expiry !== 'number' || item.expiry > now));
    const key = String(id);
    const idx = filtered.findIndex(item => String(item.id) === key);
    const entry = { id: key, expiry: Infinity, time: now };
    if (idx >= 0) {
      filtered[idx] = entry;
    } else {
      filtered.push(entry);
    }
    if (filtered.length > RECENT_MOVED_MAX) {
      filtered.splice(0, filtered.length - RECENT_MOVED_MAX);
    }
    await browserAPI.storage.local.set({ [RECENT_MOVED_IDS_KEY]: filtered });
  } catch (_) {}
}

function __normalizeChangeLog(raw) {
  const base = { updatedAt: 0, changes: {}, version: 1 };
  if (!raw || typeof raw !== 'object') return base;
  const changes = raw.changes && typeof raw.changes === 'object' ? raw.changes : {};
  return {
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    changes,
    version: raw.version || 1
  };
}

async function __loadChangeLog() {
  try {
    const data = await browserAPI.storage.local.get([CANVAS_CHANGE_LOG_KEY]);
    return __normalizeChangeLog(data && data[CANVAS_CHANGE_LOG_KEY]);
  } catch (_) {
    return { updatedAt: 0, changes: {}, version: 1 };
  }
}

async function __saveChangeLog(log) {
  try {
    await browserAPI.storage.local.set({ [CANVAS_CHANGE_LOG_KEY]: log });
  } catch (_) { }
}

function __mergeType(existingType, nextType) {
  const types = new Set(String(existingType || '').split('+').filter(Boolean));
  types.add(nextType);
  return Array.from(types).join('+');
}

async function __updateChangeLogForCreate(id) {
  if (!id) return;
  const key = String(id);
  const log = await __loadChangeLog();
  log.changes[key] = { type: 'added', ts: Date.now() };
  log.updatedAt = Date.now();
  if (Object.keys(log.changes).length > CHANGE_LOG_MAX) {
    // Soft cap: drop oldest by timestamp
    const entries = Object.entries(log.changes);
    entries.sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
    const overflow = entries.length - CHANGE_LOG_MAX;
    if (overflow > 0) {
      for (let i = 0; i < overflow; i++) {
        delete log.changes[entries[i][0]];
      }
    }
  }
  await __saveChangeLog(log);
}

async function __updateChangeLogForRemove(id, removeInfo) {
  if (!id) return;
  const key = String(id);
  const log = await __loadChangeLog();
  const existing = log.changes[key];
  if (existing && existing.type && String(existing.type).includes('added')) {
    delete log.changes[key];
    log.updatedAt = Date.now();
    await __saveChangeLog(log);
    return;
  }
  const oldParentId = (removeInfo && typeof removeInfo.parentId !== 'undefined')
    ? removeInfo.parentId
    : (removeInfo && removeInfo.node && typeof removeInfo.node.parentId !== 'undefined' ? removeInfo.node.parentId : null);
  const oldIndex = (removeInfo && typeof removeInfo.index === 'number')
    ? removeInfo.index
    : (removeInfo && removeInfo.node && typeof removeInfo.node.index === 'number' ? removeInfo.node.index : null);
  log.changes[key] = {
    type: 'deleted',
    deleted: {
      oldParentId: oldParentId != null ? oldParentId : null,
      oldIndex: oldIndex != null ? oldIndex : null
    },
    ts: Date.now()
  };
  log.updatedAt = Date.now();
  await __saveChangeLog(log);
}

async function __updateChangeLogForChange(id) {
  if (!id) return;
  const key = String(id);
  const log = await __loadChangeLog();
  const existing = log.changes[key];
  if (existing && existing.type && (String(existing.type).includes('deleted') || String(existing.type).includes('added'))) {
    return;
  }
  const next = existing ? { ...existing } : { type: '' };
  next.type = __mergeType(next.type, 'modified');
  next.ts = Date.now();
  log.changes[key] = next;
  log.updatedAt = Date.now();
  await __saveChangeLog(log);
}

async function __updateChangeLogForMove(id, moveInfo) {
  if (!id) return;
  const key = String(id);
  const log = await __loadChangeLog();
  const existing = log.changes[key];
  if (existing && existing.type && (String(existing.type).includes('deleted') || String(existing.type).includes('added'))) {
    return;
  }
  const next = existing ? { ...existing } : { type: '' };
  next.type = __mergeType(next.type, 'moved');
  if (moveInfo && typeof moveInfo === 'object') {
    next.moved = {
      oldParentId: moveInfo.oldParentId,
      oldIndex: moveInfo.oldIndex,
      newParentId: moveInfo.parentId,
      newIndex: moveInfo.index
    };
  }
  next.ts = Date.now();
  log.changes[key] = next;
  log.updatedAt = Date.now();
  await __saveChangeLog(log);
}

if (browserAPI.bookmarks && browserAPI.bookmarks.onMoved) {
  browserAPI.bookmarks.onMoved.addListener(async (id, moveInfo) => {
    try {
      await recordRecentMovedId(id);
      browserAPI.runtime.sendMessage({ action: 'recentMovedBroadcast', id }).catch(() => {});
      await __updateChangeLogForMove(id, moveInfo);
    } catch (_) {}
  });
}

if (browserAPI.bookmarks && browserAPI.bookmarks.onChanged) {
  browserAPI.bookmarks.onChanged.addListener((id, changeInfo) => {
    try {
      if (changeInfo && changeInfo.url) {
        browserAPI.runtime.sendMessage({
          action: 'clearFaviconCache',
          url: changeInfo.url
        }).catch(() => {});
      }
      __updateChangeLogForChange(id).catch(() => {});
    } catch (_) {}
  });
}

if (browserAPI.bookmarks && browserAPI.bookmarks.onCreated) {
  browserAPI.bookmarks.onCreated.addListener((id) => {
    try {
      __updateChangeLogForCreate(id).catch(() => {});
    } catch (_) {}
  });
}

if (browserAPI.bookmarks && browserAPI.bookmarks.onRemoved) {
  browserAPI.bookmarks.onRemoved.addListener((id, removeInfo) => {
    try {
      __updateChangeLogForRemove(id, removeInfo).catch(() => {});
    } catch (_) {}
  });
}

async function getCurrentLang() {
  try {
    const { currentLang, preferredLang } = await browserAPI.storage.local.get(['currentLang', 'preferredLang']);
    if (currentLang || preferredLang) return currentLang || preferredLang;
    try {
      const ui = (browserAPI?.i18n?.getUILanguage?.() || '').toLowerCase();
      return ui.startsWith('zh') ? 'zh_CN' : 'en';
    } catch (_) {}
    return 'en';
  } catch (_) {
    try {
      const ui = (browserAPI?.i18n?.getUILanguage?.() || '').toLowerCase();
      return ui.startsWith('zh') ? 'zh_CN' : 'en';
    } catch (_) {}
    return 'en';
  }
}

function getExportRootFolderByLang(lang) {
  return lang === 'zh_CN' ? '书签画布' : 'Bookmark Canvas';
}

function getCanvasFolderByLang(lang) {
  return lang === 'zh_CN' ? '书签画布' : 'Canvas';
}

function resolveExportSubFolderByKey(folderKey, lang) {
  const key = String(folderKey || '').trim();
  switch (key) {
    case 'canvas':
      return getCanvasFolderByLang(lang);
    default:
      return getCanvasFolderByLang(lang);
  }
}

function safeBase64(str) {
  try {
    return btoa(str);
  } catch (_) {
    return btoa(unescape(encodeURIComponent(str)));
  }
}

function sanitizeGitHubRepoPathPart(part) {
  let s = String(part == null ? '' : part);
  s = s.replace(/[\x00-\x1F\x7F]/g, '');
  s = s.replace(/[\\/]/g, '_');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function buildGitHubRepoFilePath({ basePath, lang, folderKey, fileName }) {
  const baseRaw = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  const baseParts = baseRaw
    ? baseRaw.split('/').filter(Boolean).map(sanitizeGitHubRepoPathPart).filter(Boolean)
    : [];
  const root = sanitizeGitHubRepoPathPart(getExportRootFolderByLang(lang));
  const sub = sanitizeGitHubRepoPathPart(resolveExportSubFolderByKey(folderKey, lang));
  const leaf = sanitizeGitHubRepoPathPart(String(fileName || '').split('/').pop());
  const joined = [...baseParts, root, sub, leaf].filter(Boolean).join('/');
  return joined || 'export.txt';
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function textToBase64(text) {
  const encoder = new TextEncoder();
  const buf = encoder.encode(String(text ?? '')).buffer;
  return arrayBufferToBase64(buf);
}

async function ensureWebDAVCollectionExists(url, authHeader, errorPrefix) {
  const checkResponse = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      'Authorization': authHeader,
      'Depth': '0',
      'Content-Type': 'application/xml'
    },
    body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
  });

  if (checkResponse.status === 401) {
    throw new Error('WebDAV认证失败，请检查账号密码是否正确');
  }

  if (checkResponse.status === 404) {
    const mkcolResponse = await fetch(url, {
      method: 'MKCOL',
      headers: { 'Authorization': authHeader }
    });
    if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
      throw new Error(`${errorPrefix}: ${mkcolResponse.status} - ${mkcolResponse.statusText}`);
    }
    return;
  }

  if (!checkResponse.ok) {
    throw new Error(`${errorPrefix}: ${checkResponse.status} - ${checkResponse.statusText}`);
  }
}

async function uploadExportFileToWebDAV({ lang, folderKey, fileName, content, contentArrayBuffer, contentType }) {
  const config = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);
  if (!config.serverAddress || !config.username || !config.password) {
    return { success: false, skipped: true, error: 'WebDAV 配置不完整' };
  }
  if (config.webDAVEnabled === false) {
    return { success: false, skipped: true, error: 'WebDAV 已禁用' };
  }

  const serverAddress = config.serverAddress.replace(/\/+$/, '/');
  const exportRootFolder = getExportRootFolderByLang(lang);
  const exportSubFolder = resolveExportSubFolderByKey(folderKey, lang);
  const folderPath = `${exportRootFolder}/${exportSubFolder}/`;

  const fullUrl = `${serverAddress}${folderPath}${fileName}`;
  const folderUrl = `${serverAddress}${folderPath}`;
  const parentFolderUrl = `${serverAddress}${exportRootFolder}/`;

  const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

  try {
    await ensureWebDAVCollectionExists(parentFolderUrl, authHeader, '创建父文件夹失败');
    await ensureWebDAVCollectionExists(folderUrl, authHeader, '创建导出文件夹失败');

    const response = await fetch(fullUrl, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': contentType || 'application/json;charset=utf-8',
        'Overwrite': 'T'
      },
      body: contentArrayBuffer ? contentArrayBuffer : String(content ?? '')
    });

    if (!response.ok) {
      throw new Error(`上传失败: ${response.status} - ${response.statusText}`);
    }

    return { success: true };
  } catch (error) {
    if (String(error?.message || '').includes('Failed to fetch')) {
      return { success: false, error: '无法连接到WebDAV服务器，请检查地址是否正确或网络是否正常' };
    }
    return { success: false, error: error?.message || '上传到WebDAV失败' };
  }
}

async function uploadExportFileToGitHubRepo({ lang, folderKey, fileName, content, contentArrayBuffer }) {
  const config = await browserAPI.storage.local.get([
    'githubRepoToken',
    'githubRepoOwner',
    'githubRepoName',
    'githubRepoBranch',
    'githubRepoBasePath',
    'githubRepoEnabled'
  ]);

  if (!config.githubRepoToken) {
    return { success: false, skipped: true, error: 'GitHub Token 未配置' };
  }
  if (!config.githubRepoOwner || !config.githubRepoName) {
    return { success: false, skipped: true, error: '仓库未配置' };
  }
  if (config.githubRepoEnabled === false) {
    return { success: false, skipped: true, error: 'GitHub 仓库已禁用' };
  }

  const filePath = buildGitHubRepoFilePath({ basePath: config.githubRepoBasePath, lang, folderKey, fileName });
  const leaf = String(fileName || '').split('/').pop() || 'export';
  const commitMessage = `Bookmark Canvas: export ${folderKey} ${leaf}`;
  const contentBase64 = contentArrayBuffer ? arrayBufferToBase64(contentArrayBuffer) : textToBase64(content);

  try {
    const result = await upsertRepoFile({
      token: config.githubRepoToken,
      owner: config.githubRepoOwner,
      repo: config.githubRepoName,
      branch: config.githubRepoBranch,
      path: filePath,
      message: commitMessage,
      contentBase64
    });

    if (result && result.success === true) {
      return { success: true, path: result.path || filePath, htmlUrl: result.htmlUrl || null };
    }

    return { success: false, error: result?.error || '上传到 GitHub 仓库失败' };
  } catch (error) {
    return { success: false, error: error?.message || '上传到 GitHub 仓库失败' };
  }
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

  if (message.action === 'exportFileToClouds') {
    (async () => {
      try {
        const fileName = String(message.fileName || '').trim();
        const folderKey = String(message.folderKey || '').trim();
        const contentType = message.contentType;
        let contentArrayBuffer = message.contentArrayBuffer || null;

        if (!contentArrayBuffer && message.contentBase64Binary) {
          try {
            const base64 = message.contentBase64Binary;
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            contentArrayBuffer = bytes.buffer;
          } catch (e) {
            console.error('[exportFileToClouds] Base64 解码失败:', e);
          }
        }

        const content = message.content;
        if (!fileName) throw new Error('缺少文件名');
        if (!folderKey) throw new Error('缺少导出类型');
        if (!contentArrayBuffer && (content == null || content === '')) throw new Error('缺少导出内容');

        const lang = message.lang || await getCurrentLang();

        const [webdav, githubRepo] = await Promise.all([
          uploadExportFileToWebDAV({
            lang,
            folderKey,
            fileName,
            content,
            contentArrayBuffer,
            contentType
          }),
          uploadExportFileToGitHubRepo({
            lang,
            folderKey,
            fileName,
            content,
            contentArrayBuffer
          })
        ]);

        const success =
          (webdav && webdav.success === true) || (githubRepo && githubRepo.success === true);

        sendResponse({ success, webdav, githubRepo });
      } catch (error) {
        sendResponse({ success: false, error: error?.message || '导出到云端失败' });
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
