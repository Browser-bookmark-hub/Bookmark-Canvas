# 画布页面生命周期与后台 dirty 边界

整理日期：2026-07-14

规划基线提交：`6828baf3beb25db9ca42718a47e053b206054be5`

## 一句话结论

后台 dirty 已经被收窄为“没有任何可连接的画布前台 Port 时”的后台兜底信号。它只判断永久书签树是否可能在纯后台期间领先 BCS，不负责修复前台页面休眠、冻结、过期内存、自动保存覆盖等问题。这一部分在规划基线提交 `6828baf3beb25db9ca42718a47e053b206054be5` 之后已经做了主干实现和 Port 断线打磨。

下一阶段真正要补的是 `history.html` 的页面生命周期恢复边界：普通 tab 和侧边栏 iframe 如果从 `frozen` / sleeping 状态恢复，浏览器不会自动刷新，旧 JS 内存会继续运行。`resume`、`pageshow.persisted` 这类事件不能直接等同于“数据一定过期”，但它们足以说明页面是旧 JS 上下文恢复。首版处理要和现有全量覆盖/恢复导入保持同一安全策略：先同步阻断旧页面写回 BCS、取消 pending 写入，再刷新当前 `history.html`。普通 tab 刷新当前 tab；侧边栏里只刷新 iframe。

侧边栏的彻底销毁、丢弃和弱休眠要分开看：如果侧边栏壳或 iframe 已经被浏览器真正销毁，页面内 JS 已经不存在，我们无法先禁写或主动 reload，只能依赖浏览器在需要展示侧边栏时重新创建扩展页面。对数据安全来说，重新创建就是冷启动，会重新读取 BCS；对可用性来说，如果浏览器容器异常没有重建，页面内代码也已经没有执行机会，只能由浏览器或用户重新打开侧边栏恢复。我们能主动兜住的是“JS 还存在但旧上下文恢复”的弱休眠路径，也就是 `resume` / `pageshow.persisted`。

本文档的最终工程判断是：**强休眠 / 丢弃 / 销毁走冷启动，不二次刷新；弱休眠 / bfcache 旧上下文恢复由 `history.js` 第一时间禁写并刷新。Port 只管后台 dirty 边界，不管旧内存可信度。**

## 当前已完成的代码事实

### 后台 dirty 已限制在“无活跃前台 Port”

[background.js](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/background.js:33) 当前维护：

- `CANVAS_FOREGROUND_ACTIVE_PORT = 'bookmark-canvas-foreground-active'`。
- `activeForegroundPorts = new Set()`。
- `registerCanvasForegroundActivePortListener()` 监听 `runtime.onConnect`。
- 只有端口名匹配 `bookmark-canvas-foreground-active` 的连接才加入 `activeForegroundPorts`。
- `port.onDisconnect` 会移除端口，并读取一次 `runtime.lastError`，避免 Chrome 控制台出现 unchecked lastError 噪声。

[registerCanvasPermanentBookmarkDirtyListener()](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/background.js:171) 中，所有 Chrome 书签事件进入同一个 `mark(reason)`。当前关键边界是：

```javascript
if (activeForegroundPorts.size > 0) return;
markCanvasPermanentBookmarksDirty(reason).catch(() => { });
```

这意味着：

- 任意画布前台 Port 存活时，后台不再写 `canvasPermanentBookmarksDirty`。
- 没有画布前台 Port 时，后台把 `bookmarks.onCreated`、`onRemoved`、`onMoved`、`onChanged`、`onChildrenReordered`、`onImportEnded` 记录为永久书签 dirty。
- dirty 仍然只是“Chrome 书签树可能领先 BCS 永久树”的兜底标记，不参与临时栏目、Markdown、连接线、布局等画布状态。

### 前台画布页面已建立 Port，并做了断线打磨

[history.js](/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/history.js:1784) 当前维护：

