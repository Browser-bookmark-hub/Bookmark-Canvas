# 执行记录（2026-04-20）：originalId 清理 + 同步守门

> 返回文档索引：[docs/README.md](./README.md)

## 1. 圆桌结论（多 agent 汇总）

1. 两份计划书存在冲突口径：
- 方案 A：`sourceID` 迁移 + `originalId` 过渡兼容。
- 方案 B（冻结决策）：本轮不落 `sourceID`，直接全链路清理 `originalId`。
2. 本轮采用冻结决策（方案 B），并优先补同步风险最高项：
- push 恢复锁从 fail-open 改成 fail-closed。
- push/full 前增加“本地导出永久树 vs Chrome API 永久树”一致性硬校验。

## 2. 已落地改动

### 2.1 `originalId` 清理

1. 删除运行态字段写入：
- `convertBookmarkNodeToTempItem` 不再写 `originalId`。
- `createTempItemFromPayload` 不再写 `originalId`。
2. 删除 DOM 注入：
- 临时树节点不再写 `data-original-id`。
3. 删除协议读写：
- temp section protocol 序列化不再写 `payload.originalId`。
- protocol -> runtime 反序列化不再回填 `runtimeItem.originalId`。
4. 删除搜索索引消费：
- `search.js` 不再把 `item.originalId` 写入索引项。
5. 保留一处 reserved key 拦截位（仅用于阻止旧字段透传）：
- `TEMP_SECTION_PROTOCOL_ITEM_RESERVED_KEYS` 保留 `originalId`。

### 2.2 同步守门增强

1. 新增 `verifyPermanentTreeConsistencyBeforePush(...)`：
- 从本地 `buildSyncFiles` 结果重建永久树快照。
- 读取当前 Chrome API 永久树快照。
- 双方 hash 不一致时直接阻断 push/sync。
2. 新增 `buildLocalManagedSyncFolderFilesMap(...)` 用于本地导出包重建树输入。
3. `pushObsidianFilesIncremental(...)` 在导出后、推送前执行永久树一致性校验。
4. `stagePushRecoveryLock(...)` 失败由原来的“继续上传”改为“直接抛错阻断”。

### 2.3 继续收敛（第二轮）

1. `runSync(...)` 在 `push/full` 模式下增加同步前一致性预检：
- 在决策分支前先执行一次永久树一致性校验，不再只依赖 push 子流程内部校验。
2. 为避免重复导出：
- `runSync` 预检构建的 bundle 会透传给 `pushObsidianFilesIncremental(...)` 复用（`prebuiltBundle`）。
3. 恢复锁阈值按计划收敛：
- 硬阈值由 `72h` 调整为 `24h`。
- 新增软阈值 `30min`，在恢复面板详情显示提醒。

### 2.4 导入链路 P2（shadow compare）与抑制窗口保险丝

1. `canonical import` 阴影审计已接线（仅 compare，不改现网行为）：
- 手动导入链路：`__processImportedPackage(...)` 内调用 `__runCanonicalImportShadowAudit('manual-import', ...)`。
- 同步导入链路：`__applyObsidianSyncFilesReplace(...)` 内调用 `__runCanonicalImportShadowAudit('sync-import', ...)`。
2. 阴影审计统计聚合：
- 复用 `window.__canvasCanonicalImportAudit` 记录总次数、mismatch 次数、最近记录（ring buffer）。
3. `suppressSyncMarkDirty` 新增软阈值/硬保险丝：
- 软阈值 `3s`：仅告警，不改变行为。
- 硬保险丝 `10s`：强制退出 suppress，恢复 `markDirty`，避免长时间“静默不打脏标”。
4. 可观测性：
- 新增 `window.__canvasSuppressSyncMarkDirtyGuard`，暴露 `active/ageMs/softWarnMs/hardFuseMs/fuseTrips/lastFuse`。
5. 顺手修复：
- 修正导入分组 membership 更新中的一次 `saveTempNodes({ suppressSyncMarkDirty })` 变量引用错误，改为 `saveTempNodes()`。

### 2.5 P2 阴影审计结构化（第三轮）

1. `__runCanonicalImportShadowAudit(...)` 升级为结构化记录：
- 新增 `version/source/syncMode/trigger/costMs`。
- 新增 `legacy/canonical` 签名与计数摘要。
- 新增 `diff`（`same/sigChanged/countChanged/sectionDelta/mdDelta/edgeDelta/tempItemDelta/permanentTreeChanged`）。
2. 聚合状态升级：
- `window.__canvasCanonicalImportAudit` 改为 versioned store。
- 新增 `byChannel`、`mismatchByType`、`updatedAt`，`recent` ring buffer 扩至 `50`。
3. 上下文透传补齐：
- `__applyObsidianSyncFilesReplace(filesByPath, folderName, options)` 正式接收第三参并透传 `trigger` 到审计。
- 手动导入入口（zip/json/folder/cloud）统一透传 `source/trigger/syncMode` 审计元信息。

### 2.6 P2 审计覆盖面补齐（第四轮）

1. sync 解析链补齐审计：
- `parseSyncFolderFilesForSync(...)` 增加 `sync-parse-remote-snapshot` 触发器的阴影审计，覆盖“只读解析链”。
2. 审计边界修正：
- `same/sigChanged` 改为直接比较签名字符串，避免空签名场景误计 mismatch。
3. 索引与计划补齐：
- 新增第五刀合并实施计划文档，并加入 `docs/README.md` 索引。

