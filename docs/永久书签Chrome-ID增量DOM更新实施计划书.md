# 永久书签 Chrome ID 增量 DOM 更新实施计划书

> 目标：把永久栏目普通增删改移从“缓存增量 + 视觉整树重渲染”升级为“Chrome ID 驱动的数据增量 + DOM 增量 patch”，让一万级书签场景下的单个操作不再触发整棵永久树视觉替换。

## 1. 核心结论

当前永久栏目最大收益的结构性优化不是继续加强全量刷新遮罩，而是新增一层 **Chrome ID 增量 DOM 更新层**。

核心规则：

```text
长期真相：Chrome 书签树 + BCS 永久存储。
短期视觉：当前页面里的 DOM。

打开 / 恢复 / 导入 / 批量 / 异常：拉整树并整树渲染。
页面可见 + 单个或少量增删改移：按 Chrome ID 增量更新 BCS、缓存和当前 DOM。
```

这是一项小型结构性改变，但收益最大：

```text
一万个书签中移动 1 个书签：
当前：主体 + 副本共享树重渲染，最终 replaceChildren。
目标：只移动对应 Chrome ID 的 .tree-node。
```

## 2. 当前代码事实

### 2.1 插件自己操作永久栏目

当前插件内部永久书签操作在以下文件中实现：

- `history_html/bookmark_tree_context_menu.js`
- `history_html/bookmark_tree_drag_drop.js`

当前流程是：

```text
插件前端操作永久栏目主体/副本
-> 先改 BCS
-> 再调用 chrome.bookmarks API
-> Chrome API 成功
-> Chrome bookmarks 事件监听器收到 onCreated/onRemoved/onChanged/onMoved
-> 监听器按统一外部事件路径处理
```

具体事实：

- 新增：`preparePermanentCreateNodeInBcs()` 先写入 `pending:id`，`chrome.bookmarks.create()` 返回真实 Chrome ID 后，`commitPermanentCreatedNodeInBcs()` 把 pending ID 替换成真实 Chrome ID。
- 删除：`removePermanentNodeFromBcs()` 先删 BCS，再调用 `chrome.bookmarks.remove()` 或 `chrome.bookmarks.removeTree()`。
- 修改：`updatePermanentNodeInBcs()` 先改 BCS，再调用 `chrome.bookmarks.update()`。
- 移动：`movePermanentNodeInBcs()` 先改 BCS，再调用 `chrome.bookmarks.move()`。

当前代码没有严格区分：

```text
这个 Chrome bookmarks 事件来自插件自己操作
还是来自 Chrome 书签管理器 / 第三方插件 / 浏览器同步
```

### 2.2 Chrome 事件监听路径

当前事件监听在 `history_html/history.js` 的 `setupBookmarkListener()` 中。

普通单个事件路径：

```text
onCreated -> enqueueBookmarkMutationEvent -> handleBookmarkCreateRealtime
onRemoved -> enqueueBookmarkMutationEvent -> handleBookmarkRemoveRealtime
onMoved   -> enqueueBookmarkMutationEvent -> handleBookmarkMoveRealtime
onChanged -> flushPendingBookmarkMutationEvents -> applyIncrementalChangeToCachedCurrentTree
```

在 Canvas 可见时，四类事件都会进入缓存增量：

```js
applyIncrementalCreateToCachedCurrentTree(id, bookmark)
applyIncrementalRemoveFromCachedCurrentTree(id, removeInfo)
applyIncrementalChangeToCachedCurrentTree(id, changeInfo)
applyIncrementalMoveToCachedCurrentTree(id, moveInfo)
```

这说明当前项目已经有 **缓存层增量**。

### 2.3 视觉 DOM 层整树替换问题

实施前，单个事件在缓存增量之后继续调用：

```js
schedulePermanentTreeSharedMutationRefresh('onCreated')
schedulePermanentTreeSharedMutationRefresh('onRemoved')
schedulePermanentTreeSharedMutationRefresh('onChanged')
schedulePermanentTreeSharedMutationRefresh('onMoved')
```

调用链是：

```text
schedulePermanentTreeSharedMutationRefresh
-> __flushPermanentTreeSharedMutationRefresh
-> refreshPermanentTreeSharedViewsAfterMutation
-> __renderPermanentTreeSharedViews
-> __renderPermanentTreeIntoTree
-> tree.replaceChildren(sourceFragment)
```

`__renderPermanentTreeIntoTree()` 中明确执行：

```js
tree.replaceChildren(sourceFragment);
```

