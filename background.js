// Minimal background for Bookmark Canvas extension (MV3)

import { getRepoFile, testRepoConnection, upsertRepoFile } from './github/repo-api.js';

const browserAPI = (function () {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  throw new Error('Unsupported browser');
})();

const MARKER_BADGE_TEXT_MAX = 99;
const MARKER_BADGE_DEFAULT_BG = '#fbbc04';
const MARKER_BADGE_TEXT_COLOR = '#000000';
const MARKER_BADGE_COLOR_STORAGE_KEY = 'canvas_marker_badge_color_v1';
const MARKER_SETTINGS_KEY = 'canvas_marker_settings_v1';

function normalizeMarkerBadgeText(markerCount) {
  const n = Number(markerCount);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > MARKER_BADGE_TEXT_MAX) return `${MARKER_BADGE_TEXT_MAX}+`;
  return String(Math.floor(n));
}

function normalizeHexColor(value, fallback = MARKER_BADGE_DEFAULT_BG) {
  const raw = String(value || '').trim();
  const six = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (six) return `#${six[1].toUpperCase()}`;
  const three = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (three) {
    const short = three[1].toUpperCase();
    return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
  }
  const fallbackSix = String(fallback || MARKER_BADGE_DEFAULT_BG).trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (fallbackSix) return `#${fallbackSix[1].toUpperCase()}`;
  return MARKER_BADGE_DEFAULT_BG;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  const value = normalized.replace('#', '');
  const num = Number.parseInt(value, 16);
  if (!Number.isFinite(num)) return null;
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff
  };
}

function calculateRelativeLuminance(rgb) {
  if (!rgb) return 1;
  const toLinear = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const linearR = toLinear(rgb.r);
  const linearG = toLinear(rgb.g);
  const linearB = toLinear(rgb.b);
  return (0.2126 * linearR) + (0.7152 * linearG) + (0.0722 * linearB);
}

function pickReadableTextColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#1F2937';
  const luminance = calculateRelativeLuminance(rgb);
  return luminance > 0.6 ? '#1F2937' : '#FFFFFF';
}

function setMarkerBadgeState(hasMarkers, markerCount, badgeColorHex = MARKER_BADGE_DEFAULT_BG) {
  try {
    if (!browserAPI?.action || typeof browserAPI.action.setBadgeText !== 'function') return;

    const badgeBgColor = normalizeHexColor(badgeColorHex, MARKER_BADGE_DEFAULT_BG);
    const badgeTextColor = MARKER_BADGE_TEXT_COLOR;
    const text = hasMarkers ? normalizeMarkerBadgeText(markerCount) : '';
    browserAPI.action.setBadgeText({ text }, () => {
      try {
        const err = browserAPI?.runtime?.lastError;
        if (err && err.message) {
          // ignore
        }
      } catch (_) { }
    });

    if (!text) return;

    if (typeof browserAPI.action.setBadgeBackgroundColor === 'function') {
      browserAPI.action.setBadgeBackgroundColor({ color: badgeBgColor }, () => {
        try {
          const err = browserAPI?.runtime?.lastError;
          if (err && err.message) {
            // ignore
          }
        } catch (_) { }
      });
    }
    if (typeof browserAPI.action.setBadgeTextColor === 'function') {
      browserAPI.action.setBadgeTextColor({ color: badgeTextColor }, () => {
        try {
          const err = browserAPI?.runtime?.lastError;
          if (err && err.message) {
            // ignore
          }
        } catch (_) { }
      });
    }
  } catch (_) { }
}

let markerBadgeStateCache = { hasMarkers: null, markerCount: null, badgeColor: null };

function countChangeLogEntries(rawLog) {
  if (!rawLog || typeof rawLog !== 'object') return 0;
  const changes = rawLog.changes;
  if (!changes || typeof changes !== 'object') return 0;
  return Object.keys(changes).length;
}

function countActiveRecentMovedEntries(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return 0;
  const now = Date.now();
  const activeIds = new Set();
  rawList.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const key = item.id != null ? String(item.id) : '';
    if (!key) return;
    if (typeof item.expiry === 'number' && Number.isFinite(item.expiry) && item.expiry <= now) return;
    activeIds.add(key);
  });
  return activeIds.size;
}

