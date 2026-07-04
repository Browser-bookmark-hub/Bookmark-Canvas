# Favicon 系统当前代码归纳

整理基准：2026-07-04 当前代码现状。

这份文档不是历史计划，而是为了补齐归档目录中的当前实现快照。后续如果 favicon 代码继续变化，应以代码为准。

## 1. 当前结论

当前 favicon 系统是独立能力，不属于 GitHub/Obsidian 同步，也不应随旧同步文档清理而删除权限。

当前系统由三层组成：

- 前台统一缓存与渲染：`history_html/history.js` 的 `FaviconCache`、`getFaviconUrl()`、`getFaviconUrlAsync()`、`updateFaviconImages()`、`warmupFaviconCache()`。
- 后台高质量图标补充：`background.js` 监听 `tabs.onUpdated` 的 `tab.favIconUrl`，转成 data URL 后广播给前台。
- 窗口标记页轻量读取：`history_html/window_marker.js` 使用浏览器 `/_favicon/` 服务，并从 IndexedDB `BookmarkFaviconCache` 批量读取缓存图标。

## 2. Manifest 与权限

当前 `manifest.json` 中 favicon 相关点：

- `permissions` 包含 `favicon`。
- `host_permissions` 包含 `<all_urls>`。
- `web_accessible_resources` 暴露 `icons/icon16.png`、`icon24.png`、`icon32.png`、`icon48.png`、`icon128.png` 和 `history_html/*`。

`<all_urls>` 不是旧远程同步遗留判断。当前后台与前台 favicon 获取仍需要跨域 fetch、浏览器 `/_favicon/`、第三方 favicon 服务等路径兜底。

旧文档中如果出现 `icon200.png` 或只暴露单个旧图标的说法，已经不符合当前 manifest。

## 3. 缓存模型

当前缓存数据库：

```text
IndexedDB: BookmarkFaviconCache
store: favicons
failure store: failures
```

当前 `FaviconCache` 还有多层内存缓存：

- `memoryCache`：hostname -> favicon data URL。
- `dimensionCache`：favicon data URL -> 尺寸。
- `visualProfileCache`：favicon data URL -> 视觉特征。
- `failureCache`：hostname -> 最近失败时间。
- `pendingRequests`：按 hostname 合并进行中的请求。

核心参数快照：

- 请求超时：前台约 `2200ms`，后台 tab favicon 抓取约 `4000ms`。
- 最大图标体积：`512 * 1024`。
- 最小尺寸：`16px`。
- IndexedDB 质量版本：`cacheQualityVersion = 9`。
- failure TTL：`60000ms`。

容量清理来自 commit `920148ba9dff4a948aaa4b6c5cd3a558bfbca0c4`（`fix: favicon系统的清理逻辑`）：

- `FaviconCache.init()` 成功后会通过 `scheduleIdleCleanup()` 安排空闲清理。
- `checkAndEvictOldest()` 会检查 `favicons` store 数量。
- 当 favicon 域名缓存数量达到 `2000` 时，按 `timestamp` 升序淘汰最老的 `500` 个域名。
- 淘汰时会同时从 `memoryCache` 和 IndexedDB `favicons` store 删除对应 domain。

## 4. 前台获取流程

同步入口 `getFaviconUrl(url)` 用于旧渲染兼容：

1. 只接受 `http://` / `https://`。
2. 先按 hostname 查 `FaviconCache.memoryCache`。
3. 命中失败缓存时返回 fallback，同时后台重试。
4. 未命中时异步触发 `FaviconCache.fetch(url)`。
5. 当前渲染先返回灰色星标 `fallbackIcon`。
6. 异步成功后调用 `updateFaviconImages(url, dataUrl)` 更新页面中所有绑定同域名 URL 的图标。

异步入口 `getFaviconUrlAsync(url)` 直接走 `FaviconCache.fetch(url)`，用于能等待结果的场景。

`warmupFaviconCache(bookmarkUrls)` 会从 IndexedDB 批量加载 hostname 对应图标到内存，主要用于避免视图切换或重渲染时真实 favicon 闪回灰色星标。

## 5. 图标来源顺序

当前 `FaviconCache` 会根据网络分支选择不同来源组合。

中文/国内分支注释中的策略：

```text
Cravatar -> Google S2 -> browser /_favicon
```

非中文/海外分支注释中的策略：

```text
Google S2 -> DuckDuckGo -> t3.gstatic.com -> browser /_favicon
```

浏览器内置 fallback 通过：

```text
chrome.runtime.getURL('/_favicon/?pageUrl=...&size=...')
```

后台也会先尝试 `tab.favIconUrl`，失败后再走 `/_favicon?pageUrl=...&size=32`。

## 6. 后台广播流程

`background.js` 监听 `browserAPI.tabs.onUpdated`：

