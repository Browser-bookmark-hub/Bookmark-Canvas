# 后续跟踪：浏览器根模型与 GitHub 哈希

检索日期：2026-07-04

## 一、Chromium 新的 dual-storage 根模型

### 官方变化

Chrome 官方 bookmarks API 当前已经明确给 `BookmarkTreeNode` 增加了两个关键字段：

- `folderType`：Chrome 134+，用于标识由浏览器添加、用户或扩展不能直接修改的特殊文件夹类型。
- `syncing`：Chrome 134+，用于区分同一 `folderType` 下账号同步版本与本地版本。

关键点不是“根节点 id 或标题是什么”，而是：

- 同一种 `folderType` 可能有 0 个、1 个或多个节点。
- 浏览器可以新增或移除这些特殊文件夹，但扩展 API 不能直接创建/删除它们。
- `syncing` 可能随用户动作变化，不能假定永久稳定。

官方参考：

- Chrome bookmarks API: https://developer.chrome.com/docs/extensions/reference/api/bookmarks

### 对本项目的影响

当前代码已经基本按这个方向建模：

- `__normalizeBookmarkFolderType()` 归一化 `folderType`。
- `__folderTypeToPermanentRootKey()` 用 `folderType` 生成稳定 root key；未知类型会落到 `custom:<type>`。
- `__getPermanentRootMatchKey()` 优先使用 `folderType`，再兜底旧 id 和标题。
- `__normalizePermanentRootMeta()` / `__buildPermanentRootMeta()` 已经保存 `rootDescriptors`，适合承载新增根。

相关代码：

- `Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js`
- `__canPersistBookmarkRootSyncing`
- `__folderTypeToPermanentRootKey`
- `__getPermanentRootMatchKey`
- `__normalizePermanentRootMeta`
- `__buildPermanentRootMeta`

当前白名单：

```js
function __canPersistBookmarkRootSyncing(folderType) {
    const normalized = __normalizeBookmarkFolderType(folderType);
    return normalized === 'bookmarks-bar'
        || normalized === 'other'
        || normalized === 'mobile'
        || normalized === 'managed';
}
```

### Edge Workspace 跟踪点

如果未来 Edge 官方对 Workspace 做了明确属性打标，例如 bookmarks API 返回：

```json
{
  "folderType": "workspace",
  "syncing": true
}
```

那么核心导入/导出流程原则上不需要改。`__folderTypeToPermanentRootKey()` 已经会把未知类型保存成 `custom:workspace`。

最小物理支持只需要补 syncing 白名单：

```js
function __canPersistBookmarkRootSyncing(folderType) {
    const normalized = __normalizeBookmarkFolderType(folderType);
    return normalized === 'bookmarks-bar'
        || normalized === 'other'
        || normalized === 'mobile'
        || normalized === 'managed'
        || normalized === 'workspace';
}
```

### 触发条件

只有同时满足以下条件时才考虑改代码：

1. Edge / Chromium 官方 bookmarks API 确认新增稳定 `folderType`，例如 `workspace`。
2. 实测 `chrome.bookmarks.getTree()` 返回该字段。
3. 该根节点的 `syncing` 对导入/导出恢复有实际意义。

### 暂不处理的内容

- 不再依赖固定 id 或标题判断新根类型。
- 不为了猜测性 Workspace 名称提前加入业务逻辑。
- 不在没有官方 `folderType` 的情况下把普通文件夹硬编码成 Workspace。

## 二、GitHub 推送哈希计算方法

### 当前官方状态

GitHub Contents API 更新文件时，`sha` 字段仍表示“被替换文件的 blob SHA”。GitHub Git Blob API 也仍说明 blob 对象保存文件内容，并计算、存储文件的 SHA-1 hash。

官方参考：

- GitHub Contents API: https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28
- GitHub Git Blobs API: https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28
- GitHub API versions: https://docs.github.com/en/rest/overview/api-versions
- Git hash-function transition: https://git-scm.com/docs/hash-function-transition

GitHub REST API 版本当前通过 `X-GitHub-Api-Version` 控制。本项目目前固定使用：

```js
const GITHUB_API_VERSION = '2022-11-28';
```

