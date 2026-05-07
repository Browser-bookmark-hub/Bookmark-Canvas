# 永久栏目 JSON 真相源与 sourceID 嵌入式存储改造计划书（执行版，2026-04-26）

> 返回文档索引：[docs/README.md](./README.md)

## 1. 目的

把永久栏目改成和临时栏目一样的 JSON-first 存储模型。

本次改造的核心目的不是单纯换字段，而是让插件内部永久栏目 JSON 和“推送到云端的永久栏目 JSON”保持同一套结构。这样同步时可以直接用云端 JSON 覆盖插件内部对应 JSON，再和 Chrome Bookmarks API 原生书签树完成交互、应用和回写，不再靠旧的独立 sourceID 表临时拼出一份永久栏目数据。

全局前提：

1. 当前还不是生产版本，不保留旧结构兼容包袱。
2. 不做长期过渡兼容层，不保留旧字段 fallback，不为了旧数据保留复杂分支。
3. 当前旧数据只允许作为一次性迁移输入；迁移完成后按目标态运行。

最终目标：

1. 插件内部永久栏目有完整 JSON 真相源。
2. 永久树节点的 `sourceID` 直接嵌入节点 JSON。
3. 云端永久 JSON、手动导出永久 JSON、插件内部永久 JSON 的同步字段同形同义；插件内部可以多保存本地 Chrome ID 字段。
4. Chrome Bookmarks API 是浏览器原生书签树接口；永久栏目的书签树执行对象就是浏览器原生书签树。插件内部永久 JSON 是可同步、可直接覆盖的结构化真相源，必须和 Chrome 原生书签树双向交互并保持一致。
5. Chrome ID 是插件本地必须保存和使用的句柄，优先沿用 Chrome Bookmarks API 原生字段 `id`，直接嵌入插件本地永久树节点；推送云端/手动导出时剥离。
6. 不再把 `bcs:perm:source-id-map` 当 `sourceID` 真相源。
7. 永久栏目副本和主永久栏目共享同一棵永久树 JSON；副本只保留显示层差异，例如说明、文件夹折叠展开状态、懒加载状态、垂直滚动条位置、画布锚点/布局。
8. 右键、复制、粘贴、拖拽、搜索、导入导出、同步 pull/push 都必须围绕同一份永久 JSON 真相源工作。
9. 原有函数名、桥接 API、调用入口不要随意重命名；优先保留名称并替换内部实现。确实必须改名时，一次性更新所有调用点，不为了旧结构保留长期兼容包装层。

核心不变量：

1. 本地永久树节点：必须同时承载跨设备身份 `sourceID` 和本地执行句柄 Chrome API `id`。
2. 云端/导出永久树节点：必须保留 `sourceID`，必须剥离 Chrome API `id`。
3. 同步比较、dirty/signature、冲突判断：必须基于剥离本地 `id` 后的同步 JSON。
4. Chrome API 交互后回写 `id`：不是内容变更，不能导致 dirty。
5. 永久副本：不拥有独立树，只拥有 copy-anchor JSON 和显示状态。
6. 空白栏目：不是独立同步文件，只是 `.canvas` 内 `type: "text"` 节点。
7. `bcs:perm:source-id-map`：只能作为一次性迁移输入；目标态不需要 sourceID 映射、Chrome ID 映射、运行期索引或任何独立身份表。
8. 结构化 JSON 操作优先；禁止用字符串替换处理 `id/sourceID/originalId/sourceId` 这类字段。

## 2. 参考路径

这几个路径是本次改造的对照输入：

| 类型 | 路径 | 用途 |
|---|---|---|
| 手动导出 | `/Users/kk/Downloads/书签画布/书签画布/书签画布-20260426 3` | 对照手动导出的目标 JSON 结构 |
| 推送到云端 | `/Users/kk/Downloads/chrome download/test/书签画布` | 对照云端同步的目标 JSON 结构 |
| 插件脚本导出 | `/Users/kk/Downloads/Bookmark Canvas/书签画布` | 对照插件当前导出协议产物 |
| 插件导出脚本 | `/Users/kk/Downloads/书签画布/书签画布/1.js` | 辅助说明当前脚本调用 `buildSyncFiles({ exportFormat: "json" })`，不是主要参考输入；后续会随新模型一起改造 |

