# GitHub / Obsidian 远程同步功能删除计划书

## 0. 目标与边界

本计划用于从 Bookmark-Canvas 中删除 **GitHub 仓库同步 / Obsidian Git 兼容同步** 功能，包括前台 UI、后台 GitHub 通信、同步状态、冲突面板、恢复锁、manifest、远程推拉与相关文档入口。

### 0.1 用户明确要求

- **删干净**：项目尚未进入生产版本，不需要保留生产兼容、旧同步数据迁移、旧同步配置兼容。
- **只删远程同步功能**：不要误删其他功能修复、小功能和本地能力。
- **区分整文件删除与嵌入式清理**：有些同步功能独立在文件/目录里，可直接删除；有些嵌入在后台、HTML、CSS、主 JS、桥接模块里，需要按块清理。

### 0.2 本次要删除的“同步”定义

本计划中的“同步”特指：

- GitHub repository sync
- Obsidian Git compatible sync
- 云端 push / pull / first sync
- 远程冲突检测与冲突面板
- 恢复锁、恢复快照、断点继续
- `bcs-sync-manifest.json` 及相关同步元信息
- `canvas-obsidian-git-sync-*` 存储键
- `githubRepo*` 配置项
- 后台 `canvasGit*` 消息与 GitHub API 调用

### 0.3 不能误删的非远程同步

以下虽然包含 `sync` 字样，但不是 GitHub/Obsidian 远程同步，必须保留：

- **视图同步**：`canvas:view:v1:*`、`CANVAS_VIEW_SYNC_SIGNAL_KEY`、`canvasViewSync*`
- **相机/视口同步**：`syncViewportVisualState`
- **颜色同步**：`menuColorSync`、`menuDefaultColorSync`、`menuLocatableColorSync`、`tempColorUnlockSync`
- **DOM/状态同步含义的本地函数**：例如本地 UI 状态对齐、滚动条/展开状态同步
- **BCS 本地存储**：`bcs:*` 本地协议与本地持久化
- **本地导入/导出**：导入导出 JSON/Markdown/.canvas 的能力
- **永久书签本地功能**：Chrome bookmarks、增量 DOM 更新、拖拽、右键菜单、懒加载
- **画布功能**：临时栏目、空白卡片、pan/zoom、布局、侧栏、搜索

---

## 1. 复查结论：同步代码分布

从 `2a5587fe72f183af7271b4059b25090cc7300203..HEAD` 和当前代码复查，远程同步功能分为两类：

### 1.1 可整文件/整目录删除

这些文件几乎完全服务 GitHub/Obsidian 远程同步，可整体删除：

| 路径 | 处理方式 | 原因 |
| --- | --- | --- |
| `history_html/sync/obsidian-git-sync.js` | 删除整个文件/目录 | 前台远程同步主实现，包含设置、dirty、manifest、push/pull、冲突、恢复锁、UI 绑定 |
| `github/repo-api.js` | 删除 | 后台 GitHub Contents / Git Data API 封装，只服务远程同步 |
| `github/github-token-guide.html` | 删除 | GitHub Token 配置帮助页，只由同步 UI 打开 |
| `github/github-token-guide.js` | 删除 | Token 帮助页脚本，只服务上面的 HTML |

### 1.2 需要嵌入式清理

这些文件不能整体删除，只能删除其中远程同步相关块：

| 路径 | 清理内容 |
| --- | --- |
| `background.js` | GitHub API import、后台同步状态、恢复快照、GitHub 文件读写/list/delete/batch、`canvasGit*` 消息、同步调度 |
| `history_html/history.html` | 同步脚本引用、同步按钮、同步弹窗、同步帮助 popover |
| `history_html/history.js` | 同步 i18n、同步 DOM 文案刷新、同步按钮绑定、`CanvasObsidianGitSync` 调用、远程标脏调用 |
| `history_html/history.css` | `.canvas-sync-*`、同步弹窗、同步按钮布局、`canvas-sync-enabled-layout` 分支 |
| `history_html/bookmark_canvas_module.js` | `CanvasObsidianExportBridge` 等远程同步桥接导出；保留本地导入导出和 BCS 逻辑 |
| `manifest.json` | 评估权限是否可降权；不要因同步删除误删 favicon 仍需的 `<all_urls>` |

