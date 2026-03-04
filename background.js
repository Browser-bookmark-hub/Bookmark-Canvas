// Minimal background for Bookmark Canvas extension (MV3)

import { applyRepoFilesBatch, deleteRepoFile, getRepoBranchHeadSignal, getRepoFile, listRepoFiles, testRepoConnection, upsertRepoFile } from './github/repo-api.js';

const browserAPI = (function () {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  throw new Error('Unsupported browser');
})();

const MARKER_BADGE_TEXT_MAX = 99;
const MARKER_BADGE_IDLE_BG = '#3B82F6';
const MARKER_BADGE_ATTENTION_BG = '#F59E0B';
const MARKER_BADGE_IDLE_SYMBOL_TEXT = '－';
const MARKER_BADGE_ATTENTION_SYMBOL_TEXT = '≠';
const MARKER_BADGE_TEXT_COLOR = '#000000';
const MARKER_BADGE_COLOR_STORAGE_KEY = 'canvas_marker_badge_color_v1';
const MARKER_SETTINGS_KEY = 'canvas_marker_settings_v1';
const CANVAS_GIT_SYNC_BG_STATE_KEY = 'canvas-obsidian-git-sync-background-state-v1';
const CANVAS_GIT_SYNC_BACKGROUND_ALARM = 'canvas-obsidian-git-sync-background-check-v1';
const CANVAS_GIT_SYNC_BG_IDLE_STREAK_LIMIT = 2;
const CANVAS_GIT_SYNC_BG_DEFAULT_INTERVAL_MINUTES = 1;
const CANVAS_GIT_SYNC_BG_COOLDOWN_MINUTES = 5;
const CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT = {
  enabled: false,
  autoSync: true,
  splitIntervalCommitAndSync: false,
  intervalSeconds: 120,
  autoPushIntervalMinutes: 2,
  autoPullIntervalMinutes: 5,
  obsidianExportRoot: '书签画布',
  mismatchPolicy: 'prompt',
  backgroundCheckEnabled: true,
  backgroundCheckIntervalMinutes: CANVAS_GIT_SYNC_BG_DEFAULT_INTERVAL_MINUTES,
  backgroundCooldownMinutes: CANVAS_GIT_SYNC_BG_COOLDOWN_MINUTES
};

const DEFAULT_CANVAS_GIT_SYNC_BG_RUNTIME = {
  lastRemoteSha: '',
  lastRemoteCommittedAt: 0,
  lastLocalHash: '',
  lastSuccessAt: 0,
  lastLocalMutationAt: 0,
  pendingMismatch: false,
  pendingMismatchRemoteSha: '',
  pendingMismatchUpdatedAt: 0,
  hasPendingWork: false,
  localDirty: false,
  idleStreak: 0,
  nextCheckAt: 0,
  lastCheckAt: 0,
  lastCheckRemoteSha: '',
  lastCheckError: ''
};

function normalizeMarkerBadgeText(markerCount) {
  const n = Number(markerCount);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > MARKER_BADGE_TEXT_MAX) return `${MARKER_BADGE_TEXT_MAX}+`;
  return String(Math.floor(n));
}