当前三份 JSON 产物核对结果：

| 来源 | 永久节点数 | 永久 `sourceID` | 永久缺失 `sourceID` | 临时节点数 | 临时 `sourceID` | `originalId` | `sourceId` |
|---|---:|---:|---:|---:|---:|---:|---:|
| 手动导出 | 91 | 75 | 16 | 106 | 106 | 0 | 0 |
| 云端目录 | 91 | 75 | 16 | 106 | 106 | 0 | 0 |
| 插件脚本导出 | 91 | 75 | 16 | 106 | 106 | 0 | 0 |

参考结论：

1. 三份参考路径里的永久栏目当前都只有主文件 `A书签树（永久栏目）.json`，没有实际永久副本 JSON 样本。
2. 三份永久主文件的一级根文件夹都包含 `folderType` 和 `syncing`，例如 `bookmarks-bar / false`、`other / false`。
3. 永久副本示例不能从这三份路径直接取样，只能按当前代码里的 `copy-anchor` 协议作为目标格式。
4. Chrome ID 在 Chrome Bookmarks API 和当前代码中对应字段是 `id`；计划里的本地永久树也优先沿用 `id`，不要新造 `chromeId`。
5. 推送出去的永久 JSON 以 `/Users/kk/Downloads/chrome download/test/书签画布/永久栏目/A书签树（永久栏目）.json` 为结构基准；本文示例只是缩小版，不是该文件的逐字样本。
6. 目标态相对当前云端参考会多一个要求：永久树所有节点都必须补齐并保留 `sourceID`。本地 Chrome API `id` 仍然不能出现在推送/导出 JSON 中。
7. `syncing` 不是本轮同步流程的运行状态；它是顶层 Chrome 根文件夹元数据，和 `folderType` 一起用于根目录识别/匹配。当前云端参考里 `Bookmarks Bar` 和 `Other Bookmarks` 都是 `syncing: false`，目标态应按实际本地根目录元数据继续写出。

## 3. 当前代码现状

### 3.1 临时栏目

当前临时栏目已经接近目标模型：

1. 存储位置：`chrome.storage.local["bcs:section:*"]`
2. 存储内容：完整 JSON。
3. `sourceID`：直接嵌入临时节点。

### 3.2 永久栏目主栏

当前永久栏目主栏还不是目标模型：

1. 存储位置：`chrome.storage.local["bcs:perm:main"]`
2. 当前内容：主要是 `descriptionMd`、`rootMeta`、`_dirty`、`_signature`、`_filePath` 等壳数据。
3. 当前缺口：没有保存完整永久书签树 `tree`。
4. 当前永久树来源：`chrome.bookmarks.getTree()`。

相关代码：

1. `history_html/bookmark_canvas_module.js`
   - `BCS_PERM_MAIN_KEY = 'bcs:perm:main'`
   - `__buildBcsPermanentPayload(copyId)`
   - `__saveCanvasTempStateToBcsStorage(...)`
2. `history_html/sync/obsidian-git-sync.js`
   - `getPermanentTreeSnapshotForSync()`

### 3.3 永久 `sourceID`

当前永久 `sourceID` 不是完整嵌入式存储：

1. 当前独立身份表 key：`bcs:perm:source-id-map`
2. 当前旧表语义：`Chrome ID -> sourceID`
3. 当前导出/同步时，会从 Chrome API 树和旧表拼出永久 JSON。

相关代码：

1. `PERMANENT_NODE_SOURCE_ID_MAP_STORAGE_KEY = 'bcs:perm:source-id-map'`
2. `__readPermanentNodeSourceIDMap()`
3. `__writePermanentNodeSourceIDMap(...)`
4. `__resolvePermanentNodeSourceID(...)`
5. `__recordPermanentNodeSourceIDMapping(...)`
6. `persistPermanentSourceIDMapAfterApply(...)`

### 3.4 永久栏目副本

当前永久副本是共享永久树的视图壳，不是独立树：

