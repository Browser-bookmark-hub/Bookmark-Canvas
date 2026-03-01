# Bookmark-Canvas 颗粒度同步计划书（V1）

> 返回文档索引：[docs/README.md](./README.md)

## 1. 目标

- 同步粒度精确到具体文件（`.md` / `.canvas`），避免“整包重推”。
- 将“检测变更（dirty）”与“导出结构（路径映射）”解耦，保证高频编辑下性能可控。
- 保持现有策略面板语义不变（自动同步、定时推送/拉取、冲突处理），但执行内核改为文件级。

---

## 2. 已确认事实（来自当前项目与导出样本）

- 导出结构稳定为：`永久栏目/*.md`、`临时栏目/**/*.md`、`空白栏目/*.md`、`*.canvas`。
- `.canvas` 文件只包含 `nodes[]` 和 `edges[]`，并通过 `node.file` 映射到对应 `.md`。
- 两份导出样本（`书签画布-20260301` 与 `书签画布-20260301 2`）显示：
  - 编辑模式与视觉模式会导致永久/临时 `.md` 结构大幅变化（Markdown 列表 vs HTML 树）。
  - `.canvas` 更多承载布局/连线/文件引用关系。
- 当前代码已具备“按文件 hash 增量上传”能力，但 dirty 触发仍偏全局。

---

## 3. 同步对象与粒度定义

## 3.1 文件对象（最终同步单元）

1. `canvas`：`<exportRoot>/<name>.canvas`
2. `permanent`：`永久栏目/#A...md`、`#B...md`...
3. `temporary`：`临时栏目/.../*.md`
4. `blank`：`空白栏目/*.md`
5. `meta`（可选）：`说明_导入规则.md`

## 3.2 dirty 最小粒度

- `canvas`：布局/尺寸/颜色/连线/节点 file 引用变化。
- `permanent`：按槽位或副本文件路径（`#A/#B/...`）。
- `temporary`：按栏目 `sectionId` 映射到具体 `.md` 路径。
- `blank`：按 `mdNodeId` 映射到具体 `.md` 路径。

说明：
- “移动卡片、改颜色、改连线”默认只打 `canvas` dirty。
- “修改空白卡片文本”默认只打对应 `blank` 文件 dirty。

---

## 4. 新增存储池（核心）

## 4.1 `dirty` 池

建议键名：`canvas-obsidian-git-sync-dirty-v1`

字段建议：

- `canvas.layoutDirty: boolean`
- `canvas.fileRefDirty: boolean`
- `permanent.paths: string[]`
- `temporary.ids: string[]`
- `blank.ids: string[]`
- `renames: {entityId, oldPath, newPath, type}[]`
- `deletes: {entityId, path, type}[]`
- `updatedAt`

## 4.2 路径映射池

建议键名：`canvas-obsidian-git-sync-path-map-v1`

用途：

- `temp-section-id -> 临时栏目文件路径`
- `md-node-id -> 空白栏目文件路径`
- `permanent-slot -> 永久栏目文件路径`

## 4.3 同步基线池（prevSync）

建议键名：`canvas-obsidian-git-sync-prev-index-v1`

每个路径记录：

- `hash`
- `sha`
- `size`
- `mtime`
- `syncedAt`

---

## 5. 事件到 dirty 的映射规则

## 5.1 画布层（`.canvas`）

以下事件统一打 `canvas.layoutDirty=true`：

- 节点坐标变化（`x/y`）
- 节点尺寸变化（`width/height`）
- 节点颜色变化
- 连线增删改（`edges`）

以下事件打 `canvas.fileRefDirty=true`：

- 节点关联文件路径变化（重命名、改目录、改导出根）

## 5.2 空白栏目（`blank`）

- 仅文本/富文本内容变化：`blank.ids += mdNodeId`
- 标题变更导致文件名变化：
  - 记录 `rename(oldPath,newPath)`
  - 同时 `blank.ids += mdNodeId`
  - 同时 `canvas.fileRefDirty=true`