function normalizeHexColor(value, fallback = MARKER_BADGE_IDLE_BG) {
  const raw = String(value || '').trim();
  const six = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (six) return `#${six[1].toUpperCase()}`;
  const three = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (three) {
    const short = three[1].toUpperCase();
    return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
  }
  const fallbackSix = String(fallback || MARKER_BADGE_IDLE_BG).trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (fallbackSix) return `#${fallbackSix[1].toUpperCase()}`;
  return MARKER_BADGE_IDLE_BG;
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

function setMarkerBadgeState(badgeText, badgeColorHex = MARKER_BADGE_IDLE_BG, badgeTextColorHex = MARKER_BADGE_TEXT_COLOR) {
  try {
    if (!browserAPI?.action || typeof browserAPI.action.setBadgeText !== 'function') return;

    const badgeBgColor = normalizeHexColor(badgeColorHex, MARKER_BADGE_IDLE_BG);
    const badgeTextColor = normalizeHexColor(badgeTextColorHex, MARKER_BADGE_TEXT_COLOR);
    const text = String(badgeText == null ? '' : badgeText);
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

let markerBadgeStateCache = { badgeText: null, badgeColor: null, badgeTextColor: null };
let markerBulkMuteState = { enabled: false, reason: '', startedAt: 0, ignoreUntil: 0 };

function isMarkerBulkMuteActive() {
  return !!(markerBulkMuteState && (markerBulkMuteState.enabled === true || (Number(markerBulkMuteState.ignoreUntil) || 0) > Date.now()));
}

function normalizeCanvasGitSyncBackgroundRuntime(runtimeRaw) {
  const runtime = runtimeRaw && typeof runtimeRaw === 'object' ? runtimeRaw : {};
  const pendingMismatchUpdatedAt = Number(runtime.pendingMismatchUpdatedAt);
  const pendingMismatchAt = Number(runtime.pendingMismatchAt);
  return {
    isRunning: runtime.isRunning === true,
    lastRemoteSha: typeof runtime.lastRemoteSha === 'string' ? runtime.lastRemoteSha : '',
    lastRemoteCommittedAt: Number.isFinite(Number(runtime.lastRemoteCommittedAt)) ? Number(runtime.lastRemoteCommittedAt) : 0,
    lastLocalHash: typeof runtime.lastLocalHash === 'string' ? runtime.lastLocalHash : '',
    lastSuccessAt: Number.isFinite(Number(runtime.lastSuccessAt)) ? Number(runtime.lastSuccessAt) : 0,
    lastLocalMutationAt: Number.isFinite(Number(runtime.lastLocalMutationAt)) ? Number(runtime.lastLocalMutationAt) : 0,
    pendingMismatch: runtime.pendingMismatch === true,
    pendingMismatchRemoteSha: typeof runtime.pendingMismatchRemoteSha === 'string' ? runtime.pendingMismatchRemoteSha : '',
    pendingMismatchUpdatedAt: Number.isFinite(pendingMismatchUpdatedAt)
      ? pendingMismatchUpdatedAt
      : (Number.isFinite(pendingMismatchAt) ? pendingMismatchAt : 0),
    hasPendingWork: runtime.hasPendingWork === true,
    localDirty: runtime.localDirty === true,
    idleStreak: Number.isFinite(Number(runtime.idleStreak)) ? Math.max(0, Number(runtime.idleStreak)) : 0,
    nextCheckAt: Number.isFinite(Number(runtime.nextCheckAt)) ? Number(runtime.nextCheckAt) : 0,
    lastCheckAt: Number.isFinite(Number(runtime.lastCheckAt)) ? Number(runtime.lastCheckAt) : 0,
    lastCheckRemoteSha: typeof runtime.lastCheckRemoteSha === 'string' ? runtime.lastCheckRemoteSha : '',
    lastCheckError: typeof runtime.lastCheckError === 'string' ? runtime.lastCheckError : ''
  };
}

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
  const markerNumberEnabled = !(markerSettings && typeof markerSettings === 'object' && markerSettings.enabled === false);

  const syncBgStateRaw = snapshot && snapshot[CANVAS_GIT_SYNC_BG_STATE_KEY];
  const syncBgSettings = normalizeCanvasGitSyncBackgroundSettings(syncBgStateRaw && syncBgStateRaw.settings);
  const syncEnabled = !!(syncBgSettings && syncBgSettings.enabled === true);

  if (!syncEnabled) {
    return {
      badgeText: '',
      badgeColor: MARKER_BADGE_IDLE_BG,
      badgeTextColor: MARKER_BADGE_TEXT_COLOR
    };
  }

  const changeCount = isMarkerBulkMuteActive() ? 0 : countChangeLogEntries(snapshot && snapshot[CANVAS_CHANGE_LOG_KEY]);
  const movedCount = isMarkerBulkMuteActive() ? 0 : countActiveRecentMovedEntries(snapshot && snapshot[RECENT_MOVED_IDS_KEY]);
  const markerCount = Math.max(changeCount, movedCount, 0);

  const syncBgRuntime = normalizeCanvasGitSyncBackgroundRuntime(syncBgStateRaw && syncBgStateRaw.runtime);
  const hasCloudMismatch = syncBgRuntime.pendingMismatch === true;

  if (hasCloudMismatch) {
    return {
      badgeText: MARKER_BADGE_ATTENTION_SYMBOL_TEXT,
      badgeColor: MARKER_BADGE_ATTENTION_BG,
      badgeTextColor: pickReadableTextColor(MARKER_BADGE_ATTENTION_BG)
    };
  }

  if (markerNumberEnabled && markerCount > 0) {
    return {
      badgeText: normalizeMarkerBadgeText(markerCount),
      badgeColor: MARKER_BADGE_IDLE_BG,
      badgeTextColor: pickReadableTextColor(MARKER_BADGE_IDLE_BG)
    };
  }

  return {
    badgeText: MARKER_BADGE_IDLE_SYMBOL_TEXT,
    badgeColor: MARKER_BADGE_IDLE_BG,
    badgeTextColor: pickReadableTextColor(MARKER_BADGE_IDLE_BG)
  };
}

function applyMarkerBadgeStateIfNeeded(state) {
  const normalized = {
    badgeText: String((state && state.badgeText) || ''),
    badgeColor: normalizeHexColor(state && state.badgeColor, MARKER_BADGE_IDLE_BG),
    badgeTextColor: normalizeHexColor(state && state.badgeTextColor, MARKER_BADGE_TEXT_COLOR)
  };

  if (
    markerBadgeStateCache.badgeText === normalized.badgeText
    && markerBadgeStateCache.badgeColor === normalized.badgeColor
    && markerBadgeStateCache.badgeTextColor === normalized.badgeTextColor
  ) {
    return;
  }

  markerBadgeStateCache = normalized;
  setMarkerBadgeState(normalized.badgeText, normalized.badgeColor, normalized.badgeTextColor);
}

async function refreshMarkerBadgeFromStorage() {
  try {
    if (!browserAPI?.storage?.local) return;
    const snapshot = await browserAPI.storage.local.get([
      MARKER_SETTINGS_KEY,
      CANVAS_CHANGE_LOG_KEY,
      RECENT_MOVED_IDS_KEY,
      MARKER_BADGE_COLOR_STORAGE_KEY,
      CANVAS_GIT_SYNC_BG_STATE_KEY
    ]);
    const state = evaluateMarkerBadgeStateFromStorageSnapshot(snapshot || {});
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
    restoreCanvasGitSyncBackgroundScheduling().catch(() => {});
  });
}

try {
  if (browserAPI?.runtime?.onStartup?.addListener) {
    browserAPI.runtime.onStartup.addListener(() => {
      refreshMarkerBadgeFromStorage().catch(() => {});
      restoreCanvasGitSyncBackgroundScheduling().catch(() => {});
    });
  }
} catch (_) { }

initSidePanel();
registerSidePanelTogglePortListener();
refreshSidePanelOpenWindows().catch(() => {});
restoreCanvasGitSyncBackgroundScheduling().catch(() => {});

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
  if (isMarkerBulkMuteActive()) return;
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
  if (isMarkerBulkMuteActive()) return;
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
  if (isMarkerBulkMuteActive()) return;
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
  if (isMarkerBulkMuteActive()) return;
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
      if (isMarkerBulkMuteActive()) return;
      await recordRecentMovedId(id);
      browserAPI.runtime.sendMessage({ action: 'recentMovedBroadcast', id }).catch(() => {});
      await __updateChangeLogForMove(id, moveInfo);
    } catch (_) {}
  });
}