1. 副本相关存储：`bcs:perm:copy-*`、`bcs:perm:copies`、`bcs:canvas`
2. 当前导出角色：`fileRole: "copy-anchor"`
3. 当前副本语义：树内容继承主永久栏目，副本保存说明、锚点、布局/视图状态。

目标中仍保持这个方向：副本不复制整棵树，只保存 copy-anchor JSON 和 view state。

## 4. 目标存储结构

### 4.1 永久主栏

`bcs:perm:main` 应保存完整永久栏目本地 JSON：主体结构对齐导出/云端 JSON，同时额外嵌入本地 Chrome ID。

插件本地 `bcs:perm:main` 示例：

```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "A",
  "title": "书签树 (永久栏目)",
  "descriptionMd": "",
  "fileRole": "primary",
  "fileNote": "永久栏目主文件：书签树的规范真相源。",
  "tree": {
    "id": "0",
    "title": "",
    "children": [
      {
        "id": "1",
        "title": "Bookmarks Bar",
        "sourceID": "src-bookmarks-bar",
        "children": [
          {
            "id": "123",
            "title": "Example Bookmark",
            "url": "https://example.com",
            "sourceID": "src-example"
          }
        ],
        "folderType": "bookmarks-bar",
        "syncing": false
      },
      {
        "id": "2",
        "title": "Other Bookmarks",
        "sourceID": "src-other-bookmarks",
        "children": [],
        "folderType": "other",
        "syncing": false
      }
    ]
  }
}
```

推送云端/手动导出时，同一棵树应剥离 Chrome API 本地 `id`，但保留 `folderType`、`syncing`、`sourceID` 等同步字段：

```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "A",
  "title": "书签树 (永久栏目)",
  "descriptionMd": "",
  "fileRole": "primary",
  "fileNote": "永久栏目主文件：书签树的规范真相源。",
  "tree": {
    "title": "",
    "children": [
      {
        "title": "Bookmarks Bar",
        "sourceID": "src-bookmarks-bar",
        "children": [
          {
            "title": "Example Bookmark",
            "url": "https://example.com",
            "sourceID": "src-example"
          }
        ],
        "folderType": "bookmarks-bar",
        "syncing": false
      },
      {
        "title": "Other Bookmarks",
        "sourceID": "src-other-bookmarks",
        "children": [],
        "folderType": "other",
        "syncing": false
      }
    ]
  }
}
```

要求：

1. `tree` 内所有用户可见的 folder/bookmark 节点必须有 `sourceID`；协议包装根节点 `tree` 本身可以只保留 Chrome API `id`，不强制 `sourceID`。
2. 插件本地 `tree` 节点直接保存 Chrome API 的 `id`，用于调用 Chrome Bookmarks API。
3. 推送云端/手动导出时剥离本地 `id`，只输出可跨设备的同步字段。
4. `folderType`、`syncing` 是永久树一级根文件夹的重要同步字段，必须保留；`syncing` 不是 push/pull 状态，而是根目录身份/匹配元数据。
5. 从云端 pull 覆盖后，先得到没有本地 `id` 的永久树；应用到 Chrome Bookmarks API 原生书签树后，必须把 Chrome 分配的新 `id` 回写进本地 `bcs:perm:main.tree` 节点。
6. `fileRole`、`fileNote`、`descriptionMd` 等当前协议字段不能在示例或实现中漏掉。
7. `_dirty`、`_signature`、`_filePath` 等本地状态应拆到状态 key，不污染同步字段。
8. `rootMeta` 如继续保留，只能作为从 `tree.children[*].folderType/syncing` 派生出来的状态或缓存，不能成为独立于永久树 JSON 的第二真相源。

建议 key：

| key | 用途 |
|---|---|
| `bcs:perm:main` | 永久主栏完整本地 JSON，节点内嵌 `sourceID` 和本地 Chrome API `id` |
| `bcs:perm:main:state` | dirty、signature、filePath、lastSynced 等本地状态 |

说明：这里的本地 Chrome ID 优先使用现有 Chrome Bookmarks API 字段名 `id`，不要新造 `chromeId` 字段。语义必须是“嵌入本地永久树节点”，不要再新建独立 Chrome ID 存储表、映射表或运行期索引。

