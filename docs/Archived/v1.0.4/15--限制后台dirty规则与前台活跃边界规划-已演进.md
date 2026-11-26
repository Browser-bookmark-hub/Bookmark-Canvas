# 限制后台 dirty 规则与前台活跃边界规划书

针对 commit `d170aa391f564dc428d11b842753ae20ec2a2f06` 引入的“后台 dirty 机制”，为理清其前后台边界，制定本极简规划方案。

---

## 1. 核心目标：将后台 dirty 限制在“纯后台”

* **当前痛点**：当前 background 无条件监听书签变化并标记 `dirty=true`。即使前台（标签页/侧边栏）一直开着并自己在增量同步，后台依然会标记 dirty。导致前台下一次冷启动或刷新时，误判并触发冗余的“全量从 Chrome 同步到 BCS”操作。
* **规划目标**：将后台写 dirty 的规则严格限制在**“前台页面已全部关闭”**的纯后台状态。只要有任意前台页面打开并存活，后台事件直接忽略，不标记 dirty。

---

## 2. 边界设计：前台 Port 连接计数器

采用最稳定、轻量且无异步开销的 **Port 存活判定机制**：

### 2.1 前台 (Foreground) 与侧边栏定义

* **属于前台**：
  * 普通画布标签页：`history_html/history.html?view=canvas`。
  * 侧边栏内的 iframe 页面：`history_html/history.html?view=canvas&sidepanel=1`。
  由于二者都加载并运行了 `history.js`，它们在页面初始化流程（`DOMContentLoaded`）中都会发起 Port 连接，因此后台能统一感知它们的存活。
* **不属于前台**（不建立 Port 连接）：
  * `panel-shell.html`（侧边栏壳）。
  * `sidebar.html`（入口配置页）。
  * 其他只读配置或指南页面。

前台 Port 连接建立与自动重连代码实现：

```javascript
let foregroundActivePort = null;
function setupForegroundActivePort() {
    try {
        if (!(browserAPI && browserAPI.runtime && typeof browserAPI.runtime.connect === 'function')) {
            return;
        }
        foregroundActivePort = browserAPI.runtime.connect({ name: 'bookmark-canvas-foreground-active' });
        foregroundActivePort.onDisconnect.addListener(() => {
            foregroundActivePort = null;
            // 断开后 2 秒尝试重连
            setTimeout(setupForegroundActivePort, 2000);
        });
    } catch (e) {
        console.warn('[ForegroundPort] Connection failed:', e);
    }
}
```

### 2.2 后台 (Background)
* 后台内存中维护一个 Set 集合 `activeForegroundPorts` 保存当前连接的所有前台端口。
* 注册 `runtime.onConnect` 监听，收到 `bookmark-canvas-foreground-active` 时加入集合，断开时从集合中移除。
* **写 dirty 的前置判定**：
  在 `registerCanvasPermanentBookmarkDirtyListener` 的所有书签监听器中，检查 `activeForegroundPorts.size`：
  ```javascript
  const mark = (reason) => {
    // 只有在没有活跃前台时（size === 0），才标记后台 dirty
    if (activeForegroundPorts.size === 0) {
      markCanvasPermanentBookmarksDirty(reason).catch(() => { });
    }
  };
  ```

---

## 3. 限制与延后处理说明（后续再说）

根据讨论，**本阶段不做任何前台生命周期的休眠/唤醒逻辑**：
1. **不处理浏览器页面的休眠/冻结状态检测**：不监听前台的 `visibilitychange`、`focus` 进行增量/版本校验。
2. **前台表现保持现有机制不变**：前台唤醒时依然按普通状态处理。前台休眠唤醒的数据一致性保证，留在下一阶段作为前台优化项再行设计和开发。
3. **仅解决 commit 带来的副作用**：本方案仅解决“因前后台同时监听书签事件，导致后台写脏标记，引发前台冗余全量同步”的边界缺陷。

---

## 4. 代码改造范围

1. **`Bookmark-Canvas-main/background.js`**
   - 增加 `activeForegroundPorts` 内存变量。
   - 增加对 `bookmark-canvas-foreground-active` 端口的监听与清理。
   - 修改 `registerCanvasPermanentBookmarkDirtyListener`，在 `mark` 处增加 `activeForegroundPorts.size === 0` 的过滤。
2. **`Bookmark-Canvas-main/history_html/history.js`**
   - 增加 `setupForegroundActivePort` 并在 `DOMContentLoaded` 监听器最底端调用。
