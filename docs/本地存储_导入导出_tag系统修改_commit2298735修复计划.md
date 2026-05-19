# 本地存储_导入导出_tag系统修改 commit 2298735 修复计划

## 0. 背景

本计划用于修复 commit `229873574f045d1e3fe566205da3f5fc0dae4d7f` 与原计划书《本地存储_导入导出_tag系统修改.md》的执行偏差。

本轮修复只处理「一、改插件的本地存储」与「二、本地导出、导入」相关问题；「3、加颜色 / 标识 / tag 系统」继续延后。

## 1. 修复目标

1. 永久栏目导出包必须使用跨设备稳定 `syncId`，不能导出 Chrome 本地 `id`。
2. 导入阶段永久栏目的 `syncId` 只能来自导入包快照树，禁止重新生成。
3. 覆盖导入与增量导入都必须维护 `identityMap`、Chrome 书签树、BCS 快照之间的一致性。
4. 临时栏目 `sectionId` 规则回到原计划确认口径：保留 `temp-section-` 前缀，并使用左上角标号链。
5. 备份/恢复流程必须能作为覆盖导入失败后的回滚来源。
6. 移除不属于功能实现的本地工具配置文件改动。

## 2. 当前主要偏差

### 2.1 永久栏目导出树丢失 syncId

当前实现先在沙盒中把 Chrome `id/parentId` 替换为 `syncId`，但最终构造永久栏目导出 payload 时又调用 `__stripPermanentLocalIdsFromTree()`，把 `id/parentId` 全部删掉。

修复要求：

- 导出永久栏目树必须保留字段名 `id`、`parentId`。
- 字段值必须是 `identityMap` 中对应的 `syncId`。
- 只删除 Chrome 本地排序字段 `index`。
- `folderType`、`syncing` 等根节点识别字段继续保留。

### 2.2 导出 identityMap 处理口径不完整

当前实现会把只有 `{ id, syncId }` 的映射项直接丢弃，通常导致导出包里的 `identityMap` 为空。

修复要求：

- 本地 `identityMap` 保持 `{ id: chromeId, syncId, ...extras }`。
- 导出沙盒中的云端/导出 `identityMap` 去掉 `id`，保留 `{ syncId, ...extras }`。
- 即使当前没有 tags 等扩展字段，也应保留 `{ syncId }`，避免导出包缺少映射表块。
- 导入时扩展字段按 `syncId` 覆盖/补入本地映射表。

### 2.3 覆盖导入遗漏根节点/顶层根 syncId

当前覆盖导入只为新创建的普通子节点记录 `syncId -> chromeId`，没有处理 Chrome 根节点 `0` 与顶层根节点 `1/2/3` 对应的导入包 syncId。

修复要求：

- 导入包快照树的根节点 id 作为根 syncId 来源。
- 顶层根节点按 `folderType` 映射到本地 Chrome 根：`bookmarks-bar -> 1`、`other -> 2`、`mobile -> 3`。
- 重建 `identityMap` 时必须包含导入包快照树中的所有节点 syncId，包括根节点与顶层根。
- 写入 BCS 前不得让 `__verifyAndHealIdentityMap()` 为导入包已有节点重新生成 syncId。

### 2.4 增量导入未实现更新/移动/排序

当前增量分支只删除本地多余节点、创建导入新增节点，没有处理同一 syncId 节点的标题、URL、父级、顺序差异。

修复要求：

- 本地已有 syncId：
  - `title/url` 不一致时调用 `chrome.bookmarks.update`。
  - `parentId/index` 不一致时调用 `chrome.bookmarks.move`。
  - `identityMap` 不新增、不删除，`syncId` 不变，`id` 保持当前本地 Chrome id。
- 导入包新增 syncId：
  - 调用 `chrome.bookmarks.create`。
  - 成功后新增 mapping：`{ id: newChromeId, syncId: importNode.id, ...extras }`。
- 本地多余 syncId：
  - 调用 `chrome.bookmarks.remove` 或 `removeTree`。
  - 删除该 syncId 及子树对应的 mapping。
- 一轮增量操作整体包在 bulk mute 中。
- 增量结束后统一拉取 Chrome 树刷新 BCS，并校验 `identityMap`。

### 2.5 临时栏目 sectionId 规则与计划不一致

当前 commit 把临时栏目自身 id 改为 `tempSecId_YYYYMMDD_hash_xxx`，但原计划确认的是 `temp-section-<标号链>`，例如 `temp-section-A-1-1`。

修复要求：