### 4.2 永久副本

三份参考路径当前没有实际永久副本 JSON 样本。副本目标按当前代码协议收敛：`bcs:perm:copy-*` 应保存 copy-anchor content JSON。

```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "A",
  "title": "书签树（永久栏目）",
  "fileRole": "copy-anchor",
  "anchorOnly": true,
  "inheritFrom": "永久栏目/A书签树（永久栏目）.json",
  "descriptionMd": "",
  "viewState": {
    "scrollTop": 0,
    "collapsedSourceIDs": [],
    "lazyLoadedSourceIDs": []
  }
}
```

要求：

1. 副本不保存独立 `tree`。
2. 副本共享 `bcs:perm:main.tree`。
3. 副本只保存说明、滚动位置、折叠状态、懒加载状态、画布锚点/布局等差异。
4. 折叠状态和懒加载状态使用 `sourceID`，不能使用 Chrome API `id`。

### 4.3 本地 Chrome ID 字段

不再设计任何单独的 Chrome ID 索引。插件本地需要的 Chrome ID 直接跟节点存放：

```json
{
  "id": "123",
  "title": "Example",
  "url": "https://example.com",
  "sourceID": "src-abc"
}
```

要求：

1. 本地 `bcs:perm:main.tree` 节点保存 `sourceID` 和 Chrome API `id`。
2. `sourceID` 是跨设备身份；`id` 是当前 Chrome 本地执行句柄。
3. 导出/上传时剥离本地 `id`。
4. 拉取云端 JSON 覆盖后，应用到 Chrome API 原生书签树，并把新 `id` 回写到本地节点。
5. 插件内右键、拖拽、改名、移动、删除等需要调用 Chrome Bookmarks API 的操作，直接从节点读取 `id`。
6. 剥离 `id` 必须用 JSON 结构化遍历实现，不能用字符串替换，避免误删 URL 查询参数里的 `id=`。

## 5. 必须改的链路

### 5.1 同步

push：

1. 直接读取 `bcs:perm:main`。
2. 直接读取 `bcs:perm:copy-*`。
3. 不再从 `chrome.bookmarks.getTree()` 现场拼永久 JSON。
4. push 前只校验，不自动补齐 `sourceID`。

pull：

1. 解析云端永久 JSON。
2. 替换本地 `bcs:perm:main` 和 `bcs:perm:copy-*`。
3. 用 `bcs:perm:main.tree` 应用到 Chrome Bookmarks API 原生书签树。
4. Chrome API 应用成功后把 Chrome 分配的新 `id` 回写到本地 `bcs:perm:main.tree` 对应节点。
5. 刷新永久主栏和所有永久副本的显示状态。
6. 保留或恢复副本自己的说明、折叠展开、懒加载、垂直滚动条位置、画布锚点/布局等 view state。

云端拉取后的目标顺序：

```text
云端 JSON -> 校验 -> 直接覆盖插件内部永久 JSON -> 应用到 Chrome Bookmarks API 原生书签树 -> 回写 Chrome API id 到本地节点 -> 刷新主栏/副本视图
```

这里“直接覆盖”的对象是永久树和同步字段。云端 JSON 没有 Chrome API 本地 `id`，覆盖后由 Chrome API 应用结果重新写回本地节点；副本显示状态不跟随主树直接覆盖。

### 5.2 导入导出

1. 手动导出和同步 push 共用永久 JSON 读取路径。
2. 手动导入和同步 pull 共用永久 JSON 校验/落地路径。
3. 导入/导出都不能写 `originalId`。
4. 导入/导出都不能写 lower-d `sourceId`。
5. 导出永久 JSON 时不能依赖 `bcs:perm:source-id-map` 补身份。

### 5.3 永久主栏操作

这些操作必须先改 `bcs:perm:main.tree`，再和 Chrome API 原生书签树交互：

1. 新增书签/文件夹
2. 删除书签/文件夹
3. 改名
4. 改 URL
5. 移动
6. 重排

`sourceID` 规则：