- `FOREGROUND_ACTIVE_PORT_NAME = 'bookmark-canvas-foreground-active'`。
- `setupForegroundActivePort()` 通过 `browserAPI.runtime.connect()` 建立前台存活 Port。
- `DOMContentLoaded` 初始化尾部会调用 `setupForegroundActivePort()`。
- `onDisconnect` 中读取 `browserAPI.runtime.lastError`，消费 Chrome 的 unchecked lastError 警告。
- 如果错误信息包含 `context invalidated`，说明扩展上下文已经失效，前台页面成为孤儿页面，停止重连，避免开发期扩展 reload 后每 2 秒刷控制台。
- 断线重连采用退避：首次 100ms，失败后倍增，最高 2000ms；连接成功后重置回 100ms。

这个 100ms 首次重连的意义是缩短 MV3 service worker 闲置销毁后，前台 Port 尚未恢复、后台误以为没有前台的时间窗口。

## 画布前台定义

只把真正运行画布应用的 `history.html` 文档算作画布前台。不要把普通 tab 是否前台绑定到长期 URL 字面量；当前初始化可能清理 `view=canvas` 参数，真正判断点是该文档加载 `history.js` 并运行画布应用：

- 普通标签页：加载 `history_html/history.html` 的画布应用页面。
- 侧边栏 iframe：`history_html/history.html?view=canvas&sidepanel=1`。

不算画布前台：

- `panel-shell.html`，它只是侧边栏壳。
- `sidebar.html`，它只是入口或配置页。
- token 配置、帮助、guide、只读说明页。
- 默认打开窗口、标签页管理、设置类扩展页面。

原因很简单：真正会持有画布状态、前台书签监听、BCS 读写逻辑的是 `history.js`，而不是侧边栏壳或配置页。

## 浏览器生命周期事实

### 官方事实先校准

资料核对日期：2026-07-14。

官方文档能支撑的事实只有这些，计划书不能往外多承诺：

- Chrome Page Lifecycle API 把页面区分为 `active`、`passive`、`hidden`、`frozen`、`terminated`、`discarded` 等状态。`freeze` / `resume` 是页面被冻结和恢复时可观察的事件；`discarded` 发生时页面 JS 已经没有机会运行，只能在下一次加载后通过 `document.wasDiscarded` 判断上一轮是否被丢弃。
- Chrome tabs API 暴露 `discarded` 和 `frozen` 等 tab 状态。`discarded` 的核心含义是 tab 内容已从内存卸载，但 tab 仍保留在标签栏；再次激活时内容重新加载。`frozen` 的核心含义是内容仍在内存中，但被冻结期间不能执行任务，恢复后继续原上下文。
- Chrome sidePanel API 和 Edge Sidebar 文档说明的是浏览器 UI 容器如何承载扩展页面，以及如何配置默认页面；它们没有给出“侧边栏扩展页面永远保活”或“侧边栏被销毁后一定以 tab discard 同样方式自动恢复”的业务保证。
- 扩展 MV3 service worker 会被浏览器终止和重启，官方要求扩展不要依赖 service worker 全局变量长期存在。因此后台 `activeForegroundPorts` 只能作为当前 service worker 生命周期内的前台连接事实，不能当成页面数据安全证明。

所以本项目的判断不能写成“侧边栏一定自动刷新”或“`resume` 一定代表数据旧了”。更准确的说法是：如果浏览器已经给了新文档加载，我们按冷启动处理；如果浏览器恢复的是旧文档上下文，我们按不可信旧内存处理。

### 普通标签页：Discarded 与 Frozen 是分水岭

Chrome tabs API 对 `discarded` 的定义是：页面内容已从内存卸载，但 tab 仍在标签栏中；下次激活时内容会重新加载。这个状态在生命周期意义上是安全的，因为它不携带旧 JS 内存；重新加载后按冷启动路径从 BCS 读取，并在 dirty 或启动同步策略要求时校准 Chrome 永久书签树。

Chrome tabs API 对 `frozen` 的定义是：页面内容仍在内存里，但不能执行任务，包括事件处理器和 timers；激活时解冻。这个状态对我们危险，因为浏览器不会自动刷新页面，旧 JS 内存会带着旧画布状态继续运行。

