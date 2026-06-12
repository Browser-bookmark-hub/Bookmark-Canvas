# 存储分片 + 格式对齐 + 守门员变脏 — 完整实施方案

> 时间：2026-03-23
> 基于：实际代码分析 + F12 存储数据

---

## 一、当前存储现状（实测）

### 1.1 chrome.storage.local（10 个键，总 ~512KB）

| 键 | 大小 | 用途 |
|----|------|------|
| `bb_cache_bookmarks_v1` | 278KB | 书签缓存 |
| `lastBookmarkData` | 234KB | 上次书签快照 |
| `canvas-obsidian-git-sync-background-state-v1` | 341B | 同步后台状态 |
| `canvas_marker_*` | ~200B | 标识设置 |
| 其他 | ~300B | 全屏状态、最近移动ID等 |

> [!IMPORTANT]
> **`bookmark-canvas-temp-sections` 在 chrome.storage.local 里不存在！**
> 临时栏目 + 空白卡片 + 连线数据当前没有在 chrome.storage.local 里持久化。

### 1.2 localStorage 关键键

| 键 | 大小 | 用途 |
|----|------|------|
| `bookmark-canvas-sync-protocol-bundle-v1` | **458KB** | 整包同步快照 |
| `permanent-section-position` | ~100B | 永久栏目布局 |
| `permanent-section-copies` | `[]` | 永久栏目副本列表 |
| `canvas-permanent-tip-text` | ~0B | 永久栏目说明 |
| `canvas:view:v1:*` | 各 ~100B | 视图状态(滚动/展开/缩放) |
| `canvas:storage:schema-version` | `"4"` | 存储版本 |
| `canvas-other-settings-v1` | ~600B | 画布设置 |

### 1.3 当前持久化结构（[saveTempNodes](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#37639-37789) 写入的对象）

```javascript
// 一个大对象塞所有东西：
{
  sections: [ ...所有临时栏目(items格式)... ],
  tempSectionCounter: 1,
  tempItemCounter: 7,
  colorCursor: 0,
  tempSectionLastColor: "#2563eb",
  tempSectionPrevColor: null,
  mdNodes: [ ...所有空白卡片... ],
  mdNodeCounter: 4,
  edges: [ ...所有连线... ],
  edgeCounter: 3,
  timestamp: 1774191601538
}
```

### 1.4 当前变脏机制（[saveTempNodes](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#37639-37789) 的 finally 块）

```
saveTempNodes() → 构建 persistedState → 算整包 signature
  → diff 新旧 snapshot → 推导 dirtyPatch（哪些 section/mdNode 变了）
  → 调 syncModule.markDirty('save', { dirty: dirtyPatch })
```

已有的精度：`dirty.temporary.ids[]` 和 `dirty.blank.ids[]` 可以记录哪些卡片脏了。
但问题是：**存储是整包的**，所以写入时还是整包覆写。

---

## 二、改造目标

### 目标 1：分片存储 — 每张卡片独立存储键

```
之前：
  chrome.storage["bookmark-canvas-temp-sections"] = { 全部数据 }

之后：
  chrome.storage["bcs:section:temp-section-1"] = { 这张临时卡片的数据 }
  chrome.storage["bcs:section:temp-section-2"] = { 另一张临时卡片的数据 }
  chrome.storage["bcs:md:md-node-4"] = { 这张空白卡片的数据 }
  chrome.storage["bcs:canvas"] = { nodes, edges }  // 画布布局
  chrome.storage["bcs:meta"] = { counters, colorCursor, ... }  // 全局元数据
```

### 目标 2：格式对齐

