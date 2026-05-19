# 本地存储_导入导出_tag系统修改：最终修复计划

## 0. 目标与范围

本计划用于最后一次修复《本地存储_导入导出_tag系统修改.md》在以下 commit 中的执行偏差：

- `229873574f045d1e3fe566205da3f5fc0dae4d7f`：首次实现「本地存储_导入导出_tag系统修改 1」。
- `82589cd64175488ae15884908772006f1b48903c`：第一次修复。

本次修复必须同时参考：

1. 最开始的计划书要求。
2. `2298735` 的实现偏差。
3. `82589cd` 的修复结果与遗留问题。
4. 当前代码现状。

本轮只修「一、改插件的本地存储」与「二、本地导出、导入」。  
「3、加颜色 / 标识 / tag 系统」继续延后；本轮只保留 tags/扩展字段的存储兼容，不实现 tag UI。

## 1. 最终完成标准

### 1.1 永久栏目本地存储

- `bcs:perm:main` 是永久栏目主数据唯一来源。
- `identityMap` 与永久栏目源书签树在同一个 JSON 中。
- 字段顺序保持：说明块 `descriptionMd` 后、源树 `tree` 前。
- 本地 `identityMap` 结构为：

```json
{
  "id": "chromeBookmarkId",
  "syncId": "syncId_YYYYMMDD_hash_xxxxxxx"
}
```

- 本地新增节点时生成新的 `syncId`。
- 本地删除节点时删除该节点及子树对应的 mapping。
- 本地移动/改名/改 URL 不改变 `syncId`。
- 任何整树回写 BCS 的路径都不得丢失或重置已有 `identityMap`。

### 1.2 永久栏目导出协议

- 导出必须先构建内存 sandbox。
- live storage 不允许被导出清洗逻辑直接修改。
- 导出树中的 `id`、`parentId` 字段名不变。
- 导出树中的 `id`、`parentId` 值必须替换为 `syncId`。
- 导出树必须去掉 `index`。
- 导出包中不能出现 Chrome 本地数字 id。
- 导出 `identityMap` 去掉本地 Chrome `id`，保留：

```json
{
  "syncId": "syncId_YYYYMMDD_hash_xxxxxxx"
}
```

- 即使没有 tags/扩展字段，也必须保留 `{ "syncId": "..." }`，不要丢空。

### 1.3 永久栏目覆盖/增量导入协议

- 导入阶段永久栏目 `syncId` 唯一来源是导入包快照树里的 `id`。
- 覆盖导入和增量导入都禁止给导入包已有节点重新生成 `syncId`。
- 导入包 root、顶层固定根、普通节点都必须进入最终本地 `identityMap`。
- 顶层固定根映射规则：
  - `folderType: "bookmarks-bar"` -> Chrome id `1`
  - `folderType: "other"` -> Chrome id `2`
  - `folderType: "mobile"` -> Chrome id `3`
- 覆盖导入：
  - 清空目标 Chrome 根内容。
  - 按导入包快照树重建。
  - 每次 create 成功后记录 `syncId -> chromeId`。
  - 统一写回 BCS 树和完整 `identityMap`。
- 增量导入：
  - 本地已有 syncId：更新标题/URL/父级/顺序，不改变 syncId。
  - 导入新增 syncId：创建 Chrome 节点，新增 mapping。
  - 本地多余 syncId：删除 Chrome 节点，删除 mapping。
  - 操作完成后统一拉 Chrome 树刷新 BCS。
- 全流程必须 bulk mute，避免 Chrome events 逐条反写 DOM/BCS/mapping。

### 1.4 临时栏目 ID 体系