Page Lifecycle API 也把 `frozen` 和 `discarded` 区分开：`freeze` / `resume` 是可观察的生命周期事件；`discarded` 本身不可在被丢弃时运行 JS，只能在重新加载后通过 `document.wasDiscarded` 判断上一轮是否被丢弃。

### Page Lifecycle 状态到本项目动作的映射

| Page Lifecycle 状态 | 浏览器含义 | 对本项目的风险 | 我们的动作 |
| --- | --- | --- | --- |
| active / passive | 页面正常可见或仍可运行 | 正常 | 正常运行 |
| hidden | 页面不可见，但还没冻结 | 不等于休眠恢复 | 首版不特殊处理，不 reload |
| frozen | 页面被冻结，JS/timer 暂停，内存保留 | 旧上下文恢复后可能抢写 BCS | `resume` 时同步禁写、取消 pending、reload 当前 `history.html` |
| terminated | 页面正在卸载或已关闭 | 当前上下文结束 | 不处理；下次打开按冷启动 |
| discarded | 页面被浏览器丢弃，内存清空 | 低，浏览器会重新加载 | `document.wasDiscarded === true` 时只记录冷启动，不二次 reload |
| bfcache 恢复 | 浏览器恢复旧页面上下文 | 旧上下文恢复 | `pageshow.persisted === true` 时同步禁写、取消 pending、reload 当前 `history.html` |

所以判断标准不是“页面类型”，而是“浏览器是否已经给了冷启动”。已经冷启动的情况不二刷；旧上下文恢复的情况由 `history.js` 接管。

### 侧边栏：壳、iframe 与浏览器容器要分开看

当前侧边栏结构是：

```text
浏览器窗口
  -> side panel 浏览器 UI 容器
    -> panel-shell.html
      -> iframe: history_html/history.html?view=canvas&sidepanel=1
```

所以生命周期判断要落在 iframe 内的 `history.html`：

- 侧边栏关闭后重开：通常 iframe 被销毁，再次打开时重新创建并 reload，安全。
- 宿主窗口、侧边栏壳或 iframe 被浏览器 discard / destroy：如果旧 JS 上下文已经消失，业务代码无法在旧页面里禁写或 reload；后续能否展示取决于浏览器按 side panel 配置重建容器。重建成功后 iframe 是冷启动；未重建属于浏览器 UI 容器不可控边界。
- iframe 被 freeze / sleeping 后恢复：浏览器可能只解冻旧 iframe，不刷新，危险。

侧边栏壳是否存在不等于画布前台安全。只有 iframe 中的 `history.js` 完成冷启动或恢复检查后，才可认为画布状态可靠。`panel-shell.html` 不应持有画布数据，也不应参与 BCS 写入仲裁。

这里不要把侧边栏想成后台保活页。Chrome / Edge 的 side panel / sidebar 是一个展示扩展页面的浏览器 UI 容器，不承诺其中的扩展页面永远保活，也不承诺每次恢复都必然走冷启动。对一个正在可见的侧边栏来说，彻底销毁的概率通常低于冻结恢复；但只要真的销毁，旧页面内的任何 guard、timer、Port、reload 逻辑都已经消失。

因此侧边栏恢复边界是：

- 浏览器重建了壳和 iframe：这是冷启动，直接从 BCS 重新读，不二次 reload。
- 浏览器只是解冻旧 iframe：这是弱休眠恢复，由 iframe 内 `history.js` 同步禁写、取消 pending，再 reload 当前 iframe。
- 如果浏览器容器异常地没有重建已销毁的侧边栏页面：页面内 JS 无法修复，只能由用户关闭/重新打开侧边栏或等待浏览器自身恢复。这是浏览器 UI 容器兜底，不是业务代码可保证的路径。

换句话说，普通 tab 的 `discarded -> 点击 tab -> 自动 reload` 是 Chrome tabs API 层能明确描述的路径；侧边栏不能照搬成同等承诺。侧边栏的可执行策略是：只要 `history.html` 被重新创建，就冷启动读 BCS；只要旧 iframe 还活着并触发 `resume` / `pageshow.persisted`，就由 iframe 内 `history.js` 自己禁写并 reload。