if (browserAPI.bookmarks && browserAPI.bookmarks.onChanged) {
  browserAPI.bookmarks.onChanged.addListener((id, changeInfo) => {
    try {
      if (isMarkerBulkMuteActive()) return;
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
      if (isMarkerBulkMuteActive()) return;
      __updateChangeLogForCreate(id).catch(() => {});
    } catch (_) {}
  });
}

if (browserAPI.bookmarks && browserAPI.bookmarks.onRemoved) {
  browserAPI.bookmarks.onRemoved.addListener((id, removeInfo) => {
    try {
      if (isMarkerBulkMuteActive()) return;
      __updateChangeLogForRemove(id, removeInfo).catch(() => {});
    } catch (_) {}
  });
}

if (browserAPI?.storage?.onChanged?.addListener) {
  browserAPI.storage.onChanged.addListener((changes, areaName) => {
    try {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') return;

      if (didCanvasGitSyncTargetStorageChange(changes)) {
        ensureCanvasGitSyncBackgroundTargetState().then(async ({ state }) => {
          await scheduleCanvasGitSyncBackgroundAlarm(state);
          await refreshMarkerBadgeFromStorage();
        }).catch(() => {});
        return;
      }

      if (!changes[CANVAS_CHANGE_LOG_KEY]
        && !changes[RECENT_MOVED_IDS_KEY]
        && !changes[MARKER_SETTINGS_KEY]
        && !changes[MARKER_BADGE_COLOR_STORAGE_KEY]
        && !changes[CANVAS_GIT_SYNC_BG_STATE_KEY]) {
        return;
      }
      refreshMarkerBadgeFromStorage().catch(() => {});
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
    pendingMismatch: false,
    pendingMismatchRemoteSha: '',
    pendingMismatchUpdatedAt: 0,
    hasPendingWork: runtime.localDirty === true,
    idleStreak: 0,
    nextCheckAt: 0,
    lastCheckAt: 0,
    lastCheckRemoteSha: '',
    lastCheckError: ''
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

function normalizeCanvasGitSyncMismatchPolicy(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'auto_pull' ? 'auto_pull' : 'prompt';
}

function normalizeCanvasGitSyncBackgroundSettings(settingsRaw) {
  const source = settingsRaw && typeof settingsRaw === 'object' ? settingsRaw : {};
  return {
    enabled: source.enabled === true,
    autoSync: source.autoSync !== false,
    splitIntervalCommitAndSync: source.splitIntervalCommitAndSync === true,
    intervalSeconds: Math.max(60, Math.min(24 * 60 * 60, Math.round(toFiniteNumber(source.intervalSeconds, CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT.intervalSeconds)))),
    autoPushIntervalMinutes: Math.max(0, Math.min(24 * 60, Math.round(toFiniteNumber(source.autoPushIntervalMinutes, CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT.autoPushIntervalMinutes)))),
    autoPullIntervalMinutes: Math.max(0, Math.min(24 * 60, Math.round(toFiniteNumber(source.autoPullIntervalMinutes, CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT.autoPullIntervalMinutes)))),
    obsidianExportRoot: normalizeCanvasGitSyncExportRoot(source.obsidianExportRoot, { allowEmpty: true }),
    mismatchPolicy: normalizeCanvasGitSyncMismatchPolicy(source.mismatchPolicy),
    backgroundCheckEnabled: source.backgroundCheckEnabled !== false,
    backgroundCheckIntervalMinutes: Math.max(1, Math.min(24 * 60, Math.round(toFiniteNumber(source.backgroundCheckIntervalMinutes, CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT.backgroundCheckIntervalMinutes)))),
    backgroundCooldownMinutes: Math.max(1, Math.min(24 * 60, Math.round(toFiniteNumber(source.backgroundCooldownMinutes, CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT.backgroundCooldownMinutes))))
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

function deriveCanvasGitSyncBaseCheckIntervalMinutes(settings) {
  const normalizedSettings = normalizeCanvasGitSyncBackgroundSettings(settings);
  return Math.max(
    1,
    Math.min(
      24 * 60,
      Math.round(
        toFiniteNumber(
          normalizedSettings.backgroundCheckIntervalMinutes,
          CANVAS_GIT_SYNC_BG_DEFAULT_INTERVAL_MINUTES
        )
      )
    )
  );
}

function shouldRunCanvasGitSyncBackgroundCheck(state) {
  const settings = state && state.settings
    ? normalizeCanvasGitSyncBackgroundSettings(state.settings)
    : normalizeCanvasGitSyncBackgroundSettings(CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT);

  if (!settings.enabled) return false;
  if (!settings.autoSync) return false;
  if (!settings.backgroundCheckEnabled) return false;
  return true;
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

async function clearCanvasGitSyncBackgroundAlarm() {
  try {
    if (!browserAPI?.alarms?.clear) return;
    await browserAPI.alarms.clear(CANVAS_GIT_SYNC_BACKGROUND_ALARM);
  } catch (_) { }
}

async function scheduleCanvasGitSyncBackgroundAlarm(stateInput, delayMinutesInput = null) {
  const state = normalizeCanvasGitSyncBackgroundState(stateInput);

  if (!shouldRunCanvasGitSyncBackgroundCheck(state)) {
    if (state.runtime.nextCheckAt !== 0) {
      state.runtime.nextCheckAt = 0;
      await saveCanvasGitSyncBackgroundState(state);
    }
    await clearCanvasGitSyncBackgroundAlarm();
    return state;
  }

  const baseDelay = deriveCanvasGitSyncBaseCheckIntervalMinutes(state.settings) || CANVAS_GIT_SYNC_BG_DEFAULT_INTERVAL_MINUTES;
  const delayMinutes = Number.isFinite(Number(delayMinutesInput))
    ? Math.max(1, Math.min(24 * 60, Math.round(Number(delayMinutesInput))))
    : Math.max(1, Math.min(24 * 60, Math.round(baseDelay)));

  const whenTs = Date.now() + (delayMinutes * 60 * 1000);
  state.runtime.nextCheckAt = whenTs;
  await saveCanvasGitSyncBackgroundState(state);

  try {
    if (browserAPI?.alarms?.create) {
      browserAPI.alarms.create(CANVAS_GIT_SYNC_BACKGROUND_ALARM, { when: whenTs });
    }
  } catch (_) { }

  return state;
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
  const result = await getRepoBranchHeadSignal({
    token: gitConfig.token,
    owner: gitConfig.owner,
    repo: gitConfig.repo,
    branch: gitConfig.branch,
    path: repoRootPath
  });

  if (!result || result.success !== true) {
    return { success: false, error: result?.error || '读取云端信号失败', path: repoRootPath || normalizedRootPath };
  }

  return {
    success: true,
    notFound: !String(result.revisionSha || '').trim(),
    path: repoRootPath || normalizedRootPath,
    revisionSha: String(result.revisionSha || ''),
    committedAt: Number(result.committedAt) || 0,
    fileCount: 0,
    truncated: false
  };
}

async function runCanvasGitSyncBackgroundCheck(reason = 'alarm') {
  let state = await loadCanvasGitSyncBackgroundState();
  const targetSync = await ensureCanvasGitSyncBackgroundTargetState(state);
  state = targetSync.state;
  if (!shouldRunCanvasGitSyncBackgroundCheck(state)) {
    await scheduleCanvasGitSyncBackgroundAlarm(state);
    return { success: false, skipped: true, reason: 'disabled' };
  }

  const now = Date.now();
  const normalizedSettings = normalizeCanvasGitSyncBackgroundSettings(state.settings);
  const runtime = Object.assign({}, state.runtime, { lastCheckAt: now, lastCheckError: '' });
  const baseDelay = deriveCanvasGitSyncBaseCheckIntervalMinutes(normalizedSettings) || CANVAS_GIT_SYNC_BG_DEFAULT_INTERVAL_MINUTES;
  const cooldownDelay = Math.max(
    baseDelay,
    Math.max(
      1,
      Math.round(
        toFiniteNumber(
          normalizedSettings.backgroundCooldownMinutes,
          CANVAS_GIT_SYNC_BG_COOLDOWN_MINUTES
        )
      )
    )
  );
  let nextDelay = baseDelay;

  if (runtime.localDirty) {
    runtime.hasPendingWork = true;
    runtime.idleStreak = 0;
  }

  try {
    const remote = await readCanvasGitRemoteSignalForBackground(state.settings);
    if (!remote.success) {
      runtime.lastCheckError = remote.error || '后台检查失败';
      runtime.idleStreak = 0;
      nextDelay = baseDelay;
    } else {
      const remoteSha = String(remote.revisionSha || '');
      const remoteCommittedAt = Number(remote.committedAt) || 0;
      const previousSha = String(runtime.lastCheckRemoteSha || '');
      const localHash = String(runtime.lastLocalHash || '');
      const localSuccessAt = Number(runtime.lastSuccessAt) || 0;
      const localMutationAt = Number(runtime.lastLocalMutationAt) || 0;
      runtime.lastCheckRemoteSha = remoteSha;
      if (remoteCommittedAt > 0) {
        runtime.lastRemoteCommittedAt = remoteCommittedAt;
      }

      const remoteChangedBySha = !!(remoteSha && previousSha && remoteSha !== previousSha);
      const remoteDeletedAfterKnown = !remoteSha && !!previousSha;
      const remoteNewerByTime = !!(
        remoteCommittedAt > 0
        && localSuccessAt > 0
        && remoteCommittedAt > (localSuccessAt + 1000)
      );
      const localEditedAfterLastSync = !!(
        localMutationAt > 0
        && localSuccessAt > 0
        && localMutationAt > (localSuccessAt + 1000)
      );
      const hasComparableBaseline = !!(previousSha || localHash || localSuccessAt);
      const hasMismatch = hasComparableBaseline && (
        remoteChangedBySha
        || remoteDeletedAfterKnown
        || (remoteNewerByTime && !localEditedAfterLastSync)
      );
      if (hasMismatch) {
        runtime.pendingMismatch = true;
        runtime.pendingMismatchRemoteSha = remoteSha;
        runtime.pendingMismatchUpdatedAt = now;
        runtime.hasPendingWork = true;
        runtime.idleStreak = 0;
        nextDelay = baseDelay;
      } else {
        if (runtime.pendingMismatch && runtime.pendingMismatchRemoteSha && runtime.pendingMismatchRemoteSha === remoteSha) {
          runtime.pendingMismatch = false;
          runtime.pendingMismatchRemoteSha = '';
          runtime.pendingMismatchUpdatedAt = 0;
        }

        if (!runtime.pendingMismatch && !runtime.localDirty) {
          runtime.hasPendingWork = false;
          runtime.idleStreak = Math.max(0, Number(runtime.idleStreak) || 0) + 1;
        } else {
          runtime.idleStreak = 0;
        }

        if (runtime.idleStreak >= CANVAS_GIT_SYNC_BG_IDLE_STREAK_LIMIT) {
          nextDelay = cooldownDelay;
        }
      }
    }
  } catch (error) {
    runtime.lastCheckError = error && error.message ? error.message : String(error || '后台检查失败');
    runtime.idleStreak = 0;
    nextDelay = baseDelay;
  }

  state = normalizeCanvasGitSyncBackgroundState({
    settings: state.settings,
    runtime,
    updatedAt: Date.now(),
    reason
  });

  await saveCanvasGitSyncBackgroundState(state);
  await scheduleCanvasGitSyncBackgroundAlarm(state, nextDelay);
  await refreshMarkerBadgeFromStorage();

  return {
    success: true,
    pendingMismatch: state.runtime.pendingMismatch,
    nextCheckAt: state.runtime.nextCheckAt
  };
}

async function restoreCanvasGitSyncBackgroundScheduling() {
  const loadedState = await loadCanvasGitSyncBackgroundState();
  const targetSync = await ensureCanvasGitSyncBackgroundTargetState(loadedState);
  const state = targetSync.state;
  await scheduleCanvasGitSyncBackgroundAlarm(state);
  await refreshMarkerBadgeFromStorage();
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
    state.runtime.idleStreak = 0;
  } else if (eventName === 'sync-success') {
    state.runtime.localDirty = false;
    state.runtime.hasPendingWork = false;
    state.runtime.pendingMismatch = false;
    state.runtime.pendingMismatchRemoteSha = '';
    state.runtime.pendingMismatchUpdatedAt = 0;
    state.runtime.idleStreak = 0;
    state.runtime.lastCheckRemoteSha = '';
  } else if (eventName === 'sync-idle') {
    if (!state.runtime.pendingMismatch && !state.runtime.localDirty) {
      state.runtime.hasPendingWork = false;
    }
  } else if (eventName === 'mismatch-cleared') {
    state.runtime.pendingMismatch = false;
    state.runtime.pendingMismatchRemoteSha = '';
    state.runtime.pendingMismatchUpdatedAt = 0;
    if (!state.runtime.localDirty) {
      state.runtime.hasPendingWork = false;
    }
  }

  state.runtime = normalizeCanvasGitSyncBackgroundRuntime(state.runtime);
  const saved = await saveCanvasGitSyncBackgroundState(state);
  await scheduleCanvasGitSyncBackgroundAlarm(saved);
  await refreshMarkerBadgeFromStorage();

  return {
    success: true,
    runtime: saved.runtime,
    settings: saved.settings,
    nextCheckAt: saved.runtime.nextCheckAt
  };
}

async function handleCanvasGitSyncGetBackgroundStateMessage() {
  const state = await loadCanvasGitSyncBackgroundState();
  return {
    success: true,
    runtime: state.runtime,
    settings: state.settings,
    nextCheckAt: state.runtime.nextCheckAt
  };
}

async function handleCanvasMarkerBulkModeMessage(message) {
  markerBulkMuteState = {
    enabled: !!(message && message.enabled === true),
    reason: String(message && message.reason || ''),
    startedAt: message && message.enabled === true ? Date.now() : 0,
    ignoreUntil: Math.max(0, Number(message && message.ignoreUntil) || 0)
  };

  await refreshMarkerBadgeFromStorage();

  return {
    success: true,
    enabled: markerBulkMuteState.enabled,
    reason: markerBulkMuteState.reason
  };
}

async function handleCanvasGitSyncClearPendingMismatchMessage() {
  const state = await loadCanvasGitSyncBackgroundState();
  state.runtime.pendingMismatch = false;
  state.runtime.pendingMismatchRemoteSha = '';
  state.runtime.pendingMismatchUpdatedAt = 0;
  if (!state.runtime.localDirty) {
    state.runtime.hasPendingWork = false;
  }

  const saved = await saveCanvasGitSyncBackgroundState(state);
  await scheduleCanvasGitSyncBackgroundAlarm(saved);
  await refreshMarkerBadgeFromStorage();

  return {
    success: true,
    runtime: saved.runtime,
    settings: saved.settings,
    nextCheckAt: saved.runtime.nextCheckAt
  };
}

if (browserAPI?.alarms?.onAlarm?.addListener) {
  browserAPI.alarms.onAlarm.addListener((alarm) => {
    try {
      if (!alarm || alarm.name !== CANVAS_GIT_SYNC_BACKGROUND_ALARM) return;
      runCanvasGitSyncBackgroundCheck('alarm').catch(() => {});
    } catch (_) { }
  });
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

  if (message.action === 'canvasMarkerBulkMode') {
    (async () => {
      const response = await handleCanvasMarkerBulkModeMessage(message);
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

  if (message.action === 'canvasGitSyncClearPendingMismatch') {
    (async () => {
      const response = await handleCanvasGitSyncClearPendingMismatchMessage();
      sendResponse(response);
    })();
    return true;
  }

  if (message.action === 'canvasGitSyncRunBackgroundCheckNow') {
    (async () => {
      const response = await runCanvasGitSyncBackgroundCheck('manual-message');
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