实施前，以下 reason 会强制渲染：

```js
onCreated
onRemoved
onChanged
onMoved
mutation
bulk-add-remove
browser-import
```

因此实施前的准确结论是：

```text
缓存层有 Chrome ID 增量。
视觉 DOM 层没有 Chrome ID 增量。
页面可见时，普通单个增删改移最终仍会让永久栏目主体和副本走共享树 replaceChildren。
```

实施后，普通单个或少量增删改移会先尝试 Chrome ID 增量 DOM patch。

```text
DOM patch 成功：不再调度 schedulePermanentTreeSharedMutationRefresh。
DOM patch 失败或批量超过阈值：保留整树刷新兜底。
```

### 2.4 BCS 同步层已接入事件增量

实施前，`history_html/history.js` 中普通事件会调用：

```js
schedulePermanentMainStorageSyncFromChrome('onCreated')
schedulePermanentMainStorageSyncFromChrome('onRemoved')
schedulePermanentMainStorageSyncFromChrome('onChanged')
schedulePermanentMainStorageSyncFromChrome('onMoved')
```

该函数最终调用：

```js
bridge.syncPermanentMainTreeFromChromeBookmarks(...)
```

在 `history_html/bookmark_canvas_module.js` 中，`__syncPermanentMainTreeFromChromeBookmarks()` 调用：

```js
__getPermanentChromeTreeForStorage()
```

该路径会读取 Chrome 完整书签树。

实施后，普通事件路径已调整为：

```text
created/removed/moved：统一事件队列 flush 时先批量调用 applyPermanentBookmarkEventsToBcsIncremental。
changed：先 flush 结构事件队列，再单独调用 applyPermanentBookmarkEventsToBcsIncremental。
BCS 增量成功后，不再安排普通事件的 Chrome -> BCS 整树同步。
BCS 增量失败、桥接 API 缺失、批量阈值、浏览器导入、打开/恢复/手动刷新等场景继续走整树同步兜底。
```

## 3. 为什么 DOM 增量是合理的

DOM 不是长期真相。

以下场景都会重新生成 DOM：

- 关闭侧边栏后重新打开。
- 关闭标签页后重新打开。
- 浏览器休眠恢复。
- 浏览器关闭后重新打开。
- Canvas 首次进入。
- 永久栏目首次渲染。

所以 DOM 只负责当前页面可见期间的视觉表达。

长期一致性由以下两层保证：

```text
Chrome bookmarks：浏览器真实书签树。
BCS：Bookmark Canvas 的永久存储快照。
```

因此页面可见期间的普通变化，应该直接按 Chrome ID 修改当前 DOM，而不是重建整棵树。

## 4. 目标架构

新增一层：

```text
Permanent Chrome ID Incremental Mutation Pipeline
```

目标调用顺序：

```text
Chrome bookmarks event
-> BCS 增量同步
-> cachedCurrentTree 增量同步
-> 当前可见 DOM 增量 patch
-> 成功：不触发共享树 replaceChildren
-> 失败：回退到当前整树刷新路径
```

### 4.1 三层状态职责

```text
BCS 层：负责永久存储，页面关闭后仍存在。
缓存层：负责懒加载、路径查询、后续展开读取。
DOM 层：负责当前可见的主体和副本视觉节点。
```

三层更新规则：

```text
BCS 必须准确。
缓存必须跟上可见期间的事件。
DOM 只 patch 当前已渲染的节点；未渲染节点只更新数据层。
```

## 5. Chrome ID 增量事件规则

### 5.1 新增 `onCreated(id, bookmark)`

Chrome 事件提供：

```text
id
bookmark.parentId
bookmark.index
bookmark.title
bookmark.url
```

目标处理：

```text
1. 用 id + bookmark 写入/确认 BCS。
2. 用 id + bookmark 插入 cachedCurrentTree。
3. 查找所有可见永久树中的 parentId。
4. 父文件夹已渲染且 children 容器已展开/已加载：插入新 .tree-node。
5. 父文件夹未渲染或未展开：只更新父节点 hasChildren 等轻量状态，不展开、不强制渲染。
6. 成功后不调用 schedulePermanentTreeSharedMutationRefresh。
```

新增文件夹同样适用；新增文件夹就是插入一个带 `.tree-children` 的新 `.tree-node`。

### 5.2 删除 `onRemoved(id, removeInfo)`

Chrome 事件提供：

```text
id
removeInfo.parentId
removeInfo.index
removeInfo.node
```