## 唤醒后的风险对照表

| 页面类型 | 浏览器状态 | 唤醒动作 | 页面状态 | 数据覆盖风险 | 应对 |
| --- | --- | --- | --- | --- | --- |
| 普通 tab | Discarded | 自动 reload | 冷启动，数据重新读取 | 低 | 正常加载 |
| 普通 tab | Frozen / sleeping | 解冻，不 reload | 旧 JS 内存复苏 | 中/高，取决于休眠期间是否有外部写入 | 先阻断写入并取消 pending，再刷新当前 tab |
| 普通 tab | pageshow.persisted / bfcache | 恢复旧上下文，不走完整冷启动 | 旧 JS 内存复苏 | 中/高 | 先阻断写入并取消 pending，再刷新当前 tab |
| 普通 tab | Terminated / 关闭后重开 | 旧页面结束，新页面加载 | 冷启动，数据重新读取 | 低 | 正常加载 |
| 侧边栏 | 关闭后重开 | iframe 重新创建 | 冷启动，数据重新读取 | 低 | 正常加载 |
| 侧边栏 | 宿主窗口 / 壳 / iframe discarded 或 destroyed | 旧 JS 不能运行；重建时机取决于浏览器 UI 容器 | 重建成功后冷启动，数据重新读取 | 低，未重建时属于可用性不可控 | 正常加载；不做二次 reload |
| 侧边栏 | iframe frozen / sleeping | 解冻，不 reload | 旧 iframe 内存复苏 | 中/高，取决于休眠期间是否有外部写入 | iframe 内先阻断写入并取消 pending，再刷新 iframe |
| 侧边栏 | iframe pageshow.persisted / bfcache | 恢复旧 iframe 上下文 | 旧 iframe 内存复苏 | 中/高 | iframe 内先阻断写入并取消 pending，再刷新 iframe |

## 多窗口分散时的真实危险

典型场景：

- 窗口 A：普通标签页，正在排版，状态最新。
- 窗口 B：普通标签页，闲置 1 小时，被浏览器 frozen。
- 窗口 C：侧边栏 iframe，闲置 2 小时，被浏览器 frozen。

用户在窗口 A 修改画布后，再点击窗口 B：

1. 浏览器解冻窗口 B，但不会自动刷新。
2. 窗口 B 的 JS 内存仍是 1 小时前的画布状态。
3. 如果窗口 B 的自动保存、blur/focus 保存、debounced save 或延迟任务继续执行，它可能把旧状态写回 BCS。
4. 结果是窗口 A 最近 1 小时的新排版被窗口 B 的过期内存覆盖。

这不是后台 dirty 能解决的问题。后台 dirty 只处理“没有前台处理 Chrome 书签事件”的永久书签兜底；它无法判断某个前台页面的画布内存是否过期。

注意：`resume` 本身不证明窗口 A 一定修改过数据。它只证明窗口 B 是旧 JS 上下文恢复。首版不做复杂判别，按“无法证明安全”处理：先禁写、取消旧 pending 写入，再刷新当前 `history.html`。后续如果要减少刷新，可以在禁写之后加 BCS / dirty / 信号版本检查；能证明未变化才继续运行。

## 当前后台 dirty 边界

### 有活跃前台 Port

- 后台忽略 Chrome 书签事件，不写 dirty。
- 永久书签变化继续交给前台 `history.js` 现有监听处理。
- 前台已有逻辑可做小批量增量 patch、大批量或异常回退全量同步。

### 没有活跃前台 Port

- 后台监听 Chrome 书签事件并写 dirty。
- 下次任意 `history.html` 冷启动时，前台读取 dirty。
- 如果 dirty 存在，前台优先通过 `CanvasProtocolBridge.syncPermanentMainTreeFromChromeBookmarks` 从 Chrome 书签树同步永久栏目到 BCS；同步成功后按 version 清 dirty，失败路径不应假装 dirty 已解决。

