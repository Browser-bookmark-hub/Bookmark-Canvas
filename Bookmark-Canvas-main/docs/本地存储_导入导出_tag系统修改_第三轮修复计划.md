# 本地存储_导入导出_tag系统修改：第三轮修复计划

## 0. 背景

本计划针对以下提交的 review 结果再做一次定点修复：

- `229873574f045d1e3fe566205da3f5fc0dae4d7f`：首次实现「本地存储_导入导出_tag系统修改 1」。
- `82589cd64175488ae15884908772006f1b48903c`：第一次修复（覆盖 `_commit2298735修复计划.md` 大部分点）。
- `dc2242f28aefec73da7d4b10c0d62ff0bbdba4b0`：第二次修复（覆盖 `_最终修复计划.md` §3.1–§3.8）。

review 已确认前两部份的硬约束（不导出 chromeId、不重新生成已有 syncId、删除清理 mapping、root/top-root 以导入包为准、move/sort 基于 fresh tree、备份回滚强制覆盖、sectionId 唯一）全部满足，且 `node --check` 通过。

本轮只清理 review 中剩余的清理性 / 防御性问题，仍**不进入** `3、加颜色 / 标识 / tag 系统`。完成后即进入计划书确认的「前两块稳定后再做 tag 系统」阶段。

## 1. 修复目标（按优先级）

| # | 项 | 严重度 | 是否阻塞 tag 阶段 |
|---|---|---|---|
| 1 | `.claude/settings.local.json` 仍 tracked | 中 | 否（清理） |
| 2 | 校验函数对 `managed` 根（chromeId=`4`）误杀 | 中 | 是（企业策略环境会被锁死） |
| 3 | `__validateImportedIdentityMapAgainstTree` 应迁到 `storageBCS_core.js` 并通过 bridge 暴露 | 低 | 否（架构整洁） |
| 4 | `overwriteThreshold \|\| 300` 兜底语义 | 低 | 否 |
| 5 | `createTempNode` 中 `temp-section-pending-${seq}` 占位的脆弱性 | 低 | 否 |
| 6 | `createTempNode` 未写 `section.source` 与其它路径不对称 | 低 | 否 |
| 7 | 导出二级文件 `contentNodes` 与主 payload 的 id 体系不一致 | 低 | 否（同步/AI 复用前需要） |

## 2. 各点详细要求

### 2.1 `.claude/settings.local.json` 取消跟踪

**现状**：

- `.gitignore` 已包含 `.claude/settings.local.json`（在 commit `82589cd`）。
- 但 `2298735` 已经把该文件 commit 进库，gitignore 对已 tracked 的文件无效。
- `git ls-files .claude/settings.local.json` 仍返回该路径。

**修复要求**：

1. `git rm --cached .claude/settings.local.json` 取消跟踪（保留磁盘文件）。
2. 提交一次清理 commit，例如 `chore: untrack .claude/settings.local.json`。
3. 确认后续 `git status` / `git diff --stat HEAD~1` 不再出现该文件。

**验收**：

```bash
git ls-files .claude/settings.local.json
# 期望：空输出
```

### 2.2 `managed` 根（chromeId=`4`）的校验兼容

**现状**：

- 校验逻辑（`__validateImportedIdentityMapAgainstTree`）要求 fresh chrome tree 的每个 `chromeId` 都在 `nextIdentityMap` 中。
- `__recreateChromeBookmarkTreeFromImport` 的 `folderTypeToChromeId = { 'bookmarks-bar': '1', 'other': '2', 'mobile': '3' }` 不识别 `managed`；增量分支的 `importTopSyncIdToChromeId` 同样不识别。
- 企业策略环境下本地 Chrome 会有 `managed` 根（`id="4"`），fresh tree 含它而 `nextIdentityMap` 不含 → 校验失败 → 直接抛错并触发回滚。

**修复要求**（任选其一，推荐 A）：

A. **校验时跳过非可写 / 非标准的 Chrome 固定根**。

   1. 在 `__validateImportedIdentityMapAgainstTree` 中允许传入 `ignoredChromeIds: Set<string>`。
   2. 默认 `ignoredChromeIds` 包含本地 fresh tree 上的 `managed` 根 chromeId（通过 fresh tree 节点 `folderType === 'managed'` 识别）。
   3. 校验 `treeChromeIds` 时，若 chromeId 在 `ignoredChromeIds` 中则不要求其在 `nextIdentityMap` 中。
   4. 同时在 `__chromeBookmarksRemoveAllInRoot` 与覆盖分支中明确不删 / 不重建 `managed`。