目标处理：

```text
1. 用 id 从 BCS 删除节点。
2. 用 id 从 cachedCurrentTree 删除节点。
3. 在所有可见永久树中查找 .tree-item[data-node-id=id]。
4. 找到后删除其 closest('.tree-node')。
5. 如果删除的是文件夹，DOM 子树随 .tree-node 一起删除。
6. 更新父节点 hasChildren / childrenLoaded / load more 状态。
7. 成功后不调用 schedulePermanentTreeSharedMutationRefresh。
```

删除未渲染节点时：

```text
BCS 和缓存更新即可。
DOM 不需要动作。
```

### 5.3 修改 `onChanged(id, changeInfo)`

Chrome 事件提供：

```text
id
changeInfo.title
changeInfo.url
```

目标处理：

```text
1. 用 id 更新 BCS。
2. 用 id 更新 cachedCurrentTree。
3. 在所有可见永久树中查找 .tree-item[data-node-id=id]。
4. 只更新标题文本、链接、dataset、favicon 相关字段。
5. 成功后不调用 schedulePermanentTreeSharedMutationRefresh。
```

修改未渲染节点时：

```text
BCS 和缓存更新即可。
DOM 不需要动作。
```

### 5.4 移动 `onMoved(id, moveInfo)`

Chrome 事件提供：

```text
id
moveInfo.oldParentId
moveInfo.parentId
moveInfo.oldIndex
moveInfo.index
```

目标处理：

```text
1. 用 id + moveInfo 移动 BCS 节点。
2. 用 id + moveInfo 移动 cachedCurrentTree 节点。
3. 在所有可见永久树中查找源 .tree-node。
4. 查找目标 parentId 的 .tree-children。
5. 目标父文件夹已渲染且 children 容器已展开/已加载：把源 .tree-node 插入到目标 index。
6. 目标父文件夹未渲染或未加载：从旧 DOM 删除源节点，不强制展开目标。
7. 源节点未渲染但目标父文件夹已渲染且已加载：从缓存渲染单个节点后插入目标。
8. 源和目标都未渲染：DOM 不动作。
9. 成功后不调用 schedulePermanentTreeSharedMutationRefresh。
```

移动文件夹同样适用；文件夹是一个完整 `.tree-node` 子树，DOM 移动时子树一起移动。

## 6. 主体和副本的处理规则

永久栏目存在：

```text
主永久栏目 #bookmarkTree
永久栏目副本 .permanent-bookmark-section.permanent-section-copy .bookmark-tree
```

DOM 增量必须对所有可见树执行。

目标函数：

```js
collectPermanentTreeDomPatchTargets()
applyPermanentCreateDomPatch(id, bookmark)
applyPermanentRemoveDomPatch(id, removeInfo)
applyPermanentChangeDomPatch(id, changeInfo)
applyPermanentMoveDomPatch(id, moveInfo)
```

规则：

```text
每个 target tree 独立判断展开状态和懒加载状态。
一个副本展开了目标文件夹，另一个副本没有展开：只 patch 展开的那个副本。
未展开副本只更新缓存，不强制展开。
```

这保留当前“主体和副本共享内容、独立交互壳”的设计。

## 7. 批量和兜底规则

### 7.1 继续保留整树路径

以下情况继续拉整树 / 整树渲染：

- 打开页面或首次初始化永久栏目。
- 侧边栏/页面长期不可见后恢复。
- 浏览器导入书签。
- 批量变化超过阈值。
- 增量 BCS 更新失败。
- 增量缓存更新失败。
- 增量 DOM patch 失败。
- 当前 DOM 结构缺失关键容器。
- 用户手动刷新或强制同步。

### 7.2 当前统一批量阈值

当前代码已有：

```js
const BULK_BOOKMARK_MUTATION_THRESHOLD = 100;
const BULK_BOOKMARK_MUTATION_QUIET_MS = 220;
```

现状：

```text
onCreated/onRemoved/onMoved 进入同一个 pendingBookmarkMutationEvents 队列。
队列按 Chrome 事件到达顺序串行 flush。
onChanged 不进入批量阈值，但会先 flush 前面的 pending mutation，再立即做增量修改。
```

规则：

```text
220ms quiet window 内 created/removed/moved 事件数 < 100：
按队列顺序逐个走 Chrome ID 缓存增量和 DOM patch。

220ms quiet window 内 created/removed/moved 事件数 >= 100：
停止逐个 DOM patch，更新运行时 cache 后触发 BCS 同步和整树刷新兜底。
```

