// Minimal background for Bookmark Canvas extension (MV3)

const browserAPI = (function () {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  throw new Error('Unsupported browser');
})();

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

const CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY = 'canvasPermanentBookmarksDirty';
const CANVAS_PERMANENT_BOOKMARK_DIRTY_AT_KEY = 'canvasPermanentBookmarksDirtyAt';
const CANVAS_PERMANENT_BOOKMARK_DIRTY_REASON_KEY = 'canvasPermanentBookmarksDirtyReason';
const CANVAS_PERMANENT_BOOKMARK_DIRTY_VERSION_KEY = 'canvasPermanentBookmarksDirtyVersion';
const CANVAS_PERMANENT_BOOKMARK_CLEAN_AT_KEY = 'canvasPermanentBookmarksCleanAt';
const CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY = 'canvasPermanentBookmarksDirtySyncLease';
const CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_MAX_AGE_MS = 5 * 60 * 1000;
const CANVAS_FOREGROUND_ACTIVE_PORT = 'bookmark-canvas-foreground-active';
const CANVAS_FOREGROUND_PORT_STATE_MESSAGE = 'canvas-foreground-port-state';
const CANVAS_FOREGROUND_PORT_STATE_RUNNABLE = 'runnable';
const CANVAS_FOREGROUND_PORT_STATE_FROZEN = 'frozen';
let canvasPermanentBookmarksDirtyMemory = null;
let canvasPermanentBookmarkDirtyOperation = Promise.resolve();
const activeForegroundPorts = new Map();
let foregroundActivePortListenerRegistered = false;

function hasRunnableCanvasForegroundPort() {
  for (const state of activeForegroundPorts.values()) {
    if (state === CANVAS_FOREGROUND_PORT_STATE_RUNNABLE) return true;
  }
  return false;
}

function runCanvasPermanentBookmarkDirtyOperation(task) {
  const run = canvasPermanentBookmarkDirtyOperation.then(task, task);
  canvasPermanentBookmarkDirtyOperation = run.catch(() => { });
  return run;
}

function normalizeCanvasPermanentBookmarkDirtySyncLease(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const startedAt = Number(value.startedAt) || 0;
  if (!id || !startedAt) return null;
  return {
    id,
    startedAt,
    reason: String(value.reason || ''),
    invalidated: value.invalidated === true
  };
}

function isCanvasPermanentBookmarkDirtySyncLeaseExpired(lease, now = Date.now()) {
  return !lease || (now - lease.startedAt) > CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_MAX_AGE_MS;
}

function storageLocalGet(keys) {
  return new Promise((resolve) => {
    try {
      const result = browserAPI.storage.local.get(keys, (items) => {
        try {
          const err = browserAPI?.runtime?.lastError;
          if (err) {
            resolve({});
            return;
          }
        } catch (_) { }
        resolve(items || {});
      });
      if (result && typeof result.then === 'function') {
        result.then((items) => resolve(items || {})).catch(() => resolve({}));
      }
    } catch (_) {
      resolve({});
    }
  });
}

function storageLocalSet(values) {
  return new Promise((resolve) => {
    try {
      const result = browserAPI.storage.local.set(values, () => {
        try {
          const err = browserAPI?.runtime?.lastError;
          resolve(!err);
        } catch (_) {
          resolve(true);
        }
      });
      if (result && typeof result.then === 'function') {
        result.then(() => resolve(true)).catch(() => resolve(false));
      }
    } catch (_) {
      resolve(false);
    }
  });
}