截至 2026-07-04，GitHub 官方文档显示 REST API 最新版本为 `2026-03-10`，`2022-11-28` 仍是受支持版本，支持结束日期为 2028-03-10。因此这里不是立即要改版本，而是要在后续升级 API version 时重点确认 `sha` 字段语义是否变化。

相关代码：

- `Bookmark-Canvas-main/history_html/transfer_AI_sync/github-repo-api.js`
- `Bookmark-Canvas-main/history_html/transfer_AI_sync/github-package-transfer.js`

### 当前代码做法

推送前本地会计算 Git blob SHA，用来跳过远端已经一致的文件：

```js
async function calculateGitBlobSha(content) {
    const bodyBytes = textToUtf8Bytes(content);
    const headerBytes = textToUtf8Bytes(`blob ${bodyBytes.byteLength}\0`);
    const payload = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
    payload.set(headerBytes, 0);
    payload.set(bodyBytes, headerBytes.byteLength);
    return await sha1Hex(payload);
}
```

这和 Git SHA-1 blob 对象命名规则一致：`blob <size>\0<content>` 后做 SHA-1。

用途边界：

- 用于本地/远端内容相同判断，减少不必要上传。
- 远端更新仍以 GitHub 返回的远端 `sha` 为准。
- 如果未来 GitHub 对对象 hash 或 API 响应字段升级，本地跳过逻辑是第一风险点。

### 后续跟踪点

Git 官方已有 SHA-256 迁移设计；GitHub 当前 REST 文档仍按 blob SHA-1 表述。后续需要关注：

1. GitHub REST API 是否新增 blob hash algorithm 字段。
2. Contents API 的 `sha` 字段是否仍保证是 SHA-1 blob SHA。
3. GitHub 是否推出新的 REST API version，并在 breaking changes 中调整 `sha` 字段语义。
4. GitHub 是否对 SHA-256 仓库、双 hash 映射或对象格式暴露新 API。

### 如果 GitHub 改了哈希语义

优先不要在业务层到处改 SHA 计算，应先收敛到一个适配点：

```js
async function calculateGitBlobSha(content, options = {}) {
    // 当前：SHA-1 over `blob <size>\0<content>`
    // 未来：按 GitHub 返回的 hash algorithm / API version 分支
}
```

推荐迁移顺序：

1. 保留旧 SHA-1 逻辑作为默认。
2. 从 GitHub API 响应中读取 hash algorithm 或字段长度。
3. 根据远端 `sha` 长度或官方字段选择算法。
4. 对比失败时退化为“上传并让 GitHub 校验远端 sha”，不要阻塞推送。
5. 给推送日志增加 hash algorithm / compared / skipped 指标，方便回归。

### 当前结论

现在不需要修改推送哈希逻辑。

理由：

- GitHub 官方当前 blob 文档仍是 SHA-1。
- Contents API 更新文件仍要求传入被替换文件的 blob SHA。
- 本项目已显式设置 `X-GitHub-Api-Version: 2022-11-28`。
- GitHub API versioning 机制会对 breaking changes 给出新版本和迁移窗口。

应保持跟踪，但不要提前改。

## 三、后续 API 支持与触屏设备

### 触屏支持的后续条件

暂不单独为 Android 触屏设备增加一套交互实现。Bookmark Canvas 当前以桌面浏览器扩展环境为主要运行边界，现有触摸板、指针事件和拖拽支持不等同于完整的移动触屏适配。

后续是否增加触屏需求，以 Android 官方正式支持 Chrome 扩展及其相关扩展 API 为前提。只有当官方支持范围、页面生命周期、Side Panel / 标签页能力、指针与手势事件模型足够稳定后，才评估以下内容：

- 移动端画布布局、工具窗和二级 UI 的触控命中区域；
- 单指拖动、双指平移、捏合缩放和系统手势冲突；
- 卡片编辑、拖拽、滚动、全屏和键盘缺失时的替代操作；
- Android 设备上的性能、休眠恢复和扩展页面生命周期；
- 触控无障碍、横竖屏切换和不同屏幕尺寸的适配。

在官方支持出现之前，不为假设中的 Android Chrome 扩展环境引入专用 API、移动端分支或触屏 UI 重构；继续维护桌面 Chrome / Edge 扩展的现有行为，并跟踪 Chromium 官方 API 变化。