- 临时栏目 `section.id` / `sectionId` 使用 `temp-section-<左上角标号链>`。
- 临时栏目 item id 使用 `tempId_YYYYMMDD_hash_xxx`。
- item 内的 `sectionId` 同步写入新的 `temp-section-<标号链>`。
- DOM 壳体 `id`、`data-section-id`、拖拽路由、目录定位、批量面板、右键菜单、折叠/滚动 key、edge 引用、导入包 `containedTempIds` 全部使用新 `sectionId`。
- 若栏目左上角标号发生变化，必须有统一的 sectionId 重写入口，同时同步更新：
  - `CanvasState.tempSections[*].id`
  - item `sectionId`
  - DOM `id/data-section-id`
  - `edges.fromNode/toNode`
  - import-container `containedTempIds`
  - fold/scroll storage key

### 2.6 覆盖导入失败没有自动回滚

当前覆盖导入失败时只弹出错误，没有使用备份槽恢复。

修复要求：

- 覆盖导入前必须生成「导出流程处理后的本地备份快照」。
- 覆盖导入失败时提示用户，并自动或明确按钮触发用备份槽恢复。
- 恢复流程也必须走 bulk mute，避免 Chrome events 逐条反写。
- 恢复成功/失败均需要 toast 或 alert 明确提示。

### 2.7 本地工具配置不应进入功能 commit

`.claude/settings.local.json` 属于本地工具权限配置，不是本计划功能代码。

修复要求：

- 后续修复 commit 不应包含该文件。
- 若需要清理 commit，应从功能变更中移除 `.claude/settings.local.json`。

## 3. 推荐修复顺序

### 阶段 1：修复导出协议

涉及文件：

- `history_html/storageBCS/storageBCS_core.js`
- `history_html/transfer_AI_sync/import-export-transfer-feature.js`

步骤：

1. 新增永久栏目导出树构造函数，例如 `__buildPermanentSyncTreeFromSandboxTree(tree, identityMap)`。
2. 该函数只删除 `index`，保留 `id/parentId`，并把值替换为 syncId。
3. 修改 `__buildPermanentMainSyncPayload()`，避免再次调用会删除 id 的旧函数。
4. 修改 `__pruneIdentityMapEntriesInSandbox()`，导出时保留 `{ syncId }`。
5. 验证导出 JSON 中：
   - `descriptionMd` 后有 `identityMap`。
   - `tree` 内每个节点有 `id`。
   - 非根节点有正确 `parentId`。
   - 不包含 `index`。

### 阶段 2：修复覆盖导入

涉及文件：

- `history_html/transfer_AI_sync/import-export-transfer-feature.js`
- `history_html/storageBCS/storageBCS_core.js`

步骤：

1. 解析导入包快照树，建立 `syncId -> importNode`、`syncId -> parentSyncId`、`syncId -> targetIndex`。
2. 覆盖分支清空目标 Chrome 根后，按导入树重建。
3. 顶层根根据 `folderType` 映射到 Chrome 固定根，并记录映射。
4. 每次 `chrome.bookmarks.create` 成功后记录 `syncId -> chromeId`。
5. 用完整 `syncId -> chromeId` 重建本地 `identityMap`。
6. 拉取 Chrome 树写入 BCS。
7. 写入前校验：导入包内的 syncId 不得被重新生成。

### 阶段 3：补齐增量导入

涉及文件：

- `history_html/transfer_AI_sync/import-export-transfer-feature.js`

步骤：

1. 用本地 `identityMap` 建立 `syncId -> chromeId`。
2. 用本地 Chrome 树建立 `chromeId -> localNode`。
3. 对导入树做三类 diff：
   - 新增：导入有、本地无。
   - 删除：本地有、导入无。
   - 更新：两边都有，但 `title/url/parent/index` 不同。
4. 操作顺序建议：
   - 删除本地多余节点。
   - 创建导入新增节点，父节点必须先存在。
   - 更新标题/URL。
   - 移动父级和排序。
5. 操作全过程 bulk mute。
6. 操作完成后统一拉 Chrome 树、写 BCS、校验 `identityMap`。

### 阶段 4：修复临时栏目 ID 体系

涉及文件：

- `history_html/bookmark_canvas_module.js`
- `history_html/storageBCS/storageBCS_core.js`
- `history_html/canvas_sidebar_directory.js`
- `history_html/transfer_AI_sync/import-export-transfer-ui-support.js`

步骤：