async function getCanvasPermanentBookmarkDirtyState() {
  const data = await storageLocalGet([
    CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY,
    CANVAS_PERMANENT_BOOKMARK_DIRTY_AT_KEY,
    CANVAS_PERMANENT_BOOKMARK_DIRTY_REASON_KEY,
    CANVAS_PERMANENT_BOOKMARK_DIRTY_VERSION_KEY,
    CANVAS_PERMANENT_BOOKMARK_CLEAN_AT_KEY,
    CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY
  ]);
  const dirty = data[CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY] === true;
  canvasPermanentBookmarksDirtyMemory = dirty;
  return {
    success: true,
    dirty,
    dirtyAt: Number(data[CANVAS_PERMANENT_BOOKMARK_DIRTY_AT_KEY]) || 0,
    reason: String(data[CANVAS_PERMANENT_BOOKMARK_DIRTY_REASON_KEY] || ''),
    version: Number(data[CANVAS_PERMANENT_BOOKMARK_DIRTY_VERSION_KEY]) || 0,
    cleanAt: Number(data[CANVAS_PERMANENT_BOOKMARK_CLEAN_AT_KEY]) || 0,
    syncLease: normalizeCanvasPermanentBookmarkDirtySyncLease(data[CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY])
  };
}

async function markCanvasPermanentBookmarksDirty(reason = 'bookmark-event', options = {}) {
  return runCanvasPermanentBookmarkDirtyOperation(async () => {
    const state = await getCanvasPermanentBookmarkDirtyState();
    const now = Date.now();
    const lease = state.syncLease;

    // A full-tree BCS sync owns a point-in-time snapshot. One mutation during
    // that window invalidates the snapshot; coalesce all later mutations so a
    // bulk import still performs at most one additional storage write.
    if (lease && !lease.invalidated) {
      const nextVersion = state.dirty
        ? state.version
        : Math.max(0, Number(state.version) || 0) + 1;
      const ok = await storageLocalSet({
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY]: true,
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_AT_KEY]: state.dirtyAt || now,
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_REASON_KEY]: String(reason || 'bookmark-event'),
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_VERSION_KEY]: nextVersion,
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY]: {
          ...lease,
          invalidated: true
        }
      });
      if (ok) canvasPermanentBookmarksDirtyMemory = true;
      return { success: ok, dirty: true, version: nextVersion, invalidatedLease: true };
    }

    if (state.dirty || options.markWhenNoForeground !== true) {
      if (state.dirty) canvasPermanentBookmarksDirtyMemory = true;
      return { success: true, skipped: true, dirty: state.dirty, version: state.version };
    }

    const nextVersion = Math.max(0, Number(state.version) || 0) + 1;
    const ok = await storageLocalSet({
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY]: true,
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_AT_KEY]: now,
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_REASON_KEY]: String(reason || 'bookmark-event'),
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_VERSION_KEY]: nextVersion
    });
    if (ok) canvasPermanentBookmarksDirtyMemory = true;
    return { success: ok, dirty: ok, version: nextVersion, dirtyAt: now };
  });
}

async function beginCanvasPermanentBookmarkDirtySync(reason = 'full-sync') {
  return runCanvasPermanentBookmarkDirtyOperation(async () => {
    const state = await getCanvasPermanentBookmarkDirtyState();
    const now = Date.now();
    const existingLease = state.syncLease;
    if (existingLease && !isCanvasPermanentBookmarkDirtySyncLeaseExpired(existingLease, now)) {
      return { success: true, acquired: false, reason: 'sync_in_progress', lease: existingLease, state };
    }

    const lease = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      startedAt: now,
      reason: String(reason || 'full-sync'),
      invalidated: false
    };
    const ok = await storageLocalSet({
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY]: lease
    });
    return {
      success: ok,
      acquired: ok,
      lease: ok ? lease : null,
      state
    };
  });
}