### Port 不是生命周期安全证明

Port 只能证明“当前 service worker 内存里存在一个连接中的画布前台上下文”。它不能证明：

- 页面没有 frozen。
- 页面内存中的画布状态是最新的。
- 页面已经处理完恢复检查。
- 页面没有错过 `storage.onChanged`、BroadcastChannel 或 BCS 信号。

因此，当前 Port 机制只解决后台 dirty 的误写边界，不解决 frozen 页面复苏后的旧内存写回风险。

还有一个交叉边界要明确：如果某个 `history.html` 的 Port 在 service worker 当前生命周期内仍被认为连接中，但页面随后进入 frozen，后台会按规则不写 dirty，而被冻结的前台也可能暂时处理不了 Chrome 书签事件。弱休眠恢复因此不能只看 dirty 标记；恢复后的冷启动路径需要重新读取 BCS，并在 dirty、启动同步策略或后续版本检查要求时校准永久书签树。

## 当前已打磨的 Port 边界

### lastError 消费

前台和后台的 Port `onDisconnect` 都读取一次 `runtime.lastError`。这不是业务判断，而是 Chrome 扩展 API 的控制台卫生要求：Port 断开、后台重启、页面卸载等场景可能把错误挂在 `lastError` 上，不读取会产生 unchecked 警告。

### context invalidated 停止重连

开发期 reload 扩展或更新扩展后，已经打开的 `history.html` 可能变成旧扩展上下文。此时继续 `runtime.connect()` 会抛出 `Extension context invalidated` 相关错误。

当前策略：

- 发现 `context invalidated` 后设置停止标记。
- 不再重连。
- 不继续打印重连失败日志。
- 用户刷新页面后进入新扩展上下文，再重新建立 Port。

### 快速首连和退避

MV3 service worker 可能在闲置后被 Chrome 终止。官方生命周期文档要求扩展 service worker 能承受意外终止，因为全局变量会丢失。

当前策略：

- 断线后 100ms 尝试首次重连。
- 连续失败时退避到 200ms、400ms、800ms、1600ms、最高 2000ms。
- 成功连接后重置回 100ms。

这能明显缩短“service worker 被唤醒但前台 Port 尚未恢复”的误判窗口，但不能替代后续的 frozen 恢复检查。

## 下一阶段必须补的弱休眠恢复方案

目标：任意 `history.html` 从旧 JS 上下文恢复时，恢复协调回调开始后必须立即暂停写入、取消可控 pending，并通过 reload 丢弃旧内存。`resume`、`pageshow.persisted` 只负责触发恢复协调，不直接代表“数据必然过期”。首版恢复动作采用页面刷新，因为它和现有全量覆盖/恢复导入路径一致，能一次性清掉旧内存、旧 DOM、旧 timer、旧 debounce。

### 触发入口

统一收敛到一个恢复协调函数，例如 `scheduleCanvasLifecycleReconcile(reason, confidence)`。入口分级：

- 高置信恢复信号：`document.addEventListener('resume', ...)`。
- 高置信恢复信号：`window.addEventListener('pageshow', ...)` 且 `event.persisted === true`。
- 冷启动判定：页面 load 时检查 `document.wasDiscarded`。
- 冻结前标记：`document.addEventListener('freeze', ...)` 只记录页面进入冻结和当前版本信号，不做 reload。

要求：

- `resume` 是强信号，说明旧 JS 上下文从 frozen 恢复；它不是“数据一定过期”的证明。
- `document.wasDiscarded === true` 表示浏览器已经 reload，按冷启动处理，不做二次 reload。
- `pageshow.persisted === true` 可作为 bfcache / frozen 恢复路径之一，按高置信恢复处理。
- 普通 `focus` 和普通 `visibilitychange` 不是休眠层级判断，首版不纳入 reload 触发入口。

### 生命周期监听的工程优先级

这里的“高优先级”不是浏览器事件系统里的 listener priority；Web API 不提供这种优先级控制。我们能控制的是注册位置、回调顺序和写入口防线：

