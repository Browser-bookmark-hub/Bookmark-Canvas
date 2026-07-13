# 画布页面生命周期与后台 dirty 边界

整理日期：2026-07-14

## 结论

本计划只解决两个边界：

1. commit `d170aa391f564dc428d11b842753ae20ec2a2f06` 引入的后台 dirty，只作为“没有画布前台文档时，Chrome 书签树可能领先 BCS 永久树”的后台兜底标记。
2. 画布 tab 或侧边栏 iframe 休眠/冻结/断线后恢复时，按前台生命周期处理：先禁止旧页面写回 BCS；确认是旧上下文恢复时，第一版直接刷新当前画布文档一次。

后台 dirty 不接管前台，不处理休眠页，不负责临时栏目、Markdown、连接线、布局，也不做多页面广播。

## 画布前台定义

只把真正运行画布应用的 `history.html` 文档算作画布前台：

- 普通标签页：`history_html/history.html?view=canvas`。
- 侧边栏 iframe：`history_html/history.html?view=canvas&sidepanel=1`。

不算画布前台：

- `panel-shell.html` 壳。
- `sidebar.html` 配置/入口页。
- GitHub token 配置、说明页、guide 页。
- 默认打开窗口、标签页管理、入口/设置类扩展页面。
- 其他只读/配置/帮助页面。

## 当前代码事实

### 后台 dirty

当前 [background.js](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/background.js:33) 有永久书签 dirty 状态：

- `registerCanvasPermanentBookmarkDirtyListener()` 在 service worker 顶层注册。
- 监听 `bookmarks.onCreated`、`onRemoved`、`onMoved`、`onChanged`。
- 额外监听 `onChildrenReordered`、`onImportEnded`，作为全量兜底信号。
- 第一次事件写 `canvasPermanentBookmarksDirty=true`、`dirtyAt`、`reason`、`version`。
- dirty 已经为 true 后，后续事件只走内存/存储短路，不重复写 storage。
- 当前代码还没有按“是否存在画布前台文档”来启停 dirty；这是目标边界，不是现状。

前台通过 runtime message 读取/清理 dirty：

- [history.js](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/history.js:12485) 的 `getBookmarkTreeSnapshot()` 发现 dirty 后，会从 Chrome 书签树同步永久栏目到 BCS，再按 version 清 dirty。
- `schedulePermanentMainStorageSyncFromChrome()` 同步成功后也会清 dirty。

### 前台监听

当前 [history.js](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/history.js:16112) 的 `setupBookmarkListener()` 已经在 `history.html` 中处理书签变化：

- 增、删、移进入队列，按 quiet window 批处理。
- 改名/改 URL 先 flush 队列，再立即处理。
- 小批量走永久栏目 BCS 增量 patch 和 DOM/cache patch。
- 大批量、重排、导入、增量失败时，回退到从 Chrome 书签树全量同步永久栏目。

所以只要有活跃画布前台，永久栏目变化就应该继续走现有前台路径。

### 侧边栏结构

当前 [manifest.json](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/manifest.json:22) 的 `side_panel.default_path` 是 `panel-shell.html`。

[panel-shell.html](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/panel-shell.html:42) 里用 iframe 加载 `history_html/history.html?view=canvas&sidepanel=1`。真正的画布、前台书签监听、BCS 同步都在 iframe 的 `history.html` 里，不在壳里。

[sidepanel_toggle_bridge.js](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/sidepanel_toggle_bridge.js:1) 只在 `sidepanel=1` 时建立 runtime port，并在 connect、focus、visible 时发 hello。当前没有周期性 heartbeat；port 在线只能说明 iframe 画布上下文是活跃候选，不能证明它已经完成所有恢复检查。

## 浏览器事实

- Chrome `tabs.Tab.discarded` 表示 tab 内容已从内存卸载，激活时会重新加载。
- Chrome `tabs.Tab.frozen` 表示内容仍在内存，但 event handlers、timers 等任务不能执行，激活时解冻。
- Page Lifecycle 提供 `freeze`、`resume`，并可在页面 load 时用 `document.wasDiscarded` 判断是否从 discard 后重新加载。
- `focus`、`visibilitychange`、`pageshow` 是普通生命周期事件，不等同于休眠恢复。
- `runtime.getContexts()` 只能返回当前匹配的 extension contexts，不证明 iframe 内画布已经完成初始化或恢复检查。
- runtime Port 会在 tab/frame unload 等场景断开；port 断开可以作为“不可靠”信号，但不能让后台 dirty 接管前台。

## 状态边界

### 1. 全部关闭

这里的“全部关闭”是指没有任何画布前台 `history.html` 文档存在。

永久栏目：