B. **把本地 managed 根原地保留进 nextIdentityMap**。

   1. 覆盖与增量在拼 `nextIdentityMap` 时，扫一次 fresh tree 找出 `folderType === 'managed'` 的 chromeId。
   2. 若本地 identityMap 已有该 chromeId 的 `{id, syncId}`，原样保留；没有则新分配一个 syncId 但**只记到本地 BCS**，不进入"本轮 expectedSyncIds"。
   3. 校验函数允许 mapping 包含「不在 expectedSyncIds 中的、且对应 fresh tree managed 节点」的条目。

   不推荐 B：会让本地新分配的 syncId 混入导入流程，违反「导入阶段 syncId 只来源于导入包」的硬约束，需要额外标注。

**附带修复**：`rootChromeIdOf(...)` 当前在 folderType 缺失/未识别时兜底 `return '1'`，会把整棵子树堆到书签栏。改成：

- 找不到 folderType → 跳过该 top-child，记一条 `console.warn`。
- 不再静默落到书签栏。

**验收**：

1. 企业策略环境（或人工注入一个 `id=4, folderType=managed` 节点的 fresh tree）下，覆盖导入与增量导入都能完成、校验通过。
2. 导入完成后 `bcs:perm:main.identityMap` 不包含 managed 节点的 syncId（方案 A）；或包含但与导入包 syncId 不冲突（方案 B）。
3. 故意构造未知 folderType 的 top-child 时，导入会 warn 并跳过该子树，而不是默认堆进 `1`。

### 2.3 校验函数迁移到 `storageBCS_core.js` 并通过 bridge 暴露

**现状**：

- `__validateImportedIdentityMapAgainstTree` 当前定义在 `history_html/transfer_AI_sync/import-export-transfer-feature.js` 内部。
- `最终修复计划.md` §3.8 的语义是把它放在协议核心层，给同步 / AI 等后续路径复用。
- `CanvasProtocolBridge` 没有这个方法。

**修复要求**：

1. 把 `__validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds, options)` 移到 `history_html/storageBCS/storageBCS_core.js`。
2. 在 `CanvasProtocolBridge` 上挂一个：

   ```js
   validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds, options) {
       return __validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds, options);
   }
   ```

3. `import-export-transfer-feature.js` 改为通过 `bridge.validateImportedIdentityMapAgainstTree(...)` 调用。
4. 把 2.2 引入的 `ignoredChromeIds`（或类似选项）放进同一个 `options` 里。

**验收**：

- `import-export-transfer-feature.js` 不再包含函数本体，仅有调用。
- `node --check` 通过。
- 覆盖 / 增量导入路径行为与现状一致（含 2.2 的兼容）。

### 2.4 `overwriteThreshold || 300` 的语义陷阱

**现状**：

```@/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/transfer_AI_sync/import-export-transfer-feature.js:1550
                        threshold: overwriteThreshold || 300
```

```@/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/transfer_AI_sync/import-export-transfer-feature.js:1631
                    threshold: overwriteThreshold || 300
```

dialog 当前用 `Math.max(1, …)` 把输入夹到 1，所以 `overwriteThreshold` 不会是 0；但 `||` 兜底会把 0 / null / NaN 全部静默改成 300，与 `__performOverwriteImport` 入口已修复的 `Number.isFinite` 语义不一致；如果未来 dialog 允许"0 = 强制覆盖"，这两处会静默劫持。

**修复要求**：

把上述两行改成：

```js
threshold: Number.isFinite(overwriteThreshold) ? overwriteThreshold : 300
```

**验收**：

- 在调用 `__performOverwriteImport` 之前 console.log 出 `overwriteThreshold`，输入 `0` 时仍是 `0`，进入覆盖分支。
- UI 输入空 / 非法时仍走 300。

### 2.5 `createTempNode` 中的 `temp-section-pending-${seq}` 占位

**现状**：

```@/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js:15837-15840
    const sequenceNumber = ++CanvasState.tempSectionSequenceNumber;
    // sectionId is computed after the section's label/sequenceNumber are finalized below,
    // so the value is `temp-section-<label-chain>` from the very first save.
    let sectionId = `temp-section-pending-${sequenceNumber}`;
```

风险：

- 一旦中途插入 `await` / 同步读 `section.id` 的代码，会泄漏 `temp-section-pending-*` 字符串到 DOM、edge、containedTempIds、storage key 等位置。
- `__applyCanvasTempStateObject` 的 legacy 迁移正则 `/^temp-section-\d+$/` / `/^tempSecId_/` / `/^temp-section-protocol-/` 不识别 `pending-*`，迁移逻辑也清理不掉。

**修复要求**：

1. 调整顺序，使 `section.id` 从一开始就是 `allocateTempSectionId(...)` 的结果：
   - 把 label / sequenceNumber / source 决议提前；
   - 决议完毕后再创建 `section` 对象；
   - 不再使用 `temp-section-pending-*` 这一中间态字符串。
