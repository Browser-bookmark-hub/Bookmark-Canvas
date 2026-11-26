# Note 与 Tag 元数据系统复审与收敛建议

日期：2026-07-01

## 结论

本次使用 `codegraph` 重新聚焦 Note/Tag 元数据链路，重点复核异常颜色、导出协议差异、模块命名、永久元数据写入刷新重复、Note UI 性能和首次搜索缓存。

当前 Note/Tag 的核心数据链路是通的：永久栏目走 `bcs:perm:main.identityMap[*]`，临时栏目走 `item.tags` / `item.note` / `item.noteColor` 内联字段；导入、覆盖、增量、备份、GitHub push/pull 都复用现有包导出和导入管线。主要问题不在“缺链路”，而在输入防御、运行时刷新入口重复，以及 Note 仍嵌在 TagSystem 内导致边界不清。

建议优先级：

1. 收敛永久 metadata 写入后的刷新/dirty/缓存更新入口。
2. 给 Tag color 增加与 Note color 同等级的归一策略。
3. 增加 `MetadataSystem` 门面，保留 `TagSystem` / `NoteSystem` 兼容别名。
4. 优化 Note marker 不再把完整 note 文本复制进 DOM dataset。
5. 暂不处理首次 note 搜索异步补刷问题，继续观察。

## 1. 异常 Tag 颜色策略

之前的问题不是说“第三方必须严格遵守七种颜色，否则导入失败”。更准确地说：外部数据如果带了不在 7 色体系内的 `tag.color`，当前代码会把这个字符串继续传到 UI class 模板里，例如 `tag-dot-${color}`。这既会造成显示不可预测，也扩大了 DOM class 拼接风险。

建议策略：

- 用户在本应用内新建或编辑 Tag：只允许 7 色，UI 层不提供其他值。
- 导入、同步、备份恢复、第三方 JSON：不因异常颜色让整包导入失败。
- 归一规则使用确定性白名单：
  - `red/orange/yellow/green/blue/purple/gray` 原样通过。
  - 大小写统一转小写。
  - `grey` 归一为 `gray`。
  - 常见别名可选做小表映射，例如 `violet` -> `purple`。
  - 未知颜色默认归到 `gray`。
- 不建议自动按“相近颜色”算法映射任意 CSS/hex，因为相近算法会引入不可解释结果，且 Tag 颜色在这里是分类语义，不是美术颜色。
- 不建议导入失败，除非 tag 对象本身结构坏到无法恢复，例如不是对象、没有可用 color/text，或包 JSON 无法解析。

Note 已经有 `noteColor` 白名单归一，并且默认 `orange`。Tag 应补同等级能力，默认建议用 `gray`，因为 gray 更像“未知/中性标签”，不会误导成某个强语义颜色。

相关代码：

- `storageBCS_core.js` 的 `__normalizeTagInput()` 目前只 trim color，不做白名单。
- `storageBCS_core.js` 的 `__normalizeNoteColorInput()` 已经有完整白名单，可作为 Tag color 归一的参照。
- `tag_system.js`、`bookmark_tree_context_menu.js`、`search.js` 多处使用 `tag-dot-${color}` 渲染，应保证进入 UI 的 color 已经被归一。

## 2. 导出协议差异

当前实现会裁掉没有扩展字段的 identityMap 条目，只保留有 `tags` / `note` / 其他 extras 的 `{ syncId, ...extras }`。这和旧文档里“即便没有扩展 tags，也必须保留 `{ syncId }`”不一致。

这次不建议作为修复项处理。原因：

- 当前导出树节点本身已经使用 syncId 作为 `tree.id` / `parentId`。
- 覆盖和增量导入会从导入树收集 expected syncIds，再把有 extras 的 identityMap 合回去。
- 这个行为看起来是之前已经刻意改过的协议收敛，不应因为旧文档描述直接回滚。

建议只做文档更新：把“必须保留无 extras 的 `{ syncId }`”改为“导出树为 syncId 真相源，identityMap 仅承载 extras”。这能避免后续审查再次误判。

## 3. TagSystem 是否改名为 MetadataSystem

Note 现在确实嵌在 `tag_system/tag_system.js` 中，运行时同时暴露：

- `window.TagSystem`
- `window.NoteSystem`
- `window.__refreshAllTagDots`
- `window.__refreshAllNoteMarkers`

直接把文件和对象从 TagSystem 改名成 MetadataSystem 会影响面比较大，因为搜索、右键菜单、拖拽、导入覆盖后刷新都在读这些全局对象。

建议两阶段收敛：

第一阶段，增加门面，不破坏旧 API：

```js
window.MetadataSystem = {
  tags: window.TagSystem,
  notes: window.NoteSystem,
  flushPermanentMetadataUpdates,
  refreshTargets,
  normalizeTagColor,
  normalizeNoteColor
};
```

同时继续保留 `window.TagSystem` / `window.NoteSystem`，让现有代码不需要一次性大改。

第二阶段，等调用点都迁到 `MetadataSystem` 后，再考虑：

- 文件目录从 `tag_system/` 改为 `metadata_system/`。
- CSS 从 `tag_system.css` 拆为或改名为 `metadata_system.css`。
- Tag/Note UI 具体实现仍可分成 `tags`、`notes` 两个子域。

这样能避免一次重命名把加载顺序、全局 API、CSS 路径和搜索懒加载一起打乱。

## 4. 永久 metadata 写入刷新链路重复

这是本次最值得优先处理的问题。

`codegraph` 定位到至少三条相似链路：