- 后台 dirty 只记录一次“Chrome 书签树可能领先 BCS 永久树”。
- 不做增量 patch，不渲染，不广播。
- 下次任意画布前台打开时，前台读取 dirty，从 Chrome 书签树全量同步永久栏目到 BCS，然后清 dirty。

临时栏目、Markdown、连接线、布局：

- 没有活跃 UI 产生这类操作。
- 下次打开按冷启动从 BCS 读取。

### 2. 有活跃前台，也有休眠/非可靠页面

活跃前台：

- 继续使用现有 `chrome.bookmarks` 前台监听处理永久栏目。
- 继续使用 BCS 分片、`bcs:signal`、`storage.onChanged` 做画布状态同步。

休眠/非可靠页面：

- 不参与实时同步决策。
- 不补错过的 `storage.onChanged` / `BroadcastChannel`。
- 恢复后先进入统一恢复检查；检查开始前暂停 BCS 写入。
- 确认是旧 JS 上下文从 frozen/sleeping/非可靠状态恢复时，第一版直接刷新当前画布文档一次。
- 刷新后走冷启动，从 BCS 读取画布状态，并按 dirty 或 Chrome 书签源检查永久栏目。

### 3. 全部不可靠/休眠，但画布文档仍存在

后台 dirty 不启用，也不处理这些页面。

原因：画布前台文档仍存在，这是前台生命周期问题，不是后台关闭期。恢复策略和第 2 节一致：暂停写入，确认旧上下文恢复后刷新当前画布文档一次。

### 4. 全部活跃

- 后台 dirty 关闭或保持空闲短路。
- 永久栏目由前台现有书签监听处理。
- 画布状态由现有 BCS 同步机制处理。

## 休眠恢复策略

第一版不尝试补齐休眠期间错过的所有增量，默认用刷新换安全。

### 普通画布 tab

- `discarded` / `document.wasDiscarded === true`：浏览器已经重新加载页面，按冷启动处理，不再二次 reload。
- `frozen` / sleeping 后恢复：旧 JS 内存可能还在，旧 debounce save、timer、blur save 可能先跑。恢复检查开始前先暂停 BCS 写入，然后刷新当前画布文档一次。
- 普通 `focus`、`visibilitychange`、`pageshow`：不等同于休眠，不默认刷新；只做普通一致性检查。

### 侧边栏 iframe

- 如果浏览器重建了 side panel / iframe，iframe 会重新 load，按冷启动处理。
- 如果 iframe 旧 JS 上下文从隐藏、暂停、port 断开等非可靠状态恢复，刷新 iframe 当前文档一次。
- 如果只是 port 断开后重连，重连本身不立刻刷新；后续 load/visible/focus 进入统一恢复检查。
- 从 iframe 内调用 `window.location.reload()` 只刷新 `history.html` iframe，不打开新标签页。

### 防止双刷新

恢复检查必须是单入口：

- `load`、`pageshow`、`visibilitychange`、`focus`、`resume` 只能调度同一个 reconcile。
- 真正 reload 前设置 `reloadPending` 和短周期 reload guard。
- guard 生效期间，后续恢复事件直接跳过。
- `document.wasDiscarded === true` 或普通新 load 已经是冷启动，不再因为同一轮事件二次 reload。

## 实现缺口

当前代码尚未具备：

- background 还没有维护“是否存在画布前台文档”的轻量判断。普通 tab 可先用 `tabs.query` / `tabs.onUpdated` / `tabs.onRemoved` + URL 规则；侧边栏只看 iframe port，不把 `panel-shell.html` 壳算作画布文档。
- 页面还没有统一的 `freeze` / `resume` / `document.wasDiscarded` / `pageshow` / `visibilitychange` 恢复入口。
- 页面还没有恢复检查期间的 BCS 写入暂停 guard。
- 页面还没有统一的 `reloadPending` / reload guard。
- 旧页面恢复后，永久栏目还缺少“从 Chrome 书签树确认或同步”的集中入口；不能只看 BCS timestamp。

## 不做的事

- 不引入 heartbeat。
- 不引入 single writer。
- 不为休眠页面补队列。
- 不让后台 dirty 处理前台休眠/冻结/port 断开。
- 不把 token 配置页、入口页、标签页管理页、`panel-shell.html` 壳算作画布前台。

## 参考资料

- Chrome tabs API: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome Page Lifecycle API: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Chrome runtime.getContexts: https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts
- Chrome extension message passing / Port lifetime: https://developer.chrome.com/docs/extensions/develop/concepts/messaging#port-lifetime
- Chrome sidePanel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Edge sidebar extensions: https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar
- Edge Sleeping Tabs policy: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/sleepingtabsenabled