| 动作 | 规则 |
|---|---|
| 新建 | 生成新 `sourceID` 并写入 JSON |
| 删除 | 删除节点及其 `sourceID` |
| 改名 | 保留 `sourceID` |
| 改 URL | 保留 `sourceID` |
| 移动/重排 | 保留 `sourceID` |
| 复制为新节点 | 新建 `sourceID` |
| 剪切移动 | 保留 `sourceID` |

### 5.4 永久副本

1. 副本继续共享主永久树。
2. 副本不生成独立树 JSON。
3. 副本说明、垂直滚动条位置、文件夹折叠展开状态、懒加载状态需要落在 copy-anchor JSON 或明确 state 中。
4. 副本折叠状态和懒加载定位使用 `sourceID`，不能使用 Chrome API `id`。
5. 副本导出/同步直接读取 `bcs:perm:copy-*`。
6. 云端覆盖主永久树后，副本仍应指向同一棵新树，并用 `sourceID` 尽量恢复自己的显示状态。

### 5.5 右键、复制、粘贴、拖拽、搜索

这些入口都必须按新模型处理 `sourceID`：

| 操作入口 | 规则 |
|---|---|
| 右键从永久节点创建临时栏目 | 继承永久节点 `sourceID` |
| 右键复制永久节点 | payload 带 `sourceID` 和来源标记 |
| 右键粘贴到永久栏目 | 复制语义新建 `sourceID`，移动语义保留 `sourceID` |
| 右键粘贴到临时栏目 | 保留 payload 中的 `sourceID` |
| 拖拽永久节点到临时栏目 | 继承永久节点 `sourceID` |
| 拖拽临时节点到永久栏目 | 按复制/移动语义决定新建或保留 `sourceID` |
| 永久栏目内部拖拽移动 | 保留 `sourceID` |
| 混合剪贴板 payload | 区分 permanent/temp 来源，不能用 generic temp insert 重新生成永久身份 |
| 搜索结果生成临时栏目 | 从永久结果创建时继承 `sourceID` |
| 外部 URL/HTML 拖入 | 新建 `sourceID` 并写入目标 JSON |

右键菜单涉及的所有永久栏目命令都要按新模型过一遍，不能有命令绕过 `bcs:perm:main.tree` 直接只改 Chrome API。

### 5.6 Chrome 原生书签事件

Chrome 书签管理器或其他入口改动原生书签时，需要同步回 `bcs:perm:main.tree`：

| Chrome 事件 | JSON 处理 |
|---|---|
| `onCreated` | 生成 `sourceID`，插入 JSON |
| `onChanged` | 按事件里的 Chrome ID 在本地永久树节点中查找并更新 title/url |
| `onMoved` | 按 `sourceID` 移动 JSON 节点 |
| `onRemoved` | 删除 JSON 节点 |
| `onChildrenReordered` | 重排 JSON children |

同步 pull 或批量应用到 Chrome API 期间，需要 suppress 自己触发的事件回声。

### 5.7 变脏、签名、lastSynced

当前 `_dirty`、`_signature`、`_lastSyncedSignature`、`_filePath` 是通过 `__buildBcsGuardedPayload(...)` 混在 payload 里。永久栏目改成 JSON-first 后，这套也必须跟着变：

1. `bcs:perm:main` 和 `bcs:perm:copy-*` 保存内容 JSON，不直接混入 `_dirty/_signature/_lastSyncedSignature/_filePath`。
2. 脏状态应放到 `bcs:perm:main:state` 和副本对应 state，或等价的本地状态 key。
3. 永久主栏 signature 必须基于“推送出去的同步 JSON”计算：递归剥离 Chrome API 本地 `id`，保留 `title/url/children/sourceID/folderType/syncing` 和协议外壳字段。
4. Chrome API 交互后回写新的本地 `id`，不能把永久栏目标脏。
5. 用户新增、删除、改名、改 URL、移动、重排，必须更新内容 JSON，并按剥离 `id` 后的同步字段重新计算 signature，必要时标脏。
6. pull 成功后，本地内容 JSON 应标记为 clean：`lastSyncedSignature = signature`，`dirty = false`。
7. pull 失败或 Chrome API 应用失败时，不能更新 lastSynced，也不能把半完成状态标 clean。
8. hash/conflict/compare 只能比较剥离本地 `id` 后的同步字段，不能因为 Chrome 重新分配 `id` 产生假冲突。