- 临时栏目自身 `sectionId` 使用计划书确认规则：`temp-section-<左上角标号链>`。
- 例如：`temp-section-A-1-1`。
- 临时栏目 item id 使用 `tempId_YYYYMMDD_hash_xxxxxxx`。
- item 的 `sectionId` 跟随栏目 `section.id`。
- 普通链式临时栏目、特殊临时栏目都必须统一使用新规则。
- sectionId 改动必须同步：
  - DOM `id` / `data-section-id`
  - item.sectionId
  - edges.fromNode / edges.toNode
  - import-container.containedTempIds
  - fold/scroll storage key
  - 目录定位、右键菜单、批量面板、拖拽路由

### 1.5 备份/回滚

- 导出前自动写单槽备份。
- 手动备份按钮写同一个单槽。
- 覆盖导入前写备份槽。
- 覆盖导入失败必须能恢复到导入前备份。
- 恢复备份时不得覆盖当前备份槽本身。
- `threshold: 0` 必须表示强制覆盖。

## 2. 当前代码已修好的部分

以下内容当前基本可保留：

1. BCS 主数据已加入 `identityMap`，字段顺序基本符合要求。
2. 导出 sandbox 已存在。
3. 导出树新增了保留 `id/parentId` 的构造函数。
4. 导出 `identityMap` 已改为保留 `{ syncId, ...extras }`。
5. 覆盖导入已补充 root / top-root 的 syncId 映射。
6. UI 已加入覆盖导入、备份、恢复入口。
7. `.gitignore` 已加入 `.claude/settings.local.json`。
8. `node --check` 当前通过。

这些内容不是本次重点重写对象，除非它们和下方遗留问题冲突。

## 3. 当前必须修复的遗留问题

### 3.1 threshold: 0 被错误改回 300

当前逻辑：

```js
const threshold = Math.max(0, parseInt(payload && payload.threshold, 10) || 300);
```

问题：

- `parseInt(0, 10)` 是 `0`。
- `0 || 300` 变成 `300`。
- 所以 `threshold: 0` 无法强制覆盖。
- 备份恢复、失败回滚都传了 `threshold: 0`，但实际可能进入增量分支。

最终修复要求：

```js
const parsedThreshold = parseInt(payload && payload.threshold, 10);
const threshold = Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 300;
```

或等价实现。

验收：

- `threshold: 0` 必须进入覆盖分支。
- UI 输入空值时仍默认 300。
- UI 输入正数时使用用户值。

### 3.2 增量导入删除后又把旧 mapping 写回

当前问题：

- 增量分支先计算 `toDelete` 并删除 Chrome 节点。
- 但随后 `syncIdToChromeId` 从完整 `localBySyncId` 初始化。
- 被删除的 syncId 仍进入最终 `nextIdentityMap`。
- 最终 BCS mapping 会指向不存在的 Chrome id。

最终修复要求：

1. 计算 `toDeleteSyncIds`。
2. 删除成功或计划删除后，从所有后续 map 中移除：
   - `localBySyncId`
   - `syncIdToChromeId`
   - `localByChromeId`
3. 重建 `nextIdentityMap` 时只能包含：
   - 导入包 root syncId -> Chrome root `0`
   - 导入包 top-root syncId -> Chrome root `1/2/3`
   - 导入包普通节点 syncId -> 当前/新建 Chrome id
4. 禁止包含导入包不存在的 syncId。

验收：

- 删除导入包中不存在的书签后，BCS `identityMap` 中不再有该 syncId。
- 删除文件夹后，子树 mapping 全部消失。
- 写入 BCS 后 `identityMap.id` 都能在 Chrome fresh tree 中找到。

### 3.3 增量导入 root/top-root syncId 未完全以导入包为准

当前问题：

- 增量分支跳过了 import root。
- `syncIdToChromeId` 先塞本地全部 mapping，再塞导入 top-root mapping。
- 若本地 root/top-root syncId 与导入包不同，可能保留旧 syncId。
- 最终 `identityMap` 可能出现同一个 Chrome id 对应多个 syncId，或被 normalize 后保留旧 syncId。

最终修复要求：

1. 增量分支必须显式建立：
   - `importRootSyncId -> "0"`
   - `importTopRootSyncId -> "1/2/3"`