async function finishCanvasPermanentBookmarkDirtySync(leaseId, completed = true, reason = 'full-sync') {
  return runCanvasPermanentBookmarkDirtyOperation(async () => {
    const state = await getCanvasPermanentBookmarkDirtyState();
    const lease = state.syncLease;
    const expectedLeaseId = String(leaseId || '').trim();
    if (!lease || !expectedLeaseId || lease.id !== expectedLeaseId) {
      return { success: true, skipped: true, reason: 'lease_mismatch', state };
    }

    const now = Date.now();
    if (completed !== true || lease.invalidated) {
      const nextVersion = state.dirty
        ? state.version
        : Math.max(0, Number(state.version) || 0) + 1;
      const ok = await storageLocalSet({
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY]: true,
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_AT_KEY]: state.dirtyAt || now,
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_REASON_KEY]: completed === true
          ? 'sync-invalidated'
          : String(reason || 'sync-failed'),
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_VERSION_KEY]: nextVersion,
        [CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY]: null
      });
      if (ok) canvasPermanentBookmarksDirtyMemory = true;
      return { success: ok, dirty: true, invalidated: lease.invalidated === true, version: nextVersion };
    }

    const ok = await storageLocalSet({
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY]: false,
      [CANVAS_PERMANENT_BOOKMARK_CLEAN_AT_KEY]: now,
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_SYNC_LEASE_KEY]: null
    });
    if (ok) canvasPermanentBookmarksDirtyMemory = false;
    return { success: ok, dirty: false, version: state.version };
  });
}

async function clearCanvasPermanentBookmarkDirtyState(expectedVersion = null) {
  return runCanvasPermanentBookmarkDirtyOperation(async () => {
    const state = await getCanvasPermanentBookmarkDirtyState();
    const expected = Number(expectedVersion);
    if (state.syncLease) {
      return { success: true, skipped: true, reason: 'sync_lease_active', state };
    }
    if (Number.isFinite(expected) && expected > 0 && state.version !== expected) {
      return { success: true, skipped: true, reason: 'version_changed', state };
    }
    const ok = await storageLocalSet({
      [CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY]: false,
      [CANVAS_PERMANENT_BOOKMARK_CLEAN_AT_KEY]: Date.now()
    });
    if (ok) canvasPermanentBookmarksDirtyMemory = false;
    return { success: ok, dirty: false, version: state.version };
  });
}

function registerCanvasForegroundActivePortListener() {
  if (foregroundActivePortListenerRegistered) return;
  if (!browserAPI?.runtime?.onConnect?.addListener) return;
  foregroundActivePortListenerRegistered = true;

  browserAPI.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== CANVAS_FOREGROUND_ACTIVE_PORT) return;

    // A connecting page is not considered runnable until it explicitly reports
    // its lifecycle state. This avoids treating a reconnected frozen document
    // as the owner of permanent-bookmark BCS updates.
    activeForegroundPorts.set(port, null);

    const onMessage = (message) => {
      if (!message || message.type !== CANVAS_FOREGROUND_PORT_STATE_MESSAGE) return;
      const state = message.state === CANVAS_FOREGROUND_PORT_STATE_FROZEN
        ? CANVAS_FOREGROUND_PORT_STATE_FROZEN
        : CANVAS_FOREGROUND_PORT_STATE_RUNNABLE;
      activeForegroundPorts.set(port, state);
    };

    const onDisconnect = () => {
      try {
        const err = browserAPI?.runtime?.lastError;
        if (err && err.message) {
          // touch lastError to avoid unchecked runtime.lastError noise.
        }
      } catch (_) { }
      activeForegroundPorts.delete(port);
      try {
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(onDisconnect);
      } catch (_) { }
    };

    try {
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
    } catch (_) {
      activeForegroundPorts.delete(port);
    }
  });
}

