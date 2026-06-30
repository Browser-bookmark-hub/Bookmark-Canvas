# 临时栏目 BCS 分片审查与改造计划书

基准 commit：`e1ce8ad85fc6e4a0f57f0a671224b004f5ae6f79`  
审查时间：2026-07-01  
状态：计划书；阶段 1 部分已实施

## 0. 实施记录

2026-07-01：

1. 已将临时栏目标题编辑、右键重命名改为 `saveTempSectionsPatch(section)`。
2. 已将临时栏目说明正文提交、取消恢复、清空改为 section patch。
3. 已将临时栏目说明字号 `descFontSize` 纳入 section 协议兼容字段，并改为 section patch 保存。
4. 已将临时树批量重命名和批量 note 回写改为保存 affected sections。
5. 已移除 `wakeSectionById()` 的全量保存；`dormant` 仍按运行态处理，不作为 BCS 真相源。

## 1. 结论

临时栏目已经具备分片基础：每个栏目有稳定 `sectionId`，BCS 中也有 `bcs:section:<id>`。问题不在于完全没有分片，而在于许多运行时保存入口仍然通过 `saveTempNodes()` 走整份临时画布保存，导致一个栏目内容变化时重建所有 `bcs:section:*`。

`e1ce8ad` 已经修正了最重的高频路径：临时栏目内部书签/文件夹的新增、删除、移动、重命名、tag、note、URL/标题更新，改为 `saveTempSectionsPatch()`，只写受影响的 `bcs:section:<id>` 并发送 `section-patch` signal。

剩余问题集中在三类：

1. 临时栏目卡片自身属性仍有入口全量保存：标题、说明、说明字号、颜色、锁色、置顶等。
2. 临时栏目创建/删除仍全量保存：这涉及 `bcs:canvas` 节点列表、section key 清理和跨页面新增/删除同步，不能直接套用现有 section patch。
3. 临时栏目布局类操作仍全量保存：拖动、缩放、自动尺寸等需要更新 `bcs:canvas`，本计划先不处理 `bcs:canvas` 全量问题。

## 2. 当前 BCS 模型

主要 key：

| Key | 职责 | 当前状态 |
| --- | --- | --- |
| `bcs:meta` | 计数器、颜色游标、时间戳 | 全量与 section patch 都会更新 |
| `bcs:canvas` | Obsidian Canvas manifest：节点布局、连线、file 引用 | 暂时接受全量 |
| `bcs:section:<id>` | 单个临时栏目内容协议 | 已具备分片基础 |
| `bcs:signal` | 跨页面/侧边栏同步通知 | 已支持 `kind: section-patch` |
| `bcs:perm:main` / `bcs:perm:copy-*` | 永久栏目内容/副本 | 本计划不处理 |

临时栏目协议由 `__buildTempSectionJsonProtocol(section)` 生成，核心字段包括：

```text
format
schemaVersion
sectionType
id
label
title
tempKind
source
descriptionMd
items
originPermanent
sequenceNumber
```

注意：当前协议不包含 `x/y/width/height`、`color/colorLocked`、`pinned` 等 shell/layout/UI 字段。其中 `x/y/width/height/color` 属于 `bcs:canvas` 的 JsonCanvas 字段，`colorLocked/pinned` 属于独立轻量 UI 状态。因此现有 `saveTempSectionsPatch()` 适合栏目内容与部分 meta 字段，不适合直接同步布局和 UI 壳状态。

## 3. 已完成的 section 级路径

`e1ce8ad` 已完成：

| 操作 | 保存粒度 | 说明 |
| --- | --- | --- |
| `insertTempItems()` | section patch | 新增书签/文件夹 |
| `removeTempItemsById()` | section patch | 删除栏目内部 item |
| `moveTempItemsWithinSection()` | section patch | 同栏目移动 |
| `moveTempItemsAcrossSections()` | section patch | 源/目标两个 section |
| `renameTempItem()` | section patch | 修改 item 标题 |
| `setTempItemTags()` / `toggleTempItemTag()` | section patch | 修改临时 item tag |
| `setTempItemNote()` | section patch | 修改临时 item note，同时保留搜索索引 dirty |
| `updateTempBookmark()` | section patch | 修改临时书签标题/URL |

对应存储层：

```text
saveTempSectionsPatch()
-> CanvasProtocolBridge.saveTempSectionsToBcsStorage()
-> __saveTempSectionsToBcsStorage()
-> 写入 bcs:section:<id> + bcs:meta + bcs:signal(kind=section-patch)
```

