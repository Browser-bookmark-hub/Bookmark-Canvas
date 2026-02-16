# Canvas 同步开发指南

> 返回文档索引：[docs/README.md](./README.md)

> 适用范围：`history_html/bookmark_canvas_module.js` 中的画布主状态同步（`sections / mdNodes / edges`）。

## 目标

- 多标签页 / 多窗口 / 侧边栏 与 页面 之间保持实时同步。
- 新功能接入时，避免“本地可见、其他页面不更新”或“刷新后丢失”。

## 一句话原则

**凡是修改了持久化画布状态，就必须调用 `saveTempNodes()`。**

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

---

## 4) 风险与边界（开发时必须知道）

- 同步模型是**最终一致**，不是强一致。
- 并发冲突策略是 **last-write-wins**（后写覆盖前写）。
- 大画布场景下，跨页回灌可能有可感知延迟（通常短暂）。

---

## 5) 提交前自检清单

- [ ] 我新增的功能是否改了 `CanvasState` 主状态？
- [ ] 若改了，是否在收敛点调用了 `saveTempNodes()`？
- [ ] 关键动作是否使用 `saveTempNodes({ immediate: true })`？
- [ ] 是否误把临时 UI 状态写进了主状态？
- [ ] 多窗口/侧边栏场景是否做过手工验证？