### 1.3 文档和计划书

同步专属文档可在代码清理稳定后删除或归档，尤其：

- `docs/应用级同步元信息实施计划书.md`
- `docs/Archived/obsidian-sync-plan-v1.md`
- `docs/Archived/sync-guide.md`
- `docs/Archived/sync-panels-ui-plan.md`
- `docs/Archived/sync-plan-background-mismatch-and-badge.md`
- `docs/Archived/sync-plan-granular-dirty.md`
- `docs/Archived/sync-plan-markdown-first-data-model.md`
- `docs/Archived/sync-plan-obsidian-git.md`
- `docs/Archived/sync-plan-remotely-save.md`
- `docs/Archived/sync-plan-simplified-sync-and-crash-recovery.md`
- `docs/Archived/sync-validation-checklist.md`

注意：历史文档中可能引用同步文件作为设计背景。若目标是“代码删干净”，文档可后置；若目标是“仓库语义也删干净”，则同步专属文档也应删除。

---

## 2. 整文件删除清单

### 2.1 删除 `history_html/sync/`

删除：

```text
history_html/sync/obsidian-git-sync.js
history_html/sync/
```

该文件包含：

- `SETTINGS_KEY = 'canvas-obsidian-git-sync-settings-v1'`
- `RUNTIME_KEY = 'canvas-obsidian-git-sync-runtime-v1'`
- `CONFLICT_LOG_KEY`
- `PENDING_CONFLICT_KEY`
- `RECOVERY_KEY`
- `ACTIVE_RUN_RECOVERY_KEY`
- `RECOVERY_LOCK_KEY`
- `DIRTY_STATE_KEY`
- `PATH_MAP_KEY`
- `PREV_SYNC_INDEX_KEY`
- `REPO_CONFIG_KEYS = ['githubRepoToken', 'githubRepoOwner', ...]`
- 同步 UI 绑定
- GitHub push/pull
- Obsidian 文件构建
- manifest 冲突裁决
- 恢复锁/恢复快照/冲突面板
- `window.CanvasObsidianGitSync`

由于用户要求不做生产兼容，删除该文件后无需保留旧 storage key 迁移、清理或兼容读取逻辑。

### 2.2 删除 `github/`

删除：

```text
github/repo-api.js
github/github-token-guide.html
github/github-token-guide.js
github/
```

删除后必须清理：

- `background.js` 顶部 import
- 同步 UI 中打开 token guide 的按钮和逻辑
- `manifest.json` / web accessible resources 中如果未来单独列出这些资源，也要移除

---

## 3. `history_html/history.html` 清理计划

### 3.1 删除同步脚本引用

删除：

```html
<script src="sync/obsidian-git-sync.js" defer></script>
```

### 3.2 删除设置菜单中的远程同步入口

删除：

```html
<button id="syncCanvasOtherBtn" class="settings-menu-item settings-storage-item" type="button">
```

保留：

- `#importCanvasOtherBtn`
- `#exportCanvasOtherBtn`
- `#clearMenuOtherBtn`
- `#settingsStorageSyncBlock` 容器本身，除非确认只剩同步用途

### 3.3 删除画布悬浮工具条同步按钮

删除：

```html
<button class="zoom-btn" id="canvasFloatingSyncBtn" title="同步" type="button">
```

删除后 CSS 需要调整工具条列布局，不能留下同步按钮占位。

### 3.4 删除同步弹窗

删除整个块：

```html
<div class="canvas-manage-modal canvas-sync-modal" id="canvasSyncModal" style="display: none;">
  ...
</div>
```

当前大致范围：`history.html:1035-1308`。

该块包含：

- repo 设置页
- token 输入
- branch/base path 设置
- 配置帮助
- 测试连接/保存配置
- 启用同步开关
- 首次同步
- Obsidian 导出格式
- 永久栏目拉取方式
- 增量阈值
- 双端冲突策略
- 立即同步/仅拉取/仅上传
- 备份快照
- 恢复锁面板
- 冲突面板

### 3.5 删除同步帮助 popover

删除：