2. 初始化最终 mapping 时不要先无差别复制本地全部 mapping。
3. 最终 `nextIdentityMap` 必须按导入树遍历结果构造，而不是从本地 map 全量复制。
4. 对于同一个 Chrome id，导入包 syncId 优先。
5. 本地旧 root/top-root syncId 如果不在导入包中，必须删除。

验收：

- 增量导入后 root/top-root 的 `syncId` 与导入包一致。
- 不存在同一个 Chrome id 多个 syncId 的 mapping。
- 不会因 `skipIdentityMapHeal` 把缺失/错误 mapping 静默写入。

### 3.4 增量导入移动/排序使用旧 localParentByChildId

当前问题：

- 创建、删除、更新后，`localParentByChildId` 仍是导入前快照。
- move/reorder 阶段用旧 index 判断，连续移动/排序可能误判。
- 新建节点没有 currentInfo，不会按目标 index 排序。

最终修复要求：

可选方案 A（推荐，简单可靠）：

1. 创建/删除/更新完成后，重新拉一次 Chrome tree。
2. 用 fresh tree 重建：
   - `localNodeByChromeId`
   - `localParentByChildId`
3. 再执行 move/reorder。
4. 每次 move 后本地更新当前 parent/index 状态，或在每个父级处理前按 fresh order 重新计算。

可选方案 B：

- 按父节点分组做稳定排序，从目标顺序依次 move。
- 每次 move 后同步更新内存中的 sibling order。

验收：

- 同父级 A/B/C -> C/A/B 能正确排序。
- 跨父级移动后能放到指定 index。
- 新增节点能被移动到导入包指定 index。

### 3.5 导出 fallback 可能导出 Chrome 本地 id

当前问题：

- `__buildPermanentMainSyncPayload()` 现在假设输入 tree 已经经过 sandbox 替换。
- 但导出流程如果 sandbox 构建/处理失败，会 fallback 到 live BCS。
- live BCS 里 `tree.id/parentId` 是 Chrome id。
- 这样会导出 Chrome 本地 id，违反协议。

最终修复要求：

推荐方案：

- `__buildPermanentMainSyncPayload(contentInput, options)` 增加明确参数：
  - `idsAlreadySyncIds: true`
  - 或 `replaceLocalIdsWithSyncIds: true`
- sandbox 路径传 `idsAlreadySyncIds: true`。
- live fallback 路径必须现场根据 `identityMap` 替换 id。
- 如果无法替换，则中止导出并提示错误，不允许导出 Chrome id。

验收：

- 人为让 sandbox 失败时，不会导出 Chrome 数字 id。
- 正常导出 tree 里所有 id/parentId 都是 `syncId_*`。

### 3.6 临时栏目 sectionId 迁移可能产生重复 id

当前问题：

- `buildTempSectionIdFromSection()` 对缺少 label/sequence 的旧栏目可能生成相同 id。
- `rewriteTempSectionId()` 没有检查 `newId` 是否已存在。
- 可能导致两个临时栏目同 id，DOM、edge、containedTempIds 混乱。

最终修复要求：

1. 新增 `makeUniqueTempSectionId(baseId, oldId)`：
   - 如果 `baseId` 未被占用，直接用。
   - 如果被其他 section 占用，加稳定后缀，例如 `-2`、`-3`。
   - 不把当前 `oldId` 自己算作冲突。
2. 所有创建与迁移路径都通过唯一性检查。
3. `rewriteTempSectionId(oldId, newId)` 内部也要防御：
   - 如果 `newId` 被其他 section 占用，自动转为唯一 id。
4. 迁移后立即保存 BCS/temp state，避免刷新后重复迁移。

验收：

- 多个旧 `tempSecId_*` 且 label 相同不会撞 id。
- 多个特殊临时栏目同 label 不会撞 id。
- DOM 中不会出现重复 id。

### 3.7 临时栏目特殊来源识别不完整

当前 `__SPECIAL_TEMP_SOURCE_RE` 只包含：