`onChanged` 不设置批量阈值：

```text
标题或 URL 修改由单个 Chrome ID 精确定位。
用户很难产生需要批量阈值保护的大量 changed 事件。
```

后续根据实测再调整阈值。

### 7.3 大文件夹删除/移动

删除或移动大文件夹在 Chrome 事件层通常是一个根节点事件。

处理原则：

```text
事件数少：仍按单个 Chrome ID 增量处理。
文件夹 DOM 子树随 .tree-node 一起删除或移动。
不按子节点数量触发整树刷新。
```

`chrome.bookmarks.removeTree(folderId)` 按一次 `onRemoved` root 事件计数。

只有当 created/removed/moved 事件数量本身在短时间内超过阈值，才进入批量整树路径。

## 8. BCS 同步策略调整

实施前普通事件后会调用：

```js
schedulePermanentMainStorageSyncFromChrome(reason)
```

当时第一版实现的是 **视觉 DOM 增量** 和 **运行时缓存增量**：

```text
Chrome 事件 payload
-> cachedCurrentTree 增量更新
-> 当前可见永久栏目 / 副本 DOM patch
```

BCS 是持久存储层，和 DOM patch 是两层系统：

```text
DOM 增量：改当前页面看得见的 .tree-node，目标是减少闪烁。
BCS 增量：改持久化的永久书签树数据，目标是减少后台 getTree / 全量写入。
```

实施后，普通事件改为优先走：

```text
普通事件 payload -> applyPermanentBookmarkEventsToBcsIncremental -> bridge.applyPermanentBookmarkEventsToBcs
```

底层由 `history_html/bookmark_canvas_module.js` 的 `__applyPermanentBookmarkEventsToBcs()` 在一次 BCS mutation 内按事件顺序处理。

当前边界为：

```text
普通单个/少量事件：优先按 Chrome ID 增量写 BCS。
增量写 BCS 成功：不调用 syncPermanentMainTreeFromChromeBookmarks。
增量写 BCS 失败：调用 syncPermanentMainTreeFromChromeBookmarks 兜底。
批量事件、浏览器导入、前端缺席后的重新打开：继续用整树同步校准。
```

增量写入覆盖四类 Chrome 事件：

```text
created：按 parentId/index 插入；已有节点视为幂等更新；pending 节点可被真实 Chrome ID 接管。
removed：按 Chrome ID 删除整块子树；节点已经不存在时视为 no-op。
moved：按 Chrome ID 移动整块子树；缺少源节点、目标父节点或 index 时兜底整树同步。
changed：只更新 title/url；结构缺失时兜底整树同步。
```

### 8.1 sourceID 处理

BCS 增量不引入长期 `chromeId -> sourceID` 映射表。

`sourceID` 仍然嵌在 BCS JSON 节点内部，随节点移动、删除、整块迁移。

新增节点的 `sourceID` 解析顺序：

```text
已有 Chrome ID 节点上的 sourceID
-> 事件 payload 自带 sourceID（通常没有）
-> prepare create 产生的 pending 节点 sourceID
-> 内存中的 pending chromeId -> sourceID
-> 生成新的 sourceID 并写入该 BCS 节点
```

这样保证：

```text
外部创建：生成一个新的 sourceID，直接嵌入新节点。
插件自己创建：复用 prepare 阶段生成的 sourceID。
重复事件：不生成第二个 sourceID。
全量同步兜底：仍通过 Chrome ID 搜集旧树 sourceID 并贴回新树。
```

### 8.2 插件自己发起的操作

插件自己操作时，BCS 已经在调用 Chrome API 前被更新：

```text
create：prepare pending -> create 返回真实 id -> commit pending
update：updatePermanentNodeInBcs
remove：removePermanentNodeFromBcs
move：movePermanentNodeInBcs
```

目标：

```text
Chrome 事件回来后，不再重复整树同步。
事件只负责补齐缓存和 DOM。
失败时再全量兜底。
```

第一版可以不强依赖复杂 self-origin 标记。

更稳的规则是：

```text
事件到达时，先尝试按 Chrome ID 对 BCS 做幂等增量更新。
BCS 已经是目标状态：视为成功。
BCS 不存在目标结构或更新失败：整树同步兜底。
```

对 create 还有一个竞态：