```html
<div class="perf-help-popover canvas-sync-help-popover" id="canvasSyncFirstSyncHelpPopover">
<div class="perf-help-popover canvas-sync-help-popover" id="canvasSyncRepoBranchHelpPopover">
```

如果 popover 只服务同步弹窗，应一并删除。

### 3.6 保留视图同步 UI

保留：

```html
#canvasViewSyncToggleBtn
#canvasViewSyncPanel
#canvasViewSyncHint*
```

它们是本地视图/分区状态同步，不是 GitHub/Obsidian 远程同步。

---

## 4. `history_html/history.js` 清理计划

### 4.1 删除同步 i18n 键

删除远程同步相关 i18n：

- `canvasFloatingSyncText`
- `canvasFloatingSyncTitle`
- `canvasRemotelySyncTitle`
- 所有 `canvasSync*`
- GitHub repo / token / branch / base path 说明
- Obsidian export format 说明
- permanent pull mode 说明
- conflict policy 说明
- recovery / snapshot / status / queue / sha / dirty 文案

保留：

- `canvasViewSync*`
- `syncViewportVisualState` 相关非 i18n 逻辑
- 颜色同步相关设置文案

### 4.2 删除同步 DOM 文案刷新逻辑

删除 `updateLanguage()` 或类似函数中所有远程同步 DOM 更新，例如：

- `canvasSyncModalTitle`
- `canvasSyncOfficialPluginBtnText`
- `canvasSyncTokenGuideBtnText`
- `canvasSyncTabRepoBtn`
- `canvasSyncTabBehaviorBtn`
- `canvasSyncTabStatusBtn`
- `canvasSyncToastToggleLabel`
- `canvasSyncRepoOwnerLabel`
- `canvasSyncPermanentPullModeLabel`
- `canvasSyncStructuredConflictPolicySelect`
- `canvasSyncNowText`
- `canvasSyncPullOnlyText`
- `canvasSyncPushOnlyText`
- `canvasSyncRecovery*`
- `canvasSyncConflict*`

删除：

```js
if (window.CanvasObsidianGitSync && typeof window.CanvasObsidianGitSync.refreshI18n === 'function') {
    window.CanvasObsidianGitSync.refreshI18n();
}
```

### 4.3 删除同步入口按钮绑定

搜索并删除：

- `syncCanvasOtherBtn`
- `canvasFloatingSyncBtn`
- `canvasSyncModal`
- `CanvasObsidianGitSync.openPanel`
- `CanvasObsidianGitSync.runSync`
- `CanvasObsidianGitSync.requestSyncNow`

删除后确认点击“管理”“导入”“导出”“清除”等仍正常。

### 4.4 删除远程标脏调用

删除形如：

```js
const syncModule = window.CanvasObsidianGitSync;
if (syncModule && typeof syncModule.markDirty === 'function') {
    syncModule.markDirty(...);
}
```

已见示例：永久栏目展开状态变化后调用 `markDirty('permanent-expand', ...)`。

注意：只删除远程标脏调用，不删除本地保存，例如：

- `saveTreeExpandState(...)`
- 本地 cache / BCS 写入
- DOM 更新

### 4.5 删除远程导入入口

如果存在从 GitHub 读远程快照再导入的逻辑，例如：

- `readRemoteSnapshotForImport`
- `initializeRemoteSnapshotFromLocal`
- 通过 `CanvasObsidianGitSync` 暴露给导入按钮的远程读取

应删除。保留本地文件导入。

### 4.6 清理后搜索目标

`history.js` 中应清空或仅剩文档无关命中：

```text
CanvasObsidianGitSync
canvasSync
canvasFloatingSync
syncCanvasOtherBtn
canvasGit
githubRepo
bcs-sync-manifest
```

允许保留：

```text
canvasViewSync
syncViewportVisualState
menuColorSync
tempColorUnlockSync
```

---

## 5. `history_html/history.css` 清理计划

### 5.1 删除远程同步样式

删除：

- `.canvas-sync-modal`
- `.canvas-sync-main-layout`
- `.canvas-sync-tab-*`
- `.canvas-sync-row`
- `.canvas-sync-switch`
- `.canvas-sync-actions`
- `.canvas-sync-note`
- `.canvas-sync-status`
- `.canvas-sync-recovery`
- `.canvas-sync-conflict`
- `.canvas-sync-help-popover`
- `.canvas-sync-enabled-layout`
- `#canvasFloatingSyncBtn` 专属样式

