# Obsidian 双向同步计划书（V1，改版）

> 返回文档索引：[docs/README.md](./README.md)

## 1. 这版计划解决什么问题

- 不再把“事件日志”当主判定依据，避免日志丢失/覆盖导致误判。
- 对齐 `remotely-save` 的核心思路：**本地状态 + 云端状态 + 上次同步基线（prevSync）三方比对**。
- 兼容当前 Bookmark-Canvas 的 MV3 架构：前台负责执行同步，后台负责轻量信号检测。

---

## 2. 三条路线对比（最终结论）

### 2.1 Obsidian Git（参考）

- 优点：依赖本地 `.git` 索引，文件变更定位天然准确。
- 局限：该能力建立在 Obsidian Vault + git 工作区，不可直接搬到 Chrome 扩展。

### 2.2 Obsidian Local REST API

- 优点：能拿到文件内容与 `mtime/size`（接口有 `stat` 字段）。
- 局限：它是文件 API，不是同步引擎；不提供“上次同步基线”和完整冲突计划。

### 2.3 Remotely Save（本项目推荐对齐）

- 核心：`localEntityList + remoteEntityList + prevSyncEntityList`。
- 先产出“同步计划”（upload/download/delete/conflict），再执行。
- 这正适合我们当前“没有本地 git index”的插件场景。

---

## 3. V1 目标架构（Bookmark-Canvas）

### 3.1 数据输入

1. 本地候选文件：由当前导出桥生成（`.canvas` + `.md` 等）。
2. 云端文件元数据：从 GitHub 读取路径/sha/大小/时间信号。
3. 本地基线：`prevSyncRecords`（每个路径上次已确认同步的元数据）。

### 3.2 判定维度（按文件）

- `path`
- `hash`（本地可算；云端优先用 `sha`）
- `size`
- `mtime`
- `exists`

### 3.3 计划动作

- `upload`
- `download`
- `delete_remote`
- `delete_local`
- `conflict`
- `skip`

---

## 4. 和当前实现的关系

### 4.1 当前已经具备

- 前台单飞队列 + 防抖/定时兜底。
- `.canvas/.md` 文件级增量推送（基于 hash 比较）。
- 后台轻量云端信号检测（sha + 时间）与待处理提示。

### 4.2 当前不足

- 还缺“标准化 prevSync 记录 + 三方计划器”。
- 冲突决策仍偏流程型，缺少统一文件级 plan 抽象。

---

## 5. V1 实施步骤（可直接开发）

### M1：元数据基线（prevSync）

- 新增本地存储：按路径保存 `hash/size/mtime/sha/syncedAt`。
- 每次成功动作后只更新对应路径，失败不更新。

### M2：计划器（Plan Builder）

- 输入：local + remote + prevSync。
- 输出：文件级动作列表（含 reason）。
- 保证同一路径单轮只会落一个最终动作。

### M3：执行器（Executor）

- 按 plan 执行上传/拉取/删除。
- 成功后回写 prevSync。
- 失败进入重试队列，保留错误报告。

### M4：冲突与 UI

- `conflict` 动作进入现有冲突面板。
- 面板动作（保留本地/使用云端）转换为明确 plan 重跑。

---

## 6. 大文件与 GitHub API 边界（已对齐）

- `<= 1MB`：Contents API JSON 内联内容，直接处理。
- `1MB ~ 100MB`：走 Raw 回退读取，兼容大文件拉取。
- `>= 100MB`：GitHub Contents API 不支持写入，必须提示用户拆分。

针对超限弹窗建议（已纳入策略）：

1. 建议拆分栏目（永久/临时/空白）。
2. 建议清理长期不需要的数据。
3. 本轮推送/自动同步中止，避免持续失败重试。

---

## 7. 运行时职责分层（最终口径）

### 前台（页面打开）

- 执行同步（plan + action）。
- 显示冲突/不一致弹窗与手动操作。
- 负责真正写本地状态与写云端内容。

### 后台（MV3 service worker）

- 只做轻量信号检查（sha/committedAt + 本地基线摘要）。
- 标记“云端不一致待处理”并更新角标。
- 不做主流程全量同步，避免后台重负载。

---

## 8. 验收标准（V1）

- 文件级计划可解释：每个动作都有原因。
- 不再依赖事件日志判断“改了什么”。
- 双端并发修改时，冲突可见且可手动收敛。
- 大文件触发限制时，提示明确且不会死循环重试。

---

## 9. 对你当前问题的最终回答

- 不是“全量推送”也不是“纯事件日志”。
- 应采用 **remotely-save 式三方比对 + 计划执行**。
- `obsidian-local-rest-api` 可作为文件读写通道或辅助元数据来源，但不能替代同步计划器。