1. 保留 item id 的 `tempId_*` 生成逻辑。
2. 撤销临时栏目自身的 `tempSecId_*` 规则。
3. 新增/复用左上角标号链生成函数，生成 `temp-section-<label-chain>`。
4. 创建普通链式临时栏目、特殊临时栏目、导入生成临时栏目时统一使用该规则。
5. 增加统一 sectionId 重写函数，负责同步 DOM、items、edges、containedTempIds、fold/scroll key。
6. 清理旧临时栏目存储时，不只清理 `scroll/collapsed`，还要确认 `bcs:temp-state-snapshot` 中不会继续保留旧 `temp-section-<数字>` 或 `tempSecId_*`。

### 阶段 5：修复备份/回滚

涉及文件：

- `history_html/transfer_AI_sync/import-export-transfer-feature.js`
- `history_html/transfer_AI_sync/import-export-transfer-ui-support.js`

步骤：

1. 覆盖导入前写备份槽，备份内容使用导出沙盒最终数据。
2. 覆盖导入失败时：
   - 停止当前 bulk mute。
   - 显示失败信息。
   - 使用备份槽恢复，或提供明确的「恢复备份」按钮。
3. 恢复备份时禁止覆盖备份槽本身，避免失败恢复把有效备份替换掉。
4. 恢复完成后拉取 Chrome 树刷新 BCS/DOM。

### 阶段 6：清理非功能文件

步骤：

1. 从后续功能修复 commit 中排除 `.claude/settings.local.json`。
2. 若需要重做 commit，把该文件从功能变更中移除。

## 4. 验证清单

### 4.1 静态检查

运行：

```bash
node --check history_html/storageBCS/storageBCS_core.js
node --check history_html/transfer_AI_sync/import-export-transfer-feature.js
node --check history_html/transfer_AI_sync/import-export-transfer-ui-support.js
node --check history_html/bookmark_canvas_module.js
node --check history_html/canvas_sidebar_directory.js
```

### 4.2 导出验证

1. 清空旧本地数据后打开插件，生成永久栏目 BCS。
2. 导出 Obsidian/JSON 包。
3. 检查永久栏目主 JSON：
   - `identityMap` 位于 `descriptionMd` 后、`tree` 前。
   - `identityMap` 项至少包含 `syncId`。
   - `tree.id` 与 `tree.parentId` 均为 `syncId_*`。
   - 没有 `index` 字段。
   - 不出现 Chrome 本地数字 id。

### 4.3 覆盖导入验证

1. 在设备 A 导出。
2. 在设备 B 使用覆盖导入。
3. 检查：
   - Chrome 书签树重建成功。
   - BCS `tree.id` 为设备 B 的 Chrome id。
   - BCS `identityMap.id` 为设备 B 的 Chrome id。
   - BCS `identityMap.syncId` 与导入包 `tree.id` 一致。
   - 根节点与顶层根节点也有稳定 mapping。

### 4.4 增量导入验证

准备同一导出包的修改版本，分别验证：

1. 新增书签。
2. 删除书签。
3. 修改标题。
4. 修改 URL。
5. 移动到其他文件夹。
6. 同父级内排序变化。
7. 删除文件夹及其子树。

每项验证后检查 Chrome 树、BCS 树、identityMap 三者一致。

### 4.5 临时栏目验证

1. 创建普通链式临时栏目，确认 sectionId 为 `temp-section-<标号链>`。
2. 创建特殊临时栏目，确认同样使用新规则。
3. 拖拽跨栏目移动 item，确认 item id 为 `tempId_*`，item.sectionId 正确更新。
4. 展开/折叠、滚动位置、目录定位、右键菜单、批量面板均正常。
5. 导入包组框 `containedTempIds` 能正确定位临时栏目。
6. edge 的 `fromNode/toNode` 在 sectionId 改造后仍能正确连接。

### 4.6 备份/回滚验证

1. 手动备份后覆盖导入，确认可恢复。
2. 导出前自动备份，确认备份槽被刷新。
3. 人为制造覆盖导入失败，确认可使用备份槽回滚。
4. 回滚后 Chrome 书签、BCS、DOM 重新一致。

## 5. 完成标准

1. 所有静态检查通过。
2. 导出包符合 syncId 协议。
3. 覆盖导入不重新生成导入包已有 syncId。
4. 增量导入支持新增、删除、标题/URL 更新、父级移动、排序。
5. 临时栏目 sectionId 与计划书一致。
6. 覆盖导入失败可以恢复到备份槽。
7. 功能 commit 不包含本地工具配置文件。