### 2.7 守门闭环补强（第五轮）

1. 历史 `originalId` 清扫补齐：
- 在 temp section 持久化前递归移除历史 `originalId`（含子节点）。
- 在加载到运行态时也执行同样清扫，避免旧数据继续残留。
2. 一致性校验时点加硬：
- `verifyPermanentTreeConsistencyBeforePush(...)` 默认强制读取实时 API 树；
- 仅在显式 `allowSnapshotHint=true` 时才允许复用快照提示值。
3. push 恢复锁覆盖面扩大：
- `shouldStagePushRecoveryLockForTrigger(...)` 从少数 trigger 扩展到 `push/full/sync` 主触发集合（排除 `pull/conflict`）。

### 2.8 第六/第七步剩余项收口（本轮新增）

1. sync 导出格式三模式支持补齐：
- 同步层导出格式枚举按 `json / visual / visual-no-icon` 收口。
- 清理“`visual/visual-no-icon` 强制降级到 `json`”旧兼容分支，避免同步侧与导出侧语义漂移。
2. 空白栏目 `markdownSource` 持久化主源补齐：
- sync 规范化路径保持源码透传（不做隐式清洗/改写）。
- 空白栏目恢复链路优先读取持久化 `markdownSource`，并在规范化时回写 `markdownSource`（同时镜像 `text` 兼容旧路径），保证主源闭环。
3. native text 与 plugin blank 语义分离补齐：
- native text 路径使用 `blank-native-text/body` 语义键。
- plugin blank 路径使用 `blank/markdown` 语义键，避免两类内容在 dirty 对比中混用同一载荷口径。

## 3. 回检结果（已执行）

1. 语法检查通过：
- `node --check history_html/bookmark_canvas_module.js`
- `node --check history_html/search/search.js`
- `node --check history_html/sync/obsidian-git-sync.js`
2. 字段回检：
- `rg -n "\\boriginalId\\b" -g'!docs/**'` 仅剩 1 处 reserved key。
- `rg -n "\\bsourceID\\b" -g'!docs/**'` 无命中（符合本轮“暂不上 sourceID”决策）。
3. 关键守门点命中：
- `verifyPermanentTreeConsistencyBeforePush(...)` 已接入 `pushObsidianFilesIncremental(...)`。
- `stagePushRecoveryLock(...)` 失败已改为 fail-closed。
4. 第二轮守门点命中：
- `runSync(push/full)` 已前置一致性预检。
- 恢复面板可显示锁龄与软阈值提醒（30min）。
- `RECOVERY_LOCK_MAX_AGE_MS` 已从 `72h` 收敛为 `24h`。
5. P2 阴影审计与保险丝命中：
- `manual-import` / `sync-import` 两条链路均已接入 `__runCanonicalImportShadowAudit(...)`。
- `saveTempNodes(...)` 已接入 suppress soft/hard guard（3s warn / 10s fuse）。
6. P2 结构化审计命中：
- 审计记录已可区分 `source/trigger/channel`，并可统计 mismatch 类型。
- sync 主链传入的 `applySyncFilesReplace(..., { trigger })` 已在前端落地消费，不再丢上下文。
7. P2 覆盖面命中：
- sync 解析链（非应用链）也已记录阴影审计。
- 验收脚本已新增 `sync-parse-remote-snapshot` 触发器命中检查。
8. 守门闭环补强命中：
- 历史 `originalId` 在“加载→运行态→再持久化”链路已增加清扫点。
- push/full 的永久树一致性校验默认不再依赖启动快照提示值。
- push 恢复锁阶段保护已覆盖更广的 push/sync 触发场景。
9. 第六/第七步收口命中：
- 验收脚本已补 `sync` 三模式导出格式检查（枚举命中 + 旧降级分支回检）。
- 验收脚本已补空白栏目 `markdownSource` 主源链路检查（plugin normalizer + 编辑回写 + 持久化保留）。
- 验收脚本已补 `native text / plugin blank` 语义分离检查（`blank-native-text` 与 `blank` 双分支命中）。

## 4. 一键执行方式（新增）

1. 在仓库根目录执行：
- `bash tools/run-sync-guard-acceptance.sh`
2. 脚本会依次执行以下验收：
- 语法检查（`history_html/bookmark_canvas_module.js`、`history_html/search/search.js`、`history_html/sync/obsidian-git-sync.js`）。
- `originalId` / `sourceID` 回检（排除 `docs/`，并要求 `originalId` 仅保留 reserved key 命中）。
- 关键 hook 命中检查（一致性预检、push fail-closed、恢复锁阈值、P2 审计上下文、抑制窗口保险丝）。
- 第六/第七步收口检查（sync 导出格式三模式、空白栏目 `markdownSource` 主源持久化、`native text / plugin blank` 语义分离）。
3. 脚本退出码：
- `0` 表示全部通过。
- 非 `0` 表示存在未通过项（会打印失败项明细）。

## 5. 待手测项（无法在 CLI 内自动完成）

1. `docs/smoke-tests.md` 全量 UI 冒烟（侧栏打开、画布交互、搜索建议）。
2. `docs/sync-validation-checklist.md` 三场景（页签↔页签、页签↔侧栏、侧栏↔侧栏）。
3. push 被阻断时的提示体验与恢复路径（尤其是一致性校验失败、恢复锁创建失败）。