2. 若调整顺序破坏现有逻辑（例如 label 推断依赖 `section.title` / `section.label` 自身），改为先只做最小 stub `{ sequenceNumber, source }`，得出最终 label 后立刻 `allocateTempSectionId(...)`，再补全其它字段。
3. 同时在 `__applyCanvasTempStateObject` 的 legacy 正则里加入 `/^temp-section-pending-/`，作为防御性兜底。

**验收**：

- `grep -R "temp-section-pending-" history_html/` 结果只剩防御性正则（迁移识别）这一处，不再出现在赋值表达式里。
- `node --check` 通过。
- 任意路径创建临时栏目，DOM `id` 与 `data-section-id` 从第一次写入起就是 `temp-section-<label-chain>`。

### 2.6 `createTempNode` 显式写 `section.source`

**现状**：

```@/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/bookmark_canvas_module.js:15856-15869
    const section = {
        id: sectionId,
        title: resolvedTitle,
        sequenceNumber: sequenceNumber,
        ...
    };
```

`createTempNode` 路径 `section.source` 一直是 `undefined`，到 `allocateTempSectionId({ ..., source: section.source })` 时只能走非特殊源分支。当前需求下结果正确，但与 `createTempNodeFromMultipleUrlsFlat`（`source: 'browser-drop'`）、`createEmptyTempSection`（透传 `options.source`）、`importHtmlBookmarks`（`source: 'file-import'`）等路径不对称。

**修复要求**：

1. 在 `createTempNode` 里根据 `data` 推导 source：
   - `data.source === 'permanent'` → 不写 source（普通链式分裂）；
   - `data.source === 'temporary'` → 不写；
   - 其它 / 未知 → 不写；
   - 真正的特殊源（如未来新增）按需赋值。
2. 至少把"不写 source 是有意行为"在该函数顶部加一行注释说明，避免后续 reviewer 误改。
3. 与 2.5 的顺序调整合并完成。

**验收**：

- 普通链式 / 分裂 / 拖拽创建出来的临时栏目仍然识别为非特殊源，`__isSpecialTempSection` 返回 `false`。
- 颜色锁、左上角标号链行为不变。

### 2.7 导出二级文件 `contentNodes` 与主 payload 的 id 体系一致

**现状**：

```@/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/history_html/transfer_AI_sync/import-export-transfer-feature.js:2631-2642
        if (targetType === 'permanent' || targetType === 'permanent-copy') {
            const permanentContent = (__exportSandbox && __exportSandbox.permMain)
                ? __exportSandbox.permMain
                : await __ensurePermanentMainContentInBcs();
            const bookmarkTree = permanentContent && permanentContent.tree ? [permanentContent.tree] : null;
            …
            contentNodes = roots.map(toBookmarkNode).filter(Boolean);
```

- sandbox 命中：`node.id` 已是 syncId。
- live fallback：`node.id` 是 chromeId。

主 payload（`__buildPermanentMainSyncPayload`）已经在 live fallback 时显式做 chromeId→syncId 转换；但 `.canvas` / markdown 二级导出文件 `contentNodes` 没有对齐处理，导致同一份导出包里两份 id 体系不一致。后续 AI / 同步路径若复用这些二级文件可能踩坑。

**修复要求**：

1. 提取一个公共子流程，例如：

   ```js
   const permanentContentForExport = await __preparePermanentExportContent(__exportSandbox);
   ```

   - 内部判定 sandbox / live；
   - live 时调用与主 payload 同一份"id→syncId 替换 + index 删除"逻辑；
   - 转换失败（缺映射）→ `null`，调用方中止导出。

2. `targetType === 'permanent' / 'permanent-copy'` 分支与 `exportCanvasPackage` 主入口都使用此公共子流程，保证 `contentNodes` 与主 payload 的 id 体系一致。

3. `permanent-copy` 路径同步覆盖：副本继承主树，`contentNodes` 也必须用 syncId 形态。

**验收**：

1. 正常导出（sandbox 命中）：主 payload 与 `.canvas` / markdown 二级文件中所有 `id` 都是 `syncId_*`。
2. sandbox 失败模拟（人为让 `bridge.buildExportSandbox` 抛错）：要么现场转换成功并保持 syncId 一致，要么中止导出（与主 payload 行为对齐），不输出半 chromeId 半 syncId 的混合包。
3. 副本（permanent-copy）导出同样不出现 chromeId。

## 3. 实施顺序（建议）

### 阶段 1：取消跟踪 & 校验兼容（阻塞最高）

- 2.1 `git rm --cached`。
- 2.2 校验函数加 `ignoredChromeIds`，managed 跳过；`rootChromeIdOf` 不再兜底回 `1`。

### 阶段 2：架构整洁（低风险，可与阶段 1 同 PR）

- 2.3 校验函数迁到 `storageBCS_core.js` + bridge 暴露。
- 2.4 `overwriteThreshold || 300` 改成 `Number.isFinite`。

