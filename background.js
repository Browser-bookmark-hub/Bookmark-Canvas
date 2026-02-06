// Minimal background for Bookmark Canvas extension (MV3)

import { upsertRepoFile } from './github/repo-api.js';

const browserAPI = (function () {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  throw new Error('Unsupported browser');
})();

function initSidePanel() {
  if (!browserAPI?.sidePanel?.setPanelBehavior) return;
  try {
    // Keep popup as the default action; side panel opens via explicit button.
    browserAPI.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }, () => {});
  } catch (_) {}
}

const SIDE_PANEL_CONTEXT = browserAPI?.runtime?.ContextType?.SIDE_PANEL || 'SIDE_PANEL';
const sidePanelOpenWindows = new Set();

function registerSidePanelStateListeners() {
  if (browserAPI?.sidePanel?.onOpened?.addListener) {
    browserAPI.sidePanel.onOpened.addListener((info) => {
      if (info && typeof info.windowId === 'number') {
        sidePanelOpenWindows.add(info.windowId);
      }
    });
  }
  if (browserAPI?.sidePanel?.onClosed?.addListener) {
    browserAPI.sidePanel.onClosed.addListener((info) => {
      if (info && typeof info.windowId === 'number') {
        sidePanelOpenWindows.delete(info.windowId);
      }
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
  if (!contexts) return null;
  sidePanelOpenWindows.clear();
  contexts.forEach((ctx) => {
    if (ctx && typeof ctx.windowId === 'number') {
      sidePanelOpenWindows.add(ctx.windowId);
    }
  });
  return contexts;
}

if (browserAPI?.runtime?.onInstalled) {
  browserAPI.runtime.onInstalled.addListener(() => {
    initSidePanel();
    registerSidePanelStateListeners();
    refreshSidePanelOpenWindows().catch(() => {});
  });
}

initSidePanel();
registerSidePanelStateListeners();
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

function openSidePanelFromCommand() {
  if (!browserAPI?.sidePanel?.open) {
    openCanvasViewFromCommand();
    return;
  }

  try {
    if (browserAPI?.windows?.getCurrent) {
      browserAPI.windows.getCurrent((win) => {
        const windowId = win && typeof win.id === 'number' ? win.id : null;
        if (windowId == null) {
          openCanvasViewFromCommand();
          return;
        }

        const canClose = typeof browserAPI?.sidePanel?.close === 'function';
        if (canClose && sidePanelOpenWindows.has(windowId)) {
          try {
            browserAPI.sidePanel.close({ windowId }, () => {
              const err = browserAPI?.runtime?.lastError;
              if (!err) {
                sidePanelOpenWindows.delete(windowId);
              }
            });
          } catch (_) {}
          return;
        }

        try {
          browserAPI.sidePanel.open({ windowId }, () => {
            if (browserAPI?.runtime?.lastError) {
              openCanvasViewFromCommand();
              return;
            }
            sidePanelOpenWindows.add(windowId);
          });
        } catch (_) {
          openCanvasViewFromCommand();
        }
      });
      return;
    }
    openCanvasViewFromCommand();
  } catch (_) {
    openCanvasViewFromCommand();
  }
}

if (browserAPI.commands && browserAPI.commands.onCommand) {
  browserAPI.commands.onCommand.addListener((command) => {
    if (command === 'open_canvas_view') {
      openCanvasViewFromCommand();
      return;
    }
    if (command === 'open_side_panel') {
      openSidePanelFromCommand();
    }
  });
}

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !message.action) {
    sendResponse({ success: false, error: 'Invalid message' });
    return;
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
