# Canvas 同步开发指南

> 返回文档索引：[docs/README.md](./README.md)

> 适用范围：`history_html/bookmark_canvas_module.js` 中的画布主状态同步（`sections / mdNodes / edges`）及关键 localStorage 补充同步（如永久栏目说明文本/副本说明文本）。

## 目标

- 多标签页 / 多窗口 / 侧边栏 与 页面 之间保持实时同步。
- 新功能接入时，避免“本地可见、其他页面不更新”或“刷新后丢失”。

## 一句话原则

**凡是修改了持久化画布状态，就必须调用 `saveTempNodes()`。**

### 存储写入入口（2026-02）

- 共享状态写入：`saveSharedState(key, value, { asJSON })`
- 分区视图写入：`saveViewState(kind, baseKey, value, { asJSON, partitionKey })`
- `history.js` 写入入口：`__saveLocalStorageRaw(key, value)` / `__saveLocalStorageJSON(key, value)`
- 建议：
  - 业务内容（栏目信息/连线等）仍走 `saveTempNodes()`。
  - 视图状态（展开/滚动/缩放）优先走 `saveViewState()`。
  - 非视图配置项（开关/设置）优先走 `saveSharedState()`。
  - 约束：除统一入口外，不再新增直接 `localStorage.setItem` 写入点。

---

## 1) 新功能接入同步的标准流程

1. 先修改 `CanvasState`（如 `tempSections`、`mdNodes`、`edges`）。
2. 立即调用 `saveTempNodes()`（或按业务节流后调用）。
3. 若是导入/批量替换等关键动作，用 `saveTempNodes({ immediate: true })`。

### 示例（推荐）

```js
// 1) 更新状态
CanvasState.mdNodes.push(newNode);

// 2) 持久化 + 跨页面同步
saveTempNodes();
```

### 关键动作（推荐）

```js
// 关键操作后立即落盘，避免用户立即刷新时丢失
saveTempNodes({ immediate: true });
```

---

## 2) 什么不要调用 `saveTempNodes()`

- 仅当前会话有效的临时 UI 状态：
  - 弹窗开关
  - hover/highlight
  - 正在拖拽中的中间态
  - 沙箱导入（sandbox）临时可见内容

这些状态不应进入持久化主状态。

---

## 3) 当前同步机制（已实现）

- 保存入口：`saveTempNodes()`
  - 负责：持久化 + 触发跨页面同步信号。
- 监听入口：`__bindCanvasTempStateRealtimeSync()`
  - 监听 `storage.onChanged`（扩展主通道）
  - 监听 `window.storage`（localStorage 场景）
- 外部状态消费：`__consumeCanvasTempStateRealtimeSignal()`
  - 支持 marker（`chrome.storage` / `IndexedDB`）后二次读取真实状态。
- localStorage key 分发：`__handleCanvasRealtimeLocalStorageSync()`
  - 已覆盖：
    - 画布主状态：`bookmark-canvas-temp-sections`
    - 外观/其他设置：`canvas-appearance-settings-v1`、`canvas-other-settings-v1`
    - 永久栏目布局：`permanent-section-position`、`permanent-section-copies`
    - 永久栏目说明文本：`canvas-permanent-tip-text`、`canvas-permanent-tip-text-copy-*`
    - 说明字号：`canvas-permanent-tip-text-font-size`、`canvas-permanent-tip-text-copy-*-font-size`
    - 说明高度设置：`canvas-temp-desc-height-settings-v1`、`canvas-permanent-desc-height-settings-v1`

### 视图状态分区持久化（2026-02）

- 画布相机（`pan/zoom`）采用按逻辑分区持久化：
  - 标签页分区：`page`（所有标签页共享最后一次）
  - 侧边栏分区：`sidepanel`（所有侧边栏共享最后一次）
- 存储 key 形态：`canvas:view:v1:camera:<partition>:zoom|pan`。
- 树展开/滚动状态也按同分区写入：`canvas:view:v1:expand:<partition>:...` / `canvas:view:v1:scroll:<partition>:...`。
- 临时栏目展开集合（`canvas-temp-expand-state`）已改为分区 key（`expand` 类别）。
- 临时栏目根列表可见数量（`canvas-temp-root-visible:*`）已改为分区 key（`view` 类别）。
- 当前版本仅使用分区 key，不再读取 legacy 视图键。
- 临时栏目主状态仅使用 `bookmark-canvas-temp-sections`。
- 存储 schema：`canvas:storage:schema-version`（当前目标版本：`4`）。
- 不再维护旧键兼容/清理逻辑；新版本仅识别新键。
- 设计目标：多窗口/多标签页/侧边栏并行工作时，视角互不抢占。

### 状态矩阵（共享 vs 分区）

- 全局共享（最终一致）：
  - `bookmark-canvas-temp-sections`（临时栏目/空白栏目/连线/颜色/描述等主内容）
  - `canvas-appearance-settings-v1`、`canvas-other-settings-v1`
  - `permanent-section-position`、`permanent-section-copies`
  - `canvas-permanent-tip-text*`（永久栏目说明文本与字号）
- 分区共享（`page` 与 `sidepanel` 各自 last-write-wins）：
  - `canvas:view:v1:camera:<partition>:zoom|pan`
  - `canvas:view:v1:expand:<partition>:...`
  - `canvas:view:v1:scroll:<partition>:...`
  - `canvas:view:v1:view:<partition>:canvas-temp-root-visible:*`
- 会话态（不建议持久化进主状态）：
  - hover、弹窗开关、拖拽中间态、sandbox 临时导入态

### 调试入口

- 在控制台运行：`__debugCanvasSyncState()`
- 用于查看当前分区、关键共享 key、关键分区 key 是否存在。

---

## 4) 风险与边界（开发时必须知道）

- 同步模型是**最终一致**，不是强一致。
- 并发冲突策略是 **last-write-wins**（后写覆盖前写）。
- 大画布场景下，跨页回灌可能有可感知延迟（通常短暂）。

---

## 5) 手工验收建议

- 建议按三场景清单回归：`docs/sync-validation-checklist.md`。
- 尤其关注：`标签页↔侧边栏` 的“内容共享 + 视图分区独立”。

---

## 6) 提交前自检清单

- [ ] 我新增的功能是否改了 `CanvasState` 主状态？
- [ ] 若改了，是否在收敛点调用了 `saveTempNodes()`？
- [ ] 关键动作是否使用 `saveTempNodes({ immediate: true })`？
- [ ] 是否误把临时 UI 状态写进了主状态？
- [ ] 多窗口/侧边栏场景是否做过手工验证？