- `freeze`、`resume`、`pageshow.persisted`、`document.wasDiscarded` 的监听和冷启动检查应在 `history.js` 模块加载早期完成，早于自动保存、拖拽保存、blur/focus 保存等业务写入逻辑开始调度。
- `resume` / `pageshow.persisted` 回调进入后的第一条同步业务语句必须设置页面级 BCS 写入暂停 guard。
- 所有 BCS 写入入口、debounced flush、auto-save、blur/focus save 在真正写入前都必须先检查该 guard；不能只依赖恢复回调里取消 timer。
- 普通 tab 和侧边栏 iframe 走同一套 `history.js` 监听。侧边栏壳 `panel-shell.html` 不承担画布数据生命周期裁决。

因此实现目标是“生命周期恢复保护在写入链路前置”，而不是给事件监听器设置一个不存在的浏览器级优先级。

### 为什么不使用 focus / visibilitychange 触发恢复

`focus` / `visibilitychange` 的误杀概率很高，因为它们不是 Page Lifecycle 的休眠 API，只是普通可见性和焦点事件。用户普通切桌面、切微信、切普通 tab 再回来都会触发它们。

首版只用专门的生命周期信号：

- `freeze`：页面将被冻结，只做同步标记和轻量状态记录。
- `resume`：页面从冻结中恢复，走禁写 + 取消 pending + reload。
- `pageshow.persisted`：页面从 bfcache 等旧上下文恢复，走同一套禁写 + reload。
- `document.wasDiscarded`：浏览器已经自动 reload，按冷启动处理，不二次刷新。

如果后续发现某个 Chromium 变体漏发 `resume`，再考虑把 `focus` / `visibilitychange` 作为兼容 fallback；fallback 也只能先做版本检查，不能直接 reload。

### 首版弱休眠处理顺序

高置信恢复协调函数的顺序必须固定：

1. 在恢复事件回调的同步第一行设置页面级 BCS 写入暂停 guard。
2. 同步取消或冻结当前页面已排队的 debounce save、auto-save、blur/focus save，例如 pending BCS 写入。
3. 设置 reload guard，防止同一轮 `resume`、`pageshow.persisted` 等恢复事件重复刷新。
4. 调用 `window.location.reload()` 刷新当前 `history.html`。

“同步第一行”不是“第一秒”。不能等 `setTimeout`，也不能先做异步版本读取。JS 事件循环里，只要我们的 `resume` / `pageshow.persisted` 回调已经开始执行，在这个回调返回前，其他 timer/debounce 回调不会插进来。因此 guard 必须在回调最前面同步设置，随后再清 pending timer。

这个顺序的核心不是“看到 resume 就证明数据已经过期”，而是“看到 resume 后无法保证旧页面不会抢写，所以先禁止旧写入，再用 reload 走冷启动”。如果某个旧写入已经在恢复事件回调前完成，我们无法回溯拦截；本方案拦截的是恢复回调开始后同一轮及后续任务里的旧内存写入。如果页面在普通 tab 中，刷新的是当前 tab；如果页面在侧边栏 iframe 中，刷新的是 iframe，不会打开新 tab。

### 后续优化：禁写后原地重拉 BCS

当前代码已经有从 BCS 重拉并应用的基础能力：

- `__loadCanvasTempStateFromBcs()` 从 BCS 分片读取完整画布状态。
- `__queueCanvasTempStateBundleReloadFromBcs()` 是现有 BCS bundle 重拉并应用到当前页面的队列入口，不是浏览器级 `window.location.reload()`。
- `__applyCanvasTempStateObject()` 能把状态应用回 `CanvasState`。

所以后续可以做“不刷新页面”的优化，但前置条件仍然是先禁写和取消 pending 写入。优化版顺序是：

1. 设置 BCS 写入暂停 guard。
2. 取消 pending BCS 写入和页面内旧 debounce 保存。
3. 从 BCS 全量重拉。
4. 原地覆盖 `CanvasState` 和 DOM。
5. 成功后解除 guard；失败、状态复杂或无法证明完整时 fallback 到 `window.location.reload()`。