对应同步层：

```text
收到 bcs:signal(kind=section-patch)
-> loadTempSectionsFromBcs(sectionIds)
-> restoreTempSectionFromProtocol()
-> patchTempSectionShellInPlace()
-> refreshTempSectionTreeInPlace()
```

失败或目标端找不到 section 时，回退全量 BCS bundle reload。

## 4. 仍会重建所有 `bcs:section:*` 的入口

凡是直接或间接调用 `saveTempNodes()` 的路径，都会进入：

```text
saveTempNodes()
-> __saveCanvasTempStateToBcsStorage()
-> __buildBcsDocumentsFromState()
-> 遍历全部 state.sections
-> 重建全部 bcs:section:<id>
```

### 4.1 应优先 section 化的入口

这些操作语义上只影响一个或多个临时 section 的内容/meta，不应重建全部临时栏目：

| 操作 | 当前问题 | 建议 |
| --- | --- | --- |
| 临时栏目标题编辑 | `finishTempSectionTitleEdit()` / 右键重命名仍全量 | 改为 `saveTempSectionsPatch(section)` |
| 临时栏目说明编辑 | 提交、取消恢复、清空、说明字号仍全量 | 改为 section patch |
| 临时栏目批量 item 重命名 | 已有 affected section 集合，但最后仍 `saveTempNodes()` | 改为 patch 受影响 sections |
| 颜色仅作为 section 协议 meta 的场景 | 部分入口全量 | 先确认协议是否承载，再改 |
| `wakeSectionById()` | dormant 运行态变化触发全量 | 不持久化或 section patch |

### 4.2 需要扩展 patch schema 后再做

这些目前不是安全的简单替换，因为现有 section protocol 不保存完整 shell/layout 字段：

| 操作 | 风险 | 前置设计 |
| --- | --- | --- |
| 颜色 / 锁色 | `color` 属于 JsonCanvas，`colorLocked` 不属于 JsonCanvas | 颜色走 `bcs:canvas`，锁色走轻量 UI 状态 |
| 置顶 | `pinned` 不属于 JsonCanvas | 置顶走轻量 UI 状态 |
| 拖动 / 缩放 / 自动尺寸 | 需要更新 `bcs:canvas` node geometry | 本计划暂不处理 `bcs:canvas` 全量 |
| 框选批量拖动/颜色/pin | 涉及多 section、md node、edge、permanent copy | 需要多实体 patch 或保持全量 |

### 4.3 应保持全量的入口

这些是全局结构语义，继续全量更稳：

| 操作 | 原因 |
| --- | --- |
| 清空画布 | 影响 sections、mdNodes、edges、permanent copies |
| 导入/覆盖恢复 | 需要重建完整 BCS 真相源和清理旧 key |
| 备份恢复 / GitHub pull 覆盖 | 全量包语义 |
| 删除混合类型对象 | 可能同时影响 section、mdNode、edge、permanent copy |
| 连接线操作 | 当前 edges 在 `bcs:canvas` |
| Markdown/空白卡片操作 | 当前空白正文跟随 `.canvas text` 路线，不走 `bcs:md:*` |
| 永久栏目相关操作 | 本轮明确不做 |

## 5. DOM 粒度现状

当前 DOM 并不是“动一个临时栏目就刷新全部卡片”。

| 场景 | DOM 粒度 |
| --- | --- |
| 临时书签树普通 CRUD | `refreshTempSectionTreeInPlace(section)`，重建单个栏目树 |
| 懒加载更多 root/folder 子项 | item/子树级追加或清空 |
| 临时卡片 shell 更新 | `patchTempSectionShellInPlace(section)` 原地 patch |
| 全量同步 fallback / 初始化 / 清空 | 全画布级 |
| 连接线 | SVG edges 级重绘 |

主要性能问题在 BCS 保存/同步/索引通知放大，而不是当前页面 DOM 总是全量刷新。

## 6. 搜索索引影响

搜索索引已经以 `bcs:section:<id>` 作为临时栏目 owner key：

| 触发 | dirty key |
| --- | --- |
| 临时栏目卡片本身 | `bcs:section:<sectionId>` |
| 临时栏目内 bookmark item | `bcs:section:<sectionId>` |
| 临时 item tag/note | `bcs:section:<sectionId>` |

`chrome.storage.onChanged` 监听 `bcs:section:*`、`bcs:perm:*`、`cachedCurrentTree`。`bcs:canvas` 被有意排除，以避免拖动画布/连线造成后台索引风暴。