### 5.8 守门脚本

同步守门脚本也必须跟着改。当前 `tools/run-sync-guard-acceptance.sh` 还在检查旧的 permanent sourceID 表路径，目标态要改成检查新结构：

1. 禁止运行时代码重新把 `bcs:perm:source-id-map` 当真相源。
2. 禁止导出/同步 JSON 出现 Chrome API 本地 `id`。
3. 检查永久主栏本地 JSON 节点有 Chrome API `id`。
4. 检查导出/云端永久 JSON 剥离了 `id` 但保留 `sourceID/folderType/syncing`。
5. 检查永久树所有用户可见 folder/bookmark 都有 `sourceID`。
6. 检查 lower-d `sourceId` 和 `originalId` 仍然禁写。
7. 检查 dirty/signature 以剥离本地 `id` 后的同步字段计算。
8. `tools/run-sync-plan-regression.sh` 如调用或依赖守门脚本，也要同步更新预期。

### 5.9 全域 dirty/signature 复核

这次不能只改永久栏目 dirty。所有会参与同步的域都要重新核一遍 dirty 来源、signature 口径、清脏时机。

| 域 | 本地存储/文件 | dirty 来源 | signature 口径 | 关键要求 |
|---|---|---|---|---|
| 永久主栏 | `bcs:perm:main` + `bcs:perm:main:state` | 永久树内容、说明、根元数据变更 | 剥离 Chrome API 本地 `id` 后的永久同步 JSON | 回写 Chrome `id` 不标脏；用户内容变更才标脏 |
| 永久副本 | `bcs:perm:copy-*` + 对应 state | 副本说明、滚动、折叠、懒加载、锚点/布局状态变更 | copy-anchor JSON + 副本 view state | 副本不保存独立树；按 `sourceID` 记录显示状态 |
| 临时栏目 | `bcs:section:*` | 临时卡片内容、顺序、层级、sourceID 变更 | 临时栏目 JSON 协议内容 | `sourceID` 继续嵌入节点；字段顺序/格式和导出一致 |
| 画布文件 | `bcs:canvas` -> `*.canvas` | 节点几何、边、file 引用、空白 text 节点内容变更 | 格式化后的 `.canvas` JSON | `.canvas` 后缀文件是画布真相源；不能漏掉 text 节点变化 |
| 空白栏目卡片 | `.canvas` 内 `type: "text"` 节点 | text 节点文字、位置、尺寸、颜色等变更 | 归入 `.canvas` signature | 空白栏目不再是独立 `.md`/JSON 文件；dirty 应落到 canvasLayout/blankIds，并最终影响 `.canvas` |

补充要求：

1. `blankAll/blankIds` 只能作为 dirty patch 的定位/提示，最终同步文件仍是 `.canvas`。
2. `.canvas` 文件名后缀就是 `.canvas`，空白栏目卡片作为 `.canvas` 里的 `type: "text"` 节点保存。
3. `canvasLayout` 覆盖节点几何、边、空白 text 节点、永久/临时/副本卡片在画布上的布局。
4. `canvasFileRef` 覆盖 `.canvas` 中指向永久/临时 JSON 文件的 file path 引用；永久/临时文件路径变化时必须同步更新 `.canvas`。
5. 清脏时必须按域清理：永久主栏/副本、临时栏目、`.canvas` 不能互相误清。
6. pull 成功后要分别更新各域 state 的 lastSynced/signature；只成功一部分时不能全域标 clean。
7. 手动导出、同步 push、dirty compare 应共用同一套 canonical builders，避免“导出没变但 dirty 认为变了”。

## 6. sourceID 补齐规则

只允许两个场景生成 `sourceID`：

1. 一次性迁移旧数据时。
2. 用户新建/外部拖入/复制为新节点时。

不允许这些场景偷偷补：

1. 导出时。
2. push 时。
3. compare/hash 时。
4. 普通 normalize 时。