function registerCanvasPermanentBookmarkDirtyListener() {
  try {
    if (browserAPI?.storage?.onChanged?.addListener) {
      browserAPI.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes && Object.prototype.hasOwnProperty.call(changes, CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY)) {
          canvasPermanentBookmarksDirtyMemory = changes[CANVAS_PERMANENT_BOOKMARK_DIRTY_KEY].newValue === true;
        }
      });
    }
  } catch (_) { }

  try {
    if (!browserAPI?.bookmarks) return;
    const mark = (reason) => {
      markCanvasPermanentBookmarksDirty(reason, {
        markWhenNoForeground: !hasRunnableCanvasForegroundPort()
      }).catch(() => { });
    };
    if (browserAPI.bookmarks.onCreated?.addListener) {
      browserAPI.bookmarks.onCreated.addListener(() => mark('created'));
    }
    if (browserAPI.bookmarks.onRemoved?.addListener) {
      browserAPI.bookmarks.onRemoved.addListener(() => mark('removed'));
    }
    if (browserAPI.bookmarks.onMoved?.addListener) {
      browserAPI.bookmarks.onMoved.addListener(() => mark('moved'));
    }
    if (browserAPI.bookmarks.onChanged?.addListener) {
      browserAPI.bookmarks.onChanged.addListener(() => mark('changed'));
    }
    if (browserAPI.bookmarks.onChildrenReordered?.addListener) {
      browserAPI.bookmarks.onChildrenReordered.addListener(() => mark('children-reordered'));
    }
    if (browserAPI.bookmarks.onImportEnded?.addListener) {
      browserAPI.bookmarks.onImportEnded.addListener(() => mark('import-ended'));
    }
  } catch (_) { }
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
  });
}

try {
  if (browserAPI?.runtime?.onStartup?.addListener) {
    browserAPI.runtime.onStartup.addListener(() => {
      clearExtensionBadge();
    });
  }
} catch (_) { }

initSidePanel();
registerCanvasForegroundActivePortListener();
registerSidePanelTogglePortListener();
registerCanvasPermanentBookmarkDirtyListener();
refreshSidePanelOpenWindows().catch(() => {});
clearExtensionBadge();

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
  const normalizedUrl = String(url).trim();
  const extensionProtocol = (() => {
    try {
      return String(new URL(browserAPI.runtime.getURL('/')).protocol || '').toLowerCase();
    } catch (_) {
      return '';
    }
  })();
  const isFetchableFaviconUrl = (candidateUrl) => {
    const text = String(candidateUrl || '').trim();
    if (!text) return false;
    if (text.startsWith('/')) return true;
    try {
      const protocol = String(new URL(text).protocol || '').toLowerCase();
      if (!protocol) return false;
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'data:' || protocol === 'blob:') {
        return true;
      }
      return Boolean(extensionProtocol && protocol === extensionProtocol);
    } catch (_) {
      return false;
    }
  };
  if (!isFetchableFaviconUrl(normalizedUrl)) {
    return wrap('', {
      attempted: false,
      hardFailure: false,
      resultClass: 'non_fetchable',
      errorCode: 'non_fetchable'
    });
  }
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
    const res = await fetch(normalizedUrl, { signal: controller.signal });
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

function openCanvasViewFromCommand() {
  const targetUrl = browserAPI.runtime.getURL('history_html/history.html?view=canvas');
  if (browserAPI.tabs && browserAPI.tabs.query) {
    browserAPI.tabs.query({ currentWindow: true }, (tabs) => {
      const existingTab = tabs.find(tab => tab.url && tab.url.includes('history_html/history.html'));
      if (existingTab) {
        browserAPI.tabs.update(existingTab.id, { active: true });
      } else {
        browserAPI.tabs.create({ url: targetUrl });
      }
    });
  } else {
    browserAPI.tabs.create({ url: targetUrl });
  }
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

  if (message.action === 'getCanvasPermanentBookmarkDirtyState') {
    getCanvasPermanentBookmarkDirtyState()
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'beginCanvasPermanentBookmarkDirtySync') {
    beginCanvasPermanentBookmarkDirtySync(message.reason)
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'finishCanvasPermanentBookmarkDirtySync') {
    finishCanvasPermanentBookmarkDirtySync(message.leaseId, message.completed === true, message.reason)
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'markCanvasPermanentBookmarksDirty') {
    markCanvasPermanentBookmarksDirty(message.reason, { markWhenNoForeground: true })
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'clearCanvasPermanentBookmarkDirtyState') {
    clearCanvasPermanentBookmarkDirtyState(message.expectedVersion)
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.action === 'extensionBookmarkOpen') {
    sendResponse({ success: true });
    return;
  }

  sendResponse({ success: false, error: 'Unsupported action' });
});

clearExtensionBadge();