因此 section patch 化对搜索索引是正向影响：以前全量保存可能让多个 section key 进入 changed/dirty，现在普通 item 操作只 dirty 一个或两个 section。

风险：

1. 超过 50 个 changed keys 或超过当前卡片数 60% 时会升级为 full rebuild。
2. 多页面并发编辑同一个 section 仍是最后写入者胜出，没有 item 级 merge。
3. 空白卡片/连接线依赖 `bcs:canvas` signature 懒检测，不属于本轮临时 section 改造。

## 7. 导入、导出、备份、推送、拉取影响

这些流程本质是全量包语义，不应直接替换成 section patch。

| 流程 | 当前依赖 | 结论 |
| --- | --- | --- |
| 普通导出 | 导出前 flush runtime 到 BCS，再从 BCS 构建 sandbox | 保持全量 |
| 手动备份 | 保存完整 sandbox | 保持全量 |
| GitHub push | 构建完整 canvas package | 保持全量 |
| GitHub pull | 下载完整包后覆盖导入 | 保持全量 |
| 覆盖导入 | 写 `bcs:meta + bcs:canvas + bcs:section:*` 并清理旧 key | 保持全量 |

这类流程不在用户高频基础交互路径上，优先级低于临时栏目卡片内部保存粒度。

## 8. 改造计划

### 阶段 0：守护与观测

目标：避免未来新增代码又把 section 级操作接回全量保存。

任务：

1. 给 BCS 写入增加开发期统计：单次保存写入了多少个 `bcs:section:*`。
2. 如果调用方标记为 section patch，但实际写入多个非目标 section，输出 warning。
3. 建立手动性能验收脚本或 console 片段，记录操作后 `bcs:section:*` changed keys 数量。

验收：

1. 修改一个临时栏目内书签，只写 1 个 `bcs:section:*`。
2. 跨栏目移动，只写 2 个 `bcs:section:*`。
3. 不出现 `__buildBcsDocumentsFromState()` 热点。

### 阶段 1：补齐“已有 section 协议承载”的高频入口

目标：凡是已经能被 `__buildTempSectionJsonProtocol()` 表达的字段，都不再调用 `saveTempNodes()`。

任务：

1. 临时栏目标题编辑改为 `saveTempSectionsPatch(section)`。
2. 临时栏目说明 `descriptionMd`、说明清空、说明字号改为 section patch。
3. 临时树批量重命名改为按 affected section 集合 patch。
4. `wakeSectionById()` 改为不落盘，或只 patch section。
5. 梳理 `skipSave` + 最后全量保存的批处理入口，替换为 patch affected sections。

不做：

1. 不改 `bcs:canvas`。
2. 不改永久栏目。
3. 不改空白卡片/连接线。

验收：

1. 标题/说明/tag/note/item 操作后，只 dirty 对应 `bcs:section:<id>`。
2. 双开页面时，另一页面只刷新对应临时栏目。
3. 搜索索引 dirty key 是对应 section。

### 阶段 2：设计 section shell 字段归属

目标：决定哪些临时卡片壳字段属于 section JSON，哪些属于 `bcs:canvas`。

候选字段：

```text
title
label
tempKind
source
descriptionMd
originPermanent
sequenceNumber
color
colorLocked
pinned
dormant
descFontSize
descDisplayMode
descDisplayRows
descEditMode
descEditRows
suppressPlaceholder
```

建议：

1. 内容/语义字段归 `bcs:section:<id>`：标题、说明、source、origin、sequence、描述设置。
2. 布局字段归 `bcs:canvas`：x/y/width/height。
3. 视觉字段按协议拆开：`color` 是 JsonCanvas 字段，走 `bcs:canvas`；`colorLocked/pinned/fontSize` 是 UI 状态，走轻量 UI 状态。
4. `dormant` 更像运行态，不建议作为同步真相源。

产出：

1. section protocol schema v3 草案，或 schema v2 的兼容扩展说明。
2. restore 规则：新字段存在时覆盖，缺失时保持旧值。
3. 旧数据兼容策略。

### 阶段 3：新增/删除 section patch

目标：让创建/删除临时栏目不再为了 section 内容重建全部 `bcs:section:*`，但仍允许 `bcs:canvas` 保持全量。

任务：

1. 新增 `section-create` signal：写新增 `bcs:section:<id>`、meta、signal。
2. 接收端目标 section 不存在时，不再立即 fallback 全量，而是允许创建运行时 section 壳。
3. 新增 `section-delete` signal：删除目标 `bcs:section:<id>`、更新 meta、signal。
4. 接收端删除对应 DOM 与 CanvasState section，并清理关联搜索 dirty。
5. 仍由全量 `bcs:canvas` 保存处理 layout manifest；本阶段只减少 section 内容重建。