### 5.2 调整悬浮工具条布局

当前 CSS 中存在两套布局：

- `.canvas-zoom-indicator:not(.canvas-sync-enabled-layout)`
- `.canvas-zoom-indicator.canvas-sync-enabled-layout`

删除远程同步后应只保留无同步按钮布局。不要留下依赖 `canvas-sync-enabled-layout` class 的分支。

### 5.3 保留非远程同步样式

保留：

- `.settings-view-sync-*`
- `.settings-storage-block` 中导入/导出/清除仍需要的样式
- 颜色同步设置样式
- 画布基础布局样式

---

## 6. `background.js` 清理计划

### 6.1 删除 GitHub import

删除：

```js
import { applyRepoFilesBatch, deleteRepoFile, getRepoBlobBySha, getRepoBranchHeadSignal, getRepoFile, listRepoFiles, testRepoConnection, upsertRepoFile } from './github/repo-api.js';
```

如果删除后没有 import，`manifest.json` 中 `background.type = 'module'` 可以暂时保留，不影响运行。

### 6.2 删除后台同步状态和常量

删除：

- `CANVAS_GIT_SYNC_BG_STATE_KEY`
- `CANVAS_GIT_SYNC_RECOVERY_KEY`
- `CANVAS_GIT_SYNC_RECOVERY_KEEP_LATEST`
- `CANVAS_GIT_SYNC_RECOVERY_REASON_IDLE`
- `CANVAS_GIT_SYNC_RECOVERY_REASON_MANUAL`
- `CANVAS_GIT_SYNC_BG_SETTINGS_DEFAULT`
- `DEFAULT_CANVAS_GIT_SYNC_BG_RUNTIME`
- `GITHUB_SYNC_FILE_WARN_BYTES`
- `GITHUB_SYNC_FILE_LIMIT_BYTES`

### 6.3 删除后台同步函数族

删除与以下关键词相关的函数：

- `CanvasGitSync`
- `canvasGitSync`
- `GitHubRepo`
- `normalizeGitHubRepoPath`
- `resolveCanvasGitConfig`
- `buildCanvasGitRemoteRevision`
- `filterCanvasManagedSyncFilesForRevision`
- `ensureCanvasGitSyncBackgroundTargetState`
- `restoreCanvasGitSyncBackgroundScheduling`
- `runCanvasGitSyncBackgroundRecoverySnapshot`
- `handleCanvasGit*Message`

### 6.4 删除生命周期调度调用

删除所有：

```js
restoreCanvasGitSyncBackgroundScheduling().catch(() => {});
```

出现位置包括：

- `runtime.onInstalled`
- `runtime.onStartup`
- background 初始化末尾

保留 `clearExtensionBadge()`，除非确认 badge 只服务同步。

### 6.5 删除同步 message action

删除 `runtime.onMessage` 中这些分支：

- `canvasGitSyncUpdateContext`
- `canvasGitSyncGetBackgroundState`
- `canvasGitSyncRunRecoverySnapshotNow`
- `canvasGitReadFile`
- `canvasGitReadBlobBySha`
- `canvasGitTestConfig`
- `canvasGitWriteFile`
- `canvasGitApplyFilesBatch`
- `canvasGitDeleteFile`
- `canvasGitListFiles`
- `canvasGitReadRemoteSignal`

保留：

- side panel action handlers
- `canvasFetchFaviconDataUrl`
- `getBookmarkSnapshot`
- `extensionBookmarkOpen`
- command 打开 canvas
- favicon broadcast

### 6.6 旧同步 storage 不做兼容

因为不需要生产版本兼容：

- 不需要读取旧 `canvas-obsidian-git-sync-*`
- 不需要迁移旧 `githubRepo*`
- 不需要保留清理旧数据的 UI
- 可以让旧 storage key 自然废弃

若后续希望“连本地旧垃圾键也清掉”，可以另做一次开发者维护脚本，但不应加到运行时代码里。

---

## 7. `history_html/bookmark_canvas_module.js` 清理计划