### 阶段 3：临时栏目防御性整理

- 2.5 + 2.6 一起：`createTempNode` 重排顺序、消除 `temp-section-pending-*`、补 source 推导、迁移正则加 `pending-*` 兜底。

### 阶段 4：导出二级文件统一

- 2.7 提取 `__preparePermanentExportContent`，统一 sandbox / live fallback 路径。

阶段 1 完成即可解除"企业策略环境用户被锁死"的阻塞，可以放出验证版本。
阶段 4 完成即认为前两大块「本地存储 / 导入导出」全部稳定，可以正式进入第三大块 tag 系统。

## 4. 验证清单

### 4.1 静态检查

```bash
node --check history_html/storageBCS/storageBCS_core.js
node --check history_html/transfer_AI_sync/import-export-transfer-feature.js
node --check history_html/transfer_AI_sync/import-export-transfer-ui-support.js
node --check history_html/bookmark_canvas_module.js
node --check history_html/canvas_sidebar_directory.js
```

### 4.2 git 状态

```bash
git ls-files .claude/settings.local.json   # 期望：空
git status                                  # 不应再出现 .claude/settings.local.json
```

### 4.3 导入校验兼容（managed）

1. 在能复现 managed 根的设备上做覆盖导入与增量导入，确认成功。
2. 没有 managed 的设备做对照实验，确认行为不变。
3. 导入完成后查 `bcs:perm:main.identityMap`：不应出现"导入包没有但本地新冒出"的 syncId（managed 走方案 A 时不应出现）。

### 4.4 threshold 行为

1. 备份恢复 / 自动回滚：`threshold: 0` 一定走覆盖分支（在 `console.log` 中确认）。
2. UI 空输入：fallback 到 300。
3. UI 正数输入：透传。

### 4.5 临时栏目

1. `grep -R "temp-section-pending-" history_html/` 期望除 legacy 迁移正则外无残留。
2. 普通链式 / 分裂 / 拖拽 / 文件导入 / 搜索 / 批量 / quick-add 各创建一个临时栏目，DOM `id` 与 `data-section-id` 从第一次出现就是 `temp-section-<label-chain>`。
3. 加载历史 state（含 legacy `temp-section-<N>` / `tempSecId_*` / 故意伪造的 `temp-section-pending-*`）后，全部被迁移成 `temp-section-<label-chain>` 且无重复。

### 4.6 导出包 id 一致性

1. 正常导出：抽样检查导出包内主 JSON 与 `.canvas` / markdown 二级文件，所有 `id` / `parentId` 都是 `syncId_*`。
2. sandbox 失败模拟：导出中止或全程保持 syncId，不出现混合 id。

### 4.7 校验函数挂到 bridge

1. `window.CanvasProtocolBridge.validateImportedIdentityMapAgainstTree` 存在。
2. 调用入参 / 返回值与原 in-feature 实现一致。

## 5. 完成标准

1. 所有静态检查通过。
2. `.claude/settings.local.json` 不再 tracked。
3. managed 根存在的环境下覆盖 / 增量导入不再失败回滚。
4. `__validateImportedIdentityMapAgainstTree` 在 `storageBCS_core.js` 中并通过 bridge 暴露。
5. `overwriteThreshold` 入参 `0` / 空值语义与 `__performOverwriteImport` 入口对齐。
6. 临时栏目创建过程不再出现 `temp-section-pending-*`，迁移正则也覆盖该 legacy 形态。
7. 导出包内所有永久树相关 `id` / `parentId` 在任何路径下都是 `syncId_*`，不再出现 chromeId。
8. 阶段 4 完成后即可推进到原计划书 §3 「加 颜色 / 标识 / tag 系统」。

## 6. 禁止事项

- 不要因为"managed 较少见"就直接默默删掉 / 改写 managed 节点。
- 不要在 fix 过程中给永久节点重新生成 syncId（仍受 `_最终修复计划.md` §6 禁令约束）。
- 不要把 `.claude/settings.local.json` 重新 commit 进库。
- 不要在 `createTempNode` 修改时引入新的中间占位字符串（如 `pending` / `tmp` / `__placeholder__` 等），避免重复本轮的隐患。
- 不要在导出二级文件路径里走"反向把 syncId 翻译回 chromeId"的逻辑——一律以 syncId 为对外形态。

## 7. 最终交付格式

修复完成后，需要在回复中明确列出：

1. 修了哪些文件、哪些函数。
2. 哪些 review 项（2.1–2.7）已解决。
3. 静态检查结果。
4. 哪些浏览器内手动验证还需要用户执行（尤其是 managed 环境与跨设备覆盖导入）。
5. 是否仍有未覆盖风险，以及是否进入计划书 §3 tag 系统阶段的判断。