```js
/^(browser-drop|drop|search|batch|add|import|file-import)$/i
```

但现有目录识别里特殊来源包括：

- `browser-drop`
- `search-result`
- `batch`
- `quick-add`
- `file-import`
- `import-html-bookmarks`
- `import-json-bookmarks`

最终修复要求：

- 特殊来源集合统一成一个常量。
- `buildTempSectionIdFromMeta()`、目录识别、颜色判断尽量复用同一来源集合。
- 至少补齐：
  - `search-result`
  - `quick-add`
  - `import-html-bookmarks`
  - `import-json-bookmarks`

验收：

- 特殊临时栏目按特殊来源生成唯一 id。
- 普通链式栏目不被误判为特殊栏目。

### 3.8 `skipIdentityMapHeal` 不能成为写入错误 mapping 的通道

当前问题：

- 为避免导入时重新生成 syncId，写入 BCS 时允许 `skipIdentityMapHeal`。
- 但如果上游 `nextIdentityMap` 缺项、多项、重复项，错误会直接写入。

最终修复要求：

新增导入专用校验函数，例如：

```js
__validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds)
```

校验内容：

- 每个 tree node 的 Chrome id 都有且只有一个 mapping。
- 每个 mapping.id 都能在 fresh Chrome tree 中找到。
- 每个导入包 syncId 都出现在 mapping 中。
- 不存在重复 `id`。
- 不存在重复 `syncId`。
- `syncId` 全部来自导入包 expectedSyncIds。

策略：

- 校验失败时不要写入 BCS。
- 覆盖导入失败则触发回滚。
- 增量导入失败则报错并回滚。

验收：

- 故意构造缺少 root/top-root mapping 的导入包，会失败而不是生成新 syncId。
- 故意构造重复 syncId，会失败。
- 正常导入通过校验。

## 4. 最终修复实施顺序

### 阶段 1：先修备份恢复强制覆盖

文件：

- `history_html/transfer_AI_sync/import-export-transfer-feature.js`

任务：

1. 修复 threshold 解析。
2. 保证 `threshold: 0` 强制覆盖。
3. 手动备份恢复、自动回滚都确认走覆盖分支。

原因：

- 后续修复增量/覆盖导入时，需要可靠回滚兜底。

### 阶段 2：修导出协议 fallback

文件：

- `history_html/storageBCS/storageBCS_core.js`
- `history_html/transfer_AI_sync/import-export-transfer-feature.js`

任务：

1. 让 `__buildPermanentMainSyncPayload()` 不再隐式假设输入已经是 syncId。
2. 明确区分 sandbox 输入和 live 输入。
3. live 输入必须替换为 syncId 后才允许导出。
4. 无法替换时中止导出。

### 阶段 3：修导入 identityMap 构建与校验

文件：

- `history_html/transfer_AI_sync/import-export-transfer-feature.js`
- `history_html/storageBCS/storageBCS_core.js`

任务：

1. 新增导入包树 flatten：
   - root
   - top roots
   - normal nodes
2. 生成 `expectedSyncIds`。
3. 生成 `syncId -> chromeId`。
4. 重建 `nextIdentityMap` 时只使用 `expectedSyncIds`。
5. 新增写入前校验。
6. 校验通过才 `skipIdentityMapHeal` 写入。

### 阶段 4：修增量导入 CRUD / move / sort

文件：

- `history_html/transfer_AI_sync/import-export-transfer-feature.js`

任务：

1. 删除后清理 mapping。
2. 创建后记录 mapping。
3. 更新标题/URL。
4. 拉 fresh tree 后再 move/sort。
5. move/sort 后再拉 fresh tree 写 BCS。
6. 最终 identityMap 只包含导入包 syncId。

### 阶段 5：修临时栏目 sectionId 唯一性和特殊来源

文件：