### 7.1 删除远程同步桥接暴露

重点搜索并清理：

- `CanvasObsidianExportBridge`
- `applySyncFilesReplace`
- 同步专用 `buildSyncFiles`
- 同步专用 `applySyncFiles*`
- 同步专用 permanent pull/overwrite bridge

删除原因：这些接口主要供 `obsidian-git-sync.js` 调用；删除主同步模块后不应保留死桥。

### 7.2 保留本地导入导出与 BCS

不能因为函数名含 `obsidian` 或 `sync` 就删除。以下应保留或逐个确认：

- Obsidian Canvas 风格 Markdown/Canvas 本地导出能力
- `vendor/obsidian-markdown.js` 的本地渲染/转换能力
- BCS 本地存储：`bcs:canvas`、`bcs:section:*`、`bcs:perm:*`
- 本地导入 JSON/Markdown/.canvas 的转换函数
- 永久栏目 Chrome ID 写回/本地快照逻辑，如果它也被本地导入/Chrome 事件使用

### 7.3 高风险点

`bookmark_canvas_module.js` 中存在大量本地协议和导入导出逻辑，远程同步桥可能复用了这些函数。正确做法：

1. 删除 `window.CanvasObsidianExportBridge = ...` 暴露。
2. 删除只被该桥调用的同步 wrapper。
3. 对被本地导入导出调用的底层函数保留。
4. 删除后用引用搜索确认没有死函数或缺失函数。

---

## 8. `manifest.json` 与权限

### 8.1 `host_permissions`

当前：

```json
"host_permissions": [
  "<all_urls>"
]
```

远程同步删除后，GitHub API 不再需要该权限。但 `background.js` 的 favicon 抓取仍可能需要跨域 fetch。

计划：

- 第一轮不强行删除 `<all_urls>`。
- 等确认 favicon 功能是否仍依赖跨域 fetch 后，再单独降权。

### 8.2 `web_accessible_resources`

当前只暴露：

- `icons/icon200.png`
- `history_html/*`

删除 `github/` 后无需额外调整，除非后续发现 manifest 单独暴露了 GitHub guide。

---

## 9. 文档清理计划

### 9.1 第一优先级：运行时代码删干净

先完成：

- UI 不可见
- 同步 JS 不加载
- 后台不再访问 GitHub
- 搜索无运行时代码引用

### 9.2 第二优先级：同步文档删除

如果目标是仓库层面也清爽，删除同步专属文档：

- `docs/应用级同步元信息实施计划书.md`
- `docs/Archived/obsidian-sync-plan-v1.md`
- `docs/Archived/sync-guide.md`
- `docs/Archived/sync-panels-ui-plan.md`
- `docs/Archived/sync-plan-background-mismatch-and-badge.md`
- `docs/Archived/sync-plan-granular-dirty.md`
- `docs/Archived/sync-plan-markdown-first-data-model.md`
- `docs/Archived/sync-plan-obsidian-git.md`
- `docs/Archived/sync-plan-remotely-save.md`
- `docs/Archived/sync-plan-simplified-sync-and-crash-recovery.md`
- `docs/Archived/sync-validation-checklist.md`

注意：部分历史文档可能只是提到同步，不代表整篇文档都是同步功能。删除文档前应按文件名和内容判断。

---

## 10. 执行顺序建议

### 阶段 A：先断前台入口

1. 删除 `history.html` 的 `sync/obsidian-git-sync.js` script。
2. 删除 `syncCanvasOtherBtn`。
3. 删除 `canvasFloatingSyncBtn`。
4. 删除 `canvasSyncModal` 和同步 popover。
5. 删除 `history.js` 中对应 i18n 和 DOM 刷新。
6. 删除按钮事件绑定和 `CanvasObsidianGitSync` 调用。

验收：页面能打开，控制台无 `CanvasObsidianGitSync` 未定义报错。

### 阶段 B：删除前台同步实现文件

1. 删除 `history_html/sync/obsidian-git-sync.js`。
2. 删除空目录 `history_html/sync/`。
3. 搜索确认无加载/调用引用。

验收搜索：

```text
obsidian-git-sync
CanvasObsidianGitSync
canvasSyncModal
syncCanvasOtherBtn
canvasFloatingSyncBtn
```