风险：

1. 创建/删除同时影响 edges 时仍需全量或额外 edge 处理。
2. 旧版本对新 signal 可能只能全量 reload 或忽略，需要兼容测试。

### 阶段 4：批量操作统一 affected sections

目标：批量操作不要多次全量保存，也不要每个 item 单独触发多次 patch。

任务：

1. 建立 `collectAffectedTempSections()` 工具。
2. 批量 rename/tag/note/move/delete 最后一次性 `saveTempSectionsPatch(affectedSections)`。
3. 对框选组中只包含临时 section 内容变更的路径做 section patch；混合 md/edge/permanent 的路径保持全量。

验收：

1. 100 个 item 批量改名，如果都在一个 section，只写 1 个 section key。
2. 分散在 N 个 section，只写 N 个 section key。
3. 不触发多次 `bcs:signal` 抖动。

## 9. 非目标

### 已补充：`bcs:canvas` 清单独立保存

本轮已把画布清单类操作从旧 `saveTempNodes()` 中拆出：

1. 新增 `saveCanvasManifestOnly()`，只写 `bcs:meta`、`bcs:canvas`、`bcs:signal(kind=canvas-patch)`。
2. 不重建、不写入、不删除 `bcs:section:*`。
3. 适用范围包括卡片拖动/缩放、永久栏目布局、空白/Markdown 卡片内容与颜色、卡片组、连接线、临时栏目颜色等画布 manifest 操作。
4. 新增/删除临时栏目、清空画布、导入/恢复、批量删除含临时栏目等仍保留原全量路径，因为这些路径需要维护 `bcs:section:*` 的创建与清理。
5. 接收端新增 `canvas-patch` 处理：只读取 `bcs:canvas` 与 `bcs:meta`，再合成运行时状态同步布局、mdNodes、edges，不读取所有 section 文件。
6. `bcs:canvas` 输出已收紧为 JsonCanvas 字段：file/text/group node 只保留 `id/type/file|text|label/x/y/width/height/color`，edge 只保留 `id/fromNode/fromSide/toNode/toSide/fromEnd/toEnd/color/label`。
7. 置顶、临时栏目锁色、空白卡片字号都不属于标准 JsonCanvas 字段，改走独立轻量 UI 状态 `canvas-node-ui-state-v1`，不写 `bcs:canvas`；旧 `canvas-node-pin-state-v1` 仅作为读取兼容。

本计划不处理：

1. `bcs:canvas` 全量 manifest 问题。
2. 空白/Markdown 卡片重新拆成 `bcs:md:*`。
3. 连接线 edge patch。
4. 永久栏目 BCS 增量。
5. item 级 BCS patch 或 CRDT merge。

## 10. 回归清单

基础操作：

1. 临时栏目内新增书签、文件夹。
2. 删除临时栏目内书签、文件夹。
3. 同栏目移动 item。
4. 跨栏目移动 item。
5. 修改书签标题、URL。
6. 修改 tag、note。
7. 修改临时栏目标题、说明、说明字号。

同步：

1. history 页面和 sidepanel 双开，操作一端，另一端局部刷新。
2. section patch 失败时能全量恢复。
3. 新旧版本混跑时不丢数据。

索引：

1. item 操作 dirty 对应 `bcs:section:<id>`。
2. 批量操作 dirty affected section 集合。
3. 搜索结果包含最新 tag/note/title/url。

导入导出：

1. patch 后立即导出，section JSON 包含最新内容。
2. patch 后立即备份，备份可恢复最新内容。
3. patch 后 GitHub push/pull 不丢改动。

性能：

1. CPU 4x 下，临时 item 基础操作后不出现长时间 `__buildBcsDocumentsFromState()`。
2. `__buildTempSectionJsonProtocol()` 只对 affected sections 执行。
3. `chrome.storage.set` payload 不包含无关 `bcs:section:*`。

## 11. 推荐下一步

先做阶段 1。理由：

1. 不需要改 `bcs:canvas`。
2. 不需要改导入/导出/备份/同步全量包语义。
3. 能继续压低用户高频操作后的 BCS 重建成本。
4. 风险集中，回滚简单。

阶段 1 完成后，再评估是否值得做阶段 3 的 section create/delete patch。布局类和 `bcs:canvas` 继续保持现状，除非后续 trace 明确证明它成为新的主要瓶颈。