当前永久树缺失的 16 个 `sourceID`，应该在迁移阶段一次性补齐并写入 `bcs:perm:main.tree`。迁移完成后，如果永久 JSON 再缺 `sourceID`，应该 fail closed 并报出缺失路径。

## 7. 实施顺序

### P0：冻结迁移输入

- [ ] 固定当前 Chrome API 树快照。
- [ ] 固定当前 `bcs:perm:source-id-map`。
- [ ] 固定当前 `bcs:perm:main`、`bcs:perm:copy-*`、`bcs:canvas`。
- [ ] 输出迁移前报告：节点数、`sourceID` 数、缺失路径、重复路径。

### P1：建立永久主栏 JSON 真相源

- [ ] 定义 `bcs:perm:main` 完整本地 JSON schema。
- [ ] 把 dirty/signature/filePath 拆到 `bcs:perm:main:state`。
- [ ] 提供“剥离本地 Chrome API `id` 后的同步 JSON”构建器，供签名、compare、push、导出共用。
- [ ] 写迁移函数：Chrome API 原生书签树 + 旧 `bcs:perm:source-id-map` -> `bcs:perm:main.tree`，迁移完成后删除旧表依赖。
- [ ] 迁移时一次性补齐缺失 `sourceID`。
- [ ] 永久视图读取优先走 `bcs:perm:main.tree`。

### P2：收敛永久副本

- [ ] `bcs:perm:copy-*` 改为 copy-anchor JSON。
- [ ] 副本滚动/折叠状态落到明确位置。
- [ ] 折叠状态从 Chrome API `id` 改为 `sourceID`。
- [ ] 副本导出/同步直接读取 `bcs:perm:copy-*`。

### P3：同步直通

- [ ] push 直接读 `bcs:perm:main` 和 `bcs:perm:copy-*`。
- [ ] pull 直接替换本地永久 JSON 的同步字段。
- [ ] pull 后把 `bcs:perm:main.tree` 应用到 Chrome API 原生书签树。
- [ ] Chrome API 应用成功后把新的 `id` 回写到本地永久树节点。
- [ ] hash/conflict 以剥离本地 `id` 后的同步字段为准。
- [ ] pull 成功后更新 permanent state：signature = lastSyncedSignature，dirty = false。

### P4：本地操作 JSON-first

- [ ] 永久新增、删除、改名、改 URL、移动、重排统一走 JSON mutation。
- [ ] Chrome API 成功后把最新 `id` 写回本地节点。
- [ ] 用户内容变更后按剥离 `id` 的同步字段重新计算 signature/dirty。
- [ ] Chrome 原生事件反向更新 `bcs:perm:main.tree`。
- [ ] bulk apply 期间抑制事件回声。

### P5：移除独立身份源

- [ ] 停用并删除 `bcs:perm:source-id-map` 的目标态角色，仅允许迁移阶段读取一次。
- [ ] 停用 `bcs:perm:source-id-export-keys`。
- [ ] 移除 `persistPermanentSourceIDMapAfterApply` 主链路。
- [ ] 守门脚本阻止重新引入独立身份源。
- [ ] 更新 `tools/run-sync-guard-acceptance.sh` 和 `tools/run-sync-plan-regression.sh` 的旧 permanent sourceID 表断言。
- [ ] 原有函数名和 bridge API 尽量保留；确实不再适用的函数一次性更新所有调用点，不保留长期兼容包装层。

### P6：全域 dirty/signature 回归

- [ ] 复核永久主栏 dirty/signature/lastSynced。
- [ ] 复核永久副本 dirty/signature/lastSynced。
- [ ] 复核临时栏目 dirty/signature/lastSynced。
- [ ] 复核 `.canvas` dirty/signature/lastSynced。
- [ ] 复核空白栏目 text 节点 dirty，确认它落到 `.canvas`，不是独立文件。
- [ ] 复核 `canvasLayout`、`canvasFileRef`、`permanentAll/permanentPaths`、`temporaryIds`、`blankIds` 的触发与清脏边界。
- [ ] 复核 pull 成功、pull 失败、局部成功、push 成功后的清脏行为。

## 8. 模拟执行补充检查