## 5.3 临时栏目（`temporary`）

- 栏目内书签内容/说明变化：`temporary.ids += sectionId`
- 标题变更导致文件名变化：同空白栏目处理。

## 5.4 永久栏目（`permanent`）

- 浏览器书签树变动（增删改移）触发永久 dirty。
- 若无法低成本定位具体槽位，先按 `permanent.paths` 全量重建（仅永久栏目，不影响其他文件）。

## 5.5 导出模式切换（视觉/编辑）

- 视为结构级变更：
  - `canvas.layoutDirty=true`
  - `permanent.paths=all`
  - `temporary.ids=all`
  - `blank` 按现有内容是否依赖模式决定（默认不强制全量）

---

## 6. 推送策略（Push）

1. 读取 `dirty + pathMap + prevSync`。
2. 计算候选路径集合（仅脏对象）。
3. 仅生成候选路径对应内容（不再整包生成再筛）。
4. 路径级比对（`hash/sha`）后上传变化文件。
5. 处理重命名：先写新路径，再删旧路径。
6. 单路径成功后即清对应 dirty 并更新 `prevSync`。
7. 失败路径保留 dirty，进入重试队列。

---

## 7. 拉取策略（Pull）

1. 先做云端信号检查（版本 SHA / 时间）。
2. 有变化时按路径级清单拉取（优先变更文件，不读无关文件）。
3. 本地同路径无 dirty：直接应用。
4. 本地同路径有 dirty 且云端也变：进入文件级冲突。
5. 拉取成功后更新 `prevSync`，并仅清理已成功路径的 dirty。

---

## 8. 冲突处理（文件级）

冲突单位：`filePath`

策略行为：

- 保留本地并覆盖云端：该路径执行 push。
- 使用云端覆盖本地：该路径执行 pull。
- 稍后处理：保留 pending，不清 dirty。

说明：

- 冲突面板继续复用现有 UI，但内部从“快照级”迁移为“文件级动作集合”。

---

## 9. 与现有设置项的对齐

- `启用同步`：总开关；关闭时不消费 dirty。
- `自动同步`：开启后可由事件/定时消费 dirty。
- `停止编辑后自动同步`：编辑防抖后触发；无 dirty 不执行。
- `自动同步间隔`：兜底检查 dirty；不是强制全推。
- `分离定时器`：
  - 定时推送：仅处理本地 dirty。
  - 定时拉取：仅处理云端变更。
- `完整同步时包含上传/拉取`：决定 full 模式是否包含 push/pull。
- `冲突合并策略`：作用于“同一路径双边变更”的决策。
- `后台检测云端变更`：仅做信号检测与提示，不做重同步。

---

## 10. 实施阶段

### M1（基础可用）

- 引入 `dirty/pathMap/prevSync` 三池。
- 实现空白栏目 + `.canvas` 的文件级 dirty 推送。
- 自动同步改为“无 dirty 不跑”。

### M2（完整覆盖）

- 接入临时栏目、永久栏目文件级 dirty。
- 接入 rename/delete 远端清理链路。
- 拉取改为路径级应用。

### M3（稳定增强）

- 文件级冲突面板与批处理。
- 大规模数据下分批执行与断点重试。
- 增加诊断页（dirty 数量、路径、最近失败路径）。

---

## 11. 验收标准

- 修改一个空白卡片文本，仅对应一个 `空白栏目/*.md` 上传。
- 仅移动卡片位置，仅 `.canvas` 上传。
- 临时栏目标题改名，触发 `rename + canvas.fileRef` 同步。
- 定时器触发时，无 dirty 不产生上传请求。
- 冲突处理后仅清理被处理路径的 dirty，其余保留。

---

## 12. 风险与边界

- GitHub Contents API 仍是“文件替换写入”，无法做文件内 patch。
- 若未实现 remote delete，重命名会遗留旧文件。
- 视觉模式大文件（大量图标）在高量级下可能接近 API 限制，需保留超限提示与拆分建议。