- `bookmark_tree_context_menu.js` 的 `__ctxFlushPermanentMetadataUpdates(tagUpdates, noteUpdates, reason)`，由粘贴书签等上下文入口调用。
- `bookmark_tree_drag_drop.js` 的 `flushPermanentMetadataUpdates(tagUpdates, noteUpdates, reason)`，由拖拽移动、外部 drop 等入口调用。
- `bookmark_canvas_module.js` 中同构的永久 tag/note 批量写入和刷新逻辑，虽然不是同名函数，但代码结构基本相同。

这些链路都在做同一组事情：

1. 调 `bridge.writePermanentNodeTagsBulk()`。
2. 调 `bridge.writePermanentNodeNotesBulk()` 或逐条 `writePermanentNodeNoteMeta()` fallback。
3. 强制重载 `TagSystem` / `NoteSystem` 缓存。
4. 刷新 tag dots / note markers。
5. 更新搜索内存索引。
6. 标记 IndexedDB search dirty。
7. 部分入口还会重新执行当前搜索。

问题不是“重复代码不好看”，而是行为已经有细微分叉：

- 有的入口刷新全部 dots/markers，有的入口按 targets 刷。
- note 路径通常会 `updateCanvasSearchBookmarkNotes()`，tag 路径有些只 `markCanvasSearchBookmarkTagDirty()`，不一定同步更新已加载内存索引。
- 批量 note 编辑会在最后重跑当前搜索，但拖拽和粘贴继承 metadata 的路径不一定做同样的搜索补刷。
- 不同文件里的 fallback、错误日志、空结果处理不同。以后修一处缓存或 dirty 逻辑，很容易漏掉另外两个入口。

建议新增一个统一运行时 helper，命名可以放在 `MetadataSystem` 里：

```js
await window.MetadataSystem.flushPermanentMetadataUpdates({
  tags: tagUpdates,
  notes: noteUpdates,
  reason,
  source: 'drag-drop' | 'context-menu' | 'canvas-module',
  refreshSearch: true
});
```

它应该负责：

- 一次性规范化输入：
  - tag update: `{ chromeId, tags }`
  - note update: `{ chromeId, note, noteColor }`
- 写入永久存储：
  - tags 走 `writePermanentNodeTagsBulk()`。
  - notes 优先走 `writePermanentNodeNotesBulk()`，缺失时 fallback 到逐条 `writePermanentNodeNoteMeta()`。
- 返回实际成功 targets：
  - `tagTargets`
  - `noteTargets`
- 统一刷新：
  - `TagSystem.ensurePermTagsLoaded(true)`
  - `NoteSystem.ensurePermNotesLoaded(true)`
  - `__refreshTagDotsForTargets(tagTargets)`，没有 targets API 时 fallback 到 `__refreshAllTagDots()`
  - `__refreshNoteMarkersForTargets(noteTargets)`，没有 targets API 时 fallback 到 `__refreshAllNoteMarkers()`
- 统一搜索同步：
  - `updateCanvasSearchBookmarkTags(tagTargets)`
  - `updateCanvasSearchBookmarkNotes(noteTargets)`
  - `markCanvasSearchBookmarkTagDirty(tagTargets)`
  - `markCanvasSearchBookmarkNoteDirty(noteTargets)`
  - 当前搜索面板可见且 query 非空时，按参数决定是否 `searchCanvasAndRender(q)`。

迁移顺序建议：

1. 先实现 `MetadataSystem.flushPermanentMetadataUpdates()`，内部可先复用现有全局函数。
2. 把 `bookmark_tree_drag_drop.js` 的 `flushPermanentMetadataUpdates()` 改成薄 wrapper。
3. 把 `bookmark_tree_context_menu.js` 的 `__ctxFlushPermanentMetadataUpdates()` 改成薄 wrapper。
4. 把 `bookmark_canvas_module.js` 的同构逻辑改成调用统一 helper。
5. 最后处理单条 note 信息面板和批量 note 编辑，让它们复用同一套 “post metadata changed” 刷新逻辑。

验收重点：

- 粘贴/拖拽带 tag/note 的永久书签后，不刷新页面也能看到 tag dot 和 note marker。
- 当前搜索面板打开时，`#tag` 和 `*note` 结果能立即反映变更。
- 批量 note 清空后，marker 消失，`*` note 浏览面板计数同步减少。
- 多窗口/侧边栏 BroadcastChannel 仍能同步刷新。

## 5. Note marker UI 性能优化

这是 UI 显示优化，不是数据正确性问题。

已处理：Note marker 不再把完整 note 文本放进 DOM dataset。

当前实现：

- marker 只保留 `dataset.color` 和短 `dataset.noteKey`。
- `noteKey` 从 `${noteColor}:${note}` 改为 `${noteColor}:${length}:${hash}`。
- hover 时通过 marker 所在的 `.tree-item` 重新读取 `NoteSystem` / 临时 note helper 中的 note 元数据。

这样不会改变存储、导入导出、搜索，只减少长 note 在树节点 DOM 上的重复复制。

## 6. 首次 Note 搜索缓存

当前 `search.js` 加载早于 `tag_system.js`，所以 note 搜索不能在初始化期假设 `NoteSystem` 已存在。实现上采用懒加载：首次 `*` 搜索如果永久 note 缓存没准备好，会触发 `ensurePermNotesLoaded()`，加载后再重搜。

这类问题目前没有实际遇到，暂不建议投入改造。后续如果出现“第一次搜索空一下再出现结果”的反馈，再考虑在进入 bookmark 搜索模式时预热 Tag/Note 缓存。

## 建议下一步

优先做第四项统一 helper，因为它会顺手降低后续修 Tag color、Note marker、搜索同步时的漏改概率。Tag color 归一可以作为独立小修，风险低，适合和 helper 收敛分开提交。