function evaluateMarkerBadgeStateFromStorageSnapshot(snapshot) {
  const markerSettings = snapshot && snapshot[MARKER_SETTINGS_KEY];
  const markerEnabled = !(markerSettings && typeof markerSettings === 'object' && markerSettings.enabled === false);
  if (!markerEnabled) {
    return { hasMarkers: false, markerCount: 0 };
  }

  const changeCount = countChangeLogEntries(snapshot && snapshot[CANVAS_CHANGE_LOG_KEY]);
  if (changeCount > 0) {
    return { hasMarkers: true, markerCount: changeCount };
  }

  const movedCount = countActiveRecentMovedEntries(snapshot && snapshot[RECENT_MOVED_IDS_KEY]);
  if (movedCount > 0) {
    return { hasMarkers: true, markerCount: movedCount };
  }

  return { hasMarkers: false, markerCount: 0 };
}

function applyMarkerBadgeStateIfNeeded(state) {
  const normalized = {
    hasMarkers: !!(state && state.hasMarkers),
    markerCount: Math.max(0, Math.floor(Number(state && state.markerCount) || 0)),
    badgeColor: normalizeHexColor(state && state.badgeColor, MARKER_BADGE_DEFAULT_BG)
  };

  if (!normalized.hasMarkers) {
    normalized.markerCount = 0;
  }

  if (
    markerBadgeStateCache.hasMarkers === normalized.hasMarkers
    && markerBadgeStateCache.markerCount === normalized.markerCount
    && markerBadgeStateCache.badgeColor === normalized.badgeColor
  ) {
    return;
  }

  markerBadgeStateCache = normalized;
  setMarkerBadgeState(normalized.hasMarkers, normalized.markerCount, normalized.badgeColor);
}

async function refreshMarkerBadgeFromStorage() {
  try {
    if (!browserAPI?.storage?.local) return;
    const snapshot = await browserAPI.storage.local.get([
      MARKER_SETTINGS_KEY,
      CANVAS_CHANGE_LOG_KEY,
      RECENT_MOVED_IDS_KEY,
      MARKER_BADGE_COLOR_STORAGE_KEY
    ]);
    const state = evaluateMarkerBadgeStateFromStorageSnapshot(snapshot || {});
    state.badgeColor = normalizeHexColor(snapshot && snapshot[MARKER_BADGE_COLOR_STORAGE_KEY], MARKER_BADGE_DEFAULT_BG);
    applyMarkerBadgeStateIfNeeded(state);
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
    refreshMarkerBadgeFromStorage().catch(() => {});
  });
}

try {
  if (browserAPI?.runtime?.onStartup?.addListener) {
    browserAPI.runtime.onStartup.addListener(() => {
      refreshMarkerBadgeFromStorage().catch(() => {});
    });
  }
} catch (_) { }

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