| 实体 | 方向 | 说明 |
|------|------|------|
| **临时栏目** | 导出 JSON → 对齐内部 `items` 格式 | 导出改用 `type`/`sectionId`/现有ID |
| **永久栏目** | 导出 JSON → 对齐 Chrome API 格式 | 导出直接用 API 树的字段 |
| **空白卡片** | 内部存储 → 对齐导出 [.md](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/docs/README.md) 格式 | 存纯 `markdownSource`，去掉冗余的 [text](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/sync/obsidian-git-sync.js#6355-6358)/[html](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/sidebar.html) |
| **画布文件** | 内部存储 → 对齐导出 [.canvas](file:///Users/kk/Downloads/chrome%20download/test/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83.canvas) 格式 | 存 `{ nodes, edges }` 标准结构 |

### 目标 3：守门员变脏 — 每张卡片独立签名

```
每张卡片存储时附带：
  _signature: "hash-of-content"
  _lastSyncedSignature: "hash-at-last-sync"
  _dirty: signature !== lastSyncedSignature
  _filePath: "书签画布/临时栏目/..."

推送时：只推 dirty=true 的卡片
成功后：只清那张卡片的 dirty
```

---

## 三、每个实体类型的具体改造

### 3.1 临时栏目

#### 当前内部存储字段（items 格式）
```javascript
section = {
  id: "temp-section-1",
  title: "2026-03-22 20:19:13",
  items: [{
    id: "temp-temp-section-1-1",
    sectionId: "temp-section-1",
    title: "...",
    url: "",              // 文件夹为空字符串
    type: "folder",       // folder / bookmark
    children: [...],
    originalId: null
  }],
  x: 949, y: -60, width: 525, height: 459,
  color: "#2563eb", colorLocked: false, pinned: false,
  createdAt: 1774181953404,
  label: "A-1", sequenceNumber: 1,
  originPermanent: { copyId: null }
}
```

#### 当前导出 JSON Protocol 字段
```javascript
{
  format: "bookmark-canvas-section",
  schemaVersion: 1,
  sectionType: "temporary",
  label: "A-1",
  title: "2026-03-22 20:19:13",
  tempKind: "regular",
  source: "",
  descriptionMd: "",
  tree: {
    id: "tmp/A-1",           // ← 路径ID，不同于内部
    parentId: null,
    kind: "folder",          // ← kind，不同于内部的 type
    children: [...]
  },
  createdAt: "2026-03-22T12:19:13.404Z",  // ← ISO，不同于 Unix timestamp
  originPermanent: { copyId: null },
  sequenceNumber: 1
}
```

#### 改造方案：导出 JSON 对齐内部 items

修改 [__buildTempSectionJsonProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#29718-29741) 和相关导出函数：

```javascript
// 改造后的导出 JSON（对齐内部格式）
{
  format: "bookmark-canvas-section",
  schemaVersion: 2,          // ← 版本号升级
  sectionType: "temporary",
  id: "temp-section-1",      // ← 直接用内部ID
  label: "A-1",
  title: "2026-03-22 20:19:13",
  tempKind: "regular",
  source: "",
  descriptionMd: "",
  items: [{                   // ← 改用 items 而非 tree
    id: "temp-temp-section-1-1",
    sectionId: "temp-section-1",
    title: "当前项目/方向 待整理",
    url: "",
    type: "folder",           // ← type 而非 kind
    children: [...],
    originalId: null
  }],
  createdAt: 1774181953404,   // ← 直接 Unix timestamp
  originPermanent: { copyId: null },
  sequenceNumber: 1
}
```

**改哪些函数**：
- [__buildTempSectionJsonProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#29718-29741) → 不再转换 items→tree，直接输出 items
- [__buildTempSectionBookmarkTreeProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#36071-36086) → 削减或废弃
- [__buildRuntimeTempSectionFromProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#36308-36368) → 导入时直接读 items，无需 tree→items 反转
- [__normalizeCanvasSectionJsonProtocolObject()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#29083-29100) → schemaVersion 2 兼容
- 导入解析中的 [__extractCanvasSectionJsonCodeBlock()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#29107-29123) → 兼容新格式

**不改什么**：
- `section.items` 的运行时结构完全不动
- 所有 UI 操作（拖拽、右键菜单、颜色、折叠、懒加载）完全不动

#### 分片存储键

```
chrome.storage["bcs:section:temp-section-1"] = {
  // 内容（= 导出JSON = 同步推送的内容）
  format: "bookmark-canvas-section",
  schemaVersion: 2,
  sectionType: "temporary",
  id: "temp-section-1",
  label: "A-1",
  title: "...",
  items: [...],
  createdAt: ...,
  ...
  
  // 守门员字段（不导出，仅本地）
  _signature: "a1b2c3d4",
  _lastSyncedSignature: "a1b2c3d4",
  _filePath: "书签画布/临时栏目/常规链式/A-1 2026-03-22 20_19_13.json",
  _dirty: false
}
```

### 3.2 永久栏目

#### 现状

- 真值来自 `chrome.bookmarks` API
- 导出时调 [__buildPermanentSectionJsonProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#29688-29711) 临时构建
- 导出用 `kind` / 路径ID（`bar/f1/b1`）
- 副本与主栏共用 API 数据，各自有独立的：说明(`descriptionMd`)、折叠状态、滚动位置

#### 改造方案

导出 JSON 对齐 Chrome API 格式（API 的节点字段本身是 `title` / `url` / `children`，没有 `type`/`kind`）：

```javascript
// 改造后的永久栏目导出 JSON
{
  format: "bookmark-canvas-section",
  schemaVersion: 2,
  sectionType: "permanent",
  slot: "A",
  title: "书签树 (永久栏目)",
  descriptionMd: "",
  tree: {
    // 保留现有的树结构，但用 chrome.bookmarks API 的原始 ID
    id: "0",              // ← Chrome API 的 root ID
    title: "Bookmarks Root",
    children: [{
      id: "1",            // ← Chrome API 的 bookmark bar ID 
      title: "Bookmarks Bar",
      children: [...]
    }]
  },
  rootMeta: { ... }
}
```

> [!NOTE]
> 永久栏目的"内容"始终来自 API，不需要本地存一份。但副本的「视图壳」信息（说明、折叠、滚动）需要独立存储。

#### 副本的分片存储

```
chrome.storage["bcs:perm:main"] = {
  descriptionMd: "...",
  _signature: "...",
  _lastSyncedSignature: "...",
  _filePath: "书签画布/永久栏目/A书签树（永久栏目）.json",
  _dirty: false
}

chrome.storage["bcs:perm:copy-xxx"] = {
  copyId: "xxx",
  descriptionMd: "副本的说明...",
  _signature: "...",
  _lastSyncedSignature: "...",
  _filePath: "书签画布/永久栏目/B书签树（永久栏目副本xxx）.json",
  _dirty: false
}
```

### 3.3 空白卡片

#### 现状

运行时存三份冗余数据：`markdownSource` + [text](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/sync/obsidian-git-sync.js#6355-6358) + [html](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/sidebar.html)
导出时只存纯 [.md](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/docs/README.md) 文件

两种类型：
- **file 类型**（插件空白卡片）→ 导出为独立 [.md](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/docs/README.md) 文件
- **text 类型**（原生文本节点）→ 内容直接嵌在 [.canvas](file:///Users/kk/Downloads/chrome%20download/test/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83.canvas) 文件的 [text](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/sync/obsidian-git-sync.js#6355-6358) 字段里

#### 改造方案

内部存储对齐导出格式：

```
chrome.storage["bcs:md:md-node-4"] = {
  // 只存 markdownSource，去掉 text 和 html
  id: "md-node-4",
  markdownSource: "## 这是内容\n...",
  fontSize: 20,
  source: "obsidian-canvas-file",  // file 类型
  // colorHex 归入画布文件
  
  // 守门员
  _signature: "...",
  _lastSyncedSignature: "...",
  _filePath: "书签画布/空白栏目/插件空白卡片/heh.md",
  _dirty: false
}
```

**text 类型** 不独立存文件，内容直接在画布文件的 node 节点里：
```json
{"id":"native-text-1","type":"text","x":100,"y":200,"width":300,"height":200,"text":"内容直接在这里"}
```

### 3.4 画布文件（[.canvas](file:///Users/kk/Downloads/chrome%20download/test/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83.canvas)）

#### 改造方案

内部存储对齐导出格式：

```
chrome.storage["bcs:canvas"] = {
  nodes: [
    // 永久栏目
    { id: "permanent-section", type: "file", x: 0, y: -190, width: 600, height: 600,
      file: "书签画布/永久栏目/A书签树（永久栏目）.json", color: "4" },
    // 临时栏目
    { id: "temp-section-1", type: "file", x: 949, y: -60, width: 525, height: 459,
      file: "书签画布/临时栏目/常规链式/A-1 2026-03-22 20_19_13.json", color: "#2563eb" },
    // file 类型空白卡片
    { id: "md-node-4", type: "file", x: -83, y: 553, width: 300, height: 300,
      file: "书签画布/空白栏目/插件空白卡片/heh.md", color: "#888888" },
    // text 类型（原生文本）— 内容直接嵌入
    { id: "native-text-1", type: "text", x: 100, y: 200, width: 300, height: 200,
      text: "内容在这里", color: "#888888" }
  ],
  edges: [
    { id: "edge-demo-1", fromNode: "permanent-section", fromSide: "left",
      toNode: "md-node-demo-bookmark-guide", toSide: "right",
      fromEnd: "none", toEnd: "arrow", label: "Guide", color: "#44cf6e" }
  ],
  // 守门员
  _signature: "...",
  _lastSyncedSignature: "...",
  _filePath: "书签画布/书签画布.canvas",
  _dirty: false
}
```

**布局变化**（拖动、缩放卡片）只更新 `bcs:canvas`，不影响内容分片。

### 3.5 全局元数据

```
chrome.storage["bcs:meta"] = {
  schemaVersion: 5,  // 升级
  tempSectionCounter: 1,
  tempItemCounter: 7,
  mdNodeCounter: 4,
  edgeCounter: 3,
  colorCursor: 0,
  tempSectionLastColor: "#2563eb",
  tempSectionPrevColor: null
}
```

---

## 四、守门员变脏机制

### 4.1 写入守门员（每次 [saveTempNodes](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#37639-37789) 时）

```
用户操作 → CanvasState 变化 → saveTempNodes() 触发

对每张变化的卡片：
  1. 序列化为导出格式的 JSON 字符串
  2. 算 hash（签名）
  3. 与该卡片存储中的 _signature 比较
  4. 不同 → 更新 _signature + 设 _dirty=true
  5. 写入该卡片的独立存储键
  6. 同时更新 bcs:canvas（如果布局变了）

对没变化的卡片：
  → 不写入，不脏
```

### 4.2 同步推送

```
推送时：
  1. 遍历所有 bcs:section:*、bcs:md:*、bcs:canvas、bcs:perm:*
  2. 只收集 _dirty=true 的
  3. 对每个脏卡片：直接读存储中的 JSON → 就是要推的文件内容
  4. 推送成功后：_lastSyncedSignature = _signature, _dirty = false
```

### 4.3 同步拉取

```
拉取时：
  1. 远端文件按路径对应到 bcs:section:*、bcs:md:* 等
  2. 直接覆写对应的存储键
  3. 同步签名：_signature = _lastSyncedSignature = hash(远端内容)
  4. _dirty = false
  5. 从存储 → 重新加载到 CanvasState → 刷新 UI
```

---

## 五、需要清理的旧东西

| 旧东西 | 处理 |
|--------|------|
| `bookmark-canvas-sync-protocol-bundle-v1`（458KB 整包） | 删除，用分片取代 |
| `bookmark-canvas-temp-sections`（整包存储键） | 一次性迁移后删除 |
| `permanent-section-position` | 归入 `bcs:canvas` 的 nodes |
| `permanent-section-copies` | 归入 `bcs:perm:copy-*` |
| [__buildTempSectionBookmarkTreeProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#36071-36086) | 废弃（不再需要 items→tree 转换） |
| [__buildRuntimeTempSectionFromProtocol()](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#36308-36368) | 简化（导入直接读 items） |
| 临时栏目中转层函数 | 削减或废弃 |

---

## 六、迁移策略

### 首次升级检测

```javascript
const meta = await chrome.storage.local.get("bcs:meta");
if (!meta || !meta["bcs:meta"]) {
  // 旧版本 → 执行迁移
  await migrateToShardedStorage();
}
```

### 迁移流程

```
1. 读取旧数据：
   - 从 sync bundle 或 saveTempNodes 的旧存储读取全部数据
   - 从 localStorage 读取永久栏目位置、副本等

2. 拆分写入新键：
   - 每张 section → bcs:section:{id}
   - 每张 mdNode → bcs:md:{id}
   - 布局 → bcs:canvas
   - 元数据 → bcs:meta
   - 永久栏目 → bcs:perm:main + bcs:perm:copy-*

3. 删除旧键

4. 设 bcs:meta.schemaVersion = 5
```

---

## 七、分阶段实施

### 阶段 1：分片存储基础设施
- 实现 `bcs:*` 键的读写封装
- 实现 [saveTempNodes](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#37639-37789) 的分片版本
- 实现 [loadTempNodes](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js#37790-37850) 的分片版本
- 实现迁移函数
- **验收**：卡片数据能正确分片存储和加载

### 阶段 2：画布文件 + 空白卡片格式对齐
- `bcs:canvas` 对齐 [.canvas](file:///Users/kk/Downloads/chrome%20download/test/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83/%E4%B9%A6%E7%AD%BE%E7%94%BB%E5%B8%83.canvas) 导出格式
- `bcs:md:*` 去掉冗余 [text](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/sync/obsidian-git-sync.js#6355-6358)/[html](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/sidebar.html)，只存 `markdownSource`
- **验收**：空白卡片和画布文件导出时零转换

### 阶段 3：临时栏目格式对齐
- 修改导出函数，JSON 直接输出 `items` 格式
- 修改导入函数，直接读 `items`
- 废弃 items↔tree 转换层
- **验收**：临时栏目导出的 JSON 和内部存储一致

### 阶段 4：永久栏目格式对齐 + 副本
- 永久栏目导出对齐 API 格式
- 副本独立存储
- **验收**：永久栏目及副本导出时零转换

### 阶段 5：守门员 + 变脏精确化
- 每张卡片加 `_signature` / `_lastSyncedSignature` / `_dirty`
- saveTempNodes 写入时算签名判脏
- 同步推送改为只推脏卡片
- 同步成功只清对应卡片的脏
- **验收**：改一张卡片只有那一张脏，推送只推那一张

### 阶段 6：清理旧代码
- 删除整包 sync bundle
- 删除旧存储键
- 削减中转层函数
- 视觉模式 / 视觉无图标模式适配

---

## 八、风险与注意事项

> [!WARNING]
> **永久栏目节点 schema 决策**：当前导出用 `kind` + 路径ID（`bar/f1/b1`），Chrome API 用 `title`/`url`/`children` + 数字ID。选择对齐哪个需要确认。建议：导出直接用 API 的数字 ID + 标准字段（不加 `kind`/`type`），保持最大兼容性。

> [!WARNING]
> **临时栏目 items 中的 `url: ""`**：文件夹的 `url` 是空字符串。导出保留这个特征还是去掉？建议保留，和内部完全一致。

> [!CAUTION]
> **schemaVersion 升级**：需要在导入时同时兼容 v1（旧格式用 `kind`/[tree](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/sync/obsidian-git-sync.js#4264-4292)）和 v2（新格式用 `type`/`items`），因为其他设备可能还在用旧版本。
