# Bookmark-Canvas Remotely Save 同步计划书

> 返回文档索引：[docs/README.md](./README.md)

## 1. 目标

- 在不修改 Obsidian 原生插件源码的前提下，为 Bookmark-Canvas 增加一套可落地的 Remotely Save 风格同步能力。
- 保留现有导入/导出能力，同步能力作为并列入口，不影响旧流程。
- 重点保证高频编辑场景可用：防抖、重试、断网恢复、冲突可见。

---

## 2. 范围与边界

### 2.1 本计划覆盖

- 在你指定位置新增同步入口按钮与二级设置 UI。
- 新增同步引擎（计划、执行、重试、冲突、日志）。
- 使用“文件级同步 + 细粒度拆分文件”策略，避免大文件频繁全量传输。
- 提供默认冲突处理策略，并保留可切换策略。

### 2.2 本计划不做

- 不改 Obsidian、Remotely Save、Obsidian Git 的源码。
- 不做字符级实时协同（OT / CRDT）。
- 不将可视导出/可编辑导出格式当作高频同步主协议。

---

## 3. UI 设计（固定位置）

## 3.1 入口位置

1. 设置菜单：`history_html/history.html` 的 `#settingsStorageSyncBlock`，位于“导入/导出”下方。
2. 管理弹窗：`#canvasManageModal` 中“导入/导出”按钮下方。

## 3.2 二级 UI（点击“同步”后）

- 同步总开关（启用/禁用）
- 自动同步（开关）
- 保存后同步（开关）
- 定时兜底同步间隔（分钟）
- 冲突策略（较新优先 / 较大优先 / 保留双方副本）
- 删除保护阈值（百分比）
- 手动按钮（立即同步 / 仅上传 / 仅拉取 / 重建索引）
- 状态区（上次成功时间、队列长度、最近错误）

## 3.3 交互约束

- 与现有导入/导出按钮交互风格一致。
- 从设置菜单进入时保持当前菜单关闭逻辑（避免双弹层混乱）。
- 二级 UI 支持 ESC 关闭。

---

## 4. 同步数据协议（专用协议）

同步目录统一为：`bookmark-canvas-sync/`

## 4.1 目录结构

- `manifest.json`（全局版本与索引）
- `nodes/temp-sections/<sectionId>.json`
- `nodes/md-nodes/<nodeId>.json`
- `edges/<edgeId>.json`
- `settings/appearance.json`
- `settings/other.json`
- `settings/permanent-tip.json`
- `tombstones/<entityType>.json`（删除墓碑）
- `snapshots/bookmark-canvas.backup.<timestamp>.json`（低频灾备快照）

## 4.2 `manifest.json` 字段

- `schemaVersion`
- `workspaceId`
- `revision`（递增）
- `updatedAt`
- `updatedBy`（clientId）
- `entries`（path/hash/size/mtime/entityType/entityId）
- `tombstoneRevision`
- `syncPolicy`

## 4.3 写入顺序（必须遵守）

1. 先写所有变更数据文件。
2. 写 `manifest.next`。
3. 最后提交 `manifest.json`。

目的：避免其他客户端读取到半更新状态。

---

## 5. 同步引擎

## 5.1 输入源

- 本地当前状态（CanvasState + 白名单设置）
- 云端当前状态（manifest + entries + tombstones）
- 本地上次成功同步状态（prevSync）

## 5.2 计划阶段（Sync Plan）

按文件判定：

- unchanged
- local_created / remote_created
- local_modified / remote_modified
- local_deleted / remote_deleted
- conflict

输出动作：

- upload
- download
- delete_remote
- delete_local
- keep_local / keep_remote
- duplicate_both

## 5.3 执行阶段

- 单飞队列（同时仅一个同步任务）
- 文件并发上限默认 3
- 成功后更新本地 `prevSync`
- 失败进入重试队列

---

## 6. 冲突与失败处理

## 6.1 冲突默认策略

- 默认：`keep_newer`（较新优先）
- 可选：`keep_larger`（较大优先）
- 可选：`keep_both_rename`（保留双方副本）

## 6.2 删除保护

- 当单轮删除比例超过阈值（默认 20%）时阻断本轮同步。
- 在 UI 显示高危提醒，用户手动确认后才继续。

## 6.3 断网恢复

- 网络错误进入指数退避重试：2s → 5s → 10s → 30s → 60s。
- Obsidian 或网络恢复后自动继续队列。

---

## 7. 高频同步参数（默认）

- 普通内容变更防抖：800ms
- 批处理合并窗口：2s
- 定时兜底：180s
- 批量操作（导入/大范围移动）额外延时：5s
- 每轮最大动作数：500（超出自动分批）

说明：

- 高频同步走“增量文件”而不是整包。
- `bookmark-canvas.backup.json` 只做低频快照，不进高频主回路。

---

## 8. 代码改动清单

## 8.1 新增模块

- `history_html/sync/sync-engine.js`
- `history_html/sync/sync-plan.js`
- `history_html/sync/sync-conflict.js`
- `history_html/sync/sync-storage.js`
- `history_html/sync/sync-ui.js`
- `history_html/sync/adapters/base-adapter.js`
- `history_html/sync/adapters/remotely-save-adapter.js`

## 8.2 修改文件

- `history_html/history.html`：同步按钮 + 二级 UI DOM
- `history_html/history.css`：同步相关样式
- `history_html/history.js`：设置菜单桥接逻辑
- `history_html/bookmark_canvas_module.js`：按钮绑定、状态打脏与触发

## 8.3 新增本地状态键

- `canvas-sync-settings-v1`
- `canvas-sync-runtime-v1`
- `canvas-sync-prev-state-v1`
- `canvas-sync-retry-queue-v1`
- `canvas-sync-last-report-v1`

---

## 9. 测试与验收

## 9.1 核心测试

1. 单端高频编辑（拖拽/重命名/移动）
2. 双端同时改同一对象（冲突路径）
3. 断网编辑后恢复同步
4. 大数据量（1 万书签）分批同步
5. 删除保护阈值触发与确认

## 9.2 验收标准

- 不丢数据，最终一致。
- 冲突有明确日志与可恢复路径。
- 高频操作下同步不卡死。
- 导入/导出功能无回归。

---

## 10. 默认决策（已锁定）

- 同步语义：文件级（非字符级协同）。
- 主冲突策略：较新优先。
- 触发方式：事件防抖 + 定时兜底 + 手动同步。
- 同步协议与导出协议分离。
- 不修改第三方插件源码。