按完整流程模拟后，实施时还必须覆盖这些边界：

1. Chrome 根目录应用：不能把 `tree` 根节点当普通文件夹创建；必须按现有根目录分配逻辑，用 `folderType/syncing` 匹配 `Bookmarks Bar`、`Other Bookmarks`、`Mobile/Managed` 等根目录，再清理/创建其子节点。
2. pull 事务边界：远端 JSON 没有本地 `id`，覆盖后必须完成 Chrome API 应用并回写 `id` 才算成功；失败时不能把半完成的无 `id` 永久树当成正常本地状态。
3. push/导出序列化：从 `bcs:perm:main` 读取本地树后，递归剥离 Chrome API `id`，保留 `title/url/children/sourceID/folderType/syncing` 和协议外壳字段。
4. sourceID 完整性：除协议包装根节点外，所有用户可见永久 folder/bookmark 都必须有 `sourceID`；缺失时迁移阶段补齐，迁移后 push/导出/compare 直接失败并报路径。
5. rootMeta 处理：如果旧代码仍读写 `rootMeta`，必须改为从永久树派生或写入 state；不能让 `rootMeta` 和 `tree.children[*].folderType/syncing` 互相冲突。
6. 副本显示状态：副本没有参考样本，实施前要核当前展开/滚动/懒加载 state 的实际 key；目标是按 `sourceID` 恢复，不是按 Chrome API `id` 恢复。
7. 事件回声：pull 应用或批量重建 Chrome 书签时，会触发 Chrome bookmark events；必须 suppress 自己触发的事件，避免把中间状态反写进永久 JSON。
8. 守门脚本：需要新增检查，禁止重新引入 `bcs:perm:source-id-map` 作为真相源，禁止导出/同步 JSON 出现 Chrome API `id`，并检查永久节点 `sourceID` 完整性。
9. 变脏判断：Chrome API 交互后回写 `id` 不是用户内容变更，不能把永久栏目标脏；只有剥离 `id` 后的同步字段变化才应改变 dirty/signature。
10. 全域 dirty：永久主栏、副本、临时栏目、`.canvas`、空白 text 节点都要覆盖；空白栏目 dirty 最终必须落到 `.canvas` 文件。

## 9. 验收标准

数据验收：

1. `bcs:perm:main` 剥离本地 Chrome API `id` 后，和云端永久 JSON、手动导出永久 JSON 同形同义。
2. 永久树所有 folder/bookmark 节点都有 `sourceID`。
3. 临时栏目所有节点都有 `sourceID`。
4. 导出/同步 JSON 没有 `originalId`。
5. 导出/同步 JSON 没有 lower-d `sourceId`。
6. 导出/同步永久树节点没有 Chrome API 本地 `id` 字段。
7. 插件本地 `bcs:perm:main.tree` 节点保存可用的 Chrome API `id`。
8. permanent dirty/signature 不受本地 Chrome API `id` 变化影响。
9. 空白栏目卡片不生成独立同步文件，只作为 `.canvas` 的 `type: "text"` 节点参与 signature。

行为验收：

1. 云端永久 JSON 可以直接替换 `bcs:perm:main`。
2. 替换后 Chrome 原生书签树能与永久 JSON 对齐为同一结构。
3. push 不再从 Chrome API 现场拼永久 JSON。
4. 右键、复制、粘贴、拖拽、搜索结果创建临时栏目时 `sourceID` 不丢。
5. 永久副本只保存 view state，不保存独立树。
6. 云端覆盖后，Chrome API 生成的新 ID 能回写到本地永久树节点。
7. 现有函数名、调用入口、bridge API 没有无意义重命名导致调用链断裂。
8. pull 成功后永久栏目为 clean；只回写 Chrome API `id` 不会触发下一次 push。
9. 修改永久主栏、永久副本、临时栏目、画布布局、空白 text 节点后，各自 dirty 域正确；同步成功后只清理已同步成功的域。

回归命令：

```bash
node --check history_html/bookmark_canvas_module.js
node --check history_html/sync/obsidian-git-sync.js
./tools/run-sync-guard-acceptance.sh
./tools/run-sync-plan-regression.sh
```