function __serializeRemovedNodeSnapshot(node) {
  if (!node || typeof node !== 'object') return null;
  const out = {
    id: (typeof node.id !== 'undefined' && node.id !== null) ? String(node.id) : '',
    title: typeof node.title === 'string' ? node.title : ''
  };
  if (typeof node.parentId !== 'undefined' && node.parentId !== null) {
    out.parentId = String(node.parentId);
  }
  if (typeof node.index === 'number') {
    out.index = node.index;
  }
  if (typeof node.url === 'string' && node.url) {
    out.url = node.url;
  }
  if (Array.isArray(node.children) && node.children.length) {
    const children = node.children
      .map(child => __serializeRemovedNodeSnapshot(child))
      .filter(Boolean);
    if (children.length) out.children = children;
  }
  return out;
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
  const oldParentId = (removeInfo && typeof removeInfo.parentId !== 'undefined')
    ? removeInfo.parentId
    : (removeInfo && removeInfo.node && typeof removeInfo.node.parentId !== 'undefined' ? removeInfo.node.parentId : null);
  const oldIndex = (removeInfo && typeof removeInfo.index === 'number')
    ? removeInfo.index
    : (removeInfo && removeInfo.node && typeof removeInfo.node.index === 'number' ? removeInfo.node.index : null);
  const nodeSnapshot = __serializeRemovedNodeSnapshot(removeInfo && removeInfo.node);
  if (nodeSnapshot) {
    nodeSnapshot.id = key;
    if (typeof nodeSnapshot.parentId === 'undefined' && oldParentId != null) {
      nodeSnapshot.parentId = String(oldParentId);
    }
    if (typeof nodeSnapshot.index !== 'number' && oldIndex != null) {
      nodeSnapshot.index = oldIndex;
    }
  }
  log.changes[key] = {
    type: 'deleted',
    deleted: {
      oldParentId: oldParentId != null ? oldParentId : null,
      oldIndex: oldIndex != null ? oldIndex : null,
      ...(nodeSnapshot ? { nodeSnapshot } : {})
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

if (browserAPI?.storage?.onChanged?.addListener) {
  browserAPI.storage.onChanged.addListener((changes, areaName) => {
    try {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') return;
      if (!changes[CANVAS_CHANGE_LOG_KEY] && !changes[RECENT_MOVED_IDS_KEY] && !changes[MARKER_SETTINGS_KEY] && !changes[MARKER_BADGE_COLOR_STORAGE_KEY]) {
        return;
      }
      refreshMarkerBadgeFromStorage().catch(() => {});
    } catch (_) { }
  });
}

const CANVAS_GIT_SYNC_FILE_NAME = 'bookmark-canvas-sync/state.json';

function normalizeGitHubRepoPath(path) {
  return String(path || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');
}

function buildCanvasGitSyncPath(basePath) {
  const normalizedBasePath = normalizeGitHubRepoPath(basePath);
  return normalizedBasePath
    ? `${normalizedBasePath}/${CANVAS_GIT_SYNC_FILE_NAME}`
    : CANVAS_GIT_SYNC_FILE_NAME;
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

async function handleCanvasGitReadStateMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const filePath = normalizeGitHubRepoPath(message.path) || buildCanvasGitSyncPath(gitConfig.basePath);

  const result = await getRepoFile({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: filePath
  });

  if (!result || result.success !== true) {
    if (result && result.notFound === true) {
      return { success: true, notFound: true, path: filePath };
    }
    return { success: false, error: result?.error || '读取同步文件失败', path: filePath };
  }

  return {
    success: true,
    path: result.path || filePath,
    sha: result.sha || null,
    encoding: result.encoding || 'base64',
    contentBase64: result.contentBase64 || ''
  };
}

async function handleCanvasGitWriteStateMessage(message) {
  const gitConfig = await resolveCanvasGitConfig();
  if (!gitConfig.success) {
    return { success: false, error: gitConfig.error };
  }

  const filePath = normalizeGitHubRepoPath(message.path) || buildCanvasGitSyncPath(gitConfig.basePath);
  const contentBase64 = String(message.contentBase64 || '').trim();
  const contentText = message.content;
  const resolvedContentBase64 = contentBase64 || textToBase64(contentText);

  if (!resolvedContentBase64) {
    return { success: false, error: '缺少同步内容', path: filePath };
  }

  const commitMessage = String(message.commitMessage || '').trim() || 'Bookmark Canvas Sync: update state';
  const result = await upsertRepoFile({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: filePath,
    message: commitMessage,
    contentBase64: resolvedContentBase64
  });

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '写入同步文件失败', path: filePath };
  }

  return {
    success: true,
    path: result.path || filePath,
    htmlUrl: result.htmlUrl || null,
    fileSha: result.fileSha || null,
    commitSha: result.commitSha || null,
    created: result.created === true
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

  if (message.action === 'canvasGitReadState') {
    (async () => {
      const response = await handleCanvasGitReadStateMessage(message);
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

  if (message.action === 'canvasGitWriteState') {
    (async () => {
      const response = await handleCanvasGitWriteStateMessage(message);
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

refreshMarkerBadgeFromStorage().catch(() => {});