1. 只处理带 `changeInfo.favIconUrl` 且 tab URL 是 HTTP/HTTPS 的页面。
2. 按 URL 做 `FAVICON_UPDATE_COOLDOWN = 5000ms` 冷却，避免重复广播。
3. 使用 `fetchImageAsDataUrl()` 校验图片类型、尺寸、大小和超时。
4. 成功后发送：

```js
{
  action: 'updateFaviconFromTab',
  url: tab.url,
  favIconUrl: faviconFetchResult.dataUrl
}
```

前台收到后，如果是有效 data URL，会写入 `FaviconCache` 并调用 `updateFaviconImages()` 刷新已有 DOM。

前台主动跨域抓取也可通过 message：

```js
{ action: 'canvasFetchFaviconDataUrl', url, options }
```

由后台执行 `fetchImageAsDataUrl()` 后返回。

## 7. 删除与清理流程

当前 favicon 的“删除清理”不是简单地在书签删除时直接删缓存。commit `920148ba9dff4a948aaa4b6c5cd3a558bfbca0c4` 修正过这个问题：删除书签/文件夹时，如果同一个 URL 或同域 favicon 仍被其他书签使用，直接清缓存会导致其他节点图标回退成灰色星标。

当前删除链路：

1. 右键删除书签/文件夹时，`bookmark_tree_context_menu.js` 的 `deleteBookmark()` 调用共享永久书签删除能力。
2. Chrome bookmarks 触发 `bookmarks.onRemoved`。
3. `history.js` 先用 `enrichRemoveInfoWithSnapshot()` 补齐被删节点/子树快照。
4. `handleBookmarkRemoveRealtime()` 调用 `removeBookmarkFromCache(id, removeInfo)`。
5. `removeBookmarkFromCache()` 会收集被删除节点及其子孙 id。
6. 删除前先构造 `remainingUrls`：所有未被删除书签仍引用的 URL。
7. 只有当被删书签的 URL 不在 `remainingUrls` 中，才调用 `removeUrlFromBookmarkSet(url)`，从运行时 URL 引用集合移除。
8. 当前删除事件不会直接调用 `FaviconCache.clear(url)`。

这意味着：

- 删除一个书签，不代表马上删除该域名的 favicon 缓存。
- 删除文件夹时，会按子树收集全部 descendant，避免只处理文件夹本身而漏掉内部书签 URL。
- 同 URL 被多个书签引用时，删掉其中一个不会破坏其他书签的图标显示。
- 大批量删除时也走 `removeBookmarkFromCache()`，同样维护 URL 引用集合，而不是逐条清 favicon。

URL 修改链路：

1. Chrome bookmarks 触发 `bookmarks.onChanged`。
2. `updateBookmarkInCache(id, changeInfo)` 记录旧 URL `prevUrl`。
3. 如果旧 URL 没有被其他书签继续引用，则从 `bookmarkUrlSet` 移除旧 URL。
4. 新 URL 会通过 `addUrlToBookmarkSet(changeInfo.url)` 加入引用集合。
5. 随后的 favicon 获取仍由 `getFaviconUrl()` / `FaviconCache.fetch()` / 后台 tab 广播补齐。

仍然存在的直接清理入口：

```js
{ action: 'clearFaviconCache', url }
```

前台收到这个 runtime message 时会调用 `FaviconCache.clear(url)`。`FaviconCache.clear(url)` 会按 hostname 删除：

- `memoryCache`。
- `dimensionCache` / `visualProfileCache`。
- failure 内存记录。
- IndexedDB `favicons` store。
- IndexedDB `failures` store。

当前代码中，普通书签删除/文件夹删除已经不走这个直接清理入口。

## 8. 渲染覆盖范围

当前 favicon 会出现在：

- 永久书签树节点。
- 临时栏目中的书签型节点。
- 搜索结果。
- 画布书签卡片/分组子项。
- `window_marker.html` 打开的窗口/专属组提示页。
- 右键信息卡中从已渲染节点复用出来的 favicon。

`updateFaviconImages()` 会扫描多类 img：

```text
img.tree-icon
img.canvas-bookmark-icon
img.search-result-favicon
img[data-bookmark-url]
img[data-node-url]
img[data-url]
```

并按 hostname 匹配更新，避免同站点多个 URL 重复请求。

## 9. 当前注意点

- favicon 系统目前没有独立测试覆盖。
- `window_marker.js` 会直接读取 IndexedDB `BookmarkFaviconCache`，所以数据库名和 store 名改动会影响该页面。
- 当前缓存以 hostname 为主键，同域不同页面共享 favicon 是设计选择。
- 灰色星标 fallback 是正常占位，不代表最终获取失败。
- failure cache 只短期抑制频繁失败；失败域名后续仍会重试。
- 书签/文件夹删除只维护 URL 引用集合，不直接清 favicon 缓存；避免误伤仍被其他书签使用的图标。
- 真正的 `FaviconCache.clear(url)` 当前是显式 runtime message 清理入口，不是普通删除事件默认动作。
- GitHub/Obsidian 旧同步删除不应影响 manifest 的 `favicon` 和 `<all_urls>` 判断。