```text
preparePermanentCreateNodeInBcs 先写入 pending 节点。
Chrome onCreated 可能先于 commitPermanentCreatedNodeInBcs 到达。
BCS 事件增量会把匹配的 pending 节点改成真实 Chrome ID。
后续 commit 再到达时，如果 pending 已不存在但真实 Chrome ID 节点已存在，视为幂等成功。
```

### 8.3 外部发起的操作

外部来源包括：

- Chrome 自带书签管理器。
- 第三方插件。
- 浏览器同步带来的少量变化。

目标：

```text
普通单个/少量事件同样使用 Chrome ID 增量写 BCS。
不因为来源是外部就默认拉整树。
```

来源不作为 DOM 策略的主要判断条件。

主要判断条件是：

```text
事件信息是否完整。
事件数量是否过多。
本地结构是否能匹配 Chrome ID。
```

### 8.4 队列与兜底边界

结构事件使用统一队列：

```text
onCreated/onRemoved/onMoved
-> 220ms quiet window
-> < 100：先按事件顺序合批写一次 BCS，再逐个更新运行时 cache/DOM
-> >= 100：跳过 BCS 增量，直接整树同步和整树刷新兜底
```

修改事件不进入批量阈值：

```text
onChanged
-> 先 flush 已排队结构事件
-> 单独写 BCS 增量
-> 再更新运行时 cache/DOM
```

任何 BCS 增量异常都会转为：

```text
syncPermanentMainTreeFromChromeBookmarks
-> 清理永久树渲染缓存
-> 必要时刷新 cachedCurrentTree / 当前 Canvas 树
```

## 9. 不做的事情

第一版不做以下事情：

- 不重写整套永久树渲染器。
- 不取消 `renderTreeView()`。
- 不取消 `__renderPermanentTreeSharedViews()`。
- 不取消批量整树兜底。
- 不把 sourceID 当成永久书签主身份。
- 不强制展开未展开文件夹来展示新增/移动结果。
- 不为了 DOM patch 引入大型虚拟 DOM 框架。

Chrome ID 是永久书签增量操作的主身份。

sourceID 只保留现有低成本辅助用途，不作为增删改移的主定位依据。

## 10. 实施阶段

### 阶段一：DOM patch 基础设施

新增基础工具：

```js
collectPermanentTreeDomPatchTargets()
findPermanentTreeItemByChromeId(tree, id)
findPermanentTreeNodeByChromeId(tree, id)
findPermanentChildrenContainerByParentId(tree, parentId)
renderSinglePermanentTreeNodeForDomPatch(node, level, tree)
insertPermanentTreeNodeAtIndex(childrenContainer, nodeEl, index)
```

要求：

```text
所有查询必须限定在单个 bookmark-tree 内。
必须支持主体和副本。
必须使用 CSS.escape 处理 Chrome ID。
必须保留展开状态、滚动状态、当前 DOM 事件绑定。
```

### 阶段二：先实现修改 onChanged

优先实现 `onChanged` DOM 增量。

原因：

```text
修改只改标题/URL，不改变树结构。
风险最低。
收益直接体现在改名不整树闪动。
```

完成后路径：

```text
onChanged
-> updateBookmarkInCache
-> applyIncrementalChangeToCachedCurrentTree
-> applyPermanentChangeDomPatch
-> 成功则不 schedulePermanentTreeSharedMutationRefresh
```

### 阶段三：实现删除 onRemoved

实现删除单个节点和文件夹子树。

完成后路径：

```text
onRemoved
-> removeBookmarkFromCache
-> applyIncrementalRemoveFromCachedCurrentTree
-> applyPermanentRemoveDomPatch
-> 成功则不 schedulePermanentTreeSharedMutationRefresh
```

### 阶段四：实现移动 onMoved

实现同父移动、跨父移动、文件夹移动。

完成后路径：

```text
onMoved
-> moveBookmarkInCache
-> applyIncrementalMoveToCachedCurrentTree
-> applyPermanentMoveDomPatch
-> 成功则不 schedulePermanentTreeSharedMutationRefresh
```

移动是最需要测试的阶段，因为它同时涉及：

- 旧父节点 DOM 状态。
- 新父节点 DOM 状态。
- index 修正。
- 懒加载未展开文件夹。
- 主体和副本各自展开状态不同。

### 阶段五：实现新增 onCreated

实现书签新增和文件夹新增。

完成后路径：

```text
onCreated
-> addBookmarkToCache
-> applyIncrementalCreateToCachedCurrentTree
-> applyPermanentCreateDomPatch
-> 成功则不 schedulePermanentTreeSharedMutationRefresh
```

新增需要处理：

