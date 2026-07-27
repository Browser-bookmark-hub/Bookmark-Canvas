# 浏览器书签 `folderType` 根节点识别与跨浏览器边界

状态：2026-07-28 实现快照与维护规范。归档文档不替代当前代码；改动导入、导出或永久书签逻辑前必须重新核对代码。

## 1. 目的

本规范定义 Bookmark Canvas 在 Chrome、Microsoft Edge 等 Chromium 浏览器之间传输永久书签时，如何识别浏览器书签根节点，以及哪些根可以参与跨浏览器导入、导出、推送、拉取和恢复。

目标是只同步用户可编辑的书签内容，不把浏览器实现细节、企业策略内容或浏览器专属功能误当成可迁移数据。

## 2. 事实来源与识别规则

- 根节点来自 `chrome.bookmarks.getTree()` 的原始结果；应用不会根据 UI 文案自行发明根类型。
- 正常识别优先使用 API 返回的 `folderType`。它是稳定的英文枚举，和浏览器界面语言无关。
- `title` 仅是用户可见标题，可能是中文、英文、管理员自定义名称或其他语言；不能作为正常跨浏览器匹配依据。
- 固定 Chrome ID（历史上的 `1`、`2`、`3`）只允许用于兼容旧数据的受限兜底，不能作为根节点的事实来源。
- 浏览器可能让任一 `folderType` 出现零个、一个或多个根；根 ID 只在当前浏览器配置文件内有效。

Chrome 官方对 `folderType`、`syncing` 和根节点可变性的定义：

- https://developer.chrome.com/docs/extensions/reference/api/bookmarks

`syncing` 表示浏览器自身是否把该节点同步到内建账号服务。它不是 Bookmark Canvas 的跨浏览器同步开关，不能据此推断本项目是否应导出该根。

## 3. 标准根类型

| `folderType` | 浏览器语义 | 是否用户可编辑 | 当前永久树/导出行为 | 当前覆盖导入行为 |
| --- | --- | --- | --- | --- |
| `bookmarks-bar` | 浏览器顶部书签栏 | 是 | 保留 | 可清空并重建，或增量更新 |
| `other` | 书签管理器中的其他书签 | 是 | 保留 | 可清空并重建，或增量更新 |
| `mobile` | 通常面向用户移动设备的书签根 | 是 | 保留 | 可清空并重建，或增量更新 |
| `managed` | 企业管理员或受监管账号配置的顶层根 | 否 | API 可读，当前仍可保存在本地 BCS/导出快照中 | 导入入口统一丢弃，不进入全量或增量执行树 |

Chrome 将 `mobile` 定义为通常在用户移动设备可用、但仍可由扩展或书签管理器修改的书签根。因此它与 `managed` 不同，属于可迁移的用户书签根。它不保证在每个 Chrome 或 Edge 配置文件中都存在。

Microsoft Edge 桌面扩展支持 Chromium 的 `bookmarks` API：

- https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support

因此代码必须读取实际 `getTree()` 结果，而不能假定 Chrome 和 Edge 都具备同一数量、同一 ID 的根。

## 4. 浏览器专属或未知根

Edge Workspace 等浏览器专属根，或未来出现但不在本项目白名单内的 `folderType`，统一视为本机根：

1. 从 Chrome/Edge API 读取时可以存在于原始书签树中。
2. 写入 Bookmark Canvas 的永久 BCS 树时被过滤，不进入导出沙盒。
3. 因此不会进入文件导出、GitHub 推送或基于永久树生成的备份。
4. 拉取、覆盖导入、恢复时，包内未知根会被过滤；目标浏览器本机已有的未知根必须保留，不清空、不重建、不匹配。

未知根的默认策略是“隔离且保留本机”，不是删除。这样既不会把 Edge Workspace 写入 Chrome，也不会在一次 Chrome 到 Edge 的覆盖导入中毁掉 Edge 的浏览器专属数据。

## 5. `managed` 的权限边界与当前例外

`managed` 不是普通杂根，而是策略根。Chrome 的 `ManagedBookmarks` 和 Edge 的 `ManagedFavorites` 均由企业/学校管理员或受监管账号下发；用户与扩展不能修改，其内容不随用户账号同步。

- Chrome: https://chromeenterprise.google/policies/managed-bookmarks/
- Edge: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/managedfavorites

这意味着扩展可以通过 `getTree()` 读取到它，但不能通过 `create`、`update`、`move`、`remove` 复制、覆盖或删除它，也不能在另一台浏览器凭导入包创建一个 `managed` 根。监听 `onCreated`、`onRemoved`、`onChanged`、`onMoved` 只负责观察变化，不能绕过浏览器策略权限。

### 当前实现事实

当前 `__canPersistBookmarkRootSyncing()` 仍将 `managed` 与三个用户根一同列入本地持久化白名单。因此浏览器 API 读到的 `managed` 可以保存在本地 BCS，并随本地导出/备份快照保存；导出逻辑没有因为导入边界而改变。

导入入口在解析 `bcs:perm:main.tree` 后、计算差异和选择增量/全量分支之前，调用 `__isWritableOverwriteRootType()`，只保留 `bookmarks-bar`、`other`、`mobile` 三个可写根。`managed` 在此处被丢弃，因此不会进入增量映射、全量清空、递归创建或最终执行校验。

这项边界不会尝试绕过浏览器策略：`managed` 仍可被读取和导出，但不会被本项目的导入/拉取恢复写回。

### 当前最终边界

- 导出/备份：允许读取并保存 `managed`，保持原始快照的可观察性。
- 导入/拉取：在共同入口丢弃 `managed`，不让它进入任何恢复分支。
- 全量与增量：共享同一过滤结果；增量不再单独映射 `managed`，全量也不再处理它。
- Workspace/未知根：继续按未知根规则过滤，不进入永久 BCS 或恢复执行树。

## 6. 当前实现落点

- `storageBCS_core.js`
  - `__normalizeBookmarkFolderType()`：统一根类型字符串。
  - `__canPersistBookmarkRootSyncing()`：永久树根白名单；当前包含四种类型。
  - `__getPermanentRootMatchKey()`：优先从 `folderType` 建立根匹配键，旧 ID/标题仅作兜底。
  - `__normalizePermanentTreeSnapshotForLocalStorage()`：在永久 BCS 写入边界过滤未知根。
- `import-export-transfer-feature.js`
  - `__isWritableOverwriteRootType()`：导入入口只允许三个可写根进入恢复执行树。
  - `__getOverwriteRootType()`：将导入根解析为可识别的标准类型。
  - `__performOverwriteImport()`：在计算差异/分支选择前过滤导入根；只清空并写入已确认的可写用户根，保留本机 `managed`/未知根。

## 7. 操作准则

1. 导入前以本机 `getTree()` 的实时树确认可写根，绝不从远端包拿 Chrome ID 直接作为 `parentId`。
2. 用户根的跨浏览器匹配以 `folderType` 为主；ID 和标题都不是跨设备身份。
3. 覆盖导入的共同入口只允许 `bookmarks-bar`、`other`、`mobile` 三个根进入全量或增量执行。
4. 浏览器新增根类型时，默认隔离；只有在官方语义、实测 API 输出和可写/可恢复边界均明确后，才允许加入同步白名单。
5. 所有读取到但不可写的根都必须在设计上被视为“本机状态”，不能把事件监听或重试逻辑当作权限绕过手段。