首版不建议直接做这个优化，因为需要同时清理旧 timer、编辑态、拖拽态、最大化态、DOM 局部缓存、pending save 等运行态。现有全量覆盖/恢复导入已经采用写入真相源后 reload 的安全策略，弱休眠首版应复用同样的工程选择。

### 写入暂停

高置信恢复协调开始的同步第一步必须是设置页面级写入暂停 guard。guard 生效后：

- 自动保存不能写 BCS。
- debounced save 不能 flush 到 BCS。
- blur/focus/save timers 不能写 BCS。
- 永久栏目 patch 可以暂停或排队，等冷启动后重新由最新数据驱动。

如果第一版选择 `location.reload()`，那么 guard 只需要覆盖 reload 前的极短窗口。重点是防止旧任务在 reload 调度前抢跑。

### 恢复动作

首版恢复动作固定为刷新当前 `history.html`：

刷新动作本身保持简单：

```javascript
window.location.reload();
```

理由：

- 不尝试补齐休眠期间错过的增量。
- 不依赖跨窗口广播完整送达。
- 不做复杂冲突合并。
- 冷启动从 BCS 重新读取画布状态，并在 dirty 或启动同步策略要求时校准 Chrome 永久书签树。
- 与现有全量覆盖/恢复导入路径一致，高风险状态下不强行原地重建复杂 UI。

### 防双刷新

必须有短周期 reload guard：

- `lifecycleReloadPending = true` 后，同一轮 `resume`、`pageshow.persisted` 不再重复 reload。
- 首版 reload 入口只来自 `resume` 和 `pageshow.persisted`；`focus` / `visibilitychange` 不触发 reload。
- 内存 guard 用于同一旧上下文内防重复；`sessionStorage` 用于 reload 后短时间防止同一恢复链路二次触发。
- 如果 `document.wasDiscarded === true`，只记录“来自 discard 冷启动”，不再因为后续 `pageshow` 二次 reload。

## 不做的事

- 不让后台 dirty 接管前台 frozen 恢复。
- 不把 `panel-shell.html`、`sidebar.html`、配置页、帮助页算作画布前台。
- 不用 Port 判断页面数据是否最新。
- 不为 frozen 页面补事件队列。
- 不引入 single writer。
- 不在本阶段做复杂 merge。
- 不为了保持 service worker 常驻而引入 heartbeat。

## 验证清单

后台 dirty 边界：

- 打开任意普通画布 tab，手动改 Chrome 书签，后台不应写 dirty。
- 打开侧边栏画布 iframe，手动改 Chrome 书签，后台不应写 dirty。
- 关闭所有画布 tab 和侧边栏 iframe 后，手动改 Chrome 书签，后台应写 dirty。
- 下次打开画布时，应从 Chrome 书签树同步永久栏目并清 dirty。

Port 稳定性：

- 重启或闲置唤醒 service worker 后，前台应快速重连。
- 扩展 reload 后，旧页面不应无限重连刷 `context invalidated`。
- Port 断开场景不应出现 unchecked `runtime.lastError` 噪声。

下一阶段弱休眠恢复：

- frozen 普通 tab 被激活后，应先阻断旧写入、取消 pending，再刷新当前 tab。
- frozen 侧边栏 iframe 收到 `resume` 或 `pageshow.persisted` 后，应在 iframe 内执行同一套流程；刷新时只刷新 iframe，不打开新 tab。
- 原地 BCS 重拉只作为后续优化；首版不要求证明版本未变后继续运行。
- discarded tab 重新激活后，由浏览器 reload，页面不应二次 reload。
- 多窗口中旧 frozen 页面恢复时，不得覆盖另一个活跃窗口刚写入的 BCS 状态。

## 参考资料

- Chrome Page Lifecycle API: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Chrome tabs API: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome extension message passing / Port lifetime: https://developer.chrome.com/docs/extensions/develop/concepts/messaging#port-lifetime
- Chrome extension service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome sidePanel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Microsoft Edge Sidebar extensions: https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/developer-guide/sidebar
