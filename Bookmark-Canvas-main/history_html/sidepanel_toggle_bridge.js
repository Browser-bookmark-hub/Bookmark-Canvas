(() => {
  const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime)
    ? chrome
    : (typeof browser !== 'undefined' ? browser : null);

  if (!browserAPI?.runtime?.connect) return;

  const TOGGLE_PORT_NAME = 'bookmark-canvas-sidepanel-toggle-v1';

  function isSidePanelContext() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('sidepanel') === '1';
    } catch (_) {
      return false;
    }
  }

  if (!isSidePanelContext()) return;

  let togglePort = null;
  let reconnectTimer = null;

  function getWindowId() {
    return new Promise((resolve) => {
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

  async function sendHello(reason = 'connect') {
    if (!togglePort) return;
    const windowId = await getWindowId();
    try {
      togglePort.postMessage({
        type: 'sidepanel_toggle_bridge_hello',
        reason,
        windowId,
        ts: Date.now()
      });
    } catch (_) { }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1200);
  }

  function closeSelf() {
    try {
      if (typeof browserAPI?.sidePanel?.close === 'function' && browserAPI?.windows?.getCurrent) {
        browserAPI.windows.getCurrent((win) => {
          const windowId = win && typeof win.id === 'number' ? win.id : null;
          if (windowId == null) {
            try { window.close(); } catch (_) { }
            return;
          }
          try {
            browserAPI.sidePanel.close({ windowId }, () => {
              try {
                const err = browserAPI?.runtime?.lastError;
                if (err && err.message) {
                  // ignore
                }
              } catch (_) { }
              try { window.close(); } catch (_) { }
            });
          } catch (_) {
            try { window.close(); } catch (_) { }
          }
        });
        return;
      }
    } catch (_) { }

    try {
      window.close();
    } catch (_) { }
  }

  function connect() {
    try {
      togglePort = browserAPI.runtime.connect({ name: TOGGLE_PORT_NAME });

      togglePort.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'sidepanel_toggle_bridge_request_window_id') {
          sendHello('request_window_id');
          return;
        }
        if (message.type === 'sidepanel_toggle_close') {
          closeSelf();
        }
      });

      togglePort.onDisconnect.addListener(() => {
        try {
          const err = browserAPI?.runtime?.lastError;
          if (err && err.message) {
            // touch lastError to avoid unchecked runtime.lastError noise.
          }
        } catch (_) { }
        togglePort = null;
        scheduleReconnect();
      });

      sendHello('connect');
    } catch (_) {
      togglePort = null;
      scheduleReconnect();
    }
  }

  window.addEventListener('focus', () => {
    sendHello('focus');
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      sendHello('visibility');
    }
  });

  connect();
})();
