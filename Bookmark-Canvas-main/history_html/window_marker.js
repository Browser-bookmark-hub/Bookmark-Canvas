// MV3-safe: external script only, no inline code
(function () {
  const urlParams = new URLSearchParams(location.search);
  const t = urlParams.get('t') || '';
  const type = urlParams.get('type') || '';
  const lt = urlParams.get('lt') || '';
  const sid = urlParams.get('sid') || '';
  const nid = urlParams.get('nid') || '';
  const mode = urlParams.get('mode') || '';
  const isHyperlink = type === 'hyperlink';

  // 浏览器原生 Favicon 服务 URL 构建函数
  function getFaviconUrl(url) {
    if (!url) return '';
    try {
      return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
    } catch (_) {
      return '';
    }
  }

  // 批量从系统的 FaviconCache (IndexedDB) 读取高精度/缓存的图标
  function getCachedFaviconsInBatch(urls) {
    return new Promise((resolve) => {
      if (!urls || urls.length === 0) return resolve({});

      const domainMap = {};
      const domains = [];
      urls.forEach(url => {
        if (!url) return;
        try {
          const parsed = new URL(url);
          let domain = parsed.hostname;
          if (domain) {
            domain = domain.toLowerCase().replace(/\.$/, '');
            domainMap[url] = domain;
            domains.push(domain);
          }
        } catch (_) {}
      });

      if (domains.length === 0) return resolve({});

      const request = indexedDB.open('BookmarkFaviconCache', 1);
      request.onerror = () => resolve({});
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('favicons')) {
          db.close();
          resolve({});
          return;
        }
        try {
          const tx = db.transaction(['favicons'], 'readonly');
          const store = tx.objectStore('favicons');

          const results = {};
          const uniqueDomains = Array.from(new Set(domains));
          const domainCache = {};
          let completed = 0;

          if (uniqueDomains.length === 0) {
            db.close();
            resolve({});
            return;
          }

          uniqueDomains.forEach(domain => {
            const getReq = store.get(domain);
            getReq.onsuccess = () => {
              if (getReq.result && getReq.result.dataUrl) {
                domainCache[domain] = getReq.result.dataUrl;
              }
              completed++;
              if (completed === uniqueDomains.length) {
                db.close();
                // Map domains back to URLs
                urls.forEach(url => {
                  const dom = domainMap[url];
                  if (dom && domainCache[dom]) {
                    results[url] = domainCache[dom];
                  }
                });
                resolve(results);
              }
            };
            getReq.onerror = () => {
              completed++;
              if (completed === uniqueDomains.length) {
                db.close();
                urls.forEach(url => {
                  const dom = domainMap[url];
                  if (dom && domainCache[dom]) {
                    results[url] = domainCache[dom];
                  }
                });
                resolve(results);
              }
            };
          });
        } catch (_) {
          db.close();
          resolve({});
        }
      };
    });
  }

  // 异步获取并渲染容器内所有 img[data-url] 的缓存 favicon
  function updateFaviconsFromCache(container) {
    if (!container) return;
    const imgs = container.querySelectorAll('img[data-url]');
    const urls = [];
    imgs.forEach(img => {
      const url = img.dataset.url;
      if (url && url.startsWith('http')) {
        urls.push(url);
      }
    });

    if (urls.length === 0) return;

    getCachedFaviconsInBatch(urls).then(cachedMap => {
      imgs.forEach(img => {
        const url = img.dataset.url;
        const cached = cachedMap[url];
        if (cached && cached.startsWith('data:image/')) {
          img.src = cached;
          img.style.display = '';
        }
      });
    }).catch(() => {});
  }

  // Helper to get translated prefix based on type/mode
  function getModePrefix(currentLang) {
    const isZh = currentLang === 'zh_CN';
    if (isHyperlink) {
      return isZh ? '超链接' : 'Hyperlink';
    }
    if (mode === 'same-window') {
      return isZh ? '同一窗口' : 'Same Window';
    }
    if (mode === 'same-window-specific-group') {
      return isZh ? '同窗专属组' : 'Same Window Exclusive Group';
    }
    if (mode === 'scoped-window') {
      return isZh ? '专属窗口' : 'Exclusive Window';
    }
    return '';
  }

  // 1. 立即执行：同步设置网页 Tab 标题，防止白屏或闪烁默认文件名
  function updateTabTitle(currentLang) {
    if (!t) return;
    const prefix = getModePrefix(currentLang);
    const cleanT = t.trim();
    
    // List of prefixes to strip from the title, ordered by length descending to avoid partial matches
    const prefixesToStrip = [
      'same window exclusive group',
      'same-window-exclusive-group',
      'same window',
      'same-window',
      'exclusive window',
      'hyperlink',
      '同窗专属组',
      '同一窗口',
      '专属窗口',
      '超链接'
    ];
    
    let strippedT = cleanT;
    for (const p of prefixesToStrip) {
      if (strippedT.toLowerCase().startsWith(p)) {
        strippedT = strippedT.slice(p.length).replace(/^[-—\s]+/, '');
        break;
      }
    }
    
    if (prefix) {
      if (strippedT === '') {
        document.title = prefix;
      } else {
        document.title = `${prefix} ${strippedT}`;
      }
    } else {
      document.title = cleanT;
    }
  }

  // 立即用默认语言初始化网页标题，防止白屏或闪烁默认文件名
  const initialLang = (function () {
    try {
      const ui = (chrome?.i18n?.getUILanguage?.() || navigator.language || '').toLowerCase();
      return ui.startsWith('zh') ? 'zh_CN' : 'en';
    } catch (_) { }
    try {
      const ui = (navigator.language || '').toLowerCase();
      return ui.startsWith('zh') ? 'zh_CN' : 'en';
    } catch (_) { }
    return 'en';
  })();
  updateTabTitle(initialLang);

  // 翻译字典
  const i18n = {
    zh_CN: {
      brand: '工作区监视器',
      modeSameWindow: '同一窗口',
      modeSameWindowSpecificGroup: '同窗专属组',
      modeScopedWindow: '专属窗口',
      metaWorkspace: '工作区 / 窗口 ID',
      metaTarget: '归属卡片 / 栏目',
      metaWindowCount: '工作区窗口总数',
      metaFolder: '关联目录 ID',
      activeTabs: '当前窗口标签页',
      associatedBookmarks: '关联文件夹书签',
      emptyTabs: '此窗口内没有其他标签页',
      emptyBookmarks: '关联目录无书签',
      loadingBookmarks: '正在加载关联书签...',
      colStatus: '序号',
      colIcon: '图标',
      colTitle: '标题',
      colDomain: '域名',
      colSource: '初始来源',
      colAction: '操作',
      colBookmarkTitle: '书签标题',
      actionFocus: '跳转到标签页',
      actionClose: '关闭标签页',
      actionOpen: '打开书签',
      actionCloseGroup: '关闭标签组',
      actionDrag: '按住拖动调整顺序',
      ungrouped: '无分组标签页',
      typeHyperlink: '超链接组',
      typeTemp: '临时分栏',
      typePerm: '永久栏目',
      workspaceTitle: '工作区',
      tabGroupPrefix: '标签组: ',
      langToggleText: 'EN' // 界面当前显示“中文”，按钮显示“EN”以供切换
    },
    en: {
      brand: 'Workspace Monitor',
      modeSameWindow: 'Same Window',
      modeSameWindowSpecificGroup: 'Same Window Exclusive Group',
      modeScopedWindow: 'Exclusive Window',
      metaWorkspace: 'Workspace / Window ID',
      metaTarget: 'Target Card / Column',
      metaWindowCount: 'Total Windows',
      metaFolder: 'Folder ID',
      activeTabs: 'Tabs in Current Window',
      associatedBookmarks: 'Associated Bookmarks',
      emptyTabs: 'No other tabs open in this window',
      emptyBookmarks: 'No bookmarks in this folder',
      loadingBookmarks: 'Loading associated bookmarks...',
      colStatus: 'No.',
      colIcon: 'Icon',
      colTitle: 'Title',
      colDomain: 'Domain',
      colSource: 'Initial Source',
      colAction: 'Action',
      colBookmarkTitle: 'Bookmark Title',
      actionFocus: 'Jump to Tab',
      actionClose: 'Close Tab',
      actionOpen: 'Open Bookmark',
      actionCloseGroup: 'Close Tab Group',
      actionDrag: 'Drag to reorder',
      ungrouped: 'Ungrouped Tabs',
      typeHyperlink: 'Hyperlink Group',
      typeTemp: 'Temporary Section',
      typePerm: 'Permanent Column',
      workspaceTitle: 'Workspace',
      tabGroupPrefix: 'Tab groups: ',
      langToggleText: '中文' // 界面当前显示“英文”，按钮显示“中文”以供切换
    }
  };

  let currentWindowId = null;
  let collapsedGroups = new Set(); // 记录用户折叠的 Tab 组 ID
  let currentWindowTabs = []; // 缓存当前窗口的标签页
  let lang = 'zh_CN';
  let t_str = i18n.zh_CN;
  let currentActiveTheme = 'dark';
  let currentThemePreference = 'dark';
  let themeMediaQuery = null;

  function normalizeThemePreference(value) {
    return value === 'light' || value === 'system' ? value : 'dark';
  }

  function getSystemThemePreference() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch (_) {
      return 'dark';
    }
  }

  function resolveThemePreference(preference) {
    const normalized = normalizeThemePreference(preference);
    return normalized === 'system' ? getSystemThemePreference() : normalized;
  }

  function watchSystemThemeChanges() {
    if (themeMediaQuery || !window.matchMedia) return;
    try {
      themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (currentThemePreference === 'system') applyTheme('system');
      };
      if (themeMediaQuery.addEventListener) themeMediaQuery.addEventListener('change', onChange);
      else if (themeMediaQuery.addListener) themeMediaQuery.addListener(onChange);
    } catch (_) { }
  }

  // 2. 自动检测并应用语言和主题
  async function initLanguageAndTheme() {
    // 首先检查本页面是否有手动修改过主题的本地记忆
    const localOverride = localStorage.getItem('marker_theme_override');

    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get(['preferredLang', 'currentTheme', 'themePreference']);
        if (data.preferredLang === 'zh_CN' || data.preferredLang === 'en') {
          lang = data.preferredLang;
        } else {
          lang = (function () {
            try {
              const ui = (chrome?.i18n?.getUILanguage?.() || '').toLowerCase();
              return ui.startsWith('zh') ? 'zh_CN' : 'en';
            } catch (_) { }
            return 'en';
          })();
        }
        const localPreference = localStorage.getItem('themePreference');
        const storedPreference = localPreference === 'dark' || localPreference === 'light' || localPreference === 'system'
          ? localPreference
          : (data.themePreference === 'dark' || data.themePreference === 'light' || data.themePreference === 'system'
            ? data.themePreference
            : normalizeThemePreference(data.currentTheme));
        currentThemePreference = localOverride ? normalizeThemePreference(localOverride) : storedPreference;
      } else {
        const localLang = localStorage.getItem('preferredLang');
        if (localLang === 'zh_CN' || localLang === 'en') {
          lang = localLang;
        } else {
          lang = (function () {
            try {
              const ui = (navigator.language || '').toLowerCase();
              return ui.startsWith('zh') ? 'zh_CN' : 'en';
            } catch (_) { }
            return 'en';
          })();
        }

        const localTheme = localStorage.getItem('themePreference');
        currentThemePreference = localOverride
          ? normalizeThemePreference(localOverride)
          : normalizeThemePreference(localTheme);
      }
    } catch (_) {
      lang = (function () {
        try {
          const ui = (navigator.language || '').toLowerCase();
          return ui.startsWith('zh') ? 'zh_CN' : 'en';
        } catch (_) { }
        return 'en';
      })();
      currentThemePreference = normalizeThemePreference(localOverride || 'dark');
    }

    watchSystemThemeChanges();
    applyTheme(currentThemePreference);
    t_str = i18n[lang] || i18n.zh_CN;
    updateStaticLabels();
    updateTabTitle(lang);
    updateThemeIcon();
  }

  function applyTheme(theme) {
    const targetTheme = resolveThemePreference(theme);
    currentThemePreference = normalizeThemePreference(theme);
    currentActiveTheme = targetTheme;
    if (targetTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    updateThemeIcon();
  }

  function updateThemeIcon() {
    const iconEl = document.getElementById('themeIcon');
    if (!iconEl) return;
    if (currentActiveTheme === 'dark') {
      // 当前是深色，图标显示太阳（点击切为浅色）
      iconEl.className = 'fas fa-sun';
    } else {
      // 当前是浅色，图标显示月亮（点击切为深色）
      iconEl.className = 'fas fa-moon';
    }
  }

  // 3. 填充多语言静态标签
  function updateStaticLabels() {
    let dynamicBrand = t_str.brand;
    if (mode === 'same-window') {
      dynamicBrand = t_str.modeSameWindow;
    } else if (mode === 'same-window-specific-group') {
      dynamicBrand = t_str.modeSameWindowSpecificGroup;
    } else if (mode === 'scoped-window') {
      dynamicBrand = t_str.modeScopedWindow;
    }

    const elMap = {
      'brandTitle': dynamicBrand,
      'lblActiveTabs': t_str.activeTabs,
      'lblAssociatedBookmarks': t_str.associatedBookmarks,
      'txtLangToggle': t_str.langToggleText,
      'thStatus': t_str.colStatus,
      'thIcon': t_str.colIcon,
      'thTitle': t_str.colTitle,
      'thDomain': t_str.colDomain,
      'thSource': t_str.colSource,
      'thAction': t_str.colAction,
      'thBkIcon': t_str.colIcon,
      'thBkTitle': t_str.colBookmarkTitle,
      'thBkDomain': t_str.colDomain,
      'thBkAction': t_str.colAction
    };

    for (const [id, text] of Object.entries(elMap)) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }
  }

  // 4. DOM 初始化
  function initUI() {
    const metaNameEl = document.getElementById('metaName');
    const btnLangToggle = document.getElementById('btnLangToggle');
    const btnThemeToggle = document.getElementById('btnThemeToggle');

    const cleanTitle = t.trim();

    // 填充窗口 ID
    if (metaNameEl) {
      const prefix = getModePrefix(lang);
      
      const prefixesToStrip = [
        'same window exclusive group',
        'same-window-exclusive-group',
        'same window',
        'same-window',
        'exclusive window',
        'hyperlink',
        '同窗专属组',
        '同一窗口',
        '专属窗口',
        '超链接'
      ];
      
      let strippedT = cleanTitle;
      for (const p of prefixesToStrip) {
        if (strippedT.toLowerCase().startsWith(p)) {
          strippedT = strippedT.slice(p.length).replace(/^[-—\s]+/, '');
          break;
        }
      }
      
      let windowIdText;
      if (prefix) {
        windowIdText = strippedT ? `${prefix} ${strippedT}` : prefix;
      } else {
        windowIdText = cleanTitle || t_str.workspaceTitle;
      }
      
      metaNameEl.textContent = `ID: ${windowIdText}`;
    }

    // 绑定右上角中英文切换
    if (btnLangToggle) {
      // 移除可能存在的旧监听器
      const newBtn = btnLangToggle.cloneNode(true);
      btnLangToggle.parentNode.replaceChild(newBtn, btnLangToggle);
      newBtn.addEventListener('click', async () => {
        const newLang = lang === 'zh_CN' ? 'en' : 'zh_CN';
        if (chrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ preferredLang: newLang });
        } else {
          localStorage.setItem('preferredLang', newLang);
          // 手动触发模拟
          lang = newLang;
          t_str = i18n[lang] || i18n.zh_CN;
          updateStaticLabels();
          initUI();
          refreshTabsList();
        }
      });
    }

    // 绑定右上角深色/浅色切换（仅控制本页面主题，并保存手动设置记忆）
    if (btnThemeToggle) {
      const newBtn = btnThemeToggle.cloneNode(true);
      btnThemeToggle.parentNode.replaceChild(newBtn, btnThemeToggle);
      newBtn.addEventListener('click', () => {
        const newTheme = currentActiveTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('marker_theme_override', newTheme);
        applyTheme(newTheme);
      });
    }
  }

  let draggedInfo = null; // { type: 'tab'|'group', id: number }

  async function handleRowDrop(draggedInfo, targetInfo, dropPosition) {
    try {
      let targetIndex = -1;
      if (targetInfo.type === 'tab') {
        const targetTab = currentWindowTabs.find(t => t.id === targetInfo.id);
        if (!targetTab) return;
        targetIndex = targetTab.index;
        if (dropPosition === 'after') {
          targetIndex += 1;
        }
      } else if (targetInfo.type === 'group') {
        const targetGroupTabs = currentWindowTabs.filter(t => t.groupId === targetInfo.id);
        if (targetGroupTabs.length === 0) return;
        if (dropPosition === 'before') {
          targetIndex = targetGroupTabs[0].index;
        } else {
          targetIndex = targetGroupTabs[targetGroupTabs.length - 1].index + 1;
        }
      }

      if (targetIndex === -1) return;

      if (draggedInfo.type === 'tab') {
        await new Promise(resolve => {
          chrome.tabs.move(draggedInfo.id, { index: targetIndex }, resolve);
        });
      } else if (draggedInfo.type === 'group') {
        const draggedGroupTabs = currentWindowTabs.filter(t => t.groupId === draggedInfo.id);
        if (draggedGroupTabs.length === 0) return;
        const draggedTabIds = draggedGroupTabs.map(t => t.id);
        await new Promise(resolve => {
          chrome.tabs.move(draggedTabIds, { index: targetIndex }, resolve);
        });
      }
    } catch (err) {
      console.error('[window_marker] drag-drop move failed:', err);
    }
  }

  // 5. 渲染标签页（包含 Chrome Tab Groups 的折叠显示）
  function renderTabsUI(tabs, groups, tabSourceLabels = {}) {
    const tabListEl = document.getElementById('tabList');
    const tabCountEl = document.getElementById('tabCount');
    if (!tabListEl) return;

    // 过滤掉标识页本身
    const otherTabs = tabs.filter(tab => {
      return tab.url && !tab.url.includes('window_marker.html');
    });

    tabCountEl.textContent = otherTabs.length;

    const showSource = ['same-window', 'scoped-window', 'same-window-specific-group'].includes(mode);
    const thSource = document.getElementById('thSource');
    if (thSource) {
      thSource.style.display = showSource ? '' : 'none';
    }

    if (otherTabs.length === 0) {
      const colspan = showSource ? 6 : 5;
      tabListEl.innerHTML = `
        <tr>
          <td colspan="${colspan}" class="empty-message">${t_str.emptyTabs}</td>
        </tr>
      `;
      return;
    }

    // 缓存当前活跃 Tab ID
    const activeTab = tabs.find(t => t.active);
    const activeTabId = activeTab ? activeTab.id : null;

    // 映射 TabGroups 信息
    const groupsMap = new Map();
    groups.forEach(g => {
      groupsMap.set(g.id, g);
    });

    let tabIndex = 1;
    let html = '';
    let currentGroupId = null;

    otherTabs.forEach(tab => {
      const tabGroupId = (tab.groupId && tab.groupId !== -1) ? tab.groupId : null;
      if (tabGroupId !== currentGroupId) {
        currentGroupId = tabGroupId;
        if (currentGroupId) {
          // 渲染分组的 Header 行
          const group = groupsMap.get(currentGroupId) || { title: `Group ${currentGroupId}`, color: 'grey', id: currentGroupId };
          const isCollapsed = collapsedGroups.has(currentGroupId);
          const arrowClass = isCollapsed ? 'collapsed' : '';
          const groupTitle = group.title || `${t_str.workspaceTitle} Group`;
          const groupTabsCount = otherTabs.filter(t => t.groupId === currentGroupId).length;

          html += `
            <tr class="group-header-row ${arrowClass}" data-group-id="${currentGroupId}">
              <td colspan="${showSource ? 6 : 5}">
                <div class="group-header-content" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                  <div class="group-header-left" style="display: flex; align-items: center; gap: 8px;">
                    <span class="group-arrow fas fa-chevron-down" style="color: var(--color-group-${group.color});"></span>
                    <span class="group-prefix-label" style="font-size: 11px; color: var(--color-group-${group.color}); font-weight: 600;">${escapeHTML(t_str.tabGroupPrefix || '')}</span>
                    <span class="group-color-dot color-${group.color}"></span>
                    <span class="group-title" style="color: var(--color-group-${group.color}); font-weight: 600;">${escapeHTML(groupTitle)}</span>
                    <span class="panel-count" style="margin-left: 4px; color: var(--color-group-${group.color}); font-weight: 600;">${groupTabsCount}</span>
                  </div>
                  <div class="group-header-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-sm action-group-drag" title="${t_str.actionDrag || 'Drag to Reorder'}" style="cursor: grab; display: inline-flex; align-items: center; justify-content: center; color: var(--color-group-${group.color});">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M6 13V9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5a7 7 0 0 0 7 7h3a5 5 0 0 0 5-5v-5"/>
                      </svg>
                    </button>
                    <button class="btn btn-sm action-group-close" title="${t_str.actionCloseGroup || 'Close Tab Group'}" style="color: var(--color-group-${group.color});">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }
      }

      // 渲染标签行
      const isCollapsed = tabGroupId && collapsedGroups.has(tabGroupId);
      const rowStyle = isCollapsed ? 'style="display:none;"' : '';
      const isCurrentActive = tab.id === activeTabId;
      const domain = tab.url ? new URL(tab.url).hostname : 'Local Page';
      const faviconUrl = getFaviconUrl(tab.url);

      const sourceLabelInfo = tabSourceLabels[tab.id];
      let sourceLabel = '';
      let sourceColor = '';
      if (sourceLabelInfo) {
        if (typeof sourceLabelInfo === 'object') {
          sourceLabel = sourceLabelInfo.text || '';
          sourceColor = sourceLabelInfo.color || '';
        } else {
          sourceLabel = String(sourceLabelInfo);
        }
      }
      const sourceTd = showSource ? `
        <td>
          <div class="cell-source" title="${escapeHTML(sourceLabel)}" style="${sourceColor ? `color: ${sourceColor} !important; font-weight: 600;` : ''}">${escapeHTML(sourceLabel)}</div>
        </td>
      ` : '';

      let serialColorStyle = 'color: var(--text-muted);';
      if (isCurrentActive) {
        serialColorStyle = 'color: var(--accent); font-weight: bold;';
      } else if (tabGroupId) {
        const group = groupsMap.get(tabGroupId);
        if (group && group.color) {
          serialColorStyle = `color: var(--color-group-${group.color}); font-weight: 600;`;
        }
      }

      html += `
        <tr class="tab-row" data-tab-id="${tab.id}" ${rowStyle}>
          <td style="text-align: center; font-family: var(--font-mono); padding-left: 4px !important; padding-right: 4px !important; ${serialColorStyle}">
            ${tabIndex++}
          </td>
          <td style="text-align: center; padding-left: 4px !important; padding-right: 4px !important;">
            <div class="cell-icon" style="margin: 0 auto;">
              <img data-url="${escapeHTML(tab.url || '')}" src="${faviconUrl || '../icons/icon16.png'}" onerror="this.style.display='none'" />
            </div>
          </td>
          <td>
            <div class="cell-title" title="${escapeHTML(tab.title || '')}">${escapeHTML(tab.title || 'Untitled Tab')}</div>
          </td>
          <td>
            <div class="cell-domain" title="${escapeHTML(tab.url || '')}">${escapeHTML(domain)}</div>
          </td>
          ${sourceTd}
          <td style="text-align: center;" onclick="event.stopPropagation()">
            <div class="action-buttons">
              <button class="btn btn-sm action-drag" title="${t_str.actionDrag || 'Drag to Reorder'}" style="cursor: grab; display: inline-flex; align-items: center; justify-content: center;">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M6 13V9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5a7 7 0 0 0 7 7h3a5 5 0 0 0 5-5v-5"/>
                </svg>
              </button>
              <button class="btn btn-sm action-focus" title="${t_str.actionFocus}">
                <i class="fas fa-external-link-alt"></i>
              </button>
              <button class="btn btn-sm action-close" title="${t_str.actionClose}">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tabListEl.innerHTML = html;

    // 绑定事件：
    // 1. 点击 Tab 组头部折叠/展开 与 组操作
    tabListEl.querySelectorAll('.group-header-row:not(.collapsed-disabled)').forEach(headerRow => {
      const groupId = parseInt(headerRow.dataset.groupId, 10);
      if (!Number.isFinite(groupId)) return;

      headerRow.addEventListener('click', (e) => {
        if (collapsedGroups.has(groupId)) {
          collapsedGroups.delete(groupId);
        } else {
          collapsedGroups.add(groupId);
        }
        renderTabsUI(tabs, groups);
      });

      // 绑定组关闭操作
      const closeGroupBtn = headerRow.querySelector('.action-group-close');
      if (closeGroupBtn) {
        closeGroupBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // 获取属于该组的所有 Tab ID
          const tabIds = otherTabs.filter(t => t.groupId === groupId).map(t => t.id);
          if (tabIds.length > 0) {
            if (chrome && chrome.tabs && chrome.tabs.remove) {
              chrome.tabs.remove(tabIds);
            }
          }
        });
      }

      // 绑定组拖动排序事件
      const dragGroupBtn = headerRow.querySelector('.action-group-drag');
      if (dragGroupBtn) {
        dragGroupBtn.addEventListener('mousedown', () => {
          headerRow.setAttribute('draggable', 'true');
        });
        dragGroupBtn.addEventListener('mouseup', () => {
          headerRow.removeAttribute('draggable');
        });
        dragGroupBtn.addEventListener('mouseleave', () => {
          headerRow.removeAttribute('draggable');
        });
      }

      headerRow.addEventListener('dragstart', (e) => {
        draggedInfo = { type: 'group', id: groupId };
        headerRow.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      });
      headerRow.addEventListener('dragend', () => {
        headerRow.classList.remove('dragging');
        tabListEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedInfo = null;
      });
      headerRow.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedInfo) return;
        if (draggedInfo.type === 'group' && draggedInfo.id === groupId) return;
        headerRow.classList.add('drag-over');
      });
      headerRow.addEventListener('dragleave', () => {
        headerRow.classList.remove('drag-over');
      });
      headerRow.addEventListener('drop', async (e) => {
        e.preventDefault();
        headerRow.classList.remove('drag-over');
        if (!draggedInfo) return;
        if (draggedInfo.type === 'group' && draggedInfo.id === groupId) return;

        const rect = headerRow.getBoundingClientRect();
        const dropPosition = (e.clientY - rect.top) < (rect.height / 2) ? 'before' : 'after';
        await handleRowDrop(draggedInfo, { type: 'group', id: groupId }, dropPosition);
      });
    });

    // 2. 点击标签页整行直接跳转对应页
    tabListEl.querySelectorAll('.tab-row').forEach(row => {
      const tabId = parseInt(row.dataset.tabId, 10);
      if (!Number.isFinite(tabId)) return;

      const triggerJump = () => {
        if (chrome && chrome.tabs && chrome.tabs.update) {
          chrome.tabs.update(tabId, { active: true });
        }
      };

      row.addEventListener('click', triggerJump);

      // 绑定 Action 里面的跳转按钮 (以防单独点击)
      const focusBtn = row.querySelector('.action-focus');
      if (focusBtn) {
        focusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerJump();
        });
      }

      // 绑定 Action 里面的关闭标签按钮
      const closeBtn = row.querySelector('.action-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (chrome && chrome.tabs && chrome.tabs.remove) {
            chrome.tabs.remove(tabId);
          }
        });
      }

      // 绑定标签拖动排序事件
      const dragBtn = row.querySelector('.action-drag');
      if (dragBtn) {
        dragBtn.addEventListener('mousedown', () => {
          row.setAttribute('draggable', 'true');
        });
        dragBtn.addEventListener('mouseup', () => {
          row.removeAttribute('draggable');
        });
        dragBtn.addEventListener('mouseleave', () => {
          row.removeAttribute('draggable');
        });
      }

      row.addEventListener('dragstart', (e) => {
        draggedInfo = { type: 'tab', id: tabId };
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        tabListEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedInfo = null;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedInfo) return;
        if (draggedInfo.type === 'tab' && draggedInfo.id === tabId) return;
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (!draggedInfo) return;
        if (draggedInfo.type === 'tab' && draggedInfo.id === tabId) return;

        const rect = row.getBoundingClientRect();
        const dropPosition = (e.clientY - rect.top) < (rect.height / 2) ? 'before' : 'after';
        await handleRowDrop(draggedInfo, { type: 'tab', id: tabId }, dropPosition);
      });
    });

    // Clean up bookmarkTabSourceLabels to avoid memory leaks (query all tabs globally to support multi-window)
    if (showSource) {
      (async () => {
        try {
          if (chrome.storage && chrome.storage.local && chrome.tabs && chrome.tabs.query) {
            const allTabs = await new Promise(resolve => {
              chrome.tabs.query({}, resolve);
            });
            if (allTabs) {
              const activeTabIds = new Set(allTabs.map(t => String(t.id)));
              let changed = false;
              for (const tid in tabSourceLabels) {
                if (!activeTabIds.has(tid)) {
                  delete tabSourceLabels[tid];
                  changed = true;
                }
              }
              if (changed) {
                await chrome.storage.local.set({ bookmarkTabSourceLabels: tabSourceLabels });
              }
            }
          }
        } catch (_) {}
      })();
    }
    updateFaviconsFromCache(tabListEl);
  }

  // 6. 获取当前状态并更新列表
  async function refreshTabsList() {
    if (!chrome || !chrome.tabs) return;

    try {
      if (currentWindowId === null) {
        const currentWin = await new Promise(resolve => {
          chrome.windows.getCurrent({ populate: false }, resolve);
        });
        if (currentWin) {
          currentWindowId = currentWin.id;
        }
      }

      if (currentWindowId === null) return;

      // 1. 获取所有标签页
      const tabs = await new Promise(resolve => {
        chrome.tabs.query({ windowId: currentWindowId }, resolve);
      });
      currentWindowTabs = tabs;

      // 2. 获取标签分组
      let groups = [];
      if (chrome.tabGroups && chrome.tabGroups.query) {
        groups = await new Promise(resolve => {
          chrome.tabGroups.query({ windowId: currentWindowId }, resolve);
        });
      }

      // 3. 获取所有工作区窗口数量
      if (chrome.windows && chrome.windows.getAll) {
        const allWins = await new Promise(resolve => {
          chrome.windows.getAll({ populate: false }, resolve);
        });
        const metaWindowCountEl = document.getElementById('metaWindowCount');
        if (metaWindowCountEl && allWins) {
          metaWindowCountEl.textContent = allWins.length;
        }
      }

      // 3. 获取所有标签来源信息
      let tabSourceLabels = {};
      try {
        if (chrome.storage && chrome.storage.local) {
          const data = await chrome.storage.local.get(['bookmarkTabSourceLabels']);
          tabSourceLabels = data.bookmarkTabSourceLabels || {};
        }
      } catch (_) {}

      // 4. 渲染 UI
      renderTabsUI(tabs, groups, tabSourceLabels);

    } catch (e) {
      console.warn('[window_marker] refreshTabsList failed:', e);
    }
  }

  // 7. 获取并渲染关联的书签 (仅永久栏目且提供了 nid 时)
  async function loadAssociatedBookmarks() {
    if (!chrome || !chrome.bookmarks) return;

    if (lt === 'permanent' && nid) {
      try {
        const bookmarksPanel = document.getElementById('bookmarksPanel');
        const bookmarkListEl = document.getElementById('bookmarkList');
        const bookmarkCountEl = document.getElementById('bookmarkCount');

        if (!bookmarksPanel || !bookmarkListEl) return;

        const tree = await new Promise(resolve => {
          chrome.bookmarks.getSubTree(nid, resolve);
        });

        if (!tree || !tree[0] || !tree[0].children) {
          bookmarksPanel.style.display = 'none';
          return;
        }

        const list = tree[0].children.filter(item => item.url);
        if (list.length === 0) {
          bookmarksPanel.style.display = 'none';
          return;
        }

        bookmarkCountEl.textContent = list.length;
        bookmarksPanel.style.display = 'flex';

        bookmarkListEl.innerHTML = list.map(item => {
          const domain = new URL(item.url).hostname;
          const faviconUrl = getFaviconUrl(item.url);
          return `
            <tr class="tab-row" data-url="${escapeHTML(item.url)}">
              <td style="text-align: center; padding-left: 4px !important; padding-right: 4px !important;">
                <div class="cell-icon" style="margin: 0 auto;">
                  <img data-url="${escapeHTML(item.url || '')}" src="${faviconUrl || '../icons/icon16.png'}" onerror="this.style.display='none'" />
                </div>
              </td>
              <td>
                <div class="cell-title" title="${escapeHTML(item.title || '')}">${escapeHTML(item.title || 'Untitled Bookmark')}</div>
              </td>
              <td>
                <div class="cell-domain" title="${escapeHTML(item.url || '')}">${escapeHTML(domain)}</div>
              </td>
              <td style="text-align: center;" onclick="event.stopPropagation()">
                <div class="action-buttons">
                  <button class="btn btn-sm btn-primary action-open" title="${t_str.actionOpen}">
                    <i class="fas fa-external-link-alt"></i>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

        updateFaviconsFromCache(bookmarkListEl);

        // 绑定书签的整行点击打开 / 激活事件
        bookmarkListEl.querySelectorAll('tr').forEach(row => {
          const url = row.dataset.url;
          if (!url) return;

          const triggerOpen = async () => {
            const tabs = await new Promise(resolve => {
              chrome.tabs.query({ windowId: currentWindowId }, resolve);
            });
            const existingTab = tabs.find(t => t.url === url);
            if (existingTab && existingTab.id != null) {
              chrome.tabs.update(existingTab.id, { active: true });
            } else {
              chrome.tabs.create({ windowId: currentWindowId, url: url, active: true });
            }
          };

          row.addEventListener('click', triggerOpen);

          const openBtn = row.querySelector('.action-open');
          if (openBtn) {
            openBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              triggerOpen();
            });
          }
        });

      } catch (err) {
        console.warn('[window_marker] loadAssociatedBookmarks failed:', err);
      }
    }
  }

  // 安全过滤 HTML
  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 8. 设置事件监听与主题/语言同步
  function setupTabListeners() {
    if (chrome && chrome.tabs) {
      chrome.tabs.onCreated.addListener(refreshTabsList);
      chrome.tabs.onUpdated.addListener(refreshTabsList);
      chrome.tabs.onRemoved.addListener(refreshTabsList);
      chrome.tabs.onActivated.addListener(refreshTabsList);
      chrome.tabs.onMoved.addListener(refreshTabsList);
    }

    if (chrome && chrome.tabGroups) {
      chrome.tabGroups.onCreated.addListener(refreshTabsList);
      chrome.tabGroups.onUpdated.addListener(refreshTabsList);
      chrome.tabGroups.onRemoved.addListener(refreshTabsList);
    }

    // 监听主应用的主题/语言配置实时同步更新
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area === 'local') {
          if (changes.currentTheme || changes.themePreference) {
            // 只有在用户没有手动更改过本页面主题（无本地 override 记忆）时，才同步主应用的主题更新
            const localOverride = localStorage.getItem('marker_theme_override');
            if (!localOverride) {
              const localPreference = localStorage.getItem('themePreference');
              const changedPreference = changes.themePreference && changes.themePreference.newValue;
              const nextPreference = (changedPreference === 'dark' || changedPreference === 'light' || changedPreference === 'system')
                ? changedPreference
                : ((localPreference === 'dark' || localPreference === 'light' || localPreference === 'system')
                  ? localPreference
                  : (changes.currentTheme ? changes.currentTheme.newValue : 'dark'));
              applyTheme(nextPreference);
            }
          }
          if (changes.preferredLang) {
            lang = changes.preferredLang.newValue;
            t_str = i18n[lang] || i18n.zh_CN;
            updateStaticLabels();
            updateTabTitle(lang);
            initUI(); 
            refreshTabsList(); 
          }
        }
      });
    }
  }

  // 9. DOM Ready 运行
  async function domReadyInit() {
    await initLanguageAndTheme();
    initUI();
    refreshTabsList();
    loadAssociatedBookmarks();
    setupTabListeners();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', domReadyInit, { once: true });
  } else {
    domReadyInit();
  }
})();
