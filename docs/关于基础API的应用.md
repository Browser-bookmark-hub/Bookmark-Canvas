# 关于基础书签 API 的应用与前后台监听设计

本篇文档详细整理了 Bookmark Canvas 扩展对 Chrome/Edge 浏览器原生书签 API 各个事件的监听方案、浏览器触发途径以及前后台协同处理机制。

---

## 1. 原生书签事件前后台监听与处理对照表

| 书签 API 事件 | 浏览器触发途径 | 后台处理方式 (`background.js`) | 前台处理方式 (`history.js`) |
| :--- | :--- | :--- | :--- |
| **`onCreated`**<br>(创建) | 用户新建书签/文件夹，或通过 API 创建。 | 如果无活跃前台，调用 `mark('created')` 将状态标脏。 | 进入防抖事件队列，默认进行**增量更新**（DOM Patch & BCS 增量保存）。 |
| **`onRemoved`**<br>(删除) | 用户删除书签/文件夹。 | 如果无活跃前台，调用 `mark('removed')` 将状态标脏。 | 进入防抖事件队列，进行**增量删除**（DOM Patch & BCS 增量保存）。 |
| **`onChanged`**<br>(修改) | 用户重命名书签、修改书签 URL。 | 如果无活跃前台，调用 `mark('changed')` 将状态标脏。 | 先清空防抖队列，立即进行**增量修改**（更新节点标题/URL 并保存到 BCS）。 |
| **`onMoved`**<br>(移动) | 用户在书签栏内拖拽移动书签、改变层级或顺序。 | 如果无活跃前台，调用 `mark('moved')` 将状态标脏。 | 进入防抖事件队列，进行**增量移动**处理。 |
| **`onChildrenReordered`**<br>(子节点重排) | 浏览器自带的“**按名称排序（Sort by name）**”操作。 | 如果无活跃前台，调用 `mark('children-reordered')` 将状态标脏。 | **不支持增量**，直接触发**全量同步**：从 Chrome 重新获取完整书签树同步到 BCS 并重新渲染。 |
| **`onImportBegan`**<br>(开始导入) | 浏览器导入 HTML 书签文件开始。 | 不监听（由 `onImportEnded` 统一收尾标脏）。 | 激活书签批量更新静音锁（`beginBookmarkBulkMute`），在此期间**暂停增量同步渲染**，避免界面频繁闪烁或卡顿。 |
| **`onImportEnded`**<br>(结束导入) | 浏览器导入 HTML 书签文件结束。 | 如果无活跃前台，调用 `mark('import-ended')` 将状态标脏。 | 解除静音锁，直接触发**全量同步**（从 Chrome 书签树同步到 BCS 并重新渲染）。 |

---

## 2. 前后台协同机制深度剖析

### 2.1 增量更新与全量更新的边界

在前台（`history.js`）活跃时，系统对不同的事件采取了差异化的处理策略，以兼顾性能与数据一致性：

* **增量更新（Created / Removed / Moved / Changed）**：
  * **背景**：正常的日常编辑（如新增一个书签、拖拽换位、改个名字）频率较低，且涉及的数据节点极少。
  * **处理**：前台捕获后，先进入一个短暂的防抖队列（静默期约 220ms），再局部 Patch DOM 节点，并以增量方式更新 BCS（Bookmark Canvas Storage）数据库。这保障了用户界面的即时响应和零闪烁。
* **全量降级（ChildrenReordered / ImportEnded）**：
  * **背景**：排序（按名称排序）会使同一个目录下的数十上百个子节点顺序同时发生改变；导入书签更是会瞬时写入成千上万个节点。如果全部走增量 Patch，会导致高频的数据库写冲突与渲染线程卡死。
  * **处理**：前台检测到这两类事件时，直接舍弃增量计算，启动全量同步机制。它会向 Chrome 原生 API 重新拉取整棵书签树，全量复写到 BCS，并重绘 UI 视图。

### 2.2 后台写脏（Dirty）与前台清脏的闭环

为了避免在前后台同时活跃时产生重复同步的开销，系统建立了基于 **Port 计数器** 的拦截机制：

1. **前台活跃时**：
   * 前台页面（标签页或侧边栏 Iframe）加载时会通过 `chrome.runtime.connect` 与后台建立长连接通道。
   * 后台 Service Worker 内存中的 `activeForegroundPorts` 计数器 $> 0$。
   * 此时，后台的书签事件监听器在触发时检测到有活跃前台，直接**提前退出（Return）**，不写 dirty 状态。所有的书签树维护完全由活跃的前台自己通过原生 API 实时更新并同步到 BCS。
2. **前台关闭（纯后台）时**：
   * 所有前台 Port 均已断开，后台 `activeForegroundPorts` 计数器 $= 0$。
   * 当用户使用原生书签管理器、其它同步插件或同步工具修改了书签时，后台 Service Worker 监听到变更。
   * 由于计数器为 0，后台会向 `chrome.storage.local` 写入脏标记 `canvasPermanentBookmarksDirty = true`，记录此次修改的版本号和时间戳。
3. **前台重新打开时（清脏）**：
   * 任意前台（标签页或侧边栏）冷启动打开。
   * 在初始化时主动读取 `canvasPermanentBookmarksDirty` 标记。
   * 若为 `true`，前台自动拉取一次 Chrome 书签树以进行**全量覆盖同步**，同步成功后调用 `clearCanvasPermanentBookmarkDirtyState` 将 dirty 标记擦除，重新进入实时监听状态。

### 2.3 批量导入静音锁机制

当浏览器导入大批量的书签时，原生 API 会在极短时间内抛出海量的 `onCreated` 事件。
* 在 `onImportBegan` 触发时，前台调用 `beginBookmarkBulkMute` 锁住 UI 渲染，所有中途收到的 `onCreated` 事件只记账，不刷新界面，不更新本地数据库。
* 在 `onImportEnded` 触发时，前台释放锁，并一次性进行 Chrome -> BCS 的全量数据同步。这保护了浏览器主线程，防止扩展在导入海量书签时崩溃或引起浏览器假死。