### 阶段 C：删除后台 GitHub 能力

1. 删除 `github/` 目录。
2. 清理 `background.js` import。
3. 删除后台同步函数族。
4. 删除 `canvasGit*` message action。
5. 删除后台同步调度。

验收搜索：

```text
canvasGit
githubRepoToken
github/repo-api
repo-api.js
github-token-guide
```

### 阶段 D：清理桥接和 CSS

1. 清理 `bookmark_canvas_module.js` 的 `CanvasObsidianExportBridge`。
2. 删除 `history.css` 的 `.canvas-sync-*`。
3. 重整悬浮工具条无同步按钮布局。
4. 确认 `canvasViewSync*`、颜色同步、视口同步保留。

### 阶段 E：文档和残留关键词清理

1. 删除同步专属文档。
2. 跑全仓搜索。
3. 确认仅剩允许保留的非远程 sync 命中。

---

## 11. 验证清单

### 11.1 语法检查

```bash
node --check background.js
node --check history_html/history.js
node --check history_html/bookmark_canvas_module.js
node --check history_html/bookmark_tree_context_menu.js
node --check history_html/bookmark_tree_drag_drop.js
node --check history_html/search/search.js
```

### 11.2 差异检查

```bash
git diff --check
```

### 11.3 远程同步关键词应清空

运行时代码中应无命中：

```text
CanvasObsidianGitSync
CanvasObsidianExportBridge
obsidian-git-sync
canvasGit
canvasSyncModal
canvasFloatingSyncBtn
syncCanvasOtherBtn
githubRepoToken
githubRepoOwner
githubRepoName
githubRepoBranch
githubRepoBasePath
bcs-sync-manifest
canvas-obsidian-git-sync
```

### 11.4 允许保留的关键词

以下命中允许保留：

```text
canvasViewSync
CANVAS_VIEW_SYNC_SIGNAL_KEY
syncViewportVisualState
menuColorSync
menuDefaultColorSync
menuLocatableColorSync
tempColorUnlockSync
suppressScrollSync
```

这些不是 GitHub/Obsidian 远程同步。

### 11.5 手动功能验收

- 扩展能加载。
- 侧边栏能打开/关闭。
- Canvas 视图能打开。
- 画布 pan/zoom 正常。
- 永久栏目显示正常。
- 永久栏目展开/折叠/懒加载正常。
- 永久书签新增/删除/移动/改名正常。
- 临时栏目正常。
- 空白卡片正常。
- 导入/导出本地文件正常。
- 搜索正常。
- 设置菜单中不再有远程“同步”。
- 悬浮工具条中不再有远程“同步”。
- 不再出现 GitHub 仓库配置、Token、冲突、恢复锁 UI。
- 后台不再发起 GitHub API 请求。

---

## 12. 风险与处理原则

### 12.1 最大风险

最大风险不是删除独立同步文件，而是误删混在主文件里的非同步能力。例如：

- `history.js` 中的永久书签 DOM 更新
- `bookmark_canvas_module.js` 中的 BCS 本地协议
- `history.css` 中设置菜单和画布工具条基础布局
- `background.js` 中 favicon 和 side panel 消息

### 12.2 处理原则

- 看到 `sync` 不等于删除。
- 看到 `obsidian` 也不一定删除，因为项目有 Obsidian Canvas 风格的本地 Markdown/Canvas 支持。
- 优先删除明确 GitHub/remote/repo/cloud/push/pull/conflict/recovery/manifest 的代码。
- 不做旧数据兼容，不保留空壳 UI，不保留禁用状态开关。
- 删除后以搜索和手动功能验收为准。

---

## 13. 最终完成标准

删除完成后，仓库运行时代码应满足：

1. 没有 GitHub/Obsidian 远程同步 UI。
2. 没有 GitHub token 配置帮助页。
3. 没有 GitHub API 封装和后台 message action。
4. 没有 `CanvasObsidianGitSync` 前台模块。
5. 没有同步冲突/恢复锁/manifest/dirty 队列逻辑。
6. 本地导入导出、BCS、永久书签、临时栏目、画布、搜索、侧栏仍正常。
7. 不保留生产兼容或旧同步迁移代码。