```text
父文件夹已展开：插入 DOM。
父文件夹未展开：不插入 DOM，只更新 hasChildren。
父文件夹未加载：不加载整棵子树。
```

### 阶段六：统一批量事件窗口

把 created/removed/moved 纳入统一队列：

```text
onCreated
onRemoved
onMoved
```

目标：

```text
少量事件：按 Chrome 事件到达顺序逐个 Chrome ID 增量。
大量事件：静默收集，整树同步，整树渲染一次。
onChanged：不进批量阈值，先 flush 已排队 mutation，再立即增量修改。
```

### 阶段七：BCS 事件增量写入

减少普通事件后的整树 getTree。

实现状态：

```text
普通事件：事件 payload -> BCS 增量更新。
失败：syncPermanentMainTreeFromChromeBookmarks 兜底。
批量/导入/打开/恢复：继续整树同步。
created/removed/moved：在统一队列内合批写一次 BCS，再进入缓存和 DOM 增量。
changed：不进入批量阈值，但会先 flush 结构队列，再写 BCS 增量。
```

这一步能减少后台性能压力；DOM patch 是视觉收益最大的一步。

## 11. 验收标准

### 11.1 单个修改

操作：在 Chrome 书签管理器或插件永久栏目中修改一个书签标题。

验收：

```text
可见标题立即变化。
永久栏目主体不 replaceChildren。
永久栏目副本不 replaceChildren。
滚动位置不跳。
展开状态不变。
```

### 11.2 单个删除

操作：删除一个可见书签。

验收：

```text
只删除对应 .tree-node。
父级列表不整树重挂。
副本中同一 Chrome ID 节点同步删除。
```

### 11.3 单个移动

操作：移动一个可见书签到另一个已展开文件夹。

验收：

```text
只移动对应 .tree-node。
源父级和目标父级局部变化。
主体和副本按各自展开状态更新。
不触发整树 replaceChildren。
```

### 11.4 单个新增

操作：新增一个书签到已展开文件夹。

验收：

```text
只插入新增 .tree-node。
Chrome ID 使用 create 返回值或 onCreated 事件 id。
不为获取 Chrome ID 拉整树。
```

### 11.5 未展开文件夹中的变化

操作：外部在未展开文件夹中新增/删除/移动节点。

验收：

```text
BCS 更新。
cachedCurrentTree 更新。
当前 DOM 不强制展开、不整树刷新。
用户之后展开文件夹时看到正确内容。
```

### 11.6 批量导入

操作：导入大量书签或短时间产生大量事件。

验收：

```text
不逐个 DOM patch。
进入批量整树同步。
最终只整树刷新一次。
```

### 11.7 一万级书签场景

操作：一万个书签中移动一个书签。

验收：

```text
不拉整棵树作为普通路径。
不整树 replaceChildren。
只移动对应 Chrome ID 的 DOM 节点。
```

## 12. 风险与防护

### 12.1 DOM 结构不匹配

防护：

```text
找不到关键 DOM 容器时，不硬 patch。
直接回退 schedulePermanentTreeSharedMutationRefresh。
```

### 12.2 缓存和 DOM 不一致

防护：

```text
DOM patch 前先更新 cachedCurrentTree。
DOM patch 需要的节点数据从 cachedCurrentTree 读取。
缓存更新失败时不做 DOM patch。
```

### 12.3 副本展开状态不同

防护：

```text
每个 tree 单独判断。
只 patch 已渲染/已展开/已加载部分。
不把一个副本的展开状态同步到另一个副本。
```

### 12.4 批量事件中途失败

防护：

```text
一旦事件窗口达到 bulk threshold，停止增量路径。
清理待处理 patch。
走整树同步和整树渲染一次。
```

### 12.5 插件自发起事件重复处理

防护：

```text
BCS 增量写入设计为幂等。
已经达到目标状态时视为成功。
不需要为了第一版引入复杂 self-origin ledger。
```

## 13. 最终目标状态

最终目标不是消灭整树渲染，而是把整树渲染限制到正确场景：

```text
正确保留：打开、恢复、导入、批量、异常、手动刷新。
必须避免：页面可见时普通单个增删改移也整树 replaceChildren。
```

达到目标后，永久栏目普通操作路径应为：

```text
Chrome ID 事件
-> BCS 增量
-> cachedCurrentTree 增量
-> 主体/副本 DOM 增量
-> 无视觉闪烁
```

这就是永久书签刷新体验中收益最大的结构性改变。