- `history_html/bookmark_canvas_module.js`
- `history_html/storageBCS/storageBCS_core.js`
- `history_html/canvas_sidebar_directory.js`
- `history_html/transfer_AI_sync/import-export-transfer-ui-support.js`

任务：

1. 新增统一特殊来源集合。
2. 修 `buildTempSectionIdFromMeta()` 的特殊来源判断。
3. 新增唯一 id 生成。
4. 修迁移路径，避免重复 id。
5. 迁移后保存状态。

### 阶段 6：最终清理

任务：

1. 确认 `.claude/settings.local.json` 不在 git tracked changes 中。
2. `.gitignore` 可保留。
3. 确认计划书 md 可保留在 `docs/`。

## 5. 必做验证清单

### 5.1 静态检查

```bash
node --check history_html/storageBCS/storageBCS_core.js
node --check history_html/transfer_AI_sync/import-export-transfer-feature.js
node --check history_html/transfer_AI_sync/import-export-transfer-ui-support.js
node --check history_html/bookmark_canvas_module.js
node --check history_html/canvas_sidebar_directory.js
```

### 5.2 导出验证

1. 正常导出：
   - 永久栏目 JSON `tree.id` 全是 `syncId_*`。
   - `tree.parentId` 全是 `syncId_*`。
   - 无 `index`。
   - 无 Chrome 数字 id。
   - `identityMap` 保留 `{ syncId }`。
2. sandbox 失败模拟：
   - 不允许导出 Chrome id。
   - 要么现场转换成功，要么中止导出并提示。

### 5.3 覆盖导入验证

1. 设备 A 导出。
2. 设备 B 覆盖导入。
3. 检查：
   - Chrome 树按导入包重建。
   - BCS tree 是设备 B Chrome id。
   - BCS identityMap.id 是设备 B Chrome id。
   - BCS identityMap.syncId 与导入包 tree.id 一致。
   - root/top-root syncId 与导入包一致。

### 5.4 增量导入验证

分别验证：

1. 新增书签。
2. 删除书签。
3. 删除文件夹及子树。
4. 修改标题。
5. 修改 URL。
6. 跨文件夹移动。
7. 同父级排序。
8. 新增后立即排序。
9. root/top-root syncId 从导入包覆盖本地旧值。

每项后检查：

- Chrome fresh tree。
- BCS tree。
- BCS identityMap。
- 三者一致。

### 5.5 备份/回滚验证

1. 手动备份后恢复，必须强制覆盖。
2. 覆盖导入前自动备份。
3. 故意制造覆盖导入失败，必须回滚到备份。
4. 回滚后 BCS/Chrome/DOM 一致。
5. 恢复备份时不覆盖备份槽本身。

### 5.6 临时栏目验证

1. 普通链式栏目 id：`temp-section-A-1` / `temp-section-A-1-1`。
2. 特殊临时栏目 id：保留 `temp-section-` 前缀且唯一。
3. item id：`tempId_YYYYMMDD_hash_xxxxxxx`。
4. 拖拽跨栏目后 item.sectionId 正确。
5. 目录定位正常。
6. 批量面板正常。
7. 右键菜单正常。
8. fold/scroll key 正常迁移。
9. import-container.containedTempIds 正常。
10. edges 连接正常。

## 6. 禁止事项

- 不要再把 Chrome 本地 id 导出到永久栏目 JSON。
- 不要在导入已有 syncId 的节点时重新生成 syncId。
- 不要用 `skipIdentityMapHeal` 跳过所有校验后直接写入。
- 不要让 `threshold: 0` 走增量分支。
- 不要让删除后的 mapping 留在 BCS。
- 不要生成重复临时栏目 `sectionId`。
- 不要把 `.claude/settings.local.json` 纳入功能 commit。

## 7. 最终交付格式

修复完成后，需要在回复中明确列出：

1. 修了哪些文件。
2. 哪些协议问题已解决。
3. 静态检查结果。
4. 哪些浏览器内手动验证还需要用户执行。
5. 是否仍有未覆盖风险。
